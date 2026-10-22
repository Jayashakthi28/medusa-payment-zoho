import type {
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { BigNumber, PaymentActions } from "@medusajs/framework/utils"

import type { ZohoPaymentLogger } from "../../types"
import { assertValidZohoWebhookSignature } from "../../core/signatures"
import { ZohoValidationError } from "../../core/errors"
import { isTerminalSessionStatus } from "../../core/status"
import { normalizeCurrencyCode } from "../../core/amount"
import { extractMedusaSessionId, extractZohoSessionId } from "./session-data"
import type { ZohoPayment, ZohoPaymentsClientLike, ZohoWebhookEvent } from "./types"

type ZohoWebhookPayload = ProviderWebhookPayload["payload"]

/** Options used when mapping a verified webhook event. */
export interface ZohoWebhookHandlerOptions {
  signingKey?: string
  liveMode?: boolean
  expectedAccountId: string
  webhookToleranceSeconds: number
  now?: () => number
  logger?: ZohoPaymentLogger
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getHeader(
  headers: Record<string, unknown>,
  name: string
): string | string[] | undefined {
  const target = name.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue
    }

    if (typeof value === "string" || Array.isArray(value)) {
      return value as string | string[]
    }

    if (typeof value === "number") {
      return String(value)
    }
  }

  return undefined
}

function parseRawBody(rawBody: unknown): string | Buffer {
  if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) {
    return rawBody
  }

  // Never re-serialize an object: the signature is over the exact bytes Zoho sent.
  throw new ZohoValidationError(
    "Zoho webhook raw body is missing; signature verification requires the exact request bytes"
  )
}

function parseEvent(rawBody: string | Buffer): ZohoWebhookEvent {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody
  let candidate: unknown

  try {
    candidate = JSON.parse(text)
  } catch (error) {
    throw new ZohoValidationError("Zoho webhook body is not valid JSON", {
      cause: error,
    })
  }

  if (
    !isRecord(candidate) ||
    typeof candidate.event_type !== "string" ||
    candidate.event_type.length === 0
  ) {
    throw new ZohoValidationError("Zoho webhook body is missing an event_type")
  }

  return candidate as ZohoWebhookEvent
}

function assertAccountAndMode(
  event: ZohoWebhookEvent,
  options: ZohoWebhookHandlerOptions
): void {
  if (event.account_id === undefined) {
    throw new ZohoValidationError("Zoho webhook is missing the account_id field")
  }

  if (String(event.account_id) !== options.expectedAccountId) {
    throw new ZohoValidationError(
      "Zoho webhook account does not match the configured account"
    )
  }

  if (options.liveMode !== undefined) {
    if (typeof event.live_mode !== "boolean") {
      throw new ZohoValidationError("Zoho webhook is missing the live_mode field")
    }

    if (event.live_mode !== options.liveMode) {
      throw new ZohoValidationError(
        "Zoho webhook live/test mode does not match the configured mode"
      )
    }
  }
}

function getPayment(event: ZohoWebhookEvent): ZohoPayment | undefined {
  const payment = event.event_object?.payment

  if (
    !isRecord(payment) ||
    typeof payment.payment_id !== "string" ||
    typeof payment.amount !== "string" ||
    typeof payment.currency !== "string" ||
    typeof payment.status !== "string"
  ) {
    return undefined
  }

  normalizeCurrencyCode(payment.currency)

  return payment
}

function parseWebhookAmount(amount: string, action: PaymentActions): BigNumber {
  const value = new BigNumber(amount)
  const decimal = value.bigNumber

  if (!decimal || decimal.isNaN() || !decimal.isFinite() || decimal.lt(0)) {
    throw new ZohoValidationError("Zoho webhook contains an invalid amount")
  }

  if (action === PaymentActions.SUCCESSFUL && !decimal.gt(0)) {
    throw new ZohoValidationError(
      "Zoho webhook reported a successful payment without a positive amount"
    )
  }

  return value
}

function buildActionResult(
  action: PaymentActions,
  sessionId: string,
  amount: string
): WebhookActionResult {
  return {
    action,
    data: {
      session_id: sessionId,
      amount: parseWebhookAmount(amount, action),
    },
  }
}

/**
 * Verify and map a Zoho webhook to a Medusa payment action.
 *
 * Signature verification happens before any payload field is trusted. `payment.failed`
 * is intentionally reconciled against the Zoho session because Zoho emits it once per
 * attempt, while a single session can still succeed afterwards.
 */
export async function handleZohoWebhook(
  payload: ZohoWebhookPayload,
  client: ZohoPaymentsClientLike,
  options: ZohoWebhookHandlerOptions
): Promise<WebhookActionResult> {
  const rawBody = parseRawBody(payload.rawData)

  if (!options.signingKey) {
    throw new ZohoValidationError(
      "Cannot verify Zoho webhook: signingKey is not configured"
    )
  }

  assertValidZohoWebhookSignature(
    {
      rawBody,
      signatureHeader: getHeader(payload.headers, "x-zoho-webhook-signature"),
    },
    options.signingKey,
    {
      toleranceSeconds: options.webhookToleranceSeconds,
      now: options.now,
    }
  )

  const event = parseEvent(rawBody)
  assertAccountAndMode(event, options)
  const payment = getPayment(event)
  const medusaSessionId = payment ? extractMedusaSessionId(payment) : undefined

  if (
    payment &&
    (((event.event_type === "payment.succeeded" ||
      event.event_type === "payment.success") &&
      payment.status.toLowerCase() !== "succeeded") ||
      (event.event_type === "payment.pending" &&
        payment.status.toLowerCase() !== "pending") ||
      (event.event_type === "payment.failed" &&
        payment.status.toLowerCase() !== "failed"))
  ) {
    throw new ZohoValidationError(
      `Zoho webhook event "${event.event_type}" contradicts payment status "${payment.status}"`
    )
  }

  if (!payment || !medusaSessionId) {
    options.logger?.debug("Ignoring Zoho webhook without a Medusa session ID", {
      eventType: event.event_type,
    })
    return { action: PaymentActions.NOT_SUPPORTED }
  }

  switch (event.event_type) {
    case "payment.succeeded":
    case "payment.success":
      return buildActionResult(
        PaymentActions.SUCCESSFUL,
        medusaSessionId,
        payment.amount
      )

    case "payment.pending":
      return buildActionResult(
        PaymentActions.PENDING_AUTHORIZATION,
        medusaSessionId,
        payment.amount
      )

    case "payment.failed": {
      const zohoSessionId = extractZohoSessionId(payment)

      if (!zohoSessionId) {
        options.logger?.warn(
          "Zoho payment.failed event has no session ID; keeping the Medusa session open",
          { paymentId: payment.payment_id }
        )
        return buildActionResult(
          PaymentActions.PENDING_AUTHORIZATION,
          medusaSessionId,
          payment.amount
        )
      }

      const session = await client.retrievePaymentSession(zohoSessionId)

      if (session.status?.toLowerCase() === "succeeded") {
        return buildActionResult(
          PaymentActions.SUCCESSFUL,
          medusaSessionId,
          payment.amount
        )
      }

      if (isTerminalSessionStatus(session.status)) {
        return buildActionResult(PaymentActions.FAILED, medusaSessionId, payment.amount)
      }

      return buildActionResult(
        PaymentActions.PENDING_AUTHORIZATION,
        medusaSessionId,
        payment.amount
      )
    }

    case "refund.succeeded":
    case "refund.failed":
    case "payment_link.paid":
    case "payment_link.expired":
    case "payment_link.canceled":
    case "payout.initiated":
    case "payout.paid":
    case "payout.failed":
      return { action: PaymentActions.NOT_SUPPORTED }

    default:
      options.logger?.debug("Ignoring unsupported Zoho webhook event", {
        eventType: event.event_type,
      })
      return { action: PaymentActions.NOT_SUPPORTED }
  }
}

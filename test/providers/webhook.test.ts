/* eslint-disable @typescript-eslint/require-await -- fake client handlers return promises directly */
import { MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  ZohoValidationError,
  ZohoWebhookVerificationError,
} from "../../src/core/errors"
import type { ZohoWebhookHandlerOptions } from "../../src/providers/zoho/webhook"
import { handleZohoWebhook } from "../../src/providers/zoho/webhook"
import {
  NOW,
  SIGNING_KEY,
  FakeLogger,
  buildPaymentEvent,
  captureMedusaError,
  createClient,
  createHarness,
  createRefund,
  createSession,
  createWebhookPayload,
  signWebhookBody,
} from "../fixtures/providers"

function handlerOptions(
  overrides: Partial<ZohoWebhookHandlerOptions> = {}
): ZohoWebhookHandlerOptions {
  return {
    signingKey: SIGNING_KEY,
    expectedAccountId: "acct_in",
    webhookToleranceSeconds: 0,
    now: () => NOW,
    ...overrides,
  }
}

describe("handleZohoWebhook", () => {
  it("verifies a string raw body and maps payment.succeeded", async () => {
    const event = buildPaymentEvent()
    const payload = createWebhookPayload(event)
    const client = createClient()

    const result = await handleZohoWebhook(payload, client, handlerOptions())

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe("payses_1")
    expect(Number(result.data?.amount)).toBe(100)
    expect(client.retrievePaymentSessionCalls).toEqual([])
  })

  it("verifies a Buffer raw body", async () => {
    const event = buildPaymentEvent()
    const rawBody = Buffer.from(JSON.stringify(event), "utf8")
    const payload = createWebhookPayload(event, { rawBody })

    const result = await handleZohoWebhook(payload, createClient(), handlerOptions())

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe("payses_1")
  })

  it("rejects an object raw body because exact signed bytes are required", async () => {
    const event = buildPaymentEvent()
    const rawBody = { event_type: "payment.succeeded" }
    const payload = {
      data: event,
      rawData: rawBody as unknown as string,
      headers: {
        "x-zoho-webhook-signature": signWebhookBody(JSON.stringify(rawBody)),
      },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects an unsupported raw body type", async () => {
    const event = buildPaymentEvent()
    const payload = {
      data: event,
      rawData: 42 as unknown as string,
      headers: { "x-zoho-webhook-signature": signWebhookBody("") },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects a numeric signature header value", async () => {
    const event = buildPaymentEvent()
    const payload = {
      data: event,
      rawData: JSON.stringify(event),
      headers: { "x-zoho-webhook-signature": 42 },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoWebhookVerificationError)
  })

  it("ignores a matching header with an unsupported value type", async () => {
    const event = buildPaymentEvent()
    const payload = {
      data: event,
      rawData: JSON.stringify(event),
      headers: { "x-zoho-webhook-signature": true },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoWebhookVerificationError)
  })

  it("accepts a signature header in any case", async () => {
    const event = buildPaymentEvent()
    const payload = createWebhookPayload(event, {
      headerName: "X-Zoho-Webhook-Signature",
      headers: { "content-type": "application/json" },
    })

    const result = await handleZohoWebhook(payload, createClient(), handlerOptions())

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })

  it("accepts an array-valued signature header", async () => {
    const event = buildPaymentEvent()
    const rawBody = JSON.stringify(event)
    const payload = createWebhookPayload(event, {
      signatureHeader: [
        signWebhookBody(rawBody),
        signWebhookBody(rawBody, "another-key"),
      ],
    })

    const result = await handleZohoWebhook(payload, createClient(), handlerOptions())

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })

  it("rejects a missing signature", async () => {
    const payload = createWebhookPayload(buildPaymentEvent(), {
      signatureHeader: null,
    })

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoWebhookVerificationError)
  })

  it("rejects an invalid signature", async () => {
    const payload = createWebhookPayload(buildPaymentEvent(), {
      signatureHeader: `t=${NOW},v=${"0".repeat(64)}`,
    })

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoWebhookVerificationError)
  })

  it("rejects a valid signature over a different raw body", async () => {
    const event = buildPaymentEvent()
    const payload = createWebhookPayload(event, {
      signatureHeader: signWebhookBody("a different body"),
    })

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoWebhookVerificationError)
  })

  it("requires a signing key before reading the payload", async () => {
    const payload = createWebhookPayload(buildPaymentEvent())

    await expect(
      handleZohoWebhook(
        payload,
        createClient(),
        handlerOptions({ signingKey: undefined })
      )
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects an account mismatch", async () => {
    const event = buildPaymentEvent({}, { account_id: "acct_other" })
    const payload = createWebhookPayload(event)

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("accepts numeric account IDs that stringify to the configured account", async () => {
    const event = buildPaymentEvent({}, { account_id: 123 })
    const payload = createWebhookPayload(event)

    const result = await handleZohoWebhook(
      payload,
      createClient(),
      handlerOptions({ expectedAccountId: "123" })
    )

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })

  it("rejects a live-mode mismatch", async () => {
    const event = buildPaymentEvent({}, { live_mode: false })
    const payload = createWebhookPayload(event)

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions({ liveMode: true }))
    ).rejects.toThrow(ZohoValidationError)
  })

  it("accepts a matching live mode and rejects a missing one", async () => {
    const matching = buildPaymentEvent({}, { live_mode: true })
    const missing = buildPaymentEvent({}, { live_mode: undefined })

    await expect(
      handleZohoWebhook(
        createWebhookPayload(matching),
        createClient(),
        handlerOptions({ liveMode: true })
      )
    ).resolves.toMatchObject({ action: PaymentActions.SUCCESSFUL })

    await expect(
      handleZohoWebhook(
        createWebhookPayload(missing),
        createClient(),
        handlerOptions({ liveMode: true })
      )
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects an event older than the configured tolerance", async () => {
    const event = buildPaymentEvent()
    const payload = createWebhookPayload(event, { timestamp: NOW - 60_000 })

    await expect(
      handleZohoWebhook(
        payload,
        createClient(),
        handlerOptions({ webhookToleranceSeconds: 30 })
      )
    ).rejects.toThrow(ZohoWebhookVerificationError)

    await expect(
      handleZohoWebhook(
        payload,
        createClient(),
        handlerOptions({ webhookToleranceSeconds: 120 })
      )
    ).resolves.toMatchObject({ action: PaymentActions.SUCCESSFUL })
  })

  it("does not enforce age when tolerance is zero", async () => {
    const event = buildPaymentEvent()
    const payload = createWebhookPayload(event, {
      timestamp: NOW - 24 * 60 * 60 * 1000,
    })

    const result = await handleZohoWebhook(
      payload,
      createClient(),
      handlerOptions({ webhookToleranceSeconds: 0 })
    )

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })

  it.each(["payment.succeeded", "payment.success"])(
    "maps %s to captured",
    async (eventType) => {
      const event = buildPaymentEvent({}, { event_type: eventType })
      const result = await handleZohoWebhook(
        createWebhookPayload(event),
        createClient(),
        handlerOptions()
      )

      expect(result.action).toBe(PaymentActions.SUCCESSFUL)
      expect(result.data?.session_id).toBe("payses_1")
    }
  )

  it("maps payment.pending to pending_authorization", async () => {
    const event = buildPaymentEvent({}, { event_type: "payment.pending" })
    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.PENDING_AUTHORIZATION)
    expect(result.data?.session_id).toBe("payses_1")
  })

  it("maps payment.failed to failed once the Zoho session is terminal", async () => {
    const event = buildPaymentEvent({}, { event_type: "payment.failed" })
    const client = createClient({
      retrievePaymentSession: async (sessionId) =>
        createSession({ payments_session_id: sessionId, status: "failed" }),
    })

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      client,
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.FAILED)
    expect(result.data?.session_id).toBe("payses_1")
    expect(client.retrievePaymentSessionCalls).toEqual(["zoho_sess_1"])
  })

  it.each(["expired", "canceled", "cancelled"])(
    "maps payment.failed to failed when the session is %s",
    async (status) => {
      const event = buildPaymentEvent({}, { event_type: "payment.failed" })
      const client = createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status }),
      })

      const result = await handleZohoWebhook(
        createWebhookPayload(event),
        client,
        handlerOptions()
      )

      expect(result.action).toBe(PaymentActions.FAILED)
    }
  )

  it("keeps the session open when payment.failed is non-terminal", async () => {
    const event = buildPaymentEvent({}, { event_type: "payment.failed" })
    const client = createClient({
      retrievePaymentSession: async (sessionId) =>
        createSession({ payments_session_id: sessionId, status: "pending" }),
    })

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      client,
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.PENDING_AUTHORIZATION)
    expect(result.data?.session_id).toBe("payses_1")
  })

  it("maps a late payment.failed to captured when the session ultimately succeeded", async () => {
    const event = buildPaymentEvent({}, { event_type: "payment.failed" })
    const client = createClient({
      retrievePaymentSession: async (sessionId) =>
        createSession({ payments_session_id: sessionId, status: "succeeded" }),
    })

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      client,
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })

  it("keeps the session open when payment.failed has no Zoho session ID", async () => {
    const event = buildPaymentEvent(
      {
        payments_session_id: undefined,
        meta_data: undefined,
      },
      { event_type: "payment.failed" }
    )
    const logger = new FakeLogger()
    const client = createClient()

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      client,
      handlerOptions({ logger })
    )

    expect(result.action).toBe(PaymentActions.PENDING_AUTHORIZATION)
    expect(client.retrievePaymentSessionCalls).toEqual([])
    expect(
      logger.entries.some(
        (entry) => entry.level === "warn" && entry.message.includes("no session ID")
      )
    ).toBe(true)
  })

  it("uses Zoho session metadata when payment has no session field", async () => {
    const event = buildPaymentEvent(
      {
        payments_session_id: undefined,
        meta_data: [{ key: "zoho_session_id", value: "zoho_sess_meta" }],
      },
      { event_type: "payment.failed" }
    )
    const client = createClient({
      retrievePaymentSession: async (sessionId) =>
        createSession({ payments_session_id: sessionId, status: "failed" }),
    })

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      client,
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.FAILED)
    expect(client.retrievePaymentSessionCalls).toEqual(["zoho_sess_meta"])
  })

  it.each([
    "refund.succeeded",
    "refund.failed",
    "payment_link.paid",
    "payment_link.expired",
    "payment_link.canceled",
    "payout.initiated",
    "payout.paid",
    "payout.failed",
  ])("maps %s to not_supported", async (eventType) => {
    const event = buildPaymentEvent({}, { event_type: eventType })

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("maps a refund event without a payment object to not_supported", async () => {
    const event = buildPaymentEvent(
      {},
      {
        event_type: "refund.succeeded",
        event_object: { refund: createRefund() },
      }
    )

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("maps an unknown event to not_supported and logs at debug level", async () => {
    const event = buildPaymentEvent({}, { event_type: "payment.unknown" })
    const logger = new FakeLogger()

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions({ logger })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(
      logger.entries.some(
        (entry) => entry.level === "debug" && entry.message.includes("unsupported")
      )
    ).toBe(true)
  })

  it("ignores a payment without a Medusa session ID", async () => {
    const event = buildPaymentEvent({
      reference_number: undefined,
      meta_data: undefined,
    })
    const logger = new FakeLogger()

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions({ logger })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === "debug" &&
          entry.message.includes("without a Medusa session ID")
      )
    ).toBe(true)
  })

  it("ignores a payment object with invalid required fields", async () => {
    const event = buildPaymentEvent(
      { amount: undefined },
      { event_type: "payment.pending" }
    )

    const result = await handleZohoWebhook(
      createWebhookPayload(event),
      createClient(),
      handlerOptions()
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("rejects a body without event_type", async () => {
    const body = JSON.stringify({ account_id: "acct_in" })
    const payload = {
      data: { account_id: "acct_in" },
      rawData: body,
      headers: { "x-zoho-webhook-signature": signWebhookBody(body) },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects an empty event_type", async () => {
    const event = buildPaymentEvent({}, { event_type: "" })

    await expect(
      handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects a data field that is not an object", async () => {
    const body = JSON.stringify({ event_type: "payment.succeeded" })
    const payload = {
      data: "not-an-object" as unknown as Record<string, unknown>,
      rawData: body,
      headers: { "x-zoho-webhook-signature": signWebhookBody(body) },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })
})

describe("ZohoPaymentProviderService.getWebhookActionAndData", () => {
  it("delegates a verified webhook to Medusa", async () => {
    const harness = createHarness()
    const payload = createWebhookPayload(buildPaymentEvent())

    const result = await harness.provider.getWebhookActionAndData(payload)

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe("payses_1")
  })

  it("rejects an invalid signature as invalid data", async () => {
    const harness = createHarness()
    const payload = createWebhookPayload(buildPaymentEvent(), {
      signatureHeader: `t=${NOW},v=${"f".repeat(64)}`,
    })

    const error = await captureMedusaError(
      harness.provider.getWebhookActionAndData(payload)
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("webhook")
  })

  it("rejects when no signing key is configured", async () => {
    const harness = createHarness({ options: { signingKey: undefined } })
    const payload = createWebhookPayload(buildPaymentEvent())

    const error = await captureMedusaError(
      harness.provider.getWebhookActionAndData(payload)
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("signingKey")
  })

  it("propagates Zoho session lookup failures from payment.failed", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async () => {
          throw new Error("lookup exploded")
        },
      }),
    })
    const payload = createWebhookPayload(
      buildPaymentEvent({}, { event_type: "payment.failed" })
    )

    const error = await captureMedusaError(
      harness.provider.getWebhookActionAndData(payload)
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("lookup exploded")
  })
})

describe("signed-body and amount hardening", () => {
  it("rejects a signed body that is not valid JSON", async () => {
    const rawBody = "{not-json"
    const payload = {
      data: buildPaymentEvent(),
      rawData: rawBody,
      headers: { "x-zoho-webhook-signature": signWebhookBody(rawBody) },
    }

    await expect(
      handleZohoWebhook(payload, createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects a successful event with a zero amount", async () => {
    const event = buildPaymentEvent({ amount: "0.00" })

    await expect(
      handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it.each(["NaN", "-1.00", "not-a-number"])(
    "rejects an invalid webhook amount %s",
    async (amount) => {
      const event = buildPaymentEvent({ amount })

      await expect(
        handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
      ).rejects.toThrow(ZohoValidationError)
    }
  )

  it("rejects an event without account_id", async () => {
    const event = buildPaymentEvent({}, { account_id: undefined })

    await expect(
      handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })
})

describe("event/payment status consistency", () => {
  it("rejects a succeeded event whose payment status is failed", async () => {
    const event = buildPaymentEvent({ status: "failed" })

    await expect(
      handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })

  it("rejects a failed event whose payment status is succeeded", async () => {
    const event = buildPaymentEvent(
      { status: "succeeded" },
      { event_type: "payment.failed" }
    )

    await expect(
      handleZohoWebhook(createWebhookPayload(event), createClient(), handlerOptions())
    ).rejects.toThrow(ZohoValidationError)
  })
})

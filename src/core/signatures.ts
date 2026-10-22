import { createHmac, timingSafeEqual } from "node:crypto"

import { ZohoConfigurationError, ZohoWebhookVerificationError } from "./errors"

/** Raw webhook input as supplied by Medusa's payment webhook route. */
export interface ZohoWebhookSignatureInput {
  rawBody: string | Buffer
  signatureHeader: string | string[] | undefined
}

/** Options for webhook signature verification. */
export interface ZohoWebhookSignatureOptions {
  /** Reject events older/newer than this many seconds. `0` disables the check. */
  toleranceSeconds?: number
  /** Clock override for deterministic tests. */
  now?: () => number
}

/** Parsed `X-Zoho-Webhook-Signature` header. */
export interface ParsedZohoSignatureHeader {
  timestamp: number
  signature: string
}

/** Input for the Checkout Widget response signature. */
export interface ZohoWidgetSignatureInput {
  paymentId: string
  paymentSessionId: string
  signature: string
}

/** Return-URL fields covered by Zoho's hosted-checkout signature. */
export interface ZohoHostedCheckoutSignatureInput {
  paymentsSessionId: string
  paymentSessionStatus: string
  paymentId?: string
  paymentStatus?: string
  amount?: string
  /**
   * India returns include `mandate_id` in the signed message. US returns omit it;
   * when this value is absent the verifier accepts either official layout.
   */
  mandateId?: string
  udf1?: string
  udf2?: string
  udf3?: string
  udf4?: string
  udf5?: string
  signature: string
}

function assertSigningKey(signingKey: string): void {
  if (!signingKey) {
    throw new ZohoConfigurationError(
      "Zoho signing key is required to verify signatures"
    )
  }
}

function hmacSha256Hex(message: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(message, "utf8").digest("hex")
}

function constantTimeEqual(left: string, right: string): boolean {
  // An empty signature must never validate, even if both sides are empty.
  if (left.length !== right.length || right.length === 0) {
    return false
  }

  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header
}

/**
 * Parse Zoho's webhook signature header.
 *
 * Zoho sends `t=<epoch-ms>,v=<hex-hmac>` and signs `${t}.${rawBody}`.
 */
export function parseZohoSignatureHeader(
  header: string | string[] | undefined
): ParsedZohoSignatureHeader | null {
  const value = firstHeaderValue(header)

  if (!value) {
    return null
  }

  let timestampValue: string | undefined
  let signature: string | undefined

  for (const part of value.split(",")) {
    const separator = part.indexOf("=")

    if (separator === -1) {
      continue
    }

    const key = part.slice(0, separator).trim()
    const entryValue = part.slice(separator + 1).trim()

    if (key === "t") {
      timestampValue = entryValue
    } else if (key === "v" || key === "v1") {
      signature = entryValue
    }
  }

  if (!timestampValue || !signature) {
    return null
  }

  const timestamp = Number(timestampValue)

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }

  return { timestamp, signature }
}

/** Verify a Zoho webhook signature without throwing. */
export function isValidZohoWebhookSignature(
  input: ZohoWebhookSignatureInput,
  signingKey: string,
  options: ZohoWebhookSignatureOptions = {}
): boolean {
  assertSigningKey(signingKey)

  const parsed = parseZohoSignatureHeader(input.signatureHeader)

  if (!parsed) {
    return false
  }

  const toleranceSeconds = options.toleranceSeconds ?? 0

  if (toleranceSeconds > 0) {
    const now = (options.now ?? Date.now)()
    const ageInSeconds = Math.abs(now - parsed.timestamp) / 1000

    if (ageInSeconds > toleranceSeconds) {
      return false
    }
  }

  const rawBody =
    typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8")
  const expected = hmacSha256Hex(`${parsed.timestamp}.${rawBody}`, signingKey)

  return constantTimeEqual(expected, parsed.signature)
}

/** Verify a Zoho webhook signature, throwing a typed error when invalid. */
export function assertValidZohoWebhookSignature(
  input: ZohoWebhookSignatureInput,
  signingKey: string,
  options: ZohoWebhookSignatureOptions = {}
): void {
  if (!isValidZohoWebhookSignature(input, signingKey, options)) {
    throw new ZohoWebhookVerificationError("Invalid or expired Zoho webhook signature")
  }
}

/**
 * Verify a Checkout Widget response signature.
 *
 * Zoho signs `${payment_id}|${payment_session_id}` with HMAC-SHA256.
 */
export function isValidZohoWidgetResponseSignature(
  input: ZohoWidgetSignatureInput,
  signingKey: string
): boolean {
  assertSigningKey(signingKey)

  const expected = hmacSha256Hex(
    `${input.paymentId}|${input.paymentSessionId}`,
    signingKey
  )

  return constantTimeEqual(expected, input.signature)
}

/**
 * Verify a Hosted Checkout return-URL signature.
 *
 * Zoho signs the dot-joined fields, using empty strings for absent optional fields:
 * `payments_session_id.payment_session_status.payment_id.payment_status.amount.udf1..udf5`.
 */
export function isValidZohoHostedCheckoutSignature(
  input: ZohoHostedCheckoutSignatureInput,
  signingKey: string
): boolean {
  assertSigningKey(signingKey)

  const prefix = [
    input.paymentsSessionId,
    input.paymentSessionStatus,
    input.paymentId ?? "",
    input.paymentStatus ?? "",
    input.amount ?? "",
  ]
  const suffix = [
    input.udf1 ?? "",
    input.udf2 ?? "",
    input.udf3 ?? "",
    input.udf4 ?? "",
    input.udf5 ?? "",
  ]
  const candidates =
    input.mandateId === undefined
      ? [[...prefix, "", ...suffix].join("."), [...prefix, ...suffix].join(".")]
      : [[...prefix, input.mandateId, ...suffix].join(".")]

  return candidates.some((message) =>
    constantTimeEqual(hmacSha256Hex(message, signingKey), input.signature)
  )
}

import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  ZohoConfigurationError,
  ZohoWebhookVerificationError,
} from "../../src/core/errors"
import {
  assertValidZohoWebhookSignature,
  isValidZohoHostedCheckoutSignature,
  isValidZohoWebhookSignature,
  isValidZohoWidgetResponseSignature,
  parseZohoSignatureHeader,
} from "../../src/core/signatures"

const SIGNING_KEY = "zoho_signing_key_for_tests"
const OTHER_SIGNING_KEY = "another_signing_key"
const TIMESTAMP = 1_734_340_423_138
const RAW_BODY = JSON.stringify({
  event: "payment.succeeded",
  data: { payment_id: "pay_123", amount: "1499.00" },
})

function hmac(message: string, signingKey: string = SIGNING_KEY): string {
  return createHmac("sha256", signingKey).update(message, "utf8").digest("hex")
}

function webhookHeader(
  timestamp: number,
  body: string,
  signingKey: string = SIGNING_KEY
): string {
  return `t=${timestamp},v=${hmac(`${timestamp}.${body}`, signingKey)}`
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  return undefined
}

describe("parseZohoSignatureHeader", () => {
  it.each([undefined, "", [] as string[]])(
    "returns null for an empty header %j",
    (header) => {
      expect(parseZohoSignatureHeader(header)).toBeNull()
    }
  )

  it("parses a Zoho timestamp and signature", () => {
    expect(parseZohoSignatureHeader(`t=${TIMESTAMP},v=deadbeef`)).toEqual({
      timestamp: TIMESTAMP,
      signature: "deadbeef",
    })
  })

  it("uses the first value when the header is repeated", () => {
    expect(
      parseZohoSignatureHeader([`t=${TIMESTAMP},v=first`, "t=1,v=second"])
    ).toEqual({ timestamp: TIMESTAMP, signature: "first" })
  })

  it("trims whitespace around keys and values", () => {
    expect(parseZohoSignatureHeader(` t = ${TIMESTAMP} , v = deadbeef `)).toEqual({
      timestamp: TIMESTAMP,
      signature: "deadbeef",
    })
  })

  it("accepts the v1 signature key", () => {
    expect(parseZohoSignatureHeader(`t=${TIMESTAMP},v1=deadbeef`)).toEqual({
      timestamp: TIMESTAMP,
      signature: "deadbeef",
    })
  })

  it("accepts fields in any order and ignores unknown fields", () => {
    expect(
      parseZohoSignatureHeader(`v=deadbeef,ignored=1,t=${TIMESTAMP},junk`)
    ).toEqual({ timestamp: TIMESTAMP, signature: "deadbeef" })
  })

  it("parses a scientific-notation timestamp", () => {
    expect(parseZohoSignatureHeader("t=1e3,v=deadbeef")).toEqual({
      timestamp: 1000,
      signature: "deadbeef",
    })
  })

  it.each([
    "garbage",
    "t",
    "v=deadbeef",
    "t=123",
    "t=,v=deadbeef",
    "t=123,v=",
    "t=abc,v=deadbeef",
    "t=NaN,v=deadbeef",
    "t=Infinity,v=deadbeef",
    "t=0,v=deadbeef",
    "t=-1,v=deadbeef",
  ])("returns null for malformed header %j", (header) => {
    expect(parseZohoSignatureHeader(header)).toBeNull()
  })
})

describe("isValidZohoWebhookSignature", () => {
  const validHeader = webhookHeader(TIMESTAMP, RAW_BODY)

  it("accepts a signature over a raw string body", () => {
    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts a signature over a raw Buffer body", () => {
    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: Buffer.from(RAW_BODY, "utf8"),
          signatureHeader: validHeader,
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("verifies a UTF-8 body containing non-ASCII text", () => {
    const body = JSON.stringify({ note: "₹ café", event: "payment.succeeded" })
    const header = webhookHeader(TIMESTAMP, body)

    expect(
      isValidZohoWebhookSignature(
        { rawBody: Buffer.from(body, "utf8"), signatureHeader: header },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts the header when supplied as a single-element array", () => {
    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: [validHeader] },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts the v1 signature-key variant", () => {
    const signature = hmac(`${TIMESTAMP}.${RAW_BODY}`)

    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: `t=${TIMESTAMP},v1=${signature}`,
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it.each([
    undefined,
    "",
    "garbage",
    "t=123",
    "v=deadbeef",
    "t=0,v=deadbeef",
    `t=${TIMESTAMP},v=`,
  ])("rejects a missing or malformed signature header %j", (header) => {
    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: header },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a signature produced with a different key", () => {
    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: webhookHeader(TIMESTAMP, RAW_BODY, OTHER_SIGNING_KEY),
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a signature over a different body", () => {
    const tamperedBody = JSON.stringify({ event: "payment.failed" })

    expect(
      isValidZohoWebhookSignature(
        { rawBody: tamperedBody, signatureHeader: validHeader },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a signature with the wrong length", () => {
    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: `t=${TIMESTAMP},v=abc` },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a same-length signature that is not valid hex", () => {
    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: `t=${TIMESTAMP},v=${"z".repeat(64)}`,
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a same-length hex signature that does not match", () => {
    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: `t=${TIMESTAMP},v=${"0".repeat(64)}`,
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("throws when the signing key is missing", () => {
    expect(() =>
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        ""
      )
    ).toThrow(ZohoConfigurationError)
  })

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const now = TIMESTAMP + 5_000

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { toleranceSeconds: 5, now: () => now }
      )
    ).toBe(true)
  })

  it("rejects a timestamp older than the tolerance", () => {
    const now = TIMESTAMP + 5_001

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { toleranceSeconds: 5, now: () => now }
      )
    ).toBe(false)
  })

  it("accepts a timestamp within the tolerance in the future", () => {
    const futureTimestamp = TIMESTAMP + 10_000
    const header = webhookHeader(futureTimestamp, RAW_BODY)

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: header },
        SIGNING_KEY,
        { toleranceSeconds: 10, now: () => TIMESTAMP }
      )
    ).toBe(true)
  })

  it("rejects a future timestamp beyond the tolerance", () => {
    const futureTimestamp = TIMESTAMP + 10_001
    const header = webhookHeader(futureTimestamp, RAW_BODY)

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: header },
        SIGNING_KEY,
        { toleranceSeconds: 10, now: () => TIMESTAMP }
      )
    ).toBe(false)
  })

  it("disables the timestamp check when tolerance is zero", () => {
    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { toleranceSeconds: 0, now: () => TIMESTAMP + 1_000_000 }
      )
    ).toBe(true)
  })

  it("uses Date.now when a tolerance is set without a clock override", () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(TIMESTAMP + 1_000)

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { toleranceSeconds: 5 }
      )
    ).toBe(true)
    expect(dateNow).toHaveBeenCalled()
  })

  it("rejects an invalid signature even when the timestamp is fresh", () => {
    expect(
      isValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: `t=${TIMESTAMP},v=${"0".repeat(64)}`,
        },
        SIGNING_KEY,
        { toleranceSeconds: 5, now: () => TIMESTAMP }
      )
    ).toBe(false)
  })

  it("ignores the clock when tolerance is not enabled", () => {
    const now = vi.fn(() => TIMESTAMP)

    expect(
      isValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { now }
      )
    ).toBe(true)
    expect(now).not.toHaveBeenCalled()
  })
})

describe("assertValidZohoWebhookSignature", () => {
  const validHeader = webhookHeader(TIMESTAMP, RAW_BODY)

  it("does not throw for a valid signature", () => {
    expect(() => {
      assertValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY
      )
    }).not.toThrow()
  })

  it("throws a verification error for an invalid signature", () => {
    const error = captureError(() => {
      assertValidZohoWebhookSignature(
        {
          rawBody: RAW_BODY,
          signatureHeader: `t=${TIMESTAMP},v=${"0".repeat(64)}`,
        },
        SIGNING_KEY
      )
    })

    expect(error).toBeInstanceOf(ZohoWebhookVerificationError)
    expect(error).toHaveProperty("message", "Invalid or expired Zoho webhook signature")
    expect(error).toHaveProperty("code", "ZOHO_WEBHOOK_VERIFICATION_ERROR")
  })

  it("throws a verification error for an expired timestamp", () => {
    expect(() => {
      assertValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        SIGNING_KEY,
        { toleranceSeconds: 1, now: () => TIMESTAMP + 60_000 }
      )
    }).toThrow(ZohoWebhookVerificationError)
  })

  it("propagates a missing signing-key configuration error", () => {
    expect(() => {
      assertValidZohoWebhookSignature(
        { rawBody: RAW_BODY, signatureHeader: validHeader },
        ""
      )
    }).toThrow(ZohoConfigurationError)
  })
})

describe("isValidZohoWidgetResponseSignature", () => {
  const paymentId = "pay_123"
  const paymentSessionId = "sess_456"
  const validSignature = hmac(`${paymentId}|${paymentSessionId}`)

  it("accepts the documented paymentId|paymentSessionId signature", () => {
    expect(
      isValidZohoWidgetResponseSignature(
        { paymentId, paymentSessionId, signature: validSignature },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts an uppercase hex signature", () => {
    expect(
      isValidZohoWidgetResponseSignature(
        {
          paymentId,
          paymentSessionId,
          signature: validSignature.toUpperCase(),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("rejects a signature with swapped identifiers", () => {
    expect(
      isValidZohoWidgetResponseSignature(
        {
          paymentId: paymentSessionId,
          paymentSessionId: paymentId,
          signature: validSignature,
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a signature produced with a different key", () => {
    const signature = hmac(`${paymentId}|${paymentSessionId}`, OTHER_SIGNING_KEY)

    expect(
      isValidZohoWidgetResponseSignature(
        { paymentId, paymentSessionId, signature },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it.each(["", "abc", "z".repeat(64), "0".repeat(64)])(
    "rejects malformed or mismatched signature %j",
    (signature) => {
      expect(
        isValidZohoWidgetResponseSignature(
          { paymentId, paymentSessionId, signature },
          SIGNING_KEY
        )
      ).toBe(false)
    }
  )

  it("throws when the signing key is missing", () => {
    expect(() =>
      isValidZohoWidgetResponseSignature(
        { paymentId, paymentSessionId, signature: validSignature },
        ""
      )
    ).toThrow(ZohoConfigurationError)
  })

  it("signs empty identifiers without crashing", () => {
    expect(
      isValidZohoWidgetResponseSignature(
        {
          paymentId: "",
          paymentSessionId: "",
          signature: hmac("|"),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })
})

describe("isValidZohoHostedCheckoutSignature", () => {
  const baseInput = {
    paymentsSessionId: "sess_789",
    paymentSessionStatus: "succeeded",
  }

  it("accepts a signature with every optional field absent", () => {
    const message = "sess_789.succeeded........"

    expect(
      isValidZohoHostedCheckoutSignature(
        { ...baseInput, signature: hmac(message) },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("rejects a signature over the wrong number of empty fields", () => {
    const message = "sess_789.succeeded......."

    expect(
      isValidZohoHostedCheckoutSignature(
        { ...baseInput, signature: hmac(message) },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("dot-joins every return-URL field in order", () => {
    const message =
      "sess_789.succeeded.pay_123.succeeded.1499.00.cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          paymentId: "pay_123",
          paymentStatus: "succeeded",
          amount: "1499.00",
          udf1: "cart_1",
          udf2: "order_2",
          udf3: "customer_3",
          udf4: "utm_4",
          udf5: "gw_5",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("keeps empty placeholders for omitted optional fields", () => {
    const message = "sess_789.succeeded.pay_123..1499.00....."

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          paymentId: "pay_123",
          amount: "1499.00",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("treats explicitly empty optional fields like absent fields", () => {
    const message = "sess_789.succeeded........"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          paymentId: "",
          paymentStatus: "",
          amount: "",
          udf1: "",
          udf2: "",
          udf3: "",
          udf4: "",
          udf5: "",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("rejects a signature produced with a different key", () => {
    const message = "sess_789.succeeded........"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          signature: hmac(message, OTHER_SIGNING_KEY),
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it("rejects a mismatched field value", () => {
    const message =
      "sess_789.succeeded.pay_999.succeeded.1499.00.cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          paymentId: "pay_123",
          paymentStatus: "succeeded",
          amount: "1499.00",
          udf1: "cart_1",
          udf2: "order_2",
          udf3: "customer_3",
          udf4: "utm_4",
          udf5: "gw_5",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })

  it.each(["", "abc", "z".repeat(64), "0".repeat(64)])(
    "rejects malformed or mismatched signature %j",
    (signature) => {
      expect(
        isValidZohoHostedCheckoutSignature({ ...baseInput, signature }, SIGNING_KEY)
      ).toBe(false)
    }
  )

  it("throws when the signing key is missing", () => {
    expect(() =>
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          signature: hmac("sess_789.succeeded........"),
        },
        ""
      )
    ).toThrow(ZohoConfigurationError)
  })
})

describe("hosted checkout mandate handling", () => {
  const baseInput = {
    paymentsSessionId: "sess_789",
    paymentSessionStatus: "succeeded",
    paymentId: "pay_123",
    paymentStatus: "succeeded",
    amount: "1499.00",
    udf1: "cart_1",
    udf2: "order_2",
    udf3: "customer_3",
    udf4: "utm_4",
    udf5: "gw_5",
  }

  it("accepts the India layout with a mandate ID", () => {
    const message =
      "sess_789.succeeded.pay_123.succeeded.1499.00.mandate_1.cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          mandateId: "mandate_1",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts the India layout when mandate_id is absent from the return URL", () => {
    const message =
      "sess_789.succeeded.pay_123.succeeded.1499.00..cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        { ...baseInput, signature: hmac(message) },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("accepts the US layout without a mandate field", () => {
    const message =
      "sess_789.succeeded.pay_123.succeeded.1499.00.cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        { ...baseInput, signature: hmac(message) },
        SIGNING_KEY
      )
    ).toBe(true)
  })

  it("rejects a mandate signature with the wrong mandate value", () => {
    const message =
      "sess_789.succeeded.pay_123.succeeded.1499.00.other_mandate.cart_1.order_2.customer_3.utm_4.gw_5"

    expect(
      isValidZohoHostedCheckoutSignature(
        {
          ...baseInput,
          mandateId: "mandate_1",
          signature: hmac(message),
        },
        SIGNING_KEY
      )
    ).toBe(false)
  })
})

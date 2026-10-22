/* eslint-disable @typescript-eslint/require-await -- fake client handlers return promises directly */
import { MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import { ZohoApiError } from "../../src/core/errors"
import { buildZohoSessionData } from "../../src/providers/zoho/session-data"
import {
  NOW,
  captureMedusaError,
  createClient,
  createHarness,
  createPayment,
  createSession,
  sequence,
} from "../fixtures/providers"

function freshSessionData(
  overrides: Partial<Parameters<typeof buildZohoSessionData>[0]> = {},
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildZohoSessionData({
      zohoSessionId: "zoho_sess_1",
      checkoutMode: "widget",
      amount: "100.00",
      currencyCode: "INR",
      currencySymbol: "₹",
      description: "Medusa order payment",
      invoiceNumber: "payses_1",
      expiresAt: NOW + 900_000,
      medusaSessionId: "payses_1",
      ...overrides,
    }),
    ...extra,
  }
}

describe("ZohoPaymentProviderService.updatePayment", () => {
  it("reuses a matching fresh session without calling Zoho", async () => {
    const harness = createHarness()
    const data = freshSessionData()

    const result = await harness.provider.updatePayment({
      amount: 100,
      currency_code: "INR",
      data,
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(result.data).toEqual(data)
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })

  it("recreates a session when the amount changes", async () => {
    const harness = createHarness()
    const data = freshSessionData({ expiresAt: NOW - 1 })

    const result = await harness.provider.updatePayment({
      amount: 250,
      currency_code: "INR",
      data,
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(harness.client.createPaymentSessionCalls).toHaveLength(1)
    expect(harness.client.createPaymentSessionCalls[0]).toMatchObject({
      amount: "250.00",
      currency: "INR",
      invoiceNumber: "payses_1",
      referenceNumber: "payses_1",
      metadata: [{ key: "medusa_session_id", value: "payses_1" }],
    })
    expect(result.data).toMatchObject({
      zohoSessionId: "zoho_sess_1",
      previousZohoSessionIds: ["zoho_sess_1"],
    })
  })

  it("recreates a session when the currency changes", async () => {
    const harness = createHarness()
    const data = freshSessionData()

    const result = await harness.provider.updatePayment({
      amount: 100,
      currency_code: "USD",
      data,
    })

    expect(harness.client.createPaymentSessionCalls[0]).toMatchObject({
      amount: "100.00",
      currency: "USD",
    })
    expect(result.data).toMatchObject({
      currencyCode: "USD",
      currencySymbol: "$",
    })
  })

  it("rejects updating a session that already has a payment", async () => {
    const harness = createHarness()
    const data = freshSessionData({}, { paymentId: "zoho_pay_1" })

    const error = await captureMedusaError(
      harness.provider.updatePayment({
        amount: 100,
        currency_code: "INR",
        data,
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("after payment")
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })

  it("rejects updating a captured session even if paymentId is absent", async () => {
    const harness = createHarness()
    const data = freshSessionData({}, { paymentStatus: "succeeded" })

    const error = await captureMedusaError(
      harness.provider.updatePayment({
        amount: 100,
        currency_code: "INR",
        data,
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })

  it("validates the amount when a new session is required", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.updatePayment({
        amount: 0,
        currency_code: "INR",
        data: {},
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })
})

describe("ZohoPaymentProviderService.authorizePayment", () => {
  it("authorizes through a stored payment ID", async () => {
    const harness = createHarness()

    const result = await harness.provider.authorizePayment({
      data: { paymentId: "zoho_pay_1", medusaSessionId: "payses_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({
      paymentId: "zoho_pay_1",
      paymentStatus: "succeeded",
      medusaSessionId: "payses_1",
    })
    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    expect(harness.client.retrievePaymentSessionCalls).toEqual([])
  })

  it.each([
    ["refunded", PaymentSessionStatus.CAPTURED],
    ["partially_refunded", PaymentSessionStatus.CAPTURED],
    ["disputed", PaymentSessionStatus.CAPTURED],
    ["pending", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["failed", PaymentSessionStatus.ERROR],
    ["blocked", PaymentSessionStatus.ERROR],
    ["canceled", PaymentSessionStatus.CANCELED],
    ["unknown_status", PaymentSessionStatus.PENDING],
  ])("maps payment status %s", async (status, expected) => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, status }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { paymentId: "zoho_pay_1" },
    })

    expect(result.status).toBe(expected)
    expect(result.data).toMatchObject({ paymentStatus: status })
  })

  it("captures a succeeded session and records its successful payment", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            status: "succeeded",
            payments: [
              { payment_id: "zoho_pay_failed", status: "failed" },
              { payment_id: "zoho_pay_1", status: "succeeded" },
            ],
          }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({
      paymentId: "zoho_pay_1",
      paymentStatus: "succeeded",
    })
  })

  it("falls back to the first payment when the succeeded payment has no status", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            status: "succeeded",
            payments: [{ payment_id: "zoho_pay_first" }],
          }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({ paymentId: "zoho_pay_first" })
  })

  it("omits paymentId for a succeeded session without payments", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            status: "succeeded",
            payments: undefined,
          }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).not.toHaveProperty("paymentId")
  })

  it("polls a pending session until it succeeds", async () => {
    const nextSession = sequence(
      createSession({ status: "pending" }),
      createSession({ status: "pending" }),
      createSession({
        status: "succeeded",
        payments: [{ payment_id: "zoho_pay_1", status: "succeeded" }],
      })
    )
    const harness = createHarness({
      options: { pollAttempts: 3, pollIntervalMs: 250 },
      client: createClient({
        retrievePaymentSession: async () => nextSession(),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(harness.client.retrievePaymentSessionCalls).toHaveLength(3)
    expect(harness.sleepCalls).toEqual([250, 250])
  })

  it("returns pending_authorization after exhausting polling attempts", async () => {
    const harness = createHarness({
      options: { pollAttempts: 2, pollIntervalMs: 500 },
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status: "pending" }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING_AUTHORIZATION)
    expect(harness.client.retrievePaymentSessionCalls).toHaveLength(3)
    expect(harness.sleepCalls).toEqual([500, 500])
  })

  it("uses the default poll interval when configured as zero", async () => {
    const harness = createHarness({
      options: { pollAttempts: 1, pollIntervalMs: 0 },
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status: "pending" }),
      }),
    })

    await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(harness.sleepCalls).toEqual([500])
  })

  it("uses the real sleep function when no dependency is injected", async () => {
    const harness = createHarness({
      useDefaultSleep: true,
      options: { pollAttempts: 1, pollIntervalMs: 1 },
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status: "pending" }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING_AUTHORIZATION)
    expect(harness.client.retrievePaymentSessionCalls).toHaveLength(2)
  })

  it.each([
    ["failed", PaymentSessionStatus.ERROR],
    ["expired", PaymentSessionStatus.CANCELED],
    ["canceled", PaymentSessionStatus.CANCELED],
    ["cancelled", PaymentSessionStatus.CANCELED],
    ["requires_more", PaymentSessionStatus.REQUIRES_MORE],
    ["requires_action", PaymentSessionStatus.REQUIRES_MORE],
    ["created", PaymentSessionStatus.PENDING],
    ["in_progress", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["processing", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["unknown_status", PaymentSessionStatus.PENDING],
  ])("maps terminal and pending session status %s", async (status, expected) => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(expected)
  })

  it("does not poll terminal sessions", async () => {
    const harness = createHarness({
      options: { pollAttempts: 5, pollIntervalMs: 100 },
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status: "failed" }),
      }),
    })

    const result = await harness.provider.authorizePayment({
      data: { zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.ERROR)
    expect(harness.client.retrievePaymentSessionCalls).toHaveLength(1)
    expect(harness.sleepCalls).toEqual([])
  })

  it("rejects when no payment or session ID is available", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.authorizePayment({ data: { unrelated: true } })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("session ID is missing")
    expect(harness.client.retrievePaymentSessionCalls).toHaveLength(0)
  })

  it("translates session retrieval errors", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async () => {
          throw new ZohoApiError("session lookup failed", { statusCode: 500 })
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.authorizePayment({
        data: { zohoSessionId: "zoho_sess_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toBe("Zoho authorize payment failed: session lookup failed")
  })
})

describe("ZohoPaymentProviderService.getPaymentStatus", () => {
  it("retrieves and maps a payment by payment ID", async () => {
    const harness = createHarness()

    const result = await harness.provider.getPaymentStatus({
      data: { paymentId: "zoho_pay_1", custom: "keep" },
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toEqual({
      paymentId: "zoho_pay_1",
      custom: "keep",
      paymentStatus: "succeeded",
    })
    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
  })

  it("prefers the payment ID when both IDs are present", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, status: "pending" }),
      }),
    })

    const result = await harness.provider.getPaymentStatus({
      data: { paymentId: "zoho_pay_1", zohoSessionId: "zoho_sess_1" },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING_AUTHORIZATION)
    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    expect(harness.client.retrievePaymentSessionCalls).toEqual([])
  })

  it.each([
    ["succeeded", PaymentSessionStatus.CAPTURED],
    ["pending", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["requires_more", PaymentSessionStatus.REQUIRES_MORE],
    ["failed", PaymentSessionStatus.ERROR],
    ["expired", PaymentSessionStatus.CANCELED],
    ["canceled", PaymentSessionStatus.CANCELED],
    ["unknown_status", PaymentSessionStatus.PENDING],
  ])("maps session status %s", async (status, expected) => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({ payments_session_id: sessionId, status }),
      }),
    })

    const result = await harness.provider.getPaymentStatus({
      data: { zohoSessionId: "zoho_sess_1", custom: "keep" },
    })

    expect(result.status).toBe(expected)
    expect(result.data).toMatchObject({
      zohoSessionId: "zoho_sess_1",
      custom: "keep",
      paymentStatus: status,
    })
  })

  it("returns pending when no identifiers are available", async () => {
    const harness = createHarness()

    const result = await harness.provider.getPaymentStatus({
      data: { custom: "keep" },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(result.data).toEqual({ custom: "keep" })
    expect(harness.client.retrievePaymentCalls).toEqual([])
    expect(harness.client.retrievePaymentSessionCalls).toEqual([])
  })

  it("translates payment lookup errors", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async () => {
          throw new ZohoApiError("payment lookup failed")
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.getPaymentStatus({
        data: { paymentId: "zoho_pay_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("payment lookup failed")
  })
})

describe("ZohoPaymentProviderService.retrievePayment", () => {
  it("retrieves a payment and merges its status", async () => {
    const harness = createHarness()

    const result = await harness.provider.retrievePayment({
      data: { paymentId: "zoho_pay_1", custom: "keep" },
    })

    expect(result.data).toEqual({
      paymentId: "zoho_pay_1",
      custom: "keep",
      paymentStatus: "succeeded",
    })
    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
  })

  it("retrieves a payment session when only the session ID is known", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            status: "pending",
          }),
      }),
    })

    const result = await harness.provider.retrievePayment({
      data: { zohoSessionId: "zoho_sess_1", custom: "keep" },
    })

    expect(result.data).toEqual({
      zohoSessionId: "zoho_sess_1",
      custom: "keep",
      paymentStatus: "pending",
    })
    expect(harness.client.retrievePaymentSessionCalls).toEqual(["zoho_sess_1"])
  })

  it("returns the input data when no identifiers are available", async () => {
    const harness = createHarness()

    const result = await harness.provider.retrievePayment({
      data: { custom: "keep" },
    })

    expect(result.data).toEqual({ custom: "keep" })
    expect(harness.client.retrievePaymentCalls).toEqual([])
    expect(harness.client.retrievePaymentSessionCalls).toEqual([])
  })

  it("translates session lookup errors", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async () => {
          throw new ZohoApiError("session lookup failed")
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.retrievePayment({
        data: { zohoSessionId: "zoho_sess_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("retrieve payment")
  })
})

describe("ZohoPaymentProviderService security invariants", () => {
  it("rejects an injected payment ID that belongs to another Medusa session", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({
            payment_id: paymentId,
            reference_number: "other_session",
            meta_data: [{ key: "medusa_session_id", value: "other_session" }],
          }),
      }),
    })
    const data = freshSessionData({}, { paymentId: "zoho_pay_1" })

    const error = await captureMedusaError(harness.provider.authorizePayment({ data }))

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("does not belong")
  })

  it("rejects a payment whose amount does not match the session", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, amount: "99.00" }),
      }),
    })
    const data = freshSessionData({}, { paymentId: "zoho_pay_1" })

    const error = await captureMedusaError(harness.provider.authorizePayment({ data }))

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("amount or currency")
  })

  it("rejects a session owned by another Medusa session", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            reference_number: "other_session",
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.authorizePayment({ data: freshSessionData() })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("does not belong")
  })

  it("rejects a session whose currency does not match the cart", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            currency: "USD",
            reference_number: "payses_1",
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.authorizePayment({ data: freshSessionData() })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("amount or currency")
  })

  it("rejects a refund larger than the captured payment", async () => {
    const harness = createHarness()
    const data = freshSessionData({}, { paymentId: "zoho_pay_1" })

    const error = await captureMedusaError(
      harness.provider.refundPayment({ amount: 150, data })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("exceeds")
    expect(harness.client.createRefundCalls).toHaveLength(0)
  })

  it("rejects an amount below the currency precision", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 0.001,
        currency_code: "INR",
        data: { session_id: "payses_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })
})

describe("ZohoPaymentProviderService.getPaymentStatus ownership", () => {
  it("rejects a payment ID owned by another session", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({
            payment_id: paymentId,
            reference_number: "other_session",
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.getPaymentStatus({
        data: freshSessionData({}, { paymentId: "zoho_pay_1" }),
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("does not belong")
  })

  it("rejects a session ID owned by another session", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePaymentSession: async (sessionId) =>
          createSession({
            payments_session_id: sessionId,
            reference_number: "other_session",
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.getPaymentStatus({ data: freshSessionData() })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("does not belong")
  })
})

describe("ZohoPaymentProviderService amount parsing", () => {
  it("rejects a non-numeric amount returned by Zoho", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, amount: "not-a-number" }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.authorizePayment({
        data: freshSessionData({}, { paymentId: "zoho_pay_1" }),
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("Invalid payment amount")
  })
})

describe("ZohoPaymentProviderService missing resource amount", () => {
  it("rejects a payment response with no amount", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({
            payment_id: paymentId,
            amount: undefined as unknown as string,
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.authorizePayment({
        data: freshSessionData({}, { paymentId: "zoho_pay_1" }),
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("Invalid payment amount")
  })
})

/* eslint-disable @typescript-eslint/require-await -- fake client handlers return promises directly */
import { MedusaError } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import { ZohoApiError } from "../../src/core/errors"
import {
  captureMedusaError,
  createClient,
  createHarness,
  createPayment,
  createRefund,
  sequence,
} from "../fixtures/providers"

describe("ZohoPaymentProviderService.capturePayment", () => {
  it.each(["succeeded", "refunded", "partially_refunded", "disputed"])(
    "succeeds for captured Zoho payment status %s",
    async (status) => {
      const harness = createHarness({
        client: createClient({
          retrievePayment: async (paymentId) =>
            createPayment({ payment_id: paymentId, status }),
        }),
      })

      const result = await harness.provider.capturePayment({
        data: { paymentId: "zoho_pay_1", custom: "keep" },
      })

      expect(result.data).toEqual({
        paymentId: "zoho_pay_1",
        custom: "keep",
        paymentStatus: status,
      })
      expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    }
  )

  it.each(["failed", "blocked"])("rejects Zoho payment status %s", async (status) => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, status }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.capturePayment({
        data: { paymentId: "zoho_pay_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain(status)
  })

  it("rejects a payment that is not captured yet", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, status: "pending" }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.capturePayment({ data: { paymentId: "zoho_pay_1" } })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("captures successful payments automatically")
  })

  it("requires a payment ID", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.capturePayment({ data: { zohoSessionId: "zoho_sess_1" } })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("payment ID is missing")
    expect(harness.client.retrievePaymentCalls).toEqual([])
  })

  it("translates payment lookup errors", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async () => {
          throw new ZohoApiError("capture lookup failed")
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.capturePayment({ data: { paymentId: "zoho_pay_1" } })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("capture lookup failed")
  })
})

describe("ZohoPaymentProviderService.cancelPayment", () => {
  it("is a no-op when there is no payment ID", async () => {
    const harness = createHarness()
    const data = { zohoSessionId: "zoho_sess_1", custom: "keep" }

    const result = await harness.provider.cancelPayment({ data })

    expect(result.data).toEqual(data)
    expect(harness.client.retrievePaymentCalls).toEqual([])
  })

  it.each(["succeeded", "refunded", "partially_refunded", "disputed"])(
    "rejects cancelling a captured payment (%s)",
    async (status) => {
      const harness = createHarness({
        client: createClient({
          retrievePayment: async (paymentId) =>
            createPayment({ payment_id: paymentId, status }),
        }),
      })

      const error = await captureMedusaError(
        harness.provider.cancelPayment({ data: { paymentId: "zoho_pay_1" } })
      )

      expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
      expect(error.message).toContain("refund the payment")
    }
  )

  it.each(["failed", "blocked"])(
    "is a no-op for a failed payment (%s)",
    async (status) => {
      const harness = createHarness({
        client: createClient({
          retrievePayment: async (paymentId) =>
            createPayment({ payment_id: paymentId, status }),
        }),
      })
      const data = { paymentId: "zoho_pay_1", custom: "keep" }

      const result = await harness.provider.cancelPayment({ data })

      expect(result.data).toEqual(data)
      expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    }
  )

  it.each(["pending", "initiated", "in_progress", "processing", "unknown"])(
    "rejects cancelling a non-terminal payment (%s)",
    async (status) => {
      const harness = createHarness({
        client: createClient({
          retrievePayment: async (paymentId) =>
            createPayment({ payment_id: paymentId, status }),
        }),
      })

      const error = await captureMedusaError(
        harness.provider.cancelPayment({ data: { paymentId: "zoho_pay_1" } })
      )

      expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
      expect(error.message).toContain("cannot be cancelled")
    }
  )

  it("translates payment lookup errors", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async () => {
          throw new ZohoApiError("cancel lookup failed")
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.cancelPayment({ data: { paymentId: "zoho_pay_1" } })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("cancel lookup failed")
  })
})

describe("ZohoPaymentProviderService.refundPayment", () => {
  it("refunds in the session currency and records the refund", async () => {
    const harness = createHarness()
    const data = {
      paymentId: "zoho_pay_1",
      medusaSessionId: "payses_1",
      currencyCode: "INR",
      custom: "keep",
    }

    const result = await harness.provider.refundPayment({
      amount: 50,
      data,
      context: { idempotency_key: "refund-key-1" },
    })

    expect(harness.client.createRefundCalls).toHaveLength(1)
    expect(harness.client.createRefundCalls[0]).toEqual({
      paymentId: "zoho_pay_1",
      input: {
        amount: "50.00",
        description: "Refund for Medusa payment zoho_pay_1",
        metadata: [{ key: "medusa_session_id", value: "payses_1" }],
      },
    })
    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    expect(result.data).toEqual({
      paymentId: "zoho_pay_1",
      medusaSessionId: "payses_1",
      currencyCode: "INR",
      custom: "keep",
      lastRefundId: "zoho_refund_1",
      lastRefundStatus: "succeeded",
      lastRefundIdempotencyKey: "refund-key-1",
    })
  })

  it("refunds without metadata when the Medusa session ID is unavailable", async () => {
    const harness = createHarness()

    await harness.provider.refundPayment({
      amount: 10,
      data: { paymentId: "zoho_pay_1", currencyCode: "USD" },
    })

    expect(harness.client.createRefundCalls[0]?.input.metadata).toBeUndefined()
    expect(harness.client.createRefundCalls[0]?.input.amount).toBe("10.00")
  })

  it("falls back to the payment currency when session data has none", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({
            payment_id: paymentId,
            currency: "USD",
            amount: "50.00",
          }),
      }),
    })

    const result = await harness.provider.refundPayment({
      amount: 50,
      data: { paymentId: "zoho_pay_1" },
    })

    expect(harness.client.retrievePaymentCalls).toEqual(["zoho_pay_1"])
    expect(harness.client.createRefundCalls[0]?.input.amount).toBe("50.00")
    expect(result.data).toMatchObject({ lastRefundId: "zoho_refund_1" })
  })

  it("uses the currency's fraction digits when falling back", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, currency: "JPY", amount: "1000" }),
        createRefund: async (paymentId, input) =>
          createRefund({ payment_id: paymentId, amount: input.amount }),
      }),
    })

    await harness.provider.refundPayment({
      amount: 1000,
      data: { paymentId: "zoho_pay_1" },
    })

    expect(harness.client.createRefundCalls[0]?.input.amount).toBe("1000")
  })

  it("rejects a failed refund and includes Zoho's reason", async () => {
    const harness = createHarness({
      client: createClient({
        createRefund: async (paymentId) =>
          createRefund({
            payment_id: paymentId,
            status: "failed",
            failure_reason: "insufficient funds",
          }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount: 50,
        data: { paymentId: "zoho_pay_1", currencyCode: "INR" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("insufficient funds")
  })

  it("rejects a failed refund without a reason", async () => {
    const harness = createHarness({
      client: createClient({
        createRefund: async (paymentId) =>
          createRefund({ payment_id: paymentId, status: "FAILED" }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount: 50,
        data: { paymentId: "zoho_pay_1", currencyCode: "INR" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("Zoho refund failed")
    expect(error.message.endsWith("Zoho refund failed")).toBe(true)
  })

  it.each([
    ["zero", 0],
    ["negative", -10],
  ])("rejects a %s refund amount", async (_label, amount) => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount,
        data: { paymentId: "zoho_pay_1", currencyCode: "INR" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("greater than zero")
    expect(harness.client.createRefundCalls).toEqual([])
  })

  it("requires a payment ID", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount: 50,
        data: { zohoSessionId: "zoho_sess_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("payment ID is missing")
    expect(harness.client.createRefundCalls).toEqual([])
  })

  it("replays a refund for the same idempotency key without calling Zoho", async () => {
    const harness = createHarness()
    const data = {
      paymentId: "zoho_pay_1",
      currencyCode: "INR",
      lastRefundId: "zoho_refund_existing",
      lastRefundStatus: "succeeded",
      lastRefundIdempotencyKey: "refund-key-1",
      custom: "keep",
    }

    const result = await harness.provider.refundPayment({
      amount: 50,
      data,
      context: { idempotency_key: "refund-key-1" },
    })

    expect(result.data).toEqual(data)
    expect(harness.client.createRefundCalls).toEqual([])
  })

  it("creates a new refund when the key matches but no prior refund ID exists", async () => {
    const harness = createHarness()

    await harness.provider.refundPayment({
      amount: 50,
      data: {
        paymentId: "zoho_pay_1",
        currencyCode: "INR",
        lastRefundIdempotencyKey: "refund-key-1",
      },
      context: { idempotency_key: "refund-key-1" },
    })

    expect(harness.client.createRefundCalls).toHaveLength(1)
  })

  it("does not replay an older key after an unkeyed refund", async () => {
    const refunds = sequence(
      createRefund({ refund_id: "zoho_refund_1" }),
      createRefund({ refund_id: "zoho_refund_2" }),
      createRefund({ refund_id: "zoho_refund_3" })
    )
    const harness = createHarness({
      client: createClient({
        createRefund: async () => refunds(),
      }),
    })
    const base = { paymentId: "zoho_pay_1", currencyCode: "INR" }

    const first = await harness.provider.refundPayment({
      amount: 10,
      data: base,
      context: { idempotency_key: "refund-key-1" },
    })
    const second = await harness.provider.refundPayment({
      amount: 10,
      data: first.data,
    })
    const third = await harness.provider.refundPayment({
      amount: 10,
      data: second.data,
      context: { idempotency_key: "refund-key-1" },
    })

    expect(harness.client.createRefundCalls).toHaveLength(3)
    expect(first.data).toMatchObject({
      lastRefundId: "zoho_refund_1",
      lastRefundIdempotencyKey: "refund-key-1",
    })
    expect(second.data).toMatchObject({ lastRefundId: "zoho_refund_2" })
    expect(second.data).not.toHaveProperty("lastRefundIdempotencyKey")
    expect(third.data).toMatchObject({
      lastRefundId: "zoho_refund_3",
      lastRefundIdempotencyKey: "refund-key-1",
    })
  })

  it("translates refund API errors", async () => {
    const harness = createHarness({
      client: createClient({
        createRefund: async () => {
          throw new ZohoApiError("refund failed at Zoho")
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount: 50,
        data: { paymentId: "zoho_pay_1", currencyCode: "INR" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toContain("refund failed at Zoho")
  })
})

describe("ZohoPaymentProviderService.deletePayment", () => {
  it("is a local no-op that preserves data", async () => {
    const harness = createHarness()
    const data = { zohoSessionId: "zoho_sess_1", custom: "keep" }

    const result = await harness.provider.deletePayment({ data })

    expect(result.data).toEqual(data)
    expect(harness.client.createPaymentSessionCalls).toEqual([])
    expect(harness.client.retrievePaymentSessionCalls).toEqual([])
    expect(harness.client.retrievePaymentCalls).toEqual([])
    expect(harness.logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "debug",
          message: "Deleting local Zoho payment session reference",
        }),
      ])
    )
  })
})

describe("asynchronous refunds and unsafe states", () => {
  it("returns a pending refund and logs the asynchronous status", async () => {
    const harness = createHarness({
      client: createClient({
        createRefund: async (paymentId, input) =>
          createRefund({
            payment_id: paymentId,
            amount: input.amount,
            status: "pending",
          }),
      }),
    })

    const result = await harness.provider.refundPayment({
      amount: 50,
      data: { paymentId: "zoho_pay_1" },
    })

    expect(result.data?.lastRefundStatus).toBe("pending")
    expect(harness.logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: "Zoho refund is asynchronous",
        }),
      ])
    )
  })

  it("rejects a refund for a payment that is not captured", async () => {
    const harness = createHarness({
      client: createClient({
        retrievePayment: async (paymentId) =>
          createPayment({ payment_id: paymentId, status: "pending" }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.refundPayment({
        amount: 10,
        data: { paymentId: "zoho_pay_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("Cannot refund")
  })

  it("retries a refund when the previous attempt failed", async () => {
    const harness = createHarness()
    const result = await harness.provider.refundPayment({
      amount: 10,
      data: {
        paymentId: "zoho_pay_1",
        lastRefundId: "zoho_refund_old",
        lastRefundStatus: "failed",
        lastRefundIdempotencyKey: "refund-key",
      },
      context: { idempotency_key: "refund-key" },
    })

    expect(result.data?.lastRefundId).toBe("zoho_refund_1")
    expect(harness.client.createRefundCalls).toHaveLength(1)
  })
})

describe("capture ownership", () => {
  it("verifies the payment belongs to the Medusa session before capture", async () => {
    const harness = createHarness()

    const result = await harness.provider.capturePayment({
      data: {
        paymentId: "zoho_pay_1",
        medusaSessionId: "payses_1",
        amount: "100.00",
        currencyCode: "INR",
      },
    })

    expect(result.data?.paymentId).toBe("zoho_pay_1")
  })

  it("rejects a capture when the payment belongs to another session", async () => {
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
      harness.provider.capturePayment({
        data: {
          paymentId: "zoho_pay_1",
          medusaSessionId: "payses_1",
          amount: "100.00",
          currencyCode: "INR",
        },
      })
    )

    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.message).toContain("does not belong")
  })
})

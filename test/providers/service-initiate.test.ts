/* eslint-disable @typescript-eslint/require-await -- fake client handlers return promises directly */
import { MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  ZohoApiError,
  ZohoConfigurationError,
  ZohoPaymentStateError,
  ZohoUnsupportedOperationError,
} from "../../src/core/errors"
import { buildZohoSessionData } from "../../src/providers/zoho/session-data"
import {
  NOW,
  SIGNING_KEY,
  captureMedusaError,
  createClient,
  createHarness,
  createSession,
  sequence,
} from "../fixtures/providers"

describe("ZohoPaymentProviderService.initiatePayment", () => {
  it("formats INR, sends widget correlation data, and returns session data", async () => {
    const harness = createHarness({
      options: {
        metadata: { order_id: "ord_1" },
        allowedPaymentMethods: ["card", "upi"],
        paymentDescription: "Custom description",
      },
    })
    const inputData = { session_id: "payses_1", custom: "keep-me" }

    const result = await harness.provider.initiatePayment({
      amount: 1234.5,
      currency_code: "inr",
      data: inputData,
      context: {
        customer: {
          id: "cust_1",
          email: "customer@example.test",
          phone: "9999999999",
        },
      },
    })

    expect(result.id).toBe("zoho_sess_1")
    expect(result.status).toBe(PaymentSessionStatus.PENDING)

    expect(harness.client.createPaymentSessionCalls).toHaveLength(1)
    const createInput = harness.client.createPaymentSessionCalls[0]
    expect(createInput).toEqual({
      amount: "1234.50",
      currency: "INR",
      description: "Custom description",
      invoiceNumber: "payses_1",
      referenceNumber: "payses_1",
      metadata: [
        { key: "medusa_session_id", value: "payses_1" },
        { key: "order_id", value: "ord_1" },
      ],
      allowedPaymentMethods: ["card", "upi"],
      hostedCheckout: undefined,
    })

    expect(result.data).toEqual({
      session_id: "payses_1",
      custom: "keep-me",
      zohoSessionId: "zoho_sess_1",
      checkoutMode: "widget",
      amount: "1234.50",
      currencyCode: "INR",
      currencySymbol: "₹",
      description: "Custom description",
      invoiceNumber: "payses_1",
      expiresAt: NOW + 900_000,
      medusaSessionId: "payses_1",
      widget: {
        accountId: "acct_in",
        domain: "IN",
        apiKey: "widget_api_key",
      },
    })

    // The caller's object must not be mutated, and no server secret may leak into
    // the data Medusa exposes to the storefront.
    expect(inputData).toEqual({ session_id: "payses_1", custom: "keep-me" })
    const serialized = JSON.stringify(result.data)
    expect(serialized).not.toContain("client_secret")
    expect(serialized).not.toContain("refresh_token")
    expect(serialized).not.toContain(SIGNING_KEY)
  })

  it("never invents Zoho-session metadata before the session exists", async () => {
    const harness = createHarness({ options: { metadata: { order_id: "ord_1" } } })

    await harness.provider.initiatePayment({
      amount: 50,
      currency_code: "INR",
      data: { session_id: "payses_1" },
    })

    const metadata = harness.client.createPaymentSessionCalls[0]?.metadata ?? []
    expect(metadata.map((entry) => entry.key)).toEqual([
      "medusa_session_id",
      "order_id",
    ])
    expect(metadata).not.toContainEqual(
      expect.objectContaining({ key: "zoho_session_id" })
    )
  })

  it("uses the US region and currency symbol overrides", async () => {
    const harness = createHarness({
      options: {
        region: "us",
        currencySymbols: { usd: "US$" },
      },
    })

    const result = await harness.provider.initiatePayment({
      amount: 10,
      currency_code: "usd",
      data: { session_id: "payses_us" },
    })

    expect(harness.client.createPaymentSessionCalls[0]).toMatchObject({
      amount: "10.00",
      currency: "USD",
      invoiceNumber: "payses_us",
      referenceNumber: "payses_us",
    })
    expect(result.data).toMatchObject({
      currencyCode: "USD",
      currencySymbol: "US$",
      widget: {
        accountId: "acct_in",
        domain: "US",
        apiKey: "widget_api_key",
      },
    })
  })

  it("falls back to a generated invoice number without inventing a reference", async () => {
    const harness = createHarness({ options: { metadata: { order_id: "ord_1" } } })

    const result = await harness.provider.initiatePayment({
      amount: 50,
      currency_code: "INR",
      data: {},
    })

    const createInput = harness.client.createPaymentSessionCalls[0]
    expect(createInput?.invoiceNumber).toBe(`zoho_${NOW}`)
    expect(createInput?.referenceNumber).toBeUndefined()
    expect(createInput?.metadata).toEqual([{ key: "order_id", value: "ord_1" }])
    expect(result.data).toMatchObject({
      invoiceNumber: `zoho_${NOW}`,
    })
    expect(result.data).not.toHaveProperty("medusaSessionId")
  })

  it("truncates long Medusa session IDs while keeping the full metadata value", async () => {
    const harness = createHarness()
    const longSessionId = `payses_${"x".repeat(80)}`

    const result = await harness.provider.initiatePayment({
      amount: 50,
      currency_code: "INR",
      data: { session_id: longSessionId },
    })

    const createInput = harness.client.createPaymentSessionCalls[0]
    expect(createInput?.invoiceNumber).toHaveLength(50)
    expect(createInput?.referenceNumber).toHaveLength(50)
    expect(createInput?.metadata).toEqual([
      { key: "medusa_session_id", value: longSessionId },
    ])
    expect(result.data).toMatchObject({
      invoiceNumber: longSessionId.slice(0, 50),
      medusaSessionId: longSessionId,
    })
  })

  it("creates hosted checkout with return URLs and customer prefill", async () => {
    const harness = createHarness({
      options: {
        checkoutMode: "hosted",
        apiKey: undefined,
        region: "us",
        successUrl: "https://shop.example.test/success",
        failureUrl: "https://shop.example.test/failure",
        hostedCheckoutBaseUrl: "https://checkout.example.test/base/",
        paymentDescription: "Hosted order payment",
      },
      client: createClient({
        createPaymentSession: async (input) =>
          createSession({
            payments_session_id: "zoho_hosted_1",
            amount: input.amount,
            currency: input.currency,
            access_key: "access/key",
          }),
      }),
    })

    const result = await harness.provider.initiatePayment({
      amount: 10,
      currency_code: "USD",
      data: { session_id: "payses_hosted" },
      context: {
        customer: {
          id: "cust_1",
          email: "hosted@example.test",
          phone: null,
        },
      },
    })

    expect(harness.client.createPaymentSessionCalls[0]).toMatchObject({
      invoiceNumber: "payses_hosted",
      referenceNumber: "payses_hosted",
      hostedCheckout: {
        successUrl: "https://shop.example.test/success",
        failureUrl: "https://shop.example.test/failure",
        email: "hosted@example.test",
        phone: undefined,
        description: "Hosted order payment",
      },
    })

    expect(result.data).toMatchObject({
      zohoSessionId: "zoho_hosted_1",
      checkoutMode: "hosted",
      checkoutUrl: "https://checkout.example.test/base/access%2Fkey",
    })
    expect(result.data).not.toHaveProperty("widget")
  })

  it("fails when Zoho does not return a hosted-checkout access key", async () => {
    const harness = createHarness({
      options: {
        checkoutMode: "hosted",
        apiKey: undefined,
        successUrl: "https://shop.example.test/success",
        failureUrl: "https://shop.example.test/failure",
      },
      client: createClient({
        createPaymentSession: async () =>
          createSession({ payments_session_id: "zoho_hosted_1" }),
      }),
    })

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 10,
        currency_code: "INR",
        data: { session_id: "payses_hosted" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("hosted-checkout access key")
  })

  it("creates a clean session and ignores caller-injected provider fields", async () => {
    const harness = createHarness()
    const result = await harness.provider.initiatePayment({
      amount: 100,
      currency_code: "INR",
      data: {
        session_id: "payses_1",
        paymentId: "zoho_pay_attacker",
        paymentStatus: "succeeded",
        zohoSessionId: "zoho_sess_attacker",
        amount: "0.01",
      },
    })

    expect(harness.client.createPaymentSessionCalls).toHaveLength(1)
    expect(result.data?.paymentId).toBeUndefined()
    expect(result.data?.paymentStatus).toBeUndefined()
    expect(result.data).toMatchObject({
      zohoSessionId: "zoho_sess_1",
      medusaSessionId: "payses_1",
    })
    expect(result.data?.amount).toBe("100.00")
  })

  it("recreates the session when the cart amount changes and records previous IDs", async () => {
    const ids = sequence("zoho_sess_old", "zoho_sess_new")
    const harness = createHarness({
      client: createClient({
        createPaymentSession: async (input) =>
          createSession({
            payments_session_id: ids(),
            amount: input.amount,
            currency: input.currency,
          }),
      }),
    })

    const first = await harness.provider.initiatePayment({
      amount: 100,
      currency_code: "INR",
      data: { session_id: "payses_1" },
    })

    const second = await harness.provider.updatePayment({
      amount: 200,
      currency_code: "INR",
      data: first.data,
    })

    expect(second.data?.zohoSessionId).toBe("zoho_sess_new")
    expect(harness.client.createPaymentSessionCalls).toHaveLength(2)
    expect(harness.client.createPaymentSessionCalls[1]).toMatchObject({
      amount: "200.00",
      currency: "INR",
      invoiceNumber: "payses_1",
      referenceNumber: "payses_1",
      metadata: [{ key: "medusa_session_id", value: "payses_1" }],
    })
    expect(second.data).toMatchObject({
      zohoSessionId: "zoho_sess_new",
      medusaSessionId: "payses_1",
      previousZohoSessionIds: ["zoho_sess_old"],
    })
  })

  it("recreates the session when the currency changes", async () => {
    const ids = sequence("zoho_sess_inr", "zoho_sess_usd")
    const harness = createHarness({
      client: createClient({
        createPaymentSession: async (input) =>
          createSession({
            payments_session_id: ids(),
            amount: input.amount,
            currency: input.currency,
          }),
      }),
    })

    const first = await harness.provider.initiatePayment({
      amount: 100,
      currency_code: "INR",
      data: { session_id: "payses_1" },
    })

    const second = await harness.provider.updatePayment({
      amount: 100,
      currency_code: "USD",
      data: first.data,
    })

    expect(second.data?.zohoSessionId).toBe("zoho_sess_usd")
    expect(second.data).toMatchObject({
      currencyCode: "USD",
      currencySymbol: "$",
      previousZohoSessionIds: ["zoho_sess_inr"],
    })
  })

  it("keeps the Medusa session bridge when only provider-owned data survives an update", async () => {
    const harness = createHarness()
    const staleData = buildZohoSessionData({
      zohoSessionId: "zoho_sess_old",
      checkoutMode: "widget",
      amount: "100.00",
      currencyCode: "INR",
      currencySymbol: "₹",
      description: "Medusa order payment",
      invoiceNumber: "payses_1",
      expiresAt: NOW + 900_000,
      medusaSessionId: "payses_1",
    })

    const result = await harness.provider.updatePayment({
      amount: 250,
      currency_code: "INR",
      data: staleData,
    })

    expect(harness.client.createPaymentSessionCalls[0]).toMatchObject({
      invoiceNumber: "payses_1",
      referenceNumber: "payses_1",
      metadata: [{ key: "medusa_session_id", value: "payses_1" }],
    })
    expect(result.data).toMatchObject({
      zohoSessionId: "zoho_sess_1",
      medusaSessionId: "payses_1",
      previousZohoSessionIds: ["zoho_sess_old"],
    })
  })

  it("uses Zoho's expiry time and falls back when it is missing", async () => {
    const secondsHarness = createHarness({
      client: createClient({
        createPaymentSession: async (input) =>
          createSession({
            amount: input.amount,
            currency: input.currency,
            expiry_time: 1_800_001_234,
          }),
      }),
    })
    const fallbackHarness = createHarness({
      client: createClient({
        createPaymentSession: async (input) =>
          createSession({
            amount: input.amount,
            currency: input.currency,
            expiry_time: undefined,
          }),
      }),
    })

    const seconds = await secondsHarness.provider.initiatePayment({
      amount: 100,
      currency_code: "INR",
      data: { session_id: "payses_1" },
    })
    const fallback = await fallbackHarness.provider.initiatePayment({
      amount: 100,
      currency_code: "INR",
      data: { session_id: "payses_1" },
    })

    expect(seconds.data).toMatchObject({ expiresAt: 1_800_001_234_000 })
    expect(fallback.data).toMatchObject({ expiresAt: NOW + 900_000 })
  })

  it.each([
    ["zero", 0],
    ["negative", -1],
  ])("rejects a %s amount before calling Zoho", async (_label, amount) => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount,
        currency_code: "INR",
        data: { session_id: "payses_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("greater than zero")
    expect(harness.client.createPaymentSessionCalls).toHaveLength(0)
  })

  it("rejects invalid currency codes", async () => {
    const harness = createHarness()

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 100,
        currency_code: "rupees",
        data: { session_id: "payses_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toContain("Invalid ISO-4217 currency code")
  })

  it("translates API errors and logs only safe context", async () => {
    const harness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw new ZohoApiError("Zoho is unavailable", {
            statusCode: 503,
            zohoCode: "SERVICE_UNAVAILABLE",
          })
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: { session_id: "payses_1" },
      })
    )

    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toBe("Zoho initiate payment failed: Zoho is unavailable")

    const log = harness.logger.entries.find((entry) => entry.level === "error")
    expect(log).toMatchObject({
      message: "Zoho initiate payment failed: Zoho is unavailable",
      context: {
        action: "initiate payment",
        code: "ZOHO_API_ERROR",
      },
    })
  })

  it("maps validation and configuration failures to invalid data", async () => {
    const validationHarness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw new ZohoConfigurationError("bad config")
        },
      }),
    })

    const validationError = await captureMedusaError(
      validationHarness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )

    expect(validationError.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(validationError.message).toContain("bad config")
  })

  it("maps state and unsupported failures to not allowed", async () => {
    const stateHarness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw new ZohoPaymentStateError("wrong state")
        },
      }),
    })
    const unsupportedHarness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw new ZohoUnsupportedOperationError("not supported")
        },
      }),
    })

    const stateError = await captureMedusaError(
      stateHarness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )
    const unsupportedError = await captureMedusaError(
      unsupportedHarness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )

    expect(stateError.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(unsupportedError.type).toBe(MedusaError.Types.NOT_ALLOWED)
  })

  it("passes MedusaErrors through unchanged", async () => {
    const original = new MedusaError(MedusaError.Types.INVALID_DATA, "original")
    const harness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw original
        },
      }),
    })

    const error = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )

    expect(error).toBe(original)
  })

  it("handles non-Error thrown values without leaking details", async () => {
    const harness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw new Error("plain failure")
        },
      }),
    })
    const nonError: unknown = { internal: "object" }
    const unknownHarness = createHarness({
      client: createClient({
        createPaymentSession: async () => {
          throw nonError
        },
      }),
    })

    const plain = await captureMedusaError(
      harness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )
    const unknown = await captureMedusaError(
      unknownHarness.provider.initiatePayment({
        amount: 100,
        currency_code: "INR",
        data: {},
      })
    )

    expect(plain.message).toContain("plain failure")
    expect(unknown.message).toContain("Unknown error")
  })
})

describe("ZohoPaymentProviderService defensive configuration guards", () => {
  interface ConfigurableProvider {
    zohoConfig: {
      apiKey?: string
      successUrl?: string
      failureUrl?: string
    }
    getWidgetApiKey(): string
    getHostedCheckoutUrls(): { successUrl: string; failureUrl: string }
  }

  it("throws a typed configuration error if a widget key is absent", () => {
    const provider = createHarness().provider as unknown as ConfigurableProvider
    provider.zohoConfig = {}

    expect(() => provider.getWidgetApiKey()).toThrow(ZohoConfigurationError)
    expect(() => provider.getWidgetApiKey()).toThrow("widget API key is missing")
  })

  it("throws a typed configuration error if hosted URLs are absent", () => {
    const provider = createHarness().provider as unknown as ConfigurableProvider
    provider.zohoConfig = {}

    expect(() => provider.getHostedCheckoutUrls()).toThrow(ZohoConfigurationError)
    expect(() => provider.getHostedCheckoutUrls()).toThrow(
      "successUrl and failureUrl are required"
    )
  })
})

describe("idempotency key fallback", () => {
  it("ignores an empty idempotency key and uses a timestamp invoice", async () => {
    const harness = createHarness()

    const result = await harness.provider.initiatePayment({
      amount: 10,
      currency_code: "INR",
      data: {},
      context: { idempotency_key: "" },
    })

    expect(result.data?.medusaSessionId).toBeUndefined()
    expect(result.data?.invoiceNumber).toMatch(/^zoho_/)
    expect(harness.client.createPaymentSessionCalls[0]?.referenceNumber).toBeUndefined()
  })
})

describe("idempotency key preference", () => {
  it("uses Medusa's context idempotency key as the session bridge", async () => {
    const harness = createHarness()

    const result = await harness.provider.initiatePayment({
      amount: 10,
      currency_code: "INR",
      data: {},
      context: { idempotency_key: "payses_ctx" },
    })

    expect(result.data?.medusaSessionId).toBe("payses_ctx")
    expect(harness.client.createPaymentSessionCalls[0]?.referenceNumber).toBe(
      "payses_ctx"
    )
  })
})

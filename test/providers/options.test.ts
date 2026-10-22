import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZohoConfigurationError, ZohoValidationError } from "../../src/core/errors"
import {
  INDIA_REGION_CONFIG,
  US_REGION_CONFIG,
  resetSigningKeyWarningForTests,
  resolveZohoPaymentOptions,
  validateZohoPaymentOptions,
} from "../../src/providers/zoho/options"
import type { ZohoPaymentOptions } from "../../src/providers/zoho/types"
import type { ZohoPaymentLogger } from "../../src/types"
import { FakeLogger, SIGNING_KEY, baseOptions } from "../fixtures/providers"

function invalid(options: Record<string, unknown>): ZohoPaymentOptions {
  return options as unknown as ZohoPaymentOptions
}

const missingCredentialKeys = [
  "accountId",
  "clientId",
  "clientSecret",
  "refreshToken",
] as const

describe("resolveZohoPaymentOptions", () => {
  beforeEach(() => {
    resetSigningKeyWarningForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults to India, widget mode, and documented numeric defaults", () => {
    const resolved = resolveZohoPaymentOptions(baseOptions())

    expect(resolved.region).toBe("in")
    expect(resolved.regionConfig).toEqual(INDIA_REGION_CONFIG)
    expect(resolved.checkoutMode).toBe("widget")
    expect(resolved.apiKey).toBe("widget_api_key")
    expect(resolved.paymentDescription).toBe("Medusa order payment")
    expect(resolved.timeoutMs).toBe(15_000)
    expect(resolved.maxRetries).toBe(3)
    expect(resolved.retryBaseDelayMs).toBe(500)
    expect(resolved.pollAttempts).toBe(3)
    expect(resolved.pollIntervalMs).toBe(500)
    expect(resolved.webhookToleranceSeconds).toBe(0)
    expect(resolved.currencySymbols).toEqual({})
    expect(resolved.metadata).toEqual({})
    expect(resolved.liveMode).toBeUndefined()
    expect(resolved.successUrl).toBeUndefined()
    expect(resolved.failureUrl).toBeUndefined()
    expect(resolved.businessName).toBeUndefined()
    expect(resolved.allowedPaymentMethods).toBeUndefined()
    expect(resolved.fetch).toBeUndefined()
    expect(resolved.logger).toBeUndefined()
  })

  it("resolves the US region and its widget domain", () => {
    const resolved = resolveZohoPaymentOptions(baseOptions({ region: "us" }))

    expect(resolved.region).toBe("us")
    expect(resolved.regionConfig).toEqual(US_REGION_CONFIG)
    expect(resolved.regionConfig.widgetDomain).toBe("US")
    expect(resolved.regionConfig.apiBaseUrl).toBe("https://payments.zoho.com/api/v1/")
  })

  it("accepts custom data-centre and hosted-checkout URLs", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        apiBaseUrl: "https://api.example.test/v1/",
        accountsBaseUrl: "https://accounts.example.test/oauth/",
        hostedCheckoutBaseUrl: "https://checkout.example.test/base/",
      })
    )

    expect(resolved.regionConfig).toEqual({
      apiBaseUrl: "https://api.example.test/v1/",
      accountsBaseUrl: "https://accounts.example.test/oauth/",
      hostedCheckoutBaseUrl: "https://checkout.example.test/base/",
      widgetDomain: "IN",
    })
  })

  it("trims credentials and rejects blank required credentials", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        accountId: "  acct_trimmed  ",
        clientId: " client ",
        clientSecret: " secret ",
        refreshToken: " refresh ",
      })
    )

    expect(resolved.accountId).toBe("acct_trimmed")
    expect(resolved.clientId).toBe("client")
    expect(resolved.clientSecret).toBe("secret")
    expect(resolved.refreshToken).toBe("refresh")
  })

  it.each(missingCredentialKeys)("requires the %s credential", (key) => {
    const options: Record<string, unknown> = { ...baseOptions() }
    Reflect.deleteProperty(options, key)

    expect(() => resolveZohoPaymentOptions(invalid(options))).toThrow(
      `Required Zoho Payments option "${key}" is missing`
    )
  })

  it.each(missingCredentialKeys)("rejects a blank %s credential", (key) => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), [key]: "   " }))
    ).toThrow(`Required Zoho Payments option "${key}" is missing`)
  })

  it("requires apiKey in widget mode", () => {
    expect(() => resolveZohoPaymentOptions(baseOptions({ apiKey: undefined }))).toThrow(
      'Zoho Payments option "apiKey" is required when checkoutMode is "widget"'
    )
  })

  it("does not require apiKey in hosted mode", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        checkoutMode: "hosted",
        apiKey: undefined,
        successUrl: "https://shop.example.test/success",
        failureUrl: "https://shop.example.test/failure",
      })
    )

    expect(resolved.checkoutMode).toBe("hosted")
    expect(resolved.apiKey).toBeUndefined()
  })

  it("requires both hosted-checkout return URLs", () => {
    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({
          checkoutMode: "hosted",
          successUrl: undefined,
          failureUrl: "https://shop.example.test/failure",
        })
      )
    ).toThrow(
      'Zoho Payments option "successUrl" is required when checkoutMode is "hosted"'
    )

    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({
          checkoutMode: "hosted",
          successUrl: "https://shop.example.test/success",
          failureUrl: undefined,
        })
      )
    ).toThrow(
      'Zoho Payments option "failureUrl" is required when checkoutMode is "hosted"'
    )
  })

  it("rejects unknown regions and checkout modes", () => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), region: "eu" }))
    ).toThrow('Zoho Payments option "region" must be "in" or "us"')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), checkoutMode: "iframe" }))
    ).toThrow('Zoho Payments option "checkoutMode" must be "widget" or "hosted"')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), region: 42 }))
    ).toThrow(ZohoConfigurationError)
  })

  it.each([
    ["timeoutMs", 0],
    ["timeoutMs", 120_001],
    ["timeoutMs", 1.5],
    ["timeoutMs", Number.NaN],
    ["maxRetries", -1],
    ["maxRetries", 11],
    ["retryBaseDelayMs", -1],
    ["retryBaseDelayMs", 60_001],
    ["pollAttempts", -1],
    ["pollAttempts", 11],
    ["pollIntervalMs", -1],
    ["pollIntervalMs", 10_001],
    ["webhookToleranceSeconds", -1],
    ["webhookToleranceSeconds", 86_401],
  ])("rejects invalid %s value %s", (key, value) => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), [key]: value }))
    ).toThrow(ZohoConfigurationError)
  })

  it("accepts numeric boundary values", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        timeoutMs: 1,
        maxRetries: 0,
        retryBaseDelayMs: 0,
        pollAttempts: 0,
        pollIntervalMs: 0,
        webhookToleranceSeconds: 0,
      })
    )

    expect(resolved.timeoutMs).toBe(1)
    expect(resolved.maxRetries).toBe(0)
    expect(resolved.retryBaseDelayMs).toBe(0)
    expect(resolved.pollAttempts).toBe(0)
    expect(resolved.pollIntervalMs).toBe(0)
    expect(resolved.webhookToleranceSeconds).toBe(0)
  })

  it.each(["apiBaseUrl", "accountsBaseUrl", "hostedCheckoutBaseUrl"])(
    "rejects an invalid %s URL",
    (key) => {
      expect(() =>
        resolveZohoPaymentOptions(invalid({ ...baseOptions(), [key]: "not a url" }))
      ).toThrow(`Zoho Payments option "${key}" must be a valid URL`)
    }
  )

  it("rejects non-http(s) URLs", () => {
    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({ apiBaseUrl: "ftp://payments.example.test" })
      )
    ).toThrow('Zoho Payments option "apiBaseUrl" must use http or https')
  })

  it("validates supplied return URLs even in widget mode", () => {
    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ successUrl: "not a url" }))
    ).toThrow('Zoho Payments option "successUrl" must be a valid URL')

    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({ failureUrl: "ftp://shop.example.test/failure" })
      )
    ).toThrow('Zoho Payments option "failureUrl" must use http or https')
  })

  it("rejects invalid hosted return URLs", () => {
    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({
          checkoutMode: "hosted",
          successUrl: "success",
          failureUrl: "https://shop.example.test/failure",
        })
      )
    ).toThrow('Zoho Payments option "successUrl" must be a valid URL')

    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({
          checkoutMode: "hosted",
          successUrl: "https://shop.example.test/success",
          failureUrl: "failure",
        })
      )
    ).toThrow('Zoho Payments option "failureUrl" must be a valid URL')
  })

  it("requires https in production, allowing localhost for development", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({ apiBaseUrl: "http://payments.example.test" })
      )
    ).toThrow('Zoho Payments option "apiBaseUrl" must use https in production')

    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ apiBaseUrl: "http://localhost:3000" }))
    ).not.toThrow()

    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ apiBaseUrl: "http://127.0.0.1:3000" }))
    ).not.toThrow()
  })

  it("accepts http URLs outside production", () => {
    vi.stubEnv("NODE_ENV", "test")

    const resolved = resolveZohoPaymentOptions(
      baseOptions({ apiBaseUrl: "http://payments.example.test" })
    )

    expect(resolved.regionConfig.apiBaseUrl).toBe("http://payments.example.test")
  })

  it("resolves extra metadata", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        metadata: {
          order_id: "ord_1",
          cart_id: "cart_1",
          store_id: "store_1",
        },
      })
    )

    expect(resolved.metadata).toEqual({
      order_id: "ord_1",
      cart_id: "cart_1",
      store_id: "store_1",
    })
  })

  it("rejects too many metadata entries", () => {
    expect(() =>
      resolveZohoPaymentOptions(
        baseOptions({
          metadata: {
            a: "1",
            b: "2",
            c: "3",
            d: "4",
          },
        })
      )
    ).toThrow("at most 3 entries")
  })

  it.each(["medusa_session_id", "zoho_session_id"])(
    "rejects reserved metadata key %s",
    (key) => {
      expect(() =>
        resolveZohoPaymentOptions(
          invalid({ ...baseOptions(), metadata: { [key]: "value" } })
        )
      ).toThrow(`Zoho Payments metadata key "${key}" is reserved`)
    }
  )

  it("rejects malformed metadata containers and values", () => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), metadata: [] }))
    ).toThrow('Zoho Payments option "metadata" must be an object')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), metadata: null }))
    ).toThrow('Zoho Payments option "metadata" must be an object')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), metadata: { "": "value" } })
      )
    ).toThrow('Zoho Payments metadata key "" is reserved')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), metadata: { key: "" } }))
    ).toThrow("must be a non-empty string of at most 500 characters")

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), metadata: { key: 42 } }))
    ).toThrow("must be a non-empty string of at most 500 characters")

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), metadata: { key: "x".repeat(501) } })
      )
    ).toThrow("must be a non-empty string of at most 500 characters")
  })

  it("normalizes currency-symbol overrides by ISO code", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({ currencySymbols: { inr: "₹", usd: "US$" } })
    )

    expect(resolved.currencySymbols).toEqual({ INR: "₹", USD: "US$" })
  })

  it("rejects malformed currency symbols", () => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), currencySymbols: [] }))
    ).toThrow('Zoho Payments option "currencySymbols" must be an object')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), currencySymbols: null }))
    ).toThrow('Zoho Payments option "currencySymbols" must be an object')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), currencySymbols: { INR: "" } })
      )
    ).toThrow('Zoho Payments currency symbol for "INR" must be a non-empty string')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), currencySymbols: { INR: 42 } })
      )
    ).toThrow('Zoho Payments currency symbol for "INR" must be a non-empty string')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), currencySymbols: { rupees: "₹" } })
      )
    ).toThrow(ZohoValidationError)
  })

  it("deduplicates allowed payment methods and treats an empty list as unset", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({ allowedPaymentMethods: ["card", "upi", "card"] })
    )

    expect(resolved.allowedPaymentMethods).toEqual(["card", "upi"])

    const empty = resolveZohoPaymentOptions(baseOptions({ allowedPaymentMethods: [] }))

    expect(empty.allowedPaymentMethods).toBeUndefined()
  })

  it("rejects malformed allowed payment methods", () => {
    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), allowedPaymentMethods: "card" })
      )
    ).toThrow('Zoho Payments option "allowedPaymentMethods" must be an array')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), allowedPaymentMethods: ["card", ""] })
      )
    ).toThrow('Zoho Payments option "allowedPaymentMethods" must be an array')

    expect(() =>
      resolveZohoPaymentOptions(
        invalid({ ...baseOptions(), allowedPaymentMethods: ["card", 42] })
      )
    ).toThrow('Zoho Payments option "allowedPaymentMethods" must be an array')
  })

  it("accepts a complete structured logger", () => {
    const logger = new FakeLogger()
    const resolved = resolveZohoPaymentOptions(baseOptions({ logger }))

    expect(resolved.logger).toBe(logger)
  })

  it.each([
    ["a string", "logger"],
    ["null", null],
    ["an array", []],
    ["an empty object", {}],
    ["a partial logger", { debug: () => undefined }],
  ])("rejects %s logger", (_label, logger) => {
    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), logger }))
    ).toThrow(ZohoConfigurationError)
  })

  it("accepts a custom fetch implementation and rejects non-functions", () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(new Response("{}", { status: 200 }))
    const resolved = resolveZohoPaymentOptions(baseOptions({ fetch: fakeFetch }))

    expect(resolved.fetch).toBe(fakeFetch)

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), fetch: "fetch" }))
    ).toThrow('Zoho Payments option "fetch" must be a function')
  })

  it("accepts boolean liveMode and rejects other types", () => {
    expect(resolveZohoPaymentOptions(baseOptions({ liveMode: true })).liveMode).toBe(
      true
    )

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), liveMode: "true" }))
    ).toThrow('Zoho Payments option "liveMode" must be a boolean')
  })

  it("enforces optional string length limits", () => {
    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ businessName: "x".repeat(101) }))
    ).toThrow('Zoho Payments option "businessName" must be at most 100 characters')

    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ paymentDescription: "x".repeat(501) }))
    ).toThrow(
      'Zoho Payments option "paymentDescription" must be at most 500 characters'
    )

    expect(() =>
      resolveZohoPaymentOptions(baseOptions({ signingKey: "x".repeat(513) }))
    ).toThrow('Zoho Payments option "signingKey" must be at most 512 characters')

    expect(() =>
      resolveZohoPaymentOptions(invalid({ ...baseOptions(), apiKey: "" }))
    ).toThrow('Zoho Payments option "apiKey" must be a non-empty string')
  })

  it("returns a deeply frozen configuration", () => {
    const resolved = resolveZohoPaymentOptions(
      baseOptions({
        allowedPaymentMethods: ["card"],
        metadata: { order_id: "ord_1" },
        currencySymbols: { inr: "₹" },
      })
    )

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.regionConfig)).toBe(true)
    expect(Object.isFrozen(resolved.allowedPaymentMethods)).toBe(true)
    expect(Object.isFrozen(resolved.metadata)).toBe(true)
    expect(Object.isFrozen(resolved.currencySymbols)).toBe(true)
  })
})

describe("validateZohoPaymentOptions", () => {
  beforeEach(() => {
    resetSigningKeyWarningForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetSigningKeyWarningForTests()
  })

  it("warns once when signingKey is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const options = baseOptions({ signingKey: undefined })

    validateZohoPaymentOptions(options as unknown as Record<string, unknown>)
    validateZohoPaymentOptions(options as unknown as Record<string, unknown>)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("signingKey")

    resetSigningKeyWarningForTests()
    validateZohoPaymentOptions(options as unknown as Record<string, unknown>)

    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("does not warn when a signing key is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    validateZohoPaymentOptions(
      baseOptions({ signingKey: SIGNING_KEY }) as unknown as Record<string, unknown>
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it("still validates credentials before warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const options: Record<string, unknown> = {
      ...baseOptions({ signingKey: undefined }),
    }
    delete options.accountId

    expect(() => {
      validateZohoPaymentOptions(options)
    }).toThrow(ZohoConfigurationError)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("logger contract", () => {
  it("accepts Medusa-style loggers typed as ZohoPaymentLogger", () => {
    const logger: ZohoPaymentLogger = new FakeLogger()

    expect(resolveZohoPaymentOptions(baseOptions({ logger })).logger).toBe(logger)
  })
})

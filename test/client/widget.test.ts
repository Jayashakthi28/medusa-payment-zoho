// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ZOHO_WIDGET_SCRIPT_URL,
  getZohoCheckoutMode,
  isZohoSessionExpired,
  loadZohoPaymentsScript,
  payWithZohoCheckout,
  redirectToZohoHostedCheckout,
  resetZohoCheckoutCacheForTests,
} from "../../src/client"
import {
  ZohoUnsupportedOperationError,
  ZohoValidationError,
} from "../../src/core/errors"

interface WidgetResponse {
  payment_id?: string
  signature?: string
}

interface WidgetRequest {
  amount: string
  transaction_type: "payment"
  currency_code: string
  payments_session_id: string
  currency_symbol?: string
  description: string
  business?: string
  invoice_number?: string
  address?: {
    name?: string
    email?: string
    phone?: string
  }
}

interface WidgetInstance {
  requestPaymentMethod(request: WidgetRequest): Promise<WidgetResponse>
  close?: () => void | Promise<void>
}

type WidgetConstructor = new (config: Record<string, unknown>) => WidgetInstance

interface WidgetStubState {
  configs: Record<string, unknown>[]
  requests: WidgetRequest[]
  closeCalls: number
}

interface WidgetStub {
  state: WidgetStubState
  create: WidgetConstructor
}

interface WidgetStubOptions {
  response?: WidgetResponse
  requestError?: unknown
  closeBehavior?: "resolve" | "reject" | "throw"
  omitClose?: boolean
}

function installWidgetStub(options: WidgetStubOptions = {}): WidgetStub {
  const state: WidgetStubState = {
    configs: [],
    requests: [],
    closeCalls: 0,
  }

  class StubWidget implements WidgetInstance {
    close?: () => void | Promise<void>

    constructor(config: Record<string, unknown>) {
      state.configs.push(config)

      if (!options.omitClose) {
        this.close = (): void | Promise<void> => {
          state.closeCalls += 1

          if (options.closeBehavior === "throw") {
            throw new Error("close failed")
          }

          if (options.closeBehavior === "reject") {
            return Promise.reject(new Error("close failed"))
          }

          return undefined
        }
      }
    }

    requestPaymentMethod(request: WidgetRequest): Promise<WidgetResponse> {
      state.requests.push(request)

      if (options.requestError !== undefined) {
        // The helper must tolerate third-party scripts rejecting with non-Error values.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(options.requestError)
      }

      return Promise.resolve(options.response ?? { payment_id: "pay_123" })
    }
  }

  vi.stubGlobal("ZPayments", StubWidget)

  return { state, create: StubWidget }
}

function buildWidgetSession(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    zohoSessionId: "zoho_sess_1",
    checkoutMode: "widget",
    amount: "1499.00",
    currencyCode: "INR",
    currencySymbol: "₹",
    description: "Order #1042",
    invoiceNumber: "INV-1042",
    expiresAt: Date.now() + 15 * 60_000,
    widget: {
      accountId: "acct_1",
      domain: "IN",
      apiKey: "api_key_1",
    },
    ...overrides,
  }
}

function buildHostedSession(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    zohoSessionId: "zoho_sess_hosted",
    checkoutMode: "hosted",
    amount: "2499.00",
    currencyCode: "INR",
    currencySymbol: "₹",
    description: "Order #2048",
    invoiceNumber: "INV-2048",
    expiresAt: Date.now() + 15 * 60_000,
    checkoutUrl: "https://payments.zoho.in/checkout/session-1",
    ...overrides,
  }
}

function zohoScripts(): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[data-zoho-payments="true"]')
  )
}

function firstZohoScript(): HTMLScriptElement {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-zoho-payments="true"]'
  )

  if (!script) {
    throw new Error("expected a Zoho script tag in the document")
  }

  return script
}

function firstConfig(stub: WidgetStub): Record<string, unknown> {
  const config = stub.state.configs[0]

  if (!config) {
    throw new Error("expected the widget to be constructed")
  }

  return config
}

function firstRequest(stub: WidgetStub): WidgetRequest {
  const request = stub.state.requests[0]

  if (!request) {
    throw new Error("expected a widget request")
  }

  return request
}

function stubLocationAssign(): ReturnType<typeof vi.fn<(url: string) => void>> {
  const assign = vi.fn<(url: string) => void>()
  vi.stubGlobal("location", { assign })
  return assign
}

beforeEach(() => {
  resetZohoCheckoutCacheForTests()
  document.head.replaceChildren()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetZohoCheckoutCacheForTests()
  document.head.replaceChildren()
})

describe("isZohoSessionExpired", () => {
  it("is false when the session has no expiry", () => {
    expect(isZohoSessionExpired({}, 1_000)).toBe(false)
  })

  it("is false when the expiry is in the future", () => {
    expect(isZohoSessionExpired({ expiresAt: 1_001 }, 1_000)).toBe(false)
  })

  it("is true at and past the expiry boundary", () => {
    expect(isZohoSessionExpired({ expiresAt: 1_000 }, 1_000)).toBe(true)
    expect(isZohoSessionExpired({ expiresAt: 999 }, 1_000)).toBe(true)
  })

  it("treats non-numeric and non-finite expiry values as missing", () => {
    expect(isZohoSessionExpired({ expiresAt: "1000" }, 2_000)).toBe(false)
    expect(isZohoSessionExpired({ expiresAt: Number.NaN }, 2_000)).toBe(false)
    expect(isZohoSessionExpired({ expiresAt: Number.POSITIVE_INFINITY }, 2_000)).toBe(
      false
    )
    expect(isZohoSessionExpired({ expiresAt: null }, 2_000)).toBe(false)
  })
})

describe("getZohoCheckoutMode", () => {
  it("returns widget and hosted modes", () => {
    expect(getZohoCheckoutMode({ checkoutMode: "widget" })).toBe("widget")
    expect(getZohoCheckoutMode({ checkoutMode: "hosted" })).toBe("hosted")
  })

  it("returns undefined for missing or unknown modes", () => {
    expect(getZohoCheckoutMode({})).toBeUndefined()
    expect(getZohoCheckoutMode({ checkoutMode: "iframe" })).toBeUndefined()
    expect(getZohoCheckoutMode({ checkoutMode: 1 })).toBeUndefined()
  })
})

describe("loadZohoPaymentsScript", () => {
  it("resolves immediately when the global is already present", async () => {
    installWidgetStub()

    await expect(loadZohoPaymentsScript()).resolves.toBeUndefined()
    expect(zohoScripts()).toHaveLength(0)
  })

  it("reuses an existing Zoho script tag", async () => {
    vi.useFakeTimers()

    const existing = document.createElement("script")
    existing.dataset.zohoPayments = "true"
    existing.src = ZOHO_WIDGET_SCRIPT_URL
    document.head.append(existing)

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })

    expect(zohoScripts()).toEqual([existing])

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(load).resolves.toBeUndefined()

    expect(zohoScripts()).toEqual([existing])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("appends a new async script tag with the expected attributes", async () => {
    vi.useFakeTimers()

    const scriptUrl = "https://cdn.example.test/zpayments.js"
    const load = loadZohoPaymentsScript({ scriptUrl, timeoutMs: 1_000 })
    const script = firstZohoScript()

    expect(script.src).toBe(scriptUrl)
    expect(script.async).toBe(true)
    expect(script.dataset.zohoPayments).toBe("true")
    expect(script.parentElement).toBe(document.head)

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(load).resolves.toBeUndefined()
  })

  it("uses the official script URL by default", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })

    expect(firstZohoScript().src).toBe(ZOHO_WIDGET_SCRIPT_URL)

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(load).resolves.toBeUndefined()
  })

  it("reuses the in-flight promise for the same script URL", async () => {
    vi.useFakeTimers()

    const scriptUrl = "https://cdn.example.test/zpayments.js"
    const first = loadZohoPaymentsScript({ scriptUrl, timeoutMs: 1_000 })
    const second = loadZohoPaymentsScript({ scriptUrl, timeoutMs: 5_000 })

    expect(second).toBe(first)
    expect(zohoScripts()).toHaveLength(1)

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(first).resolves.toBeUndefined()
  })

  it("loads distinct script URLs independently", async () => {
    vi.useFakeTimers()

    const first = loadZohoPaymentsScript({
      scriptUrl: "https://cdn.example.test/a.js",
      timeoutMs: 1_000,
    })
    const second = loadZohoPaymentsScript({
      scriptUrl: "https://cdn.example.test/b.js",
      timeoutMs: 1_000,
    })

    expect(second).not.toBe(first)
    expect(zohoScripts()).toHaveLength(2)

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it("resolves when the script loads and publishes the global", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const script = firstZohoScript()

    installWidgetStub()
    script.dispatchEvent(new Event("load"))

    await vi.advanceTimersByTimeAsync(25)
    await expect(load).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects when a script we created emits an error", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const failedScript = firstZohoScript()
    const rejection = expect(load).rejects.toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: "Failed to load the Zoho Checkout Widget script",
    })

    failedScript.dispatchEvent(new Event("error"))
    await rejection

    expect(vi.getTimerCount()).toBe(0)
  })

  it("removes our failed script tag and retries with a fresh tag", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const failedScript = firstZohoScript()
    const rejection = expect(load).rejects.toThrow(ZohoValidationError)

    failedScript.dispatchEvent(new Event("error"))
    await rejection

    expect(zohoScripts()).toHaveLength(0)

    const retry = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const retryScript = firstZohoScript()

    expect(retryScript).not.toBe(failedScript)

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(retry).resolves.toBeUndefined()
  })

  it("keeps an existing script tag after it emits an error", async () => {
    vi.useFakeTimers()

    const existing = document.createElement("script")
    existing.dataset.zohoPayments = "true"
    existing.src = ZOHO_WIDGET_SCRIPT_URL
    document.head.append(existing)

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const rejection = expect(load).rejects.toThrow("Failed to load")

    existing.dispatchEvent(new Event("error"))
    await rejection

    expect(existing.isConnected).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects with a typed error on a custom timeout", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 100 })
    const script = firstZohoScript()
    const rejection = expect(load).rejects.toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: "Timed out while loading the Zoho Checkout Widget script",
    })

    await vi.advanceTimersByTimeAsync(99)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(1)
    await rejection

    expect(vi.getTimerCount()).toBe(0)
    expect(script.isConnected).toBe(false)
    expect(zohoScripts()).toHaveLength(0)
  })

  it("times out after the default timeout", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript()
    const rejection = expect(load).rejects.toThrow("Timed out")

    await vi.advanceTimersByTimeAsync(9_999)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ignores a late script error after resolving", async () => {
    vi.useFakeTimers()

    const load = loadZohoPaymentsScript({ timeoutMs: 1_000 })
    const script = firstZohoScript()

    installWidgetStub()
    await vi.advanceTimersByTimeAsync(25)
    await expect(load).resolves.toBeUndefined()

    expect(() => {
      script.dispatchEvent(new Event("error"))
    }).not.toThrow()
  })
})

describe("payWithZohoCheckout session validation", () => {
  const invalidSessions: [string, Record<string, unknown>][] = [
    ["missing zohoSessionId", { zohoSessionId: undefined }],
    ["empty zohoSessionId", { zohoSessionId: "" }],
    ["non-string zohoSessionId", { zohoSessionId: 42 }],
    ["missing checkoutMode", { checkoutMode: undefined }],
    ["unknown checkoutMode", { checkoutMode: "iframe" }],
    ["missing amount", { amount: undefined }],
    ["empty amount", { amount: "" }],
    ["missing currencyCode", { currencyCode: undefined }],
    ["missing currencySymbol", { currencySymbol: undefined }],
    ["missing description", { description: undefined }],
  ]

  it("rejects sessions missing required checkout data", async () => {
    for (const [label, overrides] of invalidSessions) {
      const promise = payWithZohoCheckout({ session: buildWidgetSession(overrides) })

      await expect(promise, label).rejects.toMatchObject({
        code: "ZOHO_VALIDATION_ERROR",
        message: "Medusa payment session is missing the Zoho checkout data",
      })
    }

    expect(zohoScripts()).toHaveLength(0)
  })

  it("returns not_configured for missing or invalid widget configuration", async () => {
    const invalidWidgets: unknown[] = [
      undefined,
      null,
      [],
      "not-a-widget",
      { accountId: "", domain: "IN", apiKey: "api_key_1" },
      { accountId: "acct_1", domain: "EU", apiKey: "api_key_1" },
      { accountId: "acct_1", domain: "in", apiKey: "api_key_1" },
      { accountId: "acct_1", domain: "IN" },
      { accountId: "acct_1", domain: "IN", apiKey: "" },
    ]

    for (const widget of invalidWidgets) {
      const result = await payWithZohoCheckout({
        session: buildWidgetSession({ widget }),
      })

      expect(result).toStrictEqual({ ok: false, reason: "not_configured" })
    }

    expect(zohoScripts()).toHaveLength(0)
  })

  it("returns hosted_checkout_required for hosted sessions", async () => {
    const result = await payWithZohoCheckout({ session: buildHostedSession() })

    expect(result).toStrictEqual({ ok: false, reason: "hosted_checkout_required" })
    expect(zohoScripts()).toHaveLength(0)
  })

  it("returns hosted_checkout_required even when the hosted URL is absent", async () => {
    const result = await payWithZohoCheckout({
      session: buildHostedSession({ checkoutUrl: undefined }),
    })

    expect(result).toStrictEqual({ ok: false, reason: "hosted_checkout_required" })
  })

  it("returns expired without loading the widget", async () => {
    const result = await payWithZohoCheckout({
      session: buildWidgetSession({ expiresAt: Date.now() - 1 }),
    })

    expect(result).toStrictEqual({ ok: false, reason: "expired" })
    expect(zohoScripts()).toHaveLength(0)
  })

  it("ignores a non-numeric expiry and proceeds with payment", async () => {
    const stub = installWidgetStub()

    const result = await payWithZohoCheckout({
      session: buildWidgetSession({ expiresAt: "not-a-number" }),
    })

    expect(result.ok).toBe(true)
    expect(stub.state.requests).toHaveLength(1)
  })
})

describe("payWithZohoCheckout widget flow", () => {
  it("returns the payment result with a signature", async () => {
    const stub = installWidgetStub({
      response: { payment_id: "pay_123", signature: "sig_abc" },
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: true,
      paymentId: "pay_123",
      paymentSessionId: "zoho_sess_1",
      signature: "sig_abc",
    })
    expect(firstConfig(stub)).toStrictEqual({
      account_id: "acct_1",
      domain: "IN",
      otherOptions: { api_key: "api_key_1" },
    })
    expect(firstRequest(stub)).toStrictEqual({
      amount: "1499.00",
      transaction_type: "payment",
      currency_code: "INR",
      payments_session_id: "zoho_sess_1",
      currency_symbol: "₹",
      description: "Order #1042",
      invoice_number: "INV-1042",
    })
    expect(stub.state.closeCalls).toBe(1)
  })

  it("omits the signature when Zoho does not return one", async () => {
    installWidgetStub({ response: { payment_id: "pay_123" } })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: true,
      paymentId: "pay_123",
      paymentSessionId: "zoho_sess_1",
    })
    expect(result).not.toHaveProperty("signature")
  })

  it("uses the US widget domain", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession({
        widget: { accountId: "acct_us", domain: "US", apiKey: "api_key_us" },
      }),
    })

    expect(firstConfig(stub)).toStrictEqual({
      account_id: "acct_us",
      domain: "US",
      otherOptions: { api_key: "api_key_us" },
    })
  })

  it("fails when Zoho omits the payment ID", async () => {
    const stub = installWidgetStub({ response: {} })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Zoho did not return a payment ID",
    })
    expect(stub.state.closeCalls).toBe(1)
  })

  it("fails when Zoho returns an empty payment ID", async () => {
    installWidgetStub({ response: { payment_id: "" } })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Zoho did not return a payment ID",
    })
  })

  it("maps widget_closed to the closed result", async () => {
    const stub = installWidgetStub({
      requestError: { code: "widget_closed", message: "Customer closed the widget" },
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({ ok: false, reason: "closed" })
    expect(stub.state.closeCalls).toBe(1)
  })

  it("maps a generic error with code and message", async () => {
    installWidgetStub({
      requestError: { code: "payment_failed", message: "Card declined" },
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Card declined",
      code: "payment_failed",
    })
  })

  it("falls back to a generic message for an Error without a code", async () => {
    installWidgetStub({ requestError: new Error("Network down") })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Network down",
    })
  })

  it("falls back to a generic message for a non-object error", async () => {
    installWidgetStub({ requestError: "boom" })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Zoho payment failed",
    })
  })

  it("ignores empty or non-string error fields", async () => {
    installWidgetStub({ requestError: { code: "", message: "" } })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Zoho payment failed",
    })
  })

  it("ignores a numeric error code", async () => {
    installWidgetStub({ requestError: { code: 500, message: "Server error" } })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: false,
      reason: "failed",
      message: "Server error",
    })
  })

  it("prefills a full customer address", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      customer: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+91 90000 00000",
      },
    })

    expect(firstRequest(stub).address).toStrictEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+91 90000 00000",
    })
  })

  it("prefills only the supplied customer fields", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      customer: { name: "Ada Lovelace" },
    })

    expect(firstRequest(stub).address).toStrictEqual({ name: "Ada Lovelace" })
  })

  it("omits the address for empty or blank customer data", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      customer: {},
    })

    expect(firstRequest(stub)).not.toHaveProperty("address")

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      customer: { name: "", email: "", phone: "" },
    })

    expect(stub.state.requests).toHaveLength(2)
    expect(stub.state.requests[1]).not.toHaveProperty("address")
  })

  it("forwards the configured business name to the widget", async () => {
    const stub = installWidgetStub()

    const result = await payWithZohoCheckout({
      session: buildWidgetSession({ businessName: "Zylker" }),
    })

    expect(result.ok).toBe(true)
    expect(firstRequest(stub).business).toBe("Zylker")
  })

  it("applies description and invoice-number overrides", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      description: "Custom description",
      invoiceNumber: "OVERRIDE-1",
    })

    expect(firstRequest(stub).description).toBe("Custom description")
    expect(firstRequest(stub).invoice_number).toBe("OVERRIDE-1")
  })

  it("omits the invoice number when neither session nor override has one", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession({ invoiceNumber: undefined }),
    })

    expect(firstRequest(stub)).not.toHaveProperty("invoice_number")
  })

  it("lets an empty invoice override clear the session invoice", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({
      session: buildWidgetSession(),
      invoiceNumber: "",
    })

    expect(firstRequest(stub)).not.toHaveProperty("invoice_number")
  })

  it("reuses one widget instance per configuration", async () => {
    const stub = installWidgetStub({ response: { payment_id: "pay_123" } })

    await payWithZohoCheckout({ session: buildWidgetSession() })
    await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(stub.state.configs).toHaveLength(1)
    expect(stub.state.requests).toHaveLength(2)
    expect(stub.state.closeCalls).toBe(2)
  })

  it("creates a new instance when the widget configuration changes", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({ session: buildWidgetSession() })
    await payWithZohoCheckout({
      session: buildWidgetSession({
        widget: { accountId: "acct_2", domain: "IN", apiKey: "api_key_2" },
      }),
    })

    expect(stub.state.configs).toHaveLength(2)
  })

  it("creates a new instance after the cache is reset", async () => {
    const stub = installWidgetStub()

    await payWithZohoCheckout({ session: buildWidgetSession() })
    resetZohoCheckoutCacheForTests()
    await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(stub.state.configs).toHaveLength(2)
  })

  it("does not mask success when close rejects", async () => {
    const stub = installWidgetStub({
      response: { payment_id: "pay_123" },
      closeBehavior: "reject",
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result).toStrictEqual({
      ok: true,
      paymentId: "pay_123",
      paymentSessionId: "zoho_sess_1",
    })
    expect(stub.state.closeCalls).toBe(1)
  })

  it("does not mask success when close throws synchronously", async () => {
    const stub = installWidgetStub({
      response: { payment_id: "pay_123" },
      closeBehavior: "throw",
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result.ok).toBe(true)
    expect(stub.state.closeCalls).toBe(1)
  })

  it("works when the widget has no close method", async () => {
    const stub = installWidgetStub({
      response: { payment_id: "pay_123" },
      omitClose: true,
    })

    const result = await payWithZohoCheckout({ session: buildWidgetSession() })

    expect(result.ok).toBe(true)
    expect(stub.state.closeCalls).toBe(0)
  })

  it("propagates a typed error when the script cannot load", async () => {
    vi.useFakeTimers()

    const payment = payWithZohoCheckout({
      session: buildWidgetSession(),
      timeoutMs: 100,
    })
    const rejection = expect(payment).rejects.toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: "Timed out while loading the Zoho Checkout Widget script",
    })

    await vi.advanceTimersByTimeAsync(100)
    await rejection

    expect(zohoScripts()).toHaveLength(0)
  })

  it("rejects when the widget global disappears after loading", async () => {
    installWidgetStub()

    // Simulate another microtask clearing the third-party global between the
    // script load resolving and the widget instance being created.
    queueMicrotask(() => {
      delete (globalThis as { ZPayments?: unknown }).ZPayments
    })

    await expect(
      payWithZohoCheckout({ session: buildWidgetSession() })
    ).rejects.toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: "Zoho Checkout Widget script is not available",
    })
  })
})

describe("redirectToZohoHostedCheckout", () => {
  it("navigates to the hosted checkout URL and returns it", () => {
    const assign = stubLocationAssign()
    const url = "https://payments.zoho.in/checkout/session-1"

    const returned = redirectToZohoHostedCheckout(buildHostedSession())

    expect(returned).toBe(url)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(url)
  })

  it("accepts a custom hosted URL", () => {
    const assign = stubLocationAssign()
    const url = "https://checkout.example.test/zoho/abc"

    const returned = redirectToZohoHostedCheckout(
      buildHostedSession({ checkoutUrl: url })
    )

    expect(returned).toBe(url)
    expect(assign).toHaveBeenCalledWith(url)
  })

  it("rejects widget sessions", () => {
    const assign = stubLocationAssign()

    expect(() => redirectToZohoHostedCheckout(buildWidgetSession())).toThrow(
      ZohoUnsupportedOperationError
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it("rejects hosted sessions without a URL", () => {
    const assign = stubLocationAssign()

    expect(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ checkoutUrl: undefined }))
    ).toThrow("Zoho hosted-checkout URL is missing from the payment session")
    expect(assign).not.toHaveBeenCalled()
  })

  it("rejects an empty hosted URL", () => {
    const assign = stubLocationAssign()

    expect(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ checkoutUrl: "" }))
    ).toThrow(ZohoValidationError)
    expect(assign).not.toHaveBeenCalled()
  })

  it("rejects expired sessions before navigating", () => {
    const assign = stubLocationAssign()

    expect(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ expiresAt: Date.now() - 1 }))
    ).toThrow("Zoho checkout session has expired")
    expect(assign).not.toHaveBeenCalled()
  })

  it("rejects malformed sessions before navigating", () => {
    const assign = stubLocationAssign()

    expect(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ zohoSessionId: undefined }))
    ).toThrow("Medusa payment session is missing the Zoho checkout data")
    expect(assign).not.toHaveBeenCalled()
  })
})

describe("script URL hardening", () => {
  it.each([
    ["not a URL"],
    ["javascript:alert(1)"],
    ["http://cdn.example.com/zpayments.js"],
    ["https://user:secret@cdn.example.com/zpayments.js"],
  ])("rejects unsafe script URL %s", (scriptUrl) => {
    expect(() => loadZohoPaymentsScript({ scriptUrl })).toThrow(ZohoValidationError)
  })

  it("allows http for localhost development", async () => {
    installWidgetStub()

    await expect(
      loadZohoPaymentsScript({
        scriptUrl: "http://localhost:3000/zpayments.js",
        timeoutMs: 50,
      })
    ).resolves.toBeUndefined()
  })
})

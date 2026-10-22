// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  getZohoCheckoutMode,
  isZohoSessionExpired,
  loadZohoPaymentsScript,
  payWithZohoCheckout,
  redirectToZohoHostedCheckout,
} from "../../src/client"
import {
  ZohoUnsupportedOperationError,
  ZohoValidationError,
} from "../../src/core/errors"

const BROWSER_ONLY_MESSAGE = "Zoho Checkout can only be opened in a browser"

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

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error("expected the action to throw")
}

function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the promise to reject")
    },
    (error: unknown) => error
  )
}

describe("browser helper in a server environment", () => {
  it("runs without a window global", () => {
    expect(typeof window).toBe("undefined")
  })

  it("throws a validation error when loading the script", () => {
    const error = captureError(() => loadZohoPaymentsScript())

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      name: "ZohoValidationError",
      code: "ZOHO_VALIDATION_ERROR",
      message: BROWSER_ONLY_MESSAGE,
    })
  })

  it("rejects a widget payment with a validation error", async () => {
    const error = await captureRejection(
      payWithZohoCheckout({ session: buildWidgetSession() })
    )

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: BROWSER_ONLY_MESSAGE,
    })
  })

  it("throws a validation error when redirecting to hosted checkout", () => {
    const error = captureError(() => redirectToZohoHostedCheckout(buildHostedSession()))

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      code: "ZOHO_VALIDATION_ERROR",
      message: BROWSER_ONLY_MESSAGE,
    })
  })

  it("validates payment data before touching the browser window", async () => {
    const error = await captureRejection(
      payWithZohoCheckout({
        session: buildWidgetSession({ zohoSessionId: undefined }),
      })
    )

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      message: "Medusa payment session is missing the Zoho checkout data",
    })
  })

  it("validates redirect data before touching the browser window", () => {
    const error = captureError(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ amount: undefined }))
    )

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      message: "Medusa payment session is missing the Zoho checkout data",
    })
  })

  it("returns expired for a widget payment without a window", async () => {
    const result = await payWithZohoCheckout({
      session: buildWidgetSession({ expiresAt: Date.now() - 1 }),
    })

    expect(result).toStrictEqual({ ok: false, reason: "expired" })
  })

  it("throws for an expired hosted redirect without a window", () => {
    const error = captureError(() =>
      redirectToZohoHostedCheckout(buildHostedSession({ expiresAt: Date.now() - 1 }))
    )

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toMatchObject({
      message: "Zoho checkout session has expired",
    })
  })

  it("returns not_configured for a widget session without widget data", async () => {
    const result = await payWithZohoCheckout({
      session: buildWidgetSession({ widget: undefined }),
    })

    expect(result).toStrictEqual({ ok: false, reason: "not_configured" })
  })

  it("rejects hosted payments without touching the browser window", async () => {
    const result = await payWithZohoCheckout({
      session: buildHostedSession(),
    })

    expect(result).toStrictEqual({
      ok: false,
      reason: "hosted_checkout_required",
    })
  })

  it("rejects hosted redirects of widget sessions with an unsupported error", () => {
    const error = captureError(() => redirectToZohoHostedCheckout(buildWidgetSession()))

    expect(error).toBeInstanceOf(ZohoUnsupportedOperationError)
    expect(error).toMatchObject({
      code: "ZOHO_UNSUPPORTED_OPERATION",
      message:
        "This Zoho payment session uses the embedded widget, not hosted checkout",
    })
  })

  it("keeps the pure helpers usable without a window", () => {
    expect(isZohoSessionExpired({ expiresAt: 1 }, 2)).toBe(true)
    expect(getZohoCheckoutMode({ checkoutMode: "hosted" })).toBe("hosted")
  })
})

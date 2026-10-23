import { describe, expect, it } from "vitest"

import { ZohoValidationError } from "../../src/core/errors"
import {
  MEDUSA_SESSION_ID_METADATA_KEY,
  ZOHO_SESSION_ID_METADATA_KEY,
  buildZohoMetadataEntries,
  buildZohoSessionData,
  extractMedusaSessionId,
  extractZohoSessionId,
  findZohoMetadataValue,
  isReusableZohoSession,
  normalizeZohoExpiryTime,
  parseZohoSessionData,
  stripProviderOwnedSessionData,
} from "../../src/providers/zoho/session-data"
import type { ZohoSessionDataView } from "../../src/providers/zoho/session-data"
import type { ZohoMetadataEntry } from "../../src/providers/zoho/types"
import { NOW } from "../fixtures/providers"

const WIDGET = {
  accountId: "acct_in",
  domain: "IN" as const,
  apiKey: "widget_key",
}

describe("parseZohoSessionData", () => {
  it("parses every provider-owned field", () => {
    const raw: Record<string, unknown> = {
      zohoSessionId: "zoho_sess_1",
      checkoutMode: "hosted",
      amount: "1234.50",
      currencyCode: "INR",
      currencySymbol: "₹",
      description: "Order payment",
      businessName: "Zylker",
      invoiceNumber: "payses_1",
      expiresAt: NOW + 900_000,
      widget: WIDGET,
      checkoutUrl: "https://checkout.example.test/access_key",
      medusaSessionId: "payses_1",
      paymentId: "zoho_pay_1",
      paymentStatus: "succeeded",
      previousZohoSessionIds: ["zoho_old_1", "", 42, "zoho_old_2"],
      lastRefundId: "zoho_refund_1",
      lastRefundStatus: "succeeded",
      lastRefundIdempotencyKey: "refund_key",
    }

    expect(parseZohoSessionData(raw)).toEqual({
      zohoSessionId: "zoho_sess_1",
      checkoutMode: "hosted",
      amount: "1234.50",
      currencyCode: "INR",
      currencySymbol: "₹",
      description: "Order payment",
      businessName: "Zylker",
      invoiceNumber: "payses_1",
      expiresAt: NOW + 900_000,
      widget: WIDGET,
      checkoutUrl: "https://checkout.example.test/access_key",
      medusaSessionId: "payses_1",
      paymentId: "zoho_pay_1",
      paymentStatus: "succeeded",
      previousZohoSessionIds: ["zoho_old_1", "zoho_old_2"],
      lastRefundId: "zoho_refund_1",
      lastRefundStatus: "succeeded",
      lastRefundIdempotencyKey: "refund_key",
    })
  })

  it("returns an empty view for undefined data", () => {
    expect(parseZohoSessionData(undefined)).toEqual({
      zohoSessionId: undefined,
      checkoutMode: undefined,
      amount: undefined,
      currencyCode: undefined,
      currencySymbol: undefined,
      description: undefined,
      invoiceNumber: undefined,
      expiresAt: undefined,
      widget: undefined,
      checkoutUrl: undefined,
      medusaSessionId: undefined,
      paymentId: undefined,
      paymentStatus: undefined,
      previousZohoSessionIds: undefined,
      lastRefundId: undefined,
      lastRefundStatus: undefined,
      lastRefundIdempotencyKey: undefined,
    })
  })

  it("ignores fields with invalid types or empty values", () => {
    const view = parseZohoSessionData({
      zohoSessionId: 42,
      checkoutMode: "iframe",
      amount: "",
      currencyCode: false,
      currencySymbol: null,
      description: [],
      invoiceNumber: {},
      expiresAt: "1800000000000",
      widget: "widget",
      checkoutUrl: 7,
      medusaSessionId: "",
      paymentId: 1,
      paymentStatus: [],
      previousZohoSessionIds: "zoho_old_1",
      lastRefundId: {},
      lastRefundStatus: null,
      lastRefundIdempotencyKey: 0,
    })

    expect(view).toEqual({
      zohoSessionId: undefined,
      checkoutMode: undefined,
      amount: undefined,
      currencyCode: undefined,
      currencySymbol: undefined,
      description: undefined,
      invoiceNumber: undefined,
      expiresAt: undefined,
      widget: undefined,
      checkoutUrl: undefined,
      medusaSessionId: undefined,
      paymentId: undefined,
      paymentStatus: undefined,
      previousZohoSessionIds: undefined,
      lastRefundId: undefined,
      lastRefundStatus: undefined,
      lastRefundIdempotencyKey: undefined,
    })
  })

  it("rejects non-finite expiry values and empty previous-session arrays", () => {
    expect(
      parseZohoSessionData({
        expiresAt: Number.NaN,
        previousZohoSessionIds: ["", 42],
      })
    ).toMatchObject({
      expiresAt: undefined,
      previousZohoSessionIds: undefined,
    })

    expect(
      parseZohoSessionData({ expiresAt: Number.POSITIVE_INFINITY }).expiresAt
    ).toBeUndefined()
  })

  it("only accepts complete widget configurations with a supported domain", () => {
    expect(parseZohoSessionData({ widget: WIDGET }).widget).toEqual(WIDGET)

    expect(
      parseZohoSessionData({
        widget: { ...WIDGET, domain: "US" },
      }).widget
    ).toEqual({ ...WIDGET, domain: "US" })

    expect(
      parseZohoSessionData({ widget: { ...WIDGET, accountId: "" } }).widget
    ).toBeUndefined()

    expect(
      parseZohoSessionData({ widget: { ...WIDGET, apiKey: 42 } }).widget
    ).toBeUndefined()

    expect(
      parseZohoSessionData({ widget: { ...WIDGET, domain: "EU" } }).widget
    ).toBeUndefined()

    expect(
      parseZohoSessionData({ widget: { ...WIDGET, domain: "in" } }).widget
    ).toBeUndefined()
  })
})

describe("metadata helpers", () => {
  it("exposes the correlation metadata keys", () => {
    expect(MEDUSA_SESSION_ID_METADATA_KEY).toBe("medusa_session_id")
    expect(ZOHO_SESSION_ID_METADATA_KEY).toBe("zoho_session_id")
  })

  it("builds medusa-session metadata before the configured extras", () => {
    const entries = buildZohoMetadataEntries(
      { order_id: "ord_1", cart_id: "cart_1" },
      "payses_1"
    )

    expect(entries).toEqual([
      { key: "medusa_session_id", value: "payses_1" },
      { key: "order_id", value: "ord_1" },
      { key: "cart_id", value: "cart_1" },
    ])
  })

  it("omits the medusa entry when no session ID is available", () => {
    expect(buildZohoMetadataEntries({ order_id: "ord_1" }, undefined)).toEqual([
      { key: "order_id", value: "ord_1" },
    ])

    expect(buildZohoMetadataEntries({}, "")).toEqual([])
  })

  it("allows the five-entry Zoho maximum and rejects more", () => {
    const extras = {
      a: "1",
      b: "2",
      c: "3",
      d: "4",
    }

    expect(buildZohoMetadataEntries(extras, "payses_1")).toHaveLength(5)

    expect(() => buildZohoMetadataEntries({ ...extras, e: "5" }, "payses_1")).toThrow(
      ZohoValidationError
    )

    expect(() => buildZohoMetadataEntries({ ...extras, e: "5" }, "payses_1")).toThrow(
      "at most 5 entries"
    )
  })

  it("finds a metadata value by key", () => {
    const entries: ZohoMetadataEntry[] = [
      { key: "medusa_session_id", value: "payses_1" },
      { key: "order_id", value: "ord_1" },
    ]

    expect(findZohoMetadataValue(entries, "order_id")).toBe("ord_1")
    expect(findZohoMetadataValue(entries, "missing")).toBeUndefined()
    expect(findZohoMetadataValue(undefined, "order_id")).toBeUndefined()
  })

  it("prefers the medusa metadata over the reference number", () => {
    expect(
      extractMedusaSessionId({
        meta_data: [{ key: "medusa_session_id", value: "payses_metadata" }],
        reference_number: "payses_reference",
      })
    ).toBe("payses_metadata")
  })

  it("falls back to a non-empty reference number", () => {
    expect(extractMedusaSessionId({ reference_number: "payses_reference" })).toBe(
      "payses_reference"
    )

    expect(extractMedusaSessionId({ reference_number: "" })).toBeUndefined()
    expect(extractMedusaSessionId({})).toBeUndefined()
  })

  it("ignores an empty metadata value and falls back to the reference", () => {
    expect(
      extractMedusaSessionId({
        meta_data: [{ key: "medusa_session_id", value: "" }],
        reference_number: "payses_reference",
      })
    ).toBe("payses_reference")
  })

  it("prefers the Zoho session ID on the payment object", () => {
    expect(
      extractZohoSessionId({
        payments_session_id: "zoho_sess_object",
        meta_data: [{ key: "zoho_session_id", value: "zoho_sess_metadata" }],
      })
    ).toBe("zoho_sess_object")
  })

  it("falls back to the Zoho session metadata", () => {
    expect(
      extractZohoSessionId({
        meta_data: [{ key: "zoho_session_id", value: "zoho_sess_metadata" }],
      })
    ).toBe("zoho_sess_metadata")

    expect(
      extractZohoSessionId({
        payments_session_id: "",
        meta_data: [{ key: "zoho_session_id", value: "zoho_sess_metadata" }],
      })
    ).toBe("zoho_sess_metadata")
  })

  it("returns undefined when no Zoho session ID is available", () => {
    expect(extractZohoSessionId({})).toBeUndefined()
    expect(
      extractZohoSessionId({
        payments_session_id: "",
        meta_data: [{ key: "zoho_session_id", value: "" }],
      })
    ).toBeUndefined()
  })
})

describe("normalizeZohoExpiryTime", () => {
  it("converts epoch seconds to milliseconds", () => {
    expect(normalizeZohoExpiryTime(1_800_000_900, NOW)).toBe(1_800_000_900_000)
  })

  it("keeps epoch milliseconds unchanged", () => {
    expect(normalizeZohoExpiryTime(NOW + 900_000, NOW)).toBe(NOW + 900_000)
  })

  it("falls back to fifteen minutes when Zoho omits expiry_time", () => {
    expect(normalizeZohoExpiryTime(undefined, NOW)).toBe(NOW + 900_000)
  })

  it("supports a custom fallback duration", () => {
    expect(normalizeZohoExpiryTime(undefined, NOW, 60)).toBe(NOW + 60_000)
  })

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["a negative number", -1],
  ])("falls back for %s", (_label, value) => {
    expect(normalizeZohoExpiryTime(value, NOW)).toBe(NOW + 900_000)
  })
})

describe("isReusableZohoSession", () => {
  function reusableView(
    overrides: Partial<ZohoSessionDataView> = {}
  ): ZohoSessionDataView {
    return {
      zohoSessionId: "zoho_sess_1",
      environment: "live",
      checkoutMode: "widget",
      amount: "100.00",
      currencyCode: "INR",
      expiresAt: NOW + 15 * 60_000,
      ...overrides,
    }
  }

  it("reuses an unpaid, matching, fresh session", () => {
    expect(
      isReusableZohoSession(reusableView(), "100.00", "INR", "widget", "live", NOW)
    ).toBe(true)
  })

  it("does not reuse without a Zoho session ID", () => {
    expect(
      isReusableZohoSession(
        reusableView({ zohoSessionId: undefined }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)
  })

  it("does not reuse a session that already has a payment", () => {
    expect(
      isReusableZohoSession(
        reusableView({ paymentId: "zoho_pay_1" }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)
  })

  it("does not reuse when the amount, currency, or checkout mode changed", () => {
    expect(
      isReusableZohoSession(reusableView(), "99.00", "INR", "widget", "live", NOW)
    ).toBe(false)

    expect(
      isReusableZohoSession(reusableView(), "100.00", "USD", "widget", "live", NOW)
    ).toBe(false)

    expect(
      isReusableZohoSession(reusableView(), "100.00", "INR", "hosted", "live", NOW)
    ).toBe(false)
  })

  it("does not reuse without a known expiry", () => {
    expect(
      isReusableZohoSession(
        reusableView({ expiresAt: undefined }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)
  })

  it("requires more than the one-minute safety window before expiry", () => {
    expect(
      isReusableZohoSession(
        reusableView({ expiresAt: NOW + 60_000 }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)

    expect(
      isReusableZohoSession(
        reusableView({ expiresAt: NOW + 59_999 }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)

    expect(
      isReusableZohoSession(
        reusableView({ expiresAt: NOW + 60_001 }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(true)

    expect(
      isReusableZohoSession(
        reusableView({ expiresAt: NOW - 1 }),
        "100.00",
        "INR",
        "widget",
        "live",
        NOW
      )
    ).toBe(false)
  })
})

describe("buildZohoSessionData", () => {
  const required = {
    zohoSessionId: "zoho_sess_1",
    environment: "live" as const,
    checkoutMode: "widget" as const,
    amount: "100.00",
    currencyCode: "INR",
    currencySymbol: "₹",
    description: "Order payment",
    invoiceNumber: "payses_1",
    expiresAt: NOW + 900_000,
  }

  it("builds the required fields without optional keys", () => {
    expect(buildZohoSessionData(required)).toEqual(required)
  })

  it("includes optional fields when present", () => {
    const previous = ["zoho_old_1", "zoho_old_2"]

    expect(
      buildZohoSessionData({
        ...required,
        medusaSessionId: "payses_1",
        widget: WIDGET,
        businessName: "Zylker",
        checkoutUrl: "https://checkout.example.test/access",
        previousZohoSessionIds: previous,
      })
    ).toEqual({
      ...required,
      medusaSessionId: "payses_1",
      widget: WIDGET,
      businessName: "Zylker",
      checkoutUrl: "https://checkout.example.test/access",
      previousZohoSessionIds: previous,
    })
  })

  it("omits empty optional values", () => {
    const data = buildZohoSessionData({
      ...required,
      medusaSessionId: "",
      checkoutUrl: "",
      previousZohoSessionIds: [],
    })

    expect(data).not.toHaveProperty("medusaSessionId")
    expect(data).not.toHaveProperty("checkoutUrl")
    expect(data).not.toHaveProperty("previousZohoSessionIds")
  })
})

describe("stripProviderOwnedSessionData", () => {
  it("removes every provider-owned key and preserves session_id/custom data", () => {
    const sanitized = stripProviderOwnedSessionData({
      session_id: "payses_1",
      custom: "keep",
      zohoSessionId: "zoho_sess_evil",
      paymentId: "zoho_pay_evil",
      paymentStatus: "succeeded",
      amount: "0.01",
      widget: { accountId: "bad" },
    })

    expect(sanitized).toEqual({
      session_id: "payses_1",
      custom: "keep",
    })
  })

  it("returns an empty object for undefined data", () => {
    expect(stripProviderOwnedSessionData(undefined)).toEqual({})
  })
})

describe("sandbox widget metadata", () => {
  it("parses and preserves the widget test-mode flag", () => {
    const parsed = parseZohoSessionData({
      widget: {
        accountId: "acct_in",
        domain: "IN",
        apiKey: "key",
        isTestMode: true,
      },
    })

    expect(parsed.widget).toEqual({
      accountId: "acct_in",
      domain: "IN",
      apiKey: "key",
      isTestMode: true,
    })
  })

  it("omits a false or invalid test-mode flag", () => {
    expect(
      parseZohoSessionData({
        widget: {
          accountId: "acct_in",
          domain: "IN",
          apiKey: "key",
          isTestMode: false,
        },
      }).widget
    ).not.toHaveProperty("isTestMode")

    expect(
      parseZohoSessionData({
        widget: {
          accountId: "acct_in",
          domain: "IN",
          apiKey: "key",
          isTestMode: "yes",
        },
      }).widget
    ).not.toHaveProperty("isTestMode")
  })
})

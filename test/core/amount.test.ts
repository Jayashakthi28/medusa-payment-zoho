import type { BigNumberInput } from "@medusajs/framework/types"
import type * as FrameworkUtils from "@medusajs/framework/utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  formatAmountForZoho,
  formatAmountStringForZoho,
  getCurrencyFractionDigits,
  getCurrencySymbol,
  isPositiveAmount,
  normalizeCurrencyCode,
} from "../../src/core/amount"
import { ZohoValidationError } from "../../src/core/errors"

type NumberFormatFactory = (
  locale?: string | string[],
  options?: Intl.NumberFormatOptions
) => Intl.NumberFormat

interface NumberFormatStub {
  resolvedOptions?: () => Intl.ResolvedNumberFormatOptions
  formatToParts?: (value: number) => Intl.NumberFormatPart[]
}

function useNumberFormat(factory: NumberFormatFactory): void {
  vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
    this: unknown,
    locale?: string | string[],
    options?: Intl.NumberFormatOptions
  ) {
    return factory(locale, options)
  } as unknown as typeof Intl.NumberFormat)
}

function makeNumberFormat(stub: NumberFormatStub = {}): Intl.NumberFormat {
  return {
    resolvedOptions:
      stub.resolvedOptions ??
      (() =>
        ({
          maximumFractionDigits: 2,
        }) as unknown as Intl.ResolvedNumberFormatOptions),
    formatToParts: stub.formatToParts ?? (() => []),
  } as unknown as Intl.NumberFormat
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  return undefined
}

function expectValidationError(action: () => unknown, message?: string): void {
  const error = captureError(action)

  expect(error).toBeInstanceOf(ZohoValidationError)
  expect(error).toHaveProperty("code", "ZOHO_VALIDATION_ERROR")

  if (message !== undefined) {
    expect(error).toHaveProperty("message", message)
  }
}

afterEach(() => {
  vi.doUnmock("@medusajs/framework/utils")
  vi.resetModules()
})

describe("normalizeCurrencyCode", () => {
  it.each([
    ["INR", "INR"],
    ["inr", "INR"],
    ["  usd  ", "USD"],
    ["Jpy", "JPY"],
    ["kwd", "KWD"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCurrencyCode(input)).toBe(expected)
  })

  it.each(["", "US", "USDD", "12A", "U S", "₹", "in r"])(
    "rejects invalid currency code %j",
    (input) => {
      expectValidationError(
        () => normalizeCurrencyCode(input),
        `Invalid ISO-4217 currency code: "${input}"`
      )
    }
  )
})

describe("getCurrencyFractionDigits", () => {
  it.each([
    ["INR", 2],
    ["USD", 2],
    ["JPY", 0],
    ["KWD", 3],
    ["bhd", 3],
  ] as const)("returns %i fraction digits for %s", (currency, expected) => {
    expect(getCurrencyFractionDigits(currency)).toBe(expected)
  })

  it("rejects a currency code that is not ISO-4217 shaped", () => {
    expectValidationError(
      () => getCurrencyFractionDigits("US"),
      'Invalid ISO-4217 currency code: "US"'
    )
  })

  it("wraps an Intl formatting failure in a validation error", () => {
    useNumberFormat(() => {
      throw new RangeError("no currency data")
    })

    const error = captureError(() => getCurrencyFractionDigits("INR"))

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toHaveProperty("code", "ZOHO_VALIDATION_ERROR")
    expect(error).toHaveProperty(
      "message",
      'Unsupported currency for formatting: "INR"'
    )
    expect(error).toHaveProperty("cause", expect.any(RangeError))
  })

  it("falls back to two fraction digits when Intl omits the option", () => {
    useNumberFormat(() =>
      makeNumberFormat({
        resolvedOptions: () => ({}) as unknown as Intl.ResolvedNumberFormatOptions,
      })
    )

    expect(getCurrencyFractionDigits("INR")).toBe(2)
  })
})

describe("getCurrencySymbol", () => {
  it.each([
    ["INR", "₹"],
    ["USD", "$"],
    ["JPY", "¥"],
    ["inr", "₹"],
  ])("returns the Intl symbol for %s", (currency, expected) => {
    expect(getCurrencySymbol(currency)).toBe(expected)
  })

  it("uses a merchant override keyed by the normalized currency code", () => {
    expect(getCurrencySymbol("inr", { INR: "Rs." })).toBe("Rs.")
  })

  it("ignores overrides for other currencies", () => {
    expect(getCurrencySymbol("INR", { USD: "$" })).toBe("₹")
  })

  it("ignores an empty override and falls back to Intl", () => {
    expect(getCurrencySymbol("INR", { INR: "" })).toBe("₹")
  })

  it("falls back to the currency code when Intl has no symbol part", () => {
    useNumberFormat(() => makeNumberFormat({ formatToParts: () => [] }))

    expect(getCurrencySymbol("INR")).toBe("INR")
  })

  it("rejects a malformed currency code", () => {
    expectValidationError(
      () => getCurrencySymbol("US"),
      'Invalid ISO-4217 currency code: "US"'
    )
  })

  it("wraps an Intl symbol lookup failure in a validation error", () => {
    useNumberFormat(() => {
      throw new RangeError("no currency data")
    })

    const error = captureError(() => getCurrencySymbol("INR"))

    expect(error).toBeInstanceOf(ZohoValidationError)
    expect(error).toHaveProperty("code", "ZOHO_VALIDATION_ERROR")
    expect(error).toHaveProperty("message", 'Unsupported currency symbol: "INR"')
    expect(error).toHaveProperty("cause", expect.any(RangeError))
  })
})

describe("formatAmountForZoho", () => {
  it.each([
    [100, "INR", "100.00"],
    ["100.5", "INR", "100.50"],
    [0, "USD", "0.00"],
    [-5.5, "USD", "-5.50"],
    ["-0", "INR", "0.00"],
    [100.9, "JPY", "101"],
    ["100.4", "JPY", "100"],
    ["1.2345", "KWD", "1.235"],
    ["12345678901234567890.123", "INR", "12345678901234567890.12"],
    [0.1 + 0.2, "USD", "0.30"],
    ["1e3", "USD", "1000.00"],
  ] as const)("formats %j %s as %j", (amount, currency, expected) => {
    expect(formatAmountForZoho(amount, currency)).toBe(expected)
  })

  it("rejects a malformed currency code", () => {
    expectValidationError(
      () => formatAmountForZoho("10.00", "US"),
      'Invalid ISO-4217 currency code: "US"'
    )
  })

  it.each(["ABC", "", " ", "NaN", "Infinity", "-Infinity", "1,000"])(
    "rejects invalid amount input %j",
    (amount) => {
      expectValidationError(() => formatAmountForZoho(amount, "INR"))
    }
  )

  it("wraps an invalid BigNumber input in a validation error", () => {
    const invalidAmount = null as unknown as BigNumberInput

    expectValidationError(() => formatAmountForZoho(invalidAmount, "INR"))
  })

  it("rejects a BigNumber instance that exposes no decimal value", async () => {
    vi.resetModules()
    vi.doMock("@medusajs/framework/utils", async (importOriginal) => {
      const actual = await importOriginal<typeof FrameworkUtils>()

      return {
        ...actual,
        BigNumber: class {
          readonly bigNumber = undefined
        },
      }
    })

    const [amountModule, errorsModule] = await Promise.all([
      import("../../src/core/amount"),
      import("../../src/core/errors"),
    ])

    expect(() => amountModule.formatAmountForZoho("10.00", "INR")).toThrow(
      errorsModule.ZohoValidationError
    )
  })
})

describe("formatAmountStringForZoho", () => {
  it("formats a decimal string for the currency", () => {
    expect(formatAmountStringForZoho("42.5", "USD")).toBe("42.50")
  })

  it("rejects an invalid decimal string", () => {
    expectValidationError(() => formatAmountStringForZoho("oops", "USD"))
  })
})

describe("isPositiveAmount", () => {
  it.each([
    [1, true],
    ["0.01", true],
    ["0.0000000000000000001", true],
    [0, false],
    ["0", false],
    ["-0", false],
    [-1, false],
    ["-0.01", false],
  ] as const)("returns %s for %j", (amount, expected) => {
    expect(isPositiveAmount(amount)).toBe(expected)
  })

  it.each(["ABC", "", "Infinity", "-Infinity"])(
    "rejects invalid amount input %j",
    (amount) => {
      expectValidationError(() => isPositiveAmount(amount))
    }
  )

  it("rejects a value that is not a BigNumber input", () => {
    const invalidAmount = null as unknown as BigNumberInput

    expectValidationError(() => isPositiveAmount(invalidAmount))
  })
})

describe("precision boundary protection", () => {
  it.each([
    [0.001, "INR"],
    [0.1, "JPY"],
    ["0.0001", "KWD"],
  ] as const)(
    "rejects positive amount %s that rounds to zero in %s",
    (amount, currency) => {
      expectValidationError(() => formatAmountForZoho(amount, currency))
    }
  )

  it("allows zero without treating it as a rounded positive amount", () => {
    expect(formatAmountForZoho(0, "INR")).toBe("0.00")
  })

  it("rounds a representable sub-cent amount to the currency precision", () => {
    expect(formatAmountForZoho(0.005, "INR")).toBe("0.01")
  })
})

import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber } from "@medusajs/framework/utils"
import { ZohoValidationError } from "./errors"

const ISO_CURRENCY_CODE = /^[A-Z]{3}$/

/** Uppercase and validate an ISO-4217 currency code. */
export function normalizeCurrencyCode(currencyCode: string): string {
  const normalized = currencyCode.trim().toUpperCase()

  if (!ISO_CURRENCY_CODE.test(normalized)) {
    throw new ZohoValidationError(`Invalid ISO-4217 currency code: "${currencyCode}"`)
  }

  return normalized
}

/** Number of fraction digits Zoho expects for a currency (e.g. 2 for INR, 0 for JPY). */
export function getCurrencyFractionDigits(currencyCode: string): number {
  const normalized = normalizeCurrencyCode(currencyCode)

  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    })

    return formatter.resolvedOptions().maximumFractionDigits ?? 2
  } catch (error) {
    throw new ZohoValidationError(
      `Unsupported currency for formatting: "${currencyCode}"`,
      { cause: error }
    )
  }
}

/** Display symbol for the widget, with optional merchant overrides. */
export function getCurrencySymbol(
  currencyCode: string,
  overrides: Readonly<Record<string, string>> = {}
): string {
  const normalized = normalizeCurrencyCode(currencyCode)
  const override = overrides[normalized]

  if (override) {
    return override
  }

  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).formatToParts(0)

    return parts.find((part) => part.type === "currency")?.value ?? normalized
  } catch (error) {
    throw new ZohoValidationError(`Unsupported currency symbol: "${currencyCode}"`, {
      cause: error,
    })
  }
}

type Decimal = NonNullable<BigNumber["bigNumber"]>

/**
 * Convert an amount to a finite decimal.
 *
 * `BigNumber` silently represents malformed strings as `NaN` and accepts
 * `"Infinity"`, both of which would otherwise reach Zoho as an amount. A generic
 * constructor error is also converted to a typed error so callers never receive an
 * untyped failure from a payment boundary.
 */
function toFiniteDecimal(amount: BigNumberInput): Decimal {
  let value: BigNumber

  try {
    value = new BigNumber(amount)
  } catch (error) {
    throw new ZohoValidationError("Unable to format payment amount", {
      cause: error,
    })
  }

  const decimal = value.bigNumber

  if (!decimal) {
    throw new ZohoValidationError("Unable to format payment amount")
  }

  if (decimal.isNaN() || !decimal.isFinite()) {
    throw new ZohoValidationError("Unable to format payment amount")
  }

  return decimal
}

/**
 * Format a Medusa amount (major units) as the decimal string Zoho expects.
 *
 * Zoho amounts are strings in major units, unlike Stripe's minor-unit integers. The
 * conversion uses bignumber.js from Medusa's own `BigNumber`, so no binary floating
 * point arithmetic is involved.
 */
export function formatAmountForZoho(
  amount: BigNumberInput,
  currencyCode: string
): string {
  const digits = getCurrencyFractionDigits(currencyCode)

  const decimal = toFiniteDecimal(amount)
  const formatted = decimal.toFixed(digits)

  if (decimal.gt(0) && !toFiniteDecimal(formatted).gt(0)) {
    throw new ZohoValidationError(
      `Amount ${decimal.toString()} is smaller than the supported precision for ${normalizeCurrencyCode(currencyCode)}`
    )
  }

  return formatted
}

/** Format an already-decimal amount string for Zoho. */
export function formatAmountStringForZoho(
  amount: string,
  currencyCode: string
): string {
  return formatAmountForZoho(amount, currencyCode)
}

/** True when the amount is strictly greater than zero. */
export function isPositiveAmount(amount: BigNumberInput): boolean {
  return toFiniteDecimal(amount).gt(0)
}

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
  const value = new BigNumber(amount)
  const decimal = value.bigNumber

  if (!decimal) {
    throw new ZohoValidationError("Unable to format payment amount")
  }

  return decimal.toFixed(digits)
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
  return new BigNumber(amount).numeric > 0
}

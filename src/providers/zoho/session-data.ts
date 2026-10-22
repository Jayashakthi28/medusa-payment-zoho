import type {
  ZohoCheckoutMode,
  ZohoPaymentSessionData,
  ZohoWidgetSessionConfig,
} from "../../types"
import { ZohoValidationError } from "../../core/errors"
import { isCapturedPaymentStatus } from "../../core/status"
import type { ZohoMetadataEntry } from "./types"

/** Metadata key carrying the Medusa payment-session ID. */
export const MEDUSA_SESSION_ID_METADATA_KEY = "medusa_session_id"
/** Metadata key carrying the Zoho payment-session ID. */
export const ZOHO_SESSION_ID_METADATA_KEY = "zoho_session_id"

const ZOHO_SESSION_SAFETY_WINDOW_MS = 60_000
const MAX_ZOHO_METADATA_ENTRIES = 5

/**
 * Keys owned by the provider. Medusa accepts arbitrary `data` from the storefront when
 * a payment session is initialized, so these keys must never be read from raw input or
 * carried through from a caller: otherwise a customer could inject another payment's ID.
 */
const PROVIDER_OWNED_SESSION_KEYS = new Set([
  "zohoSessionId",
  "checkoutMode",
  "amount",
  "currencyCode",
  "currencySymbol",
  "description",
  "businessName",
  "invoiceNumber",
  "expiresAt",
  "widget",
  "checkoutUrl",
  "medusaSessionId",
  "paymentId",
  "paymentStatus",
  "previousZohoSessionIds",
  "lastRefundId",
  "lastRefundStatus",
  "lastRefundIdempotencyKey",
])

/** Validated, read-only view over untrusted session data. */
export interface ZohoSessionDataView {
  zohoSessionId?: string
  checkoutMode?: ZohoCheckoutMode
  amount?: string
  currencyCode?: string
  currencySymbol?: string
  description?: string
  businessName?: string
  invoiceNumber?: string
  expiresAt?: number
  widget?: ZohoWidgetSessionConfig
  checkoutUrl?: string
  medusaSessionId?: string
  paymentId?: string
  paymentStatus?: string
  previousZohoSessionIds?: string[]
  lastRefundId?: string
  lastRefundStatus?: string
  lastRefundIdempotencyKey?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(
  source: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = source[key]

  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  )

  return strings.length === 0 ? undefined : strings
}

function readCheckoutMode(
  source: Record<string, unknown>
): ZohoCheckoutMode | undefined {
  const value = source.checkoutMode
  return value === "widget" || value === "hosted" ? value : undefined
}

function readWidgetConfig(
  source: Record<string, unknown>
): ZohoWidgetSessionConfig | undefined {
  const value = source.widget

  if (!isRecord(value)) {
    return undefined
  }

  const accountId = readString(value, "accountId")
  const apiKey = readString(value, "apiKey")
  const domain = value.domain

  if (!accountId || !apiKey || (domain !== "IN" && domain !== "US")) {
    return undefined
  }

  return { accountId, domain, apiKey }
}

/**
 * Remove every provider-owned key from untrusted input while preserving Medusa's
 * injected `session_id` and any caller-defined custom data.
 */
export function stripProviderOwnedSessionData(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).filter(([key]) => !PROVIDER_OWNED_SESSION_KEYS.has(key))
  )
}

/** Safely read the provider-owned fields from Medusa's payment-session data. */
export function parseZohoSessionData(
  raw: Record<string, unknown> | undefined
): ZohoSessionDataView {
  const source = raw ?? {}

  return {
    zohoSessionId: readString(source, "zohoSessionId"),
    checkoutMode: readCheckoutMode(source),
    amount: readString(source, "amount"),
    currencyCode: readString(source, "currencyCode"),
    currencySymbol: readString(source, "currencySymbol"),
    description: readString(source, "description"),
    businessName: readString(source, "businessName"),
    invoiceNumber: readString(source, "invoiceNumber"),
    expiresAt: readNumber(source, "expiresAt"),
    widget: readWidgetConfig(source),
    checkoutUrl: readString(source, "checkoutUrl"),
    medusaSessionId: readString(source, "medusaSessionId"),
    paymentId: readString(source, "paymentId"),
    paymentStatus: readString(source, "paymentStatus"),
    previousZohoSessionIds: readStringArray(source, "previousZohoSessionIds"),
    lastRefundId: readString(source, "lastRefundId"),
    lastRefundStatus: readString(source, "lastRefundStatus"),
    lastRefundIdempotencyKey: readString(source, "lastRefundIdempotencyKey"),
  }
}

/** Build metadata entries for a Zoho payment session, preserving the 5-entry limit. */
export function buildZohoMetadataEntries(
  extra: Readonly<Record<string, string>>,
  medusaSessionId: string | undefined
): ZohoMetadataEntry[] {
  const entries: ZohoMetadataEntry[] = []

  if (medusaSessionId) {
    entries.push({
      key: MEDUSA_SESSION_ID_METADATA_KEY,
      value: medusaSessionId,
    })
  }

  for (const [key, value] of Object.entries(extra)) {
    entries.push({ key, value })
  }

  if (entries.length > MAX_ZOHO_METADATA_ENTRIES) {
    throw new ZohoValidationError(
      `Zoho metadata supports at most ${MAX_ZOHO_METADATA_ENTRIES} entries`
    )
  }

  return entries
}

/** Read a value from Zoho's metadata array. */
export function findZohoMetadataValue(
  entries: readonly ZohoMetadataEntry[] | undefined,
  key: string
): string | undefined {
  return entries?.find((entry) => entry.key === key)?.value
}

/** Resolve the Medusa session ID from a Zoho payment, with a reference fallback. */
export function extractMedusaSessionId(payment: {
  meta_data?: ZohoMetadataEntry[]
  reference_number?: string
}): string | undefined {
  const metadataValue = findZohoMetadataValue(
    payment.meta_data,
    MEDUSA_SESSION_ID_METADATA_KEY
  )

  if (metadataValue) {
    return metadataValue
  }

  const reference = payment.reference_number

  return typeof reference === "string" && reference.length > 0 ? reference : undefined
}

/** Resolve the Zoho session ID from a webhook payment object. */
export function extractZohoSessionId(payment: {
  payments_session_id?: string
  meta_data?: ZohoMetadataEntry[]
}): string | undefined {
  const sessionId = payment.payments_session_id

  if (typeof sessionId === "string" && sessionId.length > 0) {
    return sessionId
  }

  const metadataValue = findZohoMetadataValue(
    payment.meta_data,
    ZOHO_SESSION_ID_METADATA_KEY
  )

  return metadataValue && metadataValue.length > 0 ? metadataValue : undefined
}

/**
 * A session can be reused only when it is unpaid, matches the cart exactly, and is
 * comfortably before Zoho's 15-minute expiry.
 */
export function isReusableZohoSession(
  existing: ZohoSessionDataView,
  amount: string,
  currencyCode: string,
  checkoutMode: ZohoCheckoutMode,
  now: number
): boolean {
  return (
    !existing.paymentId &&
    !isCapturedPaymentStatus(existing.paymentStatus) &&
    existing.zohoSessionId !== undefined &&
    existing.amount === amount &&
    existing.currencyCode === currencyCode &&
    existing.checkoutMode === checkoutMode &&
    existing.expiresAt !== undefined &&
    existing.expiresAt > now + ZOHO_SESSION_SAFETY_WINDOW_MS
  )
}

/** Normalize Zoho `expiry_time`, which is documented as seconds but may be millis. */
export function normalizeZohoExpiryTime(
  expiryTime: number | undefined,
  fallbackNow: number,
  fallbackSeconds = 900
): number {
  const fallback = fallbackNow + fallbackSeconds * 1000

  // A non-finite or non-positive expiry would make the session look reusable
  // forever (Infinity) or produce `null` when Medusa serializes NaN. Fall back to
  // Zoho's documented 15-minute lifetime instead of persisting bad data.
  if (
    typeof expiryTime !== "number" ||
    !Number.isFinite(expiryTime) ||
    expiryTime <= 0
  ) {
    return fallback
  }

  return expiryTime > 1_000_000_000_000 ? expiryTime : expiryTime * 1000
}

/** Build the provider-owned session data returned to Medusa. */
export function buildZohoSessionData(input: {
  zohoSessionId: string
  checkoutMode: ZohoCheckoutMode
  amount: string
  currencyCode: string
  currencySymbol: string
  description: string
  businessName?: string
  invoiceNumber: string
  expiresAt: number
  medusaSessionId?: string
  widget?: ZohoWidgetSessionConfig
  checkoutUrl?: string
  previousZohoSessionIds?: string[]
}): ZohoPaymentSessionData {
  return {
    zohoSessionId: input.zohoSessionId,
    checkoutMode: input.checkoutMode,
    amount: input.amount,
    currencyCode: input.currencyCode,
    currencySymbol: input.currencySymbol,
    description: input.description,
    invoiceNumber: input.invoiceNumber,
    expiresAt: input.expiresAt,
    ...(input.businessName ? { businessName: input.businessName } : {}),
    ...(input.medusaSessionId ? { medusaSessionId: input.medusaSessionId } : {}),
    ...(input.widget ? { widget: input.widget } : {}),
    ...(input.checkoutUrl ? { checkoutUrl: input.checkoutUrl } : {}),
    ...(input.previousZohoSessionIds?.length
      ? { previousZohoSessionIds: input.previousZohoSessionIds }
      : {}),
  }
}

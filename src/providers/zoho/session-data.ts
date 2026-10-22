import type {
  ZohoCheckoutMode,
  ZohoPaymentSessionData,
  ZohoWidgetSessionConfig,
} from "../../types"
import type { ZohoMetadataEntry } from "./types"

/** Metadata key carrying the Medusa payment-session ID. */
export const MEDUSA_SESSION_ID_METADATA_KEY = "medusa_session_id"
/** Metadata key carrying the Zoho payment-session ID. */
export const ZOHO_SESSION_ID_METADATA_KEY = "zoho_session_id"

const ZOHO_SESSION_SAFETY_WINDOW_MS = 60_000
const MAX_ZOHO_METADATA_ENTRIES = 5

/** Validated, read-only view over untrusted session data. */
export interface ZohoSessionDataView {
  zohoSessionId?: string
  checkoutMode?: ZohoCheckoutMode
  amount?: string
  currencyCode?: string
  currencySymbol?: string
  description?: string
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
    throw new Error(
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
  return (
    findZohoMetadataValue(payment.meta_data, MEDUSA_SESSION_ID_METADATA_KEY) ??
    (payment.reference_number && payment.reference_number.length > 0
      ? payment.reference_number
      : undefined)
  )
}

/** Resolve the Zoho session ID from a webhook payment object. */
export function extractZohoSessionId(payment: {
  payments_session_id?: string
  meta_data?: ZohoMetadataEntry[]
}): string | undefined {
  return (
    payment.payments_session_id ??
    findZohoMetadataValue(payment.meta_data, ZOHO_SESSION_ID_METADATA_KEY)
  )
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
  if (expiryTime === undefined) {
    return fallbackNow + fallbackSeconds * 1000
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
    ...(input.medusaSessionId ? { medusaSessionId: input.medusaSessionId } : {}),
    ...(input.widget ? { widget: input.widget } : {}),
    ...(input.checkoutUrl ? { checkoutUrl: input.checkoutUrl } : {}),
    ...(input.previousZohoSessionIds?.length
      ? { previousZohoSessionIds: input.previousZohoSessionIds }
      : {}),
  }
}

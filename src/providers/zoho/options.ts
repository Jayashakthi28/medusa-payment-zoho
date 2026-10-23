import { normalizeCurrencyCode } from "../../core/amount"
import { ZohoConfigurationError } from "../../core/errors"
import type {
  ResolvedZohoPaymentOptions,
  ZohoPaymentOptions,
  ZohoRegionConfig,
} from "./types"
import type { ZohoRegion } from "../../types"

/** India — the plugin default. */
export const INDIA_REGION_CONFIG: ZohoRegionConfig = {
  apiBaseUrl: "https://payments.zoho.in/api/v1/",
  accountsBaseUrl: "https://accounts.zoho.in/",
  hostedCheckoutBaseUrl: "https://payments.zoho.in/hostedcheckout",
  widgetDomain: "IN",
}

/** United States. */
export const US_REGION_CONFIG: ZohoRegionConfig = {
  apiBaseUrl: "https://payments.zoho.com/api/v1/",
  accountsBaseUrl: "https://accounts.zoho.com/",
  hostedCheckoutBaseUrl: "https://payments.zoho.com/hostedcheckout",
  widgetDomain: "US",
}

/** India sandbox. Zoho currently documents sandbox only for the India region. */
export const INDIA_SANDBOX_REGION_CONFIG: ZohoRegionConfig = {
  apiBaseUrl: "https://paymentssandbox.zoho.in/api/v1/",
  accountsBaseUrl: "https://accounts.zoho.in/",
  hostedCheckoutBaseUrl: "https://paymentssandbox.zoho.in/hostedcheckout",
  widgetDomain: "IN",
}

const REGION_CONFIGS: Record<ZohoRegion, ZohoRegionConfig> = {
  in: INDIA_REGION_CONFIG,
  us: US_REGION_CONFIG,
}

const RESERVED_METADATA_KEYS = new Set(["medusa_session_id", "zoho_session_id"])
const MAX_EXTRA_METADATA_ENTRIES = 3
const MAX_METADATA_VALUE_LENGTH = 500

let hasWarnedMissingSigningKey = false

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ZohoConfigurationError(
      `Required Zoho Payments option "${key}" is missing`
    )
  }

  return value.trim()
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength = 500
): string | undefined {
  const value = source[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${key}" must be a non-empty string`
    )
  }

  const trimmed = value.trim()

  if (trimmed.length > maxLength) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${key}" must be at most ${maxLength} characters`
    )
  }

  return trimmed
}

function integerOption(
  source: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const value = source[key]

  if (value === undefined) {
    return defaultValue
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${key}" must be an integer between ${minimum} and ${maximum}`
    )
  }

  return value
}

function booleanOption(
  source: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = source[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "boolean") {
    throw new ZohoConfigurationError(`Zoho Payments option "${key}" must be a boolean`)
  }

  return value
}

function validateUrl(name: string, value: string): string {
  let url: URL

  try {
    url = new URL(value)
  } catch (error) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${name}" must be a valid URL`,
      { cause: error }
    )
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${name}" must use http or https`
    )
  }

  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  const isProduction = process.env.NODE_ENV === "production"

  if (isProduction && url.protocol !== "https:" && !isLocalhost) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "${name}" must use https in production`
    )
  }

  return value
}

function resolveRegionConfig(
  region: ZohoRegion,
  environment: "live" | "sandbox",
  source: Record<string, unknown>
): ZohoRegionConfig {
  const defaults =
    environment === "sandbox" ? INDIA_SANDBOX_REGION_CONFIG : REGION_CONFIGS[region]
  const apiBaseUrl = optionalString(source, "apiBaseUrl") ?? defaults.apiBaseUrl
  const accountsBaseUrl =
    optionalString(source, "accountsBaseUrl") ?? defaults.accountsBaseUrl
  const hostedCheckoutBaseUrl =
    optionalString(source, "hostedCheckoutBaseUrl") ?? defaults.hostedCheckoutBaseUrl

  return {
    apiBaseUrl: validateUrl("apiBaseUrl", apiBaseUrl),
    accountsBaseUrl: validateUrl("accountsBaseUrl", accountsBaseUrl),
    hostedCheckoutBaseUrl: validateUrl("hostedCheckoutBaseUrl", hostedCheckoutBaseUrl),
    widgetDomain: defaults.widgetDomain,
  }
}

function resolveAllowedPaymentMethods(
  source: Record<string, unknown>
): string[] | undefined {
  const value = source.allowedPaymentMethods

  if (value === undefined) {
    return undefined
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new ZohoConfigurationError(
      'Zoho Payments option "allowedPaymentMethods" must be an array of non-empty strings'
    )
  }

  const deduplicated = [...new Set(value as string[])]

  return deduplicated.length > 0 ? deduplicated : undefined
}

function resolveCurrencySymbols(
  source: Record<string, unknown>
): Record<string, string> {
  const value = source.currencySymbols

  if (value === undefined) {
    return {}
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ZohoConfigurationError(
      'Zoho Payments option "currencySymbols" must be an object'
    )
  }

  const symbols: Record<string, string> = {}

  for (const [currency, symbol] of Object.entries(value)) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
      throw new ZohoConfigurationError(
        `Zoho Payments currency symbol for "${currency}" must be a non-empty string`
      )
    }

    symbols[normalizeCurrencyCode(currency)] = symbol
  }

  return symbols
}

function resolveMetadata(source: Record<string, unknown>): Record<string, string> {
  const value = source.metadata

  if (value === undefined) {
    return {}
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ZohoConfigurationError(
      'Zoho Payments option "metadata" must be an object'
    )
  }

  const entries = Object.entries(value)

  if (entries.length > MAX_EXTRA_METADATA_ENTRIES) {
    throw new ZohoConfigurationError(
      `Zoho Payments option "metadata" supports at most ${MAX_EXTRA_METADATA_ENTRIES} entries`
    )
  }

  const metadata: Record<string, string> = {}

  for (const [key, entry] of entries) {
    if (key.length === 0 || RESERVED_METADATA_KEYS.has(key)) {
      throw new ZohoConfigurationError(
        `Zoho Payments metadata key "${key}" is reserved`
      )
    }

    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > MAX_METADATA_VALUE_LENGTH
    ) {
      throw new ZohoConfigurationError(
        `Zoho Payments metadata value for "${key}" must be a non-empty string of at most ${MAX_METADATA_VALUE_LENGTH} characters`
      )
    }

    metadata[key] = entry
  }

  return metadata
}

function resolveLogger(source: Record<string, unknown>): ZohoPaymentOptions["logger"] {
  const value = source.logger

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ZohoConfigurationError('Zoho Payments option "logger" must be an object')
  }

  const logger = value as Record<string, unknown>

  // A logger without all three methods would fail mid-payment, after Zoho has
  // already been called. Reject it at startup instead.
  for (const method of ["debug", "warn", "error"] as const) {
    if (typeof logger[method] !== "function") {
      throw new ZohoConfigurationError(
        `Zoho Payments option "logger" must provide a ${method}() method`
      )
    }
  }

  return value as ZohoPaymentOptions["logger"]
}

function resolveFetch(source: Record<string, unknown>): typeof fetch | undefined {
  const value = source.fetch

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "function") {
    throw new ZohoConfigurationError('Zoho Payments option "fetch" must be a function')
  }

  return value as typeof fetch
}

/** Validate and resolve provider options, applying India-first defaults. */
export function resolveZohoPaymentOptions(
  options: ZohoPaymentOptions
): ResolvedZohoPaymentOptions {
  const source = options as unknown as Record<string, unknown>
  const regionValue = optionalString(source, "region") ?? "in"

  if (regionValue !== "in" && regionValue !== "us") {
    throw new ZohoConfigurationError(
      'Zoho Payments option "region" must be "in" or "us"'
    )
  }

  const region = regionValue
  const environmentValue = optionalString(source, "environment") ?? "live"

  if (environmentValue !== "live" && environmentValue !== "sandbox") {
    throw new ZohoConfigurationError(
      'Zoho Payments option "environment" must be "live" or "sandbox"'
    )
  }

  const environment = environmentValue

  if (environment === "sandbox" && region !== "in") {
    throw new ZohoConfigurationError(
      'Zoho Payments sandbox is currently supported only with region "in"'
    )
  }

  const checkoutModeValue = optionalString(source, "checkoutMode") ?? "widget"

  if (checkoutModeValue !== "widget" && checkoutModeValue !== "hosted") {
    throw new ZohoConfigurationError(
      'Zoho Payments option "checkoutMode" must be "widget" or "hosted"'
    )
  }

  const checkoutMode = checkoutModeValue
  const apiKey = optionalString(source, "apiKey")
  const successUrl = optionalString(source, "successUrl")
  const failureUrl = optionalString(source, "failureUrl")

  if (checkoutMode === "widget" && !apiKey) {
    throw new ZohoConfigurationError(
      'Zoho Payments option "apiKey" is required when checkoutMode is "widget"'
    )
  }

  if (checkoutMode === "hosted") {
    if (!successUrl) {
      throw new ZohoConfigurationError(
        'Zoho Payments option "successUrl" is required when checkoutMode is "hosted"'
      )
    }

    if (!failureUrl) {
      throw new ZohoConfigurationError(
        'Zoho Payments option "failureUrl" is required when checkoutMode is "hosted"'
      )
    }
  }

  // Validate URLs whenever they are supplied, even in widget mode: a malformed
  // value should fail at startup rather than after the merchant switches modes.
  if (successUrl) {
    validateUrl("successUrl", successUrl)
  }

  if (failureUrl) {
    validateUrl("failureUrl", failureUrl)
  }

  const regionConfig = resolveRegionConfig(region, environment, source)
  const allowedPaymentMethods = resolveAllowedPaymentMethods(source)
  const currencySymbols = resolveCurrencySymbols(source)
  const metadata = resolveMetadata(source)

  // The resolved options are treated as immutable by the provider, so freeze the
  // nested collections too. A shallow freeze would still allow callers to mutate
  // metadata or replace a region URL at runtime.
  Object.freeze(regionConfig)
  Object.freeze(currencySymbols)
  Object.freeze(metadata)

  if (allowedPaymentMethods) {
    Object.freeze(allowedPaymentMethods)
  }

  const resolved: ResolvedZohoPaymentOptions = {
    accountId: requiredString(source, "accountId"),
    clientId: requiredString(source, "clientId"),
    clientSecret: requiredString(source, "clientSecret"),
    refreshToken: requiredString(source, "refreshToken"),
    region,
    environment,
    regionConfig,
    checkoutMode,
    apiKey,
    businessName: optionalString(source, "businessName", 100),
    allowedPaymentMethods,
    paymentDescription:
      optionalString(source, "paymentDescription", 500) ?? "Medusa order payment",
    successUrl,
    failureUrl,
    signingKey: optionalString(source, "signingKey", 512),
    liveMode: booleanOption(source, "liveMode"),
    timeoutMs: integerOption(source, "timeoutMs", 15_000, 1, 120_000),
    maxRetries: integerOption(source, "maxRetries", 3, 0, 10),
    retryBaseDelayMs: integerOption(source, "retryBaseDelayMs", 500, 0, 60_000),
    pollAttempts: integerOption(source, "pollAttempts", 3, 0, 10),
    pollIntervalMs: integerOption(source, "pollIntervalMs", 500, 0, 10_000),
    webhookToleranceSeconds: integerOption(
      source,
      "webhookToleranceSeconds",
      0,
      0,
      86_400
    ),
    currencySymbols,
    metadata,
    fetch: resolveFetch(source),
    logger: resolveLogger(source),
  }

  return Object.freeze(resolved)
}

/** Startup validation used by Medusa's provider loader. */
export function validateZohoPaymentOptions(options: Record<string, unknown>): void {
  const resolved = resolveZohoPaymentOptions(options as unknown as ZohoPaymentOptions)

  if (!resolved.signingKey && !hasWarnedMissingSigningKey) {
    hasWarnedMissingSigningKey = true
    console.warn(
      "Zoho Payments option `signingKey` is missing. Signed webhooks and widget/return signatures cannot be verified. Configure the Developer Space signing key before accepting live payments."
    )
  }
}

/** Reset the one-time warning flag. Exposed for tests only. */
export function resetSigningKeyWarningForTests(): void {
  hasWarnedMissingSigningKey = false
}

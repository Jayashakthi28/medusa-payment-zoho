import type {
  ZohoCheckoutMode,
  ZohoEnvironment,
  ZohoPaymentLogger,
  ZohoRegion,
  ZohoWidgetDomain,
} from "../../types"

/** A Zoho metadata entry. Zoho accepts at most five entries per resource. */
export interface ZohoMetadataEntry {
  key: string
  value: string
}

/** Hosted-checkout options accepted when creating a Zoho payment session. */
export interface ZohoHostedCheckoutOptions {
  successUrl: string
  failureUrl: string
  email?: string
  phone?: string
  description?: string
}

/** Request body for `POST /paymentsessions`. */
export interface CreateZohoPaymentSessionInput {
  amount: string
  currency: string
  description: string
  invoiceNumber: string
  referenceNumber?: string
  metadata: ZohoMetadataEntry[]
  allowedPaymentMethods?: string[]
  hostedCheckout?: ZohoHostedCheckoutOptions
}

/** Request body for `POST /payments/{payment_id}/refunds`. */
export interface CreateZohoRefundInput {
  amount: string
  description?: string
  metadata?: ZohoMetadataEntry[]
}

/** Payment inside a Zoho payment-session response. */
export interface ZohoSessionPayment {
  payment_id: string
  status?: string
  created_time?: number
}

/** Zoho payment-session resource. */
export interface ZohoPaymentSession {
  payments_session_id: string
  currency: string
  amount: string
  status?: string
  created_time?: number
  expiry_time?: number
  access_key?: string
  description?: string
  invoice_number?: string
  reference_number?: string
  meta_data?: ZohoMetadataEntry[]
  payments?: ZohoSessionPayment[]
  configurations?: Record<string, unknown>
}

/** Zoho payment resource. */
export interface ZohoPayment {
  payment_id: string
  amount: string
  currency: string
  status: string
  payments_session_id?: string
  reference_number?: string
  description?: string
  amount_captured?: string
  amount_refunded?: string
  date?: number
  failure_code?: string
  failure_category?: string
  meta_data?: ZohoMetadataEntry[]
  payment_method?: Record<string, unknown>
  [key: string]: unknown
}

/** Zoho refund resource. */
export interface ZohoRefund {
  refund_id: string
  payment_id: string
  amount: string
  status: string
  currency?: string
  failure_reason?: string
  description?: string
  date?: number
  meta_data?: ZohoMetadataEntry[]
  [key: string]: unknown
}

/** Event object carried by a Zoho webhook. */
export interface ZohoWebhookEventObject {
  payment?: ZohoPayment
  refund?: ZohoRefund
  payment_links?: Record<string, unknown>
  payout?: Record<string, unknown>
  [key: string]: unknown
}

/** Envelope for every Zoho webhook delivery. */
export interface ZohoWebhookEvent {
  event_id?: string | number
  event_type: string
  account_id?: string | number
  live_mode?: boolean
  event_time?: number
  event_object?: ZohoWebhookEventObject
  [key: string]: unknown
}

/** The client surface the provider depends on. Kept small so tests can fake it. */
export interface ZohoPaymentsClientLike {
  createPaymentSession(
    input: CreateZohoPaymentSessionInput
  ): Promise<ZohoPaymentSession>
  retrievePaymentSession(sessionId: string): Promise<ZohoPaymentSession>
  retrievePayment(paymentId: string): Promise<ZohoPayment>
  createRefund(paymentId: string, input: CreateZohoRefundInput): Promise<ZohoRefund>
  retrieveRefund(refundId: string): Promise<ZohoRefund>
}

/** Zoho data-centre endpoints. */
export interface ZohoRegionConfig {
  apiBaseUrl: string
  accountsBaseUrl: string
  hostedCheckoutBaseUrl: string
  widgetDomain: ZohoWidgetDomain
}

/**
 * Provider options passed through `medusa-config.ts`.
 *
 * The default region is India. Core credentials are required; checkout-mode-specific
 * options are validated only for the selected mode.
 */
export interface ZohoPaymentOptions {
  /** Zoho Payments account ID. */
  accountId: string
  /** OAuth client ID from the Zoho API console (ORG client). */
  clientId: string
  /** OAuth client secret. Server-only. */
  clientSecret: string
  /** Long-lived offline refresh token. Server-only. */
  refreshToken: string
  /** Data-centre region. Defaults to `in` (India). */
  region?: ZohoRegion
  /** Live or sandbox environment. Defaults to `live`. */
  environment?: ZohoEnvironment
  /** Embedded widget or hosted checkout. Defaults to `widget`. */
  checkoutMode?: ZohoCheckoutMode
  /** Publishable browser API key from Zoho Developer Space. Required for widget mode. */
  apiKey?: string
  /** Business name displayed by the widget. */
  businessName?: string
  /** Zoho payment-method identifiers to allow, e.g. `["card", "upi"]`. */
  allowedPaymentMethods?: string[]
  /** Description shown to the customer. Defaults to `Medusa order payment`. */
  paymentDescription?: string
  /** Hosted checkout success URL. Required for hosted mode. */
  successUrl?: string
  /** Hosted checkout failure URL. Required for hosted mode. */
  failureUrl?: string
  /** Developer Space signing key used for webhooks and widget/return signatures. */
  signingKey?: string
  /** When set, reject webhooks whose `live_mode` does not match. */
  liveMode?: boolean
  /** HTTP timeout per request in milliseconds. Defaults to 15000. */
  timeoutMs?: number
  /** Retries for safe requests and explicit rate limits. Defaults to 3. */
  maxRetries?: number
  /** Base delay for exponential retries in milliseconds. Defaults to 500. */
  retryBaseDelayMs?: number
  /** Maximum authorize polling attempts. Defaults to 3. */
  pollAttempts?: number
  /** Delay between authorize polling attempts in milliseconds. Defaults to 500. */
  pollIntervalMs?: number
  /** Optional webhook timestamp tolerance in seconds. `0` disables the check. */
  webhookToleranceSeconds?: number
  /** Currency display-symbol overrides, keyed by uppercase ISO code. */
  currencySymbols?: Record<string, string>
  /** Extra non-sensitive metadata stored on the Zoho session (max 3 entries). */
  metadata?: Record<string, string>
  /** Override the Zoho Payments API base URL. */
  apiBaseUrl?: string
  /** Override the Zoho accounts base URL used for OAuth. */
  accountsBaseUrl?: string
  /** Override the hosted-checkout base URL. */
  hostedCheckoutBaseUrl?: string
  /** Optional fetch implementation (proxies, instrumentation, tests). */
  fetch?: typeof fetch
  /** Optional structured logger. Medusa's logger is used when omitted. */
  logger?: ZohoPaymentLogger
}

/** Fully validated options with every default resolved. */
export interface ResolvedZohoPaymentOptions {
  accountId: string
  clientId: string
  clientSecret: string
  refreshToken: string
  region: ZohoRegion
  environment: ZohoEnvironment
  regionConfig: ZohoRegionConfig
  checkoutMode: ZohoCheckoutMode
  apiKey?: string
  businessName?: string
  allowedPaymentMethods?: string[]
  paymentDescription: string
  successUrl?: string
  failureUrl?: string
  signingKey?: string
  liveMode?: boolean
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  pollAttempts: number
  pollIntervalMs: number
  webhookToleranceSeconds: number
  currencySymbols: Record<string, string>
  metadata: Record<string, string>
  fetch?: typeof fetch
  logger?: ZohoPaymentLogger
}

/** Injectable seams used by tests and advanced consumers. */
export interface ZohoPaymentProviderDependencies {
  client?: ZohoPaymentsClientLike
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  logger?: ZohoPaymentLogger
}

/**
 * Public, runtime-free types shared by the server provider and the browser helper.
 *
 * Nothing in this file may import Node built-ins or Medusa packages: it is part of the
 * browser-safe `medusa-payment-zoho/client` entry point's type surface.
 */

/** Zoho Payments data-centre region. India is the default for this plugin. */
export type ZohoRegion = "in" | "us"

/** How the customer completes the Zoho payment. */
export type ZohoCheckoutMode = "widget" | "hosted"

/** Zoho's two-letter widget domain code. */
export type ZohoWidgetDomain = "IN" | "US"

/** Configuration returned to the storefront for the embedded widget. */
export interface ZohoWidgetSessionConfig {
  /** Zoho Payments account ID. Public by design. */
  accountId: string
  /** Zoho widget domain. */
  domain: ZohoWidgetDomain
  /**
   * Zoho's browser API key from Settings → Developer Space.
   *
   * This is a publishable key used by the widget script. It is not the OAuth client
   * secret, the refresh token, or the webhook signing key.
   */
  apiKey: string
}

/**
 * The provider-owned portion of a Medusa payment session's `data`.
 *
 * Medusa exposes this object to the storefront, so it must never contain OAuth tokens,
 * the client secret, or the signing key.
 */
export interface ZohoPaymentSessionData extends Record<string, unknown> {
  /** Zoho payment session ID. This is also the provider's session `id`. */
  zohoSessionId: string
  /** Widget or hosted checkout. */
  checkoutMode: ZohoCheckoutMode
  /** Decimal amount in major units, formatted for the currency. */
  amount: string
  /** ISO-4217 currency code, uppercase. */
  currencyCode: string
  /** Display symbol used by the widget, e.g. `₹` or `$`. */
  currencySymbol: string
  /** Description shown to the customer. */
  description: string
  /** Invoice number sent to Zoho (max 50 chars). */
  invoiceNumber: string
  /** Unix epoch milliseconds after which the Zoho session is invalid. */
  expiresAt: number
  /** Present when `checkoutMode` is `widget`. */
  widget?: ZohoWidgetSessionConfig
  /** Present when `checkoutMode` is `hosted`. */
  checkoutUrl?: string
  /** Medusa payment session ID used to correlate signed webhooks. */
  medusaSessionId?: string
  /** Zoho payment ID after a successful payment. */
  paymentId?: string
  /** Last observed Zoho payment status. */
  paymentStatus?: string
  /** Older Zoho sessions superseded by a cart update. */
  previousZohoSessionIds?: string[]
  /** Most recent refund ID. */
  lastRefundId?: string
  /** Most recent refund status. */
  lastRefundStatus?: string
  /** Medusa idempotency key that produced the most recent refund. */
  lastRefundIdempotencyKey?: string
}

/** Details used to prefill the Zoho widget. Never send these to Zoho metadata. */
export interface ZohoCustomerPrefill {
  name?: string
  email?: string
  phone?: string
}

/** Input for the browser widget helper. */
export interface ZohoWidgetPaymentInput {
  /** The Medusa payment session's `data` object. */
  session: Record<string, unknown>
  /** Optional customer details to prefill the widget. */
  customer?: ZohoCustomerPrefill
  /** Optional description override. */
  description?: string
  /** Optional invoice-number override. */
  invoiceNumber?: string
  /** Override the Zoho widget script URL (for CSP/self-hosting). */
  scriptUrl?: string
  /** Maximum time to wait for the script and the widget, in milliseconds. */
  timeoutMs?: number
}

/** Discriminated result returned by the browser widget helper. */
export type ZohoCheckoutResult =
  | {
      ok: true
      /** Zoho payment ID returned by the widget. */
      paymentId: string
      /** Zoho payment session ID the widget was opened for. */
      paymentSessionId: string
      /**
       * Widget response signature. Verify it server-side with
       * `verifyZohoWidgetResponseSignature` before trusting client-reported data.
       */
      signature?: string
    }
  | {
      ok: false
      reason:
        "closed" | "failed" | "expired" | "not_configured" | "hosted_checkout_required"
      message?: string
      code?: string
    }

/** Structured logger accepted by the provider and core client. */
export interface ZohoPaymentLogger {
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

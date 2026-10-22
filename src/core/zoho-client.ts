import type { ZohoPaymentLogger } from "../types"
import { ZohoApiError, ZohoValidationError } from "./errors"
import { ZohoHttpClient } from "./http"
import { ZohoAccessTokenProvider } from "./oauth"
import type {
  CreateZohoPaymentSessionInput,
  CreateZohoRefundInput,
  ZohoPayment,
  ZohoPaymentSession,
  ZohoPaymentsClientLike,
  ZohoRefund,
  ZohoRegionConfig,
} from "../providers/zoho/types"

/** Configuration for the typed Zoho Payments client. */
export interface ZohoPaymentsClientOptions {
  accountId: string
  clientId: string
  clientSecret: string
  refreshToken: string
  regionConfig: ZohoRegionConfig
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  redirectUri?: string
  fetch?: typeof fetch
  logger?: ZohoPaymentLogger
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, resource: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new ZohoApiError(`Zoho API returned an invalid ${resource} resource`)
  }

  return value
}

function toZohoNumber(amount: string): number {
  const value = Number(amount)

  if (!Number.isFinite(value)) {
    throw new ZohoValidationError(`Invalid Zoho amount: "${amount}"`)
  }

  return value
}

function requireString(
  resource: JsonRecord,
  key: string,
  resourceName: string
): string {
  const value = resource[key]

  if (typeof value !== "string" || value.length === 0) {
    throw new ZohoApiError(`Zoho API returned a ${resourceName} without "${key}"`)
  }

  return value
}

/**
 * Typed, dependency-free client for the Zoho Payments endpoints used by this plugin.
 *
 * Consumers can export this client for custom reconciliation jobs, but the provider
 * itself only depends on the narrow `ZohoPaymentsClientLike` interface.
 */
export class ZohoPaymentsClient implements ZohoPaymentsClientLike {
  private readonly http: ZohoHttpClient

  constructor(options: ZohoPaymentsClientOptions) {
    const tokenProvider = new ZohoAccessTokenProvider({
      accountsBaseUrl: options.regionConfig.accountsBaseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      refreshToken: options.refreshToken,
      redirectUri: options.redirectUri,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      fetch: options.fetch,
      logger: options.logger,
      now: options.now,
      sleep: options.sleep,
    })

    this.http = new ZohoHttpClient({
      apiBaseUrl: options.regionConfig.apiBaseUrl,
      accountId: options.accountId,
      tokenProvider,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      fetch: options.fetch,
      logger: options.logger,
      now: options.now,
      sleep: options.sleep,
    })
  }

  async createPaymentSession(
    input: CreateZohoPaymentSessionInput
  ): Promise<ZohoPaymentSession> {
    const body: JsonRecord = {
      amount: toZohoNumber(input.amount),
      currency: input.currency,
      description: input.description,
      invoice_number: input.invoiceNumber,
      meta_data: input.metadata,
    }

    if (input.referenceNumber) {
      body.reference_number = input.referenceNumber
    }

    if (input.allowedPaymentMethods?.length) {
      body.configurations = {
        allowed_payment_methods: input.allowedPaymentMethods,
      }
    }

    if (input.hostedCheckout) {
      const existingConfigurations = isJsonRecord(body.configurations)
        ? body.configurations
        : {}
      const hostedParameters: JsonRecord = {
        success_url: input.hostedCheckout.successUrl,
        failure_url: input.hostedCheckout.failureUrl,
      }

      if (input.hostedCheckout.email) {
        hostedParameters.email = input.hostedCheckout.email
      }

      if (input.hostedCheckout.phone) {
        hostedParameters.phone = input.hostedCheckout.phone
      }

      if (input.hostedCheckout.description) {
        hostedParameters.description = input.hostedCheckout.description
      }

      body.configurations = {
        ...existingConfigurations,
        hosted_checkout_parameters: hostedParameters,
      }
    }

    const response = await this.http.request<JsonRecord>({
      method: "POST",
      path: "paymentsessions",
      body,
      retryPolicy: "safe",
    })
    const resource = requireRecord(response.payments_session, "payment session")

    return {
      ...resource,
      payments_session_id: requireString(
        resource,
        "payments_session_id",
        "payment session"
      ),
      currency: requireString(resource, "currency", "payment session"),
      amount: requireString(resource, "amount", "payment session"),
    }
  }

  async retrievePaymentSession(sessionId: string): Promise<ZohoPaymentSession> {
    const response = await this.http.request<JsonRecord>({
      method: "GET",
      path: `paymentsessions/${encodeURIComponent(sessionId)}`,
      retryPolicy: "safe",
    })
    const resource = requireRecord(response.payments_session, "payment session")

    return {
      ...resource,
      payments_session_id: requireString(
        resource,
        "payments_session_id",
        "payment session"
      ),
      currency: requireString(resource, "currency", "payment session"),
      amount: requireString(resource, "amount", "payment session"),
    }
  }

  async retrievePayment(paymentId: string): Promise<ZohoPayment> {
    const response = await this.http.request<JsonRecord>({
      method: "GET",
      path: `payments/${encodeURIComponent(paymentId)}`,
      retryPolicy: "safe",
    })
    const resource = requireRecord(response.payment, "payment")

    return {
      ...resource,
      payment_id: requireString(resource, "payment_id", "payment"),
      amount: requireString(resource, "amount", "payment"),
      currency: requireString(resource, "currency", "payment"),
      status: requireString(resource, "status", "payment"),
    }
  }

  async createRefund(
    paymentId: string,
    input: CreateZohoRefundInput
  ): Promise<ZohoRefund> {
    if (!paymentId) {
      throw new ZohoValidationError("A Zoho payment ID is required for a refund")
    }

    const body: JsonRecord = {
      amount: toZohoNumber(input.amount),
      reason: "requested_by_customer",
      type: "initiated_by_merchant",
    }

    if (input.description) {
      body.description = input.description
    }

    if (input.metadata?.length) {
      body.meta_data = input.metadata
    }

    const response = await this.http.request<JsonRecord>({
      method: "POST",
      path: `payments/${encodeURIComponent(paymentId)}/refunds`,
      body,
      retryPolicy: "none",
    })
    const resource = requireRecord(response.refund, "refund")

    return {
      ...resource,
      refund_id: requireString(resource, "refund_id", "refund"),
      payment_id: requireString(resource, "payment_id", "refund"),
      amount: requireString(resource, "amount", "refund"),
      status: requireString(resource, "status", "refund"),
    }
  }

  async retrieveRefund(refundId: string): Promise<ZohoRefund> {
    const response = await this.http.request<JsonRecord>({
      method: "GET",
      path: `refunds/${encodeURIComponent(refundId)}`,
      retryPolicy: "safe",
    })
    const resource = requireRecord(response.refund, "refund")

    return {
      ...resource,
      refund_id: requireString(resource, "refund_id", "refund"),
      payment_id: requireString(resource, "payment_id", "refund"),
      amount: requireString(resource, "amount", "refund"),
      status: requireString(resource, "status", "refund"),
    }
  }
}

import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

import type { ZohoPaymentLogger, ZohoPaymentSessionData } from "../../types"
import {
  formatAmountForZoho,
  getCurrencySymbol,
  isPositiveAmount,
  normalizeCurrencyCode,
} from "../../core/amount"
import {
  isZohoPaymentError,
  ZohoConfigurationError,
  ZohoPaymentStateError,
  ZohoUnsupportedOperationError,
  ZohoValidationError,
  ZohoWebhookVerificationError,
  getErrorMessage,
} from "../../core/errors"
import { toPaymentLogger } from "../../core/logger"
import {
  isCapturedPaymentStatus,
  isFailedPaymentStatus,
  isTerminalSessionStatus,
  mapZohoPaymentStatus,
  mapZohoSessionStatus,
} from "../../core/status"
import { ZohoPaymentsClient } from "../../core/zoho-client"
import { resolveZohoPaymentOptions, validateZohoPaymentOptions } from "./options"
import {
  buildZohoMetadataEntries,
  buildZohoSessionData,
  findZohoMetadataValue,
  isReusableZohoSession,
  MEDUSA_SESSION_ID_METADATA_KEY,
  normalizeZohoExpiryTime,
  parseZohoSessionData,
  stripProviderOwnedSessionData,
  type ZohoSessionDataView,
} from "./session-data"
import type {
  ResolvedZohoPaymentOptions,
  ZohoPaymentOptions,
  ZohoPaymentProviderDependencies,
  ZohoPaymentSession,
  ZohoPaymentsClientLike,
  ZohoPayment,
  ZohoWebhookEvent,
} from "./types"
import { handleZohoWebhook } from "./webhook"

const DEFAULT_POLL_INTERVAL_MS = 500

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function mergeSessionData(
  raw: Record<string, unknown> | undefined,
  view: ZohoSessionDataView
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw }

  for (const [key, value] of Object.entries(view)) {
    if (value !== undefined) {
      merged[key] = value
    }
  }

  return merged
}

function readMedusaSessionId(
  data: Record<string, unknown> | undefined
): string | undefined {
  const value = data?.session_id
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readIdempotencyKey(
  context: { idempotency_key?: string } | undefined
): string | undefined {
  const value = context?.idempotency_key
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Explicitly clear provider-owned payment state when a new Zoho session is created.
 *
 * Medusa merges the provider's output over the storefront-supplied `data`; setting
 * these keys to `undefined` prevents a caller from carrying a prior payment ID into a
 * fresh session. They are dropped during JSON serialization.
 */
function clearedPaymentState(): Record<string, unknown> {
  return {
    paymentId: undefined,
    paymentStatus: undefined,
    lastRefundId: undefined,
    lastRefundStatus: undefined,
    lastRefundIdempotencyKey: undefined,
  }
}

type ComparableAmount = NonNullable<BigNumber["bigNumber"]>

function parseComparableAmount(value: string): ComparableAmount {
  try {
    const amount = new BigNumber(value).bigNumber

    if (!amount || amount.isNaN() || !amount.isFinite()) {
      throw new Error("Amount is not a finite decimal")
    }

    return amount
  } catch (error) {
    throw new ZohoValidationError("Invalid payment amount", { cause: error })
  }
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value
}

/**
 * Medusa payment provider for Zoho Payments.
 *
 * All network access goes through `ZohoPaymentsClient`; tests can inject a fake via the
 * third constructor argument. The provider owns session lifecycle decisions and maps
 * Zoho state onto Medusa's payment-session state machine.
 */
export default class ZohoPaymentProviderService extends AbstractPaymentProvider<ZohoPaymentOptions> {
  static override identifier = "zoho"

  static override validateOptions(options: Record<string, unknown>): void {
    validateZohoPaymentOptions(options)
  }

  private readonly zohoConfig: ResolvedZohoPaymentOptions
  private readonly client: ZohoPaymentsClientLike
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly logger: ZohoPaymentLogger

  constructor(
    container: Record<string, unknown>,
    options: ZohoPaymentOptions,
    dependencies: ZohoPaymentProviderDependencies = {}
  ) {
    super(container, options)

    this.zohoConfig = resolveZohoPaymentOptions(options)
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? defaultSleep
    this.logger =
      dependencies.logger ?? this.zohoConfig.logger ?? toPaymentLogger(container.logger)
    this.client =
      dependencies.client ??
      new ZohoPaymentsClient({
        accountId: this.zohoConfig.accountId,
        clientId: this.zohoConfig.clientId,
        clientSecret: this.zohoConfig.clientSecret,
        refreshToken: this.zohoConfig.refreshToken,
        regionConfig: this.zohoConfig.regionConfig,
        timeoutMs: this.zohoConfig.timeoutMs,
        maxRetries: this.zohoConfig.maxRetries,
        retryBaseDelayMs: this.zohoConfig.retryBaseDelayMs,
        fetch: this.zohoConfig.fetch,
        logger: this.logger,
        now: this.now,
        sleep: this.sleep,
      })
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    try {
      return await this.createZohoSession(input)
    } catch (error) {
      throw this.toMedusaError(error, "initiate payment")
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    try {
      const existing = parseZohoSessionData(input.data)

      if (existing.paymentId || isCapturedPaymentStatus(existing.paymentStatus)) {
        throw new ZohoPaymentStateError(
          "Cannot update a Zoho payment session after payment"
        )
      }

      const currencyCode = normalizeCurrencyCode(input.currency_code)
      const amount = formatAmountForZoho(input.amount, currencyCode)

      if (
        isReusableZohoSession(
          existing,
          amount,
          currencyCode,
          this.zohoConfig.checkoutMode,
          this.now()
        )
      ) {
        return {
          status: PaymentSessionStatus.PENDING,
          data: mergeSessionData(input.data, existing),
        }
      }

      const initiated = await this.createZohoSession(input, existing)

      // A newly initiated Zoho session is always pending.
      return {
        status: PaymentSessionStatus.PENDING,
        data: initiated.data,
      }
    } catch (error) {
      throw this.toMedusaError(error, "update payment")
    }
  }

  private async createZohoSession(
    input: InitiatePaymentInput | UpdatePaymentInput,
    previous?: ZohoSessionDataView
  ): Promise<InitiatePaymentOutput> {
    const currencyCode = normalizeCurrencyCode(input.currency_code)
    const amount = formatAmountForZoho(input.amount, currencyCode)

    if (!isPositiveAmount(input.amount)) {
      throw new ZohoValidationError(
        "Zoho Payments requires a payment amount greater than zero"
      )
    }

    // Medusa accepts arbitrary `data` from the storefront. Only Medusa's injected
    // `session_id` is preserved; provider-owned fields are rebuilt server-side.
    const safeInputData = stripProviderOwnedSessionData(input.data)
    const medusaSessionId =
      readIdempotencyKey(input.context) ??
      readMedusaSessionId(safeInputData) ??
      previous?.medusaSessionId
    const description = this.zohoConfig.paymentDescription
    const invoiceNumber = truncate(medusaSessionId ?? `zoho_${this.now()}`, 50)
    const session = await this.client.createPaymentSession({
      amount,
      currency: currencyCode,
      description,
      invoiceNumber,
      referenceNumber: medusaSessionId ? truncate(medusaSessionId, 50) : undefined,
      metadata: buildZohoMetadataEntries(this.zohoConfig.metadata, medusaSessionId),
      allowedPaymentMethods: this.zohoConfig.allowedPaymentMethods,
      hostedCheckout:
        this.zohoConfig.checkoutMode === "hosted"
          ? {
              ...this.getHostedCheckoutUrls(),
              email: input.context?.customer?.email,
              phone: input.context?.customer?.phone ?? undefined,
              description,
            }
          : undefined,
    })

    const expiresAt = normalizeZohoExpiryTime(session.expiry_time, this.now())
    const widget =
      this.zohoConfig.checkoutMode === "widget"
        ? {
            accountId: this.zohoConfig.accountId,
            domain: this.zohoConfig.regionConfig.widgetDomain,
            apiKey: this.getWidgetApiKey(),
          }
        : undefined
    const checkoutUrl =
      this.zohoConfig.checkoutMode === "hosted"
        ? this.buildHostedCheckoutUrl(session)
        : undefined

    const sessionData = buildZohoSessionData({
      zohoSessionId: session.payments_session_id,
      checkoutMode: this.zohoConfig.checkoutMode,
      amount,
      currencyCode,
      currencySymbol: getCurrencySymbol(currencyCode, this.zohoConfig.currencySymbols),
      description,
      businessName: this.zohoConfig.businessName,
      invoiceNumber,
      expiresAt,
      medusaSessionId,
      widget,
      checkoutUrl,
      previousZohoSessionIds: previous?.zohoSessionId
        ? [...(previous.previousZohoSessionIds ?? []), previous.zohoSessionId]
        : previous?.previousZohoSessionIds,
    })

    return {
      id: session.payments_session_id,
      status: PaymentSessionStatus.PENDING,
      data: {
        ...safeInputData,
        ...sessionData,
        ...clearedPaymentState(),
      },
    }
  }

  deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Zoho has no API to cancel an unpaid payment session; it expires on its own.
    this.logger.debug("Deleting local Zoho payment session reference")
    return Promise.resolve({ data: input.data })
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)
      const expectedSessionId = this.getExpectedMedusaSessionId(
        input.context,
        sessionData
      )

      if (sessionData.paymentId) {
        return await this.resolvePaymentAuthorization(
          sessionData.paymentId,
          input.data,
          expectedSessionId,
          sessionData
        )
      }

      if (!sessionData.zohoSessionId) {
        throw new ZohoValidationError(
          "Zoho payment session ID is missing from Medusa session data"
        )
      }

      const session = await this.retrieveSessionWithPolling(sessionData.zohoSessionId)

      if (expectedSessionId) {
        this.assertMedusaSessionOwnership(
          session,
          expectedSessionId,
          "Zoho payment session"
        )
      }

      this.assertAmountAndCurrency(session, sessionData, "Zoho payment session")

      return this.toAuthorizeOutput(session, input.data)
    } catch (error) {
      throw this.toMedusaError(error, "authorize payment")
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)
      const paymentId = sessionData.paymentId

      if (!paymentId) {
        throw new ZohoValidationError(
          "Zoho payment ID is missing from Medusa payment data"
        )
      }

      const payment = await this.client.retrievePayment(paymentId)

      this.assertAmountAndCurrency(payment, sessionData, "Zoho payment")

      if (sessionData.medusaSessionId) {
        this.assertMedusaSessionOwnership(
          payment,
          sessionData.medusaSessionId,
          "Zoho payment"
        )
      }

      if (isCapturedPaymentStatus(payment.status)) {
        return {
          data: {
            ...input.data,
            paymentId,
            paymentStatus: payment.status,
          },
        }
      }

      if (isFailedPaymentStatus(payment.status)) {
        throw new ZohoPaymentStateError(
          `Cannot capture Zoho payment in status "${payment.status}"`
        )
      }

      throw new ZohoUnsupportedOperationError(
        "Zoho Payments captures successful payments automatically; this payment is not captured yet"
      )
    } catch (error) {
      throw this.toMedusaError(error, "capture payment")
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)
      const paymentId = sessionData.paymentId

      if (!paymentId) {
        return { data: input.data }
      }

      const payment = await this.client.retrievePayment(paymentId)

      if (isCapturedPaymentStatus(payment.status)) {
        throw new ZohoUnsupportedOperationError(
          "Captured Zoho payments cannot be cancelled; refund the payment instead"
        )
      }

      if (isFailedPaymentStatus(payment.status)) {
        return { data: input.data }
      }

      throw new ZohoUnsupportedOperationError(
        "Pending Zoho payments cannot be cancelled through the API; wait for expiry or contact Zoho support"
      )
    } catch (error) {
      throw this.toMedusaError(error, "cancel payment")
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)
      const paymentId = sessionData.paymentId

      if (!paymentId) {
        throw new ZohoValidationError(
          "Zoho payment ID is missing from Medusa payment data"
        )
      }

      if (!isPositiveAmount(input.amount)) {
        throw new ZohoValidationError("Zoho refund amount must be greater than zero")
      }

      const idempotencyKey = input.context?.idempotency_key
      const previousRefundStatus = sessionData.lastRefundStatus?.toLowerCase()
      const canReplayPreviousRefund =
        previousRefundStatus !== "failed" && previousRefundStatus !== "canceled"

      if (
        idempotencyKey &&
        sessionData.lastRefundIdempotencyKey === idempotencyKey &&
        sessionData.lastRefundId &&
        canReplayPreviousRefund
      ) {
        return { data: input.data }
      }

      // Always resolve the currency and captured amount from Zoho, never from
      // client-influenced session data.
      const payment = await this.client.retrievePayment(paymentId)

      if (!isCapturedPaymentStatus(payment.status)) {
        throw new ZohoPaymentStateError(
          `Cannot refund Zoho payment in status "${payment.status}"`
        )
      }

      if (sessionData.medusaSessionId) {
        this.assertMedusaSessionOwnership(
          payment,
          sessionData.medusaSessionId,
          "Zoho payment"
        )
      }

      const amount = formatAmountForZoho(input.amount, payment.currency)

      if (parseComparableAmount(amount).gt(payment.amount)) {
        throw new ZohoValidationError(
          "Zoho refund amount exceeds the captured payment amount"
        )
      }

      const metadata = sessionData.medusaSessionId
        ? [
            {
              key: MEDUSA_SESSION_ID_METADATA_KEY,
              value: sessionData.medusaSessionId,
            },
          ]
        : undefined

      const refund = await this.client.createRefund(paymentId, {
        amount,
        description: `Refund for Medusa payment ${paymentId}`,
        metadata,
      })

      const refundStatus = refund.status.toLowerCase()

      if (refundStatus === "failed" || refundStatus === "canceled") {
        throw new ZohoPaymentStateError(
          `Zoho refund ${refundStatus}${refund.failure_reason ? `: ${refund.failure_reason}` : ""}`
        )
      }

      if (refundStatus === "pending" || refundStatus === "initiated") {
        this.logger.warn("Zoho refund is asynchronous", {
          paymentId,
          refundId: refund.refund_id,
          status: refund.status,
        })
      }

      const existingData: Record<string, unknown> = { ...input.data }

      // An unkeyed refund must not leave the previous refund's key behind: a
      // later retry with that key would otherwise replay the newer refund.
      delete existingData.lastRefundIdempotencyKey

      return {
        data: {
          ...existingData,
          paymentId,
          lastRefundId: refund.refund_id,
          lastRefundStatus: refund.status,
          ...(idempotencyKey ? { lastRefundIdempotencyKey: idempotencyKey } : {}),
        },
      }
    } catch (error) {
      throw this.toMedusaError(error, "refund payment")
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)

      if (sessionData.paymentId) {
        const payment = await this.client.retrievePayment(sessionData.paymentId)
        return { data: this.mergePaymentData(input.data, payment) }
      }

      if (sessionData.zohoSessionId) {
        const session = await this.client.retrievePaymentSession(
          sessionData.zohoSessionId
        )
        return {
          data: {
            ...input.data,
            paymentStatus: session.status,
          },
        }
      }

      return { data: input.data }
    } catch (error) {
      throw this.toMedusaError(error, "retrieve payment")
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    try {
      const sessionData = parseZohoSessionData(input.data)

      const expectedSessionId =
        readIdempotencyKey(input.context) ?? sessionData.medusaSessionId

      if (sessionData.paymentId) {
        const payment = await this.client.retrievePayment(sessionData.paymentId)

        if (expectedSessionId) {
          this.assertMedusaSessionOwnership(payment, expectedSessionId, "Zoho payment")
        }

        this.assertAmountAndCurrency(payment, sessionData, "Zoho payment")

        return {
          status: mapZohoPaymentStatus(payment.status),
          data: this.mergePaymentData(input.data, payment),
        }
      }

      if (!sessionData.zohoSessionId) {
        return {
          status: PaymentSessionStatus.PENDING,
          data: input.data,
        }
      }

      const session = await this.client.retrievePaymentSession(
        sessionData.zohoSessionId
      )

      if (expectedSessionId) {
        this.assertMedusaSessionOwnership(
          session,
          expectedSessionId,
          "Zoho payment session"
        )
      }

      this.assertAmountAndCurrency(session, sessionData, "Zoho payment session")

      return {
        status: mapZohoSessionStatus(session.status),
        data: {
          ...input.data,
          paymentStatus: session.status,
        },
      }
    } catch (error) {
      throw this.toMedusaError(error, "get payment status")
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    try {
      return await handleZohoWebhook(payload, this.client, {
        signingKey: this.zohoConfig.signingKey,
        liveMode: this.zohoConfig.liveMode,
        expectedAccountId: this.zohoConfig.accountId,
        webhookToleranceSeconds: this.zohoConfig.webhookToleranceSeconds,
        now: this.now,
        logger: this.logger,
      })
    } catch (error) {
      throw this.toMedusaError(error, "process webhook")
    }
  }

  private async retrieveSessionWithPolling(
    sessionId: string
  ): Promise<ZohoPaymentSession> {
    let session = await this.client.retrievePaymentSession(sessionId)
    let attempt = 0
    const interval = this.zohoConfig.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS

    while (
      attempt < this.zohoConfig.pollAttempts &&
      !isTerminalSessionStatus(session.status)
    ) {
      await this.sleep(interval)
      session = await this.client.retrievePaymentSession(sessionId)
      attempt += 1
    }

    return session
  }

  private async resolvePaymentAuthorization(
    paymentId: string,
    raw: Record<string, unknown> | undefined,
    expectedSessionId: string | undefined,
    sessionData: ZohoSessionDataView
  ): Promise<AuthorizePaymentOutput> {
    const payment = await this.client.retrievePayment(paymentId)

    if (expectedSessionId) {
      this.assertMedusaSessionOwnership(payment, expectedSessionId, "Zoho payment")
    }

    this.assertAmountAndCurrency(payment, sessionData, "Zoho payment")

    return {
      status: mapZohoPaymentStatus(payment.status),
      data: this.mergePaymentData(raw, payment),
    }
  }

  private toAuthorizeOutput(
    session: ZohoPaymentSession,
    raw: Record<string, unknown> | undefined
  ): AuthorizePaymentOutput {
    const successfulPayment = session.payments?.find(
      (payment) => payment.status?.toLowerCase() === "succeeded"
    )
    const paymentId = successfulPayment?.payment_id ?? session.payments?.[0]?.payment_id
    const status =
      session.status?.toLowerCase() === "succeeded"
        ? PaymentSessionStatus.CAPTURED
        : mapZohoSessionStatus(session.status)

    return {
      status,
      data: {
        ...raw,
        ...(paymentId ? { paymentId } : {}),
        paymentStatus: session.status,
      },
    }
  }

  private getExpectedMedusaSessionId(
    context: { idempotency_key?: string } | undefined,
    sessionData: ZohoSessionDataView
  ): string | undefined {
    return readIdempotencyKey(context) ?? sessionData.medusaSessionId
  }

  private assertMedusaSessionOwnership(
    resource: {
      reference_number?: string
      meta_data?: { key: string; value: string }[]
    },
    expectedSessionId: string,
    resourceName: string
  ): void {
    const metadataSessionId = findZohoMetadataValue(
      resource.meta_data,
      MEDUSA_SESSION_ID_METADATA_KEY
    )
    const referenceNumber = resource.reference_number

    if (
      metadataSessionId !== expectedSessionId &&
      referenceNumber !== expectedSessionId
    ) {
      throw new ZohoPaymentStateError(
        `${resourceName} does not belong to the current Medusa payment session`
      )
    }
  }

  private assertAmountAndCurrency(
    resource: { amount?: string; currency?: string },
    sessionData: ZohoSessionDataView,
    resourceName: string
  ): void {
    if (!sessionData.amount || !sessionData.currencyCode) {
      return
    }

    const actualAmount = parseComparableAmount(resource.amount ?? "")

    if (
      !actualAmount.eq(sessionData.amount) ||
      !resource.currency ||
      normalizeCurrencyCode(resource.currency) !== sessionData.currencyCode
    ) {
      throw new ZohoPaymentStateError(
        `${resourceName} amount or currency does not match the Medusa payment session`
      )
    }
  }

  private mergePaymentData(
    raw: Record<string, unknown> | undefined,
    payment: ZohoPayment
  ): Record<string, unknown> {
    return {
      ...raw,
      paymentId: payment.payment_id,
      paymentStatus: payment.status,
    }
  }

  private getWidgetApiKey(): string {
    if (!this.zohoConfig.apiKey) {
      throw new ZohoConfigurationError(
        "Zoho widget API key is missing from the provider configuration"
      )
    }

    return this.zohoConfig.apiKey
  }

  private getHostedCheckoutUrls(): {
    successUrl: string
    failureUrl: string
  } {
    if (!this.zohoConfig.successUrl || !this.zohoConfig.failureUrl) {
      throw new ZohoConfigurationError(
        "Zoho hosted-checkout successUrl and failureUrl are required"
      )
    }

    return {
      successUrl: this.zohoConfig.successUrl,
      failureUrl: this.zohoConfig.failureUrl,
    }
  }

  private buildHostedCheckoutUrl(session: ZohoPaymentSession): string {
    if (!session.access_key) {
      throw new ZohoValidationError("Zoho did not return a hosted-checkout access key")
    }

    const base = this.zohoConfig.regionConfig.hostedCheckoutBaseUrl.replace(/\/+$/, "")

    return `${base}/${encodeURIComponent(session.access_key)}`
  }

  private toMedusaError(error: unknown, action: string): MedusaError {
    if (error instanceof MedusaError) {
      return error
    }

    const message = `Zoho ${action} failed: ${getErrorMessage(error)}`
    const code = isZohoPaymentError(error) ? error.code : undefined

    this.logger.error(message, {
      action,
      code,
    })

    if (
      error instanceof ZohoValidationError ||
      error instanceof ZohoConfigurationError ||
      error instanceof ZohoWebhookVerificationError
    ) {
      return new MedusaError(MedusaError.Types.INVALID_DATA, message)
    }

    if (
      error instanceof ZohoUnsupportedOperationError ||
      error instanceof ZohoPaymentStateError
    ) {
      return new MedusaError(MedusaError.Types.NOT_ALLOWED, message)
    }

    return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
  }
}

export type { ZohoPaymentSessionData, ZohoWebhookEvent }

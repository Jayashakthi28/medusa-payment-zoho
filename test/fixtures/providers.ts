import { createHmac } from "node:crypto"

import type { ProviderWebhookPayload } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import ZohoPaymentProviderService from "../../src/providers/zoho/service"
import type {
  CreateZohoPaymentSessionInput,
  CreateZohoRefundInput,
  ZohoPayment,
  ZohoPaymentOptions,
  ZohoPaymentProviderDependencies,
  ZohoPaymentSession,
  ZohoPaymentsClientLike,
  ZohoRefund,
  ZohoWebhookEvent,
} from "../../src/providers/zoho/types"
import type { ZohoPaymentLogger } from "../../src/types"

export const NOW = 1_800_000_000_000
export const SIGNING_KEY = "test-signing-key"

export function baseOptions(
  overrides: Partial<ZohoPaymentOptions> = {}
): ZohoPaymentOptions {
  return {
    accountId: "acct_in",
    clientId: "client_id",
    clientSecret: "client_secret",
    refreshToken: "refresh_token",
    apiKey: "widget_api_key",
    signingKey: SIGNING_KEY,
    ...overrides,
  }
}

export function createSession(
  overrides: Partial<ZohoPaymentSession> = {}
): ZohoPaymentSession {
  return {
    payments_session_id: "zoho_sess_1",
    currency: "INR",
    amount: "100.00",
    status: "created",
    expiry_time: Math.floor((NOW + 15 * 60_000) / 1000),
    ...overrides,
  }
}

export function createPayment(overrides: Partial<ZohoPayment> = {}): ZohoPayment {
  return {
    payment_id: "zoho_pay_1",
    amount: "100.00",
    currency: "INR",
    status: "succeeded",
    payments_session_id: "zoho_sess_1",
    reference_number: "payses_1",
    ...overrides,
  }
}

export function createRefund(overrides: Partial<ZohoRefund> = {}): ZohoRefund {
  return {
    refund_id: "zoho_refund_1",
    payment_id: "zoho_pay_1",
    amount: "100.00",
    status: "succeeded",
    ...overrides,
  }
}

export interface FakeClientHandlers {
  createPaymentSession?: (
    input: CreateZohoPaymentSessionInput
  ) => Promise<ZohoPaymentSession>
  retrievePaymentSession?: (sessionId: string) => Promise<ZohoPaymentSession>
  retrievePayment?: (paymentId: string) => Promise<ZohoPayment>
  createRefund?: (
    paymentId: string,
    input: CreateZohoRefundInput
  ) => Promise<ZohoRefund>
  retrieveRefund?: (refundId: string) => Promise<ZohoRefund>
}

/**
 * Small hand-written fake so tests assert on exactly what the provider sends.
 * Every call is recorded; unconfigured operations fail loudly.
 */
export class FakeZohoClient implements ZohoPaymentsClientLike {
  readonly createPaymentSessionCalls: CreateZohoPaymentSessionInput[] = []
  readonly retrievePaymentSessionCalls: string[] = []
  readonly retrievePaymentCalls: string[] = []
  readonly createRefundCalls: {
    paymentId: string
    input: CreateZohoRefundInput
  }[] = []
  readonly retrieveRefundCalls: string[] = []

  private readonly handlers: FakeClientHandlers

  constructor(handlers: FakeClientHandlers = {}) {
    this.handlers = handlers
  }

  createPaymentSession(
    input: CreateZohoPaymentSessionInput
  ): Promise<ZohoPaymentSession> {
    this.createPaymentSessionCalls.push(input)
    const handler = this.handlers.createPaymentSession

    if (!handler) {
      throw new Error("FakeZohoClient.createPaymentSession is not configured")
    }

    return handler(input)
  }

  retrievePaymentSession(sessionId: string): Promise<ZohoPaymentSession> {
    this.retrievePaymentSessionCalls.push(sessionId)
    const handler = this.handlers.retrievePaymentSession

    if (!handler) {
      throw new Error("FakeZohoClient.retrievePaymentSession is not configured")
    }

    return handler(sessionId)
  }

  retrievePayment(paymentId: string): Promise<ZohoPayment> {
    this.retrievePaymentCalls.push(paymentId)
    const handler = this.handlers.retrievePayment

    if (!handler) {
      throw new Error("FakeZohoClient.retrievePayment is not configured")
    }

    return handler(paymentId)
  }

  createRefund(paymentId: string, input: CreateZohoRefundInput): Promise<ZohoRefund> {
    this.createRefundCalls.push({ paymentId, input })
    const handler = this.handlers.createRefund

    if (!handler) {
      throw new Error("FakeZohoClient.createRefund is not configured")
    }

    return handler(paymentId, input)
  }

  retrieveRefund(refundId: string): Promise<ZohoRefund> {
    this.retrieveRefundCalls.push(refundId)
    const handler = this.handlers.retrieveRefund

    if (!handler) {
      throw new Error("FakeZohoClient.retrieveRefund is not configured")
    }

    return handler(refundId)
  }
}

export function createClient(handlers: FakeClientHandlers = {}): FakeZohoClient {
  return new FakeZohoClient({
    createPaymentSession: (input) =>
      Promise.resolve(
        createSession({
          payments_session_id: "zoho_sess_1",
          amount: input.amount,
          currency: input.currency,
        })
      ),
    retrievePaymentSession: (sessionId) =>
      Promise.resolve(createSession({ payments_session_id: sessionId })),
    retrievePayment: (paymentId) =>
      Promise.resolve(createPayment({ payment_id: paymentId })),
    createRefund: (paymentId, input) =>
      Promise.resolve(createRefund({ payment_id: paymentId, amount: input.amount })),
    retrieveRefund: (refundId) =>
      Promise.resolve(createRefund({ refund_id: refundId })),
    ...handlers,
  })
}

export type LogLevel = "debug" | "warn" | "error"

export interface LogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
}

export class FakeLogger implements ZohoPaymentLogger {
  readonly entries: LogEntry[] = []

  debug(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: "debug", message, context })
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", message, context })
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: "error", message, context })
  }
}

export interface Clock {
  now: number
}

export interface Harness {
  provider: ZohoPaymentProviderService
  client: FakeZohoClient
  logger: FakeLogger
  clock: Clock
  sleepCalls: number[]
  options: ZohoPaymentOptions
}

export interface HarnessConfig {
  options?: Partial<ZohoPaymentOptions>
  client?: FakeZohoClient
  logger?: FakeLogger
  now?: number
  /** Exercise the provider's real setTimeout-based sleep instead of the fake. */
  useDefaultSleep?: boolean
}

export function createHarness(config: HarnessConfig = {}): Harness {
  const options = baseOptions(config.options)
  const client = config.client ?? createClient()
  const logger = config.logger ?? new FakeLogger()
  const clock: Clock = { now: config.now ?? NOW }
  const sleepCalls: number[] = []

  const dependencies: ZohoPaymentProviderDependencies = {
    client,
    logger,
    now: () => clock.now,
    ...(config.useDefaultSleep
      ? {}
      : {
          sleep: (milliseconds: number) => {
            sleepCalls.push(milliseconds)
            return Promise.resolve()
          },
        }),
  }

  const provider = new ZohoPaymentProviderService({}, options, dependencies)

  return { provider, client, logger, clock, sleepCalls, options }
}

export async function captureMedusaError(
  promise: Promise<unknown>
): Promise<MedusaError> {
  try {
    await promise
  } catch (error) {
    if (!(error instanceof MedusaError)) {
      throw error
    }

    return error
  }

  throw new Error("Expected operation to reject with a MedusaError")
}

/** Return each value in order, repeating the last value after exhaustion. */
export function sequence<T>(first: T, ...rest: readonly T[]): () => T {
  let index = 0

  return () => {
    if (index === 0) {
      index += 1
      return first
    }

    const value = rest[index - 1] ?? first
    index += 1
    return value
  }
}

export function signWebhookBody(
  rawBody: string | Buffer,
  signingKey = SIGNING_KEY,
  timestamp = NOW
): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  const signature = createHmac("sha256", signingKey)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex")

  return `t=${timestamp},v=${signature}`
}

export function buildPaymentEvent(
  paymentOverrides: Partial<ZohoPayment> = {},
  eventOverrides: Partial<ZohoWebhookEvent> = {}
): ZohoWebhookEvent {
  const eventType = eventOverrides.event_type ?? "payment.succeeded"
  const impliedStatus =
    eventType === "payment.failed"
      ? "failed"
      : eventType === "payment.pending"
        ? "pending"
        : "succeeded"

  return {
    event_id: "evt_1",
    event_type: eventType,
    account_id: "acct_in",
    live_mode: false,
    event_object: {
      payment: createPayment({ status: impliedStatus, ...paymentOverrides }),
    },
    ...eventOverrides,
  }
}

export interface WebhookPayloadOptions {
  rawBody?: string | Buffer
  timestamp?: number
  signingKey?: string
  signatureHeader?: string | string[] | null
  headerName?: string
  headers?: Record<string, unknown>
}

export function createWebhookPayload(
  event: ZohoWebhookEvent,
  options: WebhookPayloadOptions = {}
): ProviderWebhookPayload["payload"] {
  const rawBody = options.rawBody ?? JSON.stringify(event)
  const headers: Record<string, unknown> = { ...options.headers }

  if (options.signatureHeader !== null) {
    headers[options.headerName ?? "x-zoho-webhook-signature"] =
      options.signatureHeader ??
      signWebhookBody(rawBody, options.signingKey, options.timestamp)
  }

  return {
    data: event,
    rawData: rawBody,
    headers,
  }
}

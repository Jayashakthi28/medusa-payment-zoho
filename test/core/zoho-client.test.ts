import { describe, expect, it } from "vitest"

import { ZohoApiError, ZohoValidationError } from "../../src/core/errors"
import { ZohoPaymentsClient } from "../../src/core/zoho-client"
import type { ZohoPaymentsClientOptions } from "../../src/core/zoho-client"
import type {
  CreateZohoPaymentSessionInput,
  ZohoRegionConfig,
} from "../../src/providers/zoho/types"
import type { ZohoPaymentLogger } from "../../src/types"

const ACCOUNT_ID = "account-123"
const CLIENT_ID = "1000.test-client-id"
const CLIENT_SECRET = "client-secret-value"
const REFRESH_TOKEN = "refresh-token-value"
const TOKEN = "access-token-value"
const BASE_TIME = Date.parse("2030-01-01T00:00:00.000Z")

const REGION_CONFIG: ZohoRegionConfig = {
  apiBaseUrl: "https://payments.zoho.in/api/v1",
  accountsBaseUrl: "https://accounts.zoho.in",
  hostedCheckoutBaseUrl: "https://payments.zoho.in/hostedcheckout",
  widgetDomain: "IN",
}

interface RecordedCall {
  url: URL
  init: RequestInit
}

interface LogRecord {
  level: "debug" | "warn" | "error"
  message: string
  context: Record<string, unknown> | undefined
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ClientOverrides = Partial<
  Omit<ZohoPaymentsClientOptions, "fetch" | "sleep" | "now" | "logger">
>

interface Harness {
  client: ZohoPaymentsClient
  calls: RecordedCall[]
  delays: number[]
  logs: LogRecord[]
  clock: FakeClock
}

class FakeClock {
  value: number

  constructor(value: number) {
    this.value = value
  }

  readonly now = (): number => this.value

  advance(milliseconds: number): void {
    this.value += milliseconds
  }
}

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input
  }

  if (typeof input === "string") {
    return new URL(input)
  }

  return new URL(input.url)
}

function createLogger(records: LogRecord[]): ZohoPaymentLogger {
  return {
    debug: (message, context) => {
      records.push({ level: "debug", message, context })
    },
    warn: (message, context) => {
      records.push({ level: "warn", message, context })
    },
    error: (message, context) => {
      records.push({ level: "error", message, context })
    },
  }
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")

  return new Response(JSON.stringify(payload), { ...init, headers })
}

function isTokenRequest(url: URL): boolean {
  return url.pathname.endsWith("/oauth/v2/token")
}

function createRouter(
  handler: (call: RecordedCall) => Response | Promise<Response>
): FetchHandler {
  return (input, init) => {
    const url = toUrl(input)

    if (isTokenRequest(url)) {
      return Promise.resolve(jsonResponse({ access_token: TOKEN, expires_in: 3600 }))
    }

    return Promise.resolve(handler({ url, init: init ?? {} }))
  }
}

function sequenceRouter(outcomes: unknown[]): FetchHandler {
  let index = 0

  return createRouter(() => {
    if (index >= outcomes.length) {
      return Promise.reject(new Error("Unexpected API request"))
    }

    const outcome = outcomes[index]
    index += 1

    return outcome instanceof Response ? outcome : jsonResponse(outcome)
  })
}

function createClientHarness(
  handler: FetchHandler,
  overrides: ClientOverrides = {}
): Harness {
  const calls: RecordedCall[] = []
  const delays: number[] = []
  const logs: LogRecord[] = []
  const clock = new FakeClock(BASE_TIME)
  const fetchImplementation: FetchHandler = (input, init) => {
    calls.push({ url: toUrl(input), init: init ?? {} })
    return handler(input, init)
  }
  const client = new ZohoPaymentsClient({
    accountId: ACCOUNT_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    regionConfig: REGION_CONFIG,
    timeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 100,
    ...overrides,
    fetch: fetchImplementation,
    now: clock.now,
    sleep: (milliseconds) => {
      delays.push(milliseconds)
      return Promise.resolve()
    },
    logger: createLogger(logs),
  })

  return { client, calls, delays, logs, clock }
}

function apiCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => !isTokenRequest(call.url))
}

function tokenCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => isTokenRequest(call.url))
}

function readJsonBody(call: RecordedCall): unknown {
  if (typeof call.init.body !== "string") {
    throw new Error("Expected a JSON request body")
  }

  return JSON.parse(call.init.body) as unknown
}

function readFormBody(call: RecordedCall): URLSearchParams {
  if (typeof call.init.body !== "string") {
    throw new Error("Expected a form request body")
  }

  return new URLSearchParams(call.init.body)
}

function firstApiCall(calls: RecordedCall[]): RecordedCall {
  const call = apiCalls(calls)[0]

  if (!call) {
    throw new Error("Expected one API request")
  }

  return call
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to reject")
    },
    (error: unknown) => error
  )
}

function assertApiError(error: unknown): ZohoApiError {
  if (!(error instanceof ZohoApiError)) {
    throw new Error(`Expected a ZohoApiError, received ${String(error)}`)
  }

  return error
}

function assertValidationError(error: unknown): ZohoValidationError {
  if (!(error instanceof ZohoValidationError)) {
    throw new Error(`Expected a ZohoValidationError, received ${String(error)}`)
  }

  return error
}

function sessionBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    code: 0,
    message: "success",
    payments_session: {
      payments_session_id: "sess_1",
      currency: "INR",
      amount: "1250.00",
      status: "created",
      access_key: "access-key",
      expiry_time: 1_700_000_000,
      ...overrides,
    },
  }
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse(sessionBody(overrides))
}

function paymentBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    code: 0,
    message: "success",
    payment: {
      payment_id: "pay_1",
      amount: "1250.00",
      currency: "INR",
      status: "succeeded",
      payments_session_id: "sess_1",
      reference_number: "reference_1",
      ...overrides,
    },
  }
}

function paymentResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse(paymentBody(overrides))
}

function refundBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    code: 0,
    message: "Refund initiated",
    refund: {
      refund_id: "ref_1",
      payment_id: "pay_1",
      amount: "25.50",
      status: "initiated",
      failure_reason: "",
      date: 1_700_000_000,
      ...overrides,
    },
  }
}

function refundResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse(refundBody(overrides))
}

const BASE_SESSION_INPUT: CreateZohoPaymentSessionInput = {
  amount: "1250.00",
  currency: "INR",
  description: "Medusa order payment",
  invoiceNumber: "INV-1001",
  metadata: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
}

describe("ZohoPaymentsClient", () => {
  describe("createPaymentSession", () => {
    it("posts an exact widget payment-session payload", async () => {
      const harness = createClientHarness(createRouter(() => sessionResponse()))

      const session = await harness.client.createPaymentSession({
        ...BASE_SESSION_INPUT,
        referenceNumber: "medusa_ses_123",
        allowedPaymentMethods: ["card", "upi"],
      })

      expect(apiCalls(harness.calls)).toHaveLength(1)

      const call = firstApiCall(harness.calls)
      expect(call.init.method).toBe("POST")
      expect(call.url.pathname).toBe("/api/v1/paymentsessions")
      expect(call.url.searchParams.get("account_id")).toBe(ACCOUNT_ID)

      const headers = new Headers(call.init.headers)
      expect(headers.get("authorization")).toBe(`Zoho-oauthtoken ${TOKEN}`)
      expect(headers.get("content-type")).toBe("application/json")

      expect(readJsonBody(call)).toStrictEqual({
        amount: 1250,
        currency: "INR",
        description: "Medusa order payment",
        invoice_number: "INV-1001",
        reference_number: "medusa_ses_123",
        meta_data: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
        configurations: {
          allowed_payment_methods: ["card", "upi"],
        },
      })

      expect(session).toStrictEqual({
        payments_session_id: "sess_1",
        currency: "INR",
        amount: "1250.00",
        status: "created",
        access_key: "access-key",
        expiry_time: 1_700_000_000,
      })
    })

    it("omits optional fields from a minimal widget payload", async () => {
      const harness = createClientHarness(createRouter(() => sessionResponse()))

      await harness.client.createPaymentSession({
        amount: "5.00",
        currency: "INR",
        description: "Minimal payment",
        invoiceNumber: "INV-2",
        metadata: [],
      })

      expect(readJsonBody(firstApiCall(harness.calls))).toStrictEqual({
        amount: 5,
        currency: "INR",
        description: "Minimal payment",
        invoice_number: "INV-2",
        meta_data: [],
      })
    })

    it("posts an exact hosted-checkout payload", async () => {
      const harness = createClientHarness(createRouter(() => sessionResponse()))

      await harness.client.createPaymentSession({
        ...BASE_SESSION_INPUT,
        referenceNumber: "medusa_ses_123",
        allowedPaymentMethods: ["card"],
        hostedCheckout: {
          successUrl: "https://store.example/success",
          failureUrl: "https://store.example/failure",
          email: "buyer@example.com",
          phone: "+919876543210",
          description: "Hosted payment",
        },
      })

      expect(readJsonBody(firstApiCall(harness.calls))).toStrictEqual({
        amount: 1250,
        currency: "INR",
        description: "Medusa order payment",
        invoice_number: "INV-1001",
        reference_number: "medusa_ses_123",
        meta_data: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
        configurations: {
          allowed_payment_methods: ["card"],
          hosted_checkout_parameters: {
            success_url: "https://store.example/success",
            failure_url: "https://store.example/failure",
            email: "buyer@example.com",
            phone: "+919876543210",
            description: "Hosted payment",
          },
        },
      })
    })

    it("omits absent hosted-checkout fields and empty payment methods", async () => {
      const harness = createClientHarness(createRouter(() => sessionResponse()))

      await harness.client.createPaymentSession({
        ...BASE_SESSION_INPUT,
        allowedPaymentMethods: [],
        hostedCheckout: {
          successUrl: "https://store.example/success",
          failureUrl: "https://store.example/failure",
        },
      })

      expect(readJsonBody(firstApiCall(harness.calls))).toStrictEqual({
        amount: 1250,
        currency: "INR",
        description: "Medusa order payment",
        invoice_number: "INV-1001",
        meta_data: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
        configurations: {
          hosted_checkout_parameters: {
            success_url: "https://store.example/success",
            failure_url: "https://store.example/failure",
          },
        },
      })
    })

    it("retries a safe payment-session request", async () => {
      const harness = createClientHarness(
        sequenceRouter([
          jsonResponse({ code: 500, message: "server error" }, { status: 500 }),
          sessionResponse(),
        ]),
        { maxRetries: 1 }
      )

      await harness.client.createPaymentSession(BASE_SESSION_INPUT)

      expect(apiCalls(harness.calls)).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })
  })

  describe("retrievePaymentSession", () => {
    it("encodes the session id and adds the account id", async () => {
      const sessionId = "sess/one two"
      const harness = createClientHarness(
        createRouter(() =>
          sessionResponse({
            payments_session_id: sessionId,
            currency: "INR",
            amount: "1250.00",
          })
        )
      )

      const session = await harness.client.retrievePaymentSession(sessionId)

      const call = firstApiCall(harness.calls)
      expect(call.init.method).toBe("GET")
      expect(call.url.pathname).toBe(
        `/api/v1/paymentsessions/${encodeURIComponent(sessionId)}`
      )
      expect(call.url.searchParams.get("account_id")).toBe(ACCOUNT_ID)
      expect(call.init.body).toBeUndefined()
      expect(new Headers(call.init.headers).get("content-type")).toBeNull()
      expect(session.payments_session_id).toBe(sessionId)
    })

    it.each([
      {
        label: "a missing resource",
        body: { code: 0 },
        message: "Zoho API returned an invalid payment session resource",
      },
      {
        label: "an array resource",
        body: { code: 0, payments_session: [] },
        message: "Zoho API returned an invalid payment session resource",
      },
      {
        label: "a missing id",
        body: {
          code: 0,
          payments_session: { currency: "INR", amount: "1.00" },
        },
        message: 'Zoho API returned a payment session without "payments_session_id"',
      },
      {
        label: "a non-string currency",
        body: {
          code: 0,
          payments_session: {
            payments_session_id: "sess_1",
            currency: 356,
            amount: "1.00",
          },
        },
        message: 'Zoho API returned a payment session without "currency"',
      },
      {
        label: "an empty amount",
        body: {
          code: 0,
          payments_session: {
            payments_session_id: "sess_1",
            currency: "INR",
            amount: "",
          },
        },
        message: 'Zoho API returned a payment session without "amount"',
      },
    ])("rejects $label", async ({ body, message }) => {
      const harness = createClientHarness(createRouter(() => jsonResponse(body)))

      const error = assertApiError(
        await captureError(harness.client.retrievePaymentSession("sess_1"))
      )

      expect(error.message).toBe(message)
      expect(apiCalls(harness.calls)).toHaveLength(1)
    })
  })

  describe("retrievePayment", () => {
    it("returns the payment resource", async () => {
      const paymentId = "pay/one two"
      const harness = createClientHarness(
        createRouter(() =>
          paymentResponse({
            payment_id: paymentId,
            amount: "1250.00",
            currency: "INR",
            status: "succeeded",
          })
        )
      )

      const payment = await harness.client.retrievePayment(paymentId)

      const call = firstApiCall(harness.calls)
      expect(call.url.pathname).toBe(
        `/api/v1/payments/${encodeURIComponent(paymentId)}`
      )
      expect(call.url.searchParams.get("account_id")).toBe(ACCOUNT_ID)
      expect(payment).toMatchObject({
        payment_id: paymentId,
        amount: "1250.00",
        currency: "INR",
        status: "succeeded",
        payments_session_id: "sess_1",
        reference_number: "reference_1",
      })
    })

    it.each([
      {
        label: "a missing payment resource",
        body: { code: 0 },
        message: "Zoho API returned an invalid payment resource",
      },
      {
        label: "a missing status",
        body: {
          code: 0,
          payment: {
            payment_id: "pay_1",
            amount: "1250.00",
            currency: "INR",
          },
        },
        message: 'Zoho API returned a payment without "status"',
      },
    ])("rejects $label", async ({ body, message }) => {
      const harness = createClientHarness(createRouter(() => jsonResponse(body)))

      const error = assertApiError(
        await captureError(harness.client.retrievePayment("pay_1"))
      )

      expect(error.message).toBe(message)
    })
  })

  describe("createRefund", () => {
    it("posts the exact refund body with description and metadata", async () => {
      const paymentId = "pay/one two"
      const harness = createClientHarness(createRouter(() => refundResponse()))

      const refund = await harness.client.createRefund(paymentId, {
        amount: "25.50",
        description: "Refund for Medusa payment pay_1",
        metadata: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
      })

      const call = firstApiCall(harness.calls)
      expect(call.init.method).toBe("POST")
      expect(call.url.pathname).toBe(
        `/api/v1/payments/${encodeURIComponent(paymentId)}/refunds`
      )
      expect(call.url.searchParams.get("account_id")).toBe(ACCOUNT_ID)
      expect(readJsonBody(call)).toStrictEqual({
        amount: 25.5,
        reason: "requested_by_customer",
        type: "initiated_by_merchant",
        description: "Refund for Medusa payment pay_1",
        meta_data: [{ key: "medusa_session_id", value: "medusa_ses_123" }],
      })
      expect(refund).toStrictEqual({
        refund_id: "ref_1",
        payment_id: "pay_1",
        amount: "25.50",
        status: "initiated",
        failure_reason: "",
        date: 1_700_000_000,
      })
    })

    it("omits optional refund fields", async () => {
      const harness = createClientHarness(createRouter(() => refundResponse()))

      await harness.client.createRefund("pay_1", { amount: "5.00" })

      expect(readJsonBody(firstApiCall(harness.calls))).toStrictEqual({
        amount: 5,
        reason: "requested_by_customer",
        type: "initiated_by_merchant",
      })
    })

    it("rejects an empty payment id before making a request", async () => {
      const harness = createClientHarness(createRouter(() => refundResponse()))

      const error = assertValidationError(
        await captureError(harness.client.createRefund("", { amount: "5.00" }))
      )

      expect(error.message).toBe("A Zoho payment ID is required for a refund")
      expect(harness.calls).toHaveLength(0)
    })

    it("does not retry a 5xx refund response", async () => {
      let attempts = 0
      const harness = createClientHarness(
        createRouter(() => {
          attempts += 1
          return jsonResponse({ code: 7000, message: "server error" }, { status: 500 })
        }),
        { maxRetries: 3 }
      )

      const error = assertApiError(
        await captureError(harness.client.createRefund("pay_1", { amount: "5.00" }))
      )

      expect(error.statusCode).toBe(500)
      expect(attempts).toBe(1)
      expect(apiCalls(harness.calls)).toHaveLength(1)
      expect(harness.delays).toEqual([])
    })

    it("retries a 429 refund response", async () => {
      let index = 0
      const outcomes = [
        jsonResponse(
          { code: 429, message: "slow down" },
          { status: 429, headers: { "retry-after": "1" } }
        ),
        refundResponse(),
      ]
      const harness = createClientHarness(
        createRouter(() => {
          const outcome = outcomes[index]
          index += 1

          if (!outcome) {
            throw new Error("Unexpected refund request")
          }

          return outcome
        }),
        { maxRetries: 2 }
      )

      const refund = await harness.client.createRefund("pay_1", { amount: "5.00" })

      expect(refund.refund_id).toBe("ref_1")
      expect(apiCalls(harness.calls)).toHaveLength(2)
      expect(harness.delays).toEqual([1000])
    })

    it.each([
      {
        label: "a missing refund resource",
        body: { code: 0 },
        message: "Zoho API returned an invalid refund resource",
      },
      {
        label: "a missing refund id",
        body: {
          code: 0,
          refund: {
            payment_id: "pay_1",
            amount: "25.50",
            status: "initiated",
          },
        },
        message: 'Zoho API returned a refund without "refund_id"',
      },
      {
        label: "a missing status",
        body: {
          code: 0,
          refund: {
            refund_id: "ref_1",
            payment_id: "pay_1",
            amount: "25.50",
          },
        },
        message: 'Zoho API returned a refund without "status"',
      },
    ])("rejects $label", async ({ body, message }) => {
      const harness = createClientHarness(createRouter(() => jsonResponse(body)))

      const error = assertApiError(
        await captureError(harness.client.createRefund("pay_1", { amount: "25.50" }))
      )

      expect(error.message).toBe(message)
    })
  })

  describe("retrieveRefund", () => {
    it("encodes the refund id and returns the resource", async () => {
      const refundId = "ref/one two"
      const harness = createClientHarness(
        createRouter(() => refundResponse({ refund_id: refundId }))
      )

      const refund = await harness.client.retrieveRefund(refundId)

      const call = firstApiCall(harness.calls)
      expect(call.init.method).toBe("GET")
      expect(call.url.pathname).toBe(`/api/v1/refunds/${encodeURIComponent(refundId)}`)
      expect(call.url.searchParams.get("account_id")).toBe(ACCOUNT_ID)
      expect(refund.refund_id).toBe(refundId)
    })

    it("rejects a refund without an amount", async () => {
      const harness = createClientHarness(
        createRouter(() =>
          jsonResponse({
            code: 0,
            refund: {
              refund_id: "ref_1",
              payment_id: "pay_1",
              status: "initiated",
            },
          })
        )
      )

      const error = assertApiError(
        await captureError(harness.client.retrieveRefund("ref_1"))
      )

      expect(error.message).toBe('Zoho API returned a refund without "amount"')
    })
  })

  describe("credentials", () => {
    it("forwards redirect_uri and caches the access token across calls", async () => {
      const harness = createClientHarness(
        createRouter(() => paymentResponse()),
        { redirectUri: "https://store.example/payments/return" }
      )

      await harness.client.retrievePayment("pay_1")
      await harness.client.retrievePayment("pay_2")

      const tokens = tokenCalls(harness.calls)
      expect(tokens).toHaveLength(1)

      const tokenCall = tokens[0]

      if (!tokenCall) {
        throw new Error("Expected one token request")
      }

      expect(tokenCall.url.pathname).toBe("/oauth/v2/token")
      expect(readFormBody(tokenCall).get("redirect_uri")).toBe(
        "https://store.example/payments/return"
      )
      expect(readFormBody(tokenCall).get("grant_type")).toBe("refresh_token")
      expect(readFormBody(tokenCall).get("client_id")).toBe(CLIENT_ID)
      expect(readFormBody(tokenCall).get("client_secret")).toBe(CLIENT_SECRET)
      expect(readFormBody(tokenCall).get("refresh_token")).toBe(REFRESH_TOKEN)
      expect(apiCalls(harness.calls)).toHaveLength(2)
    })
  })
})

describe("amount wire conversion", () => {
  it("rejects a non-numeric amount before calling Zoho", async () => {
    const harness = createClientHarness(createRouter(() => sessionResponse()))

    await expect(
      harness.client.createPaymentSession({
        ...BASE_SESSION_INPUT,
        amount: "not-a-number",
      })
    ).rejects.toThrow(ZohoValidationError)

    expect(apiCalls(harness.calls)).toHaveLength(0)
  })

  it("sends refund amounts as JSON numbers", async () => {
    const harness = createClientHarness(createRouter(() => refundResponse()))

    await harness.client.createRefund("pay_1", { amount: "25.50" })

    expect(readJsonBody(firstApiCall(harness.calls))).toMatchObject({
      amount: 25.5,
    })
  })
})

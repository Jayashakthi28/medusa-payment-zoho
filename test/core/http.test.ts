import { afterEach, describe, expect, it, vi } from "vitest"

import { ZohoApiError } from "../../src/core/errors"
import { ZohoHttpClient } from "../../src/core/http"
import type { ZohoHttpClientOptions } from "../../src/core/http"
import type { AccessTokenProvider } from "../../src/core/oauth"
import type { ZohoPaymentLogger } from "../../src/types"

const API_BASE = "https://payments.zoho.in/api/v1"
const ACCOUNT_ID = "account-123"
const TOKEN = "access-token-value"
const BASE_TIME = Date.parse("2030-01-01T00:00:00.000Z")

interface RecordedCall {
  url: string
  init: RequestInit
}

interface LogRecord {
  level: "debug" | "warn" | "error"
  message: string
  context: Record<string, unknown> | undefined
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type HarnessOverrides = Partial<
  Omit<ZohoHttpClientOptions, "fetch" | "sleep" | "now" | "logger" | "tokenProvider">
>

interface Harness {
  client: ZohoHttpClient
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

class StubTokenProvider implements AccessTokenProvider {
  calls = 0
  invalidations = 0
  private readonly tokens: string[]

  constructor(tokens: readonly string[] = [TOKEN]) {
    this.tokens = [...tokens]
  }

  getAccessToken(): Promise<string> {
    const index = Math.min(this.calls, this.tokens.length - 1)
    const token = this.tokens[index]
    this.calls += 1

    if (token === undefined) {
      return Promise.reject(new Error("No stub access token configured"))
    }

    return Promise.resolve(token)
  }

  invalidateAccessToken(): void {
    this.invalidations += 1
  }
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.href
  }

  return input.url
}

function recordFetch(handler: FetchHandler): {
  fetchImplementation: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImplementation: FetchHandler = (input, init) => {
    calls.push({ url: toUrl(input), init: init ?? {} })
    return handler(input, init)
  }

  return { fetchImplementation, calls }
}

function sequenceHandler(outcomes: unknown[]): FetchHandler {
  let index = 0

  return () => {
    if (index >= outcomes.length) {
      return Promise.reject(new Error("Unexpected HTTP request"))
    }

    const outcome = outcomes[index]
    index += 1

    if (outcome instanceof Error) {
      return Promise.reject(outcome)
    }

    if (outcome instanceof Promise) {
      return outcome as Promise<Response>
    }

    return Promise.resolve(outcome as Response)
  }
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")

  return new Response(JSON.stringify(payload), { ...init, headers })
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init)
}

function responseWithFailingText(error: Error, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.reject(error),
  } as unknown as Response
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

function createHarness(
  handler: FetchHandler,
  overrides: HarnessOverrides = {},
  tokenProvider: AccessTokenProvider = new StubTokenProvider()
): Harness {
  const calls: RecordedCall[] = []
  const delays: number[] = []
  const logs: LogRecord[] = []
  const clock = new FakeClock(BASE_TIME)
  const fetchImplementation: FetchHandler = (input, init) => {
    calls.push({ url: toUrl(input), init: init ?? {} })
    return handler(input, init)
  }
  const client = new ZohoHttpClient({
    apiBaseUrl: API_BASE,
    accountId: ACCOUNT_ID,
    timeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 100,
    ...overrides,
    tokenProvider,
    fetch: fetchImplementation,
    sleep: (milliseconds) => {
      delays.push(milliseconds)
      return Promise.resolve()
    },
    now: clock.now,
    logger: createLogger(logs),
  })

  return { client, calls, delays, logs, clock }
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

function firstCall(calls: RecordedCall[]): RecordedCall {
  const call = calls[0]

  if (!call) {
    throw new Error("Expected one HTTP request")
  }

  return call
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ZohoHttpClient", () => {
  describe("request construction", () => {
    it("builds the URL with account_id, query parameters, and headers", async () => {
      const harness = createHarness(sequenceHandler([jsonResponse({ code: 0 })]))

      const result = await harness.client.request<unknown>({
        method: "GET",
        path: "/paymentsessions/sess_1",
        query: {
          limit: 10,
          active: true,
          missing: undefined,
          q: "a b",
        },
      })

      expect(result).toEqual({ code: 0 })
      expect(harness.calls).toHaveLength(1)

      const call = firstCall(harness.calls)
      const url = new URL(call.url)

      expect(`${url.origin}${url.pathname}`).toBe(`${API_BASE}/paymentsessions/sess_1`)
      expect(url.searchParams.get("account_id")).toBe(ACCOUNT_ID)
      expect(url.searchParams.get("limit")).toBe("10")
      expect(url.searchParams.get("active")).toBe("true")
      expect(url.searchParams.get("q")).toBe("a b")
      expect(url.searchParams.has("missing")).toBe(false)

      const headers = new Headers(call.init.headers)
      expect(call.init.method).toBe("GET")
      expect(call.init.body).toBeUndefined()
      expect(call.init.signal).toBeInstanceOf(AbortSignal)
      expect(headers.get("authorization")).toBe(`Zoho-oauthtoken ${TOKEN}`)
      expect(headers.get("accept")).toBe("application/json")
      expect(headers.get("user-agent")).toBe("medusa-payment-zoho")
      expect(headers.get("content-type")).toBeNull()
    })

    it.each([API_BASE, `${API_BASE}/`])(
      "joins requests against the API base %s",
      async (apiBaseUrl) => {
        const harness = createHarness(sequenceHandler([jsonResponse({ code: 0 })]), {
          apiBaseUrl,
        })

        await harness.client.request({ method: "GET", path: "paymentsessions" })

        const call = firstCall(harness.calls)
        expect(call.url).toBe(`${API_BASE}/paymentsessions?account_id=${ACCOUNT_ID}`)
      }
    )

    it("serializes a JSON body and sets the content type", async () => {
      const harness = createHarness(sequenceHandler([jsonResponse({ code: 0 })]), {
        userAgent: "custom-agent/1.0",
      })
      const body = { amount: "10.00", description: "Order #1" }

      await harness.client.request({
        method: "POST",
        path: "paymentsessions",
        body,
      })

      const call = firstCall(harness.calls)
      const headers = new Headers(call.init.headers)

      expect(call.init.method).toBe("POST")
      expect(call.init.body).toBe(JSON.stringify(body))
      expect(headers.get("content-type")).toBe("application/json")
      expect(headers.get("user-agent")).toBe("custom-agent/1.0")
    })
  })

  describe("success responses", () => {
    it.each([
      { label: "numeric zero", payload: { code: 0, data: "ok" } },
      { label: "string zero", payload: { code: "0", data: "ok" } },
      { label: "missing code", payload: { data: "ok" } },
      { label: "null code", payload: { code: null, data: "ok" } },
    ])("accepts a $label payload", async ({ payload }) => {
      const harness = createHarness(sequenceHandler([jsonResponse(payload)]))

      await expect(
        harness.client.request<unknown>({ method: "GET", path: "payments/1" })
      ).resolves.toEqual(payload)
    })
  })

  describe("API errors", () => {
    it("exposes the API code, message, status, and request id", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 7001, message: "Invalid amount" },
            { status: 400, headers: { "x-zoho-request-id": "req_123" } }
          ),
        ])
      )
      const body = { amount: "10.00", marker: "request-body-secret" }

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "POST", path: "payments", body })
        )
      )

      expect(error.message).toBe(
        "Zoho API POST /payments failed: Invalid amount; code=7001"
      )
      expect(error.statusCode).toBe(400)
      expect(error.zohoCode).toBe("7001")
      expect(error.requestId).toBe("req_123")
      expect(error.retryable).toBe(false)
      expect(error.message).not.toContain("request-body-secret")
      expect(error.message).not.toContain(TOKEN)
      expect(harness.calls).toHaveLength(1)
    })

    it("falls back to x-request-id", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 1, message: "Rejected" },
            { status: 422, headers: { "x-request-id": "req_fallback" } }
          ),
        ])
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.requestId).toBe("req_fallback")
    })

    it.each([
      {
        label: "numeric message and code",
        payload: { code: 42, message: 7 },
        expectedMessage: "Zoho API GET /payments failed: 7; code=42",
        expectedCode: "42",
      },
      {
        label: "empty message and code",
        payload: { code: "", message: "" },
        expectedMessage: "Zoho API GET /payments failed: HTTP 400",
        expectedCode: undefined,
      },
      {
        label: "missing message",
        payload: { code: 5 },
        expectedMessage: "Zoho API GET /payments failed: HTTP 400; code=5",
        expectedCode: "5",
      },
    ])(
      "formats $label error payloads",
      async ({ payload, expectedMessage, expectedCode }) => {
        const harness = createHarness(
          sequenceHandler([jsonResponse(payload, { status: 400 })])
        )

        const error = assertApiError(
          await captureError(
            harness.client.request({ method: "GET", path: "payments" })
          )
        )

        expect(error.message).toBe(expectedMessage)
        expect(error.zohoCode).toBe(expectedCode)
      }
    )

    it.each(["", "<html>", "null", "[]", "42"])(
      "rejects a non-object success body %j",
      async (body) => {
        const harness = createHarness(
          sequenceHandler([
            textResponse(body, {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ])
        )

        const error = assertApiError(
          await captureError(
            harness.client.request({ method: "GET", path: "payments/1" })
          )
        )

        expect(error.message).toBe("Zoho API GET /payments/1 failed: HTTP 200")
        expect(error.statusCode).toBe(200)
        expect(error.zohoCode).toBeUndefined()
        expect(error.retryable).toBe(false)
        expect(harness.calls).toHaveLength(1)
      }
    )

    it("reports a non-JSON error response without leaking the body", async () => {
      const harness = createHarness(
        sequenceHandler([
          textResponse("<html>upstream failure</html>", { status: 503 }),
        ])
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.message).toBe("Zoho API GET /payments/1 failed: HTTP 503")
      expect(error.statusCode).toBe(503)
      expect(error.retryable).toBe(true)
      expect(error.message).not.toContain("upstream failure")
    })
  })

  describe("authentication", () => {
    it("refreshes once and retries after a 401", async () => {
      const tokenProvider = new StubTokenProvider(["expired-token", "fresh-token"])
      let requestCount = 0
      const harness = createHarness(
        () => {
          requestCount += 1

          if (requestCount === 1) {
            return Promise.resolve(
              jsonResponse({ code: 401, message: "expired" }, { status: 401 })
            )
          }

          return Promise.resolve(jsonResponse({ code: 0, data: "ok" }))
        },
        {},
        tokenProvider
      )

      await expect(
        harness.client.request<unknown>({ method: "GET", path: "payments/1" })
      ).resolves.toEqual({ code: 0, data: "ok" })

      expect(harness.calls).toHaveLength(2)
      expect(tokenProvider.calls).toBe(2)
      expect(tokenProvider.invalidations).toBe(1)

      const authorizations = harness.calls.map((call) =>
        new Headers(call.init.headers).get("authorization")
      )
      expect(authorizations).toEqual([
        "Zoho-oauthtoken expired-token",
        "Zoho-oauthtoken fresh-token",
      ])
    })

    it("stops after a second 401", async () => {
      const tokenProvider = new StubTokenProvider(["expired-token", "still-expired"])
      const harness = createHarness(
        () =>
          Promise.resolve(
            jsonResponse({ code: 401, message: "expired" }, { status: 401 })
          ),
        { maxRetries: 3 },
        tokenProvider
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.statusCode).toBe(401)
      expect(error.retryable).toBe(false)
      expect(harness.calls).toHaveLength(2)
      expect(tokenProvider.invalidations).toBe(1)
    })
  })

  describe("retries", () => {
    it("honors a 429 Retry-After in seconds", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            { status: 429, headers: { "retry-after": "2" } }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([2000])
    })

    it("honors a 429 Retry-After HTTP date using the injected clock", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            {
              status: 429,
              headers: {
                "retry-after": new Date(BASE_TIME + 10_000).toUTCString(),
              },
            }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.delays).toEqual([10_000])
    })

    it("caps a 429 Retry-After at thirty seconds", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            { status: 429, headers: { "retry-after": "120" } }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.delays).toEqual([30_000])
    })

    it("uses exponential backoff for a 429 without Retry-After", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 429, message: "slow down" }, { status: 429 }),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2, retryBaseDelayMs: 100 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.delays).toEqual([100])
    })

    it("falls back to exponential backoff for an invalid Retry-After", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            { status: 429, headers: { "retry-after": "not-a-date" } }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2, retryBaseDelayMs: 100 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.delays).toEqual([100])
    })

    it("retries a 429 even when the retry policy is none", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            { status: 429, headers: { "retry-after": "1" } }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2 }
      )

      await harness.client.request({
        method: "POST",
        path: "payments/pay_1/refunds",
        body: { amount: "5.00" },
        retryPolicy: "none",
      })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([1000])
    })

    it("throws after exhausting 429 retries", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 429, message: "slow down" }, { status: 429 }),
          jsonResponse({ code: 429, message: "slow down" }, { status: 429 }),
        ]),
        { maxRetries: 1, retryBaseDelayMs: 100 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.statusCode).toBe(429)
      expect(error.retryable).toBe(true)
      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })

    it("retries 5xx responses for safe requests", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 500, message: "server error" }, { status: 500 }),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 2 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })

    it("does not retry a 5xx response when the retry policy is none", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 500, message: "server error" }, { status: 500 }),
        ]),
        { maxRetries: 3 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({
            method: "POST",
            path: "payments/pay_1/refunds",
            body: { amount: "5.00" },
            retryPolicy: "none",
          })
        )
      )

      expect(error.statusCode).toBe(500)
      expect(error.retryable).toBe(false)
      expect(harness.calls).toHaveLength(1)
      expect(harness.delays).toEqual([])
    })

    it("stops after maxRetries for repeated 5xx responses", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 500, message: "server error" }, { status: 500 }),
          jsonResponse({ code: 503, message: "unavailable" }, { status: 503 }),
          jsonResponse({ code: 502, message: "bad gateway" }, { status: 502 }),
        ]),
        { maxRetries: 2, retryBaseDelayMs: 100 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.statusCode).toBe(502)
      expect(error.retryable).toBe(true)
      expect(harness.calls).toHaveLength(3)
      expect(harness.delays).toEqual([100, 200])
    })

    it("retries network failures for safe requests", async () => {
      const harness = createHarness(
        sequenceHandler([
          new TypeError("fetch failed"),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 1 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })

    it("does not retry network failures when the retry policy is none", async () => {
      const harness = createHarness(sequenceHandler([new TypeError("fetch failed")]), {
        maxRetries: 3,
      })

      const error = assertApiError(
        await captureError(
          harness.client.request({
            method: "POST",
            path: "payments/pay_1/refunds",
            body: { amount: "5.00" },
            retryPolicy: "none",
          })
        )
      )

      expect(error.message).toBe(
        "Zoho API request failed: POST /payments/pay_1/refunds"
      )
      expect(error.retryable).toBe(false)
      expect(error.cause).toBeInstanceOf(TypeError)
      expect(error.statusCode).toBeUndefined()
      expect(harness.calls).toHaveLength(1)
      expect(harness.delays).toEqual([])
    })

    it("throws after exhausting network retries", async () => {
      const harness = createHarness(
        sequenceHandler([new TypeError("fetch failed"), new TypeError("fetch failed")]),
        { maxRetries: 1, retryBaseDelayMs: 100 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.message).toBe("Zoho API request failed: GET /payments/1")
      expect(error.retryable).toBe(true)
      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })

    it("does not retry a non-network error", async () => {
      const harness = createHarness(sequenceHandler([new Error("socket closed")]), {
        maxRetries: 3,
      })

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.retryable).toBe(false)
      expect(error.cause).toBeInstanceOf(Error)
      expect(harness.calls).toHaveLength(1)
      expect(harness.delays).toEqual([])
    })

    it("wraps a non-Error rejection", async () => {
      // A transport may reject with a non-Error value; the client must still return
      // a typed error without losing the original value as its cause.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const rejection = Promise.reject("network down")
      const harness = createHarness(sequenceHandler([rejection]), {
        maxRetries: 3,
      })

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.retryable).toBe(false)
      expect(error.cause).toBe("network down")
      expect(harness.calls).toHaveLength(1)
    })

    it("classifies an AbortError as retryable", async () => {
      const harness = createHarness(
        sequenceHandler([new DOMException("The operation was aborted", "AbortError")]),
        { maxRetries: 0 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.retryable).toBe(true)
      expect(harness.calls).toHaveLength(1)
    })

    it("retries a timeout raised through the AbortSignal", async () => {
      let attempts = 0
      const harness = createHarness(
        (_input, init) => {
          attempts += 1

          if (attempts > 1) {
            return Promise.resolve(jsonResponse({ code: 0, data: "ok" }))
          }

          const signal = init?.signal

          if (!signal) {
            return Promise.reject(new Error("Missing abort signal"))
          }

          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation timed out", "TimeoutError"))
            })
          })
        },
        { timeoutMs: 1, maxRetries: 1 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
      expect(harness.calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
      expect(harness.calls[0]?.init.signal?.aborted).toBe(true)
    })

    it("retries a response body read timeout", async () => {
      let attempts = 0
      const harness = createHarness(
        () => {
          attempts += 1

          if (attempts === 1) {
            return Promise.resolve(
              responseWithFailingText(
                new DOMException("The operation timed out", "TimeoutError")
              )
            )
          }

          return Promise.resolve(jsonResponse({ code: 0, data: "ok" }))
        },
        { maxRetries: 1 }
      )

      await harness.client.request({ method: "GET", path: "payments/1" })

      expect(harness.calls).toHaveLength(2)
      expect(harness.delays).toEqual([100])
    })

    it("does not discard a response body read failure", async () => {
      const harness = createHarness(
        sequenceHandler([responseWithFailingText(new Error("decoder failed"))]),
        { maxRetries: 2 }
      )

      const error = assertApiError(
        await captureError(
          harness.client.request({ method: "GET", path: "payments/1" })
        )
      )

      expect(error.message).toBe("Zoho API request failed: GET /payments/1")
      expect(error.retryable).toBe(false)
      expect(error.cause).toBeInstanceOf(Error)

      const cause = error.cause
      expect(cause instanceof Error ? cause.message : undefined).toBe("decoder failed")
      expect(harness.calls).toHaveLength(1)
      expect(harness.delays).toEqual([])
    })
  })

  describe("logging", () => {
    it("never logs the request body, token, or authorization header", async () => {
      const harness = createHarness(
        sequenceHandler([
          jsonResponse({ code: 500, message: "upstream failure" }, { status: 500 }),
          jsonResponse({ code: 0, data: "ok" }),
        ]),
        { maxRetries: 1 }
      )
      const body = { amount: "10.00", marker: "request-body-secret" }

      await harness.client.request({ method: "POST", path: "payments", body })

      expect(harness.logs).toEqual([
        {
          level: "warn",
          message: "Retrying Zoho API request",
          context: { attempt: 1, delayMs: 100 },
        },
      ])

      const serialized = JSON.stringify(harness.logs)
      expect(serialized).not.toContain("request-body-secret")
      expect(serialized).not.toContain(TOKEN)
      expect(serialized).not.toContain("authorization")
    })
  })

  describe("default seams", () => {
    it("uses global fetch, the wall clock, and the default sleep", async () => {
      const { fetchImplementation, calls } = recordFetch(
        sequenceHandler([
          jsonResponse(
            { code: 429, message: "slow down" },
            { status: 429, headers: { "retry-after": "0" } }
          ),
          jsonResponse({ code: 0, data: "ok" }),
        ])
      )

      vi.stubGlobal("fetch", fetchImplementation)

      const client = new ZohoHttpClient({
        apiBaseUrl: API_BASE,
        accountId: ACCOUNT_ID,
        tokenProvider: new StubTokenProvider(),
        timeoutMs: 1000,
        maxRetries: 1,
        retryBaseDelayMs: 100,
      })

      await expect(
        client.request({ method: "GET", path: "payments/1" })
      ).resolves.toEqual({ code: 0, data: "ok" })
      expect(calls).toHaveLength(2)
    })
  })
})

describe("socket error handling", () => {
  it("retries a retryable socket error for safe requests", async () => {
    const harness = createHarness(
      sequenceHandler([
        Promise.reject(
          Object.assign(new Error("socket reset"), { code: "ECONNRESET" })
        ),
        jsonResponse({ code: 0 }),
      ]),
      { maxRetries: 1, retryBaseDelayMs: 50 }
    )

    await expect(
      harness.client.request({ method: "GET", path: "payments/1" })
    ).resolves.toEqual({ code: 0 })
    expect(harness.calls).toHaveLength(2)
    expect(harness.delays).toEqual([50])
  })

  it("does not retry an unknown socket code", async () => {
    const harness = createHarness(
      sequenceHandler([
        Promise.reject(Object.assign(new Error("bad socket"), { code: "EINVAL" })),
      ]),
      { maxRetries: 3 }
    )

    const error = assertApiError(
      await captureError(harness.client.request({ method: "GET", path: "payments/1" }))
    )

    expect(error.retryable).toBe(false)
    expect(harness.calls).toHaveLength(1)
  })
})

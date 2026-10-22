import { afterEach, describe, expect, it, vi } from "vitest"

import { ZohoAuthenticationError } from "../../src/core/errors"
import { ZohoAccessTokenProvider } from "../../src/core/oauth"
import type { ZohoAccessTokenProviderOptions } from "../../src/core/oauth"
import type { ZohoPaymentLogger } from "../../src/types"

const ACCOUNTS_BASE = "https://accounts.zoho.in"
const TOKEN_URL = `${ACCOUNTS_BASE}/oauth/v2/token`
const CLIENT_ID = "1000.test-client-id"
const CLIENT_SECRET = "client-secret-value"
const REFRESH_TOKEN = "refresh-token-value"
const ACCESS_TOKEN = "access-token-value"
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

function sequenceFetch(outcomes: unknown[]): {
  fetchImplementation: typeof fetch
  calls: RecordedCall[]
} {
  let index = 0

  return recordFetch(() => {
    if (index >= outcomes.length) {
      return Promise.reject(new Error("Unexpected OAuth token request"))
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
  })
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")

  return new Response(JSON.stringify(payload), { ...init, headers })
}

function tokenResponse(accessToken = ACCESS_TOKEN, expiresIn?: number): Response {
  const payload: Record<string, unknown> = { access_token: accessToken }

  if (expiresIn !== undefined) {
    payload.expires_in = expiresIn
  }

  return jsonResponse(payload)
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

function createProvider(
  fetchImplementation?: typeof fetch,
  overrides: Partial<ZohoAccessTokenProviderOptions> = {}
): ZohoAccessTokenProvider {
  return new ZohoAccessTokenProvider({
    accountsBaseUrl: ACCOUNTS_BASE,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    timeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 100,
    fetch: fetchImplementation,
    now: () => BASE_TIME,
    sleep: () => Promise.resolve(),
    ...overrides,
  })
}

function tokenBody(call: RecordedCall): URLSearchParams {
  if (typeof call.init.body !== "string") {
    throw new Error("Expected the token request body to be form encoded")
  }

  return new URLSearchParams(call.init.body)
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to reject")
    },
    (error: unknown) => error
  )
}

function assertAuthError(error: unknown): ZohoAuthenticationError {
  if (!(error instanceof ZohoAuthenticationError)) {
    throw new Error(`Expected a ZohoAuthenticationError, received ${String(error)}`)
  }

  return error
}

function causeMessage(error: Error): string | undefined {
  return error.cause instanceof Error ? error.cause.message : undefined
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ZohoAccessTokenProvider", () => {
  describe("token request", () => {
    it("exchanges the refresh token for an access token", async () => {
      const { fetchImplementation, calls } = sequenceFetch([tokenResponse()])
      const provider = createProvider(fetchImplementation)

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      expect(calls).toHaveLength(1)
      const call = calls[0]

      if (!call) {
        throw new Error("Expected one token request")
      }

      expect(call.url).toBe(TOKEN_URL)
      expect(call.init.method).toBe("POST")
      expect(call.init.signal).toBeInstanceOf(AbortSignal)

      const headers = new Headers(call.init.headers)
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded")
      expect(headers.get("accept")).toBe("application/json")

      expect(Object.fromEntries(tokenBody(call))).toEqual({
        refresh_token: REFRESH_TOKEN,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
      })
    })

    it("preserves a trailing slash and includes redirect_uri when configured", async () => {
      const { fetchImplementation, calls } = sequenceFetch([tokenResponse()])
      const provider = createProvider(fetchImplementation, {
        accountsBaseUrl: `${ACCOUNTS_BASE}/`,
        redirectUri: "https://store.example/payments/return",
      })

      await provider.getAccessToken()

      const call = calls[0]

      if (!call) {
        throw new Error("Expected one token request")
      }

      expect(call.url).toBe(TOKEN_URL)
      expect(tokenBody(call).get("redirect_uri")).toBe(
        "https://store.example/payments/return"
      )
    })

    it("uses the global fetch and default timing seams when not injected", async () => {
      const { fetchImplementation, calls } = sequenceFetch([
        jsonResponse({ error: "rate_limited" }, { status: 429 }),
        tokenResponse(),
      ])

      vi.stubGlobal("fetch", fetchImplementation)

      const provider = createProvider(undefined, {
        fetch: undefined,
        now: undefined,
        sleep: undefined,
        maxRetries: 1,
        retryBaseDelayMs: 0,
      })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)
      expect(calls).toHaveLength(2)
    })
  })

  describe("caching", () => {
    it("caches the token until the expiry safety window is crossed", async () => {
      const clock = new FakeClock(BASE_TIME)
      const { fetchImplementation, calls } = sequenceFetch([
        tokenResponse("token-a", 3600),
        tokenResponse("token-b", 3600),
      ])
      const provider = createProvider(fetchImplementation, { now: clock.now })

      await expect(provider.getAccessToken()).resolves.toBe("token-a")

      clock.advance(3_540_000 - 1)
      await expect(provider.getAccessToken()).resolves.toBe("token-a")

      clock.advance(1)
      await expect(provider.getAccessToken()).resolves.toBe("token-b")

      expect(calls).toHaveLength(2)
    })

    it.each([
      { label: "missing", payload: { access_token: ACCESS_TOKEN } },
      { label: "zero", payload: { access_token: ACCESS_TOKEN, expires_in: 0 } },
      { label: "negative", payload: { access_token: ACCESS_TOKEN, expires_in: -10 } },
      {
        label: "a string",
        payload: { access_token: ACCESS_TOKEN, expires_in: "3600" },
      },
      { label: "null", payload: { access_token: ACCESS_TOKEN, expires_in: null } },
    ])(
      "falls back to a one-hour lifetime when expires_in is $label",
      async ({ payload }) => {
        const clock = new FakeClock(BASE_TIME)
        const { fetchImplementation, calls } = sequenceFetch([
          jsonResponse(payload),
          tokenResponse("token-b"),
        ])
        const provider = createProvider(fetchImplementation, { now: clock.now })

        await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

        clock.advance(3_540_000 - 1)
        await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

        clock.advance(1)
        await expect(provider.getAccessToken()).resolves.toBe("token-b")
        expect(calls).toHaveLength(2)
      }
    )

    it("falls back to a one-hour lifetime when expires_in is not finite", async () => {
      const clock = new FakeClock(BASE_TIME)
      const nonFinite = new Response(
        `{"access_token":"${ACCESS_TOKEN}","expires_in":1e999}`,
        { status: 200, headers: { "content-type": "application/json" } }
      )
      const { fetchImplementation, calls } = sequenceFetch([
        nonFinite,
        tokenResponse("token-b"),
      ])
      const provider = createProvider(fetchImplementation, { now: clock.now })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      clock.advance(3_540_000 - 1)
      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      clock.advance(1)
      await expect(provider.getAccessToken()).resolves.toBe("token-b")
      expect(calls).toHaveLength(2)
    })

    it("never caches a short-lived token past its real lifetime", async () => {
      const clock = new FakeClock(BASE_TIME)
      const { fetchImplementation, calls } = sequenceFetch([
        tokenResponse("token-a", 4),
        tokenResponse("token-b", 4),
      ])
      const provider = createProvider(fetchImplementation, { now: clock.now })

      await expect(provider.getAccessToken()).resolves.toBe("token-a")

      clock.advance(2001)
      await expect(provider.getAccessToken()).resolves.toBe("token-b")
      expect(calls).toHaveLength(2)
    })

    it("refreshes after invalidateAccessToken", async () => {
      const { fetchImplementation, calls } = sequenceFetch([
        tokenResponse("token-a"),
        tokenResponse("token-b"),
      ])
      const provider = createProvider(fetchImplementation)

      await expect(provider.getAccessToken()).resolves.toBe("token-a")
      await expect(provider.getAccessToken()).resolves.toBe("token-a")
      expect(calls).toHaveLength(1)

      provider.invalidateAccessToken()

      await expect(provider.getAccessToken()).resolves.toBe("token-b")
      expect(calls).toHaveLength(2)
    })
  })

  describe("single flight", () => {
    it("collapses concurrent refreshes into one request", async () => {
      let resolveFetch: (response: Response) => void = () => {
        throw new Error("The token request has not started")
      }
      const { fetchImplementation, calls } = recordFetch(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          })
      )
      const provider = createProvider(fetchImplementation)

      const first = provider.getAccessToken()
      const second = provider.getAccessToken()

      expect(calls).toHaveLength(1)

      resolveFetch(tokenResponse())

      await expect(Promise.all([first, second])).resolves.toEqual([
        ACCESS_TOKEN,
        ACCESS_TOKEN,
      ])
      expect(calls).toHaveLength(1)
    })
  })

  describe("retries", () => {
    it("retries a 429 with exponential backoff and never logs secrets", async () => {
      const clock = new FakeClock(BASE_TIME)
      const delays: number[] = []
      const logs: LogRecord[] = []
      const { fetchImplementation } = sequenceFetch([
        jsonResponse({ error: "rate_limited" }, { status: 429 }),
        tokenResponse(),
      ])
      const provider = createProvider(fetchImplementation, {
        now: clock.now,
        logger: createLogger(logs),
        maxRetries: 2,
        retryBaseDelayMs: 100,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      expect(delays).toEqual([100])
      expect(logs).toEqual([
        {
          level: "warn",
          message: "Retrying Zoho OAuth token refresh",
          context: { attempt: 1, delayMs: 100 },
        },
      ])

      const serialized = JSON.stringify(logs)
      expect(serialized).not.toContain(CLIENT_SECRET)
      expect(serialized).not.toContain(REFRESH_TOKEN)
      expect(serialized).not.toContain(ACCESS_TOKEN)
    })

    it("retries 5xx responses with growing delays", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([
        jsonResponse({ error: "server_error" }, { status: 500 }),
        jsonResponse({ error: "bad_gateway" }, { status: 502 }),
        tokenResponse(),
      ])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 3,
        retryBaseDelayMs: 100,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      expect(calls).toHaveLength(3)
      expect(delays).toEqual([100, 200])
    })

    it("retries network failures", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([
        new TypeError("fetch failed"),
        tokenResponse(),
      ])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 1,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      expect(calls).toHaveLength(2)
      expect(delays).toEqual([100])
    })

    it("retries a timeout raised through the AbortSignal", async () => {
      const { fetchImplementation, calls } = recordFetch((_input, init) => {
        const signal = init?.signal

        if (!signal) {
          return Promise.reject(new Error("Missing abort signal"))
        }

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation timed out", "TimeoutError"))
          })
        })
      })
      const provider = createProvider(fetchImplementation, {
        timeoutMs: 1,
        maxRetries: 0,
      })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.retryable).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
      expect(calls[0]?.init.signal?.aborted).toBe(true)
    })

    it("stops after maxRetries and clears the cache", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([
        jsonResponse({ error: "server_error" }, { status: 503 }),
        jsonResponse({ error: "server_error" }, { status: 503 }),
        jsonResponse({ error: "server_error" }, { status: 503 }),
        tokenResponse("token-after"),
      ])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 2,
        retryBaseDelayMs: 100,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.retryable).toBe(true)
      expect(calls).toHaveLength(3)
      expect(delays).toEqual([100, 200])

      await expect(provider.getAccessToken()).resolves.toBe("token-after")
      expect(calls).toHaveLength(4)
    })

    it("does not retry a 4xx response", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([
        jsonResponse(
          {
            error: "invalid_client",
            error_description: "Invalid client credentials",
          },
          { status: 400 }
        ),
      ])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 3,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.retryable).toBe(false)
      expect(error.message).toBe(
        "Zoho OAuth token refresh failed: Invalid client credentials"
      )
      expect(calls).toHaveLength(1)
      expect(delays).toEqual([])
    })

    it("does not retry a non-network failure", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([new Error("socket closed")])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 3,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.retryable).toBe(false)
      expect(error.message).toBe("Unable to reach the Zoho OAuth token endpoint")
      expect(causeMessage(error)).toBe("socket closed")
      expect(calls).toHaveLength(1)
      expect(delays).toEqual([])
    })
  })

  describe("error handling", () => {
    it.each([
      { label: "empty", body: "" },
      { label: "non-JSON", body: "not json" },
      { label: "JSON null", body: "null" },
      { label: "JSON number", body: "42" },
      { label: "JSON array", body: "[]" },
    ])("rejects a $label token response with a typed error", async ({ body }) => {
      const response = new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
      const { fetchImplementation } = sequenceFetch([response])
      const provider = createProvider(fetchImplementation)

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.retryable).toBe(false)
      expect(error.message).toBe("Zoho OAuth token refresh failed: HTTP 200")
      expect(causeMessage(error)).toBe("Zoho OAuth HTTP 200")
      expect(error.message).not.toContain(CLIENT_SECRET)
      expect(error.message).not.toContain(REFRESH_TOKEN)
    })

    it.each([
      {
        label: "a missing access token",
        status: 200,
        payload: { expires_in: 3600 },
        detail: "HTTP 200",
      },
      {
        label: "an empty access token",
        status: 200,
        payload: { access_token: "" },
        detail: "HTTP 200",
      },
      {
        label: "a non-string access token",
        status: 200,
        payload: { access_token: 123 },
        detail: "HTTP 200",
      },
      {
        label: "an error description",
        status: 400,
        payload: {
          error: "invalid_client",
          error_description: "Invalid client credentials",
        },
        detail: "Invalid client credentials",
      },
      {
        label: "an error code",
        status: 400,
        payload: { error: "invalid_token" },
        detail: "invalid_token",
      },
      {
        label: "a bare failure",
        status: 400,
        payload: {},
        detail: "HTTP 400",
      },
    ])(
      "reports $label without leaking secrets",
      async ({ status, payload, detail }) => {
        const { fetchImplementation } = sequenceFetch([
          jsonResponse(payload, { status }),
        ])
        const provider = createProvider(fetchImplementation)

        const error = assertAuthError(await captureError(provider.getAccessToken()))

        expect(error.message).toBe(`Zoho OAuth token refresh failed: ${detail}`)
        expect(error.retryable).toBe(status === 429 || status >= 500)
        expect(error.message).not.toContain(CLIENT_SECRET)
        expect(error.message).not.toContain(REFRESH_TOKEN)
      }
    )

    it("redacts secrets echoed by the token endpoint", async () => {
      const { fetchImplementation } = sequenceFetch([
        jsonResponse(
          {
            error: `invalid_${CLIENT_SECRET}`,
            error_description: `secret=${CLIENT_SECRET} refresh=${REFRESH_TOKEN}`,
          },
          { status: 400 }
        ),
      ])
      const provider = createProvider(fetchImplementation)

      const error = assertAuthError(await captureError(provider.getAccessToken()))
      const cause = causeMessage(error)

      expect(error.message).toContain("[redacted]")
      expect(error.message).not.toContain(CLIENT_SECRET)
      expect(error.message).not.toContain(REFRESH_TOKEN)
      expect(cause).toContain("[redacted]")
      expect(cause).not.toContain(CLIENT_SECRET)
      expect(cause).not.toContain(REFRESH_TOKEN)
    })

    it("ignores an empty configured secret during redaction", async () => {
      const { fetchImplementation } = sequenceFetch([
        jsonResponse(
          {
            error: "invalid_client",
            error_description: "Invalid client credentials",
          },
          { status: 400 }
        ),
      ])
      const provider = createProvider(fetchImplementation, { clientSecret: "" })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.message).toBe(
        "Zoho OAuth token refresh failed: Invalid client credentials"
      )
      expect(error.message).not.toContain("[redacted]")
    })

    it.each([
      {
        label: "seconds",
        header: "5",
        now: BASE_TIME,
        expected: "retryAfterMs=5000",
      },
      {
        label: "a cap",
        header: "120",
        now: BASE_TIME,
        expected: "retryAfterMs=30000",
      },
      {
        label: "an HTTP date",
        header: new Date(BASE_TIME + 10_000).toUTCString(),
        now: BASE_TIME,
        expected: "retryAfterMs=10000",
      },
      {
        label: "an invalid value",
        header: "not-a-date",
        now: BASE_TIME,
        expected: undefined,
      },
      {
        label: "an empty value",
        header: "",
        now: BASE_TIME,
        expected: undefined,
      },
    ])(
      "records $label retry-after metadata using the injected clock",
      async ({ header, now, expected }) => {
        const { fetchImplementation } = sequenceFetch([
          jsonResponse(
            { error: "rate_limited" },
            { status: 429, headers: { "retry-after": header } }
          ),
        ])
        const provider = createProvider(fetchImplementation, {
          now: () => now,
          maxRetries: 0,
        })

        const error = assertAuthError(await captureError(provider.getAccessToken()))
        const cause = causeMessage(error)

        expect(cause).toContain("Zoho OAuth HTTP 429; code=rate_limited")

        if (expected === undefined) {
          expect(cause).not.toContain("retryAfterMs")
        } else {
          expect(cause).toContain(expected)
        }
      }
    )

    it("does not discard a token response body read failure", async () => {
      const { fetchImplementation } = sequenceFetch([
        responseWithFailingText(new Error("decoder failed")),
      ])
      const provider = createProvider(fetchImplementation)

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.message).toBe("Unable to read the Zoho OAuth token response")
      expect(error.retryable).toBe(false)
      expect(causeMessage(error)).toBe("decoder failed")
    })

    it("retries a token response body read timeout", async () => {
      const delays: number[] = []
      const { fetchImplementation, calls } = sequenceFetch([
        responseWithFailingText(
          new DOMException("The operation timed out", "TimeoutError")
        ),
        tokenResponse(),
      ])
      const provider = createProvider(fetchImplementation, {
        maxRetries: 1,
        retryBaseDelayMs: 50,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)

      expect(calls).toHaveLength(2)
      expect(delays).toEqual([50])
    })

    it("converts a non-Error failure into a typed authentication error", async () => {
      const { fetchImplementation, calls } = sequenceFetch([tokenResponse()])
      let clockCalls = 0
      const now = (): number => {
        clockCalls += 1

        if (clockCalls === 1) {
          return BASE_TIME
        }

        // Exercise the rare case where an injected seam throws a non-Error value.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "clock exploded"
      }
      const provider = createProvider(fetchImplementation, { now })

      const error = assertAuthError(await captureError(provider.getAccessToken()))

      expect(error.message).toBe("Unable to obtain a Zoho access token")
      expect(error.retryable).toBe(false)
      expect(calls).toHaveLength(1)
    })
  })
})

describe("OAuth socket errors", () => {
  it("retries a retryable socket error", async () => {
    const delays: number[] = []
    const { fetchImplementation, calls } = sequenceFetch([
      Promise.reject(Object.assign(new Error("socket reset"), { code: "ECONNRESET" })),
      tokenResponse(),
    ])
    const provider = createProvider(fetchImplementation, {
      maxRetries: 1,
      sleep: (milliseconds) => {
        delays.push(milliseconds)
        return Promise.resolve()
      },
    })

    await expect(provider.getAccessToken()).resolves.toBe(ACCESS_TOKEN)
    expect(calls).toHaveLength(2)
    expect(delays).toEqual([100])
  })

  it("does not retry an unknown socket code", async () => {
    const { fetchImplementation, calls } = sequenceFetch([
      Promise.reject(Object.assign(new Error("bad socket"), { code: "EINVAL" })),
    ])
    const provider = createProvider(fetchImplementation, { maxRetries: 3 })

    const error = assertAuthError(await captureError(provider.getAccessToken()))
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

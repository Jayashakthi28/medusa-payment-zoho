import type { ZohoPaymentLogger } from "../types"
import { ZohoApiError } from "./errors"
import type { AccessTokenProvider } from "./oauth"

/** HTTP methods currently used by the Zoho Payments API. */
export type ZohoHttpMethod = "GET" | "POST"

/**
 * Retry policy for a request.
 *
 * `safe` retries network errors, 429, and 5xx. `none` retries only an explicit 429,
 * because a network timeout on a state-changing request may already have been processed.
 */
export type ZohoRetryPolicy = "safe" | "none"

/** One request to the Zoho Payments API. */
export interface ZohoHttpRequest {
  method: ZohoHttpMethod
  /** Path relative to the API base, e.g. `paymentsessions`. */
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  retryPolicy?: ZohoRetryPolicy
}

/** Configuration for the Zoho Payments HTTP transport. */
export interface ZohoHttpClientOptions {
  apiBaseUrl: string
  accountId: string
  tokenProvider: AccessTokenProvider
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  fetch?: typeof fetch
  logger?: ZohoPaymentLogger
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  userAgent?: string
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonObject(text: string): JsonRecord | undefined {
  if (!text) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(text)
    return isJsonRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isSuccessPayload(payload: JsonRecord): boolean {
  const code = payload.code

  if (code === undefined || code === null) {
    return true
  }

  return code === 0 || code === "0"
}

function getPayloadString(
  payload: JsonRecord | undefined,
  key: string
): string | undefined {
  const value = payload?.[key]

  if (typeof value === "string" && value.length > 0) {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return undefined
}

function isRetryableStatus(status: number, retryPolicy: ZohoRetryPolicy): boolean {
  if (status === 429) {
    return true
  }

  return retryPolicy === "safe" && status >= 500
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  )
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function getRetryAfterMilliseconds(
  header: string | null,
  now: number
): number | undefined {
  if (!header) {
    return undefined
  }

  const seconds = Number(header)

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000)
  }

  const timestamp = Date.parse(header)

  if (Number.isNaN(timestamp)) {
    return undefined
  }

  return Math.min(Math.max(timestamp - now, 0), 30_000)
}

/**
 * Small, dependency-free transport for the Zoho Payments REST API.
 *
 * Adds the account ID, bearer token, timeout, JSON handling, 401 re-authentication,
 * and bounded retries. It never includes request bodies or tokens in logs.
 */
export class ZohoHttpClient {
  private readonly options: ZohoHttpClientOptions

  constructor(options: ZohoHttpClientOptions) {
    this.options = options
  }

  async request<T>(request: ZohoHttpRequest): Promise<T> {
    let attempt = 0
    let authenticationRetried = false

    for (;;) {
      const accessToken = await this.options.tokenProvider.getAccessToken()
      let response: Response

      try {
        response = await this.send(request, accessToken)
      } catch (error) {
        if (
          (request.retryPolicy ?? "safe") === "safe" &&
          isNetworkError(error) &&
          attempt < this.options.maxRetries
        ) {
          await this.waitBeforeRetry(attempt)
          attempt += 1
          continue
        }

        throw new ZohoApiError(
          `Zoho API request failed: ${request.method} /${request.path}`,
          { retryable: isNetworkError(error), cause: error }
        )
      }

      if (response.status === 401 && !authenticationRetried) {
        authenticationRetried = true
        this.options.tokenProvider.invalidateAccessToken()
        continue
      }

      const text = await response.text().catch(() => "")
      const payload = parseJsonObject(text)
      const requestId =
        response.headers.get("x-zoho-request-id") ??
        response.headers.get("x-request-id") ??
        undefined

      if (response.ok && payload && isSuccessPayload(payload)) {
        return payload as T
      }

      const apiError = new ZohoApiError(
        this.buildErrorMessage(response, payload, request),
        {
          statusCode: response.status,
          zohoCode: getPayloadString(payload, "code"),
          requestId,
          retryable: isRetryableStatus(response.status, request.retryPolicy ?? "safe"),
        }
      )

      if (
        isRetryableStatus(response.status, request.retryPolicy ?? "safe") &&
        attempt < this.options.maxRetries
      ) {
        await this.waitBeforeRetry(attempt, response.headers.get("retry-after"))
        attempt += 1
        continue
      }

      throw apiError
    }
  }

  private async send(request: ZohoHttpRequest, accessToken: string): Promise<Response> {
    const fetchImplementation = this.options.fetch ?? globalThis.fetch
    const url = this.buildUrl(request)
    const headers: Record<string, string> = {
      authorization: `Zoho-oauthtoken ${accessToken}`,
      accept: "application/json",
      "user-agent": this.options.userAgent ?? "medusa-payment-zoho",
    }

    if (request.body !== undefined) {
      headers["content-type"] = "application/json"
    }

    return fetchImplementation(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
  }

  private buildUrl(request: ZohoHttpRequest): URL {
    const base = ensureTrailingSlash(this.options.apiBaseUrl)
    const path = request.path.replace(/^\/+/, "")
    const url = new URL(path, base)

    url.searchParams.set("account_id", this.options.accountId)

    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }

    return url
  }

  private buildErrorMessage(
    response: Response,
    payload: JsonRecord | undefined,
    request: ZohoHttpRequest
  ): string {
    const code = getPayloadString(payload, "code")
    const message = getPayloadString(payload, "message")
    const details = [
      message ?? `HTTP ${response.status}`,
      code ? `code=${code}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join("; ")

    return `Zoho API ${request.method} /${request.path} failed: ${details}`
  }

  private async waitBeforeRetry(
    attempt: number,
    retryAfterHeader?: string | null
  ): Promise<void> {
    const now = (this.options.now ?? Date.now)()
    const headerDelay = getRetryAfterMilliseconds(retryAfterHeader ?? null, now)
    const delay = headerDelay ?? this.options.retryBaseDelayMs * 2 ** attempt

    this.options.logger?.warn("Retrying Zoho API request", {
      attempt: attempt + 1,
      delayMs: delay,
    })

    await (this.options.sleep ?? defaultSleep)(delay)
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

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

const RETRYABLE_SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
])

function isNetworkError(error: unknown): boolean {
  if (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return true
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code
    return typeof code === "string" && RETRYABLE_SOCKET_CODES.has(code)
  }

  return false
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
    const retryPolicy = request.retryPolicy ?? "safe"
    let attempt = 0
    let authenticationRetried = false

    for (;;) {
      const accessToken = await this.options.tokenProvider.getAccessToken()
      let sent: { response: Response; text: string }

      try {
        sent = await this.send(request, accessToken)
      } catch (error) {
        const retryable = retryPolicy === "safe" && isNetworkError(error)

        if (retryable && attempt < this.options.maxRetries) {
          await this.waitBeforeRetry(attempt)
          attempt += 1
          continue
        }

        throw new ZohoApiError(
          `Zoho API request failed: ${request.method} /${request.path}`,
          { retryable, cause: error }
        )
      }

      const { response, text } = sent

      if (response.status === 401 && !authenticationRetried) {
        authenticationRetried = true
        this.options.tokenProvider.invalidateAccessToken()
        continue
      }

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
          retryable: isRetryableStatus(response.status, retryPolicy),
        }
      )

      if (
        isRetryableStatus(response.status, retryPolicy) &&
        attempt < this.options.maxRetries
      ) {
        await this.waitBeforeRetry(attempt, response.headers.get("retry-after"))
        attempt += 1
        continue
      }

      throw apiError
    }
  }

  private async send(
    request: ZohoHttpRequest,
    accessToken: string
  ): Promise<{ response: Response; text: string }> {
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

    const response = await fetchImplementation(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })

    // Read the body here so a timeout or socket error while streaming is treated
    // as a transport failure instead of being silently converted to an empty body.
    return { response, text: await response.text() }
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

import type { ZohoPaymentLogger } from "../types"
import { ZohoAuthenticationError } from "./errors"

const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_EXPIRY_SAFETY_SECONDS = 60

/** Minimal token-provider contract used by the API HTTP client. */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>
  invalidateAccessToken(): void
}

/** Configuration for the OAuth refresh-token client. */
export interface ZohoAccessTokenProviderOptions {
  accountsBaseUrl: string
  clientId: string
  clientSecret: string
  refreshToken: string
  redirectUri?: string
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  fetch?: typeof fetch
  logger?: ZohoPaymentLogger
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

interface CachedAccessToken {
  accessToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function parseJsonObject(text: string): TokenResponse | undefined {
  if (!text) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(text)

    if (typeof parsed === "object" && parsed !== null) {
      return parsed
    }

    return undefined
  } catch {
    return undefined
  }
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
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

/**
 * Exchanges a Zoho org refresh token for short-lived access tokens.
 *
 * - caches the access token until shortly before expiry
 * - collapses concurrent refreshes into one request
 * - retries rate limits, 5xx responses, and connectivity errors
 * - never logs or exposes the refresh token, client secret, or access token
 */
export class ZohoAccessTokenProvider implements AccessTokenProvider {
  private readonly options: ZohoAccessTokenProviderOptions
  private cachedToken: CachedAccessToken | null = null
  private refreshInFlight: Promise<string> | null = null

  constructor(options: ZohoAccessTokenProviderOptions) {
    this.options = options
  }

  async getAccessToken(): Promise<string> {
    const now = this.now()

    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.accessToken
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    this.refreshInFlight = this.refreshAccessToken().finally(() => {
      this.refreshInFlight = null
    })

    return this.refreshInFlight
  }

  invalidateAccessToken(): void {
    this.cachedToken = null
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private sleep(milliseconds: number): Promise<void> {
    return (this.options.sleep ?? defaultSleep)(milliseconds)
  }

  private async refreshAccessToken(): Promise<string> {
    let attempt = 0
    let lastError: unknown

    while (attempt <= this.options.maxRetries) {
      try {
        const token = await this.requestAccessToken()
        this.cachedToken = token
        return token.accessToken
      } catch (error) {
        lastError = error

        const canRetry =
          error instanceof ZohoAuthenticationError &&
          error.retryable &&
          attempt < this.options.maxRetries

        if (!canRetry) {
          break
        }

        const delay = this.options.retryBaseDelayMs * 2 ** attempt
        this.options.logger?.warn("Retrying Zoho OAuth token refresh", {
          attempt: attempt + 1,
          delayMs: delay,
        })
        await this.sleep(delay)
        attempt += 1
      }
    }

    this.cachedToken = null
    throw lastError instanceof Error
      ? lastError
      : new ZohoAuthenticationError("Unable to obtain a Zoho access token")
  }

  private async requestAccessToken(): Promise<CachedAccessToken> {
    const fetchImplementation = this.options.fetch ?? globalThis.fetch
    const endpoint = new URL(
      "oauth/v2/token",
      ensureTrailingSlash(this.options.accountsBaseUrl)
    )
    const body = new URLSearchParams({
      refresh_token: this.options.refreshToken,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: "refresh_token",
    })

    if (this.options.redirectUri) {
      body.set("redirect_uri", this.options.redirectUri)
    }

    let response: Response

    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      throw new ZohoAuthenticationError(
        "Unable to reach the Zoho OAuth token endpoint",
        { retryable: isNetworkError(error), cause: error }
      )
    }

    const text = await response.text().catch(() => "")
    const payload = parseJsonObject(text)
    const accessToken = asNonEmptyString(payload?.access_token)

    if (!response.ok || !accessToken) {
      const description =
        asNonEmptyString(payload?.error_description) ??
        asNonEmptyString(payload?.error) ??
        `HTTP ${response.status}`

      throw new ZohoAuthenticationError(
        `Zoho OAuth token refresh failed: ${description}`,
        {
          retryable: isRetryableStatus(response.status),
          cause: errorFromTokenResponse(response, payload),
        }
      )
    }

    const lifetime =
      asPositiveNumber(payload?.expires_in) ?? DEFAULT_TOKEN_LIFETIME_SECONDS
    const usableLifetime = Math.max(lifetime - TOKEN_EXPIRY_SAFETY_SECONDS, 10)

    return {
      accessToken,
      expiresAt: this.now() + usableLifetime * 1000,
    }
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function errorFromTokenResponse(
  response: Response,
  payload: TokenResponse | undefined
): Error {
  const code = asNonEmptyString(payload?.error)
  const description = asNonEmptyString(payload?.error_description)
  const retryAfter = getRetryAfterMilliseconds(
    response.headers.get("retry-after"),
    Date.now()
  )

  return new Error(
    [
      `Zoho OAuth HTTP ${response.status}`,
      code ? `code=${code}` : undefined,
      description ? `description=${description}` : undefined,
      retryAfter === undefined ? undefined : `retryAfterMs=${retryAfter}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join("; ")
  )
}

#!/usr/bin/env node
/**
 * Generate a Zoho Payments org-level refresh token.
 *
 * Flow:
 *   1. Build the ORG authorization URL for the configured data centre.
 *   2. Either exchange ZOHO_AUTH_CODE immediately, or start a loopback callback
 *      server, print the URL, and wait for Zoho's redirect.
 *   3. Exchange the authorization code at /oauth/v2/token and print the refresh
 *      token.
 *
 * Requires no npm packages. Credentials are read from the environment only.
 */

import { randomBytes } from "node:crypto"
import { createServer } from "node:http"

const REGION_ACCOUNTS_BASE_URLS = {
  in: "https://accounts.zoho.in",
  us: "https://accounts.zoho.com",
}

const SCOPES = [
  "ZohoPay.payments.CREATE",
  "ZohoPay.payments.READ",
  "ZohoPay.refunds.CREATE",
  "ZohoPay.refunds.READ",
]

const DEFAULT_REGION = "in"
const DEFAULT_REDIRECT_URI = "http://localhost:53682/callback"
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000
const TOKEN_REQUEST_TIMEOUT_MS = 30_000
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"])
const REDACTED = "[redacted]"

/** Secrets known so far, used to scrub every error message. */
const knownSecrets = []

class OAuthHelperError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = "OAuthHelperError"
  }
}

function redact(value) {
  let result = String(value)

  for (const secret of knownSecrets) {
    if (secret.length > 0) {
      result = result.split(secret).join(REDACTED)
    }
  }

  return result
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function requireEnvironment(name) {
  const value = process.env[name]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OAuthHelperError(
      `Missing required environment variable ${name}.\n` +
        "Set ZOHO_PAYMENTS_CLIENT_ID, ZOHO_PAYMENTS_CLIENT_SECRET, and " +
        "ZOHO_PAYMENTS_ACCOUNT_ID. See .env.example for the full list."
    )
  }

  return value.trim()
}

function optionalEnvironment(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function resolveRegion() {
  const region = (optionalEnvironment("ZOHO_PAYMENTS_REGION") ?? DEFAULT_REGION)
    .toLowerCase()
    .replace(/^zoho\./, "")
  const accountsBaseUrl = REGION_ACCOUNTS_BASE_URLS[region]

  if (accountsBaseUrl === undefined) {
    throw new OAuthHelperError(
      `Unsupported ZOHO_PAYMENTS_REGION "${region}". Use "in" (default) or "us".`
    )
  }

  return { region, accountsBaseUrl }
}

function parseRedirectUri(raw) {
  let url

  try {
    url = new URL(raw)
  } catch (error) {
    throw new OAuthHelperError(
      `ZOHO_PAYMENTS_REDIRECT_URI is not a valid URL: ${raw}`,
      { cause: error }
    )
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new OAuthHelperError(
      "ZOHO_PAYMENTS_REDIRECT_URI must not contain credentials."
    )
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new OAuthHelperError(
      "ZOHO_PAYMENTS_REDIRECT_URI must not contain a query string or fragment."
    )
  }

  const port = url.port.length > 0 ? Number(url.port) : 80

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new OAuthHelperError(
      `ZOHO_PAYMENTS_REDIRECT_URI has an invalid port: ${url.port}`
    )
  }

  return {
    url,
    port,
    pathname: url.pathname.length > 0 ? url.pathname : "/",
  }
}

/**
 * The interactive flow can only receive a callback on this machine. The manual
 * ZOHO_AUTH_CODE flow may use any redirect URI registered with Zoho.
 */
function asLocalCallback(redirect) {
  if (redirect.url.protocol !== "http:") {
    throw new OAuthHelperError(
      `ZOHO_PAYMENTS_REDIRECT_URI must use http for the local callback server, received "${redirect.url.protocol}". ` +
        "Set ZOHO_AUTH_CODE to exchange a code issued for a hosted callback instead."
    )
  }

  if (!LOOPBACK_HOSTS.has(redirect.url.hostname)) {
    throw new OAuthHelperError(
      `ZOHO_PAYMENTS_REDIRECT_URI must use localhost or 127.0.0.1 for the local callback server, received "${redirect.url.hostname}". ` +
        "Set ZOHO_AUTH_CODE to exchange a code issued for a hosted callback instead."
    )
  }

  return {
    ...redirect,
    host: "127.0.0.1",
  }
}

function buildAuthorizationUrl({
  accountsBaseUrl,
  accountId,
  clientId,
  redirectUri,
  state,
}) {
  const url = new URL("oauth/v2/org/auth", `${accountsBaseUrl}/`)

  url.searchParams.set("scope", SCOPES.join(","))
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("soid", `zohopay.${accountId}`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "offline")

  return url
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function respond(response, status, message) {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zoho Payments authorization</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; padding: 0 1rem; }
    </style>
  </head>
  <body>
    <h1>Zoho Payments authorization</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`

  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  })
  response.end(body)
}

function listenErrorMessage(error, port) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined

  if (code === "EADDRINUSE") {
    return new OAuthHelperError(
      `Port ${port} is already in use. Stop the process using it, or set ` +
        `ZOHO_PAYMENTS_REDIRECT_URI to another localhost port and register that exact ` +
        `URI as an Authorized Redirect URI in the Zoho API console.`,
      { cause: error }
    )
  }

  if (code === "EACCES") {
    return new OAuthHelperError(
      `Permission denied while binding port ${port}. Use a port above 1024, for ` +
        `example http://localhost:53682/callback.`,
      { cause: error }
    )
  }

  return new OAuthHelperError(
    `Could not start the callback server on port ${port}: ${errorMessage(error)}`,
    { cause: error }
  )
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening)
      reject(listenErrorMessage(error, port))
    }

    const handleListening = () => {
      server.off("error", handleError)
      resolve()
    }

    server.once("error", handleError)
    server.once("listening", handleListening)
    server.listen(port, host)
  })
}

async function waitForAuthorizationCode({ redirect, expectedState, authorizationUrl }) {
  const server = createServer()
  let timeout

  const codePromise = new Promise((resolve, reject) => {
    let settled = false

    const settle = (action) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      action()
    }

    timeout = setTimeout(() => {
      settle(() => {
        reject(
          new OAuthHelperError(
            `Timed out after ${Math.round(
              CALLBACK_TIMEOUT_MS / 60_000
            )} minutes waiting for the Zoho callback. Generate a new URL and try ` +
              "again, or set ZOHO_AUTH_CODE to exchange an existing code."
          )
        )
      })
    }, CALLBACK_TIMEOUT_MS)

    server.on("request", (request, response) => {
      let requestUrl

      try {
        requestUrl = new URL(request.url ?? "/", redirect.url)
      } catch {
        respond(response, 400, "The callback URL could not be parsed.")
        return
      }

      if (request.method !== "GET") {
        respond(response, 405, "Only GET callbacks are accepted.")
        return
      }

      if (requestUrl.pathname !== redirect.pathname) {
        respond(response, 404, "This is not the configured OAuth callback path.")
        return
      }

      const oauthError = requestUrl.searchParams.get("error")

      if (oauthError) {
        const description = requestUrl.searchParams.get("error_description")
        respond(
          response,
          400,
          "Authorization was not granted. Return to the terminal for details."
        )
        settle(() => {
          reject(
            new OAuthHelperError(
              `Zoho returned OAuth error "${oauthError}"${
                description ? `: ${description}` : ""
              }`
            )
          )
        })
        return
      }

      const returnedState = requestUrl.searchParams.get("state")

      if (returnedState !== expectedState) {
        respond(
          response,
          400,
          "The OAuth state did not match. Return to the terminal and start over."
        )
        settle(() => {
          reject(
            new OAuthHelperError(
              "OAuth state mismatch: the callback did not belong to this authorization " +
                "request. Start over and use only the URL printed by this script."
            )
          )
        })
        return
      }

      const code = requestUrl.searchParams.get("code")

      if (!code) {
        respond(
          response,
          400,
          "The callback contained no authorization code. Return to the terminal."
        )
        settle(() => {
          reject(new OAuthHelperError("Zoho callback did not contain a code"))
        })
        return
      }

      respond(
        response,
        200,
        "Authorization received. You can close this tab and return to the terminal."
      )
      settle(() => resolve(code))
    })
  })

  try {
    await listen(server, redirect.port, redirect.host)

    console.log(
      "\nOpen this URL in a browser where you are signed in as a Zoho Payments " +
        "Account Owner or Admin:\n"
    )
    console.log(authorizationUrl.href)
    console.log("")
    console.log(`Waiting for the callback on ${redirect.url.href} ...`)
    console.log("Press Ctrl+C to cancel.")
    return await codePromise
  } finally {
    clearTimeout(timeout)

    if (server.listening) {
      server.close()
    }
  }
}

function parseTokenPayload(text) {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

async function exchangeAuthorizationCode({
  accountsBaseUrl,
  clientId,
  clientSecret,
  redirectUri,
  code,
}) {
  const endpoint = new URL("oauth/v2/token", `${accountsBaseUrl}/`)
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  })

  let response

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new OAuthHelperError(
      `Could not reach the Zoho token endpoint at ${endpoint.origin}: ${errorMessage(
        error
      )}`,
      { cause: error }
    )
  }

  let text

  try {
    text = await response.text()
  } catch (error) {
    throw new OAuthHelperError(
      `Could not read the Zoho token response: ${errorMessage(error)}`,
      { cause: error }
    )
  }

  const payload = parseTokenPayload(text)
  const errorCode =
    typeof payload?.error === "string" && payload.error.length > 0
      ? payload.error
      : undefined
  const description =
    typeof payload?.error_description === "string" &&
    payload.error_description.length > 0
      ? payload.error_description
      : undefined
  const refreshToken =
    typeof payload?.refresh_token === "string" && payload.refresh_token.length > 0
      ? payload.refresh_token
      : undefined

  // If Zoho echoed a refresh token, never let it reach an error message.
  if (refreshToken !== undefined && !knownSecrets.includes(refreshToken)) {
    knownSecrets.push(refreshToken)
  }

  if (!response.ok || errorCode !== undefined || refreshToken === undefined) {
    const detail =
      [errorCode, description].filter(Boolean).join(": ") ||
      (payload === undefined
        ? `HTTP ${response.status} with a non-JSON body: ${text
            .slice(0, 300)
            .replace(/\s+/g, " ")}`
        : `HTTP ${response.status}`)

    if (refreshToken === undefined && errorCode === undefined && response.ok) {
      throw new OAuthHelperError(
        "Zoho returned an access token but no refresh token. Confirm that the client " +
          "is an ORG client, access_type=offline was used, and the same redirect URI " +
          "is registered in the Zoho API console."
      )
    }

    throw new OAuthHelperError(
      `Zoho rejected the authorization code (${redact(detail)}). Authorization ` +
        "codes expire after one minute; generate a new code and try again."
    )
  }

  return { payload, refreshToken }
}

function printExpiry(label, seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    console.log(`${label}: not reported by Zoho`)
    return
  }

  const expiresAt = new Date(Date.now() + seconds * 1000).toISOString()
  console.log(`${label}: ${seconds}s (at ${expiresAt})`)
}

function printSuccess(payload, refreshToken) {
  const accessTokenLifetime = Number(payload.expires_in)
  const refreshTokenLifetime = Number(payload.refresh_token_expires_in)

  console.log("\nToken exchange succeeded.")
  console.log("\nRefresh token (store as ZOHO_PAYMENTS_REFRESH_TOKEN):")
  console.log(refreshToken)
  console.log("")
  printExpiry("Access token expires in", accessTokenLifetime)
  printExpiry("Refresh token expires in", refreshTokenLifetime)
  console.log(
    "\nKeep the refresh token secret. Store it in your server environment or secret " +
      "manager; never commit it or expose it to the browser."
  )
}

async function main() {
  const clientId = requireEnvironment("ZOHO_PAYMENTS_CLIENT_ID")
  const clientSecret = requireEnvironment("ZOHO_PAYMENTS_CLIENT_SECRET")
  const accountId = requireEnvironment("ZOHO_PAYMENTS_ACCOUNT_ID")
  const { region, accountsBaseUrl } = resolveRegion()
  const redirectUri =
    optionalEnvironment("ZOHO_PAYMENTS_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI
  const parsedRedirect = parseRedirectUri(redirectUri)
  const authCode = optionalEnvironment("ZOHO_AUTH_CODE")
  const redirect =
    authCode === undefined ? asLocalCallback(parsedRedirect) : parsedRedirect

  knownSecrets.push(clientSecret)

  if (authCode !== undefined) {
    knownSecrets.push(authCode)
  }

  const state = randomBytes(32).toString("hex")
  const authorizationUrl = buildAuthorizationUrl({
    accountsBaseUrl,
    accountId,
    clientId,
    redirectUri,
    state,
  })

  console.log("Zoho Payments refresh-token helper")
  console.log(`  Region:       ${region} (${accountsBaseUrl})`)
  console.log(`  Account:      zohopay.${accountId}`)
  console.log(`  Redirect URI: ${redirect.url.href}`)
  console.log(`  Scopes:       ${SCOPES.join(", ")}`)

  let code = authCode

  if (code !== undefined) {
    console.log(
      "\nUsing ZOHO_AUTH_CODE from the environment; skipping the local callback server."
    )
  } else {
    code = await waitForAuthorizationCode({
      redirect,
      expectedState: state,
      authorizationUrl,
    })
    console.log("\nAuthorization code received.")
  }

  console.log(
    "Exchanging the authorization code now (codes expire after 60 seconds) ..."
  )
  const { payload, refreshToken } = await exchangeAuthorizationCode({
    accountsBaseUrl,
    clientId,
    clientSecret,
    redirectUri,
    code,
  })

  printSuccess(payload, refreshToken)
}

main().catch((error) => {
  const message = redact(errorMessage(error))
  console.error(`\nError: ${message}`)
  process.exitCode = 1
})

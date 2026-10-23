#!/usr/bin/env node
/**
 * Live Zoho Payments credential smoke test.
 *
 * Creates one payment session and retrieves it again. It never authorizes,
 * captures, charges, or refunds a payment. Run `pnpm build` first.
 *
 * Required environment variables:
 *   ZOHO_PAYMENTS_ACCOUNT_ID
 *   ZOHO_PAYMENTS_CLIENT_ID
 *   ZOHO_PAYMENTS_CLIENT_SECRET
 *   ZOHO_PAYMENTS_REFRESH_TOKEN
 *
 * Optional:
 *   ZOHO_PAYMENTS_REGION          in (default) or us
 *   ZOHO_PAYMENTS_SMOKE_AMOUNT    1.00 by default
 *   ZOHO_PAYMENTS_SMOKE_CURRENCY  INR by default
 */

import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..")
const SERVER_ENTRY = join(REPOSITORY_ROOT, "dist", "server", "index.js")

const REGIONS = {
  in: {
    apiBaseUrl: "https://payments.zoho.in/api/v1/",
    accountsBaseUrl: "https://accounts.zoho.in/",
    hostedCheckoutBaseUrl: "https://payments.zoho.in/hostedcheckout",
    widgetDomain: "IN",
  },
  us: {
    apiBaseUrl: "https://payments.zoho.com/api/v1/",
    accountsBaseUrl: "https://accounts.zoho.com/",
    hostedCheckoutBaseUrl: "https://payments.zoho.com/hostedcheckout",
    widgetDomain: "US",
  },
}

const SANDBOX_REGIONS = {
  in: {
    apiBaseUrl: "https://paymentssandbox.zoho.in/api/v1/",
    accountsBaseUrl: "https://accounts.zoho.in/",
    hostedCheckoutBaseUrl: "https://paymentssandbox.zoho.in/hostedcheckout",
    widgetDomain: "IN",
  },
}

const DEFAULT_AMOUNT = "1.00"
const DEFAULT_CURRENCY = "INR"

class SmokeTestError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = "SmokeTestError"
  }
}

function messageFrom(error) {
  return error instanceof Error ? error.message : String(error)
}

function requireEnvironment(name) {
  const value = process.env[name]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SmokeTestError(
      `Missing required environment variable ${name}. Set all four Zoho credentials ` +
        "from .env.example before running the smoke test."
    )
  }

  return value.trim()
}

function optionalEnvironment(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function positiveDecimal(value) {
  return /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value)
}

function formatExpiry(value) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "not reported"
  }

  // Zoho returns expiry_time as epoch seconds. Accept milliseconds too so the
  // diagnostic remains useful if the wire format changes.
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000
  return new Date(milliseconds).toISOString()
}

async function loadServerEntry() {
  if (!existsSync(SERVER_ENTRY)) {
    throw new SmokeTestError(
      `Build output not found at ${SERVER_ENTRY}. Run "pnpm build" first.`
    )
  }

  let serverEntry

  try {
    serverEntry = await import(pathToFileURL(SERVER_ENTRY).href)
  } catch (error) {
    throw new SmokeTestError(
      `Could not import ${SERVER_ENTRY}: ${messageFrom(error)}. Run "pnpm build" ` +
        "and make sure dependencies are installed."
    )
  }

  for (const name of [
    "ZohoPaymentsClient",
    "formatAmountForZoho",
    "normalizeCurrencyCode",
  ]) {
    if (typeof serverEntry[name] !== "function") {
      throw new SmokeTestError(
        `The built server entry point does not export ${name}. Run "pnpm build" again.`
      )
    }
  }

  return serverEntry
}

async function runSmokeTest() {
  if (process.env.NODE_ENV === "production") {
    throw new SmokeTestError(
      "Refusing to run with NODE_ENV=production. The smoke test creates a real Zoho " +
        "payment session, so run it only with development or test credentials."
    )
  }

  const serverEntry = await loadServerEntry()
  const { ZohoPaymentsClient, formatAmountForZoho, normalizeCurrencyCode } = serverEntry

  const environment = (
    optionalEnvironment("ZOHO_PAYMENTS_ENVIRONMENT") ?? "live"
  ).toLowerCase()
  const regionName = (optionalEnvironment("ZOHO_PAYMENTS_REGION") ?? "in")
    .toLowerCase()
    .replace(/^zoho\./, "")

  if (environment !== "live" && environment !== "sandbox") {
    throw new SmokeTestError(
      `Unsupported ZOHO_PAYMENTS_ENVIRONMENT "${environment}". Use "live" or "sandbox".`
    )
  }

  const region =
    environment === "sandbox" ? SANDBOX_REGIONS[regionName] : REGIONS[regionName]

  if (region === undefined) {
    throw new SmokeTestError(
      environment === "sandbox"
        ? `Zoho sandbox is currently supported only for region "in"; received "${regionName}".`
        : `Unsupported ZOHO_PAYMENTS_REGION "${regionName}". Use "in" (default) or "us".`
    )
  }

  const accountId = requireEnvironment("ZOHO_PAYMENTS_ACCOUNT_ID")
  const clientId = requireEnvironment("ZOHO_PAYMENTS_CLIENT_ID")
  const clientSecret = requireEnvironment("ZOHO_PAYMENTS_CLIENT_SECRET")
  const refreshToken = requireEnvironment("ZOHO_PAYMENTS_REFRESH_TOKEN")

  const currency = normalizeCurrencyCode(
    optionalEnvironment("ZOHO_PAYMENTS_SMOKE_CURRENCY") ?? DEFAULT_CURRENCY
  )
  const amount = formatAmountForZoho(
    optionalEnvironment("ZOHO_PAYMENTS_SMOKE_AMOUNT") ?? DEFAULT_AMOUNT,
    currency
  )

  if (!positiveDecimal(amount)) {
    throw new SmokeTestError(
      `Smoke-test amount must be greater than zero after formatting, received "${amount}".`
    )
  }

  console.log("Zoho Payments smoke test")
  console.log(`  Environment: ${environment}`)
  console.log(`  Region:   ${regionName}`)
  console.log(`  Amount:   ${currency} ${amount}`)
  console.log("  Scope:    create and retrieve one payment session only")
  console.log("  Safety:   no authorization, capture, charge, or refund\n")

  const client = new ZohoPaymentsClient({
    accountId,
    clientId,
    clientSecret,
    refreshToken,
    regionConfig: region,
    timeoutMs: 15_000,
    maxRetries: 3,
    retryBaseDelayMs: 500,
  })

  const reference = `smoke_${Date.now()}`

  console.log("Creating a Zoho payment session ...")
  const session = await client.createPaymentSession({
    amount,
    currency,
    description: "Medusa payment provider smoke test (no charge)",
    invoiceNumber: reference,
    referenceNumber: reference,
    metadata: [{ key: "source", value: "medusa-payment-zoho smoke" }],
  })

  if (typeof session.payments_session_id !== "string") {
    throw new SmokeTestError(
      "Zoho returned a payment session without a payments_session_id."
    )
  }

  const checkoutUrl =
    typeof session.access_key === "string" && session.access_key.length > 0
      ? `${region.hostedCheckoutBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(
          session.access_key
        )}`
      : undefined

  console.log("  Created payment session.")
  console.log(`  Session ID: ${session.payments_session_id}`)
  console.log(`  Status:     ${session.status ?? "not reported"}`)
  console.log(`  Expires:    ${formatExpiry(session.expiry_time)}`)

  if (checkoutUrl !== undefined) {
    console.log(`  Hosted checkout URL: ${checkoutUrl}`)
  } else {
    console.log(
      "  Hosted checkout URL: not returned for this session; use the session ID " +
        "with the embedded Checkout Widget."
    )
  }

  console.log("\nRetrieving the session to verify amount and currency ...")
  const retrieved = await client.retrievePaymentSession(session.payments_session_id)

  if (retrieved.payments_session_id !== session.payments_session_id) {
    throw new SmokeTestError(
      `Retrieved session ID ${retrieved.payments_session_id} does not match ` +
        `created session ID ${session.payments_session_id}.`
    )
  }

  const retrievedCurrency = normalizeCurrencyCode(retrieved.currency)
  const retrievedAmount = formatAmountForZoho(retrieved.amount, currency)

  if (retrievedCurrency !== currency) {
    throw new SmokeTestError(
      `Currency mismatch: created ${currency}, retrieved ${retrievedCurrency}.`
    )
  }

  if (retrievedAmount !== amount) {
    throw new SmokeTestError(
      `Amount mismatch: created ${amount}, retrieved ${retrievedAmount}.`
    )
  }

  console.log("\nSmoke test passed.")
  console.log(`  Verified currency: ${retrievedCurrency}`)
  console.log(`  Verified amount:   ${retrievedAmount}`)
  console.log(
    "\nNo payment was authorized, captured, charged, or refunded. The unpaid Zoho " +
      "session expires automatically."
  )
}

runSmokeTest().catch((error) => {
  console.error(`\nSmoke test failed: ${messageFrom(error)}`)
  process.exitCode = 1
})

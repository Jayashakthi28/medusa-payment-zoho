import type {
  ZohoCheckoutMode,
  ZohoCheckoutResult,
  ZohoCustomerPrefill,
  ZohoWidgetDomain,
  ZohoWidgetPaymentInput,
} from "../types"
import { ZohoUnsupportedOperationError, ZohoValidationError } from "../core/errors"

/** Default Zoho Checkout Widget script. */
export const ZOHO_WIDGET_SCRIPT_URL =
  "https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js"

const DEFAULT_SCRIPT_TIMEOUT_MS = 10_000

interface ZohoWidgetConfig {
  account_id: string
  domain: ZohoWidgetDomain
  otherOptions: {
    api_key: string
  }
}

interface ZohoWidgetAddress {
  name?: string
  email?: string
  phone?: string
}

interface ZohoWidgetRequestOptions {
  amount: string
  transaction_type: "payment"
  currency_code: string
  payments_session_id: string
  currency_symbol?: string
  business?: string
  description: string
  invoice_number?: string
  address?: ZohoWidgetAddress
}

interface ZohoWidgetResponse {
  payment_id?: string
  signature?: string
  message?: string
}

interface ZohoPaymentsInstance {
  requestPaymentMethod(options: ZohoWidgetRequestOptions): Promise<ZohoWidgetResponse>
  close?(): void | Promise<void>
}

type ZohoPaymentsConstructor = new (config: ZohoWidgetConfig) => ZohoPaymentsInstance

interface ZohoBrowserWindow extends Window {
  ZPayments?: ZohoPaymentsConstructor
}

/** A validated view of the checkout fields exposed by Medusa's payment session. */
export interface ZohoCheckoutSession {
  zohoSessionId: string
  checkoutMode: ZohoCheckoutMode
  amount: string
  currencyCode: string
  currencySymbol: string
  description: string
  businessName?: string
  invoiceNumber: string
  expiresAt?: number
  widget?: {
    accountId: string
    domain: ZohoWidgetDomain
    apiKey: string
  }
  checkoutUrl?: string
}

const scriptPromises = new Map<string, Promise<void>>()
const instanceCache = new Map<string, ZohoPaymentsInstance>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getBrowserWindow(): ZohoBrowserWindow {
  if (typeof window === "undefined") {
    throw new ZohoValidationError("Zoho Checkout can only be opened in a browser")
  }

  return window
}

function parseCheckoutSession(session: Record<string, unknown>): ZohoCheckoutSession {
  const zohoSessionId = readString(session, "zohoSessionId")
  const checkoutMode = session.checkoutMode
  const amount = readString(session, "amount")
  const currencyCode = readString(session, "currencyCode")
  const currencySymbol = readString(session, "currencySymbol")
  const description = readString(session, "description")
  const invoiceNumber = readString(session, "invoiceNumber")

  if (
    !zohoSessionId ||
    (checkoutMode !== "widget" && checkoutMode !== "hosted") ||
    !amount ||
    !currencyCode ||
    !currencySymbol ||
    !description
  ) {
    throw new ZohoValidationError(
      "Medusa payment session is missing the Zoho checkout data"
    )
  }

  const widgetValue = session.widget
  const widgetAccountId = isRecord(widgetValue)
    ? readString(widgetValue, "accountId")
    : undefined
  const widgetApiKey = isRecord(widgetValue)
    ? readString(widgetValue, "apiKey")
    : undefined
  const widgetDomain: ZohoWidgetDomain | undefined =
    isRecord(widgetValue) &&
    (widgetValue.domain === "IN" || widgetValue.domain === "US")
      ? widgetValue.domain
      : undefined

  return {
    zohoSessionId,
    checkoutMode,
    amount,
    currencyCode,
    currencySymbol,
    description,
    businessName: readString(session, "businessName"),
    invoiceNumber: invoiceNumber ?? "",
    expiresAt: readNumber(session, "expiresAt"),
    widget:
      widgetAccountId && widgetApiKey && widgetDomain
        ? {
            accountId: widgetAccountId,
            domain: widgetDomain,
            apiKey: widgetApiKey,
          }
        : undefined,
    checkoutUrl: readString(session, "checkoutUrl"),
  }
}

function waitForZohoGlobal(
  browserWindow: ZohoBrowserWindow,
  script: HTMLScriptElement,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handles: {
      interval?: ReturnType<typeof setInterval>
      timeout?: ReturnType<typeof setTimeout>
    } = {}

    const cleanup = (): void => {
      clearInterval(handles.interval)
      clearTimeout(handles.timeout)
      script.removeEventListener("error", handleError)
    }

    const succeed = (): void => {
      cleanup()
      resolve()
    }

    const fail = (message: string): void => {
      cleanup()
      reject(new ZohoValidationError(message))
    }

    const handleError = (): void => {
      fail("Failed to load the Zoho Checkout Widget script")
    }

    script.addEventListener("error", handleError, { once: true })

    handles.interval = setInterval(() => {
      if (browserWindow.ZPayments) {
        succeed()
      }
    }, 25)

    handles.timeout = setTimeout(() => {
      fail("Timed out while loading the Zoho Checkout Widget script")
    }, timeoutMs)
  })
}

/** Find a previously inserted tag for the exact URL, not just any Zoho tag. */
function findExistingScript(scriptUrl: string): HTMLScriptElement | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[data-zoho-payments="true"]'
  )

  for (const script of scripts) {
    if (script.src === scriptUrl || script.getAttribute("src") === scriptUrl) {
      return script
    }
  }

  return null
}

function resolveScriptUrl(scriptUrl: string | undefined): string {
  const value = scriptUrl ?? ZOHO_WIDGET_SCRIPT_URL
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch (error) {
    throw new ZohoValidationError("Invalid Zoho widget script URL", {
      cause: error,
    })
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.protocol === "http:" && !isLocalhost)
  ) {
    throw new ZohoValidationError(
      "Zoho widget script URL must use https (http is allowed only for localhost)"
    )
  }

  return parsed.toString()
}

/** Load the Zoho widget script once, reusing an existing global or script tag. */
export function loadZohoPaymentsScript(
  options: {
    scriptUrl?: string
    timeoutMs?: number
  } = {}
): Promise<void> {
  const browserWindow = getBrowserWindow()
  const scriptUrl = resolveScriptUrl(options.scriptUrl)
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS

  if (browserWindow.ZPayments) {
    return Promise.resolve()
  }

  const inFlight = scriptPromises.get(scriptUrl)

  if (inFlight) {
    return inFlight
  }

  const existing = findExistingScript(scriptUrl)
  const script = existing ?? document.createElement("script")

  if (!existing) {
    script.src = scriptUrl
    script.async = true
    script.dataset.zohoPayments = "true"
    document.head.appendChild(script)
  }

  const promise = waitForZohoGlobal(browserWindow, script, timeoutMs).catch(
    (error: unknown) => {
      scriptPromises.delete(scriptUrl)

      // A failed tag cannot emit a second load/error event, so leaving it in the
      // DOM would make every retry wait on a script that can never recover.
      if (!existing) {
        script.remove()
      }

      throw error
    }
  )

  scriptPromises.set(scriptUrl, promise)

  return promise
}

function getWidgetInstance(
  browserWindow: ZohoBrowserWindow,
  widget: NonNullable<ZohoCheckoutSession["widget"]>
): ZohoPaymentsInstance {
  const ZPayments = browserWindow.ZPayments

  if (!ZPayments) {
    throw new ZohoValidationError("Zoho Checkout Widget script is not available")
  }

  const cacheKey = `${widget.accountId}:${widget.domain}:${widget.apiKey}`
  const cached = instanceCache.get(cacheKey)

  if (cached) {
    return cached
  }

  const instance = new ZPayments({
    account_id: widget.accountId,
    domain: widget.domain,
    otherOptions: {
      api_key: widget.apiKey,
    },
  })

  instanceCache.set(cacheKey, instance)

  return instance
}

function buildWidgetOptions(
  session: ZohoCheckoutSession,
  input: ZohoWidgetPaymentInput
): ZohoWidgetRequestOptions {
  const options: ZohoWidgetRequestOptions = {
    amount: session.amount,
    transaction_type: "payment",
    currency_code: session.currencyCode,
    payments_session_id: session.zohoSessionId,
    currency_symbol: session.currencySymbol,
    description: input.description ?? session.description,
  }

  const invoiceNumber = input.invoiceNumber ?? session.invoiceNumber

  if (invoiceNumber) {
    options.invoice_number = invoiceNumber
  }

  if (session.businessName) {
    options.business = session.businessName
  }

  const address = buildAddress(input.customer)

  if (address) {
    options.address = address
  }

  return options
}

function buildAddress(
  customer: ZohoCustomerPrefill | undefined
): ZohoWidgetAddress | undefined {
  if (!customer) {
    return undefined
  }

  const address: ZohoWidgetAddress = {}

  if (customer.name) {
    address.name = customer.name
  }

  if (customer.email) {
    address.email = customer.email
  }

  if (customer.phone) {
    address.phone = customer.phone
  }

  return Object.keys(address).length > 0 ? address : undefined
}

function getErrorField(error: unknown, key: string): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }

  const value = error[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

async function closeWidget(instance: ZohoPaymentsInstance): Promise<void> {
  if (!instance.close) {
    return
  }

  try {
    await instance.close()
  } catch {
    // Closing is best-effort cleanup; never mask the payment result.
  }
}

/** True when the Zoho session's recorded expiry has passed. */
export function isZohoSessionExpired(
  session: Record<string, unknown>,
  now: number = Date.now()
): boolean {
  const expiresAt = readNumber(session, "expiresAt")
  return expiresAt !== undefined && expiresAt <= now
}

/** Read the checkout mode from a Medusa payment session's data. */
export function getZohoCheckoutMode(
  session: Record<string, unknown>
): ZohoCheckoutMode | undefined {
  const mode = session.checkoutMode
  return mode === "widget" || mode === "hosted" ? mode : undefined
}

/**
 * Open the Zoho Checkout Widget and collect the payment result.
 *
 * The widget's `payment_id` is informational. The server verifies the payment with
 * Zoho before creating the Medusa payment, so a malicious client cannot forge success.
 */
export async function payWithZohoCheckout(
  input: ZohoWidgetPaymentInput
): Promise<ZohoCheckoutResult> {
  if (isZohoSessionExpired(input.session)) {
    return { ok: false, reason: "expired" }
  }

  const session = parseCheckoutSession(input.session)

  if (session.checkoutMode !== "widget") {
    return { ok: false, reason: "hosted_checkout_required" }
  }

  const widget = session.widget

  if (!widget) {
    return { ok: false, reason: "not_configured" }
  }

  const browserWindow = getBrowserWindow()

  await loadZohoPaymentsScript({
    scriptUrl: input.scriptUrl,
    timeoutMs: input.timeoutMs,
  })

  const instance = getWidgetInstance(browserWindow, widget)

  try {
    const response = await instance.requestPaymentMethod(
      buildWidgetOptions(session, input)
    )

    if (!response.payment_id) {
      return {
        ok: false,
        reason: "failed",
        message: "Zoho did not return a payment ID",
      }
    }

    return {
      ok: true,
      paymentId: response.payment_id,
      paymentSessionId: session.zohoSessionId,
      ...(response.signature ? { signature: response.signature } : {}),
    }
  } catch (error) {
    const code = getErrorField(error, "code")

    if (code === "widget_closed") {
      return { ok: false, reason: "closed" }
    }

    return {
      ok: false,
      reason: "failed",
      message: getErrorField(error, "message") ?? "Zoho payment failed",
      ...(code ? { code } : {}),
    }
  } finally {
    await closeWidget(instance)
  }
}

/**
 * Redirect the browser to Zoho Hosted Checkout.
 *
 * Returns the destination URL so callers can assert or log it before navigation.
 */
export function redirectToZohoHostedCheckout(session: Record<string, unknown>): string {
  if (isZohoSessionExpired(session)) {
    throw new ZohoValidationError("Zoho checkout session has expired")
  }

  const parsed = parseCheckoutSession(session)

  if (parsed.checkoutMode !== "hosted") {
    throw new ZohoUnsupportedOperationError(
      "This Zoho payment session uses the embedded widget, not hosted checkout"
    )
  }

  if (!parsed.checkoutUrl) {
    throw new ZohoValidationError(
      "Zoho hosted-checkout URL is missing from the payment session"
    )
  }

  getBrowserWindow().location.assign(parsed.checkoutUrl)

  return parsed.checkoutUrl
}

/** Clear module-level caches. Exposed for tests only. */
export function resetZohoCheckoutCacheForTests(): void {
  scriptPromises.clear()
  instanceCache.clear()
}

export type { ZohoCheckoutResult, ZohoCustomerPrefill, ZohoWidgetPaymentInput }

/** Stable error codes emitted by this plugin. */
export type ZohoPaymentErrorCode =
  | "ZOHO_CONFIGURATION_ERROR"
  | "ZOHO_AUTHENTICATION_ERROR"
  | "ZOHO_API_ERROR"
  | "ZOHO_VALIDATION_ERROR"
  | "ZOHO_WEBHOOK_VERIFICATION_ERROR"
  | "ZOHO_UNSUPPORTED_OPERATION"
  | "ZOHO_PAYMENT_STATE_ERROR"

/** Base class for every error raised by this package. */
export class ZohoPaymentError extends Error {
  readonly code: ZohoPaymentErrorCode
  readonly retryable: boolean

  constructor(
    code: ZohoPaymentErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

/** Invalid provider configuration detected at startup. */
export class ZohoConfigurationError extends ZohoPaymentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("ZOHO_CONFIGURATION_ERROR", message, options)
  }
}

/** OAuth refresh failed or credentials/scopes are invalid. */
export class ZohoAuthenticationError extends ZohoPaymentError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super("ZOHO_AUTHENTICATION_ERROR", message, options)
  }
}

/** A Zoho API request failed. */
export class ZohoApiError extends ZohoPaymentError {
  readonly statusCode: number | undefined
  readonly zohoCode: string | undefined
  readonly requestId: string | undefined

  constructor(
    message: string,
    options: {
      statusCode?: number
      zohoCode?: string
      requestId?: string
      retryable?: boolean
      cause?: unknown
    } = {}
  ) {
    super("ZOHO_API_ERROR", message, {
      retryable: options.retryable,
      cause: options.cause,
    })
    this.statusCode = options.statusCode
    this.zohoCode = options.zohoCode
    this.requestId = options.requestId
  }
}

/** Untrusted input (storefront data, options, webhook payload) was invalid. */
export class ZohoValidationError extends ZohoPaymentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("ZOHO_VALIDATION_ERROR", message, options)
  }
}

/** Webhook or redirect signature verification failed. */
export class ZohoWebhookVerificationError extends ZohoPaymentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("ZOHO_WEBHOOK_VERIFICATION_ERROR", message, options)
  }
}

/** The requested operation is not supported by Zoho Payments. */
export class ZohoUnsupportedOperationError extends ZohoPaymentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("ZOHO_UNSUPPORTED_OPERATION", message, options)
  }
}

/** A payment is in a state that does not permit the requested operation. */
export class ZohoPaymentStateError extends ZohoPaymentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("ZOHO_PAYMENT_STATE_ERROR", message, options)
  }
}

/** Type guard for errors raised by this package. */
export function isZohoPaymentError(error: unknown): error is ZohoPaymentError {
  return error instanceof ZohoPaymentError
}

/** Convert an unknown thrown value to a safe, non-secret message. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

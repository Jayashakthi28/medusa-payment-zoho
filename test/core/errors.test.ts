import { describe, expect, it } from "vitest"

import {
  ZohoApiError,
  ZohoAuthenticationError,
  ZohoConfigurationError,
  ZohoPaymentError,
  ZohoPaymentStateError,
  ZohoUnsupportedOperationError,
  ZohoValidationError,
  ZohoWebhookVerificationError,
  getErrorMessage,
  isZohoPaymentError,
  type ZohoPaymentErrorCode,
} from "../../src/core/errors"

interface ErrorCase {
  name: string
  code: ZohoPaymentErrorCode
  create: (message: string, cause?: unknown) => ZohoPaymentError
}

const errorCases: ErrorCase[] = [
  {
    name: "ZohoConfigurationError",
    code: "ZOHO_CONFIGURATION_ERROR",
    create: (message, cause) => new ZohoConfigurationError(message, { cause }),
  },
  {
    name: "ZohoAuthenticationError",
    code: "ZOHO_AUTHENTICATION_ERROR",
    create: (message, cause) => new ZohoAuthenticationError(message, { cause }),
  },
  {
    name: "ZohoApiError",
    code: "ZOHO_API_ERROR",
    create: (message, cause) => new ZohoApiError(message, { cause }),
  },
  {
    name: "ZohoValidationError",
    code: "ZOHO_VALIDATION_ERROR",
    create: (message, cause) => new ZohoValidationError(message, { cause }),
  },
  {
    name: "ZohoWebhookVerificationError",
    code: "ZOHO_WEBHOOK_VERIFICATION_ERROR",
    create: (message, cause) => new ZohoWebhookVerificationError(message, { cause }),
  },
  {
    name: "ZohoUnsupportedOperationError",
    code: "ZOHO_UNSUPPORTED_OPERATION",
    create: (message, cause) => new ZohoUnsupportedOperationError(message, { cause }),
  },
  {
    name: "ZohoPaymentStateError",
    code: "ZOHO_PAYMENT_STATE_ERROR",
    create: (message, cause) => new ZohoPaymentStateError(message, { cause }),
  },
]

describe("ZohoPaymentError", () => {
  it("keeps the code, message, and non-retryable default", () => {
    const error = new ZohoPaymentError(
      "ZOHO_PAYMENT_STATE_ERROR",
      "payment cannot be captured"
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ZohoPaymentError)
    expect(error.name).toBe("ZohoPaymentError")
    expect(error.code).toBe("ZOHO_PAYMENT_STATE_ERROR")
    expect(error.message).toBe("payment cannot be captured")
    expect(error.retryable).toBe(false)
    expect(error.cause).toBeUndefined()
  })

  it("accepts retryable and cause options", () => {
    const cause = new Error("socket closed")
    const error = new ZohoPaymentError("ZOHO_API_ERROR", "upstream failed", {
      retryable: true,
      cause,
    })

    expect(error.retryable).toBe(true)
    expect(error.cause).toBe(cause)
  })

  it("does not set a cause when the option is explicitly undefined", () => {
    const error = new ZohoPaymentError("ZOHO_API_ERROR", "upstream failed", {
      cause: undefined,
    })

    expect(error.cause).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false)
  })
})

describe.each(errorCases)("$name", ({ name, code, create }) => {
  it("exposes the stable code and subclass name", () => {
    const error = create("something went wrong")

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ZohoPaymentError)
    expect(error.name).toBe(name)
    expect(error.code).toBe(code)
    expect(error.message).toBe("something went wrong")
    expect(error.retryable).toBe(false)
    expect(error.cause).toBeUndefined()
  })

  it("forwards a cause", () => {
    const cause = new Error("root cause")
    const error = create("something went wrong", cause)

    expect(error.cause).toBe(cause)
  })
})

describe("ZohoApiError", () => {
  it("retains HTTP status, Zoho code, request ID, and retryability", () => {
    const cause = new Error("bad gateway")
    const error = new ZohoApiError("Zoho rejected the request", {
      statusCode: 502,
      zohoCode: "INTERNAL_ERROR",
      requestId: "req_123",
      retryable: true,
      cause,
    })

    expect(error.code).toBe("ZOHO_API_ERROR")
    expect(error.statusCode).toBe(502)
    expect(error.zohoCode).toBe("INTERNAL_ERROR")
    expect(error.requestId).toBe("req_123")
    expect(error.retryable).toBe(true)
    expect(error.cause).toBe(cause)
  })

  it("leaves optional response metadata undefined", () => {
    const error = new ZohoApiError("Zoho rejected the request")

    expect(error.statusCode).toBeUndefined()
    expect(error.zohoCode).toBeUndefined()
    expect(error.requestId).toBeUndefined()
  })

  it("treats an explicitly false retryable flag as false", () => {
    const error = new ZohoApiError("Zoho rejected the request", {
      retryable: false,
    })

    expect(error.retryable).toBe(false)
  })
})

describe("ZohoAuthenticationError", () => {
  it("supports retryable authentication failures", () => {
    const error = new ZohoAuthenticationError("token endpoint unavailable", {
      retryable: true,
    })

    expect(error.retryable).toBe(true)
  })
})

describe("isZohoPaymentError", () => {
  it.each(errorCases)("recognizes $name", ({ create }) => {
    expect(isZohoPaymentError(create("failure"))).toBe(true)
  })

  it("recognizes the base class", () => {
    expect(isZohoPaymentError(new ZohoPaymentError("ZOHO_API_ERROR", "failure"))).toBe(
      true
    )
  })

  it.each([
    new Error("plain error"),
    "failure",
    42,
    null,
    undefined,
    { code: "ZOHO_API_ERROR" },
  ])("rejects non-package value %j", (value) => {
    expect(isZohoPaymentError(value)).toBe(false)
  })
})

describe("getErrorMessage", () => {
  it("returns an Error message", () => {
    expect(getErrorMessage(new Error("connection refused"))).toBe("connection refused")
  })

  it("returns a package error message", () => {
    expect(getErrorMessage(new ZohoValidationError("invalid amount"))).toBe(
      "invalid amount"
    )
  })

  it("returns a thrown string unchanged", () => {
    expect(getErrorMessage("raw failure")).toBe("raw failure")
  })

  it.each([42, true, null, undefined, { message: "not an Error" }])(
    "returns the fallback for %j",
    (value) => {
      expect(getErrorMessage(value)).toBe("Unknown error")
    }
  )

  it("preserves an empty Error message", () => {
    expect(getErrorMessage(new Error(""))).toBe("")
  })
})

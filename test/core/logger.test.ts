import { describe, expect, it, vi } from "vitest"

import { NOOP_LOGGER, toPaymentLogger } from "../../src/core/logger"

describe("NOOP_LOGGER", () => {
  it("discards every message without throwing", () => {
    expect(() => {
      NOOP_LOGGER.debug("debug message", { id: 1 })
      NOOP_LOGGER.warn("warn message", { id: 2 })
      NOOP_LOGGER.error("error message", { id: 3 })
    }).not.toThrow()
  })
})

describe("toPaymentLogger", () => {
  it.each([undefined, null, 42, true, "logger", () => undefined])(
    "returns the no-op logger for non-record value %j",
    (value) => {
      expect(toPaymentLogger(value)).toBe(NOOP_LOGGER)
    }
  )

  it("returns the no-op logger for a record without logging methods", () => {
    expect(toPaymentLogger({})).toBe(NOOP_LOGGER)
    expect(toPaymentLogger([])).toBe(NOOP_LOGGER)
  })

  it("returns the no-op logger when logging properties are not functions", () => {
    expect(toPaymentLogger({ debug: "debug", warn: 1, error: null })).toBe(NOOP_LOGGER)
  })

  it("forwards debug, warn, and error messages with context", () => {
    const debug = vi.fn()
    const warn = vi.fn()
    const error = vi.fn()

    const adapter = toPaymentLogger({ debug, warn, error })

    adapter.debug("debug message", { attempt: 1 })
    adapter.warn("warn message")
    adapter.error("error message", { code: "FAILED" })

    expect(debug).toHaveBeenCalledWith("debug message", { attempt: 1 })
    expect(warn).toHaveBeenCalledWith("warn message", undefined)
    expect(error).toHaveBeenCalledWith("error message", { code: "FAILED" })
  })

  it("keeps working when only some logging methods exist", () => {
    const warn = vi.fn()
    const adapter = toPaymentLogger({ warn })

    adapter.debug("ignored")
    adapter.warn("kept", { reason: "test" })
    adapter.error("ignored")

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("kept", { reason: "test" })
  })

  it("ignores non-function methods while forwarding the available ones", () => {
    const warn = vi.fn()
    const adapter = toPaymentLogger({ debug: "debug", warn, error: "error" })

    adapter.debug("ignored")
    adapter.warn("kept")
    adapter.error("ignored")

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("kept", undefined)
  })

  it("ignores a missing warn method", () => {
    const debug = vi.fn()
    const error = vi.fn()
    const adapter = toPaymentLogger({ debug, error })

    adapter.warn("ignored")

    expect(debug).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("binds methods to the original logger object", () => {
    class BoundLogger {
      readonly entries: string[] = []

      debug(message: string): void {
        this.entries.push(`debug:${message}`)
      }

      warn(message: string): void {
        this.entries.push(`warn:${message}`)
      }

      error(message: string): void {
        this.entries.push(`error:${message}`)
      }
    }

    const logger = new BoundLogger()
    const adapter = toPaymentLogger(logger)

    adapter.debug("one")
    adapter.warn("two")
    adapter.error("three")

    expect(logger.entries).toEqual(["debug:one", "warn:two", "error:three"])
  })
})

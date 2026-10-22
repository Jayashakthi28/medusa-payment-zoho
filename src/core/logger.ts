import type { ZohoPaymentLogger } from "../types"

/** Logger that discards every message. Used when Medusa does not provide one. */
export const NOOP_LOGGER: ZohoPaymentLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function getMethod(
  value: UnknownRecord,
  method: string
): ((...args: unknown[]) => void) | undefined {
  const candidate = value[method]
  return typeof candidate === "function"
    ? (candidate as (...args: unknown[]) => void).bind(value)
    : undefined
}

/**
 * Adapt Medusa's logger (or any compatible logger) to the narrow interface used here.
 *
 * The adapter deliberately forwards only the message and context. Callers are
 * responsible for never passing secrets in either argument.
 */
export function toPaymentLogger(value: unknown): ZohoPaymentLogger {
  if (!isRecord(value)) {
    return NOOP_LOGGER
  }

  const debug = getMethod(value, "debug")
  const warn = getMethod(value, "warn")
  const error = getMethod(value, "error")

  if (!debug && !warn && !error) {
    return NOOP_LOGGER
  }

  return {
    debug: (message, context) => {
      if (debug) {
        debug(message, context)
      }
    },
    warn: (message, context) => {
      if (warn) {
        warn(message, context)
      }
    },
    error: (message, context) => {
      if (error) {
        error(message, context)
      }
    },
  }
}

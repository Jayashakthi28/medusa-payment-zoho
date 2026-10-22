import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  isCapturedPaymentStatus,
  isFailedPaymentStatus,
  isTerminalSessionStatus,
  mapZohoPaymentStatus,
  mapZohoSessionStatus,
} from "../../src/core/status"

describe("mapZohoSessionStatus", () => {
  it.each([
    ["succeeded", PaymentSessionStatus.CAPTURED],
    ["SUCCEEDED", PaymentSessionStatus.CAPTURED],
    ["pending", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["created", PaymentSessionStatus.PENDING],
    ["in_progress", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["IN_PROGRESS", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["processing", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["requires_more", PaymentSessionStatus.REQUIRES_MORE],
    ["requires_action", PaymentSessionStatus.REQUIRES_MORE],
    ["Requires_Action", PaymentSessionStatus.REQUIRES_MORE],
    ["failed", PaymentSessionStatus.ERROR],
    ["expired", PaymentSessionStatus.CANCELED],
    ["canceled", PaymentSessionStatus.CANCELED],
    ["cancelled", PaymentSessionStatus.CANCELED],
    ["CANCELLED", PaymentSessionStatus.CANCELED],
    ["unknown", PaymentSessionStatus.PENDING],
    ["", PaymentSessionStatus.PENDING],
    [undefined, PaymentSessionStatus.PENDING],
  ] as const)("maps %j to %s", (status, expected) => {
    expect(mapZohoSessionStatus(status)).toBe(expected)
  })
})

describe("mapZohoPaymentStatus", () => {
  it.each([
    ["succeeded", PaymentSessionStatus.CAPTURED],
    ["SUCCEEDED", PaymentSessionStatus.CAPTURED],
    ["refunded", PaymentSessionStatus.CAPTURED],
    ["partially_refunded", PaymentSessionStatus.CAPTURED],
    ["disputed", PaymentSessionStatus.CAPTURED],
    ["pending", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["initiated", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["incomplete", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["in_progress", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["processing", PaymentSessionStatus.PENDING_AUTHORIZATION],
    ["failed", PaymentSessionStatus.ERROR],
    ["blocked", PaymentSessionStatus.ERROR],
    ["BLOCKED", PaymentSessionStatus.ERROR],
    ["canceled", PaymentSessionStatus.CANCELED],
    ["cancelled", PaymentSessionStatus.CANCELED],
    ["unknown", PaymentSessionStatus.PENDING],
    ["", PaymentSessionStatus.PENDING],
    [undefined, PaymentSessionStatus.PENDING],
  ] as const)("maps %j to %s", (status, expected) => {
    expect(mapZohoPaymentStatus(status)).toBe(expected)
  })
})

describe("isTerminalSessionStatus", () => {
  it.each(["succeeded", "SUCCEEDED", "failed", "expired", "canceled", "cancelled"])(
    "treats %j as terminal",
    (status) => {
      expect(isTerminalSessionStatus(status)).toBe(true)
    }
  )

  it.each([
    "pending",
    "created",
    "in_progress",
    "processing",
    "requires_more",
    "requires_action",
    "unknown",
    "",
    undefined,
  ])("does not treat %j as terminal", (status) => {
    expect(isTerminalSessionStatus(status)).toBe(false)
  })
})

describe("isCapturedPaymentStatus", () => {
  it.each(["succeeded", "SUCCEEDED", "refunded", "partially_refunded", "disputed"])(
    "treats %j as captured",
    (status) => {
      expect(isCapturedPaymentStatus(status)).toBe(true)
    }
  )

  it.each([
    "pending",
    "initiated",
    "failed",
    "blocked",
    "canceled",
    "cancelled",
    "unknown",
    "",
    undefined,
  ])("does not treat %j as captured", (status) => {
    expect(isCapturedPaymentStatus(status)).toBe(false)
  })
})

describe("isFailedPaymentStatus", () => {
  it.each(["failed", "FAILED", "blocked"])("treats %j as failed", (status) => {
    expect(isFailedPaymentStatus(status)).toBe(true)
  })

  it.each([
    "succeeded",
    "pending",
    "initiated",
    "canceled",
    "cancelled",
    "unknown",
    "",
    undefined,
  ])("does not treat %j as failed", (status) => {
    expect(isFailedPaymentStatus(status)).toBe(false)
  })
})

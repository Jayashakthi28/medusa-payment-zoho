import { PaymentSessionStatus } from "@medusajs/framework/utils"

/** Map a Zoho payment-session status to a Medusa payment-session status. */
export function mapZohoSessionStatus(status: string | undefined): PaymentSessionStatus {
  const normalized = status?.toLowerCase() ?? ""

  switch (normalized) {
    case "succeeded":
      return PaymentSessionStatus.CAPTURED
    case "created":
      return PaymentSessionStatus.PENDING
    case "pending":
    case "in_progress":
    case "processing":
      return PaymentSessionStatus.PENDING_AUTHORIZATION
    case "requires_more":
    case "requires_action":
      return PaymentSessionStatus.REQUIRES_MORE
    case "failed":
      return PaymentSessionStatus.ERROR
    case "expired":
    case "canceled":
    case "cancelled":
      return PaymentSessionStatus.CANCELED
    default:
      return PaymentSessionStatus.PENDING
  }
}

/** Map a Zoho payment status to a Medusa payment-session status. */
export function mapZohoPaymentStatus(status: string | undefined): PaymentSessionStatus {
  const normalized = status?.toLowerCase() ?? ""

  switch (normalized) {
    case "succeeded":
    case "refunded":
    case "partially_refunded":
    case "disputed":
      return PaymentSessionStatus.CAPTURED
    case "pending":
    case "initiated":
    case "incomplete":
    case "in_progress":
    case "processing":
      return PaymentSessionStatus.PENDING_AUTHORIZATION
    case "failed":
    case "blocked":
      return PaymentSessionStatus.ERROR
    case "canceled":
    case "cancelled":
      return PaymentSessionStatus.CANCELED
    default:
      return PaymentSessionStatus.PENDING
  }
}

/** Statuses after which a Zoho session cannot produce another successful payment. */
export function isTerminalSessionStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase() ?? ""

  switch (normalized) {
    case "succeeded":
    case "failed":
    case "expired":
    case "canceled":
    case "cancelled":
      return true
    default:
      return false
  }
}

/** Statuses that represent money already captured by Zoho. */
export function isCapturedPaymentStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase() ?? ""

  switch (normalized) {
    case "succeeded":
    case "refunded":
    case "partially_refunded":
    case "disputed":
      return true
    default:
      return false
  }
}

/** Statuses that represent a definitive payment failure. */
export function isFailedPaymentStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase() ?? ""

  switch (normalized) {
    case "failed":
    case "blocked":
      return true
    default:
      return false
  }
}

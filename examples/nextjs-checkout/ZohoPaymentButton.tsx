"use client"

import type { HttpTypes } from "@medusajs/types"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import type { ZohoCustomerPrefill } from "medusa-payment-zoho/client"
import {
  payWithZohoCheckout,
  redirectToZohoHostedCheckout,
} from "medusa-payment-zoho/client"

import { sdk } from "@/lib/medusa"

/**
 * Illustrative Next.js App Router client component.
 *
 * Copy this file into your storefront (for example `components/ZohoPaymentButton.tsx`)
 * and pass the current Medusa cart. This file is not compiled or published by the
 * package; see `examples/README.md`.
 */

const ZOHO_PROVIDER_ID = "pp_zoho_zoho"

type CheckoutState =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | {
      kind: "notice"
      tone: "warning" | "error"
      title: string
      message: string
      retryable: boolean
    }
  | { kind: "completion_failed"; message: string }
  | { kind: "completed"; orderId?: string }

type ZohoPaymentButtonProps = {
  cart: HttpTypes.StoreCart
}

export default function ZohoPaymentButton({ cart }: ZohoPaymentButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<CheckoutState>({ kind: "idle" })

  const alreadyCompleted =
    Boolean(cart.completed_at) || cart.payment_collection?.status === "completed"

  async function completeCart(cartId: string): Promise<void> {
    try {
      const result = await sdk.store.cart.complete(cartId)

      if (result.type === "order") {
        setState({ kind: "completed", orderId: result.order.id })
        router.push(`/checkout-success?order_id=${encodeURIComponent(result.order.id)}`)
        return
      }

      setState({
        kind: "completion_failed",
        message:
          result.error.message ||
          "Medusa could not complete the cart after the payment attempt.",
      })
    } catch (error) {
      setState({
        kind: "completion_failed",
        message: errorMessage(
          error,
          "Medusa could not complete the cart after the payment attempt."
        ),
      })
    }
  }

  async function handleClick(): Promise<void> {
    if (state.kind === "loading") {
      return
    }

    // A previous payment may already have succeeded. Never reopen the widget in this
    // state; retry only the Medusa cart completion.
    if (state.kind === "completion_failed") {
      setState({ kind: "loading", label: "Retrying order confirmation..." })
      await completeCart(cart.id)
      return
    }

    setState({ kind: "loading", label: "Creating a secure Zoho session..." })

    try {
      const { payment_collection: paymentCollection } =
        await sdk.store.payment.initiatePaymentSession(cart, {
          provider_id: ZOHO_PROVIDER_ID,
        })

      const sessions =
        paymentCollection.payment_sessions ??
        cart.payment_collection?.payment_sessions ??
        []

      // A collection can hold one session per provider. Prefer Zoho, then fall back to
      // index 0 to mirror the simplest data lookup. The same shape is available as
      // `cart.payment_collection.payment_sessions[0].data` after a cart re-fetch.
      const paymentSession =
        sessions.find((session) => session.provider_id === ZOHO_PROVIDER_ID) ??
        sessions[0]

      if (!paymentSession) {
        setState({
          kind: "notice",
          tone: "error",
          title: "No payment session was created",
          message:
            "Medusa did not return a payment session for this cart. Refresh the page and try again.",
          retryable: true,
        })
        return
      }

      if (paymentSession.provider_id !== ZOHO_PROVIDER_ID) {
        setState({
          kind: "notice",
          tone: "error",
          title: "Zoho Payments is not available",
          message:
            "The cart's payment session belongs to another provider. Select Zoho Payments in checkout and try again.",
          retryable: true,
        })
        return
      }

      // This is the provider-owned, publishable payload returned by the server. It
      // contains the Zoho session ID, amount, currency, expiry, and widget config.
      const sessionData = paymentSession.data

      if (paymentSession.status === "captured") {
        setState({
          kind: "loading",
          label: "Payment already captured. Finishing your order...",
        })
        await completeCart(cart.id)
        return
      }

      setState({ kind: "loading", label: "Opening Zoho Checkout..." })

      const result = await payWithZohoCheckout({
        session: sessionData,
        customer: buildCustomer(cart),
      })

      if (result.ok) {
        setState({
          kind: "loading",
          label: "Payment submitted. Confirming with Zoho...",
        })

        // Completing the cart calls the provider's authorizePayment, which retrieves
        // the Zoho session/payment before Medusa creates the order.
        await completeCart(cart.id)
        return
      }

      switch (result.reason) {
        case "closed":
          setState({
            kind: "notice",
            tone: "warning",
            title: "Zoho Checkout was closed",
            message:
              "The checkout window closed before payment was confirmed. Check your order status before starting another payment.",
            retryable: true,
          })
          return

        case "expired":
          setState({
            kind: "notice",
            tone: "warning",
            title: "The payment session expired",
            message:
              "Zoho sessions are valid for about 15 minutes. Start a new payment attempt to continue.",
            retryable: true,
          })
          return

        case "failed":
          setState({
            kind: "notice",
            tone: "error",
            title: "Payment failed",
            message: [
              result.message ?? "Zoho did not confirm the payment.",
              result.code ? `(code: ${result.code})` : undefined,
            ]
              .filter(Boolean)
              .join(" "),
            retryable: true,
          })
          return

        case "not_configured":
          setState({
            kind: "notice",
            tone: "error",
            title: "Zoho Checkout is not configured",
            message:
              "The store's Zoho widget settings are incomplete. Contact store support; retrying payment will not help.",
            retryable: false,
          })
          return

        case "hosted_checkout_required":
          setState({
            kind: "loading",
            label: "Redirecting to Zoho Hosted Checkout...",
          })
          redirectToZohoHostedCheckout(sessionData)
          return
      }
    } catch (error) {
      setState({
        kind: "notice",
        tone: "error",
        title: "Zoho Checkout could not start",
        message: errorMessage(
          error,
          "The payment could not be started. Refresh the page and try again."
        ),
        retryable: true,
      })
    }
  }

  if (alreadyCompleted || state.kind === "completed") {
    const orderId = state.kind === "completed" ? state.orderId : undefined
    const href = orderId
      ? `/checkout-success?order_id=${encodeURIComponent(orderId)}`
      : "/checkout-success"

    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <p className="font-medium">This cart is already complete.</p>
        <p className="mt-1">
          No second payment will be started. Open the confirmation to see the order
          reference.
        </p>
        <Link className="mt-3 inline-block font-medium underline" href={href}>
          View order confirmation
        </Link>
      </div>
    )
  }

  const isLoading = state.kind === "loading"
  const canRetry = state.kind !== "notice" || state.retryable
  const buttonLabel = isLoading
    ? state.label
    : state.kind === "completion_failed"
      ? "Retry order confirmation"
      : state.kind === "notice"
        ? "Try payment again"
        : "Pay with Zoho"

  return (
    <div className="space-y-3">
      {state.kind === "notice" && (
        <div
          role={state.tone === "error" ? "alert" : "status"}
          className={
            state.tone === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
              : "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          }
        >
          <p className="font-medium">{state.title}</p>
          <p className="mt-1">{state.message}</p>
        </div>
      )}

      {state.kind === "completion_failed" && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p className="font-medium">
            The payment may have succeeded, but the order was not created.
          </p>
          <p className="mt-1">
            Do not pay again. Retry order confirmation below, or contact store support
            with cart reference <code className="font-mono">{cart.id}</code>.
          </p>
          <p className="mt-1 text-xs opacity-80">{state.message}</p>
        </div>
      )}

      {isLoading && (
        <p role="status" className="text-sm text-gray-600">
          {state.label}
        </p>
      )}

      {canRetry && (
        <button
          type="button"
          onClick={() => {
            void handleClick()
          }}
          disabled={isLoading}
          aria-busy={isLoading}
          className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      )}

      <p className="text-xs text-gray-500">
        Payments are processed by Zoho Payments. The final order status is confirmed by
        Medusa after the provider verifies the payment.
      </p>
    </div>
  )
}

function buildCustomer(cart: HttpTypes.StoreCart): ZohoCustomerPrefill | undefined {
  const address = cart.shipping_address
  const name = [address?.first_name, address?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  const customer: ZohoCustomerPrefill = {
    ...(name ? { name } : {}),
    ...(cart.email ? { email: cart.email } : {}),
    ...(address?.phone ? { phone: address.phone } : {}),
  }

  return Object.keys(customer).length > 0 ? customer : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

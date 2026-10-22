import type { Metadata } from "next"
import Link from "next/link"

/**
 * Illustrative Next.js App Router failure page.
 *
 * The page maps known helper/checkout reasons to safe copy. It does not inspect payment
 * state and does not retry a payment. Copy it to `app/checkout-failure/page.tsx`; see
 * `examples/README.md`.
 */

export const metadata: Metadata = {
  title: "Payment not completed",
  description: "The Zoho Payments checkout did not complete.",
}

type CheckoutFailurePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type FailureCopy = {
  title: string
  message: string
  retryable: boolean
}

const FAILURE_COPY: Record<string, FailureCopy> = {
  closed: {
    title: "Checkout closed",
    message:
      "The Zoho checkout window was closed before payment was confirmed. Check your order status before starting another payment.",
    retryable: true,
  },
  expired: {
    title: "Payment session expired",
    message:
      "Zoho payment sessions last about 15 minutes. Start a new payment attempt from your cart.",
    retryable: true,
  },
  failed: {
    title: "Payment failed",
    message:
      "Zoho did not confirm the payment. You can try again or choose another payment method.",
    retryable: true,
  },
  not_configured: {
    title: "Payment method unavailable",
    message:
      "The store's Zoho Payments settings are incomplete. Contact store support; retrying will not help until the provider is configured.",
    retryable: false,
  },
  hosted_checkout_required: {
    title: "Use the hosted checkout",
    message:
      "This store is configured for Zoho Hosted Checkout. Return to checkout and use the hosted payment button.",
    retryable: true,
  },
  completion_failed: {
    title: "Order confirmation is pending",
    message:
      "The payment may have succeeded, but Medusa did not create the order. Do not pay again. Contact store support with your cart reference so the payment can be reconciled.",
    retryable: false,
  },
}

const FALLBACK_COPY: FailureCopy = {
  title: "Payment not completed",
  message:
    "The checkout did not finish. Check your cart and try again. If you were charged but no order appears, contact store support before paying again.",
  retryable: true,
}

export default async function CheckoutFailurePage({
  searchParams,
}: CheckoutFailurePageProps) {
  const params = await searchParams
  const reason = firstValue(params.reason) ?? "unknown"
  const cartId = firstValue(params.cart_id)
  const copy = Object.prototype.hasOwnProperty.call(FAILURE_COPY, reason)
    ? (FAILURE_COPY[reason] ?? FALLBACK_COPY)
    : FALLBACK_COPY
  const retryHref = cartId
    ? `/checkout?cart_id=${encodeURIComponent(cartId)}`
    : "/checkout"

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-red-700">
        Payment not completed
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-gray-950">{copy.title}</h1>
      <p className="mt-4 text-gray-700">{copy.message}</p>

      {cartId && (
        <dl className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <dt className="font-medium text-gray-500">Cart reference</dt>
          <dd className="mt-1 font-mono text-gray-950">{cartId}</dd>
        </dl>
      )}

      <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-medium">Before you pay again</p>
        <p className="mt-1">
          Check your order confirmation email and your account. If Zoho shows a charge
          but no Medusa order exists, contact store support with the cart reference
          instead of paying again. A signed webhook may still be processing.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-4 text-sm font-medium">
        {copy.retryable && (
          <Link className="underline" href={retryHref}>
            Return to checkout
          </Link>
        )}
        <Link className="underline" href="/cart">
          View cart
        </Link>
      </div>
    </main>
  )
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

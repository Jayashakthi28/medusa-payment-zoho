import type { Metadata } from "next"
import Link from "next/link"

/**
 * Illustrative Next.js App Router success page.
 *
 * This page is informational. It never marks an order paid. The Medusa order record and
 * the signed Zoho webhook are authoritative. Copy it to
 * `app/checkout-success/page.tsx`; see `examples/README.md`.
 */

export const metadata: Metadata = {
  title: "Payment received",
  description: "Your Zoho Payments checkout has returned to the storefront.",
}

type CheckoutSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CheckoutSuccessPage({
  searchParams,
}: CheckoutSuccessPageProps) {
  const params = await searchParams
  const orderId = firstValue(params.order_id)

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-green-700">
        Payment received
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-gray-950">
        Thank you for your order
      </h1>

      {orderId ? (
        <>
          <p className="mt-4 text-gray-700">
            Medusa created this order after the Zoho provider verified the payment.
          </p>
          <dl className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
            <dt className="font-medium text-gray-500">Order reference</dt>
            <dd className="mt-1 font-mono text-gray-950">{orderId}</dd>
          </dl>
        </>
      ) : (
        <p className="mt-4 text-gray-700">
          We could not find an order reference on this page. Check your order
          confirmation email or your account before contacting support.
        </p>
      )}

      <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-medium">What happens next</p>
        <p className="mt-1">
          A signed Zoho webhook may finalise the payment asynchronously. If you closed
          the browser after paying, the order can still appear in your account once the
          webhook is processed. Do not start a second payment.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-4 text-sm font-medium">
        <Link className="underline" href="/account/orders">
          View your orders
        </Link>
        <Link className="underline" href="/">
          Continue shopping
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

# Storefront: embedded Checkout Widget

This guide wires the Zoho Checkout Widget into a Medusa v2 storefront using the
official Medusa JS SDK and the browser helper from `medusa-payment-zoho/client`. The
widget is the default checkout mode and is designed for the India-first flow, including
cards, UPI, and other methods enabled on your Zoho account.

- **Provider option:** `checkoutMode: "widget"` (default)
- **Required option:** `apiKey` (publishable Zoho widget key)
- **Browser entry point:** `medusa-payment-zoho/client`
- **Authoritative success check:** Medusa completion, which retrieves the payment from
  Zoho

## 1. How the flow works

```text
Storefront                    Medusa                         Zoho Payments
    |                            |                                  |
    |-- initiate payment session ->|                                  |
    |                            |-- POST /paymentsessions -------->|
    |<-- session.data -----------|                                  |
    |-- load zpayments.js ------------------------------------------->|
    |-- requestPaymentMethod --------------------------------------->|
    |<-- payment_id + optional signature ----------------------------|
    |-- cart.complete() -------->|                                  |
    |                            |-- GET /paymentsessions/:id ------>|
    |                            |<-- succeeded, captured -----------|
    |<-- order ------------------|                                  |
```

The widget’s `payment_id` is a hint. The server retrieves the Zoho session/payment
before Medusa creates a payment and completes the order. A malicious browser cannot
forge success by returning an arbitrary ID.

## 2. Install and initialise the SDK

The package is installed in the Medusa backend. The storefront also needs the Medusa JS
SDK:

```bash
npm install @medusajs/js-sdk medusa-payment-zoho
```

Create a single SDK instance:

```ts
// lib/medusa.ts
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
  debug: process.env.NODE_ENV === "development",
})
```

The publishable key is a Medusa key, not a Zoho secret. Never put the Zoho client
secret, refresh token, or signing key in `NEXT_PUBLIC_*` variables.

## 3. Full Next.js checkout component

The component assumes the cart already has items, an email, a shipping address,
shipping methods, and a total greater than zero. A payment collection is created by
`initiatePaymentSession` if the cart does not have one. It creates the Zoho session,
re-reads the cart, opens the widget, and completes the cart.

```tsx
"use client"

import { useState } from "react"
import { payWithZohoCheckout } from "medusa-payment-zoho/client"
import { sdk } from "@/lib/medusa"

const ZOHO_PROVIDER_ID = "pp_zoho_zoho"

export function ZohoCheckoutButton({ cartId }: { cartId: string }) {
  const [state, setState] = useState<"idle" | "starting" | "paying">("idle")
  const [error, setError] = useState<string>()

  async function handlePay() {
    setError(undefined)
    setState("starting")

    try {
      // 1. Ensure a Zoho payment session exists for this cart.
      const { cart } = await sdk.store.cart.retrieve(cartId)

      await sdk.store.payment.initiatePaymentSession(cart, {
        provider_id: ZOHO_PROVIDER_ID,
      })

      // 2. Re-read the cart so the session data is current.
      const { cart: freshCart } = await sdk.store.cart.retrieve(cartId)
      const session = freshCart.payment_collection?.payment_sessions?.find(
        (candidate) => candidate.provider_id === ZOHO_PROVIDER_ID
      )

      if (!session) {
        setError("Zoho payment session is missing. Refresh and try again.")
        return
      }

      // 3. Open the embedded widget.
      setState("paying")
      const result = await payWithZohoCheckout({ session: session.data })

      if (!result.ok) {
        if (result.reason === "closed") {
          setError("Payment cancelled.")
        } else if (result.reason === "expired") {
          setError("This checkout expired. Start checkout again.")
        } else if (result.reason === "hosted_checkout_required") {
          setError("This store is configured for hosted checkout.")
        } else if (result.reason === "not_configured") {
          setError("The Zoho widget is not configured for this store.")
        } else {
          setError(result.message ?? "Zoho payment failed.")
        }
        return
      }

      // 4. Complete the cart. Medusa verifies the payment with Zoho.
      const completion = await sdk.store.cart.complete(freshCart.id)

      if (completion.type === "order") {
        localStorage.removeItem("cart_id")
        window.location.assign(`/order/confirmed/${completion.order.id}`)
        return
      }

      setError(completion.error?.message ?? "Could not complete the order.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout failed.")
    } finally {
      setState("idle")
    }
  }

  return (
    <div>
      <button onClick={handlePay} disabled={state !== "idle"}>
        {state === "idle" ? "Pay with Zoho" : "Opening Zoho…"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
```

### Passing customer details

The helper can prefill the widget. These values are optional and are not written to Zoho
metadata:

```ts
const result = await payWithZohoCheckout({
  session: session.data,
  customer: {
    name: cart.shipping_address?.first_name
      ? `${cart.shipping_address.first_name} ${cart.shipping_address.last_name ?? ""}`.trim()
      : undefined,
    email: cart.email ?? undefined,
    phone: cart.shipping_address?.phone ?? undefined,
  },
})
```

### Overriding the description or invoice number

```ts
const result = await payWithZohoCheckout({
  session: session.data,
  description: `Order ${cart.id}`,
  invoiceNumber: cart.id,
})
```

The provider stores the server-generated `description` and `invoiceNumber` in the
payment session. Overrides affect only the widget request. Zoho limits invoice numbers
to 50 characters, so do not pass an unbounded cart or order ID.

## 4. The helper result

`payWithZohoCheckout` returns a discriminated union:

```ts
type ZohoCheckoutResult =
  | {
      ok: true
      paymentId: string
      paymentSessionId: string
      signature?: string
    }
  | {
      ok: false
      reason:
        "closed" | "failed" | "expired" | "not_configured" | "hosted_checkout_required"
      message?: string
      code?: string
    }
```

| Reason                     | Meaning                                              | Suggested handling                                         |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `closed`                   | Customer closed the widget (`widget_closed`).        | Show “cancelled”, keep the cart.                           |
| `failed`                   | Zoho rejected the payment or returned no payment ID. | Show `message`; allow another attempt on the same session. |
| `expired`                  | The recorded `expiresAt` has passed.                 | Create a new payment session, then reopen.                 |
| `not_configured`           | Session data has no valid `widget` block.            | Check `apiKey` and `region`; restart the backend.          |
| `hosted_checkout_required` | The session was created in hosted mode.              | Redirect with `redirectToZohoHostedCheckout`.              |

Malformed session data (missing `zohoSessionId`, `amount`, `currencyCode`,
`currencySymbol`, or `description`) throws `ZohoValidationError`
(`ZOHO_VALIDATION_ERROR`). Treat that as a configuration or integration bug, not a
customer error.

## 5. Session expiry and refresh

Zoho payment sessions last **15 minutes by default** and at most 15 minutes. Session
data includes:

```ts
{
  zohoSessionId: "…",
  checkoutMode: "widget",
  amount: "1499.00",
  currencyCode: "INR",
  currencySymbol: "₹",
  description: "Medusa order payment",
  invoiceNumber: "…",
  expiresAt: 1760000000000, // epoch milliseconds
  widget: { accountId: "…", domain: "IN", apiKey: "…" }
}
```

Use the exported helpers before opening the widget:

```ts
import { getZohoCheckoutMode, isZohoSessionExpired } from "medusa-payment-zoho/client"

if (getZohoCheckoutMode(session.data) !== "widget") {
  // Use the hosted flow instead.
}

if (isZohoSessionExpired(session.data)) {
  // Re-run initiatePaymentSession and re-read the cart.
}
```

Expiry rules:

- The storefront should treat `expiresAt <= Date.now()` as expired.
- The provider only reuses a Zoho session when it is unpaid, matches the cart exactly,
  and has **more than 60 seconds** left. Otherwise it creates a new Zoho session.
- After a cart edit (quantity, shipping, discount), re-run the payment-session flow so
  the amount and currency match the new total.
- A Zoho session cannot be extended or updated. Starting checkout again creates a new
  one; the old session expires on its own.
- If the customer leaves the page, the signed webhook or a later status poll can still
  resolve the payment. Do not treat abandonment as failure.

## 6. Error handling and completion

Always inspect `completion.type`:

```ts
const completion = await sdk.store.cart.complete(cart.id)

if (completion.type === "order") {
  // Order placed.
} else {
  // completion.cart and completion.error describe the failure.
}
```

Do **not** show “paid” merely because the widget returned `ok: true`. The widget result
is collected before Medusa authorizes the payment. `cart.complete()` is the step that
asks the provider to retrieve the Zoho session and create the Medusa payment.

If completion fails after a capture, Medusa’s completion workflow compensates: an
authorized-but-uncaptured payment is canceled, and a captured payment is refunded,
unless a concurrent completion already created the order. Do not issue a second refund
from the storefront.

If Zoho is still processing an asynchronous method, completion may return an order
whose payment is pending authorization. Display a pending state and let the signed
webhook finalize it.

## 7. Verifying the widget signature (optional, server-side)

Zoho may include a `signature` in the widget response. It signs:

```text
payment_id|payment_session_id
```

Verification must happen on the server with the Zoho signing key. The signature is
optional, so its absence must not block a server-side completion; it is an extra check,
not the source of truth.

A Next.js route that verifies the result against the cart’s stored session:

```ts
// app/api/zoho/verify-widget/route.ts
import { NextResponse } from "next/server"
import { isValidZohoWidgetResponseSignature } from "medusa-payment-zoho/server"
import { sdk } from "@/lib/medusa"

interface Body {
  cartId?: string
  paymentId?: string
  paymentSessionId?: string
  signature?: string
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body
  const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY

  if (
    !signingKey ||
    !body.cartId ||
    !body.paymentId ||
    !body.paymentSessionId ||
    !body.signature
  ) {
    return NextResponse.json({ valid: false }, { status: 400 })
  }

  const { cart } = await sdk.store.cart.retrieve(body.cartId)
  const session = cart.payment_collection?.payment_sessions?.find(
    (candidate) => candidate.provider_id === "pp_zoho_zoho"
  )
  const storedSessionId = readString(session?.data?.zohoSessionId)

  // Never use a client-supplied session ID as the trusted value.
  if (!storedSessionId || storedSessionId !== body.paymentSessionId) {
    return NextResponse.json({ valid: false }, { status: 400 })
  }

  const valid = isValidZohoWidgetResponseSignature(
    {
      paymentId: body.paymentId,
      paymentSessionId: storedSessionId,
      signature: body.signature,
    },
    signingKey
  )

  return NextResponse.json({ valid }, { status: valid ? 200 : 400 })
}
```

The route uses the Medusa Store API with a publishable key; use your existing
server-side SDK/authentication setup. Even when this route returns `valid: true`, still
call `cart.complete()`: the provider must retrieve the payment from Zoho before the
order is created. See [Signatures](./signatures.md#2-widget-response-signature).

## 8. CSP and script loading

The helper loads Zoho’s script from:

```text
https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js
```

It loads the script once per page, reuses an existing `window.ZPayments` global or a
tag for the same URL, and removes a failed tag so a retry can work.

A strict CSP must allow at least:

```text
script-src 'self' https://static.zohocdn.com;
connect-src 'self' https://your-medusa-api.example.com https://payments.zoho.in https://payments.zoho.com;
frame-src https://payments.zoho.in https://payments.zoho.com;
img-src 'self' data: https://static.zohocdn.com https://payments.zoho.in https://payments.zoho.com;
```

Adjust for your region and existing policy:

- India uses `https://payments.zoho.in`; US uses `https://payments.zoho.com`.
- If you self-host the Zoho script (only with Zoho’s permission), pass its URL as
  `scriptUrl` and allow that origin instead.
- If your policy uses nonces or hashes, ensure the injected script is permitted; a
  blocked script surfaces as a helper rejection with a script-loading message.
- Do not add `unsafe-eval` for this package; the helper does not need it.

The helper waits up to 10 seconds for the script by default; pass `timeoutMs` to
override that.

```ts
const result = await payWithZohoCheckout({
  session: session.data,
  scriptUrl: "https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js",
  timeoutMs: 10_000,
})
```

If the widget cannot load because of CSP, show a fallback link to hosted checkout. The
server-side session model is the same; only the browser step changes.

## 9. SSR and framework notes

- `payWithZohoCheckout`, `loadZohoPaymentsScript`, and
  `redirectToZohoHostedCheckout` are browser-only. Call them from a client component,
  an event handler, or a `useEffect`, never during server rendering.
- Importing the module in a server bundle is safe because it has no `node:*` or
  `@medusajs/*` imports, but calling a browser-only function throws
  `ZohoValidationError` when `window` is undefined.
- In Next.js, add `"use client"` to the component that calls the helper, or load it
  with a dynamic import that disables SSR.
- The helper caches the script promise and widget instance per account/domain/API key.
  Do not clear those caches in application code.

## 10. Testing checklist

- [ ] A successful India test payment creates an order and the payment shows as
      captured.
- [ ] The same flow works with `region: "us"` and a US account.
- [ ] Closing the widget returns `reason: "closed"` and leaves the cart usable.
- [ ] A failed payment returns `reason: "failed"` and allows another attempt.
- [ ] An expired session returns `reason: "expired"`; restarting checkout creates a
      new session.
- [ ] A blocked script (CSP) shows a recoverable error, not a stuck spinner.
- [ ] A tampered widget signature is rejected by the server route.
- [ ] A webhook with a valid signature completes a cart whose browser closed.
- [ ] Cart edits after session creation produce a matching amount or a new session.

## 11. Related documentation

- [Storefront hosted checkout](./storefront-hosted.md)
- [Webhooks](./webhooks.md)
- [Signatures](./signatures.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
- [Zoho Checkout Widget documentation](https://www.zoho.com/us/payments/developerdocs/web-integration/integrate-widget/)

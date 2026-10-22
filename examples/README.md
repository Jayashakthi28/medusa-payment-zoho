# Examples

These are **illustrative integration snippets**, not part of the published package and
not a runnable application. Copy them into a Medusa v2 storefront and replace the
placeholder paths, environment variables, and styling with your own.

For complete storefront guides, see
[`docs/storefront-widget.md`](../docs/storefront-widget.md) and
[`docs/storefront-hosted.md`](../docs/storefront-hosted.md). The examples here focus on
the state machine and the SDK calls rather than a production design system.

The examples are excluded from the package build and repository gates:

- `package.json` `files` includes `dist`, `docs`, `README.md`, `CHANGELOG.md`, `LICENSE`,
  and `SECURITY.md`; it does not include `examples`.
- `tsconfig.json` excludes `examples`.
- `eslint.config.js` ignores `examples`.
- `.prettierignore` ignores `examples`.

## Files

| File                                                                                       | Copy to (Next.js App Router)                 | Purpose                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------- |
| [`medusa-config.ts`](./medusa-config.ts)                                                   | `medusa-config.ts` in the Medusa application | Provider registration and environment variables |
| [`nextjs-checkout/ZohoPaymentButton.tsx`](./nextjs-checkout/ZohoPaymentButton.tsx)         | `components/ZohoPaymentButton.tsx`           | Client component: initiate, pay, complete       |
| [`nextjs-checkout/checkout-success/page.tsx`](./nextjs-checkout/checkout-success/page.tsx) | `app/checkout-success/page.tsx`              | Informational success page                      |
| [`nextjs-checkout/checkout-failure/page.tsx`](./nextjs-checkout/checkout-failure/page.tsx) | `app/checkout-failure/page.tsx`              | Informational failure/retry page                |

The success and failure pages are deliberately small. They display a reference and a
retry path; they do not mark an order paid. The order record and the signed webhook are
the source of truth.

## Prerequisites

1. A Medusa v2 application with the package installed:

   ```bash
   pnpm add medusa-payment-zoho
   ```

2. The provider registered in `medusa-config.ts`, with `id: "zoho"`. See
   [`medusa-config.ts`](./medusa-config.ts). The resolved provider ID is
   `pp_zoho_zoho`. Use the `medusa-payment-zoho/providers/zoho` subpath shown there:
   the package root is the server-side API surface and does not default-export the
   module provider.

3. The provider enabled for the region in **Medusa Admin → Settings → Regions**.

4. A Next.js App Router storefront using the Medusa JS SDK. This repository does not
   install the storefront dependencies; the snippets assume React 19, Next.js 15+, and
   `@medusajs/js-sdk`.

5. A Medusa JS SDK singleton. Create one if your storefront does not already have it:

   ```ts
   // lib/medusa.ts
   import Medusa from "@medusajs/js-sdk"

   const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
   const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

   if (!baseUrl || !publishableKey) {
     throw new Error(
       "NEXT_PUBLIC_MEDUSA_BACKEND_URL and NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY are required"
     )
   }

   export const sdk = new Medusa({ baseUrl, publishableKey })
   ```

   The examples import it as `@/lib/medusa`. If your alias or file name differs, update
   the import.

## The embedded widget flow

The button component performs the complete happy path:

1. Calls `sdk.store.payment.initiatePaymentSession(cart, { provider_id: "pp_zoho_zoho" })`.
   Medusa creates a payment collection if the cart does not have one, then asks the Zoho
   provider to create a Zoho payment session.
2. Reads the provider-owned payload from the returned payment collection. The session
   data is public to the storefront and contains the Zoho session ID, amount, currency,
   expiry, and publishable widget configuration. In its simplest form:

   ```ts
   // From the initiate call's response:
   const sessionData = paymentCollection.payment_sessions?.[0]?.data

   // Or, after re-fetching the cart:
   const cartSessionData = cart.payment_collection?.payment_sessions?.[0]?.data
   ```

   A payment collection may hold more than one provider's session. The example prefers
   the session whose `provider_id` is `pp_zoho_zoho` and only then falls back to index
   `0`. Do not open a widget for another provider's session.

3. Calls `payWithZohoCheckout({ session: sessionData, customer })` from
   `medusa-payment-zoho/client`. The helper loads the Zoho script, opens the widget,
   prefills the customer, and returns a discriminated result.
4. On `{ ok: true }`, calls `sdk.store.cart.complete(cart.id)`. Medusa's
   `authorizePayment` retrieves the Zoho session/payment and verifies it before creating
   the order.
5. On `{ type: "order" }`, redirects to `/checkout-success?order_id=...`.

The widget's `paymentId` is only a hint. The server does not trust it; it retrieves the
Zoho session or payment before creating the Medusa payment.

## State handling in the example button

| State             | Trigger                                                              | What the UI does                                                                |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Loading           | Preparing the session, opening the widget, completing the cart       | Disables the button and announces progress                                      |
| Already completed | `cart.completed_at` or payment collection status `completed`         | Shows a completed message and a link to the success page; no second charge      |
| Captured session  | The selected payment session already has status `captured`           | Completes the cart without reopening the widget                                 |
| Closed            | `payWithZohoCheckout` returns `reason: "closed"`                     | Says checkout was closed with no confirmed payment and offers a retry           |
| Expired           | `reason: "expired"`                                                  | Explains the 15-minute Zoho lifetime and offers a fresh session                 |
| Failed            | `reason: "failed"`                                                   | Shows Zoho's message/code when present and offers a retry                       |
| Not configured    | `reason: "not_configured"`                                           | Tells the customer the store's widget is misconfigured; no retry loop           |
| Hosted required   | `reason: "hosted_checkout_required"`                                 | Redirects with `redirectToZohoHostedCheckout`                                   |
| Completion failed | Zoho succeeded but `sdk.store.cart.complete` returned `type: "cart"` | Warns **not to pay again**, offers retry of order completion, shows the cart ID |

The distinction between "payment failed" and "order confirmation failed" matters. If the
widget returned a payment ID and cart completion fails, retrying the payment could charge
the customer twice. The example only retries `sdk.store.cart.complete` in that state.

## Hosted checkout alternative

For hosted mode, set `checkoutMode: "hosted"` and provide `successUrl`/`failureUrl` in the
provider options. Point those URLs at your own routes; the example pages are
`/checkout-success` and `/checkout-failure`, while `.env.example` contains placeholder
paths that you should replace. The storefront then redirects instead of opening the
widget:

```ts
import { redirectToZohoHostedCheckout } from "medusa-payment-zoho/client"

const sessionData = paymentCollection.payment_sessions?.[0]?.data

if (!sessionData) {
  throw new Error("No Zoho payment session was created")
}

redirectToZohoHostedCheckout(sessionData)
```

The helper throws for an expired session, a widget session, or a missing `checkoutUrl`.
The actual navigation is a normal top-level redirect.

The success and failure routes are merchant-owned. A return URL is **not** proof of
payment. Verify the return signature on the server, then rely on `cart.complete` (which
authorizes through the provider) and the signed webhook:

```ts
import { isValidZohoHostedCheckoutSignature } from "medusa-payment-zoho/server"

const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY

if (!signingKey) {
  throw new Error("ZOHO_PAYMENTS_SIGNING_KEY is not configured")
}

const valid = isValidZohoHostedCheckoutSignature(
  {
    paymentsSessionId: searchParams.get("payments_session_id") ?? "",
    paymentSessionStatus: searchParams.get("payment_session_status") ?? "",
    paymentId: searchParams.get("payment_id") ?? undefined,
    paymentStatus: searchParams.get("payment_status") ?? undefined,
    amount: searchParams.get("amount") ?? undefined,
    signature: searchParams.get("signature") ?? "",
  },
  signingKey
)

if (!valid) {
  return new Response("Invalid Zoho return signature", { status: 400 })
}
```

Do not import `medusa-payment-zoho/server` into a client component: it uses
`node:crypto`. The server entry is for route handlers, server actions, and jobs only.
Never render the signing key or hit the verification helper in the browser.

## Webhook endpoint

The provider relies on Medusa's built-in payment webhook route:

```text
POST https://your-medusa-server.example.com/hooks/payment/zoho_zoho
```

Configure `payment.succeeded`, `payment.pending`, and `payment.failed` in Zoho
**Settings → Developer Space → Webhooks**. The endpoint must be publicly reachable for
registration and delivery. The provider verifies the signature before parsing the body,
then checks `account_id` and, when configured, `live_mode`.

Refund events are acknowledged as `NOT_SUPPORTED`; reconcile refunds with
`GET /refunds/{id}`. See [`docs/compatibility.md`](../docs/compatibility.md) for the
event and limitation tables.

## Mobile and framework notes

- `payWithZohoCheckout` is framework-agnostic. The Next.js files are one integration;
  React, Vue, Svelte, or plain JavaScript can call the same helper from a browser.
- The helper caches the Zoho script and widget instance per page. Do not load the widget
  with conflicting account/domain/API-key configurations on the same page.
- CSP must allow the script from `https://static.zohocdn.com` and the regional Zoho
  payments domain. If the script is blocked, handle the thrown error and offer hosted
  checkout instead.
- The browser helper needs `window`, `document`, and `Promise`. It does not polyfill
  older browsers.
- The helper checks the recorded `expiresAt`; it cannot extend a Zoho session. Zoho's
  default lifetime is 15 minutes. Start a new payment session after expiry.

## What these examples do not do

- They do not include authentication, cart creation, shipping selection, tax, or styling.
- They do not verify the hosted return signature inside the page component shown above;
  add that in a server route or server action.
- They do not poll the payment status. `sdk.store.cart.complete` authorizes; the webhook
  and the Medusa order state handle later settlement.
- They do not implement saved payment methods, manual capture, cancellation, payment
  links, or payouts. Those are not supported by this provider.

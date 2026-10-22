# Storefront: hosted checkout

Hosted checkout redirects the customer to Zoho’s payment page. It is useful when the
storefront cannot load a third-party script (strict CSP, no-JS checkout, native shell)
or when you prefer a full-page payment flow.

- **Provider option:** `checkoutMode: "hosted"`
- **Required options:** `successUrl` and `failureUrl`
- **Not required:** `apiKey`
- **Browser entry point:** `medusa-payment-zoho/client`
- **Server verification:** `medusa-payment-zoho/server`

The server-side session, webhook, refund, and status model is identical to the widget
mode. Only the browser step changes.

## 1. Configure the provider

```ts
{
  resolve: "medusa-payment-zoho/providers/zoho",
  id: "zoho",
  options: {
    accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID!,
    clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID!,
    clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET!,
    refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN!,
    signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY!,
    region: "in",
    checkoutMode: "hosted",
    successUrl: "https://storefront.example.com/api/checkout/zoho/success",
    failureUrl: "https://storefront.example.com/api/checkout/zoho/failure",
  },
}
```

Both URLs must be absolute. In production they must use HTTPS. The provider sends them
to Zoho as `configurations.hosted_checkout_parameters` when creating the payment
session and returns a `checkoutUrl` in the session’s public `data`.

## 2. Start the redirect

The provider builds the URL from Zoho’s `access_key`. The browser helper navigates to
it and also returns the URL, which is useful in tests. Do not log the URL in production:
it contains a capability.

A server action can prepare the session and set a short-lived HttpOnly cookie containing
the cart ID. The success route needs that cookie because the Zoho return URL does not
carry a Medusa cart ID. The example uses Next.js 15+, where `cookies()` is async.

```ts
// app/checkout/hosted/actions.ts
"use server"

import { cookies } from "next/headers"
import { sdk } from "@/lib/medusa"

const ZOHO_PROVIDER_ID = "pp_zoho_zoho"

export async function prepareHostedCheckout(cartId: string) {
  const { cart } = await sdk.store.cart.retrieve(cartId)

  await sdk.store.payment.initiatePaymentSession(cart, {
    provider_id: ZOHO_PROVIDER_ID,
  })

  const { cart: freshCart } = await sdk.store.cart.retrieve(cartId)
  const session = freshCart.payment_collection?.payment_sessions?.find(
    (candidate) => candidate.provider_id === ZOHO_PROVIDER_ID
  )

  if (!session?.data?.checkoutUrl) {
    throw new Error("Zoho hosted checkout URL is missing")
  }

  const store = await cookies()
  store.set("checkout_cart_id", cartId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  })

  // The session data is public. It contains the hosted-checkout URL, which is a
  // bearer capability: do not log it or send it to analytics.
  return session.data
}
```

```tsx
// app/checkout/hosted/HostedCheckoutButton.tsx
"use client"

import { redirectToZohoHostedCheckout } from "medusa-payment-zoho/client"
import { prepareHostedCheckout } from "./actions"

export function HostedCheckoutButton({ cartId }: { cartId: string }) {
  return (
    <button
      onClick={async () => {
        const session = await prepareHostedCheckout(cartId)
        redirectToZohoHostedCheckout(session)
      }}
    >
      Pay with Zoho
    </button>
  )
}
```

`redirectToZohoHostedCheckout`:

- throws `ZohoValidationError` if the recorded `expiresAt` has passed or
  `checkoutUrl` is missing;
- throws `ZohoUnsupportedOperationError` if the session is in widget mode;
- calls `window.location.assign(checkoutUrl)` and returns the URL.

It is browser-only. Do not call it during server rendering.

If you already have the session data on the server, you can bypass the helper and
redirect to `data.checkoutUrl` directly, but still set the cookie and still use the
same return-route verification.

## 3. Return URL parameters

Zoho redirects to `successUrl` or `failureUrl` with:

| Parameter                | Presence    | Notes                                                                        |
| ------------------------ | ----------- | ---------------------------------------------------------------------------- |
| `payments_session_id`    | Always      | Zoho payment-session ID (the provider’s session ID).                         |
| `payment_session_status` | Always      | For example `succeeded`, `in_progress`, `failed`, `expired`.                 |
| `payment_id`             | Optional    | May be absent if the customer closed the browser or ACH is pending.          |
| `payment_status`         | Optional    | Payment-level status when a payment exists.                                  |
| `amount`                 | Optional    | String in major units, as returned by Zoho.                                  |
| `udf1`–`udf5`            | Optional    | Merchant-defined fields; this provider does not set them.                    |
| `signature`              | Conditional | Present when Zoho signing is configured; required by the verification route. |

The signed message is exactly:

```text
payments_session_id.payment_session_status.payment_id.payment_status.amount.mandate_id.udf1.udf2.udf3.udf4.udf5
```

India returns include `mandate_id` between `amount` and `udf1`; US returns omit it. The
verifier accepts both official layouts when `mandateId` is absent. Absent optional
fields are **empty strings**, not omitted separators. The amount is used as received;
do not reformat it before verification. See
[Signatures](./signatures.md#3-hosted-checkout-return-signature).

## 4. Success route

The success route must:

1. read the cart ID from a trusted, HttpOnly cookie (not from a query parameter);
2. verify the hosted-checkout signature with the server signing key;
3. check the status — only `succeeded` is treated as a completed payment;
4. call `cart.complete(cartId)` and check `type === "order"`;
5. clear the cookie and redirect.

```ts
// app/api/checkout/zoho/success/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { isValidZohoHostedCheckoutSignature } from "medusa-payment-zoho/server"
import { sdk } from "@/lib/medusa"

function value(params: URLSearchParams, key: string): string | undefined {
  return params.get(key) ?? undefined
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY
  const signature = params.get("signature")
  const cartId = request.cookies.get("checkout_cart_id")?.value

  const invalid = () =>
    NextResponse.redirect(new URL("/checkout?payment=invalid", request.url))

  if (!signingKey || !signature || !cartId) {
    return invalid()
  }

  const valid = isValidZohoHostedCheckoutSignature(
    {
      paymentsSessionId: params.get("payments_session_id") ?? "",
      paymentSessionStatus: params.get("payment_session_status") ?? "",
      paymentId: value(params, "payment_id"),
      paymentStatus: value(params, "payment_status"),
      amount: value(params, "amount"),
      mandateId: value(params, "mandate_id"),
      udf1: value(params, "udf1"),
      udf2: value(params, "udf2"),
      udf3: value(params, "udf3"),
      udf4: value(params, "udf4"),
      udf5: value(params, "udf5"),
      signature,
    },
    signingKey
  )

  if (!valid) {
    return invalid()
  }

  const sessionStatus = (params.get("payment_session_status") ?? "").toLowerCase()
  const paymentStatus = (params.get("payment_status") ?? "").toLowerCase()

  // in_progress / pending: do not show “paid”. The webhook is the backstop.
  if (sessionStatus !== "succeeded" && paymentStatus !== "succeeded") {
    return NextResponse.redirect(
      new URL(
        `/checkout/pending?status=${encodeURIComponent(sessionStatus)}`,
        request.url
      )
    )
  }

  const completion = await sdk.store.cart.complete(cartId)

  const response =
    completion.type === "order"
      ? NextResponse.redirect(
          new URL(`/order/confirmed/${completion.order.id}`, request.url)
        )
      : NextResponse.redirect(new URL("/checkout?payment=failed", request.url))

  response.cookies.delete("checkout_cart_id")
  return response
}
```

Why complete on the server? `cart.complete()` invokes the provider’s
`authorizePayment`, which retrieves the Zoho session or payment. The return URL is not
proof of settlement by itself.

If the customer returns after Medusa’s webhook already completed the cart, completion
is idempotent and returns the existing order.

## 5. Failure route

The failure URL also carries a signature. Verify it before using any field, then show a
retry path. Do not create an order or mark the cart paid.

```ts
// app/api/checkout/zoho/failure/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { isValidZohoHostedCheckoutSignature } from "medusa-payment-zoho/server"

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY
  const signature = params.get("signature")

  if (!signingKey || !signature) {
    return NextResponse.redirect(new URL("/checkout?payment=invalid", request.url))
  }

  const valid = isValidZohoHostedCheckoutSignature(
    {
      paymentsSessionId: params.get("payments_session_id") ?? "",
      paymentSessionStatus: params.get("payment_session_status") ?? "",
      paymentId: params.get("payment_id") ?? undefined,
      paymentStatus: params.get("payment_status") ?? undefined,
      amount: params.get("amount") ?? undefined,
      udf1: params.get("udf1") ?? undefined,
      udf2: params.get("udf2") ?? undefined,
      udf3: params.get("udf3") ?? undefined,
      udf4: params.get("udf4") ?? undefined,
      udf5: params.get("udf5") ?? undefined,
      signature,
    },
    signingKey
  )

  const response = NextResponse.redirect(
    new URL(
      valid ? "/checkout?payment=failed" : "/checkout?payment=invalid",
      request.url
    )
  )

  if (valid) {
    response.cookies.delete("checkout_cart_id")
  }

  return response
}
```

A failed hosted session is terminal for that Zoho session. Let the customer start
checkout again, which creates a new session. The old one cannot be reused or extended.

## 6. Webhook-first completion

The return redirect is a convenience, not the source of truth. Cases where the browser
never reaches the success route:

- the customer closes the tab after paying;
- a mobile browser drops the redirect;
- ACH returns `in_progress` and settles later;
- the success route is down or times out.

In all of these, Zoho delivers a signed webhook. When the event maps to
`SUCCESSFUL`, Medusa sets the payment session to captured and completes the cart if it
is not already completed. Duplicate webhook delivery is expected and safe; the handler
is read-only and Medusa applies the transition.

For ACH and other asynchronous methods:

1. The customer returns with `in_progress` or `pending`.
2. The storefront shows “payment processing”, not “paid”.
3. The signed `payment.succeeded` webhook (or a status poll) confirms settlement.
4. Medusa marks the payment captured and completes the cart if needed.

Do not fulfill an order solely because the success URL was visited. Do not treat
`in_progress` as a failure either; it is deliberately mapped to
`PENDING_AUTHORIZATION`.

If your business allows creating an order before settlement, you may call
`cart.complete()` for a pending authorization. The order will show an unpaid/pending
payment until the webhook confirms capture. If you prefer not to create orders before
settlement, wait for the webhook instead.

## 7. Session expiry and retries

- A hosted Zoho session lives for 15 minutes by default. `data.expiresAt` records the
  epoch-millisecond deadline.
- The helper refuses to redirect an expired session; the server should also check
  `isZohoSessionExpired` before showing the pay button.
- If the customer abandons the page, the session expires on its own. Starting checkout
  again creates a new session; the old one cannot be cancelled through Zoho’s API.
- After a cart edit, re-run `initiatePaymentSession` and re-read the cart so the amount
  and currency match.
- A failed or expired hosted session is not reusable. Do not retry the same
  `checkoutUrl`.

## 8. Security checklist

- [ ] `successUrl` and `failureUrl` are HTTPS in production.
- [ ] The success route verifies the signature before reading `payment_status`,
      `amount`, or any other field.
- [ ] The cart ID comes from an HttpOnly, `Secure`, `SameSite=Lax` cookie, not from an
      untrusted query parameter.
- [ ] `payment_session_status` is not treated as success unless it is `succeeded` (or
      `payment_status` is `succeeded` and the provider confirms capture).
- [ ] `cart.complete()` is called before fulfillment; the redirect alone never creates
      an order.
- [ ] The route does not redirect to a user-supplied URL (no open redirect).
- [ ] `checkoutUrl` and its `access_key` are not logged, stored in analytics, or exposed
      in referrer headers.
- [ ] A signed webhook is configured as the backstop for closed browsers and ACH.
- [ ] Invalid signatures are logged and monitored; they do not create orders.

## 9. Related documentation

- [Storefront widget](./storefront-widget.md)
- [Webhooks](./webhooks.md)
- [Signatures](./signatures.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
- [Zoho Hosted Checkout documentation](https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/)

# medusa-payment-zoho

**Zoho Payments provider for Medusa v2 — India-first, with embedded checkout, hosted checkout, signed webhooks, and refunds.**

[![CI](https://github.com/Jayashakthi28/medusa-payment-zoho/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayashakthi28/medusa-payment-zoho/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`medusa-payment-zoho` connects a Medusa v2 store to **Zoho Payments** in India
(`region: "in"`, the default) or the United States (`region: "us"`). It creates Zoho
payment sessions, opens the Zoho Checkout Widget or Hosted Checkout, verifies payments
server-side, accepts signed webhooks, and supports full and partial refunds.

This is an independent community integration. It is **not affiliated with, endorsed
by, or maintained by Zoho Corporation or Medusa**.

## Features

- **Embedded Zoho Checkout Widget** for card, UPI, and other methods enabled on your
  Zoho account.
- **Zoho Hosted Checkout** for strict-CSP, no-JS, or redirect-based storefronts.
- **Signed webhooks** over the exact raw body, with account and live/test-mode checks.
- **Correct money handling** — ISO-4217 fraction digits, decimal major-unit strings,
  `BigNumber` arithmetic, no binary floating point.
- **Full and partial refunds** against captured payments, with a local replay guard.
- **Automatic capture, stated honestly** — successful Zoho payments are already
  captured; `capturePayment` verifies instead of pretending to capture.
- **Safe authorization polling** for widget results that arrive before Zoho's session
  status is final.
- **Framework-agnostic browser helper** with a typed, discriminated result and no
  Node.js or Medusa imports in the client bundle.
- **Typed errors** for configuration, authentication, API, validation, state, and
  webhook-verification failures.
- **100% test coverage** enforced for lines, branches, functions, and statements.

## Requirements

| Requirement               | Details                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Medusa                    | `>=2.17.2 <3.0.0`; developed and verified against **2.22.0**                                   |
| Node.js                   | `>=20` (this package); **Node `>=22.22.0`** is the effective floor when running Medusa 2.22    |
| Zoho Payments             | An active India or US merchant account                                                         |
| Zoho OAuth                | An **ORG** client with the scopes below, created in the same data centre as the account        |
| Zoho widget (widget mode) | A publishable API key from Zoho **Settings → Developer Space**                                 |
| Webhooks                  | A publicly reachable HTTPS URL for your Medusa backend                                         |
| Database / Redis          | Whatever your Medusa deployment already uses; this package adds no storage or cache dependency |

Required Zoho OAuth scopes:

```text
ZohoPay.payments.CREATE
ZohoPay.payments.READ
ZohoPay.refunds.CREATE
ZohoPay.refunds.READ
```

Webhook-management scopes are not required: Zoho webhooks are registered manually in
the dashboard.

## Installation

Install the package in your Medusa application:

```bash
npm i medusa-payment-zoho
```

> **Release status:** the `1.0.0` release is being prepared in this repository. The
> command above is the intended consumption path once the package is published. Until
> then, install the tarball produced by `pnpm pack` or reference your local checkout.

Using pnpm or yarn works too; the package ships ESM and CommonJS builds with TypeScript
declarations.

## Zoho setup

1. **Create or confirm your Zoho Payments account** in the correct data centre:
   India (`payments.zoho.in`) or US (`payments.zoho.com`). The account, OAuth client,
   and configured region must all match.
2. **Create an OAuth client** in the Zoho API console:
   - client type: **ORG**;
   - redirect URI: for example `http://localhost:53682/callback` (match the value used
     by the helper script);
   - scopes: the four scopes listed above.
3. **Generate a refresh token** with the repository helper:
   [`scripts/get-refresh-token.mjs`](./scripts/get-refresh-token.mjs). Configure the
   account ID, client ID, client secret, region, and redirect URI first, then run:

   ```bash
   node scripts/get-refresh-token.mjs
   ```

   The helper performs the one-time authorization-code exchange and prints a
   long-lived refresh token. It uses Node.js built-ins only and reads credentials from
   the environment. Treat the output as a secret: do not paste it into issues, logs, or
   commits.

4. **Collect the credentials** from Zoho:
   - **Account ID** — Payments account identifier, sent on every API call.
   - **API key** — Developer Space browser key, required only for widget mode. This key
     is publishable by design; it is not the OAuth client secret or signing key.
   - **Signing key** — Developer Space signing key used for webhooks and checkout
     signatures. Server-only.
5. **Store every secret in environment variables** on the Medusa server. See
   [`.env.example`](./.env.example) for the variable names.

Only a Zoho Account Owner or Admin can generate an org-level refresh token. A user can
hold at most 20 refresh tokens; generating more removes the oldest.

## Backend configuration

Register the provider under the Payment Module in `medusa-config.ts`. The default
region is India and the default checkout mode is the embedded widget:

```ts
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET!,
      cookieSecret: process.env.COOKIE_SECRET!,
    },
  },
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-zoho/providers/zoho",
            id: "zoho",
            options: {
              accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID!,
              clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID!,
              clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET!,
              refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN!,
              signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY!,

              // India is the default; use "us" for the US data centre.
              region: "in",

              // "widget" (default) or "hosted".
              checkoutMode: "widget",

              // Publishable browser key, required for widget mode.
              apiKey: process.env.ZOHO_PAYMENTS_API_KEY!,

              // Reject webhooks whose live_mode does not match this value.
              // Or map ZOHO_PAYMENTS_LIVE_MODE for an explicit test/live switch.
              liveMode: process.env.NODE_ENV === "production",
            },
          },
        ],
      },
    },
  ],
})
```

The provider identifier is `zoho` and the configured id is `zoho`, so Medusa stores the
provider as **`pp_zoho_zoho`**. Keep that ID stable: it appears in payment sessions,
the Admin, and the webhook URL. Use the `/providers/zoho` subpath exactly; the package
root is not a module-provider default.

For hosted checkout, set `checkoutMode: "hosted"` and provide both URLs:

```ts
checkoutMode: "hosted",
successUrl: process.env.ZOHO_PAYMENTS_SUCCESS_URL!,
failureUrl: process.env.ZOHO_PAYMENTS_FAILURE_URL!,
// apiKey is not required in hosted mode
```

All options, validation rules, and defaults are documented in
[Configuration](./docs/configuration.md).

## Webhooks

Register this URL in Zoho Payments under **Settings → Developer Space → Webhooks**:

```text
https://<your-medusa-backend>/hooks/payment/zoho_zoho
```

Enable at least:

- `payment.succeeded`
- `payment.pending`
- `payment.failed`

The provider verifies `X-Zoho-Webhook-Signature` over the exact raw body and parses the
event from those same verified bytes. It requires `account_id`, checks `live_mode` when
configured, and validates the payment amount/currency. A missing `signingKey` fails
closed.

`payment.failed` is emitted **per failed attempt**. The provider reconciles it against
the Zoho session when Zoho supplies a session ID, so a later successful attempt in the
same session still completes the order. Medusa 2.22's stock webhook subscriber ignores
`FAILED`, `PENDING`, and `PENDING_AUTHORIZATION` actions; a terminal failure remains
available for reconciliation rather than silently becoming paid. Refund events are
acknowledged but map to `NOT_SUPPORTED`; reconcile refunds with `retrieveRefund` or your
own job.

Medusa's payment webhook route returns HTTP 200 before the provider finishes handling
the event. A rejected signature therefore does **not** trigger a Zoho retry: monitor
`ZOHO_WEBHOOK_VERIFICATION_ERROR` and reconcile. See [Webhooks](./docs/webhooks.md) for
the full setup, retry behaviour, and a signed `curl` test.

## Enable the provider in Medusa Admin

1. Start the Medusa backend after adding the module.
2. Open **Settings → Regions** and edit the region that uses the matching currency.
3. Under **Payment Providers**, enable **Zoho** (`pp_zoho_zoho`).
4. Save the region and refresh the storefront.

If Zoho does not appear, confirm the module resolves, the backend restarted without
configuration errors, and the region is saved. See
[Troubleshooting](./docs/troubleshooting.md#11-provider-not-visible-in-admin).

## Storefront quickstart: embedded widget

The checkout flow is:

1. Create or refresh the Medusa payment session for Zoho.
2. Re-read the cart and pass the session's public `data` to `payWithZohoCheckout`.
3. Let the customer pay in the Zoho widget.
4. Call `cart.complete()`. Medusa asks the provider to verify the payment with Zoho;
   client-reported success is never trusted.

```tsx
"use client"

import { useState } from "react"
import Medusa from "@medusajs/js-sdk"
import { payWithZohoCheckout } from "medusa-payment-zoho/client"

const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
})

export function ZohoCheckoutButton({ cartId }: { cartId: string }) {
  const [message, setMessage] = useState<string>()

  async function handlePay() {
    setMessage("Preparing Zoho checkout…")

    const { cart } = await sdk.store.cart.retrieve(cartId)
    await sdk.store.payment.initiatePaymentSession(cart, {
      provider_id: "pp_zoho_zoho",
    })

    const { cart: freshCart } = await sdk.store.cart.retrieve(cartId)
    const session = freshCart.payment_collection?.payment_sessions?.find(
      (candidate) => candidate.provider_id === "pp_zoho_zoho"
    )

    if (!session) {
      setMessage("Zoho payment session is missing.")
      return
    }

    const result = await payWithZohoCheckout({ session: session.data })

    if (!result.ok) {
      setMessage(
        result.reason === "closed"
          ? "Payment cancelled."
          : (result.message ?? `Zoho payment failed (${result.reason}).`)
      )
      return
    }

    // The provider retrieves the payment from Zoho during completion.
    const completion = await sdk.store.cart.complete(freshCart.id)

    if (completion.type === "order") {
      window.location.assign(`/order/confirmed/${completion.order.id}`)
      return
    }

    setMessage(completion.error?.message ?? "Could not complete the order.")
  }

  return (
    <button onClick={handlePay} disabled={message === "Preparing Zoho checkout…"}>
      Pay with Zoho
    </button>
  )
}
```

The widget result is a hint; `cart.complete()` is the authoritative step. If Zoho is
still processing an asynchronous method, the order may be created with the payment
pending until a signed webhook or status poll confirms capture.

The provider stores only publishable checkout data in the Medusa payment session:
`zohoSessionId`, `checkoutMode`, `amount`, `currencyCode`, `currencySymbol`,
`description`, `invoiceNumber`, `expiresAt`, `medusaSessionId`, and `widget` (widget
mode) or `checkoutUrl` (hosted mode). OAuth secrets and the signing key are never
included.

Full guide, session-expiry handling, CSP, and server-side widget signature verification:
[Storefront widget](./docs/storefront-widget.md).

## Storefront quickstart: hosted checkout

Set `checkoutMode: "hosted"` and configure `successUrl` and `failureUrl`. Then redirect
the browser:

```tsx
"use client"

import Medusa from "@medusajs/js-sdk"
import { redirectToZohoHostedCheckout } from "medusa-payment-zoho/client"

const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
})

export async function startHostedCheckout(cartId: string) {
  const { cart } = await sdk.store.cart.retrieve(cartId)
  await sdk.store.payment.initiatePaymentSession(cart, {
    provider_id: "pp_zoho_zoho",
  })

  const { cart: freshCart } = await sdk.store.cart.retrieve(cartId)
  const session = freshCart.payment_collection?.payment_sessions?.find(
    (candidate) => candidate.provider_id === "pp_zoho_zoho"
  )

  if (!session) {
    throw new Error("Zoho payment session is missing")
  }

  redirectToZohoHostedCheckout(session.data)
}
```

On the return URL, verify Zoho's hosted-checkout signature on your server, then call
`sdk.store.cart.complete(cartId)`. A redirect is not proof of settlement: ACH can return
`in_progress`, and the webhook is the backstop if the customer closes the browser.
Success/failure route examples:
[Storefront hosted checkout](./docs/storefront-hosted.md).

## Configuration options

| Option                    | Default                  | Required             | Description                                                                                   |
| ------------------------- | ------------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| `accountId`               | —                        | Yes                  | Zoho Payments account ID.                                                                     |
| `clientId`                | —                        | Yes                  | OAuth ORG client ID.                                                                          |
| `clientSecret`            | —                        | Yes                  | OAuth client secret. Server-only.                                                             |
| `refreshToken`            | —                        | Yes                  | Long-lived offline refresh token. Server-only.                                                |
| `region`                  | `"in"`                   | No                   | `"in"` (India) or `"us"`. Account and OAuth client must match.                                |
| `checkoutMode`            | `"widget"`               | No                   | `"widget"` or `"hosted"`.                                                                     |
| `apiKey`                  | —                        | Widget mode          | Publishable Zoho widget API key. Safe to expose to the browser.                               |
| `signingKey`              | —                        | Strongly recommended | Developer Space signing key for webhooks, widget, and hosted-return signatures.               |
| `successUrl`              | —                        | Hosted mode          | Hosted checkout success URL. HTTPS in production.                                             |
| `failureUrl`              | —                        | Hosted mode          | Hosted checkout failure URL. HTTPS in production.                                             |
| `liveMode`                | `undefined`              | No                   | When set, reject webhooks whose `live_mode` differs.                                          |
| `paymentDescription`      | `"Medusa order payment"` | No                   | Customer-facing description, max 500 characters.                                              |
| `businessName`            | `undefined`              | No                   | Displayed in the embedded widget header when set.                                             |
| `allowedPaymentMethods`   | `undefined`              | No                   | Pass-through allow-list, for example `["card", "upi"]`.                                       |
| `currencySymbols`         | `{}`                     | No                   | Display-symbol overrides keyed by uppercase ISO code, e.g. `{ INR: "₹" }`.                    |
| `metadata`                | `{}`                     | No                   | Up to 3 extra non-sensitive Zoho metadata entries.                                            |
| `timeoutMs`               | `15000`                  | No                   | Per-request HTTP timeout, 1–120000 ms.                                                        |
| `maxRetries`              | `3`                      | No                   | Retries for safe calls and OAuth, 0–10.                                                       |
| `retryBaseDelayMs`        | `500`                    | No                   | Exponential-backoff base, 0–60000 ms.                                                         |
| `pollAttempts`            | `3`                      | No                   | Authorization status polling attempts, 0–10.                                                  |
| `pollIntervalMs`          | `500`                    | No                   | Delay between authorization polls, 0–10000 ms.                                                |
| `webhookToleranceSeconds` | `0`                      | No                   | Timestamp tolerance; `0` disables the check. A positive value must cover Zoho's retry window. |
| `apiBaseUrl`              | Region default           | No                   | Advanced override of the Zoho Payments API base URL.                                          |
| `accountsBaseUrl`         | Region default           | No                   | Advanced override of the OAuth accounts base URL.                                             |
| `hostedCheckoutBaseUrl`   | Region default           | No                   | Advanced override of the hosted-checkout base URL.                                            |
| `fetch`                   | Global `fetch`           | No                   | Custom fetch implementation for proxies or instrumentation.                                   |
| `logger`                  | Medusa logger            | No                   | Structured logger with `debug`, `warn`, and `error`.                                          |

Environment variable names used in the examples:

```bash
ZOHO_PAYMENTS_ACCOUNT_ID=
ZOHO_PAYMENTS_CLIENT_ID=
ZOHO_PAYMENTS_CLIENT_SECRET=
ZOHO_PAYMENTS_REFRESH_TOKEN=
ZOHO_PAYMENTS_SIGNING_KEY=
ZOHO_PAYMENTS_API_KEY=
ZOHO_PAYMENTS_REGION=in
ZOHO_PAYMENTS_CHECKOUT_MODE=widget
ZOHO_PAYMENTS_SUCCESS_URL=
ZOHO_PAYMENTS_FAILURE_URL=
ZOHO_PAYMENTS_BUSINESS_NAME=
ZOHO_PAYMENTS_LIVE_MODE=false
```

These variables are read by your `medusa-config.ts`, not automatically by the provider.
See [Configuration](./docs/configuration.md) for the full reference.

## What is supported

| Capability                    | Supported | Notes                                                                |
| ----------------------------- | --------- | -------------------------------------------------------------------- |
| Embedded Zoho Checkout Widget | Yes       | Default mode; requires `apiKey`.                                     |
| Zoho Hosted Checkout          | Yes       | Opt-in; requires `successUrl` and `failureUrl`.                      |
| Payment session create/update | Yes       | Reuses a session only when amount, currency, mode, and expiry match. |
| Authorization and capture     | Yes       | Zoho auto-captures; the provider verifies the captured payment.      |
| Full and partial refunds      | Yes       | Against a captured payment; asynchronous Zoho status.                |
| Signed webhooks               | Yes       | `payment.succeeded`, `payment.pending`, `payment.failed`.            |
| India and US data centres     | Yes       | One provider instance per Zoho account.                              |
| Multi-currency                | Yes       | Subject to your Zoho account's supported currencies.                 |
| Saved payment methods         | **No**    | Account-holder and saved-method APIs are not implemented in v1.      |
| Manual or partial capture     | **No**    | Zoho does not offer it.                                              |
| Cancel a pending payment      | **No**    | No Zoho API; the session expires (15 minutes by default).            |
| Cancel a captured payment     | **No**    | Refund instead.                                                      |
| Refund webhook → Medusa       | **No**    | Acknowledged as `NOT_SUPPORTED`; reconcile with `retrieveRefund`.    |
| Payment links, payouts        | **No**    | Outside this provider's scope.                                       |
| Automatic webhook creation    | **No**    | Register webhooks manually in Zoho.                                  |
| Automatic reconciliation      | **No**    | Use the exported `ZohoPaymentsClient` in your own job.               |
| Multi-account routing         | **No**    | One provider instance maps to one Zoho account.                      |
| Built-in storefront UI        | **No**    | Use the documented helpers or hosted checkout.                       |

A successful Zoho payment is **already captured**. There is no separate capture step,
no partial capture, and no cancel API. `capturePayment` re-reads the payment and
confirms the capture; it never creates a second charge. Refund settlement can be
asynchronous; the provider records Zoho's refund status and logs pending/initiated
refunds for reconciliation.

## Security

- **Secrets stay server-side.** `clientSecret`, `refreshToken`, `signingKey`, and
  access tokens are never placed in payment-session `data`, logs, errors, or browser
  bundles. The widget `apiKey` is publishable by design.
- **Webhooks fail closed.** The signature is verified over the exact raw body before
  any field is trusted. There is no development mode that skips verification.
- **Account and mode are checked.** A valid signature from another Zoho account or from
  test mode does not complete a live payment.
- **Payment ownership is verified.** Storefront-supplied session data cannot inject a
  prior payment or Zoho session ID; authorization checks the Zoho payment's reference
  and metadata against the current Medusa payment session.
- **Amount and currency are reconciled.** Zoho amounts are compared with the Medusa
  session before an order is treated as captured, and positive amounts that round below
  the currency's precision are rejected.
- **The storefront never decides success.** It may display a hint, but Medusa asks the
  provider to retrieve the Zoho session/payment before creating a payment.
- **Hosted checkout URLs are capabilities.** They contain Zoho's `access_key`; do not
  log them, send them to analytics, or expose them in referrer URLs.
- **No card data touches your server.** Using Zoho's widget or hosted page keeps card
  entry on Zoho's infrastructure. This reduces, but does not eliminate, PCI DSS scope;
  confirm your obligations with your acquirer and a qualified assessor.

Report vulnerabilities privately via the process in [SECURITY.md](./SECURITY.md).

## Testing

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm check
```

`pnpm test:coverage` enforces **100%** lines, branches, functions, and statements. The
suite covers amount formatting, status mapping, all three signature schemes, OAuth
caching and retries, HTTP retry policy, both checkout modes, webhook authorization,
failed-attempt reconciliation, refunds, and browser-helper behaviour.

## Documentation

- [Configuration](./docs/configuration.md)
- [Storefront: embedded widget](./docs/storefront-widget.md)
- [Storefront: hosted checkout](./docs/storefront-hosted.md)
- [Webhooks](./docs/webhooks.md)
- [Signature verification](./docs/signatures.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Architecture](./docs/architecture.md)
- [Compatibility and limitations](./docs/compatibility.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## License

[MIT](./LICENSE) © Jayashakthi Vishnu.

Zoho, Zoho Payments, and related marks are trademarks of Zoho Corporation. Medusa is a
trademark of Medusa, Inc. This project is an independent community integration and is
not affiliated with either company.

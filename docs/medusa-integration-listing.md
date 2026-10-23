# npm and Medusa integrations listing copy

- **Package:** `medusa-payment-zoho`
- **Version covered:** 1.0.0
- **Category:** Payment
- **Prepared:** 2026-10-23
- **Status:** copy and checklist; the package is not yet published

This document is the source copy for the npm package page and the Medusa integrations
directory. It is not a second README. The checked-in `README.md` carries the same
facts; Medusa's directory renders the npm README.

## 1. Listing metadata

| Field                | Value                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| Name                 | `medusa-payment-zoho`                                                   |
| Display name         | Zoho Payments                                                           |
| Version              | `1.0.0`                                                                 |
| Category             | Payment                                                                 |
| Medusa compatibility | Medusa v2; peer range `>=2.17.2 <3.0.0`; verified against `2.22.0`      |
| Runtime              | Node.js 22.22.x for Medusa 2.22 (package `engines` says `>=20`)         |
| License              | MIT                                                                     |
| Author               | Jayashakthi Vishnu                                                      |
| Repository           | <https://github.com/Jayashakthi28/medusa-payment-zoho>                  |
| Homepage             | <https://github.com/Jayashakthi28/medusa-payment-zoho#readme>           |
| Issues               | <https://github.com/Jayashakthi28/medusa-payment-zoho/issues>           |
| npm                  | <https://www.npmjs.com/package/medusa-payment-zoho> (after publication) |
| Provider identifier  | `zoho`                                                                  |
| Stored provider ID   | `pp_zoho_zoho`                                                          |
| Webhook endpoint     | `/hooks/payment/zoho_zoho`                                              |
| Primary market       | India (`region: "in"`), with United States (`region: "us"`) support     |
| Checkout modes       | Embedded Zoho Checkout Widget (default) and Zoho Hosted Checkout        |

## 2. Suggested listing title and short description

**Title**

```text
Zoho Payments
```

**One-line description** (also suitable for the npm `description` if shortened)

```text
Zoho Payments for Medusa v2 — embedded Checkout Widget, hosted checkout, signed webhooks, and refunds. India-first, with US support.
```

**Shorter variant** (under 100 characters)

```text
Accept Zoho Payments in Medusa v2 with widget, hosted checkout, and refunds.
```

The current `package.json` description is:

```text
Zoho Payments payment provider for Medusa v2 — India-first, with embedded Checkout Widget, hosted checkout, signed webhooks, refunds, and a browser checkout helper.
```

Use the package description for npm metadata and the shorter line for the directory card.

## 3. Suggested long description

```markdown
Accept Zoho Payments in Medusa v2 without building a payment integration from scratch.
`medusa-payment-zoho` is an independent community payment provider for Zoho Payments,
built for the India-first market and also supporting the United States.

- **Embedded Checkout Widget** for cards, UPI, and the payment methods enabled on your
  Zoho account, with a small browser helper that handles script loading, customer
  prefill, expiry, and closed-widget results.
- **Hosted Checkout** for storefronts that cannot load a third-party script or need a
  plain redirect flow. Signed return URLs can be verified with the server helper.
- **Signed webhooks** verified over the exact raw body before any event field is read,
  with account and live/test-mode checks.
- **Full and partial refunds** through the Medusa Admin, with currency-correct amount
  formatting and a local replay guard.
- **Server-side authorization** that reads the Zoho payment or session before an order
  is completed, so a client-reported `payment_id` is never trusted.
- **Typed errors and bounded retries** with an in-memory OAuth token cache, single-flight
  refresh, and a stricter retry policy for state-changing refund calls.

Zoho captures successful payments automatically. There is no manual or partial capture,
and no cancel API for a pending session or a captured payment; the provider reports those
limitations honestly instead of pretending otherwise. See the compatibility document for
the full support matrix.
```

## 4. Suggested feature bullets for the listing body

```markdown
### What you get

- Medusa v2 `AbstractPaymentProvider` implementation
- Embedded Zoho Checkout Widget and Zoho Hosted Checkout
- India by default; US region supported
- Signed webhook handling with optional timestamp tolerance and account/mode validation
- Full and partial refunds with ISO currency precision
- Publishable widget configuration only in payment-session `data`; server credentials
  never leave the server
- Framework-agnostic browser helper for React, Next.js, Vue, or plain JavaScript
- Separate root, provider-loader, browser, and server-only entry points
- TypeScript types and ESM/CJS builds
```

## 5. Installation and configuration

### Install

```bash
npm i medusa-payment-zoho
```

The Medusa application supplies the peer dependencies. Do not install a second copy of
`@medusajs/framework` or `@medusajs/medusa` just for this provider; use the versions your
application already runs.

### Configure the provider

Add the provider entry to the existing `modules` array in `medusa-config.ts`. The
`resolve` value is the package's **provider loader** subpath, not the package root; the
root entry is the server-side API surface.

```ts
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const region = process.env.ZOHO_PAYMENTS_REGION === "us" ? "us" : "in"
const checkoutMode =
  process.env.ZOHO_PAYMENTS_CHECKOUT_MODE === "hosted" ? "hosted" : "widget"

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
  },
  modules: [
    // ...your existing modules
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-zoho/providers/zoho",
            id: "zoho",
            options: {
              accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID,
              clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID,
              clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
              refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN,
              signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY || undefined,
              apiKey: process.env.ZOHO_PAYMENTS_API_KEY || undefined,
              region,
              checkoutMode,
              successUrl: process.env.ZOHO_PAYMENTS_SUCCESS_URL || undefined,
              failureUrl: process.env.ZOHO_PAYMENTS_FAILURE_URL || undefined,
            },
          },
        ],
      },
    },
  ],
})
```

The `id: "zoho"` plus the provider's `identifier = "zoho"` produce the stored provider
ID `pp_zoho_zoho`. Enable that provider for the region in Medusa Admin under
**Settings → Regions**.

### Environment variables

```bash
ZOHO_PAYMENTS_ACCOUNT_ID=
ZOHO_PAYMENTS_CLIENT_ID=
ZOHO_PAYMENTS_CLIENT_SECRET=
ZOHO_PAYMENTS_REFRESH_TOKEN=
ZOHO_PAYMENTS_SIGNING_KEY=
ZOHO_PAYMENTS_API_KEY=
ZOHO_PAYMENTS_REGION=in
ZOHO_PAYMENTS_CHECKOUT_MODE=widget
ZOHO_PAYMENTS_SUCCESS_URL=https://storefront.example.com/checkout-success
ZOHO_PAYMENTS_FAILURE_URL=https://storefront.example.com/checkout-failure
```

`apiKey` is required for widget mode. `successUrl` and `failureUrl` are required for
hosted mode and must be HTTPS outside localhost. The signing key is required for webhook,
widget-response, and hosted-return verification. Never expose the client secret, refresh
token, signing key, or access tokens to the storefront.

### Storefront

```tsx
"use client"

import type { HttpTypes } from "@medusajs/types"

import { sdk } from "@/lib/medusa"
import { payWithZohoCheckout } from "medusa-payment-zoho/client"

async function payWithZoho(cart: HttpTypes.StoreCart) {
  const { payment_collection } = await sdk.store.payment.initiatePaymentSession(cart, {
    provider_id: "pp_zoho_zoho",
  })

  const sessions = payment_collection.payment_sessions ?? []
  const session =
    sessions.find((candidate) => candidate.provider_id === "pp_zoho_zoho") ??
    sessions[0]

  if (!session) throw new Error("No payment session was created")

  const result = await payWithZohoCheckout({ session: session.data })

  if (result.ok) {
    const completion = await sdk.store.cart.complete(cart.id)
    if (completion.type === "order") {
      // Redirect only after Medusa has created the order.
    }
  }
}
```

See `examples/nextjs-checkout/ZohoPaymentButton.tsx` for loading, closed, expired,
failed, hosted, and already-completed states.

### Webhooks

Configure these events in Zoho **Settings → Developer Space → Webhooks**:

```text
payment.succeeded
payment.pending
payment.failed
```

Point the endpoint at:

```text
https://your-medusa-server.example.com/hooks/payment/zoho_zoho
```

`refund.succeeded` and `refund.failed` are acknowledged but intentionally not mapped to
a Medusa action; reconcile refunds with `GET /refunds/{id}`. See the architecture and
compatibility documents for the full event table.

## 6. Keywords

Current keywords in `package.json` (verified):

```text
medusa, medusajs, medusa-v2, medusa-plugin, medusa-plugin-payment,
medusa-plugin-integration, payment, payments, payment-provider, zoho,
zoho-payments, zohopay, india, inr, upi, cards, ach, checkout, ecommerce
```

Suggested additions if the metadata is edited:

```text
medusa-payment, medusa-payment-zoho, zoho-payment-gateway, medusa-payment-provider
```

Do not remove `medusa-plugin` or `medusa-plugin-integration`. Medusa's published
directory guidance says packages carrying those keywords are picked up during the next
npm sync. The `medusa-payment-*` prefix is already used by other payment providers in
the directory.

## 7. Support statement

```markdown
## Support

This package is community-maintained by Jayashakthi Vishnu. Support is best-effort
through GitHub Issues:

https://github.com/Jayashakthi28/medusa-payment-zoho/issues

There is no SLA, no paid support plan, and no official support commitment from Zoho
Corporation or Medusa. When opening an issue, include the package version, Medusa
version, Node version, region (`in` or `us`), checkout mode, the exact error code, and
redacted logs. Never include your client secret, refresh token, signing key, access
token, or full webhook payloads containing customer data.

For security vulnerabilities, use GitHub's private security advisory flow instead of a
public issue.
```

The checked-in `SECURITY.md` contains the same private-reporting instruction.

## 8. Not-affiliated disclaimer

```markdown
## Disclaimer

This is an independent community integration. It is not affiliated with, endorsed by,
or supported by Zoho Corporation, Zoho Payments, or Medusa. Zoho, Zoho Payments, and
Medusa are trademarks of their respective owners.
```

Use this wording in the README, the npm description area if space allows, and the
directory submission notes. Do not use Zoho or Medusa logos in a way that suggests
endorsement.

## 9. README review outline

Medusa's integration pages render the npm README, so the README is part of the listing.
The checked-in `README.md` covers these areas; use this as a review order:

1. Title, one-line description, and the non-affiliation disclaimer.
2. Badges (npm version, license, CI).
3. What the package does and which regions/modes it supports.
4. Requirements: Medusa `>=2.17.2 <3`, verified 2.22.0; Node 22.22.x for Medusa 2.22.
5. Install and `medusa-config.ts` snippet.
6. Zoho credentials, scopes, and environment variables.
7. Enable the provider in a Medusa region.
8. Storefront integration for widget and hosted checkout.
9. Webhook URL and event list; signing-key warning.
10. Capture, cancel, and refund limitations.
11. Testing commands and the 100% coverage gate.
12. Troubleshooting: 401, invalid signature, expired session, widget blocked by CSP.
13. Support, security reporting, license, and non-affiliation.

## 10. Submission checklist for `medusajs.com/integrations`

As of 2026-10-23, Medusa's published guidance is that integrations are discovered from
npm during a periodic sync when the package uses the right metadata; there is no
documented manual form in the current directory. Confirm the current process on
[Medusa's integration listing announcement](https://medusajs.com/blog/integrations-apr-26)
before submitting. The checklist below covers both automatic discovery and a manual
follow-up. The repository release process is documented in
[`docs/publishing.md`](./publishing.md).

### Repository readiness

The package now has a root `README.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE`, CI
workflows, and the package verifier. Confirm these remain true before tagging:

- [ ] `README.md` is the listing body and still states the non-affiliation disclaimer.
- [ ] `CHANGELOG.md` and `SECURITY.md` exist and are included by the `files` list.
- [ ] `scripts/verify-package.mjs` exists and `pnpm verify:package` passes.
- [ ] `.github/workflows/ci.yml` still runs the full gate on Node 22 and 24.
- [ ] `pnpm check` passes end-to-end before the release tag.
- [ ] `pnpm test:coverage` reports 100% on lines, statements, functions, and branches.
- [ ] `pnpm pack:check` reports no `publint` or `attw` finding for all four entry points.
- [ ] `pnpm verify:package` imports the client (ESM and CJS), provider loader, server
      entry, and `package.json` from an installed tarball.
- [ ] Reconcile `docs/PROGRESS.md` with the actual state of the repository. It is still
      marked as wave 1 in progress.
- [ ] Inspect `npm pack --dry-run`: no `src`, `test`, `examples`, `coverage`, `.env`,
      `node_modules`, or credentials. `dist`, `docs`, `README.md`, `CHANGELOG.md`,
      `SECURITY.md`, `LICENSE`, and metadata must be present.
- [ ] Verify the repository URL, homepage, and issues URL in `package.json`. This
      checkout has no configured git remote, so reachability was not verified here.
- [ ] Confirm the license is MIT and the package is published with
      `publishConfig.access: "public"`.

### Package metadata

- [ ] Name is `medusa-payment-zoho`.
- [ ] Version is a new, non-prerelease version.
- [ ] Description is accurate and under npm's display limit.
- [ ] Keywords include `medusa-plugin` and `medusa-plugin-integration`, plus the
      Zoho/India terms.
- [ ] `peerDependencies` declare `@medusajs/framework` and `@medusajs/medusa` at
      `>=2.17.2 <3.0.0`.
- [ ] `engines` and the README both state the Node floor clearly. Medusa 2.22 needs
      Node 22.22.x even though the package says `>=20`.
- [ ] `exports` resolves for root, `./providers/zoho`, `./client`, `./server`, and
      `./package.json`.

### Functional verification

- [ ] Install the packed tarball into a clean Medusa 2.22 application.
- [ ] Register the provider with `resolve: "medusa-payment-zoho/providers/zoho"` and
      `id: "zoho"`.
- [ ] Confirm the resolved provider ID is `pp_zoho_zoho`.
- [ ] Enable the provider for an India region and, if supported, a US region.
- [ ] Complete a widget payment in each enabled region.
- [ ] Complete a hosted checkout payment and verify the return signature server-side.
- [ ] Deliver a signed `payment.succeeded` event to
      `/hooks/payment/zoho_zoho`; confirm the order/payment.
- [ ] Deliver an invalid signature; confirm the provider rejects it and logs a
      verification error. Remember the route may still return HTTP 200.
- [ ] Deliver `payment.failed` for a non-terminal session; confirm the order is not
      failed prematurely.
- [ ] Refund a captured payment, fully and partially, and reconcile the refund status.
- [ ] Confirm no secret appears in browser bundles, payment-session `data`, logs, or
      thrown error messages.

### Publish and directory sync

- [ ] Publish only after the maintainer explicitly approves a release. The working
      agreement says not to push or publish without that instruction.
- [ ] Create and push a `v<version>` tag that matches `package.json`; the release
      workflow runs the gate and publishes with provenance.
- [ ] Confirm the npm page renders the README and the install command.
- [ ] Wait for Medusa's next directory sync. Confirm the listing appears under
      **Payment** with the correct title, description, repository, npm link, version,
      and Medusa v2 compatibility.
- [ ] If the listing does not appear, use Medusa's published ecosystem contact channel
      and include the npm package name, version, repository URL, category, and the
      non-affiliation statement. Do not claim official support.
- [ ] After listing, add the directory URL to the README and the repository homepage.
- [ ] Add GitHub topics such as `medusa`, `medusa-plugin`, `medusa-payment`,
      `zoho-payments`, and `india`.

## 11. Listing copy review notes

- Prefer "Zoho Payments" over "Zoho" alone; the package does not cover Zoho Books,
  Zoho CRM, or other Zoho products.
- Do not say "official", "certified", "supported by Zoho", or "supported by Medusa".
- Do not promise manual capture, partial capture, cancellation, saved payment methods,
  payment links, payouts, or refund webhooks. The provider deliberately does not support
  them.
- State the 15-minute default session lifetime and the need to restart checkout after
  expiry.
- State that refunds are asynchronous at Zoho and may need reconciliation.
- State that hosted checkout requires merchant-owned success/failure routes and HTTPS
  outside localhost.
- Keep the support statement factual: community-maintained, best-effort, no SLA.

## 12. References

- [Medusa integrations directory](https://medusajs.com/integrations/)
- [How integrations are listed](https://medusajs.com/blog/integrations-apr-26)
- [Medusa payment module provider guide](https://docs.medusajs.com/resources/references/payment/provider)
- [Medusa payment webhook events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events)
- [Zoho Payments developer documentation](https://www.zoho.com/us/payments/developerdocs/)
- [Compatibility and limitations](./compatibility.md)
- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Traceability](./traceability.md)
- [Publishing](./publishing.md)
- [Examples](../examples/README.md)

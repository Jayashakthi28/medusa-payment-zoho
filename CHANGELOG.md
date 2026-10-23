# Changelog

All notable changes to `medusa-payment-zoho` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-23

Initial release of the Zoho Payments provider for Medusa v2.

### Added

- Medusa v2 payment module provider identified as `zoho` (`pp_zoho_zoho`) for Zoho
  Payments in India (default) and the United States.
- Embedded Zoho Checkout Widget support with a framework-agnostic browser helper
  (`payWithZohoCheckout`) that loads Zoho’s script once, returns a discriminated result,
  and never exposes server secrets.
- Zoho Hosted Checkout support with generated `checkoutUrl`, redirect helper, and
  documented success/failure return routes.
- Server-side payment-session lifecycle: creation, exact-match reuse, cart-update
  replacement, expiry tracking, authorization polling, and status mapping.
- Automatic capture semantics: successful Zoho payments map to `CAPTURED`, while
  `capturePayment` verifies the existing payment instead of performing a manual capture.
- Full and partial refunds against captured payments, asynchronous refund status
  recording, and a local replay guard keyed by Medusa’s idempotency key.
- Signed webhook handling for `payment.succeeded`, `payment.success`,
  `payment.pending`, and `payment.failed`, including raw-body HMAC verification,
  account checks, live/test-mode checks, and missing-session handling.
- Per-attempt `payment.failed` reconciliation against the Zoho session, so a later
  successful attempt does not fail the order.
- Three signature helpers: webhook (`${t}.${rawBody}`), widget
  (`${paymentId}|${paymentSessionId}`), and hosted checkout (ten dot-joined fields with
  empty strings for absent optionals).
- OAuth 2.0 org refresh-token support with in-memory caching, single-flight refresh,
  one retry on `401`, and retryable-versus-terminal error classification.
- HTTP retry policy with `Retry-After` support: safe calls retry network/`429`/`5xx`;
  refund creation retries only explicit `429`.
- ISO-4217 amount formatting with `BigNumber` and currency fraction digits; zero and
  negative amounts are rejected.
- Typed errors with stable codes for configuration, authentication, API, validation,
  webhook verification, unsupported operations, and payment state.
- Browser-safe `client` entry point with no `node:*` or `@medusajs/*` imports, plus a
  server-only `server` entry point for signatures and reconciliation clients.
- ESM and CommonJS builds with TypeScript declarations and package checks for exports,
  types, and browser purity.
- Documentation for configuration, both storefront flows, webhooks, signatures,
  troubleshooting, security, contributing, and compatibility.
- Test suite covering amount/status utilities, OAuth, HTTP, signatures, session data,
  both checkout modes, webhooks, refunds, and browser-helper behaviour, with a 100%
  line/branch/function/statement coverage gate.

### Security

- Webhook and checkout signatures are verified with HMAC-SHA256 and constant-time
  comparison; a missing signing key fails closed.
- Server secrets (client secret, refresh token, signing key, access tokens) are kept out
  of payment-session `data`, logs, errors, and browser bundles.
- Account and live/test-mode checks prevent valid signatures from another account or
  environment from completing a payment.
- Raw card data never reaches the Medusa server when using the Zoho widget or hosted
  checkout; PCI scope remains the merchant’s responsibility.

### Known limitations

- Zoho captures successful payments automatically; manual and partial capture are not
  supported.
- Zoho has no cancel API for pending sessions or captured payments. Pending sessions
  expire after 15 minutes; captured payments must be refunded.
- Refund webhooks are acknowledged as `NOT_SUPPORTED`; reconcile refunds with
  `GET /refunds/{id}`.
- Saved payment methods, account holders, payment links, and payouts are not implemented.
- One provider instance maps to one Zoho account; multi-account routing is not built in.
- There is no durable webhook `event_id` store in this release.

[1.0.0]: https://github.com/Jayashakthi28/medusa-payment-zoho/releases/tag/v1.0.0

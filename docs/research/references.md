# References

- **Last reviewed:** 2026-10-23
- **Policy:** Official vendor and framework documentation first. Community links are
  included only where they illustrate an implementation pattern. Links are not
  vendored; if a page moves, search the vendor site for the title.

## 1. Medusa v2

| Reference                                                                                                           | Why it matters                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Payment Module Provider guide](https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider)      | Module registration, provider ID format, provider responsibilities           |
| [Payment Provider reference](https://docs.medusajs.com/resources/references/payment/provider)                       | Full `AbstractPaymentProvider` method contract, `data` flow, webhook payload |
| [Payment Webhook Events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events)               | `/hooks/payment/[identifier]_[id]` route and action semantics                |
| [Payment Module Options](https://docs.medusajs.com/resources/commerce-modules/payment/module-options)               | `providers`, `webhook_delay`, `webhook_retries`                              |
| [Payment Module overview](https://docs.medusajs.com/resources/commerce-modules/payment)                             | Payment session, payment, refund concepts                                    |
| [Stripe provider guide](https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe)       | Official reference integration                                               |
| [Stripe provider source](https://github.com/medusajs/medusa/tree/develop/packages/modules/providers/payment-stripe) | Production-grade provider structure and tests                                |
| [Medusa repository](https://github.com/medusajs/medusa)                                                             | Source of truth for framework behaviour                                      |
| [Medusa releases](https://github.com/medusajs/medusa/releases)                                                      | Version-specific changes, including webhook route prefix support             |
| [Medusa integrations](https://medusajs.com/integrations/)                                                           | Ecosystem discovery                                                          |

## 2. Zoho Payments

### API

| Reference                                                                    | Why it matters                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [API introduction](https://www.zoho.com/us/payments/api/v1/introduction/)    | Root endpoint, `account_id`, rate limits                                |
| [Authentication](https://www.zoho.com/us/payments/api/v1/authentication/)    | OAuth token use and headers                                             |
| [Payment sessions](https://www.zoho.com/us/payments/api/v1/payment-session/) | Create/retrieve, 15-minute expiry, `expires_in` 300–900, metadata limit |
| [Payments](https://www.zoho.com/us/payments/api/v1/payments/)                | Payment retrieval, auto-capture, refund totals                          |
| [Refunds](https://www.zoho.com/us/payments/api/v1/refunds/)                  | Create/retrieve, partial refunds, statuses, failure reasons             |
| [Webhook events](https://www.zoho.com/us/payments/api/v1/webhooks-events/)   | Event names and payload shapes                                          |
| [Errors](https://www.zoho.com/us/payments/api/v1/errors/)                    | Error envelope and codes                                                |
| [OpenAPI bundle](https://www.zoho.com/us/payments/api/v1/openapi-all.zip)    | Machine-readable API definitions                                        |

### Developer guides

| Reference                                                                                           | Why it matters                                                    |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Developer docs home](https://www.zoho.com/us/payments/developerdocs/)                              | Entry point for all integration guides                            |
| [OAuth (ORG clients)](https://www.zoho.com/us/payments/developerdocs/web-integration/org-oauth/)    | Client registration, refresh token, scopes                        |
| [Hosted Checkout](https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/)  | `access_key`, return parameters, signature construction           |
| [Checkout Widget](https://www.zoho.com/us/payments/developerdocs/web-integration/integrate-widget/) | Script, instance, `requestPaymentMethod`                          |
| [Webhook configuration](https://www.zoho.com/us/payments/developerdocs/webhooks/configure/)         | Manual setup, 2-day retries, endpoint limits                      |
| [Webhook verification](https://www.zoho.com/us/payments/developerdocs/webhooks/verification/)       | `t`/`v` header and raw-body HMAC                                  |
| [Webhook best practices](https://www.zoho.com/us/payments/developerdocs/webhooks/best-practices/)   | At-least-once delivery, duplicates, failed-attempt reconciliation |
| [Signature verification](https://www.zoho.com/us/payments/developerdocs/signature-verification/)    | Widget and return-URL signatures                                  |
| [Rate limits](https://www.zoho.com/us/payments/developerdocs/rate-limits/)                          | 429 behaviour and quotas                                          |
| [Go-live checklist](https://www.zoho.com/us/payments/developerdocs/go-live/)                        | Production readiness                                              |
| [Security & compliance](https://www.zoho.com/us/payments/developerdocs/security/)                   | PCI and data-handling context                                     |
| [India developer docs](https://www.zoho.com/in/payments/developerdocs/)                             | India-specific equivalents                                        |

### Regional endpoints

| Region | API                                | OAuth                       | Hosted checkout                            |
| ------ | ---------------------------------- | --------------------------- | ------------------------------------------ |
| India  | `https://payments.zoho.in/api/v1`  | `https://accounts.zoho.in`  | `https://payments.zoho.in/hostedcheckout`  |
| US     | `https://payments.zoho.com/api/v1` | `https://accounts.zoho.com` | `https://payments.zoho.com/hostedcheckout` |

## 3. Standards

| Reference                                                                                                  | Why it matters                                  |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html)                                               | Currency codes and fraction digits              |
| [OAuth 2.0 (RFC 6749)](https://www.rfc-editor.org/rfc/rfc6749)                                             | Refresh-token grant                             |
| [HMAC (RFC 2104)](https://www.rfc-editor.org/rfc/rfc2104)                                                  | Signature primitive                             |
| [Node.js `crypto`](https://nodejs.org/api/crypto.html)                                                     | `createHmac`, `timingSafeEqual`                 |
| [Node.js releases](https://nodejs.org/en/about/previous-releases)                                          | Runtime support and Medusa's Node floor         |
| [npm package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)                            | `exports`, `engines`, `peerDependencies`        |
| [OWASP Webhook Security](https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html) | Replay, signature, and acknowledgement guidance |

## 4. Community patterns

| Reference                                                                                               | Why it matters                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [npm: Medusa Razorpay search](https://www.npmjs.com/search?q=medusa%20razorpay)                         | Regional community providers and README patterns |
| [GitHub: Medusa Razorpay search](https://github.com/search?q=medusa+razorpay+payment&type=repositories) | Source-level comparison                          |
| [Medusa integrations](https://medusajs.com/integrations/)                                               | Listed providers and categories                  |

## 5. Project documents

| Document                                                    | Contents                                |
| ----------------------------------------------------------- | --------------------------------------- |
| [Architecture](../architecture.md)                          | Components, flows, trust boundaries     |
| [Compatibility](../compatibility.md)                        | Version matrix and known limitations    |
| [ADR-0001](../decisions/ADR-0001-package-identity.md)       | Package/provider identity               |
| [ADR-0002](../decisions/ADR-0002-checkout-architecture.md)  | Widget vs hosted checkout               |
| [ADR-0003](../decisions/ADR-0003-session-lifecycle.md)      | Session creation, reuse, status mapping |
| [ADR-0004](../decisions/ADR-0004-webhook-authorization.md)  | Webhook verification and event mapping  |
| [ADR-0005](../decisions/ADR-0005-capture-cancel-refund.md)  | Capture, cancel, refund semantics       |
| [ADR-0006](../decisions/ADR-0006-oauth-retry-policy.md)     | OAuth and transport retry policy        |
| [ADR-0007](../decisions/ADR-0007-signature-verification.md) | Signature message construction          |
| [Zoho research](./zoho-payments.md)                         | Zoho API facts and open questions       |
| [Medusa research](./medusa-v2-payment-provider.md)          | Medusa provider contract and data flow  |
| [Community review](./community-modules.md)                  | Patterns adopted and rejected           |

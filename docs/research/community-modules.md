# Community Medusa payment modules — review notes

- **Date:** 2026-10-23
- **Status:** Research note for `medusa-payment-zoho`
- **Scope:** Public source and READMEs of Medusa v2 payment providers, with the official
  Stripe provider as the quality reference and community Razorpay providers as the
  closest regional comparison. No third-party code was executed or copied.

## 1. Why these references

Zoho Payments and Razorpay occupy a similar position in the Medusa ecosystem: an
India-first gateway with a hosted/embedded checkout and no Stripe-style
PaymentIntent/capture split. The official Stripe provider demonstrates how a
production-grade Medusa v2 provider should be structured; community Razorpay packages
show the minimum integration surface merchants expect, but several also show shortcuts
that this project must not repeat.

The review is about **patterns**, not about naming or shaming individual maintainers.
Community packages evolve; links are provided so a future maintainer can re-check the
current state.

## 2. Official Stripe provider — the quality bar

Source:
<https://github.com/medusajs/medusa/tree/develop/packages/modules/providers/payment-stripe>

Observed qualities worth adopting:

| Quality                            | What it looks like                                        | Why it matters                            |
| ---------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| Module-provider registration       | `ModuleProvider(Modules.PAYMENT, { services: [...] })`    | Loads correctly in Medusa's module system |
| Options validation                 | Required keys checked at startup; typed options           | Fails fast instead of at first checkout   |
| Typed client boundary              | A small client wraps the SDK/API                          | Provider logic stays testable             |
| Webhook signature verification     | Raw body + signature header checked before mapping        | Prevents forged payment completion        |
| Explicit status mapping            | Gateway status → Medusa status in one place               | Avoids scattered conditionals             |
| Idempotent capture/refund handling | Re-reads state; uses provider idempotency where available | Safe retries                              |
| Tests around webhook and refunds   | Unit tests with fake clients and events                   | Protects the risky paths                  |
| Minimal public session data        | Only publishable checkout data in `data`                  | No secret leakage to storefront           |
| Documentation of limitations       | Manual capture, supported methods, webhook setup          | Sets merchant expectations                |
| Error mapping                      | Gateway errors → Medusa errors with actionable messages   | Admin sees what went wrong                |

The Stripe provider can rely on Stripe capabilities this package cannot: PaymentIntents,
manual capture, idempotency keys, and a mature SDK. The structural lessons transfer;
the lifecycle does not.

## 3. Community Razorpay providers — patterns and anti-patterns

Representative discovery links:

- npm search: <https://www.npmjs.com/search?q=medusa%20razorpay>
- GitHub search: <https://github.com/search?q=medusa+razorpay+payment&type=repositories>
- Medusa integrations directory: <https://medusajs.com/integrations/>

### Patterns worth adopting

| Pattern                                    | Observation                                                       | Decision for this package                                     |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Single provider service + `ModuleProvider` | One class extends `AbstractPaymentProvider`; exported as a module | Adopt                                                         |
| `medusa-config.ts` snippet in README       | Copy-paste setup with `resolve`, `id`, and options                | Adopt, with India-first defaults and secret-handling notes    |
| Region enablement instructions             | Merchant must enable the provider in Admin → Regions              | Adopt                                                         |
| Storefront script/redirect example         | Shows how to open the gateway checkout                            | Adopt, but as a framework-agnostic helper with a typed result |
| Webhook route documentation                | Tells the merchant the `/hooks/payment/...` URL                   | Adopt, including the `zoho_zoho` route and manual Zoho setup  |
| Refund support                             | Admin refunds call the gateway refund API                         | Adopt, with partial refunds and idempotency caveats           |
| Typed options object                       | Key/secret/webhook secret fields                                  | Adopt, with validation and no secret logging                  |
| Test-mode guidance                         | Separate test credentials or dashboard mode                       | Adopt in docs; the provider honours `liveMode` for webhooks   |

### Anti-patterns deliberately rejected

| Anti-pattern                                         | Risk                                                                 | This package's guard                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Hardcoded `INR` or a single currency                 | Wrong amount/currency for US merchants or multi-currency stores      | ISO-4217 validation; currency comes from Medusa input  |
| `Number(amount)` / floating-point arithmetic         | Rounding errors, especially JPY/KWD and large carts                  | `BigNumber` + ISO fraction digits, decimal strings     |
| Casting `amount as number` in webhook data           | Precision loss and unit confusion                                    | Parse Zoho's decimal string with `BigNumber`           |
| `catch { return { status: "failed" } }`              | Hides network/auth errors and marks valid payments failed            | Typed errors; no swallowed exceptions                  |
| Trusting a client-reported `payment_id`              | A customer can forge success                                         | Server retrieves the payment/session from Zoho         |
| Webhook handler without signature verification       | Anyone can complete an order                                         | HMAC over raw body before parsing                      |
| Putting the gateway secret in session `data`         | Leaks to the storefront and browser devtools                         | Secrets stay server-side; only publishable widget data |
| Assuming manual capture                              | `capturePayment` calls a nonexistent endpoint or reports false state | Capture is a verification read                         |
| Treating `payment.failed` as terminal                | Fails a session that can still succeed on retry                      | Reconcile the session before failing                   |
| No tests for webhook/refund paths                    | Regressions reach production silently                                | 100% coverage gate and explicit vectors                |
| Blocking the webhook response on slow reconciliation | Zoho times out and retries; duplicate processing                     | Acknowledge early; keep handler read-only              |
| Retrying state-changing calls after timeout          | Duplicate refunds                                                    | `retryPolicy: "none"` for refund POSTs                 |
| No `maxRetryCount` or expiry handling                | Broken checkout after 15 minutes                                     | Record and enforce `expiresAt`; restart session        |
| README promises "official" support                   | Misleads merchants about maintenance/SLA                             | Explicit non-affiliation statement                     |

## 4. What merchants expect from the README

Across the reviewed modules, the README is often the deciding factor. The minimum
useful content is:

1. What the package is and is not (official/unofficial, supported regions).
2. Install command and peer requirements.
3. A complete `medusa-config.ts` provider block.
4. Where to get each credential and which scopes to grant.
5. Webhook URL and event selection.
6. Storefront integration for both embedded and redirect flows.
7. Region enablement in Medusa Admin.
8. Supported currencies/payment methods and known limitations.
9. Test-mode instructions and go-live checklist.
10. Troubleshooting for the top failure modes (401, invalid signature, expired session).

This package's docs mirror that list and add an explicit security model.

## 5. Comparison summary

| Dimension           | Official Stripe provider   | Typical community Razorpay provider | `medusa-payment-zoho`                             |
| ------------------- | -------------------------- | ----------------------------------- | ------------------------------------------------- |
| Registration        | ModuleProvider             | ModuleProvider                      | ModuleProvider                                    |
| Options validation  | Strong                     | Varies                              | Strict, startup-time                              |
| Money handling      | Provider minor units       | Often `Number` casts                | Decimal strings + ISO precision                   |
| Webhook security    | Signature verification     | Sometimes missing                   | Mandatory, raw-body HMAC                          |
| Manual capture      | Supported                  | Not applicable / sometimes assumed  | Explicitly unsupported; verification only         |
| Cancel              | Supported                  | Varies                              | Honest no-op/reject                               |
| Refunds             | Full/partial + idempotency | Full/partial, often no idempotency  | Full/partial + local replay guard, no blind retry |
| Tests               | Extensive                  | Often none/thin                     | 100% coverage gate                                |
| Browser integration | Stripe.js helper           | Script/redirect snippet             | Separate framework-agnostic client entry          |
| Secrets in `data`   | Avoided                    | Occasionally leaked                 | Forbidden by invariant                            |

## 6. Review limitations

- Only public repositories/packages were inspected; private merchant forks and internal
  plugins are not represented.
- Community packages change quickly; a pattern observed on 2026-10-23 may be fixed
  later.
- README claims were not treated as evidence of runtime behaviour; the comparison is
  about visible code structure and documented behaviour.
- No third-party code was copied. The official Stripe provider is a structural
  reference, not a source of vendored code.

## 7. References

- Medusa payment provider guide:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>
- Official Stripe provider source:
  <https://github.com/medusajs/medusa/tree/develop/packages/modules/providers/payment-stripe>
- Official Stripe provider docs:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe>
- Medusa integrations:
  <https://medusajs.com/integrations/>
- npm search for Medusa Razorpay packages:
  <https://www.npmjs.com/search?q=medusa%20razorpay>
- GitHub search for Medusa Razorpay providers:
  <https://github.com/search?q=medusa+razorpay+payment&type=repositories>
- Zoho Payments developer docs:
  <https://www.zoho.com/us/payments/developerdocs/>

# Compatibility and known limitations

- **Package:** `medusa-payment-zoho`
- **Last verified:** 2026-10-23
- **Baseline:** Medusa 2.22.0, Node 22.22, Zoho Payments India (default) and US

This document states what is supported, what is expected but not continuously tested,
and what the integration deliberately cannot do. It is part of the public contract; a
change to these guarantees requires an ADR.

## 1. Medusa compatibility

| Medusa version    | Status                             | Notes                                                                      |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `< 2.17.2`        | **Unsupported**                    | `PENDING_AUTHORIZATION` was introduced in 2.17.2; outside the peer range   |
| `2.17.2 – 2.21.1` | **Peer-compatible, not CI-tested** | Core methods exist; use the unprefixed webhook route                       |
| `2.21.2 – 2.22.x` | **Supported**                      | Both `/hooks/payment/zoho_zoho` and `/hooks/payment/pp_zoho_zoho` resolve  |
| `2.22.0`          | **Verified**                       | Development and release baseline                                           |
| `>= 3.0.0`        | **Unsupported**                    | Major-version contract may change; a new ADR and release line are required |

The peer dependencies are:

```json
{
  "@medusajs/framework": ">=2.17.2 <3.0.0",
  "@medusajs/medusa": ">=2.17.2 <3.0.0",
  "@medusajs/types": ">=2.17.2 <3.0.0"
}
```

"Peer-compatible" means the package installs and the implemented methods match the
documented 2.x contract; it does not mean every minor version is exercised in CI. Pin
your Medusa version and run the integration fixture before upgrading production.

### Provider registration

```ts
{
  resolve: "medusa-payment-zoho/providers/zoho",
  id: "zoho",
  options: {
    accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID,
    clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID,
    clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN,
    signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY,
    region: "in",
    checkoutMode: "widget",
    apiKey: process.env.ZOHO_PAYMENTS_API_KEY,
  },
}
```

The stored provider ID is `pp_zoho_zoho`. Enable it for the relevant region in Medusa
Admin.

## 2. Runtime compatibility

| Component          | Supported                                       | Notes                                                                                                                |
| ------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Node.js            | `>= 20` (package); `>= 22.22.0` for Medusa 2.22 | Medusa 2.22's own `engines` sets the effective floor. Node 20 is only viable with older Medusa lines that support it |
| Package manager    | pnpm 11.5.1 (repository)                        | npm/yarn can install the published package; lockfile and scripts assume pnpm                                         |
| TypeScript         | 5.9.x (development)                             | Types are emitted as `.d.ts`; consumers need a TS version that understands the export map                            |
| Module format      | ESM + CJS                                       | Both are built and checked with `attw`                                                                               |
| PostgreSQL / Redis | Inherited from Medusa                           | The provider adds no storage or cache dependency                                                                     |

## 3. Zoho compatibility

| Capability      | India (`region: "in"`)                                 | US (`region: "us"`)                                     |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Default region  | Yes                                                    | Opt-in                                                  |
| API base        | `https://payments.zoho.in/api/v1`                      | `https://payments.zoho.com/api/v1`                      |
| OAuth base      | `https://accounts.zoho.in`                             | `https://accounts.zoho.com`                             |
| Hosted checkout | `https://payments.zoho.in/hostedcheckout/<access_key>` | `https://payments.zoho.com/hostedcheckout/<access_key>` |
| Widget domain   | `IN`                                                   | `US`                                                    |
| Embedded widget | Yes                                                    | Yes                                                     |
| Refunds         | Yes                                                    | Yes                                                     |
| Webhooks        | Yes                                                    | Yes                                                     |

The account, OAuth client, and region must match. A token from the US data centre will
not authorize an India account, and vice versa.

Required scopes:

```text
ZohoPay.payments.CREATE
ZohoPay.payments.READ
ZohoPay.refunds.CREATE
ZohoPay.refunds.READ
```

Webhooks are configured manually in Zoho, so webhook-management scopes are not needed.

### Currencies

- The provider validates ISO-4217 codes and formats amounts with the currency's
  fraction digits (`Intl.NumberFormat`): 2 for INR/USD, 0 for JPY, 3 for KWD/BHD.
- The **Zoho account** must support the currency. The provider does not maintain its own
  currency allow-list, because Zoho's list varies by region, account, and enablement.
- Zero and negative amounts are rejected.
- Crypto currencies are not supported.
- Amounts are formatted as decimal **major units** internally and sent to Zoho as JSON
  numbers, matching Zoho's `double` request schema. Responses are parsed as decimal
  strings. No binary floating-point arithmetic is used for formatting or comparison.

### Payment methods

The provider forwards an optional `allowedPaymentMethods` list to Zoho's
`configurations.allowed_payment_methods`. Actual availability (cards, UPI, ACH, etc.)
depends on the merchant's Zoho account, region, and risk settings. The package does not
guarantee a specific method.

## 4. Checkout compatibility

| Capability                         | Widget                                            | Hosted                    |
| ---------------------------------- | ------------------------------------------------- | ------------------------- |
| Default                            | Yes                                               | No (opt-in)               |
| Requires `apiKey`                  | Yes                                               | No                        |
| Requires `successUrl`/`failureUrl` | No                                                | Yes                       |
| Browser script                     | `static.zohocdn.com/zpay/zpay-js/v1/zpayments.js` | None                      |
| CSP changes                        | Allow Zoho script + payments domain               | Allow redirect/navigation |
| No-JS storefront                   | No                                                | Yes                       |
| Return signature helper            | Widget signature                                  | Hosted return signature   |
| Recommended fallback               | Hosted when script is blocked                     | Widget for embedded UX    |

Modern evergreen browsers with ES2020, `Promise`, `URL`, and `fetch` are expected. The
browser helper is tested in jsdom; it does not polyfill older browsers. The hosted flow
is a normal top-level navigation and has broader browser support.

## 5. Medusa feature coverage

| Feature                       | Supported | Notes                                                          |
| ----------------------------- | --------- | -------------------------------------------------------------- |
| Create/update payment session | Yes       | Reuse only when amount, currency, mode, and expiry all match   |
| Authorize payment             | Yes       | Polls Zoho session/payment                                     |
| Auto-capture                  | Yes       | Zoho captures successful payments                              |
| Manual capture                | **No**    | `capturePayment` verifies, does not capture                    |
| Partial capture               | **No**    | Not offered by Zoho                                            |
| Cancel pending payment        | **No**    | No Zoho API; wait for expiry                                   |
| Cancel captured payment       | **No**    | Refund instead                                                 |
| Full refund                   | Yes       | `POST /payments/{id}/refunds`                                  |
| Partial refund                | Yes       | Same endpoint                                                  |
| Multiple refunds              | Yes       | Each call creates a new Zoho refund                            |
| Refund webhook → Medusa       | **No**    | `refund.*` maps to `NOT_SUPPORTED`; poll `GET /refunds/{id}`   |
| Webhook payment completion    | Yes       | `payment.succeeded`, `payment.pending`, `payment.failed`       |
| Saved payment methods         | **No**    | Optional account-holder/payment-method methods not implemented |
| Payment links                 | **No**    | Out of scope                                                   |
| Payouts                       | **No**    | Out of scope                                                   |
| Multi-account routing         | **No**    | One provider instance = one Zoho account                       |

## 6. Known limitations

| #   | Limitation                                                                      | Impact                                                                                      | Mitigation                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | No manual or partial capture                                                    | `capturePayment` cannot capture; it only verifies an already-captured payment               | Treat successful Zoho payments as captured; refund for reversals                                               |
| 2   | No cancel API for pending sessions or captured payments                         | Admin cancel on a pending payment returns `NOT_ALLOWED`; captured payments require a refund | Let pending sessions expire (≤15 min); refund captured payments                                                |
| 3   | 15-minute session lifetime (300–900 s configurable at Zoho)                     | Slow checkouts fail at the widget/hosted page                                               | Record `expiresAt`, check it in the storefront, restart checkout with a new session                            |
| 4   | No idempotency-key header at Zoho                                               | A timed-out refund POST may have succeeded; a blind retry can double-refund                 | Refund POST retries only 429; reconcile `GET /refunds/{id}` or `GET /payments/{id}` after a timeout            |
| 5   | Refund status is asynchronous                                                   | Admin may see a refund before Zoho settles it                                               | Poll `GET /refunds/{id}` or run a reconciliation job; `refund.*` webhooks are not mapped                       |
| 6   | Webhooks must be configured manually                                            | No automatic endpoint registration; up to 5 endpoints; Zoho pings on registration           | Follow the setup guide; keep the endpoint publicly reachable                                                   |
| 7   | Webhook retries last up to 2 days, then the endpoint is disabled                | Prolonged downtime can lose events                                                          | Return 200 quickly, monitor failures, reconcile sessions/payments periodically                                 |
| 8   | Medusa's webhook route returns 200 before provider handling                     | A bad signature does not trigger a Zoho retry                                               | Alert on `ZOHO_WEBHOOK_VERIFICATION_ERROR`; reconcile suspicious payments                                      |
| 9   | No durable `event_id` dedupe                                                    | Duplicate delivery can re-run the action                                                    | Handler is read-only; Medusa workflow applies the transition; add a store if needed                            |
| 10  | Widget signature is optional                                                    | Client data cannot always be verified cryptographically                                     | Server retrieves the session/payment from Zoho before fulfilling                                               |
| 11  | Hosted return signature is not verified by the provider                         | A merchant route must verify it                                                             | Use `isValidZohoHostedCheckoutSignature` in the return route; webhook/poll is the backstop                     |
| 12  | One `signingKey` for webhook, widget, and hosted signatures                     | Key rotation couples all three                                                              | Rotate in Zoho and Medusa together; split the option in a future ADR if Zoho separates keys                    |
| 13  | No saved payment methods/account holders                                        | Customers re-enter details every time                                                       | Out of scope for v1; design with PCI/consent review before adding                                              |
| 14  | Node 20 in `engines`, Node 22.22 required by Medusa 2.22                        | Installing on Node 20 with Medusa 2.22 can fail at runtime/build                            | Use Node 22.22+ for Medusa 2.22; CI uses Node 22                                                               |
| 15  | Zoho status enums vary by region/docs                                           | Unknown status maps to `PENDING`, not success                                               | Defensive mapping; monitor unknown statuses; add mappings with tests                                           |
| 16  | `invoice_number`/`reference_number` limited to 50 chars; metadata max 5 entries | Long Medusa IDs are truncated; extra metadata capped                                        | Provider truncates; one entry reserved for `medusa_session_id`, up to 3 extra configured                       |
| 17  | Hosted `access_key` URL is a bearer capability                                  | Leaking it can expose the checkout page                                                     | Do not log `checkoutUrl`; keep it out of analytics                                                             |
| 18  | No built-in storefront UI                                                       | Merchants must wire the helper into their checkout                                          | Use the documented helper; hosted mode is a plain redirect                                                     |
| 19  | No automatic reconciliation job                                                 | Lost webhooks/refunds need manual or custom jobs                                            | Use the exported `ZohoPaymentsClient` (`retrievePaymentSession`, `retrievePayment`, `retrieveRefund`) in a job |
| 20  | `allowedPaymentMethods` is pass-through only                                    | Unsupported methods are rejected by Zoho, not pre-validated                                 | Configure known methods; handle Zoho errors                                                                    |

## 7. Upgrade policy

- **Patch/minor Medusa upgrades within 2.x:** run `pnpm check` plus the integration
  fixture; verify the webhook route shape and `data.session_id` injection.
- **Medusa 2.21.2+:** both webhook route forms work; keep documenting the unprefixed
  form for portability.
- **Medusa 3.x:** not supported until a new ADR, a new peer range, and a new release
  line are approved.
- **Zoho API changes:** update the typed client, re-run signature and status-vector
  tests, and record the change in a new ADR if the public behaviour changes.
- **Node major upgrades:** update `engines`, CI, and `pnpm-lock.yaml` together.

## 8. Verification checklist

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm pack:check
pnpm verify:package
pnpm check
```

`pnpm test:coverage` must stay at **100%** for lines, branches, functions, and
statements. Any `v8 ignore` needs a written justification in `docs/testing.md`.

Manual sandbox checks before a release:

1. Widget payment succeeds in India and the US.
2. Hosted payment succeeds in India and the US.
3. Hosted return signature verifies; a tampered field fails.
4. Webhook with a valid signature completes a cart; an invalid signature is rejected
   and logged.
5. `payment.failed` followed by a successful retry does not fail the order.
6. Partial and full refunds reach a terminal status at Zoho.
7. A refund POST timeout does not produce a second refund.
8. Provider disabled/removed does not corrupt existing payment records.

## 9. References

- [Medusa payment provider reference](https://docs.medusajs.com/resources/references/payment/provider)
- [Medusa payment webhook events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events)
- [Zoho payment sessions](https://www.zoho.com/us/payments/api/v1/payment-session/)
- [Zoho hosted checkout](https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/)
- [Zoho webhook configuration](https://www.zoho.com/us/payments/developerdocs/webhooks/configure/)
- [Zoho signature verification](https://www.zoho.com/us/payments/developerdocs/signature-verification/)
- [Architecture](./architecture.md)
- [Reference index](./research/references.md)

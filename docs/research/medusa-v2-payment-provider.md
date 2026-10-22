# Medusa v2 payment provider research

- **Date:** 2026-10-23
- **Status:** Research note for `medusa-payment-zoho`
- **Method:** Official Medusa documentation plus the installed `@medusajs/framework`
  and `@medusajs/medusa` 2.22.0 packages. Summaries only; linked pages are authoritative.

## 1. Division of responsibility

Medusa's Payment Module owns the commerce state: `PaymentSession`, `Payment`,
`Refund`, collection totals, and order completion. A **payment module provider** owns
only the third-party integration: creating an external session, authorizing or
capturing money, refunding, cancelling, and translating webhooks.

A provider is a Medusa module whose main service extends
`AbstractPaymentProvider` from `@medusajs/framework/utils`. A module can expose several
provider services; each becomes a separate Medusa payment provider.

Registration in `medusa-config.ts`:

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
      {
        resolve: "medusa-payment-zoho/providers/zoho",
        id: "zoho",
        options: { /* Zoho credentials */ },
      },
    ],
  },
}
```

The stored provider ID is `pp_{identifier}_{id}`. For this package that is
`pp_zoho_zoho`.

## 2. Provider contract

The methods this package implements:

| Method                    | Medusa purpose                                         | Provider behaviour                                   |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `initiatePayment`         | Create the external session for a cart                 | `POST /paymentsessions`, return public checkout data |
| `updatePayment`           | Refresh the session after cart changes                 | Reuse or replace the Zoho session                    |
| `authorizePayment`        | Determine whether the payment succeeded                | Retrieve/poll the Zoho session; return Medusa status |
| `capturePayment`          | Capture after authorization                            | Verify Zoho's automatic capture                      |
| `cancelPayment`           | Cancel an uncaptured payment                           | Return/no-op or reject; Zoho has no cancel API       |
| `deletePayment`           | Delete the external session when the customer switches | Local no-op; Zoho sessions expire                    |
| `refundPayment`           | Full or partial refund                                 | `POST /payments/{id}/refunds`                        |
| `retrievePayment`         | Read the external payment                              | `GET /payments/{id}` or session lookup               |
| `getPaymentStatus`        | Poll the external status                               | Map Zoho status to Medusa status                     |
| `getWebhookActionAndData` | Translate a provider webhook into a Medusa action      | Verify signature, map event                          |

Optional methods **not** implemented in v1: `createAccountHolder`,
`updateAccountHolder`, `deleteAccountHolder`, `retrieveAccountHolder`,
`savePaymentMethod`, `listPaymentMethods`, `deletePaymentMethod`. Zoho has customer and
saved-payment-method APIs, but supporting them would require a separate design for
account-holder identity, PCI scope, and storefront consent. Their absence does not
block card/UPI checkout. Medusa's base class does not supply these behaviours; the
provider simply does not advertise them.

## 3. The `data` contract and `session_id`

Every provider method receives `input.data`, which Medusa assembles from the stored
`PaymentSession.data` or `Payment.data`. The value returned from a method is persisted
and passed to later methods.

Important properties:

- `initiatePayment`'s returned `data` is stored on the `PaymentSession` and is
  **visible to the storefront**. Never put OAuth tokens, client secrets, refresh
  tokens, or signing keys there.
- `authorizePayment`'s returned `data` is stored on the created `Payment` and is the
  input to capture, refund, and status calls.
- `refundPayment`'s returned `data` replaces the payment data, so cumulative refund
  bookkeeping must be preserved explicitly.
- A payment can be refunded multiple times; each call sees the data from the previous
  call.

### `data.session_id`

In Medusa 2.22 the Payment Module injects `data.session_id` (the Medusa payment-session
ID) into provider calls. It is not a Zoho field. This package uses it as:

- Zoho `reference_number` (truncated to 50 characters), and
- Zoho `meta_data` entry `medusa_session_id`.

That ID is the bridge a signed webhook uses to find the right Medusa session. If it is
missing, the provider still creates a Zoho session but cannot reliably correlate
webhooks; the storefront must fall back to authorization/status polling.

## 4. Statuses and actions

### Payment session statuses

Medusa's `PaymentSessionStatus` values used by this package:

| Status                  | Meaning in this provider                              |
| ----------------------- | ----------------------------------------------------- |
| `PENDING`               | No Zoho status yet, or an unknown value               |
| `PENDING_AUTHORIZATION` | Zoho reports a payment attempt in progress (e.g. ACH) |
| `REQUIRES_MORE`         | Zoho requires additional customer action              |
| `CAPTURED`              | Zoho succeeded and auto-captured                      |
| `CANCELED`              | Zoho session expired or was canceled                  |
| `ERROR`                 | Zoho reported a definitive failure                    |

`AUTHORIZED` is deliberately not used for a successful Zoho session: Zoho has already
captured the money, and a later manual capture cannot occur.

### Webhook actions

`getWebhookActionAndData` returns a `WebhookActionResult`:

| Action                  | Medusa effect                                                    |
| ----------------------- | ---------------------------------------------------------------- |
| `SUCCESSFUL`            | Marks the payment session captured; completes the cart if needed |
| `PENDING_AUTHORIZATION` | Keeps the session open; may be retried later                     |
| `FAILED`                | Contract says failed; Medusa 2.22 webhook subscriber ignores it  |
| `NOT_SUPPORTED`         | No action                                                        |

The action data carries `session_id` (the Medusa session) and `amount` as a
`BigNumber`. Medusa's `processPaymentWorkflow` applies the transition.

## 5. Webhook route behaviour

Medusa provides the route out of the box:

```
POST /hooks/payment/[identifier]_[id]
```

For this package: `/hooks/payment/zoho_zoho`. Since Medusa 2.21.2 the route also accepts
the full provider ID `/hooks/payment/pp_zoho_zoho`; earlier versions require the
unprefixed form.

The route delegates to the Payment Module, which calls the provider's
`getWebhookActionAndData` with:

- `data`: the parsed JSON body,
- `rawData`: the raw body string or Buffer, and
- `headers`: the request headers.

Two operational details matter:

1. **The route acknowledges the request before the provider handler completes.**
   Therefore the provider cannot cause a Zoho retry by returning an error status. A bad
   signature must be rejected in `getWebhookActionAndData`, and monitoring must alert on
   verification failures.
2. **The payment module has `webhook_delay` (default 5000 ms) and `webhook_retries`
   (default 3).** These are application-level retries, separate from Zoho's own
   two-day delivery retries. They do not make a bad signature acceptable.

See [ADR-0004](../decisions/ADR-0004-webhook-authorization.md) for this package's
policy.

## 6. Auto-capture and the Medusa lifecycle

Medusa's model assumes a provider may authorize first and capture later. Zoho does not
offer that split. The package maps a successful Zoho session directly to `CAPTURED` and
implements `capturePayment` as a verification read, so:

- `authorizePayment` returning `CAPTURED` is truthful;
- `capturePayment` is idempotent and never creates a second charge;
- `cancelPayment` can only no-op or reject;
- refunds are the only way to reverse a captured payment.

This is an intentional deviation from the Stripe-shaped lifecycle, documented in
[ADR-0005](../decisions/ADR-0005-capture-cancel-refund.md).

## 7. Version and runtime notes

- Peer range for this package: `@medusajs/framework` and `@medusajs/medusa`
  `>=2.17.2 <3.0.0`.
- Developed and verified against **2.22.0**.
- `@medusajs/framework` 2.22.0 declares `node >=22.22.0`; the package's own `engines`
  field is `>=20`, so the effective floor for a Medusa 2.22 deployment is Node 22.22.
- Medusa 2.21.2 introduced acceptance of the `pp_`-prefixed webhook route.
- Optional account-holder and saved-payment-method methods exist across the 2.x line;
  this provider does not implement them, so their exact introduction version does not
  affect the peer floor.

## 8. Package-shape implications

- Register with `ModuleProvider(Modules.PAYMENT, { services: [...] })` and export the
  result as the module provider's default export.
- Keep the provider service's constructor free of network calls where possible; use the
  container's logger and validate options at startup.
- Keep the browser helper out of the provider entry point; Medusa's server build must
  never bundle DOM code.
- Test with a fake `ZohoPaymentsClientLike` and injected clock/sleep so status polling
  and retries are deterministic.
- The webhook and provider tests must exercise Medusa's route shape, not only the pure
  mapping function.

## 9. References

- Payment module provider guide:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider>
- Payment provider reference (all methods and data flow):
  <https://docs.medusajs.com/resources/references/payment/provider>
- Payment webhook events and route:
  <https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events>
- Payment module options (`webhook_delay`, `webhook_retries`):
  <https://docs.medusajs.com/resources/commerce-modules/payment/module-options>
- Official Stripe provider source (quality reference):
  <https://github.com/medusajs/medusa/tree/develop/packages/modules/providers/payment-stripe>
- Medusa repository:
  <https://github.com/medusajs/medusa>
- Medusa releases (version-specific behaviour):
  <https://github.com/medusajs/medusa/releases>

# ADR-0003: Payment-session lifecycle and state mapping

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0004](./ADR-0004-webhook-authorization.md), [ADR-0005](./ADR-0005-capture-cancel-refund.md), [Architecture](../architecture.md)

## Context

Medusa's Payment Module owns the payment-session record and its state machine. The
provider is asked to create, update, authorize, inspect, and delete the external
counterpart. Zoho Payments does not map cleanly onto that lifecycle:

- a Zoho payment session is valid for **15 minutes** by default (`expires_in` may be
  set between 300 and 900 seconds);
- there is **no update endpoint** for a Zoho payment session;
- there is **no cancel/delete endpoint** for an unpaid session or a captured payment;
- successful payments are **captured automatically**;
- a session may accumulate several failed payment attempts before one succeeds; and
- the only durable join key between the two systems is the Zoho session/payment
  metadata and `reference_number` created by this provider.

The lifecycle decision therefore has to answer three questions: what is stored in
Medusa, when is a new Zoho session created, and how is a Zoho status translated into a
Medusa status.

## Decision

### Provider session identity and data

`initiatePayment` creates a Zoho session and returns its `payments_session_id` as the
Medusa payment-session `id`. The provider-owned `data` object is:

| Field                      | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `zohoSessionId`            | Zoho `payments_session_id`; also the provider session `id` |
| `checkoutMode`             | `"widget"` or `"hosted"`                                   |
| `amount`                   | Decimal major-unit string formatted for the currency       |
| `currencyCode`             | Uppercase ISO-4217 code                                    |
| `currencySymbol`           | Display symbol used by the widget                          |
| `description`              | Customer-visible description                               |
| `invoiceNumber`            | Invoice number sent to Zoho (max 50 chars)                 |
| `expiresAt`                | Epoch **milliseconds** after which the session is unusable |
| `widget`                   | Publishable widget configuration, widget mode only         |
| `checkoutUrl`              | Hosted checkout URL, hosted mode only                      |
| `medusaSessionId`          | Medusa payment-session ID used for webhook correlation     |
| `paymentId`                | Zoho payment ID after a successful payment                 |
| `paymentStatus`            | Last observed Zoho payment/session status                  |
| `previousZohoSessionIds`   | Superseded sessions created after cart changes             |
| `lastRefundId`             | Most recent Zoho refund ID                                 |
| `lastRefundStatus`         | Most recent Zoho refund status                             |
| `lastRefundIdempotencyKey` | Medusa idempotency key that produced the recorded refund   |

`data` is visible to the storefront. It must never contain the OAuth client secret,
refresh token, access token, or signing key. The widget API key is publishable by
design.

Medusa's Payment Module supplies `data.session_id` (the Medusa payment-session ID) to
the provider. The code reads it as an optional string, uses it as Zoho
`reference_number` (truncated to 50 characters) and as `meta_data.medusa_session_id`,
and preserves it in the returned data. If it is absent, the provider still creates a
usable session but cannot write the webhook bridge; such a session must be reconciled
by polling.

### Creation, reuse, and cart updates

`initiatePayment` reuses the existing Zoho session only when **all** of the following
are true:

- no `paymentId` has been recorded;
- the amount string is identical;
- the currency code is identical;
- the checkout mode is identical; and
- `expiresAt` is more than **60 seconds** in the future.

Otherwise it creates a new Zoho session, appends the old `zohoSessionId` to
`previousZohoSessionIds`, and returns the new data. This protects the customer from a
session that would expire during checkout without creating a new session on every
idempotent call.

`updatePayment` applies the same reuse rule. Once `paymentId` exists, it throws a
`ZohoPaymentStateError` (mapped to Medusa `NOT_ALLOWED`) because the money has already
moved and the session cannot be edited.

`deletePayment` is a documented **local no-op**: it logs and returns the same data.
There is no Zoho API to delete an unpaid session; it expires on its own. It must not
pretend to cancel a payment.

### Expiry normalization

Zoho documents `expiry_time` as seconds, but API responses and sandbox behaviour have
been observed to vary. `normalizeZohoExpiryTime` interprets values greater than
`1_000_000_000_000` as milliseconds and smaller values as seconds, then converts to
milliseconds. When Zoho omits `expiry_time`, the provider uses `now + 900 seconds`.
The client helper treats the recorded `expiresAt` as authoritative for refusing to open
an expired checkout.

### Authorization and status mapping

`authorizePayment` behaves as follows:

1. If `paymentId` is present, retrieve `GET /payments/{id}` and map its status.
2. Otherwise require `zohoSessionId`, then retrieve `GET /paymentsessions/{id}` with
   bounded polling (`pollAttempts`, default 3; `pollIntervalMs`, default 500 ms) until
   a terminal session status is reached or attempts are exhausted.
3. If the session status is `succeeded`, return `CAPTURED` (Zoho auto-captures).
4. Otherwise map the session status with the table below.
5. Record `paymentId` from the first `succeeded` payment, falling back to the first
   payment in the session, so later capture verification and refunds can use it.

| Zoho session status                    | Medusa `PaymentSessionStatus` |
| -------------------------------------- | ----------------------------- |
| `succeeded`                            | `CAPTURED`                    |
| `created`                              | `PENDING`                     |
| `pending`, `in_progress`, `processing` | `PENDING_AUTHORIZATION`       |
| `requires_more`, `requires_action`     | `REQUIRES_MORE`               |
| `failed`                               | `ERROR`                       |
| `expired`, `canceled`, `cancelled`     | `CANCELED`                    |
| anything else                          | `PENDING`                     |

Payment status uses the same defensive mapping, with `refunded`,
`partially_refunded`, and `disputed` treated as `CAPTURED` because the original money
was captured; refund state is tracked separately by Medusa.

`getPaymentStatus` uses the payment resource when `paymentId` exists and the session
resource otherwise. A session with neither ID returns `PENDING` rather than throwing,
because Medusa may ask for status during recovery.

Terminal session statuses are `succeeded`, `failed`, `expired`, and
`canceled`/`cancelled`. A terminal status ends polling. `payment.failed` is **not** a
terminal session signal; see ADR-0004.

## Consequences

### Positive

- Medusa's session ID is returned directly as the provider ID, so admin and storefront
  code can correlate records without an extra mapping table.
- The 60-second safety window prevents opening a checkout that Zoho will reject.
- Cart changes create a new Zoho session without losing the audit trail of prior
  sessions.
- The fallback expiry keeps sessions usable even if Zoho omits `expiry_time`.
- Returning `CAPTURED` for a successful session matches Zoho's auto-capture model and
  avoids a misleading `AUTHORIZED` state that can never be captured later.
- `deletePayment` tells the truth about a missing API instead of silently failing.

### Negative

- Abandoned sessions accumulate in Zoho until they expire; there is no cleanup API.
- A cart update can create several Zoho sessions, which consumes API quota and makes
  reconciliation noisier.
- Webhook correlation depends on `session_id` being injected or on `reference_number`
  being present; older or custom call paths may not supply it.
- A 15-minute checkout window is short for slow payment methods; the storefront must
  handle expiry and restart checkout.
- Polling adds latency to authorization and consumes rate limit.
- Status strings are not a formally published closed enum, so the mapping must remain
  defensive and be revisited if Zoho adds states.

## Alternatives considered

1. **Store only the Zoho session ID and nothing else.** Rejected: the storefront needs
   the amount, currency symbol, description, and widget configuration to open checkout.
2. **Use the Zoho session ID as `reference_number` only.** Rejected: `reference_number`
   is limited to 50 characters and is not guaranteed to be echoed on every webhook
   object; metadata is the primary bridge with a reference fallback.
3. **Create a new Zoho session on every `initiatePayment` call.** Rejected: Medusa may
   call initiation repeatedly for the same cart, producing orphan sessions and
   confusing webhook correlation.
4. **Reuse a session until it expires regardless of amount/currency.** Rejected: the
   customer could be charged the old amount after a cart edit.
5. **Delete the Zoho session in `deletePayment` by calling a cancel endpoint.**
   Rejected: no such endpoint exists.
6. **Return `AUTHORIZED` and rely on `capturePayment`.** Rejected: Zoho captures
   immediately, and a later capture call cannot capture; the truthful state is
   `CAPTURED`.
7. **Treat any `payment.failed` webhook as terminal.** Rejected: Zoho emits it per
   attempt and the session may still succeed.

## References

- Zoho payment session API:
  <https://www.zoho.com/us/payments/api/v1/payment-session/>
- Zoho hosted checkout lifecycle:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/>
- Zoho webhooks best practices:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/best-practices/>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>
- Medusa payment webhook events:
  <https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events>

## Test and verification pointers

- Unit tests with a fake clock cover the 60-second reuse boundary exactly, plus amount,
  currency, mode, and `paymentId` mismatches.
- Tests assert that a superseded session is appended to `previousZohoSessionIds` and
  that data is not mutated in place.
- Expiry tests cover seconds, milliseconds, missing values, and the 900-second fallback.
- Authorization tests cover immediate success, polling until success, polling
  exhaustion, and each status mapping row.
- `updatePayment` after a payment throws a Medusa `NOT_ALLOWED` error.
- `deletePayment` returns the input data and performs no network call.
- A webhook test proves that a session with `paymentId` resolves the payment resource
  rather than the session resource.

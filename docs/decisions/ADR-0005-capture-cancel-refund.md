# ADR-0005: Capture, cancel, and refund semantics

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0003](./ADR-0003-session-lifecycle.md), [ADR-0004](./ADR-0004-webhook-authorization.md), [ADR-0006](./ADR-0006-oauth-retry-policy.md)

## Context

Medusa exposes `capturePayment`, `cancelPayment`, and `refundPayment`, modelled on
providers that separate authorization from capture and allow cancellation before
capture. Zoho Payments does not offer that model:

- successful payments are captured automatically;
- there is no manual capture endpoint and no partial capture;
- there is no cancel endpoint for an unpaid payment session or a captured payment;
- refunds are created against a **payment**, not a session, using
  `POST /payments/{payment_id}/refunds`;
- a refund has its own asynchronous status (`initiated`, `pending`, `succeeded`,
  `failed`, `canceled`);
- Zoho has no idempotency-key header, so retrying a timed-out refund POST can duplicate
  a refund.

The provider must therefore expose Medusa's operations without pretending Zoho has
capabilities it does not have, and without turning an ambiguous network failure into
double movement of money.

## Decision

### Capture is verification, not an action

`capturePayment`:

1. requires `data.paymentId`;
2. retrieves `GET /payments/{payment_id}`;
3. if the payment is captured (`succeeded`, `refunded`, `partially_refunded`,
   `disputed`), returns the existing data with the refreshed `paymentId` and
   `paymentStatus`;
4. if the payment is definitively failed (`failed`, `blocked`), throws a
   `ZohoPaymentStateError` mapped to `NOT_ALLOWED`; and
5. otherwise throws a `ZohoUnsupportedOperationError` explaining that Zoho captures
   automatically and the payment is not captured yet.

It never calls a capture endpoint, because none exists. A successful return is
idempotent: calling capture again re-reads the payment and returns the same state.

### Cancel is honest about the missing API

`cancelPayment`:

- with no `paymentId` returns the input data unchanged (there is nothing remote to
  cancel; the session will expire);
- with a captured payment throws `ZohoUnsupportedOperationError` and directs the
  operator to refund instead;
- with a definitively failed payment returns the input data unchanged; and
- with a pending/uncaptured payment throws `ZohoUnsupportedOperationError`, because
  Zoho has no API to cancel it and waiting for expiry is the only supported path.

The provider does **not** mark a pending session as canceled locally, because that
would diverge from Zoho and could hide a payment that still succeeds.

### Refunds are explicit, partial-capable, and replay-aware

`refundPayment`:

1. requires `data.paymentId` and a strictly positive amount;
2. if the Medusa `context.idempotency_key` matches
   `data.lastRefundIdempotencyKey` and `data.lastRefundId` exists, returns the input
   data without calling Zoho (a local replay guard);
3. resolves the currency from session data, falling back to
   `GET /payments/{id}`;
4. formats the amount as a major-unit decimal string with the currency's ISO fraction
   digits (no floating-point arithmetic);
5. calls `POST /payments/{payment_id}/refunds` with
   `reason: "requested_by_customer"`, `type: "initiated_by_merchant"`, a description,
   and `meta_data.medusa_session_id` when known;
6. if Zoho reports `status: "failed"`, throws a `ZohoPaymentStateError` including the
   failure reason; other statuses (`initiated`, `pending`, `succeeded`, `canceled`) are
   recorded, and `initiated`/`pending` must be reconciled to a terminal state; and
7. stores `lastRefundId`, `lastRefundStatus`, and (when supplied) the idempotency key in
   the payment data.

Partial and full refunds use the same path. Each call creates a new Zoho refund; the
provider does not aggregate refund totals itself. Multiple refunds are allowed as long
as Zoho accepts them.

The local replay guard protects against Medusa re-invoking the same workflow with the
same key after a successful call. It is **not** a provider-side idempotency guarantee:
if the first POST times out after Zoho accepted it, no `lastRefundId` is recorded and a
later retry can create a second refund. Operators must reconcile timed-out refunds with
`GET /refunds/{id}` or `GET /payments/{id}` before retrying.

### Retry rules for state-changing calls

| Operation                     | Retry policy | Behaviour                                                          |
| ----------------------------- | ------------ | ------------------------------------------------------------------ |
| `GET` session/payment/refund  | safe         | Retry network errors, 429, and 5xx with exponential backoff        |
| `POST /paymentsessions`       | safe         | Retry network errors, 429, and 5xx; an orphan session expires      |
| `POST /payments/{id}/refunds` | none         | Retry only an explicit 429; never retry a timeout or ambiguous 5xx |

The refund policy is deliberately stricter than the transport's general safe policy.
A 5xx response or socket timeout does not prove Zoho rejected the request. The current
implementation surfaces those errors; a future change may retry 5xx only if Zoho
documents that the request was rejected before side effects.

### Operation matrix

| Medusa operation  | Zoho call                     | Result when successful         |
| ----------------- | ----------------------------- | ------------------------------ |
| Capture           | `GET /payments/{id}`          | Existing captured payment data |
| Cancel (no pay)   | none                          | Input data; session expires    |
| Cancel (pending)  | none                          | `NOT_ALLOWED`; wait for expiry |
| Cancel (captured) | none                          | `NOT_ALLOWED`; refund instead  |
| Refund (full)     | `POST /payments/{id}/refunds` | Refund ID and status           |
| Refund (partial)  | `POST /payments/{id}/refunds` | Refund ID and status           |

## Consequences

### Positive

- Medusa's admin can place and refund orders without the provider lying about capture
  or cancellation.
- Capture is safe to retry and never creates a second charge.
- Refund amounts are formatted with the correct currency precision, including
  zero-decimal and three-decimal currencies.
- Timeouts on refunds do not silently retry and double-refund.
- The local replay guard handles the common Medusa workflow retry.
- Failed refunds surface Zoho's `failure_reason` instead of appearing successful.

### Negative

- Medusa may show a payment as "authorized" briefly while Zoho already captured it;
  the provider reports `CAPTURED` on the next status check.
- Pending payments cannot be canceled; operators must wait for expiry, which is
  confusing in admin.
- A refund that times out may have succeeded at Zoho but appear failed in Medusa until
  reconciled.
- The local replay guard is process-local data, not a distributed idempotency store; a
  crash between Zoho's response and Medusa's save can still duplicate a refund.
- Refund status is initially whatever Zoho returns; asynchronous settlement requires
  polling.
- `refund.*` webhooks are not mapped to Medusa, so there is no automatic refund-status
  update.

## Alternatives considered

1. **Pretend to capture and return success without checking Zoho.** Rejected: it would
   mark an unpaid order as paid.
2. **Cancel a pending payment by refunding it.** Rejected: there is no captured money
   to refund, and the refund call would fail.
3. **Mark pending sessions canceled locally.** Rejected: the customer may still pay
   before Zoho expires the session.
4. **Require full refunds only.** Rejected: Medusa and Zoho both support partial
   refunds; restricting them would be an artificial limitation.
5. **Send a client-generated idempotency header to Zoho.** Rejected: Zoho has no such
   header; sending an unknown header provides no guarantee.
6. **Retry refund POSTs after timeouts.** Rejected: the request may already have
   succeeded.
7. **Aggregate refund totals in provider data.** Rejected: Medusa already owns refund
   accounting; duplicating it creates a second source of truth.

## References

- Zoho refunds API:
  <https://www.zoho.com/us/payments/api/v1/refunds/>
- Zoho payments API:
  <https://www.zoho.com/us/payments/api/v1/payments/>
- Zoho payment session API (auto-capture context):
  <https://www.zoho.com/us/payments/api/v1/payment-session/>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>
- Medusa payment module guide:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider>

## Test and verification pointers

- Capture tests: captured, refunded, partially refunded, disputed, failed, blocked, and
  uncaptured payment statuses; repeated capture is idempotent.
- Cancel tests: no payment ID, failed payment, pending payment, and captured payment.
- Refund tests: full, partial, multiple sequential refunds, zero/negative amount, missing
  payment ID, failed refund with and without `failure_reason`.
- Currency formatting tests: INR/USD (2 digits), JPY (0), KWD (3), invalid code.
- Idempotency test: same key and existing refund returns without a network call;
  different key calls Zoho.
- Timeout test: refund POST rejects without a second attempt; 429 retries; 5xx does not.
- Data test: `lastRefundId`, `lastRefundStatus`, and `lastRefundIdempotencyKey` are
  persisted and never leak into logs.
- Manual sandbox test: refund a captured payment and confirm `GET /refunds/{id}` reaches
  a terminal status.

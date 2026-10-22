# ADR-0004: Webhook authorization and event mapping

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0007](./ADR-0007-signature-verification.md), [ADR-0003](./ADR-0003-session-lifecycle.md), [Architecture](../architecture.md)

## Context

Zoho sends webhooks for payment, refund, payment-link, and payout events. The delivery
contract is at-least-once, retries failed deliveries for up to two days with
exponential backoff, and disables an endpoint after a prolonged failure. Zoho requires
a prompt 2xx response (within 15 seconds) and recommends acknowledging before doing
expensive work.

Medusa exposes a single payment webhook route,
`/hooks/payment/[identifier]_[id]`, which delegates to the provider's
`getWebhookActionAndData`. In the supported Medusa versions, the route acknowledges the
HTTP request before the provider handler has finished. That has two consequences:

1. the provider cannot rely on returning a non-2xx status to make Zoho retry; and
2. a bad signature must be rejected by the provider handler itself, not by a
   route-level guard that assumes the request is still open.

The webhook is also the only server-to-server signal that can complete a cart when the
customer closes the browser or the return URL is lost. It must be safe against
forgery, replay, cross-account delivery, and test/live confusion.

## Decision

### Verify before reading

`getWebhookActionAndData` performs these steps in order:

1. Require a configured `signingKey`; if missing, throw a validation error. There is no
   "skip verification in development" switch.
2. Extract `X-Zoho-Webhook-Signature` case-insensitively. Accept `t=<timestamp>` and
   `v=<hex>` (the parser also accepts `v1` as an alias).
3. Verify `HMAC-SHA256(signingKey, "${t}.${rawBody}")` against `v` in constant time.
4. If `webhookToleranceSeconds` is greater than zero, reject timestamps whose absolute
   age exceeds the tolerance. The default is `0` (disabled), because Zoho's documented
   retry window can legitimately deliver older events after an outage. Merchants that
   enable it should use a value that covers their retry expectations, typically 300
   seconds for live traffic.
5. Only after the signature succeeds, parse the **verified raw body** as JSON and
   validate that `event_type` is a non-empty string. The separately supplied parsed
   `payload.data` is never used for mapping.

Re-serializing an object body would change whitespace and key order and break the HMAC,
so the handler requires the exact `string`/`Buffer` bytes.

### Validate the event's origin

After parsing, the handler rejects events that carry an `account_id` different from
the configured Zoho account. If `liveMode` is configured and the event carries a
`live_mode` value, the two must match. These checks prevent a valid signature from a
different account or from test mode being applied to live data.

### Resolve the Medusa session

The handler extracts the Medusa payment-session ID from the payment object:

- `meta_data` entry `medusa_session_id`; or
- `reference_number` as a fallback.

If neither is present, the event is acknowledged with
`PaymentActions.NOT_SUPPORTED` and logged at debug level. This is deliberate: an event
that cannot be tied to a Medusa session must not be guessed into one.

### Map events to Medusa actions

| Zoho event                             | Medusa action           | Notes                                                    |
| -------------------------------------- | ----------------------- | -------------------------------------------------------- |
| `payment.succeeded`, `payment.success` | `SUCCESSFUL`            | Zoho uses both spellings in different docs/regions       |
| `payment.pending`                      | `PENDING_AUTHORIZATION` | Customer action or asynchronous method still in progress |
| `payment.failed`                       | Reconciled; see below   | Emitted per attempt, not per session                     |
| `refund.succeeded`, `refund.failed`    | `NOT_SUPPORTED`         | Medusa refunds are recorded from the admin action        |
| `payment_link.*`, `payout.*`           | `NOT_SUPPORTED`         | Outside this provider's scope                            |
| anything else                          | `NOT_SUPPORTED`         | Logged at debug level                                    |

The action result contains `session_id` and `amount` as a `BigNumber` built from Zoho's
decimal amount string. If the session ID or amount is missing, the result is
`NOT_SUPPORTED`.

### `payment.failed` is reconciled, never trusted blindly

A failed attempt does not end a Zoho session. The handler retrieves
`GET /paymentsessions/{zohoSessionId}` and decides:

- session `succeeded` → `SUCCESSFUL` (the payment won on a later attempt);
- session terminal (`failed`, `expired`, `canceled`) → `FAILED`;
- session still open → `PENDING_AUTHORIZATION`.

If the event has no Zoho session ID, the handler keeps the Medusa session open and
returns `PENDING_AUTHORIZATION`; it never fails a payment on an unattributable event.

### Duplicates and side effects

The handler is read-only apart from the reconciliation lookup. Duplicate deliveries
therefore produce the same action, and Medusa's payment workflow applies the state
transition. The provider does not persist `event_id`; duplicate handling relies on the
workflow's state checks rather than a second dedupe layer. A future durable event store
would be a new ADR.

### Acknowledged-but-rejected events

Because the route has already acknowledged the HTTP request, a thrown verification or
validation error does not cause Zoho to retry. Medusa's event bus may retry the provider
call up to `webhook_retries` (default 3), but Zoho will not re-deliver after its 200. The
provider treats a rejection as a security event: it throws a typed error, logs the
reason without the body or signature, and relies on application monitoring. Merchants
must alert on `ZOHO_WEBHOOK_VERIFICATION_ERROR` and on `NOT_SUPPORTED` rates for expected
events. They should also reconcile suspicious payments with `GET /payments/{id}`.

## Consequences

### Positive

- Forged or tampered events cannot change payment state.
- Cross-account and test/live events are rejected even when correctly signed.
- Per-attempt failures no longer produce false terminal failures.
- Missing correlation data degrades to a no-op instead of a wrong order.
- The handler has no write side effects, so duplicate delivery is cheap.
- Mapping is explicit and easy to extend with a new event.

### Negative

- A rejected signature may be invisible to Zoho because the route already returned
  200; monitoring is mandatory.
- Disabling timestamp tolerance by default leaves a replay window, bounded in practice
  by the signature and the narrow event semantics.
- Refund and payout events are acknowledged but ignored; refund reconciliation needs a
  separate poll or admin workflow.
- The handler performs a synchronous Zoho API call for `payment.failed`, adding latency
  to a webhook that has already been acknowledged but still runs in the application.
- The mapping accepts two spellings of success and several undocumented statuses,
  which can hide upstream enum drift if not monitored.

## Alternatives considered

1. **Verify in a Medusa middleware or the route handler.** Rejected: the provider does
   not own the route, and the route's acknowledgement timing makes route-level
   rejection unreliable.
2. **Parse JSON, then verify a canonical serialization.** Rejected: canonicalization is
   not stable across runtimes and would reject valid Zoho deliveries.
3. **Trust `reference_number` alone.** Rejected: it is optional, limited to 50
   characters, and not present on every event object.
4. **Fail the payment on every `payment.failed`.** Rejected: Zoho emits it per attempt.
5. **Use the webhook to mark refunds in Medusa.** Rejected: Medusa's provider webhook
   action has no refund action, and creating a second refund record outside the admin
   workflow would corrupt totals.
6. **Store `event_id` in the payment data.** Rejected for now: payment data is public,
   and a bounded set of IDs would grow unbounded; a dedicated store is the right future
   design.
7. **Skip account/live-mode checks because the signature is valid.** Rejected: a
   signing key can be shared across accounts or environments during migration.

## References

- Zoho webhook verification:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/verification/>
- Zoho webhook configuration and retry policy:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/configure/>
- Zoho webhook best practices:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/best-practices/>
- Zoho webhook events:
  <https://www.zoho.com/us/payments/api/v1/webhooks-events/>
- Medusa payment webhook events:
  <https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events>
- Medusa payment module options (`webhook_delay`, `webhook_retries`):
  <https://docs.medusajs.com/resources/commerce-modules/payment/module-options>

## Test and verification pointers

- Known-vector tests for valid, tampered-body, wrong-key, missing-header, malformed
  header, and non-hex signatures.
- Tolerance tests with an injected clock: inside, outside, zero/disabled, and future
  timestamps.
- Account mismatch and live/test mismatch both throw `ZOHO_VALIDATION_ERROR`.
- Event mapping table tests for every supported and unsupported event, including
  `payment.success`.
- `payment.failed` tests: succeeded session, terminal session, open session, and missing
  Zoho session ID.
- Missing Medusa session ID returns `NOT_SUPPORTED` and performs no write.
- Missing `signingKey` throws before body parsing.
- Integration test posts to `/hooks/payment/zoho_zoho` with a valid signature and
  asserts the resulting Medusa action.
- A load test or log assertion confirms that request bodies, signatures, and tokens are
  never logged.

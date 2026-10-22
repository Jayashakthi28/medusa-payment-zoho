# Webhooks

Zoho webhooks are the asynchronous backstop for payments that complete after the
browser has moved on: closed tabs, dropped redirects, ACH settlement, or a storefront
that never calls `cart.complete()`. They are also the only server-to-server signal that
can resolve a payment when the customer never returns.

This provider verifies the `X-Zoho-Webhook-Signature` header over the **exact raw body**
and parses the event from those same verified bytes. It never maps a separately supplied
parsed body. It also requires `account_id` to match the configured account, requires
`live_mode` when `liveMode` is configured, validates the payment amount/currency, and
then maps the event to a Medusa payment action.

- **Endpoint:** `POST https://<your-medusa-backend>/hooks/payment/zoho_zoho`
- **Provider ID:** `pp_zoho_zoho`
- **Minimum events:** `payment.succeeded`, `payment.pending`, `payment.failed`
- **Signing key option:** `signingKey`

Medusa 2.21.2 and later also accept
`/hooks/payment/pp_zoho_zoho`. Use the unprefixed form; it works across the supported
Medusa range.

## 1. Register the webhook in Zoho

1. Sign in to Zoho Payments with an Account Owner or Admin user.
2. Open **Settings → Developer Space → Webhooks**.
3. Add an endpoint with the URL above.
4. Select at least:
   - `payment.succeeded`
   - `payment.pending`
   - `payment.failed`
5. Copy the **signing key** from Developer Space into
   `ZOHO_PAYMENTS_SIGNING_KEY` on the Medusa server. The same key verifies webhooks,
   widget responses, and hosted-checkout returns.
6. Save. Zoho sends a test ping to the URL; the endpoint must be publicly reachable over
   HTTPS and answer promptly.

Notes:

- Zoho allows up to five webhook endpoints per account.
- Registration pings the URL once, so a local-only or firewalled backend will fail
  registration.
- Webhooks are configured per Zoho account, not per Medusa region. If you run separate
  test and live accounts, configure each separately.
- Refund events are not required. If you enable `refund.succeeded` or `refund.failed`,
  the provider acknowledges them as `NOT_SUPPORTED`; see
  [Refund events](#8-refund-and-other-events).

## 2. Event envelope

A delivery looks like this (illustrative values):

```json
{
  "event_id": "evt_01J...",
  "event_type": "payment.succeeded",
  "account_id": "60000000001",
  "live_mode": true,
  "event_time": 1760000000000,
  "event_object": {
    "payment": {
      "payment_id": "pay_01J...",
      "payments_session_id": "sess_01J...",
      "amount": "1499.00",
      "currency": "INR",
      "status": "succeeded",
      "reference_number": "payses_01J...",
      "meta_data": [
        {
          "key": "medusa_session_id",
          "value": "payses_01J..."
        }
      ]
    }
  }
}
```

The exact payload is Zoho’s contract; the provider only trusts fields after signature
verification. The important correlation fields are:

- `event_object.payment.meta_data` entry `medusa_session_id`; or
- `event_object.payment.reference_number` as a fallback.

Both are written by the provider when the Zoho session is created. If neither is
present, the event is acknowledged as `NOT_SUPPORTED` rather than guessed into a Medusa
session.

## 3. Signature verification

The handler performs these steps in order:

1. Require a configured `signingKey`. Missing key → fail closed.
2. Read `X-Zoho-Webhook-Signature` case-insensitively. The value is
   `t=<epoch-ms>,v=<hex>`; `v1` is accepted as an alias for `v`.
3. Compute `HMAC-SHA256(signingKey, "${t}.${rawBody}")` and compare in constant time.
4. If `webhookToleranceSeconds > 0`, reject events whose absolute age exceeds the
   tolerance.
5. Only then parse the JSON body and require a non-empty `event_type`.
6. Reject an `account_id` that differs from the configured `accountId`.
7. If `liveMode` is configured and the event carries `live_mode`, require equality.
8. Map the event to a Medusa action.

The raw body is never re-serialized. Middleware that parses JSON and hands the provider
a reconstructed object will break valid signatures. Medusa’s payment route passes the
raw body through; custom ingress proxies must preserve it too.

The timestamp is in **milliseconds**. The default tolerance is `0` (disabled) because
Zoho’s documented retry window can deliver older events after an outage. If you enable
it, choose a value that covers your retry expectations; `300` seconds is a common live
setting.

## 4. Event mapping

| Zoho event                          | Medusa action           | Effect                                                                             |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `payment.succeeded`                 | `SUCCESSFUL`            | Session becomes captured; Medusa completes the cart if not completed.              |
| `payment.success`                   | `SUCCESSFUL`            | Alias used in some Zoho docs/regions.                                              |
| `payment.pending`                   | `PENDING_AUTHORIZATION` | Keeps the session open; Medusa 2.22 ignores this action in the webhook subscriber. |
| `payment.failed`                    | Reconciled per attempt  | FAILED only when the session is terminal; 2.22 ignores FAILED.                     |
| `refund.succeeded`, `refund.failed` | `NOT_SUPPORTED`         | Reconcile refunds with `retrieveRefund`.                                           |
| `payment_link.*`, `payout.*`        | `NOT_SUPPORTED`         | Outside this provider’s scope.                                                     |
| Anything else                       | `NOT_SUPPORTED`         | Logged at debug level.                                                             |

The action data carries `session_id` (the **Medusa** payment-session ID) and `amount`
as a `BigNumber`. Successful events must have a strictly positive, finite amount;
other events may carry zero but never a negative or non-finite amount. Medusa’s
`processPaymentWorkflow` applies the supported transitions and completes the cart if
needed.

## 5. `payment.failed` is per attempt

This is the most important semantic difference from providers that emit one failure per
payment:

- Zoho emits `payment.failed` **for each failed attempt**.
- The Zoho session can remain open, and a later attempt in the same session can succeed.
- Therefore the provider does not fail the Medusa session immediately.

On `payment.failed`, the handler:

1. reads the Zoho payment-session ID from the payment payload when Zoho provides it;
2. retrieves the current Zoho session;
3. if the session is `succeeded` → returns `SUCCESSFUL`;
4. if the session is terminal (`failed`, `expired`, `canceled`, `cancelled`) → returns
   `FAILED`;
5. otherwise → returns `PENDING_AUTHORIZATION`, keeping the Medusa session open.

If the event has no Zoho session ID, the handler logs a warning and returns
`PENDING_AUTHORIZATION` rather than failing a session that might still succeed. The
official `payment.*` samples do not always include `payments_session_id`; the Medusa
session bridge is carried in `reference_number` and `meta_data.medusa_session_id`.

**Medusa 2.22 caveat:** the stock payment webhook subscriber ignores `FAILED`,
`PENDING`, `REQUIRES_MORE`, `CANCELED`, and `PENDING_AUTHORIZATION` actions. A terminal
`FAILED` action from this provider is therefore acknowledged but does not mutate the
Medusa session in 2.22. The session remains available for reconciliation or a new
checkout attempt; it is not silently treated as paid.

This means a customer can fail a card attempt and retry with UPI in the same session
without losing the order. Only a terminal session failure marks the Medusa session
failed.

## 6. Duplicate delivery and ordering

Zoho delivers **at least once**. Duplicates, late deliveries, and out-of-order events
are expected.

- The handler is read-only apart from the `payment.failed` reconciliation lookup.
- Duplicate `payment.succeeded` events map to the same action; Medusa’s workflow owns
  the idempotent state transition.
- There is no durable `event_id` store in v1. If you need strict deduplication for
  side effects outside Medusa, store `event_id` in your own system.
- A late `payment.pending` after a successful capture does not undo the capture; Medusa
  applies the workflow’s transition rules.
- Zoho recommends logging `event_id`; the provider logs the event type and relevant
  identifiers, not the raw body.

## 7. Retries and Medusa’s asynchronous route

Zoho retry behaviour:

- Failed deliveries are retried for **up to two days** with exponential backoff.
- Failure emails are sent after roughly six hours and one day.
- After the retry window, the endpoint is disabled and the merchant is emailed.
- Zoho asks for a response within **15 seconds** and recommends acknowledging before
  expensive work.

Medusa route behaviour:

- Medusa’s `/hooks/payment/[identifier]_[id]` route acknowledges the HTTP request
  **before** the provider handler finishes.
- Therefore a bad signature or a provider exception does **not** produce a non-2xx
  response that would make Zoho retry. Zoho has already received its 200.
- The Payment Module’s own `webhook_delay` (default `5000` ms) and `webhook_retries`
  (default `3`) are application-level retries. They do not make an invalid signature
  acceptable and do not replace Zoho’s delivery retries.

Operational consequence: **monitor rejected webhooks**. Because the route has already
returned 200, a rejected event is only visible in your logs/alerting. Alert on
`ZOHO_WEBHOOK_VERIFICATION_ERROR`, on unexpected `NOT_SUPPORTED` results for
`payment.*`, and on a spike in authentication errors.

If you need Medusa to return non-2xx for rejected events, add a custom route in front of
the payment route with your own raw-body verification, and forward only verified events.
Do not remove the provider’s verification.

## 8. Refund and other events

Refund events are acknowledged but return `NOT_SUPPORTED`:

- `refund.succeeded`
- `refund.failed`

Medusa records refunds from the Admin action, and Zoho’s refund status is asynchronous.
Reconcile with `GET /refunds/{refund_id}` using the exported `ZohoPaymentsClient` or
your own job. Do not expect a refund webhook to change the Medusa refund state.

`payment_link.*` and `payout.*` are also out of scope and return `NOT_SUPPORTED`.

## 9. Testing with curl and HMAC

You need the signing key and a raw JSON body. Compute the signature over
`<timestamp>.<body>` and send both exactly as computed.

```bash
export ZOHO_PAYMENTS_SIGNING_KEY="your-developer-space-signing-key"

BODY='{"event_type":"payment.succeeded","account_id":"60000000001","live_mode":false,"event_object":{"payment":{"payment_id":"pay_test_1","payments_session_id":"sess_test_1","amount":"1499.00","currency":"INR","status":"succeeded","reference_number":"payses_test_1","meta_data":[{"key":"medusa_session_id","value":"payses_test_1"}]}}}'

TS="$(node -e 'process.stdout.write(String(Date.now()))')"

SIG="$(
  BODY="$BODY" TS="$TS" node -e '
    const { createHmac } = require("node:crypto")
    const message = `${process.env.TS}.${process.env.BODY}`
    process.stdout.write(
      createHmac("sha256", process.env.ZOHO_PAYMENTS_SIGNING_KEY)
        .update(message, "utf8")
        .digest("hex")
    )
  '
)"

curl -i -X POST "http://localhost:9000/hooks/payment/zoho_zoho" \
  -H "Content-Type: application/json" \
  -H "X-Zoho-Webhook-Signature: t=$TS,v=$SIG" \
  --data-binary "$BODY"
```

Notes:

- `--data-binary` preserves the exact body. Do not use a shell here-string or a JSON
  formatter between signing and sending.
- A valid signature with a fabricated `medusa_session_id` still produces a
  `SUCCESSFUL` action; Medusa then cannot find the matching session and logs an error.
  Use a real payment-session ID to test order effects.
- In local development, Medusa may return 200 even for a bad signature because the route
  acknowledges early. Check the backend logs for
  `ZOHO_WEBHOOK_VERIFICATION_ERROR` or `Zoho process webhook failed`.

To test rejection, change one byte of the body after computing the signature, or use a
different key:

```bash
curl -i -X POST "http://localhost:9000/hooks/payment/zoho_zoho" \
  -H "Content-Type: application/json" \
  -H "X-Zoho-Webhook-Signature: t=$TS,v=deadbeef" \
  --data-binary "$BODY"
```

Expected: no action is applied, and the backend logs a verification failure. The HTTP
response may still be 200 because of Medusa’s early acknowledgement.

You can test the verifier directly without a running Medusa:

```ts
import { isValidZohoWebhookSignature } from "medusa-payment-zoho/server"

const valid = isValidZohoWebhookSignature(
  {
    rawBody: BODY,
    signatureHeader: `t=${TS},v=${SIG}`,
  },
  process.env.ZOHO_PAYMENTS_SIGNING_KEY!
)
```

## 10. Security checklist

- [ ] The endpoint is HTTPS and publicly reachable from Zoho.
- [ ] `signingKey` is configured and stored only on the server.
- [ ] The raw body reaches the provider unmodified by proxies or body parsers.
- [ ] `liveMode` is set for production so test events cannot complete live orders.
- [ ] The configured `accountId` matches the webhook’s `account_id`.
- [ ] Invalid signatures are logged and alerted, not silently ignored.
- [ ] A reconciliation job covers lost events: retrieve sessions/payments by ID.
- [ ] Replays are acceptable because the handler is read-only and Medusa applies the
      transition idempotently; add `event_id` storage only for external side effects.
- [ ] Refund status is reconciled separately; refund webhooks are not mapped.

## 11. Related documentation

- [Signatures](./signatures.md)
- [Architecture: webhook completion](./architecture.md#6-webhook-completion)
- [ADR-0004: webhook authorization](./decisions/ADR-0004-webhook-authorization.md)
- [Medusa payment webhook events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events)
- [Zoho webhook configuration](https://www.zoho.com/us/payments/developerdocs/webhooks/configure/)
- [Zoho webhook verification](https://www.zoho.com/us/payments/developerdocs/webhooks/verification/)
- [Zoho webhook best practices](https://www.zoho.com/us/payments/developerdocs/webhooks/best-practices/)

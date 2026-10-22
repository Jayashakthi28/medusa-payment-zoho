# Zoho Payments API research

- **Date:** 2026-10-23
- **Status:** Research note for the `medusa-payment-zoho` implementation
- **Method:** Official Zoho Payments API and developer documentation, reviewed against
  the provider code in `src/core` and `src/providers/zoho`. No live merchant
  credentials were used. Summaries only; the linked pages remain the source of truth.

## 1. What Zoho Payments is

Zoho Payments is a REST payment gateway with an **account-scoped** resource model.
A merchant account is identified by an `account_id`, and every API call carries it as a
query parameter. The API root differs by data centre:

| Region | API root                           | Accounts (OAuth) root       | Hosted checkout base                       | Widget domain |
| ------ | ---------------------------------- | --------------------------- | ------------------------------------------ | ------------- |
| India  | `https://payments.zoho.in/api/v1`  | `https://accounts.zoho.in`  | `https://payments.zoho.in/hostedcheckout`  | `IN`          |
| US     | `https://payments.zoho.com/api/v1` | `https://accounts.zoho.com` | `https://payments.zoho.com/hostedcheckout` | `US`          |

India is the default for this package. The account, OAuth client, and data centre must
belong to the same region; a token minted in one data centre will not work against the
other.

Zoho also exposes customers, payment methods, payment links, payouts, and direct
payment-creation APIs. This package deliberately uses only the session, payment,
refund, and webhook surfaces needed by a Medusa checkout.

## 2. Authentication and scopes

- OAuth client type **ORG** in the Zoho API console. A one-time authorization code
  produces an access token and a long-lived refresh token.
- Access tokens are sent as `Authorization: Zoho-oauthtoken <token>` and typically last
  one hour.
- Refresh-token exchange is `POST {accountsBaseUrl}/oauth/v2/token` with
  `grant_type=refresh_token`, form-encoded.
- A user can hold up to 20 refresh tokens; the oldest is removed beyond that.
- Only an Account Owner or Admin can generate an org token.

Scopes required by this package:

| Scope                     | Used for                              |
| ------------------------- | ------------------------------------- |
| `ZohoPay.payments.CREATE` | `POST /paymentsessions`               |
| `ZohoPay.payments.READ`   | session and payment retrieval         |
| `ZohoPay.refunds.CREATE`  | `POST /payments/{payment_id}/refunds` |
| `ZohoPay.refunds.READ`    | `GET /refunds/{refund_id}`            |

Webhooks are configured manually in **Settings → Developer Space → Webhooks**, so
webhook-management scopes are not required. `ZohoPay.payments.UPDATE` is not needed
because Zoho has no payment-session update endpoint.

## 3. API surface used by the provider

| Method | Path                               | Scope             | Purpose                               |
| ------ | ---------------------------------- | ----------------- | ------------------------------------- |
| POST   | `/paymentsessions`                 | `payments.CREATE` | Create a checkout session             |
| GET    | `/paymentsessions/{id}`            | `payments.READ`   | Retrieve session status and payments  |
| GET    | `/payments/{id}`                   | `payments.READ`   | Verify capture and read refund totals |
| POST   | `/payments/{payment_id}/refunds`   | `refunds.CREATE`  | Full or partial refund                |
| GET    | `/refunds/{id}`                    | `refunds.READ`    | Refund status reconciliation          |
| —      | Webhooks (configured in dashboard) | —                 | Asynchronous payment outcome          |

Every request adds `account_id`. Responses use an envelope such as
`{ code: 0, message: "success", payments_session: { … } }`; the client unwraps the
resource and validates required fields before returning it.

## 4. Payment sessions

### Creation

`POST /paymentsessions` accepts:

- `amount` — required; Zoho documents a `double` request value and returns a string in
  major units (for example `"100.50"`). The provider validates and formats the decimal
  with the currency's ISO fraction digits, then sends it as a JSON number to match the
  request schema.
- `currency` — required, three-letter ISO-4217 code.
- `expires_in` — optional; **300–900 seconds**, default **900** (15 minutes).
- `description` — required, up to 500 characters.
- `invoice_number` — optional, up to 50 characters.
- `reference_number` — optional, up to 50 characters.
- `meta_data` — optional array of key/value entries, **maximum 5**.
- `max_retry_count` — optional, 1–5 attempts.
- `configurations` — payment-method allow-list, card options, and hosted-checkout
  parameters.

The response includes `payments_session_id`, `currency`, `amount`, `created_time`
(milliseconds), `expiry_time` (documented as seconds), `access_key` (hosted checkout),
`status`, `payments[]`, and the submitted metadata/configuration. The provider treats
`expiry_time` defensively because second/millisecond representations have varied.

### Lifecycle constraints

- A session is valid for **15 minutes** by default; the maximum configurable lifetime is
  also 15 minutes.
- There is **no update endpoint**. A changed cart requires a new session.
- There is **no cancel/delete endpoint**. An unpaid session expires on its own.
- A successful payment closes the session; no further attempts are allowed.
- `payment.failed` is emitted **per failed attempt**, not once per session. A later
  attempt in the same session can still succeed.
- `payments[]` on the session lists attempts and their payment IDs; the provider picks
  the succeeded payment, falling back to the first entry.

### Statuses observed

Zoho's docs and responses use a mix of statuses. The provider normalizes a defensive
superset:

- session: `created`, `pending`, `in_progress`, `processing`, `requires_more`,
  `requires_action`, `succeeded`, `failed`, `expired`, `canceled`/`cancelled`;
- payment: `initiated`, `pending`, `incomplete`, `processing`, `succeeded`,
  `refunded`, `partially_refunded`, `disputed`, `failed`, `blocked`,
  `canceled`/`cancelled`.

The mapping is documented in [ADR-0003](../decisions/ADR-0003-session-lifecycle.md).
Any unknown value maps to `PENDING`, never to success.

## 5. Payments and capture

`GET /payments/{payment_id}` returns the payment resource: amount, currency, status,
`payments_session_id`, `reference_number`, `amount_captured`, `amount_refunded`,
payment-method details, failure code/category, and metadata.

The critical difference from Stripe-style providers:

- **Zoho captures successful payments automatically.**
- There is **no PaymentIntent** and **no manual capture** operation.
- There is no partial capture and no cancel API for a captured payment.
- `succeeded` means the money was captured; `refunded` and `partially_refunded` still
  mean the original capture happened.

The provider's `capturePayment` therefore verifies the existing payment instead of
performing a capture. See [ADR-0005](../decisions/ADR-0005-capture-cancel-refund.md).

## 6. Checkout modes

### Embedded Checkout Widget

- Script: `https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js`.
- Instantiate `new ZPayments({ account_id, domain: "IN" | "US", otherOptions: { api_key } })`.
- Call `requestPaymentMethod` with `amount`, `transaction_type: "payment"`,
  `currency_code`, `payments_session_id`, `currency_symbol`, `description`, optional
  `invoice_number`, and optional customer `address`.
- The response contains `payment_id` and, when a signing key exists, `signature`.
- The API key is publishable. The signing key and OAuth credentials are not.
- Widget availability and payment methods depend on the account, region, and Zoho
  enablement (cards, UPI, ACH, etc.).

### Hosted Checkout

- Add `configurations.hosted_checkout_parameters` with required `success_url` and
  `failure_url`; optional `email`, `phone`, `description`, and `udf1`–`udf5`.
- Redirect to `{hostedCheckoutBaseUrl}/{access_key}`.
- Zoho redirects to success or failure with
  `payments_session_id`, `payment_session_status`, optional `payment_id`,
  `payment_status`, `amount`, `udf1`–`udf5`, and `signature`.
- ACH payments may redirect with `in_progress` before settlement. The return URL is not
  proof of final success; webhooks or a session retrieval are required.
- If the customer closes the browser, `payment_id` may be absent; retrieve the session
  by ID instead.

## 7. Signature schemes

All three use HMAC-SHA256 with the merchant signing key and lowercase hex output.

| Flow              | Signed message                                                                                                                                   | Transport                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Webhook           | `${t}.${rawBody}`                                                                                                                                | `X-Zoho-Webhook-Signature: t=…,v=…` |
| Widget response   | `${payment_id}\|${payment_session_id}`                                                                                                           | `signature` field                   |
| Hosted return URL | `payments_session_id.payment_session_status.payment_id.payment_status.amount.mandate_id.udf1.udf2.udf3.udf4.udf5` (India; US omits `mandate_id`) | `signature` query parameter         |

Rules that matter in implementation:

- verify the **exact raw webhook body**, never a re-serialized JSON object;
- treat the header name case-insensitively;
- use an empty string for absent optional hosted fields;
- include `mandate_id` between `amount` and `udf1` for India returns (US docs omit it; the verifier accepts both layouts);
- verify on the server, with constant-time comparison; and
- never expose the signing key to the browser.

Details and test vectors are in [ADR-0007](../decisions/ADR-0007-signature-verification.md).

## 8. Webhooks

- Configured manually in **Settings → Developer Space → Webhooks**; up to five
  endpoints per account. Registration pings the URL once, so it must be publicly
  reachable.
- Delivery is **at-least-once**; duplicates are expected. Zoho recommends logging
  `event_id` and deduplicating.
- Failures are retried for **up to two days** with exponential backoff; after that the
  endpoint is disabled and the merchant is emailed. Failure emails are also sent after
  six hours and one day.
- The endpoint must return `200` promptly (Zoho asks for a response within 15 seconds)
  before doing expensive work.
- Events observed in the docs: `payment.succeeded`, `payment.pending`,
  `payment.failed`, `refund.succeeded`, `refund.failed`, `payment_link.paid`,
  `payment_link.expired`, `payment_link.canceled`, `payout.initiated`, `payout.paid`,
  `payout.failed`. Hosted-checkout docs also refer to `payment.success`.
- The envelope carries `event_type`, `account_id`, `live_mode`, `event_time`,
  `event_id`, and an `event_object` with `payment`, `refund`, `payment_links`, or
  `payout`.
- `payment.failed` must be reconciled against the session before failing an order.
- A valid signature is necessary but not sufficient: check the account and live/test
  mode too.

The provider's mapping and rejection rules are in
[ADR-0004](../decisions/ADR-0004-webhook-authorization.md).

## 9. Rates, errors, and idempotency

- Documented limits include 600 requests/minute for customers, payment methods, and
  payments, and **60 requests/minute for refunds**. Exceeding them returns `429`.
- Error responses carry `code` and `message`; the transport records the HTTP status,
  Zoho code, and request ID. `429` and `5xx` are retryable for safe calls.
- **There is no idempotency-key header.** A timed-out refund POST can have succeeded;
  the provider does not blindly retry it.
- `401` means the access token is missing/expired/invalid; the client invalidates its
  cache and retries once.
- Access-token and refresh-token failures are surfaced as typed authentication errors;
  invalid credentials are not retried.

## 10. Implications for this package

1. The Medusa payment-session ID must travel with the Zoho session in both
   `reference_number` and `meta_data.medusa_session_id`; webhooks have no other reliable
   join key.
2. A cart edit must create a new session, not mutate the old one.
3. `authorizePayment` must poll briefly because the widget can return before the
   session's status is final.
4. `capturePayment` must verify, not capture.
5. Refunds must be explicit, partial-capable, and never retried on ambiguous failures.
6. Webhook verification must happen before reading any field, and the route's early
   200 means monitoring is the safety net.
7. The 15-minute session lifetime must be visible to the storefront so it can restart
   checkout instead of showing a broken widget.

## 11. Open questions to verify in a sandbox

- Exact session status enum and `expiry_time` unit per region and API version.
- Whether Developer Space widget signing keys and webhook signing keys are always the
  same value; the package currently assumes one `signingKey`.
- Refund webhook payload shape and whether it always includes the payment object.
- Availability of test cards, UPI simulation, and ACH sandbox behaviour in India/US.
- Whether hosted checkout supports all payment methods available to the widget.
- Rate-limit headers and exact `Retry-After` behaviour under sustained 429s.
- Dispute lifecycle and whether `disputed` can appear on a session versus a payment.

## 12. References

- API introduction and account ID:
  <https://www.zoho.com/us/payments/api/v1/introduction/>
- Payment sessions:
  <https://www.zoho.com/us/payments/api/v1/payment-session/>
- Payments:
  <https://www.zoho.com/us/payments/api/v1/payments/>
- Refunds:
  <https://www.zoho.com/us/payments/api/v1/refunds/>
- Webhook events:
  <https://www.zoho.com/us/payments/api/v1/webhooks-events/>
- Configure webhooks (retry policy):
  <https://www.zoho.com/us/payments/developerdocs/webhooks/configure/>
- Verify webhooks:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/verification/>
- Webhook best practices:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/best-practices/>
- OAuth:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/org-oauth/>
- Hosted checkout:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/>
- Checkout Widget:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/integrate-widget/>
- Widget API:
  <https://www.zoho.com/us/payments/api/v1/widget/>
- Signature verification:
  <https://www.zoho.com/us/payments/developerdocs/signature-verification/>
- Rate limits:
  <https://www.zoho.com/us/payments/developerdocs/rate-limits/>
- India edition of the developer docs:
  <https://www.zoho.com/in/payments/developerdocs/>

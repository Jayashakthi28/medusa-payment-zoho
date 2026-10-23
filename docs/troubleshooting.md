# Troubleshooting

This page covers the failure modes seen most often when integrating
`medusa-payment-zoho`. Start with the error code and the server logs, then use the
matching section.

- **Provider ID:** `pp_zoho_zoho`
- **Webhook route:** `/hooks/payment/zoho_zoho`
- **Default region:** India (`in`)
- **Default checkout mode:** widget

Never paste the client secret, refresh token, signing key, access token, full webhook
body, or hosted `checkoutUrl` into an issue. Zoho request IDs and error codes are safe
to share.

## 1. First checks

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

On the Medusa side:

1. Confirm the provider is registered and the backend restarted without a
   configuration error.
2. Confirm the provider is enabled for the region in **Medusa Admin → Settings →
   Regions**.
3. Confirm the Zoho account, OAuth client, refresh token, and `region` are from the same
   data centre.
4. Check the backend logs for a `Zoho … failed` message and its `code` field.
5. Confirm the webhook exists at
   `https://<backend>/hooks/payment/zoho_zoho` and is receiving deliveries.

Error codes emitted by this package:

| Code                              | Meaning                                                             | Typical Medusa error type |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| `ZOHO_CONFIGURATION_ERROR`        | Invalid or missing provider option.                                 | `invalid_data`            |
| `ZOHO_AUTHENTICATION_ERROR`       | OAuth refresh failed, credentials/scopes invalid.                   | `unexpected_state`        |
| `ZOHO_API_ERROR`                  | Zoho API returned an error (carries status, Zoho code, request ID). | `unexpected_state`        |
| `ZOHO_VALIDATION_ERROR`           | Untrusted session data, webhook body, amount, or options invalid.   | `invalid_data`            |
| `ZOHO_WEBHOOK_VERIFICATION_ERROR` | Webhook signature missing, malformed, or invalid.                   | `invalid_data`            |
| `ZOHO_UNSUPPORTED_OPERATION`      | Operation Zoho does not support (cancel, manual capture, etc.).     | `not_allowed`             |
| `ZOHO_PAYMENT_STATE_ERROR`        | Payment/refund is in a state that forbids the operation.            | `not_allowed`             |

The provider never logs secrets or raw request/response bodies. It logs the action and
the error code; `ZohoApiError` also carries the HTTP status, Zoho code, and request ID
for your own error handling.

## 2. Authentication and scopes

### Symptoms

- `ZOHO_AUTHENTICATION_ERROR`
- Zoho responds with `invalid_client`, `invalid_grant`, `invalid_token`, or
  `invalid_scope`
- Checkout fails immediately after deployment; no Zoho session is created
- The error persists after rotating the refresh token

### Causes and fixes

| Cause                                              | Fix                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Wrong data centre                                  | Use the client, refresh token, and account from the same region. India = `zoho.in`; US = `zoho.com`.        |
| Client is not an **ORG** client                    | Create an ORG client in the Zoho API console; a user-level client cannot mint an org token.                 |
| Missing scope                                      | Grant `ZohoPay.payments.CREATE`, `ZohoPay.payments.READ`, `ZohoPay.refunds.CREATE`, `ZohoPay.refunds.READ`. |
| Refresh token revoked or expired                   | Generate a new one with `scripts/get-refresh-token.mjs` and update the server secret.                       |
| Too many refresh tokens                            | A user can hold 20; generating another removes the oldest. Re-generate and deploy the current token.        |
| Token copied with whitespace or a trailing newline | Re-copy the exact value; the provider trims outer whitespace but cannot repair a truncated token.           |
| Test/live credentials mixed                        | Use the test account and test client together, or the live pair together. Do not mix them.                  |
| `ZOHO_PAYMENTS_API_KEY` used as `clientSecret`     | The API key is a publishable widget key, not the OAuth client secret.                                       |

Only an Account Owner or Admin can generate an org-level refresh token. The OAuth
refresh request is retried only for network errors, `429`, and `5xx`; `invalid_client`
and `invalid_grant` are terminal and surfaced immediately, because retrying cannot fix
bad credentials.

### Verify credentials without Medusa

```bash
curl -sS -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=$ZOHO_PAYMENTS_CLIENT_ID" \
  --data-urlencode "client_secret=$ZOHO_PAYMENTS_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$ZOHO_PAYMENTS_REFRESH_TOKEN"
```

Use `accounts.zoho.com` for the US. A success returns an `access_token` and
`expires_in`; a failure returns an `error` such as `invalid_client` or `invalid_grant`.
Do not paste the response into an issue.

## 3. HTTP 401 and 403

### 401 Unauthorized

- The access token is missing, expired, or invalid.
- The client invalidates its cached token and retries the request **once**.
- A second `401` is surfaced. Check the refresh token, client ID/secret, and data
  centre.
- A clock skew large enough to invalidate tokens is rare but possible; keep the server
  clock synced.

### 403 Forbidden

- The token is valid but lacks a scope or permission.
- Re-check the four scopes and that the Zoho user is an Account Owner or Admin.
- Confirm the `accountId` belongs to the same organization as the OAuth client.
- Confirm the account is active and enabled for the requested payment method/currency.

A `403` is not retried by the transport. Fix the permission or scope and redeploy.

## 4. HTTP 429 rate limits

Zoho documents limits including:

- about **600 requests/minute** for customers, payment methods, and payments;
- about **60 requests/minute** for refunds.

On `429`:

- Safe calls (GET, OAuth refresh, payment-session creation) retry with exponential
  backoff and honour `Retry-After` when present, capped at 30 seconds.
- Refund creation retries **only** an explicit `429`; it is not retried after a timeout
  or `5xx`, because the refund may already have been accepted.
- `maxRetries` (default `3`) and `retryBaseDelayMs` (default `500`) control the backoff.

If you see sustained `429`s:

- Reduce concurrent checkout/reconciliation jobs.
- Do not put refunds in a tight retry loop.
- Cache payment/session reads instead of polling aggressively.
- Check whether a reconciliation job is duplicating API calls.

## 5. Webhook signature failures

### Symptoms

- Backend logs `ZOHO_WEBHOOK_VERIFICATION_ERROR` or `Zoho process webhook failed`
- Orders are not completed by webhooks, but the browser flow works
- The webhook endpoint returns HTTP 200 anyway
- Zoho reports deliveries as successful even though Medusa rejected them

### Why 200 is still returned

Medusa acknowledges the webhook HTTP request before the provider handler finishes. The
provider cannot force a Zoho retry by throwing. Rejected events are visible in logs and
must be alerted on.

### Causes and fixes

| Cause                                             | Fix                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wrong signing key                                 | Copy the Developer Space signing key, not the API key or client secret.                    |
| Body parsed and re-serialized before verification | Verify the exact raw body. Use `express.raw()` or `request.text()` before `JSON.parse`.    |
| Proxy or API gateway rewrites the body            | Disable body transformation for this route; forward the exact bytes.                       |
| Header stripped or renamed                        | Preserve `X-Zoho-Webhook-Signature`; lookup is case-insensitive but the header must exist. |
| Timestamp malformed/zero                          | The header must be `t=<epoch-ms>,v=<hex>`; `v1` is also accepted.                          |
| `webhookToleranceSeconds` too small               | Zoho retries for up to two days. Use `0` (default) or a generous tolerance.                |
| Test and live modes mixed                         | Set `liveMode` correctly; a signed test event is rejected on a live-configured provider.   |
| Another Zoho account                              | The event’s `account_id` must match `accountId`; fix the webhook endpoint/account.         |
| Missing `signingKey`                              | Startup warns; webhooks fail closed. Configure the key and restart.                        |

### Verify a delivery manually

Follow [Webhooks: testing with curl and HMAC](./webhooks.md#9-testing-with-curl-and-hmac).
The signature is:

```text
HMAC-SHA256(signingKey, `${t}.${rawBody}`)
```

Check that:

- the body used for signing is byte-for-byte the body sent;
- the timestamp is the same value as in the header;
- the key is the Developer Space signing key;
- the computed hex is lowercase.

Invalid events are acknowledged but no action is applied. Reconcile affected payments
by retrieving the Zoho session/payment and, if necessary, complete the cart through your
own recovery flow.

## 6. Widget not loading or blocked by CSP

### Symptoms

- The button spins, then shows a script-loading error or times out
- Browser console reports a Content Security Policy violation
- `window.ZPayments` is undefined
- The widget works locally but not in production

### Causes and fixes

| Cause                                              | Fix                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CSP blocks `static.zohocdn.com`                    | Add it to `script-src`.                                                                          |
| CSP blocks Zoho API/XHR/frame traffic              | Allow `payments.zoho.in` / `payments.zoho.com` in `connect-src` and `frame-src`.                 |
| Ad blocker or privacy extension                    | Test in a clean browser profile; provide a hosted-checkout fallback.                             |
| Corporate proxy blocks the CDN                     | Allow the script URL and Zoho domains, or self-host the script with Zoho’s permission.           |
| `scriptUrl` override points at a blocked/wrong URL | Use the default `https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js` or a permitted mirror. |
| Wrong `apiKey` or widget domain                    | Check the Developer Space publishable key and that `region` matches the account (`IN`/`US`).     |
| Zoho restricts widget origins for the account      | Add the storefront domain in Zoho Developer Space if your account uses an origin allow-list.     |
| Helper called during SSR                           | Call it from a client component/event handler; it throws without `window`.                       |
| Script loaded but widget request fails             | Inspect the helper’s `reason`, `message`, and `code`; check the Zoho account’s enabled methods.  |

The default script URL is:

```text
https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js
```

A minimal CSP for India:

```text
script-src 'self' https://static.zohocdn.com;
connect-src 'self' https://your-medusa-api.example.com https://payments.zoho.in;
frame-src https://payments.zoho.in;
img-src 'self' data: https://static.zohocdn.com https://payments.zoho.in;
```

For the US, use `https://payments.zoho.com`. If the widget still cannot load, switch to
`checkoutMode: "hosted"`; the server-side flow is unchanged.

## 7. Expired payment session

### Symptoms

- Helper returns `{ ok: false, reason: "expired" }`
- The widget or hosted page says the session is no longer valid
- Checkout works, then fails after the customer waits
- `redirectToZohoHostedCheckout` throws “Zoho checkout session has expired”

### Cause

Zoho payment sessions last **15 minutes by default** and at most 15 minutes. There is no
update or extend endpoint. The provider records `expiresAt` in epoch milliseconds and
only reuses a session when it is unpaid, matches the cart exactly, and has more than 60
seconds left.

### Fix

1. Re-fetch the cart.
2. Re-run `sdk.store.payment.initiatePaymentSession(cart, { provider_id: "pp_zoho_zoho" })`.
3. Re-read the cart and use the new session `data`.
4. If the cart changed (items, shipping, discounts), refresh the payment collection so
   the amount and currency match the new total.

Do not retry the same `checkoutUrl` or the same expired widget session. The old Zoho
session expires on its own; there is no cancel API.

## 8. Amount mismatch

### Symptoms

- Zoho rejects the session with an amount/currency error
- The widget shows a different total than the cart
- The order total and payment amount differ
- A cart edit does not update the payment amount

### Causes and fixes

| Cause                                               | Fix                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Cart changed after the payment session was created  | Refresh the payment collection and create/update the session; do not reuse stale data.                                       |
| Currency changed                                    | The Zoho account must support the currency; create a new session with the new currency.                                      |
| `amount` was reformatted with binary floating point | Let the provider format it; do not send `Number(...)` or minor units.                                                        |
| More decimal places than the currency allows        | The provider rounds with `BigNumber.toFixed(ISO digits)`; ensure the cart total is correct before creating.                  |
| Session reused with a different amount              | Reuse requires an exact amount string, currency, mode, and >60 seconds remaining; otherwise a new session is created.        |
| Payment collection not refreshed after a cart edit  | Medusa’s completion workflow does **not** compare the captured amount to the cart total. Refresh the collection after edits. |

The provider sends a **decimal major-unit string** (for example `"1499.00"`), formatted
with the currency’s ISO fraction digits. It never sends minor units and never uses
binary floating point.

If the cart total can change after the session is created, re-run the payment-session
flow before completion. The provider cannot repair an amount mismatch that Medusa
introduces after the session was created.

## 9. Pending ACH or asynchronous payment

### Symptoms

- Hosted return shows `in_progress` or `pending`
- The widget returns a payment ID but the order is not marked paid
- `cart.complete()` creates an order whose payment is pending
- The customer sees “processing” for a long time

### What is happening

Zoho may accept an ACH or other asynchronous payment before settlement. `in_progress`
and `payment.pending` are mapped to `PENDING_AUTHORIZATION`, not success. ACH can take
days to settle.

### Fix and expectations

- Do not mark the order paid or fulfill it on `in_progress`.
- Show a “payment processing” state.
- Rely on the signed `payment.succeeded` webhook, or poll the Zoho session/payment.
- When the webhook maps to `SUCCESSFUL`, Medusa marks the payment captured and
  completes the cart if it was not completed.
- If your business allows orders before settlement, `cart.complete()` may create an
  order with a pending payment; keep fulfillment blocked until capture.
- For reconciliation, use `ZohoPaymentsClient.retrievePaymentSession` /
  `retrievePayment` with the stored `zohoSessionId` / `paymentId`.

A pending ACH is not a refund and not a failure. Do not start a second charge.

## 10. Refund failures

### Symptoms

- Admin refund returns an error
- Refund is created but stays `initiated`/`pending`
- A retry creates a second refund
- `Zoho refund failed: …`
- `Zoho payment ID is missing from Medusa payment data`

### Causes and fixes

| Cause                                                     | Fix                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refunding a session instead of a captured payment         | Refunds require `data.paymentId`; complete the payment first.                                                                                                              |
| `paymentId` missing from payment data                     | Check that authorization stored it; re-authorize/retrieve before refunding.                                                                                                |
| Refund amount zero/negative                               | Use a strictly positive amount in major units.                                                                                                                             |
| Amount exceeds the remaining refundable amount            | Check the payment’s `amount_refunded`; partial refunds cannot exceed the capture.                                                                                          |
| Zoho refund `status: failed`                              | The provider throws `ZOHO_PAYMENT_STATE_ERROR` with Zoho’s failure reason; fix the account/payment issue.                                                                  |
| Refund is `initiated` or `pending`                        | Accepted but not settled. Poll `GET /refunds/{id}`; do not create another refund.                                                                                          |
| Timeout or `5xx` after the refund POST                    | The refund may have succeeded. Do not retry blindly; reconcile the payment’s refunded total with `retrievePayment`, and with `retrieveRefund` when you have the refund ID. |
| `429`                                                     | The provider retries refund `429`s automatically; reduce refund concurrency (Zoho limit ~60/min).                                                                          |
| Same Medusa idempotency key reused for a different refund | The local replay guard returns the stored refund only for the matching key. Use a fresh key per refund.                                                                    |
| Refund webhook did not update Medusa                      | `refund.*` events are `NOT_SUPPORTED` by design; reconcile with the API.                                                                                                   |

A refund is asynchronous. Admin may show it before Zoho settles it. A reconciliation
job should poll recent refunds and alert on anything stuck beyond the expected
settlement window.

### Reconcile a refund

```ts
import { INDIA_REGION_CONFIG, ZohoPaymentsClient } from "medusa-payment-zoho"

const client = new ZohoPaymentsClient({
  accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID!,
  clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID!,
  clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET!,
  refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN!,
  regionConfig: INDIA_REGION_CONFIG,
  timeoutMs: 15_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
})

const refund = await client.retrieveRefund("refund_id_from_zoho")
console.log(refund.status, refund.amount, refund.failure_reason)
```

Use `US_REGION_CONFIG` for the US. The client is server-only.

## 11. Provider not visible in Admin

### Symptoms

- **Settings → Regions → Payment Providers** does not list Zoho
- The provider was visible before but disappeared
- Storefront returns “payment provider not found” / `pp_zoho_zoho` is unknown

### Fix

1. Confirm the module entry in `medusa-config.ts` uses the correct subpath:

   ```ts
   resolve: "medusa-payment-zoho/providers/zoho"
   ```

   The root package entry is not a ModuleProvider default.

2. Confirm the configured `id` is `zoho`. The resulting provider ID must be
   `pp_zoho_zoho`.
3. Restart the Medusa backend and check startup logs for
   `ZOHO_CONFIGURATION_ERROR`. A validation failure prevents registration.
4. Confirm the module is under the Payment Module’s `providers` array, not at the top
   level of `modules`.
5. Open the region and enable the provider explicitly; a registered provider can be
   disabled.
6. If the provider was removed from config, Medusa marks the existing record
   `is_enabled = false` rather than deleting it. Re-add it and enable it again.
7. Confirm the region’s currency is supported by your Zoho account.
8. Clear the Admin cache/reload after a backend restart.

If the storefront still cannot create a session, check that the region is enabled and
that the cart’s region matches the provider-enabled region. A provider enabled in India
does not make it available in a US region.

## 12. Region and domain problems

### Symptoms

- `invalid_client`, `invalid_grant`, or `401` only in one environment
- Widget loads but cannot find the account
- Hosted checkout redirects to the wrong Zoho domain
- CORS/CSP errors against `payments.zoho.*`
- Webhooks from one account never reach the other environment

### Matrix

| Setting         | India                             | US                                 |
| --------------- | --------------------------------- | ---------------------------------- |
| `region`        | `"in"`                            | `"us"`                             |
| Payments API    | `payments.zoho.in`                | `payments.zoho.com`                |
| OAuth accounts  | `accounts.zoho.in`                | `accounts.zoho.com`                |
| Hosted checkout | `payments.zoho.in/hostedcheckout` | `payments.zoho.com/hostedcheckout` |
| Widget domain   | `IN`                              | `US`                               |

Fixes:

- Use an account, OAuth client, and refresh token from the same data centre.
- Do not point a US token at `payments.zoho.in`, or vice versa.
- Confirm the widget’s `domain` (`IN`/`US`) matches the account; it is derived from
  `region` and cannot be overridden.
- If Zoho restricts widget origins, add the storefront domain in Developer Space.
- Keep test and live accounts separate, including their webhook endpoints and signing
  keys.
- In CSP, allow only the domains for the region(s) you actually use. Allowing both is
  fine during a migration.
- If you override `apiBaseUrl`, `accountsBaseUrl`, or `hostedCheckoutBaseUrl`, ensure
  they point at the same data centre and use HTTPS in production.

## 13. Payment succeeded but no order

### Symptoms

- Zoho shows a successful payment
- The storefront never redirected, or `cart.complete()` failed
- The webhook was delivered but no order exists

### Checks

1. Did the webhook have a valid signature? Check logs for
   `ZOHO_WEBHOOK_VERIFICATION_ERROR`.
2. Did the payment carry `meta_data.medusa_session_id` or `reference_number`? Without
   the bridge, the event is `NOT_SUPPORTED`.
3. Did the `account_id` and `live_mode` match the provider configuration?
4. Is the cart still open? Medusa’s `processPaymentWorkflow` completes the cart if it is
   not already completed.
5. Was the payment session already failed/expired? Reconcile the Zoho session status
   and the Medusa payment session.
6. Was the provider disabled or removed between session creation and webhook?

Recovery:

- Retrieve the Zoho session/payment by ID.
- Find the Medusa payment session by the stored `zohoSessionId` / `medusaSessionId`.
- If the payment is captured, complete the cart through a controlled recovery flow;
  otherwise mark it failed after confirming Zoho’s terminal status.
- Record the incident and add a reconciliation alert so the next occurrence is caught
  automatically.

## 14. Still stuck?

Collect:

- package version (`1.0.0`), Medusa version, and Node version;
- `region`, `checkoutMode`, and whether the mode is test or live;
- the error code and message, plus the Zoho request ID if you captured the
  `ZohoApiError`;
- the approximate time, cart ID, payment-session ID, and Zoho session/payment ID
  (never secrets);
- whether the failure is reproducible with a fresh cart;
- relevant logs with secrets and raw bodies removed.

Open an issue at
[github.com/Jayashakthi28/medusa-payment-zoho/issues](https://github.com/Jayashakthi28/medusa-payment-zoho/issues).
For security issues, follow [SECURITY.md](../SECURITY.md) instead of opening a public
issue.

## 15. Related documentation

- [Configuration](./configuration.md)
- [Webhooks](./webhooks.md)
- [Signatures](./signatures.md)
- [Storefront widget](./storefront-widget.md)
- [Hosted checkout](./storefront-hosted.md)
- [Compatibility and limitations](./compatibility.md)
- [Zoho Payments developer docs](https://www.zoho.com/us/payments/developerdocs/)

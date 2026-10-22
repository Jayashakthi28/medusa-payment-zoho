# ADR-0007: Signature verification mechanics

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0004](./ADR-0004-webhook-authorization.md), [Zoho research](../research/zoho-payments.md)

## Context

Zoho uses three different HMAC-SHA256 signatures in the flows this package supports.
They cover different data, use different separators, and arrive through different
channels:

1. **Webhooks** — `X-Zoho-Webhook-Signature: t=<timestamp>,v=<hex>` over
   `${t}.${rawBody}`.
2. **Widget response** — a `signature` field over
   `${payment_id}|${payment_session_id}`.
3. **Hosted-checkout return URL** — a `signature` query parameter over ten dot-joined
   fields, with absent optional fields represented by empty strings.

The signing key is server-only. The browser can receive a widget signature, and the
merchant's return route can receive a hosted signature, but neither can verify it
without exposing the key. Verification therefore belongs in the server entry point.
A single mistake in message construction (separator, field order, missing empty field,
re-serialized JSON) causes valid payments to be rejected or forged ones to pass.

## Decision

### One primitive, three message builders

All verification uses Node's `crypto.createHmac("sha256", signingKey)` and lowercase
hex output. Comparisons decode both hex strings to buffers and use
`crypto.timingSafeEqual`, with an explicit length check first. Empty signatures are
always invalid. A missing or empty signing key throws `ZohoConfigurationError`; there
is no unverified mode.

#### 1. Webhook

```
message = `${timestamp}.${rawBody}`
expected = HMAC-SHA256(signingKey, message) as hex
```

- `timestamp` is the `t` value verbatim (epoch milliseconds).
- `rawBody` is the exact bytes/string received. It is never parsed and re-serialized
  before verification.
- `v` is the signature; `v1` is accepted as an alias.
- The header lookup is case-insensitive. If a header appears multiple times, the first
  string value is used.
- `parseZohoSignatureHeader` returns `null` for a missing header, missing `t`/`v`,
  non-finite timestamps, or timestamps `<= 0`.
- Optional tolerance rejects events whose absolute age exceeds the configured seconds.
  `0` disables the check; the default is `0` because Zoho's retry window can be up to
  two days.

#### 2. Widget response

```
message = `${payment_id}|${payment_session_id}`
expected = HMAC-SHA256(signingKey, message) as hex
```

Both IDs are used as returned by Zoho; the session ID is the one the helper opened, not
a client-supplied replacement. The helper returns the signature when present, but the
server may also verify with a signature supplied through its own route.

#### 3. Hosted-checkout return URL

```
message = [
  payments_session_id,
  payment_session_status,
  payment_id        ?? "",
  payment_status    ?? "",
  amount            ?? "",
  udf1              ?? "",
  udf2              ?? "",
  udf3              ?? "",
  udf4              ?? "",
  udf5              ?? "",
].join(".")
expected = HMAC-SHA256(signingKey, message) as hex
```

Field order is fixed. Optional fields are empty strings, not omitted separators. The
amount is the string from the return URL (for example `"5.000"`), not a reformatted
decimal.

### API shape

- `isValidZohoWebhookSignature`, `isValidZohoWidgetResponseSignature`, and
  `isValidZohoHostedCheckoutSignature` return `boolean`.
- `assertValidZohoWebhookSignature` throws `ZohoWebhookVerificationError` on failure.
- `parseZohoSignatureHeader` is exported for diagnostics and custom routes.
- The `server` entry point exports all of the above. The root entry point also exports
  them; the `client` entry point does not, because it must remain `node:crypto`-free.

### Key handling

- One `signingKey` option covers webhook, widget, and hosted-return verification. If a
  deployment uses different keys for webhook endpoints and Developer Space signatures,
  it must split the option in a future ADR; the current contract assumes one key.
- The key is trimmed and limited to 512 characters by option validation.
- The key is never placed in payment-session `data`, logs, error messages, or browser
  bundles.
- Key rotation requires updating the Medusa configuration and the Zoho dashboard
  together; in-flight events signed with the old key will fail closed.

## Consequences

### Positive

- Exact message construction is centralized and unit-testable, rather than repeated in
  routes and helpers.
- Constant-time comparison prevents timing side channels.
- Raw-body verification avoids the classic JSON re-serialization bug.
- Empty optional fields follow Zoho's documented hosted-checkout contract.
- The server/browser split keeps the key out of storefront code.
- Missing configuration fails closed instead of accepting unsigned data.

### Negative

- One key for three signatures couples rotation of webhook and checkout signing keys.
- Timestamp tolerance is disabled by default, so replay protection depends on the
  signature and event semantics.
- The hosted signature covers the India eleven-field layout (or the US ten-field layout); a merchant route must
  still verify the session with Zoho before fulfilling.
- A malformed hex signature is treated as invalid rather than raising a distinct error,
  which simplifies callers but gives less diagnostic detail.
- Signature verification cannot detect a valid event that was delayed by Zoho's retry
  system unless tolerance is enabled.

## Alternatives considered

1. **Use a Zoho SDK's verifier.** Rejected: no maintained Node SDK is assumed, and the
   three message formats are small enough to implement directly.
2. **Verify over `JSON.stringify(payload.data)`.** Rejected: key order and whitespace
   differ from the raw body and break valid signatures.
3. **Use `===` for comparison.** Rejected: timing-unsafe.
4. **Expose the signing key to the browser so the widget can self-verify.** Rejected:
   the key is server-only and would allow forgery.
5. **Skip verification when `NODE_ENV !== "production"`.** Rejected: development data
   can still create orders, and the switch inevitably leaks into production.
6. **Use a single dot-joined format for all three signatures.** Rejected: Zoho defines
   different formats; changing them would reject real traffic.
7. **Require timestamp tolerance for all webhooks.** Rejected: Zoho's documented
   two-day retry window makes a short tolerance unsafe during outages.

## References

- Zoho webhook verification:
  <https://www.zoho.com/us/payments/developerdocs/webhooks/verification/>
- Zoho signature verification (widget and return URL):
  <https://www.zoho.com/us/payments/developerdocs/signature-verification/>
- Zoho hosted checkout return fields:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/>
- Zoho Checkout Widget API:
  <https://www.zoho.com/us/payments/api/v1/widget/>
- RFC 2104 (HMAC):
  <https://www.rfc-editor.org/rfc/rfc2104>
- Node.js `crypto` documentation:
  <https://nodejs.org/api/crypto.html>

## Test and verification pointers

- Generate deterministic vectors with a fixed key, timestamp, body, and IDs; assert
  exact expected hex.
- Webhook tests: valid, tampered body, wrong key, missing header, missing `t`, missing
  `v`, non-numeric timestamp, zero timestamp, `v1` alias, duplicate header, and
  tolerance inside/outside/disabled.
- Widget tests: valid, swapped IDs, changed payment ID, changed session ID, empty
  signature, wrong key.
- Hosted tests: all ten fields present; each optional field absent; changed amount;
  changed status; changed UDF; reordered fields; empty signature.
- Constant-time helper tests: different lengths, non-hex input, empty values.
- Missing signing key throws `ZOHO_CONFIGURATION_ERROR` before any HMAC work.
- A source/package test asserts that `dist/client/*` does not import
  `node:crypto` or the `server` entry point.
- A log-capture test asserts that neither the signing key nor the computed signature is
  logged.

# ADR-0006: OAuth token lifecycle and retry policy

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0005](./ADR-0005-capture-cancel-refund.md), [Zoho research](../research/zoho-payments.md)

## Context

Zoho Payments uses OAuth 2.0 org-level credentials. The server is configured with a
long-lived refresh token, client ID, and client secret; access tokens are short-lived
(typically one hour) and must be attached as
`Authorization: Zoho-oauthtoken <access_token>`.

The plugin runs inside a Medusa server that handles concurrent requests, retries, and
webhooks. A naive implementation that refreshes a token per request would multiply
latency, hit rate limits, and create token churn. A naive retry policy would also be
dangerous: Zoho has no idempotency-key header, so retrying a state-changing request
after a network timeout can duplicate a payment session or refund.

The policy must distinguish:

- **safe** calls (reads, and creates whose duplicate is harmless because only the latest
  result is stored), where network errors, 429, and 5xx are retryable; and
- **state-changing** calls (refunds), where only an explicit 429 proves the request was
  rejected before processing.

## Decision

### Token acquisition and cache

- Use the OAuth 2.0 refresh-token grant against
  `POST {accountsBaseUrl}/oauth/v2/token` with form-encoded
  `refresh_token`, `client_id`, `client_secret`, and `grant_type=refresh_token`.
- Cache the access token in memory with an expiry of
  `now + (expires_in - min(60s, expires_in / 2))`. The safety margin is capped at half
  the token lifetime, so a short-lived token is not cached past its real expiry.
- Collapse concurrent refreshes into a single in-flight promise. Every caller waits on
  the same request; a failure rejects all waiters and clears the in-flight slot.
- On a `401` from the Payments API, invalidate the cached token and retry the request
  **once**. A second `401` is surfaced; the client does not loop.
- Never log the refresh token, client secret, access token, or the raw token response.

### OAuth refresh retries

A refresh is retried only when the failure is a `ZohoAuthenticationError` marked
retryable:

- network errors (DNS, socket, timeout, abort);
- HTTP `429`;
- HTTP `5xx`.

Other `4xx` responses (`invalid_client`, `invalid_grant`, revoked token, wrong data
centre) are terminal and surfaced immediately. Retries use exponential backoff
`retryBaseDelayMs * 2^attempt`, with defaults of 3 retries and a 500 ms base. The OAuth
client records `Retry-After` in the error cause but uses its own bounded backoff; it
does not sleep for an unbounded server-provided delay.

### Payments API retries

The HTTP transport accepts a per-request `retryPolicy`:

| Policy | Network error | 429   | 5xx     | Other 4xx |
| ------ | ------------- | ----- | ------- | --------- |
| `safe` | Retry         | Retry | Retry   | Surface   |
| `none` | Surface       | Retry | Surface | Surface   |

- `GET /paymentsessions/{id}`, `GET /payments/{id}`, `GET /refunds/{id}`: `safe`.
- `POST /paymentsessions`: `safe`. A duplicate session is undesirable but bounded: the
  provider stores only the session ID it received, and any orphan expires within 15
  minutes.
- `POST /payments/{id}/refunds`: `none`. A timeout or 5xx can mean the refund was
  accepted; retrying can double-refund. Only a `429` is retried, because it explicitly
  means the request was rejected before processing.
- Session creation is treated as a safe create rather than money movement: a duplicate
  session has no financial effect because only one ID is stored and the orphan expires.
  The stricter state-changing rule applies to refunds and to any future POST that moves
  money. Network-error retries are never used for those money-moving calls.
- Retry delays honour `Retry-After` when present (seconds or HTTP date), capped at 30
  seconds, otherwise use exponential backoff.
- `maxRetries` defaults to 3, meaning up to three retries after the initial attempt.
- Each attempt uses `AbortSignal.timeout(timeoutMs)`; the default timeout is 15 seconds.
- Request bodies and bearer tokens are never logged. Errors contain method, path,
  status, Zoho code, and request ID.

### Configuration knobs

`timeoutMs`, `maxRetries`, `retryBaseDelayMs`, `fetch`, `now`, and `sleep` are
configurable. The injectable clock/sleep/fetch seams exist for deterministic tests and
for proxies or instrumentation, not as a way to disable security checks.

## Consequences

### Positive

- One token refresh serves all concurrent requests, reducing latency and rate-limit
  pressure.
- The safety margin prevents most mid-flight expiry failures.
- A single 401 recovery handles clock skew and server-side revocation without loops.
- Safe reads are resilient to transient Zoho/network failures.
- Refunds are protected from the most dangerous duplicate scenario.
- Secrets never appear in logs or error messages.
- Deterministic tests can exercise timing without real sleeps.

### Negative

- A process restart loses the cache and forces one refresh; this is acceptable.
- Multiple server instances each maintain their own cache and refresh independently;
  Zoho tolerates this, but token churn increases with instance count.
- The OAuth path does not honour `Retry-After` for its sleep, only records it.
- `POST /paymentsessions` retries can create orphan sessions that consume quota until
  expiry.
- A refund that times out remains ambiguous and requires manual reconciliation.
- `maxRetries` applies per request; a workflow that retries the whole provider call can
  still multiply attempts.

## Alternatives considered

1. **Refresh a token before every API call.** Rejected: unnecessary latency and token
   churn.
2. **Cache the token until its exact expiry.** Rejected: in-flight requests can cross
   the boundary and fail with 401.
3. **Use a shared distributed cache for tokens.** Rejected for v1: adds Redis or
   database coupling; per-process caching is sufficient and simpler.
4. **Retry all failures, including refund timeouts.** Rejected: duplicate refunds.
5. **Never retry anything.** Rejected: transient 429/5xx and network blips are common
   and safely retryable for reads.
6. **Treat 400 `invalid_grant` as retryable.** Rejected: it indicates revoked or invalid
   credentials; retrying wastes time and can trip lockouts.
7. **Use Zoho's server SDK instead of a small transport.** Rejected: an extra runtime
   dependency, less control over retry semantics, and harder browser/server separation.

## References

- Zoho OAuth for org-level clients:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/org-oauth/>
- Zoho API authentication:
  <https://www.zoho.com/us/payments/api/v1/authentication/>
- Zoho rate limits:
  <https://www.zoho.com/us/payments/developerdocs/rate-limits/>
- Zoho API introduction and account ID:
  <https://www.zoho.com/us/payments/api/v1/introduction/>
- OAuth 2.0 RFC 6749:
  <https://www.rfc-editor.org/rfc/rfc6749>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>

## Test and verification pointers

- Cache test: two sequential calls within expiry produce one token request; after
  expiry, a second request refreshes.
- Safety-margin test: `expires_in` 3600 caches for 3540 seconds; `expires_in` below 120
  seconds subtracts half the lifetime (for example, `expires_in = 4` caches for 2 seconds).
- Single-flight test: ten concurrent calls produce exactly one token request.
- 401 test: first request refreshes and succeeds; a second 401 is surfaced; no infinite
  loop.
- Refresh retry tests: network error, 429, and 500 retry; 400 `invalid_grant` does not.
- Transport retry tests: `safe` retries network/429/5xx; `none` retries 429 only.
- `Retry-After` tests: seconds, HTTP date, invalid value, and the 30-second cap.
- Secret-leak test: capture all logger calls and thrown error messages; assert none
  contain the client secret, refresh token, or access token.
- Timeout test: a hanging `fetch` aborts at `timeoutMs` and becomes a typed error.

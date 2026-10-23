# Testing and verification

- **Package:** `medusa-payment-zoho`
- **Last verified:** 2026-10-23
- **Baseline:** Medusa 2.22.0, Node 22.22.x, pnpm 11.5.1
- **Coverage gate:** 100% lines, branches, functions, and statements

This document is the operating guide for tests, coverage, and release verification.
It describes the checked-in suite only. Zoho credentials are **not** available to CI,
so the live checks in this document are manual and opt-in.

## 1. Commands

Run commands from the repository root.

| Command                  | What it does                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| `pnpm test`              | Runs `vitest run` over `test/**/*.test.ts` once                               |
| `pnpm test:watch`        | Starts Vitest in watch mode                                                   |
| `pnpm test:coverage`     | Runs the suite with V8 coverage and enforces the 100% thresholds              |
| `pnpm lint`              | Runs ESLint                                                                   |
| `pnpm format`            | Formats the repository with Prettier                                          |
| `pnpm format:check`      | Fails if any tracked file is not formatted                                    |
| `pnpm typecheck`         | Runs `tsc --noEmit`                                                           |
| `pnpm build`             | Builds ESM, CJS, and `.d.ts` output with tsup                                 |
| `node scripts/smoke.mjs` | Live credential smoke test; requires `pnpm build` and Zoho credentials        |
| `pnpm pack:check`        | Runs `npm pack --dry-run`, `publint`, and `attw --pack .`                     |
| `pnpm verify:package`    | Packs, installs, and imports every public entry point in a throwaway consumer |
| `pnpm check`             | Runs lint, format check, typecheck, coverage, build, pack, and package checks |

`pnpm check` is the release gate. The current pass/fail snapshot and the durable gaps are
recorded in [Known gaps](#10-known-gaps).

## 2. Coverage policy

The thresholds live in `vitest.config.ts` and are non-negotiable:

```ts
coverage: {
  provider: "v8",
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.d.ts", "src/types.ts", "src/**/types.ts"],
  thresholds: {
    lines: 100,
    functions: 100,
    branches: 100,
    statements: 100,
  },
}
```

Rules:

1. Every new function, branch, and statement in `src/**/*.ts` needs a test that
   exercises it. Type-only files are excluded because they emit no runtime code.
2. Do not lower a threshold to land a change. Add the missing test or explain why the
   code should not exist.
3. Snapshots are not a substitute for assertions. Tests assert exact values, calls, and
   errors.
4. Unit tests never call Zoho. The suite uses fake clients, fake clocks, and injected
   `fetch`/`sleep` functions.
5. Local coverage is written to `coverage/` and is not committed. `coverage/` is in
   `.gitignore`.
6. `v8 ignore` is not currently used anywhere in `src/`. If it becomes necessary, add a
   written justification here, next to the code, and in the pull request. A comment such
   as "defensive branch" is not sufficient; explain why the branch is unreachable in
   tests and why it must remain.

Current result, verified on 2026-10-23:

```text
Test Files  17 passed (17)
     Tests  762 passed (762)
Statements   : 100% ( 1039/1039 )
Branches     : 100% ( 993/993 )
Functions    : 100% ( 194/194 )
Lines        : 100% ( 1037/1037 )
```

These numbers will change as tests are added. Re-run `pnpm test:coverage` rather than
quoting this table in a release note.

## 3. Test matrix by module

| Source module                        | Test file(s)                                                                                                                                                        | What is covered                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/core/amount.ts`                 | `test/core/amount.test.ts`                                                                                                                                          | ISO-4217 validation, zero/two/three-decimal currencies, symbols, invalid `BigNumber` input, positive amounts          |
| `src/core/errors.ts`                 | `test/core/errors.test.ts`                                                                                                                                          | Stable error codes, subclass names, causes, retryability, type guard, safe message extraction                         |
| `src/core/http.ts`                   | `test/core/http.test.ts`                                                                                                                                            | URL/query construction, auth header, JSON envelopes, error mapping, 401 refresh-once, retry policies, `Retry-After`   |
| `src/core/logger.ts`                 | `test/core/logger.test.ts`                                                                                                                                          | No-op logger, Medusa-style adapter, partial loggers, method binding                                                   |
| `src/core/oauth.ts`                  | `test/core/oauth.test.ts`                                                                                                                                           | Token request shape, cache and safety window, single-flight refresh, retryable vs terminal failures, redaction        |
| `src/core/signatures.ts`             | `test/core/signatures.test.ts`                                                                                                                                      | Webhook, widget, and hosted-checkout vectors; tampering; tolerance; missing key; constant-time comparisons            |
| `src/core/status.ts`                 | `test/core/status.test.ts`                                                                                                                                          | Every documented Zoho session/payment status, unknown values, terminal/captured/failed predicates                     |
| `src/core/zoho-client.ts`            | `test/core/zoho-client.test.ts`                                                                                                                                     | Session/payment/refund endpoints, request bodies, envelope validation, missing resources, credential wiring           |
| `src/providers/zoho/options.ts`      | `test/providers/options.test.ts`                                                                                                                                    | India default, US opt-in, mode-specific requirements, URL checks, numeric bounds, metadata/currency maps, freezing    |
| `src/providers/zoho/session-data.ts` | `test/providers/session-data.test.ts`                                                                                                                               | Untrusted-data parsing, metadata limit, expiry normalization, session reuse, optional fields                          |
| `src/providers/zoho/service.ts`      | `test/providers/service-initiate.test.ts`, `test/providers/service-lifecycle.test.ts`, `test/providers/service-operations.test.ts`, `test/providers/module.test.ts` | Initiate/update/reuse, hosted/widget data, authorization polling, capture/cancel/refund rules, error translation      |
| `src/providers/zoho/webhook.ts`      | `test/providers/webhook.test.ts`                                                                                                                                    | Signature-first handling, account/live-mode checks, event mapping, `payment.failed` reconciliation, missing bridge    |
| `src/providers/zoho/index.ts`        | `test/providers/module.test.ts`                                                                                                                                     | `ModuleProvider` shape, `identifier = "zoho"`, static option validation, constructor seams                            |
| `src/client/index.ts`                | `test/client/widget.test.ts`, `test/client/ssr.test.ts`                                                                                                             | Script load/reuse/error/timeout, jsdom widget flow, close and failure mapping, expiry, hosted redirect, server safety |
| `src/index.ts`                       | No dedicated unit test                                                                                                                                              | Export surface is checked by `pnpm build`, `pnpm pack:check`, and the package verifier                                |
| `src/server/index.ts`                | No dedicated unit test                                                                                                                                              | Re-exports are checked by the build and package checks; the underlying helpers are covered by signature/client tests  |
| `src/providers/zoho/types.ts`        | —                                                                                                                                                                   | Type-only file; excluded from runtime coverage                                                                        |
| `src/types.ts`                       | —                                                                                                                                                                   | Type-only browser-safe surface; excluded from runtime coverage                                                        |

The complete test list is 17 files:

```text
test/client/ssr.test.ts
test/client/widget.test.ts
test/core/amount.test.ts
test/core/errors.test.ts
test/core/http.test.ts
test/core/logger.test.ts
test/core/oauth.test.ts
test/core/signatures.test.ts
test/core/status.test.ts
test/core/zoho-client.test.ts
test/providers/module.test.ts
test/providers/options.test.ts
test/providers/service-initiate.test.ts
test/providers/service-lifecycle.test.ts
test/providers/service-operations.test.ts
test/providers/session-data.test.ts
test/providers/webhook.test.ts
```

## 4. Fixtures and the fake client

All provider tests build a harness from `test/fixtures/providers.ts`. The fixture file is
part of the test suite, not the published package.

| Export                                           | Purpose                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `NOW`, `SIGNING_KEY`                             | Fixed clock and HMAC key so signatures and expiry are deterministic                             |
| `baseOptions(overrides)`                         | Valid India/widget options with credentials and a publishable API key                           |
| `createSession`, `createPayment`, `createRefund` | Minimal Zoho resources with typed overrides                                                     |
| `FakeZohoClient`                                 | Implements `ZohoPaymentsClientLike`, records every call, and throws for unconfigured operations |
| `createClient(handlers)`                         | A fake client with happy-path defaults, optionally overridden per operation                     |
| `FakeLogger`                                     | Captures `debug`, `warn`, and `error` entries for leak and behaviour assertions                 |
| `createHarness(config)`                          | Builds the provider with fake client, logger, clock, and sleep; returns call and sleep records  |
| `captureMedusaError(promise)`                    | Asserts a rejection is a Medusa `MedusaError` and returns it                                    |
| `sequence(...values)`                            | Returns scripted values in order, repeating the last one                                        |
| `signWebhookBody(body, key, timestamp)`          | Produces `t=<epoch-ms>,v=<hex>` over the exact body                                             |
| `buildPaymentEvent(...)`                         | Builds a signed-webhook event body with overridable payment/event fields                        |
| `createWebhookPayload(event, options)`           | Builds the `ProviderWebhookPayload["payload"]` shape, including headers                         |

Design rules for new fixtures:

- The fake client records the **exact input** so tests can assert amount strings,
  metadata, hosted URLs, and idempotency keys without reaching into the transport.
- An unconfigured fake operation must throw. A silent empty result hides wiring bugs.
- Use the injected clock and sleep. Never make a test wait for a real retry or poll.
- Put reusable Zoho resource builders in `test/fixtures/providers.ts`; keep one-off
  values inside the test that needs them.

## 5. Running focused tests

Run a single file:

```bash
pnpm exec vitest run test/providers/webhook.test.ts
```

Run one module directory:

```bash
pnpm exec vitest run test/providers
```

Run tests whose name matches a pattern:

```bash
pnpm exec vitest run test/providers/webhook.test.ts -t "payment.failed"
```

Watch a directory while editing:

```bash
pnpm test:watch test/providers
```

Coverage on a subset is useful for debugging but is **not** the gate: global thresholds
will fail because untouched modules have no coverage. Always finish with the full
`pnpm test:coverage`.

## 6. Zoho smoke test (manual, no money movement)

`scripts/smoke.mjs` is the checked-in live harness. It exchanges the refresh token,
creates one Zoho payment session, retrieves it, and verifies that the returned amount and
currency match. It **never** authorizes, captures, charges, or refunds a payment. The
unpaid session expires on Zoho's side.

Prerequisites:

1. Copy `.env.example` to `.env.sandbox` for testing (it is Git-ignored) or `.env` for
   live, and fill in the four required credentials: `ZOHO_PAYMENTS_ACCOUNT_ID`,
   `CLIENT_ID`, `CLIENT_SECRET`, and `REFRESH_TOKEN`.
2. Set `ZOHO_PAYMENTS_ENVIRONMENT=sandbox` for Zoho Sandbox, or `live` for production.
   Sandbox is currently India-only. Use an account and OAuth client from the matching
   environment and data centre.
3. Run `pnpm build` first; the script imports `dist/server/index.js`.
4. Do not run it with `NODE_ENV=production`. The script refuses that environment.

```bash
set -a; source .env.sandbox; set +a
pnpm build
node scripts/smoke.mjs
```

Optional variables:

| Variable                       | Default | Purpose                               |
| ------------------------------ | ------- | ------------------------------------- |
| `ZOHO_PAYMENTS_ENVIRONMENT`    | `live`  | `live` or `sandbox` (India-only)      |
| `ZOHO_PAYMENTS_REGION`         | `in`    | `in` or `us`                          |
| `ZOHO_PAYMENTS_SMOKE_AMOUNT`   | `1.00`  | Positive decimal major-unit amount    |
| `ZOHO_PAYMENTS_SMOKE_CURRENCY` | `INR`   | Any ISO-4217 code the account accepts |

For a US account, set `ZOHO_PAYMENTS_REGION=us` and normally
`ZOHO_PAYMENTS_SMOKE_CURRENCY=USD`; the script does not guess the currency from the
region.

The script prints the session ID, status, expiry, and, when Zoho returns one, a hosted
checkout URL. A hosted checkout URL contains an `access_key` that acts as a bearer
capability; do not paste it into an issue, log, or analytics event.

Do not add the smoke test to CI. It needs Zoho credentials, a matching environment and
region, and an account that permits session creation. Sandbox credentials are safe for
local runs; live credentials should be used only with a deliberate small amount and a
refund plan.

### Sandbox verification record (2026-10-23)

The India sandbox was exercised with real sandbox credentials:

- `scripts/get-refresh-token.mjs` generated the sandbox refresh token using
  `ZohoPaySandbox.*` scopes and `soid=zohopaysandbox.<account_id>`, and wrote it to an
  ignored env file with `0600` permissions.
- `scripts/smoke.mjs` created and retrieved a sandbox payment session for `INR 1.00`.
- The embedded widget loaded with `otherOptions.is_test_mode = true`.
- A sandbox Visa test card (`4111 1111 1111 1111`, `Success`) completed a ₹1 payment.
- The widget response signature verified with the sandbox signing key.
- `authorizePayment()` against the real sandbox payment returned `captured` and
  `paymentStatus: succeeded`; `getPaymentStatus()` also returned `captured`.
- A refund request reached Zoho but was rejected with
  `refund_exceeds_balance_amount` because the sandbox account had no available refund
  balance. That is a sandbox account-state condition, not a provider error; retry after
  the sandbox balance/settlement is available.

This is a sandbox test only. No live production payment has been processed.

For a full checkout smoke test, use the storefront guides in
[`docs/storefront-widget.md`](./storefront-widget.md) or
[`docs/storefront-hosted.md`](./storefront-hosted.md) and the examples in
[`examples/README.md`](../examples/README.md) against a development Medusa application,
then confirm the order and payment in Medusa Admin and the Zoho dashboard.

## 7. Webhook HMAC testing

Zoho signs the exact raw body:

```text
header = X-Zoho-Webhook-Signature: t=<epoch-ms>,v=<hex>
message = `${t}.${rawBody}`
signature = HMAC-SHA256(signingKey, message) as lowercase hex
```

The provider verifies this before parsing the event. A test must sign the same bytes it
sends. Do not parse and re-serialize JSON between signing and sending.

### Unit-level testing

The fixtures produce valid headers:

```ts
import { buildPaymentEvent, createWebhookPayload } from "../fixtures/providers"

const event = buildPaymentEvent({ reference_number: "payses_123" })
const payload = createWebhookPayload(event)

// payload.rawData and payload.headers["x-zoho-webhook-signature"] are a matched pair.
```

Negative tests should cover at least:

- a tampered body with the original signature;
- a signature made with a different key;
- a missing or malformed header;
- a timestamp outside `webhookToleranceSeconds`;
- an account ID or `live_mode` that does not match the provider options;
- a valid event without a Medusa session bridge, which must return `NOT_SUPPORTED`.

### Manual delivery to a local Medusa server

Start the Medusa server on `http://localhost:9000`, then run this from the repository
root. Replace `payses_...` with a real Medusa payment-session ID and use the same
`account_id` and `live_mode` as the provider configuration.

```bash
node --input-type=module <<'NODE'
import { createHmac } from "node:crypto"

const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY
if (!signingKey) throw new Error("Missing ZOHO_PAYMENTS_SIGNING_KEY")

const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID
if (!accountId) throw new Error("Missing ZOHO_PAYMENTS_ACCOUNT_ID")

const body = JSON.stringify({
  event_id: `evt_${Date.now()}`,
  event_type: "payment.succeeded",
  account_id: accountId,
  live_mode: process.env.ZOHO_PAYMENTS_LIVE_MODE === "true",
  event_object: {
    payment: {
      payment_id: "zoho_pay_manual_test",
      amount: "100.00",
      currency: "INR",
      status: "succeeded",
      payments_session_id: "zoho_sess_manual_test",
      reference_number: "payses_REPLACE_ME",
      meta_data: [
        { key: "medusa_session_id", value: "payses_REPLACE_ME" },
      ],
    },
  },
})

const t = Date.now()
const v = createHmac("sha256", signingKey).update(`${t}.${body}`, "utf8").digest("hex")

const response = await fetch("http://localhost:9000/hooks/payment/zoho_zoho", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-zoho-webhook-signature": `t=${t},v=${v}`,
  },
  body,
})

console.log(response.status, await response.text())
NODE
```

Medusa's webhook route returns HTTP 200 before the provider handler finishes. A rejected
signature therefore does not produce a non-2xx response and does not trigger a Zoho
retry. Confirm the result in the Medusa logs and the order/payment records; do not rely
on the HTTP status alone.

`payment.succeeded` maps to `SUCCESSFUL`. `payment.pending` maps to
`PENDING_AUTHORIZATION`. `payment.failed` triggers a read of the Zoho session and only
maps to `FAILED` when that session is terminal. See
[ADR-0004](./decisions/ADR-0004-webhook-authorization.md) for the full table, and
[`docs/webhooks.md`](./webhooks.md#9-testing-with-curl-and-hmac) for a `curl` recipe.

## 8. CI

CI is checked in at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on
pushes to `main` and on pull requests, with a Node 22 and Node 24 matrix on Ubuntu:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:coverage
# independent check that coverage-summary.json reports 100% on all four metrics
pnpm build
pnpm pack:check
pnpm verify:package
```

`pnpm verify:package` packs the repository, installs the tarball and
`@medusajs/framework@2.22.0` in a temporary consumer, and imports the client (ESM and
CJS), provider loader, server entry, and `package.json`. Coverage is uploaded as an
artifact for each Node version.

Use pnpm 11.5.1, as declared in `packageManager`. Node 22 is the effective floor for
Medusa 2.22; Node 24 is tested for forward compatibility. Node 20 is not exercised even
though the package's own `engines` field says `>=20`.

The tag-triggered [`.github/workflows/release.yml`](../.github/workflows/release.yml)
runs `pnpm check` and publishes with provenance only after a `v*` tag matches the
`package.json` version. See [`docs/publishing.md`](./publishing.md) for the release
process.

The smoke test and webhook delivery are **not** part of CI. They need real Zoho
credentials, a reachable Medusa deployment, and a live signing key. Run them manually
against staging before a release.

## 9. Release checklist for tests

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm typecheck`
5. `pnpm test:coverage` — all four thresholds at 100%
6. `pnpm build`
7. `pnpm pack:check`
8. `pnpm verify:package`
9. Inspect the tarball: it must contain `dist`, `docs`, `README.md`, `CHANGELOG.md`,
   `SECURITY.md`, `LICENSE`, and the package metadata; it must not contain `src`,
   `test`, `examples`, `coverage`, `.env`, or credentials.
10. Run `node scripts/smoke.mjs` against India and, if supported, the US.
11. Deliver a signed webhook to the staging route and confirm the order and payment.
12. Complete the manual sandbox checks in
    [`docs/compatibility.md`](./compatibility.md#8-verification-checklist) and the
    storefront checklists in
    [`docs/storefront-widget.md`](./storefront-widget.md#10-testing-checklist) and
    [`docs/storefront-hosted.md`](./storefront-hosted.md#8-security-checklist).

## 10. Known gaps

These are deliberate limits of the current suite, not statements that the code is
unverified.

### Current gate status (2026-10-23)

Run against this checkout after the latest build:

| Check                 | Result | Notes                                                                  |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `pnpm lint`           | Pass   | ESLint over source and tests                                           |
| `pnpm typecheck`      | Pass   | `tsc --noEmit`                                                         |
| `pnpm test:coverage`  | Pass   | 762 tests, 100% on all four metrics                                    |
| `pnpm build`          | Pass   | ESM, CJS, `.d.ts`, and `.d.cts` emitted                                |
| `pnpm verify:package` | Pass   | Installed tarball imports every public entry point                     |
| `pnpm format:check`   | Pass   | Prettier over the repository                                           |
| `pnpm pack:check`     | Pass   | `publint` and `attw` (Node 16 profile) accept the ESM/CJS/type surface |

Re-run every command on the final commit; do not treat this table as permanent.

### Suite and packaging gaps

- **No Zoho credentials in CI.** The suite uses fakes. OAuth, session creation, payment
  methods, hosted checkout, refunds, and webhook delivery are exercised manually against
  Zoho Sandbox before a release. The credential-free suite remains deterministic and
  runs on every commit.
- **No Medusa application integration fixture.** The provider tests call the provider
  service directly. A full fixture that boots Medusa, resolves `pp_zoho_zoho`, and posts
  to `/hooks/payment/zoho_zoho` is referenced by the ADRs but is not checked in.
- **No real-browser end-to-end test.** The widget helper is tested in jsdom and in a
  Node environment without `window`. CSP behaviour, the real Zoho CDN, and actual
  payment-method iframes are not covered.
- **Webhook acknowledgement timing is not reproducible in unit tests.** The suite
  verifies the provider's throw/mapping behaviour, not Medusa's early HTTP 200. The
  route-level behaviour must be verified against a running Medusa application.
- **Refund ambiguity is not testable against a real timeout.** Tests prove that a
  refund POST does not retry a timeout or 5xx, but only a live Zoho account can prove
  whether a timed-out request was actually processed.
- **Browser-bundle purity is enforced by the package verifier.** `verify:package`
  scans `dist/client/index.js` and `.cjs` for `node:` and `@medusajs/` references before
  packing, so a server import in the browser entry fails the gate.
- **Node 20 is declared but not tested.** `engines` says `>=20`; CI runs Node 22 and 24.
  Medusa 2.22 requires Node 22.22, so Node 20 is only relevant to older Medusa lines.
- **No durable webhook event store.** Duplicate delivery is expected and mapped to the
  same action; there is no `event_id` dedupe table. See
  [`docs/architecture.md`](./architecture.md) section 6.

## 11. References

- [Architecture and testing map](./architecture.md#13-testing-map)
- [Configuration](./configuration.md)
- [Compatibility and manual sandbox checklist](./compatibility.md#8-verification-checklist)
- [Webhooks and curl/HMAC testing](./webhooks.md#9-testing-with-curl-and-hmac)
- [Webhook authorization ADR](./decisions/ADR-0004-webhook-authorization.md)
- [Signature mechanics ADR](./decisions/ADR-0007-signature-verification.md)
- [OAuth and retry policy ADR](./decisions/ADR-0006-oauth-retry-policy.md)
- [Publishing](./publishing.md)
- [Examples](../examples/README.md)
- [Vitest configuration](../vitest.config.ts)
- [Test fixtures](../test/fixtures/providers.ts)
- [Smoke script](../scripts/smoke.mjs)
- [CI workflow](../.github/workflows/ci.yml)

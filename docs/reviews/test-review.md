# Test-quality review — medusa-payment-zoho

- **Date:** 2026-10-23
- **Scope:** read-only audit of `src/**`, `test/**`, `vitest.config.ts`, `package.json`, CI,
  and `docs/testing.md`. No source, tests, or existing docs were modified.
- **Commands run:** `pnpm test:coverage`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm pack:check`.
- **Result of `pnpm test:coverage`:** 17 files, **708 tests passed**, 100% lines,
  statements, functions, and branches (936/936 lines, 938/938 statements, 180/180
  functions, 854/854 branches).

## Verdict

The numeric 100% claim is **real and enforced**: V8 coverage is enabled, no `v8 ignore`
directives exist, type-only files are the only exclusions, global thresholds are exactly
100, and CI independently re-checks `coverage-summary.json`.

The 100% is **not sufficient evidence of payment safety**. The suite is strong on pure
functions and transport mechanics, but several payment-critical behaviours are either
unasserted or covered only by tests that mutate private state, mock a module, or pass
values that Medusa's types do not allow. The most serious gaps are the webhook trust
boundary (`rawData` is verified but `payload.data` is mapped), unvalidated webhook
amounts, a `payment.failed` fixture that assumes a field official Zoho webhook examples
do not contain, stale payment state surviving session rotation, and sub-precision amounts
formatting to zero.

This review uses "threatens 100%" to mean the metric is still literally true but no
longer supports the claim that the behaviour is meaningfully tested.

## High-severity findings

### H1. The webhook verifies one body but maps a different object

- **Severity:** High (trust boundary / signature invariant)
- **Files:** `src/providers/zoho/webhook.ts:155-175`;
  `test/providers/webhook.test.ts:62-89`.
- **Why it is weak:** `rawBody` is computed and verified at lines 155-173, but the event
  is then parsed from `payload.data` at line 175. Nothing proves that `rawData` and
  `data` are the same bytes or represent the same event. The test at lines 62-76 signs an
  object containing only `{ event_type: "payment.succeeded" }` while `payload.data`
  contains a full payment object; it expects `SUCCESSFUL`. The test at lines 78-89
  passes `rawData: 42`, treats it as an empty signed body, and still accepts the full
  event. `ProviderWebhookPayload` types `rawData` as `string | Buffer`; this object and
  unsupported-type handling is outside the real Medusa shape and exists only because the
  test casts it.
- **Suggested test:** sign a raw body for event A while supplying event B as `data`;
  expect rejection. Add a negative test for missing/unsupported `rawData`. Better, parse
  the event from the verified `rawBody` and remove the object/empty fallback.
- **Threatens 100%:** Yes. The suite currently blesses a path where unsigned event
  fields can be mapped after a signature check of different content.

### H2. Webhook amounts, currencies, and statuses are not validated

- **Severity:** High (money integrity)
- **Files:** `src/providers/zoho/webhook.ts:113-140`;
  `test/providers/webhook.test.ts:501-514`.
- **Why it is weak:** `getPayment` only checks that `payment.amount` and
  `payment.currency` are strings. `buildActionResult` then does
  `new BigNumber(amount)`. Medusa's `BigNumber` silently represents `""`, `"abc"`,
  `"NaN"`, and `"Infinity"` as NaN/Infinity; negative and zero amounts also pass. The
  only invalid-field test removes `amount` (`undefined`), so empty, non-numeric,
  non-finite, negative, and zero strings are untested. `payment.currency` is ignored
  entirely, and an event named `payment.succeeded` is mapped to `SUCCESSFUL` even if
  `payment.status` says `"failed"`.
- **Suggested test:** table-drive `payment.succeeded` and `payment.pending` with `amount`
  values `""`, `"abc"`, `"NaN"`, `"Infinity"`, `"-1"`, `"0"`, and `"0.001"`; expect a
  typed validation result rather than an action. Add currency/status contradiction
  cases. Assert the amount in a successful action is finite and strictly positive.
- **Threatens 100%:** Yes. The line/branch is covered, but the money boundary is not.

### H3. `payment.failed` tests use a session bridge Zoho webhooks do not provide

- **Severity:** High (false confidence in terminal failure reconciliation)
- **Files:** `test/fixtures/providers.ts:50-59` (default
  `payments_session_id: "zoho_sess_1"`),
  `test/providers/webhook.test.ts:302-318`, `test/providers/webhook.test.ts:398-419`;
  `src/providers/zoho/session-data.ts:126-150`, `180-196`.
- **Why it is weak:** Official Zoho webhook examples for `payment.succeeded`,
  `payment.pending`, and `payment.failed` show the payment object without
  `payments_session_id` and with `meta_data: []` (see the Zoho webhook-events docs linked
  in `docs/research/zoho-payments.md`). `buildZohoMetadataEntries` only writes
  `medusa_session_id` plus configured extras; it never writes `zoho_session_id`. The
  provider has no update-session API that could add it later. Therefore, if production
  matches the official examples, `extractZohoSessionId` returns `undefined` for every
  `payment.failed`, and the handler always keeps the Medusa session open. The tests pass
  because the fixture invents both `payments_session_id` and a
  `zoho_session_id` metadata entry that the provider never creates.
- **Suggested test:** use an unmodified official `payment.failed` sample (no session
  field, empty metadata, `failure_code` present). Assert the intended outcome: either
  retrieve the payment by `payment_id` to resolve the session, or return
  `PENDING_AUTHORIZATION` and document that terminal failure reconciliation cannot work.
  Add a fixture contract test that asserts the provider only emits correlation keys it
  actually writes.
- **Threatens 100%:** Yes. The 100% number is accurate, but the tested reconciliation
  path may not exist in production.

### H4. Positive amounts below the currency precision format to zero

- **Severity:** High (money correctness)
- **Files:** `src/core/amount.ts:104-111`, `121-124`;
  `src/providers/zoho/service.ts:161-168`, `408-425`;
  `test/core/amount.test.ts:189-286`, `test/providers/service-operations.test.ts:320-336`.
- **Why it is weak:** `isPositiveAmount("0.001")` is true, but
  `formatAmountForZoho("0.001", "INR")` returns `"0.00"` (verified against Medusa's
  `BigNumber`). For JPY, `0.1` and `0.4` become `"0"`. `initiatePayment` formats before
  checking positivity, and `refundPayment` checks positivity before formatting. Neither
  compares the formatted amount back to zero. The tests cover zero and negative inputs
  and tiny positive values for `isPositiveAmount`, but never the formatted boundary.
- **Suggested test:** initiate and refund `0.001`/`0.004` INR and `0.1`/`0.4` JPY; expect
  a validation error (or an explicitly documented rounding policy) and assert Zoho is
  never called with `"0.00"`/`"0"`. Add a test that the formatted result is positive
  before any Zoho request.
- **Threatens 100%:** Yes. The existing positivity branch is tested independently of
  formatting, so the actual money value sent is unverified.

### H5. A new session inherits stale payment and refund state from `input.data`

- **Severity:** High (wrong payment can be captured/refunded after a cart update)
- **Files:** `src/providers/zoho/service.ts:170-188`, `251-255`;
  `test/providers/service-initiate.test.ts:286-325`.
- **Why it is weak:** The return value is `{ ...input.data, ...sessionData }`.
  `sessionData` never sets `paymentId`, `paymentStatus`, `lastRefundId`,
  `lastRefundStatus`, or `lastRefundIdempotencyKey`. Any of those keys already present in
  `input.data` survive into the new Zoho session. A later `authorizePayment` or
  `refundPayment` can therefore act on the previous payment. The recreation tests start
  from first-session data with no payment fields, so this never happens in the suite.
- **Suggested test:** initiate once, add a synthetic `paymentId`, `paymentStatus`,
  `lastRefundId`, and `lastRefundIdempotencyKey`, change the amount/currency, and assert
  the new data clears all old payment/refund fields (or explicitly maps them as previous
  attempts). Also test that `previousZohoSessionIds` is bounded or documented.
- **Threatens 100%:** Yes. The merge statement is covered, but the stale-state outcome is
  not.

### H6. Session reuse ignores a captured status when `paymentId` is absent

- **Severity:** High/Medium (reuses a session after capture)
- **Files:** `src/providers/zoho/session-data.ts:202-218`;
  `src/providers/zoho/service.ts:170-188`;
  `test/providers/session-data.test.ts:357-367`,
  `test/providers/service-lifecycle.test.ts:237-255`,
  `test/providers/service-lifecycle.test.ts:116-130`.
- **Why it is weak:** The comment says a session is reusable only when unpaid, but
  `isReusableZohoSession` checks only `!existing.paymentId`. It does not call
  `isCapturedPaymentStatus(existing.paymentStatus)`. The lifecycle suite already proves
  that `paymentStatus: "succeeded"` can exist without `paymentId`: the
  "omits paymentId for a succeeded session without payments" test at lines 237-255
  produces exactly that state. `updatePayment` rejects it, but `initiatePayment` would
  reuse the session and return `PENDING`. A session that succeeded without a listed
  payment can therefore be reopened instead of replaced.
- **Suggested test:** fresh data with `zohoSessionId`, matching amount/currency/mode,
  `expiresAt` in the future, `paymentStatus: "succeeded"`, and no `paymentId`; expect a
  new session or an explicit state error. Add the same case for `refunded`,
  `partially_refunded`, and `disputed`.
- **Threatens 100%:** Yes. The predicate's true branch is covered only by an unpaid
  session, so the captured-status case is untested.

### H7. A payment from a superseded session is still mapped to the current Medusa session

- **Severity:** High/Medium (old-session payment race)
- **Files:** `src/providers/zoho/service.ts:246-248`;
  `src/providers/zoho/webhook.ts:178-195`;
  `test/providers/service-initiate.test.ts:286-325`.
- **Why it is weak:** Cart updates create a new Zoho session with the same Medusa
  `reference_number`/`metadata.medusa_session_id`; the old session remains open until it
  expires. `previousZohoSessionIds` is recorded but never consulted by the webhook
  handler. A late payment on the old widget therefore resolves to the same Medusa session
  and maps to `SUCCESSFUL` with the old amount. No test exercises this race.
- **Suggested test:** create session A, update to session B with a different amount, then
  deliver a signed `payment.succeeded` for A. Assert the intended policy (reject, route
  to a separate/reconciliation result, or verify the current session/amount before
  success). Also test duplicate delivery of the same event.
- **Threatens 100%:** Yes, semantically. There is no branch that detects the old session,
  so coverage cannot reveal the gap.

## Medium-severity findings

### M1. HTTP 2xx response with a non-zero Zoho `code` is untested

- **Severity:** Medium
- **Files:** `src/core/http.ts:185-208`;
  `test/core/http.test.ts:300-313` (only success envelopes), `315-445` (only HTTP 4xx/5xx
  errors).
- **Why it is weak:** The transport explicitly has an `isSuccessPayload` path for a
  successful HTTP response carrying a non-zero `code`, but no test supplies one. If Zoho
  (or a proxy) returns HTTP 200 with `{ code: 7001, message: "Invalid amount" }`, the
  code should produce a `ZohoApiError` with `statusCode: 200` and `zohoCode: "7001"`.
  That outcome is unasserted. A related gap is HTTP 200 with a string error code such as
  `"invalid_payment_session"`.
- **Suggested test:** `jsonResponse({ code: 7001, message: "Invalid amount" }, { status: 200 })`;
  assert the typed error, status 200, code, and no retry. Add a string-code variant.
- **Threatens 100%:** Partially. The branch is reachable and likely covered by the
  composite branch count, but the semantic outcome is not proven.

### M2. The widget request has no timeout or abort, despite the documented option

- **Severity:** Medium/High (hung checkout)
- **Files:** `src/client/index.ts:400-463` (timeout only passed to
  `loadZohoPaymentsScript` at 421-424; `requestPaymentMethod` at 429 is unbounded);
  `src/types.ts:96` ("script and the widget");
  `test/client/widget.test.ts:404-437` (only script timeout).
- **Why it is weak:** If the Zoho global exists but `requestPaymentMethod` never resolves,
  `payWithZohoCheckout` hangs forever and `closeWidget` never runs. The type comment says
  `timeoutMs` covers the widget; `docs/storefront-widget.md:391` describes it as a script
  timeout, so the code and one of the two documents disagree. No test covers a pending
  widget request.
- **Suggested test:** fake-timer test with `requestPaymentMethod` returning a never-
  resolving promise; advance past `timeoutMs`; expect a typed timeout (`reason: "failed"`
  or a new reason) and `close()` called. If a timeout is intentionally not supported,
  change the type/docs and add a test that the promise is passed through unchanged.
- **Threatens 100%:** Yes, semantically. No code branch exists for this timeout, so 100%
  cannot detect it.

### M3. Refund tests do not cover currency mismatch, over-refunds, or key/amount changes

- **Severity:** Medium
- **Files:** `src/providers/zoho/service.ts:414-439`;
  `test/providers/service-operations.test.ts:188-449`.
- **Why it is weak:** If `data.currencyCode` exists, `refundPayment` trusts it without
  comparing it to the payment's currency; if it does not exist, it uses the payment
  currency. A stale or wrong session currency can format a refund in the wrong currency.
  There is no test for an over-refund, a refund against a failed/canceled payment, or the
  same idempotency key with a different amount (the guard at lines 414-420 ignores the
  amount). A `canceled` refund status is recorded as success because only `"failed"` is
  special-cased.
- **Suggested test:** session currency INR plus payment currency USD; expect a typed
  mismatch or use the payment currency. Refund greater than `amount_captured`; expect a
  Zoho error mapping or a local guard. Same key with a changed amount; expect an explicit
  conflict, not a silent replay. Refund status `canceled`; assert the documented
  terminal/retry policy.
- **Threatens 100%:** Partially. The happy path is strong, but the money/state edges are
  unverified.

### M4. Every provider test injects a fake client; no test uses the real client through the provider

- **Severity:** Medium (contract drift)
- **Files:** `test/fixtures/providers.ts:89-255`; `test/providers/module.test.ts:43-50`;
  `src/providers/zoho/service.ts:141-156`.
- **Why it is weak:** The fake client implements the same TypeScript interface, but it
  returns hand-written objects. Provider tests never exercise the real
  `ZohoPaymentsClient` composition: region URLs, token acquisition, request body shape,
  response unwrapping, and error conversion. The module test constructs the real client
  but only calls `deletePayment`, which performs no network operation. A provider/client
  wiring bug (wrong URL, missing token, wrong field name) would pass all provider tests.
- **Suggested test:** instantiate the provider with `options.fetch` pointing at a fake
  transport and call `initiatePayment`, `authorizePayment`, and `refundPayment`; assert
  the real client's token request, URL, JSON body, and response mapping. This is a
  narrow integration test, not a full Medusa boot.
- **Threatens 100%:** No numeric threat; yes, a meaningful-coverage gap.

### M5. No cross-module test connects the widget helper result to the server signature verifier

- **Severity:** Medium
- **Files:** `src/client/index.ts:42-46`, `441-446`;
  `test/client/widget.test.ts:543-584`;
  `test/core/signatures.test.ts:405-425`.
- **Why it is weak:** The helper returns `paymentSessionId: session.zohoSessionId` and
  ignores any `payment_session_id` field in Zoho's response. Official signature docs
  describe the widget response as `payment_id|payment_session_id`; the client interface
  does not model `payment_session_id`, and the fixture response omits the official
  `message` and `payment_session_id` fields. The two halves are tested independently, but
  no test takes `payWithZohoCheckout`'s result and verifies it with
  `isValidZohoWidgetResponseSignature`. A field-name drift would go unnoticed.
- **Suggested test:** stub a response shaped like the official widget success payload,
  compute the signature over the official IDs, call the helper, then verify its result
  with the server helper. Include a case where the response session ID differs from the
  session used to open the widget.
- **Threatens 100%:** Partially; no numeric branch is missing, but the integration is
  unverified.

### M6. Missing account IDs and contradictory event/status combinations are accepted

- **Severity:** Medium
- **Files:** `src/providers/zoho/webhook.ts:89-110`;
  `test/providers/webhook.test.ts:187-237`, `501-514`.
- **Why it is weak:** `assertAccountAndMode` rejects only when `account_id` is present
  and differs. An event with no `account_id` is accepted. The tests cover a mismatch, a
  numeric account, and a matching/missing live mode, but never a missing account ID. An
  event with `event_type: "payment.succeeded"` and `payment.status: "failed"` also
  returns `SUCCESSFUL`. These are malformed/partial payload cases the signature alone
  does not catch.
- **Suggested test:** remove `account_id` from a signed event; expect the documented
  policy (reject or accept with explicit rationale). Add contradictory
  event/status pairs, empty `currency`, and empty `payment_id` cases.
- **Threatens 100%:** No numeric threat; yes, semantic.

### M7. The root export surface is not tested and its 100% coverage is vacuous

- **Severity:** Medium/Low
- **Files:** `src/index.ts:1-77`, `src/server/index.ts:1-38`,
  `src/providers/zoho/index.ts:1-15`;
  `coverage/coverage-summary.json` reports 0/0 lines for these files;
  `scripts/verify-package.mjs:228-268`; `docs/testing.md:101`.
- **Why it is weak:** The files contain no statements, so V8 reports 100% without any
  test. `verify-package.mjs` imports the client, provider loader, server entry, and
  `package.json`, but never imports the package's main root export (`medusa-payment-zoho`).
  The docs claim the root export is checked by build/pack/verifier; it is not checked at
  runtime. Missing or misnamed root exports can therefore pass the test suite.
- **Suggested test:** add a unit test that imports `src/index.ts` and asserts every
  documented named export, plus a packaged-consumer import of the root entry. Add the
  browser purity assertion to the test/CI suite (the verifier already implements the
  scan; see docs finding D3).
- **Threatens 100%:** No, but the 100% for these files is not evidence of anything.

### M8. Duplicate webhook delivery is acknowledged as a known gap but has no test

- **Severity:** Medium/Low
- **Files:** `src/providers/zoho/webhook.ts:143-253`;
  `docs/decisions/ADR-0004-webhook-authorization.md:96-102`;
  `docs/testing.md:441-443`.
- **Why it is weak:** Zoho delivery is at-least-once and `event_id` is intentionally
  ignored. The suite proves the handler is read-only, but never sends the same signed
  event twice and asserts the same action / no duplicate side effect. There is no
  `event_id` dedupe store, and the fixture uses `event_id: "evt_1"` rather than the
  large numeric IDs in official payloads.
- **Suggested test:** deliver the same signed payload twice and assert identical
  `WebhookActionResult`s; at the Medusa integration level, assert the payment workflow is
  idempotent. If dedupe is expected, add a store test with official numeric event IDs.
- **Threatens 100%:** No numeric threat; duplicate-delivery safety is not proven.

### M9. `cancelPayment` does not test already-canceled/expired payment states

- **Severity:** Low/Medium
- **Files:** `src/providers/zoho/service.ts:368-395`;
  `test/providers/service-operations.test.ts:103-185`.
- **Why it is weak:** The suite covers captured, failed, and pending statuses, but not
  `canceled` or `expired`. Both fall through to the "Pending Zoho payments cannot be
  cancelled" error, which is misleading for an already-canceled payment. The official
  payment status list does not include `expired`, so this is lower priority, but the
  status mapper explicitly supports `canceled`.
- **Suggested test:** `retrievePayment` returns `canceled`/`expired`; assert a no-op or a
  precise state error, not the pending message.
- **Threatens 100%:** No numeric threat; semantic only.

## Low-severity and coverage-only findings

### L1. Several branches are proven only through impossible values or test-only casts

- **Severity:** Low/Medium (coverage meaningfulness)
- **Files and tests:**
  - `src/core/amount.ts:28`, `55`: fallback `maximumFractionDigits` and missing currency
    part are reached with a mocked `Intl.NumberFormat`
    (`test/core/amount.test.ts:129-137`, `162-166`). Real Node Intl returns both for a
    valid three-letter code.
  - `src/core/amount.ts:86-88`: the `!decimal` branch is reached by replacing the real
    `BigNumber` with a class that has no `bigNumber`
    (`test/core/amount.test.ts:226-247`). The real class either exposes a decimal or
    throws.
  - `src/core/amount.ts:29-33`, `56-60`: Intl failures are simulated with a mock for a
    valid currency (`test/core/amount.test.ts:113-127`, `175-186`).
  - `src/core/oauth.ts:213-216`: the non-Error `lastError` fallback is reached by making
    the injected clock throw a string (`test/core/oauth.test.ts:793-814`). A realistic
    non-Error fetch rejection would be a better trigger.
  - `src/providers/zoho/service.ts:614-638`: missing widget API key / hosted URL guards
    are reached by overwriting the private `zohoConfig` with `{}`
    (`test/providers/service-initiate.test.ts:610-637`). The public constructor's option
    validation makes both states impossible.
  - `src/providers/zoho/webhook.ts:53-63`: object and unsupported `rawData` handling are
    reached only by casting values outside Medusa's `string | Buffer` type
    (`test/providers/webhook.test.ts:62-89`); see H1.
- **Why it is weak:** These tests raise line/branch coverage without demonstrating a
  production-reachable outcome. A defensive branch can be acceptable, but the 100%
  report reads as if the behaviour is exercised.
- **Suggested test/action:** either remove the dead guard, move validation to a single
  reachable boundary, or document the branch as defensive and justify it in
  `docs/testing.md` (AGENTS.md requires a written justification for `v8 ignore`; the same
  standard should apply to coverage-only tests). For OAuth, reject with a non-Error from
  `fetch`, which is the realistic path.
- **Threatens 100%:** Yes, in the sense that part of the 100% is propped up by test-only
  states, not production behaviour.

### L2. Weak assertions and implementation-coupled tests

- **Severity:** Low
- **Files:** `test/providers/module.test.ts:26`
  (`expect(isPaymentProvider(provider)).toBeTruthy()`);
  `test/core/logger.test.ts:6-12` (only `not.toThrow`);
  `test/core/signatures.test.ts:355-362` (only `not.toThrow` for a valid signature);
  `test/providers/service-initiate.test.ts:610-637` (mutates private config);
  `test/providers/service-lifecycle.test.ts:316-332` (uses the real timer despite
  `docs/testing.md:153` saying never to wait).
- **Why it is weak:** The first three are not wrong, but they assert less than the
  behaviour they name. The private-config test is coupled to implementation and bypasses
  the validation boundary. The real-sleep test is a small isolation/performance
  inconsistency, not a correctness risk.
- **Suggested test:** assert the exact boolean/instance/export; exercise guards through
  a public factory or remove them; replace the real sleep with the injected fake used by
  the rest of the suite.
- **Threatens 100%:** No, but these tests contribute little confidence.

### L3. Test isolation is mostly strong, with two fragile spots

- **Severity:** Low
- **Files:** `test/providers/options.test.ts:26-33`, `517-525` (module-level
  `hasWarnedMissingSigningKey` reset by test-only function);
  `test/client/widget.test.ts:887-902` (`queueMicrotask` deletes the widget global to
  simulate a race); `test/client/widget.test.ts:193-203` (cache/DOM cleanup).
- **Why it is weak:** The global warning flag is shared state that only works because
  every relevant describe resets it. The microtask race is timing-dependent and could
  become flaky under a different scheduler. Other than these, fake timers, env stubs,
  global stubs, module caches, and DOM state are cleaned up correctly; no test-order
  dependence was observed.
- **Suggested test/action:** reset the warning in a global `beforeEach` or move it into a
  per-instance object; replace the microtask race with an explicit injectable hook or a
  deterministic fake timer. Keep the existing cleanup discipline.
- **Threatens 100%:** No.

### L4. No huge-input or resource-bound tests

- **Severity:** Low/Medium
- **Files:** `src/providers/zoho/options.ts:223-267` (metadata values capped, keys not);
  `src/providers/zoho/session-data.ts:33-37` (previous session IDs unbounded);
  `src/core/amount.ts:104-111` (arbitrarily large exponent expands);
  `src/providers/zoho/webhook.ts:53-63` (no body size limit).
- **Why it is weak:** The tests cover long invoice IDs and a 20-digit amount, but not a
  very large metadata key, a very large `allowedPaymentMethods` array, thousands of
  previous sessions, or a huge webhook body. A malformed/oversized signed event can
  consume memory or create an oversized request. Zoho will reject some values, but the
  plugin's local boundary is untested.
- **Suggested test:** table-driven maximum/over-limit metadata key lengths, a large
  webhook body, and a long growth path for `previousZohoSessionIds`. Assert a typed
  validation error or documented truncation, not an unbounded request.
- **Threatens 100%:** No numeric threat; resilience is unverified.

## Coverage configuration and CI

### Coverage configuration — clean, with one vacuous area

- `vitest.config.ts` includes `src/**/*.ts`, excludes only declaration files and
  `src/types.ts` / `src/**/types.ts`. No runtime module is hidden.
- There are no `v8 ignore` / `istanbul ignore` directives under `src/`.
- Thresholds are 100 for all four metrics, and `pnpm test:coverage` actually passes.
- The only vacuous 100s are the zero-statement re-export files
  (`src/index.ts`, `src/providers/zoho/index.ts`, `src/server/index.ts`), which report
  0/0 lines in `coverage/coverage-summary.json`. This is not an exclusion, but it means
  the 100% does not cover the public root export surface (M7).
- The text reporter prints an empty file table when every file is at 100%, so the CI
  log does not show per-file rows; the independent summary check is what matters.

### CI — correct gate, currently blocked earlier

- `.github/workflows/ci.yml:47-57` runs `pnpm test:coverage`, and lines 61-83
  independently verify all four metrics from `coverage/coverage-summary.json`.
- The test script has no `--passWithNoTests` or equivalent silent-success option.
  `pnpm test:coverage` is `vitest run --coverage`, so a missing suite fails by Vitest
  default.
- CI runs the same suite on Node 22 and 24. Node 20 is declared in `engines` but not
  tested; `docs/testing.md` acknowledges this.
- **However**, CI runs `pnpm format:check` before the coverage step
  (`.github/workflows/ci.yml:50-54`). In this checkout, `pnpm format:check` fails on six
  files (`docs/configuration.md`, `docs/PROGRESS.md`, `docs/traceability.md`, `README.md`,
  `scripts/patch-cjs-provider.mjs`, `scripts/verify-package.mjs`). The CI job would stop
  before running the 100% gate. This is a loud failure, not a silent one, but the
  coverage gate is not actually reached in the current tree.
- `pnpm pack:check` currently exits 0 in this checkout, despite `docs/testing.md`
  claiming it fails. See the docs table below.

## Fixtures against official Zoho and Medusa shapes

**What is realistic:**

- Session creation/retrieval envelopes use `{ code: 0, message, payments_session }` and
  `payments_session_id`; official Zoho examples match.
- `expiry_time` is seconds in fixtures and normalization has a millisecond branch.
- Payment and refund resources use string amounts/currencies and the documented
  `payment_id` / `refund_id` fields.
- Hosted-checkout signature tests use the official ten-field dot-joined order and empty
  optional fields; this matches the Zoho hosted-checkout docs.
- Webhook tests use `t=<epoch-ms>,v=<hex>` over the exact raw body, matching the official
  verification recipe.
- Medusa `ProviderWebhookPayload` shape is respected by the normal fixtures
  (`rawData` string/Buffer, `data` record, `headers` record).

**Where fixtures diverge from production:**

1. `payment.failed` fixtures add `payments_session_id` and a synthetic
   `zoho_session_id` metadata entry; official webhook examples do not include either
   (H3).
2. Official webhook `event_id` values are large numeric values beyond
   `Number.MAX_SAFE_INTEGER`; the fixture uses `"evt_1"`. The provider ignores event IDs,
   so this is only a future dedupe risk.
3. Official widget success examples include `message` and, depending on the docs page,
   `payment_session_id`; the client fixture includes neither. The helper returns the
   local `zohoSessionId` rather than reading the response field (M5).
4. Official API error envelopes often use string codes such as
   `"invalid_payment_session"`; transport error tests predominantly use numeric codes.
5. No fixture is a captured real Zoho payload. The suite is documented as fake-only and
   the live smoke test does not exercise webhooks, refunds, or failure paths, so official
   shape drift cannot be detected in CI.

## Docs/testing.md accuracy

| Claim                 | Documented                                                                               | Actual / finding                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test count            | 707 (`docs/testing.md:73`, `401`)                                                        | 708                                                                                                                                                                  |
| Statements            | 936/936 (`docs/testing.md:74`)                                                           | 938/938                                                                                                                                                              |
| Branches              | 850/850 (`docs/testing.md:75`)                                                           | 854/854                                                                                                                                                              |
| Lines                 | 934/934 (`docs/testing.md:77`)                                                           | 936/936                                                                                                                                                              |
| Format check          | Fails on `docs/PROGRESS.md` and `test/providers/module.test.ts` (`docs/testing.md:404`)  | Fails on six files: `docs/configuration.md`, `docs/PROGRESS.md`, `docs/traceability.md`, `README.md`, `scripts/patch-cjs-provider.mjs`, `scripts/verify-package.mjs` |
| `pnpm pack:check`     | Fail (`docs/testing.md:405`)                                                             | Exits 0 in this checkout                                                                                                                                             |
| Browser-bundle purity | Verifier does not enforce it (`docs/testing.md:434-438`)                                 | `scripts/verify-package.mjs:137-154` scans `dist/client` for `node:` and `@medusajs/` and fails on a match                                                           |
| Root export check     | `src/index.ts` checked by build/pack/verifier (`docs/testing.md:101`)                    | Verifier imports client, provider, server, and package.json only; it never imports the root entry (`scripts/verify-package.mjs:228-268`)                             |
| No real waits         | "Never make a test wait for a real retry or poll" (`docs/testing.md:153`)                | `test/providers/service-lifecycle.test.ts:316-332` deliberately uses the real timer                                                                                  |
| Raw-body rule         | "Do not parse and re-serialize JSON between signing and sending" (`docs/testing.md:245`) | `test/providers/webhook.test.ts:62-76` signs a re-serialized object and maps a larger `data` object; H1                                                              |

The docs are otherwise accurate about the major limitations: no live Zoho sandbox, no
full Medusa application fixture, no real-browser E2E, no durable webhook event store, and
manual refund/webhook verification. The stale numbers and the purity/format/pack claims
should be corrected before the document is used as a release gate.

## Genuinely strong areas

- **Signatures:** exact HMAC vectors, wrong key/body/identifier, non-hex and wrong-length
  signatures, empty signature rejection, v1 alias, duplicate header, UTF-8 Buffer,
  tolerance inside/outside/disabled, future timestamps, and missing-key failure. These
  are the strongest tests in the repository.
- **Amount utilities:** ISO fraction digits for INR/USD/JPY/KWD, zero/three-decimal
  currencies, invalid codes, invalid/NaN/Infinity amounts, negative zero, large
  (20-digit) inputs, no binary floating point, and symbol overrides.
- **HTTP transport:** exact URL/query/header/body assertions, success envelope variants,
  401 refresh-once, second-401 stop, safe vs `none` retry policy, network/429/5xx
  classification, Retry-After seconds/date/cap, body-read timeout, retry exhaustion, and
  log redaction.
- **OAuth:** request shape, cache and safety window, short-lived token margin, single-
  flight refresh, invalidation, retryable vs terminal failures, timeout, and secret
  redaction in messages and causes.
- **Provider lifecycle:** exact create payloads, reuse by amount/currency/mode/expiry,
  hosted URL encoding, polling until success/exhaustion, status mapping, capture/cancel
  rules, refund formatting/fallback/idempotency, and typed Medusa error translation.
- **Browser helper:** script append/reuse, in-flight de-duplication, error/timeout cleanup
  and retry, widget instance caching, close-on-all-paths, official-ish widget errors,
  hosted redirect, and SSR safety.
- **Isolation:** fake clocks/sleep/fetch, fake timers, env cleanup, DOM/cache cleanup,
  and no observed test-order dependence. The fixture's unconfigured operations throw
  loudly instead of silently succeeding.
- **CI enforcement:** exact thresholds, an independent summary check, no
  `passWithNoTests`, and a Node 22/24 matrix.

## Missing adversarial-case matrix

| Case                                                                  | Covered?               | Where / gap                                                         |
| --------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| Malformed webhook JSON / missing `event_type`                         | Yes                    | `test/providers/webhook.test.ts:516-548`                            |
| Signed raw body differs from `payload.data`                           | **No**                 | H1                                                                  |
| Empty/NaN/Infinity/negative/zero webhook amount                       | **No**                 | H2                                                                  |
| Webhook currency mismatch / contradictory status                      | **No**                 | H2, M6                                                              |
| Missing account ID                                                    | **No**                 | M6                                                                  |
| Duplicate webhook delivery / `event_id` precision                     | **No**                 | M8                                                                  |
| Huge webhook body / huge metadata key                                 | **No**                 | L4                                                                  |
| Old-session payment after cart update                                 | **No**                 | H7                                                                  |
| Stale `paymentId` after new session                                   | **No**                 | H5                                                                  |
| Captured status without `paymentId` on initiate                       | **No**                 | H6                                                                  |
| Sub-precision amount (0.001 INR)                                      | **No**                 | H4                                                                  |
| Refund currency mismatch / over-refund                                | **No**                 | M3                                                                  |
| Refund idempotency key with changed amount                            | **No**                 | M3                                                                  |
| Refund network timeout through `createRefund`                         | Partial                | HTTP `none` policy covered; client-level refund timeout not         |
| 401 refresh-once / second 401                                         | Yes                    | `test/core/http.test.ts:447-505`                                    |
| Retry exhaustion (429/5xx/network)                                    | Yes at transport/OAuth | `test/core/http.test.ts:620-760`, `test/core/oauth.test.ts:498-523` |
| Provider retry exhaustion / auth failure through real client          | **No**                 | M4                                                                  |
| Widget script timeout                                                 | Yes                    | `test/client/widget.test.ts:404-437`                                |
| Widget request timeout/abort                                          | **No**                 | M2                                                                  |
| Widget response official `payment_session_id` / cross-module verifier | **No**                 | M5                                                                  |
| Root/server export surface                                            | **No**                 | M7                                                                  |
| Huge `previousZohoSessionIds` growth                                  | **No**                 | L4                                                                  |

## Prioritized tests to add

1. **Webhook: signed-body/data mismatch and invalid raw body.** Sign event A, pass event
   B as `data`; expect rejection. Add `rawData` absent/unsupported tests. This is the
   highest-value security test (H1).
2. **Webhook amount/currency/status validation.** Cover empty, `NaN`, `Infinity`,
   negative, zero, sub-precision, unknown currency, and contradictory statuses. Assert
   finite positive amounts only (H2).
3. **Official `payment.failed` fixture.** Use a real documented sample with no
   `payments_session_id` and empty metadata; assert the intended reconciliation or
   explicitly fail closed. Remove the synthetic `zoho_session_id` fixture (H3).
4. **Session rotation tests.** Stale `paymentId`/refund fields, captured status without
   `paymentId`, and a late payment from a superseded session (H5-H7).
5. **Sub-precision money tests.** Initiate and refund 0.001/0.004 INR and 0.1/0.4 JPY;
   assert no zero-valued Zoho request (H4).
6. **Widget request timeout.** Never-resolving `requestPaymentMethod` with fake timers;
   expect a typed timeout and `close()` (M2).
7. **Refund edge tests.** Currency mismatch, over-refund, failed/canceled payment, changed
   amount under the same idempotency key, and network timeout at the client boundary
   (M3).
8. **HTTP 200 error envelope.** Non-zero numeric and string Zoho codes; assert
   `ZohoApiError` status/code and no retry (M1).
9. **Provider + real `ZohoPaymentsClient` contract test.** Inject a fake transport into
   provider options and exercise initiate/authorize/refund through the real client (M4).
10. **Cross-module widget signature test.** Official widget response shape, helper result
    verified by `isValidZohoWidgetResponseSignature` using `payment_session_id` (M5).
11. **Root export/package test.** Import the root entry and assert every documented
    export; add the client purity scan to the normal test/CI command (M7, D3).
12. **Duplicate webhook and large-input tests.** Same signed event twice; huge metadata
    keys/body; bounded `previousZohoSessionIds` (M8, L4).
13. **Fix the test-only branches.** Replace impossible-value mocks with reachable
    triggers where possible; otherwise document the defensive branches and stop treating
    them as behavioural evidence (L1).
14. **Docs/test hygiene.** Update the test counts, format/pack status, purity claim, root
    verifier claim, and the "no real sleep" rule in `docs/testing.md` (D1-D6).

## Documentation findings (D)

- **D1:** `docs/testing.md:69-78` and `:401` report 707 tests and 936/850/934 metrics;
  the actual run is 708 and 938/854/936. Re-run the suite when updating the table.
- **D2:** `docs/testing.md:404` says format fails on two files; actual failure list has
  six. This matters because CI runs format before coverage.
- **D3:** `docs/testing.md:434-438` says the verifier does not scan `dist/client`; it does
  (`scripts/verify-package.mjs:137-154`). This limitation is stale.
- **D4:** `docs/testing.md:405` says `pnpm pack:check` fails; it exits 0 here.
- **D5:** `docs/testing.md:101` claims the root export is checked by the verifier; the
  verifier never imports the package root.
- **D6:** `docs/testing.md:153` says tests never wait on real timers; one test does
  (`test/providers/service-lifecycle.test.ts:316-332`).
- **D7:** `docs/testing.md:245` says not to re-serialize before signing, but the webhook
  test at `test/providers/webhook.test.ts:62-76` does exactly that and accepts a larger
  `data` object.

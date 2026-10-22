# Correctness review — `medusa-payment-zoho`

- **Date:** 2026-10-23
- **Scope:** Independent read-only correctness review of the provider, browser helper, webhook
  handling, options, tests, and documentation.
- **Baseline:** `@medusajs/framework` / `@medusajs/medusa` **2.22.0** (installed source inspected),
  Node 22, Zoho Payments India/US documentation fetched 2026-10-23.
- **Verification run:** `pnpm typecheck` pass; `pnpm test` **708 passed / 17 files**;
  `pnpm test:coverage` **100%** statements/branches/functions/lines.
- **Live Zoho sandbox:** not available in this repository. Items that depend on a live Zoho
  response are marked **needs live verification** rather than asserted.
- **Changes made:** this file only. No source, tests, `package.json`, or existing docs were
  modified. Nothing was committed.

---

## 1. Executive summary

The implementation is structurally sound: the Medusa v2.22 method surface is present, the
transport and OAuth layers are careful, webhook/widget HMAC mechanics match Zoho's published
formulas, and the browser helper has no Node or Medusa imports. The normal card checkout path is
close to correct.

However, **there are two release-blocking correctness defects and a set of high-severity money
and compatibility problems**:

1. **Client-supplied payment-session `data` is trusted for provider-owned state.** A storefront
   caller can inject a `paymentId` or `zohoSessionId` (plus amount/currency/expiry) into
   `POST /store/payment-collections/:id/payment-sessions`; the provider reuses it without
   verifying that it belongs to the Medusa session or that the amounts match. This permits a
   free order/replay of an already-captured Zoho payment. **COR-01**
2. **The hosted-checkout return signature message is missing `mandate_id`.** Zoho documents a
   twelve-field message with `mandate_id` between `amount` and `udf1`. The code, types, tests,
   ADR, and user guides all implement a ten-field message. Every genuine hosted return signature
   fails verification. **COR-02**

Also high severity:

3. `created` (the normal initial Zoho session status) maps to `PENDING_AUTHORIZATION`. Medusa
   treats that status as deferred authorization and can create an order without a payment. **COR-03**
4. The webhook verifies `rawData` but maps the independently supplied `payload.data`; object
   bodies are re-serialized for signing. **COR-04**
5. Authorization/capture never compares the Zoho amount/currency with the Medusa session amount.
   **COR-05**
6. The declared Medusa peer range starts at `2.16.0`, but `PENDING_AUTHORIZATION` only exists
   from **2.17.2**. **COR-06**
7. The Zoho request schema declares `amount` as a JSON **number** (`double`), while the client
   sends a JSON **string**. Needs live verification; if Zoho is strict, every session create and
   refund fails. **COR-07**

### Findings at a glance

| ID     | Severity     | Finding                                                                                | Primary location                                                            | Live check needed                |
| ------ | ------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| COR-01 | **Critical** | Client-controlled session data selects/replays an arbitrary Zoho payment or session    | `src/providers/zoho/service.ts:170-188, 251-255`; `session-data.ts:202-218` | No (code path is deterministic)  |
| COR-02 | **Critical** | Hosted return signature omits `mandate_id` (10 vs 12 fields)                           | `src/core/signatures.ts:33-45, 194-216`; docs/tests                         | No (Zoho documents it)           |
| COR-03 | **High**     | `created` session status → `PENDING_AUTHORIZATION` permits an unpaid order             | `src/core/status.ts:10-14`; `service.ts:580-601`                            | No                               |
| COR-04 | **High**     | Webhook verifies `rawData` but maps `payload.data`; object bodies are re-serialized    | `webhook.ts:53-63, 155-175`                                                 | No                               |
| COR-05 | **High**     | No Zoho amount/currency reconciliation before `CAPTURED`/capture success               | `service.ts:331-352, 580-601`; `webhook.ts:129-141`                         | No                               |
| COR-06 | **High**     | Peer range `>=2.16.0` includes versions without `PENDING_AUTHORIZATION`                | `package.json:114-116`; `core/status.ts:14`; docs                           | No                               |
| COR-07 | **High**     | Session/refund `amount` sent as JSON string; OpenAPI requires number                   | `zoho-client.ts:102-108, 212-217`                                           | **Yes**                          |
| COR-08 | Medium       | `payment.failed` later reconciled to success uses the failed attempt's amount          | `webhook.ts:218-225`                                                        | No                               |
| COR-09 | Medium       | `FAILED` webhook action is ignored by Medusa; docs claim it marks the session failed   | `webhook.ts:228-236`; Medusa subscriber; docs                               | No                               |
| COR-10 | Medium       | Canceled refund treated as success; replay guard ignores amount/status                 | `service.ts:412-461`                                                        | No                               |
| COR-11 | Medium       | Sub-precision positive amount formats to `"0.00"` after positivity check               | `service.ts:161-168, 408-425`; `amount.ts:104-111`                          | No                               |
| COR-12 | Medium       | Payments from superseded Zoho sessions still map to the current Medusa session         | `service.ts:246-248`; `webhook.ts:160-201`; docs                            | No                               |
| COR-13 | Medium       | Account/live-mode checks fail open when fields are absent                              | `webhook.ts:89-111`                                                         | Partly (live_mode presence)      |
| COR-14 | Medium       | Docs say the provider output `id` is the Medusa session id; Medusa 2.22 ignores it     | `ADR-0003`, `docs/architecture.md`; Medusa source                           | No                               |
| COR-15 | Low          | Metadata cap/arithmetic and the reserved `zoho_session_id` fallback are inconsistent   | `options.ts:31-33, 238-241`; `session-data.ts:179-196`; docs                | No                               |
| COR-16 | Low          | Polling semantics differ from docs; `requires_more` is polled; `0` interval is ignored | `service.ts:548-565`; `status.ts:57-70`; docs                               | No                               |
| COR-17 | Low          | `timeoutMs` only covers script loading; `session_expired` maps to failed, not expired  | `src/client/index.ts:400-462`; `src/types.ts:96`                            | Partly (instance reuse/response) |
| COR-18 | Low          | `toMedusaError` discards `retryable`, status, and request ID; logs only the code       | `service.ts:650-679`                                                        | No                               |
| COR-19 | Low          | "ISO-4217 validation" is only a three-letter regex; `ABC` is accepted                  | `amount.ts:8-17`; docs                                                      | No                               |
| COR-20 | Low          | Documentation drift (test counts, ADR test pointer, log/refund claims)                 | multiple docs                                                               | No                               |

**Release recommendation:** do not tag `1.0.0` until **COR-01 through COR-07** are resolved
(each P0 item in the checklist). COR-08–COR-13 should be fixed or explicitly accepted in a
written ADR before live traffic.

---

## 2. Findings

### COR-01 — Critical — Client-controlled payment-session data can select an arbitrary Zoho payment or session

**Files/lines**

- `src/providers/zoho/service.ts:170-188` (reuse branch)
- `src/providers/zoho/service.ts:251-255` (new-session return)
- `src/providers/zoho/session-data.ts:202-218` (`isReusableZohoSession`)
- `src/providers/zoho/service.ts:311-325` (authorization consumes `paymentId`/`zohoSessionId`)
- Medusa route: `@medusajs/medusa/dist/api/store/payment-collections/[id]/payment-sessions/route.js`
  (client `data` is passed through)
- Medusa module: `@medusajs/payment/dist/services/payment-module.js:159-171` (stores
  `{ ...input.data, ...providerData }`)

**Expected**

The provider must treat storefront-supplied `data` as untrusted. Only Medusa's injected
`data.session_id` should be authoritative. A provider-owned `zohoSessionId`, `paymentId`,
`amount`, `currencyCode`, `expiresAt`, `checkoutMode`, or refund field must never be accepted
from the caller as proof of a paid session. Any reuse must be checked against Zoho and/or a
server-side allowlist for that Medusa session.

**Actual**

`initiatePayment` parses `input.data` with `parseZohoSessionData` and:

- if `existing.zohoSessionId` looks reusable, returns it immediately with **no Zoho API call**
  (`service.ts:173-187`);
- otherwise creates a new Zoho session but returns `{ ...input.data, ...sessionData }`, which
  preserves a caller-supplied `paymentId`, `paymentStatus`, `lastRefundId`,
  `lastRefundIdempotencyKey`, stale `widget`/`checkoutUrl`, etc.

`isReusableZohoSession` trusts the caller's `amount`, `currencyCode`, `checkoutMode`, and
`expiresAt`. Medusa's storefront route accepts arbitrary `data`
(`StoreCreatePaymentSession` is `data: z.record(z.unknown()).optional()`), and the payment
module passes it to the provider with `session_id` added.

`authorizePayment` then trusts `data.paymentId` and `data.zohoSessionId` as the payment/session
to inspect. There is no check that the Zoho payment's `payments_session_id`, `reference_number`,
metadata, amount, or currency belongs to this Medusa session.

**Impact**

A storefront caller can:

1. supply `data: { paymentId: "<a succeeded payment>" }`; the new session keeps it, and
   `cart.complete()` retrieves that payment and returns `CAPTURED`; or
2. supply `data: { zohoSessionId: "<a succeeded session>", amount: "<cart amount>",
currencyCode: "INR", checkoutMode: "widget", expiresAt: <future> }`; the provider reuses the
   session without calling Zoho, and authorization retrieves it.

Either path can complete a new cart without a new charge, reuse a small payment to pay a larger
cart, and replay one Zoho payment across multiple carts. The same injected `paymentId` later
drives `capturePayment`, `retrievePayment`, `getPaymentStatus`, and `refundPayment`, so a later
admin refund can target the wrong Zoho payment.

**Recommended fix**

- Split parsing into "trusted stored provider data" and "untrusted caller data". Never read
  provider-owned fields from caller data in `initiatePayment`/`updatePayment`.
- On create, build `data` solely from `data.session_id` (injected by Medusa), provider options,
  and the Zoho response.
- Never accept `paymentId` from input; only set it from a Zoho session/payment response.
- If session reuse is retained, keep a server-side map keyed by the Medusa session id (or a
  signed opaque token) and verify the Zoho session's `reference_number`/`meta_data` equals
  `session_id`, plus amount/currency, before reuse.
- Sanitize mode-specific fields on every rebuild so a hosted `checkoutUrl` does not survive a
  switch to widget mode.
- Consider rejecting any caller-supplied `zohoSessionId`/`paymentId` outright (fail closed).

**Test gap**

No test passes a malicious `data` object. Current tests intentionally preserve `custom` data
(`test/providers/service-initiate.test.ts:65-82`) but never prove that provider-owned keys are
ignored. Add tests for injected `paymentId`, `zohoSessionId`, `amount`, `expiresAt`,
`paymentStatus`, `lastRefund*`, and stale `widget`/`checkoutUrl`. Add an integration test that
boots Medusa and attempts `cart.complete()` with each injected shape.

---

### COR-02 — Critical — Hosted-checkout return signature omits `mandate_id`

**Files/lines**

- `src/core/signatures.ts:33-45` (`ZohoHostedCheckoutSignatureInput` has no `mandateId`)
- `src/core/signatures.ts:194-216` (message is ten fields, amount followed by `udf1`)
- `docs/signatures.md:197-214, 330-336`
- `docs/storefront-hosted.md:128-142, 181-196, 255-267`
- `docs/decisions/ADR-0007-signature-verification.md:70-81`
- `docs/decisions/ADR-0002-checkout-architecture.md:79`
- `docs/research/zoho-payments.md:161-169`
- `test/core/signatures.test.ts:486-573` (test vectors lock the wrong message)

**Expected**

Zoho's Hosted Checkout documentation specifies:

```text
payments_session_id.payment_session_status.payment_id.payment_status.amount.mandate_id.udf1.udf2.udf3.udf4.udf5
```

Absent optional fields contribute an empty string, and their separators remain. The published
example is:

```text
4000000106013.succeeded.4000000106034.succeeded.5.000..customerid1234.orderref5678.productskuabc.merchantrefxyz.campaignsummer24
```

Note the **double dot after `5.000`**: the first dot separates `amount` from the empty
`mandate_id`, the second separates that empty field from `udf1`.

Source: <https://www.zoho.com/in/payments/developerdocs/web-integration/hosted-checkout/>
(section 5, “Verify Signature”), fetched 2026-10-23.

**Actual**

The implementation, its type, the ADR, both storefront guides, the research note, and the unit
test vectors all construct a **ten-field** message with no `mandate_id`. With all optional
fields empty, the code signs `sess_789.succeeded........` (eight dots) instead of the documented
twelve-field message (ten dots after `succeeded`). With fields present, the implementation is one
separator short after `amount`.

**Impact**

Every genuine Zoho hosted-checkout return fails signature verification. A merchant following
the documented success route rejects paid customers and never calls `cart.complete()`. The
signed webhook may eventually recover the order, but if webhooks are delayed, disabled, or the
return is the only completion path, the customer is stuck after payment. The package currently
also exposes a public verifier that can never validate a real Zoho return.

**Recommended fix**

- Add `mandateId?: string` to `ZohoHostedCheckoutSignatureInput` and insert
  `input.mandateId ?? ""` between `amount` and `udf1`.
- Update the success/failure route examples to pass `mandate_id` from the query string.
- Update the signatures guide, hosted guide, ADR-0002/ADR-0007, and research note.
- Replace the test vector with Zoho's published example (including the empty `mandate_id`) and
  add present/absent mandate cases, plus a wrong-field-count case that now expects the
  twelve-field behavior.
- This is a public API addition; per `AGENTS.md`, record it in a new ADR rather than rewriting
  ADR-0007.

**Test gap**

The current tests are the opposite of the contract: they assert that a ten-field message is
accepted and an eleven-field message is rejected (`test/core/signatures.test.ts:492-512`). They
provide false confidence. No test uses Zoho's documented example.

---

### COR-03 — High — `created` session status maps to `PENDING_AUTHORIZATION`, allowing an unpaid order

**Files/lines**

- `src/core/status.ts:10-14` (`created`/`pending`/`in_progress`/`processing` all map to
  `PENDING_AUTHORIZATION`)
- `src/providers/zoho/service.ts:580-601` (`toAuthorizeOutput` uses the mapping)
- `test/providers/service-lifecycle.test.ts:334-358` asserts `created` →
  `PENDING_AUTHORIZATION`

**Expected**

`PENDING_AUTHORIZATION` is Medusa's “authorization is deferred and expected to complete
asynchronously” state. It is reserved for a payment the provider has accepted and that is
settling outside the checkout flow (for example Zoho `in_progress` for bank transfer). A
freshly-created Zoho session, before any payment attempt, is not such a payment.

`created` should map to `PENDING` (or an error/`REQUIRES_MORE` state that prevents cart
completion) so Medusa refuses to complete the cart. `in_progress` (and, after live verification,
any genuinely async status such as `pending`) may map to `PENDING_AUTHORIZATION`.

**Actual**

The provider returns `PENDING_AUTHORIZATION` for `created`. In Medusa 2.22,
`authorizePaymentSession` handles that status specially: it updates the session and returns
`null`; `authorizePaymentSessionStep` returns `null`; `complete-cart` continues and creates an
order with no payment. `validateCartPaymentsStep` allows `PENDING` sessions to be authorized, so
a caller can create a Zoho session and immediately call `cart.complete()` without opening the
widget. The provider polls a few times (the session stays `created`) and then returns
`PENDING_AUTHORIZATION`.

**Impact**

A customer can obtain an order (and reserve inventory) without paying. This is not merely a
display issue: the order exists with an awaiting payment, and a merchant may mistakenly fulfill
it. It also contradicts `README.md`, the ADRs, and the tests, which describe the mapping as
correct.

**Recommended fix**

- Map `created` to `PaymentSessionStatus.PENDING` (or throw a validation/state error from
  `authorizePayment`).
- Map only statuses that represent an accepted asynchronous payment to
  `PENDING_AUTHORIZATION`; confirm `pending`/`processing` against live Zoho behavior first.
- Update `docs/decisions/ADR-0003-session-lifecycle.md`, `docs/architecture.md`, and the status
  tests.
- Add a Medusa integration test that creates a session, does **not** open checkout, calls
  `cart.complete()`, and asserts no order is created.

**Test gap**

The test suite asserts the bug (`service-lifecycle.test.ts:341`). There is no complete-cart
integration test. A unit test of `mapZohoSessionStatus` alone cannot demonstrate the order
behavior.

---

### COR-04 — High — The webhook verifies `rawData` but maps a separately supplied payload object

**Files/lines**

- `src/providers/zoho/webhook.ts:53-63` (`parseRawBody` re-serializes an object)
- `src/providers/zoho/webhook.ts:155-175` (signature over `rawBody`; event parsed from
  `payload.data`)
- `docs/webhooks.md:100-104` claims the raw body is never re-serialized
- `test/providers/webhook.test.ts:62-89` locks the object-canonicalization behavior

**Expected**

After verifying the HMAC, parse and map **the exact body that was verified**. If the caller
supplies both `rawData` and `data`, either ignore `data` and parse `rawData`, or require the two
to be deeply equal. The object fallback should be removed from a signature-verification path; an
object is not a raw body.

**Actual**

The handler verifies `parseRawBody(payload.rawData)`, then calls `parseEvent(payload.data)`.
`parseRawBody` converts a plain object to `JSON.stringify(object)` and signs that. If a custom
ingress, middleware, or direct caller supplies a valid signed `rawData` but a different `data`
object, the signature can pass while the mapped event is different. The test explicitly
demonstrates signing a re-serialized object.

**Impact**

The signature no longer binds the fields used to make the payment decision. In the stock Medusa
route `data` is `req.body` and `rawData` is `req.rawBody` from the same request, so the stock
path is not directly exploitable; the weakness affects custom routes, forwarders, and any
integration that constructs the provider payload itself. It also violates the documented
security invariant and makes the test suite encode the unsafe behavior.

**Recommended fix**

- Verify the signature, then `JSON.parse` the verified string/Buffer and use that parsed object.
- Remove the object fallback; throw a typed `ZohoValidationError` for unsupported `rawData`.
- If keeping `payload.data` for compatibility, assert deep equality with the parsed verified body
  and fail closed on mismatch.
- Update `docs/webhooks.md` and the tests. Add a test where `data` differs from the signed body
  and assert `INVALID_DATA`/verification failure.

**Test gap**

The existing test asserts the unsafe object behavior. There is no “valid signature over body A,
different `data` B” test.

---

### COR-05 — High — Zoho amount and currency are never reconciled before declaring capture

**Files/lines**

- `src/providers/zoho/service.ts:331-352` (`capturePayment` checks only `payment.status`)
- `src/providers/zoho/service.ts:580-601` (`toAuthorizeOutput` checks only `session.status`)
- `src/providers/zoho/service.ts:567-578` (`resolvePaymentAuthorization` checks only payment
  status)
- `src/providers/zoho/webhook.ts:129-141, 188-201` (webhook amount is taken from Zoho and passed
  to Medusa without a positive/session check)

**Expected**

Before returning `PaymentSessionStatus.CAPTURED` or a successful capture, compare the Zoho
session/payment `amount` and `currency` with the provider-owned Medusa session data
(`data.amount`, `data.currencyCode`) and, for capture, with the payment's expected amount. A
mismatch should throw a typed state/validation error or return a non-success status. The webhook
amount should be positive, finite, and consistent with the session/payment.

**Actual**

Only the Zoho status is considered. A Zoho session/payment with a different amount or currency
is reported as captured. `capturePayment` returns success for any `succeeded`/`refunded`/
`partially_refunded`/`disputed` payment without checking `payment.amount` or
`payment.currency`. `toAuthorizeOutput` can return `CAPTURED` for a succeeded session even if
`session.payments` is missing or contains a failed first entry. `mergePaymentData` stores only
the status and id.

**Impact**

A partial or stale Zoho payment can mark a full Medusa order as paid. In combination with
COR-01, a small captured payment can pay a large cart. Even without malicious input, a stale
session, a mis-created session, or a Zoho-side partial amount can produce an order whose recorded
payment does not match the money collected. Medusa records captures from its own session amount,
not from Zoho, so the mismatch is not corrected later.

**Recommended fix**

- Add a pure helper that compares `BigNumber` amounts after currency normalization and rejects
  mismatched currencies.
- In `toAuthorizeOutput`/`resolvePaymentAuthorization`, require the Zoho session or payment
  amount/currency to equal `data.amount`/`data.currencyCode` before `CAPTURED`.
- In `capturePayment`, compare `payment.amount`/`currency` with `data.amount`/`currencyCode`
  before returning success; also consider `amount_captured`.
- In webhook mapping, validate the amount is positive/finite and, where possible, compare it to
  the session/payment amount. At minimum, reject zero/negative amounts.
- Add tests with Zoho amounts/currencies different from the session data, and with
  `session.payments[0]` failed and a later succeeded entry.

**Test gap**

The suite has no amount/currency mismatch case. It also accepts a succeeded session with no
`paymentId` (`test/providers/service-lifecycle.test.ts:237-255`), which is a related missing
identity check.

---

### COR-06 — High — Declared Medusa support starts at 2.16.0, but the code uses 2.17.2-only enums

**Files/lines**

- `package.json:114-116` (`>=2.16.0 <3.0.0`)
- `README.md:39` (same range)
- `docs/compatibility.md:13-20` (“2.16.x–2.20.x peer-compatible”)
- `src/core/status.ts:14` (`PaymentSessionStatus.PENDING_AUTHORIZATION`)
- `src/providers/zoho/webhook.ts:196-236` (`PaymentActions.PENDING_AUTHORIZATION`)

**Expected**

Every enum value used at runtime must exist across the declared peer range, or the peer floor
must be raised. Medusa's documentation states that `pending_authorization` is available since
**v2.17.2**. The v2.16.0 source has no `PaymentSessionStatus.PENDING_AUTHORIZATION` and no
`PaymentActions.PENDING_AUTHORIZATION`.

**Actual**

On Medusa 2.16–2.17.1, `PaymentSessionStatus.PENDING_AUTHORIZATION` evaluates to `undefined`.
`mapZohoSessionStatus` consequently returns `undefined` for `created`/`pending`/`in_progress`/
`processing`. Medusa 2.16's `authorizePaymentSession` treats anything other than
`AUTHORIZED`/`CAPTURED` as a failure and attempts to persist the undefined status before
throwing. `PaymentActions.PENDING_AUTHORIZATION` is also `undefined`, so the corresponding
webhook actions violate the typed contract (and are ignored). The code compiles against 2.22 and
the test suite only runs against 2.22, so CI cannot catch this.

**Impact**

The package advertises compatibility it does not have. Asynchronous payments and some status
checks fail on 2.16–2.17.1. A card payment that reaches `succeeded` may still work, but the
declared “peer-compatible” range is false and a merchant on 2.16 can see undefined statuses or
failed authorization.

**Recommended fix**

- Prefer raising the peer floor to `>=2.17.2 <3.0.0` and updating the README, compatibility
  matrix, traceability, and tests. This matches the code's actual dependency.
- Alternatively, feature-detect the enum:
  `const PENDING_AUTHORIZATION = PaymentSessionStatus.PENDING_AUTHORIZATION ?? PaymentSessionStatus.PENDING`
  and avoid `PaymentActions.PENDING_AUTHORIZATION` on older versions. This loses async semantics
  but keeps the range. Document the fallback.
- Add a version-matrix CI job (2.17.2 and 2.22.0 at minimum) or a compile-time check against the
  minimum supported `@medusajs/utils` types.

**Test gap**

Only 2.22.0 is installed/tested. No test asserts the minimum peer behavior.

---

### COR-07 — High (needs live verification) — Session and refund `amount` are sent as JSON strings, while Zoho's schema declares numbers

**Files/lines**

- `src/core/zoho-client.ts:102-108` (`body.amount = input.amount`, a string)
- `src/core/zoho-client.ts:212-217` (refund body amount, a string)
- `src/providers/zoho/types.ts:24-40` (`amount: string`)
- `README.md:22-23, 102-103`; `docs/configuration.md:140-143`; `docs/research/zoho-payments.md:73-75`
- `test/core/zoho-client.test.ts:314-324, 590-600` asserts string payloads

**Expected**

Zoho's published OpenAPI request schemas declare:

- `POST /paymentsessions` → `amount: number, format: double`
- `POST /payments/{payment_id}/refunds` → `amount: number, format: double`

Sources:

- <https://www.zoho.com/in/payments/api/v1/online-payment-session/online-payment-session.yml>
- <https://www.zoho.com/in/payments/api/v1/refunds/refunds.yml>

The response examples use strings (`"100.50"`), but the request type is a number.

**Actual**

`formatAmountForZoho` returns a decimal string, and `JSON.stringify` sends it as a JSON string.
The research note itself acknowledges “Zoho documents a double” but still specifies a string. No
live smoke test evidence is checked in (`scripts/smoke.mjs` exists but its result is not
recorded).

**Impact**

If Zoho validates request types strictly, **all** payment-session creation and refunds fail with
`400`. If Zoho coerces numeric strings, the current code is fine and preserves precision. This is
the single highest-uncertainty wire-contract risk. It cannot be resolved by unit tests with a
fake client.

**Recommended fix**

- Run `pnpm build && node scripts/smoke.mjs` against an India sandbox account and record the
  result. Run one live full/partial refund in sandbox.
- If strings are accepted, document that as an observed deviation from the OpenAPI schema and add
  a regression note/test; keep the current precision-preserving approach.
- If strings are rejected, send `amount` as a JSON number. Because JSON numbers are IEEE-754
  doubles, either:
  - send a number only when the decimal is exactly representable and otherwise reject; or
  - confirm Zoho accepts a string and keep the string (preferred for money precision).
- Add a transport-level test that asserts the chosen JSON type and a live smoke check to CI's
  manual release checklist.

**Test gap**

The fake-client tests assert the current string behavior but cannot prove Zoho accepts it. There
is no recorded smoke run in the repo.

---

### COR-08 — Medium — A late `payment.failed` reconciled to success uses the failed attempt's amount

**Files/lines**

- `src/providers/zoho/webhook.ts:218-225`
- `test/providers/webhook.test.ts:356-370` (only checks the action, not the amount)

**Expected**

When a `payment.failed` event's Zoho session has ultimately succeeded, the webhook action's
`amount` must be the amount of the **successful** payment/session, not the failed attempt. Medusa
uses this amount in `processPaymentWorkflow` and `capturePaymentWorkflow`.

**Actual**

The success branch returns `payment.amount`, where `payment` is the failed attempt from the
event. If a failed attempt had a different amount from the later successful one (for example a
partially constructed attempt or a retry with a different amount), Medusa captures the wrong
amount; if it is larger than the authorized amount, capture fails; if smaller, a partial capture
is recorded while the order may still complete.

**Impact**

Incorrect capture accounting, failed capture, or an order recorded as partially paid even though
Zoho captured the full amount.

**Recommended fix**

- Use the succeeded session's amount (`session.amount`) or find the succeeded payment in
  `session.payments` and use its amount; fall back to the failed amount only if neither exists
  and the action is not success.
- Add a test where the failed attempt amount differs from the session amount.

**Test gap**

The current late-success test uses `createPayment` defaults (`amount: "100.00"`) and a session
with the same amount, so the bug is invisible.

---

### COR-09 — Medium — `payment.failed` → `FAILED` is ignored by Medusa 2.22, contrary to the docs

**Files/lines**

- `src/providers/zoho/webhook.ts:228-236` (returns `PaymentActions.FAILED`)
- `@medusajs/medusa/dist/subscribers/payment-webhook.js:22-32` (returns early for `FAILED`,
  `CANCELED`, `REQUIRES_MORE`, `PENDING_AUTHORIZATION`, and `PENDING`)
- `docs/webhooks.md:136-150` (“Only a terminal session failure marks the Medusa session failed”)
- `docs/decisions/ADR-0004-webhook-authorization.md:84-94`
- `README.md:201-203`

**Expected**

The documentation describes `payment.failed` reconciliation as if a terminal Zoho session failure
moves the Medusa payment session to a failed/error state. At minimum, docs should state what
Medusa actually does.

**Actual**

Medusa 2.22's payment webhook subscriber explicitly ignores `FAILED`. `payment.pending` →
`PENDING_AUTHORIZATION` is also ignored. The only actions that trigger work are `SUCCESSFUL` and
`AUTHORIZED` (and the provider never emits `AUTHORIZED`). Thus `payment.failed` only performs a
Zoho lookup and returns an action that Medusa discards. The Medusa session is not marked failed;
it remains pending/canceled only if a later status poll or another path updates it.

Separately, the current Zoho payment-webhook event list advertises only `payment.succeeded` and
`payment.failed` (the hosted guide also mentions `payment.success`). The package's requirement to
subscribe to `payment.pending` may be impossible or may never fire. That is a documentation/setup
issue, not a code hazard, but it should be live-verified before being presented as a minimum.

**Impact**

Merchants and support staff are told a terminal failure will fail the session, but it will not.
A dead Zoho session can remain in Medusa until expiry or a new session is created. The
`payment.failed` webhook still consumes API quota. The docs' “terminal failure marks the session
failed” claim is false for the supported Medusa version.

**Recommended fix**

- Correct the docs to state that Medusa 2.22 ignores `FAILED`/`PENDING_AUTHORIZATION` webhook
  actions; use `getPaymentStatus`/`authorizePayment` polling or a custom subscriber if a failed
  session must transition.
- Optionally return `NOT_SUPPORTED` for `payment.failed` to be explicit, or keep `FAILED` for
  forward compatibility with the contract but document the no-op.
- Add a Medusa integration test proving the resulting session status, not just the provider
  action.

**Test gap**

The provider tests assert only the action value; no test proves the Medusa state transition. The
test suite has no booted Medusa subscriber.

---

### COR-10 — Medium — Canceled refunds are treated as success; the replay guard ignores amount and status

**Files/lines**

- `src/providers/zoho/service.ts:412-420` (replay guard)
- `src/providers/zoho/service.ts:441-445` (only `failed` throws)
- `test/providers/service-operations.test.ts:277-318` (only failed statuses)
- `docs/decisions/ADR-0005-capture-cancel-refund.md:62-91`

**Expected**

- A refund whose Zoho status is `canceled` did not happen; it must not be returned as a
  successful `RefundPaymentOutput` that Medusa records as a refund.
- The local replay guard should only replay when the stored refund is for the same payment,
  amount, and currency and is in a safe state (`succeeded`, and arguably `initiated`/`pending`
  with a refreshed status). It must not turn a canceled/failed or differently sized refund into
  a success.
- `lastRefundStatus` should reflect Zoho's latest known status.

**Actual**

Only `status === "failed"` throws. `canceled` is stored in `lastRefundStatus` and returned
normally; Medusa's refund module marks its refund record `SUCCEEDED` when the provider does not
throw. The replay guard returns `{ data: input.data }` whenever the idempotency key matches and
`lastRefundId` exists, regardless of amount, currency, or `lastRefundStatus`; it does not call
Zoho or refresh the status.

**Impact**

Medusa can show a canceled refund as successful, corrupting refund totals and customer
communication. A retry with the same key but a different amount can be silently treated as the
old refund (the Medusa module guards this in its own path, but the provider contract is unsafe).
A canceled/failed stored refund can suppress a legitimate retry.

**Recommended fix**

- Throw `ZohoPaymentStateError` for `canceled` (and any unknown terminal non-success status)
  with the Zoho status/failure reason.
- Add `lastRefundAmount` and `lastRefundCurrency` to the stored data and require them to match
  before replay.
- Only replay for `succeeded`; for `initiated`/`pending`, either refresh with `retrieveRefund`
  or return the data with the current status and document that Medusa will mark it succeeded.
- Add tests for `canceled`, same key/different amount, same key/`pending`, and status refresh.

**Test gap**

No test covers a canceled refund or the replay guard's amount/status dimensions. The suite
asserts only `failed` throws.

---

### COR-11 — Medium — A positive amount below the currency precision formats to `"0.00"` after the positivity check

**Files/lines**

- `src/providers/zoho/service.ts:161-168` (format first, then check the original amount)
- `src/providers/zoho/service.ts:408-425` (refund check on the original amount)
- `src/core/amount.ts:104-111` (`toFixed` rounds)

**Expected**

A payment/refund amount must remain strictly positive after currency formatting. An amount like
`0.001` INR, `0.1` JPY, or `0.0001` KWD should be rejected (or handled explicitly), not sent as
zero. The invariant “money is never guessed” and the docs' “zero amounts are rejected” require
checking the formatted value.

**Actual**

`isPositiveAmount(input.amount)` is checked before formatting. `formatAmountForZoho` then rounds
to ISO fraction digits. A positive `0.001` INR becomes `"0.00"`, which passes the positivity check
and is sent to Zoho (or recorded as a zero refund). The Zoho request may reject it, but the
provider has already violated its own validation contract.

**Impact**

At best, Zoho returns a 400 mapped to `UNEXPECTED_STATE`; at worst, a zero-amount session/refund
is accepted and creates inconsistent state. The refund path can record a zero refund. This is a
money-correctness bug and a predictable input-validation gap.

**Recommended fix**

- After formatting, validate `isPositiveAmount(amount)` (the formatted string) and throw
  `ZohoValidationError` if it is zero.
- Decide whether to reject amounts with more precision than the currency or round them; if
  rounding is allowed, document it and ensure the rounded value is positive.
- Apply to both `initiatePayment` and `refundPayment`.

**Test gap**

Tests cover `0`/negative and KWD rounding but not “positive input rounds to zero”. Add cases for
INR `0.001`, JPY `0.1`, and KWD `0.0001`.

---

### COR-12 — Medium — A payment from a superseded Zoho session still maps to the current Medusa session

**Files/lines**

- `src/providers/zoho/service.ts:246-248` (`previousZohoSessionIds` recorded)
- `src/providers/zoho/session-data.ts:160-196` (webhook correlation from reference/metadata)
- `src/providers/zoho/webhook.ts:160-201` (no check against superseded sessions)
- `docs/storefront-widget.md:251-259`; `docs/webhooks.md:152-165`
- `@medusajs/core-flows` cart refresh deletes the old Medusa payment session when a new one is
  created (`create-payment-sessions` workflow)

**Expected**

A webhook for a Zoho session that has been superseded by a cart change should not be able to
complete or capture the current Medusa session unless the current session's Zoho payment is the
one that succeeded. The provider should compare the webhook's `payments_session_id` with the
active `zohoSessionId` (or use a nonce/reference per Zoho session), not only the Medusa session
ID.

**Actual**

The provider writes the same Medusa session ID into `reference_number` and
`meta_data.medusa_session_id` for every replacement Zoho session. `previousZohoSessionIds` is
stored in `data` but never consulted by the webhook handler. Medusa's cart refresh deletes the
old local payment session, so a late webhook from the old Zoho session carries a reference to a
Medusa session that no longer exists; `processPaymentWorkflow` may fail or create no order. If
the old local session still exists, the webhook can mark the current session paid based on the
old amount.

Note also that in the standard storefront `initiatePaymentSession` flow, Medusa's
`createPaymentSessionsWorkflow` deletes the existing local session before creating the new one,
so the provider may not even see `existing.zohoSessionId` and cannot populate
`previousZohoSessionIds`. The audit trail described in ADR-0003 is therefore not guaranteed in
the normal cart-edit path; the abandoned Zoho session is simply untracked.

**Impact**

A customer who opened the widget before a cart edit can pay the old amount after the cart
changed. The new Medusa session may be marked paid or left in an inconsistent state; the
customer is charged but no correct order is produced. This is a classic stale-session race and
is especially relevant because Zoho has no session update/cancel API.

**Recommended fix**

- Store a per-Zoho-session opaque reference (not just the Medusa session ID) and keep a
  server-side mapping of the active Zoho session. On a webhook, reject/flag events for any
  session other than the active one, or route them to an explicit reconciliation state.
- At minimum, compare the webhook's `payments_session_id` with the active `data.zohoSessionId`
  when the handler has access to it, and compare amounts before success.
- Document the old-session race and add a reconciliation runbook. Add a test with a
  `previousZohoSessionIds` entry and a succeeding old-session webhook.
- This likely needs an ADR because it changes the session bridge design.

**Test gap**

No test covers a webhook from a previous Zoho session. The current tests only cover missing
metadata/reference, not a valid reference that is stale.

---

### COR-13 — Medium — Account and live-mode checks fail open when fields are absent

**Files/lines**

- `src/providers/zoho/webhook.ts:89-111`
- `test/providers/webhook.test.ts:187-237` asserts fail-open for a missing `live_mode`

**Expected**

If `expectedAccountId` is configured (it always is), a webhook without `account_id` should be
rejected, because the account check is part of the documented origin check. If `liveMode` is
configured, a webhook without `live_mode` should be rejected, or the docs should state that the
check is skipped. Zoho's webhook examples include both fields.

**Actual**

`account_id` is only compared if present; `live_mode` is only compared if both the option and the
event field are present. A correctly signed event that omits either field passes. The test
explicitly asserts that a missing `live_mode` is accepted.

**Impact**

If the signing key is shared between accounts/environments (the reason the check exists), an
event that omits the discriminator can be applied to the wrong account or to live data. In
practice Zoho appears to always send both, so this is defense-in-depth, but it contradicts the
docs' “checks the Zoho account and live/test mode” claim.

**Recommended fix**

- Require `event.account_id` to be present and equal the configured account; throw otherwise.
- If `liveMode` is configured, require a boolean `live_mode` and equal it; otherwise document
  the fail-open behavior. Verify with live webhook samples that all relevant events carry it.
- Update tests and `docs/webhooks.md`/ADR-0004.

**Test gap**

The current test suite encodes fail-open. Add missing-account and missing-live-mode rejection
tests once the desired policy is chosen.

---

### COR-14 — Medium — Documentation claims the provider's output `id` is the Medusa payment-session id; Medusa 2.22 ignores it

**Files/lines**

- `docs/decisions/ADR-0003-session-lifecycle.md:31-32, 136-137`
- `docs/architecture.md:113-130`
- `src/providers/zoho/service.ts:251-255` returns `id: session.payments_session_id`
- `@medusajs/payment/dist/services/payment-module.js:159-171` stores only provider `data` and
  `status`; the returned `id` is not persisted as the Medusa session id

**Expected**

Docs should explain the actual two-ID model:

- Medusa owns the payment-session id (`payses_...`), injected as `data.session_id`.
- The provider returns the Zoho id as `InitiatePaymentOutput.id` (required by the provider
  contract), but Medusa 2.22 does not store it.
- The durable bridge is `data.zohoSessionId` plus `data.medusaSessionId`, and webhooks resolve
  the Medusa id from metadata/reference.

**Actual**

ADR-0003 says “returns its `payments_session_id` as the Medusa payment-session `id`” and that
“Medusa's session ID is returned directly as the provider ID, so admin and storefront code can
correlate records without an extra mapping table.” That is not true in 2.22; the Medusa session
id remains `payses_...`, and the provider's output `id` is discarded. The architecture sequence
also shows `id = payments_session_id` as the Medusa result.

**Impact**

Developers may search Medusa for the Zoho id, assume the two are interchangeable, or build a
reconciliation job on the wrong key. It also obscures why the `data` bridge exists at all.

**Recommended fix**

- Rewrite the identity section and the sequence note to state that `data.zohoSessionId` is the
  bridge and the output `id` is informational/provider-contract only.
- Add an integration assertion that the Medusa session id differs from the Zoho id and that
  `data.zohoSessionId` is set.
- Keep the provider's `id` output (the contract requires it), but do not claim Medusa persists it.

**Test gap**

No integration test boots Medusa and asserts the session id/data relationship.

---

### COR-15 — Low — Metadata cap arithmetic, reserved `zoho_session_id`, and stale mode fields are inconsistent

**Files/lines**

- `src/providers/zoho/options.ts:31-33` (reserved keys), `:238-241` (max 3 extras)
- `src/providers/zoho/session-data.ts:125-150` (max 5 total), `:179-196` (fallback)
- `docs/configuration.md:149-156`
- `src/providers/zoho/service.ts:251-255` (spread keeps stale mode fields)

**Expected**

Zoho allows 5 metadata entries. The provider writes one (`medusa_session_id`), so it can safely
allow **4** extra entries. `zoho_session_id` is documented as “reserved for session lookup” and
the webhook handler reads it as a fallback, but the provider never writes it. Mode-specific
fields should be replaced, not merged with stale values.

**Actual**

`MAX_EXTRA_METADATA_ENTRIES = 3`; the docs say “reserves one ... leaving 3” (arithmetic should be
4). `zoho_session_id` is rejected in options and read by `extractZohoSessionId`, but
`buildZohoMetadataEntries` never adds it (tests explicitly assert it is absent). A new session
built with `{ ...input.data, ...sessionData }` keeps an old `widget` or `checkoutUrl` when the
mode changes, because `buildZohoSessionData` omits the absent field rather than clearing it.

**Impact**

Merchants cannot use a fourth safe metadata entry; the documentation is misleading; the
`payment.failed` metadata fallback is dead code for provider-created sessions; a stale hosted
`checkoutUrl` (a bearer capability) can remain in widget-mode session data after a config switch.

**Recommended fix**

- Either allow 4 extras (1 + 4 = 5) and update docs/tests, or explicitly reserve a second slot
  and explain why.
- Remove the unused `zoho_session_id` reservation and fallback, or write it if a future Zoho API
  allows updating metadata after session creation.
- Sanitize mode-specific fields on rebuild (set `widget: undefined`/`checkoutUrl: undefined` and
  ensure the stored JSON drops them).
- Add tests for 4 extras, 5 extras rejected, mode switches, and `findZohoMetadataValue`.

**Test gap**

The suite tests the 3-entry limit and asserts `zoho_session_id` is not written, but not the
arithmetic or mode-switch stale-data case.

---

### COR-16 — Low — Polling semantics differ from the documentation; `requires_more` is polled; `0` interval is ignored

**Files/lines**

- `src/providers/zoho/service.ts:548-565`
- `src/core/status.ts:57-70` (terminal statuses)
- `docs/configuration.md:158-166`; `src/providers/zoho/types.ts:179-182`

**Expected**

Docs say `pollAttempts` is the maximum number of polling attempts (default 3) and
`pollIntervalMs` is the delay (0–10000, default 500). A terminal/actionable status should stop
polling.

**Actual**

`pollAttempts` is the number of **extra** polls after the initial GET: default 3 means up to 4
HTTP requests and 3 sleeps. `pollAttempts: 0` still performs one GET. `pollIntervalMs: 0` is
replaced with 500 via `|| DEFAULT_POLL_INTERVAL_MS`, so zero cannot be configured. `requires_more`
and `requires_action` are not terminal, so the code keeps polling a session that needs customer
action until the attempt limit.

**Impact**

Extra API calls and up to 1.5s default latency; a configured zero delay is ignored; an
actionable 3DS/`requires_more` state wastes polls. Not a money bug, but the config contract is
inaccurate.

**Recommended fix**

- Clarify the docs (extra polls vs total attempts) or change the loop to match the documented
  total.
- Use `pollIntervalMs ?? 500` (not `||`) and allow 0 if that is intended.
- Stop polling on `requires_more`/`requires_action`, or document why it continues.
- Add boundary tests for `pollAttempts: 0`, `pollIntervalMs: 0`, and a `requires_more` session.

**Test gap**

The suite tests polling until success/exhaustion and the zero-interval default, but locks the
current semantics rather than the documented ones.

---

### COR-17 — Low — Browser helper timeout and error mapping do not match the documented surface

**Files/lines**

- `src/client/index.ts:400-462` (`payWithZohoCheckout`; no timeout around
  `requestPaymentMethod`)
- `src/client/index.ts:447-459` (`session_expired` → generic `failed`)
- `src/types.ts:96` (“Maximum time to wait for the script and the widget”)
- `docs/storefront-widget.md:391-399` (docs correctly say script)
- `test/client/widget.test.ts:795-825` (instance reuse after close; no hang test)

**Expected**

`timeoutMs` should cover whatever it claims. Zoho's documented error codes
`session_expired` and `invalid_payment_session` should map to `reason: "expired"` so the
storefront can restart checkout. A third-party promise that never settles should not hang the
button forever. Reusing a widget instance after `close()` should be verified.

**Actual**

`timeoutMs` is passed only to `loadZohoPaymentsScript`; `requestPaymentMethod` has no timeout or
abort. Zoho `session_expired` is returned as `{ ok: false, reason: "failed", code:
"session_expired" }`, so the documented `"expired"` UI path is not reached unless the local
`expiresAt` already passed. The tests stub an instance that remains usable after `close()` but do
not verify Zoho's real behavior.

**Impact**

A hung widget promise leaves the checkout spinning indefinitely; a Zoho-expired session shows a
generic failure rather than the restart path; instance reuse after close may fail in a real
browser.

**Recommended fix**

- Either add a bounded timeout/abort wrapper around `requestPaymentMethod` (careful: the customer
  may legitimately spend minutes paying) or change the `timeoutMs` comment to “script load only”
  and document the widget's unbounded interaction.
- Map `session_expired`/`invalid_payment_session` to `"expired"` and test.
- Add a live browser check for instance reuse after `close()`; if Zoho does not support it,
  create a fresh instance per payment or avoid closing a reusable instance.
- Add a test where `requestPaymentMethod` never resolves (with a documented policy) and a test
  for the Zoho error codes.

**Test gap**

No hang/abort test, no Zoho `session_expired` mapping test, and no real-browser instance test.

---

### COR-18 — Low — Error mapping discards `retryable`, HTTP status, and request ID

**Files/lines**

- `src/providers/zoho/service.ts:650-679` (`toMedusaError`)
- `src/core/errors.ts:43-65` (`ZohoApiError` carries `statusCode`, `zohoCode`, `requestId`,
  `retryable`)
- `docs/architecture.md:321-327` claims request IDs are logged
- `docs/testing.md`/`docs/troubleshooting.md` tell operators to use the request ID

**Expected**

When a Zoho API call fails, the provider's log/error should retain enough context for
reconciliation: Zoho code, HTTP status, request ID, and whether the failure is retryable. The
`MedusaError` can carry a `code`; the log context can carry the rest.

**Actual**

`toMedusaError` converts every non-Medusa error to a new `MedusaError` with only type and
message. It logs `{ action, code }` and drops `statusCode`, `requestId`, and `retryable`.
The original `ZohoApiError` is not attached as `cause` to the new MedusaError. The docs claim
request IDs are logged.

**Impact**

Operators cannot correlate a failed payment/refund with a Zoho request ID from the Medusa log
without changing code. Medusa callers cannot distinguish a transient 429/5xx from a permanent
400/401. This is an observability/debuggability defect, not a money bug.

**Recommended fix**

- Log `statusCode`, `requestId`, `retryable`, and the Zoho code for `ZohoApiError`.
- Set the `MedusaError` code to a stable value (the Zoho code or package error code) where it does
  not conflict with Medusa semantics.
- Attach the original error as `cause` if the MedusaError constructor permits it (it does not
  accept a cause in 2.22; log instead).
- Add a test capturing the logger context for a 429/5xx/400.

**Test gap**

Tests assert only the MedusaError type/message, not the log context or retryable flag.

---

### COR-19 — Low — “ISO-4217 validation” is only a three-letter regex

**Files/lines**

- `src/core/amount.ts:8-17`
- `docs/compatibility.md:96-103`; `docs/configuration.md`; `README.md`

**Expected**

The docs say the provider validates ISO-4217 codes. Invalid-but-shaped codes should fail at
startup rather than at Zoho.

**Actual**

`normalizeCurrencyCode` accepts any three uppercase letters. `Intl.NumberFormat` also accepts
`ABC`, `ZZZ`, `XXX`, `USN`, and even `BTC` (all return a formatter). The provider then sends the
code to Zoho. Zoho likely rejects unsupported currencies with a 400 mapped to
`UNEXPECTED_STATE`.

**Impact**

A configuration typo (`ABC`) is not caught at startup and produces a late, generic checkout
error. Low severity but easy to fix.

**Recommended fix**

- Use a real ISO-4217 list (`Intl.supportedValuesOf("currency")` or a static table) for the
  shape check, and separately document Zoho's per-account currency support.
- Add tests for `ABC`, `ZZZ`, and a valid but unsupported currency.
- Or relabel the current check as “three-letter currency shape validation” and adjust the docs.

**Test gap**

Tests only cover malformed lengths/characters, not well-formed non-ISO codes.

---

### COR-20 — Low — Documentation drift and small factual inconsistencies

| Location                                                                                                                                           | Claim                                                                                | Actual                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/testing.md:69-78`                                                                                                                            | 707 tests                                                                            | Current suite is **708** (verified).                                                                                                                                                                           |
| `docs/decisions/ADR-0003-session-lifecycle.md:203`                                                                                                 | “A webhook test proves ...” a session with `paymentId` resolves the payment resource | No such webhook test exists; the test is in `service-lifecycle.test.ts:427-442` for `getPaymentStatus`. The webhook handler does not use `paymentId`.                                                          |
| `docs/architecture.md:321-327`                                                                                                                     | Logs include Zoho error code and request ID                                          | Only the code is logged; request ID/status are dropped (COR-18).                                                                                                                                               |
| `docs/decisions/ADR-0005-capture-cancel-refund.md:136-143`                                                                                         | “local replay guard is process-local data”                                           | It is persisted in Medusa payment `data`, not process-local.                                                                                                                                                   |
| `docs/architecture.md:264-276`                                                                                                                     | State machine `Pending --> PendingAuthorization: Zoho session created`               | `initiatePayment` returns `PENDING`; `PENDING_AUTHORIZATION` is an authorization result (and COR-03 says `created` should not map there).                                                                      |
| `docs/webhooks.md:100-104`                                                                                                                         | Raw body is never re-serialized                                                      | `parseRawBody` re-serializes object bodies (COR-04).                                                                                                                                                           |
| `docs/storefront-widget.md:251-253`                                                                                                                | Reuse only when “unpaid” and matches                                                 | `isReusableZohoSession` checks no `paymentId` but not `paymentStatus`, so a failed/captured status without an id can still be reused (COR-01/COR-12).                                                          |
| `docs/webhooks.md:14`, `docs/configuration.md:291`, `docs/compatibility.md:143`, `docs/medusa-integration-listing.md:229-235`, `README.md:191-195` | `payment.pending` is a required Zoho event                                           | The current Zoho payment-webhook list advertises only `payment.succeeded` and `payment.failed`; the hosted guide also mentions `payment.success`. `payment.pending` is unverified and may not be subscribable. |
| `docs/compatibility.md:13-20`, `README.md:39`                                                                                                      | Medusa 2.16+ supported                                                               | Code requires `PENDING_AUTHORIZATION` from 2.17.2 (COR-06).                                                                                                                                                    |
| `docs/configuration.md:155-156`                                                                                                                    | One metadata entry reserved, leaving 3                                               | 5 − 1 = 4; code allows 3 extras (COR-15).                                                                                                                                                                      |
| `docs/configuration.md:62`                                                                                                                         | `signingKey` “Yes in production”                                                     | Options validation only warns; production can start without it (webhooks fail closed at runtime). Consider enforcing in production or relabel as “strongly recommended”.                                       |
| `src/types.ts:96`                                                                                                                                  | `timeoutMs` covers script and widget                                                 | Only script load uses it (COR-17).                                                                                                                                                                             |
| `docs/signatures.md:197-214`, `docs/storefront-hosted.md:141`, ADR-0002/0007                                                                       | Ten-field hosted signature                                                           | Twelve fields including `mandate_id` (COR-02).                                                                                                                                                                 |

---

## 3. Verified correct

The following were checked against the installed Medusa 2.22.0 source/types and Zoho's published
documentation and found consistent:

- **Method surface:** `initiatePayment`, `updatePayment`, `deletePayment`, `authorizePayment`,
  `capturePayment`, `cancelPayment`, `refundPayment`, `retrievePayment`, `getPaymentStatus`, and
  `getWebhookActionAndData` all exist with the expected Medusa input/output shapes. The provider
  correctly implements the optional-method omissions (no account holder/payment-method methods).
- **Medusa enum values:** `PaymentSessionStatus` and `PaymentActions` values used by the code are
  valid in 2.22. `PaymentActions.SUCCESSFUL` is the string `"captured"`; `CAPTURED` is the
  correct auto-capture result.
- **Webhook signature:** `X-Zoho-Webhook-Signature: t=<epoch-ms>,v=<hex>`, HMAC-SHA256 over
  `${t}.${rawBody}`, case-insensitive header lookup, constant-time comparison, and configurable
  tolerance match Zoho's verification guide. Missing keys fail closed.
- **Widget signature:** HMAC-SHA256 over `${payment_id}|${payment_session_id}` matches Zoho's
  signature-verification guide.
- **Hosted checkout creation:** `configurations.hosted_checkout_parameters` uses the documented
  `success_url`, `failure_url`, `email`, `phone`, and `description` fields. The redirect URL
  `https://payments.zoho.<tld>/hostedcheckout/<access_key>` matches the Hosted Checkout guide.
- **API endpoints/envelopes:** `POST /paymentsessions`, `GET /paymentsessions/{id}`,
  `GET /payments/{id}`, `POST /payments/{id}/refunds`, and `GET /refunds/{id}`; unwrapping
  `payments_session`, `payment`, and `refund` matches the published examples. `account_id` is
  appended as a query parameter.
- **Refund wire fields:** `amount`, required `reason: "requested_by_customer"`, required
  `type: "initiated_by_merchant"`, optional `description`, and `meta_data` match the Refunds API
  (except the `amount` JSON type in COR-07).
- **Auto-capture model:** Zoho's published API has no capture or cancel endpoint for a payment;
  `succeeded` means the payment is captured, and `amount_captured`/`amount_refunded` are
  read-only. `capturePayment` verifying rather than capturing is the correct design; `cancelPayment`
  and `deletePayment` are honest about the missing APIs.
- **Money conversion (normal path):** `BigNumber` and ISO fraction digits produce major-unit
  decimal strings without binary floating-point arithmetic for normal, currency-precision inputs.
  INR/USD (2), JPY (0), KWD/BHD (3), and large values are covered.
- **Status defense:** unknown Zoho statuses map to `PENDING`, never to success. Terminal
  detection covers `succeeded`, `failed`, `expired`, and `canceled`/`cancelled`.
- **Retry policy:** reads/session creation are `safe` (network/429/5xx); refund POST is `none`
  (429 only, never timeout/5xx); a Payments API 401 invalidates the token and retries once; OAuth
  terminal 4xx errors are not retried. This matches ADR-0006.
- **Options:** India is the default, widget is the default, `apiKey`/hosted URLs are validated,
  numeric bounds are enforced, and the resolved options plus nested maps/arrays are frozen.
  `fetch`, `logger`, `now`, and `sleep` are injected into the client/transport as intended.
- **Browser helper field names:** `zohoSessionId`, `checkoutMode`, `amount`, `currencyCode`,
  `currencySymbol`, `description`, `businessName`, `invoiceNumber`, `expiresAt`, `widget`
  (`accountId`/`domain`/`apiKey`), and `checkoutUrl` all match the provider's output. The widget
  uses `business` for the business name, `currency_code`, `payments_session_id`, `amount`,
  `currency_symbol`, `description`, `invoice_number`, and `address`, all documented fields. The
  script URL is correct.
- **Hosted redirect:** `redirectToZohoHostedCheckout` rejects expired sessions, wrong modes, and
  missing URLs before navigating. `payWithZohoCheckout` rejects expired/wrong-mode/missing-widget
  sessions with typed results.
- **Secrets:** the payment-session `data` contains no client secret, refresh token, access token,
  or signing key. The widget `apiKey` is publishable. Tests explicitly serialize returned data
  and check for secrets. OAuth errors redact configured secrets.
- **Bounded work:** HTTP retries, OAuth refreshes, authorization polling, and browser script
  loading are all bounded; no unbounded loop or retry-forever path was found.

---

## 4. Needs live Zoho verification

These cannot be resolved from source or published docs alone. They should be exercised against
an India sandbox account (and the US if claiming US support) before release:

1. **Request `amount` JSON type** — string vs number for session create and refund (COR-07).
   Run `scripts/smoke.mjs`; then create a sandbox payment and a refund.
2. **`payment.pending` event** — the current Zoho webhook-event list advertises only
   `payment.succeeded` and `payment.failed` (the hosted guide also mentions `payment.success`).
   Confirm whether `payment.pending` can be subscribed to and when it fires. Until then, remove
   it from the “minimum events” instructions.
3. **`expiry_time` units** — Zoho's attribute text says milliseconds, the examples show seconds.
   The code handles both by magnitude; confirm current responses for both regions.
4. **Session/payment status enum** — confirm `created`, `in_progress`, `pending`, `processing`,
   `requires_more`, and `requires_action` against live responses. The OpenAPI currently lists only
   `created`, `in_progress`, `succeeded`, and `failed` for sessions; the defensive superset may
   include values that never occur.
5. **Metadata propagation** — confirm `meta_data` from the session appears on
   `payment.succeeded`/`payment.failed` webhook payment objects. The reference fallback should be
   tested. If metadata is not propagated, the reference-number fallback is the only bridge.
6. **Hosted URL path** — the Hosted Checkout guide uses `/hostedcheckout/<access_key>`, while the
   OpenAPI `access-key` description mentions `hostedpages/{access_key}`. The package follows the
   guide; confirm the live path.
7. **Hosted `mandate_id`** — confirm one-time hosted returns include the `mandate_id` field (empty)
   in the signature message, as documented.
8. **One signing key for all three schemes** — confirm Developer Space uses the same signing key
   for webhook, widget response, and hosted return. If not, split the option in a future ADR.
9. **Account/live field presence** — confirm every subscribed event carries `account_id` and
   `live_mode`; decide whether missing values should fail closed (COR-13).
10. **Widget response `payment_session_id` and instance reuse** — confirm whether the real widget
    returns `payment_session_id` and whether a `ZPayments` instance remains usable after
    `close()`. The official response example shows only `payment_id` and `signature`.
11. **Refund `canceled` semantics** — confirm a canceled refund is terminal and should not be
    treated as success (COR-10).
12. **Auto-capture** — the API surface has no capture/cancel endpoint; a live sandbox payment
    should confirm that `succeeded` payments are captured without a separate call and that
    `amount_captured` matches the intent.

---

## 5. Test gaps

The suite has 100% line/branch coverage, but coverage is not correctness. The following gaps
correspond to the findings above:

- **No malicious payment-session `data` tests** (`paymentId`, `zohoSessionId`, amount/expiry,
  refund keys). This leaves COR-01 invisible.
- **No hosted signature vector from Zoho's published example**; the current vectors lock the
  wrong ten-field message (COR-02).
- **No complete-cart integration test** showing that a created session can/cannot create an
  unpaid order (COR-03).
- **No test that `payload.data` differs from the signed raw body** (COR-04).
- **No amount/currency mismatch tests** for authorization, capture, or webhook success (COR-05).
- **No Medusa 2.17.2 / 2.16 matrix** or minimum-peer type check (COR-06).
- **No live smoke/refund result** recorded; the fake client asserts string amounts but cannot
  prove Zoho accepts them (COR-07).
- **No test with a failed-attempt amount different from the succeeded session amount** (COR-08).
- **No Medusa subscriber/integration test** proving `FAILED` and `PENDING_AUTHORIZATION` are
  no-ops (COR-09).
- **No canceled refund, same-key/different-amount, or replay-status test** (COR-10).
- **No sub-precision positivity test** (COR-11).
- **No superseded-session webhook test** (COR-12).
- **No missing account/live-mode rejection test** (COR-13).
- **No real Medusa boot fixture** and no assertion that the Medusa session id differs from the
  provider output `id` (COR-14).
- **No 4-metadata-entry or mode-switch test** (COR-15).
- **No polling boundary test for `pollAttempts: 0`, `requires_more`, or `pollIntervalMs: 0`**
  (COR-16).
- **No hang/abort test for `requestPaymentMethod`**, no Zoho `session_expired` mapping test, and
  no real-browser instance-reuse test (COR-17).
- **No assertion that the log context carries status/request ID/retryable** (COR-18).
- **No well-formed non-ISO currency test** (COR-19).

---

## 6. Prioritized checklist

### P0 — block the 1.0.0 release

- [ ] **COR-01:** Ignore/reject caller-supplied provider-owned `data`; verify any reused Zoho
      session belongs to the Medusa session and matches amount/currency; never accept a
      caller-supplied `paymentId`.
- [ ] **COR-02:** Add `mandateId` to the hosted signature type/message; update all docs, ADRs,
      tests, and the success/failure routes to use the twelve-field Zoho message.
- [ ] **COR-03:** Stop mapping `created` to `PENDING_AUTHORIZATION`; only accepted async statuses
      may defer authorization. Add a complete-cart integration test.
- [ ] **COR-05:** Reconcile Zoho session/payment amount and currency with the Medusa session
      before `CAPTURED`/capture success; reject zero/negative/mismatched amounts.
- [ ] **COR-06:** Raise the peer floor to `>=2.17.2` or feature-detect `PENDING_AUTHORIZATION`
      and update every compatibility claim.
- [ ] **COR-07:** Run the live smoke test and a sandbox refund; fix the amount JSON type if Zoho
      rejects strings. Record the result in the release checklist.
- [ ] **COR-04:** Parse the verified raw body instead of `payload.data`; remove the object
      fallback; add a mismatch test.

### P1 — before live traffic

- [ ] **COR-08:** Use the successful session/payment amount when a late `payment.failed` resolves
      to success.
- [ ] **COR-09:** Correct the webhook docs to state that Medusa 2.22 ignores `FAILED` and
      `PENDING_AUTHORIZATION` actions; add a Medusa integration test if a custom failure
      transition is desired.
- [ ] **COR-10:** Throw on canceled refunds; make the replay guard amount/currency/status-aware.
- [ ] **COR-11:** Validate the formatted amount is positive; reject sub-precision inputs or
      document rounding.
- [ ] **COR-12:** Add an active-session check/nonce for webhooks; document and test the stale
      session race.
- [ ] **COR-13:** Require `account_id` and (when configured) `live_mode`, or document the
      fail-open policy explicitly.
- [ ] **COR-14:** Correct the ADR/architecture description of the provider output `id` and the
      Medusa bridge.

### P2 — hardening and documentation

- [ ] **COR-15:** Fix the metadata arithmetic (4 extras) or document the second reserved slot;
      remove or write the unused `zoho_session_id`; clear stale mode fields.
- [ ] **COR-16:** Align polling docs/implementation; honor `pollIntervalMs: 0`; stop polling on
      `requires_more`.
- [ ] **COR-17:** Decide/clarify the widget timeout policy; map Zoho expired-session errors;
      verify instance reuse in a real browser.
- [ ] **COR-18:** Log/retain Zoho status, request ID, and retryable; preserve a stable error code.
- [ ] **COR-19:** Use real ISO-4217 membership or relabel the validation claim.
- [ ] **COR-20:** Update the 707/708 test count, ADR-0003 test pointer, architecture state
      machine/log claim, ADR-0005 “process-local” wording, and the hosted signature references.

### Verification after fixes

- [ ] Run the full gate:
      `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:coverage && pnpm build && pnpm pack:check && pnpm verify:package`
- [ ] Live India smoke: create/retrieve a session with the production client.
- [ ] Live India hosted return: verify a real `mandate_id`-bearing signature.
- [ ] Live India widget: pay, complete, refund full and partial, verify webhook correlation.
- [ ] Repeat the smoke/return/refund checks for the US if claiming US support.
- [ ] Medusa integration fixture: create a session, attempt unpaid completion, pay, complete,
      webhook duplicate, refund, and old-session webhook.

---

## 7. Key references

**Medusa 2.22 (installed and inspected)**

- `@medusajs/types/dist/payment/provider.d.ts` — provider method contracts.
- `@medusajs/utils/dist/payment/payment-session.d.ts` — `PaymentSessionStatus`.
- `@medusajs/utils/dist/payment/webhook.d.ts` — `PaymentActions`.
- `@medusajs/payment/dist/services/payment-module.js` — session creation, authorization,
  capture, refund, webhook provider-id handling.
- `@medusajs/medusa/dist/subscribers/payment-webhook.js` — actions handled by Medusa.
- `@medusajs/core-flows/dist/cart/workflows/complete-cart.js` and
  `payment/steps/authorize-payment-session.js` — deferred authorization/completion behavior.
- Medusa docs: `pending_authorization` available since v2.17.2 —
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-session>

**Zoho Payments**

- Payment sessions (OpenAPI, request `amount` is `number/double`):
  <https://www.zoho.com/in/payments/api/v1/online-payment-session/online-payment-session.yml>
- Payments / statuses:
  <https://www.zoho.com/in/payments/api/v1/payments/>
- Refunds (request `amount` is `number/double`):
  <https://www.zoho.com/in/payments/api/v1/refunds/refunds.yml>
- Hosted checkout and the twelve-field return signature:
  <https://www.zoho.com/in/payments/developerdocs/web-integration/hosted-checkout/>
- Webhook verification:
  <https://www.zoho.com/in/payments/developerdocs/webhooks/verification/>
- Webhook events (current payment event list):
  <https://www.zoho.com/in/payments/api/v1/webhooks-events/>
- Signature verification (widget/general):
  <https://www.zoho.com/in/payments/developerdocs/signature-verification/>
- OAuth org flow:
  <https://www.zoho.com/in/payments/developerdocs/web-integration/org-oauth/>

**Repository**

- `AGENTS.md` invariants (money, signatures, secrets, no silent failures, test/ADR rules).
- `docs/testing.md` (coverage gate and known gaps).
- `docs/PROGRESS.md` (handoff status; this file is the missing independent correctness review).

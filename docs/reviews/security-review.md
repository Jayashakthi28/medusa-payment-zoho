# Security review — `medusa-payment-zoho`

> **INTERNAL — DO NOT PUBLISH WITH THE PACKAGE YET.**
> `package.json` publishes `docs/` (`files`, lines 59–66), so this file will be included
> in the npm tarball unless it is excluded. It describes an unfixed critical issue.
> See **SEC-16** below.

- **Review date:** 2026-10-23
- **Review type:** Independent, read-only security and correctness review
- **Target:** Current working tree (`git status` is dirty and many files are untracked;
  there is no single commit that contains the reviewed code)
- **Baseline:** Medusa `2.22.0`, Node 22, pnpm 11.5.1, package version `1.0.0`
- **Scope:** `src/**`, `package.json`, `scripts/**`, `.github/workflows/**`,
  `docs/decisions/**`, `test/**`, plus the installed Medusa payment/webhook sources
  needed to verify integration assumptions
- **Out of scope:** Zoho’s and Medusa’s own infrastructure, PCI DSS assessment, browser
  extensions, social engineering, live merchant accounts, and dependency CVE scanning

## Verification performed

Read-only commands:

| Command                 | Result                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `pnpm typecheck`        | Pass                                                       |
| `pnpm test`             | Pass — 17 files, 708 tests                                 |
| Local fake-client probe | Confirmed SEC-01 against built `dist/`; no Zoho calls made |

No live Zoho sandbox or running Medusa application was available. Findings that depend
on vendor behaviour are marked **needs live verification**. The critical finding was
also reproduced locally with the package’s own provider class and a fake client, so it
does not depend on vendor behaviour for the provider-side trust decision.

---

## 1. Executive summary

The cryptographic primitives are generally well implemented: webhook HMAC construction
matches Zoho’s documented format, comparison is constant-time, missing keys fail closed,
OAuth secrets are redacted, and the browser/server split is real. The main problem is not
cryptography — it is **trusting storefront-supplied payment-session `data` as if it were
server-owned state**.

### Findings at a glance

| ID     | Severity     | Finding                                                                                                               | Primary location                                                                                 | Test?                          |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| SEC-01 | **Critical** | Client-controlled `paymentId`/`zohoSessionId` are trusted for authorization                                           | `src/providers/zoho/service.ts:159-188, 251-255, 307-329, 567-601`                               | No                             |
| SEC-02 | **High**     | Webhook verifies `rawData` but maps an independently supplied `data`; object bodies are re-serialized                 | `src/providers/zoho/webhook.ts:53-63, 155-175`                                                   | No (test asserts the opposite) |
| SEC-03 | Medium       | `payment.failed → FAILED` is ignored by Medusa 2.22; failed sessions never transition                                 | `src/providers/zoho/webhook.ts:203-236`                                                          | Mapping only                   |
| SEC-04 | Medium       | Account/live-mode checks fail open when fields are absent                                                             | `src/providers/zoho/webhook.ts:89-111`                                                           | Test asserts fail-open         |
| SEC-05 | Medium       | Refund replay can report an unfinished/failed refund as success; currency comes from session data                     | `src/providers/zoho/service.ts:412-461`                                                          | Partial                        |
| SEC-06 | Medium       | Amounts are silently rounded and can become `"0"` after the positivity check                                          | `src/core/amount.ts:104-111`; `src/providers/zoho/service.ts:161-168, 408-425`                   | Partial                        |
| SEC-07 | Medium       | Zoho amount/currency is not reconciled with the Medusa session before `CAPTURED`/`SUCCESSFUL`                         | `src/providers/zoho/service.ts:580-601`; `webhook.ts:129-141, 188-201`                           | No                             |
| SEC-08 | Medium       | Fallback to client-supplied `medusaSessionId` can spoof webhook correlation                                           | `src/providers/zoho/service.ts:190-203`                                                          | No                             |
| SEC-09 | Medium       | `scriptUrl` accepts arbitrary scripts (XSS if caller passes untrusted input)                                          | `src/client/index.ts:221-249`                                                                    | Test accepts arbitrary URL     |
| SEC-10 | Medium       | Credential-bearing URL overrides allow arbitrary hosts and HTTP outside production                                    | `src/providers/zoho/options.ts:121-168`; `src/core/oauth.ts:219-247`; `src/core/http.ts:240-254` | No                             |
| SEC-11 | Low          | Hosted redirect trusts `checkoutUrl`; the documented return route does not bind the signed session/amount to the cart | `src/client/index.ts:470-491`; `docs/storefront-hosted.md:181-215`                               | Test accepts custom URL        |
| SEC-12 | Low          | No event-id replay dedupe; timestamp tolerance defaults to disabled                                                   | `src/core/signatures.ts:140-149`; `src/providers/zoho/options.ts:404-410`                        | Tolerance only                 |
| SEC-13 | Low          | Early-200 plus no durable dead-letter path loses webhook failures                                                     | `webhook.ts:531-545`; Medusa route/subscriber                                                    | No integration test            |
| SEC-14 | Low          | Signature helpers accept empty required identifiers                                                                   | `src/core/signatures.ts:174-186, 194-216`                                                        | Test asserts empty accepted    |
| SEC-15 | Low          | Unbounded client arrays and response bodies; retry/poll amplification                                                 | `src/providers/zoho/session-data.ts:53-68`; `src/core/http.ts:228-237`                           | No                             |
| SEC-16 | Medium       | Internal/security docs and unpinned CI actions in the release supply chain                                            | `package.json:59-66`; `.github/workflows/*.yml`                                                  | Partial                        |

**Bottom line:** do not ship this version. SEC-01 is a payment authorization bypass that
lets a customer reuse an old captured Zoho payment or session to complete a new cart.
SEC-02 is a conditional webhook signature-boundary flaw that becomes exploitable in a
custom ingress. Several medium issues affect refunds, amount correctness, and failed
payment state.

---

## 2. Threat model and assumptions

### Attacker capabilities assumed

- An unauthenticated or ordinary authenticated **storefront customer** with a publishable
  API key, their own cart, and the ability to call the Medusa Store API.
- The attacker can read their own payment-session `data`, widget responses, and order
  data. They can observe their own `payment_id` and Zoho `payments_session_id`.
- The attacker can send arbitrary JSON in the `data` field when creating a payment
  session (confirmed below in Medusa 2.22.0).
- The attacker **cannot** read server environment variables, the OAuth client secret,
  refresh token, access token, or Zoho signing key.
- An attacker who can influence provider configuration or environment variables is
  considered separately (SEC-10); this is a weaker precondition.

### Trusted components assumed

- Medusa core routes and the payment module are trusted to pass the correct payment
  session ID and amount.
- Zoho API responses and webhooks are trusted **only after** the signature check.
- Server-side configuration passed to the provider is trusted unless stated otherwise.

### Relevant Medusa behaviour (verified in installed 2.22.0 source)

- The Store API accepts an arbitrary `data` record when creating a payment session:
  `node_modules/@medusajs/medusa/dist/api/store/payment-collections/validators.js:7-12`
  (`z.record(z.string(), z.unknown())`) and
  `.../payment-sessions/route.js:6-17` (passes `req.body.data` to the workflow).
- The payment module creates the session and passes
  `data: { ...input.data, session_id: paymentSession.id }` to the provider:
  `node_modules/.pnpm/@medusajs+payment@.../node_modules/@medusajs/payment/dist/services/payment-module.js:154-172`.
- On completion, the provider’s `authorizePayment` output is used directly to create a
  payment for the **Medusa session amount**:
  `.../payment-module.js:243-313`.
- The webhook route passes `data: req.body` and `rawData: req.rawBody` from the same
  request, preserves the raw body, and sends HTTP 200 before the provider handler:
  `node_modules/@medusajs/medusa/dist/api/hooks/payment/[provider]/route.js:5-30`;
  `.../api/hooks/middlewares.js:4-10`.
- Medusa’s webhook subscriber early-returns for `FAILED`, `CANCELED`,
  `PENDING_AUTHORIZATION`, and `NOT_SUPPORTED` actions:
  `node_modules/@medusajs/medusa/dist/subscribers/payment-webhook.js:19-34`.

---

## 3. Findings

### SEC-01 — Critical — Client-controlled payment identifiers are trusted for authorization

**Location**

- `src/providers/zoho/service.ts:159-188` — `initiatePayment` reads
  `parseZohoSessionData(input.data)` and may reuse `existing.zohoSessionId`.
- `src/providers/zoho/service.ts:251-255` — newly created data is returned as
  `{ ...input.data, ...sessionData }`, so unknown client keys survive.
- `src/providers/zoho/service.ts:307-329` — `authorizePayment` trusts
  `sessionData.paymentId` first, then `sessionData.zohoSessionId`.
- `src/providers/zoho/service.ts:567-601` — `resolvePaymentAuthorization` retrieves the
  payment by the supplied ID and `toAuthorizeOutput` returns `CAPTURED` based only on
  Zoho status; neither ownership, amount, currency, nor `reference_number` is checked.
- `src/providers/zoho/session-data.ts:98-123, 202-218` — the “reusable session” decision
  is based entirely on client-supplied `amount`, `currencyCode`, `checkoutMode`,
  `expiresAt`, and `paymentId`.
- External: `node_modules/@medusajs/medusa/dist/api/store/payment-collections/validators.js:7-12`
  and `.../payment-sessions/route.js:6-17` accept arbitrary `data`;
  `.../@medusajs/payment/dist/services/payment-module.js:164` forwards it to the
  provider.

**Scenario (two independent paths)**

1. **Forged `paymentId` (simplest).** The customer completes a small order and learns
   their Zoho `payment_id` (the widget helper returns it in the browser; it is also
   stored in their payment data). They create a new payment session for an expensive
   cart with:

   ```json
   {
     "provider_id": "pp_zoho_zoho",
     "data": { "paymentId": "<their own captured payment id>" }
   }
   ```

   `initiatePayment` creates a **new** Zoho session but returns
   `{ ...input.data, ...sessionData }`; `paymentId` is not overwritten. On
   `cart.complete()`, `authorizePayment` sees `paymentId` and calls
   `retrievePayment(oldId)`. It returns `CAPTURED` and the old `paymentId`. The payment
   module creates a new Payment for the **new cart’s** amount and auto-captures it. No
   new money moves.

2. **Forged `zohoSessionId` (reuse path).** The customer creates a cheap cart, pays it,
   and keeps the Zoho `payments_session_id`. They create the expensive cart’s session
   with `data` containing that `zohoSessionId`, plus `amount` equal to the expensive
   cart’s formatted total, `currencyCode` matching, `checkoutMode: "widget"`, and a
   far-future `expiresAt`. `isReusableZohoSession` passes because every field is
   client-controlled. `initiatePayment` returns the old Zoho session ID without calling
   Zoho. `cart.complete()` retrieves that already-succeeded session and returns
   `CAPTURED`.

An older **unpaid** session with a lower amount can also be paid first and then reused,
so the attacker does not need a prior order.

**Impact**

- Complete an arbitrary cart without a new payment: **payment bypass / replay**.
- If Zoho treats the session amount as authoritative, the attacker pays the old lower
  amount and receives the new order: **underpayment**.
- Wrong `paymentId` becomes attached to the new payment, so later captures/refunds can
  reference a payment from a different order.
- The docs claim “a malicious browser cannot forge success by returning an arbitrary ID”
  (`docs/storefront-widget.md:31-33`), which is false for this data path.

**Evidence**

Local probe against the built `dist/` with a fake client (no Zoho calls):

```text
initiated data paymentId: old_paid_payment zohoSessionId: zoho_new
authorized status: captured paymentId: old_paid_payment paymentStatus: succeeded

createPaymentSession calls: 0 returned id: zoho_old_paid data zohoSessionId: zoho_old_paid
authorized status: captured paymentId: old_paid_payment
```

The tests only reuse data produced by the provider:
`test/providers/service-initiate.test.ts:265-284` and
`test/providers/service-lifecycle.test.ts:148-164` (authorize with a `paymentId` from
data). There is no test that supplies a forged `paymentId` or `zohoSessionId`, and no
test that checks the Zoho payment belongs to the current Medusa session.

**Recommended fix**

- Treat `input.data` as **untrusted display/cache input**, never as authorization state.
  On `initiatePayment`/`updatePayment`, ignore or strip `paymentId`, `zohoSessionId`,
  `expiresAt`, `amount`, `currencyCode`, `checkoutMode`, `medusaSessionId`, and
  `lastRefund*` from caller-supplied data. Persist only values returned by a server-side
  Zoho call.
- Prefer creating a new Zoho session for every new Medusa payment session. If reuse is
  required, keep the reuse decision in a server-owned store keyed by the Medusa
  `session_id`, or retrieve the Zoho session and verify:
  - `reference_number` / `meta_data.medusa_session_id` equals the current Medusa
    `data.session_id`;
  - `amount` and `currency` equal the Medusa session amount/currency;
  - the session is unpaid and its **server-returned** expiry is still in the future.
- On `authorizePayment`, require `input.data.session_id` (trusted) and verify the Zoho
  payment/session is bound to it. Reject a `paymentId` whose
  `payments_session_id` is not the stored server-created `zohoSessionId`; verify
  amount, currency, and status.
- Add regression tests for forged `paymentId`, forged `zohoSessionId`, a succeeded old
  session, a succeeded session with a different amount/currency, and a mismatched
  `reference_number`. All must reject before returning `CAPTURED`.
- Update ADR-0003’s reuse model; its current “client data is authoritative” design is the
  root cause (`docs/decisions/ADR-0003-session-lifecycle.md:65-83`).

**Test exists?** No. The existing tests confirm the unsafe paths, not the attack cases.

**Confidence:** High for the provider-side trust flaw and local reproduction. End-to-end
exploitation against a running Medusa + Zoho account is **needs live verification**
(e.g., whether a succeeded Zoho session remains retrievable as `succeeded` indefinitely).

---

### SEC-02 — High — Webhook signature covers `rawData`, but the event is read from separately supplied `data`

**Location**

- `src/providers/zoho/webhook.ts:53-63` — `parseRawBody` accepts a record and
  re-serializes it with `JSON.stringify`; any unsupported type becomes `""`.
- `src/providers/zoho/webhook.ts:155-175` — verification uses `rawBody`, then
  `parseEvent(payload.data)` reads a **different** field.
- `src/providers/zoho/webhook.ts:65-87` — `parseEvent` also accepts a JSON string,
  independent of the verified bytes.
- `test/providers/webhook.test.ts:62-89` — tests explicitly sign an object
  `{ event_type: "payment.succeeded" }` and return a full, different event object,
  expecting `SUCCESSFUL`. A second test signs an **empty** body and still maps arbitrary
  `data`.

**Scenario**

In the stock Medusa 2.22 route, `data` and `rawData` are produced from the same request
(`route.js:13`), so the mismatch is not reachable through that route. The provider is
also exported and documented for custom reconciliation routes. In a custom ingress,
proxy, queue, or future Medusa version that reconstructs `payload.data` separately from
`rawData` (a common mistake when forwarding events), an attacker who has any valid
signed body can present it as `rawData` while supplying a different event as `data`.
The HMAC passes over the benign body and the provider acts on the attacker-chosen
event. Conversely, if the raw body is lost and only `data` survives, the provider
re-serializes it and all legitimate signatures fail closed.

**Impact**

- Signature bypass / event substitution in non-stock integrations: mark another
  session paid, fail a session, or trigger reconciliation reads.
- Availability failure in integrations that do not preserve the exact raw body: all
  webhooks are rejected after the early 200, with no Zoho retry.
- The object fallback contradicts the project’s own “verify exact raw bytes” invariant.

**Evidence**

The test at `test/providers/webhook.test.ts:62-76` is a direct proof of acceptance:

```ts
const rawBody = { event_type: "payment.succeeded" }
const payload = {
  data: event, // full forged event, different object
  rawData: rawBody as unknown as string,
  headers: { "x-zoho-webhook-signature": signWebhookBody(JSON.stringify(rawBody)) },
}
const result = await handleZohoWebhook(payload, createClient(), handlerOptions())
expect(result.action).toBe(PaymentActions.SUCCESSFUL)
```

**Recommended fix**

- After verification, parse the **verified raw body** and use that as the event. Do not
  read `payload.data` for security decisions.
- Reject `rawData` that is not a `string` or `Buffer`; remove the object fallback and the
  unsupported-type-as-empty behavior.
- For `Buffer`, HMAC the bytes directly (or decode UTF-8 only after verifying it is valid
  UTF-8) rather than round-tripping through a JS string.
- Add a test where `rawData` and `data` describe different events; the result must follow
  `rawData` or reject.
- Remove or rewrite the two tests that assert canonicalization/empty-body acceptance.

**Test exists?** No negative test; the current tests encode the vulnerable behavior.

**Confidence:** High for the code behavior; **needs live verification** only for whether
any supported Medusa version or common proxy loses/mismatches `rawData`.

---

### SEC-03 — Medium — `payment.failed → FAILED` is ignored by Medusa 2.22

**Location**

- `src/providers/zoho/webhook.ts:203-236` — returns `PaymentActions.FAILED` for a
  terminal Zoho session.
- `docs/decisions/ADR-0004-webhook-authorization.md:84-94` and
  `docs/webhooks.md:136-146` claim Medusa applies the failure transition.
- External: `node_modules/@medusajs/medusa/dist/subscribers/payment-webhook.js:22-31`
  explicitly returns for `FAILED`, `CANCELED`, `PENDING_AUTHORIZATION`, and
  `NOT_SUPPORTED`.

**Scenario / impact**

A `payment.failed` event for a terminal session maps to `FAILED`, but Medusa’s core
subscriber ignores it. The Medusa payment session stays pending until expiry. The
provider’s reconciliation lookup and `FAILED` result are effectively a no-op in the
stock application. This is not a signature bypass or financial loss, but it is a
correctness/ops risk and the documentation is wrong. It also means a merchant relying on
the webhook to close failed checkouts will not see the state change.

**Evidence**

Tests cover only the provider mapping (`test/providers/webhook.test.ts:302-337`); there
is no Medusa integration test. `docs/testing.md:417-419` admits the missing Medusa
fixture.

**Recommended fix**

- Do not claim Medusa applies `FAILED`. Either document that the event is informational
  and relies on expiry/polling, or add a custom subscriber/job that updates the session
  through a supported Medusa path.
- Verify the behavior across the supported `>=2.16 <3.0` range; add an integration test
  with a running Medusa app before changing the mapping.
- Alternatively return `NOT_SUPPORTED` for `payment.failed` (truthful) and reconcile by
  polling, rather than emitting an action that is discarded.

**Test exists?** Mapping only; no integration test.

**Confidence:** High for Medusa 2.22.0; **needs live verification** for 2.16–2.21.

---

### SEC-04 — Medium — Account and live-mode checks fail open when fields are absent

**Location**

- `src/providers/zoho/webhook.ts:89-111` — rejects only when `account_id` is defined and
  different; only when `live_mode` is defined and different.
- `test/providers/webhook.test.ts:218-237` — explicitly accepts an event with a
  **missing** `live_mode` while `liveMode: true`.

**Scenario / impact**

If Zoho omits `live_mode` for an event type, or a proxy strips it, a test-mode event can
be accepted by a live deployment. If `account_id` is absent, a correctly signed event
from another Zoho account can be accepted when the signing key is shared (the docs
explicitly consider shared keys during migration, ADR-0004:154-155). The attacker would
still need a valid signature and a Medusa session ID in the event metadata, so the
practical exploitability depends on the deployment. The control is nevertheless
fail-open and should fail closed.

**Recommended fix**

- When `liveMode` is configured, require `event.live_mode` to be present and exactly
  equal. When `expectedAccountId` is configured (it always is), require `event.account_id`
  to be present and equal.
- If Zoho legitimately omits these fields for some event types, add an explicit,
  documented option to allow that per event type rather than silently accepting absence.
- Add rejection tests for missing `account_id` and missing `live_mode`.
- Verify against live Zoho event samples for every subscribed event type.

**Test exists?** The current test asserts the fail-open behavior; no rejection test.

**Confidence:** Medium; **needs live verification** of field presence per event type.

---

### SEC-05 — Medium — Refund replay and asynchronous status can report success incorrectly

**Location**

- `src/providers/zoho/service.ts:412-420` — replay returns `{ data: input.data }` when
  the idempotency key matches and `lastRefundId` exists, regardless of
  `lastRefundStatus` or amount.
- `src/providers/zoho/service.ts:441-461` — only immediate `status === "failed"` throws;
  `initiated`/`pending` are stored and returned as if the refund succeeded.
- `src/providers/zoho/service.ts:422-425` — currency comes from session data first,
  falling back to the payment only when absent.
- `test/providers/service-operations.test.ts:353-372` — replay test uses
  `lastRefundStatus: "succeeded"` only.

**Scenario / impact**

A refund that Zoho returns as `pending`/`initiated` is accepted by the provider. Medusa’s
payment module then marks its refund record `SUCCEEDED` after the provider call
(`.../payment-module.js:455-470`), even though Zoho may later fail it. A later retry with
the same idempotency key returns success without checking the current status. If a
`pending` refund failed, the merchant may believe the customer was refunded even though
no money moved. Using `sessionData.currencyCode` can also format the refund with the
wrong exponent if the stored data is stale/manipulated; the payment’s actual currency is
authoritative.

**Recommended fix**

- Replay only when `lastRefundStatus` is a terminal success. If it is pending/initiated,
  call `retrieveRefund(lastRefundId)` and return its current status; if failed, throw or
  create a new refund according to policy.
- Store `lastRefundAmount` and verify it matches `input.amount`; verify the currency.
- Always retrieve the payment and use `payment.currency` for formatting; reject a
  mismatch with the session data.
- Add a reconciliation job/subscriber for Zoho refund status (the package already ignores
  refund webhooks by design). At minimum, document that Medusa records async refunds as
  succeeded and that this must be reconciled manually.
- Tests: replay with `pending`, replay with `failed`, replay with a different amount,
  and a mismatched session/payment currency.

**Test exists?** Partial; only the succeeded replay case.

**Confidence:** High for the code behavior; **needs live verification** of Zoho refund
timing and whether pending refunds commonly fail later.

---

### SEC-06 — Medium — Amount formatting silently rounds and can produce `"0"`

**Location**

- `src/core/amount.ts:104-111` — `formatAmountForZoho` calls `toFixed(digits)`, which
  rounds to the currency’s fraction digits.
- `src/providers/zoho/service.ts:161-168` — `initiatePayment` formats first, then checks
  `isPositiveAmount(input.amount)` on the **original** amount.
- `src/providers/zoho/service.ts:408-425` — refunds check the original amount and then
  format.
- `test/core/amount.test.ts:189-204` — tests assert rounding (`100.9 JPY → "101"`,
  `1.2345 KWD → "1.235"`).
- `test/core/amount.test.ts:260-285` — `isPositiveAmount("0.0000000000000000001")` is
  `true`.

**Scenario / impact**

A positive amount below one minor unit becomes zero after formatting:

```text
0.4 JPY  formatted = 0     positive = true
0.001 INR formatted = 0.00 positive = true
0.004 USD formatted = 0.00 positive = true
1.005 USD formatted = 1.01 positive = true
```

`initiatePayment`/`refundPayment` pass the positivity check on the original number and
send the formatted `"0"`/`"0.00"` to Zoho. Depending on Zoho’s validation, this either
creates a zero-value session/refund or fails after the cart has started checkout. More
generally, any amount with more precision than the currency is silently changed, which
violates the project invariant “money is never guessed”. Medusa normally stores amounts
at currency precision, but custom flows, imports, or malformed webhook/order data can
supply more.

**Recommended fix**

- Validate the **formatted** amount is strictly greater than zero before calling Zoho.
- Reject amounts with more decimal places than the currency allows (throw
  `ZohoValidationError`) instead of rounding silently, or define and document an explicit
  rounding policy and compare the result to the request.
- Apply the same rule to refunds and webhook amounts.
- Tests: `0.4 JPY`, `0.001 INR`, `0.004 USD`, extra-precision input, and assert no Zoho
  call is made.

**Test exists?** Formatting/positivity tests exist, but none assert rejection after
formatting.

**Confidence:** High.

---

### SEC-07 — Medium — Zoho amount and currency are not reconciled before `CAPTURED`/`SUCCESSFUL`

**Location**

- `src/providers/zoho/service.ts:580-601` — `toAuthorizeOutput` returns `CAPTURED` if the
  session status is `succeeded`; it never compares amount/currency to the Medusa payment
  session.
- `src/providers/zoho/webhook.ts:129-141` — wraps Zoho’s amount in `new BigNumber`
  without validating finite/positive or matching it to a session.
- `src/providers/zoho/webhook.ts:188-201` — forwards `payment.amount` as the action
  amount.
- Medusa uses the webhook amount in `capturePaymentWorkflow`
  (`.../core-flows/dist/payment/workflows/process-payment.js:94-105`) and completes the
  cart after payment (`:180-190`).

**Scenario / impact**

If a signed event (or a reused session, see SEC-01) reports a lower amount than the
Medusa session, the provider returns `SUCCESSFUL` and Medusa may record a capture for the
event amount while still completing the cart. If a Zoho session/payment belongs to a
different currency or amount, the provider treats it as captured. This is a
defense-in-depth gap that becomes critical when combined with SEC-01; independently it
requires a Zoho-side anomaly or a signed malformed event. A signed event with
`amount: "NaN"`/negative/zero is also forwarded.

**Recommended fix**

- In `authorizePayment`, retrieve the session/payment and require:
  - `reference_number` / `meta_data.medusa_session_id` equals `data.session_id`;
  - amount equals the Medusa session amount (after SEC-01 makes that data trusted);
  - currency equals the Medusa session currency;
  - status is a valid captured/succeeded value.
- In webhook handling, retrieve the payment session (or payment) and compare
  `payment.amount`/`currency` to the session before returning `SUCCESSFUL`. Validate the
  amount is finite and `> 0`.
- Tests: amount mismatch, currency mismatch, zero/NaN amount, and a session with a
  different reference.

**Test exists?** No.

**Confidence:** High for the missing checks; impact depends on the anomaly source.

---

### SEC-08 — Medium — Fallback to client-supplied `medusaSessionId` can spoof webhook correlation

**Location**

- `src/providers/zoho/service.ts:190-203` — when `input.data.session_id` is absent,
  uses `existing.medusaSessionId` from `input.data` as the Zoho `reference_number` and
  `meta_data.medusa_session_id`.
- `src/providers/zoho/session-data.ts:160-177` — webhook extraction prefers that
  metadata and falls back to `reference_number`.

**Scenario / impact**

The Medusa payment module normally injects `session_id`, so the stock path is safe. But
the provider explicitly supports callers that do not supply it and treats the
client-supplied `medusaSessionId` as the bridge. A custom integration, an older Medusa
version, or a direct provider call could let a caller set `medusaSessionId` to another
customer’s Medusa payment session ID. They then create a Zoho session with that value in
its metadata/reference and pay it; the resulting signed `payment.succeeded` webhook maps
to the victim’s session and may complete the victim’s cart.

**Recommended fix**

- Require `input.data.session_id` (the payment module always supplies it in the
  supported versions). If absent, fail closed or create a session that is explicitly
  marked “no webhook bridge”, without using any caller-supplied ID.
- Remove the `existing.medusaSessionId` fallback entirely; it is not server-authenticated.
- Add a test where `session_id` is absent and a forged `medusaSessionId` is supplied;
  assert no Zoho metadata/reference is written from it.

**Test exists?** No negative test. `test/providers/service-initiate.test.ts:360-390`
covers only provider-created data.

**Confidence:** High for the code behavior; exploitability requires a path without
`session_id`. **Needs live verification** for older Medusa versions.

---

### SEC-09 — Medium — Arbitrary `scriptUrl` allows script injection in the storefront

**Location**

- `src/client/index.ts:221-249` — `loadZohoPaymentsScript` sets `script.src` to
  `options.scriptUrl` with no protocol/host validation.
- `src/types.ts:94-97` — the public input documents an override “for CSP/self-hosting”.
- `test/client/widget.test.ts:270-285` — a test accepts
  `https://cdn.example.test/zpayments.js`; any URL is accepted.

**Scenario / impact**

If an application wires `scriptUrl` to a query parameter, CMS value, tenant setting, or
other untrusted input, an attacker can load arbitrary JavaScript into the checkout page.
That script runs with the page’s origin and can read the cart, customer data, and payment
session data, alter the checkout UI, or exfiltrate the widget `payment_id`. This is
stored/reflected XSS with payment-page impact. The default path uses the official Zoho
CDN and is safe; the vulnerability is in the exposed override.

**Recommended fix**

- Accept only `https:` URLs; reject `http:`, `javascript:`, `data:`, `file:`, and
  credentialed URLs.
- Default to an allowlist of `static.zohocdn.com`; allow a self-hosted origin only through
  an explicit configuration option.
- Support `integrity`/`crossOrigin` for self-hosted builds and document that the URL is
  trusted configuration, never user input.
- Add rejection tests for `javascript:`, `data:`, `http:`, and an arbitrary host.

**Test exists?** The current test accepts an arbitrary HTTPS host; no rejection test.

**Confidence:** High for the API; exploitability depends on the caller.

---

### SEC-10 — Medium — Credential-bearing endpoint overrides allow arbitrary hosts and HTTP

**Location**

- `src/providers/zoho/options.ts:121-168` — `validateUrl` accepts any `http:`/`https:`
  URL; in non-production it accepts any HTTP host, and the production check relies on
  `NODE_ENV === "production"`.
- `src/providers/zoho/options.ts:151-168` — `apiBaseUrl`, `accountsBaseUrl`, and
  `hostedCheckoutBaseUrl` are all overridable.
- `src/core/oauth.ts:219-247` — sends `client_secret` and `refresh_token` to
  `accountsBaseUrl`.
- `src/core/http.ts:240-254` — sends the access token to `apiBaseUrl`.

**Scenario / impact**

If an attacker can influence provider configuration or environment variables (a
compromised deployment pipeline, a multi-tenant config injection, or a mis-set env var),
they can point `accountsBaseUrl` at their server and receive the long-lived refresh token
and client secret, or point `apiBaseUrl` at their server and receive access tokens. With
`NODE_ENV` unset/`"prod"` (not exactly `"production"`), an HTTP URL is accepted and
credentials travel in cleartext. `successUrl`/`failureUrl` can also be pointed at an
attacker site for phishing. The defaults (regional Zoho HTTPS hosts) are safe; the risk
is the unrestricted override surface.

**Recommended fix**

- By default, allow only the known Zoho hosts for the selected region. Add an explicit
  `allowCustomEndpoints: true` escape hatch for tests/private gateways, documented as
  unsafe.
- Always require HTTPS for any URL that carries credentials; allow HTTP only for
  loopback with a non-production marker, and reject loopback in production unless the
  explicit escape hatch is set.
- Reject URLs with embedded credentials, query strings, or fragments for these endpoint
  options.
- Add tests for arbitrary hosts, HTTP, `NODE_ENV` values other than `production`, and
  credential-bearing URLs.

**Test exists?** URL shape/production tests exist in `test/providers/options.test.ts`;
no host allowlist or credential-transport test.

**Confidence:** High; config-only precondition.

---

### SEC-11 — Low — Hosted redirect trusts `checkoutUrl`; docs do not bind signed fields to the cart

**Location**

- `src/client/index.ts:470-491` — `redirectToZohoHostedCheckout` calls
  `location.assign(parsed.checkoutUrl)` after only checking non-empty/expiry/mode.
- `test/client/widget.test.ts:917-927` — explicitly accepts
  `https://checkout.example.test/zoho/abc`.
- `docs/storefront-hosted.md:181-215` — verifies the signature and status, then calls
  `cart.complete(cartId)`, but does not compare `payments_session_id` to the cart’s stored
  `zohoSessionId` or `amount` to the cart total.

**Scenario / impact**

If `session.data.checkoutUrl` is client-influenced (SEC-01’s reuse path) or an app passes
untrusted data to the helper, the customer can be navigated to an attacker-controlled
page. This is mostly self-phishing (the attacker controls their own browser), but it
violates the docs’ “no open redirect” checklist. The documented return route can accept a
valid signature for a different session; `cart.complete` revalidates the cart’s stored
session, so a direct payment bypass is not demonstrated, but the route should still bind
the signed `payments_session_id` and `amount` to the cart.

**Recommended fix**

- Validate `checkoutUrl`: `https:` only; host must be the regional `payments.zoho.*`
  host or an explicitly configured trusted base; reject credentials/fragments.
- In the hosted success/failure route, compare `payments_session_id` with the stored
  `data.zohoSessionId` and `amount` with the cart total before calling `cart.complete`.
- Add tests for an arbitrary redirect host and a mismatched session/amount.

**Test exists?** The current test accepts a custom URL; no rejection test.

**Confidence:** High for the code/docs; low exploit impact in the normal flow.

---

### SEC-12 — Low — No replay dedupe; timestamp tolerance defaults to disabled

**Location**

- `src/core/signatures.ts:140-149` — tolerance is optional; `0` disables the age check.
- `src/providers/zoho/options.ts:404-410` — default `webhookToleranceSeconds` is `0`.
- `src/providers/zoho/webhook.ts:203-237` — `payment.failed` performs an outbound
  session lookup on every delivery.
- No `event_id` store/dedupe exists in the provider.

**Scenario / impact**

A captured signed webhook body can be replayed indefinitely. The handler is read-only for
success/pending, and Medusa’s workflow is largely idempotent, so the financial impact is
limited. Replaying `payment.failed` triggers repeated Zoho API calls, which can consume
the account rate limit and delay real traffic. A replay after a refund/order change could
re-trigger completion attempts; Medusa’s state checks are the only guard.

**Recommended fix**

- Add a bounded event-ID dedupe cache/store (Redis or database) keyed by `event_id`, with
  a TTL covering Zoho’s retry window.
- Keep the default tolerance disabled only with an explicit documented risk, or apply a
  per-event policy (e.g., require a fresh timestamp for `payment.failed` but allow older
  success events).
- Add tests that deliver the same event twice and assert only one outbound lookup/side
  effect.

**Test exists?** Tolerance tests only; no replay/dedupe test.

**Confidence:** High; impact low under Medusa’s idempotency.

---

### SEC-13 — Low — Early HTTP 200 plus no durable dead-letter path loses webhook failures

**Location**

- `src/providers/zoho/service.ts:531-545` — `getWebhookActionAndData` throws on
  verification/mapping/API errors.
- `src/providers/zoho/webhook.ts:218-230` — `payment.failed` performs a network call
  inside the handler.
- Medusa route: `.../api/hooks/payment/[provider]/route.js:16-29` emits the event and
  sends 200 before the handler; the subscriber retries the event up to `webhook_retries`
  (default 3) but there is no dead-letter store.

**Scenario / impact**

A transient Zoho API error during `payment.failed` reconciliation, or a rejected
signature, is invisible to Zoho because it already received 200. The event may be retried
by Medusa’s event bus a few times, then dropped. A rejected signature is a security event
and is logged, but a transient failure can leave a session unresolved. This is documented
in ADR-0004 and `docs/webhooks.md`, so it is an accepted residual risk, not a hidden bug.
It becomes more important with SEC-12 replay and SEC-05 refund reconciliation gaps.

**Recommended fix**

- Add a custom ingress route that verifies and returns non-2xx before forwarding, if
  Zoho retries are required; or add a durable event store/DLQ and a reconciliation job.
- Emit metrics/alerts for `ZOHO_WEBHOOK_VERIFICATION_ERROR` and for
  `payment.failed` reconciliation failures.
- Consider returning `PENDING_AUTHORIZATION` (and logging) instead of throwing on a
  transient `payment.failed` lookup failure, so the session remains open and a
  reconciliation job can resolve it.
- Add an integration test with a running Medusa app, since unit tests cannot reproduce
  the early 200.

**Test exists?** No integration test.

**Confidence:** High; accepted design risk.

---

### SEC-14 — Low — Signature helpers accept empty required identifiers

**Location**

- `src/core/signatures.ts:174-186` — widget verifier accepts empty `paymentId` and
  `paymentSessionId`.
- `src/core/signatures.ts:194-216` — hosted verifier accepts empty
  `paymentsSessionId` and `paymentSessionStatus`.
- `test/core/signatures.test.ts:472-483` — explicitly asserts that
  `paymentId: ""`, `paymentSessionId: ""`, and `signature: hmac("|")` is valid.

**Scenario / impact**

A caller that maps missing query parameters to empty strings can verify a signature over
`"|"` or a message with empty required fields. The attacker still needs the signing key
to produce the HMAC, so this is not directly exploitable; it is a dangerous API footgun
and weakens presence validation. It can also make a malformed route accept a
semantically empty return.

**Recommended fix**

- Reject empty required fields in both helpers, and require a 64-character lowercase or
  uppercase hex signature (or at least non-empty hex) before the timing compare.
- Change the test that currently asserts empty acceptance to assert rejection.

**Test exists?** Yes, but it asserts the unsafe behavior.

**Confidence:** High; low impact.

---

### SEC-15 — Low — Unbounded client arrays/bodies and retry/poll amplification

**Location**

- `src/providers/zoho/session-data.ts:53-68` — `previousZohoSessionIds` accepts any
  number of strings from client data.
- `src/providers/zoho/service.ts:246-248` — appends every superseded session to that
  array; it can grow with each cart update.
- `src/core/http.ts:228-237` and `src/core/oauth.ts:239-255` — `response.text()` reads
  the full body with no size cap.
- `src/core/http.ts:273-287` — retries use exponential backoff without jitter; config
  allows up to 10 retries and 120s timeouts.
- `src/providers/zoho/service.ts:548-565` — authorization polling can issue up to 11
  requests with 10s intervals and 120s timeouts.

**Scenario / impact**

A malicious customer can repeatedly update a cart to grow `previousZohoSessionIds` and
the payment-session JSON, bloating storage and every storefront response. A compromised
or attacker-controlled upstream endpoint (possible with SEC-10) can return a huge body
and exhaust memory. Repeated `cart.complete`/webhook calls can hold workers in long
retry/poll loops and consume Zoho rate limits. The defaults are moderate; the maximum
configuration is the risk.

**Recommended fix**

- Cap `previousZohoSessionIds` (e.g., 5) and strip it from client input; cap all
  provider-owned strings/arrays.
- Add a response-size limit (stream or check `Content-Length` and abort) for Zoho and
  OAuth responses.
- Add jitter to retries, set `redirect: "error"`, and consider a separate shorter
  timeout for webhook-triggered reconciliation calls.
- Add tests for oversized arrays/bodies and retry bounds.

**Test exists?** No.

**Confidence:** High; low-to-moderate impact.

---

### SEC-16 — Medium — Internal/security docs and the release supply chain

This entry combines two packaging/supply-chain issues that share a remediation step.

**Location**

- `package.json:59-66` — `files` includes `docs`, so this review, `docs/PROGRESS.md`,
  `docs/research/**`, and the ADRs are published to npm.
- `package.json:67-80` — `prepublishOnly` runs the full check; no `postinstall`/`preinstall`
  (good), but the release workflow runs `pnpm install` with dependency lifecycle scripts.
- `.github/workflows/ci.yml:30-38` and `release.yml:24-41` — `actions/checkout@v4`,
  `pnpm/action-setup@v4`, `actions/setup-node@v4`, `upload-artifact@v4` are tag-pinned,
  not commit-SHA-pinned.
- `docs/testing.md:429-437` — the package-type gap is documented; `verify-package`
  does not assert tarball contents beyond client bundle purity.

**Scenario / impact**

Publishing this review before remediation discloses the critical exploit path and
internal notes to every npm consumer. A compromised action tag or dependency install
script can execute in the release job that has `id-token: write` and `NPM_TOKEN`,
leading to a malicious package publish. The package has no runtime dependencies, which
reduces but does not eliminate the risk.

**Recommended fix**

- Exclude `docs/reviews/**`, `docs/PROGRESS.md`, `docs/research/**`, and any internal
  notes from `files`; add an `.npmignore`/`files` allowlist for public docs only.
- Add a `verify:package` assertion that the tarball does not contain `docs/reviews`,
  `.env`, `test`, `src`, or credentials.
- Pin GitHub Actions by full commit SHA and review the lockfile; use
  `pnpm install --ignore-scripts` where possible, with an explicit allowlist for packages
  that genuinely need scripts.
- Keep `NODE_AUTH_TOKEN` scoped to the publish step (already done) and retain provenance.

**Test exists?** Partial: `pnpm pack:check`/`verify-package` check exports and client
purity, but not sensitive docs or action pinning.

**Confidence:** High.

---

## 4. Minor correctness and hardening notes

These are lower severity but worth fixing alongside the main findings.

| ID     | Severity | Location                                                          | Scenario / impact                                                                                                                                                                                                                                                                  | Fix                                                                                                                                                              | Test?                   |
| ------ | -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SEC-17 | Low      | `src/core/signatures.ts:117-123, 153`                             | `parseZohoSignatureHeader` converts `t` to a Number and uses the canonical number in the HMAC. A valid header with leading zeros or a non-canonical form (`t=00173...`, `t=1.734e12`) fails even though the raw `t` was what Zoho signed. Zoho currently sends plain milliseconds. | Use the raw `t` string in the message; parse a Number only for tolerance. Validate `t` with a digit regex. Add a test.                                           | No                      |
| SEC-18 | Low      | `src/client/index.ts:42-46, 429-446`                              | The widget response interface omits `payment_session_id`; the helper returns the stored `session.zohoSessionId` as `paymentSessionId`. If Zoho returns a different session ID or the caller expects the signed value, server verification against the stored ID may fail/mislead.  | Read `response.payment_session_id` when present; require it equals the stored session ID before returning `ok`; include it in the result and docs.               | No                      |
| SEC-19 | Low      | `src/providers/zoho/options.ts:421-430`                           | Missing `signingKey` only logs a one-time `console.warn`; production can start and accept payments with webhook verification unavailable. Webhooks fail closed, but the merchant may not notice until reconciliation is needed.                                                    | In production, fail startup unless `signingKey` is set, or require an explicit `allowUnsignedWebhooks` opt-in. Prefer the structured logger over `console.warn`. | Partial (options tests) |
| SEC-20 | Low      | `src/providers/zoho/webhook.ts:41-47`; `src/core/http.ts:256-271` | `getHeader` can return an array with non-string entries; `parseZohoSignatureHeader` then calls `.split` on a non-string and throws an untyped error. Zoho `message` values are logged verbatim; a compromised/misconfigured upstream can echo PII or a secret.                     | Type-check every header entry and return `undefined`/typed error. Cap/redact upstream `message` before logging. Add tests.                                       | No                      |
| SEC-21 | Low      | `src/providers/zoho/webhook.ts:113-127`                           | `getPayment` requires `amount`, `currency`, and `status` to be strings. If Zoho sends numeric amounts/statuses, a valid event is acknowledged as `NOT_SUPPORTED` and the payment is not completed.                                                                                 | Accept finite numbers and stringify; validate currency/amount/status explicitly; add numeric fixture tests.                                                      | No                      |
| SEC-22 | Low      | `src/providers/zoho/options.ts:31, 244-264`                       | Reserved metadata keys are checked case-sensitively. A key such as `MEDUSA_SESSION_ID` can be sent alongside the provider’s `medusa_session_id`. If Zoho treats keys case-insensitively, the bridge can become ambiguous.                                                          | Normalize/reject reserved keys case-insensitively; validate key length/charset.                                                                                  | No                      |

---

## 5. Verified safe

The following controls were checked and are working as intended in the reviewed code.
This is not a claim that the whole package is safe; it is a list of areas that withstood
review.

### Webhook cryptography (stock Medusa path)

- Zoho’s published verification contract matches the implementation: header
  `X-Zoho-Webhook-Signature: t=<epoch-ms>,v=<hex>`, message `${t}.${payload}`,
  HMAC-SHA256, header name case-insensitive. Verified against Zoho’s official
  “Verifying Webhooks” documentation on 2026-10-23.
- The stock Medusa 2.22 route uses `preserveRawBody: true`, passes `req.rawBody`, and the
  subscriber reconstructs a serialized Buffer before the provider runs. The raw-body
  path is correct in this version.
- HMAC is lower-case hex; comparison decodes both sides, checks equal buffer lengths,
  uses `crypto.timingSafeEqual`, and rejects empty signatures
  (`src/core/signatures.ts:55-73`).
- Wrong key, tampered body, missing/malformed header, zero/negative timestamp, wrong
  length, and non-hex signatures are rejected. Tests cover these
  (`test/core/signatures.test.ts:111-350`).
- Missing/empty signing key throws `ZohoConfigurationError`; the provider rejects before
  parsing the event (`src/core/signatures.ts:47-53`; `webhook.ts:157-173`).
- Signature verification happens before JSON parsing, account checks, and event mapping.
- `payment.failed` is reconciled against the Zoho session instead of failing on every
  attempt (`webhook.ts:203-236`), even though the resulting `FAILED` action is ignored by
  Medusa 2.22 (SEC-03).
- Unsupported/refund/payout events return `NOT_SUPPORTED`; a missing Medusa session
  bridge returns `NOT_SUPPORTED` without a write (`webhook.ts:178-185, 239-253`).

### Signature helper message construction

- Widget message is `payment_id|payment_session_id`, matching Zoho’s “Signature
  Verification” documentation.
- Hosted checkout message is the ten dot-joined fields with empty strings for absent
  optional fields, matching Zoho’s hosted-checkout documentation and worked example.
- Field order is fixed; the amount is not reformatted; tests cover all-present,
  absent-optionals, reordered/mismatched fields, and wrong keys
  (`test/core/signatures.test.ts:486-631`).

### Secret handling

- The OAuth client secret, refresh token, signing key, and access token are not written
  to payment-session `data`; tests assert the serialized data does not contain them
  (`test/providers/service-initiate.test.ts:84-91`).
- The widget API key is intentionally public and is not the client secret/refresh
  token/signing key.
- OAuth error descriptions are redacted for the client secret and refresh token before
  reaching a message/cause; tests cover echoed secrets (`test/core/oauth.test.ts:656-677`).
- HTTP logging emits only attempt/delay and method/path/status/code; tests assert request
  bodies, bearer tokens, and authorization headers are absent
  (`test/core/http.test.ts:896-921`).
- Error translation logs action and code, not request bodies or raw webhook bodies
  (`src/providers/zoho/service.ts:650-679`).
- No working credentials were found by the high-signal scans performed against the
  current tree and git history. `.env` is
  ignored; `.env.example` contains empty values. `scripts/get-refresh-token.mjs` prints
  the refresh token by design and warns the user; it binds the callback to `127.0.0.1`
  and validates OAuth `state` (`scripts/get-refresh-token.mjs:265-397, 512-526`).
- `scripts/verify-package.mjs` removes `NODE_AUTH_TOKEN`/`NPM_TOKEN` from the consumer
  environment and uses `--ignore-scripts` for the consumer install
  (`scripts/verify-package.mjs:56-69, 310-322`).

### OAuth and HTTP transport

- Token cache uses `expires_in - min(60s, expires_in / 2)`, so short-lived tokens are not
  cached past their real lifetime (`src/core/oauth.ts:122-127, 277-284`).
- Concurrent refreshes are collapsed into one in-flight promise
  (`src/core/oauth.ts:152-168`); failures clear the slot.
- 401 invalidates the cached token and retries the request once; a second 401 is surfaced
  (`src/core/http.ts:173-177`).
- 429 and 5xx are retryable for safe calls; refund POSTs use `retryPolicy: "none"` and do
  not retry network timeouts or ambiguous 5xx (`src/core/zoho-client.ts:226-231`;
  `src/core/http.ts:87-93`).
- `Retry-After` (seconds or HTTP date) is parsed and capped at 30 seconds
  (`src/core/http.ts:109-130`).
- Every request has an `AbortSignal.timeout(timeoutMs)` and the body is read inside the
  try block, so streaming timeouts become transport errors
  (`src/core/http.ts:228-237`).
- Token response parsing rejects non-object JSON and missing/empty access tokens; terminal
  OAuth 4xx is not retried (`src/core/oauth.ts:51-67, 219-285`).
- The 401 path does not loop; authentication retry is a single boolean.
- The token endpoint and API paths are fixed relative to the configured base; payment IDs
  are `encodeURIComponent`-encoded (`src/core/zoho-client.ts:167-258`).

### Amounts (except SEC-06/SEC-07)

- All arithmetic uses Medusa’s `BigNumber`/bignumber.js; no binary floating point is used
  for money.
- `NaN`, `Infinity`, malformed strings, and invalid `BigNumber` objects throw a typed
  `ZohoValidationError` (`src/core/amount.ts:73-95`).
- ISO-4217 shape is validated; `Intl.NumberFormat` supplies fraction digits (INR/USD 2,
  JPY 0, KWD/BHD 3) (`src/core/amount.ts:5-35`).
- Zero and negative amounts are rejected at the provider boundaries for initiate/refund
  (`service.ts:164-168, 408-410`), subject to the formatting issue in SEC-06.

### Session lifecycle (except SEC-01/SEC-08)

- Zoho expiry is normalized defensively: seconds vs milliseconds, non-finite/zero/
  negative values fall back to 15 minutes (`session-data.ts:221-240`).
- A successful Zoho session maps to `CAPTURED`; unknown statuses map to `PENDING`, never
  success (`src/core/status.ts:3-53`).
- Capture is verification, not an action: the provider retrieves the payment and returns
  success only for captured statuses; failed/blocked are rejected; uncaptured throws
  `ZohoUnsupportedOperationError` (`service.ts:331-366`).
- Cancel is honest about Zoho’s missing API: no fake cancellation; captured payments are
  rejected and pending payments are left to expire (`service.ts:368-395`).
- `deletePayment` is a documented local no-op (`service.ts:301-305`).
- Session metadata is capped at five entries and reserved keys are rejected
  (`session-data.ts:126-150`; `options.ts:223-267`).
- Resolved options and nested collections are frozen (`options.ts:371-417`).

### Browser entry point and packaging

- `src/client/index.ts` imports only types and `core/errors`; it does not import
  `node:*` or `@medusajs/*`. `scripts/verify-package.mjs:137-151` scans both client
  bundles for those tokens.
- Calling the helper during SSR throws a typed `ZohoValidationError`
  (`src/client/index.ts:95-101`).
- The default script URL is the official Zoho CDN; the script is loaded once, concurrent
  loads share a promise, and failed tags are removed so retry can work
  (`src/client/index.ts:221-268`).
- Error messages from the third-party widget are returned as data; the library does not
  inject them as HTML. The docs render them as text.
- The package has no runtime dependencies beyond Medusa peer packages; no
  `postinstall`/`preinstall` scripts (`package.json:114-135`).
- Tarball `files` excludes `src`, `test`, `examples`, `coverage`, `node_modules`, and
  `.env` (`package.json:59-66`); no secrets were found in the shipped docs.
- CI has `contents: read`, a frozen lockfile, a 100% coverage gate, and package
  verification; release is tag-gated, version-checked, and uses npm provenance with the
  token scoped to the publish step (`ci.yml:9-14, 44-92`; `release.yml:9-56`).

### Medusa integration assumptions that held

- Stock 2.22 webhook route preserves the exact raw body and passes the parsed body from
  the same request (`route.js:11-14`; `middlewares.js:4-10`).
- The payment module injects the Medusa `session_id` into provider data on create
  (`payment-module.js:154-172`).
- The payment module creates the Payment at the Medusa session amount, not the provider’s
  reported amount (`payment-module.js:282-313`), which limits some amount-mismatch impact
  but not the SEC-01 replay path.
- The webhook subscriber ignores non-success actions, including `FAILED`
  (`payment-webhook.js:19-34`), which is the basis of SEC-03.

---

## 6. Needs live verification

These items could not be proven with the checked-in unit suite. They do not block the
code-level findings above, but they affect exploitability or severity.

1. **Zoho session replay retention.** Does `GET /paymentsessions/{id}` continue to return
   `status: "succeeded"` and the successful `payments[]` for an old session after 15
   minutes, days, or after a refund? SEC-01’s session-reuse path assumes yes; the
   `paymentId` path does not depend on the session status.
2. **Zoho widget amount authority.** Does the widget use the session’s stored amount or
   the client-supplied `amount`? This determines whether an old **unpaid** lower-amount
   session can be paid and then reused for underpayment.
3. **Zoho `live_mode`/`account_id` presence.** Are these fields always present on every
   subscribed event type, including test pings, `payment.failed`, refunds, and payouts?
   SEC-04’s fail-open behavior matters only when they are absent.
4. **Shared signing keys.** Do Zoho test/live or multiple accounts ever share a Developer
   Space signing key? The docs assume one key for webhook/widget/hosted; verify the
   account isolation model.
5. **Medusa 2.16–2.21 raw-body behavior.** Does every supported Medusa version preserve
   `req.rawBody` for `/hooks/payment/:provider`? If not, SEC-02’s availability failure is
   live for those versions.
6. **Medusa 2.16–2.21 action handling.** Does every supported version ignore `FAILED`
   in the payment webhook subscriber as 2.22 does? SEC-03 may be version-specific.
7. **Zoho refund asynchrony.** How often do `initiated`/`pending` refunds later fail, and
   how long do they remain pending? This determines SEC-05’s financial impact.
8. **Zoho error payloads.** Do error `message` fields ever echo customer PII, metadata, or
   credentials? SEC-20’s log exposure depends on this.
9. **Zoho numeric fields.** Are `amount`, `currency`, `status`, `account_id`, and
   `live_mode` always strings/booleans as documented, or can they be numbers?
10. **Hosted checkout return binding.** Does Zoho guarantee that
    `payments_session_id` in the return URL always equals the session created for that
    cart? The docs’ return route should still compare it to stored data.

---

## 7. Test coverage observations

The suite reports 708 passing tests and 100% lines/branches/functions/statements. That is
useful for regression, but it is **not** evidence that the security boundaries are
correct. Several tests explicitly encode the weaker behavior:

- `test/providers/webhook.test.ts:62-89` accepts an object `rawData` that is re-serialized
  and an empty body while trusting a different `data` object (SEC-02).
- `test/providers/webhook.test.ts:218-237` accepts a missing `live_mode` with
  `liveMode: true` (SEC-04).
- `test/core/amount.test.ts:189-204` asserts silent rounding (SEC-06).
- `test/core/signatures.test.ts:472-483` accepts empty widget identifiers (SEC-14).
- `test/client/widget.test.ts:917-927` accepts an arbitrary hosted redirect URL (SEC-11).
- `test/providers/service-initiate.test.ts:265-284` and
  `test/providers/service-lifecycle.test.ts:148-164` exercise reuse/authorization only
  with provider-created data; there is no forged `paymentId`/`zohoSessionId` test
  (SEC-01).
- `test/providers/service-operations.test.ts:353-372` covers only a succeeded refund
  replay (SEC-05).

The suite also has no running-Medusa fixture, no live Zoho sandbox, and no real-browser
E2E (`docs/testing.md:411-443`). Add at least one Medusa integration test for the
webhook route, payment-session create with hostile `data`, and cart completion before
relying on the webhook/authorization mapping.

---

## 8. Prioritized remediation checklist

### P0 — block release

- [ ] **SEC-01:** Stop trusting `input.data` for payment identity. Strip/reject
      `paymentId`, `zohoSessionId`, `expiresAt`, `amount`, `currencyCode`,
      `checkoutMode`, and `medusaSessionId`; create a new Zoho session or verify the
      existing one against the trusted Medusa `session_id`, amount, currency, and
      reference. Add forged-data regression tests.
- [ ] **SEC-02:** Parse the verified `rawData` and use that as the event; reject
      non-string/Buffer raw bodies; remove the object/empty-body fallback; add a
      `rawData`/`data` mismatch test.
- [ ] **SEC-03:** Decide and document the real `payment.failed` behavior under Medusa
      2.22; add a Medusa integration test or a custom reconciliation path.
- [ ] **SEC-04:** Make account/live-mode checks fail closed when configured; add
      missing-field rejection tests.
- [ ] **SEC-05:** Require a terminal successful status for refund replay; verify amount
      and currency; use the payment’s currency; add a reconciliation plan for async
      refunds.
- [ ] **SEC-06:** Reject amounts that format to zero or lose precision; validate the
      formatted amount, not only the raw input.
- [ ] **SEC-07:** Compare Zoho amount/currency/reference to the Medusa session before
      returning `CAPTURED`/`SUCCESSFUL`.
- [ ] **SEC-08:** Require `input.data.session_id`; remove the client `medusaSessionId`
      fallback.
- [ ] **SEC-09:** Restrict `scriptUrl` to HTTPS + an allowlist or explicit self-host
      config; add XSS rejection tests.
- [ ] **SEC-10:** Restrict endpoint overrides to known Zoho hosts by default; require
      HTTPS for credential-bearing URLs; add tests for arbitrary hosts and
      `NODE_ENV` variants.
- [ ] **SEC-16:** Exclude `docs/reviews/**` and internal docs from the npm tarball; do
      not publish this review before remediation.

### P1 — before the next release

- [ ] **SEC-11:** Validate hosted `checkoutUrl` origin/protocol; update the docs’ return
      route to bind the signed session ID and amount to the cart.
- [ ] **SEC-12:** Add event-ID dedupe with a TTL and a documented replay policy; add a
      replay test.
- [ ] **SEC-13:** Add a DLQ/reconciliation job or a custom ingress that can return
      non-2xx; add metrics for verification and reconciliation failures.
- [ ] **SEC-14:** Reject empty required signature fields and non-hex signatures; update
      the tests.
- [ ] **SEC-15:** Cap `previousZohoSessionIds`, response bodies, and retry/poll
      amplification; add jitter and `redirect: "error"`.

### P2 — hardening and correctness

- [ ] **SEC-17:** Use the raw `t` string for HMAC; parse a Number only for tolerance.
- [ ] **SEC-18:** Read/compare `payment_session_id` from the widget response.
- [ ] **SEC-19:** Fail production startup when `signingKey` is missing, or require an
      explicit opt-in.
- [ ] **SEC-20:** Type-check header arrays; cap/redact upstream `message` in logs.
- [ ] **SEC-21:** Accept numeric webhook fields defensively.
- [ ] **SEC-22:** Normalize reserved metadata keys case-insensitively; cap key lengths.
- [ ] Add a `verify:package` assertion for sensitive files (reviews, `.env`, tests,
      source) and pin GitHub Actions by commit SHA.

### Verification after fixes

- [ ] Add a Medusa 2.22 integration test: create payment session with forged
      `paymentId`, call `cart.complete`, assert rejection and no order.
- [ ] Add a test with a real signed webhook whose `rawData` and `data` differ; assert the
      verified body wins or the request is rejected.
- [ ] Add a live/sandbox test for an old succeeded session and an old captured payment
      (use test accounts; no production money).
- [ ] Re-run `pnpm check` and inspect `npm pack --dry-run` for `docs/reviews` and secrets.
- [ ] Consider a second independent review of the fixed trust boundary before release.

---

## Appendix A — evidence map

| Claim                                                   | Evidence                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Store API accepts arbitrary `data`                      | `node_modules/@medusajs/medusa/dist/api/store/payment-collections/validators.js:7-12`; `.../payment-sessions/route.js:6-17` |
| Payment module forwards `data` and injects `session_id` | `.../@medusajs/payment/dist/services/payment-module.js:154-172`                                                             |
| Payment is created at the Medusa session amount         | `.../payment-module.js:282-313`                                                                                             |
| Completion calls provider authorization                 | `.../@medusajs/core-flows/dist/cart/workflows/complete-cart.js:555-570`                                                     |
| `processPaymentWorkflow` uses the webhook amount        | `.../@medusajs/core-flows/dist/payment/workflows/process-payment.js:94-105, 180-190`                                        |
| Webhook route preserves raw body, sends early 200       | `.../@medusajs/medusa/dist/api/hooks/payment/[provider]/route.js:11-29`; `.../api/hooks/middlewares.js:4-10`                |
| Subscriber ignores `FAILED`                             | `.../@medusajs/medusa/dist/subscribers/payment-webhook.js:19-34`                                                            |
| Zoho webhook format                                     | Zoho “Verifying Webhooks” docs, fetched 2026-10-23                                                                          |
| Zoho widget signature format                            | Zoho “Signature Verification” docs, fetched 2026-10-23                                                                      |
| Zoho hosted return format                               | Zoho “Integrating Hosted Checkout” docs, fetched 2026-10-23                                                                 |
| Local SEC-01 reproduction                               | Read-only `node --input-type=module` probe against built `dist/` with a fake client; output recorded above                  |

## Appendix B — files reviewed

- `AGENTS.md`, `package.json`, `tsup.config.ts`, `vitest.config.ts`, `.env.example`,
  `.gitignore`, `SECURITY.md`, `README.md`
- `src/index.ts`, `src/types.ts`, `src/core/*`, `src/client/index.ts`,
  `src/server/index.ts`, `src/providers/zoho/*`
- `scripts/get-refresh-token.mjs`, `scripts/verify-package.mjs`,
  `scripts/patch-cjs-provider.mjs`, `scripts/smoke.mjs`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `docs/decisions/ADR-0001` through `ADR-0007`, `docs/webhooks.md`, `docs/signatures.md`,
  `docs/configuration.md`, `docs/storefront-widget.md`, `docs/storefront-hosted.md`,
  `docs/testing.md`, `docs/PROGRESS.md`, `docs/research/zoho-payments.md`
- `test/**` (all 17 test files and fixtures)
- Installed Medusa 2.22.0 payment, core-flows, and webhook sources referenced above

**Status:** Findings delivered; no source, test, package, script, or existing docs were
modified. No commit was created. The only new file is this review.

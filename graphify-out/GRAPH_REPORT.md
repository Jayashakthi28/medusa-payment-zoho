# Graph Report - medusa-zoho-payments  (2026-10-23)

## Corpus Check
- 87 files · ~115,833 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .example 1)

## Summary
- 1275 nodes · 2532 edges · 67 communities (62 shown, 5 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 264 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `695a3fc5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- service.ts
- zoho-client.ts
- ZohoValidationError
- widget.test.ts
- http.test.ts
- oauth.test.ts
- Packaging & Live Scripts
- Zoho Client Tests
- providers.ts
- Storefront Examples
- OAuth Setup Script
- TypeScript Config
- Package Manifest
- Provider Options
- Dev Dependencies
- Package Exports
- Logging Adapter
- NPM Scripts
- Prettier Config
- ESLint Config
- Peer Dependencies
- Repository Metadata
- Bug Tracker
- Node Engine
- Publish Config
- Build Config
- traceability.md
- 3. Findings
- Test-quality review — medusa-payment-zoho
- Troubleshooting
- src/index.ts
- npm and Medusa integrations listing copy
- http.ts
- Publishing `medusa-payment-zoho`
- client/index.ts
- .initiatePayment
- Zoho Payments API research
- Signature verification
- Decision
- medusa-payment-zoho
- Architecture
- Configuration
- .authorizePayment
- Testing and verification
- Compatibility and known limitations
- ADR-0001: Package identity and public surface
- payWithZohoCheckout
- .capturePayment
- ADR-0006: OAuth token lifecycle and retry policy
- ZohoUnsupportedOperationError
- Storefront: embedded Checkout Widget
- Webhooks
- .requestAccessToken
- Medusa v2 payment provider research
- 2. Findings
- Contributing
- ZohoAccessTokenProvider
- Community Medusa payment modules — review notes
- Security policy
- AGENTS.md — working agreement for `medusa-payment-zoho`
- References
- Examples
- session-data.ts
- [1.0.0] - 2026-10-23
- ssr.test.ts
- .refundPayment
- Storefront: hosted checkout

## God Nodes (most connected - your core abstractions)
1. `ZohoValidationError` - 52 edges
2. `ZohoPaymentProviderService` - 33 edges
3. `ZohoConfigurationError` - 31 edges
4. `ZohoPaymentLogger` - 27 edges
5. `payWithZohoCheckout()` - 24 edges
6. `compilerOptions` - 23 edges
7. `ZohoApiError` - 21 edges
8. `ZohoPaymentsClient` - 21 edges
9. `2. Findings` - 21 edges
10. `vitest` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Mobile and framework notes` --references--> `payWithZohoCheckout()`  [INFERRED]
  examples/README.md → src/client/index.ts
- `Storefront quickstart: embedded widget` --references--> `payWithZohoCheckout()`  [INFERRED]
  README.md → src/client/index.ts
- `Symptoms` --references--> `redirectToZohoHostedCheckout()`  [INFERRED]
  docs/troubleshooting.md → src/client/index.ts
- `COR-19 — Low — “ISO-4217 validation” is only a three-letter regex` --references--> `normalizeCurrencyCode()`  [INFERRED]
  docs/reviews/correctness-review.md → src/core/amount.ts
- `COR-07 — High (needs live verification) — Session and refund `amount` are sent as JSON strings, while Zoho's schema declares numbers` --references--> `formatAmountForZoho()`  [INFERRED]
  docs/reviews/correctness-review.md → src/core/amount.ts

## Import Cycles
- None detected.

## Communities (67 total, 5 thin omitted)

### Community 0 - "service.ts"
Cohesion: 0.18
Nodes (10): isCapturedPaymentStatus(), isFailedPaymentStatus(), isTerminalSessionStatus(), mapZohoPaymentStatus(), mapZohoSessionStatus(), clearedPaymentState(), ComparableAmount, readIdempotencyKey() (+2 more)

### Community 1 - "zoho-client.ts"
Cohesion: 0.17
Nodes (14): isJsonRecord(), JsonRecord, requireRecord(), requireString(), toZohoNumber(), ZohoPaymentsClient, CreateZohoPaymentSessionInput, CreateZohoRefundInput (+6 more)

### Community 2 - "ZohoValidationError"
Cohesion: 0.07
Nodes (55): API shape, COR-02 — Critical — Hosted-checkout return signature omits `mandate_id`, COR-04 — High — The webhook verifies `rawData` but maps a separately supplied payload object, COR-11 — Medium — A positive amount below the currency precision formats to `"0.00"` after the positivity check, 4. Minor correctness and hardening notes, SEC-02 — High — Webhook signature covers `rawData`, but the event is read from separately supplied `data`, SEC-06 — Medium — Amount formatting silently rounds and can produce `"0"`, H2. Webhook amounts, currencies, and statuses are not validated (+47 more)

### Community 3 - "widget.test.ts"
Cohesion: 0.11
Nodes (9): resetZohoCheckoutCacheForTests(), ZOHO_WIDGET_SCRIPT_URL, WidgetConstructor, WidgetInstance, WidgetRequest, WidgetResponse, WidgetStub, WidgetStubOptions (+1 more)

### Community 4 - "http.test.ts"
Cohesion: 0.09
Nodes (11): BASE_TIME, createHarness(), createLogger(), FakeClock, FetchHandler, HarnessOverrides, LogRecord, RecordedCall (+3 more)

### Community 5 - "oauth.test.ts"
Cohesion: 0.12
Nodes (10): BASE_TIME, FakeClock, FetchHandler, jsonResponse(), LogRecord, RecordedCall, recordFetch(), sequenceFetch() (+2 more)

### Community 6 - "Packaging & Live Scripts"
Cohesion: 0.08
Nodes (34): code, lines, providerFile, repositoryRoot, source, sourceMapLine, formatExpiry(), loadServerEntry() (+26 more)

### Community 7 - "Zoho Client Tests"
Cohesion: 0.09
Nodes (25): apiCalls(), BASE_SESSION_INPUT, BASE_TIME, ClientOverrides, createClientHarness(), createLogger(), createRouter(), FakeClock (+17 more)

### Community 8 - "providers.ts"
Cohesion: 0.12
Nodes (26): 4. Fixtures and the fake client, @medusajs/framework, vitest, ZohoWebhookEvent, ZohoWebhookHandlerOptions, baseOptions(), buildPaymentEvent(), captureMedusaError() (+18 more)

### Community 9 - "Storefront Examples"
Cohesion: 0.10
Nodes (19): CheckoutFailurePage(), CheckoutFailurePageProps, FAILURE_COPY, FailureCopy, FALLBACK_COPY, firstValue(), metadata, CheckoutSuccessPage() (+11 more)

### Community 10 - "OAuth Setup Script"
Cohesion: 0.13
Nodes (27): asLocalCallback(), buildAuthorizationUrl(), errorMessage(), escapeHtml(), exchangeAuthorizationCode(), knownSecrets, listen(), listenErrorMessage() (+19 more)

### Community 11 - "TypeScript Config"
Cohesion: 0.08
Nodes (25): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+17 more)

### Community 12 - "Package Manifest"
Cohesion: 0.08
Nodes (24): author, description, files, homepage, keywords, license, main, module (+16 more)

### Community 13 - "Provider Options"
Cohesion: 0.09
Nodes (35): 1. Webhook, 2. Widget response, 3. Hosted-checkout return URL, ADR-0007: Signature verification mechanics, Alternatives considered, Consequences, Context, Decision (+27 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.11
Nodes (18): devDependencies, @arethetypeswrong/cli, eslint, eslint-config-prettier, @eslint/js, fast-check, jsdom, @medusajs/framework (+10 more)

### Community 15 - "Package Exports"
Cohesion: 0.21
Nodes (15): import, require, exports, ./client, ./package.json, ./providers/zoho, ./server, default (+7 more)

### Community 16 - "Logging Adapter"
Cohesion: 0.22
Nodes (6): getMethod(), isRecord(), NOOP_LOGGER, toPaymentLogger(), UnknownRecord, BoundLogger

### Community 17 - "NPM Scripts"
Cohesion: 0.14
Nodes (14): scripts, build, check, dev, format, format:check, lint, pack:check (+6 more)

### Community 18 - "Prettier Config"
Cohesion: 0.22
Nodes (8): arrowParens, endOfLine, printWidth, semi, singleQuote, tabWidth, trailingComma, useTabs

### Community 19 - "ESLint Config"
Cohesion: 0.50
Nodes (3): eslint-config-prettier, @eslint/js, typescript-eslint

### Community 20 - "Peer Dependencies"
Cohesion: 0.50
Nodes (4): peerDependencies, @medusajs/framework, @medusajs/medusa, @medusajs/types

### Community 21 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 26 - "traceability.md"
Cohesion: 0.08
Nodes (32): Attribution, Code of Conduct, Enforcement, Enforcement responsibilities, Our pledge, Our standards, Scope, ADR-0005: Capture, cancel, and refund semantics (+24 more)

### Community 27 - "3. Findings"
Cohesion: 0.05
Nodes (37): 1. Executive summary, 2. Threat model and assumptions, 3. Findings, 5. Verified safe, 6. Needs live verification, 7. Test coverage observations, 8. Prioritized remediation checklist, Amounts (except SEC-06/SEC-07) (+29 more)

### Community 28 - "Test-quality review — medusa-payment-zoho"
Cohesion: 0.05
Nodes (37): 1. Executive summary, 4. Needs live Zoho verification, 5. Test gaps, 6. Prioritized checklist, 7. Key references, Correctness review — `medusa-payment-zoho`, Findings at a glance, P0 — block the 1.0.0 release (+29 more)

### Community 29 - "Troubleshooting"
Cohesion: 0.05
Nodes (44): 10. Refund failures, 11. Provider not visible in Admin, 12. Region and domain problems, 13. Payment succeeded but no order, 14. Still stuck?, 15. Related documentation, 1. First checks, 2. Authentication and scopes (+36 more)

### Community 30 - "src/index.ts"
Cohesion: 0.18
Nodes (22): ZohoCheckoutSession, ZohoHttpClientOptions, AccessTokenProvider, ZohoAccessTokenProviderOptions, ZohoPaymentsClientOptions, ResolvedZohoPaymentOptions, ZohoHostedCheckoutOptions, ZohoPaymentOptions (+14 more)

### Community 32 - "npm and Medusa integrations listing copy"
Cohesion: 0.09
Nodes (22): 10. Submission checklist for `medusajs.com/integrations`, 11. Listing copy review notes, 12. References, 1. Listing metadata, 2. Suggested listing title and short description, 3. Suggested long description, 4. Suggested feature bullets for the listing body, 5. Installation and configuration (+14 more)

### Community 33 - "http.ts"
Cohesion: 0.12
Nodes (18): M1. HTTP 2xx response with a non-zero Zoho `code` is untested, Prioritized tests to add, ZohoApiError, ensureTrailingSlash(), getPayloadString(), getRetryAfterMilliseconds(), isJsonRecord(), isNetworkError() (+10 more)

### Community 34 - "Publishing `medusa-payment-zoho`"
Cohesion: 0.10
Nodes (21): 10. Rollback and deprecation, 11. Release checklist summary, 12. References, 1. Release model, 2. Preflight checklist, 3. Versioning, 4. CI gate, 5. npm provenance (+13 more)

### Community 35 - "client/index.ts"
Cohesion: 0.17
Nodes (15): buildAddress(), buildWidgetOptions(), getErrorField(), instanceCache, isRecord(), parseCheckoutSession(), readNumber(), readString() (+7 more)

### Community 36 - ".initiatePayment"
Cohesion: 0.13
Nodes (21): ADR-0003: Payment-session lifecycle and state mapping, Alternatives considered, Authorization and status mapping, Consequences, Context, Creation, reuse, and cart updates, Decision, Expiry normalization (+13 more)

### Community 37 - "Zoho Payments API research"
Cohesion: 0.12
Nodes (17): 11. Open questions to verify in a sandbox, 12. References, 1. What Zoho Payments is, 2. Authentication and scopes, 3. API surface used by the provider, 4. Payment sessions, 5. Payments and capture, 6. Checkout modes (+9 more)

### Community 38 - "Signature verification"
Cohesion: 0.12
Nodes (17): 1. Webhook signature, 2. Widget response signature, 3. Hosted-checkout return signature, 4. API reference, 5. Manual verification with OpenSSL, 6. Common mistakes, 7. Key handling and rotation, 8. Related documentation (+9 more)

### Community 39 - "Decision"
Cohesion: 0.12
Nodes (16): Acknowledged-but-rejected events, ADR-0004: Webhook authorization and event mapping, Alternatives considered, Consequences, Context, Decision, Duplicates and side effects, Map events to Medusa actions (+8 more)

### Community 40 - "medusa-payment-zoho"
Cohesion: 0.12
Nodes (16): Backend configuration, Configuration options, Documentation, Enable the provider in Medusa Admin, Features, Installation, License, medusa-payment-zoho (+8 more)

### Community 41 - "Architecture"
Cohesion: 0.13
Nodes (15): 10. Failure and retry behaviour, 11. Observability, 12. Deployment notes, 13. Testing map, 14. References, 1. Overview, 2. Component map, 3. Data model and the session bridge (+7 more)

### Community 42 - "Configuration"
Cohesion: 0.13
Nodes (15): 1. Minimal configuration, 2. Environment variables, 3.1 Credentials, 3.2 Region and checkout, 3.3 Signing and webhook mode, 3.4 Presentation and metadata, 3.5 Networking and polling, 3.6 Advanced overrides (+7 more)

### Community 43 - ".authorizePayment"
Cohesion: 0.15
Nodes (13): ADR-0002: Checkout architecture — widget first, hosted checkout supported, Alternatives considered, Both modes, one server model, Consequences, Context, Decision, Embedded widget is the primary path, Hosted checkout is an explicit opt-in (+5 more)

### Community 44 - "Testing and verification"
Cohesion: 0.14
Nodes (14): 10. Known gaps, 11. References, 1. Commands, 3. Test matrix by module, 5. Running focused tests, 6. Zoho smoke test (manual, no money movement), 7. Webhook HMAC testing, 8. CI (+6 more)

### Community 45 - "Compatibility and known limitations"
Cohesion: 0.15
Nodes (13): 1. Medusa compatibility, 2. Runtime compatibility, 3. Zoho compatibility, 4. Checkout compatibility, 5. Medusa feature coverage, 6. Known limitations, 7. Upgrade policy, 8. Verification checklist (+5 more)

### Community 46 - "ADR-0001: Package identity and public surface"
Cohesion: 0.15
Nodes (13): ADR-0001: Package identity and public surface, Alternatives considered, Consequences, Context, Decision, Identity and communication rules, Negative, Package and provider names (+5 more)

### Community 47 - "payWithZohoCheckout"
Cohesion: 0.23
Nodes (11): COR-17 — Low — Browser helper timeout and error mapping do not match the documented surface, SEC-09 — Medium — Arbitrary `scriptUrl` allows script injection in the storefront, M2. The widget request has no timeout or abort, despite the documented option, closeWidget(), findExistingScript(), getWidgetInstance(), loadZohoPaymentsScript(), payWithZohoCheckout() (+3 more)

### Community 48 - ".capturePayment"
Cohesion: 0.22
Nodes (11): Context, 2. Provider contract, 6. Auto-capture and the Medusa lifecycle, 10. Implications for this package, 3. Verified correct, COR-03 — High — `created` session status maps to `PENDING_AUTHORIZATION`, allowing an unpaid order, COR-05 — High — Zoho amount and currency are never reconciled before declaring capture, SEC-07 — Medium — Zoho amount and currency are not reconciled before `CAPTURED`/`SUCCESSFUL` (+3 more)

### Community 49 - "ADR-0006: OAuth token lifecycle and retry policy"
Cohesion: 0.17
Nodes (12): ADR-0006: OAuth token lifecycle and retry policy, Alternatives considered, Consequences, Context, Decision, Negative, OAuth refresh retries, Payments API retries (+4 more)

### Community 50 - "ZohoUnsupportedOperationError"
Cohesion: 0.20
Nodes (11): Cancel is honest about the missing API, Capture is verification, not an action, Decision, Operation matrix, Retry rules for state-changing calls, SEC-11 — Low — Hosted redirect trusts `checkoutUrl`; docs do not bind signed fields to the cart, 2. Start the redirect, 9. SSR and framework notes (+3 more)

### Community 51 - "Storefront: embedded Checkout Widget"
Cohesion: 0.15
Nodes (13): 10. Testing checklist, 11. Related documentation, 1. How the flow works, 2. Install and initialise the SDK, 3. Full Next.js checkout component, 4. The helper result, 5. Session expiry and refresh, 6. Error handling and completion (+5 more)

### Community 52 - "Webhooks"
Cohesion: 0.17
Nodes (12): 10. Security checklist, 11. Related documentation, 1. Register the webhook in Zoho, 2. Event envelope, 3. Signature verification, 4. Event mapping, 5. `payment.failed` is per attempt, 6. Duplicate delivery and ordering (+4 more)

### Community 53 - ".requestAccessToken"
Cohesion: 0.19
Nodes (14): ZohoAuthenticationError, asNonEmptyString(), asPositiveNumber(), CachedAccessToken, computeUsableLifetime(), ensureTrailingSlash(), errorFromTokenResponse(), getRetryAfterMilliseconds() (+6 more)

### Community 54 - "Medusa v2 payment provider research"
Cohesion: 0.18
Nodes (11): 1. Division of responsibility, 3. The `data` contract and `session_id`, 4. Statuses and actions, 5. Webhook route behaviour, 7. Version and runtime notes, 8. Package-shape implications, 9. References, `data.session_id` (+3 more)

### Community 55 - "2. Findings"
Cohesion: 0.17
Nodes (12): 2. Findings, COR-06 — High — Declared Medusa support starts at 2.16.0, but the code uses 2.17.2-only enums, COR-07 — High (needs live verification) — Session and refund `amount` are sent as JSON strings, while Zoho's schema declares numbers, COR-08 — Medium — A late `payment.failed` reconciled to success uses the failed attempt's amount, COR-09 — Medium — `payment.failed` → `FAILED` is ignored by Medusa 2.22, contrary to the docs, COR-10 — Medium — Canceled refunds are treated as success; the replay guard ignores amount and status, COR-12 — Medium — A payment from a superseded Zoho session still maps to the current Medusa session, COR-13 — Medium — Account and live-mode checks fail open when fields are absent (+4 more)

### Community 56 - "Contributing"
Cohesion: 0.20
Nodes (10): 10. Questions, 1. Prerequisites, 2. Setup, 3. Commands, 5. Public API changes require an ADR, 6. Code style, 7. Commit convention, 8. Pull request checklist (+2 more)

### Community 57 - "ZohoAccessTokenProvider"
Cohesion: 0.21
Nodes (5): 4. Coverage is part of the feature, Configuration knobs, 2. Coverage policy, ZohoAccessTokenProvider, createProvider()

### Community 58 - "Community Medusa payment modules — review notes"
Cohesion: 0.20
Nodes (10): 1. Why these references, 2. Official Stripe provider — the quality bar, 3. Community Razorpay providers — patterns and anti-patterns, 4. What merchants expect from the README, 5. Comparison summary, 6. Review limitations, 7. References, Anti-patterns deliberately rejected (+2 more)

### Community 60 - "Security policy"
Cohesion: 0.20
Nodes (10): Application security responsibilities, Dependency and supply-chain security, Non-affiliation, PCI DSS scope, Reporting a vulnerability, Safe harbor, Secret handling, Security policy (+2 more)

### Community 61 - "AGENTS.md — working agreement for `medusa-payment-zoho`"
Cohesion: 0.22
Nodes (9): AGENTS.md — working agreement for `medusa-payment-zoho`, Architecture, Code style, Commands, Commit convention, Non-negotiable invariants, Payment-provider gotchas, Rate-limit and failure policy for delegated work (+1 more)

### Community 62 - "References"
Cohesion: 0.22
Nodes (9): 1. Medusa v2, 2. Zoho Payments, 3. Standards, 4. Community patterns, 5. Project documents, API, Developer guides, References (+1 more)

### Community 63 - "Examples"
Cohesion: 0.22
Nodes (9): Examples, Files, Hosted checkout alternative, Mobile and framework notes, Prerequisites, State handling in the example button, The embedded widget flow, Webhook endpoint (+1 more)

### Community 64 - "session-data.ts"
Cohesion: 0.16
Nodes (22): COR-15 — Low — Metadata cap arithmetic, reserved `zoho_session_id`, and stale mode fields are inconsistent, H3. `payment.failed` tests use a session bridge Zoho webhooks do not provide, buildZohoMetadataEntries(), buildZohoSessionData(), extractMedusaSessionId(), extractZohoSessionId(), findZohoMetadataValue(), isRecord() (+14 more)

### Community 65 - "[1.0.0] - 2026-10-23"
Cohesion: 0.17
Nodes (11): [1.0.0] - 2026-10-23, [1.0.1] - 2026-10-23, [1.0.2] - 2026-10-23, Added, Added, Changelog, Documentation, Documentation (+3 more)

### Community 67 - ".refundPayment"
Cohesion: 0.21
Nodes (9): Refunds are explicit, partial-capable, and replay-aware, Resolved findings, H1. The webhook verifies one body but maps a different object, H4. Positive amounts below the currency precision format to zero, H5. A new session inherits stale payment and refund state from `input.data`, H7. A payment from a superseded session is still mapped to the current Medusa session, High-severity findings, ZohoPaymentStateError (+1 more)

### Community 70 - "Storefront: hosted checkout"
Cohesion: 0.20
Nodes (10): 1. Configure the provider, 3. Return URL parameters, 4. Success route, 5. Failure route, 6. Webhook-first completion, 7. Session expiry and retries, 8. Security checklist, 9. Related documentation (+2 more)

## Knowledge Gaps
- **10 isolated node(s):** `@medusajs/medusa`, `@arethetypeswrong/cli`, `@types/node`, `@vitest/coverage-v8`, `eslint` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 609 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `providers.ts` to `service.ts`, `session-data.ts`, `ZohoValidationError`, `ssr.test.ts`, `widget.test.ts`, `http.test.ts`, `oauth.test.ts`, `Zoho Client Tests`, `Package Manifest`, `Provider Options`, `Logging Adapter`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `ZohoValidationError` (e.g. with `COR-04 — High — The webhook verifies `rawData` but maps a separately supplied payload object` and `COR-11 — Medium — A positive amount below the currency precision formats to `"0.00"` after the positivity check`) actually correct?**
  _`ZohoValidationError` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@medusajs/medusa`, `@arethetypeswrong/cli`, `@types/node` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ZohoValidationError` be split into smaller, more focused modules?**
  _Cohesion score 0.07412008281573498 - nodes in this community are weakly interconnected._
- **Why does `ZohoValidationError` connect `ZohoValidationError` to `service.ts`, `zoho-client.ts`, `session-data.ts`, `client/index.ts`, `.refundPayment`, `ssr.test.ts`, `widget.test.ts`, `Zoho Client Tests`, `providers.ts`, `Provider Options`, `payWithZohoCheckout`, `.capturePayment`, `ZohoUnsupportedOperationError`, `Storefront: embedded Checkout Widget`, `3. Findings`, `src/index.ts`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ZohoConfigurationError` (e.g. with `6. Validation rules` and `One primitive, three message builders`) actually correct?**
  _`ZohoConfigurationError` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `widget.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
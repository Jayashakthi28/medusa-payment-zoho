# Graph Report - medusa-zoho-payments  (2026-10-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 676 nodes · 1584 edges · 26 communities (22 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5f4fb28c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Payment Provider Core
- Provider Contracts
- Core Exports & Errors
- Browser Checkout Helper
- HTTP Transport
- OAuth Token Provider
- Packaging & Live Scripts
- Zoho Client Tests
- Provider Test Fixtures
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

## God Nodes (most connected - your core abstractions)
1. `ZohoValidationError` - 44 edges
2. `ZohoPaymentProviderService` - 33 edges
3. `ZohoConfigurationError` - 27 edges
4. `ZohoPaymentLogger` - 26 edges
5. `compilerOptions` - 23 edges
6. `vitest` - 19 edges
7. `resolveZohoPaymentOptions()` - 18 edges
8. `ZohoPaymentsClient` - 16 edges
9. `ZohoApiError` - 16 edges
10. `handleZohoWebhook()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `createProvider()` --calls--> `ZohoAccessTokenProvider`  [EXTRACTED]
  test/core/oauth.test.ts → src/core/oauth.ts
- `createHarness()` --calls--> `ZohoPaymentProviderService`  [EXTRACTED]
  test/fixtures/providers.ts → src/providers/zoho/service.ts
- `Harness` --references--> `ZohoPaymentProviderService`  [EXTRACTED]
  test/fixtures/providers.ts → src/providers/zoho/service.ts
- `createClientHarness()` --calls--> `ZohoPaymentsClient`  [EXTRACTED]
  test/core/zoho-client.test.ts → src/core/zoho-client.ts
- `Harness` --references--> `ZohoPaymentsClient`  [EXTRACTED]
  test/core/zoho-client.test.ts → src/core/zoho-client.ts

## Import Cycles
- None detected.

## Communities (26 total, 4 thin omitted)

### Community 0 - "Payment Provider Core"
Cohesion: 0.07
Nodes (43): @medusajs/framework, isCapturedPaymentStatus(), isFailedPaymentStatus(), isTerminalSessionStatus(), mapZohoPaymentStatus(), mapZohoSessionStatus(), clearedPaymentState(), mergeSessionData() (+35 more)

### Community 1 - "Provider Contracts"
Cohesion: 0.08
Nodes (42): ZohoCheckoutSession, ZohoWidgetConfig, isJsonRecord(), JsonRecord, requireRecord(), requireString(), toZohoNumber(), ZohoPaymentsClient (+34 more)

### Community 2 - "Core Exports & Errors"
Cohesion: 0.10
Nodes (40): Decimal, formatAmountForZoho(), formatAmountStringForZoho(), getCurrencyFractionDigits(), getCurrencySymbol(), isPositiveAmount(), normalizeCurrencyCode(), toFiniteDecimal() (+32 more)

### Community 3 - "Browser Checkout Helper"
Cohesion: 0.07
Nodes (36): buildAddress(), buildWidgetOptions(), closeWidget(), findExistingScript(), getBrowserWindow(), getErrorField(), getWidgetInstance(), getZohoCheckoutMode() (+28 more)

### Community 4 - "HTTP Transport"
Cohesion: 0.06
Nodes (28): ensureTrailingSlash(), getPayloadString(), getRetryAfterMilliseconds(), isJsonRecord(), isNetworkError(), isRetryableStatus(), isSuccessPayload(), JsonRecord (+20 more)

### Community 5 - "OAuth Token Provider"
Cohesion: 0.07
Nodes (26): asNonEmptyString(), asPositiveNumber(), CachedAccessToken, computeUsableLifetime(), ensureTrailingSlash(), errorFromTokenResponse(), getRetryAfterMilliseconds(), isNetworkError() (+18 more)

### Community 6 - "Packaging & Live Scripts"
Cohesion: 0.08
Nodes (33): code, lines, providerFile, repositoryRoot, source, sourceMapLine, formatExpiry(), loadServerEntry() (+25 more)

### Community 7 - "Zoho Client Tests"
Cohesion: 0.09
Nodes (24): apiCalls(), BASE_SESSION_INPUT, BASE_TIME, ClientOverrides, createClientHarness(), createLogger(), createRouter(), FakeClock (+16 more)

### Community 8 - "Provider Test Fixtures"
Cohesion: 0.13
Nodes (19): vitest, buildZohoSessionData(), ZohoWebhookHandlerOptions, baseOptions(), buildPaymentEvent(), captureMedusaError(), createClient(), createHarness() (+11 more)

### Community 9 - "Storefront Examples"
Cohesion: 0.10
Nodes (19): CheckoutFailurePage(), CheckoutFailurePageProps, FAILURE_COPY, FailureCopy, FALLBACK_COPY, firstValue(), metadata, CheckoutSuccessPage() (+11 more)

### Community 10 - "OAuth Setup Script"
Cohesion: 0.16
Nodes (23): asLocalCallback(), buildAuthorizationUrl(), errorMessage(), escapeHtml(), exchangeAuthorizationCode(), knownSecrets, listen(), listenErrorMessage() (+15 more)

### Community 11 - "TypeScript Config"
Cohesion: 0.08
Nodes (25): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+17 more)

### Community 12 - "Package Manifest"
Cohesion: 0.08
Nodes (24): author, description, files, homepage, keywords, license, main, module (+16 more)

### Community 13 - "Provider Options"
Cohesion: 0.18
Nodes (20): ZohoConfigurationError, booleanOption(), INDIA_REGION_CONFIG, integerOption(), optionalString(), REGION_CONFIGS, requiredString(), RESERVED_METADATA_KEYS (+12 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.11
Nodes (18): devDependencies, @arethetypeswrong/cli, eslint, eslint-config-prettier, @eslint/js, fast-check, jsdom, @medusajs/framework (+10 more)

### Community 15 - "Package Exports"
Cohesion: 0.21
Nodes (15): import, require, exports, ./client, ./package.json, ./providers/zoho, ./server, default (+7 more)

### Community 16 - "Logging Adapter"
Cohesion: 0.20
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

## Knowledge Gaps
- **10 isolated node(s):** `@arethetypeswrong/cli`, `eslint`, `fast-check`, `jsdom`, `@medusajs/medusa` (+5 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 260 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Provider Test Fixtures` to `Payment Provider Core`, `Core Exports & Errors`, `Browser Checkout Helper`, `HTTP Transport`, `OAuth Token Provider`, `Zoho Client Tests`, `Package Manifest`, `Provider Options`, `Logging Adapter`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **What connects `@arethetypeswrong/cli`, `eslint`, `fast-check` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Payment Provider Core` be split into smaller, more focused modules?**
  _Cohesion score 0.06631578947368422 - nodes in this community are weakly interconnected._
- **Why does `@medusajs/framework` connect `Payment Provider Core` to `Provider Test Fixtures`, `Provider Contracts`, `Core Exports & Errors`, `Package Manifest`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Should `Provider Contracts` be split into smaller, more focused modules?**
  _Cohesion score 0.08249603384452671 - nodes in this community are weakly interconnected._
- **Why does `@medusajs/types` connect `Storefront Examples` to `Package Manifest`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Should `Core Exports & Errors` be split into smaller, more focused modules?**
  _Cohesion score 0.09800362976406533 - nodes in this community are weakly interconnected._
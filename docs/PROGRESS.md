# Build progress

This file is the handoff record for the project. Update it before every commit.

## Status

- Current wave: **complete — v1.0.2 sandbox release**
- Overall: implementation, tests, docs, packaging, graph and audit complete
- Last updated: 2026-10-23
- Tests: **762 passing**, 100% lines/branches/functions/statements
- Coverage: 1039 statements, 993 branches, 194 functions, 1037 lines

## Decisions locked

- Package: `medusa-payment-zoho`
- Default region: **India**
- Checkout: embedded widget primary, hosted checkout supported
- Medusa target: `>=2.17.2 <3`; developed against `2.22.0`
- 100% coverage required
- No push or npm publish until the maintainer explicitly requests it

## Waves

| Wave | Scope                                                            | Status      |
| ---- | ---------------------------------------------------------------- | ----------- |
| 0    | Scaffold, shared types, tooling, ADR-0001/0002                   | complete    |
| 1    | Core transport/OAuth/client; browser helper; research; packaging | complete    |
| 2    | Provider tests, webhook handling, fixtures, guides               | complete    |
| 3    | Coverage hardening, security review, package verification        | complete    |
| 4    | Full gate, graphify, final audit, tag                            | in progress |

## What is complete

- Core: OAuth refresh/caching/redaction, HTTP retries/timeouts, Zoho client, amount
  precision, status mapping, three signature verifiers, typed errors, logger adapter.
- Provider: options validation, session lifecycle, widget and hosted checkout,
  authorization polling, webhook reconciliation, capture/cancel/refund semantics.
- Browser: framework-agnostic widget loader/helper and hosted redirect.
- Packaging: ESM/CJS/declarations, CJS provider interop, packed-consumer import test,
  publint and attw green.
- Docs: README, configuration, storefront guides, webhooks, signatures, architecture,
  compatibility, testing, traceability, troubleshooting, publishing, ADRs, research,
  independent review records and remediation matrix.
- CI: Node 22/24 matrix, 100% coverage gate, pack/install verification, release workflow.
- Scripts: OAuth refresh-token helper, live smoke test, package verifier.
- Graphify: code graph and curated community labels committed under `graphify-out/`.

## Release state

- `pnpm check` passes from a clean tree: lint, format, typecheck, 755 tests at 100%
  coverage, build, pack check, and packed-consumer import verification.
- `1.0.0` is published on npm with provenance.
- `1.0.1` and `1.0.2` are published on npm with provenance.
- `1.0.2` release workflow is green; sandbox widget E2E passed on 2026-10-23.
- Sandbox OAuth, session smoke, widget payment, signature verification, and provider
  authorization all passed against Zoho India Sandbox on 2026-10-23.
- Annotated tag `v1.0.2` points at the sandbox-support release.
- Graphify graph, report, curated labels, and manifest are committed.
- Nothing has been pushed and no npm package has been published. Those are deliberate
  maintainer actions, documented in `docs/publishing.md`.

## Remaining maintainer actions

1. Confirm the `v1.0.2` release workflow is green after pushing the tag.
2. Configure npm Trusted Publishing for `Jayashakthi28/medusa-payment-zoho` and
   `release.yml`, then remove `NPM_TOKEN` for future releases.
3. Deprecate the `0.0.0-stage` bootstrap version if it is not intentional.
4. Add refund balance/settlement to the sandbox account and verify refund settlement;
   then repeat with a small live transaction before live traffic.

## Commit log

- `b3d8ef6` — `chore: scaffold repository and tooling`
- `7fc23c4` — `feat: implement Zoho payment provider and storefront helper`
- `20d582e` — `docs: add integration guides, ADRs and audit records`
- `5f4fb28` — `chore: add CI, release and package verification workflows`
- `4fed70d` — `docs: add graphify map and finalize handoff`
- `051dc48` — `chore: refresh graphify graph and labels`
- `242cbca` — `chore: align repository metadata and harden npm release`

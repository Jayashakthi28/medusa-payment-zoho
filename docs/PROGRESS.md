# Build progress

This file is the handoff record for the project. Update it before every commit.

## Status

- Current wave: **1 — core and parallel modules**
- Overall: in progress
- Last updated: 2026-10-23
- Wave 0: complete (scaffold, contracts, typecheck, lint, build)

## Decisions locked

- Package: `medusa-payment-zoho`
- Default region: **India**
- Checkout: embedded widget primary, hosted checkout supported
- Medusa target: `>=2.16 <3`; developed against `2.22.0`
- 100% coverage required
- No push or npm publish until the maintainer explicitly requests it

## Waves

| Wave | Scope                                                            | Status      |
| ---- | ---------------------------------------------------------------- | ----------- |
| 0    | Scaffold, shared types, tooling, ADR-0001/0002                   | complete    |
| 1    | Core transport/OAuth/client; browser helper; research; packaging | pending     |
| 2    | Provider service, webhook handling, fixtures, guides             | pending     |
| 3    | Coverage hardening, security review, package verification        | pending     |
| 4    | Full gate, graphify, final audit, tag                            | pending     |

## Next task

Wave 1: core tests, OAuth/HTTP/Zoho client review, browser helper tests, research
documents, ADRs, packaging scripts and CI.

## Commit log

- `chore: scaffold repository and tooling` — pending

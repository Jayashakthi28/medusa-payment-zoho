# AGENTS.md — working agreement for `medusa-payment-zoho`

This file is the operating manual for any developer or coding agent working in this
repository. Read it before changing code.

## What this package is

A publishable Medusa v2 Payment Module Provider for **Zoho Payments**. It supports an
embedded Zoho Checkout Widget, Zoho Hosted Checkout, signed webhooks, authorization,
capture verification, full/partial refunds, and a framework-agnostic browser helper.

The default region is **India**. The US region is supported.

Not affiliated with Zoho Corporation or Medusa.

## Non-negotiable invariants

1. **Money is never guessed.** Every amount crossing a boundary is formatted with the
   correct ISO currency fraction digits. Never use floating-point arithmetic for money.
2. **Webhooks are never trusted without a valid signature.** Verify
   `X-Zoho-Webhook-Signature` over the exact raw body before reading the event.
3. **Secrets never leave the server and are never logged.** Client secret, refresh token,
   signing key, and access tokens are server-only. The Zoho API key is publishable by
   design and is only exposed for the widget.
4. **No silent failures.** Throw typed errors or return a documented status. Never catch
   and discard an error.
5. **The Medusa payment session ID is the bridge.** Zoho sessions carry
   `reference_number` and metadata containing the Medusa session ID so signed webhooks
   can resolve the correct payment session.
6. **Tests are part of the feature.** `pnpm test:coverage` must stay at 100% for lines,
   branches, functions, and statements. Any `v8 ignore` needs a written justification in
   `docs/testing.md`.
7. **Public API changes require an ADR.** Add a new file under `docs/decisions/`; do not
   rewrite history in an existing ADR.
8. **No secrets, `.env`, build output, coverage, or `node_modules` in git.**

## Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm pack:check
pnpm verify:package
pnpm check          # everything above in order
```

## Architecture

- `src/core/` — transport and pure domain utilities: OAuth, HTTP, Zoho client, amounts,
  statuses, signatures, errors.
- `src/providers/zoho/` — the Medusa `AbstractPaymentProvider` implementation, option
  validation, session lifecycle, payment operations, and webhook mapping.
- `src/client/` — browser-only helpers for the Zoho Checkout Widget and hosted checkout.
  This entry point must never import `node:*` or `@medusajs/*`.
- `src/server/` — server-only helpers for consumers (signature verification).
- `docs/` — user guides, ADRs, research notes, testing and publishing checklists.
- `docs/PROGRESS.md` — current state, next task, and commit log for a replacement
  developer.

## Code style

- Strict TypeScript. No `any`, no non-null assertions without a proven invariant.
- Prefer small, pure, named functions. Keep side effects at the edges.
- Internal names are descriptive camelCase. Zoho wire fields stay `snake_case` in DTOs.
- Use discriminated unions for results with more than one success shape.
- Validate untrusted input (storefront session data, webhook payloads) with type guards.
- Avoid deep nesting; return early. Avoid boolean flag parameters.
- Comments explain **why**, not **what**. Public APIs have TSDoc.

## Payment-provider gotchas

- Zoho auto-captures successful payments. There is no manual capture API.
- There is no cancel API for a pending Zoho payment session or a captured payment.
- A Zoho payment session expires after 15 minutes by default.
- `payment.failed` is emitted per attempt; do not fail the Medusa session until Zoho
  reports the session itself as terminal.
- Zoho has no idempotency-key header. Do not blindly retry refund POSTs after a network
  timeout; only retry explicit 429/5xx responses for state-changing calls.
- Medusa's payment webhook route returns HTTP 200 before the provider handler runs. The
  provider must reject bad signatures in `getWebhookActionAndData`.

## Rate-limit and failure policy for delegated work

When using subagents:

- Retry rate-limit, socket, timeout, and partial-agent failures with exponential backoff
  (30s, 60s, 120s, 300s; up to 6 attempts).
- Resume a partial agent by its session ID instead of restarting.
- Commit after every completed task/wave so work is never trapped in an agent context.
- Record progress in `docs/PROGRESS.md` before each commit.

## Commit convention

Conventional Commits, one logical change per commit:

```text
chore: scaffold repository and tooling
feat(core): add OAuth token provider
feat(provider): implement Zoho payment session lifecycle
test(provider): cover webhook authorization paths
docs: add storefront integration guide
```

Do not push or publish unless explicitly instructed. Tags are local until pushed.

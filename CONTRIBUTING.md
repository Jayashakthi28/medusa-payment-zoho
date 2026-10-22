# Contributing

Thanks for improving `medusa-payment-zoho`. This guide covers local setup, the quality
gate, and the project’s review rules.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
Security issues must follow [SECURITY.md](./SECURITY.md), not the public issue tracker.

## 1. Prerequisites

- **Node.js 22.22+** for Medusa 2.22 development (the package supports Node `>=20`,
  but the verified Medusa baseline requires 22.22).
- **pnpm 11.5.1** (the repository’s `packageManager`).
- Git.
- A Zoho Payments test account only if you are doing manual sandbox verification; unit
  tests do not need one.

## 2. Setup

```bash
git clone https://github.com/Jayashakthi28/medusa-zoho-payments.git
cd medusa-zoho-payments
pnpm install --frozen-lockfile
cp .env.example .env
```

Fill `.env` only with **test** credentials if you need them. Never commit `.env` or any
real secret. The unit suite uses fakes and does not call Zoho.

## 3. Commands

| Command               | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `pnpm lint`           | ESLint over source, tests, and config.                               |
| `pnpm format`         | Prettier write (all files). Use targeted paths while working.        |
| `pnpm format:check`   | Prettier check.                                                      |
| `pnpm typecheck`      | `tsc --noEmit`.                                                      |
| `pnpm test`           | Vitest once.                                                         |
| `pnpm test:watch`     | Vitest in watch mode.                                                |
| `pnpm test:coverage`  | Vitest with the 100% coverage gate.                                  |
| `pnpm build`          | Build ESM/CJS/types with tsup.                                       |
| `pnpm pack:check`     | `npm pack --dry-run`, `publint`, and `attw`.                         |
| `pnpm verify:package` | Verify the packed artifact and entry points.                         |
| `pnpm check`          | Full gate: lint, format, typecheck, coverage, build, package checks. |

Before opening a pull request, run:

```bash
pnpm check
```

CI runs the same gate. A change that lowers coverage or breaks packaging will not be
merged.

## 4. Coverage is part of the feature

- `pnpm test:coverage` must stay at **100%** for lines, branches, functions, and
  statements.
- New behavior needs tests for success, failure, and edge cases. Do not add tests that
  only execute lines without asserting behavior.
- A `v8 ignore` comment needs a written justification in `docs/testing.md`. Unexplained
  ignores are rejected.
- Prefer pure functions with injected clocks, sleeps, fetch, and clients. The provider
  already accepts injectable `now`, `sleep`, `fetch`, logger, and a fake
  `ZohoPaymentsClientLike`; use them instead of mocking globals.
- Webhook tests must exercise raw-body verification, account/mode checks, missing
  session bridges, and `payment.failed` reconciliation.
- Signature tests should include valid vectors, tampering, missing fields, wrong keys,
  and empty signatures.

## 5. Public API changes require an ADR

Add a new file under `docs/decisions/`, for example:

```text
docs/decisions/ADR-0008-saved-payment-methods.md
```

Do not rewrite an existing ADR to hide a change. An ADR is required for changes to:

- exported functions, types, or entry points;
- provider identifier or webhook route;
- session `data` fields or their meaning;
- supported Medusa/Node ranges;
- checkout modes, status mapping, capture/cancel/refund semantics;
- signature schemes or retry policy.

Bug fixes that restore documented behavior do not need an ADR, but the fix and its test
should reference the invariant it protects.

## 6. Code style

- Strict TypeScript. No `any`, no non-null assertions without a proven invariant.
- Small, pure, named functions; side effects at the edges.
- Internal names are descriptive `camelCase`. Zoho wire fields stay `snake_case` in
  DTOs.
- Use discriminated unions for results with more than one success shape.
- Validate untrusted input (storefront session data, webhook payloads) with type guards.
- Return early; avoid deep nesting and boolean flag parameters.
- Comments explain **why**, not **what**. Public APIs have TSDoc.
- Money is formatted with `BigNumber` and ISO fraction digits; never floating point.
- Never log secrets or raw request/response bodies.
- Keep the `client` entry free of `node:*` and `@medusajs/*` imports.
- Do not catch and discard errors. Use typed errors and map them deliberately.

Run Prettier on the files you touched while iterating:

```bash
pnpm exec prettier --write README.md src/providers/zoho/service.ts
```

`pnpm format` formats the whole repository; that is fine before a final commit if no
unrelated files are modified.

## 7. Commit convention

Use [Conventional Commits](https://www.conventionalcommits.org/), one logical change per
commit:

```text
chore: scaffold repository and tooling
feat(core): add OAuth token provider
feat(provider): implement Zoho payment session lifecycle
fix(webhook): reconcile failed attempts before failing a session
test(provider): cover hosted checkout return paths
docs: add storefront integration guide
```

Guidelines:

- Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`.
- Use a scope when it clarifies the area (`core`, `provider`, `webhook`, `client`,
  `docs`).
- Describe the behavior, not the file list.
- Reference an issue in the body when relevant.
- Do not commit generated `dist/`, `coverage/`, `node_modules/`, `.env`, or secrets.
- Update `docs/PROGRESS.md` before committing so the next developer knows the current
  state and next task.

Maintainers do not push or publish unless explicitly requested. Tags are local until the
release process says otherwise.

## 8. Pull request checklist

- [ ] The change is scoped and has a clear description.
- [ ] `pnpm check` passes locally.
- [ ] New behavior has tests; coverage remains 100%.
- [ ] Public API changes include an ADR.
- [ ] Documentation is updated for user-visible behavior.
- [ ] No secrets, `.env`, build output, coverage, or `node_modules` are included.
- [ ] No unrelated formatting churn.
- [ ] The webhook raw-body path and signature behavior are unchanged unless intended.
- [ ] The `client` entry still has no Node/Medusa imports.
- [ ] Money formatting and currency precision are unchanged unless intended.

## 9. Manual sandbox verification

For changes that affect Zoho calls or checkout, verify at least:

1. Widget payment succeeds in India and the US.
2. Hosted payment succeeds in India and the US.
3. Hosted return signature verifies; a tampered field fails.
4. A valid signed webhook completes a cart; an invalid signature is rejected and logged.
5. `payment.failed` followed by a successful retry does not fail the order.
6. Partial and full refunds reach a terminal status at Zoho.
7. A refund POST timeout does not produce a second refund.

Record the results in the pull request without including credentials, raw payloads, or
customer data.

## 10. Questions

Open a discussion or an issue for design questions. For anything that looks like a
vulnerability, use the private advisory link in [SECURITY.md](./SECURITY.md).

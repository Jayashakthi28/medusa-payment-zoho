# Publishing `medusa-payment-zoho`

This is the release runbook for maintainers. It covers the local gate, versioning,
provenance, GitHub releases, npm authentication, post-publish checks, and rollback.

> **Publishing is intentionally deferred.** Nothing in this repository pushes a branch,
> creates a remote tag, or calls `npm publish` on its own. The workflows are committed
> and ready, but a maintainer must explicitly push the tag. Do not push or publish
> unless the maintainer has asked for it.

## 1. Release model

- CI runs on every pull request and on pushes to `main`.
- `release.yml` runs **only** for tags matching `v*`. Branch pushes cannot publish.
- The release workflow runs `pnpm check` again before publishing, even if CI was green.
- The npm package is public: `medusa-payment-zoho`.
- The Git tag must equal `v` plus the `package.json` version. The workflow enforces this.

## 2. Preflight checklist

Run every item on the exact commit that will be tagged.

- [ ] `git status --short` is clean and the intended commit is checked out.
- [ ] `pnpm install --frozen-lockfile` succeeds with pnpm `11.5.1`.
- [ ] `pnpm lint` passes.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test:coverage` passes and reports 100% for lines, statements, functions, and
      branches. CI also checks `coverage/coverage-summary.json` independently.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm pack:check` passes (`npm pack --dry-run`, `publint`, and `attw`).
- [ ] `pnpm verify:package` passes. It installs the packed tarball in a temporary
      consumer and verifies the ESM/CJS client, the provider default export, the server
      verifiers, and the package version.
- [ ] `node --check scripts/verify-package.mjs` and the other scripts pass.
- [ ] CI is green on Node 22 **and** Node 24.
- [ ] `package.json` version matches the intended tag.
- [ ] `CHANGELOG.md` has an entry for the version (create it before the first release if
      it is still missing).
- [ ] `README.md` exists and documents installation, configuration, checkout, webhooks,
      and refunds. A missing README is a release blocker for a public package.
- [ ] `LICENSE` and `SECURITY.md` exist. `package.json#files` lists `README.md`,
      `CHANGELOG.md`, `LICENSE`, and `SECURITY.md`, so verify each one exists.
- [ ] `npm pack --dry-run` contains only `dist/`, documentation, and the files above.
      No `src/`, tests, coverage, lockfile, `.env`, credentials, or editor files.
- [ ] `npm view medusa-payment-zoho` shows the expected current version and dist-tags.
- [ ] No credentials or tokens are present in the working tree or Git history.
- [ ] The `NPM_TOKEN` repository secret is current, scoped to this package, and allowed
      to publish with 2FA enforced.

If any item fails, fix it and repeat the full gate. Do not publish from a dirty tree.

## 3. Versioning

Use semantic versioning:

| Change                                                        | Bump  |
| ------------------------------------------------------------- | ----- |
| Breaking provider options, exported API, or Medusa peer range | major |
| New checkout mode, endpoint support, or backward-safe option  | minor |
| Bug fix, documentation fix, dependency update                 | patch |

Public API changes require a new ADR under `docs/decisions/`; do not rewrite an
existing ADR. Keep `CHANGELOG.md` grouped by Added, Changed, Fixed, and Security.

Prepare the version without creating a local tag:

```bash
npm version patch --no-git-tag-version
# or: npm version minor --no-git-tag-version
# or: npm version major --no-git-tag-version
```

Then update `CHANGELOG.md`, run the full gate, and commit:

```bash
pnpm check
git add package.json CHANGELOG.md
git commit -m "chore(release): v1.0.1"
```

Create an annotated tag locally. Do **not** push it until the maintainer asks:

```bash
git tag -a v1.0.1 -m "medusa-payment-zoho v1.0.1"
```

Tags are local until pushed. Pushing the tag is the publish trigger.

### Pre-release versions

The workflow publishes every `v*` tag as `latest`. Do not push a tag such as
`v1.1.0-rc.1` unless the workflow is first changed to publish with `--tag next`.
Otherwise users would receive a release candidate as the default install.

## 4. CI gate

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm typecheck`
5. `pnpm test:coverage` (Vitest thresholds: 100% everywhere)
6. An independent 100% check over `coverage/coverage-summary.json`
7. `pnpm build`
8. `pnpm pack:check`
9. `pnpm verify:package`
10. Upload the coverage report as an artifact

The matrix is Node 22 and Node 24 with pnpm 11.5.1 and a cached pnpm store. Both matrix
legs must pass before tagging.

## 5. npm provenance

Provenance is a signed statement that links the published tarball to the workflow,
repository, commit, and build instructions. The release workflow enables it with:

```bash
npm publish --provenance --access public
```

Requirements:

- The repository is public and hosted on GitHub.
- The publishing job has `id-token: write` permission. `release.yml` grants it only to
  the tag-triggered publish job.
- `actions/setup-node` sets `registry-url: https://registry.npmjs.org`, which creates an
  `.npmrc` that reads `NODE_AUTH_TOKEN`.
- npm CLI 9.5 or newer. The workflow uses the npm bundled with Node 22.
- The package is public. Private packages cannot use public provenance in this setup.

Provenance is generated by npm during publish; do not add `--provenance` to local
`npm pack` commands. To inspect the public attestation after publishing:

```bash
npm view medusa-payment-zoho dist.attestations
npm audit signatures
```

Run `npm audit signatures` inside a consumer project that has installed the package.

## 6. GitHub release

1. Confirm CI is green on the tagged commit.
2. Push the local tag only when the maintainer authorizes it:

   ```bash
   git push origin v1.0.1
   ```

3. `release.yml` checks out the tag, verifies the tag/version match, runs `pnpm check`,
   and publishes with provenance.
4. After the npm publish succeeds, create a GitHub Release for the same tag. Use the
   `CHANGELOG.md` entry as the release notes:

   ```bash
   gh release create v1.0.1 --title "v1.0.1" --notes-file CHANGELOG.md
   ```

   If `CHANGELOG.md` contains all versions, copy only the current section into the
   release body.

Do not create a GitHub Release before npm publish succeeds. A GitHub Release is the
human-facing announcement; the npm tarball is the artifact consumers install.

## 7. npm authentication and 2FA

The release workflow reads the token from `secrets.NPM_TOKEN` and exposes it to npm as
`NODE_AUTH_TOKEN`. The token must not be committed, printed, or pasted into an issue.

### Create the token

1. Sign in to npm as a package maintainer.
2. Open **Access Tokens** and create a **Granular Access Token**.
3. Give it read/write access to `medusa-payment-zoho` only, not all packages.
4. Enable **Bypass 2FA** for this automation token. Without it, CI cannot complete the
   publish when the account requires 2FA.
5. Set an expiry and rotate the token before it lapses.
6. Add it as the `NPM_TOKEN` repository secret in GitHub.

Do not reuse a personal classic token across repositories. If the token leaks, revoke it
immediately and publish a security note.

### Account and package settings

- Require two-factor authentication for all maintainers.
- Require 2FA for publish on the npm package.
- Limit package maintainers to people who need release rights.
- Keep the `NPM_TOKEN` secret scoped to the release environment if the repository uses
  GitHub Environments.

### Local publishing

Local publishing is not needed for a normal release because the tag workflow publishes.
If a maintainer must publish manually:

```bash
npm login --auth-type=web
npm publish --provenance --access public
```

A 2FA-enabled account will prompt for an OTP. `prepublishOnly` runs `pnpm check` before
the tarball is uploaded, so a manual publish also runs the full gate. Manual publishing
does not produce GitHub Actions provenance unless it runs inside a supported CI
environment.

## 8. Medusa integrations listing

The package is discovered through its name, description, and keywords. Keep these
keywords in `package.json`; removing them makes the provider harder to find in Medusa
integration listings and npm searches:

- `medusa-v2`
- `medusa-plugin-integration`
- `medusa-plugin-payment`

The existing keyword set also includes `medusa`, `medusajs`, `payment`,
`payment-provider`, `zoho`, `zoho-payments`, `zohopay`, `india`, `inr`, `upi`, `cards`,
`ach`, and `ecommerce`. Do not remove keywords without checking the listing guidance.

The README should state:

- Medusa version range: `>=2.17.2 <3`, developed against `2.22.0`.
- Supported regions: India (default) and the United States.
- Checkout modes: embedded Checkout Widget and Hosted Checkout.
- Required webhook and signing configuration.
- That the package is not affiliated with Zoho Corporation or Medusa.

## 9. Post-publish verification

Wait for npm's registry to serve the new version, then run:

```bash
npm view medusa-payment-zoho version
npm view medusa-payment-zoho dist-tags
npm view medusa-payment-zoho dist.tarball
npm view medusa-payment-zoho time
```

Expected: the new version is `latest`, the tarball URL resolves, and the publish time is
current. Install it in a real Medusa application rather than relying on the temporary
consumer:

```bash
pnpm create medusa-app@latest
cd my-medusa-store
pnpm add medusa-payment-zoho
```

Configure the provider in `medusa-config.ts`:

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
      {
        resolve: "medusa-payment-zoho/providers/zoho",
        id: "zoho",
        options: {
          accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID,
          clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID,
          clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
          refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN,
          signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY,
          apiKey: process.env.ZOHO_PAYMENTS_API_KEY,
          region: "in",
          checkoutMode: "widget",
        },
      },
    ],
  },
}
```

Then:

1. Restart the Medusa server so the provider loads.
2. In the admin, open **Settings → Regions**, select the region, and enable **Zoho** as a
   payment provider.
3. Confirm the storefront checkout renders the embedded widget, or redirects to Hosted
   Checkout when configured.
4. Complete a test payment and confirm the signed webhook creates the Medusa payment and
   order.
5. Refund the test payment from the admin and confirm the refund reaches Zoho.
6. Run `npm audit signatures` in the app to verify the published attestation.

The live credential smoke test is optional and does not charge anything:

```bash
ZOHO_PAYMENTS_ACCOUNT_ID=... \
ZOHO_PAYMENTS_CLIENT_ID=... \
ZOHO_PAYMENTS_CLIENT_SECRET=... \
ZOHO_PAYMENTS_REFRESH_TOKEN=... \
ZOHO_PAYMENTS_REGION=in \
pnpm build
node scripts/smoke.mjs
```

It creates and retrieves a single payment session. It refuses to run when
`NODE_ENV=production`, and it never authorizes, captures, charges, or refunds.

To refresh the OAuth credentials used by the smoke test and the Medusa server:

```bash
ZOHO_PAYMENTS_CLIENT_ID=... \
ZOHO_PAYMENTS_CLIENT_SECRET=... \
ZOHO_PAYMENTS_ACCOUNT_ID=... \
node scripts/get-refresh-token.mjs
```

The helper opens the Zoho ORG authorization URL, listens on
`http://localhost:53682/callback` by default, validates the OAuth state, and exchanges
the code immediately. Authorization codes expire after one minute. It can also exchange
an existing code from `ZOHO_AUTH_CODE`.

## 10. Rollback and deprecation

npm discourages unpublishing. A version that has been public for more than 72 hours, or
that other packages depend on, generally cannot be unpublished. Prefer a forward fix.

### Broken but safe release

1. Publish a patch with the fix.
2. Move the `latest` dist-tag to the fixed version if npm did not do it automatically:

   ```bash
   npm dist-tag add medusa-payment-zoho@1.0.2 latest
   ```

3. Deprecate the broken version with an actionable message:

   ```bash
   npm deprecate medusa-payment-zoho@1.0.1 "Broken webhook mapping; upgrade to 1.0.2"
   ```

4. Update the GitHub Release notes to point at the fixed version.

Deprecation keeps existing installs working while warning new installers. It does not
remove the tarball.

### Security incident

1. Revoke the npm token and any leaked Zoho credentials.
2. Deprecate every affected version with a security message.
3. Publish a patched version and move `latest`.
4. Publish a GitHub security advisory and rotate the webhook signing key.
5. Do not delete tags or tarballs; consumers need the audit trail.

### Unpublish (last resort)

If a release contains a secret or is otherwise unsafe and is still inside npm's
unpublish window, a maintainer may run `npm unpublish medusa-payment-zoho@1.0.1`.
Understand the consequences first: unpublishing breaks lockfiles and can be blocked by
npm. Never unpublish a version that consumers may have pinned without a written
maintainer decision.

## 11. Release checklist summary

```text
[ ] clean tree, correct commit
[ ] pnpm install --frozen-lockfile
[ ] pnpm check
[ ] CI green on Node 22 and 24
[ ] version and CHANGELOG updated
[ ] README, LICENSE, SECURITY present
[ ] npm pack --dry-run reviewed (no secrets or source)
[ ] NPM_TOKEN valid, scoped, 2FA bypass enabled
[ ] local annotated tag created
[ ] maintainer authorizes the tag push
[ ] release workflow published with provenance
[ ] npm view and install-in-Medusa checks pass
[ ] GitHub Release created from CHANGELOG
```

## 12. References

- npm provenance: <https://docs.npmjs.com/generating-provenance-statements>
- npm publish: <https://docs.npmjs.com/cli/v11/commands/npm-publish>
- npm deprecate: <https://docs.npmjs.com/cli/v11/commands/npm-deprecate>
- npm dist-tag: <https://docs.npmjs.com/cli/v11/commands/npm-dist-tag>
- GitHub OIDC: <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>
- Medusa payment provider: <https://docs.medusajs.com/resources/references/payment/provider>
- Zoho Payments OAuth: <https://www.zoho.com/us/payments/developerdocs/web-integration/org-oauth/>
- Repository working agreement: [AGENTS.md](../AGENTS.md)
- OAuth retry policy: [ADR-0006](decisions/ADR-0006-oauth-retry-policy.md)

# ADR-0001: Package identity and public surface

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0002](./ADR-0002-checkout-architecture.md), [Compatibility](../compatibility.md)

## Context

The package must be installable in a Medusa v2 application, be discoverable as an
independent community integration, and avoid any implication that it is maintained or
endorsed by Zoho Corporation or Medusa. It also has to expose four different kinds of
code without leaking server-only code into a storefront bundle:

1. a Medusa payment module provider;
2. framework-agnostic browser helpers for the Zoho Checkout Widget and hosted checkout;
3. server-only helpers for signature verification and reconciliation;
4. shared public types.

The provider identifier becomes part of Medusa's stored provider ID, the webhook URL,
and the payment-session records. Changing it later is a breaking change for every
deployment, so it must be decided once and recorded.

## Decision

### Package and provider names

- The npm package is **`medusa-payment-zoho`**, published publicly under the MIT
  licence.
- The provider class declares `static identifier = "zoho"`.
- The documented `medusa-config.ts` module-provider `id` is **`zoho`**.
- The resulting Medusa provider ID is **`pp_zoho_zoho`**.
- The canonical webhook URL is **`/hooks/payment/zoho_zoho`**. Medusa 2.21.2 and later
  also accept the prefixed form `/hooks/payment/pp_zoho_zoho`; the unprefixed form is
  documented because it works across the supported range.

### Public entry points

| Entry point                          | Audience      | Contents                                                                 |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------ |
| `medusa-payment-zoho`                | Server        | Provider, options, typed client, amount/status/error/signature utilities |
| `medusa-payment-zoho/providers/zoho` | Medusa loader | Module-provider registration and provider option types                   |
| `medusa-payment-zoho/client`         | Browser       | Widget/hosted helpers, browser-safe types, expiry helpers                |
| `medusa-payment-zoho/server`         | Server        | Signature verification, typed client, amount/status/error helpers        |
| `medusa-payment-zoho/package.json`   | Tooling       | Package metadata                                                         |

The `client` entry point must never import `node:*` or `@medusajs/*`. The `server`
entry point is explicitly server-only because it uses `node:crypto`.

### Version and dependency contract

- Initial release line: **1.x**, starting at `1.0.0`.
- Peer dependencies: `@medusajs/framework` and `@medusajs/medusa` at
  `>=2.17.2 <3.0.0`.
- Development and verification baseline: Medusa **2.22.0**.
- Node.js: `>=20` in this package's `engines`; Medusa 2.22 itself requires
  Node.js `>=22.22.0`, which is the effective runtime floor for that Medusa version.
- Package manager used for the repository: pnpm 11.5.1.

### Identity and communication rules

- The README and package metadata state that this is an independent community
  integration, **not affiliated with Zoho Corporation or Medusa**.
- The package does not use Zoho or Medusa logos in a way that implies endorsement.
- Public API changes require a new ADR; existing ADRs are never rewritten to hide a
  change.
- Server secrets (client secret, refresh token, signing key, access tokens) are never
  exported to the browser entry point or placed in Medusa payment-session `data`.

## Consequences

### Positive

- A stable provider identifier keeps existing payment sessions, webhook routes, and
  admin configuration valid across releases.
- Separate entry points make the trust boundary explicit and let bundlers exclude
  Node-only crypto code from storefront builds.
- The peer range covers the Medusa versions whose `AbstractPaymentProvider` contract
  this package implements, while excluding future major versions that may change it.
- Public ownership and licensing are unambiguous, which matters for merchant adoption.

### Negative

- The package name and identifier are effectively permanent without a migration path.
- Supporting Medusa `>=2.17.2 <3` requires care when behaviour differs across minor
  versions, especially the webhook route prefix introduced in 2.21.2.
- The `engines` field (`>=20`) is weaker than the effective Medusa 2.22 floor
  (`>=22.22.0`); documentation and CI must communicate the real requirement.
- Four entry points increase build, packaging, and type-resolution test surface.

## Alternatives considered

1. **Name the package `@scope/medusa-payment-zoho`.** Rejected: a public unscoped name
   is simpler for community discovery, and there is no organisation scope to manage.
2. **Use `zohopay` or `zoho-payments` as the identifier.** Rejected: `zoho` is short,
   matches the package name, and produces the predictable route `zoho_zoho`.
3. **Expose everything from one entry point.** Rejected: importing the root would pull
   `node:crypto` into storefront bundles and violate the browser-safety invariant.
4. **Pin an exact Medusa version.** Rejected: providers are expected to work across a
   minor-version range; an exact pin would force duplicate installations.
5. **Advertise the package as official.** Rejected: it is not maintained by Zoho or
   Medusa and would be misleading.

## References

- Medusa payment provider guide:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>
- Medusa payment webhook events:
  <https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events>
- Medusa repository:
  <https://github.com/medusajs/medusa>
- Zoho Payments developer documentation:
  <https://www.zoho.com/us/payments/developerdocs/>
- npm package naming and scope rules:
  <https://docs.npmjs.com/cli/v10/configuring-npm/package-json>

## Test and verification pointers

- `pnpm build` must emit `.js`, `.cjs`, and `.d.ts` files for the root, `providers/zoho`,
  `client`, and `server` entry points.
- `pnpm pack:check` (`publint` and `attw`) must confirm that every export map target
  resolves for ESM and CJS consumers.
- `pnpm verify:package` must fail if the browser entry point imports `node:*` or
  `@medusajs/*`.
- A jsdom test imports `medusa-payment-zoho/client` with no Node globals and exercises
  the widget helper.
- A Node test imports `medusa-payment-zoho/server` and verifies a known HMAC vector.
- The Medusa integration fixture registers the provider with `id: "zoho"` and asserts
  that the resolved provider ID is `pp_zoho_zoho` and that
  `/hooks/payment/zoho_zoho` reaches the provider.

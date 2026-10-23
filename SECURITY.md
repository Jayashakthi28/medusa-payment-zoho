# Security policy

## Supported versions

| Version | Supported | Notes                                           |
| ------- | --------- | ----------------------------------------------- |
| `1.0.x` | Yes       | Current release line; security fixes land here. |
| `< 1.0` | No        | Pre-release development snapshots.              |

Security fixes are released for the current `1.x` line. If you run a fork, you are
responsible for carrying the fix forward.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Report it privately through GitHub Security Advisories:

<https://github.com/Jayashakthi28/medusa-payment-zoho/security/advisories/new>

Please include:

- the package version, Medusa version, and Node version;
- the affected option or flow (widget, hosted, webhook, refund, OAuth, client helper);
- a minimal reproduction or proof of concept;
- the impact you believe it has;
- whether the issue affects test mode, live mode, or both;
- any suggested fix or mitigation.

Do **not** include real merchant credentials, refresh tokens, signing keys, access
tokens, card data, customer data, full webhook bodies, or hosted-checkout URLs. Use
redacted values.

The maintainers aim to acknowledge a report within **5 business days** and will keep you
informed as triage and a fix progress. Timelines depend on severity and reproducibility.
Please give us a reasonable window to release a fix before public disclosure.

## Secret handling

These values are server-only and must never reach a browser, log, error message, commit,
or support ticket:

- OAuth **client secret**;
- OAuth **refresh token**;
- Zoho **signing key**;
- OAuth **access tokens**;
- full Zoho API request/response bodies that may contain payment data.

The Zoho **API key** used by the widget is publishable by design, but it is still not a
substitute for server authentication. The hosted-checkout URL contains Zoho’s
`access_key` and is a bearer capability: treat it like a short-lived secret.

Recommended practices:

- Load secrets from a secret manager or environment variables, never source control.
- Use separate Zoho credentials and webhook endpoints for test and live.
- Restrict who can read production environment variables.
- Rotate the refresh token and signing key on a schedule and after any suspected
  exposure.
- Rotate the signing key in Zoho and Medusa **together**; in-flight events signed with
  the old key fail closed.
- Do not log `data`, `checkoutUrl`, request headers, or raw webhook bodies.
- Redact secrets from error trackers and APM traces.
- Keep `.env`, build output, coverage, and `node_modules` out of git.

## Webhook security

The provider:

- verifies `X-Zoho-Webhook-Signature` over the exact raw body before reading any field;
- uses constant-time comparison;
- fails closed when the signing key is missing;
- rejects events whose `account_id` does not match the configured account;
- rejects events whose `live_mode` does not match a configured `liveMode`;
- never uses an unverified event to complete a payment.

Operational requirements:

- Serve the webhook endpoint over HTTPS.
- Preserve the raw body through proxies, body parsers, and API gateways.
- Monitor `ZOHO_WEBHOOK_VERIFICATION_ERROR`. Medusa acknowledges the HTTP request
  before the provider handler finishes, so a rejected event is only visible in logs and
  alerts, not in the HTTP status Zoho sees.
- Reconcile payments and refunds independently; webhooks are at-least-once and can be
  delayed or lost after a prolonged outage.
- If you enable `webhookToleranceSeconds`, choose a value that covers Zoho’s retry
  window. The default is `0` (disabled) because Zoho can retry for up to two days.

## PCI DSS scope

This package does not collect, transmit, or store raw card data. The embedded widget and
hosted checkout keep card entry on Zoho’s infrastructure. That generally reduces the
merchant’s PCI DSS scope, but **it does not eliminate it**. Scope depends on your
integration, hosting, logging, and acquirer requirements.

You are responsible for:

- confirming your PCI DSS scope with your acquirer and a qualified security assessor;
- ensuring your storefront, server, and logging do not capture card data or sensitive
  authentication data;
- complying with Zoho’s merchant and developer terms;
- securing your Medusa backend, database, and secrets;
- keeping dependencies patched.

Nothing in this document is legal, compliance, or security advice.

## Application security responsibilities

This package handles payment state, but your application still owns:

- authentication and authorization for checkout and Admin actions;
- cart/order access control (a cart ID is not an authorization token by itself);
- CSRF protection for state-changing storefront routes;
- HTTPS, HSTS, and secure cookie settings;
- Content Security Policy for Zoho’s widget and hosted redirect;
- open-redirect prevention on return routes;
- rate limiting your own endpoints;
- secure storage and rotation of Zoho credentials;
- reconciliation and monitoring for missed webhooks.

## Dependency and supply-chain security

- The package has no runtime dependencies beyond Medusa’s own framework packages.
- Dependencies are pinned in `pnpm-lock.yaml`; CI installs with
  `pnpm install --frozen-lockfile`.
- The build is checked with `publint` and `@arethetypeswrong/cli` before release.
- Report a suspected malicious dependency or build artifact through the private
  advisory link above.

## Safe harbor

We support good-faith security research. Please:

- test only against your own accounts and environments;
- do not access, modify, or exfiltrate another merchant’s or customer’s data;
- do not disrupt production service or run denial-of-service tests;
- do not use social engineering against maintainers or Zoho staff;
- give us a reasonable opportunity to fix the issue before disclosure.

We will not pursue legal action for good-faith research that follows these rules, to the
extent permitted by law.

## Non-affiliation

This is an independent community integration. It is not affiliated with, endorsed by,
or maintained by Zoho Corporation or Medusa, Inc. Report vulnerabilities in Zoho
Payments or Medusa to the respective vendor through their own security channels.

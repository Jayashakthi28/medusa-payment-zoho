# Configuration

This page is the complete reference for `medusa-payment-zoho` provider options. Options
are passed from `medusa-config.ts` to the Medusa Payment Module and validated when the
provider is constructed. Invalid options fail at startup, not on the first checkout.

- **Default region:** India (`region: "in"`)
- **Default environment:** live (`environment: "live"`); sandbox is India-only
- **Default checkout mode:** embedded widget (`checkoutMode: "widget"`)
- **Provider identifier:** `zoho`
- **Stored provider ID:** `pp_zoho_zoho`

## 1. Minimal configuration

```ts
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-zoho/providers/zoho",
            id: "zoho",
            options: {
              accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID!,
              clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID!,
              clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET!,
              refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN!,
              signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY!,
              region: "in",
              environment: "live",
              checkoutMode: "widget",
              apiKey: process.env.ZOHO_PAYMENTS_API_KEY!,
            },
          },
        ],
      },
    },
  ],
})
```

The `resolve` subpath is required. The package root exports server utilities but no
module-provider default; `medusa-payment-zoho/providers/zoho` is the ModuleProvider
entry point.

## 2. Environment variables

The provider does not read environment variables itself. The variables below are the
names used by the README and `.env.example`; map them explicitly in
`medusa-config.ts`.

| Variable                      | Maps to option  | Required          | Notes                                                                             |
| ----------------------------- | --------------- | ----------------- | --------------------------------------------------------------------------------- |
| `ZOHO_PAYMENTS_ACCOUNT_ID`    | `accountId`     | Yes               | Zoho Payments account ID.                                                         |
| `ZOHO_PAYMENTS_CLIENT_ID`     | `clientId`      | Yes               | OAuth ORG client ID.                                                              |
| `ZOHO_PAYMENTS_CLIENT_SECRET` | `clientSecret`  | Yes               | Server-only secret.                                                               |
| `ZOHO_PAYMENTS_REFRESH_TOKEN` | `refreshToken`  | Yes               | Server-only secret.                                                               |
| `ZOHO_PAYMENTS_SIGNING_KEY`   | `signingKey`    | Yes in production | Server-only secret; without it webhooks cannot be verified.                       |
| `ZOHO_PAYMENTS_API_KEY`       | `apiKey`        | Widget mode       | Publishable browser key. Do not use the client secret here.                       |
| `ZOHO_PAYMENTS_REGION`        | `region`        | No                | `in` (default) or `us`.                                                           |
| `ZOHO_PAYMENTS_ENVIRONMENT`   | `environment`   | No                | `live` (default) or `sandbox` (India only).                                       |
| `ZOHO_PAYMENTS_CHECKOUT_MODE` | `checkoutMode`  | No                | `widget` (default) or `hosted`.                                                   |
| `ZOHO_PAYMENTS_SUCCESS_URL`   | `successUrl`    | Hosted mode       | Must be HTTPS in production.                                                      |
| `ZOHO_PAYMENTS_FAILURE_URL`   | `failureUrl`    | Hosted mode       | Must be HTTPS in production.                                                      |
| `ZOHO_PAYMENTS_BUSINESS_NAME` | `businessName`  | No                | Displayed in the embedded widget header when set.                                 |
| `ZOHO_PAYMENTS_LIVE_MODE`     | `liveMode`      | No                | `true` or `false`; compare webhook `live_mode`.                                   |
| `ZOHO_PAYMENTS_REDIRECT_URI`  | — (script only) | No                | Loopback callback used by `scripts/get-refresh-token.mjs`; not a provider option. |

Do not commit a populated `.env`. The repository ignores `.env` files, build output,
coverage, and `node_modules`.

## 3. Option reference

### 3.1 Credentials

| Option         | Type     | Default | Validation                                 |
| -------------- | -------- | ------- | ------------------------------------------ |
| `accountId`    | `string` | —       | Required, trimmed, non-empty.              |
| `clientId`     | `string` | —       | Required, trimmed, non-empty.              |
| `clientSecret` | `string` | —       | Required, trimmed, non-empty. Server-only. |
| `refreshToken` | `string` | —       | Required, trimmed, non-empty. Server-only. |

These four values must belong to the same Zoho data centre as `region`. A refresh token
minted in the US data centre cannot authorize an India account, and vice versa.

### 3.2 Region and checkout

| Option         | Type                   | Default    | Validation                                               |
| -------------- | ---------------------- | ---------- | -------------------------------------------------------- |
| `region`       | `"in" \| "us"`         | `"in"`     | Exact match; any other value throws at startup.          |
| `environment`  | `"live" \| "sandbox"`  | `"live"`   | Sandbox is supported only with `region: "in"`.           |
| `checkoutMode` | `"widget" \| "hosted"` | `"widget"` | Exact match; any other value throws at startup.          |
| `apiKey`       | `string`               | —          | Required when `checkoutMode` is `"widget"`. Publishable. |
| `successUrl`   | `string`               | —          | Required when `checkoutMode` is `"hosted"`.              |
| `failureUrl`   | `string`               | —          | Required when `checkoutMode` is `"hosted"`.              |

`successUrl` and `failureUrl` are validated whenever they are supplied, even in widget
mode, so a malformed value cannot surprise you after switching modes. Both accept only
`http:` or `https:`. In `NODE_ENV=production`, `http:` is rejected unless the host is
`localhost` or `127.0.0.1`.

### 3.3 Signing and webhook mode

| Option                    | Type      | Default     | Validation                                                                 |
| ------------------------- | --------- | ----------- | -------------------------------------------------------------------------- |
| `signingKey`              | `string`  | —           | Trimmed, max 512 characters. Server-only; strongly required in production. |
| `liveMode`                | `boolean` | `undefined` | When set, a webhook carrying `live_mode` must match it.                    |
| `webhookToleranceSeconds` | `number`  | `0`         | Integer, 0–86400. `0` disables the timestamp-age check.                    |

One `signingKey` is used for all three Zoho signature schemes: webhook, widget
response, and hosted-checkout return URL. Key rotation must update Medusa and Zoho
together. If the key is missing, startup logs a warning; webhooks and signature
verification then fail closed rather than accepting unsigned data.

`liveMode` is optional so test environments can receive either mode. In production it
is recommended to set it to `true`; a signed test-mode event will then be rejected
instead of completing a live payment.

`webhookToleranceSeconds` defaults to `0` because Zoho’s documented retry window can be
up to two days. If you enable a tolerance, choose a value that still covers your
expected outage/retry window (for example `300` seconds for live traffic). A too-small
value rejects legitimate delayed deliveries.

### 3.4 Presentation and metadata

| Option                  | Type                     | Default                  | Validation                                                                       |
| ----------------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| `paymentDescription`    | `string`                 | `"Medusa order payment"` | Trimmed, non-empty, max 500 characters.                                          |
| `businessName`          | `string`                 | `undefined`              | Trimmed, non-empty, max 100 characters. Displayed in the embedded widget header. |
| `allowedPaymentMethods` | `string[]`               | `undefined`              | Array of non-empty strings; duplicates removed; an empty array becomes unset.    |
| `currencySymbols`       | `Record<string, string>` | `{}`                     | Object; each value non-empty; keys normalized to uppercase ISO-4217.             |
| `metadata`              | `Record<string, string>` | `{}`                     | Max 3 entries; keys non-empty and not reserved; values non-empty, max 500 chars. |

`paymentDescription` is sent to Zoho and shown to the customer. `invoiceNumber` is
derived automatically from the Medusa payment-session ID (or a timestamp fallback) and
truncated to Zoho’s 50-character limit.

`allowedPaymentMethods` is passed through as Zoho’s
`configurations.allowed_payment_methods`. The package does not validate method names
against a local allow-list because availability depends on the account, region, and
Zoho enablement. Unsupported values are rejected by Zoho.

`currencySymbols` overrides the display symbol the widget receives. Keys are normalized
with the same ISO-4217 validation as payment currencies, so an invalid key fails at
startup.

`metadata` adds non-sensitive entries to the Zoho payment session. Two keys are
reserved and rejected:

- `medusa_session_id` — written by the provider for webhook correlation;
- `zoho_session_id` — reserved for session lookup.

Zoho accepts at most **5** metadata entries per resource. The provider reserves one for
`medusa_session_id`, leaving **3** for your own entries.

### 3.5 Networking and polling

| Option             | Type     | Default | Validation                                             |
| ------------------ | -------- | ------- | ------------------------------------------------------ |
| `timeoutMs`        | `number` | `15000` | Integer, 1–120000. Per HTTP request.                   |
| `maxRetries`       | `number` | `3`     | Integer, 0–10. Safe calls and OAuth only.              |
| `retryBaseDelayMs` | `number` | `500`   | Integer, 0–60000. Exponential-backoff base.            |
| `pollAttempts`     | `number` | `3`     | Integer, 0–10. Status polls during `authorizePayment`. |
| `pollIntervalMs`   | `number` | `500`   | Integer, 0–10000. Delay between status polls.          |

Retry behaviour is deliberately asymmetric:

- Safe reads (`GET`) and payment-session creation retry network errors, `429`, and
  `5xx` with exponential backoff.
- Refund creation (`POST /payments/{id}/refunds`) retries only an explicit `429`.
  A timeout or `5xx` can mean Zoho already accepted the refund, so the provider does not
  retry it blindly.
- OAuth refresh retries network errors, `429`, and `5xx`; `invalid_client`,
  `invalid_grant`, and other terminal `4xx` responses fail immediately.
- On a Payments API `401`, the token cache is invalidated and the request is retried
  once. A second `401` is surfaced.

See [ADR-0006](./decisions/ADR-0006-oauth-retry-policy.md) for the full policy.

### 3.6 Advanced overrides

| Option                  | Type                | Default        | Validation                                     |
| ----------------------- | ------------------- | -------------- | ---------------------------------------------- |
| `apiBaseUrl`            | `string`            | Region default | Valid `http`/`https` URL; HTTPS in production. |
| `accountsBaseUrl`       | `string`            | Region default | Valid `http`/`https` URL; HTTPS in production. |
| `hostedCheckoutBaseUrl` | `string`            | Region default | Valid `http`/`https` URL; HTTPS in production. |
| `fetch`                 | `typeof fetch`      | Global `fetch` | Must be a function.                            |
| `logger`                | `ZohoPaymentLogger` | Medusa logger  | Must provide `debug`, `warn`, and `error`.     |

These exist for private API gateways, instrumentation, tests, and regional overrides.
Do not change them unless you know the corresponding Zoho endpoint. The widget domain
(`IN` or `US`) is derived from `region` and cannot be overridden.

A custom `logger` must be a structured logger:

```ts
{
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}
```

## 4. Region matrix

| Setting         | India live (`region: "in"`)                               | India sandbox (`environment: "sandbox"`)         | US live (`region: "us"`)                   |
| --------------- | --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Default         | Yes                                                       | Opt-in                                           | Opt-in                                     |
| Payments API    | `https://payments.zoho.in/api/v1`                         | `https://paymentssandbox.zoho.in/api/v1`         | `https://payments.zoho.com/api/v1`         |
| OAuth accounts  | `https://accounts.zoho.in`                                | `https://accounts.zoho.in`                       | `https://accounts.zoho.com`                |
| Hosted checkout | `https://payments.zoho.in/hostedcheckout`                 | `https://paymentssandbox.zoho.in/hostedcheckout` | `https://payments.zoho.com/hostedcheckout` |
| Widget domain   | `IN`                                                      | `IN`                                             | `US`                                       |
| Widget script   | `https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js` | Same                                             |
| Webhooks        | Yes                                                       | Yes                                              |
| Refunds         | Yes                                                       | Yes                                              |

The Zoho account, OAuth client, refresh token, and `region` must agree. A mismatch
usually produces `invalid_client`, `invalid_grant`, or a `401`/`403` from the Payments
API. See [Troubleshooting](./troubleshooting.md#12-region-and-domain-problems).

## 5. Hosted checkout configuration

Hosted mode changes only the browser step. The server-side session and webhook model
are identical.

```ts
{
  resolve: "medusa-payment-zoho/providers/zoho",
  id: "zoho",
  options: {
    accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID!,
    clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID!,
    clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET!,
    refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN!,
    signingKey: process.env.ZOHO_PAYMENTS_SIGNING_KEY!,
    region: "in",
    environment: "live",
    checkoutMode: "hosted",
    successUrl: "https://storefront.example.com/checkout/success",
    failureUrl: "https://storefront.example.com/checkout?payment=failed",
  },
}
```

The provider sends these as Zoho `configurations.hosted_checkout_parameters` and returns
a `checkoutUrl` built from Zoho’s `access_key`. The URL is a bearer capability: do not
log it or send it to analytics.

`successUrl` and `failureUrl` are static provider options. If your return route needs
the cart ID, set a short-lived HttpOnly cookie from your checkout server before the
redirect, or use your own server-side state. See
[Hosted checkout](./storefront-hosted.md).

## 6. Validation rules

At startup, the provider enforces:

1. `accountId`, `clientId`, `clientSecret`, and `refreshToken` are non-empty after
   trimming.
2. `region` is exactly `"in"` or `"us"`.
3. `checkoutMode` is exactly `"widget"` or `"hosted"`.
4. `apiKey` is present in widget mode.
5. `successUrl` and `failureUrl` are present in hosted mode.
6. Any supplied URL parses, uses `http`/`https`, and uses HTTPS in production outside
   localhost.
7. Numeric options are integers inside their documented ranges.
8. `allowedPaymentMethods` is an array of non-empty strings.
9. `currencySymbols` is an object with non-empty string values and valid ISO keys.
10. `metadata` is an object with at most 3 entries, valid keys, and values no longer
    than 500 characters.
11. `logger` provides `debug`, `warn`, and `error`.
12. `fetch`, when supplied, is a function.

Failures throw `ZohoConfigurationError` (`ZOHO_CONFIGURATION_ERROR`) and include the
offending option name. The provider does not attempt a network call with invalid
configuration.

## 7. Production checklist

- [ ] The Medusa backend and storefront are served over HTTPS.
- [ ] `accountId`, `clientId`, `clientSecret`, `refreshToken`, `signingKey`, and
      `apiKey` come from a secret manager or environment variables — never source
      control.
- [ ] The Zoho account, OAuth client, and `region` are in the same data centre.
- [ ] `signingKey` is configured; startup does not warn about a missing key.
- [ ] `liveMode: true` is set for live traffic, or deliberately left unset with a
      documented reason.
- [ ] A webhook exists at
      `https://<backend>/hooks/payment/zoho_zoho` with `payment.succeeded`,
      `payment.pending`, and `payment.failed` enabled.
- [ ] The webhook endpoint is publicly reachable, uses HTTPS, and returns quickly.
- [ ] `successUrl` and `failureUrl` are HTTPS and point at the real storefront routes.
- [ ] The storefront CSP allows the Zoho widget script and required Zoho domains.
- [ ] Outbound HTTPS is allowed to the regional `payments.zoho.*` and
      `accounts.zoho.*` hosts.
- [ ] The provider is enabled for the correct region in **Medusa Admin → Settings →
      Regions**.
- [ ] Test and live Zoho credentials are separated; test webhooks cannot reach the
      live deployment.
- [ ] Logs are monitored for `ZOHO_WEBHOOK_VERIFICATION_ERROR`,
      `ZOHO_AUTHENTICATION_ERROR`, and unexpected `NOT_SUPPORTED` webhook results.
- [ ] A reconciliation job or runbook exists for refunds left in `initiated`/`pending`
      and for payments whose webhook never arrived.
- [ ] `pnpm check` passes in CI, including 100% coverage.
- [ ] The refund and cancellation limitations in
      [Compatibility](./compatibility.md) are understood by support staff.

## 8. Related documentation

- [Configuration options in the README](../README.md#configuration-options)
- [Storefront widget](./storefront-widget.md)
- [Storefront hosted checkout](./storefront-hosted.md)
- [Webhooks](./webhooks.md)
- [Signatures](./signatures.md)
- [Troubleshooting](./troubleshooting.md)
- [OAuth and retry ADR](./decisions/ADR-0006-oauth-retry-policy.md)

# ADR-0002: Checkout architecture — widget first, hosted checkout supported

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Maintainers
- **Related:** [ADR-0001](./ADR-0001-package-identity.md), [ADR-0003](./ADR-0003-session-lifecycle.md), [Architecture](../architecture.md)

## Context

Zoho Payments offers two browser-facing ways to collect a payment against the same
server-created payment session:

- an **embedded Checkout Widget**, loaded from Zoho's CDN and driven by a publishable
  API key; and
- a **Hosted Checkout** page, reached by redirecting the customer to
  `https://payments.zoho.<tld>/hostedcheckout/<access_key>`.

The default market is India, where UPI and card selection are central to conversion
and an embedded experience avoids a full-page redirect. Some merchants, however,
cannot allow a third-party script in their storefront (strict CSP, no-JS checkout,
native or server-rendered shells), and hosted checkout is the only viable option.

Medusa's payment provider contract is server-side. It has no concept of "open a
widget". The storefront must therefore receive enough public data from
`initiatePayment` to drive checkout, and the server must remain the only party that
decides whether a payment succeeded.

## Decision

### Both modes, one server model

`checkoutMode` is a provider option with two values, `"widget"` (default) and
`"hosted"`. Both modes:

- create the same Zoho `POST /paymentsessions` resource;
- store the same provider-owned `data` shape (`zohoSessionId`, amount, currency,
  `expiresAt`, `medusaSessionId`, and mode-specific extras);
- authorize through the same `authorizePayment` path, which retrieves the Zoho
  session/payment from the API; and
- rely on signed webhooks as the asynchronous backstop.

Mode-specific data:

| Mode     | Required options           | Added to session `data`                      |
| -------- | -------------------------- | -------------------------------------------- |
| `widget` | `apiKey`                   | `widget: { accountId, domain, apiKey }`      |
| `hosted` | `successUrl`, `failureUrl` | `checkoutUrl` built from Zoho's `access_key` |

### Embedded widget is the primary path

The browser helper `payWithZohoCheckout`:

1. validates that the session is unexpired and uses `checkoutMode: "widget"`;
2. loads `https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js` once per page,
   reusing an existing script or global;
3. instantiates `ZPayments` with the publishable account ID, region domain, and API key;
4. calls `requestPaymentMethod` with the server-formatted amount, currency, Zoho
   session ID, description, invoice number, and optional customer prefill; and
5. returns a discriminated result: a success variant carrying `paymentId`,
   `paymentSessionId`, and optional `signature`, or a failure variant carrying one of
   `closed`, `failed`, `expired`, `not_configured`, or `hosted_checkout_required`,
   plus optional `message` and `code`.

The returned `paymentId` is **a hint for the storefront**, not proof of payment. The
server must call `authorizePayment` or retrieve the Zoho session before creating an
order. The optional widget signature can be verified server-side with
`isValidZohoWidgetResponseSignature`, but the provider still reconciles against Zoho.

### Hosted checkout is an explicit opt-in

In hosted mode, the provider adds `configurations.hosted_checkout_parameters` with the
merchant's success/failure URLs and optional customer details, then builds the redirect
URL from the returned `access_key`. The storefront calls
`redirectToZohoHostedCheckout(session)` and navigates.

The return URL is handled by the merchant's storefront/server, not by Medusa's provider
contract. The `server` entry point exports
`isValidZohoHostedCheckoutSignature` so a custom return route can verify the
`payments_session_id.payment_session_status.payment_id.payment_status.amount.mandate_id.udf1…udf5` (India; US omits `mandate_id`)
signature before trusting the redirect. Verification is defence in depth; the order is
only completed after the provider retrieves the session/payment from Zoho or receives a
valid webhook.

### Trust and packaging rules

- The browser helper never imports `node:*` or `@medusajs/*`.
- The provider never returns the OAuth client secret, refresh token, access token, or
  signing key in payment-session `data`.
- The widget `apiKey` is treated as publishable by design; it is not a substitute for
  server authentication.
- Client-reported status never changes Medusa state directly.
- `close()` on the widget instance is best-effort cleanup; its failure never masks the
  payment result.

## Consequences

### Positive

- Indian merchants get the embedded checkout flow by default with no extra storefront
  integration beyond calling the helper.
- Merchants with strict CSP or no-JS constraints can use hosted checkout without
  changing the server-side provider.
- One session model keeps authorization, webhooks, refunds, and reconciliation
  identical across modes.
- The browser/server split makes the security boundary reviewable and keeps the
  storefront bundle free of Node and Medusa code.

### Negative

- Two checkout paths must be tested and documented, including their different failure
  and return behaviours.
- The widget depends on a third-party script and CDN availability; CSP must allow
  `static.zohocdn.com` and the Zoho payments domain.
- Hosted mode requires the merchant to implement and secure a return route; the
  provider cannot complete that step for them.
- The widget response signature is optional in Zoho's response, so the server cannot
  rely on it being present.
- The widget may return a `payment_id` before the session is fully settled, so
  `authorizePayment` may need to poll.

## Alternatives considered

1. **Hosted checkout only.** Rejected: weaker checkout UX in the primary Indian market
   and unnecessary full-page redirects.
2. **Widget only.** Rejected: excludes merchants with CSP/no-JS constraints and leaves
   no fallback when the script cannot load.
3. **Build a custom card form against Zoho's raw APIs.** Rejected: expands PCI scope,
   duplicates Zoho's payment-method UI, and is outside this package's remit.
4. **Let the storefront report success and mark the order paid.** Rejected: a client can
   forge `payment_id`; the server must verify with Zoho.
5. **Verify the hosted return signature inside `authorizePayment`.** Rejected: the
   provider does not receive the browser's return URL or query parameters; only a
   merchant route can do that.
6. **Use Medusa's payment session `data` to carry the signing key for client-side
   verification.** Rejected: the signing key is server-only.

## References

- Zoho hosted checkout integration:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/>
- Zoho Checkout Widget integration:
  <https://www.zoho.com/us/payments/developerdocs/web-integration/integrate-widget/>
- Zoho Checkout Widget API:
  <https://www.zoho.com/us/payments/api/v1/widget/>
- Zoho signature verification:
  <https://www.zoho.com/us/payments/developerdocs/signature-verification/>
- Medusa payment provider reference:
  <https://docs.medusajs.com/resources/references/payment/provider>
- Medusa payment module provider guide:
  <https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider>

## Test and verification pointers

- Provider tests cover both modes: widget data contains exactly the publishable fields;
  hosted data contains the redirect URL and no `access_key` secret beyond the URL.
- Option tests assert that `apiKey` is required for widget mode and that
  `successUrl`/`failureUrl` are required and HTTPS-validated for hosted mode.
- Browser tests (jsdom) cover script load once, concurrent loads, script error, timeout,
  widget close, `widget_closed`, missing `payment_id`, expired session, wrong mode, and
  missing widget configuration.
- A packaging test asserts that `dist/client/*` contains no `node:` or `@medusajs/`
  imports.
- A hosted-return test verifies a known signature vector and rejects a tampered field.
- Manual sandbox verification covers one successful widget payment and one successful
  hosted payment in each supported region before release.

# Signature verification

Zoho uses three HMAC-SHA256 signatures in the flows supported by this package. They
cover different data, use different separators, and arrive through different channels:

| Flow                   | Signed message                                                                                                                                   | Transport                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Webhook                | `${timestamp}.${rawBody}`                                                                                                                        | `X-Zoho-Webhook-Signature: t=…,v=…` |
| Widget response        | `${payment_id}\|${payment_session_id}`                                                                                                           | `signature` field                   |
| Hosted-checkout return | `payments_session_id.payment_session_status.payment_id.payment_status.amount.mandate_id.udf1.udf2.udf3.udf4.udf5` (India; US omits `mandate_id`) | `signature` query parameter         |

All three use the same merchant **signing key** from Zoho **Settings → Developer
Space**. The key is server-only. Verification must happen on the server with the
`medusa-payment-zoho/server` entry point (or the root entry point); the browser entry
point intentionally does not import `node:crypto`.

- **Output:** lowercase hexadecimal HMAC-SHA256.
- **Comparison:** constant-time, after decoding both hex strings to equal-length
  buffers.
- **Missing key:** throws `ZohoConfigurationError`; there is no unverified mode.
- **Empty signature:** always invalid.

## 1. Webhook signature

### Format

The header is a comma-separated list:

```text
X-Zoho-Webhook-Signature: t=1760000000000,v=5f2d...
```

- `t` is the Unix timestamp in **milliseconds**, used verbatim.
- `v` is the lowercase hex signature. `v1` is accepted as an alias.
- Header lookup is case-insensitive. If the header appears multiple times, the first
  string value is used.
- `parseZohoSignatureHeader` returns `null` for a missing header, missing `t`/`v`,
  non-finite timestamps, or timestamps `<= 0`.

The signed message is:

```text
${t}.${rawBody}
```

`rawBody` is the **exact bytes/string received**. Never parse and re-serialize the JSON
before verifying: whitespace and key order change, and the signature fails.

### Code: raw body with Express

```ts
import express from "express"
import {
  assertValidZohoWebhookSignature,
  ZohoWebhookVerificationError,
} from "medusa-payment-zoho/server"

const app = express()

// Preserve the raw body for this route. Do not use express.json() here.
app.post(
  "/hooks/payment/zoho_zoho",
  express.raw({ type: "application/json", limit: "1mb" }),
  (request, response) => {
    try {
      assertValidZohoWebhookSignature(
        {
          rawBody: request.body as Buffer,
          signatureHeader: request.header("x-zoho-webhook-signature") ?? undefined,
        },
        process.env.ZOHO_PAYMENTS_SIGNING_KEY!,
        { toleranceSeconds: 300 }
      )

      // Only now is it safe to parse and use the event.
      const event = JSON.parse((request.body as Buffer).toString("utf8")) as {
        event_type?: string
      }

      if (!event.event_type) {
        response.sendStatus(400)
        return
      }

      response.sendStatus(200)
    } catch (error) {
      if (error instanceof ZohoWebhookVerificationError) {
        response.sendStatus(401)
        return
      }

      response.sendStatus(400)
    }
  }
)
```

In production, Medusa already exposes the webhook route
(`/hooks/payment/zoho_zoho`) and passes the raw body to the provider. You do not need to
add this Express route unless you are building a custom ingress/reconciliation service.

### Code: Next.js route handler

```ts
// app/api/zoho/webhook/route.ts
import { NextResponse } from "next/server"
import { assertValidZohoWebhookSignature } from "medusa-payment-zoho/server"

export async function POST(request: Request) {
  const rawBody = await request.text() // read once, before parsing
  const signatureHeader = request.headers.get("x-zoho-webhook-signature") ?? undefined

  try {
    assertValidZohoWebhookSignature(
      { rawBody, signatureHeader },
      process.env.ZOHO_PAYMENTS_SIGNING_KEY!
    )
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  const event = JSON.parse(rawBody) as { event_type?: string }

  if (!event.event_type) {
    return NextResponse.json({ error: "missing event_type" }, { status: 400 })
  }

  // forward the verified event to your own processor
  return NextResponse.json({ received: true })
}
```

Do not call `request.json()` before verifying; it consumes the body and may reserialize
it.

### Timestamp tolerance

```ts
isValidZohoWebhookSignature({ rawBody, signatureHeader }, signingKey, {
  toleranceSeconds: 300,
  now: () => Date.now(), // optional, useful in tests
})
```

- `toleranceSeconds: 0` (the provider default) disables the age check.
- A positive value rejects events whose absolute age exceeds the tolerance.
- Zoho retries for up to two days, so a short tolerance can reject legitimate delayed
  deliveries. If you enable one, choose it with your outage/retry window in mind.
- The timestamp is milliseconds; the comparison converts the difference to seconds.

## 2. Widget response signature

### Format

The widget may return a `signature` alongside `payment_id`. The signed message is:

```text
${payment_id}|${payment_session_id}
```

Both values are used as returned by Zoho. The `payment_session_id` must be the one the
widget was opened for, not a client-supplied replacement.

The signature is optional in Zoho’s response. Its absence does **not** block
server-side verification: the provider retrieves the session/payment from Zoho before
creating a Medusa payment. Treat a present signature as defence in depth.

### Code

```ts
import { isValidZohoWidgetResponseSignature } from "medusa-payment-zoho/server"

const valid = isValidZohoWidgetResponseSignature(
  {
    paymentId: "pay_01J...",
    paymentSessionId: "sess_01J...",
    signature: "5f2d...",
  },
  process.env.ZOHO_PAYMENTS_SIGNING_KEY!
)
```

Full server-route example:
[Storefront widget: verifying the widget signature](./storefront-widget.md#7-verifying-the-widget-signature-optional-server-side).

Important: compare `paymentSessionId` to the session ID stored on the Medusa payment
session (`data.zohoSessionId`) or to the Zoho session retrieved by the server. Do not
trust a session ID supplied by the browser.

## 3. Hosted-checkout return signature

### Format

Zoho redirects to `successUrl` or `failureUrl` with a `signature` query parameter. The
signed message is the dot-joined fields, **in this exact order**:

```text
payments_session_id
payment_session_status
payment_id
payment_status
amount
mandate_id
udf1
udf2
udf3
udf4
udf5
```

Concatenated (India layout):

```text
${payments_session_id}.${payment_session_status}.${payment_id}.${payment_status}.${amount}.${mandate_id}.${udf1}.${udf2}.${udf3}.${udf4}.${udf5}
```

The US documentation omits `mandate_id`. The verifier accepts both official layouts
when `mandateId` is absent; when `mandateId` is supplied it verifies the India layout
only.

Rules:

- Absent optional fields are **empty strings**, not omitted separators. An absent
  `mandate_id` is still a separator in the India layout.
- The amount is the string from the return URL (for example `"1499.00"` or `"5.000"`),
  not a reformatted decimal.
- Field order is fixed. Reordering fields produces a different message.
- `payments_session_id` is the Zoho payment-session ID, the same value stored as
  `data.zohoSessionId`.

### Code: Next.js success route

```ts
import { isValidZohoHostedCheckoutSignature } from "medusa-payment-zoho/server"

function value(params: URLSearchParams, key: string): string | undefined {
  return params.get(key) ?? undefined
}

export function verifyHostedReturn(params: URLSearchParams): boolean {
  const signature = params.get("signature")
  const signingKey = process.env.ZOHO_PAYMENTS_SIGNING_KEY

  if (!signature || !signingKey) {
    return false
  }

  return isValidZohoHostedCheckoutSignature(
    {
      paymentsSessionId: params.get("payments_session_id") ?? "",
      paymentSessionStatus: params.get("payment_session_status") ?? "",
      paymentId: value(params, "payment_id"),
      paymentStatus: value(params, "payment_status"),
      amount: value(params, "amount"),
      mandateId: value(params, "mandate_id"),
      udf1: value(params, "udf1"),
      udf2: value(params, "udf2"),
      udf3: value(params, "udf3"),
      udf4: value(params, "udf4"),
      udf5: value(params, "udf5"),
      signature,
    },
    signingKey
  )
}
```

Full success/failure routes:
[Hosted checkout](./storefront-hosted.md#4-success-route).

A valid signature proves Zoho produced these fields. It does **not** prove settlement.
Always call `cart.complete()` (which retrieves the payment from Zoho) or await a signed
webhook before fulfilling.

## 4. API reference

All helpers are exported from `medusa-payment-zoho/server` and the package root.

| Export                                                  | Returns                             | Behaviour                                                                |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `isValidZohoWebhookSignature(input, key, options?)`     | `boolean`                           | Returns `false` for malformed/expired signatures. Throws on missing key. |
| `assertValidZohoWebhookSignature(input, key, options?)` | `void`                              | Throws `ZohoWebhookVerificationError` when invalid.                      |
| `isValidZohoWidgetResponseSignature(input, key)`        | `boolean`                           | Verifies the widget message.                                             |
| `isValidZohoHostedCheckoutSignature(input, key)`        | `boolean`                           | Verifies the India (with mandate) or US (without) hosted return.         |
| `parseZohoSignatureHeader(header)`                      | `ParsedZohoSignatureHeader \| null` | Parses `t`/`v` (or `v1`). Useful for diagnostics.                        |

Types:

```ts
interface ZohoWebhookSignatureInput {
  rawBody: string | Buffer
  signatureHeader: string | string[] | undefined
}

interface ZohoWebhookSignatureOptions {
  toleranceSeconds?: number
  now?: () => number
}

interface ZohoWidgetSignatureInput {
  paymentId: string
  paymentSessionId: string
  signature: string
}

interface ZohoHostedCheckoutSignatureInput {
  paymentsSessionId: string
  paymentSessionStatus: string
  paymentId?: string
  paymentStatus?: string
  amount?: string
  mandateId?: string
  udf1?: string
  udf2?: string
  udf3?: string
  udf4?: string
  udf5?: string
  signature: string
}
```

## 5. Manual verification with OpenSSL

Webhook:

```bash
printf '%s.%s' "$TS" "$BODY" \
  | openssl dgst -sha256 -hmac "$ZOHO_PAYMENTS_SIGNING_KEY" -hex
```

Widget:

```bash
printf '%s|%s' "$PAYMENT_ID" "$PAYMENT_SESSION_ID" \
  | openssl dgst -sha256 -hmac "$ZOHO_PAYMENTS_SIGNING_KEY" -hex
```

Hosted return:

```bash
MESSAGE="$PAYMENTS_SESSION_ID.$PAYMENT_SESSION_STATUS.$PAYMENT_ID.$PAYMENT_STATUS.$AMOUNT.$MANDATE_ID.$UDF1.$UDF2.$UDF3.$UDF4.$UDF5"

printf '%s' "$MESSAGE" \
  | openssl dgst -sha256 -hmac "$ZOHO_PAYMENTS_SIGNING_KEY" -hex
```

OpenSSL prints `(stdin)= <hex>` on some versions and `<hex>` on others. Compare the
lowercase hex value only.

## 6. Common mistakes

| Mistake                                                     | Result                                       | Fix                                          |
| ----------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Verifying `JSON.stringify(parsedBody)`                      | Valid signatures fail                        | Verify the exact raw body.                   |
| Body parsed by `express.json()` before the verifier         | Valid signatures fail                        | Use `express.raw()` on that route.           |
| Using seconds instead of the header’s millisecond timestamp | Valid webhooks fail                          | Use `t` verbatim.                            |
| Trimming or reformatting the hosted `amount`                | Valid returns fail                           | Use the query string value exactly.          |
| Omitting a separator for an absent UDF                      | Valid returns fail                           | Use an empty string for each absent field.   |
| Verifying with the client secret or API key                 | Valid signatures fail                        | Use the Developer Space **signing key**.     |
| Verifying in the browser                                    | Key exposure                                 | Verify on the server; return only a boolean. |
| Comparing with `===`                                        | Timing side channel                          | Use the exported constant-time helpers.      |
| Trusting a widget signature without checking the session ID | A valid signature for another session passes | Compare against the stored `zohoSessionId`.  |

## 7. Key handling and rotation

- One `signingKey` covers all three schemes. If Zoho issues separate keys for different
  features, the package currently assumes they are the same value; splitting the option
  would require a new ADR.
- The key is trimmed and limited to 512 characters by option validation.
- It is never placed in payment-session `data`, logs, error messages, or browser
  bundles.
- Rotate in Zoho and Medusa together. In-flight events signed with the old key fail
  closed until both sides use the new key.
- If rotation must overlap, verify against both keys in a custom route during the
  transition; the built-in provider accepts one configured key at a time.

## 8. Related documentation

- [Webhooks](./webhooks.md)
- [Storefront widget](./storefront-widget.md)
- [Hosted checkout](./storefront-hosted.md)
- [ADR-0007: signature verification](./decisions/ADR-0007-signature-verification.md)
- [Zoho webhook verification](https://www.zoho.com/us/payments/developerdocs/webhooks/verification/)
- [Zoho signature verification](https://www.zoho.com/us/payments/developerdocs/signature-verification/)

// Illustrative Medusa v2 configuration for the Zoho Payments provider.
//
// This file is not compiled, linted, or published. Merge the payment module entry into
// your application's existing medusa-config.ts and keep your own projectConfig, CORS,
// JWT, cookie, Redis, and other module settings.
//
// The `resolve` value is the package's provider-loader subpath. The package root is the
// server-side API surface and does not default-export the ModuleProvider.

import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Empty env values are common when copying .env.example. Treat them as absent so the
// option validator sees `undefined` instead of an invalid empty string.
function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

// India is the default. Set ZOHO_PAYMENTS_REGION=us only when the account, OAuth client,
// and data centre all belong to the US region.
const region = process.env.ZOHO_PAYMENTS_REGION === "us" ? "us" : "in"

// The embedded Checkout Widget is the default. Set ZOHO_PAYMENTS_CHECKOUT_MODE=hosted
// to use Zoho Hosted Checkout instead.
const checkoutMode =
  process.env.ZOHO_PAYMENTS_CHECKOUT_MODE === "hosted" ? "hosted" : "widget"

const environment =
  process.env.ZOHO_PAYMENTS_ENVIRONMENT === "sandbox" ? "sandbox" : "live"

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
  },
  modules: [
    // ...your existing modules
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-zoho/providers/zoho",
            id: "zoho",
            options: {
              // Required OAuth credentials. Server-only: never expose these to the
              // storefront or commit real values.
              accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID,
              clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID,
              clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
              refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN,

              // Developer Space signing key for webhooks, widget responses, and hosted
              // return URLs. Without it, webhook verification fails closed.
              signingKey: optionalEnv("ZOHO_PAYMENTS_SIGNING_KEY"),

              // Publishable browser key. Required for widget mode; it is safe to send
              // to the browser, unlike the OAuth credentials above.
              apiKey: optionalEnv("ZOHO_PAYMENTS_API_KEY"),

              region,
              environment,
              checkoutMode,

              // Required for hosted mode; ignored by the widget. Must be HTTPS outside
              // localhost. Point them at your own return routes.
              successUrl: optionalEnv("ZOHO_PAYMENTS_SUCCESS_URL"),
              failureUrl: optionalEnv("ZOHO_PAYMENTS_FAILURE_URL"),

              // Optional tuning. The provider formats amounts with ISO currency
              // precision.
              // allowedPaymentMethods: ["card", "upi"],
              // paymentDescription: "Medusa order payment",
              // liveMode: process.env.ZOHO_PAYMENTS_LIVE_MODE === "true",
              // timeoutMs: 15_000,
              // maxRetries: 3,
              // pollAttempts: 3,
              // pollIntervalMs: 500,
              // webhookToleranceSeconds: 0,
            },
          },

          // Hosted-checkout variant. Use this instead of the widget entry above when
          // the storefront cannot load a third-party script. Keep the same `id` so the
          // stored provider ID remains `pp_zoho_zoho`.
          //
          // {
          //   resolve: "medusa-payment-zoho/providers/zoho",
          //   id: "zoho",
          //   options: {
          //     accountId: process.env.ZOHO_PAYMENTS_ACCOUNT_ID,
          //     clientId: process.env.ZOHO_PAYMENTS_CLIENT_ID,
          //     clientSecret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
          //     refreshToken: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN,
          //     signingKey: optionalEnv("ZOHO_PAYMENTS_SIGNING_KEY"),
          //     region,
          //     checkoutMode: "hosted",
          //     successUrl: optionalEnv("ZOHO_PAYMENTS_SUCCESS_URL"),
          //     failureUrl: optionalEnv("ZOHO_PAYMENTS_FAILURE_URL"),
          //   },
          // },
        ],
      },
    },
  ],
})

import { Modules } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import moduleProvider from "../../src/providers/zoho"
import ZohoPaymentProviderService from "../../src/providers/zoho/service"
import { ZohoConfigurationError } from "../../src/core/errors"
import {
  FakeLogger,
  baseOptions,
  createClient,
  createHarness,
} from "../fixtures/providers"

describe("Zoho payment module provider definition", () => {
  it("exposes the Medusa payment module service", () => {
    expect(moduleProvider.module).toBe(Modules.PAYMENT)
    expect(moduleProvider.services).toEqual([ZohoPaymentProviderService])
    expect(moduleProvider.loaders).toBeUndefined()
  })

  it("identifies the provider as zoho", () => {
    const { provider } = createHarness()

    expect(provider.getIdentifier()).toBe("zoho")
    expect(ZohoPaymentProviderService.identifier).toBe("zoho")
    expect(ZohoPaymentProviderService.isPaymentProvider(provider)).toBeTruthy()
  })

  it("validates provider options through the static loader hook", () => {
    expect(() => {
      ZohoPaymentProviderService.validateOptions(
        baseOptions() as unknown as Record<string, unknown>
      )
    }).not.toThrow()

    expect(() => {
      ZohoPaymentProviderService.validateOptions(
        baseOptions({ apiKey: undefined }) as unknown as Record<string, unknown>
      )
    }).toThrow(ZohoConfigurationError)
  })

  it("falls back to the real client, Date.now, and a no-op logger", async () => {
    const provider = new ZohoPaymentProviderService({}, baseOptions())

    const result = await provider.deletePayment({ data: { custom: "keep" } })

    expect(result.data).toEqual({ custom: "keep" })
    expect(provider.getIdentifier()).toBe("zoho")
  })

  it("uses the configured logger when no dependency logger is injected", async () => {
    const logger = new FakeLogger()
    const provider = new ZohoPaymentProviderService({}, baseOptions({ logger }), {
      client: createClient(),
    })

    await provider.deletePayment({ data: {} })

    expect(logger.entries).toEqual([
      {
        level: "debug",
        message: "Deleting local Zoho payment session reference",
        context: undefined,
      },
    ])
  })

  it("adapts Medusa's container logger when no logger option is configured", async () => {
    const logger = new FakeLogger()
    const provider = new ZohoPaymentProviderService({ logger }, baseOptions(), {
      client: createClient(),
    })

    await provider.deletePayment({ data: {} })

    expect(
      logger.entries.some(
        (entry) =>
          entry.level === "debug" &&
          entry.message === "Deleting local Zoho payment session reference"
      )
    ).toBe(true)
  })
})

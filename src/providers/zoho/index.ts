import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import ZohoPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [ZohoPaymentProviderService],
})

export type {
  ResolvedZohoPaymentOptions,
  ZohoPaymentOptions,
  ZohoPaymentProviderDependencies,
  ZohoPaymentsClientLike,
  ZohoRegionConfig,
} from "./types"
export type { ZohoEnvironment, ZohoRegion } from "../../types"

/**
 * Billing — App Store 订阅 (经 RevenueCat) 的客户端入口.
 *
 *   useBilling      — store (init / refresh / identify / reset)
 *   useIsPro        — 门禁: 是否已订阅, 受限功能 / paywall 用
 *   useEntitlement  — 完整 entitlement (到期日 / 是否续订), 用于 "管理订阅" 展示
 *   getCurrentOffering / purchase / restore — paywall 动作
 */
import { useBilling, type Entitlement } from "./store";

export { useBilling } from "./store";
export type { Entitlement } from "./store";
export { getCurrentOffering, purchase, restore, type PurchaseResult } from "./purchases";
export { ENTITLEMENT_ID, billingEnabled } from "./config";
export {
  presentPaywall,
  presentPaywallIfNeeded,
  presentCustomerCenter,
  PaywallView,
  PAYWALL_RESULT,
} from "./ui";

/** 是否已订阅. 受限功能直接 `if (!useIsPro()) <Paywall/>`. */
export function useIsPro(): boolean {
  return useBilling((s) => s.entitlement.isPro);
}

/** 完整 entitlement —— 给 "管理订阅" 页展示到期 / 续订状态. */
export function useEntitlement(): Entitlement {
  return useBilling((s) => s.entitlement);
}

/**
 * 购买动作 —— paywall UI 调这些. 成功后主动 refresh 一次让门禁即时放行;
 * store 的 customerInfo listener 也会兜底同步状态.
 */
import Purchases, { type PurchasesOffering, type PurchasesPackage } from "react-native-purchases";

import { useBilling } from "./store";
import { billingEnabled } from "./config";

/** 当前 offering (一组可选套餐). 没配 RevenueCat 时返回 null, paywall 自行隐藏. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!billingEnabled) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

export interface PurchaseResult {
  ok: boolean;
  /** 用户主动取消 —— 不是错误, UI 静默收起即可, 不弹报错. */
  cancelled: boolean;
}

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    await Purchases.purchasePackage(pkg);
    await useBilling.getState().refresh();
    return { ok: true, cancelled: false };
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) {
      return { ok: false, cancelled: true };
    }
    console.warn("[billing] purchase failed:", e);
    return { ok: false, cancelled: false };
  }
}

/** 恢复购买 (审核强制要求有此入口). 返回是否恢复出任一有效 entitlement. */
export async function restore(): Promise<boolean> {
  try {
    const info = await Purchases.restorePurchases();
    await useBilling.getState().refresh();
    return Object.keys(info.entitlements.active).length > 0;
  } catch (err) {
    console.warn("[billing] restore failed:", err);
    return false;
  }
}

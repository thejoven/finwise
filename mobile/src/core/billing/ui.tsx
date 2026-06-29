/**
 * RevenueCat 托管 UI (react-native-purchases-ui) 封装.
 *
 *   presentPaywall          — 弹官方 Paywall (远端配置, 改价 / 换样式不发版)
 *   presentPaywallIfNeeded  — 仅当用户还没有 entitlement 时才弹 (门禁首选)
 *   presentCustomerCenter   — 官方"管理订阅"中心 (取消 / 退款 / 恢复购买)
 *   <PaywallView>           — 需要内嵌成一整屏而非弹窗时用
 *
 * 全是原生模块 → 需 prebuild + 重新出 dev client 才能跑.
 */
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";

import { ENTITLEMENT_ID, billingEnabled } from "./config";
import { useBilling } from "./store";

export { PAYWALL_RESULT };

// Paywall 弹窗里完成的购买/恢复, store 的 customerInfo listener 也会兜底同步;
// 这里主动 refresh 一次让门禁即时放行.
async function refreshAfter(result: PAYWALL_RESULT): Promise<PAYWALL_RESULT> {
  if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
    await useBilling.getState().refresh();
  }
  return result;
}

/** 弹官方 Paywall (用 current offering). 没配 key 时返回 NOT_PRESENTED. */
export async function presentPaywall(): Promise<PAYWALL_RESULT> {
  if (!billingEnabled) return PAYWALL_RESULT.NOT_PRESENTED;
  return refreshAfter(await RevenueCatUI.presentPaywall());
}

/** 仅当用户还没有该 entitlement 时才弹 Paywall —— 受限功能的门禁首选. */
export async function presentPaywallIfNeeded(): Promise<PAYWALL_RESULT> {
  if (!billingEnabled) return PAYWALL_RESULT.NOT_PRESENTED;
  return refreshAfter(
    await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENT_ID,
    }),
  );
}

/** 打开官方 Customer Center (管理 / 取消 / 退款 / 恢复订阅). 给"我的"页的"管理订阅"按钮用. */
export async function presentCustomerCenter(): Promise<void> {
  if (!billingEnabled) return;
  await RevenueCatUI.presentCustomerCenter();
}

/** 内嵌式整屏 Paywall —— 放进一个 route 即成订阅页 (替代弹窗). */
export function PaywallView({ onDismiss }: { onDismiss?: () => void }) {
  const refresh = useBilling((s) => s.refresh);
  return (
    <RevenueCatUI.Paywall
      onPurchaseCompleted={() => {
        void refresh();
      }}
      onRestoreCompleted={() => {
        void refresh();
      }}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Billing store — App 内购 (App Store 订阅) 的客户端真相缓存.
 *
 * 真相源是 RevenueCat: configure 后 SDK 持有 customerInfo, 我们订阅它的更新, 把
 * "entitlement 是否 active" 投影到这个 store 给 UI 用. 内网阶段后端还没接 webhook,
 * 客户端直接信 RevenueCat; 等公网后端 /v1/me 下发 entitlement 后改以后端为准
 * (见 server/internal/module/billing).
 *
 * 与 auth 的关系: billing 订阅 useAuth 的 user 变化 —— 登录 logIn(user.id), 登出
 * logOut(), 让 RevenueCat 的 appUserID 跟我们自己的 user id 对齐 (跨设备 / 重装能恢复).
 * auth 不反向依赖 billing (无环).
 */
import { create } from "zustand";
import Purchases, { LOG_LEVEL, type CustomerInfo } from "react-native-purchases";

import { useAuth } from "@/core/auth/store";
import { REVENUECAT_API_KEY, ENTITLEMENT_ID, billingEnabled } from "./config";

export interface Entitlement {
  isPro: boolean;
  expiresAt: string | null;
  productId: string | null;
  willRenew: boolean;
}

const NO_ENTITLEMENT: Entitlement = {
  isPro: false,
  expiresAt: null,
  productId: null,
  willRenew: false,
};

function project(info: CustomerInfo): Entitlement {
  const ent = info.entitlements.active[ENTITLEMENT_ID];
  if (!ent) return NO_ENTITLEMENT;
  return {
    isPro: true,
    expiresAt: ent.expirationDate ?? null,
    productId: ent.productIdentifier ?? null,
    willRenew: ent.willRenew,
  };
}

interface BillingState {
  ready: boolean; // configure 完成, 或确定不可用
  entitlement: Entitlement;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 登录成功后对齐 RevenueCat 身份 (init 的 auth 订阅也会兜底). */
  identify: (userId: string) => Promise<void>;
  /** 登出: 切回匿名身份, 清掉本地 entitlement. */
  reset: () => Promise<void>;
}

// configure 只能调一次 / 进程级; auth 订阅也只挂一次. 放模块作用域, 不进 store state.
let configured = false;
let unsubAuth: (() => void) | null = null;

export const useBilling = create<BillingState>((set, get) => ({
  ready: false,
  entitlement: NO_ENTITLEMENT,

  init: async () => {
    if (!billingEnabled || configured) {
      set({ ready: true });
      return;
    }
    try {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);

      // 已登录就直接拿 user id 当 appUserID (避免先建匿名 id 再迁移).
      const user = useAuth.getState().user;
      Purchases.configure({ apiKey: REVENUECAT_API_KEY!, appUserID: user?.id ?? null });
      configured = true;

      // 续订 / 退款 / 跨端变化都会推到这个 listener.
      Purchases.addCustomerInfoUpdateListener((info) => {
        set({ entitlement: project(info) });
      });

      // 跟随登录态: 登录 logIn, 登出 logOut. 只订阅一次.
      unsubAuth ??= useAuth.subscribe((s, prev) => {
        if (s.user?.id === prev.user?.id) return;
        if (s.user) void get().identify(s.user.id);
        else void get().reset();
      });

      const info = await Purchases.getCustomerInfo();
      set({ entitlement: project(info), ready: true });
    } catch (err) {
      console.warn("[billing] init failed:", err);
      set({ ready: true });
    }
  },

  refresh: async () => {
    if (!configured) return;
    try {
      const info = await Purchases.getCustomerInfo();
      set({ entitlement: project(info) });
    } catch (err) {
      console.warn("[billing] refresh failed:", err);
    }
  },

  identify: async (userId) => {
    if (!configured) return;
    try {
      const { customerInfo } = await Purchases.logIn(userId);
      set({ entitlement: project(customerInfo) });
    } catch (err) {
      console.warn("[billing] identify failed:", err);
    }
  },

  reset: async () => {
    if (!configured) return;
    try {
      await Purchases.logOut();
    } catch {
      // 当前已是匿名身份时 logOut 会抛 —— 无所谓.
    }
    set({ entitlement: NO_ENTITLEMENT });
  },
}));

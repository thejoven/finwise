/**
 * RevenueCat / App 内购配置.
 *
 * - API key 是 RevenueCat 控制台 "Public app-specific" 的 iOS key
 *   (Project → API keys → App, 形如 appl_xxx). 它是 public 的, 可以进客户端 bundle,
 *   不是 secret; 通过 EXPO_PUBLIC_ 前缀让 Expo 在构建期注入 (见 eas.json env).
 * - ENTITLEMENT_ID 是 RevenueCat 里配的 entitlement 标识 (Project → Entitlements),
 *   代表 "已订阅" 这个能力. 默认 "AplhaX Pro" (须与控制台 identifier 完全一致, 不是显示名).
 *   product id 不在这里硬编码 —— 它由 RevenueCat
 *   offerings 动态下发, 客户端只认 entitlement, 改价 / 换套餐不用发版.
 *
 * 没配 key (本地未接 RevenueCat) → billing 整体降级为 "未订阅", 不报错, 方便无 key 调试.
 */
import { Platform } from "react-native";

export const REVENUECAT_API_KEY =
  Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  }) ?? null;

export const ENTITLEMENT_ID = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? "AplhaX Pro";

/** 没配 key 时为 false —— 全链路安全降级到 "未订阅". */
export const billingEnabled = REVENUECAT_API_KEY != null;

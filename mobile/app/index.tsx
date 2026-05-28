import { Redirect } from "expo-router";

import { useAuth } from "@/core/auth/store";

/**
 * App 主页 / root entry + auth gate.
 *
 * Expo Router 把 `/` 路径解析到这个文件. 这里基于 auth store:
 *   - 没 token (且没 dev fallback) → 跳 /login
 *   - 有 token → 跳 /(tabs)/inbox
 *
 * dev fallback: 如果 .env 里设了 EXPO_PUBLIC_DEV_BEARER_TOKEN, 当没登录时也
 * 让用户直接进 inbox — 这条主要给单用户调试模式. 真要走 login, 把 env 清掉.
 *
 * _layout.tsx 已经 await hydrate, 所以这里 useAuth() 拿到的就是最终状态.
 */
export default function Index() {
  const token = useAuth((s) => s.token);
  const hasDevFallback = (process.env.EXPO_PUBLIC_DEV_BEARER_TOKEN ?? "") !== "";

  if (!token && !hasDevFallback) {
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/inbox" />;
}

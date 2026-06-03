import { Redirect } from "expo-router";

import { useAuth } from "@/core/auth/store";
import { getDevBearer } from "@/core/auth/devBearer";

/**
 * App 主页 / root entry + auth gate.
 *
 * Expo Router 把 `/` 路径解析到这个文件. 这里基于 auth store:
 *   - 没 token → 跳 /login
 *   - 有 token → 跳 /(tabs)/inbox
 *
 * dev fallback (默认关闭): 只有显式开了 EXPO_PUBLIC_DEV_AUTOLOGIN 才会用
 * dev bearer 直接进 inbox — 给单用户调试模式. 详见 @/core/auth/devBearer.
 *
 * _layout.tsx 已经 await hydrate, 所以这里 useAuth() 拿到的就是最终状态.
 */
export default function Index() {
  const token = useAuth((s) => s.token);

  if (!token && !getDevBearer()) {
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/inbox" />;
}

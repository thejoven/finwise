/**
 * AppState hook — 监听 App 是否在前台.
 *
 * iOS 上从后台切回前台, JS runtime 一直活着但定时器可能漂移, 网络可能换网.
 * 我们用这个事件触发 sync queue 重扫: "用户回来了, 看看有没有失败的要重发".
 */

import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function useAppState(): AppStateStatus {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setState(next));
    return () => sub.remove();
  }, []);

  return state;
}

function useAppActive(): boolean {
  return useAppState() === "active";
}

/**
 * NetInfo hook — 监听网络是否可达.
 *
 * 用 isInternetReachable 而非 isConnected, 因为 iOS 在 captive portal 或 DNS
 * 不通时 isConnected=true 但 reachable=false. 我们要的是后者.
 *
 * `null` 是 "还没拿到第一个 update" 的初值, 调用方按 falsy 处理即可.
 */

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export type Reachability = boolean | null;

export function useIsReachable(): Reachability {
  const [reachable, setReachable] = useState<Reachability>(null);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      setReachable(deriveReachability(state));
    });
    NetInfo.fetch().then((state) => setReachable(deriveReachability(state)));
    return () => unsub();
  }, []);

  return reachable;
}

function deriveReachability(state: NetInfoState): Reachability {
  if (state.isInternetReachable === null) return null;
  return state.isInternetReachable;
}

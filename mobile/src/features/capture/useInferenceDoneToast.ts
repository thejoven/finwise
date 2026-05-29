/**
 * useInferenceDoneToast — 监测 signal 列表, 某条 inference_status 从 pending
 * 变 done 时弹一条 toast.
 *
 * 用法: 在 inbox 屏调一次 useInferenceDoneToast(signals). signals 是已经
 * react-query 拉回来的列表; data 变化时 hook 会比较前后 status map.
 *
 * 首次 mount 不弹 toast — 只填充 baseline map, 之后变化才触发. 这避免冷启动
 * 时把所有历史 done 信号都喊一遍.
 */

import { useEffect, useRef } from "react";

import { notify } from "@/shared/toast";

interface SignalLike {
  id: string;
  inference_status: string;
  inference_summary?: string | null;
  raw_text?: string;
}

export function useInferenceDoneToast(signals: SignalLike[]) {
  const lastStatusMap = useRef<Map<string, string>>(new Map());
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      // 首次 mount: 不弹 toast, 只记 baseline
      const baseline = new Map<string, string>();
      for (const s of signals) baseline.set(s.id, s.inference_status);
      lastStatusMap.current = baseline;
      mounted.current = true;
      return;
    }

    // 检测 pending → done 跃迁
    for (const s of signals) {
      const prev = lastStatusMap.current.get(s.id);
      if (s.inference_status === "done" && prev === "pending") {
        const preview =
          (s.inference_summary && s.inference_summary.slice(0, 40)) ||
          (s.raw_text && s.raw_text.slice(0, 40)) ||
          "你的信号已推演完成";
        notify({
          type: "inference_done",
          stamp: "AI 推演完成",
          title: preview,
          subtitle: "点开看完整推演 ↗",
          href: `/signal/${s.id}`,
        });
      }
    }

    // 更新 baseline
    const next = new Map<string, string>();
    for (const s of signals) next.set(s.id, s.inference_status);
    lastStatusMap.current = next;
  }, [signals]);
}

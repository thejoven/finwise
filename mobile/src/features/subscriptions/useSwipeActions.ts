/**
 * useSwipeActions — 撤销窗口队列 (开发文档 §3 硬四 / §4.3).
 *
 * 滑动只做乐观 UI; 真正的服务端动作延迟 delayMs 再提交, 窗口内可撤销 ——
 * 三个方向 (已读 / 转信号 / 不感兴趣) 统一拿到撤销, 零反向端点 (不用写 unread / 删信号).
 * 连续滑动: 上一条还在窗口里就先落地, 再排新的 (按顺序提交).
 * 切走 / 卸载时 flush 兜底, 不丢动作.
 *
 * onNotInterested 可空 —— P0 阶段后端端点未上 (见开发文档 §8), 下滑只在前端隐藏占位.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TweetItem } from "@/core/api/subscriptions";

export type SwipeDir = "left" | "right" | "down" | "up";

export interface PendingSwipe {
  tweet: TweetItem;
  dir: SwipeDir;
}

interface Options {
  delayMs?: number;
  onRead: (id: string) => void;
  onPromote: (id: string) => void;
  onNotInterested?: (id: string) => void;
  onSaveLater?: (id: string) => void;
}

export function useSwipeActions({
  delayMs = 2600,
  onRead,
  onPromote,
  onNotInterested,
  onSaveLater,
}: Options) {
  const [pending, setPending] = useState<PendingSwipe | null>(null);
  const pendingRef = useRef<PendingSwipe | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback(
    (p: PendingSwipe) => {
      if (p.dir === "left") onRead(p.tweet.id);
      else if (p.dir === "right") onPromote(p.tweet.id);
      else if (p.dir === "up") onSaveLater?.(p.tweet.id);
      else onNotInterested?.(p.tweet.id);
    },
    [onRead, onPromote, onNotInterested, onSaveLater],
  );

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(
    (tweet: TweetItem, dir: SwipeDir) => {
      const prev = pendingRef.current;
      if (prev) fire(prev); // 上一条立即落地
      clearTimer();
      const next: PendingSwipe = { tweet, dir };
      pendingRef.current = next;
      setPending(next);
      timer.current = setTimeout(() => {
        fire(next);
        pendingRef.current = null;
        timer.current = null;
        setPending(null);
      }, delayMs);
    },
    [fire, delayMs],
  );

  /** 取消窗口内的待提交动作, 返回它 (调用方据此把卡片弹回). */
  const undo = useCallback(() => {
    const p = pendingRef.current;
    clearTimer();
    pendingRef.current = null;
    setPending(null);
    return p;
  }, []);

  /** 立即提交待办 (切 tab / 退出前调用). */
  const flush = useCallback(() => {
    const p = pendingRef.current;
    if (p) fire(p);
    clearTimer();
    pendingRef.current = null;
    setPending(null);
  }, [fire]);

  useEffect(
    () => () => {
      // 卸载兜底: 没提交的动作落地, 不丢.
      const p = pendingRef.current;
      if (p) fire(p);
      clearTimer();
    },
    [fire],
  );

  return { pending, run, undo, flush };
}

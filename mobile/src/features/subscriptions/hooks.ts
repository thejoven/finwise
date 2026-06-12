/**
 * React Query hooks for 订阅 tab.
 *
 * - useTweetFeed: 无限滚动 (复合游标); 有分类 pending 时 10s 轮询等 AI 回填, 全 done 停.
 * - useUnreadTweetCount: tab 红点 + 刊头计数. 60s 慢轮询.
 * - useMarkTweetRead: 乐观更新 — 行立即变已读态, 红点随 invalidate 刷新.
 * - useSubscribe/useUnsubscribe/useResolveHandle: 管理页.
 * - usePromoteTweet: 转为信号 (幂等).
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import {
  getTweet,
  getUnreadCount,
  listSubscriptions,
  listTweets,
  markAllTweetsRead,
  markTweetRead,
  promoteTweet,
  resolveHandle,
  subscribe,
  unsubscribe,
  type TweetFeed,
  type TweetItem,
} from "@/core/api/subscriptions";

const TWEETS_KEY = ["tweets"] as const;
const SUBS_KEY = ["subscriptions"] as const;
const CLASSIFY_POLL_MS = 10_000;

export function useSubscriptions() {
  return useQuery({
    queryKey: SUBS_KEY,
    queryFn: listSubscriptions,
    refetchOnMount: true,
  });
}

export function useTweetFeed(filter: "unread" | "all", subscriptionId?: string) {
  return useInfiniteQuery({
    queryKey: [...TWEETS_KEY, "feed", filter, subscriptionId ?? "all"],
    queryFn: ({ pageParam }) =>
      listTweets({ filter, subscription_id: subscriptionId, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more && last.next_cursor ? last.next_cursor : undefined),
    // 自适应轮询: 仅当页里还有 AI 没读完的推文时, 等回填; 全 done 停, 省电.
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (!pages) return false;
      const pending = pages.some((p) => p.items.some((t) => t.classify_status === "pending"));
      return pending ? CLASSIFY_POLL_MS : false;
    },
    refetchOnMount: true,
  });
}

export function useUnreadTweetCount() {
  return useQuery({
    queryKey: [...TWEETS_KEY, "unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 60_000,
    retry: 0, // 未登录/离线时静默失败, 红点不显示即可
  });
}

export function useTweetDetail(id: string | undefined) {
  return useQuery({
    queryKey: [...TWEETS_KEY, "detail", id],
    queryFn: () => getTweet(id!),
    enabled: !!id,
  });
}

/** feed 缓存里把某条标成已读 (乐观更新的共享 helper). */
function markReadInCache(
  data: InfiniteData<TweetFeed> | undefined,
  tweetId: string,
): InfiniteData<TweetFeed> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((it) => (it.id === tweetId ? { ...it, read: true } : it)),
    })),
  };
}

export function useMarkTweetRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tweetId: string) => markTweetRead(tweetId),
    onMutate: (tweetId) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ queryKey: [...TWEETS_KEY, "feed"] }, (old) =>
        markReadInCache(old, tweetId),
      );
      qc.setQueryData<TweetItem>([...TWEETS_KEY, "detail", tweetId], (old) =>
        old ? { ...old, read: true } : old,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...TWEETS_KEY, "unread-count"] });
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId?: string) => markAllTweetsRead(subscriptionId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: TWEETS_KEY });
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
    },
  });
}

export function useResolveHandle() {
  return useMutation({ mutationFn: (handle: string) => resolveHandle(handle) });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => subscribe(handle),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      void qc.invalidateQueries({ queryKey: TWEETS_KEY });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unsubscribe(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      void qc.invalidateQueries({ queryKey: TWEETS_KEY });
    },
  });
}

export function usePromoteTweet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => promoteTweet(id, note),
    onSuccess: () => {
      // 信箱列表多了一条 — 让 signals 缓存过期
      void qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

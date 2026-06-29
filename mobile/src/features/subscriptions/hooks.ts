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
  getMutedTags,
  getTweet,
  getUnreadCount,
  listSubscriptions,
  listTweets,
  markAllTweetsRead,
  markTweetRead,
  notInterested,
  promoteTweet,
  resolveHandle,
  saveTweet,
  subscribe,
  unmuteTag,
  unsaveTweet,
  unsubscribe,
  type TweetFeed,
  type TweetItem,
} from "@/core/api/subscriptions";

const TWEETS_KEY = ["tweets"] as const;
const SUBS_KEY = ["subscriptions"] as const;
const CLASSIFY_POLL_MS = 10_000;

/**
 * 浏览 feed (未读/全部) 的 query key 判定 — 排除稍后读 bucket ["tweets","feed","saved"].
 * 上滑「稍后读」/「不感兴趣」的乐观 removeFromCache 只该动浏览 feed; 若用前缀模糊匹配
 * ["tweets","feed"] 会连 saved 一起命中, 把刚存的那条从稍后读缓存里删掉 → saved 页空列表回归.
 */
const isBrowsingFeed = (key: readonly unknown[]) =>
  key[0] === "tweets" && key[1] === "feed" && key[2] !== "saved";

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

/** feed 缓存里彻底移除某条 (不感兴趣 = 隐藏, 比已读更强). */
function removeFromCache(
  data: InfiniteData<TweetFeed> | undefined,
  tweetId: string,
): InfiniteData<TweetFeed> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.filter((it) => it.id !== tweetId),
    })),
  };
}

export function useMarkTweetRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tweetId: string) => markTweetRead(tweetId),
    onMutate: (tweetId) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ predicate: (q) => isBrowsingFeed(q.queryKey) }, (old) =>
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

/** 不感兴趣 — 乐观从 feed 缓存移除 (隐藏); 红点/账号未读随 invalidate 刷新. */
export function useNotInterested() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tweetId: string) => notInterested(tweetId),
    onMutate: (tweetId) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ predicate: (q) => isBrowsingFeed(q.queryKey) }, (old) =>
        removeFromCache(old, tweetId),
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
    // 转信号 = 这条已处理过 → 顺手标已读 (与后端 Promote 的"顺手记已读"一致),
    // 否则未读红点/账号未读不随之下降 (要等 60s 轮询才追上).
    onMutate: ({ id }) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ predicate: (q) => isBrowsingFeed(q.queryKey) }, (old) =>
        markReadInCache(old, id),
      );
      qc.setQueryData<TweetItem>([...TWEETS_KEY, "detail", id], (old) =>
        old ? { ...old, read: true } : old,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...TWEETS_KEY, "unread-count"] });
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      // 信箱列表多了一条 — 让 signals 缓存过期
      void qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

const SAVED_FEED_KEY = [...TWEETS_KEY, "feed", "saved"] as const;
const MUTED_KEY = ["content-prefs", "muted"] as const;

/** 稍后读 — 乐观从未读 feed 移除 (save = 标记已读 + 存 bucket). */
export function useSaveTweet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tweetId: string) => saveTweet(tweetId),
    onMutate: (tweetId) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ predicate: (q) => isBrowsingFeed(q.queryKey) }, (old) =>
        removeFromCache(old, tweetId),
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...TWEETS_KEY, "unread-count"] });
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      void qc.invalidateQueries({ queryKey: SAVED_FEED_KEY });
    },
  });
}

/** 稍后读列表 (无限滚动). */
export function useSavedTweets() {
  return useInfiniteQuery({
    queryKey: SAVED_FEED_KEY,
    queryFn: ({ pageParam }) => listTweets({ filter: "saved", cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more && last.next_cursor ? last.next_cursor : undefined),
    refetchOnMount: true,
  });
}

/** 取消稍后读 — 乐观从稍后读列表移除. */
export function useUnsaveTweet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tweetId: string) => unsaveTweet(tweetId),
    onMutate: (tweetId) => {
      qc.setQueriesData<InfiniteData<TweetFeed>>({ queryKey: SAVED_FEED_KEY }, (old) =>
        removeFromCache(old, tweetId),
      );
    },
  });
}

/** 内容偏好: 已静音标签. */
export function useMutedTags() {
  return useQuery({ queryKey: MUTED_KEY, queryFn: getMutedTags });
}

/** 取消静音 — 解后相关推文回归 feed. */
export function useUnmuteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => unmuteTag(tag),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MUTED_KEY });
      void qc.invalidateQueries({ queryKey: TWEETS_KEY });
    },
  });
}

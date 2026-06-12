/**
 * Typed wrappers around /v1/subscriptions + /v1/tweets (订阅模块).
 * zod 在边界校验 — 坏响应在 parse 处报错带路径, 不在组件深处炸.
 *
 * 概念分层 (规格 §8.0): source_type (v1 只有 twitter) → 订阅项 (账号) → 内容项 (推文).
 * 已读/标签/总结/转信号是跨类型统一的「四件套」.
 */

import { z } from "zod";
import { api } from "./client";

// ───────────────────── 订阅 ─────────────────────

export const SubscriptionItem = z.object({
  id: z.string().uuid(),
  source_type: z.string(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string(),
  bio: z.string().optional(),
  status: z.string(), // active | suspended | not_found
  unread_count: z.number(),
  last_polled_at: z.string().nullable().optional(),
  created_at: z.string(),
});
export type SubscriptionItem = z.infer<typeof SubscriptionItem>;

const SubscriptionList = z.object({
  items: z.array(SubscriptionItem),
  limit: z.number(),
});
export type SubscriptionList = z.infer<typeof SubscriptionList>;

export async function listSubscriptions(): Promise<SubscriptionList> {
  const json = await api.get("v1/subscriptions").json();
  return SubscriptionList.parse(json);
}

/** 解析预览 (不建订阅) — 管理页第 2 步, 让用户确认"是这个人"再订. */
export const ResolvedAccount = z.object({
  rest_id: z.string(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string(),
  bio: z.string().optional(),
});
export type ResolvedAccount = z.infer<typeof ResolvedAccount>;

export async function resolveHandle(handle: string): Promise<ResolvedAccount> {
  const json = await api.get("v1/subscriptions/resolve", { searchParams: { handle } }).json();
  return ResolvedAccount.parse(json);
}

export async function subscribe(handle: string): Promise<SubscriptionItem> {
  const json = await api
    .post("v1/subscriptions", { json: { source_type: "twitter", handle } })
    .json();
  return SubscriptionItem.parse(json);
}

export async function unsubscribe(id: string): Promise<void> {
  await api.delete(`v1/subscriptions/${id}`);
}

// ───────────────────── 推文 ─────────────────────

const TweetMedia = z.object({
  type: z.string(), // photo | video | animated_gif
  url: z.string(),
  thumb: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type TweetMedia = z.infer<typeof TweetMedia>;

export const TweetItem = z.object({
  id: z.string(),
  subscription_id: z.string(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: z.string(),
  text: z.string(),
  lang: z.string().optional(),
  tweet_created_at: z.string(),
  is_retweet: z.boolean(),
  is_quote: z.boolean(),
  media: z.array(TweetMedia).nullable().optional(),
  metrics: z
    .object({
      likes: z.number().optional(),
      retweets: z.number().optional(),
      replies: z.number().optional(),
      quotes: z.number().optional(),
      bookmarks: z.number().optional(),
      views: z.number().optional(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).nullable().optional(),
  summary: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  relevance: z.number().nullable().optional(),
  classify_status: z.enum(["pending", "done", "failed"]),
  read: z.boolean(),
});
export type TweetItem = z.infer<typeof TweetItem>;

const TweetFeed = z.object({
  items: z.array(TweetItem),
  next_cursor: z.string(),
  has_more: z.boolean(),
});
export type TweetFeed = z.infer<typeof TweetFeed>;

export interface FeedQuery {
  filter: "unread" | "all";
  subscription_id?: string;
  cursor?: string;
  limit?: number;
}

export async function listTweets(q: FeedQuery): Promise<TweetFeed> {
  const searchParams: Record<string, string> = { filter: q.filter };
  if (q.subscription_id) searchParams.subscription_id = q.subscription_id;
  if (q.cursor) searchParams.cursor = q.cursor;
  if (q.limit != null) searchParams.limit = String(q.limit);
  const json = await api.get("v1/tweets", { searchParams }).json();
  return TweetFeed.parse(json);
}

export async function getTweet(id: string): Promise<TweetItem> {
  const json = await api.get(`v1/tweets/${id}`).json();
  return TweetItem.parse(json);
}

export async function markTweetRead(id: string): Promise<void> {
  await api.post(`v1/tweets/${id}/read`);
}

export async function markAllTweetsRead(subscriptionId?: string): Promise<number> {
  const body = subscriptionId ? { subscription_id: subscriptionId } : {};
  const json = await api.post("v1/tweets/read-all", { json: body }).json();
  return z.object({ marked: z.number() }).parse(json).marked;
}

export async function getUnreadCount(): Promise<number> {
  const json = await api.get("v1/tweets/unread-count").json();
  return z.object({ unread: z.number() }).parse(json).unread;
}

const PromoteResp = z.object({
  signal_id: z.string().uuid(),
  duplicate: z.boolean(),
});
export type PromoteResp = z.infer<typeof PromoteResp>;

/** 转为信号 — 幂等 (同推文重复转返回同一 signal_id, duplicate=true). */
export async function promoteTweet(id: string, note?: string): Promise<PromoteResp> {
  const json = await api.post(`v1/tweets/${id}/promote`, { json: { note: note ?? "" } }).json();
  return PromoteResp.parse(json);
}

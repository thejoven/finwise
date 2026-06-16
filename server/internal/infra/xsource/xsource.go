// Package xsource 是 X/Twitter 数据源的中立抽象层.
//
// 订阅模块只认这里的 Provider 接口与领域类型 (Account/Tweet/...), 不认具体数据商.
// 不同供应商 (twtapi.com / twitterdata.com / ...) 各自一个 infra 子包实现 Provider:
// 鉴权与信封各异 (twtapi 用 X-API-Key header; twitterdata 用 token query 参数), 但内层
// <TWEET>/user 多为同一套 x.com GraphQL 原始结构, 解析内核基本可复用, 差异只在外层解包.
//
// 加新供应商 = 新建一个实现 Provider 的包 + 在 cmd/api 的 provider 工厂里登记一个分支,
// 订阅模块 (service/repository/poller) 零改动.
package xsource

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// ───────────────────────── 哨兵错误 (Provider 契约的一部分) ─────────────────────────

// 跨供应商统一语义: 实现方把各自的 HTTP/业务错误归一到这几类, 消费方 (subscription)
// 只 errors.Is 这里的值, 不感知具体数据商的状态码/错误体.
var (
	// ErrNotConfigured — 凭证缺失. poller 不启动, REST 读历史照常 (优雅降级).
	ErrNotConfigured = errors.New("xsource: provider not configured")
	// ErrQuotaExceeded — 配额/余额耗尽. poller 收到即全局暂停, 别空转烧钱.
	ErrQuotaExceeded = errors.New("xsource: quota exceeded")
	// ErrRateLimited — 限流. 调用方退避重试.
	ErrRateLimited = errors.New("xsource: rate limited")
	// ErrNotFound — 账号/推文不存在或受保护.
	ErrNotFound = errors.New("xsource: resource not found")
)

// ───────────────────────── 领域类型 ─────────────────────────

// Account 是账号资料 (订阅预览卡 + tweet 作者).
type Account struct {
	RestID      string `json:"rest_id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Bio         string `json:"bio,omitempty"`
}

// Media — 推文媒体项. photo: URL=大图; video/animated_gif: URL=最高码率 mp4, Thumb=封面.
type Media struct {
	Type   string `json:"type"`
	URL    string `json:"url"`
	Thumb  string `json:"thumb,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

// Metrics — 互动计数. Views 上游常是 string, 解析成 int64.
type Metrics struct {
	Likes     int   `json:"likes"`
	Retweets  int   `json:"retweets"`
	Replies   int   `json:"replies"`
	Quotes    int   `json:"quotes"`
	Bookmarks int   `json:"bookmarks"`
	Views     int64 `json:"views,omitempty"`
}

// Tweet 是一条推文的供应商无关表示 (各 Provider 把自己的响应解析成它, 再入库).
type Tweet struct {
	ID             string
	Text           string
	Lang           string
	CreatedAt      time.Time
	ConversationID string
	IsRetweet      bool
	IsQuote        bool
	QuotedID       string
	Quoted         *Tweet // 引用原推 (嵌套同构, 只展开一层语义但递归解析)
	Media          []Media
	Metrics        Metrics
	Author         Account
	Raw            json.RawMessage // 原始 payload, 入库 raw_payload 兜底重解析
}

// TweetsPage 是一页推文 + 翻页游标.
type TweetsPage struct {
	Tweets       []Tweet
	BottomCursor string
}

// ───────────────────────── Provider 接口 ─────────────────────────

// Provider 是 X 数据源的统一接口 —— 订阅采集所需的最小操作集.
//
// 刻意只收录消费方 (subscription) 实际跑到的方法: 接口小, 每个实现都被真正验证.
// TweetDetail / Search / Followers 等扩展能力暂不进契约 (YAGNI) —— 具体实现可以先各自
// 带着这些方法, 等出现跨供应商的消费方时再提升进接口.
type Provider interface {
	// IsConfigured — 凭证是否就绪. 缺失时 poller 不启动, REST 仍可读历史.
	IsConfigured() bool
	// LookupAccount — @handle → 账号资料 (含 rest id). 订阅解析预览 + 采集前置.
	LookupAccount(ctx context.Context, handle string) (*Account, error)
	// UserTweets — 账号时间线一页 (cursor 空串取第一页). 增量采集主力.
	UserTweets(ctx context.Context, restID, cursor string) (*TweetsPage, error)
}

// ───────────────────────── 工具 ─────────────────────────

// CompareIDs 按数值比较两个 tweet id (十进制字符串, 长度不同先比长度), 返回 -1/0/1.
// 增量采集的 high-water 判断用 —— id 随时间单调递增是 X 平台不变量, 与具体供应商无关.
func CompareIDs(a, b string) int {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if len(a) != len(b) {
		if len(a) < len(b) {
			return -1
		}
		return 1
	}
	return strings.Compare(a, b)
}

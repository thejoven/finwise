// Package twtapi is the HTTP client for twtapi.com (Twitter/X 数据代理).
//
// 实现 xsource.Provider —— 订阅模块只认 xsource 接口, 不直接依赖本包 (装配在 cmd/api).
//
// 实测行为 (2026-06-09, 样本在 docs/api/samples/twtapi/, 字段映射见
// docs/技术文档/10_推文订阅_开发文档.md §3.3 — 文档站的信封描述不可信, 以实测为准):
//   - UsernameToUserId 直接返 {id, id_str} (无信封)
//   - UserTweets / TweetDetail / UserResultByScreenName 返 {data: ...} 包 x.com GraphQL 原始结构
//   - Search 额外带 twtapi 自加的 _normalized (铺平 tweets[] + next_cursor)
//   - 错误按 HTTP 状态码归一到 xsource.Err*: 402 余额不足 / 429 限流 / 404 不存在
//
// 单条推文 <TWEET> 三端点同构 — parse.go 一份解析器复用, 换端点只换容器解包.
package twtapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"alphax/server/internal/infra/xsource"
)

const defaultBaseURL = "https://api.twtapi.com/api/v1/twitter"

// Client 实现 xsource.Provider.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

var _ xsource.Provider = (*Client)(nil)

func New(apiKey string) *Client {
	return NewWithBaseURL(apiKey, defaultBaseURL)
}

// NewWithBaseURL 给测试 (httptest) 用.
func NewWithBaseURL(apiKey, baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

// IsConfigured — key 缺失时 poller 不启动, REST 读历史数据照常 (与 mastra client 同降级).
func (c *Client) IsConfigured() bool {
	return c != nil && c.apiKey != ""
}

func (c *Client) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	if !c.IsConfigured() {
		return nil, xsource.ErrNotConfigured
	}
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("twtapi %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 单页实测 ~180KB, 4MB 封顶
	if err != nil {
		return nil, fmt.Errorf("twtapi %s read: %w", path, err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusPaymentRequired:
		return nil, xsource.ErrQuotaExceeded
	case http.StatusTooManyRequests:
		return nil, xsource.ErrRateLimited
	case http.StatusNotFound:
		return nil, xsource.ErrNotFound
	default:
		snippet := body
		if len(snippet) > 512 {
			snippet = snippet[:512]
		}
		return nil, fmt.Errorf("twtapi %s: status %d: %s", path, resp.StatusCode, snippet)
	}
}

// LookupAccount 拉账号资料 (GET /UserResultByScreenName) — 订阅时的解析预览卡. [xsource.Provider]
func (c *Client) LookupAccount(ctx context.Context, handle string) (*xsource.Account, error) {
	body, err := c.get(ctx, "/UserResultByScreenName", url.Values{"username": {handle}})
	if err != nil {
		return nil, err
	}
	return ParseAccount(body)
}

// UserTweets 拉账号时间线第一页 (cursor 翻页). 采集主力 — 完整性第一 (产品承诺
// "订阅都读完了"), Search 只作回填/对账备选. [xsource.Provider]
func (c *Client) UserTweets(ctx context.Context, restID, cursor string) (*xsource.TweetsPage, error) {
	q := url.Values{"user_id": {restID}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	body, err := c.get(ctx, "/UserTweets", q)
	if err != nil {
		return nil, err
	}
	return ParseUserTweets(body)
}

// ─────────────── 扩展能力 (暂不在 xsource.Provider 契约内) ───────────────
// 已实测可用且有测试覆盖; 待详情页/对账等跨供应商消费方出现时, 再把所需方法提升进接口.

// UsernameToUserId 解析 @handle → rest id. LookupAccount 已带 rest id, 通常用不上;
// 保留作备选 (只要 id 不要资料的场景). 每账号一次, 调用方缓存到 twitter_accounts.rest_id.
func (c *Client) UsernameToUserId(ctx context.Context, username string) (string, error) {
	body, err := c.get(ctx, "/UsernameToUserId", url.Values{"username": {username}})
	if err != nil {
		return "", err
	}
	var out struct {
		ID    json.Number `json:"id"`
		IDStr string      `json:"id_str"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("twtapi parse UsernameToUserId: %w", err)
	}
	if out.IDStr != "" {
		return out.IDStr, nil
	}
	if s := out.ID.String(); s != "" && s != "0" {
		return s, nil
	}
	return "", fmt.Errorf("twtapi UsernameToUserId: empty id for %q", username)
}

// SearchFrom 搜某 handle 的最新推 (q=from:handle [since:YYYY-MM-DD]).
// 响应走 twtapi 的 _normalized, 好解析但完整性弱 — 只用于初始回填 / 对账.
func (c *Client) SearchFrom(ctx context.Context, handle, since, cursor string) (*xsource.TweetsPage, error) {
	query := "from:" + handle
	if since != "" {
		query += " since:" + since
	}
	q := url.Values{"q": {query}, "type": {"Latest"}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	body, err := c.get(ctx, "/Search", q)
	if err != nil {
		return nil, err
	}
	return ParseSearch(body)
}

// TweetDetail 拉单条推文 (详情页线程展开).
func (c *Client) TweetDetail(ctx context.Context, tweetID string) (*xsource.Tweet, error) {
	body, err := c.get(ctx, "/TweetDetail", url.Values{"tweet_id": {tweetID}})
	if err != nil {
		return nil, err
	}
	return ParseTweetDetail(body)
}

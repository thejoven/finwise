// Package twitterdata 是 pro.twitterdata.com 的 X 数据源客户端 —— xsource.Provider 的第二个实现.
//
// 与 twtapi 的差异:
//   - 鉴权: token 走 query 参数 (?token=XXX), 不是 header.
//   - base URL: https://pro.twitterdata.com; 端点名不同 (UserByScreenName / SearchTimeline / ...).
//   - 取推按 restId (twtapi 用 user_id); 取详情按 restId (twtapi 用 tweet_id); 搜索用 rawQuery.
//
// 状态: 解析已对齐真实样本 (docs/api/samples/twitterdata/, @elonmusk 2026-06-16) 并有 fixture
// 测试; 翻页 cursor 参数名 (?cursor=) 已实测验证. 错误码映射 (402/429/404) 暂照搬 twtapi ——
// 只见过 200, 未遇真实错误响应, 待遇到再核. 内层 <TWEET> 与 twtapi 信封全异、键也有差异
// (views / quoted_status_result), 故各写各的解析, 未共用内核 (见 parse.go 顶部说明).
package twitterdata

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"alphax/server/internal/infra/xsource"
)

const defaultBaseURL = "https://pro.twitterdata.com"

// Client 实现 xsource.Provider.
type Client struct {
	baseURL string
	token   string
	hc      *http.Client
}

var _ xsource.Provider = (*Client)(nil)

func New(token string) *Client {
	return NewWithBaseURL(token, defaultBaseURL)
}

// NewWithBaseURL 给测试 (httptest) 用.
func NewWithBaseURL(token, baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

// IsConfigured — token 缺失时 poller 不启动 (与 twtapi/mastra 同降级).
func (c *Client) IsConfigured() bool {
	return c != nil && c.token != ""
}

// get 把 token 拼进 query, 发 GET, 按 HTTP 状态码归一到 xsource.Err*.
// 注: 状态码语义暂照搬 twtapi (402/429/404); 真实样本到手后须核对 twitterdata 的错误约定
// (有些代理 200 + 错误体, 那样这里要改成读 body 判错).
func (c *Client) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	if !c.IsConfigured() {
		return nil, xsource.ErrNotConfigured
	}
	if q == nil {
		q = url.Values{}
	}
	q.Set("token", c.token)
	u := c.baseURL + path + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("twitterdata %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("twitterdata %s read: %w", path, err)
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
		return nil, fmt.Errorf("twitterdata %s: status %d: %s", path, resp.StatusCode, snippet)
	}
}

// ───────────────────────── xsource.Provider ─────────────────────────

// LookupAccount GET /UserByScreenName?screenName= → 账号资料 (含 rest id). [xsource.Provider]
func (c *Client) LookupAccount(ctx context.Context, handle string) (*xsource.Account, error) {
	body, err := c.get(ctx, "/UserByScreenName", url.Values{"screenName": {handle}})
	if err != nil {
		return nil, err
	}
	return parseAccount(body)
}

// UserTweets GET /UserTweets?restId= → 时间线一页 (增量采集主力). [xsource.Provider]
func (c *Client) UserTweets(ctx context.Context, restID, cursor string) (*xsource.TweetsPage, error) {
	body, err := c.get(ctx, "/UserTweets", timelineQuery("restId", restID, cursor))
	if err != nil {
		return nil, err
	}
	return parseTimeline(body)
}

// ─────────────── 扩展能力 (暂不在 xsource.Provider 契约内) ───────────────
// 端点映射占位: 捕获 twitterdata 的能力面. 解析与 UserTweets 共用 parseTimeline/parseTweet,
// 待样本落地后一起生效. 提升进接口 = 出现跨供应商消费方时再说.

// UserTweetsAndReplies GET /UserTweetsAndReplies?restId= → 含回复的时间线.
func (c *Client) UserTweetsAndReplies(ctx context.Context, restID, cursor string) (*xsource.TweetsPage, error) {
	body, err := c.get(ctx, "/UserTweetsAndReplies", timelineQuery("restId", restID, cursor))
	if err != nil {
		return nil, err
	}
	return parseTimeline(body)
}

// SearchTimeline GET /SearchTimeline?rawQuery= → 搜索 (rawQuery 直传, 如 "from:elonmusk").
func (c *Client) SearchTimeline(ctx context.Context, rawQuery, cursor string) (*xsource.TweetsPage, error) {
	body, err := c.get(ctx, "/SearchTimeline", timelineQuery("rawQuery", rawQuery, cursor))
	if err != nil {
		return nil, err
	}
	return parseTimeline(body)
}

// TweetDetail GET /TweetDetail?restId= → 单条推文 (详情页线程展开).
func (c *Client) TweetDetail(ctx context.Context, tweetID string) (*xsource.Tweet, error) {
	body, err := c.get(ctx, "/TweetDetail", url.Values{"restId": {tweetID}})
	if err != nil {
		return nil, err
	}
	return parseTweet(body)
}

// ListLatestTweets GET /ListLatestTweetsTimeline?listId= → list 时间线.
func (c *Client) ListLatestTweets(ctx context.Context, listID, cursor string) (*xsource.TweetsPage, error) {
	body, err := c.get(ctx, "/ListLatestTweetsTimeline", timelineQuery("listId", listID, cursor))
	if err != nil {
		return nil, err
	}
	return parseTimeline(body)
}

// CommunityTweets GET /CommunityTweetsTimeline?communityId= → community 时间线 (按时间排序).
func (c *Client) CommunityTweets(ctx context.Context, communityID, cursor string) (*xsource.TweetsPage, error) {
	q := timelineQuery("communityId", communityID, cursor)
	q.Set("rankingMode", "Recency")
	body, err := c.get(ctx, "/CommunityTweetsTimeline", q)
	if err != nil {
		return nil, err
	}
	return parseTimeline(body)
}

// timelineQuery 拼 {key: id} (+ 可选 cursor). cursor 参数名待样本确认 (twitterdata 文档未给).
func timelineQuery(key, id, cursor string) url.Values {
	q := url.Values{key: {id}}
	if cursor != "" {
		q.Set("cursor", cursor) // ?cursor=<bottomCursor>; 实测可翻到更旧推 (2026-06-16)
	}
	return q
}

// 其余端点待按需添加 (需新返回类型, 暂未纳入 xsource):
//   GET /Followers?restId= → 粉丝列表 ([]xsource.Account)
//   GET /Following?restId= → 关注列表 ([]xsource.Account)

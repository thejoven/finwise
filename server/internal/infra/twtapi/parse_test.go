package twtapi

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"wiseflow/server/internal/infra/xsource"
)

// fixtures 是 P0 spike 抓的真实响应 (账号 @elonmusk), 见 docs/api/samples/twtapi/README.md.
func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	p := filepath.Join("..", "..", "..", "..", "docs", "api", "samples", "twtapi", name)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

func TestParseUserTweetsFixture(t *testing.T) {
	page, err := ParseUserTweets(readFixture(t, "UserTweets.sample.json"))
	if err != nil {
		t.Fatalf("ParseUserTweets: %v", err)
	}
	// 裁剪版 fixture: 1 条视频媒体推 + 1 条引用推 + 1 个 bottom cursor
	if len(page.Tweets) != 2 {
		t.Fatalf("want 2 tweets, got %d", len(page.Tweets))
	}
	if page.BottomCursor == "" {
		t.Fatal("bottom cursor empty")
	}

	var sawMedia, sawQuote bool
	for _, tw := range page.Tweets {
		if tw.ID == "" || tw.Text == "" {
			t.Fatalf("tweet missing id/text: %+v", tw)
		}
		if len(tw.Raw) == 0 {
			t.Fatal("raw payload not preserved")
		}
		if tw.Author.Handle == "" || !strings.EqualFold(tw.Author.Handle, "elonmusk") {
			t.Fatalf("author handle = %q, want elonmusk", tw.Author.Handle)
		}
		if tw.Author.RestID == "" || tw.Author.AvatarURL == "" {
			t.Fatalf("author incomplete: %+v", tw.Author)
		}
		if tw.CreatedAt.IsZero() || tw.CreatedAt.Year() < 2020 {
			t.Fatalf("created_at not parsed: %v", tw.CreatedAt)
		}
		if len(tw.Media) > 0 {
			sawMedia = true
			m := tw.Media[0]
			if m.Type == "" || m.URL == "" {
				t.Fatalf("media incomplete: %+v", m)
			}
			if m.Type == "video" {
				if !strings.Contains(m.URL, ".mp4") && !strings.Contains(m.URL, "video.twimg.com") {
					t.Fatalf("video url not mp4 variant: %s", m.URL)
				}
				if m.Thumb == "" {
					t.Fatal("video thumb empty")
				}
			}
		}
		if tw.Quoted != nil {
			sawQuote = true
			if !tw.IsQuote {
				t.Fatal("quoted set but is_quote false")
			}
			if tw.Quoted.ID == "" || tw.Quoted.Text == "" {
				t.Fatalf("nested quote incomplete: %+v", tw.Quoted)
			}
		}
	}
	if !sawMedia {
		t.Fatal("fixture should contain a media tweet")
	}
	if !sawQuote {
		t.Fatal("fixture should contain a quote tweet")
	}
}

func TestParseSearchFixture(t *testing.T) {
	page, err := ParseSearch(readFixture(t, "Search.sample.json"))
	if err != nil {
		t.Fatalf("ParseSearch: %v", err)
	}
	if len(page.Tweets) != 2 {
		t.Fatalf("want 2 tweets from _normalized, got %d", len(page.Tweets))
	}
	if page.BottomCursor == "" {
		t.Fatal("next_cursor empty")
	}
	for _, tw := range page.Tweets {
		if tw.ID == "" || tw.Text == "" || tw.Author.Handle == "" {
			t.Fatalf("search tweet incomplete: id=%q text.len=%d author=%q", tw.ID, len(tw.Text), tw.Author.Handle)
		}
	}
}

func TestParseTweetDetailFixture(t *testing.T) {
	tw, err := ParseTweetDetail(readFixture(t, "TweetDetail.sample.json"))
	if err != nil {
		t.Fatalf("ParseTweetDetail: %v", err)
	}
	if tw.ID != "2064238810582438366" {
		t.Fatalf("id = %q, want 2064238810582438366", tw.ID)
	}
	if tw.Text == "" || tw.Author.Handle == "" {
		t.Fatalf("detail incomplete: %+v", tw)
	}
}

func TestParseAccountNotFound(t *testing.T) {
	// 实测 (2026-06-10): twtapi 对真·不存在的 handle 返 HTTP 200 + 空 user_results
	// (result 缺失), 不是干净 404. 解析层必须把这种空壳判成 ErrNotFound, 否则会建出
	// 空订阅. (注: 误以为"不存在"的 handle 若其实已被注册, twtapi 会正常返 User —
	// 那不是 bug, 是该 handle 真实存在.)
	cases := []string{
		`{"data":{"user_results":{}}}`,              // result 缺失 (真·不存在)
		`{"data":{"user_results":{"result":null}}}`, // result 显式 null
		`{"data":{}}`, // 整个 user_results 缺失
	}
	for _, body := range cases {
		if _, err := ParseAccount([]byte(body)); !errors.Is(err, xsource.ErrNotFound) {
			t.Errorf("ParseAccount(%s) err = %v, want ErrNotFound", body, err)
		}
	}
}

func TestParseAccountFixture(t *testing.T) {
	a, err := ParseAccount(readFixture(t, "UserResultByScreenName.sample.json"))
	if err != nil {
		t.Fatalf("ParseAccount: %v", err)
	}
	if a.RestID != "44196397" {
		t.Fatalf("rest_id = %q, want 44196397", a.RestID)
	}
	if !strings.EqualFold(a.Handle, "elonmusk") {
		t.Fatalf("handle = %q, want elonmusk", a.Handle)
	}
	if a.DisplayName == "" || a.AvatarURL == "" {
		t.Fatalf("account incomplete: %+v", a)
	}
}

func TestUsernameToUserIdFixtureShape(t *testing.T) {
	// 该端点无信封: {id, id_str} — 直接验证 fixture 形状与 client 的解码结构一致.
	var out struct {
		ID    json.Number `json:"id"`
		IDStr string      `json:"id_str"`
	}
	if err := json.Unmarshal(readFixture(t, "UsernameToUserId.sample.json"), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.IDStr != "44196397" {
		t.Fatalf("id_str = %q, want 44196397", out.IDStr)
	}
}

func TestRubyDateLayout(t *testing.T) {
	ts, err := time.Parse(twTimeLayout, "Tue Jun 09 06:50:58 +0000 2026")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if ts.UTC().Format(time.RFC3339) != "2026-06-09T06:50:58Z" {
		t.Fatalf("got %s", ts.UTC().Format(time.RFC3339))
	}
}

func TestParseTweetVisibilityWrapper(t *testing.T) {
	// TweetWithVisibilityResults 包一层 {tweet: <TWEET>} — 解包路径.
	inner := `{"__typename":"Tweet","rest_id":"1","core":{"user_results":{"result":{"rest_id":"9","core":{"name":"N","screen_name":"h"},"avatar":{"image_url":"u"}}}},"legacy":{"full_text":"hello","created_at":"Tue Jun 09 06:50:58 +0000 2026","lang":"en","favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"bookmark_count":0,"is_quote_status":false}}`
	wrapped := `{"__typename":"TweetWithVisibilityResults","tweet":` + inner + `}`
	tw, err := ParseTweet(json.RawMessage(wrapped))
	if err != nil {
		t.Fatalf("ParseTweet wrapped: %v", err)
	}
	if tw.ID != "1" || tw.Text != "hello" {
		t.Fatalf("unexpected: %+v", tw)
	}
}

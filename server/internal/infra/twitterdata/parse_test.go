package twitterdata

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"alphax/server/internal/infra/xsource"
)

// fixtures 是真实响应 (账号 @elonmusk, 2026-06-16), 见 docs/api/samples/twitterdata/README.md.
func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	p := filepath.Join("..", "..", "..", "..", "docs", "api", "samples", "twitterdata", name)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

func TestParseTimelineFixture(t *testing.T) {
	page, err := parseTimeline(readFixture(t, "UserTweets.sample.json"))
	if err != nil {
		t.Fatalf("parseTimeline: %v", err)
	}
	// 裁剪版: 1 引用推 + 1 转推 + Top/Bottom cursor
	if len(page.Tweets) != 2 {
		t.Fatalf("want 2 tweets, got %d", len(page.Tweets))
	}
	if page.BottomCursor == "" {
		t.Fatal("bottom cursor empty")
	}

	var sawQuote, sawRetweet bool
	for _, tw := range page.Tweets {
		if tw.ID == "" || tw.Text == "" {
			t.Fatalf("tweet missing id/text: %+v", tw)
		}
		if len(tw.Raw) == 0 {
			t.Fatal("raw payload not preserved")
		}
		if !strings.EqualFold(tw.Author.Handle, "elonmusk") || tw.Author.RestID == "" {
			t.Fatalf("author = %+v, want elonmusk", tw.Author)
		}
		if tw.CreatedAt.IsZero() || tw.CreatedAt.Year() < 2020 {
			t.Fatalf("created_at not parsed: %v", tw.CreatedAt)
		}
		if tw.Metrics.Views <= 0 {
			t.Fatalf("views not parsed (views.count): %+v", tw.Metrics)
		}
		if tw.Quoted != nil {
			// Quoted 现承载引用原推(quote)与纯转推(RT)被转的原推两类.
			if !tw.IsQuote && !tw.IsRetweet {
				t.Fatal("quoted set but neither is_quote nor is_retweet")
			}
			if tw.IsQuote {
				sawQuote = true
			}
			if tw.Quoted.ID == "" || tw.Quoted.Text == "" {
				t.Fatalf("nested quote incomplete: %+v", tw.Quoted)
			}
		}
		if tw.IsRetweet {
			sawRetweet = true
		}
	}
	if !sawQuote {
		t.Fatal("fixture should contain a quote tweet (quoted_status_result)")
	}
	if !sawRetweet {
		t.Fatal("fixture should contain a retweet")
	}
}

func TestParseTweetDetailFixture(t *testing.T) {
	tw, err := parseTweet(readFixture(t, "TweetDetail.sample.json"))
	if err != nil {
		t.Fatalf("parseTweet: %v", err)
	}
	if tw.ID != "1897289524193214579" {
		t.Fatalf("id = %q, want 1897289524193214579", tw.ID)
	}
	if tw.Text == "" || tw.Author.Handle == "" {
		t.Fatalf("detail incomplete: %+v", tw)
	}
}

func TestDecodeTweetVideoMedia(t *testing.T) {
	// fixture 是一条带视频的真实 <TWEET> (search filter:videos 抓的). 测媒体解码:
	// 视频 → URL 取最高码率 mp4 变体 (video.twimg.com), Thumb 取封面 (pbs.twimg.com).
	tw, err := decodeTweet(readFixture(t, "tweet_with_video.sample.json"))
	if err != nil {
		t.Fatalf("decodeTweet: %v", err)
	}
	if tw.ID != "2066356709635866898" {
		t.Fatalf("id = %q, want 2066356709635866898", tw.ID)
	}
	if len(tw.Media) == 0 {
		t.Fatal("no media decoded")
	}
	m := tw.Media[0]
	if m.Type != "video" {
		t.Fatalf("media type = %q, want video", m.Type)
	}
	if !strings.Contains(m.URL, "video.twimg.com") {
		t.Fatalf("video URL not an mp4 variant: %s", m.URL)
	}
	if m.Thumb == "" {
		t.Fatal("video thumb (poster) empty")
	}
	if m.URL == m.Thumb {
		t.Fatal("URL should be the mp4 variant, not the poster image")
	}
}

func TestParseAccountFixture(t *testing.T) {
	a, err := parseAccount(readFixture(t, "UserByScreenName.sample.json"))
	if err != nil {
		t.Fatalf("parseAccount: %v", err)
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

func TestParseAccountNotFound(t *testing.T) {
	// 不存在/受保护时上游返空 result → 必须判 ErrNotFound, 不建 junk 订阅 (兜底同 twtapi).
	cases := []string{
		`{"data":{"user":{}}}`,              // result 缺失
		`{"data":{"user":{"result":null}}}`, // result 显式 null
		`{"data":{}}`,                       // 整个 user 缺失
	}
	for _, body := range cases {
		if _, err := parseAccount([]byte(body)); !errors.Is(err, xsource.ErrNotFound) {
			t.Errorf("parseAccount(%s) err = %v, want ErrNotFound", body, err)
		}
	}
}

package twitterdata

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"alphax/server/internal/infra/xsource"
)

// 解析按真实样本对齐 (docs/api/samples/twitterdata/, @elonmusk, 2026-06-16). 与 twtapi 的差异:
//   - 信封是 x.com 原生 camelCase: 账号 data.user.result; 时间线 data.user.result.timeline.
//     timeline.instructions[].entries[].content.itemContent.tweet_results.result; entryId /
//     entryType / cursorType / itemContent 都是驼峰 (twtapi 被代理改成了 snake + 自定义封装).
//   - 单条 <TWEET>: 浏览量在 views.count (twtapi 是 view_count_info.count); 引用在
//     quoted_status_result (twtapi 是 quoted_tweet_results). 作者只见 core.user_results.result.
// 故未与 twtapi 共用解码内核 —— 两家信封全异、内层亦有键差异, 各写各的更忠实 (以实测为准).

const twTimeLayout = "Mon Jan 02 15:04:05 -0700 2006"

var errSkipTweet = errors.New("twitterdata: not a parseable tweet")

// ───────────────────────── 内层 user / <TWEET> ─────────────────────────

type userResultJSON struct {
	RestID string `json:"rest_id"`
	Core   struct {
		Name       string `json:"name"`
		ScreenName string `json:"screen_name"`
	} `json:"core"`
	Avatar struct {
		ImageURL string `json:"image_url"`
	} `json:"avatar"`
	ProfileBio struct {
		Description string `json:"description"`
	} `json:"profile_bio"`
	// 旧 schema 兜底 (上游回滚老结构时)
	Legacy struct {
		Name                 string `json:"name"`
		ScreenName           string `json:"screen_name"`
		Description          string `json:"description"`
		ProfileImageURLHTTPS string `json:"profile_image_url_https"`
	} `json:"legacy"`
}

func (u *userResultJSON) toAccount() xsource.Account {
	a := xsource.Account{
		RestID:      u.RestID,
		Handle:      u.Core.ScreenName,
		DisplayName: u.Core.Name,
		AvatarURL:   u.Avatar.ImageURL,
		Bio:         u.ProfileBio.Description,
	}
	if a.Handle == "" {
		a.Handle = u.Legacy.ScreenName
	}
	if a.DisplayName == "" {
		a.DisplayName = u.Legacy.Name
	}
	if a.AvatarURL == "" {
		a.AvatarURL = u.Legacy.ProfileImageURLHTTPS
	}
	if a.Bio == "" {
		a.Bio = u.Legacy.Description
	}
	return a
}

type mediaJSON struct {
	Type          string `json:"type"`
	MediaURLHTTPS string `json:"media_url_https"`
	VideoInfo     struct {
		Variants []struct {
			ContentType string `json:"content_type"`
			URL         string `json:"url"`
			Bitrate     int64  `json:"bitrate"`
		} `json:"variants"`
	} `json:"video_info"`
	OriginalInfo struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"original_info"`
}

func convertMedia(m mediaJSON) xsource.Media {
	out := xsource.Media{
		Type:   m.Type,
		URL:    m.MediaURLHTTPS,
		Width:  m.OriginalInfo.Width,
		Height: m.OriginalInfo.Height,
	}
	if m.Type == "video" || m.Type == "animated_gif" {
		out.Thumb = m.MediaURLHTTPS
		var bestURL string
		var bestBitrate int64 = -1
		for _, v := range m.VideoInfo.Variants {
			if v.ContentType == "video/mp4" && v.Bitrate > bestBitrate {
				bestURL, bestBitrate = v.URL, v.Bitrate
			}
		}
		if bestURL != "" {
			out.URL = bestURL
		}
	}
	return out
}

type tweetJSON struct {
	Typename string          `json:"__typename"`
	RestID   string          `json:"rest_id"`
	Tweet    json.RawMessage `json:"tweet"` // TweetWithVisibilityResults 包一层 {tweet: <TWEET>}
	Core     struct {
		UserResults struct {
			Result userResultJSON `json:"result"`
		} `json:"user_results"`
	} `json:"core"`
	Views struct {
		Count string `json:"count"`
	} `json:"views"`
	Legacy struct {
		FullText              string `json:"full_text"`
		CreatedAt             string `json:"created_at"`
		Lang                  string `json:"lang"`
		ConversationIDStr     string `json:"conversation_id_str"`
		IsQuoteStatus         bool   `json:"is_quote_status"`
		QuotedStatusIDStr     string `json:"quoted_status_id_str"`
		FavoriteCount         int    `json:"favorite_count"`
		RetweetCount          int    `json:"retweet_count"`
		ReplyCount            int    `json:"reply_count"`
		QuoteCount            int    `json:"quote_count"`
		BookmarkCount         int    `json:"bookmark_count"`
		RetweetedStatusResult *struct {
			Result json.RawMessage `json:"result"`
		} `json:"retweeted_status_result"`
		Entities struct {
			Media []mediaJSON `json:"media"`
		} `json:"entities"`
		ExtendedEntities struct {
			Media []mediaJSON `json:"media"`
		} `json:"extended_entities"`
	} `json:"legacy"`
	QuotedStatusResult struct {
		Result json.RawMessage `json:"result"`
	} `json:"quoted_status_result"`
}

// decodeTweet 解析单个 <TWEET> 对象 (时间线 / 详情同构复用; 引用原推递归).
func decodeTweet(raw json.RawMessage) (*xsource.Tweet, error) {
	var t tweetJSON
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, fmt.Errorf("twitterdata decode tweet: %w", err)
	}
	// TweetWithVisibilityResults → 解包一层
	if t.RestID == "" && len(t.Tweet) > 0 {
		return decodeTweet(t.Tweet)
	}
	if t.RestID == "" || t.Legacy.FullText == "" {
		return nil, errSkipTweet // tombstone / TweetUnavailable / 无 legacy 的占位
	}

	p := &xsource.Tweet{
		ID:             t.RestID,
		Text:           t.Legacy.FullText,
		Lang:           t.Legacy.Lang,
		ConversationID: t.Legacy.ConversationIDStr,
		IsQuote:        t.Legacy.IsQuoteStatus,
		QuotedID:       t.Legacy.QuotedStatusIDStr,
		IsRetweet: strings.HasPrefix(t.Legacy.FullText, "RT @") ||
			(t.Legacy.RetweetedStatusResult != nil && len(t.Legacy.RetweetedStatusResult.Result) > 0),
		Metrics: xsource.Metrics{
			Likes:     t.Legacy.FavoriteCount,
			Retweets:  t.Legacy.RetweetCount,
			Replies:   t.Legacy.ReplyCount,
			Quotes:    t.Legacy.QuoteCount,
			Bookmarks: t.Legacy.BookmarkCount,
		},
		Author: t.Core.UserResults.Result.toAccount(),
		Raw:    raw,
	}
	if ts, err := time.Parse(twTimeLayout, t.Legacy.CreatedAt); err == nil {
		p.CreatedAt = ts.UTC()
	}
	if v, err := strconv.ParseInt(t.Views.Count, 10, 64); err == nil {
		p.Metrics.Views = v
	}

	// 媒体: extended_entities 优先 (entities.media 是裁剪版). 视频路径有 fixture 覆盖
	// (tweet_with_video.sample.json); photo 是平凡分支 (URL=media_url_https). raw_payload 留底.
	src := t.Legacy.ExtendedEntities.Media
	if len(src) == 0 {
		src = t.Legacy.Entities.Media
	}
	for _, m := range src {
		p.Media = append(p.Media, convertMedia(m))
	}

	// 引用原推: 递归 (失败不阻断主推)
	if len(t.QuotedStatusResult.Result) > 0 {
		if q, err := decodeTweet(t.QuotedStatusResult.Result); err == nil {
			p.Quoted = q
			if p.QuotedID == "" {
				p.QuotedID = q.ID
			}
		}
	}
	return p, nil
}

// ───────────────────────── 容器解包 ─────────────────────────

type instructionJSON struct {
	Type    string              `json:"type"`
	Entries []timelineEntryJSON `json:"entries"` // TimelineAddEntries
	Entry   *timelineEntryJSON  `json:"entry"`   // TimelinePinEntry
}

type timelineEntryJSON struct {
	EntryID string `json:"entryId"`
	Content struct {
		EntryType   string `json:"entryType"`
		CursorType  string `json:"cursorType"`
		Value       string `json:"value"`
		ItemContent struct {
			TweetResults struct {
				Result json.RawMessage `json:"result"`
			} `json:"tweet_results"`
		} `json:"itemContent"`
	} `json:"content"`
}

func collectEntries(ins []instructionJSON) []timelineEntryJSON {
	var entries []timelineEntryJSON
	for _, i := range ins {
		entries = append(entries, i.Entries...)
		if i.Entry != nil {
			entries = append(entries, *i.Entry)
		}
	}
	return entries
}

func appendTweet(page *xsource.TweetsPage, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	if t, err := decodeTweet(raw); err == nil {
		page.Tweets = append(page.Tweets, *t)
	}
	// tombstone / 结构异常: 跳过, 不在这层硬扛 (raw_payload 思路在 twtapi 同款)
}

// timelineFromEntries 把 entries 铺成一页: 提 bottom cursor + 收推文, 跳过 module/who-to-follow.
func timelineFromEntries(entries []timelineEntryJSON) *xsource.TweetsPage {
	page := &xsource.TweetsPage{}
	for _, e := range entries {
		switch {
		case e.Content.EntryType == "TimelineTimelineCursor" || strings.HasPrefix(e.EntryID, "cursor-"):
			if e.Content.CursorType == "Bottom" || strings.HasPrefix(e.EntryID, "cursor-bottom") {
				page.BottomCursor = e.Content.Value
			}
		default:
			appendTweet(page, e.Content.ItemContent.TweetResults.Result) // 空则被 appendTweet 忽略
		}
	}
	return page
}

// parseTimeline 解时间线类响应 (UserTweets / UserTweetsAndReplies / SearchTimeline / List /
// Community): data.user.result.timeline.timeline.instructions[].
func parseTimeline(body []byte) (*xsource.TweetsPage, error) {
	var env struct {
		Data struct {
			User struct {
				Result struct {
					Timeline struct {
						Timeline struct {
							Instructions []instructionJSON `json:"instructions"`
						} `json:"timeline"`
					} `json:"timeline"`
				} `json:"result"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twitterdata parse timeline envelope: %w", err)
	}
	return timelineFromEntries(collectEntries(env.Data.User.Result.Timeline.Timeline.Instructions)), nil
}

// parseTweet 解 /TweetDetail 响应: data.threaded_conversation_with_injections_v2.instructions[].
// 取会话里第一条可解析的推文 (按 id 拉详情, 焦点推一般居首).
func parseTweet(body []byte) (*xsource.Tweet, error) {
	var env struct {
		Data struct {
			Threaded struct {
				Instructions []instructionJSON `json:"instructions"`
			} `json:"threaded_conversation_with_injections_v2"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twitterdata parse TweetDetail envelope: %w", err)
	}
	for _, e := range collectEntries(env.Data.Threaded.Instructions) {
		raw := e.Content.ItemContent.TweetResults.Result
		if len(raw) == 0 {
			continue
		}
		if t, err := decodeTweet(raw); err == nil {
			return t, nil
		}
	}
	return nil, xsource.ErrNotFound
}

// parseAccount 解 /UserByScreenName 响应: data.user.result.
func parseAccount(body []byte) (*xsource.Account, error) {
	var env struct {
		Data struct {
			User struct {
				Result *userResultJSON `json:"result"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twitterdata parse UserByScreenName: %w", err)
	}
	if env.Data.User.Result == nil {
		return nil, xsource.ErrNotFound // 不存在/受保护时上游返空 result (与 twtapi 同款兜底)
	}
	a := env.Data.User.Result.toAccount()
	if a.RestID == "" || a.Handle == "" {
		return nil, xsource.ErrNotFound
	}
	return &a, nil
}

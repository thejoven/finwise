package twtapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"alphax/server/internal/infra/xsource"
)

// 领域类型 (Account/Tweet/Media/Metrics/TweetsPage) 与哨兵错误已上移到 xsource —— 跨供应商
// 共用. 本包只负责把 twtapi 的信封/字段映射成 xsource.* (字段映射: 开发文档 §3.3).

// twTimeLayout — Twitter 的 ruby 风格时间 ("Tue Jun 09 06:50:58 +0000 2026").
const twTimeLayout = "Mon Jan 02 15:04:05 -0700 2006"

// errSkipTweet — 容器里的占位/墓碑条目 (TweetTombstone 等), 跳过不报错.
var errSkipTweet = errors.New("twtapi: not a parseable tweet")

// ───────────────────────── <TWEET> 解码 ─────────────────────────

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
	// 旧版 schema 兜底 (上游回滚老结构时, 见 §3.3 防御性设计)
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

type tweetJSON struct {
	Typename string `json:"__typename"`
	RestID   string `json:"rest_id"`
	// TweetWithVisibilityResults 包一层 {tweet: <TWEET>}
	Tweet json.RawMessage `json:"tweet"`
	// 作者路径两种都见过 (实测): UserTweets/Search 用 user_results (复数, 新 schema
	// core.{name,screen_name}); TweetDetail 用 user_result (单数, 旧 schema legacy.*).
	Core struct {
		UserResults struct {
			Result userResultJSON `json:"result"`
		} `json:"user_results"`
		UserResult struct {
			Result userResultJSON `json:"result"`
		} `json:"user_result"`
	} `json:"core"`
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
	ViewCountInfo struct {
		Count string `json:"count"`
	} `json:"view_count_info"`
	QuotedTweetResults struct {
		Result json.RawMessage `json:"result"`
	} `json:"quoted_tweet_results"`
}

// ParseTweet 解析单个 <TWEET> 对象 (三端点同构复用).
func ParseTweet(raw json.RawMessage) (*xsource.Tweet, error) {
	var t tweetJSON
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, fmt.Errorf("twtapi parse tweet: %w", err)
	}
	// TweetWithVisibilityResults → 解包一层
	if t.RestID == "" && len(t.Tweet) > 0 {
		return ParseTweet(t.Tweet)
	}
	if t.RestID == "" || t.Legacy.FullText == "" {
		return nil, errSkipTweet // tombstone / 不可用条目
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
		Author: pickAuthor(t),
		Raw:    raw,
	}
	if ts, err := time.Parse(twTimeLayout, t.Legacy.CreatedAt); err == nil {
		p.CreatedAt = ts.UTC()
	}
	if v, err := strconv.ParseInt(t.ViewCountInfo.Count, 10, 64); err == nil {
		p.Metrics.Views = v
	}

	// 媒体: extended_entities 优先 (entities.media 是裁剪版)
	src := t.Legacy.ExtendedEntities.Media
	if len(src) == 0 {
		src = t.Legacy.Entities.Media
	}
	for _, m := range src {
		p.Media = append(p.Media, convertMedia(m))
	}

	// 引用原推: 递归解析 (失败不阻断主推)
	if len(t.QuotedTweetResults.Result) > 0 {
		if q, err := ParseTweet(t.QuotedTweetResults.Result); err == nil {
			p.Quoted = q
			if p.QuotedID == "" {
				p.QuotedID = q.ID
			}
		}
	}
	// 纯转推原推: Text 是 "RT @x: …" 截断版, 原文藏在 retweeted_status_result —— 同样填进 Quoted,
	// 让前端展开原作者+全文 (引用已填则不覆盖).
	if p.Quoted == nil && t.Legacy.RetweetedStatusResult != nil && len(t.Legacy.RetweetedStatusResult.Result) > 0 {
		if q, err := ParseTweet(t.Legacy.RetweetedStatusResult.Result); err == nil {
			p.Quoted = q
		}
	}
	return p, nil
}

func pickAuthor(t tweetJSON) xsource.Account {
	a := t.Core.UserResults.Result.toAccount()
	if a.Handle != "" || a.RestID != "" {
		return a
	}
	return t.Core.UserResult.Result.toAccount()
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

// ───────────────────────── 容器解包 ─────────────────────────

type timelineEntryJSON struct {
	EntryID string `json:"entry_id"`
	Content struct {
		Typename   string `json:"__typename"`
		CursorType string `json:"cursor_type"`
		Value      string `json:"value"`
		Content    struct {
			TweetResults struct {
				Result json.RawMessage `json:"result"`
			} `json:"tweet_results"`
		} `json:"content"`
		// TimelineTimelineModule (线程/对话模块) — 字段名未在样本里出现, 两种命名都试
		Items []struct {
			Item struct {
				Content struct {
					TweetResults struct {
						Result json.RawMessage `json:"result"`
					} `json:"tweet_results"`
				} `json:"content"`
				ItemContent struct {
					TweetResults struct {
						Result json.RawMessage `json:"result"`
					} `json:"tweet_results"`
				} `json:"item_content"`
			} `json:"item"`
		} `json:"items"`
	} `json:"content"`
}

// ParseUserTweets 解 /UserTweets 响应:
// data.user_result_by_rest_id.result.profile_timeline_v2.timeline.instructions[].entries[].
func ParseUserTweets(body []byte) (*xsource.TweetsPage, error) {
	var env struct {
		Data struct {
			UserResultByRestID struct {
				Result struct {
					ProfileTimelineV2 struct {
						Timeline struct {
							Instructions []struct {
								Type    string              `json:"type"`
								Entries []timelineEntryJSON `json:"entries"`
								Entry   *timelineEntryJSON  `json:"entry"`
							} `json:"instructions"`
						} `json:"timeline"`
					} `json:"profile_timeline_v2"`
				} `json:"result"`
			} `json:"user_result_by_rest_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twtapi parse UserTweets envelope: %w", err)
	}

	page := &xsource.TweetsPage{}
	var entries []timelineEntryJSON
	for _, ins := range env.Data.UserResultByRestID.Result.ProfileTimelineV2.Timeline.Instructions {
		entries = append(entries, ins.Entries...)
		if ins.Entry != nil {
			entries = append(entries, *ins.Entry)
		}
	}
	for _, e := range entries {
		switch {
		case e.Content.Typename == "TimelineTimelineCursor" || strings.HasPrefix(e.EntryID, "cursor-"):
			if e.Content.CursorType == "Bottom" || strings.HasPrefix(e.EntryID, "cursor-bottom") {
				page.BottomCursor = e.Content.Value
			}
		case len(e.Content.Items) > 0: // 线程模块
			for _, it := range e.Content.Items {
				raw := it.Item.Content.TweetResults.Result
				if len(raw) == 0 {
					raw = it.Item.ItemContent.TweetResults.Result
				}
				appendTweet(page, raw)
			}
		default:
			appendTweet(page, e.Content.Content.TweetResults.Result)
		}
	}
	return page, nil
}

func appendTweet(page *xsource.TweetsPage, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	t, err := ParseTweet(raw)
	if err != nil {
		return // tombstone / 结构异常: 跳过, 靠 raw_payload 思路不在这层硬扛
	}
	page.Tweets = append(page.Tweets, *t)
}

// ParseSearch 解 /Search 响应 — 走 twtapi 的 _normalized (只有 Search 有).
func ParseSearch(body []byte) (*xsource.TweetsPage, error) {
	var env struct {
		Normalized struct {
			Tweets []struct {
				Result json.RawMessage `json:"result"`
			} `json:"tweets"`
			NextCursor string `json:"next_cursor"`
		} `json:"_normalized"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twtapi parse Search envelope: %w", err)
	}
	page := &xsource.TweetsPage{BottomCursor: env.Normalized.NextCursor}
	for _, t := range env.Normalized.Tweets {
		appendTweet(page, t.Result)
	}
	return page, nil
}

// ParseTweetDetail 解 /TweetDetail 响应: data.tweet_result.result.
func ParseTweetDetail(body []byte) (*xsource.Tweet, error) {
	var env struct {
		Data struct {
			TweetResult struct {
				Result json.RawMessage `json:"result"`
			} `json:"tweet_result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twtapi parse TweetDetail envelope: %w", err)
	}
	if len(env.Data.TweetResult.Result) == 0 {
		return nil, xsource.ErrNotFound
	}
	return ParseTweet(env.Data.TweetResult.Result)
}

// ParseAccount 解 /UserResultByScreenName 响应: data.user_results.result.
func ParseAccount(body []byte) (*xsource.Account, error) {
	var env struct {
		Data struct {
			UserResults struct {
				RestID string          `json:"rest_id"`
				Result *userResultJSON `json:"result"`
			} `json:"user_results"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("twtapi parse UserResultByScreenName: %w", err)
	}
	if env.Data.UserResults.Result == nil {
		return nil, xsource.ErrNotFound
	}
	a := env.Data.UserResults.Result.toAccount()
	if a.RestID == "" {
		a.RestID = env.Data.UserResults.RestID
	}
	if a.RestID == "" || a.Handle == "" {
		return nil, fmt.Errorf("twtapi UserResultByScreenName: missing rest_id/handle")
	}
	return &a, nil
}

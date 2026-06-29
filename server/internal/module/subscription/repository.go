// Package subscription 是「订阅」模块 — 订阅 X 账号, twtapi 采集推文, AI 打标/总结,
// 用户阅读/已读, 可一键转为信号.
//
// 形态备忘 (migrations/019, docs/技术文档/11_推文订阅_开发计划.md):
//   - subscriptions 多态 (source_type, source_id) — v1 只有 twitter, 为 telegram/rss 预留.
//   - tweets 全局共享 (多人订同一账号只采/分类一次), tweet_reads 才是 per-user.
//   - 不写 events 表: 推文是系统采集数据, 已读是高频低价值动作, 均非领域事件
//     (同 distillations 的先例). 转信号走 signal.Capture, 事件由它自己管.
package subscription

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
	"alphax/server/internal/infra/xsource"
)

var ErrNotFound = errors.New("subscription: not found")

const SourceTypeTwitter = "twitter"

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// ───────────────────────── 视图结构 ─────────────────────────

// SubscriptionView — GET /v1/subscriptions 列表项 (账号资料 + 未读数).
type SubscriptionView struct {
	ID           uuid.UUID
	SourceType   string
	AccountID    uuid.UUID
	Handle       string
	DisplayName  string
	AvatarURL    string
	Bio          string
	Status       string
	UnreadCount  int
	LastPolledAt *time.Time
	CreatedAt    time.Time
}

// TweetView — feed 行 / 详情共用.
type TweetView struct {
	ID             string
	AccountID      uuid.UUID
	SubscriptionID uuid.UUID
	Handle         string
	DisplayName    string
	AvatarURL      string
	Text           string
	Lang           string
	TweetCreatedAt time.Time
	IsRetweet      bool
	IsQuote        bool
	Media          json.RawMessage
	Metrics        json.RawMessage
	Tags           []string
	Summary        *string
	Category       *string
	Relevance      *float32
	ClassifyStatus string
	Read           bool
	CapturedAt     time.Time
	Quoted         json.RawMessage // 转帖原文 (引用/转推被转的原推); 无则 nil
	RelatedAssets  []TweetAssetInfo
}

// quotedTweetJSON — 转帖原文的归一化存储形态 (tweets.quoted 列 + API 透传).
// 只留渲染原推卡所需: 原作者 + 正文 + 媒体 + 时间.
type quotedTweetJSON struct {
	ID          string          `json:"id"`
	Handle      string          `json:"handle"`
	DisplayName string          `json:"display_name"`
	AvatarURL   string          `json:"avatar_url"`
	Text        string          `json:"text"`
	Lang        string          `json:"lang,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	Media       []xsource.Media `json:"media,omitempty"`
}

// marshalQuoted — 把采集层的 *xsource.Tweet 原推压成 quoted 列的 JSON (nil → nil, 不写列).
func marshalQuoted(q *xsource.Tweet) []byte {
	if q == nil {
		return nil
	}
	b, err := json.Marshal(quotedTweetJSON{
		ID:          q.ID,
		Handle:      q.Author.Handle,
		DisplayName: q.Author.DisplayName,
		AvatarURL:   q.Author.AvatarURL,
		Text:        q.Text,
		Lang:        q.Lang,
		CreatedAt:   q.CreatedAt,
		Media:       q.Media,
	})
	if err != nil {
		return nil
	}
	return b
}

// TweetAssetInfo — 推文相关标的 (feed 内聚合). tracked = 当前用户是否已通过自己的信号追踪该标的.
type TweetAssetInfo struct {
	Canonical string `json:"canonical"`
	Name      string `json:"name"`
	Market    string `json:"market"`
	Tracked   bool   `json:"tracked"`
}

// ───────────────────────── 账号 / 订阅 ─────────────────────────

// UpsertAccount — 按 rest_id 幂等; 资料字段每次刷新 (改名/换头像跟上).
func (r *Repository) UpsertAccount(ctx context.Context, a xsource.Account) (uuid.UUID, error) {
	const q = `
		INSERT INTO twitter_accounts (rest_id, handle, display_name, avatar_url, bio)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (rest_id) DO UPDATE SET
			handle = EXCLUDED.handle,
			display_name = EXCLUDED.display_name,
			avatar_url = EXCLUDED.avatar_url,
			bio = EXCLUDED.bio,
			status = 'active',
			updated_at = now()
		RETURNING id
	`
	var id uuid.UUID
	if err := r.pool.QueryRow(ctx, q, a.RestID, a.Handle, a.DisplayName, a.AvatarURL, a.Bio).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("upsert twitter account: %w", err)
	}
	return id, nil
}

func (r *Repository) CountActiveSubscriptions(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM subscriptions WHERE user_id = $1 AND active`, userID).Scan(&n)
	return n, err
}

// Subscribe — UNIQUE 幂等; 已取消的订阅复活 (active=true).
func (r *Repository) Subscribe(ctx context.Context, userID, accountID uuid.UUID) (uuid.UUID, error) {
	const q = `
		INSERT INTO subscriptions (user_id, source_type, source_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, source_type, source_id) DO UPDATE SET
			active = true, updated_at = now()
		RETURNING id
	`
	var id uuid.UUID
	if err := r.pool.QueryRow(ctx, q, userID, SourceTypeTwitter, accountID).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("subscribe: %w", err)
	}
	return id, nil
}

// Unsubscribe — 软删 (active=false). 不属于该 user → ErrNotFound.
func (r *Repository) Unsubscribe(ctx context.Context, userID, subID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE subscriptions SET active = false, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND active`, subID, userID)
	if err != nil {
		return fmt.Errorf("unsubscribe: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const subscriptionViewSelect = `
	SELECT s.id, s.source_type, a.id, a.handle,
	       COALESCE(a.display_name,''), COALESCE(a.avatar_url,''), COALESCE(a.bio,''),
	       a.status, a.last_polled_at, s.created_at,
	       COALESCE(u.unread, 0)
	FROM subscriptions s
	JOIN twitter_accounts a ON a.id = s.source_id
	LEFT JOIN LATERAL (
		SELECT count(*) AS unread
		FROM tweets t
		LEFT JOIN tweet_reads r ON r.tweet_id = t.id AND r.user_id = s.user_id
		WHERE t.twitter_account_id = a.id AND r.tweet_id IS NULL
	) u ON true
	WHERE s.user_id = $1 AND s.active AND s.source_type = 'twitter'
`

func scanSubscriptionView(row pgx.Row) (*SubscriptionView, error) {
	var v SubscriptionView
	err := row.Scan(&v.ID, &v.SourceType, &v.AccountID, &v.Handle,
		&v.DisplayName, &v.AvatarURL, &v.Bio,
		&v.Status, &v.LastPolledAt, &v.CreatedAt, &v.UnreadCount)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *Repository) ListSubscriptions(ctx context.Context, userID uuid.UUID) ([]SubscriptionView, error) {
	rows, err := r.pool.Query(ctx, subscriptionViewSelect+` ORDER BY s.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	defer rows.Close()
	var out []SubscriptionView
	for rows.Next() {
		v, err := scanSubscriptionView(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (r *Repository) GetSubscriptionView(ctx context.Context, userID, subID uuid.UUID) (*SubscriptionView, error) {
	v, err := scanSubscriptionView(r.pool.QueryRow(ctx, subscriptionViewSelect+` AND s.id = $2`, userID, subID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get subscription: %w", err)
	}
	return v, nil
}

// ───────────────────────── 采集 (poller) ─────────────────────────

// DueAccount — 到点该采的账号.
type DueAccount struct {
	ID              uuid.UUID
	RestID          string
	Handle          string
	HighWater       string
	PollIntervalSec int
}

// ClaimDueAccounts 取到点账号并立即把 last_polled_at 置 now (CAS 认领, 多实例不重复采).
// 只采有活跃订阅者的账号 — 没人订的账号不烧配额.
func (r *Repository) ClaimDueAccounts(ctx context.Context, limit int) ([]DueAccount, error) {
	const q = `
		UPDATE twitter_accounts SET last_polled_at = now(), updated_at = now()
		WHERE id IN (
			SELECT a.id FROM twitter_accounts a
			WHERE a.status = 'active'
			  AND EXISTS (SELECT 1 FROM subscriptions s
			              WHERE s.source_id = a.id AND s.source_type = 'twitter' AND s.active)
			  AND (a.last_polled_at IS NULL
			       OR a.last_polled_at + make_interval(secs => a.poll_interval_sec) <= now())
			ORDER BY a.last_polled_at ASC NULLS FIRST
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, rest_id, handle, COALESCE(high_water_tweet_id,''), poll_interval_sec
	`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due accounts: %w", err)
	}
	defer rows.Close()
	var out []DueAccount
	for rows.Next() {
		var a DueAccount
		if err := rows.Scan(&a.ID, &a.RestID, &a.Handle, &a.HighWater, &a.PollIntervalSec); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InsertTweets — 按 id 幂等批量入库 (置顶/RT 乱序靠 ON CONFLICT 兜底). 返回新增数.
func (r *Repository) InsertTweets(ctx context.Context, accountID uuid.UUID, tweets []xsource.Tweet) (int, error) {
	if len(tweets) == 0 {
		return 0, nil
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `
		INSERT INTO tweets (id, twitter_account_id, text, lang, tweet_created_at,
		                    is_retweet, is_quote, media, metrics, raw_payload, quoted)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO NOTHING
	`
	inserted := 0
	for _, t := range tweets {
		createdAt := t.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC() // 解析失败兜底, 保证排序键非空
		}
		var media any
		if len(t.Media) > 0 {
			b, _ := json.Marshal(t.Media)
			media = b
		}
		var quoted any
		if b := marshalQuoted(t.Quoted); b != nil {
			quoted = b
		}
		metricsJSON, _ := json.Marshal(t.Metrics)
		tag, err := tx.Exec(ctx, q,
			t.ID, accountID, t.Text, t.Lang, createdAt,
			t.IsRetweet, t.IsQuote, media, metricsJSON, []byte(t.Raw), quoted)
		if err != nil {
			return 0, fmt.Errorf("insert tweet %s: %w", t.ID, err)
		}
		inserted += int(tag.RowsAffected())
	}
	return inserted, tx.Commit(ctx)
}

// UpdateAfterPoll — 推进高水位 + 自适应间隔 (采到新 → 提速到下限; 空轮 → 翻倍到上限).
func (r *Repository) UpdateAfterPoll(ctx context.Context, accountID uuid.UUID, newHighWater string, intervalSec int) error {
	var hw any
	if newHighWater != "" {
		hw = newHighWater
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE twitter_accounts SET
			high_water_tweet_id = COALESCE($2, high_water_tweet_id),
			poll_interval_sec = $3,
			updated_at = now()
		WHERE id = $1`, accountID, hw, intervalSec)
	if err != nil {
		return fmt.Errorf("update after poll: %w", err)
	}
	return nil
}

func (r *Repository) MarkAccountStatus(ctx context.Context, accountID uuid.UUID, status string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE twitter_accounts SET status = $2, updated_at = now() WHERE id = $1`,
		accountID, status)
	return err
}

// ───────────────────────── 分类派发 (dispatcher) ─────────────────────────

// PendingTweet — 待分类条目. Attempts 是含本次认领的计数.
type PendingTweet struct {
	ID       string
	Text     string
	Lang     string
	Handle   string
	Attempts int
}

// ClaimPendingClassify 认领一批待分类推文 (SKIP LOCKED), 认领即 attempts+1 —
// 失败不回滚计数, 天然限次 (≥maxAttempts 不再被认领).
func (r *Repository) ClaimPendingClassify(ctx context.Context, limit, maxAttempts int) ([]PendingTweet, error) {
	const q = `
		WITH claimed AS (
			SELECT id FROM tweets
			WHERE classify_status = 'pending' AND classify_attempts < $2
			ORDER BY captured_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE tweets t SET classify_attempts = t.classify_attempts + 1
		FROM claimed c
		WHERE t.id = c.id
		RETURNING t.id, t.text, COALESCE(t.lang,''),
		          (SELECT handle FROM twitter_accounts a WHERE a.id = t.twitter_account_id),
		          t.classify_attempts
	`
	rows, err := r.pool.Query(ctx, q, limit, maxAttempts)
	if err != nil {
		return nil, fmt.Errorf("claim pending classify: %w", err)
	}
	defer rows.Close()
	var out []PendingTweet
	for rows.Next() {
		var p PendingTweet
		if err := rows.Scan(&p.ID, &p.Text, &p.Lang, &p.Handle, &p.Attempts); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) RecordClassifyResult(ctx context.Context, tweetID string, tags []string, summary, category string, relevance float64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE tweets SET tags = $2, summary = $3, category = $4, relevance = $5,
		                  classify_status = 'done', classified_at = now()
		WHERE id = $1`, tweetID, tags, summary, category, relevance)
	if err != nil {
		return fmt.Errorf("record classify result: %w", err)
	}
	return nil
}

// LinkTweetAsset 把归一后的 asset 链到推文 (P2). anchor_at 冻结于 tweets.captured_at; 幂等.
// 推文不存在 → 子查询无行, 不写.
func (r *Repository) LinkTweetAsset(ctx context.Context, tweetID string, assetID uuid.UUID, rationale string) error {
	const q = `
		INSERT INTO tweet_assets (tweet_id, asset_id, role, anchor_at, rationale)
		SELECT $1, $2, 'related', t.captured_at, NULLIF($3, '')
		FROM tweets t WHERE t.id = $1
		ON CONFLICT (tweet_id, asset_id) DO NOTHING
	`
	if _, err := r.pool.Exec(ctx, q, tweetID, assetID, rationale); err != nil {
		return fmt.Errorf("link tweet asset: %w", err)
	}
	return nil
}

// ListTweetsForAssetBackfill — 选已分类完成、相关度够、但还没链任何标的的推文 (P2 一次性回填用,
// cmd/tweet-asset-backfill 消费). 只补标的, 不动 tags/summary; 按时间倒序优先回填近期.
func (r *Repository) ListTweetsForAssetBackfill(ctx context.Context, limit int, minRelevance float64) ([]PendingTweet, error) {
	const q = `
		SELECT t.id, t.text, COALESCE(t.lang,''),
		       COALESCE((SELECT handle FROM twitter_accounts a WHERE a.id = t.twitter_account_id), '')
		FROM tweets t
		WHERE t.classify_status = 'done'
		  AND COALESCE(t.relevance, 0) >= $2
		  AND NOT EXISTS (SELECT 1 FROM tweet_assets ta WHERE ta.tweet_id = t.id)
		ORDER BY t.tweet_created_at DESC
		LIMIT $1
	`
	rows, err := r.pool.Query(ctx, q, limit, minRelevance)
	if err != nil {
		return nil, fmt.Errorf("list tweets for asset backfill: %w", err)
	}
	defer rows.Close()
	var out []PendingTweet
	for rows.Next() {
		var p PendingTweet
		if err := rows.Scan(&p.ID, &p.Text, &p.Lang, &p.Handle); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// MarkClassifyFailed — 尝试次数耗尽, 停止重试. 前端照常展示原文 (降级阅读).
func (r *Repository) MarkClassifyFailed(ctx context.Context, tweetID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE tweets SET classify_status = 'failed' WHERE id = $1 AND classify_status = 'pending'`,
		tweetID)
	return err
}

// ───────────────────────── 稍后读 / 内容偏好 ─────────────────────────

// SaveTweet — 稍后读: 校验订阅范围 → 记 tweet_saved → 顺手标已读 (移出未读 deck). 幂等.
func (r *Repository) SaveTweet(ctx context.Context, userID uuid.UUID, tweetID string) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var inScope bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM tweets t
			JOIN subscriptions s ON s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
			     AND s.user_id = $1 AND s.active
			WHERE t.id = $2)`, userID, tweetID).Scan(&inScope)
	if err != nil {
		return fmt.Errorf("save tweet scope: %w", err)
	}
	if !inScope {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO tweet_saved (user_id, tweet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, tweetID); err != nil {
		return fmt.Errorf("save tweet: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO tweet_reads (user_id, tweet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, tweetID); err != nil {
		return fmt.Errorf("save tweet mark read: %w", err)
	}
	return tx.Commit(ctx)
}

// UnsaveTweet — 取消稍后读 (从 bucket 移除; 保持已读态).
func (r *Repository) UnsaveTweet(ctx context.Context, userID uuid.UUID, tweetID string) error {
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM tweet_saved WHERE user_id = $1 AND tweet_id = $2`, userID, tweetID); err != nil {
		return fmt.Errorf("unsave tweet: %w", err)
	}
	return nil
}

// MutedTag — 已静音的内容标签 (内容偏好页).
type MutedTag struct {
	Tag    string
	Weight int
}

// ListMutedTags — 该用户已静音的标签 (weight 降序).
func (r *Repository) ListMutedTags(ctx context.Context, userID uuid.UUID) ([]MutedTag, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT tag, weight FROM user_tag_aversion WHERE user_id = $1 AND muted ORDER BY weight DESC, tag`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("list muted tags: %w", err)
	}
	defer rows.Close()
	var out []MutedTag
	for rows.Next() {
		var m MutedTag
		if err := rows.Scan(&m.Tag, &m.Weight); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UnmuteTag — 取消静音 (muted=false + weight 归零, 之后重新累积过阈值才会再静音).
func (r *Repository) UnmuteTag(ctx context.Context, userID uuid.UUID, tag string) error {
	if _, err := r.pool.Exec(ctx,
		`UPDATE user_tag_aversion SET muted = false, weight = 0, updated_at = now()
		 WHERE user_id = $1 AND tag = $2`, userID, tag); err != nil {
		return fmt.Errorf("unmute tag: %w", err)
	}
	return nil
}

// ───────────────────────── feed / 已读 ─────────────────────────

// FeedInput — cursor 是 (tweet_created_at, id) 复合游标的不透明编码.
type FeedInput struct {
	UserID         uuid.UUID
	SubscriptionID *uuid.UUID
	IncludeRead    bool
	Saved          bool // true = 只看稍后读 bucket (无视已读 + 减噪过滤)
	Cursor         string
	Limit          int
}

const tweetViewSelect = `
	SELECT t.id, t.twitter_account_id, s.id, a.handle,
	       COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
	       t.text, COALESCE(t.lang,''), t.tweet_created_at, t.is_retweet, t.is_quote,
	       t.media, t.metrics, t.tags, t.summary, t.category, t.relevance,
	       t.classify_status, (r.tweet_id IS NOT NULL) AS read, t.captured_at, t.quoted,
	       COALESCE((
	         SELECT json_agg(json_build_object(
	                  'canonical', ass.canonical, 'name', ass.name, 'market', ass.market,
	                  'tracked', EXISTS (
	                      SELECT 1 FROM signal_assets sa JOIN signals sg ON sg.id = sa.signal_id
	                      WHERE sg.user_id = $1 AND sa.asset_id = ass.id))
	                ORDER BY ass.canonical)
	         FROM tweet_assets ta JOIN assets ass ON ass.id = ta.asset_id AND ass.status = 'active'
	         WHERE ta.tweet_id = t.id), '[]'::json) AS related_assets
	FROM tweets t
	JOIN twitter_accounts a ON a.id = t.twitter_account_id
	JOIN subscriptions s ON s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
	     AND s.user_id = $1 AND s.active
	LEFT JOIN tweet_reads r ON r.tweet_id = t.id AND r.user_id = $1
`

func scanTweetView(rows pgx.Rows) (*TweetView, error) {
	var v TweetView
	var media, metrics, quoted, relatedAssets []byte
	err := rows.Scan(&v.ID, &v.AccountID, &v.SubscriptionID, &v.Handle,
		&v.DisplayName, &v.AvatarURL,
		&v.Text, &v.Lang, &v.TweetCreatedAt, &v.IsRetweet, &v.IsQuote,
		&media, &metrics, &v.Tags, &v.Summary, &v.Category, &v.Relevance,
		&v.ClassifyStatus, &v.Read, &v.CapturedAt, &quoted, &relatedAssets)
	if err != nil {
		return nil, err
	}
	if media != nil {
		v.Media = json.RawMessage(media)
	}
	if metrics != nil {
		v.Metrics = json.RawMessage(metrics)
	}
	if quoted != nil {
		v.Quoted = json.RawMessage(quoted)
	}
	if len(relatedAssets) > 0 {
		_ = json.Unmarshal(relatedAssets, &v.RelatedAssets)
	}
	return &v, nil
}

// FeedPage — 时间倒序 + 复合游标分页. 返回 (items, nextCursor, hasMore).
func (r *Repository) FeedPage(ctx context.Context, in FeedInput) ([]TweetView, string, bool, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	var curTime *time.Time
	var curID *string
	if in.Cursor != "" {
		t, id, err := decodeCursor(in.Cursor)
		if err != nil {
			return nil, "", false, fmt.Errorf("bad cursor: %w", err)
		}
		curTime, curID = &t, &id
	}

	// 默认 feed: 按 IncludeRead 过滤未读 + 排除不感兴趣/静音标签. 稍后读 bucket 则只看已存的,
	// 无视已读与减噪过滤 (你存的就给你看). 两种模式共用同一组占位符 ($3 在 saved 模式下不引用, 无妨).
	filter := `($3::boolean OR r.tweet_id IS NULL)
	  AND NOT EXISTS (SELECT 1 FROM tweet_feedback fb WHERE fb.user_id = $1 AND fb.tweet_id = t.id)
	  AND NOT EXISTS (SELECT 1 FROM user_tag_aversion av WHERE av.user_id = $1 AND av.muted AND av.tag = ANY(t.tags))`
	if in.Saved {
		// $3 (IncludeRead) 在 saved 模式逻辑上不用, 但占位符仍须被引用且有类型 ——
		// 否则 PG 推不出 $3 类型, bind 失败. 用恒真的 ($3::boolean OR TRUE) 占位.
		filter = `($3::boolean OR TRUE)
	  AND EXISTS (SELECT 1 FROM tweet_saved ts WHERE ts.user_id = $1 AND ts.tweet_id = t.id)`
	}
	q := tweetViewSelect + `
	WHERE ($2::uuid IS NULL OR s.id = $2)
	  AND ` + filter + `
	  AND ($4::timestamptz IS NULL OR (t.tweet_created_at, t.id) < ($4, $5))
	ORDER BY t.tweet_created_at DESC, t.id DESC
	LIMIT $6
	`
	rows, err := r.pool.Query(ctx, q, in.UserID, in.SubscriptionID, in.IncludeRead, curTime, curID, limit+1)
	if err != nil {
		return nil, "", false, fmt.Errorf("feed page: %w", err)
	}
	defer rows.Close()

	var items []TweetView
	for rows.Next() {
		v, err := scanTweetView(rows)
		if err != nil {
			return nil, "", false, err
		}
		items = append(items, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, "", false, err
	}

	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	next := ""
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = encodeCursor(last.TweetCreatedAt, last.ID)
	}
	return items, next, hasMore, nil
}

// GetTweet — user-scoped 单条 (订阅范围内才可见).
func (r *Repository) GetTweet(ctx context.Context, userID uuid.UUID, tweetID string) (*TweetView, error) {
	rows, err := r.pool.Query(ctx, tweetViewSelect+` WHERE t.id = $2 LIMIT 1`, userID, tweetID)
	if err != nil {
		return nil, fmt.Errorf("get tweet: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	return scanTweetView(rows)
}

// MarkRead — upsert 已读. 推文不在订阅范围 → ErrNotFound.
func (r *Repository) MarkRead(ctx context.Context, userID uuid.UUID, tweetID string) error {
	const q = `
		INSERT INTO tweet_reads (user_id, tweet_id)
		SELECT $1, t.id FROM tweets t
		WHERE t.id = $2 AND EXISTS (
			SELECT 1 FROM subscriptions s
			WHERE s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
			  AND s.user_id = $1 AND s.active)
		ON CONFLICT (user_id, tweet_id) DO NOTHING
	`
	tag, err := r.pool.Exec(ctx, q, userID, tweetID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// 可能是重复已读 (conflict) 或不存在 — 区分一下
		var exists bool
		err := r.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM tweet_reads WHERE user_id = $1 AND tweet_id = $2)`,
			userID, tweetID).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
	}
	return nil
}

// MarkAllRead — 全部已读 (可按订阅 scope). 返回标记数.
func (r *Repository) MarkAllRead(ctx context.Context, userID uuid.UUID, subscriptionID *uuid.UUID) (int, error) {
	const q = `
		INSERT INTO tweet_reads (user_id, tweet_id)
		SELECT $1, t.id
		FROM tweets t
		JOIN subscriptions s ON s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
		     AND s.user_id = $1 AND s.active
		LEFT JOIN tweet_reads r ON r.tweet_id = t.id AND r.user_id = $1
		WHERE r.tweet_id IS NULL AND ($2::uuid IS NULL OR s.id = $2)
		ON CONFLICT (user_id, tweet_id) DO NOTHING
	`
	tag, err := r.pool.Exec(ctx, q, userID, subscriptionID)
	if err != nil {
		return 0, fmt.Errorf("mark all read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *Repository) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `
		SELECT count(*)
		FROM tweets t
		JOIN subscriptions s ON s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
		     AND s.user_id = $1 AND s.active
		LEFT JOIN tweet_reads r ON r.tweet_id = t.id AND r.user_id = $1
		WHERE r.tweet_id IS NULL
		  AND NOT EXISTS (SELECT 1 FROM user_tag_aversion av WHERE av.user_id = $1 AND av.muted AND av.tag = ANY(t.tags))
	`
	var n int
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&n); err != nil {
		return 0, fmt.Errorf("unread count: %w", err)
	}
	return n, nil
}

// ───────────────────────── 不感兴趣 (负反馈) ─────────────────────────

// RecordNotInterested — 一个事务里: 取推文标签 (兼校验在订阅范围内) → 隐藏当条 →
// 逐标签累积厌恶 weight → 跨阈值的标签置 muted → 顺手记已读.
// 返回本次新静音的标签 (供客户端提示). 推文不在范围 → ErrNotFound.
func (r *Repository) RecordNotInterested(ctx context.Context, userID uuid.UUID, tweetID string, muteThreshold int) ([]string, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. 取标签 + 校验订阅范围.
	var tags []string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(t.tags, '{}') FROM tweets t
		WHERE t.id = $2 AND EXISTS (
			SELECT 1 FROM subscriptions s
			WHERE s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
			  AND s.user_id = $1 AND s.active)
	`, userID, tweetID).Scan(&tags)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("not-interested: load tags: %w", err)
	}

	// 2. 隐藏当条.
	if _, err := tx.Exec(ctx, `
		INSERT INTO tweet_feedback (user_id, tweet_id, kind)
		VALUES ($1, $2, 'not_interested')
		ON CONFLICT (user_id, tweet_id) DO NOTHING`, userID, tweetID); err != nil {
		return nil, fmt.Errorf("not-interested: feedback: %w", err)
	}

	// 3. 逐标签累积厌恶.
	for _, tag := range tags {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_tag_aversion (user_id, tag, weight)
			VALUES ($1, $2, 1)
			ON CONFLICT (user_id, tag) DO UPDATE SET
				weight = user_tag_aversion.weight + 1, updated_at = now()`,
			userID, tag); err != nil {
			return nil, fmt.Errorf("not-interested: aversion: %w", err)
		}
	}

	// 4. 跨阈值 → 静音; 收集本次新静音的标签.
	var muted []string
	if len(tags) > 0 {
		rows, err := tx.Query(ctx, `
			UPDATE user_tag_aversion SET muted = true
			WHERE user_id = $1 AND tag = ANY($2) AND weight >= $3 AND NOT muted
			RETURNING tag`, userID, tags, muteThreshold)
		if err != nil {
			return nil, fmt.Errorf("not-interested: mute: %w", err)
		}
		for rows.Next() {
			var tag string
			if err := rows.Scan(&tag); err != nil {
				rows.Close()
				return nil, err
			}
			muted = append(muted, tag)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// 5. 顺手已读 — 不感兴趣的也读过了 (范围已在步骤 1 校验).
	if _, err := tx.Exec(ctx, `
		INSERT INTO tweet_reads (user_id, tweet_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, tweet_id) DO NOTHING`, userID, tweetID); err != nil {
		return nil, fmt.Errorf("not-interested: mark read: %w", err)
	}

	return muted, tx.Commit(ctx)
}

// ───────────────────────── cursor 编解码 ─────────────────────────

func encodeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func decodeCursor(s string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", errors.New("malformed cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}

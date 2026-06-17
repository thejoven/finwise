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

	"wiseflow/server/internal/infra/db"
	"wiseflow/server/internal/infra/xsource"
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
		                    is_retweet, is_quote, media, metrics, raw_payload)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
		metricsJSON, _ := json.Marshal(t.Metrics)
		tag, err := tx.Exec(ctx, q,
			t.ID, accountID, t.Text, t.Lang, createdAt,
			t.IsRetweet, t.IsQuote, media, metricsJSON, []byte(t.Raw))
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

// MarkClassifyFailed — 尝试次数耗尽, 停止重试. 前端照常展示原文 (降级阅读).
func (r *Repository) MarkClassifyFailed(ctx context.Context, tweetID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE tweets SET classify_status = 'failed' WHERE id = $1 AND classify_status = 'pending'`,
		tweetID)
	return err
}

// ───────────────────────── feed / 已读 ─────────────────────────

// FeedInput — cursor 是 (tweet_created_at, id) 复合游标的不透明编码.
type FeedInput struct {
	UserID         uuid.UUID
	SubscriptionID *uuid.UUID
	IncludeRead    bool
	Cursor         string
	Limit          int
}

const tweetViewSelect = `
	SELECT t.id, t.twitter_account_id, s.id, a.handle,
	       COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
	       t.text, COALESCE(t.lang,''), t.tweet_created_at, t.is_retweet, t.is_quote,
	       t.media, t.metrics, t.tags, t.summary, t.category, t.relevance,
	       t.classify_status, (r.tweet_id IS NOT NULL) AS read, t.captured_at
	FROM tweets t
	JOIN twitter_accounts a ON a.id = t.twitter_account_id
	JOIN subscriptions s ON s.source_type = 'twitter' AND s.source_id = t.twitter_account_id
	     AND s.user_id = $1 AND s.active
	LEFT JOIN tweet_reads r ON r.tweet_id = t.id AND r.user_id = $1
`

func scanTweetView(rows pgx.Rows) (*TweetView, error) {
	var v TweetView
	var media, metrics []byte
	err := rows.Scan(&v.ID, &v.AccountID, &v.SubscriptionID, &v.Handle,
		&v.DisplayName, &v.AvatarURL,
		&v.Text, &v.Lang, &v.TweetCreatedAt, &v.IsRetweet, &v.IsQuote,
		&media, &metrics, &v.Tags, &v.Summary, &v.Category, &v.Relevance,
		&v.ClassifyStatus, &v.Read, &v.CapturedAt)
	if err != nil {
		return nil, err
	}
	if media != nil {
		v.Media = json.RawMessage(media)
	}
	if metrics != nil {
		v.Metrics = json.RawMessage(metrics)
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

	q := tweetViewSelect + `
	WHERE ($2::uuid IS NULL OR s.id = $2)
	  AND ($3::boolean OR r.tweet_id IS NULL)
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
	`
	var n int
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&n); err != nil {
		return 0, fmt.Errorf("unread count: %w", err)
	}
	return n, nil
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

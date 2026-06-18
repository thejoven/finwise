// Package admin 是后台运营聚合模块.
//
// 与 account/invite 里零散的 /v1/admin/* 不同, 本模块专做跨表、跨用户的
// 只读聚合 (系统总览 KPI + 研判漏斗 + AI 推断健康), 给 web-admin 运营后台用.
// 全部端点挂 adminV1 (/v1/admin, 已过 Bearer + RequireAdmin), handler 内不再校验.
package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
)

var ErrNotFound = errors.New("not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Overview 是 /v1/admin/stats/overview 的原始计数 (pass_rate 在 service 派生).
// "today" 取服务端日历日 (date_trunc day, now()); "30d" 取近 30 天滚动窗口.
type Overview struct {
	UsersTotal    int
	UsersAdmins   int
	UsersActive7d int

	SignalsTotal   int
	SignalsToday   int
	SignalsPending int
	SignalsFailed  int

	TweetsTotal           int
	TweetsToday           int
	TweetsClassifyPending int
	TweetsClassifyFailed  int

	SubsAccounts int
	SubsActive   int
	PollerLastAt *time.Time

	PipeSignals30d     int
	PipeRefineDone     int
	PipeDistilled      int
	PipeGateTotal      int
	PipeGatePassed     int
	PipeSigned         int
	PipeHoldingsActive int
}

// FetchOverview 一次 round-trip 拉全部计数 (21 个标量子查询).
// 内部低频后台, 简单优先; 大表全表 count 可接受, 必要时再上物化/缓存.
func (r *Repository) FetchOverview(ctx context.Context) (*Overview, error) {
	const q = `
		SELECT
		  (SELECT count(*) FROM users)                                                           AS users_total,
		  (SELECT count(*) FROM users WHERE is_admin)                                            AS users_admins,
		  (SELECT count(DISTINCT user_id) FROM sessions WHERE last_seen_at >= now() - interval '7 days') AS users_active_7d,

		  (SELECT count(*) FROM signals)                                                         AS signals_total,
		  (SELECT count(*) FROM signals WHERE captured_at >= date_trunc('day', now()))           AS signals_today,
		  (SELECT count(*) FROM signals WHERE inference_status = 'pending')                      AS signals_pending,
		  (SELECT count(*) FROM signals WHERE inference_status = 'failed')                       AS signals_failed,

		  (SELECT count(*) FROM tweets)                                                          AS tweets_total,
		  (SELECT count(*) FROM tweets WHERE captured_at >= date_trunc('day', now()))            AS tweets_today,
		  (SELECT count(*) FROM tweets WHERE classify_status = 'pending')                        AS tweets_classify_pending,
		  (SELECT count(*) FROM tweets WHERE classify_status = 'failed')                         AS tweets_classify_failed,

		  (SELECT count(*) FROM twitter_accounts WHERE status = 'active')                        AS subs_accounts,
		  (SELECT count(*) FROM subscriptions WHERE active)                                      AS subs_active,
		  (SELECT max(last_polled_at) FROM twitter_accounts)                                     AS poller_last_at,

		  (SELECT count(*) FROM signals WHERE captured_at >= now() - interval '30 days')         AS pipe_signals_30d,
		  (SELECT count(*) FROM refinement_sessions
		     WHERE status = 'completed' AND completed_at >= now() - interval '30 days')          AS pipe_refine_done,
		  (SELECT count(*) FROM distillations WHERE created_at >= now() - interval '30 days')    AS pipe_distilled,
		  (SELECT count(*) FROM gate_evaluations WHERE evaluated_at >= now() - interval '30 days') AS pipe_gate_total,
		  (SELECT count(*) FROM gate_evaluations
		     WHERE passed AND evaluated_at >= now() - interval '30 days')                        AS pipe_gate_passed,
		  (SELECT count(*) FROM commitments
		     WHERE status = 'signed' AND signed_at >= now() - interval '30 days')                AS pipe_signed,
		  (SELECT count(*) FROM holdings WHERE status = 'active')                                AS pipe_holdings_active
	`
	var o Overview
	err := r.pool.QueryRow(ctx, q).Scan(
		&o.UsersTotal, &o.UsersAdmins, &o.UsersActive7d,
		&o.SignalsTotal, &o.SignalsToday, &o.SignalsPending, &o.SignalsFailed,
		&o.TweetsTotal, &o.TweetsToday, &o.TweetsClassifyPending, &o.TweetsClassifyFailed,
		&o.SubsAccounts, &o.SubsActive, &o.PollerLastAt,
		&o.PipeSignals30d, &o.PipeRefineDone, &o.PipeDistilled,
		&o.PipeGateTotal, &o.PipeGatePassed, &o.PipeSigned, &o.PipeHoldingsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch overview: %w", err)
	}
	return &o, nil
}

// InferenceHealth 是推断健康头部 (计数 + 近 7 天平均时延, 秒).
type InferenceHealth struct {
	Pending int
	Failed  int
	Done    int
	// AvgLatencySeconds 取近 7 天 done 信号的 avg(inference_done_at - captured_at).
	// 无样本时为 nil.
	AvgLatencySeconds *float64
}

// InferenceFailure 是一条失败推断 (signals 表无 error 列, 故只带原文预览 + 时间).
type InferenceFailure struct {
	SignalID    uuid.UUID
	UserID      uuid.UUID
	Email       string
	TextPreview string
	CapturedAt  time.Time
}

func (r *Repository) FetchInferenceHealth(ctx context.Context) (*InferenceHealth, error) {
	const q = `
		SELECT
		  (SELECT count(*) FROM signals WHERE inference_status = 'pending'),
		  (SELECT count(*) FROM signals WHERE inference_status = 'failed'),
		  (SELECT count(*) FROM signals WHERE inference_status = 'done'),
		  (SELECT avg(extract(epoch FROM (inference_done_at - captured_at)))
		     FROM signals
		    WHERE inference_status = 'done'
		      AND inference_done_at IS NOT NULL
		      AND inference_done_at >= now() - interval '7 days')
	`
	var h InferenceHealth
	if err := r.pool.QueryRow(ctx, q).Scan(&h.Pending, &h.Failed, &h.Done, &h.AvgLatencySeconds); err != nil {
		return nil, fmt.Errorf("fetch inference health: %w", err)
	}
	return &h, nil
}

// ListRecentInferenceFailures 最近失败推断 (新→旧), join users 取邮箱.
func (r *Repository) ListRecentInferenceFailures(ctx context.Context, limit int) ([]InferenceFailure, error) {
	if limit <= 0 {
		limit = 20
	}
	const q = `
		SELECT s.id, s.user_id, COALESCE(u.email, ''),
		       left(s.raw_text, 140), s.captured_at
		FROM signals s
		LEFT JOIN users u ON u.id = s.user_id
		WHERE s.inference_status = 'failed'
		ORDER BY s.captured_at DESC
		LIMIT $1
	`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("query inference failures: %w", err)
	}
	defer rows.Close()

	out := make([]InferenceFailure, 0)
	for rows.Next() {
		var f InferenceFailure
		if err := rows.Scan(&f.SignalID, &f.UserID, &f.Email, &f.TextPreview, &f.CapturedAt); err != nil {
			return nil, fmt.Errorf("scan inference failure row: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// UserOverview 是单用户跨域旅程快照 (驱动「聚焦到用户」落地页).
type UserOverview struct {
	ID          uuid.UUID
	Email       string
	DisplayName *string
	IsAdmin     bool
	CreatedAt   time.Time

	SignalsTotal        int
	SignalsPending      int
	SignalsFailed       int
	RefineCompleted     int
	GateTotal           int
	GatePassed          int
	CommitmentsSigned   int
	HoldingsActive      int
	SubscriptionsActive int
	LastSignalAt        *time.Time
}

// FetchUserOverview 跨域 COUNT 聚合一个用户的旅程; 用户不存在 → ErrNotFound.
func (r *Repository) FetchUserOverview(ctx context.Context, userID uuid.UUID) (*UserOverview, error) {
	const q = `
		SELECT u.id, COALESCE(u.email, ''), u.display_name, u.is_admin, u.created_at,
		  (SELECT count(*) FROM signals WHERE user_id = u.id),
		  (SELECT count(*) FROM signals WHERE user_id = u.id AND inference_status = 'pending'),
		  (SELECT count(*) FROM signals WHERE user_id = u.id AND inference_status = 'failed'),
		  (SELECT count(*) FROM refinement_sessions WHERE user_id = u.id AND status = 'completed'),
		  (SELECT count(*) FROM gate_evaluations WHERE user_id = u.id),
		  (SELECT count(*) FROM gate_evaluations WHERE user_id = u.id AND passed),
		  (SELECT count(*) FROM commitments WHERE user_id = u.id AND status = 'signed'),
		  (SELECT count(*) FROM holdings WHERE user_id = u.id AND status = 'active'),
		  (SELECT count(*) FROM subscriptions WHERE user_id = u.id AND active),
		  (SELECT max(captured_at) FROM signals WHERE user_id = u.id)
		FROM users u
		WHERE u.id = $1`
	var o UserOverview
	err := r.pool.QueryRow(ctx, q, userID).Scan(
		&o.ID, &o.Email, &o.DisplayName, &o.IsAdmin, &o.CreatedAt,
		&o.SignalsTotal, &o.SignalsPending, &o.SignalsFailed, &o.RefineCompleted,
		&o.GateTotal, &o.GatePassed, &o.CommitmentsSigned, &o.HoldingsActive,
		&o.SubscriptionsActive, &o.LastSignalAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("fetch user overview: %w", err)
	}
	return &o, nil
}

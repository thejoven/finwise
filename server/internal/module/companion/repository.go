// Package companion is the M9 持仓陪伴 module.
//
// 数据流:
//
//	POST /v1/commitments/:id/open
//	  → 写 events.commitment.opened
//	  → upsert behavioral_fingerprints (open_count++, 重算 classified)
//	  → 如果 classified 升到 anxious_3x/5x 且 companion_shown=false
//	    → 写 events.companion.shown (editor_text = 用户自己 reasons_for_future_self 其中一段)
//	    → 标记 fingerprint.companion_shown=true
//	  → 返回 { opens_today, should_show_companion, fingerprint_id }
//
//	GET /v1/commitments/:id/companion → 返回今天的 companion view (或 204)
//
// Phase 3 v1 简化:
//   - 不用 Redis. 直接 Postgres upsert. 单用户低并发场景 OK.
//   - 不调 LLM. editor_text 从用户自己的 reasons_for_future_self 抽一段.
//     v2 引入 Mastra Editor 给文字"换语气".
package companion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/domain"
	"alphax/server/internal/infra/db"
)

const (
	anxious3xThreshold = 3
	anxious5xThreshold = 5

	classifiedNormal    = "normal"
	classifiedAnxious3x = "anxious_3x"
	classifiedAnxious5x = "anxious_5x"
)

var ErrNotFound = errors.New("commitment not found or not active")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// UserLanguage 取用户语言偏好, 供 M9 Editor 的陪伴文字跟随用户语言. 见 db.UserLanguage.
func (r *Repository) UserLanguage(ctx context.Context, userID uuid.UUID) string {
	return db.UserLanguage(ctx, r.pool, userID)
}

// CompanionView 返回给客户端的当天陪伴.
type CompanionView struct {
	CommitmentID  uuid.UUID
	Reason        domain.CompanionReason
	EditorText    string
	EditorModel   string
	ShownAt       time.Time
	FingerprintID uuid.UUID
}

type OpenResult struct {
	OpensToday          int
	ShouldShowCompanion bool
	FingerprintID       uuid.UUID
	Classified          string
	// Reasons 仅 ShouldShowCompanion=true 时填充, 供 service 给 Mastra Editor (或 fallback) 用
	ReasonsForFutureSelf []string
	CompanionView        *CompanionView // service 调 EmitCompanion 后填回
}

// ───── RecordOpen ─────

type OpenInput struct {
	UserID        uuid.UUID
	CommitmentID  uuid.UUID
	ClientEventID uuid.UUID
	Origin        domain.CommitmentOpenOrigin
	OpenedAt      time.Time // 客户端时钟
}

// RecordOpen 写 commitment.opened, 累加 fingerprint, 必要时同事务发 companion.shown.
func (r *Repository) RecordOpen(ctx context.Context, in OpenInput) (*OpenResult, error) {
	if in.OpenedAt.IsZero() {
		in.OpenedAt = time.Now().UTC()
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 校验 commitment 属于该用户, 且 signed (open 只对已签持仓有意义)
	const verify = `
		SELECT c.id FROM commitments c
		WHERE c.id = $1 AND c.user_id = $2 AND c.status = 'signed'
	`
	var dummy uuid.UUID
	if err := tx.QueryRow(ctx, verify, in.CommitmentID, in.UserID).Scan(&dummy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("verify commitment: %w", err)
	}

	// 拉本地用户时区下的"今天" — Phase 3 v1 用 UTC date (单用户假定 UTC+8 客户端记 ts)
	today := in.OpenedAt.UTC().Format("2006-01-02")

	// 1) 写 events.commitment.opened
	openedPayload := domain.CommitmentOpenedPayload{
		CommitmentID: in.CommitmentID,
		UserID:       in.UserID,
		OpenedAt:     in.OpenedAt,
		OpensToday:   0, // 暂占位, 下面 upsert 后取真实值再写一次? Phase 3 v1: 这里写 0, 真实计数在 fingerprint 表查
		Origin:       in.Origin,
	}
	openedBytes, _ := json.Marshal(openedPayload)

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var openedEventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		in.UserID, in.ClientEventID, string(domain.EventCommitmentOpened), openedBytes, in.OpenedAt,
	).Scan(&openedEventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 重复 client_event_id — 静默成功, 当作"上次已经 record 过这次 open", 不重复计数.
			// 返回当前 fingerprint 状态.
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return r.loadOrEmpty(ctx, in.UserID, in.CommitmentID, today)
		}
		return nil, fmt.Errorf("insert opened event: %w", err)
	}

	// outbox
	if err := insertOutbox(ctx, tx, openedEventID, domain.EventCommitmentOpened, openedBytes); err != nil {
		return nil, err
	}

	// 2) Upsert fingerprint
	fp, err := upsertFingerprint(ctx, tx, in.UserID, in.CommitmentID, today, in.OpenedAt)
	if err != nil {
		return nil, err
	}

	result := &OpenResult{
		OpensToday:    fp.OpenCount,
		FingerprintID: fp.ID,
		Classified:    fp.Classified,
	}

	// 3) 如果到 anxiety 阈值且当天还没发过 companion → 标记 + 拉 reasons,
	//    实际 editor_text + 写 companion.shown event 由 service 层负责 (调 Mastra 不在 tx 里).
	if shouldShow(fp) {
		reasons, err := loadReasons(ctx, tx, in.CommitmentID)
		if err != nil {
			return nil, err
		}
		result.ShouldShowCompanion = true
		result.ReasonsForFutureSelf = reasons
		// CompanionView 由 service.EmitCompanion 在 Mastra 调完后填回
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// EmitCompanion 在 service 调完 Mastra Editor 后, 写 companion.shown event +
// 标记 fingerprint.companion_shown=true. 同一 fingerprint_id 重发 → idempotent (ON CONFLICT).
func (r *Repository) EmitCompanion(ctx context.Context, in EmitCompanionInput) (*CompanionView, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now().UTC()
	payload := domain.CompanionShownPayload{
		CommitmentID:  in.CommitmentID,
		UserID:        in.UserID,
		Reason:        in.Reason,
		ShownAt:       now,
		EditorText:    in.EditorText,
		EditorModel:   in.EditorModel,
		FingerprintID: in.FingerprintID,
	}
	payloadBytes, _ := json.Marshal(payload)

	cid := uuid.NewSHA1(uuid.NameSpaceOID, []byte("companion-shown:"+in.FingerprintID.String()))
	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		in.UserID, cid, string(domain.EventCompanionShown), payloadBytes, now,
	).Scan(&eventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("insert companion.shown: %w", err)
	}
	if eventID > 0 {
		if err := insertOutbox(ctx, tx, eventID, domain.EventCompanionShown, payloadBytes); err != nil {
			return nil, err
		}
	}

	const markShown = `
		UPDATE behavioral_fingerprints
			SET companion_shown = true, updated_at = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, markShown, in.FingerprintID); err != nil {
		return nil, fmt.Errorf("mark companion_shown: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CompanionView{
		CommitmentID:  in.CommitmentID,
		Reason:        in.Reason,
		EditorText:    in.EditorText,
		EditorModel:   in.EditorModel,
		ShownAt:       now,
		FingerprintID: in.FingerprintID,
	}, nil
}

// EmitCompanionInput is the data needed by service.EmitCompanion.
type EmitCompanionInput struct {
	UserID        uuid.UUID
	CommitmentID  uuid.UUID
	FingerprintID uuid.UUID
	Reason        domain.CompanionReason
	EditorText    string
	EditorModel   string
}

// GetCompanionToday returns today's companion view if companion_shown=true; nil otherwise.
func (r *Repository) GetCompanionToday(ctx context.Context, userID, commitmentID uuid.UUID) (*CompanionView, error) {
	today := time.Now().UTC().Format("2006-01-02")
	// 找 fingerprint
	const q = `
		SELECT id, open_count, classified, companion_shown
		FROM behavioral_fingerprints
		WHERE user_id = $1 AND commitment_id = $2 AND date = $3
	`
	var (
		fpID       uuid.UUID
		openCount  int
		classified *string
		shown      bool
	)
	if err := r.pool.QueryRow(ctx, q, userID, commitmentID, today).Scan(&fpID, &openCount, &classified, &shown); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get fingerprint: %w", err)
	}
	if !shown {
		return nil, nil
	}
	// 找 events.companion.shown for this fp
	const qEvent = `
		SELECT payload FROM events
		WHERE type = $1 AND (payload->>'fingerprint_id')::uuid = $2
		ORDER BY occurred_at DESC LIMIT 1
	`
	var raw json.RawMessage
	if err := r.pool.QueryRow(ctx, qEvent, string(domain.EventCompanionShown), fpID).Scan(&raw); err != nil {
		return nil, fmt.Errorf("get companion event: %w", err)
	}
	var p domain.CompanionShownPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	return &CompanionView{
		CommitmentID:  p.CommitmentID,
		Reason:        p.Reason,
		EditorText:    p.EditorText,
		EditorModel:   p.EditorModel,
		ShownAt:       p.ShownAt,
		FingerprintID: p.FingerprintID,
	}, nil
}

// ───── helpers ─────

type fingerprintRow struct {
	ID             uuid.UUID
	OpenCount      int
	Classified     string
	CompanionShown bool
}

func upsertFingerprint(ctx context.Context, tx pgx.Tx, userID, commitID uuid.UUID, date string, openedAt time.Time) (*fingerprintRow, error) {
	const upsert = `
		INSERT INTO behavioral_fingerprints
			(id, user_id, commitment_id, date, open_count, open_first_at, open_last_at, classified, companion_shown)
		VALUES ($1, $2, $3, $4, 1, $5, $5, $6, false)
		ON CONFLICT (user_id, commitment_id, date) DO UPDATE
			SET open_count    = behavioral_fingerprints.open_count + 1,
			    open_last_at  = EXCLUDED.open_last_at,
			    classified    = CASE
			                      WHEN behavioral_fingerprints.open_count + 1 >= 5 THEN 'anxious_5x'
			                      WHEN behavioral_fingerprints.open_count + 1 >= 3 THEN 'anxious_3x'
			                      ELSE 'normal'
			                    END,
			    updated_at    = NOW()
		RETURNING id, open_count, COALESCE(classified, 'normal'), companion_shown
	`
	row := tx.QueryRow(ctx, upsert,
		uuid.New(), userID, commitID, date, openedAt, classifiedNormal,
	)
	var fp fingerprintRow
	if err := row.Scan(&fp.ID, &fp.OpenCount, &fp.Classified, &fp.CompanionShown); err != nil {
		return nil, fmt.Errorf("upsert fingerprint: %w", err)
	}
	return &fp, nil
}

func shouldShow(fp *fingerprintRow) bool {
	if fp.CompanionShown {
		return false
	}
	return fp.OpenCount >= anxious3xThreshold
}

// loadReasons 从 commitments.thesis 拉出 reasons_for_future_self.
// service 决定: 给 Mastra Editor 当输入, 或 fallback 时自己抽一条.
func loadReasons(ctx context.Context, tx pgx.Tx, commitID uuid.UUID) ([]string, error) {
	const q = `SELECT thesis FROM commitments WHERE id = $1`
	var thesisRaw []byte
	if err := tx.QueryRow(ctx, q, commitID).Scan(&thesisRaw); err != nil {
		return nil, fmt.Errorf("load thesis: %w", err)
	}
	var t domain.Thesis
	if err := json.Unmarshal(thesisRaw, &t); err != nil {
		return nil, err
	}
	if len(t.ReasonsForFutureSelf) == 0 {
		// 退到 entry_method 当唯一一段
		if t.EntryMethod != "" {
			return []string{t.EntryMethod}, nil
		}
		return nil, nil
	}
	return t.ReasonsForFutureSelf, nil
}

// FallbackEditorText picks one reason at random — used by service when Mastra is down.
func FallbackEditorText(reasons []string) (text, model string) {
	if len(reasons) == 0 {
		return "你当时签字了. 没有任何退出条件被触发.", "fallback-empty"
	}
	idx := rand.Intn(len(reasons))
	return reasons[idx], "fallback-reason-quote"
}

// LoadCommitmentAssetName fetches asset_name from a signed commitment, used by service
// when calling Mastra Editor.
func (r *Repository) LoadCommitmentAssetName(ctx context.Context, commitID uuid.UUID) (string, error) {
	const q = `SELECT thesis->>'asset_name' FROM commitments WHERE id = $1`
	var name string
	if err := r.pool.QueryRow(ctx, q, commitID).Scan(&name); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return name, nil
}

func (r *Repository) loadOrEmpty(ctx context.Context, userID, commitID uuid.UUID, date string) (*OpenResult, error) {
	const q = `
		SELECT id, open_count, COALESCE(classified, 'normal'), companion_shown
		FROM behavioral_fingerprints
		WHERE user_id = $1 AND commitment_id = $2 AND date = $3
	`
	var fp fingerprintRow
	if err := r.pool.QueryRow(ctx, q, userID, commitID, date).Scan(&fp.ID, &fp.OpenCount, &fp.Classified, &fp.CompanionShown); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &OpenResult{}, nil
		}
		return nil, err
	}
	return &OpenResult{
		OpensToday:          fp.OpenCount,
		FingerprintID:       fp.ID,
		Classified:          fp.Classified,
		ShouldShowCompanion: fp.CompanionShown,
	}, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventID int64, et domain.EventType, payload []byte) error {
	const q = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, q, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}

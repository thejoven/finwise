// Package distillation 是"降噪页"模块.
//
// 数据流: refinement.completed → mastra post-refinement workflow (distiller +
// beneficiary 两个 agent) → POST 回 server (/v1/internal/distillation) → 本模块
// upsert 一行 distillations. 用户进降噪页时 GET /v1/distillations/:refinement_id 读.
//
// distiller 与 beneficiary 各自异步完成、各 POST 一次 (只带自己那部分字段), 用
// COALESCE 合并 — 所以降噪综述能先到先显示, 金融信号后到再补.
//
// 注: distillation 是"派生分析"投影 (同 attention_summaries), 不写 events 表 ——
// 它不是领域事件, 是 refinement 完成后跑出来的解读. events 表只装领域事件.
package distillation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
)

var ErrNotFound = errors.New("distillation not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Distillation 是一条降噪页记录.
//   - DistilledContent nil → distiller 还没写回
//   - Beneficiary      nil → 金融 agent 还在推演; len()==2 的 "[]" → 推演完无受益映射 (沉默)
type Distillation struct {
	RefinementID     uuid.UUID
	UserID           uuid.UUID
	DistilledContent *string
	Beneficiary      json.RawMessage
	BeneficiaryNote  *string
	Model            string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// UpsertInput — mastra 写回; distiller / beneficiary 各调一次, 只带自己那部分字段.
// nil 字段表示"这次不更新", repository 用 COALESCE 保留已有值.
type UpsertInput struct {
	RefinementID     uuid.UUID
	UserID           uuid.UUID
	DistilledContent *string
	Beneficiary      json.RawMessage
	BeneficiaryNote  *string
	Model            string
}

func (r *Repository) Upsert(ctx context.Context, in UpsertInput) (*Distillation, error) {
	const q = `
		INSERT INTO distillations
			(refinement_id, user_id, distilled_content, beneficiary, beneficiary_note, model)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (refinement_id) DO UPDATE SET
			distilled_content = COALESCE(EXCLUDED.distilled_content, distillations.distilled_content),
			beneficiary       = COALESCE(EXCLUDED.beneficiary, distillations.beneficiary),
			beneficiary_note  = COALESCE(EXCLUDED.beneficiary_note, distillations.beneficiary_note),
			model             = EXCLUDED.model,
			updated_at        = now()
		RETURNING created_at, updated_at
	`
	// nil RawMessage → SQL NULL (= "这部分还没算"); 要表达"算完但沉默"传 []byte("[]").
	var benef any
	if in.Beneficiary != nil {
		benef = []byte(in.Beneficiary)
	}
	var createdAt, updatedAt time.Time
	err := r.pool.QueryRow(ctx, q,
		in.RefinementID, in.UserID, in.DistilledContent, benef, in.BeneficiaryNote, in.Model,
	).Scan(&createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert distillation: %w", err)
	}
	return &Distillation{
		RefinementID:     in.RefinementID,
		UserID:           in.UserID,
		DistilledContent: in.DistilledContent,
		Beneficiary:      in.Beneficiary,
		BeneficiaryNote:  in.BeneficiaryNote,
		Model:            in.Model,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

// GetByRefinement — 降噪页读. user_id 进 WHERE 即 ownership 校验.
func (r *Repository) GetByRefinement(ctx context.Context, userID, refinementID uuid.UUID) (*Distillation, error) {
	const q = `
		SELECT refinement_id, user_id, distilled_content, beneficiary, beneficiary_note,
		       model, created_at, updated_at
		FROM distillations
		WHERE refinement_id = $1 AND user_id = $2
	`
	var d Distillation
	var benef []byte
	err := r.pool.QueryRow(ctx, q, refinementID, userID).Scan(
		&d.RefinementID, &d.UserID, &d.DistilledContent, &benef, &d.BeneficiaryNote,
		&d.Model, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get distillation: %w", err)
	}
	if benef != nil {
		d.Beneficiary = json.RawMessage(benef)
	}
	return &d, nil
}

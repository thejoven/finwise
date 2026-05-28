package domain

import (
	"time"

	"github.com/google/uuid"
)

// Phase 2 payload structs.
//
// 这些是 events.payload JSONB 列里存的结构, 也是 NATS 消息体. 字段命名跟
// Phase 2 IMPLEMENTATION_PLAN.md § 2.1 对齐, JSON tag 用 snake_case 与 Phase 1 一致.
//
// 设计约束 (摘自 plan):
//   - 不复制 user_id 进 payload (events.user_id 列已经有), 但 NATS 消息要带
//     (消费者不必 join events 表) — 通过单独的 NATS envelope 包一层处理.
//   - 时间戳全 UTC RFC3339.
//   - causation_id 在 events 列里维护, payload 里不再重复.

// ───── M5 · refinement ─────

// QuestionKind 是 Socratic Agent 返回的题型.
type QuestionKind string

const (
	QuestionKindSingle           QuestionKind = "single"
	QuestionKindMulti            QuestionKind = "multi"
	QuestionKindOrdering         QuestionKind = "ordering"
	QuestionKindOpen             QuestionKind = "open"
	QuestionKindCommitmentSetup  QuestionKind = "commitment_setup" // r5 · 收集 action + duration + 理由
)

// AnswerDiagnosisKind 是对用户答题的诊断 (不是"标准答案对错", 是"训练信号").
type AnswerDiagnosisKind string

const (
	DiagnosisCorrect     AnswerDiagnosisKind = "correct"
	DiagnosisPartialMiss AnswerDiagnosisKind = "partial_miss"
	DiagnosisDistractor  AnswerDiagnosisKind = "distractor"
	DiagnosisWeak        AnswerDiagnosisKind = "weak"
)

// RefinementDecision 是五轮结束后, Socratic 给出的"是否进入四道门"判断.
type RefinementDecision string

const (
	RefinementEligibleForGate RefinementDecision = "eligible_for_gate"
	RefinementTrainingOnly    RefinementDecision = "training_only"
)

type RefinementStartedPayload struct {
	RefinementID uuid.UUID   `json:"refinement_id"`
	UserID       uuid.UUID   `json:"user_id"`
	SignalIDs    []uuid.UUID `json:"signal_ids"`
	PrimaryAsset *string     `json:"primary_asset,omitempty"`
	StartedAt    time.Time   `json:"started_at"`
}

// QuestionOption 是非 open 题型的选项. is_distractor 用于诊断, 不展示给用户.
// Group 仅 commitment_setup (r5) 用 — "action" 或 "duration", 客户端按 group 分两组单选渲染.
// IsUserInput 仅 rounds 1-4 用 — 标记"用户自填"兜底选项, 客户端选中后展开文本框.
type QuestionOption struct {
	ID           string `json:"id"`
	Text         string `json:"text"`
	IsDistractor bool   `json:"is_distractor"`
	IsRequired   bool   `json:"is_required"`
	IsUserInput  bool   `json:"is_user_input,omitempty"`
	Group        string `json:"group,omitempty"` // "action" | "duration" | ""
}

type UserAnswer struct {
	ChoiceIDs []string `json:"choice_ids,omitempty"`
	OpenText  *string  `json:"open_text,omitempty"`
	TimeMS    int      `json:"time_ms"` // 用户读题到点提交的耗时
}

type AnswerDiagnosis struct {
	Kind AnswerDiagnosisKind `json:"kind"`
	Note *string             `json:"note,omitempty"`
}

type RefinementAnsweredPayload struct {
	RefinementID uuid.UUID        `json:"refinement_id"`
	UserID       uuid.UUID        `json:"user_id"`
	Round        int              `json:"round"`         // 1..5
	QuestionID   string           `json:"question_id"`
	QuestionKind QuestionKind     `json:"question_kind"`
	QuestionText string           `json:"question_text"`
	Options      []QuestionOption `json:"options,omitempty"`
	Answer       UserAnswer       `json:"user_answer"`
	Diagnosis    AnswerDiagnosis  `json:"diagnosis"`
	AnsweredAt   time.Time        `json:"answered_at"`
}

type RefinementCompletedPayload struct {
	RefinementID uuid.UUID          `json:"refinement_id"`
	UserID       uuid.UUID          `json:"user_id"`
	RoundsDone   int                `json:"rounds_done"`
	EndedEarly   bool               `json:"ended_early"`
	Decision     RefinementDecision `json:"decision"`
	EndedAt      time.Time          `json:"ended_at"`
}

// ───── M6 · gates ─────

// ArchivePool 是沉默归档的四个池.
type ArchivePool string

const (
	PoolObservation ArchivePool = "observation"
	PoolLesson      ArchivePool = "lesson"
	PoolCalendar    ArchivePool = "calendar"
	PoolDiscard     ArchivePool = "discard"
)

// GateDetail 是四道门各自的判据. 灵活字段用 map.
// 物化到 gate_evaluations.gates_detail JSONB.
type GateDetail struct {
	G1Thickness     GateG1 `json:"g1_thickness"`
	G2AntiConsensus GateG2 `json:"g2_anti_consensus"`
	G3Window        GateG3 `json:"g3_window"`
	G4Edge          GateG4 `json:"g4_edge"`
}

type GateG1 struct {
	Pass   bool    `json:"pass"`
	Count  int     `json:"count"`
	Detail *string `json:"detail,omitempty"`
}

type GateG2 struct {
	Pass   bool    `json:"pass"`
	Score  int     `json:"score"` // 0..100
	Detail *string `json:"detail,omitempty"`
}

type GateG3 struct {
	Pass   bool    `json:"pass"`
	Months float64 `json:"months"`
	Detail *string `json:"detail,omitempty"`
}

type GateG4Sub struct {
	Explain     bool `json:"explain"`
	Direct      bool `json:"direct"`
	TrackRecord bool `json:"track_record"`
	ExitKnown   bool `json:"exit_known"`
}

type GateG4 struct {
	Pass   bool       `json:"pass"`
	Sub    GateG4Sub  `json:"sub"`
	Detail *string    `json:"detail,omitempty"`
}

type GateEvaluatedPayload struct {
	EvaluationID uuid.UUID    `json:"evaluation_id"`
	UserID       uuid.UUID    `json:"user_id"`
	RefinementID uuid.UUID    `json:"refinement_id"`
	Gates        GateDetail   `json:"gates"`
	Passed       bool         `json:"passed"`
	FailedGate   *int         `json:"failed_gate,omitempty"` // 1..4
	ArchivedPool *ArchivePool `json:"archived_pool,omitempty"`
	EvaluatedAt  time.Time    `json:"evaluated_at"`
}

type GateArchivedPayload struct {
	EvaluationID uuid.UUID   `json:"evaluation_id"`
	UserID       uuid.UUID   `json:"user_id"`
	Pool         ArchivePool `json:"pool"`
	FailedGate   int         `json:"failed_gate"` // 1..4
	HumanReason  string      `json:"human_reason"`
	ArchivedAt   time.Time   `json:"archived_at"`
}

// ───── M7/M8 · commitment ─────

// CommitmentAction 是承诺书的核心动作.
type CommitmentAction string

const (
	CommitmentBuy  CommitmentAction = "buy"
	CommitmentSell CommitmentAction = "sell"
	CommitmentHold CommitmentAction = "hold"
)

// Thesis 是承诺书的内容. 物化到 commitments.thesis JSONB.
// ReasonsForFutureSelf 必须字符级 verbatim 引用历史 signal 原话 — workflow 层校验.
type Thesis struct {
	AssetTicker          string           `json:"asset_ticker"`
	AssetName            string           `json:"asset_name"`
	Action               CommitmentAction `json:"action"`
	PositionPct          float64          `json:"position_pct"`      // 0..100
	DurationMonths       int              `json:"duration_months"`   // 1..36
	EntryMethod          string           `json:"entry_method"`      // ≤ 100 字
	ExitConditions       []string         `json:"exit_conditions"`   // 2..4 条
	ReasonsForFutureSelf []string         `json:"reasons_for_future_self"` // 3..5 条
}

type CommitmentDraftedPayload struct {
	CommitmentID uuid.UUID `json:"commitment_id"`
	UserID       uuid.UUID `json:"user_id"`
	EvaluationID uuid.UUID `json:"evaluation_id"`
	Thesis       Thesis    `json:"thesis"`
	Model        string    `json:"model"`
	DraftedAt    time.Time `json:"drafted_at"`
}

type CommitmentSignedPayload struct {
	CommitmentID    uuid.UUID `json:"commitment_id"`
	UserID          uuid.UUID `json:"user_id"`
	SignedAt        time.Time `json:"signed_at"`
	SigningClientID string    `json:"signing_client_id"` // 防双击的客户端幂等 key
}

type CommitmentPostponedPayload struct {
	CommitmentID uuid.UUID `json:"commitment_id"`
	UserID       uuid.UUID `json:"user_id"`
	Count        int       `json:"count"`           // 1..3
	Reason       *string   `json:"reason,omitempty"`
	PostponedAt  time.Time `json:"postponed_at"`
}

type CommitmentAbandonReason string

const (
	AbandonPostponeThreshold CommitmentAbandonReason = "postpone_threshold"
	AbandonManual            CommitmentAbandonReason = "manual"
)

type CommitmentAbandonedPayload struct {
	CommitmentID uuid.UUID               `json:"commitment_id"`
	UserID       uuid.UUID               `json:"user_id"`
	ReasonKind   CommitmentAbandonReason `json:"reason_kind"`
	AbandonedAt  time.Time               `json:"abandoned_at"`
}

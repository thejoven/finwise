package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Phase 3 payload structs.
//
// 对齐 docs/GOAL/phase-3-mirror/IMPLEMENTATION_PLAN.md § 2.1. JSON tag snake_case.

// ───── M9 · companion ─────

type CompanionReason string

const (
	CompanionAnxiety3x CompanionReason = "anxiety_3x"
	CompanionAnxiety5x CompanionReason = "anxiety_5x"
	CompanionManual    CompanionReason = "manual"
)

type CommitmentOpenOrigin string

const (
	OpenOriginDeeplink    CommitmentOpenOrigin = "deeplink"
	OpenOriginTab         CommitmentOpenOrigin = "tab"
	OpenOriginTriggerCard CommitmentOpenOrigin = "trigger_card"
)

type CommitmentOpenedPayload struct {
	CommitmentID uuid.UUID            `json:"commitment_id"`
	UserID       uuid.UUID            `json:"user_id"`
	OpenedAt     time.Time            `json:"opened_at"`
	OpensToday   int                  `json:"opens_today"`
	Origin       CommitmentOpenOrigin `json:"origin"`
}

type CompanionShownPayload struct {
	CommitmentID  uuid.UUID       `json:"commitment_id"`
	UserID        uuid.UUID       `json:"user_id"`
	Reason        CompanionReason `json:"reason"`
	ShownAt       time.Time       `json:"shown_at"`
	EditorText    string          `json:"editor_text"`
	EditorModel   string          `json:"editor_model"`
	FingerprintID uuid.UUID       `json:"fingerprint_id"`
}

type CompanionExitStep string

const (
	ExitInsistStarted    CompanionExitStep = "started"
	ExitInsistQuestioned CompanionExitStep = "questioned"
	ExitInsistConfirmed  CompanionExitStep = "confirmed"
)

type CompanionExitInsistedPayload struct {
	CommitmentID uuid.UUID         `json:"commitment_id"`
	UserID       uuid.UUID         `json:"user_id"`
	InsistedAt   time.Time         `json:"insisted_at"`
	Step         CompanionExitStep `json:"step"`
	Reasons      []string          `json:"reasons,omitempty"`
}

// ───── M10 · exit monitor ─────

type ExitEvaluator string

const (
	EvaluatorPrice       ExitEvaluator = "price"
	EvaluatorTime        ExitEvaluator = "time"
	EvaluatorFundamental ExitEvaluator = "fundamental"
)

type ExitCheckResult string

const (
	ExitCheckMiss ExitCheckResult = "miss"
	ExitCheckHit  ExitCheckResult = "hit"
)

type ExitConditionCheckedPayload struct {
	CommitmentID uuid.UUID       `json:"commitment_id"`
	UserID       uuid.UUID       `json:"user_id"`
	ConditionID  uuid.UUID       `json:"condition_id"`
	Evaluator    ExitEvaluator   `json:"evaluator"`
	Result       ExitCheckResult `json:"result"`
	Observed     json.RawMessage `json:"observed"`
	CheckedAt    time.Time       `json:"checked_at"`
}

type ExitConditionTriggeredPayload struct {
	CommitmentID  uuid.UUID       `json:"commitment_id"`
	UserID        uuid.UUID       `json:"user_id"`
	ConditionID   uuid.UUID       `json:"condition_id"`
	ConditionText string          `json:"condition_text"`
	Observed      json.RawMessage `json:"observed"`
	TriggeredAt   time.Time       `json:"triggered_at"`
}

type HoldingStateChangedPayload struct {
	CommitmentID   uuid.UUID `json:"commitment_id"`
	UserID         uuid.UUID `json:"user_id"`
	From           string    `json:"from"`
	To             string    `json:"to"`
	TriggerEventID *int64    `json:"trigger_event_id,omitempty"`
	Reason         string    `json:"reason"`
	ChangedAt      time.Time `json:"changed_at"`
}

// ───── M11 · retrospect ─────

type RetrospectTrigger string

const (
	RetrospectTriggerExpired RetrospectTrigger = "expired"
	RetrospectTriggerClosed  RetrospectTrigger = "closed"
	RetrospectTriggerManual  RetrospectTrigger = "manual"
)

type RetrospectStartedPayload struct {
	RetrospectID uuid.UUID         `json:"retrospect_id"`
	CommitmentID uuid.UUID         `json:"commitment_id"`
	UserID       uuid.UUID         `json:"user_id"`
	StartedAt    time.Time         `json:"started_at"`
	Trigger      RetrospectTrigger `json:"trigger"`
}

type RetrospectDimension string

const (
	DimPerception RetrospectDimension = "perception"
	DimInference  RetrospectDimension = "inference"
	DimEvaluation RetrospectDimension = "evaluation"
	DimExecution  RetrospectDimension = "execution"
)

type RetrospectAnsweredPayload struct {
	RetrospectID uuid.UUID           `json:"retrospect_id"`
	UserID       uuid.UUID           `json:"user_id"`
	QuestionNo   int                 `json:"question_no"` // 1..4
	QuestionDim  RetrospectDimension `json:"question_dim"`
	Choice       string              `json:"choice"`
	OpenText     *string             `json:"open_text,omitempty"`
	AnsweredAt   time.Time           `json:"answered_at"`
}

type FocusDim string

const (
	FocusPerceptionSpeed FocusDim = "perception_speed"
	FocusInferenceDepth  FocusDim = "inference_depth"
	FocusDecisionSpeed   FocusDim = "decision_speed"
	FocusHoldingPatience FocusDim = "holding_patience"
	FocusExitQuality     FocusDim = "exit_quality"
	FocusThesisEvolution FocusDim = "thesis_evolution"
)

type RetrospectFinalizedPayload struct {
	RetrospectID       uuid.UUID `json:"retrospect_id"`
	UserID             uuid.UUID `json:"user_id"`
	FocusDim           FocusDim  `json:"focus_dim"`
	FocusText          string    `json:"focus_text"`
	DiagnosticianModel string    `json:"diagnostician_model"`
	FinalizedAt        time.Time `json:"finalized_at"`
}

type TrainingFocusUpdatedPayload struct {
	UserID       uuid.UUID `json:"user_id"`
	RetrospectID uuid.UUID `json:"retrospect_id"`
	FocusDim     FocusDim  `json:"focus_dim"`
	FocusText    string    `json:"focus_text"`
	AppliesFrom  time.Time `json:"applies_from"`
}

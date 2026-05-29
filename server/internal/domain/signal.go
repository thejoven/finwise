package domain

import (
	"time"

	"github.com/google/uuid"
)

// InferenceStatus is the lifecycle marker for a signal's AI inference.
type InferenceStatus string

const (
	InferenceStatusPending InferenceStatus = "pending"
	InferenceStatusDone    InferenceStatus = "done"
	InferenceStatusFailed  InferenceStatus = "failed"
)

// Signal is the materialized view derived from signal.captured +
// signal.inference.done events.
type Signal struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	ProjectID     *uuid.UUID // 可选; null = 未分类
	RawText       string
	CapturedAt    time.Time
	SourceEventID int64

	InferenceStatus  InferenceStatus
	InferenceSummary *string
	InferenceTags    []string
	InferenceModel   *string
	InferenceDoneAt  *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

// SignalCapturedPayload is the JSON body of a signal.captured event.
// Matches the NATS message published by the outbox worker.
type SignalCapturedPayload struct {
	SignalID   uuid.UUID  `json:"signal_id"`
	UserID     uuid.UUID  `json:"user_id"`
	ProjectID  *uuid.UUID `json:"project_id,omitempty"`
	RawText    string     `json:"raw_text"`
	CapturedAt time.Time  `json:"captured_at"`
}

// SignalInferenceDonePayload is the JSON body of a signal.inference.done event.
type SignalInferenceDonePayload struct {
	SignalID      uuid.UUID       `json:"signal_id"`
	UserID        uuid.UUID       `json:"user_id"`
	Summary       string          `json:"summary"`
	Tags          []string        `json:"tags"`
	Model         string          `json:"model"`
	RelatedAssets []RelatedAsset  `json:"related_assets,omitempty"`
	Layer         *CognitiveLayer `json:"cognitive_layer,omitempty"`
	Consensus     *ConsensusCheck `json:"consensus_check,omitempty"`
}

// RelatedAsset is one ticker the analyst tagged.
type RelatedAsset struct {
	Ticker    string         `json:"ticker"`
	Rationale string         `json:"rationale"`
	Order     CognitiveLayer `json:"order"`
}

type CognitiveLayer string

const (
	LayerFirst  CognitiveLayer = "first"
	LayerSecond CognitiveLayer = "second"
	LayerThird  CognitiveLayer = "third"
)

type ConsensusCheck string

const (
	ConsensusLeading ConsensusCheck = "leading"
	ConsensusAligned ConsensusCheck = "aligned"
	ConsensusLagging ConsensusCheck = "lagging"
)

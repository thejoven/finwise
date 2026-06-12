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
	ID        uuid.UUID
	UserID    uuid.UUID
	ProjectID *uuid.UUID // 可选; null = 未分类
	// ProjectAutoAssigned: true = 系统临时归类 (promote 兜底落到第一个分类), AI 推演可覆盖;
	// false = 用户手选, AI 不覆盖. 见 signal 模块 resolveInferenceProject.
	ProjectAutoAssigned bool
	RawText             string
	CapturedAt          time.Time
	SourceEventID       int64

	InferenceStatus  InferenceStatus
	InferenceSummary *string
	InferenceTags    []string
	InferenceModel   *string
	InferenceDoneAt  *time.Time
	// 推演出的相关标的 (Analyst related_assets). 016 起落 signals 表; 历史从 events 回填.
	// 空/无标的 → nil. "信号" tab 按它非空筛选 + 展示标的.
	InferenceRelatedAssets []RelatedAsset

	CreatedAt time.Time
	UpdatedAt time.Time
}

// ProjectCandidate 是 signal.captured 事件里携带的"候选分类"快照 (仅当信号未分类时下发),
// 供 mastra analyst 判断该信号最该归入哪个分类. guidance 截断后下发, 控制事件体积.
type ProjectCandidate struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Guidance *string   `json:"guidance,omitempty"`
}

// SignalCapturedPayload is the JSON body of a signal.captured event.
// Matches the NATS message published by the outbox worker.
//
// ProjectName / ProjectGuidance 是捕获那一刻分类的快照, 供 mastra analyst 按分类推理.
// 快照而非引用: 之后改 guidance 不回填历史事件 (signal-inference 用的是当时的指引).
//
// 信号未分类时 (ProjectID == nil) 改下发 CandidateProjects 候选集, 让 analyst 判断归属.
// ProjectAutoAssigned 标记"系统临时归类"(promote 兜底), 供回写时决定 AI 是否可覆盖.
type SignalCapturedPayload struct {
	SignalID            uuid.UUID          `json:"signal_id"`
	UserID              uuid.UUID          `json:"user_id"`
	ProjectID           *uuid.UUID         `json:"project_id,omitempty"`
	ProjectName         *string            `json:"project_name,omitempty"`
	ProjectGuidance     *string            `json:"project_guidance,omitempty"`
	ProjectAutoAssigned bool               `json:"project_auto_assigned,omitempty"`
	CandidateProjects   []ProjectCandidate `json:"candidate_projects,omitempty"`
	RawText             string             `json:"raw_text"`
	CapturedAt          time.Time          `json:"captured_at"`
}

// SignalInferenceDonePayload is the JSON body of a signal.inference.done event.
//
// ProjectID 是推演回写时 resolved 后的最终分类 (AI 选中 / 兜底 / 保留用户手选).
// 事件溯源: 必须落最终值, 重放 signals 投影才不发散.
type SignalInferenceDonePayload struct {
	SignalID      uuid.UUID       `json:"signal_id"`
	UserID        uuid.UUID       `json:"user_id"`
	Summary       string          `json:"summary"`
	Tags          []string        `json:"tags"`
	Model         string          `json:"model"`
	RelatedAssets []RelatedAsset  `json:"related_assets,omitempty"`
	Layer         *CognitiveLayer `json:"cognitive_layer,omitempty"`
	Consensus     *ConsensusCheck `json:"consensus_check,omitempty"`
	ProjectID     *uuid.UUID      `json:"project_id,omitempty"`
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

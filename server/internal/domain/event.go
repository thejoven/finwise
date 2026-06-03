// Package domain holds the pure business types.
// No infra deps (no db, no http, no log libs) — keeps the domain portable.
package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// EventType is the discriminator stored in events.type.
// Add new constants here as modules land; never rename emitted values.
type EventType string

const (
	// Phase 1 · 安静
	EventSignalCaptured      EventType = "signal.captured"
	EventSignalInferenceDone EventType = "signal.inference.done"

	// Phase 2 · 仪式
	EventRefinementStarted   EventType = "refinement.started"
	EventRefinementAnswered  EventType = "refinement.answered"
	EventRefinementCompleted EventType = "refinement.completed"
	EventGateEvaluated       EventType = "gate.evaluated"
	EventGateArchived        EventType = "gate.archived"
	EventCommitmentDrafted   EventType = "commitment.drafted"
	EventCommitmentSigned    EventType = "commitment.signed"
	EventCommitmentPostponed EventType = "commitment.postponed"
	EventCommitmentAbandoned EventType = "commitment.abandoned"

	// Phase 3 · 镜子
	EventCommitmentOpened       EventType = "commitment.opened"        // M9
	EventCompanionShown         EventType = "companion.shown"          // M9
	EventCompanionExitInsisted  EventType = "companion.exit_insisted"  // M9
	EventExitConditionChecked   EventType = "exit.condition.checked"   // M10
	EventExitConditionTriggered EventType = "exit.condition.triggered" // M10
	EventHoldingStateChanged    EventType = "holding.state_changed"    // M10
	EventRetrospectStarted      EventType = "retrospect.started"       // M11
	EventRetrospectAnswered     EventType = "retrospect.answered"      // M11
	EventRetrospectFinalized    EventType = "retrospect.finalized"     // M11
	EventTrainingFocusUpdated   EventType = "training.focus.updated"   // M11.5
)

// Event mirrors a row in the events table.
// Nullable columns use pointer types so zero values aren't confused with absence.
type Event struct {
	ID            int64
	UserID        uuid.UUID
	ClientEventID uuid.UUID
	Type          EventType
	Payload       json.RawMessage

	OccurredAt time.Time
	RecordedAt time.Time

	CausationID   *int64
	CorrelationID *uuid.UUID
	RelatedAsset  *string
	RelatedThesis *uuid.UUID
}

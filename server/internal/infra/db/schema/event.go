// Package schema describes the Ent schema for read-side access.
// IMPORTANT: Ent's auto-migrate is intentionally NOT used. The truth lives in
// server/migrations/*.sql; Ent only inspects, never mutates.
// See docs/adr/0001-ent-orm.md.
package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/google/uuid"
)

type Event struct {
	ent.Schema
}

func (Event) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "events"},
	}
}

func (Event) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id").
			Immutable().
			SchemaType(map[string]string{"postgres": "BIGSERIAL"}),

		field.UUID("user_id", uuid.UUID{}).Immutable(),
		field.UUID("client_event_id", uuid.UUID{}).Immutable(),

		field.String("type").Immutable(),
		field.Bytes("payload").
			Immutable().
			SchemaType(map[string]string{"postgres": "JSONB"}),

		field.Time("occurred_at").Immutable(),
		field.Time("recorded_at").
			Default(time.Now).
			Immutable(),

		field.Int64("causation_id").Optional().Nillable().Immutable(),
		field.UUID("correlation_id", uuid.UUID{}).Optional().Nillable().Immutable(),

		field.String("related_asset").Optional().Nillable().Immutable(),
		field.UUID("related_thesis", uuid.UUID{}).Optional().Nillable().Immutable(),
	}
}

func (Event) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "occurred_at"),
		index.Fields("type"),
		index.Fields("related_asset"),
		index.Fields("related_thesis"),
		index.Fields("correlation_id"),
		index.Fields("user_id", "client_event_id").Unique(),
	}
}

// Edges intentionally empty in M1.
// causation_id -> events(id) is enforced in SQL (FK), not in Ent traversal,
// because Phase 1 never walks the causation chain through Ent.
func (Event) Edges() []ent.Edge { return nil }

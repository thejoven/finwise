// HTTP integration tests for the companion (M9) module.
package companion

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"flashfi/server/internal/httpapi"
	"flashfi/server/internal/infra/db"
	mastrax "flashfi/server/internal/infra/mastra"
)

const (
	testDevBearer     = "test-dev-token"
	testInternalToken = "test-internal-token"
)

type testEnv struct {
	router    *gin.Engine
	pool      *db.Pool
	devUserID uuid.UUID
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test")
	}
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	t.Cleanup(func() { pool.Close() })

	devUserID := uuid.New()
	// 空 Mastra URL → editor fallback 用 verbatim reason
	mc := mastrax.New("", testInternalToken)
	svc := NewService(NewRepository(pool), mc, zap.NewNop())
	handler := NewHandler(svc)
	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false,
		RegisterModules: func(_, v1, internalV1 *gin.RouterGroup) {
			handler.Register(v1, internalV1)
		},
	})
	return &testEnv{router: router, pool: pool, devUserID: devUserID}
}

func (e *testEnv) do(method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if _, ok := headers["Authorization"]; !ok {
		req.Header.Set("Authorization", "Bearer "+testDevBearer)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	return w
}

// seedSignedCommitment 直接 INSERT 一条 signed commitment + holding, 返回 commitment_id.
func (e *testEnv) seedSignedCommitment(t *testing.T) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()

	var eventID int64
	if err := e.pool.QueryRow(ctx, `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, 'signal.captured', '{}'::jsonb, $3)
		RETURNING id
	`, e.devUserID, uuid.New(), now).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	signalID := uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO signals (id, user_id, raw_text, captured_at, source_event_id, inference_status)
		VALUES ($1, $2, 'seed signal text', $3, $4, 'done')
	`, signalID, e.devUserID, now, eventID); err != nil {
		t.Fatalf("seed signal: %v", err)
	}
	refID := uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO refinement_sessions (id, user_id, primary_signal_id, status, rounds_done, decision, started_at, completed_at, updated_at)
		VALUES ($1, $2, $3, 'completed', 5, 'eligible_for_gate', $4, $4, $4)
	`, refID, e.devUserID, signalID, now); err != nil {
		t.Fatalf("seed refinement: %v", err)
	}
	evalID := uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO gate_evaluations (id, user_id, refinement_id, gates_detail, passed, evaluated_at)
		VALUES ($1, $2, $3, '{}'::jsonb, true, $4)
	`, evalID, e.devUserID, refID, now); err != nil {
		t.Fatalf("seed gate: %v", err)
	}
	commitID := uuid.New()
	thesis := `{
		"asset_ticker": "TST",
		"asset_name": "Test Co",
		"action": "buy",
		"position_pct": 5.0,
		"duration_months": 6,
		"entry_method": "test entry",
		"exit_conditions": ["跌破 100", "持仓到期"],
		"reasons_for_future_self": [
			"这是 reason 1, 当时你这么写的: 「供应商涨价了三轮」",
			"这是 reason 2: 「客户被迫预付款锁价」",
			"这是 reason 3: 「下一季 BOM 要重算」"
		]
	}`
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO commitments (id, user_id, evaluation_id, status, thesis, signed_at, drafted_at, updated_at)
		VALUES ($1, $2, $3, 'signed', $4::jsonb, $5, $5, $5)
	`, commitID, e.devUserID, evalID, thesis, now); err != nil {
		t.Fatalf("seed commitment: %v", err)
	}
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO holdings (id, user_id, status, signed_at, exit_conditions, expires_at, updated_at)
		VALUES ($1, $2, 'active', $3, '["跌破 100"]'::jsonb, $4, $3)
	`, commitID, e.devUserID, now, now.AddDate(0, 6, 0)); err != nil {
		t.Fatalf("seed holding: %v", err)
	}
	return commitID
}

// ───── Tests ─────

func TestOpenCommitmentNormalCount(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)

	// 第 1 次 open → normal, should_show_companion=false
	w := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/open", commitID), map[string]any{
		"client_event_id": uuid.NewString(),
		"origin":          "tab",
	}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("open: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		OpensToday          int    `json:"opens_today"`
		Classified          string `json:"classified"`
		ShouldShowCompanion bool   `json:"should_show_companion"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.OpensToday != 1 || resp.Classified != "normal" || resp.ShouldShowCompanion {
		t.Fatalf("first open: want 1/normal/false, got %+v", resp)
	}
}

func TestOpenCommitment3xTriggersCompanion(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)

	// 连开 3 次 → 第 3 次应该 should_show=true (anxious_3x)
	var last struct {
		OpensToday          int    `json:"opens_today"`
		Classified          string `json:"classified"`
		ShouldShowCompanion bool   `json:"should_show_companion"`
		Companion           *struct {
			EditorText string `json:"editor_text"`
			Reason     string `json:"reason"`
		} `json:"companion,omitempty"`
	}
	for i := 1; i <= 3; i++ {
		w := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/open", commitID), map[string]any{
			"client_event_id": uuid.NewString(),
		}, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("open %d: %d %s", i, w.Code, w.Body.String())
		}
		_ = json.Unmarshal(w.Body.Bytes(), &last)
	}
	if last.OpensToday != 3 {
		t.Fatalf("opens_today want 3, got %d", last.OpensToday)
	}
	if last.Classified != "anxious_3x" {
		t.Fatalf("want classified=anxious_3x, got %q", last.Classified)
	}
	if !last.ShouldShowCompanion {
		t.Fatalf("should_show_companion want true")
	}
	if last.Companion == nil {
		t.Fatalf("companion view should be non-nil")
	}
	if last.Companion.Reason != "anxiety_3x" {
		t.Fatalf("companion reason want anxiety_3x, got %q", last.Companion.Reason)
	}
	if last.Companion.EditorText == "" {
		t.Fatalf("editor_text empty (fallback verbatim quote should fill)")
	}
}

func TestOpenIdempotentSameClientEventID(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)
	cid := uuid.NewString()

	w1 := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/open", commitID), map[string]any{
		"client_event_id": cid,
	}, nil)
	w2 := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/open", commitID), map[string]any{
		"client_event_id": cid,
	}, nil)
	if w1.Code != http.StatusOK || w2.Code != http.StatusOK {
		t.Fatalf("open codes: %d %d", w1.Code, w2.Code)
	}
	var r1, r2 struct{ OpensToday int `json:"opens_today"` }
	_ = json.Unmarshal(w1.Body.Bytes(), &r1)
	_ = json.Unmarshal(w2.Body.Bytes(), &r2)
	// 重复 client_event_id 不重复计数
	if r1.OpensToday != 1 || r2.OpensToday != 1 {
		t.Fatalf("duplicate open should not double-count: r1=%d r2=%d", r1.OpensToday, r2.OpensToday)
	}
}

func TestGetCompanionRequiresOpen(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)

	// 还没 open → GET /companion 应该 204
	w := env.do(http.MethodGet, fmt.Sprintf("/v1/commitments/%s/companion", commitID), nil, nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", w.Code)
	}
}

func TestOpenNonSignedCommitment404(t *testing.T) {
	env := newTestEnv(t)
	// 用一个不存在的 commitment_id
	w := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/open", uuid.New()), map[string]any{
		"client_event_id": uuid.NewString(),
	}, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404 for unknown commitment, got %d %s", w.Code, w.Body.String())
	}
}

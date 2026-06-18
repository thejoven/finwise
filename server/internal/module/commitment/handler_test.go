// HTTP integration tests for commitment + signing (M7 + M8).
package commitment

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

	"alphax/server/internal/httpapi"
	"alphax/server/internal/infra/db"
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
	handler := NewHandler(NewService(NewRepository(pool)))
	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false,
		RegisterModules: func(_, v1, internalV1, adminV1 *gin.RouterGroup) {
			handler.Register(v1, internalV1, adminV1)
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

// seedPassedEvaluation 直接 INSERT 一个 passed=true 的 gate_evaluations + 关联的
// refinement_sessions + 一个 dummy signal + 一个 dummy event. 这是 FK 链最短路径.
func (e *testEnv) seedPassedEvaluation(t *testing.T) (evalID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()

	// 1. event
	var eventID int64
	if err := e.pool.QueryRow(ctx, `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, 'signal.captured', '{}'::jsonb, $3)
		RETURNING id
	`, e.devUserID, uuid.New(), now).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	// 2. signal
	signalID := uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO signals (id, user_id, raw_text, captured_at, source_event_id, inference_status)
		VALUES ($1, $2, 'seed', $3, $4, 'done')
	`, signalID, e.devUserID, now, eventID); err != nil {
		t.Fatalf("seed signal: %v", err)
	}
	// 3. refinement_sessions (completed)
	refID := uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO refinement_sessions (id, user_id, primary_signal_id, status, rounds_done, decision, started_at, completed_at, updated_at)
		VALUES ($1, $2, $3, 'completed', 5, 'eligible_for_gate', $4, $4, $4)
	`, refID, e.devUserID, signalID, now); err != nil {
		t.Fatalf("seed refinement: %v", err)
	}
	// 4. gate_evaluations (passed)
	evalID = uuid.New()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO gate_evaluations
			(id, user_id, refinement_id, gates_detail, passed, failed_gate, archived_pool, evaluated_at)
		VALUES ($1, $2, $3, '{}'::jsonb, true, NULL, NULL, $4)
	`, evalID, e.devUserID, refID, now); err != nil {
		t.Fatalf("seed evaluation: %v", err)
	}
	return evalID
}

func (e *testEnv) draftCommitment(t *testing.T, evalID uuid.UUID) string {
	t.Helper()
	body := map[string]any{
		"user_id":       e.devUserID.String(),
		"evaluation_id": evalID.String(),
		"thesis": map[string]any{
			"asset_ticker":    "TEST",
			"asset_name":      "Test Asset",
			"action":          "buy",
			"position_pct":    5.0,
			"duration_months": 6,
			"entry_method":    "买入并持有, 单次建仓",
			"exit_conditions": []string{"跌破 100 元", "持仓 6 个月到期"},
			"reasons_for_future_self": []string{
				"这是给 6 个月后自己看的理由 1, 当时你这么说.",
				"这是给 6 个月后自己看的理由 2, 当时你这么说.",
				"这是给 6 个月后自己看的理由 3, 当时你这么说.",
			},
		},
		"model": "test-model",
	}
	w := e.do(http.MethodPost, "/v1/internal/commitments/draft", body,
		map[string]string{"X-Internal-Token": testInternalToken, "Authorization": ""})
	if w.Code != http.StatusOK {
		t.Fatalf("draft commitment: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return resp.ID
}

// ───── Tests ─────

func TestCommitmentDraftHappy(t *testing.T) {
	env := newTestEnv(t)
	evalID := env.seedPassedEvaluation(t)
	commitID := env.draftCommitment(t, evalID)

	// GET /v1/commitments/:id
	w := env.do(http.MethodGet, "/v1/commitments/"+commitID, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Status string `json:"status"`
		Thesis struct {
			AssetTicker string `json:"asset_ticker"`
		} `json:"thesis"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "drafted" {
		t.Fatalf("want drafted, got %q", resp.Status)
	}
	if resp.Thesis.AssetTicker != "TEST" {
		t.Fatalf("ticker wrong: %q", resp.Thesis.AssetTicker)
	}
}

func TestCommitmentDraftIdempotent(t *testing.T) {
	env := newTestEnv(t)
	evalID := env.seedPassedEvaluation(t)
	id1 := env.draftCommitment(t, evalID)
	id2 := env.draftCommitment(t, evalID)
	if id1 != id2 {
		t.Fatalf("same evaluation produced different commitments: %s vs %s", id1, id2)
	}
}

func TestCommitmentSignHappy(t *testing.T) {
	env := newTestEnv(t)
	evalID := env.seedPassedEvaluation(t)
	commitID := env.draftCommitment(t, evalID)

	signingClientID := uuid.NewString()
	w := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/sign", commitID), map[string]any{
		"signing_client_id": signingClientID,
	}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("sign: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Commitment struct {
			Status   string `json:"status"`
			SignedAt string `json:"signed_at"`
		} `json:"commitment"`
		Holding *struct {
			Status string `json:"status"`
		} `json:"holding,omitempty"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Commitment.Status != "signed" {
		t.Fatalf("want signed, got %q", resp.Commitment.Status)
	}
	if resp.Holding == nil || resp.Holding.Status != "active" {
		t.Fatalf("holding not active: %+v", resp.Holding)
	}
}

func TestCommitmentSignIdempotent(t *testing.T) {
	env := newTestEnv(t)
	evalID := env.seedPassedEvaluation(t)
	commitID := env.draftCommitment(t, evalID)
	signingClientID := uuid.NewString()

	w1 := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/sign", commitID), map[string]any{
		"signing_client_id": signingClientID,
	}, nil)
	w2 := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/sign", commitID), map[string]any{
		"signing_client_id": signingClientID,
	}, nil)
	if w1.Code != http.StatusOK || w2.Code != http.StatusOK {
		t.Fatalf("sign codes: %d / %d", w1.Code, w2.Code)
	}
	// 2 次都应该返回 signed
	var r2 struct {
		Commitment struct {
			Status string `json:"status"`
		} `json:"commitment"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &r2)
	if r2.Commitment.Status != "signed" {
		t.Fatalf("second sign should still be signed, got %q", r2.Commitment.Status)
	}
}

func TestCommitmentPostponeThresholdAbandons(t *testing.T) {
	env := newTestEnv(t)
	evalID := env.seedPassedEvaluation(t)
	commitID := env.draftCommitment(t, evalID)

	for i := 1; i <= 3; i++ {
		w := env.do(http.MethodPost, fmt.Sprintf("/v1/commitments/%s/postpone", commitID), map[string]any{
			"client_event_id": uuid.NewString(),
		}, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("postpone %d: %d %s", i, w.Code, w.Body.String())
		}
	}

	// 第 3 次 postpone 后应该 status=abandoned
	w := env.do(http.MethodGet, "/v1/commitments/"+commitID, nil, nil)
	var resp struct {
		Status        string `json:"status"`
		PostponeCount int    `json:"postpone_count"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "abandoned" {
		t.Fatalf("3 postpones → want abandoned, got %q (count=%d)", resp.Status, resp.PostponeCount)
	}
	if resp.PostponeCount != 3 {
		t.Fatalf("postpone_count want 3, got %d", resp.PostponeCount)
	}
}

func TestCommitmentActive204WhenNone(t *testing.T) {
	env := newTestEnv(t)
	// 不种任何 commitment, GET /active → 204
	w := env.do(http.MethodGet, "/v1/commitments/active", nil, nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204 (no active commitment), got %d %s", w.Code, w.Body.String())
	}
}

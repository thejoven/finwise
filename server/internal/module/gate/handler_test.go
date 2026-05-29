// HTTP integration tests for the gate (M6) module.
package gate

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
	refinementmod "flashfi/server/internal/module/refinement"
	signalmod "flashfi/server/internal/module/signal"
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
	// 跨模块: signal + refinement + gate
	sigSvc := signalmod.NewService(signalmod.NewRepository(pool), nil)
	sigHandler := signalmod.NewHandler(sigSvc)
	refSvc := refinementmod.NewService(refinementmod.NewRepository(pool), func(ctx context.Context, userID, signalID uuid.UUID) error {
		_, err := sigSvc.Get(ctx, userID, signalID)
		return err
	})
	refHandler := refinementmod.NewHandler(refSvc)

	// gate 用空 Mastra client → G2 走 stub (true/60). 测试可预期.
	gateRepo := NewRepository(pool)
	gateSvc := NewService(gateRepo, pool, mastrax.New("", testInternalToken), zap.NewNop())
	gateHandler := NewHandler(gateSvc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false,
		RegisterModules: func(_, v1, internalV1 *gin.RouterGroup) {
			sigHandler.Register(v1, internalV1)
			refHandler.Register(v1, internalV1)
			gateHandler.Register(v1, internalV1)
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

// Helper: 录信号 → 返回 signal_id
func (e *testEnv) captureSignal(t *testing.T, text string) string {
	t.Helper()
	body := map[string]any{
		"client_event_id": uuid.NewString(),
		"raw_text":        text,
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := e.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("seed signal: %d", w.Code)
	}
	var resp struct {
		SignalID string `json:"signal_id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return resp.SignalID
}

// Helper: 开 refinement → 答 5 轮 → 返回 session_id (此时 status=completed)
func (e *testEnv) runCompletedRefinement(t *testing.T, signalID string, r5OpenText string) string {
	t.Helper()
	startBody := map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": signalID,
	}
	w := e.do(http.MethodPost, "/v1/refinement/sessions", startBody, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("start refinement: %d %s", w.Code, w.Body.String())
	}
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	kinds := []string{"single", "multi", "ordering", "single", "open"}
	for i := 1; i <= 5; i++ {
		ans := map[string]any{
			"client_event_id": uuid.NewString(),
			"round":           i,
			"question_id":     fmt.Sprintf("test-q%d", i),
			"question_kind":   kinds[i-1],
			"question_text":   fmt.Sprintf("test 题 %d", i),
			"diagnosis":       map[string]any{"kind": "correct"},
		}
		if i == 5 {
			ans["user_answer"] = map[string]any{"open_text": r5OpenText, "time_ms": 5000}
		} else {
			ans["user_answer"] = map[string]any{"choice_ids": []string{"a"}, "time_ms": 1000}
		}
		wA := e.do(http.MethodPost, fmt.Sprintf("/v1/refinement/sessions/%s/answers", start.ID), ans, nil)
		if wA.Code != http.StatusOK {
			t.Fatalf("answer %d: %d %s", i, wA.Code, wA.Body.String())
		}
	}
	return start.ID
}

// ───── Tests ─────

// G1 信号厚度: 只录 1 条信号 → cluster=1 → G1 fail → archive=observation
func TestGateEvaluateG1Fails(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureSignal(t, "孤独信号 一条不够厚")
	refID := env.runCompletedRefinement(t, sigID, "持仓 3 个月. 跌破 100 块就退.")

	// 触发评估 (internal endpoint)
	w := env.do(http.MethodPost, "/v1/internal/gate/evaluate", map[string]any{
		"refinement_id": refID,
	}, map[string]string{
		"X-Internal-Token": testInternalToken,
		"Authorization":    "",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("evaluate: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		ID           string  `json:"id"`
		Passed       bool    `json:"passed"`
		FailedGate   *int    `json:"failed_gate"`
		ArchivedPool *string `json:"archived_pool"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Passed {
		t.Fatalf("want pass=false (G1 should fail with 1 signal), got pass=true")
	}
	if resp.FailedGate == nil || *resp.FailedGate != 1 {
		t.Fatalf("want failed_gate=1, got %v", resp.FailedGate)
	}
	if resp.ArchivedPool == nil || *resp.ArchivedPool != "observation" {
		t.Fatalf("want archived_pool=observation, got %v", resp.ArchivedPool)
	}
}

// G3 窗口期: r5 open_text 不含 months → G3 fail (G1 即使过了也会到 G3, 但这里 G1 先 fail)
// 单独测 G3 需要凑齐 3 条独立信号. 简化: 验证 G3 detail 在 evaluation 里能取到.
func TestGateEvaluateProducesGateDetails(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureSignal(t, "G3 测试信号")
	refID := env.runCompletedRefinement(t, sigID, "持仓 4 个月 · 退出条件: 跌破 50 元就止损")

	w := env.do(http.MethodPost, "/v1/internal/gate/evaluate", map[string]any{
		"refinement_id": refID,
	}, map[string]string{
		"X-Internal-Token": testInternalToken,
		"Authorization":    "",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("evaluate: %d", w.Code)
	}
	var resp struct {
		ID    string `json:"id"`
		Gates struct {
			G1Thickness     struct{ Pass bool `json:"pass"` } `json:"g1_thickness"`
			G2AntiConsensus struct{ Pass bool; Score int }    `json:"g2_anti_consensus"`
			G3Window        struct{ Pass bool; Months float64 } `json:"g3_window"`
			G4Edge          struct{ Pass bool }                 `json:"g4_edge"`
		} `json:"gates"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	// G3 应该过 (months=4 在 [1,6])
	if !resp.Gates.G3Window.Pass {
		t.Fatalf("G3 should pass with months=4")
	}
	if resp.Gates.G3Window.Months != 4 {
		t.Fatalf("G3 months want 4, got %v", resp.Gates.G3Window.Months)
	}
	// G2 stub = 60/pass
	if resp.Gates.G2AntiConsensus.Score != 60 {
		t.Fatalf("G2 stub want score=60, got %d", resp.Gates.G2AntiConsensus.Score)
	}
}

// 同一 refinement 两次 evaluate → idempotent, 返回同一 evaluation_id
func TestGateEvaluateIdempotent(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureSignal(t, "idempotent test")
	refID := env.runCompletedRefinement(t, sigID, "持仓 2 个月 · 跌破 80 就退")

	w1 := env.do(http.MethodPost, "/v1/internal/gate/evaluate", map[string]any{"refinement_id": refID},
		map[string]string{"X-Internal-Token": testInternalToken, "Authorization": ""})
	w2 := env.do(http.MethodPost, "/v1/internal/gate/evaluate", map[string]any{"refinement_id": refID},
		map[string]string{"X-Internal-Token": testInternalToken, "Authorization": ""})

	var r1, r2 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w1.Body.Bytes(), &r1)
	_ = json.Unmarshal(w2.Body.Bytes(), &r2)
	if r1.ID != r2.ID {
		t.Fatalf("evaluate not idempotent: %s vs %s", r1.ID, r2.ID)
	}
}

// 沉默归档: GET /v1/gate/pools/observation 能找到刚归档的
func TestGateListByPool(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureSignal(t, "pool list test")
	refID := env.runCompletedRefinement(t, sigID, "持仓 6 个月 · 跌破 100 就退")

	env.do(http.MethodPost, "/v1/internal/gate/evaluate", map[string]any{"refinement_id": refID},
		map[string]string{"X-Internal-Token": testInternalToken, "Authorization": ""})

	w := env.do(http.MethodGet, "/v1/gate/pools/observation", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list pool: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Evaluations []struct {
			ID           string  `json:"id"`
			RefinementID string  `json:"refinement_id"`
			Passed       bool    `json:"passed"`
			ArchivedPool *string `json:"archived_pool"`
		} `json:"evaluations"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	found := false
	for _, ev := range resp.Evaluations {
		if ev.RefinementID == refID && !ev.Passed && ev.ArchivedPool != nil && *ev.ArchivedPool == "observation" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("freshly archived evaluation not found in observation pool")
	}
}

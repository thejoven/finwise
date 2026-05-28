// HTTP integration tests for the signal module.
//
// 全栈跑: 真 Postgres + 真 router (auth middleware + handler + service + repo).
// 跑前提: `make dev` 起 docker compose, `make migrate` 应用最新 schema.
// 没有 DB 时自动 skip, 不破坏 `go test ./...`.
package signal

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

// newTestEnv wires the full stack against a real DB. Each call creates a
// fresh dev user UUID so tests don't share state.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL (or DATABASE_URL) not set; skipping integration test")
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
	repo := NewRepository(pool)
	svc := NewService(repo)
	handler := NewHandler(svc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false, // httptest uses loopback anyway; disable to avoid flakes
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

// ───────────────────── Tests ─────────────────────

func TestCaptureHappyPath(t *testing.T) {
	env := newTestEnv(t)
	clientEventID := uuid.New().String()

	body := map[string]any{
		"client_event_id": clientEventID,
		"raw_text":        "供应商今天说 HBM 又涨价了",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d · body=%s", w.Code, w.Body.String())
	}

	var resp captureResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resp: %v · raw=%s", err, w.Body.String())
	}
	if resp.SignalID == "" {
		t.Fatalf("signal_id empty")
	}
	if resp.EventID == 0 {
		t.Fatalf("event_id zero")
	}
	if resp.InferenceStatus != "pending" {
		t.Fatalf("want inference_status=pending, got %q", resp.InferenceStatus)
	}
	if resp.Duplicate {
		t.Fatalf("first capture should not be duplicate")
	}
}

func TestCaptureDuplicateReturnsSameSignal(t *testing.T) {
	env := newTestEnv(t)
	clientEventID := uuid.New().String()
	body := map[string]any{
		"client_event_id": clientEventID,
		"raw_text":        "重复测试",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}

	w1 := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w1.Code != http.StatusAccepted {
		t.Fatalf("first capture: want 202, got %d", w1.Code)
	}
	var resp1 captureResponse
	_ = json.Unmarshal(w1.Body.Bytes(), &resp1)

	// 第二次同 client_event_id, 期望 duplicate=true 且同一个 signal_id
	w2 := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w2.Code != http.StatusAccepted {
		t.Fatalf("dup capture: want 202, got %d · body=%s", w2.Code, w2.Body.String())
	}
	var resp2 captureResponse
	if err := json.Unmarshal(w2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("decode resp2: %v", err)
	}
	if !resp2.Duplicate {
		t.Fatalf("want duplicate=true, got false")
	}
	if resp2.SignalID != resp1.SignalID {
		t.Fatalf("duplicate returned different signal_id: %q vs %q", resp2.SignalID, resp1.SignalID)
	}
}

func TestListPagination(t *testing.T) {
	env := newTestEnv(t)
	// 录 3 条
	for i := 0; i < 3; i++ {
		body := map[string]any{
			"client_event_id": uuid.NewString(),
			"raw_text":        fmt.Sprintf("信号 %d", i),
			"occurred_at":     time.Now().UTC().Add(time.Duration(-i) * time.Minute).Format(time.RFC3339),
		}
		w := env.do(http.MethodPost, "/v1/signals", body, nil)
		if w.Code != http.StatusAccepted {
			t.Fatalf("seed %d failed: %d · %s", i, w.Code, w.Body.String())
		}
	}

	// GET limit=2 → 应该 2 条 + has_more=true
	w := env.do(http.MethodGet, "/v1/signals?limit=2", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d · body=%s", w.Code, w.Body.String())
	}
	var resp listResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(resp.Signals) != 2 {
		t.Fatalf("want 2 signals, got %d", len(resp.Signals))
	}
	if !resp.HasMore {
		t.Fatalf("want has_more=true (3 captured, limit=2)")
	}
	// 顺序: captured_at DESC
	if !resp.Signals[0].CapturedAt.After(resp.Signals[1].CapturedAt) {
		t.Fatalf("want captured_at DESC order")
	}
}

func TestGetNotFound(t *testing.T) {
	env := newTestEnv(t)
	bogus := uuid.NewString()
	w := env.do(http.MethodGet, "/v1/signals/"+bogus, nil, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d · body=%s", w.Code, w.Body.String())
	}
}

func TestRecordInferenceHappyPath(t *testing.T) {
	env := newTestEnv(t)
	// 先 capture 一条
	clientEventID := uuid.NewString()
	body := map[string]any{
		"client_event_id": clientEventID,
		"raw_text":        "等待推演",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("capture: %d · %s", w.Code, w.Body.String())
	}
	var cap captureResponse
	_ = json.Unmarshal(w.Body.Bytes(), &cap)

	// 内部接口写回推演
	inf := map[string]any{
		"signal_id": cap.SignalID,
		"user_id":   env.devUserID.String(),
		"summary":   "HBM 第三轮涨价, 推理侧 BOM 压力外溢",
		"tags":      []string{"HBM", "AI 硬件"},
		"model":     "claude-sonnet-4-5",
		"related_assets": []map[string]any{
			{"ticker": "SK Hynix", "rationale": "HBM 主供, 直接受益", "order": "first"},
		},
		"cognitive_layer": "second",
		"consensus_check": "aligned",
	}
	w2 := env.do(http.MethodPost, "/v1/internal/inferences", inf, map[string]string{
		"X-Internal-Token": testInternalToken,
		"Authorization":    "", // override default; internal route doesn't need bearer
	})
	if w2.Code != http.StatusOK {
		t.Fatalf("record inference: want 200, got %d · body=%s", w2.Code, w2.Body.String())
	}

	// GET 信号, 期望 status=done + summary 已填
	w3 := env.do(http.MethodGet, "/v1/signals/"+cap.SignalID, nil, nil)
	if w3.Code != http.StatusOK {
		t.Fatalf("get after inference: %d · %s", w3.Code, w3.Body.String())
	}
	var sig signalView
	if err := json.Unmarshal(w3.Body.Bytes(), &sig); err != nil {
		t.Fatalf("decode signal: %v", err)
	}
	if sig.InferenceStatus != "done" {
		t.Fatalf("want inference_status=done, got %q", sig.InferenceStatus)
	}
	if sig.InferenceSummary == nil || *sig.InferenceSummary == "" {
		t.Fatalf("want inference_summary set")
	}
}

func TestInternalAuthRequires401(t *testing.T) {
	env := newTestEnv(t)
	body := map[string]any{
		"signal_id": uuid.NewString(),
		"user_id":   uuid.NewString(),
		"summary":   "x",
		"tags":      []string{},
		"model":     "test",
	}

	// 不带 X-Internal-Token → 401
	w := env.do(http.MethodPost, "/v1/internal/inferences", body, map[string]string{
		"Authorization": "", // also strip bearer to ensure we test the internal middleware
	})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 (no internal token), got %d · body=%s", w.Code, w.Body.String())
	}

	// 错的 X-Internal-Token → 401
	w2 := env.do(http.MethodPost, "/v1/internal/inferences", body, map[string]string{
		"X-Internal-Token": "wrong-token",
		"Authorization":    "",
	})
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 (wrong internal token), got %d · body=%s", w2.Code, w2.Body.String())
	}
}

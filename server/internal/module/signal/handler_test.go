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
	svc       *Service
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
	// projectCheck / firstActive 走裸 SQL 命中 projects 表 (不 import project 模块, 测试自洽).
	projectCheck := func(ctx context.Context, userID, projectID uuid.UUID) error {
		var one int
		if err := pool.QueryRow(ctx,
			`SELECT 1 FROM projects WHERE user_id=$1 AND id=$2 AND archived_at IS NULL`,
			userID, projectID).Scan(&one); err != nil {
			return ErrInvalidProject // 不存在 / 不属于该 user → 当非法分类
		}
		return nil
	}
	firstActive := func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
		var id uuid.UUID
		if err := pool.QueryRow(ctx,
			`SELECT id FROM projects WHERE user_id=$1 AND archived_at IS NULL ORDER BY sort_order, created_at LIMIT 1`,
			userID).Scan(&id); err != nil {
			return nil, nil // 无分类 → 不兜底
		}
		return &id, nil
	}
	svc := NewService(repo, projectCheck, firstActive)
	handler := NewHandler(svc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false, // httptest uses loopback anyway; disable to avoid flakes
		RegisterModules: func(_, v1, internalV1, adminV1 *gin.RouterGroup) {
			handler.Register(v1, internalV1, adminV1)
		},
	})

	return &testEnv{router: router, pool: pool, svc: svc, devUserID: devUserID}
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

// ───────── 分类回写 (AI 智能归类 + provisional 兜底) ─────────

// seedProject 直接 INSERT 一行 projects (绕过 project 模块), 返回 id. projects.user_id 无 FK.
func (e *testEnv) seedProject(t *testing.T, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := e.pool.QueryRow(context.Background(),
		`INSERT INTO projects (user_id, name, sort_order) VALUES ($1, $2, 0) RETURNING id`,
		e.devUserID, name).Scan(&id); err != nil {
		t.Fatalf("seed project: %v", err)
	}
	return id
}

// recordInfRaw POST 一条推演回写; projectID 非空则带 project_id. 返回 HTTP code.
func (e *testEnv) recordInfRaw(t *testing.T, signalID, projectID string) int {
	t.Helper()
	inf := map[string]any{
		"signal_id": signalID,
		"user_id":   e.devUserID.String(),
		"summary":   "推演摘要",
		"tags":      []string{"x"},
		"model":     "test-model",
	}
	if projectID != "" {
		inf["project_id"] = projectID
	}
	w := e.do(http.MethodPost, "/v1/internal/inferences", inf, map[string]string{
		"X-Internal-Token": testInternalToken,
		"Authorization":    "",
	})
	return w.Code
}

func (e *testEnv) recordInf(t *testing.T, signalID, projectID string) {
	t.Helper()
	if code := e.recordInfRaw(t, signalID, projectID); code != http.StatusOK {
		t.Fatalf("record inference: want 200, got %d", code)
	}
}

func (e *testEnv) getSignal(t *testing.T, signalID string) signalView {
	t.Helper()
	w := e.do(http.MethodGet, "/v1/signals/"+signalID, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get signal: %d · %s", w.Code, w.Body.String())
	}
	var sig signalView
	if err := json.Unmarshal(w.Body.Bytes(), &sig); err != nil {
		t.Fatalf("decode signal: %v", err)
	}
	return sig
}

func ptrStr(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// 用户手选的分类, AI 不许覆盖.
func TestRecordInference_PreservesUserChosenProject(t *testing.T) {
	env := newTestEnv(t)
	projA := env.seedProject(t, "A-"+uuid.NewString())
	projB := env.seedProject(t, "B-"+uuid.NewString())

	body := map[string]any{
		"client_event_id": uuid.NewString(),
		"project_id":      projA.String(),
		"raw_text":        "手选分类的信号",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("capture: %d · %s", w.Code, w.Body.String())
	}
	var cap captureResponse
	_ = json.Unmarshal(w.Body.Bytes(), &cap)

	env.recordInf(t, cap.SignalID, projB.String()) // AI 想改到 B
	sig := env.getSignal(t, cap.SignalID)
	if ptrStr(sig.ProjectID) != projA.String() {
		t.Fatalf("want user-chosen %s preserved, got %s", projA, ptrStr(sig.ProjectID))
	}
}

// 系统临时归类 (promote provisional, auto_assigned) 应被 AI 覆盖到更合适分类.
func TestRecordInference_AIRehomesProvisional(t *testing.T) {
	env := newTestEnv(t)
	projA := env.seedProject(t, "A-"+uuid.NewString())
	projB := env.seedProject(t, "B-"+uuid.NewString())

	res, err := env.svc.Capture(context.Background(), CaptureCommand{
		UserID: env.devUserID, ClientEventID: uuid.New(),
		ProjectID: &projA, ProjectAutoAssigned: true,
		RawText: "promote 兜底的信号", OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("provisional capture: %v", err)
	}
	env.recordInf(t, res.Signal.ID.String(), projB.String()) // AI 判到 B
	sig := env.getSignal(t, res.Signal.ID.String())
	if ptrStr(sig.ProjectID) != projB.String() {
		t.Fatalf("want AI rehome to %s, got %s", projB, ptrStr(sig.ProjectID))
	}
}

// 未分类信号 + AI 弃权 → 兜底落第一个活跃分类 (保证可见).
func TestRecordInference_FallbackToFirstActiveWhenAIAbstains(t *testing.T) {
	env := newTestEnv(t)
	projFirst := env.seedProject(t, "First-"+uuid.NewString())
	_ = env.seedProject(t, "Second-"+uuid.NewString())

	body := map[string]any{
		"client_event_id": uuid.NewString(),
		"raw_text":        "未分类待兜底",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	var cap captureResponse
	_ = json.Unmarshal(w.Body.Bytes(), &cap)

	env.recordInf(t, cap.SignalID, "") // AI 弃权 (不带 project_id)
	sig := env.getSignal(t, cap.SignalID)
	if ptrStr(sig.ProjectID) != projFirst.String() {
		t.Fatalf("want fallback to first active %s, got %s", projFirst, ptrStr(sig.ProjectID))
	}
}

// AI 给了不属于该 user 的分类 → 丢弃当弃权, 回写仍 200, 落兜底 (不报错以免 nak 整条推演).
func TestRecordInference_InvalidAIProjectDropped(t *testing.T) {
	env := newTestEnv(t)
	projFirst := env.seedProject(t, "First-"+uuid.NewString())

	body := map[string]any{
		"client_event_id": uuid.NewString(),
		"raw_text":        "AI 给了非法分类",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	var cap captureResponse
	_ = json.Unmarshal(w.Body.Bytes(), &cap)

	if code := env.recordInfRaw(t, cap.SignalID, uuid.NewString()); code != http.StatusOK {
		t.Fatalf("record inference should still 200 (drop bad project), got %d", code)
	}
	sig := env.getSignal(t, cap.SignalID)
	if ptrStr(sig.ProjectID) != projFirst.String() {
		t.Fatalf("want fallback after dropping foreign project, got %s", ptrStr(sig.ProjectID))
	}
}

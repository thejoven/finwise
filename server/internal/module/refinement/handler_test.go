// HTTP integration tests for the refinement (M5) module.
//
// 全栈跑: 真 Postgres + 真 router (auth + handler + service + repo).
// 跑前提: `make migrate` 已应用 003 (refinement schema).
// 没 DB 自动 skip.
package refinement

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

	"wiseflow/server/internal/httpapi"
	"wiseflow/server/internal/infra/db"
	signalmod "wiseflow/server/internal/module/signal"
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

	// signal module — refinement.Start 要求 primary_signal_id 真实存在
	sigRepo := signalmod.NewRepository(pool)
	sigSvc := signalmod.NewService(sigRepo, nil, nil)
	sigHandler := signalmod.NewHandler(sigSvc)

	refRepo := NewRepository(pool)
	// 测试里走真实 signal.Service.Get 做 ownership 校验 — 跟生产 wiring 对齐.
	refSvc := NewService(refRepo, func(ctx context.Context, userID, signalID uuid.UUID) error {
		_, err := sigSvc.Get(ctx, userID, signalID)
		return err
	})
	refHandler := NewHandler(refSvc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           zap.NewNop(),
		DB:               pool,
		DevBearerToken:   testDevBearer,
		DevUserID:        devUserID,
		InternalToken:    testInternalToken,
		InternalLoopback: false,
		RegisterModules: func(_, v1, internalV1, _ *gin.RouterGroup) {
			sigHandler.Register(v1, internalV1)
			refHandler.Register(v1, internalV1)
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

// captureTestSignal 通过 POST /v1/signals 录一条信号, 返回 signal_id (= 唯一 server uuid).
func (e *testEnv) captureTestSignal(t *testing.T, text string) string {
	t.Helper()
	cid := uuid.NewString()
	body := map[string]any{
		"client_event_id": cid,
		"raw_text":        text,
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := e.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("seed signal: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		SignalID string `json:"signal_id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return resp.SignalID
}

// ───────────────────── Tests ─────────────────────

func TestRefinementStartHappy(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "HBM 涨价")

	body := map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": sigID,
		"primary_asset":     "SK Hynix",
	}
	w := env.do(http.MethodPost, "/v1/refinement/sessions", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d · %s", w.Code, w.Body.String())
	}
	var resp struct {
		ID         string  `json:"id"`
		Status     string  `json:"status"`
		RoundsDone int     `json:"rounds_done"`
		Decision   *string `json:"decision,omitempty"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ID == "" {
		t.Fatalf("session id empty")
	}
	if resp.Status != "active" {
		t.Fatalf("want status=active, got %q", resp.Status)
	}
	if resp.RoundsDone != 0 {
		t.Fatalf("want rounds_done=0, got %d", resp.RoundsDone)
	}
}

func TestRefinementStartIdempotent(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "second case")
	cid := uuid.NewString()
	body := map[string]any{
		"client_event_id":   cid,
		"primary_signal_id": sigID,
	}

	w1 := env.do(http.MethodPost, "/v1/refinement/sessions", body, nil)
	if w1.Code != http.StatusAccepted {
		t.Fatalf("first: %d", w1.Code)
	}
	var r1 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w1.Body.Bytes(), &r1)

	// 同一 client_event_id + 同一 signal → 返回已存在的 session
	w2 := env.do(http.MethodPost, "/v1/refinement/sessions", body, nil)
	if w2.Code != http.StatusAccepted {
		t.Fatalf("dup: %d %s", w2.Code, w2.Body.String())
	}
	var r2 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &r2)
	if r1.ID != r2.ID {
		t.Fatalf("idempotency broken: %q vs %q", r1.ID, r2.ID)
	}
}

func TestRefinementAnswerSequence(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "answer sequence test")

	// start
	w := env.do(http.MethodPost, "/v1/refinement/sessions", map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": sigID,
	}, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("start: %d", w.Code)
	}
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	// 答 round 1
	ans1 := map[string]any{
		"client_event_id": uuid.NewString(),
		"round":           1,
		"question_id":     "test-q1",
		"question_kind":   "single",
		"question_text":   "测试题 1",
		"options":         []map[string]any{{"id": "a", "text": "选项 A", "is_distractor": false}},
		"user_answer":     map[string]any{"choice_ids": []string{"a"}, "time_ms": 1000},
		"diagnosis":       map[string]any{"kind": "correct"},
	}
	wAns := env.do(http.MethodPost, fmt.Sprintf("/v1/refinement/sessions/%s/answers", start.ID), ans1, nil)
	if wAns.Code != http.StatusOK {
		t.Fatalf("answer 1: %d %s", wAns.Code, wAns.Body.String())
	}
	var ansResp struct {
		NewRound  int  `json:"new_round"`
		Completed bool `json:"completed"`
	}
	_ = json.Unmarshal(wAns.Body.Bytes(), &ansResp)
	if ansResp.NewRound != 1 || ansResp.Completed {
		t.Fatalf("after r1: want round=1 completed=false, got %+v", ansResp)
	}

	// 跳到 round 3 → 应该 409 (out of sequence)
	ans3 := map[string]any{
		"client_event_id": uuid.NewString(),
		"round":           3,
		"question_id":     "test-q3",
		"question_kind":   "ordering",
		"question_text":   "测试题 3",
		"user_answer":     map[string]any{"choice_ids": []string{"b"}, "time_ms": 1000},
		"diagnosis":       map[string]any{"kind": "correct"},
	}
	wSkip := env.do(http.MethodPost, fmt.Sprintf("/v1/refinement/sessions/%s/answers", start.ID), ans3, nil)
	if wSkip.Code != http.StatusConflict {
		t.Fatalf("skip ahead should be 409, got %d %s", wSkip.Code, wSkip.Body.String())
	}
}

func TestRefinementGetIncludesRounds(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "get includes rounds")

	w := env.do(http.MethodPost, "/v1/refinement/sessions", map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": sigID,
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	// 答一轮
	env.do(http.MethodPost, fmt.Sprintf("/v1/refinement/sessions/%s/answers", start.ID), map[string]any{
		"client_event_id": uuid.NewString(),
		"round":           1,
		"question_id":     "q1",
		"question_kind":   "single",
		"question_text":   "Q1",
		"user_answer":     map[string]any{"choice_ids": []string{"a"}, "time_ms": 500},
		"diagnosis":       map[string]any{"kind": "correct"},
	}, nil)

	wGet := env.do(http.MethodGet, fmt.Sprintf("/v1/refinement/sessions/%s", start.ID), nil, nil)
	if wGet.Code != http.StatusOK {
		t.Fatalf("get: %d %s", wGet.Code, wGet.Body.String())
	}
	var view struct {
		RoundsDone int `json:"rounds_done"`
		Rounds     []struct {
			Round int `json:"round"`
		} `json:"rounds"`
		// signal raw_text 应该 join 出来
		PrimarySignalRawText string `json:"primary_signal_raw_text"`
	}
	_ = json.Unmarshal(wGet.Body.Bytes(), &view)
	if view.RoundsDone != 1 || len(view.Rounds) != 1 {
		t.Fatalf("want rounds_done=1, len(rounds)=1, got %+v", view)
	}
	if view.PrimarySignalRawText == "" {
		t.Fatalf("primary_signal_raw_text empty in GET response (M5 join)")
	}
}

func TestRefinementGetBySignal(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "by-signal lookup")

	// 没有 session 时 → 404
	w404 := env.do(http.MethodGet, fmt.Sprintf("/v1/refinement/sessions/by-signal/%s", sigID), nil, nil)
	if w404.Code != http.StatusNotFound {
		t.Fatalf("no session: want 404, got %d %s", w404.Code, w404.Body.String())
	}

	// 开 session 但还没完成 → 仍然 404 (只返回 completed)
	wStart := env.do(http.MethodPost, "/v1/refinement/sessions", map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": sigID,
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(wStart.Body.Bytes(), &start)

	wActive := env.do(http.MethodGet, fmt.Sprintf("/v1/refinement/sessions/by-signal/%s", sigID), nil, nil)
	if wActive.Code != http.StatusNotFound {
		t.Fatalf("active-only: want 404, got %d %s", wActive.Code, wActive.Body.String())
	}

	// 答完 5 轮 → completed
	for r := 1; r <= 5; r++ {
		kind := "single"
		if r == 5 {
			kind = "open"
		}
		body := map[string]any{
			"client_event_id": uuid.NewString(),
			"round":           r,
			"question_id":     fmt.Sprintf("q%d", r),
			"question_kind":   kind,
			"question_text":   fmt.Sprintf("Q%d", r),
			"options":         []map[string]any{{"id": "a", "text": "选项 A", "is_distractor": false}},
			"user_answer":     map[string]any{"choice_ids": []string{"a"}, "open_text": "this is a sufficiently long answer for weak threshold", "time_ms": 1000},
			"diagnosis":       map[string]any{"kind": "correct"},
		}
		wAns := env.do(http.MethodPost, fmt.Sprintf("/v1/refinement/sessions/%s/answers", start.ID), body, nil)
		if wAns.Code != http.StatusOK {
			t.Fatalf("answer r%d: %d %s", r, wAns.Code, wAns.Body.String())
		}
	}

	// 现在 by-signal 应该拿得到, 含完整 rounds
	wDone := env.do(http.MethodGet, fmt.Sprintf("/v1/refinement/sessions/by-signal/%s", sigID), nil, nil)
	if wDone.Code != http.StatusOK {
		t.Fatalf("completed: want 200, got %d %s", wDone.Code, wDone.Body.String())
	}
	var view struct {
		ID          string `json:"id"`
		Status      string `json:"status"`
		RoundsDone  int    `json:"rounds_done"`
		CompletedAt string `json:"completed_at"`
		Rounds      []struct {
			Round int `json:"round"`
		} `json:"rounds"`
	}
	_ = json.Unmarshal(wDone.Body.Bytes(), &view)
	if view.ID != start.ID {
		t.Fatalf("want session id %s, got %s", start.ID, view.ID)
	}
	if view.Status != "completed" {
		t.Fatalf("want status=completed, got %q", view.Status)
	}
	if view.RoundsDone != 5 || len(view.Rounds) != 5 {
		t.Fatalf("want rounds_done=5 len(rounds)=5, got rounds_done=%d len=%d", view.RoundsDone, len(view.Rounds))
	}
	if view.CompletedAt == "" {
		t.Fatalf("completed_at empty in response — should be set after 5th round")
	}
}

func TestRefinementSaveQuestionInternalAuth(t *testing.T) {
	env := newTestEnv(t)
	sigID := env.captureTestSignal(t, "internal auth test")

	w := env.do(http.MethodPost, "/v1/refinement/sessions", map[string]any{
		"client_event_id":   uuid.NewString(),
		"primary_signal_id": sigID,
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	// 不带 internal token → 401
	wNoAuth := env.do(http.MethodPost, fmt.Sprintf("/v1/internal/refinement/sessions/%s/question", start.ID), map[string]any{
		"user_id": env.devUserID.String(),
		"round":   1,
		"payload": map[string]any{"question_id": "q1", "round": 1, "kind": "single", "text": "test", "options": []any{}},
	}, map[string]string{"Authorization": ""})
	if wNoAuth.Code != http.StatusUnauthorized {
		t.Fatalf("no token want 401, got %d %s", wNoAuth.Code, wNoAuth.Body.String())
	}

	// 带正确 internal token → 200
	wOK := env.do(http.MethodPost, fmt.Sprintf("/v1/internal/refinement/sessions/%s/question", start.ID), map[string]any{
		"user_id": env.devUserID.String(),
		"round":   1,
		"payload": map[string]any{"question_id": "q1", "round": 1, "kind": "single", "text": "test题", "options": []any{}},
	}, map[string]string{"X-Internal-Token": testInternalToken, "Authorization": ""})
	if wOK.Code != http.StatusOK {
		t.Fatalf("with token want 200, got %d %s", wOK.Code, wOK.Body.String())
	}
}

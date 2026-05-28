// HTTP integration tests for the retrospect (M11) module.
package retrospect

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
	mc := mastrax.New("", testInternalToken)
	svc := NewService(NewRepository(pool), pool, mc, zap.NewNop())
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

// seedSignedCommitment 直接 INSERT 一个 signed commitment. retrospect 的 FK 指向它.
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
	e.pool.Exec(ctx, `
		INSERT INTO signals (id, user_id, raw_text, captured_at, source_event_id, inference_status)
		VALUES ($1, $2, 'seed', $3, $4, 'done')
	`, signalID, e.devUserID, now, eventID)
	refID := uuid.New()
	e.pool.Exec(ctx, `
		INSERT INTO refinement_sessions (id, user_id, primary_signal_id, status, rounds_done, decision, started_at, completed_at, updated_at)
		VALUES ($1, $2, $3, 'completed', 5, 'eligible_for_gate', $4, $4, $4)
	`, refID, e.devUserID, signalID, now)
	evalID := uuid.New()
	e.pool.Exec(ctx, `
		INSERT INTO gate_evaluations (id, user_id, refinement_id, gates_detail, passed, evaluated_at)
		VALUES ($1, $2, $3, '{}'::jsonb, true, $4)
	`, evalID, e.devUserID, refID, now)
	commitID := uuid.New()
	thesis := `{"asset_ticker":"TST","asset_name":"Test","action":"buy","position_pct":5,"duration_months":6,"entry_method":"x","exit_conditions":["a","b"],"reasons_for_future_self":["r1","r2","r3"]}`
	e.pool.Exec(ctx, `
		INSERT INTO commitments (id, user_id, evaluation_id, status, thesis, signed_at, drafted_at, updated_at)
		VALUES ($1, $2, $3, 'signed', $4::jsonb, $5, $5, $5)
	`, commitID, e.devUserID, evalID, thesis, now)
	return commitID
}

// ───── Tests ─────

func TestRetrospectStartIdempotent(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)

	w1 := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
		"trigger":       "expired",
	}, nil)
	if w1.Code != http.StatusOK {
		t.Fatalf("start1: %d %s", w1.Code, w1.Body.String())
	}
	var r1 struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	_ = json.Unmarshal(w1.Body.Bytes(), &r1)
	if r1.State != "pending" {
		t.Fatalf("first start: want pending, got %q", r1.State)
	}

	w2 := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
	}, nil)
	var r2 struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &r2)
	if r1.ID != r2.ID {
		t.Fatalf("not idempotent on commitment_id: %s vs %s", r1.ID, r2.ID)
	}
}

func TestRetrospectAnswerSequence(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)

	w := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	dims := []string{"perception", "inference", "evaluation", "execution"}
	openTexts := []string{
		"录得太晚, 等到大家都知道了",
		"只想到一阶, 没推到二阶",
		"退出条件写得空, '看情况'",
		"签了字之后拖了两周才下单",
	}
	for i := 1; i <= 4; i++ {
		w := env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/answers", start.ID), map[string]any{
			"client_event_id": uuid.NewString(),
			"question_no":     i,
			"question_dim":    dims[i-1],
			"choice":          fmt.Sprintf("choice-%d", i),
			"open_text":       openTexts[i-1],
		}, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("answer %d: %d %s", i, w.Code, w.Body.String())
		}
	}

	wGet := env.do(http.MethodGet, "/v1/retrospects/"+start.ID, nil, nil)
	var view struct {
		State   string          `json:"state"`
		Answers json.RawMessage `json:"answers"`
	}
	_ = json.Unmarshal(wGet.Body.Bytes(), &view)
	if view.State != "in_progress" {
		t.Fatalf("4 answers in, want state=in_progress (not auto-finalized), got %q", view.State)
	}
}

func TestRetrospectFinalizeWithoutAllAnswers409(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)
	w := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	// 只答 2 道 → finalize 应 409
	for i := 1; i <= 2; i++ {
		env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/answers", start.ID), map[string]any{
			"client_event_id": uuid.NewString(),
			"question_no":     i,
			"question_dim":    "perception",
			"choice":          "x",
		}, nil)
	}

	wFin := env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/finalize", start.ID), nil, nil)
	if wFin.Code != http.StatusConflict {
		t.Fatalf("want 409 (need 4 answers), got %d %s", wFin.Code, wFin.Body.String())
	}
}

func TestRetrospectFinalizeHeuristic(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)
	w := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	// 4 道答案, 第 3 道 (evaluation) open_text 给空, 启发式应选 exit_quality
	dims := []string{"perception", "inference", "evaluation", "execution"}
	texts := []string{"录得快", "推到二阶", "", "立刻执行了"}
	for i := 1; i <= 4; i++ {
		env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/answers", start.ID), map[string]any{
			"client_event_id": uuid.NewString(),
			"question_no":     i,
			"question_dim":    dims[i-1],
			"choice":          "x",
			"open_text":       texts[i-1],
		}, nil)
	}

	wFin := env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/finalize", start.ID), nil, nil)
	if wFin.Code != http.StatusOK {
		t.Fatalf("finalize: %d %s", wFin.Code, wFin.Body.String())
	}
	var resp struct {
		State              string  `json:"state"`
		FocusDim           *string `json:"focus_dim"`
		FocusText          *string `json:"focus_text"`
		DiagnosticianModel *string `json:"diagnostician_model"`
	}
	_ = json.Unmarshal(wFin.Body.Bytes(), &resp)
	if resp.State != "finalized" {
		t.Fatalf("want finalized, got %q", resp.State)
	}
	if resp.FocusDim == nil || *resp.FocusDim != "exit_quality" {
		t.Fatalf("heuristic should pick exit_quality (q3 open_text empty), got %v", resp.FocusDim)
	}
	if resp.DiagnosticianModel == nil || *resp.DiagnosticianModel != "heuristic-v1" {
		t.Fatalf("no Mastra → expect heuristic-v1 model, got %v", resp.DiagnosticianModel)
	}

	// finalize 之后, user_training_state 也应该有一行
	var rawFocuses []byte
	if err := env.pool.QueryRow(context.Background(),
		`SELECT training_focuses FROM user_training_state WHERE user_id = $1`,
		env.devUserID).Scan(&rawFocuses); err != nil {
		t.Fatalf("training_focuses row missing: %v", err)
	}
	if len(rawFocuses) < 2 {
		t.Fatalf("training_focuses JSON too short: %s", string(rawFocuses))
	}
}

func TestRetrospectFinalizeIdempotent(t *testing.T) {
	env := newTestEnv(t)
	commitID := env.seedSignedCommitment(t)
	w := env.do(http.MethodPost, "/v1/retrospects", map[string]any{
		"commitment_id": commitID.String(),
	}, nil)
	var start struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &start)

	dims := []string{"perception", "inference", "evaluation", "execution"}
	for i := 1; i <= 4; i++ {
		env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/answers", start.ID), map[string]any{
			"client_event_id": uuid.NewString(),
			"question_no":     i,
			"question_dim":    dims[i-1],
			"choice":          "x",
			"open_text":       "some text long enough",
		}, nil)
	}
	wFin1 := env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/finalize", start.ID), nil, nil)
	if wFin1.Code != http.StatusOK {
		t.Fatalf("finalize 1: %d", wFin1.Code)
	}
	wFin2 := env.do(http.MethodPost, fmt.Sprintf("/v1/retrospects/%s/finalize", start.ID), nil, nil)
	if wFin2.Code != http.StatusConflict {
		t.Fatalf("second finalize want 409, got %d", wFin2.Code)
	}
}

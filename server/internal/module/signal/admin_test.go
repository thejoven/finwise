// 运营后台跨用户重推端点的集成测试 (真 DB; 无 DB 自动 skip, 见 newTestEnv).
// DevUserID 即 admin (RequireAdmin 放行 DevBearer), 故 env.do 默认鉴权即可命中 /v1/admin/*.
package signal

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"alphax/server/internal/domain"
)

// TestAdminReinferRoutesNoConflict 确认 POST /signals/reinfer (静态) 与 POST
// /signals/:id/reinfer (参数) 同级注册不 panic. 只注册路由不调 handler, nil svc 安全;
// 无需 DB —— 本地即可验证 gin 1.10 路由树 (区别于跳过的集成测试).
func TestAdminReinferRoutesNoConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/v1")
	internal := r.Group("/v1/internal")
	admin := r.Group("/v1/admin")
	NewHandler(nil).Register(v1, internal, admin)
}

// captureOne capture 一条信号, 返回其 id (复用 /v1/signals, 归属 devUserID).
func captureOne(t *testing.T, env *testEnv, raw string) string {
	t.Helper()
	body := map[string]any{
		"client_event_id": uuid.NewString(),
		"raw_text":        raw,
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
	}
	w := env.do(http.MethodPost, "/v1/signals", body, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("capture: want 202, got %d · %s", w.Code, w.Body.String())
	}
	var cap captureResponse
	if err := json.Unmarshal(w.Body.Bytes(), &cap); err != nil {
		t.Fatalf("decode capture: %v", err)
	}
	return cap.SignalID
}

// outboxCapturedCount 数某 signal 的 source_event_id 上 signal.captured 的 outbox 行数.
// capture 写 1 行; 每次 reinfer 复用同一 source_event_id 再加 1 行.
func outboxCapturedCount(t *testing.T, env *testEnv, signalID string) int {
	t.Helper()
	var n int
	err := env.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM event_outbox o
		JOIN signals s ON s.source_event_id = o.event_id
		WHERE s.id = $1 AND o.subject = $2
	`, uuid.MustParse(signalID), string(domain.EventSignalCaptured)).Scan(&n)
	if err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	return n
}

func TestAdminReinfer_NotFound(t *testing.T) {
	env := newTestEnv(t)
	w := env.do(http.MethodPost, "/v1/admin/signals/"+uuid.NewString()+"/reinfer", nil, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d · %s", w.Code, w.Body.String())
	}
}

// 跨用户重推: 不校验 ownership, 命中即在原 source_event_id 上多投一行 captured.
func TestAdminReinfer_Enqueues(t *testing.T) {
	env := newTestEnv(t)
	id := captureOne(t, env, "等待运营重推")
	before := outboxCapturedCount(t, env, id)

	w := env.do(http.MethodPost, "/v1/admin/signals/"+id+"/reinfer", nil, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d · %s", w.Code, w.Body.String())
	}
	var resp struct {
		SignalID        string `json:"signal_id"`
		InferenceStatus string `json:"inference_status"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.SignalID != id {
		t.Fatalf("signal_id mismatch: want %s, got %s", id, resp.SignalID)
	}
	if got := outboxCapturedCount(t, env, id); got != before+1 {
		t.Fatalf("want captured outbox rows %d, got %d", before+1, got)
	}
}

// 已 done 的信号拒绝重推 (event 层幂等键会让重投 no-op).
func TestAdminReinfer_DoneRejected(t *testing.T) {
	env := newTestEnv(t)
	id := captureOne(t, env, "已完成不许重推")
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE signals SET inference_status='done', inference_done_at=now() WHERE id=$1`,
		uuid.MustParse(id)); err != nil {
		t.Fatalf("mark done: %v", err)
	}
	w := env.do(http.MethodPost, "/v1/admin/signals/"+id+"/reinfer", nil, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d · %s", w.Code, w.Body.String())
	}
}

// 批量重推按 user_id 收窄: devUserID 每次 newTestEnv 唯一, 只 1 条 failed → reinfered=1.
func TestAdminReinferFailed_ByUser(t *testing.T) {
	env := newTestEnv(t)
	id := captureOne(t, env, "失败的信号待批量重推")
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE signals SET inference_status='failed' WHERE id=$1`,
		uuid.MustParse(id)); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	before := outboxCapturedCount(t, env, id)

	w := env.do(http.MethodPost, "/v1/admin/signals/reinfer",
		map[string]any{"user_id": env.devUserID.String()}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d · %s", w.Code, w.Body.String())
	}
	var resp struct {
		Reinfered int `json:"reinfered"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Reinfered != 1 {
		t.Fatalf("want reinfered=1 for this user, got %d", resp.Reinfered)
	}
	if got := outboxCapturedCount(t, env, id); got != before+1 {
		t.Fatalf("want our failed signal re-enqueued once (rows %d), got %d", before+1, got)
	}
}

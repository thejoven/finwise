package gate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/infra/mastra"
)

// 归档页"与分析师继续对话".
//
// 评估是不可变快照, 对话不改判 — 用户点进归档里某条被否决的评估, 与否决它的那位
// 分析师继续聊: 问"为什么拦" / "差在哪" / "什么情况下你会改判". 分析师带着原评审
// 上下文 (信号 + 四位结论 + 降噪综述) 用对话口吻回答.
//
// 同步链路: 客户端 POST → Go (本文件) → Mastra /analyst-chat → LLM. 客户端用
// 长超时等全文 (产品哲学: 等待用 typewriter, 不弹 loading toast).

var (
	// ErrChatNotArchived — 通过的评估没有"否决分析师", 无从对话.
	ErrChatNotArchived = errors.New("evaluation passed; no analyst to chat with")
	// ErrChatUnavailable — Mastra 未配置 / 调用失败, 分析师暂时回不上来.
	ErrChatUnavailable = errors.New("analyst chat unavailable")
)

// ChatMessage mirrors a gate_chat_messages row.
type ChatMessage struct {
	ID        uuid.UUID
	Role      string // "user" | "analyst"
	Content   string
	CreatedAt time.Time
}

// mastraAnalystKey: failed_gate → mastra analyst 标识 (与 analyst-chat 端点约定).
var mastraAnalystKey = map[int]string{
	1: "thickness",
	2: "consensus",
	3: "timing",
	4: "competence",
}

// ───── repository ─────

// ListChatMessages 按时间升序拿一条评估下的全部对话.
func (r *Repository) ListChatMessages(ctx context.Context, userID, evaluationID uuid.UUID) ([]ChatMessage, error) {
	const q = `
		SELECT id, role, content, created_at
		FROM gate_chat_messages
		WHERE user_id = $1 AND evaluation_id = $2
		ORDER BY created_at ASC, id ASC
	`
	rows, err := r.pool.Query(ctx, q, userID, evaluationID)
	if err != nil {
		return nil, fmt.Errorf("list chat messages: %w", err)
	}
	defer rows.Close()
	var out []ChatMessage
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan chat message: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertChatPair 在一个事务里写入 (用户消息, 分析师回复). LLM 成功后才落库 —
// 失败时什么都不留, 客户端可原样重试, 不产生悬空的单边消息.
func (r *Repository) InsertChatPair(ctx context.Context, userID, evaluationID uuid.UUID, userText, analystText string) ([]ChatMessage, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `
		INSERT INTO gate_chat_messages (evaluation_id, user_id, role, content, created_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, role, content, created_at
	`
	now := time.Now().UTC()
	pair := make([]ChatMessage, 0, 2)
	for _, m := range []struct {
		role, content string
		at            time.Time
	}{
		{"user", userText, now},
		// 回复时间 +1ms, 保证 (created_at, id) 排序下用户消息恒在前
		{"analyst", analystText, now.Add(time.Millisecond)},
	} {
		var row ChatMessage
		if err := tx.QueryRow(ctx, q, evaluationID, userID, m.role, m.content, m.at).Scan(
			&row.ID, &row.Role, &row.Content, &row.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("insert chat message: %w", err)
		}
		pair = append(pair, row)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return pair, nil
}

// ───── service ─────

// ListChat — GET 端的读路径. ownership 由"评估必须属于该用户"保证.
func (s *Service) ListChat(ctx context.Context, userID, evaluationID uuid.UUID) ([]ChatMessage, error) {
	if _, err := s.repo.GetByID(ctx, userID, evaluationID); err != nil {
		return nil, err // ErrNotFound 原样上抛
	}
	return s.repo.ListChatMessages(ctx, userID, evaluationID)
}

// Chat — 用户发一条消息, 同步等否决分析师的回复. 成功返回 [用户消息, 分析师回复].
func (s *Service) Chat(ctx context.Context, userID, evaluationID uuid.UUID, userText string) ([]ChatMessage, error) {
	ev, err := s.repo.GetByID(ctx, userID, evaluationID)
	if err != nil {
		return nil, err
	}
	if ev.Passed || ev.FailedGate == nil {
		return nil, ErrChatNotArchived
	}
	analystKey, ok := mastraAnalystKey[*ev.FailedGate]
	if !ok {
		return nil, fmt.Errorf("unknown failed_gate %d", *ev.FailedGate)
	}
	if !s.mastra.IsConfigured() {
		return nil, ErrChatUnavailable
	}

	rc, err := s.loadRefinement(ctx, ev.RefinementID)
	if err != nil {
		return nil, err
	}
	history, err := s.repo.ListChatMessages(ctx, userID, evaluationID)
	if err != nil {
		return nil, err
	}

	asset, signalText := assetAndSignalText(rc)
	pool := ""
	if ev.ArchivedPool != nil {
		pool = string(*ev.ArchivedPool)
	}
	// humanReason 与归档时一致的口径 (classifyFailure 从 gates 重derive, 幂等)
	_, _, verdict := classifyFailure(ev.Gates)

	req := mastra.AnalystChatRequest{
		Analyst:         analystKey,
		Asset:           asset,
		SignalText:      truncateRunes(signalText, 1200),
		SignalSummary:   truncateRunes(rc.PrimarySignalSummary, 400),
		VerdictDetail:   truncateRunes(verdict, 600),
		GatesBrief:      gatesBrief(ev.Gates),
		ArchivedPool:    pool,
		DistilledText:   truncateRunes(s.loadDistilledText(ctx, ev.RefinementID), 1200),
		ProjectName:     rc.ProjectName,
		ProjectGuidance: rc.ProjectGuidance,
		History:         toMastraHistory(history, 12),
		UserMessage:     userText,
	}
	resp, err := s.mastra.AnalystChat(ctx, req)
	if err != nil {
		s.logger.Warn("analyst chat mastra failed",
			zap.String("evaluation_id", evaluationID.String()), zap.Error(err))
		return nil, ErrChatUnavailable
	}
	reply := strings.TrimSpace(resp.Reply)
	if reply == "" {
		return nil, ErrChatUnavailable
	}

	return s.repo.InsertChatPair(ctx, userID, evaluationID, userText, reply)
}

// loadDistilledText 拉降噪综述给分析师当上下文. 没有 (老数据 / 没走降噪页) → "".
func (s *Service) loadDistilledText(ctx context.Context, refinementID uuid.UUID) string {
	const q = `SELECT COALESCE(distilled_content, '') FROM distillations WHERE refinement_id = $1`
	var out string
	if err := s.pool.QueryRow(ctx, q, refinementID).Scan(&out); err != nil {
		return ""
	}
	return out
}

// gatesBrief 把四位分析师的结论压成给 LLM 看的简报 (每条截断, 防 prompt 爆长).
func gatesBrief(g domain.GateDetail) string {
	line := func(name string, pass bool, detail *string) string {
		mark := "通过"
		if !pass {
			mark = "未通过"
		}
		d := ""
		if detail != nil {
			d = truncateRunes(strings.TrimSpace(*detail), 160)
		}
		if d == "" {
			return fmt.Sprintf("- %s: %s", name, mark)
		}
		return fmt.Sprintf("- %s: %s — %s", name, mark, d)
	}
	return strings.Join([]string{
		line("佐证分析师", g.G1Thickness.Pass, g.G1Thickness.Detail),
		line("共识分析师", g.G2AntiConsensus.Pass, g.G2AntiConsensus.Detail),
		line("时机分析师", g.G3Window.Pass, g.G3Window.Detail),
		line("能力圈分析师", g.G4Edge.Pass, g.G4Edge.Detail),
	}, "\n")
}

// toMastraHistory 取最近 max 条历史转 mastra 形参.
func toMastraHistory(msgs []ChatMessage, max int) []mastra.AnalystChatMessage {
	if len(msgs) > max {
		msgs = msgs[len(msgs)-max:]
	}
	out := make([]mastra.AnalystChatMessage, len(msgs))
	for i, m := range msgs {
		out[i] = mastra.AnalystChatMessage{Role: m.Role, Content: m.Content}
	}
	return out
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

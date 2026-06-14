// Package mastra is the Go HTTP client to the Mastra worker.
//
// 端点 (四位分析师 + M9/M11):
//   - POST /consensus-check    (共识分析师 · 原 G2 反共识)
//   - POST /thickness-check    (佐证分析师 · 原 G1 信号厚度, 替代 cluster 启发式)
//   - POST /timing-check       (时机分析师 · 原 G3 时间窗口, 替代 1-6 月写死规则)
//   - POST /competence-check   (能力圈分析师 · 原 G4 能力圈, 替代关键词启发式)
//   - POST /editor             (M9)
//   - POST /diagnostician      (M11)
//
// 设计:
//   - 短超时 (10s for consensus / thickness, 30s for editor/diagnostician)
//   - URL 为空 → 立即返回 ErrNotConfigured, 调用方 fallback 启发式
//   - 任何错误 → 调用方决定是否 fallback (Phase 3 v1: 都 fallback)
package mastra

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"wiseflow/server/internal/infra/metrics"
)

var ErrNotConfigured = errors.New("mastra http url not set")

type Client struct {
	baseURL       string
	internalToken string
	hc            *http.Client
	// hcLong 给对话类调用 (analyst-chat). 普通 check 30s 上限不变;
	// 对话回复是同步等 LLM 全文, 偶发 30s+ — 单独放宽, 不影响其它调用.
	hcLong *http.Client
}

func New(baseURL, internalToken string) *Client {
	return &Client{
		baseURL:       baseURL,
		internalToken: internalToken,
		hc:            &http.Client{Timeout: 30 * time.Second}, // 单次 call 上限
		hcLong:        &http.Client{Timeout: 90 * time.Second},
	}
}

// IsConfigured returns true iff baseURL is set.
// 调用方先 if !c.IsConfigured() { return fallback() }.
func (c *Client) IsConfigured() bool {
	return c != nil && c.baseURL != ""
}

// ───── ConsensusCheck (M6 G2) ─────

type ConsensusRequest struct {
	Asset           string `json:"asset"`
	SignalText      string `json:"signal_text"`
	ProjectName     string `json:"project_name,omitempty"`
	ProjectGuidance string `json:"project_guidance,omitempty"`
}

// UnpricedDirection 镜像 Mastra consensus agent 的 unpriced_directions 项 (指方向, 不荐股).
type UnpricedDirection struct {
	Angle       string `json:"angle"`
	WhyUnpriced string `json:"why_unpriced"`
	Lens        string `json:"lens,omitempty"`
}

type ConsensusResponse struct {
	Score              int                 `json:"score"`
	NarrativeSummary   string              `json:"narrative_summary"`
	Evidence           []string            `json:"evidence"`
	UnpricedDirections []UnpricedDirection `json:"unpriced_directions"`
}

func (c *Client) ConsensusCheck(ctx context.Context, req ConsensusRequest) (*ConsensusResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("consensus", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp ConsensusResponse
	if err := c.post(ctx, "/consensus-check", "consensus", req, &resp, 10*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── ThicknessCheck (M6 G1) ─────

type ThicknessRequest struct {
	UserID          string   `json:"user_id"`
	SignalID        string   `json:"signal_id"`
	RawText         string   `json:"raw_text"`
	Summary         string   `json:"summary"`
	Tags            []string `json:"tags"`
	ProjectID       string   `json:"project_id,omitempty"`
	ProjectName     string   `json:"project_name,omitempty"`
	ProjectGuidance string   `json:"project_guidance,omitempty"`
}

type ThicknessResponse struct {
	Pass                 bool     `json:"pass"`
	Score                int      `json:"score"`
	SingleSignalRichness int      `json:"single_signal_richness"`
	CrossSignalBreadth   int      `json:"cross_signal_breadth"`
	DimensionsCovered    []string `json:"dimensions_covered"`
	Reasoning            string   `json:"reasoning"`
}

func (c *Client) ThicknessCheck(ctx context.Context, req ThicknessRequest) (*ThicknessResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("thickness", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp ThicknessResponse
	if err := c.post(ctx, "/thickness-check", "thickness", req, &resp, 15*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── TimingCheck (时机分析师 · 原 G3 窗口) ─────

type TimingRequest struct {
	Asset           string  `json:"asset"`
	SignalText      string  `json:"signal_text"`
	StatedAction    string  `json:"stated_action,omitempty"`
	StatedMonths    float64 `json:"stated_months,omitempty"`
	PlanText        string  `json:"plan_text,omitempty"`
	ProjectName     string  `json:"project_name,omitempty"`
	ProjectGuidance string  `json:"project_guidance,omitempty"`
}

type TimingResponse struct {
	Pass        bool    `json:"pass"`
	Months      float64 `json:"months"`
	WindowPhase string  `json:"window_phase"`
	Reasoning   string  `json:"reasoning"`
}

func (c *Client) TimingCheck(ctx context.Context, req TimingRequest) (*TimingResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("timing", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp TimingResponse
	if err := c.post(ctx, "/timing-check", "timing", req, &resp, 15*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── CompetenceCheck (能力圈分析师 · 原 G4 能力圈) ─────

type CompetenceRequest struct {
	Asset           string `json:"asset"`
	SignalText      string `json:"signal_text"`
	Direct          bool   `json:"direct"`
	Round1Text      string `json:"round1_text"`
	ExitText        string `json:"exit_text,omitempty"`
	ProjectName     string `json:"project_name,omitempty"`
	ProjectGuidance string `json:"project_guidance,omitempty"`
}

type CompetenceResponse struct {
	Explain   bool   `json:"explain"`
	ExitKnown bool   `json:"exit_known"`
	Reasoning string `json:"reasoning"`
}

func (c *Client) CompetenceCheck(ctx context.Context, req CompetenceRequest) (*CompetenceResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("competence", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp CompetenceResponse
	if err := c.post(ctx, "/competence-check", "competence", req, &resp, 15*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── Editor (M9) ─────

type EditorRequest struct {
	UserID               string   `json:"user_id"`
	AssetName            string   `json:"asset_name"`
	OpensToday           int      `json:"opens_today"`
	ReasonsForFutureSelf []string `json:"reasons_for_future_self"`
}

type EditorResponse struct {
	EditorText    string `json:"editor_text"`
	QuotedSegment string `json:"quoted_segment"`
}

func (c *Client) Editor(ctx context.Context, req EditorRequest) (*EditorResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("editor", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp EditorResponse
	if err := c.post(ctx, "/editor", "editor", req, &resp, 20*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── Diagnostician (M11) ─────

type DiagnosticianAnswer struct {
	No       int    `json:"no"`
	Dim      string `json:"dim"`
	Question string `json:"question"`
	Choice   string `json:"choice"`
	OpenText string `json:"open_text,omitempty"`
}

type DiagnosticianRequest struct {
	UserID                  string                `json:"user_id"`
	CommitmentAsset         string                `json:"commitment_asset"`
	CommitmentThesisSummary string                `json:"commitment_thesis_summary"`
	Answers                 []DiagnosticianAnswer `json:"answers"`
}

type DiagnosticianResponse struct {
	FocusDim  string `json:"focus_dim"`
	FocusText string `json:"focus_text"`
}

func (c *Client) Diagnostician(ctx context.Context, req DiagnosticianRequest) (*DiagnosticianResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("diagnostician", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp DiagnosticianResponse
	if err := c.post(ctx, "/diagnostician", "diagnostician", req, &resp, 20*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── AnalystChat (归档页 · 与否决分析师继续对话) ─────

// AnalystChatMessage 一条对话历史. Role: "user" | "analyst".
type AnalystChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AnalystChatRequest struct {
	// Analyst: thickness | consensus | timing | competence (按 failed_gate 映射)
	Analyst         string               `json:"analyst"`
	Asset           string               `json:"asset"`
	SignalText      string               `json:"signal_text"`
	SignalSummary   string               `json:"signal_summary,omitempty"`
	VerdictDetail   string               `json:"verdict_detail"`
	GatesBrief      string               `json:"gates_brief,omitempty"`
	ArchivedPool    string               `json:"archived_pool,omitempty"`
	DistilledText   string               `json:"distilled_text,omitempty"`
	ProjectName     string               `json:"project_name,omitempty"`
	ProjectGuidance string               `json:"project_guidance,omitempty"`
	History         []AnalystChatMessage `json:"history,omitempty"`
	UserMessage     string               `json:"user_message"`
}

type AnalystChatResponse struct {
	Reply string `json:"reply"`
}

func (c *Client) AnalystChat(ctx context.Context, req AnalystChatRequest) (*AnalystChatResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("analyst_chat", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp AnalystChatResponse
	if err := c.postWith(ctx, c.hcLong, "/analyst-chat", "analyst_chat", req, &resp, 75*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ───── internal ─────

// ───── ClassifyTweet (订阅模块 · 推文打标/总结) ─────

type TweetClassifyRequest struct {
	TweetText    string `json:"tweet_text"`
	AuthorHandle string `json:"author_handle,omitempty"`
	Lang         string `json:"lang,omitempty"`
}

type TweetClassifyResponse struct {
	Tags      []string `json:"tags"`
	Summary   string   `json:"summary"`
	Category  string   `json:"category"`
	Relevance float64  `json:"relevance"`
}

func (c *Client) ClassifyTweet(ctx context.Context, req TweetClassifyRequest) (*TweetClassifyResponse, error) {
	if !c.IsConfigured() {
		metrics.MastraCalls.WithLabelValues("tweet_classify", "skip").Inc()
		return nil, ErrNotConfigured
	}
	var resp TweetClassifyResponse
	if err := c.post(ctx, "/tweet-classify", "tweet_classify", req, &resp, 20*time.Second); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) post(ctx context.Context, path, metricLabel string, body, out any, timeout time.Duration) error {
	return c.postWith(ctx, c.hc, path, metricLabel, body, out, timeout)
}

func (c *Client) postWith(ctx context.Context, hc *http.Client, path, metricLabel string, body, out any, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	defer func() {
		metrics.MastraDuration.WithLabelValues(metricLabel).Observe(time.Since(start).Seconds())
	}()

	raw, err := json.Marshal(body)
	if err != nil {
		metrics.MastraCalls.WithLabelValues(metricLabel, "err").Inc()
		return fmt.Errorf("marshal: %w", err)
	}
	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		metrics.MastraCalls.WithLabelValues(metricLabel, "err").Inc()
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", c.internalToken)

	resp, err := hc.Do(req)
	if err != nil {
		metrics.MastraCalls.WithLabelValues(metricLabel, "err").Inc()
		return fmt.Errorf("mastra %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		metrics.MastraCalls.WithLabelValues(metricLabel, "err").Inc()
		return fmt.Errorf("mastra %s: status=%d body=%s", path, resp.StatusCode, string(b))
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		metrics.MastraCalls.WithLabelValues(metricLabel, "err").Inc()
		return fmt.Errorf("decode %s: %w", path, err)
	}
	metrics.MastraCalls.WithLabelValues(metricLabel, "ok").Inc()
	return nil
}

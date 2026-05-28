// Package mastra is the Go HTTP client to the Mastra worker.
//
// 四个端点:
//   - POST /consensus-check    (M6 G2)
//   - POST /thickness-check    (M6 G1, 替代 cluster 启发式)
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

	"flashfi/server/internal/infra/metrics"
)

var ErrNotConfigured = errors.New("mastra http url not set")

type Client struct {
	baseURL       string
	internalToken string
	hc            *http.Client
}

func New(baseURL, internalToken string) *Client {
	return &Client{
		baseURL:       baseURL,
		internalToken: internalToken,
		hc:            &http.Client{Timeout: 30 * time.Second}, // 单次 call 上限
	}
}

// IsConfigured returns true iff baseURL is set.
// 调用方先 if !c.IsConfigured() { return fallback() }.
func (c *Client) IsConfigured() bool {
	return c != nil && c.baseURL != ""
}

// ───── ConsensusCheck (M6 G2) ─────

type ConsensusRequest struct {
	Asset      string `json:"asset"`
	SignalText string `json:"signal_text"`
}

type ConsensusResponse struct {
	Score            int      `json:"score"`
	NarrativeSummary string   `json:"narrative_summary"`
	Evidence         []string `json:"evidence"`
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
	UserID   string   `json:"user_id"`
	SignalID string   `json:"signal_id"`
	RawText  string   `json:"raw_text"`
	Summary  string   `json:"summary"`
	Tags     []string `json:"tags"`
}

type ThicknessResponse struct {
	Pass                  bool     `json:"pass"`
	Score                 int      `json:"score"`
	SingleSignalRichness  int      `json:"single_signal_richness"`
	CrossSignalBreadth    int      `json:"cross_signal_breadth"`
	DimensionsCovered     []string `json:"dimensions_covered"`
	Reasoning             string   `json:"reasoning"`
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

// ───── Editor (M9) ─────

type EditorRequest struct {
	UserID               string   `json:"user_id"`
	AssetName            string   `json:"asset_name"`
	OpensToday           int      `json:"opens_today"`
	ReasonsForFutureSelf []string `json:"reasons_for_future_self"`
}

type EditorResponse struct {
	EditorText     string `json:"editor_text"`
	QuotedSegment  string `json:"quoted_segment"`
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

// ───── internal ─────

func (c *Client) post(ctx context.Context, path, metricLabel string, body, out any, timeout time.Duration) error {
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

	resp, err := c.hc.Do(req)
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

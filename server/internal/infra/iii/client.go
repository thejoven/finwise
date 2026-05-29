// Package iii is the HTTP client into the iii orchestration engine.
// Replaces the old natsx.Client. Go has no iii SDK, so the outbox POSTs
// raw JSON to HTTP-trigger endpoints exposed by mastra's iii SDK worker.
//
// Subject → api_path 映射要与 mastra/src/iii/worker.ts 里 HTTP_PATHS 一致.
package iii

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// SubjectPath 把 NATS subject 映射到 iii engine 上的 HTTP api_path.
// 没出现在这表里的 subject (gate.evaluated / gate.archived / commitment.*) 走
// "audit-only" 路径 — outbox 仍会标记为 published 但不发 HTTP.
var SubjectPath = map[string]string{
	"signal.captured":      "/v1/events/signal-captured",
	"refinement.started":   "/v1/events/refinement-started",
	"refinement.answered":  "/v1/events/refinement-answered",
	"refinement.completed": "/v1/events/refinement-completed",
	"gate.passed":          "/v1/events/gate-passed",
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Publish POST payload to the iii HTTP shim function for this subject.
// 返 (handled, error): handled=false 表示这个 subject 不映射到 iii — 调用方应当
// 把 outbox 行标记为 published 但 skip 后续 dispatch.
func (c *Client) Publish(ctx context.Context, subject string, payload []byte) (bool, error) {
	path, ok := SubjectPath[subject]
	if !ok {
		return false, nil
	}
	url := c.baseURL + path

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return true, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return true, fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return true, fmt.Errorf("iii returned %d: %s", resp.StatusCode, string(body))
	}
	return true, nil
}

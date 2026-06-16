// Package metrics holds all Prometheus collectors for the wiseflow server.
//
// 设计原则:
//   - 一个 metric 一个 const + 全包 export var, 用法 metrics.OutboxPublished.Inc()
//   - 名字遵循 Prometheus 惯例: <subsystem>_<unit>_total / _seconds / _bytes
//   - 标签 (labels) 尽量少, 避免 cardinality 爆炸
//   - 一次性 RegisterDefault 在 init() 里挂全局, /metrics endpoint 直接 promhttp.Handler()
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const namespace = "wiseflow"

// ─────────────────── HTTP ───────────────────

var (
	// HTTPRequests counts incoming HTTP requests by path + method + status_class.
	// status_class 用 "2xx" / "3xx" / "4xx" / "5xx" 而不是真实 code, 防 cardinality 爆炸.
	HTTPRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "Total HTTP requests served, by method+route+status_class.",
		},
		[]string{"method", "route", "status_class"},
	)

	// HTTPDuration 直方图. buckets 调整为 API 实际响应时间 (<5ms 占大头).
	HTTPDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "http",
			Name:      "duration_seconds",
			Help:      "HTTP request latency by route.",
			Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
		},
		[]string{"method", "route"},
	)
)

// ─────────────────── Outbox ───────────────────

var (
	OutboxPublished = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "outbox",
			Name:      "published_total",
			Help:      "Outbox messages successfully published to NATS.",
		},
	)

	OutboxFailed = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "outbox",
			Name:      "failed_total",
			Help:      "Outbox messages where publish attempt failed (will retry).",
		},
	)

	OutboxPending = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "outbox",
			Name:      "pending",
			Help:      "Current count of unpublished outbox rows (sampled per drain).",
		},
	)
)

// ─────────────────── Gate (M6) ───────────────────

var (
	GateEvaluations = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "gate",
			Name:      "evaluations_total",
			Help:      "Gate evaluations completed, by outcome (passed/failed) and pool.",
		},
		[]string{"outcome", "pool"}, // outcome=passed|failed, pool=observation|lesson|calendar|discard|none
	)

	GateDuration = prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "gate",
			Name:      "duration_seconds",
			Help:      "Full 4-gate evaluation latency.",
			Buckets:   []float64{0.1, 0.5, 1, 2.5, 5, 10, 20, 30, 60},
		},
	)
)

// ─────────────────── Mastra HTTP client ───────────────────

var (
	MastraCalls = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "mastra",
			Name:      "calls_total",
			Help:      "Outbound Mastra HTTP calls by endpoint and outcome.",
		},
		[]string{"endpoint", "outcome"}, // endpoint=consensus|editor|diagnostician; outcome=ok|err|skip
	)

	MastraDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "mastra",
			Name:      "duration_seconds",
			Help:      "Mastra HTTP call latency.",
			Buckets:   []float64{0.5, 1, 2, 5, 10, 20, 30, 60},
		},
		[]string{"endpoint"},
	)
)

// ─────────────────── Exit checker (M10) ───────────────────

var (
	ExitTransitions = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "exit",
			Name:      "transitions_total",
			Help:      "Holding state transitions triggered by exit checker.",
		},
		[]string{"to"}, // expired|triggered|closed|...
	)

	ExitScanDuration = prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "exit",
			Name:      "scan_duration_seconds",
			Help:      "Time taken to scan all active holdings each cycle.",
			Buckets:   []float64{0.01, 0.05, 0.1, 0.5, 1, 5, 10},
		},
	)
)

// ─────────────────── Recovery sweeper ───────────────────
//
// 自动恢复巡检: 复活被 LLM 偶发抽风搁浅的 signal/tweet. 关键可观测点是
// RecoveryExhausted —— 它把"反复重试仍恢复不了, 已放弃"的静默永久失败显式化,
// 直接对它告警 (>0 即需人工介入).
var (
	// RecoveryRevivals 累计复活的记录数, 按 kind=signal|tweet.
	// 持续上涨说明 LLM 抽风率偏高 (值得查上游), 但本身不是错误.
	RecoveryRevivals = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "recovery",
			Name:      "revivals_total",
			Help:      "Stranded records re-enqueued by the recovery sweeper, by kind (signal|tweet).",
		},
		[]string{"kind"},
	)

	// RecoveryExhausted 每轮巡检采样: 已达复活上限仍卡住的记录数, 按 kind.
	// 这是"放弃"的可见信号 —— 持续 >0 应告警, 留给人工处理.
	RecoveryExhausted = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "recovery",
			Name:      "exhausted",
			Help:      "Records stuck past the revival cap (gave up; needs human attention), by kind.",
		},
		[]string{"kind"},
	)

	RecoveryScanDuration = prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "recovery",
			Name:      "scan_duration_seconds",
			Help:      "Time taken by one recovery sweep cycle.",
			Buckets:   []float64{0.01, 0.05, 0.1, 0.5, 1, 5, 10},
		},
	)
)

// ─────────────────── init ───────────────────

func init() {
	prometheus.MustRegister(
		HTTPRequests, HTTPDuration,
		OutboxPublished, OutboxFailed, OutboxPending,
		GateEvaluations, GateDuration,
		MastraCalls, MastraDuration,
		ExitTransitions, ExitScanDuration,
		RecoveryRevivals, RecoveryExhausted, RecoveryScanDuration,
	)
}

// Handler 返回标准 /metrics handler. 挂到 gin: r.GET("/metrics", gin.WrapH(metrics.Handler())).
func Handler() http.Handler {
	return promhttp.Handler()
}

// StatusClass 把 HTTP status code 映射成 "2xx"/"3xx"/"4xx"/"5xx" 字符串.
// HTTP middleware 用; 防 cardinality 爆炸 (status code 太多).
func StatusClass(status int) string {
	switch {
	case status >= 200 && status < 300:
		return "2xx"
	case status >= 300 && status < 400:
		return "3xx"
	case status >= 400 && status < 500:
		return "4xx"
	case status >= 500:
		return "5xx"
	default:
		return "1xx"
	}
}

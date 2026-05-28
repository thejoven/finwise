package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	natsgo "github.com/nats-io/nats.go"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"flashfi/server/internal/config"
	"flashfi/server/internal/domain"
	"flashfi/server/internal/httpapi"
	"flashfi/server/internal/infra/db"
	mastrax "flashfi/server/internal/infra/mastra"
	natsx "flashfi/server/internal/infra/nats"
	accountmod "flashfi/server/internal/module/account"
	commitmentmod "flashfi/server/internal/module/commitment"
	companionmod "flashfi/server/internal/module/companion"
	exitmod "flashfi/server/internal/module/exit"
	gatemod "flashfi/server/internal/module/gate"
	refinementmod "flashfi/server/internal/module/refinement"
	researchmod "flashfi/server/internal/module/research"
	retrospectmod "flashfi/server/internal/module/retrospect"
	signalmod "flashfi/server/internal/module/signal"
)

// streamName is the JetStream stream that holds all flashfi events.
// Subjects "signal.*", "refinement.*", etc are bound here.
const streamName = "FLASHFI_EVENTS"

// streamSubjects is the union of all event subjects the stream accepts.
// Add Phase 2/3 subjects here as modules land — JetStream Update is safe.
var streamSubjects = []string{
	"signal.>",
	"refinement.>",
	"gate.>",
	"commitment.>",
	"companion.>",
	"exit.>",
	"retrospect.>",
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	logger, err := newLogger(cfg.LogLevel)
	if err != nil {
		return fmt.Errorf("logger: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("db open: %w", err)
	}
	defer pool.Close()
	logger.Info("db connected")

	nc, err := natsx.Connect(cfg.NATSURL)
	if err != nil {
		return fmt.Errorf("nats connect: %w", err)
	}
	defer nc.Close()
	logger.Info("nats connected")

	if err := ensureStream(nc); err != nil {
		return fmt.Errorf("ensure stream: %w", err)
	}

	// ───── Mastra HTTP client (G2 / Editor / Diagnostician) ─────
	// 空 URL 时 client.IsConfigured() = false, 各 service fallback 启发式.
	mastraClient := mastrax.New(cfg.MastraHTTPURL, cfg.InternalToken)
	if mastraClient.IsConfigured() {
		logger.Info("mastra http client wired", zap.String("url", cfg.MastraHTTPURL))
	} else {
		logger.Info("mastra http url empty — services will use heuristic fallbacks")
	}

	// ───── Module wiring ─────
	accountRepo := accountmod.NewRepository(pool)
	accountSvc := accountmod.NewService(accountRepo)
	accountHandler := accountmod.NewHandler(accountSvc)

	// dev bearer 兼容: 保证 DEV_USER_ID 在 users 表有占位行, 使 GET /v1/me 在
	// 用 dev token 时也能返回 (placeholder password_hash 不可登录).
	if err := accountSvc.EnsureDevUser(ctx, cfg.DevUserID, "dev@local"); err != nil {
		logger.Warn("ensure dev user failed (ignored)", zap.Error(err))
	}

	signalRepo := signalmod.NewRepository(pool)
	signalSvc := signalmod.NewService(signalRepo)
	signalHandler := signalmod.NewHandler(signalSvc)

	refinementRepo := refinementmod.NewRepository(pool)
	// signalOwnerCheck: refinement.Start 用它确认 primary_signal_id 属于 user.
	// signalSvc.Get 是 user-filtered, 不属于 → 返 signal.ErrNotFound.
	refinementSvc := refinementmod.NewService(refinementRepo, func(ctx context.Context, userID, signalID uuid.UUID) error {
		_, err := signalSvc.Get(ctx, userID, signalID)
		return err
	})
	refinementHandler := refinementmod.NewHandler(refinementSvc)

	gateRepo := gatemod.NewRepository(pool)
	gateSvc := gatemod.NewService(gateRepo, pool, mastraClient, logger)
	gateHandler := gatemod.NewHandler(gateSvc)

	commitmentRepo := commitmentmod.NewRepository(pool)
	commitmentSvc := commitmentmod.NewService(commitmentRepo)
	commitmentHandler := commitmentmod.NewHandler(commitmentSvc)

	companionRepo := companionmod.NewRepository(pool)
	companionSvc := companionmod.NewService(companionRepo, mastraClient, logger)
	companionHandler := companionmod.NewHandler(companionSvc)

	retrospectRepo := retrospectmod.NewRepository(pool)
	retrospectSvc := retrospectmod.NewService(retrospectRepo, pool, mastraClient, logger)
	retrospectHandler := retrospectmod.NewHandler(retrospectSvc)

	// research 模块: mastra 写检索学习材料, mobile 读"学习卡片".
	// 通过闭包查 session ownership + primary_signal_id, 避免 research → refinement 反向 import.
	researchRepo := researchmod.NewRepository(pool)
	researchSessionLookup := func(ctx context.Context, userID, sessionID uuid.UUID) (uuid.UUID, bool, error) {
		view, err := refinementSvc.Get(ctx, userID, sessionID)
		if err != nil {
			if errors.Is(err, refinementmod.ErrNotFound) {
				return uuid.Nil, false, nil
			}
			return uuid.Nil, false, err
		}
		return view.PrimarySignalID, true, nil
	}
	researchSvc := researchmod.NewService(researchRepo, researchSessionLookup)
	researchHandler := researchmod.NewHandler(researchSvc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           logger,
		DB:               pool,
		DevBearerToken:   cfg.DevBearerToken,
		DevUserID:        cfg.DevUserID,
		InternalToken:    cfg.InternalToken,
		InternalLoopback: cfg.InternalLoopback,
		Sessions:         accountSvc,
		RegisterModules: func(anon, v1, internal *gin.RouterGroup) {
			accountHandler.Register(anon, v1, internal)
			signalHandler.Register(v1, internal)
			refinementHandler.Register(v1, internal)
			gateHandler.Register(v1, internal)
			commitmentHandler.Register(v1, internal)
			companionHandler.Register(v1, internal)
			retrospectHandler.Register(v1, internal)
			researchHandler.Register(v1, internal)
		},
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ───── Background workers ─────
	var workerWG sync.WaitGroup
	workerCtx, workerCancel := context.WithCancel(ctx)
	defer workerCancel()

	outbox := natsx.NewOutboxWorker(pool, nc, logger, natsx.OutboxConfig{
		PollInterval: cfg.OutboxPollInterval,
		BatchSize:    cfg.OutboxBatchSize,
		MaxAttempts:  cfg.OutboxMaxAttempts,
	})
	workerWG.Add(1)
	go func() {
		defer workerWG.Done()
		outbox.Run(workerCtx)
	}()

	gateConsumer := gatemod.NewConsumer(gateSvc, nc, logger)
	workerWG.Add(1)
	go func() {
		defer workerWG.Done()
		gateConsumer.Run(workerCtx)
	}()

	// exit checker 调 retrospect 创建闭包 — main.go 装配跨模块依赖, exit 包不引 retrospect.
	startRetrospectFn := func(ctx context.Context, userID, commitID uuid.UUID, trigger string) error {
		_, err := retrospectSvc.Start(ctx, userID, commitID, domain.RetrospectTrigger(trigger))
		return err
	}
	exitChecker := exitmod.NewChecker(pool, logger, startRetrospectFn)
	workerWG.Add(1)
	go func() {
		defer workerWG.Done()
		exitChecker.Run(workerCtx)
	}()

	// ───── HTTP serve loop ─────
	serveErr := make(chan error, 1)
	go func() {
		logger.Info("http listen", zap.Int("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info("shutdown", zap.String("signal", sig.String()))
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("listen: %w", err)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}

	workerCancel()
	workerWG.Wait()
	return nil
}

// ensureStream creates the JetStream stream lazily on startup.
// Idempotent: noop if it already exists with compatible config.
func ensureStream(client *natsx.Client) error {
	_, err := client.JS.StreamInfo(streamName)
	if err == nil {
		return nil
	}
	if !errors.Is(err, natsgo.ErrStreamNotFound) {
		return fmt.Errorf("stream info: %w", err)
	}
	_, err = client.JS.AddStream(&natsgo.StreamConfig{
		Name:      streamName,
		Subjects:  streamSubjects,
		Storage:   natsgo.FileStorage,
		Retention: natsgo.LimitsPolicy,
		MaxAge:    30 * 24 * time.Hour, // 30 days; Phase 1 audit horizon
	})
	if err != nil {
		return fmt.Errorf("add stream: %w", err)
	}
	return nil
}

func newLogger(level string) (*zap.Logger, error) {
	lvl, err := zapcore.ParseLevel(level)
	if err != nil {
		lvl = zapcore.InfoLevel
	}
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(lvl)
	cfg.DisableStacktrace = true
	cfg.EncoderConfig.TimeKey = "ts"
	cfg.EncoderConfig.EncodeTime = zapcore.RFC3339NanoTimeEncoder
	return cfg.Build()
}


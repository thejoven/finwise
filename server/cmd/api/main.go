package main

import (
	"context"
	"encoding/json"
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
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"flashfi/server/internal/config"
	"flashfi/server/internal/domain"
	"flashfi/server/internal/httpapi"
	"flashfi/server/internal/infra/db"
	iiix "flashfi/server/internal/infra/iii"
	mastrax "flashfi/server/internal/infra/mastra"
	accountmod "flashfi/server/internal/module/account"
	commitmentmod "flashfi/server/internal/module/commitment"
	companionmod "flashfi/server/internal/module/companion"
	exitmod "flashfi/server/internal/module/exit"
	gatemod "flashfi/server/internal/module/gate"
	projectmod "flashfi/server/internal/module/project"
	refinementmod "flashfi/server/internal/module/refinement"
	attentionmod "flashfi/server/internal/module/attention"
	researchmod "flashfi/server/internal/module/research"
	retrospectmod "flashfi/server/internal/module/retrospect"
	signalmod "flashfi/server/internal/module/signal"
)

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

	iiiClient := iiix.NewClient(cfg.IIIHTTPURL)
	logger.Info("iii http client ready", zap.String("url", cfg.IIIHTTPURL))

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

	projectRepo := projectmod.NewRepository(pool)
	projectSvc := projectmod.NewService(projectRepo)
	projectHandler := projectmod.NewHandler(projectSvc)

	signalRepo := signalmod.NewRepository(pool)
	// projectOwnerCheck: signal.Capture 用它校验请求里的 project_id 属于 user 且未归档.
	signalSvc := signalmod.NewService(signalRepo, func(ctx context.Context, userID, projectID uuid.UUID) error {
		err := projectSvc.ValidateOwnership(ctx, userID, projectID)
		if err != nil {
			if errors.Is(err, projectmod.ErrNotFound) {
				return signalmod.ErrInvalidProject
			}
			return err
		}
		return nil
	})
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

	attentionRepo := attentionmod.NewRepository(pool)
	attentionSvc := attentionmod.NewService(attentionRepo)
	attentionHandler := attentionmod.NewHandler(attentionSvc)

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
			projectHandler.Register(v1, internal)
			signalHandler.Register(v1, internal)
			refinementHandler.Register(v1, internal)
			gateHandler.Register(v1, internal)
			commitmentHandler.Register(v1, internal)
			companionHandler.Register(v1, internal)
			retrospectHandler.Register(v1, internal)
			researchHandler.Register(v1, internal)
			attentionHandler.Register(v1, internal)
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

	// gate 评估: 原来由 NATS pull consumer 异步触发 (refinement.completed durable
	// "gate-evaluator"). 切到 iii 后, iii 没有 Go SDK, 所以把 gate.Evaluate 作为
	// outbox 的 postPublish 回调内联起来 — 事件成功 POST 到 iii 之后, 同一进程里
	// 顺手把 gate 跑完, 跑出来的 gate.passed/gate.archived 走正常 outbox 路径.
	postPublish := func(ctx context.Context, subject string, payload []byte) {
		if subject != "refinement.completed" {
			return
		}
		var p domain.RefinementCompletedPayload
		if err := json.Unmarshal(payload, &p); err != nil {
			logger.Error("gate inline: decode payload", zap.Error(err))
			return
		}
		if p.Decision == domain.RefinementTrainingOnly {
			logger.Info("gate inline: skipped (training_only)",
				zap.String("refinement_id", p.RefinementID.String()))
			return
		}
		start := time.Now()
		if _, err := gateSvc.Evaluate(ctx, p.RefinementID); err != nil {
			logger.Warn("gate inline evaluate failed",
				zap.String("refinement_id", p.RefinementID.String()),
				zap.Error(err))
			return
		}
		logger.Info("gate inline evaluated",
			zap.String("refinement_id", p.RefinementID.String()),
			zap.Duration("dur", time.Since(start)))
	}

	outbox := iiix.NewOutboxWorker(pool, iiiClient, logger, iiix.OutboxConfig{
		PollInterval: cfg.OutboxPollInterval,
		BatchSize:    cfg.OutboxBatchSize,
		MaxAttempts:  cfg.OutboxMaxAttempts,
		PostPublish:  postPublish,
	})
	workerWG.Add(1)
	go func() {
		defer workerWG.Done()
		outbox.Run(workerCtx)
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


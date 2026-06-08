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
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"wiseflow/server/internal/config"
	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/httpapi"
	"wiseflow/server/internal/infra/db"
	iiix "wiseflow/server/internal/infra/iii"
	mastrax "wiseflow/server/internal/infra/mastra"
	accountmod "wiseflow/server/internal/module/account"
	attentionmod "wiseflow/server/internal/module/attention"
	commitmentmod "wiseflow/server/internal/module/commitment"
	companionmod "wiseflow/server/internal/module/companion"
	distillationmod "wiseflow/server/internal/module/distillation"
	exitmod "wiseflow/server/internal/module/exit"
	gatemod "wiseflow/server/internal/module/gate"
	invitemod "wiseflow/server/internal/module/invite"
	projectmod "wiseflow/server/internal/module/project"
	refinementmod "wiseflow/server/internal/module/refinement"
	researchmod "wiseflow/server/internal/module/research"
	retrospectmod "wiseflow/server/internal/module/retrospect"
	signalmod "wiseflow/server/internal/module/signal"
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
	// invite 先于 account 构建 —— account.Register 经闭包消费邀请码 (注册门禁).
	inviteRepo := invitemod.NewRepository(pool)
	inviteSvc := invitemod.NewService(inviteRepo)
	inviteHandler := invitemod.NewHandler(inviteSvc)

	accountRepo := accountmod.NewRepository(pool)
	// 邀请码门禁: Redeem 把 invite.ErrNotRedeemable 翻成 account.ErrInviteInvalid,
	// 让 account 不必 import invite 的 sentinel.
	accountSvc := accountmod.NewService(accountRepo, accountmod.InviteGateFuncs{
		Redeem: func(ctx context.Context, code string) error {
			if err := inviteSvc.Redeem(ctx, code); err != nil {
				if errors.Is(err, invitemod.ErrNotRedeemable) {
					return accountmod.ErrInviteInvalid
				}
				return err
			}
			return nil
		},
		Refund: func(ctx context.Context, code string) error {
			return inviteSvc.Refund(ctx, code)
		},
	})
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

	// distillation: 降噪页. mastra post-refinement workflow 写回, mobile 读.
	distillationRepo := distillationmod.NewRepository(pool)
	distillationSvc := distillationmod.NewService(distillationRepo)
	distillationHandler := distillationmod.NewHandler(distillationSvc)

	router := httpapi.NewRouter(httpapi.Deps{
		Logger:           logger,
		DB:               pool,
		DevBearerToken:   cfg.DevBearerToken,
		DevUserID:        cfg.DevUserID,
		InternalToken:    cfg.InternalToken,
		InternalLoopback: cfg.InternalLoopback,
		Sessions:         accountSvc,
		AdminLookup:      accountSvc,
		RegisterModules: func(anon, v1, internal, admin *gin.RouterGroup) {
			accountHandler.Register(anon, v1, internal, admin)
			inviteHandler.Register(admin)
			projectHandler.Register(v1, internal)
			signalHandler.Register(v1, internal)
			refinementHandler.Register(v1, internal)
			gateHandler.Register(v1, internal)
			commitmentHandler.Register(v1, internal)
			companionHandler.Register(v1, internal)
			retrospectHandler.Register(v1, internal)
			researchHandler.Register(v1, internal)
			attentionHandler.Register(v1, internal)
			distillationHandler.Register(v1, internal)
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

	// gate 评估不再自动触发. 改成"前置于投决会": refinement 完成后先进降噪页
	// (mastra post-refinement: distiller + beneficiary), 由用户在降噪页手动点
	// "上投决会"才走 gate (POST /v1/gate/evaluate → gateSvc.EvaluateDetached).
	// attention-analyze 仍由 iii 在 refinement.completed 上照常跑, 不受影响.
	outbox := iiix.NewOutboxWorker(pool, iiiClient, logger, iiix.OutboxConfig{
		PollInterval: cfg.OutboxPollInterval,
		BatchSize:    cfg.OutboxBatchSize,
		MaxAttempts:  cfg.OutboxMaxAttempts,
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

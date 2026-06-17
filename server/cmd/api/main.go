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
	marketdatax "wiseflow/server/internal/infra/marketdata"
	mastrax "wiseflow/server/internal/infra/mastra"
	twtapix "wiseflow/server/internal/infra/twtapi"
	accountmod "wiseflow/server/internal/module/account"
	assetmod "wiseflow/server/internal/module/asset"
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
	subscriptionmod "wiseflow/server/internal/module/subscription"
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

	// project 先于 account 构建 —— account.Register 经闭包为新用户预置默认分类.
	projectRepo := projectmod.NewRepository(pool)
	projectSvc := projectmod.NewService(projectRepo)
	projectHandler := projectmod.NewHandler(projectSvc)

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
	},
		// provisionDefaults: 注册建好用户后为其建默认分类 (与 mobile useEnsureCategory 同名),
		// 使"信号未分类 → 落 firstActive"兜底从注册即生效. best-effort: 重复 (与 mobile 竞态)
		// 当成功, 其他错误记日志但不阻断注册.
		func(ctx context.Context, userID uuid.UUID) error {
			if _, err := projectSvc.Create(ctx, projectmod.CreateCommand{
				UserID: userID,
				Name:   projectmod.DefaultName,
			}); err != nil && !errors.Is(err, projectmod.ErrDuplicateName) {
				logger.Warn("provision default project failed (ignored)",
					zap.String("user_id", userID.String()), zap.Error(err))
				return err
			}
			return nil
		})
	accountHandler := accountmod.NewHandler(accountSvc)

	// dev bearer 兼容: 保证 DEV_USER_ID 在 users 表有占位行, 使 GET /v1/me 在
	// 用 dev token 时也能返回 (placeholder password_hash 不可登录).
	if err := accountSvc.EnsureDevUser(ctx, cfg.DevUserID, "dev@local"); err != nil {
		logger.Warn("ensure dev user failed (ignored)", zap.Error(err))
	}

	signalRepo := signalmod.NewRepository(pool)
	// projectOwnerCheck: signal.Capture 用它校验请求里的 project_id 属于 user 且未归档.
	// firstActiveProject: signal.RecordInference 在"信号未分类且 AI 弃权"时兜底落到用户第一个
	//   活跃分类 (与 mobile useEnsureCategory 同序), 保证信号永远有归属、可见.
	signalSvc := signalmod.NewService(signalRepo,
		func(ctx context.Context, userID, projectID uuid.UUID) error {
			err := projectSvc.ValidateOwnership(ctx, userID, projectID)
			if err != nil {
				if errors.Is(err, projectmod.ErrNotFound) {
					return signalmod.ErrInvalidProject
				}
				return err
			}
			return nil
		},
		func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
			actives, err := projectSvc.ListActive(ctx, userID)
			if err != nil || len(actives) == 0 {
				return nil, err
			}
			return &actives[0].ID, nil
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

	// subscription: 推文订阅 (采集 poller + 分类派发 + REST). 转信号经闭包走
	// signal.Capture — 与 exit→retrospect 同样的 main.go 装配模式, 不反向 import.
	twtClient := twtapix.New(cfg.TwtAPIKey)
	subscriptionRepo := subscriptionmod.NewRepository(pool)
	subscriptionSvc := subscriptionmod.NewService(subscriptionRepo, twtClient, mastraClient,
		func(ctx context.Context, userID, clientEventID uuid.UUID, rawText string) (uuid.UUID, bool, error) {
			// promote 兜底归类: 落到用户第一个活跃分类 (provisional, auto_assigned), 信号立即可见;
			// 之后 mastra analyst 判好会覆盖到更合适的分类. AI 故障也不丢信号 (产品无未分类视图).
			var pid *uuid.UUID
			if actives, perr := projectSvc.ListActive(ctx, userID); perr == nil && len(actives) > 0 {
				pid = &actives[0].ID
			}
			res, err := signalSvc.Capture(ctx, signalmod.CaptureCommand{
				UserID:              userID,
				ClientEventID:       clientEventID,
				ProjectID:           pid,
				ProjectAutoAssigned: pid != nil,
				RawText:             rawText,
				OccurredAt:          time.Now().UTC(),
			})
			if err != nil {
				return uuid.Nil, false, err
			}
			return res.Signal.ID, res.Duplicate, nil
		}, logger)
	subscriptionHandler := subscriptionmod.NewHandler(subscriptionSvc)

	// asset: 标的归一 (P0) + 行情追踪 (P1). 资产/别名注册表 + signal_assets 链接 (冻结锚点);
	// resolver: 别名缓存 → 规则 → Mastra LLM → 诚实兜底 untrackable (回填走 cmd/asset-backfill);
	// 行情经 marketdata.Provider 抽象, P1 默认 eastmoney A股 (price poller 见下).
	assetRepo := assetmod.NewRepository(pool)
	assetSvc := assetmod.NewService(assetRepo, mastraClient, logger)
	assetHandler := assetmod.NewHandler(assetSvc)

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
			subscriptionHandler.Register(v1)
			assetHandler.Register(v1)
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

	// 订阅采集 + 分类派发 worker. key 缺失 / 显式关闭 → 不起 (REST 读历史照常).
	if cfg.SubscriptionPollEnabled && twtClient.IsConfigured() {
		subscriptionPoller := subscriptionmod.NewPoller(subscriptionSvc, logger)
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			subscriptionPoller.Run(workerCtx)
		}()
	} else {
		logger.Info("subscription poller disabled",
			zap.Bool("enabled", cfg.SubscriptionPollEnabled),
			zap.Bool("twtapi_configured", twtClient.IsConfigured()))
	}

	// 行情同步 worker (标的追踪 P1): pending 标的从锚点回填日线、active 日更; 显式关闭则不起
	// (REST 读已缓存行情照常). 初次批量回填可用 cmd/asset-price-sync 立即跑一遍.
	if cfg.AssetPricePollEnabled {
		assetPricePoller := assetmod.NewPricePoller(assetRepo, marketdatax.New(cfg.MarketDataProvider), logger)
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			assetPricePoller.Run(workerCtx)
		}()
	} else {
		logger.Info("asset price poller disabled")
	}

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

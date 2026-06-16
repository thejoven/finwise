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
	twitterdatax "wiseflow/server/internal/infra/twitterdata"
	twtapix "wiseflow/server/internal/infra/twtapi"
	xsource "wiseflow/server/internal/infra/xsource"
	accountmod "wiseflow/server/internal/module/account"
	adminmod "wiseflow/server/internal/module/admin"
	attentionmod "wiseflow/server/internal/module/attention"
	commitmentmod "wiseflow/server/internal/module/commitment"
	companionmod "wiseflow/server/internal/module/companion"
	distillationmod "wiseflow/server/internal/module/distillation"
	exitmod "wiseflow/server/internal/module/exit"
	gatemod "wiseflow/server/internal/module/gate"
	invitemod "wiseflow/server/internal/module/invite"
	projectmod "wiseflow/server/internal/module/project"
	recommendmod "wiseflow/server/internal/module/recommend"
	recoverymod "wiseflow/server/internal/module/recovery"
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

// newXProvider 按 cfg.XProvider 选 X 数据源实现 (xsource.Provider). 这是供应商抽象的唯一
// 装配点 —— 加新供应商: 这里加一个 case + 各自的 env 凭证, 订阅模块 (service/poller) 零改动.
func newXProvider(cfg *config.Config, logger *zap.Logger) xsource.Provider {
	switch cfg.XProvider {
	case "twtapi", "":
		return twtapix.New(cfg.TwtAPIKey)
	case "twitterdata":
		// 骨架: HTTP/鉴权层已通, 解析待样本 (twitterdata/parse.go 的 errParseTODO).
		// 切到本 provider 前须先填 parse + 抓样本, 否则采集每轮报错 (不崩, 但采不到).
		return twitterdatax.New(cfg.TwitterDataToken)
	default:
		logger.Warn("unknown X_PROVIDER, falling back to twtapi",
			zap.String("provider", cfg.XProvider))
		return twtapix.New(cfg.TwtAPIKey)
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
	xProvider := newXProvider(cfg, logger)
	subscriptionRepo := subscriptionmod.NewRepository(pool)
	subscriptionSvc := subscriptionmod.NewService(subscriptionRepo, xProvider, mastraClient,
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

	// recommend: 主动信号推荐. P0「画像底座」—— builder 从既有行为轨迹 (signals/gate/
	// commitments/holdings/retrospects/转信号 tweets) 派生每用户 alpha 画像, 落 user_alpha_profile.
	// 本期只有一个内部端点 (手动触发重算, 供验证); 策展漏斗 + cron 留待 P1.
	recommendRepo := recommendmod.NewRepository(pool)
	recommendSvc := recommendmod.NewService(recommendRepo, logger)
	recommendHandler := recommendmod.NewHandler(recommendSvc)

	// admin: 运营后台跨表聚合 (系统总览 KPI + 研判漏斗 + AI 推断健康). 只读, 仅依赖 pool.
	// 挂 adminV1 (/v1/admin, RequireAdmin), 与 account/invite 的 admin 路由并列.
	adminRepo := adminmod.NewRepository(pool)
	adminSvc := adminmod.NewService(adminRepo)
	adminHandler := adminmod.NewHandler(adminSvc)

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
			adminHandler.Register(admin)
			projectHandler.Register(v1, internal, admin)
			signalHandler.Register(v1, internal, admin)
			refinementHandler.Register(v1, internal, admin)
			gateHandler.Register(v1, internal, admin)
			commitmentHandler.Register(v1, internal, admin)
			companionHandler.Register(v1, internal)
			retrospectHandler.Register(v1, internal, admin)
			researchHandler.Register(v1, internal)
			attentionHandler.Register(v1, internal)
			distillationHandler.Register(v1, internal, admin)
			subscriptionHandler.Register(v1, admin)
			recommendHandler.Register(internal)
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

	// recovery sweeper — 自动复活被 LLM 偶发抽风搁浅的 signal/tweet (inference 卡
	// 'pending' / classify 卡 'failed'). 重置 outbox 行 / 重新 pending 来重新驱动,
	// 带复活次数上限 + 冷却, 幂等不产生重复信号. 默认开; RECOVERY_ENABLED=false
	// 可关 (关掉后永久搁浅仍只能人工恢复).
	if cfg.RecoveryEnabled {
		sweeper := recoverymod.New(pool, logger, recoverymod.Config{
			SweepInterval: cfg.RecoverySweepInterval,
			Cooldown:      cfg.RecoveryCooldown,
			MaxRevivals:   cfg.RecoveryMaxRevivals,
			BatchSize:     cfg.RecoveryBatchSize,
		})
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			sweeper.Run(workerCtx)
		}()
	} else {
		logger.Info("recovery sweeper disabled (RECOVERY_ENABLED=false)")
	}

	// 订阅采集 + 分类派发 worker. key 缺失 / 显式关闭 → 不起 (REST 读历史照常).
	if cfg.SubscriptionPollEnabled && xProvider.IsConfigured() {
		subscriptionPoller := subscriptionmod.NewPoller(subscriptionSvc, logger)
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			subscriptionPoller.Run(workerCtx)
		}()
	} else {
		logger.Info("subscription poller disabled",
			zap.Bool("enabled", cfg.SubscriptionPollEnabled),
			zap.String("x_provider", cfg.XProvider),
			zap.Bool("provider_configured", xProvider.IsConfigured()))
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

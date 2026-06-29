package app

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/config"
	"alphax/server/internal/domain"
	"alphax/server/internal/httpapi"
	"alphax/server/internal/infra/db"
	iiix "alphax/server/internal/infra/iii"
	marketdatax "alphax/server/internal/infra/marketdata"
	mastrax "alphax/server/internal/infra/mastra"
	objstore "alphax/server/internal/infra/objstore"
	twitterdatax "alphax/server/internal/infra/twitterdata"
	twtapix "alphax/server/internal/infra/twtapi"
	xsource "alphax/server/internal/infra/xsource"
	accountmod "alphax/server/internal/module/account"
	adminmod "alphax/server/internal/module/admin"
	assetmod "alphax/server/internal/module/asset"
	attentionmod "alphax/server/internal/module/attention"
	billingmod "alphax/server/internal/module/billing"
	commitmentmod "alphax/server/internal/module/commitment"
	companionmod "alphax/server/internal/module/companion"
	distillationmod "alphax/server/internal/module/distillation"
	exitmod "alphax/server/internal/module/exit"
	gatemod "alphax/server/internal/module/gate"
	invitemod "alphax/server/internal/module/invite"
	projectmod "alphax/server/internal/module/project"
	recommendmod "alphax/server/internal/module/recommend"
	recoverymod "alphax/server/internal/module/recovery"
	refinementmod "alphax/server/internal/module/refinement"
	reportmod "alphax/server/internal/module/report"
	researchmod "alphax/server/internal/module/research"
	retrospectmod "alphax/server/internal/module/retrospect"
	settingsmod "alphax/server/internal/module/settings"
	signalmod "alphax/server/internal/module/signal"
	subscriptionmod "alphax/server/internal/module/subscription"
)

// worker is a named background loop. App.Run launches each one under the worker
// context and waits for them all on shutdown.
type worker struct {
	name string
	run  func(context.Context)
}

// newXProvider picks the X data-source implementation (xsource.Provider) by
// cfg.XProvider. This is the sole assembly point for the provider abstraction —
// adding a vendor: one case here + its env credentials, the subscription module
// (service/poller) is untouched.
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

// assemble wires every module and returns the HTTP router plus the background
// worker set. It is the composition graph: it may know about every module, but
// it holds no business logic — the cross-module policy lives in adapters.go and
// each module owns its own behavior.
func assemble(ctx context.Context, cfg *config.Config, logger *zap.Logger, pool *db.Pool) (*gin.Engine, []worker, error) {
	iiiClient := iiix.NewClient(cfg.IIIHTTPURL)
	logger.Info("iii http client ready", zap.String("url", cfg.IIIHTTPURL))

	// Mastra HTTP client (G2 / Editor / Diagnostician). Empty URL →
	// IsConfigured() = false, services fall back to heuristics.
	mastraClient := mastrax.New(cfg.MastraHTTPURL, cfg.InternalToken)
	if mastraClient.IsConfigured() {
		logger.Info("mastra http client wired", zap.String("url", cfg.MastraHTTPURL))
	} else {
		logger.Info("mastra http url empty — services will use heuristic fallbacks")
	}

	// invite 先于 account 构建 —— account.Register 经闭包消费邀请码 (注册门禁).
	inviteRepo := invitemod.NewRepository(pool)
	inviteSvc := invitemod.NewService(inviteRepo)
	inviteHandler := invitemod.NewHandler(inviteSvc)

	// project 先于 account 构建 —— account.Register 经闭包为新用户预置默认分类.
	projectRepo := projectmod.NewRepository(pool)
	projectSvc := projectmod.NewService(projectRepo)
	projectHandler := projectmod.NewHandler(projectSvc)

	// settings: 后台可配的运行时设置 (当前: 对象存储 R2 凭证, 持久化到 app_settings).
	// objstore 依赖它取实时配置; avatarSigner 给头像私有读代理签发短期 URL (key 派生自 InternalToken).
	settingsRepo := settingsmod.NewRepository(pool)
	settingsSvc := settingsmod.NewService(settingsRepo)
	objStorage := objstore.New(settingsSvc)
	avatarSigner := accountmod.NewAvatarSigner(cfg.InternalToken, 24*time.Hour)

	accountRepo := accountmod.NewRepository(pool)
	accountSvc := accountmod.NewService(accountRepo,
		inviteGate(inviteSvc),
		provisionDefaultProject(projectSvc, logger))
	accountSvc.SetStorage(objStorage) // 头像上传/读取依赖
	accountHandler := accountmod.NewHandler(accountSvc)
	accountHandler.SetAvatarSigner(avatarSigner) // DTO 现签 avatar_url + 读代理校验

	// dev bearer 兼容: 保证 DEV_USER_ID 在 users 表有占位行, 使 GET /v1/me 在
	// 用 dev token 时也能返回 (placeholder password_hash 不可登录).
	if err := accountSvc.EnsureDevUser(ctx, cfg.DevUserID, "dev@local"); err != nil {
		logger.Warn("ensure dev user failed (ignored)", zap.Error(err))
	}

	signalRepo := signalmod.NewRepository(pool)
	signalSvc := signalmod.NewService(signalRepo,
		signalProjectValidator(projectSvc),
		firstActiveProject(projectSvc))
	signalHandler := signalmod.NewHandler(signalSvc)
	signalHandler.SetASR(cfg.ASRServiceURL) // 语音转写代理 → GLM-ASR

	refinementRepo := refinementmod.NewRepository(pool)
	refinementSvc := refinementmod.NewService(refinementRepo, refinementSignalOwner(signalSvc))
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

	// research: mastra 写检索学习材料, mobile 读"学习卡片".
	researchRepo := researchmod.NewRepository(pool)
	researchSvc := researchmod.NewService(researchRepo, researchSessionLookup(refinementSvc))
	researchHandler := researchmod.NewHandler(researchSvc)

	attentionRepo := attentionmod.NewRepository(pool)
	attentionSvc := attentionmod.NewService(attentionRepo)
	attentionHandler := attentionmod.NewHandler(attentionSvc)

	// distillation: 降噪页. mastra post-refinement workflow 写回, mobile 读.
	distillationRepo := distillationmod.NewRepository(pool)
	distillationSvc := distillationmod.NewService(distillationRepo)
	distillationHandler := distillationmod.NewHandler(distillationSvc)

	// subscription: 推文订阅 (采集 poller + 分类派发 + REST). 转信号经 subscriptionPromote
	// 走 signal.Capture — 与 exit→retrospect 同样的装配模式, 不反向 import.
	xProvider := newXProvider(cfg, logger)
	subscriptionRepo := subscriptionmod.NewRepository(pool)
	subscriptionSvc := subscriptionmod.NewService(subscriptionRepo, xProvider, mastraClient,
		subscriptionPromote(projectSvc, signalSvc), logger)
	subscriptionHandler := subscriptionmod.NewHandler(subscriptionSvc)

	// asset: 标的归一 (P0) + 行情追踪 (P1). resolver: 别名缓存 → 规则 → Mastra LLM →
	// 诚实兜底 untrackable; 行情经 marketdata.Provider 抽象 (price poller 见下).
	assetRepo := assetmod.NewRepository(pool)
	assetSvc := assetmod.NewService(assetRepo, mastraClient, logger)
	assetHandler := assetmod.NewHandler(assetSvc)

	// 推文分类时把 AI 抽出的 ticker 归一成 asset 并链 tweet_assets (闭包注入, 不反向 import).
	subscriptionSvc.SetResolveAsset(assetSvc.ResolveReference)
	// 新信号推演落库后实时把 related_assets 归一成 signal_assets (异步 best-effort).
	signalSvc.SetAfterInference(resolveSignalAssetsAsync(assetSvc, logger))

	// recommend: 主动信号推荐 (画像底座 + 持仓相关情报策展漏斗).
	recommendRepo := recommendmod.NewRepository(pool)
	recommendSvc := recommendmod.NewService(recommendRepo, recommendmod.CuratorConfig{
		RelevanceMin:        cfg.RecRelevanceMin,
		PerCommitmentQuota:  cfg.RecPerCommitmentQuota,
		CandidateWindowDays: cfg.RecCandidateWindowDays,
	}, logger)
	recommendHandler := recommendmod.NewHandler(recommendSvc)

	// admin: 运营后台跨表聚合 (只读, 仅依赖 pool). 挂 /v1/admin (RequireAdmin).
	adminRepo := adminmod.NewRepository(pool)
	adminSvc := adminmod.NewService(adminRepo)
	adminSvc.SetStorage(settingsSvc, objStorage) // 对象存储后台配置端点依赖
	adminHandler := adminmod.NewHandler(adminSvc)

	// billing: App Store 订阅 (经 RevenueCat) 的服务端真相 + webhook. 与 module/subscription
	// (X 推文订阅) 无关 —— 那是采集数据源, 这是付费订阅.
	billingRepo := billingmod.NewRepository(pool)
	billingSvc := billingmod.NewService(billingRepo, cfg.RevenueCatWebhookAuth, logger)
	billingHandler := billingmod.NewHandler(billingSvc)

	// report: 早报. 每日 08:00 (REPORT_TZ) 把"前一天转为信号"的内容跨用户去标识化聚合成编者早报.
	reportRepo := reportmod.NewRepository(pool)
	reportLoc, _ := time.LoadLocation(cfg.ReportTimezone) // config.Load 已 fail-fast 校验, 此处不会 err
	reportSvc := reportmod.NewService(reportRepo, mastraClient,
		reportDeps(assetSvc, projectSvc, accountSvc),
		reportmod.ServiceConfig{MinAssets: cfg.ReportMinAssets, Loc: reportLoc}, logger)
	reportHandler := reportmod.NewHandler(reportSvc)

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
			recommendHandler.Register(v1, internal)
			billingHandler.Register(anon, v1)
			assetHandler.Register(v1)
			reportHandler.Register(v1, internal, admin)
		},
	})

	workers := buildWorkers(cfg, logger, pool, iiiClient,
		retrospectSvc, subscriptionSvc, xProvider, assetRepo, reportSvc, reportLoc)

	return router, workers, nil
}

// buildWorkers constructs the background worker set, honoring the per-worker
// enable flags. Disabled workers are omitted (and logged) rather than started.
func buildWorkers(
	cfg *config.Config,
	logger *zap.Logger,
	pool *db.Pool,
	iiiClient *iiix.Client,
	retrospectSvc *retrospectmod.Service,
	subscriptionSvc *subscriptionmod.Service,
	xProvider xsource.Provider,
	assetRepo *assetmod.Repository,
	reportSvc *reportmod.Service,
	reportLoc *time.Location,
) []worker {
	var workers []worker

	// outbox → iii. gate 评估不再自动触发 (改用户在降噪页手动上投决会);
	// attention-analyze 仍由 iii 在 refinement.completed 上照常跑.
	outbox := iiix.NewOutboxWorker(pool, iiiClient, logger, iiix.OutboxConfig{
		PollInterval: cfg.OutboxPollInterval,
		BatchSize:    cfg.OutboxBatchSize,
		MaxAttempts:  cfg.OutboxMaxAttempts,
	})
	workers = append(workers, worker{"outbox", outbox.Run})

	// exit checker → retrospect.Start (跨模块依赖在装配层注入, exit 不引 retrospect).
	startRetrospectFn := func(ctx context.Context, userID, commitID uuid.UUID, trigger string) error {
		_, err := retrospectSvc.Start(ctx, userID, commitID, domain.RetrospectTrigger(trigger))
		return err
	}
	exitChecker := exitmod.NewChecker(pool, logger, startRetrospectFn)
	workers = append(workers, worker{"exit-checker", exitChecker.Run})

	// recovery sweeper — 自动复活被 LLM 偶发抽风搁浅的 signal/tweet. 默认开;
	// RECOVERY_ENABLED=false 可关 (关掉后永久搁浅仍只能人工恢复).
	if cfg.RecoveryEnabled {
		sweeper := recoverymod.New(pool, logger, recoverymod.Config{
			SweepInterval: cfg.RecoverySweepInterval,
			Cooldown:      cfg.RecoveryCooldown,
			MaxRevivals:   cfg.RecoveryMaxRevivals,
			BatchSize:     cfg.RecoveryBatchSize,
		})
		workers = append(workers, worker{"recovery-sweeper", sweeper.Run})
	} else {
		logger.Info("recovery sweeper disabled (RECOVERY_ENABLED=false)")
	}

	// 订阅采集 + 分类派发. key 缺失 / 显式关闭 → 不起 (REST 读历史照常).
	if cfg.SubscriptionPollEnabled && xProvider.IsConfigured() {
		poller := subscriptionmod.NewPoller(subscriptionSvc, logger)
		workers = append(workers, worker{"subscription-poller", poller.Run})
	} else {
		logger.Info("subscription poller disabled",
			zap.Bool("enabled", cfg.SubscriptionPollEnabled),
			zap.String("x_provider", cfg.XProvider),
			zap.Bool("provider_configured", xProvider.IsConfigured()))
	}

	// 行情同步 (标的追踪 P1): pending 标的从锚点回填日线、active 日更; 显式关闭则不起.
	if cfg.AssetPricePollEnabled {
		pricePoller := assetmod.NewPricePoller(assetRepo, marketdatax.New(cfg.MarketDataProvider), logger)
		workers = append(workers, worker{"asset-price-poller", pricePoller.Run})
	} else {
		logger.Info("asset price poller disabled")
	}

	// 早报生成 — 每日 08:00 (REPORT_TZ) 把前一天信号去标识化聚合成编者早报. REPORT_ENABLED=false 可关.
	if cfg.ReportEnabled {
		reportGen := reportmod.NewGenerator(reportSvc, reportLoc, reportmod.GenConfig{
			ScanInterval: cfg.ReportScanInterval,
			HourLocal:    cfg.ReportHourLocal,
		}, logger)
		workers = append(workers, worker{"morning-report", reportGen.Run})
	} else {
		logger.Info("morning report generator disabled (REPORT_ENABLED=false)")
	}

	return workers
}

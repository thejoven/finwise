package subscription

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/infra/mastra"
	"alphax/server/internal/infra/xsource"
)

var (
	// ErrUnsupportedType — source_type 不是 twitter (telegram/rss 规划中, 管理页灰态).
	ErrUnsupportedType = errors.New("subscription: source type not supported yet")
	// ErrInvalidHandle — handle 不合法 (剥 @ 后须是 1-15 位字母数字下划线).
	ErrInvalidHandle = errors.New("subscription: invalid handle")
	// ErrLimitReached — 软上限 (产品哲学兼成本闸门: 先读完手头的, 再添新的).
	ErrLimitReached = errors.New("subscription: limit reached")
	// ErrAccountNotFound — 数据源查不到该账号 (404 / 受保护).
	ErrAccountNotFound = errors.New("subscription: twitter account not found")
	// ErrSourceUnavailable — 数据源未配置或配额耗尽, 暂时无法解析新订阅.
	ErrSourceUnavailable = errors.New("subscription: source temporarily unavailable")
)

// MaxSubscriptionsPerUser — 单用户订阅软上限 (开发文档 §3.5 成本账; server 下发给客户端).
const MaxSubscriptionsPerUser = 30

const (
	pollIntervalMin     = 900   // 15min
	pollIntervalDefault = 1800  // 30min
	pollIntervalMax     = 10800 // 3h
	maxBackfillPages    = 5
	classifyMaxAttempts = 3
	// notInterestedMuteThreshold — 同一标签被「不感兴趣」命中达此次数 → 静音 (feed 隐藏带该标签的推文).
	// 取 2 而非 1: 一次下滑不立刻封一个标签, 累积才生效 (防误伤, 见开发文档 §3 硬二).
	notInterestedMuteThreshold = 2
)

var handleRe = regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`)

// CaptureSignalFn — main.go 装配的闭包, 转信号时调 signal.Capture.
// 闭包形式避免 subscription 反向 import signal 模块 (同 exit→retrospect 的先例).
type CaptureSignalFn func(ctx context.Context, userID, clientEventID uuid.UUID, rawText string) (signalID uuid.UUID, duplicate bool, err error)

// ResolveAssetFn — main.go 装配的闭包, 把推文 AI 抽取的 ticker 归一成 asset_id
// (复用 asset.Service.ResolveReference). 闭包形式避免 subscription 反向 import asset (同 captureSignal 先例).
type ResolveAssetFn func(ctx context.Context, reference, contextText string) (uuid.UUID, error)

type Service struct {
	repo          *Repository
	provider      xsource.Provider
	mastra        *mastra.Client
	captureSignal CaptureSignalFn
	resolveAsset  ResolveAssetFn
	logger        *zap.Logger
}

func NewService(repo *Repository, provider xsource.Provider, mastraClient *mastra.Client, captureSignal CaptureSignalFn, logger *zap.Logger) *Service {
	return &Service{repo: repo, provider: provider, mastra: mastraClient, captureSignal: captureSignal, logger: logger}
}

// SetResolveAsset 装配标的归一闭包 (main.go 在 asset.Service 建好后注入). nil → 不抽推文标的.
func (s *Service) SetResolveAsset(fn ResolveAssetFn) { s.resolveAsset = fn }

// ───────────────────────── 订阅 ─────────────────────────

// NormalizeHandle 剥 @/空格/大小写差异 (twitter handle 大小写不敏感).
func NormalizeHandle(raw string) (string, error) {
	h := strings.TrimSpace(raw)
	h = strings.TrimPrefix(h, "@")
	// 容忍粘贴整个 profile URL
	if i := strings.LastIndex(h, "/"); i >= 0 {
		h = h[i+1:]
	}
	if !handleRe.MatchString(h) {
		return "", ErrInvalidHandle
	}
	return h, nil
}

// ResolveHandle — 管理页「解析预览」: 只查资料不建订阅 (防错订重名号, UX 规格 §8.3 第 2 步).
func (s *Service) ResolveHandle(ctx context.Context, rawHandle string) (*xsource.Account, error) {
	handle, err := NormalizeHandle(rawHandle)
	if err != nil {
		return nil, err
	}
	return s.lookupAccount(ctx, handle)
}

func (s *Service) lookupAccount(ctx context.Context, handle string) (*xsource.Account, error) {
	acct, err := s.provider.LookupAccount(ctx, handle)
	if err != nil {
		switch {
		case errors.Is(err, xsource.ErrNotFound):
			return nil, ErrAccountNotFound
		case errors.Is(err, xsource.ErrNotConfigured),
			errors.Is(err, xsource.ErrQuotaExceeded),
			errors.Is(err, xsource.ErrRateLimited):
			s.logger.Warn("x source unavailable", zap.Error(err))
			return nil, ErrSourceUnavailable
		default:
			return nil, fmt.Errorf("resolve handle: %w", err)
		}
	}
	return acct, nil
}

// Subscribe — 解析 handle → upsert 账号 → 建订阅 → 异步回填第一页.
func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, sourceType, rawHandle string) (*SubscriptionView, error) {
	if sourceType == "" {
		sourceType = SourceTypeTwitter
	}
	if sourceType != SourceTypeTwitter {
		return nil, ErrUnsupportedType
	}
	handle, err := NormalizeHandle(rawHandle)
	if err != nil {
		return nil, err
	}

	n, err := s.repo.CountActiveSubscriptions(ctx, userID)
	if err != nil {
		return nil, err
	}
	if n >= MaxSubscriptionsPerUser {
		return nil, ErrLimitReached
	}

	acct, err := s.lookupAccount(ctx, handle)
	if err != nil {
		return nil, err
	}

	accountID, err := s.repo.UpsertAccount(ctx, *acct)
	if err != nil {
		return nil, err
	}
	subID, err := s.repo.Subscribe(ctx, userID, accountID)
	if err != nil {
		return nil, err
	}

	// 首次回填: 异步拉第一页, 不阻塞订阅响应. 失败无妨 — poller 下轮会追上.
	go func() {
		bctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if err := s.pollAccount(bctx, DueAccount{
			ID: accountID, RestID: acct.RestID, Handle: acct.Handle,
			HighWater: "", PollIntervalSec: pollIntervalDefault,
		}); err != nil {
			s.logger.Warn("backfill after subscribe failed",
				zap.String("handle", acct.Handle), zap.Error(err))
		}
	}()

	return s.repo.GetSubscriptionView(ctx, userID, subID)
}

func (s *Service) Unsubscribe(ctx context.Context, userID, subID uuid.UUID) error {
	return s.repo.Unsubscribe(ctx, userID, subID)
}

func (s *Service) ListSubscriptions(ctx context.Context, userID uuid.UUID) ([]SubscriptionView, error) {
	return s.repo.ListSubscriptions(ctx, userID)
}

// ───────────────────────── feed / 已读 ─────────────────────────

func (s *Service) Feed(ctx context.Context, in FeedInput) ([]TweetView, string, bool, error) {
	return s.repo.FeedPage(ctx, in)
}

func (s *Service) GetTweet(ctx context.Context, userID uuid.UUID, tweetID string) (*TweetView, error) {
	return s.repo.GetTweet(ctx, userID, tweetID)
}

func (s *Service) MarkRead(ctx context.Context, userID uuid.UUID, tweetID string) error {
	return s.repo.MarkRead(ctx, userID, tweetID)
}

func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID, subscriptionID *uuid.UUID) (int, error) {
	return s.repo.MarkAllRead(ctx, userID, subscriptionID)
}

func (s *Service) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.repo.UnreadCount(ctx, userID)
}

// NotInterested — 下滑「不感兴趣」: 隐藏当条 + 按内容标签累积厌恶 + 顺手已读 (开发文档 §5).
// 返回本次新静音的标签.
func (s *Service) NotInterested(ctx context.Context, userID uuid.UUID, tweetID string) ([]string, error) {
	return s.repo.RecordNotInterested(ctx, userID, tweetID, notInterestedMuteThreshold)
}

// SaveTweet — 上滑「稍后读」: 移出未读 deck + 收进稍后读 bucket.
func (s *Service) SaveTweet(ctx context.Context, userID uuid.UUID, tweetID string) error {
	return s.repo.SaveTweet(ctx, userID, tweetID)
}

// UnsaveTweet — 取消稍后读.
func (s *Service) UnsaveTweet(ctx context.Context, userID uuid.UUID, tweetID string) error {
	return s.repo.UnsaveTweet(ctx, userID, tweetID)
}

// ListMutedTags — 内容偏好: 列出已静音标签.
func (s *Service) ListMutedTags(ctx context.Context, userID uuid.UUID) ([]MutedTag, error) {
	return s.repo.ListMutedTags(ctx, userID)
}

// UnmuteTag — 取消静音某标签.
func (s *Service) UnmuteTag(ctx context.Context, userID uuid.UUID, tag string) error {
	return s.repo.UnmuteTag(ctx, userID, tag)
}

// ───────────────────────── 转为信号 ─────────────────────────

// Promote 把一条推文落进现有信号管线 (零新管道, 开发文档 §5.5).
//   - note 非空 → 用户的话当 raw_text 主体, 推文作引用出处
//   - note 空   → 原文直通, 前缀 via @handle
//   - client_event_id 由 (userID, tweetID) 派生 → 同一推文重复转返回同一 signal (幂等)
func (s *Service) Promote(ctx context.Context, userID uuid.UUID, tweetID, note string) (uuid.UUID, bool, error) {
	if s.captureSignal == nil {
		return uuid.Nil, false, errors.New("subscription: capture fn not wired")
	}
	tw, err := s.repo.GetTweet(ctx, userID, tweetID)
	if err != nil {
		return uuid.Nil, false, err
	}

	note = strings.TrimSpace(note)
	quoted := truncateRunes(tw.Text, 1500)
	var rawText string
	if note != "" {
		rawText = truncateRunes(note, 400) + "\n—— via @" + tw.Handle + ": " + quoted
	} else {
		rawText = "via @" + tw.Handle + ": " + quoted
	}
	rawText = truncateRunes(rawText, 2000) // signal.Capture 上限

	clientEventID := uuid.NewSHA1(uuid.NameSpaceOID,
		[]byte("tweet-promote:"+userID.String()+":"+tweetID))

	signalID, duplicate, err := s.captureSignal(ctx, userID, clientEventID, rawText)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("promote tweet %s: %w", tweetID, err)
	}
	// 顺手记已读 — 都决定转信号了, 这条显然读过了.
	if err := s.repo.MarkRead(ctx, userID, tweetID); err != nil && !errors.Is(err, ErrNotFound) {
		s.logger.Warn("promote: mark read failed", zap.String("tweet_id", tweetID), zap.Error(err))
	}
	return signalID, duplicate, nil
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max-1]) + "…"
}

// ───────────────────────── 采集 (poller 调) ─────────────────────────

// PollDue 认领一批到点账号并采集. 返回 xsource.ErrQuotaExceeded 时 poller 全局暂停.
func (s *Service) PollDue(ctx context.Context, batch int) error {
	if !s.provider.IsConfigured() {
		return nil
	}
	accounts, err := s.repo.ClaimDueAccounts(ctx, batch)
	if err != nil {
		return err
	}
	for _, a := range accounts {
		if err := s.pollAccount(ctx, a); err != nil {
			if errors.Is(err, xsource.ErrQuotaExceeded) {
				return err // 上抛 → poller 全局暂停, 别空转烧配额
			}
			s.logger.Warn("poll account failed", zap.String("handle", a.Handle), zap.Error(err))
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}

// pollAccount — 单账号增量采集 (开发文档 §3.4):
// 自上而下收新推 (id > 高水位), 整页全新且有积压才翻页 (≤5 页); 首采只取第一页.
func (s *Service) pollAccount(ctx context.Context, a DueAccount) error {
	page, err := s.provider.UserTweets(ctx, a.RestID, "")
	if err != nil {
		return s.handlePollError(ctx, a, err)
	}

	var fresh []xsource.Tweet
	newest := a.HighWater
	pages := 1
	for {
		allNew := len(page.Tweets) > 0
		for _, tw := range page.Tweets {
			// 置顶推/RT 会乱序 — 旧推跳过不 break, 整页扫完 (按 id 判断, 不靠位置).
			if a.HighWater != "" && xsource.CompareIDs(tw.ID, a.HighWater) <= 0 {
				allNew = false
				continue
			}
			fresh = append(fresh, tw)
			if newest == "" || xsource.CompareIDs(tw.ID, newest) > 0 {
				newest = tw.ID
			}
		}
		// 翻页补抓: 仅当整页都是新推 (停机积压); 首采 (无高水位) 只回填第一页.
		if !allNew || a.HighWater == "" || page.BottomCursor == "" || pages >= maxBackfillPages {
			break
		}
		page, err = s.provider.UserTweets(ctx, a.RestID, page.BottomCursor)
		if err != nil {
			s.logger.Warn("backfill page failed", zap.String("handle", a.Handle), zap.Error(err))
			break
		}
		pages++
	}

	inserted, err := s.repo.InsertTweets(ctx, a.ID, fresh)
	if err != nil {
		return err
	}

	// 自适应间隔: 有新推 → 提速到下限; 空轮 → 翻倍 (有上限).
	interval := a.PollIntervalSec
	if inserted > 0 {
		interval = pollIntervalMin
	} else {
		interval *= 2
		if interval > pollIntervalMax {
			interval = pollIntervalMax
		}
		if interval < pollIntervalMin {
			interval = pollIntervalDefault
		}
	}
	if err := s.repo.UpdateAfterPoll(ctx, a.ID, newest, interval); err != nil {
		return err
	}
	if inserted > 0 {
		s.logger.Info("polled tweets",
			zap.String("handle", a.Handle), zap.Int("new", inserted), zap.Int("pages", pages))
	}
	return nil
}

func (s *Service) handlePollError(ctx context.Context, a DueAccount, err error) error {
	switch {
	case errors.Is(err, xsource.ErrNotFound):
		s.logger.Warn("account gone, stop polling", zap.String("handle", a.Handle))
		return s.repo.MarkAccountStatus(ctx, a.ID, "not_found")
	case errors.Is(err, xsource.ErrRateLimited):
		// 退避: 间隔翻倍, 本轮放弃.
		interval := a.PollIntervalSec * 2
		if interval > pollIntervalMax {
			interval = pollIntervalMax
		}
		_ = s.repo.UpdateAfterPoll(ctx, a.ID, "", interval)
		return nil
	default:
		return err
	}
}

// ───────────────────────── 分类派发 (poller 调) ─────────────────────────

// DispatchPending 认领待分类推文, 并发同步调 Mastra /tweet-classify, 直接回写.
// at-least-once: pending+attempts 即持久化队列 (开发计划 §0 架构修订).
func (s *Service) DispatchPending(ctx context.Context, batch int) {
	if !s.mastra.IsConfigured() {
		return // 未配置 → 不烧 attempts, 推文保持 pending, 配好后自动追上
	}
	items, err := s.repo.ClaimPendingClassify(ctx, batch, classifyMaxAttempts)
	if err != nil {
		s.logger.Warn("claim pending classify failed", zap.Error(err))
		return
	}
	if len(items) == 0 {
		return
	}

	var wg sync.WaitGroup
	for _, it := range items {
		wg.Add(1)
		go func(p PendingTweet) {
			defer wg.Done()
			res, err := s.mastra.ClassifyTweet(ctx, mastra.TweetClassifyRequest{
				TweetText:    p.Text,
				AuthorHandle: p.Handle,
				Lang:         p.Lang,
			})
			if err != nil {
				s.logger.Warn("classify failed",
					zap.String("tweet_id", p.ID), zap.Int("attempt", p.Attempts), zap.Error(err))
				if p.Attempts >= classifyMaxAttempts {
					_ = s.repo.MarkClassifyFailed(ctx, p.ID)
				}
				return
			}
			if err := s.repo.RecordClassifyResult(ctx, p.ID,
				res.Tags, res.Summary, res.Category, res.Relevance); err != nil {
				s.logger.Warn("record classify failed", zap.String("tweet_id", p.ID), zap.Error(err))
			}
			// P2: 归一并链接 AI 抽出的相关标的 (best-effort, 在 classify 回写之后).
			s.linkTweetAssets(ctx, p.ID, p.Text, res.RelatedAssets)
		}(it)
	}
	wg.Wait()
}

// linkTweetAssets 把推文 AI 抽取的 ticker 归一成 asset 并链到 tweet_assets (P2, 复用 signal 同款归一).
// best-effort: 单个 ticker 归一/链接失败只记日志跳过, 不影响推文已回写的 classify 结果.
func (s *Service) linkTweetAssets(ctx context.Context, tweetID, tweetText string, assets []mastra.TweetRelatedAsset) {
	if s.resolveAsset == nil {
		return
	}
	for _, a := range assets {
		ticker := strings.TrimSpace(a.Ticker)
		if ticker == "" {
			continue
		}
		contextText := a.Rationale
		if contextText == "" {
			contextText = tweetText
		}
		assetID, err := s.resolveAsset(ctx, ticker, contextText)
		if err != nil {
			s.logger.Warn("tweet asset resolve failed",
				zap.String("tweet_id", tweetID), zap.String("ticker", ticker), zap.Error(err))
			continue
		}
		if err := s.repo.LinkTweetAsset(ctx, tweetID, assetID, a.Rationale); err != nil {
			s.logger.Warn("tweet asset link failed",
				zap.String("tweet_id", tweetID), zap.String("ticker", ticker), zap.Error(err))
		}
	}
}

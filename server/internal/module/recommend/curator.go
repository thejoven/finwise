package recommend

// curator.go —— P1「持仓相关情报」的策展漏斗 (规格 §3 / 计划 §3 W2).
//
// 红线 (规格 §0): 克制的策展引擎, 不是发现/推送引擎.
//   - 只对**活跃已签命题**召情报 (锚在你已押的命题上, 几乎不可能是噪音);
//   - 候选紧贴命题标的; 配额是**硬上限**, 不过线就沉默 (空, 不凑数);
//   - 不自动建信号 —— 只是"建议你看一眼".
//
// 漏斗 (本期 W2, 尚无 W3 Mastra 精排时的降级形态):
//
//	候选(CandidateTweetsForAsset) → 粗排(relevance×时新×画像tag亲和) → 硬配额 → 写 recommendations.
//
// W3 落地后, 在"粗排"与"写"之间插入 Mastra /recommend 精排 (反证优先 + 默认丢弃); 见 TODO(W3).

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

const candidateFetchLimit = 50 // 每命题最多取多少候选进粗排 (粗排前的上界)

// CuratorConfig — 策展旋钮 (来自 config.REC_*).
type CuratorConfig struct {
	RelevanceMin        float64
	PerCommitmentQuota  int
	CandidateWindowDays int
}

// Curator 是策展漏斗. 无状态 (每次按需读), 持有 repo + 配置.
type Curator struct {
	repo   *Repository
	cfg    CuratorConfig
	logger *zap.Logger
}

func NewCurator(repo *Repository, cfg CuratorConfig, logger *zap.Logger) *Curator {
	return &Curator{repo: repo, cfg: cfg, logger: logger}
}

// CurateResult — 一个用户一次策展的汇总.
type CurateResult struct {
	UserID               string `json:"user_id"`
	CommitmentsProcessed int    `json:"commitments_processed"`
	Written              int    `json:"written"`
}

// CurateForUser 对该用户所有活跃命题跑一遍漏斗.
func (c *Curator) CurateForUser(ctx context.Context, userID uuid.UUID) (CurateResult, error) {
	res := CurateResult{UserID: userID.String()}
	commits, err := c.repo.ActiveSignedCommitments(ctx, userID)
	if err != nil {
		return res, fmt.Errorf("active commitments %s: %w", userID, err)
	}
	if len(commits) == 0 {
		return res, nil
	}
	affinity, err := c.repo.GetProfileTagAffinity(ctx, userID)
	if err != nil {
		return res, fmt.Errorf("tag affinity %s: %w", userID, err)
	}
	for _, cm := range commits {
		n, err := c.curateCommitment(ctx, userID, cm, affinity, time.Now())
		if err != nil {
			return res, err
		}
		res.CommitmentsProcessed++
		res.Written += n
	}
	return res, nil
}

// curateCommitment 对单条命题: 配额余量 → 候选 → 粗排 → 取余量写入. 返回写入数.
func (c *Curator) curateCommitment(ctx context.Context, userID uuid.UUID, cm CommitmentTarget, affinity map[string]float64, now time.Time) (int, error) {
	// 配额硬上限: 已有活跃推荐占满即沉默.
	existing, err := c.repo.CountActiveCommitmentRecs(ctx, userID, cm.ID)
	if err != nil {
		return 0, err
	}
	headroom := c.cfg.PerCommitmentQuota - existing
	if headroom <= 0 {
		return 0, nil
	}
	terms := assetTerms(cm)
	if len(terms) == 0 {
		return 0, nil // 命题无可匹配标的 (文书异常), 跳过
	}
	cands, err := c.repo.CandidateTweetsForAsset(ctx, userID, cm.ID, terms, c.cfg.RelevanceMin, c.cfg.CandidateWindowDays, candidateFetchLimit)
	if err != nil {
		return 0, err
	}
	if len(cands) == 0 {
		return 0, nil // 沉默 (正确行为, 非 bug)
	}
	// TODO(W3): 此处插入 Mastra /recommend 精排 (反证优先 + 默认丢弃); 当前为粗排降级形态.
	ranked := rankCandidates(cands, affinity, c.cfg.CandidateWindowDays, now)
	written := 0
	for _, sc := range ranked {
		if written >= headroom {
			break
		}
		if _, err := c.repo.UpsertRecommendation(ctx, Recommendation{
			UserID:      userID,
			SourceID:    sc.tweet.ID,
			Score:       float32(sc.score),
			Rationale:   rationaleForCommitment(cm),
			ContextType: ContextCommitment,
			TargetRef:   &cm.ID,
		}); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

// CurateAllResult — 全量策展汇总.
type CurateAllResult struct {
	Users   int `json:"users"`
	Written int `json:"written"`
	Failed  int `json:"failed"`
}

// CurateAll 对所有有活跃命题的用户跑策展. best-effort: 单用户失败记日志续跑.
func (c *Curator) CurateAll(ctx context.Context) (CurateAllResult, error) {
	var res CurateAllResult
	users, err := c.repo.ListUsersWithActiveCommitments(ctx)
	if err != nil {
		return res, fmt.Errorf("list users with active commitments: %w", err)
	}
	res.Users = len(users)
	for _, uid := range users {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		r, err := c.CurateForUser(ctx, uid)
		if err != nil {
			res.Failed++
			c.logger.Warn("curate user failed (skipped)", zap.String("user_id", uid.String()), zap.Error(err))
			continue
		}
		res.Written += r.Written
	}
	c.logger.Info("curate all done",
		zap.Int("users", res.Users), zap.Int("written", res.Written), zap.Int("failed", res.Failed))
	return res, nil
}

// ───────────────────────── 纯函数 (可单测, 不碰 DB) ─────────────────────────

// assetTerms 取命题用于匹配推文的标的词 (ticker + 名), 去空去重.
func assetTerms(cm CommitmentTarget) []string {
	var terms []string
	seen := map[string]bool{}
	for _, t := range []string{cm.Asset, cm.AssetName} {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		terms = append(terms, t)
	}
	return terms
}

type scoredCandidate struct {
	tweet CandidateTweet
	score float64
}

// rankCandidates 粗排: score = relevance × 时新因子 × (1 + tag 亲和增益), 降序 (稳定排序).
//   - 时新因子: 越新越高 (按 windowDays 线性衰减, 下限 0.1).
//   - tag 亲和增益: 候选标签在画像 tag_affinity 里的最大权重 (0..1) —— 你越在乎的赛道越靠前.
func rankCandidates(cands []CandidateTweet, affinity map[string]float64, windowDays int, now time.Time) []scoredCandidate {
	out := make([]scoredCandidate, 0, len(cands))
	for _, t := range cands {
		ageDays := now.Sub(t.CreatedAt).Hours() / 24
		recency := recencyFactor(ageDays, windowDays)
		boost := 1.0 + maxAffinity(t.Tags, affinity)
		out = append(out, scoredCandidate{tweet: t, score: round(t.Relevance*recency*boost, 4)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].score > out[j].score })
	return out
}

// recencyFactor 时新因子: ageDays=0 → 1, 到 windowDays → ~0, 下限 0.1 (旧但相关仍给点分).
func recencyFactor(ageDays float64, windowDays int) float64 {
	if windowDays <= 0 {
		return 1
	}
	f := 1.0 - ageDays/float64(windowDays)
	if f < 0.1 {
		return 0.1
	}
	if f > 1 {
		return 1
	}
	return f
}

// maxAffinity 取候选标签命中画像 tag_affinity 的最大权重 (无命中 → 0).
func maxAffinity(tags []string, affinity map[string]float64) float64 {
	max := 0.0
	for _, t := range tags {
		if w := affinity[t]; w > max {
			max = w
		}
	}
	return max
}

// rationaleForCommitment 产出 W2 降级期的"为你"理由 (中性直接, 走产品文案口径).
// W3 落地后由 Mastra 产更细的反证/印证判语替换之.
func rationaleForCommitment(cm CommitmentTarget) string {
	asset := strings.TrimSpace(cm.Asset)
	if asset == "" {
		asset = strings.TrimSpace(cm.AssetName)
	}
	if asset == "" {
		return "与你的一条在持命题相关的新进展"
	}
	return "与你持仓「" + asset + "」相关的新进展"
}

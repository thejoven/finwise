# 例 5 · 英文 + AI 基础设施

**输入**:

> Anthropic just opened API access to its computer-use feature. Internal teams are already replacing 3 SaaS subscriptions with a single Claude agent.

**输出** (JSON):

```json
{
  "tags": ["Anthropic", "computer-use", "agent SaaS displacement", "API economics"],
  "related_assets": [
    { "ticker": "Anthropic", "rationale": "computer-use 把 SaaS 替代纳入 token 计费, 单客户 API 消耗 N 倍放大", "order": "first" },
    { "ticker": "AWS", "rationale": "Anthropic 主要算力供给方, token 量翻倍直接受益", "order": "first" },
    { "ticker": "Zapier/UiPath-like", "rationale": "传统 workflow / RPA SaaS 的产品价值被 agent 替代, 续费率拐点", "order": "second" }
  ],
  "cognitive_layer": "second",
  "consensus_check": "aligned",
  "one_line_summary": "computer-use 让 agent 吞并 SaaS, API token 量级跃迁"
}
```

**关键点**: 英文 + 一级市场公司 (Anthropic) 直接写公司名作 ticker, 不强行映射到上市公司.

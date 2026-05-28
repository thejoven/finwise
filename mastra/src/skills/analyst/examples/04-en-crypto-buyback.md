# 例 4 · 英文 + crypto, 反共识 token buyback 叙事

**输入**:

> Having now done it a few times, I can say: Discussing Hyperliquid with financial advisors is magic. The fact that 99% of fees goes to buying back tokens makes the conversation so easy.

**输出** (JSON, ticker 用 crypto 代号, 不要硬塞 A 股):

```json
{
  "tags": ["Hyperliquid", "token buyback", "fee revenue", "advisor distribution"],
  "related_assets": [
    { "ticker": "HYPE", "rationale": "99% fees 回购 token, 现金流直接转化为持有人价值, 投顾对 \"看得懂的现金流\" 敏感", "order": "first" },
    { "ticker": "DYDX", "rationale": "同类 perp DEX 历史上也有 fee buyback 但未形成投顾级叙事, 反向参照", "order": "second" },
    { "ticker": "ETH", "rationale": "Hyperliquid 资金流入背后是 perp DEX 占用 stable 流动性, 边际上侧面承压", "order": "third" }
  ],
  "cognitive_layer": "second",
  "consensus_check": "leading",
  "one_line_summary": "HYPE 回购模型对投顾\"好卖\", ETF 通道之外的传统资金入口"
}
```

**关键点**: ticker 字段直接写 token 代号 (HYPE / ETH / DYDX), 不强行映射到 Coinbase / 美股 crypto 公司.

# 例 3 · 错误示范 (绝不要这么写)

**输入**:

> DeepSeek 私有化部署的客户在变多.

**错误输出** (反模式):

```json
{
  "related_assets": [
    { "ticker": "NVDA", "rationale": "建议关注 H100 短期看多" }
  ]
}
```

错在哪: 出现 "建议关注" / "短期看多" — 这是行动指令, Analyst 不许给.

**正确输出**:

```json
{
  "tags": ["DeepSeek", "私有化部署", "GPU 需求"],
  "related_assets": [
    { "ticker": "NVDA", "rationale": "H100/H200 私有化部署常用, 单部署量小但合同密度上升", "order": "first" }
  ],
  "cognitive_layer": "first",
  "consensus_check": "aligned",
  "one_line_summary": "DeepSeek 私有化拐点, 单合同小但密度上升"
}
```

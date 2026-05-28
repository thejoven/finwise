# 例 1 · 中文 + A 股半导体, 清晰二阶链

**输入**:

> 今天供应商说 HBM 又涨价了, 第三次了. 我们做 AI 推理盒的, 这季度 BOM 又要重算.

**输出** (JSON):

```json
{
  "tags": ["HBM", "内存涨价", "AI 硬件 BOM"],
  "related_assets": [
    { "ticker": "SK Hynix", "rationale": "HBM 主供, 涨价直接受益方", "order": "first" },
    { "ticker": "Samsung Memory", "rationale": "HBM 二供, 跟涨", "order": "first" },
    { "ticker": "Marvell/Astera Labs", "rationale": "AI 服务器 BOM 重算后, 系统厂商更看重内存外的连通性优化, 互连侧受益", "order": "second" }
  ],
  "cognitive_layer": "second",
  "consensus_check": "aligned",
  "one_line_summary": "HBM 第三轮涨价, 推理侧 BOM 压力外溢到互连"
}
```

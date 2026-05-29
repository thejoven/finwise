# 例 1 · 节奏稳, 深度够, 视角窄

**输入 (简化)**:

- R1 single 8s correct, R2 multi 12s correct (但只选了 1 个 lens), R3 ordering 15s correct, R4 open 90s correct, R5 commitment 60s 完成 (action+duration+80字理由+退出条件)
- 信号: "HBM 第三轮涨价, AI 推理盒 BOM 重算"

**输出**:

```json
{
  "focus_score": 82,
  "depth_score": 78,
  "breadth_score": 45,
  "execution_score": 88,
  "insight": "你这次推演链条到位, R3 排序对得上反身性中段, 但 R2 多选题只挑了金融视角的供应链 lens — 法律/工程/博弈三条线全漏.",
  "blindspot": "下次 R2 至少强制选 3 个非金融 lens (法律 / 工程 / 博弈 / 历史) 才算答完."
}
```

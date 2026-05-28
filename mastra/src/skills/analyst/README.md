# Skill · Analyst

Analyst 的 prompt 拆成目录模块。

## 文件清单

| 文件 | 用途 |
|---|---|
| `instructions.md` | Agent system prompt 主体（任务定义 + 严格约束 + cognitive_layer/consensus_check 含义） |
| `strict-output.md` | 输出格式约束（"只输出 JSON, 不带 markdown, 不带前后缀文字"），反复强调以降低 schema fail 率 |
| `examples/01-zh-equity-hbm.md` | 中文 + A 股 + 半导体, 二阶链清晰 |
| `examples/02-zh-vague-empty.md` | 弱信号 → 空数组 |
| `examples/03-zh-anti-pattern.md` | 错误示范（"建议关注"被禁） |
| `examples/04-en-crypto-buyback.md` | **英文 + crypto + token buyback**（修 Hyperliquid DLQ 的根因） |
| `examples/05-en-ai-infra.md` | **英文 + AI infrastructure + 一级公司作 ticker** |
| `index.ts` | 装配 prompt + 跑 Agent + zod 校验 + 1 retry |

## 怎么增强 prompt

### 加一种新领域 / 新语种的 grounding

复制 `examples/01-zh-equity-hbm.md`，改输入和输出，编号往后排（`06-`, `07-` ...）。重启 mastra 即可生效，不动 TS 代码。

### 改任务定义 / 严格约束

编辑 `instructions.md` 或 `strict-output.md`。重启 mastra。

### 改输出 schema

不在本目录 —— schema 在 `mastra/src/agents/schema.ts:InferenceSchema`。

## Runtime

mastra 用 `tsx` 直接跑 TypeScript，markdown 文件在 src 目录里就能 `readFileSync(import.meta.url 相对路径)`。无需 build step。

`index.ts` 在 module load 时一次性 `buildInstructions()` 把所有 markdown 拼成最终 system prompt，之后 Agent 实例复用同一份 prompt。

## 复用到其他 agent

同套结构可以给 socratic / consensus / thickness / editor / diagnostician 各开一个 `skills/<name>/`，收敛全部 prompt 管理方式：

```
mastra/src/skills/
├── analyst/        ← 本目录, 已建
├── socratic/       ← TODO: M5 五轮追问
├── consensus/      ← TODO: M6 G2 反共识打分
├── thickness/      ← TODO: M6 G1 信号厚度
├── editor/         ← TODO: M9 焦虑日陪伴
└── diagnostician/  ← TODO: M11 复盘
```

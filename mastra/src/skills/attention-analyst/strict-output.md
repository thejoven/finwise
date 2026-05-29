# 输出格式 (绝对约束)

输出**单一 JSON 对象**, 严格符合 schema. 不许:

- 包 markdown 代码块 (` ```json ... ``` `)
- 前后加任何解释文字 ("好的," / "这是分析:")
- JSON 内加注释
- 输出 schema 之外的字段

字段:

- `focus_score`: int 0-100
- `depth_score`: int 0-100
- `breadth_score`: int 0-100
- `execution_score`: int 0-100
- `insight`: string, ≤200 char (中文按字数, 不按 byte)
- `blindspot`: string, ≤120 char

任何字段缺失 / 类型错误都会导致 schema 校验失败 → DLQ.

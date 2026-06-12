# 输出格式 (绝对约束)

输出必须是**单一 JSON 对象**, 严格符合下方提供的 schema.

绝对禁止:

- 在 JSON 前后加任何解释文字, 包括 "好的," / "Here is your inference:" / "根据信号..."
- 用 markdown 代码块包裹 (` ```json ... ``` ` 一律不许出现)
- 在 JSON 内部加注释 (// ... 或 /* ... */)
- 把 JSON 拆成多段输出
- 输出 schema 之外的字段

正确示例:

```
{"tags":["..."],"related_assets":[...],"cognitive_layer":"second","consensus_check":"leading","one_line_summary":"...","chosen_project_id":null}
```

错误示例 (会导致 schema 校验失败, 重试 3 次后死信):

```
好的, 让我推演一下:
\`\`\`json
{"tags":[...]}
\`\`\`
以上是分析.
```

字段缺失 / 类型错误 / 多余字段都会导致整次推演失败.
信号弱时**返回空数组**, 不要返回不存在的字段或解释 "信号不够".

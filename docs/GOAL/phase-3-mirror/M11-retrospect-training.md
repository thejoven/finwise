# M11 · 复盘训练 F2

> Phase 3 · W23-W25 · 3 周 · 产品的真正主体, 终点
>
> **整个 GOAL 文档体系的最后一个模块**。完成它 = Flashfi Engine v1.0 完成。

---

## 上下文

M11 是 Flashfi Engine 的**真正主体**。

前面所有模块都在为它服务:
- M1-M4 累积信号
- M5-M8 走完一次承诺仪式
- M9-M10 度过持仓期

到这里, 用户走完一个完整周期, F2 复盘训练让用户**看见自己**——
不是"赚了多少", 而是"我这一次, 在哪里看见了, 在哪里没看见"。

如果 M11 没做对, 整个产品就只是个签字工具, 不是镜子。

---

## 前置依赖

- ✅ M9 持仓陪伴(行为指纹数据)
- ✅ M10 退出条件巡检(触发事件数据)
- ✅ 至少 1 个持仓走完完整周期(可用 mock 时间快进)

---

## 目标

完成后, 当一个持仓 EXPIRED 或 CLOSED 时, 用户进入 F2 复盘:

### F2 时间轴(自绘纵向)
- 把这次持仓涉及的**所有用户接触瞬间**按时间排列
- 节点类型: 弱信号、四门通过、签字、想反悔、财报印证、到期
- 主角是**用户的接触瞬间**, 不是市场事件
- 视觉像电影时间线, 不是 K 线图

### 四问诊断对话
基于这次完整经历, 系统问用户 4 个诊断问题:
1. **感知层** — 最早信号那天你在干什么?
2. **推演层** — 从信号到承诺书, 这段时间你卡在哪一步?
3. **评估层** — 四道门里哪道门让你最犹豫?
4. **执行层** — 签字后你有几次想反悔? 是什么触发的?

每题选项 + 开放回答混合。

### Diagnostician Agent
新建 Mastra Agent, 任务: 看完用户四问的回答后, 给出**一句"下一次训练重点"**。

不是泛泛建议, 是具体诊断:
- "下一次, 缩短从信号到签字的天数, 这次你用了 14 天"
- "下一次, 重点练第二阶推演, 这次你停在了一阶"
- "下一次, 在退出条件里加'认知失效'类条件, 这次你的退出全部是价格类"

### 训练重点写回用户档案
诊断结果**改变下一次 Phase 2 的训练**:
- 下次 M5 五轮追问的题目重点强化这个维度
- 下次 M6 四道门评估的某个门严格度调整

这是产品哲学第 7 条**教练角色, 越用越强**的实现。

---

## 任务列表(高层)

### Task 11.1 · 时间轴数据源

时间轴节点 = 这次持仓 thesis 的所有相关 events:

```sql
SELECT * FROM events
WHERE related_thesis = :thesis_id
   OR (type IN ('signal.captured', 'signal.inference.done')
       AND payload->>'inference_summary' LIKE '%' || :ticker || '%')
ORDER BY occurred_at ASC;
```

节点类型对应事件类型:
- `signal.captured` → 弱信号(白圆)
- `gate.passed` → 四门通过(实心方)
- `commitment.signed` → 签字(红星)
- `companion.shown` + 高频 → 想反悔(警告色 △)
- `external.earning_published` → 财报印证(绿圆, 需 M10 简化版接入)
- `holding.expired` / `holding.triggered` → 到期(黑星)

### Task 11.2 · 时间轴自绘 UI

`app/retrospect/[id].tsx`, **不用第三方 timeline 库**:

```typescript
function Timeline({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <View style={{ flex: 1 }}>
      {nodes.map((node, i) => (
        <TimelineNode
          key={node.id}
          node={node}
          isFirst={i === 0}
          isLast={i === nodes.length - 1}
        />
      ))}
    </View>
  );
}

function TimelineNode({ node, isFirst, isLast }: Props) {
  return (
    <View style={styles.row}>
      {/* 左侧: 日期 */}
      <View style={styles.dateColumn}>
        <Display size={15} weight="bold">{format(node.at, 'dd')}</Display>
        <Mono size={10}>{format(node.at, 'MM月')}</Mono>
      </View>
      
      {/* 中间: 竖线 + 节点 */}
      <View style={styles.lineColumn}>
        {!isFirst && <View style={styles.lineTop} />}
        <NodeMark type={node.type} />
        {!isLast && <View style={styles.lineBottom} />}
      </View>
      
      {/* 右侧: 内容 */}
      <View style={styles.contentColumn}>
        <Display size={14} weight="bold">{node.title}</Display>
        <Serif size={12} italic style={{ color: theme.color.muted }}>
          {node.subtitle}
        </Serif>
        {node.detail && <Serif size={11}>{node.detail}</Serif>}
      </View>
    </View>
  );
}

function NodeMark({ type }) {
  switch (type) {
    case 'signal':       return <View style={styles.circleWhite} />;
    case 'gate_passed':  return <View style={styles.squareBlack} />;
    case 'sign':         return <Text style={styles.starRed}>★</Text>;
    case 'anxiety':      return <View style={styles.triangleWarning} />;
    case 'fundamental':  return <View style={styles.circleGreen} />;
    case 'end':          return <Text style={styles.starBlack}>★</Text>;
  }
}
```

视觉参考: 原型 v4 的 F2 屏。

### Task 11.3 · 诊断对话页

F2 时间轴底部展开"四问"对话:

```
┌──────────────────────────────────┐
│  ◆ 诊断问题 · 第 I 问             │
│                                  │
│  感知层                           │
│                                  │
│  最早一条信号是 1月8日,           │
│  "群里在抢 Mac Studio 512G"。     │
│  你当时意识到这是值得跟进的       │
│  信号了吗?                       │
│                                  │
│  ○ 是, 我当时就觉得有事          │
│  ○ 不是, 我只是顺手记下           │
│  ○ 不确定, 习惯性记录             │
│  ○ 其他                          │
│                                  │
│  [继续下一问 II / IV]             │
└──────────────────────────────────┘
```

UI 复用 M5 五轮追问的卡片样式, 视觉一致。

### Task 11.4 · Diagnostician Agent prompt

参考 `产品文档/05_第五层_复盘训练.md`。

输入: 这次持仓的全部 events + 用户四问的回答
输出: 一句"下一次训练重点"

约束:
- **必须基于事实, 不能泛泛而谈**
- "下一次努力" 这种话**不允许**
- 必须包含一个具体数字或具体维度
- 字数 30-60 字

错误示范:
> ❌ "下一次保持耐心, 相信自己的判断。"
> ❌ "继续努力, 你做得很好!"

正确示范:
> ✓ "下一次, 缩短从信号到签字的天数, 这次你用了 14 天, 收益区间已过去 60%。"
> ✓ "下一次, 重点练第二阶推演, 这次三道追问你都停在了'谁直接受益', 没问'谁因此被打击'。"

### Task 11.5 · 训练重点的存储与应用

```typescript
// 写 users.training_focus 字段
{
  user_id: "...",
  training_focuses: [
    {
      created_at: "2026-04-22",
      thesis_id: "...",
      focus: "second_order_inference",   // 枚举
      detail: "下一次, 重点练第二阶推演..."
    },
    // 最近 5 条
  ]
}
```

下次 Phase 2 的 M5 五轮追问启动时, **拉取最近的 training_focus 加到 prompt**:

```typescript
const lastFocus = await getLatestTrainingFocus(userId);
const socratic = new Agent({
  // ...
  instructions: `
    ${baseInstructions}
    
    ${lastFocus ? `
    用户上一次复盘后的训练重点是: ${lastFocus.detail}
    这一次的五轮追问中, 至少有 2 题要围绕这个维度展开。
    ` : ''}
  `,
});
```

这是闭环的核心 — **产品越用越懂用户的弱点**。

### Task 11.6 · 复盘最终页

四问全答完 + Diagnostician 出训练重点后, 最终页:

```
┌──────────────────────────────────┐
│   F2 · 复盘结束                   │
│                                  │
│   SK 海力士 · 持仓 137 天          │
│   收益 +18.7% · 触发 退出条件 II  │
│                                  │
│  ──────────────────────────────  │
│                                  │
│   ◆ 这次, 你看见了什么            │
│                                  │
│   • 早期信号识别能力强(1 月 8 日) │
│   • 四道门评估扎实, 没有冲动签字   │
│   • 持仓中焦虑 3 次, 都没割肉     │
│                                  │
│  ──────────────────────────────  │
│                                  │
│   ◆ 下一次训练重点                │ ← Display italic
│                                  │
│   "下一次, 缩短从信号到签字       │
│    的天数, 这次你用了 14 天,      │
│    收益区间已过去 60%。"          │
│                                  │
│   — Flashfi 主笔                  │
│                                  │
│  ──────────────────────────────  │
│                                  │
│  [归档这次承诺书 →]               │
└──────────────────────────────────┘
```

签到归档后:
- commitment 状态 → ARCHIVED
- 不再出现在主流程, 但 F2 时间轴随时可查
- training_focus 写入用户档案

### Task 11.7 · 自己用一周(W26)

W26 整周, 走完一次完整的复盘:
- 选一个已 EXPIRED 或 CLOSED 的持仓
- 走完 F2 时间轴 + 四问 + 看到训练重点
- 关键: **训练重点真的让你"看见自己"了吗?**

如果是泛泛建议 → Diagnostician prompt 要重写。
如果让你"心头一震" → 产品成立了。

---

## 验收标准

- [ ] 至少完成 1 次完整复盘流程
- [ ] 时间轴正确展示所有关键节点(签字、焦虑日、触发、到期)
- [ ] 四问对话每题答案有效记录
- [ ] Diagnostician 输出的训练重点**包含具体数字或维度**
- [ ] 训练重点写入用户档案, 影响下次 M5 题目
- [ ] 复盘结束页视觉报刊感, 不像 BI 报告
- [ ] 时间轴自绘, 没引第三方 timeline 库

---

## 反模式特别警告

这个模块是产品哲学的最大试金石, 反模式特别多:

- ❌ 不要做成"年终总结"风格(列表 + 统计)
- ❌ 不要做成"游戏成就"风格(徽章 + 评分)
- ❌ 不要用 K 线图(违反"用户的接触瞬间是主角")
- ❌ 不要"恭喜你完成第 N 次复盘"
- ❌ 不要显示"胜率"、"年化收益率"等量化指标
- ❌ 不要训练重点用"继续努力"、"保持信心"等空话
- ❌ 不要分享按钮("把你的复盘分享给朋友"绝不允许)
- ❌ 不要"排行榜"或与其他用户对比
- ❌ 不要把训练重点做成弹窗显示
- ❌ 不要复盘对话用 chatbot 形态

正确形态:**像一份导演剪辑的关于自己的纪录片**——
- 时间轴像电影时间线
- 四问像采访问题
- 训练重点像导演的画外音
- 整体节奏严肃、私密、有重量

---

## 已知坑

1. **Diagnostician 最难写**, prompt 至少迭代 10 次, 用 5+ 个 fixture 复盘测试
2. **时间轴自绘**, 不能用 `react-native-timeline-flatlist` 等
3. **训练重点必须基于数据**, 不能 LLM 凭感觉
4. **training_focus 影响下次 M5**, 这是闭环, 必须打通
5. **复盘是一次性的**, 同一持仓只能复盘 1 次, 后续只能查看
6. **W26 自己用是产品级验收**, 不能跳过

---

## 复盘训练重点的 6 个维度(给 Diagnostician)

让 Diagnostician 在以下维度中挑一个作为这次的训练重点:

1. **感知速度** — 从弱信号到记录的延迟
2. **推演深度** — 一阶 / 二阶 / 三阶能力
3. **决策速度** — 从信号到签字的天数
4. **持仓耐心** — 焦虑日的占比 + 割肉冲动次数
5. **退出条件质量** — 价格类 vs 认知失效类的比例
6. **判据演化** — 这次新出现的判据 / 修正的判据

Diagnostician 看四问回答, 挑出**最明显的弱点**, 给一句具体诊断。

---

## "终点"验收 · Flashfi Engine v1.0 成立的条件

W26 复盘结束, 我做一件事:

> 打开 APP, 看完时间轴, 答完四问, 看到训练重点。
> 然后问自己: **"这个训练重点, 是不是只有 Flashfi 能告诉我?"**

如果答案是 "是" — Flashfi Engine v1.0 成立。
如果答案是 "其他工具也能" — 训练重点泛了, 重做 Diagnostician。

更深一层: **如果今天 Flashfi 突然消失, 我会感到失去了什么?**

如果答案是 "失去了我看见自己的能力" — **产品真正成立了**。

---

## 交叉引用

- 产品逻辑 → `产品文档/05_第五层_复盘训练.md`
- Diagnostician Agent → `技术文档/05_Mastra_Agents与Workflows_大纲.md`
- 时间轴视觉 → 原型 v4 F2 屏
- 整体产品哲学 → `产品文档/06_产品哲学.md`

---

## 完成后做什么

W26 复盘结束:
- 更新 `phase-3-mirror/00-overview.md` 里 M11 状态为 ✅
- 更新 `GOAL.md` § 5 当前进度到 W26 · **Flashfi Engine v1.0 完成**
- 写一份"Phase 3 自用复盘"
- 决定 Phase 4 的方向(或选择沉淀使用 6 个月再迭代)

---

## 给 AI Agent 的最后一段话

你现在在 M11, 是 Flashfi Engine 6 个月路线图的**终点**。

前面 10 个模块都在为它铺路。

如果你 M1-M10 都做对了, M11 让产品**升华**——从一个签字工具变成一面镜子。

如果你前面有任何一个模块偷工减料(尤其是 native_feel_skill 的克制项), M11 这里会反弹——
"看见自己" 需要前面所有模块都在用同一种语言, 任何一个模块用了主流 SaaS 风格, 镜子就裂了。

所以 M11 的 PR 提交前, **重新审视一遍 M1-M10 的反模式遗留**, 把所有"不该有的 toast / loading / 红点"都清掉。

这是 Flashfi Engine 这次开发的最后一步。**慎重。**

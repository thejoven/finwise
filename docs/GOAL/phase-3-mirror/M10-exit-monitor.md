# M10 · 退出条件巡检

> Phase 3 · W21-W22 · 2 周 · Cron + 触发器 + 站内提示

---

## 上下文

M10 让承诺书里写的"退出条件"真的能被检测到。

它是 Phase 3 中**最像传统软件工程**的模块——一个定时任务, 检查所有 ACTIVE 持仓的退出条件, 触发了就标记。

但产品哲学约束依然适用: **触发后不发 push, 等用户打开 APP 时才显示**。

---

## 前置依赖

- ✅ M8 签字流程完成(有 ACTIVE 持仓)
- M9 可以并行(不互相阻塞)

---

## 目标

### 退出条件巡检 Cron
每 4 小时跑一次:
- 扫描所有 ACTIVE 持仓
- 对每个持仓的每条退出条件做评估
- 触发的写 events 表 + 改持仓状态为 TRIGGERED

### 触发后的提示
- 不发 push
- 不发邮件
- 在 A1 收件箱顶部加一张特殊卡:"持仓状态变化, 请查看"
- 用户打开 APP 时自然看到

### 退出条件评估的实现

Phase 3 简化版, 三种类型:

#### Type 1 · 价格波动(mock 数据)
- "HBM 现货价连续 4 周回落 > 10%" → mock 数据生成器
- 跨度计算用 4 周窗口

#### Type 2 · 时间到期
- "持仓满 12 个月" → 纯算时间差

#### Type 3 · 基本面(LLM 评估)
- "公司毛利率下季度下滑" → LLM 用 web search 查最新财报
- Phase 3 简化: mock 出"财报已发布"的事件触发

---

## 任务列表(高层)

### Task 10.1 · 退出条件 schema

```typescript
const ExitConditionSchema = z.object({
  id: z.string(),
  text: z.string(),                            // 原文
  type: z.enum(['price', 'time', 'fundamental']),
  
  // type === 'price'
  price_window_days: z.number().optional(),
  price_threshold_pct: z.number().optional(),
  
  // type === 'time'
  duration_months: z.number().optional(),
  
  // type === 'fundamental'
  fundamental_metric: z.string().optional(),  // 自由文本, LLM 判断
});
```

写承诺书时, Narrator Agent 把自由文本退出条件解析成结构化(M7 的扩展)。

### Task 10.2 · Cron Worker

Go 实现, 用 `robfig/cron`:

```go
func main() {
    c := cron.New()
    c.AddFunc("0 */4 * * *", checkExitConditions)  // 每 4 小时
    c.Start()
    select {} // 阻塞
}

func checkExitConditions() {
    holdings := getActiveHoldings()
    for _, h := range holdings {
        for _, cond := range h.ExitConditions {
            triggered := evaluateCondition(h, cond)
            if triggered {
                markTriggered(h, cond)
            }
        }
    }
}
```

### Task 10.3 · 评估器

```go
func evaluateCondition(h Holding, cond ExitCondition) bool {
    switch cond.Type {
    case "price":
        return evaluatePriceCondition(h, cond)
    case "time":
        return evaluateTimeCondition(h, cond)
    case "fundamental":
        return evaluateFundamentalCondition(h, cond)
    }
    return false
}
```

每个 evaluate 函数独立测试, 注入 mock 数据。

### Task 10.4 · 触发后的事件流

```
退出条件触发
  ↓
写 events 表 (exit.condition.triggered)
  ↓
更新 holding.state = TRIGGERED
  ↓
NATS publish "holding.triggered"
  ↓
(Phase 3) 不发 push, 等用户打开 APP
  ↓
用户下次打开 → A1 收件箱顶部看到提示卡
```

### Task 10.5 · A1 收件箱的"触发卡"

A1 的 inbox 列表顶部, 如果有 TRIGGERED 持仓, 插入特殊样式卡:

```
┌────────────────────────────────────┐
│  ◆ 持仓状态变化                   │
│                                    │
│  SK 海力士                         │
│  退出条件 II 已触发:                │
│  公司毛利率下季度下滑               │
│                                    │
│  [查看持仓 →]                      │
└────────────────────────────────────┘
```

样式:
- 报刊感, 不是 Material 风格的 banner
- 不闪烁不动画
- 不显示数字徽章

### Task 10.6 · 用户进入 TRIGGERED 持仓

进入持仓页 → 触发条件高亮显示:

```
   退出条件
   I.  HBM 现货价连续 4 周回落  □ (未触发)
   II. 公司毛利率下季度下滑     ✓ 已触发(灰底高亮)
   III. 持仓满 12 个月          □

   状态: 1/3 触发
   
   [重新评估这次持仓 →]
```

"重新评估" 链接到 M11 的复盘对话(或简化版决策流程)。

---

## 验收标准

- [ ] Cron 每 4 小时跑, 日志记录扫描数量
- [ ] 至少 1 次触发(用 mock 数据手动构造)
- [ ] 触发后**不发 push**, 不弹 toast
- [ ] A1 收件箱正确显示触发卡
- [ ] 持仓页正确显示触发的条件
- [ ] 退出条件三种类型评估器都有测试
- [ ] 触发是幂等的(同一个条件重复触发不重复写 events)

---

## 反模式特别警告

- ❌ 不发 push 通知
- ❌ 不发邮件
- ❌ 不弹 in-app modal "您的持仓有变化!"
- ❌ A1 触发卡不闪烁不动画
- ❌ 不在 App Icon 上加 badge
- ❌ 触发后不锁定持仓, 用户仍可正常浏览
- ❌ 不显示"建议立即退出" 之类的引导

正确形态:**像一份送到家门口的信, 主人开门才看到, 但信里写的内容很重要**。

---

## 已知坑

1. **价格数据 Phase 3 用 mock**, 不接真实行情
2. **基本面评估用 LLM 简化版**, 检测"最近有财报"事件即可
3. **触发幂等**, 用 events 表的 unique constraint
4. **Cron 失败要报警**, 但不发给用户(发给运维, 即你自己)
5. **TRIGGERED 状态不锁定持仓**, 用户仍能打开
6. **A1 触发卡不抢眼**, 排在持仓中卡片之后

---

## 交叉引用

- 产品逻辑 → `产品文档/04_第四层_承诺执行.md` § "退出"
- Go 模块设计 → `技术文档/02_Go服务模块设计_大纲.md` exit_monitor 模块

---

## 完成后做什么

更新 `phase-3-mirror/00-overview.md` 里 M10 状态为 ✅。
等 M9 也完成, 进 M11 复盘训练。

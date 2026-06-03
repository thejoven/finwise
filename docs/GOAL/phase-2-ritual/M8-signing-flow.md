# M8 · 签字流程 + 持仓

> Phase 2 · W16-W17 · 2 周 · 客户端仪式 + 状态机

---

## 上下文

M8 是 Phase 2 的高潮——**签字那一刻**。

签字是 财富密码 的核心仪式, 视觉、触感、文案、节奏每一寸都要做对。

签字后, 一份"进行中的持仓"诞生, 它会进入 Phase 3 的陪伴和复盘。

---

## 前置依赖

- ✅ M7 承诺书生成完成

---

## 目标

### 签字流程
- 签字页(承诺书展示 + 签字按钮)
- 签字按下 → 触感(mediumImpact) → 防双击 → 后端 confirm
- 后端写 `commitment.signed` 事件 + 创建持仓
- 跳转到"持仓中"页, 不弹任何反馈

### 持仓页(简化版)
- 顶部: 资产名 + 签字日期 + 已持仓 N 天
- 退出条件复述(从承诺书来)
- 当前状态: 0/3 触发
- 进入完整承诺书 + 进入 E4(Phase 3 才有)

### 状态机
持仓的可能状态:
- ACTIVE — 进行中
- TRIGGERED — 退出条件已触发(Phase 3 实现)
- CLOSED — 已主动关闭
- EXPIRED — 持仓时长到期

---

## 任务列表(高层)

### Task 8.1 · 签字按钮(自绘, 不用 CupertinoButton)

```typescript
function SignButton({ onSign }: Props) {
  const lastTap = useRef(0);
  
  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // 按下即触感
  };
  
  const handlePress = async () => {
    const now = Date.now();
    if (now - lastTap.current < 2000) return;  // 防双击 2 秒
    lastTap.current = now;
    
    await onSign();
  };
  
  return (
    <Pressable
      onPressIn={handlePressIn}
      onPress={handlePress}
      style={({pressed}) => [
        styles.button,
        pressed && styles.pressed,
      ]}
    >
      <Sans size={13} weight="600" style={{ color: theme.color.paper, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        签字, 提交承诺
      </Sans>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.color.ink,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderRadius: 0,           // 直角, 报刊风
  },
  pressed: {
    backgroundColor: theme.color.ink2,
  },
});
```

**关键**: 触感在 `onPressIn` 触发, 不是 onPress。按下瞬间就是承诺成立。

### Task 8.2 · 签字后端逻辑

`POST /v1/commitments/:id/sign`:

1. 校验 commitment 状态 = drafted
2. 写 events 表 `commitment.signed`
3. 创建 holding 记录(物化视图)
4. 触发 NATS `commitment.signed` 事件(Phase 3 的退出条件巡检会订阅)
5. 返回 200, 不返回任何"成功"文案

**已知坑**:
- 防重复签字: 同一 commitment 只能签一次, 二次请求返回 200 但不做任何操作(幂等)
- commitment 签字后**不可编辑、不可删除**(事件溯源原则)

### Task 8.3 · "先放着, 明天再决定" 流程

承诺书 footer 的另一个按钮:
- 点击 → 模态 ActionSheet 确认 "好。我会在明天同一时间再问你一次。"
- 写 events 表 `commitment.postponed`, 计数 +1
- 如果连续 3 天 postpone → 归档为"信号识别正确但未行动"
- 文案克制, 不催促

### Task 8.4 · 持仓页

`app/commitment/[id].tsx`(签字后路由到这里, 与 M7 的草稿页是同一路由但不同状态):

```
┌──────────────────────────────────┐
│ ←      持仓中 · 第 89 天          │
├──────────────────────────────────┤
│   2026·01·22 签字                 │
│                                  │
│   SK 海力士                       │  ← Display
│   5% 仓位 · 6 个月承诺            │  ← Mono
│   剩 4 月 21 天                   │
├──────────────────────────────────┤
│   退出条件                        │
│                                  │
│   I.  HBM 现货价连续 4 周回落      │
│       0/4 周                     │
│   II. 公司毛利率下季度下滑          │
│       47 天                      │
│   III. 持仓满 12 个月             │
│        4 月 21 天                 │
├──────────────────────────────────┤
│   状态: 0/3 触发                  │
│                                  │
│  [完整承诺书] [E4 陪伴(Phase 3)] │
└──────────────────────────────────┘
```

### Task 8.5 · 持仓状态机

```
DRAFTED → (签字)        → ACTIVE
DRAFTED → (postpone x3) → ABANDONED
ACTIVE  → (触发退出条件) → TRIGGERED
TRIGGERED → (用户确认)   → CLOSED
ACTIVE  → (持仓时长到)   → EXPIRED → (M11 复盘) → ARCHIVED
```

每个状态转换写 events 表。

### Task 8.6 · 自己用一周(W18)

W18 那周自己用:
- 至少完成 1 次"信号 → 五轮追问 → 四道门 → 承诺书 → 签字"完整流程
- 真签或模拟签都可以, 但视觉、触感、节奏必须真实体验

签字那一刻问自己: "我有'契约感'吗?"

如果没有 → 回 M7/M8 修

---

## 验收标准

- [ ] 至少完成 1 次完整签字流程
- [ ] 签字按下触感是 mediumImpact, 不是 light 或 selection
- [ ] 防双击工作(快速点 2 次只触发 1 次)
- [ ] 签字后跳转流畅, 没有 toast / 没有 dialog
- [ ] 持仓页显示正确, 退出条件文案与承诺书一致
- [ ] "先放着" 流程能用, 文案克制
- [ ] commitment 状态机正确(签了就不能再签)

---

## 反模式特别警告

- ❌ 不要"签字成功!" toast
- ❌ 不要签字后弹"恭喜你完成了第 N 份承诺"
- ❌ 不要签字按钮用 Cupertino 圆角蓝色
- ❌ 不要在 postpone 时催促("机会要溜走了!")
- ❌ 不要持仓页显示当前股价(留到 Phase 3 的 E4, 也极度克制)

正确形态:**签字是一次安静的、严肃的动作, 完成后世界继续运转, 没有庆祝**。

---

## 已知坑

1. **触感在 onPressIn 触发**, 不是 onPress
2. **防双击用 useRef**, 不是 useState(避免 rerender)
3. **commitment 签字幂等**, 二次请求不报错
4. **持仓状态转换是事件**, 不是字段更新
5. **签字按钮直角矩形**, 不是 Cupertino 圆角
6. **postpone 计数 ≥ 3 自动归档**, 加 cron 检查
7. **W18 自己用是验收**, 不能跳过

---

## 交叉引用

- 产品逻辑 → `产品文档/04_第四层_承诺执行.md`
- 触感设计 → `技术文档/native_feel_skill/references/06-haptic-grammar.md`
- 反模式 → `技术文档/native_feel_skill/references/08-anti-patterns.md`

---

## 完成后做什么

W18 自己用完后:
- 更新 `phase-2-ritual/00-overview.md` 里 M8 状态为 ✅
- 更新 `GOAL.md` § 5 当前进度到 W18 → 准备进 Phase 3
- 写一份 "Phase 2 自用复盘"

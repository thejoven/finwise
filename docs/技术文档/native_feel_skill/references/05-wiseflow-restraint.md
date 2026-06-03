# 05 · 财富密码 专属克制项 · RN

> "原生感"做到位之后, 这一份把项目灵魂注入到 UI 行为里的最后一层。
> 这些规则**不是**主流 RN 应用的规则, 是 财富密码 这个产品的规则。

---

## 这份清单的依据

完全来自项目的 `06_产品哲学.md`:

- 哲学 1 · 频率必须匹配 alpha 的频率
- 哲学 2 · 沉默优于发声
- 哲学 3 · 减少决策, 不是增加信息
- 哲学 8 · 语言塑造行为
- 哲学 11 · 一次只说一件事

UI 是产品哲学的物质载体。

---

## § 1. 反馈的克制

### 1.1 录入成功不弹 Toast

**主流 RN 做法**:用 `react-native-toast-message` 或 `react-native-flash-message` 弹 "已保存"。

**财富密码 做法**:**直接关闭模态**, 收件箱 listener 自动反映新数据。

```typescript
// ❌ 错误
import Toast from 'react-native-toast-message';

async function handleSubmit() {
  await repo.capture(text);
  Toast.show({ type: 'success', text1: '已归档' });
  router.back();
}

// ✓ 正确
async function handleSubmit() {
  await repo.capture(text);
  router.back();
  // 完成. UI 状态变化本身就是反馈.
}
```

**为什么**:

- Toast 是对用户注意力的二次占用——你已经看到信号入库了, 再告诉你一次是冗余
- 频繁的成功反馈训练用户期待"产品对我的输入很热情"——这破坏"频率匹配 alpha"的世界观
- **不安装任何 Toast 库**, package.json 里检查无 toast 包

### 1.2 错误不弹 Alert, 用 inline

**主流做法**:网络错误 → Alert.alert。

**财富密码 做法**:

```typescript
// 录入页底部 inline
{error && (
  <Text style={styles.errorInline}>
    网络异常, 已保存到本地, 稍后会自动重试
  </Text>
)}
```

样式:

```typescript
errorInline: {
  marginTop: 8,
  fontFamily: 'SourceSerif4-Regular',
  fontSize: 12,
  fontStyle: 'italic',
  color: theme.color.muted,
}
```

**为什么**:Alert 中断用户行为, 强迫他响应——对一个快进快出的录入场景过度。

### 1.3 不显示 ActivityIndicator

**绝对不用**:

```typescript
// ❌
import { ActivityIndicator } from 'react-native';
<ActivityIndicator />
```

替代:

- 短操作(< 300ms): 什么都不显示
- 中等操作(承诺书生成): 打字机效果
- 长操作: 不让用户在前台等

打字机效果示例:

```typescript
function TypewriterText({ stream }: { stream: AsyncIterable<string> }) {
  const [text, setText] = useState('');
  
  useEffect(() => {
    (async () => {
      for await (const token of stream) {
        setText(prev => prev + token);
      }
    })();
  }, [stream]);
  
  return <Text style={styles.narration}>{text}</Text>;
}
```

### 1.4 不用红点角标

**财富密码 永远不用**:

- Tab 上不放未读数字
- 不调 `expo-notifications` 的 badge API
- App icon 没有数字角标

```typescript
// ❌ 永远不要
import * as Notifications from 'expo-notifications';
Notifications.setBadgeCountAsync(5);
```

理由直接来自产品哲学:

> 产品的频率必须匹配 alpha 的频率。一年只主动找你 1-2 次。
> Engagement 是危险信号。

### 1.5 触感反馈极度克制

完整规则见 `06-haptic-grammar.md`, 原则:

- 录入成功 → **不震动**
- 签字 → mediumImpact(一次)
- Tab 切换 → selectionAsync(轻)
- 错误 → **不震动**

```typescript
// ❌ 主流做法 — 每个动作都震
import * as Haptics from 'expo-haptics';

async function handleSubmit() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  await repo.capture(text);
}

// ✓ 录入这种轻动作什么都不震
async function handleSubmit() {
  await repo.capture(text);
}
```

---

## § 2. 入口的克制

### 2.1 不用 FAB

不安装 `react-native-paper` 或类似带 FAB 的库。
录入入口是底部 Tab 中间的 "记录", 不是浮动按钮。

```typescript
// app/(tabs)/_layout.tsx 已经定义 Tab, 不再加 FAB
```

### 2.2 不用 onboarding 流程

第一次进入直接看到空收件箱 + 接纳性文案:

```typescript
function EmptyInbox() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        这里会显示你的观察记录。{'\n'}
        它们不需要立即写下来。
      </Text>
    </View>
  );
}
```

不用 `react-native-onboarding-swiper` 之类的库。

### 2.3 不用引导提示气泡

不用 `react-native-tooltip` / `react-native-walkthrough-tooltip`。

如果用户需要被教怎么用, UI 没设计对。

---

## § 3. 动画:克制喧哗, 但追求丝滑

> 本节 2026-06 修订。旧规则一刀切禁掉了 spring 和复杂过渡, 结果"克制"变成了"僵硬"。
> 新原则:**克制的是装饰与庆祝, 不是运动本身。** 运动要做到丝滑 —— 丝滑正是"严肃、有重量"的手感来源(iOS 本身就这么丝滑)。
> 哲学没变, 沉默优于发声:**丝滑的运动不是"发声", 喧闹的装饰才是。**

### 3.1 运动要丝滑, 而且跟手

`react-native-reanimated`(已装)+ `react-native-gesture-handler` 是运动基座, 放开用:

- ✓ **spring 物理动画** —— sheet、抽屉、卡片入场都用 spring 自然收尾, 这是丝滑的来源
- ✓ **手势跟手 + 可打断** —— 内容跟着手指走, 中途松手顺势接管(interruptible), 而不是播一段写死时长的动画
- ✓ **共享元素 / 连续过渡** —— 当它表达"这东西从哪来、到哪去"的空间连续性时, 用
- ✓ **布局动画**(Reanimated 的 `entering` / `exiting` / `layout`)—— 列表增删、展开收起别"啪"地跳变
- ✓ Expo Router 页面切换、Modal `slide_from_bottom` 照旧

一句话判断标准:**这个运动是在帮用户理解"东西去哪了"(✓), 还是在表演给用户看(✗)?**

```typescript
// ✓ 跟手、可打断、spring 收尾的 sheet —— 这就是丝滑
const ty = useSharedValue(0);
const pan = Gesture.Pan()
  .onChange((e) => { ty.value += e.changeY; })
  .onEnd((e) => {
    // 顺着手指的速度用 spring 收尾, 而不是写死时长
    ty.value = withSpring(snapTo(ty.value, e.velocityY), { damping: 28, stiffness: 240 });
  });
```

### 3.2 仍然不要"装饰性 / 庆祝性"特效

放开的是"运动", 不是"特效"。下面这些依旧不做 —— 它们属于 § 1 的"喧哗":

- ✗ Lottie / Rive 装饰动画(`lottie-react-native` 仍在黑名单)
- ✗ 彩带、撒花、成功打勾的庆祝动画(`react-native-confetti`)
- ✗ 为了"显得活泼"、与用户操作无关的循环 / 入场动画

```typescript
// ❌ 仍然不装、不写
import LottieView from 'lottie-react-native';
```

区别在于:**spring 是物理, Lottie 是表演。** 我们要前者, 不要后者。

### 3.3 叙述时刻仍用打字机效果

承诺书生成、复盘对话的 LLM 流式输出, 字符一个个出现。每字符 30-60ms, 句末停顿 200ms。

(它现在是"运动"家族里的普通一员, 不再是"唯一允许的动画"。)

---

## § 4. 文案的克制

### 4.1 不说"已完成"、"成功"、"棒"

```typescript
// ❌
<Text>录入成功 ✨</Text>

// ✓ 不显示, 见 § 1.1
```

### 4.2 用产品词汇

| 主流词 | 财富密码 |
|---|---|
| 保存 | 归档 |
| 提交 | 签字 / 记下 |
| 删除 | 撤销 / 放弃 |
| 完成 | 归档 |
| 取消 | 再想想 / 先放着 |
| 确认 | 签字 / 是 |

### 4.3 错误信息不卖惨, 不加 emoji

```typescript
// ❌
<Text>哎呀, 出错了 😢</Text>

// ✓
<Text>网络异常, 稍后自动重试</Text>
```

### 4.4 加载等待时不说 "Loading..."

如果一定要文案:

```typescript
// E4 卡片生成时
<Text>正在和你的判据对照</Text>

// 承诺书叙述生成时
<Text>正在写给未来的你</Text>
```

每一条都是产品角色的延伸。

---

## § 5. 列表的克制

### 5.1 不显示"共 N 条"统计

```typescript
// ❌
<Text>共 47 条信号</Text>

// ✓
<Text>本周记录 · 5 条 · 全部已归档</Text>
```

### 5.2 不用 swipe-to-delete

不安装 `react-native-swipe-list-view` / `react-native-gesture-handler` 的滑动删除。

```typescript
// ❌
<SwipeListView
  renderHiddenItem={() => <DeleteButton />}
  rightOpenValue={-75}
/>
```

删除是认知层面的事, 必须走详情页 + 确认对话。

### 5.3 列表项不加 chevron right

```typescript
// ❌
<View style={styles.row}>
  <Text>...</Text>
  <ChevronRight />
</View>

// ✓ 不加 trailing icon
<View style={styles.row}>
  <Text>...</Text>
</View>
```

唯一例外:承诺书卡片底部的 "→"(设计的一部分)。

---

## § 6. 静默时刻的设计

### 6.1 空状态接纳, 不催促

```typescript
// ❌ 主流做法
<View style={styles.empty}>
  <SparkleIcon size={64} />
  <Text style={styles.title}>开始你的第一条信号!</Text>
  <Pressable onPress={openCapture}>
    <Text>立即录入</Text>
  </Pressable>
</View>

// ✓ 财富密码
<View style={styles.empty}>
  <Text style={styles.emptyText}>
    这里会显示你的观察记录。{'\n'}
    它们不需要立即写下来。
  </Text>
</View>
```

### 6.2 "今日 · 沉默" 是值得自豪的状态

A1 收件箱顶部:

```typescript
function SilenceStamp() {
  const hasNewToday = useNewSignalsToday();
  
  if (hasNewToday) {
    return <NewCount count={count} />;
  }
  
  return (
    <View style={styles.silenceStamp}>
      <View style={styles.checkMark}>
        <Text>✓</Text>
      </View>
      <Text style={styles.silenceLabel}>今日: 沉默</Text>
    </View>
  );
}
```

### 6.3 不发挽留通知

不在 `app.json` 里配置 push notification 权限请求:

```json
// ❌ 不要这个
{
  "plugins": [
    ["expo-notifications", { ... }]
  ]
}
```

`expo-notifications` 这个包**根本不安装**。

---

## § 7. 关键页面的额外约束

### 7.1 承诺书页面

```typescript
// app/commitment/[id]/sign.tsx
export const unstable_settings = {
  headerShown: false,  // 完全自绘
  gestureEnabled: true, // 保留左滑返回(用户随时能后悔)
};
```

视觉:
- 黑底白字直角按钮(不是 Cupertino 圆角)
- 双横线、罗马数字
- 字体跨平台统一报刊风(不用平台默认)

签字行为:
- 按下时 `Haptics.impactAsync(Medium)`
- 防双击 2 秒
- 签字后直接 navigate 到持仓页, 不弹 Toast

### 7.2 E4 焦虑陪伴

```typescript
// app/commitment/[id]/companion.tsx

// 显式不允许任何反馈库
// ❌ 没有 Toast、没有震动、没有 Alert
```

样式约束:
- 字号比普通页面大一档(让用户读慢)
- 不显示股价、不显示涨跌(细节里有真相)
- "我坚持要退出" 是 link 样式, 不是 button

```typescript
<Pressable onPress={openExitFlow}>
  <Text style={{
    color: theme.color.muted,
    fontFamily: 'SourceSerif4-Italic',
    fontSize: 12,
    textAlign: 'center',
  }}>
    我坚持要退出
  </Text>
</Pressable>
```

### 7.3 F2 时间轴

自绘纵向时间轴, 不用第三方:

```typescript
// ❌ 不安装
// react-native-timeline-flatlist
// react-native-timeline-listview

// ✓ 自绘
function Timeline({ events }: Props) {
  return (
    <View>
      {events.map((event, i) => (
        <TimelineNode key={event.id} event={event} isLast={i === events.length - 1} />
      ))}
    </View>
  );
}
```

---

## § 8. 自查问题

写完一个页面, 问自己:

1. 有 Toast / Alert / ActivityIndicator 吗?
2. 文案是 "保存" 还是 "归档"?
3. 错误是 inline 还是弹窗?
4. Tab 上有红点吗?
5. 录入完成有震动吗?(不该有)
6. 触感是仪式时刻才有, 还是动不动就震?
7. 列表项右侧有 chevron 吗?
8. 空状态接纳还是催促?
9. 安装了 `react-native-toast-message` / `react-native-paper` 这种带 FAB/Toast 的库吗?

每一条偏了, 都是产品哲学在 UI 层的漏点。

---

## § 9. package.json 黑名单

这些库一旦出现在 dependencies, 立刻删:

```
"react-native-toast-message"          # Toast
"react-native-flash-message"          # Toast
"react-native-paper"                  # 带 FAB
"react-native-elements"               # 视觉不一致
"react-native-onboarding-swiper"      # 引导
"react-native-tooltip"                # 提示气泡
"react-native-walkthrough-tooltip"    # 同上
"react-native-swipe-list-view"        # 滑动删除
"react-native-confetti"               # 庆祝动画
"lottie-react-native"                 # Lottie 动画
"react-native-timeline-flatlist"      # Timeline 库
```

在 CI 加 lint:

```bash
# tools/check-banned-deps.sh
banned=("react-native-toast-message" "react-native-paper" ...)
for pkg in "${banned[@]}"; do
  if grep -q "\"$pkg\"" package.json; then
    echo "❌ Banned: $pkg"
    exit 1
  fi
done
```

---

## 一句话总结

> **iOS 让它好看, 财富密码 让它有重量。**
>
> 主流 RN 应用用反馈、装饰动效、Toast 来"让产品看起来活跃"。
> 本产品反过来——**让用户感到自己在做严肃的事**。
>
> 这一点上, **不安装的库比安装的库更能塑造产品**。

---

## 交叉引用

- 触感反馈完整语法 → `06-haptic-grammar.md`
- 反模式禁止清单 → `08-anti-patterns.md`
- 项目产品哲学 → `06_产品哲学.md`

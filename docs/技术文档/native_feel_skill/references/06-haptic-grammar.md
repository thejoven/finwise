# 06 · 触感反馈语法 · RN

> 触感是 UI 的最后一寸,用错了让产品像玩具,用对了让产品像契约。

---

## § 1. expo-haptics API

```typescript
import * as Haptics from 'expo-haptics';

// 选择类
await Haptics.selectionAsync();

// 冲击类
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);   // iOS 13+
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);  // iOS 13+

// 通知类(本项目永不使用,见 § 3)
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
```

iOS 上 Taptic Engine 完整支持。Android 触感差异大, expo-haptics 会自动降级。

---

## § 2. Flashfi Engine 触感语法

| 场景 | API | 为什么 |
|---|---|---|
| 切换 Tab | `selectionAsync()` | 轻微提示, 不打扰 |
| List 项的勾选切换 | `selectionAsync()` | 选择性动作 |
| 录入按钮按下 | `impactAsync(Light)` | 轻仪式感 |
| **录入成功** | **不调** | 沉默优于发声 |
| 五轮追问 · 选项 | `selectionAsync()` | 选择性动作 |
| 承诺书 · 签字按下 | `impactAsync(Medium)` | 重大动作 |
| 承诺书 · 签字完成 | **不调** | 已经反馈过 |
| 退出条件触发 | `impactAsync(Medium)` | 重要事件 |
| E4 卡片 · 打开 | **不调** | 用户脆弱时刻 |
| 错误 · 网络失败 | **不调** | 不要让错误更焦虑 |
| 错误 · 删除确认弹起 | `impactAsync(Light)` | ActionSheet 弹起 |
| 复盘 · 进下一问 | `selectionAsync()` | 节奏感 |
| 复盘 · 看到训练重点 | `impactAsync(Medium)` | 看见自己, 一次触感 |

封装:

```typescript
// src/core/haptics/index.ts
import * as Haptics from 'expo-haptics';

export const haptic = {
  selection: () => Haptics.selectionAsync(),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  // 故意不暴露 heavy / Success / Warning / Error
} as const;
```

---

## § 3. 反模式

### 3.1 ❌ 不用 notificationAsync(Success)

主流 RN 应用每次操作成功都震一下。本项目反对。

```typescript
// ❌
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
```

### 3.2 ❌ 不在所有按钮上加触感

只有 § 2 表格列出的特定语义按钮才触感。

### 3.3 ❌ 不用 heavyImpact 制造惊吓

```typescript
// ❌
catch (e) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}
```

### 3.4 ❌ 不在动画过程中触感

触感是离散事件, 不和动画曲线绑定。

### 3.5 ❌ 不用 RN 自带 Vibration API

```typescript
// ❌
import { Vibration } from 'react-native';
Vibration.vibrate(500);
```

Vibration 在 iOS 上是真震动(粗暴), 不是 Taptic Engine。永远用 expo-haptics。

---

## § 4. 关键时刻

### 4.1 签字按钮

```typescript
function SignButton({ onSign }: Props) {
  const lastTap = useRef(0);
  
  const handlePressIn = () => {
    haptic.medium();  // 按下即触感
  };
  
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 2000) return;
    lastTap.current = now;
    onSign();
  };
  
  return (
    <Pressable onPressIn={handlePressIn} onPress={handlePress}>
      <Text>签字, 提交承诺</Text>
    </Pressable>
  );
}
```

**关键**:onPressIn 触发, 不是 onPress。按下瞬间就是承诺成立。

### 4.2 退出条件触发

```typescript
useEffect(() => {
  if (exitConditionTriggered) {
    haptic.medium();  // 一次
  }
}, [exitConditionTriggered]);
```

### 4.3 看见"训练重点"

```typescript
// 当打字机效果完成最后字符
useEffect(() => {
  if (typingComplete) {
    haptic.medium();
  }
}, [typingComplete]);
```

---

## § 5. 平台兜底

```typescript
// expo-haptics 在 Android 上自动降级
// 在 Web / macOS Web 上 no-op
// 不需要手动 Platform.OS 判断
```

但有触感设置的用户(iOS Settings → Sounds & Haptics 关闭)会静默失败, 这是预期行为, 不处理。

---

## § 6. 测试

模拟器没有触感。必须用 iPhone 真机测。

每个 Phase 上线前用真机走完 § 2 表格的所有场景。

---

## 一句话总结

> **触感是 UI 的标点符号。**
>
> 大多数 APP 每个字后面都加感叹号。
> Flashfi Engine 只在关键节奏点上, 一次, 正好。

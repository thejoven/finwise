# 01 · RN 平台心智 · 默认 vs 自绘的取舍

> RN 不像 Flutter "全部自己画", 它是"调系统原生组件 + 你给它穿衣服"。
> 这份文档定义本项目什么用系统默认、什么自绘、什么混合。

---

## 总原则

```
平台行为 → 用 RN/Expo 默认实现 (iOS 上 bounce 滚动、modal 滑入等)
视觉外观 → 自绘 (按钮、卡片、列表项, 用项目自己的设计语言)
反馈反应 → 严格按 财富密码 哲学定义
```

简单记:

- **iOS 教什么**, 你听 iOS 的(行为)
- **财富密码 教什么**, 你听 财富密码 的(视觉、反馈)

---

## § 1. 必须用平台默认的(不自绘)

这些自绘成本极高、收益极低, 用系统默认就好:

### 1.1 滚动行为
- iOS 上的 bounce(橡皮筋)— ScrollView/FlatList 默认就是
- Android 上的 Glow — 默认就是
- 不要试图统一这俩

### 1.2 键盘行为
- 键盘弹起、收起的动画
- 自动 inset(用 `KeyboardAvoidingView` 或 `react-native-keyboard-controller`)
- iOS 上的 Done/Return 按键

### 1.3 文本选择
- 长按选中、放大镜、复制粘贴菜单
- 这些是 OS 级行为, RN 默认就接住

### 1.4 模态展示动画
- iOS 上从下滑入的 sheet
- 顶部圆角 + grabber
- 用 Expo Router 的 `presentation: 'modal'` 自动获得

### 1.5 返回手势
- iOS 上的左滑返回
- Android 上的物理 back 键 / 手势
- React Navigation 默认处理

### 1.6 Status Bar 内容
- 时间、信号、电量(系统画)
- 你只控制 `<StatusBar style="dark" />` 或 "light"

### 1.7 Safe Area
- Notch / Dynamic Island / Home Indicator 区域
- 用 `SafeAreaView` 或 `useSafeAreaInsets` 自动处理

---

## § 2. 必须自绘的(不用默认)

RN 默认提供的组件**对本项目都不够好看**:

### 2.1 ❌ 不用 RN 自带的 `<Button>`

```typescript
// ❌ 永远不要
import { Button } from 'react-native';
<Button title="签字" onPress={...} />
```

RN 的 `<Button>` 在 iOS 上是蓝色文字、Android 上是深色 Material 按钮。完全不能控制视觉。

```typescript
// ✓ 自绘
<Pressable onPress={...} style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}>
  <Text style={styles.buttonText}>签字</Text>
</Pressable>
```

### 2.2 ❌ 不用默认 TouchableOpacity 的 opacity 动画

```typescript
// ❌ 默认 opacity 0.2 太轻, 不像 iOS
<TouchableOpacity onPress={...}>
```

iOS 系统按钮按下是**颜色变化**, 不是透明度变化。

```typescript
// ✓ 自定义 TapEffect
<Pressable
  onPress={...}
  style={({pressed}) => ({
    backgroundColor: pressed ? theme.paperPressed : theme.paper,
  })}
>
```

或封装成 component:

```typescript
// src/shared/components/TapEffect.tsx
export function TapEffect({ children, onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && { backgroundColor: theme.color.paperPressed },
      ]}
    >
      {children}
    </Pressable>
  );
}
```

### 2.3 ❌ 不用 Alert.alert

```typescript
// ❌ Alert 视觉无法控制, 跨平台样式不一致
Alert.alert('确认', '放弃这张草稿?', [...]);
```

```typescript
// ✓ 自绘 ActionSheet
<ActionSheet
  visible={showConfirm}
  title="确认放弃这张草稿?"
  actions={[
    { label: '放弃', destructive: true, onPress: handleDiscard },
  ]}
  cancelLabel="再想想"
  onCancel={() => setShowConfirm(false)}
/>
```

### 2.4 ❌ 不用 ActivityIndicator

完全不显示 loading, 或用打字机效果。见 `05-wiseflow-restraint.md`。

### 2.5 ❌ 不用第三方 Toast 库

任何 Toast 库都和产品哲学冲突。

### 2.6 自绘列表项

iOS 默认的 `<FlatList>` 渲染只是个 ScrollView, 列表项的样式完全由你定义。

不要用 `react-native-elements` 或 `react-native-paper` 的 ListItem, 自绘:

```typescript
function SignalListItem({ signal }: Props) {
  return (
    <TapEffect onPress={() => router.push(`/signal/${signal.id}`)}>
      <View style={styles.row}>
        <Text style={styles.date}>{format(signal.capturedAt, 'MM·dd')}</Text>
        <View style={styles.content}>
          <Text style={styles.text}>{signal.rawText}</Text>
          <Text style={styles.meta}>AI 已推演</Text>
        </View>
      </View>
    </TapEffect>
  );
}
```

---

## § 3. 混合方案(用部分默认 + 部分自绘)

### 3.1 FlatList

- ✓ 用默认 FlatList(虚拟化、性能好)
- ✓ 用默认 RefreshControl(下拉刷新)
- ❌ 不用默认 `<ItemSeparatorComponent>` 的 Divider 样式, 自绘
- ❌ 不用默认 `<ListEmptyComponent>` 的样式, 自绘

### 3.2 Modal

- ✓ 用 Expo Router 的 `presentation: 'modal'`(获得平台动画)
- ❌ Modal 内部样式完全自绘

### 3.3 TextInput

- ✓ 用 RN 默认 `<TextInput>`(获得系统键盘、文本选择)
- ❌ 自定义样式: 字体、placeholder 颜色、cursor 颜色

```typescript
<TextInput
  style={{
    fontFamily: 'SourceSerif4-Regular',
    fontSize: 17,
    color: theme.ink,
  }}
  placeholderTextColor={theme.muted}
  cursorColor={theme.ink}            // iOS 17+ / Android
  selectionColor={theme.highlight}
  placeholder="今天看到什么..."
  multiline
/>
```

---

## § 4. 平台差异化策略

### 4.1 必须分流的领域

```typescript
import { Platform } from 'react-native';
const isIOS = Platform.OS === 'ios';
const isAndroid = Platform.OS === 'android';
```

#### 4.1.1 Modal 顶部 grabber
- iOS: 显示一道灰色短横(系统默认会画)
- Android: 不需要

#### 4.1.2 Header 标题对齐
- iOS: 居中
- Android: 居左

但本项目的 Masthead 是自绘的, 跨平台都居中(报刊风, 设计决策)。

#### 4.1.3 触感
- iOS: expo-haptics 完整支持
- Android: 退化到 lightImpact / mediumImpact

详见 `06-haptic-grammar.md`。

#### 4.1.4 字体 fallback
- iOS: PingFang SC
- Android: Noto Sans CJK SC (Serif fallback 不可靠)

详见 `07-typography.md`。

### 4.2 必须跨平台一致的领域

#### 4.2.1 设计语言
- 字体: Playfair Display / Source Serif 4 在两边都 bundle
- 色板: paper/ink/red/green 严格一致
- 排版: 双横线、罗马数字、italic 大字 — 跨平台一致

#### 4.2.2 业务行为
- 录入成功不弹 Toast (两边都不弹)
- 没有 FAB (两边都没)
- 退出条件触发逻辑相同

---

## § 5. 文件组织 · 何时用 .ios.tsx / .android.tsx

Metro bundler 支持平台后缀:

```
Button.tsx           # 跨平台共用
Button.ios.tsx       # iOS 专属覆盖
Button.android.tsx   # Android 专属覆盖
```

Metro 优先选有平台后缀的文件。

**何时用平台后缀文件**:
- 同一个组件在两边布局结构差异极大(罕见)
- 用了平台专属 native module

**何时用 if Platform.OS**(更常见):
- 局部细节差异(spacing、color、字号)
- 平台分流的小段逻辑

**默认用 if 判断, 不用平台后缀文件**——跨文件维护成本更高。

---

## § 6. 常见陷阱

### 陷阱 1 · 在 Web 上(Expo Web)`Platform.OS === 'web'`

如果将来支持 Web(不在路线图), 要先判断 `Platform.OS === 'web'`。

Phase 1 不上 Web, 但代码可以写得健壮:

```typescript
const isIOS = Platform.OS === 'ios';
const isAndroid = Platform.OS === 'android';
const isNative = isIOS || isAndroid;
```

### 陷阱 2 · 在 iOS 上写 Android 默认会拿到

```typescript
// ❌ 错误
const elevation = Platform.OS === 'ios' ? 0 : 4;
// 没显式给 iOS 设 shadow, 万一忘了, iOS 没阴影 Android 有
```

```typescript
// ✓ 正确
const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 4 },
});
```

但 财富密码 几乎不用阴影, 这个陷阱出现频率低。

### 陷阱 3 · iOS 的 borderColor 不渲染半像素

iOS 上 `borderWidth: 1` 实际是 1pt(2-3px 物理), 偏粗。
要真正的 1px hairline:

```typescript
import { StyleSheet } from 'react-native';
const styles = StyleSheet.create({
  hairline: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.ruleSoft,
  },
});
```

### 陷阱 4 · iOS 的 fontWeight 数字不准

```typescript
// ❌ Android 完全 OK, iOS 可能不识别 '600'
fontWeight: '600'

// ✓ 用字体文件本身的 weight
fontFamily: 'PlayfairDisplay-SemiBold'  // 字体 weight 包含在文件名里
```

bundle 多个 weight 的字体文件, 用 fontFamily 切换, 不依赖 fontWeight 属性。

---

## § 7. 怎么自查"我做对了平台心智吗"

写完一个页面, 问自己:

1. 我用了 RN 默认的 `<Button>` / `<TouchableOpacity>` 吗?(应该没有)
2. 我用了 Alert.alert 吗?(应该没有)
3. iOS 模拟器上, 从右边缘左滑能不能返回?(应该可以)
4. iOS 模拟器上, 滚动到顶部继续下拉, 有没有 bounce?(应该有)
5. 我有没有用 Platform.OS 做平台差异?(局部细节可以, 整体结构不该)
6. 字体在 iOS 和 Android 上都正确加载吗?(都该正确)

任一答错, 回到这份文档对应章节。

---

## 交叉引用

- iOS 详细清单 → `02-ios-checklist.md`
- Android 详细清单 → `03-android-checklist.md`
- 跨平台设计语言 → `04-cross-platform-design.md`
- 反模式禁止 → `08-anti-patterns.md`

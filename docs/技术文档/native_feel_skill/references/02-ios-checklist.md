# 02 · iOS 详细 30 项清单 · RN

> Phase 1 主战场。每一项给出"做什么"、"代码模式"、"为什么"。
> 标 🟢 = Phase 1 必做, 🟡 = Phase 2 起, ⚪ = 细节优化。

---

## 一、布局与容器 (5 项)

### 1.1 🟢 所有页面用 SafeAreaView 包

```typescript
import { SafeAreaView } from 'react-native-safe-area-context';

export default function InboxScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }} edges={['top']}>
      {/* content */}
    </SafeAreaView>
  );
}
```

**为什么**:Dynamic Island / Notch / Home Indicator 区域必须避让。
用 `react-native-safe-area-context` 不用 RN 自带的(RN 默认那个不支持 edges 精细控制)。

### 1.2 🟢 StatusBar 用 expo-status-bar

```typescript
import { StatusBar } from 'expo-status-bar';

<StatusBar style="dark" />          // 浅背景
<StatusBar style="light" />         // 深背景
<StatusBar style="auto" />          // 跟随 useColorScheme
```

不用 RN 的 StatusBar(过时, expo-status-bar 是替代)。

### 1.3 🟢 屏幕背景色用 backgroundColor + SafeAreaView

```typescript
// ❌ 容易出问题: 顶部 safe area 露白
<View style={{ flex: 1, backgroundColor: theme.paper }}>
  <SafeAreaView>...</SafeAreaView>
</View>

// ✓ 正确: SafeAreaView 直接持背景
<SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }}>
  ...
</SafeAreaView>
```

### 1.4 🟢 KeyboardAvoidingView 包输入页

```typescript
<KeyboardAvoidingView
  behavior="padding"
  style={{ flex: 1 }}
  keyboardVerticalOffset={Platform.select({ ios: 0, android: 20 })}
>
  <ScrollView>{/* form */}</ScrollView>
</KeyboardAvoidingView>
```

Phase 2 可以升级到 `react-native-keyboard-controller` 获得更平滑体验。

### 1.5 ⚪ ScrollView 用 contentInsetAdjustmentBehavior

iOS 上的滚动视图配合 NavigationBar 自动 inset:

```typescript
<ScrollView contentInsetAdjustmentBehavior="automatic">
  ...
</ScrollView>
```

---

## 二、导航 (4 项)

### 2.1 🟢 用 Expo Router 默认 Stack

```typescript
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,  // 我们用自绘 Masthead
        animation: 'default', // iOS: 从右滑入, Android: fade
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="signal/[id]" />
    </Stack>
  );
}
```

### 2.2 🟢 Modal 用 presentation: 'modal'

```typescript
// app/_layout.tsx
<Stack.Screen
  name="capture"
  options={{
    presentation: 'modal',         // 从下滑入
    animation: 'slide_from_bottom',
  }}
/>
```

iOS 会自动给 modal 加顶部圆角 + grabber + 半透明背景遮罩。

### 2.3 🟢 左滑返回手势开启

Expo Router / React Navigation 默认开启。**不要关闭**:

```typescript
// ❌ 几乎所有情况下都不要这样
<Stack.Screen options={{ gestureEnabled: false }} />
```

例外:用户在录入页有未保存草稿时, 拦截 + 弹自绘 ActionSheet 确认。

### 2.4 🟢 Tab Bar 用自绘, 不用 Material Tab Bar

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.paper,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.ink,
          height: 64,
        },
        tabBarLabelStyle: {
          fontFamily: 'SourceSerif4-Regular',
          fontSize: 9,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        },
        tabBarActiveTintColor: theme.ink,
        tabBarInactiveTintColor: theme.muted,
      }}
    >
      <Tabs.Screen name="inbox" options={{ title: '收件箱' }} />
      <Tabs.Screen name="capture" options={{ title: '记录' }} />
      <Tabs.Screen name="archive" options={{ title: '档案' }} />
    </Tabs>
  );
}
```

---

## 三、按钮与交互 (5 项)

### 3.1 🟢 永远用 Pressable, 不用 TouchableOpacity / Button

```typescript
// ❌
import { Button, TouchableOpacity } from 'react-native';

// ✓
import { Pressable } from 'react-native';
```

Pressable 是 RN 推荐的现代 API, 提供 pressed state 而不是 opacity 动画。

### 3.2 🟢 用自定义 TapEffect 替代默认按下效果

```typescript
// src/shared/components/TapEffect.tsx
export function TapEffect({
  onPress,
  children,
  style,
  pressedColor,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && {
          backgroundColor: pressedColor ?? theme.color.paperPressed,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}
```

**为什么**:默认 TouchableOpacity 的 opacity 0.2 在 iOS 上看起来"web 风", 不像系统按钮。
用颜色变化更接近 iOS 系统按钮的视觉。

### 3.3 🟢 签字按钮单独自绘, 不复用 TapEffect

承诺书签字按钮是产品的仪式核心:

```typescript
// src/features/commitment/components/SignButton.tsx
export function SignButton({ onSign }: Props) {
  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // 按下即触感
  };

  return (
    <Pressable
      onPress={onSign}
      onPressIn={handlePressIn}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.text}>签字, 提交承诺</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.ink,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    // 直角, 不是圆角. 报刊风
    borderRadius: 0,
  },
  pressed: {
    backgroundColor: theme.ink2,
  },
  text: {
    color: theme.paper,
    fontFamily: 'SourceSerif4-SemiBold',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
```

### 3.4 🟢 按钮按下时机用 onPressIn 触发触感

```typescript
// ❌ 错误: onPress 触发, 视觉和触感不同步
onPress={() => {
  Haptics.impactAsync(...);
  doAction();
}}

// ✓ 正确: 按下瞬间触感, 抬起瞬间动作
onPressIn={() => Haptics.impactAsync(...)}
onPress={doAction}
```

详见 `06-haptic-grammar.md`。

### 3.5 🟢 防止双击同一按钮

```typescript
import { useRef } from 'react';

function SignButton({ onSign }) {
  const lastTap = useRef(0);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 2000) return;  // 2秒内防重
    lastTap.current = now;
    onSign();
  };
  // ...
}
```

承诺书签字、退出条件触发这类不可逆动作必须防双击。

---

## 四、列表与滚动 (4 项)

### 4.1 🟢 长列表用 FlatList, 不用 ScrollView + map

```typescript
// ❌ 短列表可以, 长列表性能差
<ScrollView>
  {signals.map(s => <SignalItem key={s.id} signal={s} />)}
</ScrollView>

// ✓
<FlatList
  data={signals}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <SignalItem signal={item} />}
  ItemSeparatorComponent={() => <Separator />}
/>
```

### 4.2 🟢 Pull-to-refresh 用 RefreshControl

```typescript
import { RefreshControl } from 'react-native';

<FlatList
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={theme.ink}        // iOS 上 spinner 颜色
      colors={[theme.ink]}          // Android 上 spinner 颜色
    />
  }
/>
```

iOS 上是橡皮筋拉出 spinner, 系统默认行为, 不用自绘。

### 4.3 🟢 ItemSeparatorComponent 用 hairlineWidth

```typescript
<FlatList
  ItemSeparatorComponent={() => (
    <View style={{
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.ruleSoft,
      marginLeft: 16,  // 缩进, 像 iOS 系统列表
    }} />
  )}
/>
```

### 4.4 ⚪ FlatList 优化项

长列表加这些 props 提升性能:

```typescript
<FlatList
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={10}
  initialNumToRender={10}
  getItemLayout={(data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
/>
```

Phase 1 不优化, Phase 2 信号累积到 100+ 条时再加。

---

## 五、模态展示 (3 项)

### 5.1 🟢 录入页用 Expo Router modal

```typescript
// app/(tabs)/capture.tsx
import { router } from 'expo-router';

// 在 app/_layout.tsx 配置:
<Stack.Screen
  name="(tabs)/capture"
  options={{
    presentation: 'modal',
    animation: 'slide_from_bottom',
  }}
/>
```

### 5.2 🟢 确认对话用自绘 ActionSheet

不用 Alert.alert 也不用第三方:

```typescript
// src/shared/components/ActionSheet.tsx
export function ActionSheet({ visible, title, actions, onCancel, cancelLabel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        {title && <Text style={styles.title}>{title}</Text>}
        {actions.map((action, i) => (
          <Pressable
            key={i}
            onPress={() => {
              action.onPress();
              onCancel();
            }}
            style={({pressed}) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={[
              styles.actionText,
              action.destructive && styles.destructive,
            ]}>{action.label}</Text>
          </Pressable>
        ))}
        <View style={styles.divider} />
        <Pressable onPress={onCancel} style={styles.cancelAction}>
          <Text style={styles.cancelText}>{cancelLabel ?? '取消'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
```

### 5.3 🟢 Modal 顶部有 grabber

iOS 风格的模态顶部有一道灰色短横:

```typescript
<View style={{
  width: 36,
  height: 5,
  backgroundColor: theme.muted,
  borderRadius: 2.5,
  alignSelf: 'center',
  marginTop: 8,
  marginBottom: 16,
}} />
```

Expo Router 的 modal 在 iOS 上会自动加 system grabber, 但确认弹起的 ActionSheet 要自己画。

---

## 六、字体与排版 (5 项)

### 6.1 🟢 字体在 _layout.tsx 加载

```typescript
// app/_layout.tsx
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    'PlayfairDisplay-Bold': require('../assets/fonts/PlayfairDisplay-Bold.ttf'),
    'PlayfairDisplay-Italic': require('../assets/fonts/PlayfairDisplay-Italic.ttf'),
    'SourceSerif4-Regular': require('../assets/fonts/SourceSerif4-Regular.ttf'),
    'SourceSerif4-Italic': require('../assets/fonts/SourceSerif4-Italic.ttf'),
    'NotoSerifSC-Regular': require('../assets/fonts/NotoSerifSC-Regular.otf'),
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;
  return <Stack>...</Stack>;
}
```

### 6.2 🟢 字号严格遵循 iOS HIG 阶梯

```typescript
// src/core/theme/typography.ts
export const fontSize = {
  caption2: 11,
  caption1: 12,
  footnote: 13,
  subhead: 15,
  callout: 16,
  body: 17,         // 默认
  headline: 17,     // 粗
  title3: 20,
  title2: 22,
  title1: 28,
  largeTitle: 34,
} as const;
```

### 6.3 🟢 文本组件统一封装

```typescript
// src/shared/components/Text.tsx
// 不直接用 RN 的 Text, 用自己的封装
export function Body({ children, style, ...props }: Props) {
  return (
    <RNText style={[styles.body, style]} {...props}>
      {children}
    </RNText>
  );
}

export function Display({ children, size = 28, italic = false, style, ...props }: DisplayProps) {
  return (
    <RNText
      style={[
        {
          fontFamily: italic ? 'PlayfairDisplay-Italic' : 'PlayfairDisplay-Bold',
          fontSize: size,
          lineHeight: size * 1.15,
          letterSpacing: -size * 0.02,
          color: theme.ink,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}
```

详见 `07-typography.md`。

### 6.4 🟢 数字用等宽

```typescript
// 时间戳、金额
<Text style={{
  fontFamily: 'JetBrainsMono-Regular',
  fontVariant: ['tabular-nums'],
}}>
  +47%
</Text>
```

### 6.5 ⚪ 关闭系统字号缩放

iOS 用户设置了大字号可能破坏 UI:

```typescript
<Text allowFontScaling={false}>...</Text>
// 或全局:
Text.defaultProps = { ...Text.defaultProps, allowFontScaling: false };
```

但 Flashfi Engine 应该尊重大字号(accessibility)。
方案: 标题不缩放, 正文允许缩放 1.2 倍内:

```typescript
<Display allowFontScaling={false}>Flashfi</Display>
<Body maxFontSizeMultiplier={1.2}>正文...</Body>
```

---

## 七、视觉细节 (4 项)

### 7.1 🟢 颜色全部走 theme token

```typescript
// ❌ 错误
<View style={{ backgroundColor: '#fafaf7' }} />

// ✓ 正确
<View style={{ backgroundColor: theme.color.paper2 }} />
```

theme 定义集中在 `src/core/theme/colors.ts`。

### 7.2 🟢 间距用阶梯

```typescript
// src/core/theme/spacing.ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;
```

不要写 `padding: 13` 这种奇怪数字。

### 7.3 🟢 圆角统一

```typescript
export const radius = {
  none: 0,
  sm: 6,         // 小按钮
  md: 10,        // 标准按钮、输入框
  lg: 14,        // 大卡片
  full: 9999,
} as const;
```

承诺书签字按钮用 radius.none(直角, 报刊风)。

### 7.4 🟢 hairline 分割线

iOS 系统级 hairline:

```typescript
<View style={{
  height: StyleSheet.hairlineWidth,
  backgroundColor: theme.color.ruleSoft,
}} />
```

不要用 `borderWidth: 1`, 那是 1pt 偏粗。

---

## 八、Flashfi Engine 专属(2 项)

### 8.1 🟢 报刊感顶栏自绘, 不用 React Navigation Header

A1 收件箱的 Masthead 是设计的核心:

```typescript
// src/shared/components/Masthead.tsx
export function Masthead() {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TapEffect onPress={openMenu}>
          <Text style={styles.hamburger}>≡</Text>
        </TapEffect>
        <Text style={styles.topStrip}>
          <Text style={styles.vol}>VOL. I · NO. 47</Text> · 5月15日 · 周五
        </Text>
        <TapEffect onPress={openSearch}>
          <Text style={styles.search}>⌕</Text>
        </TapEffect>
      </View>
      <Display size={38} italic style={styles.nameplate}>
        Flashfi
      </Display>
      <Text style={styles.subline}>
        Conviction Quarterly
      </Text>
      <Text style={styles.tagline}>
        A Quiet Journal of High-Confidence Calls
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 4,
    borderBottomColor: theme.color.ink,
    borderStyle: 'solid',  // 真正的双线见下
  },
  // 报刊感双横线靠两层 View 模拟:
  // <View style={{ borderBottomWidth: 1, borderBottomColor: ink, height: 4, borderTopWidth: 1, borderTopColor: ink }} />
  // ...
});
```

### 8.2 🟢 承诺书签字页不用 Stack header

```typescript
// app/commitment/[id]/sign.tsx
export const unstable_settings = {
  headerShown: false,  // 完全自绘, 包括返回手势
};
```

签字页是仪式空间, 系统 chrome 都剥掉。

---

## 自查清单(快速核对)

新写一个 iOS 页面提交前, 过一遍:

- [ ] 用了 SafeAreaView 包裹
- [ ] 用了自定义 TapEffect, 不是 TouchableOpacity / Button
- [ ] 列表用 FlatList + RefreshControl
- [ ] 没有 Alert.alert
- [ ] 字号在 iOS HIG 阶梯里
- [ ] 间距在 spacing token 里
- [ ] 颜色用 theme.color, 没硬编码
- [ ] 圆角用 radius token
- [ ] 分割线用 StyleSheet.hairlineWidth
- [ ] 字体加载完成才渲染
- [ ] 左滑返回手势工作
- [ ] 暗黑模式颜色正确
- [ ] 触感反馈符合 06-haptic-grammar.md
- [ ] 反模式禁止项无违反(见 08-anti-patterns.md)

完整 60 项审计见 `/checklists/pre-release-audit.md`。

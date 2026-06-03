# 07 · 字体与中文混排 · RN

> 财富密码 视觉灵魂是"报刊感"。字体选择是这个感觉成败的核心。

---

## § 1. 字体角色

呼应原型 v4 的设计语言:

| 角色 | 字体 | 用途 |
|---|---|---|
| **Display** | Playfair Display + Noto Serif SC | 大标题、Masthead、承诺书标题 |
| **Serif Body** | Source Serif 4 + Noto Serif SC | 正文、对话、引文 |
| **Sans** | (系统字体) | UI 控件、按钮、Tab 标签 |
| **Mono** | JetBrains Mono | 数字、ID、时间戳 |

Sans **不 bundle**, 用系统字体。理由见 § 5。

---

## § 2. 平台 fallback 表

### iOS

| 角色 | 主字体 | 中文 fallback |
|---|---|---|
| Display | Playfair Display | PingFang SC(系统) |
| Serif Body | Source Serif 4 | PingFang SC |
| Sans | System | PingFang SC |
| Mono | JetBrains Mono | (无需) |

### Android

| 角色 | 主字体 | 中文 fallback |
|---|---|---|
| Display | Playfair Display | Noto Sans CJK SC |
| Serif Body | Source Serif 4 | Noto Sans CJK SC |
| Sans | System | Noto Sans CJK SC |
| Mono | JetBrains Mono | (无需) |

**关键差异**:Android 上中文 fallback 用 **Sans Serif**, 不用 Serif。

接受这个产品决策:Android 端中文不强求 Serif 报刊感。

---

## § 3. 字体加载 · expo-font

### 3.1 准备字体文件

```
assets/fonts/
  PlayfairDisplay-Regular.ttf
  PlayfairDisplay-Italic.ttf
  PlayfairDisplay-Bold.ttf
  PlayfairDisplay-BoldItalic.ttf
  SourceSerif4-Regular.ttf
  SourceSerif4-Italic.ttf
  SourceSerif4-SemiBold.ttf
  NotoSerifSC-Regular.otf
  NotoSerifSC-Bold.otf
  JetBrainsMono-Regular.ttf
  JetBrainsMono-Medium.ttf
```

下载来源:
- Playfair Display: Google Fonts
- Source Serif 4: Adobe Fonts (open source)
- Noto Serif SC: Google Fonts
- JetBrains Mono: jetbrains.com/lp/mono

### 3.2 在 _layout.tsx 加载

```typescript
// app/_layout.tsx
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    'PlayfairDisplay-Regular': require('../assets/fonts/PlayfairDisplay-Regular.ttf'),
    'PlayfairDisplay-Italic': require('../assets/fonts/PlayfairDisplay-Italic.ttf'),
    'PlayfairDisplay-Bold': require('../assets/fonts/PlayfairDisplay-Bold.ttf'),
    'PlayfairDisplay-BoldItalic': require('../assets/fonts/PlayfairDisplay-BoldItalic.ttf'),
    'SourceSerif4-Regular': require('../assets/fonts/SourceSerif4-Regular.ttf'),
    'SourceSerif4-Italic': require('../assets/fonts/SourceSerif4-Italic.ttf'),
    'SourceSerif4-SemiBold': require('../assets/fonts/SourceSerif4-SemiBold.ttf'),
    'NotoSerifSC-Regular': require('../assets/fonts/NotoSerifSC-Regular.otf'),
    'NotoSerifSC-Bold': require('../assets/fonts/NotoSerifSC-Bold.otf'),
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrainsMono-Medium': require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;
  return <Stack>...</Stack>;
}
```

---

## § 4. Text 组件封装

```typescript
// src/shared/components/Text.tsx
import { Text as RNText, TextProps, Platform } from 'react-native';
import { theme } from '@/core/theme';

// === Display ===
interface DisplayProps extends TextProps {
  size?: number;
  italic?: boolean;
  weight?: 'regular' | 'bold';
}
export function Display({ children, style, size = 28, italic = false, weight = 'bold', ...props }: DisplayProps) {
  const family = italic
    ? (weight === 'bold' ? 'PlayfairDisplay-BoldItalic' : 'PlayfairDisplay-Italic')
    : (weight === 'bold' ? 'PlayfairDisplay-Bold' : 'PlayfairDisplay-Regular');
  
  return (
    <RNText
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: size * 1.15,
          letterSpacing: -size * 0.02,
          color: theme.color.ink,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// === Serif ===
interface SerifProps extends TextProps {
  size?: number;
  italic?: boolean;
  weight?: 'regular' | 'semibold';
}
export function Serif({ children, style, size = 14, italic = false, weight = 'regular', ...props }: SerifProps) {
  const family = italic ? 'SourceSerif4-Italic'
    : weight === 'semibold' ? 'SourceSerif4-SemiBold'
    : 'SourceSerif4-Regular';
  
  return (
    <RNText
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: size * 1.5,
          color: theme.color.ink2,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// === Sans (系统字体) ===
interface SansProps extends TextProps {
  size?: number;
  weight?: '400' | '500' | '600' | '700';
}
export function Sans({ children, style, size = 13, weight = '400', ...props }: SansProps) {
  return (
    <RNText
      style={[
        {
          // 不设 fontFamily, 用系统
          fontSize: size,
          fontWeight: weight,
          lineHeight: size * 1.4,
          color: theme.color.ink,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// === Mono ===
interface MonoProps extends TextProps {
  size?: number;
  weight?: 'regular' | 'medium';
}
export function Mono({ children, style, size = 11, weight = 'regular', ...props }: MonoProps) {
  return (
    <RNText
      style={[
        {
          fontFamily: weight === 'medium' ? 'JetBrainsMono-Medium' : 'JetBrainsMono-Regular',
          fontSize: size,
          fontVariant: ['tabular-nums'],
          color: theme.color.ink2,
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

### 使用示例

```typescript
// Masthead
<Display size={38} italic>财富密码</Display>

// 信号正文
<Serif size={13}>{signal.rawText}</Serif>

// 按钮标签
<Sans size={9} weight="600" style={{ letterSpacing: 1.5, textTransform: 'uppercase' }}>
  记录
</Sans>

// 数字
<Mono size={24} weight="medium">+47%</Mono>
```

---

## § 5. 为什么 Sans 用系统字体

| 选项 | 优 | 劣 |
|---|---|---|
| 下载 Inter | 跨平台一致 | 体积大、和系统 UI 字体不匹配 |
| 用系统字体 | 体积零、系统级渲染 | 跨平台不一致 |

财富密码 选系统字体。Sans 用在 UI 控件上, 必须和系统 UI 自然融合。
报刊感的灵魂在 Display 和 Serif Body, Sans 是配角。

---

## § 6. 中文 fallback 实现

RN 不像 CSS 那样可以列多个 fontFamily fallback。它是单字体。

解决:**单一 family 内字符自动 fallback 到系统中文字体**。

确认实现:

```typescript
// iOS 测试: 显示英文 + 中文混排
<Display>财富密码 · 一份克制的判断</Display>
```

iOS 上"财富密码"用 Playfair Display 渲染, "一份克制的判断"自动用 PingFang SC。
Android 上"财富密码"用 Playfair Display, 中文用 Roboto fallback(系统选择)。

如果 Android 中文 fallback 不理想, 显式安装 Noto Sans CJK 字体并在样式里用条件:

```typescript
fontFamily: Platform.select({
  ios: 'PlayfairDisplay-Bold',
  android: 'PlayfairDisplay-Bold',  // Android 上 family 还是这个, fallback 由系统决定
}),
```

---

## § 7. 字号阶梯

```typescript
// src/core/theme/typography.ts
export const fontSize = {
  caption2: 11,
  caption1: 12,
  footnote: 13,
  subhead: 15,
  callout: 16,
  body: 17,
  headline: 17,
  title3: 20,
  title2: 22,
  title1: 28,
  largeTitle: 34,
} as const;
```

所有 Text 用这套字号, 不写奇怪数字。

---

## § 8. 关键场景

### 8.1 收件箱 Masthead

```typescript
<Display size={38} italic>财富密码</Display>
<Serif size={11} italic style={{ color: theme.color.ink2, letterSpacing: 1 }}>
  Conviction Quarterly
</Serif>
<Serif size={10} italic style={{ color: theme.color.muted }}>
  A Quiet Journal of High-Confidence Calls
</Serif>
```

### 8.2 承诺书

```typescript
<Display size={22} italic>SK 海力士</Display>
<Serif size={13.5}>{reasonForFutureSelf}</Serif>
<Mono size={10}>5% 仓位 · 6 个月承诺</Mono>
```

### 8.3 E4 主笔按

```typescript
<Display size={19} italic>{editorQuote}</Display>
```

### 8.4 时间轴

```typescript
<Display size={15} weight="bold">22</Display>
<Mono size={10}>01月</Mono>
<Display size={14} weight="bold">"群里抢 Mac Studio 512G"</Display>
```

---

## § 9. Dynamic Type 适配

iOS 用户可调全局字号(Settings → Accessibility → Display & Text Size)。

```typescript
// 标题不缩放
<Display allowFontScaling={false}>财富密码</Display>

// 正文允许缩放, 不超过 1.2x
<Serif maxFontSizeMultiplier={1.2}>...</Serif>
```

封装到 Display / Serif 组件里, 不让使用方关心。

---

## § 10. 性能

- 字体文件用 ttf 不用 otf(otf 渲染慢)
- 只 bundle 必要字重
- 启动加载完才隐藏 SplashScreen

---

## 一句话总结

> **字体不是装饰, 是产品声音的载体。**
>
> Playfair Display 让产品有报刊气息,
> Source Serif 4 让对话有文学感,
> 系统 Sans 让 UI 控件像 iOS,
> JetBrains Mono 让数字有可信度。
>
> 四种字体, 一起组成 财富密码 "严肃但不冰冷"的气质。

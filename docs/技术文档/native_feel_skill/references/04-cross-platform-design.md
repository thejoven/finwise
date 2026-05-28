# 04 · 跨平台设计语言 · 报刊感的统一实现

> 平台行为可以差异化, 设计语言必须统一。
> 这份文档定义"报刊感"在 RN 里的具体实现。

---

## 核心约束

下面这些视觉元素**跨平台严格一致**, 不接受平台差异:

- 字体(Playfair Display + Source Serif 4)
- 色板(paper / ink / red / green)
- 双横线 (border-double 模拟)
- 罗马数字 (I. II. III.)
- 大字 italic 标题
- 等宽数字
- 直角按钮(签字按钮)

平台差异化的部分是**行为**:滚动 bounce、modal 滑入、左滑返回、物理 back。

---

## § 1. 色板定义

```typescript
// src/core/theme/colors.ts
export const lightColors = {
  paper: '#ffffff',
  paper2: '#fafaf7',
  paper3: '#f3f1ec',
  paper4: '#ebe9e2',
  paperPressed: '#e8e6e0',     // 按下时
  
  ink: '#0a0a0a',
  ink2: '#2a2a2a',
  ink3: '#4a4a4a',
  
  muted: '#6b6b6b',
  muted2: '#999999',
  
  rule: '#d6d4ce',
  ruleSoft: '#e8e6e0',
  
  red: '#a8201a',
  redSoft: '#fce8e6',
  green: '#2e5e3a',
  
  highlight: '#fff4a8',
};

export const darkColors = {
  // 暗黑模式调色板, 后续 Phase 加
  // Phase 1 只支持 light
};
```

---

## § 2. 间距阶梯

```typescript
// src/core/theme/spacing.ts
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
```

---

## § 3. 圆角

```typescript
// src/core/theme/radius.ts
export const radius = {
  none: 0,         // 签字按钮、报刊风按钮
  sm: 6,
  md: 10,          // 标准按钮、输入框
  lg: 14,          // 大卡片
  full: 9999,
} as const;
```

---

## § 4. 字号

见 `07-typography.md` § 7。

---

## § 5. 主题入口

```typescript
// src/core/theme/index.ts
import { lightColors } from './colors';
import { spacing } from './spacing';
import { radius } from './radius';
import { fontSize } from './typography';

export const theme = {
  color: lightColors,
  spacing,
  radius,
  fontSize,
} as const;

export type Theme = typeof theme;
```

不用 React Context 或 styled-components, 直接 import。理由:

- 主题不切换(Phase 1 只有 light)
- 静态 import 比 Context 性能好
- AI 协助开发时更清楚 token 来源

未来支持暗黑时, 改 export 一个 useTheme hook:

```typescript
export function useTheme() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
```

---

## § 6. 报刊感 UI Primitives

下面几个组件是报刊风格的核心。建议都自绘到 `src/shared/components/`。

### 6.1 DoubleRule(双横线)

```typescript
// src/shared/components/DoubleRule.tsx
import { View, StyleSheet } from 'react-native';
import { theme } from '@/core/theme';

interface Props {
  thickness?: number;
}

export function DoubleRule({ thickness = 1 }: Props) {
  return (
    <View style={{ paddingVertical: 2 }}>
      <View style={{ height: thickness, backgroundColor: theme.color.ink }} />
      <View style={{ height: 2 }} />
      <View style={{ height: thickness, backgroundColor: theme.color.ink }} />
    </View>
  );
}
```

### 6.2 PaperCard(报刊纸卡)

```typescript
// src/shared/components/PaperCard.tsx
export function PaperCard({ children, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.paper,
    borderWidth: 1.5,
    borderColor: theme.color.ink,
    padding: theme.spacing.base,
  },
});
```

### 6.3 RomanList(罗马数字列表)

```typescript
// src/shared/components/RomanList.tsx
const ROMAN = ['I.', 'II.', 'III.', 'IV.', 'V.', 'VI.', 'VII.', 'VIII.'];

interface Props {
  items: { text: string; subtext?: string }[];
}

export function RomanList({ items }: Props) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={styles.row}>
          <Display size={22} italic style={styles.roman}>{ROMAN[i]}</Display>
          <View style={styles.content}>
            <Serif size={13.5}>{item.text}</Serif>
            {item.subtext && <Mono size={10} style={styles.subtext}>{item.subtext}</Mono>}
          </View>
        </View>
      ))}
    </View>
  );
}
```

承诺书的"退出条件"用这个组件渲染。

### 6.4 SectionHeader(报刊风小标题)

```typescript
// src/shared/components/SectionHeader.tsx
export function SectionHeader({ label, meta }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.diamond} />
      <Sans size={10} weight="700" style={styles.label}>
        {label}
      </Sans>
      {meta && (
        <Serif size={10} italic style={styles.meta}>
          {meta}
        </Serif>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 10,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: '45deg' }],
    alignSelf: 'center',
  },
  label: {
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: theme.color.ink,
  },
  meta: {
    marginLeft: 'auto',
    color: theme.color.muted,
  },
});
```

### 6.5 EditorialBlock(主笔按引文块)

```typescript
// src/shared/components/EditorialBlock.tsx
export function EditorialBlock({ label, quote, byline }: Props) {
  return (
    <View style={styles.container}>
      <Sans size={9} weight="700" style={styles.label}>{label}</Sans>
      <Display size={19} italic style={styles.quote}>{quote}</Display>
      <Sans size={9.5} weight="700" style={styles.byline}>{byline}</Sans>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: theme.color.ink,
  },
  label: {
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#c19a3b',  // 金色, 报刊高级感
    marginBottom: 12,
  },
  quote: {
    color: theme.color.paper,
    lineHeight: 19 * 1.4,
    marginBottom: 14,
  },
  byline: {
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
});
```

E4 焦虑陪伴的"主笔按"用这个组件。

### 6.6 Masthead(报刊头)

```typescript
// src/shared/components/Masthead.tsx
export function Masthead({ volume, edition, date, weekday }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TapEffect onPress={openMenu}><Text style={styles.icon}>≡</Text></TapEffect>
        <Sans size={9} weight="600" style={styles.topStrip}>
          <Sans size={9} weight="700">VOL. {volume} · NO. {edition}</Sans> · {date} · {weekday}
        </Sans>
        <TapEffect onPress={openSearch}><Text style={styles.icon}>⌕</Text></TapEffect>
      </View>
      <Display size={38} italic style={styles.nameplate}>Flashfi</Display>
      <Serif size={11} italic style={styles.subline}>Conviction Quarterly</Serif>
      <Serif size={10} italic style={styles.tagline}>
        A Quiet Journal of High-Confidence Calls
      </Serif>
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
    // 双横线效果用伪元素难, 这里用单粗线替代
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  icon: {
    fontFamily: 'PlayfairDisplay-Regular',
    fontSize: 18,
    color: theme.color.ink,
  },
  topStrip: {
    flex: 1,
    textAlign: 'center',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: theme.color.muted,
  },
  nameplate: {
    textAlign: 'center',
    marginBottom: 2,
    letterSpacing: -0.8,
  },
  subline: {
    textAlign: 'center',
    color: theme.color.ink2,
    letterSpacing: 1,
    marginBottom: 4,
  },
  tagline: {
    textAlign: 'center',
    color: theme.color.muted,
  },
});
```

---

## § 7. 跨平台一致的检查

提交 PR 前, 双平台模拟器各开一个,**对比检查**:

- [ ] 字体显示一致(Display / Serif / Sans 都是预期的)
- [ ] 色板一致(paper、ink、red 没有偏色)
- [ ] 间距一致(spacing token 使用)
- [ ] 圆角一致(radius token 使用)
- [ ] DoubleRule / PaperCard / EditorialBlock 视觉一致
- [ ] 字号一致(没有平台特殊覆盖)

允许差异的:
- 滚动 bounce (iOS 有, Android 没)
- Modal 顶部 grabber (iOS 有, Android 没)
- 触感(iOS 完整, Android 降级)
- 按下反馈(都用 TapEffect, 但 iOS 颜色变化幅度可调)

---

## 一句话总结

> 平台行为听 iOS / Android 的, 视觉设计听 Flashfi Engine 的。
> 这条边界画清楚, 跨平台一致和原生感就能同时成立。

---
name: wiseflow-rn-native-feel
description: Make React Native apps for 财富密码 feel indistinguishable from a native iOS/Android app, while honoring the project's restraint philosophy. Use this skill when building or reviewing any RN UI in the 财富密码 project — capture screens, inbox, commitment cards, anxiety companion, timeline replay. Triggers on requests like "build a screen for X", "make this feel more native", "implement the signing page", "review my component", or any work touching Pressable, Haptics, modal presentation, platform differences, font loading. Also activates when editing files under src/features/ or app/ and when the conversation mentions iOS native-feel, Expo, SafeAreaView, scroll bounce, sheet modals, or platform adaptation.
---

# 财富密码 · React Native Native Feel Skill

> 让 Expo + RN 写的 财富密码, 在 iOS 上像 iOS, 在 Android 上像 Android,
> 但更重要的——**让它在每一个平台上, 都先像 财富密码**。

---

## 这份 Skill 是干什么的

财富密码 用 React Native (Expo SDK 53+) 写多端, 但产品哲学要求每一端都"原生感"。

"原生感"不是装饰, 是**行为塑形器**——

- 一个用 default `<Button>` 的承诺书签字按钮, 会让"承诺"这件事变轻
- 一个 Toast 弹出的"已保存", 会破坏"沉默优于发声"的世界观
- 一次过度热情的成功反馈, 会让产品像玩具而不是契约

这份 Skill 是 60 项 RN native-feel 检查清单 + 反主流的 财富密码 克制项,
让 AI 在协助开发 RN UI 时自动遵守。

---

## RN 的原生感和 Flutter 完全相反

如果你从 Flutter 转来, 这点必须先看清楚:

| 维度 | Flutter | React Native |
|---|---|---|
| 渲染 | 自绘 (Skia/Impeller) | 调系统原生组件 |
| 默认风格 | Material(需要主动改成 Cupertino) | 平台默认(iOS 是 iOS, Android 是 Android) |
| 原生感的工作 | **主动让它像 iOS** | **防止它跨平台扭曲** |
| 视觉一致性 | 容易跨平台一致 | 难跨平台一致 |

**对 财富密码 的影响**:

- RN 在 iOS 上的"基础原生感"是免费的
- 但本产品的**强统一视觉**(报刊感、双横线、Playfair Display)需要更主动地自绘
- 平台差异化的取舍要明确——什么必须一致(设计语言)、什么必须分流(交互手势)

---

## 何时激活这份 Skill

任何涉及以下场景的对话:

- 编写或审查 财富密码 项目下的 RN UI 代码
- 用户说"这个看起来不像 iOS"、"做得更原生一点"
- 涉及 Pressable / TouchableOpacity / Modal / SafeAreaView
- 涉及 expo-haptics、StatusBar、字体加载
- 涉及 Platform.OS 平台分流
- 设计某个新页面时

不应激活的场景:

- 后端 Go 代码
- Mastra Agent 设计
- 与 UI 无关的纯业务逻辑

---

## 两条核心原则

### 原则 1 · 用平台默认, 但替换默认组件

RN 给的 `<Button>`、`<TouchableOpacity>`、`<Alert>` 都是**最低公约数**, 在 iOS 上视觉不够精致。

本项目的做法:

- **保留平台行为**(iOS 上 Modal 自动从下滑入、ScrollView 自动 bounce)
- **替换默认组件视觉**(自绘 TapEffect 替代 TouchableOpacity, 自绘 ActionSheet 替代 Alert)
- **设计语言跨平台统一**(报刊感 + 自有色板)

详见 `references/01-platform-philosophy.md`。

### 原则 2 · 财富密码 反主流的克制项

光做到"像 iOS"还不够。本项目还要**反主流移动应用的某些习惯**:

| 主流移动应用 | 财富密码 |
|---|---|
| 录入成功 Toast | 不弹, 直接关闭模态 |
| 任何操作震动反馈 | 只用在签字、退出条件触发等仪式时刻 |
| Loading 用 ActivityIndicator | 用打字机效果或不显示 |
| FAB 录入入口 | 底部 Tab 中间, 不抢眼 |
| 红点角标 | 永远不用 |
| Push 通知 | 永远不发 |
| 长按操作菜单 | 慎用, 首选明确按钮 |
| 滑动删除 | 不用 |

这些规则的依据全部在 `06_产品哲学.md` 里。详见 `references/05-wiseflow-restraint.md`。

---

## Skill 的内容布局

```
native_feel_skill/
├── SKILL.md                                # 这份文件, 入口
├── references/
│   ├── 01-platform-philosophy.md           # RN 平台心智, 默认 vs 自绘的取舍
│   ├── 02-ios-checklist.md                 # iOS 详细 30 项清单 🟢
│   ├── 03-android-checklist.md             # Android 大纲 (Phase 2)
│   ├── 04-cross-platform-design.md         # 强统一视觉的实现
│   ├── 05-wiseflow-restraint.md          # 财富密码 专属克制 🟢
│   ├── 06-haptic-grammar.md                # 触感反馈的语法
│   ├── 07-typography.md                    # 字体加载与中文混排
│   └── 08-anti-patterns.md                 # 必须禁止的反模式 🟢
└── checklists/
    ├── new-screen-review.md                # 新页面提交前 30 项自查
    └── pre-release-audit.md                # 发布前完整 60 项审计
```

---

## 怎么用这份 Skill

### 场景 1 · 我要新写一个页面

1. 先看 `references/01-platform-philosophy.md` 理解默认 vs 自绘的取舍
2. 找最相关的 platform checklist
3. 写完后用 `checklists/new-screen-review.md` 自查

### 场景 2 · 我的页面看起来不像原生

1. 先用 `references/08-anti-patterns.md` 排查反模式
2. 重点检查: TouchableOpacity 默认动画、Alert 弹窗、Loading spinner
3. 检查触感反馈和字体

### 场景 3 · 我在做承诺书签字这种"仪式感"页面

最不能将就的页面。必读:

1. `references/05-wiseflow-restraint.md`
2. `references/06-haptic-grammar.md` — 签字时该用什么触感
3. `references/07-typography.md` — 大字号的报刊感

### 场景 4 · 我在做录入这种"快进快出"页面

完全不同的标准:

1. 速度感优先于仪式感
2. 反馈极度克制(不弹 Toast、不震动)
3. 离线优先, UI 立即变化

---

## 关键技术栈速查

| 关注点 | 选型 | 备注 |
|---|---|---|
| 触感 | `expo-haptics` | 不用 RN Vibration API |
| 状态栏 | `expo-status-bar` | 不用 RN StatusBar(过时) |
| Safe Area | `react-native-safe-area-context` | Expo 自带 |
| Modal | Expo Router `presentation: 'modal'` | 不用 RN 自带 Modal |
| Alert / Confirm | 自绘 ActionSheet | 不用 RN Alert.alert |
| 按下高亮 | 自绘 `<TapEffect>` | 不用默认 TouchableOpacity |
| Loading | **不显示** 或打字机效果 | 不用 ActivityIndicator |
| Toast | **不用** | 错误 inline 显示 |
| FAB | **不用** | 底部 Tab |
| 字体 | `expo-font` + bundle ttf | 不用 web font |
| 图标 | `lucide-react-native` | 一致的 stroke 风格 |

---

## 与项目其他文档的关系

- 这份 Skill 是文档 `06 · React Native 应用架构` 的 § 14 节的展开
- 它不重复主架构设计, 只负责"原生感"这一个垂直切片
- 测试覆盖见 `08 · 测试策略`
- 不替代设计系统(`src/core/theme/`), 而是它的应用指南

---

## 一句话总结

> **iOS 让它好看, 财富密码 让它有重量。**
>
> 主流 RN APP 用反馈、动画、Toast 来"让用户感到产品很活跃"。
> 本产品反过来——**让用户感到自己在做严肃的事**。
>
> 这一点上, **少做的事比多做的事更重要**。

---

## License

MIT — 借鉴自 yetone/native-feel-skill 的结构, 内容为 财富密码 项目原创。

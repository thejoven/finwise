# M3 · 客户端外壳

> Phase 1 · W3-W5 · 3 周 · 客户端工程, 可与 M2 并行

---

## 上下文

M3 搭起客户端的"骨架和血管"——
项目初始化、字体加载、设计系统、路由、本地数据库、网络层。

**不实现任何业务页面**(B1 录入、A1 收件箱在 M4)。
但要把所有"业务页面会用到的基础设施"都搭好。

M3 的产出物是: 一个能跑起来、空白页有报刊感字体、底部 Tab 切换、能连接后端的 RN 项目。

---

## 前置依赖

- 环境装好:
  - Xcode 16+
  - Expo CLI + EAS CLI(`npm i -g eas-cli`)
  - Node.js 20 LTS
  - iOS Simulator
  - 一个 macOS 设备(纯前端开发不需要 M1)
- M1 完成可以更好(测试 API 联调), 但不是硬依赖

---

## 目标

完成后, `mobile/` 目录有:

```
mobile/
├── app/                                    # Expo Router
│   ├── _layout.tsx                         # 根 layout + 字体加载
│   ├── (tabs)/
│   │   ├── _layout.tsx                     # Tab 容器
│   │   ├── inbox.tsx                       # A1 占位
│   │   └── archive.tsx                     # 档案 占位
│   ├── capture.tsx                         # B1 占位(modal)
│   └── +not-found.tsx
├── src/
│   ├── core/
│   │   ├── theme/
│   │   │   ├── colors.ts
│   │   │   ├── spacing.ts
│   │   │   ├── radius.ts
│   │   │   ├── typography.ts
│   │   │   └── index.ts
│   │   ├── api/
│   │   │   └── client.ts                   # ky 封装
│   │   ├── storage/
│   │   │   └── database.ts                 # WatermelonDB schema
│   │   └── haptics/
│   │       └── index.ts
│   ├── shared/
│   │   └── components/
│   │       ├── Text.tsx                    # Display/Serif/Sans/Mono
│   │       ├── TapEffect.tsx
│   │       ├── PaperCard.tsx
│   │       ├── DoubleRule.tsx
│   │       └── Masthead.tsx
│   └── features/                           # M4 才填业务
├── assets/
│   └── fonts/                              # bundle 字体文件
├── app.json
├── eas.json
├── package.json
└── tsconfig.json
```

启动后:
- 空白的"收件箱"页有 Masthead("Flashfi" + "Conviction Quarterly" + tagline)
- 底部 Tab 切换工作
- 模态 capture 页能从底部滑入
- ky 客户端能 ping 后端 /healthz

---

## 任务列表

### Task 3.1 · 初始化 Expo 项目

```bash
cd flashfi   # 在 server/ 兄弟目录创建
npx create-expo-app@latest mobile --template default-typescript
cd mobile
```

清理:
- 删除 app/(tabs)/explore.tsx 等模板示例
- 删除 components/ 模板
- 保留 _layout.tsx 但清空内容
- 删除 .vscode 的模板配置

**已知坑**:
- 用 default-typescript 模板, 不要 blank
- 不要用 `expo-template-blank-typescript`(过时了)

### Task 3.2 · 安装依赖

```bash
# Expo 模块(用 expo install 保证版本兼容)
npx expo install expo-haptics expo-font expo-status-bar expo-splash-screen
npx expo install react-native-safe-area-context

# 业务依赖
npm i zustand @tanstack/react-query ky zod
npm i @microsoft/fetch-event-source
npm i lucide-react-native uuid

# 离线存储(M3.x 才装, 先 placeholder)
# npm i @nozbe/watermelondb @nozbe/with-observables

# Dev 依赖
npm i -D @types/uuid prettier
```

**已知坑**:
- WatermelonDB 在 Expo Managed 上需要 prebuild 才能用, M3 先用 expo-sqlite 兜底, M4 再决定是否切 WatermelonDB
- `react-native-paper`、`react-native-elements` **永远不要装**
- `expo-notifications` **永远不要装**

### Task 3.3 · 配置路径别名

`tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

`babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        alias: { '@': './src' },
      }],
    ],
  };
};
```

**已知坑**: babel + tsconfig 都要配, 缺一个 IDE 或运行时报错。

### Task 3.4 · 下载并 bundle 字体

下载到 `assets/fonts/`:
- Playfair Display: Bold, Italic, BoldItalic
- Source Serif 4: Regular, Italic, SemiBold
- Noto Serif SC: Regular, Bold (从 Google Fonts)
- JetBrains Mono: Regular, Medium

只 bundle 这几个字重, 不要全字重。

**已知坑**:
- 字体文件用 ttf > otf(渲染快)
- Source Serif 4 必须从 Adobe Fonts open source 下, 不是 Source Serif Pro(那是闭源版本)

### Task 3.5 · 字体加载 + SplashScreen

`app/_layout.tsx`:

```typescript
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Stack } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    'PlayfairDisplay-Bold': require('../assets/fonts/PlayfairDisplay-Bold.ttf'),
    'PlayfairDisplay-Italic': require('../assets/fonts/PlayfairDisplay-Italic.ttf'),
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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="capture"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
```

### Task 3.6 · 设计 token 文件

写 `src/core/theme/` 四份文件 + index.ts。

参考 `技术文档/native_feel_skill/references/04-cross-platform-design.md`。

### Task 3.7 · 字体组件封装

写 `src/shared/components/Text.tsx`, 4 个组件: Display / Serif / Sans / Mono。

参考 `技术文档/native_feel_skill/references/07-typography.md` § 4。

**关键**: 不允许其他地方裸用 RN 的 `<Text>`, 都通过这 4 个组件。

### Task 3.8 · UI Primitives

写以下组件到 `src/shared/components/`:

1. **TapEffect** — Pressable + 按下颜色变化(替代 TouchableOpacity)
2. **PaperCard** — 边框 + 白底卡片
3. **DoubleRule** — 双横线
4. **SectionHeader** — 报刊风小标题(♦ 标签 + meta)
5. **Masthead** — A1 收件箱顶部的报刊头

参考 `技术文档/native_feel_skill/references/04-cross-platform-design.md` § 6。

### Task 3.9 · 路由骨架

`app/(tabs)/_layout.tsx`:

```typescript
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { theme } from '@/core/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.color.paper,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.ink,
          height: 64,
        },
        tabBarLabelStyle: {
          fontFamily: 'SourceSerif4-Regular',
          fontSize: 9,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        },
        tabBarActiveTintColor: theme.color.ink,
        tabBarInactiveTintColor: theme.color.muted,
      }}
    >
      <Tabs.Screen name="inbox" options={{ title: '收件箱' }} />
      <Tabs.Screen name="archive" options={{ title: '档案' }} />
    </Tabs>
  );
}
```

**注意**: "记录" Tab 不在这里(它是中间的 modal 入口, 用浮动按钮触发), Phase 1 简化为底部 Tab 也行。

### Task 3.10 · API 客户端

写 `src/core/api/client.ts`:

```typescript
import ky from 'ky';

export const api = ky.create({
  prefixUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080',
  hooks: {
    beforeRequest: [
      (request) => {
        // M3 阶段用 hardcoded token, Phase 4+ 才上正式 auth
        request.headers.set('Authorization', `Bearer dev-token`);
      },
    ],
  },
  retry: { limit: 2 },
});
```

**已知坑**:
- `EXPO_PUBLIC_*` 前缀的 env 变量才会暴露到客户端
- iOS Simulator 访问 localhost OK, 真机要用 LAN IP
- 不要装 axios, 用 ky

### Task 3.11 · TanStack Query 配置

`app/_layout.tsx` 加 QueryClientProvider:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60, // 1 分钟
    },
  },
});

// ... 把 <Stack> 包在 <QueryClientProvider>
```

### Task 3.12 · 收件箱占位页

`app/(tabs)/inbox.tsx`:

```typescript
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, ScrollView } from 'react-native';
import { Masthead, Serif } from '@/shared/components';
import { theme } from '@/core/theme';

export default function InboxScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.paper }} edges={['top']}>
      <Masthead volume="I" edition="1" date="W1" weekday="开始" />
      <ScrollView>
        <View style={{ padding: theme.spacing.lg }}>
          <Serif size={13} style={{ color: theme.color.muted, fontStyle: 'italic' }}>
            这里会显示你的观察记录。{'\n'}
            它们不需要立即写下来。
          </Serif>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

注意空状态文案的"接纳, 不催促"——这是产品哲学的 UI 体现。

### Task 3.13 · 验证一切都跑通

```bash
cd mobile
npx expo start
# 在 iOS Simulator 里跑
```

检查:
- 字体加载完才显示 UI(SplashScreen 工作)
- Masthead 大字 "Flashfi" 是 Playfair Display italic
- 副线 "Conviction Quarterly" 显示正确
- Tab 切换流畅, 标签字号 9pt 大写
- 模态 capture 从底部滑入
- API ping 后端成功(如果 M1 已起)

---

## 验收标准

### 视觉
- [ ] Masthead 三行(主名 + 副线 + tagline)显示正确
- [ ] 字体清晰, 没有 fallback 闪烁
- [ ] 暗黑模式不破坏(可以暂不适配, 但不能崩)
- [ ] Tab 按下时颜色变化, 没有 Material Ripple
- [ ] Modal 从底部滑入流畅

### 工程
- [ ] `npx expo start` 正常起
- [ ] iOS Simulator 跑通
- [ ] `pnpm tsc --noEmit` 无错误
- [ ] `npx expo-doctor` 通过
- [ ] 项目结构和 § 目标 一致

### 反模式
- [ ] grep 检查无 `Alert\.alert|TouchableOpacity|<Button` (除了 TapEffect 内部)
- [ ] grep 检查无 `Toast|ActivityIndicator|expo-notifications`
- [ ] package.json 无黑名单库

### 设计 token
- [ ] 所有颜色走 theme.color
- [ ] 所有间距走 theme.spacing
- [ ] 所有字号走 theme.fontSize
- [ ] 所有圆角走 theme.radius

---

## 自由度边界

### 你可以自由决定
- prettier 配置(单引号 / 双引号)
- 文件夹细分
- TypeScript strict 级别
- env 变量管理方式

### 必须问
- 想用 NativeWind / Tailwind RN(我倾向不用)
- 想用 Tamagui / restyle(我倾向不用)
- 想引入 zustand 之外的状态库
- 想现在就上 WatermelonDB(M4 才决定)
- 想用 PNPM 替代 npm

### 不允许
- 引入黑名单库(见 AGENT_BRIEF § 2.4)
- 用 Material Design 视觉
- 跳过字体 bundle 用 web font
- 把 inbox 做成 dashboard

---

## 已知坑(汇总)

1. **WatermelonDB 在 Managed 上需要 prebuild**, M3 阶段先用 expo-sqlite 或不存数据
2. **字体只 bundle 必要字重**, 不要全字重
3. **babel + tsconfig 路径别名都要配**
4. **Sans 用系统字体**, 不要下载 Inter
5. **EXPO_PUBLIC_* 前缀**才暴露到客户端
6. **iOS Simulator 访问 localhost** OK, 真机要 LAN IP
7. **Mac 上不要装 react-native-cli**(老版本), 用 Expo CLI

---

## 交叉引用

- 客户端架构 → `技术文档/06_ReactNative应用架构_大纲.md`
- iOS 清单 → `技术文档/native_feel_skill/references/02-ios-checklist.md`
- 字体方案 → `技术文档/native_feel_skill/references/07-typography.md`
- UI Primitives → `技术文档/native_feel_skill/references/04-cross-platform-design.md`

---

## 完成后做什么

更新 `phase-1-quiet/00-overview.md` 里 M3 状态为 ✅。
如果 M2 也完成, 进 M4 端到端验证。

# 06 · React Native 应用架构 · 大纲

> 作者视角:**客户端工程师**
> 这份文档回答:RN 项目用 Expo 怎么组织、状态管理用什么、offline-first 怎么做、SSE 怎么消费。
>
> 技术栈:**Expo SDK 53+ · TypeScript · iOS first**

---

## 这份文档要回答的核心问题

1. 为什么用 Expo 而不是裸 RN CLI?
2. 项目目录怎么组织?
3. 状态管理用哪个,什么放进去,什么不放?
4. 离线优先怎么和后端同步?
5. SSE 怎么在 RN 里消费?
6. UI 怎么遵循产品哲学(克制、沉默、原生感)?

---

## § 1. 框架选择 · Expo SDK 53+ · 不是 RN CLI

### 1.1 为什么是 Expo

Expo SDK 53+(2025 年发布)的关键变化:

- `expo prebuild` 后可以**直接编辑 ios/ 和 android/ 目录**, 等于完整原生项目
- 支持 New Architecture (Fabric) 默认开启
- 提供成熟的 expo-* 模块(haptics, font, secure-store, sqlite 等), 替代了大量第三方包
- EAS Build 云构建, 不绑定本地 Xcode 性能

**Expo 不再是"玩具框架"**, 它是 2025 年的行业默认。Discord、Coinbase、Brex 都在用。

### 1.2 关键决策:用 Bare Workflow 还是 Managed?

本项目用 **Managed + 按需 prebuild**:

- 一开始用 Managed(享受 OTA 更新、EAS Build、Expo Go 调试)
- 需要原生定制时跑 `expo prebuild` → 项目变成 Bare 但保留 Expo 工具链
- **永不删除 Expo 模块**, 享受所有便利

### 1.3 RN 版本锚定

- Expo SDK 53 → RN 0.76+ + New Architecture
- TypeScript 5.x
- Node.js 20 LTS

锁版本到 package.json, 不接 RN nightly。

---

## § 2. 项目结构

按 **feature-first** 组织, 配合 Expo Router 的 file-based routing:

```
/app                          # Expo Router · 路由即文件
  /(tabs)
    _layout.tsx               # Tab 容器
    inbox.tsx                 # A1 收件箱
    capture.tsx               # B1 录入入口(模态)
    archive.tsx               # 档案 tab
  /signal
    [id].tsx                  # 信号详情
    [id]/refine.tsx           # 五轮追问
  /commitment
    [id].tsx                  # 承诺书详情
    [id]/sign.tsx             # 签字
    [id]/companion.tsx        # E4 焦虑陪伴
  /retrospect
    [id].tsx                  # F2 时间轴
  _layout.tsx                 # 根 layout
  +not-found.tsx

/src
  /core
    /api                      # ApiClient, SSE 客户端
    /storage                  # WatermelonDB schema + queries
    /auth                     # JWT 管理 + SecureStore
    /theme                    # 设计 token (颜色、字体、间距)
    /haptics                  # 触感语法封装
  /features
    /capture                  # B1 业务逻辑
    /inbox                    # A1
    /training                 # B2
    /commitment
    /companion
    /retrospect
  /shared
    /components               # 复用 UI
    /hooks                    # 复用 hooks
    /utils

/assets
  /fonts                      # bundle 的字体
  /images                     # 极少, 因为本产品视觉极简

app.json                      # Expo 配置
eas.json                      # EAS Build 配置
package.json
tsconfig.json
```

每个 feature 内部统一结构:

```
/feature
  /domain                     # 类型 (zod schemas + inferred types)
  /data                       # repository, datasource
  /presentation               # screens / components / hooks
  index.ts                    # 公开导出
```

---

## § 3. 核心技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 路由 | **Expo Router v3** | file-based, 类型安全, 深链接零配置 |
| 状态管理 | **Zustand** | 最简洁, 适合本产品的低频交互, AI 友好 |
| Server State | **TanStack Query (React Query)** | 缓存 + 重试 + 同步语义齐全 |
| 离线数据库 | **WatermelonDB** | offline-first 之王, lazy-loaded, 性能极好 |
| KV 存储 | **MMKV** | 比 AsyncStorage 快 30 倍, 同步 API |
| 安全存储 | **expo-secure-store** | JWT、refresh token |
| 网络 | **ky** | fetch 的现代封装, 比 axios 轻 |
| SSE | **@microsoft/fetch-event-source** | 唯一支持 POST + auth header 的 SSE 库 |
| 表单 | **react-hook-form + zod** | 性能 + 类型安全 |
| Schema 校验 | **zod** | 全栈共享 type, 也用在 LLM 输出验证 |
| 字体 | **expo-font** | bundle 字体, 启动加载 |
| 图标 | **lucide-react-native** | 一致的 stroke 风格, 适合报刊感 |
| 触感 | **expo-haptics** | iOS Taptic Engine 完整支持 |
| 测试 | **Jest + React Native Testing Library** | 标配 |
| E2E | **Maestro** | YAML 配置, 比 Detox 简单太多 |
| 国际化 | **暂不需要 · Phase 3+ 再加** | i18next + expo-localization |

明确**不用**的:

- ❌ Redux / Redux Toolkit(对本项目过重)
- ❌ MobX(范式不直观)
- ❌ axios(ky 更现代)
- ❌ AsyncStorage(被 MMKV 取代)
- ❌ Realm(WatermelonDB 比它 RN 体验好)
- ❌ NativeBase / Tamagui / RN Paper(本项目自绘 UI, 不引 UI 库)
- ❌ Detox(Maestro 更简单)
- ❌ Reanimated 复杂动画(本项目动画极简)

---

## § 4. 状态管理 · Zustand + TanStack Query 分工

核心心智模型: **本地状态用 Zustand, 服务器状态用 TanStack Query**。

### 4.1 Zustand 管什么

- 当前用户(login state, JWT)
- UI 局部状态(modal open, drawer expanded)
- 录入页临时草稿
- 设置项(主题, 已读偏好)

### 4.2 TanStack Query 管什么

- 信号列表(分页)
- 承诺书详情
- 持仓状态
- 用户档案

理由: 这些来自后端, 需要缓存、重试、后台刷新、乐观更新。Zustand 不该做这些。

### 4.3 WatermelonDB 管什么

**离线优先的真相**。所有用户输入(信号、追问答案)先写 WatermelonDB, 再通过 sync queue 同步到后端。

```
用户输入
   ↓
WatermelonDB (本地真相)
   ↓ (异步)
后端 events 表
   ↓ (异步回流)
TanStack Query cache (UI 读这里)
```

UI 不直接读 WatermelonDB(除非离线场景), 通过 TanStack Query 统一读。

---

## § 5. 路由 · Expo Router file-based

### 5.1 为什么是 file-based

- 类型安全(href 是 typed)
- 深链接零配置
- 嵌套 layout 直观
- 和 Web Next.js 心智一致(你熟 React, 这点直接受益)

### 5.2 路由表

```
/                              → 重定向到 /(tabs)/inbox
/(tabs)/inbox                  → A1 收件箱
/(tabs)/capture                → B1 录入(模态展示)
/(tabs)/archive                → 档案

/signal/[id]                   → 信号详情
/signal/[id]/refine            → 五轮追问(模态)

/commitment/[id]               → 承诺书详情
/commitment/[id]/sign          → 签字
/commitment/[id]/companion     → E4 焦虑陪伴
/commitment/[id]/retrospect    → 复盘对话

/retrospect/[id]               → F2 时间轴回放

/profile                       → 用户档案
/profile/ability               → 能力地图
/profile/judgment              → 判据演化(Phase 3+)
```

### 5.3 模态展示

录入页是 modal(从下滑入), 用 Expo Router 的 `presentation: 'modal'`:

```typescript
// app/(tabs)/capture.tsx
export const unstable_settings = {
  presentation: 'modal',
};
```

iOS 上自动显示为半屏 sheet, 带 grabber。

---

## § 6. Offline-First 架构

### 6.1 写路径

```typescript
// src/features/capture/data/capture-repository.ts
async function captureSignal(rawText: string) {
  const clientEventId = uuidv7();
  const now = new Date();

  // 1. 写 WatermelonDB
  await database.write(async () => {
    await signalsCollection.create((signal) => {
      signal.clientEventId = clientEventId;
      signal.rawText = rawText;
      signal.capturedAt = now;
      signal.syncStatus = 'pending';
    });
  });

  // 2. 后台同步,不阻塞 UI
  syncQueue.enqueue({ type: 'capture', clientEventId, rawText, capturedAt: now });
}
```

### 6.2 同步队列

后台 worker(用 expo-background-fetch 或 in-process):

- 扫描 syncStatus = 'pending' 的记录
- POST 到 `/v1/signals`
- 成功 → 标记 synced + 写入 server_event_id
- 失败 → 标记 failed, 指数退避重试

### 6.3 网络监测

```typescript
// 用 @react-native-community/netinfo
NetInfo.addEventListener(state => {
  if (state.isConnected) syncQueue.flush();
});
```

### 6.4 启动时全量扫描

APP 启动后立即扫一遍 pending + failed, 触发同步。

---

## § 7. SSE 流式响应

### 7.1 为什么不用 fetch 原生 SSE

RN 的 fetch 实现**不支持原生 SSE 解析**。需要第三方:

- `react-native-event-source` — 不支持 POST 和 auth header(致命)
- `@microsoft/fetch-event-source` — **支持 POST + headers, 推荐**
- 自己用 ReadableStream + parser — 复杂但灵活

### 7.2 推荐 · fetch-event-source

```typescript
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('/v1/signals/123/refine', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
  },
  body: JSON.stringify({ answer: '...' }),
  onmessage(ev) {
    if (ev.event === 'token') {
      const { text } = JSON.parse(ev.data);
      // 更新 UI
    }
    if (ev.event === 'complete') {
      const data = JSON.parse(ev.data);
      // 持久化
    }
  },
  onerror(err) {
    // 重连策略
  },
});
```

### 7.3 应用场景

- 五轮追问对话
- 承诺书叙述生成(打字机效果)
- 复盘四问对话

---

## § 8. 设计系统对齐

复用原型 v4 的视觉语言:

- 字体: Playfair Display + Source Serif 4 + Noto Serif SC + JetBrains Mono
- 颜色: paper / ink / red / green
- 排版: 报刊感(双横线、罗马数字、italic 大字)

RN 实现:

- 字体用 expo-font + bundle ttf
- 设计 token 用 TypeScript const 文件, 不引 UI 库
- 关键 UI primitive 自绘:
  - `<PaperCard>` — 卡片底
  - `<DoubleRule>` — 双横线
  - `<MastheadTitle>` — 报刊标题
  - `<TapEffect>` — 按下高亮(替代 RN Ripple)

详见 native_feel_skill。

---

## § 9. 字体加载

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

字体策略详见 native_feel_skill 的 typography 章节。

---

## § 10. 关键 UI 模式

呼应产品哲学的 UI 实现:

- **克制的反馈**: 录入后只关闭模态, 不弹 Toast
- **承诺书 vs 建议**: 用词、字体、排版严格区分
- **焦虑陪伴**: Editor's Note 引文样式
- **时间轴**: 自绘纵向, 不用第三方 timeline 库
- **触感**: 见 native_feel_skill 的 haptic-grammar

---

## § 11. 性能与构建

### 11.1 启动优化

- 字体在 SplashScreen 期间加载完
- 首屏只加载 inbox feature
- 其他 feature 懒加载(Expo Router 自动分包)

### 11.2 包大小目标

- iOS ipa < 50MB
- Android apk < 60MB

### 11.3 构建配置

```json
// eas.json (简化版)
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": {}
  }
}
```

Phase 1 用 development build + Expo Go 调试, Phase 2 起出 preview build 给自己用。

---

## § 12. 平台适配

🟢 Phase 1 只做 iOS。Android 在 Phase 2 开发完后再编译测试。

不需要 platform-specific 文件, 用 `Platform.OS` 判断:

```typescript
import { Platform } from 'react-native';
const isIOS = Platform.OS === 'ios';
```

更高级的:

```typescript
// 平台专属文件
Button.ios.tsx
Button.android.tsx
Button.tsx     # 默认
```

Metro bundler 自动选择。但本项目 Phase 1 几乎用不到, 简单 if-else 足够。

---

## § 13. Phase 1 最小落地清单

🟢 Phase 1 实际要实现:

- A1 收件箱(只读)
- B1 录入页(完整)
- WatermelonDB schema + sync queue
- 一个最简单的设置页(登录、退出)
- 字体加载 + 主题 token
- API 客户端(ky)

其他 feature 留目录占位 + TODO。

---

## § 14. 原生感工程清单

RN 的原生感和 Flutter 不同:RN 默认就是原生组件, 但 Flashfi Engine 的克制哲学需要额外约束。

完整清单见 `/native_feel_skill/SKILL.md`, 这里只列纲要:

**iOS 必做**
- 平台默认 `<TouchableOpacity>` 替换为自定义 `<TapEffect>`(去掉默认 0.2 opacity, 用项目自己的)
- StatusBar 跟随主题
- SafeAreaView 包所有页面
- Modal 用 Expo Router 的 `presentation: 'modal'`
- 触感反馈用 expo-haptics, 不用 Vibration API
- 字体用 bundle 的 Playfair / Source Serif

**反模式禁止**
- 不用 React Native 默认的 `<Button>`(丑陋, 没控制力)
- 不用 Alert.alert(用自绘 ActionSheet)
- 不用 ToastAndroid / showMessage 库
- 不用 react-native-toast-message
- 不显示 Loading Spinner

**Flashfi Engine 专属**
- 永远不要在录入成功后 Toast
- 永远不要 push notification 权限
- 不用 FAB pattern
- 不用红点角标

完整 60 项清单见 native_feel_skill。

---

## 关键决策预告

1. **Expo SDK 53+ Managed + 按需 prebuild** — 不裸 RN CLI
2. **Expo Router file-based** — over React Navigation
3. **Zustand + TanStack Query 分工** — 不上 Redux
4. **WatermelonDB over MMKV-only** — offline-first 是核心需求
5. **fetch-event-source for SSE** — 唯一靠谱的选择
6. **不引 UI 库** — 自绘以保证设计语言纯粹
7. **Phase 1 只做 iOS** — Android 等 Phase 2 编译验证

---

## 交叉引用

- API 契约 → 文档 04
- SSE 协议细节 → 文档 04
- 端到端测试 → 文档 08
- 客户端打包发布 → 文档 07
- **原生感完整清单 → `/native_feel_skill/SKILL.md`**

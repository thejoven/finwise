# mobile/

Flashfi Engine 客户端 — Expo SDK 52 + React Native 0.76 + Expo Router 4 + TypeScript.

```
app/                      # Expo Router (文件路由)
├── _layout.tsx           # 字体 + SplashScreen + QueryClient + Stack
├── (tabs)/
│   ├── _layout.tsx       # Tab 容器 (收件箱 / 档案)
│   ├── inbox.tsx         # A1 占位 (M4 接业务)
│   └── archive.tsx       # 档案 占位
├── capture.tsx           # B1 录入 modal 占位
└── +not-found.tsx

src/
├── core/
│   ├── theme/            # colors / spacing / radius / typography token
│   └── api/              # ky + zod-validated /v1/signals 客户端
└── shared/
    └── components/       # Display/Serif/Sans/Mono + TapEffect + PaperCard
                          # + DoubleRule + SectionHeader + RomanList + Masthead

assets/fonts/             # 字体放这里 — 见 assets/fonts/README.md
scripts/
└── check-banned-deps.sh  # CI 守门: 禁用库出现就报错
```

---

## 装

前置:
- Node 20+
- Xcode 16+ (iOS Simulator)
- (可选) Watchman: `brew install watchman`

```bash
cd mobile
cp .env.example .env
# 编辑 .env, 让 EXPO_PUBLIC_DEV_BEARER_TOKEN 跟 server/.env 一致
npm install
```

### 字体

需要把 11 个 ttf/otf 文件下到 `assets/fonts/`. 详见 [`assets/fonts/README.md`](assets/fonts/README.md).
缺字体直接卡 SplashScreen — 这是故意的, 防止 fallback 字体闪一下.

---

## 跑

```bash
npm start
# 然后按 i 进 iOS Simulator (或扫码上真机)
```

健康检查:

```bash
# 1) Masthead 显示 "Flashfi" 大斜体
# 2) Tab 在底部, 收件箱 + 档案
# 3) 没有任何 Loading spinner / Toast / 红点
# 4) 字体加载完才显示 UI (SplashScreen 工作)
```

---

## 命令

```bash
npm run typecheck            # tsc --noEmit
npm run lint                 # prettier check
npm run check:banned-deps    # 禁用库守门
npm run ios                  # 真机/模拟器
```

---

## 关键约束

按 [`docs/技术文档/native_feel_skill/`](../docs/技术文档/native_feel_skill/):

- 不装 `react-native-toast-message` / `react-native-paper` / `react-native-elements` / `lottie-react-native` / `expo-notifications` 等. 完整黑名单见 `scripts/check-banned-deps.sh`.
- 不用 `TouchableOpacity`. 按下用 `<TapEffect>`.
- 不用 `Alert.alert`, 不用 `ActivityIndicator`, 不用 Toast. 错误 inline 显示.
- 不弹"已保存". 直接关闭 modal, UI 状态变化本身就是反馈.
- 文字全部走 `<Display>` / `<Serif>` / `<Sans>` / `<Mono>`, 不裸用 RN `<Text>`.
- 颜色/间距/字号/圆角全部走 `theme.*` token.

每个 PR 前对照 [`docs/技术文档/native_feel_skill/checklists/new-screen-review.md`](../docs/技术文档/native_feel_skill/checklists/new-screen-review.md) 30 项过一遍.

---

## 当前进度

M3 完成的:
- ✅ 工程脚手架 (Expo Router, TypeScript, theme token)
- ✅ Text 四组件 (Display / Serif / Sans / Mono)
- ✅ UI primitives (TapEffect, PaperCard, DoubleRule, SectionHeader, RomanList, Masthead)
- ✅ API 客户端 (ky + zod)
- ✅ 路由骨架 + 占位页 (inbox / archive / capture / +not-found)
- ✅ banned-deps CI 守门
- ⏳ 字体文件 (下到 assets/fonts/, 见 README)
- ⏳ `npm install` (你来跑, 网络条件好时)

M4 才填的:
- B1 真实录入 (输入框 + 30 秒 + sync queue)
- A1 真实信号列表
- 离线同步 (expo-sqlite 或 WatermelonDB, M4 决定)

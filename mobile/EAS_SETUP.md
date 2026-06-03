# EAS Build · Mobile · 装机指南

> 触发时机: Phase 1 W8 通过 + 决定要用 TestFlight 内测.
> 不到那时不要装. 见 [docs/TESTFLIGHT_PLAN.md § 0](../docs/TESTFLIGHT_PLAN.md).

---

## § 1 · 一次性装机

```bash
# 1) EAS CLI
npm i -g eas-cli
eas login            # 用你的 Expo 账号登录 (没有就 eas register)

# 2) 关联本项目
cd /Users/clh-openclaw/Project/0002-wiseflow/mobile
eas init             # 让 EAS 在 expo.dev 创建一个 project, slug 写 wiseflow
                     # 它会修改 app.json 加 extra.eas.projectId, 提交进 git

# 3) 检查 eas.json 没问题
eas build:configure  # 检查 app.json 兼容
```

---

## § 2 · 填 Apple 真实值

打开 `mobile/eas.json`. 三个 `WISEFLOW_*` 占位符要填:

| 占位符 | 哪里拿 |
|---|---|
| `WISEFLOW_APPLE_ID` | 你的 Apple ID 邮箱 (开发者账号那个) |
| `WISEFLOW_ASC_APP_ID` | App Store Connect → My Apps → WiseFlow → App Info → Apple ID (一串数字) |
| `WISEFLOW_APPLE_TEAM_ID` | <https://developer.apple.com/account> → Membership → Team ID (10 字符) |

**填的时机**: 在 [docs/TESTFLIGHT_PLAN.md § 1.1](../docs/TESTFLIGHT_PLAN.md) 注册 Apple Developer
+ App Store Connect 创建 App 之后. 之前先留占位符, 防止你心血来潮想跑 build 跑挂.

> ⚠️ 用 `eas secret:create --scope project --name <NAME> --value <VALUE>` 存敏感值
> 是更好的做法, 但 EAS 不支持把 submit.production.ios.* 替换成 secret —
> 这三个值不是密码, 是公开标识符, 直接写进 eas.json 入 git 也行.

---

## § 3 · 三种 build profile

| Profile | 用途 | 出包 |
|---|---|---|
| `development` | 本地真机调试 (开发者菜单 + Expo Dev Client) | 模拟器 + 真机 dev build |
| `preview` | 给内测者发 ad-hoc 包 (不进 TestFlight) | iOS .ipa |
| `production` | 正式 TestFlight 提交 | iOS .ipa (App Store sign) |

跑命令:

```bash
# 本地真机调试 build (装 Expo Dev Client 之后跑 npx expo start)
eas build --profile development --platform ios

# 给一个内测者直接装 (不进 TestFlight, 走 ad-hoc)
eas build --profile preview --platform ios

# TestFlight 提交
eas build --profile production --platform ios
eas submit --profile production --platform ios --latest
```

第一次跑 build 慢 (~20 分钟), 之后 incremental 快.

---

## § 4 · API URL 切换

`eas.json` 里每个 profile 都设了 `EXPO_PUBLIC_API_URL`:

| Profile | API URL | 适用场景 |
|---|---|---|
| development | `http://192.168.1.205:8080` | 本地真机/模拟器在你家 WiFi 用内网 dev server |
| preview | `http://192.168.1.205:8080` | 内测者在你家 WiFi (内测窗口 1) |
| production | `https://api.wiseflow.example.com` | 已搬公网 VPS (见 TESTFLIGHT_PLAN § 5) |

**production 跑前必须**: 把 `api.wiseflow.example.com` 改成你的真实域名 +
后端真的部署到公网.

---

## § 5 · 证书与 Provisioning Profile

EAS 默认帮你 **托管证书**. 第一次跑 build 它会问:

```
? Do you want EAS to manage your Apple certificates and credentials? (Y/n)
```

选 **Y**. EAS 会自动:
- 申请 Distribution Certificate
- 生成 Provisioning Profile
- 链到你的 App Store Connect App ID

如果选 N, 你要手动跑 Apple Developer Portal 操作, 不推荐. 详情:
<https://docs.expo.dev/app-signing/managed-credentials/>.

证书 1 年到期, 到期前 EAS 会邮件提醒续期, 跑一次 `eas credentials` 续.

---

## § 6 · App 版本管理

`appVersionSource: "remote"` 让 EAS 服务器维护版本号. 你不用每次提交手动 bump.

`production.ios.autoIncrement: true` 让每次 production build 自动 +1 build number.
TestFlight 强制 build number 单调递增, 这条不能关.

semantic version (1.0.0, 1.1.0) 由 [app.json](app.json) 的 `expo.version` 字段管.
重大版本走 [app.json](app.json) 手动改; build number 走 EAS 自动加.

---

## § 7 · 失败排查

| 症状 | 原因 | 修 |
|---|---|---|
| `Apple ID missing` | eas.json 占位符没填 | 见 § 2 |
| Build fails on `expo-sqlite` plugin | app.json 没加 expo-sqlite plugin | 我已加, 见 app.json:37 |
| TestFlight 收到包但安装报"无法安装" | iOS 版本太老 | 把 [app.json](app.json) 加 `ios.deploymentTarget: "15.0"` 或更新 |
| 推上去后内测者看不见 | App Store Connect → TestFlight → 没加 Internal Tester 组 | 加 tester 邮箱 |
| `eas submit` 401 | App Store Connect API key 没配 | 用 `eas credentials` 重新设 |

---

## § 8 · 不要做

- ❌ 不要在 eas.json 里写 token / secret / 密码 — 入 git 就泄露
- ❌ 不要 `eas build --profile production` 然后 `eas submit` 在 Phase 1 完成之前
- ❌ 不要开 External Testing — 那是公开 beta, 违反 [GOAL § 10](../docs/GOAL/GOAL.md)
- ❌ 不要绕过 EAS 直接用 Xcode 出包 — 会丢 EAS 的版本管理, 后面 build number 冲突

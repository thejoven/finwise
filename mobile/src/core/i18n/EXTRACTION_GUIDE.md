# i18n 抽取指南（subagent 必读）

把硬编码中文 UI 文案改成 `t()` 调用，并把三门语言（简体源、繁体、英文）填进你负责的 namespace JSON。

## 框架已就绪

- i18n 核心在 `src/core/i18n/`。组件里：`import { useTranslation } from "react-i18next";` 然后 `const { t } = useTranslation();`，用 `t("ns.key")`。
- 非组件代码（store / api / 工具函数里产生面向用户文案的地方）：`import i18n from "@/core/i18n";` 然后 `i18n.t("ns.key")`。
- 你的 namespace JSON 已存在（空 `{}` 或部分填充）：`src/core/i18n/locales/{zh-Hans,zh-Hant,en}/<你的ns>.json`。**只编辑你被分配的 namespace 文件**，别碰别人的。
- 参考实现（已完成的范例）：`app/(tabs)/profile.tsx` + `src/core/i18n/locales/*/profile.json`。照它的写法。

## 硬规则

1. **只翻译面向用户的文案** —— JSX 文本、字符串字面量里会显示给用户的内容、Alert / toast / placeholder / accessibilityLabel / 按钮标题 / 导航标题。
2. **绝不翻译代码注释**（`//`、`/* */`、JSDoc）。注释保持中文原样。
3. **绝不改逻辑** —— 只换文案。不动样式、不动控制流、不重命名变量。
4. **键命名**：`<ns>.<区域>.<名字>`，小驼峰，语义化。例：`gate.verdict.passed`、`capture.empty.title`。层级用嵌套对象。
5. **三门语言必须键集完全一致**。每加一个 key，三个文件都要有。
6. **插值**：把模板串里的变量改成 i18next 插值。`` `加入于 ${date}` `` → `t("profile.joinedOn", { date })`，JSON 里 `"joinedOn": "加入于 {{date}}"`。
7. **复数（仅英文需要）**：英文计数文案用 i18next 复数后缀 `_one`/`_other`，如 `"signalCount_one": "{{count}} signal"`、`"signalCount_other": "{{count}} signals"`；中文不分复数，简体/繁体只给基础 key（写 `"signalCount": "{{count}} 条信号"`）。**若拿不准复数就别用复数机制**，直接 `"{{count}} 条信号"` / `"{{count}} signals"` 一条搞定。
8. **类型安全**：`t()` 的 key 受 TS 检查，拼错会报错。先把 key 写进 zh-Hans JSON，再在代码里用。
9. **复用 `common.*`（只读，别往里加）**：取消/完成/保存/重试/加载中/关闭/返回 等通用原子已在 `common` namespace，直接 `t("common.cancel")`。需要新通用词就加到你自己的 ns，别动 common。
10. **不确定就报告**：translation 拿不准的，照常翻一个最合理的，并在最终返回里列出来让我复核。

## 术语表（务必统一，简体 / 繁体 / English）

| 简体 | 繁体 | English |
|---|---|---|
| 财知（产品名/品牌出现处） | 財知 | AlphaX |
| 信号 | 訊號 | signal |
| 降噪 / 降噪页 | 降噪 | Distill / Distilled view |
| 投决会（原“四道门”） | 投決會 | Investment Committee（可简称 Committee） |
| 门（G1–G4 的“道门”） | 門 | gate |
| 否决 / 通过 | 否決 / 通過 | rejected / passed |
| 否决分析师 | 否決分析師 | dissenting analyst |
| 归档 | 歸檔 | Archive |
| 信箱（原“收件箱”） | 信箱 | Inbox |
| 追问 / 五轮追问 | 追問 | Socratic questioning / five rounds |
| 提炼 / 精炼 | 精煉 | refine / refinement |
| 订阅 | 訂閱 | Subscriptions |
| 推文 | 推文 | post |
| 承诺 | 承諾 | commitment |
| 复盘 | 復盤 | retrospective |
| 统计 | 統計 | Stats |
| 分类 | 分類 | category |
| 项目 | 專案 | project |
| 卷首语 | 卷首語 | Colophon |
| 观察记录 | 觀察記錄 | observations |

## 语气（YC PM 标准，必须遵守）

- **CTA 中性直接说动作**：“继续对话” / “Continue”，**不要**挑衅或抖机灵的 microcopy（“不服？”这种被否过）。
- 报刊式克制语感保留：英文文案简洁、克制、不卖弄；首字母大写按标题式（Title Case）用在按钮/标题，句子式用在说明文字。
- 繁体用台湾用字习惯（登出而非退出登录、專案而非项目、復盤）。标点用全角。
- 英文：句末标点跟随原文风格；编辑式的句点（如 "Profile."）保留。

## 交付物（你的最终返回）

1. 一句话：改了哪些源文件、加了多少 key。
2. 列出你拿不准的 translation（key + 三语 + 你的疑虑），供复核。
3. 不要跑全量 `tsc`（会看到别人半成品的报错，干扰判断）；只确保你自己的 JSON 合法、key 三语对齐、源文件 import 了 `useTranslation`/`i18n`。

/**
 * i18n 入口 —— 初始化 i18next + react-i18next 单例.
 *
 * 设计:
 *   · 资源静态打包(三门语言各一个 JSON), 不做远程加载 —— 与本仓 theme/字体一样走静态.
 *   · 初始 `lng` 用设备语言同步探测的结果(getLocales 是同步的), 故首帧即正确语言, 不闪.
 *     若用户曾手动选过语言, ./store 的 hydrate 会在启动时把它切回(异步, 在首帧后).
 *   · fallback 链: 繁体缺键回落简体再回落英文; 其余回落英文.
 *
 * 组件里用 `useTranslation()` 拿 `t` —— 语言切换时(changeLanguage)订阅方自动重渲染.
 * 非组件代码(toast / api 错误文案)可直接 `import i18n from "@/core/i18n"; i18n.t(...)`.
 */
// Hermes (RN) 不一定带 Intl.PluralRules —— i18next v4 复数解析依赖它. 这个 polyfill 必须
// 在 i18n.init() 之前加载, 否则 i18next 退回 v3 复数格式, 我们的 _one/_other key 失配.
import "intl-pluralrules";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en, zhHans, zhHant } from "./locales/resources";
import { detectDeviceLanguage } from "./languages";

void i18n.use(initReactI18next).init({
  resources: {
    "zh-Hans": { translation: zhHans },
    "zh-Hant": { translation: zhHant },
    en: { translation: en },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: {
    "zh-Hant": ["zh-Hans", "en"],
    default: ["en"],
  },
  defaultNS: "translation",
  interpolation: {
    escapeValue: false, // RN 无 XSS 风险, 关掉转义以免中文/标点被转义.
  },
  returnNull: false,
});

export default i18n;
export * from "./languages";
export { useLanguage } from "./store";

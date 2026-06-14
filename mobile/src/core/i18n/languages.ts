/**
 * 多语言 — 受支持语言、设备语言探测、偏好解析.
 *
 * 与 `@/core/theme/store` 的外观三态同构: 用户偏好有 "system"(跟随系统) 一态,
 * 解析后落到一门具体语言. 这里只放纯逻辑(无副作用), i18next 初始化见 ./index,
 * 持久化/切换见 ./store.
 */
import { getLocales } from "expo-localization";

/** 受支持的具体语言(简体为源语言). 顺序即选择器展示顺序. */
export const SUPPORTED_LANGUAGES = ["zh-Hans", "zh-Hant", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 用户偏好: "system" = 跟随手机系统语言(默认). */
export type LanguagePref = "system" | SupportedLanguage;

/**
 * 选择器里展示的语言名 —— 一律用该语言自己的写法(endonym), 不随当前 UI 语言变.
 * 这是 i18n 选择器的通行做法: 找母语的人能一眼认出自己的语言.
 */
export const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
};

/** 繁体中文的地区码 —— 没有 Hant 脚本标记时据此回落判断. */
const HANT_REGIONS = new Set(["TW", "HK", "MO"]);

function isSupported(v: unknown): v is SupportedLanguage {
  return (
    v === "zh-Hans" || v === "zh-Hant" || v === "en"
  );
}

/** 把任意 BCP-47 tag / 语言码归一到受支持语言; 无法匹配返回 null. */
export function normalizeTag(tag: string | null | undefined): SupportedLanguage | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith("zh")) {
    return /(^|-)(hant|tw|hk|mo)(-|$)/.test(t) ? "zh-Hant" : "zh-Hans";
  }
  if (t.startsWith("en")) return "en";
  return null;
}

/**
 * 读手机系统语言并归一. 按系统的语言优先级依次匹配, 第一门命中即用.
 * 都不命中(非中/英用户)时回退英文 —— 国际通用, 比强塞中文更合理.
 */
export function detectDeviceLanguage(): SupportedLanguage {
  try {
    for (const loc of getLocales()) {
      if (loc.languageCode === "zh") {
        const hant =
          loc.languageScriptCode === "Hant" ||
          (loc.regionCode != null && HANT_REGIONS.has(loc.regionCode));
        return hant ? "zh-Hant" : "zh-Hans";
      }
      if (loc.languageCode === "en") return "en";
    }
  } catch {
    // expo-localization 在极端环境(如某些测试 runtime)可能抛错 —— 落到默认.
  }
  return "en";
}

/** 把偏好解析成实际生效语言: "system" → 设备语言, 否则原样. */
export function resolveLanguage(pref: LanguagePref): SupportedLanguage {
  return pref === "system" ? detectDeviceLanguage() : pref;
}

/** 把任意存储值收敛为合法偏好(读旧数据/服务端值时的护栏). */
export function coercePref(v: unknown): LanguagePref {
  if (v === "system" || isSupported(v)) return v;
  return "system";
}

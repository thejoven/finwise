/**
 * 让 `t("a.b.c")` 的 key 受类型检查 —— 以简体(源语言)JSON 的形状为准.
 * 漏键/拼错 key 会在编译期报错; 新增文案先加到 zh-Hans.json, 类型随之更新.
 */
import "i18next";

import type { Resources } from "./locales/resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: Resources;
    };
  }
}

// 一次性脚手架生成器: 建 locales/<lang>/<ns>.json (空 {}) + 组装 resources.ts.
// 每个 namespace 一个文件 → 并行抽取时各 agent 写各自文件, 互不冲突.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "src", "core", "i18n", "locales");

const LANGS = ["zh-Hans", "zh-Hant", "en"];
const NAMESPACES = [
  "common",
  "settings",
  "profile",
  "nav",
  "errors",
  "capture",
  "caizhi",
  "refinement",
  "gate",
  "archive",
  "project",
  "subscriptions",
  "commitment",
  "retrospect",
  "attention",
  "notifications",
  "auth",
  "components",
  "track",
  "morning",
];

for (const lang of LANGS) {
  mkdirSync(join(LOCALES, lang), { recursive: true });
  for (const ns of NAMESPACES) {
    const f = join(LOCALES, lang, `${ns}.json`);
    if (!existsSync(f)) writeFileSync(f, "{}\n");
  }
}

// resources.ts —— 静态组装三门语言. agent 永不碰此文件.
const camel = (lang) => lang.replace(/-/g, "");
const lines = [];
lines.push("/* 自动生成: scripts/gen-i18n-scaffold.mjs. 各 namespace 一个 JSON, 在此组装. */");
lines.push("/* eslint-disable */");
for (const lang of LANGS) {
  for (const ns of NAMESPACES) {
    lines.push(`import ${camel(lang)}_${ns} from "./${lang}/${ns}.json";`);
  }
}
lines.push("");
for (const lang of LANGS) {
  const body = NAMESPACES.map((ns) => `  ${ns}: ${camel(lang)}_${ns},`).join("\n");
  lines.push(`export const ${camel(lang)} = {\n${body}\n};`);
}
lines.push("");
lines.push("export type Resources = typeof zhHans;");
lines.push("");
writeFileSync(join(LOCALES, "resources.ts"), lines.join("\n"));

console.log(
  `scaffold: ${LANGS.length} langs × ${NAMESPACES.length} namespaces; resources.ts written`,
);

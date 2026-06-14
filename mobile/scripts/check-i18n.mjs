// i18n 完整性检查: 所有 t("...") 字面 key 是否在三门语言都存在 + 键集对齐.
// 用法: node scripts/check-i18n.mjs   (退出码非 0 表示有问题)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LOCALES = join(ROOT, "src", "core", "i18n", "locales");
const LANGS = ["zh-Hans", "zh-Hant", "en"];
const SCAN_DIRS = ["src", "app"];

// ── 载入并合并某门语言的所有 namespace JSON ──
function loadLang(lang) {
  const dir = join(LOCALES, lang);
  const merged = {};
  for (const f of readdirSync(dir)) {
    if (extname(f) !== ".json") continue;
    const ns = f.slice(0, -5);
    merged[ns] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  }
  return merged;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// key 在 flat map 里算"存在": 精确命中, 或带复数后缀命中.
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];
function has(flat, key) {
  if (key in flat) return true;
  return PLURAL_SUFFIXES.some((s) => `${key}${s}` in flat);
}

// ── 扫描源码里的 t("...") / i18n.t("...") 字面 key ──
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".expo" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if ([".ts", ".tsx"].includes(extname(p)) && !p.endsWith(".d.ts")) files.push(p);
  }
  return files;
}

const STATIC_RE = /(?:\bi18n)?\.?\bt\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;
const DYN_RE = /\bt\(\s*`/g;

const used = new Map(); // key -> Set(file)
let dynamicCount = 0;
const dynamicFiles = new Set();

for (const base of SCAN_DIRS) {
  for (const file of walk(join(ROOT, base))) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = STATIC_RE.exec(src))) {
      const key = m[2];
      if (!key.includes(".")) continue; // 跳过没命名空间前缀的(多半不是我们的 key)
      if (/[<>${}]/.test(key)) continue; // 跳过注释里的占位示例 (如 t("nav.tabs.<route>"))
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(file.replace(ROOT + "/", ""));
    }
    const dyn = src.match(DYN_RE);
    if (dyn) {
      dynamicCount += dyn.length;
      dynamicFiles.add(file.replace(ROOT + "/", ""));
    }
  }
}

// ── 校验 ──
const flats = Object.fromEntries(LANGS.map((l) => [l, flatten(loadLang(l))]));

let problems = 0;

// 1) 用到但缺失
const missing = [];
for (const [key, files] of [...used].sort()) {
  const absent = LANGS.filter((l) => !has(flats[l], key));
  if (absent.length) {
    missing.push({ key, absent, file: [...files][0] });
    problems++;
  }
}
if (missing.length) {
  console.log(`\n❌ 用到但缺失的 key (${missing.length}):`);
  for (const { key, absent, file } of missing) {
    console.log(`   ${key}  [缺: ${absent.join(", ")}]  (${file})`);
  }
}

// 2) 键集对齐 (以 zh-Hans 为基准)
const baseKeys = new Set(Object.keys(flats["zh-Hans"]));
for (const lang of ["zh-Hant", "en"]) {
  const keys = new Set(Object.keys(flats[lang]));
  const onlyBase = [...baseKeys].filter((k) => !keys.has(k) && !PLURAL_SUFFIXES.some((s) => keys.has(k + s) || k.endsWith(s)));
  const onlyLang = [...keys].filter((k) => !baseKeys.has(k) && !PLURAL_SUFFIXES.some((s) => baseKeys.has(k + s) || k.endsWith(s)));
  if (onlyBase.length) {
    console.log(`\n⚠️  zh-Hans 有但 ${lang} 缺 (${onlyBase.length}): ${onlyBase.slice(0, 30).join(", ")}${onlyBase.length > 30 ? " …" : ""}`);
    problems++;
  }
  if (onlyLang.length) {
    console.log(`\n⚠️  ${lang} 有但 zh-Hans 缺 (${onlyLang.length}): ${onlyLang.slice(0, 30).join(", ")}${onlyLang.length > 30 ? " …" : ""}`);
    problems++;
  }
}

// 3) 定义了但没用到 (信息性, 不计 problem)
const allUsed = new Set(used.keys());
const unused = [...baseKeys].filter((k) => {
  if (allUsed.has(k)) return false;
  // 复数基 key: 若 base 用到, 不算 unused
  const stripped = PLURAL_SUFFIXES.reduce((s, suf) => (k.endsWith(suf) ? k.slice(0, -suf.length) : s), null);
  return !(stripped && allUsed.has(stripped));
});

console.log(`\n── 统计 ──`);
console.log(`   源码用到的静态 key: ${used.size}`);
console.log(`   动态 t(\`...\`) 调用: ${dynamicCount}${dynamicCount ? ` (需人工核: ${[...dynamicFiles].join(", ")})` : ""}`);
console.log(`   zh-Hans 定义 key: ${baseKeys.size}`);
console.log(`   定义但未引用: ${unused.length}${unused.length ? ` → ${unused.slice(0, 20).join(", ")}${unused.length > 20 ? " …" : ""}` : ""}`);

if (problems) {
  console.log(`\n❌ 发现 ${problems} 类问题.`);
  process.exit(1);
}
console.log(`\n✅ i18n key 校验通过.`);

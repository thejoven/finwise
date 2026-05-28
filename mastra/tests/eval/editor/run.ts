/**
 * Editor eval runner.
 *
 * Editor 必须输出 verbatim 引用. 检查项:
 *   - valid_json
 *   - quoted_segment 出现在 reasons_for_future_self 某条 (verbatim)
 *   - editor_text 含「...」引用
 *   - editor_text ≤ 200 字
 *   - no_action_words / no_market_advice
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { runEditor } from "../../../src/agents/editor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures");
const OUTPUT_DIR = join(__dirname, "eval-output");
const PASS_THRESHOLD = 4; // 6 fixtures · 4/6 算过 (Mastra 加 verbatim 校验已经在 agent 内部, 这里是再次确认)
const BANNED_PHRASES = ["建议", "目标价", "看多", "买入", "止损", "请冷静", "别焦虑", "市场有波动"];

interface Fixture {
  asset_name: string;
  opens_today: number;
  reasons_for_future_self: string[];
}

interface CheckResult { name: string; passed: boolean; detail?: string; }

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = readdirSync(FIXTURE_DIR).filter((f) => extname(f) === ".json").sort();
  if (files.length === 0) {
    console.error("no fixtures in", FIXTURE_DIR);
    process.exit(1);
  }

  console.log(`# Editor eval — ${files.length} fixtures · ${new Date().toISOString()}\n`);

  let passed = 0;
  const results: Array<{ fixture: string; passed: boolean; checks: CheckResult[]; dur_ms: number; raw?: unknown; err?: string }> = [];

  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as Fixture;
    const start = Date.now();
    let raw: { editor_text: string; quoted_segment: string } | undefined;
    let err: string | undefined;
    try {
      // eval 跑同一个 dev user, memory 会累积 — 这正是这版 RAG 的预期 (能看到上次 eval 留的痕)
      raw = await runEditor({ ...fx, user_id: "eval-user" });
      writeFileSync(join(OUTPUT_DIR, basename(f, ".json") + ".json"), JSON.stringify(raw, null, 2));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const dur_ms = Date.now() - start;
    const checks = score(fx, raw, err);
    const ok = checks.every((c) => c.passed);
    if (ok) passed++;
    results.push({ fixture: f, passed: ok, checks, dur_ms, raw, err });

    console.log(`## ${ok ? "✓" : "✗"} ${f}  (${dur_ms}ms)`);
    if (raw) console.log(`   "${raw.editor_text.slice(0, 100)}..."`);
    if (err) console.log(`   error: ${err}`);
    for (const c of checks) console.log(`  ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
    console.log();
  }

  writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
  console.log("---");
  console.log(`# Summary: ${passed}/${files.length} fixtures fully passed (threshold ≥${PASS_THRESHOLD})`);
  console.log(`Verdict: ${passed >= PASS_THRESHOLD ? "PASS" : "FAIL"}`);
  if (passed < PASS_THRESHOLD) process.exit(2);
}

function score(fx: Fixture, raw: { editor_text: string; quoted_segment: string } | undefined, err: string | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  if (!raw) {
    out.push({ name: "valid_json", passed: false, detail: err ?? "no output" });
    for (const n of ["quoted_in_reasons", "text_contains_quote", "text_length", "no_banned"]) {
      out.push({ name: n, passed: false, detail: "n/a" });
    }
    return out;
  }
  out.push({ name: "valid_json", passed: true });

  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[,，.。;;]/g, "");
  const containsVerbatim = fx.reasons_for_future_self.some((r) => norm(r).includes(norm(raw.quoted_segment)));
  out.push({ name: "quoted_in_reasons", passed: containsVerbatim, detail: containsVerbatim ? undefined : `quoted_segment "${raw.quoted_segment.slice(0, 40)}..." not in any reason` });

  const containsBracket = /「.+」/.test(raw.editor_text);
  out.push({ name: "text_contains_quote", passed: containsBracket, detail: containsBracket ? undefined : "editor_text 缺「」 引用" });

  const lenOk = raw.editor_text.length <= 200;
  out.push({ name: "text_length", passed: lenOk, detail: lenOk ? undefined : `len=${raw.editor_text.length}` });

  const found = BANNED_PHRASES.filter((w) => raw.editor_text.includes(w));
  out.push({ name: "no_banned", passed: found.length === 0, detail: found.length ? `found: ${found.join(",")}` : undefined });
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Diagnostician eval runner.
 *
 * 每个 fixture 期望落到一个特定 focus_dim. 检查:
 *   - valid_json
 *   - focus_dim 在 6 个合法值之一
 *   - focus_dim 匹配 expected (核心 — 这是 Phase 3 plan 风险 #1 的稳定性)
 *   - focus_text ≥ 20 字 ≤ 120 字
 *   - no_abstract_words (不写 "多观察" / "再思考" / "建议关注")
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { runDiagnostician } from "../../../src/agents/diagnostician.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures");
const OUTPUT_DIR = join(__dirname, "eval-output");
const PASS_THRESHOLD = 4; // 6 fixtures · 4/6 算过
const VALID_DIMS = [
  "perception_speed", "inference_depth", "decision_speed",
  "holding_patience", "exit_quality", "thesis_evolution",
];
const ABSTRACT_BANNED = ["多观察", "再思考", "建议关注", "保持耐心", "继续努力"];

interface Fixture {
  commitment_asset: string;
  commitment_thesis_summary: string;
  answers: Array<{ no: number; dim: string; question: string; choice: string; open_text?: string }>;
  expected_focus_dim: string;
}

interface CheckResult { name: string; passed: boolean; detail?: string; }

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = readdirSync(FIXTURE_DIR).filter((f) => extname(f) === ".json").sort();
  if (files.length === 0) {
    console.error("no fixtures");
    process.exit(1);
  }

  console.log(`# Diagnostician eval — ${files.length} fixtures · ${new Date().toISOString()}\n`);

  let passed = 0;
  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as Fixture;
    const start = Date.now();
    let raw: { focus_dim: string; focus_text: string } | undefined;
    let err: string | undefined;
    try {
      raw = await runDiagnostician({
        user_id: "eval-user",
        commitment_asset: fx.commitment_asset,
        commitment_thesis_summary: fx.commitment_thesis_summary,
        answers: fx.answers,
      });
      writeFileSync(join(OUTPUT_DIR, basename(f, ".json") + ".json"), JSON.stringify(raw, null, 2));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const dur = Date.now() - start;
    const checks = score(fx, raw, err);
    const ok = checks.every((c) => c.passed);
    if (ok) passed++;

    console.log(`## ${ok ? "✓" : "✗"} ${f}  (${dur}ms)`);
    if (raw) console.log(`   focus_dim=${raw.focus_dim} · "${raw.focus_text}"`);
    if (err) console.log(`   error: ${err}`);
    for (const c of checks) console.log(`  ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
    console.log();
  }

  console.log("---");
  console.log(`# Summary: ${passed}/${files.length} fixtures fully passed (threshold ≥${PASS_THRESHOLD})`);
  console.log(`Verdict: ${passed >= PASS_THRESHOLD ? "PASS" : "FAIL"}`);
  if (passed < PASS_THRESHOLD) process.exit(2);
}

function score(fx: Fixture, raw: { focus_dim: string; focus_text: string } | undefined, err: string | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  if (!raw) {
    out.push({ name: "valid_json", passed: false, detail: err ?? "no output" });
    for (const n of ["valid_dim", "matches_expected", "text_length", "no_abstract"]) {
      out.push({ name: n, passed: false, detail: "n/a" });
    }
    return out;
  }
  out.push({ name: "valid_json", passed: true });

  const validDim = VALID_DIMS.includes(raw.focus_dim);
  out.push({ name: "valid_dim", passed: validDim, detail: validDim ? undefined : `unknown: ${raw.focus_dim}` });

  const matches = raw.focus_dim === fx.expected_focus_dim;
  out.push({ name: "matches_expected", passed: matches, detail: matches ? undefined : `got ${raw.focus_dim}, want ${fx.expected_focus_dim}` });

  const lenOk = raw.focus_text.length >= 20 && raw.focus_text.length <= 120;
  out.push({ name: "text_length", passed: lenOk, detail: lenOk ? undefined : `len=${raw.focus_text.length}` });

  const found = ABSTRACT_BANNED.filter((w) => raw.focus_text.includes(w));
  out.push({ name: "no_abstract", passed: found.length === 0, detail: found.length ? `found: ${found.join(",")}` : undefined });
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });

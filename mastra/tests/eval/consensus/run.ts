/**
 * ConsensusCheck eval runner.
 *
 * 每个 fixture: { asset, signal_text, expected_score_range: [lo, hi], rationale }
 * 跑 ConsensusCheck Agent, 自动检查:
 *   - valid_json (schema 通过)
 *   - score 在 expected_score_range 内
 *   - narrative_summary ≤ 80 字
 *   - no_action_words (无"买入"/"看多"/"建议")
 *
 * 4 检查全过 = fixture 通过. 阈值 ≥ 7/10.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { runConsensusCheck } from "../../../src/agents/consensus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures");
const OUTPUT_DIR = join(__dirname, "eval-output");
const PASS_THRESHOLD = 7;
const BANNED_WORDS = ["买入", "看多", "建议关注", "目标价", "加仓", "建仓"];

interface Fixture {
  asset: string;
  signal_text: string;
  expected_score_range: [number, number];
  rationale?: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = readdirSync(FIXTURE_DIR).filter((f) => extname(f) === ".json").sort();
  if (files.length === 0) {
    console.error("no fixtures in", FIXTURE_DIR);
    process.exit(1);
  }

  console.log(`# ConsensusCheck eval — ${files.length} fixtures · ${new Date().toISOString()}\n`);

  const results: Array<{ fixture: string; checks: CheckResult[]; passed: boolean; dur_ms: number; raw?: unknown; err?: string }> = [];

  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as Fixture;
    const start = Date.now();
    let raw: { score: number; narrative_summary: string; evidence: string[] } | undefined;
    let err: string | undefined;
    try {
      raw = await runConsensusCheck({ asset: fx.asset, signal_text: fx.signal_text });
      writeFileSync(join(OUTPUT_DIR, basename(f, ".json") + ".json"), JSON.stringify(raw, null, 2));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const dur_ms = Date.now() - start;
    const checks = score(fx, raw, err);
    const passed = checks.every((c) => c.passed);
    results.push({ fixture: f, checks, passed, dur_ms, raw, err });
    printOne(f, raw, err, checks, passed, dur_ms);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const total = results.length;
  writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log("---");
  console.log(`# Summary: ${passedCount}/${total} fixtures fully passed (threshold ≥${PASS_THRESHOLD})`);
  console.log(`Verdict: ${passedCount >= PASS_THRESHOLD ? "PASS" : "FAIL"}`);
  if (passedCount < PASS_THRESHOLD) process.exit(2);
}

function score(fx: Fixture, raw: { score: number; narrative_summary: string; evidence: string[] } | undefined, err: string | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  if (!raw) {
    out.push({ name: "valid_json", passed: false, detail: err ?? "no output" });
    for (const n of ["score_in_range", "summary_length", "no_action_words"]) {
      out.push({ name: n, passed: false, detail: "n/a" });
    }
    return out;
  }
  out.push({ name: "valid_json", passed: true });

  const [lo, hi] = fx.expected_score_range;
  const inRange = raw.score >= lo && raw.score <= hi;
  out.push({
    name: "score_in_range",
    passed: inRange,
    detail: inRange ? undefined : `got ${raw.score}, want [${lo}, ${hi}]`,
  });

  const sumOk = raw.narrative_summary.length >= 1 && raw.narrative_summary.length <= 80;
  out.push({ name: "summary_length", passed: sumOk, detail: sumOk ? undefined : `length=${raw.narrative_summary.length}` });

  const hay = (raw.narrative_summary + " " + raw.evidence.join(" "));
  const found = BANNED_WORDS.filter((w) => hay.includes(w));
  out.push({ name: "no_action_words", passed: found.length === 0, detail: found.length ? `found: ${found.join(",")}` : undefined });
  return out;
}

function printOne(name: string, raw: { score: number; narrative_summary: string; evidence: string[] } | undefined, err: string | undefined, checks: CheckResult[], passed: boolean, dur_ms: number) {
  const flag = passed ? "✓" : "✗";
  console.log(`## ${flag} ${name}  (${dur_ms}ms)`);
  if (raw) console.log(`   score=${raw.score} · ${raw.narrative_summary}`);
  if (err) console.log(`   error: ${err}`);
  for (const c of checks) {
    const f = c.passed ? "  ✓" : "  ✗";
    console.log(`${f} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });

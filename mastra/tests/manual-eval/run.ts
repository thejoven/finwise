/**
 * Manual eval runner (v2).
 *
 * Loads every *.txt fixture in this directory, runs the Analyst agent on it,
 * and applies an automated rubric. Outputs:
 *   1) per-fixture JSON to eval-output/<fixture>.json (for human deep-review)
 *   2) summary table on stdout with pass/fail per check
 *   3) final "X/Y passed" judgment against the ≥7/10 threshold
 *
 * Rubric (objective checks, machine-verifiable):
 *   - valid_json: schema-validated output (zod parsed)
 *   - tags_count: 0 ≤ tags.length ≤ 5
 *   - summary_length: 1 ≤ one_line_summary.length ≤ 60
 *   - no_action_words: no "买入"/"看多"/"建议关注"/"短期"/"目标价"/"加仓" in any rationale or summary
 *   - emptiness_correct: 09-noise-too-vague should have empty related_assets; others should have ≥1
 *
 * 5 booleans/fixture, all must pass for the fixture to be "passed".
 * Threshold: ≥7/10 fixtures fully pass to consider Phase 1 LLM ready.
 *
 * Usage: cd mastra && npm run eval
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { runAnalyst } from "../../src/agents/analyst.js";
import type { Inference } from "../../src/agents/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "eval-output");

const BANNED_ACTION_WORDS = ["买入", "看多", "建议关注", "短期", "目标价", "加仓", "建仓"];
const PASS_THRESHOLD = 7;

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface FixtureResult {
  fixture: string;
  duration_ms: number;
  inference?: Inference;
  error?: string;
  checks: CheckResult[];
  passed: boolean;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = readdirSync(__dirname)
    .filter((f) => extname(f) === ".txt")
    .sort();

  if (files.length === 0) {
    console.error("no *.txt fixtures found in", __dirname);
    process.exit(1);
  }

  console.log(`# Manual eval — ${files.length} fixtures · ${new Date().toISOString()}\n`);

  const results: FixtureResult[] = [];
  for (const f of files) {
    const result = await runFixture(f);
    results.push(result);
    printFixture(result);
  }

  printSummary(results);
  writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  const passedCount = results.filter((r) => r.passed).length;
  if (passedCount < PASS_THRESHOLD) {
    process.exit(2);
  }
}

async function runFixture(f: string): Promise<FixtureResult> {
  const path = join(__dirname, f);
  const text = readFileSync(path, "utf8").trim();
  const start = Date.now();

  let inference: Inference | undefined;
  let error: string | undefined;
  try {
    inference = await runAnalyst(text);
    writeFileSync(join(OUTPUT_DIR, `${basename(f, ".txt")}.json`), JSON.stringify(inference, null, 2));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const duration_ms = Date.now() - start;
  const checks = score(f, inference, error);
  const passed = checks.every((c) => c.passed);

  return { fixture: f, duration_ms, inference, error, checks, passed };
}

function score(fixture: string, inference: Inference | undefined, error: string | undefined): CheckResult[] {
  const checks: CheckResult[] = [];

  // 1) valid_json — schema 解析通过
  if (!inference) {
    checks.push({ name: "valid_json", passed: false, detail: error ?? "no inference returned" });
    // 没数据时, 后面的检查都没意义, 全部标 false 短路
    for (const name of ["tags_count", "summary_length", "no_action_words", "emptiness_correct"]) {
      checks.push({ name, passed: false, detail: "n/a (no inference)" });
    }
    return checks;
  }
  checks.push({ name: "valid_json", passed: true });

  // 2) tags_count — schema 限 ≤5, 这里只是 sanity (schema 应该已经挡了)
  const tagsOk = inference.tags.length <= 5;
  checks.push({
    name: "tags_count",
    passed: tagsOk,
    detail: tagsOk ? undefined : `${inference.tags.length} tags > 5`,
  });

  // 3) summary_length — 严格 ≤60 字
  const sumLen = inference.one_line_summary.length;
  const sumOk = sumLen >= 1 && sumLen <= 60;
  checks.push({
    name: "summary_length",
    passed: sumOk,
    detail: sumOk ? undefined : `summary length = ${sumLen}`,
  });

  // 4) no_action_words — rationale + summary 不能出现 banned 词
  const haystack = [
    inference.one_line_summary,
    ...inference.related_assets.map((a) => a.rationale),
  ].join(" ");
  const found = BANNED_ACTION_WORDS.filter((w) => haystack.includes(w));
  checks.push({
    name: "no_action_words",
    passed: found.length === 0,
    detail: found.length === 0 ? undefined : `found: ${found.join(", ")}`,
  });

  // 5) emptiness_correct — 09-noise 应该空; 其他应该非空
  const isNoise = fixture.startsWith("09-");
  const isEmpty = inference.related_assets.length === 0;
  const emptyOk = isNoise ? isEmpty : !isEmpty;
  checks.push({
    name: "emptiness_correct",
    passed: emptyOk,
    detail: emptyOk
      ? undefined
      : isNoise
        ? "noise fixture should return empty related_assets"
        : "clear signal should return ≥1 related_assets",
  });

  return checks;
}

function printFixture(r: FixtureResult) {
  const flag = r.passed ? "✓" : "✗";
  console.log(`## ${flag} ${r.fixture}  (${r.duration_ms}ms)`);
  for (const c of r.checks) {
    const cflag = c.passed ? "  ✓" : "  ✗";
    const detail = c.detail ? `  — ${c.detail}` : "";
    console.log(`${cflag} ${c.name}${detail}`);
  }
  if (r.error) console.log(`  error: ${r.error}`);
  if (r.inference) {
    console.log(`  summary: ${r.inference.one_line_summary}`);
    console.log(
      `  layer=${r.inference.cognitive_layer} · consensus=${r.inference.consensus_check} · tags=${r.inference.tags.length} · assets=${r.inference.related_assets.length}`,
    );
  }
  console.log();
}

function printSummary(results: FixtureResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const verdict = passed >= PASS_THRESHOLD ? "PASS" : "FAIL";
  console.log("---");
  console.log(`# Summary: ${passed}/${total} fixtures fully passed (threshold ≥${PASS_THRESHOLD})`);
  console.log(`Verdict: ${verdict}`);
  console.log();

  // Per-check rollup — useful to find systematic issues
  const checkNames = Array.from(new Set(results.flatMap((r) => r.checks.map((c) => c.name))));
  console.log("Per-check pass rate:");
  for (const name of checkNames) {
    const pass = results.filter((r) => r.checks.find((c) => c.name === name)?.passed).length;
    console.log(`  ${name}: ${pass}/${total}`);
  }
  console.log();
  console.log(`Detail JSON: ${join(OUTPUT_DIR, "summary.json")}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});

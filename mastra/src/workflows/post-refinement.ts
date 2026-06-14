/**
 * post-refinement workflow · 降噪页.
 *
 * 触发: refinement.completed event (与 attention-analyze 并行, 见 iii/worker.ts 扇出).
 *
 * 两条腿各自异步跑、各 POST 一次 (partial), server 用 COALESCE 合并 —— 降噪综述
 * 先到先显示, 金融信号 (要拉实时检索, 慢) 后到再补. 对应需求里"异步给出信号".
 *   1. distiller   — 把信号 + 五轮答案降噪成一段判断 → POST distilled_content
 *   2. beneficiary — 拉 Exa 实时检索 → 收益标的信号 → POST beneficiary (+ note)
 *
 * 失败语义:
 *   - 降噪综述是降噪页主体: distiller 腿失败 → 整体 ok:false → iii 重投重试.
 *   - 金融信号是异步增强: beneficiary 生成失败也 POST 一个空数组 (沉默), 让降噪页
 *     收敛到"留白"而不是永远转圈. 只有 POST 本身失败才留 pending (靠 iii 重投).
 */

import { runDistiller, type DistillerRound } from "../agents/distiller.js";
import {
  runBeneficiary,
  type BeneficiaryTargetT,
} from "../agents/beneficiary.js";
import {
  getRefinementSession,
  postDistillation,
  type SessionView,
} from "../tools/wiseflow-api.js";
import { webSearch, type SearchResult } from "../tools/exa-search.js";
import { config } from "../config/env.js";

const MODEL = config.analyst.model;

export interface PostRefinementInput {
  refinement_id: string;
  user_id: string;
}

export interface PostRefinementResult {
  refinement_id: string;
  ok: boolean;
  /** "invalid" → 状态机异常, 不重试 */
  early?: "invalid";
  distilled?: boolean;
  beneficiary_count?: number;
  error?: string;
}

export async function runPostRefinement(
  input: PostRefinementInput,
): Promise<PostRefinementResult> {
  // Step 1: fetchState
  let view: SessionView;
  try {
    view = await getRefinementSession({
      session_id: input.refinement_id,
      user_id: input.user_id,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `fetchState: ${errMsg(err)}`,
    };
  }

  if (view.status !== "completed" || view.rounds.length < 5) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      early: "invalid",
      error: `session not completed (status=${view.status}, rounds=${view.rounds.length})`,
    };
  }

  const distillRounds: DistillerRound[] = view.rounds.map((r) => ({
    round: r.round,
    kind: r.question_kind,
    question_text: r.question_text,
    user_answer: readableAnswer(r),
    diagnosis_kind: r.diagnosis.kind,
    diagnosis_note: r.diagnosis.note,
  }));
  const roundsBrief = distillRounds
    .map((r) => `R${r.round}: ${r.user_answer}`)
    .join(" · ");

  // 两条腿独立, 各自 POST. distilled 先到先显, beneficiary 后到再补.
  let distilled = false;
  let beneficiaryCount: number | undefined;

  const distillLeg = (async () => {
    const d = await runDistiller({
      signalSummary: view.primary_signal_summary ?? "(无 summary)",
      signalRawText: view.primary_signal_raw_text,
      primaryAsset: view.primary_asset,
      projectName: view.project_name,
      projectGuidance: view.project_guidance,
      language: view.language,
      rounds: distillRounds,
    });
    await postDistillation({
      refinement_id: input.refinement_id,
      user_id: input.user_id,
      distilled_content: d.content,
      model: MODEL,
    });
    distilled = true;
  })().catch((err) =>
    logWarn("distiller leg failed", {
      refinement_id: input.refinement_id,
      err: errMsg(err),
    }),
  );

  const beneficiaryLeg = (async () => {
    let targets: BeneficiaryTargetT[] = [];
    let note = "这条信号暂时没有清晰的受益映射。";
    try {
      const research = await researchBeneficiary(view).catch(
        () => [] as SearchResult[],
      );
      const b = await runBeneficiary({
        signalSummary: view.primary_signal_summary ?? "(无 summary)",
        signalRawText: view.primary_signal_raw_text,
        primaryAsset: view.primary_asset,
        projectName: view.project_name,
        projectGuidance: view.project_guidance,
        language: view.language,
        roundsBrief,
        research,
      });
      targets = b.targets;
      note = b.note;
    } catch (err) {
      // 生成失败也落一个空数组 (沉默), 让降噪页收敛到留白, 不永远转圈.
      logWarn("beneficiary generate failed (posting silence)", {
        refinement_id: input.refinement_id,
        err: errMsg(err),
      });
    }
    await postDistillation({
      refinement_id: input.refinement_id,
      user_id: input.user_id,
      beneficiary: targets,
      beneficiary_note: note,
      model: MODEL,
    });
    beneficiaryCount = targets.length;
  })().catch((err) =>
    logWarn("beneficiary leg post failed", {
      refinement_id: input.refinement_id,
      err: errMsg(err),
    }),
  );

  await Promise.allSettled([distillLeg, beneficiaryLeg]);

  if (!distilled) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: "distiller leg failed",
      beneficiary_count: beneficiaryCount,
    };
  }
  return {
    refinement_id: input.refinement_id,
    ok: true,
    distilled: true,
    beneficiary_count: beneficiaryCount,
  };
}

/**
 * researchBeneficiary — 给 beneficiary 拉实时检索 (估值 / 催化剂 grounding).
 * 两条查询: (1) 信号 + 受益链, (2) 主资产 + 估值/财报. 都失败静默返回空.
 */
async function researchBeneficiary(view: SessionView): Promise<SearchResult[]> {
  const base = (
    view.primary_signal_raw_text ??
    view.primary_signal_summary ??
    ""
  ).trim();
  const asset = view.primary_asset?.trim();
  const queries: string[] = [];
  const chain = [asset, base, "受益 标的 产业链 supply chain beneficiaries"]
    .filter(Boolean)
    .join(" ");
  if (chain.trim()) queries.push(chain);
  if (asset)
    queries.push(`${asset} 估值 财报 指引 valuation earnings guidance`);
  if (queries.length === 0) return [];

  const batches = await Promise.all(
    queries.map((q) =>
      webSearch(q, { count: 6, freshness: "month", type: "auto" }).catch(
        () => [] as SearchResult[],
      ),
    ),
  );
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of batches.flat()) {
    if (r.url) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
    }
    out.push(r);
  }
  return out;
}

/** 把一轮的用户答案渲染成可读串 (选项 id → 选项 text; 带 open_text 补充). */
function readableAnswer(r: SessionView["rounds"][number]): string {
  const ua = r.user_answer as { choice_ids?: string[]; open_text?: string };
  const open = ua.open_text?.trim();
  const ids = ua.choice_ids ?? [];
  let chosen = "";
  if (ids.length > 0) {
    const opts = r.options;
    chosen = Array.isArray(opts)
      ? ids.map((id) => opts.find((o) => o.id === id)?.text ?? id).join(" / ")
      : ids.join(", ");
  }
  if (chosen && open) return `${chosen}; 补充: ${open}`;
  return chosen || open || "(空)";
}

function logWarn(msg: string, fields: Record<string, unknown> = {}): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg,
      ...fields,
    }),
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

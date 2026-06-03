/**
 * iii SDK worker. 接管原 NATS consumer 的活:
 *   • 4 个 queue 处理函数 — at-least-once, retry, DLQ 都 iii 管.
 *   • 5 个 HTTP shim — Go outbox POST 进来, shim 内部 enqueue 到对应队列.
 *
 * 函数命名:
 *   - 处理器: wiseflow::<name>             — queue trigger
 *   - HTTP 入口: wiseflow::http::<event>    — http trigger, 立即 enqueue 后返 202
 *
 * 队列与原 NATS subject 的映射:
 *   signal.captured       → q:signal-inference   → runSignalInference
 *   refinement.started    ┐
 *   refinement.answered   ┴→ q:refinement-step    → runRefinementStep
 *   refinement.completed  → q:attention-analyze  → runAttentionAnalyze
 *   gate.passed           → q:commitment-draft   → runCommitmentDraft
 *
 * 失败语义: queue 处理器 throw → iii 自动 retry, max_retries 配在 iii config 里.
 * 不可恢复 (schema 错) 我们也 throw — DLQ 之后人工处理. 这比原来 msg.term() 略粗,
 * 后面要更细可以判断错误类型走不同 backoff.
 */

import { registerWorker, TriggerAction, type ISdk } from "iii-sdk";

import { config } from "../config/env.js";
import {
  SignalCapturedPayload,
  RefinementStartedPayload,
  RefinementAnsweredPayload,
} from "../agents/schema.js";
import { runSignalInference } from "../workflows/signal-inference.js";
import { runRefinementStep } from "../workflows/refinement-step.js";
import { runCommitmentDraft } from "../workflows/commitment-draft.js";
import { runAttentionAnalyze } from "../workflows/attention-analyze.js";
import { runPostRefinement } from "../workflows/post-refinement.js";

import { z } from "zod";

const GatePassedPayload = z
  .object({
    evaluation_id: z.string().uuid(),
    refinement_id: z.string().uuid(),
    user_id: z.string().uuid(),
  })
  .passthrough();

const RefinementCompletedPayload = z
  .object({
    refinement_id: z.string().uuid(),
    user_id: z.string().uuid(),
  })
  .passthrough();

const QUEUES = {
  signalInference: "signal-inference",
  refinementStep: "refinement-step",
  attentionAnalyze: "attention-analyze",
  postRefinement: "post-refinement",
  commitmentDraft: "commitment-draft",
} as const;

export interface WorkerHandle {
  stop(): Promise<void>;
}

export async function startIiiWorker(): Promise<WorkerHandle> {
  const iii: ISdk = registerWorker(config.iiiUrl, {
    workerName: "wiseflow-mastra",
  });
  log("info", "iii worker connecting", { url: config.iiiUrl });

  registerProcessors(iii);
  registerHttpShims(iii);

  log("info", "iii worker ready", {
    queues: Object.values(QUEUES),
    http_paths: HTTP_PATHS.map((p) => p.path),
  });

  return {
    async stop() {
      await iii.shutdown();
    },
  };
}

// ───────────────────── Queue processors ─────────────────────

function registerProcessors(iii: ISdk): void {
  // signal.captured → signal-inference
  iii.registerFunction(
    "wiseflow::signal-inference",
    async (payload: unknown) => {
      const parsed = SignalCapturedPayload.safeParse(payload);
      if (!parsed.success) {
        log("error", "signal-inference: bad payload", {
          issues: parsed.error.issues,
        });
        throw new Error("schema invalid");
      }
      const start = Date.now();
      const result = await runSignalInference(parsed.data);
      const dur = Date.now() - start;
      if (!result.ok) {
        log("warn", "signal-inference failed", {
          signal_id: result.signal_id,
          err: result.error,
        });
        throw new Error(result.error ?? "signal-inference failed");
      }
      log("info", "signal-inference done", {
        signal_id: result.signal_id,
        dur_ms: dur,
        summary: result.summary,
      });
      return { ok: true, signal_id: result.signal_id };
    },
  );
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "wiseflow::signal-inference",
    config: { queue: QUEUES.signalInference },
  });

  // refinement.{started,answered} → refinement-step
  iii.registerFunction("wiseflow::refinement-step", async (payload: unknown) => {
    // 同时接受 started + answered, 用 union 校验.
    const parsed = RefinementStartedPayload.safeParse(payload).success
      ? RefinementStartedPayload.safeParse(payload)
      : RefinementAnsweredPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "refinement-step: bad payload", {
        issues: parsed.error.issues,
      });
      throw new Error("schema invalid");
    }
    const data = parsed.data as { refinement_id: string; user_id: string };
    const start = Date.now();
    const result = await runRefinementStep({
      refinement_id: data.refinement_id,
      user_id: data.user_id,
    });
    const dur = Date.now() - start;
    if (!result.ok) {
      // invalid 状态机 → 没法 retry, throw 后让 iii 直接进 DLQ
      log(
        result.early === "invalid" ? "error" : "warn",
        "refinement-step failed",
        {
          refinement_id: data.refinement_id,
          early: result.early,
          err: result.error,
        },
      );
      throw new Error(result.error ?? "refinement-step failed");
    }
    log("info", "refinement-step done", {
      refinement_id: data.refinement_id,
      next_round: result.next_round,
      question_id: result.question_id,
      early: result.early,
      dur_ms: dur,
    });
    return { ok: true };
  });
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "wiseflow::refinement-step",
    config: { queue: QUEUES.refinementStep },
  });

  // refinement.completed → attention-analyze
  iii.registerFunction(
    "wiseflow::attention-analyze",
    async (payload: unknown) => {
      const parsed = RefinementCompletedPayload.safeParse(payload);
      if (!parsed.success) {
        log("error", "attention-analyze: bad payload", {
          issues: parsed.error.issues,
        });
        throw new Error("schema invalid");
      }
      const start = Date.now();
      const result = await runAttentionAnalyze({
        refinement_id: parsed.data.refinement_id,
        user_id: parsed.data.user_id,
      });
      const dur = Date.now() - start;
      if (!result.ok) {
        log("warn", "attention-analyze failed", {
          refinement_id: result.refinement_id,
          early: result.early,
          err: result.error,
        });
        throw new Error(result.error ?? "attention-analyze failed");
      }
      log("info", "attention-analyze done", {
        refinement_id: result.refinement_id,
        dur_ms: dur,
        scores: result.scores,
      });
      return { ok: true };
    },
  );
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "wiseflow::attention-analyze",
    config: { queue: QUEUES.attentionAnalyze },
  });

  // refinement.completed → post-refinement (降噪页: distiller + beneficiary).
  // 与 attention-analyze 并行消费同一事件 (见 HTTP_PATHS 扇出).
  iii.registerFunction("wiseflow::post-refinement", async (payload: unknown) => {
    const parsed = RefinementCompletedPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "post-refinement: bad payload", {
        issues: parsed.error.issues,
      });
      throw new Error("schema invalid");
    }
    const start = Date.now();
    const result = await runPostRefinement({
      refinement_id: parsed.data.refinement_id,
      user_id: parsed.data.user_id,
    });
    const dur = Date.now() - start;
    if (!result.ok) {
      log(
        result.early === "invalid" ? "error" : "warn",
        "post-refinement failed",
        {
          refinement_id: result.refinement_id,
          early: result.early,
          err: result.error,
        },
      );
      throw new Error(result.error ?? "post-refinement failed");
    }
    log("info", "post-refinement done", {
      refinement_id: result.refinement_id,
      distilled: result.distilled,
      beneficiary_count: result.beneficiary_count,
      dur_ms: dur,
    });
    return { ok: true };
  });
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "wiseflow::post-refinement",
    config: { queue: QUEUES.postRefinement },
  });

  // gate.passed → commitment-draft
  iii.registerFunction(
    "wiseflow::commitment-draft",
    async (payload: unknown) => {
      const parsed = GatePassedPayload.safeParse(payload);
      if (!parsed.success) {
        log("error", "commitment-draft: bad payload", {
          issues: parsed.error.issues,
        });
        throw new Error("schema invalid");
      }
      const start = Date.now();
      const result = await runCommitmentDraft({
        evaluation_id: parsed.data.evaluation_id,
        refinement_id: parsed.data.refinement_id,
        user_id: parsed.data.user_id,
      });
      const dur = Date.now() - start;
      if (!result.ok) {
        if (result.verbatim_ok === false) {
          log("error", "narrator verbatim failed", {
            evaluation_id: result.evaluation_id,
            missing_quotes: result.missing_quotes,
          });
        }
        throw new Error(result.error ?? "commitment-draft failed");
      }
      log("info", "commitment-draft done", {
        evaluation_id: result.evaluation_id,
        commitment_id: result.commitment_id,
        dur_ms: dur,
      });
      return { ok: true };
    },
  );
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "wiseflow::commitment-draft",
    config: { queue: QUEUES.commitmentDraft },
  });
}

// ───────────────────── HTTP shims ─────────────────────

interface ShimTarget {
  queue: string;
  processorFnId: string;
}
interface HttpShim {
  path: string;
  // 一个事件可扇出到多个队列 (例 refinement.completed → attention-analyze + post-refinement).
  targets: ShimTarget[];
}

const HTTP_PATHS: HttpShim[] = [
  {
    path: "/v1/events/signal-captured",
    targets: [
      {
        queue: QUEUES.signalInference,
        processorFnId: "wiseflow::signal-inference",
      },
    ],
  },
  {
    path: "/v1/events/refinement-started",
    targets: [
      {
        queue: QUEUES.refinementStep,
        processorFnId: "wiseflow::refinement-step",
      },
    ],
  },
  {
    path: "/v1/events/refinement-answered",
    targets: [
      {
        queue: QUEUES.refinementStep,
        processorFnId: "wiseflow::refinement-step",
      },
    ],
  },
  {
    path: "/v1/events/refinement-completed",
    targets: [
      {
        queue: QUEUES.attentionAnalyze,
        processorFnId: "wiseflow::attention-analyze",
      },
      {
        queue: QUEUES.postRefinement,
        processorFnId: "wiseflow::post-refinement",
      },
    ],
  },
  {
    path: "/v1/events/gate-passed",
    targets: [
      {
        queue: QUEUES.commitmentDraft,
        processorFnId: "wiseflow::commitment-draft",
      },
    ],
  },
];

function registerHttpShims(iii: ISdk): void {
  for (const shim of HTTP_PATHS) {
    const fnId = `wiseflow::http::${slug(shim.path)}`;
    iii.registerFunction(fnId, async (req: { body: unknown }) => {
      try {
        // 扇出: 同一事件依次 enqueue 到该 path 的每个目标队列.
        for (const t of shim.targets) {
          await iii.trigger({
            function_id: t.processorFnId,
            payload: req.body,
            action: TriggerAction.Enqueue({ queue: t.queue }),
          });
        }
        return { status_code: 202, body: { accepted: true } };
      } catch (err) {
        log("error", "enqueue failed", { path: shim.path, err: String(err) });
        return { status_code: 500, body: { error: "enqueue failed" } };
      }
    });
    iii.registerTrigger({
      type: "http",
      function_id: fnId,
      config: { api_path: shim.path, http_method: "POST" },
    });
  }
}

function slug(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
}

// ───────────────────── log ─────────────────────

function log(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

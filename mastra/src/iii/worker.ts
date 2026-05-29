/**
 * iii SDK worker. 接管原 NATS consumer 的活:
 *   • 4 个 queue 处理函数 — at-least-once, retry, DLQ 都 iii 管.
 *   • 5 个 HTTP shim — Go outbox POST 进来, shim 内部 enqueue 到对应队列.
 *
 * 函数命名:
 *   - 处理器: flashfi::<name>             — queue trigger
 *   - HTTP 入口: flashfi::http::<event>    — http trigger, 立即 enqueue 后返 202
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

import { registerWorker, TriggerAction, type IiiClient } from "iii-sdk";

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
  commitmentDraft: "commitment-draft",
} as const;

export interface WorkerHandle {
  stop(): Promise<void>;
}

export async function startIiiWorker(): Promise<WorkerHandle> {
  const iii: IiiClient = registerWorker(config.iiiUrl, {
    workerName: "flashfi-mastra",
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

function registerProcessors(iii: IiiClient): void {
  // signal.captured → signal-inference
  iii.registerFunction("flashfi::signal-inference", async (payload: unknown) => {
    const parsed = SignalCapturedPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "signal-inference: bad payload", { issues: parsed.error.issues });
      throw new Error("schema invalid");
    }
    const start = Date.now();
    const result = await runSignalInference(parsed.data);
    const dur = Date.now() - start;
    if (!result.ok) {
      log("warn", "signal-inference failed", { signal_id: result.signal_id, err: result.error });
      throw new Error(result.error ?? "signal-inference failed");
    }
    log("info", "signal-inference done", { signal_id: result.signal_id, dur_ms: dur, summary: result.summary });
    return { ok: true, signal_id: result.signal_id };
  });
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "flashfi::signal-inference",
    config: { queue: QUEUES.signalInference },
  });

  // refinement.{started,answered} → refinement-step
  iii.registerFunction("flashfi::refinement-step", async (payload: unknown) => {
    // 同时接受 started + answered, 用 union 校验.
    const parsed =
      RefinementStartedPayload.safeParse(payload).success
        ? RefinementStartedPayload.safeParse(payload)
        : RefinementAnsweredPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "refinement-step: bad payload", { issues: parsed.error.issues });
      throw new Error("schema invalid");
    }
    const data = parsed.data as { refinement_id: string; user_id: string };
    const start = Date.now();
    const result = await runRefinementStep({ refinement_id: data.refinement_id, user_id: data.user_id });
    const dur = Date.now() - start;
    if (!result.ok) {
      // invalid 状态机 → 没法 retry, throw 后让 iii 直接进 DLQ
      log(result.early === "invalid" ? "error" : "warn", "refinement-step failed", {
        refinement_id: data.refinement_id,
        early: result.early,
        err: result.error,
      });
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
    function_id: "flashfi::refinement-step",
    config: { queue: QUEUES.refinementStep },
  });

  // refinement.completed → attention-analyze
  iii.registerFunction("flashfi::attention-analyze", async (payload: unknown) => {
    const parsed = RefinementCompletedPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "attention-analyze: bad payload", { issues: parsed.error.issues });
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
  });
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "flashfi::attention-analyze",
    config: { queue: QUEUES.attentionAnalyze },
  });

  // gate.passed → commitment-draft
  iii.registerFunction("flashfi::commitment-draft", async (payload: unknown) => {
    const parsed = GatePassedPayload.safeParse(payload);
    if (!parsed.success) {
      log("error", "commitment-draft: bad payload", { issues: parsed.error.issues });
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
  });
  iii.registerTrigger({
    type: "durable:subscriber",
    function_id: "flashfi::commitment-draft",
    config: { queue: QUEUES.commitmentDraft },
  });
}

// ───────────────────── HTTP shims ─────────────────────

interface HttpShim {
  path: string;
  queue: string;
  processorFnId: string;
}

const HTTP_PATHS: HttpShim[] = [
  { path: "/v1/events/signal-captured", queue: QUEUES.signalInference, processorFnId: "flashfi::signal-inference" },
  { path: "/v1/events/refinement-started", queue: QUEUES.refinementStep, processorFnId: "flashfi::refinement-step" },
  { path: "/v1/events/refinement-answered", queue: QUEUES.refinementStep, processorFnId: "flashfi::refinement-step" },
  { path: "/v1/events/refinement-completed", queue: QUEUES.attentionAnalyze, processorFnId: "flashfi::attention-analyze" },
  { path: "/v1/events/gate-passed", queue: QUEUES.commitmentDraft, processorFnId: "flashfi::commitment-draft" },
];

function registerHttpShims(iii: IiiClient): void {
  for (const shim of HTTP_PATHS) {
    const fnId = `flashfi::http::${slug(shim.path)}`;
    iii.registerFunction(fnId, async (req: { body: unknown }) => {
      try {
        await iii.trigger({
          function_id: shim.processorFnId,
          payload: req.body,
          action: TriggerAction.Enqueue({ queue: shim.queue }),
        });
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

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * NATS JetStream consumers.
 *
 * Two consumers, each with its own durable name so failures/restarts don't
 * cross-contaminate:
 *   - signal.captured       → runSignalInference (M2)
 *   - refinement.started + refinement.answered → runRefinementStep (M5)
 *
 * Hard rules (from M2 task spec):
 *   - durable name set, so consumer survives restart
 *   - manualAck — never auto-ack
 *   - failed runs use nak() (redeliver) up to MAX_DELIVER times; after that, log + term
 *     so the queue doesn't poison-loop. Phase 1 DLQ = log only.
 */

import {
  connect,
  consumerOpts,
  createInbox,
  JSONCodec,
  type ConsumerOptsBuilder,
  type JetStreamClient,
  type JetStreamSubscription,
  type NatsConnection,
} from "nats";

import { z } from "zod";

import { config } from "../config/env.js";
import {
  SignalCapturedPayload,
  RefinementStartedPayload,
  RefinementAnsweredPayload,
} from "../agents/schema.js";
import { runSignalInference } from "../workflows/signal-inference.js";
import { runRefinementStep } from "../workflows/refinement-step.js";
import { runCommitmentDraft } from "../workflows/commitment-draft.js";

// gate.passed payload 是 Go 的 GateEvaluatedPayload, 我们只 care 三个 id.
const GatePassedPayload = z.object({
  evaluation_id: z.string().uuid(),
  refinement_id: z.string().uuid(),
  user_id: z.string().uuid(),
}).passthrough();

const codec = JSONCodec();
const MAX_DELIVER = 3;
const ACK_WAIT_MS = 60_000;

export interface ConsumerHandle {
  stop(): Promise<void>;
}

export async function startConsumers(): Promise<ConsumerHandle> {
  const nc: NatsConnection = await connect({
    servers: config.natsUrl,
    name: "flashfi-mastra",
    reconnectTimeWait: 2000,
    maxReconnectAttempts: -1,
  });
  log("info", "nats connected", { url: config.natsUrl });

  const js: JetStreamClient = nc.jetstream();

  // M2 · signal.captured
  const signalSub = await subscribeSignal(js);

  // M5 · refinement.started + refinement.answered (两个独立 durable, 各自 maxDeliver/ackWait)
  const refinementStartedSub = await subscribeRefinement(js, "refinement.started", "mastra-refinement-started");
  const refinementAnsweredSub = await subscribeRefinement(js, "refinement.answered", "mastra-refinement-answered");

  // M7 · gate.passed → Narrator workflow
  const gatePassedSub = await subscribeGatePassed(js);

  return {
    async stop() {
      await signalSub.drain();
      await refinementStartedSub.drain();
      await refinementAnsweredSub.drain();
      await gatePassedSub.drain();
      await nc.drain();
    },
  };
}

// Phase 1 兼容: 老代码可能 import startSignalConsumer. 保留别名.
export const startSignalConsumer = startConsumers;

// ─────────────────────────── signal.captured ───────────────────────────

async function subscribeSignal(js: JetStreamClient): Promise<JetStreamSubscription> {
  const opts: ConsumerOptsBuilder = consumerOpts();
  opts.durable("mastra-signal-inference");
  opts.manualAck();
  opts.ackExplicit();
  opts.deliverNew();
  opts.deliverTo(createInbox()); // 显式 deliver subject — nats-server 2.10+ 要求
  opts.maxDeliver(MAX_DELIVER);
  opts.ackWait(ACK_WAIT_MS);

  const sub = await js.subscribe("signal.captured", opts);
  log("info", "subscribed", { subject: "signal.captured", durable: "mastra-signal-inference" });

  (async () => {
    for await (const msg of sub) {
      const deliveries = msg.info.redeliveryCount + 1;
      let raw: unknown;
      try {
        raw = codec.decode(msg.data);
      } catch (err) {
        log("error", "decode failed", { subject: "signal.captured", err: String(err) });
        msg.term();
        continue;
      }
      const parsed = SignalCapturedPayload.safeParse(raw);
      if (!parsed.success) {
        log("error", "payload schema invalid", { subject: "signal.captured", issues: parsed.error.issues });
        msg.term();
        continue;
      }

      const start = Date.now();
      const result = await runSignalInference(parsed.data);
      const dur = Date.now() - start;

      if (result.ok) {
        log("info", "inference done", { signal_id: result.signal_id, dur_ms: dur, summary: result.summary });
        msg.ack();
        continue;
      }

      log("warn", "inference failed", { signal_id: result.signal_id, deliveries, err: result.error });
      if (deliveries >= MAX_DELIVER) {
        log("error", "DLQ (max retries)", { signal_id: result.signal_id, err: result.error });
        msg.term();
        continue;
      }
      msg.nak();
    }
  })();

  return sub;
}

// ─────────────────────────── refinement.* ───────────────────────────

async function subscribeRefinement(
  js: JetStreamClient,
  subject: "refinement.started" | "refinement.answered",
  durable: string,
): Promise<JetStreamSubscription> {
  const opts: ConsumerOptsBuilder = consumerOpts();
  opts.durable(durable);
  opts.manualAck();
  opts.ackExplicit();
  opts.deliverNew();
  opts.deliverTo(createInbox());
  opts.maxDeliver(MAX_DELIVER);
  opts.ackWait(ACK_WAIT_MS);

  const sub = await js.subscribe(subject, opts);
  log("info", "subscribed", { subject, durable });

  (async () => {
    for await (const msg of sub) {
      const deliveries = msg.info.redeliveryCount + 1;
      let raw: unknown;
      try {
        raw = codec.decode(msg.data);
      } catch (err) {
        log("error", "decode failed", { subject, err: String(err) });
        msg.term();
        continue;
      }

      const validator = subject === "refinement.started"
        ? RefinementStartedPayload
        : RefinementAnsweredPayload;
      const parsed = validator.safeParse(raw);
      if (!parsed.success) {
        log("error", "payload schema invalid", { subject, issues: parsed.error.issues });
        msg.term();
        continue;
      }

      const refinementId = (parsed.data as { refinement_id: string }).refinement_id;
      const userId = (parsed.data as { user_id: string }).user_id;

      const start = Date.now();
      const result = await runRefinementStep({ refinement_id: refinementId, user_id: userId });
      const dur = Date.now() - start;

      if (result.ok) {
        log("info", "refinement step done", {
          subject,
          refinement_id: refinementId,
          next_round: result.next_round,
          question_id: result.question_id,
          early: result.early,
          dur_ms: dur,
        });
        msg.ack();
        continue;
      }

      if (result.early === "invalid") {
        // 不重试; 状态机已经坏了, redeliver 也不会修.
        log("error", "refinement step invalid state, terminating", {
          subject,
          refinement_id: refinementId,
          err: result.error,
        });
        msg.term();
        continue;
      }

      log("warn", "refinement step failed", { subject, refinement_id: refinementId, deliveries, err: result.error });
      if (deliveries >= MAX_DELIVER) {
        log("error", "DLQ (max retries)", { subject, refinement_id: refinementId, err: result.error });
        msg.term();
        continue;
      }
      msg.nak();
    }
  })();

  return sub;
}

// ─────────────────────────── gate.passed ───────────────────────────

async function subscribeGatePassed(js: JetStreamClient): Promise<JetStreamSubscription> {
  const opts: ConsumerOptsBuilder = consumerOpts();
  opts.durable("mastra-narrator");
  opts.manualAck();
  opts.ackExplicit();
  opts.deliverNew();
  opts.deliverTo(createInbox());
  opts.maxDeliver(MAX_DELIVER);
  opts.ackWait(120_000); // Narrator + verbatim check 可能 30-60s

  const sub = await js.subscribe("gate.passed", opts);
  log("info", "subscribed", { subject: "gate.passed", durable: "mastra-narrator" });

  (async () => {
    for await (const msg of sub) {
      const deliveries = msg.info.redeliveryCount + 1;
      let raw: unknown;
      try {
        raw = codec.decode(msg.data);
      } catch (err) {
        log("error", "decode failed", { subject: "gate.passed", err: String(err) });
        msg.term();
        continue;
      }
      const parsed = GatePassedPayload.safeParse(raw);
      if (!parsed.success) {
        log("error", "payload schema invalid", { subject: "gate.passed", issues: parsed.error.issues });
        msg.term();
        continue;
      }

      const start = Date.now();
      const result = await runCommitmentDraft({
        evaluation_id: parsed.data.evaluation_id,
        refinement_id: parsed.data.refinement_id,
        user_id: parsed.data.user_id,
      });
      const dur = Date.now() - start;

      if (result.ok) {
        log("info", "commitment drafted", {
          evaluation_id: result.evaluation_id,
          commitment_id: result.commitment_id,
          dur_ms: dur,
        });
        msg.ack();
        continue;
      }

      // verbatim 失败专门记 (运维要看)
      if (result.verbatim_ok === false) {
        log("error", "narrator verbatim failed", {
          evaluation_id: result.evaluation_id,
          missing_quotes: result.missing_quotes,
          deliveries,
        });
      } else {
        log("warn", "commitment draft failed", {
          evaluation_id: result.evaluation_id,
          err: result.error,
          deliveries,
        });
      }
      if (deliveries >= MAX_DELIVER) {
        log("error", "DLQ (max retries)", { evaluation_id: result.evaluation_id, err: result.error });
        msg.term();
        continue;
      }
      msg.nak();
    }
  })();

  return sub;
}

// ─────────────────────────── log ───────────────────────────

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

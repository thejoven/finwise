/**
 * Mastra HTTP 服务 · Go 同步调 Mastra Agents 用.
 *
 * 端点:
 *   - POST /consensus-check         (M6 G2 反共识打分)
 *   - POST /editor                  (M9 焦虑日陪伴文字)
 *   - POST /diagnostician           (M11 复盘 focus)
 *   - GET  /healthz                 (探活)
 *
 * 认证: X-Internal-Token 必须匹配 INTERNAL_TOKEN env. 与 Go server 共用.
 *
 * 不做的事:
 *   - HTTPS (内网 / loopback, 由部署侧 reverse proxy 兜)
 *   - rate limit (单用户 + 内网, Phase 2 不需要)
 *   - 请求 ID / 详细访问日志 (启动时 log + 出错时 log 就够)
 */

import http from "node:http";

import { config } from "../config/env.js";
import { runConsensusCheck } from "../agents/consensus.js";
import { runEditor } from "../agents/editor.js";
import { runDiagnostician } from "../agents/diagnostician.js";
import { runThicknessJudge } from "../agents/thickness.js";

export interface HttpHandle {
  stop(): Promise<void>;
}

export async function startHttpServer(): Promise<HttpHandle> {
  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      writeJSON(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http.port, config.http.bind, () => {
      log("info", "http listening", { bind: config.http.bind, port: config.http.port });
      resolve();
    });
  });

  return {
    async stop() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "";

  if (req.method === "GET" && url === "/healthz") {
    writeJSON(res, 200, { status: "ok" });
    return;
  }

  // 所有其他端点需要 internal token
  const got = req.headers["x-internal-token"];
  if (!got || got !== config.internalToken) {
    writeJSON(res, 401, { error: "bad internal token" });
    return;
  }

  if (req.method !== "POST") {
    writeJSON(res, 405, { error: "method not allowed" });
    return;
  }

  const body = await readBody(req);

  if (url === "/consensus-check") {
    const input = body as { asset: string; signal_text: string };
    if (!input.asset || !input.signal_text) {
      writeJSON(res, 400, { error: "asset and signal_text required" });
      return;
    }
    const start = Date.now();
    try {
      const result = await runConsensusCheck(input);
      log("info", "consensus done", { asset: input.asset, score: result.score, dur_ms: Date.now() - start });
      writeJSON(res, 200, result);
    } catch (err) {
      log("warn", "consensus failed", { asset: input.asset, err: String(err) });
      writeJSON(res, 502, { error: String(err) });
    }
    return;
  }

  if (url === "/editor") {
    const input = body as {
      user_id: string;
      asset_name: string;
      opens_today: number;
      reasons_for_future_self: string[];
    };
    if (!input.user_id || !input.asset_name || !Array.isArray(input.reasons_for_future_self) || input.reasons_for_future_self.length === 0) {
      writeJSON(res, 400, { error: "user_id + asset_name + reasons_for_future_self (non-empty) required" });
      return;
    }
    const start = Date.now();
    try {
      const result = await runEditor(input);
      log("info", "editor done", { user_id: input.user_id, asset: input.asset_name, opens: input.opens_today, dur_ms: Date.now() - start });
      writeJSON(res, 200, result);
    } catch (err) {
      log("warn", "editor failed", { asset: input.asset_name, err: String(err) });
      writeJSON(res, 502, { error: String(err) });
    }
    return;
  }

  if (url === "/thickness-check") {
    const input = body as {
      user_id: string;
      signal_id: string;
      raw_text: string;
      summary: string;
      tags: string[];
    };
    if (!input.user_id || !input.signal_id || !input.raw_text || !input.summary) {
      writeJSON(res, 400, { error: "user_id + signal_id + raw_text + summary required" });
      return;
    }
    const start = Date.now();
    try {
      const result = await runThicknessJudge({
        user_id: input.user_id,
        signal_id: input.signal_id,
        raw_text: input.raw_text,
        summary: input.summary,
        tags: input.tags ?? [],
      });
      log("info", "thickness done", {
        signal_id: input.signal_id,
        pass: result.pass,
        score: result.score,
        dur_ms: Date.now() - start,
      });
      writeJSON(res, 200, result);
    } catch (err) {
      log("warn", "thickness failed", { signal_id: input.signal_id, err: String(err) });
      writeJSON(res, 502, { error: String(err) });
    }
    return;
  }

  if (url === "/diagnostician") {
    const input = body as {
      user_id: string;
      commitment_asset: string;
      commitment_thesis_summary: string;
      answers: Array<{ no: number; dim: string; question: string; choice: string; open_text?: string }>;
    };
    if (!input.user_id || !input.commitment_asset || !Array.isArray(input.answers) || input.answers.length !== 4) {
      writeJSON(res, 400, { error: "user_id + commitment_asset + answers (length 4) required" });
      return;
    }
    const start = Date.now();
    try {
      const result = await runDiagnostician(input);
      log("info", "diagnostician done", {
        user_id: input.user_id,
        asset: input.commitment_asset,
        focus_dim: result.focus_dim,
        dur_ms: Date.now() - start,
      });
      writeJSON(res, 200, result);
    } catch (err) {
      log("warn", "diagnostician failed", { asset: input.commitment_asset, err: String(err) });
      writeJSON(res, 502, { error: String(err) });
    }
    return;
  }

  writeJSON(res, 404, { error: "not found" });
}

function writeJSON(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json).toString(),
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("invalid json: " + (err instanceof Error ? err.message : String(err))));
      }
    });
    req.on("error", reject);
  });
}

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), level, msg, src: "mastra-http", ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

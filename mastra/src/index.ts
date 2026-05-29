/**
 * Mastra worker entrypoint.
 * 同时跑两件事:
 *   1. iii SDK worker (queue 处理器 + HTTP shim) — 替换了原来的 NATS consumer.
 *   2. HTTP 服务 (Go 同步调 ConsensusCheck / Editor / Diagnostician).
 *
 * Graceful shutdown on SIGINT/SIGTERM.
 */

import { startIiiWorker } from "./iii/worker.js";
import { startHttpServer } from "./server/http.js";

async function main() {
  const [iiiHandle, httpHandle] = await Promise.all([
    startIiiWorker(),
    startHttpServer(),
  ]);

  const shutdown = async (sig: string) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "shutdown", signal: sig }));
    try {
      await Promise.all([iiiHandle.stop(), httpHandle.stop()]);
      process.exit(0);
    } catch (err) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "shutdown error", err: String(err) }));
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "fatal", err: String(err) }));
  process.exit(1);
});

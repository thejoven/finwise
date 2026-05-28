/**
 * Mastra worker entrypoint.
 * 同时跑两件事:
 *   1. NATS consumer (signal.captured / refinement.* / gate.passed)
 *   2. HTTP 服务 (Go 同步调 ConsensusCheck / Editor / Diagnostician)
 *
 * Graceful shutdown on SIGINT/SIGTERM.
 */

import { startConsumers } from "./consumers/nats.js";
import { startHttpServer } from "./server/http.js";

async function main() {
  const [consumer, httpHandle] = await Promise.all([
    startConsumers(),
    startHttpServer(),
  ]);

  const shutdown = async (sig: string) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "shutdown", signal: sig }));
    try {
      await Promise.all([consumer.stop(), httpHandle.stop()]);
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

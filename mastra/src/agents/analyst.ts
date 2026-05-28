/**
 * Analyst Agent · Flashfi Engine 的"推演员".
 *
 * **prompt 已搬到 skills/analyst/** — 本文件保留为薄 facade, 仅 re-export.
 * 这样 import 路径 `agents/analyst.js` 的现有调用方 (workflow / manual-eval)
 * 不破坏, 同时新代码可直接 import `skills/analyst/index.js`.
 *
 * 想加例子 / 改约束: 看 mastra/src/skills/analyst/README.md.
 */

export { analyst, runAnalyst } from "../skills/analyst/index.js";

import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Local `npm run dev` proxies API calls to the dev server so the admin can use
// relative paths everywhere (matches the production nginx layout).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_API_TARGET || "http://192.168.1.205:8080";
  const proxy = {
    "/v1": { target, changeOrigin: true },
    "/healthz": { target, changeOrigin: true },
    "/metrics": { target, changeOrigin: true },
  };
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy,
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      proxy,
    },
  };
});

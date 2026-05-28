/**
 * Single ky instance for the whole app.
 *
 * Bearer 来源优先级:
 *   1) auth store 里登录拿到的 session token
 *   2) EXPO_PUBLIC_DEV_BEARER_TOKEN (dev/调试 fallback, 单用户兼容)
 *
 * 没登录 + 没 dev token → 不附加 header, server 401, 客户端 auth gate 跳 /login.
 */

import ky from "ky";

import { getStoredToken } from "@/core/auth/store";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const envBearer = process.env.EXPO_PUBLIC_DEV_BEARER_TOKEN ?? "";

export const api = ky.create({
  prefixUrl: baseUrl,
  timeout: 15_000,
  retry: {
    limit: 2,
    methods: ["get", "post"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeRequest: [
      (request) => {
        const tok = getStoredToken() ?? envBearer;
        if (tok) {
          request.headers.set("Authorization", `Bearer ${tok}`);
        }
      },
    ],
  },
});

/**
 * Helper for unauthenticated probes + auth/login/register.
 */
export const apiAnon = ky.create({
  prefixUrl: baseUrl,
  timeout: 5_000,
  retry: 0,
});

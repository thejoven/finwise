/**
 * Single ky instance for the whole app.
 *
 * Bearer 来源优先级:
 *   1) auth store 里登录拿到的 session token
 *   2) dev bearer — 仅当 EXPO_PUBLIC_DEV_AUTOLOGIN 显式打开 (默认关闭,
 *      见 @/core/auth/devBearer)
 *
 * 没登录 + 没开 dev autologin → 不附加 header, server 401, auth gate 跳 /login.
 */

import ky from "ky";

import { getStoredToken } from "@/core/auth/store";
import { getDevBearer } from "@/core/auth/devBearer";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * 把后端相对路径 (如 /v1/avatars/<id>?sig=..) 拼成绝对 URL, 供 <Image source={{uri}}> 用.
 * 已是绝对 URL 则原样返回. baseUrl 末尾斜杠归一.
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const b = baseUrl.replace(/\/+$/, "");
  return path.startsWith("/") ? `${b}${path}` : `${b}/${path}`;
}

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
        const tok = getStoredToken() ?? getDevBearer();
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

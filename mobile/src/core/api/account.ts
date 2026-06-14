/**
 * /v1/auth/* + /v1/me 的 typed wrapper.
 *
 * 注册/登录路径用 apiAnon (不带 Authorization), 其他走 api (带 bearer).
 */

import { z } from "zod";

import { api, apiAnon } from "./client";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  created_at: z.string(),
});
export type UserDTO = z.infer<typeof UserSchema>;

const SessionSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});
export type SessionDTO = z.infer<typeof SessionSchema>;

const AuthResponseSchema = z.object({
  user: UserSchema,
  session: SessionSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ────── register ──────

export interface RegisterInput {
  email: string;
  password: string;
  display_name?: string | null;
  invite_code: string;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const json = await apiAnon.post("v1/auth/register", { json: input }).json();
  return AuthResponseSchema.parse(json);
}

// ────── login ──────

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const json = await apiAnon.post("v1/auth/login", { json: input }).json();
  return AuthResponseSchema.parse(json);
}

// ────── logout ──────

export async function logout(): Promise<void> {
  // 204 No Content — 别 .json(), 直接消费 response 让它关闭.
  await api.post("v1/auth/logout");
}

// ────── me ──────

export async function getMe(): Promise<UserDTO> {
  const json = await api.get("v1/me").json();
  return UserSchema.parse(json);
}

export interface UpdateMeInput {
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
}

export async function updateMe(input: UpdateMeInput): Promise<UserDTO> {
  const json = await api.patch("v1/me", { json: input }).json();
  return UserSchema.parse(json);
}

/**
 * 单独推送语言偏好 —— 与 updateMe 分开, 因为它不是用户在"编辑资料"里改的,
 * 而是切语言时静默同步(见 @/core/i18n/sync). 走同一个 PATCH /v1/me.
 */
export async function updateLanguage(language: string): Promise<void> {
  await api.patch("v1/me", { json: { language } });
}

export interface ChangePasswordInput {
  old_password: string;
  new_password: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await api.post("v1/me/password", { json: input });
}

/**
 * 解析后端错误返回 (统一格式: {"error": "..."}).
 * ky 把非 2xx 当 HTTPError 抛, 这个 helper 把 message 提出来给 UI.
 */
export async function readErrorMessage(err: unknown): Promise<string> {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: Response }).response;
    if (response) {
      try {
        const body = (await response.clone().json()) as { error?: string };
        if (body?.error) return body.error;
      } catch {
        // 不是 JSON, 走 fallback
      }
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

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
  // avatar_url 不在此 — 头像走 /v1/me/avatar/* 上传链路 (见下), DTO 的 avatar_url 由后端现签.
}

export async function updateMe(input: UpdateMeInput): Promise<UserDTO> {
  const json = await api.patch("v1/me", { json: input }).json();
  return UserSchema.parse(json);
}

// ────── avatar (预签名直传 R2 + 后端签名 URL 私有读) ──────

const AvatarUploadURLSchema = z.object({
  upload_url: z.string(),
  method: z.string(),
  expires_at: z.string(),
});
export type AvatarUploadURL = z.infer<typeof AvatarUploadURLSchema>;

/** 取预签名 PUT URL (客户端直传 R2). 未配置存储 → 503. */
export async function requestAvatarUploadUrl(): Promise<AvatarUploadURL> {
  const json = await api.post("v1/me/avatar/upload-url").json();
  return AvatarUploadURLSchema.parse(json);
}

/**
 * 把本地图片直传到预签名 URL —— 绕过后端用裸 fetch (目标是 R2 直链, 不能带 bearer/prefixUrl).
 * RN 把本地 file:// 先读成 blob 再 PUT; Content-Type 须与后端 confirm 校验白名单一致.
 */
export async function putAvatarBytes(
  uploadUrl: string,
  localUri: string,
  contentType: string,
): Promise<void> {
  const fileRes = await fetch(localUri);
  const blob = await fileRes.blob();
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`avatar upload failed: ${res.status}`);
  }
}

/** 直传完成后让后端校验 (大小/类型) 并落库, 返回更新后的用户 (含现签 avatar_url). */
export async function confirmAvatar(): Promise<UserDTO> {
  const json = await api.post("v1/me/avatar/confirm").json();
  return UserSchema.parse(json);
}

/** 移除头像. */
export async function removeAvatar(): Promise<UserDTO> {
  const json = await api.delete("v1/me/avatar").json();
  return UserSchema.parse(json);
}

/**
 * 单独推送语言偏好 —— 与 updateMe 分开, 因为它不是用户在"编辑资料"里改的,
 * 而是切语言时静默同步(见 @/core/i18n/sync). 走同一个 PATCH /v1/me.
 */
export async function updateLanguage(language: string): Promise<void> {
  await api.patch("v1/me", { json: { language } });
}

// ────── stats (个人资料页) ──────

const StatsMetricsSchema = z.object({
  signals_total: z.number(),
  signals_matured: z.number(),
  gate_total: z.number(),
  gate_passed: z.number(),
  projects: z.number(),
  active_days: z.number(),
  current_streak: z.number(),
  longest_streak: z.number(),
  joined_days: z.number(),
});

const StatsDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD (Asia/Shanghai)
  count: z.number(),
});

const StatsSchema = z.object({
  metrics: StatsMetricsSchema,
  start: z.string(), // 点阵图窗口起始日 (含)
  end: z.string(), // 今天 (含)
  days: z.array(StatsDaySchema), // 稀疏: 只含有活动的日, 升序
});
export type StatsDTO = z.infer<typeof StatsSchema>;
export type StatsMetricsDTO = z.infer<typeof StatsMetricsSchema>;
export type StatsDayDTO = z.infer<typeof StatsDaySchema>;

/** 拉个人资料页的汇总指标 + 一年活动点阵. */
export async function getMyStats(): Promise<StatsDTO> {
  const json = await api.get("v1/me/stats").json();
  return StatsSchema.parse(json);
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

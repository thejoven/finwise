/**
 * Auth store — 当前登录用户 + session token.
 *
 * 设计:
 *   - token 是 server 签发的 opaque 32-byte URL-safe random (或 dev bearer 兼容).
 *     落 SecureStore (keychain on iOS, EncryptedSharedPreferences on Android),
 *     不进 AsyncStorage — 它是明文.
 *   - user 落 SecureStore 同一个 record (JSON), 启动 hydrate 一次.
 *   - 调 client.ts 时通过 getToken() 拿 — 不直接读 process.env. 这样 dev/prod
 *     都走同一条路径, 测试可以 mock store.
 *   - dev 兼容: 没登录但 env 有 EXPO_PUBLIC_DEV_BEARER_TOKEN → 当 fallback 用
 *     (auth gate 不强制跳 login). 留这个口子主要给 web-admin / 内部调试.
 *
 * 不持久化的状态 (hydrated 标志) 用 in-memory zustand 就行.
 */

import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "wiseflow.auth.v1";

export interface AuthUser {
  id: string;
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  created_at: string;
}

interface AuthRecord {
  token: string;
  expires_at: string;
  user: AuthUser;
}

interface AuthState {
  hydrated: boolean;
  token: string | null;
  expiresAt: string | null;
  user: AuthUser | null;

  hydrate: () => Promise<void>;
  setSession: (record: AuthRecord) => Promise<void>;
  setUser: (user: AuthUser) => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  hydrated: false,
  token: null,
  expiresAt: null,
  user: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) {
        const rec = JSON.parse(raw) as AuthRecord;
        // 过期就当没 hydrate 上 — clear 它.
        if (rec.expires_at && new Date(rec.expires_at).getTime() > Date.now()) {
          set({ token: rec.token, expiresAt: rec.expires_at, user: rec.user, hydrated: true });
          return;
        }
        await SecureStore.deleteItemAsync(STORAGE_KEY);
      }
    } catch (err) {
      console.warn("[auth] hydrate failed:", err);
    }
    set({ hydrated: true });
  },

  setSession: async (record) => {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
    set({
      token: record.token,
      expiresAt: record.expires_at,
      user: record.user,
      hydrated: true,
    });
  },

  setUser: async (user) => {
    const { token, expiresAt } = get();
    if (token && expiresAt) {
      const next: AuthRecord = { token, expires_at: expiresAt, user };
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
    }
    set({ user });
  },

  clear: async () => {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {
      // 不存在也无所谓
    }
    set({ token: null, expiresAt: null, user: null });
  },
}));

/**
 * Token 静态访问器 — client.ts 的 beforeRequest hook 用. 不能用 useAuth() 因为
 * 那是 hook, hook 只能在组件内调.
 */
export function getStoredToken(): string | null {
  return useAuth.getState().token;
}

// Thin fetch wrapper around the flashfi Go API.
// All v1 calls send "Authorization: Bearer <token>".
// Token is held in localStorage and read fresh on every call so a token
// rotation in Settings takes effect immediately.

const TOKEN_KEY = "flashfi.admin.token";
const BASE_KEY = "flashfi.admin.base";

export function getApiBase(): string {
  const stored = localStorage.getItem(BASE_KEY);
  if (stored !== null) return stored.replace(/\/+$/, "");
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  // Empty = relative — assume an nginx/vite proxy forwards /v1, /healthz, /metrics.
  return (fromEnv ?? "").replace(/\/+$/, "");
}

export function setApiBase(base: string) {
  localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ""));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOpts {
  method?: Method;
  body?: unknown;
  // pass true to skip Authorization header (e.g. /healthz, /metrics)
  noAuth?: boolean;
  // pass true to read as text instead of JSON
  asText?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const base = getApiBase();
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (!opts.noAuth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (opts.asText) {
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, `${res.status} ${res.statusText}`, text);
    }
    return text as unknown as T;
  }

  if (res.status === 204) {
    return null as unknown as T;
  }

  let parsed: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    parsed = await res.json().catch(() => null);
  } else {
    parsed = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null) ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, parsed);
  }
  return parsed as T;
}

// ---------- typed helpers per module ----------

export interface SignalRow {
  id: string;
  user_id: string;
  raw_text: string;
  captured_at: string;
  inference_status: "pending" | "done" | "failed";
  inference_summary?: string | null;
  inference_tags?: string[] | null;
  inference_model?: string | null;
  inference_done_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommitmentRow {
  id: string;
  user_id: string;
  status: string;
  ticker?: string;
  thesis?: string;
  signed_at?: string | null;
  postponed_until?: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

export interface HoldingRow {
  id: string;
  user_id: string;
  ticker?: string;
  status?: string;
  opened_at?: string;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

export interface RetrospectRow {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  finalized_at?: string | null;
  [k: string]: unknown;
}

export interface RefinementRow {
  id: string;
  signal_id?: string;
  status: string;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

export interface GateEvaluation {
  id: string;
  status?: string;
  pool?: string;
  [k: string]: unknown;
}

export interface SignalListResponse {
  signals: SignalRow[];
  has_more: boolean;
}

export const flashfi = {
  health: () => api<{ status: string; db?: string }>("/healthz", { noAuth: true }),
  metrics: () =>
    api<string>("/metrics", { noAuth: true, asText: true }),

  signals: {
    list: () => api<SignalListResponse>("/v1/signals"),
    get: (id: string) => api<SignalRow>(`/v1/signals/${id}`),
    capture: (raw_text: string, client_event_id: string) =>
      api<{ id?: string; signal_id?: string }>("/v1/signals", {
        method: "POST",
        body: { client_event_id, raw_text },
      }),
  },

  // /v1/commitments/active and /v1/holdings/active return a SINGLE row or 204.
  // The 204 path resolves to null via api().
  commitments: {
    active: () => api<CommitmentRow | null>("/v1/commitments/active"),
    get: (id: string) => api<CommitmentRow>(`/v1/commitments/${id}`),
    sign: (id: string) =>
      api<CommitmentRow>(`/v1/commitments/${id}/sign`, { method: "POST" }),
    postpone: (id: string, until: string) =>
      api<CommitmentRow>(`/v1/commitments/${id}/postpone`, {
        method: "POST",
        body: { postponed_until: until },
      }),
  },

  holdings: {
    active: () => api<HoldingRow | null>("/v1/holdings/active"),
    get: (id: string) => api<HoldingRow>(`/v1/holdings/${id}`),
  },

  retrospects: {
    list: () =>
      api<{ retrospects: RetrospectRow[] }>("/v1/retrospects"),
    get: (id: string) => api<RetrospectRow>(`/v1/retrospects/${id}`),
  },

  refinement: {
    bySignal: (signalId: string) =>
      api<RefinementRow>(`/v1/refinement/sessions/by-signal/${signalId}`),
    get: (id: string) => api<RefinementRow>(`/v1/refinement/sessions/${id}`),
    start: (signal_id: string) =>
      api<RefinementRow>("/v1/refinement/sessions", {
        method: "POST",
        body: { signal_id },
      }),
  },

  gate: {
    get: (id: string) => api<GateEvaluation>(`/v1/gate/evaluations/${id}`),
    pool: (pool: string) =>
      api<{ evaluations: GateEvaluation[] }>(`/v1/gate/pools/${pool}`),
  },
};

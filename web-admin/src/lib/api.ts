// Thin fetch wrapper around the alphax Go API.
// All v1 calls send "Authorization: Bearer <token>".
// Token is held in localStorage and read fresh on every call so a token
// rotation in Settings takes effect immediately.

const TOKEN_KEY = "alphax.admin.token";
const BASE_KEY = "alphax.admin.base";

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

// AUTH_EXPIRED_EVENT 在任意已认证请求收到 401 时派发, App 监听后弹回登录页.
// 用全局事件而非直接耦合 React, 让 api 层不依赖组件树.
export const AUTH_EXPIRED_EVENT = "alphax:auth-expired";

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

async function api<T = unknown>(
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
    // 已认证请求拿到 401 → token 失效/被吊销. 清掉并通知 App 回登录页.
    if (res.status === 401 && !opts.noAuth) {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
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

// 承诺书正文 (commitment.thesis). 标的/动作/退出条件都在这里.
export interface Thesis {
  asset_ticker: string;
  asset_name: string;
  action: string; // buy | ...
  position_pct: number;
  duration_months: number;
  entry_method: string;
  exit_conditions: string[];
  reasons_for_future_self: string[];
}

export interface CommitmentRow {
  id: string;
  evaluation_id: string;
  project_id?: string | null;
  status: string; // drafted | signed | postponed | abandoned
  thesis: Thesis;
  pdf_path?: string | null;
  postpone_count: number;
  signed_at?: string | null;
  drafted_at: string;
}

// 持仓 (holdings.id == commitment.id). ticker/action 仅列表接口填充.
export interface HoldingRow {
  id: string;
  status: string; // active | triggered | expired | closed | archived
  ticker?: string;
  action?: string;
  signed_at: string;
  exit_conditions: string[];
  expires_at: string;
  exit_check_state?: unknown;
  triggered_at?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
}

export interface RetrospectAnswer {
  q: number;
  dim: string;
  choice: string;
  open_text?: string | null;
}

export interface RetrospectRow {
  id: string;
  commitment_id: string;
  state: string; // pending | answered | finalized
  started_at: string;
  finalized_at?: string | null;
  answers: RetrospectAnswer[];
  focus_dim?: string | null;
  focus_text?: string | null;
  diagnostician_model?: string | null;
}

// 五轮追问会话头 (列表 + 详情共用基础字段). 后端 sessionResponse.
export interface RefinementSession {
  id: string;
  primary_signal_id: string;
  primary_asset?: string | null;
  status: string; // active | completed | abandoned
  rounds_done: number;
  decision?: string | null; // eligible_for_gate | training_only
  started_at: string;
  completed_at?: string;
  primary_signal_raw_text?: string;
  primary_signal_summary?: string | null;
  project_name?: string | null;
  project_guidance?: string | null;
}

// 一轮问答 (详情里的"对话"单元).
export interface RefinementRound {
  round: number;
  question_id: string;
  question_kind: string;
  question_text: string;
  options?: {
    id: string;
    text: string;
    is_distractor?: boolean;
    is_required?: boolean;
    is_user_input?: boolean;
    group?: string;
  }[];
  user_answer: {
    choice_ids?: string[];
    open_text?: string | null;
    time_ms?: number;
  };
  diagnosis: { kind: string; note?: string | null };
  answered_at: string;
}

// 详情: 会话头 + 全部已答轮次 + 当前待答题目.
export interface RefinementSessionDetail extends RefinementSession {
  rounds: RefinementRound[];
  pending_question?: { round: number; payload: unknown } | null;
  training_focus_dim?: string;
  training_focus_text?: string;
}

// 投决会 · 四位分析师 (佐证 g1 · 共识 g2 · 时机 g3 · 能力圈 g4) 评估明细.
export interface GateDetail {
  g1_thickness: { pass: boolean; count: number; detail?: string | null };
  g2_anti_consensus: {
    pass: boolean;
    score: number;
    detail?: string | null;
    unpriced_directions?: { angle: string; why_unpriced: string; lens?: string }[];
  };
  g3_window: { pass: boolean; months: number; detail?: string | null };
  g4_edge: {
    pass: boolean;
    sub: { explain: boolean; direct: boolean; track_record: boolean; exit_known: boolean };
    detail?: string | null;
  };
}

export interface GateEvaluation {
  id: string;
  refinement_id: string;
  gates: GateDetail;
  passed: boolean;
  failed_gate?: number | null;
  archived_pool?: string | null;
  evaluated_at: string;
}

export interface SignalListResponse {
  signals: SignalRow[];
  has_more: boolean;
}

export interface User {
  id: string;
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  is_admin: boolean;
  created_at: string;
}

// AdminUserRow 是 /v1/admin/users 列表行 — User + 活动指标.
export interface AdminUserRow extends User {
  signal_count: number;
  last_seen_at?: string | null;
}

// 邀请码状态 (后端派生): 可用 / 用尽 / 过期 / 已吊销.
export type InviteStatus = "active" | "exhausted" | "expired" | "revoked";

// InviteCodeRow 是 /v1/admin/invites 列表行.
export interface InviteCodeRow {
  id: string;
  code: string;
  label?: string | null;
  max_uses?: number | null; // null = 不限次
  uses: number;
  status: InviteStatus;
  expires_at?: string | null; // null = 永不过期
  revoked_at?: string | null;
  created_by?: string | null;
  created_at: string;
}

// 新建邀请码入参. 全部可选: 默认不限次、永不过期.
export interface CreateInviteInput {
  label?: string | null;
  max_uses?: number | null;
  expires_in_days?: number | null;
}

export interface AuthResponse {
  user: User;
  session: { token: string; expires_at: string };
}

// 对象存储 (R2) 后台配置. 读时不含明文 secret — 仅 secret_configured 标志.
export interface StorageConfig {
  enabled: boolean;
  account_id: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_configured: boolean;
}

// 保存入参. secret_access_key 留空/省略 = 保留原值 (不覆盖).
export interface StorageConfigInput {
  enabled: boolean;
  account_id: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_access_key?: string;
}

// ───────── 运营后台 admin 聚合 / 跨用户视图 (后端切片 1-2) ─────────

export interface AdminOverview {
  users: { total: number; active_7d: number; admins: number };
  signals: { today: number; total: number; pending: number; failed: number };
  tweets: { today: number; total: number; classify_pending: number; classify_failed: number };
  subscriptions: { accounts: number; active_subs: number; poller_last_at: string | null };
  pipeline: {
    signals_30d: number;
    refine_done: number;
    distilled: number;
    gate_total: number;
    gate_passed: number;
    signed: number;
    holdings_active: number;
  };
  gate_pass_rate_30d: number;
}

export interface InferenceFailure {
  signal_id: string;
  user_id: string;
  email: string;
  text_preview: string;
  captured_at: string;
}

export interface InferenceHealth {
  pending: number;
  failed: number;
  done: number;
  avg_latency_seconds: number;
  recent_failures: InferenceFailure[];
}

// AdminSignalRow — 跨用户信号行 (带归属 user + 分类名).
export interface AdminSignalRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  project_id?: string;
  project_name?: string;
  raw_text: string;
  captured_at: string;
  inference_status: "pending" | "done" | "failed";
  inference_summary?: string;
  inference_tags?: string[];
}

export interface AdminSignalListResponse {
  signals: AdminSignalRow[];
  has_more: boolean;
}

// AdminAccountRow — 订阅源按账号聚合 (运营/轮询视图).
export interface AdminAccountRow {
  id: string;
  handle: string;
  display_name?: string;
  status: string;
  last_polled_at?: string;
  poll_interval_sec: number;
  subscriber_count: number;
  tweet_count: number;
}

export interface AdminHoldingRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  status: string;
  ticker?: string;
  action?: string;
  signed_at: string;
  expires_at: string;
  triggered_at?: string;
  closed_at?: string;
  archived_at?: string;
}

export interface AdminEvalRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  refinement_id: string;
  passed: boolean;
  failed_gate?: number;
  archived_pool?: string;
  evaluated_at: string;
}

// AdminUserOverview — 单用户跨域旅程快照 (驱动「聚焦到用户」).
export interface AdminUserOverview {
  id: string;
  email: string;
  display_name?: string;
  is_admin: boolean;
  created_at: string;
  signals_total: number;
  signals_pending: number;
  signals_failed: number;
  refine_completed: number;
  gate_total: number;
  gate_passed: number;
  commitments_signed: number;
  holdings_active: number;
  subscriptions_active: number;
  last_signal_at?: string;
}

// AdminSessionRow — 跨用户追问会话.
export interface AdminSessionRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  status: string;
  rounds_done: number;
  decision?: string;
  primary_asset?: string;
  signal_summary?: string;
  started_at: string;
  completed_at?: string;
}

export interface AdminDistillationRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  refinement_id: string;
  model: string;
  has_beneficiary: boolean;
  content_preview?: string;
  created_at: string;
}

export interface AdminProjectRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  name: string;
  emoji?: string;
  archived: boolean;
  signal_count: number;
  created_at: string;
}

export interface AdminRetrospectRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name?: string;
  state: string;
  focus_dim?: string;
  started_at: string;
  finalized_at?: string;
}

export const alphax = {
  health: () => api<{ status: string; db?: string }>("/healthz", { noAuth: true }),
  metrics: () =>
    api<string>("/metrics", { noAuth: true, asText: true }),

  // 邮箱+密码登录/登出. login 不带 token (noAuth), 成功后由调用方 setToken.
  auth: {
    login: (email: string, password: string) =>
      api<AuthResponse>("/v1/auth/login", {
        method: "POST",
        body: { email, password },
        noAuth: true,
      }),
    logout: () => api<null>("/v1/auth/logout", { method: "POST" }),
  },

  // 当前登录用户 (含 is_admin). 用于登录后的管理员门禁 + Topbar 身份展示.
  me: () => api<User>("/v1/me"),
  changePassword: (old_password: string, new_password: string) =>
    api<null>("/v1/me/password", {
      method: "POST",
      body: { old_password, new_password },
    }),

  // 管理员专用 (服务端 /v1/admin/* 走 RequireAdmin). 非 admin 调用返回 403.
  admin: {
    stats: {
      overview: () => api<AdminOverview>("/v1/admin/stats/overview"),
    },
    inference: {
      health: () => api<InferenceHealth>("/v1/admin/inference/health"),
    },
    signals: {
      // 跨用户信号. 过滤: user_id / status / project_id / q / before 游标; 返回 has_more.
      list: (params?: {
        user_id?: string;
        status?: "pending" | "done" | "failed";
        project_id?: string;
        q?: string;
        limit?: number;
        before?: string;
      }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.status) sp.set("status", params.status);
        if (params?.project_id) sp.set("project_id", params.project_id);
        if (params?.q) sp.set("q", params.q);
        if (params?.limit) sp.set("limit", String(params.limit));
        if (params?.before) sp.set("before", params.before);
        const qs = sp.toString();
        return api<AdminSignalListResponse>(`/v1/admin/signals${qs ? `?${qs}` : ""}`);
      },
      // 运营按需重推单条 (跨用户, 不校验 ownership). 202 + {signal_id, inference_status};
      // 已 done → 409; 不存在 → 404. 给"按需 / recovery_exhausted 兜底".
      reinfer: (id: string) =>
        api<{ signal_id: string; inference_status: string }>(
          `/v1/admin/signals/${id}/reinfer`,
          { method: "POST" },
        ),
      // 批量重推全部 failed (可选 user_id 收窄到聚焦用户). 返回 {reinfered: N}.
      reinferFailed: (params?: { user_id?: string }) =>
        api<{ reinfered: number }>("/v1/admin/signals/reinfer", {
          method: "POST",
          body: params?.user_id ? { user_id: params.user_id } : {},
        }),
    },
    subscriptions: {
      // 按账号 (订阅数/推文数/轮询). user_id 过滤 = 该用户订阅的账号 (聚焦用户).
      list: (params?: { user_id?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ accounts: AdminAccountRow[] }>(`/v1/admin/subscriptions${qs ? `?${qs}` : ""}`);
      },
    },
    holdings: {
      list: (params?: { user_id?: string; status?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.status) sp.set("status", params.status);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ holdings: AdminHoldingRow[] }>(`/v1/admin/holdings${qs ? `?${qs}` : ""}`);
      },
    },
    gate: {
      list: (params?: { user_id?: string; passed?: boolean; pool?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.passed !== undefined) sp.set("passed", String(params.passed));
        if (params?.pool) sp.set("pool", params.pool);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ evaluations: AdminEvalRow[] }>(`/v1/admin/gate/evaluations${qs ? `?${qs}` : ""}`);
      },
    },
    refinement: {
      list: (params?: { user_id?: string; status?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.status) sp.set("status", params.status);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ sessions: AdminSessionRow[] }>(`/v1/admin/refinement/sessions${qs ? `?${qs}` : ""}`);
      },
    },
    distillations: {
      list: (params?: { user_id?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ distillations: AdminDistillationRow[] }>(`/v1/admin/distillations${qs ? `?${qs}` : ""}`);
      },
    },
    projects: {
      list: (params?: { user_id?: string; include_archived?: boolean; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.include_archived) sp.set("include_archived", "true");
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ projects: AdminProjectRow[] }>(`/v1/admin/projects${qs ? `?${qs}` : ""}`);
      },
    },
    retrospects: {
      list: (params?: { user_id?: string; state?: string; limit?: number }) => {
        const sp = new URLSearchParams();
        if (params?.user_id) sp.set("user_id", params.user_id);
        if (params?.state) sp.set("state", params.state);
        if (params?.limit) sp.set("limit", String(params.limit));
        const qs = sp.toString();
        return api<{ retrospects: AdminRetrospectRow[] }>(`/v1/admin/retrospects${qs ? `?${qs}` : ""}`);
      },
    },
    users: {
      list: () => api<{ users: AdminUserRow[]; total: number }>("/v1/admin/users"),
      get: (id: string) => api<User>(`/v1/admin/users/${id}`),
      overview: (id: string) => api<AdminUserOverview>(`/v1/admin/users/${id}/overview`),
      setAdmin: (id: string, is_admin: boolean) =>
        api<User>(`/v1/admin/users/${id}/admin`, {
          method: "POST",
          body: { is_admin },
        }),
    },
    invites: {
      list: () =>
        api<{ invites: InviteCodeRow[]; total: number }>("/v1/admin/invites"),
      create: (input: CreateInviteInput) =>
        api<InviteCodeRow>("/v1/admin/invites", {
          method: "POST",
          body: input,
        }),
      revoke: (id: string) =>
        api<InviteCodeRow>(`/v1/admin/invites/${id}/revoke`, {
          method: "POST",
        }),
    },
    settings: {
      // 对象存储 (R2) 凭证. get 不回 secret; update 留空 secret = 保留; test = 连通性自检.
      storage: {
        get: () => api<StorageConfig>("/v1/admin/settings/storage"),
        update: (input: StorageConfigInput) =>
          api<StorageConfig>("/v1/admin/settings/storage", {
            method: "PUT",
            body: input,
          }),
        test: () =>
          api<{ ok: boolean; error?: string }>(
            "/v1/admin/settings/storage/test",
            { method: "POST" },
          ),
      },
    },
  },

  signals: {
    // 服务端搜索 + 游标分页. q → ILIKE(raw_text, summary); before → captured_at<before 游标;
    // limit 默认后端 20 (上限 100). 返回 has_more 供"加载更多".
    list: (params?: { q?: string; limit?: number; before?: string }) => {
      const sp = new URLSearchParams();
      if (params?.q) sp.set("q", params.q);
      if (params?.limit) sp.set("limit", String(params.limit));
      if (params?.before) sp.set("before", params.before);
      const qs = sp.toString();
      return api<SignalListResponse>(`/v1/signals${qs ? `?${qs}` : ""}`);
    },
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
    list: () =>
      api<{ commitments: CommitmentRow[]; total: number }>("/v1/commitments"),
    active: () => api<CommitmentRow | null>("/v1/commitments/active"),
    get: (id: string) => api<CommitmentRow>(`/v1/commitments/${id}`),
    byEvaluation: (evaluationId: string) =>
      api<CommitmentRow>(`/v1/commitments/by-evaluation/${evaluationId}`),
    // 后端要 signing_client_id (uuid, 兼作幂等键 — 每次签字传新的, 否则碰撞).
    sign: (id: string, signing_client_id: string) =>
      api<{ commitment: CommitmentRow; holding?: HoldingRow }>(
        `/v1/commitments/${id}/sign`,
        { method: "POST", body: { signing_client_id } },
      ),
    // 后端要 client_event_id (uuid) + 可选 reason. postpone 不带日期 (计数 +1).
    postpone: (id: string, client_event_id: string, reason?: string) =>
      api<CommitmentRow>(`/v1/commitments/${id}/postpone`, {
        method: "POST",
        body: { client_event_id, reason },
      }),
  },

  holdings: {
    list: () => api<{ holdings: HoldingRow[]; total: number }>("/v1/holdings"),
    active: () => api<HoldingRow | null>("/v1/holdings/active"),
    get: (id: string) => api<HoldingRow>(`/v1/holdings/${id}`),
  },

  retrospects: {
    list: () =>
      api<{ retrospects: RetrospectRow[] }>("/v1/retrospects"),
    get: (id: string) => api<RetrospectRow>(`/v1/retrospects/${id}`),
  },

  refinement: {
    list: () =>
      api<{ sessions: RefinementSession[]; total: number }>(
        "/v1/refinement/sessions",
      ),
    bySignal: (signalId: string) =>
      api<RefinementSessionDetail>(
        `/v1/refinement/sessions/by-signal/${signalId}`,
      ),
    get: (id: string) =>
      api<RefinementSessionDetail>(`/v1/refinement/sessions/${id}`),
    // 后端要 client_event_id + primary_signal_id (不是 signal_id).
    start: (primary_signal_id: string, client_event_id: string) =>
      api<RefinementSession>("/v1/refinement/sessions", {
        method: "POST",
        body: { client_event_id, primary_signal_id },
      }),
  },

  gate: {
    listAll: () =>
      api<{ evaluations: GateEvaluation[] }>("/v1/gate/evaluations"),
    get: (id: string) => api<GateEvaluation>(`/v1/gate/evaluations/${id}`),
    byRefinement: (refinementId: string) =>
      api<GateEvaluation>(`/v1/gate/by-refinement/${refinementId}`),
    pool: (pool: string) =>
      api<{ evaluations: GateEvaluation[] }>(`/v1/gate/pools/${pool}`),
  },
};

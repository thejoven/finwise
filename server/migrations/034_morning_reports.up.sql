-- 034: 早报 (Daily Morning Report) — 平台每日去标识化编者早报.
--
-- 由调度器每天 08:00 (Asia/Shanghai) 把"前一天 [00:00,24:00) 转为信号"的内容,
-- 跨所有用户聚合成一份去标识化编者早报. 两张投影表 (同 distillations, 无 events 行):
--
--   morning_report_globals  — 每 (edition_date, language) 一行的"共享底稿":
--       聚合统计 (top_assets/top_tags, 语言无关) + Mastra 产出的编者文稿
--       (headline/dek/sections). 一天最多 3 行 (zh-Hans/zh-Hant/en).
--       去标识来源 = 跨用户聚合 inference_tags / inference_related_assets /
--       (k-匿名过滤后的) inference_summary —— 绝不含 raw_text / 用户身份 / 分类名.
--       UNIQUE(edition_date,language) 是调度器幂等去重的锚点 (ON CONFLICT DO NOTHING).
--
--   morning_report_editions — per-user 个性化版的懒加载缓存:
--       首次打开时由 Go 按"用户关注标的 + 活跃分类"对 sections 重排 (section_order),
--       并可选生成"为你导读" (personal_intro). 按 (user_id, edition_date) 缓存.
--       read_at 为 Phase 2 未读角标预留 (本期只写不展示).

CREATE TABLE IF NOT EXISTS morning_report_globals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_date  date NOT NULL,                  -- 当地日历日 (Asia/Shanghai)
    language      text NOT NULL CHECK (language IN ('zh-Hans','zh-Hant','en')),
    window_start  timestamptz NOT NULL,           -- 前一天 00:00 (TZ)
    window_end    timestamptz NOT NULL,           -- 前一天 24:00 (TZ)
    signal_count  int  NOT NULL DEFAULT 0,        -- 当日纳入的 done 信号数 (安静日判定)
    is_quiet      boolean NOT NULL DEFAULT false, -- 低于阈值的"安静日"短版
    -- 去标识聚合 (语言无关, 与文稿同存便于一次读取):
    top_assets    jsonb NOT NULL DEFAULT '[]',    -- [{ticker,name?,mentions,signal_count}]
    top_tags      jsonb NOT NULL DEFAULT '[]',    -- [{tag,mentions,signal_count}]
    -- 编者文稿 (Mastra morning-report agent 产出; Mastra 不可用时 Go 兜底):
    headline      text,
    dek           text,                           -- 副题/一句导语
    sections      jsonb NOT NULL DEFAULT '[]',    -- [{id,heading,body,assets:[ticker],tags:[tag]}]
    model         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (edition_date, language)
);

CREATE INDEX IF NOT EXISTS idx_morning_report_globals_edition
    ON morning_report_globals (edition_date DESC);

CREATE TABLE IF NOT EXISTS morning_report_editions (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition_date    date NOT NULL,
    language        text NOT NULL CHECK (language IN ('zh-Hans','zh-Hant','en')),
    section_order   jsonb NOT NULL DEFAULT '[]',  -- [section_id...] 个性化顺序
    personal_intro  text,                         -- "为你导读/与你相关" (可空)
    relevant_assets jsonb NOT NULL DEFAULT '[]',  -- [{ticker,reason}] 命中用户追踪的标的
    model           text NOT NULL DEFAULT '',
    read_at         timestamptz,                  -- 未读角标 (Phase 2 用; 现在只写)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, edition_date)
);

CREATE INDEX IF NOT EXISTS idx_morning_report_editions_user
    ON morning_report_editions (user_id, edition_date DESC);

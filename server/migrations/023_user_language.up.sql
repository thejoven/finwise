-- 023: 给 users 加 language —— 用户语言偏好, 驱动面向用户的 AI 产出语言.
--
-- 背景: App 加多语言 (简体/繁体/英文), 默认跟随手机系统语言. UI 文案由 mobile i18n 处理,
-- 但 AI 生成内容 (投决会判词 / 降噪 / 五轮追问 / 归档对话 / 订阅打标) 由 Mastra agents 产出,
-- 必须也跟随用户语言. 故把 mobile 解析出的"实际语言"持久化到用户档案, 服务端各处调 Mastra 时
-- 读取它并传给 agent (见 infra/mastra 的 *Request.Language).
--
-- 写入: mobile 切语言 / 启动时 PATCH /v1/me {language} (见 account.UpdateProfile).
-- 取值: 'zh-Hans' | 'zh-Hant' | 'en'. NULL = 未设置 —— 服务端按默认 (简体) 处理,
--        即存量用户行为完全不变 (Mastra languageDirective 对空值返回空指令).

ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT
    CHECK (language IS NULL OR language IN ('zh-Hans', 'zh-Hant', 'en'));

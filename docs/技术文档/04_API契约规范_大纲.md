# 04 · API 契约规范 · 大纲

> 作者视角:**后端工程师 (接口设计)**
> 这份文档回答:React Native 调 Go 用什么接口、Mastra 调 Go 用什么接口、流式响应怎么处理、错误怎么标准化。

---

## 这份文档要回答的核心问题

1. 外部 API (React Native → Go) 长什么样?
2. 内部 API (Mastra → Go) 长什么样?它们和外部 API 怎么隔离?
3. SSE 流式响应的协议细节?
4. 错误响应的统一格式?
5. 怎么版本化 API?

---

## 章节结构

### § 1. 接口分层

三类接口,各自的 URL 前缀、鉴权方式、限流策略:

- `/v1/*` — 外部 API,React Native 调用,用户 JWT / session token(`/v1/auth/*` 免鉴权)
- `/v1/internal/*` — 内部 API,Mastra 调用,service token
- `/v1/ops/*` — 运维 API,本地工具调用,管理员 token

### § 2. 通用约定

- 所有时间用 ISO 8601 with timezone
- 所有 ID 用字符串,带前缀 (`sig_`, `cmt_`, `evt_`)
- 所有 POST 请求要带 `Idempotency-Key`(或在 body 里用 `client_event_id`)
- 所有响应包含 `request_id`,用于跨服务追踪

### § 3. 错误响应格式

```json
{
  "error": {
    "code": "GATE_NOT_PASSED",
    "message": "门 1 未通过, 当前 1/3 条独立信号",
    "detail": { ... },
    "request_id": "req_..."
  }
}
```

错误码命名规范、HTTP 状态码使用约定(2xx / 4xx / 5xx 各管什么)。

### § 4. 外部 API · 完整目录

🟢 标注的是 Phase 1 必做:

**信号 (L1)**
- 🟢 `POST /v1/signals` — 快速录入(可选 `project_id` 归属项目)
- `POST /v1/signals/{id}/refine` — 启动五轮追问
- 🟢 `GET /v1/signals` — 列表(分页 + 过滤)
- 🟢 `GET /v1/signals/{id}` — 详情

**训练 (L2)**
- `GET /v1/training/next-question` — 取下一道题
- `POST /v1/training/answers` — 提交作答
- `GET /v1/training/ability-map` — 能力地图

**评估 (L3)**
- `GET /v1/gates/evaluations` — 评估历史
- `GET /v1/gates/pools/{pool_name}` — 归档池内容(观察 / 教训 / 日历 / 舍弃)

**承诺 (L4)**
- `GET /v1/commitments/drafts/{id}` — 草稿详情
- `POST /v1/commitments/{draft_id}/sign` — 签字
- `GET /v1/commitments` — 持仓列表
- `GET /v1/commitments/{id}/companion-card` — E4 焦虑陪伴卡片
- `POST /v1/commitments/{id}/exit-evaluation` — 用户主动触发"重新评估"

**复盘 (L5)**
- `GET /v1/retrospectives` — 复盘列表
- `POST /v1/retrospectives/{commitment_id}/start` — 开始复盘
- `GET /v1/retrospectives/{id}/timeline` — 时间轴回放数据

**项目 (跨层 · 信号分组,M-projects)**
- `GET /v1/projects` · `POST /v1/projects` · `PATCH /v1/projects/{id}` · `DELETE /v1/projects/{id}`(归档)
- 项目带 `guidance`(≤2000 字),作为该项目下信号后台推演的引导上下文

**注意力诊断 (L5 · M11-bis)**
- `GET /v1/attention/summary` — 最近一次五轮追问的注意力画像(`focus / depth / breadth / execution` 四维 0–100 + insight + blindspot)

> 注:上面"训练 / 评估 / 复盘"几条是早期契约草案,实际路由以代码为准 —— 五轮追问实现为 `/v1/refinement/sessions/*`,复盘为 `/v1/retrospects/*`,信号重推演为 `POST /v1/signals/{id}/reinfer`。

**用户**
- `POST /v1/auth/login` — 登录
- `GET /v1/me` — 用户档案
- `POST /v1/me/export` — 数据导出

每个接口给出:URL、方法、请求 schema、响应 schema、错误情形、限流策略。**只给契约,不给实现。**

### § 5. 内部 API · Mastra → Go

- `POST /v1/internal/inferences` — 信号推演结果回写
- `POST /v1/internal/attention` — 注意力诊断结果回写(Mastra attention-analyst → Go,M11-bis)
- `GET /v1/internal/refinement/sessions/{id}/question` — 取下一道追问题
- `POST /v1/internal/commitments/draft` · `POST /v1/internal/gate/evaluate` · `POST /v1/internal/research`

鉴权:`X-Internal-Token` 共享密钥;`INTERNAL_LOOPBACK=true` 时仅接 127.0.0.1(Mastra 与 Go 同机走 loopback)。注意 **iii 的事件入队走另一条路** —— Go OutboxWorker POST 到 Mastra 在 iii 上注册的 `/v1/events/*` shim,不是这里的 `/v1/internal/*`。

### § 6. 流式响应 (SSE)

哪些接口是流式的:

- `POST /v1/signals/{id}/refine` — 五轮追问对话
- `GET /v1/commitments/drafts/{id}/narration-stream` — 承诺书叙述生成
- `POST /v1/retrospectives/{id}/dialogue` — 复盘对话

SSE 协议细节:

```
event: token
data: {"text": "今天"}

event: token
data: {"text": "的波动"}

event: complete
data: {"full_text": "...", "metadata": {...}}

event: error
data: {"code": "...", "message": "..."}
```

客户端实现:RN 用 `@microsoft/fetch-event-source`(唯一支持 POST + auth header 的 SSE 库)。
断线重连策略和 Last-Event-ID 处理见文档 06。

### § 7. 异步任务结果获取

后台推演完成后,React Native 怎么知道?三种方式备选:

- **推模型**:WebSocket 长连接(复杂,延迟最低)
- **拉模型**:客户端定时轮询 `/v1/signals/{id}` (简单)
- **被动模型**:用户下次打开 APP 时自然看到结果(最克制,符合产品哲学)

Phase 1 推荐 **被动模型**——和"沉默优于发声"哲学一致。

### § 8. 版本化策略

URL 前缀 `/v1/` 永远不变。破坏性变更通过新版本接口实现,旧版本至少保留 6 个月。

---

## 关键决策预告

1. **外部 / 内部 API 严格分离** — 不同的鉴权、限流、可观测性
2. **POST 都要幂等** — 移动网络不稳定,客户端必然重试
3. **SSE 优于 WebSocket** — 单向流足够,实现简单
4. **被动结果获取优于推送** — 符合产品哲学
5. **错误码可枚举** — 客户端能 switch case 处理

---

## 交叉引用

- 接口背后的业务逻辑 → 文档 02
- 内部 API 是 Mastra 的哪个 Workflow 调用 → 文档 05
- React Native 端怎么调这些接口 → 文档 06
- 接口测试 → 文档 08

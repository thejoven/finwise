# M1 · 数据底座

> Phase 1 · W1-W2 · 2 周 · 必须先完成, 是 M2/M3/M4 的前置依赖

---

## 上下文

这是 财富密码 的地基模块。所有后续业务模块的数据都流过这里。

它不直接面向用户, 但它**定义了整个系统的数据真相**——
events 表的 schema, 物化视图的派生规则, Go 服务的边界划分。

错一点, 后面全部要返工。**M1 慢一点没关系, 错一点要全推倒**。

---

## 前置依赖

无。M1 是 Phase 1 的起点。

但**环境必须装好**:
- Docker + Docker Compose
- Go 1.22+
- Node.js 20 LTS (Mastra 需要, 即使 M1 不用)
- 一个本地 PostgreSQL 16 + pgvector (或 Docker 起)

---

## 目标

完成后, 项目目录里有:

```
wiseflow/
├── server/                           # Go 后端
│   ├── cmd/
│   │   └── api/main.go               # HTTP 入口
│   ├── internal/
│   │   ├── domain/                   # 领域模型(纯粹, 无依赖)
│   │   │   ├── event.go              # Event entity
│   │   │   └── signal.go             # Signal entity
│   │   ├── infra/
│   │   │   ├── db/                   # Postgres + Ent
│   │   │   └── nats/                 # NATS 客户端
│   │   └── module/
│   │       └── signal/               # signal 模块骨架(空业务逻辑)
│   ├── migrations/
│   │   └── 001_create_events.sql     # events 表 + indexes
│   ├── ent/                          # Ent 自动生成
│   ├── go.mod
│   └── go.sum
│
├── docker-compose.yml                # postgres + nats
├── Makefile                          # make migrate / make run / make test
├── .env.example                      # 环境变量模板
└── README.md                         # 启动说明
```

数据库里有:
- `events` 表(append-only, REVOKE UPDATE/DELETE)
- 一个空的 `signals` 物化视图(M2 才填业务)
- 索引、触发器、约束齐全

服务能跑:
- `make run` 启动 Go HTTP server
- `curl localhost:8080/healthz` 返回 200

---

## 任务列表

### Task 1.1 · 仓库初始化

```bash
mkdir wiseflow && cd wiseflow
git init
# 加 .gitignore (Go + Node + macOS)
mkdir server && cd server
go mod init github.com/<user>/wiseflow/server
```

**已知坑**:
- 不要把整个项目都放在 server 下, RN 客户端在 `mobile/` 兄弟目录
- 顶层不放 `package.json`(避免 monorepo 工具混乱), 客户端在自己目录

### Task 1.2 · Docker Compose

写 `docker-compose.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: wiseflow
      POSTGRES_USER: wiseflow
      POSTGRES_PASSWORD: dev_password_change_me
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wiseflow"]
      interval: 5s

  nats:
    image: nats:2.10-alpine
    command: -js -m 8222
    ports:
      - "4222:4222"
      - "8222:8222"

volumes:
  pgdata:
```

**已知坑**:
- `pgvector/pgvector:pg16` 而不是普通 postgres, M2 需要向量索引
- NATS 必须开 `-js` (JetStream), 否则不能持久化消息

### Task 1.3 · events 表 schema

写 `server/migrations/001_create_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    client_event_id UUID NOT NULL,
    type            TEXT NOT NULL,
    payload         JSONB NOT NULL,

    occurred_at     TIMESTAMPTZ NOT NULL,   -- 用户感知发生时间
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- server 收到时间

    causation_id    BIGINT,                  -- 引发这个事件的事件 ID
    correlation_id  UUID,                    -- 同一业务流的 trace ID

    related_asset   TEXT,                    -- 索引字段
    related_thesis  UUID,                    -- 关联到某个 thesis

    UNIQUE (user_id, client_event_id)        -- 客户端幂等
);

CREATE INDEX idx_events_user_occurred ON events (user_id, occurred_at DESC);
CREATE INDEX idx_events_type ON events (type);
CREATE INDEX idx_events_asset ON events (related_asset) WHERE related_asset IS NOT NULL;
CREATE INDEX idx_events_thesis ON events (related_thesis) WHERE related_thesis IS NOT NULL;

-- 关键: append-only 保护
REVOKE UPDATE, DELETE ON events FROM PUBLIC;
REVOKE UPDATE, DELETE ON events FROM wiseflow;
```

**已知坑**:
- `BIGSERIAL` 而不是 `SERIAL`(events 会有很多)
- `client_event_id` 必须 UUID v7(时间排序友好)
- REVOKE 在 dev 期间也要写, 不要"以后再加"
- `causation_id` 允许 NULL(顶层事件没有起因)

### Task 1.4 · 事件类型枚举

写 `server/internal/domain/event.go`:

```go
package domain

type EventType string

const (
    // Phase 1 用到的事件类型
    EventSignalCaptured     EventType = "signal.captured"
    EventSignalInferenceDone EventType = "signal.inference.done"

    // Phase 2 占位(M5-M8 才用)
    EventRefinementStarted  EventType = "refinement.started"
    EventRefinementAnswered EventType = "refinement.answered"
    EventGateEvaluated      EventType = "gate.evaluated"
    EventCommitmentDrafted  EventType = "commitment.drafted"
    EventCommitmentSigned   EventType = "commitment.signed"

    // Phase 3 占位
    EventCompanionShown     EventType = "companion.shown"
    EventExitConditionTriggered EventType = "exit.condition.triggered"
    EventRetrospectStarted  EventType = "retrospect.started"
)

type Event struct {
    ID            int64
    UserID        uuid.UUID
    ClientEventID uuid.UUID
    Type          EventType
    Payload       json.RawMessage

    OccurredAt    time.Time
    RecordedAt    time.Time

    CausationID   *int64
    CorrelationID *uuid.UUID
    RelatedAsset  *string
    RelatedThesis *uuid.UUID
}
```

**已知坑**:
- 用 `*int64` / `*uuid.UUID` 而不是零值, 因为这些字段语义上可为空
- Payload 用 `json.RawMessage` 而不是 `interface{}`, 保留原始字节

### Task 1.5 · Ent ORM 集成

```bash
cd server
go get -d entgo.io/ent/cmd/ent
go run entgo.io/ent/cmd/ent new Event
go run entgo.io/ent/cmd/ent generate ./internal/infra/db/schema
```

在 `internal/infra/db/schema/event.go` 里定义 schema 对应 § 1.3 的 SQL。

**已知坑**:
- Ent 默认会创建表, 但我们用手写 SQL migration, 关闭 Ent 的 auto-migrate
- `ent.Schema` 里的字段类型要和 SQL 完全对齐
- 用 `EnableSchemaInspection: false` 防止 Ent 想动 schema

### Task 1.6 · 健康检查 + 基础 HTTP

写 `server/cmd/api/main.go`:

```go
func main() {
    cfg := config.Load()
    db := mustConnectDB(cfg.DatabaseURL)
    defer db.Close()

    nc := mustConnectNATS(cfg.NATSURL)
    defer nc.Close()

    r := gin.New()
    r.GET("/healthz", func(c *gin.Context) {
        if err := db.Ping(c.Request.Context()); err != nil {
            c.JSON(503, gin.H{"db": "down"})
            return
        }
        c.JSON(200, gin.H{"status": "ok"})
    })

    log.Fatal(r.Run(":8080"))
}
```

**已知坑**:
- `gin.New()` 而不是 `gin.Default()`(Default 加了不需要的 logger/recovery)
- 自己加 middleware: zap logger + recovery + request ID
- 不开 GIN_MODE=debug 的彩色日志(生产难看)

### Task 1.7 · Makefile

```makefile
.PHONY: dev migrate run test fmt lint

dev:
	docker compose up -d

migrate:
	migrate -database "$$DATABASE_URL" -path server/migrations up

run:
	cd server && go run ./cmd/api

test:
	cd server && go test ./...

fmt:
	cd server && gofmt -w . && goimports -w .

lint:
	cd server && golangci-lint run
```

**已知坑**:
- 用 `golang-migrate/migrate` CLI, 不要 Ent 的 auto-migrate
- `$$DATABASE_URL` 双 dollar 是 Makefile 转义, 让 shell 拿到 `$DATABASE_URL`

### Task 1.8 · 第一个测试

写 `server/internal/infra/db/event_repository_test.go`:

测试:
1. 能插入一条 event
2. 能按 user_id + occurred_at DESC 查询
3. **不能 UPDATE 或 DELETE**(应该报权限错)

**第三点尤其重要**, 这是事件溯源的物理保护。

---

## 验收标准

### 代码层
- [ ] `make dev` 起 postgres + nats 成功
- [ ] `make migrate` 跑通, events 表创建
- [ ] `make run` 起 server, 8080 端口监听
- [ ] `curl localhost:8080/healthz` 返回 200
- [ ] `make test` 通过, 包括"不能 DELETE" 测试

### 数据层
- [ ] events 表有所有索引
- [ ] REVOKE UPDATE / DELETE 生效
- [ ] 插入一条 event 后, 字段都对
- [ ] `client_event_id` 重复插入会报唯一约束错误

### 项目结构
- [ ] 目录结构和 § 任务列表预期一致
- [ ] go.mod 用了 `wiseflow` 而不是泛 module name
- [ ] .env.example 列出所有需要的变量

### 文档
- [ ] README.md 写明:启动步骤、依赖、常见问题
- [ ] 至少一个 ADR(architecture decision record)记录 "为什么选 Ent" 或 "为什么 REVOKE"

---

## 自由度边界

### 你可以自由决定
- 文件夹细分(hexagonal / clean / DDD 哪种都行)
- 配置读取方式(viper / koanf / 手写)
- HTTP middleware 的细节
- 日志库选择(zap / slog / logrus)
- 测试组织方式

### 必须问
- migration 工具不用 golang-migrate 想用 goose
- ORM 不用 Ent 想用 sqlc 或 gorm
- 想加 OpenAPI 自动生成
- 想引入额外的数据库(Redis 在 Phase 2 才加)

### 不允许
- 删除事件溯源约束(REVOKE)
- 把 events 表换成普通 CRUD
- 用 ORM 的 auto-migrate(必须手写 SQL)
- 不写测试就交付

---

## 已知坑(汇总)

1. **events 表 client_event_id 用 UUID v7**(时间排序友好), 不是 v4。
2. **REVOKE 在 dev 期间也要写**, 不要"以后加"。
3. **Ent 不要 auto-migrate**, 用 golang-migrate CLI 管 schema 演化。
4. **pgvector 镜像** 不是普通 postgres 镜像。
5. **NATS 必须 -js**, 否则消息不持久化。
6. **gin.New() 不是 gin.Default()**, 后者加了不需要的中间件。
7. **不要把客户端塞进 server 目录**, 客户端单独 `mobile/`。

---

## 交叉引用

- 数据模型详细设计 → `技术文档/03_数据模型与事件溯源_大纲.md`
- Go 服务模块拆分 → `技术文档/02_Go服务模块设计_大纲.md`
- 整体架构 → `技术文档/01_系统架构总览_大纲.md`
- 部署 → `技术文档/07_部署与基础设施_大纲.md`

---

## 完成后做什么

更新 `phase-1-quiet/00-overview.md` 里 M1 状态为 ✅。
通知人类可以开 M2 + M3 并行。

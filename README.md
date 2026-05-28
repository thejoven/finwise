# Flashfi Engine

> 把模糊的高价值信号, 转化为少数高确定性承诺的 AI 产品.

**后端跑在内网服务器** `root@192.168.1.205`. 见 [SERVER.md](SERVER.md). 本地不再起 docker / go run.
本地只改代码 + `./scripts/remote-sync.sh` 推 + 自动 rebuild + restart.

仓库布局:

```
.
├── docs/                # 产品文档 / 技术文档 / GOAL 路线图 / ADR
├── server/              # Go 后端 (Phase 1 起步)
└── (mobile/ 留位)       # Expo / RN 客户端 (M3 起)
```

完整背景见 [docs/README.md](docs/README.md). AI Agent 必读 [docs/GOAL/AGENT_BRIEF.md](docs/GOAL/AGENT_BRIEF.md).

---

## 当前进度

`W0 → W1`. M1 (数据底座) 代码已落, 待本地跑通验收.

---

## 本地启动 (M1 阶段)

### 前置

- macOS arm64 (其他平台未测)
- Go 1.22+ (本机用 1.26.3, 装在 `~/.local/sdk/go`)
- Docker Desktop (装好后开一次)
- [`golang-migrate`](https://github.com/golang-migrate/migrate) CLI

如果 `go` / `docker` 不在 PATH:

```bash
# Go (已下到 ~/.local/sdk/go)
export PATH="$HOME/.local/sdk/go/bin:$PATH"

# Docker: 装 Docker Desktop 后开一次, 接受协议
# https://www.docker.com/products/docker-desktop/
```

> **注**: 不再需要装 `golang-migrate` CLI. `make migrate` 走 `scripts/migrate.sh`,
> 用 `docker compose exec psql` 应用迁移, 绕开了 golang-migrate 在 macOS 26.x
> 的 LC_UUID 兼容问题.

### 一次性

```bash
cp .env.example .env
# 编辑 .env, 把 DEV_USER_ID 填一个 uuidgen 生成的值
uuidgen
```

### 跑起来

```bash
# 1) 拉 Go 依赖 (M1 首次跑必须). go.mod 已定版, 跑 tidy 会生成 go.sum.
cd server && go mod tidy

# 2) 起基础设施
cd .. && make dev           # docker compose up -d (postgres + nats)

# 3) 跑迁移 (走 scripts/migrate.sh + docker compose exec psql)
make migrate                # events 表 + indexes + REVOKE
make migrate-status         # 看哪些已 apply, 哪些 pending

# 4) 生成 Ent client (M2 业务查询会用)
make ent-gen

# 5) 起 HTTP server
make run                    # 监听 :8080
```

**网络慢/在墙内**:
- `go mod tidy` 慢时, 在 `cd server` 后 `export GOPROXY=https://goproxy.cn,direct` 再 tidy.
- Aliyun mirror Go 安装包: `https://mirrors.aliyun.com/golang/go1.22.10.darwin-arm64.tar.gz`.

另起一个 shell 验证:

```bash
make healthz
# {"status":"ok"}
```

### 跑测试

```bash
# 需要 .env 里 DATABASE_URL 已配置, 且 docker 起来了
export $(grep -v '^#' .env | xargs)
make test
```

集成测试会跑 `TestEventsAreAppendOnly`, 这个**必须过** — 它是事件溯源的物理守门.

---

## 常见问题

**Q: `make run` 报 `missing required env: DATABASE_URL ...`**
A: `.env` 没拷或没填. 跑 `cp .env.example .env` 并填 `DEV_USER_ID`.

**Q: `make migrate` 报 `connection refused`**
A: docker 没起或 postgres 还没 healthy. `docker compose ps` 看一下, 等 healthcheck 变 `healthy` 再 migrate.

**Q: ent-gen 报 `package entgo.io/ent/cmd/ent is not in std`**
A: 在 `server/` 下先 `go mod tidy`, Ent 依赖才会进 go.sum.

**Q: 集成测试报 `permission denied for table events` 还报对地方了吗?**
A: 报对了 — `TestEventsAreAppendOnly` 就是要看到 42501 permission denied. 看到了说明 REVOKE 生效.

---

## 路线图

| Phase | 周数 | 模块 |
|---|---|---|
| 1 · 安静 | W1-W8 | M1 数据底座 / M2 信号管道 / M3 客户端外壳 / M4 端到端 |
| 2 · 仪式 | W9-W18 | M5 五轮追问 / M6 四道门 / M7 承诺书 / M8 签字 |
| 3 · 镜子 | W19-W26 | M9 持仓陪伴 / M10 退出巡检 / M11 复盘训练 |

每个 Phase 末有"自己用一周". 详细任务单在 `docs/GOAL/phase-*/`.

---

## 给 AI Agent 的话

任何 AI 接入前先读 [docs/GOAL/AGENT_BRIEF.md](docs/GOAL/AGENT_BRIEF.md). 没读那份就开干 = 没读题就交卷.

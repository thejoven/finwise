# 财富密码（Cipher）

> 把模糊的高价值信号, 转化为少数高确定性承诺的 AI 产品.

完整背景见 [docs/README.md](docs/README.md). AI Agent 必读 [docs/GOAL/AGENT_BRIEF.md](docs/GOAL/AGENT_BRIEF.md).

---

## 仓库布局

```
.
├── server/         # Go 后端 (Phase 1 起步, gin + pgvector + iii engine over HTTP)
├── mastra/         # Node LLM worker (Analyst / Editor / Diagnostician, tsx 直跑)
├── mobile/         # Expo / React Native 客户端 (M3 起)
├── web-admin/      # Vite + shadcn/ui 后台 (admin SPA + nginx 反代)
├── docs/           # 产品文档 / 技术文档 / GOAL 路线图 / ADR
├── scripts/        # 迁移 / 部署 / 同步辅助脚本
├── docker-compose.yml      # 单文件复用 dev (infra) + prod (全栈) + migrate
└── Makefile        # 所有常用命令的入口
```

---

## 当前进度

`Phase 1 → Phase 2`. M1 (数据底座) / M2 (信号管道) / M3 (客户端外壳) / M4 (端到端) 已落,
正在进入 M5 (五轮追问) — 仪式层. 详细路线图见底部.

---

## 三种运行方式

| 场景 | 用什么 | 跑哪里 |
|---|---|---|
| 本地写代码 / 跑测试 | `docker compose up -d` (postgres+redis+iii+console) + `make run` | Mac |
| 现行内网部署 | `./scripts/remote-sync.sh` (rsync + systemd restart) | `root@192.168.1.205` |
| **Docker 全栈部署 (新)** | `docker compose --profile prod up -d --build` | 任意 Linux/Docker 主机 |

下面分别讲.

---

## A. 本地开发 (M1 阶段验收用)

### 前置

- macOS arm64 / Linux (其他平台未测)
- Go 1.24+
- Docker Desktop (开一次接受协议)

```bash
# Go 在 ~/.local/sdk/go 的话:
export PATH="$HOME/.local/sdk/go/bin:$PATH"
```

### 跑起来

```bash
# 1) 配置 env
cp .env.example .env
# 编辑 .env, 把 DEV_USER_ID 填一个 uuidgen 生成的值
uuidgen

# 2) 起基础设施 (postgres + redis + iii + iii-console, 都在 docker compose 里)
make dev
#    iii engine 现在是 compose service (iiidev/iii:0.16.1); 浏览器开 http://localhost:3113 看 iii console

# 3) 跑迁移
cd server && go mod tidy && cd ..
make migrate

# 4) 起 Go API
make run     # listens on :8080
```

另开一个 shell:

```bash
make healthz
# {"status":"ok"}
```

### 跑测试

```bash
export $(grep -v '^#' .env | xargs)
make test
```

集成测试里 `TestEventsAreAppendOnly` **必须过** — 它是事件溯源的物理守门 (REVOKE
是否生效).

### 网络慢/在墙内

- `cd server && export GOPROXY=https://goproxy.cn,direct` 再 `go mod tidy`
- `npm config set registry https://registry.npmmirror.com/`

---

## B. 现行内网部署 (root@192.168.1.205)

后端跑 systemd + 宿主 nginx, 本地只改代码 + rsync. 完整细节见 [SERVER.md](SERVER.md).

```bash
# 全推 (Go + Mastra 都 rebuild + restart)
./scripts/remote-sync.sh --all
```

这条路是 Phase 1/2 期间日常 dev loop, 不依赖 Docker 重建. Docker 部署见下面.

---

## C. Docker 全栈部署

把后端 (postgres + redis + iii + iii-console + api + mastra + web-admin) 全跑在一台 Linux 主机的
docker compose 里; iii engine 现在也是 compose service (`wiseflow-iii`, image `iiidev/iii:0.16.1`),
api / mastra 走 compose 网络的服务名 `iii` 接它, 不再依赖 host systemd / host.docker.internal. 适合:

- 在另一台机器搭一份测试环境
- CI 起完整 E2E 环境
- 给协作者一键拉起本地全栈

### 架构

```
                ┌─────────────────────────────────────┐
                │           compose network           │
                └─────────────────────────────────────┘

   ┌──────────┐     ┌─────────────┐     ┌──────────────┐
   │ postgres │◀───▶│     api     │◀───▶│    mastra    │
   │  :5432   │     │  :8080 gin  │     │ :9091 iiiSDK │
   └──────────┘     └──────┬──────┘     └──────┬───────┘
                           │ POST              │ WS
                           │ /v1/events/*      │ :49134
                           ▼                   ▼
   ┌──────────┐     ┌──────────────────────────────────┐
   │  redis   │     │            iii engine            │
   │  :6380   │     │  wiseflow-iii (iiidev/iii:0.16.1) │
   └──────────┘     │  HTTP :3111   WS :49134          │
   ┌──────────┐     │  queue+state -> iiidata volume   │
   │web-admin │     └────────────────┬─────────────────┘
   │ nginx:80 │              ┌────────▼────────┐
   └──────────┘              │   iii-console   │
   ┌──────────┐              │      :3113      │
   │ migrator │              └─────────────────┘
   └──────────┘

   宿主端口 (默认):
     :8080  → api          (curl / mobile 用)
     :8082  → web-admin    (浏览器访问后台)
     :5432  → postgres
     :6380  → redis        (限流/行为指纹; iii 0.16 file_based 后非必需)
     :3111  → iii HTTP     (Go outbox 推事件用)
     :49134 → iii WS       (Mastra SDK worker 连接用)
     :3113  → iii console  (DLQ / queue stats / OTel)
     :9464  → iii metrics  (prometheus)
```

### 一次性配置

```bash
# 1) 拷一份 docker 部署专用的 env
cp .env.docker.example .env

# 2) 填关键字段:
#    - POSTGRES_PASSWORD     生产强密码
#    - DEV_USER_ID           uuidgen
#    - DEV_BEARER_TOKEN      openssl rand -base64 24
#    - INTERNAL_TOKEN        openssl rand -base64 24
#    - LLM_API_KEY           DeepSeek/OpenAI/Anthropic 之一的 key
$EDITOR .env
```

> `.env` 已 gitignore. 不要 commit.

### 命令

```bash
# 起全栈 (api + mastra + web-admin + 依赖). 首次会 build 3 个镜像.
make docker-up
# 等价: docker compose --profile prod up -d --build

# 跑迁移 (一次性 job, 跑完容器自动清掉)
make docker-migrate
# 等价: docker compose --profile migrate run --rm migrator up

# 状态 / 健康
docker compose --profile prod ps
curl -fsS http://localhost:8080/healthz

# 跟日志
make docker-logs
# 等价: docker compose --profile prod logs -f api mastra

# 停服 (保留卷)
make docker-down

# 彻底清空 (含数据卷, 危险!)
docker compose --profile prod down -v
```

### 推到远程主机

`scripts/docker-deploy.sh` 把代码 rsync 上去 + 在远端 docker compose build/up.
默认目标是 `root@192.168.1.205` (与现行 SERVER.md 一致, 可通过 `WISEFLOW_HOST` 覆盖).

```bash
# 推 + build + 跑迁移 + 起服务
make docker-deploy

# 或显式:
./scripts/docker-deploy.sh                   # 默认 == --build
./scripts/docker-deploy.sh --no-build        # 只 rsync, 不 rebuild
./scripts/docker-deploy.sh --migrate         # 只跑迁移
./scripts/docker-deploy.sh --logs            # 跟远端日志

# 推到别的机器
WISEFLOW_HOST=root@10.0.0.50 ./scripts/docker-deploy.sh
```

部署目标机的前置:

```bash
ssh root@target 'docker --version && docker compose version'
# Docker Engine 24+, Compose v2 即可. Ubuntu 22.04 默认仓库版本太老,
# 装新版见 https://docs.docker.com/engine/install/ubuntu/

# 目标目录 (与 docker-deploy.sh 默认对齐):
ssh root@target 'mkdir -p /opt/wiseflow && chmod 700 /opt/wiseflow'

# 服务器侧 .env 必须先手动创建一次 (含 LLM key + 强密码), 之后由 rsync 跳过.
ssh root@target 'test -f /opt/wiseflow/.env || echo "需要先 scp .env.docker.example 模板填好上传"'
```

### 镜像构建参数 (墙内提速)

```bash
GOPROXY=https://goproxy.cn,direct \
NPM_REGISTRY=https://registry.npmmirror.com/ \
  docker compose --profile prod build
```

或写进 `.env`:

```env
GOPROXY=https://goproxy.cn,direct
NPM_REGISTRY=https://registry.npmmirror.com/
```

### Docker 部署 vs systemd 部署 区别

| 维度 | systemd (SERVER.md) | Docker (本节) |
|---|---|---|
| API 进程 | `systemctl status wiseflow-api` | `docker compose logs api` |
| Mastra | `systemctl status wiseflow-mastra` | `docker compose logs mastra` |
| iii engine | docker compose `iii` (基础设施层) | docker compose `iii` (同一份 compose) |
| Web admin | 宿主 nginx 直接 serve dist/ | nginx 容器 + 反代 api 容器 |
| 迁移 | `bash scripts/migrate.sh up` (宿主) | `make docker-migrate` (一次性容器) |
| INTERNAL_LOOPBACK | `true` (同机 loopback) | **`false`** (容器之间走 docker 网络) |
| 重启某个组件 | `systemctl restart wiseflow-mastra` | `docker compose restart mastra` |

两条路可以同机切换, 但不要同时跑 (iii queue 同名 consumer 多实例会争消息, mastra 会冲突).

---

## 常见问题

**Q: `make run` 报 `missing required env: DATABASE_URL ...`**
A: `.env` 没拷或没填. 跑 `cp .env.example .env` 并填 `DEV_USER_ID`.

**Q: `make migrate` 报 `connection refused`**
A: docker 没起或 postgres 还没 healthy. `docker compose ps` 看一下, 等 healthcheck 变 `healthy` 再 migrate.

**Q: `make docker-up` 卡在 `Error response from daemon: pull access denied`**
A: 这里不需要 pull, 是本地 build. 检查 `docker compose --profile prod config` 看 image 字段是不是 `wiseflow/*:local`. 如果是, 跑一次 `docker compose --profile prod build` 强制构建.

**Q: docker compose 报 `DEV_USER_ID required, run uuidgen and set it in .env`**
A: 用了 `--profile prod`, 但 `.env` 没填关键字段. 这是有意的硬失败 — 见 `.env.docker.example`.

**Q: 集成测试报 `permission denied for table events` 还报对地方了吗?**
A: 报对了 — `TestEventsAreAppendOnly` 就是要看到 42501 permission denied. 看到了说明 REVOKE 生效.

**Q: mastra 容器起来但 api 调它一直 timeout**
A: 检查 mastra 的 `MASTRA_HTTP_BIND`. 在容器里**必须**是 `0.0.0.0` (compose 已设好), 设成 `127.0.0.1` 时 api 容器跨网络访问不到.

---

## 路线图

| Phase | 周数 | 模块 |
|---|---|---|
| 1 · 安静 | W1-W8 | M1 数据底座 / M2 信号管道 / M3 客户端外壳 / M4 端到端 |
| 2 · 仪式 | W9-W18 | M5 五轮追问 / M6 投决会 / M7 承诺书 / M8 签字 |
| 3 · 镜子 | W19-W26 | M9 持仓陪伴 / M10 退出巡检 / M11 复盘训练 |

每个 Phase 末有"自己用一周". 详细任务单在 `docs/GOAL/phase-*/`.

---

## 给 AI Agent 的话

任何 AI 接入前先读 [docs/GOAL/AGENT_BRIEF.md](docs/GOAL/AGENT_BRIEF.md). 没读那份就开干 = 没读题就交卷.

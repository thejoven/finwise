# Dev Server · 192.168.1.205

> 后端不在 Mac 本地跑了. Go API + Postgres + Redis + iii engine 都在内网 Ubuntu 22.04 主机上.
> 本地只写代码, 用 `scripts/remote-sync.sh` 推上去.
>
> **拓扑**: Go API · Mastra 跑 systemd; Postgres · Redis · iii engine 跑 docker compose; systemd 服务通过 host loopback 跨入 docker 网络.

---

## 服务器现状

| 项 | 值 |
|---|---|
| Host | `root@192.168.1.205` |
| OS | Ubuntu 22.04.5 LTS, x86_64 |
| Docker | 29.3.0 (registry mirrors: docker.1ms.run / xuanyuan.me / rat.dev / m.daocloud.io) |
| Go | 1.25.4 在 `/usr/local/go`, 软链 `/usr/local/bin/go` |
| Node | 20.19.0 在 `/usr/local/node-v20`, 软链 `/usr/local/bin/{node,npm,npx}`, npm registry → npmmirror |
| 项目目录 | `/opt/flashfi/` |
| API 二进制 | `/opt/flashfi/bin/flashfi-api` |
| API service | `systemctl status flashfi-api` |
| API log | `/var/log/flashfi-api.log` |
| Mastra 路径 | `/opt/flashfi/mastra/` (tsx 直跑, 不 build) |
| Mastra service | `systemctl status flashfi-mastra` |
| Mastra log | `/var/log/flashfi-mastra.log` |
| Mastra env | `/opt/flashfi/mastra/.env` (含 LLM_API_KEY, 600 权限) |
| Server .env | `/opt/flashfi/.env` (gitignored, token 已生成) |
| iii engine | docker compose service `iii` (image `iiidev/iii:0.16.0`), config bind-mount `/opt/flashfi/iii/config.yaml`, 数据 named volume `flashfi_iiidata` |
| iii 容器 user | `65532` (nonroot), volume mountpoint 必须 `chown 65532:65532` (见"灾难恢复") |
| iii console (UI) | docker compose service `iii-console` (image `flashfi/iii-console:0.16.0`, 自己用 [iii/Dockerfile.console](iii/Dockerfile.console) build, 上游没出 docker 镜像), 默认监听 `0.0.0.0:3113` |
| iii console URL | `http://192.168.1.205:3113` (LAN 任意机器可访问) |
| 端口 | 8080 (API) · 9091 (mastra, **loopback only**, 9090 被 mihomo 占了) · 5432 (postgres) · 6380 (redis, 6379 被 mm-redis 占) · 3111 (iii HTTP) · 49134 (iii WS, SDK worker) · 3113 (iii console UI) · 9464 (iii prometheus) · 8082 (web-admin nginx) |

UFW 已禁用 + iptables INPUT 空. 局域网内任意机器可访问.

---

## 凭据 (生成时间: 2026-05-25)

```
DEV_USER_ID         = 6227c7c6-ed9e-4f8a-86e7-0518a761c32a
DEV_BEARER_TOKEN    = uaR0GcVn_aEX0E4DzIz0mQXuUlDnzRW9
INTERNAL_TOKEN      = aosSQFzXVc3tgsrm24DnZNYtHpbB4yPl
INTERNAL_LOOPBACK   = true    # Mastra 已迁到 .205, server 只接受 loopback 调用 (2026-05-26 起)
MASTRA_HTTP_URL     = http://127.0.0.1:9091
```

mobile/.env 和本地 mastra/.env 的对应字段已经预填了这俩 token. 你换 token 时记得三边都改 (server / mastra-on-205 / mobile).

---

## 三步开发循环

```bash
# 1) 本地改代码

# 2) 推上去 + 自动 rebuild + restart
./scripts/remote-sync.sh
# 末尾会自动打印 API 日志最后 40 行, 看到 "http listen" 就行

# 3) 测
curl -fsS http://192.168.1.205:8080/healthz
# {"status":"ok"}

curl -sS -X POST http://192.168.1.205:8080/v1/signals \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer uaR0GcVn_aEX0E4DzIz0mQXuUlDnzRW9" \
  -d "{\"client_event_id\":\"$(uuidgen)\",\"raw_text\":\"今天供应商说 HBM 又涨价了\"}"
```

只想推代码不 rebuild:

```bash
./scripts/remote-sync.sh --no-build
```

只看日志:

```bash
./scripts/remote-sync.sh --logs
# 或直接 ssh
ssh root@192.168.1.205 'tail -f /var/log/flashfi-api.log'
```

改了 mastra (TS) 代码, 只重启 mastra:

```bash
./scripts/remote-sync.sh --mastra
# rsync + systemctl restart flashfi-mastra + tail mastra log
```

全推 (Go + mastra 都重启):

```bash
./scripts/remote-sync.sh --all
```

---

## 在服务器上手动操作

```bash
ssh root@192.168.1.205

# 服务管理
systemctl status flashfi-api
systemctl restart flashfi-api
journalctl -u flashfi-api -f       # 也能跟 stdout

# 看 docker 状态 (postgres + redis + iii 都在这里)
cd /opt/flashfi
docker compose ps
docker compose logs -f redis
docker compose logs -f postgres
docker compose logs -f iii

# iii engine 已经搬进 docker compose (image iiidev/iii:0.16.0)
# 老的 flashfi-iii.service systemd 已下线, 不要再用 systemctl
docker compose restart iii            # 重启 engine
docker compose down iii && docker compose up -d iii   # 拉新镜像

# iii console UI (浏览器看 DLQ / queue stats / functions / OTel)
docker compose restart iii-console
docker compose logs -f iii-console
# console 镜像本地 build (Mac 上必须 amd64), 再 save/load 上来; 见下文
# 浏览器开: http://192.168.1.205:3113

# 直连 postgres
docker compose exec postgres psql -U flashfi -d flashfi

# 重跑迁移
bash scripts/migrate.sh status     # 看哪些 applied / pending
bash scripts/migrate.sh up         # 应用 pending
bash scripts/migrate.sh down 1     # 回滚最近一个

# 重 build 二进制
cd /opt/flashfi/server
go build -o /opt/flashfi/bin/flashfi-api ./cmd/api
systemctl restart flashfi-api

# mastra service 管理
systemctl status flashfi-mastra
systemctl restart flashfi-mastra        # 改了 mastra/src/* 后用
tail -f /var/log/flashfi-mastra.log     # 看 mastra 日志
# 改了 mastra/package.json 后:
cd /opt/flashfi/mastra && npm install && systemctl restart flashfi-mastra
```

---

## Mastra (2026-05-26 起跑在 .205)

Mastra 已经从 Mac (.110) 迁到 .205, 跟 API / iii engine / Postgres 同机. 走 loopback 通信
(`MASTRA_HTTP_URL=http://127.0.0.1:9091`, `INTERNAL_LOOPBACK=true`). 9091 端口是因为 9090
被 mihomo (Clash 代理) 占了.

```
/opt/flashfi/mastra/
├── .env                # LLM_API_KEY 在这里, 600 权限. III_URL/API 都指 localhost
├── src/                # TS 源码, tsx 直跑不 build
├── node_modules/       # npm install (走 npmmirror) 装好
└── ...
```

systemd unit 在 `/etc/systemd/system/flashfi-mastra.service`. ExecStart:
`/usr/local/bin/node /opt/flashfi/mastra/node_modules/.bin/tsx /opt/flashfi/mastra/src/index.ts`.

INTERNAL_LOOPBACK=true 意味着 server 拒绝任何**非 loopback** 的 `/v1/internal/*` 调用 — 想本地再起一份 mastra 调 .205, 先把 server `.env` 改回 false 并 restart.

**重要约定**: iii queue consumer 同一 queue 上多实例会抢消息. 本地再启动 `npm run dev` 跟 .205 mastra
连同一个 iii engine 时会抢任务. 想本地 dev 时, 先 `ssh root@192.168.1.205 systemctl stop flashfi-mastra`.

**iii v0.16.0 跑 docker 的原因**: 0.16.0 把 native worker 模型改成 microVM 沙箱化,
在 205 Ubuntu 上跟 sshd 抢网络命名空间 — 跑过两次都把 sshd 拽挂了. Docker 镜像里设置
`III_EXECUTION_CONTEXT=docker`, queue/state/http worker 改回 in-process, 绕开了沙箱.
2026-05-29 切到 docker 后稳定. 镜像 user 是 nonroot (65532), 第一次启动要给 named volume
chown 65532:65532 才能持久化队列, 见"灾难恢复".

~~INTERNAL_LOOPBACK 在服务器 .env 里被设为 false 就是为了让 Mastra 从 Mac 调 `/v1/internal/*` 不被 loopback 限制.~~ (历史: 2026-05-26 后改为 true, mastra 走 loopback 直连.)

---

## SSH key

我装好了 `~/.ssh/id_ed25519_clh_520jwenlee` 到服务器 `~/.ssh/authorized_keys`. 后续不要再用密码.

密码本身别再贴在仓库或文档里 — 已经从 chat 流出, **轮换它**:

```bash
ssh root@192.168.1.205 'passwd'
# 也可禁掉密码登录:
ssh root@192.168.1.205 'sed -i "s/^#*PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && systemctl reload ssh'
```

---

## Web admin (web-admin/)

shadcn/ui 后台. 静态构建产物落 `/opt/flashfi/web-admin/dist`, 由系统自带 nginx 在 `:8082` serving, 同时把 `/v1/*` / `/healthz` / `/metrics` 反代到 `127.0.0.1:8080`. 访问:

```
http://192.168.1.205:8082/
```

登录用 `.env` 里的 `DEV_BEARER_TOKEN`. 后续部署:

```bash
make admin-deploy
# 或
cd web-admin && ./deploy/deploy.sh             # 默认: build + rsync + nginx reload
cd web-admin && ./deploy/deploy.sh --no-build  # 只推 dist/
cd web-admin && ./deploy/deploy.sh --nginx     # 只刷 nginx site
```

nginx vhost 模板在 `web-admin/deploy/flashfi-admin.nginx.conf`. 改端口走环境变量 `ADMIN_PORT=9000 ./deploy/deploy.sh`.

---

## 灾难恢复

服务器重启后:
- Docker 容器 (postgres / redis / iii): 都设了 `restart: unless-stopped`, 自动起
- flashfi-api: 已 `systemctl enable`, 跟随启动
- flashfi-mastra: 已 `systemctl enable`, 跟随启动 (依赖 docker iii + docker postgres, 启动顺序由 systemd `After=docker.service` 处理)

iii 第一次起 (或换 named volume 后) 必做一次 chown, 否则 queue 持久化报权限:

```bash
ssh root@192.168.1.205 '
docker compose -f /opt/flashfi/docker-compose.yml up -d iii
VOL=$(docker volume inspect flashfi_iiidata -f "{{.Mountpoint}}")
chown -R 65532:65532 "$VOL"
docker compose -f /opt/flashfi/docker-compose.yml restart iii
'
```

完全重建:

```bash
ssh root@192.168.1.205 'cd /opt/flashfi && \
  systemctl stop flashfi-mastra flashfi-api && \
  docker compose down -v && \
  docker compose up -d postgres redis iii && \
  VOL=$(docker volume inspect flashfi_iiidata -f "{{.Mountpoint}}") && chown -R 65532:65532 "$VOL" && \
  docker compose restart iii && \
  sleep 5 && \
  bash scripts/migrate.sh up && \
  systemctl start flashfi-api flashfi-mastra'
```

**警告**: `docker compose down -v` 会**删数据卷** (postgres 业务数据 + iii queue 持久化数据). 已经录的信号 + 队列里在飞的任务都没了, 用前确认.

**rsync --delete 坑**: `scripts/remote-sync.sh` 默认 rsync 会 `--delete`, 而本地 `bin/` 是 gitignored
所以本地是空的 → 服务器上 `/opt/flashfi/bin/flashfi-api` 会被清掉. 跑 `--no-build` 之后必须紧跟一次 build:

```bash
ssh root@192.168.1.205 'cd /opt/flashfi/server && /usr/local/go/bin/go build -o /opt/flashfi/bin/flashfi-api ./cmd/api && systemctl restart flashfi-api'
```

或直接用 `./scripts/remote-sync.sh` (默认带 build) / `--all` (顺带 mastra 重启).

---

## iii-console 镜像怎么更新 (Mac → 205)

`iii-console` 上游没出官方 docker 镜像, 我们自己用 [iii/Dockerfile.console](iii/Dockerfile.console) 装. 镜像在 `docker.io/flashfi/iii-console:0.16.0` (本地 tag, 不推 registry). 跟一般 docker pull 不一样:

- 205 上 `docker compose build iii-console` **常常失败** — alpine repo 在 GFW 外, `apk add ca-certificates` 拉不到
- 解法是 Mac 本地 build, 然后 `docker save | ssh docker load` 灌过去
- **Mac 是 Apple Silicon**, 默认 build 是 arm64 — 205 是 amd64 — 不指定 platform 会跑 qemu, 慢且会有警告

正确流程:

```bash
# Mac 上
docker buildx build --platform linux/amd64 --load \
  -t flashfi/iii-console:0.16.0 \
  -f iii/Dockerfile.console iii/

docker save flashfi/iii-console:0.16.0 \
  | ssh root@192.168.1.205 'docker load'

ssh root@192.168.1.205 'cd /opt/flashfi && docker compose up -d --force-recreate --no-build iii-console'
```

要升 console 版本: 改 `iii/Dockerfile.console` 里的 `ARG VERSION` 和 docker-compose `args.VERSION`, 然后跑上面三步.

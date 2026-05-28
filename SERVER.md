# Dev Server · 192.168.1.205

> 后端不在 Mac 本地跑了. Go API + Postgres + NATS 都在内网 Ubuntu 22.04 主机上.
> 本地只写代码, 用 `scripts/remote-sync.sh` 推上去.

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
| 端口 | 8080 (API) · 9091 (mastra, **loopback only**, 9090 被 mihomo 占了) · 5432 (postgres) · 4222 (NATS) · 8222 (NATS monitor) · 8082 (web-admin nginx) |

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

# 看 docker 状态
cd /opt/flashfi
docker compose ps
docker compose logs -f nats
docker compose logs -f postgres

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

Mastra 已经从 Mac (.110) 迁到 .205, 跟 API / NATS / Postgres 同机. 走 loopback 通信
(`MASTRA_HTTP_URL=http://127.0.0.1:9091`, `INTERNAL_LOOPBACK=true`). 9091 端口是因为 9090
被 mihomo (Clash 代理) 占了.

```
/opt/flashfi/mastra/
├── .env                # LLM_API_KEY 在这里, 600 权限. NATS/API 都指 localhost
├── src/                # TS 源码, tsx 直跑不 build
├── node_modules/       # npm install (走 npmmirror) 装好
└── ...
```

systemd unit 在 `/etc/systemd/system/flashfi-mastra.service`. ExecStart:
`/usr/local/bin/node /opt/flashfi/mastra/node_modules/.bin/tsx /opt/flashfi/mastra/src/index.ts`.

INTERNAL_LOOPBACK=true 意味着 server 拒绝任何**非 loopback** 的 `/v1/internal/*` 调用 — 想本地再起一份 mastra 调 .205, 先把 server `.env` 改回 false 并 restart.

**重要约定**: NATS JetStream durable consumer 是独占的, 同一 durable name 只能一个 mastra 进程 active.
本地再启动 `npm run dev` 会让 .205 mastra fatal "duplicate subscription". 想本地 dev 时,
先 `ssh root@192.168.1.205 systemctl stop flashfi-mastra`.

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
- Docker 容器: `restart: unless-stopped` 没设, 我会在下次 sync 加上, 暂时手动 `docker compose up -d`
- flashfi-api: 已 `systemctl enable`, 跟随启动
- flashfi-mastra: 已 `systemctl enable`, 跟随启动 (依赖 flashfi-api + docker NATS, 启动顺序由 systemd 处理)

完全重建:

```bash
ssh root@192.168.1.205 'cd /opt/flashfi && \
  systemctl stop flashfi-mastra flashfi-api && \
  docker compose down -v && \
  docker compose up -d && \
  sleep 5 && \
  bash scripts/migrate.sh up && \
  systemctl start flashfi-api flashfi-mastra'
```

**警告**: `docker compose down -v` 会**删数据卷**. 已经录的信号没了, 用前确认.

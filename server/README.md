# server/

Go 后端. Phase 1 起步.

```
cmd/api/main.go              # HTTP 入口
internal/
  config/                    # env 加载
  domain/                    # 业务类型 (Event, Signal) - 无 infra 依赖
  httpapi/                   # 路由 + middleware
  infra/
    db/                      # pgx 连接 + repository
      schema/                # Ent schema 定义 (codegen 输入)
    nats/                    # NATS JetStream 连接
  module/
    signal/                  # M2 业务模块的占位
ent/                         # `make ent-gen` 输出 (gitignored 由 ent/ 子目录视情况)
migrations/                  # golang-migrate SQL 文件
```

## 边界

- `domain/` 不依赖 `infra/` 或 `httpapi/`. 反向依赖.
- `module/<x>/` 是垂直切片. 一个模块的 routes + service + repository 都在它自己目录里.
- `infra/db/` 提供数据库基础设施, repository 实现可以放 module 里也可以放这里 (events 这种跨模块共用的放 infra/db).

## 测试

- 单元测试: 默认 `go test ./...` 全跑.
- 集成测试: 需要 `TEST_DATABASE_URL` 或 `DATABASE_URL` env. 无 env 自动 skip — 不会假绿.

# ADR 0001 · 选 Ent 作为 ORM

- 状态: Accepted
- 日期: 2026-05-24
- 模块: M1 数据底座

## 上下文

Phase 1 需要在 Go 后端有一个对 `events` 表的类型安全访问层. 候选:

1. **sqlc** — 从 SQL 生成 Go 代码
2. **Ent** — 从 schema 定义生成 Go 代码 + query builder
3. **GORM** — 反射式 ORM
4. **手写 pgx** — 不引 ORM

## 决策

**用 Ent**, 但**只用作 read-side 查询构造器**, 不用它的 auto-migrate.

## 为什么

- Ent 的 schema graph 更接近 Phase 2/3 要做的"承诺 → 信号 → 复盘"关联查询. 一次定义, 后续派生.
- 生成的 query builder 编译期就能查出错误, 不像 GORM 反射期才暴露.
- sqlc 适合"SQL 是规范"的项目, 但 Phase 2 会有大量关联查询(承诺 join 信号 join 退出条件), 用 sqlc 写起来重复.
- 手写 pgx 在 events 这种简单表上没问题, 但 Phase 2 会变成手写 50 个 query 函数, 不可维护.

**为什么不用 Ent auto-migrate**: schema 演化的真相必须在 `server/migrations/*.sql`, 不在 Go 代码. 原因:
- DBA 视角(就是我自己) 看 SQL 比看 Go schema 直观
- Postgres-only 的特性(REVOKE, partial index, JSONB GIN index, pgvector)在 Ent 里要靠 annotation 兜, 不如直接 SQL 清楚
- Ent 改 schema 会试着 ALTER 表, 在 events 这种 append-only 表上很危险

## 后果

- 双写: schema 既在 SQL 又在 Ent. 必须保持一致, 否则 query 报错.
- M1 的 repository 暂时直接用 pgx (Ent 还没 `make ent-gen` 出来). M2 引入第一个真业务查询时再切到 Ent client.
- `make ent-gen` 在 PR 流程里必须跑过, 不能漏.

## 复盘条件

如果 Phase 2 中后期发现 Ent 的 query builder 表达不出我们想要的 SQL, 或者生成的代码量超 5000 行, 重新评估是否切 sqlc.

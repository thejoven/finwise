# Migrations

Managed by [golang-migrate](https://github.com/golang-migrate/migrate).

**Ent 的 auto-migrate 被关闭**. schema 的真相在这个目录, Ent 只读不写.

## 命名

`<NNN>_<verb>_<noun>.<up|down>.sql` — 三位序号 + 动词 + 名词. 上下成对.

## 写新迁移

```bash
migrate create -ext sql -dir server/migrations -seq <name>
```

## 跑

```bash
make migrate         # up
make migrate-down    # 回退最后一个
```

## 已知坑

- `down.sql` 仅用于本地重建. 不要在有真实数据的环境跑.
- events 表的 `REVOKE` 在每次重建后都会重新生效, 不用单独处理.
- 加新表时, 如果是 append-only 性质, 一并加 `REVOKE UPDATE, DELETE, TRUNCATE`.

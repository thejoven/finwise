# ADR 0002 · events 表用 REVOKE 物理强制 append-only

- 状态: Accepted
- 日期: 2026-05-24
- 模块: M1 数据底座

## 上下文

财富密码 是事件溯源系统. `events` 表是所有业务派生(`signals` 物化视图、承诺、复盘)的唯一真相. 任何对历史事件的修改都会让派生失真.

候选:
1. **应用层约定** — code review + lint 规则
2. **触发器** — `BEFORE UPDATE OR DELETE` 抛错
3. **REVOKE 权限** — Postgres 在执行计划阶段就拒绝
4. **separate role** — 业务用户没有 UPDATE/DELETE 权限, 只有 admin 有

## 决策

**用 REVOKE**, 在 dev / staging / prod 一致开启.

## 为什么

- 应用层约定: 任何一个 PR 写错就破防. 不接受.
- 触发器: 抛错是 runtime, 不在 query planner. 而且 `TRUNCATE` 绕过 ROW 级触发器, 还是能清表.
- REVOKE: 物理层拒绝, 连 query 计划都生成不出. `TRUNCATE` 也包含在 REVOKE 里.
- separate role: 复杂度太高, Phase 1 只有一个用户(我), 不需要多角色.

**关键点**: REVOKE 在 dev 期间也要写. 不要"以后再加" — 那个"以后"永远不来, 而中间任何一次"快速调一下数据"都会埋雷.

## 后果

- 任何写错的事件(payload 写漏字段) 无法 UPDATE 修改, 只能补一条新事件做修正. 这正是事件溯源的意图.
- 跑数据库重建测试时, 必须先 `migrate up` (会重新 REVOKE), 不能用现有 schema.
- 集成测试要有一个 `TestEventsAreAppendOnly` 守门, 任何回归改 migration 都会被它接住.

## 例外

- `migrate down` 会 DROP TABLE — 这是允许的, 因为重建是显式动作.
- 未来加 `events_archive`(冷存归档) 时, 归档 + 删除是一个事务里两步, 用 `SECURITY DEFINER` 函数处理, 不打开 events 的 DELETE 权限.

## 复盘条件

如果有合规需求要求"删除特定用户数据" (GDPR style), 不开 DELETE, 而是写一个 SECURITY DEFINER 函数 `redact_user(uuid)` 把那些事件的 payload 替换成 `{"redacted": true}`, 保留 id / type / 时间戳.

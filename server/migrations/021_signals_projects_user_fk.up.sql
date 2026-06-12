-- 021: signals / projects 的 user_id 外键 —— 从根上杜绝"用户不存在的孤儿信号/分类".
--
-- 背景: signals.user_id 与 projects.user_id 原本是裸 UUID 列, 无外键约束. 早期开发
-- 删除用户后, 其 signals 变成无主孤儿 (user_id 指向已不存在的 users 行); 这些孤儿
-- 信号 project_id 多为 NULL, 在 UI 上不可达却长期滞留 (2026-06-11 已级联清理 29 条
-- 孤儿信号及其 refinement/gate/commitment/retrospect 下游, 共 99 行).
--
-- 本迁移补上外键, 防止再产生孤儿:
--   - 写入: 不能再插入 user_id 不存在的 signal / project (insert 即校验).
--   - 删除: 删 user 时 ON DELETE CASCADE 连带清其 signals / projects.
--     注意: 若该 user 的某条 signal 仍挂着 refinement_sessions 等 RESTRICT 子链,
--     删 user 会被这些子链阻止 —— 这是有意保护"重数据"(投决会/承诺/复盘), 需走
--     应用层有序清理, 而非让 DB 一路 CASCADE 删掉. 这里只保证"不留孤儿".
--
-- 前置: 库中 signals / projects 必须已无孤儿 user_id (本迁移前已清理). 否则
-- ADD CONSTRAINT 校验现有行时会报错中止.

ALTER TABLE signals
    ADD CONSTRAINT signals_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE projects
    ADD CONSTRAINT projects_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

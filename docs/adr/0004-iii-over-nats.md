# ADR 0004 · 异步事件总线从 NATS JetStream 切到 iii 编排引擎

- 状态: Accepted
- 日期: 2026-05-29
- 模块: 异步事件管道 / M6 gate / M11-bis 注意力诊断

## 上下文

财富密码 的异步链路是"信号录入 → 后台推演 → 回写"。最初用 **NATS JetStream** 做事件总线:Go 发布 `signal.captured` 等主题,Mastra 起 consumer 订阅、跑 Workflow、回写 Go。gate 评估也挂了一个独立的 NATS consumer。

它能跑,但有几处不顺手:

1. **投递可靠性靠自己拼**。"业务落库" 和 "消息发出" 是两件事,要自己做 outbox 才能保证不丢;DLQ、重试、延迟重投都得手写。
2. **可观测性是黑盒**。哪条消息卡住了、哪个 consumer 在重试、DLQ 里堆了什么,没有现成 UI,只能 log 里捞。
3. **consumer 形态和 Mastra 不贴合**。Mastra 想要的是"注册几个 queue processor",NATS 的 subject/consumer 模型要额外一层适配。
4. **gate consumer 是多余的一跳**。门评估其实是"事件落库后立刻该做的事",绕一圈 NATS 反而引入时序和失败面。

同期要上 M11-bis 注意力诊断,又要多一条异步队列(`attention-analyze`)。与其继续在 NATS 上摞自制脚手架,不如换一个把这些都内建的编排引擎。

候选:

1. **继续 NATS JetStream + 自制 outbox/DLQ/观测**
2. **Temporal / 类似 workflow 引擎** — 重,运维面大
3. **iii 编排引擎** — 内建命名队列 + at-least-once + retry + DLQ + console UI,HTTP 入队 / WS worker 的形态

## 决策

**换 iii 编排引擎(v0.16.0),配 transactional outbox**:

- Go 在**同一事务**里写 `events`(append-only 事实)和 `event_outbox`(待投递)。
- 进程内 `OutboxWorker` 每 500ms `FOR UPDATE SKIP LOCKED` 拉一批,按 `subject` POST 到 iii 的 HTTP shim(`/v1/events/*`)。
- iii engine 把请求 enqueue 到命名队列(`signal-inference` / `refinement-step` / `attention-analyze` / `commitment-draft`),at-least-once、retry=3、失败进 DLQ。
- Mastra 用 iii SDK worker 经 WS 拿任务跑 Workflow,完成后 POST `/v1/internal/*` 回写 Go。
- **gate 评估改走 outbox 的 PostPublish 回调内联执行**,删掉独立的 NATS gate consumer。
- iii engine 跑 **docker compose service**(不是 host systemd),0.16 用 `file_based` KV 持久化队列/状态,**不再依赖 Redis**。

拓扑细节见 [SERVER.md](../../SERVER.md) 与 [architecture-iii.html](../architecture-iii.html)。

## 为什么

- **投递语义内建**。命名队列 + at-least-once + retry + DLQ 出厂自带,我们只需要 transactional outbox 这一段(本来 NATS 也要写),换来"业务落库即必投递"的硬保证。
- **可观测性是一等公民**。iii console(DLQ / queue stats / functions / OTel)能直接在浏览器看队列堆积和死信,不用 log 里捞。
- **形态贴合 Mastra**。"Go 这边 HTTP 入队、Mastra 那边 WS 注册 processor" 正好对上 Mastra 的 skill/workflow 结构,适配层薄。
- **少一个移动件**。0.16 的 `file_based` KV 让 Redis 退成纯应用级缓存(限流/行为指纹),队列不再依赖它,基础设施少一个故障源。
- **gate 内联更顺**。门评估回到"事件落库后立刻做"的语义,少一跳网络、少一个 consumer 的失败面。

## 为什么不继续 NATS

- NATS 本身没问题,但我们要的 DLQ / 重试 / 队列观测 / consumer 脚手架都得自建,等于把 iii 内建的东西重写一遍。
- 单机单用户阶段,NATS 的多节点扩展优势用不上,反而是它的运维/配置成本先到。

## 为什么不 Temporal 之类

- 太重。我们要的是"几条命名队列 + DLQ + 看板",不是完整的分布式 workflow 引擎与它的运维负担。

## 后果

- **iii 必须跑 docker**。0.16 原生二进制的 microVM 沙箱在 205 Ubuntu 上跟 sshd 抢网络命名空间,跑挂过两次 sshd;docker 镜像设 `III_EXECUTION_CONTEXT=docker`、worker 改回 in-process 绕开沙箱。
- **iii-console 要自己 build**。上游不出 console 的 docker 镜像,用 [iii/Dockerfile.console](../../iii/Dockerfile.console) 把 musl 二进制装进 alpine;Mac 上必须 `buildx --platform linux/amd64` 再 save/load 上服务器。
- **踩到一个上游 bug**。v0.16 console 在"有 function 但无 trigger 的 worker"上会崩,已起草上游 issue,见 [iii-console-bug-report.md](../归档/iii-console-bug-report.md)(已修复, 归档)。
- **nonroot volume 权限坑**。iii 容器 user=65532,`iiidata` named volume 首次要 `chown 65532:65532` 才能持久化队列。
- **Redis 留着但闲置**。compose 里还在,业务无依赖,可按需删。
- 文档与代码:`server/internal/infra/iii/outbox.go` 取代 JetStream publish;`mastra/src/iii/worker.ts` 取代 `mastra/src/consumers/nats.ts`(已删)。

## 复盘条件

任意一项出现,重新评估(可能回退 NATS 或换引擎):

1. iii 上游一次升级破坏 SDK worker 契约 / 队列语义,且修复滞后。
2. console / DLQ 的可观测性在真实排障里证明不够用,还得自己加埋点。
3. 自建 console、nonroot chown、docker 沙箱这些运维负担,累计超过 iii 省下的脚手架成本。
4. 进入多节点 / 多用户阶段,需要 NATS 那种成熟的水平扩展与高可用,而 iii 给不了。

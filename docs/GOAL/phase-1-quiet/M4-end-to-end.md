# M4 · 端到端验证

> Phase 1 · W6-W7 · 2 周 · 收口模块, 必须 M1+M2+M3 全部完成才开始

---

## 上下文

M4 把 M1/M2/M3 三个孤立的部分**端到端串起来**。

完成后, 这条链路必须打通:

```
我打开 iPhone APP
  → 点底部 "+" 进入 B1 录入页
  → 写一句 "今天看到供应商说 HBM 又涨价了"
  → 点"记下"
  → 模态关闭, 回到 A1 收件箱
  → 看到新记录, 显示"AI 推演中"
  → 30 秒后(下拉刷新或自动)状态变成"AI 已推演"
  → 点开看到推演摘要

整个过程没有任何 toast, 没有 loading spinner。
离线也能录入, 联网自动同步。
```

这是 Phase 1 的**真正成果**, 前三个模块都是为它服务。

---

## 前置依赖

- ✅ M1 数据底座
- ✅ M2 信号管道(后端 + Mastra)
- ✅ M3 客户端外壳

---

## 目标

完成后, 用户可以在 iPhone 上做以下事情:

### B1 录入页(完整实现)
- 从底部 Tab 中间的 "记录" 进入(modal 滑入)
- 一句话输入(多行 TextInput)
- 不实时校验, 提交时才校验
- 点"记下", 模态关闭, 不弹任何反馈
- 离线时仍能记录, 加 "未同步" 标记

### A1 收件箱(简化版)
- 顶部 Masthead(M3 已做)
- 顶部状态戳: "今日: 沉默" / "今日: 5 条新记录"
- 一个 section: "本周记录", 列表
- 每条记录显示:日期、原文、AI 推演状态、推演摘要
- 下拉刷新

### Sync Queue
- 后台 worker 扫描 syncStatus = 'pending' 的记录, POST 到 /v1/signals
- 网络恢复后自动触发同步
- 失败重试 3 次, 然后标记 failed(显式让用户知道, 但不弹窗)

### 后端配合
- /v1/signals POST 接 M2 完成的接口
- /v1/signals GET 列表接 M2 完成的接口
- WebSocket / SSE 推送(可选, Phase 1 不强求, 用客户端定时 poll 替代)

---

## 任务列表

### Task 4.1 · WatermelonDB 集成 vs expo-sqlite 决策

**决策点**: Phase 1 用哪个本地数据库?

| 选项 | 优 | 劣 |
|---|---|---|
| WatermelonDB | offline-first 之王, lazy loading, observable | Managed Workflow 下需 prebuild |
| expo-sqlite | 零配置, 官方支持 | 没有 reactive, 要手写 query |

**建议**: 用 expo-sqlite + Drizzle ORM 兜底。
- 比 WatermelonDB 简单 50%
- 满足 Phase 1 需要(<1000 条记录, 不需要复杂同步)
- Phase 2 数据量上来后再决定是否切 WatermelonDB

```bash
npx expo install expo-sqlite
npm i drizzle-orm
```

### Task 4.2 · 本地 schema

`src/core/storage/schema.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const signals = sqliteTable('signals', {
  id: text('id').primaryKey(),                    // UUID v7 (client_event_id)
  rawText: text('raw_text').notNull(),
  capturedAt: integer('captured_at').notNull(),   // unix timestamp ms
  
  // 推演结果(server 回传后填充)
  inferenceStatus: text('inference_status').notNull().default('pending'),
  inferenceSummary: text('inference_summary'),
  tags: text('tags'),                              // JSON array as string
  
  // 同步状态
  syncStatus: text('sync_status').notNull().default('pending'), // pending/synced/failed
  syncError: text('sync_error'),
  serverEventId: integer('server_event_id'),
  
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

### Task 4.3 · Signal Repository

`src/features/capture/data/signal-repository.ts`:

```typescript
export async function captureSignal(rawText: string): Promise<string> {
  const clientEventId = uuidv7();
  const now = Date.now();
  
  await db.insert(signals).values({
    id: clientEventId,
    rawText,
    capturedAt: now,
    inferenceStatus: 'pending',
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  });
  
  // 异步触发 sync, 不阻塞
  syncQueue.enqueue(clientEventId);
  
  return clientEventId;
}

export async function getRecentSignals(limit = 20): Promise<Signal[]> {
  return db.select().from(signals)
    .orderBy(desc(signals.capturedAt))
    .limit(limit);
}
```

### Task 4.4 · Sync Queue

`src/core/sync/queue.ts`:

```typescript
class SyncQueue {
  private processing = false;
  
  async enqueue(signalId: string) {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.flush();
    } finally {
      this.processing = false;
    }
  }
  
  async flush() {
    const pending = await db.select().from(signals)
      .where(eq(signals.syncStatus, 'pending'));
    
    for (const signal of pending) {
      try {
        const resp = await api.post('v1/signals', {
          json: {
            client_event_id: signal.id,
            raw_text: signal.rawText,
            occurred_at: new Date(signal.capturedAt).toISOString(),
          },
        }).json<{ event_id: number }>();
        
        await db.update(signals)
          .set({
            syncStatus: 'synced',
            serverEventId: resp.event_id,
            updatedAt: Date.now(),
          })
          .where(eq(signals.id, signal.id));
      } catch (err) {
        // 重试逻辑
        await db.update(signals)
          .set({
            syncStatus: 'failed',
            syncError: String(err),
            updatedAt: Date.now(),
          })
          .where(eq(signals.id, signal.id));
      }
    }
  }
}
```

**已知坑**:
- 用 mutex 防止多次并发 flush
- 网络监测用 `@react-native-community/netinfo`
- 启动时全量扫描一次 pending

### Task 4.5 · B1 录入页

`app/capture.tsx`:

```typescript
import { useState } from 'react';
import { TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { TapEffect, Serif, Display } from '@/shared/components';
import { captureSignal } from '@/features/capture/data/signal-repository';
import { theme } from '@/core/theme';
import * as Haptics from 'expo-haptics';

export default function CaptureScreen() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await captureSignal(text.trim());
      router.back();  // 关闭 modal, 不弹任何 toast
    } catch (err) {
      // inline 错误显示, 不弹 dialog
      setError('网络异常, 已保存到本地, 稍后会自动重试');
    } finally {
      setSubmitting(false);
    }
  }
  
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.paper }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* 顶部: 关闭 + 标题 */}
        <View style={styles.header}>
          <TapEffect onPress={() => router.back()}>
            <Serif size={14}>取消</Serif>
          </TapEffect>
          <Serif size={9} style={styles.section}>RECORD · 信号</Serif>
          <View style={{ width: 40 }} />
        </View>
        
        {/* 输入区 */}
        <View style={{ flex: 1, padding: theme.spacing.lg }}>
          <Display size={20} italic style={{ marginBottom: theme.spacing.lg }}>
            今天看到什么...
          </Display>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="一句话, 30 秒"
            placeholderTextColor={theme.color.muted}
            multiline
            autoFocus
            style={{
              fontFamily: 'SourceSerif4-Regular',
              fontSize: 17,
              lineHeight: 26,
              color: theme.color.ink,
              flex: 1,
              textAlignVertical: 'top',
            }}
          />
        </View>
        
        {/* 底部: 记下按钮 */}
        <View style={styles.footer}>
          <TapEffect
            onPress={handleSubmit}
            disabled={!text.trim() || submitting}
            style={[styles.button, !text.trim() && styles.buttonDim]}
          >
            <Serif size={13} weight="semibold" style={{ color: theme.color.paper, letterSpacing: 0.6 }}>
              记下
            </Serif>
          </TapEffect>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

**已知坑**:
- 不要在 onSubmit 加 `Haptics.notificationAsync(Success)`, 违反产品哲学
- "记下" 按钮按下时**不震动**(只有签字才震), 这是录入场景的克制
- 提交后**直接 router.back()**, 不显示"已保存"

### Task 4.6 · A1 收件箱实现

`app/(tabs)/inbox.tsx` 完整版:

```typescript
import { FlatList, RefreshControl, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Masthead, SectionHeader, Serif, Mono } from '@/shared/components';
import { getRecentSignals } from '@/features/capture/data/signal-repository';
import { format } from 'date-fns';
import { theme } from '@/core/theme';

export default function InboxScreen() {
  const [refreshing, setRefreshing] = useState(false);
  
  const { data: signals, refetch } = useQuery({
    queryKey: ['signals'],
    queryFn: () => getRecentSignals(50),
    refetchInterval: 10000, // 每 10 秒拉一次, 看推演状态变化
  });
  
  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }
  
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.paper }} edges={['top']}>
      <Masthead {...mastheadProps} />
      <SilenceStamp count={signals?.length ?? 0} />
      
      <FlatList
        data={signals}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={() => (
          <SectionHeader label="本周记录" meta={`${signals?.length ?? 0} 条 · 全部已归档`} />
        )}
        renderItem={({ item }) => <SignalRow signal={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.color.ink}
          />
        }
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Serif size={13} italic style={{ color: theme.color.muted, textAlign: 'center' }}>
              这里会显示你的观察记录。{'\n'}
              它们不需要立即写下来。
            </Serif>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function SignalRow({ signal }) {
  return (
    <TapEffect onPress={() => router.push(`/signal/${signal.id}`)}>
      <View style={styles.row}>
        <Mono size={10} style={styles.date}>
          {format(signal.capturedAt, 'MM·dd')}
        </Mono>
        <View style={{ flex: 1 }}>
          <Serif size={13}>{signal.rawText}</Serif>
          <View style={{ marginTop: 3 }}>
            {signal.inferenceStatus === 'pending' && (
              <Serif size={9} italic style={{ color: theme.color.muted }}>
                ◆ AI 推演中
              </Serif>
            )}
            {signal.inferenceStatus === 'done' && (
              <Serif size={9} italic style={{ color: theme.color.muted }}>
                ◆ AI 已推演
              </Serif>
            )}
            {signal.syncStatus === 'failed' && (
              <Serif size={9} style={{ color: theme.color.red }}>
                ◆ 未同步
              </Serif>
            )}
          </View>
        </View>
      </View>
    </TapEffect>
  );
}
```

### Task 4.7 · "今日:沉默" 状态戳

```typescript
function SilenceStamp({ count }: { count: number }) {
  const today = signals?.filter(s => isToday(s.capturedAt)).length ?? 0;
  
  return (
    <View style={styles.stamp}>
      <Serif size={10} style={{ color: theme.color.muted, letterSpacing: 1.5 }}>
        本年第 <Serif size={10} weight="semibold" style={{ color: theme.color.ink }}>1</Serif> 期
      </Serif>
      {today === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={styles.check} />
          <Serif size={13} italic style={{ color: theme.color.green }}>
            今日: 沉默
          </Serif>
        </View>
      ) : (
        <Serif size={13} italic style={{ color: theme.color.ink }}>
          今日: {today} 条新记录
        </Serif>
      )}
    </View>
  );
}
```

### Task 4.8 · "记录" Tab 入口

底部 Tab 中间的 "+" 触发 modal:

```typescript
// app/(tabs)/_layout.tsx
<Tabs.Screen
  name="capture-trigger"  // 虚拟 tab
  options={{
    title: '记录',
    tabBarIcon: ({ color }) => (
      <Plus size={20} color={color} />
    ),
  }}
  listeners={{
    tabPress: (e) => {
      e.preventDefault();
      router.push('/capture');  // 跳到 modal 路由
    },
  }}
/>
```

### Task 4.9 · 自己用一周

W8 整周:
- 每天至少打开 APP 一次, 录至少 1 条信号(7 天 ≥ 7 条)
- 记录每次使用的体感:
  - 录入流畅吗?
  - 等待推演耐心吗?
  - 有想加但没加的功能吗?
  - 有想砍但留着的部分吗?

W8 结束后写一份**自己用一周复盘**(1 页内), 决定:
- 进 Phase 2(M5)
- 或修复 M4 的某些点

---

## 验收标准

### 用户行为
- [ ] 录入流程 30 秒内完成
- [ ] 录入后无 toast / 无 loading / 无震动
- [ ] AI 推演 30 秒内回写, A1 看到状态变化
- [ ] 离线录入再联网, 自动同步
- [ ] A1 下拉刷新工作
- [ ] 空状态文案是接纳式

### 技术
- [ ] M1+M2+M3 端到端联通
- [ ] events 表正确累积事件
- [ ] sync queue 失败重试机制工作
- [ ] 网络监测触发自动同步
- [ ] iOS 真机 APP 启动 < 2 秒

### 反模式
- [ ] 没有 toast / loading / 震动反馈成功
- [ ] 没有红点角标
- [ ] 没有推送通知
- [ ] 文案用对了产品词汇

### 自己用
- [ ] W8 那周, 连续 7 天每天 ≥ 1 条录入
- [ ] 7 天结束后, 没有崩溃 / 重大 bug
- [ ] 自我评估: 我会继续用这个 APP, 而不是觉得"做得不够好放弃了"

---

## 自由度边界

### 你可以自由决定
- 列表项的具体视觉(只要符合报刊感 + native_feel_skill)
- 同步策略的细节
- 推演状态轮询频率
- 错误重试退避算法

### 必须问
- 想加 push 通知收件箱有新内容(永远不要)
- 想加"今日总结"卡片(违反沉默, 不要)
- 想换 expo-sqlite 为 WatermelonDB(可以讨论, 但 Phase 1 倾向不换)
- 想做用户登录(Phase 1 不做, 用 hardcoded token)

### 不允许
- 把 inbox 做成 dashboard
- 加 FAB 替代底部 Tab 中间的 "+"
- 加引导提示
- 跳过自己用一周

---

## 已知坑(汇总)

1. **sync queue 用 mutex 防并发**
2. **localhost 在真机访问不到**, 用 LAN IP
3. **"记下"按钮不要触感反馈**(只有签字才震)
4. **推演状态轮询 10 秒一次**, 别太频繁
5. **网络监测用 @react-native-community/netinfo**
6. **空状态文案别催促**
7. **W8 自己用是验收**, 不能跳过

---

## 交叉引用

- B1 录入页设计 → `产品文档/01_第一层_信号捕捉.md`
- A1 收件箱设计 → 原型 v4 HTML
- 端到端测试 → `技术文档/08_测试策略_大纲.md`

---

## 完成后做什么

W8 自己用完后:
- 更新 `phase-1-quiet/00-overview.md` 里 M4 状态为 ✅
- 更新 `GOAL.md` § 5 当前进度 到 W8 → 准备进 Phase 2
- 写一份 "Phase 1 自用复盘"(1 页), 列出问题和决策

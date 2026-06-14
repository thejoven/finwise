/**
 * NotificationsScreen — 消息通知中心.
 *
 * 视觉布局 (报刊风):
 *   ── Masthead "消息通知"
 *   ── 工具行: N 未读 · [全部已读] · [清空]
 *   ── 时间分组列表: 今天 / 昨天 / 更早, 每组 SectionHeader, item 报刊摘录
 *
 * Item 视觉:
 *   ● Mono stamp · 时间 (◆ red = 未读, 灰圆 = 已读)
 *   Serif Display 标题 (size 15)
 *   Serif italic 副标 (可选)
 *   tap → 跳 href, 同时 markRead
 */

import { useCallback, useMemo } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";
import { formatClock } from "@/shared/format";

import { useNotifications, type Notification } from "./store";

export function NotificationsScreen() {
  const { t } = useTranslation();
  const items = useNotifications((s) => s.items);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const clearAll = useNotifications((s) => s.clear);
  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const groups = useMemo(() => groupByDay(items), [items]);

  const groupLabel = useCallback(
    (g: Group): string => {
      if (g.kind === "today") return t("notifications.group.today");
      if (g.kind === "yesterday") return t("notifications.group.yesterday");
      const d = new Date(Number(g.key));
      return t("notifications.group.monthDay", { month: d.getMonth() + 1, day: d.getDate() });
    },
    [t],
  );

  const handleTap = useCallback(
    (n: Notification) => {
      void markRead(n.id);
      if (n.href) {
        router.push(n.href as never);
      }
    },
    [markRead],
  );

  const handleClear = useCallback(() => {
    Alert.alert(t("notifications.clearConfirm.title"), t("notifications.clearConfirm.message"), [
      { text: t("common.rethink"), style: "cancel" },
      { text: t("notifications.toolbar.clear"), style: "destructive", onPress: () => void clearAll() },
    ]);
  }, [clearAll, t]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <View style={styles.header}>
        <TapEffect style={styles.backBtn} onPress={() => router.back()} disableEffect>
          <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
          <Serif size={13}>{t("common.back")}</Serif>
        </TapEffect>
        <Sans size={9} weight="600" style={styles.headerStamp}>
          {t("notifications.title")}
        </Sans>
        <View style={styles.headerSpacer} />
      </View>

      {/* 工具栏: 未读计数 + 全部已读 + 清空 */}
      <View style={styles.toolbar}>
        <Mono size={10} style={styles.unreadLabel}>
          {unread > 0
            ? t("notifications.toolbar.unread", { unread, total: items.length })
            : t("notifications.toolbar.allRead", { total: items.length })}
        </Mono>
        <View style={styles.toolbarActions}>
          {unread > 0 ? (
            <TapEffect style={styles.toolBtn} onPress={() => void markAllRead()}>
              <Mono size={10} style={styles.toolBtnLabel}>
                {t("notifications.toolbar.markAllRead")}
              </Mono>
            </TapEffect>
          ) : null}
          {items.length > 0 ? (
            <TapEffect style={styles.toolBtn} onPress={handleClear}>
              <Mono size={10} style={styles.toolBtnLabel}>
                {t("notifications.toolbar.clear")}
              </Mono>
            </TapEffect>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Display size={20} italic style={styles.emptyTitle}>
              {t("notifications.empty.title")}
            </Display>
            <Serif size={13} italic style={styles.emptyHint}>
              {t("notifications.empty.hint")}
            </Serif>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.key} style={styles.group}>
              <SectionHeader
                label={groupLabel(g)}
                meta={t("notifications.group.count", { count: g.items.length })}
              />
              <DoubleRule />
              {g.items.map((n) => (
                <NotificationRow key={n.id} item={n} onPress={() => handleTap(n)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────── Row ────────────────────

function NotificationRow({ item, onPress }: { item: Notification; onPress: () => void }) {
  return (
    <TapEffect
      style={[styles.row, !item.read && styles.rowUnread]}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
      onPress={onPress}
    >
      <View style={styles.rowHead}>
        <View style={[styles.dot, item.read ? styles.dotRead : styles.dotUnread]} />
        <Mono size={9} style={styles.stamp}>
          {item.stamp}
        </Mono>
        <Mono size={9} style={styles.time}>
          {formatClock(item.createdAt)}
        </Mono>
      </View>
      <Display size={15} style={styles.title} numberOfLines={2}>
        {item.title}
      </Display>
      {item.subtitle ? (
        <Serif size={12} italic style={styles.subtitle} numberOfLines={2}>
          {item.subtitle}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

// ──────────────────── grouping ────────────────────

interface Group {
  key: string;
  /** 分组类型: 今天 / 昨天 / 具体日期 — label 文案在渲染时按当前语言解析. */
  kind: "today" | "yesterday" | "date";
  items: Notification[];
}

function groupByDay(items: Notification[]): Group[] {
  const today = startOfDay(Date.now());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const map = new Map<string, Group>();

  for (const n of items) {
    const day = startOfDay(n.createdAt);
    let kind: Group["kind"];
    let key: string;
    if (day === today) {
      key = "today";
      kind = "today";
    } else if (day === yesterday) {
      key = "yesterday";
      kind = "yesterday";
    } else {
      key = String(day);
      kind = "date";
    }
    if (!map.has(key)) map.set(key, { key, kind, items: [] });
    map.get(key)!.items.push(n);
  }

  // 按 day desc (今天最上)
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === "today") return -1;
    if (b.key === "today") return 1;
    if (a.key === "yesterday") return -1;
    if (b.key === "yesterday") return 1;
    return Number(b.key) - Number(a.key);
  });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ──────────────────── styles ────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 64,
  },
  headerStamp: {
    flex: 1,
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  headerSpacer: {
    minWidth: 64,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  unreadLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  toolbarActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  toolBtn: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  toolBtnLabel: {
    color: theme.color.ink,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  group: {
    gap: theme.spacing.sm,
  },
  row: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
    gap: 4,
  },
  rowUnread: {
    backgroundColor: theme.color.paper2,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotUnread: {
    backgroundColor: theme.color.red,
  },
  dotRead: {
    backgroundColor: theme.color.muted2,
  },
  stamp: {
    color: theme.color.ink,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  time: {
    marginLeft: "auto",
    color: theme.color.muted2,
    letterSpacing: 1,
  },
  title: {
    color: theme.color.ink,
    lineHeight: 22,
  },
  subtitle: {
    color: theme.color.muted,
    lineHeight: 18,
    marginTop: 2,
  },
  empty: {
    paddingTop: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.md,
  },
  emptyTitle: {
    color: theme.color.ink,
  },
  emptyHint: {
    color: theme.color.muted,
    lineHeight: 20,
  },
});

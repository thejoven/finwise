/**
 * ArchivedProjectsScreen — 归档管理页 (push 详情栈, 入口在分类下拉底部「归档管理」).
 *
 * 产品意图: 归档不是删除 —— 归档的分类从日常列表隐藏, 只为减少注意力干扰; 历史 signals 上
 *   的 project_id 一直在, 这些归档分类是用户未来的训练资料. 故此页能"恢复"分类回活跃列表,
 *   不提供永久删除.
 *
 * 数据: useQuery(["projects","archived"]) 拉已归档分类; restore 后 invalidate ["projects"]
 *   (前缀匹配, 活跃列表 + 归档列表一并重拉). 恢复撞到同名活跃分类时服务端回 409 → toast 提示.
 *
 * 视觉: 报刊感, 与 colophon / ProjectSelectModal 同语汇 (SafeAreaView + 顶栏返回 + Serif 列表).
 */

import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listArchivedProjects, restoreProject, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { haptic } from "@/core/haptics";
// 走具体文件而非 "@/shared/components" barrel: 避免 shared ⇄ feature 的 require cycle (同 ProjectSelectModal).
import { Display, Mono, Sans, Serif } from "@/shared/components/Text";
import { Icon } from "@/shared/components/Icon";
import { TapEffect } from "@/shared/components/TapEffect";
import { showToast } from "@/shared/toast";

/** archived_at 是 RFC3339 (e.g. 2026-06-16T08:00:00Z); 列表展示取日期段足矣. */
function formatArchivedDate(iso: string): string {
  return iso.slice(0, 10);
}

export default function ArchivedProjectsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: archived, isLoading } = useQuery({
    queryKey: ["projects", "archived"],
    queryFn: listArchivedProjects,
    staleTime: 30_000,
  });

  const restoreMut = useMutation({
    mutationFn: restoreProject,
    onSuccess: async () => {
      // 前缀失效: ["projects"] 与 ["projects","archived"] 一并重拉 —— 活跃列表加回, 归档列表移除.
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const handleRestore = (p: ProjectView) => {
    void haptic.light();
    restoreMut.mutate(p.id, {
      onSuccess: () =>
        showToast({
          stamp: t("project.toast.stamp"),
          title: t("project.toast.restored", { name: p.name }),
        }),
      // 409: 已有同名活跃分类占着名字 —— 让用户先改名再恢复.
      onError: () =>
        showToast({
          stamp: t("project.toast.stamp"),
          title: t("project.archivedPage.restoreConflict"),
        }),
    });
  };

  const items: ProjectView[] = archived ?? [];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TapEffect
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel={t("common.back")}
        >
          <Icon name="chevronLeft" size={22} color={theme.color.ink} strokeWidth={1.5} />
        </TapEffect>
        <Mono size={10} style={styles.topMeta}>
          {t("project.archivedPage.navTitle")}
        </Mono>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Display size={22} style={styles.title}>
          {t("project.archivedPage.title")}
        </Display>
        <Serif size={13} style={styles.hint}>
          {t("project.archivedPage.hint")}
        </Serif>

        <View style={styles.rule} />

        {isLoading ? (
          <ActivityIndicator style={styles.loading} color={theme.color.muted} />
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Icon name="archive" size={26} color={theme.color.muted2} strokeWidth={1.5} />
            <Sans size={13} style={styles.emptyText}>
              {t("project.archivedPage.empty")}
            </Sans>
          </View>
        ) : (
          // 归档分类有界 (用户分类数), ScrollView+map 足够; 长列表才需 FlatList.
          // react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list
          items.map((p) => (
            <View key={p.id} style={styles.row}>
              <View style={styles.rowLead}>
                {p.emoji ? (
                  <Sans size={16} style={styles.rowEmoji}>
                    {p.emoji}
                  </Sans>
                ) : (
                  <View style={[styles.rowDot, p.color ? { backgroundColor: p.color } : null]} />
                )}
              </View>
              <View style={styles.rowBody}>
                <Serif size={15} style={styles.rowName} numberOfLines={1}>
                  {p.name}
                </Serif>
                {p.archived_at ? (
                  <Mono size={9} style={styles.rowMeta}>
                    {t("project.archivedPage.archivedOn", {
                      date: formatArchivedDate(p.archived_at),
                    })}
                  </Mono>
                ) : null}
              </View>
              <TapEffect
                onPress={() => handleRestore(p)}
                disabled={restoreMut.isPending}
                style={styles.restoreBtn}
                accessibilityLabel={t("project.archivedPage.restoreLabel", { name: p.name })}
              >
                <Icon name="restore" size={14} color={theme.color.ink} strokeWidth={1.75} />
                <Sans size={12} weight="600" style={styles.restoreLabel}>
                  {t("project.archivedPage.restore")}
                </Sans>
              </TapEffect>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  topMeta: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  title: {
    color: theme.color.ink,
    marginTop: theme.spacing.md,
  },
  hint: {
    color: theme.color.muted,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.rule,
    marginVertical: theme.spacing.lg,
  },
  loading: {
    marginTop: theme.spacing.xl,
  },
  emptyWrap: {
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xxl,
  },
  emptyText: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowLead: {
    width: 28,
    alignItems: "center",
  },
  rowEmoji: {
    textAlign: "center",
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.color.muted2,
  },
  rowBody: {
    flex: 1,
    gap: 3,
    paddingHorizontal: theme.spacing.sm,
  },
  rowName: {
    color: theme.color.ink,
  },
  rowMeta: {
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink,
  },
  restoreLabel: {
    color: theme.color.ink,
    letterSpacing: 1,
  },
});

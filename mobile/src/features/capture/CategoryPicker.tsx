/**
 * CaptureCategoryPicker — 录入时的行内"分类条" (B1, 必选).
 *
 * 与 masthead 上的 ProjectChipsRow 区别:
 *   - 选择先作用于"这一条待录入信号": 用父级本地 state, 不在选择过程中改全局
 *     useActiveProject; 提交成功后由录入页把首页筛选切到该分类.
 *   - 不含"全部": 录入要求必选一个真实分类 (空选时父级禁用"记下").
 *   - 末尾 + 打开 ProjectSelectModal 新建; 建好后经 onProjectCreated 自动选中并关回.
 *
 * 数据: useQuery(["projects"]) 与别处共用缓存; 过滤掉已归档的.
 *
 * 默认带入: 父级用当前 active project 作初值. 若该 project 已被归档/删除 (不在
 * 列表里), 这里会清空选中, 强制用户重选 —— 避免提交到一个 server 会判 400 的 id.
 */

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listProjects, type ProjectView } from "@/core/api/project";
import { Chip, ProjectSelectModal } from "@/features/project";
import { theme } from "@/core/theme";
import { Icon, Mono, Serif, TapEffect } from "@/shared/components";

interface Props {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CaptureCategoryPicker({ selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });

  const items: ProjectView[] = useMemo(
    () => (projects ?? []).filter((p) => !p.archived_at),
    [projects],
  );

  // 默认带入的 active 若已不在可选列表 (被归档/删除), 清空选中, 强制重选. 这是对**异步加载**
  // 的 items 的校验, 没有触发它的本地用户事件; selectedId 是父级本地 state, 为此上 Provider
  // 属过度设计 —— 故 no-event-handler / no-prop-callback-in-effect 在此为误报.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (selectedId && !isLoading && !items.some((p) => p.id === selectedId)) {
      // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect
      onSelect(null);
    }
  }, [selectedId, items, isLoading, onSelect]);

  return (
    <View style={styles.wrap}>
      <Mono size={9} style={styles.stamp}>
        {t("capture.category.stamp")}
      </Mono>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {items.length === 0 && !isLoading ? (
          <Serif size={13} italic style={styles.empty}>
            {t("capture.category.empty")}
          </Serif>
        ) : null}
        {/* 行内分类条有界 (用户分类数), 横向 ScrollView+map 足够; rn-no-scrollview-mapped-list 针对长列表. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {items.map((p) => (
          <Chip
            key={p.id}
            label={p.emoji ? `${p.emoji} ${p.name}` : p.name}
            active={selectedId === p.id}
            color={p.color ?? undefined}
            onPress={() => onSelect(p.id)}
          />
        ))}
        <TapEffect
          onPress={() => setModalOpen(true)}
          style={[styles.chip, styles.chipAdd]}
          accessibilityLabel={t("capture.category.add")}
        >
          <Icon name="plus" size={12} color={theme.color.ink2} strokeWidth={2} />
        </TapEffect>
      </ScrollView>

      <ProjectSelectModal
        visible={modalOpen}
        editingId={null}
        onClose={() => setModalOpen(false)}
        onProjectCreated={(id) => {
          onSelect(id);
          setModalOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
    paddingHorizontal: theme.spacing.lg,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
  },
  empty: {
    color: theme.color.muted,
    paddingVertical: 4,
    paddingRight: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipAdd: {
    backgroundColor: theme.color.paper,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.xs,
    width: 28,
  },
});

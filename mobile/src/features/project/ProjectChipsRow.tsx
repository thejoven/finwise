/**
 * ProjectChipsRow — 报刊头下的"分类条".
 *
 * 视觉:
 *   [全部] [🧸 泡泡玛特] [🔋 新能源] ... [＋]
 *   - active: ink 填充 + paper 文字
 *   - inactive: paper2 + 细线 + ink 文字
 *   - 末尾 + 号: 打开 ProjectSelectModal (创建 / 管理)
 *   - 长按已有 chip 也打开 modal, 自动滚到该 project 用于改名/归档
 *
 * 数据:
 *   - 列表通过 react-query (queryKey ["projects"]) 拉
 *   - active 状态从 useActiveProject() store 读
 *   - 切换 active 同时把 react-query 的 attention 查询 invalidate (在 useEffect 里)
 *
 * 设计上保持 stateless, 让父组件 (Masthead / CollapsibleMasthead) 决定是否
 * 参与折叠动画.
 */

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { Plus } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";

import { listProjects, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { Sans, TapEffect } from "@/shared/components";

import { useActiveProject } from "./store";
import { ProjectSelectModal } from "./ProjectSelectModal";

interface ProjectChipsRowProps {
  /**
   * 父容器是否自带 paddingHorizontal=lg. true 表示自己不再加横向 padding,
   * 用于 Masthead 内嵌; false (默认) 用于 AttentionScreen 等无 padding 父.
   */
  parentPadded?: boolean;
}

export function ProjectChipsRow({ parentPadded = false }: ProjectChipsRowProps = {}) {
  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });

  const items: ProjectView[] = projects ?? [];

  const openCreate = () => {
    setEditingId(null);
    setModalOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setModalOpen(true);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={parentPadded ? styles.rowBleed : styles.row}
      >
        <Chip
          label="全部"
          active={activeId === null}
          onPress={() => void setActive(null)}
        />
        {items.map((p) => (
          <Chip
            key={p.id}
            label={p.emoji ? `${p.emoji} ${p.name}` : p.name}
            active={activeId === p.id}
            color={p.color ?? undefined}
            onPress={() => void setActive(p.id)}
            onLongPress={() => openEdit(p.id)}
          />
        ))}
        <TapEffect onPress={openCreate} style={[styles.chip, styles.chipAdd]}>
          <Plus size={12} color={theme.color.ink2} strokeWidth={2} />
        </TapEffect>
      </ScrollView>

      <ProjectSelectModal
        visible={modalOpen}
        editingId={editingId}
        onClose={() => setModalOpen(false)}
      />
    </View>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
  onLongPress?: () => void;
}

function Chip({ label, active, color, onPress, onLongPress }: ChipProps) {
  const tinted = !active && color ? { borderColor: color } : null;
  return (
    <TapEffect
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive, tinted]}
    >
      <Sans
        size={11}
        weight={active ? "600" : "500"}
        style={active ? styles.labelActive : styles.labelInactive}
      >
        {label}
      </Sans>
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  rowBleed: {
    flexDirection: "row",
    alignItems: "center",
    // 父已自带 lg padding, 内层只需右侧加 padding 让滚到末尾时 "+" 不贴边.
    paddingRight: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipActive: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  chipInactive: {
    backgroundColor: theme.color.paper2,
    borderColor: theme.color.rule,
  },
  chipAdd: {
    backgroundColor: theme.color.paper,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.xs,
    width: 28,
  },
  labelActive: {
    color: theme.color.paper,
    letterSpacing: 1,
  },
  labelInactive: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
});

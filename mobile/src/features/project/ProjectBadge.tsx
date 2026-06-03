/**
 * ProjectBadge — "所属分类"标识. 给定 project_id, 解析成 emoji/色点 + 名称.
 *
 * 数据走与 chips 相同的 react-query 缓存 (queryKey ["projects"]), 详情页/列表打开时
 * 通常已被 masthead 的 chips 预热, 命中缓存即时渲染.
 *
 * 渲染规则:
 *   - project_id 为空 (未分类) → 返回 null, 不占位.
 *   - 分类已归档 / 拉不到 → 返回 null.
 *   - 命中 → emoji (或色点) + 名称.
 *
 * variant:
 *   - "pill" (默认): 带边框的胶囊, 用于详情页.
 *   - "inline": 无边框的轻标识, 用于列表行 (密度高, 不抢视觉).
 *
 * navigateOnPress (默认开): 点一下 → 设为 active 分类 + 跳回首页 inbox 过滤.
 *   列表行里传 false (整行点击已跳详情, 标识只作展示).
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";

import { listProjects, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { Sans } from "@/shared/components/Text";
import { TapEffect } from "@/shared/components/TapEffect";

import { useActiveProject } from "./store";

interface ProjectBadgeProps {
  projectId?: string | null;
  style?: StyleProp<ViewStyle>;
  variant?: "pill" | "inline";
  /** 点击后切到该分类并跳回首页 (inbox). 默认开启; 传 false 则纯展示. */
  navigateOnPress?: boolean;
}

export function ProjectBadge({
  projectId,
  style,
  variant = "pill",
  navigateOnPress = true,
}: ProjectBadgeProps) {
  const setActive = useActiveProject((s) => s.setActive);
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
    enabled: !!projectId,
  });

  if (!projectId) return null;
  const p: ProjectView | undefined = (projects ?? []).find((x) => x.id === projectId);
  if (!p) return null;

  const inline = variant === "inline";
  const content = (
    <>
      {p.emoji ? (
        <Sans size={inline ? 10 : 11}>{p.emoji}</Sans>
      ) : (
        <View
          style={[
            inline ? styles.dotSm : styles.dot,
            p.color ? { backgroundColor: p.color } : null,
          ]}
        />
      )}
      <Sans size={inline ? 10 : 11} weight="600" style={inline ? styles.nameInline : styles.name}>
        {p.name}
      </Sans>
    </>
  );

  const containerStyle = [inline ? styles.inline : styles.badge, style];

  if (!navigateOnPress) {
    return <View style={containerStyle}>{content}</View>;
  }

  return (
    <TapEffect
      style={containerStyle}
      pressedStyle={inline ? undefined : { backgroundColor: theme.color.rule }}
      onPress={() => {
        // setActive 内存态同步生效 (持久化失败也不影响本次), 再跳回首页按分类过滤.
        void setActive(p.id);
        router.navigate("/(tabs)/inbox");
      }}
      accessibilityLabel={`按分类「${p.name}」筛选`}
    >
      {content}
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.color.muted2,
  },
  dotSm: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.muted2,
  },
  name: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
  nameInline: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
});

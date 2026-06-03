/**
 * BottomCategoryCell — 底栏左侧那颗独立的"分类格".
 *
 * 产品要求 (见 GOAL, 本轮调整):
 *   - 分类切换从报头 ("财知 · 分类名 ▾") 挪到底部, 作为一颗**独立胶囊**落在 tab 岛左侧,
 *     与右侧 tab 菜单**分离**(各自一颗玻璃药丸, 中间留缝, 不连成一条).
 *   - 形态紧凑: 圆点/emoji + 当前分类名 + 上扬的 ▴ (从底部往上弹下拉框).
 *   - 仍保证"任何时候都停在一个真实分类里": 挂 useEnsureCategory (无分类则自动建默认).
 *
 * 为什么活在 tab bar 里: tab bar 是常驻的底部浮层 (整个 Tabs 导航器只挂一次), 把分类格放这儿,
 *   useEnsureCategory 全程只跑一份, 且每个 tab 都能看到 / 切换当前分类 —— 比旧版绑在
 *   inbox/archive 两个 masthead 上更省、更一致.
 *
 * 玻璃材质 / 高度 / 描边都走 `@/shared/components/glass`, 与右侧 tab 岛长成一对.
 * 下拉框 (CategoryDropdown) 会因锚点在屏幕下半部而自动向上弹.
 */

import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";

import { listProjects, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { haptic } from "@/core/haptics";
import { Icon, Sans, TapEffect } from "@/shared/components";
import { IslandGlass, PILL_HEIGHT, glassOverlay } from "@/shared/components/glass";

import { useActiveProject } from "./store";
import { useEnsureCategory } from "./useEnsureCategory";
import { CategoryDropdown, type DropdownAnchor } from "./CategoryDropdown";
import { ProjectSelectModal } from "./ProjectSelectModal";

export function BottomCategoryCell({ isDark }: { isDark: boolean }) {
  // 保证始终停在一个真实分类里 (无分类则自动创建默认分类).
  useEnsureCategory();

  const triggerRef = useRef<View>(null);
  // 待开表单的意图: 先关下拉, 等它卸载后 (onClosed) 再开 —— 否则两个 Modal 同帧抢呈现, iOS 报错.
  const pendingFormRef = useRef<{ editingId: string | null; stage: "list" | "create" } | null>(
    null,
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [anchor, setAnchor] = useState<DropdownAnchor | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formEditingId, setFormEditingId] = useState<string | null>(null);
  const [formStage, setFormStage] = useState<"list" | "create">("list");

  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const usable: ProjectView[] = (projects ?? []).filter((p) => !p.archived_at);
  const active = usable.find((p) => p.id === activeId) ?? null;

  const overlay = glassOverlay(isDark);

  // ▴/▾ 箭头: 下拉框开 → 旋 180° (指上翻到指下), 关 → 转回 —— 给开合一点"变动"感.
  const arrowSpin = useSharedValue(0);
  useEffect(() => {
    arrowSpin.value = withTiming(dropdownOpen ? 1 : 0, { duration: 180 });
  }, [dropdownOpen, arrowSpin]);
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${arrowSpin.value * 180}deg` }],
  }));

  const openDropdown = () => {
    // measureInWindow 拿胶囊的屏幕坐标, 让下拉框贴着它弹 (在屏幕下半部会自动向上).
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setDropdownOpen(true);
    });
  };

  const handlePick = (id: string) => {
    haptic.selection();
    void setActive(id);
    setDropdownOpen(false);
  };

  const handleCreate = () => {
    pendingFormRef.current = { editingId: null, stage: "create" };
    setDropdownOpen(false);
  };

  const handleEdit = (id: string) => {
    // 传了 editingId, modal 自会进 edit 态
    pendingFormRef.current = { editingId: id, stage: "list" };
    setDropdownOpen(false);
  };

  // 下拉框退场卸载后才开表单 (rAF 再多让一帧, 确保旧 Modal 收干净), 避开 iOS 双 Modal 报错.
  const handleDropdownClosed = () => {
    const intent = pendingFormRef.current;
    if (!intent) return;
    pendingFormRef.current = null;
    requestAnimationFrame(() => {
      setFormEditingId(intent.editingId);
      setFormStage(intent.stage);
      setFormOpen(true);
    });
  };

  return (
    <>
      <View
        ref={triggerRef}
        collapsable={false}
        style={[styles.cell, { borderColor: overlay.border }]}
      >
        <IslandGlass isDark={isDark} />
        <TapEffect
          onPress={openDropdown}
          disableEffect
          style={styles.trigger}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          accessibilityLabel={`当前分类「${active?.name ?? "未选择"}」, 点击切换`}
        >
          {active?.emoji ? (
            <Sans size={11} style={styles.emoji}>
              {active.emoji}
            </Sans>
          ) : (
            <View style={[styles.dot, active?.color ? { backgroundColor: active.color } : null]} />
          )}
          <RNText allowFontScaling={false} style={styles.name} numberOfLines={1}>
            {active?.name ?? "选择分类"}
          </RNText>
          <Animated.View style={arrowStyle}>
            <Icon name="chevronUp" size={11} color={theme.color.muted} strokeWidth={2} />
          </Animated.View>
        </TapEffect>
      </View>

      <CategoryDropdown
        visible={dropdownOpen}
        anchor={anchor}
        projects={usable}
        activeId={activeId}
        onClose={() => setDropdownOpen(false)}
        onPick={handlePick}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onClosed={handleDropdownClosed}
      />

      <ProjectSelectModal
        visible={formOpen}
        editingId={formEditingId}
        initialStage={formStage}
        onClose={() => setFormOpen(false)}
        onProjectCreated={(id) => {
          void setActive(id);
          setFormOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cell: {
    height: PILL_HEIGHT,
    justifyContent: "center",
    borderRadius: theme.radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden", // 把玻璃背景层裁进药丸形
    // borderColor 走内联 overlay.border (随明暗手动给).
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
  },
  emoji: {
    marginRight: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: theme.color.muted2,
  },
  name: {
    flexShrink: 1,
    maxWidth: 72, // 窄屏兜底: 名字太长则省略, 不挤坏右侧 tab 岛
    fontFamily: theme.fontFamily.cjkBold, // 与报头主名"财知"同款 (NotoSerifSC Bold), 字体样式一致
    fontSize: 12,
    color: theme.color.ink2,
    letterSpacing: 0.5,
  },
});

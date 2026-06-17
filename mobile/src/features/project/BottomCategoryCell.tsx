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

import { useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";

import { archiveProject, listProjects, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { haptic } from "@/core/haptics";
// 走具体文件而非 "@/shared/components" barrel: 该 barrel 经 DynamicIslandTabBar/Masthead
// 反向依赖本 feature, 走 barrel 会形成 shared ⇄ feature 的 require cycle. 具体路径切断回边.
import { Icon } from "@/shared/components/Icon";
import { Sans } from "@/shared/components/Text";
import { TapEffect } from "@/shared/components/TapEffect";
import { IslandGlass, PILL_HEIGHT, PILL_RADIUS } from "@/shared/components/glass";
import { glassOverlay } from "@/shared/components/glass-overlay";

import { useActiveProject } from "./store";
import { useEnsureCategory } from "./useEnsureCategory";
import { CategoryDropdown, type DropdownAnchor } from "./CategoryDropdown";
import { ProjectSelectModal } from "./ProjectSelectModal";

// ProjectSelectModal 的一坨相关状态 (开关 + 编辑目标 + 初始 stage) 总是成组改动,
// 用 patch reducer 攒成一个: setForm({...}) 局部更新, 替代散开的三个 setState.
interface FormState {
  open: boolean;
  editingId: string | null;
  stage: "list" | "create";
}
type FormAction = Partial<FormState>;
function formReducer(s: FormState, patch: FormAction): FormState {
  return { ...s, ...patch };
}

export function BottomCategoryCell({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation();
  // 保证始终停在一个真实分类里 (无分类则自动创建默认分类).
  useEnsureCategory();

  const triggerRef = useRef<View>(null);
  // 待开表单的意图: 先关下拉, 等它卸载后 (onClosed) 再开 —— 否则两个 Modal 同帧抢呈现, iOS 报错.
  const pendingFormRef = useRef<{ editingId: string | null; stage: "list" | "create" } | null>(
    null,
  );
  // 待跳归档管理页: 与 form 同理, 先关下拉等它卸载再 push, 避免 Modal 盖住新栈页.
  const pendingNavRef = useRef(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [anchor, setAnchor] = useState<DropdownAnchor | null>(null);

  const [form, setForm] = useReducer(formReducer, {
    open: false,
    editingId: null,
    stage: "list",
  });

  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const usable: ProjectView[] = (projects ?? []).filter((p) => !p.archived_at);
  const active = usable.find((p) => p.id === activeId) ?? null;

  const queryClient = useQueryClient();
  const archiveMut = useMutation({
    mutationFn: archiveProject,
    onSuccess: async (_, id) => {
      // 归档当前 active 分类时落到下一个可用分类; 一个不剩则置空, useEnsureCategory 兜底建默认.
      if (activeId === id) {
        const next = usable.find((p) => p.id !== id);
        await setActive(next?.id ?? null);
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

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
    void haptic.light(); // 下拉弹起 ≈ "ActionSheet 弹起", 走 light (06-haptic-grammar §2)
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

  // 行内快捷归档: 不关下拉 —— 归档后该行从列表消失 (invalidate 刷新), 可连续清理;
  //   归档当前 active 分类时 archiveMut 会把 active 切到下一个, 底栏分类格即时跟着变.
  const handleArchive = (id: string) => {
    void haptic.light();
    archiveMut.mutate(id);
  };

  const handleManageArchive = () => {
    pendingNavRef.current = true;
    setDropdownOpen(false);
  };

  // 下拉框退场卸载后才开表单 (rAF 再多让一帧, 确保旧 Modal 收干净), 避开 iOS 双 Modal 报错.
  const handleDropdownClosed = () => {
    // 归档管理页优先: 下拉卸载后再 push, 避开 iOS Modal 与新栈页同帧呈现的冲突.
    if (pendingNavRef.current) {
      pendingNavRef.current = false;
      requestAnimationFrame(() => router.push("/projects/archived"));
      return;
    }
    const intent = pendingFormRef.current;
    if (!intent) return;
    pendingFormRef.current = null;
    requestAnimationFrame(() => {
      setForm({ editingId: intent.editingId, stage: intent.stage, open: true });
    });
  };

  return (
    <>
      <View
        ref={triggerRef}
        collapsable={false}
        style={[styles.cellFrame, { borderColor: overlay.border }]}
      >
        {/* 触发器嵌在玻璃内 (非铺在上面), 与右侧 tab 岛一致: 按压/长按时玻璃液态反应. */}
        <IslandGlass isDark={isDark} isInteractive style={styles.cellGlass}>
          <TapEffect
            onPress={openDropdown}
            disableEffect
            style={styles.trigger}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityLabel={t("project.cell.activeLabel", {
              name: active?.name ?? t("project.cell.noneSelected"),
            })}
          >
            {active?.emoji ? (
              <Sans size={12} style={styles.emoji}>
                {active.emoji}
              </Sans>
            ) : (
              <View
                style={[styles.dot, active?.color ? { backgroundColor: active.color } : null]}
              />
            )}
            <RNText allowFontScaling={false} style={styles.name} numberOfLines={1}>
              {active?.name ?? t("project.cell.placeholder")}
            </RNText>
            <Animated.View style={arrowStyle}>
              <Icon name="chevronUp" size={12} color={theme.color.muted} strokeWidth={2} />
            </Animated.View>
          </TapEffect>
        </IslandGlass>
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
        onArchive={handleArchive}
        onManageArchive={handleManageArchive}
        onClosed={handleDropdownClosed}
      />

      <ProjectSelectModal
        visible={form.open}
        editingId={form.editingId}
        initialStage={form.stage}
        onClose={() => setForm({ open: false })}
        onProjectCreated={(id) => {
          void setActive(id);
          setForm({ open: false });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // 外层"画框": 只描边 + 裁圆角; 尺寸由内层 GlassView 撑开 (与 tab 岛同构, 长成一对).
  cellFrame: {
    borderRadius: PILL_RADIUS, // 半高 = 左右两侧完全圆形
    borderWidth: StyleSheet.hairlineWidth, // GlassView 不画 border, 故描边落在这层
    overflow: "hidden", // 裁掉玻璃圆角外的极小溢出
    // borderColor 走内联 overlay.border (随明暗手动给).
  },
  // 内层玻璃 (容器): 撑出胶囊高度 + 居中内容; 圆角交 GlassView 原生处理.
  cellGlass: {
    height: PILL_HEIGHT,
    justifyContent: "center",
    borderRadius: PILL_RADIUS,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    // 胶囊端部是真半圆 (radius 28), 内容须退过弧线才不顶着弧边 —— base(16) 是标准胶囊水平内边距.
    paddingHorizontal: theme.spacing.base,
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
    fontSize: 13, // iOS 紧凑控件的标准字号档 (12 在胶囊里偏小一号)
    color: theme.color.ink2,
    letterSpacing: 0.5,
  },
});

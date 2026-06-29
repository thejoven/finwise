/**
 * HeaderCategoryCell — 财知报头里那颗紧凑的"分类格".
 *
 * 产品要求 (见 GOAL, 本轮调整):
 *   - 分类切换收进「财知」, 紧贴报头主名「财知」**右侧**作为一颗轻量内联小药丸 (此前曾试过
 *     底栏独立玻璃胶囊, 现回到报头) —— 仅财知出现, 因分类筛选只作用于财知内的信箱/降噪/
 *     归档/统计四张子页.
 *   - 形态紧凑: 圆点/emoji + 当前分类名 + ▾ (从报头往下弹分类下拉框).
 *   - 仍保证"任何时候都停在一个真实分类里": 挂 useEnsureCategory (无分类则自动建默认).
 *
 * 与旧底栏玻璃胶囊不同, 这里不走玻璃 —— 贴着 22pt 报名的轻量小药丸 (paper3 软底 + 全圆角),
 *   刻意压低视觉重量, 不与标题争主次. 点击经 measureInWindow 把锚点交给 CategoryDropdown;
 *   锚点落在屏幕上半部, 故下拉框自动**向下**弹 (见 CategoryDropdown 的 dropUp 判定).
 *
 * @see CategoryDropdown
 * @see ./CaizhiHeader 的报名行 (本组件挂在那儿)
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";

import { archiveProject, listProjects, type ProjectView } from "@/core/api/project";
import { theme } from "@/core/theme";
import { haptic } from "@/core/haptics";
// 走具体文件而非 "@/shared/components" barrel: 该 barrel 历史上经 Masthead 反向依赖本 feature,
// 走 barrel 易形成 shared ⇄ feature 的 require cycle. 具体路径切断回边, 稳妥.
import { Icon } from "@/shared/components/Icon";
import { Sans } from "@/shared/components/Text";
import { TapEffect } from "@/shared/components/TapEffect";

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

export function HeaderCategoryCell() {
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

  // ▾ 箭头: 下拉框开 → 旋 180° (指下翻到指上), 关 → 转回 —— 给开合一点"变动"感.
  const arrowSpin = useSharedValue(0);
  useEffect(() => {
    arrowSpin.value = withTiming(dropdownOpen ? 1 : 0, { duration: 180 });
  }, [dropdownOpen, arrowSpin]);
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${arrowSpin.value * 180}deg` }],
  }));

  // 触发器按下"听到了": 轻缩一档, 松手弹簧回弹 —— 给这颗关键按压点 Emil 式即时 scale 反馈.
  //   全局 TapEffect 仍保持"不做 scale"的克制 (见该文件注释), 此处只此一处特例, 不动全局.
  const reduce = useReducedMotion();
  const chipScale = useSharedValue(1);
  const chipScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: chipScale.value }] }));
  const onChipPressIn = () => {
    if (reduce) return; // 减少动态: 不缩放
    chipScale.value = withTiming(0.96, { duration: 120, easing: Easing.out(Easing.quad) });
  };
  const onChipPressOut = () => {
    if (reduce) return;
    chipScale.value = withSpring(1, { damping: 15, stiffness: 320, mass: 0.6 });
  };

  const openDropdown = () => {
    void haptic.light(); // 下拉弹起 ≈ "ActionSheet 弹起", 走 light (06-haptic-grammar §2)
    // measureInWindow 拿触发器的屏幕坐标, 让下拉框贴着它弹 (在屏幕上半部会自动向下).
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
  //   归档当前 active 分类时 archiveMut 会把 active 切到下一个, 报头分类格即时跟着变.
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
      {/* 贴着报名「财知」右侧的内联小药丸 (无玻璃). collapsable=false 保证 measureInWindow 量得到. */}
      <View ref={triggerRef} collapsable={false}>
        <Animated.View style={chipScaleStyle}>
          <TapEffect
            onPress={openDropdown}
            onPressIn={onChipPressIn}
            onPressOut={onChipPressOut}
            style={styles.chip}
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
              <Icon name="chevronDown" size={12} color={theme.color.muted} strokeWidth={2} />
            </Animated.View>
          </TapEffect>
        </Animated.View>
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
  // 贴着报名「财知」右侧的轻量小药丸: paper3 软底 + 全圆角, 压低重量不与标题争主次.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    borderRadius: 999, // 全圆角小药丸
    backgroundColor: theme.color.paper3,
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
    maxWidth: 96, // 名字太长则省略, 不把报名挤偏
    fontFamily: theme.fontFamily.cjkBold, // 与报名"财知"同款 (NotoSerifSC Bold), 字体一致
    fontSize: 13,
    color: theme.color.ink2,
    letterSpacing: 0.5,
  },
});

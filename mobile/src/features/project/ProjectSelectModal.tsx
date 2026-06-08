/**
 * ProjectSelectModal — 选择/管理分类的居中弹层 (对话框样式, 缩放 + 淡入弹出).
 *
 * 视图状态:
 *   - "list" → 显示所有分类列表, 顶部 + 新建按钮, 每行 tap 切换 active, 长按 / 笔
 *     图标进入 edit
 *   - "edit" → 单 project 的编辑表单 (改名 / 改 emoji / 改 color / 归档)
 *   - "create" → 新建表单 (与 edit 同套字段, 不带归档)
 *
 * 数据: useQuery(["projects"]), mutation 后 invalidate.
 *
 * 注意: 归档不删除 signals 上已绑定的 project_id (历史数据保留), 仅从 chip 行
 * 移出. active 若指向被归档的 project, 自动回 "全部".
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ScrollView } from "react-native-gesture-handler";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
  type ProjectView,
} from "@/core/api/project";
import { theme, useThemeColors, projectSwatches } from "@/core/theme";
// 走具体文件而非 "@/shared/components" barrel: 避免 shared ⇄ feature 的 require cycle.
import { Display, Mono, Sans, Serif } from "@/shared/components/Text";
import { Icon } from "@/shared/components/Icon";
import { TapEffect } from "@/shared/components/TapEffect";
import { NativeField } from "@/shared/native";

import { useActiveProject } from "./store";

type Stage = "list" | "edit" | "create";

interface Props {
  visible: boolean;
  editingId: string | null;
  onClose: () => void;
  /**
   * 可选: 打开时的初始视图. 传 "create" 直接进新建表单 (editingId 为空时生效);
   * 默认 "list". editingId 非空时恒为 edit, 不受此影响.
   */
  initialStage?: "list" | "create";
  /**
   * 可选: 新建分类成功后回调新分类 id. 录入页用它把刚建好的分类选中并关回.
   * 不传时维持原行为 (新建后停在 list, 该分类被设为全局 active).
   */
  onProjectCreated?: (id: string) => void;
}

const EMOJI_SUGGESTIONS = ["🧸", "🔋", "🏦", "💊", "🛢️", "🤖", "🌐", "📱", "🪙", "🍵"];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Draft {
  name: string;
  emoji: string | undefined;
  color: string | undefined;
  guidance: string;
}
const EMPTY_DRAFT: Draft = { name: "", emoji: undefined, color: undefined, guidance: "" };
// 草稿字段是一组同进同退的状态 (一起重置 / 预填) —— 用 reducer 合并, 替代 4 个独立 useState.
function draftReducer(s: Draft, patch: Partial<Draft>): Draft {
  return { ...s, ...patch };
}

export function ProjectSelectModal({
  visible,
  editingId,
  onClose,
  initialStage = "list",
  onProjectCreated,
}: Props) {
  const [stage, setStage] = useState<Stage>("list");
  const [draft, patchDraft] = useReducer(draftReducer, EMPTY_DRAFT);

  // 居中弹层的进出动画: progress 控背景遮罩 + 卡片整体透明度, cardScale 控"弹出"缩放.
  // Modal 的 visible 跟随本地 mounted —— 关闭时先放完退场动画, 再卸载 Modal.
  // 初值 false: 弹层恒由父级以 visible=false 创建后再 toggle, 故不从 prop 派生.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);
  const cardScale = useSharedValue(0.92);

  const queryClient = useQueryClient();
  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const items: ProjectView[] = projects ?? [];

  // visible + editingId 决定打开后的初始 stage —— 在渲染期按 prev-token 比较同步草稿,
  // 而非 effect 里 setState (后者会多渲染一帧旧值). 见 react.dev "you might not need an effect".
  // openToken 编码「这次打开的身份 + 数据是否就绪」: editingId 的 project 经 useQuery 异步
  // 到达时 token 从 edit-pending → edit 变化, 触发再同步一次.
  const targetProject = visible && editingId ? items.find((x) => x.id === editingId) : undefined;
  const openToken: string | null = !visible
    ? null
    : editingId
      ? targetProject
        ? `edit:${editingId}`
        : `edit-pending:${editingId}`
      : `new:${initialStage}`;
  // prev-token 只用于比较、不上屏 → 存 ref 而非 state (避免多余 re-render).
  const syncedToken = useRef<string | null>(null);
  if (openToken !== syncedToken.current) {
    syncedToken.current = openToken;
    if (editingId && targetProject) {
      setStage("edit");
      patchDraft({
        name: targetProject.name,
        emoji: targetProject.emoji ?? undefined,
        color: targetProject.color ?? undefined,
        guidance: targetProject.guidance ?? "",
      });
    } else if (visible && !editingId) {
      setStage(initialStage);
      patchDraft(EMPTY_DRAFT);
    }
    // edit-pending (数据未就绪) 与关闭 (openToken=null): 不动草稿 —— 前者等 items 到达再同步,
    // 后者保留草稿给退场动画.
  }

  // 进出动画 driver: 打开时挂载并放入场动画; 关闭时放退场动画, 结束后再卸载.
  useEffect(() => {
    if (visible) {
      // 动画化 Modal 的挂载生命周期: 先挂载再放入场动画, 关闭时放完退场再卸载. Modal 动画前
      // 不可见, 不存在"旧值闪烁", 故 no-adjust-state 在此为误报.
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
      setMounted(true);
      progress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      cardScale.value = withSpring(1, { damping: 18, stiffness: 240, mass: 0.7 });
    } else {
      cardScale.value = withTiming(0.96, { duration: 150, easing: Easing.in(Easing.cubic) });
      progress.value = withTiming(
        0,
        { duration: 150, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [visible, progress, cardScale]);

  const createMut = useMutation({
    mutationFn: createProject,
    onSuccess: async (p) => {
      // 乐观写入缓存: 新分类立即出现在所有 chips/picker (含首页), 不依赖随后的 refetch
      // —— 弱网 / refetch 失败时也能即时显示. 随后再后台对账服务端排序.
      queryClient.setQueryData<ProjectView[]>(["projects"], (old) => (old ? [...old, p] : [p]));
      await setActive(p.id);
      setStage("list");
      onProjectCreated?.(p.id);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: string; input: Parameters<typeof updateProject>[1] }) =>
      updateProject(args.id, args.input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setStage("list");
    },
  });

  const archiveMut = useMutation({
    mutationFn: archiveProject,
    onSuccess: async (_, id) => {
      // 归档当前选中的分类时, 没有"全部"可退回 —— 落到下一个可用分类;
      // 一个都不剩则置空, 由 useEnsureCategory 兜底自动建默认分类.
      if (activeId === id) {
        const remaining = items.filter((p) => p.id !== id && !p.archived_at);
        await setActive(remaining[0]?.id ?? null);
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setStage("list");
    },
  });

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) return;
    if (stage === "create") {
      createMut.mutate({
        name,
        emoji: draft.emoji,
        color: draft.color,
        guidance: draft.guidance.trim() || undefined,
      });
    } else if (stage === "edit" && editingId) {
      updateMut.mutate({
        id: editingId,
        // guidance 传 trim 后的值 (含 "")—— 后端 "" 即清空指引.
        input: {
          name,
          emoji: draft.emoji ?? "",
          color: draft.color ?? "",
          guidance: draft.guidance.trim(),
        },
      });
    }
  };

  const handleArchive = () => {
    if (editingId) archiveMut.mutate(editingId);
  };

  const enterCreate = () => {
    setStage("create");
    patchDraft(EMPTY_DRAFT);
  };

  const enterEdit = (p: ProjectView) => {
    setStage("edit");
    patchDraft({
      name: p.name,
      emoji: p.emoji ?? undefined,
      color: p.color ?? undefined,
      guidance: p.guidance ?? "",
    });
  };

  const busy = createMut.isPending || updateMut.isPending || archiveMut.isPending;

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: cardScale.value }],
  }));

  // Reanimated 的 Animated.View 不认 DynamicColorIOS 动态色 → 卡片底色/阴影取 resolved hex.
  const c = useThemeColors();

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <AnimatedPressable
          style={[styles.backdrop, backdropStyle]}
          onPress={onClose}
          accessibilityLabel="关闭"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.centerWrap}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: c.paper, boxShadow: `0px 12px 28px ${c.ink}2e` },
              cardStyle,
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              {stage === "list" ? (
                <View style={styles.headerSide} />
              ) : (
                <TapEffect
                  onPress={() => setStage("list")}
                  style={styles.headerSide}
                  accessibilityLabel="返回"
                >
                  <Icon name="chevronLeft" size={20} color={theme.color.ink} strokeWidth={1.75} />
                </TapEffect>
              )}
              <Display size={18} style={styles.headerTitle}>
                {stage === "list" ? "分类" : stage === "create" ? "新建分类" : "编辑分类"}
              </Display>
              <TapEffect onPress={onClose} style={styles.headerSide} accessibilityLabel="关闭">
                <Icon name="close" size={20} color={theme.color.ink} strokeWidth={1.75} />
              </TapEffect>
            </View>

            {/* Body */}
            {stage === "list" ? (
              <ListBody
                items={items}
                activeId={activeId}
                onPick={async (id) => {
                  await setActive(id);
                  onClose();
                }}
                onEdit={enterEdit}
                onCreate={enterCreate}
              />
            ) : (
              <EditBody
                stage={stage}
                name={draft.name}
                setName={(v) => patchDraft({ name: v })}
                emoji={draft.emoji}
                setEmoji={(v) => patchDraft({ emoji: v })}
                color={draft.color}
                setColor={(v) => patchDraft({ color: v })}
                guidance={draft.guidance}
                setGuidance={(v) => patchDraft({ guidance: v })}
                onSave={handleSave}
                onArchive={stage === "edit" ? handleArchive : undefined}
                busy={busy}
              />
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ───── List view ─────

interface ListBodyProps {
  items: ProjectView[];
  activeId: string | null;
  onPick: (id: string) => void;
  onEdit: (p: ProjectView) => void;
  onCreate: () => void;
}

function ListBody({ items, activeId, onPick, onEdit, onCreate }: ListBodyProps) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Mono size={9} style={styles.sectionStamp}>
        ◆ 切换分类
      </Mono>
      {/* 分类列表有界 (用户分类数, maxHeight 内滚动), ScrollView+map 足够; rn-no-scrollview-mapped-list 针对长列表. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {items.map((p) => (
        <Row
          key={p.id}
          emoji={p.emoji ?? undefined}
          name={p.name}
          color={p.color ?? undefined}
          active={activeId === p.id}
          onPress={() => onPick(p.id)}
          onEdit={() => onEdit(p)}
        />
      ))}
      <TapEffect onPress={onCreate} style={styles.createRow}>
        <Icon name="plus" size={16} color={theme.color.ink2} strokeWidth={1.75} />
        <Sans size={13} weight="500" style={styles.createLabel}>
          新建分类
        </Sans>
      </TapEffect>
    </ScrollView>
  );
}

interface RowProps {
  emoji?: string;
  name: string;
  color?: string;
  active: boolean;
  onPress: () => void;
  onEdit?: () => void;
}

function Row({ emoji, name, color, active, onPress, onEdit }: RowProps) {
  return (
    <View style={styles.row}>
      <TapEffect onPress={onPress} style={styles.rowMain}>
        {emoji ? (
          <Sans size={16} style={styles.rowEmoji}>
            {emoji}
          </Sans>
        ) : (
          <View style={[styles.rowDot, color ? { backgroundColor: color } : null]} />
        )}
        <Serif size={15} style={styles.rowName}>
          {name}
        </Serif>
        {active ? <Icon name="check" size={16} color={theme.color.ink} strokeWidth={2} /> : null}
      </TapEffect>
      {onEdit ? (
        <TapEffect onPress={onEdit} style={styles.rowEditBtn} accessibilityLabel="编辑">
          <Icon name="pencil" size={14} color={theme.color.muted} strokeWidth={1.5} />
        </TapEffect>
      ) : null}
    </View>
  );
}

// ───── Edit / Create view ─────

interface EditBodyProps {
  stage: "edit" | "create";
  name: string;
  setName: (v: string) => void;
  emoji: string | undefined;
  setEmoji: (v: string | undefined) => void;
  color: string | undefined;
  setColor: (v: string | undefined) => void;
  guidance: string;
  setGuidance: (v: string) => void;
  onSave: () => void;
  onArchive?: () => void;
  busy: boolean;
}

function EditBody({
  stage,
  name,
  setName,
  emoji,
  setEmoji,
  color,
  setColor,
  guidance,
  setGuidance,
  onSave,
  onArchive,
  busy,
}: EditBodyProps) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Mono size={9} style={styles.sectionStamp}>
        ◆ 名称
      </Mono>
      <NativeField
        value={name}
        onChangeText={setName}
        placeholder="例如：泡泡玛特"
        autoCapitalize="sentences"
        maxLength={40}
        bare
        containerStyle={styles.inputBox}
        inputStyle={styles.inputText}
      />

      <Mono size={9} style={[styles.sectionStamp, styles.sectionTop]}>
        ◆ 图标（可选）
      </Mono>
      <View style={styles.swatchRow}>
        <TapEffect
          onPress={() => setEmoji(undefined)}
          style={[styles.emojiSwatch, !emoji && styles.swatchActive]}
        >
          <Sans size={11} style={styles.emojiNone}>
            无
          </Sans>
        </TapEffect>
        {EMOJI_SUGGESTIONS.map((e) => (
          <TapEffect
            key={e}
            onPress={() => setEmoji(e)}
            style={[styles.emojiSwatch, emoji === e && styles.swatchActive]}
          >
            <Sans size={16}>{e}</Sans>
          </TapEffect>
        ))}
      </View>

      <Mono size={9} style={[styles.sectionStamp, styles.sectionTop]}>
        ◆ 颜色（可选）
      </Mono>
      <View style={styles.swatchRow}>
        <TapEffect
          onPress={() => setColor(undefined)}
          style={[styles.colorSwatch, styles.colorNone, !color && styles.swatchActive]}
        >
          <Sans size={11} style={styles.emojiNone}>
            无
          </Sans>
        </TapEffect>
        {projectSwatches.map((c) => (
          <TapEffect
            key={c}
            onPress={() => setColor(c)}
            style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.swatchActive]}
          >
            <View />
          </TapEffect>
        ))}
      </View>

      <Mono size={9} style={[styles.sectionStamp, styles.sectionTop]}>
        ◆ 分析指引（可选）
      </Mono>
      <Serif size={12} italic style={styles.guidanceHint}>
        给这个分类的 AI 推理写一句偏好，例如“关注渠道动销与海外扩张”。留空则不影响。
      </Serif>
      <NativeField
        value={guidance}
        onChangeText={setGuidance}
        placeholder="这个分类要 AI 特别留意什么…"
        autoCapitalize="sentences"
        multiline
        maxLength={2000}
        minHeight={88}
        bare
        containerStyle={styles.inputBox}
        inputStyle={styles.guidanceText}
      />

      <TapEffect
        onPress={onSave}
        disabled={!name.trim() || busy}
        style={[styles.saveBtn, (!name.trim() || busy) && styles.saveBtnDisabled]}
      >
        <Sans size={13} weight="600" style={styles.saveLabel}>
          {stage === "create" ? "创建" : "保存"}
        </Sans>
      </TapEffect>

      {onArchive ? (
        <TapEffect onPress={onArchive} disabled={busy} style={styles.archiveBtn}>
          <Sans size={12} weight="500" style={styles.archiveLabel}>
            归档此分类
          </Sans>
        </TapEffect>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.38)",
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "82%",
    // backgroundColor / shadowColor 内联 resolved hex — Reanimated 不认动态色.
    borderRadius: theme.radius.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    // 居中浮层用投影做层级提示 —— boxShadow 在 Animated.View 内联 (色值是动态 resolved hex).
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  headerSide: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: theme.color.ink,
  },
  body: {
    maxHeight: 560,
  },
  bodyContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  sectionStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  sectionTop: {
    marginTop: theme.spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 10,
  },
  rowEmoji: {
    width: 22,
    textAlign: "center",
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 6,
    backgroundColor: theme.color.muted2,
  },
  rowName: {
    flex: 1,
    color: theme.color.ink,
  },
  rowEditBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  createLabel: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
  inputBox: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  inputText: {
    fontSize: 15,
    color: theme.color.ink,
  },
  guidanceHint: {
    color: theme.color.muted,
    marginBottom: 8,
  },
  guidanceText: {
    fontSize: 15,
    color: theme.color.ink,
    lineHeight: 21,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  emojiSwatch: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
  },
  emojiNone: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  colorSwatch: {
    width: 38,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
  },
  colorNone: {
    backgroundColor: theme.color.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchActive: {
    borderColor: theme.color.ink,
    borderWidth: 2,
  },
  saveBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.color.ink,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: {
    backgroundColor: theme.color.muted2,
  },
  saveLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  archiveBtn: {
    marginTop: theme.spacing.md,
    paddingVertical: 10,
    alignItems: "center",
  },
  archiveLabel: {
    color: theme.color.red,
    letterSpacing: 1,
  },
});

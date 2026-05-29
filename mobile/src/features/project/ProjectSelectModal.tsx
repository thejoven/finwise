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

import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
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
import { Check, ChevronLeft, Pencil, Plus, X } from "lucide-react-native";

import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
  type ProjectView,
} from "@/core/api/project";
import { theme } from "@/core/theme";
import { Display, Mono, Sans, Serif, TapEffect } from "@/shared/components";

import { useActiveProject } from "./store";

type Stage = "list" | "edit" | "create";

interface Props {
  visible: boolean;
  editingId: string | null;
  onClose: () => void;
}

const EMOJI_SUGGESTIONS = ["🧸", "🔋", "🏦", "💊", "🛢️", "🤖", "🌐", "📱", "🪙", "🍵"];
const COLOR_SWATCHES = ["#a8201a", "#2e5e3a", "#1f4e79", "#7a4f01", "#5a2a82", "#2a2a2a"];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ProjectSelectModal({ visible, editingId, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("list");
  const [draftName, setDraftName] = useState("");
  const [draftEmoji, setDraftEmoji] = useState<string | undefined>(undefined);
  const [draftColor, setDraftColor] = useState<string | undefined>(undefined);

  // 居中弹层的进出动画: progress 控背景遮罩 + 卡片整体透明度, cardScale 控"弹出"缩放.
  // Modal 的 visible 跟随本地 mounted —— 关闭时先放完退场动画, 再卸载 Modal.
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const cardScale = useSharedValue(0.92);

  const queryClient = useQueryClient();
  const activeId = useActiveProject((s) => s.activeId);
  const setActive = useActiveProject((s) => s.setActive);
  const clearIfMatches = useActiveProject((s) => s.clearIfMatches);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const items: ProjectView[] = projects ?? [];

  // visible + editingId 决定打开后的初始 stage
  useEffect(() => {
    if (!visible) return;
    if (editingId) {
      const p = items.find((x) => x.id === editingId);
      if (p) {
        setStage("edit");
        setDraftName(p.name);
        setDraftEmoji(p.emoji ?? undefined);
        setDraftColor(p.color ?? undefined);
        return;
      }
    }
    setStage("list");
    setDraftName("");
    setDraftEmoji(undefined);
    setDraftColor(undefined);
    // items 在第一次空, useQuery 拉到后才能 find — 加 items 作为依赖
  }, [visible, editingId, items]);

  // 进出动画 driver: 打开时挂载并放入场动画; 关闭时放退场动画, 结束后再卸载.
  useEffect(() => {
    if (visible) {
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
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await setActive(p.id);
      setStage("list");
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
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await clearIfMatches(id);
      setStage("list");
    },
  });

  const handleSave = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (stage === "create") {
      createMut.mutate({ name, emoji: draftEmoji, color: draftColor });
    } else if (stage === "edit" && editingId) {
      updateMut.mutate({
        id: editingId,
        input: { name, emoji: draftEmoji ?? "", color: draftColor ?? "" },
      });
    }
  };

  const handleArchive = () => {
    if (editingId) archiveMut.mutate(editingId);
  };

  const enterCreate = () => {
    setStage("create");
    setDraftName("");
    setDraftEmoji(undefined);
    setDraftColor(undefined);
  };

  const enterEdit = (p: ProjectView) => {
    setStage("edit");
    setDraftName(p.name);
    setDraftEmoji(p.emoji ?? undefined);
    setDraftColor(p.color ?? undefined);
  };

  const busy = createMut.isPending || updateMut.isPending || archiveMut.isPending;

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: cardScale.value }],
  }));

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
          <Animated.View style={[styles.card, cardStyle]}>
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
                  <ChevronLeft size={20} color={theme.color.ink} strokeWidth={1.75} />
                </TapEffect>
              )}
              <Display size={18} style={styles.headerTitle}>
                {stage === "list" ? "分类" : stage === "create" ? "新建分类" : "编辑分类"}
              </Display>
              <TapEffect onPress={onClose} style={styles.headerSide} accessibilityLabel="关闭">
                <X size={20} color={theme.color.ink} strokeWidth={1.75} />
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
                onPickAll={async () => {
                  await setActive(null);
                  onClose();
                }}
                onEdit={enterEdit}
                onCreate={enterCreate}
              />
            ) : (
              <EditBody
                stage={stage}
                name={draftName}
                setName={setDraftName}
                emoji={draftEmoji}
                setEmoji={setDraftEmoji}
                color={draftColor}
                setColor={setDraftColor}
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
  onPickAll: () => void;
  onEdit: (p: ProjectView) => void;
  onCreate: () => void;
}

function ListBody({ items, activeId, onPick, onPickAll, onEdit, onCreate }: ListBodyProps) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Mono size={9} style={styles.sectionStamp}>
        ◆ 切换分类
      </Mono>
      <Row emoji={undefined} name="全部" active={activeId === null} onPress={onPickAll} />
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
        <Plus size={16} color={theme.color.ink2} strokeWidth={1.75} />
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
        {active ? <Check size={16} color={theme.color.ink} strokeWidth={2} /> : null}
      </TapEffect>
      {onEdit ? (
        <TapEffect onPress={onEdit} style={styles.rowEditBtn} accessibilityLabel="编辑">
          <Pencil size={14} color={theme.color.muted} strokeWidth={1.5} />
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
  onSave,
  onArchive,
  busy,
}: EditBodyProps) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Mono size={9} style={styles.sectionStamp}>
        ◆ 名称
      </Mono>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="例如：泡泡玛特"
        placeholderTextColor={theme.color.muted2}
        style={styles.input}
        maxLength={40}
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
        {COLOR_SWATCHES.map((c) => (
          <TapEffect
            key={c}
            onPress={() => setColor(c)}
            style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.swatchActive]}
          >
            <View />
          </TapEffect>
        ))}
      </View>

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
    backgroundColor: theme.color.paper,
    borderRadius: theme.radius.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    // 居中浮层用投影做层级提示 (底部弹层贴边不需要, 居中浮起需要)
    shadowColor: theme.color.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
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
  input: {
    fontSize: 15,
    color: theme.color.ink,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
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

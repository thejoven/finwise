/**
 * CategoryDropdown — 锚定在分类触发器旁弹出的分类下拉框.
 *
 * 替代旧的"全部 + chips 横滑条". 产品要求 (见 GOAL):
 *   - 点击分类触发器 (现为底栏的独立分类格) → 在其近旁弹出此下拉框.
 *   - 列表里**没有"全部"**, 每一项都是真实分类; 点一项即切换并关闭.
 *   - 末尾 "＋ 新建分类"; 每行右侧铅笔进入编辑. 二者都委托父级打开 ProjectSelectModal,
 *     避免在 Modal 里再套 Modal.
 *
 * 锚点 anchor 是触发器在屏幕坐标系里的矩形 (measureInWindow 得到). 面板就近弹出:
 *   锚点在屏幕上半部 → 贴下沿向下弹; 在下半部 (如底栏的分类格) → 贴上沿向上弹.
 * 进出动画与 ProjectSelectModal 同套路: progress 控不透明度, 卡片 scale + 轻微位移
 *   (位移方向随弹出方向翻转).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ScrollView } from "react-native-gesture-handler";

import { type ProjectView } from "@/core/api/project";
import { theme, useThemeColors } from "@/core/theme";
// 走具体文件而非 "@/shared/components" barrel: 避免 shared ⇄ feature 的 require cycle.
import { Icon } from "@/shared/components/Icon";
import { Sans } from "@/shared/components/Text";
import { TapEffect } from "@/shared/components/TapEffect";

export interface DropdownAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  anchor: DropdownAnchor | null;
  /** 已过滤掉归档的可选分类. */
  projects: ProjectView[];
  activeId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  /** 退场动画结束、Modal 真正卸载后触发 —— 调用方借此"先关下拉再开别的 Modal", 避开 iOS 同时呈现两个 Modal 的报错. */
  onClosed?: () => void;
}

const PANEL_WIDTH = 280;
const GAP = 6;

export function CategoryDropdown({
  visible,
  anchor,
  projects,
  activeId,
  onClose,
  onPick,
  onCreate,
  onEdit,
  onClosed,
}: Props) {
  // 初值 false: 这些下拉/弹层恒由父级以 visible=false 创建后再 toggle, 故不从 prop 派生 ——
  // 打开时 effect 挂载并放入场动画, 关闭时放完退场再卸载.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);
  const c = useThemeColors();

  // onClosed 用 ref 持最新值: 退场完成回调在 worklet 里跑, 普通闭包会过期, 走 ref 取当前的.
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const notifyClosed = useCallback(() => onClosedRef.current?.(), []);

  useEffect(() => {
    if (visible) {
      // 动画化 Modal 的挂载生命周期: 先挂载再放入场动画, 关闭时放完退场再卸载. Modal 在
      // 动画前不可见, 不存在"旧值闪烁", 故 no-adjust-state 在此为误报.
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
      setMounted(true);
      progress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
    } else {
      progress.value = withTiming(
        0,
        { duration: 130, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(setMounted)(false);
            runOnJS(notifyClosed)(); // Modal 卸载后通知调用方 (此时可安全开下一个 Modal)
          }
        },
      );
    }
  }, [visible, progress, notifyClosed]);

  // 屏幕尺寸 + 弹出方向: 锚点中心落在下半屏 → 向上弹, 否则向下弹.
  const { width: screenW, height: screenH } = useWindowDimensions();
  const dropUp = anchor ? anchor.y + anchor.height / 2 > screenH / 2 : false;

  // 入场位移方向: 向下弹从上方 -6 落下; 向上弹从下方 +6 升起.
  const enterFrom = dropUp ? 6 : -6;
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * enterFrom },
      { scale: 0.96 + progress.value * 0.04 },
    ],
  }));

  // 屏幕宽度内夹住面板水平位置: 以触发器中心对齐, 不越出左右安全边距.
  const margin = theme.spacing.md;
  const centerX = anchor ? anchor.x + anchor.width / 2 : screenW / 2;
  const rawLeft = centerX - PANEL_WIDTH / 2;
  const left = Math.max(margin, Math.min(rawLeft, screenW - PANEL_WIDTH - margin));
  // 向下: 顶边贴触发器下沿; 向上: 底边贴触发器上沿 (bottom 锚, 面板高度随分类数自适应也不跑位).
  const verticalPos = anchor
    ? dropUp
      ? { bottom: screenH - anchor.y + GAP }
      : { top: anchor.y + anchor.height + GAP }
    : { top: 0 };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭" />
      <Animated.View
        style={[
          styles.panel,
          {
            left,
            ...verticalPos,
            backgroundColor: c.paper,
            borderColor: c.rule,
            // 动态 resolved hex 色 → boxShadow 内联 (新架构跨平台投影, 取代旧 shadow*/elevation).
            boxShadow: `0px 10px 22px ${c.ink}29`,
          },
          panelStyle,
        ]}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 分类菜单有界 (用户分类数, maxHeight 内滚动), ScrollView+map 足够; 长列表才需 FlatList. */}
          {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
          {projects.map((p) => {
            const active = p.id === activeId;
            return (
              <TapEffect
                key={p.id}
                onPress={() => onPick(p.id)}
                style={styles.row}
                accessibilityLabel={`切到分类「${p.name}」`}
              >
                {p.emoji ? (
                  <Sans size={14} style={styles.rowEmoji}>
                    {p.emoji}
                  </Sans>
                ) : (
                  <View style={[styles.rowDot, p.color ? { backgroundColor: p.color } : null]} />
                )}
                <RNText
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={[styles.rowName, active && styles.rowNameActive]}
                >
                  {p.name}
                </RNText>
                {active ? (
                  <Icon name="check" size={15} color={theme.color.ink} strokeWidth={2} />
                ) : (
                  <TapEffect
                    onPress={() => onEdit(p.id)}
                    style={styles.editBtn}
                    accessibilityLabel={`编辑分类「${p.name}」`}
                  >
                    <Icon name="pencil" size={13} color={theme.color.muted} strokeWidth={1.5} />
                  </TapEffect>
                )}
              </TapEffect>
            );
          })}

          <View style={styles.divider} />

          <TapEffect onPress={onCreate} style={styles.createRow} accessibilityLabel="新建分类">
            <Icon name="plus" size={15} color={theme.color.ink2} strokeWidth={1.75} />
            <Sans size={12} weight="500" style={styles.createLabel}>
              新建分类
            </Sans>
          </TapEffect>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.14)",
  },
  panel: {
    position: "absolute",
    width: PANEL_WIDTH,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    // borderColor 走内联 resolved hex (c.rule): Reanimated 不认 DynamicColorIOS 动态色.
    paddingVertical: theme.spacing.xs,
    // 居中浮起用投影做层级提示 — boxShadow 在 Animated.View 内联 (色值是动态 resolved hex).
  },
  scroll: {
    maxHeight: 320,
  },
  scrollContent: {
    paddingVertical: theme.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
  },
  rowEmoji: {
    width: 20,
    textAlign: "center",
  },
  rowDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginHorizontal: 5,
    backgroundColor: theme.color.muted2,
  },
  rowName: {
    flex: 1,
    fontFamily: theme.fontFamily.cjkRegular, // 与报头主名"财知"同族 (NotoSerifSC), 保住报刊感
    fontSize: 14,
    color: theme.color.ink2,
  },
  rowNameActive: {
    fontFamily: theme.fontFamily.cjkBold, // 选中项加粗, 呼应标题字重
    color: theme.color.ink,
  },
  editBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginVertical: 4,
    marginHorizontal: theme.spacing.md,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: theme.spacing.md,
  },
  createLabel: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
});

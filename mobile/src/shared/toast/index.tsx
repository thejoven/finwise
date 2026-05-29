/**
 * Toast 系统 — 报刊风, 自定义 type config.
 *
 * 用法:
 *   import { showToast } from "@/shared/toast";
 *   showToast({ stamp: "AI 推演", title: "你的信号 HBM ...", subtitle: "点开查看 ↗" });
 *
 * 在 _layout 挂一次 <ToastRoot /> 即可.
 *
 * 视觉 (单 type "newspaper"):
 *   左侧 2px ink 竖条 · paper2 背景 · Mono stamp 行 · Display 标题 · Serif 副标
 */

import { StyleSheet, View } from "react-native";
import Toast, { BaseToastProps, ToastConfig, ToastShowParams } from "react-native-toast-message";

import { Display, Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import { useNotifications, type NotificationType } from "@/features/notifications";

type NewspaperProps = BaseToastProps & {
  // text1 = stamp + title 用 " · " 分隔, 例 "AI 推演 · 你的信号 HBM ..."
  // text2 = subtitle / 提示
  // 我们自己 parse: text1Style/text2Style 不用
};

function NewspaperToast({ text1, text2 }: NewspaperProps) {
  const [stamp, title] = parseText1(text1);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.accent} />
        <View style={styles.body}>
          {stamp ? (
            <Mono size={9} style={styles.stamp}>
              {stamp}
            </Mono>
          ) : null}
          {title ? (
            <Display size={15} style={styles.title} numberOfLines={2}>
              {title}
            </Display>
          ) : null}
          {text2 ? (
            <Serif size={12} italic style={styles.subtitle} numberOfLines={2}>
              {text2}
            </Serif>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** text1 写成 "STAMP · 标题"; 没有 "·" 则全归到 title. */
function parseText1(text1?: string): [string | undefined, string | undefined] {
  if (!text1) return [undefined, undefined];
  const idx = text1.indexOf("·");
  if (idx === -1) return [undefined, text1.trim()];
  return [text1.slice(0, idx).trim(), text1.slice(idx + 1).trim()];
}

const toastConfig: ToastConfig = {
  newspaper: (props) => <NewspaperToast {...props} />,
};

// ──────────────────── Public API ────────────────────

export interface ShowToastOpts {
  /** 顶部 Mono 小字, 例 "AI 推演" */
  stamp?: string;
  /** 主标题, Display 字体 */
  title: string;
  /** 可选副标 Serif italic */
  subtitle?: string;
  /** 默认 3500ms */
  durationMs?: number;
}

export function showToast(opts: ShowToastOpts): void {
  const text1 = opts.stamp ? `${opts.stamp} · ${opts.title}` : opts.title;
  const params: ToastShowParams = {
    type: "newspaper",
    text1,
    text2: opts.subtitle,
    visibilityTime: opts.durationMs ?? 3500,
    topOffset: 60,
  };
  Toast.show(params);
}

export function hideToast(): void {
  Toast.hide();
}

// ──────────────────── notify (toast + 持久化通知中心) ────────────────────

export interface NotifyOpts extends ShowToastOpts {
  /** 通知类型, 用于分类/筛选 */
  type: NotificationType;
  /** tap 通知后跳转的 expo-router 路径 (可选) */
  href?: string;
}

/**
 * notify — 一次性把通知投送到两个目的地:
 *   1. Toast 即时反馈 (3.5s 自动消失)
 *   2. 持久化通知中心 (用户在"我的 → 消息通知"里能看到历史)
 *
 * 用 hook 调用方式: 因 Zustand getter, 在非 React 上下文调用要走 getState().
 * 这里直接调 useNotifications.getState().push — fire-and-forget.
 */
export function notify(opts: NotifyOpts): void {
  showToast(opts);
  void useNotifications.getState().push({
    type: opts.type,
    stamp: opts.stamp ?? "通知",
    title: opts.title,
    subtitle: opts.subtitle,
    href: opts.href,
  });
}

/** Root 组件: 在 app 入口挂一次. */
export function ToastRoot() {
  return <Toast config={toastConfig} />;
}

const styles = StyleSheet.create({
  wrap: {
    width: "92%",
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  row: {
    flexDirection: "row",
    minHeight: 64,
  },
  accent: {
    width: 3,
    backgroundColor: theme.color.ink,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: 2,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: {
    color: theme.color.ink,
    lineHeight: 22,
  },
  subtitle: {
    color: theme.color.muted,
    lineHeight: 18,
    marginTop: 2,
  },
});

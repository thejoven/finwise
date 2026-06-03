import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";
import { getMe, logout, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { useAppearance, type AppearancePref } from "@/core/theme/store";
import { useNotifications } from "@/features/notifications";

/**
 * 个人资料 tab.
 *
 * 内容:
 *   · 报刊头 (卷号戳 + 标题) + 方形字母章 + 用户昵称 / 邮箱 / 加入日期
 *   · bio (如果有)
 *   · 分组 (红菱形栏目戳): 账号 / 通讯 / 外观 / 其他 + 退出登录
 *
 * 首次进入会调一次 GET /v1/me 同步最新 — store 里可能是离线时的旧值.
 */
export default function ProfileScreen() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const clear = useAuth((s) => s.clear);
  const token = useAuth((s) => s.token);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  // 悬浮"灵动岛" tab 顶 ≈ insets.bottom + 64 (见 DynamicIslandTabBar). 退出登录是按钮,
  // 必须整条在岛上方可点 — 不像其它 tab 末尾是列表(内容透到岛下是有意的). 故在 64 之上
  // 再加一档留白. 原来用静态 xxxl(48) 不含 safe-area, 在刘海机上被岛盖住, 这是本次修复点.
  const bottomPad = insets.bottom + 64 + theme.spacing.lg;

  // 进入时拉一次最新. 没 token (dev fallback 模式) 就不拉.
  useEffect(() => {
    if (!token) return;
    let mounted = true;
    setRefreshing(true);
    getMe()
      .then((u) => {
        if (mounted) {
          void setUser({
            id: u.id,
            email: u.email,
            display_name: u.display_name ?? null,
            avatar_url: u.avatar_url ?? null,
            bio: u.bio ?? null,
            created_at: u.created_at,
          });
        }
      })
      .catch(async (err) => {
        if (mounted) setError(await readErrorMessage(err));
      })
      .finally(() => {
        if (mounted) setRefreshing(false);
      });
    return () => {
      mounted = false;
    };
  }, [token, setUser]);

  const handleLogout = useCallback(() => {
    Alert.alert("退出登录", "确认退出当前账号?", [
      { text: "再想想", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: async () => {
          try {
            await logout();
          } catch {
            // server 错误不阻塞本地清理 — token 反正不会再用.
          }
          await clear();
          router.replace("/login");
        },
      },
    ]);
  }, [clear]);

  // 没登录但 dev fallback 在用 — 显示 "调试模式" 占位.
  if (!user && !token) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
          <Mono size={9} style={styles.headStamp}>
            VOL. I · 读者档案
          </Mono>
          <Display size={28} italic style={styles.title}>
            个人资料.
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            当前为调试 dev token 模式, 未登录任何账号。
          </Serif>
          <RowLink label="登录账号" onPress={() => router.push("/login")} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const displayName = user?.display_name?.trim() || user?.email || "—";
  const initial = displayName.charAt(0).toUpperCase();
  const createdLabel = user?.created_at
    ? new Date(user.created_at).toISOString().slice(0, 10)
    : "—";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
        <Mono size={9} style={styles.headStamp}>
          VOL. I · 读者档案
        </Mono>
        <Display size={28} italic style={styles.title}>
          个人资料.
        </Display>
        <DoubleRule />

        {/* 字母章 + 身份 */}
        <View style={styles.headBlock}>
          <View style={styles.monogram}>
            <Display size={30} style={styles.monogramText}>
              {initial}
            </Display>
          </View>
          <View style={styles.identity}>
            <Serif size={20} weight="semibold" style={styles.name}>
              {displayName}
            </Serif>
            {user?.email ? (
              <Mono size={11} style={styles.email}>
                {user.email}
              </Mono>
            ) : null}
            <Mono size={9} style={styles.metaLine}>
              加入于 {createdLabel}
            </Mono>
          </View>
        </View>

        {user?.bio ? (
          <View style={styles.bioBlock}>
            <Serif size={14} italic style={styles.bio}>
              {user.bio}
            </Serif>
          </View>
        ) : (
          <View style={styles.bioBlock}>
            <Serif size={12} italic style={styles.bioMuted}>
              还没写个人签名。
            </Serif>
          </View>
        )}

        {error ? (
          <Serif size={11} italic style={styles.error}>
            {error}
          </Serif>
        ) : null}
        {refreshing ? (
          <Mono size={9} style={styles.metaLine}>
            同步中…
          </Mono>
        ) : null}

        <View style={styles.section}>
          <SectionHeader label="账号" />
          <RowLink label="编辑资料" onPress={() => router.push("/profile/edit")} />
          <RowLink label="修改密码" onPress={() => router.push("/profile/password")} />
        </View>

        <View style={styles.section}>
          <SectionHeader label="通讯" />
          <NotificationRow />
        </View>

        <View style={styles.section}>
          <SectionHeader label="外观" />
          <AppearanceRows />
        </View>

        <View style={styles.section}>
          <SectionHeader label="其他" />
          <RowLink label="卷首语 · 关于" onPress={() => router.push("/colophon")} />
          <RowLink label="搜索观察记录" onPress={() => router.push("/search")} />
        </View>

        <View style={styles.section}>
          {token ? (
            <TapEffect style={styles.dangerBtn} onPress={handleLogout}>
              <Sans size={11} weight="700" style={styles.dangerLabel}>
                退出登录
              </Sans>
            </TapEffect>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const APPEARANCE_OPTIONS: { key: AppearancePref; label: string }[] = [
  { key: "light", label: "光亮" },
  { key: "dark", label: "暗黑" },
  { key: "system", label: "跟随系统" },
];

/**
 * @expo/ui 是 beta **原生**模块: 只有 `expo prebuild` + 原生重建后, 二进制里才有 'ExpoUI'
 * 原生模块. Expo Go / 未重建的 dev client 里没有 —— 此时连 require 它的 JS 顶层都会抛
 * (Cannot find native module 'ExpoUI'). 故把 require 包在 try/catch 里探测: 有就用原生
 * SwiftUI 控件, 没有就优雅回退到自绘行 —— App 照常跑、不崩; 原生重建后此控件自动点亮.
 */
let SwiftUI: typeof import("@expo/ui/swift-ui") | null = null;
let SwiftUIModifiers: typeof import("@expo/ui/swift-ui/modifiers") | null = null;
if (Platform.OS === "ios") {
  try {
    SwiftUI = require("@expo/ui/swift-ui");
    SwiftUIModifiers = require("@expo/ui/swift-ui/modifiers");
  } catch {
    SwiftUI = null;
    SwiftUIModifiers = null;
  }
}

/**
 * 外观选择器 — 光亮 / 暗黑 / 跟随系统.
 *
 * iOS + 已原生重建: 原生 SwiftUI 分段控件 (@expo/ui) —— 真·原生控件, 不是自绘. 这是"用
 *   AppKit/原生 UI"的示范面: 设置类工具控件用系统外观本就合适, SwiftUI Picker 自带
 *   Dynamic Type / 暗色 / 触感.
 * 其他情况 (Android / Expo Go / 未 rebuild): 自绘行 + 红菱形 (Android 故意只跑浅色).
 * 切换即时生效: useAppearance → Appearance.setColorScheme → 全 App 动态色重解析.
 */
function AppearanceRows() {
  const pref = useAppearance((s) => s.pref);
  const setPref = useAppearance((s) => s.setAppearance);

  if (SwiftUI && SwiftUIModifiers) {
    const { Host, Picker, Text: SwiftUIText } = SwiftUI;
    const { pickerStyle, tag } = SwiftUIModifiers;
    return (
      <View style={styles.appearanceHost}>
        <Host matchContents>
          <Picker
            selection={pref}
            onSelectionChange={(value) => void setPref(value as AppearancePref)}
            modifiers={[pickerStyle("segmented")]}
          >
            {APPEARANCE_OPTIONS.map((o) => (
              <SwiftUIText key={o.key} modifiers={[tag(o.key)]}>
                {o.label}
              </SwiftUIText>
            ))}
          </Picker>
        </Host>
      </View>
    );
  }

  return (
    <>
      {APPEARANCE_OPTIONS.map((o) => (
        <TapEffect
          key={o.key}
          style={styles.row}
          onPress={() => {
            void setPref(o.key);
          }}
          pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        >
          <Serif size={14} style={styles.rowLabel}>
            {o.label}
          </Serif>
          {pref === o.key ? <View style={styles.badgeDot} /> : null}
        </TapEffect>
      ))}
    </>
  );
}

function RowLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TapEffect
      style={styles.row}
      onPress={onPress}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
    >
      <Serif size={14} style={styles.rowLabel}>
        {label}
      </Serif>
      <Icon name="chevronRight" size={16} color={theme.color.muted2} strokeWidth={1.5} />
    </TapEffect>
  );
}

/**
 * NotificationRow — 通知中心入口, 含未读 badge.
 * 未读 N > 0 → red diamond + Mono "N" 数字; 0 → 灰 "无";
 */
function NotificationRow() {
  const items = useNotifications((s) => s.items);
  const unread = items.filter((n) => !n.read).length;
  const total = items.length;
  const right =
    unread > 0 ? (
      <View style={styles.badgeRow}>
        <View style={styles.badgeDot} />
        <Mono size={10} style={styles.badgeCount}>
          {unread}
        </Mono>
        <Icon name="chevronRight" size={16} color={theme.color.ink2} strokeWidth={1.5} />
      </View>
    ) : (
      <View style={styles.badgeRow}>
        <Mono size={10} style={styles.badgeMuted}>
          {total === 0 ? "无" : `${total}`}
        </Mono>
        <Icon name="chevronRight" size={16} color={theme.color.muted2} strokeWidth={1.5} />
      </View>
    );
  return (
    <TapEffect
      style={styles.row}
      onPress={() => router.push("/notifications")}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
    >
      <Serif size={14} style={styles.rowLabel}>
        消息通知
      </Serif>
      {right}
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxxl,
  },
  headStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: theme.spacing.xs,
  },
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  headBlock: {
    marginTop: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.base,
  },
  monogram: {
    width: 56,
    height: 56,
    borderWidth: 1.5,
    borderColor: theme.color.ink,
    backgroundColor: theme.color.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  monogramText: { color: theme.color.ink },
  identity: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  name: { color: theme.color.ink },
  email: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  metaLine: {
    color: theme.color.muted2,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  bioBlock: {
    marginTop: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  bio: { color: theme.color.ink2, lineHeight: 22 },
  bioMuted: { color: theme.color.muted2 },
  error: { color: theme.color.red, marginTop: theme.spacing.md },

  section: { marginTop: theme.spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowLabel: { color: theme.color.ink },
  appearanceHost: {
    // 原生 SwiftUI 分段控件的容器 — 与列表行同一纵向节奏.
    paddingVertical: theme.spacing.md,
  },
  dangerBtn: {
    paddingVertical: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    alignItems: "center",
  },
  dangerLabel: {
    color: theme.color.red,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  badgeDot: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
  badgeCount: {
    color: theme.color.red,
    letterSpacing: 1,
    marginRight: 2,
  },
  badgeMuted: {
    color: theme.color.muted2,
    letterSpacing: 1,
    marginRight: 2,
  },
});

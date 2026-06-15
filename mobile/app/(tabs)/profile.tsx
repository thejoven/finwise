import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
import { UI, MODS, hasNativeUI } from "@/shared/native";
import { theme, useThemeColors } from "@/core/theme";
import { getMe, logout, readErrorMessage } from "@/core/api/account";
import { useAuth, type AuthUser } from "@/core/auth/store";
import { useNotifications } from "@/features/notifications";

/**
 * 个人资料 tab.
 *
 * 编排:
 *   · 上半「报刊头」(RN, 始终自绘): 档案标识 + 标题 + 方形字母章 + 昵称/邮箱/加入日期 + bio.
 *     ——这是 bespoke editorial 面, 按约定保持自绘 (见 memory: mobile-native-ui-conventions).
 *   · 下半「设置」: 原生 SwiftUI `Form` (@expo/ui) —— 真·原生 iOS 分组列表, 自带分组卡片 /
 *     分隔线 / 触感 / 动态明暗. 只两组:「账号」「偏好」+ 退出登录, 不再四组零散.
 *     原生不可用时 (Android / Expo Go / 未 rebuild) 优雅回退到自绘行, 同样两组.
 *
 * 首次进入会调一次 GET /v1/me 同步最新 — store 里可能是离线时的旧值.
 */
export default function ProfileScreen() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const clear = useAuth((s) => s.clear);
  const token = useAuth((s) => s.token);
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  // 给悬浮"灵动岛"让位: 标准空隙 TAB_BAR_CLEARANCE (见 glass). 自绘回退路径用 ScrollView,
  // 末尾退出登录是按钮, 须整条在岛上方可点 — 故在标准空隙之上再加一档. 原生 Form 路径内容
  // 顶对齐 + 屏底大片留白, 行本就不会落到岛下, 无需此 pad.
  const bottomPad = insets.bottom + TAB_BAR_CLEARANCE + theme.spacing.sm;

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
    Alert.alert(t("profile.logout.action"), t("profile.logout.confirm"), [
      { text: t("profile.logout.cancel"), style: "cancel" },
      {
        text: t("profile.logout.confirmAction"),
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
  }, [clear, t]);

  // 没登录但 dev fallback 在用 — 显示 "调试模式" 占位.
  if (!user && !token) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
          <Mono size={9} style={styles.headStamp}>
            {t("profile.archiveStamp")}
          </Mono>
          <Display size={28} italic style={styles.title}>
            {t("profile.title")}
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            {t("profile.devMode.notice")}
          </Serif>
          <RowLink label={t("profile.devMode.login")} onPress={() => router.push("/login")} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const header = <ProfileHeader user={user} error={error} refreshing={refreshing} />;

  // ── 原生 SwiftUI Form 路径 ─────────────────────────────────────────
  // 报刊头钉在顶部 (RN), 原生 Form 充满其下 (自带滚动) —— 避免 RN ScrollView 套原生
  // 滚动列表的测高/嵌套滚动问题. 内容短, 顶对齐, 不会落到悬浮 tab 之下.
  if (hasNativeUI) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.nativeRoot}>
          <View style={styles.nativeHeader}>{header}</View>
          <NativeSettingsForm token={token} onLogout={handleLogout} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 自绘回退路径 (Android / Expo Go / 未 rebuild) ──────────────────
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
        {header}
        <FallbackSettings token={token} onLogout={handleLogout} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** 报刊头 — 档案标识 / 标题 / 字母章 + 身份 / bio / 同步状态. 原生与回退两路共用 (始终 RN 自绘). */
function ProfileHeader({
  user,
  error,
  refreshing,
}: {
  user: AuthUser | null;
  error: string | null;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const displayName = user?.display_name?.trim() || user?.email || "—";
  const initial = displayName.charAt(0).toUpperCase();
  const createdLabel = user?.created_at
    ? new Date(user.created_at).toISOString().slice(0, 10)
    : "—";

  return (
    <>
      <Mono size={9} style={styles.headStamp}>
        {t("profile.archiveStamp")}
      </Mono>
      <Display size={28} italic style={styles.title}>
        {t("profile.title")}
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
            {t("profile.joinedOn", { date: createdLabel })}
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
            {t("profile.bioEmpty")}
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
          {t("profile.syncing")}
        </Mono>
      ) : null}
    </>
  );
}

/**
 * 原生 iOS 设置表 —— 真·原生 SwiftUI `Form` (@expo/ui). 仅在 `hasNativeUI` 时渲染, 故内部
 * 放心用 `UI!` / `MODS!`. 分模块:
 *   · 账号  —— 编辑资料 / 修改密码 / 消息通知 (未读数红字)
 *   · 设置  —— 偏好 (二级页: 外观 / 语言) / 卷首语·关于
 *   · 退出登录 —— 独立 destructive section
 *
 * 偏好(外观/语言)挪进二级页 app/profile/preferences, 主页只留导航入口, 让设置项分模块更清爽.
 *
 * 配色: 原生修饰符只吃 hex 字符串, 故用 `useThemeColors()` 拿当前明暗的纯 hex (外观切换会
 *   重渲染). 画到 paper/paper2 上 (而非系统灰), 与全 App 纸感统一; 结构 (分组卡 / 分隔线 /
 *   触感) 仍是系统原生.
 */
function NativeSettingsForm({ token, onLogout }: { token: string | null; onLogout: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const items = useNotifications((s) => s.items);
  const unread = items.filter((n) => !n.read).length;

  const { Host, Form, Section, Button, HStack, Spacer, Text: T, Image } = UI!;
  const { buttonStyle, foregroundStyle, tint, listRowBackground, scrollContentBackground, bold } =
    MODS!;

  /** 标准导航行: 主标题 + 可选尾随值 + 灰 chevron, 整行可点 (List 行里 Button 天然全宽命中). */
  const navRow = (label: string, onPress: () => void, trailing?: ReactElement) => (
    <Button onPress={onPress} modifiers={[buttonStyle("plain")]}>
      <HStack spacing={6}>
        <T modifiers={[foregroundStyle(c.ink)]}>{label}</T>
        <Spacer />
        {trailing}
        <Image systemName="chevron.right" size={13} color={c.muted2} />
      </HStack>
    </Button>
  );

  return (
    <Host style={styles.nativeHost}>
      <Form modifiers={[scrollContentBackground("hidden"), tint(c.red)]}>
        <Section title={t("profile.sections.account")} modifiers={[listRowBackground(c.paper2)]}>
          {navRow(t("profile.account.editProfile"), () => router.push("/profile/edit"))}
          {navRow(t("profile.account.changePassword"), () => router.push("/profile/password"))}
          {navRow(
            t("profile.account.notifications"),
            () => router.push("/notifications"),
            unread > 0 ? <T modifiers={[foregroundStyle(c.red)]}>{String(unread)}</T> : undefined,
          )}
        </Section>

        <Section title={t("profile.sections.settings")} modifiers={[listRowBackground(c.paper2)]}>
          {navRow(t("profile.sections.preferences"), () => router.push("/profile/preferences"))}
          {navRow(t("profile.preferences.colophon"), () => router.push("/colophon"))}
        </Section>

        {token ? (
          <Section modifiers={[listRowBackground(c.paper2)]}>
            <Button
              // @expo/ui SwiftUI ButtonRole (native), 非 ARIA role —— aria-role 规则在此为误报
              // react-doctor-disable-next-line react-doctor/aria-role
              role="destructive"
              onPress={onLogout}
              modifiers={[tint(c.red)]}
            >
              <HStack>
                <Spacer />
                <T modifiers={[foregroundStyle(c.red), bold()]}>{t("profile.logout.action")}</T>
                <Spacer />
              </HStack>
            </Button>
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}

/**
 * 自绘回退设置 (Android / Expo Go / 未 rebuild) —— 与原生路径同样两组, 维持报刊式行.
 */
function FallbackSettings({ token, onLogout }: { token: string | null; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.section}>
        <SectionHeader label={t("profile.sections.account")} />
        <RowLink label={t("profile.account.editProfile")} onPress={() => router.push("/profile/edit")} />
        <RowLink
          label={t("profile.account.changePassword")}
          onPress={() => router.push("/profile/password")}
        />
        <NotificationRow />
      </View>

      <View style={styles.section}>
        <SectionHeader label={t("profile.sections.settings")} />
        <RowLink
          label={t("profile.sections.preferences")}
          onPress={() => router.push("/profile/preferences")}
        />
        <RowLink label={t("profile.preferences.colophon")} onPress={() => router.push("/colophon")} />
      </View>

      {token ? (
        <View style={styles.section}>
          <TapEffect style={styles.dangerBtn} onPress={onLogout}>
            <Sans size={11} weight="700" style={styles.dangerLabel}>
              {t("profile.logout.action")}
            </Sans>
          </TapEffect>
        </View>
      ) : null}
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
 * NotificationRow (自绘回退) — 通知中心入口, 含未读 badge.
 * 未读 N > 0 → red diamond + Mono "N" 数字; 0 → 灰 "无";
 */
function NotificationRow() {
  const { t } = useTranslation();
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
          {total === 0 ? t("profile.account.noNotifications") : `${total}`}
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
        {t("profile.account.notifications")}
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
  // 原生路径: 报刊头钉顶 + Form 充满其下.
  nativeRoot: { flex: 1 },
  nativeHeader: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  nativeHost: { flex: 1, backgroundColor: theme.color.paper },
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

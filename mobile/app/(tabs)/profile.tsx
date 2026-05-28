import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";

import { Display, DoubleRule, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { getMe, logout, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";

/**
 * 个人资料 tab.
 *
 * 内容:
 *   · 用户邮箱 + 昵称 + 创建日期 (报刊头风格)
 *   · bio (如果有)
 *   · 行: 编辑资料 / 修改密码 / 关于 / 退出登录
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
        <ScrollView contentContainerStyle={styles.scroll}>
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
  const createdLabel = user?.created_at
    ? new Date(user.created_at).toISOString().slice(0, 10)
    : "—";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Display size={28} italic style={styles.title}>
          个人资料.
        </Display>
        <DoubleRule />

        <View style={styles.headBlock}>
          <Serif size={20} weight="semibold" style={styles.name}>
            {displayName}
          </Serif>
          <Mono size={11} style={styles.email}>
            {user?.email ?? ""}
          </Mono>
          <Mono size={9} style={styles.metaLine}>
            加入于 {createdLabel}
          </Mono>
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
          <SectionLabel>账号</SectionLabel>
          <RowLink label="编辑资料" onPress={() => router.push("/profile/edit")} />
          <RowLink label="修改密码" onPress={() => router.push("/profile/password")} />
        </View>

        <View style={styles.section}>
          <SectionLabel>其他</SectionLabel>
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

function SectionLabel({ children }: { children: string }) {
  return (
    <Sans size={10} weight="600" style={styles.sectionLabel}>
      {children}
    </Sans>
  );
}

function RowLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TapEffect style={styles.row} onPress={onPress} pressedStyle={{ backgroundColor: theme.color.paperPressed }}>
      <Serif size={14} style={styles.rowLabel}>
        {label}
      </Serif>
      <ChevronRight size={16} color={theme.color.muted2} strokeWidth={1.5} />
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
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  headBlock: {
    marginTop: theme.spacing.lg,
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
  sectionLabel: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
  },
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
});

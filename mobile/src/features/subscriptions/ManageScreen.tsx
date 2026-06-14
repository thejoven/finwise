import { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { HTTPError } from "ky";

import { Display, Icon, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { relativeTimeZh } from "@/shared/format";
import type { ResolvedAccount } from "@/core/api/subscriptions";
import {
  useResolveHandle,
  useSubscribe,
  useSubscriptions,
  useUnsubscribe,
} from "@/features/subscriptions/hooks";

/**
 * 管理订阅 (bottom modal) — 类型优先 (UX 规格 §8.3, 用户拍板的扩展预留):
 *
 *   类型选择区 (X 可用 · Telegram/新闻源 规划中灰态)
 *   → 当前类型的添加流 (输入 @handle → 解析预览卡 → 确认订阅)
 *   → 按类型分组的订阅列表 (未读数 / 最近更新 / 失效徽标 / 取消)
 *
 * 灰态卡不是死 UI — 是路线图可视化, 也倒逼 subscriptions 表 v1 起多态 (§4.2).
 */
export function ManageScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const subsQuery = useSubscriptions();
  const subs = subsQuery.data?.items ?? [];
  const limit = subsQuery.data?.limit ?? 30;

  const [handleInput, setHandleInput] = useState("");
  const [preview, setPreview] = useState<ResolvedAccount | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  const resolve = useResolveHandle();
  const subscribeMut = useSubscribe();
  const unsubscribeMut = useUnsubscribe();

  const errMessage = useCallback(async (err: unknown): Promise<string> => {
    if (err instanceof HTTPError) {
      try {
        const body = (await err.response.clone().json()) as { error?: string };
        if (body.error) return body.error;
      } catch {
        // body 不是 JSON — 落到状态码兜底
      }
      if (err.response.status === 404) return t("subscriptions.errors.notFound");
      if (err.response.status === 409) return t("subscriptions.errors.quota");
      if (err.response.status === 503) return t("subscriptions.errors.collectorUnavailable");
    }
    return t("subscriptions.errors.generic");
  }, [t]);

  const handleResolve = useCallback(() => {
    const h = handleInput.trim();
    if (!h) return;
    setFeedback(null);
    setPreview(null);
    setSubscribed(false);
    resolve.mutate(h, {
      onSuccess: (acct) => setPreview(acct),
      onError: (err) => {
        void errMessage(err).then(setFeedback);
      },
    });
  }, [handleInput, resolve, errMessage]);

  const handleSubscribe = useCallback(() => {
    if (!preview) return;
    setFeedback(null);
    subscribeMut.mutate(preview.handle, {
      onSuccess: () => {
        setSubscribed(true);
        setHandleInput("");
        setFeedback(t("subscriptions.manage.subscribed"));
      },
      onError: (err) => {
        void errMessage(err).then(setFeedback);
      },
    });
  }, [preview, subscribeMut, errMessage, t]);

  const plannedAlert = useCallback(
    (label: string) => {
      Alert.alert(
        t("subscriptions.manage.plannedTitle"),
        t("subscriptions.manage.plannedBody", { label }),
      );
    },
    [t],
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── header ── */}
          <View style={styles.headerRow}>
            <Display size={20}>{t("subscriptions.manage.title")}</Display>
            <TapEffect onPress={() => router.back()} disableEffect style={styles.closeBtn}>
              <Icon name="close" size={20} color={theme.color.ink} strokeWidth={1.75} />
            </TapEffect>
          </View>

          {/* ── 类型选择区 (多类型预留; v1 只有 X 可用) ── */}
          <Mono size={10} style={styles.sectionLabel}>
            {t("subscriptions.manage.sourceTypeLabel")}
          </Mono>
          <View style={styles.typeRow}>
            <View style={[styles.typeCard, styles.typeCardActive]}>
              <Sans size={12} weight="600" style={styles.typeName}>
                {t("subscriptions.manage.type.x")}
              </Sans>
              <Mono size={9} style={styles.typeStatus}>
                {t("subscriptions.manage.type.available")}
              </Mono>
            </View>
            <TapEffect
              onPress={() => plannedAlert(t("subscriptions.manage.type.telegram"))}
              style={[styles.typeCard, styles.typeCardPlanned]}
            >
              <Sans size={12} style={styles.typeNamePlanned}>
                {t("subscriptions.manage.type.telegram")}
              </Sans>
              <Mono size={9} style={styles.typeStatusPlanned}>
                {t("subscriptions.manage.type.planned")}
              </Mono>
            </TapEffect>
            <TapEffect
              onPress={() => plannedAlert(t("subscriptions.manage.type.rss"))}
              style={[styles.typeCard, styles.typeCardPlanned]}
            >
              <Sans size={12} style={styles.typeNamePlanned}>
                {t("subscriptions.manage.type.rss")}
              </Sans>
              <Mono size={9} style={styles.typeStatusPlanned}>
                {t("subscriptions.manage.type.planned")}
              </Mono>
            </TapEffect>
          </View>

          {/* ── 添加流 (X) ── */}
          <Mono size={10} style={styles.sectionLabel}>
            {t("subscriptions.manage.addLabel")}
          </Mono>
          <View style={styles.addRow}>
            <TextInput
              value={handleInput}
              onChangeText={setHandleInput}
              placeholder={t("subscriptions.manage.handlePlaceholder")}
              placeholderTextColor={theme.color.muted2}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={handleResolve}
              returnKeyType="search"
            />
            <TapEffect onPress={handleResolve} style={styles.resolveBtn}>
              <Sans size={12} weight="600" style={styles.resolveText}>
                {resolve.isPending
                  ? t("subscriptions.manage.resolving")
                  : t("subscriptions.manage.resolve")}
              </Sans>
            </TapEffect>
          </View>

          {feedback ? (
            <Serif size={12} italic style={subscribed ? styles.feedbackOk : styles.feedbackErr}>
              {feedback}
            </Serif>
          ) : null}

          {preview && !subscribed ? (
            <View style={styles.previewCard}>
              <View style={styles.previewHead}>
                {preview.avatar_url ? (
                  <Image source={{ uri: preview.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]} />
                )}
                <View style={styles.flex}>
                  <Sans size={13} weight="600" style={styles.name}>
                    {preview.display_name || preview.handle}
                  </Sans>
                  <Mono size={10} style={styles.handle}>
                    @{preview.handle}
                  </Mono>
                </View>
              </View>
              {preview.bio ? (
                <Serif size={12} style={styles.bio} numberOfLines={2}>
                  {preview.bio}
                </Serif>
              ) : null}
              <TapEffect onPress={handleSubscribe} style={styles.confirmBtn}>
                <Sans size={12} weight="600" style={styles.confirmText}>
                  {subscribeMut.isPending
                    ? t("subscriptions.manage.subscribing")
                    : t("subscriptions.manage.subscribe")}
                </Sans>
              </TapEffect>
            </View>
          ) : null}

          {/* ── 订阅列表 (按类型分组; v1 只有 X 组) ── */}
          {subs.length > 0 ? (
            <View>
              <Mono size={10} style={[styles.sectionLabel, styles.listLabel]}>
                {t("subscriptions.manage.listLabel", { count: subs.length })}
              </Mono>
              {subs.map((s) => (
                <View key={s.id} style={styles.subRow}>
                  {s.avatar_url ? (
                    <Image source={{ uri: s.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]} />
                  )}
                  <View style={styles.flex}>
                    <Sans size={13} weight="600" style={styles.name} numberOfLines={1}>
                      {s.display_name || s.handle}
                    </Sans>
                    <Mono size={10} style={styles.handle}>
                      @{s.handle}
                    </Mono>
                  </View>
                  <View style={styles.subMetaCol}>
                    {s.status !== "active" ? (
                      <View style={styles.deadPill}>
                        <Sans size={9} weight="600" style={styles.deadText}>
                          {t("subscriptions.manage.dead")}
                        </Sans>
                      </View>
                    ) : (
                      <Mono size={9} style={styles.subMeta}>
                        {t("subscriptions.manage.subUnread", { count: s.unread_count })}
                        {s.last_polled_at
                          ? `\n${t("subscriptions.manage.lastPolled", { time: relativeTimeZh(s.last_polled_at) })}`
                          : ""}
                      </Mono>
                    )}
                    <TapEffect
                      onPress={() => unsubscribeMut.mutate(s.id)}
                      disableEffect
                      style={styles.unsubBtn}
                    >
                      <Sans size={10} style={styles.unsubText}>
                        {t("subscriptions.manage.unsubscribe")}
                      </Sans>
                    </TapEffect>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Mono size={10} style={styles.footer}>
            {t("subscriptions.manage.footer", { count: subs.length, limit })}
          </Mono>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    padding: theme.spacing.xs,
  },
  sectionLabel: {
    color: theme.color.muted2,
    letterSpacing: 1,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  listLabel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
    paddingTop: theme.spacing.lg,
  },
  typeRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  typeCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
    gap: 2,
  },
  typeCardActive: {
    borderColor: theme.color.ink3,
    backgroundColor: theme.color.paper2,
  },
  typeCardPlanned: {
    opacity: 0.5,
  },
  typeName: {
    color: theme.color.ink,
  },
  typeNamePlanned: {
    color: theme.color.ink2,
  },
  typeStatus: {
    color: theme.color.muted,
  },
  typeStatusPlanned: {
    color: theme.color.muted2,
  },
  addRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.fontFamily.monoRegular,
    fontSize: 13,
    color: theme.color.ink,
    backgroundColor: theme.color.paper2,
  },
  resolveBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink2,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: "center",
  },
  resolveText: {
    color: theme.color.ink,
  },
  feedbackOk: {
    color: theme.color.green,
    marginTop: theme.spacing.sm,
  },
  feedbackErr: {
    color: theme.color.red,
    marginTop: theme.spacing.sm,
  },
  previewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  previewHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: theme.color.paper3,
  },
  name: {
    color: theme.color.ink,
  },
  handle: {
    color: theme.color.muted,
  },
  bio: {
    color: theme.color.muted,
  },
  confirmBtn: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
  },
  confirmText: {
    color: theme.color.paper,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  subMetaCol: {
    alignItems: "flex-end",
    gap: 4,
  },
  subMeta: {
    color: theme.color.muted2,
    textAlign: "right",
  },
  deadPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.red,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  deadText: {
    color: theme.color.red,
  },
  unsubBtn: {
    paddingVertical: 2,
  },
  unsubText: {
    color: theme.color.muted2,
    textDecorationLine: "underline",
  },
  footer: {
    color: theme.color.muted2,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },
});

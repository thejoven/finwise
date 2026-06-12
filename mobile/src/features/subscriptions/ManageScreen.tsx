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
      if (err.response.status === 404) return "没有找到这个账号";
      if (err.response.status === 409) return "先读完手头的, 再添新的。";
      if (err.response.status === 503) return "采集服务暂不可用, 稍后再试";
    }
    return "出了点问题, 再试一次";
  }, []);

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
        setFeedback("已订阅。正在回填最近的推文, 新内容会出现在你的报纸里。");
      },
      onError: (err) => {
        void errMessage(err).then(setFeedback);
      },
    });
  }, [preview, subscribeMut, errMessage]);

  const plannedAlert = useCallback((label: string) => {
    Alert.alert("在路上了", `${label}订阅还在规划中, 先把 X 账号读顺。`);
  }, []);

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
            <Display size={20}>管理订阅</Display>
            <TapEffect onPress={() => router.back()} disableEffect style={styles.closeBtn}>
              <Icon name="close" size={20} color={theme.color.ink} strokeWidth={1.75} />
            </TapEffect>
          </View>

          {/* ── 类型选择区 (多类型预留; v1 只有 X 可用) ── */}
          <Mono size={10} style={styles.sectionLabel}>
            信号源类型
          </Mono>
          <View style={styles.typeRow}>
            <View style={[styles.typeCard, styles.typeCardActive]}>
              <Sans size={12} weight="600" style={styles.typeName}>
                X 账号
              </Sans>
              <Mono size={9} style={styles.typeStatus}>
                可用
              </Mono>
            </View>
            <TapEffect
              onPress={() => plannedAlert("Telegram 频道")}
              style={[styles.typeCard, styles.typeCardPlanned]}
            >
              <Sans size={12} style={styles.typeNamePlanned}>
                Telegram 频道
              </Sans>
              <Mono size={9} style={styles.typeStatusPlanned}>
                规划中
              </Mono>
            </TapEffect>
            <TapEffect
              onPress={() => plannedAlert("新闻源 (RSS)")}
              style={[styles.typeCard, styles.typeCardPlanned]}
            >
              <Sans size={12} style={styles.typeNamePlanned}>
                新闻源
              </Sans>
              <Mono size={9} style={styles.typeStatusPlanned}>
                规划中
              </Mono>
            </TapEffect>
          </View>

          {/* ── 添加流 (X) ── */}
          <Mono size={10} style={styles.sectionLabel}>
            添加订阅 · X 账号
          </Mono>
          <View style={styles.addRow}>
            <TextInput
              value={handleInput}
              onChangeText={setHandleInput}
              placeholder="elonmusk 或 @elonmusk"
              placeholderTextColor={theme.color.muted2}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={handleResolve}
              returnKeyType="search"
            />
            <TapEffect onPress={handleResolve} style={styles.resolveBtn}>
              <Sans size={12} weight="600" style={styles.resolveText}>
                {resolve.isPending ? "解析中…" : "解析"}
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
                  {subscribeMut.isPending ? "订阅中…" : "确认订阅"}
                </Sans>
              </TapEffect>
            </View>
          ) : null}

          {/* ── 订阅列表 (按类型分组; v1 只有 X 组) ── */}
          {subs.length > 0 ? (
            <View>
              <Mono size={10} style={[styles.sectionLabel, styles.listLabel]}>
                X 账号 · {subs.length}
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
                          已失效
                        </Sans>
                      </View>
                    ) : (
                      <Mono size={9} style={styles.subMeta}>
                        未读 {s.unread_count}
                        {s.last_polled_at ? `\n${relativeTimeZh(s.last_polled_at)}更新` : ""}
                      </Mono>
                    )}
                    <TapEffect
                      onPress={() => unsubscribeMut.mutate(s.id)}
                      disableEffect
                      style={styles.unsubBtn}
                    >
                      <Sans size={10} style={styles.unsubText}>
                        取消订阅
                      </Sans>
                    </TapEffect>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Mono size={10} style={styles.footer}>
            X 账号 {subs.length} / {limit} —— 先读完手头的, 再添新的。
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

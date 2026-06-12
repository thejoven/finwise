import { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Icon, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { TweetItem } from "@/core/api/subscriptions";

import { usePromoteTweet } from "@/features/subscriptions/hooks";

/**
 * 转为信号 confirmation sheet (UX 规格 §8.5) — 订阅 → 信箱的桥.
 *
 * 信号的灵魂是*你的*「咦」, 不是别人的推:
 *   - 可选一行「用你的话说一句」→ raw_text = 你的话 + via @handle 引用
 *   - 不填 → 原文直通 (via @handle 前缀)
 *   - 幂等: 同一推文重复转返回同一 signal (duplicate=true), 按钮态变「已转 · 查看」
 */
export function PromoteSheet({
  tweet,
  visible,
  onClose,
}: {
  tweet: TweetItem;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState("");
  const promote = usePromoteTweet();
  const result = promote.data;

  const handleConfirm = useCallback(() => {
    promote.mutate({ id: tweet.id, note: note.trim() || undefined });
  }, [promote, tweet.id, note]);

  const handleGoSignal = useCallback(() => {
    if (!result) return;
    onClose();
    router.push(`/signal/${result.signal_id}`);
  }, [result, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.headRow}>
          <Sans size={15} weight="600" style={styles.title}>
            转为信号
          </Sans>
          <TapEffect onPress={onClose} disableEffect style={styles.closeBtn}>
            <Icon name="close" size={18} color={theme.color.muted} strokeWidth={1.75} />
          </TapEffect>
        </View>

        <View style={styles.quote}>
          <Mono size={10} style={styles.quoteMeta}>
            @{tweet.handle}
          </Mono>
          <Serif size={12} style={styles.quoteText} numberOfLines={4}>
            {tweet.text}
          </Serif>
        </View>

        {result ? (
          <View style={styles.done}>
            <Serif size={13} italic style={styles.doneText}>
              {result.duplicate ? "这条已经转过了。" : "已落入信箱, 与手录信号同列。"}
            </Serif>
            <TapEffect onPress={handleGoSignal} disableEffect>
              <Sans size={12} weight="600" style={styles.goLink}>
                去看信号 →
              </Sans>
            </TapEffect>
          </View>
        ) : (
          <View>
            <Sans size={12} style={styles.noteLabel}>
              用你的话说一句 (可选)
            </Sans>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="例: 利率顶部的接盘结构, 值得盯配置盘动向"
              placeholderTextColor={theme.color.muted2}
              multiline
              style={styles.input}
            />
            <Mono size={10} style={styles.hint}>
              不填则原文直通, 出处自动带上 via @{tweet.handle}
            </Mono>
            <TapEffect onPress={handleConfirm} style={styles.confirmBtn}>
              <Sans size={13} weight="600" style={styles.confirmText}>
                {promote.isPending ? "正在转…" : "确认转为信号"}
              </Sans>
            </TapEffect>
            {promote.isError ? (
              <Serif size={12} italic style={styles.err}>
                没转成功, 再试一次。
              </Serif>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: theme.color.paper,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: theme.color.ink,
  },
  closeBtn: {
    padding: theme.spacing.xs,
  },
  quote: {
    backgroundColor: theme.color.paper3,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: 4,
  },
  quoteMeta: {
    color: theme.color.muted,
  },
  quoteText: {
    color: theme.color.ink2,
  },
  noteLabel: {
    color: theme.color.ink2,
    marginBottom: theme.spacing.sm,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 64,
    textAlignVertical: "top",
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 13,
    color: theme.color.ink,
    backgroundColor: theme.color.paper2,
  },
  hint: {
    color: theme.color.muted2,
    marginTop: theme.spacing.sm,
  },
  confirmBtn: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
    marginTop: theme.spacing.md,
  },
  confirmText: {
    color: theme.color.paper,
  },
  err: {
    color: theme.color.red,
    marginTop: theme.spacing.sm,
    textAlign: "center",
  },
  done: {
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  doneText: {
    color: theme.color.ink2,
  },
  goLink: {
    color: theme.color.ink,
    textDecorationLine: "underline",
  },
});

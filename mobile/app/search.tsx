import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, X } from "lucide-react-native";

import { Display, DoubleRule, Mono, Serif, TapEffect } from "@/shared/components";
import { SignalRow, type MergedSignal } from "@/features/capture";
import { listSignals } from "@/core/api/signals";
import { readErrorMessage } from "@/core/api/account";
import { theme } from "@/core/theme";

/**
 * 搜索 modal.
 *
 * 子串搜索 — 走 GET /v1/signals?q=...
 *   - debounce 300ms 后 fire 请求, 避免每个字符都打后端
 *   - 空 query → 不发请求, 显示提示
 *   - 命中 0 条 → "没有匹配"
 *
 * 结果点击仍走 /signal/[id] 详情页 (SignalRow 已经实现).
 */
export default function SearchScreen() {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  // debounce 输入. 300ms 是手感跟服务器开销的折中.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw.trim()), 300);
    return () => clearTimeout(t);
  }, [raw]);

  const query = useQuery({
    queryKey: ["signals", "search", debounced],
    queryFn: () => listSignals({ q: debounced, limit: 30 }),
    enabled: debounced.length > 0,
  });

  const items = useMemo<MergedSignal[]>(() => {
    if (!query.data) return [];
    return query.data.signals.map((s) => ({
      id: s.id,
      raw_text: s.raw_text,
      captured_at: s.captured_at,
      inference_status: s.inference_status,
      inference_summary: s.inference_summary,
      inference_tags: s.inference_tags,
    }));
  }, [query.data]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  useEffect(() => {
    if (query.error) {
      void readErrorMessage(query.error).then(setErrorMsg);
    } else {
      setErrorMsg(null);
    }
  }, [query.error]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.topBar}>
          <TapEffect style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color={theme.color.ink} strokeWidth={1.5} />
          </TapEffect>
          <Mono size={10} style={styles.topMeta}>
            搜索 · SEARCH
          </Mono>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.header}>
          <Display size={24} italic style={styles.title}>
            搜索观察记录.
          </Display>
          <DoubleRule />
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={raw}
            onChangeText={setRaw}
            placeholder="输入关键词…"
            placeholderTextColor={theme.color.muted2}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
          />
          {raw.length > 0 ? (
            <TapEffect onPress={() => setRaw("")} style={styles.clearBtn}>
              <X size={16} color={theme.color.muted2} strokeWidth={1.5} />
            </TapEffect>
          ) : null}
        </View>

        <FlatList<MergedSignal>
          data={items}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <SignalRow signal={item} />}
          ItemSeparatorComponent={Separator}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              {debounced.length === 0 ? (
                <Serif size={13} italic style={styles.emptyText}>
                  在原文或推演摘要里搜索关键词。
                </Serif>
              ) : query.isFetching ? (
                <Serif size={13} italic style={styles.emptyText}>
                  搜索中…
                </Serif>
              ) : errorMsg ? (
                <Serif size={13} italic style={styles.emptyError}>
                  {errorMsg}
                </Serif>
              ) : (
                <Serif size={13} italic style={styles.emptyText}>
                  没有匹配 "{debounced}"。
                </Serif>
              )}
            </View>
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topMeta: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  title: { marginBottom: theme.spacing.sm },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 16,
    lineHeight: 22,
    color: theme.color.ink,
    paddingVertical: theme.spacing.xs,
  },
  clearBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginHorizontal: theme.spacing.lg,
  },
  empty: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xl },
  emptyText: { color: theme.color.muted },
  emptyError: { color: theme.color.red },
});

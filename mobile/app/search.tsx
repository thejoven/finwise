import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  KeyboardForm,
  ModalTopBar,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField } from "@/shared/native";
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
// renderItem 抽成模块级稳定引用, 避免每次重渲染重建 (rn-no-inline-flatlist-renderitem).
function renderSignalRow({ item }: { item: MergedSignal }) {
  return <SignalRow signal={item} />;
}

export default function SearchScreen() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  // debounce 输入. 300ms 是手感跟服务器开销的折中.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw.trim()), 300);
    return () => clearTimeout(t);
  }, [raw]);

  const { data, error, isFetching } = useQuery({
    queryKey: ["signals", "search", debounced],
    queryFn: () => listSignals({ q: debounced, limit: 30 }),
    enabled: debounced.length > 0,
  });

  const items = useMemo<MergedSignal[]>(() => {
    if (!data) return [];
    return data.signals.map((s) => ({
      id: s.id,
      raw_text: s.raw_text,
      captured_at: s.captured_at,
      inference_status: s.inference_status,
      inference_summary: s.inference_summary,
      inference_tags: s.inference_tags,
    }));
  }, [data]);

  // errorMsg 是从 error **异步**解析出的可读文案 (readErrorMessage 读 response body),
  // 无法在渲染期同步派生, 故用 effect 跟 error —— no-chain-state-updates 在此为误报.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  useEffect(() => {
    if (error) {
      void readErrorMessage(error).then(setErrorMsg);
    } else {
      // react-doctor-disable-next-line react-doctor/no-chain-state-updates
      setErrorMsg(null);
    }
  }, [error]);

  return (
    <KeyboardForm>
      <ModalTopBar label={t("profile.search.topBar")} />

      <View style={styles.header}>
        <Display size={24} italic style={styles.title}>
          {t("profile.search.title")}
        </Display>
        <DoubleRule />
      </View>

      <View style={styles.searchRow}>
        <NativeField
          value={raw}
          onChangeText={setRaw}
          placeholder={t("profile.search.placeholder")}
          autoFocus
          returnKeyType="search"
          bare
          containerStyle={styles.inputWrap}
          inputStyle={styles.input}
        />
        {raw.length > 0 ? (
          <TapEffect onPress={() => setRaw("")} style={styles.clearBtn}>
            <Icon name="close" size={16} color={theme.color.muted2} strokeWidth={1.5} />
          </TapEffect>
        ) : null}
      </View>

      <FlatList<MergedSignal>
        data={items}
        keyExtractor={(s) => s.id}
        renderItem={renderSignalRow}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            {debounced.length === 0 ? (
              <Serif size={13} italic style={styles.emptyText}>
                {t("profile.search.hint")}
              </Serif>
            ) : isFetching ? (
              <Serif size={13} italic style={styles.emptyText}>
                {t("profile.search.searching")}
              </Serif>
            ) : errorMsg ? (
              <Serif size={13} italic style={styles.emptyError}>
                {errorMsg}
              </Serif>
            ) : (
              <Serif size={13} italic style={styles.emptyText}>
                {t("profile.search.noMatch", { query: debounced })}
              </Serif>
            )}
          </View>
        }
      />
    </KeyboardForm>
  );
}

const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
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
  inputWrap: { flex: 1 },
  input: {
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

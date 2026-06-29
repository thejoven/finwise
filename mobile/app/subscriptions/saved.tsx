import { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { ModalTopBar, Sans, Serif, TAB_BAR_CLEARANCE, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { TweetItem } from "@/core/api/subscriptions";
import { TweetRow } from "@/features/subscriptions/TweetRow";
import { useSavedTweets, useUnsaveTweet } from "@/features/subscriptions/hooks";

/**
 * 稍后读 · 二级页面 (订阅刊头「稍后读」进入) —— 上滑存下的推文列表, 复用 TweetRow,
 * 每条带「移出」取消稍后读. 它们已是已读态, 点进详情照常.
 */
export default function SavedScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const saved = useSavedTweets();
  const { mutate: unsave } = useUnsaveTweet();
  const tweets = useMemo(() => (saved.data?.pages ?? []).flatMap((p) => p.items), [saved.data]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ModalTopBar label={t("subscriptions.saved.topBar")} />
      <FlatList<TweetItem>
        data={tweets}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <TweetRow tweet={item} />
            <TapEffect onPress={() => unsave(item.id)} disableEffect style={styles.unsave}>
              <Sans size={11} weight="600" style={styles.unsaveText}>
                {t("subscriptions.saved.remove")}
              </Sans>
            </TapEffect>
          </View>
        )}
        ItemSeparatorComponent={Separator}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (saved.hasNextPage && !saved.isFetchingNextPage) void saved.fetchNextPage();
        }}
        ListEmptyComponent={
          saved.isError ? (
            <View style={styles.empty}>
              <TapEffect onPress={() => void saved.refetch()} disableEffect>
                <Serif size={13} italic style={styles.emptyText}>
                  {t("subscriptions.errors.generic")}
                </Serif>
              </TapEffect>
            </View>
          ) : (
            <View style={styles.empty}>
              <Serif size={13} italic style={styles.emptyText}>
                {saved.isLoading ? t("subscriptions.empty.loading") : t("subscriptions.saved.empty")}
              </Serif>
            </View>
          )
        }
        contentContainerStyle={[
          tweets.length === 0 ? styles.flexScroll : undefined,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
        ]}
      />
    </SafeAreaView>
  );
}

const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  item: {
    paddingBottom: theme.spacing.sm,
  },
  unsave: {
    alignSelf: "flex-end",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 4,
  },
  unsaveText: { color: theme.color.muted },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginHorizontal: theme.spacing.lg,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xxxl,
  },
  emptyText: { color: theme.color.muted, textAlign: "center", lineHeight: 21 },
  flexScroll: { flexGrow: 1, justifyContent: "center" },
});

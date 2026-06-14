import { useMemo } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Icon, Sans, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { monthDayLabel, weekdayLabel } from "@/shared/format";

/**
 * 财知页固定报头 (不折叠版).
 *
 * 视觉与 CollapsibleMasthead 的"折叠态"一脉相承 —— 顶条 (左 book → 卷首语, 中日期,
 * 右 ＋ → 记录) + 常驻刊名「财知」. 区别: 这里**始终固定**, 不随滚动折叠 (滚动折叠交给各子页
 * 自己的列表, host 的报头/分段栏常驻). 装饰性副线 (WiseFlow / slogan) 略去, 给三页腾出高度.
 *
 * 作为 PagerView 的兄弟节点常驻在顶部, 故无需 absolute 浮层 + paddingTop 让位 —— 直接
 * 占流式高度, 下方紧接吸顶分段栏 (SegmentedTabs).
 *
 * @see CollapsibleMasthead
 */
export function CaizhiHeader() {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const date = monthDayLabel(today);
  const weekday = weekdayLabel(today);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TapEffect
          onPress={() => router.push("/colophon")}
          style={styles.iconButton}
          accessibilityLabel={t("caizhi.header.colophon")}
        >
          <Icon name="book" size={18} color={theme.color.ink} strokeWidth={1.5} />
        </TapEffect>
        <Sans size={9} weight="600" style={styles.topStrip}>
          {date} · {weekday}
        </Sans>
        <TapEffect
          onPress={() => router.push("/capture")}
          style={styles.iconButton}
          accessibilityLabel={t("caizhi.header.capture")}
        >
          <Icon name="plus" size={20} color={theme.color.ink} strokeWidth={1.75} />
        </TapEffect>
      </View>

      <View style={styles.nameplateRow}>
        <RNText allowFontScaling={false} style={styles.nameplate}>
          {t("caizhi.nameplate")}
        </RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: theme.color.paper,
    paddingHorizontal: theme.spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 36,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  topStrip: {
    flex: 1,
    letterSpacing: 1,
    color: theme.color.muted,
    textAlign: "center",
  },
  nameplateRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  nameplate: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 22,
    lineHeight: 28,
    color: theme.color.ink,
    letterSpacing: 3,
    paddingLeft: 3, // 抵消尾部 letterSpacing 让视觉居中
  },
});

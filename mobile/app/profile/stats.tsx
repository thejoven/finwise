import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { ModalTopBar } from "@/shared/components";
import { theme } from "@/core/theme";
import { ProfileStatsView } from "@/features/profile";

/**
 * 数据统计 · 二级页 (从「我」→「数据统计」进入).
 * 指标卡 + GitHub 式年度活跃点阵图. 整页自绘编辑面 (bespoke editorial), 不走原生 Form.
 */
export default function ProfileStatsScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ModalTopBar label={t("profile.stats.topBar")} />
      <ProfileStatsView />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
});

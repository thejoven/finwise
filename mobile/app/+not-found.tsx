import { Link, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Display, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t("components.notFound.navTitle") }} />
      <View style={styles.container}>
        <Display size={28} italic>
          {t("components.notFound.title")}
        </Display>
        <Serif size={14} italic style={styles.note}>
          {t("components.notFound.note")}
        </Serif>
        <Link href="/(tabs)/caizhi" style={styles.link}>
          <Serif size={13}>{t("components.notFound.backToInbox")}</Serif>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
    backgroundColor: theme.color.paper,
    gap: theme.spacing.lg,
  },
  note: {
    color: theme.color.muted,
    textAlign: "center",
  },
  link: {
    marginTop: theme.spacing.lg,
  },
});

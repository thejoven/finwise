import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";

import { theme } from "@/core/theme";
import { resolveApiUrl } from "@/core/api/client";

import { Display } from "./Text";

/**
 * Avatar — 圆形头像. 有 `uri` (后端现签的 avatar_url) → 圆形图; 否则回退首字母字母章 (圆形版).
 *
 * 签名 URL 自证, 故 <Image> 无需附 Authorization 头 (这也是原生 SwiftUI / web <img> 能直接渲染的前提).
 * uri 变化 (exp/v 变) 即换缓存键, 头像更新后自动刷新. 取代旧的方形字母章, 见 profile / edit.
 */
export type AvatarProps = {
  /** 后端现签的相对或绝对 avatar_url; 空 → 显示首字母. */
  uri?: string | null;
  /** 取首字母用的名字 (昵称或邮箱). */
  name?: string | null;
  /** 直径, 默认 56. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ uri, name, size = 56, style }: AvatarProps) {
  const radius = size / 2;
  const dims = { width: size, height: size, borderRadius: radius };
  const resolved = uri ? resolveApiUrl(uri) : null;
  const initial = (name ?? "").trim().charAt(0).toUpperCase() || "—";

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={[styles.image, dims, style] as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.fallback, dims, style]}>
      <Display size={Math.round(size * 0.46)} style={styles.initial}>
        {initial}
      </Display>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: theme.color.paper3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ruleSoft,
  },
  fallback: {
    backgroundColor: theme.color.paper3,
    borderWidth: 1.5,
    borderColor: theme.color.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: theme.color.ink },
});

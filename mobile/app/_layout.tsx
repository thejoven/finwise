import { useEffect, useState } from "react";
import { AppState, type AppStateStatus, Platform, useColorScheme } from "react-native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PendingFlush, usePendingSignals } from "@/features/capture";
import { SplashCover } from "@/features/splash";
import { useAuth } from "@/core/auth/store";
import { useBilling } from "@/core/billing";
import { useNotifications } from "@/features/notifications";
import { useActiveProject } from "@/features/project/store";
import { useFavoriteAssets, useHiddenAssets } from "@/features/track";
import { useAppearance } from "@/core/theme/store";
import { useLanguage } from "@/core/i18n";
import { resolveColors } from "@/core/theme";
import { ToastRoot } from "@/shared/toast";
import {
  bottomModalScreen,
  loginScreen,
  pushDetailScreen,
  registerScreen,
  rootStackScreenOptions,
  tabsRootScreen,
} from "@/core/navigation";

// Block native splash hide until fonts load — prevents fallback-flash on cold start.
void SplashScreen.preventAutoHideAsync();

// 显式声明 root stack 默认 route — 防止 Expo Router 选错首屏 (例: modal capture
// 被选成 initial 时, 用户看到的就是黑屏/空白).
// Expo Router 要求路由配置 (unstable_settings) 从路由文件本身导出, 无法外移 —— 故此处
// 的 only-export-components (Fast Refresh) 与框架约定冲突, 属有意为之.
// react-doctor-disable-next-line react-doctor/only-export-components
export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// 让 TanStack Query 把 RN 的 AppState 当作"focus"事件: 回前台时 refetch active queries.
// 默认 RN 不像 web 有 window.focus, 必须手动接.
focusManager.setEventListener((handleFocus) => {
  const onChange = (status: AppStateStatus) => {
    if (Platform.OS !== "web") handleFocus(status === "active");
  };
  const sub = AppState.addEventListener("change", onChange);
  return () => sub.remove();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    },
  },
});

const FONTS = {
  // Playfair Display: 仅 AlphaX 品牌字 / 报头副线 (`<Display serif>`) 在用. 英文正文/标题
  // 已改系统字体 (SF Pro / Roboto), 故不再 bundle Source Serif 4.
  "PlayfairDisplay-Regular": require("../assets/fonts/PlayfairDisplay-Regular.ttf"),
  "PlayfairDisplay-Italic": require("../assets/fonts/PlayfairDisplay-Italic.ttf"),
  "PlayfairDisplay-Bold": require("../assets/fonts/PlayfairDisplay-Bold.ttf"),
  "PlayfairDisplay-BoldItalic": require("../assets/fonts/PlayfairDisplay-BoldItalic.ttf"),
  "NotoSerifSC-Regular": require("../assets/fonts/NotoSerifSC-Regular.ttf"),
  "NotoSerifSC-Bold": require("../assets/fonts/NotoSerifSC-Bold.ttf"),
  "JetBrainsMono-Regular": require("../assets/fonts/JetBrainsMono-Regular.ttf"),
  "JetBrainsMono-Medium": require("../assets/fonts/JetBrainsMono-Medium.ttf"),
};

export default function RootLayout() {
  const hydratePending = usePendingSignals((s) => s.hydrate);
  const hydrateAuth = useAuth((s) => s.hydrate);
  const hydrateNotifications = useNotifications((s) => s.hydrate);
  const hydrateActiveProject = useActiveProject((s) => s.hydrate);
  const hydrateFavorites = useFavoriteAssets((s) => s.hydrate);
  const hydrateHidden = useHiddenAssets((s) => s.hydrate);
  const hydrateAppearance = useAppearance((s) => s.hydrate);
  const hydrateLanguage = useLanguage((s) => s.hydrate);
  const [storageReady, setStorageReady] = useState(false);
  // JS splash 是否还在演动画. 字体/hydrate 完成后, 我们把 native splash 收掉,
  // 由本 JS splash 接管, 演完动画再卸载, 把下层 Stack 露出来.
  const [splashAnimating, setSplashAnimating] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      hydratePending().catch((err) => {
        console.warn("[storage] pending hydrate failed:", err);
      }),
      hydrateAuth().catch((err) => {
        console.warn("[auth] hydrate failed:", err);
      }),
      hydrateNotifications().catch((err) => {
        console.warn("[notifications] hydrate failed:", err);
      }),
      hydrateActiveProject().catch((err) => {
        console.warn("[activeProject] hydrate failed:", err);
      }),
      hydrateFavorites().catch((err) => {
        console.warn("[favoriteAssets] hydrate failed:", err);
      }),
      hydrateHidden().catch((err) => {
        console.warn("[hiddenAssets] hydrate failed:", err);
      }),
      hydrateAppearance().catch((err) => {
        console.warn("[appearance] hydrate failed:", err);
      }),
      hydrateLanguage().catch((err) => {
        console.warn("[language] hydrate failed:", err);
      }),
    ]).finally(() => {
      if (mounted) setStorageReady(true);
      // billing 不阻塞首屏: auth 此刻已 hydrate, init 能拿到正确 user id 当 RevenueCat
      // appUserID. 没配 RevenueCat key 时内部直接降级, 不报错.
      void useBilling.getState().init();
    });
    return () => {
      mounted = false;
    };
  }, [
    hydratePending,
    hydrateAuth,
    hydrateNotifications,
    hydrateActiveProject,
    hydrateFavorites,
    hydrateHidden,
    hydrateAppearance,
    hydrateLanguage,
  ]);

  const [loaded] = useFonts(FONTS);

  // 等字体 + 存储都就绪 (异步加载完成) 再收原生 splash —— 对异步就绪的响应, 无用户事件触发,
  // 故 no-event-handler 在此为误报.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (loaded && storageReady) {
      // 注意: 这里只是把 native splash 收掉, JS 自己的 <SplashCover> 仍在上层渲染.
      void SplashScreen.hideAsync();
    }
  }, [loaded, storageReady]);

  // 根窗口背景跟随外观 — 否则暗色下 modal/回弹露出的原生底色会是白的.
  // useColorScheme 反映 Appearance.setColorScheme 的 override, 切换时本组件重渲染、bg 更新.
  const scheme = useColorScheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(resolveColors(scheme).paper);
  }, [scheme]);

  if (!loaded || !storageReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <PendingFlush />
          <Stack screenOptions={rootStackScreenOptions}>
            <Stack.Screen name="(tabs)" options={tabsRootScreen} />
            <Stack.Screen name="login" options={loginScreen} />
            <Stack.Screen name="register" options={registerScreen} />
            <Stack.Screen name="capture" options={bottomModalScreen} />
            <Stack.Screen name="profile/edit" options={bottomModalScreen} />
            <Stack.Screen name="profile/password" options={bottomModalScreen} />
            <Stack.Screen name="profile/preferences" options={pushDetailScreen} />
            <Stack.Screen name="profile/content-prefs" options={pushDetailScreen} />
            <Stack.Screen name="profile/stats" options={pushDetailScreen} />
            <Stack.Screen name="search" options={bottomModalScreen} />
            <Stack.Screen name="subscriptions/manage" options={bottomModalScreen} />
            <Stack.Screen name="subscriptions/saved" options={pushDetailScreen} />
            <Stack.Screen name="projects/archived" options={pushDetailScreen} />
            <Stack.Screen name="signal/[id]" options={pushDetailScreen} />
            <Stack.Screen name="tweet/[id]" options={pushDetailScreen} />
            <Stack.Screen name="refinement/[sessionId]" options={pushDetailScreen} />
            <Stack.Screen name="archive/chat/[id]" options={pushDetailScreen} />
            <Stack.Screen name="commitment/[id]" options={pushDetailScreen} />
            <Stack.Screen name="asset/[id]" options={pushDetailScreen} />
            <Stack.Screen name="retrospect/[id]" options={pushDetailScreen} />
            <Stack.Screen name="colophon" options={pushDetailScreen} />
            <Stack.Screen name="notifications" options={pushDetailScreen} />
          </Stack>
          {splashAnimating && <SplashCover onFinish={() => setSplashAnimating(false)} />}
          {/* Toast 必须挂在 stack 之外, 确保盖在所有 screen 上面 */}
          <ToastRoot />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

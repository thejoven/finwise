/**
 * 分析师对话页 — 归档卡片点进来, 与否决这条评估的分析师继续聊.
 *
 * 结构 (一条垂直长滚动):
 *   顶部 header: 返回 + 分析师署名 stamp
 *   信号上下文模块 (点击 → 信号详情)
 *   开场白 = 归档时的否决理由 (分析师气泡) + 池去向一句
 *   历史消息: 分析师靠左 (纸面 + 左 ink 竖条), 用户靠右 (ink 块反白)
 *   发送中: 乐观显示用户气泡 + 分析师"正在想" 三点 pulse
 *   底部 composer: 多行输入 + 方形发送钮
 *
 * 语义边界 (产品哲学): 对话**不改判** — 评估是不可变快照. 分析师解释为什么拦 /
 * 什么会让他改判; 用户有新证据该录新信号再走流程. 等待用 pulse 不用 spinner,
 * 失败不弹 toast — 文字内联说明, 输入原样退还.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Icon, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { analystByGate, analystName, analystRole, gateVerdictText } from "@/core/api/gate";
import {
  useGateChat,
  useGateEvaluation,
  useSendGateChat,
  type GateChatMessage,
} from "@/features/archive/hooks";

export default function AnalystChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { data: evaluation, isError: evalError } = useGateEvaluation(id);
  const chatQuery = useGateChat(id);
  const { send, isSending, sendError } = useSendGateChat(id);

  const [draft, setDraft] = useState("");
  // 发送中乐观显示的用户消息 (server 成功才落库; 失败退还输入框)
  const [pendingText, setPendingText] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const didFirstScroll = useRef(false);

  const analyst = analystByGate(evaluation?.failed_gate);
  const analystDisplayName = analystName(analyst);
  const analystDisplayRole = analystRole(analyst);
  const messages = chatQuery.data ?? [];

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending || !id) return;
    setPendingText(text);
    setDraft("");
    try {
      await send(text);
      setPendingText(null);
    } catch {
      // 不弹 toast: 内联提示 + 把话原样放回输入框
      setDraft(text);
      setPendingText(null);
    }
  }, [draft, isSending, id, send]);

  // 内容变高 (新消息 / 键盘弹起重排) → 贴到底, 像所有对话界面一样
  const handleContentSizeChange = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: didFirstScroll.current });
    didFirstScroll.current = true;
  }, []);

  const canSend = !!draft.trim() && !isSending;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header name={analystDisplayName} role={analystDisplayRole} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={handleContentSizeChange}
        >
          {evalError ? (
            <Serif size={13} italic style={styles.error}>
              {t("archive.chat.evalError")}
            </Serif>
          ) : !evaluation ? (
            <Serif size={12} italic style={styles.muted}>
              ...
            </Serif>
          ) : (
            <>
              <SignalModule evaluation={evaluation} />

              {/* 开场白: 归档时分析师的否决理由, 永远是对话的第一句 */}
              <AnalystBubble name={analystDisplayName} first>
                <Serif size={14} style={styles.bubbleText}>
                  {gateVerdictText(evaluation)}
                </Serif>
                <Directions evaluation={evaluation} />
                {evaluation.archived_pool ? (
                  <Serif size={12} italic style={styles.poolNote}>
                    {t(`archive.chat.poolNote.${evaluation.archived_pool}`)}
                  </Serif>
                ) : null}
              </AnalystBubble>

              {messages.map((m) => (
                <MessageRow key={m.id} message={m} analystName={analystDisplayName} />
              ))}

              {pendingText ? <UserBubble content={pendingText} /> : null}
              {isSending ? <ThinkingBubble name={analystDisplayName} /> : null}

              {sendError && !isSending ? (
                <Serif size={12} italic style={styles.sendError}>
                  {t("archive.chat.sendError")}
                </Serif>
              ) : null}

              <Serif size={11} italic style={styles.disclaimer}>
                {t("archive.chat.disclaimer")}
              </Serif>
            </>
          )}
        </ScrollView>

        {/* composer */}
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("archive.chat.placeholder")}
            placeholderTextColor={theme.color.muted2}
            multiline
            maxLength={1000}
            editable={!isSending}
          />
          <TapEffect
            style={[styles.sendButton, !canSend && styles.sendButtonDim]}
            pressedStyle={canSend ? { backgroundColor: theme.color.ink2 } : undefined}
            onPress={canSend ? () => void handleSend() : undefined}
            disabled={!canSend}
          >
            <Icon name="arrowUp" size={16} color={theme.color.paper} strokeWidth={2} />
          </TapEffect>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ───── 页面块 ─────

function Header({ name, role }: { name: string; role: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>{t("archive.chat.back")}</Serif>
      </TapEffect>
      <View style={styles.headerCenter}>
        <Sans size={9} weight="600" style={styles.headerStamp}>
          {name}
        </Sans>
        {role ? (
          <Mono size={9} style={styles.headerRole}>
            {role}
          </Mono>
        ) : null}
      </View>
      <View style={styles.headerSpacer} />
    </View>
  );
}

/** 信号上下文模块 — 这场对话围绕哪条信号. 点击 → 信号详情. */
function SignalModule({
  evaluation,
}: {
  evaluation: NonNullable<ReturnType<typeof useGateEvaluation>["data"]>;
}) {
  const { t } = useTranslation();
  const sig = evaluation.signal;
  const date = evaluation.evaluated_at.slice(0, 10).replace(/-/g, "·");
  const dateStamp = `${date} · ${t("archive.chat.archivedStamp")}`;
  if (!sig) {
    return (
      <View style={styles.signalModule}>
        <Mono size={9} style={styles.signalDate}>
          {dateStamp}
        </Mono>
      </View>
    );
  }
  return (
    <TapEffect
      style={styles.signalModule}
      pressedStyle={{ backgroundColor: theme.color.paper3 }}
      onPress={() => router.push(`/signal/${sig.id}`)}
    >
      <View style={styles.signalHead}>
        <Mono size={9} style={styles.signalDate}>
          {dateStamp}
        </Mono>
        <Icon name="arrowUpRight" size={11} color={theme.color.muted} strokeWidth={1.5} />
      </View>
      {sig.asset ? (
        <Mono size={12} style={styles.signalAsset}>
          {sig.asset}
        </Mono>
      ) : null}
      {sig.summary ? (
        <Serif size={12} numberOfLines={2} style={styles.signalSummary}>
          {sig.summary}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

function MessageRow({ message, analystName }: { message: GateChatMessage; analystName: string }) {
  if (message.role === "user") return <UserBubble content={message.content} />;
  return (
    <AnalystBubble name={analystName}>
      <Serif size={14} style={styles.bubbleText}>
        {message.content}
      </Serif>
    </AnalystBubble>
  );
}

function AnalystBubble({
  name,
  first,
  children,
}: {
  name: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.analystBlock}>
      <View style={styles.analystSign}>
        <View style={styles.seal}>
          <Sans size={10} weight="700" style={styles.sealText}>
            {name.slice(0, 1)}
          </Sans>
        </View>
        <Sans size={11} weight="600" style={styles.analystName}>
          {name}
        </Sans>
        {first ? (
          <Mono size={9} style={styles.firstStamp}>
            {t("archive.chat.firstStamp")}
          </Mono>
        ) : null}
      </View>
      <View style={styles.analystBubble}>{children}</View>
    </View>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <View style={styles.userBlock}>
      <View style={styles.userBubble}>
        <Serif size={14} style={styles.userText}>
          {content}
        </Serif>
      </View>
    </View>
  );
}

/** 分析师"正在想" — 三点顺序 pulse (项目约束: 不用 ActivityIndicator). */
function ThinkingBubble({ name }: { name: string }) {
  return (
    <View style={styles.analystBlock}>
      <View style={styles.analystSign}>
        <View style={styles.seal}>
          <Sans size={10} weight="700" style={styles.sealText}>
            {name.slice(0, 1)}
          </Sans>
        </View>
        <Sans size={11} weight="600" style={styles.analystName}>
          {name}
        </Sans>
      </View>
      <View style={[styles.analystBubble, styles.thinkingBubble]}>
        <PulsingDot delay={0} />
        <PulsingDot delay={180} />
        <PulsingDot delay={360} />
      </View>
    </View>
  );
}

function PulsingDot({ delay }: { delay: number }) {
  const opacity = useSharedValue(0.25);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.25, { duration: 420, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [delay, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

function Directions({
  evaluation,
}: {
  evaluation: NonNullable<ReturnType<typeof useGateEvaluation>["data"]>;
}) {
  const { t } = useTranslation();
  const directions = evaluation.gates.g2_anti_consensus.unpriced_directions ?? [];
  if (evaluation.failed_gate !== 2 || directions.length === 0) return null;
  return (
    <View style={styles.directions}>
      <Mono size={9} style={styles.directionsLabel}>
        {t("archive.chat.unpricedDirections")}
      </Mono>
      {directions.map((d) => (
        <View key={d.angle} style={styles.directionItem}>
          <Sans size={12} weight="600" style={styles.directionAngle}>
            {d.angle}
          </Sans>
          <Serif size={12} italic style={styles.directionWhy}>
            {d.why_unpriced}
          </Serif>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 64,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerStamp: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.ink,
  },
  headerRole: { color: theme.color.muted2, marginTop: 2, letterSpacing: 1 },
  headerSpacer: { minWidth: 64 },

  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  muted: { color: theme.color.muted },
  error: { color: theme.color.red },

  // 信号上下文模块
  signalModule: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: 4,
  },
  signalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  signalDate: { color: theme.color.muted, letterSpacing: 1 },
  signalAsset: { color: theme.color.ink, letterSpacing: 0.5 },
  signalSummary: { color: theme.color.muted, lineHeight: 18 },

  // 分析师气泡 (靠左)
  analystBlock: { gap: theme.spacing.xs, paddingRight: theme.spacing.xl },
  analystSign: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  seal: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.ink,
  },
  sealText: { color: theme.color.paper },
  analystName: { color: theme.color.ink },
  firstStamp: { color: theme.color.red, letterSpacing: 1.5 },
  analystBubble: {
    backgroundColor: theme.color.paper2,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  bubbleText: { color: theme.color.ink2, lineHeight: 22 },
  poolNote: { color: theme.color.muted, lineHeight: 18 },

  // 用户气泡 (靠右, ink 反白)
  userBlock: { alignItems: "flex-end", paddingLeft: theme.spacing.xl },
  userBubble: {
    backgroundColor: theme.color.ink,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    maxWidth: "100%",
  },
  userText: { color: theme.color.paper, lineHeight: 22 },

  // thinking
  thinkingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: theme.spacing.md,
  },
  dot: {
    width: 4,
    height: 4,
    backgroundColor: theme.color.ink,
  },

  sendError: { color: theme.color.red, lineHeight: 18 },
  disclaimer: { color: theme.color.muted2, lineHeight: 16, marginTop: theme.spacing.xs },

  // 未被定价的方向 (开场白内, g2 专属)
  directions: { gap: theme.spacing.xs },
  directionsLabel: { color: theme.color.muted, letterSpacing: 1.5 },
  directionItem: { gap: 1 },
  directionAngle: { color: theme.color.ink },
  directionWhy: { color: theme.color.muted, lineHeight: 17 },

  // composer
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
    backgroundColor: theme.color.paper,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 15,
    lineHeight: 21,
    color: theme.color.ink,
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.ink,
  },
  sendButtonDim: { backgroundColor: theme.color.muted2 },
});

/**
 * useVoiceInput — 录入页语音输入的状态机.
 *
 * 录音 (expo-audio) → 停止 → 上传转写 (Go 代理 → 自托管 GLM-ASR) → 把文本交回调用方
 * 回填到文本框. 转写只是"填字", 用户校对后才提交 (录入链路不变).
 *
 * 为什么异步 + 可取消 + 时长上限:
 *   服务器无 GPU, CPU 转写约 3× 音频时长 (5s→~15s, 30s→~55s). 故 UI 必须有明确"识别中"
 *   等待态且可取消; 录音封顶 30s 兜底最坏延迟.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

import { transcribeAudio } from "@/core/api/signals";

export type VoiceStatus = "idle" | "recording" | "transcribing";

/** 录音时长上限 (ms). 到点自动停并转写, 约束 CPU 端最坏延迟. */
const MAX_RECORD_MS = 30_000;

export interface VoiceInput {
  status: VoiceStatus;
  /** 错误 i18n key 后缀 ("permissionDenied" | "failed"); 调用方拼到 capture.voice.*. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
}

export function useVoiceInput(onResult: (text: string) => void): VoiceInput {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // ref 持最新回调, 避免 finish 闭包过期 / 依赖抖动.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const cancelled = useRef(false);
  const busy = useRef(false); // 防重入: 自动停与手动停可能竞争.
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoStop = useCallback(() => {
    if (autoStop.current) {
      clearTimeout(autoStop.current);
      autoStop.current = null;
    }
  }, []);

  // 卸载清理: 停 timer + 停录音 (modal 关闭时别留着麦克风).
  useEffect(
    () => () => {
      if (autoStop.current) clearTimeout(autoStop.current);
      recorder.stop().catch(() => {});
    },
    [recorder],
  );

  const finish = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    clearAutoStop();
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri ?? null;
    } catch {
      // 停录音失败按无音频处理.
    }
    if (cancelled.current || !uri) {
      setStatus("idle");
      busy.current = false;
      return;
    }
    setStatus("transcribing");
    try {
      const { text } = await transcribeAudio(uri);
      if (!cancelled.current) {
        const trimmed = text.trim();
        if (trimmed) onResultRef.current(trimmed);
        else setError("failed"); // 识别到空 (没听清)
      }
    } catch {
      if (!cancelled.current) setError("failed");
    } finally {
      setStatus("idle");
      busy.current = false;
    }
  }, [recorder, clearAutoStop]);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    cancelled.current = false;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("permissionDenied");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus("recording");
      clearAutoStop();
      autoStop.current = setTimeout(() => {
        void finish();
      }, MAX_RECORD_MS);
    } catch {
      setError("failed");
      setStatus("idle");
    }
  }, [status, recorder, finish, clearAutoStop]);

  const stop = useCallback(async () => {
    if (status === "recording") await finish();
  }, [status, finish]);

  const cancel = useCallback(async () => {
    cancelled.current = true;
    clearAutoStop();
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
    setStatus("idle");
  }, [recorder, clearAutoStop]);

  const clearError = useCallback(() => setError(null), []);

  return { status, error, start, stop, cancel, clearError };
}

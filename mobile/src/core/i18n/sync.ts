/**
 * 把当前语言推给服务端 —— 让后台 AI 生成(五轮追问 / 降噪 / 投决会 / 订阅总结)
 * 与 UI 用同一门语言. 这些生成有的没有实时请求携带语言(队列/预计算), 故以用户档案上
 * 的 language 为准, 服务端各处 Mastra 调用统一读取.
 *
 * best-effort: UI 早已切好, 这里失败不影响用户; 下次启动或再切时会重试.
 */
import { updateLanguage } from "@/core/api/account";
import { getStoredToken } from "@/core/auth/store";
import { getDevBearer } from "@/core/auth/devBearer";

import type { SupportedLanguage } from "./languages";

let lastPushed: SupportedLanguage | null = null;

export async function pushLanguageToServer(lang: SupportedLanguage): Promise<void> {
  if (lang === lastPushed) return;
  // 未登录(也没开 dev bearer)就别打 —— 省得无谓 401.
  if (!getStoredToken() && !getDevBearer()) return;
  try {
    await updateLanguage(lang);
    lastPushed = lang;
  } catch {
    // 吞掉: 服务端记录失败不影响 UI, 下次再同步.
  }
}

/** 登出时重置, 让下个账号能重新推一次. */
export function resetLanguageSync(): void {
  lastPushed = null;
}

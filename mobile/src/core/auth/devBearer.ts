/**
 * Dev auto-login escape hatch (默认关闭).
 *
 * 默认行为: 没登录 → 跳 /login, API 请求不附带任何 token.
 * 要恢复"启动直接进 dev 账号"的单用户调试模式, 在 .env 里两者都给齐:
 *   EXPO_PUBLIC_DEV_AUTOLOGIN=1
 *   EXPO_PUBLIC_DEV_BEARER_TOKEN=<server 的 DEV_BEARER_TOKEN>
 * 缺任意一个都不生效 (flag 必须显式打开, 且 token 非空).
 *
 * 注意: EXPO_PUBLIC_* 在构建期被 inline 进 bundle, 改完 .env 要重启 Metro
 * (`expo start -c`) 或重新 build dev client 才会生效.
 */

function flagOn(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const autoLoginEnabled = flagOn(process.env.EXPO_PUBLIC_DEV_AUTOLOGIN);
const bearer = (process.env.EXPO_PUBLIC_DEV_BEARER_TOKEN ?? "").trim();

/**
 * 仅当 dev autologin 被显式打开且配了 token 时返回它, 否则 null.
 * auth gate 用它决定是否放行, client.ts 用它决定是否给请求附 Authorization.
 */
export function getDevBearer(): string | null {
  return autoLoginEnabled && bearer ? bearer : null;
}

/**
 * 极简 UUID v4 — 用 Math.random.
 *
 * 不是 crypto-secure, 但这里只用作 client_event_id (幂等键).
 * 服务端把它当不透明字符串, 重复就 dedupe, 不重复就接收.
 *
 * 为什么不用 `uuid` 包:
 *   - uuid@11 的 RN 路径会 require Web Crypto (crypto.getRandomValues),
 *     RN 0.81 / Hermes 没有原生提供, 需要 react-native-get-random-values
 *     polyfill. 当前没装那个 polyfill, 直接 import 会运行时崩.
 *   - 这里只需要 36 字符的稳定 ID, Math.random 完全够用.
 */
export function uuidV4(): string {
  // 16 个随机字节; 调整 byte 6 和 byte 8 为符合 v4 spec.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  }
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

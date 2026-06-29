# 字体 bundle

bundle 3 个字族, 共 8 个文件. **英文正文/标题用系统字体 SF Pro / Roboto, 不 bundle**
(2026-06-28 起 —— 原 Source Serif 4 已退役, 见 `src/shared/components/Text.tsx`).
**Sans 一直就不 bundle**.

Playfair Display 仍保留: 仅 **AlphaX 品牌字 / 报头副线** (`<Display serif>`) 在用.

## 必备文件 (8 个)

跑 `bash scripts/fetch-fonts.sh` 一键下完. 走 gwfh.mranftl.com (Google Fonts 国内镜像) + raw.githubusercontent.com.

```
PlayfairDisplay-Regular.ttf
PlayfairDisplay-Italic.ttf
PlayfairDisplay-Bold.ttf
PlayfairDisplay-BoldItalic.ttf
NotoSerifSC-Regular.ttf
NotoSerifSC-Bold.ttf
JetBrainsMono-Regular.ttf
JetBrainsMono-Medium.ttf
```

## 下载源

| 字族             | 来源                                                 | License |
| ---------------- | ---------------------------------------------------- | ------- |
| Playfair Display | https://fonts.google.com/specimen/Playfair+Display   | OFL     |
| Noto Serif SC    | https://fonts.google.com/noto/specimen/Noto+Serif+SC | OFL     |
| JetBrains Mono   | https://www.jetbrains.com/lp/mono/                   | OFL     |

## 注意

- **不要**全字重打包. 上面列出的字重就够.
- ttf > otf (RN 渲染 ttf 略快).
- 文件按上面列出的名字命名, `Text.tsx` / `typography.ts` 里用了这些名字.
- 英文正文/标题不再 bundle 字体 —— `Text.tsx` 的 `Serif` 与 `Display` (非 `serif` 态) 不设
  `fontFamily`, 由系统给 SF Pro (iOS) / Roboto (Android).

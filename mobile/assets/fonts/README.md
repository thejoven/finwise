# 字体 bundle

Phase 1 用到 4 个字族, 共 11 个文件. **Sans 不 bundle**, 用系统字体.

## 必备文件 (11 个)

跑 `bash scripts/fetch-fonts.sh` 一键下完. 走 gwfh.mranftl.com (Google Fonts 国内镜像) + raw.githubusercontent.com.

```
PlayfairDisplay-Regular.ttf
PlayfairDisplay-Italic.ttf
PlayfairDisplay-Bold.ttf
PlayfairDisplay-BoldItalic.ttf
SourceSerif4-Regular.ttf
SourceSerif4-Italic.ttf
SourceSerif4-SemiBold.ttf
NotoSerifSC-Regular.ttf
NotoSerifSC-Bold.ttf
JetBrainsMono-Regular.ttf
JetBrainsMono-Medium.ttf
```

## 下载源

| 字族 | 来源 | License |
|---|---|---|
| Playfair Display | https://fonts.google.com/specimen/Playfair+Display | OFL |
| Source Serif 4 | https://github.com/adobe-fonts/source-serif/releases | OFL |
| Noto Serif SC | https://fonts.google.com/noto/specimen/Noto+Serif+SC | OFL |
| JetBrains Mono | https://www.jetbrains.com/lp/mono/ | OFL |

## 注意

- **不要**全字重打包. 上面列出的字重就够 Phase 1.
- **Source Serif 4** 不是 Source Serif Pro (后者闭源).
- ttf > otf (RN 渲染 ttf 略快).
- 文件按上面列出的名字命名, `Text.tsx` 里 hardcoded 用了这些名字.

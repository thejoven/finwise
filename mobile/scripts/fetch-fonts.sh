#!/usr/bin/env bash
#
# fetch-fonts.sh — download the 11 bundled fonts into assets/fonts/.
#
# Sources (all China-reachable as of 2026-05):
#   - Playfair Display + Source Serif 4 + Noto Serif SC: gwfh.mranftl.com
#     (mirror of Google Fonts that serves static TTF zips)
#   - JetBrains Mono: raw.githubusercontent.com/JetBrains/JetBrainsMono

set -euo pipefail

dest="$(cd "$(dirname "$0")/.." && pwd)/assets/fonts"
mkdir -p "$dest"
cd "$dest"

say() { printf "\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }

gwfh() {
  local family="$1" subsets="$2" variants="$3" outprefix="$4"
  local tmpzip
  tmpzip="$(mktemp -t fonts.XXXXXX.zip)"
  local url="https://gwfh.mranftl.com/api/fonts/${family}?download=zip&subsets=${subsets}&variants=${variants}&formats=ttf"
  say "downloading $family ($variants)"
  curl -fsSL --max-time 60 -o "$tmpzip" "$url"
  unzip -o -q "$tmpzip" -d "$tmpzip.d"
  rm -f "$tmpzip"
  # gwfh names: <family>-v##-<subset>-<variant>.ttf
  for variant in $(echo "$variants" | tr , ' '); do
    local suffix
    case "$variant" in
      regular)     suffix="Regular" ;;
      italic)      suffix="Italic" ;;
      600)         suffix="SemiBold" ;;
      700)         suffix="Bold" ;;
      700italic)   suffix="BoldItalic" ;;
      *)           suffix="$variant" ;;
    esac
    local src
    src=$(find "$tmpzip.d" -type f -name "*-${variant}.ttf" | head -1)
    if [ -z "$src" ]; then
      echo "  ✗ variant $variant not in zip — gwfh format changed?" >&2
      ls "$tmpzip.d" >&2
      exit 1
    fi
    cp "$src" "$dest/${outprefix}-${suffix}.ttf"
    ok "${outprefix}-${suffix}.ttf"
  done
  rm -rf "$tmpzip.d"
}

# 1) Playfair Display — display face, Latin only
gwfh playfair-display latin "regular,italic,700,700italic" PlayfairDisplay

# 2) Source Serif 4 — body face, Latin only
gwfh source-serif-4 latin "regular,italic,600" SourceSerif4

# 3) Noto Serif SC — body face, Simplified Chinese
gwfh noto-serif-sc chinese-simplified "regular,700" NotoSerifSC

# 4) JetBrains Mono — from official GitHub mirror
say "downloading JetBrains Mono (Regular, Medium)"
for w in Regular Medium; do
  url="https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-${w}.ttf"
  curl -fsSL --max-time 30 -o "$dest/JetBrainsMono-${w}.ttf" "$url"
  ok "JetBrainsMono-${w}.ttf"
done

say "done"
ls -1 "$dest" | grep -v README

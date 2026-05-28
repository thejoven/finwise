#!/usr/bin/env bash
#
# Fail if any banned RN dependency creeps into package.json.
# Source of truth: docs/技术文档/native_feel_skill/references/05-flashfi-restraint.md § 9
# and docs/GOAL/AGENT_BRIEF.md § 2.4.
#
# Wired into npm: `npm run check:banned-deps`.
# Run it locally before pushing; later we'll attach it to CI.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$repo_root/package.json"

if [ ! -f "$pkg" ]; then
  echo "package.json not found at $pkg" >&2
  exit 1
fi

banned=(
  "react-native-toast-message"
  "react-native-flash-message"
  "react-native-paper"
  "react-native-elements"
  "react-native-onboarding-swiper"
  "react-native-tooltip"
  "react-native-walkthrough-tooltip"
  "react-native-swipe-list-view"
  "react-native-confetti"
  "lottie-react-native"
  "react-native-vector-icons"
  "react-native-timeline-flatlist"
  "expo-notifications"
)

found=0
for dep in "${banned[@]}"; do
  # Match `"<dep>":` only inside the deps blocks (dependencies / devDependencies / peer).
  # Quote-anchored grep avoids false positives on substrings in comments.
  if grep -E "\"$dep\"\\s*:" "$pkg" >/dev/null; then
    echo "❌ banned dep present: $dep"
    found=$((found + 1))
  fi
done

if [ "$found" -gt 0 ]; then
  echo
  echo "$found banned dep(s) found in package.json."
  echo "See docs/技术文档/native_feel_skill/references/05-flashfi-restraint.md § 9 for the reasoning."
  exit 1
fi

echo "✓ no banned deps in package.json"

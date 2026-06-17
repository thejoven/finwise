import { Platform, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pencil,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react-native";

/**
 * Icon — 跨平台图标. iOS 走原生 SF Symbols (expo-symbols), 其余平台回退 lucide.
 *
 * 为什么:
 *   SF Symbols 是 iOS 原生图标系统 —— 光学尺寸、随 Dynamic Type 调字重、自动暗色、
 *   与系统 chrome (导航返回箭头等) 同源同形. lucide 是 JS 自绘 SVG, 这些都给不了.
 *   SF Symbols 仅 iOS 有, 故按 references/04-cross-platform-design.md 的取舍, 非 iOS
 *   回退到 lucide —— 视觉接近, 行为一致. DynamicIslandTabBar 已是同款做法的参考实现.
 *
 * 调色:
 *   `color` 直接传 theme.color.X (ColorValue). iOS 给 SymbolView.tintColor (吃动态色,
 *   随明暗自动翻); 其余平台给 lucide.color. 两端同一个值, 无需 resolve.
 *
 * 字重:
 *   调用方沿用 lucide 的 `strokeWidth` 语义 (项目里只有 1.5 / 1.75 / 2), 内部映射成
 *   SF Symbol weight. 这样从 lucide 迁过来近乎机械替换, 不必逐处换算.
 *
 * 注:
 *   SF Symbol 的字形比 lucide 同 `size` 的盒子略小 (~10–15%), 个别 `size` 数值在真机
 *   QA 时可能要微调一档. 见 /ios-design-review.
 *
 * @see https://docs.expo.dev/versions/latest/sdk/symbols/
 */

/** 所有 lucide 图标同型, 用 `typeof Plus` 取得组件类型 (lucide 未导出 LucideIcon). */
type LucideComponent = typeof Plus;

export type IconName =
  | "plus"
  | "check"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "chevronUp"
  | "pencil"
  | "close"
  | "arrowUp"
  | "arrowUpRight"
  | "book"
  | "search"
  | "archive"
  | "restore"
  | "star"
  | "starFill";

/** 语义名 → SF Symbol (iOS) + lucide 组件 (兜底). SF 名见 Apple「SF Symbols」app. */
const ICONS: Record<IconName, { sf: SFSymbol; lucide: LucideComponent }> = {
  plus: { sf: "plus", lucide: Plus },
  check: { sf: "checkmark", lucide: Check },
  chevronLeft: { sf: "chevron.left", lucide: ChevronLeft },
  chevronRight: { sf: "chevron.right", lucide: ChevronRight },
  chevronDown: { sf: "chevron.down", lucide: ChevronDown },
  chevronUp: { sf: "chevron.up", lucide: ChevronUp },
  pencil: { sf: "pencil", lucide: Pencil },
  close: { sf: "xmark", lucide: X },
  arrowUp: { sf: "arrow.up", lucide: ArrowUp },
  arrowUpRight: { sf: "arrow.up.right", lucide: ArrowUpRight },
  // BookOpen → `book` (iOS 13+, 全版本可用). 若只跑 iOS 16+ 想要"翻开"感可换 `book.pages`.
  book: { sf: "book", lucide: BookOpen },
  search: { sf: "magnifyingglass", lucide: Search },
  archive: { sf: "archivebox", lucide: Archive },
  restore: { sf: "arrow.uturn.backward", lucide: ArchiveRestore },
  // 收藏: iOS 用 SF 实心/描边两态; lucide 兜底两者都是描边 Star (Android 次要, 接受).
  star: { sf: "star", lucide: Star },
  starFill: { sf: "star.fill", lucide: Star },
};

/** lucide strokeWidth → SF Symbol weight. 项目描边只用 1.5 / 1.75 / 2. */
function toSymbolWeight(strokeWidth: number): SymbolWeight {
  if (strokeWidth >= 2) return "semibold";
  if (strokeWidth >= 1.75) return "medium";
  return "regular";
}

export type IconProps = {
  name: IconName;
  /** 点尺寸. 默认 18 (项目主流). */
  size?: number;
  /** 传 theme.color.X 即可; 两端通吃. */
  color?: ColorValue;
  /** lucide 语义的描边宽度; iOS 上换算成 SF weight. 默认 1.5. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 18, color, strokeWidth = 1.5, style }: IconProps) {
  const { sf, lucide: Lucide } = ICONS[name];

  if (Platform.OS === "ios") {
    return (
      <SymbolView
        name={sf}
        size={size}
        tintColor={color}
        weight={toSymbolWeight(strokeWidth)}
        resizeMode="scaleAspectFit"
        style={style}
      />
    );
  }

  return <Lucide size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}

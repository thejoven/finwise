// Barrel export for the shared component kit.
// Keeps imports tidy: `import { Masthead, Serif, TapEffect } from "@/shared/components";`

export { Display, Serif, Sans, Mono } from "./Text";
export type { DisplayProps, SerifProps, SansProps, MonoProps } from "./Text";

export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";

export { RichText } from "./RichText";

export { Icon } from "./Icon";
export type { IconName, IconProps } from "./Icon";

export { TapEffect } from "./TapEffect";
export type { TapEffectProps } from "./TapEffect";

export { PaperCard } from "./PaperCard";
export type { PaperCardProps } from "./PaperCard";

export { DoubleRule } from "./DoubleRule";
export type { DoubleRuleProps } from "./DoubleRule";

export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";

export { SegmentedTabs } from "./SegmentedTabs";

export { RomanList } from "./RomanList";
export type { RomanListProps, RomanListItem } from "./RomanList";

export { DynamicIslandTabBar } from "./DynamicIslandTabBar";
// 各 tab 屏给悬浮岛让位的标准底部空隙 (paddingBottom = insets.bottom + TAB_BAR_CLEARANCE).
export { TAB_BAR_CLEARANCE } from "./glass";

export { KeyboardForm } from "./KeyboardForm";

export { ModalTopBar } from "./ModalTopBar";

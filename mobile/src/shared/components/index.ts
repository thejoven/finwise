// Barrel export for the shared component kit.
// Keeps imports tidy: `import { Masthead, Serif, TapEffect } from "@/shared/components";`

export { Display, Serif, Sans, Mono } from "./Text";
export type { DisplayProps, SerifProps, SansProps, MonoProps } from "./Text";

export { TapEffect } from "./TapEffect";
export type { TapEffectProps } from "./TapEffect";

export { PaperCard } from "./PaperCard";
export type { PaperCardProps } from "./PaperCard";

export { DoubleRule } from "./DoubleRule";
export type { DoubleRuleProps } from "./DoubleRule";

export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";

export { RomanList } from "./RomanList";
export type { RomanListProps, RomanListItem } from "./RomanList";

export { Masthead } from "./Masthead";
export type { MastheadProps } from "./Masthead";

export {
  CollapsibleMasthead,
  COLLAPSIBLE_MASTHEAD_EXPANDED,
  COLLAPSIBLE_MASTHEAD_COLLAPSED,
} from "./CollapsibleMasthead";
export type { CollapsibleMastheadProps } from "./CollapsibleMasthead";

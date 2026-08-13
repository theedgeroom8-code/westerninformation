import { Platform, useWindowDimensions } from "react-native";

/** Shared breakpoints (px). Mobile-first: below `tablet` everything renders
 *  the native phone layout — the website only diverges upward. */
export const BREAKPOINTS = { tablet: 768, desktop: 1024, wide: 1440 } as const;

export interface Breakpoint {
  width: number;
  /** true on web viewports ≥1024px — sidebar navigation + grid layouts */
  isDesktop: boolean;
  /** true on web viewports ≥768px */
  isTablet: boolean;
  /** true on web viewports ≥1440px — 3-column grids */
  isWide: boolean;
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  const web = Platform.OS === "web";
  return {
    width,
    isDesktop: web && width >= BREAKPOINTS.desktop,
    isTablet: web && width >= BREAKPOINTS.tablet,
    isWide: web && width >= BREAKPOINTS.wide,
  };
}

/** Style fragment: constrain + center content on web, no-op on native.
 *  Spread into a contentContainerStyle / container style. */
export const webMaxWidth = (max: number) =>
  Platform.OS === "web"
    ? ({ maxWidth: max, width: "100%", alignSelf: "center" } as const)
    : ({} as const);

import type { Router } from "expo-router";

/**
 * Back that never dead-ends. On a shared/deep link there is no history —
 * router.back() would silently do nothing — so fall through to a sensible
 * screen instead.
 */
export function safeBack(router: Router, fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as any);
}

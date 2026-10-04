import { Platform, Linking } from "react-native";

/**
 * Opens an outbound URL (a sportsbook's site) without letting the destination
 * see this app as the referrer. Client (2026-10-04) asked whether a sportsbook
 * could tell a click came from a third-party site.
 *
 * Native: Linking.openURL hands the URL to the OS (opens the browser or the
 * book's own app directly) — no HTTP Referer header is ever sent that way.
 * Web: a plain window.open DOES send one by default (the browser's default
 * referrer-policy exposes at least this site's origin) — "noopener,noreferrer"
 * suppresses it entirely, same as if the user had typed the URL themselves.
 */
export function openExternal(url: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  Linking.openURL(url).catch(() => {});
}

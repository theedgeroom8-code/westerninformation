import { Platform } from "react-native";

// Browser notifications for the website. Fires OS-level notifications from
// the realtime feed while the tab is open (foreground realtime already shows
// content in-app, so we only notify when the tab is hidden/minimized).
// True closed-browser Web Push (VAPID/service-worker) is a later phase.

export const webNotificationsSupported = (): boolean =>
  Platform.OS === "web" && typeof window !== "undefined" && "Notification" in window;

export const webNotificationsGranted = (): boolean =>
  webNotificationsSupported() && Notification.permission === "granted";

export async function enableWebNotifications(): Promise<"granted" | "denied" | "unsupported"> {
  if (!webNotificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result === "granted" ? "granted" : "denied";
}

/** Show a notification if permitted AND the tab isn't currently visible. */
export function webNotify(title: string, body: string) {
  try {
    if (!webNotificationsGranted()) return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    const n = new Notification(title, { body, icon: "/pwa-icon.png", badge: "/pwa-icon.png" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Notification constructor can throw on some mobile browsers — ignore.
  }
}

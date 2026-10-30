import { Platform } from "react-native";
import { supabase } from "./supabase";

// Real background Web Push (service worker + PushManager) — the piece that
// makes an alert arrive like a real app notification on a phone, even with
// the browser closed. Complements lib/webNotify.ts, which only fires while
// a tab is open.

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY as string | undefined;

export const webPushSupported = (): boolean =>
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  !!VAPID_PUBLIC_KEY;

/** iOS/iPadOS only ever offers Web Push to a site added to the Home Screen
 *  (WebKit, iOS 16.4+) — a plain Safari tab can't subscribe at all. */
export const isIOS = (): boolean =>
  Platform.OS === "web" &&
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as any).MSStream;

export const isStandalone = (): boolean =>
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Safe to call anytime, no user gesture needed — browsers no-op a repeat
 *  register() against the same URL and just return the existing registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!webPushSupported()) return null;
  return (await registerServiceWorker()) || (await navigator.serviceWorker.ready.catch(() => null));
}

export type WebPushResult = "subscribed" | "denied" | "unsupported" | "needs-install";

/** Request permission (must be called from a tap/click — browsers block a
 *  silent request) and subscribe this device to push, storing it for the
 *  server to send to later. */
export async function subscribeWebPush(userId: string): Promise<WebPushResult> {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!webPushSupported()) return "unsupported";

  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
  }

  const reg = await getRegistration();
  if (!reg) return "unsupported";

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "unsupported";

  const { error } = await supabase.from("web_push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) return "unsupported";
  return "subscribed";
}

/** Ground truth for "is this device actually going to get pushes" — checking
 *  Notification.permission alone isn't enough: permission can be "granted"
 *  while the stored subscription row is gone (browser data cleared, endpoint
 *  revoked, etc.), which is exactly the gap that let edges fire with nobody
 *  subscribed to receive them. */
export async function hasWebPushSubscription(userId: string): Promise<boolean> {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return false;
    const { data } = await supabase
      .from("web_push_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("endpoint", sub.endpoint)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** Called when the user turns push off in settings. */
export async function unsubscribeWebPush(userId: string) {
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from("web_push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    // best-effort
  }
}

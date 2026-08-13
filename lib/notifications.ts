import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { router } from "expo-router";
import { supabase } from "./supabase";

// Remote push requires a development/production build (EAS). Expo Go cannot
// receive remote notifications (SDK 53+) — all functions here degrade
// gracefully so the app keeps working in Expo Go and on web.

export const isExpoGo = Constants.appOwnership === "expo";
const canUsePush = Platform.OS !== "web" && Device.isDevice && !isExpoGo;

// Foreground presentation: show banner + play sound even while app is open.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

async function ensureAndroidChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("edges", {
    name: "Edge Alerts",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#F5B841",
  });
  await Notifications.setNotificationChannelAsync("high-edge", {
    name: "High-Edge Priority",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lightColor: "#F5B841",
  });
  await Notifications.setNotificationChannelAsync("announcements", {
    name: "Announcements",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

export type PushRegistration =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported"; reason: string };

/** Request permission, get the Expo push token, and store it for this user. */
export async function registerForPush(userId: string): Promise<PushRegistration> {
  if (!canUsePush) {
    return {
      status: "unsupported",
      reason: isExpoGo
        ? "Push needs the development build — Expo Go can't receive remote notifications."
        : "Push notifications aren't available on this platform.",
    };
  }

  await ensureAndroidChannels();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return { status: "denied" };

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { status: "unsupported", reason: "EAS project not initialized yet (run `eas init`)." };
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await supabase.from("push_tokens").upsert(
    { user_id: userId, token: data, platform: Platform.OS, updated_at: new Date().toISOString() },
    { onConflict: "user_id,token" }
  );
  return { status: "registered", token: data };
}

/** Remove this device's token (called when the user turns push off). */
export async function unregisterPush(userId: string) {
  if (!canUsePush) return;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", data);
  } catch {
    // token unavailable — nothing to remove
  }
}

/** Tap on a notification → deep link into the right screen. */
export function attachNotificationDeepLinks(): () => void {
  if (Platform.OS === "web") return () => {};

  const handle = (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data as any;
    if (data?.type === "edge" && data.edgeId) {
      router.push({ pathname: "/edge-detail", params: { edgeId: String(data.edgeId) } });
    } else if (data?.type === "broadcast") {
      router.push("/(tabs)/alerts");
    }
  };

  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  // Cold start: app opened by tapping a notification
  Notifications.getLastNotificationResponseAsync().then((r) => { if (r) handle(r); });
  return () => sub.remove();
}

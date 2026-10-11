import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { webPushSupported, subscribeWebPush, isIOS, isStandalone } from "../lib/webPush";
import { useAuthStore } from "../store/authStore";
import { colors, spacing, radius, font, shadow } from "../theme";

const DISMISS_KEY = "win-notify-prompt-dismissed";

/**
 * Website-only banner asking to enable real background notifications.
 * Browsers only show the permission dialog on a user gesture, so we can't
 * silently request on load — this card provides the gesture.
 *
 * iOS/iPadOS Safari can't subscribe to push at all from a plain browser tab
 * (WebKit, iOS 16.4+) — the site has to be added to the Home Screen first.
 * There's no API to trigger that dialog, so for iOS we show instructions
 * instead of an "Enable" button until the site is running standalone.
 */
export function WebNotifyPrompt() {
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<"enable" | "ios-install" | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {}

    if (isIOS() && !isStandalone()) {
      setMode("ios-install");
      return;
    }
    if (!webPushSupported()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    setMode("enable");
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setMode(null);
  };

  const onEnable = async () => {
    setMode(null);
    if (user?.id) await subscribeWebPush(user.id);
  };

  const iosInstall = mode === "ios-install";

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={iosInstall ? "share-outline" : "notifications"} size={20} color={colors.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{iosInstall ? "Add to Home Screen for alerts" : "Turn on notifications"}</Text>
          <Text style={styles.sub}>
            {iosInstall
              ? "iPhone only allows alerts for installed sites: tap the Share icon below, then \"Add to Home Screen\"."
              : "Get alerted the moment a new play is detected — even with this tab closed."}
          </Text>
        </View>
        {iosInstall ? null : (
          <TouchableOpacity style={styles.enableBtn} onPress={onEnable} activeOpacity={0.85}>
            <Text style={styles.enableText}>Enable</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.laterBtn} onPress={dismiss} activeOpacity={0.7}>
          <Text style={styles.laterText}>{iosInstall ? "Got it" : "Later"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", padding: spacing.lg, zIndex: 90 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, maxWidth: 560, width: "100%",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, ...shadow.soft,
  },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: font.small, fontWeight: font.bold },
  sub: { color: colors.textDim, fontSize: font.caption, lineHeight: 16, marginTop: 2 },
  enableBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: spacing.lg },
  enableText: { color: colors.ink, fontSize: font.small, fontWeight: font.bold },
  laterBtn: { paddingVertical: 9, paddingHorizontal: spacing.sm },
  laterText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
});

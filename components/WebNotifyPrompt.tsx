import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { webPushSupported, subscribeWebPush, hasWebPushSubscription, isIOS, isStandalone } from "../lib/webPush";
import { useAuthStore } from "../store/authStore";
import { colors, spacing, radius, font, shadow } from "../theme";

const SNOOZE_MS = 5 * 60 * 1000; // "Later" hides it, but it's back in 5 minutes if still not subscribed

type Mode = "enable" | "ios-install" | "denied" | null;

/**
 * Website-only banner asking to enable real background notifications.
 * Browsers only show the permission dialog on a user gesture, so we can't
 * silently request on load — this card provides the gesture.
 *
 * Client (2026-10-30): real high edges fired with zero stored push
 * subscriptions — nobody had actually completed this flow. Checking
 * Notification.permission alone isn't enough (permission can read "granted"
 * with no live subscription underneath), so this now checks the real
 * subscription row, sits at the TOP of the screen instead of the bottom
 * (the old bottom placement overlapped the tab bar), and keeps coming back
 * on a snooze timer instead of disappearing for the rest of the session.
 *
 * iOS/iPadOS Safari can't subscribe to push at all from a plain browser tab
 * (WebKit, iOS 16.4+) — the site has to be added to the Home Screen first.
 * There's no API to trigger that dialog, so for iOS we show instructions
 * instead of an "Enable" button until the site is running standalone.
 */
export function WebNotifyPrompt() {
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<Mode>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = async () => {
    if (Platform.OS !== "web" || !user?.id) return;

    if (isIOS() && !isStandalone()) {
      setMode("ios-install");
      return;
    }
    if (!webPushSupported()) {
      setMode(null);
      return;
    }
    if (await hasWebPushSubscription(user.id)) {
      setMode(null); // actually subscribed — nothing to nag about
      return;
    }
    setMode(typeof Notification !== "undefined" && Notification.permission === "denied" ? "denied" : "enable");
  };

  useEffect(() => {
    check();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!mode) return null;

  const snooze = () => {
    setMode(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(check, SNOOZE_MS);
  };

  const onEnable = async () => {
    if (!user?.id) return;
    const result = await subscribeWebPush(user.id);
    if (result === "subscribed") {
      setMode(null);
    } else {
      // didn't go through (denied, unsupported, race) — recheck and keep nagging
      await check();
    }
  };

  const iosInstall = mode === "ios-install";
  const denied = mode === "denied";

  const title = iosInstall
    ? "Add to Home Screen for alerts"
    : denied
    ? "Notifications are blocked"
    : "Turn on notifications";
  const sub = iosInstall
    ? "iPhone only allows alerts for installed sites: tap the Share icon below, then \"Add to Home Screen.\""
    : denied
    ? "Your browser is blocking alerts for this site. Click the lock/info icon next to the address bar → Notifications → Allow, then refresh."
    : "Get alerted the moment a new play is detected — even with this tab closed.";
  const icon = iosInstall ? "share-outline" : denied ? "notifications-off" : "notifications";

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={20} color={colors.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
        {iosInstall || denied ? null : (
          <TouchableOpacity style={styles.enableBtn} onPress={onEnable} activeOpacity={0.85}>
            <Text style={styles.enableText}>Enable</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.laterBtn} onPress={snooze} activeOpacity={0.7}>
          <Text style={styles.laterText}>{iosInstall || denied ? "Got it" : "Later"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", padding: spacing.lg, zIndex: 90 },
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

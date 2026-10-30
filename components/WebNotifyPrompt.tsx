import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { webPushSupported, subscribeWebPush, hasWebPushSubscription, isIOS, isStandalone } from "../lib/webPush";
import { useAuthStore } from "../store/authStore";
import { toast } from "../lib/toast";
import { colors, spacing, radius, font, shadow } from "../theme";

const SNOOZE_MS = 5 * 60 * 1000; // "Later" hides it, but it's back in 5 minutes if still not subscribed
const NARROW = 480; // below this, stack text above buttons instead of cramming one row

type Mode = "enable" | "ios-install" | "denied" | null;

/**
 * Website-only banner asking to enable real background notifications.
 * Browsers only show the permission dialog on a user gesture, so we can't
 * silently request on load — this card provides the gesture.
 *
 * Client (2026-10-30): real high edges fired with zero stored push
 * subscriptions — nobody had actually completed this flow. Checking
 * Notification.permission alone isn't enough (permission can read "granted"
 * with no live subscription underneath), so this checks the real
 * subscription row, sits at the TOP of the screen instead of the bottom,
 * and keeps coming back on a snooze timer instead of disappearing for the
 * rest of the session.
 *
 * Follow-up: the card dismissed itself on `await subscribeWebPush(...)`
 * resolving, so it sat on screen for the full permission-dialog + service-
 * worker + network round trip — felt "laggy." It now closes the instant a
 * button is tapped (optimistic) and reports the real outcome via toast
 * once the subscribe actually finishes, same as the Settings toggle.
 *
 * iOS/iPadOS Safari can't subscribe to push at all from a plain browser tab
 * (WebKit, iOS 16.4+) — the site has to be added to the Home Screen first.
 * There's no API to trigger that dialog, so for iOS we show instructions
 * instead of an "Enable" button until the site is running standalone.
 */
export function WebNotifyPrompt() {
  const user = useAuthStore((s) => s.user);
  const { width } = useWindowDimensions();
  const narrow = width < NARROW;
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

  const onEnable = () => {
    if (!user?.id) return;
    setMode(null); // close immediately — don't make the user wait on the permission/network round trip
    subscribeWebPush(user.id).then((result) => {
      if (result === "subscribed") {
        toast("success", "Notifications on", "You'll get alerts even with this tab closed.");
      } else if (result === "denied") {
        toast("error", "Blocked by browser", "Allow notifications for this site in your browser settings, then refresh.");
      } else if (result === "needs-install") {
        check(); // show the iOS install card instead
      } else {
        toast("info", "Not supported here", "This browser doesn't support notifications — alerts still appear live on the Alerts tab.");
      }
      if (result !== "subscribed") {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(check, SNOOZE_MS);
      }
    });
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

  const buttons = (stacked: boolean) => (
    <View style={[styles.btnRow, stacked && styles.btnRowStacked]}>
      {iosInstall || denied ? null : (
        <TouchableOpacity style={styles.enableBtn} onPress={onEnable} activeOpacity={0.85}>
          <Text style={styles.enableText}>Enable</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.laterBtn} onPress={snooze} activeOpacity={0.7}>
        <Text style={styles.laterText}>{iosInstall || denied ? "Got it" : "Later"}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.card, narrow && styles.cardNarrow]}>
        <View style={styles.headRow}>
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={18} color={colors.gold} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{title}</Text>
            {!narrow && <Text style={styles.sub}>{sub}</Text>}
          </View>
          {!narrow && buttons(false)}
        </View>
        {narrow && <Text style={styles.sub}>{sub}</Text>}
        {narrow && buttons(true)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", padding: spacing.md, zIndex: 90 },
  card: {
    maxWidth: 560, width: "100%",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md, ...shadow.soft,
  },
  cardNarrow: { paddingBottom: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: font.small, fontWeight: font.bold },
  sub: { color: colors.textDim, fontSize: font.caption, lineHeight: 16, marginTop: 4 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  btnRowStacked: { marginTop: spacing.sm, justifyContent: "flex-end" },
  enableBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 7, paddingHorizontal: spacing.md },
  enableText: { color: colors.ink, fontSize: font.caption, fontWeight: font.bold },
  laterBtn: { paddingVertical: 7, paddingHorizontal: spacing.sm },
  laterText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.semibold },
});

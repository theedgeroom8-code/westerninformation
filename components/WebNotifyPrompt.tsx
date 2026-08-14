import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { webNotificationsSupported, enableWebNotifications } from "../lib/webNotify";
import { colors, spacing, radius, font, shadow } from "../theme";

const DISMISS_KEY = "win-notify-prompt-dismissed";

/**
 * Website-only banner asking to enable browser notifications. Browsers only
 * show the real permission dialog on a user gesture, so we can't silently
 * request on load — this card provides the gesture. Reappears next session
 * if dismissed with "Later"; disappears forever once granted or denied.
 */
export function WebNotifyPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || !webNotificationsSupported()) return;
    if (Notification.permission !== "default") return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    setVisible(true);
  }, []);

  if (!visible) return null;

  const onEnable = async () => {
    setVisible(false);
    await enableWebNotifications();
  };

  const onLater = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setVisible(false);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications" size={20} color={colors.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Turn on notifications</Text>
          <Text style={styles.sub}>Get alerted the moment a new play is detected — even with this tab in the background.</Text>
        </View>
        <TouchableOpacity style={styles.enableBtn} onPress={onEnable} activeOpacity={0.85}>
          <Text style={styles.enableText}>Enable</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.laterBtn} onPress={onLater} activeOpacity={0.7}>
          <Text style={styles.laterText}>Later</Text>
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

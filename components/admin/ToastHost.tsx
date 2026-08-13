import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { subscribeToasts, dismissToast, ToastItem } from "../../lib/toast";
import { colors, spacing, radius, font, shadow } from "../../theme";

const meta = {
  success: { icon: "checkmark-circle", color: colors.green, bg: "rgba(52,211,153,0.14)" },
  error: { icon: "alert-circle", color: colors.red, bg: "rgba(248,113,113,0.14)" },
  info: { icon: "information-circle", color: colors.blue, bg: "rgba(96,165,250,0.14)" },
} as const;

// Fixed top-right toast stack for the admin console (web).
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (!items.length) return null;

  return (
    <View style={styles.host} pointerEvents="box-none">
      {items.map((t) => {
        const m = meta[t.kind];
        return (
          <View key={t.id} style={[styles.toast, { borderColor: m.color }]} accessibilityLiveRegion="polite">
            <View style={[styles.iconWrap, { backgroundColor: m.bg }]}>
              <Ionicons name={m.icon as any} size={18} color={m.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t.title}</Text>
              {t.message ? <Text style={styles.message}>{t.message}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => dismissToast(t.id)} hitSlop={8} accessibilityLabel="Dismiss notification">
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
    gap: spacing.sm,
    maxWidth: 380,
    width: "90%",
    alignSelf: "flex-end",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    ...shadow.card,
  },
  iconWrap: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: font.small, fontWeight: font.bold },
  message: { color: colors.textDim, fontSize: font.caption, marginTop: 1 },
});

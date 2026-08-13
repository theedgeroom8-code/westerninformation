import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, StyleSheet, AppState, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius, font } from "../theme";

const PROMPT_KEY = "update-prompt-date";
const CHECK_THROTTLE_MS = 30 * 60 * 1000; // at most every 30 min on resume

/**
 * Over-the-air update flow:
 *  • checks on app open and on foreground resume (throttled)
 *  • when an update is published, shows a popup — once per day until installed
 *  • "Update Now" downloads and reloads in place; no APK reinstall ever again
 * No-ops in Expo Go, dev builds, and web (Updates.isEnabled is false there).
 */
export function UpdateGate() {
  const [visible, setVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastCheck = useRef(0);

  const check = async (respectDailyLimit: boolean) => {
    try {
      if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled) return;
      if (Date.now() - lastCheck.current < CHECK_THROTTLE_MS) return;
      lastCheck.current = Date.now();
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      if (respectDailyLimit) {
        const last = await AsyncStorage.getItem(PROMPT_KEY);
        if (last === new Date().toDateString()) return; // already asked today
      }
      await AsyncStorage.setItem(PROMPT_KEY, new Date().toDateString());
      setVisible(true);
    } catch {
      // Network hiccup — stay quiet, we'll try again next open/resume.
    }
  };

  useEffect(() => {
    check(true);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check(true);
    });
    return () => sub.remove();
  }, []);

  const onUpdate = async () => {
    setDownloading(true);
    setFailed(false);
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync(); // applies instantly — app restarts on new version
    } catch {
      setDownloading(false);
      setFailed(true);
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-download-outline" size={30} color={colors.gold} />
          </View>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.body}>
            A new version of Edge System is ready. It takes a few seconds and applies instantly — no reinstall needed.
          </Text>
          {failed && (
            <Text style={styles.error}>Couldn't download the update. Check your connection and try again.</Text>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={onUpdate} disabled={downloading} activeOpacity={0.85}>
            {downloading ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <>
                <Ionicons name="flash" size={16} color={colors.ink} />
                <Text style={styles.primaryText}>Update Now</Text>
              </>
            )}
          </TouchableOpacity>
          {!downloading && (
            <TouchableOpacity style={styles.laterBtn} onPress={() => setVisible(false)} activeOpacity={0.7}>
              <Text style={styles.laterText}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  iconWrap: { width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  title: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy },
  body: { color: colors.textDim, fontSize: font.body, lineHeight: 21, textAlign: "center", marginTop: spacing.sm },
  error: { color: "#e5484d", fontSize: font.small, textAlign: "center", marginTop: spacing.md },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 14, alignSelf: "stretch", marginTop: spacing.xl },
  primaryText: { color: colors.ink, fontSize: font.body, fontWeight: font.bold },
  laterBtn: { paddingVertical: spacing.md, marginTop: spacing.xs },
  laterText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
});

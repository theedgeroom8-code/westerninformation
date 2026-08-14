import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, AppState, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../store/authStore";
import { useBettingStore } from "../store/bettingStore";
import { colors, spacing, radius, font } from "../theme";

// Loaded lazily so an OTA update never crashes an app binary that was built
// before expo-local-authentication was added. On such builds the gate simply
// stays open until the user installs the new APK.
function getLocalAuth(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-local-authentication");
  } catch {
    return null;
  }
}

/**
 * Full-screen lock over the signed-in app when "Biometric Unlock" is on.
 * Locks on cold start and whenever the app returns from the background,
 * and only lifts after Face ID / fingerprint (or the device PIN) succeeds.
 */
export function BiometricGate() {
  const { isAuthenticated, hasOnboarded, logout } = useAuthStore();
  const enabled = useBettingStore((s) => s.settings.biometricUnlock);
  const settingsLoaded = useBettingStore((s) => !s.loading);

  const armed = Platform.OS !== "web" && isAuthenticated && hasOnboarded && settingsLoaded && enabled;
  const [locked, setLocked] = useState(false);
  const prompting = useRef(false);

  const tryUnlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const LA = getLocalAuth();
      if (!LA) { setLocked(false); return; } // old binary — feature needs the new build
      const [hasHardware, enrolled] = await Promise.all([LA.hasHardwareAsync(), LA.isEnrolledAsync()]);
      if (!hasHardware || !enrolled) { setLocked(false); return; } // nothing to authenticate with
      const res = await LA.authenticateAsync({
        promptMessage: "Unlock Western Information Network",
        cancelLabel: "Cancel",
      });
      if (res.success) setLocked(false);
    } catch {
      setLocked(false); // never brick the app on an auth-layer error
    } finally {
      prompting.current = false;
    }
  }, []);

  // Cold start / toggle flipped on → lock and prompt immediately.
  useEffect(() => {
    if (armed) {
      setLocked(true);
      tryUnlock();
    } else {
      setLocked(false);
    }
  }, [armed, tryUnlock]);

  // Re-lock whenever the app goes to the background.
  useEffect(() => {
    if (!armed) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") setLocked(true);
      else if (state === "active") {
        // returning to a locked app → prompt again
        setLocked((l) => {
          if (l) tryUnlock();
          return l;
        });
      }
    });
    return () => sub.remove();
  }, [armed, tryUnlock]);

  if (!locked) return null;

  return (
    <View style={styles.overlay}>
      <Image source={require("../assets/images/logo.png")} style={styles.logo} />
      <Text style={styles.title}>Locked</Text>
      <Text style={styles.sub}>Verify it's you to continue</Text>
      <TouchableOpacity style={styles.unlockBtn} onPress={tryUnlock} activeOpacity={0.85}>
        <Ionicons name="finger-print" size={20} color={colors.ink} />
        <Text style={styles.unlockText}>Unlock</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.signOut} onPress={() => logout()} activeOpacity={0.7}>
        <Text style={styles.signOutText}>Sign out instead</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 999, backgroundColor: colors.bg,
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  logo: { width: 84, height: 84, borderRadius: radius.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.body, marginTop: 4, marginBottom: spacing.xxl },
  unlockBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.gold,
    borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: spacing.xxl,
  },
  unlockText: { color: colors.ink, fontSize: font.body, fontWeight: font.bold },
  signOut: { marginTop: spacing.xl, padding: spacing.sm },
  signOutText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
});

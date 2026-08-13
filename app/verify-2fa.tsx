import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { useAuthStore } from "../store/authStore";
import { colors, spacing, radius, font } from "../theme";
import { showError } from "../lib/errors";
import { webMaxWidth } from "../lib/responsive";

const LENGTH = 6;

/** Login-time TOTP challenge. The router guard (pending2FA) keeps the rest
 *  of the app unreachable until the code verifies. */
export default function Verify2FAScreen() {
  const { verify2FA, logout } = useAuthStore();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const digits = code.padEnd(LENGTH, " ").split("").slice(0, LENGTH);

  const verify = async () => {
    setLoading(true);
    try {
      await verify2FA(code);
      // Guard flips — router moves into the app.
    } catch (e: any) {
      showError(e, "Verification failed");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.body, webMaxWidth(460)]}>
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={28} color={colors.gold} />
          </View>
          <Text style={styles.heading}>Two-factor authentication</Text>
          <Text style={styles.sub}>Enter the 6-digit code from your authenticator app.</Text>

          <TouchableOpacity activeOpacity={1} onPress={() => inputRef.current?.focus()} style={styles.boxes}>
            {digits.map((d, i) => {
              const filled = d.trim() !== "";
              const active = i === code.length;
              return (
                <View key={i} style={[styles.box, (filled || active) && styles.boxActive]}>
                  <Text style={styles.boxText}>{d.trim()}</Text>
                </View>
              );
            })}
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, LENGTH))}
            keyboardType="number-pad"
            style={styles.hiddenInput}
            autoFocus
            maxLength={LENGTH}
          />

          <View style={{ flex: 1 }} />
          <Button label="Verify & Sign In" icon="lock-open" onPress={verify} loading={loading} disabled={code.length < LENGTH} />
          <TouchableOpacity style={styles.cancel} onPress={logout} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Use a different account</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xl },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.sm },
  boxes: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xxl },
  box: { flex: 1, aspectRatio: 0.82, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  boxActive: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
  boxText: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  cancel: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
});

import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";
import { toast } from "../../lib/toast";
import { webMaxWidth } from "../../lib/responsive";

const LENGTH = 6;

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { verifyOtp, resendOtp, verifyRecovery, forgotPassword } = useAuthStore();
  const { email, mode } = useLocalSearchParams<{ email: string; mode?: string }>();
  const isRecovery = mode === "recovery";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const digits = code.padEnd(LENGTH, " ").split("").slice(0, LENGTH);

  const verify = async () => {
    setLoading(true);
    try {
      if (isRecovery) {
        await verifyRecovery(email || "", code);
        // pendingPasswordReset guard now routes to the new-password screen.
      } else {
        await verifyOtp(email || "", code);
        // Session arrives via onAuthStateChange → root guard routes to onboarding.
      }
    } catch (e: any) {
      showError(e, "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      if (isRecovery) {
        await forgotPassword(email || "");
      } else {
        await resendOtp(email || "");
      }
      if (Platform.OS === "web") toast("success", "Code sent", "A new verification code is on its way.");
      else Alert.alert("Code sent", "A new verification code is on its way.");
    } catch (e: any) {
      showError(e, "Couldn't resend");
    }
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.body, webMaxWidth(460)]}>
          <View style={styles.badge}>
            <Ionicons name="mail-open" size={28} color={colors.gold} />
          </View>
          <Text style={styles.heading}>{isRecovery ? "Enter reset code" : "Verify your account"}</Text>
          <Text style={styles.sub}>
            We sent a 6-digit code to{"\n"}
            <Text style={styles.email}>{email}</Text>
          </Text>

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

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>Didn't get the code?</Text>
            <TouchableOpacity activeOpacity={0.7} onPress={resend}>
              <Text style={styles.resendLink}>Resend</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }} />
          <Button
            label="Verify & Continue"
            icon="checkmark-circle"
            onPress={verify}
            loading={loading}
            disabled={code.length < LENGTH}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.sm },
  email: { color: colors.text, fontWeight: font.bold },
  boxes: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xxl },
  box: { flex: 1, aspectRatio: 0.82, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  boxActive: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
  boxText: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  resendRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.xl },
  resendText: { color: colors.textDim, fontSize: font.small },
  resendLink: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
});

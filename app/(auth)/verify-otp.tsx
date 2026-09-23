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
import { safeBack } from "../../lib/nav";

// The code length is a Supabase project setting (Authentication → Sign In /
// Providers → Email → OTP Length) that the app cannot read at runtime, so this
// constant MUST match it — it drives the box count, the copy ("8-digit"), the
// "n of 8" counter and auto-submit. Supabase's current default is 8.
// If the two ever drift the screen still works (any length 6–10 is accepted
// and the Verify button enables from 6), it just shows the wrong box count.
const OTP_LENGTH = 8;
const MIN_LENGTH = 6;
const MAX_LENGTH = 10;

// Split long codes into two readable groups (1234 5678).
const GROUP_AFTER = OTP_LENGTH >= 8 && OTP_LENGTH % 2 === 0 ? OTP_LENGTH / 2 : 0;
const ARTICLE = String(OTP_LENGTH).startsWith("8") ? "an" : "a";

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { verifyOtp, resendOtp, verifyRecovery, forgotPassword } = useAuthStore();
  const { email, mode } = useLocalSearchParams<{ email: string; mode?: string }>();
  const isRecovery = mode === "recovery";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const submitting = useRef(false); // autofill/paste can fire onChangeText twice

  // Always show the expected number of boxes up front; only grow past it if
  // someone genuinely types more (drift safety), up to MAX_LENGTH.
  const boxCount = Math.min(Math.max(OTP_LENGTH, code.length), MAX_LENGTH);
  const digits = code.padEnd(boxCount, " ").split("").slice(0, boxCount);

  const verify = async (value: string = code) => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      if (isRecovery) {
        await verifyRecovery(email || "", value);
        // pendingPasswordReset guard now routes to the new-password screen.
      } else {
        await verifyOtp(email || "", value);
        // Session arrives via onAuthStateChange → root guard routes to onboarding.
      }
    } catch (e: any) {
      // Too few digits is the likely cause — say so instead of "invalid code".
      showError(value.length < OTP_LENGTH ? `Enter all ${OTP_LENGTH} digits from the email.` : e, "Verification failed");
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  const onChange = (t: string) => {
    const next = t.replace(/[^0-9]/g, "").slice(0, MAX_LENGTH);
    setCode(next);
    if (next.length === OTP_LENGTH) verify(next); // last digit in → go
  };

  const resend = async () => {
    try {
      if (isRecovery) {
        await forgotPassword(email || "");
      } else {
        await resendOtp(email || "");
      }
      setCode(""); // the previous code is void once a new one is sent
      inputRef.current?.focus();
      if (Platform.OS === "web") toast("success", "Code sent", "A new verification code is on its way.");
      else Alert.alert("Code sent", "A new verification code is on its way.");
    } catch (e: any) {
      showError(e, "Couldn't resend");
    }
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => safeBack(router, isRecovery ? "/forgot-password" : "/signup")} style={styles.backBtn} activeOpacity={0.7}>
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
            We sent {ARTICLE} {OTP_LENGTH}-digit code to{"\n"}
            <Text style={styles.email}>{email}</Text>
          </Text>

          <TouchableOpacity activeOpacity={1} onPress={() => inputRef.current?.focus()} style={styles.boxes}>
            {digits.map((d, i) => {
              const filled = d.trim() !== "";
              const active = i === code.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.box,
                    (filled || active) && styles.boxActive,
                    GROUP_AFTER > 0 && i === GROUP_AFTER - 1 && styles.boxGroupEnd,
                  ]}
                >
                  <Text style={styles.boxText}>{d.trim()}</Text>
                </View>
              );
            })}
          </TouchableOpacity>
          <Text style={styles.counter}>
            {code.length === 0 ? `Enter all ${OTP_LENGTH} digits from the email` : `${code.length} of ${OTP_LENGTH} digits`}
          </Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            style={styles.hiddenInput}
            autoFocus
            maxLength={MAX_LENGTH}
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
            onPress={() => verify()}
            loading={loading}
            disabled={code.length < MIN_LENGTH}
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
  boxes: { flexDirection: "row", gap: 6, marginTop: spacing.xxl },
  box: { flex: 1, aspectRatio: 0.82, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  boxActive: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
  boxGroupEnd: { marginRight: spacing.sm },
  boxText: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  counter: { color: colors.textMuted, fontSize: font.small, textAlign: "center", marginTop: spacing.md, fontVariant: ["tabular-nums"] },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  resendRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.xl },
  resendText: { color: colors.textDim, fontSize: font.small },
  resendLink: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
});

import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing, radius, font } from "../../theme";
import { showError, friendlyMessage } from "../../lib/errors";
import { toast } from "../../lib/toast";
import { webMaxWidth } from "../../lib/responsive";
import { safeBack } from "../../lib/nav";

// The emailed code's length is a Supabase project setting (6–10 digits) that
// the app can't read — so this screen deliberately never assumes one. One plain
// field, no fixed slots, no digit count in the copy: whatever length the email
// carries, the user just types or pastes what they see.
const MIN_LENGTH = 6;  // shortest code Supabase can issue
const MAX_LENGTH = 10; // longest

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { verifyOtp, resendOtp, verifyRecovery, forgotPassword } = useAuthStore();
  const { email, mode } = useLocalSearchParams<{ email: string; mode?: string }>();
  const isRecovery = mode === "recovery";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(true); // the field auto-focuses
  const inputRef = useRef<TextInput>(null);
  const submitting = useRef(false); // Enter key + button tap must not double-fire

  const verify = async () => {
    if (submitting.current || code.length < MIN_LENGTH) return;
    submitting.current = true;
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
      // A wrong/incomplete/expired code all come back as the same server error —
      // point at the two things the person can actually do about it.
      const invalid = /invalid or has expired/i.test(friendlyMessage(e));
      showError(invalid ? "That code didn't work. Check every digit, or tap Resend." : e, "Verification failed");
    } finally {
      setLoading(false);
      submitting.current = false;
    }
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
            We sent a verification code to{"\n"}
            <Text style={styles.email}>{email}</Text>
          </Text>

          <Text style={styles.label}>Verification code</Text>
          <View style={[styles.field, focused && styles.fieldFocused]}>
            <TextInput
              ref={inputRef}
              value={code}
              // No maxLength prop on purpose: it would cut pasted text like "4829 1736 90"
              // BEFORE the spaces are stripped and drop real digits. Strip first, then cap.
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, MAX_LENGTH))}
              placeholder="Enter code"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={verify}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              accessibilityLabel="Verification code"
              style={[styles.input, code.length > 0 && styles.inputFilled]}
            />
          </View>
          <Text style={styles.helper}>
            {code.length === 0
              ? "Type or paste the full code exactly as it appears in the email."
              : `${code.length} digit${code.length === 1 ? "" : "s"} entered`}
          </Text>

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
  label: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold, marginTop: spacing.xxl, marginBottom: spacing.sm },
  field: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md },
  fieldFocused: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
  // outlineStyle: the wrapper's gold border is the focus indicator; without this
  // the browser adds a second white ring inside it (web only, ignored on native).
  input: { color: colors.text, fontSize: font.title, fontWeight: font.semibold, textAlign: "center", paddingVertical: spacing.lg, fontVariant: ["tabular-nums"], ...({ outlineStyle: "none" } as any) },
  // typed digits: big and spaced out so they're easy to compare against the email
  inputFilled: { fontSize: font.h1, fontWeight: font.heavy, letterSpacing: 8, paddingLeft: 8 },
  helper: { color: colors.textMuted, fontSize: font.small, textAlign: "center", marginTop: spacing.md },
  resendRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.xl },
  resendText: { color: colors.textDim, fontSize: font.small },
  resendLink: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
});

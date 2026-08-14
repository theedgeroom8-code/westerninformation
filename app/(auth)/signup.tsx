import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { Button } from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";
import { isValidEmail, isValidPhone, isValidName, passwordStrength } from "../../lib/validate";
import { PasswordMeter } from "../../components/PasswordMeter";
import { webMaxWidth } from "../../lib/responsive";

export default function SignupScreen() {
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [ageOk, setAgeOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const onContinue = async () => {
    if (!ageOk) { showError("You must confirm you are 21 or older to continue.", "Age confirmation required"); return; }
    if (!isValidName(name)) { showError("Enter your full name (at least 2 characters).", "Check your name"); return; }
    if (!isValidEmail(email)) { showError("That doesn't look like a valid email address.", "Check your email"); return; }
    if (!isValidPhone(phone)) { showError("That doesn't look like a valid mobile number.", "Check your number"); return; }
    const pw = passwordStrength(password);
    if (!pw.ok) { showError(pw.hint || "Use at least 8 characters with letters and numbers.", "Weak password"); return; }
    setLoading(true);
    try {
      const outcome = await signup(name, email, phone, password);
      if (outcome === "needs_otp") {
        router.push({ pathname: "/verify-otp", params: { email: email.trim() } });
      }
      // "verified" → root guard routes straight to onboarding.
    } catch (e: any) {
      showError(e, "Sign up failed");
    } finally {
      setLoading(false);
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
        <ScrollView contentContainerStyle={[styles.scroll, webMaxWidth(460)]} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Create account</Text>
          <Text style={styles.sub}>Start tracking your edges in minutes</Text>

          <View style={{ height: spacing.xl }} />

          <TextField label="Full name" value={name} onChangeText={setName} placeholder="Jordan Carter" icon="person-outline" autoCapitalize="words" />
          <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@email.com" icon="mail-outline" keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Mobile number" value={phone} onChangeText={setPhone} placeholder="+1 555 123 4567" icon="call-outline" keyboardType="phone-pad" />
          <TextField label="Password" value={password} onChangeText={setPassword} placeholder="Create a password" icon="lock-closed-outline" secure />
          <PasswordMeter password={password} />

          {/* 21+ age gate */}
          <TouchableOpacity style={styles.checkRow} onPress={() => setAgeOk((v) => !v)} activeOpacity={0.75}>
            <View style={[styles.checkbox, ageOk && styles.checkboxOn]}>
              {ageOk && <Ionicons name="checkmark" size={15} color={colors.ink} />}
            </View>
            <Text style={styles.checkText}>
              I confirm I am <Text style={styles.checkStrong}>21 years or older</Text> and agree to the Terms & Privacy Policy.
            </Text>
          </TouchableOpacity>

          <View style={styles.disclaimer}>
            <Ionicons name="shield-outline" size={14} color={colors.textMuted} />
            <Text style={styles.disclaimerText}>
              Western Information Network provides sports market information for educational purposes only. It never holds funds or processes transactions.
            </Text>
          </View>

          <Button label="Continue" icon="arrow-forward" onPress={onContinue} loading={loading} disabled={!ageOk} />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, marginTop: 4 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.lg },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkText: { flex: 1, color: colors.textDim, fontSize: font.small, lineHeight: 20 },
  checkStrong: { color: colors.text, fontWeight: font.bold },
  disclaimer: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: spacing.xl, paddingHorizontal: spacing.xs },
  disclaimerText: { flex: 1, color: colors.textMuted, fontSize: font.caption, lineHeight: 17 },
  footer: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.xl },
  footerText: { color: colors.textDim, fontSize: font.body },
  footerLink: { color: colors.gold, fontSize: font.body, fontWeight: font.bold },
});

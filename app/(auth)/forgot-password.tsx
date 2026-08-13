import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { Button } from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";
import { isValidEmail } from "../../lib/validate";
import { webMaxWidth } from "../../lib/responsive";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const onSend = async () => {
    if (!isValidEmail(email)) { showError("That doesn't look like a valid email address.", "Check your email"); return; }
    setLoading(true);
    try {
      await forgotPassword(email);
      router.push({ pathname: "/verify-otp", params: { email: email.trim(), mode: "recovery" } });
    } catch (e: any) {
      showError(e, "Couldn't send reset code");
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
        <View style={[styles.body, webMaxWidth(460)]}>
          <View style={styles.badge}>
            <Ionicons name="key-outline" size={28} color={colors.gold} />
          </View>
          <Text style={styles.heading}>Reset your password</Text>
          <Text style={styles.sub}>
            Enter the email you signed up with. We'll send a 6-digit code to verify it's you.
          </Text>

          <View style={{ height: spacing.xl }} />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            icon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Button label="Send Code" icon="paper-plane-outline" onPress={onSend} loading={loading} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.sm },
});

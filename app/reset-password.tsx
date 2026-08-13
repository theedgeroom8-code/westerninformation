import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { TextField } from "../components/TextField";
import { Button } from "../components/Button";
import { PasswordMeter } from "../components/PasswordMeter";
import { useAuthStore } from "../store/authStore";
import { colors, spacing, radius, font } from "../theme";
import { showError } from "../lib/errors";
import { passwordStrength } from "../lib/validate";
import { toast } from "../lib/toast";
import { webMaxWidth } from "../lib/responsive";

/** Shown after a verified password-recovery code. The router guard
 *  (pendingPasswordReset) keeps the rest of the app out of reach until the
 *  new password is saved. */
export default function ResetPasswordScreen() {
  const completePasswordReset = useAuthStore((s) => s.completePasswordReset);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSave = async () => {
    const pw = passwordStrength(password);
    if (!pw.ok) { showError(pw.hint || "Use at least 8 characters with letters and numbers.", "Weak password"); return; }
    if (password !== confirm) { showError("The two passwords don't match.", "Check passwords"); return; }
    setLoading(true);
    try {
      await completePasswordReset(password);
      if (Platform.OS === "web") toast("success", "Password updated", "You're signed in with your new password.");
      else Alert.alert("Password updated", "You're signed in with your new password.");
    } catch (e: any) {
      showError(e, "Couldn't update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.body, webMaxWidth(460)]}>
          <View style={styles.badge}>
            <Ionicons name="lock-closed" size={28} color={colors.gold} />
          </View>
          <Text style={styles.heading}>Set a new password</Text>
          <Text style={styles.sub}>Your identity is verified. Choose a new password to finish.</Text>

          <View style={{ height: spacing.xl }} />
          <TextField label="New password" value={password} onChangeText={setPassword}
            placeholder="Create a new password" icon="lock-closed-outline" secure />
          <PasswordMeter password={password} />
          <TextField label="Confirm password" value={confirm} onChangeText={setConfirm}
            placeholder="Type it again" icon="lock-closed-outline" secure />

          <Button label="Save & Continue" icon="checkmark-circle" onPress={onSave} loading={loading} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.sm },
});

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
import { webMaxWidth } from "../../lib/responsive";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    if (!email.trim() || !password) { showError("Enter your email and password.", "Missing details"); return; }
    setLoading(true);
    try {
      await login(email, password);
      // Root guard routes into the app automatically.
    } catch (e: any) {
      showError(e, "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const onForgot = () => router.push("/forgot-password");

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, webMaxWidth(460)]} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="flash" size={32} color={colors.ink} />
            </View>
            <Text style={styles.appName}>Edge System</Text>
            <Text style={styles.tagline}>Find the edge. Track the results.</Text>
          </View>

          <View>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.sub}>Sign in to your account</Text>

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
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              icon="lock-closed-outline"
              secure
            />

            <TouchableOpacity style={styles.forgot} activeOpacity={0.7} onPress={onForgot}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <Button label="Sign In" icon="log-in-outline" onPress={onLogin} loading={loading} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity onPress={() => router.push("/signup")} activeOpacity={0.7}>
              <Text style={styles.footerLink}>Create one</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  brand: { alignItems: "center", marginBottom: spacing.xxxl },
  logo: {
    width: 72, height: 72, borderRadius: radius.xl, backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.lg,
  },
  appName: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  tagline: { color: colors.textDim, fontSize: font.small, marginTop: 4 },
  heading: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.body, marginTop: 4 },
  forgot: { alignSelf: "flex-end", marginBottom: spacing.xl },
  forgotText: { color: colors.gold, fontSize: font.small, fontWeight: font.semibold },
  footer: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.xxl },
  footerText: { color: colors.textDim, fontSize: font.body },
  footerLink: { color: colors.gold, fontSize: font.body, fontWeight: font.bold },
});

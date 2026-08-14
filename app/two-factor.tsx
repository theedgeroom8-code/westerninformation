import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { supabase } from "../lib/supabase";
import { colors, spacing, radius, font } from "../theme";
import { showError } from "../lib/errors";
import { toast, confirmAction } from "../lib/toast";
import { webMaxWidth } from "../lib/responsive";
import { safeBack } from "../lib/nav";

type Stage = "loading" | "enabled" | "setup" | "verify";

/** Two-factor authentication management (Settings → Security).
 *  Enroll: TOTP secret + QR → verify a live code → future logins require it. */
export default function TwoFactorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { showError(error); safeBack(router, "/settings"); return; }
    const active = data?.totp?.find((f) => f.status === "verified");
    if (active) {
      setFactorId(active.id);
      setStage("enabled");
    } else {
      setStage("setup");
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      // clear any half-finished enrollment first
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: enroll, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Western Information Network",
      });
      if (error) throw new Error(error.message);
      setFactorId(enroll.id);
      setQr(enroll.totp.qr_code);
      setSecret(enroll.totp.secret);
      setStage("verify");
    } catch (e: any) {
      showError(e, "Couldn't start setup");
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!factorId || code.length < 6) return;
    setBusy(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr) throw new Error(cErr.message);
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
      if (vErr) throw new Error(vErr.message);
      setCode("");
      setStage("enabled");
      if (Platform.OS === "web") toast("success", "2FA enabled", "Your account now requires an authenticator code at sign-in.");
      else Alert.alert("2FA enabled", "Your account now requires an authenticator code at sign-in.");
    } catch (e: any) {
      showError(e, "Code didn't match");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!factorId) return;
    if (!(await confirmAction("Disable 2FA", "Your account will no longer require an authenticator code to sign in."))) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw new Error(error.message);
      setFactorId(null);
      setStage("setup");
      if (Platform.OS === "web") toast("success", "2FA disabled", "Authenticator codes are no longer required.");
      else Alert.alert("2FA disabled", "Authenticator codes are no longer required.");
    } catch (e: any) {
      showError(e, "Couldn't disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }, webMaxWidth(560)]}>
        <TouchableOpacity onPress={() => safeBack(router, "/settings")} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Two-Factor Auth</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(560)]}>
        {stage === "loading" && <ActivityIndicator color={colors.gold} style={{ marginTop: 60 }} />}

        {stage === "enabled" && (
          <View style={styles.card}>
            <View style={[styles.iconBadge, { backgroundColor: colors.greenSoft }]}>
              <Ionicons name="shield-checkmark" size={30} color={colors.green} />
            </View>
            <Text style={styles.title}>2FA is on</Text>
            <Text style={styles.body}>
              Signing in requires your password plus a 6-digit code from your authenticator app. This protects your account even if the password leaks.
            </Text>
            <TouchableOpacity style={styles.dangerBtn} onPress={disable} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.dangerText}>{busy ? "Working…" : "Disable 2FA"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === "setup" && (
          <View style={styles.card}>
            <View style={styles.iconBadge}>
              <Ionicons name="shield-outline" size={30} color={colors.gold} />
            </View>
            <Text style={styles.title}>Protect your account</Text>
            <Text style={styles.body}>
              Add a second lock to your sign-in: your password plus a rotating 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password…).
            </Text>
            <Button label="Set Up 2FA" icon="qr-code-outline" onPress={startEnroll} loading={busy} />
          </View>
        )}

        {stage === "verify" && (
          <View style={styles.card}>
            <Text style={styles.title}>Scan, then confirm</Text>
            <Text style={styles.body}>1. Scan this QR code with your authenticator app:</Text>
            {qr && (
              <View style={styles.qrWrap}>
                <SvgXml xml={qr} width={190} height={190} />
              </View>
            )}
            {secret && (
              <>
                <Text style={styles.body}>Or enter this key manually:</Text>
                <View style={styles.secretBox}>
                  <Text style={styles.secretText} selectable>{secret}</Text>
                </View>
              </>
            )}
            <Text style={[styles.body, { marginTop: spacing.md }]}>2. Enter the 6-digit code it shows:</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor={colors.textMuted}
              maxLength={6}
            />
            <Button label="Activate 2FA" icon="checkmark-circle" onPress={activate} loading={busy} disabled={code.length < 6} />
          </View>
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerTitle: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, alignItems: "center", marginTop: spacing.lg },
  iconBadge: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, textAlign: "center" },
  body: { color: colors.textDim, fontSize: font.body, lineHeight: 22, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.md },
  qrWrap: { backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.md },
  secretBox: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  secretText: { color: colors.gold, fontSize: font.small, fontWeight: font.bold, letterSpacing: 1 },
  codeInput: {
    backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    color: colors.text, fontSize: font.h2, fontWeight: font.heavy, letterSpacing: 10, textAlign: "center",
    paddingVertical: spacing.md, alignSelf: "stretch", marginBottom: spacing.lg,
  },
  dangerBtn: { backgroundColor: colors.redSoft, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: spacing.xxl, marginTop: spacing.md },
  dangerText: { color: colors.red, fontSize: font.body, fontWeight: font.bold },
});

import React from "react";
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBettingStore } from "../store/bettingStore";
import { useAuthStore } from "../store/authStore";
import { registerForPush, unregisterPush } from "../lib/notifications";
import { enableWebNotifications } from "../lib/webNotify";
import { showError } from "../lib/errors";
import { toast } from "../lib/toast";
import { webMaxWidth } from "../lib/responsive";
import { Screen } from "../components/Screen";

// Cross-platform info dialog — RN-web's Alert is a silent no-op.
const notice = (title: string, message: string) => {
  if (Platform.OS === "web") toast("info", title, message);
  else Alert.alert(title, message);
};
import { FadeIn } from "../components/FadeIn";
import { colors, spacing, radius, font, shadow } from "../theme";

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons name={icon as any} size={14} color={colors.gold} />
      <Text style={styles.sectionTitle}>{label}</Text>
    </View>
  );
}

const fmtHour = (h: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${period}`;
};

function HourStepper({ label, value, onChange }: { label: string; value: number; onChange: (h: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity onPress={() => onChange((value + 23) % 24)} style={styles.stepBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-down" size={16} color={colors.textDim} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{fmtHour(value)}</Text>
        <TouchableOpacity onPress={() => onChange((value + 1) % 24)} style={styles.stepBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-up" size={16} color={colors.textDim} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useBettingStore();
  const user = useAuthStore((s) => s.user);

  const onPushToggle = async (enabled: boolean) => {
    await updateSettings({ pushAlerts: enabled });
    if (!user?.id) return;
    if (enabled) {
      if (Platform.OS === "web") {
        const result = await enableWebNotifications();
        if (result === "granted") {
          toast("success", "Notifications on", "You'll get browser notifications for new edges while this site is open in any tab.");
        } else if (result === "denied") {
          toast("error", "Blocked by browser", "Allow notifications for this site in your browser settings, then try again.");
        } else {
          toast("info", "Not supported here", "This browser doesn't support notifications — alerts still appear live on the Alerts tab.");
        }
        return;
      }
      const result = await registerForPush(user.id);
      if (result.status === "unsupported") {
        showError(result.reason, "Push not active yet");
      } else if (result.status === "denied") {
        showError("Enable notifications for this app in your phone's settings.", "Permission needed");
      }
    } else {
      unregisterPush(user.id);
    }
  };

  const ToggleRow = ({ icon, label, sub, value, onChange, last }: {
    icon: string; label: string; sub: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
  }) => (
    <View style={[styles.toggleRow, !last && styles.border]}>
      <View style={styles.toggleIcon}>
        <Ionicons name={icon as any} size={18} color={colors.textDim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabelSm}>{label}</Text>
        <Text style={styles.rowSubSm}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceHi, true: "rgba(245,184,65,0.4)" }}
        thumbColor={value ? colors.gold : colors.textMuted}
        ios_backgroundColor={colors.surfaceHi}
      />
    </View>
  );

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }, webMaxWidth(680)]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(680)]}>
        {/* Bet sizing — the user's own risk preference */}
        <FadeIn delay={0}>
          <SectionTitle icon="calculator" label="BET SIZING" />
          <View style={styles.card}>
            <Text style={styles.rowLabel}>Risk Level (Kelly Fraction)</Text>
            <Text style={styles.rowSub}>How aggressively wagers are sized to your bankroll</Text>
            <View style={styles.options}>
              {[
                { v: 10, t: "Conservative" }, { v: 15, t: "" }, { v: 20, t: "" },
                { v: 25, t: "Recommended" }, { v: 33, t: "Aggressive" },
              ].map((opt) => (
                <TouchableOpacity key={opt.v} onPress={() => updateSettings({ kellyFraction: opt.v })}
                  style={[styles.chip, settings.kellyFraction === opt.v && styles.chipActive]} activeOpacity={0.8}>
                  <Text style={[styles.chipText, settings.kellyFraction === opt.v && styles.chipTextActive]}>{opt.v}%</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </FadeIn>

        {/* Notifications — delivery channels */}
        <FadeIn delay={80}>
          <SectionTitle icon="notifications" label="ALERT DELIVERY" />
          <View style={styles.card}>
            <ToggleRow icon="notifications-outline" label="Push Notifications"
              sub={Platform.OS === "web" ? "Browser notifications for new edges" : "Alert your phone even when the app is closed"}
              value={settings.pushAlerts} onChange={onPushToggle} />
            <ToggleRow icon="chatbox-ellipses-outline" label="SMS Alerts" sub="Also send edge alerts by text message"
              value={settings.smsAlerts} onChange={(v) => updateSettings({ smsAlerts: v })} />
            {/* In-app alerts are the realtime inbox — always available */}
            <View style={[styles.toggleRow, styles.border]}>
              <View style={styles.toggleIcon}>
                <Ionicons name="phone-portrait-outline" size={18} color={colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabelSm}>In-App Alerts</Text>
                <Text style={styles.rowSubSm}>Live alerts inside the app, on the Alerts tab</Text>
              </View>
              <View style={styles.alwaysPill}><Text style={styles.alwaysText}>ALWAYS ON</Text></View>
            </View>
            {!settings.pushAlerts && !settings.smsAlerts && (
              <View style={styles.inAppNote}>
                <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                <Text style={styles.inAppNoteText}>
                  With push and SMS off, you'll only see alerts while the app is open.
                </Text>
              </View>
            )}
          </View>

          <SectionTitle icon="options" label="ALERT RULES" />
          <View style={styles.card}>
            <ToggleRow icon="flame-outline" label="High-Edge Priority" sub="Louder alert for exceptional edges"
              value={settings.highEdgeAlerts} onChange={(v) => updateSettings({ highEdgeAlerts: v })} />
            <ToggleRow icon="moon-outline" label="Quiet Hours" sub="Pause alerts overnight"
              value={settings.quietHoursEnabled} onChange={(v) => updateSettings({ quietHoursEnabled: v })} last={!settings.quietHoursEnabled} />
            {settings.quietHoursEnabled && (
              <View style={styles.quietBox}>
                <HourStepper label="From" value={settings.quietStart} onChange={(h) => updateSettings({ quietStart: h })} />
                <View style={styles.quietDivider} />
                <HourStepper label="To" value={settings.quietEnd} onChange={(h) => updateSettings({ quietEnd: h })} />
              </View>
            )}
          </View>
        </FadeIn>

        {/* Security */}
        <FadeIn delay={160}>
          <SectionTitle icon="lock-closed" label="SECURITY" />
          <View style={styles.card}>
            {Platform.OS !== "web" && (
              <ToggleRow icon="finger-print-outline" label="Biometric Unlock" sub="Require Face ID / fingerprint to open"
                value={settings.biometricUnlock} onChange={(v) => updateSettings({ biometricUnlock: v })} />
            )}
            <TouchableOpacity style={[styles.toggleRow]} activeOpacity={0.7} onPress={() => router.push("/two-factor" as any)}>
              <View style={styles.toggleIcon}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabelSm}>Two-Factor Authentication</Text>
                <Text style={styles.rowSubSm}>Require an authenticator code at sign-in</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </FadeIn>

        {/* Legal */}
        <FadeIn delay={240}>
          <SectionTitle icon="document-text" label="LEGAL" />
          <View style={styles.card}>
            <TouchableOpacity style={[styles.linkRow, styles.border]} activeOpacity={0.7}
              onPress={() => notice("Terms of Service", "This app detects betting edges and is not gambling advice. It does not place bets. Full terms provided at launch.")}>
              <Ionicons name="reader-outline" size={18} color={colors.textDim} />
              <Text style={styles.linkLabel}>Terms of Service</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}
              onPress={() => notice("Privacy Policy", "We store your account and bet-tracking data only. No real money is held. Full policy provided at launch.")}>
              <Ionicons name="shield-outline" size={18} color={colors.textDim} />
              <Text style={styles.linkLabel}>Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.disclaimer}>
            <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
            <Text style={styles.disclaimerText}>
              21+ only. This app does not place bets or hold money. Bankroll figures are for tracking your own records.
            </Text>
          </View>
        </FadeIn>

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
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm, marginTop: spacing.lg, marginLeft: spacing.xs },
  sectionTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  rowLabel: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  rowSub: { color: colors.textMuted, fontSize: font.small, marginTop: 3, marginBottom: spacing.md },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontSize: font.small, fontWeight: font.bold },
  chipTextActive: { color: colors.ink },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  toggleIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowLabelSm: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  rowSubSm: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  quietBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  quietDivider: { width: 1, height: 40, backgroundColor: colors.hairline, marginHorizontal: spacing.md },
  stepper: { flex: 1, alignItems: "center" },
  stepperLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.semibold, marginBottom: 6 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  stepperValue: { color: colors.text, fontSize: font.body, fontWeight: font.bold, minWidth: 78, textAlign: "center" },
  soonPill: { backgroundColor: colors.surfaceHi, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  soonText: { color: colors.textDim, fontSize: 10, fontWeight: font.bold, letterSpacing: 0.5 },
  alwaysPill: { backgroundColor: colors.greenSoft, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  alwaysText: { color: colors.green, fontSize: 10, fontWeight: font.bold, letterSpacing: 0.5 },
  inAppNote: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: spacing.md },
  inAppNoteText: { flex: 1, color: colors.textMuted, fontSize: font.caption, lineHeight: 16 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  linkLabel: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  disclaimer: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  disclaimerText: { flex: 1, color: colors.textMuted, fontSize: font.caption, lineHeight: 17 },
});

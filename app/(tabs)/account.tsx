import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { useBettingStore } from "../../store/bettingStore";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FadeIn } from "../../components/FadeIn";
import { confirmAction, toast } from "../../lib/toast";
import { webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font, shadow } from "../../theme";

// Cross-platform info dialog — RN-web's Alert is a silent no-op.
const notice = (title: string, message: string) => {
  if (Platform.OS === "web") toast("info", title, message);
  else Alert.alert(title, message);
};

function MenuRow({ icon, label, value, onPress, danger }: {
  icon: string; label: string; value?: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.redSoft }]}>
        <Ionicons name={icon as any} size={18} color={danger ? colors.red : colors.gold} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.red }]}>{label}</Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {!danger && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
    </TouchableOpacity>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { user, isAdmin, logout } = useAuthStore();
  const { bankroll, bets, settings } = useBettingStore();

  const resolved = bets.filter((b) => b.result);
  const wins = bets.filter((b) => b.result === "win").length;
  const decided = wins + bets.filter((b) => b.result === "loss").length;
  const winRate = decided > 0 ? Math.round((wins / decided) * 100) : 0;
  const initials = (user?.name || "B").slice(0, 2).toUpperCase();

  // confirmAction works on web too — Alert-button dialogs are silently
  // swallowed by react-native-web (this was the "logout does nothing" bug).
  const confirmLogout = async () => {
    if (await confirmAction("Sign out", "Are you sure you want to sign out?")) logout();
  };

  return (
    <Screen>
      <Header maxWidth={700} title="Account" subtitle="Profile & preferences" icon="person-circle" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(700)]}>

        <FadeIn delay={0}>
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.name}>{user?.name || "Member"}</Text>
            <Text style={styles.email}>{user?.email || "demo@edgesystem.io"}</Text>

            <View style={styles.profileStats}>
              <View style={styles.pStat}>
                <Text style={styles.pStatVal}>${(bankroll / 1000).toFixed(1)}k</Text>
                <Text style={styles.pStatLabel}>Bankroll</Text>
              </View>
              <View style={styles.pDiv} />
              <View style={styles.pStat}>
                <Text style={styles.pStatVal}>{resolved.length}</Text>
                <Text style={styles.pStatLabel}>Plays</Text>
              </View>
              <View style={styles.pDiv} />
              <View style={styles.pStat}>
                <Text style={styles.pStatVal}>{winRate}%</Text>
                <Text style={styles.pStatLabel}>Win Rate</Text>
              </View>
            </View>
          </View>
        </FadeIn>

        <FadeIn delay={80}>
          <Text style={styles.section}>PREFERENCES</Text>
          <View style={styles.card}>
            <MenuRow icon="options" label="Position Sizing & Risk" value={`${settings.kellyFraction}% Kelly`} onPress={() => router.push("/settings")} />
            <View style={styles.divider} />
            <MenuRow
              icon="notifications"
              label="Alerts"
              value={settings.pushAlerts ? "Push on" : settings.smsAlerts ? "SMS on" : "In-app only"}
              onPress={() => router.push("/settings")}
            />
            <View style={styles.divider} />
            <MenuRow icon="lock-closed" label="Security" value={settings.biometricUnlock ? "Biometric" : "Off"} onPress={() => router.push("/settings")} />
          </View>
        </FadeIn>

        {isAdmin && Platform.OS === "web" && (
          <FadeIn delay={120}>
            <Text style={styles.section}>ADMINISTRATION</Text>
            <View style={styles.card}>
              <MenuRow icon="shield-checkmark" label="Admin Console" onPress={() => router.push("/admin" as any)} />
            </View>
          </FadeIn>
        )}

        <FadeIn delay={160}>
          <Text style={styles.section}>SUPPORT</Text>
          <View style={styles.card}>
            <MenuRow icon="help-circle" label="Help & FAQ" onPress={() => notice("Help", "Support center is on the roadmap. For now, contact your administrator.")} />
            <View style={styles.divider} />
            <MenuRow icon="document-text" label="Terms & Privacy" onPress={() => notice("Legal", "Western Information Network provides sports market information for educational purposes only. It never holds funds or processes transactions.")} />
            <View style={styles.divider} />
            <MenuRow icon="information-circle" label="About" value="v1.0" onPress={() => notice("Western Information Network", "Version 1.0 · Live odds engine connected.")} />
          </View>
        </FadeIn>

        <FadeIn delay={240}>
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <MenuRow icon="log-out" label="Sign Out" onPress={confirmLogout} danger />
          </View>
        </FadeIn>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  profile: {
    alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border, ...shadow.soft, marginBottom: spacing.lg,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  avatarText: { color: colors.ink, fontSize: font.h2, fontWeight: font.heavy },
  name: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  email: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  profileStats: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    width: "100%", marginTop: spacing.lg, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  pStat: { alignItems: "center", flex: 1 },
  pStatVal: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  pStatLabel: { color: colors.textDim, fontSize: font.caption, marginTop: 2 },
  pDiv: { width: 1, height: 30, backgroundColor: colors.hairline },
  section: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginBottom: spacing.sm, marginTop: spacing.lg, marginLeft: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  rowValue: { color: colors.textDim, fontSize: font.small, marginRight: 4 },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginLeft: 64 },
});

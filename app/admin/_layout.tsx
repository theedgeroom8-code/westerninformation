import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, ScrollView, useWindowDimensions } from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { Button } from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { friendlyMessage } from "../../lib/errors";
import { colors, spacing, radius, font } from "../../theme";

const NAV = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/edges", label: "Edges", icon: "flash" },
  { href: "/admin/users", label: "Users", icon: "people" },
  { href: "/admin/bets", label: "Bets", icon: "receipt" },
  { href: "/admin/broadcast", label: "Broadcast", icon: "megaphone" },
  { href: "/admin/config", label: "Config", icon: "options" },
] as const;

function AdminLogin() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setLoading(true);
    setError("");
    try {
      await login(email, password);
    } catch (e: any) {
      setError(friendlyMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.loginWrap}>
        <View style={styles.loginCard}>
          <View style={styles.loginBadge}>
            <Ionicons name="shield-half" size={26} color={colors.gold} />
          </View>
          <Text style={styles.loginTitle}>Admin Console</Text>
          <Text style={styles.loginSub}>Authorized personnel only</Text>
          <View style={{ height: spacing.xl }} />
          <TextField label="Email" value={email} onChangeText={setEmail} placeholder="admin@edgesystem.io" icon="mail-outline" autoCapitalize="none" keyboardType="email-address" />
          <TextField label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" icon="lock-closed-outline" secure />
          {!!error && <Text style={styles.loginError}>{error}</Text>}
          <Button label="Sign In" icon="log-in-outline" onPress={onLogin} loading={loading} />
        </View>
      </View>
    </Screen>
  );
}

function NavItem({ item, active, expanded, onPress }: {
  item: (typeof NAV)[number]; active: boolean; expanded: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      style={[styles.navItem, active && styles.navItemActive, !expanded && styles.navItemCollapsed]}
    >
      <Ionicons
        name={(active ? item.icon : `${item.icon}-outline`) as any}
        size={19}
        color={active ? colors.gold : colors.textDim}
      />
      {expanded && <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>}
      {active && <View style={styles.activeRail} />}
    </TouchableOpacity>
  );
}

export default function AdminLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { ready, isAuthenticated, isAdmin, user, logout } = useAuthStore();

  const wide = width >= 1024;
  const sidebarExpanded = width >= 1240;

  // Hard block on native — the admin console exists only on the web.
  if (Platform.OS !== "web") {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="globe-outline" size={40} color={colors.textMuted} />
          <Text style={styles.blockText}>Not available in the app.</Text>
        </View>
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen>
        <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>
      </Screen>
    );
  }

  if (!isAuthenticated) return <AdminLogin />;

  if (!isAdmin) {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={40} color={colors.red} />
          <Text style={styles.blockText}>This account is not authorized for the admin console.</Text>
          <TouchableOpacity onPress={logout} style={{ marginTop: spacing.md }} activeOpacity={0.8}>
            <Text style={{ color: colors.gold, fontWeight: font.bold }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const initials = (user?.name || user?.email || "A").slice(0, 2).toUpperCase();

  return (
    <Screen>
      <View style={styles.shell}>
        {/* ---------- Sidebar (wide screens) ---------- */}
        {wide && (
          <View style={[styles.sidebar, !sidebarExpanded && styles.sidebarCollapsed]}>
            <View style={[styles.brandRow, !sidebarExpanded && { justifyContent: "center" }]}>
              <View style={styles.brandBadge}>
                <Ionicons name="flash" size={16} color={colors.ink} />
              </View>
              {sidebarExpanded && (
                <View>
                  <Text style={styles.brandText}>Western Information Network</Text>
                  <Text style={styles.brandSub}>ADMIN CONSOLE</Text>
                </View>
              )}
            </View>

            <View style={styles.navList}>
              {NAV.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={pathname === item.href}
                  expanded={sidebarExpanded}
                  onPress={() => router.push(item.href as any)}
                />
              ))}
            </View>

            <View style={{ flex: 1 }} />

            {/* account + sign out — spatially separated from nav */}
            <View style={styles.sidebarFooter}>
              <View style={[styles.accountRow, !sidebarExpanded && { justifyContent: "center" }]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
                {sidebarExpanded && (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountName} numberOfLines={1}>{user?.name || "Admin"}</Text>
                    <Text style={styles.accountEmail} numberOfLines={1}>{user?.email}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={logout} style={styles.signOutBtn} activeOpacity={0.8} accessibilityLabel="Sign out">
                <Ionicons name="log-out-outline" size={16} color={colors.red} />
                {sidebarExpanded && <Text style={styles.signOutText}>Sign out</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ---------- Main column ---------- */}
        <View style={{ flex: 1 }}>
          {/* Narrow screens: top bar + horizontal nav */}
          {!wide && (
            <>
              <View style={styles.topBar}>
                <View style={styles.brandRow}>
                  <View style={styles.brandBadge}>
                    <Ionicons name="flash" size={16} color={colors.ink} />
                  </View>
                  <Text style={styles.brandText}>Admin</Text>
                </View>
                <TouchableOpacity onPress={logout} style={styles.signOutBtn} activeOpacity={0.8}>
                  <Ionicons name="log-out-outline" size={16} color={colors.red} />
                  <Text style={styles.signOutText}>Sign out</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.topNav}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNavScroll}>
                  {NAV.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <TouchableOpacity key={item.href} onPress={() => router.push(item.href as any)}
                        style={[styles.topNavItem, active && styles.topNavItemActive]} activeOpacity={0.8}>
                        <Ionicons name={(active ? item.icon : `${item.icon}-outline`) as any} size={15} color={active ? colors.ink : colors.textDim} />
                        <Text style={[styles.topNavLabel, active && { color: colors.ink }]}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </>
          )}

          <View style={styles.page}>
            <View style={styles.pageInner}>
              <Slot />
            </View>
          </View>
        </View>
      </View>
      {/* Toasts render via the global host in the root layout. */}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  blockText: { color: colors.textDim, fontSize: font.body, textAlign: "center" },
  loginWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loginCard: {
    width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xxl, borderWidth: 1, borderColor: colors.border,
  },
  loginBadge: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  loginTitle: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy },
  loginSub: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  loginError: { color: colors.red, fontSize: font.small, marginBottom: spacing.md },

  shell: { flex: 1, flexDirection: "row" },
  sidebar: {
    width: 248,
    backgroundColor: "#0C111D",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  sidebarCollapsed: { width: 72, paddingHorizontal: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, marginBottom: spacing.xxl },
  brandBadge: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  brandText: { color: colors.text, fontSize: font.body, fontWeight: font.heavy },
  brandSub: { color: colors.textMuted, fontSize: 9, letterSpacing: 1, fontWeight: font.bold },
  navList: { gap: 2 },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 11, paddingHorizontal: spacing.md, borderRadius: radius.sm,
  },
  navItemCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  navItemActive: { backgroundColor: "rgba(245,184,65,0.10)" },
  activeRail: { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.gold },
  navLabel: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
  navLabelActive: { color: colors.gold, fontWeight: font.bold },
  sidebarFooter: { borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: spacing.md, gap: spacing.sm },
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceHi, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.gold, fontSize: 11, fontWeight: font.heavy },
  accountName: { color: colors.text, fontSize: font.caption, fontWeight: font.bold },
  accountEmail: { color: colors.textMuted, fontSize: 10 },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.redSoft },
  signOutText: { color: colors.red, fontSize: font.caption, fontWeight: font.bold },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#0C111D",
  },
  topNav: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#0C111D" },
  topNavScroll: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
  topNavItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  topNavItemActive: { backgroundColor: colors.gold },
  topNavLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },

  page: { flex: 1 },
  pageInner: { flex: 1, width: "100%", maxWidth: 1200, alignSelf: "center" },
});

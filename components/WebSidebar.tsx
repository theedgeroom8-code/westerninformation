import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../store/authStore";
import { confirmAction } from "../lib/toast";
import { colors, spacing, radius, font } from "../theme";

const NAV = [
  { href: "/", icon: "flash", label: "Edges" },
  { href: "/alerts", icon: "notifications", label: "Alerts" },
  { href: "/bets", icon: "receipt", label: "My Bets" },
  { href: "/bankroll", icon: "wallet", label: "Bankroll" },
  { href: "/account", icon: "person-circle", label: "Account" },
] as const;

/** Desktop-web navigation for the user app (≥1024px). Mirrors the bottom
 *  tab bar's destinations; the tab bar itself is hidden at this size. */
export function WebSidebar({ unread }: { unread: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAdmin, logout } = useAuthStore();
  const initials = (user?.name || "B").slice(0, 2).toUpperCase();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const onLogout = async () => {
    if (await confirmAction("Sign out", "Are you sure you want to sign out?")) logout();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Ionicons name="flash" size={20} color={colors.ink} />
        </View>
        <View>
          <Text style={styles.brandName}>Edge System</Text>
          <Text style={styles.brandSub}>Live edge tracker</Text>
        </View>
      </View>

      <View style={styles.nav}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <TouchableOpacity
              key={item.href}
              style={[styles.navItem, active && styles.navItemOn]}
              onPress={() => router.push(item.href as any)}
              activeOpacity={0.75}
            >
              {active && <View style={styles.rail} />}
              <View>
                <Ionicons
                  name={(active ? item.icon : `${item.icon}-outline`) as any}
                  size={19}
                  color={active ? colors.gold : colors.textDim}
                />
                {item.href === "/alerts" && unread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.navLabel, active && styles.navLabelOn]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      <View style={styles.footer}>
        {isAdmin && (
          <TouchableOpacity style={styles.footerBtn} onPress={() => router.push("/admin" as any)} activeOpacity={0.75}>
            <Ionicons name="shield-checkmark-outline" size={17} color={colors.gold} />
            <Text style={[styles.footerText, { color: colors.gold }]}>Admin Console</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.footerBtn} onPress={() => router.push("/settings" as any)} activeOpacity={0.75}>
          <Ionicons name="settings-outline" size={17} color={colors.textDim} />
          <Text style={styles.footerText}>Settings</Text>
        </TouchableOpacity>

        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>{user?.name || "Bettor"}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email || ""}</Text>
          </View>
          <TouchableOpacity onPress={onLogout} hitSlop={10} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={19} color={colors.red} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 248,
    backgroundColor: "#0C111D",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.xxl },
  logo: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  brandName: { color: colors.text, fontSize: font.body, fontWeight: font.heavy },
  brandSub: { color: colors.textMuted, fontSize: font.caption, marginTop: 1 },
  nav: { gap: 2 },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 11, paddingHorizontal: spacing.md, borderRadius: radius.md,
  },
  navItemOn: { backgroundColor: colors.goldSoft },
  rail: { position: "absolute", left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: colors.gold },
  navLabel: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold },
  navLabelOn: { color: colors.text },
  badge: {
    position: "absolute", top: -5, right: -8, minWidth: 15, height: 15, borderRadius: 8,
    backgroundColor: colors.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 8, fontWeight: font.bold },
  footer: { borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: spacing.md, gap: 2 },
  footerBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md },
  footerText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
  userRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.ink, fontSize: font.caption, fontWeight: font.heavy },
  userName: { color: colors.text, fontSize: font.small, fontWeight: font.bold },
  userEmail: { color: colors.textMuted, fontSize: font.caption },
});

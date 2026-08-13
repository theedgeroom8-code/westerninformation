import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../store/authStore";
import { showError } from "../../lib/errors";
import { toast, confirmAction } from "../../lib/toast";
import { colors, spacing, radius, font } from "../../theme";

export default function AdminUsers() {
  const me = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [{ data: profiles }, { data: bankrolls }, { data: bets }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("bankrolls").select("user_id, balance"),
      supabase.from("bets").select("user_id"),
    ]);
    const balances = Object.fromEntries((bankrolls ?? []).map((b: any) => [b.user_id, Number(b.balance)]));
    const counts: Record<string, number> = {};
    (bets ?? []).forEach((b: any) => { counts[b.user_id] = (counts[b.user_id] || 0) + 1; });
    setRows((profiles ?? []).map((p: any) => ({ ...p, balance: balances[p.id] ?? 0, betCount: counts[p.id] ?? 0 })));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-users")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const users = rows.filter((r) => r.role === "user");
  const admins = rows.filter((r) => r.role === "admin");

  const toggleActive = async (u: any) => {
    if (u.id === me?.id) { toast("info", "Not allowed", "You can't deactivate your own account."); return; }
    const deactivating = u.is_active;
    if (deactivating) {
      const ok = await confirmAction("Deactivate account?", `${u.email} will stop receiving alerts and lose access.`);
      if (!ok) return;
    }
    const { error } = await supabase.from("profiles").update({ is_active: !u.is_active }).eq("id", u.id);
    if (error) { showError(error, "Update failed"); return; }
    toast("success", deactivating ? "Account deactivated" : "Account activated", u.email);
    load();
  };

  const toggleRole = async (u: any) => {
    if (u.id === me?.id) { toast("info", "Not allowed", "You can't change your own role."); return; }
    const promoting = u.role === "user";
    const ok = await confirmAction(
      promoting ? "Promote to admin?" : "Remove admin access?",
      promoting
        ? `${u.email} will get FULL admin access — including the method data.`
        : `${u.email} will become a regular user.`
    );
    if (!ok) return;
    const { error } = await supabase.from("profiles").update({ role: promoting ? "admin" : "user" }).eq("id", u.id);
    if (error) { showError(error, "Update failed"); return; }
    toast("success", promoting ? "Promoted to admin" : "Demoted to user", u.email);
    load();
  };

  const UserRow = ({ u, isAdminRow, last }: { u: any; isAdminRow?: boolean; last: boolean }) => (
    <View style={[styles.row, !last && styles.rowBorder, !u.is_active && { opacity: 0.45 }]}>
      <View style={styles.userCell}>
        <View style={[styles.avatar, isAdminRow && { backgroundColor: colors.redSoft }]}>
          <Text style={[styles.avatarText, isAdminRow && { color: colors.red }]}>
            {(u.name || u.email || "?").slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {u.name || "—"}{u.id === me?.id ? "  (you)" : ""}
            {!u.is_active && <Text style={styles.inactiveTag}>  · deactivated</Text>}
          </Text>
          <Text style={styles.email} numberOfLines={1}>{u.email} · joined {format(new Date(u.created_at), "MMM dd, yyyy")}</Text>
        </View>
      </View>
      <Text style={[styles.numCell, { width: 100 }]}>${u.balance.toLocaleString()}</Text>
      <Text style={[styles.numCell, { width: 50 }]}>{u.betCount}</Text>
      <View style={styles.actionsCell}>
        <TouchableOpacity style={styles.miniBtn} onPress={() => toggleRole(u)} activeOpacity={0.8}>
          <Ionicons name={isAdminRow ? "arrow-down" : "arrow-up"} size={12} color={colors.textDim} />
          <Text style={styles.miniText}>{isAdminRow ? "Demote" : "Make admin"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.miniBtn, { backgroundColor: u.is_active ? colors.redSoft : colors.greenSoft }]}
          onPress={() => toggleActive(u)}
          activeOpacity={0.8}
        >
          <Text style={[styles.miniText, { color: u.is_active ? colors.red : colors.green }]}>
            {u.is_active ? "Deactivate" : "Activate"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Users</Text>
      <Text style={styles.sub}>{users.length} users · {users.filter((r) => r.is_active).length} active</Text>

      {/* Users table — regular accounts only */}
      <View style={styles.card}>
        <View style={styles.headRow}>
          <Text style={[styles.hCell, { flex: 1 }]}>USER</Text>
          <Text style={[styles.hCell, { width: 100, textAlign: "right" }]}>BANKROLL</Text>
          <Text style={[styles.hCell, { width: 50, textAlign: "right" }]}>BETS</Text>
          <Text style={[styles.hCell, { width: 210, textAlign: "right" }]}>ACTIONS</Text>
        </View>
        {users.map((u, i) => <UserRow key={u.id} u={u} last={i === users.length - 1} />)}
        {loaded && users.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="person-add-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>No users yet</Text>
            <Text style={styles.emptyHint}>Accounts appear here the moment someone signs up in the app.</Text>
          </View>
        )}
      </View>

      {/* Admins — separate, clearly marked */}
      <View style={styles.adminHead}>
        <Ionicons name="shield-half" size={14} color={colors.red} />
        <Text style={styles.adminHeadText}>ADMINISTRATORS ({admins.length})</Text>
      </View>
      <View style={[styles.card, { borderColor: "rgba(248,113,113,0.25)" }]}>
        {admins.map((u, i) => <UserRow key={u.id} u={u} isAdminRow last={i === admins.length - 1} />)}
        {loaded && admins.length === 0 && <Text style={styles.emptyText}>No administrators.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  headRow: { flexDirection: "row", alignItems: "center", paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  hCell: { color: colors.textMuted, fontSize: 10, fontWeight: font.bold, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, gap: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  userCell: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.blue, fontSize: 11, fontWeight: font.heavy },
  name: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  inactiveTag: { color: colors.red, fontSize: font.caption, fontWeight: font.bold },
  email: { color: colors.textMuted, fontSize: font.caption, marginTop: 1 },
  numCell: { color: colors.text, fontSize: font.small, fontWeight: font.semibold, textAlign: "right", fontVariant: ["tabular-nums"] },
  actionsCell: { width: 210, flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceHi, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm },
  miniText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },
  emptyBox: { alignItems: "center", paddingVertical: spacing.xxl, gap: 4 },
  emptyText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold, paddingVertical: spacing.sm },
  emptyHint: { color: colors.textMuted, fontSize: font.caption },
  adminHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xl, marginBottom: spacing.sm },
  adminHeadText: { color: colors.red, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1 },
});

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { colors, spacing, radius, font } from "../../theme";

const FILTERS = ["All", "Open", "Win", "Loss", "Push"];

export default function AdminBets() {
  const [bets, setBets] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("All");

  const load = useCallback(async () => {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from("bets").select("*").order("date_logged", { ascending: false }).limit(200),
      supabase.from("profiles").select("id, email"),
    ]);
    setBets(b ?? []);
    setProfiles(Object.fromEntries((p ?? []).map((r: any) => [r.id, r.email])));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-bets")
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "Open": return bets.filter((b) => !b.result);
      case "Win": return bets.filter((b) => b.result === "win");
      case "Loss": return bets.filter((b) => b.result === "loss");
      case "Push": return bets.filter((b) => b.result === "push");
      default: return bets;
    }
  }, [bets, filter]);

  const staked = filtered.reduce((s, b) => s + Number(b.actual_wager), 0);
  const pl = filtered.reduce((s, b) => s + Number(b.profit_loss || 0), 0);

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>All Bets</Text>
      <Text style={styles.sub}>
        {filtered.length} bets · ${staked.toLocaleString()} staked · net {pl >= 0 ? "+" : "−"}${Math.abs(pl).toLocaleString()}
      </Text>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && { color: colors.ink }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        {filtered.map((b, i) => (
          <View key={b.id} style={[styles.row, i < filtered.length - 1 && styles.rowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.main}>{b.sport} · {b.specific_bet} @ {b.local_book}</Text>
              <Text style={styles.meta}>
                {profiles[b.user_id] ?? b.user_id.slice(0, 8)} · {format(new Date(b.date_logged), "MMM dd HH:mm")} · edge {Number(b.edge_pct).toFixed(1)}%
              </Text>
            </View>
            <Text style={styles.stake}>${Number(b.actual_wager).toLocaleString()}</Text>
            <Text style={[
              styles.result,
              { color: b.result === "win" ? colors.green : b.result === "loss" ? colors.red : b.result === "push" ? colors.textDim : colors.gold },
            ]}>
              {b.result ? (b.profit_loss >= 0 ? `+$${Number(b.profit_loss)}` : `−$${Math.abs(Number(b.profit_loss))}`) : "OPEN"}
            </Text>
          </View>
        ))}
        {filtered.length === 0 && <Text style={styles.empty}>No bets match this filter.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.lg },
  filters: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  main: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  meta: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  stake: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold, width: 80, textAlign: "right" },
  result: { fontSize: font.small, fontWeight: font.heavy, width: 80, textAlign: "right" },
  empty: { color: colors.textMuted, fontSize: font.small, paddingVertical: spacing.md },
});

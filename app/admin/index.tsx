import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format, subDays, startOfDay } from "date-fns";
import { supabase } from "../../lib/supabase";
import { BarChart, AreaChart, HBarChart } from "../../components/admin/Charts";
import { colors, spacing, radius, font } from "../../theme";

interface Raw {
  profiles: any[];
  edges: any[];
  alertCount: number;
  bets: any[];
}

export default function AdminOverview() {
  const { width } = useWindowDimensions();
  const twoCol = width >= 1024;
  const [raw, setRaw] = useState<Raw | null>(null);

  const load = useCallback(async () => {
    const [profiles, edges, alerts, bets] = await Promise.all([
      supabase.from("profiles").select("id, is_active, role, created_at"),
      supabase.from("edges").select("id").eq("status", "active"),
      supabase.from("user_alerts").select("id", { count: "exact", head: true }),
      supabase.from("bets").select("*").order("date_logged", { ascending: true }),
    ]);
    setRaw({
      profiles: profiles.data ?? [],
      edges: edges.data ?? [],
      alertCount: alerts.count ?? 0,
      bets: bets.data ?? [],
    });
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "edges" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_alerts" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const computed = useMemo(() => {
    if (!raw) return null;
    const { profiles, edges, alertCount, bets } = raw;
    const users = profiles.filter((p) => p.role === "user");
    const settled = bets.filter((b) => b.result);
    const staked = bets.reduce((s, b) => s + Number(b.actual_wager), 0);
    const pl = bets.reduce((s, b) => s + Number(b.profit_loss || 0), 0);
    const wins = settled.filter((b) => b.result === "win").length;
    const decided = settled.filter((b) => b.result !== "push").length;

    // bets per day — last 14 days
    const days = Array.from({ length: 14 }, (_, i) => startOfDay(subDays(new Date(), 13 - i)));
    const betsPerDay = days.map((d) => ({
      label: format(d, "dd"),
      value: bets.filter((b) => startOfDay(new Date(b.date_logged)).getTime() === d.getTime()).length,
    }));

    // cumulative P&L over settled bets (chronological)
    let running = 0;
    const cumulative = settled
      .filter((b) => b.date_resulted)
      .sort((a, b) => new Date(a.date_resulted).getTime() - new Date(b.date_resulted).getTime())
      .map((b) => {
        running += Number(b.profit_loss || 0);
        return { label: format(new Date(b.date_resulted), "MMM dd"), value: running };
      });

    // P&L by sport
    const bySportMap: Record<string, { pl: number; count: number }> = {};
    settled.forEach((b) => {
      bySportMap[b.sport] = bySportMap[b.sport] || { pl: 0, count: 0 };
      bySportMap[b.sport].pl += Number(b.profit_loss || 0);
      bySportMap[b.sport].count += 1;
    });
    const bySport = Object.entries(bySportMap)
      .map(([label, v]) => ({ label, value: v.pl, count: v.count }))
      .sort((a, b) => b.value - a.value);

    const recent = [...bets].reverse().slice(0, 6);

    return {
      totalUsers: users.length,
      activeUsers: users.filter((p) => p.is_active).length,
      activeEdges: edges.length,
      alertCount,
      totalBets: bets.length,
      openBets: bets.length - settled.length,
      staked,
      pl,
      winRate: decided ? Math.round((wins / decided) * 100) : 0,
      betsPerDay,
      cumulative,
      bySport,
      recent,
    };
  }, [raw]);

  if (!computed) {
    return <View style={styles.loading}><Text style={styles.loadingText}>Loading metrics…</Text></View>;
  }

  const c = computed;
  const kpiGroups = [
    {
      title: "USERS",
      tiles: [
        { label: "Registered", value: String(c.totalUsers), icon: "people", color: colors.blue },
        { label: "Active", value: String(c.activeUsers), icon: "pulse", color: colors.green },
      ],
    },
    {
      title: "ENGINE",
      tiles: [
        { label: "Active Edges", value: String(c.activeEdges), icon: "flash", color: colors.gold },
        { label: "Alerts Sent", value: String(c.alertCount), icon: "notifications", color: colors.blue },
      ],
    },
    {
      title: "BETTING",
      tiles: [
        { label: "Bets Logged", value: String(c.totalBets), icon: "receipt", color: colors.gold },
        { label: "Open", value: String(c.openBets), icon: "hourglass", color: colors.textDim },
        { label: "Win Rate", value: `${c.winRate}%`, icon: "trophy", color: colors.gold },
        { label: "Staked", value: `$${c.staked.toLocaleString()}`, icon: "cash", color: colors.green },
        {
          label: "Users Net P&L",
          value: `${c.pl >= 0 ? "+" : "−"}$${Math.abs(c.pl).toLocaleString()}`,
          icon: c.pl >= 0 ? "trending-up" : "trending-down",
          color: c.pl >= 0 ? colors.green : colors.red,
        },
      ],
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHead}>
        <View>
          <Text style={styles.title}>Overview</Text>
          <Text style={styles.sub}>Live system metrics — updates in real time</Text>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* KPI groups */}
      <View style={styles.kpiRow}>
        {kpiGroups.map((g) => (
          <View key={g.title} style={styles.kpiGroup}>
            <Text style={styles.kpiGroupTitle}>{g.title}</Text>
            <View style={styles.kpiTiles}>
              {g.tiles.map((t) => (
                <View key={t.label} style={styles.tile}>
                  <View style={[styles.tileIcon, { backgroundColor: t.color + "1f" }]}>
                    <Ionicons name={t.icon as any} size={16} color={t.color} />
                  </View>
                  <Text style={styles.tileValue}>{t.value}</Text>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* charts */}
      <View style={[styles.chartsRow, !twoCol && { flexDirection: "column" }]}>
        <View style={[styles.chartCard, twoCol && { flex: 3 }]}>
          <Text style={styles.chartTitle}>Bets logged — last 14 days</Text>
          <BarChart data={c.betsPerDay} />
        </View>
        <View style={[styles.chartCard, twoCol && { flex: 2 }]}>
          <Text style={styles.chartTitle}>Cumulative users P&L</Text>
          <AreaChart points={c.cumulative} />
        </View>
      </View>

      <View style={[styles.chartsRow, !twoCol && { flexDirection: "column" }]}>
        <View style={[styles.chartCard, twoCol && { flex: 2 }]}>
          <Text style={styles.chartTitle}>P&L by sport</Text>
          <HBarChart data={c.bySport} />
        </View>

        <View style={[styles.chartCard, twoCol && { flex: 3 }]}>
          <Text style={styles.chartTitle}>Recent bets</Text>
          {c.recent.length === 0 && <Text style={styles.emptyText}>No bets logged yet.</Text>}
          {c.recent.map((b: any, i: number) => (
            <View key={b.id} style={[styles.row, i < c.recent.length - 1 && styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowMain}>{b.sport} · {b.specific_bet}</Text>
                <Text style={styles.rowSub}>{format(new Date(b.date_logged), "MMM dd, HH:mm")} · ${Number(b.actual_wager).toLocaleString()} @ {b.local_book}</Text>
              </View>
              <Text style={[
                styles.rowResult,
                { color: b.result === "win" ? colors.green : b.result === "loss" ? colors.red : b.result === "push" ? colors.textDim : colors.gold },
              ]}>
                {b.result ? b.result.toUpperCase() : "OPEN"}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { color: colors.textMuted, fontSize: font.small },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  pageHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.greenSoft, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(52,211,153,0.2)" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.5 },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  kpiGroup: { flexGrow: 1 },
  kpiGroupTitle: { color: colors.textMuted, fontSize: 10, fontWeight: font.bold, letterSpacing: 1.5, marginBottom: spacing.sm },
  kpiTiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    flexGrow: 1, minWidth: 130, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  tileIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  tileValue: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  tileLabel: { color: colors.textDim, fontSize: font.caption, marginTop: 2 },
  chartsRow: { flexDirection: "row", gap: spacing.lg },
  chartCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  chartTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold, marginBottom: spacing.lg },
  emptyText: { color: colors.textMuted, fontSize: font.small },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowMain: { color: colors.text, fontSize: font.small, fontWeight: font.semibold },
  rowSub: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  rowResult: { fontSize: font.caption, fontWeight: font.heavy },
});

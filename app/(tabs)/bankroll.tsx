import React, { useMemo } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { useBettingStore } from "../../store/bettingStore";
import { BankrollCard } from "../../components/BankrollCard";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FadeIn } from "../../components/FadeIn";
import { webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../../theme";

export default function BankrollScreen() {
  const router = useRouter();
  const { bankroll, bets, bankrollHistory } = useBettingStore();

  const resolved = bets.filter((b) => b.result);
  const totalPL = bets.reduce((s, b) => s + (b.profitLoss || 0), 0);
  const wins = bets.filter((b) => b.result === "win").length;
  const losses = bets.filter((b) => b.result === "loss").length;
  const pushes = bets.filter((b) => b.result === "push").length;
  const decided = wins + losses;
  const winRate = decided > 0 ? ((wins / decided) * 100).toFixed(0) : "0";
  const totalStaked = resolved.reduce((s, b) => s + b.actualWager, 0);
  const roi = totalStaked > 0 ? ((totalPL / totalStaked) * 100).toFixed(1) : "0.0";

  // P&L Report — profit grouped by sport (Component 5)
  const bySport = useMemo(() => {
    const map: Record<string, { pl: number; count: number }> = {};
    resolved.forEach((b) => {
      const k = b.edge.sport;
      if (!map[k]) map[k] = { pl: 0, count: 0 };
      map[k].pl += b.profitLoss || 0;
      map[k].count += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].pl - a[1].pl);
  }, [resolved]);

  const maxAbs = Math.max(1, ...bySport.map(([, v]) => Math.abs(v.pl)));

  const stats = [
    { label: "Settled", value: String(resolved.length), icon: "checkmark-done", color: colors.blue },
    { label: "Win Rate", value: `${winRate}%`, icon: "trophy", color: colors.gold },
    { label: "ROI", value: `${roi}%`, icon: "stats-chart", color: colors.green },
  ];

  return (
    <Screen>
      <Header
        maxWidth={880}
        title="Bankroll"
        subtitle="Performance & history"
        icon="wallet"
        right={
          <TouchableOpacity style={styles.adjustBtn} activeOpacity={0.85} onPress={() => router.push("/adjust-bankroll")}>
            <Ionicons name="add" size={16} color={colors.ink} />
            <Text style={styles.adjustText}>Adjust</Text>
          </TouchableOpacity>
        }
      />
      <FlatList
        data={bankrollHistory}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <BankrollCard bankroll={bankroll} profitLoss={totalPL} />

            <FadeIn delay={50}>
              <View style={styles.statsRow}>
                {stats.map((stat, i) => (
                  <View key={i} style={styles.statBox}>
                    <View style={[styles.statIcon, { backgroundColor: stat.color + "22" }]}>
                      <Ionicons name={stat.icon as any} size={16} color={stat.color} />
                    </View>
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </FadeIn>

            <FadeIn delay={100}>
              <View style={styles.wlp}>
                {[
                  { n: wins, label: "WINS", color: colors.green },
                  { n: losses, label: "LOSSES", color: colors.red },
                  { n: pushes, label: "PUSHES", color: colors.textDim },
                ].map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <View style={styles.wlpDiv} />}
                    <View style={styles.wlpItem}>
                      <Text style={[styles.wlpNum, { color: item.color }]}>{item.n}</Text>
                      <Text style={styles.wlpLabel}>{item.label}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </FadeIn>

            {/* P&L by sport */}
            {bySport.length > 0 && (
              <FadeIn delay={140}>
                <Text style={styles.sectionLabel}>PROFIT BY SPORT</Text>
                <View style={styles.plCard}>
                  {bySport.map(([sport, v], i) => {
                    const meta = getSportMeta(sport);
                    const up = v.pl >= 0;
                    const w = `${Math.max(8, (Math.abs(v.pl) / maxAbs) * 100)}%` as any;
                    return (
                      <View key={sport} style={[styles.plRow, i < bySport.length - 1 && styles.plRowBorder]}>
                        <View style={styles.plHead}>
                          <View style={styles.plSport}>
                            <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                            <Text style={styles.plSportText}>{sport}</Text>
                            <Text style={styles.plCount}>· {v.count} bets</Text>
                          </View>
                          <Text style={[styles.plValue, { color: up ? colors.green : colors.red }]}>
                            {up ? "+" : "−"}${Math.abs(v.pl)}
                          </Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: w, backgroundColor: up ? colors.green : colors.red }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </FadeIn>
            )}

            <View style={styles.histHeader}>
              <Text style={styles.histLabel}>TRANSACTION HISTORY</Text>
            </View>
          </View>
        }
        renderItem={({ item, index }) => {
          const up = item.changeAmount >= 0;
          return (
            <FadeIn delay={index * 30}>
              <View style={styles.histRow}>
                <View style={[styles.histIcon, { backgroundColor: up ? colors.greenSoft : colors.redSoft }]}>
                  <Ionicons name={up ? "arrow-up" : "arrow-down"} size={16} color={up ? colors.green : colors.red} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histReason} numberOfLines={1}>{item.reason}</Text>
                  <Text style={styles.histDate}>{format(item.timestamp, "MMM dd, yyyy · HH:mm")}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.histChange, { color: up ? colors.green : colors.red }]}>
                    {up ? "+" : "−"}${Math.abs(item.changeAmount).toLocaleString()}
                  </Text>
                  <Text style={styles.histBal}>${item.amount.toLocaleString()}</Text>
                </View>
              </View>
            </FadeIn>
          );
        }}
        contentContainerStyle={{ paddingBottom: spacing.xxl, ...webMaxWidth(880) }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  adjustBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: colors.gold, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
  },
  adjustText: { color: colors.ink, fontSize: font.small, fontWeight: font.bold },
  statsRow: { flexDirection: "row", marginHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, ...shadow.soft,
  },
  statIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  statValue: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, letterSpacing: -0.5 },
  statLabel: { color: colors.textDim, fontSize: font.caption, marginTop: 2 },
  wlp: {
    flexDirection: "row", marginHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing.lg, alignItems: "center", justifyContent: "space-around", marginBottom: spacing.xl,
    borderWidth: 1, borderColor: colors.border, ...shadow.soft,
  },
  wlpItem: { alignItems: "center", flex: 1 },
  wlpNum: { fontSize: font.h1, fontWeight: font.heavy },
  wlpLabel: { color: colors.textDim, fontSize: 10, fontWeight: font.bold, letterSpacing: 1, marginTop: 2 },
  wlpDiv: { width: 1, height: 40, backgroundColor: colors.hairline },
  sectionLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  plCard: {
    marginHorizontal: spacing.lg, marginBottom: spacing.xl, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft,
  },
  plRow: { paddingVertical: spacing.md },
  plRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  plHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  plSport: { flexDirection: "row", alignItems: "center", gap: 6 },
  plSportText: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  plCount: { color: colors.textMuted, fontSize: font.small },
  plValue: { fontSize: font.body, fontWeight: font.heavy },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  histHeader: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  histLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5 },
  histRow: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  histIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  histReason: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  histDate: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  histChange: { fontSize: font.body, fontWeight: font.heavy },
  histBal: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
});

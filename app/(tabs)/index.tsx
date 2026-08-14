import React, { useState, useMemo, useEffect } from "react";
import { View, Text, FlatList, RefreshControl, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useBettingStore } from "../../store/bettingStore";
import { BankrollCard } from "../../components/BankrollCard";
import { EdgeCard } from "../../components/EdgeCard";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FilterBar } from "../../components/FilterBar";
import { useBreakpoint, webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font } from "../../theme";

export default function EdgesScreen() {
  const router = useRouter();
  const { bankroll, edges, edgesUpdatedAt, bets, flags, refreshEdges, recommendedWagerFor } = useBettingStore();
  const { isDesktop, isWide } = useBreakpoint();
  const cols = isWide ? 3 : isDesktop ? 2 : 1;
  const [refreshing, setRefreshing] = useState(false);
  const [sport, setSport] = useState("All");
  const [query, setQuery] = useState("");
  const [, forceTick] = useState(0);

  // Re-render every 15s so "updated Xs ago" stays honest.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const updatedAgo = edgesUpdatedAt ? Math.max(0, Math.floor((Date.now() - edgesUpdatedAt) / 1000)) : 0;
  const updatedLabel = updatedAgo < 10 ? "just now" : updatedAgo < 60 ? `${updatedAgo}s ago` : `${Math.floor(updatedAgo / 60)}m ago`;

  const totalPL = bets.reduce((s, b) => s + (b.profitLoss || 0), 0);

  const sportOptions = useMemo(
    () => ["All", ...Array.from(new Set(edges.map((e) => e.sport)))],
    [edges]
  );

  const filtered = useMemo(() => {
    let list = sport === "All" ? edges : edges.filter((e) => e.sport === sport);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((e) => e.matchup.toLowerCase().includes(q) || e.specificBet.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => b.edgePercentage - a.edgePercentage);
  }, [edges, sport, query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshEdges(); // resets edgesUpdatedAt → "updated just now"
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header
        title="Live Edges"
        subtitle="Real-time pricing inefficiencies"
        icon="flash"
        right={
          <View style={styles.livePill}>
            <View style={styles.dot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        }
      />
      <FlatList
        data={filtered}
        key={`edge-cols-${cols}`}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? { gap: spacing.md, paddingHorizontal: spacing.lg } : undefined}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} />
        }
        ListHeaderComponent={
          <View>
            {flags.maintenance_mode && (
              <View style={styles.banner}>
                <Ionicons name="construct" size={16} color={colors.gold} />
                <Text style={styles.bannerText}>We're doing scheduled maintenance. Data may be briefly delayed.</Text>
              </View>
            )}
            {!flags.alerts_enabled && (
              <View style={[styles.banner, styles.bannerMuted]}>
                <Ionicons name="notifications-off" size={16} color={colors.textDim} />
                <Text style={[styles.bannerText, { color: colors.textDim }]}>New edge alerts are paused right now.</Text>
              </View>
            )}
            <BankrollCard bankroll={bankroll} profitLoss={totalPL} />

            {/* search */}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search team or play…"
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>{filtered.length} OPPORTUNIT{filtered.length === 1 ? "Y" : "IES"}</Text>
              <View style={styles.updatedRow}>
                <Ionicons name="sync" size={12} color={colors.textMuted} />
                <Text style={styles.updatedText}>Updated {updatedLabel}</Text>
              </View>
            </View>

            <FilterBar options={sportOptions} selected={sport} onSelect={setSport} />
          </View>
        }
        renderItem={({ item, index }) =>
          cols > 1 ? (
            <View style={{ flex: 1, maxWidth: cols === 2 ? "49.3%" : "32.5%" }}>
              <EdgeCard
                edge={item}
                recommendedWager={recommendedWagerFor(item)}
                delay={Math.min(index, 8) * 50}
                style={{ marginHorizontal: 0 }}
                onPress={() => router.push({ pathname: "/edge-detail", params: { edgeId: item.id } })}
              />
            </View>
          ) : (
            <EdgeCard
              edge={item}
              recommendedWager={recommendedWagerFor(item)}
              delay={index * 60}
              onPress={() => router.push({ pathname: "/edge-detail", params: { edgeId: item.id } })}
            />
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No matching edges</Text>
            <Text style={styles.emptyHint}>Try a different sport or search</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl, ...webMaxWidth(1160) }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: "rgba(245,184,65,0.3)",
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  bannerMuted: { backgroundColor: colors.surface, borderColor: colors.border },
  bannerText: { flex: 1, color: colors.gold, fontSize: font.small, fontWeight: font.semibold },
  livePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.greenSoft, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(52,211,153,0.2)",
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: font.small, fontWeight: font.bold, letterSpacing: 0.5 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: spacing.md },
  sectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  sectionLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5 },
  updatedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  updatedText: { color: colors.textMuted, fontSize: font.caption },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold, marginTop: spacing.md },
  emptyHint: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
});

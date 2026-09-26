import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, SectionList, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FilterBar } from "../../components/FilterBar";
import { GameCard, CELL_GAP } from "../../components/GameCard";
import { useBettingStore } from "../../store/bettingStore";
import { useGamesStore, sliceKey, emptySlice } from "../../store/gamesStore";
import { useBreakpoint, webMaxWidth } from "../../lib/responsive";
import { useBoardRealtime } from "../../lib/useBoardRealtime";
import { BoardGame, Cell, Period, PERIODS, periodMeta, groupByDay, timeAgo } from "../../lib/odds";
import { colors, spacing, radius, font } from "../../theme";

// League tabs. Labels follow the sportsbook screens ("CFB"); keys are our sport ids.
const LEAGUES = [
  { key: "NFL", label: "NFL" },
  { key: "NCAAF", label: "CFB" },
] as const;

const PERIOD_LABELS = PERIODS.map((p) => p.label);
const REFRESH_FALLBACK_MS = 120000; // realtime is primary; this covers a dropped socket

export default function GamesScreen() {
  const router = useRouter();
  const edges = useBettingStore((s) => s.edges);
  const { isTablet } = useBreakpoint();
  const { width } = useWindowDimensions();
  const [sport, setSport] = useState<string>("NFL");
  const [period, setPeriod] = useState<Period>("FG");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const key = sliceKey(sport, period);
  const slice = useGamesStore((s) => s.slices[key]) ?? emptySlice;
  const loading = useGamesStore((s) => !!s.loading[key]);
  const load = useGamesStore((s) => s.load);

  // Column width adapts to the phone: card = screen − 2×16 margin − 2×12 padding; the team
  // name always keeps ≥104px (logo + two short lines) and the three price columns share the rest.
  const cellW = isTablet ? 84 : Math.max(50, Math.min(66, Math.floor((width - 56 - 104 - 18) / 3)));
  const compact = !isTablet && cellW < 60;
  const maxW = isTablet ? 640 : undefined;

  // Load on focus + whenever league/period changes; light fallback poll while focused.
  useFocusEffect(
    useCallback(() => {
      load(sport, period);
      const t = setInterval(() => load(sport, period), REFRESH_FALLBACK_MS);
      return () => clearInterval(t);
    }, [sport, period, load])
  );
  // Engine just ingested fresh lines → refetch (debounced, silent).
  useBoardRealtime(() => load(sport, period));
  // Keep "updated Xm ago", Today/Tomorrow headers and LIVE status honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(sport, period);
    setRefreshing(false);
  };

  const sections = useMemo(
    () => groupByDay(slice.games, now).map((g) => ({ key: g.key, title: g.title, data: g.games })),
    [slice.games, now]
  );
  const meta = slice.meta;
  const pm = periodMeta(period);

  const openCell = (game: BoardGame, cell: Cell, edge: { id: string } | null) => {
    if (cell.price === null) return;
    if (edge) {
      router.push({ pathname: "/edge-detail", params: { edgeId: edge.id } });
    } else {
      router.push({
        pathname: "/market-detail" as any,
        params: { gameId: game.id, period, market: cell.market, outcome: cell.outcome, sport },
      });
    }
  };

  const periodNote = () => {
    if (period === "FG") return pm.rule;
    if (meta && !meta.periodEnabled) return "Half and quarter lines are currently switched off.";
    return `${pm.rule} Tracked for games starting within ${meta?.periodWindowHours ?? 30}h.`;
  };

  const showSpinner = loading && slice.fetchedAt === 0;
  const total = slice.games.length;

  return (
    <Screen>
      <Header
        title="Games"
        subtitle="NFL & college football"
        icon="american-football"
        maxWidth={maxW ?? 1160}
      />

      <View style={[styles.controls, maxW ? webMaxWidth(maxW) : null]}>
        {/* league tabs — sportsbook style: text tabs with an underline */}
        <View style={styles.tabsRow}>
          <View style={styles.tabs}>
            {LEAGUES.map((l) => {
              const on = sport === l.key;
              return (
                <TouchableOpacity
                  key={l.key}
                  onPress={() => setSport(l.key)}
                  activeOpacity={0.8}
                  style={styles.tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{l.label}</Text>
                  <View style={[styles.tabBar, on && styles.tabBarOn]} />
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.updatedRow}>
            <Ionicons name="sync" size={12} color={colors.textMuted} />
            <Text style={styles.updatedText} numberOfLines={1}>
              {slice.fetchedAt ? `Updated ${timeAgo(meta?.updatedAt ?? slice.fetchedAt, now)}` : "Loading…"}
            </Text>
          </View>
        </View>

        <FilterBar
          options={PERIOD_LABELS}
          selected={pm.label}
          onSelect={(label) => setPeriod((PERIODS.find((p) => p.label === label)?.key ?? "FG") as Period)}
        />
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={13} color={colors.textMuted} />
          <Text style={styles.noteText}>{periodNote()}</Text>
        </View>
      </View>

      {showSpinner ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(g) => g.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} />}
          contentContainerStyle={[{ paddingBottom: spacing.xxl }, maxW ? webMaxWidth(maxW) : null]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={7}
          ListHeaderComponent={
            slice.error ? (
              <TouchableOpacity onPress={onRefresh} activeOpacity={0.8} style={styles.errBanner}>
                <Ionicons name="cloud-offline-outline" size={15} color={colors.gold} />
                <Text style={styles.errText}>
                  {total ? "Couldn't refresh — showing the last lines we have. Tap to retry." : "Couldn't load games. Tap to retry."}
                </Text>
              </TouchableOpacity>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.dayHead}>
              <Text style={styles.dayTitle}>{section.title}</Text>
              <View style={styles.colHeads}>
                {(cellW < 56 ? ["Spread", "Total", "ML"] : ["Spread", "Total", "Moneyline"]).map((h) => (
                  <Text key={h} style={[styles.colHead, { width: cellW }]} numberOfLines={1}>{h}</Text>
                ))}
              </View>
            </View>
          )}
          renderItem={({ item }) => (
            <GameCard game={item} sport={sport} period={period} edges={edges} cellW={cellW} compact={compact} onCell={openCell} />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name={meta && !meta.enabled ? "construct-outline" : "calendar-outline"} size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {meta && !meta.enabled ? "This league isn't on the board" : "No games on the board right now"}
              </Text>
              <Text style={styles.emptyHint}>
                {meta && !meta.enabled
                  ? "It isn't switched on yet — check back soon."
                  : "Games appear as soon as the sportsbooks post lines. Pull down to refresh."}
              </Text>
            </View>
          }
          ListFooterComponent={
            total ? (
              <Text style={styles.foot}>
                {total} game{total === 1 ? "" : "s"} · lines from your monitored sportsbooks · tap any price to compare books
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  updatedRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  updatedText: { color: colors.textMuted, fontSize: font.caption, flexShrink: 1 },
  controls: { paddingBottom: spacing.xs },
  tabsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: spacing.lg, marginBottom: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.xxl, paddingHorizontal: spacing.lg },
  tab: { paddingTop: 2 },
  tabText: { color: colors.textMuted, fontSize: font.title, fontWeight: font.heavy, paddingBottom: 6 },
  tabTextOn: { color: colors.text },
  tabBar: { height: 3, borderRadius: 2, backgroundColor: "transparent" },
  tabBarOn: { backgroundColor: colors.gold },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  noteText: { flex: 1, color: colors.textMuted, fontSize: font.caption, lineHeight: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60, paddingHorizontal: spacing.xxl },
  emptyTitle: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold, marginTop: spacing.md, textAlign: "center" },
  emptyHint: { color: colors.textMuted, fontSize: font.small, marginTop: 4, textAlign: "center" },
  errBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: "rgba(245,184,65,0.3)",
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  errText: { flex: 1, color: colors.gold, fontSize: font.small, fontWeight: font.semibold },
  dayHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    // right edge lines up with the card's inner padding so the labels sit over the cells
    paddingLeft: spacing.lg, paddingRight: spacing.lg + spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  dayTitle: { color: colors.text, fontSize: font.body, fontWeight: font.heavy },
  colHeads: { flexDirection: "row", gap: CELL_GAP },
  colHead: { color: colors.textMuted, fontSize: 10.5, fontWeight: font.semibold, textAlign: "center" },
  foot: { color: colors.textMuted, fontSize: font.caption, textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.xl, lineHeight: 16 },
});

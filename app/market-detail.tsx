import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { FadeIn } from "../components/FadeIn";
import { FilterBar } from "../components/FilterBar";
import { LineComparison } from "../components/LineComparison";
import { fetchMarketComparison } from "../lib/boardApi";
import { useBoardRealtime } from "../lib/useBoardRealtime";
import { friendlyMessage } from "../lib/errors";
import { webMaxWidth } from "../lib/responsive";
import { formatTimeToGame } from "../lib/format";
import { safeBack } from "../lib/nav";
import {
  Comparison, MarketKey, Period, PERIODS, MARKET_NAMES, periodMeta, formatKickoff, sideHeader,
} from "../lib/odds";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../theme";

const PERIOD_LABELS = PERIODS.map((p) => p.label);

/** Line comparison for a board cell that has no edge on it: every monitored
 *  sportsbook's number for the tapped side, for any period. */
export default function MarketDetailScreen() {
  const p = useLocalSearchParams<{ gameId: string; period?: string; market: string; outcome: string; sport?: string }>();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>((PERIODS.some((x) => x.key === p.period) ? p.period : "FG") as Period);
  const market = (["h2h", "h2h3", "spreads", "totals"].includes(String(p.market)) ? p.market : "h2h") as MarketKey;
  const outcome = String(p.outcome ?? "");
  const gameId = String(p.gameId ?? "");

  const [data, setData] = useState<Comparison | null>(null);
  const [gameSeen, setGameSeen] = useState<Comparison["game"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      let d = await fetchMarketComparison(gameId, period, market, outcome);
      // Only some books post 3-way (tie) moneylines. If none do for this period,
      // compare the ordinary 2-way moneyline instead of showing an empty table.
      if (d && market === "h2h3" && outcome !== "Draw" && d.rows.length === 0) {
        d = await fetchMarketComparison(gameId, period, "h2h", outcome);
      }
      setData(d);
      if (d?.game) setGameSeen(d.game);
      setError(null);
    } catch (e: any) {
      setError(friendlyMessage(e));
    } finally {
      setLoading(false);
    }
  }, [gameId, period, market, outcome]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useBoardRealtime(load);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const game = data?.game ?? gameSeen;
  const shownMarket = (data?.market ?? market) as MarketKey;
  const sport = getSportMeta(p.sport || game?.sport || "Default");
  const pm = periodMeta(period);
  const mins = game ? Math.floor((new Date(game.commence).getTime() - now) / 60000) : 0;
  const live = !!game && mins <= 0 && !game.completed;
  const started = !!game && mins <= 0;

  if (!loading && !error && !data) {
    return (
      <Screen>
        <View style={styles.goneWrap}>
          <View style={styles.goneBadge}><Ionicons name="time-outline" size={30} color={colors.textDim} /></View>
          <Text style={styles.goneTitle}>This game is no longer on the board</Text>
          <Text style={styles.goneText}>It has finished or the sportsbooks have taken it down.</Text>
          <TouchableOpacity style={styles.goneBtn} onPress={() => safeBack(router, "/games")} activeOpacity={0.85}>
            <Text style={styles.goneBtnText}>Back to Games</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderTitle}>Line Comparison</Text>
        <TouchableOpacity onPress={() => safeBack(router, "/games")} style={styles.closeBtn} activeOpacity={0.7} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(560)]}>
        <FadeIn delay={0}>
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={styles.sportTag}>
                <Ionicons name={sport.icon as any} size={14} color={sport.color} />
                <Text style={[styles.sportText, { color: sport.color }]}>
                  {(p.sport || game?.sport || "").toString().replace("NCAAF", "CFB")} · {pm.key === "FG" ? MARKET_NAMES[shownMarket] : `${pm.name} ${MARKET_NAMES[shownMarket]}`}
                </Text>
              </View>
              {game ? (
                live ? (
                  <View style={styles.liveTag}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
                ) : started ? null : (
                  <View style={styles.timeTag}>
                    <Ionicons name="time-outline" size={13} color={colors.gold} />
                    <Text style={styles.timeText}>Starts in {formatTimeToGame(mins)}</Text>
                  </View>
                )
              ) : null}
            </View>

            <Text style={styles.heroMatchup}>{game ? `${game.away} @ ${game.home}` : "Loading…"}</Text>
            {game ? (
              <View style={styles.kickRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.textDim} />
                <Text style={styles.kickText}>
                  {live && game.homeScore !== null && game.awayScore !== null
                    ? `Live · ${game.awayScore} – ${game.homeScore}`
                    : formatKickoff(game.commence)}
                </Text>
              </View>
            ) : null}

            <View style={styles.sideBox}>
              <Text style={styles.sideLabel}>COMPARING</Text>
              <Text style={styles.sideValue} numberOfLines={2}>{sideHeader(shownMarket, outcome)}</Text>
            </View>
          </View>
        </FadeIn>

        <FadeIn delay={60}>
          <Text style={styles.sectionTitle}>PERIOD</Text>
          <View style={{ marginHorizontal: -spacing.lg }}>
            <FilterBar
              options={PERIOD_LABELS}
              selected={pm.label}
              onSelect={(label) => setPeriod((PERIODS.find((x) => x.label === label)?.key ?? "FG") as Period)}
            />
          </View>
          {/* how this period settles — always visible, even when no book has posted it yet */}
          <View style={styles.ruleRow}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={styles.ruleText}>{pm.rule}</Text>
          </View>
        </FadeIn>

        <FadeIn delay={100}>
          <LineComparison
            data={data}
            loading={loading}
            error={error}
            onRetry={() => { setLoading(true); load(); }}
            now={now}
            showRule={false}
            emptyHint={
              period === "FG"
                ? undefined
                : `No sportsbook has posted ${pm.name.toLowerCase()} lines for this game yet. They're tracked closer to kickoff, and not every book offers every period.`
            }
          />
        </FadeIn>

        <FadeIn delay={140}>
          <View style={styles.noteRow}>
            <Ionicons name="notifications-outline" size={15} color={colors.textMuted} />
            <Text style={styles.noteText}>
              No edge is flagged on this line right now. If one appears you'll get an alert, and it will show up on your Edges feed.
            </Text>
          </View>
        </FadeIn>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  goneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, ...webMaxWidth(460) },
  goneBadge: { width: 68, height: 68, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  goneTitle: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, textAlign: "center" },
  goneText: { color: colors.textDim, fontSize: font.body, lineHeight: 22, textAlign: "center", marginTop: spacing.sm },
  goneBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: spacing.xxl, marginTop: spacing.xl },
  goneBtnText: { color: colors.ink, fontSize: font.body, fontWeight: font.bold },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  modalHeaderTitle: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  closeBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  heroCard: { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md, gap: spacing.sm },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  sportText: { fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.5, flexShrink: 1 },
  timeTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.redSoft, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(248,113,113,0.3)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  liveText: { color: colors.red, fontSize: 10, fontWeight: font.heavy, letterSpacing: 0.8 },
  heroMatchup: { color: colors.text, fontSize: font.h2 + 2, fontWeight: font.heavy, letterSpacing: -0.4, marginBottom: spacing.sm },
  kickRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.lg },
  kickText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
  sideBox: { backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius.lg, padding: spacing.lg },
  sideLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1 },
  sideValue: { color: colors.gold, fontSize: font.h2, fontWeight: font.heavy, marginTop: 2 },
  sectionTitle: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.sm, marginBottom: spacing.sm },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: spacing.xs, marginTop: -spacing.xs },
  ruleText: { flex: 1, color: colors.textMuted, fontSize: font.caption, lineHeight: 16 },
  noteRow: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.xs, alignItems: "flex-start" },
  noteText: { flex: 1, color: colors.textMuted, fontSize: font.small, lineHeight: 18 },
});

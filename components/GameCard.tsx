import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TeamLogo } from "./TeamLogo";
import { teamShortName } from "../lib/teamLogos";
import {
  BoardGame, Cell, CellSide, Period, resolveCell, edgeOnCell,
  fmtPrice, fmtPoint, formatKickoff, teamNickname, MARKET_NAMES,
} from "../lib/odds";
import { Edge } from "../types";
import { colors, spacing, radius, font, shadow } from "../theme";

export const CELL_GAP = 6;

interface Props {
  game: BoardGame;
  sport: string;
  period: Period;
  edges: Edge[];
  /** width of each Spread / Total / Moneyline column */
  cellW: number;
  /** narrow phones: smaller logo + type so the team name keeps its room */
  compact?: boolean;
  onCell: (game: BoardGame, cell: Cell, edge: Edge | null) => void;
}

type Kind = "spreads" | "totals" | "h2h";

const MarketCell: React.FC<{
  game: BoardGame; kind: Kind; side: CellSide; period: Period; edges: Edge[]; w: number; teamName: string;
  onCell: Props["onCell"];
}> = ({ game, kind, side, period, edges, w, teamName, onCell }) => {
  const cell = resolveCell(game, kind, side);
  const empty = cell.price === null;
  const edge = edgeOnCell(edges, game.id, period, cell);
  const top =
    kind === "spreads" ? fmtPoint(cell.point, true)
    : kind === "totals" ? `${cell.outcome === "Under" ? "U" : "O"} ${fmtPoint(cell.point)}`
    : null;
  const who = kind === "totals" ? (cell.outcome === "Under" ? "Under" : "Over") : teamName;
  const label = empty
    ? `${kind === "totals" ? "Game total" : teamName} ${MARKET_NAMES[kind]}: not offered`
    : `${who} ${MARKET_NAMES[cell.market]} ${top ? top + " " : ""}${fmtPrice(cell.price)} at ${cell.book}${edge ? `, edge ${edge.edgePercentage.toFixed(1)} percent` : ""}${cell.stale ? ", price may be delayed" : ""}`;

  return (
    <TouchableOpacity
      disabled={empty}
      activeOpacity={0.75}
      onPress={() => onCell(game, cell, edge)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.cell, { width: w }, empty && styles.cellEmpty, edge && styles.cellEdge]}
    >
      {empty ? (
        <Text style={styles.dash}>–</Text>
      ) : (
        <>
          {top ? <Text style={[styles.line, cell.stale && styles.staleText]}>{top}</Text> : null}
          <Text style={[styles.price, kind === "h2h" && styles.priceML, cell.stale && styles.staleText]}>
            {fmtPrice(cell.price)}
          </Text>
        </>
      )}
      {edge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{edge.edgePercentage.toFixed(1)}%</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

export const GameCard: React.FC<Props> = ({ game, sport, period, edges, cellW, compact, onCell }) => {
  const live = game.status === "live";
  const tie = game.markets.h2h?.market === "h2h3"
    ? game.markets.h2h.outcomes.find((o) => o.name === "Draw") ?? null
    : null;
  const anyStale = Object.values(game.markets).some((m) => m?.stale);
  const books = Array.from(new Set(Object.values(game.markets).map((m) => m?.book).filter(Boolean) as string[])).slice(0, 2);
  const hasScore = game.homeScore !== null && game.awayScore !== null;

  const teamRow = (team: string, side: "away" | "home") => (
    <View style={styles.teamRow}>
      <View style={styles.teamCol}>
        <TeamLogo sport={sport} team={team} size={compact ? 22 : 28} />
        <Text style={[styles.teamName, compact && styles.teamNameCompact]} numberOfLines={2} accessibilityLabel={team}>
          {teamShortName(sport, team)}
        </Text>
      </View>
      <View style={styles.cells}>
        <MarketCell game={game} kind="spreads" side={side} period={period} edges={edges} w={cellW} teamName={team} onCell={onCell} />
        <MarketCell game={game} kind="totals" side={side === "away" ? "over" : "under"} period={period} edges={edges} w={cellW} teamName={team} onCell={onCell} />
        <MarketCell game={game} kind="h2h" side={side} period={period} edges={edges} w={cellW} teamName={team} onCell={onCell} />
      </View>
    </View>
  );

  return (
    <View style={styles.card}>
      {teamRow(game.away, "away")}

      <View style={styles.atRow}>
        <Text style={styles.at}>AT</Text>
        <View style={styles.atLine} />
      </View>

      {teamRow(game.home, "home")}

      {tie ? (
        <View style={[styles.teamRow, { marginTop: spacing.sm }]}>
          <View style={styles.teamCol}>
            <View style={styles.tieIcon}><Ionicons name="remove" size={18} color={colors.textDim} /></View>
            <Text style={styles.teamName}>Tie</Text>
          </View>
          <View style={styles.cells}>
            <View style={{ width: cellW }} />
            <View style={{ width: cellW }} />
            <MarketCell game={game} kind="h2h" side="tie" period={period} edges={edges} w={cellW} teamName="Tie" onCell={onCell} />
          </View>
        </View>
      ) : null}

      <View style={styles.footer}>
        {live ? (
          <>
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <Text style={styles.footerText} numberOfLines={1}>
              {hasScore
                ? `${teamNickname(game.away)} ${game.awayScore} – ${teamNickname(game.home)} ${game.homeScore}`
                : "In progress"}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
            <Text style={styles.footerText} numberOfLines={1}>{formatKickoff(game.commence)}</Text>
          </>
        )}
        <View style={{ flex: 1 }} />
        {anyStale ? (
          <View style={styles.delayed}>
            <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            <Text style={styles.delayedText}>Delayed</Text>
          </View>
        ) : books.length ? (
          <Text style={styles.bookText} numberOfLines={1}>{books.join(" · ")}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    ...shadow.soft,
  },
  teamRow: { flexDirection: "row", alignItems: "center", gap: CELL_GAP },
  teamCol: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  teamName: { flex: 1, color: colors.text, fontSize: font.small, fontWeight: font.bold, lineHeight: 16 },
  teamNameCompact: { fontSize: 12, lineHeight: 15 },
  cells: { flexDirection: "row", gap: CELL_GAP },
  atRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5, paddingLeft: 34 },
  at: { color: colors.textMuted, fontSize: 9, fontWeight: font.bold, letterSpacing: 1 },
  atLine: { flex: 1, height: 1, backgroundColor: colors.borderSoft },
  cell: {
    height: 50,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cellEmpty: { backgroundColor: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.03)" },
  cellEdge: { borderColor: "rgba(245,184,65,0.55)" },
  dash: { color: colors.textMuted, fontSize: font.body, opacity: 0.6 },
  line: { color: colors.text, fontSize: 12, fontWeight: font.semibold, fontVariant: ["tabular-nums"] },
  price: { color: colors.green, fontSize: 14, fontWeight: font.heavy, marginTop: 1, fontVariant: ["tabular-nums"] },
  priceML: { fontSize: 15 },
  staleText: { color: colors.textMuted },
  badge: {
    position: "absolute", top: -7, right: -3,
    backgroundColor: colors.gold, borderRadius: radius.pill,
    paddingHorizontal: 6, paddingVertical: 1.5,
  },
  badgeText: { color: colors.ink, fontSize: 9.5, fontWeight: font.heavy, fontVariant: ["tabular-nums"] },
  tieIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderSoft,
  },
  footer: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  footerText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold, flexShrink: 1 },
  bookText: { color: colors.textMuted, fontSize: font.caption, fontWeight: font.semibold, flexShrink: 1 },
  delayed: { flexDirection: "row", alignItems: "center", gap: 3 },
  delayedText: { color: colors.textMuted, fontSize: font.caption, fontWeight: font.semibold },
  liveTag: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.redSoft, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: "rgba(248,113,113,0.3)",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  liveText: { color: colors.red, fontSize: 10, fontWeight: font.heavy, letterSpacing: 0.8 },
});

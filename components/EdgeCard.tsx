import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FadeIn } from "./FadeIn";
import { Edge } from "../types";
import { formatTimeToGame } from "../lib/format";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../theme";

interface EdgeCardProps {
  edge: Edge;
  /** Kelly-sized wager computed from the user's live bankroll. */
  recommendedWager: number;
  onPress: () => void;
  delay?: number;
  /** Layout override — used by the desktop-web grid (kills side margins). */
  style?: ViewStyle;
}

export const EdgeCard: React.FC<EdgeCardProps> = ({ edge, recommendedWager, onPress, delay = 0, style }) => {
  const isHighEdge = edge.edgePercentage >= 4;
  const minsToGame = Math.max(0, Math.floor((edge.gameTime.getTime() - Date.now()) / 60000));
  const sport = getSportMeta(edge.sport);
  const timeLabel = formatTimeToGame(minsToGame);

  return (
    <FadeIn delay={delay} style={style ? { flex: 1 } : undefined}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.card, style]}>
        {/* left accent rail signals edge strength */}
        <View style={[styles.rail, { backgroundColor: isHighEdge ? colors.gold : colors.blue }]} />

        <View style={styles.body}>
          <View style={styles.headerRow}>
            <View style={styles.sportTag}>
              <Ionicons name={sport.icon as any} size={13} color={sport.color} />
              <Text style={[styles.sportText, { color: sport.color }]}>{edge.sport}</Text>
            </View>
            <View style={styles.timeTag}>
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
              <Text style={styles.timeText}>{timeLabel}</Text>
            </View>
          </View>

          <Text style={styles.matchup} numberOfLines={1}>{edge.matchup}</Text>

          <View style={styles.betRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.betSpecific}>
                {edge.rotationNumber ? `#${edge.rotationNumber} · ` : ""}{edge.specificBet}
              </Text>
              <Text style={styles.betMeta}>
                {edge.localBook} · {edge.localOdds > 0 ? "+" : ""}{edge.localOdds}
              </Text>
            </View>
            <View style={[styles.edgeBadge, isHighEdge && styles.edgeBadgeHigh]}>
              <Text style={[styles.edgeValue, isHighEdge && { color: colors.ink }]}>
                {edge.edgePercentage.toFixed(1)}%
              </Text>
              <Text style={[styles.edgeLabel, isHighEdge && { color: "rgba(10,14,23,0.7)" }]}>EDGE</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <View style={styles.footerItem}>
              <Ionicons name="cash-outline" size={14} color={colors.green} />
              <Text style={styles.footerLabel}>Suggested </Text>
              <Text style={styles.wager}>${recommendedWager}</Text>
            </View>
            <View style={styles.viewRow}>
              <Text style={styles.viewText}>Details</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </FadeIn>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    overflow: "hidden",
    ...shadow.soft,
  },
  rail: { width: 4 },
  body: { flex: 1, padding: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  sportText: { fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.8 },
  timeTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  timeText: { color: colors.textMuted, fontSize: font.caption, fontWeight: font.semibold },
  matchup: { color: colors.text, fontWeight: font.bold, fontSize: font.body, marginBottom: spacing.md },
  betRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  betSpecific: { color: colors.text, fontWeight: font.semibold, fontSize: font.body },
  betMeta: { color: colors.textDim, fontSize: font.small, marginTop: 3 },
  edgeBadge: {
    backgroundColor: colors.blueSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 58,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.25)",
  },
  edgeBadgeHigh: { backgroundColor: colors.gold, borderColor: colors.gold },
  edgeValue: { color: colors.blue, fontSize: font.title, fontWeight: font.heavy, letterSpacing: -0.5 },
  edgeLabel: { color: colors.blue, fontSize: 9, fontWeight: font.bold, letterSpacing: 1 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.md,
  },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 2 },
  footerLabel: { color: colors.textDim, fontSize: font.small },
  wager: { color: colors.green, fontWeight: font.bold, fontSize: font.small },
  viewRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
});

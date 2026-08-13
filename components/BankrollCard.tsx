import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { FadeIn } from "./FadeIn";
import { colors, spacing, radius, font, shadow } from "../theme";

interface Props {
  bankroll: number;
  profitLoss: number;
}

export const BankrollCard: React.FC<Props> = ({ bankroll, profitLoss }) => {
  const roi = ((profitLoss / Math.max(bankroll - profitLoss, 1)) * 100).toFixed(1);
  const isUp = profitLoss >= 0;
  const accent = isUp ? colors.green : colors.red;

  return (
    <FadeIn>
      <LinearGradient
        colors={["#1B2D52", "#142138"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* subtle gold corner glow */}
        <View style={styles.glow} />

        <View style={styles.topRow}>
          <Text style={styles.label}>TOTAL BANKROLL</Text>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>

        <Text style={styles.amount}>
          ${bankroll.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Total P&L</Text>
            <View style={styles.statValueRow}>
              <Ionicons
                name={isUp ? "trending-up" : "trending-down"}
                size={16}
                color={accent}
              />
              <Text style={[styles.statValue, { color: accent }]}>
                {isUp ? "+" : "−"}${Math.abs(profitLoss).toLocaleString()}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={[styles.stat, { alignItems: "flex-end" }]}>
            <Text style={styles.statLabel}>ROI</Text>
            <Text style={[styles.statValue, { color: accent }]}>
              {isUp ? "+" : ""}{roi}%
            </Text>
          </View>
        </View>
      </LinearGradient>
    </FadeIn>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    ...shadow.card,
  },
  glow: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.goldSoft,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    color: colors.textDim,
    fontSize: font.caption,
    fontWeight: font.bold,
    letterSpacing: 1.5,
  },
  liveTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 10, fontWeight: font.bold, letterSpacing: 0.5 },
  amount: {
    color: colors.text,
    fontSize: font.display,
    fontWeight: font.heavy,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    letterSpacing: -1,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: spacing.md,
  },
  stat: { flex: 1 },
  statLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.regular },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  statValue: { fontSize: font.title, fontWeight: font.heavy, marginTop: 3 },
  divider: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.1)", marginHorizontal: spacing.lg },
});

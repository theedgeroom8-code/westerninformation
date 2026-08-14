import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBettingStore } from "../store/bettingStore";
import { Screen } from "../components/Screen";
import { FadeIn } from "../components/FadeIn";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../theme";
import { showError } from "../lib/errors";
import { toast } from "../lib/toast";
import { webMaxWidth } from "../lib/responsive";
import { formatTimeToGame } from "../lib/format";
import { safeBack } from "../lib/nav";

export default function EdgeDetailScreen() {
  const { edgeId } = useLocalSearchParams<{ edgeId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { edges, logBet: logBetRpc, recommendedWagerFor } = useBettingStore();
  const [wager, setWager] = useState("");
  const [logging, setLogging] = useState(false);

  const edge = edges.find((e) => e.id === edgeId);

  if (!edge) {
    // The edge expired or was removed between the alert and the tap —
    // odds move fast; explain instead of erroring.
    return (
      <Screen>
        <View style={styles.goneWrap}>
          <View style={styles.goneBadge}>
            <Ionicons name="time-outline" size={30} color={colors.textDim} />
          </View>
          <Text style={styles.goneTitle}>This edge has expired</Text>
          <Text style={styles.goneText}>
            Lines move fast — this opportunity is no longer available. Fresh edges appear on your board the moment they're detected.
          </Text>
          <TouchableOpacity style={styles.goneBtn} onPress={() => safeBack(router, "/(tabs)")} activeOpacity={0.85}>
            <Text style={styles.goneBtnText}>Back to Live Edges</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const suggested = recommendedWagerFor(edge);
  const sport = getSportMeta(edge.sport);
  const mins = Math.max(0, Math.floor((edge.gameTime.getTime() - Date.now()) / 60000));
  const timeLabel = formatTimeToGame(mins);

  const logBet = async () => {
    const amount = parseFloat(wager);
    if (!amount || amount <= 0) { showError("Please enter a valid amount.", "Invalid amount"); return; }
    setLogging(true);
    try {
      await logBetRpc(edge, amount);
      // Land the user on My Plays so the tracked play is immediately visible.
      if (Platform.OS === "web") {
        toast("success", "Play tracked ✓", `$${amount} on ${edge.specificBet} — see it in My Plays.`);
        router.replace("/(tabs)/bets");
      } else {
        Alert.alert("Play Tracked ✓", `$${amount} on ${edge.specificBet}`, [
          { text: "View My Plays", onPress: () => router.replace("/(tabs)/bets") },
        ]);
      }
    } catch (e: any) {
      showError(e, "Couldn't track play");
    } finally {
      setLogging(false);
    }
  };

  return (
    <Screen>
      {/* custom modal header */}
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderTitle}>Edge Detail</Text>
        <TouchableOpacity onPress={() => safeBack(router, "/(tabs)")} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(560)]}>

        <FadeIn delay={0}>
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={styles.sportTag}>
                <Ionicons name={sport.icon as any} size={14} color={sport.color} />
                <Text style={[styles.sportText, { color: sport.color }]}>{edge.sport} · {edge.betType}</Text>
              </View>
              <View style={styles.timeTag}>
                <Ionicons name="time-outline" size={13} color={colors.gold} />
                <Text style={styles.timeText}>Starts in {timeLabel}</Text>
              </View>
            </View>

            <Text style={styles.heroMatchup}>{edge.matchup}</Text>

            <View style={styles.edgeMeter}>
              <View style={{ flex: 1 }}>
                <Text style={styles.edgeMeterLabel}>DETECTED EDGE</Text>
                <Text style={styles.edgeMeterValue}>{edge.edgePercentage.toFixed(1)}%</Text>
              </View>
              <View style={styles.edgeRing}>
                <Ionicons name="trending-up" size={26} color={colors.ink} />
              </View>
            </View>
          </View>
        </FadeIn>

        {/* Actionable play only — the "how" (sharp books / no-vig / fair price) is
            intentionally hidden from users and lives in the admin dashboard. */}
        <FadeIn delay={80}>
          <Text style={styles.sectionTitle}>THE PLAY</Text>
          <View style={styles.card}>
            <View style={styles.playRow}>
              <View style={styles.playIcon}>
                <Ionicons name="flag" size={18} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playLabel}>PLAY</Text>
                <Text style={styles.playValue}>
                  {edge.rotationNumber ? `#${edge.rotationNumber} · ` : ""}{edge.specificBet}
                </Text>
              </View>
            </View>
            <View style={styles.divider} />
            {[
              ["Source", edge.localBook, "business-outline"],
              ["Line to take", `${edge.localOdds > 0 ? "+" : ""}${edge.localOdds}`, "pricetag-outline"],
              ["Game starts", timeLabel + " from now", "time-outline"],
            ].map(([label, value, icon], i, arr) => (
              <View key={i} style={[styles.row, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.rowLeft}>
                  <Ionicons name={icon as any} size={15} color={colors.textMuted} />
                  <Text style={styles.rowLabel}>{label as string}</Text>
                </View>
                <Text style={styles.rowValue}>{value as string}</Text>
              </View>
            ))}
          </View>
        </FadeIn>

        <FadeIn delay={160}>
          <Text style={styles.sectionTitle}>SUGGESTED AMOUNT</Text>
          <View style={styles.card}>
            <View style={styles.kellyRow}>
              <View>
                <Text style={styles.kellyValue}>${suggested}</Text>
                <Text style={styles.kellyNote}>Sized to your bankroll & risk level</Text>
              </View>
              <View style={styles.kellyBadge}>
                <Ionicons name="shield-checkmark" size={20} color={colors.green} />
              </View>
            </View>

            <View style={styles.divider} />

            <Text style={styles.inputLabel}>YOUR AMOUNT</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                placeholder={String(suggested)}
                placeholderTextColor={colors.textMuted}
                value={wager}
                onChangeText={setWager}
                keyboardType="decimal-pad"
                style={styles.input}
              />
              <TouchableOpacity
                style={styles.useBtn}
                onPress={() => setWager(String(suggested))}
                activeOpacity={0.8}
              >
                <Text style={styles.useBtnText}>Use suggested</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FadeIn>

        <FadeIn delay={220}>
          <View style={styles.noteRow}>
            <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
            <Text style={styles.noteText}>
              Place this bet at the sportsbook, then log it to track your bankroll. This app does not place bets.
            </Text>
          </View>
        </FadeIn>

        <View style={{ height: spacing.md }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          onPress={logBet}
          disabled={logging || !wager}
          style={[styles.btn, (!wager || logging) && styles.btnDisabled]}
          activeOpacity={0.9}
        >
          {!logging && wager ? (
            <Ionicons name="checkmark-circle" size={20} color={colors.ink} />
          ) : null}
          <Text style={[styles.btnText, (!wager || logging) && { color: colors.textMuted }]}>
            {logging ? "Tracking…" : "Track This Play"}
          </Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  err: { color: colors.text, textAlign: "center", marginTop: 40 },
  goneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, ...webMaxWidth(460) },
  goneBadge: { width: 68, height: 68, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  goneTitle: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy },
  goneText: { color: colors.textDim, fontSize: font.body, lineHeight: 22, textAlign: "center", marginTop: spacing.sm },
  goneBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: spacing.xxl, marginTop: spacing.xl },
  goneBtnText: { color: colors.ink, fontSize: font.body, fontWeight: font.bold },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  modalHeaderTitle: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  closeBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  heroCard: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  sportText: { fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.5 },
  timeTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold },
  heroMatchup: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5, marginBottom: spacing.lg },
  edgeMeter: {
    flexDirection: "row", alignItems: "center", backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: radius.lg, padding: spacing.lg,
  },
  edgeMeterLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1 },
  edgeMeterValue: { color: colors.gold, fontSize: font.display, fontWeight: font.heavy, letterSpacing: -1, marginTop: 2 },
  edgeRing: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  sectionTitle: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.sm, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  playRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  playIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" },
  playLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1 },
  playValue: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, marginTop: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowLabel: { color: colors.textDim, fontSize: font.body },
  rowValue: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  kellyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kellyValue: { color: colors.green, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  kellyNote: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  kellyBadge: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.lg },
  inputLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginBottom: spacing.sm },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md },
  dollar: { color: colors.textDim, fontSize: font.h2, fontWeight: font.bold },
  input: { flex: 1, color: colors.text, fontSize: font.h2, fontWeight: font.bold, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  useBtn: { backgroundColor: colors.goldSoft, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm },
  useBtnText: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold },
  noteRow: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.xs, alignItems: "flex-start" },
  noteText: { flex: 1, color: colors.textMuted, fontSize: font.small, lineHeight: 18 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: "rgba(10,14,23,0.6)" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.green, borderRadius: radius.md, paddingVertical: spacing.lg, ...shadow.soft },
  btnDisabled: { backgroundColor: colors.surfaceHi },
  btnText: { color: colors.ink, fontWeight: font.heavy, fontSize: font.body, letterSpacing: 0.5 },
});

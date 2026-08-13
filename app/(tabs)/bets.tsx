import React, { useState, useMemo } from "react";
import { View, Text, FlatList, TouchableOpacity, Modal, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { useBettingStore } from "../../store/bettingStore";
import { FadeIn } from "../../components/FadeIn";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FilterBar } from "../../components/FilterBar";
import { Bet } from "../../types";
import { webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../../theme";
import { showError } from "../../lib/errors";

const FILTERS = ["All", "Open", "Won", "Lost", "Push"] as const;

const resultMeta = {
  win: { color: colors.green, soft: colors.greenSoft, icon: "checkmark-circle", label: "WON" },
  loss: { color: colors.red, soft: colors.redSoft, icon: "close-circle", label: "LOST" },
  push: { color: colors.textDim, soft: "rgba(154,167,189,0.12)", icon: "remove-circle", label: "PUSH" },
} as const;

export default function BetsScreen() {
  const { bets, settleBet } = useBettingStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [settling, setSettling] = useState(false);

  const onSettle = async (result: "win" | "loss" | "push") => {
    if (!selectedId || settling) return;
    setSettling(true);
    try {
      await settleBet(selectedId, result);
      setSelectedId(null);
    } catch (e: any) {
      showError(e, "Couldn't settle bet");
    } finally {
      setSettling(false);
    }
  };

  const open = bets.filter((b) => !b.result);
  const closed = bets.filter((b) => b.result);
  const selected = bets.find((b) => b.id === selectedId);

  const filtered = useMemo(() => {
    const list = [...open, ...closed];
    switch (filter) {
      case "Open": return list.filter((b) => !b.result);
      case "Won": return list.filter((b) => b.result === "win");
      case "Lost": return list.filter((b) => b.result === "loss");
      case "Push": return list.filter((b) => b.result === "push");
      default: return list;
    }
  }, [open, closed, filter]);

  const BetCard = ({ bet, index }: { bet: Bet; index: number }) => {
    const sport = getSportMeta(bet.edge.sport);
    const rm = bet.result ? resultMeta[bet.result] : null;
    return (
      <FadeIn delay={index * 50}>
        <TouchableOpacity
          onPress={() => !bet.result && setSelectedId(bet.id)}
          activeOpacity={bet.result ? 1 : 0.85}
          style={styles.card}
        >
          <View style={[styles.rail, { backgroundColor: rm ? rm.color : colors.gold }]} />
          <View style={styles.body}>
            <View style={styles.cardHeader}>
              <View style={styles.sportTag}>
                <Ionicons name={sport.icon as any} size={13} color={sport.color} />
                <Text style={[styles.sportText, { color: sport.color }]}>{bet.edge.sport}</Text>
              </View>
              {rm ? (
                <View style={[styles.badge, { backgroundColor: rm.soft }]}>
                  <Ionicons name={rm.icon as any} size={13} color={rm.color} />
                  <Text style={[styles.badgeText, { color: rm.color }]}>{rm.label}</Text>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: colors.goldSoft }]}>
                  <View style={styles.pulse} />
                  <Text style={[styles.badgeText, { color: colors.gold }]}>OPEN</Text>
                </View>
              )}
            </View>

            <Text style={styles.matchup} numberOfLines={1}>{bet.edge.matchup}</Text>
            <Text style={styles.betLine}>{bet.edge.specificBet} · {bet.edge.localBook}</Text>
            <Text style={styles.dateLine}>Logged {format(bet.dateLogged, "MMM dd, yyyy")}</Text>

            <View style={styles.footer}>
              <View>
                <Text style={styles.footLabel}>Wagered</Text>
                <Text style={styles.footWager}>${bet.actualWager}</Text>
              </View>
              {bet.profitLoss !== null ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.footLabel}>Payout</Text>
                  <Text style={[styles.footPL, { color: bet.profitLoss >= 0 ? colors.green : colors.red }]}>
                    {bet.profitLoss >= 0 ? "+" : "−"}${Math.abs(bet.profitLoss)}
                  </Text>
                </View>
              ) : (
                <View style={styles.tapCta}>
                  <Text style={styles.tapText}>Mark result</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.gold} />
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </FadeIn>
    );
  };

  return (
    <Screen>
      <Header
        maxWidth={820}
        title="My Bets"
        subtitle={`${open.length} open · ${closed.length} settled`}
        icon="receipt"
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <FilterBar options={[...FILTERS]} selected={filter} onSelect={setFilter} />
        }
        renderItem={({ item, index }) => <BetCard bet={item} index={index} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No {filter !== "All" ? filter.toLowerCase() + " " : ""}bets</Text>
            <Text style={styles.emptyHint}>Tap an edge to log your first bet</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.xs, ...webMaxWidth(820) }}
        showsVerticalScrollIndicator={false}
      />

      <Modal transparent visible={!!selectedId} animationType="fade" onRequestClose={() => setSelectedId(null)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.modalGrip} />
            <Text style={styles.modalTitle}>Settle Bet</Text>
            {selected && (
              <>
                <Text style={styles.modalSub}>{selected.edge.matchup}</Text>
                <Text style={styles.modalBet}>{selected.edge.specificBet} · ${selected.actualWager}</Text>
              </>
            )}
            <View style={styles.modalBtns}>
              {(["win", "loss", "push"] as const).map((r) => {
                const m = resultMeta[r];
                return (
                  <TouchableOpacity
                    key={r}
                    activeOpacity={0.85}
                    disabled={settling}
                    style={[styles.modalBtn, { backgroundColor: m.soft, borderColor: m.color }, settling && { opacity: 0.5 }]}
                    onPress={() => onSettle(r)}
                  >
                    <Ionicons name={m.icon as any} size={20} color={m.color} />
                    <Text style={[styles.modalBtnText, { color: m.color }]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.cancel} onPress={() => setSelectedId(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

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
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  sportText: { fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 10, fontWeight: font.bold, letterSpacing: 0.5 },
  pulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  matchup: { color: colors.text, fontWeight: font.bold, fontSize: font.body, marginBottom: 3 },
  betLine: { color: colors.textDim, fontSize: font.small, marginBottom: 2 },
  dateLine: { color: colors.textMuted, fontSize: font.caption, marginBottom: spacing.md },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.md,
  },
  footLabel: { color: colors.textMuted, fontSize: font.caption },
  footWager: { color: colors.text, fontSize: font.title, fontWeight: font.bold, marginTop: 2 },
  footPL: { fontSize: font.title, fontWeight: font.heavy, marginTop: 2 },
  tapCta: { flexDirection: "row", alignItems: "center", gap: 2 },
  tapText: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold, marginTop: spacing.md },
  emptyHint: { color: colors.textMuted, fontSize: font.small, marginTop: 4, textAlign: "center", paddingHorizontal: 32 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.textMuted, marginBottom: spacing.lg },
  modalTitle: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, marginBottom: 6 },
  modalSub: { color: colors.textDim, fontSize: font.body },
  modalBet: { color: colors.gold, fontSize: font.body, fontWeight: font.semibold, marginTop: 2, marginBottom: spacing.xl },
  modalBtns: { gap: spacing.md, marginBottom: spacing.md },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  modalBtnText: { fontWeight: font.heavy, fontSize: font.body, letterSpacing: 1 },
  cancel: { paddingVertical: spacing.md, alignItems: "center" },
  cancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: font.semibold },
});

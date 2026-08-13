import React, { useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { useBettingStore } from "../../store/bettingStore";
import { Screen } from "../../components/Screen";
import { Header } from "../../components/Header";
import { FadeIn } from "../../components/FadeIn";
import { AlertItem } from "../../types";
import { webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font, shadow, getSportMeta } from "../../theme";

export default function AlertsScreen() {
  const router = useRouter();
  const { alerts, broadcasts, markAlertRead, markAllAlertsRead, markBroadcastsSeen, recommendedWagerFor } = useBettingStore();
  const unread = alerts.filter((a) => !a.read).length;
  const sorted = [...alerts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Viewing this tab marks broadcasts as seen (clears their share of the badge).
  useEffect(() => {
    markBroadcastsSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasts.length]);

  const openAlert = (alert: AlertItem) => {
    markAlertRead(alert.id);
    router.push({ pathname: "/edge-detail", params: { edgeId: alert.edgeId } });
  };

  const Card = ({ alert, index }: { alert: AlertItem; index: number }) => {
    const sport = getSportMeta(alert.sport);
    const isHigh = alert.edgePercentage >= 4;
    return (
      <FadeIn delay={index * 45}>
        <TouchableOpacity activeOpacity={0.85} onPress={() => openAlert(alert)} style={[styles.card, !alert.read && styles.cardUnread]}>
          <View style={[styles.iconWrap, { backgroundColor: isHigh ? colors.goldSoft : colors.blueSoft }]}>
            <Ionicons name="flash" size={20} color={isHigh ? colors.gold : colors.blue} />
            {!alert.read && <View style={styles.unreadDot} />}
          </View>

          <View style={{ flex: 1 }}>
            <View style={styles.topRow}>
              <View style={styles.sportTag}>
                <Ionicons name={sport.icon as any} size={12} color={sport.color} />
                <Text style={[styles.sportText, { color: sport.color }]}>{alert.sport}</Text>
                <Text style={styles.betType}>· {alert.betType}</Text>
              </View>
              <Text style={styles.time}>{formatDistanceToNow(alert.alertTime, { addSuffix: false })}</Text>
            </View>

            <Text style={styles.matchup} numberOfLines={1}>{alert.matchup}</Text>

            <View style={styles.detailRow}>
              <Text style={styles.bet}>{alert.rotationNumber ? `#${alert.rotationNumber} · ` : ""}{alert.specificBet}</Text>
              <Text style={styles.book}> @ {alert.localBook}</Text>
            </View>

            <View style={styles.metaRow}>
              <View style={[styles.edgePill, isHigh && { backgroundColor: colors.gold }]}>
                <Text style={[styles.edgePillText, isHigh && { color: colors.ink }]}>
                  {alert.edgePercentage.toFixed(1)}% edge
                </Text>
              </View>
              <Text style={styles.wager}>
                Bet <Text style={styles.wagerVal}>${recommendedWagerFor(alert)}</Text>
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: "auto" }} />
            </View>
          </View>
        </TouchableOpacity>
      </FadeIn>
    );
  };

  return (
    <Screen>
      <Header
        maxWidth={760}
        title="Alerts"
        subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
        icon="notifications"
        right={
          unread > 0 ? (
            <TouchableOpacity style={styles.readAllBtn} onPress={markAllAlertsRead} activeOpacity={0.8}>
              <Ionicons name="checkmark-done" size={15} color={colors.gold} />
              <Text style={styles.readAllText}>Mark all</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          broadcasts.length > 0 ? (
            <View style={styles.broadcastWrap}>
              {broadcasts.slice(0, 3).map((b) => (
                <View key={b.id} style={styles.broadcast}>
                  <View style={styles.broadcastIcon}>
                    <Ionicons name="megaphone" size={16} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.broadcastTitle}>{b.title}</Text>
                    <Text style={styles.broadcastMsg}>{b.message}</Text>
                    <Text style={styles.broadcastTime}>{formatDistanceToNow(b.createdAt, { addSuffix: true })}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item, index }) => <Card alert={item} index={index} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No alerts yet</Text>
            <Text style={styles.emptyHint}>Edge alerts will appear here in real time</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.xs, ...webMaxWidth(760) }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  readAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.goldSoft, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
  },
  readAllText: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
  broadcastWrap: { marginBottom: spacing.sm },
  broadcast: {
    flexDirection: "row", gap: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    padding: spacing.lg, backgroundColor: "rgba(96,165,250,0.06)", borderRadius: radius.lg,
    borderWidth: 1, borderColor: "rgba(96,165,250,0.25)",
  },
  broadcastIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  broadcastTitle: { color: colors.blue, fontSize: font.body, fontWeight: font.bold },
  broadcastMsg: { color: colors.textDim, fontSize: font.small, lineHeight: 19, marginTop: 2 },
  broadcastTime: { color: colors.textMuted, fontSize: font.caption, marginTop: 4 },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.soft,
  },
  cardUnread: { borderColor: "rgba(245,184,65,0.3)", backgroundColor: colors.surfaceAlt },
  iconWrap: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  unreadDot: {
    position: "absolute", top: -2, right: -2, width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.red, borderWidth: 2, borderColor: colors.surfaceAlt,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  sportText: { fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.5 },
  betType: { color: colors.textMuted, fontSize: font.caption, fontWeight: font.semibold },
  time: { color: colors.textMuted, fontSize: font.caption },
  matchup: { color: colors.text, fontSize: font.body, fontWeight: font.bold, marginBottom: 4 },
  detailRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  bet: { color: colors.text, fontSize: font.small, fontWeight: font.semibold },
  book: { color: colors.textDim, fontSize: font.small },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  edgePill: { backgroundColor: colors.blueSoft, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  edgePillText: { color: colors.blue, fontSize: font.caption, fontWeight: font.bold },
  wager: { color: colors.textDim, fontSize: font.small },
  wagerVal: { color: colors.green, fontWeight: font.bold },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold, marginTop: spacing.md },
  emptyHint: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
});

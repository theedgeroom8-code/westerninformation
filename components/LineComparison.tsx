import React from "react";
import { View, Text, TouchableOpacity, Linking, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Comparison, MarketKey, BOOK_LINKS, rankRows, diffVsBest, fmtLine, fmtPrice, fmtPoint,
  sideHeaderShort, timeAgo, periodMeta,
} from "../lib/odds";
import { colors, spacing, radius, font, shadow } from "../theme";

interface Props {
  data: Comparison | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** re-render clock (ms) so "updated 2m ago" keeps moving */
  now?: number;
  /** show the raw sharp row (admin only — the server only returns it to admins) */
  admin?: boolean;
  /** period-specific wording when no book has posted the line (e.g. quarter lines not tracked yet) */
  emptyHint?: string;
  /** print the period's settlement rule under the table (screens that already show it can turn this off) */
  showRule?: boolean;
}

const toneColor = { best: colors.textMuted, worse: colors.red, better: colors.green, same: colors.textMuted } as const;

/** Every monitored sportsbook's number for one market, best → worst, plus the
 *  fair line when the market carries an active edge. */
export const LineComparison: React.FC<Props> = ({ data, loading, error, onRetry, now = Date.now(), admin, emptyHint, showRule = true }) => {
  const market = (data?.market ?? "h2h") as MarketKey;
  const outcome = data?.outcome ?? "";
  const ranked = data ? rankRows(market, outcome, data.rows.filter((r) => !r.sharp)) : [];
  const best = ranked[0];
  const source = data?.sourceBook;

  const open = (book: string) => {
    const url = BOOK_LINKS[book];
    if (url) Linking.openURL(url).catch(() => {});
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>LINE COMPARISON</Text>
      <View style={styles.card}>
        {loading && !data ? (
          <View>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skelRow, i === 2 && { borderBottomWidth: 0 }]}>
                <View style={[styles.skel, { width: "38%" }]} />
                <View style={[styles.skel, { width: "24%" }]} />
              </View>
            ))}
          </View>
        ) : error && !data ? (
          <View style={styles.msgWrap}>
            <Ionicons name="cloud-offline-outline" size={22} color={colors.textMuted} />
            <Text style={styles.msg}>Couldn't load the book comparison.</Text>
            <TouchableOpacity onPress={onRetry} activeOpacity={0.8} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !data || ranked.length === 0 ? (
          <View style={styles.msgWrap}>
            <Ionicons name="pricetags-outline" size={22} color={colors.textMuted} />
            <Text style={styles.msg}>{emptyHint ?? "No monitored sportsbook is posting this line right now."}</Text>
          </View>
        ) : (
          <>
            <View style={styles.headRow}>
              <Text style={[styles.head, { flex: 1.25 }]}>SPORTSBOOK</Text>
              <Text style={[styles.head, { flex: 1.15, textAlign: "right" }]} numberOfLines={1}>
                {sideHeaderShort(market, outcome).toUpperCase()}
              </Text>
              <Text style={[styles.head, { width: 64, textAlign: "right" }]}>VS BEST</Text>
            </View>

            {ranked.map((r, i) => {
              const d = diffVsBest(market, outcome, best, r);
              // every fresh row level with the top price is a best price (ties aren't ranked arbitrarily)
              const isBest = !r.stale && d.tone === "best";
              const isSource = r.book === source;
              const linkable = !!BOOK_LINKS[r.book];
              return (
                <TouchableOpacity
                  key={r.book}
                  activeOpacity={linkable ? 0.7 : 1}
                  onPress={() => open(r.book)}
                  disabled={!linkable}
                  accessibilityRole={linkable ? "link" : undefined}
                  accessibilityLabel={`${r.book} ${fmtLine(market, outcome, r)}${r.stale ? ", price may be out of date" : ""}${isSource ? ", the recommended book" : ""}`}
                  style={[styles.row, isSource && styles.rowSource, i === ranked.length - 1 && !data.fair && !data.sharp && { borderBottomWidth: 0 }]}
                >
                  <View style={{ flex: 1.25, paddingRight: 6 }}>
                    <View style={styles.bookLine}>
                      <Text style={[styles.book, r.stale && styles.dim]} numberOfLines={1}>{r.book}</Text>
                      {linkable ? <Ionicons name="open-outline" size={11} color={colors.textMuted} /> : null}
                    </View>
                    {isSource || isBest ? (
                      <Text style={styles.tag}>{isSource && isBest ? "BEST · TAKE THIS" : isSource ? "TAKE THIS" : "BEST PRICE"}</Text>
                    ) : null}
                    <Text style={[styles.updated, r.stale && { color: colors.red }]}>
                      {r.stale ? "Delayed · " : "Updated "}{timeAgo(r.updatedAt, now)}
                    </Text>
                  </View>
                  <Text style={[styles.value, isSource && { color: colors.gold }, r.stale && styles.dim, { flex: 1.15 }]} numberOfLines={1}>
                    {fmtLine(market, outcome, r)}
                  </Text>
                  <Text style={[styles.diff, { color: toneColor[d.tone] }, r.stale && styles.dim]}>{d.text}</Text>
                </TouchableOpacity>
              );
            })}

            {data.fair ? (
              <View style={[styles.row, styles.fairRow, !data.sharp && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1.25, paddingRight: 6 }}>
                  <View style={styles.bookLine}>
                    <Ionicons name="analytics" size={12} color={colors.gold} />
                    <Text style={[styles.book, { color: colors.gold }]} numberOfLines={1}>Fair line</Text>
                  </View>
                  <Text style={styles.updated}>
                    Sharp benchmark · {data.fair.stale ? "when found" : timeAgo(data.fair.updatedAt, now)}
                  </Text>
                </View>
                <Text style={[styles.value, { color: colors.gold, flex: 1.15 }, data.fair.stale && styles.dim]} numberOfLines={1}>
                  {market === "h2h" || market === "h2h3"
                    ? fmtPrice(data.fair.price)
                    : `${market === "totals" ? (outcome === "Under" ? "U" : "O") + " " + fmtPoint(data.fair.point) : fmtPoint(data.fair.point, true)} / ${fmtPrice(data.fair.price)}`}
                </Text>
                <Text style={[styles.diff, { color: colors.textMuted }]}>—</Text>
              </View>
            ) : null}

            {admin && data.sharp ? (
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1.25 }}>
                  <Text style={[styles.book, { color: colors.blue }]}>{data.sharp.book}</Text>
                  <Text style={styles.updated}>Sharp (admin only) · {timeAgo(data.sharp.updatedAt, now)}</Text>
                </View>
                <Text style={[styles.value, { color: colors.blue, flex: 1.15 }]} numberOfLines={1}>
                  {fmtLine(market, outcome, { point: data.sharp.point, price: data.sharp.price })}
                </Text>
                <Text style={[styles.diff, { color: colors.textMuted }]}>—</Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {data && ranked.length > 0 ? (
        <Text style={styles.foot}>
          {showRule ? periodMeta(data.period).rule : ""}
          {data.fair ? `${showRule ? " " : ""}The fair line is the no-vig price from the sharp market that this edge is measured against.` : ""}
          {ranked.some((r) => r.stale) ? " Delayed = the feed hasn't refreshed that price within its refresh window, so it may no longer be available." : ""}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionTitle: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.sm, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  headRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  head: { color: colors.textMuted, fontSize: 9.5, fontWeight: font.bold, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowSource: { backgroundColor: colors.goldSoft, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.gold },
  fairRow: { borderBottomColor: "transparent", borderTopWidth: 1, borderTopColor: "rgba(245,184,65,0.25)" },
  bookLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  book: { color: colors.text, fontSize: font.body, fontWeight: font.bold, flexShrink: 1 },
  tag: { color: colors.gold, fontSize: 9, fontWeight: font.heavy, letterSpacing: 0.8, marginTop: 2 },
  updated: { color: colors.textMuted, fontSize: 10.5, marginTop: 2 },
  value: { color: colors.text, fontSize: font.body, fontWeight: font.heavy, textAlign: "right", fontVariant: ["tabular-nums"] },
  diff: { width: 64, textAlign: "right", fontSize: font.small, fontWeight: font.bold, fontVariant: ["tabular-nums"] },
  dim: { opacity: 0.5 },
  msgWrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  msg: { color: colors.textDim, fontSize: font.small, textAlign: "center" },
  retry: { backgroundColor: colors.goldSoft, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: 7, marginTop: 2 },
  retryText: { color: colors.gold, fontSize: font.small, fontWeight: font.bold },
  skelRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  skel: { height: 14, borderRadius: 7, backgroundColor: colors.surfaceHi },
  foot: { color: colors.textMuted, fontSize: font.caption, lineHeight: 16, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
});

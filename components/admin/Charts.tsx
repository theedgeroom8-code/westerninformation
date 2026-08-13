import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Path, Line, Circle } from "react-native-svg";
import { colors, spacing, font } from "../../theme";

// Admin console charts (react-native-svg — bundled in Expo Go, works on web).
// Principles: subtle gridlines, direct value labels for small datasets,
// meaningful empty states, no decoration competing with data.

const GRID = "rgba(255,255,255,0.06)";

function EmptyChart({ height, hint }: { height: number; hint: string }) {
  return (
    <View style={[styles.empty, { height }]}>
      <Text style={styles.emptyText}>{hint}</Text>
    </View>
  );
}

// ---------- Vertical bars (per-day counts) ----------
export function BarChart({
  data, height = 160, color = colors.gold,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const hasData = data.some((d) => d.value > 0);
  if (!hasData) return <EmptyChart height={height} hint="No activity yet — bars appear as bets are logged." />;

  const chartH = height - 34; // room for x labels + value labels

  return (
    <View>
      <View style={{ height: chartH }}>
        {/* gridlines */}
        <Svg width="100%" height={chartH} style={StyleSheet.absoluteFill}>
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={f} x1="0" x2="100%" y1={chartH * f} y2={chartH * f} stroke={GRID} strokeWidth={1} />
          ))}
        </Svg>
        <View style={styles.barsRow}>
          {data.map((d, i) => {
            const h = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * (chartH - 18));
            return (
              <View key={i} style={styles.barCol}>
                {d.value > 0 && <Text style={styles.barValue}>{d.value}</Text>}
                <View style={{ height: h, backgroundColor: d.value > 0 ? color : "transparent", borderRadius: 3, width: "62%" }} />
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.xRow}>
        {data.map((d, i) => (
          <Text key={i} style={styles.xLabel} numberOfLines={1}>
            {i % 2 === 0 ? d.label : ""}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ---------- Area/line (cumulative P&L) ----------
export function AreaChart({
  points, height = 160, width = 600,
}: {
  points: { label: string; value: number }[];
  height?: number;
  width?: number;
}) {
  if (points.length < 2) return <EmptyChart height={height} hint="Needs at least two settled bets to draw a trend." />;

  const chartH = height - 22;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const y = (v: number) => chartH - ((v - min) / span) * (chartH - 12) - 6;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${y(p.value)}`).join(" ");
  const areaPath = `${linePath} L ${width} ${chartH} L 0 ${chartH} Z`;
  const zeroY = y(0);
  const last = points[points.length - 1];
  const up = last.value >= 0;
  const stroke = up ? colors.green : colors.red;

  return (
    <View>
      <Svg width="100%" height={chartH} viewBox={`0 0 ${width} ${chartH}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1="0" x2={width} y1={chartH * f} y2={chartH * f} stroke={GRID} strokeWidth={1} />
        ))}
        {/* zero baseline */}
        <Line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="4 4" />
        <Path d={areaPath} fill={up ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)"} />
        <Path d={linePath} stroke={stroke} strokeWidth={2.5} fill="none" />
        <Circle cx={(points.length - 1) * stepX} cy={y(last.value)} r={4} fill={stroke} />
      </Svg>
      <View style={styles.areaFooter}>
        <Text style={styles.xLabel}>{points[0].label}</Text>
        <Text style={[styles.areaCurrent, { color: stroke }]}>
          {up ? "+" : "−"}${Math.abs(last.value).toLocaleString()}
        </Text>
        <Text style={styles.xLabel}>{last.label}</Text>
      </View>
    </View>
  );
}

// ---------- Horizontal bars (P&L by sport) ----------
export function HBarChart({ data }: { data: { label: string; value: number; count?: number }[] }) {
  if (!data.length) return <EmptyChart height={120} hint="No settled bets yet — sport breakdown appears here." />;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <View style={{ gap: spacing.md }}>
      {data.map((d) => {
        const up = d.value >= 0;
        const w = Math.max(4, (Math.abs(d.value) / maxAbs) * 100);
        return (
          <View key={d.label}>
            <View style={styles.hRow}>
              <Text style={styles.hLabel}>{d.label}{d.count ? <Text style={styles.hCount}>  · {d.count} bets</Text> : null}</Text>
              <Text style={[styles.hValue, { color: up ? colors.green : colors.red }]}>
                {up ? "+" : "−"}${Math.abs(d.value).toLocaleString()}
              </Text>
            </View>
            <View style={styles.hTrack}>
              <View style={{ width: `${w}%` as any, height: 8, borderRadius: 4, backgroundColor: up ? colors.green : colors.red }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted, fontSize: font.small, textAlign: "center", paddingHorizontal: spacing.lg },
  barsRow: { flex: 1, flexDirection: "row", alignItems: "flex-end" },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barValue: { color: colors.textDim, fontSize: 10, fontWeight: font.bold, marginBottom: 3, fontVariant: ["tabular-nums"] },
  xRow: { flexDirection: "row", marginTop: 6 },
  xLabel: { flex: 1, color: colors.textMuted, fontSize: 10, textAlign: "center" },
  areaFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  areaCurrent: { fontSize: font.body, fontWeight: font.heavy, fontVariant: ["tabular-nums"] },
  hRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 5 },
  hLabel: { color: colors.text, fontSize: font.small, fontWeight: font.semibold },
  hCount: { color: colors.textMuted, fontWeight: font.regular },
  hValue: { fontSize: font.small, fontWeight: font.heavy, fontVariant: ["tabular-nums"] },
  hTrack: { height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: "hidden" },
});

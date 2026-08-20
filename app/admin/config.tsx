import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";

// Treasure Island folded into Station Sports (client, Aug 2026) — dropped.
const BOOKS = ["South Point", "Caesars", "DraftKings", "FanDuel", "Wynn", "Coast Casino", "BetMGM", "Circa"];
const SPORTS = ["NFL", "NBA", "WNBA", "MLB", "NHL", "NCAAF", "NCAAB"];
// Books the odds engine can track automatically (mirrors api_book_map).
// Unlisted books aren't carried by The Odds API — manual edges only.
const AUTO_BOOKS = new Set(["DraftKings", "BetMGM", "Caesars", "Wynn", "Circa", "FanDuel"]);

interface EngineState {
  last_poll_at: string | null;
  credits_remaining: number | null;
  last_status: string;
  paused_reason: string | null;
}
interface EngineRun {
  id: number;
  at: string;
  kind: string;
  sport: string | null;
  detail: string | null;
}

const timeAgo = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
};

export default function AdminConfig() {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [cfg, st, log] = await Promise.all([
      supabase.from("app_config").select("*"),
      supabase.from("engine_state").select("*").eq("id", 1).maybeSingle(),
      supabase.from("engine_runs").select("id, at, kind, sport, detail").order("id", { ascending: false }).limit(12),
    ]);
    setConfig(Object.fromEntries((cfg.data ?? []).map((r: any) => [r.key, r.value])));
    if (st.data) setEngine(st.data as EngineState);
    setRuns((log.data ?? []) as EngineRun[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const ch1 = supabase
      .channel("admin-engine-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "engine_state" }, () => load())
      .subscribe();
    const ch2 = supabase
      .channel("admin-engine-runs")
      .on("postgres_changes", { event: "*", schema: "public", table: "engine_runs" }, () => load())
      .subscribe();
    const ch3 = supabase
      .channel("admin-config")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_config" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
    };
  }, [load]);

  const save = async (key: string, value: any) => {
    setConfig((c) => ({ ...c, [key]: value })); // optimistic
    const { error } = await supabase.from("app_config").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) { showError(error, "Save failed"); load(); }
  };

  if (!loaded) return null;

  const engineOn = Boolean(config.engine_enabled ?? false);
  const interval = Number(config.poll_interval_minutes ?? 60);
  const threshold = Number(config.min_edge_threshold ?? 2);
  const cutoff = Number(config.pre_game_cutoff_minutes ?? 30);
  const dupSuppression = Boolean(config.duplicate_suppression ?? true);
  const activeBooks: string[] = config.active_books ?? [];
  const activeSports: string[] = config.active_sports ?? [];
  const flags: Record<string, boolean> = config.feature_flags ?? {};

  const toggleList = (key: string, list: string[], item: string) =>
    save(key, list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const statusColor = !engineOn
    ? colors.textMuted
    : engine?.last_status === "error" || engine?.last_status === "paused"
    ? "#e5484d"
    : colors.green;
  const statusLabel = !engineOn
    ? "OFF"
    : engine?.last_status === "paused"
    ? "PAUSED"
    : engine?.last_status === "error"
    ? "ERROR"
    : "LIVE";

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Engine Config</Text>
      <Text style={styles.sub}>Global settings — none of this is visible to users</Text>

      {/* ---------- LIVE ODDS ENGINE ---------- */}
      <Text style={styles.sectionTitle}>ODDS ENGINE</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.label}>Automatic edge detection</Text>
              <View style={[styles.statusPill, { borderColor: statusColor }]}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.hint}>
              Polls The Odds API, strips Pinnacle's vig, publishes edges + alerts on its own
            </Text>
          </View>
          <Switch
            value={engineOn}
            onValueChange={(v) => save("engine_enabled", v)}
            trackColor={{ false: colors.surfaceHi, true: "rgba(245,184,65,0.4)" }}
            thumbColor={engineOn ? colors.gold : colors.textMuted}
          />
        </View>

        {engine?.paused_reason ? (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={14} color="#e5484d" />
            <Text style={styles.warnText}>{engine.paused_reason}</Text>
          </View>
        ) : null}

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{engine?.credits_remaining ?? "—"}</Text>
            <Text style={styles.statLabel}>API CREDITS LEFT</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{timeAgo(engine?.last_poll_at ?? null)}</Text>
            <Text style={styles.statLabel}>LAST POLL</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{interval}m</Text>
            <Text style={styles.statLabel}>POLL INTERVAL</Text>
          </View>
        </View>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Poll interval</Text>
        <Text style={styles.hint}>Shorter = fresher edges, more API credits burned</Text>
        <View style={styles.chips}>
          {[15, 30, 60, 120, 240].map((v) => (
            <TouchableOpacity key={v} style={[styles.chip, interval === v && styles.chipOn]} onPress={() => save("poll_interval_minutes", v)}>
              <Text style={[styles.chipText, interval === v && { color: colors.ink }]}>{v} min</Text>
            </TouchableOpacity>
          ))}
        </View>

        {runs.length > 0 && (
          <>
            <Text style={[styles.label, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>Recent activity</Text>
            {runs.map((r) => (
              <View key={r.id} style={styles.logRow}>
                <View style={[styles.logDot, {
                  backgroundColor: r.kind === "error" ? "#e5484d" : r.kind === "scan" ? colors.green : r.kind === "pause" ? "#f5a623" : colors.textMuted,
                }]} />
                <Text style={styles.logTime}>{timeAgo(r.at)}</Text>
                <Text style={styles.logText} numberOfLines={1}>
                  {(r.sport ? r.sport + " · " : "") + (r.detail || r.kind)}
                </Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* ---------- EDGE DETECTION DIALS ---------- */}
      <Text style={styles.sectionTitle}>EDGE DETECTION</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Minimum edge threshold</Text>
        <Text style={styles.hint}>Edges below this are discarded by the engine</Text>
        <View style={styles.chips}>
          {[1, 1.5, 2, 2.5, 3].map((v) => (
            <TouchableOpacity key={v} style={[styles.chip, threshold === v && styles.chipOn]} onPress={() => save("min_edge_threshold", v)}>
              <Text style={[styles.chipText, threshold === v && { color: colors.ink }]}>{v}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Pre-game alert cutoff</Text>
        <Text style={styles.hint}>No alerts once a game is this close to starting</Text>
        <View style={styles.chips}>
          {[15, 30, 45, 60].map((v) => (
            <TouchableOpacity key={v} style={[styles.chip, cutoff === v && styles.chipOn]} onPress={() => save("pre_game_cutoff_minutes", v)}>
              <Text style={[styles.chipText, cutoff === v && { color: colors.ink }]}>{v} min</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Duplicate suppression</Text>
            <Text style={styles.hint}>Same game + bet type alerts once per 5-minute window</Text>
          </View>
          <Switch
            value={dupSuppression}
            onValueChange={(v) => save("duplicate_suppression", v)}
            trackColor={{ false: colors.surfaceHi, true: "rgba(245,184,65,0.4)" }}
            thumbColor={dupSuppression ? colors.gold : colors.textMuted}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>MONITORED SPORTSBOOKS</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          AUTO books are tracked live by the engine. Others aren't carried by The Odds API — they only receive manually published edges.
        </Text>
        <View style={[styles.chips, { marginTop: spacing.md }]}>
          {BOOKS.map((b) => {
            const on = activeBooks.includes(b);
            return (
              <TouchableOpacity key={b} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleList("active_books", activeBooks, b)}>
                <Text style={[styles.chipText, on && { color: colors.ink }]}>
                  {b}
                  {AUTO_BOOKS.has(b) ? "  ⚡" : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.hint, { marginTop: spacing.sm }]}>⚡ = auto-tracked by the engine</Text>
      </View>

      <Text style={styles.sectionTitle}>MONITORED SPORTS</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Only these leagues are polled — fewer sports = fewer API credits. Out-of-season sports cost almost nothing (rechecked every 6h).
        </Text>
        <View style={[styles.chips, { marginTop: spacing.md }]}>
          {SPORTS.map((s) => {
            const on = activeSports.includes(s);
            return (
              <TouchableOpacity key={s} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleList("active_sports", activeSports, s)}>
                <Text style={[styles.chipText, on && { color: colors.ink }]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={styles.sectionTitle}>FEATURE FLAGS</Text>
      <View style={styles.card}>
        {[
          { key: "alerts_enabled", label: "Alerts enabled", hint: "Master kill switch — blocks ALL edge alerts (in-app + push)" },
          { key: "maintenance_mode", label: "Maintenance mode", hint: "Shows a maintenance notice to users" },
          { key: "responsible_gambling", label: "Responsible gambling tools", hint: "Activate limits & self-exclusion (future)" },
        ].map((f, i, arr) => (
          <View key={f.key} style={[styles.toggleRow, i < arr.length - 1 && styles.border]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{f.label}</Text>
              <Text style={styles.hint}>{f.hint}</Text>
            </View>
            <Switch
              value={Boolean(flags[f.key])}
              onValueChange={(v) => save("feature_flags", { ...flags, [f.key]: v })}
              trackColor={{ false: colors.surfaceHi, true: "rgba(245,184,65,0.4)" }}
              thumbColor={flags[f.key] ? colors.gold : colors.textMuted}
            />
          </View>
        ))}
      </View>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.lg },
  sectionTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },
  hint: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontSize: font.small, fontWeight: font.bold },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: font.bold, letterSpacing: 0.8 },
  warnBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "rgba(229,72,77,0.08)", borderColor: "rgba(229,72,77,0.35)", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  warnText: { flex: 1, color: "#e5484d", fontSize: font.small },
  statRow: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: colors.borderSoft, marginHorizontal: spacing.md },
  statValue: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  statLabel: { color: colors.textMuted, fontSize: 9, fontWeight: font.bold, letterSpacing: 1, marginTop: 3 },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  logDot: { width: 7, height: 7, borderRadius: 4 },
  logTime: { color: colors.textMuted, fontSize: font.caption, width: 70 },
  logText: { flex: 1, color: colors.textDim, fontSize: font.caption },
});

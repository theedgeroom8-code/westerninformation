import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { noVig } from "../../lib/kelly";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";
import { toast, confirmAction } from "../../lib/toast";

const SPORTS = ["NFL", "NBA", "WNBA", "MLB", "NHL", "NCAAF", "NCAAB"];
const BET_TYPES = ["Game Spread", "1st Half Spread", "Game Total", "1st Half Total", "Moneyline", "F5 Moneyline"];

const field = (label: string, value: string, onChange: (t: string) => void, placeholder: string, flex = 1, keyboard?: any) => (
  <View style={{ flex, minWidth: 140 }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.textMuted} keyboardType={keyboard} />
  </View>
);

export default function AdminEdges() {
  const [edges, setEdges] = useState<any[]>([]);
  const [methods, setMethods] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // form state
  const [sport, setSport] = useState("NFL");
  const [betType, setBetType] = useState("Game Total");
  const [matchup, setMatchup] = useState("");
  const [specificBet, setSpecificBet] = useState("");
  const [localBook, setLocalBook] = useState("");
  const [localOdds, setLocalOdds] = useState("-110");
  const [edgePct, setEdgePct] = useState("");
  const [hoursToGame, setHoursToGame] = useState("3");
  const [rotation, setRotation] = useState("");
  const [fairPrice, setFairPrice] = useState("");
  const [notes, setNotes] = useState("");
  // no-vig calculator
  const [juiceA, setJuiceA] = useState("-105");
  const [juiceB, setJuiceB] = useState("-105");

  const load = useCallback(async () => {
    const [{ data: e }, { data: m }] = await Promise.all([
      supabase.from("edges").select("*").order("created_at", { ascending: false }),
      supabase.from("edge_method").select("*"),
    ]);
    setEdges(e ?? []);
    setMethods(Object.fromEntries((m ?? []).map((r: any) => [r.edge_id, r])));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-edges")
      .on("postgres_changes", { event: "*", schema: "public", table: "edges" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const publish = async () => {
    if (!matchup.trim() || !specificBet.trim() || !localBook.trim() || !edgePct || !fairPrice) {
      toast("info", "Missing fields", "Matchup, bet, book, edge % and fair price are required.");
      return;
    }
    setSaving(true);
    try {
      const { data: edge, error } = await supabase.from("edges").insert({
        sport,
        league: sport,
        matchup: matchup.trim(),
        bet_type: betType,
        specific_bet: specificBet.trim(),
        local_book: localBook.trim(),
        local_odds: parseInt(localOdds, 10) || -110,
        edge_pct: parseFloat(edgePct),
        rotation_number: rotation.trim() ? parseInt(rotation, 10) || null : null,
        game_time: new Date(Date.now() + (parseFloat(hoursToGame) || 3) * 3600e3).toISOString(),
      }).select().single();
      if (error) throw error;

      const { error: mErr } = await supabase.from("edge_method").insert({
        edge_id: edge.id,
        sharp_fair_price: parseInt(fairPrice, 10),
        notes: notes.trim() || null,
        book_lines: [
          { book: "No-Vig Fair", type: "fair", juice: parseInt(fairPrice, 10) },
          { book: localBook.trim(), type: "edge", juice: parseInt(localOdds, 10) || -110 },
        ],
      });
      if (mErr) throw mErr;

      setShowForm(false);
      setMatchup(""); setSpecificBet(""); setLocalBook(""); setEdgePct(""); setFairPrice(""); setNotes(""); setRotation("");
      toast("success", "Edge published", "Alerts fanned out to all active users in real time.");
    } catch (e: any) {
      showError(e, "Publish failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: "active" | "expired") => {
    const { error } = await supabase.from("edges").update({ status }).eq("id", id);
    if (error) { showError(error, "Update failed"); return; }
    toast("success", status === "expired" ? "Edge expired" : "Edge reactivated", "Users' edge boards updated in real time.");
  };

  const remove = async (id: string) => {
    const ok = await confirmAction("Delete edge?", "This also removes its alerts from every user's inbox. This can't be undone.");
    if (!ok) return;
    const { error } = await supabase.from("edges").delete().eq("id", id);
    if (error) { showError(error, "Delete failed"); return; }
    toast("success", "Edge deleted");
  };

  const nv = (() => {
    const a = parseInt(juiceA, 10); const b = parseInt(juiceB, 10);
    if (!a || !b) return null;
    return noVig(a, b);
  })();

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.headRow}>
        <View>
          <Text style={styles.title}>Edges</Text>
          <Text style={styles.sub}>Publishing an edge instantly alerts every active user</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm((v) => !v)} activeOpacity={0.85}>
          <Ionicons name={showForm ? "close" : "add"} size={16} color={colors.ink} />
          <Text style={styles.newBtnText}>{showForm ? "Cancel" : "New Edge"}</Text>
        </TouchableOpacity>
      </View>

      {/* source-of-truth note */}
      <View style={styles.sourceNote}>
        <Ionicons name="information-circle-outline" size={15} color={colors.blue} />
        <Text style={styles.sourceNoteText}>
          The odds engine now creates edges automatically from The Odds API (Pinnacle no-vig) — control it
          in Config. Manual publishing still works for books the API doesn't carry (South Point, TI, Coast).
        </Text>
      </View>

      {showForm && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PUBLISH NEW EDGE</Text>

          <Text style={styles.fieldLabel}>Sport</Text>
          <View style={styles.chips}>
            {SPORTS.map((s) => (
              <TouchableOpacity key={s} style={[styles.chip, sport === s && styles.chipOn]} onPress={() => setSport(s)}>
                <Text style={[styles.chipText, sport === s && { color: colors.ink }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Bet type</Text>
          <View style={styles.chips}>
            {BET_TYPES.map((b) => (
              <TouchableOpacity key={b} style={[styles.chip, betType === b && styles.chipOn]} onPress={() => setBetType(b)}>
                <Text style={[styles.chipText, betType === b && { color: colors.ink }]}>{b}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formRow}>
            {field("Matchup (Away @ Home)", matchup, setMatchup, "New Orleans @ Indianapolis", 2)}
            {field("Specific bet", specificBet, setSpecificBet, "Over 209")}
          </View>
          <View style={styles.formRow}>
            {field("Local book", localBook, setLocalBook, "South Point")}
            {field("Local odds", localOdds, setLocalOdds, "-100", 1, "numbers-and-punctuation")}
            {field("Edge %", edgePct, setEdgePct, "4.0", 1, "decimal-pad")}
            {field("Hours to game", hoursToGame, setHoursToGame, "3", 1, "decimal-pad")}
            {field("Rotation # (optional)", rotation, setRotation, "457", 1, "number-pad")}
          </View>

          <View style={styles.methodBox}>
            <View style={styles.methodHead}>
              <Ionicons name="eye-off" size={14} color={colors.gold} />
              <Text style={styles.methodTitle}>METHOD — NEVER VISIBLE TO USERS</Text>
            </View>
            <View style={styles.formRow}>
              {field("Sharp fair price (no-vig)", fairPrice, setFairPrice, "+100", 1, "numbers-and-punctuation")}
              {field("Notes", notes, setNotes, "Pinnacle 210 -105 both sides", 2)}
            </View>

            {/* no-vig calculator */}
            <View style={styles.calcRow}>
              {field("Side A juice", juiceA, setJuiceA, "-105", 1, "numbers-and-punctuation")}
              {field("Side B juice", juiceB, setJuiceB, "-105", 1, "numbers-and-punctuation")}
              <View style={{ flex: 2, minWidth: 200 }}>
                <Text style={styles.fieldLabel}>No-vig result</Text>
                <View style={styles.calcOut}>
                  {nv ? (
                    <Text style={styles.calcText}>
                      Vig {nv.vigPct.toFixed(2)}% · Fair A {nv.fairOddsA > 0 ? "+" : ""}{nv.fairOddsA} ({(nv.fairProbA * 100).toFixed(2)}%) · Fair B {nv.fairOddsB > 0 ? "+" : ""}{nv.fairOddsB}
                    </Text>
                  ) : (
                    <Text style={[styles.calcText, { color: colors.textMuted }]}>Enter both juices</Text>
                  )}
                </View>
              </View>
            </View>
          </View>

          <TouchableOpacity style={[styles.publishBtn, saving && { opacity: 0.6 }]} onPress={publish} disabled={saving} activeOpacity={0.85}>
            <Ionicons name="send" size={16} color={colors.ink} />
            <Text style={styles.publishText}>{saving ? "Publishing…" : "Publish & Alert All Users"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {edges.map((e) => {
        const m = methods[e.id];
        const open = expanded === e.id;
        const active = e.status === "active";
        return (
          <View key={e.id} style={styles.edgeCard}>
            <TouchableOpacity style={styles.edgeHead} onPress={() => setExpanded(open ? null : e.id)} activeOpacity={0.8}>
              <View style={[styles.statusDot, { backgroundColor: active ? colors.green : colors.textMuted }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.edgeMatchup}>{e.matchup}</Text>
                <Text style={styles.edgeMeta}>
                  {e.sport} · {e.bet_type} · {e.rotation_number ? `#${e.rotation_number} ` : ""}{e.specific_bet} @ {e.local_book} ({e.local_odds > 0 ? "+" : ""}{e.local_odds}) · {format(new Date(e.game_time), "MMM dd HH:mm")}
                </Text>
              </View>
              {e.source === "engine" && (
                <Ionicons name="flash" size={13} color={colors.gold} style={{ marginRight: 2 }} />
              )}
              <Text style={styles.edgePct}>{Number(e.edge_pct).toFixed(1)}%</Text>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
            </TouchableOpacity>

            {open && (
              <View style={styles.edgeBody}>
                {m ? (
                  <View style={styles.methodView}>
                    <Text style={styles.methodViewTitle}>
                      METHOD · Fair price {m.sharp_fair_price > 0 ? "+" : ""}{m.sharp_fair_price}
                      {m.no_vig_prob ? ` · No-vig ${(Number(m.no_vig_prob) * 100).toFixed(2)}%` : ""}
                    </Text>
                    {(m.book_lines ?? []).map((l: any, i: number) => (
                      <View key={i} style={styles.lineRow}>
                        <Text style={[styles.lineBook, l.type === "edge" && { color: colors.green }, l.type === "fair" && { color: colors.gold }]}>
                          {l.book}
                        </Text>
                        <Text style={styles.lineType}>{l.type}</Text>
                        <Text style={styles.lineJuice}>{l.juice > 0 ? "+" : ""}{l.juice}{l.line ? ` (${l.line})` : ""}</Text>
                      </View>
                    ))}
                    {m.notes ? <Text style={styles.methodNotes}>{m.notes}</Text> : null}
                  </View>
                ) : (
                  <Text style={styles.methodNotes}>No method record.</Text>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: active ? colors.redSoft : colors.greenSoft }]}
                    onPress={() => setStatus(e.id, active ? "expired" : "active")}
                  >
                    <Text style={{ color: active ? colors.red : colors.green, fontWeight: font.bold, fontSize: font.small }}>
                      {active ? "Expire" : "Reactivate"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.surfaceHi }]} onPress={() => remove(e.id)}>
                    <Text style={{ color: colors.textDim, fontWeight: font.bold, fontSize: font.small }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sourceNote: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    backgroundColor: "rgba(96,165,250,0.07)", borderWidth: 1, borderColor: "rgba(96,165,250,0.25)",
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  sourceNoteText: { flex: 1, color: colors.textDim, fontSize: font.caption, lineHeight: 17 },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.gold, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  newBtnText: { color: colors.ink, fontWeight: font.bold, fontSize: font.small },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl },
  cardTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginBottom: spacing.md },
  fieldLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.semibold, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.bg, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.small },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },
  formRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  methodBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  methodHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  methodTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1 },
  calcRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "flex-end" },
  calcOut: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  calcText: { color: colors.text, fontSize: font.caption, fontWeight: font.semibold },
  publishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.green, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  publishText: { color: colors.ink, fontWeight: font.heavy, fontSize: font.body },
  edgeCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, overflow: "hidden" },
  edgeHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  edgeMatchup: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  edgeMeta: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  edgePct: { color: colors.gold, fontSize: font.title, fontWeight: font.heavy },
  edgeBody: { borderTopWidth: 1, borderTopColor: colors.borderSoft, padding: spacing.lg },
  methodView: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: "rgba(245,184,65,0.2)" },
  methodViewTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 0.5, marginBottom: spacing.sm },
  lineRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  lineBook: { flex: 1, color: colors.text, fontSize: font.small, fontWeight: font.semibold },
  lineType: { width: 60, color: colors.textMuted, fontSize: font.caption },
  lineJuice: { width: 90, textAlign: "right", color: colors.text, fontSize: font.small, fontWeight: font.bold },
  methodNotes: { color: colors.textDim, fontSize: font.caption, marginTop: spacing.sm, fontStyle: "italic" },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.sm },
});

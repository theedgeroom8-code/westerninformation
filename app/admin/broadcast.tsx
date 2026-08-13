import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "../../lib/supabase";
import { colors, spacing, radius, font } from "../../theme";
import { showError } from "../../lib/errors";
import { toast, confirmAction } from "../../lib/toast";

export default function AdminBroadcast() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("broadcasts").select("*").order("created_at", { ascending: false });
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-broadcasts")
      .on("postgres_changes", { event: "*", schema: "public", table: "broadcasts" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const send = async () => {
    if (!title.trim() || !message.trim()) { toast("info", "Missing fields", "Title and message are required."); return; }
    setSending(true);
    const { error } = await supabase.from("broadcasts").insert({ title: title.trim(), message: message.trim() });
    setSending(false);
    if (error) { showError(error, "Send failed"); return; }
    setTitle(""); setMessage("");
    toast("success", "Broadcast sent", "Every user sees it in their Alerts tab in real time.");
  };

  const remove = async (id: string) => {
    const ok = await confirmAction("Delete broadcast?", "It will disappear from every user's Alerts tab.");
    if (!ok) return;
    const { error } = await supabase.from("broadcasts").delete().eq("id", id);
    if (error) { showError(error, "Delete failed"); return; }
    toast("success", "Broadcast deleted");
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Broadcast</Text>
      <Text style={styles.sub}>Send an announcement to every user — appears instantly in their Alerts tab</Text>

      <View style={styles.card}>
        <Text style={styles.label}>TITLE</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Scheduled maintenance tonight" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>MESSAGE</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={message}
          onChangeText={setMessage}
          placeholder="Alerts will pause between 2–3 AM ET while we upgrade the data feed."
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} activeOpacity={0.85}>
          <Ionicons name="megaphone" size={16} color={colors.ink} />
          <Text style={styles.sendText}>{sending ? "Sending…" : "Send to All Users"}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>SENT</Text>
      {items.map((b) => (
        <View key={b.id} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle}>{b.title}</Text>
            <Text style={styles.itemMsg}>{b.message}</Text>
            <Text style={styles.itemTime}>{formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}</Text>
          </View>
          <TouchableOpacity onPress={() => remove(b.id)} style={styles.delBtn}>
            <Ionicons name="trash-outline" size={16} color={colors.red} />
          </TouchableOpacity>
        </View>
      ))}
      {items.length === 0 && <Text style={styles.empty}>Nothing sent yet.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.bg, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.body },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  sendText: { color: colors.ink, fontWeight: font.heavy, fontSize: font.body },
  sectionTitle: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.xxl, marginBottom: spacing.sm },
  item: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  itemMsg: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  itemTime: { color: colors.textMuted, fontSize: font.caption, marginTop: 4 },
  delBtn: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.redSoft, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textMuted, fontSize: font.small },
});

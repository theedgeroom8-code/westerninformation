import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { showError } from "../../lib/errors";
import { toast, confirmAction } from "../../lib/toast";
import { formatInvite } from "../../lib/invite";
import { copyText } from "../../lib/clipboard";
import { colors, spacing, radius, font } from "../../theme";

const USES = [1, 5, 10, 25];
const EXPIRY: Array<{ label: string; days: number | null }> = [
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "Never", days: null },
];

type Status = "active" | "used" | "expired" | "revoked";

const statusOf = (i: any): Status =>
  i.revoked ? "revoked"
  : i.expires_at && new Date(i.expires_at).getTime() < Date.now() ? "expired"
  : i.uses >= i.max_uses ? "used"
  : "active";

const STATUS_STYLE: Record<Status, { label: string; color: string; bg: string }> = {
  active: { label: "ACTIVE", color: colors.green, bg: colors.greenSoft },
  used: { label: "USED", color: colors.gold, bg: colors.goldSoft },
  expired: { label: "EXPIRED", color: colors.textMuted, bg: colors.surfaceHi },
  revoked: { label: "REVOKED", color: colors.red, bg: colors.redSoft },
};

const linkFor = (code: string) => `${window.location.origin}/signup?invite=${code}`;

export default function AdminInvites() {
  const [invites, setInvites] = useState<any[]>([]);
  const [inviteOnly, setInviteOnly] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState<number | null>(14);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: inv }, { data: cfg }] = await Promise.all([
      supabase.from("invites").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("app_config").select("value").eq("key", "invite_only").maybeSingle(),
    ]);
    setInvites(inv ?? []);
    setInviteOnly(cfg ? cfg.value !== false : true);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-invites")
      .on("postgres_changes", { event: "*", schema: "public", table: "invites" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_config" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const counts = useMemo(() => {
    const c = { active: 0, used: 0, expired: 0, revoked: 0 };
    invites.forEach((i) => { c[statusOf(i)] += 1; });
    return c;
  }, [invites]);

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    if (ok) toast("success", "Copied", what);
    else toast("error", "Couldn't copy", "Select the text and copy it manually.");
  };

  const create = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc("admin_create_invite", {
        p_email: email.trim() || null,
        p_note: note.trim() || null,
        p_max_uses: uses,
        p_days: days,
      });
      if (error) throw error;
      setFresh(data as string);
      setEmail(""); setNote("");
      toast("success", "Invite created", "Copy the code or link below and send it.");
      load();
    } catch (e: any) {
      showError(e, "Couldn't create invite");
    } finally {
      setCreating(false);
    }
  };

  const act = async (i: any, action: "revoke" | "restore" | "reset" | "delete") => {
    if (action === "delete") {
      const ok = await confirmAction("Delete this invite?", "It will stop working and disappear from this list.");
      if (!ok) return;
    }
    if (action === "revoke") {
      const ok = await confirmAction("Revoke this invite?", "It will stop working immediately. You can restore it later.");
      if (!ok) return;
    }
    const { error } = await supabase.rpc("admin_set_invite", { p_id: i.id, p_action: action });
    if (error) { showError(error, "Update failed"); return; }
    load();
  };

  const toggleInviteOnly = async (next: boolean) => {
    if (!next) {
      const ok = await confirmAction(
        "Open sign-up to everyone?",
        "Anyone who finds the site will be able to create an account without an invite. You can switch this back at any time."
      );
      if (!ok) return;
    }
    const { error } = await supabase
      .from("app_config")
      .update({ value: next, updated_at: new Date().toISOString() })
      .eq("key", "invite_only");
    if (error) { showError(error, "Update failed"); return; }
    setInviteOnly(next);
    toast("success", next ? "Invite-only is ON" : "Sign-up is now open", next ? "New accounts need a valid invite." : "Anyone can create an account.");
  };

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} style={[styles.chip, on && styles.chipOn]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.chipText, on && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Invites</Text>
      <Text style={styles.sub}>
        {counts.active} active · {counts.used} used · {counts.expired + counts.revoked} expired/revoked
      </Text>

      {/* master switch */}
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Invite-only sign-up</Text>
            <Text style={styles.cardHint}>
              {inviteOnly === false
                ? "Sign-up is OPEN — anyone can create an account."
                : "New accounts need a valid invite code. Existing users are not affected."}
            </Text>
          </View>
          <Switch
            value={inviteOnly !== false}
            onValueChange={toggleInviteOnly}
            disabled={inviteOnly === null}
            trackColor={{ false: colors.surfaceHi, true: "rgba(245,184,65,0.4)" }}
            thumbColor={inviteOnly !== false ? colors.gold : colors.textMuted}
          />
        </View>
      </View>

      {/* create */}
      <View style={[styles.card, { marginTop: spacing.lg }]}>
        <Text style={styles.cardTitle}>Create an invite</Text>

        <Text style={styles.label}>Lock to one email address (optional)</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="friend@email.com — leave blank to allow any email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>Note for yourself (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Mike — Tuesday group"
          placeholderTextColor={colors.textMuted}
          maxLength={120}
          style={styles.input}
        />

        <View style={styles.optionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>People who can use it</Text>
            <View style={styles.chips}>{USES.map((n) => chip(String(n), uses === n, () => setUses(n)))}</View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Expires</Text>
            <View style={styles.chips}>{EXPIRY.map((e) => chip(e.label, days === e.days, () => setDays(e.days)))}</View>
          </View>
        </View>

        <TouchableOpacity style={[styles.createBtn, creating && { opacity: 0.6 }]} onPress={create} disabled={creating} activeOpacity={0.85}>
          <Ionicons name="ticket" size={16} color={colors.ink} />
          <Text style={styles.createText}>{creating ? "Creating…" : "Create invite"}</Text>
        </TouchableOpacity>

        {fresh && (
          <View style={styles.freshBox}>
            <Text style={styles.freshLabel}>NEW INVITE — send this to your guest</Text>
            <Text style={styles.freshCode} selectable>{formatInvite(fresh)}</Text>
            <Text style={styles.freshLink} selectable>{linkFor(fresh)}</Text>
            <View style={styles.freshActions}>
              <TouchableOpacity style={styles.miniBtn} onPress={() => copy(formatInvite(fresh), "Invite code copied")} activeOpacity={0.8}>
                <Ionicons name="copy-outline" size={13} color={colors.textDim} />
                <Text style={styles.miniText}>Copy code</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.miniBtn} onPress={() => copy(linkFor(fresh), "Invite link copied")} activeOpacity={0.8}>
                <Ionicons name="link-outline" size={13} color={colors.textDim} />
                <Text style={styles.miniText}>Copy link</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* list */}
      <Text style={styles.sectionTitle}>ALL INVITES</Text>
      <View style={styles.card}>
        {invites.map((i, idx) => {
          const st = statusOf(i);
          const s = STATUS_STYLE[st];
          return (
            <View key={i.id} style={[styles.row, idx < invites.length - 1 && styles.rowBorder]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.code} selectable>{formatInvite(i.code)}</Text>
                  <View style={[styles.badge, { backgroundColor: s.bg }]}>
                    <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
                  </View>
                </View>
                <Text style={styles.meta} numberOfLines={2}>
                  {i.note ? `${i.note} · ` : ""}
                  {i.email ? `locked to ${i.email} · ` : ""}
                  used {i.uses}/{i.max_uses}
                  {i.expires_at ? ` · ${st === "expired" ? "expired" : "expires"} ${format(new Date(i.expires_at), "MMM dd")}` : " · no expiry"}
                  {` · created ${format(new Date(i.created_at), "MMM dd")}`}
                </Text>
                {i.redeemed_by?.length > 0 && (
                  <Text style={styles.redeemed} numberOfLines={2}>Joined: {i.redeemed_by.join(", ")}</Text>
                )}
              </View>
              <View style={styles.actions}>
                {st === "active" && (
                  <TouchableOpacity style={styles.miniBtn} onPress={() => copy(linkFor(i.code), "Invite link copied")} activeOpacity={0.8}>
                    <Ionicons name="link-outline" size={13} color={colors.textDim} />
                    <Text style={styles.miniText}>Link</Text>
                  </TouchableOpacity>
                )}
                {st === "active" && (
                  <TouchableOpacity style={styles.miniBtn} onPress={() => act(i, "revoke")} activeOpacity={0.8}>
                    <Text style={styles.miniText}>Revoke</Text>
                  </TouchableOpacity>
                )}
                {st === "revoked" && (
                  <TouchableOpacity style={styles.miniBtn} onPress={() => act(i, "restore")} activeOpacity={0.8}>
                    <Text style={styles.miniText}>Restore</Text>
                  </TouchableOpacity>
                )}
                {(st === "used" || st === "expired") && (
                  <TouchableOpacity style={styles.miniBtn} onPress={() => act(i, "reset")} activeOpacity={0.8}>
                    <Text style={styles.miniText}>Reopen</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.miniBtn, { backgroundColor: colors.redSoft }]} onPress={() => act(i, "delete")} activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={13} color={colors.red} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {loaded && invites.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="ticket-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>No invites yet</Text>
            <Text style={styles.emptyHint}>Create one above and send the code or link to your first guest.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy },
  sub: { color: colors.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  cardHint: { color: colors.textDim, fontSize: font.caption, marginTop: 3, lineHeight: 17 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  label: { color: colors.textMuted, fontSize: font.caption, fontWeight: font.bold, marginTop: spacing.lg, marginBottom: 6 },
  input: {
    color: colors.text, fontSize: font.small, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, outlineStyle: "none" as any,
  },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold,
    borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.xl,
  },
  createText: { color: colors.ink, fontSize: font.small, fontWeight: font.bold },
  freshBox: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.goldSoft,
    borderWidth: 1, borderColor: "rgba(245,184,65,0.35)",
  },
  freshLabel: { color: colors.gold, fontSize: 10, fontWeight: font.bold, letterSpacing: 1.2 },
  freshCode: { color: colors.text, fontSize: 26, fontWeight: font.heavy, letterSpacing: 3, marginTop: 6, fontVariant: ["tabular-nums"] },
  freshLink: { color: colors.textDim, fontSize: font.caption, marginTop: 4 },
  freshActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { color: colors.textMuted, fontSize: 10, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  code: { color: colors.text, fontSize: font.body, fontWeight: font.heavy, letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 9, fontWeight: font.heavy, letterSpacing: 0.8 },
  meta: { color: colors.textMuted, fontSize: font.caption, marginTop: 3, lineHeight: 16 },
  redeemed: { color: colors.textDim, fontSize: font.caption, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 260 },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceHi, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm },
  miniText: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold },
  emptyBox: { alignItems: "center", paddingVertical: spacing.xxl, gap: 4 },
  emptyText: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold },
  emptyHint: { color: colors.textMuted, fontSize: font.caption, textAlign: "center" },
});

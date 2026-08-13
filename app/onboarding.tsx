import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { useAuthStore } from "../store/authStore";
import { useBettingStore, ALL_SPORTS } from "../store/bettingStore";
import { colors, spacing, radius, font, shadow } from "../theme";
import { showError } from "../lib/errors";
import { webMaxWidth } from "../lib/responsive";

const STEPS = 3;

export default function OnboardingScreen() {
  const { user, completeOnboarding } = useAuthStore();
  const { toggleSport, settings } = useBettingStore();
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("10000");
  const [kelly, setKelly] = useState(25);
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await completeOnboarding(parseFloat(amount) || 10000, kelly);
      // hasOnboarded flips → root guard routes into the app.
    } catch (e: any) {
      showError(e, "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const next = () => (step < STEPS - 1 ? setStep(step + 1) : finish());

  return (
    <Screen>
      {/* progress dots */}
      <View style={styles.progress}>
        {step > 0 ? (
          <TouchableOpacity onPress={() => setStep(step - 1)} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color={colors.textDim} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
        <View style={styles.dots}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity onPress={finish} hitSlop={10}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, webMaxWidth(520)]} keyboardShouldPersistTaps="handled">

          {/* STEP 0 — value tutorial (no method revealed) */}
          {step === 0 && (
            <View style={{ flex: 1 }}>
              <View style={styles.badge}>
                <Ionicons name="flash" size={28} color={colors.gold} />
              </View>
              <Text style={styles.greeting}>Welcome{user?.name ? `, ${user.name}` : ""} 👋</Text>
              <Text style={styles.heading}>How Edge System helps you</Text>

              <View style={styles.featureList}>
                {[
                  { icon: "notifications", title: "Instant edge alerts", desc: "Get notified the moment a sportsbook posts a price worth betting." },
                  { icon: "calculator", title: "Smart bet sizing", desc: "Every alert includes a recommended wager based on your bankroll." },
                  { icon: "trending-up", title: "Track your results", desc: "Log bets, enter results, and watch your bankroll and ROI grow." },
                ].map((f) => (
                  <View key={f.title} style={styles.feature}>
                    <View style={styles.featureIcon}>
                      <Ionicons name={f.icon as any} size={20} color={colors.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureTitle}>{f.title}</Text>
                      <Text style={styles.featureDesc}>{f.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* STEP 1 — bankroll + risk */}
          {step === 1 && (
            <View style={{ flex: 1 }}>
              <View style={styles.badge}>
                <Ionicons name="wallet" size={28} color={colors.gold} />
              </View>
              <Text style={styles.heading}>Set your starting bankroll</Text>
              <Text style={styles.sub}>Bet sizing is calculated from this. You can change it any time.</Text>

              <View style={styles.amountCard}>
                <Text style={styles.amountLabel}>STARTING BANKROLL</Text>
                <View style={styles.amountRow}>
                  <Text style={styles.dollar}>$</Text>
                  <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="10000" placeholderTextColor={colors.textMuted} />
                </View>
                <View style={styles.quickRow}>
                  {[1000, 5000, 10000, 25000].map((v) => (
                    <TouchableOpacity key={v} style={styles.quickChip} onPress={() => setAmount(String(v))} activeOpacity={0.8}>
                      <Text style={styles.quickText}>${v / 1000}k</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <Text style={styles.kellyTitle}>RISK LEVEL</Text>
              <View style={styles.kellyRow}>
                {[{ v: 10, label: "Conservative" }, { v: 25, label: "Recommended" }, { v: 33, label: "Aggressive" }].map((opt) => (
                  <TouchableOpacity key={opt.v} style={[styles.kellyOpt, kelly === opt.v && styles.kellyOptActive]} onPress={() => setKelly(opt.v)} activeOpacity={0.85}>
                    <Text style={[styles.kellyPct, kelly === opt.v && { color: colors.ink }]}>{opt.v}%</Text>
                    <Text style={[styles.kellyLabel, kelly === opt.v && { color: "rgba(10,14,23,0.7)" }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* STEP 2 — preferred sports */}
          {step === 2 && (
            <View style={{ flex: 1 }}>
              <View style={styles.badge}>
                <Ionicons name="trophy" size={28} color={colors.gold} />
              </View>
              <Text style={styles.heading}>Which sports do you follow?</Text>
              <Text style={styles.sub}>We'll prioritize alerts for your leagues. You can change this later.</Text>

              <View style={styles.sportsWrap}>
                {ALL_SPORTS.map((sport) => {
                  const active = settings.preferredSports.includes(sport);
                  return (
                    <TouchableOpacity key={sport} onPress={() => toggleSport(sport)} activeOpacity={0.8} style={[styles.sportChip, active && styles.sportChipActive]}>
                      {active && <Ionicons name="checkmark-circle" size={16} color={colors.ink} />}
                      <Text style={[styles.sportChipText, active && { color: colors.ink }]}>{sport}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ flex: 1 }} />
          <Button
            label={step < STEPS - 1 ? "Continue" : "Start Finding Edges"}
            icon={step < STEPS - 1 ? "arrow-forward" : "flash"}
            onPress={next}
            loading={saving}
            style={{ marginTop: spacing.xl }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 22, backgroundColor: colors.gold },
  skip: { color: colors.textDim, fontSize: font.body, fontWeight: font.semibold },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  greeting: { color: colors.textDim, fontSize: font.body, marginBottom: 4 },
  heading: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.xl },
  featureList: { marginTop: spacing.xl, gap: spacing.lg },
  feature: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  featureIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" },
  featureTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  featureDesc: { color: colors.textDim, fontSize: font.small, lineHeight: 20, marginTop: 2 },
  amountCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, ...shadow.soft, marginBottom: spacing.xl },
  amountLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5 },
  amountRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  dollar: { color: colors.textDim, fontSize: font.display, fontWeight: font.bold },
  amountInput: { flex: 1, color: colors.text, fontSize: font.display, fontWeight: font.heavy, letterSpacing: -1, padding: 0, marginLeft: 4 },
  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  quickChip: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  quickText: { color: colors.textDim, fontWeight: font.bold, fontSize: font.small },
  kellyTitle: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginBottom: spacing.sm },
  kellyRow: { flexDirection: "row", gap: spacing.sm },
  kellyOpt: { flex: 1, alignItems: "center", paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kellyOptActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  kellyPct: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  kellyLabel: { color: colors.textMuted, fontSize: 10, fontWeight: font.semibold, marginTop: 2 },
  sportsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sportChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  sportChipText: { color: colors.textDim, fontSize: font.body, fontWeight: font.bold },
});

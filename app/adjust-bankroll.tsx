import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { TextField } from "../components/TextField";
import { Button } from "../components/Button";
import { useBettingStore } from "../store/bettingStore";
import { colors, spacing, radius, font } from "../theme";
import { showError } from "../lib/errors";
import { webMaxWidth } from "../lib/responsive";
import { safeBack } from "../lib/nav";

export default function AdjustBankrollScreen() {
  const router = useRouter();
  const { bankroll, adjustBankroll } = useBettingStore();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const value = parseFloat(amount) || 0;
  const newBalance = mode === "deposit" ? bankroll + value : bankroll - value;

  const submit = async () => {
    if (value <= 0) { showError("Enter an amount greater than zero.", "Invalid amount"); return; }
    if (mode === "withdraw" && value > bankroll) { showError("You can't withdraw more than your balance.", "Insufficient balance"); return; }
    const delta = mode === "deposit" ? value : -value;
    const label = reason.trim() || (mode === "deposit" ? "Manual deposit" : "Manual withdrawal");
    setSaving(true);
    try {
      await adjustBankroll(delta, label);
      safeBack(router, "/(tabs)");
    } catch (e: any) {
      showError(e, "Couldn't update balance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Adjust Balance</Text>
        <TouchableOpacity onPress={() => safeBack(router, "/(tabs)")} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.body, webMaxWidth(520)]}>
          <Text style={styles.currentLabel}>CURRENT BALANCE</Text>
          <Text style={styles.current}>${bankroll.toLocaleString()}</Text>

          <View style={styles.toggle}>
            {(["deposit", "withdraw"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.toggleBtn, mode === m && styles.toggleBtnActive]}
                onPress={() => setMode(m)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={m === "deposit" ? "arrow-down-circle" : "arrow-up-circle"}
                  size={18}
                  color={mode === m ? colors.ink : colors.textDim}
                />
                <Text style={[styles.toggleText, mode === m && { color: colors.ink }]}>
                  {m === "deposit" ? "Deposit" : "Withdraw"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>AMOUNT</Text>
          <View style={styles.amountRow}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
          </View>

          <TextField
            label="Reason (optional)"
            value={reason}
            onChangeText={setReason}
            placeholder={mode === "deposit" ? "e.g. Cash deposit" : "e.g. Withdrawal to bank"}
            icon="create-outline"
          />

          <View style={styles.preview}>
            <Text style={styles.previewLabel}>New balance</Text>
            <Text style={[styles.previewValue, { color: newBalance >= bankroll ? colors.green : colors.red }]}>
              ${newBalance.toLocaleString()}
            </Text>
          </View>

          <View style={{ flex: 1 }} />
          <Button
            label={mode === "deposit" ? "Add Funds" : "Withdraw Funds"}
            icon="checkmark-circle"
            onPress={submit}
            loading={saving}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.text, fontSize: font.title, fontWeight: font.heavy },
  closeBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  currentLabel: { color: colors.textDim, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5 },
  current: { color: colors.text, fontSize: font.h1, fontWeight: font.heavy, marginTop: 2, marginBottom: spacing.xl },
  toggle: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, borderRadius: radius.sm },
  toggleBtnActive: { backgroundColor: colors.gold },
  toggleText: { color: colors.textDim, fontWeight: font.bold, fontSize: font.body },
  fieldLabel: { color: colors.textDim, fontSize: font.small, fontWeight: font.semibold, marginBottom: spacing.sm },
  amountRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  dollar: { color: colors.textDim, fontSize: font.h1, fontWeight: font.bold },
  amountInput: { flex: 1, color: colors.text, fontSize: font.h1, fontWeight: font.heavy, paddingVertical: spacing.md, marginLeft: 4 },
  preview: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  previewLabel: { color: colors.textDim, fontSize: font.body },
  previewValue: { fontSize: font.h2, fontWeight: font.heavy },
});

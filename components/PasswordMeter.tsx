import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { passwordStrength } from "../lib/validate";
import { colors, spacing, font } from "../theme";

const BAR_COLORS = ["#e5484d", "#e5484d", "#f5a623", "#f5b841", "#30a46c"];

/** Live password strength meter — 4 bars + label + first unmet requirement. */
export function PasswordMeter({ password }: { password: string }) {
  if (!password) return null;
  const s = passwordStrength(password);
  const color = BAR_COLORS[s.score];
  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.bar, { backgroundColor: i <= s.score ? color : colors.surfaceHi }]} />
        ))}
        <Text style={[styles.label, { color }]}>{s.label}</Text>
      </View>
      {!!s.hint && !s.ok && <Text style={styles.hint}>{s.hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: -spacing.sm, marginBottom: spacing.md },
  bars: { flexDirection: "row", alignItems: "center", gap: 5 },
  bar: { flex: 1, height: 4, borderRadius: 2, maxWidth: 52 },
  label: { fontSize: font.caption, fontWeight: font.bold, marginLeft: spacing.sm },
  hint: { color: colors.textMuted, fontSize: font.caption, marginTop: 5 },
});

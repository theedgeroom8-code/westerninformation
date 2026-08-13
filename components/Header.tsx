import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { webMaxWidth } from "../lib/responsive";
import { colors, spacing, font, radius } from "../theme";

interface HeaderProps {
  title: string;
  subtitle?: string;
  /** Ionicons name shown in the brand badge on the left. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional element rendered on the right (e.g. a status pill). */
  right?: React.ReactNode;
  /** Web: align the header with the screen's constrained content width. */
  maxWidth?: number;
}

// Branded screen header with proper top spacing so cards never touch it.
export const Header: React.FC<HeaderProps> = ({ title, subtitle, icon, right, maxWidth = 1160 }) => {
  return (
    <View style={[styles.wrap, webMaxWidth(maxWidth)]}>
      <View style={styles.left}>
        {icon && (
          <View style={styles.badge}>
            <Ionicons name={icon} size={20} color={colors.gold} />
          </View>
        )}
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      {right}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  left: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(245,184,65,0.25)",
  },
  title: {
    color: colors.text,
    fontSize: font.h2,
    fontWeight: font.heavy,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: font.small,
    marginTop: 2,
    fontWeight: font.regular,
  },
});

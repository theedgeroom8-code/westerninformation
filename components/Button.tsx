import React from "react";
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, shadow } from "../theme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  label, onPress, variant = "primary", icon, loading, disabled, style,
}) => {
  const isDisabled = disabled || loading;
  const tint =
    variant === "primary" ? colors.ink : variant === "secondary" ? colors.text : colors.gold;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.9}
      style={[
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={isDisabled ? colors.textMuted : tint} />}
          <Text
            style={[
              styles.label,
              { color: tint },
              isDisabled && { color: colors.textMuted },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
  },
  primary: { backgroundColor: colors.gold, ...shadow.soft },
  secondary: { backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: "transparent" },
  disabled: { backgroundColor: colors.surface, ...({ shadowOpacity: 0, elevation: 0 } as any) },
  label: { fontSize: font.body, fontWeight: font.heavy, letterSpacing: 0.3 },
});

import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

// Full-bleed gradient background + top safe-area inset.
// Every screen wraps in this so the status bar never overlaps content.
export const Screen: React.FC<ScreenProps> = ({ children, style }) => {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.bgGradientTop, colors.bgGradientBottom]}
      style={styles.fill}
    >
      <View style={[styles.fill, { paddingTop: insets.top }, style]}>{children}</View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

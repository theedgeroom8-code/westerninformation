import { Stack } from "expo-router";
import { colors } from "../../theme";

// Anchor the group: when a guard bounces a visitor into (auth) without a
// specific child route, land on the marketing page — NOT the alphabetically
// first file (forgot-password), which used to hijack the URL bar.
export const unstable_settings = { initialRouteName: "landing" };

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "slide_from_right",
      }}
    >
      {/* landing first — signed-out users see the marketing page, not a raw login form */}
      <Stack.Screen name="landing" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}

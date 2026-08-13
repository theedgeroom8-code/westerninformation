import React, { useEffect, useRef } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuthStore } from "../store/authStore";
import { useBettingStore } from "../store/bettingStore";
import { registerForPush, attachNotificationDeepLinks } from "../lib/notifications";
import { UpdateGate } from "../components/UpdateGate";
import { ToastHost } from "../components/admin/ToastHost";
import { colors } from "../theme";

export default function RootLayout() {
  const { ready, isAuthenticated, isAdmin, hasOnboarded, pendingPasswordReset, pending2FA, user, init } = useAuthStore();
  const pushAlerts = useBettingStore((s) => s.settings.pushAlerts);
  const settingsLoaded = useBettingStore((s) => !s.loading);
  const router = useRouter();
  const pathname = usePathname();
  const adminRouted = useRef(false);

  useEffect(() => {
    init(); // restore Supabase session + subscribe to auth changes
  }, [init]);

  // Notification tap → deep link (no-op on web)
  useEffect(() => attachNotificationDeepLinks(), []);

  // On the website, admins land in the admin console (once per session —
  // they can still browse the user app afterwards via the sidebar).
  useEffect(() => {
    if (Platform.OS !== "web" || adminRouted.current) return;
    if (ready && isAuthenticated && isAdmin && !pathname?.startsWith("/admin")) {
      adminRouted.current = true;
      router.replace("/admin" as any);
    }
  }, [ready, isAuthenticated, isAdmin, pathname, router]);

  // Register this device for push once signed in + onboarded, respecting the
  // user's toggle. Silently no-ops in Expo Go / web (dev build required).
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (isAuthenticated && hasOnboarded && settingsLoaded && pushAlerts && user?.id) {
      registerForPush(user.id).catch(() => {});
    }
  }, [isAuthenticated, hasOnboarded, settingsLoaded, pushAlerts, user?.id]);

  if (!ready) {
    return (
      <>
        {Platform.OS === "web" && (
          <Head>
            <title>Edge System — Sports Betting Edge Tracker</title>
          </Head>
        )}
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      </>
    );
  }

  return (
    <SafeAreaProvider>
      {Platform.OS === "web" && (
        <Head>
          <title>Edge System — Sports Betting Edge Tracker</title>
        </Head>
      )}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "slide_from_right",
          }}
        >
          {/* Signed-out flow */}
          <Stack.Protected guard={!isAuthenticated}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>

          {/* Signed-in flow */}
          <Stack.Protected guard={isAuthenticated}>
            {/* 2FA challenge — the ONLY reachable screen until the TOTP
                code verifies (session is aal1 until then). */}
            <Stack.Protected guard={pending2FA}>
              <Stack.Screen name="verify-2fa" />
            </Stack.Protected>

            {/* Recovery session — the ONLY reachable screen until a new
                password is saved (prevents skipping the reset). */}
            <Stack.Protected guard={!pending2FA && pendingPasswordReset}>
              <Stack.Screen name="reset-password" />
            </Stack.Protected>

            <Stack.Protected guard={!pending2FA && !pendingPasswordReset}>
              <Stack.Protected guard={!hasOnboarded}>
                <Stack.Screen name="onboarding" />
              </Stack.Protected>

              <Stack.Protected guard={hasOnboarded}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="edge-detail" options={{ presentation: "modal" }} />
                <Stack.Screen name="adjust-bankroll" options={{ presentation: "modal" }} />
                <Stack.Screen name="settings" />
                <Stack.Screen name="two-factor" />
              </Stack.Protected>
            </Stack.Protected>
          </Stack.Protected>

          {/* Admin dashboard — reachable only by direct URL on web.
              Never linked from the mobile UI; its own layout enforces
              web-platform + admin-role, with its own login. */}
          <Stack.Screen name="admin" />
        </Stack>
        <UpdateGate />
        {/* Global toast surface — RN-web has no Alert, so every screen's
            toasts render through this single host (admin included). */}
        {Platform.OS === "web" && <ToastHost />}
        <StatusBar style="light" />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

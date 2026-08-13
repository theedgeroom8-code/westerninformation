import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // EXPO_PUBLIC_* vars are inlined when the dev server STARTS. If you edited
  // .env while the server was running, they are stale/missing.
  throw new Error(
    "Supabase env vars missing. Stop the dev server and restart with: npx expo start --clear"
  );
}

// During static web export there is no window — disable session persistence there.
const isServerRender = Platform.OS === "web" && typeof window === "undefined";

export const supabase = createClient(url, anonKey, {
  auth: {
    // Native uses AsyncStorage; web falls back to localStorage automatically.
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    persistSession: !isServerRender,
    autoRefreshToken: !isServerRender,
    detectSessionInUrl: false,
  },
});

// Sessions must survive indefinitely — the ONLY way out is the Logout button.
// On native, the token auto-refresh timer stops when the app is backgrounded;
// re-arm it on foreground so a phone left overnight comes back signed in.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  supabase.auth.startAutoRefresh();
}

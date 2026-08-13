import { create } from "zustand";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { User } from "../types";
import { useBettingStore } from "./bettingStore";

interface AuthStore {
  ready: boolean; // session restore finished — gate the router on this
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasOnboarded: boolean;
  pendingEmail: string | null; // set when signup needs OTP verification
  pendingPasswordReset: boolean; // recovery session active — must set a new password
  pending2FA: boolean; // signed in with password, but a TOTP code is still required

  init: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, phone: string, password: string) => Promise<"verified" | "needs_otp">;
  verifyOtp: (email: string, token: string) => Promise<void>;
  resendOtp: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  verifyRecovery: (email: string, token: string) => Promise<void>;
  completePasswordReset: (newPassword: string) => Promise<void>;
  verify2FA: (code: string) => Promise<void>;
  completeOnboarding: (startingBankroll: number, kellyFraction: number) => Promise<void>;
  logout: () => Promise<void>;
}

let initialized = false;

async function loadProfile(session: Session) {
  const uid = session.user.id;
  const [{ data: profile }, { data: bankroll }] = await Promise.all([
    supabase.from("profiles").select("id, name, email, phone, role").eq("id", uid).single(),
    supabase.from("bankrolls").select("starting_balance").eq("user_id", uid).single(),
  ]);
  const user: User = {
    id: uid,
    name: profile?.name || session.user.user_metadata?.name || "Bettor",
    email: profile?.email || session.user.email || "",
    phone: profile?.phone || undefined,
    role: (profile?.role as "user" | "admin") || "user",
  };
  return { user, hasOnboarded: Number(bankroll?.starting_balance || 0) > 0 };
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  ready: false,
  user: null,
  session: null,
  isAuthenticated: false,
  isAdmin: false,
  hasOnboarded: false,
  pendingEmail: null,
  pendingPasswordReset: false,
  pending2FA: false,

  init: () => {
    if (initialized) return;
    initialized = true;

    const apply = async (session: Session | null) => {
      if (!session) {
        useBettingStore.getState().teardown();
        set({ session: null, user: null, isAuthenticated: false, isAdmin: false, hasOnboarded: false, pendingPasswordReset: false, pending2FA: false, ready: true });
        return;
      }
      try {
        // 2FA-enrolled accounts sign in at assurance level 1 — hold the app
        // behind the code screen until the TOTP challenge upgrades to aal2.
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          set({ session, isAuthenticated: true, pending2FA: true, ready: true });
          return;
        }
        const { user, hasOnboarded } = await loadProfile(session);
        set({
          session,
          user,
          isAuthenticated: true,
          isAdmin: user.role === "admin",
          hasOnboarded,
          pendingEmail: null,
          pending2FA: false,
          ready: true,
        });
        // Load data + realtime once we know who's signed in.
        useBettingStore.getState().init(user.id);
      } catch {
        set({ session, isAuthenticated: true, ready: true });
      }
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Recovery link/OTP session — force the new-password screen.
        set({ pendingPasswordReset: true });
      }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
        // Token refresh doesn't change identity — skip the full reload.
        if (event === "TOKEN_REFRESHED") { set({ session }); return; }
        apply(session);
      }
    });
  },

  login: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  },

  signup: async (name, email, phone, password) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), phone: phone.trim() } },
    });
    if (error) throw new Error(error.message);
    if (data.session) return "verified"; // email confirmation disabled → straight in
    set({ pendingEmail: email.trim() });
    return "needs_otp"; // confirmation enabled → user enters the emailed code
  },

  verifyOtp: async (email, token) => {
    const attempt = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "signup" });
    if (attempt.error) {
      const retry = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (retry.error) throw new Error(retry.error.message);
    }
  },

  resendOtp: async (email) => {
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    if (error) throw new Error(error.message);
  },

  forgotPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) throw new Error(error.message);
  },

  verifyRecovery: async (email, token) => {
    // Flag BEFORE verifying so the router never flashes the main app between
    // the recovery session arriving and the new-password screen mounting.
    set({ pendingPasswordReset: true });
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "recovery" });
    if (error) {
      set({ pendingPasswordReset: false });
      throw new Error(error.message);
    }
  },

  completePasswordReset: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    set({ pendingPasswordReset: false });
  },

  verify2FA: async (code) => {
    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    if (fErr) throw new Error(fErr.message);
    const totp = factors?.totp?.[0];
    if (!totp) throw new Error("No authenticator is set up for this account.");
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
    if (cErr) throw new Error(cErr.message);
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: totp.id,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (vErr) throw new Error(vErr.message);
    // Session is now aal2 — run the normal sign-in path.
    set({ pending2FA: false });
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const { user, hasOnboarded } = await loadProfile(data.session);
      set({
        session: data.session,
        user,
        isAdmin: user.role === "admin",
        hasOnboarded,
        ready: true,
      });
      useBettingStore.getState().init(user.id);
    }
  },

  completeOnboarding: async (startingBankroll, kellyFraction) => {
    const { error } = await supabase.rpc("set_starting_bankroll", { p_amount: startingBankroll });
    if (error) throw new Error(error.message);
    await useBettingStore.getState().updateSettings({ kellyFraction });
    await useBettingStore.getState().refreshBankroll();
    set({ hasOnboarded: true });
  },

  logout: async () => {
    await supabase.auth.signOut();
  },
}));

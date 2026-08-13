import { create } from "zustand";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { recommendedWager } from "../lib/kelly";
import { webNotify } from "../lib/webNotify";
import { Edge, Bet, BankrollHistory, Settings, AlertItem, Broadcast, FeatureFlags } from "../types";

// Local-time quiet hours check for browser notifications (server push has
// its own timezone-aware check in the database).
const inLocalQuietHours = (s: Settings): boolean => {
  if (!s.quietHoursEnabled || s.quietStart === s.quietEnd) return false;
  const h = new Date().getHours();
  return s.quietStart < s.quietEnd
    ? h >= s.quietStart && h < s.quietEnd
    : h >= s.quietStart || h < s.quietEnd;
};

export const ALL_SPORTS = ["NFL", "NBA", "WNBA", "MLB", "NHL", "NCAAF", "NCAAB"];

// ---------- row mappers ----------
const toEdge = (r: any): Edge => ({
  id: r.id,
  sport: r.sport,
  league: r.league,
  matchup: r.matchup,
  betType: r.bet_type,
  specificBet: r.specific_bet,
  localBook: r.local_book,
  localOdds: r.local_odds,
  edgePercentage: Number(r.edge_pct),
  status: r.status,
  gameTime: new Date(r.game_time),
  alertTime: new Date(r.alert_time),
  rotationNumber: r.rotation_number ?? null,
});

const toBet = (r: any): Bet => ({
  id: r.id,
  edgeId: r.edge_id,
  edge: {
    sport: r.sport,
    matchup: r.matchup,
    betType: r.bet_type,
    specificBet: r.specific_bet,
    localBook: r.local_book,
    localOdds: r.local_odds,
    edgePercentage: Number(r.edge_pct),
  },
  kellyFraction: r.kelly_fraction,
  recommendedWager: Number(r.recommended_wager),
  actualWager: Number(r.actual_wager),
  result: r.result,
  profitLoss: r.profit_loss === null ? null : Number(r.profit_loss),
  dateLogged: new Date(r.date_logged),
  dateResulted: r.date_resulted ? new Date(r.date_resulted) : null,
});

const toHistory = (r: any): BankrollHistory => ({
  id: r.id,
  amount: Number(r.amount),
  previousAmount: Number(r.previous_amount),
  changeAmount: Number(r.change_amount),
  reason: r.reason,
  timestamp: new Date(r.created_at),
});

const toAlert = (r: any): AlertItem | null => {
  const e = r.edges;
  if (!e) return null;
  return {
    id: r.id,
    edgeId: r.edge_id,
    read: r.read,
    createdAt: new Date(r.created_at),
    sport: e.sport,
    matchup: e.matchup,
    betType: e.bet_type,
    specificBet: e.specific_bet,
    localBook: e.local_book,
    localOdds: e.local_odds,
    edgePercentage: Number(e.edge_pct),
    gameTime: new Date(e.game_time),
    alertTime: new Date(e.alert_time),
    rotationNumber: e.rotation_number ?? null,
  };
};

const toSettings = (r: any): Settings => ({
  kellyFraction: r.kelly_fraction,
  pushAlerts: r.push_alerts ?? true,
  smsAlerts: r.sms_alerts,
  highEdgeAlerts: r.high_edge_alerts,
  quietHoursEnabled: r.quiet_hours_enabled,
  quietStart: r.quiet_start,
  quietEnd: r.quiet_end,
  biometricUnlock: r.biometric_unlock,
  preferredSports: r.preferred_sports ?? [],
});

const DEFAULT_SETTINGS: Settings = {
  kellyFraction: 25,
  pushAlerts: true,
  smsAlerts: true,
  highEdgeAlerts: true,
  quietHoursEnabled: false,
  quietStart: 23,
  quietEnd: 8,
  biometricUnlock: false,
  preferredSports: ["NFL", "NBA", "MLB", "NHL"],
};

const DEFAULT_FLAGS: FeatureFlags = {
  alerts_enabled: true,
  maintenance_mode: false,
  responsible_gambling: false,
};

interface BettingStore {
  loading: boolean;
  userId: string | null;
  bankroll: number;
  startingBankroll: number;
  edges: Edge[];
  edgesUpdatedAt: number; // epoch ms of last edges load (for "updated Xs ago")
  bets: Bet[];
  alerts: AlertItem[];
  broadcasts: Broadcast[];
  bankrollHistory: BankrollHistory[];
  settings: Settings;
  flags: FeatureFlags;
  seenBroadcastsAt: Date;

  markBroadcastsSeen: () => Promise<void>;
  init: (userId: string) => Promise<void>;
  teardown: () => void;
  refreshEdges: () => Promise<void>;
  refreshBets: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshBroadcasts: () => Promise<void>;
  refreshBankroll: () => Promise<void>;
  refreshFlags: () => Promise<void>;

  recommendedWagerFor: (edge: { edgePercentage: number; localOdds: number }) => number;

  adjustBankroll: (changeAmount: number, reason: string) => Promise<void>;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  toggleSport: (sport: string) => Promise<void>;
  logBet: (edge: Edge, actualWager: number) => Promise<void>;
  settleBet: (betId: string, result: "win" | "loss" | "push") => Promise<void>;
  markAlertRead: (id: string) => Promise<void>;
  markAllAlertsRead: () => Promise<void>;
}

let channels: RealtimeChannel[] = [];
// Synchronous init guard — auth fires SIGNED_IN + getSession nearly together;
// without this, both calls race past an async check and double-subscribe
// the same realtime channels ("cannot add postgres_changes after subscribe").
let initializedFor: string | null = null;

const removeAllChannels = () => {
  channels.forEach((c) => supabase.removeChannel(c));
  channels = [];
};

export const useBettingStore = create<BettingStore>((set, get) => ({
  loading: true,
  userId: null,
  bankroll: 0,
  startingBankroll: 0,
  edges: [],
  edgesUpdatedAt: 0,
  bets: [],
  alerts: [],
  broadcasts: [],
  bankrollHistory: [],
  settings: DEFAULT_SETTINGS,
  flags: DEFAULT_FLAGS,
  seenBroadcastsAt: new Date(),

  markBroadcastsSeen: async () => {
    const userId = get().userId;
    const now = new Date();
    set({ seenBroadcastsAt: now });
    if (userId) {
      await supabase.from("user_settings")
        .update({ seen_broadcasts_at: now.toISOString() })
        .eq("user_id", userId);
    }
  },

  init: async (userId) => {
    if (initializedFor === userId) return; // already live or in flight
    initializedFor = userId;
    removeAllChannels();
    set({ userId, loading: true });

    // Initial load — everything in parallel.
    const [edgesQ, betsQ, alertsQ, broadcastsQ, bankrollQ, historyQ, settingsQ, flagsQ] = await Promise.all([
      supabase.from("edges").select("*").eq("status", "active").order("edge_pct", { ascending: false }),
      supabase.from("bets").select("*").order("date_logged", { ascending: false }),
      // inner join on ACTIVE edges — expired/deleted edges drop out of the
      // inbox automatically (stale alerts said "Edge not found" when tapped)
      supabase.from("user_alerts").select("*, edges!inner(*)").eq("edges.status", "active").order("created_at", { ascending: false }).limit(50),
      supabase.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("bankrolls").select("*").eq("user_id", userId).single(),
      supabase.from("bankroll_history").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("user_settings").select("*").eq("user_id", userId).single(),
      supabase.from("app_config").select("value").eq("key", "feature_flags").single(),
    ]);

    // A logout/re-init may have happened while we were fetching — bail out.
    if (initializedFor !== userId) return;

    set({
      edges: (edgesQ.data ?? []).map(toEdge),
      edgesUpdatedAt: Date.now(),
      bets: (betsQ.data ?? []).map(toBet),
      alerts: (alertsQ.data ?? []).map(toAlert).filter(Boolean) as AlertItem[],
      broadcasts: (broadcastsQ.data ?? []).map((r: any) => ({
        id: r.id, title: r.title, message: r.message, createdAt: new Date(r.created_at),
      })),
      bankroll: Number(bankrollQ.data?.balance ?? 0),
      startingBankroll: Number(bankrollQ.data?.starting_balance ?? 0),
      bankrollHistory: (historyQ.data ?? []).map(toHistory),
      settings: settingsQ.data ? toSettings(settingsQ.data) : DEFAULT_SETTINGS,
      seenBroadcastsAt: settingsQ.data?.seen_broadcasts_at
        ? new Date(settingsQ.data.seen_broadcasts_at)
        : new Date(),
      flags: { ...DEFAULT_FLAGS, ...(flagsQ.data?.value ?? {}) },
      loading: false,
    });

    // Report this device's UTC offset so server-side quiet hours run in the
    // user's local time (JS offset is minutes WEST; the server wants east).
    const deviceOffset = -new Date().getTimezoneOffset();
    supabase.from("user_settings").update({ tz_offset_min: deviceOffset }).eq("user_id", userId).then(() => {});

    // Realtime — RLS-scoped postgres_changes. Refetch the affected slice on
    // any event: simple, always-consistent, and the payloads stay tiny.
    const sub = (name: string, table: string, filter: string | undefined, onEvent: (payload?: any) => void) =>
      supabase
        .channel(name)
        .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, onEvent)
        .subscribe();

    channels = [
      sub("rt-edges", "edges", undefined, (payload) => {
        get().refreshEdges();
        get().refreshAlerts();
        // Browser notification for fresh edges (hidden tab only; web no-ops elsewhere)
        const s = get().settings;
        if (payload?.eventType === "INSERT" && payload.new && s.pushAlerts && !inLocalQuietHours(s)) {
          const e = payload.new;
          const odds = e.local_odds > 0 ? `+${e.local_odds}` : `${e.local_odds}`;
          webNotify(
            `⚡ ${Number(e.edge_pct).toFixed(1)}% Edge — ${e.sport}`,
            `${e.matchup}\n${e.rotation_number ? `#${e.rotation_number} · ` : ""}${e.specific_bet} @ ${e.local_book} (${odds})`
          );
        }
      }),
      sub("rt-alerts", "user_alerts", `user_id=eq.${userId}`, () => get().refreshAlerts()),
      sub("rt-broadcasts", "broadcasts", undefined, (payload) => {
        get().refreshBroadcasts();
        if (payload?.eventType === "INSERT" && payload.new) {
          webNotify(`📣 ${payload.new.title}`, payload.new.message ?? "");
        }
      }),
      sub("rt-bets", "bets", `user_id=eq.${userId}`, () => get().refreshBets()),
      sub("rt-bankroll", "bankrolls", `user_id=eq.${userId}`, () => get().refreshBankroll()),
      sub("rt-history", "bankroll_history", `user_id=eq.${userId}`, () => get().refreshBankroll()),
      sub("rt-flags", "app_config", "key=eq.feature_flags", () => get().refreshFlags()),
      // settings changed on another device/tab sync live
      sub("rt-settings", "user_settings", `user_id=eq.${userId}`, () => get().refreshSettings()),
    ];
  },

  teardown: () => {
    initializedFor = null;
    removeAllChannels();
    set({
      userId: null, loading: true, bankroll: 0, startingBankroll: 0,
      edges: [], edgesUpdatedAt: 0, bets: [], alerts: [], broadcasts: [], bankrollHistory: [],
      settings: DEFAULT_SETTINGS, flags: DEFAULT_FLAGS,
    });
  },

  refreshEdges: async () => {
    const { data } = await supabase.from("edges").select("*").eq("status", "active").order("edge_pct", { ascending: false });
    if (data) set({ edges: data.map(toEdge), edgesUpdatedAt: Date.now() });
  },

  refreshFlags: async () => {
    const { data } = await supabase.from("app_config").select("value").eq("key", "feature_flags").single();
    if (data?.value) set({ flags: { ...DEFAULT_FLAGS, ...data.value } });
  },

  refreshBets: async () => {
    const { data } = await supabase.from("bets").select("*").order("date_logged", { ascending: false });
    if (data) set({ bets: data.map(toBet) });
  },

  refreshAlerts: async () => {
    const { data } = await supabase.from("user_alerts").select("*, edges!inner(*)").eq("edges.status", "active").order("created_at", { ascending: false }).limit(50);
    if (data) set({ alerts: data.map(toAlert).filter(Boolean) as AlertItem[] });
  },

  refreshBroadcasts: async () => {
    const { data } = await supabase.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(20);
    if (data) set({
      broadcasts: data.map((r: any) => ({ id: r.id, title: r.title, message: r.message, createdAt: new Date(r.created_at) })),
    });
  },

  refreshSettings: async () => {
    const userId = get().userId;
    if (!userId) return;
    const { data } = await supabase.from("user_settings").select("*").eq("user_id", userId).single();
    if (data) {
      set({
        settings: toSettings(data),
        seenBroadcastsAt: data.seen_broadcasts_at ? new Date(data.seen_broadcasts_at) : get().seenBroadcastsAt,
      });
    }
  },

  refreshBankroll: async () => {
    const userId = get().userId;
    if (!userId) return;
    const [{ data: b }, { data: h }] = await Promise.all([
      supabase.from("bankrolls").select("*").eq("user_id", userId).single(),
      supabase.from("bankroll_history").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    set({
      bankroll: Number(b?.balance ?? 0),
      startingBankroll: Number(b?.starting_balance ?? 0),
      ...(h ? { bankrollHistory: h.map(toHistory) } : {}),
    });
  },

  // Kelly sizing from LIVE bankroll + user's fraction (brief §2.4, §7.2)
  recommendedWagerFor: (edge) => {
    const { bankroll, settings } = get();
    return recommendedWager(edge.edgePercentage, edge.localOdds, bankroll, settings.kellyFraction);
  },

  adjustBankroll: async (changeAmount, reason) => {
    const { error } = await supabase.rpc("adjust_bankroll", { p_change: changeAmount, p_reason: reason });
    if (error) throw new Error(error.message);
    await get().refreshBankroll();
  },

  updateSettings: async (partial) => {
    const prev = get().settings;
    const next = { ...prev, ...partial };
    set({ settings: next }); // optimistic — toggles feel instant
    const userId = get().userId;
    if (!userId) return;
    const { error } = await supabase.from("user_settings").update({
      kelly_fraction: next.kellyFraction,
      push_alerts: next.pushAlerts,
      sms_alerts: next.smsAlerts,
      high_edge_alerts: next.highEdgeAlerts,
      quiet_hours_enabled: next.quietHoursEnabled,
      quiet_start: next.quietStart,
      quiet_end: next.quietEnd,
      biometric_unlock: next.biometricUnlock,
      preferred_sports: next.preferredSports,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (error) set({ settings: prev }); // roll back on failure
  },

  toggleSport: async (sport) => {
    const cur = get().settings.preferredSports;
    const next = cur.includes(sport) ? cur.filter((s) => s !== sport) : [...cur, sport];
    await get().updateSettings({ preferredSports: next });
  },

  logBet: async (edge, actualWager) => {
    const rec = get().recommendedWagerFor(edge);
    const { error } = await supabase.rpc("log_bet", {
      p_edge_id: edge.id,
      p_actual_wager: actualWager,
      p_recommended_wager: rec,
      p_kelly_fraction: get().settings.kellyFraction,
    });
    if (error) throw new Error(error.message);
    await get().refreshBets();
  },

  settleBet: async (betId, result) => {
    const { error } = await supabase.rpc("settle_bet", { p_bet_id: betId, p_result: result });
    if (error) throw new Error(error.message);
    await Promise.all([get().refreshBets(), get().refreshBankroll()]);
  },

  markAlertRead: async (id) => {
    set({ alerts: get().alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) });
    await supabase.from("user_alerts").update({ read: true }).eq("id", id);
  },

  markAllAlertsRead: async () => {
    const userId = get().userId;
    set({ alerts: get().alerts.map((a) => ({ ...a, read: true })) });
    if (userId) await supabase.from("user_alerts").update({ read: true }).eq("user_id", userId).eq("read", false);
  },
}));

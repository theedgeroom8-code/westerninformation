// Shapes mirror the Supabase schema (see supabase/migrations/001_init.sql).
// NOTE: the "method" (fair price, sharp lines) is intentionally ABSENT from
// user-facing types — it lives in edge_method with admin-only RLS.

export interface Edge {
  id: string;
  sport: string;
  league: string;
  matchup: string;
  betType: string;
  specificBet: string;
  localBook: string;
  localOdds: number;
  edgePercentage: number;
  status: "active" | "expired";
  gameTime: Date;
  alertTime: Date;
  /** Official Nevada rotation number (e.g. 457) — quoted at the betting window. */
  rotationNumber: number | null;
}

// Snapshot of the edge at log time (stored flat on the bets row).
export interface BetEdgeSnapshot {
  sport: string;
  matchup: string;
  betType: string;
  specificBet: string;
  localBook: string;
  localOdds: number;
  edgePercentage: number;
}

export interface Bet {
  id: string;
  edgeId: string | null;
  edge: BetEdgeSnapshot;
  kellyFraction: number;
  recommendedWager: number;
  actualWager: number;
  result: "win" | "loss" | "push" | null;
  profitLoss: number | null;
  dateLogged: Date;
  dateResulted: Date | null;
}

export interface BankrollHistory {
  id: string;
  amount: number;
  previousAmount: number;
  changeAmount: number;
  reason: string;
  timestamp: Date;
}

export interface AlertItem {
  id: string;
  edgeId: string;
  read: boolean;
  createdAt: Date;
  // joined edge fields
  sport: string;
  matchup: string;
  betType: string;
  specificBet: string;
  localBook: string;
  localOdds: number;
  edgePercentage: number;
  gameTime: Date;
  alertTime: Date;
  rotationNumber: number | null;
}

export interface Broadcast {
  id: string;
  title: string;
  message: string;
  createdAt: Date;
}

export interface Settings {
  kellyFraction: number;
  pushAlerts: boolean; // system push notifications (FCM/APNs — next phase)
  smsAlerts: boolean;
  highEdgeAlerts: boolean;
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  biometricUnlock: boolean;
  preferredSports: string[];
}

export interface FeatureFlags {
  alerts_enabled: boolean;
  maintenance_mode: boolean;
  responsible_gambling: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "user" | "admin";
}

// ---------- Admin-only types (edge_method table) ----------
export interface BookLine {
  book: string;
  type: "fair" | "sharp" | "edge" | "local";
  juice: number;
  line?: string;
}

export interface EdgeMethod {
  edgeId: string;
  sharpFairPrice: number;
  noVigProb: number | null;
  bookLines: BookLine[];
  notes: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "user" | "admin";
  isActive: boolean;
  createdAt: Date;
  balance: number;
  betCount: number;
}

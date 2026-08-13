import { Alert, Platform } from "react-native";
import { toast } from "./toast";

// Central error → human message mapping. Screens never show raw
// Supabase/Postgres/network errors — everything routes through here.

const EXACT_MATCHES: Record<string, string> = {
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Please verify your email before signing in.",
  "User already registered": "An account with this email already exists. Try signing in.",
  "Bet already settled": "This bet has already been settled and can't be changed.",
  "Insufficient bankroll": "You can't withdraw more than your current balance.",
  "Edge not found": "This edge is no longer available.",
  "Edge no longer active": "This edge has expired — check the feed for live opportunities.",
  "Wager must be positive": "Enter a wager amount greater than zero.",
  "Wager exceeds your bankroll": "Your wager can't be larger than your current bankroll.",
  "Amount must be positive": "Enter an amount greater than zero.",
  "Amount must not be zero": "Enter an amount greater than zero.",
  "Amount is too large": "That amount is too large.",
  "Bankroll already set": "Your starting bankroll is already set. Use Adjust to deposit or withdraw.",
  "Account not ready yet": "Your account is still being set up. Try again in a moment.",
};

const PATTERN_MATCHES: Array<[RegExp, string]> = [
  [/rate limit|too many requests|429/i, "Too many attempts. Please wait a moment and try again."],
  [/network|fetch failed|failed to fetch|timeout|timed out|abort/i, "Connection problem. Check your internet and try again."],
  [/password.*(at least|too short|weak)|weak password/i, "Password must be at least 8 characters with letters and numbers."],
  [/invalid.*email|email.*invalid/i, "That doesn't look like a valid email address."],
  [/token.*(expired|invalid)|otp.*(expired|invalid)|invalid.*token/i, "That code is invalid or has expired. Request a new one."],
  [/jwt|refresh token|session/i, "Your session expired. Please sign in again."],
  [/duplicate key|unique constraint/i, "This already exists."],
  [/permission denied|row-level security|violates row-level/i, "You don't have permission to do that."],
  [/(email )?rate limit exceeded/i, "Email limit reached — try again in an hour."],
];

const FALLBACK = "Something went wrong. Please try again.";

/** Convert any thrown value into a clean, user-safe message. */
export function friendlyMessage(error: unknown): string {
  const raw =
    typeof error === "string" ? error
    : error instanceof Error ? error.message
    : (error as any)?.message ?? "";
  if (!raw) return FALLBACK;
  if (EXACT_MATCHES[raw]) return EXACT_MATCHES[raw];
  for (const [pattern, message] of PATTERN_MATCHES) {
    if (pattern.test(raw)) return message;
  }
  // Postgres RAISE EXCEPTION messages from our own RPCs are already written
  // for humans — pass short ones through, hide anything technical/long.
  if (raw.length <= 80 && !/[_{}<>\\]|pgrst|postgres|sql|schema|relation|column/i.test(raw)) return raw;
  if (__DEV__) console.warn("[error]", raw); // dev console only — never shown in UI
  return FALLBACK;
}

/** Standard error alert. Usage: catch (e) { showError(e) }
 *  Web uses toasts because react-native-web's Alert is a silent no-op. */
export function showError(error: unknown, title = "Oops") {
  if (Platform.OS === "web") {
    toast("error", title, friendlyMessage(error));
  } else {
    Alert.alert(title, friendlyMessage(error));
  }
}

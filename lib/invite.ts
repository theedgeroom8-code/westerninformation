import { supabase } from "./supabase";

// Invite-only sign-up helpers. The database is the real gatekeeper (trigger on
// auth.users); these are the friendly pre-checks so people get a clear message
// instead of a generic "database error".

export type InviteStatus = "ok" | "invalid" | "revoked" | "expired" | "used" | "email_mismatch";

export const INVITE_MESSAGES: Record<Exclude<InviteStatus, "ok">, string> = {
  invalid: "That invite code isn't valid. Check it and try again.",
  revoked: "That invite has been cancelled. Ask for a new one.",
  expired: "That invite has expired. Ask for a new one.",
  used: "That invite has already been used. Ask for a new one.",
  email_mismatch: "That invite was issued to a different email address. Use the email it was sent to.",
};

/** "abcde-fgh12" → "ABCDEFGH12" */
export const normalizeInvite = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "ABCDEFGH12" → "ABCDE-FGH12" (display only) */
export const formatInvite = (code: string): string => {
  const n = normalizeInvite(code);
  return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
};

/** Does sign-up currently need a code? Fails closed (true) if we can't tell. */
export async function signupRequiresInvite(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("signup_requires_invite");
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

export async function checkInvite(code: string, email: string): Promise<InviteStatus> {
  const { data, error } = await supabase.rpc("check_invite", { p_code: code, p_email: email.trim() });
  if (error) throw new Error(error.message);
  return (data as InviteStatus) ?? "invalid";
}

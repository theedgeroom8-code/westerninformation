// Client-side input validation. UX layer only — the database RPCs and CHECK
// constraints re-validate everything server-side (006_hardening.sql).

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

/** Optional field; when present must look like a phone number (7–15 digits). */
export const isValidPhone = (phone: string): boolean => {
  const trimmed = phone.trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return /^[0-9+()\s.-]{7,20}$/.test(trimmed) && digits.length >= 7 && digits.length <= 15;
};

export const isValidName = (name: string): boolean => {
  const t = name.trim();
  return t.length >= 2 && t.length <= 80;
};

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4; // bars filled
  label: string;
  ok: boolean; // meets the minimum bar to submit
  hint: string; // first unmet requirement, for inline help
}

/** Minimum: 8+ chars with letters and numbers. Score improves with case mix,
 *  symbols, and length — shown as a live meter on signup/reset. */
export function passwordStrength(pw: string): PasswordStrength {
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const longEnough = pw.length >= 8;

  const ok = longEnough && (hasLower || hasUpper) && hasDigit;

  let score = 0;
  if (longEnough) score++;
  if (hasLower && hasUpper) score++;
  if (hasDigit) score++;
  if (hasSymbol || pw.length >= 12) score++;

  const hint = !longEnough
    ? "Use at least 8 characters"
    : !hasDigit
    ? "Add a number"
    : !(hasLower && hasUpper)
    ? "Mix upper and lower case for a stronger password"
    : !hasSymbol
    ? "Add a symbol for a stronger password"
    : "";

  const label = !pw ? "" : score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  return { score: Math.min(score, 4) as PasswordStrength["score"], label, ok, hint };
}

/** Positive money amount within sane bounds. */
export const isValidAmount = (n: number, max = 100_000_000): boolean =>
  Number.isFinite(n) && n > 0 && n <= max;

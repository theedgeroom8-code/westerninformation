// Client-side input validation. UX layer only — the database RPCs and CHECK
// constraints re-validate everything server-side (006_hardening.sql).

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

// Domains that are always a slip of a popular provider — verification codes
// sent there bounce, locking the user out of their brand-new account.
const EMAIL_TYPOS: Record<string, string> = {
  "gmail.comm": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com",
  "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.comm": "yahoo.com",
  "hotmail.con": "hotmail.com", "hotmial.com": "hotmail.com", "hotmail.comm": "hotmail.com",
  "outlook.con": "outlook.com", "outlok.com": "outlook.com", "outlook.comm": "outlook.com",
  "iclod.com": "icloud.com", "icloud.con": "icloud.com", "icoud.com": "icloud.com",
};

/** Returns the corrected address for a known provider typo, else null. */
export function emailTypoSuggestion(email: string): string | null {
  const t = email.trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at < 1) return null;
  const domain = t.slice(at + 1);
  const fix = EMAIL_TYPOS[domain];
  return fix ? `${t.slice(0, at)}@${fix}` : null;
}

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

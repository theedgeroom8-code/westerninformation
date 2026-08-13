# Operations Guide — Running the System in Production

*Everything you (or the admin) do day-to-day, in one place. Updated 2026-08-11.*

---

## The Odds Engine

Lives entirely inside the database (pg_cron fires `engine_tick()` every minute).
There is **no server to keep running** — your laptop can be off.

| What | Where |
|---|---|
| Turn engine on/off | Admin → Config → Odds Engine toggle |
| Poll frequency | Admin → Config → Poll interval (15m–4h; 60m default) |
| Live status, credits left, activity log | Admin → Config → Odds Engine card (realtime) |
| Which sports/books it scans | Admin → Config → Monitored Sports / Sportsbooks (⚡ = auto-tracked) |
| Quality dials | Min edge threshold · pre-game cutoff · duplicate suppression |

**Built-in cost protection:** out-of-season sports are re-checked only every 6h;
polling pauses automatically when credits fall to the reserve (500); a rejected
key disables the engine instantly. Max 5 edges published per sport per scan
(strongest first) so users are never spammed.

### ⚠ Current blocker: the Odds API key is deactivated
The Odds API returned: *"API key is deactivated — cancelation or a failed payment."*
The client must renew the plan at https://the-odds-api.com. When you have a working key:

```bash
# 1. put the new key in .env as ODDS_API_KEY=...
npm run test-odds        # verify it works
npm run engine-secret    # store it server-side (private.secrets)
# 2. Admin → Config → toggle "Automatic edge detection" ON
npm run engine-test      # optional: watch a full live cycle from the terminal
```

The detection pipeline itself is fully verified without the API:
`npm run engine-selftest` runs 11 checks (no-vig math, dedup, drift expiry,
alert fan-out) through the exact production functions — all passing.

---

## Shipping app updates (OTA — no more APK reinstalls)

JS/UI changes now ship over the air:

```bash
npm run publish-update      # = eas update --channel preview
```

Every installed app checks on open (and daily thereafter) and shows an
**"Update available"** popup → user taps Update Now → new version applies in
seconds. No link, no reinstall.

**Exception:** adding a native package or changing app.json plugins/icons needs
a new build (`npx eas-cli build --profile preview --platform android`) and a
version bump in app.json — the popup can't deliver native code.

---

## Auth & security posture

- Passwords: 8+ chars with letters+numbers enforced in-app with a live meter.
- Password reset: Login → "Forgot password?" → emailed 6-digit code → new
  password screen (user is locked there until it's saved).
- Sessions never expire — only the Logout button signs a user out (token
  auto-refresh re-arms whenever the app foregrounds).
- Every RPC re-validates on the server: wager ≤ bankroll, positive amounts,
  bounded sizes, one-shot bankroll setup, one-shot bet settlement.
- The Odds API key + the method table (`edge_method`) are unreachable from
  any client — enforced by the database, not the UI.
- Alerts kill switch (Config → "Alerts enabled") now truly blocks all edge
  alerts, in-app and push.

### One-time Supabase dashboard tasks (only you can do these — see below)
1. **Auth → Emails → "Reset Password" template**: the body must include
   `{{ .Token }}` (the 6-digit code). Suggested body:
   `<p>Your Edge System password reset code is:</p><h2>{{ .Token }}</h2><p>It expires in 1 hour. If you didn't request this, ignore this email.</p>`
2. **Auth → Providers → Email**: set minimum password length to **8**.
3. Later (per roadmap): custom SMTP via Resend, then re-enable "Confirm email"
   with `{{ .Token }}` in the confirm-signup template too.

---

## Useful scripts

```bash
npm run migrate           # apply all SQL migrations (safe to re-run)
npm run verify-db         # sanity-check tables
npm run engine-selftest   # 11-check engine pipeline test (no API needed)
npm run engine-test       # live engine cycle against the real API
npm run engine-secret     # push ODDS_API_KEY from .env into the database
npm run test-odds         # is the API key alive?
npm run test-push         # send a test push to every registered device
npm run publish-update    # ship the current JS to all installed apps (OTA)
```

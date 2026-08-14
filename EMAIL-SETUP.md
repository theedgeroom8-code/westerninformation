# Email (SMTP) Setup — Resend + Supabase

Connects auth emails (signup codes, password reset codes) to your own domain
via Resend. Takes ~15 minutes; most of it is copy-paste.

> The Resend API key lives ONLY in `.env` as `RESEND_API_KEY`.
> Never paste it into this file, the repo, or Vercel.

---

## Part 1 — Verify your domain in Resend (one time)

1. Go to **resend.com → Domains → Add Domain**
2. Enter: `westerninformationnetwork.com` (region: default is fine)
3. Resend shows **3 DNS records**. Add them wherever you manage DNS for the
   domain (same place you added the Vercel A/CNAME records). They look like:

   | Type | Host / Name | Value | TTL |
   |------|-------------|-------|-----|
   | MX  | `send` | `feedback-smtp….amazonses.com` (priority 10) | 300 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | 300 |
   | TXT | `resend._domainkey` | `p=MIGfMA0…` (long DKIM key) | 300 |

   ⚠️ Copy the **exact values from the Resend dashboard** — the ones above are
   just the shape. Use TTL 300 like before.

4. Back in Resend, click **Verify DNS Records**. It usually turns green in
   1–10 minutes. Wait until the domain shows **Verified** before Part 2.

---

## Part 2 — Connect SMTP in Supabase

Supabase Dashboard → project `xgwprcqdfgueizkhcogq` →
**Authentication → Emails → SMTP Settings** → toggle **Enable Custom SMTP**:

| Field | Value |
|-------|-------|
| Sender email | `noreply@westerninformationnetwork.com` |
| Sender name | `Western Information Network` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the `RESEND_API_KEY` value from `.env` |

Click **Save**.

Then raise the send limit: **Authentication → Rate Limits** →
set **Rate limit for sending emails** to `100` per hour (default 30 is too
low for real users).

---

## Part 3 — Paste the email templates

**Authentication → Emails → Templates**. For each tab, set the subject and
replace the message body with the matching file from the `emails/` folder
(open the file, Ctrl+A, copy, paste into the body editor's `<> Source` view):

| Template tab | Subject | File |
|--------------|---------|------|
| Confirm signup | `Your verification code — Western Information Network` | `emails/confirm-signup.html` |
| Invite user | `You're invited to Western Information Network` | `emails/invite.html` |
| Magic link | `Your sign-in code — Western Information Network` | `emails/magic-link.html` |
| Change email address | `Confirm your new email — Western Information Network` | `emails/change-email.html` |
| Reset password | `Your password reset code — Western Information Network` | `emails/reset-password.html` |
| Reauthentication | `Confirm it's you — Western Information Network` | `emails/reauthentication.html` |

The app verifies **6-digit codes**, not links — every template shows
`{{ .Token }}` big and gold. Don't remove that placeholder.

---

## Part 4 — Turn confirmations on + URL config

1. **Authentication → Sign In / Providers → Email**:
   - **Confirm email**: ON  (new signups now must enter the emailed code —
     the app already handles this: signup → "enter code" screen)
   - **Email OTP expiration**: `3600` seconds
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://westerninformationnetwork.com`
   - **Redirect URLs** → add: `https://westerninformationnetwork.com/**`

---

## Part 5 — Test (2 minutes)

1. Open the site in a private/incognito window → **Get Started** → sign up
   with a real email you own (not one already registered).
2. Within ~30 seconds you should get **"Your verification code"** from
   `noreply@westerninformationnetwork.com` — dark card, gold 6-digit code.
3. Enter the code → you land in onboarding. ✅
4. Log out → **Sign In → Forgot password** → same flow with the reset email.
5. In Resend → **Emails** you'll see every send with delivery status —
   that's your debugging view if anything doesn't arrive.

If an email lands in spam the first time, that's normal for a brand-new
domain; it improves as the domain sends more.

---

## Costs & limits

- Resend free tier: **3,000 emails/month, 100/day** — plenty for launch.
- Auth emails only (codes, resets). Play alerts stay on push notifications,
  which are free and instant.

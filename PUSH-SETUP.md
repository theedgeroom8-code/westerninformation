# Push Notifications — Setup Guide

Everything in code + database is DONE. Push delivery works like this:

```
Admin publishes edge / broadcast
        │
        ▼
Postgres trigger (push_notify_edge / push_notify_broadcast)
  • filters: push_alerts ON, account active, not in quiet hours
  • personalizes: computes each user's Kelly wager from THEIR live bankroll
        │
        ▼  (pg_net async HTTP)
Expo Push API ──► FCM (Android) / APNs (iOS) ──► user's phone 🔔
```

Devices register their token into `push_tokens` automatically when a signed-in
user has Push Notifications ON (Settings → Alert Delivery).

## Why you don't see notifications yet

**Expo Go cannot receive remote push notifications** (removed in SDK 53+).
You need a one-time **development build** — your own installable APK that is
otherwise identical to Expo Go. After this, you scan the QR the same way.

## One-time setup (~30 minutes, needs your accounts)

### Step 1 — Firebase (Android push transport)
1. Go to https://console.firebase.google.com → **Add project** (e.g. "edge-system") — disable Analytics, it's not needed.
2. In the project: **Add app → Android**. Package name: `com.edgesystem.app` (must match app.json exactly).
3. Download **google-services.json** → put it in the project root
   (`sports-betting-edge/google-services.json`).
4. Add to `app.json` under `"android"`:
   ```json
   "googleServicesFile": "./google-services.json"
   ```

### Step 2 — Expo / EAS
```bash
npm install -g eas-cli
eas login                 # create a free account at expo.dev if you don't have one
eas init                  # links the project, writes extra.eas.projectId into app.json
```

### Step 3 — Give Expo your FCM key (so it can talk to Firebase)
1. Firebase Console → Project settings → **Service accounts** → *Generate new private key* (downloads a JSON).
2. Run `eas credentials` → select **Android** → **Google Service Account** →
   *Upload a key for FCM V1* → point it at that JSON.

### Step 4 — Build & install the dev build
```bash
eas build --profile development --platform android
```
Wait ~10-15 min → open the build link on your phone → install the APK.

### Step 5 — Run against the dev build
```bash
npx expo start --tunnel
```
Open the **development build** app (not Expo Go) → scan the QR → sign in →
Settings → make sure **Push Notifications** is ON (accept the permission).
Check it worked: the `push_tokens` table should now have a row (`npm run verify-db` or Supabase dashboard).

### Step 6 — Test 🎉
- `npm run test-push` — sends a test notification to every registered device, or
- Publish an edge from the admin console with the app **closed** — the phone should buzz with the personalized alert (edge %, bet, book, YOUR Kelly wager).

## Notes & current limitations
- **Quiet hours** are evaluated in UTC on the server for now (user timezones come later).
- **iOS** needs an Apple Developer account ($99/yr) — same flow, `eas build --platform ios`. Do Android first.
- **SMS (Twilio)** is separate and comes next: a trigger already filters `sms_alerts` users; we'll add a Twilio call the same way when the client wants to pay per-SMS.
- Stale tokens (uninstalled apps) are rejected harmlessly by Expo; a cleanup job can come later.

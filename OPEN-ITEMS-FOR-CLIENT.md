# Open Items — Games Board, Quarter/Half Lines & Alerts

*Everything from the "Edge Board" spec and your follow-up feedback is built and live. Below is
everything that's still an open question, a decision we made a default guess on, or something
we need from you to finish properly. Nothing here is blocking — the app works today — but your
answers will shape what we tune next.*

---

## 1. Needs a decision from you

**A. Odds API plan.** The current plan (20,000 credits/month) is enough for full-game lines on
a 15-minute refresh, but not enough to also refresh quarter/half lines every 5 minutes for every
game — that combination needs a bigger plan. Two options:
- Keep the current plan — quarter/half lines refresh every ~2 hours, capped per day, so we
  never risk running out mid-month.
- Upgrade the plan — the bigger the plan, the closer we can get to real-time quarter/half
  refresh. Let us know your budget and we'll size the right tier.

We also don't know your plan's exact monthly reset date — if you know it, tell us so we can pace
credit usage against it more precisely.

**B. Real text message (SMS) alerts.** You mentioned wanting alerts as an actual text message,
not just an in-app/push notification. That's a bigger job than reformatting the alert — it needs:
- A Twilio (or similar) account set up for sending texts
- Collecting and verifying users' phone numbers
- Carrier registration for business texting (A2P 10DLC) — this requires your business
  information and can take several business days to clear; it's a compliance step, not something
  we can skip or speed up from our side

Let us know if you want to move forward with this, and if so, who can supply the business
details Twilio will need.

**C. Team/game numbering.** You asked for alerts to reference a team by a short number (like
"#501"). We've built this — every game automatically gets a number pair (e.g., away team
#101, home team #102) — but it's a number **we generate ourselves**, not an official Vegas
rotation number (our data source doesn't provide those). Let us know if our numbering is fine
as-is, or if you had a specific numbering system in mind.

**D. Team logos.** Logos on the Games board are currently pulled from ESPN's public site, which
isn't a licensed source. If you have official/licensed team logo assets (or a preferred
provider), send them over and we'll swap them in.

**E. Bottom navigation.** The app now has six tabs (Edges, Games, Alerts, Plays, Balance,
Account). Happy to combine Balance into Account if six feels crowded — your call.

---

## 2. Defaults we picked — flag if you want something different

- **Which book's price shows on the board.** Each game card shows one book's price (not
  "best across all books"), in this order of preference: DraftKings → FanDuel → BetMGM →
  Caesars → Circa → Wynn. Tapping any price shows every monitored book's price for comparison.
- **The "fair" number.** We show it only next to plays we've already flagged as an edge — not
  for every market — so the method behind it stays protected.
- **Settlement rules text** (what happens on overtime pushes, etc.) uses the standard sportsbook
  convention, since our data source doesn't supply rule text per sportsbook. Worth a quick
  sanity check against the actual books you use.
- **Live games** show a LIVE tag and the score (when available), and whatever full-game prices
  the sportsbooks keep posting during the game. Quarter/half lines and alerts are pregame only —
  we're not chasing in-game quarter lines live.
- **"Today / Tomorrow" grouping** follows Eastern time, per your spec — someone on the West
  Coast late at night may see the next day's games already grouped under "Today."

---

## 3. For your information — no action needed

- **Wynn** is on our monitored-book list, but WynnBET no longer operates in the US, so our data
  source has stopped sending their lines. It simply won't show prices.
- **Only 1st-half and 1st-quarter lines can trigger an edge alert.** Our sharp-price benchmark
  only covers those two windows; 2nd half, and 2nd/3rd/4th quarter lines still display on the
  board for reference, but the system can't verify them against a fair price, so no alerts fire
  on those.
- **Quarter/half plays settle manually** (same button as before) — our data source doesn't
  report period-by-period final scores, only the final score of the whole game, so those can't
  auto-settle the way full-game plays do.
- **Final score + win/loss is now visible to everyone** on the main Edges screen, under "Recent
  Results" — not sent as a text, per your request. Live in-game score polling has been turned
  off, also per your request.

---

## 4. One thing we couldn't quite read

In your example text — `501 1H 49' .034 $502 FanDuel, South point` — the `49'` wasn't clear to
us (time remaining? a typo?). We left it out of the alert format rather than guess. If you can
tell us what it meant, we'll fold it in.

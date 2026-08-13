# Client Meeting Guide — How Everything Works

*Your cheat sheet for explaining the Sports Betting Edge System, feature by feature.
Everything here matches the actual code and database — no hand-waving.*

---

## 1. The Big Picture (30-second pitch)

Sportsbooks in Vegas and local markets are often **slow to move their lines**. Sharp
offshore books like **Pinnacle** move instantly because professional money bets into them.
Our system compares the two:

```
Pinnacle (sharp, fast)  ──►  strip the juice  ──►  TRUE fair price
Local book (slow)       ──►  their posted line ──►  what you can actually bet
                                    │
                                    ▼
              Local price better than fair price?  →  that's an EDGE
```

When an edge appears, every user gets an alert on their phone with **exactly what to
bet, where, and how much** — personalized to their own bankroll. Users never see the
math; they just see the instruction. The method lives only on the admin side (and it's
enforced at the database level, not just hidden in the UI — a user physically cannot
query the fair prices).

Right now it's **tracking only** — no real money moves through the app. Users log
their bets, tag them won/lost, and the app proves whether the numbers work over ~6
months. If they do, real money comes later.

---

## 2. How the Math Works (the 4 questions you'll get)

### 2a. How is an edge detected?

Two-step process (the admin's **No-Vig Calculator** on the Edges page does this today;
the engine automates it later):

**Step 1 — Remove the vig from the sharp book.**
A sportsbook's two sides never add up to a fair coin — they add to ~104-105% because
the book takes a cut ("vig" / "juice"). Example — Pinnacle shows Over -108 / Under -102:

```
implied prob of -108  =  108/208  =  51.9%
implied prob of -102  =  102/202  =  50.5%
total                 =  102.4%   ← the extra 2.4% is the vig
fair prob (Over)      =  51.9 / 102.4  =  50.7%   → fair odds ≈ -103
```

**Step 2 — Compare to the local book.**
If a local book still has Over at **+105** while the fair price is -103, the local
book is paying you more than the bet is worth. The edge % is roughly the gap between
the fair win probability and what the local price implies:

```
fair win prob:           50.7%
+105 implies:            48.8%
edge ≈ 50.7 − 48.8  =    ~2% edge
```

**Plain-English version for the client:** *"Pinnacle is the answer key. We erase their
profit margin to get the true price, then hunt for local books whose price hasn't
caught up yet. The difference is free value."*

### 2b. How is the "line to take" decided?

The line to take **is the local book's stale line** — the specific number and book
where the value exists. E.g. the alert says "Over 209 at South Point" because South
Point is the book that hasn't moved yet. It is not calculated separately; it is the
*found* side of the comparison. That's also why alerts name a specific sportsbook —
the same bet at a different book may have no edge at all.

### 2c. How is the Recommended Wager calculated? (Kelly Criterion)

The **Kelly Criterion** is a Nobel-adjacent formula from information theory that
maximizes long-term bankroll growth. Full formula in our code (`lib/kelly.ts`):

```
Full Kelly %  =  (Edge % × Decimal Odds) / (Decimal Odds − 1)
Wager         =  Bankroll × Full Kelly % × (user's Kelly fraction)
```

Worked example — user has a **$1,000 bankroll**, uses **25% (Quarter) Kelly**,
edge is **4%** at odds of **-110** (decimal 1.909):

```
Full Kelly  =  (0.04 × 1.909) / (1.909 − 1)  =  0.084  →  8.4% of bankroll
Full wager  =  $1,000 × 8.4%                 =  $84
Quarter Kelly =  $84 × 25%                   =  $21   ← what the app shows
```

Key facts to mention:
- It's computed **live from the user's current bankroll** every time — never cached.
  Two users see two different dollar amounts for the same edge.
- Full Kelly is mathematically optimal but has brutal swings, so users choose a
  **fraction** during onboarding (Conservative 25% / Balanced 50% / Aggressive 100%).
  Quarter Kelly keeps ~75% of the growth with a fraction of the volatility —
  it's the industry-standard choice.
- Bigger edge → bigger bet. Better odds → bigger bet. It scales automatically.

### 2d. How is win/loss calculated? (current: manual tagging)

Today the user (or admin) taps **Won / Lost / Push** on a logged bet. The money math
then runs **automatically in the database** (`settle_bet`) from the odds that were
snapshotted when the bet was logged:

```
WIN  at positive odds (+150):  profit = wager × 150/100      ($20 bet → +$30)
WIN  at negative odds (-110):  profit = wager × 100/110      ($22 bet → +$20)
LOSS:                          profit = −wager               ($20 bet → −$20)
PUSH (tie/cancelled):          profit = $0
```

The profit/loss instantly updates the user's **bankroll balance**, writes a line into
**bankroll history** ("Bet win · NFL Over 209"), and feeds the **P&L charts** —
per sport, over time, win rate — all in real time, on both the user app and the
admin dashboard. Settlement is **one-shot and immutable**: once a bet is tagged, it
cannot be edited or re-tagged (client's requirement — users can't cook their books).

**Later (real-time phase):** scores/results can be pulled from the sports-data API and
bets auto-settled — the `settle_bet` math stays exactly the same, we just stop asking
the human to press the button.

### 2e. What happens if the betting size changes?

Two knobs affect bet sizing, and it matters *where* each one hits:

**Knob 1 — Bankroll changes** (user adjusts it, or wins/losses move it):
**Knob 2 — Kelly fraction changes** (user switches Conservative → Aggressive):

| Impacted immediately | NOT impacted |
|---|---|
| Recommended wager on every **active edge card** (home) | **Already-logged bets** — they snapshot the wager, odds, and edge at log time |
| **Edge detail** "What to Bet" amount | **Past P&L / history** — those numbers are frozen facts |
| Dollar amounts shown in the **Alerts inbox** | Other users — everyone's sizing is isolated |
| **Future push notifications** — the server computes each user's wager from their live bankroll at send time | |

So: change your bankroll from $1,000 → $2,000 and every suggestion on screen doubles
within a second (realtime subscription), the next phone notification carries the new
amount, but your history doesn't rewrite itself. That's deliberate — the log must be
an honest record for the 6-month evaluation.

---

## 3. User Side — Feature by Feature

**Sign-up & Onboarding**
- Email + password + phone, email OTP verification, mandatory **21+ confirmation**,
  responsible-gambling disclaimer.
- 3-step onboarding: what the app does (value explanation — *no method revealed*),
  set starting bankroll + risk level (Kelly fraction), pick preferred sports.

**Home (Edge Feed)**
- Live list of active edges: matchup, the bet, the book, odds, edge %, game time,
  and **that user's recommended wager**. Search + sport filter chips.
  "Updated Xs ago" ticker proves it's live. Banners appear if admin turns on
  maintenance mode or pauses alerts.

**Edge Detail**
- The full instruction card: WHAT TO BET, where, at what odds, suggested stake with
  a stepper to adjust, then **Log Bet**. What the user never sees: the fair price,
  the sharp line, or any comparison — the "why" is invisible by design.

**Alerts (bell tab)**
- In-app inbox of every edge alert + admin broadcasts (announcements pinned on top).
  Badge counts unread. This inbox works even if the user disables push — in-app
  alerts are always on.

**My Bets**
- Every logged bet with its snapshot (bet, odds, wager, edge at time of logging).
  Pending bets get Won / Lost / Push buttons. Settled bets are locked forever.
  Filters by status and sport.

**Bankroll**
- Current balance, total P&L, ROI, win rate, **P&L by sport** bars, full transaction
  history (every bet result and manual adjustment). Manual deposit/withdraw
  adjustments allowed (it's tracking, not custody).

**Settings**
- Alert delivery: **Push** (on/off), **SMS** (opt-in, Twilio later), **In-app: always on**.
- Alert rules: high-edge-only mode, **quiet hours** (no pushes at night).
- Security: biometric lock, 2FA (coming soon).
- Legal: terms, responsible gambling, 21+.

---

## 4. Admin Side — Feature by Feature

*(Web-only console at `/admin` — invisible to app users, separate login gate,
role-checked at the database level.)*

**Overview (dashboard)**
- Live KPIs in three groups — Users (total, active, new), Engine (active edges,
  alerts sent), Betting (bets, volume, P&L) — plus charts: bets last 14 days,
  cumulative P&L curve, P&L by sport, recent-bets feed. Everything updates in
  real time while you watch.

**Edges**
- **Publish form**: matchup, bet, book, odds, edge %, game time → one click sends it
  to every user (feed + inbox + phone push).
- **Method box** (marked "NEVER VISIBLE TO USERS"): record the sharp fair price and
  book lines behind each edge — stored in an admin-only table.
- **No-Vig Calculator**: paste two-sided juice, get vig %, fair probabilities, fair
  odds — the manual version of what the engine will automate.
- Expire / reactivate / delete existing edges.

**Users**
- All registered users: bankroll, bets, P&L, join date. Deactivate/reactivate
  (deactivated users stop receiving alerts), promote to admin. Admins are listed
  separately — the Users table shows only real users.

**Bets** — every bet across all users, filterable; the raw data for "do the numbers work?"

**Broadcast** — send an announcement to all users (in-app + push). Delete past ones.

**Engine Config** — see next section, this is the part the client asked about.

---

## 5. Engine Config Explained (the client's specific questions)

> Short answer to "do we need them in real time / do they apply to API data?"
> **These three settings exist *for* the real-time engine.** Today they're stored and
> ready; the manual-publish flow mostly bypasses them because a human is the filter.
> The moment the engine goes live, they become the guardrails that decide which of
> the hundreds of API-detected price gaps actually reach users.

### Minimum edge threshold (1% – 3%)
- **What it is:** the smallest edge worth alerting. The API comparison will constantly
  find tiny 0.3–0.8% gaps — mathematically real but eaten by variance and not worth
  a bettor's time.
- **Real-time behavior:** engine computes edge for every market → discards anything
  below the threshold → only survivors become edges. Raise it to 3% and users only
  hear about the strongest plays; lower to 1% and volume goes up but quality dilutes.
- **Needed?** Yes — it's the main volume/quality dial. Without it, real-time would
  spam users into ignoring alerts.

### Pre-game alert cutoff (15–60 min)
- **What it is:** stop alerting when the game is too close to start.
- **Why:** minutes before tip-off, lines move violently (injury news, sharp money) —
  an "edge" found 10 minutes out is often already gone by the time the user reaches
  a betting window, especially with physical Vegas books.
- **Real-time behavior:** engine checks `game_time − now()`; inside the cutoff window
  the market is skipped even if an edge exists.
- **Needed?** Yes for pre-game markets. (If live/in-play betting ever comes, it gets
  its own rules.)

### Duplicate suppression (on/off)
- **What it is:** the same game + bet type alerts **once per 5-minute window**, not
  on every poll.
- **Why:** the engine will re-fetch odds every 30–60 seconds. A South Point line that
  stays stale for 20 minutes would otherwise fire 20–40 identical alerts. Users would
  mute the app by day two.
- **Real-time behavior:** before inserting an edge, engine checks "did we already
  alert this game+bet in the last 5 minutes?" — if yes, skip (or update the existing
  edge silently).
- **Needed?** Absolutely — it's the anti-spam valve. Meaningless for manual publishing
  (a human doesn't publish the same edge 40 times), critical for automation.

**One-liner for the client:** *"These three dials are the engine's editorial judgment:
how strong an edge must be, how early it must be found, and how often we're allowed
to repeat ourselves. You control all three from the dashboard without touching code."*

---

## 6. Monitored Sportsbooks & Monitored Sports

**Today:** the lists (South Point, Caesars, DraftKings, Treasure Island, Wynn, Coast,
BetMGM, Circa / NFL, NBA, MLB, NHL, NCAAF, NCAAB) are a **curated menu we chose**,
matching the books in the client's brief plus the majors on The Odds API. The admin
toggles them on/off; the selection is saved in the database instantly (realtime).

**They are not fetched from the API today, and turning one off doesn't filter
anything yet** — because edges are manually published, the admin *is* the filter.

**In real time they become the engine's shopping list:**
- **Sports** → which leagues the engine polls the API for. NBA off = zero NBA API
  calls. This directly controls **API credit spend** (we have 20k calls/month), so
  in off-season you'd toggle a sport off and save the quota.
- **Books** → which sportsbooks' odds the engine compares against Pinnacle. A book
  toggled off is ignored even if the API returns its prices.
- The Odds API exposes **which bookmakers it carries per region**, so once live we
  can grow the menu dynamically from the API instead of hardcoding it — an admin
  would see newly available books appear as toggle options. (Note: some small Vegas
  locals may not be on the API; those either stay manual or come from another source.)

**One-liner:** *"Think of them as the engine's search area. Every book and sport you
toggle on costs API calls and produces candidate edges; everything off is invisible
to the system."*

---

## 7. What Exactly Changes When We Go Real-Time

| Aspect | NOW (prototype) | REAL-TIME (Phase 2) |
|---|---|---|
| Where edges come from | Admin publishes manually (seeded samples exist and will be **deleted before launch**) | Engine polls The Odds API every 30–60s, computes no-vig fair prices from Pinnacle, auto-creates edges |
| No-vig / fair price math | Admin uses the built-in calculator | Engine runs the identical formula automatically |
| Edge threshold / cutoff / duplicate rules | Stored, admin-visible, mostly informational | **Actively enforced** on every API cycle |
| Monitored books & sports | Saved preferences | **Live filters** controlling API queries and credit spend |
| Notifications | Fire automatically when admin publishes (already fully working) | **Identical — zero changes needed.** Engine inserts the edge row → same trigger fires → phones buzz. No admin action required. |
| Recommended wager | Live Kelly from live bankroll | **Unchanged** — already real-time |
| Win/loss settlement | User tags won/lost, math auto-runs | Optionally auto-settled from API scores (same math) |
| Edge lifecycle | Admin expires manually | Engine auto-expires when the line moves or game starts |
| Admin's role | Creates the content | **Supervises** — watches dashboard, tunes config dials, sends broadcasts, can still manually publish special plays |
| API usage | 0 (key tested and ready — 20k credits/month) | Continuous polling budgeted by sport/book toggles |

**What does NOT change:** the entire user experience. Users already live in the
"real-time" world — live feed, live wagers, instant pushes. Phase 2 only replaces
*who creates the edges* (a human → the engine). That's the beauty of the architecture:
the pipeline from "edge exists in database" to "user's phone buzzes with their
personalized bet" is built, tested, and delivery-confirmed. The engine just plugs
into the front of it.

### Do users get notifications automatically, or does the admin push them?

**Automatic. Always. Already.** The notification fires from a **database trigger** the
instant an edge row is created — it doesn't know or care whether an admin's publish
button or the future engine created it. The trigger:
1. finds every active user with push enabled who isn't in quiet hours,
2. computes **that user's** Kelly wager from their live bankroll,
3. sends the personalized push (verified end-to-end on a real device on Jul 11).

The admin never "pushes notifications" as a separate step — publishing the edge *is*
the notification. The only manual sends are **broadcasts** (announcements), which are
intentionally human-written.

---

## 8. Suggested Demo Flow for the Meeting

1. **Phone in hand** — show login → home feed → tap an edge → "here's what a user
   sees: what to bet, where, and $X sized to *their* bankroll. Notice what they
   *don't* see: any math."
2. **Log the bet → tag it Won** — watch bankroll, P&L chart, history update instantly.
3. **Open the admin console on laptop** — dashboard KPIs and charts moving live.
4. **The money shot:** close the app on the phone completely → publish an edge from
   the admin console → phone buzzes within seconds with the personalized alert.
5. **Engine Config page** — "these dials are pre-built for the automation phase;
   here's what each will control" (Section 5 above).
6. **Roadmap:** odds-feed engine (API key already tested), custom email/OTP templates,
   2FA, SMS via Twilio, auto-settlement, iOS build.

### Likely client questions & honest answers
- **"Is this live odds data?"** — Not yet; today's edges are published by the admin.
  The API key is validated (Pinnacle included) and the automation is the next phase.
  Everything downstream of edge-creation is already fully live.
- **"Can users reverse-engineer the method?"** — They only ever receive the
  conclusion (bet, book, odds, size). Fair prices and sharp lines live in a table
  the database itself refuses to serve to non-admins.
- **"What if I want fewer/more alerts?"** — Your three Engine Config dials +
  book/sport toggles. Per-user, they also have quiet hours and a high-edge-only mode.
- **"What if a user's phone is off / push disabled?"** — The in-app inbox always
  receives everything; push is a bonus layer, SMS opt-in comes later.
- **"Can a user fake their results?"** — No. Settlements are one-shot and
  immutable, wagers/odds are snapshotted at log time, and history can't be edited.

---

*Prepared 2026-07-12. Formulas verified against `lib/kelly.ts`, `settle_bet` in
`supabase/migrations/001_init.sql`, and `app/admin/config.tsx`.*

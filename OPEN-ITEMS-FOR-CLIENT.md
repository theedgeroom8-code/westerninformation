# Open Items — Games Board, 1H Lines & Alerts

*Updated 2026-10-04 after your last round of feedback. Everything below reflects what's actually
built and live right now. Nothing here is blocking — the app works today — but your answers will
shape what we tune next.*

---

## 1. Resolved by your last feedback (confirming what we built)

- **1H tracking starts earlier.** We were only fetching 1H lines in the last ~12 hours before
  kickoff. That's now a full week out, so if a book posts a 1H line on, say, Tuesday for a Sunday
  game, we pick it up right away instead of waiting until Saturday night. This doesn't cost extra
  — the spending cap that was already in place still applies, it just now has a bigger pool of
  games to spread across.
- **Alerts only fire on high edges now.** Before, every edge that cleared our basic "is this even
  worth tracking" floor sent an alert — so a lot of borderline, low-confidence edges were going
  out. Now there's a second, higher bar specifically for alerts: we set it at 5% to start. Edges
  between the two numbers still get created and still show up in your results/track-record, they
  just stay quiet — no push, no text. This number is a dial on our end, so if 5% turns out to be
  too tight or too loose once you see real volume, tell us and we'll move it in a minute.
- **The Games board now only shows high-edge games.** Same 5% bar as alerts. Instead of browsing
  every scheduled game, the board now only lists the ones with a live edge right now — so on a
  10-game Sunday, you see the 1 or 2 that actually matter instead of all 10. One honest note: this
  doesn't reduce our API costs. We still have to check every game to know which ones qualify —
  showing fewer games is a cleaner screen for you, not cheaper for us. (This also answers last
  round's open question about whether the board-browsing screen should match the "just the play"
  approach — it now does, since non-edge games simply aren't shown.)
- **Tapping through to a sportsbook, and whether they'd know it's us.** Short answer: on the
  website version, yes — a plain link would have let the sportsbook's server see our domain as the
  referring site (not the specific game or bet, just that the click came from us). We didn't
  remove the link, because it's the step that makes an alert actually actionable — tap it, go to
  the book, place the bet, come back and log it. Instead we fixed the leak directly: the link now
  opens in a way that hides the referrer completely, so it looks to the sportsbook exactly like
  the user typed the URL in themselves. (On the phone app specifically, this was never an issue —
  opening a link from an app doesn't send that kind of information in the first place, only the
  website version did.) If you'd still rather we pull the link entirely after reading this, say
  the word and we'll take it out.
- **Recording what a player actually bet.** This already exists — every edge detail screen has had
  a "Track This Play" button since early on: it's pre-filled with our suggested amount, the user
  can adjust it, and it logs the exact sportsbook and amount to their own history, which is what
  feeds the win-rate and profit numbers on the Balance tab. One thing we want to be upfront about:
  there's no way for us to automatically know when someone actually places a bet on DraftKings'
  (or any sportsbook's) own site or app — that would require a formal data-sharing agreement with
  each sportsbook, which is a business arrangement, not something we can build around. The "Track
  This Play" button is the honest, available substitute: a 10-second manual confirm instead of
  silent automatic tracking.

---

## 2. Needs a decision from you

**A. Real text messages — the account and a hosting decision.** You said to move forward with
texting. We've built the half of this that's ours to build without outside accounts: every
signed-up user already has a phone number on file, and the moment a *high* edge fires (same 5% bar
as above, now that alerts are filtered), we record exactly who should get a text and exactly what
it should say. What's left needs two things from outside our code:
1. **A Twilio account** (or similar) with a phone number/sender approved for it.
2. **A small relay piece deployed somewhere**, because of a wrinkle we only found while wiring
   this up: our database can talk to services that accept JSON, but Twilio's texting API only
   accepts an older format (form-encoded) that our database's networking tool can't send. This
   is a one-time plumbing detail, not a design choice — it just means the last hop (calling
   Twilio) needs to run as a small piece of code somewhere other than the database itself (for
   example, alongside the website). We're ready to build that piece as soon as the Twilio account
   exists.

   Also worth flagging: Twilio's own compliance step for business texting (A2P 10DLC) typically
   asks for the same business/LLC information you mentioned is still pending — so texting may be
   waiting on the same paperwork as the app store listing, not a separate track.

**B. Odds API plan.** Credit usage is lower than ever now (1H is only FG+1H markets, and the board
only displays — doesn't fetch extra for — high-edge games). The current 20,000/month plan
comfortably covers everything at the refresh rates we're running. No upgrade needed. We still
don't know your plan's exact monthly reset date — if you know it, tell us so we can pace against
it precisely.

**C. Team logos.** Still pulled from ESPN's public site (not a licensed source). If you have
official/licensed logo assets or a preferred provider, send them over.

**D. Bottom navigation.** Still six tabs (Edges, Games, Alerts, Plays, Balance, Account). Happy
to combine Balance into Account if that feels crowded — your call.

---

## 3. For your information — no action needed

- **Wynn** is on our monitored-book list, but WynnBET no longer operates in the US, so it never
  shows prices.
- **1H settles manually** (same button as before) — our data source doesn't report half-by-half
  final scores, only the final score of the whole game, so 1H plays can't auto-settle the way
  full-game plays do.
- **Settlement rules text** (what happens on overtime pushes, etc.) uses the standard sportsbook
  convention, since our data source doesn't supply rule text per sportsbook. Worth a quick sanity
  check against the actual books you use.

# Open Items — Games Board, 1H Lines & Alerts

*Updated 2026-09-27 after your last round of feedback. Everything below reflects what's actually
built and live right now. Nothing here is blocking — the app works today — but your answers will
shape what we tune next.*

---

## 1. Resolved by your last feedback (confirming what we built)

- **Team numbering**: confirmed — our own auto-generated number is fine, no need for official
  Vegas rotation numbers. We also added the team name back into the alert text itself (it had
  gotten dropped when we compacted the wording last round — good catch).
- **Over/Under convention**: confirmed — the visiting (top) team's number doubles as the Over
  side, the home (bottom) team's number as the Under side. Built exactly that way.
- **Periods**: confirmed — quarters and 2nd half are dropped entirely. Only Full Game and 1st
  Half remain, on the board and in alerts. This also cut the credit cost of fetching 1H lines by
  about 6x, so we moved its refresh from every 2 hours down to every 15 minutes — same safety cap
  as before, just spent faster since it's so much cheaper now.
- **"49′" format**: confirmed as 49.5 (half-point shorthand). We already print half-points as a
  plain decimal (e.g. "49.5"), so no change was needed there.
- **No comparison for players**: done. A player now sees only the play we send them — team, the
  price to take, the fair price, the kickoff time, and how much to play. The book-by-book
  comparison table is admin-only now.
- **Results, not texted**: confirmed unchanged — final score and win/loss show in their own area
  in the app (not sent as a text or push).
- **Live score polling**: confirmed off, unchanged from last round.

---

## 2. Needs a decision from you

**A. Real text messages — the account and a hosting decision.** You said to move forward with
texting. We've built the half of this that's ours to build without outside accounts: every
signed-up user already has a phone number on file, and the moment an edge fires, we now record
exactly who should get a text and exactly what it should say. What's left needs two things from
outside our code:
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

**B. Odds API plan.** Now that quarters/2nd half are dropped, credit usage is much lower than
before — the current 20,000/month plan comfortably covers Full Game + 1H at a 15-minute refresh
for both leagues. No upgrade needed unless you want faster than 15 minutes. We also still don't
know your plan's exact monthly reset date — if you know it, tell us so we can pace against it
precisely.

**C. Team logos.** Still pulled from ESPN's public site (not a licensed source). If you have
official/licensed logo assets or a preferred provider, send them over.

**D. Bottom navigation.** Still six tabs (Edges, Games, Alerts, Plays, Balance, Account). Happy
to combine Balance into Account if that feels crowded — your call.

**E. Which book's price shows on the Games board.** This is the general board-browsing screen
(separate from the alerts you're sent) — it still shows one book's price per game card, in this
order of preference: DraftKings → FanDuel → BetMGM → Caesars → Circa → Wynn, and tapping any
price still shows every monitored book for comparison there. Let us know if that browsing screen
should also be simplified to match the "just the play" approach, or if it's fine as a separate,
more detailed view for people who want to look around.

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

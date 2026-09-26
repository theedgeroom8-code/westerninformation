# Games Board, Quarter/Half Lines & Book Comparison

*Built from the client's "Edge Board — Developer Spec" (Sep 26, 2026). Updated 2026-09-26.*

## What's new for users

| Feature | Where | Notes |
|---|---|---|
| **Games board** | new **Games** tab (bottom bar on phones, sidebar on the website) | NFL and CFB tabs; one card per game; Spread · Total · Moneyline side by side; away team on top, "AT", home team below; team logos; full date + kickoff time in ET ("Sun, Sep 27 · 1:00 PM ET"); grouped under Today / Tomorrow / Sat, Oct 3…, sorted by kickoff |
| **Live games** | same board | LIVE tag + score in place of the kickoff time (scores refresh every 10 min while a game is in progress) |
| **Edge badge** | on the cell | if the engine has flagged that side of that market (e.g. `17.4%`) |
| **Quarter & half lines** | period chips under the league tabs: Full Game · 1H · 2H · 1Q · 2Q · 3Q · 4Q | same card layout; a cell a book doesn't offer is greyed out (the game is never hidden); 3-way (tie) moneylines show the tie price as a third row; the settlement rule for the period is printed under the chips |
| **Tap any price** | opens the comparison screen | flagged cell → Edge Detail; un-flagged cell → *Line Comparison* (same table, no edge) |
| **Line Comparison** on Edge Detail | between **THE PLAY** and **SUGGESTED AMOUNT** | every monitored sportsbook's number for that market, best → worst, best row highlighted, "Updated 2m ago" per book, stale prices greyed + labelled *Delayed*, spread/total rows show **line + price** per book, the **fair line** the edge is measured against, tap a book to open its site |
| Kickoff on Edge Detail | top card | full date + time next to the "Starts in…" countdown |
| Admin view | Admin → Edges → expand an edge | the *same* comparison (from the same query, so prices and timestamps can't disagree) plus the raw sharp line, admin-only |

The board and comparison update live: the engine touches one small `board_state` row per refresh and every open screen refetches within ~1–2 seconds. No pull-to-refresh needed (it also works).

## Answers to the spec's open questions

1. **Which book's price is on the main board?** One consistent book per card, not "best of all books" (a spread from one book and a total from another on the same card would be misleading, and it matches the DraftKings screen the client uses). The book is the first monitored book with a line, in this order: **DraftKings → FanDuel → BetMGM → Caesars → Circa → Wynn** (`board_book_priority`). The comparison screen then shows *every* book, best to worst. Only books switched on under Admin → Config → Monitored Sportsbooks are ever shown.
2. **Live in-game lines — v1 scope?** Live games are on the board (LIVE tag + score). Full-game prices for a live game appear only if the sportsbooks keep posting them to the feed (refreshed with the regular poll, greyed when stale). **Quarter/half lines are pregame only**, and edges are pregame only (nothing alerts inside the pre-game cutoff).
3. **Can the current Odds API plan cover quarter/half lines for every game at the requested rates? No.** See the credit math below. The system is built so it *degrades safely instead of running out*: a daily cap, an hourly pace, a floor that pauses everything before the plan is empty, and a per-game cost it learns.

## Credit math (The Odds API)

Measured against the live API on 2026-09-26:

| Call | Cost |
|---|---|
| Full-game odds for one league (spread + total + moneyline, all monitored books + the sharp benchmark) | **3 credits** (was 6 — the engine now requests `bookmakers=` instead of `regions=eu,us`; The Odds API bills each group of ≤10 books as one region) |
| Quarter/half lines for **one NFL game** (all 24 period markets) | **≈ 15–24 credits** (billed per market actually returned) |
| A marquee college game | ≈ 15–20 credits; small games often 0 (no book posts quarters) |
| Live scores for one league | 2 credits |

Monthly outlook by plan (NFL + CFB, both on the board):

| Plan | Credits/mo | What it supports |
|---|---|---|
| **20,000 (current)** | ≈ 670/day | Full-game board at 15 min ≈ **588/day** — that is already 88% of the plan. Quarter/half lines and live scores only fit if the regular poll slows to **30 min** (≈ 294/day), leaving ≈ 350/day for quarters + scores. |
| 100,000 | ≈ 3,300/day | Full board at 15 min + live scores + ≈ 2,000/day of quarter/half fetching (a full NFL Sunday pass ≈ 320 credits, so ~6 passes) |
| 5,000,000 | ≈ 165,000/day | Everything in the spec, including the 5-minute quarter/half refresh, for both leagues |

So the "every 5 minutes for every game" refresh in the spec needs the 5M tier. On the current plan the defaults below keep the core alerts safe and give a useful, honest quarter/half board.

### Admin → Config → "Games board & quarter / half lines"

| Dial | Default | What it does |
|---|---|---|
| Leagues on the board | NFL, NCAAF | full-game lines ride on the regular poll — no extra credits |
| Quarter & half lines | on | master switch for the per-game fetching |
| Alert on quarter / half edges | on | off = lines still display, but no quarter/half edge alerts |
| Refresh each game every | 120 min | per-game cadence |
| Only games starting within | 12 h | far-out games aren't fetched; soonest kickoff is always served first |
| Daily credit cap | 400 | hard limit per Eastern day, **paced to ≤ ¼ of it per hour**, and never more than 10% of the credits left above the reserve. Games known to have no quarter lines (cost 0) are re-checked rarely |
| Live score refresh | 10 min | only while a board game is in progress |
| Readouts | | period credits today / cap · game fetches today · games tracked · **credit outlook** (burn per day and days of runway) |

## How it works (for whoever maintains it)

Everything runs inside Postgres (`migration 016_games_board.sql`) — no server.

* **Tables** (server-side only; users never read them): `games`, `game_lines` (one row per game × period × market × book, with the book's own `last_update`), `board_state` (the realtime signal), `engine_period_spend`.
* **Users read through three RPCs**: `board_games(sport, period)`, `market_comparison(...)`, `edge_comparison(edge_id)`. The sharp book's raw prices are never returned to users, and the **fair line is only returned for a market that carries an active edge** (so nobody can scrape the engine's benchmark for every market). Admins additionally get the raw sharp row.
* **Ingest**: the poll the engine already made is now persisted (`board_ingest_events`); a line a book stops posting is deleted (no ghost prices).
* **Period lines**: `engine_maybe_poll_periods` walks games by kickoff under the budget rules above (`/events/{id}/odds`, all 24 period markets).
* **Live scores**: `engine_maybe_scores_live` (only while a game is in progress).
* **Edges are period-aware**: `engine_scan_events(sport, events, hunt, periods)`. Pinnacle prices **1H and 1Q only** through The Odds API — so those are the only periods the engine can detect edges for (2H/2Q/3Q/4Q have no sharp benchmark; showing their lines works, alerting doesn't).
* **Every edge is re-verified on every poll**, including for leagues that are on the board but not on the alert list, and an edge nobody has confirmed for ~3 polls (period edges: 2 refreshes, min 2.5 h) is expired. This fixed a real problem: after NFL was switched off in Config, old NFL edges kept showing for days with stale prices (e.g. a 17.4% "Giants ML +100" that no longer existed).
* **Settlement**: quarter/half plays can't be graded from a final score and The Odds API scores carry no per-period breakdown, so **auto-settle only handles full-game plays**; period plays are settled by hand (same button as before).
* **Resilience**: each API response is processed in its own sub-transaction — one malformed payload is logged and skipped instead of stalling every poll behind it.

## Things to know / decisions for the client

* **Team logos** are loaded from ESPN's public CDN (regenerate the name map with `node scripts/gen-team-logos.js`). It is not a licensed logo source; unknown teams fall back to an initials badge, so nothing breaks. If logos must be licensed, supply the assets or a paid provider.
* **Settlement-rule text**: The Odds API does not provide period settlement rules. The text shown is the standard convention (1H/1Q/2Q/3Q: regulation only; 2H and 4Q: overtime treatment varies by sportsbook). Please confirm with the client's books.
* **Times are Eastern** ("Today/Tomorrow" follow the Eastern calendar, per the spec). A Nevada user at 9 pm PT on Sunday sees Monday-ET games under "Today".
* **Wynn** is on the monitored-books list but no longer appears in The Odds API feed (WynnBET left the US market), so it never has lines.
* **Bottom bar is now six tabs** (Edges · Games · Alerts · Plays · Balance · Account). If that's too crowded, fold Balance into Account.

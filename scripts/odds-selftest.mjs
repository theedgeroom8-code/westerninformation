// Unit tests for lib/odds.ts. Node 22.6+ strips the TypeScript types natively.
//   node scripts/odds-selftest.mjs
import * as O from "../lib/odds.ts";

let pass = 0, fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

console.log("price / point formatting");
eq("+275", O.fmtPrice(275), "+275");
eq("−105 uses the typographic minus", O.fmtPrice(-105), "\u2212105");
eq("null price → dash", O.fmtPrice(null), "—");
eq("point 7", O.fmtPoint(7), "7");
eq("point 50.5", O.fmtPoint(50.5), "50.5");
eq("point −7.5", O.fmtPoint(-7.5), "\u22127.5");
eq("signed +7", O.fmtPoint(7, true), "+7");
eq("signed −2.5", O.fmtPoint(-2.5, true), "\u22122.5");
eq("pick'em 0", O.fmtPoint(0, true), "0");
eq("cents from even: +100 → 0", O.centsFromEven(100), 0);
eq("cents from even: −105 → −5", O.centsFromEven(-105), -5);
eq("cents from even: +120 → 20", O.centsFromEven(120), 20);

console.log("\nEastern time — checked against Intl for 20,000 instants incl. every DST edge");
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false });
let mism = 0, checked = 0;
const check = (ms) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const e = O.toET(ms);
  const want = [Number(p.year), Number(p.month), Number(p.day), Number(p.hour) % 24, Number(p.minute)];
  const got = [e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), e.getUTCHours(), e.getUTCMinutes()];
  checked++;
  if (want.join() !== got.join()) { mism++; if (mism < 4) console.log("   mismatch", new Date(ms).toISOString(), want, got); }
};
for (let y = 2024; y <= 2030; y++) {
  // every hour within 3 days of each transition + a stride through the year
  for (const m of [2, 10]) for (let d = 1; d <= 20; d++) for (let h = 0; h < 24; h += 1) for (const mi of [0, 30]) check(Date.UTC(y, m, d, h, mi));
  for (let i = 0; i < 400; i++) check(Date.UTC(y, 0, 1) + i * 21 * 3600e3 + 12345);
}
eq(`${checked} instants agree with Intl`, mism, 0);

console.log("\nkickoff formatting");
eq("Sun Sep 27 1:00 PM ET (17:00Z, EDT)", O.formatKickoff("2026-09-27T17:00:00Z"), "Sun, Sep 27 · 1:00 PM ET");
eq("12:00 PM noon", O.formatTimeET("2026-09-26T16:00:00Z"), "12:00 PM");
eq("12:05 AM midnight hour", O.formatTimeET("2026-09-27T04:05:00Z"), "12:05 AM");
eq("winter (EST): 18:00Z Jan 3 → 1:00 PM", O.formatTimeET("2027-01-03T18:00:00Z"), "1:00 PM");
eq("8:20 PM SNF", O.formatTimeET("2026-10-05T00:20:00Z"), "8:20 PM");
eq("late game rolls the ET date back (03:00Z = 11 PM ET prior day)", O.formatDateET("2026-09-27T03:00:00Z"), "Sat, Sep 26");

console.log("\nday titles (Today / Tomorrow / Sat, Oct 3)");
const now = Date.parse("2026-09-26T15:00:00Z"); // Sat 11 AM ET
eq("same ET day → Today", O.dayTitle("2026-09-26T23:30:00Z", now), "Today");
eq("late-night ET game is still Today (03:00Z Sunday)", O.dayTitle("2026-09-27T03:00:00Z", now), "Today");
eq("next ET day → Tomorrow", O.dayTitle("2026-09-27T17:00:00Z", now), "Tomorrow");
eq("later → 'Sat, Oct 3'", O.dayTitle("2026-10-03T17:00:00Z", now), "Sat, Oct 3");
eq("month boundary: Sep 30 → Oct 1 is Tomorrow", O.dayTitle("2026-10-01T17:00:00Z", Date.parse("2026-09-30T15:00:00Z")), "Tomorrow");
eq("year boundary", O.dayTitle("2027-01-01T18:00:00Z", Date.parse("2026-12-31T15:00:00Z")), "Tomorrow");

console.log("\ntime ago");
eq("30s", O.timeAgo("2026-09-26T15:00:00Z", Date.parse("2026-09-26T15:00:30Z")), "just now");
eq("4m", O.timeAgo("2026-09-26T15:00:00Z", Date.parse("2026-09-26T15:04:10Z")), "4m ago");
eq("2h 5m", O.timeAgo("2026-09-26T15:00:00Z", Date.parse("2026-09-26T17:05:00Z")), "2h 5m ago");
eq("3d", O.timeAgo("2026-09-23T15:00:00Z", Date.parse("2026-09-26T17:05:00Z")), "3d ago");
eq("null", O.timeAgo(null), "—");

console.log("\ngrouping");
const G = (id, commence, status = "upcoming") => ({ id, home: "H" + id, away: "A" + id, commence, status, homeScore: null, awayScore: null, markets: {} });
const groups = O.groupByDay([G("c", "2026-10-03T17:00:00Z"), G("a", "2026-09-26T20:00:00Z"), G("b", "2026-09-27T17:00:00Z"), G("b2", "2026-09-27T20:25:00Z"), G("live", "2026-09-26T13:00:00Z", "live")], now);
eq("Today · Tomorrow · Sat, Oct 3", groups.map((g) => g.title), ["Today", "Tomorrow", "Sat, Oct 3"]);
eq("live game sits in Today, kickoff order inside a group", groups.map((g) => g.games.map((x) => x.id)), [["live", "a"], ["b", "b2"], ["c"]]);
const midnight = O.groupByDay([G("late", "2026-09-27T03:30:00Z"), G("next", "2026-09-27T17:00:00Z")], now);
eq("11:30 PM ET game stays under Today (ET calendar)", midnight.map((g) => [g.title, g.games.map((x) => x.id)]), [["Today", ["late"]], ["Tomorrow", ["next"]]]);

console.log("\ncell resolution + edge badges");
const game = { id: "g1", home: "Buffalo Bills", away: "Los Angeles Chargers", commence: "2026-09-27T17:00:00Z", status: "upcoming", homeScore: null, awayScore: null, markets: {
  spreads: { book: "DraftKings", market: "spreads", stale: false, updatedAt: null, outcomes: [{ name: "Buffalo Bills", price: -115, point: -7 }, { name: "Los Angeles Chargers", price: -105, point: 7 }] },
  totals: { book: "DraftKings", market: "totals", stale: false, updatedAt: null, outcomes: [{ name: "Over", price: -102, point: 50.5 }, { name: "Under", price: -118, point: 50.5 }] },
  h2h: { book: "DraftKings", market: "h2h3", stale: true, updatedAt: null, outcomes: [{ name: "Buffalo Bills", price: -125 }, { name: "Los Angeles Chargers", price: 245 }, { name: "Draw", price: 390 }] } } };
const away = O.resolveCell(game, "spreads", "away");
eq("away spread = Chargers +7 −105", [away.point, away.price, away.outcome], [7, -105, "Los Angeles Chargers"]);
eq("home total = Under 50.5 −118", (({ point, price, outcome }) => [point, price, outcome])(O.resolveCell(game, "totals", "under")), [50.5, -118, "Under"]);
eq("3-way ML tie cell", (({ price, outcome, market, stale }) => [price, outcome, market, stale])(O.resolveCell(game, "h2h", "tie")), [390, "Draw", "h2h3", true]);
eq("missing market → empty cell", O.resolveCell({ ...game, markets: {} }, "spreads", "home").price, null);
const edges = [
  { id: "e1", eventId: "g1", period: "FG", marketKey: "h2h", outcomeName: "Buffalo Bills", edgePercentage: 5.1, status: "active" },
  { id: "e2", eventId: "g1", period: "FG", marketKey: "h2h", outcomeName: "Buffalo Bills", edgePercentage: 17.4, status: "active" },
  { id: "e3", eventId: "g1", period: "1Q", marketKey: "h2h", outcomeName: "Buffalo Bills", edgePercentage: 9, status: "active" },
  { id: "e4", eventId: "g1", period: "FG", marketKey: "h2h", outcomeName: "Buffalo Bills", edgePercentage: 30, status: "expired" },
  { id: "e5", eventId: "zzz", period: "FG", marketKey: "h2h", outcomeName: "Buffalo Bills", edgePercentage: 12, status: "active" },
];
const mlHome = { market: "h2h", outcome: "Buffalo Bills", point: null, price: -345, stale: false, book: "DraftKings" };
eq("badge = strongest ACTIVE edge on that game/period/market/side", O.edgeOnCell(edges, "g1", "FG", mlHome)?.id, "e2");
eq("1Q badge is separate from the full game", O.edgeOnCell(edges, "g1", "1Q", mlHome)?.id, "e3");
eq("3-way ML cell matches the 2-way edge market", O.edgeOnCell(edges, "g1", "FG", { ...mlHome, market: "h2h3" })?.id, "e2");
eq("no badge on an empty cell", O.edgeOnCell(edges, "g1", "FG", { ...mlHome, price: null }), null);
eq("no badge for another side", O.edgeOnCell(edges, "g1", "FG", { ...mlHome, outcome: "Los Angeles Chargers" }), null);

console.log("\nranking best → worst");
const R = (book, point, price, stale = false) => ({ book, point, price, updatedAt: null, stale });
let rows = [R("DraftKings", null, 80), R("BetMGM", null, 100), R("FanDuel", null, 75)];
eq("moneyline: +100 > +80 > +75 (the client's example)", O.rankRows("h2h", "x", rows).map((r) => r.book), ["BetMGM", "DraftKings", "FanDuel"]);
rows = [R("A", null, -105), R("B", null, 100), R("C", null, -110)];
eq("moneyline crossing even money: +100 > −105 > −110", O.rankRows("h2h", "x", rows).map((r) => r.book), ["B", "A", "C"]);
rows = [R("DK", -3, -110), R("MGM", -2.5, -115), R("FD", -3, -105)];
eq("spread favorite: −2.5 beats −3 even at a worse price; then price", O.rankRows("spreads", "Giants", rows).map((r) => r.book), ["MGM", "FD", "DK"]);
rows = [R("DK", 7, -105), R("FD", 7.5, -120), R("MGM", 7, -110)];
eq("spread underdog: +7.5 beats +7", O.rankRows("spreads", "Chargers", rows).map((r) => r.book), ["FD", "DK", "MGM"]);
rows = [R("DK", 50.5, -102), R("FD", 51, -110), R("MGM", 50, -105)];
eq("Over: lowest total is best", O.rankRows("totals", "Over", rows).map((r) => r.book), ["MGM", "DK", "FD"]);
eq("Under: highest total is best", O.rankRows("totals", "Under", rows).map((r) => r.book), ["FD", "DK", "MGM"]);
rows = [R("Old", null, 300, true), R("New", null, 250, false)];
eq("a stale price never outranks a fresh one", O.rankRows("h2h", "x", rows).map((r) => r.book), ["New", "Old"]);

console.log("\ndifference vs best");
const best = R("BetMGM", null, 100), dk = R("DraftKings", null, 80), fd = R("FanDuel", null, 75);
eq("best row → dash", O.diffVsBest("h2h", "x", best, best), { text: "—", tone: "best" });
eq("real-world +110 vs −105: 15 cents behind… computed on the even-money scale", O.diffVsBest("h2h", "x", R("A", null, 110), R("B", null, -105)).text, "\u221215");
eq("across even money: +100 vs −105 = −5", O.diffVsBest("h2h", "x", best, R("X", null, -105)).text, "\u22125");
eq("level with the best → also a best price", O.diffVsBest("h2h", "x", best, R("X", null, 100)), { text: "—", tone: "best" });
eq("compact headers", [O.sideHeaderShort("h2h", "New York Giants"), O.sideHeaderShort("spreads", "Los Angeles Chargers"), O.sideHeaderShort("totals", "Over"), O.sideHeaderShort("h2h3", "Draw"), O.sideHeaderShort("h2h3", "Buffalo Bills")], ["Giants ML", "Chargers", "Over", "Tie", "Bills ML"]);
const bSp = R("MGM", -2.5, -115), oSp = R("DK", -3, -110);
eq("different line dominates: −0.5 pt", O.diffVsBest("spreads", "Giants", bSp, oSp), { text: "\u22120.5 pt", tone: "worse" });
eq("same line → price gap", O.diffVsBest("spreads", "Giants", R("A", -3, -105), R("B", -3, -110)).text, "\u22125");
eq("Over 50.5 vs best Over 50: −0.5 pt", O.diffVsBest("totals", "Over", R("A", 50, -105), R("B", 50.5, -105)).text, "\u22120.5 pt");

console.log("\nrow / header text");
eq("ML row", O.fmtLine("h2h", "x", { point: null, price: 100 }), "+100");
eq("spread row", O.fmtLine("spreads", "Giants", { point: -3, price: -110 }), "\u22123 / \u2212110");
eq("underdog spread row", O.fmtLine("spreads", "Chargers", { point: 7, price: -105 }), "+7 / \u2212105");
eq("total rows", [O.fmtLine("totals", "Over", { point: 50.5, price: -102 }), O.fmtLine("totals", "Under", { point: 50.5, price: -118 })], ["O 50.5 / \u2212102", "U 50.5 / \u2212118"]);
eq("headers", [O.sideHeader("h2h", "New York Giants"), O.sideHeader("spreads", "Buffalo Bills"), O.sideHeader("h2h3", "Draw")], ["New York Giants ML", "Buffalo Bills", "Tie"]);
eq("period meta", O.PERIODS.map((p) => p.label), ["Full Game", "1H", "2H", "1Q", "2Q", "3Q", "4Q"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Board / quarter-half / line-comparison self-test.
 *
 * Applies migration 016 and exercises the whole pipeline — ingest, board RPC, period
 * polling budget, live scores, period-aware edge detection, comparison RPCs, permissions,
 * expiry, settlement guard — with REAL Odds API responses (scripts/fixtures/odds).
 * Everything runs inside ONE transaction that is ROLLED BACK: nothing is written and no
 * push notification can fire (pg_net queue inserts roll back too).
 *
 *   node scripts/board-selftest.js
 *
 * Kickoff times and last_update stamps in the fixtures are shifted to "now" at load time,
 * so the test never goes stale.
 */
const fs = require("fs");
const path = require("path");
const PROJECT = path.join(__dirname, "..");
const { connect } = require("./db");
const FIX = path.join(__dirname, "fixtures", "odds");

const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const iso = (ms) => new Date(ms).toISOString().replace(/.d+Z$/, "Z");
// stamp every last_update as "1 minute ago" so lines are fresh unless a test says otherwise
function fresh(o, agoMs = 60000) {
  const t = iso(Date.now() - agoMs);
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if ("last_update" in x) x.last_update = t; Object.values(x).forEach(walk); } };
  walk(o); return o;
}

const fgNfl = load("nfl-fg.json");
const fgNcaaf = load("ncaaf-fg.json");
// the board lists a rolling window, so move every kickoff forward: earliest NFL game = now + 28h
const shiftBy = Date.now() + 28 * 3600e3 - Math.min(...fgNfl.map((e) => Date.parse(e.commence_time)));
for (const e of [...fgNfl, ...fgNcaaf]) e.commence_time = iso(Date.parse(e.commence_time) + shiftBy);
const bills = load("nfl-period-us.json");
const billsPin = load("nfl-period-pinnacle.json");
const cfbPeriod = load("ncaaf-period.json");
bills.commence_time = fgNfl.find((e) => e.id === bills.id).commence_time;
cfbPeriod.commence_time = fgNcaaf.find((e) => e.id === cfbPeriod.id).commence_time;
const BILLS_ID = bills.id;
// per-event response exactly as production requests it: the monitored books + Pinnacle
const billsEvent = () => { const e = clone(bills); e.bookmakers = e.bookmakers.concat(clone(billsPin.bookmakers)); return fresh(e); };

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  → " + extra : ""}`); };
const section = (t) => console.log("\n" + t);

(async () => {
  const c = await connect({ quiet: true });
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const val = async (sql, params) => { const r = await one(sql, params); return r ? Object.values(r)[0] : null; };
  const asUser = async (id, fn) => {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: id, role: "authenticated" }), id]);
    try { return await fn(); } finally { try { await c.query("reset role"); } catch (_) {} }
  };
  const expectError = async (label, fn, re) => {
    await c.query("savepoint ee");
    try { await fn(); ok(label, false, "no error raised"); }
    catch (e) { ok(label, re ? re.test(e.message) : true, e.message.slice(0, 80)); }
    finally { await c.query("rollback to savepoint ee"); await c.query("reset role"); }
  };

  try {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(PROJECT, "supabase", "migrations", "016_games_board.sql"), "utf8"));

    const userId = await val("select id from public.profiles where role = 'user' and is_active limit 1");
    const adminId = await val("select id from public.profiles where role = 'admin' limit 1");
    // known config for the test: DK + BetMGM + FanDuel monitored, DK first
    await c.query(`update public.app_config set value = '["BetMGM","DraftKings","FanDuel","Wynn"]'::jsonb where key = 'active_books'`);
    await c.query(`update public.app_config set value = '3'::jsonb where key = 'min_edge_threshold'`);
    await c.query(`update public.app_config set value = '["NFL","NCAAF"]'::jsonb where key = 'active_sports'`);
    // start from an empty board / queue so production's live rows can't influence any count (all rolled back)
    for (const t of ["edges", "game_lines", "games", "engine_requests", "engine_period_spend"]) await c.query(`delete from public.${t}`);
    await c.query("delete from net.http_request_queue");

    // ---------------------------------------------------------------
    section("1. market key helpers");
    const parts = async (k) => JSON.stringify(await val("select public.engine_market_parts($1)", [k]));
    ok("spreads_h1 → spreads/1H", (await parts("spreads_h1")) === '["spreads","1H"]');
    ok("h2h_3_way_q3 → h2h3/3Q", (await parts("h2h_3_way_q3")) === '["h2h3","3Q"]');
    ok("totals → totals/FG", (await parts("totals")) === '["totals","FG"]');
    ok("alternate_spreads ignored", (await parts("alternate_spreads")) === "null");
    ok("bare h2h_3_way ignored", (await parts("h2h_3_way")) === "null");
    let roundTrip = true;
    for (const b of ["h2h", "h2h3", "spreads", "totals"]) for (const p of ["1H", "2H", "1Q", "2Q", "3Q", "4Q"]) {
      const key = await val("select public.engine_api_market($1,$2)", [b, p]);
      const back = await val("select public.engine_market_parts($1)", [key]);
      if (!back || back[0] !== b || back[1] !== p) roundTrip = false;
    }
    ok("api_market ↔ market_parts round-trips for all 24 combos", roundTrip);

    // ---------------------------------------------------------------
    section("2. full-game ingest (real NFL response, 29 events)");
    const nflBody = fresh(clone(fgNfl));
    const n = await val("select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['FG'])", [JSON.stringify(nflBody)]);
    ok("29 events ingested", Number(n) === 29, "n=" + n);
    ok("29 games rows", Number(await val("select count(*) from public.games where sport='NFL'")) === 29);
    const books = (await q("select distinct book from public.game_lines order by 1")).map((r) => r.book);
    ok("books stored = mapped books + Pinnacle only", JSON.stringify(books) === JSON.stringify(["BetMGM", "Caesars", "DraftKings", "FanDuel", "Pinnacle"]), books.join(","));
    const expectedLines = nflBody.reduce((s, e) => s + e.bookmakers.reduce((t, b) => t + b.markets.length, 0), 0);
    ok("one row per book×market", Number(await val("select count(*) from public.game_lines")) === expectedLines, `${expectedLines} expected`);
    const dkSpread = await one("select outcomes from public.game_lines where game_id=$1 and book='DraftKings' and market='spreads' and period='FG'", [BILLS_ID]);
    ok("DraftKings Chargers +7 (−105) stored", dkSpread && dkSpread.outcomes.some((o) => o.name === "Los Angeles Chargers" && o.point === 7 && o.price === -105));
    ok("board_state signalled", (await val("select count(*) from public.board_state where sport='NFL'")) == 1);

    // ---------------------------------------------------------------
    section("3. board_games RPC — DraftKings layout data");
    const board = await asUser(userId, () => val("select public.board_games('NFL','FG')"));
    const bg = board.games.find((g) => g.id === BILLS_ID);
    ok("board returns games with meta", board.games.length > 5 && board.meta.enabled === true, `${board.games.length} games`);
    ok("Bills card: spread book = DraftKings (priority)", bg.markets.spreads.book === "DraftKings");
    const sp = bg.markets.spreads.outcomes;
    ok("Chargers +7 −105 / Bills −7 −115", sp.find((o) => o.name === "Los Angeles Chargers").point === 7 && sp.find((o) => o.name === "Los Angeles Chargers").price === -105 && sp.find((o) => o.name === "Buffalo Bills").price === -115);
    const tt = bg.markets.totals.outcomes;
    ok("Over 50.5 −102 / Under 50.5 −118", tt.find((o) => o.name === "Over").price === -102 && tt.find((o) => o.name === "Under").point === 50.5 && tt.find((o) => o.name === "Under").price === -118);
    const ml = bg.markets.h2h.outcomes;
    ok("ML Chargers +275 / Bills −345", ml.find((o) => o.name === "Los Angeles Chargers").price === 275 && ml.find((o) => o.name === "Buffalo Bills").price === -345);
    ok("fresh lines are not stale", bg.markets.spreads.stale === false);
    ok("games sorted by kickoff", board.games.every((g, i, a) => i === 0 || new Date(a[i - 1].commence) <= new Date(g.commence)));
    ok("upcoming status", bg.status === "upcoming");

    // priority + fallback + book gating
    await c.query(`delete from public.game_lines where game_id=$1 and book='DraftKings'`, [BILLS_ID]);
    const fb = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.find((g) => g.id === BILLS_ID);
    ok("DK line missing → falls back to FanDuel", fb.markets.spreads.book === "FanDuel", fb.markets.spreads.book);
    await c.query(`update public.app_config set value='["BetMGM"]'::jsonb where key='active_books'`);
    const only = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.find((g) => g.id === BILLS_ID);
    ok("only monitored books shown (BetMGM)", only.markets.spreads.book === "BetMGM");
    const noMgm = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.filter((g) => Object.keys(g.markets).length === 0);
    ok("game with no line at any monitored book still listed (empty cells)", noMgm.length > 0, `${noMgm.length} games with empty markets`);
    await c.query(`update public.app_config set value='["BetMGM","DraftKings","FanDuel","Wynn"]'::jsonb where key='active_books'`);
    // restore DK
    await c.query(`select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['FG'])`, [JSON.stringify(fresh(clone(fgNfl)))]);

    // ---------------------------------------------------------------
    section("4. quarter / half ingest (real per-event response)");
    const pn = await val("select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['1H','2H','1Q','2Q','3Q','4Q'])", [JSON.stringify([billsEvent()])]);
    ok("period response ingested", Number(pn) === 1);
    const pbooks = (await q("select distinct book from public.game_lines where game_id=$1 and period<>'FG' order by 1", [BILLS_ID])).map((r) => r.book);
    ok("period books = mapped + Pinnacle (BetRivers/Bovada/… ignored)", JSON.stringify(pbooks) === JSON.stringify(["BetMGM", "Caesars", "DraftKings", "FanDuel", "Pinnacle"]), pbooks.join(","));
    ok("full-game lines untouched by a period ingest", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='FG'", [BILLS_ID])) >= 12);
    const pinPeriods = (await q("select distinct period from public.game_lines where game_id=$1 and book='Pinnacle' and period<>'FG' order by 1", [BILLS_ID])).map((r) => r.period);
    ok("sharp book prices only 1H + 1Q (as the feed does)", JSON.stringify(pinPeriods) === JSON.stringify(["1H", "1Q"]), pinPeriods.join(","));

    const b1q = (await asUser(userId, () => val("select public.board_games('NFL','1Q')"))).games.find((g) => g.id === BILLS_ID);
    ok("1Q moneyline uses DK's 3-way price", b1q.markets.h2h.market === "h2h3" && b1q.markets.h2h.outcomes.length === 3);
    const draw = b1q.markets.h2h.outcomes.find((o) => o.name === "Draw");
    ok("tie price present (Draw +390)", draw && draw.price === 390);
    const q1sp = b1q.markets.spreads.outcomes.find((o) => o.name === "Buffalo Bills");
    ok("1Q spread Bills −2.5 (−118)", q1sp.point === -2.5 && q1sp.price === -118);
    const b1h = (await asUser(userId, () => val("select public.board_games('NFL','1H')"))).games.find((g) => g.id === BILLS_ID);
    ok("1H totals Over 25.5 −110", b1h.markets.totals.outcomes.find((o) => o.name === "Over").point === 25.5);
    ok("1H moneyline is 3-way where offered", b1h.markets.h2h.market === "h2h3");
    const b4q = (await asUser(userId, () => val("select public.board_games('NFL','4Q')"))).games.find((g) => g.id === BILLS_ID);
    ok("4Q spread Bills −1.5", b4q.markets.spreads.outcomes.find((o) => o.name === "Buffalo Bills").point === -1.5);
    ok("4Q moneyline (no 3-way offered) falls back to 2-way", b4q.markets.h2h.market === "h2h" && b4q.markets.h2h.outcomes.length === 2);
    const b2h = (await asUser(userId, () => val("select public.board_games('NFL','2H')"))).games.find((g) => g.id === BILLS_ID);
    ok("2H moneyline present (DK 3-way or 2-way)", b2h.markets.h2h && b2h.markets.h2h.outcomes.length >= 2);
    const other = (await asUser(userId, () => val("select public.board_games('NFL','1Q')"))).games.find((g) => g.id !== BILLS_ID);
    ok("game without period data → empty markets, still listed", Object.keys(other.markets).length === 0);

    // college football per-event (different book coverage)
    await c.query(`select public.board_ingest_events('NCAAF','americanfootball_ncaaf',$1::jsonb,array['FG'])`, [JSON.stringify(fresh(clone(fgNcaaf)))]);
    const cfbId = cfbPeriod.id;
    await c.query(`select public.board_ingest_events('NCAAF','americanfootball_ncaaf',$1::jsonb,array['1H','2H','1Q','2Q','3Q','4Q'])`, [JSON.stringify([fresh(clone(cfbPeriod))])]);
    const cfb = (await asUser(userId, () => val("select public.board_games('NCAAF','1H')"))).games.find((g) => g.id === cfbId);
    ok("CFB 1H card built from DraftKings", cfb && cfb.markets.spreads && cfb.markets.spreads.book === "DraftKings");

    // ---------------------------------------------------------------
    section("5. stale-line handling");
    await c.query(`update public.game_lines set book_updated_at = now() - interval '3 hours' where game_id=$1 and period='FG' and book='DraftKings' and market='totals'`, [BILLS_ID]);
    const st = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.find((g) => g.id === BILLS_ID);
    ok("price older than the refresh window is flagged stale", st.markets.totals.stale === true && st.markets.spreads.stale === false);
    await c.query(`update public.game_lines set book_updated_at = now() - interval '3 hours' where game_id=$1 and period='FG'`, [BILLS_ID]);
    await c.query(`select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['FG'])`, [JSON.stringify(fresh(clone(fgNfl)))]);

    // a pulled market disappears instead of lingering
    const trimmed = fresh(clone(fgNfl));
    const ev = trimmed.find((e) => e.id === BILLS_ID);
    ev.bookmakers.find((b) => b.key === "draftkings").markets = ev.bookmakers.find((b) => b.key === "draftkings").markets.filter((m) => m.key !== "totals");
    await c.query(`select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['FG'])`, [JSON.stringify(trimmed)]);
    ok("market pulled by a book is deleted (no ghost price)", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='FG' and book='DraftKings' and market='totals'", [BILLS_ID])) === 0);
    ok("…other markets from that book kept", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='FG' and book='DraftKings'", [BILLS_ID])) === 2);
    await c.query(`select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,array['FG'])`, [JSON.stringify(fresh(clone(fgNfl)))]);

    // ---------------------------------------------------------------
    section("6. market comparison (board cell tap, no edge)");
    const mc = await asUser(userId, () => val("select public.market_comparison($1,'FG','spreads','Los Angeles Chargers')", [BILLS_ID]));
    const mcBooks = mc.rows.map((r) => r.book).sort();
    ok("rows for every monitored book with a line", JSON.stringify(mcBooks) === JSON.stringify(["BetMGM", "DraftKings", "FanDuel"]), mcBooks.join(","));
    ok("each row carries its OWN line + price + updatedAt", mc.rows.every((r) => typeof r.point === "number" && typeof r.price === "number" && r.updatedAt));
    const fdRow = mc.rows.find((r) => r.book === "FanDuel"), dkRow = mc.rows.find((r) => r.book === "DraftKings");
    ok("lines can differ by book (FanDuel +7.5 −120 vs DraftKings +7 −105)", fdRow.point === 7.5 && fdRow.price === -120 && dkRow.point === 7 && dkRow.price === -105);
    ok("no sharp book exposed to a normal user", !mc.rows.some((r) => r.book === "Pinnacle" || r.sharp === true) && !("fair" in mc));
    ok("game header (teams + kickoff)", mc.game.home === "Buffalo Bills" && !!mc.game.commence);
    const mcAdmin = await asUser(adminId, () => val("select public.market_comparison($1,'FG','spreads','Los Angeles Chargers')", [BILLS_ID]));
    ok("admin also sees the sharp row", mcAdmin.rows.some((r) => r.book === "Pinnacle" && r.sharp === true));
    const mcTie = await asUser(userId, () => val("select public.market_comparison($1,'1Q','h2h3','Draw')", [BILLS_ID]));
    ok("tie (Draw) comparison works for 3-way markets", mcTie.rows.length >= 1 && mcTie.rows.some((r) => r.price === 390));
    ok("unknown game → null", (await asUser(userId, () => val("select public.market_comparison('nope','FG','spreads','x')"))) === null);
    await expectError("bad period rejected", () => asUser(userId, () => q("select public.market_comparison($1,'5Q','spreads','x')", [BILLS_ID])), /Unknown period/);
    await expectError("bad market rejected", () => asUser(userId, () => q("select public.market_comparison($1,'FG','props','x')", [BILLS_ID])), /Unknown market/);

    // ---------------------------------------------------------------
    section("7. period-aware edge detection");
    // sport-level (full game) scan: BetMGM Chargers ML is a real edge vs Pinnacle? mutate to guarantee one.
    const fgScan = fresh(clone(fgNfl));
    const fgEv = fgScan.find((e) => e.id === BILLS_ID);
    fgEv.bookmakers.find((b) => b.key === "betmgm").markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Los Angeles Chargers").price = 300;
    const c1 = await val("select public.engine_scan_events('NFL',$1::jsonb)", [JSON.stringify(fgScan)]);
    const fgEdge = await one("select * from public.edges where event_id=$1 and period='FG' and market_key='h2h'", [BILLS_ID]);
    ok("full-game scan (2-arg call, as before) creates the ML edge", Number(c1) >= 1 && fgEdge && fgEdge.local_book === "BetMGM" && fgEdge.local_odds === 300, `edge ${fgEdge && fgEdge.edge_pct}%`);
    ok("full-game edge keeps the classic labels", fgEdge.bet_type === "Moneyline" && fgEdge.specific_bet === "Los Angeles Chargers ML" && fgEdge.period === "FG");

    // 1Q spread: BetMGM lists Bills −3 at +130 — same number as the sharp book
    const pev = billsEvent();
    const mgm = pev.bookmakers.find((b) => b.key === "betmgm");
    mgm.markets.find((m) => m.key === "spreads_q1").outcomes = [{ name: "Buffalo Bills", price: 130, point: -3 }, { name: "Los Angeles Chargers", price: -150, point: 3 }];
    const P = "array['1H','2H','1Q','2Q','3Q','4Q']";
    const c2 = await val(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev])]);
    const q1Edge = await one("select * from public.edges where event_id=$1 and period='1Q' and market_key='spreads'", [BILLS_ID]);
    ok("1Q spread edge detected against the sharp 1Q line", Number(c2) === 1 && q1Edge && q1Edge.local_book === "BetMGM", `created=${c2}`);
    ok("edge % ≈ 11.3", q1Edge && Math.abs(Number(q1Edge.edge_pct) - 11.3) < 0.4, q1Edge && q1Edge.edge_pct + "%");
    ok("labels: '1st Quarter Spread' / '1Q Buffalo Bills -3'", q1Edge.bet_type === "1st Quarter Spread" && q1Edge.specific_bet === "1Q Buffalo Bills -3", `${q1Edge.bet_type} | ${q1Edge.specific_bet}`);
    ok("method row written (admin-only table)", Number(await val("select count(*) from public.edge_method where edge_id=$1", [q1Edge.id])) === 1);
    ok("period scan did NOT expire the full-game edge", (await val("select status from public.edges where id=$1", [fgEdge.id])) === "active");
    const c3 = await val(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev])]);
    ok("identical rescan → no duplicate", Number(c3) === 0);
    // 2Q has no sharp benchmark → never an edge even with a wild price
    const pev2 = billsEvent();
    pev2.bookmakers.find((b) => b.key === "draftkings").markets.find((m) => m.key === "spreads_q2").outcomes = [{ name: "Buffalo Bills", price: 250, point: -1.5 }, { name: "Los Angeles Chargers", price: -300, point: 1.5 }];
    ok("period without a sharp line → no edge", Number(await val(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev2])])) === 0);
    // monitor-only mode: verify but never hunt
    const pev3 = billsEvent();
    pev3.bookmakers.find((b) => b.key === "betmgm").markets.find((m) => m.key === "spreads_h1").outcomes = [{ name: "Buffalo Bills", price: 125, point: -4 }, { name: "Los Angeles Chargers", price: -150, point: 4 }];
    ok("p_hunt=false creates nothing", Number(await val(`select public.engine_scan_events('NFL',$1::jsonb,false,${P})`, [JSON.stringify([pev3])])) === 0);
    await c.query(`update public.app_config set value='false'::jsonb where key='period_edges_enabled'`);
    ok("period-edges kill switch: nothing alerted for quarter/half lines…", Number(await val(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev3])])) === 0);
    const fgKill = fresh(clone(fgNfl));
    const killEv = fgKill.find((e) => e.id === "b225458a282e140c44c45651255f2f6c").bookmakers.find((b) => b.key === "betmgm");
    killEv.markets.find((m) => m.key === "totals").outcomes.find((o) => o.name === "Under").price = 135;
    killEv.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Los Angeles Chargers").price = 300; // keep the live ML edge valid
    ok("…while full-game hunting still works", Number(await val("select public.engine_scan_events('NFL',$1::jsonb,true)", [JSON.stringify(fgKill)])) >= 1);
    await c.query("delete from public.edges where event_id=$1 and market_key='totals' and period='FG'", [BILLS_ID]);
    await c.query(`update public.app_config set value='true'::jsonb where key='period_edges_enabled'`);
    ok("p_hunt=true would have found the 1H edge", Number(await val(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev3])])) === 1);
    // the sharp 1Q line moves → the edge is re-verified and dies
    const pev4 = billsEvent();
    pev4.bookmakers.find((b) => b.key === "betmgm").markets.find((m) => m.key === "spreads_q1").outcomes = mgm.markets.find((m) => m.key === "spreads_q1").outcomes;
    pev4.bookmakers.find((b) => b.key === "pinnacle").markets.find((m) => m.key === "spreads_q1").outcomes = [{ name: "Buffalo Bills", price: -105, point: -3.5 }, { name: "Los Angeles Chargers", price: -105, point: 3.5 }];
    await c.query(`select public.engine_scan_events('NFL',$1::jsonb,false,${P})`, [JSON.stringify([pev4])]);
    ok("sharp line moved → 1Q edge expired", (await val("select status from public.edges where id=$1", [q1Edge.id])) === "expired");
    ok("…full-game edge still active", (await val("select status from public.edges where id=$1", [fgEdge.id])) === "active");
    // monitored-but-not-alerting sport: existing edge gets verified/expired even with p_hunt=false
    const fgMove = fresh(clone(fgNfl));
    fgMove.find((e) => e.id === BILLS_ID).bookmakers.find((b) => b.key === "betmgm").markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Los Angeles Chargers").price = 295;
    await c.query("select public.engine_scan_events('NFL',$1::jsonb,false)", [JSON.stringify(fgMove)]);
    const fgAfter = await one("select status, local_odds, edge_pct from public.edges where id=$1", [fgEdge.id]);
    ok("board-only sport: price drift (+300→+295) silently refreshed without hunting", fgAfter.status === "active" && fgAfter.local_odds === 295, JSON.stringify(fgAfter));
    // …and once the price no longer beats the sharp line the edge dies (+250 is negative EV)
    fgMove.find((e) => e.id === BILLS_ID).bookmakers.find((b) => b.key === "betmgm").markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Los Angeles Chargers").price = 250;
    await c.query("select public.engine_scan_events('NFL',$1::jsonb,false)", [JSON.stringify(fgMove)]);
    ok("board-only sport: edge that no longer beats the sharp line is expired", (await val("select status from public.edges where id=$1", [fgEdge.id])) === "expired");
    await c.query("update public.edges set status='active', local_odds=300 where id=$1", [fgEdge.id]);

    // ---------------------------------------------------------------
    section("8. edge comparison (Edge Detail)");
    // (duplicate suppression counts expired edges too — age the earlier ones past its 5-minute window)
    await c.query("update public.edges set created_at = now() - interval '10 minutes' where event_id=$1", [BILLS_ID]);
    // re-create the 1Q edge fresh for comparison tests
    await c.query(`select public.engine_scan_events('NFL',$1::jsonb,true,${P})`, [JSON.stringify([pev])]);
    // production ingests the response BEFORE scanning it — do the same so the comparison sees BetMGM's −3 +130
    await c.query(`select public.board_ingest_events('NFL','americanfootball_nfl',$1::jsonb,${P})`, [JSON.stringify([pev])]);
    const e1q = await one("select * from public.edges where event_id=$1 and period='1Q' and market_key='spreads' and status='active'", [BILLS_ID]);
    ok("1Q edge active again", !!e1q);
    const cmp = await asUser(userId, () => val("select public.edge_comparison($1)", [e1q.id]));
    const bookNames = cmp.rows.map((r) => r.book).sort();
    ok("comparison rows: BetMGM, DraftKings, FanDuel (monitored books with a 1Q line)", JSON.stringify(bookNames) === JSON.stringify(["BetMGM", "DraftKings", "FanDuel"]), bookNames.join(","));
    ok("period + market + side echoed", cmp.period === "1Q" && cmp.market === "spreads" && cmp.outcome === "Buffalo Bills" && cmp.sourceBook === "BetMGM");
    const mg = cmp.rows.find((r) => r.book === "BetMGM"), dkr = cmp.rows.find((r) => r.book === "DraftKings");
    ok("line + price per book (BetMGM −3 +130 vs DK −2.5 −118)", mg.point === -3 && mg.price === 130 && dkr.point === -2.5 && dkr.price === -118);
    ok("fair line included (≈ +107 at −3)", cmp.fair && Math.abs(cmp.fair.price - 107) <= 2 && cmp.fair.point === -3 && cmp.fair.stale === false, JSON.stringify(cmp.fair));
    ok("kickoff + teams for the header", cmp.game.home === "Buffalo Bills" && !!cmp.game.commence);
    ok("Pinnacle name / raw price NOT exposed to users", !("sharp" in cmp) || cmp.sharp === null, JSON.stringify(cmp.sharp));
    ok("no Pinnacle row in the table", !cmp.rows.some((r) => r.book === "Pinnacle"));
    const cmpAdmin = await asUser(adminId, () => val("select public.edge_comparison($1)", [e1q.id]));
    ok("admin gets the raw sharp line", cmpAdmin.sharp && cmpAdmin.sharp.book === "Pinnacle" && cmpAdmin.sharp.price === 100 && cmpAdmin.sharp.point === -3, JSON.stringify(cmpAdmin.sharp));
    const cmpFg = await asUser(userId, () => val("select public.edge_comparison($1)", [fgEdge.id]));
    ok("full-game edge comparison works too (ML)", cmpFg.period === "FG" && cmpFg.rows.length >= 3 && cmpFg.fair && typeof cmpFg.fair.price === "number", `fair ${cmpFg.fair && cmpFg.fair.price}`);
    await c.query("update public.edges set status='expired' where id=$1", [e1q.id]);
    ok("expired edge → null for users", (await asUser(userId, () => val("select public.edge_comparison($1)", [e1q.id]))) === null);
    ok("…but admins can still open it", (await asUser(adminId, () => val("select public.edge_comparison($1)", [e1q.id]))) !== null);
    // sharp line gone → fall back to the recorded fair price, flagged stale
    await c.query("update public.edges set status='active' where id=$1", [e1q.id]);
    await c.query("delete from public.game_lines where game_id=$1 and book='Pinnacle' and period='1Q'", [BILLS_ID]);
    const cmpFb = await asUser(userId, () => val("select public.edge_comparison($1)", [e1q.id]));
    ok("sharp line dropped → recorded fair price, marked stale", cmpFb.fair && cmpFb.fair.stale === true && typeof cmpFb.fair.price === "number");
    const manual = await one(`insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time)
        values ('NFL','NFL','A @ B','Moneyline','A ML','South Point',105,4.0, now()+interval '5 hours') returning id`);
    const cmpManual = await asUser(userId, () => val("select public.edge_comparison($1)", [manual.id]));
    ok("manual edge (no event) → empty comparison, no crash", cmpManual.rows.length === 0 && cmpManual.fair === null);

    // ---------------------------------------------------------------
    section("9. permissions");
    await expectError("anon cannot call board_games", async () => { await c.query("set local role anon"); await q("select public.board_games('NFL','FG')"); }, /permission denied/);
    await expectError("signed-out (no uid) rejected", async () => { await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claims','',true), set_config('request.jwt.claim.sub','',true)"); await q("select public.board_games('NFL','FG')"); }, /Not signed in/);
    ok("user cannot read game_lines directly (RLS)", (await asUser(userId, () => val("select count(*) from public.game_lines"))) == 0);
    ok("user cannot read games directly (RLS)", (await asUser(userId, () => val("select count(*) from public.games"))) == 0);
    ok("user cannot read period spend", (await asUser(userId, () => val("select count(*) from public.engine_period_spend"))) == 0);
    ok("admin can read game_lines", Number(await asUser(adminId, () => val("select count(*) from public.game_lines"))) > 100);
    ok("user CAN read board_state (realtime signal)", Number(await asUser(userId, () => val("select count(*) from public.board_state"))) >= 1);
    await expectError("user cannot call board_ingest_events", () => asUser(userId, () => q("select public.board_ingest_events('NFL','x','[]'::jsonb,array['FG'])")), /permission denied/);
    await expectError("user cannot call engine_scan_events", () => asUser(userId, () => q("select public.engine_scan_events('NFL','[]'::jsonb)")), /permission denied/);
    await expectError("user cannot call engine_maybe_poll_periods", () => asUser(userId, () => q("select public.engine_maybe_poll_periods()")), /permission denied/);
    await expectError("user cannot call board_line_rows", () => asUser(userId, () => q("select public.board_line_rows('x','FG','h2h','x',array['DraftKings'],30,true)")), /permission denied/);

    // ---------------------------------------------------------------
    section("10. period poller (budget governor)");
    await c.query(`update public.app_config set value='true'::jsonb where key='engine_enabled'`);
    await c.query(`update public.app_config set value='60'::jsonb where key='period_window_hours'`);
    await c.query(`update public.engine_state set credits_remaining = 11000 where id=1`);
    await c.query("delete from public.engine_requests where req_type='period'");
    await c.query("update public.games set period_polled_at = null, period_cost = null");
    await c.query(`update public.app_config set value='50'::jsonb where key='period_daily_credit_cap'`);
    await c.query("select public.engine_maybe_poll_periods()");
    const reqs = await q("select event_id, req_type from public.engine_requests where req_type='period' order by request_id");
    ok("cap 50 credits at ~24/game → exactly 2 calls", reqs.length === 2, `${reqs.length} fired`);
    const soonest = await q("select id from public.games where sport in ('NFL','NCAAF') and commence_time > now()+interval '10 minutes' and commence_time <= now()+interval '60 hours' order by commence_time, id limit 2");
    ok("soonest kickoffs first", reqs.map((r) => r.event_id).join() === soonest.map((r) => r.id).join());
    const qurl = await q("select url from net.http_request_queue where url like '%/events/%' order by id desc limit 2");
    const u = qurl[0].url;
    ok("uses bookmakers= (never regions=) incl. the sharp book", /bookmakers=[^&]*pinnacle/.test(u) && !/regions=/.test(u), u.replace(/apiKey=[^&]+/, "apiKey=***").slice(0, 170));
    ok("requests all 24 period market keys", (u.match(/markets=([^&]+)/)[1].split(",").length) === 24);
    ok("per-event endpoint", /\/events\/[0-9a-f]{32}\/odds/.test(u));
    ok("game polled-at stamped so it won't refire", Number(await val("select count(*) from public.games where period_polled_at is not null")) === 2);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("in-flight calls count against the cap → no more fired", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 2);
    // ---- hourly pacing: a quarter of the daily cap per rolling hour ----
    await c.query("delete from public.engine_requests where req_type='period'");
    await c.query("update public.games set period_polled_at = null, period_cost = null");
    await c.query(`update public.app_config set value='400'::jsonb where key='period_daily_credit_cap'`);
    await c.query("delete from public.engine_period_spend");
    await c.query("select public.engine_maybe_poll_periods()");
    ok("cap 400 → first burst limited to ~100 credits (4 games), not the whole day", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 4);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("…and nothing more is fired within the same hour", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 4);
    await c.query("update public.games set period_polled_at = now() - interval '61 minutes' where period_polled_at is not null");
    await c.query("select public.engine_maybe_poll_periods()");
    ok("an hour later the next games in line are served (fresh ones aren't repeated)", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 8);
    await c.query(`update public.app_config set value='50'::jsonb where key='period_daily_credit_cap'`);
    await c.query("delete from public.engine_requests where req_type='period'");
    await c.query("update public.games set period_polled_at = null");
    await c.query(`insert into public.engine_period_spend (day, credits, calls) values ((now() at time zone 'America/New_York')::date, 50, 3) on conflict (day) do update set credits = 50`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("daily cap already spent → nothing fired", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);
    await c.query(`update public.engine_period_spend set credits = 0`);
    await c.query(`update public.app_config set value='800'::jsonb where key='period_daily_credit_cap'`);
    await c.query(`update public.engine_state set credits_remaining = 620 where id=1`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("low credits scale the allowance down (10% of headroom = 12 < 24/game)", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);
    await c.query(`update public.engine_state set credits_remaining = 400 where id=1`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("at/below the reserve → nothing fired", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);
    await c.query(`update public.engine_state set credits_remaining = 11000 where id=1`);
    await c.query(`update public.app_config set value='false'::jsonb where key='period_lines_enabled'`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("admin toggle off → nothing fired", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);
    await c.query(`update public.app_config set value='true'::jsonb where key='period_lines_enabled'`);
    await c.query(`update public.app_config set value='2'::jsonb where key='period_window_hours'`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("outside the kickoff window → nothing fired", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);
    // games known to have NO period lines are re-checked rarely
    await c.query(`update public.app_config set value='60'::jsonb where key='period_window_hours'`);
    await c.query(`update public.games set period_polled_at = now() - interval '3 hours', period_cost = 0`);
    await c.query("select public.engine_maybe_poll_periods()");
    ok("cost-0 games (no period lines) are not re-polled every cycle", Number(await val("select count(*) from public.engine_requests where req_type='period'")) === 0);

    // ---------------------------------------------------------------
    section("11. live-score poller + response routing (simulated API responses)");
    const nc = await q("select column_name from information_schema.columns where table_schema='net' and table_name='_http_response' order by ordinal_position");
    const cols = nc.map((r) => r.column_name);
    const feed = async (id, type, sport, apiSport, eventId, status, headers, body) => {
      await c.query("insert into public.engine_requests (request_id, sport, api_sport, req_type, event_id) values ($1,$2,$3,$4,$5)", [id, sport, apiSport, type, eventId]);
      await c.query("insert into net._http_response (id, status_code, headers, content, timed_out, error_msg) values ($1,$2,$3::jsonb,$4,false,null)", [id, status, JSON.stringify(headers), typeof body === "string" ? body : JSON.stringify(body)]);
    };
    ok("net._http_response has the columns the engine relies on", ["id", "status_code", "headers", "content", "timed_out", "error_msg"].every((k) => cols.includes(k)), cols.join(","));
    await c.query("delete from public.engine_requests");
    await c.query("delete from public.games"); await c.query("delete from public.edges"); await c.query("delete from public.engine_period_spend");
    // (a) sport-level odds response
    await feed(910001, "odds", "NFL", "americanfootball_nfl", null, 200, { "x-requests-remaining": "11050", "x-requests-last": "3" }, fresh(clone(fgNfl)));
    await c.query("select public.engine_process_pending()");
    ok("odds response → games + lines persisted", Number(await val("select count(*) from public.games where sport='NFL'")) === 29);
    ok("credits remaining read from headers", Number(await val("select credits_remaining from public.engine_state where id=1")) === 11050);
    ok("scan run logged", Number(await val("select count(*) from public.engine_runs where kind='scan' and sport='NFL' and at > now()-interval '1 minute'")) >= 1);
    // (b) per-event response
    await feed(910002, "period", "NFL", "americanfootball_nfl", BILLS_ID, 200, { "x-requests-remaining": "11029", "x-requests-last": "21" }, billsEvent());
    await c.query("select public.engine_process_pending()");
    ok("period response → quarter/half lines persisted", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='1Q'", [BILLS_ID])) >= 8);
    ok("learned cost stored on the game (21)", Number(await val("select period_cost from public.games where id=$1", [BILLS_ID])) === 21);
    const sp2 = await one("select credits, calls from public.engine_period_spend where day=(now() at time zone 'America/New_York')::date");
    ok("spend tracked for the daily cap", sp2 && sp2.credits === 21 && sp2.calls === 1, JSON.stringify(sp2));
    ok("full-game lines survived the period response", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='FG'", [BILLS_ID])) >= 12);
    // (c) live scores
    await c.query("update public.games set commence_time = now() - interval '1 hour' where id=$1", [BILLS_ID]);
    await c.query("update public.engine_state set last_live_scores_at = null where id=1");
    await c.query("delete from public.engine_requests where req_type='scores_live'");
    await c.query("select public.engine_maybe_scores_live()");
    ok("live-score poll fires while a board game is in progress", Number(await val("select count(*) from public.engine_requests where req_type='scores_live'")) === 1);
    const sUrl = (await q("select url from net.http_request_queue order by id desc limit 1"))[0].url;
    ok("scores endpoint, 1-day window", /\/scores\/\?daysFrom=1/.test(sUrl), sUrl.replace(/apiKey=[^&]+/, "apiKey=***"));
    await c.query("select public.engine_maybe_scores_live()");
    ok("throttled to the configured interval", Number(await val("select count(*) from public.engine_requests where req_type='scores_live'")) === 1);
    const liveId = (await one("select request_id from public.engine_requests where req_type='scores_live'")).request_id;
    await c.query("insert into net._http_response (id, status_code, headers, content, timed_out, error_msg) values ($1,200,$2::jsonb,$3,false,null)", [liveId, JSON.stringify({ "x-requests-remaining": "11027", "x-requests-last": "2" }),
      JSON.stringify([{ id: BILLS_ID, completed: false, home_team: "Buffalo Bills", away_team: "Los Angeles Chargers", scores: [{ name: "Buffalo Bills", score: "10" }, { name: "Los Angeles Chargers", score: "7" }] }])]);
    await c.query("select public.engine_process_pending()");
    const live = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.find((g) => g.id === BILLS_ID);
    ok("board shows the game LIVE with the score", live && live.status === "live" && live.homeScore === 10 && live.awayScore === 7, JSON.stringify({ s: live && live.status, h: live && live.homeScore, a: live && live.awayScore }));
    // completed → drops off
    await c.query("insert into public.engine_requests (request_id, sport, api_sport, req_type) values (910009,'NFL','americanfootball_nfl','scores')");
    await c.query("insert into net._http_response (id, status_code, headers, content, timed_out, error_msg) values (910009,200,'{}'::jsonb,$1,false,null)",
      [JSON.stringify([{ id: BILLS_ID, completed: true, home_team: "Buffalo Bills", away_team: "Los Angeles Chargers", scores: [{ name: "Buffalo Bills", score: "27" }, { name: "Los Angeles Chargers", score: "17" }] }])]);
    await c.query("select public.engine_process_pending()");
    const done = (await asUser(userId, () => val("select public.board_games('NFL','FG')"))).games.find((g) => g.id === BILLS_ID);
    ok("finished game leaves the board", !done);
    // (d) upstream failures never poison the board
    await feed(910003, "period", "NFL", "americanfootball_nfl", BILLS_ID, 404, {}, { message: "Event not found" });
    await feed(910004, "odds", "NFL", "americanfootball_nfl", null, 200, {}, "not json at all");
    await c.query("select public.engine_process_pending()");
    ok("404 / garbage responses are logged, nothing thrown", Number(await val("select count(*) from public.engine_requests where not processed")) === 0);
    // (e) ingest failure isolation: a body that breaks ingest must not stop edge scanning
    const bad = fresh(clone(fgNfl));
    bad[0].commence_time = "not-a-date";
    await feed(910005, "odds", "NFL", "americanfootball_nfl", null, 200, {}, bad);
    await c.query("select public.engine_process_pending()");
    ok("bad event in a response is skipped, the rest still processed", Number(await val("select count(*) from public.games where sport='NFL'")) >= 28);
    // (f) a genuinely poisonous payload must not block the requests queued behind it
    const poison = fresh(clone(fgNfl));
    poison.find((e) => e.bookmakers.some((b) => b.key === "pinnacle")).bookmakers.find((b) => b.key === "pinnacle").markets.find((m) => m.key === "h2h").outcomes[0].price = "abc";
    await c.query("delete from public.game_lines where game_id=$1 and period='1Q'", [BILLS_ID]);
    await feed(910006, "odds", "NFL", "americanfootball_nfl", null, 200, {}, poison);
    await feed(910007, "period", "NFL", "americanfootball_nfl", BILLS_ID, 200, { "x-requests-last": "21" }, billsEvent());
    await c.query("select public.engine_process_pending()");
    ok("poisoned response is logged as an error…", Number(await val("select count(*) from public.engine_runs where kind='error' and detail like 'Response skipped%' and at > now() - interval '1 minute'")) >= 1);
    ok("…and the request queued behind it is still processed", Number(await val("select count(*) from public.game_lines where game_id=$1 and period='1Q'", [BILLS_ID])) >= 8);
    ok("nothing left unprocessed (no retry loop)", Number(await val("select count(*) from public.engine_requests where not processed")) === 0);

    // ---------------------------------------------------------------
    section("12. expiry + housekeeping");
    await c.query("delete from public.edges");
    await c.query(`update public.app_config set value='15'::jsonb where key='poll_interval_minutes'`);
    await c.query(`update public.app_config set value='120'::jsonb where key='period_refresh_minutes'`);
    const mk = async (period, ageMin) => (await one(`insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time, source, event_id, market_key, outcome_name, period, verified_at)
        values ('NFL','NFL','A @ B','Moneyline','A ML','BetMGM',105,4.0, now()+interval '5 hours','engine','evt','h2h','A',$1, now() - make_interval(mins => $2)) returning id`, [period, ageMin])).id;
    const fgFresh = await mk("FG", 30), fgOld = await mk("FG", 50), pFresh = await mk("1H", 200), pOld = await mk("1H", 300);
    await c.query("select public.engine_expire_stale()");
    const stt = async (id) => val("select status from public.edges where id=$1", [id]);
    ok("full-game edge verified 30m ago stays (limit 45m at 15m polling)", (await stt(fgFresh)) === "active");
    ok("full-game edge unverified 50m expires", (await stt(fgOld)) === "expired");
    ok("period edge unverified 3h20m stays (limit 4h at 2h refresh)", (await stt(pFresh)) === "active");
    ok("period edge unverified 5h expires", (await stt(pOld)) === "expired");
    await c.query(`insert into public.games (id, sport, api_sport, home_team, away_team, commence_time) values ('old1','NFL','x','H','A', now() - interval '4 days')`);
    await c.query("select public.engine_expire_stale()");
    ok("games older than 3 days are purged (lines cascade)", Number(await val("select count(*) from public.games where id='old1'")) === 0);

    // ---------------------------------------------------------------
    section("13. settlement guard — period plays are never graded from a final score");
    const bev = "settle-evt";
    const eFg = (await one(`insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time, source, event_id, market_key, outcome_name, period)
       values ('NFL','NFL','Away @ Home','Moneyline','Home ML','BetMGM',110,4.0, now()-interval '4 hours','engine',$1,'h2h','Home','FG') returning id`, [bev])).id;
    const e1h = (await one(`insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time, source, event_id, market_key, outcome_name, period)
       values ('NFL','NFL','Away @ Home','1st Half Moneyline','1H Home ML','BetMGM',110,4.0, now()-interval '4 hours','engine',$1,'h2h','Home','1H') returning id`, [bev])).id;
    for (const eid of [eFg, e1h]) await c.query(`insert into public.bets (user_id, edge_id, sport, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, kelly_fraction, recommended_wager, actual_wager)
       values ($1,$2,'NFL','Away @ Home','x','x','BetMGM',110,4.0,25,10,10)`, [userId, eid]);
    const settled = await val(`select public.engine_apply_scores($1::jsonb)`, [JSON.stringify([{ id: bev, completed: true, home_team: "Home", away_team: "Away", scores: [{ name: "Home", score: "24" }, { name: "Away", score: "20" }] }])]);
    ok("exactly one bet auto-settled (the full-game one)", Number(settled) === 1, "settled=" + settled);
    ok("full-game bet graded (win)", (await val("select result from public.bets where edge_id=$1", [eFg])) === "win");
    ok("1st-half bet left for manual settlement", (await val("select result from public.bets where edge_id=$1", [e1h])) === null);

    // ---------------------------------------------------------------
    section("14. regression — the original engine self-test scenario (MLB)");
    await c.query("delete from public.edges");
    const mlb = (dk = -110, mgm = 110, wynn = 1.5) => [{
      id: "engine-selftest-1", sport_key: "baseball_mlb", commence_time: new Date(Date.now() + 3 * 3600e3).toISOString(), home_team: "TEST Beta", away_team: "TEST Alpha",
      bookmakers: [
        { key: "pinnacle", markets: [
          { key: "h2h", outcomes: [{ name: "TEST Alpha", price: -128 }, { name: "TEST Beta", price: 112 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -105, point: 8.5 }, { name: "Under", price: -115, point: 8.5 }] },
          { key: "spreads", outcomes: [{ name: "TEST Alpha", price: 102, point: -1.5 }, { name: "TEST Beta", price: -112, point: 1.5 }] }] },
        { key: "draftkings", markets: [
          { key: "h2h", outcomes: [{ name: "TEST Alpha", price: dk }, { name: "TEST Beta", price: -105 }] },
          { key: "totals", outcomes: [{ name: "Over", price: 105, point: 8.5 }, { name: "Under", price: -102, point: 8.5 }] }] },
        { key: "betmgm", markets: [{ key: "totals", outcomes: [{ name: "Over", price: -125, point: 8.5 }, { name: "Under", price: mgm, point: 8.5 }] }] },
        { key: "williamhill_us", markets: [{ key: "totals", outcomes: [{ name: "Over", price: 100, point: 9 }, { name: "Under", price: -110, point: 9 }] }] },
        { key: "wynnbet", markets: [{ key: "spreads", outcomes: [{ name: "TEST Alpha", price: -125, point: -wynn }, { name: "TEST Beta", price: 105, point: wynn }] }] }] }];
    await c.query(`update public.app_config set value='["BetMGM","DraftKings","Wynn"]'::jsonb where key='active_books'`);
    const created = await val("select public.engine_scan_events('MLB',$1::jsonb)", [JSON.stringify(mlb())]);
    const rows = await q("select specific_bet, local_book, local_odds, edge_pct, status, period from public.edges where event_id='engine-selftest-1'");
    ok("phase 1: exactly 3 edges", Number(created) === 3, "created=" + created);
    const mlE = rows.find((r) => r.specific_bet === "TEST Alpha ML"), totE = rows.find((r) => r.specific_bet === "Under 8.5"), sprE = rows.find((r) => r.specific_bet === "TEST Beta +1.5");
    ok("ML ≈ 3.74% · total ≈ 7.29% · spread ≈ 5.84%", mlE && totE && sprE && Math.abs(mlE.edge_pct - 3.74) < 0.06 && Math.abs(totE.edge_pct - 7.29) < 0.06 && Math.abs(sprE.edge_pct - 5.84) < 0.06);
    ok("all classic edges are period FG", rows.every((r) => r.period === "FG"));
    ok("alerts fanned out to users", Number(await val("select count(*) from public.user_alerts ua join public.edges e on e.id=ua.edge_id where e.event_id='engine-selftest-1'")) > 0);
    ok("phase 2: rescan → 0", Number(await val("select public.engine_scan_events('MLB',$1::jsonb)", [JSON.stringify(mlb())])) === 0);
    await c.query("select public.engine_scan_events('MLB',$1::jsonb)", [JSON.stringify(mlb(-112, -120, 2.5))]);
    const r3 = await q("select specific_bet, status, local_odds from public.edges where event_id='engine-selftest-1'");
    ok("phase 3: worsened edge expired · moved line expired · drifting edge refreshed",
      r3.find((r) => r.specific_bet === "Under 8.5").status === "expired" && r3.find((r) => r.specific_bet === "TEST Beta +1.5").status === "expired" &&
      r3.find((r) => r.specific_bet === "TEST Alpha ML").status === "active" && r3.find((r) => r.specific_bet === "TEST Alpha ML").local_odds === -112);
  } catch (e) {
    fail++;
    console.error("\nCRASH:", e.message, "\n", e.where || "");
  } finally {
    await c.query("rollback");
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed  (transaction rolled back — nothing persisted)`);
    process.exit(fail ? 1 : 0);
  }
})();

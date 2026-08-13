/**
 * Auto-settlement self-test — exercises engine_apply_scores + engine_settle_bet
 * with a fixture: a WIN (total), a LOSS (moneyline), and a PUSH (spread).
 * Uses the admin account, then fully reverses every change it made.
 * Usage: node scripts/settle-selftest.js
 */
const { connect } = require("./db");

const EV = "settle-selftest-1";

async function main() {
  const c = await connect();
  let pass = 0, fail = 0;
  const check = (label, ok, extra = "") => {
    console.log(`  ${ok ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`);
    ok ? pass++ : fail++;
  };

  const { rows: [admin] } = await c.query(
    `select id from public.profiles where role = 'admin' order by created_at limit 1`);
  if (!admin) throw new Error("no admin user found");
  const uid = admin.id;
  const { rows: [{ balance: startBal }] } = await c.query(
    `select balance from public.bankrolls where user_id = $1`, [uid]);

  const mkEdge = async (market, outcome, point, odds) => {
    const { rows: [e] } = await c.query(
      `insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds,
         edge_pct, game_time, source, event_id, market_key, outcome_name, point, status)
       values ('MLB','MLB','TEST Alpha @ TEST Beta','x','x','DraftKings',$4, 3.0,
         now() - interval '4 hours', 'engine', $5, $1, $2, $3, 'expired')
       returning id`, [market, outcome, point, odds, EV]);
    return e.id;
  };
  const mkBet = async (edgeId, wager, odds, label) => {
    const { rows: [b] } = await c.query(
      `insert into public.bets (user_id, edge_id, sport, matchup, bet_type, specific_bet, local_book,
         local_odds, edge_pct, actual_wager)
       values ($1, $2, 'MLB', 'TEST Alpha @ TEST Beta', 'x', $5, 'DraftKings', $4, 3.0, $3)
       returning id`, [uid, edgeId, wager, odds, label]);
    return b.id;
  };

  try {
    // fixture: final score TEST Alpha (away) 5 — TEST Beta (home) 4, total 9
    const eWin = await mkEdge("totals", "Over", 8.5, 100);      // total 9 > 8.5 → WIN (+$100 at +100)
    const eLoss = await mkEdge("h2h", "TEST Beta", null, -110); // Beta lost → LOSS (−$50)
    const ePush = await mkEdge("spreads", "TEST Alpha", -1.0, -110); // 5−1 = 4 → PUSH ($0)
    const bWin = await mkBet(eWin, 100, 100, "Over 8.5");
    const bLoss = await mkBet(eLoss, 50, -110, "TEST Beta ML");
    const bPush = await mkBet(ePush, 75, -110, "TEST Alpha -1");

    const scores = JSON.stringify([{
      id: EV, completed: true,
      home_team: "TEST Beta", away_team: "TEST Alpha",
      scores: [{ name: "TEST Beta", score: "4" }, { name: "TEST Alpha", score: "5" }],
    }]);
    const { rows: [{ n }] } = await c.query(
      `select public.engine_apply_scores($1::jsonb) as n`, [scores]);
    check("settles all 3 bets", n === 3, `settled=${n}`);

    const { rows: bets } = await c.query(
      `select id, result, profit_loss from public.bets where id = any($1::uuid[])`,
      [[bWin, bLoss, bPush]]);
    const get = (id) => bets.find((b) => b.id === id);
    check("total Over 8.5 → WIN +$100", get(bWin)?.result === "win" && Number(get(bWin)?.profit_loss) === 100,
      `${get(bWin)?.result} ${get(bWin)?.profit_loss}`);
    check("ML on loser → LOSS −$50", get(bLoss)?.result === "loss" && Number(get(bLoss)?.profit_loss) === -50,
      `${get(bLoss)?.result} ${get(bLoss)?.profit_loss}`);
    check("spread lands exactly → PUSH $0", get(bPush)?.result === "push" && Number(get(bPush)?.profit_loss) === 0,
      `${get(bPush)?.result} ${get(bPush)?.profit_loss}`);

    const { rows: [{ balance: endBal }] } = await c.query(
      `select balance from public.bankrolls where user_id = $1`, [uid]);
    check("bankroll moved by +$50 net", Number(endBal) - Number(startBal) === 50,
      `${startBal} → ${endBal}`);

    const { rows: [{ n: again }] } = await c.query(
      `select public.engine_apply_scores($1::jsonb) as n`, [scores]);
    check("re-applying scores settles nothing (immutable)", again === 0, `settled=${again}`);
  } finally {
    // full reversal: bets, edges, history rows, balance
    await c.query(`delete from public.bets where edge_id in (select id from public.edges where event_id = $1)`, [EV]);
    await c.query(`delete from public.bankroll_history where user_id = $1 and reason like 'Bet %(auto-settled)%TEST%'`, [uid]);
    await c.query(`delete from public.edges where event_id = $1`, [EV]);
    await c.query(`update public.bankrolls set balance = $2 where user_id = $1`, [uid, startBal]);
    console.log("\nCleanup: fixture bets/edges/history removed, bankroll restored.");
    await c.end();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

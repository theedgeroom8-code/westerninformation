/**
 * Engine smoke test — enables the engine and drives two ticks manually:
 * tick 1 fires Odds API requests (async via pg_net), tick 2 processes the
 * responses and creates real edges. Prints the engine log + resulting feed.
 * Usage: node scripts/engine-test.js
 */
const { connect } = require("./db");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = await connect({ quiet: false });

  const cron = await c.query(`select jobname, schedule, active from cron.job where jobname = 'edge-engine-tick'`);
  if (!cron.rows.length) throw new Error("cron job 'edge-engine-tick' is NOT scheduled");
  console.log(`✓ Cron scheduled: ${cron.rows[0].jobname} (${cron.rows[0].schedule}) active=${cron.rows[0].active}`);

  await c.query(`update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'engine_enabled'`);
  await c.query(`update public.app_config set value = '5'::jsonb, updated_at = now() where key = 'max_edges_per_scan'`);
  console.log("✓ Engine enabled (max 5 edges per scan)");

  console.log("→ Tick 1: firing Odds API requests...");
  await c.query(`select public.engine_tick()`);
  const reqs = await c.query(`select sport from public.engine_requests where not processed`);
  console.log(`  Requests in flight: ${reqs.rows.map((r) => r.sport).join(", ") || "(none)"}`);

  console.log("→ Waiting 12s for responses...");
  await sleep(12000);
  console.log("→ Tick 2: processing responses...");
  await c.query(`select public.engine_tick()`);
  await sleep(2000);

  const runs = await c.query(
    `select to_char(at, 'HH24:MI:SS') as t, kind, sport, events, edges_created, credits_remaining, detail
     from public.engine_runs order by id desc limit 15`
  );
  console.log("\nENGINE LOG (newest first):");
  runs.rows.forEach((r) =>
    console.log(`  [${r.t}] ${r.kind.padEnd(7)} ${(r.sport || "").padEnd(6)} ${r.detail || ""}`)
  );

  const state = await c.query(`select * from public.engine_state where id = 1`);
  console.log("\nENGINE STATE:", JSON.stringify(state.rows[0]));

  const edges = await c.query(
    `select sport, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, source,
            to_char(game_time, 'Mon DD HH24:MI') as game
     from public.edges order by created_at desc limit 12`
  );
  console.log(`\nEDGES NOW IN FEED (${edges.rows.length}):`);
  edges.rows.forEach((e) =>
    console.log(`  [${e.source}] ${e.sport} ${e.matchup} — ${e.specific_bet} @ ${e.local_book} (${e.local_odds > 0 ? "+" : ""}${e.local_odds}) edge ${e.edge_pct}% · ${e.game}`)
  );

  const method = await c.query(
    `select count(*)::int as n from public.edge_method em join public.edges e on e.id = em.edge_id where e.source = 'engine'`
  );
  console.log(`\nMethod rows for engine edges: ${method.rows[0].n}`);

  await c.end();
  console.log("\nSmoke test complete.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

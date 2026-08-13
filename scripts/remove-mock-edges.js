/**
 * Removes the mock/seed demo edges (user request: "no mock data" before
 * going live). Bets are untouched — they snapshot all edge fields and their
 * FK is ON DELETE SET NULL. Alerts for mock edges cascade away with them.
 * Usage: node scripts/remove-mock-edges.js
 */
const { connect } = require("./db");

async function main() {
  const c = await connect();
  const before = await c.query(`select id, sport, matchup, source from public.edges`);
  console.log(`Edges currently in feed: ${before.rows.length}`);
  before.rows.forEach((e) => console.log(`  [${e.source}] ${e.sport} — ${e.matchup}`));

  const engineMade = before.rows.filter((e) => e.source === "engine").length;
  if (engineMade > 0) {
    console.log(`\nSkipping ${engineMade} engine-created edge(s) — deleting manual/seed rows only.`);
  }
  const res = await c.query(`delete from public.edges where source = 'manual'`);
  console.log(`\n✓ Deleted ${res.rowCount} mock/seed edge(s).`);

  const bets = await c.query(`select count(*)::int as n from public.bets`);
  console.log(`✓ Bets preserved with snapshots: ${bets.rows[0].n}`);
  await c.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

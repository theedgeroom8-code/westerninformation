/**
 * Engine self-test — validates the full detection pipeline with a realistic
 * Odds-API-shaped fixture (clearly labeled TEST teams), through the exact
 * production function the live poller calls:
 *
 *   phase 1: scan → expect 3 edges (ML, total, spread) + method rows + alerts
 *   phase 2: identical rescan → expect 0 (exact dedup)
 *   phase 3: drifted prices → expect 1 expired (edge gone), 1 expired
 *            (line moved), 1 silently updated
 *   cleanup: removes all self-test edges + their alerts
 *
 * Usage: node scripts/engine-selftest.js
 */
const { connect } = require("./db");

const EVENT_ID = "engine-selftest-1";

function fixture({ dkYankeesPrice = -110, mgmUnderPrice = 110, wynnPoint = 1.5 }) {
  const commence = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  return [
    {
      id: EVENT_ID,
      sport_key: "baseball_mlb",
      commence_time: commence,
      home_team: "TEST Beta",
      away_team: "TEST Alpha",
      bookmakers: [
        {
          key: "pinnacle", title: "Pinnacle",
          markets: [
            { key: "h2h", outcomes: [
              { name: "TEST Alpha", price: -128 },
              { name: "TEST Beta", price: 112 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -105, point: 8.5 },
              { name: "Under", price: -115, point: 8.5 },
            ]},
            { key: "spreads", outcomes: [
              { name: "TEST Alpha", price: 102, point: -1.5 },
              { name: "TEST Beta", price: -112, point: 1.5 },
            ]},
          ],
        },
        {
          key: "draftkings", title: "DraftKings",
          markets: [
            { key: "h2h", outcomes: [
              { name: "TEST Alpha", price: dkYankeesPrice },   // ~3.7% edge at -110
              { name: "TEST Beta", price: -105 },              // negative edge — skipped
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: 105, point: 8.5 },        // 0.3% — below threshold
              { name: "Under", price: -102, point: 8.5 },      // 1.2% — below threshold
            ]},
          ],
        },
        {
          key: "betmgm", title: "BetMGM",
          markets: [
            { key: "totals", outcomes: [
              { name: "Over", price: -125, point: 8.5 },       // negative edge — skipped
              { name: "Under", price: mgmUnderPrice, point: 8.5 }, // +110 → 7.3% edge
            ]},
          ],
        },
        {
          key: "williamhill_us", title: "Caesars",
          markets: [
            { key: "totals", outcomes: [
              { name: "Over", price: 100, point: 9.0 },        // line differs from sharp — skipped
              { name: "Under", price: -110, point: 9.0 },
            ]},
          ],
        },
        {
          key: "wynnbet", title: "WynnBET",
          markets: [
            { key: "spreads", outcomes: [
              { name: "TEST Alpha", price: -125, point: -wynnPoint },
              { name: "TEST Beta", price: 105, point: wynnPoint }, // +1.5 +105 → 5.8% edge
            ]},
          ],
        },
      ],
    },
  ];
}

async function scan(c, fx) {
  const { rows } = await c.query(`select public.engine_scan_events('MLB', $1::jsonb) as created`, [
    JSON.stringify(fx),
  ]);
  return rows[0].created;
}

async function edgeRows(c) {
  const { rows } = await c.query(
    `select specific_bet, local_book, local_odds, edge_pct, status from public.edges
     where event_id = $1 order by created_at, specific_bet`, [EVENT_ID]
  );
  return rows;
}

async function main() {
  const c = await connect();
  let pass = 0, fail = 0;
  const check = (label, ok, extra = "") => {
    console.log(`  ${ok ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`);
    ok ? pass++ : fail++;
  };

  try {
    console.log("PHASE 1 — fresh scan");
    const created = await scan(c, fixture({}));
    const rows1 = await edgeRows(c);
    check("creates exactly 3 edges", created === 3, `created=${created}`);
    const ml = rows1.find((r) => r.specific_bet === "TEST Alpha ML");
    const tot = rows1.find((r) => r.specific_bet === "Under 8.5");
    const spr = rows1.find((r) => r.specific_bet === "TEST Beta +1.5");
    check("moneyline edge ≈ 3.74%", !!ml && Math.abs(ml.edge_pct - 3.74) < 0.06, ml && `got ${ml.edge_pct}% @ ${ml.local_book}`);
    check("total edge ≈ 7.29%", !!tot && Math.abs(tot.edge_pct - 7.29) < 0.06, tot && `got ${tot.edge_pct}% @ ${tot.local_book}`);
    check("spread edge ≈ 5.84%", !!spr && Math.abs(spr.edge_pct - 5.84) < 0.06, spr && `got ${spr.edge_pct}% @ ${spr.local_book}`);

    const m = await c.query(
      `select count(*)::int n from public.edge_method em join public.edges e on e.id = em.edge_id where e.event_id = $1`, [EVENT_ID]);
    check("method rows written (admin-only)", m.rows[0].n === 3, `n=${m.rows[0].n}`);
    const a = await c.query(
      `select count(*)::int n from public.user_alerts ua join public.edges e on e.id = ua.edge_id where e.event_id = $1`, [EVENT_ID]);
    check("alerts fanned out to users", a.rows[0].n > 0, `alerts=${a.rows[0].n}`);

    console.log("PHASE 2 — identical rescan (dedup)");
    const again = await scan(c, fixture({}));
    check("creates 0 duplicates", again === 0, `created=${again}`);

    console.log("PHASE 3 — drifted prices");
    // BetMGM Under worsens to -120 (edge gone) · Wynn line moves 1.5→2.5
    // (unverifiable) · DraftKings ML drifts -110→-112 (still good, updates)
    const third = await scan(c, fixture({ dkYankeesPrice: -112, mgmUnderPrice: -120, wynnPoint: 2.5 }));
    const rows3 = await edgeRows(c);
    const ml3 = rows3.find((r) => r.specific_bet === "TEST Alpha ML");
    const tot3 = rows3.find((r) => r.specific_bet === "Under 8.5");
    const spr3 = rows3.find((r) => r.specific_bet === "TEST Beta +1.5");
    check("worsened edge expired", tot3?.status === "expired", `status=${tot3?.status}`);
    check("moved line expired", spr3?.status === "expired", `status=${spr3?.status}`);
    check("drifting edge silently refreshed", ml3?.status === "active" && ml3?.local_odds === -112,
      `status=${ml3?.status} odds=${ml3?.local_odds} edge=${ml3?.edge_pct}%`);
    check("no new edges from drift scan", third <= 1, `created=${third}`);
  } finally {
    const del = await c.query(`delete from public.edges where event_id = $1`, [EVENT_ID]);
    console.log(`\nCleanup: removed ${del.rowCount} self-test edge(s) (+alerts via cascade).`);
    await c.end();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

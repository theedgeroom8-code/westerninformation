/**
 * Verifies THE ODDS API key works and shows remaining quota.
 * Usage: npm run test-odds
 * Server-side only — the key never ships in the app.
 */
require("dotenv").config();

async function main() {
  const key = process.env.ODDS_API_KEY;
  if (!key) { console.error("ODDS_API_KEY missing from .env"); process.exit(1); }

  // 1) List sports (free call — does not consume quota)
  const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}`);
  if (!sportsRes.ok) {
    console.error(`Sports request failed: HTTP ${sportsRes.status} — ${await sportsRes.text()}`);
    process.exit(1);
  }
  const sports = await sportsRes.json();
  const active = sports.filter((s) => s.active);
  console.log(`✓ Key is valid. ${sports.length} sports available (${active.length} in season).`);
  console.log("  In-season now:", active.slice(0, 10).map((s) => s.key).join(", ") || "none");

  // 2) One real odds call (consumes 1 credit) to prove market data + show quota
  const target = active.find((s) => ["americanfootball_nfl", "baseball_mlb", "basketball_nba", "icehockey_nhl"].includes(s.key)) ?? active[0];
  if (!target) { console.log("No active sports right now — key valid, quota untested."); return; }

  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/${target.key}/odds/?apiKey=${key}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
  );
  if (!oddsRes.ok) {
    console.error(`Odds request failed: HTTP ${oddsRes.status} — ${await oddsRes.text()}`);
    process.exit(1);
  }
  const games = await oddsRes.json();
  console.log(`✓ Odds fetch works: ${games.length} upcoming ${target.key} games.`);
  if (games[0]) {
    const books = (games[0].bookmakers ?? []).map((b) => b.key);
    console.log(`  Example: ${games[0].away_team} @ ${games[0].home_team} — ${books.length} books (${books.slice(0, 6).join(", ")}${books.includes("pinnacle") ? " … includes PINNACLE ✓" : ""})`);
  }
  console.log(`  Quota — used: ${oddsRes.headers.get("x-requests-used")}, remaining: ${oddsRes.headers.get("x-requests-remaining")}`);
}

main().catch((e) => { console.error("Test failed:", e.message); process.exit(1); });

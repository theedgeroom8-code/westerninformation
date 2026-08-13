/**
 * Stores the Odds API key server-side (private.secrets) so the in-database
 * engine can use it. The key never ships to any client.
 * Usage: node scripts/set-engine-secret.js
 */
const { connect } = require("./db");

async function main() {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY missing from .env");
  const client = await connect();
  await client.query(
    `insert into private.secrets (name, value) values ('odds_api_key', $1)
     on conflict (name) do update set value = excluded.value, updated_at = now()`,
    [key]
  );
  const { rows } = await client.query(
    `select name, updated_at from private.secrets where name = 'odds_api_key'`
  );
  console.log("✓ Odds API key stored server-side:", rows[0]);
  await client.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

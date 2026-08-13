/**
 * Migration runner — applies supabase/migrations/*.sql in order.
 * Usage: node scripts/migrate.js
 *
 * Tries the direct connection first (IPv6). If unreachable (common on
 * IPv4-only networks), falls back to the session pooler across regions.
 */
require("dotenv").config();
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const REF = process.env.SUPABASE_PROJECT_REF;
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const DIRECT_URL = process.env.SUPABASE_DB_URL;

const POOLER_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-central-1", "eu-west-1", "eu-west-2", "eu-north-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "ap-northeast-2", "sa-east-1", "ca-central-1",
];

function candidates() {
  const list = [];
  if (DIRECT_URL) list.push({ label: "direct", config: { connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 } });
  for (const prefix of ["aws-1", "aws-0"]) {
    for (const region of POOLER_REGIONS) {
      for (const port of [5432, 6543]) {
        list.push({
          label: `pooler ${prefix} ${region}:${port}`,
          config: {
            host: `${prefix}-${region}.pooler.supabase.com`,
            port, // 5432 = session mode (supports DDL/transactions)
            database: "postgres",
            user: `postgres.${REF}`,
            password: PASSWORD,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 6000,
          },
        });
      }
    }
  }
  return list;
}

async function connect() {
  const errors = [];
  for (const { label, config } of candidates()) {
    const client = new Client(config);
    try {
      process.stdout.write(`Trying ${label}... `);
      await client.connect();
      console.log("connected ✓");
      return client;
    } catch (err) {
      console.log(`no (${err.code || err.message.slice(0, 60)})`);
      errors.push(`${label}: ${err.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error("Could not reach the database via any route.\n" + errors.slice(0, 3).join("\n"));
}

async function main() {
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) { console.log("No migration files found."); return; }

  const client = await connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      console.log(`\nApplying ${file} (${(sql.length / 1024).toFixed(1)} kB)...`);
      await client.query(sql);
      console.log(`${file} ✓`);
    }
    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema='public' order by 1`
    );
    console.log("\nPublic tables:", rows.map((r) => r.table_name).join(", "));
    console.log("\nAll migrations applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error("\nMigration failed:", err.message); process.exit(1); });

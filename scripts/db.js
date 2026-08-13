/**
 * Shared DB connection helper for admin scripts.
 * Tries the direct connection, then session poolers (aws-1/aws-0, all regions).
 */
require("dotenv").config();
const { Client } = require("pg");

const REF = process.env.SUPABASE_PROJECT_REF;
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const DIRECT_URL = process.env.SUPABASE_DB_URL;

const POOLER_REGIONS = [
  "us-west-2", "us-east-1", "us-east-2", "us-west-1",
  "eu-central-1", "eu-west-1", "eu-west-2", "eu-north-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "ap-northeast-2", "sa-east-1", "ca-central-1",
];

function candidates() {
  const list = [];
  if (DIRECT_URL) list.push({ label: "direct", config: { connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 } });
  for (const prefix of ["aws-1", "aws-0"]) {
    for (const region of POOLER_REGIONS) {
      list.push({
        label: `pooler ${prefix} ${region}`,
        config: {
          host: `${prefix}-${region}.pooler.supabase.com`,
          port: 5432,
          database: "postgres",
          user: `postgres.${REF}`,
          password: PASSWORD,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 6000,
        },
      });
    }
  }
  return list;
}

async function connect({ quiet = true } = {}) {
  const errors = [];
  for (const { label, config } of candidates()) {
    const client = new Client(config);
    try {
      await client.connect();
      if (!quiet) console.log(`connected via ${label}`);
      return client;
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error("Could not reach the database via any route.\n" + errors.slice(0, 3).join("\n"));
}

module.exports = { connect };

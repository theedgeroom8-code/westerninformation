/** Quick sanity check of the deployed schema. Usage: node scripts/verify-db.js */
require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const q = async (label, sql) => {
    const { rows } = await client.query(sql);
    console.log(label, JSON.stringify(rows));
  };
  await q("edges:", "select count(*)::int as n, min(status) as status from public.edges");
  await q("edge_method:", "select count(*)::int as n from public.edge_method");
  await q("config keys:", "select array_agg(key order by key) as keys from public.app_config");
  await q("realtime tables:", `select array_agg(tablename order by tablename) as t from pg_publication_tables where pubname='supabase_realtime'`);
  await q("rls enabled:", `select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity`);
  await q("triggers:", `select array_agg(tgname order by tgname) as t from pg_trigger where tgname in ('on_auth_user_created','fanout_edge_alerts','protect_profile_fields')`);
  await client.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });

/**
 * Promote an account to admin. Robust: if the profile/settings/bankroll rows
 * are missing (e.g. account created in the Supabase dashboard), they are
 * created first from auth.users.
 * Usage: npm run make-admin someone@email.com
 */
require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const email = process.argv[2];
  if (!email) { console.error("Usage: npm run make-admin <email>"); process.exit(1); }

  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: authUsers } = await client.query(
    "select id, email, raw_user_meta_data from auth.users where lower(email)=lower($1)",
    [email]
  );
  if (!authUsers.length) {
    console.error(`No auth account found for "${email}". Create the user first (app signup or Supabase dashboard → Authentication → Users).`);
    await client.end();
    process.exit(1);
  }
  const u = authUsers[0];

  // Ensure supporting rows exist, then promote.
  await client.query(
    `insert into public.profiles (id, name, email, role)
     values ($1, coalesce($2,''), $3, 'admin')
     on conflict (id) do update set role='admin', is_active=true`,
    [u.id, u.raw_user_meta_data?.name ?? "", u.email]
  );
  await client.query(`insert into public.user_settings (user_id) values ($1) on conflict do nothing`, [u.id]);
  await client.query(`insert into public.bankrolls (user_id) values ($1) on conflict do nothing`, [u.id]);

  const { rows } = await client.query("select email, role, is_active from public.profiles where id=$1", [u.id]);
  await client.end();
  console.log(`✓ ${rows[0].email} → role=${rows[0].role}, active=${rows[0].is_active}. Open /admin on web and sign in.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

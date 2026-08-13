/**
 * Sends a test push notification to every registered device.
 * Usage: npm run test-push
 * Requires at least one row in push_tokens (register via the dev build first).
 */
require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(
    `select pt.token, p.email from public.push_tokens pt
     join public.profiles p on p.id = pt.user_id`
  );
  await client.end();

  if (!rows.length) {
    console.log("No registered devices yet. Install the dev build, sign in, and enable Push Notifications (see PUSH-SETUP.md).");
    return;
  }

  console.log(`Sending test push to ${rows.length} device(s): ${rows.map((r) => r.email).join(", ")}`);
  const messages = rows.map((r) => ({
    to: r.token,
    title: "⚡ Test Alert — Edge System",
    body: "Push notifications are working. You'll get edge alerts like this.",
    sound: "default",
    channelId: "edges",
    data: { type: "broadcast" },
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
  const out = await res.json();
  console.log("Expo response:", JSON.stringify(out, null, 2));
  const errors = (out.data ?? []).filter((t) => t.status !== "ok");
  console.log(errors.length ? `⚠ ${errors.length} failed (see above)` : "✓ All accepted — check your phone.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });

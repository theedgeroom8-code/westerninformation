// Relay for real Web Push. Postgres can POST JSON (it already does, to Expo's
// push API) but it cannot do the VAPID-signing / payload-encryption the Web
// Push protocol requires — that's real crypto, not something plpgsql should
// hand-roll. This endpoint does that part via the `web-push` npm package and
// is only ever called by our own database (supabase/migrations/020_web_push.sql),
// authenticated with a shared secret so random internet traffic can't use it
// to spam pushes (or burn our VAPID sender reputation) on our behalf.

const webpush = require("web-push");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (req.headers["x-relay-secret"] !== process.env.RELAY_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    res.status(500).json({ error: "VAPID keys not configured" });
    return;
  }
  webpush.setVapidDetails("https://westerninformationnetwork.com", vapidPublic, vapidPrivate);

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: "No items" });
    return;
  }

  const results = await Promise.allSettled(
    items.map((item) => webpush.sendNotification(item.subscription, JSON.stringify(item.payload)))
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - sent;

  res.status(200).json({ sent, failed });
};

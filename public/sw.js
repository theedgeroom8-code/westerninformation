// Service worker for real background Web Push. Required for notifications to
// fire while the tab/browser is closed — the plain `new Notification()` path
// (lib/webNotify.ts) only works while a tab is open, and throws outright on
// most mobile browsers. This is the piece that makes alerts arrive like a
// real app notification on a phone, including with the browser killed.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Western Information Network", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Western Information Network";
  const options = {
    body: data.body || "",
    icon: "/pwa-icon.png",
    badge: "/pwa-icon.png",
    data: data.data || {},
    tag: data.data?.edgeId ? `edge-${data.data.edgeId}` : data.data?.type || undefined,
    renotify: !!data.data?.edgeId,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = "/";
  if (data.type === "edge" && data.edgeId) url = `/edge-detail?edgeId=${data.edgeId}`;
  else if (data.type === "broadcast") url = "/alerts";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

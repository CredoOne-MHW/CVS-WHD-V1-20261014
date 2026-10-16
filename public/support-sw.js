/* Support portal service worker: makes the portal installable and opens instantly / offline with the last copy.
   Only page navigations are handled (network first); API calls always go to the network. */
const CACHE = "support-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || new Response("<h1>You're offline</h1><p>Reconnect to raise or check a ticket.</p>", { headers: { "content-type": "text/html" } })))
  );
});

// ─── DeenHabit Service Worker ─────────────────────────────────────────────────
// Bump SW_VERSION to trigger a cache bust + update notification in the UI.
const SW_VERSION = "2.0.0";
const CACHE_STATIC = `deenhabit-static-v${SW_VERSION}`;
const CACHE_API    = `deenhabit-api-v${SW_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const API_HOSTS = ["api.aladhan.com", "nominatim.openstreetmap.org"];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const valid = [CACHE_STATIC, CACHE_API];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !valid.includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() => notifyClients({ type: "SW_ACTIVATED", version: SW_VERSION }))
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;

  if (API_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(networkFirst(event.request, CACHE_API));
    return;
  }
  event.respondWith(cacheFirst(event.request, CACHE_STATIC));
});

// ─── Strategies ───────────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === "navigate") {
      const fallback = await caches.match("/index.html");
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Cross-tab messaging ──────────────────────────────────────────────────────
function notifyClients(payload) {
  self.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .then((clients) => clients.forEach((c) => c.postMessage(payload)));
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

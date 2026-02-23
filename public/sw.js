// DeenHabit Service Worker
const CACHE_VERSION = 2;
const CACHE_NAME = `deenhabit-v${CACHE_VERSION}`;
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // wait to activate until explicitly told to skipWaiting by the client
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  // Claim clients immediately so new SW can control pages once activated
  self.clients.claim();
  // Notify clients that a new service worker is active
  self.clients.matchAll().then((clients) => {
    clients.forEach((c) => c.postMessage({ type: "SW_ACTIVATED", version: CACHE_VERSION }));
  });
});

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          // Only cache successful same-origin GET responses
          if (
            res &&
            res.ok &&
            event.request.method === "GET" &&
            new URL(event.request.url).origin === self.location.origin
          ) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});

/* PackScan service worker — app shell caching untuk akses offline. */
const CACHE_NAME = "packscan-v3";
const APP_SHELL = ["/", "/login", "/scan", "/riwayat", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigasi halaman: network-first, fallback ke cache saat offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached =
            (await caches.match(request)) ||
            (await caches.match("/scan")) ||
            (await caches.match("/"));
          return (
            cached ||
            new Response("Offline dan halaman belum pernah dibuka.", {
              status: 503,
              statusText: "Offline",
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  // Aset (JS/CSS chunk dll): network-first agar selalu sinkron dengan build
  // terbaru — cache hanya dipakai sebagai fallback offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.status === 200 && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        return (
          cached ||
          new Response("", { status: 503, statusText: "Offline" })
        );
      }
    })()
  );
});

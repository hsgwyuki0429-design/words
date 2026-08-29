const CACHE_NAME = "words-2026-2-v12";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2026.2.12",
  "./src/app.js?v=2026.2.12",
  "./src/logic.js",
  "./src/logic.js?v=2026.2.12",
  "./src/storage.js",
  "./health-notes.html?v=2026.2.8",
  "./data/items.json?v=2026.08.26",
  "./data/public-items.json?v=2026.2.4",
  "./data/health-items.json?v=2026.2.4",
  "./manifest.webmanifest",
  "./icons/app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached ?? caches.match("./index.html"));
      return cached ?? network;
    }),
  );
});

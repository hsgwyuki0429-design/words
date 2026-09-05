const APP_VERSION = "2026.9.27";
const CACHE_NAME = `words-${APP_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${APP_VERSION}`,
  `./kobun.css?v=${APP_VERSION}`,
  `./src/kobun.js?v=${APP_VERSION}`,
  `./src/kobun-logic.js?v=${APP_VERSION}`,
  `./data/kobun-auxiliaries.json?v=${APP_VERSION}`,
  `./data/kobun-vocabulary.json?v=${APP_VERSION}`,
  `./src/app.js?v=${APP_VERSION}`,
  "./src/audio.js?v=2026.2.18",
  "./src/max-cues.js?v=2026.2.18",
  `./src/logic.js?v=${APP_VERSION}`,
  "./src/logic.js",
  `./src/quiz-gestures.js?v=${APP_VERSION}`,
  `./src/speech.js?v=${APP_VERSION}`,
  `./src/storage.js?v=${APP_VERSION}`,
  "./health-notes.html?v=2026.2.8",
  "./public-notes.html?v=2026.9.1",
  "./data/items.json?v=2026.08.31b",
  "./data/public-items.json?v=2026.09.01",
  "./data/health-items.json?v=2026.09.01",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./icons/app-icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
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

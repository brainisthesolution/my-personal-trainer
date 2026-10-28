const CACHE_NAME = "fit-timer-v29";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./data/routines.json",
  "./data/exercise-library.json",
  "./data/exercise-guides.json",
  "./data/face-yoga.json"
];

function precacheFresh(cache, paths) {
  // Bypass the HTTP cache too: a new cache name alone can still populate a
  // release with stale JS/JSON from the browser's previous HTTP responses.
  return cache.addAll(paths.map(path => new Request(new URL(path, self.location.href), { cache: "reload" })));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precacheFresh(cache, ASSETS);
    const payloads = await Promise.all(["./data/exercise-library.json", "./data/face-yoga.json"].map(async path => (await cache.match(path)).json()));
    const images = [...new Set(payloads.flatMap(payload => payload.exercises.map(exercise => `./${exercise.image}`)).filter(path => path !== "./"))];
    await precacheFresh(cache, images);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("fit-timer-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    const root = new URL("./", self.location.href);
    const path = new URL(event.request.url).pathname;
    if (path !== root.pathname && path !== `${root.pathname}index.html`) return;
    event.respondWith(
      fetch(event.request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("./index.html", response.clone());
        }
        return response;
      }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match("./index.html")))
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(event.request, { ignoreSearch: true })).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

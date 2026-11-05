const CACHE_NAME = "pachecode-v0.2.2";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./protocol.js",
  "./manifest.webmanifest", "./icons/pachecode.svg", "./icons/pachecode-192.png",
  "./icons/pachecode-512.png", "./vendor/jsQR.js", "./vendor/pako.min.js",
];
const SCOPE_URL = new URL(self.registration.scope);
const ASSET_PATHS = new Set(ASSETS.map((asset) => new URL(asset, SCOPE_URL).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isLocalAsset = url.origin === SCOPE_URL.origin && ASSET_PATHS.has(url.pathname);
  const isLocalNavigation = event.request.mode === "navigate"
    && url.origin === SCOPE_URL.origin
    && url.pathname.startsWith(SCOPE_URL.pathname);
  if (!isLocalAsset && !isLocalNavigation) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(async (cached) => {
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (isLocalAsset && response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        if (isLocalNavigation) return caches.match(new URL("./index.html", SCOPE_URL));
        throw error;
      }
    })
  );
});

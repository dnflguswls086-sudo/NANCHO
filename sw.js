const CACHE_NAME = "nancho-role-check-v1";
const APP_SHELL = [
  "./check.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./firebase-config.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Firebase / gstatic network requests should stay network-first.
  const url = new URL(req.url);
  if (url.hostname.includes("firebase") || url.hostname.includes("gstatic")) return;

  event.respondWith(
    fetch(req).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req))
  );
});

const CACHE_NAME = "nancho-pc-pwa-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./teacher.html",
  "./display.html",
  "./check.html",
  "./pins.html",
  "./pc-manifest.webmanifest",
  "./pc-icon-192.png",
  "./pc-icon-512.png",
  "./nancho-tool-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url => cache.add(url).catch(()=>null)))
    )
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

  const url = new URL(req.url);
  // Firebase/CDN requests stay network-first.
  if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("gstatic") ||
    url.hostname.includes("googleapis")
  ) return;

  event.respondWith(
    fetch(req).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req))
  );
});

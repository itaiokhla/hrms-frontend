/* HRMS service worker (G-24 / AS-M12).
 *
 * 1. Offline punch: /punch and the static chunks it needs are cached, so the punch page opens without a network
 *    (the page's own offline queue stores punches until the connection returns). Navigations are network-first;
 *    /_next/static files are immutable and served cache-first. API calls are never cached, except the caller's own
 *    /api/v1/auth/me, kept as an offline fallback and removed at sign-out.
 * 2. Push: the server sends a payload-less Web Push "tickle"; the worker fetches the newest unread notification over
 *    the user's own session and shows it (no notification text crosses the push service). A click opens its link.
 */
const VERSION = "hrms-sw-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const ME = `${VERSION}-me`;
const OFFLINE_PAGES = ["/punch"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    for (const page of OFFLINE_PAGES) {
      try {
        const response = await fetch(page, { credentials: "include", redirect: "follow" });
        if (response.ok && !response.redirected) {
          await shell.put(page, response.clone());
          await cacheAssetsOf(await response.text());
        }
      } catch (_) {
        /* offline at install: cached on the next visit */
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheAssetsOf(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) urls.add(match[1]);
  const cache = await caches.open(STATIC);
  await Promise.all([...urls].map(async (url) => {
    if (await cache.match(url)) return;
    try {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    } catch (_) {
      /* best effort */
    }
  }));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") {
    event.waitUntil(caches.delete(ME));
    return;
  }
  if (request.method !== "GET") return;
  if (url.pathname === "/api/v1/auth/me") {
    event.respondWith(networkFirst(request, ME, true));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate" && OFFLINE_PAGES.includes(url.pathname)) {
    event.respondWith(punchPage(request, url.pathname));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, onlyOk) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (!onlyOk || response.ok) cache.put(request, response.clone());
    else if (response.status === 401 || response.status === 403) cache.delete(request);
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

async function punchPage(request, path) {
  const shell = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const copy = response.clone();
      shell.put(path, copy.clone());
      copy.text().then(cacheAssetsOf).catch(() => {});
    }
    return response;
  } catch (error) {
    const hit = await shell.match(path);
    if (hit) return hit;
    return new Response("<h1>Offline</h1><p>Open the punch page once while online to use it offline.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let title = "HRMS";
    let body = "You have a new notification.";
    let link = "/dashboard";
    let tag = "hrms";
    try {
      const response = await fetch("/api/v1/notifications", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        const latest = (data.notifications || []).find((n) => !n.is_read) || (data.notifications || [])[0];
        if (latest) {
          title = latest.title || title;
          body = latest.message || body;
          link = latest.action_url || link;
          tag = `hrms-${latest.id}`;
        }
      }
    } catch (_) {
      /* show the generic text */
    }
    await self.registration.showNotification(title, { body, tag, data: { link }, icon: "/favicon.ico", badge: "/favicon.ico" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";
  const target = new URL(link.startsWith("/") ? link : "/dashboard", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) return client.navigate(target);
        return undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});

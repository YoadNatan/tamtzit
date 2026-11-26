/* תמצית: notifications only (docs/study/DECISIONS-2026-11-26.md, OD1).
 * No fetch handler and no cache: pages, chunks and deploys never pass through
 * here, so a deploy, a stale chunk and installing behave as without it.
 * Registered only on a device whose member turned notifications on (or is on
 * their settings screen). A push carries Declarative Web Push JSON
 * (server/study/notify.ts); newer iOS and Safari show it without this file.
 *
 * Kill path: when /api/study/health stops giving the VAPID key, the app
 * unregisters this worker. For a broken worker, deploy this file as just:
 *   self.addEventListener('install', () => self.skipWaiting());
 *   self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
 * (vercel.json serves it with no-cache, so devices fetch it on their next visit). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = {};
  }
  if (!d || typeof d !== 'object') d = {};
  const n = d.notification && typeof d.notification === 'object' ? d.notification : {};
  const url = sameOrigin(n.navigate);
  // Always show, and nothing slow first: a push that shows nothing can cost the subscription (iOS).
  e.waitUntil(
    self.registration.showNotification(text(n.title, 'תמצית'), {
      body: text(n.body, ''),
      lang: 'he',
      dir: 'rtl',
      tag: typeof n.tag === 'string' && n.tag ? n.tag : undefined,
      renotify: false,
      silent: n.silent === true,
      icon: '/icon-192.png',
      data: { url, id: Number.isSafeInteger(d.n) && d.n > 0 ? d.n : null },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = sameOrigin(data.url);
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        try {
          if (new URL(c.url).origin !== self.location.origin) continue;
          await c.focus();
          c.postMessage({ type: 'study-open', url, id: data.id ?? null });
          return;
        } catch {
          /* the next window, or a new one */
        }
      }
      await self.clients.openWindow(url); // the link carries ?nt=<id>, which the app marks seen
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (e) => {
  const opts = e.oldSubscription && e.oldSubscription.options;
  if (opts) e.waitUntil(self.registration.pushManager.subscribe(opts).catch(() => undefined));
});

/** A link on this site, or the home. */
function sameOrigin(u) {
  try {
    const x = new URL(typeof u === 'string' && u ? u : '/', self.location.origin);
    return x.origin === self.location.origin ? x.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

/** Text of at most 200 characters, or the fallback. */
function text(v, fallback) {
  return typeof v === 'string' && v.trim() ? v.slice(0, 200) : fallback;
}

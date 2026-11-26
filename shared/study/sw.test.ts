import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

/* public/sw.js (notifications, section R; OD1), run in node:vm with a fake
 * `self`: it only shows notifications and opens their links. No fetch
 * handler, no cache; a push always shows something (iOS revokes a
 * subscription whose pushes show nothing); a link from another site opens
 * the home; a click focuses an open window of the app and tells it which
 * notice, or opens a new one. */

const SRC = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://study.example";

/** Objects made inside the vm, as plain objects of this realm. */
const plain = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

type Listener = (e: Record<string, unknown>) => void;
type Win = { url: string; focus: () => Promise<void>; postMessage: (m: unknown) => void };

function load(o: { windows?: Win[] } = {}) {
  const on: Record<string, Listener[]> = {};
  const shown: Array<{ title: string; opts: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const subscribed: unknown[] = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: Listener) => (on[type] ??= []).push(fn),
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: async (title: string, opts: Record<string, unknown>) => void shown.push({ title, opts: plain(opts) }),
      pushManager: { subscribe: async (opts: unknown) => void subscribed.push(plain(opts)) },
      unregister: async () => true,
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => o.windows ?? [],
      openWindow: async (u: string) => void opened.push(u),
    },
  };
  runInNewContext(SRC, { self, URL, Number, console });
  /** Fires an event; resolves when everything given to waitUntil has. */
  const fire = async (type: string, e: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    for (const fn of on[type] ?? []) fn({ ...e, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return waits.length;
  };
  return { on, shown, opened, subscribed, fire };
}

const pushOf = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

test("notifications only: install, activate, push, notificationclick and pushsubscriptionchange; no fetch handler, no cache", () => {
  const w = load();
  assert.deepEqual(Object.keys(w.on).sort(), ["activate", "install", "notificationclick", "push", "pushsubscriptionchange"]);
  assert.ok(!/\bcaches\b|addEventListener\(\s*['"]fetch['"]|importScripts/.test(SRC), "no cache, no fetch handler, nothing imported");
});

test("a push shows its title and body right to left, in Hebrew, with its tag, inside waitUntil", async () => {
  const w = load();
  const n = await w.fire(
    "push",
    pushOf({
      web_push: 8030,
      notification: { title: "הסיכום מוכן", body: "קינטיקה מומצאת 2", navigate: `${ORIGIN}/?l=x&nt=7`, lang: "he", dir: "rtl", tag: "abc", silent: false },
      mutable: false,
      n: 7,
    }),
  );
  assert.equal(n, 1, "shown inside waitUntil");
  assert.equal(w.shown.length, 1);
  const { title, opts } = w.shown[0];
  assert.equal(title, "הסיכום מוכן");
  assert.deepEqual(opts, {
    body: "קינטיקה מומצאת 2",
    lang: "he",
    dir: "rtl",
    tag: "abc",
    renotify: false,
    silent: false,
    icon: "/icon-192.png",
    data: { url: `${ORIGIN}/?l=x&nt=7`, id: 7 },
  });
  assert.ok(!("badge" in opts), "no badge (a colour icon draws as a white square on Android)");
});

test("a malformed push still shows תמצית; a link to another site opens the home; silent is kept", async () => {
  for (const data of [{ json: () => JSON.parse("{not json") }, null, { json: () => null }, { json: () => "text" }]) {
    const w = load();
    await w.fire("push", { data });
    assert.equal(w.shown[0].title, "תמצית");
    assert.equal(w.shown[0].opts.body, "");
    assert.deepEqual(w.shown[0].opts.data, { url: `${ORIGIN}/`, id: null });
    assert.ok(!("tag" in w.shown[0].opts), "no tag");
  }
  const w = load();
  await w.fire("push", pushOf({ notification: { title: "x", navigate: "https://evil.example/?v=me", silent: true }, n: -3 }));
  assert.deepEqual(w.shown[0].opts.data, { url: `${ORIGIN}/`, id: null });
  assert.equal(w.shown[0].opts.silent, true);
  const r = load();
  await r.fire("push", pushOf({ notification: { title: "x", navigate: "/?v=quiz&q=1&nt=4" }, n: 4 }));
  assert.deepEqual(r.shown[0].opts.data, { url: `${ORIGIN}/?v=quiz&q=1&nt=4`, id: 4 }, "a relative link stays on the site");
});

test("a click focuses an open window of the app and posts study-open with the id; otherwise opens the link", async () => {
  const posted: unknown[] = [];
  let focused = 0;
  const other: Win = { url: "https://elsewhere.example/", focus: async () => void focused++, postMessage: () => assert.fail("never another site") };
  const app: Win = { url: `${ORIGIN}/?v=library`, focus: async () => void focused++, postMessage: (m) => void posted.push(plain(m)) };
  let closed = 0;
  const w = load({ windows: [other, app] });
  await w.fire("notificationclick", { notification: { close: () => void closed++, data: { url: `${ORIGIN}/?l=x&nt=7`, id: 7 } } });
  assert.equal(closed, 1);
  assert.equal(focused, 1);
  assert.deepEqual(posted, [{ type: "study-open", url: `${ORIGIN}/?l=x&nt=7`, id: 7 }]);
  assert.deepEqual(w.opened, []);

  const none = load({ windows: [] });
  await none.fire("notificationclick", { notification: { close: () => undefined, data: { url: "https://evil.example/", id: 3 } } });
  assert.deepEqual(none.opened, [`${ORIGIN}/`]);
  // A window that cannot be focused: a new one opens.
  const stuck = load({ windows: [{ url: `${ORIGIN}/`, focus: async () => Promise.reject(new Error("no")), postMessage: () => undefined }] });
  await stuck.fire("notificationclick", { notification: { close: () => undefined, data: { url: `${ORIGIN}/?nt=5`, id: 5 } } });
  assert.deepEqual(stuck.opened, [`${ORIGIN}/?nt=5`]);
});

test("a changed subscription subscribes again with the old options", async () => {
  const w = load();
  await w.fire("pushsubscriptionchange", { oldSubscription: { options: { userVisibleOnly: true, applicationServerKey: "k" } } });
  assert.deepEqual(w.subscribed, [{ userVisibleOnly: true, applicationServerKey: "k" }]);
  const n = load();
  assert.equal(await n.fire("pushsubscriptionchange", {}), 0);
});

test("the kill version in the header unregisters itself", async () => {
  const kill = /\*\s+(self\.addEventListener\('install'.*\n)\s+\*\s+(self\.addEventListener\('activate'.*)\n/.exec(SRC);
  assert.ok(kill, "the kill version is written in the file's header");
  let unregistered = 0;
  const on: Record<string, Listener[]> = {};
  const self = {
    addEventListener: (type: string, fn: Listener) => (on[type] ??= []).push(fn),
    skipWaiting: () => undefined,
    registration: { unregister: async () => void unregistered++ },
  };
  runInNewContext(kill[1] + kill[2], { self });
  const waits: Promise<unknown>[] = [];
  on.activate[0]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(unregistered, 1);
});

test("vercel.json serves /sw.js with no-cache and scope /", () => {
  const v = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const sw = v.headers.find((h) => h.source === "/sw.js");
  assert.ok(sw);
  assert.deepEqual(Object.fromEntries(sw.headers.map((h) => [h.key, h.value])), { "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
});

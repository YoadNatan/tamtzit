import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { Env } from "./install";
import type { PushState, StateInput } from "./notify";

// notify.ts imports api.ts, which reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta (no Supabase here).
(import.meta as unknown as { env: Record<string, string> }).env = {};
let N: typeof import("./notify");
before(async () => {
  N = await import("./notify");
});

/* lib/notify.ts (notifications, section R): where a device stands, the row's
 * word in "שלי", the device and browser section R stores, the 10-s limits
 * that turn a hung step into "broken", and the device's memory. */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const base: StateInput = { env: { kind: "android-chrome" }, available: true, hasPush: true, hasSw: true, perm: "default", subscribed: false, failed: false, online: true, ua: ANDROID };
const st = (o: Partial<StateInput>) => N.pushState({ ...base, ...o });

test("pushState: the matrix, in its order", () => {
  const cases: Array<[Partial<StateInput>, PushState]> = [
    [{}, "ask"],
    [{ available: false, perm: "granted", subscribed: true }, "off"],
    [{ env: { kind: "ios-safari", ipad: false, safari: 26 } as Env, ua: IPHONE }, "ios-install"],
    [{ env: { kind: "ios-browser", app: "chrome", ipad: false } as Env, ua: IPHONE }, "ios-install"],
    [{ env: { kind: "ios-inapp", app: "instagram" } as Env, ua: IPHONE }, "inapp"],
    [{ env: { kind: "android-inapp", app: "facebook" } as Env }, "inapp"],
    [{ env: { kind: "standalone" }, ua: IPHONE, hasPush: false }, "ios-old"],
    [{ env: { kind: "standalone" }, ua: IPHONE }, "ask"],
    [{ env: { kind: "standalone" }, ua: ANDROID, hasPush: false }, "unsupported"],
    [{ hasPush: false }, "unsupported"],
    [{ hasSw: false }, "unsupported"],
    [{ perm: "denied" }, "denied"],
    [{ perm: "denied", failed: true, online: false }, "denied"],
    [{ perm: "granted", subscribed: true }, "on"],
    [{ perm: "granted", subscribed: true, online: false }, "on"],
    [{ perm: "granted", subscribed: false }, "ask"],
    [{ failed: true }, "broken"],
    [{ failed: true, online: false }, "broken"],
    [{ online: false }, "offline"],
    [{ env: { kind: "desktop" }, ua: MAC_CHROME, perm: null }, "ask"],
  ];
  for (const [o, want] of cases) assert.equal(st(o), want, JSON.stringify(o));
});

test("the row in שלי: on, off, blocked, or not on this device", () => {
  const want: Record<PushState, string> = { on: "on", ask: "off", broken: "off", offline: "off", denied: "denied", "ios-install": "here", "ios-old": "here", inapp: "here", unsupported: "here", off: "here" };
  for (const [s, w] of Object.entries(want)) assert.equal(N.meState(s as PushState), w, s);
});

test("deviceOf: the device and the browser, no version", () => {
  assert.deepEqual(N.deviceOf(IPHONE), { device: "iphone", browser: "Safari" });
  assert.deepEqual(N.deviceOf(ANDROID), { device: "android", browser: "Chrome" });
  assert.deepEqual(N.deviceOf(MAC_CHROME), { device: "mac", browser: "Chrome" });
  assert.deepEqual(N.deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", 5), { device: "ipad", browser: "Safari" });
  assert.deepEqual(N.deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"), { device: "windows", browser: "Edge" });
  assert.deepEqual(N.deviceOf("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"), { device: "linux", browser: "Firefox" });
  assert.deepEqual(N.deviceOf("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36"), { device: "android", browser: "Samsung" });
  assert.deepEqual(N.deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1"), { device: "iphone", browser: "Chrome" });
  assert.deepEqual(N.deviceOf(""), { device: "other", browser: "" });
});

test("a step that hangs gives up after 10 s (enable() then says broken)", async () => {
  assert.equal(N.TIMEOUT_MS, 10_000);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const hung = N.withTimeout(new Promise(() => undefined));
    let said: unknown = null;
    hung.catch((e) => (said = e));
    mock.timers.tick(9_999);
    await Promise.resolve();
    assert.equal(said, null, "not yet");
    mock.timers.tick(1);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal((said as Error | null)?.message, "timeout");
    // A step that answers in time passes its answer through.
    const quick = N.withTimeout(Promise.resolve(7));
    assert.equal(await quick, 7);
  } finally {
    mock.timers.reset();
  }
});

/** Fake browser globals for enable(): a permission answer and a service worker whose ready never comes. */
function fakeBrowser(o: { answer: NotificationPermission; ready?: Promise<unknown> }) {
  const g = globalThis as Record<string, unknown>;
  const asked: number[] = [];
  const saved = { Notification: g.Notification, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"), window: g.window };
  g.Notification = { permission: "default", requestPermission: async () => (asked.push(1), o.answer) };
  const reg = { active: { scriptURL: "https://study.example/sw.js" }, pushManager: { getSubscription: async () => null, subscribe: async () => assert.fail("never reached") } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      onLine: true,
      userAgent: ANDROID,
      serviceWorker: {
        getRegistration: async () => reg,
        register: async () => reg,
        ready: o.ready ?? new Promise(() => undefined),
      },
    },
  });
  g.window = { PushManager: function PushManager() {} };
  return {
    asked,
    restore() {
      g.Notification = saved.Notification;
      if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
      g.window = saved.window;
    },
  };
}

test("enable(): the browser's question first, exactly once; denied and dismissed; a worker that never gets ready is broken after 10 s", async () => {
  let b = fakeBrowser({ answer: "denied" });
  try {
    assert.equal(await N.enable("BAAA", "kid"), "denied");
    assert.equal(b.asked.length, 1);
  } finally {
    b.restore();
  }
  b = fakeBrowser({ answer: "default" });
  try {
    assert.equal(await N.enable("BAAA", "kid"), "ask", "the question dismissed: asked again only from another tap");
  } finally {
    b.restore();
  }
  b = fakeBrowser({ answer: "granted" });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const p = N.enable("BAAA", "kid");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    mock.timers.tick(10_000);
    assert.equal(await p, "broken");
    assert.equal(b.asked.length, 1);
  } finally {
    mock.timers.reset();
    b.restore();
  }
});

test("the device's memory: read and written in one key, tolerant of anything stored", () => {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const saved = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    assert.deepEqual(N.readMemory(), { v: 1 });
    N.writeMemory({ key: "K", keyId: "abc", keyAt: 5, ok: true });
    assert.deepEqual(JSON.parse(store.get(N.NOTIFY_KEY)!), { v: 1, key: "K", keyId: "abc", keyAt: 5, ok: true });
    N.writeMemory({ key: undefined, keyId: undefined });
    assert.deepEqual(N.readMemory(), { v: 1, keyAt: 5, ok: true });
    store.set(N.NOTIFY_KEY, "not json");
    assert.deepEqual(N.readMemory(), { v: 1 });
    store.set(N.NOTIFY_KEY, '{"v":2,"key":"x"}');
    assert.deepEqual(N.readMemory(), { v: 1 });
    g.localStorage = { getItem: () => assert.fail("blocked") as never, setItem: () => assert.fail("blocked") as never };
    assert.deepEqual(N.readMemory(), { v: 1 });
    assert.deepEqual(N.writeMemory({ ok: false }), { v: 1, ok: false }, "a blocked storage keeps the page going");
  } finally {
    g.localStorage = saved;
  }
});

test("the key's id is the server's: sha256 of the raw key, base64url, 12 characters", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const key = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const want = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(key, "base64url"))).toString("base64url").slice(0, 12);
  assert.equal(await N.keyIdOf(key), want);
});

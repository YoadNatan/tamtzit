import { b64urlDecode, b64urlEncode } from "../../../shared/study/b64url";
import { health } from "./api";
import { detect, probe, type Env } from "./install";
import { keepOnlyDevice, notifyState, subscribeDevice, unsubscribeDevice } from "./notices";

/* ── Pushes on this device (notifications, section R; DECISIONS-2026-11-26.md) ──
 * Lazy: only the notifications' screens and the shell's core import it.
 *
 * Where this device stands (pushState, pure and tested), turning pushes on
 * from a tap (enable: the browser's question is the first thing the tap
 * does), keeping the subscription current on each open (resync), and the
 * kill path: when /api/study/health no longer gives a VAPID key, the
 * push-only service worker (public/sw.js) is removed. The worker is
 * registered only for a member who turns pushes on or opens their settings.
 *
 * The device's memory, localStorage "study-notify" (every access in
 * try/catch): {v:1, asked:{home?,upload?,bar?}, snooze?, key?, keyId?,
 * keyAt?, ok?}: the VAPID public key, its id and when health gave it (asked
 * again after a day), and whether health said pushes work. */

export type PushState = "off" | "ios-install" | "ios-old" | "inapp" | "unsupported" | "denied" | "ask" | "on" | "broken" | "offline";

export type StateInput = {
  env: Env;
  /** Health says pushes work, and this member may turn them on (the switch, or the pilot). */
  available: boolean;
  hasPush: boolean;
  hasSw: boolean;
  perm: NotificationPermission | null;
  subscribed: boolean;
  failed: boolean;
  online: boolean;
  ua: string;
};

const IOS_UA = /iPhone|iPad|iPod/;

/** Where this device stands. In order: not offered; an iPhone outside the
 *  home-screen app; another app's browser; the home-screen app on an iOS
 *  without pushes (before 16.4); a browser without pushes; blocked; on;
 *  the last try failed; offline; else it can be asked. */
export function pushState(o: StateInput): PushState {
  if (!o.available) return "off";
  if (o.env.kind === "ios-safari" || o.env.kind === "ios-browser") return "ios-install";
  if (o.env.kind === "ios-inapp" || o.env.kind === "android-inapp") return "inapp";
  if (o.env.kind === "standalone" && IOS_UA.test(o.ua) && !o.hasPush) return "ios-old";
  if (!o.hasPush || !o.hasSw) return "unsupported";
  if (o.perm === "denied") return "denied";
  if (o.perm === "granted" && o.subscribed) return "on";
  if (o.failed) return "broken";
  if (!o.online) return "offline";
  return "ask";
}

/** The row's word in "שלי": on, off, blocked, or not on this device. */
export function meState(s: PushState): "on" | "off" | "denied" | "here" {
  if (s === "on") return "on";
  if (s === "denied") return "denied";
  if (s === "ask" || s === "broken" || s === "offline") return "off";
  return "here";
}

/** The device and browser as section R stores them (no version, no model). */
export function deviceOf(ua: string, touch = 0): { device: string; browser: string } {
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)
    ? "ipad"
    : /iPhone|iPod/.test(ua)
      ? "iphone"
      : /Android/i.test(ua)
        ? "android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "mac"
          : /Windows/.test(ua)
            ? "windows"
            : /Linux|CrOS/.test(ua)
              ? "linux"
              : "other";
  const browser = /SamsungBrowser\//.test(ua)
    ? "Samsung"
    : /EdgA?\/|EdgiOS\//.test(ua)
      ? "Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  return { device, browser };
}

/* ── The device's memory ── */

export const NOTIFY_KEY = "study-notify";
export type NotifyMemory = {
  v: 1;
  asked?: { home?: number; upload?: number; bar?: number };
  snooze?: number;
  key?: string;
  keyId?: string;
  keyAt?: number;
  ok?: boolean;
};
const DAY = 86_400_000;

export function readMemory(): NotifyMemory {
  try {
    const x = JSON.parse(localStorage.getItem(NOTIFY_KEY) ?? "null") as NotifyMemory | null;
    return x && typeof x === "object" && x.v === 1 ? x : { v: 1 };
  } catch {
    return { v: 1 };
  }
}
export function writeMemory(patch: Partial<Omit<NotifyMemory, "v">>): NotifyMemory {
  const next: NotifyMemory = { ...readMemory(), ...patch, v: 1 };
  for (const k of Object.keys(next) as Array<keyof NotifyMemory>) if (next[k] === undefined) delete next[k];
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
  } catch {
    /* private mode: kept for this page only */
  }
  return next;
}

/* ── The asks (the design's §5.6): three places, never on load ──
 * The first launch from the icon (Today, once), after an upload (once), and
 * the inbox's line (once ever, state "ask" only). "לא עכשיו" hides every ask
 * for 14 days. The שלי row is always there while pushes are offered. */

export type Ask = "home" | "upload" | "bar";
export const SNOOZE_MS = 14 * DAY;

/** May this ask show now (not shown before, no "לא עכשיו" in the last 14 days)? */
export function askAllowed(which: Ask, m: NotifyMemory = readMemory(), now = Date.now()): boolean {
  if (m.snooze && now < m.snooze) return false;
  return !m.asked?.[which];
}

/** The ask was shown: it never shows again on this device. */
export function markAsked(which: Ask, now = Date.now()): NotifyMemory {
  const m = readMemory();
  return writeMemory({ asked: { ...m.asked, [which]: m.asked?.[which] ?? now } });
}

/** "לא עכשיו": no ask anywhere for 14 days. */
export function snoozeAsks(now = Date.now()): NotifyMemory {
  return writeMemory({ snooze: now + SNOOZE_MS });
}

/** The VAPID public key's short id, as the server's keyId(): sha256, base64url, 12 characters. */
export async function keyIdOf(key: string): Promise<string> {
  const raw = b64urlDecode(key);
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw)))).slice(0, 12);
}

/* ── The browser ── */

const sw = (): ServiceWorkerContainer | null => (typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null);
const hasPush = () => typeof window !== "undefined" && "PushManager" in window;
const perm = (): NotificationPermission | null => {
  try {
    return typeof Notification === "undefined" ? null : Notification.permission;
  } catch {
    return null;
  }
};
const SW_URL = "/sw.js";
export const TIMEOUT_MS = 10_000;

/** A promise that gives up after `ms` (the reason "timeout"). */
export function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((ok, no) => {
    const t = setTimeout(() => no(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e) => {
        clearTimeout(t);
        no(e);
      },
    );
  });
}

/** Ours: a registration whose worker is /sw.js. */
const ours = (r: ServiceWorkerRegistration | undefined | null) => {
  const w = r?.active ?? r?.waiting ?? r?.installing;
  return Boolean(w && new URL(w.scriptURL).pathname === SW_URL);
};

/** The push-only worker, registered now if it is not yet (never for a member who has not touched pushes). */
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  const c = sw();
  if (!c) return null;
  const have = await c.getRegistration("/").catch(() => undefined);
  if (have && ours(have)) return have;
  return c.register(SW_URL, { scope: "/", updateViaCache: "none" });
}

/** This device's subscription, without registering anything. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const c = sw();
  if (!c || !hasPush()) return null;
  const r = await c.getRegistration("/").catch(() => undefined);
  if (!r || !ours(r)) return null;
  return r.pushManager.getSubscription().catch(() => null);
}

/** The kill path: the keys were removed on the server, so the worker goes. */
export async function removeWorker(): Promise<number> {
  const c = sw();
  writeMemory({ key: undefined, keyId: undefined, keyAt: undefined, ok: false });
  if (!c) return 0;
  const regs = await c.getRegistrations().catch(() => [] as readonly ServiceWorkerRegistration[]);
  let n = 0;
  for (const r of regs) if (ours(r) && (await r.unregister().catch(() => false))) n++;
  return n;
}

/* ── Health: the key, and whether pushes work (asked at most daily) ── */

export type Wiring = { ok: boolean; key: string | null; keyId: string | null };

/** What health says about pushes. `fresh` asks now; otherwise the device's
 *  memory serves for a day. No answer keeps the memory (and never removes the
 *  worker); an answer without a key removes it. */
export async function wiring(fresh = false): Promise<Wiring> {
  const m = readMemory();
  if (!fresh && m.keyAt && Date.now() - m.keyAt < DAY && m.key) return { ok: m.ok === true, key: m.key, keyId: m.keyId ?? null };
  const h = await health();
  if (!h) return { ok: m.ok === true && Boolean(m.key), key: m.key ?? null, keyId: m.keyId ?? null };
  if (typeof h.vapid !== "string" || !h.vapid) {
    if (m.key || (await currentSubscription())) await removeWorker();
    else writeMemory({ ok: false, keyAt: Date.now() });
    return { ok: false, key: null, keyId: null };
  }
  const keyId = m.key === h.vapid && m.keyId ? m.keyId : await keyIdOf(h.vapid);
  writeMemory({ key: h.vapid, keyId, keyAt: Date.now(), ok: h.notify === true });
  return { ok: h.notify === true, key: h.vapid, keyId };
}

/** Pushes are offered to this member: health says they work, and the switch (or the pilot) lets this member. */
export async function available(fresh = false): Promise<{ ok: boolean; key: string | null; keyId: string | null }> {
  const w = await wiring(fresh);
  if (!w.ok || !w.key) return { ...w, ok: false };
  const s = await notifyState().catch(() => ({ send: false }));
  return { ...w, ok: s.send === true };
}

/** Where this device stands now. */
export async function readState(isAvailable: boolean, failed = false): Promise<PushState> {
  const p = probe();
  return pushState({
    env: detect(p),
    available: isAvailable,
    hasPush: hasPush(),
    hasSw: Boolean(sw()),
    perm: perm(),
    subscribed: Boolean(await currentSubscription()),
    failed,
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    ua: p.ua,
  });
}

/** The subscription's keys as section R stores them. */
function keysOf(s: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const j = s.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = j.endpoint ?? s.endpoint;
  if (!endpoint || !j.keys?.p256dh || !j.keys.auth) return null;
  return { endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
}

async function save(s: PushSubscription, keyId: string): Promise<void> {
  const k = keysOf(s);
  if (!k) throw new Error("keys");
  const d = deviceOf(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  await subscribeDevice({ ...k, keyId, device: d.device, browser: d.browser });
}

/** "להפעיל התראות": straight from a click. The browser's question is the
 *  first thing it does (Safari asks only from the tap itself); then the
 *  worker, the subscription and section R, each step given 10 s. */
export async function enable(key: string, keyId: string): Promise<PushState> {
  let answer: NotificationPermission;
  try {
    answer = await Notification.requestPermission();
  } catch {
    return "broken";
  }
  if (answer === "denied") return "denied";
  if (answer !== "granted") return "ask";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  try {
    const c = sw();
    if (!c) return "unsupported";
    await withTimeout(registerWorker().then((r) => r ?? Promise.reject(new Error("no worker"))));
    const reg = await withTimeout(c.ready);
    let sub = await reg.pushManager.getSubscription();
    if (sub && readMemory().keyId !== keyId) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(b64urlDecode(key)) }));
    await withTimeout(save(sub, keyId));
    writeMemory({ key, keyId });
    return "on";
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "broken";
  }
}

let syncing: Promise<void> | null = null;
/** On each open, once the page is idle: with the permission given, the
 *  subscription is made again when it is missing or was made with an older
 *  key, and section R hears of it (which also moves a device to the member
 *  now signed in on it). Health is asked at most daily; a health without a
 *  key removes the worker. */
export function resync(): Promise<void> {
  syncing ??= (async () => {
    try {
      const has = Boolean(await currentSubscription());
      if (perm() !== "granted" && !has) return;
      const w = await wiring(false);
      if (!w.key || !w.keyId) return; // no key: removed above when health said so
      if (perm() !== "granted") return;
      const c = sw();
      if (!c || !hasPush()) return;
      const reg = await withTimeout(registerWorker().then((r) => r ?? Promise.reject(new Error("no worker"))));
      let sub = await reg.pushManager.getSubscription();
      const old = readMemory();
      if (sub && old.keyId && old.keyId !== w.keyId) {
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
      if (!sub) {
        const ready = await withTimeout(c.ready);
        sub = await withTimeout(ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(b64urlDecode(w.key)) }));
      }
      await save(sub, w.keyId);
      writeMemory({ keyId: w.keyId });
    } catch {
      /* the next open tries again; the inbox has everything meanwhile */
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Signing out of this device: section R forgets it and the browser drops the
 *  subscription (at most 3 s, best effort). */
export async function dropThisDevice(): Promise<void> {
  await withTimeout(
    (async () => {
      const s = await currentSubscription();
      if (!s) return;
      await unsubscribeDevice(s.endpoint).catch(() => 0);
      await s.unsubscribe().catch(() => false);
    })(),
    3_000,
  ).catch(() => undefined);
}

/** "ניתוק המכשירים האחרים": only this device keeps getting pushes. */
export async function keepOnlyThis(): Promise<void> {
  const s = await currentSubscription().catch(() => null);
  await keepOnlyDevice(s?.endpoint ?? null);
}

/** "להסיר" on this device: section R forgets it, and the browser too. */
export async function removeThisDevice(): Promise<void> {
  const s = await currentSubscription();
  if (s) {
    await unsubscribeDevice(s.endpoint);
    await s.unsubscribe().catch(() => false);
  }
}

/** This device's endpoint (to mark "המכשיר הזה" in the list), or null. */
export async function thisEndpoint(): Promise<string | null> {
  return (await currentSubscription().catch(() => null))?.endpoint ?? null;
}

/** A computer (the test toast adds where its notifications are allowed). */
export const isComputer = (env: Env, ua: string) => env.kind === "desktop" || (env.kind === "standalone" && !/Mobile|Android|iPhone|iPad/.test(ua));

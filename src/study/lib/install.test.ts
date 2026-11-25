import assert from "node:assert/strict";
import { test } from "node:test";
import { flagsFrom, requiredSchema } from "./flags";
import { cardWanted, detect, guideBusy, installWanted, parseInstall, type Env, type Probe } from "./install";
import { escapeUrl, installFact } from "./installLazy";
import { CODE_ENTRY, INSTALL, installHelp, installHowTo, OS } from "./installCopy";

/* Adding תמצית to the home screen (docs/study/install.md): where a page
 * runs, the way out of another app's browser, when the home's card shows,
 * and the words. */

const P = (ua: string, o: Partial<Probe> = {}): Probe => ({ ua, platform: "", touch: 0, standalone: false, ...o });

const UA = {
  ios26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  ios18: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  crios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  edgios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15",
  fxios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
  wkwebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  fbios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/he_IL;FBOP/5]",
  igios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.30.109 (iPhone15,2; iOS 18_6; he_IL; he; scale=3.00; 1179x2556; 664380519)",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  webview: "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36",
  fbandroid: "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]",
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
};

test("detect: where the page runs", () => {
  const rows: Array<[string, Probe, Env]> = [
    ["iOS 26 Safari (the OS token frozen at 18_6; Version/26)", P(UA.ios26), { kind: "ios-safari", ipad: false, safari: 26 }],
    ["iOS 18 Safari", P(UA.ios18), { kind: "ios-safari", ipad: false, safari: 18 }],
    ["iPadOS says it is a Mac, with touch", P(UA.ipadOs, { platform: "MacIntel", touch: 5 }), { kind: "ios-safari", ipad: true, safari: 26 }],
    ["a Mac's Safari (no touch)", P(UA.macSafari, { platform: "MacIntel", touch: 0 }), { kind: "desktop" }],
    ["Chrome on iOS", P(UA.crios), { kind: "ios-browser", app: "chrome", ipad: false }],
    ["Edge on iOS", P(UA.edgios), { kind: "ios-browser", app: "edge", ipad: false }],
    ["Firefox on iOS", P(UA.fxios), { kind: "ios-browser", app: "firefox", ipad: false }],
    ["an iOS WKWebView (no Safari/ token)", P(UA.wkwebview), { kind: "ios-inapp", app: "other" }],
    ["Facebook on iOS", P(UA.fbios), { kind: "ios-inapp", app: "facebook" }],
    ["Instagram on iOS", P(UA.igios), { kind: "ios-inapp", app: "instagram" }],
    ["Android Chrome", P(UA.android), { kind: "android-chrome" }],
    ["an Android WebView (; wv)", P(UA.webview), { kind: "android-inapp", app: "other" }],
    ["Facebook on Android", P(UA.fbandroid), { kind: "android-inapp", app: "facebook" }],
    ["Samsung Internet", P(UA.samsung), { kind: "android-samsung" }],
    ["Firefox on Android", P(UA.firefoxAndroid), { kind: "android-other" }],
    ["Windows Chrome", P(UA.windows, { platform: "Win32" }), { kind: "desktop" }],
    ["nothing known", P(""), { kind: "desktop" }],
  ];
  for (const [name, p, env] of rows) assert.deepEqual(detect(p), env, name);
  for (const ua of Object.values(UA)) assert.deepEqual(detect(P(ua, { standalone: true })), { kind: "standalone" }, `standalone wins: ${ua.slice(0, 40)}`);
});

test("escapeUrl: Safari's scheme keeps the whole address; Chrome's intent keeps path and query, with the address as fallback", () => {
  const href = "https://tamtzit-app.vercel.app/?join=ABC123#x";
  assert.equal(escapeUrl({ kind: "ios-inapp", app: "instagram" }, href), `x-safari-${href}`);
  const intent = escapeUrl({ kind: "android-inapp", app: "other" }, href)!;
  assert.ok(intent.startsWith("intent://tamtzit-app.vercel.app/?join=ABC123#Intent;"), intent);
  assert.ok(intent.includes(";scheme=https;"), intent);
  assert.ok(intent.includes(";package=com.android.chrome;"), intent);
  assert.ok(intent.includes(`;S.browser_fallback_url=${encodeURIComponent(href)};`), intent);
  assert.ok(intent.endsWith(";end"), intent);
  assert.equal(escapeUrl({ kind: "android-inapp", app: "other" }, "http://localhost:4173/?v=install").split("#Intent")[0], "intent://localhost:4173/?v=install");
  for (const env of [{ kind: "ios-safari", ipad: false, safari: 26 }, { kind: "android-chrome" }, { kind: "desktop" }, { kind: "standalone" }] as Env[]) assert.equal(escapeUrl(env, href), null, env.kind);
});

test("installWanted and the guide's fact: never in the app; a computer only with a prompt; a phone always", () => {
  const ios: Env = { kind: "ios-safari", ipad: false, safari: 26 };
  assert.equal(installWanted({ kind: "standalone" }, true), false);
  assert.equal(installWanted({ kind: "desktop" }, false), false);
  assert.equal(installWanted({ kind: "desktop" }, true), true);
  assert.equal(installWanted(ios, false), true);
  assert.equal(installWanted({ kind: "android-chrome" }, false), true);
  assert.equal(installWanted({ kind: "ios-inapp", app: "other" }, false), true);
  assert.equal(installFact(ios, false), "ios");
  assert.equal(installFact({ kind: "ios-inapp", app: "facebook" }, false), "ios");
  assert.equal(installFact({ kind: "android-chrome" }, false), "android");
  assert.equal(installFact({ kind: "android-chrome" }, true), "prompt");
  assert.equal(installFact({ kind: "desktop" }, false), "none");
  assert.equal(installFact({ kind: "desktop" }, true), "prompt");
  assert.equal(installFact({ kind: "standalone" }, true), "none");
});

test("the device's memory: only its own shape is kept", () => {
  assert.deepEqual(parseInstall(null), { v: 1 });
  assert.deepEqual(parseInstall("not json"), { v: 1 });
  assert.deepEqual(parseInstall("[1]"), { v: 1 });
  assert.deepEqual(parseInstall(JSON.stringify({ v: 1, dismissed: 5, done: 7, via: "said", extra: 1 })), { v: 1, dismissed: 5, done: 7, via: "said" });
  assert.deepEqual(parseInstall(JSON.stringify({ dismissed: "yes", done: -1, via: "magic" })), { v: 1 });
});

test("the home's card: one thing at a time, never twice", () => {
  const ios: Env = { kind: "ios-safari", ipad: false, safari: 26 };
  const base = { env: ios, canPrompt: false, memory: { v: 1 as const }, guideBusy: false };
  assert.equal(cardWanted(base), true);
  assert.equal(cardWanted({ ...base, env: { kind: "standalone" } }), false, "in the app");
  assert.equal(cardWanted({ ...base, env: { kind: "desktop" } }), false, "a computer with no prompt");
  assert.equal(cardWanted({ ...base, env: { kind: "desktop" }, canPrompt: true }), true, "a computer with the prompt");
  assert.equal(cardWanted({ ...base, memory: { v: 1, dismissed: 1 } }), false, "״לא עכשיו״ is for good");
  assert.equal(cardWanted({ ...base, memory: { v: 1, done: 1 } }), false, "added");
  assert.equal(cardWanted({ ...base, guideBusy: true }), false, "the guide's card is on the home");
  const now = Date.UTC(2026, 10, 25);
  const day = 86_400_000;
  assert.equal(guideBusy(false, true, null, now), false, "no guide in the build");
  assert.equal(guideBusy(true, true, null, now), true, "just joined");
  assert.equal(guideBusy(true, false, null, now), true, "never started: the tour's offer");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, offer: "dismissed" }), now), false, "the offer answered");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, known: [] }), now), true, "the offer not answered yet");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, born: now - day }), now), true, "the first steps' card is live");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, born: now - 15 * day }), now), false, "past 14 days");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, born: now - day, hidden: true }), now), false, "hidden");
  assert.equal(guideBusy(true, false, JSON.stringify({ v: 1, born: now - day, closed: true }), now), false, "closed");
});

test("VITE_STUDY_INSTALL: its own flag, and no SQL section", () => {
  const off = flagsFrom({ VITE_STUDY_GUIDE: "1" });
  const on = flagsFrom({ VITE_STUDY_GUIDE: "1", VITE_STUDY_INSTALL: "1" });
  assert.equal(off.install, false);
  assert.equal(on.install, true);
  assert.deepEqual({ ...on, install: false }, off);
  assert.deepEqual(requiredSchema(on), requiredSchema(off));
});

test("the words: gender-neutral, short, and the app's own entry named as Join names it", () => {
  const lines = [
    ...Object.values(INSTALL).flatMap((v) => (typeof v === "function" ? [v(OS.safari), v(OS.chrome)] : [v])),
    installHelp(true),
    installHelp(false),
    installHowTo(),
  ].map(String);
  for (const line of lines) {
    for (const bad of ["מישהו", "מישהי", "לחץ ", "לחצי", "בחר ", "בחרי", "תוכל", "תוכלי", "את/ה", "/ת "]) assert.ok(!line.includes(bad), `${bad} in ${line}`);
    // A singular command ("פתח", "הוסף", "הורד", "העתק", "גלול"): the app says "פותחים", "מוסיפים".
    assert.ok(!/(^|[\s(])(פתח|הוסף|הורד|העתק|גלול|גע|הדבק)[\s.,:]/.test(line), `a singular command in ${line}`);
    assert.ok(line.length <= (line.startsWith("שלי ←") ? 400 : 160), `short: ${line}`);
  }
  assert.ok(INSTALL.addLine.includes(`״${CODE_ENTRY}״`));
  assert.equal(CODE_ENTRY, "כניסה עם הקוד האישי");
  assert.ok(installHelp(true).includes("הקוד האישי") && !installHelp(false).includes("הקוד האישי"));
});

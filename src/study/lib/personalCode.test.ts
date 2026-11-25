import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cacheCode,
  cachedCode,
  cacheFresh,
  CODE_ALPHABET,
  codeLink,
  formatCode,
  issuedMessage,
  laterActive,
  laterNow,
  takeWelcome,
  welcomeNext,
  looksLikeGroupCode,
  maskCode,
  parseCode,
  selfMessage,
  takeLinkCode,
  waLink,
} from "./personalCode";

/* The personal code's pure helpers (docs/study/personal-code.md): what the
 * join screen's field, the #k= link and the WhatsApp message carry, and the
 * device's copy of the code. */

const CODE = "K7QM3XRPW9TDH4NA";

test("the alphabet: 32 symbols, no 0, O, 1 or I", () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  for (const c of "0O1I") assert.ok(!CODE_ALPHABET.includes(c), c);
});

test("parseCode: plain, lower case, spaces or dashes, a link, the WhatsApp message", () => {
  for (const raw of [
    CODE,
    "K7QM-3XRP-W9TD-H4NA",
    "k7qm-3xrp-w9td-h4na",
    "k7qm 3xrp w9td h4na",
    "  K7QM 3XRP-W9TD H4NA  ",
    "K7QM–3XRP–W9TD–H4NA", // dashes a keyboard swapped
    "https://tamtzit.vercel.app/#k=K7QM3XRPW9TDH4NA",
    "https://tamtzit.vercel.app/#k=k7qm3xrpw9tdh4na",
    "tamtzit.vercel.app/?join=ABC123#k=K7QM3XRPW9TDH4NA",
    selfMessage("https://tamtzit.vercel.app", CODE),
    issuedMessage("https://tamtzit.vercel.app", CODE, "דנה"),
    "הקוד: K7QM-3XRP-W9TD-H4NA.",
  ])
    assert.equal(parseCode(raw), CODE, raw);
});

test("parseCode: the wrong length or characters is null", () => {
  for (const raw of ["", "   ", null, undefined, "ABC123", "K7QM-3XRP-W9TD-H4N", "K7QM-3XRP-W9TD-H4NAA", "K7QM-3XRP-W9TD-H4N0", "K7QM-3XRP-W9TD-H4NO", "K7QM-3XRP-W9TD-H41A", "I7QM-3XRP-W9TD-H4NA", "https://x/#k=K7QM3XRP", "שלום"])
    assert.equal(parseCode(raw), null, String(raw));
});

test("the group's 6-character code is told apart", () => {
  for (const raw of ["ABC123", "abc123", " ABC 123 ", "https://tamtzit.vercel.app/?join=ABC123"]) assert.ok(looksLikeGroupCode(raw), raw);
  for (const raw of ["", "K7QM-3XRP-W9TD-H4NA", "ABC12", "ABC1234"]) assert.ok(!looksLikeGroupCode(raw), raw);
});

test("shown as XXXX-XXXX-XXXX-XXXX; hidden but its last four", () => {
  assert.equal(formatCode(CODE), "K7QM-3XRP-W9TD-H4NA");
  assert.equal(formatCode("k7qm 3xrp w9td h4na"), "K7QM-3XRP-W9TD-H4NA");
  assert.equal(maskCode(CODE), "••••-••••-••••-H4NA");
});

test("the link and WhatsApp: #k= with the 16 characters, the text encoded once", () => {
  assert.equal(codeLink("https://tamtzit.vercel.app", "K7QM-3XRP-W9TD-H4NA"), "https://tamtzit.vercel.app/#k=K7QM3XRPW9TDH4NA");
  assert.equal(codeLink("https://tamtzit.vercel.app/", CODE), "https://tamtzit.vercel.app/#k=K7QM3XRPW9TDH4NA");
  assert.ok(!codeLink("https://x", CODE).includes("code="), "never #code=: Auth's client would read it as a sign-in");
  const msg = selfMessage("https://tamtzit.vercel.app", CODE);
  assert.equal(msg, "הקוד האישי שלי בתמצית: K7QM-3XRP-W9TD-H4NA\nכניסה בנגיעה: https://tamtzit.vercel.app/#k=K7QM3XRPW9TDH4NA\nלא להעביר לאף אחד.");
  const wa = waLink(msg);
  assert.ok(wa.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(wa.slice("https://wa.me/?text=".length)), msg);
  assert.ok(wa.includes("%23k%3DK7QM3XRPW9TDH4NA"), "the # and = are encoded, so WhatsApp keeps the whole link");
  assert.equal(issuedMessage("https://x", CODE, "דנה"), "דנה, זה הקוד האישי החדש שלך בתמצית: K7QM-3XRP-W9TD-H4NA\nכניסה בנגיעה: https://x/#k=K7QM3XRPW9TDH4NA\nכדאי לשמור את ההודעה. לא להעביר לאף אחד.");
});

function withLocation(href: string, run: (replaced: string[]) => void) {
  const g = globalThis as unknown as { location?: unknown; history?: unknown };
  const before = { location: g.location, history: g.history };
  const u = new URL(href);
  const replaced: string[] = [];
  g.location = { hash: u.hash, pathname: u.pathname, search: u.search };
  g.history = { state: { study: true }, replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) };
  try {
    run(replaced);
  } finally {
    g.location = before.location;
    g.history = before.history;
  }
}

test("takeLinkCode reads #k= and strips the fragment at once, keeping the path and query", () => {
  withLocation("https://x/?join=ABC123#k=k7qm3xrpw9tdh4na", (replaced) => {
    assert.deepEqual(takeLinkCode(), { code: CODE });
    assert.deepEqual(replaced, ["/?join=ABC123"]);
  });
  withLocation("https://x/#k=K7QM-3XRP-W9TD-H4NA", (replaced) => {
    assert.deepEqual(takeLinkCode(), { code: CODE });
    assert.deepEqual(replaced, ["/"]);
  });
  withLocation("https://x/#k=NOPE", (replaced) => {
    assert.deepEqual(takeLinkCode(), { code: null }, "a malformed link: said so, and still stripped");
    assert.deepEqual(replaced, ["/"]);
  });
  withLocation("https://x/?v=me#top", (replaced) => {
    assert.equal(takeLinkCode(), null);
    assert.deepEqual(replaced, [], "another fragment stays");
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

test("the device's copy: per member, fresh only when made no earlier than the server's code; later hides for 3 days", () => {
  const g = globalThis as unknown as { localStorage?: Storage };
  const before = g.localStorage;
  g.localStorage = memoryStorage();
  try {
    assert.equal(cachedCode("u1"), null);
    cacheCode("u1", "k7qm-3xrp-w9td-h4na", "2026-11-25T10:00:00.000Z");
    assert.deepEqual(cachedCode("u1"), { code: CODE, at: "2026-11-25T10:00:00.000Z" });
    assert.equal(cachedCode("u2"), null, "another member's");
    assert.ok(g.localStorage.getItem("study-code:u1"), "a personal entry: study-code:<uid>");
    assert.ok(cacheFresh(cachedCode("u1"), "2026-11-25T10:00:00.400Z"), "the same code, the server's clock a moment later");
    assert.ok(!cacheFresh(cachedCode("u1"), "2026-11-26T08:00:00.000Z"), "replaced since (the opener, or another device)");
    assert.ok(!cacheFresh(null, "2026-11-25T10:00:00.000Z"));
    g.localStorage.setItem("study-code:u3", "not json");
    assert.equal(cachedCode("u3"), null);
    const now = Date.parse("2026-11-25T10:00:00Z");
    assert.ok(!laterActive("u1", now));
    laterNow("u1", now);
    assert.ok(laterActive("u1", now + 2 * 86_400_000));
    assert.ok(!laterActive("u1", now + 3 * 86_400_000 + 1));
    assert.ok(g.localStorage.getItem("study-code-later:u1"));
  } finally {
    g.localStorage = before;
  }
});

test("the welcome toast waits across the reload once, in this tab only", () => {
  const g = globalThis as unknown as { sessionStorage?: Storage };
  const before = g.sessionStorage;
  g.sessionStorage = memoryStorage();
  try {
    assert.equal(takeWelcome(), false);
    welcomeNext();
    assert.equal(takeWelcome(), true);
    assert.equal(takeWelcome(), false, "read once");
  } finally {
    g.sessionStorage = before;
  }
  assert.equal(takeWelcome(), false, "no storage: no toast, no throw");
});

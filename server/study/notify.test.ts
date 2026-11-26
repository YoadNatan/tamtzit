import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { beforeEach, test } from "node:test";
import { b64urlEncode } from "../../shared/study/b64url.js";
import { HttpError } from "./study.js";
import { _resetVapidMemo, batches, dwp, notifyStep, PAYLOAD_MAX, readClaim, topicOf, ttlOf, withMarker, type Claim, type Claimed, type NotifyDeps } from "./notify.js";

/* server/study/notify.ts: one kick of POST /api/study/work {notify:true},
 * with the RPCs, the push services, the clock and waitUntil replaced. The
 * claim's rows are what section R's study_notify_claim answers. Invented
 * titles and names only. No network. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const ORIGIN = "https://study.example";
const LEC = "11111111-0000-4000-8000-000000000001";
const QUIZ = "33333333-0000-4000-8000-000000000003";

/** One device: a real P-256 key pair, so the payload can be decrypted. */
const ua = createECDH("prime256v1");
ua.generateKeys();
const AUTH = Buffer.alloc(16, 9);
let subSeq = 0;
const dev = (status: number) => ({
  id: ++subSeq,
  endpoint: `https://fcm.googleapis.com/fcm/send/s${status}-${subSeq}-abcdefgh`,
  p256dh: ua.getPublicKey().toString("base64url"),
  auth: AUTH.toString("base64url"),
});
let noticeSeq = 100;
const row = (o: Partial<Claimed["notice"]> = {}, subs = [dev(201)]): Claimed => ({
  notice: {
    id: ++noticeSeq,
    kind: "summary_ready",
    cat: "mine",
    args: { lecture: "קינטיקה מומצאת 2" },
    route: { v: "lecture", l: LEC },
    count: 1,
    dedupe: `lec:${LEC}:ready`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    silent: false,
    ...o,
  },
  subs,
});

function decrypt(body: Uint8Array): string {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const asPub = buf.subarray(21, 86);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(ua.getPrivateKey());
  const secret = ecdh.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync("sha256", secret, AUTH, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const rec = buf.subarray(86);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(rec.subarray(rec.length - 16));
  return Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]).subarray(0, -1).toString("utf8");
}

/* ── The fakes ── */
let vapidEnv: Record<string, string | undefined> = {};
let claims: Claim[] = [];
let rpcLog: Array<{ fn: string; args: Record<string, unknown> }> = [];
let sent: Array<{ endpoint: string; headers: Record<string, string>; payload: string }> = [];
let pending: Promise<unknown>[] = [];
let clock = 0;
let slept: number[] = [];
let errors: string[] = [];
let rpcFails: Record<string, boolean> = {};

const fetchImpl = (async (url: string, init: RequestInit) => {
  sent.push({ endpoint: url, headers: init.headers as Record<string, string>, payload: decrypt(new Uint8Array(init.body as ArrayBuffer)) });
  clock += 50; // each push takes a moment
  const status = Number(/\/s(\d+)-/.exec(url)?.[1] ?? 201);
  if (status === 0) throw new TypeError("fetch failed");
  const headers: Record<string, string> = status === 429 ? { "retry-after": "30" } : status === 301 ? { location: "https://elsewhere.example/" } : {};
  return new Response(null, { status, headers });
}) as unknown as typeof fetch;

const deps = (o: Partial<NotifyDeps> = {}): NotifyDeps => ({
  env: vapidEnv,
  checkSchema: async () => undefined,
  rpc: async (fn, args) => {
    rpcLog.push({ fn, args });
    if (rpcFails[fn]) throw new HttpError(500, "boom");
    if (fn === "study_notify_claim") return claims.shift() ?? { rows: [], more: false, wait_ms: null };
    if (fn === "study_notify_done") return 1;
    throw new Error(`unexpected ${fn}`);
  },
  fetchImpl,
  deadline: 300_000,
  now: () => clock,
  sleep: async (ms) => {
    slept.push(ms);
    clock += ms;
  },
  waitUntil: (p) => pending.push(p),
  ...o,
});
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};
const done = () => rpcLog.filter((c) => c.fn === "study_notify_done").map((c) => c.args.p_results as Array<Record<string, unknown>>);

beforeEach(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  vapidEnv = { STUDY_VAPID_PUBLIC: pub, STUDY_VAPID_PRIVATE: d, STUDY_VAPID_SUBJECT: ORIGIN };
  process.env.STUDY_WORKER_KEY = KEY;
  claims = [];
  rpcLog = [];
  sent = [];
  pending = [];
  clock = 0;
  slept = [];
  errors = [];
  rpcFails = {};
  _resetVapidMemo();
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(" "));
});

test("nothing due: 200 {claimed:false}, one claim with the key and the limit, no push", async () => {
  const res = await notifyStep(ORIGIN, deps());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: false });
  assert.deepEqual(rpcLog, [{ fn: "study_notify_claim", args: { p_limit: 20, p_key: KEY } }]);
  assert.equal(pending.length, 0);
});

test("no VAPID keys, or keys that are not a pair: reason vapid, and nothing is claimed", async () => {
  for (const env of [{}, { ...vapidEnv, STUDY_VAPID_PRIVATE: undefined }, { ...vapidEnv, STUDY_VAPID_PRIVATE: "A".repeat(43) }]) {
    _resetVapidMemo();
    rpcLog = [];
    const res = await notifyStep(ORIGIN, deps({ env }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { claimed: false, reason: "vapid" });
    assert.equal(rpcLog.length, 0, "no claim: the breaker counts the kicks");
  }
});

test("an older database: 503 schema; a failed claim: 500", async () => {
  let res = await notifyStep(ORIGIN, deps({ checkSchema: async () => Promise.reject(new HttpError(503, "schema")) }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "schema" });
  assert.equal(rpcLog.length, 0);
  rpcFails.study_notify_claim = true;
  res = await notifyStep(ORIGIN, deps());
  assert.equal(res.status, 500);
});

test("each push service's answer goes into p_results as section R reads it", async () => {
  const statuses = [201, 301, 404, 410, 413, 429, 500, 0];
  const r = row({}, statuses.map(dev));
  claims = [{ rows: [r], more: false, wait_ms: null }];
  const res = await notifyStep(ORIGIN, deps());
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { claimed: true, n: 1 });
  await settle();
  const results = done();
  assert.equal(results.length, 1);
  assert.deepEqual(
    results[0],
    statuses.map((s, i) => ({ notice: r.notice.id, sub: r.subs[i].id, status: s, ...(s === 429 ? { retry_after: 30 } : {}) })),
  );
  assert.equal(rpcLog.filter((c) => c.fn === "study_notify_done")[0].args.p_key, KEY);
  assert.equal(sent.length, 8, "a redirect is not followed: one request each");
  // Logs: ids and statuses only, never an endpoint, a key or the words.
  assert.ok(errors.length >= 7);
  for (const e of errors) {
    assert.match(e, /^study notify \d+ \d+ -?\d+$/, e);
    assert.ok(!e.includes("googleapis") && !e.includes("קינטיקה"));
  }
});

test("batches of about 8 devices, study_notify_done after each; a notice's devices stay in one batch", async () => {
  const rows = [row({}, [dev(201), dev(201), dev(201)]), row({}, [dev(201), dev(201), dev(201)]), row({}, [dev(201), dev(201), dev(201)]), row({}, Array.from({ length: 10 }, () => dev(201))), row()];
  assert.deepEqual(
    batches(rows).map((b) => b.map((r) => r.subs.length)),
    [[3, 3], [3], [10], [1]],
  );
  claims = [{ rows, more: false, wait_ms: null }];
  await notifyStep(ORIGIN, deps());
  await settle();
  const d = done();
  assert.deepEqual(d.map((x) => x.length), [6, 3, 10, 1]);
  // Each done() came before the next batch's first push.
  const order = rpcLog.map((c) => c.fn);
  assert.deepEqual(order, ["study_notify_claim", "study_notify_done", "study_notify_done", "study_notify_done", "study_notify_done"]);
  assert.equal(sent.length, 20);
});

test("no batch starts in the last 30 s before the deadline", async () => {
  const rows = Array.from({ length: 4 }, () => row({}, Array.from({ length: 8 }, () => dev(201))));
  claims = [{ rows, more: true, wait_ms: 0 }];
  // 8 pushes × 50 ms = 400 ms a batch; the deadline leaves room for two.
  await notifyStep(ORIGIN, deps({ deadline: 30_000 + 700 }));
  await settle();
  assert.equal(done().length, 2);
  assert.equal(sent.length, 16);
  assert.equal(rpcLog.filter((c) => c.fn === "study_notify_claim").length, 1, "no claim after stopping");
});

test("more due soon: waits what the claim says (at most 20 s), claims again, at most 3 more times", async () => {
  claims = [
    { rows: [], more: true, wait_ms: 14_200 }, // a quiz held 15 s: nothing yet
    { rows: [row({ kind: "quiz_open", cat: "live", args: { mode: "coop", lecture: "קינטיקה מומצאת 2", title: "עצירה: סוד", name: "דנה", in: 2 }, route: { v: "quiz", q: QUIZ }, dedupe: `quiz:${QUIZ}` })], more: true, wait_ms: 60_000 },
    { rows: [row()], more: true, wait_ms: 1_000 },
    { rows: [row()], more: true, wait_ms: 1_000 },
    { rows: [row()], more: true, wait_ms: 1_000 },
  ];
  const res = await notifyStep(ORIGIN, deps());
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { claimed: true, n: 0 });
  await settle();
  assert.deepEqual(slept, [14_450, 20_250, 1_250]);
  assert.equal(rpcLog.filter((c) => c.fn === "study_notify_claim").length, 4, "the first and 3 more");
  assert.equal(sent.length, 3);
  assert.equal(claims.length, 1, "the fifth answer is never asked for");
  // The quiz's lock screen: the lecture, never the quiz's title or a name.
  const quiz = JSON.parse(sent[0].payload);
  assert.equal(quiz.notification.title, "מבחן קבוצתי נפתח עכשיו");
  assert.ok(quiz.notification.body.includes("קינטיקה מומצאת 2"));
  assert.ok(!sent[0].payload.includes("סוד") && !sent[0].payload.includes("דנה"));
  assert.equal(sent[0].headers.Urgency, "high");
});

test("the payload: Declarative Web Push exactly, the link with nt, he/rtl, the tag; at most 3 KB", async () => {
  const r = row({ id: 7, count: 2, kind: "reply", args: { lecture: "קינטיקה מומצאת 2", part: 3 }, route: { v: "lecture", l: LEC, at: { part: 3, anchor: 2 } }, dedupe: "reply:55" });
  claims = [{ rows: [r], more: false, wait_ms: null }];
  await notifyStep(ORIGIN, deps());
  await settle();
  const tag = await topicOf("reply:55");
  assert.match(tag, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(JSON.parse(sent[0].payload), {
    web_push: 8030,
    notification: {
      title: "2 תשובות חדשות בשרשור שלך",
      body: "קינטיקה מומצאת 2 · חלק 3",
      navigate: `${ORIGIN}/?l=${LEC}&at=3.2&nt=7`,
      lang: "he",
      dir: "rtl",
      tag,
      silent: false,
    },
    mutable: false,
    n: 7,
  });
  assert.equal(sent[0].headers.Topic, tag);
  assert.equal(sent[0].headers.Urgency, "normal");
  const ttl = Number(sent[0].headers.TTL);
  assert.ok(ttl > 3500 && ttl <= 3600, String(ttl));

  // The longest args a notice may hold still fit.
  const long = "מילה ".repeat(400);
  const big = row({ kind: "quiz_open", cat: "live", args: { lecture: long, more: 2, title: long, name: long, in: 9, course: long }, route: { v: "practice", l: LEC, s: "x".repeat(400), n: "10" } });
  const p = dwp(big, ORIGIN, "t".repeat(22));
  assert.ok(Buffer.byteLength(p) <= PAYLOAD_MAX, String(Buffer.byteLength(p)));
  // A route too long for a push opens the home, still marked.
  const huge = row({ route: Object.fromEntries([["v", "quiz"], ...["q", "l", "c", "isNew", "mk", "m", "preset", "pf", "pt"].map((k) => [k, k.repeat(500).slice(0, 500)])]) });
  huge.notice.args = { lecture: long };
  const hp = JSON.parse(dwp(huge, ORIGIN, "t"));
  assert.equal(hp.notification.navigate, `${ORIGIN}/?nt=${huge.notice.id}`);
});

test("the security notice in quiet hours goes out silent; the test notice too, at high urgency", async () => {
  claims = [{ rows: [row({ kind: "code_used", cat: "security", args: { at: new Date().toISOString() }, route: { v: "me" }, silent: true }), row({ kind: "test", cat: "security", args: {}, route: { v: "me" } })], more: false, wait_ms: null }];
  await notifyStep(ORIGIN, deps());
  await settle();
  const all = sent.map((s) => JSON.parse(s.payload));
  const a = all.find((p) => p.notification.title !== "התראת ניסיון");
  const c = all.find((p) => p.notification.title === "התראת ניסיון");
  assert.equal(a.notification.silent, true);
  assert.equal(c.notification.title, "התראת ניסיון");
  assert.equal(c.notification.silent, false);
  assert.deepEqual(sent.map((s) => s.headers.Urgency), ["high", "high"]);
});

test("links: Today is /?nt=7, a lecture keeps its keys, practice keeps n=10", () => {
  assert.equal(withMarker(ORIGIN, { v: "today" }, 7), `${ORIGIN}/?nt=7`);
  assert.equal(withMarker(ORIGIN, null, 7), `${ORIGIN}/?nt=7`);
  assert.equal(withMarker(ORIGIN, { v: "lecture", l: LEC }, 8), `${ORIGIN}/?l=${LEC}&nt=8`);
  assert.equal(withMarker(ORIGIN, { v: "practice", l: LEC, n: "10" }, 9), `${ORIGIN}/?v=practice&l=${LEC}&n=10&nt=9`);
  assert.equal(withMarker(ORIGIN, { v: "quiz", q: QUIZ, nt: "99" }, 9), `${ORIGIN}/?v=quiz&q=${QUIZ}&nt=9`, "a stored nt never survives");
});

test("time to live, and a claim's answer read defensively", () => {
  assert.equal(ttlOf(new Date(Date.now() + 600_000).toISOString(), Date.now()), 600);
  assert.equal(ttlOf(new Date(Date.now() + 5_000).toISOString(), Date.now()), 60);
  assert.equal(ttlOf("not a date", Date.now()), 60);
  assert.deepEqual(readClaim(null), { rows: [], more: false, wait_ms: null });
  assert.deepEqual(readClaim({ rows: [{ notice: { id: "x" }, subs: [] }, { notice: { id: 3 }, subs: [] }], more: true, wait_ms: 1500 }), {
    rows: [{ notice: { id: 3 }, subs: [] } as unknown as Claimed],
    more: true,
    wait_ms: 1500,
  });
});

test("a failed study_notify_done is logged and the run goes on (the lease brings the push back)", async () => {
  rpcFails.study_notify_done = true;
  claims = [{ rows: [row(), row({}, Array.from({ length: 8 }, () => dev(201)))], more: false, wait_ms: null }];
  await notifyStep(ORIGIN, deps());
  await settle();
  assert.equal(rpcLog.filter((c) => c.fn === "study_notify_done").length, 2);
  assert.ok(errors.some((e) => e === "study notify done: boom"));
});

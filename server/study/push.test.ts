import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { b64urlDecode, b64urlEncode } from "../../shared/study/b64url.js";
import { encrypt, keyId, MAX_PAYLOAD, PUSH_HOSTS, PUSH_SUFFIXES, pushHostOk, send, vapidFromEnv, vapidJwt, vapidPairOk, type Vapid } from "./push.js";

/* server/study/push.ts: Web Push on WebCrypto (notifications, section R).
 * RFC 8291 Appendix A byte for byte; a round trip decrypted with node:crypto
 * (only the test uses it); the VAPID JWT's header, claims and signature;
 * the push services' hosts (and that section R's SQL has the same list);
 * send()'s request, never following a redirect. No network. */

const b = (s: string) => Buffer.from(s, "base64url");

/* RFC 8291 Appendix A ("When I grow up, I want to be a watermelon"). */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPub: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPriv: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPub: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPriv: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const rfcAsKeys = () => {
  const pub = b(RFC.asPub);
  return { pubRaw: new Uint8Array(pub), privJwk: { kty: "EC", crv: "P-256", d: RFC.asPriv, x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) } };
};

test("RFC 8291 Appendix A: the body equals the RFC's, byte for byte", async () => {
  const out = await encrypt(new TextEncoder().encode(RFC.plaintext), { p256dh: RFC.uaPub, auth: RFC.auth }, { salt: b(RFC.salt), asKeys: rfcAsKeys() });
  assert.equal(b64urlEncode(out), RFC.body);
  assert.equal(out.length, 144);
});

/** RFC 8291 §3.4 from the device's side, with node:crypto: the payload back. */
function decrypt(body: Uint8Array, uaPriv: Buffer, auth: Buffer): Buffer {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  assert.equal(buf.readUInt32BE(16), 4096, "rs");
  assert.equal(buf[20], 65, "idlen");
  const asPub = buf.subarray(21, 86);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(uaPriv);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const rec = buf.subarray(86);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(rec.subarray(rec.length - 16));
  const plain = Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "the last record's delimiter");
  return plain.subarray(0, -1);
}

test("a round trip: a new server key and salt each time, decrypted by the device", async () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const sub = { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const msg = JSON.stringify({ web_push: 8030, notification: { title: "הסיכום מוכן", body: "קינטיקה מומצאת · Invented" } });
  const a = await encrypt(new TextEncoder().encode(msg), sub);
  const c = await encrypt(new TextEncoder().encode(msg), sub);
  assert.notDeepEqual(a.subarray(0, 16), c.subarray(0, 16), "a new salt");
  assert.notDeepEqual(a.subarray(21, 86), c.subarray(21, 86), "a new key pair");
  assert.equal(decrypt(a, ua.getPrivateKey(), auth).toString("utf8"), msg);
  assert.equal(decrypt(c, ua.getPrivateKey(), auth).toString("utf8"), msg);
  // The largest payload fits one 4096-byte record; one more byte is refused.
  const big = new Uint8Array(MAX_PAYLOAD).fill(65);
  assert.equal((await encrypt(big, sub)).length, 4096);
  await assert.rejects(encrypt(new Uint8Array(MAX_PAYLOAD + 1), sub), /payload too large/);
  // A device's keys that are not a point and a 16-byte secret.
  await assert.rejects(encrypt(big.subarray(0, 4), { p256dh: sub.p256dh.slice(0, -4), auth: sub.auth }), /device keys/);
  await assert.rejects(encrypt(big.subarray(0, 4), { p256dh: sub.p256dh, auth: "AAAA" }), /device keys/);
});

/** A fresh VAPID pair, as tools/vapid-keys.mjs makes it. */
async function newVapid(subject = "https://study.example"): Promise<Vapid> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(pub), privateKey: d!, subject };
}

test("VAPID keys from the environment: trimmed, and null when missing or malformed; the pair check", async () => {
  const v = await newVapid();
  const env = { STUDY_VAPID_PUBLIC: ` ${v.publicKey}\n`, STUDY_VAPID_PRIVATE: `${v.privateKey} `, STUDY_VAPID_SUBJECT: "https://study.example" };
  assert.deepEqual(vapidFromEnv(env), v);
  assert.equal(v.publicKey.length, 87);
  assert.equal(v.privateKey.length, 43);
  assert.deepEqual(vapidFromEnv({ ...env, STUDY_VAPID_SUBJECT: "mailto:owner@example.com" })?.subject, "mailto:owner@example.com");
  for (const bad of [
    { STUDY_VAPID_PUBLIC: undefined },
    { STUDY_VAPID_PRIVATE: "" },
    { STUDY_VAPID_SUBJECT: undefined },
    { STUDY_VAPID_SUBJECT: "http://study.example" },
    { STUDY_VAPID_SUBJECT: "study.example" },
    { STUDY_VAPID_PUBLIC: v.publicKey.slice(1) },
    { STUDY_VAPID_PUBLIC: `A${v.publicKey.slice(1)}` }, // not starting with 0x04
    { STUDY_VAPID_PRIVATE: v.privateKey.slice(2) },
    { STUDY_VAPID_PRIVATE: `${v.privateKey.slice(0, -1)}+` },
  ]) {
    assert.equal(vapidFromEnv({ ...env, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(await vapidPairOk(v), true);
  const other = await newVapid();
  assert.equal(await vapidPairOk({ ...v, privateKey: other.privateKey }), false, "another pair's private key");
  assert.equal(await vapidPairOk({ ...v, publicKey: other.publicKey }), false, "another pair's public key");
  assert.equal(await vapidPairOk({ ...v, privateKey: "A".repeat(43) }), false, "not a key at all");
  const id = await keyId(v.publicKey);
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(id, (await keyId(v.publicKey)), "the same key, the same id");
  assert.notEqual(id, await keyId(other.publicKey));
});

test("the VAPID JWT: ES256, aud the push service's origin, exp in 12 h (at most 24), sub; the signature verifies", async () => {
  const v = await newVapid();
  const now = 1_790_000_000;
  const jwt = await vapidJwt("https://fcm.googleapis.com", v, now);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(b(h).toString()), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(b(c).toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now + 12 * 3600, sub: "https://study.example" });
  assert.ok(claims.exp - now <= 24 * 3600);
  assert.equal(b(s).length, 64, "raw r‖s, as JWS ES256 wants");
  const pub = b(v.publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, b(s)));
  // Kept per origin while it has more than an hour left; another origin gets its own.
  assert.equal(await vapidJwt("https://fcm.googleapis.com", v, now + 600), jwt);
  assert.notEqual(await vapidJwt("https://web.push.apple.com", v, now), jwt);
  assert.notEqual(await vapidJwt("https://fcm.googleapis.com", v, now + 11.5 * 3600), jwt);
});

test("the push services' hosts: the five patterns, and nothing else", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abcdefgh:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGx1b2NhbGhvc3Q",
    "https://api.push.apple.com/3/device/abcdef0123",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ])
    assert.equal(pushHostOk(ok), true, ok);
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abcdefgh",
    "https://evil.com/fcm.googleapis.com/abcdefgh",
    "https://fcm.googleapis.com.evil.com/fcm/send/x",
    "https://user@fcm.googleapis.com/fcm/send/abcdefgh",
    "https://fcm.googleapis.com:8443/fcm/send/abcdefgh",
    "https://push.apple.com/abcdefghijklmnop",
    "https://.push.apple.com/abcdefghijklmnopq",
    "https://notify.windows.com.evil.com/abcdefgh",
    "https://FCM.googleapis.com/fcm/send/abcdefgh",
    "https://fcm.googleapis.com/fcm/send/a b",
    `https://fcm.googleapis.com/${"a".repeat(1000)}`,
  ])
    assert.equal(pushHostOk(bad), false, bad);
});

test("the hosts are section R's (study_private.push_host_ok in supabase/study-schema.sql)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/study-schema.sql"), "utf8");
  const fn = /function study_private\.push_host_ok[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
  const list = /m\[1\] in \(([^)]*)\)/.exec(fn)?.[1] ?? "";
  assert.deepEqual(
    [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]),
    [...PUSH_HOSTS],
  );
  for (const s of PUSH_SUFFIXES) assert.ok(fn.includes(s.replace(/\./g, "\\.") + "$'"), s);
});

type Call = { url: string; init: RequestInit };
const fakeFetch = (answer: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { f, calls };
};

test("send(): one POST with the push headers; a redirect is a failure and never followed; timeouts and other hosts", async () => {
  const v = await newVapid();
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc:def", p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") };
  const ok = fakeFetch(() => new Response(null, { status: 201 }));
  assert.deepEqual(await send(sub, '{"n":1}', { ttl: 600.7, urgency: "high", topic: "abcdefghijklmnopqrstuv", vapid: v, fetchImpl: ok.f }), { status: 201 });
  assert.equal(ok.calls.length, 1);
  const { url, init } = ok.calls[0];
  assert.equal(url, sub.endpoint);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  const h = init.headers as Record<string, string>;
  assert.equal(h.TTL, "600");
  assert.equal(h.Urgency, "high");
  assert.equal(h.Topic, "abcdefghijklmnopqrstuv");
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.equal(h["Content-Type"], "application/octet-stream");
  assert.match(h.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${v.publicKey}$`));
  const aud = JSON.parse(b(h.Authorization.slice(8).split(".")[1]).toString()).aud;
  assert.equal(aud, "https://fcm.googleapis.com", "aud is the endpoint's origin");
  assert.equal(decrypt(new Uint8Array(init.body as ArrayBuffer), ua.getPrivateKey(), Buffer.alloc(16, 7)).toString(), '{"n":1}');
  assert.ok(!JSON.stringify(h).includes(v.privateKey), "the private key never leaves");

  // A topic that is not one is left out.
  const t = fakeFetch(() => new Response(null, { status: 201 }));
  await send(sub, "x", { ttl: 60, urgency: "normal", topic: "has space", vapid: v, fetchImpl: t.f });
  assert.equal((t.calls[0].init.headers as Record<string, string>).Topic, undefined);

  // 301: returned as a failure, never followed.
  const moved = fakeFetch(() => new Response(null, { status: 301, headers: { location: "https://evil.example/" } }));
  assert.deepEqual(await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: moved.f }), { status: 301 });
  assert.equal(moved.calls.length, 1);
  // 429 and 503 with Retry-After (seconds, or a date).
  const busy = fakeFetch(() => new Response(null, { status: 429, headers: { "retry-after": "120" } }));
  assert.deepEqual(await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: busy.f }), { status: 429, retryAfter: 120 });
  const down = fakeFetch(() => new Response(null, { status: 503, headers: { "retry-after": new Date(Date.now() + 90_000).toUTCString() } }));
  const d = await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: down.f });
  assert.equal(d.status, 503);
  assert.ok(d.retryAfter! >= 88 && d.retryAfter! <= 91, String(d.retryAfter));
  assert.deepEqual(await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: fakeFetch(() => new Response(null, { status: 410 })).f }), { status: 410 });
  // A network error or a timeout: 0.
  assert.deepEqual(await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).f }), { status: 0 });
  const slow = fakeFetch(() => new Promise<Response>(() => undefined));
  slow.f = (async (url: string, init: RequestInit) =>
    new Promise<Response>((_, no) => init.signal?.addEventListener("abort", () => no(new DOMException("timeout", "TimeoutError"))))) as unknown as typeof fetch;
  const awake = setTimeout(() => undefined, 2_000); // AbortSignal.timeout's timer does not keep the test alive by itself
  assert.deepEqual(await send(sub, "x", { ttl: 60, urgency: "normal", vapid: v, timeoutMs: 50, fetchImpl: slow.f }), { status: 0 });
  clearTimeout(awake);
  // Not a push service: -1, and no request at all.
  const none = fakeFetch(() => new Response(null, { status: 201 }));
  assert.deepEqual(await send({ ...sub, endpoint: "https://attacker.example/push/abcdef" }, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: none.f }), { status: -1 });
  // Keys that cannot be used: 400 (counted against the device), no request.
  assert.deepEqual(await send({ ...sub, auth: "AAAA" }, "x", { ttl: 60, urgency: "normal", vapid: v, fetchImpl: none.f }), { status: 400 });
  // Too large for one record: 413, no request.
  assert.deepEqual(await send(sub, "x".repeat(MAX_PAYLOAD + 1), { ttl: 60, urgency: "normal", vapid: v, fetchImpl: none.f }), { status: 413 });
  assert.equal(none.calls.length, 0);
});

test("the decoder the keys go through refuses what is not base64url", () => {
  assert.throws(() => b64urlDecode("ab+/"), /not base64url/);
});

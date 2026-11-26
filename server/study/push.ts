/* ── Web Push from the server, on WebCrypto alone (notifications, section R) ──
 * docs/study/DECISIONS-2026-11-26.md (OD3): no library and no node:crypto,
 * so the same code type-checks with the repo's DOM lib and runs in the
 * Vercel function. Three parts:
 *
 *   encrypt()   RFC 8291 (Message Encryption for Web Push): the payload in
 *               one aes128gcm record (RFC 8188) for one device's keys. Tested
 *               byte for byte against RFC 8291 Appendix A.
 *   vapidJwt()  RFC 8292 (VAPID): an ES256 JWT for the push service's
 *               origin, signed with the owner's private key (WebCrypto's
 *               ECDSA signature is already the raw r‖s JWS wants).
 *   send()      one POST to a device's endpoint. Only the push services'
 *               hosts are ever asked (the same list as section R's
 *               push_host_ok), a redirect is a failure and is never followed,
 *               and nothing but the status comes back.
 *
 * Keys come from Vercel's Production environment (STUDY_VAPID_PUBLIC,
 * STUDY_VAPID_PRIVATE, STUDY_VAPID_SUBJECT); tools/vapid-keys.mjs makes a
 * pair. Nothing here logs a key, an endpoint or a payload. */

import { b64urlDecode, b64urlEncode, concatBytes, utf8 } from "../../shared/study/b64url.js";

export type Sub = { endpoint: string; p256dh: string; auth: string };
/** base64url: the raw public key (65 bytes), the private scalar (32 bytes); subject https://… or mailto:… */
export type Vapid = { publicKey: string; privateKey: string; subject: string };
export type Urgency = "very-low" | "low" | "normal" | "high";

/** The push services' hosts (section R's study_private.push_host_ok has the same list; a test compares them). */
export const PUSH_HOSTS: readonly string[] = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
/** Hosts under these suffixes are push services too (Apple's regional hosts, Windows' WNS). */
export const PUSH_SUFFIXES: readonly string[] = [".push.apple.com", ".notify.windows.com"];

/** The record size written in the header, and the most a payload may hold in one record. */
const RS = 4096;
/** 4096 bytes in all: header 86 (salt 16, rs 4, idlen 1, key 65), the padding delimiter 1, the tag 16. */
export const MAX_PAYLOAD = RS - 86 - 1 - 16;

/** An endpoint the server may post to: https, a push service's host, no user, no port. */
export function pushHostOk(endpoint: string): boolean {
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > 1000) return false;
  const m = /^https:\/\/([a-z0-9.-]+)(\/[!-~]*)?$/.exec(endpoint);
  if (!m) return false;
  const host = m[1];
  if (PUSH_HOSTS.includes(host)) return true;
  return PUSH_SUFFIXES.some((s) => host.endsWith(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host.slice(0, -s.length)));
}

/** A copy whose buffer is a plain ArrayBuffer (what WebCrypto's types ask for). */
const bytes = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

/** A raw P-256 public key: 65 bytes starting with 4. */
function rawPoint(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const k = b64urlDecode(b64);
    return k.length === 65 && k[0] === 4 ? bytes(k) : null;
  } catch {
    return null;
  }
}

/** The VAPID keys from the environment, trimmed; null when one is missing or malformed. */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = (env.STUDY_VAPID_PUBLIC ?? "").trim();
  const privateKey = (env.STUDY_VAPID_PRIVATE ?? "").trim();
  const subject = (env.STUDY_VAPID_SUBJECT ?? "").trim();
  if (!rawPoint(publicKey)) return null;
  try {
    if (b64urlDecode(privateKey).length !== 32) return null;
  } catch {
    return null;
  }
  if (!/^(https:\/\/[^\s/]+[^\s]*|mailto:[^\s@]+@[^\s@]+)$/.test(subject) || subject.length > 200) return null;
  return { publicKey, privateKey, subject };
}

/** The private key as a JWK (d, with x and y from the public key). */
function privateJwk(v: Pick<Vapid, "publicKey" | "privateKey">): JsonWebKey {
  const pub = rawPoint(v.publicKey);
  if (!pub) throw new Error("vapid public key");
  return { kty: "EC", crv: "P-256", d: v.privateKey, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true };
}

const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** Whether the private key belongs to the public key: a fixed message signed
 *  with one and verified with the other. False for anything malformed. */
export async function vapidPairOk(v: Vapid): Promise<boolean> {
  try {
    const priv = await crypto.subtle.importKey("jwk", privateJwk(v), ES256, false, ["sign"]);
    const pub = await crypto.subtle.importKey("raw", rawPoint(v.publicKey)!, ES256, false, ["verify"]);
    const msg = utf8("tamtzit vapid pair");
    const sig = await crypto.subtle.sign(SIGN, priv, bytes(msg));
    return await crypto.subtle.verify(SIGN, pub, sig, bytes(msg));
  } catch {
    return false;
  }
}

/** sha256 of the text, base64url. */
export async function sha256b64(text: string | Uint8Array): Promise<string> {
  const data = typeof text === "string" ? utf8(text) : text;
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(data))));
}

/** A public key's short id (sha256 of the raw key, base64url, 12 characters):
 *  a device keeps it, and subscribes again when the key changes. */
export async function keyId(publicKey: string): Promise<string> {
  const raw = rawPoint(publicKey);
  if (!raw) throw new Error("vapid public key");
  return (await sha256b64(raw)).slice(0, 12);
}

const JWT_HOURS = 12;
const jwtCache = new Map<string, { jwt: string; exp: number }>();

/** The VAPID JWT for a push service's origin (RFC 8292 §2): ES256, claims
 *  aud, exp (now + 12 h) and sub. Kept per origin and key while it has more
 *  than an hour left. */
export async function vapidJwt(aud: string, v: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const ck = `${aud} ${v.publicKey} ${v.subject}`;
  const hit = jwtCache.get(ck);
  if (hit && hit.exp - nowSec > 3600) return hit.jwt;
  const exp = nowSec + JWT_HOURS * 3600;
  const part = (o: object) => b64urlEncode(utf8(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud, exp, sub: v.subject })}`;
  const key = await crypto.subtle.importKey("jwk", privateJwk(v), ES256, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, bytes(utf8(unsigned))));
  const jwt = `${unsigned}.${b64urlEncode(sig)}`;
  jwtCache.set(ck, { jwt, exp });
  return jwt;
}

/** HKDF-SHA-256 (RFC 5869), `len` bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", bytes(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: bytes(info) }, key, len * 8));
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** The application server's key pair for one message: a new one each time,
 *  or fixed ones (RFC 8291 Appendix A's, in the test). */
export type AsKeys = { pubRaw: Uint8Array; privJwk: JsonWebKey };

/** RFC 8291: `payload` encrypted for one device, as the body of the POST
 *  (salt ‖ rs ‖ idlen ‖ the server's public key ‖ the one aes128gcm record).
 *  Throws when the device's keys are not a P-256 point and a 16-byte secret,
 *  or the payload is over MAX_PAYLOAD. */
export async function encrypt(payload: Uint8Array, sub: Pick<Sub, "p256dh" | "auth">, opts: { salt?: Uint8Array; asKeys?: AsKeys } = {}): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD) throw new Error("payload too large");
  const uaRaw = rawPoint(sub.p256dh);
  const auth = b64urlDecode(sub.auth);
  if (!uaRaw || auth.length !== 16) throw new Error("device keys");
  const uaPub = await crypto.subtle.importKey("raw", uaRaw, ECDH, false, []);
  let asPriv: CryptoKey;
  let asRaw: Uint8Array;
  if (opts.asKeys) {
    asPriv = await crypto.subtle.importKey("jwk", opts.asKeys.privJwk, ECDH, false, ["deriveBits"]);
    asRaw = opts.asKeys.pubRaw;
  } else {
    const pair = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
    asPriv = pair.privateKey;
    asRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16 || asRaw.length !== 65) throw new Error("salt or key");
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPub }, asPriv, 256));
  // RFC 8291 §3.4: IKM from the shared secret and both public keys, keyed by the device's auth secret.
  const ikm = await hkdf(auth, secret, concatBytes(utf8("WebPush: info\0"), uaRaw, asRaw), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last (and only) record: the payload, then the delimiter 2 (RFC 8188 §2).
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, bytes(concatBytes(payload, new Uint8Array([2])))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RS);
  header[20] = 65;
  return concatBytes(header, asRaw, sealed);
}

export type SendOpts = {
  ttl: number;
  urgency: Urgency;
  /** The push service keeps only the newest undelivered message with the same topic (≤ 32 characters of base64url). */
  topic?: string;
  vapid: Vapid;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  nowSec?: number;
};
export type SendResult = { status: number; retryAfter?: number };

/** Retry-After as seconds (a number or an HTTP date), or undefined. */
function retryAfter(h: string | null, nowMs: number): number | undefined {
  if (!h) return undefined;
  const t = h.trim();
  if (/^\d{1,9}$/.test(t)) return Number(t);
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - nowMs) / 1000)) : undefined;
}

/** One push to one device. The status of the push service's answer; a
 *  redirect is returned as its 3xx and never followed; 0 for a timeout or a
 *  network error; -1 (no request) for a host that is not a push service;
 *  400 (no request) for a device whose keys cannot be used, so section R
 *  counts it against the device as a refusal would. */
export async function send(sub: Sub, body: string | Uint8Array, o: SendOpts): Promise<SendResult> {
  if (!pushHostOk(sub.endpoint)) return { status: -1 };
  let sealed: Uint8Array;
  let auth: string;
  try {
    sealed = await encrypt(typeof body === "string" ? utf8(body) : body, sub);
  } catch (e) {
    if (e instanceof Error && e.message === "payload too large") return { status: 413 };
    return { status: 400 };
  }
  try {
    auth = `vapid t=${await vapidJwt(new URL(sub.endpoint).origin, o.vapid, o.nowSec)}, k=${o.vapid.publicKey}`;
  } catch {
    return { status: -1 };
  }
  const headers: Record<string, string> = {
    TTL: String(Math.max(0, Math.min(Math.floor(o.ttl), 28 * 86400))),
    Urgency: o.urgency,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    Authorization: auth,
  };
  if (o.topic && /^[A-Za-z0-9_-]{1,32}$/.test(o.topic)) headers.Topic = o.topic;
  try {
    const res = await (o.fetchImpl ?? fetch)(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      headers,
      body: bytes(sealed),
    });
    // The body is never read beyond draining it (it may name the device).
    void res.body?.cancel().catch(() => undefined);
    const status = res.type === "opaqueredirect" ? 302 : res.status;
    const ra = status === 429 || status >= 500 ? retryAfter(res.headers.get("retry-after"), Date.now()) : undefined;
    return ra === undefined ? { status } : { status, retryAfter: ra };
  } catch {
    return { status: 0 };
  }
}

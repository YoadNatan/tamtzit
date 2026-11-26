/* ── Base64url (RFC 4648 §5) for push keys, VAPID and payloads ──
 * Notifications (section R): a device's push keys arrive as base64url, the
 * VAPID keys are kept as base64url, and the JWT and the encrypted body are
 * built from bytes. btoa and atob only (no Buffer), so the same code runs in
 * the Vercel function, in the browser and in the tests. Encoding never pads;
 * decoding accepts padding and refuses anything that is not base64url. */

/** Bytes → base64url, without padding. */
export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (padded or not) → bytes. Throws on any other text. */
export function b64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) throw new Error("not base64url");
  const t = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (t.length % 4 === 1) throw new Error("not base64url");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Text → its UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Byte arrays joined into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

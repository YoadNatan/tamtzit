#!/usr/bin/env node
// A new VAPID key pair for notifications' pushes (section R;
// docs/study/DECISIONS-2026-11-26.md, OD22), made with WebCrypto on this
// computer. It PRINTS the three Vercel variables and WRITES NOTHING: no
// file, no clipboard, no network. Run it once, on your own computer:
//
//   node tools/vapid-keys.mjs                      the subject as a placeholder
//   node tools/vapid-keys.mjs https://<the app's address>
//
// Then, on Vercel, Production only:
//   STUDY_VAPID_PUBLIC   the public key (87 characters; the browsers get it)
//   STUDY_VAPID_PRIVATE  the private key (43 characters), marked Sensitive.
//                        Keep a copy in your password manager. Never paste it
//                        in a chat, an issue, a commit or a screenshot.
//   STUDY_VAPID_SUBJECT  https://<the app's address> (no email anywhere)
// and redeploy. /api/study/health then reads "notify": true and a "vapid" value.
// A new pair later (only after a leak) makes every device subscribe again
// on its next open.

const arg = process.argv[2];
if (arg === "-h" || arg === "--help") {
  console.log("usage: node tools/vapid-keys.mjs [https://<the app's address>]");
  process.exit(0);
}
if (arg !== undefined && !/^https:\/\/[^\s/]+\/?$/.test(arg)) {
  console.error("The subject is the app's address, e.g. https://tamtzit.example (https, no path).");
  process.exit(2);
}
const subject = arg ? arg.replace(/\/$/, "") : "https://<the app's address>";

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const { subtle } = globalThis.crypto;
const ES256 = { name: "ECDSA", namedCurve: "P-256" };

const pair = await subtle.generateKey(ES256, true, ["sign", "verify"]);
const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
const { d } = await subtle.exportKey("jwk", pair.privateKey);

// The same check the server makes (server/study/push.ts vapidPairOk).
const msg = new TextEncoder().encode("tamtzit vapid pair");
const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, msg);
if (pub.length !== 65 || pub[0] !== 4 || !d || d.length !== 43 || !(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, msg))) {
  console.error("The new pair failed its own check; run it again.");
  process.exit(1);
}
const keyId = b64url(new Uint8Array(await subtle.digest("SHA-256", pub))).slice(0, 12);

console.log(`STUDY_VAPID_PUBLIC=${b64url(pub)}`);
console.log(`STUDY_VAPID_PRIVATE=${d}`);
console.log(`STUDY_VAPID_SUBJECT=${subject}`);
console.error(`(key id ${keyId}: devices keep it and subscribe again when it changes. Nothing was written.)`);

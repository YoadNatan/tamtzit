import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { b64urlDecode, b64urlEncode, concatBytes, utf8 } from "./b64url.js";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

test("RFC 4648's vectors, without padding", () => {
  const cases: Array<[string, string]> = [
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
    ["fooba", "Zm9vYmE"],
    ["foobar", "Zm9vYmFy"],
  ];
  for (const [plain, enc] of cases) {
    assert.equal(b64urlEncode(bytes(plain)), enc, plain);
    assert.deepEqual(b64urlDecode(enc), bytes(plain), enc);
  }
});

test("the URL alphabet: - and _ for + and /", () => {
  assert.equal(b64urlEncode(new Uint8Array([0xfb, 0xff, 0xbf])), "-_-_");
  assert.deepEqual(b64urlDecode("-_-_"), new Uint8Array([0xfb, 0xff, 0xbf]));
});

test("agrees with Node's base64url for every length up to 300, both ways", () => {
  for (let n = 0; n <= 300; n++) {
    const b = new Uint8Array(randomBytes(n));
    const node = Buffer.from(b).toString("base64url");
    assert.equal(b64urlEncode(b), node, `length ${n}`);
    assert.deepEqual(b64urlDecode(node), b, `length ${n}`);
  }
});

test("a push subscription's keys: 65 bytes are 87 characters, 16 bytes 22", () => {
  assert.equal(b64urlEncode(new Uint8Array(65).fill(4)).length, 87);
  assert.equal(b64urlEncode(new Uint8Array(16).fill(7)).length, 22);
});

test("padding is accepted; anything else is refused", () => {
  assert.deepEqual(b64urlDecode("Zg=="), bytes("f"));
  assert.deepEqual(b64urlDecode("Zm8="), bytes("fo"));
  for (const bad of ["Zg+/", "Z", "Zm9vY", "a b", "Zg===", "שלום"]) assert.throws(() => b64urlDecode(bad), /not base64url/, bad);
});

test("utf8 and concatBytes", () => {
  assert.deepEqual(utf8("WebPush: info\0"), bytes("WebPush: info\0"));
  assert.equal(utf8("תמצית").length, 10);
  assert.deepEqual(concatBytes(bytes("ab"), new Uint8Array(0), bytes("c")), bytes("abc"));
});

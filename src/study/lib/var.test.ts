import assert from "node:assert/strict";
import { before, test } from "node:test";

// api.ts (which var.ts imports) reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the first
// evaluation: no Supabase here (nothing in these tests calls it).
(import.meta as unknown as { env: Record<string, string> }).env = {};
let V: typeof import("./var");
before(async () => {
  V = await import("./var");
});

/* Package V's pure rules (spec §12.4.V): what backing shows while it is open
 * and after (review SEC-10), the update card's two lines and its reason,
 * the certainty's words. The screens' flows are e2e/study/var.cjs. */

test("backing: the total only while it is open; the split once closed; else the line about three", () => {
  assert.deepEqual(V.backingView({ backing_open: true, backers: 4, backs: null }), { kind: "open", line: "4 גיבו · הגיבוי יוצג אחרי הבדיקה, מ-3" });
  assert.deepEqual(V.backingView({ backing_open: true, backers: 1, backs: null }), { kind: "open", line: "גיבוי אחד · הגיבוי יוצג אחרי הבדיקה, מ-3" });
  assert.deepEqual(V.backingView({ backing_open: true, backers: 0, backs: null }), { kind: "open", line: "עוד אין גיבויים · הגיבוי יוצג אחרי הבדיקה, מ-3" });
  // Even a split the server sent while open is never drawn (it never does: SEC-10).
  assert.equal(V.backingView({ backing_open: true, backers: 4, backs: { a: 3, b: 1 } }).kind, "open");
  assert.deepEqual(V.backingView({ backing_open: false, backers: 5, backs: { a: 3, b: 2 } }), { kind: "bars", a: 3, b: 2 });
  assert.deepEqual(V.backingView({ backing_open: false, backers: 2, backs: null }), { kind: "hidden", line: "הגיבוי יוצג מ-3" });
  assert.equal(V.share(3, 5), 60);
  assert.equal(V.share(0, 0), 0);
});

test("the certainty's words are the mockup's", () => {
  assert.equal(V.CERTAINTY.interpretation.label, "ודאות: פרשנות");
  assert.equal(V.CERTAINTY.interpretation.chip, "warn");
  assert.equal(V.CERTAINTY.slide.short, "כתוב בשקף");
  assert.equal(V.CERTAINTY.unclear.label, "ודאות: לא חד-משמעי");
});

test("an update's two lines: the changed words with a little context, without tags or markdown", () => {
  const { was, now } = V.changeLines(
    "| **Doxycycline** | עם Quinine | — | [ש' 33]",
    "| **Doxycycline** | עם Quinine | אסורה בהיריון ובילדים מתחת לגיל 8 | [ש' 33]",
  );
  assert.ok(was.includes("—") && !was.includes("**") && !was.includes("[ש"), was);
  assert.ok(now.includes("אסורה בהיריון ובילדים מתחת לגיל 8") && !now.includes("|"), now);
  const added = V.changeLines("Chloroquine מצטברת בוואקואולה. [ש' 15]", "Chloroquine מצטברת בוואקואולה החומצית. [ש' 15]");
  assert.match(added.was, /בוואקואולה/);
  assert.match(added.now, /בוואקואולה החומצית/);
  assert.equal(V.changeLines("א ב ג", "א ב חדש ג").was, "—", "nothing was deleted: a dash");
  assert.ok(V.changeLines("x".repeat(400), "y".repeat(400)).now.length <= 140);
});

test("why it reached her: the day in Israel time, a card or a question, gender-neutral", () => {
  const now = new Date("2026-11-18T09:00:00Z"); // Wednesday morning in Israel
  assert.equal(V.dayWords("2026-11-18T05:00:00Z", now), "היום");
  assert.equal(V.dayWords("2026-11-17T20:00:00Z", now), "אתמול");
  assert.equal(V.dayWords("2026-11-15T08:00:00Z", now), "ביום ראשון");
  assert.equal(V.reasonLine({ reason: "card", reason_at: "2026-11-15T08:00:00Z" }, now), "הגיע אליך כי ביום ראשון חזרת על כרטיס שנשען על השורה הישנה.");
  assert.equal(V.reasonLine({ reason: "question", reason_at: "2026-11-17T20:00:00Z" }, now), "הגיע אליך כי אתמול ענית על שאלה שנשענה על השורה הישנה.");
});

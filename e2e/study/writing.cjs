// W-6 (spec §7.W; design-platform §6.3 A and B, and C's notes boxes): writing
// on the server, seen from the phones, and sharing a summary.
//   A1 with the server on, an upload hands the lecture to study_queue (the
//      deck's pictures signed for 48 h) and no phone writes for 60 s; the
//      server note shows
//   A2 the test plays the worker: "מתכננים את מבנה הסיכום לפי נושאי ההרצאה…
//      (בשרת)", the outline, part 0's text growing under "נכתב עכשיו…", then
//      every part, "3 חלקים · 20 שקפים"
//   A3 a part waiting for its retry says when; a refused part offers "המשך
//      כתיבה", which calls study_queue with p_retry_failed and says the server
//      goes on
//   A4 with the server off, the upload's study_queue answers false and the
//      phone writes, as today (outline, then the parts)
//   A5 a server silent for 3 minutes: the open page writes; a part another
//      writer holds answers 409 and shows "נכתב עכשיו במכשיר אחר…", no error
//   A6 what the server will not retry by itself (an outline the budget
//      stopped, a refused part): the reason, "המשך כתיבה", and no note that
//      writing goes on; the tap starts the outline over
//   R  "המשך כתיבה" with the server off: four taps on parts that only wait
//      write them and are not counted; it restarts a part that failed 4
//      times; a fourth restart in a day shows the retry limit's words
//   B1 "שיתוף" opens the share sheet (the PDF option with VITE_STUDY_PDF),
//      PDF and printing wait for every part
//   B2-B4 (VITE_STUDY_PDF) the print layout sent to /api/study/pdf, "ה-PDF
//      מוכן", "שליחה" shares one PDF file, "שמירה" downloads it
//   B5 printing on the device: in print media (dark), the layout alone, ink
//      paragraphs, no page numbers of ours
//   C3 (VITE_STUDY_RECORDINGS) the "מההקלטה" boxes after their paragraphs,
//      anchors unchanged, a comment still on its paragraph, the setting hides them
//   H  W2, the hardening (spec §3.7; docs/study/writing.md):
//   H1 a stuck part (its writer died, the lease ran out): "ממתין לתורו", not
//      the dead writer's text; taken over, it grows again; after the fourth
//      dead writer it stops ("נעצר אחרי 4 ניסיונות"), the server note goes,
//      and a tap starts it over on the server
//   H2 double dispatch: two phones tap "המשך כתיבה" at once (one of them
//      twice): one study_queue call a phone, one restart spent, nothing
//      written by a phone
//   H3 an automatic retry counts down its minutes
//   H4 cancel: a lecture deleted while a phone writes it: the run stops at
//      the part in flight, the reader says why and offers nothing to tap;
//      restored, "המשך כתיבה" writes the rest. Deleting it from this phone
//      stops its run too
//   H5 no phone wrote a part or a lecture's writing state in the whole run
//      (the mock refuses what the grants refuse, as PostgREST does: 403
//      42501), and a member's direct write of a part is refused
// Recording sheets, transcripts and transcription are W4's (not built yet).
//
//   NODE_PATH=$(npm root -g) node e2e/study/writing.cjs <dist> <out dir> [off|rel1|notoday|all]
// The third argument (or E2E_FLAGS) names the build's flags (mock.cjs's
// flagSetOf). "off" and "rel1" (release 1's three) run against the registry
// this branch's SQL writes; B2-B4 and C3 need every flag (notoday or all).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");
const writingPlugin = require("./mocks/writing.cjs");

const [dist, out, flagArg] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/writing.cjs <dist> <out dir> [off|rel1|notoday|all]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(flagArg);
const flagSet = flags.set;
// VITE_STUDY_PDF and VITE_STUDY_RECORDINGS are on only when every flag is.
const all = flagSet === "all" || flagSet === "notoday";
const now = () => new Date().toISOString();
const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();
const uuid = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** The file's name: the lecture's title, with what a file name cannot hold made "-" (pdf-export.ts). */
const pdfName = (title) => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim() || "summary"}.pdf`;

(async () => {
  const mock = await createMock({ dist, plugins: [writingPlugin], flags: flagSet });
  const { db } = mock;
  db.serverOn = true; // the group's server writes (§9.1 step 4 done); A4 and R turn it off
  const fx = mock.fixture;
  const shoham = mock.people["שוהם"].user.id;
  const deck = path.join(out, "deck.pptx");
  await makePptx(deck);
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const apiCalls = (kind) => mock.calls.filter((c) => c.startsWith(`api POST /api/study/${kind}`));
  /** A lecture in the group: the fixture's slides, `parts` (each a partial section row). */
  const lecture = (n, title, extra, parts) => {
    const id = uuid(n);
    const t = now();
    db.lectures.push({
      id, group_id: mock.GROUP.id, course: fx.outline.course, title, lecturer: fx.outline.lecturer, lecture_date: "2026-11-14",
      source_name: "deck.pptx", source_kind: "pptx", status: "writing", error: null, created_by: shoham, created_at: t, updated_at: t,
      queued_at: null, deleted_at: null, deleted_by: null,
      slides: fx.slides.map((s) => ({ n: s.n, title: s.title, lines: s.lines, tables: s.tables, notes: s.notes, figures: [] })),
      ...extra,
    });
    parts.forEach((p, idx) => {
      const o = fx.outline.parts[idx];
      db.sections.push({ lecture_id: id, idx, title: o.heading, slide_from: o.from, slide_to: o.to, markdown: "", status: "pending", error: null, updated_at: t, lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0, ...p });
    });
    return id;
  };
  const partOf = (page, idx) => page.locator(`[data-part="${idx}"], #part-${idx}`).first();
  const placeholder = (page, idx) => page.locator(`#part-${idx}`);

  try {
    // ── A1: an upload with the server on ──
    db.uploadDelayMs = 600; // the saving line stays long enough to read
    const { page } = await mock.open(browser, "שוהם", { storage: { "study-server-on": "1" } });
    await page.clock.install();
    await page.goto(`${mock.base}/${flags.today ? "?v=library" : ""}`); // with Today's tabs the library is its own screen
    await page.getByRole("button", { name: /העלאת הרצאה/ }).first().click();
    await page.locator('input[type="file"]').setInputFiles(deck);
    await page.getByText(/20 שקפים/).waitFor({ timeout: 30000 });
    await page.locator("label:has-text('מרצה') input").fill("ד״ר בדיקה");
    a11y.push(...(await snap(page, out, "writing-0-upload", { primary: ".ph-foot .a-btn.primary" })));
    await page.getByRole("button", { name: "יצירת סיכום" }).click();
    const saving = await page.getByText(/שומרים את השקפים: \d+ מתוך 20/).first().textContent({ timeout: 10000 }).catch(() => "");
    check("A1 the saving line, short: how far, and to keep the screen open", /^שומרים את השקפים: \d+ מתוך 20\. להשאיר את המסך פתוח עד שהשמירה נגמרת\.$/.test(saving.trim()), saving);
    await page.waitForURL(/\/\?l=/, { timeout: 60000 });
    const L1 = new URL(page.url()).searchParams.get("l");
    const l1 = db.lectures.find((l) => l.id === L1);
    await page.locator(".server-note").waitFor({ timeout: 10000 });
    const q1 = db.queueCalls.filter((c) => c.p_lecture === L1);
    const stored = l1.slides.flatMap((s) => s.figures.map((f) => f.path));
    const until = q1[0] ? Date.parse(q1[0].p_until) - Date.now() : 0;
    check(
      "A1 study_queue once, the deck's pictures signed, p_until 48 h ahead",
      q1.length === 1 &&
        q1[0].p_retry_failed === false &&
        stored.length === 3 &&
        JSON.stringify(Object.keys(q1[0].p_figures).sort()) === JSON.stringify([...stored].sort()) &&
        Object.entries(q1[0].p_figures).every(([p, u]) => u === `https://mock.supabase.test/storage/v1/object/sign/study/${p}?token=t`) &&
        Math.abs(until - 48 * 3600_000) < 5 * 60_000,
      JSON.stringify({ calls: q1.length, keys: q1[0] && Object.keys(q1[0].p_figures), stored, until }),
    );
    check("A1 the server note", (await page.locator(".server-note").innerText()).startsWith("הסיכום נכתב בשרת, חלק אחרי חלק. אפשר לסגור את האפליקציה"), "");
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(1500);
    check("A1 no phone writes for 60 s", apiCalls("outline").length === 0 && apiCalls("section").length === 0, JSON.stringify(mock.calls.filter((c) => c.startsWith("api")).slice(-5)));
    a11y.push(...(await snap(page, out, "writing-1-server-note")));

    // ── A2: the test plays the worker ──
    Object.assign(l1, { status: "outlining", updated_at: now() });
    mock.notify("study_lectures", "UPDATE", l1);
    await page.locator(".part-wait p").first().waitFor({ timeout: 10000 });
    const planLine = (await page.locator(".part-wait p").first().innerText()).trim();
    check("A2 the planning line, in the copy deck's words, says the server plans", planLine === "מתכננים את מבנה הסיכום לפי נושאי ההרצאה… (בשרת)", planLine);
    const outline = [
      { heading: "מבוא: משתנים", from: 1, to: 8 },
      { heading: "Loop diuretics", from: 9, to: 16 },
      { heading: "סיכום", from: 17, to: 20 },
    ];
    outline.forEach((o, idx) =>
      db.sections.push({ lecture_id: L1, idx, title: o.heading, slide_from: o.from, slide_to: o.to, markdown: "", status: "pending", error: null, updated_at: now(), lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 }),
    );
    Object.assign(l1, { status: "writing", outline, updated_at: now() });
    mock.notify("study_lectures", "UPDATE", l1);
    await placeholder(page, 2).waitFor({ timeout: 10000 });
    check("A2 three parts waiting their turn", (await placeholder(page, 1).innerText()).includes("ממתין לתורו"), await placeholder(page, 1).innerText());
    const p0 = db.sections.find((s) => s.lecture_id === L1 && s.idx === 0);
    const full = fx.parts[1];
    Object.assign(p0, { status: "writing", writer: "server", markdown: full.slice(0, Math.floor(full.length / 2)), lease_until: minutes(5), attempts: 1, updated_at: now() });
    mock.notify("study_sections", "UPDATE", p0);
    await page.locator(".part.writing").waitFor({ timeout: 10000 });
    const growing = await page.locator(".part.writing").innerText();
    check("A2 the server's text so far, under נכתב עכשיו…", growing.includes("Carbonic anhydrase inhibitors") && growing.includes("נכתב עכשיו…"), growing.slice(0, 120));
    a11y.push(...(await snap(page, out, "writing-2-growing")));
    for (const idx of [0, 1, 2]) {
      const s = db.sections.find((x) => x.lecture_id === L1 && x.idx === idx);
      Object.assign(s, { status: "ready", writer: null, lease_until: null, markdown: fx.parts[idx + 1] ?? fx.parts[0], updated_at: now() });
      mock.notify("study_sections", "UPDATE", s);
    }
    Object.assign(l1, { status: "ready", updated_at: now() });
    mock.notify("study_lectures", "UPDATE", l1);
    await page.getByText("3 חלקים · 20 שקפים").waitFor({ timeout: 10000 });
    check("A2 every part written, and the note is gone", (await page.locator(".server-note").count()) === 0, "");
    check("A2 still no phone wrote", apiCalls("outline").length === 0 && apiCalls("section").length === 0, "");
    a11y.push(...(await snap(page, out, "writing-3-ready")));

    // ── A3: a part waiting for its retry, a refused part, "המשך כתיבה" ──
    const L2 = lecture(21, "הרצאה שנעצרה", { queued_at: now() }, [
      { status: "ready", markdown: fx.parts[0] },
      { status: "failed", error: "rate_limited", attempts: 1, retry_at: minutes(4) },
      { status: "failed", error: "refusal", attempts: 1 },
    ]);
    // A page of its own: the first page's clock was moved forward a minute.
    const { page: p3 } = await mock.open(browser, "שוהם", { path: `/?l=${L2}` });
    await placeholder(p3, 1).waitFor({ timeout: 10000 });
    const line1 = await placeholder(p3, 1).innerText();
    const line2 = await placeholder(p3, 2).innerText();
    check("A3 the part waiting for its retry says when", line1.includes("נעצר: Claude עמוס. ניסיון חוזר אוטומטי בעוד 4 דק׳."), line1);
    check("A3 the refused part says why, and the button", line2.includes("המודל סירב לכתוב את החלק הזה. אפשר ללחוץ ״המשך כתיבה״."), line2);
    check("A3 the note stays while a part waits for its automatic retry", (await p3.locator(".server-note").count()) === 1, "");
    a11y.push(...(await snap(p3, out, "writing-4-stopped")));
    const before = db.queueCalls.length;
    await p3.getByRole("button", { name: "המשך כתיבה" }).click();
    await p3.getByText("השרת ממשיך לכתוב.").waitFor({ timeout: 10000 });
    const tap = db.queueCalls.slice(before);
    check("A3 the tap restarts through study_queue, and the server goes on", tap.length === 1 && tap[0].p_retry_failed === true && tap[0].p_lecture === L2 && apiCalls("section").length === 0, JSON.stringify(tap));
    await p3.context().close();

    // ── A4: the server off: the upload's study_queue answers false and this phone writes ──
    db.serverOn = false;
    db.uploadDelayMs = 0;
    await page.goto(`${mock.base}/?v=upload`);
    await page.locator('input[type="file"]').setInputFiles(deck);
    await page.getByText(/20 שקפים/).waitFor({ timeout: 30000 });
    await page.locator("label:has-text('שם ההרצאה') input").fill("בלי שרת");
    await page.getByRole("button", { name: "יצירת סיכום" }).click();
    await page.waitForURL((u) => u.searchParams.get("l") && u.searchParams.get("l") !== L1, { timeout: 60000 });
    const L3 = new URL(page.url()).searchParams.get("l");
    await page.getByText(/חלקים · 20 שקפים/).waitFor({ timeout: 60000 });
    const firstCalls = mock.calls.filter((c) => c.includes("/rpc/study_queue") || c.startsWith("api POST /api/study/outline") || c.startsWith("api POST /api/study/section"));
    const order = firstCalls.map((c) => (c.includes("study_queue") ? "queue" : c.includes("outline") ? "outline" : "section"));
    const fromQueue = order.lastIndexOf("queue");
    check(
      "A4 server off: study_queue, then the outline, then the parts from this phone",
      db.queueCalls.filter((c) => c.p_lecture === L3).length === 1 && order.slice(fromQueue + 1, fromQueue + 2)[0] === "outline" && db.sections.filter((s) => s.lecture_id === L3).every((s) => s.status === "ready"),
      JSON.stringify(order.slice(-6)),
    );
    check("A4 no server note when the phone writes", (await page.locator(".server-note").count()) === 0, "");
    db.serverOn = true;

    // ── A5: the server silent for 3 minutes: the open page writes; a part another writer holds is busy ──
    const L5 = lecture(25, "שרת שותק", { queued_at: now() }, [{ status: "ready", markdown: fx.parts[0] }, {}, {}]);
    db.busyParts.add(`${L5}:2`);
    const { page: p5 } = await mock.open(browser, "נועה");
    await p5.clock.install();
    await p5.goto(`${mock.base}/?l=${L5}`);
    await placeholder(p5, 2).waitFor({ timeout: 10000 });
    await p5.waitForTimeout(1000);
    const early = db.sectionCalls.filter((c) => c.lectureId === L5).length;
    await p5.clock.fastForward("03:10");
    await p5.locator('[data-part="1"]').waitFor({ timeout: 20000 });
    await p5.waitForFunction(() => document.querySelector("#part-2")?.textContent.includes("נכתב עכשיו במכשיר אחר…"), null, { timeout: 40000 });
    // The busy part is looked at again after 20 s, and stays someone else's.
    await p5.waitForTimeout(23_000);
    const calls5 = db.sectionCalls.filter((c) => c.lectureId === L5).map((c) => c.idx);
    check("A5 nothing written before the silence", early === 0, String(early));
    check("A5 after 3 minutes of silence the page writes; part 2 is someone else's", calls5.includes(1) && calls5.includes(2) && db.sections.find((s) => s.lecture_id === L5 && s.idx === 1).status === "ready", JSON.stringify(calls5));
    check("A5 no error line for the busy part", (await p5.locator(".a-error[role=alert]").count()) === 0, await p5.locator(".a-error[role=alert]").allInnerTexts().then((t) => t.join(" | ")));
    a11y.push(...(await snap(p5, out, "writing-5-busy")));
    await p5.context().close();

    // ── A6: what the server will not retry by itself: the reason shows, and no note says writing goes on ──
    const L7 = lecture(27, "המתווה נעצר", { queued_at: now(), status: "failed", error: "budget" }, []);
    const { page: p7 } = await mock.open(browser, "שוהם", { path: `/?l=${L7}` });
    await p7.locator(".part-wait").waitFor({ timeout: 10000 });
    await p7.locator(".a-error[role=alert]").waitFor({ timeout: 10000 }).catch(() => undefined);
    const alert7 = (await p7.locator(".a-error[role=alert]").allInnerTexts()).join(" | ");
    check(
      "A6 an outline the budget stopped says why, offers המשך כתיבה, and no note says writing goes on",
      alert7 === "הקבוצה הגיעה לתקרת התקציב של החודש. אפשר להעלות אותה ב-Vercel (STUDY_MONTHLY_USD)." &&
        (await p7.locator(".server-note").count()) === 0 &&
        (await p7.getByRole("button", { name: "המשך כתיבה" }).count()) === 1,
      JSON.stringify({ alert7, note: await p7.locator(".server-note").count() }),
    );
    a11y.push(...(await snap(p7, out, "writing-5b-outline-stopped")));
    await p7.getByRole("button", { name: "המשך כתיבה" }).click();
    await p7.getByText("השרת ממשיך לכתוב.").waitFor({ timeout: 10000 });
    await p7.getByText("מתכננים את מבנה הסיכום לפי נושאי ההרצאה… (בשרת)").waitFor({ timeout: 10000 });
    const q7 = db.queueCalls.filter((c) => c.p_lecture === L7);
    check(
      "A6 the tap starts the outline over on the server: planning, and the note again",
      q7.length === 1 && q7[0].p_retry_failed === true && (await p7.locator(".a-error[role=alert]").count()) === 0 && (await p7.locator(".server-note").count()) === 1,
      JSON.stringify(q7),
    );
    await p7.context().close();
    const L8 = lecture(28, "חלק שנעצר", { queued_at: now() }, [{ status: "ready", markdown: fx.parts[0] }, { status: "failed", error: "refusal", attempts: 1 }, { status: "ready", markdown: fx.parts[2] }]);
    const { page: p8 } = await mock.open(browser, "שוהם", { path: `/?l=${L8}` });
    await placeholder(p8, 1).waitFor({ timeout: 10000 });
    check(
      "A6 a part that waits for a tap: its reason, and no note says writing goes on",
      (await placeholder(p8, 1).innerText()).includes("המודל סירב לכתוב את החלק הזה. אפשר ללחוץ ״המשך כתיבה״.") && (await p8.locator(".server-note").count()) === 0,
      await placeholder(p8, 1).innerText(),
    );
    await p8.context().close();

    // ── R: the restart rules, with the server off ──
    db.serverOn = false;
    // Parts only waiting (a phone slept half-way, another writer was busy):
    // a tap restarts nothing, so it is never one of the day's three restarts.
    const L9 = lecture(29, "חלקים ממתינים", {}, [{ status: "ready", markdown: fx.parts[0] }, {}, {}]);
    await page.goto(`${mock.base}/?l=${L9}`);
    await page.locator('[data-part="2"]').waitFor({ timeout: 20000 }); // the page picks them up once by itself
    const before9 = db.queueCalls.length;
    for (let i = 0; i < 4; i++) {
      const s = db.sections.find((x) => x.lecture_id === L9 && x.idx === 2);
      Object.assign(s, { status: "pending", markdown: "", updated_at: now() });
      mock.notify("study_sections", "UPDATE", s);
      await placeholder(page, 2).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "המשך כתיבה" }).click();
      await page.locator('[data-part="2"]').waitFor({ timeout: 20000 });
    }
    const taps9 = db.queueCalls.slice(before9).filter((c) => c.p_lecture === L9);
    check(
      "R four taps on parts that only wait: each writes, and none is counted as a restart",
      taps9.length === 4 && taps9.every((c) => c.p_retry_failed === false) && !db.retries[L9] && (await page.getByText(/הופעל כבר שלוש פעמים/).count()) === 0,
      JSON.stringify({ taps: taps9.map((c) => c.p_retry_failed), retries: db.retries[L9] }),
    );
    // A phone planning the outline itself: the same line, without "(בשרת)".
    const L10 = lecture(30, "מתכננים בטלפון", { status: "outlining", updated_at: now() }, []);
    await page.goto(`${mock.base}/?l=${L10}`);
    await page.locator(".part-wait p").first().waitFor({ timeout: 10000 });
    const planHere = (await page.locator(".part-wait p").first().innerText()).trim();
    check("R a phone that plans says so without (בשרת)", planHere === "מתכננים את מבנה הסיכום לפי נושאי ההרצאה…", planHere);
    const L6 = lecture(26, "ארבעה ניסיונות", {}, [{ status: "ready", markdown: fx.parts[0] }, { status: "failed", error: "lost", attempts: 4 }, { status: "ready", markdown: fx.parts[2] }]);
    await page.goto(`${mock.base}/?l=${L6}`);
    await placeholder(page, 1).waitFor({ timeout: 10000 });
    check("R a part that failed 4 times says so", (await placeholder(page, 1).innerText()).includes("נעצר אחרי 4 ניסיונות. אפשר ללחוץ ״המשך כתיבה״."), await placeholder(page, 1).innerText());
    await page.getByRole("button", { name: "המשך כתיבה" }).click();
    await page.locator('[data-part="1"]').waitFor({ timeout: 20000 });
    const r1 = db.queueCalls.filter((c) => c.p_lecture === L6);
    check("R with the server off, the tap restarts it and this phone writes it", r1.length === 1 && r1[0].p_retry_failed === true && db.sectionCalls.some((c) => c.lectureId === L6 && c.idx === 1), JSON.stringify(r1));
    // Two more taps today, then the fourth.
    db.retries[L6] = 3;
    const s2 = db.sections.find((s) => s.lecture_id === L6 && s.idx === 2);
    Object.assign(s2, { status: "failed", error: "refusal", markdown: "", attempts: 1, updated_at: now() });
    mock.notify("study_sections", "UPDATE", s2);
    await placeholder(page, 2).waitFor({ timeout: 10000 });
    const sectionsBefore = db.sectionCalls.length;
    await page.getByRole("button", { name: "המשך כתיבה" }).click();
    await page.getByText("״המשך כתיבה״ הופעל כבר שלוש פעמים היום בהרצאה הזו. אפשר לנסות שוב מחר.").waitFor({ timeout: 10000 });
    check("R a fourth tap in a day shows the retry limit, and nothing is written", db.sectionCalls.length === sectionsBefore, "");
    a11y.push(...(await snap(page, out, "writing-6-retry-limit")));
    db.serverOn = true;

    // ── H1 (W2): a stuck part, taken over, lost after four dead writers ──
    db.serverOn = true;
    const ago = (n) => new Date(Date.now() - n * 60_000).toISOString();
    const LH1 = lecture(31, "כותב שמת", { queued_at: now() }, [
      { status: "ready", markdown: fx.parts[0] },
      { status: "writing", writer: "server", markdown: "## מבוא\n\nטקסט של כותב שמת באמצע", attempts: 1, lease_until: ago(2), updated_at: ago(7) },
      {},
    ]);
    const { page: h1 } = await mock.open(browser, "שוהם", { path: `/?l=${LH1}` });
    await placeholder(h1, 1).waitFor({ timeout: 10000 });
    const stuckLine = await placeholder(h1, 1).innerText();
    check(
      "H1 a part whose writer died waits its turn: not the dead writer's text, not another device",
      stuckLine.includes("ממתין לתורו") && stuckLine.includes("בתור") && !stuckLine.includes("נכתב עכשיו") && (await h1.getByText("טקסט של כותב שמת").count()) === 0 && (await h1.locator(".server-note").count()) === 1,
      stuckLine,
    );
    await placeholder(h1, 1).scrollIntoViewIfNeeded();
    a11y.push(...(await snap(h1, out, "writing-h1-stuck")));
    const ph1 = db.sections.find((x) => x.lecture_id === LH1 && x.idx === 1);
    Object.assign(ph1, { status: "writing", writer: "server", markdown: fx.parts[1].slice(0, 200), attempts: 2, lease_until: minutes(5), updated_at: now() });
    mock.notify("study_sections", "UPDATE", ph1);
    await h1.locator(".part.writing").waitFor({ timeout: 10000 });
    check("H1 taken over by the sweeper's next writer: the text grows again", (await h1.locator(".part.writing").innerText()).includes("נכתב עכשיו…"), "");
    // Three more writers die; the sweeper gives up: 'lost' after four attempts.
    Object.assign(ph1, { status: "failed", error: "lost", writer: null, markdown: "", attempts: 4, lease_until: null, retry_at: null, updated_at: now() });
    mock.notify("study_sections", "UPDATE", ph1);
    const ph2 = db.sections.find((x) => x.lecture_id === LH1 && x.idx === 2);
    Object.assign(ph2, { status: "ready", markdown: fx.parts[2], updated_at: now() });
    mock.notify("study_sections", "UPDATE", ph2);
    await h1.getByText("נעצר אחרי 4 ניסיונות").waitFor({ timeout: 10000 });
    check("H1 lost after four dead writers: the reason, the button, and no note says writing goes on", (await h1.locator(".server-note").count()) === 0 && (await h1.getByRole("button", { name: "המשך כתיבה" }).count()) === 1, "");
    await placeholder(h1, 1).scrollIntoViewIfNeeded();
    a11y.push(...(await snap(h1, out, "writing-h1-lost")));
    const beforeH1 = db.queueCalls.length;
    await h1.getByRole("button", { name: "המשך כתיבה" }).click();
    await h1.getByText("השרת ממשיך לכתוב.").waitFor({ timeout: 10000 });
    await h1.locator(".server-note").waitFor({ timeout: 10000 });
    const tapH1 = db.queueCalls.slice(beforeH1);
    await h1.waitForFunction(() => document.querySelector("#part-1")?.textContent.includes("ממתין לתורו"), null, { timeout: 10000 }).catch(() => undefined);
    check("H1 the tap starts it over on the server: one restart, the note again, the part waits its turn, no phone writes", (await placeholder(h1, 1).innerText()).includes("ממתין לתורו") && tapH1.length === 1 && tapH1[0].p_retry_failed === true && db.retries[LH1] === 1 && !db.sectionCalls.some((c) => c.lectureId === LH1), JSON.stringify({ tapH1, r: db.retries[LH1] }));
    await h1.context().close();

    // ── H2 (W2): double dispatch: two phones tap at once, one of them twice ──
    const LH2 = lecture(32, "שתי לחיצות", { queued_at: now() }, [{ status: "ready", markdown: fx.parts[0] }, { status: "failed", error: "refusal", attempts: 1 }, { status: "ready", markdown: fx.parts[2] }]);
    const [{ page: h2a }, { page: h2b }] = await Promise.all([mock.open(browser, "שוהם", { path: `/?l=${LH2}` }), mock.open(browser, "נועה", { path: `/?l=${LH2}` })]);
    await Promise.all([h2a, h2b].map((pg) => pg.getByRole("button", { name: "המשך כתיבה" }).waitFor({ timeout: 10000 })));
    const beforeH2 = db.queueCalls.length;
    // Both taps leave before either answer comes back (the restart's realtime
    // update follows the first answer), as two phones tapping at once.
    const tapIn = (pg, times) =>
      pg.evaluate((n) => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "המשך כתיבה");
        for (let i = 0; i < n; i++) b?.click();
        return Boolean(b);
      }, times);
    const tapped = await Promise.all([tapIn(h2a, 1), tapIn(h2b, 2)]);
    await Promise.all([h2a, h2b].map((pg) => pg.getByText("השרת ממשיך לכתוב.").waitFor({ timeout: 10000 })));
    await h2b.waitForTimeout(800);
    await placeholder(h2b, 1).scrollIntoViewIfNeeded();
    a11y.push(...(await snap(h2b, out, "writing-h2-two-taps")));
    const tapsH2 = db.queueCalls.slice(beforeH2).filter((c) => c.p_lecture === LH2);
    const byH2 = (name) => tapsH2.filter((c) => c.by === mock.people[name].user.id).length;
    check(
      "H2 two phones at once (one tapped twice): a call a phone, one restart spent, no phone writes",
      tapped.every(Boolean) && byH2("שוהם") === 1 && byH2("נועה") === 1 && db.retries[LH2] === 1 && !db.sectionCalls.some((c) => c.lectureId === LH2),
      JSON.stringify({ tapped, shoham: byH2("שוהם"), noa: byH2("נועה"), restarts: db.retries[LH2] }),
    );
    const waitLines = await Promise.all([h2a, h2b].map((pg) => placeholder(pg, 1).innerText()));
    check(
      "H2 on both phones the part started over waits its turn, and nothing is left to tap",
      waitLines.every((t) => t.includes("ממתין לתורו") && t.includes("בתור")) && (await h2a.getByRole("button", { name: "המשך כתיבה" }).count()) + (await h2b.getByRole("button", { name: "המשך כתיבה" }).count()) === 0,
      JSON.stringify(waitLines),
    );
    await h2a.context().close();
    await h2b.context().close();

    // ── H3 (W2): an automatic retry counts its minutes down ──
    const LH3 = lecture(33, "ניסיון חוזר", { queued_at: now() }, [{ status: "ready", markdown: fx.parts[0] }, { status: "failed", error: "overloaded", attempts: 2, retry_at: minutes(4) }]);
    const { page: h3 } = await mock.open(browser, "שוהם");
    await h3.clock.install();
    await h3.goto(`${mock.base}/?l=${LH3}`);
    await placeholder(h3, 1).waitFor({ timeout: 10000 });
    const at4 = await placeholder(h3, 1).innerText();
    await h3.clock.fastForward("02:00");
    await h3.waitForFunction(() => document.querySelector("#part-1")?.textContent.includes("בעוד 2 דק׳"), null, { timeout: 10000 }).catch(() => undefined);
    const at2 = await placeholder(h3, 1).innerText();
    check("H3 the retry's minutes count down (4, then 2)", at4.includes("ניסיון חוזר אוטומטי בעוד 4 דק׳") && at2.includes("ניסיון חוזר אוטומטי בעוד 2 דק׳") && at2.includes("נעצר"), JSON.stringify({ at4, at2 }));
    await placeholder(h3, 1).scrollIntoViewIfNeeded();
    a11y.push(...(await snap(h3, out, "writing-h3-retry")));
    await h3.context().close();

    // ── H4 (W2): cancel: a lecture deleted while a phone writes it ──
    db.serverOn = false;
    db.sectionDelayMs = 2500;
    const LH4 = lecture(34, "נמחקה באמצע", {}, [{ status: "ready", markdown: fx.parts[0] }, {}, {}, {}]);
    const { page: h4 } = await mock.open(browser, "נועה", { path: `/?l=${LH4}` });
    const inFlight = () => db.sectionCalls.filter((c) => c.lectureId === LH4).length;
    for (let i = 0; i < 100 && inFlight() === 0; i++) await h4.waitForTimeout(100);
    const lh4 = db.lectures.find((l) => l.id === LH4);
    Object.assign(lh4, { deleted_at: now(), deleted_by: shoham }); // שוהם deletes it (study_delete_lecture)
    mock.notify("study_lectures", "UPDATE", lh4);
    await h4.getByText("ההרצאה הזו נמחקה או לא נמצאה").waitFor({ timeout: 10000 });
    await h4.waitForTimeout(6000); // the part in flight ends, and no other starts
    const h4Lines = await Promise.all([1, 2, 3].map((i) => placeholder(h4, i).innerText().catch(() => "")));
    check(
      "H4 deleted while written: the run stops at the part in flight, nothing is offered, every part says why",
      inFlight() === 1 &&
        (await h4.getByRole("button", { name: "המשך כתיבה" }).count()) === 0 &&
        h4Lines.every((t) => t.includes("הכתיבה נעצרה: ההרצאה נמחקה.") && t.includes("נעצר")) &&
        (await h4.locator(".a-error[role=alert]").allInnerTexts()).join("|") === "ההרצאה הזו נמחקה או לא נמצאה. אפשר לבדוק ב״נמחקו לאחרונה״.",
      JSON.stringify({ calls: inFlight(), h4Lines }),
    );
    // The footer of a deleted lecture: only the way to "נמחקו לאחרונה", nothing to mark, practise or delete again.
    const h4Foot = h4.locator(".lecture-foot");
    const footGone = async () =>
      (await h4Foot.getByRole("button", { name: /סימון שקראתי|קראתי/ }).count()) +
      (await h4Foot.getByRole("button", { name: "מחיקת ההרצאה" }).count()) +
      (await h4Foot.getByText("אחרי הקריאה: תרגול על ההרצאה").count());
    check(
      "H4 deleted: the footer offers only 'לספרייה · נמחקו לאחרונה' (no read mark, no practice, no delete)",
      (await footGone()) === 0 && (await h4Foot.getByRole("link", { name: "לספרייה · נמחקו לאחרונה" }).count()) === 1,
      await h4Foot.innerText(),
    );
    await placeholder(h4, 1).evaluate((el) => el.scrollIntoView({ block: "start" }));
    a11y.push(...(await snap(h4, out, "writing-h4-deleted")));
    await h4Foot.scrollIntoViewIfNeeded();
    a11y.push(...(await snap(h4, out, "writing-h4-deleted-foot")));
    // Restored ("שחזור"): the button is back, and the tap writes the rest from this phone.
    db.sectionDelayMs = 0;
    Object.assign(lh4, { deleted_at: null, deleted_by: null });
    mock.notify("study_lectures", "UPDATE", lh4);
    await h4.getByRole("button", { name: "המשך כתיבה" }).waitFor({ timeout: 10000 });
    await h4.getByRole("button", { name: "המשך כתיבה" }).click();
    await h4.locator('[data-part="3"]').waitFor({ timeout: 30000 });
    check(
      "H4 restored: המשך כתיבה writes the rest, no alert stays, and the footer's read mark and delete are back",
      [1, 2, 3].every((i) => db.sections.find((x) => x.lecture_id === LH4 && x.idx === i).status === "ready") &&
        (await h4.locator(".a-error[role=alert]").count()) === 0 &&
        (await h4Foot.getByRole("button", { name: "מחיקת ההרצאה" }).count()) === 1 &&
        (await h4Foot.getByRole("link", { name: "לספרייה · נמחקו לאחרונה" }).count()) === 0,
      JSON.stringify(db.sections.filter((x) => x.lecture_id === LH4).map((x) => x.status)),
    );
    await h4.context().close();
    // Deleted from this phone, mid-run: the reader goes to the library and the run ends.
    db.sectionDelayMs = 2500;
    const LH5 = lecture(35, "נמחקה מכאן", {}, [{ status: "ready", markdown: fx.parts[0] }, {}, {}, {}]);
    const { page: h5 } = await mock.open(browser, "נועה", { path: `/?l=${LH5}` });
    const inFlight5 = () => db.sectionCalls.filter((c) => c.lectureId === LH5).length;
    for (let i = 0; i < 100 && inFlight5() === 0; i++) await h5.waitForTimeout(100);
    await h5.getByRole("button", { name: "מחיקת ההרצאה" }).click();
    await h5.getByRole("button", { name: "מחיקה", exact: true }).click();
    await h5.waitForURL((u) => !u.searchParams.get("l"), { timeout: 10000 });
    await h5.waitForTimeout(6000);
    check("H4 deleted from this phone mid-run: no part after the one in flight", inFlight5() === 1 && Boolean(db.lectures.find((l) => l.id === LH5).deleted_at), String(inFlight5()));
    await h5.context().close();
    db.sectionDelayMs = 0;
    db.serverOn = true;

    // ── B1: the share sheet ──
    await page.goto(`${mock.base}/?l=${L2}`);
    await page.getByRole("button", { name: "שיתוף" }).click();
    const sheet = page.locator('[role="dialog"][aria-label="שיתוף הסיכום"]');
    await sheet.waitFor({ timeout: 10000 });
    const names = await sheet.locator(".share-option .share-title").allInnerTexts();
    const pdfOff = all ? await sheet.locator(".share-option", { hasText: "קובץ PDF" }).isDisabled() : true;
    const printOff = await sheet.locator(".share-option", { hasText: "הדפסה מהמכשיר" }).isDisabled();
    check(
      "B1 the sheet's options; the PDF and printing wait for every part",
      JSON.stringify(names) === JSON.stringify(all ? ["קישור לסיכום", "קובץ PDF", "הדפסה מהמכשיר"] : ["קישור לסיכום", "הדפסה מהמכשיר"]) && pdfOff && printOff,
      JSON.stringify({ names, pdfOff, printOff }),
    );
    a11y.push(...(await snap(page, out, "writing-7-share-waiting")));
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached", timeout: 10000 });

    // ── B2-B4: the server's PDF (VITE_STUDY_PDF) ──
    if (all) {
      await page.goto(`${mock.base}/?l=${L1}`);
      await page.evaluate(() => {
        window.__shared = [];
        navigator.canShare = (d) => Boolean(d && d.files && d.files.length);
        navigator.share = async (d) => {
          window.__shared.push((d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })));
        };
      });
      await page.getByRole("button", { name: "שיתוף" }).click();
      await sheet.waitFor({ timeout: 10000 });
      await sheet.locator(".share-option", { hasText: "קובץ PDF" }).click();
      await sheet.getByText("ה-PDF מוכן: 9 עמודים").waitFor({ timeout: 20000 });
      const html = db.pdfBodies.at(-1)?.html ?? "";
      const tocIds = [...html.matchAll(/data-pg="([^"]+)"/g)].map((m) => m[1]);
      const headings = db.sections.filter((s) => s.lecture_id === L1).reduce((n, s) => n + (s.markdown.match(/^#{2,3} /gm) || []).length, 0);
      check(
        "B2 the layout sent: print-doc, the title page, a page number per ## and ###, eager pictures, no buttons",
        db.pdfBodies.at(-1)?.lectureId === L1 &&
          html.startsWith('<div class="print-doc"') &&
          html.includes('class="pd-title"') &&
          html.includes("סיכום הרצאה · תמצית") &&
          tocIds.length === headings &&
          html.includes('id="p-s0-h0"') &&
          !/loading="lazy"/.test(html) &&
          !/note-dot|note-add|room-bar/.test(html),
        JSON.stringify({ tocIds: tocIds.length, headings, start: html.slice(0, 40) }),
      );
      a11y.push(...(await snap(page, out, "writing-8-pdf-ready")));
      await sheet.getByRole("button", { name: "שליחה" }).click();
      await page.waitForFunction(() => window.__shared.length > 0, null, { timeout: 10000 });
      const shared = await page.evaluate(() => window.__shared);
      check("B3 שליחה hands one PDF, named after the lecture, to the share sheet", shared.length === 1 && shared[0].length === 1 && shared[0][0].type === "application/pdf" && shared[0][0].name === pdfName(l1.title), JSON.stringify(shared));
      // A browser that cannot share files: only "שמירה", which downloads.
      const { page: p4 } = await mock.open(browser, "שוהם", { path: `/?l=${L1}` });
      await p4.evaluate(() => {
        delete Navigator.prototype.canShare;
        navigator.canShare = undefined;
      });
      await p4.getByRole("button", { name: "שיתוף" }).click();
      const sheet4 = p4.locator('[role="dialog"][aria-label="שיתוף הסיכום"]');
      await sheet4.locator(".share-option", { hasText: "קובץ PDF" }).click();
      await sheet4.getByText("ה-PDF מוכן: 9 עמודים").waitFor({ timeout: 20000 });
      const onlySave = (await sheet4.getByRole("button", { name: "שליחה" }).count()) === 0;
      const [download] = await Promise.all([p4.waitForEvent("download", { timeout: 10000 }), sheet4.getByRole("button", { name: "שמירה" }).click()]);
      // A Hebrew name downloads as "download" in Chromium: the file is saved under the ASCII fallback.
      check("B4 without file sharing, שמירה downloads the PDF", onlySave && /^tamtzit-\d{4}-\d{2}-\d{2}\.pdf$/.test(download.suggestedFilename()), download.suggestedFilename());
      await p4.context().close();
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached", timeout: 10000 });
    }

    // ── B5: printing on the device ──
    await page.goto(`${mock.base}/?l=${L1}`);
    await page.evaluate(() => {
      window.__printed = 0;
      window.print = () => {
        window.__printed += 1;
      };
    });
    await page.getByRole("button", { name: "שיתוף" }).click();
    await sheet.waitFor({ timeout: 10000 });
    await sheet.locator(".share-option", { hasText: "הדפסה מהמכשיר" }).click();
    await page.waitForFunction(() => window.__printed > 0, null, { timeout: 15000 });
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    const printed = await page.evaluate(() => ({
      paragraph: getComputedStyle(document.querySelector(".print-doc .summary p")).color,
      doc: document.querySelector(".print-doc").checkVisibility(),
      head: document.querySelector(".ph-head").checkVisibility(),
      pageNumbers: [...document.querySelectorAll(".print-doc .pd-pg")].some((el) => el.checkVisibility()),
      local: document.querySelector(".print-doc").classList.contains("pd-local"),
      css: Boolean(document.getElementById("study-print-css")),
    }));
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
    check(
      "B5 printing here: the layout alone, ink paragraphs in dark mode, no page numbers of ours",
      printed.paragraph === "rgb(29, 33, 40)" && printed.doc && !printed.head && !printed.pageNumbers && printed.local && printed.css,
      JSON.stringify(printed),
    );
    a11y.push(...(await snap(page, out, "writing-9-share")));
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached", timeout: 10000 });
    check("B5 the print stylesheet leaves with the sheet", (await page.locator("#study-print-css").count()) === 0 && (await page.locator(".print-doc").count()) === 0, "");

    // ── C3: the recording's notes (VITE_STUDY_RECORDINGS) ──
    if (all) {
      mock.seedLecture();
      const L = mock.LECTURE_ID;
      db.recordings.push({ id: "aaaaaaaa-0000-4000-8000-0000000000a1", lecture_id: L, source: "file", source_name: "zoom.vtt", link_url: null, duration_s: 6700, has_times: true, status: "ready", created_by: shoham });
      db.recordingNotes.push({
        id: "aaaaaaaa-0000-4000-8000-0000000000a2", lecture_id: L, part_idx: 1, status: "ready", error: null, lease_until: null,
        items: [
          { anchor: 3, quote: "", at_s: 2470, text: "בהרצאה הוסבר שזה הבסיס לכל המשתנים בהמשך." },
          { anchor: -1, quote: "", at_s: null, text: "בהרצאה נאמר שהחלק הזה יופיע במבחן." },
        ],
      });
      db.comments.push({ id: "c0000002-0000-4000-8000-000000000002", lecture_id: L, part_idx: 1, anchor: 4, quote: "", kind: "comment", body: "הערה על הפסקה", parent_id: null, resolved: false, author_id: shoham, created_at: now() });
      const { page: pr } = await mock.open(browser, "שוהם", { path: `/?l=${L}` });
      await pr.locator('[data-part="1"] aside.rec-note').first().waitFor({ timeout: 15000 });
      const notes = await pr.evaluate((anchor) => {
        const part = document.querySelector('[data-part="1"] .summary');
        const after3 = part.querySelector('[data-blk="3"] + aside.rec-note');
        return {
          after3: after3 ? after3.innerText : "",
          lastIsBox: part.lastElementChild.matches("aside.rec-note") && part.lastElementChild.innerText.includes("יופיע במבחן"),
          anchors: [...part.querySelectorAll("[data-blk]")].map((el) => el.getAttribute("data-blk")).join(","),
          boxesHaveNoAnchor: [...part.querySelectorAll("aside.rec-note")].every((el) => !el.hasAttribute("data-blk")),
          // With package N (every flag on) the comment count is the chip row's under ¶4, not the dot in it.
          commentOn4: Boolean(part.querySelector(anchor ? '.n-anchor[data-spot="1.4"] [data-chip="comments"]' : '[data-blk="4"] .note-dot')),
        };
      }, flags.anchor);
      const { page: plain } = await mock.open(browser, "שוהם", { path: `/?l=${L}`, storage: { "study-rec-notes": "0" } });
      await plain.locator('[data-part="1"] .summary').waitFor({ timeout: 15000 });
      await plain.waitForTimeout(1000);
      const anchorsWithout = await plain.evaluate(() => [...document.querySelectorAll('[data-part="1"] .summary [data-blk]')].map((el) => el.getAttribute("data-blk")).join(","));
      const hidden = (await plain.locator("aside.rec-note").count()) === 0;
      check("C3 a box after ¶3 with its time, the part's box last", notes.after3.includes("מההקלטה") && notes.after3.includes("41:10") && notes.lastIsBox, JSON.stringify(notes));
      check("C3 the anchors do not move, and a comment stays on ¶4", notes.anchors === anchorsWithout && notes.boxesHaveNoAnchor && notes.commentOn4, JSON.stringify({ with: notes.anchors, without: anchorsWithout }));
      check("C3 the setting on שלי hides the boxes", hidden, "");
      await pr.locator('[data-part="1"] aside.rec-note').first().scrollIntoViewIfNeeded();
      a11y.push(...(await snap(pr, out, "writing-10-notes")));
      await pr.context().close();
      await plain.context().close();
    }

    // ── H5 (W2): no phone wrote a part or a lecture's writing state ──
    const partWrites = mock.calls.filter((c) => / (POST|PATCH|DELETE|PUT) \/rest\/v1\/study_sections\b/.test(c));
    const lectureWrites = mock.calls.filter((c) => / (PATCH|DELETE|PUT) \/rest\/v1\/study_lectures\b/.test(c));
    const uploads = mock.calls.filter((c) => / POST \/rest\/v1\/study_lectures\b/.test(c));
    // The uploads (A1, A4) inserted their lectures with the columns a member may insert:
    // the mock refuses any other (db.refusedWrites), as the grants do since W2.
    check(
      "H5 in the whole run no phone wrote a part or a lecture's writing state; the uploads' inserts passed the grants",
      partWrites.length === 0 && lectureWrites.length === 0 && uploads.length === 2 && !(db.refusedWrites ?? []).length,
      JSON.stringify({ partWrites: partWrites.slice(0, 3), lectureWrites: lectureWrites.slice(0, 3), uploads: uploads.length, refused: db.refusedWrites }),
    );
    // A member's own token, straight at the table: refused as PostgREST does after W2.
    const { page: probe } = await mock.open(browser, "נועה", { path: "/" });
    const noa = mock.people["נועה"].token;
    const answers = await probe.evaluate(
      async ([sbUrl, token, lid]) => {
        const h = { apikey: "anon", Authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: "return=minimal" };
        const out = [];
        for (const [method, path, body] of [
          ["PATCH", `/rest/v1/study_sections?lecture_id=eq.${lid}&idx=eq.0`, { markdown: "שוכתב" }],
          ["DELETE", `/rest/v1/study_sections?lecture_id=eq.${lid}`, null],
          ["PATCH", `/rest/v1/study_lectures?id=eq.${lid}`, { status: "ready" }],
          ["POST", "/rest/v1/study_lectures", { id: "eeeeeeee-0000-4000-8000-0000000000f9", group_id: "x", title: "x", source_kind: "pptx", slides: [], retries: -1000000 }],
        ]) {
          const r = await fetch(`${sbUrl}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
          out.push(`${r.status} ${(await r.json().catch(() => ({}))).code ?? ""}`);
        }
        return out;
      },
      [mock.SB ?? "https://mock.supabase.test", noa, LH1],
    );
    check(
      "H5 a member's direct writes are refused: a part's text, its deletion, the writing state, an insert with a restart count",
      JSON.stringify(answers) === JSON.stringify(["403 42501", "403 42501", "403 42501", "403 42501"]) && db.sections.find((x) => x.lecture_id === LH1 && x.idx === 0).markdown === fx.parts[0] && !db.lectures.some((l) => l.id === "eeeeeeee-0000-4000-8000-0000000000f9"),
      JSON.stringify({ answers }),
    );
    // Those four refusals were this probe's own: take them out of the run's problems.
    for (let i = mock.problems.length - 1; i >= 0; i--) if (mock.problems[i].startsWith("a member's write the grants refuse")) mock.problems.splice(i, 1);
    await probe.context().close();

    const unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    const failed = Object.entries(steps).filter(([, v]) => v !== "ok");
    console.log(JSON.stringify({ flags: flagSet, errors: problems, unmocked, steps, a11y }, null, 1));
    if (problems.length || unmocked.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, calls: mock.calls.slice(-20), steps }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();

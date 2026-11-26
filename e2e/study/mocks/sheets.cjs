// Uploaded sheets' part of the e2e mock (docs/study/sheets.md; section O 1,
// release A0, VITE_STUDY_SHEETS). The upload, the reading and the review of
// a sheet are past exams' RPCs and op, so mocks/exams.cjs plays them
// (study_sheet_create, op exam_read with a sheet's bounds, study_exam_key_set,
// the course page's kind and lecture). The shared mock loads every plugin, and
// this one changes nothing by itself: it adds a lever for the scripts that
// look at a ready sheet's screens without uploading one (sheets.cjs,
// devices.cjs, wide.cjs):
//
//   const sheet = db.sheetsMock.seed({ course, title, lecture, images, keySource });
//
// A ready "דף תרגילים" of the course as the reading leaves it: the synthetic
// sheet's 5 pages of questions (fixtures/sheet/sheet6.json, its cover page left
// out, as "להוריד אותו" does), each page's text lines as a text PDF gives them
// (the exactness check's ground), the exam reader's replies saved
// (release A0: the choice items, the 8-option item refused, 4 open or numeric
// items counted as skipped), and, as the fixture has it, its 2-page answers
// file read by number (keySource "separate", the default: the one-answer items
// keyed, the true/false and match ones left to key by hand; "marked" or
// "none": no answers file). `images` are the pages' JPEGs in order
// (fixtures/make-sheet.cjs pageShots, without the cover); with none, each page
// is a 1×1 picture. `lecture` is one lecture's id, or none (a
// question bank). The units run at once through the exams mock's worker, so
// the sheet is ready when seed returns.
const fs = require("fs");
const path = require("path");

const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "sheet", "sheet6.json"), "utf8"));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A 1×1 picture, for a page with no picture given (a browser reads it whatever the name says).
const DOT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

module.exports = {
  seed(db) {
    db.sheetsMock = {
      /** A ready sheet of the course (see above). Returns its study_exams row. */
      seed(o = {}) {
        const M = db.examsMock;
        if (!M) throw new Error("mocks/sheets.cjs needs mocks/exams.cjs");
        const id = hex("e0e00000", ++M.seq);
        const prefix = `${db.group.id}/exams/${id}/`;
        const body = SHEET.pages.filter((p) => !p.cover);
        const keySource = o.keySource ?? "separate";
        // A text PDF's lines: the printed words (a drawn graph has none of its own here).
        const row = (p, n, key) => ({ n, path: `${prefix}p${n}.jpg`, w: 1500, h: 2121, lines: p.lines.filter((l) => !l.startsWith("[[figure")), key });
        const pageRows = body.map((p, i) => row(p, i + 1, false));
        if (keySource === "separate") SHEET.answers.pages.forEach((p, i) => pageRows.push(row(p, body.length + i + 1, true)));
        pageRows.forEach((r, i) => db.files.set(r.path, o.images?.[i] ? fs.readFileSync(o.images[i]) : DOT));
        const e = {
          id, group_id: db.group.id, course: o.course, title: o.title ?? SHEET.title, year: null, moed: null, minutes: null, key_source: keySource,
          kind: "sheet", lecture_id: o.lecture ?? null, status: "reading", error: null, skipped_open: 0, hide_from_profile: true, deleted_at: null, n_questions: 0,
          created_by: o.by ?? db.members[0].user_id, created_at: o.created_at ?? new Date(M.now() - 3_600_000).toISOString(), retries: 0,
          pages: body.length, key_pages: pageRows.length - body.length, pageRows,
        };
        M.exams.push(e);
        const reads = pageRows.filter((r) => !r.key).map((r) => r.n);
        for (let i = 0; i < reads.length; i += 4) M.units.push({ exam_id: id, kind: "read", pages: reads.slice(i, i + 4), items: [], status: "pending", error: null, reread: false });
        const keys = pageRows.filter((r) => r.key).map((r) => r.n);
        if (keys.length) M.units.push({ exam_id: id, kind: "key", pages: keys, items: [], status: "pending", error: null, reread: false });
        for (let n = 0; n < 200 && e.status === "reading"; n++) M.tick();
        if (e.status !== "ready") throw new Error(`the seeded sheet is ${e.status}`);
        return e;
      },
    };
  },
};

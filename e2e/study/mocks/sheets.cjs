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
// the sheet is ready when seed returns. With `forms: true` the sheet is read
// by release A1's sheet reader instead (3-page units, every item as printed:
// fixtures/sheet/sheet6.json truth; with keySource "none" every answer is
// suggested), and `pause: true` leaves it held by the budget before its
// suggested answers (design D23).
//
// Release A1's member RPCs (section O 2; VITE_STUDY_SHEETS_FORMS), played as
// the SQL does: study_sheet_review (S's review, the kind, lecture, reader,
// held units, open-add's progress, and each item's label, boxes, exactness,
// series and step, number, model answer, rubric, worked solution), the item's
// fix (only its text once anyone answered or marked it: 'answered'; 'label
// taken'), add (after its page's last item), retire and its undo (by whoever
// took it out, or anyone within 24 h: 'not yours'), study_item_solution
// (origin member, logged), study_answer_value (a numeric answer at $0 within
// its tolerance, a study_answers row with its value), study_open_show and
// study_open_mark (the member's own marks, never an answer row: OD8),
// study_question_solution (after answering) and study_sheet_progress.
// Levers on db.examsMock: pauseSolve, openMarks; calls has every one.
const fs = require("fs");
const path = require("path");

const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "sheet", "sheet6.json"), "utf8"));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A 1×1 picture, for a page with no picture given (a browser reads it whatever the name says).
const DOT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

const SHEET_RPCS = new Set([
  "study_sheet_review", "study_exam_item_fix", "study_exam_item_add", "study_exam_item_retire", "study_exam_item_unretire", "study_item_solution",
  "study_answer_value", "study_qset_answer_value", "study_open_show", "study_open_mark", "study_question_solution", "study_sheet_progress",
]);
const labelKey = (s) => String(s ?? "").replace(/[\s.'"׳״()-]+/g, "").toLowerCase();

module.exports = {
  async rest({ method, path: p, body, who, db, json: reply, refuse: deny, check }) {
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(p);
    if (!m || !SHEET_RPCS.has(m[1]) || !db.examsMock) return undefined;
    const fn = m[1];
    const M = db.examsMock;
    const P = db.practice;
    check.rpc(fn, body, `${method} ${p}`);
    M.calls.push({ fn, who: who?.id ?? null, body });
    const json = async (b, st) => (await reply(b, st), true);
    const refuse = async (msg, st) => (await deny(msg, st), true);
    const me = who?.id ?? null;
    if (!me) return refuse("not signed in");
    const member = db.members.some((x) => x.user_id === me);
    const now = new Date(M.now()).toISOString();
    const nameOf = (uid) => db.members.find((x) => x.user_id === uid)?.name ?? null;
    const examOf = (id) => {
      const e = M.exams.find((x) => x.id === id);
      return member && e && !e.deleted_at && (e.kind !== "sheet" || M.sheetsOn) ? e : null;
    };
    const itemOf = (id) => {
      const q = P.questions.find((x) => x.id === id && x.source === "exam");
      return q && examOf(q.exam_id) ? q : null;
    };
    const key = (q) => P.keys.get(q.id);
    const used = (q) => P.answers.some((a) => a.question_id === q.id) || M.openMarks.some((x) => x.question_id === q.id);
    const count = (e) => (e.n_questions = P.questions.filter((q) => q.exam_id === e.id && !q.retired_at).length);
    const keyed = (q) => M.hasKey(q);
    const log = (q, field, old, neu) => M.itemLog.push({ id: M.itemLog.length + 1, question_id: q.id, exam_id: q.exam_id, field, idx: null, old, new: neu, member_id: me, at: now });
    switch (fn) {
      case "study_sheet_review": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        const units = M.units.filter((u) => u.exam_id === e.id);
        const held = units.filter((u) => u.held && u.status === "failed");
        const extra = units.filter((u) => u.kind === "read" && u.extra);
        const items_extra = {};
        for (const q of P.questions.filter((x) => x.exam_id === e.id)) {
          const k = key(q) ?? {};
          items_extra[q.id] = {
            label: q.no_label ?? String(q.exam_no),
            figures: q.figures ?? (q.figure ? [q.figure] : []),
            exact: q.exact ?? null,
            series: q.series ?? null,
            step: q.step ?? null,
            form: q.form,
            retired_by: q.retired_by ? nameOf(q.retired_by) : null,
            retired_at: q.retired_at ?? null,
            num: k.num ?? null,
            num_unit: k.num_unit ?? null,
            num_tol: k.num_tol ?? null,
            model_answer: k.model_answer ?? null,
            rubric: k.rubric ?? [],
            solution: k.solution ?? null,
            solution_origin: k.solution_origin ?? null,
            solution_conf: null,
            locked: M.openMarks.some((x) => x.question_id === q.id) || P.answers.some((a) => a.question_id === q.id),
          };
        }
        const lec = db.lectures.find((l) => l.id === e.lecture_id && !l.deleted_at);
        return json({
          ...M.reviewOf(e),
          kind: e.kind ?? "exam",
          lecture: lec ? { id: lec.id, title: lec.title } : null,
          reader: e.reader === "sheet" ? "sheet" : "exam",
          skipped_open: e.skipped_open ?? 0,
          paused: held.length ? { read: held.filter((u) => u.kind === "read").length, key: held.filter((u) => u.kind === "key").length, solve: held.filter((u) => u.kind === "solve").length } : null,
          extra: extra.length ? { units: extra.length, done: extra.filter((u) => u.status === "done").length, copied: extra.reduce((n, u) => n + (u.copied ?? 0), 0) } : null,
          items_extra,
        });
      }
      case "study_exam_item_fix": {
        const q = itemOf(body.p_question);
        if (!q) return refuse("question not found");
        const patch = body.p_patch ?? {};
        const keys = Object.keys(patch);
        if (!keys.length || keys.some((k) => !["label", "form", "vignette", "question", "options", "prompts", "figures"].includes(k))) return refuse("bad item");
        const n = { ...q, layout: q.layout ? { ...q.layout } : null };
        if ("label" in patch) {
          n.no_label = String(patch.label).trim();
          n.no_key = labelKey(n.no_label);
          if (!n.no_label || n.no_label.length > 20) return refuse("bad item");
        }
        if ("form" in patch) n.form = patch.form;
        if ("vignette" in patch) n.vignette = String(patch.vignette ?? "").trim();
        if ("question" in patch) n.question = String(patch.question ?? "").trim();
        if ("options" in patch) n.options = (patch.options ?? []).map((o) => String(o).trim());
        if ("prompts" in patch) n.layout = { kind: "match", prompts: patch.prompts.map((x) => String(x).trim()) };
        if ("figures" in patch) {
          if (!Array.isArray(patch.figures) || patch.figures.length > 4 || patch.figures.some((f) => !/^pg:\d+:\d+,\d+,\d+,\d+$/.test(f))) return refuse("bad item");
          n.figures = patch.figures;
          n.figure = patch.figures[0] ?? "";
        }
        if (!["one", "tf", "match", "open", "numeric"].includes(n.form)) return refuse("bad item");
        if (n.form === "open" || n.form === "numeric") n.options = [];
        if (n.form !== "match") n.layout = null;
        else if (!n.layout) return refuse("bad item");
        if (n.question.length < 2 || n.question.length > 4000 || n.options.some((o) => !o || o.length > 1000)) return refuse("bad item");
        if ((n.form === "one" && (n.options.length < 2 || n.options.length > 10)) || ((n.form === "tf" || n.form === "match") && (n.options.length < 2 || n.options.length > 6))) return refuse("bad item");
        if (used(q) && (n.form !== q.form || n.options.length !== q.options.length || (n.layout?.prompts ?? []).length !== (q.layout?.prompts ?? []).length)) return refuse("answered");
        if (n.no_key !== q.no_key && P.questions.some((x) => x.exam_id === q.exam_id && x.id !== q.id && x.no_key === n.no_key)) return refuse("label taken");
        const fields = { label: "no_label", form: "form", vignette: "vignette", question: "question", options: "options", prompts: "layout", figures: "figures" };
        for (const f of keys) {
          const a = JSON.stringify(q[fields[f]] ?? null);
          const b = JSON.stringify(n[fields[f]] ?? null);
          if (a !== b) log(q, f, a, b);
        }
        const reform = n.form !== q.form || n.options.length !== q.options.length;
        Object.assign(q, { no_label: n.no_label, no_key: n.no_key, form: n.form, kind: n.vignette ? "case" : "mcq", vignette: n.vignette, question: n.question, options: n.options, layout: n.layout, figures: n.figures, figure: n.figure, exact: null });
        const k = key(q);
        if (reform && k && k.origin !== "member") Object.assign(k, { answer: null, seq: null, num: n.form === "numeric" ? k.num : null, model_answer: n.form === "open" ? k.model_answer : null, origin: null, conf: null });
        q.has_key = keyed(q);
        return json({ id: q.id, label: q.no_label, form: q.form, vignette: q.vignette, question: q.question, options: q.options, prompts: q.layout?.prompts ?? [], figures: q.figures ?? [], has_key: q.has_key });
      }
      case "study_exam_item_add": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        const it = body.p_item ?? {};
        const label = String(it.label ?? "").trim();
        const form = it.form ?? "one";
        const page = Number(it.page);
        if (!label || label.length > 20 || !["one", "tf", "match", "open", "numeric"].includes(form) || String(it.question ?? "").trim().length < 2) return refuse("bad item");
        if (!(e.pageRows ?? []).some((x) => x.n === page && !x.key)) return refuse("bad item");
        const options = form === "open" || form === "numeric" ? [] : (it.options ?? []).map((o) => String(o).trim());
        if (form !== "open" && form !== "numeric" && (options.length < 2 || options.some((o) => !o))) return refuse("bad item");
        if (P.questions.some((x) => x.exam_id === e.id && x.no_key === labelKey(label))) return refuse("label taken");
        const taken = P.questions.filter((x) => x.exam_id === e.id && x.exam_no >= page * 100 && x.exam_no < page * 100 + 100).map((x) => x.exam_no);
        const no = e.kind === "sheet" ? (taken.length ? Math.max(...taken) + 1 : page * 100) : Number(label);
        const q = {
          id: `e5e00000-0000-4000-8000-${String(++M.seq).padStart(12, "0")}`, created_at: now, has_key: false, group_id: e.group_id, lecture_id: null, batch_id: null, exam_id: e.id, exam_no: no,
          ref_lecture: e.lecture_id ?? null, source: "exam", part_idx: null, kind: it.vignette ? "case" : "mcq", difficulty: 2, vignette: String(it.vignette ?? "").trim(), question: String(it.question).trim(),
          options, slides: [], topic: "", aspect: "other", model: "member", created_by: me, retired_at: null, retired_by: null, retire_note: "", anchor: null, quote: "", part_gen: null, teaser: "",
          figure: (it.figures ?? [])[0] ?? "", figures: it.figures ?? [], option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, form,
          layout: form === "match" ? { kind: "match", prompts: it.prompts ?? [] } : null, series: null, step: null, parse_conf: 3, page, no_label: label, no_key: labelKey(label), exact: null,
        };
        P.questions.push(q);
        P.keys.set(q.id, { answer: null, seq: null, explanations: options.map(() => ""), takeaway: "", origin: null, conf: null, by: null, num: null, num_unit: null, num_tol: null, model_answer: null, rubric: [], solution: null, solution_origin: null });
        log(q, "added", "", label);
        count(e);
        return json(q.id);
      }
      case "study_exam_item_retire": {
        const q = itemOf(body.p_question);
        if (!q) return refuse("question not found");
        if (q.retired_at) return refuse("retired");
        Object.assign(q, { retired_at: now, retired_by: me, retire_note: String(body.p_note ?? "").slice(0, 300) });
        log(q, "retired", "", q.retire_note);
        count(M.exams.find((x) => x.id === q.exam_id));
        return json(null);
      }
      case "study_exam_item_unretire": {
        const q = itemOf(body.p_question);
        if (!q) return refuse("question not found");
        if (!q.retired_at) return refuse("not retired");
        if (q.retired_by !== me && Date.parse(q.retired_at) < M.now() - 86_400_000) return refuse("not yours");
        Object.assign(q, { retired_at: null, retired_by: null, retire_note: "" });
        log(q, "unretired", "", "");
        count(M.exams.find((x) => x.id === q.exam_id));
        return json(null);
      }
      case "study_item_solution": {
        const q = itemOf(body.p_question);
        if (!q) return refuse("question not found");
        const patch = body.p_patch ?? {};
        const keys = Object.keys(patch);
        if (!keys.length || keys.some((k) => !["num", "num_unit", "num_tol", "model_answer", "rubric", "solution"].includes(k))) return refuse("bad answer");
        const k = key(q);
        const ans = keys.some((x) => x !== "solution");
        if (("num" in patch || "num_unit" in patch || "num_tol" in patch) && q.form !== "numeric") return refuse("bad answer");
        if (("model_answer" in patch || "rubric" in patch) && q.form !== "open") return refuse("bad answer");
        if ("num" in patch && typeof patch.num !== "number") return refuse("bad answer");
        if ("num_tol" in patch && !(patch.num_tol >= 0 && patch.num_tol <= 50)) return refuse("bad answer");
        if ("rubric" in patch && (!Array.isArray(patch.rubric) || patch.rubric.length > 6)) return refuse("bad answer");
        const before = JSON.stringify({ num: k.num, num_unit: k.num_unit, num_tol: k.num_tol, model_answer: k.model_answer, rubric: k.rubric, solution: k.solution });
        if ("num" in patch) k.num = patch.num;
        if ("num_unit" in patch) k.num_unit = String(patch.num_unit ?? "").trim() || null;
        if ("num_tol" in patch) k.num_tol = patch.num_tol;
        if ("model_answer" in patch) k.model_answer = String(patch.model_answer).trim();
        if ("rubric" in patch) k.rubric = patch.rubric;
        if ("solution" in patch) Object.assign(k, { solution: String(patch.solution ?? "").trim() || null, solution_origin: String(patch.solution ?? "").trim() ? "member" : null });
        if (ans && ((q.form === "numeric" && (k.num === null || k.num === undefined)) || (q.form === "open" && !k.model_answer))) return refuse("bad answer");
        if (ans) Object.assign(k, { origin: "member", conf: null, by: me, num_tol: q.form === "numeric" ? (k.num_tol ?? 1) : k.num_tol });
        M.keyLog.push({ id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: null, new: null, origin_old: null, origin_new: "member", conf_old: null, by_old: null, undo_of: null, member_id: me, at: now, old_text: before, new_text: JSON.stringify({ num: k.num, num_unit: k.num_unit, num_tol: k.num_tol, model_answer: k.model_answer, rubric: k.rubric, solution: k.solution }) });
        q.has_key = keyed(q);
        return json({ num: k.num, num_unit: k.num_unit, num_tol: k.num_tol, model_answer: k.model_answer, rubric: k.rubric, solution: k.solution, origin: k.origin, solution_origin: k.solution_origin });
      }
      case "study_qset_answer_value":
      case "study_answer_value": {
        // Inside a practice set's attempt (O 3's wrapper): L's attempt check, then the same answer, stamped.
        const attempt = fn === "study_qset_answer_value" ? db.qsetsMock?.attemptFor(me, body.p_attempt, body.p_question) : null;
        if (fn === "study_qset_answer_value" && !db.qsetsMock) return refuse("off");
        if (attempt?.error) return refuse(attempt.error);
        const q = P.questions.find((x) => x.id === body.p_question);
        if (!q || !member) return refuse("question not found");
        if (q.retired_at) return refuse("retired");
        if (!["lecture", "course", "mistakes", "exam"].includes(body.p_mode ?? "exam")) return refuse("bad mode");
        if (q.form !== "numeric") return refuse("not a numeric question");
        const k = key(q);
        if (!k || k.num === null || k.num === undefined) return refuse("no key");
        const v = body.p_value === null || body.p_value === undefined ? null : Number(body.p_value);
        const tol = (Math.abs(k.num) * (k.num_tol ?? 1)) / 100;
        const correct = v !== null && Math.abs(v - k.num) <= Math.max(tol, 1e-12);
        P.answers.push({ user_id: me, question_id: q.id, choice: null, value: v, correct, mode: body.p_mode ?? "exam", ms: body.p_ms ?? null, confidence: null, answered_at: now, set_attempt: attempt?.id ?? null });
        return json({ correct, num: k.num, unit: k.num_unit ?? null, tol: k.num_tol ?? 1, solution: k.solution ?? null, origin: k.origin ?? null, conf: k.conf ?? null, solution_origin: k.solution_origin ?? null });
      }
      case "study_open_show": {
        const q = P.questions.find((x) => x.id === body.p_question);
        if (!q || !member) return refuse("question not found");
        if (q.retired_at) return refuse("retired");
        if (q.form !== "open") return refuse("not an open question");
        const k = key(q) ?? {};
        M.openMarks.push({ user_id: me, question_id: q.id, shown_at: now, self_mark: null });
        return json({ model_answer: k.model_answer ?? null, rubric: k.rubric ?? [], solution: k.solution ?? null, origin: k.origin ?? null, conf: k.conf ?? null, solution_origin: k.solution_origin ?? null });
      }
      case "study_open_mark": {
        if (![0, 1, 2].includes(body.p_mark)) return refuse("bad mark");
        const row = [...M.openMarks].reverse().find((x) => x.user_id === me && x.question_id === body.p_question);
        if (!row) return refuse("not shown");
        Object.assign(row, { self_mark: body.p_mark, marked_at: now });
        return json(null);
      }
      case "study_question_solution": {
        const q = P.questions.find((x) => x.id === body.p_question);
        if (!q || !member) return refuse("question not found");
        const k = key(q) ?? {};
        if (!P.answers.some((a) => a.question_id === q.id && a.user_id === me) && !M.openMarks.some((x) => x.question_id === q.id && x.user_id === me)) return json(null);
        return json({ solution: k.solution ?? null, solution_origin: k.solution_origin ?? null, solution_conf: null, answer: k.answer ?? null, seq: k.seq ?? null, num: k.num ?? null, num_unit: k.num_unit ?? null, num_tol: k.num_tol ?? null, model_answer: k.model_answer ?? null, rubric: k.rubric ?? [], origin: k.origin ?? null, conf: k.conf ?? null });
      }
      case "study_sheet_progress": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        const items = P.questions.filter((q) => q.exam_id === e.id && !q.retired_at);
        const ids = new Set(items.map((q) => q.id));
        const last = new Map();
        for (const a of P.answers.filter((x) => x.user_id === me && ids.has(x.question_id))) last.set(a.question_id, a);
        const marks = new Map();
        for (const x of M.openMarks.filter((y) => y.user_id === me && ids.has(y.question_id))) marks.set(x.question_id, x);
        const ms = [...marks.values()];
        return json({ items: items.length, open: items.filter((q) => q.form === "open").length, answered: last.size, right: [...last.values()].filter((a) => a.correct).length, shown: ms.length, self: { right: ms.filter((x) => x.self_mark === 2).length, partly: ms.filter((x) => x.self_mark === 1).length, wrong: ms.filter((x) => x.self_mark === 0).length } });
      }
    }
    return undefined;
  },

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
        const size = o.forms ? 3 : 4;
        if (o.forms) e.reader = "sheet";
        const reader = o.forms ? { reader: "sheet" } : {};
        for (let i = 0; i < reads.length; i += size) M.units.push({ exam_id: id, kind: "read", pages: reads.slice(i, i + size), items: [], status: "pending", error: null, reread: false, ...reader });
        const keys = pageRows.filter((r) => r.key).map((r) => r.n);
        if (keys.length) M.units.push({ exam_id: id, kind: "key", pages: keys, items: [], status: "pending", error: null, reread: false, ...reader });
        const pause = M.pauseSolve;
        if (o.pause) M.pauseSolve = true;
        for (let n = 0; n < 200 && e.status === "reading" && e.error !== "budget"; n++) M.tick();
        if (o.pause) M.pauseSolve = pause;
        if (e.status !== (o.pause ? "reading" : "ready")) throw new Error(`the seeded sheet is ${e.status}`);
        return e;
      },
    };
  },
};

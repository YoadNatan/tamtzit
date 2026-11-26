// Past exams' part of the e2e mock (docs/study/sources.md, phase 2; section S 2).
// The shared mock loads it for every script, so a build with VITE_STUDY_EXAMS
// finds its RPCs in any flow. It plays section S 2 and the server as the SQL
// and server/study/exams.ts do, with the synthetic fixture
// (e2e/study/fixtures/exam/exam12.json) as the model's replies:
//   - rpc/study_exam_create ({exam_id, prefix}; 'course not found', 'bad exam')
//   - the pages: the storage upload of <group>/exams/<exam>/p<n>.jpg (the base mock keeps the files)
//   - POST /api/study/ai {op:"exam_read"}: the pages checked (numbers, paths,
//     the key flag against the key mode, a signed link for each), the units
//     queued (4 pages each, the key sheet apart), {units, server:true, priceUsd};
//     3 a day per member (429 daily); {action:"unit"} claims nothing (the
//     server writes here)
//   - the units run on their own, one every `pace` ms from the start, whether
//     or not a phone asks (the phone may close): a read unit saves the
//     fixture's items of its pages (by number; item 3 gets a crop of its
//     page, item 10 is read badly), the key unit merges the sheet by number,
//     then the items left without a key are solved (the fixture's solve
//     reply; confidence under 3 counts in no score). `fail(unit)` fails a
//     unit once ("unreadable"), and "לנסות שוב" (study_exam_retry) runs it again.
//   - rpc/study_exam_status, study_exam_review, study_exam_item_edit (logged),
//     study_set_exam_key (logged, origin member), study_exam_key_confirm (a
//     true/false or match item's suggested key, logged), study_exam_key_undo
//     ('changed' when the key moved since), study_exam_retry, study_exam_hide
//   - GET /rest/v1/study_exams (members read their group's)
//   - simulations: study_mock_create (kind 'exam'), study_mock_start (an open
//     attempt comes back), study_mock_get (past the deadline: submitted first),
//     study_mock_progress, study_mock_answer (false once the time is up, 10 s
//     of grace), study_mock_finish (the score; each counted pick a
//     study_answers row with mode 'exam' and attempt_id; a blank writes none)
// Uploaded sheets (docs/study/sheets.md, section O 1; VITE_STUDY_SHEETS):
//   - each upload has a kind ('exam' | 'sheet') and one lecture; the course
//     page's rows carry them (study_course_overview at O 1)
//   - rpc/study_sheet_create ({exam_id, prefix}; 'off' while sheetsOn is false,
//     'bad sheet', 'lecture not found'); a sheet is hidden from the course's style
//   - op exam_read on a sheet: at most 40 pages and an answers file of 10 (400
//     too many pages), 402 sheets_cap while sheetsCap is set, 409 confirm above
//     a usual $3 without confirmBig; a sheet is read with the synthetic sheet's
//     replies as the exam reader gives them (fixtures/sheet/sheet6.json, a0)
//   - rpc/study_exam_key_set: any choice item keyed by hand (true/false and
//     match too), logged with the statements (old_seq, new_seq)
// Levers, on db.examsMock:
//   offset   ms added to the server's clock (the script moves the page's fake clock by the same)
//   pace     ms between units (default 600)
//   fail     (unit) => true fails that unit once
//   seed(o)  a ready exam of the course with n synthetic items (the simulation's lengths)
//   calls    every exams RPC and op (fn, who, body)
//   sheetsOn the switch 'sheets' (default true); sheetsCap: a sheet's start is refused 402 sheets_cap
const fs = require("fs");
const path = require("path");

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "exam", "exam12.json"), "utf8"));
const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "sheet", "sheet6.json"), "utf8"));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const keyOf = (s) => String(s ?? "").replace(/[​-‏‪-‮⁠⁦-⁩]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};
const iso = (ms) => new Date(ms).toISOString();

module.exports = {
  seed(db) {
    const M = {
      exams: [],
      units: [],
      mocks: [],
      attempts: [],
      keyLog: [],
      itemLog: [],
      reads: [],
      calls: [],
      seq: 0,
      offset: 0,
      pace: 600,
      fail: () => false,
      failed: new Set(),
      sheetsOn: true,
      sheetsCap: false,
    };
    M.now = () => Date.now() + M.offset;
    db.examsMock = M;
    const P = () => db.practice;
    const live = (e) => e && !e.deleted_at;
    const itemsOf = (e) => (P()?.questions ?? []).filter((q) => q.exam_id === e.id && !q.retired_at);
    M.examsOf = (nameKey) => M.exams.filter((e) => live(e) && keyOf(e.course) === nameKey);
    M.overviewRows = (nameKey) =>
      M.examsOf(nameKey)
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.created_at < b.created_at ? 1 : -1))
        .map((e) => ({
          id: e.id, title: e.title, year: e.year, status: e.status, moed: e.moed, minutes: e.minutes, key_source: e.key_source, hidden: e.hide_from_profile, created_at: e.created_at,
          questions: itemsOf(e).length, printed: itemsOf(e).length + (e.skipped_open ?? 0), kind: e.kind ?? "exam", lecture_id: e.lecture_id ?? null,
        }));
    const keyRow = (q) => P().keys.get(q.id) ?? null;
    const hasKey = (q) => {
      const k = keyRow(q);
      return Boolean(k && (k.answer !== null && k.answer !== undefined ? true : Array.isArray(k.seq) && k.seq.length));
    };
    M.hasKey = hasKey;

    /** A fixture item as section S saves it. */
    const save = (e, it, n) => {
      const Q = P();
      let q = Q.questions.find((x) => x.exam_id === e.id && x.exam_no === it.no);
      const fig = e.kind === "sheet" ? (it.figure?.page ? `pg:${it.figure.page}:${it.figure.x},${it.figure.y},${it.figure.w},${it.figure.h}` : "") : it.no === 3 ? "pg:3:40,80,920,520" : "";
      const row = {
        group_id: e.group_id, lecture_id: null, batch_id: null, exam_id: e.id, exam_no: it.no, ref_lecture: null, source: "exam", part_idx: null,
        kind: it.kind, difficulty: 2, vignette: it.vignette || "", question: it.question, options: it.options, slides: [], topic: "", aspect: "other",
        model: "mock", created_by: e.created_by, retired_at: null, retired_by: null, retire_note: "", anchor: null, quote: "", part_gen: null, teaser: "",
        figure: fig, option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, form: it.form, layout: it.form === "match" ? { kind: "match", prompts: it.prompts } : null,
        series: null, step: null, parse_conf: e.kind !== "sheet" && it.no === 10 ? 1 : (it.parse_conf ?? 2), page: it.page ?? null,
      };
      if (!q) {
        q = { id: hex("e1e00000", ++M.seq), created_at: iso(M.now() + n), has_key: false, ...row };
        Q.questions.push(q);
        Q.keys.set(q.id, { answer: null, seq: null, explanations: it.options.map(() => ""), takeaway: "", origin: null, conf: null, by: null });
      }
      const k = keyRow(q);
      // As section S: marks only when the uploader said the answers are marked in the exam; a handwritten one is a suggested answer.
      if (e.key_source === "marked" && (k.origin === null || k.origin === "exam")) {
        const origin = it.marked_by === "handwritten" ? { origin: "solved", conf: 2 } : { origin: "exam" };
        if (it.form === "one" && it.answer >= 0) Object.assign(k, { answer: it.answer, ...origin });
        if (it.form !== "one" && it.seq?.length) Object.assign(k, { seq: it.seq, ...origin });
      }
      const sheet = e.sheet?.get(it.no);
      if (sheet !== undefined) Object.assign(k, { answer: sheet, origin: "sheet" });
      q.has_key = hasKey(q);
    };
    /** One unit's work, as the worker does it. */
    const runUnit = (e, u) => {
      if (M.fail(u) && !M.failed.has(u)) {
        M.failed.add(u);
        Object.assign(u, { status: "failed", error: "unreadable" });
        return;
      }
      const fx = e.kind === "sheet" ? SHEET.a0 : FIXTURE;
      if (u.kind === "read") {
        for (const f of fx.units) {
          if (!f.pages.some((p) => u.pages.includes(p))) continue;
          // As the exam reader's save path: 2-6 options (the sheet's 8-option item is not saved, release A0).
          f.reply.questions.filter((it) => it.options.length <= 6).forEach((it, i) => save(e, it, i));
          e.skipped_open = (e.skipped_open ?? 0) + (f.reply.skipped_open ?? 0);
        }
      } else if (u.kind === "key") {
        e.sheet = new Map(fx.key.reply.keys.filter((k) => k.answer >= 0).map((k) => [k.no, k.answer]));
        for (const q of itemsOf(e)) {
          const a = e.sheet.get(q.exam_no);
          const k = keyRow(q);
          if (a !== undefined && k.origin !== "member" && q.form === "one") Object.assign(k, { answer: a, origin: "sheet" });
          q.has_key = hasKey(q);
        }
      } else if (u.kind === "solve") {
        const by = new Map((fx.solve ?? FIXTURE.solve).reply.answers.map((a) => [a.no, a]));
        for (const id of u.items) {
          const q = P().questions.find((x) => x.id === id);
          const a = q && by.get(q.exam_no);
          const k = q && keyRow(q);
          if (!a || !k || hasKey(q)) continue;
          if (q.form === "one" && a.answer >= 0 && a.answer < q.options.length) Object.assign(k, { answer: a.answer, origin: "solved", conf: a.conf });
          if (q.form !== "one" && a.seq?.length) Object.assign(k, { seq: a.seq, origin: "solved", conf: a.conf });
          q.has_key = hasKey(q);
        }
      }
      Object.assign(u, { status: "done", error: null });
    };
    /** study_private.exam_advance: solve units once the reading is done; ready when nothing runs. */
    const advance = (e) => {
      const mine = M.units.filter((u) => u.exam_id === e.id);
      if (!mine.some((u) => (u.kind === "read" || u.kind === "key") && (u.status === "pending" || u.status === "running"))) {
        const asked = new Set(mine.filter((u) => u.kind === "solve").flatMap((u) => u.items));
        const left = itemsOf(e).filter((q) => !hasKey(q) && !asked.has(q.id)).map((q) => q.id);
        for (let i = 0; i < left.length; i += 20) M.units.push({ exam_id: e.id, kind: "solve", pages: null, items: left.slice(i, i + 20), status: "pending", error: null, reread: false });
      }
      e.n_questions = itemsOf(e).length;
      const active = M.units.some((u) => u.exam_id === e.id && (u.status === "pending" || u.status === "running"));
      e.status = active ? "reading" : e.n_questions > 0 ? "ready" : "failed";
      if (!active && !e.n_questions) e.error = "no questions";
    };
    M.advance = advance;
    /** The worker: one unit at a time, on a clock of its own (the phone may be closed). */
    M.tick = () => {
      for (const e of M.exams.filter((x) => x.status === "reading")) {
        const run = M.units.find((u) => u.exam_id === e.id && u.status === "running");
        if (run) {
          runUnit(e, run);
          advance(e);
          continue;
        }
        const next = M.units.find((u) => u.exam_id === e.id && u.status === "pending");
        if (next) next.status = "running";
        else advance(e);
      }
    };
    M.timer = setInterval(() => M.tick(), M.pace);
    M.timer.unref?.();

    /** A ready exam with n synthetic one-answer items (the simulation's lengths). */
    M.seed = (o) => {
      const e = {
        id: hex("e0e00000", ++M.seq), group_id: db.group.id, course: o.course, title: o.title, year: o.year ?? 2024, moed: o.moed ?? "א׳", minutes: o.minutes ?? null,
        key_source: "marked", status: "ready", error: null, skipped_open: 0, hide_from_profile: false, deleted_at: null, n_questions: o.n, pages: 0, key_pages: 0,
        created_by: db.members[0].user_id, created_at: o.created_at ?? iso(M.now() - 86_400_000), retries: 0,
      };
      M.exams.push(e);
      for (let i = 1; i <= o.n; i++) {
        const q = {
          id: hex("e2e00000", ++M.seq), group_id: e.group_id, lecture_id: null, batch_id: null, exam_id: e.id, exam_no: i, ref_lecture: null, source: "exam", part_idx: null,
          kind: "mcq", difficulty: 2, vignette: "", question: `שאלה ${i} של המבחן הסינתטי: מה נכון לגבי Mockacillin?`, options: ["Fictazole", "Mockacillin", "Placebrin", "Stubamide"],
          slides: [], topic: i % 2 ? "אנטיביוטיקה" : "", aspect: "other", has_key: true, model: "mock", created_by: e.created_by, created_at: e.created_at, retired_at: null, retired_by: null,
          retire_note: "", anchor: null, quote: "", part_gen: null, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null,
          form: "one", layout: null, series: null, step: null, parse_conf: 3, page: null,
        };
        P().questions.push(q);
        P().keys.set(q.id, { answer: i % 4, seq: null, explanations: q.options.map(() => ""), takeaway: "", origin: "exam", conf: null, by: null });
      }
      return e;
    };
  },

  async rest({ method, path: p, query, body, who, db, json: reply, refuse: deny, check }) {
    const M = db.examsMock;
    if (!M) return undefined;
    const json = async (b, s) => (await reply(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const me = who?.id ?? null;
    const member = me && db.members.some((x) => x.user_id === me);
    const P = db.practice;

    if (p === "/rest/v1/study_exams" && method === "GET") {
      if (!member) return json([]);
      const cols = (query.get("select") || "*").split(",").map((c) => c.trim());
      check.cols("study_exams", cols, `${method} ${p}`);
      let rows = M.exams.filter((e) => e.group_id === db.group.id);
      const g = query.get("group_id");
      if (g) rows = rows.filter((e) => `eq.${e.group_id}` === g);
      return json(rows.map((e) => Object.fromEntries(cols.map((c) => [c, e[c] ?? null]))));
    }

    const m = /^\/rest\/v1\/rpc\/(study_exam_[a-z_]+|study_set_exam_key|study_mock_[a-z_]+|study_sheet_create)$/.exec(p);
    if (!m) return undefined;
    const fn = m[1];
    check.rpc(fn, body, `${method} ${p}`);
    M.calls.push({ fn, who: me, body });
    if (!me) return refuse("not signed in");
    const now = M.now();
    const examOf = (id) => {
      const e = M.exams.find((x) => x.id === id);
      return member && e && !e.deleted_at ? e : null;
    };
    const qOf = (id) => P.questions.find((q) => q.id === id && q.source === "exam");
    const nameOf = (uid) => db.members.find((x) => x.user_id === uid)?.name ?? null;
    const items = (e) => P.questions.filter((q) => q.exam_id === e.id && !q.retired_at);

    switch (fn) {
      case "study_exam_create": {
        const c = db.coursesMock?.rows.find((r) => r.id === body.p_course && !r.deleted_at);
        if (!c || !member) return refuse("course not found");
        const meta = body.p_meta ?? {};
        const ks = meta.key_source ?? "marked";
        if (!/^(\d{4})?$/.test(meta.year ?? "") || !/^(\d{1,3})?$/.test(meta.minutes ?? "") || !["marked", "separate", "none"].includes(ks) || String(meta.moed ?? "").length > 20) return refuse("bad exam");
        const yr = meta.year ? Number(meta.year) : null;
        const mn = meta.minutes ? Number(meta.minutes) : null;
        if ((yr !== null && (yr < 1990 || yr > 2100)) || (mn !== null && (mn < 10 || mn > 600))) return refuse("bad exam");
        const md = String(meta.moed ?? "").trim() || null;
        const id = hex("e0e00000", ++M.seq);
        M.exams.push({
          id, group_id: db.group.id, course: c.name, title: md ? `מועד ${md}${yr ? ` ${yr}` : ""}` : yr ? `מבחן ${yr}` : "מבחן קודם", year: yr, moed: md, minutes: mn, key_source: ks,
          status: "uploading", error: null, skipped_open: 0, hide_from_profile: false, deleted_at: null, n_questions: 0, created_by: me, created_at: iso(now), retries: 0, pages: 0, key_pages: 0,
        });
        return json({ exam_id: id, prefix: `${db.group.id}/exams/${id}/` });
      }
      case "study_sheet_create": {
        const c = db.coursesMock?.rows.find((r) => r.id === body.p_course && !r.deleted_at);
        if (!c || !member) return refuse("course not found");
        if (!M.sheetsOn) return refuse("off");
        const meta = body.p_meta ?? {};
        const t = String(meta.title ?? "").replace(/\s+/g, " ").trim();
        const ks = meta.key_source ?? "none";
        if (typeof meta.title !== "string" || t.length < 1 || t.length > 120 || !["marked", "separate", "none"].includes(ks)) return refuse("bad sheet");
        const lid = meta.lecture || null;
        if (lid && !db.lectures.some((l) => l.id === lid && !l.deleted_at)) return refuse("lecture not found");
        const id = hex("e0e00000", ++M.seq);
        M.exams.push({
          id, group_id: db.group.id, course: c.name, title: t, year: null, moed: null, minutes: null, key_source: ks, kind: "sheet", lecture_id: lid,
          status: "uploading", error: null, skipped_open: 0, hide_from_profile: true, deleted_at: null, n_questions: 0, created_by: me, created_at: iso(now), retries: 0, pages: 0, key_pages: 0,
        });
        return json({ exam_id: id, prefix: `${db.group.id}/exams/${id}/` });
      }
      case "study_exam_key_set": {
        const q = qOf(body.p_question);
        if (!q || !member) return refuse("question not found");
        const a = body.p_answer ?? null;
        const sq = body.p_seq ?? null;
        const n = q.form === "match" ? (q.layout?.prompts ?? []).length : q.options.length;
        if (a !== null || sq !== null) {
          if ((q.form === "one") !== (a !== null) || (q.form === "one" ? sq !== null : a !== null)) return refuse("bad answer");
          if (q.form === "one" && !(a >= 0 && a < q.options.length)) return refuse("bad answer");
          if (q.form === "tf" && (!Array.isArray(sq) || sq.length !== n || sq.some((v) => v !== 0 && v !== 1))) return refuse("bad answer");
          if (q.form === "match" && (!Array.isArray(sq) || sq.length !== n || new Set(sq).size !== sq.length || sq.some((v) => !(v >= 0 && v < q.options.length)))) return refuse("bad answer");
        }
        const k = P.keys.get(q.id);
        const keyed = a !== null || sq !== null;
        M.keyLog.push({
          id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: k.answer ?? null, new: a, origin_old: k.origin ?? null, origin_new: keyed ? "member" : null, conf_old: k.conf ?? null,
          by_old: k.by ?? null, undo_of: null, member_id: me, at: iso(now), old_seq: q.form === "one" ? null : (k.seq ?? []), new_seq: q.form === "one" ? null : (sq ?? []),
        });
        Object.assign(k, { answer: a, seq: sq, origin: keyed ? "member" : null, conf: null, by: me });
        q.has_key = keyed;
        return json({ answer: a, seq: sq, origin: keyed ? "member" : null });
      }
      case "study_exam_status": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        const its = items(e);
        const k = (q) => P.keys.get(q.id) ?? {};
        return json({
          id: e.id, title: e.title, year: e.year, moed: e.moed, minutes: e.minutes, key_source: e.key_source, status: e.status, error: e.error, skipped_open: e.skipped_open,
          hidden: e.hide_from_profile, pages: e.pages, key_pages: e.key_pages,
          units: M.units.filter((u) => u.exam_id === e.id).map((u) => ({ kind: u.kind, pages: u.pages, items: (u.items ?? []).length, status: u.status, error: u.error, reread: u.reread })),
          found: its.length,
          keyed: its.filter((q) => ["exam", "sheet", "member"].includes(k(q).origin) && M.hasKey(q)).length,
          suggested: its.filter((q) => k(q).origin === "solved").length,
          unkeyed: its.filter((q) => !M.hasKey(q)).length,
          unclear: its.filter((q) => q.parse_conf === 1).length,
          repeats: 0,
          cancelled: 0,
        });
      }
      case "study_exam_review": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        return json({
          exam: { id: e.id, title: e.title, status: e.status, key_source: e.key_source, hidden: e.hide_from_profile, by: nameOf(e.created_by) },
          pages: (e.pageRows ?? []).map((x) => ({ n: x.n, path: x.path, w: x.w, h: x.h, key: x.key })),
          items: P.questions
            .filter((q) => q.exam_id === e.id)
            .sort((a, b) => a.exam_no - b.exam_no)
            .map((q) => {
              const k = P.keys.get(q.id) ?? {};
              return {
                id: q.id, no: q.exam_no, kind: q.kind, form: q.form, vignette: q.vignette, question: q.question, options: q.options, prompts: q.layout?.prompts ?? [], figure: q.figure,
                page: q.page, parse_conf: q.parse_conf, retired: Boolean(q.retired_at), answer: k.answer ?? null, seq: k.seq ?? null, origin: k.origin ?? null, conf: k.conf ?? null,
                key_by: k.by ? nameOf(k.by) : null, fixed: M.itemLog.some((l) => l.question_id === q.id),
                answered: (P.answers ?? []).some((a) => a.question_id === q.id),
              };
            }),
          key_log: M.keyLog.filter((l) => l.exam_id === e.id).map((l) => ({ ...l, by: nameOf(l.member_id) })),
          item_log: M.itemLog.filter((l) => l.exam_id === e.id).map((l) => ({ ...l, by: nameOf(l.member_id) })),
        });
      }
      case "study_exam_item_edit": {
        const q = qOf(body.p_question);
        if (!q || !member) return refuse("question not found");
        const t = String(body.p_text ?? "").trim();
        let old;
        if (body.p_field === "question") {
          if (t.length < 5 || t.length > 600) return refuse("bad text");
          old = q.question;
          q.question = t;
        } else if (body.p_field === "vignette") {
          if (t.length > 2500) return refuse("bad text");
          old = q.vignette;
          q.vignette = t;
        } else if (body.p_field === "option") {
          if (!(body.p_idx >= 0 && body.p_idx < q.options.length)) return refuse("bad field");
          if (t.length < 1 || t.length > 400) return refuse("bad text");
          old = q.options[body.p_idx];
          q.options = q.options.map((o, i) => (i === body.p_idx ? t : o));
        } else return refuse("bad field");
        if (old !== t) M.itemLog.push({ id: M.itemLog.length + 1, question_id: q.id, exam_id: q.exam_id, field: body.p_field, idx: body.p_field === "option" ? body.p_idx : null, old, new: t, member_id: me, at: iso(now) });
        return json(null);
      }
      case "study_set_exam_key": {
        const q = qOf(body.p_question);
        if (!q || !member) return refuse("question not found");
        if (q.form !== "one") return refuse("set question");
        const a = body.p_answer;
        if (a !== null && !(a >= 0 && a < q.options.length)) return refuse("bad answer");
        const k = P.keys.get(q.id);
        M.keyLog.push({ id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: k.answer ?? null, new: a, origin_old: k.origin ?? null, origin_new: a !== null ? "member" : null, conf_old: k.conf ?? null, by_old: k.by ?? null, undo_of: null, member_id: me, at: iso(now) });
        Object.assign(k, { answer: a, origin: a !== null ? "member" : null, conf: null, by: me });
        q.has_key = a !== null;
        return json(null);
      }
      case "study_exam_key_confirm": {
        const q = qOf(body.p_question);
        if (!q || !member) return refuse("question not found");
        const k = P.keys.get(q.id);
        if (k.origin !== "solved" || !M.hasKey(q)) return refuse("nothing to confirm");
        M.keyLog.push({ id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: k.answer ?? null, new: k.answer ?? null, origin_old: "solved", origin_new: "member", conf_old: k.conf ?? null, by_old: k.by ?? null, undo_of: null, member_id: me, at: iso(now) });
        Object.assign(k, { origin: "member", conf: null, by: me });
        return json(null);
      }
      case "study_exam_key_undo": {
        const q = qOf(body.p_question);
        if (!q || !member) return refuse("question not found");
        const undone = new Set(M.keyLog.filter((l) => l.undo_of !== null).map((l) => l.undo_of));
        const l = [...M.keyLog].reverse().find((x) => x.question_id === q.id && x.undo_of === null && !undone.has(x.id));
        if (!l) return refuse("nothing to undo");
        const k = P.keys.get(q.id);
        if (l.new_seq) {
          // A set item's hand key (O 1): its statements come back too.
          if (JSON.stringify(k.seq ?? []) !== JSON.stringify(l.new_seq) || (k.origin ?? null) !== l.origin_new) return refuse("changed");
          M.keyLog.push({ id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: k.answer ?? null, new: l.old, origin_old: k.origin, origin_new: l.origin_old, conf_old: k.conf, by_old: k.by, undo_of: l.id, member_id: me, at: iso(now), old_seq: k.seq ?? [], new_seq: l.old_seq });
          Object.assign(k, { answer: l.old, seq: l.old_seq?.length ? l.old_seq : null, origin: l.origin_old, conf: l.conf_old, by: l.by_old });
          q.has_key = M.hasKey(q);
          return json({ answer: l.old, seq: k.seq, origin: l.origin_old });
        }
        if ((k.answer ?? null) !== l.new || (k.origin ?? null) !== l.origin_new) return refuse("changed");
        M.keyLog.push({ id: M.keyLog.length + 1, question_id: q.id, exam_id: q.exam_id, old: k.answer ?? null, new: l.old, origin_old: k.origin, origin_new: l.origin_old, conf_old: k.conf, by_old: k.by, undo_of: l.id, member_id: me, at: iso(now) });
        Object.assign(k, { answer: l.old, origin: l.origin_old, conf: l.conf_old, by: l.by_old });
        q.has_key = M.hasKey(q);
        return json({ answer: l.old, origin: l.origin_old });
      }
      case "study_exam_retry": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        if (e.retries >= 3) return refuse("retry limit");
        const urls = body.p_urls ?? {};
        if ((e.pageRows ?? []).some((x) => !String(urls[x.path] ?? "").includes(`/storage/v1/object/sign/study/${x.path}?token=`))) return refuse("bad urls");
        let n = 0;
        if (!body.p_pages || !body.p_pages.length) {
          for (const u of M.units.filter((x) => x.exam_id === e.id && x.status === "failed")) {
            Object.assign(u, { status: "pending", error: null });
            n++;
          }
          if (!n) return refuse("nothing to retry");
        } else {
          for (const pg of body.p_pages) {
            M.units.push({ exam_id: e.id, kind: "read", pages: [pg], items: [], status: "pending", error: null, reread: true });
            n++;
          }
        }
        e.retries += 1;
        e.status = "reading";
        return json(n);
      }
      case "study_exam_hide": {
        const e = examOf(body.p_exam);
        if (!e) return refuse("exam not found");
        e.hide_from_profile = Boolean(body.p_hide);
        return json(null);
      }

      /* ── simulations ── */
      case "study_mock_create": {
        const c = db.coursesMock?.rows.find((r) => r.id === body.p_course && !r.deleted_at);
        if (!c || !member) return refuse("course not found");
        if (body.p_kind !== "exam") return refuse("bad kind");
        const e = examOf(body.p_exam);
        if (!e || keyOf(e.course) !== c.name_key) return refuse("exam not found");
        if (e.status !== "ready") return refuse("exam not ready");
        if (body.p_n !== null && body.p_n !== undefined && !(body.p_n >= 5 && body.p_n <= 150)) return refuse("bad questions");
        if (body.p_minutes !== null && body.p_minutes !== undefined && !(body.p_minutes >= 1 && body.p_minutes <= 600)) return refuse("bad minutes");
        const pool = items(e).filter((q) => !q.hidden_at);
        if (pool.length < 5) return refuse("too few questions");
        const n = Math.min(body.p_n ?? 150, pool.length, 150);
        const seen = (q) => P.answers.some((a) => a.question_id === q.id && a.user_id === me);
        const unseen = body.p_unseen_only !== false;
        const chosen = [...pool].sort((a, b) => (unseen ? Number(seen(a)) - Number(seen(b)) : 0) || a.exam_no - b.exam_no).slice(0, n).sort((a, b) => a.exam_no - b.exam_no);
        // The exam's minutes were for all it printed (open questions skipped too), as study_mock_create.
        const minutes = body.p_minutes ?? (e.minutes ? Math.ceil((e.minutes * n) / Math.max(pool.length, items(e).length + (e.skipped_open ?? 0))) : Math.ceil(n * 1.8));
        const mk = { id: hex("e3e00000", ++M.seq), group_id: db.group.id, course_id: c.id, kind: "exam", exam_id: e.id, question_ids: chosen.map((q) => q.id), minutes, spec: { n, pool: pool.length, unseen_only: unseen }, created_by: me };
        M.mocks.push(mk);
        return json({ mock: mk.id, questions: n, minutes, pool: pool.length, missing: [] });
      }
      case "study_mock_start": {
        const mk = M.mocks.find((x) => x.id === body.p_mock);
        if (!mk || !member) return refuse("mock not found");
        let a = M.attempts.filter((x) => x.mock_id === mk.id && x.member_id === me && !x.finished_at).pop();
        if (a && Date.parse(a.deadline) > now) return json(get(a));
        if (a) finish(a);
        a = { id: hex("e4e00000", ++M.seq), mock_id: mk.id, member_id: me, started_at: iso(now), deadline: iso(now + mk.minutes * 60_000), finished_at: null, auto: false, position: 0, flagged: [], picks: {}, score: null };
        M.attempts.push(a);
        return json(get(a));
      }
      case "study_mock_get": {
        const a = M.attempts.find((x) => x.id === body.p_attempt && x.member_id === me);
        if (!a) return refuse("attempt not found");
        if (!a.finished_at && now >= Date.parse(a.deadline)) finish(a);
        return json(get(a));
      }
      case "study_mock_progress": {
        const a = M.attempts.find((x) => x.id === body.p_attempt && x.member_id === me);
        if (!a) return refuse("attempt not found");
        if (a.finished_at) return json(false);
        if (now >= Date.parse(a.deadline) + 10_000) {
          finish(a);
          return json(false);
        }
        const mk = M.mocks.find((x) => x.id === a.mock_id);
        const n = mk.question_ids.length;
        if (!(body.p_position >= 0 && body.p_position < n) || (body.p_flagged ?? []).some((f) => !(f >= 0 && f < n))) return refuse("bad progress");
        a.position = body.p_position;
        a.flagged = [...new Set(body.p_flagged ?? [])].sort((x, y) => x - y);
        return json(true);
      }
      case "study_mock_answer": {
        const a = M.attempts.find((x) => x.id === body.p_attempt && x.member_id === me);
        if (!a) return refuse("attempt not found");
        if (a.finished_at) return json(false);
        if (now >= Date.parse(a.deadline) + 10_000) {
          finish(a);
          return json(false);
        }
        const mk = M.mocks.find((x) => x.id === a.mock_id);
        if (!mk.question_ids.includes(body.p_question)) return refuse("question not found");
        const q = qOf(body.p_question);
        if (body.p_choice === null && body.p_choices === null) {
          delete a.picks[q.id];
          return json(true);
        }
        if (q.form === "one" && (body.p_choices !== null || !(body.p_choice >= 0 && body.p_choice < q.options.length))) return refuse("bad choice");
        if (q.form !== "one" && (body.p_choice !== null || !Array.isArray(body.p_choices))) return refuse("bad choices");
        a.picks[q.id] = q.form === "one" ? { c: body.p_choice, ms: body.p_ms ?? undefined } : { cs: body.p_choices, ms: body.p_ms ?? undefined };
        return json(true);
      }
      case "study_mock_finish": {
        const a = M.attempts.find((x) => x.id === body.p_attempt && x.member_id === me);
        if (!a) return refuse("attempt not found");
        if (!a.finished_at) finish(a);
        return json(a.score);
      }
      default:
        return refuse(`unmocked ${fn}`, 404);
    }

    function get(a) {
      const mk = M.mocks.find((x) => x.id === a.mock_id);
      return {
        attempt: a.id, mock: mk.id, kind: mk.kind, exam_id: mk.exam_id, course_id: mk.course_id, minutes: mk.minutes, started_at: a.started_at, deadline: a.deadline, now: iso(M.now()),
        finished_at: a.finished_at, position: a.position, flagged: a.flagged, question_ids: mk.question_ids, picks: a.picks, score: a.score,
      };
    }
    /** study_mock_finish: the score, and each counted pick an answer row (mode 'exam', attempt_id). */
    function finish(a) {
      const mk = M.mocks.find((x) => x.id === a.mock_id);
      const auto = M.now() >= Date.parse(a.deadline);
      let right = 0;
      let counted = 0;
      let answered = 0;
      let suggested = 0;
      const out = [];
      mk.question_ids.forEach((id, i) => {
        const q = P.questions.find((x) => x.id === id);
        if (!q) return;
        const k = P.keys.get(id) ?? {};
        const pick = a.picks[id];
        const isCounted = !q.retired_at && (q.form === "one" ? k.answer !== null && k.answer !== undefined : Array.isArray(k.seq)) && !(k.origin === "solved" && (k.conf ?? 0) < 3);
        const ok = isCounted && (q.form === "one" ? pick?.c !== undefined && pick.c === k.answer : Array.isArray(pick?.cs) && JSON.stringify(pick.cs) === JSON.stringify(k.seq));
        if (isCounted) {
          counted++;
          if (ok) right++;
          if (k.origin === "solved") suggested++;
          if (pick) P.answers.push({ user_id: a.member_id, question_id: id, choice: q.form === "one" ? pick.c : null, choices: q.form === "one" ? null : pick.cs, correct: ok, mode: "exam", ms: pick.ms ?? null, confidence: null, answered_at: iso(M.now()), attempt_id: a.id });
        }
        if (pick) answered++;
        out.push({ id, pos: i + 1, no: q.exam_no, form: q.form, answer: k.answer ?? null, seq: k.seq ?? null, choice: pick?.c ?? null, choices: pick?.cs ?? null, correct: ok, counted: isCounted, origin: k.origin ?? null, ref_lecture: null, topic: q.topic });
      });
      a.finished_at = iso(M.now());
      a.auto = auto;
      a.score = { right, counted, total: mk.question_ids.length, answered, suggested, not_counted: mk.question_ids.length - counted, auto, items: out };
    }
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "exam_read") return undefined;
    const M = db.examsMock;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    M.calls.push({ fn: "op exam_read", who: me, body: b });
    if (!me || !db.members.some((m) => m.user_id === me)) return send(401, { error: "not signed in" });
    const e = M.exams.find((x) => x.id === b.examId && !x.deleted_at);
    if (!e) return send(404, { error: "exam not found" });
    if (b.action === "unit") return send(200, { claimed: false, status: e.status });
    if (e.status !== "uploading") return send(409, { error: "already started" });
    const pages = Array.isArray(b.pages) ? b.pages : [];
    if (!pages.length) return send(400, { error: "bad request" });
    if (pages.length > 120) return send(400, { error: "too many pages" });
    if (e.kind === "sheet") {
      // A sheet's bounds (op exam_read, OD13): 40 pages and an answers file of 10, the switch, the line, the confirmation above $3.
      const keyN = pages.filter((x) => x.key).length;
      if (pages.length - keyN > 40 || keyN > 10) return send(400, { error: "too many pages" });
      if (!M.sheetsOn) return send(403, { error: "off" });
      const usual = 0.06 * (pages.length - keyN) + (e.key_source === "none" ? 0.02 * (pages.length - keyN) : 0);
      if (usual > 3 && b.confirmBig !== true) return send(409, { error: "confirm" });
      if (M.sheetsCap) return send(402, { error: "sheets_cap" });
    }
    M.reads.push({ who: me, at: M.now() });
    if (M.reads.filter((r) => r.who === me).length > 3) return send(429, { error: "daily_limit" });
    const prefix = `${e.group_id}/exams/${e.id}/`;
    const bad = pages.some((x, i) => x.n !== i + 1 || x.path !== `${prefix}p${x.n}.jpg` || !(x.w > 0 && x.h > 0) || !db.files.has(x.path));
    if (bad) return send(400, { error: pages.some((x) => !db.files.has(x.path)) ? "missing pages" : "bad pages" });
    if (pages.some((x) => !String(b.urls?.[x.path] ?? "").includes(`/storage/v1/object/sign/study/${x.path}?token=`))) return send(400, { error: "bad urls" });
    const keys = pages.filter((x) => x.key).map((x) => x.n);
    const reads = pages.filter((x) => !x.key).map((x) => x.n);
    if ((e.key_source === "separate") !== keys.length > 0 || !reads.length) return send(400, { error: "bad pages" });
    e.pageRows = pages;
    e.pages = reads.length;
    e.key_pages = keys.length;
    for (let i = 0; i < reads.length; i += 4) M.units.push({ exam_id: e.id, kind: "read", pages: reads.slice(i, i + 4), items: [], status: "pending", error: null, reread: false });
    if (keys.length) M.units.push({ exam_id: e.id, kind: "key", pages: keys, items: [], status: "pending", error: null, reread: false });
    e.status = "reading";
    return send(200, { units: Math.ceil(reads.length / 4) + (keys.length ? 1 : 0), server: true, priceUsd: 1 });
  },
};

// Courses' part of the e2e mock (docs/study/sources.md, phase 1; section S 1).
// The shared mock loads it for every script (every plugin in
// e2e/study/mocks/ is), so a build with VITE_STUDY_COURSES finds its RPCs in
// any flow. It plays section S as the SQL does (supabase/study-schema.sql,
// SECTION S):
//   - study_courses: one row per distinct lower(btrim(course)) of the
//     group's lectures, named as first written (the backfill and the
//     trigger), kept in step before every answer;
//   - rpc/study_courses_of, study_course_overview (days left in Israel time,
//     the lectures, the ones ready, the questions that can be practised),
//     study_course_set (the ranges), study_course_rename ('exists'; the
//     lectures' text follows), study_course_merge ('same course'),
//     study_course_upsert; 'course not found' for another or a merged id;
//   - POST /api/study/ai {op:"ask", scope:"course"}: the context line
//     ("chosen", "total", "lectures", "paragraphs") from the course's ready
//     parts, then "turn", the answer in pieces citing [הרצאה n · ש׳ m], and
//     "done"; one reservation each (db.coursesMock.asks).
// Levers, on db.coursesMock:
//   hold(n)   true for the n-th lecture insert (1-based) of the batch upload:
//             the lecture gets there, and the request never answers (the tab
//             is closed while it is on its way)
//   inserts   how many lectures were inserted
//   calls     every RPC (fn, who)
const now = () => new Date().toISOString();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// shared/study/courseKey.ts (the SQL's study_private.course_key).
const keyOf = (s) => String(s ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};
/** Today in Israel, YYYY-MM-DD. */
const israelToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/** The backfill and the trigger: a row for every course text of the group's lectures. */
function ensure(db) {
  const C = db.coursesMock;
  const byTime = [...db.lectures].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const l of byTime) {
    const key = keyOf(l.course);
    if (!key || C.rows.some((r) => r.name_key === key)) continue;
    C.rows.push({ id: hex("c0000000", ++C.seq), group_id: db.group.id, name: String(l.course).trim(), name_key: key, exam_date: null, exam_minutes: null, exam_n: null, created_at: now(), deleted_at: null });
  }
}

const lecturesOf = (db, row) => db.lectures.filter((l) => !l.deleted_at && keyOf(l.course) === row.name_key);
/** The course's lectures in its order: by date (undated last), then by upload; numbered from 1. */
function numbered(db, row) {
  return lecturesOf(db, row)
    .sort((a, b) => {
      if (a.lecture_date && b.lecture_date && a.lecture_date !== b.lecture_date) return a.lecture_date < b.lecture_date ? -1 : 1;
      if (Boolean(a.lecture_date) !== Boolean(b.lecture_date)) return a.lecture_date ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    })
    .map((l, i) => ({ n: i + 1, id: l.id, title: l.title }));
}

module.exports = {
  seed(db) {
    db.coursesMock = { rows: [], seq: 0, calls: [], asks: [], inserts: 0, hold: () => false };
  },

  async rest({ method, path, body, who, db, json: reply, refuse: deny, check }) {
    const C = db.coursesMock;
    if (!C) return undefined;
    const json = async (b, s) => (await reply(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const where = `${method} ${path}`;

    // The batch upload's inserts: counted, and one held on its way when the script says so.
    if (path === "/rest/v1/study_lectures" && method === "POST" && who) {
      const rows = Array.isArray(body) ? body : body ? [body] : [];
      C.inserts += rows.length;
      if (C.hold(C.inserts)) {
        for (const r of rows) {
          const l = { ...r, status: "new", error: null, created_by: who.id, created_at: now(), updated_at: now(), course: r.course || "", lecturer: r.lecturer || "", queued_at: null, deleted_at: null, deleted_by: null };
          db.lectures.push(l);
        }
        C.held = (C.held ?? 0) + 1;
        return new Promise(() => undefined); // never answers: the tab goes before it does
      }
      return undefined; // the base mock inserts it
    }

    const m = /^\/rest\/v1\/rpc\/(study_course[a-z_]*|study_courses_of)$/.exec(path);
    if (!m) return undefined;
    const fn = m[1];
    check.rpc(fn, body, where);
    C.calls.push({ fn, who: who?.id ?? null, body });
    const me = who?.id ?? null;
    if (!me) return refuse("not signed in");
    if (!db.members.some((x) => x.user_id === me)) return refuse(fn === "study_courses_of" || fn === "study_course_upsert" ? "group not found" : "course not found");
    ensure(db);
    const live = (id) => C.rows.find((r) => r.id === id && !r.deleted_at);
    const retext = (fromKey, to) => {
      for (const l of db.lectures) if (keyOf(l.course) === fromKey) l.course = to;
    };
    const settingsBad = (d, mins, n) =>
      (d !== null && d !== undefined && !(d >= "2000-01-01" && d <= "2100-12-31") && "bad date") ||
      (mins !== null && mins !== undefined && !(mins >= 10 && mins <= 600) && "bad minutes") ||
      (n !== null && n !== undefined && !(n >= 5 && n <= 300) && "bad questions") ||
      "";

    switch (fn) {
      case "study_courses_of":
        if (body.p_group !== db.group.id) return refuse("group not found");
        return json(
          C.rows
            .filter((r) => !r.deleted_at)
            .sort((a, b) => (a.name_key < b.name_key ? -1 : 1))
            .map((r) => ({ id: r.id, name: r.name, name_key: r.name_key, exam_date: r.exam_date, exam_minutes: r.exam_minutes, exam_n: r.exam_n, lectures: lecturesOf(db, r).length, exams: (db.examsMock?.examsOf(r.name_key) ?? []).length })),
        );
      case "study_course_overview": {
        const r = live(body.p_course);
        if (!r) return refuse("course not found");
        const ls = lecturesOf(db, r);
        const ids = new Set(ls.map((l) => l.id));
        const questions = (db.practice?.questions ?? []).filter((q) => ids.has(q.lecture_id) && !q.retired_at && !q.hidden_at && !q.stale_at && q.has_key !== false).length;
        const days = r.exam_date ? Math.round((Date.parse(r.exam_date) - Date.parse(israelToday())) / 86_400_000) : null;
        // Past exams (mocks/exams.cjs, S 2): the course's exams as the overview lists them.
        const exams = db.examsMock?.overviewRows(r.name_key) ?? [];
        return json({ id: r.id, name: r.name, exam_date: r.exam_date, days_left: days, exam_minutes: r.exam_minutes, exam_n: r.exam_n, lectures: ls.length, ready: ls.filter((l) => l.status === "ready").length, exams, questions });
      }
      case "study_course_set": {
        const r = live(body.p_course);
        if (!r) return refuse("course not found");
        const bad = settingsBad(body.p_exam_date, body.p_minutes, body.p_n);
        if (bad) return refuse(bad);
        Object.assign(r, { exam_date: body.p_exam_date ?? null, exam_minutes: body.p_minutes ?? null, exam_n: body.p_n ?? null });
        return json(null);
      }
      case "study_course_rename": {
        const r = live(body.p_course);
        if (!r) return refuse("course not found");
        const nm = String(body.p_name ?? "").trim();
        if (nm.length < 1 || nm.length > 120) return refuse("bad name");
        if (C.rows.some((x) => !x.deleted_at && x.id !== r.id && x.name_key === keyOf(nm))) return refuse("exists");
        const from = r.name_key;
        Object.assign(r, { name: nm, name_key: keyOf(nm) });
        retext(from, nm);
        return json(null);
      }
      case "study_course_merge": {
        const f = live(body.p_from);
        const t = live(body.p_into);
        if (!f || !t) return refuse("course not found");
        if (f.id === t.id) return refuse("same course");
        t.exam_date = t.exam_date ?? f.exam_date;
        t.exam_minutes = t.exam_minutes ?? f.exam_minutes;
        t.exam_n = t.exam_n ?? f.exam_n;
        C.rows = C.rows.filter((x) => x.id !== f.id);
        retext(f.name_key, t.name);
        return json(null);
      }
      case "study_course_upsert": {
        const nm = String(body.p_name ?? "").trim();
        if (nm.length < 1 || nm.length > 120) return refuse("bad name");
        let r = C.rows.find((x) => x.name_key === keyOf(nm));
        if (!r) {
          r = { id: hex("c0000000", ++C.seq), group_id: db.group.id, name: nm, name_key: keyOf(nm), exam_date: null, exam_minutes: null, exam_n: null, created_at: now(), deleted_at: null };
          C.rows.push(r);
        }
        r.deleted_at = null;
        return json(r.id);
      }
      default:
        return refuse(`unmocked ${fn}`, 404);
    }
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "ask" || b.scope !== "course") return undefined;
    const C = db.coursesMock;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!me || !db.members.some((m) => m.user_id === me)) return send(401, { error: "not signed in" });
    ensure(db);
    const row = C.rows.find((r) => r.id === b.courseId && !r.deleted_at);
    if (!row) return send(404, { error: "course not found" });
    if (typeof b.question !== "string" || !b.question.trim()) return send(400, { error: "question required" });
    const all = numbered(db, row);
    if (!all.length) return send(404, { error: "no lectures" });
    // Every ready paragraph of the course: each "**…**" paragraph of a ready part with its slide tags.
    const paras = [];
    for (const l of all) {
      for (const s of db.sections.filter((x) => x.lecture_id === l.id && x.status === "ready")) {
        const blocks = String(s.markdown || "").split(/\n{2,}/).filter((t) => !/^#/.test(t.trim()) && t.trim());
        blocks.forEach((t, anchor) => {
          const slides = [...t.matchAll(/\[ש['׳]\s?(\d+)/g)].map((x) => Number(x[1]));
          paras.push({ lecture: l.n, lectureId: l.id, part: s.idx, anchor, slides, text: t });
        });
      }
    }
    if (!paras.length) return send(409, { error: "no summaries" });
    const words = b.question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const score = (t) => words.filter((w) => t.toLowerCase().includes(w)).length;
    // No paragraph has any word of the question: refused before anything is paid (ask.ts).
    if (words.length && !paras.some((x) => score(x.text) > 0)) return send(409, { error: "no match" });
    const chosen = [...paras].filter((x) => x.slides.length).sort((x, y) => score(y.text) - score(x.text)).slice(0, 3);
    const lectures = all.filter((l) => chosen.some((c) => c.lecture === l.n));
    C.asks.push({ who: me, courseId: row.id, question: b.question, history: b.history ?? [], at: Date.now() });
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.write("​");
    res.write(JSON.stringify({ t: "context", chosen: chosen.length, total: paras.length, lectures, paragraphs: chosen.map((c) => ({ lecture: c.lecture, part: c.part, anchor: c.anchor, slides: c.slides.slice(0, 3) })) }) + "\n");
    const u = `השאלה: ${b.question}`;
    res.write(JSON.stringify({ t: "turn", u }) + "\n");
    const first = chosen[0];
    const answer = `לפי הסיכומים של הקורס: ${b.question.replace(/\?$/, "")} מוסבר בהרצאה ${first.lecture} [הרצאה ${first.lecture} · ש׳ ${first.slides[0]}].${chosen[1] ? ` ראו גם [הרצאה ${chosen[1].lecture} · ש׳ ${chosen[1].slides[0]}].` : ""}`;
    const cut = [0, Math.floor(answer.length / 2), answer.length];
    for (let i = 0; i < 2; i++) {
      res.write(JSON.stringify({ t: "a", d: answer.slice(cut[i], cut[i + 1]) }) + "\n");
      await new Promise((ok) => setTimeout(ok, 80));
    }
    res.end(JSON.stringify({ t: "done", stop: "end_turn", badTags: [], badCites: [], model: "mock", left: 16, sig: `sig:course:${row.id}:${u.length}` }) + "\n");
    return true;
  },
};

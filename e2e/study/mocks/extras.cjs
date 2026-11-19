// Package E's part of the e2e mock (spec §8.3; §12.6.E): a member's own trap
// (P11) and the blank table (P10). The shared mock loads it for every script
// (every plugin in e2e/study/mocks/ is), so a build with VITE_STUDY_TRAPS or
// VITE_STUDY_BLANK_TABLE finds its tables, RPCs and op in any flow. It plays
// section E as the SQL does (supabase/study-schema.sql, E's markers):
//   - GET study_trap_drafts: the token's user's own rows only (RLS);
//   - rpc/study_trap_submit: the draft's shape (a lead-in that asks, 4-5
//     distinct options, the key among them, 1-6 of the lecture's slides, a
//     part of the lecture), 10 new drafts a day, a rewrite only of one's own
//     draft that has not passed;
//   - POST /api/study/ai {op:"trap_check"}: the author's draft only (404 for
//     another's), 409 "checked" once passed; db.extrasMock.verdict(draft)
//     decides ("ok" by default, or { problem }); a passed trap joins Q's bank
//     (db.practice.questions, source 'member', no author, created_by null)
//     with its key, and the draft points at it; each call is one reservation
//     (db.extrasMock.reserved);
//   - db.extrasMock.reveal(questionId): what section Z's final reveal does
//     through study_quiz__revealed (the author shows); practice never does;
//   - rpc/study_slide_tables: the group's tables by shape;
//   - rpc/study_my_card_add, origin 'table': the member's private card
//     (db.cardsMock.mine), as section C's end writes it.
// db.extrasMock.calls keeps every call (fn, who), for the privacy checks.

const now = () => new Date().toISOString();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

function cols(query) {
  return (query.get("select") || "*").split(",").map((c) => c.trim());
}
function pick(rows, query) {
  const c = cols(query);
  return rows.map((r) => (c.includes("*") ? r : Object.fromEntries(c.map((k) => [k, r[k] === undefined ? null : r[k]]))));
}

module.exports = {
  seed(db) {
    db.extrasMock = {
      drafts: [],
      calls: [],
      reserved: 0,
      seq: 0,
      /** The check's verdict for a draft: "ok", or { problem }. */
      verdict: () => "ok",
      /** Section Z's final reveal calls study_quiz__revealed: the trap's author shows. */
      reveal(questionId) {
        const q = db.practice?.questions.find((x) => x.id === questionId);
        if (!q || q.source !== "member" || q.unmasked_at) return;
        const d = db.extrasMock.drafts.find((x) => x.question_id === questionId);
        q.unmasked_at = now();
        q.author_id = d ? d.user_id : null;
      },
    };
  },

  async rest({ method, path, query, body, who, db, json: answer, refuse: deny, check }) {
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const where = `${method} ${path}`;
    const E = db.extrasMock;
    const me = who?.id ?? null;
    const member = me && db.members.some((m) => m.user_id === me);

    if (path === "/rest/v1/study_trap_drafts") {
      E.calls.push({ fn: `drafts ${method}`, who: me });
      if (method !== "GET") return refuse("permission denied for table study_trap_drafts", 403);
      check.cols("study_trap_drafts", cols(query).filter((c) => c !== "*"), where);
      const rows = E.drafts.filter((d) => d.user_id === me).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(pick(rows, query));
    }
    if (!path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (fn === "study_my_card_add" && body?.p_origin !== "table") return undefined;
    if (!["study_trap_submit", "study_slide_tables", "study_my_card_add"].includes(fn)) return undefined;
    check.rpc(fn, body, where);
    E.calls.push({ fn, who: me });
    if (!me) return refuse("not signed in");

    if (fn === "study_slide_tables") {
      if (!member || body.p_group !== db.group.id) return json([]);
      const out = [];
      for (const l of db.lectures.filter((x) => x.group_id === db.group.id && !x.deleted_at))
        for (const s of l.slides ?? [])
          (Array.isArray(s.tables) ? s.tables : []).forEach((t, i) => {
            if (!Array.isArray(t)) return;
            const rows = t.filter((r) => Array.isArray(r));
            out.push({
              lecture_id: l.id,
              slide: s.n,
              tbl: i,
              n_rows: t.length,
              n_cols: Math.max(0, ...rows.map((r) => r.length)),
              max_cell: Math.max(0, ...rows.flat().map((c) => String(c ?? "").length)),
            });
          });
      return json(out);
    }

    const lecture = db.lectures.find((l) => l.id === body.p_lecture && !l.deleted_at);
    if (!member || !lecture) return refuse("lecture not found");

    if (fn === "study_my_card_add") {
      const front = String(body.p_front ?? "").trim();
      const back = String(body.p_back ?? "").trim();
      if (front.length < 3 || front.length > 400) return refuse("front length");
      if (back.length < 1 || back.length > 300) return refuse("too long");
      const have = new Set((lecture.slides ?? []).map((s) => s.n));
      if (!(body.p_slides ?? []).every((n) => have.has(n))) return refuse("unknown slide");
      const id = hex("e5c00000", ++E.seq);
      const t = now();
      db.cardsMock.mine.push({
        id, user_id: me, group_id: db.group.id, lecture_id: lecture.id, part_idx: body.p_part, anchor: body.p_anchor ?? null, quote: "", origin: "table",
        question_id: null, comment_id: null, front, back, extra: "", slides: body.p_slides ?? [], due: t, stability: null, difficulty: null, reps: 0, lapses: 0,
        state: 0, last_review: null, suspended: false, deleted_at: null, created_at: t, updated_at: t,
      });
      return json(id);
    }

    // study_trap_submit
    const q = String(body.p_question ?? "").trim();
    const opts = (body.p_options ?? []).map((o) => String(o ?? "").trim());
    const have = new Set((lecture.slides ?? []).map((s) => s.n));
    if (!db.sections.some((s) => s.lecture_id === lecture.id && s.idx === body.p_part)) return refuse("bad parts");
    if (q.length < 8 || q.length > 400 || !/\?$/.test(q)) return refuse("bad question");
    if (opts.length < 4 || opts.length > 5 || opts.some((o) => o.length < 1 || o.length > 220) || new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return refuse("bad options");
    if (body.p_answer === null || body.p_answer < 0 || body.p_answer >= opts.length) return refuse("bad answer");
    const slides = body.p_slides ?? [];
    if (slides.length < 1 || slides.length > 6 || !slides.every((n) => have.has(n))) return refuse("bad source");
    const today = E.drafts.filter((d) => d.user_id === me && Date.now() - Date.parse(d.created_at) < 86_400_000).length;
    if (!body.p_draft && today >= 10) return refuse("daily_limit");
    const fields = {
      part_idx: body.p_part, anchor: body.p_anchor ?? null, quote: String(body.p_quote ?? "").slice(0, 200), vignette: String(body.p_vignette ?? "").trim(),
      question: q, options: opts, answer: body.p_answer, note: String(body.p_note ?? "").trim(), slides, state: "draft", problem: "", updated_at: now(),
    };
    if (body.p_draft) {
      const d = E.drafts.find((x) => x.id === body.p_draft && x.user_id === me && x.lecture_id === lecture.id && x.state !== "ok");
      if (!d) return refuse("draft not found");
      Object.assign(d, fields);
      return json(d.id);
    }
    const d = { id: hex("e5d00000", ++E.seq), user_id: me, group_id: db.group.id, lecture_id: lecture.id, question_id: null, created_at: now(), ...fields };
    E.drafts.push(d);
    return json(d.id);
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "trap_check") return undefined;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    const E = db.extrasMock;
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const n = Number(token.replace(/^tok-/, ""));
    const me = db.members.find((m) => m.user_id === `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`);
    E.calls.push({ fn: "api trap_check", who: me?.user_id ?? null, body: b });
    if (!me) return send(401, { error: "not signed in" });
    if (typeof b.draftId !== "string") return send(400, { error: "draftId required" });
    const d = E.drafts.find((x) => x.id === b.draftId && x.user_id === me.user_id);
    if (!d) return send(404, { error: "draft not found" });
    if (d.state === "ok") return send(409, { error: "checked" });
    E.reserved += 1; // reserve() → one call → settle()
    await new Promise((ok) => setTimeout(ok, 400));
    const v = E.verdict(d);
    if (v !== "ok") {
      Object.assign(d, { state: "rejected", problem: v.problem, updated_at: now() });
      return send(200, { ok: false, problem: v.problem, questionId: null });
    }
    const P = db.practice;
    const lecture = db.lectures.find((l) => l.id === d.lecture_id);
    const qid = hex("e5e00000", ++E.seq);
    // The bank's order is the server's: the key moves to the end (the SQL shuffles).
    const order = [...d.options.keys()].filter((i) => i !== d.answer).concat(d.answer);
    P.questions.push({
      id: qid, group_id: lecture.group_id, lecture_id: lecture.id, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "member",
      part_idx: d.part_idx, kind: d.vignette ? "case" : "mcq", difficulty: 2, vignette: d.vignette, question: d.question, options: order.map((i) => d.options[i]), slides: d.slides,
      topic: "Furosemide", aspect: "adverse", has_key: true, model: "member", created_by: null, created_at: now(), retired_at: null, retired_by: null, retire_note: "",
      anchor: d.anchor, quote: d.anchor === null ? "" : d.quote, part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null,
      style: null, points: [], request_id: null, author_id: null, unmasked_at: null,
    });
    P.keys.set(qid, {
      answer: order.length - 1,
      explanations: order.map((i) => (i === d.answer ? `נכון לפי השקף. [ש' ${d.slides[0]}]` : `לא לפי השקף. [ש' ${d.slides[0]}]`)),
      takeaway: `${d.options[d.answer]}. [ש' ${d.slides[0]}]`,
      whens: order.map(() => ""),
    });
    Object.assign(d, { state: "ok", problem: "", question_id: qid, updated_at: now() });
    P.notify?.("study_questions", "INSERT", P.questions[P.questions.length - 1]);
    return send(200, { ok: true, problem: "", questionId: qid });
  },
};

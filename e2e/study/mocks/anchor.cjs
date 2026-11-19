// Package N's plugin for the e2e mock (spec §8.3; §12.4.N): section N's two
// functions as the SQL answers them for the caller, over the other plugins'
// rows (db.practice: questions, answers, points; db.cardsMock: cards and
// each member's card states; the base mock's comments).
//
//   study_paragraph_chips(p_lecture)                     per paragraph with anything on it: the group's
//                                                        questions (not hidden), cards (opened), top-level
//                                                        comments, wall entries (none: J is not built), and
//                                                        the caller's wrong answers still wrong, her "לא ברור"
//   study_paragraph_practice(p_lecture, p_part, p_anchor) the paragraph's questions and cards with her state
//   study_question_still_true(p_question)                 "עדיין נכון": clears a correction's mark
//
// A question sits on its own anchor, else on the first point it covers, else
// on the first point of its part sharing a slide; a card on its own anchor
// (section C's end), else by the points, as section N places them. Strangers
// get no rows and 'lecture not found'. db.anchorCalls counts the calls by
// member, so a script can say who asked (never the reader's phone while
// reading aloud: it shows nothing).
const sameSlide = (a = [], b = []) => a.some((n) => b.includes(n));

function spots(db, lectureId) {
  const P = db.practice ?? { questions: [], answers: [], points: [] };
  const points = (P.points ?? []).filter((p) => p.lecture_id === lectureId && p.anchor !== null && p.anchor !== undefined).sort((a, b) => a.n - b.n);
  const place = (row, own, covers = []) => {
    if (own !== null && own !== undefined) return own;
    const byPoint = points.find((p) => p.part_idx === row.part_idx && covers.includes(p.id));
    if (byPoint) return byPoint.anchor;
    const bySlide = points.find((p) => p.part_idx === row.part_idx && sameSlide(p.slides, row.slides));
    return bySlide ? bySlide.anchor : null;
  };
  const questions = (P.questions ?? [])
    .filter((q) => q.lecture_id === lectureId && q.part_idx !== null && !q.retired_at && q.has_key !== false)
    .map((q) => ({ q, part: q.part_idx, anchor: place(q, q.anchor, q.points ?? []) }))
    .filter((x) => x.anchor !== null);
  const now = Date.now();
  const cards = (db.cardsMock?.cards ?? [])
    .filter((c) => c.lecture_id === lectureId && c.part_idx !== null && c.part_idx !== undefined && !c.deleted_at && (!c.opens_at || Date.parse(c.opens_at) <= now))
    .map((c) => ({ c, part: c.part_idx, anchor: place(c, c.anchor) }))
    .filter((x) => x.anchor !== null);
  return { P, questions, cards };
}

module.exports = {
  seed(db) {
    db.anchorCalls = [];
  },
  async rest({ method, path, body, who, db, json: reply, refuse: refuseWith, check }) {
    if (method !== "POST" || !(path.startsWith("/rest/v1/rpc/study_paragraph_") || path === "/rest/v1/rpc/study_question_still_true")) return undefined;
    const json = async (b, s) => {
      await reply(b, s);
      return true;
    };
    const refuse = async (m, s) => {
      await refuseWith(m, s);
      return true;
    };
    const fn = path.slice("/rest/v1/rpc/".length);
    check.rpc(fn, body, `${method} ${path}`);
    const me = who ? who.id : null;
    const lecture = db.lectures.find((l) => l.id === body?.p_lecture);
    const ok = me && lecture && !lecture.deleted_at && db.members.some((m) => m.user_id === me && m.group_id === lecture.group_id);
    db.anchorCalls.push({ fn, who: me, at: Date.now() });

    if (fn === "study_paragraph_chips") {
      if (!ok) return json([]);
      const { P, questions, cards } = spots(db, lecture.id);
      const rows = new Map();
      const row = (part, anchor) => {
        const k = `${part}.${anchor}`;
        if (!rows.has(k)) rows.set(k, { part_idx: part, anchor, questions: 0, cards: 0, comments: 0, aids: 0, my_wrong: 0, my_unclear: false });
        return rows.get(k);
      };
      for (const x of questions) if (!x.q.hidden_at) row(x.part, x.anchor).questions += 1;
      for (const x of cards) row(x.part, x.anchor).cards += 1;
      for (const c of db.comments) if (c.lecture_id === lecture.id && !c.parent_id && ["comment", "question", "answer"].includes(c.kind)) row(c.part_idx, c.anchor).comments += 1;
      const mine = (P.answers ?? []).filter((a) => a.user_id === me);
      for (const x of questions) {
        const own = mine.filter((a) => a.question_id === x.q.id).sort((a, b) => (a.answered_at < b.answered_at ? 1 : -1));
        if (own.length && !own[0].correct) row(x.part, x.anchor).my_wrong += own.filter((a) => !a.correct).length;
      }
      return json([...rows.values()].sort((a, b) => a.part_idx - b.part_idx || a.anchor - b.anchor));
    }

    // "עדיין נכון" on a question a correction marked (section Q's end): back for the whole group (review SEC4-1).
    if (fn === "study_question_still_true") {
      const P = db.practice ?? { questions: [] };
      const q = P.questions.find((x) => x.id === body.p_question);
      if (!me) return refuse("not signed in");
      const lec = q && db.lectures.find((l) => l.id === q.lecture_id);
      if (!q || !lec || !db.members.some((m) => m.user_id === me && m.group_id === lec.group_id)) return refuse("question not found");
      if (q.stale_at) Object.assign(q, { stale_at: null, stale_edit: null, checked_by: me, checked_at: new Date().toISOString() });
      db.anchorStillTrue = [...(db.anchorStillTrue ?? []), { who: me, question: q.id }];
      return json(null);
    }

    if (fn === "study_paragraph_practice") {
      if (!me) return refuse("not signed in");
      if (!ok) return refuse("lecture not found");
      const { P, questions, cards } = spots(db, lecture.id);
      const here = (x) => x.part === body.p_part && x.anchor === body.p_anchor;
      const mine = (P.answers ?? []).filter((a) => a.user_id === me);
      const qs = questions
        .filter(here)
        .map(({ q }) => {
          const own = mine.filter((a) => a.question_id === q.id).sort((a, b) => (a.answered_at < b.answered_at ? 1 : -1));
          return {
            id: q.id, kind: q.kind, style: q.style ?? null, question: q.question, teaser: q.teaser ?? "", stale: Boolean(q.stale_at), hidden: Boolean(q.hidden_at),
            answered: own.length, wrong: own.filter((a) => !a.correct).length, last_correct: own.length ? own[0].correct : null, created_at: q.created_at,
          };
        })
        .sort((a, b) => Number(a.hidden) - Number(b.hidden) || (a.created_at < b.created_at ? -1 : 1))
        .map(({ created_at: _c, ...q }) => q);
      const states = db.cardsMock?.states ?? new Map();
      const cs = cards.filter(here).map(({ c }) => {
        const s = states.get(`${me}:${c.id}`);
        return { id: c.id, kind: c.kind, front: c.front, source: c.source ?? "ai", stale: Boolean(c.stale_at), in_deck: Boolean(s && !s.suspended), lapses: s?.lapses ?? 0 };
      });
      return json({ questions: qs, cards: cs });
    }
    return undefined;
  },
};

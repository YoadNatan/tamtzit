// Package T's plugin for the e2e mock (spec §8.3; §12.4.T): section T's one
// call, study_today, as the SQL answers it for the caller, over the other
// plugins' rows (a JavaScript port of supabase/study-schema.sql's section T):
//
//   rpc/study_today   "group not found" for a stranger; for a member her own
//                     quiz returns and danger row (db.todayMock.returns and
//                     .danger, seeded by the script: due until she answers the
//                     question again, practice's db.practice.answers), her
//                     "לא ברור" taps of an earlier day (section M's
//                     db.meetingMock.taps, not done), her unseen "עדכון" rows
//                     (section V's db.updates with K's db.edits), the meetings
//                     she missed (db.meetingMock: started on an earlier day of
//                     the last 7, no presence, tap, guess or catch-up), the
//                     newest open question of another member (db.comments),
//                     and her flame (db.todayMock.flame by member, else 0/7);
//                     "loot" is H's (db.bossMock.due: her own due loot);
//                     "needs_me" is T-2's, from G's plugin (mocks/plan.cjs:
//                     db.needsMeRows), only for a member who opted in.
//                     Each question row carries its stem, kind and slides, never
//                     its key.
//
// db.todayMock.calls logs every call (fn, who), so the script says that
// nothing of T is called without its flag, and .bodies every answer, for the
// privacy check (no key, no other member's rows).
const iso = (ms) => new Date(ms).toISOString();
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

module.exports = {
  seed(db) {
    db.todayMock = { returns: [], danger: [], flame: new Map(), calls: [], bodies: [] };
  },

  async rest({ method, path, body, who, db, json: reply, refuse: refuseWith, check }) {
    // Handled: the mock stops at a plugin that answers true.
    const json = async (b, st) => (await reply(b, st), true);
    const refuse = async (m, st) => (await refuseWith(m, st), true);
    const T = db.todayMock;
    if (!T || method !== "POST" || path !== "/rest/v1/rpc/study_today") return undefined;
    check.rpc("study_today", body, `${method} ${path}`);
    const me = who ? who.id : null;
    T.calls.push({ fn: "study_today", who: me, at: Date.now() });
    if (!me) return refuse("not signed in", 401);
    const g = body.p_group;
    if (!(db.group.id === g && db.members.some((m) => m.user_id === me))) return refuse("group not found");
    const today = dayOf(Date.now());
    const lecture = (id) => db.lectures.find((l) => l.id === id && l.group_id === g && !l.deleted_at);
    const P = db.practice;
    const qOf = (id) => P?.questions.find((q) => q.id === id);
    const answeredSince = (qid, at) => (P?.answers ?? []).some((a) => a.user_id === me && a.question_id === qid && a.answered_at > at);
    const stem = (qid) => {
      const q = qOf(qid);
      return q ? { question: q.question, kind: q.kind, slides: q.slides ?? [], lecture_title: lecture(q.lecture_id)?.title ?? null } : null;
    };
    const live = (q) => q && !q.retired_at && !q.hidden_at && !q.stale_at && q.has_key;

    const quiz_returns = T.returns
      .filter((r) => r.user_id === me && live(qOf(r.question_id)) && !answeredSince(r.question_id, r.seen_at ?? r.wrong_at))
      .map(({ user_id, seen_at, ...r }) => ({ ...r, ...stem(r.question_id) }))
      .sort((a, b) => a.step - b.step || (a.wrong_at < b.wrong_at ? -1 : 1));
    const danger = T.danger
      .filter((d) => d.user_id === me && live(qOf(d.ask_id)) && !answeredSince(d.ask_id, d.seen_at ?? d.wrong_at))
      .slice(0, 1)
      .map(({ user_id, seen_at, ...d }) => ({ ...d, other_wording: d.ask_id !== d.question_id, ...stem(d.ask_id) }));

    const M = db.meetingMock;
    const unclear = (M?.taps ?? [])
      .filter((t) => t.user_id === me && !t.done_at && dayOf(t.at) < today && t.at > Date.now() - 14 * 86_400_000 && lecture(t.lecture_id))
      .sort((a, b) => a.at - b.at)
      .map((t) => ({
        tap_id: t.id, meeting_id: t.meeting_id, lecture_id: t.lecture_id, lecture_title: lecture(t.lecture_id).title, part_idx: t.part, anchor: t.anchor, quote: t.quote, tapped_at: iso(t.at),
        explained: (M.events ?? []).some((e) => e.meeting_id === t.meeting_id && e.kind === "explain" && e.part === t.part && e.anchor === t.anchor), thread: "none", comment_id: null,
      }));
    const missed = (M?.meetings ?? [])
      .filter(
        (m) =>
          m.group_id === g && !m.cancelled_at && m.started_at && m.day < today && m.day > addDays(today, -7) && lecture(m.lecture_id) &&
          !M.presence.has(`${m.id}:${me}`) && !M.taps.some((t) => t.meeting_id === m.id && t.user_id === me) &&
          !M.guesses.some((x) => x.meeting_id === m.id && x.user_id === me) && !M.catchups.some((c) => c.meeting_id === m.id && c.user_id === me),
      )
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .map((m) => ({ meeting_id: m.id, lecture_id: m.lecture_id, lecture_title: lecture(m.lecture_id).title, title: m.title || null, day: m.day }));

    const name = (id) => db.members.find((m) => m.user_id === id)?.name ?? null;
    const updates = (db.updates ?? [])
      .filter((u) => u.user_id === me && !u.seen_at)
      .map((u) => {
        const e = (db.edits ?? []).find((x) => x.id === u.edit_id);
        const l = lecture(u.lecture_id);
        if (!e || !l) return null;
        return {
          id: u.id, edit_id: u.edit_id, lecture_id: u.lecture_id, lecture_title: l.title, part_idx: u.part_idx, anchor: u.anchor, kind: e.kind, before_text: e.before_text, after_text: e.after_text,
          author: name(e.author_id), approver: name(e.approved_by), aloud: Boolean(e.aloud), source_kind: e.source_kind ?? null, source_slides: e.source_slides ?? null, source_at: e.source_at ?? null,
          source_note: e.source_note ?? null, reason: u.reason, reason_at: u.reason_at, created_at: u.created_at,
        };
      })
      .filter(Boolean);

    const q = db.comments
      .filter((c) => c.kind === "question" && !c.parent_id && !c.resolved && c.author_id !== me && lecture(c.lecture_id))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    const open_question = q
      ? { id: q.id, lecture_id: q.lecture_id, lecture_title: lecture(q.lecture_id).title, part: q.part_idx, anchor: q.anchor, quote: q.quote, body: q.body, author_id: q.author_id, created_at: q.created_at }
      : null;

    const days = Math.min(7, T.flame.get(me) ?? 0);
    const out = {
      quiz_returns, danger, unclear, updates, loot: db.bossMock?.due?.(me) ?? [], missed, needs_me: db.needsMeRows ? db.needsMeRows(me) : [], open_question,
      flame: { days, lit: days >= 4, list: Array.from({ length: days }, (_, i) => addDays(today, -i)) },
      day: today,
    };
    T.bodies.push({ who: me, body: JSON.stringify(out) });
    return json(out);
  },
};

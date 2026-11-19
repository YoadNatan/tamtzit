// Package A2's plugin for the e2e mock (spec §8.3; §12.3.A, §12.3.Q's Q-2):
// section P's end and Q's "another wording" as the SQL answers them for the
// caller, over package Q's rows (db.practice: questions, keys, answers) and
// the base mock's lectures and parts. Every read is the caller's own; a
// stranger gets 'group not found'.
//
//   study_my_readiness(p_group)            per part: first answers a day (28 days), a 68% Wilson range from 20
//   study_my_danger_list(p_group)          wrong "על בטוח" answers until two right "על בטוח" on later days
//   study_my_aspects(p_group, p_lecture?)  latest answer per question; a bucket from 4 questions
//   study_my_calibration(p_group)          "על בטוח" first answers a day (60 days): part, lecture, all
//   study_my_rewordings(p_group)           open mistakes from an earlier day, and what to ask instead
//   study_my_progress_counts(p_group)      the counts in one call
//
// db.progressCalls counts the calls by function, so a script can say that a
// build without progress never asked.
const DAY = 86_400_000;
/** study_day(): days since 1970-01-01 of the Israel date, the day starting at 04:00. */
const studyDay = (iso) => {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(iso) - 4 * 3_600_000));
  return Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
};
const dayText = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const FNS = new Set(["study_my_readiness", "study_my_danger_list", "study_my_aspects", "study_my_calibration", "study_my_rewordings", "study_my_progress_counts"]);

/** The 68% Wilson range (z = 1), its ends rounded to 5%, as section P's end computes it. */
function wilson(n, r) {
  const p = r / n;
  const c = (p + 1 / (2 * n)) / (1 + 1 / n);
  const h = Math.sqrt((p * (1 - p)) / n + 1 / (4 * n * n)) / (1 + 1 / n);
  return { lo: Math.max(0, Math.round(20 * (c - h)) * 5), hi: Math.min(100, Math.round(20 * (c + h)) * 5) };
}

function reads(db, me, group, nowIso) {
  const P = db.practice ?? { questions: [], keys: new Map(), answers: [] };
  const now = Date.parse(nowIso);
  const qOf = (id) => P.questions.find((q) => q.id === id);
  const lectureLive = (id) => db.lectures.some((l) => l.id === id && !l.deleted_at);
  const mine = P.answers
    .filter((a) => a.user_id === me && Date.parse(a.answered_at) <= now)
    .map((a) => ({ ...a, q: qOf(a.question_id), d: studyDay(a.answered_at) }))
    .filter((a) => a.q && a.q.group_id === group)
    .sort((a, b) => (a.answered_at < b.answered_at ? -1 : a.answered_at > b.answered_at ? 1 : String(a.id ?? "") < String(b.id ?? "") ? -1 : 1));
  /** The first answer per question per study day. */
  const firstADay = (rows) => {
    const seen = new Set();
    return rows.filter((a) => {
      const k = `${a.question_id}:${a.d}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const today = studyDay(nowIso);

  const readiness = () => {
    const ev = firstADay(mine.filter((a) => a.q.lecture_id && a.q.part_idx !== null && a.q.part_idx !== undefined && !a.q.retired_at && lectureLive(a.q.lecture_id) && now - Date.parse(a.answered_at) < 28 * DAY));
    const by = new Map();
    for (const a of ev) {
      const k = `${a.q.lecture_id}:${a.q.part_idx}`;
      const row = by.get(k) ?? { lecture_id: a.q.lecture_id, part_idx: a.q.part_idx, n: 0, r: 0 };
      row.n += 1;
      if (a.correct) row.r += 1;
      by.set(k, row);
    }
    return [...by.values()]
      .sort((a, b) => (a.lecture_id < b.lecture_id ? -1 : a.lecture_id > b.lecture_id ? 1 : a.part_idx - b.part_idx))
      .map((x) => {
        const range = x.n >= 20 ? wilson(x.n, x.r) : { lo: null, hi: null };
        const heading = db.sections.find((s) => s.lecture_id === x.lecture_id && s.idx === x.part_idx)?.title ?? "";
        return { lecture_id: x.lecture_id, part_idx: x.part_idx, heading, answers: x.n, right_n: x.r, ...range };
      });
  };

  const danger = () => {
    const recent = mine.filter((a) => !a.q.retired_at && now - Date.parse(a.answered_at) < 60 * DAY);
    const start = new Map();
    for (const a of recent) if (!a.correct && a.confidence === 3 && !a.q.hidden_at) start.set(a.question_id, a); // the latest wins (sorted ascending)
    const out = [];
    for (const s of start.values()) {
      const sameSpot = (r) => r.question_id === s.question_id || (s.q.anchor !== null && s.q.anchor !== undefined && r.q.lecture_id === s.q.lecture_id && r.q.part_idx === s.q.part_idx && r.q.anchor === s.q.anchor);
      const days = [...new Set(recent.filter((r) => r.correct && r.confidence === 3 && r.d > s.d && sameSpot(r)).map((r) => r.d))].sort((a, b) => a - b);
      if (days.length >= 2) continue;
      const k = P.keys.get(s.question_id);
      if (!k) continue;
      const lastSeen = (id) => P.answers.filter((a) => a.user_id === me && a.question_id === id).map((a) => a.answered_at).sort().pop() ?? "";
      const other = s.q.anchor === null || s.q.anchor === undefined
        ? null
        : P.questions
            .filter((q2) => q2.id !== s.question_id && q2.lecture_id === s.q.lecture_id && q2.part_idx === s.q.part_idx && q2.anchor === s.q.anchor && !q2.retired_at && q2.has_key !== false && !q2.hidden_at && !q2.stale_at)
            .sort((a, b) => (lastSeen(a.id) < lastSeen(b.id) ? -1 : lastSeen(a.id) > lastSeen(b.id) ? 1 : a.created_at < b.created_at ? -1 : 1))[0];
      out.push({
        question_id: s.question_id,
        lecture_id: s.q.lecture_id,
        wrong_at: s.answered_at,
        chosen: s.choice === null || s.choice === undefined ? "" : (s.q.options[s.choice] ?? ""),
        right_text: s.q.options[k.answer] ?? "",
        slides: s.q.slides ?? [],
        rights: days.length,
        due_day: dayText(days.length ? days[0] + 3 : s.d + 1),
        ask_id: other ? other.id : s.question_id,
      });
    }
    return out.sort((a, b) => (a.due_day < b.due_day ? -1 : a.due_day > b.due_day ? 1 : a.wrong_at < b.wrong_at ? -1 : 1));
  };

  const aspects = (lecture) => {
    const latest = new Map();
    for (const a of mine) if (!a.q.retired_at && a.q.has_key !== false && (!lecture || (a.q.lecture_id ?? a.q.ref_lecture) === lecture)) latest.set(a.question_id, a);
    const by = new Map();
    for (const a of latest.values()) {
      const row = by.get(a.q.aspect) ?? { aspect: a.q.aspect, questions: 0, wrong_now: 0 };
      row.questions += 1;
      if (!a.correct) row.wrong_now += 1;
      by.set(a.q.aspect, row);
    }
    return [...by.values()]
      .map((r) => ({ ...r, bucket: r.questions < 4 ? null : r.wrong_now * 2 >= r.questions ? "hot" : r.wrong_now * 4 >= r.questions ? "warm" : "cool" }))
      .sort((a, b) => Number(b.questions >= 4) - Number(a.questions >= 4) || b.wrong_now - a.wrong_now || b.questions - a.questions || (a.aspect < b.aspect ? -1 : 1));
  };

  const calibration = () => {
    const ev = firstADay(mine.filter((a) => a.confidence === 3 && now - Date.parse(a.answered_at) < 60 * DAY));
    const pct = (n, r) => (n >= 20 ? Math.round((100 * r) / n) : null);
    const group = (key) => {
      const by = new Map();
      for (const a of ev) {
        const k = key(a);
        if (k === null) continue;
        const row = by.get(k) ?? { n: 0, r: 0, a };
        row.n += 1;
        if (a.correct) row.r += 1;
        by.set(k, row);
      }
      return [...by.values()].sort((x, y) => y.n - x.n);
    };
    const parts = group((a) => (a.q.lecture_id && a.q.part_idx !== null ? `${a.q.lecture_id}:${a.q.part_idx}` : null)).map((x) => ({ scope: "part", lecture_id: x.a.q.lecture_id, part_idx: x.a.q.part_idx, sure: x.n, sure_right: x.r, pct: pct(x.n, x.r) }));
    const lectures = group((a) => a.q.lecture_id ?? null).map((x) => ({ scope: "lecture", lecture_id: x.a.q.lecture_id, part_idx: null, sure: x.n, sure_right: x.r, pct: pct(x.n, x.r) }));
    const all = ev.length ? [{ scope: "all", lecture_id: null, part_idx: null, sure: ev.length, sure_right: ev.filter((a) => a.correct).length, pct: pct(ev.length, ev.filter((a) => a.correct).length) }] : [];
    return [...parts, ...lectures, ...all];
  };

  /** study_open_mistakes with Q's end: cleared by a right answer on a later day, to it or to its paragraph. */
  const openMistakes = () => {
    const wrong = new Map();
    for (const a of mine) if (!a.correct) wrong.set(a.question_id, a);
    const out = [];
    for (const w of wrong.values()) {
      if (w.q.retired_at || w.q.hidden_at) continue;
      const cleared = mine.some(
        (r) => r.correct && r.d > w.d && (r.question_id === w.question_id || (w.q.anchor !== null && w.q.anchor !== undefined && r.question_id !== w.question_id && r.q.lecture_id === w.q.lecture_id && r.q.part_idx === w.q.part_idx && r.q.anchor === w.q.anchor)),
      );
      if (!cleared) out.push(w);
    }
    return out;
  };
  const rewordings = () =>
    openMistakes()
      .filter((m) => m.d < today)
      .sort((a, b) => (a.answered_at < b.answered_at ? -1 : 1))
      .map((m) => {
        const s =
          m.q.anchor === null || m.q.anchor === undefined
            ? null
            : P.questions.find(
                (q2) =>
                  q2.id !== m.question_id && q2.lecture_id === m.q.lecture_id && q2.part_idx === m.q.part_idx && q2.anchor === m.q.anchor && !q2.retired_at && !q2.hidden_at && !q2.stale_at && q2.has_key !== false &&
                  !P.answers.some((a) => a.user_id === me && a.question_id === q2.id && a.correct && a.answered_at > m.answered_at),
              );
        return { question_id: m.question_id, wrong_at: m.answered_at, ask_kind: s ? "question" : "same", ask_question: s ? s.id : m.question_id, ask_card: null };
      });

  return { readiness, danger, aspects, calibration, rewordings, openMistakes, today };
}

module.exports = {
  seed(db) {
    db.progressCalls = [];
  },
  async rest({ method, path, body, who, db, json: reply, refuse: refuseWith, check }) {
    if (method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (!FNS.has(fn)) return undefined;
    check.rpc(fn, body, `${method} ${path}`);
    const me = who ? who.id : null;
    db.progressCalls.push({ fn, who: me });
    const member = me && db.members.some((m) => m.user_id === me) && body?.p_group === db.group.id;
    if (!member) {
      await refuseWith("group not found");
      return true;
    }
    const r = reads(db, me, body.p_group, new Date().toISOString());
    let out;
    switch (fn) {
      case "study_my_readiness":
        out = r.readiness();
        break;
      case "study_my_danger_list":
        out = r.danger();
        break;
      case "study_my_aspects":
        out = r.aspects(body.p_lecture ?? null);
        break;
      case "study_my_calibration":
        out = r.calibration();
        break;
      case "study_my_rewordings":
        out = r.rewordings();
        break;
      case "study_my_progress_counts": {
        const ready = r.readiness();
        const all = r.calibration().find((c) => c.scope === "all");
        const danger = r.danger();
        const todayText = dayText(r.today);
        out = [
          {
            answers: ready.reduce((n, x) => n + x.answers, 0),
            parts: ready.length,
            parts_ranged: ready.filter((x) => x.lo !== null).length,
            sure: all?.sure ?? 0,
            sure_right: all?.sure_right ?? 0,
            danger: danger.length,
            danger_due: danger.filter((d) => d.due_day <= todayText).length,
            mistakes: r.openMistakes().length,
            rewordings_due: r.rewordings().length,
            again_due: new Set([...danger.filter((d) => d.due_day <= todayText).map((d) => d.question_id), ...r.rewordings().map((w) => w.question_id)]).size,
          },
        ];
        break;
      }
    }
    await reply(out);
    return true;
  },
  // For the scripts: the same reads, to compare a screen with what the SQL would say.
  reads,
  studyDay,
  dayText,
};

// Package M's plugin for the e2e mock (spec §8.3; §12.4.M): section M's
// functions as the SQL answers them for the caller, a JavaScript port of
// supabase/study-schema.sql's section M over the other plugins' rows
// (db.practice: questions and keys; db.quiz: the quizzes; the base mock's
// comments and reads). The table study_meetings is the base mock's
// (members read it; Realtime sends its rows on every change).
//
//   study_meeting_save, _cancel           planning, its errors and versions
//   study_meeting_reading, _place, _here   one reader at a time (a minute of silence hands over), a
//                                          part at a time, guesses released with two others following
//   study_meeting_unclear, _reader_view    taps (never the reader's), the card from 3 others, no text
//   study_meeting_stop, _quiz              the reader's answers; the opening, the closing and the stop
//   study_meeting_guess_pick, _guess, _guess_state   the pre-guess, majority words from 3
//   study_meeting_agenda, _band, study_my_unclear, study_unclear_done
//   study_my_missed, study_meeting_catchup, _catchup_done (the read mark the next study day)
//
// db.meetingMock.calls logs every call by member (fn, who, at), so a script
// says who asked (never a follower's reader_view), and .bodies every
// response, for the privacy checks (no key before a guess's release, no
// count below 3). db.meetingMock.pickPreset is section Z's hook for "3 לקפה".
// Time: E2E_LIVE_MS (60000) for "a place within the last minute",
// E2E_FOLLOW_MS (600000) for a follower's presence.
const LIVE = Number(process.env.E2E_LIVE_MS || 60_000);
const FOLLOW = Number(process.env.E2E_FOLLOW_MS || 600_000);
const iso = (ms) => new Date(ms).toISOString();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ROW = ["id", "group_id", "day", "starts_at", "lecture_id", "part_from", "part_to", "title", "planned_reader", "reader_id", "reading", "started_at", "read_part", "guess_ids", "guess_released", "cancelled_at", "version", "created_by", "updated_by", "created_at", "updated_at"];

module.exports = {
  seed(db) {
    db.meetingMock = {
      meetings: [],
      live: new Map(), // meeting id -> { part, anchor, max_part, max_anchor, at }
      taps: [],
      events: [],
      presence: new Map(), // `${meeting}:${user}` -> { first, last }
      guesses: [],
      catchups: [],
      calls: [],
      bodies: [],
      log: [],
      seq: 0,
      pickPreset: null,
      // study_private.meeting_reads_live, for K's "אישור בקול" (K's plugin asks it).
      readsLive: (lectureId, userId) => {
        const M = db.meetingMock;
        const d = dayOf(Date.now());
        return M.meetings.some((m) => {
          const lv = M.live.get(m.id);
          if (m.lecture_id !== lectureId || m.cancelled_at || !m.reading || m.reader_id !== userId || m.day !== d || !lv || lv.at < Date.now() - LIVE) return false;
          const others = [...M.presence.entries()].filter(([k, p]) => k.startsWith(`${m.id}:`) && !k.endsWith(`:${userId}`) && p.last > Date.now() - FOLLOW).length;
          return others >= 2;
        });
      },
    };
  },

  async rest({ method, path, body, who, db, notify, json: reply, refuse: refuseWith, check }) {
    const M = db.meetingMock;
    if (!M || method !== "POST") return undefined;
    const fn = path.startsWith("/rest/v1/rpc/") ? path.slice("/rest/v1/rpc/".length) : "";
    if (!/^study_(meeting_|my_unclear$|unclear_done$|my_missed$)/.test(fn)) return undefined;
    check.rpc(fn, body, `${method} ${path}`);
    const me = who ? who.id : null;
    M.calls.push({ fn, who: me, at: Date.now() });
    const json = async (b, s) => {
      M.bodies.push({ fn, who: me, body: JSON.stringify(b ?? null) });
      await reply(b, s);
      return true;
    };
    const refuse = async (m, s) => {
      M.log.push(`${fn} ${who?.user_metadata?.full_name ?? "?"}: ${m}`);
      await refuseWith(m, s);
      return true;
    };
    if (!me) return refuse("not signed in", 401);

    const P = db.practice ?? { questions: [], keys: new Map(), answers: [] };
    const Z = db.quiz ?? { quizzes: [], rounds: [], players: [], answers: [] };
    const now = () => Date.now();
    const today = () => dayOf(now());
    const isMember = (g) => db.members.some((m) => m.group_id === g && m.user_id === me);
    const nameOf = (u) => db.members.find((m) => m.user_id === u)?.name ?? null;
    const lectureOf = (id) => db.lectures.find((l) => l.id === id);
    const groupOf = (lecture) => lectureOf(lecture)?.group_id ?? null;
    const sectionsOf = (lecture) => db.sections.filter((s) => s.lecture_id === lecture).sort((a, b) => a.idx - b.idx);
    const hasPart = (lecture, idx) => sectionsOf(lecture).some((s) => s.idx === idx);
    const meetingOf = (id) => M.meetings.find((m) => m.id === id);
    const send = (m, type = "UPDATE") => notify("study_meetings", type, Object.fromEntries(ROW.map((k) => [k, m[k] === undefined ? null : m[k]])));
    const bump = (m) => {
      m.version += 1;
      m.updated_at = iso(now());
      send(m);
    };
    const here = (mid, u) => {
      const k = `${mid}:${u}`;
      const p = M.presence.get(k);
      if (p) p.last = now();
      else M.presence.set(k, { first: now(), last: now() });
    };
    const followers = (mid, u) => [...M.presence.entries()].filter(([k, p]) => k.startsWith(`${mid}:`) && !k.endsWith(`:${u}`) && p.last > now() - FOLLOW).length;
    const questionOf = (id) => P.questions.find((q) => q.id === id);
    const keyOf = (id) => P.keys.get(id) ?? null;
    // Section M 3: text questions with one answer only (no picture, no set, no later step).
    const usable = (q) =>
      q && !q.retired_at && !q.stale_at && !q.hidden_at && q.has_key !== false && keyOf(q.id) && (q.form ?? "one") === "one" && (q.step ?? 1) === 1 && !["label", "image"].includes(q.style ?? "");
    const quizzesOf = (mid) => Z.quizzes.filter((z) => z.meeting_id === mid);
    const over = (m) =>
      !m.cancelled_at && (m.day < today() || (m.started_at && Date.parse(m.started_at) < now() - 4 * 3_600_000) || quizzesOf(m.id).some((z) => z.preset === "end" && z.state === "ended"));
    const partsTitle = (m, upto = m.part_to) => sectionsOf(m.lecture_id).filter((s) => s.idx >= m.part_from && s.idx <= upto).map((s) => s.title).join(" · ");
    const slideFrom = (m) => sectionsOf(m.lecture_id).find((s) => s.idx === m.part_from)?.slide_from ?? null;
    const slideTo = (m) => sectionsOf(m.lecture_id).find((s) => s.idx === m.part_to)?.slide_to ?? null;
    const memberOf = (m) => m && isMember(m.group_id);

    // Section Z's hook for "3 לקפה" (study_quiz__pick_preset): two from the parts read at the previous
    // meeting day, one older, never today's unread parts; a teaser first, then the oldest (deterministic here).
    M.pickPreset = (z) => {
      const m = meetingOf(z.meeting_id);
      if (!m) return null;
      const prevDay = M.meetings.filter((y) => y.group_id === z.group_id && y.day < m.day && !y.cancelled_at && y.started_at).map((y) => y.day).sort().pop();
      const readTo = Math.max(-1, ...M.meetings.filter((y) => y.group_id === z.group_id && y.lecture_id === m.lecture_id && y.day < m.day && !y.cancelled_at).map((y) => y.read_part ?? -1));
      const todays = (q) => q.lecture_id === m.lecture_id && q.part_idx >= m.part_from && q.part_idx <= m.part_to && q.part_idx > readTo;
      const pool = P.questions.filter((q) => q.group_id === z.group_id && z.lecture_ids.includes(q.lecture_id) && usable(q) && !todays(q));
      const recent = (q) => M.meetings.some((y) => y.group_id === z.group_id && y.day === prevDay && !y.cancelled_at && y.lecture_id === q.lecture_id && q.part_idx >= y.part_from && q.part_idx <= Math.max(y.part_from, y.read_part ?? y.part_to));
      const order = (a, b) => Number(Boolean(b.teaser)) - Number(Boolean(a.teaser)) || (a.created_at < b.created_at ? -1 : 1);
      const pick = pool.filter(recent).sort(order).slice(0, 2);
      const more = pool.filter((q) => !pick.includes(q)).sort((a, b) => Number(recent(b)) - Number(recent(a)) || order(a, b)).slice(0, 3 - pick.length);
      return [...pick, ...more].map((q) => q.id);
    };

    switch (fn) {
      case "study_meeting_save": {
        const g = body.p_group;
        if (!g || !isMember(g)) return refuse("group not found");
        const l = lectureOf(body.p_lecture);
        if (!l || l.group_id !== g || l.deleted_at) return refuse("lecture not found");
        const pf = body.p_part_from;
        const pt = body.p_part_to;
        if (pf === null || pt === null || pf < 0 || pt < pf || !hasPart(l.id, pf) || !hasPart(l.id, pt)) return refuse("bad parts");
        const at = Date.parse(body.p_starts_at);
        if (!Number.isFinite(at) || at < now() - 12 * 3_600_000 || at > now() + 14 * 86_400_000) return refuse("bad time");
        if ((body.p_title ?? "").length > 120) return refuse("bad title");
        // M 2: p_reader (an old copy still sends it) is ignored; no reader is planned ahead.
        if ("p_reader" in body) M.readerSent = (M.readerSent ?? 0) + 1;
        const d = dayOf(at);
        const clash = (id) => M.meetings.some((x) => x.id !== id && x.group_id === g && x.day === d && x.lecture_id === l.id && !x.cancelled_at);
        if (!body.p_id) {
          if (clash(null)) return refuse("meeting exists");
          const t = iso(now());
          const m = {
            id: hex("3e000000", ++M.seq), group_id: g, day: d, starts_at: iso(at), lecture_id: l.id, part_from: pf, part_to: pt, title: (body.p_title ?? "").trim(),
            planned_reader: null, reader_id: null, reading: false, started_at: null, read_part: null, guess_ids: [], guess_released: 0, cancelled_at: null,
            version: 1, created_by: me, updated_by: null, created_at: t, updated_at: t,
          };
          M.meetings.push(m);
          send(m, "INSERT");
          return json([{ id: m.id, version: 1 }]);
        }
        const m = meetingOf(body.p_id);
        if (!m || m.group_id !== g || m.cancelled_at) return refuse("meeting not found");
        if (m.version !== body.p_version) return refuse("conflict");
        // Review SEC4-2: a started meeting keeps its lecture, parts and day.
        if ((m.started_at || m.reading) && (m.lecture_id !== l.id || m.part_from !== pf || m.part_to !== pt || m.day !== d)) return refuse("meeting started");
        if (clash(m.id)) return refuse("meeting exists");
        const keep = m.lecture_id === l.id && m.part_from === pf;
        Object.assign(m, { day: d, starts_at: iso(at), lecture_id: l.id, part_from: pf, part_to: pt, title: (body.p_title ?? "").trim(), updated_by: me });
        if (!keep) Object.assign(m, { guess_ids: [], guess_released: 0 });
        bump(m);
        return json([{ id: m.id, version: m.version }]);
      }
      case "study_meeting_cancel": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (m.started_at) return refuse("meeting started");
        m.cancelled_at = iso(now());
        bump(m);
        return json(null);
      }
      case "study_meeting_reading": {
        const l = lectureOf(body.p_lecture);
        if (!l || !isMember(l.group_id) || l.deleted_at) return refuse("lecture not found");
        let m = M.meetings.find((x) => x.group_id === l.group_id && x.day === today() && x.lecture_id === l.id && !x.cancelled_at);
        if (!body.p_on) {
          if (m && m.reader_id === me && m.reading) {
            m.reading = false;
            bump(m);
          }
          return json(m?.id ?? null);
        }
        const lv0 = m ? M.live.get(m.id) : null;
        if (m && m.reading && m.reader_id !== me && lv0 && lv0.at > now() - LIVE) return refuse("reading");
        let pt = Math.max(0, Math.min(body.p_part ?? 0, 199));
        let an = Math.max(0, Math.min(body.p_anchor ?? 0, 99999));
        if (!hasPart(l.id, pt)) {
          pt = sectionsOf(l.id)[0]?.idx ?? 0;
          an = 0;
        }
        if (!m) {
          const t = iso(now());
          m = {
            id: hex("3e000000", ++M.seq), group_id: l.group_id, day: today(), starts_at: t, lecture_id: l.id, part_from: pt, part_to: pt, title: "", planned_reader: null, reader_id: null,
            reading: false, started_at: null, read_part: null, guess_ids: [], guess_released: 0, cancelled_at: null, version: 1, created_by: me, updated_by: null, created_at: t, updated_at: t,
          };
          M.meetings.push(m);
          send(m, "INSERT");
        }
        Object.assign(m, { reader_id: me, reading: true, started_at: m.started_at ?? iso(now()), read_part: Math.max(m.read_part ?? pt, pt) });
        const lv = M.live.get(m.id);
        M.live.set(m.id, { part: pt, anchor: an, max_part: lv ? lv.max_part : pt, max_anchor: lv ? lv.max_anchor : an, at: now() });
        here(m.id, me);
        bump(m);
        return json(m.id);
      }
      case "study_meeting_place": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m)) return refuse("meeting not found");
        if (m.reader_id !== me || !m.reading) return refuse("not the reader");
        let pt = Math.max(0, Math.min(body.p_part ?? 0, 199));
        let an = Math.max(0, Math.min(body.p_anchor ?? 0, 99999));
        if (!hasPart(m.lecture_id, pt)) return refuse("bad parts");
        let lv = M.live.get(m.id);
        if (lv && pt > lv.max_part + 1) {
          pt = lv.max_part + 1;
          an = 0;
        }
        if (!lv) lv = { part: pt, anchor: an, max_part: pt, max_anchor: an, at: now() };
        const further = pt > lv.max_part || (pt === lv.max_part && an > lv.max_anchor);
        lv = { part: pt, anchor: an, max_part: further ? pt : lv.max_part, max_anchor: further ? an : lv.max_anchor, at: now() };
        M.live.set(m.id, lv);
        let rel = m.guess_released;
        if (followers(m.id, me) >= 2) {
          while (rel < m.guess_ids.length) {
            const q = questionOf(m.guess_ids[rel]);
            if (!q || q.part_idx === null || q.part_idx > lv.max_part || (q.part_idx === lv.max_part && (q.anchor ?? 0) > lv.max_anchor)) break;
            rel += 1;
          }
        }
        if (rel !== m.guess_released || lv.max_part > (m.read_part ?? -1)) {
          m.guess_released = rel;
          m.read_part = Math.max(m.read_part ?? lv.max_part, lv.max_part);
          bump(m);
        }
        return json(rel);
      }
      case "study_meeting_here": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (m.day === today()) here(m.id, me);
        return json(null);
      }
      case "study_meeting_unclear": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (body.p_on === false) {
          M.taps = M.taps.filter((t) => !(t.meeting_id === m.id && t.user_id === me && t.part === body.p_part && t.anchor === body.p_anchor && !t.done_at));
          return json(false);
        }
        if (!m.reading) return refuse("not live");
        if (m.reader_id === me) return refuse("is reader");
        if (body.p_anchor === null || body.p_anchor < 0 || !hasPart(m.lecture_id, body.p_part)) return refuse("bad parts");
        if (!M.taps.some((t) => t.meeting_id === m.id && t.user_id === me && t.part === body.p_part && t.anchor === body.p_anchor)) {
          // review SEC-11: no text from the phone is kept
          M.taps.push({ id: hex("3e100000", ++M.seq), meeting_id: m.id, user_id: me, lecture_id: m.lecture_id, part: body.p_part, anchor: body.p_anchor, quote: "", at: now(), done_at: null });
        }
        here(m.id, me);
        return json(true);
      }
      case "study_meeting_reader_view": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m)) return refuse("meeting not found");
        if (m.reader_id !== me || !m.reading) return refuse("not the reader");
        const lv = M.live.get(m.id);
        if (m.day !== today() || !lv || lv.at < now() - LIVE) return refuse("not live");
        const by = new Map();
        for (const t of M.taps.filter((x) => x.meeting_id === m.id && x.user_id !== me)) {
          if (M.events.some((e) => e.meeting_id === m.id && e.part === t.part && e.anchor === t.anchor)) continue;
          const k = `${t.part}.${t.anchor}`;
          by.set(k, { part: t.part, anchor: t.anchor, users: new Set([...(by.get(k)?.users ?? []), t.user_id]) });
        }
        const taps = [...by.values()].filter((x) => x.users.size >= 3).map((x) => ({ part: x.part, anchor: x.anchor, n: x.users.size })).sort((a, b) => a.part - b.part || a.anchor - b.anchor);
        let warn = null;
        if (m.guess_released < m.guess_ids.length && db.meetingPulse === true) {
          const q = questionOf(m.guess_ids[m.guess_released]);
          const k = keyOf(q?.id)?.answer;
          const gs = M.guesses.filter((g) => g.meeting_id === m.id && g.question_id === q?.id);
          const bad = gs.filter((g) => g.choice !== k).length;
          if (q && gs.length >= 3 && bad * 2 > gs.length) warn = { guess: m.guess_released + 1, part: q.part_idx, anchor: q.anchor, question: q.question, slides: q.slides };
        }
        return json({ taps, guess_warn: warn, followers: followers(m.id, me) });
      }
      case "study_meeting_stop": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m)) return refuse("meeting not found");
        if (m.reader_id !== me || !m.reading) return refuse("not the reader");
        if (!["explain", "continue", "question"].includes(body.p_kind ?? "")) return refuse("bad kind");
        if (body.p_kind === "question" && !db.comments.some((c) => c.id === body.p_comment && c.lecture_id === m.lecture_id && c.part_idx === body.p_part && c.anchor === body.p_anchor && c.kind === "question" && !c.parent_id)) {
          return refuse("question not found");
        }
        if (!M.events.some((e) => e.meeting_id === m.id && e.kind === body.p_kind && e.part === body.p_part && e.anchor === body.p_anchor)) {
          M.events.push({ meeting_id: m.id, kind: body.p_kind, part: body.p_part, anchor: body.p_anchor, quote: "", comment_id: body.p_kind === "question" ? body.p_comment : null, by: me, at: now() });
        }
        return json(null);
      }
      case "study_meeting_quiz": {
        // Section Z's study_quiz_create through Z's plugin, as the SQL calls it.
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        const preset = body.p_preset ?? "";
        let args;
        if (preset === "coffee") {
          const lecs = [...new Set(M.meetings.filter((y) => y.group_id === m.group_id && y.day < m.day && !y.cancelled_at).sort((a, b) => (a.day < b.day ? 1 : -1)).map((y) => y.lecture_id))];
          args = { p_group: m.group_id, p_mode: "coop", p_lectures: lecs.length ? lecs : [m.lecture_id], p_count: 3, p_seconds: 45, p_kinds: "all", p_preset: "coffee", p_meeting: m.id };
        } else if (preset === "end") {
          const upto = Math.max(m.part_from, m.read_part ?? m.part_to);
          args = { p_group: m.group_id, p_mode: body.p_mode ?? "coop", p_lectures: [m.lecture_id], p_count: body.p_count ?? 5, p_seconds: 60, p_kinds: "all", p_preset: "end", p_meeting: m.id, p_part_from: m.part_from, p_part_to: upto };
        } else if (preset === "stop") {
          const p = body.p_part ?? m.read_part ?? m.part_from;
          args = { p_group: m.group_id, p_mode: "coop", p_lectures: [m.lecture_id], p_count: 1, p_seconds: 60, p_kinds: "all", p_preset: "stop", p_meeting: m.id, p_part_from: p, p_part_to: p };
        } else return refuse("bad preset");
        const quiz = require("./quiz.cjs");
        let out = null;
        let failed = null;
        await quiz.rest({
          method: "POST", path: "/rest/v1/rpc/study_quiz_create", body: args, who, db, notify,
          json: async (b) => void (out = b), refuse: async (msg) => void (failed = msg), check: { rpc: () => undefined, cols: () => undefined },
        });
        if (failed) return refuse(failed);
        if (!m.started_at) {
          m.started_at = iso(now());
          bump(m);
        }
        return json(out);
      }
      case "study_meeting_guess_pick": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (m.guess_ids.length === 2 || m.guess_released > 0) return json(m.guess_ids);
        const byAnchor = new Map();
        for (const q of P.questions
          .filter((q) => q.lecture_id === m.lecture_id && q.part_idx === m.part_from && q.anchor !== null && q.anchor !== undefined && usable(q))
          .sort((a, b) => a.anchor - b.anchor || Number(Boolean(b.teaser)) - Number(Boolean(a.teaser)) || (a.created_at < b.created_at ? -1 : 1))) {
          if (!byAnchor.has(q.anchor)) byAnchor.set(q.anchor, q.id);
        }
        const ids = [...byAnchor.values()].slice(0, 2);
        if (ids.length) {
          m.guess_ids = ids;
          bump(m);
        }
        return json(ids);
      }
      case "study_meeting_guess": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        const pos = m.guess_ids.indexOf(body.p_question) + 1;
        if (!pos) return refuse("question not found");
        if (pos <= m.guess_released) return refuse("released");
        const n = questionOf(body.p_question)?.options.length ?? 0;
        if (body.p_choice === null || body.p_choice < 0 || body.p_choice >= n) return refuse("bad choice");
        const g = M.guesses.find((x) => x.meeting_id === m.id && x.question_id === body.p_question && x.user_id === me);
        if (g) Object.assign(g, { choice: body.p_choice, at: now() });
        else M.guesses.push({ meeting_id: m.id, question_id: body.p_question, user_id: me, choice: body.p_choice, at: now() });
        return json(null);
      }
      case "study_meeting_guess_state": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m)) return refuse("meeting not found");
        const out = [];
        m.guess_ids.forEach((qid, i) => {
          const q = questionOf(qid);
          if (!q) return;
          const mine = M.guesses.find((g) => g.meeting_id === m.id && g.question_id === qid && g.user_id === me)?.choice ?? null;
          const e = {
            n: i + 1, released: i + 1 <= m.guess_released, mine,
            q: { id: q.id, kind: q.kind, vignette: q.vignette || "", question: q.question, teaser: q.teaser ?? "", options: q.options, slides: q.slides, part: q.part_idx ?? null, anchor: q.anchor ?? null },
          };
          if (e.released) {
            const k = keyOf(qid);
            const gs = M.guesses.filter((g) => g.meeting_id === m.id && g.question_id === qid);
            const ok = gs.filter((g) => g.choice === k.answer).length;
            const tally = new Map();
            for (const g of gs) tally.set(g.choice, (tally.get(g.choice) ?? 0) + 1);
            const [top, topn] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [null, 0];
            Object.assign(e, {
              answer: k.answer, explanation: k.explanations?.[k.answer] ?? "", takeaway: k.takeaway ?? "", correct: mine === null ? null : mine === k.answer,
              majority: gs.length < 3 ? null : { most_right: ok * 2 > gs.length, spread: topn * 2 <= gs.length, with_most: mine !== null && topn * 2 > gs.length && mine === top },
            });
          }
          out.push(e);
        });
        return json(out);
      }
      case "study_meeting_agenda": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m)) return refuse("meeting not found");
        const l = lectureOf(m.lecture_id);
        const reading = {
          lecture_id: m.lecture_id, lecture_title: l?.title ?? "", title: m.title || partsTitle(m), part_from: m.part_from, part_to: m.part_to,
          slide_from: slideFrom(m), slide_to: slideTo(m), reader: nameOf(m.reader_id), reading: m.reading,
        };
        const fromMeeting = (c) => M.events.some((e) => e.comment_id === c.id && (meetingOf(e.meeting_id)?.day ?? "9") < m.day);
        const prevLecture = M.meetings.filter((y) => y.group_id === m.group_id && y.day < m.day && !y.cancelled_at).sort((a, b) => (a.day < b.day ? 1 : -1))[0]?.lecture_id;
        const qs = db.comments
          .filter((c) => c.kind === "question" && !c.parent_id && !c.resolved && lectureOf(c.lecture_id)?.group_id === m.group_id && !lectureOf(c.lecture_id)?.deleted_at)
          .filter((c) => Date.parse(c.created_at) <= Date.parse(m.starts_at) - 86_400_000 || fromMeeting(c))
          .sort((a, b) => Number(fromMeeting(b)) - Number(fromMeeting(a)) || Number(b.lecture_id === m.lecture_id || b.lecture_id === prevLecture) - Number(a.lecture_id === m.lecture_id || a.lecture_id === prevLecture) || (a.created_at < b.created_at ? -1 : 1));
        const c = qs[0];
        const oq = c
          ? { id: c.id, body: c.body, lecture_id: c.lecture_id, lecture_title: lectureOf(c.lecture_id)?.title ?? "", part: c.part_idx, anchor: c.anchor, quote: c.quote ?? "", created_at: c.created_at, author: nameOf(c.author_id), from_meeting: fromMeeting(c) }
          : null;
        // Line 2: section U's hook (study_private.meeting__hot_spot), played by U's plugin when it is loaded.
        return json({ reading, hot_spot: db.pulseHotSpot ? db.pulseHotSpot(m.lecture_id, me) : null, open_question: oq });
      }
      case "study_meeting_band": {
        if (!isMember(body.p_group)) return refuse("group not found");
        // review SEC-12: yesterday's catch-ups join "קראו", at the meeting's time
        for (const c of M.catchups.filter((x) => !x.marked_at && dayOf(x.done_at) < today())) {
          const m = meetingOf(c.meeting_id);
          if (!m || m.group_id !== body.p_group) continue;
          c.marked_at = now();
          if (!db.reads.some((r) => r.lecture_id === m.lecture_id && r.user_id === c.user_id)) {
            const row = { lecture_id: m.lecture_id, user_id: c.user_id, read_at: m.started_at ?? m.starts_at };
            db.reads.push(row);
            notify("study_reads", "INSERT", row);
          }
        }
        const d = today();
        const live = M.meetings.filter((m) => m.group_id === body.p_group && !m.cancelled_at && !lectureOf(m.lecture_id)?.deleted_at);
        const next = live.filter((m) => m.day > d && m.day <= addDays(d, 14)).map((m) => m.day).sort()[0];
        const rows = live.filter((m) => m.day === d || (!live.some((y) => y.day === d) && m.day === next)).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
        const quizRef = (m, preset) => {
          const z = quizzesOf(m.id).filter((x) => x.preset === preset && x.state !== "cancelled").sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
          return z ? { id: z.id, state: z.state } : null;
        };
        return json(
          rows.map((m) => ({
            id: m.id, day: m.day, starts_at: m.starts_at, version: m.version, today: m.day === d, lecture_id: m.lecture_id, lecture_title: lectureOf(m.lecture_id)?.title ?? "",
            title: m.title || partsTitle(m), part_from: m.part_from, part_to: m.part_to, slide_from: slideFrom(m), slide_to: slideTo(m),
            reader_id: m.reader_id, reading: m.reading, started_at: m.started_at, over: over(m),
            guesses: m.guess_ids.length, guess_released: m.guess_released, my_guesses: M.guesses.filter((g) => g.meeting_id === m.id && g.user_id === me).length,
            coffee: quizRef(m, "coffee"), closing: quizRef(m, "end"),
          })),
        );
      }
      case "study_my_unclear": {
        if (!isMember(body.p_group)) return json([]);
        return json(
          M.taps
            .filter((t) => t.user_id === me && !t.done_at && dayOf(t.at) < today() && t.at > now() - 14 * 86_400_000 && lectureOf(t.lecture_id)?.group_id === body.p_group)
            .map((t) => ({ tap_id: t.id, meeting_id: t.meeting_id, lecture_id: t.lecture_id, lecture_title: lectureOf(t.lecture_id)?.title ?? "", part_idx: t.part, anchor: t.anchor, quote: t.quote, tapped_at: iso(t.at), explained: M.events.some((e) => e.meeting_id === t.meeting_id && e.kind === "explain" && e.part === t.part && e.anchor === t.anchor), thread: "none", comment_id: null })),
        );
      }
      case "study_unclear_done": {
        const t = M.taps.find((x) => x.id === body.p_tap && x.user_id === me);
        if (!t) return refuse("not found");
        t.done_at = t.done_at ?? now();
        return json(null);
      }
      case "study_my_missed": {
        if (!isMember(body.p_group)) return json([]);
        const was = (m) =>
          M.presence.has(`${m.id}:${me}`) || M.taps.some((t) => t.meeting_id === m.id && t.user_id === me) || M.guesses.some((g) => g.meeting_id === m.id && g.user_id === me) ||
          M.catchups.some((c) => c.meeting_id === m.id && c.user_id === me) || quizzesOf(m.id).some((z) => Z.players.some((p) => p.quiz_id === z.id && p.user_id === me));
        return json(
          M.meetings
            .filter((m) => m.group_id === body.p_group && !m.cancelled_at && m.started_at && over(m) && m.day > addDays(today(), -7) && !lectureOf(m.lecture_id)?.deleted_at && !was(m))
            .sort((a, b) => (a.day < b.day ? 1 : -1))
            .map((m) => ({ meeting_id: m.id, lecture_id: m.lecture_id, lecture_title: lectureOf(m.lecture_id)?.title ?? "", title: m.title || partsTitle(m), day: m.day })),
        );
      }
      case "study_meeting_catchup": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (!over(m)) return refuse("not over");
        const t0 = Date.parse(m.started_at ?? m.starts_at);
        const t1 = t0 + 4 * 3_600_000;
        const upto = Math.max(m.part_from, m.read_part ?? m.part_to);
        const stops = M.events.filter((e) => e.meeting_id === m.id && e.kind === "explain").sort((a, b) => a.part - b.part || a.anchor - b.anchor).map((e) => ({ part: e.part, anchor: e.anchor, quote: e.quote }));
        const resolved = db.comments
          .filter((c) => c.lecture_id === m.lecture_id && c.kind === "question" && !c.parent_id && c.resolved)
          .map((c) => ({ c, r: db.comments.filter((r) => r.parent_id === c.id && Date.parse(r.created_at) >= t0 && Date.parse(r.created_at) <= t1).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] }))
          .filter((x) => x.r)
          .slice(0, 3)
          .map(({ c, r }) => ({ id: c.id, question: c.body, part: c.part_idx, anchor: c.anchor, answer: r.body, answer_by: nameOf(r.author_id) }));
        const hard = quizzesOf(m.id)
          .flatMap((z) => Z.rounds.filter((r) => r.quiz_id === z.id && r.revealed_at && !r.voided_at))
          .map((r) => ({ r, a: Z.answers.filter((a) => a.round_id === r.id && a.vote === r.vote) }))
          .filter((x) => x.a.length >= 3 && usable(questionOf(x.r.question_id)))
          .sort((x, y) => x.a.filter((a) => a.correct).length / x.a.length - y.a.filter((a) => a.correct).length / y.a.length)
          .map((x) => x.r.question_id);
        const qs = [...new Set(hard)].slice(0, 5);
        const stopped = (q) => M.events.some((e) => e.meeting_id === m.id && e.kind === "explain" && e.part === q.part_idx && e.anchor === q.anchor);
        const more = P.questions
          .filter((q) => q.lecture_id === m.lecture_id && q.part_idx >= m.part_from && q.part_idx <= upto && usable(q) && !qs.includes(q.id))
          .sort((a, b) => Number(stopped(b)) - Number(stopped(a)) || a.part_idx - b.part_idx || (a.anchor ?? 0) - (b.anchor ?? 0) || (a.created_at < b.created_at ? -1 : 1))
          .slice(0, Math.max(0, 5 - qs.length))
          .map((q) => q.id);
        const questions = [...qs, ...more];
        const readers = db.reads.filter((r) => r.lecture_id === m.lecture_id).map((r) => nameOf(r.user_id)).filter(Boolean).sort();
        const pins = [];
        return json({
          meeting: { id: m.id, lecture_id: m.lecture_id, day: m.day, part_from: m.part_from, part_to: upto, lecture_title: lectureOf(m.lecture_id)?.title ?? "", title: m.title || partsTitle(m, upto) },
          stops, resolved, pins, questions, readers,
          minutes: 2 + stops.length + resolved.length + Math.ceil(pins.length * 0.5) + Math.ceil(questions.length * 1.5),
          done: M.catchups.some((c) => c.meeting_id === m.id && c.user_id === me),
        });
      }
      case "study_meeting_catchup_done": {
        const m = meetingOf(body.p_meeting);
        if (!memberOf(m) || m.cancelled_at) return refuse("meeting not found");
        if (!M.catchups.some((c) => c.meeting_id === m.id && c.user_id === me)) M.catchups.push({ meeting_id: m.id, user_id: me, done_at: now(), marked_at: null });
        return json(null);
      }
    }
    return undefined;
  },
};

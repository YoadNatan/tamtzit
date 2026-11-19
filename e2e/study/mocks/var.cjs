// Package V's part of the e2e mock (spec §8.3; §12.4.V): yellow cards,
// backing without names, op var, the lecture's log, slide flags, the spread
// and "עדכון". The shared mock loads it for every script (every plugin in
// e2e/study/mocks/ is), so a build with VITE_STUDY_VAR finds its tables and
// RPCs in any flow. It plays section V as the SQL does
// (supabase/study-schema.sql, V's markers), with the codes the SQL raises:
//   study_disputes                GET with eq/in, order, limit (the published
//                                 row: never a backer, never a backers' total);
//                                 Realtime on every change
//   rpc/study_dispute_open        "bad claim", "bad source", "part not found",
//                                 "dispute open", "not pending" (a proposal that
//                                 no longer waits; one that does becomes
//                                 "disputed")
//   rpc/study_dispute_claim       "sides taken", "not open", "busy"
//   rpc/study_dispute_back        "a side cannot back", "not open" (once VAR was
//                                 asked: review SEC-10)
//   rpc/study_dispute_state       the split by side only after VAR was asked or
//                                 the card was decided, from 3 backers other
//                                 than the caller; else the total
//   rpc/study_dispute_decide      "not judged"; "accept" makes the trap card
//                                 (db.cardsMock when C's plugin is there)
//   rpc/study_dispute_close       the opener only, while open
//   rpc/study_slide_flag(_remove) "bad source", "bad note", "flag not found"
//   rpc/study_lecture_log         K's corrections (db.edits), verdicts, flags
//   rpc/study_my_updates,         the caller's own unseen updates
//   rpc/study_update_seen
//   POST /api/study/ai {op:"var"} the hold first ("busy" to a second phone,
//                                 with no reservation), then after
//                                 db.varDelayMs the verdict (db.varVerdict, or
//                                 one built from the card's slides)
// The spread: each new correction in db.edits (K's plugin) marks the
// paragraph's questions and cards (stale_at, stale_edit) and gives one "עדכון"
// to every member in db.vStudied on its paragraph (not its author or its
// approver); an undo takes back the marks and the updates nobody saw. Every call is kept
// in db.vCalls.
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const uuidV = (n) => `fade${String(n).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROW = ["id", "lecture_id", "part_idx", "anchor", "quote", "proposal_id", "claim_a", "slides_a", "author_a", "claim_b", "slides_b", "author_b", "state", "verdict", "verdict_model",
  "judged_at", "decided_by", "decided_at", "decision_note", "trap_card", "judging_until", "var_asked_at", "version", "created_at", "updated_at"];

function select(rows, query, table, check, where) {
  let out = [...rows];
  for (const [k, v] of query) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    check.cols(table, [k], where);
    const [op, ...rest] = v.split(".");
    const arg = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[k]) === arg);
    else if (op === "in") {
      const set = arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      out = out.filter((r) => set.includes(String(r[k])));
    } else throw new Error(`var mock: filter ${k}=${v}`);
  }
  const order = query.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1)));
  }
  const limit = query.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  const cols = (query.get("select") || "*").split(",").map((c) => c.trim());
  check.cols(table, cols.filter((c) => c !== "*"), where);
  return out.map((r) => (cols.includes("*") ? r : Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]]))));
}

const nameOf = (db, id) => db.members.find((m) => m.user_id === id)?.name ?? null;
const slidesOf = (db, lectureId) => new Set((db.lectures.find((l) => l.id === lectureId)?.slides ?? []).map((s) => s.n));
const okSlides = (db, lectureId, s) => Array.isArray(s) && s.length >= 1 && s.length <= 4 && s.every((n) => slidesOf(db, lectureId).has(n));
const okClaim = (c) => typeof c === "string" && c.trim().length >= 5 && c.trim().length <= 240;
const touch = (d) => Object.assign(d, { version: d.version + 1, updated_at: now() });

/** study_dispute_state for the caller. */
function stateOf(db, d, me) {
  const backs = db.backs.filter((b) => b.dispute_id === d.id);
  const na = backs.filter((b) => b.side === "a").length;
  const nb = backs.filter((b) => b.side === "b").length;
  const own = backs.some((b) => b.user_id === me) ? 1 : 0;
  const closed = d.state !== "open" || d.var_asked_at !== null;
  return {
    id: d.id, lecture_id: d.lecture_id, part: d.part_idx, anchor: d.anchor, quote: d.quote, state: d.state, proposal_id: d.proposal_id,
    a: { claim: d.claim_a, slides: d.slides_a, author_id: d.author_a, name: nameOf(db, d.author_a) },
    b: d.claim_b === null ? null : { claim: d.claim_b, slides: d.slides_b, author_id: d.author_b, name: nameOf(db, d.author_b) },
    backs: closed && na + nb - own >= 3 ? { a: na, b: nb } : null,
    backing_open: d.state === "open" && d.var_asked_at === null,
    backers: na + nb,
    mine: backs.find((b) => b.user_id === me)?.side ?? null,
    verdict: d.verdict, judged_at: d.judged_at, decided_by: nameOf(db, d.decided_by), decision_note: d.decision_note, trap_card: d.trap_card,
  };
}

/** The spread (section V's trigger on study_edits), run before each call. */
function spread(db, notify) {
  if (!Array.isArray(db.edits)) return;
  for (; db.vSeenEdits < db.edits.length; db.vSeenEdits++) {
    const e = db.edits[db.vSeenEdits];
    const P = db.practice?.questions ?? [];
    const C = db.cardsMock?.cards ?? [];
    if (e.undo_of) {
      db.updates = db.updates.filter((u) => !(u.edit_id === e.undo_of && !u.seen_at));
      for (const x of [...P, ...C]) if (x.stale_edit === e.undo_of) Object.assign(x, { stale_at: null, stale_edit: null });
      continue;
    }
    // The marks: the paragraph's questions (with the switch spread_questions, db.vSpreadQuestions) and cards.
    const here = (x) => x.lecture_id === e.lecture_id && x.part_idx === e.part_idx && x.anchor === e.anchor;
    if (db.vSpreadQuestions !== false) for (const q of P) if (here(q) && !q.retired_at) Object.assign(q, { stale_at: now(), stale_edit: e.id });
    for (const c of C) if (here(c) && !c.deleted_at) Object.assign(c, { stale_at: now(), stale_edit: e.id });
    for (const s of db.vStudied) {
      if (s.lecture_id !== e.lecture_id || s.part_idx !== e.part_idx || s.anchor !== e.anchor) continue;
      if (s.user_id === e.author_id || s.user_id === e.approved_by) continue;
      if (db.updates.some((u) => u.user_id === s.user_id && u.edit_id === e.id)) continue;
      db.updates.push({ id: uuidV(++db.vSeq), user_id: s.user_id, edit_id: e.id, lecture_id: e.lecture_id, part_idx: e.part_idx, anchor: e.anchor, reason: s.reason, reason_at: s.at, created_at: now(), seen_at: null });
    }
  }
  void notify;
}

module.exports = {
  seed(db) {
    db.disputes = [];
    db.backs = [];
    db.slideFlags = [];
    db.updates = [];
    db.vStudied = []; // { lecture_id, part_idx, anchor, user_id, reason: "card" | "question", at }
    db.vCalls = [];
    db.vSeq = 0;
    db.vSeenEdits = 0;
    db.varDelayMs = 600;
    db.varReserved = 0;
    db.varVerdict = null;
  },

  async rest({ method, path, query, body, who, db, notify, single, json: answer, refuse: deny, check }) {
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const where = `${method} ${path}`;
    db.vNotify = notify;
    spread(db, notify);
    const me = who?.id ?? null;
    const member = me && db.members.some((m) => m.user_id === me);

    if (path === "/rest/v1/study_disputes" && method === "GET") {
      if (!member) return json(single ? null : []);
      const rows = select(db.disputes, query, "study_disputes", check, where);
      return json(single ? rows[0] ?? null : rows);
    }
    if (!path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    const mine = ["study_dispute_open", "study_dispute_claim", "study_dispute_back", "study_dispute_state", "study_dispute_decide", "study_dispute_close",
      "study_slide_flag", "study_slide_flag_remove", "study_lecture_log", "study_my_updates", "study_update_seen"];
    if (!mine.includes(fn)) return undefined;
    check.rpc(fn, body, where);
    db.vCalls.push({ fn, who: me, body, at: Date.now() });
    if (!me) return refuse("not signed in");
    const find = (id) => db.disputes.find((d) => d.id === id && member);

    switch (fn) {
      case "study_dispute_open": {
        if (!member || !db.lectures.some((l) => l.id === body.p_lecture)) return refuse("forbidden");
        if (!okClaim(body.p_claim)) return refuse("bad claim");
        if (!okSlides(db, body.p_lecture, body.p_slides)) return refuse("bad source");
        if (!db.sections.some((s) => s.lecture_id === body.p_lecture && s.idx === body.p_part)) return refuse("part not found");
        if (db.disputes.some((d) => d.lecture_id === body.p_lecture && d.part_idx === body.p_part && d.anchor === body.p_anchor && ["open", "judged"].includes(d.state))) return refuse("dispute open");
        if (body.p_proposal) {
          const p = (db.proposals ?? []).find((x) => x.id === body.p_proposal && x.lecture_id === body.p_lecture && x.part_idx === body.p_part && x.anchor === body.p_anchor && x.state === "pending");
          if (!p) return refuse("not pending");
          Object.assign(p, { state: "disputed", updated_at: now() });
          notify("study_edit_proposals", "UPDATE", p);
        }
        const d = {
          id: uuidV(++db.vSeq), lecture_id: body.p_lecture, part_idx: body.p_part, anchor: body.p_anchor, quote: String(body.p_quote ?? "").slice(0, 200),
          proposal_id: body.p_proposal ?? null, claim_a: body.p_claim.trim(), slides_a: body.p_slides, author_a: me, claim_b: null, slides_b: [], author_b: null,
          state: "open", verdict: null, verdict_model: null, judged_at: null, decided_by: null, decided_at: null, decision_note: "", trap_card: null,
          judging_until: null, var_asked_at: null, version: 1, created_at: now(), updated_at: now(),
        };
        db.disputes.push(d);
        notify("study_disputes", "INSERT", d);
        return json(d.id);
      }
      case "study_dispute_claim": {
        const d = find(body.p_dispute);
        if (!d) return refuse("dispute not found");
        if (d.state !== "open") return refuse("not open");
        if (d.judging_until && Date.parse(d.judging_until) > Date.now()) return refuse("busy");
        if (!okClaim(body.p_claim)) return refuse("bad claim");
        if (!okSlides(db, d.lecture_id, body.p_slides)) return refuse("bad source");
        if (d.author_a === me) Object.assign(d, { claim_a: body.p_claim.trim(), slides_a: body.p_slides });
        else if (d.author_b === null || d.author_b === me) {
          db.backs = db.backs.filter((b) => !(b.dispute_id === d.id && b.user_id === me));
          Object.assign(d, { claim_b: body.p_claim.trim(), slides_b: body.p_slides, author_b: me });
        } else return refuse("sides taken");
        touch(d);
        notify("study_disputes", "UPDATE", d);
        return json(null);
      }
      case "study_dispute_back": {
        const d = find(body.p_dispute);
        if (!d) return refuse("dispute not found");
        if (d.state !== "open" || d.var_asked_at) return refuse("not open");
        if (me === d.author_a || me === d.author_b) return refuse("a side cannot back");
        db.backs = db.backs.filter((b) => !(b.dispute_id === d.id && b.user_id === me));
        if (body.p_side === "a" || body.p_side === "b") db.backs.push({ dispute_id: d.id, user_id: me, side: body.p_side, created_at: now() });
        else if (body.p_side !== null && body.p_side !== undefined) return refuse("bad side");
        // review SEC-10: the published row does not change on a back
        return json(null);
      }
      case "study_dispute_state": {
        const d = find(body.p_dispute);
        if (!d) return refuse("dispute not found");
        return json(stateOf(db, d, me));
      }
      case "study_dispute_decide": {
        const d = find(body.p_dispute);
        if (!d) return refuse("dispute not found");
        if (d.state !== "judged") return refuse("not judged");
        if (!["accept", "override"].includes(body.p_decision)) return refuse("bad decision");
        if (String(body.p_note ?? "").length > 200) return refuse("too long");
        let card = null;
        if (body.p_decision === "accept" && d.verdict?.trap) {
          card = uuidV(++db.vSeq);
          db.vTrapCards = [...(db.vTrapCards ?? []), { id: card, lecture_id: d.lecture_id, part_idx: d.part_idx, anchor: d.anchor, front: d.verdict.trap.front, back: d.verdict.trap.back, source: "trap", trap_key: `d:${d.id}` }];
        }
        Object.assign(d, { state: body.p_decision === "accept" ? "accepted" : "overridden", decided_by: me, decided_at: now(), decision_note: String(body.p_note ?? "").trim(), trap_card: card });
        touch(d);
        const p = (db.proposals ?? []).find((x) => x.id === d.proposal_id && x.state === "disputed");
        if (p) {
          Object.assign(p, { state: "pending", updated_at: now() });
          notify("study_edit_proposals", "UPDATE", p);
        }
        notify("study_disputes", "UPDATE", d);
        return json(card);
      }
      case "study_dispute_close": {
        const d = db.disputes.find((x) => x.id === body.p_dispute);
        if (!d || d.author_a !== me || d.state !== "open") return refuse("dispute not found");
        touch(Object.assign(d, { state: "closed" }));
        const p = (db.proposals ?? []).find((x) => x.id === d.proposal_id && x.state === "disputed");
        if (p) {
          Object.assign(p, { state: "pending", updated_at: now() });
          notify("study_edit_proposals", "UPDATE", p);
        }
        notify("study_disputes", "UPDATE", d);
        return json(null);
      }
      case "study_slide_flag": {
        if (!member) return refuse("forbidden");
        if (!okSlides(db, body.p_lecture, body.p_slides)) return refuse("bad source");
        const note = String(body.p_note ?? "").trim();
        if (note.length < 5 || note.length > 300) return refuse("bad note");
        const f = { id: uuidV(++db.vSeq), lecture_id: body.p_lecture, slides: body.p_slides, note, created_by: me, created_at: now(), removed_at: null, removed_by: null };
        db.slideFlags.push(f);
        notify("study_slide_flags", "INSERT", f);
        return json(f.id);
      }
      case "study_slide_flag_remove": {
        const f = db.slideFlags.find((x) => x.id === body.p_flag);
        if (!f || !member) return refuse("flag not found");
        const remove = body.p_remove !== false;
        Object.assign(f, { removed_at: remove ? now() : null, removed_by: remove ? me : null });
        notify("study_slide_flags", "UPDATE", f);
        return json(null);
      }
      case "study_lecture_log": {
        if (!member || !db.lectures.some((l) => l.id === body.p_lecture)) return refuse("lecture not found");
        const L = body.p_lecture;
        const edits = (db.edits ?? []).filter((e) => e.lecture_id === L).map((e) => ({
          at: e.created_at,
          j: { kind: "edit", id: e.id, at: e.created_at, part: e.part_idx, anchor: e.anchor, block: e.kind, before: e.before_text, after: e.after_text, note: e.note, undo_of: e.undo_of,
            undone: (db.edits ?? []).some((u) => u.undo_of === e.id), source_kind: e.source_kind, source_slides: e.source_slides, source_at: e.source_at, source_note: e.source_note,
            author: nameOf(db, e.author_id), approver: nameOf(db, e.approved_by), aloud: e.aloud },
        }));
        const verdicts = db.disputes.filter((d) => d.lecture_id === L && ["judged", "accepted", "overridden"].includes(d.state)).map((d) => ({
          at: d.created_at,
          j: { kind: "verdict", id: d.id, at: d.decided_at ?? d.judged_at ?? d.created_at, part: d.part_idx, anchor: d.anchor, state: d.state, claim_a: d.claim_a, claim_b: d.claim_b,
            slides: [...d.slides_a, ...d.slides_b], name_a: nameOf(db, d.author_a), name_b: nameOf(db, d.author_b), certainty: d.verdict?.certainty ?? null, summary: d.verdict?.summary ?? null,
            decided_by: nameOf(db, d.decided_by), decision_note: d.decision_note },
        }));
        const flags = db.slideFlags.filter((f) => f.lecture_id === L).map((f) => ({
          at: f.created_at,
          j: { kind: "slide", id: f.id, at: f.created_at, slides: f.slides, note: f.note, by: nameOf(db, f.created_by), removed: f.removed_at !== null, removed_by: nameOf(db, f.removed_by) },
        }));
        return json([...edits, ...verdicts, ...flags].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 100).map((x) => x.j));
      }
      case "study_my_updates": {
        if (!member) return json([]);
        const rows = db.updates
          .filter((u) => u.user_id === me && !u.seen_at)
          .map((u) => {
            const e = (db.edits ?? []).find((x) => x.id === u.edit_id);
            const l = db.lectures.find((x) => x.id === u.lecture_id);
            if (!e || !l || l.deleted_at) return null;
            return { id: u.id, edit_id: u.edit_id, lecture_id: u.lecture_id, lecture_title: l.title, part_idx: u.part_idx, anchor: u.anchor, kind: e.kind, before_text: e.before_text, after_text: e.after_text,
              author: nameOf(db, e.author_id), approver: nameOf(db, e.approved_by), aloud: e.aloud, source_kind: e.source_kind, source_slides: e.source_slides, source_at: e.source_at, source_note: e.source_note,
              reason: u.reason, reason_at: u.reason_at, created_at: u.created_at };
          })
          .filter(Boolean);
        return json(rows);
      }
      case "study_update_seen": {
        const u = db.updates.find((x) => x.id === body.p_update && x.user_id === me);
        if (!u) return refuse("not found");
        u.seen_at = u.seen_at ?? now();
        return json(null);
      }
    }
    return undefined;
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "var") return undefined;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    spread(db, db.vNotify);
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const n = Number(token.replace(/^tok-/, ""));
    const me = db.members.find((m) => m.user_id === `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`);
    db.vCalls.push({ fn: "api var", who: me?.user_id ?? null, body: b, at: Date.now() });
    if (!me) return send(401, { error: "not signed in" });
    if (typeof b.disputeId !== "string") return send(400, { error: "disputeId required" });
    const d = db.disputes.find((x) => x.id === b.disputeId);
    if (!d) return send(404, { error: "dispute not found" });
    if (d.state !== "open" || d.claim_b === null) return send(409, { error: "not ready" });
    // study_dispute_judge_begin: the hold before any reservation (review SEC-15)
    if (d.judging_until && Date.parse(d.judging_until) > Date.now()) return send(409, { error: "busy" });
    Object.assign(d, { judging_until: new Date(Date.now() + 180_000).toISOString(), var_asked_at: d.var_asked_at ?? now() });
    touch(d);
    db.vNotify?.("study_disputes", "UPDATE", d);
    db.varReserved += 1; // reserve() → one call → settle()
    await pause(db.varDelayMs);
    const slides = [...new Set([...d.slides_a, ...d.slides_b])];
    const verdict = db.varVerdict ?? {
      certainty: "interpretation",
      summary: "שתי הטענות נשענות על השקפים; היישוב ביניהן הוא פרשנות.",
      on_slides: [{ text: "Loop diuretics inhibit NKCC2 in the thick ascending limb", slides: [slides[0]] }],
      interpretation: [{ text: "ה-25% הם מה-Na⁺ המסונן, לא מכלל ה-Na⁺ בגוף.", slides: slides.slice(-1) }],
      listen: true,
      trap: { front: "עד כמה מה-Na⁺ המסונן מעכבות משתני לולאה?", back: "עד 25%. [ש' 6]", slides: [slides[0]] },
    };
    Object.assign(d, { verdict, verdict_model: "claude-mock", judged_at: now(), state: "judged", judging_until: null });
    touch(d);
    db.vNotify?.("study_disputes", "UPDATE", d);
    return send(200, { verdict });
  },
};

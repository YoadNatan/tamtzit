// Package K's part of the e2e mock (spec §8.3; §12.3.K): corrections as
// proposals, "לשאול" and "לשאול את הקבוצה". The shared mock loads it for
// every script (every plugin in e2e/study/mocks/ is), so a build with
// VITE_STUDY_CORRECTIONS or VITE_STUDY_ASK finds its tables and RPCs in any
// flow. It plays section K's end as the SQL does (supabase/study-schema.sql,
// K's markers), with the codes the SQL raises:
//   study_edits, study_edit_proposals   GET with eq/in/gte, order, limit;
//                                       Realtime on every change
//   rpc/study_propose_edit              the block must stand in the part, a
//                                       source (slide of the lecture, minute,
//                                       outside note ≥ 3), one open proposal a
//                                       paragraph ("pending exists")
//   rpc/study_approve_edit              "own proposal" (aloud too), "not pending",
//                                       aloud only for a member in db.liveReaders
//                                       (section M's live reading with two
//                                       followers: the script sets it), else
//                                       "not live"; a paragraph that changed →
//                                       { conflict: true }
//   rpc/study_undo_edit                 only the paragraph's latest correction,
//                                       never an undo ("bad undo")
//   rpc/study_withdraw_edit             the proposer only
//   PATCH study_comments.resolved       records resolved_by (section K's trigger)
//   POST /api/study/ai {op:"ask"}       a streamed answer from the fixture's slides
//                                       (NDJSON: turn, a…, done with a signature);
//                                       { share } checks the signature and posts the
//                                       question with Claude's attempt (ask_attempt)
//   POST /api/study/ai {op:"fix_check"} writes check_ok/check_note on the proposal
// Every call is kept in db.kCalls.
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const uuidK = (n) => `abcd${String(n).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The answer the mock streams: from the fixture's slides, with tags, a "הרחבה" and a "not on the slides" line. */
const ANSWER = [
  "בשקף: ״Loop diuretics inhibit NKCC2 in the thick ascending limb״. לכן הן המשתנים החזקים ביותר: עד 25% מה-Na⁺ המסונן. [ש' 6]",
  "\n\n**ומה עם המינון המדויק:** לא מופיע בשקפים.",
  "\n\n> **הרחבה:** ככל שהמקטע סופג יותר Na⁺, עיכוב שלו משפיע יותר על ההפרשה.",
];

/** Rows of a list, filtered as PostgREST would by the query (eq, in, gte; order; limit). */
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
    } else if (op === "gte") out = out.filter((r) => String(r[k]) >= arg);
    else throw new Error(`collab mock: filter ${k}=${v}`);
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

/** The block positions on whole lines (study_block_positions). */
function positions(md, blk) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = md.indexOf(blk, from);
    if (at < 0) return out;
    const startOk = at === 0 || md[at - 1] === "\n";
    const endOk = at + blk.length === md.length || md[at + blk.length] === "\n";
    if (startOk && endOk) out.push(at);
    from = at + 1;
  }
}

module.exports = {
  seed(db) {
    db.edits = [];
    db.proposals = [];
    db.kCalls = [];
    db.liveReaders = new Set(); // members reading today's meeting live, with two followers (section M)
    db.askDelayMs = 120;
    db.kSeq = 0;
  },

  async rest({ method, path, query, body, who, db, notify, single, json: answer, refuse: deny, check }) {
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const where = `${method} ${path}`;
    db.kNotify = notify; // the API handlers below notify through it (the share path's comments)
    const member = who && db.members.some((m) => m.user_id === who.id);

    if (path === "/rest/v1/study_edits" && method === "GET") {
      if (!member) return json([]);
      const rows = select(db.edits, query, "study_edits", check, where);
      return json(single ? rows[0] ?? null : rows);
    }
    if (path === "/rest/v1/study_edit_proposals" && method === "GET") {
      if (!member) return json([]);
      const rows = select(db.proposals, query, "study_edit_proposals", check, where);
      return json(single ? rows[0] ?? null : rows);
    }
    // Section K's trigger: who marked a question answered.
    if (path === "/rest/v1/study_comments" && method === "PATCH" && body && "resolved" in body) {
      const id = (query.get("id") || "").replace(/^eq\./, "");
      const c = db.comments.find((x) => x.id === id);
      if (c) Object.assign(c, { resolved_by: body.resolved ? who?.id ?? null : null, resolved_at: body.resolved ? now() : null });
      return undefined; // the base mock applies the update and notifies
    }
    if (!path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (!["study_propose_edit", "study_approve_edit", "study_withdraw_edit", "study_undo_edit", "study_edit_block"].includes(fn)) return undefined;
    check.rpc(fn, body, where);
    db.kCalls.push({ fn, who: who?.id, body, at: Date.now() });
    if (!who) return refuse("not signed in");
    if (!member) return refuse("forbidden");
    const sec = (l, i) => db.sections.find((s) => s.lecture_id === l && s.idx === i);

    /** Section K's edit_apply: one block for one block, the history row, Realtime. */
    const apply = (p, o) => {
      const s = sec(p.lecture_id, p.part_idx);
      if (!s) return { error: "part not found" };
      if (s.status !== "ready") return { error: "part busy" };
      if ((s.gen ?? 0) !== p.gen) return { error: "part rewritten" };
      const at = positions(s.markdown, p.before_text);
      const same = (s.rev ?? 0) === p.base_rev;
      const pos = same ? at[(p.occurrence ?? 1) - 1] : at.length === 1 ? at[0] : undefined;
      if (pos === undefined) return { error: "edit conflict" };
      s.markdown = s.markdown.slice(0, pos) + p.after_text + s.markdown.slice(pos + p.before_text.length);
      s.rev = (s.rev ?? 0) + 1;
      s.updated_at = now();
      const e = {
        id: uuidK(++db.kSeq),
        lecture_id: p.lecture_id,
        part_idx: p.part_idx,
        anchor: p.anchor,
        gen: s.gen ?? 0,
        rev: s.rev,
        kind: p.kind,
        before_text: p.before_text,
        after_text: p.after_text,
        note: p.note ?? "",
        undo_of: o.undoOf ?? null,
        author_id: o.author,
        approved_by: o.approver ?? null,
        aloud: Boolean(o.aloud),
        proposal_id: o.proposal ?? null,
        source_kind: o.undoOf ? "undo" : p.source_kind,
        source_slides: o.undoOf ? [] : p.source_slides ?? [],
        source_at: o.undoOf ? null : p.source_at ?? null,
        source_note: o.undoOf ? "" : p.source_note ?? "",
        created_at: now(),
      };
      db.edits.push(e);
      notify("study_sections", "UPDATE", s);
      notify("study_edits", "INSERT", e);
      return { edit_id: e.id, rev: s.rev, gen: s.gen ?? 0, merged: !same };
    };

    if (fn === "study_edit_block") return refuse(body.p_undo_of ? "bad undo" : "needs approval");

    if (fn === "study_propose_edit") {
      const s = sec(body.p_lecture, body.p_part);
      if (!s) return refuse("part not found");
      if ((s.gen ?? 0) !== body.p_base_gen) return refuse("part rewritten");
      if (body.p_before === body.p_after) return refuse("no change");
      const at = positions(s.markdown, body.p_before);
      if (!((s.rev ?? 0) === body.p_base_rev ? at.length >= (body.p_occurrence ?? 1) : at.length === 1)) return refuse("edit conflict");
      const lecture = db.lectures.find((l) => l.id === body.p_lecture);
      const have = new Set((lecture?.slides ?? []).map((x) => x.n));
      const k = body.p_source_kind;
      const okSource =
        (k === "slide" && Array.isArray(body.p_source_slides) && body.p_source_slides.length >= 1 && body.p_source_slides.length <= 6 && body.p_source_slides.every((n) => have.has(n))) ||
        (k === "recording" && Number.isInteger(body.p_source_at) && body.p_source_at >= 0 && body.p_source_at <= 36000) ||
        (k === "external" && String(body.p_source_note ?? "").trim().length >= 3);
      if (!okSource) return refuse("bad source");
      if (db.proposals.some((p) => p.lecture_id === body.p_lecture && p.part_idx === body.p_part && p.anchor === body.p_anchor && ["pending", "disputed"].includes(p.state)))
        return refuse("pending exists");
      const kind = /^\|/.test(body.p_before) ? "table" : /^#/.test(body.p_before) ? "heading" : /^>/.test(body.p_before) ? "box" : /^([-*+]|\d+[.)])\s/.test(body.p_before) ? "item" : "paragraph";
      const p = {
        id: uuidK(++db.kSeq),
        lecture_id: body.p_lecture,
        part_idx: body.p_part,
        anchor: body.p_anchor,
        gen: s.gen ?? 0,
        base_rev: body.p_base_rev,
        occurrence: body.p_occurrence ?? 1,
        kind,
        before_text: body.p_before,
        after_text: body.p_after,
        note: body.p_note ?? "",
        source_kind: k,
        source_slides: k === "slide" ? body.p_source_slides : [],
        source_at: k === "recording" ? body.p_source_at : null,
        source_note: String(body.p_source_note ?? "").trim(),
        state: "pending",
        proposed_by: who.id,
        approved_by: null,
        aloud: false,
        edit_id: null,
        created_at: now(),
        decided_at: null,
        updated_at: now(),
        check_ok: null,
        check_note: null,
        checked_at: null,
      };
      db.proposals.push(p);
      notify("study_edit_proposals", "INSERT", p);
      return json(p.id);
    }

    if (fn === "study_approve_edit") {
      const p = db.proposals.find((x) => x.id === body.p_proposal);
      if (!p) return refuse("forbidden");
      if (p.state !== "pending") return refuse("not pending");
      if (p.proposed_by === who.id) return refuse("own proposal");
      // Aloud: the reader of the day's live reading with two others following (section M's plugin), or db.liveReaders.
      if (body.p_aloud && !(db.liveReaders.has(who.id) || db.meetingMock?.readsLive?.(p.lecture_id, who.id))) return refuse("not live");
      const r = apply(p, { author: p.proposed_by, approver: who.id, aloud: Boolean(body.p_aloud), proposal: p.id });
      if (r.error) {
        if (["edit conflict", "part rewritten", "part busy", "part not found"].includes(r.error)) {
          Object.assign(p, { state: "conflict", decided_at: now(), updated_at: now() });
          notify("study_edit_proposals", "UPDATE", p);
          return json({ conflict: true, reason: r.error, proposal_id: p.id });
        }
        return refuse(r.error);
      }
      Object.assign(p, { state: "applied", approved_by: who.id, aloud: Boolean(body.p_aloud), edit_id: r.edit_id, decided_at: now(), updated_at: now() });
      notify("study_edit_proposals", "UPDATE", p);
      return json({ ...r, proposal_id: p.id });
    }

    if (fn === "study_withdraw_edit") {
      const p = db.proposals.find((x) => x.id === body.p_proposal && x.proposed_by === who.id && ["pending", "conflict"].includes(x.state));
      if (!p) return refuse("not pending");
      Object.assign(p, { state: "withdrawn", decided_at: now(), updated_at: now() });
      notify("study_edit_proposals", "UPDATE", p);
      return json(null);
    }

    if (fn === "study_undo_edit") {
      const e = db.edits.find((x) => x.id === body.p_edit);
      if (!e) return refuse("bad undo");
      const s = sec(e.lecture_id, e.part_idx);
      const later = db.edits.some((x) => x.lecture_id === e.lecture_id && x.part_idx === e.part_idx && x.anchor === e.anchor && x.gen === e.gen && x.rev > e.rev);
      if (e.source_kind === "undo" || later || !s || (s.gen ?? 0) !== e.gen) return refuse("bad undo");
      const r = apply(
        { lecture_id: e.lecture_id, part_idx: e.part_idx, anchor: e.anchor, gen: e.gen, base_rev: s.rev ?? 0, occurrence: 1, kind: e.kind, before_text: e.after_text, after_text: e.before_text, note: "" },
        { author: who.id, undoOf: e.id },
      );
      return r.error ? refuse(r.error) : json(r);
    }
    return undefined;
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || (b.op !== "ask" && b.op !== "fix_check")) return undefined;
    db.kCalls.push({ fn: `api ${b.op}${b.share ? " share" : ""}`, body: b, at: Date.now() });
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true; // handled: the base mock answers nothing more
    };
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const n = Number(token.replace(/^tok-/, ""));
    const me = db.members.find((m) => m.user_id === `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`);
    if (!me) return send(401, { error: "not signed in" });

    if (b.op === "fix_check") {
      const pr = db.proposals.find((x) => x.id === b.proposalId);
      if (!pr || pr.state !== "pending") return send(409, { error: "not pending" });
      Object.assign(pr, { check_ok: false, check_note: "בשקף 6 לא כתוב t½ לכל אחת מהתרופות.", checked_at: now() });
      return send(200, { ok: false, note: pr.check_note });
    }

    if (b.share) {
      const s = b.share;
      const t = s.turn || {};
      if (!t.sig || t.sig !== `sig:${s.lectureId}:${t.u.length}:${t.a.length}` || !String(t.u).includes(s.question)) return send(400, { error: "bad turn" });
      const q = { id: uuidK(++db.kSeq), lecture_id: s.lectureId, part_idx: s.part, anchor: s.anchor, quote: String(s.quote || "").slice(0, 200), kind: "question", body: s.question, parent_id: null, resolved: false, author_id: me.user_id, created_at: now(), ask_attempt: false, resolved_by: null };
      const a = { ...q, id: uuidK(++db.kSeq), kind: "comment", body: String(t.a).slice(0, 2000), parent_id: q.id, ask_attempt: true };
      db.comments.push(q, a);
      db.kNotify?.("study_comments", "INSERT", q);
      db.kNotify?.("study_comments", "INSERT", a);
      return send(200, { id: q.id });
    }

    // The stream: a zero-width space, then one JSON line at a time.
    const u = `${b.focus ? "The paragraph:\n…\n\n" : ""}The question:\n${b.question}`;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.write("​" + JSON.stringify({ t: "turn", u }) + "\n");
    let a = "";
    for (const d of ANSWER) {
      await pause(db.askDelayMs);
      a += d;
      res.write(JSON.stringify({ t: "a", d }) + "\n");
    }
    res.end(JSON.stringify({ t: "done", stop: "end_turn", badTags: [], model: "claude-mock", left: 17, sig: `sig:${b.lectureId}:${u.length}:${a.length}` }) + "\n");
    return true;
  },
};

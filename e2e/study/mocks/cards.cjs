// Package C's mock plugin (spec §8.3; design-cards §6.3): section C's tables,
// functions and the op "cards" of /api/study/ai, on top of e2e/study/mock.cjs.
//
//   GET  study_cards, study_card_batches, study_card_edits      the shared deck (the group's)
//   GET  study_card_states, GET/POST study_card_settings         the token's user's own rows, never another's
//   rpc  study_card_round, study_add_card, study_edit_card (versions, "conflict"), study_delete_card,
//        study_revert_card, study_card_review ("ok"/"dup"/"stale"), study_card_undo, study_card_hide,
//        study_card_reset, study_my_card_counts, study_my_card_days, study_my_card_topics
//   C's end (§12.3.C): GET study_card_adoptions and study_my_cards (the token's user's own rows);
//        rpc study_my_deck, study_card_adopt, study_card_still_true, study_my_card_review ("ok"/"dup"/
//        "stale"), study_my_card_undo, study_my_card_set; study_my_card_counts counts a card as new only
//        in the member's deck (an added part, a trap card, her own card) and leaves a closed trap card
//        out, as the read policy does; study_add_card takes part, para and quote; the settings row
//        has home. mistakeCard() makes a private card as section C's trigger makes one on a wrong
//        practice or quiz answer; trapCard() as study_private.trap_card does.
//   POST /api/study/ai {op:"cards"}  streamed for real: U+200B, {"t":"start"} after 300 ms, one card
//        line every 300 ms, then done; each card saved and notified, the part finished. Each part's
//        model call is recorded in db.calls as one study_reserve before and one study_settle after,
//        with p_key, kind "cards" and the batch id as ref, as the op makes them.
//
// Switches for the script (db.cardsMock), by part index since a round's batches are made when it is
// planned: busyPart (another phone holds that part: it is "writing" there and this one gets 409 once;
// finishElsewhere() lets that phone end it), failPart (that part's call stops at the 270 s guard
// before its first card: \0ERROR timeout, the part failed, once), budget (402 before any part),
// offline (study_card_review answers 503, a connection that is down). Times: the pages run on a fixed
// clock (design-cards §6.3), and db.cardsMock.offset puts this plugin's clock on the same one. The
// script sets db.notifyCards = mock.notify, so the op's writes reach every phone by Realtime.
// Sessions use mock.cjs's own tokens ("tok-<n>" for the user uuid(n)).
const crypto = require("crypto");

const DAY = 86_400_000;
const uuidOf = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? uuidOf(Number(m[1])) : null;
};
const ASPECTS = ["mechanism", "uses", "pk", "adverse", "contra", "interactions", "resistance", "dosing", "classification", "epidemiology", "lifecycle", "pathogenesis", "clinical", "diagnosis", "treatment", "prevention", "other"];
const CLOZE = /^[^{}]*\{\{[^{}]{1,80}\}\}[^{}]*$/;

/** Synthetic cards on the fixture lecture's parts (e2e/study/fixtures: diuretics), two a part. */
const SAMPLES = {
  0: [
    { kind: "qa", front: "באיזה מקטע של הנפרון נספג רוב ה-Na+?", back: "Proximal tubule, כ-65%.", extra: "", slides: [2], topic: "Nephron", aspect: "pk", para: 1 },
    { kind: "cloze", front: "Furosemide נותנים {{IV לאט}} בבצקת ריאות.", back: "", extra: "", slides: [3], topic: "Furosemide", aspect: "dosing" },
  ],
  1: [
    { kind: "qa", front: "מה מנגנון הפעולה של Acetazolamide?", back: "עיכוב carbonic anhydrase.", extra: "השתן נעשה בסיסי.", slides: [4], topic: "Acetazolamide", aspect: "mechanism" },
    { kind: "cloze", front: "Acetazolamide גורמת ל-{{hyperchloremic metabolic acidosis}}.", back: "", extra: "", slides: [5], topic: "Acetazolamide", aspect: "adverse" },
  ],
  2: [
    { kind: "qa", front: "איזה טרנספורטר מעכבות Loop diuretics?", back: "NKCC2.", extra: "בלולאה העולה העבה.", slides: [6], topic: "Loop diuretics", aspect: "mechanism", figure: "fig:6-1" },
    { kind: "cloze", front: "תופעת הלוואי של Loop diuretics שפוגעת בשמיעה היא {{ototoxicity}}.", back: "", extra: "", slides: [8], topic: "Loop diuretics", aspect: "adverse" },
  ],
  3: [
    { kind: "cloze", front: "Thiazides מעכבות את {{NCC}} בצינורית הרחוקה.", back: "", extra: "", slides: [9], topic: "Thiazides", aspect: "mechanism" },
    { kind: "qa", front: "מה מקומן של Thiazides ביתר לחץ דם?", back: "קו ראשון.", extra: "", slides: [10], topic: "Thiazides", aspect: "uses" },
  ],
  4: [
    { kind: "qa", front: "איזו תופעת לוואי הורמונלית יש ל-Spironolactone?", back: "Gynecomastia.", extra: "", slides: [13], topic: "Spironolactone", aspect: "adverse" },
    { kind: "cloze", front: "Amiloride ו-Triamterene חוסמות את {{ENaC}}.", back: "", extra: "", slides: [14], topic: "Amiloride", aspect: "mechanism" },
  ],
  5: [
    { kind: "qa", front: "איך נותנים Mannitol?", back: "IV בלבד.", extra: "", slides: [15], topic: "Mannitol", aspect: "dosing" },
    { kind: "cloze", front: "Mannitol מורידה {{לחץ תוך-גולגולתי}}.", back: "", extra: "", slides: [16], topic: "Mannitol", aspect: "uses" },
  ],
  6: [
    { kind: "qa", front: "מה NSAIDs עושים להשפעה של משתנים?", back: "מחלישים אותה.", extra: "", slides: [17], topic: "NSAIDs", aspect: "interactions" },
    { kind: "cloze", front: "עם Digoxin, {{hypokalemia}} מסוכנת.", back: "", extra: "", slides: [17], topic: "Digoxin", aspect: "interactions" },
  ],
  7: [
    { kind: "qa", front: "איזו קבוצה היא החזקה ביותר בטבלת ההשוואה?", back: "Loop diuretics.", extra: "", slides: [19], topic: "Loop diuretics", aspect: "classification" },
    { kind: "cloze", front: "בטבלת האלקטרוליטים, {{Thiazides}} שומרות סידן.", back: "", extra: "", slides: [20], topic: "Thiazides", aspect: "classification" },
  ],
};

/* ── study_card_round's arithmetic (section C), on the mock's lecture ── */
function jsonbLength(v) {
  if (Array.isArray(v)) return v.length ? 2 + v.reduce((n, x) => n + jsonbLength(x), 0) + 2 * (v.length - 1) : 2;
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    return e.length ? 2 + e.reduce((n, [k, x]) => n + [...JSON.stringify(k)].length + 2 + jsonbLength(x), 0) + 2 * (e.length - 1) : 2;
  }
  return [...JSON.stringify(v ?? null)].length;
}
const slideChars = (s) => (s.lines || []).reduce((n, l) => n + [...l].length, 0) + [...(s.notes || "")].length + (Array.isArray(s.tables) && s.tables.length ? jsonbLength(s.tables) : 0);

module.exports = {
  SAMPLES,
  /** A private card from a member's wrong answer (C's end: the trigger on study_answers). */
  mistakeCard(db, userId, o) {
    const row = {
      id: crypto.randomUUID(), user_id: userId, group_id: db.group.id, lecture_id: o.lecture_id, part_idx: o.part_idx ?? null, anchor: o.anchor ?? null,
      origin: o.origin ?? "practice", question_id: o.question_id ?? crypto.randomUUID(), comment_id: null, front: o.front, back: o.back, extra: o.extra ?? "",
      slides: o.slides ?? [], state: 0, step: 0, stability: 0, difficulty: 0, due: null, last_review: null, reps: 0, lapses: 0, suspended: false,
      created_at: new Date(nowOf(db) + db.cardsMock.mine.length).toISOString(), deleted_at: null, // made one after another
    };
    db.cardsMock.mine.push(row);
    return row;
  },
  /** A group trap card (C's end: study_private.trap_card), open now or at opensAt. */
  trapCard(db, o) {
    const card = newCard(db, { source: "trap", figure: "", extra: "", topic: "", aspect: "other", created_by: null, kind: "qa", ...o });
    db.notifyCards?.("study_cards", "INSERT", { ...card });
    return card;
  },
  /** The other phone that held a part (busyPart) writes it to the end. */
  finishElsewhere(db, partIdx, whoId) {
    const m = db.cardsMock;
    const batch = m.batches.find((b) => b.part_idx === partIdx && b.status === "writing");
    if (!batch) return 0;
    const lecture = db.lectures.find((l) => l.id === batch.lecture_id);
    const have = m.cards.filter((c) => c.lecture_id === lecture.id && !c.deleted_at).map((c) => c.front);
    let made = 0;
    for (const s of (SAMPLES[partIdx] ?? []).filter((x) => !have.includes(x.front)).slice(0, batch.wanted - batch.made)) {
      const { para, ...fields } = s;
      const card = newCard(db, { lecture_id: lecture.id, batch_id: batch.id, source: "ai", part_idx: partIdx, figure: "", ...fields, anchor: para ?? null, quote: "", created_by: whoId });
      db.notifyCards?.("study_cards", "INSERT", { ...card });
      batch.made += 1;
      made += 1;
    }
    Object.assign(batch, { status: "ready", error: null, updated_at: iso(db) });
    db.notifyCards?.("study_card_batches", "UPDATE", { ...batch });
    return made;
  },
  seed(db) {
    db.cardsMock = {
      cards: [],
      batches: [],
      edits: [],
      states: new Map(), // `${user}:${card}` → state row
      reviews: [], // review rows (user_id …)
      settings: new Map(), // user → { new_per_day, retention, home }
      adoptions: [], // { user_id, lecture_id, part_idx, added_at } (C's end)
      mine: [], // private cards, study_my_cards rows (C's end)
      myReviews: [], // study_my_card_reviews rows
      reviewCalls: new Map(), // review id → how many times it arrived
      reviewOrder: [], // review ids in the order they arrived (ok or dup)
      api: [], // { batch, who, start, startLine, end, status }
      busyPart: null,
      failPart: null,
      budget: false,
      offline: false,
      offset: 0,
      denied: [], // reads of private rows that were not the reader's (must stay empty)
    };
  },
  async rest(args) {
    const sent = handle(args);
    if (sent === undefined) return undefined;
    await sent;
    return true;
  },
  async api(req, res, db, body) {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p !== "/api/study/ai") return undefined;
    // The mock reads the body once and hands it over (mock.cjs): the stream is already read.
    if (body?.op !== "cards") return undefined;
    await cardsOp(req, res, db, body);
    return true;
  },
};

const nowOf = (db) => Date.now() + (db.cardsMock.offset || 0);
const iso = (db) => new Date(nowOf(db)).toISOString();
const studyDay = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY;
  return Number(p.hour) < 4 ? day - 1 : day;
};
const dayEnd = (ms) => {
  // The next 04:00 in Israel after the study day of ms (good to the minute for the counts).
  let t = (studyDay(ms) + 1) * DAY;
  while (studyDay(t) <= studyDay(ms)) t += 15 * 60_000;
  return t;
};

/** A filter of PostgREST's (eq, is, in, gt, lt…) on one value. */
function test(v, op) {
  if (op.startsWith("not.")) return !test(v, op.slice(4));
  const [k, ...rest] = op.split(".");
  const arg = rest.join(".");
  const s = (x) => (x === null || x === undefined ? null : String(x));
  switch (k) {
    case "eq":
      return s(v) === arg;
    case "neq":
      return s(v) !== arg;
    case "is":
      return arg === "null" ? v === null || v === undefined : String(v) === arg;
    case "in":
      return arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(s(v));
    case "gte":
      return s(v) !== null && s(v) >= arg;
    case "lte":
      return s(v) !== null && s(v) <= arg;
    default:
      throw new Error(`filter ${op} not mocked`);
  }
}

/** Select, filter, order and range rows as PostgREST does, checking every column against the schema. */
function read(rows, table, query, check, where) {
  const cols = (query.get("select") || "*").split(",").map((c) => c.trim()).filter(Boolean);
  check.cols(table, cols, where);
  let out = [...rows];
  for (const [k, v] of query) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    check.cols(table, [k], where);
    out = out.filter((r) => test(r[k], v));
  }
  const order = query.get("order");
  if (order) {
    const keys = order.split(",").map((x) => {
      const [c, dir] = x.split(".");
      check.cols(table, [c], where);
      return [c, dir === "desc" ? -1 : 1];
    });
    out.sort((a, b) => {
      for (const [c, d] of keys) {
        const x = a[c] ?? null;
        const y = b[c] ?? null;
        if (x === y) continue;
        if (x === null) return 1; // nulls last, as Postgres sorts ascending
        if (y === null) return -1;
        return (x > y ? 1 : -1) * d;
      }
      return 0;
    });
  }
  const offset = Number(query.get("offset") || 0);
  const limit = query.get("limit") ? Number(query.get("limit")) : out.length;
  out = out.slice(offset, offset + limit);
  return cols.includes("*") ? out : out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
}

/** Why a card's content is refused, or null (study_card_problem). */
function problem(db, c, lectureId) {
  const front = String(c.front ?? "").trim();
  if (!["qa", "cloze"].includes(c.kind)) return "bad kind";
  if (front.length < 3 || front.length > 400) return "front length";
  if (String(c.back ?? "").length > 300 || String(c.extra ?? "").length > 500) return "too long";
  if (c.kind === "cloze" && (String(c.back ?? "") !== "" || !CLOZE.test(String(c.front)))) return "bad cloze";
  if (c.kind === "qa" && (front.includes("{{") || front.includes("}}") || !String(c.back ?? "").trim())) return "bad answer";
  const lecture = db.lectures.find((l) => l.id === lectureId);
  const have = new Set((lecture?.slides ?? []).map((s) => s.n));
  if ((c.slides ?? []).some((n) => !have.has(n))) return "unknown slide";
  if (c.figure) {
    const m = /^fig:(\d+)-(\d+)$/.exec(c.figure);
    if (!m) return "bad figure";
    const s = lecture?.slides.find((x) => x.n === Number(m[1]));
    if (!s?.figures?.some((f) => f.k === Number(m[2]))) return "unknown figure";
  }
  return null;
}

const content = (c) => ({ kind: c.kind, front: c.front, back: c.back, extra: c.extra, figure: c.figure, slides: [...c.slides] });
const same = (a, b) => JSON.stringify(content(a)) === JSON.stringify(content(b));

function handle({ method, path, query, body, who, db, notify, json, refuse, check }) {
  const m = db.cardsMock;
  const where = `${method} ${path}`;
  const me = who?.id ?? null;
  const member = me && db.members.some((x) => x.user_id === me);
  const lectureOk = (id) => db.lectures.some((l) => l.id === id && !l.deleted_at) && member;
  const touch = (c, patch, content = true) => {
    Object.assign(c, patch);
    if (content) c.version += 1;
    c.updated_at = iso(db);
    notify("study_cards", "UPDATE", { ...c });
  };
  const edit = (card, action, before = {}, after = {}) => {
    const e = { id: crypto.randomUUID(), card_id: card.id, action, version: card.version, before, after, edited_by: me, edited_at: iso(db) };
    m.edits.push(e);
    notify("study_card_edits", "INSERT", { ...e });
    return e;
  };

  /** Is this group card new material for the member (study_private.card_in_my_deck). */
  const inMyDeck = (c) =>
    c.source === "trap" || (c.source === "member" && c.created_by === me) || m.adoptions.some((a) => a.user_id === me && a.lecture_id === c.lecture_id && a.part_idx === c.part_idx);
  /** A trap card waiting for its opens_at is invisible to members (review SEC-6). */
  const open = (c) => !c.opens_at || Date.parse(c.opens_at) <= nowOf(db);
  /** study_private.card_parts: the summary's parts, else the parts its rounds were written in. */
  const partsOf = (lectureId) => {
    const secs = db.sections.filter((s) => s.lecture_id === lectureId).sort((x, y) => x.idx - y.idx);
    if (secs.length) return secs.map((s) => ({ part_idx: s.idx, heading: s.title, slide_from: s.slide_from, slide_to: s.slide_to }));
    const by = new Map();
    for (const x of m.batches.filter((y) => y.lecture_id === lectureId)) {
      const p = by.get(x.part_idx) ?? { part_idx: x.part_idx, heading: x.heading, slide_from: x.slide_from, slide_to: x.slide_to };
      p.slide_from = Math.min(p.slide_from, x.slide_from);
      p.slide_to = Math.max(p.slide_to, x.slide_to);
      by.set(x.part_idx, p);
    }
    return [...by.values()].sort((x, y) => x.part_idx - y.part_idx);
  };

  /* ── tables ── */
  if (path === "/rest/v1/study_cards" && method === "GET") return json(read(member ? m.cards.filter((c) => c.group_id === db.group.id && open(c)) : [], "study_cards", query, check, where));
  if (path === "/rest/v1/study_card_adoptions" && method === "GET") return json(read(m.adoptions.filter((a) => a.user_id === me), "study_card_adoptions", query, check, where));
  if (path === "/rest/v1/study_my_cards" && method === "GET") {
    const asked = query.get("user_id");
    if (asked && asked !== `eq.${me}`) m.denied.push(`${who?.user_metadata?.full_name} asked for ${asked}`);
    return json(read(m.mine.filter((x) => x.user_id === me), "study_my_cards", query, check, where));
  }
  if (path === "/rest/v1/study_card_batches" && method === "GET") return json(read(member ? m.batches : [], "study_card_batches", query, check, where));
  if (path === "/rest/v1/study_card_edits" && method === "GET") return json(read(member ? m.edits : [], "study_card_edits", query, check, where));
  if (path === "/rest/v1/study_card_states" && method === "GET") {
    // RLS: only the reader's own rows. A filter naming another user is recorded (it must never happen).
    const asked = query.get("user_id");
    if (asked && asked !== `eq.${me}`) m.denied.push(`${who?.user_metadata?.full_name} asked for ${asked}`);
    const mine = [...m.states.values()].filter((s) => s.user_id === me);
    return json(read(mine, "study_card_states", query, check, where));
  }
  if (path === "/rest/v1/study_card_reviews" && method === "GET") {
    return json(read(m.reviews.filter((r) => r.user_id === me), "study_card_reviews", query, check, where));
  }
  if (path === "/rest/v1/study_card_settings") {
    if (method === "GET") {
      const row = m.settings.get(me);
      return json(read(row ? [{ user_id: me, ...row }] : [], "study_card_settings", query, check, where));
    }
    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows) {
        check.cols("study_card_settings", Object.keys(r), where);
        if (r.user_id && r.user_id !== me) return refuse("new row violates row-level security policy", 403);
        const n = Number(r.new_per_day ?? 20);
        const ret = Number(r.retention ?? 0.9);
        const home = r.home === undefined ? (m.settings.get(me)?.home ?? null) : r.home;
        if (n < 0 || n > 200 || ret < 0.8 || ret > 0.97 || (home !== null && !["app", "anki"].includes(home))) return refuse("new row for relation \"study_card_settings\" violates check constraint");
        m.settings.set(me, { new_per_day: n, retention: ret, home });
      }
      return json(null, 201);
    }
  }

  if (!path.startsWith("/rest/v1/rpc/study_")) return undefined;
  const fn = path.slice("/rest/v1/rpc/".length);
  const MINE = new Set([
    "study_card_round",
    "study_add_card",
    "study_edit_card",
    "study_delete_card",
    "study_revert_card",
    "study_card_review",
    "study_card_undo",
    "study_card_hide",
    "study_card_reset",
    "study_my_card_counts",
    "study_my_card_days",
    "study_my_card_topics",
    "study_my_deck",
    "study_card_adopt",
    "study_card_still_true",
    "study_my_card_review",
    "study_my_card_undo",
    "study_my_card_set",
  ]);
  if (!MINE.has(fn)) return undefined;
  check.rpc(fn, body, where);
  if (!me) return refuse("not signed in", 401);
  const b = body || {};

  switch (fn) {
    case "study_card_round": {
      if (!lectureOk(b.p_lecture)) return refuse("lecture not found");
      const lecture = db.lectures.find((l) => l.id === b.p_lecture);
      const mine = m.batches.filter((x) => x.lecture_id === lecture.id);
      const r = mine.reduce((n, x) => Math.max(n, x.round), 0);
      const open = mine.filter((x) => x.round === r && (x.status === "pending" || x.status === "writing"));
      if (open.length) return json([{ round: r, batches: open.length, wanted: open.reduce((n, x) => n + x.wanted, 0), fresh: false }]);
      if (m.cards.filter((c) => c.lecture_id === lecture.id && !c.deleted_at).length >= 150) return refuse("enough cards");
      const round = r + 1;
      const sections = db.sections.filter((s) => s.lecture_id === lecture.id);
      const ordered = [...lecture.slides].sort((x, y) => x.n - y.n);
      const parts = sections.length
        ? sections.map((s) => ({ part_idx: s.idx, heading: s.title, from: s.slide_from, to: s.slide_to }))
        : Array.from({ length: Math.ceil(ordered.length / 6) }, (_, i) => {
            const chunk = ordered.slice(i * 6, i * 6 + 6);
            return { part_idx: i, heading: "", from: chunk[0].n, to: chunk[chunk.length - 1].n };
          });
      const want = parts.map((p) => {
        const sum = ordered.filter((s) => s.n >= p.from && s.n <= p.to).reduce((n, s) => n + slideChars(s), 0);
        return Math.min(round === 1 ? 8 : 4, Math.round(sum / (round === 1 ? 250 : 500)));
      });
      const total = want.reduce((x, y) => x + y, 0);
      let made = 0;
      parts.forEach((p, i) => {
        if (want[i] < 1) return;
        const batch = {
          id: crypto.randomUUID(), lecture_id: lecture.id, round, part_idx: p.part_idx, heading: p.heading, slide_from: p.from, slide_to: p.to,
          wanted: total > 60 ? Math.max(1, Math.floor((want[i] * 60) / total)) : want[i], status: "pending", made: 0, rejected: 0, error: null, attempts: 0, updated_at: iso(db),
        };
        m.batches.push(batch);
        notify("study_card_batches", "INSERT", { ...batch });
        made += 1;
      });
      if (!made) return refuse("no slides");
      const these = m.batches.filter((x) => x.lecture_id === lecture.id && x.round === round);
      return json([{ round, batches: made, wanted: these.reduce((n, x) => n + x.wanted, 0), fresh: true }]);
    }
    case "study_add_card": {
      if (!lectureOk(b.p_lecture)) return refuse("lecture not found");
      if (m.cards.filter((c) => c.lecture_id === b.p_lecture && !c.deleted_at).length >= 150) return refuse("enough cards");
      const c = b.p_card || {};
      const why = problem(db, { ...c, back: c.back ?? "", extra: c.extra ?? "", figure: c.figure ?? "", slides: c.slides ?? [] }, b.p_lecture);
      if (why) return refuse(why);
      const asPart = Number.isInteger(c.part) && db.sections.some((s) => s.lecture_id === b.p_lecture && s.idx === c.part) ? c.part : null;
      const sec = asPart === null ? db.sections.find((s) => s.lecture_id === b.p_lecture && (c.slides ?? [])[0] >= s.slide_from && (c.slides ?? [])[0] <= s.slide_to) : null;
      const card = newCard(db, {
        anchor: asPart !== null && Number.isInteger(c.para) ? c.para : null, quote: asPart !== null && Number.isInteger(c.para) ? String(c.quote ?? "").slice(0, 200) : "",
        lecture_id: b.p_lecture, source: "member", part_idx: asPart ?? (sec ? sec.idx : null), kind: c.kind, front: String(c.front).trim(), back: c.back ?? "",
        extra: c.extra ?? "", figure: c.figure ?? "", slides: c.slides ?? [], topic: c.topic ?? "", aspect: ASPECTS.includes(c.aspect) ? c.aspect : "other", created_by: me,
      });
      notify("study_cards", "INSERT", { ...card });
      return json(card.id);
    }
    case "study_edit_card": {
      const c = m.cards.find((x) => x.id === b.p_card);
      if (!c || !member) return refuse("card not found");
      if (c.deleted_at) return refuse("card deleted");
      if (c.version !== b.p_version) return refuse("conflict");
      const n = b.p_new || {};
      const next = {
        kind: n.kind ?? c.kind,
        front: String(n.front ?? c.front).trim(),
        back: (n.kind ?? c.kind) === "cloze" ? "" : String(n.back ?? c.back).trim(),
        extra: String(n.extra ?? c.extra).trim(),
        figure: n.figure ?? c.figure,
        slides: n.slides ?? c.slides,
      };
      const why = problem(db, next, c.lecture_id);
      if (why) return refuse(why);
      if (same(next, c)) return refuse("no change");
      const before = content(c);
      touch(c, { ...next, updated_by: me, ...(c.stale_at ? { stale_at: null, stale_edit: null } : {}) }); // C's end: an edit clears a correction's mark
      edit(c, "edit", before, content(c));
      return json(c.version);
    }
    case "study_delete_card": {
      const c = m.cards.find((x) => x.id === b.p_card);
      if (!c || !member) return refuse("card not found");
      if (b.p_delete && !c.deleted_at) {
        touch(c, { deleted_at: iso(db), deleted_by: me }, false);
        edit(c, "delete");
      } else if (!b.p_delete && c.deleted_at) {
        touch(c, { deleted_at: null, deleted_by: null }, false);
        edit(c, "restore");
      }
      return json(null);
    }
    case "study_revert_card": {
      const e = m.edits.find((x) => x.id === b.p_edit);
      if (!e) return refuse("edit not found");
      const c = m.cards.find((x) => x.id === e.card_id);
      if (!c || !member) return refuse("edit not found");
      if (!["edit", "revert"].includes(e.action)) return refuse("nothing to revert");
      if (c.deleted_at) return refuse("card deleted");
      if (same(e.before, c)) return refuse("no change");
      const before = content(c);
      touch(c, { ...content(e.before), updated_by: me });
      edit(c, "revert", before, content(c));
      return json(c.version);
    }
    case "study_card_review": {
      if (m.offline) return refuse("network", 503); // the connection is down (the script's switch)
      m.reviewCalls.set(b.p_review, (m.reviewCalls.get(b.p_review) ?? 0) + 1);
      const dup = m.reviews.find((r) => r.id === b.p_review);
      if (dup) {
        if (dup.user_id !== me) return refuse("bad review");
        return json("dup");
      }
      const c = m.cards.find((x) => x.id === b.p_card);
      if (!c || !member) return refuse("card not found");
      if (c.deleted_at) return refuse("card deleted");
      if (![1, 2, 3, 4].includes(b.p_rating)) return refuse("bad rating");
      const at = Date.parse(b.p_reviewed_at);
      if (!Number.isFinite(at) || at > nowOf(db) + 5 * 60_000 || at < nowOf(db) - 30 * DAY) return refuse("bad time");
      const key = `${me}:${c.id}`;
      const s = m.states.get(key);
      if ((s?.reps ?? 0) !== b.p_prev_reps) return refuse("stale");
      if (s?.last_review && at < Date.parse(s.last_review)) return refuse("stale");
      const n = b.p_next || {};
      const lapse = b.p_rating === 1 && (s?.state ?? 0) === 2 ? 1 : 0;
      if (![1, 2, 3].includes(n.state) || !(n.stability >= 0.001) || !(n.difficulty >= 1 && n.difficulty <= 10) || !n.due || Date.parse(n.due) < at || n.lapses !== (s?.lapses ?? 0) + lapse) return refuse("bad state");
      const prev = s ? { ...s } : null;
      m.states.set(key, { user_id: me, card_id: c.id, state: n.state, step: n.step ?? 0, stability: n.stability, difficulty: n.difficulty, due: n.due, last_review: b.p_reviewed_at, reps: b.p_prev_reps + 1, lapses: n.lapses, suspended: s?.suspended ?? false });
      m.reviews.push({ id: b.p_review, user_id: me, card_id: c.id, rating: b.p_rating, reviewed_at: b.p_reviewed_at, ms: b.p_ms, state_before: s?.state ?? 0, prev, created_at: iso(db) });
      m.reviewOrder.push(b.p_review);
      return json("ok");
    }
    case "study_card_undo": {
      const r = m.reviews.find((x) => x.id === b.p_review && x.user_id === me);
      if (!r) return refuse("review not found");
      const later = m.reviews.some((x) => x.user_id === me && x.card_id === r.card_id && x.id !== r.id && x.reviewed_at > r.reviewed_at);
      if (later) return refuse("not the latest");
      const key = `${me}:${r.card_id}`;
      if (r.prev) m.states.set(key, r.prev);
      else m.states.delete(key);
      m.reviews = m.reviews.filter((x) => x.id !== r.id);
      m.undone = [...(m.undone ?? []), r.id];
      return json(null);
    }
    case "study_card_hide": {
      const c = m.cards.find((x) => x.id === b.p_card);
      if (!c || !member) return refuse("card not found");
      const key = `${me}:${c.id}`;
      const s = m.states.get(key) ?? { user_id: me, card_id: c.id, state: 0, step: 0, stability: 0, difficulty: 0, due: null, last_review: null, reps: 0, lapses: 0, suspended: false };
      m.states.set(key, { ...s, suspended: Boolean(b.p_hide) });
      return json(null);
    }
    case "study_card_reset": {
      if (!lectureOk(b.p_lecture)) return refuse("lecture not found");
      let n = 0;
      for (const c of m.cards.filter((x) => x.lecture_id === b.p_lecture)) if (m.states.delete(`${me}:${c.id}`)) n += 1;
      return json(n);
    }
    case "study_my_card_counts": {
      const now = b.p_now ? Date.parse(b.p_now) : nowOf(db);
      const end = dayEnd(now);
      const by = new Map();
      for (const c of m.cards.filter((x) => x.group_id === b.p_group && !x.deleted_at && open(x))) {
        const s = m.states.get(`${me}:${c.id}`);
        const row = by.get(c.lecture_id) ?? { lecture_id: c.lecture_id, cards: 0, new_cards: 0, learning_due: 0, review_due: 0, studied: 0, hidden: 0, next_due: null };
        row.cards += 1;
        if ((!s || (s.state === 0 && !s.suspended)) && inMyDeck(c)) row.new_cards += 1;
        if (s && [1, 3].includes(s.state) && !s.suspended && Date.parse(s.due) <= now + 20 * 60_000) row.learning_due += 1;
        if (s && s.state === 2 && !s.suspended && Date.parse(s.due) < end) row.review_due += 1;
        if (s && s.state > 0) row.studied += 1;
        if (s?.suspended) row.hidden += 1;
        if (s && s.state > 0 && !s.suspended && (!row.next_due || s.due < row.next_due)) row.next_due = s.due;
        by.set(c.lecture_id, row);
      }
      return json([...by.values()]);
    }
    case "study_my_card_days": {
      const by = new Map();
      for (const r of m.reviews.filter((x) => x.user_id === me)) {
        const day = new Date(studyDay(Date.parse(r.reviewed_at)) * DAY).toISOString().slice(0, 10);
        const row = by.get(day) ?? { day, reviews: 0, first_seen: 0, again: 0, seconds: 0 };
        row.reviews += 1;
        if (r.state_before === 0) row.first_seen += 1;
        if (r.rating === 1) row.again += 1;
        row.seconds += Math.round((r.ms ?? 0) / 1000);
        by.set(day, row);
      }
      return json([...by.values()].sort((x, y) => (x.day < y.day ? -1 : 1)));
    }
    case "study_my_card_topics":
      return json([]);
    /* ── C's end ── */
    case "study_my_deck": {
      if (!lectureOk(b.p_lecture)) return refuse("lecture not found");
      return json(
        partsOf(b.p_lecture).map((p) => ({
          ...p,
          cards: m.cards.filter((c) => c.lecture_id === b.p_lecture && c.part_idx === p.part_idx && !c.deleted_at && open(c)).length,
          in_deck: m.adoptions.some((a) => a.user_id === me && a.lecture_id === b.p_lecture && a.part_idx === p.part_idx),
          studied: m.cards.filter((c) => c.lecture_id === b.p_lecture && c.part_idx === p.part_idx && !c.deleted_at && (m.states.get(`${me}:${c.id}`)?.state ?? 0) > 0).length,
        })),
      );
    }
    case "study_card_adopt": {
      if (!lectureOk(b.p_lecture)) return refuse("lecture not found");
      const parts = partsOf(b.p_lecture).map((p) => p.part_idx);
      if (b.p_parts && b.p_parts.some((x) => !parts.includes(x))) return refuse("bad parts");
      const want = b.p_parts ?? parts;
      if (b.p_on !== false) {
        for (const x of want) if (!m.adoptions.some((a) => a.user_id === me && a.lecture_id === b.p_lecture && a.part_idx === x)) m.adoptions.push({ user_id: me, lecture_id: b.p_lecture, part_idx: x, added_at: iso(db) });
      } else m.adoptions = m.adoptions.filter((a) => !(a.user_id === me && a.lecture_id === b.p_lecture && want.includes(a.part_idx)));
      return json(m.adoptions.filter((a) => a.user_id === me && a.lecture_id === b.p_lecture).map((a) => a.part_idx).sort((x, y) => x - y));
    }
    case "study_card_still_true": {
      const c = m.cards.find((x) => x.id === b.p_card);
      if (!c || !member) return refuse("card not found");
      if (c.stale_at) touch(c, { stale_at: null, stale_edit: null, checked_by: me, checked_at: iso(db) }, false);
      return json(null);
    }
    case "study_my_card_review": {
      if (m.offline) return refuse("network", 503);
      m.reviewCalls.set(b.p_review, (m.reviewCalls.get(b.p_review) ?? 0) + 1);
      const dup = m.myReviews.find((r) => r.id === b.p_review);
      if (dup) return dup.user_id === me ? json("dup") : refuse("bad review");
      const c = m.mine.find((x) => x.id === b.p_card && x.user_id === me);
      if (!c || c.deleted_at) return refuse("card not found");
      if (![1, 2, 3, 4].includes(b.p_rating)) return refuse("bad rating");
      const at = Date.parse(b.p_reviewed_at);
      if (!Number.isFinite(at) || at > nowOf(db) + 5 * 60_000 || at < nowOf(db) - 30 * DAY) return refuse("bad time");
      if (c.reps !== b.p_prev_reps || (c.last_review && at < Date.parse(c.last_review))) return refuse("stale");
      const n = b.p_next || {};
      const lapse = b.p_rating === 1 && c.state === 2 ? 1 : 0;
      if (![1, 2, 3].includes(n.state) || !(n.stability >= 0.001) || !(n.difficulty >= 1 && n.difficulty <= 10) || !n.due || Date.parse(n.due) < at || n.lapses !== c.lapses + lapse) return refuse("bad state");
      const prev = { state: c.state, step: c.step, stability: c.stability, difficulty: c.difficulty, due: c.due, last_review: c.last_review, reps: c.reps, lapses: c.lapses };
      Object.assign(c, { state: n.state, step: n.step ?? 0, stability: n.stability, difficulty: n.difficulty, due: n.due, last_review: b.p_reviewed_at, reps: c.reps + 1, lapses: n.lapses });
      m.myReviews.push({ id: b.p_review, user_id: me, card_id: c.id, rating: b.p_rating, reviewed_at: b.p_reviewed_at, ms: b.p_ms, prev, created_at: iso(db) });
      m.reviewOrder.push(b.p_review);
      return json("ok");
    }
    case "study_my_card_undo": {
      const r = m.myReviews.find((x) => x.id === b.p_review && x.user_id === me);
      if (!r) return refuse("review not found");
      if (m.myReviews.some((x) => x.card_id === r.card_id && x.id !== r.id && x.reviewed_at > r.reviewed_at)) return refuse("not the latest");
      Object.assign(m.mine.find((x) => x.id === r.card_id), r.prev);
      m.myReviews = m.myReviews.filter((x) => x.id !== r.id);
      m.undone = [...(m.undone ?? []), r.id];
      return json(null);
    }
    case "study_my_card_set": {
      if (!["hide", "show", "delete", "restore"].includes(b.p_action)) return refuse("bad action");
      const c = m.mine.find((x) => x.id === b.p_card && x.user_id === me);
      if (!c) return refuse("card not found");
      if (b.p_action === "hide" || b.p_action === "show") c.suspended = b.p_action === "hide";
      else c.deleted_at = b.p_action === "delete" ? iso(db) : null;
      return json(null);
    }
    default:
      return undefined;
  }
}

function newCard(db, c) {
  const card = {
    id: crypto.randomUUID(), group_id: db.group.id, batch_id: null, version: 1, created_at: new Date(nowOf(db)).toISOString(), updated_by: null,
    updated_at: new Date(nowOf(db)).toISOString(), deleted_at: null, deleted_by: null, model: null,
    anchor: null, quote: "", part_gen: null, trap_key: null, stale_at: null, stale_edit: null, checked_by: null, checked_at: null, opens_at: null, ...c,
  };
  db.cardsMock.cards.push(card);
  return card;
}

/* ── POST /api/study/ai {op:"cards"}: one part, streamed ── */
async function cardsOp(req, res, db, body) {
  const m = db.cardsMock;
  const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
  const send = (status, error) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error }));
  };
  if (!me || !db.members.some((x) => x.user_id === me)) return send(401, "not signed in");
  const lecture = db.lectures.find((l) => l.id === String(body.lectureId || "").toLowerCase());
  if (!lecture || lecture.deleted_at) return send(404, "lecture not found");
  const batch = m.batches.find((x) => x.id === String(body.batchId || "").toLowerCase());
  if (!batch) return send(404, "batch not found");
  if (batch.lecture_id !== lecture.id) return send(400, "batch of another lecture");
  const log = { batch: batch.id, part: batch.part_idx, who: me, start: Date.now(), startLine: null, end: null, status: null };
  m.api.push(log);
  if (m.busyPart === batch.part_idx && batch.status === "pending") {
    // Another phone took this part a moment ago.
    m.busyPart = null;
    Object.assign(batch, { status: "writing", attempts: batch.attempts + 1, updated_at: iso(db) });
    db.notifyCards?.("study_card_batches", "UPDATE", { ...batch });
    log.status = 409;
    log.end = Date.now();
    return send(409, "busy");
  }
  const stuck = batch.status === "writing" && Date.parse(batch.updated_at) < nowOf(db) - 6 * 60_000;
  if (batch.attempts >= 3 || !(batch.status === "pending" || batch.status === "failed" || stuck)) {
    log.status = 409;
    log.end = Date.now();
    return send(409, batch.attempts >= 3 && batch.status !== "ready" ? "gave up" : "busy");
  }
  if (m.budget) {
    log.status = 402;
    log.end = Date.now();
    return send(402, "budget");
  }
  Object.assign(batch, { status: "writing", attempts: batch.attempts + 1, updated_at: iso(db) });
  db.notifyCards?.("study_card_batches", "UPDATE", { ...batch });
  const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.write("​");
  // The model call: its reservation before, its settle after (the op's ledger, with the server key).
  db.calls.push(`cards rpc study_reserve ${JSON.stringify({ p_key: "server-key", p_group: db.group.id, p_lecture: lecture.id, p_kind: "cards", p_ref: batch.id })}`);
  await pause(300);
  log.startLine = Date.now();
  res.write('{"t":"start"}\n');
  const pool = SAMPLES[batch.part_idx] ?? [];
  const already = m.cards.filter((c) => c.lecture_id === lecture.id && !c.deleted_at).map((c) => c.front);
  const fresh = pool.filter((s) => !already.includes(s.front));
  const want = batch.wanted - batch.made;
  let made = 0;
  let error = null;
  if (m.failPart === batch.part_idx) {
    m.failPart = null; // once: "לנסות שוב" then writes it
    await pause(300);
    error = "timeout";
  }
  for (const s of error ? [] : fresh.slice(0, want)) {
    await pause(300);
    if (problem(db, { figure: "", ...s }, lecture.id)) {
      res.write(JSON.stringify({ t: "skip", why: "unknown slide" }) + "\n");
      continue;
    }
    // C's end: the op places the card on its paragraph (the sample's "para"), with the start of its text.
    const { para, ...fields } = s;
    const card = newCard(db, { lecture_id: lecture.id, batch_id: batch.id, source: "ai", part_idx: batch.part_idx, figure: "", ...fields, anchor: para ?? null, quote: "", created_by: me }); // an empty quote: the paragraph is the anchor itself (reanchor)
    made += 1;
    batch.made += 1;
    batch.updated_at = iso(db);
    db.notifyCards?.("study_cards", "INSERT", { ...card });
    res.write(JSON.stringify({ t: "c", c: { id: card.id, part_idx: card.part_idx, version: 1, kind: card.kind, front: card.front, back: card.back, extra: card.extra, figure: card.figure, slides: card.slides, topic: card.topic, aspect: card.aspect, para: card.anchor, quote: card.quote } }) + "\n");
  }
  if (!error && !made && batch.made < batch.wanted) error = "empty";
  db.calls.push(`cards rpc study_settle ${JSON.stringify({ p_key: "server-key", p_ref: batch.id, p_kind: "cards" })}`);
  Object.assign(batch, { status: error ? "failed" : "ready", error, updated_at: iso(db) });
  db.notifyCards?.("study_card_batches", "UPDATE", { ...batch });
  log.end = Date.now();
  log.status = error ? `error ${error}` : 200;
  if (error) res.end(`\n\u0000ERROR ${error}`);
  else res.end(JSON.stringify({ t: "done", made, rejected: 0, costUsd: 0.0045 * made }) + "\n");
}

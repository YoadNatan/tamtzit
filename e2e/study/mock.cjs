// The study app's e2e harness (spec §8.3): a static server for the built
// site, a strict mock of Supabase (REST, Auth, Storage and the Phoenix 2.0.0
// Realtime socket) per member, /api/study/* served by the same server so text
// and NDJSON really stream, a log of every call, and a plugin hook for each
// package's tables, RPCs and API handlers. Never contacts a real host.
//
//   const { createMock } = require("./mock.cjs");
//   const mock = await createMock({ dist, plugins: [require("./mocks/writing.cjs")], flags: "rel1" });
//   const { page } = await mock.open(browser, "שוהם", { path: "/" });
//
// Strict: an RPC argument or a column that e2e/study/schema-dump.json (written
// by `npm run test:contract` from the real SQL) does not list is refused and
// recorded in mock.problems, and so is a member's write to a study table that
// the grants do not allow (403 42501, as PostgREST answers): since W2 (spec
// §3.7) no member writes a part or a lecture's writing state, and a lecture
// is inserted only with the upload's columns. Realtime refuses a socket's sixth presence call
// within 30 s, as Supabase does (review FE-6).
//
// A plugin: module.exports = { seed(db), rest({ method, path, query, body, who, db, notify, single, json, refuse, check }),
//   api(req, res, db, body) } — each returns undefined for requests it does not handle; body is
//   the request's JSON, read once by the mock (a plugin never reads req itself). guard({ method,
//   path, who, db, refuse }) and apiGuard(req, res, db, body) run before every plugin's rest and
//   api (mocks/guide.cjs refuses the group's writes there while a guided step runs).
const http = require("http");
const fs = require("fs");
const path = require("path");

const SB = "https://mock.supabase.test";
const GROUP = { id: "22222222-2222-4222-8222-222222222222", name: "קבוצת שנה ג׳", join_code: "ABC123" };
const LECTURE_ID = "eeeeeeee-0000-4000-8000-000000000005";
const FIXTURES = path.join(__dirname, "fixtures");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const now = () => new Date().toISOString();
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** A database with every section loaded, at the versions the approved features
 *  need (spec §2.11, §12.2.2): the SQL always runs before a release's flags. */
const SCHEMA_ALL = { F: 1, A: 1, W: 2, Q: 3, Z: 3, C: 3, K: 2, P: 2, M: 3, N: 1, V: 1, U: 3, J: 1, H: 3, B: 1, G: 2, E: 1, T: 3, X: 1 };
/** The registry this branch's SQL writes (each section's last statement in
 *  supabase/study-schema.sql): what production's study_schema() answers once
 *  the release's SQL has run. Builds with every flag off and release 1's
 *  builds run against it, so a build that needs more than the SQL gives meets
 *  the schema gate here as it would in production. */
function sqlSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "study-schema.sql"), "utf8");
  const out = {};
  for (const m of sql.matchAll(/insert into study_private\.schema_sections \(section, version\) values \('([A-Z])', (\d+)\)/g)) out[m[1]] = Math.max(out[m[1]] ?? 0, Number(m[2]));
  return out;
}
const SCHEMA_SQL = sqlSchema();
/** The database a flag set's build runs against: this branch's SQL for "off",
 *  "rel1", "rel2", "k" (wave 3: corrections run against the real W 2 and K 2
 *  the SQL registers, never a stand-in), "v" (wave 4's V: the SQL's V 1),
 *  "j" (wave 4's J: the SQL's J 1), "m" (wave 4's M: the SQL's M 1) and "w4"
 *  (all of wave 4), every section for the sets that turn on what is not
 *  built yet. */
const SQL_SETS = ["off", "rel1", "rel2", "k", "v", "j", "m", "w4", "a5", "u", "t", "w5", "h5", "g", "e5", "w5x", "guide", "guide1", "prod"];
const schemaFor = (set) => ({ ...(SQL_SETS.includes(set) ? SCHEMA_SQL : SCHEMA_ALL) });
/** The flag set a build was made with, as the e2e scripts name it: "off", "rel1"
 *  (release 1: VITE_STUDY_QUESTIONS, VITE_STUDY_PRACTICE and VITE_STUDY_CARDS;
 *  docs/study/RELEASE-1.md), "rel2" (release 2: release 1's three and
 *  VITE_STUDY_QUIZ; docs/study/quiz.md), "all" (every VITE_STUDY_* flag,
 *  Today's tabs included) or "notoday" (every flag but VITE_STUDY_TODAY: the
 *  spec's four tabs), or "k" (package K: release 2's four flags with
 *  VITE_STUDY_CORRECTIONS and VITE_STUDY_ASK, against this branch's SQL,
 *  which has W2's hardening and K's end), or "v" (package V: "k" with
 *  VITE_STUDY_VAR, against this branch's SQL, which has section V), or "j"
 *  (package J: "k" with VITE_STUDY_WALL, against this branch's SQL, which has
 *  section J), or "m" (package M: wave 3's set, "k" with VITE_STUDY_ANCHOR,
 *  plus VITE_STUDY_MEETING and VITE_STUDY_GUESS, against this branch's SQL,
 *  which has section M), or "w4" (wave 4: wave 3's set, "k" with
 *  VITE_STUDY_ANCHOR, plus VITE_STUDY_VAR, VITE_STUDY_WALL,
 *  VITE_STUDY_MEETING and VITE_STUDY_GUESS, against this branch's SQL), or
 *  "a5" (wave 5's packages A2 and Q-2: wave 4's set with VITE_STUDY_PROGRESS,
 *  so "ההתקדמות שלי", "הטעויות שלי" and another wording, against this
 *  branch's SQL, which has section P at 2; decision 1: no account);
 *  "u" (package U, wave 5: "a5" with VITE_STUDY_PULSE, against this
 *  branch's SQL, which has sections P at 2 and U at 1);
 *  "t" (wave 5's T-1 and C's review: wave 4's set with VITE_STUDY_TODAY and
 *  VITE_STUDY_CARDS_REVIEW, against this branch's SQL, which has section T);
 *  "w5" (wave 5, release 8 on top of wave 4: "w4" with VITE_STUDY_PROGRESS,
 *  VITE_STUDY_CARDS_REVIEW, VITE_STUDY_TODAY and VITE_STUDY_PULSE, so every
 *  package of "a5", "u" and "t" together, against this branch's SQL);
 *  "h5" (wave 5's U-3 and H-1, phase 3 usable early by decision 3: "w5" with
 *  VITE_STUDY_MUSEUM and VITE_STUDY_BOSS, against this branch's SQL, which
 *  has section U at 2 and H at 1);
 *  "g" (wave 5's package G and T-2, decision 3: "w5" with
 *  VITE_STUDY_MARATHONS, VITE_STUDY_GROUP_PLAN, VITE_STUDY_NEEDS_ME and
 *  VITE_STUDY_EVE, against this branch's SQL, which has section G at 1 and T
 *  at 2);
 *  "e5" (wave 5's package E, phase 3 usable early by decision 3: "w5" with
 *  VITE_STUDY_TRAPS and VITE_STUDY_BLANK_TABLE, against this branch's SQL,
 *  which has section E at 1);
 *  "w5x" (wave 5 with every phase-3 extra, decision 3: "w5" with the flags of
 *  "h5", "g" and "e5" and VITE_STUDY_QUIZ_ROUNDS, against this branch's SQL);
 *  "guide" ("w5x" with VITE_STUDY_GUIDE: the guide, docs/study/guide.md; "g"
 *  was taken by package G) and "guide1" (production's three with
 *  VITE_STUDY_GUIDE, so guide.cjs sees that nothing shows for a flag that is
 *  off), against this branch's SQL (the guide needs no section); "prod"
 *  (production's set: every VITE_STUDY_* flag but ACCOUNT, QUIZ_ROUNDS,
 *  EXAMS, PDF, RECORDINGS and FAKE_ASR, i.e. "guide" without QUIZ_ROUNDS,
 *  which no script tells apart), against this branch's SQL;
 *  E2E_ANCHOR=1 says a release's build has
 *  VITE_STUDY_ANCHOR too (package N: a paragraph's comments show in its chip
 *  row, not the dot). `any`: a package's flag is on, so the "תרגול" tab shows
 *  (questions or cards); the others name the features the scripts look for. */
function flagSetOf(name) {
  const set = name || process.env.E2E_FLAGS || "off";
  if (!["off", "rel1", "rel2", "all", "notoday", "k", "v", "j", "m", "w4", "a5", "u", "t", "w5", "h5", "g", "e5", "w5x", "guide", "guide1", "prod"].includes(set))
    throw new Error(`unknown flag set ${set}: off, rel1, rel2, all, notoday, k, v, j, m, w4, a5, u, t, w5, h5, g, e5, w5x, guide, guide1 or prod`);
  if (set === "guide1") return { ...flagSetOf("rel1"), set, guide: true };
  const every = set === "all" || set === "notoday";
  const w5x = set === "w5x" || set === "guide" || set === "prod";
  const h5 = set === "h5" || w5x;
  const g = set === "g" || w5x;
  const e5 = set === "e5" || w5x;
  const w5 = set === "w5" || h5 || g || e5;
  const u = set === "u" || w5;
  const a5 = set === "a5" || u;
  const t = set === "t" || w5;
  const w4 = set === "w4" || a5 || t;
  const m = set === "m" || w4;
  const k = every || set === "k" || set === "v" || set === "j" || m;
  // anchor: package N's flag (every flag on, M's and wave 4's sets, or E2E_ANCHOR=1 on a release's set built with VITE_STUDY_ANCHOR too).
  const anchor = every || m || (set !== "off" && process.env.E2E_ANCHOR === "1");
  return { set, any: set !== "off", today: set === "all" || t, cardsReview: every || t, questions: set !== "off", cards: set !== "off", ask: k, corrections: k, var: every || set === "v" || w4, wall: every || set === "j" || w4, meeting: every || m, guess: every || m, account: every, quiz: every || set === "rel2" || k, anchor, progress: every || a5, mistakes: every || a5, pulse: every || u, museum: every || h5, boss: every || h5, marathons: every || g, groupPlan: every || g, needsMe: set === "all" || g, eve: every || g, traps: every || e5, blankTable: every || e5, guide: set === "guide" || set === "prod" };
}

/** The fixture lecture: slides, outline and its eight parts (synthetic, spec review FE-10). */
function fixtureLecture() {
  const slides = JSON.parse(fs.readFileSync(path.join(FIXTURES, "slides.json"), "utf8"));
  const outline = JSON.parse(fs.readFileSync(path.join(FIXTURES, "outline.json"), "utf8"));
  const parts = fs
    .readdirSync(path.join(FIXTURES, "parts"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => fs.readFileSync(path.join(FIXTURES, "parts", f), "utf8").trim());
  return { slides, outline, parts };
}

function makeUser(id, name) {
  return { id, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: { app: "study", full_name: name }, created_at: now() };
}

/* ── PostgREST, small: select lists with embeds, filters, order, range ── */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(sel) {
  const cols = [];
  const embeds = [];
  for (const item of splitTop(sel || "*")) {
    const m = /^([a-z_]+)(!inner)?\s*\(\s*([\s\S]*)\)$/.exec(item);
    if (m) embeds.push({ table: m[1], inner: Boolean(m[2]), ...parseSelect(m[3]) });
    else cols.push(item.replace(/\s+/g, ""));
  }
  return { cols, embeds };
}
function test(row, op, raw) {
  const v = row;
  if (op.startsWith("not.")) return !test(row, op.slice(4), raw);
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
    case "gt":
      return s(v) !== null && s(v) > arg;
    case "lte":
      return s(v) !== null && s(v) <= arg;
    case "lt":
      return s(v) !== null && s(v) < arg;
    default:
      throw new Error(`filter ${raw} not mocked`);
  }
}

/** Every package's plugin in e2e/study/mocks/: a build with a package's flags
 *  on calls its tables and RPCs from F's screens too (a library chip, a card
 *  on "יחד"), so every script, F's included, mocks every package there is. */
function packagePlugins() {
  const dir = path.join(__dirname, "mocks");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".cjs"))
    .sort()
    .map((f) => require(path.join(dir, f)));
}

async function createMock(o) {
  const dist = path.resolve(o.dist);
  const plugins = [...new Set([...packagePlugins(), ...(o.plugins || [])])];
  const dumpPath = path.join(__dirname, "schema-dump.json");
  if (!fs.existsSync(dumpPath)) throw new Error("e2e/study/schema-dump.json is missing: run `npm run test:contract` first");
  const schema = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
  const fx = fixtureLecture();

  const problems = [];
  const calls = [];
  const users = new Map(); // token -> user
  const db = {
    group: { ...GROUP, created_by: null },
    members: [],
    lectures: [],
    sections: [],
    comments: [],
    reads: [],
    files: new Map(),
    spent: 12.4,
    mySpent: 1.2,
    // The SQL's registry for builds with every flag off and release 1's (o.flags "off" or
    // "rel1"); otherwise a database with every section loaded (the SQL always runs before
    // a release's flags).
    // E2E_SCHEMA=all: every section loaded whatever the set. Since wave 3 the SQL itself
    // has what K's, C's and N's flags need (W 2, K 2, C 2, N 1), so no script needs it.
    // E2E_SCHEMA=u (package U's builder used it while sections A and P stood in for A2's):
    // since wave 5's integration the SQL has P 2 and U 1, so it is this branch's SQL.
    schema: process.env.E2E_SCHEMA === "all" ? { ...SCHEMA_ALL } : process.env.E2E_SCHEMA === "u" ? { ...SCHEMA_SQL } : o.flags ? schemaFor(o.flags) : { ...SCHEMA_ALL },
    budgetUsd: 33,
    calls,
    fixture: fx,
  };
  const people = {};
  const member = (name, n, joined = true) => {
    const user = makeUser(uuid(n), name);
    const token = `tok-${n}`;
    users.set(token, user);
    people[name] = { token, user, name };
    if (joined) db.members.push({ group_id: GROUP.id, user_id: user.id, name });
    return people[name];
  };
  // שוהם (the group's creator) and נועה, unless a flow starts with nobody (the invite flow).
  const names = o.members ?? ["שוהם", "נועה"];
  const made = names.map((n, i) => member(n, i + 2));
  const A = made[0] ?? { user: { id: uuid(1) } };
  db.group.created_by = made[0] ? A.user.id : null;
  let userSeq = 10;
  for (const p of plugins) p.seed?.(db);

  /** The fixture lecture, written: eight ready parts (together, shell). */
  const seedLecture = (extra = {}) => {
    const t = now();
    db.lectures.push({
      id: LECTURE_ID, group_id: GROUP.id, course: fx.outline.course, title: fx.outline.title, lecturer: fx.outline.lecturer,
      lecture_date: "2026-11-14", source_name: "deck.pptx", source_kind: "pptx", status: "ready", error: null,
      created_by: A.user.id, created_at: t, updated_at: t, queued_at: null, deleted_at: null, deleted_by: null,
      slides: fx.slides.map((s) => ({ n: s.n, title: s.title, lines: s.lines, tables: s.tables, notes: s.notes, figures: [] })),
      ...extra,
    });
    fx.outline.parts.forEach((p, idx) =>
      db.sections.push({ lecture_id: LECTURE_ID, idx, title: p.heading, slide_from: p.from, slide_to: p.to, markdown: fx.parts[idx], status: "ready", error: null, updated_at: t, lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 }),
    );
  };

  /* ── strictness against the real schema ── */
  const columnsOf = (table) => schema.tables[table];
  const checkCols = (table, cols, where) => {
    const known = columnsOf(table);
    if (!known) return problems.push(`unknown table ${table} (${where})`);
    for (const c of cols) if (c !== "*" && !known.includes(c)) problems.push(`unknown column ${table}.${c} (${where})`);
  };
  const checkSelect = (table, sel, where) => {
    checkCols(table, sel.cols, where);
    for (const e of sel.embeds) checkSelect(e.table, e, where);
  };
  /** A member's write to a study table, against the grants of the role
   *  authenticated (schema-dump.json's "member"): the columns it may insert
   *  and update, and whether it may delete. Returns what is not granted. */
  const deniedWrite = (table, m, rows, headers) => {
    const g = schema.member?.[table];
    if (!g) return null;
    if (m === "DELETE") return g.delete ? null : "delete";
    const upsert = m === "POST" && /resolution=merge-duplicates/.test(headers["prefer"] || "");
    const needs = m === "PATCH" ? ["update"] : upsert ? ["insert", "update"] : ["insert"];
    for (const r of rows) for (const c of Object.keys(r)) for (const n of needs) if (!g[n].includes(c)) return `${n} ${c}`;
    return null;
  };
  const checkRpc = (fn, body, where) => {
    const sigs = schema.functions[fn];
    if (!sigs) return problems.push(`unknown function ${fn} (${where})`);
    const keys = Object.keys(body || {});
    const ok = sigs.some((s) => keys.every((k) => s.args.includes(k)) && s.args.slice(0, s.required).every((a) => keys.includes(a)));
    if (!ok) problems.push(`bad arguments to ${fn}: ${keys.join(", ")} (${where})`);
  };

  /* ── Realtime: Phoenix 2.0.0 frames [join_ref, ref, topic, event, payload] ── */
  const sockets = new Set();
  const privateJoins = [];
  const presence = new Map(); // topic -> Map(key -> meta)
  let phxRef = 0;
  const sendTo = (sock, msg) => {
    try {
      sock.ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  };
  const presenceState = (topic) => {
    const state = {};
    for (const [key, entry] of presence.get(topic) ?? []) state[key] = { metas: [entry.meta] };
    return state;
  };
  const presenceDiff = (topic, joins, leaves) => {
    for (const s of sockets) {
      const t = s.topics.get(topic);
      if (t) sendTo(s, [t.join_ref, null, topic, "presence_diff", { joins, leaves }]);
    }
  };
  /** A row changed: every subscriber whose binding matches gets the full row (a filter never matches a DELETE).
   *  o.bare: the binding still matches on the row, but the event carries no columns (record {}), as a
   *  payload the client must not trust (package Z's re-read path, design-quiz §6.5 step 15). */
  const notify = (table, type, record = {}, old = {}, o = {}) => {
    for (const s of sockets) {
      for (const [topic, t] of s.topics) {
        const ids = t.bindings
          .filter((b) => b.table === table && (b.event === "*" || b.event === type))
          .filter((b) => {
            if (!b.filter) return true;
            if (type === "DELETE") return false;
            const m = /^(id|lecture_id|group_id)=eq\.(.+)$/.exec(b.filter);
            return m ? String(record[m[1]]) === m[2] : false;
          })
          .map((b) => b.id);
        if (ids.length) sendTo(s, [t.join_ref, null, topic, "postgres_changes", { ids, data: { type, schema: "public", table, commit_timestamp: now(), record: type === "DELETE" || o.bare ? {} : record, old_record: type === "DELETE" ? { id: old.id ?? "x" } : {}, columns: [], errors: null } }]);
      }
    }
  };
  const realtime = (name) => (ws) => {
    const sock = { ws, name, topics: new Map(), presenceAt: [] };
    sockets.add(sock);
    const leave = (topic) => {
      const t = sock.topics.get(topic);
      if (!t) return;
      sock.topics.delete(topic);
      const old = presence.get(topic)?.get(t.key);
      if (old && old.socket === sock) {
        presence.get(topic).delete(t.key);
        presenceDiff(topic, {}, { [t.key]: { metas: [old.meta] } });
      }
    };
    ws.onMessage((raw) => {
      const [join_ref, ref, topic, event, payload] = JSON.parse(String(raw));
      const reply = (response = {}, status = "ok") => sendTo(sock, [join_ref, ref, topic, "phx_reply", { status, response }]);
      if (event === "heartbeat") return reply();
      if (event === "access_token") return reply();
      if (event === "phx_join") {
        if (/^realtime:study-(read|group)-/.test(topic)) privateJoins.push(`${name} ${topic.replace(/-[0-9a-f-]{36}$/, "")}: private=${payload.config?.private === true}`);
        const bindings = (payload.config?.postgres_changes ?? []).map((f, i) => ({ id: 1000 + i, ...f }));
        sock.topics.set(topic, { join_ref, key: payload.config?.presence?.key || name, bindings, private: payload.config?.private === true });
        reply({ postgres_changes: bindings });
        if (payload.config?.presence?.enabled) sendTo(sock, [join_ref, null, topic, "presence_state", presenceState(topic)]);
        return;
      }
      if (event === "presence") {
        // Supabase: "Presence calls per client, per 30 seconds: 5".
        const t0 = Date.now();
        sock.presenceAt = sock.presenceAt.filter((x) => x > t0 - 30_000);
        if (sock.presenceAt.length >= 5) {
          problems.push(`presence refused: ${name}'s 6th presence call in 30 s on ${topic}`);
          return reply({ reason: "rate limited" }, "error");
        }
        sock.presenceAt.push(t0);
        reply();
        const t = sock.topics.get(topic);
        if (!t) return;
        const room = presence.get(topic) ?? new Map();
        presence.set(topic, room);
        const old = room.get(t.key);
        if (payload.event === "track") {
          const meta = { ...payload.payload, phx_ref: String(++phxRef) };
          room.set(t.key, { meta, socket: sock });
          presenceDiff(topic, { [t.key]: { metas: [meta] } }, old ? { [t.key]: { metas: [old.meta] } } : {});
        } else if (payload.event === "untrack" && old) {
          room.delete(t.key);
          presenceDiff(topic, {}, { [t.key]: { metas: [old.meta] } });
        }
        return;
      }
      if (event === "phx_leave") {
        reply();
        return leave(topic);
      }
      reply();
    });
    ws.onClose(() => {
      for (const topic of [...sock.topics.keys()]) leave(topic);
      sockets.delete(sock);
    });
  };
  const dropSocket = async (name) => {
    for (const s of [...sockets]) if (s.name === name) await s.ws.close();
  };

  /* ── REST ── */
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const refuse = (route, message, status = 400) => json(route, { code: "P0001", details: null, hint: null, message }, status);
  const tables = {
    study_members: () => db.members,
    study_lectures: () => db.lectures,
    study_sections: () => db.sections,
    study_comments: () => db.comments,
    study_reads: () => db.reads,
    study_groups: () => [db.group],
    // Section W: no recording unless a plugin adds one.
    study_recordings: () => db.recordings ?? [],
    study_recording_notes: () => db.recordingNotes ?? [],
    // Section M: the group's meetings (package M's plugin keeps them; members read them).
    study_meetings: () => db.meetingMock?.meetings ?? [],
  };
  const lectureOf = (row) => db.lectures.find((l) => l.id === row.lecture_id);
  const embedRow = (table, row, e) => {
    if (e.table === "study_groups") return db.group;
    if (e.table === "study_lectures") return lectureOf(row) ?? null;
    return null;
  };
  const project = (row, sel, table) => {
    const out = {};
    for (const c of sel.cols) if (c === "*") Object.assign(out, row);
    else out[c] = row[c] === undefined ? null : row[c];
    for (const e of sel.embeds) {
      const er = embedRow(table, row, e);
      out[e.table] = er ? project(er, e, e.table) : null;
    }
    return out;
  };
  const readRows = (table, url, where) => {
    const q = url.searchParams;
    const sel = parseSelect(q.get("select") || "*");
    checkSelect(table, sel, where);
    let rows = [...tables[table]()];
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      const dot = k.indexOf(".");
      if (dot > 0) {
        const [et, col] = [k.slice(0, dot), k.slice(dot + 1)];
        checkCols(et, [col], where);
        rows = rows.filter((r) => {
          const er = et === "study_lectures" ? lectureOf(r) : null;
          return er ? test(er[col], v, `${k}=${v}`) : false;
        });
      } else {
        checkCols(table, [k], where);
        rows = rows.filter((r) => test(r[k], v, `${k}=${v}`));
      }
    }
    for (const e of sel.embeds) if (e.inner) rows = rows.filter((r) => embedRow(table, r, e));
    const order = q.get("order");
    if (order) {
      const keys = order.split(",").map((x) => {
        const [col, dir] = x.split(".");
        checkCols(table, [col], where);
        return [col, dir === "desc" ? -1 : 1];
      });
      rows.sort((a, b) => {
        for (const [c, d] of keys) {
          if (a[c] === b[c]) continue;
          return (a[c] > b[c] ? 1 : -1) * d;
        }
        return 0;
      });
    }
    const offset = Number(q.get("offset") || 0);
    const limit = q.get("limit") ? Number(q.get("limit")) : rows.length;
    return { rows: rows.slice(offset, offset + limit), sel };
  };

  const rest = (who) => async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    const token = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
    const me = users.get(token) ?? null;
    const label = me ? me.user_metadata.full_name : who || "anon";
    const where = `${m} ${p}`;
    calls.push(`${label} ${m} ${p}${url.search}`);
    let body = null;
    try {
      body = req.postData() ? req.postDataJSON() : null;
    } catch {
      body = null;
    }
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const answerRows = (rows) => (single ? (rows.length === 1 ? json(route, rows[0]) : json(route, { message: "JSON object requested, multiple (or no) rows returned" }, 406)) : json(route, rows));

    // The grants come first: a write no member may make never reaches a table.
    const written = /^\/rest\/v1\/(study_[a-z_]+)$/.exec(p)?.[1];
    if (me && written && (m === "POST" || m === "PATCH" || m === "DELETE")) {
      const denied = deniedWrite(written, m, Array.isArray(body) ? body : body ? [body] : [], req.headers());
      if (denied) {
        problems.push(`a member's write the grants refuse: ${denied} on ${written} (${where})`);
        db.refusedWrites = [...(db.refusedWrites ?? []), { table: written, method: m, denied }];
        return json(route, { code: "42501", details: null, hint: null, message: `permission denied for table ${written}` }, 403);
      }
    }

    // A guard (the guide's plugin) sees every request before any plugin answers it.
    for (const plugin of plugins) {
      const r = await plugin.guard?.({ method: m, path: p, who: me, db, refuse: (msg, s) => refuse(route, msg, s) });
      if (r !== undefined) return r;
    }
    for (const plugin of plugins) {
      const r = await plugin.rest?.({ method: m, path: p, query: url.searchParams, body, who: me, db, notify, single, json: (b, s) => json(route, b, s), refuse: (msg, s) => refuse(route, msg, s), check: { rpc: checkRpc, cols: checkCols } });
      if (r !== undefined) return r;
    }

    // Auth
    if (p === "/auth/v1/signup" && m === "POST") {
      const n = ++userSeq;
      const user = makeUser(uuid(n), body?.data?.full_name ?? "");
      user.user_metadata = { ...(body?.data ?? {}) };
      const t = `tok-${n}`;
      users.set(t, user);
      db.lastSignup = body;
      return json(route, { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${t}`, user });
    }
    if (p === "/auth/v1/user") return me ? json(route, me) : json(route, { message: "invalid token" }, 401);
    if (p === "/auth/v1/logout") return route.fulfill({ status: 204 });
    if (p === "/auth/v1/token") {
      const t = (body?.refresh_token || "").replace(/^r-/, "");
      const u = users.get(t);
      return u ? json(route, { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${t}`, user: u }) : json(route, { message: "bad refresh" }, 400);
    }

    // RPC
    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice("/rest/v1/rpc/".length);
      checkRpc(fn, body, where);
      const isMember = me && db.members.some((x) => x.user_id === me.id);
      switch (fn) {
        case "study_join": {
          if (body.p_code !== db.group.join_code) return refuse(route, "wrong code");
          const name = String(body.p_member_name).trim();
          if (db.members.some((x) => x.user_id !== me.id && x.name.trim().toLowerCase() === name.toLowerCase())) return refuse(route, "name taken");
          if (!db.members.some((x) => x.user_id === me.id)) db.members.push({ group_id: GROUP.id, user_id: me.id, name });
          return json(route, [{ id: GROUP.id, name: GROUP.name, join_code: db.group.join_code }]);
        }
        case "study_create_group":
          return refuse(route, "groups closed");
        case "study_group_code":
          return json(route, db.group.join_code);
        case "study_schema":
          return json(route, db.schema);
        case "study_features":
          return json(route, {});
        case "study_spent":
          return json(route, db.spent);
        case "study_my_spent":
          return json(route, db.mySpent);
        case "study_my_uses_today":
          return json(route, 2);
        // The library's cards chip (package C's useCardsChip) with the cards flag on;
        // C's plugin (mocks/cards.cjs) answers it with real counts.
        case "study_my_card_counts":
          return json(route, []);
        case "study_member_saved":
          return json(route, db.members.map((x) => ({ user_id: x.user_id, saved: false })));
        case "study_rotate_code":
          if (db.group.created_by !== me?.id) return refuse(route, "not the creator");
          db.group.join_code = "XYZ789";
          return json(route, db.group.join_code);
        case "study_remove_member": {
          if (db.group.created_by !== me?.id) return refuse(route, "not the creator");
          if (body.p_user === me.id) return refuse(route, "not yourself");
          const before = db.members.length;
          db.members = db.members.filter((x) => x.user_id !== body.p_user);
          return before === db.members.length ? refuse(route, "member not found") : route.fulfill({ status: 204 });
        }
        case "study_delete_lecture": {
          const l = db.lectures.find((x) => x.id === body.p_lecture);
          if (!l || !isMember) return refuse(route, "lecture not found");
          if (body.p_delete === false) {
            Object.assign(l, { deleted_at: null, deleted_by: null });
            notify("study_lectures", "UPDATE", l);
            return json(route, null);
          }
          if (!l.deleted_at) Object.assign(l, { deleted_at: now(), deleted_by: me.id });
          notify("study_lectures", "UPDATE", l);
          return json(route, l.deleted_at);
        }
        case "study_purge_lecture":
          return json(route, false);
        case "study_queue":
          // Section W's queue with server writing off (no pg_net): the phone
          // writes, as today. W's plugin plays the server writer.
          return json(route, false);
        default:
          problems.push(`unmocked rpc ${fn}`);
          return json(route, { message: "unmocked" }, 404);
      }
    }

    // Tables
    const table = p.replace(/^\/rest\/v1\//, "");
    if (tables[table]) {
      if (m === "GET" || m === "HEAD") {
        const { rows, sel } = readRows(table, url, where);
        return answerRows(rows.map((r) => project(r, sel, table)));
      }
      const rows = Array.isArray(body) ? body : body ? [body] : [];
      if (m === "POST" || m === "PATCH") for (const r of rows) checkCols(table, Object.keys(r), where);
      if (table === "study_lectures" && m === "POST") {
        for (const r of rows) {
          const l = { ...r, status: "new", error: null, created_by: me.id, created_at: now(), updated_at: now(), course: r.course || "", lecturer: r.lecturer || "", queued_at: null, deleted_at: null, deleted_by: null };
          db.lectures.push(l);
          notify("study_lectures", "INSERT", l);
        }
        return route.fulfill({ status: 201, body: "" });
      }
      if (table === "study_reads") {
        if (m === "POST") {
          for (const r of rows) {
            if (db.reads.some((x) => x.lecture_id === r.lecture_id && x.user_id === me.id)) continue;
            const row = { id: `r${db.reads.length + 1}`, lecture_id: r.lecture_id, user_id: me.id, read_at: now() };
            db.reads.push(row);
            notify("study_reads", "INSERT", row);
          }
          return route.fulfill({ status: 201, body: "" });
        }
        if (m === "DELETE") {
          const lid = (url.searchParams.get("lecture_id") || "").replace(/^eq\./, "");
          const gone = db.reads.filter((r) => r.lecture_id === lid && r.user_id === me.id);
          db.reads = db.reads.filter((r) => !gone.includes(r));
          for (const g of gone) notify("study_reads", "DELETE", {}, g);
          return route.fulfill({ status: 204 });
        }
      }
      if (table === "study_comments") {
        if (m === "POST") {
          const r = rows[0];
          const row = { id: uuid(9000 + db.comments.length + 1), resolved: false, author_id: me.id, created_at: now(), parent_id: null, kind: "comment", quote: "", ...r };
          db.comments.push(row);
          notify("study_comments", "INSERT", row);
          const sel = parseSelect(url.searchParams.get("select") || "*");
          checkSelect(table, sel, where);
          return single ? json(route, project(row, sel, table), 201) : json(route, [project(row, sel, table)], 201);
        }
        const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
        if (m === "PATCH") {
          const c = db.comments.find((x) => x.id === id);
          if (c) Object.assign(c, body);
          if (c) notify("study_comments", "UPDATE", c);
          return route.fulfill({ status: 204 });
        }
        if (m === "DELETE") {
          const c = db.comments.find((x) => x.id === id);
          if (c && c.author_id === me.id) {
            const gone = db.comments.filter((x) => x.id === id || x.parent_id === id);
            db.comments = db.comments.filter((x) => !gone.includes(x));
            for (const g of gone) notify("study_comments", "DELETE", {}, g);
          }
          return route.fulfill({ status: 204 });
        }
      }
    }

    // Storage
    if (p.startsWith("/storage/v1/object/sign/study") && m === "POST") {
      return json(route, (body.paths || []).map((x) => ({ path: x, signedURL: `/object/sign/study/${x}?token=t`, error: null })));
    }
    if (p.startsWith("/storage/v1/object/sign/study/") && m === "GET") {
      const key = decodeURIComponent(p.replace("/storage/v1/object/sign/study/", ""));
      const buf = db.files.get(key);
      return buf ? route.fulfill({ status: 200, contentType: "image/jpeg", body: buf }) : route.fulfill({ status: 404 });
    }
    if (p.startsWith("/storage/v1/object/list/study")) return json(route, []);
    if (p.startsWith("/storage/v1/object/study/") && (m === "POST" || m === "PUT")) {
      const key = decodeURIComponent(p.replace("/storage/v1/object/study/", ""));
      // supabase-js sends a Blob as multipart form data; keep only the JPEG inside.
      let buf = req.postDataBuffer();
      const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (soi >= 0 && eoi > soi) buf = buf.subarray(soi, eoi + 2);
      db.files.set(key, buf);
      return json(route, { Key: `study/${key}`, Id: key });
    }
    if (p.startsWith("/storage/v1/object/study") && m === "DELETE") return json(route, []);

    problems.push(`unmocked ${m} ${p}`);
    return json(route, { message: "unmocked" }, 404);
  };

  /* ── the static site and /api/study/* (streamed for real) ── */
  const TIMEOUT_PART = process.env.E2E_TIMEOUT_PART ? Number(process.env.E2E_TIMEOUT_PART) : null;
  let timedOutOnce = false;
  const readBody = (req) => new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        ok(null);
      }
    });
  });
  const sendJson = (res, body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const api = async (req, res, p) => {
    calls.push(`api ${req.method} ${p}`);
    // The body is read once, here, and handed to every plugin: a request's stream ends
    // once, so a plugin that read it itself would leave the next one waiting for good.
    const b = req.method === "POST" ? await readBody(req) : null;
    for (const plugin of plugins) if ((await plugin.apiGuard?.(req, res, db, b)) !== undefined) return;
    for (const plugin of plugins) if ((await plugin.api?.(req, res, db, b)) !== undefined) return;
    if (p === "/api/study/health") return sendJson(res, { ok: true, anthropicKey: true, supabase: true, worker: false, workerOk: false, budgetUsd: db.budgetUsd, schema: db.schema, schemaOk: true, features: {} });
    const me = users.get((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!me) return sendJson(res, { error: "not signed in" }, 401);
    // A deleted lecture is not found, as loadLecture answers (section F).
    const lecture = db.lectures.find((l) => l.id === b?.lectureId && !l.deleted_at);
    if (!lecture) return sendJson(res, { error: "lecture not found" }, 404);
    if (p === "/api/study/outline") {
      const n = lecture.slides.length;
      const parts = [];
      for (let i = 1; i <= n; i += 8) parts.push({ heading: `חלק ${parts.length + 1}: שקפים ${i}-${Math.min(n, i + 7)}`, from: i, to: Math.min(n, i + 7) });
      db.sections = db.sections.filter((s) => s.lecture_id !== lecture.id);
      parts.forEach((pt, idx) => db.sections.push({ lecture_id: lecture.id, idx, title: pt.heading, slide_from: pt.from, slide_to: pt.to, markdown: "", status: "pending", error: null, updated_at: now(), lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 }));
      lecture.status = "writing";
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end("​" + JSON.stringify({ parts }));
    }
    if (p === "/api/study/section") {
      const sec = db.sections.find((s) => s.lecture_id === lecture.id && s.idx === b.idx);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      if (TIMEOUT_PART === b.idx && !timedOutOnce) {
        // The server's 270 s guard: partial text saved as failed, then an in-stream error.
        timedOutOnce = true;
        Object.assign(sec, { markdown: `## ${sec.title}\n\nחלקי`, status: "failed", error: "timeout", updated_at: now() });
        return res.end("​" + sec.markdown + "\n\u0000ERROR timeout");
      }
      const md = fx.parts[sec.idx] ?? `## ${sec.title}\n\nפסקה. [ש' ${sec.slide_from}]`;
      res.write("​");
      // Streamed in three pieces, so the page shows "נכתב עכשיו…" with text.
      const cut = [0, Math.floor(md.length / 3), Math.floor((2 * md.length) / 3), md.length];
      for (let i = 0; i < 3; i++) {
        res.write(md.slice(cut[i], cut[i + 1]));
        await pause(100);
      }
      Object.assign(sec, { markdown: md, status: "ready", updated_at: now() });
      if (db.sections.filter((s) => s.lecture_id === lecture.id).every((s) => s.status === "ready")) lecture.status = "ready";
      return res.end();
    }
    return sendJson(res, { error: "unknown" }, 404);
  };
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/study/")) return api(req, res, p);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(dist, p);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}`;

  /** A member's (or a visitor's, for null) browser context on a path. */
  const open = async (browser, who, opt = {}) => {
    const m = who ? people[who] : null;
    const ctx = await browser.newContext({ viewport: opt.viewport ?? { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: opt.colorScheme ?? "light" });
    const storage = { ...(opt.storage ?? {}) };
    if (m) {
      storage["study-auth"] = JSON.stringify({ access_token: m.token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${m.token}`, user: m.user });
      storage["study-group"] = GROUP.id;
    }
    await ctx.addInitScript((s) => {
      if (sessionStorage.getItem("e2e-seeded")) return; // once per tab: a reload keeps what the page changed
      sessionStorage.setItem("e2e-seeded", "1");
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, storage);
    const name = who ?? `guest-${++userSeq}`;
    await ctx.route(`${SB}/**`, rest(name));
    await ctx.routeWebSocket(/realtime\/v1\/websocket/, realtime(name));
    // Nothing else leaves the page: any other host is a failure (fonts included).
    await ctx.route(/^https?:\/\/(?!localhost|mock\.supabase\.test)/, (route) => {
      const u = route.request().url();
      if (!/fonts\.(googleapis|gstatic)\.com/.test(u)) problems.push(`request to a real host: ${u}`);
      return route.fulfill({ status: 204, body: "" });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !/Failed to load resource|WebSocket/.test(msg.text())) problems.push(`${name} console: ${msg.text()}`);
    });
    if (opt.path) await page.goto(base + opt.path);
    return { page, ctx, name };
  };

  return {
    base,
    db,
    people,
    problems,
    calls,
    privateJoins,
    open,
    notify,
    dropSocket,
    seedLecture,
    member: (name) => member(name, ++userSeq),
    /** Adds a package's plugin (its tables, RPCs and API handlers) after creation. */
    load: (plugin) => {
      if (plugins.includes(plugin)) return; // loaded already (every plugin in mocks/ is)
      plugins.push(plugin);
      plugin.seed?.(db);
    },
    GROUP,
    LECTURE_ID,
    fixture: fx,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

module.exports = { createMock, flagSetOf, GROUP, LECTURE_ID, SB, SCHEMA_ALL, SCHEMA_SQL };

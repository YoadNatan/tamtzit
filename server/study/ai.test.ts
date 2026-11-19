import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import ai from "../../api/study/ai.js";
import { healthSchema, OP_SCHEMA, REQUIRED_SCHEMA, schemaFor } from "./study.js";

/* F-7 (spec §7.F; §12.2.7): the /api/study/ai router in Node, against a local
 * mock of PostgREST and a local Anthropic that must never be called. Unknown
 * op → 400; a database older than an op needs → 503 "schema", with the
 * per-op needs of §12.2.2; each op its package has not built → 501 "not
 * built" (the new ones of §12.2.4 but K's fix_check, built by K-2, and Q's
 * past exams, and J's mnemonic and wall_check); "mnemonic" reaches
 * J's ops/wall.ts, not K's memory aids. Every op needs section F and the
 * sections of the packages merged so far, W, Q, C and K (§2.11), and its own
 * (OP_SCHEMA). The schema check is cached per instance and op once it
 * passes, so the 503 cases come first. */

let schema: { status: number; body: unknown } = { status: 200, body: { F: 1 } };
const restCalls: string[] = [];
let anthropicCalls = 0;

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const rest = createServer((req: IncomingMessage, res: ServerResponse) => {
  restCalls.push(`${req.method} ${req.url}`);
  if (req.method === "POST" && req.url === "/rest/v1/rpc/study_schema") return send(res, schema.status, schema.body);
  send(res, 500, { message: `unmocked ${req.method} ${req.url}` });
});
const anthropic = createServer((_req, res) => {
  anthropicCalls += 1;
  send(res, 500, { type: "error", error: { type: "api_error", message: "no model call expected" } });
});
const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));

before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropic)]);
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
  Object.assign(process.env, {
    VITE_SUPABASE_URL: `http://127.0.0.1:${r}`,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${a}`,
    ANTHROPIC_API_KEY: "test-key",
    STUDY_WORKER_KEY: "k-0123456789abcdef0123456789abcdef",
  });
});
after(() => {
  rest.close();
  anthropic.close();
});

const post = (body: unknown) =>
  ai.fetch(
    new Request("http://localhost/api/study/ai", {
      method: "POST",
      headers: { authorization: "Bearer x.y.z", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });

/** The ops of §12.2.4 F seeds, and Q's past exams (Q-2): 501 until their
 *  package (K-2 built fix_check, V built var, J built mnemonic and
 *  wall_check, and E built trap_check: they are no seeds any more; E's
 *  "whoami" is design only). */
const SEEDED = ["plaque", "whoami", "exam_read", "exam_explain"];
/** Every section at the version any op needs. */
const EVERYTHING = { F: 1, A: 1, W: 2, Q: 2, Z: 2, C: 2, K: 2, P: 2, M: 2, N: 1, V: 1, U: 1, J: 1, H: 1, B: 1, G: 1, E: 1, T: 1 };

test("only POST, only JSON", async () => {
  assert.deepEqual(await answer(await ai.fetch(new Request("http://localhost/api/study/ai"))), { status: 405, body: { error: "POST only" } });
  assert.deepEqual(await answer(await post("{not json")), { status: 400, body: { error: "bad json" } });
});

test("an unknown op answers 400, before the database is asked anything", async () => {
  for (const body of [{ op: "summary" }, {}, { op: "toString" }, { op: "__proto__" }, { op: "bank" }, null, 7]) {
    assert.deepEqual(await answer(await post(body)), { status: 400, body: { error: "unknown op" } }, JSON.stringify(body));
  }
  assert.deepEqual(restCalls, []);
});

test("the code needs section F and the merged packages' sections, W (at 2: W2's hardening), Q, C and K (§2.11)", () => {
  assert.deepEqual(REQUIRED_SCHEMA, { F: 1, W: 2, Q: 1, C: 1, K: 1 });
});

test("health's schemaOk asks for the server's sections and what the app built with the deployment's flags needs", () => {
  const set = (names: string[]) => Object.fromEntries(names.map((n) => [`VITE_STUDY_${n}`, "1"]));
  // W 2 from the server's own needs (W2's hardening), whatever the app's W 1.
  assert.deepEqual(healthSchema({}), { F: 1, W: 2, Q: 1, C: 1, K: 1 }, "flags off: the server's own");
  assert.deepEqual(healthSchema(set(["QUESTIONS", "PRACTICE", "CARDS"])), { F: 1, W: 2, Q: 2, C: 2, K: 1 }, "release 1's flags with Q's and C's ends: Q 2, C 2");
  assert.deepEqual(healthSchema(set(["QUESTIONS", "PRACTICE", "CARDS", "QUIZ"])), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 1 }, "release 2's flags: Z 2 with the quiz, C 2 with C's end");
  assert.deepEqual(healthSchema(set(["QUESTIONS", "PRACTICE", "CARDS", "QUIZ", "CARDS_REVIEW"])), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 1 }, "the cards' review needs nothing more");
  assert.deepEqual(healthSchema({ VITE_STUDY_QUIZ: "1" }), { F: 1, W: 2, Q: 1, C: 1, K: 1 }, "the quiz without questions is off");
  assert.deepEqual(healthSchema({ VITE_STUDY_QUESTIONS: "0", VITE_STUDY_PRACTICE: "1" }), { F: 1, W: 2, Q: 1, C: 1, K: 1 }, "only \"1\" turns a flag on");
  assert.deepEqual(healthSchema(set(["CORRECTIONS"])), { F: 1, W: 2, Q: 1, C: 1, K: 2 }, "corrections: K's end and W2's hardening");
  assert.deepEqual(healthSchema(set(["ASK"])), { F: 1, W: 2, Q: 1, C: 1, K: 2 }, "לשאול: K's end (W 2 is the server's own)");
  assert.deepEqual(healthSchema(set(["COURSES"])), { F: 1, W: 2, Q: 1, C: 1, K: 1, S: 1 }, "courses: section S at 1");
});

test("the per-op needs are §12.2.2's (questions at Q 2, cards at C 2 and ask at K 2 with their ends)", () => {
  const md = readFileSync(join(process.cwd(), "docs", "study", "spec", "addendum", "addendum.md"), "utf8");
  const line = md.slice(md.indexOf("The server's per-op needs"), md.indexOf("#### 12.2.3"));
  // "`questions`, `exam_*` → Q 2; `cards` → C 2; …; `work.ts`'s `bank` branch → B 1."
  const said: Record<string, Record<string, number>> = {};
  for (const m of line.matchAll(/((?:`[a-z_*.]+`(?:'s)?(?:,\s*)?)+)[^→;]*→ ([A-Z]) (\d)/g)) {
    for (const op of [...m[1].matchAll(/`([a-z_*.]+)`/g)].map((x) => x[1])) {
      const name = op === "exam_*" ? ["exam_read", "exam_explain"] : op === "work.ts" ? ["bank"] : [op];
      for (const n of name) said[n] = { [m[2]]: Number(m[3]) };
    }
  }
  assert.ok(Object.keys(said).length >= 12, JSON.stringify(said));
  // Q's, C's and K's ends are merged: "questions" needs Q 2, "cards" C 2 and "ask" K 2, as §12.2.2 says.
  // U-3 (wave 5) put the plaque's hold and write (study_trap_plaque_begin, study_trap_plaque) in
  // section U at 2, the version U-3 registers; §12.2.2 wrote U 1 before U was split in milestones.
  const later: Record<string, Record<string, number>> = { plaque: { U: 2 } };
  assert.deepEqual(OP_SCHEMA.cards, { C: 2 });
  assert.deepEqual(OP_SCHEMA.ask, { K: 2 });
  for (const [op, need] of Object.entries(said)) assert.deepEqual(OP_SCHEMA[op], later[op] ?? need, op);
  assert.deepEqual(Object.keys(OP_SCHEMA).sort(), Object.keys(said).sort(), "every op of §12.2.2, and only those");
  assert.deepEqual(schemaFor("var"), { ...REQUIRED_SCHEMA, V: 1 });
  assert.deepEqual(schemaFor("fix_check"), { ...REQUIRED_SCHEMA, K: 2 }, "an op's own version wins over every call's");
  assert.deepEqual(schemaFor(), REQUIRED_SCHEMA);
  assert.deepEqual(schemaFor("toString"), REQUIRED_SCHEMA, "an inherited name is no op");
  // Courses (sources.md B8): an op's variant needs section S too; the variants are not ops.
  assert.deepEqual(schemaFor("ask_course"), { ...REQUIRED_SCHEMA, K: 2, S: 1 });
  assert.deepEqual(schemaFor("questions_plan"), { ...REQUIRED_SCHEMA, Q: 2, S: 1 });
  assert.ok(!Object.hasOwn(OP_SCHEMA, "ask_course") && !Object.hasOwn(OP_SCHEMA, "questions_plan"));
});

test("a database older than an op needs answers 503 schema, op by op (§12.2.2)", async () => {
  const older = [
    { F: 0 },
    {},
    null,
    { F: 1 }, // section F alone: a merge of Q, C and K that came before their SQL
    { F: 1, Q: 1, C: 1 }, // one merged section missing
    { F: 1, Q: 1, C: 1, K: 0 }, // one at an older version
    { F: 1, Q: 1, C: 1, K: 1 }, // release 1's registry: W's merge came before its SQL
  ];
  for (const body of older.map((b) => ({ status: 200, body: b }))) {
    schema = body;
    assert.deepEqual(await answer(await post({ op: "questions" })), { status: 503, body: { error: "schema" } }, JSON.stringify(body.body));
  }
  // Every section but the op's own: still 503, and no model, no op.
  for (const op of [...SEEDED, "questions", "cards", "ask", "fix_check", "var", "mnemonic", "wall_check", "trap_check"]) {
    const need = OP_SCHEMA[op];
    const without = Object.fromEntries(Object.entries(EVERYTHING).filter(([k]) => !(k in need)));
    schema = { status: 200, body: without };
    assert.deepEqual(await answer(await post({ op })), { status: 503, body: { error: "schema" } }, `${op} without ${Object.keys(need)}`);
    // Its section one version short.
    const [section, version] = Object.entries(need)[0];
    if (version > 1) {
      schema = { status: 200, body: { ...EVERYTHING, [section]: version - 1 } };
      assert.deepEqual(await answer(await post({ op })), { status: 503, body: { error: "schema" } }, `${op} with ${section} ${version - 1}`);
    }
  }
  // No study_schema() at all: the database predates section F.
  schema = { status: 404, body: { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.study_schema without parameters in the schema cache" } };
  assert.deepEqual(await answer(await post({ op: "cards" })), { status: 503, body: { error: "schema" } });
  // Any other failure is not a schema answer.
  schema = { status: 500, body: { code: "XX000", details: null, hint: null, message: "boom" } };
  assert.equal((await post({ op: "ask" })).status, 500);
  assert.equal(anthropicCalls, 0);
});

test("each op its package has not built answers 501 not built, and no model is called", async () => {
  for (const op of SEEDED) {
    // Exactly what the op needs, and nothing more.
    schema = { status: 200, body: schemaFor(op) };
    const before = restCalls.length;
    assert.deepEqual(await answer(await post({ op, lectureId: "11111111-0000-4000-8000-000000000001" })), { status: 501, body: { error: "not built" } }, op);
    // The schema once per set of needs (wall_check needs what mnemonic needs), and nothing else.
    assert.ok(restCalls.slice(before).every((c) => c === "POST /rest/v1/rpc/study_schema") && restCalls.length - before <= 1, `${op}: ${restCalls.slice(before)}`);
  }
  // work.ts's bank branch is built (package B as decision 2 of 17 Nov 2026 redefines it: the points read ahead): bank.test.ts.
  assert.equal(anthropicCalls, 0, "no Anthropic request");
});

test('"mnemonic" reaches J\'s ops/wall.ts, not K\'s memory aids (§12.1.4)', async () => {
  const router = readFileSync(join(process.cwd(), "api", "study", "ai.ts"), "utf8");
  assert.match(router, /import \{ mnemonicOp, wallCheckOp \} from "\.\.\/\.\.\/server\/study\/ops\/wall\.js"/);
  assert.doesNotMatch(router, /mnemonicOp[^\n]*ops\/collab/, "K's module no longer serves it");
  // K's op would check section K and ask Auth first; J's checks its request
  // before anything (here: no "gen"), and its own section J is the router's.
  schema = { status: 200, body: EVERYTHING };
  const before = restCalls.length;
  assert.deepEqual(await answer(await post({ op: "mnemonic", lectureId: "11111111-0000-4000-8000-000000000001", part: 0, anchor: 2 })), { status: 400, body: { error: "bad request" } });
  assert.deepEqual(await answer(await post({ op: "wall_check", aidId: "not-an-id" })), { status: 400, body: { error: "bad request" } });
  assert.deepEqual(restCalls.slice(before).filter((c) => !c.includes("study_schema")), []);
  assert.equal(anthropicCalls, 0);
});

test("the schema is checked once per instance and op, once it passes", async () => {
  const count = () => restCalls.filter((c) => c.includes("study_schema")).length;
  const first = count();
  schema = { status: 200, body: { F: 0 } }; // would fail, but the passing answers are remembered
  for (const op of SEEDED) assert.equal((await post({ op })).status, 501, op);
  assert.equal(count(), first, "no op that passed asks again");
});

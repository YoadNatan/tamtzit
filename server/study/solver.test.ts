import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { Spend } from "./claude.js";
import { SOLVER_SYSTEM, solverRequest } from "./prompts/solver.js";
import { SOLVER_SCHEMA, solveQuestions, solverCall, solverEstimate, solverMaxTokens, verdictsOf } from "./solver.js";
import { type Lecture, lectureBlock, MODEL } from "./study.js";

/* QS-3 (spec §12.3.Q, P7): the blind solver. Its request carries each
 * question's vignette, lead-in and options in the stored order, and nothing
 * of the key (no answer, explanation, "מתי כן" or takeaway: a byte scan);
 * max_tokens is 1,000 + 250 × N; a question is kept only when the solver
 * chose the key and called no other option defensible; a missing answer in
 * a finished reply is a disagreement, and one the reply never reached is not
 * judged. One call, through the ledger the caller gives (kind "solver"); the
 * op's reservation and settle with the server key are in questions.test.ts
 * (Q-6) and practice2.test.ts. Synthetic lecture, local mock, no network. */

const lecture: Pick<Lecture, "lecturer" | "slides"> = {
  lecturer: "ד״ר דוגמה",
  slides: Array.from({ length: 12 }, (_, i) => ({ n: i + 1, title: `נושא ${i + 1}`, lines: [`עובדה ${i + 1} על Examplomycin`], tables: [], notes: "", figures: [] })),
};

/** Two checked questions as the op holds them: the key and everything else the solver must never see. */
const ITEMS = [
  {
    vignette: "",
    question: "מה קובע את הרגישות ל-Examplomycin?",
    options: ["פעילות XRD", "פעילות FHR", "כמות Q-tubulin", "כמות fictosterol", "פעילות ETR"],
    answer: 0,
    explanations: ["SECRET-WHY-0 [ש' 5]", "SECRET-WHY-1 [ש' 6]", "SECRET-WHY-2 [ש' 7]", "SECRET-WHY-3 [ש' 8]", "SECRET-WHY-4 [ש' 9]"],
    takeaway: "SECRET-TAKEAWAY [ש' 5]",
    whens: ["", "מתי כן: SECRET-WHEN", "", "", ""],
  },
  {
    vignette: "אישה בת 32 פונה למרפאה עם פריחה מגרדת ומקבלת Examplomycin.",
    question: "איזו הנחיה הכי חשוב לתת לה?",
    options: ["לא לשתות אלכוהול", "ארוחה שומנית", "אמצעי מניעה", "קיבה ריקה"],
    answer: 2,
    explanations: ["SECRET-WHY-A", "SECRET-WHY-B", "SECRET-WHY-C", "SECRET-WHY-D"],
    takeaway: "SECRET-TAKEAWAY-2",
    whens: ["", "", "", ""],
  },
];

test("QS-3: the request has the questions as q1 … qN with Hebrew letters, and nothing of the key (byte scan)", () => {
  const call = solverCall({ lecture, items: ITEMS });
  const bytes = JSON.stringify(call);
  for (const secret of ["SECRET", "explanations", "takeaway", "whens", '"answer"', "מתי כן"]) assert.ok(!bytes.includes(secret), secret);
  assert.deepEqual(
    call.system.map((b) => [b.text === SOLVER_SYSTEM ? "SOLVER_SYSTEM" : b.text === lectureBlock(lecture) ? "lecture" : "?", b.cache_control ?? null]),
    [
      ["SOLVER_SYSTEM", null],
      ["lecture", { type: "ephemeral" }],
    ],
    "the lecture after the system, cached",
  );
  const text = (call.messages[0].content as Array<{ text: string }>)[0].text;
  assert.equal(text, solverRequest(ITEMS));
  assert.equal(
    text,
    [
      "Answer these 2 questions.",
      ["q1", ITEMS[0].question, ...ITEMS[0].options.map((o, k) => `${"אבגדה"[k]}. ${o}`)].join("\n"),
      ["q2", ITEMS[1].vignette, ITEMS[1].question, ...ITEMS[1].options.map((o, k) => `${"אבגד"[k]}. ${o}`)].join("\n"),
    ].join("\n\n"),
  );
});

test("QS-3: max_tokens 1,000 + 250 × N, effort low, and the addendum's schema", () => {
  assert.equal(solverCall({ lecture, items: ITEMS }).max_tokens, 1_500);
  assert.equal(solverMaxTokens(5), 2_250);
  assert.equal(solverCall({ lecture, items: ITEMS }).output_config.effort, "low");
  assert.deepEqual(SOLVER_SCHEMA, {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The question's label, q1, q2 …" },
            choice: { type: "integer", description: "0-based index of the option the slides support" },
            ambiguous: { type: "boolean", description: "true when another option is also defensible from the slides" },
            seq: {
              type: "array",
              description:
                "A question with several parts: tf 1 or 0 per statement; match the option's index per prompt; order the steps' indexes in their order. An empty array for a one-answer question",
              items: { type: "integer" },
            },
          },
          required: ["id", "choice", "ambiguous", "seq"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  });
  // The reservation: the request's characters and all of max_tokens, at the model's rates.
  assert.ok(solverEstimate(lecture, ITEMS) > 0 && solverEstimate(lecture, ITEMS) < 0.1);
});

test("QS-3: kept only with the key and not ambiguous; a missing answer disagrees, one never reached is not judged", () => {
  const a = (id: string, choice: number, ambiguous = false) => ({ id, choice, ambiguous });
  assert.deepEqual(verdictsOf(ITEMS, [a("q1", 0), a("q2", 2)], true), [
    { choice: 0, ambiguous: false, ok: true },
    { choice: 2, ambiguous: false, ok: true },
  ]);
  assert.deepEqual(verdictsOf(ITEMS, [a("q1", 1), a("q2", 2, true)], true), [
    { choice: 1, ambiguous: false, ok: false },
    { choice: 2, ambiguous: true, ok: false },
  ]);
  assert.deepEqual(verdictsOf(ITEMS, [a("q1", 0)], true)[1], { choice: -1, ambiguous: true, ok: false }, "a finished reply without q2: disagreement");
  assert.equal(verdictsOf(ITEMS, [a("q1", 0)], false)[1], null, "a reply that stopped before q2: not judged");
  assert.deepEqual(verdictsOf(ITEMS, [a("Q2", 9)], true)[1], { choice: -1, ambiguous: false, ok: false }, "out of range; labels in any case");
  assert.deepEqual(verdictsOf(ITEMS, [a("q1", 0), a("q1", 3)], true)[0].ok, true, "the first answer to a label counts");
});

// ── one call through a local stand-in of the API ──
let base = "";
let lastBody = "";
let reply = "";
let stop = "end_turn";
const sse = (e: object & { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const api = createServer(async (req: IncomingMessage, res) => {
  lastBody = await new Promise<string>((ok) => {
    const c: Buffer[] = [];
    req.on("data", (x: Buffer) => c.push(x));
    req.on("end", () => ok(Buffer.concat(c).toString("utf8")));
  });
  res.writeHead(200, { "content-type": "text/event-stream" });
  const usage = { input_tokens: 200, cache_creation_input_tokens: 800, cache_read_input_tokens: 0, output_tokens: 1 };
  res.end(
    [
      sse({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage } }),
      sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } }),
      sse({ type: "content_block_stop", index: 0 }),
      sse({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 120 } }),
      sse({ type: "message_stop" }),
    ].join(""),
  );
});
before(async () => {
  await new Promise<void>((ok) => api.listen(0, "127.0.0.1", () => ok()));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(() => {
  api.closeAllConnections();
  (api as Server).close();
});

test("an image item is asked twice, with and without its picture: answerable without it, it is rejected (review QT-3)", async () => {
  const client = new Anthropic({ apiKey: "test-key", baseURL: base, maxRetries: 0 });
  const items = [
    { vignette: "", question: "מה מסומן בחץ?", options: ["Aorta", "Vena cava"], answer: 0, image: "https://x.test/a.jpg" },
    { vignette: "", question: "מה רואים בתמונה?", options: ["Glomerulus", "Tubule"], answer: 1, image: "https://x.test/b.jpg" },
  ];
  // q3 and q4 are the twins (no picture): q3 only guesses (ambiguous), q4 chooses the key.
  reply = JSON.stringify({
    answers: [
      { id: "q1", choice: 0, ambiguous: false, seq: [] },
      { id: "q2", choice: 1, ambiguous: false, seq: [] },
      { id: "q3", choice: 0, ambiguous: true, seq: [] },
      { id: "q4", choice: 1, ambiguous: false, seq: [] },
    ],
  });
  stop = "end_turn";
  const res = await solveQuestions({ client, lecture, items, stopAt: Date.now() + 60_000, ledger: async () => true });
  assert.deepEqual(res.verdicts.map((v) => [v?.ok, v?.blind ?? false]), [[true, false], [false, true]]);
  assert.equal(res.rejected, 1);
  const sent = JSON.parse(lastBody) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
  const ask = sent.messages[0].content[0].text ?? "";
  assert.ok(ask.includes("Answer these 4 questions") && ask.includes("q3\n(shown with a picture you do not have)"), ask.slice(0, 200));
  assert.equal(sent.messages[0].content.filter((b) => b.type === "image").length, 2, "two pictures, the twins without");
  assert.ok(solverEstimate(lecture, items) > solverEstimate(lecture, items.map(({ image: _i, ...it }) => it)), "the pictures are in the estimate");
});

test("QS-3: one call, settled through the caller's ledger as kind solver; kept, rejected and the cost", async () => {
  const client = new Anthropic({ apiKey: "test-key", baseURL: base, maxRetries: 0 });
  reply = JSON.stringify({ answers: [{ id: "q1", choice: 0, ambiguous: false }, { id: "q2", choice: 1, ambiguous: false }] });
  stop = "end_turn";
  const spends: Spend[] = [];
  const res = await solveQuestions({ client, lecture, items: ITEMS, ref: "batch-1", stopAt: Date.now() + 60_000, ledger: async (s) => spends.push(s) });
  assert.deepEqual(
    res.verdicts.map((v) => v?.ok),
    [true, false],
  );
  assert.deepEqual(res.kept, [ITEMS[0]]);
  assert.equal(res.rejected, 1);
  assert.equal(spends.length, 1);
  assert.deepEqual([spends[0].kind, spends[0].ref, spends[0].estimated], ["solver", "batch-1", false]);
  assert.ok(res.costUsd > 0 && Math.abs(res.costUsd - spends[0].costUsd) < 1e-12);
  const sent = JSON.parse(lastBody) as { max_tokens: number; output_config: { effort: string }; system: Array<{ text: string }> };
  assert.equal(sent.max_tokens, 1_500);
  assert.equal(sent.output_config.effort, "low");
  assert.ok(!lastBody.includes("SECRET"), "the key never went out");
  // A reply cut at max_tokens judges only what it reached.
  reply = '{"answers":[{"id":"q1","choice":0,"ambiguous":false}';
  stop = "max_tokens";
  const cut = await solveQuestions({ client, lecture, items: ITEMS, stopAt: Date.now() + 60_000, ledger: async () => true });
  assert.deepEqual([cut.verdicts[0]?.ok, cut.verdicts[1]], [true, null]);
  assert.equal(cut.rejected, 0);
  // No items: no call.
  const before = lastBody;
  assert.deepEqual(await solveQuestions({ client, lecture, items: [], stopAt: Date.now() + 60_000, ledger: async () => true }), { verdicts: [], kept: [], rejected: 0, costUsd: 0 });
  assert.equal(lastBody, before);
});

// ═══ Question types (docs/study/question-types.md) ═══

test("question types: a set question is judged by its order; partly right is wrong; ambiguous is wrong", () => {
  const sets = [
    { answer: null, options: ["s1", "s2", "s3"], seq: [1, 0, 1] },
    { answer: null, options: ["a", "b", "c", "d"], seq: [2, 0, 3] },
  ];
  const v = verdictsOf(
    sets,
    [
      { id: "q1", choice: -1, ambiguous: false, seq: [1, 0, 1] },
      { id: "q2", choice: -1, ambiguous: false, seq: [2, 3, 0] },
    ],
    true,
  );
  assert.deepEqual(v[0], { choice: -1, ambiguous: false, ok: true, seq: [1, 0, 1] });
  assert.equal(v[1]?.ok, false);
  assert.equal(verdictsOf([sets[0]], [{ id: "q1", choice: -1, ambiguous: true, seq: [1, 0, 1] }], true)[0]?.ok, false);
  assert.deepEqual(verdictsOf([sets[0]], [], true)[0], { choice: -1, ambiguous: true, ok: false, seq: [] }, "a finished reply without it");
});

test("question types: the request names a set question's kind, a match's prompts, an image item's attached picture; never a key", () => {
  const text = solverRequest([
    { vignette: "", question: "אילו מהמשפטים נכונים?", options: ["A is B", "C is D", "E is F"], form: "tf" },
    { vignette: "", question: "מה מתאים לכל אחד?", options: ["x1", "x2", "x3"], form: "match", prompts: ["p1", "p2", "p3"] },
    { vignette: "", question: "מה מראה התמונה?", options: ["n1", "n2"], image: "https://x.test/p.jpg" },
    { vignette: "", question: "מה מראה התמונה?", options: ["n1", "n2"], withoutPicture: true },
  ]);
  assert.ok(text.includes("q1 (TRUE/FALSE)") && text.includes("1) A is B"));
  assert.ok(text.includes("q2 (MATCH)") && text.includes("Prompts:") && text.includes("1) p1") && text.includes("א. x1"));
  assert.ok(text.includes("q3\n(with a picture, attached below as q3)") && text.includes("q4\n(shown with a picture you do not have)"));
  assert.ok(!text.includes("https://"), "the URL is an image block, never text");
  const pic = solverCall({ lecture, items: [{ vignette: "", question: "מה מראה התמונה?", options: ["n1", "n2"], image: "https://x.test/p.jpg" }] });
  const content = pic.messages[0].content as Array<{ type: string; text?: string; source?: { url: string } }>;
  assert.deepEqual(content.slice(1).map((b) => b.type + ":" + (b.text ?? b.source?.url)), ["text:q1:", "image:https://x.test/p.jpg"]);
  // solverCall passes only the public text (a set's key never travels).
  const call = solverCall({ lecture, items: [{ vignette: "", question: "q?", options: ["a", "b", "c"], form: "order", answer: null, seq: [2, 0, 1] } as never] });
  assert.ok(!JSON.stringify(call.messages).includes("seq") && !/\[2,0,1\]/.test(JSON.stringify(call.messages)));
  assert.ok(SOLVER_SYSTEM.includes("ORDER") && SOLVER_SYSTEM.includes("MATCH") && SOLVER_SYSTEM.includes("TRUE/FALSE"));
});

test("section O 3: the slides' check of similar questions is made as kind similar, through the run's ledger", async () => {
  const client = new Anthropic({ apiKey: "test-key", baseURL: base, maxRetries: 0 });
  reply = JSON.stringify({ answers: [{ id: "q1", choice: 0, ambiguous: false }, { id: "q2", choice: 0, ambiguous: false }] });
  stop = "end_turn";
  const spends: Spend[] = [];
  const res = await solveQuestions({ client, lecture, items: ITEMS, ref: "unit", kind: "similar", stopAt: Date.now() + 60_000, ledger: async (s) => spends.push(s) });
  assert.deepEqual(res.verdicts.map((v) => v?.ok), [true, false]);
  assert.deepEqual([spends.length, spends[0].kind, spends[0].ref], [1, "similar", "unit"]);
});

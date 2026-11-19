import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SIGNAL_WEIGHT as SHARED_WEIGHT } from "../../../shared/study/pulse";
import { pickQueue, type SessionQuestion } from "./practiceSession";

/* U-1's group signal in practice (spec §12.5.U, Q10) and U's calls. The
 * signal reorders only what has no order of its own: a course's or topic's
 * never-answered tier (otherwise random) and the right tier; a lecture's
 * never-answered tier keeps the reading order, and one's own mistakes keep
 * theirs. Synthetic questions only. */

const L1 = "11111111-0000-4000-8000-000000000001";
const q = (id: string, part = 0, topic = "Examplomycin"): SessionQuestion => ({
  id,
  lecture_id: L1,
  ref_lecture: null,
  exam_no: null,
  part_idx: part,
  created_at: "2026-11-01T10:00:00Z",
  topic,
  vignette: "",
  question: `שאלה ${id}?`,
  options: ["א", "ב", "ג", "ד"],
});
const at = (d: number) => `2026-11-${String(d).padStart(2, "0")}T10:00:00Z`;

test("Q10 in practice: the group's hard questions first where the tier has no order of its own", () => {
  const questions = [q("a", 0), q("b", 1), q("c", 2), q("d", 3)];
  const signals = new Map([["c", 3], ["d", 1]]);
  // A lecture's never-answered tier: the reading order, whatever the signal.
  assert.deepEqual(pickQueue({ key: `l.${L1}`, questions, latest: new Map(), size: "all", random: () => 0.5, signals }), ["a", "b", "c", "d"]);
  // The topic's never-answered tier: the signal first (3, then 1), then the rest as before.
  const plain = pickQueue({ key: "t.examplomycin", questions, latest: new Map(), size: "all", random: () => 0.5 });
  const withSig = pickQueue({ key: "t.examplomycin", questions, latest: new Map(), size: "all", random: () => 0.5, signals });
  assert.deepEqual(withSig.slice(0, 2), ["c", "d"]);
  assert.deepEqual(withSig.slice(2), plain.filter((id) => id !== "c" && id !== "d"));
  // The right tier: least recently answered first, but the group's hard one before it.
  const latest = new Map([
    ["a", { correct: true, at: at(1), times: 1 }],
    ["b", { correct: true, at: at(2), times: 1 }],
    ["c", { correct: true, at: at(3), times: 1 }],
    ["d", { correct: false, at: at(4), times: 1 }],
  ]);
  assert.deepEqual(pickQueue({ key: `l.${L1}`, questions, latest, size: "all", random: () => 0.5 }), ["d", "a", "b", "c"]);
  assert.deepEqual(pickQueue({ key: `l.${L1}`, questions, latest, size: "all", random: () => 0.5, signals }), ["d", "c", "a", "b"], "own mistakes first, then the group's");
  // No signal (no pulse, or below the floor): exactly as before.
  assert.deepEqual(pickQueue({ key: `l.${L1}`, questions, latest, size: "all", random: () => 0.5, signals: new Map() }), ["d", "a", "b", "c"]);
});

test("U's calls name section U's functions and tables literally (npm run test:contract checks their arguments)", () => {
  const src = readFileSync(join(process.cwd(), "src", "study", "lib", "pulse.ts"), "utf8");
  for (const fn of ["study_pulse_ready", "study_pulse_meter", "study_pulse", "study_my_pulse", "study_pulse_brief", "study_pulse_needed"]) assert.ok(src.includes(`rpc("${fn}"`), fn);
  for (const t of ["study_pulse_spots", "study_pulse_questions", "study_pulse_optout"]) assert.ok(src.includes(`from("${t}")`), t);
  // (read as text: lib/pulse.ts talks to Supabase, so it is not loaded in Node)
  const w = /SIGNAL_WEIGHT = \{ sure: (\d), missed: (\d), split: (\d) \}/.exec(src);
  assert.ok(w, "lib/pulse.ts has its weights");
  assert.deepEqual({ sure: Number(w[1]), missed: Number(w[2]), split: Number(w[3]) }, { ...SHARED_WEIGHT }, "the practice weights are section U's quiz weights (3 sure · 2 missed · 1 split)");
  // The member writes only their own opt-out (its group: the user id is the database's default).
  assert.ok(/from\("study_pulse_optout"\)\.insert\(\{ group_id: groupId \}\)/.test(src));
});

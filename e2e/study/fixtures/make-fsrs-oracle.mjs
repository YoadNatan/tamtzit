#!/usr/bin/env node
// Writes fsrs-oracle.json: what ts-fsrs 5.4.2 (the reference FSRS-6
// implementation) answers on fixed random review histories, so package C's
// shared/study/fsrs.test.ts checks its scheduler against the reference with
// no ts-fsrs in the repo (design-cards §4.3; the prototype's oracle,
// spec/cards-proto/test/oracle.mjs, ran 63,000 reviews; this keeps 2,520).
//
//   node e2e/study/fixtures/make-fsrs-oracle.mjs <path to ts-fsrs 5.4.2 dist/index.mjs>
//
// Each history: [retention, start ms, [[at ms, grade, state, step, stability,
// difficulty, due ms, reps, lapses], …]] — the card after each answer, with
// FSRS-6's default weights, no fuzz, short-term learning steps 1m and 10m,
// relearning 10m, a 36,500-day maximum interval. The same generator as the
// prototype's (a fixed LCG seed): learning answers come at the due time plus
// up to 40 minutes (sometimes a day later), review answers 3 days early to 10
// days late.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const ts = await import(pathToFileURL(process.argv[2]).href);
let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const pick = () => {
  const x = rnd();
  return x < 0.15 ? 1 : x < 0.25 ? 2 : x < 0.9 ? 3 : 4;
};
const histories = [];
for (const retention of [0.9, 0.85, 0.95]) {
  const f = ts.fsrs({ request_retention: retention, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true, learning_steps: ["1m", "10m"], relearning_steps: ["10m"], w: [...W] });
  for (let h = 0; h < 60; h++) {
    const start = Date.UTC(2026, 10, 1, 6, 0, 0) + Math.floor(rnd() * 86400000);
    let now = start;
    let card = ts.createEmptyCard(new Date(now));
    const steps = [];
    for (let k = 0; k < 14; k++) {
      if (k > 0) {
        const due = card.due.getTime();
        if (card.state === 2) now = Math.max(now + 60000, due + Math.round((rnd() * 13 - 3) * 86400000));
        else now = Math.max(now + 60000, due + (rnd() < 0.2 ? 86400000 : Math.round(rnd() * 40 * 60000)));
      }
      const g = pick();
      card = f.next(card, new Date(now), g).card;
      steps.push([now, g, card.state, card.learning_steps, card.stability, card.difficulty, card.due.getTime(), card.reps, card.lapses]);
    }
    histories.push([retention, start, steps]);
  }
}
const out = new URL("./fsrs-oracle.json", import.meta.url);
writeFileSync(out, JSON.stringify({ source: "ts-fsrs 5.4.2", weights: W, histories }) + "\n");
console.log(`${histories.length} histories, ${histories.length * 14} reviews → ${out.pathname}`);

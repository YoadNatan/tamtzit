// Package B's plugin for the e2e mock (spec §8.3), as Yoad's decision 2 (17
// Nov 2026) redefines B: the server reads a lecture's points to know once its
// summary is written (server/study/bank.ts; section B of the SQL). It has no
// table or RPC a phone calls: the phones only read study_point_parts (with
// section B's ahead_at) and study_points_state, which package Q's plugin
// (mocks/practice.cjs, loaded with it) answers from db.practice. This plugin
// plays the worker: db.ahead.run(lectureId, o) does what pg_net's kick does
// on the server, as bank.ts and points.ts do it:
//   - claims the parts never tried on their text (one claim time, ahead_at =
//     that time; nothing while a read holds a live lease, nothing new: no claim);
//   - o.capped: the ledger refuses the first reservation at the cap; the claim is
//     given back quietly (the parts look as before; nothing failed);
//   - reads each part in its own call, six at once (o.delay(i) ms each), each
//     reserved and settled in db.calls with ref "ahead" and no member, saving its
//     points (db.practice.pointsPer) or failing it with o.fail(i)'s reason;
//   - o.stall(i): the function dies with that part (its lease runs out after
//     db.practice.stallMs, and no event says so).
// It writes no question and no card: db.practice's batches, requests and drafts
// stay as they were.
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const KINDS = ["drug", "mechanism", "indication", "adverse", "contra", "number"];
const hex = (n) => `b4a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

module.exports = {
  seed(db) {
    let seq = 0;
    db.ahead = {
      notify: null,
      runs: [],
      /** The worker's read ahead of one lecture; resolves when it ends (claimed: false when nothing was due). */
      async run(lectureId, o = {}) {
        const P = db.practice;
        const notify = (row) => db.ahead.notify?.("study_point_parts", "UPDATE", row);
        const sections = db.sections.filter((s) => s.lecture_id === lectureId).sort((a, b) => a.idx - b.idx);
        if (!sections.length || sections.some((s) => s.status !== "ready")) return { claimed: false };
        const key = (s) => `${lectureId}:${s.idx}`;
        const live = sections.some((s) => {
          const pp = P.pointParts.get(key(s));
          return pp?.status === "writing" && Date.parse(pp.lease_until) > Date.now();
        });
        // Only parts never tried on their text (src: the text read; tried: the text last tried).
        const due = sections.filter((s) => {
          const pp = P.pointParts.get(key(s));
          return !(pp && (pp.src === s.markdown || pp.tried === s.markdown));
        });
        const run = { lectureId, parts: due.map((s) => s.idx), at: Date.now(), claimed: false, skipped: null };
        db.ahead.runs.push(run);
        if (live || !due.length) return run;
        const claimedAt = now();
        const before = new Map(due.map((s) => [s.idx, P.pointParts.get(key(s)) ? { ...P.pointParts.get(key(s)) } : null]));
        for (const s of due) {
          const was = P.pointParts.get(key(s));
          const pp = {
            lecture_id: lectureId, part_idx: s.idx, src_md5: "x", try_md5: "y", status: "writing", attempts: 1,
            lease_until: new Date(Date.now() + (o.stall?.(s.idx) ? P.stallMs : 6 * 60_000)).toISOString(),
            error: null, model: "mock", cost_usd: 0, updated_at: claimedAt, ahead_at: claimedAt, src: was?.src, tried: s.markdown,
          };
          P.pointParts.set(key(s), pp);
          notify(pp);
        }
        run.claimed = true;
        if (o.capped) {
          // study_reserve answers 'reserve': study_points_ahead_release gives the claim back, quietly.
          run.skipped = "reserve";
          for (const s of due) {
            const was = before.get(s.idx);
            const pp = was ? { ...was, tried: s.markdown, updated_at: now() } : { lecture_id: lectureId, part_idx: s.idx, src_md5: "", try_md5: "y", status: "pending", attempts: 0, lease_until: null, error: null, model: null, cost_usd: 0, updated_at: now(), ahead_at: null, tried: s.markdown };
            pp.status = was?.src ? "ready" : "pending";
            pp.ahead_at = null;
            P.pointParts.set(key(s), pp);
            notify(pp);
          }
          return run;
        }
        let first = true;
        const readPart = async (s) => {
          if (o.stall?.(s.idx)) return; // the function died with it
          db.calls.push(`ledger study_reserve kind=points ref=${first ? "ahead" : `part ${s.idx}`} member=none p_key=1`);
          first = false;
          await pause(o.delay ? o.delay(s.idx) : 400);
          db.calls.push(`ledger study_settle kind=points ref=ahead member=none p_key=1`);
          const pp = P.pointParts.get(key(s));
          const why = o.fail?.(s.idx) ?? null;
          if (why) {
            Object.assign(pp, { status: "failed", error: why, lease_until: null, updated_at: now() });
            notify(pp);
            return;
          }
          P.points = P.points.filter((x) => !(x.lecture_id === lectureId && x.part_idx === s.idx));
          const n = P.pointsPer[s.idx] ?? 3;
          for (let i = 0; i < n; i++)
            P.points.push({
              id: hex(++seq), lecture_id: lectureId, part_idx: s.idx, n: i + 1, kind: KINDS[i % KINDS.length], subject: "",
              text: `נקודה ${i + 1} של ${s.title}`, anchor: i, quote: "", slides: [s.slide_from], red_flag: i === 0 && s.idx % 2 === 1, weight: i === 0 ? 3 : 2,
              created_at: now(), updated_at: now(),
            });
          Object.assign(pp, { status: "ready", src: s.markdown, lease_until: null, attempts: 0, error: null, updated_at: now() });
          notify(pp);
        };
        const queue = [...due];
        await Promise.all(
          Array.from({ length: Math.min(6, queue.length) }, async () => {
            while (queue.length) await readPart(queue.shift());
          }),
        );
        return run;
      },
    };
  },
};

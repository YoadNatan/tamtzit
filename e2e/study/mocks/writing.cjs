// Package W's part of the e2e mock (spec §8.3): section W's queue and the
// server's side of writing, played by the script. The shared mock loads it
// for every script (every plugin in e2e/study/mocks/ is), so by default it
// changes nothing of today's flow: server writing is off, as it is until
// Yoad sets it up, and the phones write.
//   rpc/study_queue   records each call (p_figures, p_until, p_retry_failed);
//                     refuses a deleted lecture ("lecture not found"); with
//                     p_retry_failed starts the failed parts over, as the SQL
//                     does since W2: a tap counts only when it finds something
//                     to start over (a failed part not already started over, or
//                     a failed outline), at most three a lecture, then "retry
//                     limit"; answers db.serverOn (false, the default: the
//                     phone writes, as today; writing.cjs turns it on to play
//                     the server)
//   /api/study/section  answers 409 "busy" for a part in db.busyParts and
//                     marks it as being written on another device; waits
//                     db.sectionDelayMs first (a slow part, so a lecture can be
//                     deleted while it is written); every other part is
//                     written by the base mock, as in F's flows (its
//                     E2E_TIMEOUT_PART included), which answers 404 "lecture
//                     not found" for a deleted lecture, as section.ts does.
//                     Each call is kept in db.sectionCalls.
//   /api/study/pdf    records the body and answers a small PDF of 9 pages
//   uploads to Storage are slowed down a little, so the saving line can be read
// The script plays the worker itself: it changes db.sections and calls notify().
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

module.exports = {
  seed(db) {
    db.serverOn = false;
    db.queueCalls = [];
    db.retries = {}; // lecture id → "המשך כתיבה" taps today
    db.busyParts = new Set(); // "<lecture>:<idx>" held by another writer
    db.sectionCalls = [];
    db.pdfBodies = [];
    db.uploadDelayMs = 0;
    db.sectionDelayMs = 0;
    db.recordings = [];
    db.recordingNotes = [];
  },

  async rest({ method, path, body, who, db, notify, json: answer, refuse: deny, check }) {
    // A handled request returns something other than undefined (fulfil resolves to undefined).
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    if (method === "POST" && path.startsWith("/storage/v1/object/study/") && db.uploadDelayMs) {
      await pause(db.uploadDelayMs);
      return undefined; // the base mock stores it
    }
    if (method !== "POST" || path !== "/rest/v1/rpc/study_queue") return undefined;
    check.rpc("study_queue", body, `${method} ${path}`);
    db.queueCalls.push({ ...body, at: Date.now(), by: who?.id ?? null });
    const l = db.lectures.find((x) => x.id === body.p_lecture);
    if (!l || !who) return refuse("forbidden");
    if (l.deleted_at) return refuse("lecture not found");
    const parts = db.sections.filter((x) => x.lecture_id === l.id);
    // Started over already: failed, no attempts, a retry time (only a restart leaves a part so).
    const restartable = parts.some((x) => x.status === "failed" && !(x.attempts === 0 && x.retry_at)) || (!parts.length && l.status === "failed");
    if (body.p_retry_failed && restartable) {
      const taps = db.retries[l.id] ?? 0;
      if (taps >= 3) return refuse("retry limit");
      db.retries[l.id] = taps + 1;
      for (const s of db.sections.filter((x) => x.lecture_id === l.id && x.status === "failed")) {
        Object.assign(s, { attempts: 0, retry_at: now() });
        notify("study_sections", "UPDATE", s);
      }
      if (!db.sections.some((x) => x.lecture_id === l.id) && l.status === "failed") Object.assign(l, { status: "new", error: null });
    }
    if (!db.serverOn) return json(false);
    if (!l.queued_at) {
      l.queued_at = now();
      notify("study_lectures", "UPDATE", l);
    }
    return json(true);
  },

  // The mock reads the request's body once and hands it over (b): never read req here.
  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/section" && p !== "/api/study/pdf") return undefined;
    if (p === "/api/study/pdf") {
      db.pdfBodies.push(b);
      const l = db.lectures.find((x) => x.id === b?.lectureId);
      res.writeHead(200, { "content-type": "application/pdf", "x-pages": "9", "x-file-name": encodeURIComponent(`${l ? l.title : "סיכום"}.pdf`) });
      return res.end(PDF);
    }
    db.sectionCalls.push(b);
    if (db.sectionDelayMs) await pause(db.sectionDelayMs);
    const sec = db.sections.find((s) => s.lecture_id === b?.lectureId && s.idx === b?.idx);
    if (!sec) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "section not found" }));
    }
    if (db.busyParts.has(`${b.lectureId}:${b.idx}`)) {
      // Another phone holds the part: its claim answers busy, and the part shows it.
      Object.assign(sec, { status: "writing", writer: "device", markdown: "", lease_until: new Date(Date.now() + 5 * 60_000).toISOString(), updated_at: now() });
      res.writeHead(409, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "busy" }));
    }
    return undefined; // the base mock writes the part
  },
};

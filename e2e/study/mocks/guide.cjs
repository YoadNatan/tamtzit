// The guide's plugin for the e2e mock (docs/study/guide.md): the guide has
// no table and no RPC of its own, so this plugin only watches. While a
// script sets db.guideNoWrites (a walk, a mini-guide, the sandbox), every
// write a member's browser makes to the group's data is refused (403, as
// PostgREST answers a missing grant) and recorded in db.guideWrites:
//
//   - POST, PATCH or DELETE on a study table;
//   - an RPC that is not one of the reads below (the reads the app's
//     screens make on their own while the member moves around);
//   - a POST to /api/study/* (every AI call and every server write).
//
// guide.cjs asserts db.guideWrites is empty after each guided step. Inert
// for every other script (db.guideNoWrites is never set there).

/** RPCs that only read: what the screens a walk passes through ask on their own. */
const READS = new Set([
  "study_schema",
  "study_features",
  "study_feature_on",
  "study_is_member",
  "study_spent",
  "study_my_spent",
  "study_my_uses_today",
  "study_member_saved",
  "study_group_code",
  "study_session_counts",
  "study_practice_overview",
  "study_points_state",
  "study_request_progress",
  "study_question_whens",
  "study_my_card_counts",
  "study_my_card_days",
  "study_my_card_topics",
  "study_my_deck",
  "study_trap_cards",
  "study_today",
  "study_my_flame",
  "study_my_missed",
  "study_my_updates",
  "study_needs_me_meter",
  "study_progress",
  "study_my_progress_counts",
  "study_my_danger",
  "study_my_danger_list",
  "study_my_mistakes",
  "study_open_mistakes",
  "study_my_daily",
  "study_my_days",
  "study_my_latest",
  "study_my_lectures",
  "study_my_readiness",
  "study_my_calibration",
  "study_my_topic_stats",
  "study_my_weak_points",
  "study_my_aspects",
  "study_my_confusions",
  "study_my_relearning",
  "study_my_rewordings",
  "study_my_quiz_returns",
  "study_my_unclear",
  "study_my_loot",
  "study_pulse",
  "study_my_pulse",
  "study_pulse_meter",
  "study_pulse_ready",
  "study_pulse_needed",
  "study_pulse_reader",
  "study_museum",
  "study_museum_meter",
  "study_quiz_state",
  "study_quiz_recent",
  "study_quiz_open",
  "study_meeting_band",
  "study_meeting_guess_state",
  "study_meeting_reader_view",
  "study_paragraph_chips",
  "study_paragraph_practice",
  "study_sections_versions",
  "study_part_corrections",
  "study_corrections_of",
  "study_lecture_log",
  "study_edits_spread",
  "study_dispute_state",
  "study_slide_tables",
  "study_aid_wall",
  "study_aid_week",
  "study_group_plan_meter",
  "study_group_plan_day",
  // What "יחד" and the wall ask on their own: the boss card's meter (it runs
  // the pulse's night first, as study_pulse_meter does) and the credit
  // requests waiting for the member.
  "study_boss_open",
  "study_aid_credit_requests",
  // The quiz setup's own reads ("לפתוח מבחן קבוצתי"'s walk passes through it).
  "study_quiz_pool",
  "study_quiz_record",
  // The library's course links (VITE_STUDY_COURSES) and the course page's head.
  "study_courses_of",
  "study_course_overview",
  // Past exams (VITE_STUDY_EXAMS): one exam's reading and review, and a simulation left open on this phone.
  "study_exam_status",
  "study_exam_review",
  "study_mock_get",
]);

/** Whether a request writes to the group's data. */
function isWrite(method, path) {
  if (path.startsWith("/auth/")) return false;
  if (path.startsWith("/rest/v1/rpc/")) return !READS.has(path.slice("/rest/v1/rpc/".length));
  if (/^\/rest\/v1\/study_/.test(path)) return method === "POST" || method === "PATCH" || method === "DELETE";
  if (path.startsWith("/storage/v1/object/") && !path.includes("/sign/")) return method !== "GET" && !path.includes("/list/");
  return false;
}

module.exports = {
  READS,
  isWrite,
  seed(db) {
    db.guideNoWrites = false;
    db.guideWrites = [];
  },
  guard({ method, path, who, db, refuse }) {
    if (!db.guideNoWrites || !isWrite(method, path)) return undefined;
    db.guideWrites.push(`${who ? who.user_metadata?.full_name : "anon"} ${method} ${path}`);
    // refuse() resolves to undefined once fulfilled: answer true, or the next handler answers the same request again.
    return Promise.resolve(refuse("the guide writes nothing (e2e/study/mocks/guide.cjs)", 403)).then(() => true);
  },
  apiGuard(req, res, db) {
    if (!db.guideNoWrites || req.method !== "POST") return undefined;
    db.guideWrites.push(`api POST ${new URL(req.url, "http://x").pathname}`);
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "the guide writes nothing" }));
    return true;
  },
};

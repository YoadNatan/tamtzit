/* ── A course's key: how two course texts are known to be one course ──
 * The same as section S's study_private.course_key(text), so the library's
 * links, the course page, the course question and s=c.<course> (with
 * VITE_STUDY_COURSES) match the lectures the SQL matches: the direction and
 * zero-width marks a PDF pastes (U+200B–U+200F, U+202A–U+202E, U+2060,
 * U+2066–U+2069) removed, every run of white space (\s: NBSP, tabs,
 * U+2000–U+200A, U+3000…) one space, trimmed, in lower case. ── */

const MARKS = /[​-‏‪-‮⁠⁦-⁩]/g;

export function courseKey(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(MARKS, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

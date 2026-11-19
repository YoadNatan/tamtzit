/* ── Direction helpers ──
 * Moved from SummaryView.tsx (spec §5.5): the Hebrew test and the Latin run
 * that richText and isolateLatin wrap in <bdi>, so a closing bracket between
 * English and Hebrew is never mirrored and neighbouring numbers never swap.
 * The flashcards' Anki export uses the same run to isolate English in its
 * HTML (design-cards). */

export const HEBREW = /[֐-׿]/;

/** A Latin run starts at a Latin letter, digit, Greek letter or an opening
 *  bracket before one, and runs until the next Hebrew letter. Global: callers
 *  reset lastIndex before each scan. */
export const LATIN_RUN = /[([]?[A-Za-z0-9Ͱ-Ͽ½¼¾µ][^֐-׿]*/g;

/** Trims a Latin run back to where it should end: no trailing spaces,
 *  sentence punctuation or the app's separator " · " (so "Loop diuretics ·
 *  מנגנון" keeps its dot between the two, not inside the English), and no
 *  closing bracket it did not open. */
export function trimRun(run: string): string {
  let s = run.replace(/[\s,;:.!?·]+$/u, "");
  for (;;) {
    const opens = (s.match(/[([]/g) ?? []).length;
    const closes = (s.match(/[)\]]/g) ?? []).length;
    // "IV (לאט)": the run "IV (" must not take the bracket that opens the Hebrew.
    if (/[([]\s*$/.test(s)) s = s.replace(/[([]\s*$/, "").replace(/[\s,;:.!?]+$/u, "");
    else if (closes > opens && /[)\]]$/.test(s)) s = s.slice(0, -1).replace(/[\s,;:.!?]+$/u, "");
    else if (opens > closes && /^[([]/.test(s)) s = s.slice(1);
    else break;
  }
  return s;
}

/** The direction for a native date or time field. The phone draws its value
 *  in the phone's own language ("19 Nov 2026" in English, "19 בנוב׳ 2026" in
 *  Hebrew), and inside the app's right-to-left page an English value came out
 *  as "Nov 2026 19" on iPhone Safari. So the field takes the direction of the
 *  phone's language: right to left only for a right-to-left language. */
export function pickerDir(lang: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language): "rtl" | "ltr" {
  return /^(he|iw|yi|ar|fa|ur)\b/i.test(lang ?? "") ? "rtl" : "ltr";
}

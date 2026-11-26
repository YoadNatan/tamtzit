/* ── Direction for text drawn outside the app ──
 * A notification's title and body are drawn by the phone or the computer,
 * not by the app's page, so <bdi> is not there to keep an English run in
 * place: "הסיכום של Loop diuretics (2)" could come out with its bracket on
 * the wrong side. isolate() wraps each Latin run inside Hebrew text in the
 * Unicode isolates FSI … PDI (U+2068, U+2069), which every current system's
 * notification text honours.
 *
 * The run is the app's own (src/study/lib/bidi.ts: LATIN_RUN and trimRun),
 * copied here because server code does not import src/; a test keeps the two
 * the same. */

export const FSI = "⁨";
export const PDI = "⁩";
export const HEBREW = /[֐-׿]/;

/** A Latin run starts at a Latin letter, digit, Greek letter or an opening
 *  bracket before one, and runs until the next Hebrew letter. */
const LATIN_RUN = /[([]?[A-Za-z0-9Ͱ-Ͽ½¼¾µ][^֐-׿]*/g;
/** What makes a run worth isolating: a letter (a bare number reads right as it is). */
const LETTER = /[A-Za-zͰ-Ͽµ]/;

/** A run trimmed back to where it should end (src/study/lib/bidi.ts's rule):
 *  no trailing spaces, sentence punctuation or " · ", no spaced operator after
 *  it, and no bracket it did not open. */
export function trimRun(run: string): string {
  let s = run.replace(/(\s+[=≈~→←↔⇒<>|/+\-–—]+)+\s*$/u, "").replace(/[\s,;:.!?·]+$/u, "");
  for (;;) {
    const opens = (s.match(/[([]/g) ?? []).length;
    const closes = (s.match(/[)\]]/g) ?? []).length;
    if (/[([]\s*$/.test(s)) s = s.replace(/[([]\s*$/, "").replace(/[\s,;:.!?]+$/u, "");
    else if (closes > opens && /[)\]]$/.test(s)) s = s.slice(0, -1).replace(/[\s,;:.!?]+$/u, "");
    else if (opens > closes && /^[([]/.test(s)) s = s.slice(1);
    else break;
  }
  return s;
}

/** Hebrew text with each Latin run isolated. Text with no Hebrew, or that is
 *  already isolated, comes back as it was. */
export function isolate(text: string): string {
  if (!HEBREW.test(text) || text.includes(FSI)) return text;
  return text.replace(LATIN_RUN, (run) => {
    const t = trimRun(run);
    if (!t || !LETTER.test(t)) return run;
    const at = run.indexOf(t);
    return run.slice(0, at) + FSI + t + PDI + run.slice(at + t.length);
  });
}

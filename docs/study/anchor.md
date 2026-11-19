# The paragraph anchor (package N)

What sits on each paragraph of a summary, and how to practise one
paragraph. The build spec is the addendum's §12.4.N (`spec/addendum/addendum.md`,
the meeting design's §5); the approved screens are
`proposal/mockups/anchor.html` (s1: the chip row; s2: the paragraph's sheet).
Behind `VITE_STUDY_ANCHOR` (with questions or cards), against section N of
the SQL at version 1.

## What a member sees

- **Under a paragraph, the chip row**: "2 שאלות" · "2 כרטיסים" · the wall's
  chip (package J's slot, nothing until J) · "תגובה" / "3 תגובות" (the
  reader's live count, which replaces the dot inside the paragraph while the
  flag is on). Singular forms for one ("שאלה", "כרטיס"). A paragraph with an
  open question to the group has its comments chip in the warning colour.
- **One line only the member sees**, under the chips: "טעית כאן פעמיים."
  (her answers on the paragraph's questions that are still wrong; "טעית
  כאן." for one, "טעית כאן 3 פעמים." for more) or "סימנת כאן ׳לא ברור׳"
  (section M's tap, when M exists), with "רק לך". "השאלה חוזרת מחר." follows
  only with Today (decision 12).
- **While following a reader** each row is one dot (aria-label "על הפסקה יש
  שאלות, כרטיסים או תגובות"); **while reading aloud**, nothing.
- **A chip opens the paragraph's sheet**, "מה יושב על הפסקה" with the
  paragraph's slide tags: the tabs "תגובות · 1" (the thread), "אסוציאציה"
  (J, with WALL) and "תרגול · 4". K adds "תיקון".
- **The "תרגול" tab**: "של הקבוצה: 2 שאלות, 2 כרטיסים", "הסימונים" · "רק לך",
  each question ("שאלה" or "שאלה · מקרה קליני") with "טעית פעמיים" · "טעית"
  · "עוד לא ענית" · "ענית נכון" (or "בבדיקה אחרי תיקון בפסקה", "הוסתרה עד
  בדיקה"), each card with "בחפיסה" · "עוד לא בחפיסה", and the primary action
  "לתרגל את הפסקה · 2 שאלות". Empty: "עוד אין שאלות או כרטיסים על הפסקה הזו."
- **"לתרגל את הפסקה"** (`?v=practice&s=p.<lecture>.<part>.<anchor>&n=all`)
  asks exactly the paragraph's questions that are in practice (not hidden,
  not marked), the unanswered first in reading order; Back leads to the
  paragraph.
- **From a wrong answer**, practice's "לפסקה" opens the summary at the
  paragraph, marked, with "מהשאלה שטעית בה, ישר לפסקה".

## Who sees what

The counts are the group's, without names. "טעית כאן", "לא ברור" and every
state in the tab are computed for the caller only, from her own answers,
card states and taps; nothing of another member's leaves the database.
Hidden questions and trap cards that have not opened are never counted
(review F-6, SEC-6). Help has a row, "מה יושב על הפסקה", and the privacy
note a line, "מתחת לפסקה:".

## How it works

- **SQL (section N, `supabase/study-schema.sql`)**: `study_paragraph_chips(lecture)`
  and `study_paragraph_practice(lecture, part, anchor)`, members only
  ("lecture not found" otherwise, and for a deleted lecture). A question sits
  on its own anchor, else on the first point to know it covers (practice
  2.0's `study_points`), else on the first point of its part that shares a
  slide; a card on its own anchor once section C's end gives cards one, else
  by the points. Section C's end, M's taps and J's wall are read only when
  they exist, so the section runs on production's database as it is (C, M
  and J not loaded) and keeps working after them. It adds functions only.
- **Client**: `features/anchor.tsx` (the reader's hook, the tab's lazy
  wrapper, the shared chip store), `components/ChipRow.tsx`,
  `components/PracticeTab.tsx` (lazy), `lib/anchor.ts` (the row's words and
  data, in the entry chunk), `lib/anchorTab.ts` (the tab's, loaded with it),
  `styles/anchor.css`. The paragraph's sheet frame,
  `components/ParagraphSheet.tsx`, was first the minimal one N needed; as
  merged in wave 3 it is K's and N's one frame (K's tabs and thread extras,
  N's "תרגול" count, placed in `styles/collab.css`). `LectureCtx` gains `notes(part, anchor)`, the reader's live
  comment counts.

## Built, and left for other packages

| Addendum item | State |
|---|---|
| A2 the chip row, the private chip, the dot while following, nothing while reading | built |
| A4 the "תרגול" tab and "לתרגל את הפסקה" (`s=p.…`) | built |
| A3 Q's "לפסקה" with N's toast | built (a paragraph's session also leads back for a question placed by its points) |
| A3 C's "מאיפה זה?" → the paragraph | built by C's end (`CardSource.tsx`, "לפסקה"), merged in wave 3 |
| A3 K's "לפסקה: …" from "לשאול" | built by K (`AskView.tsx`), merged in wave 3 |
| The association chip | J's `useParagraphWall` is called; it draws nothing until J |
| "הפסקה הזאת קשה לנו" | U's `useParagraphPulse` is called; nothing until U |
| "לא ברור" chip | read through `study_private.my_unclear_spots` when M's table exists |
| E's "להוסיף מלכודת משלי" in the tab | phase 3 (E) |

## Tests

- SQL: section N's checks in `supabase/tests/study.sql` (N1-N5, N-reg: the
  chips, the private chips only the caller's, the tab's states, strangers,
  anon and a deleted lecture refused, and with section C's end, M's taps and
  J's wall simulated in a rolled-back transaction).
- Unit: `src/study/lib/anchor.test.ts` (the words, the states, the session
  key and its order, the route and the flag), the help copy and the
  registry in `route.test.ts`.
- e2e: `e2e/study/anchor.cjs` with `e2e/study/mocks/anchor.cjs` (N-2); with
  the flag off it checks that nothing changes. `E2E_ANCHOR=1` on a release's
  set says the build has the flag; `together.cjs` and `writing.cjs` then find
  a paragraph's comment count in the chip row.

## Production, for Yoad

N adds no server key, no function and no cost: SQL and one flag.

1. **Run the SQL.** Supabase → SQL Editor → paste the whole
   `supabase/study-schema.sql` of this branch → Run. It can be run again
   safely; it only adds section N's functions. Check:

   ```sql
   select public.study_schema();
   ```

   It must answer `{"C": 1, "F": 1, "K": 1, "N": 1, "Q": 2, "W": 1, "Z": 2}`.
2. **Merge**; Vercel deploys it. Nothing changes for the group (the flag is off).
3. **Check `/api/study/health`**: `"schemaOk":true`.
4. **Turn it on.** Vercel → Settings → Environment Variables → Production:
   add `VITE_STUDY_ANCHOR` = `1` (keeping `VITE_STUDY_QUESTIONS`,
   `VITE_STUDY_PRACTICE`, `VITE_STUDY_CARDS`), then Redeploy.
5. **Check.** A lecture with questions: chips under the paragraphs; a chip
   opens "מה יושב על הפסקה" on "תרגול"; "לתרגל את הפסקה" asks its questions.
   To roll back, remove `VITE_STUDY_ANCHOR` and redeploy (the SQL can stay).

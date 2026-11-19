# Question types

Behind `VITE_STUDY_QTYPES` (on `practice`; production has it on). Needs
section Q at 3 (the columns) and section X at 1 (the functions; X 2 checks
the geometry's numbers); the same run
of `supabase/study-schema.sql` also brings Z, M, H, U and C to 3 (their
filters and cards). The app asks for Q 3 and X 1 only (`requiredSchema`);
the server's "שאלות חדשות" answers 409 `schema` for a new type until X 1 is
there, and keeps working for the plain types.

## The types

| Type | Style key | Form | Answered with | Live quiz |
|---|---|---|---|---|
| שאלה אמריקאית (the seven older styles) | case, mechanism, … | one | `study_answer_question` | yes |
| שאלה על תמונה | image | one | `study_answer_question` | yes |
| סימון על תמונה, "מה מסומן במספר 3?" | label | one | `study_answer_question` | yes |
| סימון על תמונה, "באיזה מספר מסומן X?" | label | tap | `study_answer_question` (options are pin numbers) | no |
| מקרה קליני בשלבים | steps | one, 2-3 rows in a series | each step is its own row | step 1 only |
| נכון / לא נכון | tf | tf | `study_answer_set` | no |
| התאמה | match | match | `study_answer_set` | no |
| סידור | order | order | `study_answer_set` | no |

A set question (tf, match, order) stores its key in
`study_question_keys.seq` (`answer` null) and an answer in
`study_answers.choices` (`choice` null). Correct means every element is
right; "3 מתוך 4" is shown in the verdict and never counted. Every older
question is form `one` and works as before.

## What is stored (`study_questions` and `study_question_drafts`)

- `form` (one, tap, tf, match, order), `layout` (jsonb, at most 16 KB),
  `series` and `step` (a staged case; both or neither, step 1-3).
- image: `figure = fig:N-K`, `layout = {kind:"image", fig, crop?, masks?}`
  (a PDF page with geometry: cut to its diagram, its labels masked; a PPTX
  picture: cut to the slide's own crop, from the label geometry's clip or
  from `slides[].figures[].crop`, the srcRect the upload keeps for every
  picture since this round; a lecturer often crops away a legend or labels).
- label: `layout = {kind:"label", mode, fig, stage, img, clip?, lines,
  baked, pins:[{n,x,y}], masks, ask? (name mode), dots?}`. The layout never
  has a label's text. The server writes the lead-in. Pins are at least
  `PIN_GAP` (0.12) of the stage's shorter side apart; a closer label is a
  grey dot (`dots`), and an item whose target cannot have two such
  neighbours is asked by name instead, or rejected. Only a label that names
  something becomes a pin (`isLabelText`: two letters or more, not a panel
  letter, a Roman numeral, "Fig. 2", a source or "©" line). In name mode a
  wrong option that is a pin starts its why with "מסומן במספר N בשרטוט.",
  so the screen names the whole drawing after the answer.
- tf: options are 3-5 statements; `seq[i]` 1 or 0.
- match: `layout = {kind:"match", prompts}` (3-5); options the answers and
  at most one extra; `seq[i]` the option of prompt i.
- order: options are 3-6 steps, never stored in order; `seq[pos]` the
  option at that place.
- steps: 2-3 one-answer rows sharing `series`; row k's vignette is the case,
  the earlier steps' updates and answers as facts, and its own update, so
  every row stands alone; `layout = {kind:"steps", of, lead}` (`lead`: the
  carried text the screen folds under "המקרה עד כאן").

## Label geometry (no AI)

Read at upload, on the phone: `src/study/lib/pptxGeo.ts` (PPTX text boxes
and connectors over a picture, groups composed through chOff/chExt, the
srcRect crop) and `src/study/lib/pdfGeo.ts` (PDF text items inside the
largest image region of the operator list; the text is in the pixels, so
masks). Kept per figure in `study_lectures.slides[].figures[].geo` (shape:
`shared/study/figureGeo.ts`). An older lecture gets it from "לסמן תוויות
בשרטוטים" (the lecture's footer, or the disabled chip's button in "שאלות
חדשות"): the same file picked again is read on the phone, checked to be the
same deck, and saved with `study_lecture_set_geo`. Nothing is uploaded again.
Until then a planned label item becomes an image item.

## Writing them (op "questions")

- `shared/study/forms.ts`: the forms, the types, their weights (label 0.5,
  tf 1.2, steps 2.5, others 1) for the estimate and the writer's
  max_tokens, the type groups of a practice round, `canStyle` and
  `defaultStylesFor`.
- `planRequest` takes each part's facts (tables, captioned pictures,
  labelled pictures, points by kind): a type a part cannot have takes the
  next one; label ≤ 2 × labelled pictures, image ≤ captioned pictures,
  steps ≤ 2 a part.
- `server/study/questions.ts` checks each type (`checkTf`, `checkMatch`,
  `checkOrder`, `checkImage`, `checkLabel`, `checkSteps`); a release-1 round
  takes none of them. `server/study/labels.ts` builds a label item
  deterministically (pins top to bottom, right to left in a row; name and
  tap mode in turn).
- Image items are written and checked looking at the pictures: the writer
  gets the part's captioned pictures (up to 6, signed for 30 minutes with the
  member's token) as image blocks after the request, and the blind solver
  gets an image item's picture, never its caption. The solver is also asked
  the same item without its picture: when it then chooses the key without
  calling it ambiguous, the picture adds nothing and the item is rejected
  (`blind`, and the rewrite is told so). An image item whose picture cannot
  be signed is left "unchecked". The prompt asks only about what is clearly
  visible, never named in the lead-in, and not printed in the picture.
- The blind solver answers a set question with `seq`; label items are keyed
  by the geometry and never solved (the draft is saved `ok`).
- A label's wrong options are the picture's other labels, written as the
  labels are; one option in another script (English among Hebrew, or the
  reverse) rejects the item. A true/false item's false statement changes a
  fact the slides state, never one they leave out. One failed step of a staged case rejects the whole
  case; staged cases get no automatic rewrite and no "↻ לנסח מחדש".
- The points to know gain the kinds structure, process and finding; the
  aspects anatomy, histology, physiology and imaging.

## Where each type goes

- Practice, mistakes, "הטעויות שלי", Today: every type (`answering.ts`
  answers any of them). A lecture's session keeps a staged case's steps
  together and never starts it at step 2. Every form but a tap item is
  shuffled for each showing (tf's statements, match's answers, order's
  steps too), so a question that comes back is not answered from memory of
  places.
- A picture question waits for its picture: until it has loaded nothing can
  be picked or bet, and a picture that does not load says "התמונה לא נטענה"
  with "לנסות שוב" (a failure is never cached) and "לדלג, בלי שזה ייספר".
- The live quiz, the coffee quiz and the boss: one-answer questions only
  (plain, image, label by its number, step 1); a picture gets about 12 s
  more and is drawn under the lead-in, its pins never tapped.
- The pre-guess, the meeting's catch-up, traps, the pulse's traps and the
  museum: text questions only (no picture, no set).
- Mistake cards: a set question's card is its first element answered wrong
  ("נכון או לא נכון: …", "… – מה מתאים?", the right order); a label's is
  "בשרטוט שבשקף N: איפה X?", and its slide tag opens the picture.
- The danger list prints no "ענית" for a set question (accepted).
- Accepted risk: a PDF label item in name mode has its answer in the page's
  pixels under the mask.
- Accepted risk: every member's phone downloads the lecture's slides, label
  geometry (each label's text and box) included, to draw the summary; a
  label item's pins are those boxes' centres. No screen shows a name before
  the answer, but a member reading the network traffic could match them.
  Moving the geometry out of members' reach is a later change.

## Release: old clients and the old address

The new rows (tf, match, order, label and image questions) are read by
clients built before the question types as plain one-answer questions:
main's practice lists them, its answer call fails with 'no key' on a set
question (the session skips it with an error), its live quiz shows a label's
"מה מסומן במספר 3?" without the drawing, and its server's "לנסח מחדש" of a
set draft spends a writer call and then fails 'bad form'. So, before the
SQL of this release runs:

1. Freeze or redirect the old address (`delo-logo-review…/study/`), as
   `docs/MOVE.md` §6 already asks before any SQL change made here.
2. Run the SQL (7 parts), then deploy, then ask the group to close the app
   and open it again (README "Updating" step 3), so no phone keeps the old
   build while new questions are written.
3. Turn `VITE_STUDY_QTYPES` on only after that (it is what makes the new
   rows).

## The screens

- "שאלות חדשות": "שאלות אמריקאיות" and "סוגים נוספים"; the defaults for the
  chosen parts, a member's last choice for the lecture winning; a type the
  parts cannot have is off with why.
- "סבב חדש": "סוג שאלה" (הכול · אמריקאיות · שאלות על תמונה · מקרה בשלבים ·
  נכון / לא נכון · התאמה · סידור), only groups with questions.
- The answer screens (one lazy chunk): `QuestionFigure` (white stage in both
  themes, pins 26 px in 44 px targets, arrows between pins, "להגדיל"; pins
  under 32 px apart at the card's width start the stage zoomed in its own
  scroll box; after the answer a numbered list names every pin),
  `TfAnswer` (a radio pair per statement, one Tab stop, arrows switch),
  `MatchAnswer` (tap a slot then a chip, or the reverse; no dragging; focus
  goes to the next empty slot, or the one just filled or cleared),
  `OrderAnswer` (tap to add, ↑ ↓ ✕; focus stays on the list and a live line
  says what moved). Right and wrong are a ✓ or ✗ and words, never colour
  alone.

## Checks

- Unit: `shared/study/forms.test.ts`, `src/study/lib/pptxGeo.test.ts`,
  `pdfGeo.test.ts`, `qtypesSession.test.ts`, `server/study/qtypes.test.ts`,
  the solver's and op tests.
- SQL: `supabase/tests/study.sql` X1a-X1p (X 2: `geo_ok` checks every
  number, as `isFigureGeo` does; the server skips any figure whose geometry
  fails `isFigureGeo`).
- e2e: `e2e/study/qtypes.cjs` on the flag sets prod and w5x (with the
  picture that does not load, crowded pins at 360 px, the pin list after
  the answer, the bank's count and the order list's focus).

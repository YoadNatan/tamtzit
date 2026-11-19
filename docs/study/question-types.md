# Question types

Behind `VITE_STUDY_QTYPES` (on `practice`; production has it on). Needs
section Q at 3 (the columns) and section X at 1 (the functions); the same run
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
  (crop and masks only for a PDF page with geometry).
- label: `layout = {kind:"label", mode, fig, stage, img, clip?, lines,
  baked, pins:[{n,x,y}], masks, ask? (name mode), dots? (tap mode)}`. The
  layout never has a label's text. The server writes the lead-in.
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
- The blind solver answers a set question with `seq` and reads an image
  item's caption; label items are keyed by the geometry and never solved (the
  draft is saved `ok`). One failed step of a staged case rejects the whole
  case; staged cases get no automatic rewrite and no "↻ לנסח מחדש".
- The points to know gain the kinds structure, process and finding; the
  aspects anatomy, histology, physiology and imaging.

## Where each type goes

- Practice, mistakes, "הטעויות שלי", Today: every type (`answering.ts`
  answers any of them). A lecture's session keeps a staged case's steps
  together and never starts it at step 2.
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

## The screens

- "שאלות חדשות": "שאלות אמריקאיות" and "סוגים נוספים"; the defaults for the
  chosen parts, a member's last choice for the lecture winning; a type the
  parts cannot have is off with why.
- "סבב חדש": "סוג שאלה" (הכול · אמריקאיות · שאלות על תמונה · מקרה בשלבים ·
  נכון / לא נכון · התאמה · סידור), only groups with questions.
- The answer screens (one lazy chunk): `QuestionFigure` (white stage in both
  themes, pins 26 px in 44 px targets, arrows between pins, "להגדיל"),
  `TfAnswer`, `MatchAnswer` (tap a slot then a chip, or the reverse; no
  dragging), `OrderAnswer` (tap to add, ↑ ↓ ✕). Right and wrong are a ✓ or ✗
  and words, never colour alone.

## Checks

- Unit: `shared/study/forms.test.ts`, `src/study/lib/pptxGeo.test.ts`,
  `pdfGeo.test.ts`, `qtypesSession.test.ts`, `server/study/qtypes.test.ts`,
  the solver's and op tests.
- SQL: `supabase/tests/study.sql` X1a-X1p.
- e2e: `e2e/study/qtypes.cjs` on the flag sets prod and w5x.

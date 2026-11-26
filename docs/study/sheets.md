# Uploaded sheets (VITE_STUDY_SHEETS, SQL section O)

Built on `dev` from 26 Nov 2026, in the design's slices. The design is "upload
a test or exercise sheet → exact questions, optional similar questions,
revision 2" (package O); where it and the practice sets design (§13.2)
disagree, the practice sets design and the built section L win. Yoad's answers
and every open decision (OD1-OD21) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Uploaded sheets").
Yoad's steps are in [`RELEASE-O.md`](RELEASE-O.md).

A member uploads **a past exam ("מבחן קודם") or an exercise sheet ("דף
תרגילים")**; a question bank is a sheet with no lecture. The app copies every
question exactly as printed, attaches answers (an answers file, marks on the
sheet, or the model's, labelled until a member confirms), lets any member fix a
misread question, and is practised as on paper. Similar questions are made
only when asked and go into the sheet's practice set (section L, kind `sheet`).

A sheet is a `study_exams` row with `kind = 'sheet'`: the same pages, Storage
path, queue, lease, worker, review screen and ledger kind `exam` as past exams
([`sources.md`](sources.md), phase 2).

## Status

| Slice | What | Flag | SQL | State |
|---|---|---|---|---|
| O0 | The synthetic fixture, the time measurement on it, Yoad's read-only checks | none | none | Built |
| A0 (O1) | The kind and one lecture of an upload, the switch `sheets`, "a new sheet", keying true/false and match items by hand, simulations of past exams only, the sheets line's figures (`study_sheet_room`) | `VITE_STUDY_SHEETS` | O 1 | Built (part 11 since O 2; it was part 10, after L) |
| A0 (O2, O3) | The upload (two kinds, desktop drop and paste, camera checks, the cover page), a sheet's bounds on the server (40 pages, the $6 line, the headroom, the $3 confirmation), the course page by kind, the wide review with its page and the keyboard, hand keying in the review, the exactness flags, printed order after answering, the landing card | `VITE_STUDY_SHEETS` | O 1 | Built |
| A0 (O4) | The A0 e2e script (`e2e/study/sheets.cjs`, flag set `o0`; it was `o` until O8) at 320/390/820/1440, a ready sheet in the mock (`mocks/sheets.cjs`), `devices.cjs` and `wide.cjs` with the new screens, the fixes they found, the copy list, Yoad's release steps | — | — | Built |
| A1 (O5, O6) | The SQL (O 2: forms open and numeric, exact items by label, answers files and worked solutions, edits, open-add, the budget pause; the pickers' in-place edits) and the server (the sheet reader, its answers file, solving with worked solutions, open-add, resume) | `VITE_STUDY_SHEETS_FORMS` (the client's, O7) | O 2 | Built (part 11; parts 2 to 9 changed in place) |
| A1 (O7, O8) | The client: the forms in practice, the edit sheet, add and retire, answers and worked solutions, open-add, the paused state, the lecture page's row; its e2e (`e2e/study/sheets-forms.cjs`, flag set `o`) | `VITE_STUDY_SHEETS_FORMS` | O 2 | Built |
| B (O9-O12) | Similar questions after a wrong answer and for the whole sheet, in the sheet's set on L's shelf | `VITE_STUDY_SIMILAR` | O 3 | Not built yet |

## The fixture (O0)

Course material never goes into git. Everything the tests read is synthetic:

- [`e2e/study/fixtures/sheet/sheet6.json`](../../e2e/study/fixtures/sheet/sheet6.json):
  "תרגיל 3 · פרמקוקינטיקה (synthetic)", fictional drugs and patients. A cover
  page (blank name and ID fields), 5 pages of questions and a 2-page answers
  file. Its 11 items cover every form the design needs: one-answer (one with
  8 options), true/false, match, a 3-part question with a shared stem (one
  choice part, one numeric, one open), a numeric item over two lines, an item
  with a table (pipe rows), an item with a graph, and an open item.
  - `pages[].lines`: what each page prints (a text PDF's lines). `| … |` rows
    are drawn as a table, `[[figure:curve]]` as a graph.
  - `truth`: every item exactly as printed, with its answer (the reader's
    target from release A1, and the exactness check's ground truth).
  - `a0`: the exam reader's replies as they are (release A0): choice items
    only, the numeric and open ones counted as skipped (4), the 8-option item
    rejected by the save path (2-6 options), the answers file by number.
- [`e2e/study/fixtures/make-sheet.cjs`](../../e2e/study/fixtures/make-sheet.cjs)
  makes the files at test time (never committed): a text PDF, the answers PDF
  and 6 photos (one turned on its side, one blurred), and returns the drawn
  graph's box in thousandths (item 6: `pg:5:147,188,706,237`).
  `node e2e/study/fixtures/make-sheet.cjs <dir>` writes them by hand
  (`NODE_PATH=$(npm root -g)`).
- `server/study/sheetFixture.test.ts` (in `npm run test:study`) keeps the
  fixture honest: synthetic markers on every page, every item on its page
  exactly as printed, every form present, every label in the answers file,
  and release A0's replies saving as above.
- `e2e/study/fixtures/real/` is in `.gitignore`: a real sheet tried locally
  stays there.

## How long a unit takes (O0: measured on the fixture, $0)

The design's rule (§8.5): a unit's worst output must finish within 60% of the
200 s a unit may run (`UNIT_STOP_MS`), so 120 s. The design wanted a paid
measurement on the synthetic sheet; this build makes no paid call, so O0
measures what can be measured for $0 and leaves the speed to a read-only
query of production's ledger.

`node tools/sheet-timing.mjs` measures what a reader, a solver and a similar
job write for the fixture (its items as printed, with their answers and
solutions), in tokens (the project's 2.5 characters a token, and a
conservative 1.5 for Hebrew), doubles it for a dense sheet, adds thinking
(1,000 tokens a read unit, 1,500 an item solved), and turns it into seconds:

| Output speed (tokens/s) | Read unit, 3 pages | Fits | Solve unit, 8 items | Fits | Most items a solve unit | Most pages a read unit |
|---|---|---|---|---|---|---|
| 30 | 98 s | yes | 463 s | no | 2 | 4 |
| 50 | 59 s | yes | 278 s | no | 3 | 7 |
| 80 | 37 s | yes | 174 s | no | 5 | 13 |

The fixture writes about 320 Hebrew tokens a page when read and about 120 an
item when solved, before thinking. So:

- **Read units of 3 pages fit** at any speed above about 25 tokens a second.
- **A solve unit of 8 items fits only above about 115 tokens a second**, because
  thinking dominates. Until Yoad's query gives the real speed, the solver
  (release A1, O6) takes `min(8, most items)` items a unit at the query's
  slow speed (`slow_tps_p10`, below). At 50 tokens a second that is 3 items a
  unit.
- A similar job is a solve-sized job (one generation and one check per twin),
  so the same limit applies to its sources a job (the design's 8 a job).

**Yoad's read-only query for the speed** (SQL Editor; it reads the ledger of
the last 60 days, the summaries' and the exams' calls, and changes nothing).
A call's time is from its reservation to its settlement, so the speed it
shows is a little slower than the model's (a safe error). Send Claude the
rows:

```sql
select kind, model, count(*) as calls,
       round(avg(out_tok), 0) as avg_out_tokens,
       round(avg(secs), 0) as avg_seconds,
       round(percentile_cont(0.1) within group (order by tps)::numeric, 1) as slow_tps_p10,
       round(percentile_cont(0.5) within group (order by tps)::numeric, 1) as median_tps
  from (select kind, model, (usage ->> 'output_tokens')::numeric as out_tok,
               extract(epoch from settled_at - created_at) as secs,
               (usage ->> 'output_tokens')::numeric / nullif(extract(epoch from settled_at - created_at), 0) as tps
          from public.study_usage
         where settled_at is not null and usage ? 'output_tokens' and (usage ->> 'output_tokens')::numeric >= 1000
           and created_at > now() - interval '60 days'
           and kind in ('exam', 'part', 'practice', 'solver', 'points')) x
 where secs > 0
 group by 1, 2 order by calls desc;
```

Then `node tools/sheet-timing.mjs --tps <slow_tps_p10>` gives the unit sizes.

## Yoad's checks before release A0 (OD1, OD2; read only)

Production was not queried by this build. In the SQL Editor (each query only
reads):

**OD1: is past exams' switch on?** O depends on it (it is inserted off).

```sql
select name, enabled, changed_at from study_private.features
 where name in ('courses', 'exams', 'sheets') order by name;     -- courses true; exams ?; sheets: no row until part 11
select public.study_schema() ->> 'S' as s, public.study_schema() ->> 'O' as o;   -- 2, and null until part 11
```

If `exams` is false, the members have no past exams yet; release A0 turns it
on together with `sheets` (RELEASE-O.md), or Yoad keeps both off and O ships
dark.

**OD2: the monthly line and the spend by kind.** `STUDY_MONTHLY_USD` is a Vercel
setting (Settings → Environment Variables, Production): it should be `33` (the
code's default is 40). The spend of the last two months by kind, and the total:

```sql
select to_char(date_trunc('month', created_at at time zone 'Asia/Jerusalem'), 'YYYY-MM') as month, kind,
       count(*) as calls, round(sum(cost_usd), 2) as usd
  from public.study_usage
 where created_at >= date '2026-10-01'
 group by 1, 2 order by 1 desc, 4 desc;

select to_char(date_trunc('month', created_at at time zone 'Asia/Jerusalem'), 'YYYY-MM') as month,
       round(sum(cost_usd), 2) as usd
  from public.study_usage where created_at >= date '2026-10-01' group by 1 order by 1 desc;
```

O's lines (sheets $6, similar $5) assume a baseline under about $15 a month.
If the total without sheets is above that, tell Claude: the two lines go down
(OD3).

## SQL section O 1 (release A0)

In `supabase/study-schema.sql` after section L (the order is now … S, I, R,
L, O). O 1 was in part 10 with L (91 KB); O 2 would take part 10 to 188 KB,
so **O starts part 11** (`tools/sql-parts.mjs`'s `STARTS` gains `"O"`; part 10
is L alone, 71 KB; part 11 is O, 118 KB; the tests, the parts' headers and
the README say 11 parts). Its tests are section O of `supabase/tests/study.sql`.

- **`study_exams.kind`** (`'exam' | 'sheet'`, default `'exam'`, check
  `study_exams_kind_x`) and **`study_exams.lecture_id`** (one optional
  lecture, `on delete set null`). A member's direct insert or update (section
  Q's column grants) can write neither.
- **The switch `sheets`**, inserted off. `exams` must be on too.
- **`study_sheet_create(p_course, p_meta)`** (member): `{title 1-120,
  lecture?, key_source marked | separate | none}` (default `none`), no year,
  moed or minutes. The lecture must be the course group's and not deleted. The
  row is `kind 'sheet'`, `hide_from_profile` (so
  `study_course_style_items` never takes a sheet's items as style examples),
  status `uploading`. Returns `{exam_id, prefix}` like `study_exam_create`.
  Errors: `not signed in`, `course not found`, `off`, `bad sheet`, `lecture
  not found`.
- **`study_exam_key_set(p_question, p_answer, p_seq)`** (member): keys any
  choice item of an upload by hand, true/false and match included (phase 2's
  gap): a one-answer item takes `p_answer`, a true/false item `p_seq` (1/0 a
  statement), a match item `p_seq` (a distinct option a prompt), checked by
  `study_private.exam_key_fit`; both null clear the key. Origin `member`,
  logged in `study_exam_key_log`, which gains `old_seq` and `new_seq` (a set
  item's statements; `'{}'` for none). Errors: `question not found`, `off`,
  `in quiz`, `bad answer`. Section S's `study_set_exam_key` stays for
  one-answer items.
- Registry `('O', 1)`.

### Section S's functions O redefines

Parts always run in order through the last part (README), so O's definitions
win. Each is S's text with the change below; a later change to one of them in
S must be copied here.

| Version | Function | Change |
|---|---|---|
| O 1 | `study_course_overview` | Each upload carries `kind` and `lecture_id` (null when it has none, or its lecture was deleted or is another group's) |
| O 1 | `study_courses_of` | `exams` counts `kind = 'exam'` only (same return type) |
| O 1 | `study_mock_create` | A sheet is `exam not found` (OD9); the pool and the pick take only forms one, tap, tf, match and order |
| O 1 | `study_exam_key_undo` | Not in the design's list: a change `study_exam_key_set` logged on a true/false or match item (`new_seq` set) brings the statements back too, and is `changed` when they are no longer what it left; every other change undoes as in S |

Also seen while building O 1:

- **Section R's `exam_ready` and `exam_failed` notices now carry `args.kind`**
  (R's hook already read the column when it exists): `"exam"` for a past exam,
  `"sheet"` for a sheet. R's test R38 checks it. The words for a sheet
  ("הדף מוכן", not "המבחן מוכן") belong to the client slice (O2,
  `notifyCopy.ts`).
- A member can still clear "לא לכלול בחישוב הנושאים" (`study_exam_hide`) on a
  sheet, which would let the course's style examples take its items. The
  review screen (O3) should not offer that switch for a sheet.
- Section S's `study_exam_pages_done` is unchanged: in release A0 the op
  `exam_read` keeps a sheet to 40 pages and checks the sheets line and the
  headroom before it calls it (O2).

## SQL section O 2 (release A1; O5)

After O 1 in section O, in **part 11**. It needs parts 2 to 9 run before it:
the pickers of sections Q, Z, M, H and T are edited in place (below), and a
check at O 2's start stops part 11 with "section O 2 needs parts 2 to 9 run
first" when they were not. Registry `('O', 2)`; the client's
`VITE_STUDY_SHEETS_FORMS` (O7) will ask for it, and the server's sheet
reader asks for it (`VARIANT_SCHEMA.sheet_forms`: Q 2, S 2, O 2).

**Columns.** `study_questions`: `no_label` (as printed: "3א", "2.1"),
`no_key` (its normal form, `study_private.label_key`: one item per label of
an upload, unique index `study_questions_exam_label`), `figures` (up to 4
boxes `pg:<page>:x,y,w,h`; `figure` stays `figures[1]`), `exact` (how much of
the copy is in its page's PDF text, 0-1; null without a text layer).
`study_question_keys`: `num`, `num_tol` (percent, 0-50; 1 when not said),
`num_unit`, `model_answer`, `rubric` (up to 6 points), `solution`,
`solution_origin` (exam | sheet | solved | member), `solution_conf`.
`study_answers.value` (a numeric answer; `correct` stays not null).
`study_exam_key_log.old_text`, `new_text` (a solution's or a number's change,
as JSON text). Private tables (no grants): `study_private.open_marks` (an
open item shown, then self-marked 0-2; read by no aggregate, OD8) and
`study_private.sheet_label_keys` (an answers file's lines by label, kept
until their items are read).

**The widened checks** (each found by name or by its definition, dropped and
added again under a name; a later run of an earlier part keeps them, since
section Q adds its own only when missing). Tested on a database at
`4b9b832` with rows only O 2 allows, then parts 2 to 11 run twice: the rows
stay, the checks stay widened, and an ai question over 600 characters and 7
statements on a true/false item are still refused.

| Check | Before | O 2 |
|---|---|---|
| `study_questions_text_x` (the inline question and case checks) | question 5-600, case text ≤ 2,500 | an uploaded item (source exam, and O 3's twin): question 2-4,000, case text ≤ 8,000; the rest as before |
| `study_questions_options_x` (the inline 2-6) | 2-6 | open and numeric: none; one-answer of an upload: 2-10; the rest 2-6 |
| `study_questions_form_x` (Q 3's) | one, tap, tf, match, order | + open, numeric (the drafts' check is not changed) |
| `study_questions_step_x` (Q 3's) | step 1-3 | step 1-12 (a question's parts) |
| `study_questions_exam_no_x` (the inline 1-500) | 1-500 | 1-12,100 (a sheet's item is page·100 + its place) |
| `study_questions_label_x`, `_figures_x` | — | label ≤ 20, its key ≤ 40, exact 0-1; at most 4 boxes (`study_private.figures_ok`) |
| `study_question_keys_sheet_x` | — | the new key columns' bounds |
| `study_exam_item_log_field_x` | question, vignette, option, prompt | + label, form, options, prompts, figures, added, retired, unretired |
| unchanged on purpose | `study_question_keys_seq_x`, `study_answers_choices_x`, `exam_sheet_keys` (2-6 values, 0-5) | true/false and match stay at 6 statements (design D7) |

**The sheet reader's units** (the worker's key; the phone's fallback with
the member's token too):

- `study_sheet_pages_done(p_exam, p_pages, p_urls, p_until, p_key)`: section
  S's checks of the pages, copied; a sheet only (`not a sheet`); at most 40
  pages and an answers file of 10; read units of **3 pages** with the next as
  context (`range.reader 'sheet'`), one key unit for an answers file. The op
  calls it only for a client that draws the forms (`forms: true`); a release
  A0 client's sheet goes through S's `study_exam_pages_done` as before.
- `study_sheet_queue_key(p_job, p_lease, p_from_page, p_key)`: the sheet
  prints its own answers from that page on: those pages (at most 10) become
  its answers file, one key unit (`printed`), and pending read units of only
  those pages are not read. Once a sheet.
- `study_sheet_save_items(p_job, p_lease, p_items, p_skipped, p_key)`: by
  label (an upsert). A sheet's item is numbered page·100 + its place on the
  page (a taken number moves on); an open-add item of a past exam keeps its
  printed number (a taken one is a repeat). The same label on a page further
  away is another item (an exercise whose numbers restart: its key gets
  `@<page>`); from the next page, the longer copy stays. A question's parts
  (main, part 1-12) share a series. An item a member fixed, or anyone answered
  or marked, keeps its text. Marks only when the uploader said so; the
  answers file's line by label wins and may come first. The sheet's lecture is
  each item's `ref_lecture`.
- `study_sheet_save_keys(p_job, p_lease, p_rows, p_key)`: a key unit's lines
  by label (kept in `sheet_label_keys`, written onto the items of that label,
  origin `sheet`), or a solve unit's answers by item id (only the unit's
  items, only where an item has none, origin `solved`; an unsure reading caps
  the confidence at 2). Trust (design D11): member > answers file > marks >
  the model; a worked solution follows the same order
  (`study_private.sheet_key_apply`, `origin_rank`).

**Section S's functions O 2 redefines** (with O 1's four, eight in all; each is
S's text with the change):

| Function | Change |
|---|---|
| `study_claim_exam` | The unit's `reader` (`range.reader`; a unit queued without one is the exam reader's, unless its sheet was queued for the sheet reader: a page read again), `extra` (open-add), `printed` (a key unit of the sheet's own answers), the upload's `kind`, `lecture_id` and `course`, the labels saved already (`seen_labels`), the next page's lines (a sheet unit's exactness check), and for a solve unit each item's label, series, step, boxes, page and that page's link. **A sheet's unit is not taken while the switch `sheets` is off** (design D22) |
| `study_private.exam_advance` | Solve units by reader: a past exam's choice items 20 a unit (reader `exam`); the items of a sheet read by the sheet reader, and any open or numeric item, `study_private.sheet_solve_items()` a unit (**4**, until Yoad's speed query says more fit: "How long a unit takes"), reader `sheet`. A ready upload stays ready while only open-add units and their solving run. `skipped_open` is net: the read units' skips less what open-add units copied, never below 0. A sheet whose unit the budget refused (**D23**: failed for `budget` or `reserve`, no retry time) stays `reading` with error `budget` when nothing else runs |
| `study_private.exam_printed` | An open-add unit's repeats are not the exam's (the net `skipped_open` keeps the count right) |
| `study_private.exam_unkeyed` | A numeric item with its number, or an open item with its model answer, is keyed |

**The member's RPCs** (each `exam not found` / `question not found` for a
stranger, a deleted upload or with `exams` off; a sheet's also with `sheets`
off):

- `study_sheet_review(p_exam)`: S's `study_exam_review` and the upload's
  kind, lecture, reader, `paused` (the held units by kind), open-add's
  progress, and per item what S's review has no place for (label, boxes,
  exactness, series and step, number with unit and tolerance, model answer
  and rubric, worked solution with its origin, who took it out). A key a live
  quiz holds is not shown.
- `study_exam_item_fix(p_question, p_patch)`: label, form, case text,
  question, options, prompts, boxes. Once anyone answered or marked the item,
  only its text (`answered`); a label another item has (`label taken`). Each
  changed field is logged; a key that no longer fits is cleared unless a
  member keyed it.
- `study_exam_item_add(p_exam, p_item)` ("+ להוסיף שאלה שלא הועתקה"; after its
  page's last item, logged `added`), `study_exam_item_retire(p_question,
  p_note)` and `study_exam_item_unretire(p_question)` (by whoever took it
  out, or by anyone within 24 hours: `not yours` after).
- `study_item_solution(p_question, p_patch)` ("לתקן תשובה" beyond a choice:
  a number, its unit and tolerance, a model answer and rubric, a worked
  solution), origin `member`, logged with the text before and after (practice
  sets §13.2's name; the design's `study_set_solution`).
- `study_answer_value(p_question, p_value, p_mode, p_ms)`: a numeric answer
  checked at $0 within its tolerance (an answer of 0 only by 0), written to
  `study_answers` with its value (OD7); a suggested key under confidence 3
  writes no row (S's trigger, decision 2).
- `study_open_show(p_question)` (the model answer, rubric and solution; a row
  in the caller's own open marks) and `study_open_mark(p_question, p_mark)`
  (0 טעיתי, 1 חלקית, 2 צדקתי, on the latest showing). Never an answer row (OD8).
- `study_question_solution(p_question)`: the worked solution and answer once
  the caller answered the item (or saw an open one's solution); null before.
- `study_sheet_progress(p_exam)`: the caller's own counts (items, answered,
  right, open items shown and self-marked).
- `study_sheet_resume(p_exam, p_skip_solve, p_dry, p_key)` (through the op):
  "להמשיך" puts the held units back; "לסיים בלי תשובות מוצעות"
  (`p_skip_solve`) drops the held solve units (the items stay without a
  suggested answer); `p_dry` only says what would go on.
- `study_sheet_open_add(p_exam, p_urls, p_until, p_dry, p_key)` (through the
  op; OD15): a ready past exam, or a sheet read by the exam reader, whose
  read units skipped open questions has those units' pages read again for
  them (`range.reader 'open'`, `range.extra`); fresh links; once (`already`).

### The pickers: which readers of `study_questions` may meet an open or numeric item (the design's audit)

Open and numeric items (and O 3's similar questions, source `twin`) are a
sheet's, with `lecture_id` null and `ref_lecture` the sheet's lecture. Every
last definition in the file that reads `study_questions` was classified:

| Kind | Functions | What O 2 does |
|---|---|---|
| **Draws questions, group-wide or by `coalesce(lecture_id, ref_lecture)`** | `study_quiz__pick` (Z), `study_quiz__pick_preset` and `study_meeting_quiz` (M), `study_private.boss_askable` (H: so `boss_heads`, `study_boss_open` and the boss's rounds), `study_today`'s danger card (T) | `and study_private.q_plain(q.source, q.form)` in place (Q's new helper: the five choice forms, never a twin). Each already took form `one` only, so today's rows are unchanged |
| Draws, runs as the caller | `study_quiz_pool` (Z) | the same rule inline (`source is distinct from 'twin'`; it already takes `one`), since `study_private` is not the caller's |
| Lecture-scoped (`q.lecture_id = …`; a sheet's items have none) | `study_session_counts`, `study_question_round`, `study_paragraph_practice` (N), `question_spots`, `study_needs_me`, `study_my_rewordings` | nothing |
| Counts questions or answers (OD7: numeric answers count like any practice answer) | `study_my_lectures` (a lecture's questions, its sheets' items with them), `study_my_topic_stats`, `study_practice_overview`, `study_my_latest`, `study_my_daily`, `study_my_weak_points`, `study_my_days`, `study_my_readiness`, `study_my_aspects`, `study_my_calibration`, `pulse_answers`, `study_my_pulse`, `study_my_flame`, `study_my_loot`, `study_my_quiz_returns` | nothing; open answers are never rows (OD8) |
| Needs a choice or a bet | `study_my_danger_list` (a wrong "על בטוח" answer: a numeric answer has no bet), `pulse_night__traps` (`choice is not null`), `study_my_confusions` (`choice is not null`) | nothing |
| Personal scopes that render every form in practice | `study_open_mistakes` (a wrong numeric answer is a mistake to practise) | the client draws the forms (O7) |
| The upload's own | S's and O's `study_exam_*`, `study_sheet_*`, `study_course_style_items` (sheets are `hide_from_profile`), the simulation (O 1: choice forms of past exams only) | as above |

The client's group-wide loaders (`lib/practice.ts`'s `listGroupQuestions`,
`questionColumns.ts`) filter the same way with the client slice (O7).

## Release A0 in the app (O2, O3; `VITE_STUDY_SHEETS`)

The flag needs past exams' (`VITE_STUDY_EXAMS`, with `VITE_STUDY_COURSES`
and `VITE_STUDY_PRACTICE`) and section O 1 (`requiredSchema`: `O: 1`).
Without it nothing below shows, and a build without it never lists a sheet:
the course page and the simulation's setup leave `kind = 'sheet'` out
whatever the flag (OD9).

**The upload** (`SheetUpload.tsx`, lazy; `?v=exams&new=1&c=` for a past
exam, `&new=sheet[&l=<lecture>]` for a sheet, as a lecture's page will open
it). Step 1 is two tiles, "קובץ PDF" and "לצלם דפים", inside a drop zone: a
computer drops or pastes (Ctrl+V / ⌘V) PDFs and pictures there, and several
files become one upload's pages in order. A Word file is refused with "קובץ
Word? צריך קודם לשמור אותו כ-PDF." (OD16). After the first page:

- the pages as tiles in order (moved, turned, removed); from 760 px the
  pages and the details are two columns (the details on the right);
- "מה זה?": "מבחן קודם" (year, מועד, minutes, as before) or "דף תרגילים"
  (a name from the file's, "דף תרגילים 26.11" when emptied, and one
  lecture of the course, not needed); a sheet by default from a lecture's
  link;
- "איפה התשובות?": marked on the page, a separate file ("להוסיף קובץ"; a
  second file dropped while it is chosen asks "זה קובץ התשובות?"), or none;
- the camera's checks: each photo is drawn at 640 px and measured (the
  variance of a Laplacian over its grey pixels, and its mean light); under
  80 it is "עמוד N נראה מטושטש", under 70 light "עמוד N חשוך מדי", with
  "לצלם שוב" (the new photo takes its place). On the synthetic sheet's
  photos the sharp pages measure 1,040-2,210 and the blurred one 12; a
  photo the browser cannot decode (HEIC on a computer) is not checked;
- a PDF whose page 1 has a name or an ID to fill in within its first lines
  ("שם:", ת.ז, תעודת זהות, מספר סטודנט) offers "להוריד אותו" (the page is
  not drawn or uploaded) or "להשאיר";
- the button "להעלות ולהעתיק · כ-$0.35" (the usual price, the exam
  reader's) and the line "8 עמודים · לרוב 6–12 דקות. …"; a sheet above a
  usual $3 asks "הדף ארוך (N עמודים) · כ-$… · להמשיך?" first (with the
  40-page cap an A0 sheet stays under it; the path is tested on the
  server);
- "מה אפשר להעלות?": only course-staff material and the group's own (OD6),
  a WhatsApp file, the Word line. Nothing on the screen says where the
  pages go (decision 1); the providers line is in help (OD5).

**A sheet's bounds on the server** (op `exam_read`, `sheetGate`): at most 40
pages and an answers file of at most 10 (400 `too many pages`); the switch
`sheets` (403 `off`); a usual price above $3 needs `confirmBig` (409
`confirm`); the worst case (`shared/study/sheetPrice.ts` `sheetWorstUsd`:
every unit at all of its max_tokens, pages as full as a page gets, 8 items
a page solved with no answers, 2 a page with them) must fit the sheets line
less what sheets cost this month (`STUDY_SHEETS_MONTHLY_USD`, 6; 402
`sheets_cap`) and the room under the 80% line (402 `budget`). Then the start
is a past exam's (ref `read`, 3 a day, group work, OD13). Worst cases: a
6-page sheet $1.01 marked, $1.13 with an answers file, $1.77 with no
answers; 40 pages marked $5.12, with no answers $9.75 (so a 40-page sheet
with no answers never passes the $6 line, as the design's §11.2 says).
`study_sheet_room(p_group)` (O 1) gives the op what a member cannot read:
the switch, what this month's units of the group's sheets cost
(`exam_jobs.cost_usd`, sheets deleted since included), and the month's
spend. Known gap, as the design accepted: two sheets started minutes apart
can both pass, since a unit's cost is known when it finishes.

**The course page** (`CourseScreen.tsx`): one segment "מבחנים ותרגילים",
"העלאת מבחן או דף תרגילים" first, then "מבחנים קודמים" and "דפי תרגילים"
(a sheet's lecture under its title); the head counts both. "סימולציה" and
"לתרגל מבחן קודם" take past exams only.

**The review** (`ExamView.tsx`, with `PageView.tsx`): a sheet says "לתרגל
כמו בדף", has no "סימולציה מהמבחן" and no "לא לכלול בחישוב הנושאים". From
760 px it is two columns: the text and the items on the right, the page on
the left (sticky): "עמוד 2 מתוך 6", the pages before and after, − + and ⤢,
each figure box a button that opens its item (an A0 item has a box only
when it has a figure, so the page's items are chips under it too). Keys,
matched on `event.code`: ↑ ↓ the item before or after, E "לתקן טקסט"; no
key confirms. A true/false item is keyed statement by statement and a match
item row by row ("לסמן תשובה", `study_exam_key_set`), and "לבטל" brings the
statements back. Exactness ($0, design D9): an item whose copy (case,
question, options, prompts) has under 0.55 of its trigrams in its page's
PDF text and the next page's is "לבדיקה", with "ההעתקה שונה מהטקסט בקובץ ·
כדאי לבדוק מול העמוד" (a page with no text, a scan or a photo, flags
nothing). The synthetic sheet's exam-reader copies all pass.

**Practice:** an uploaded item (a past exam's or a sheet's) keeps its printed
order after the answer (`keepPrinted`, design D10), the chosen and the right
option marked in place.

**A link opened without a member** (`DeepLinkCard.tsx`, OD14): on the join
screen, for `?v=exams&e=…`: "הקישור נפתח בדפדפן, לא באפליקציה.", how to
open it from the icon (two lines), "להמשיך כאן: כניסה עם הקוד האישי" (the
sign-in then opens the upload), and "אין קוד אישי? הקישור הוא לחברי
הקבוצה." A set's link keeps practice sets' own line.

**Not in A0 (later slices):** the exact text component (`SheetText`: lines,
tables) waits for the sheet reader (A1), since the exam reader's copies
have no line breaks; drawing a box on the page, the edit sheet, adding and
retiring items; the lecture page's row ("דפי תרגילים של ההרצאה"); a DOCX.

**Bundle:** the slot `features/sheets.tsx` is the only module of O in the
entry chunk (owner `O`, capped at 1,500 B): 686 B; the entry chunk is
404,315 B of 410,000 with every flag on.

## The A0 e2e (O4)

On the shared mock (`e2e/study/mock.cjs`), with the synthetic sheet only: no
real host, no paid call, no course material. Build the mock dists as the
other packages do (every s2 flag with `VITE_STUDY_INSTALL`, `VITE_STUDY_NOTIFY`,
`VITE_STUDY_MAKE`, `VITE_STUDY_SETS` and `VITE_STUDY_SHEETS` for set `o0`; the
same without `VITE_STUDY_SHEETS` for `ps`; since O8 the set `o` is release A1's,
`o0` with `VITE_STUDY_SHEETS_FORMS`), then, one at a time
(`NODE_PATH=$(npm root -g)`):

```
E2E_FLAGS=o0 node e2e/study/sheets.cjs  <dist-o0> <out>   # release A0, every step below
E2E_FLAGS=ps node e2e/study/sheets.cjs  <dist-ps> <out>   # without the flag: nothing of it shows
E2E_FLAGS=o  node e2e/study/devices.cjs <dist-o>  <out>   # + the screens sheet-upload and sheet-review (o0 or o)
E2E_FLAGS=o  node e2e/study/wide.cjs    <dist-o>  <out>   # + a sheet's review and upload, phone / 760+ / keys (o0 or o)
E2E_FLAGS=s2 node e2e/study/exams.cjs   <dist-s2> <out>   # past exams, unchanged
```

**`e2e/study/sheets.cjs`** (set `o0`; it refuses `o`, release A1's, whose
upload reads a sheet with the sheet reader: that is `sheets-forms.cjs`), in order:

1. Help's "מבחנים ותרגילים" row has the material line (OD6) and the
   providers line (OD5).
2. The course page: one segment "מבחנים ותרגילים", the upload first, the
   empty line.
3. The phone upload from a lecture's link (`new=sheet&l=`): the two tiles and
   the Word line, nothing on the screen about where the pages go (decision 1,
   checked before and after a file); a Word file dropped is refused with its
   line; the PDF: "דף תרגילים" chosen, the name "sheet 3" from `sheet-3.pdf`,
   the lecture chosen, the cover offered and left out (5 pages; the ID line
   is never sent), the answers file, the price on the button and the pages
   and minutes under it; `study_sheet_create`'s row (kind sheet, its lecture,
   `hide_from_profile`), 7 pages uploaded and handed over (the answers file's
   2 last).
4. The reading, then the phone review: 6 choice items (the 8-option one
   refused by the exam reader's save path), 4 keyed by the answers file, the
   true/false and match items to key; "4 שאלות פתוחות דולגו."; "לתרגל כמו
   בדף"; no "סימולציה מהמבחן" and no "לא לכלול בחישוב הנושאים". The exam
   reader's copies are all in their pages' text; a misread copy (question and
   options not on the page) is "לבדוק מול הדף" with "ההעתקה שונה מהטקסט
   בקובץ".
5. The wide review at 820 and 1440: two columns (the text right of the page),
   the page's picture, the figure's box (item 6, page 4 once the cover is
   gone) opens its item; ArrowDown opens the next, ArrowUp the one before,
   E "לתקן טקסט"; Enter (on the item's heading and on the page) changes no
   key; back under 760 the phone's list.
6. A computer at 1440: the upload's details beside its pages; a PDF dropped
   (`new=1` starts as a past exam, switched to a sheet, the name follows),
   the cover kept (6 pages), no lecture (a question bank), "בקובץ נפרד" and
   the answers file dropped ("זה קובץ התשובות?" → "כן"), 8 pages handed
   over; 6 photos pasted (Ctrl+V) with only the blurred one flagged.
7. Another member keys the true/false item statement by statement
   (`study_exam_key_set` with `p_seq`), "סומנה ע״י נועה", and "לבטל" brings
   the statements back.
8. "לתרגל כמו בדף": a wrong pick, and after the answer the options stay in
   the printed order with the right one and the pick marked in place (D10);
   the answer is recorded with mode `exam`.
9. The simulation's setup lists the past exam only, even with the sheet's
   id in the address (OD9).
10. The course page with both kinds: the two headings, a sheet's lecture
    under its title, the head's counts ("מבחן קודם אחד · 2 דפי תרגילים").
11. The landing card (OD14): absent on a plain join link; on an upload's
    link with no member, its lines and the two-line how-to; the personal
    code signs in and lands on the same sheet.
12. The refusals in a sheet's words: the switch off ("העלאת דפי תרגילים עוד
    לא פתוחה בקבוצה.") and the sheets line spent (402 `sheets_cap`: "התקציב
    לדפי תרגילים נגמר החודש.").
13. No sideways scroll at 320, 390, 820 and 1440 px, light and dark, on the
    upload, the review, the course page and the landing card; the a11y check
    (contrast, 44 px hit areas, titles) on every screen. `problems: []`,
    `a11y: []`.

Without the flag (set `ps`, or `s2`): a sheet in the data is never listed or
counted on the course page, `new=sheet` opens past exams' own upload, the
simulation lists past exams only, an upload's link signed out has no card,
and `study_sheet_create` is never called.

**`mocks/sheets.cjs`** adds `db.sheetsMock.seed({ course, title, lecture,
images, keySource })`: a ready sheet as the reading leaves it (its 5 pages
without the cover, their lines, the exam reader's replies, the answers file
read by number) through the exams mock's own worker. `devices.cjs` and
`wide.cjs` use it with `make-sheet.cjs`'s `pageShots` (clean page JPEGs).
**`devices.cjs`** (set `o0` or `o`) adds the screens `sheet-upload` (the PDF chosen)
and `sheet-review` (an item open) on its eight devices, with its usual checks
(sideways scroll, text under 14 px, contrast, hit areas, the Tab walk under
the bars) and that the two columns start at 760. **`wide.cjs`** (set `o0` or `o`)
checks a sheet's review and upload as one column on a phone and two from
760, and the keys with a mouse.

What the e2e does not reach, and where it is tested instead: more than 40
pages and the $3 confirmation (an A0 sheet's usual price stays under $3 with
the 40-page cap) are the op's, in `server/study/exams.test.ts`; the headroom
check and `study_sheet_room` are in the SQL tests (section O) and the op's
tests. Real material and real reading speed are Yoad's checks after the
release (below and `RELEASE-O.md`).

**Fixed on the way** (the scripts found them; commit "the fixes the A0 e2e
found"): "מה אפשר להעלות?" was 21 px tall (now 44); a PDF tile's file name
was 13 px (now 14); the wide review's page column and the upload's details
stuck 16 px from the top, under the sticky top bar on a computer (now under
it); a figure's box had 1.05:1 contrast in dark (it sits on white paper in
both schemes); a true/false or match item keyed by hand did not say who
keyed it (now "סומנה ע״י נועה").

## The sheet reader on the server (O6)

`server/study/sheets.ts`, `prompts/sheets.ts`, `calc.ts`; `exams.ts` and
`ops/exams.ts` changed. Nothing of it runs until a client sends `forms:
true` (O7, `VITE_STUDY_SHEETS_FORMS`) or asks for open-add or a resume, and
section O 2 is installed: a release A0 client's sheet is read by the exam
reader exactly as before.

**Who reads a unit.** `runExamUnit` takes the claim's `reader`: none (a
database before O 2) or `exam` is the past exams' reader, unchanged
(`EXAM_READ_SYSTEM` byte for byte, its length pin holds); `sheet` and `open`
are the sheet reader's. Both share the reservation, the stream, the lease and
the finish. The sheet reader's units reserve under kind `exam` with refs
`sheet_read`, `sheet_key` and `sheet_solve` (the ledger tells sheets from
exams; the models package, Y, routes the keys `sheet_read` and, with O 3,
`similar`). The model is the current default (`SHEET_MODEL = MODEL`, OD17);
no provider is refused (OD5).

| Unit | Request | Saved through |
|---|---|---|
| read (`sheet`) | `SHEET_READ_SYSTEM` (cached): 3 pages as pictures with their PDF lines as a hint, the page before and after as context; the labels saved already; the uploader's answers mode | `study_sheet_save_items`, after `study_sheet_queue_key` when the reader says the sheet's own answers start on one of its pages |
| read (`open`) | the same system, told to copy only open and numeric questions under their printed numbers | the same; a question's parts folded into one open item |
| key | `SHEET_KEY_SYSTEM`: the answers file (or the sheet's own printed answers) by label | `study_sheet_save_keys` (a file with several versions keys nothing: `versions`) |
| solve | `SHEET_SOLVE_SYSTEM`: up to 4 items (`sheet_solve_items()`), by ref, each figure page attached once when its link is still good; a suggested answer, a worked solution, a numeric answer's working (named inputs and a formula), an open item's model answer and rubric | `study_sheet_save_keys` |

**Pure checks before any write** (`sheets.test.ts`): the text kept as printed
(lines, pipe tables, at most two blank lines; over its limit cut with a
visible "[…]" and marked to check), a label of 1-20 characters, forms one
(2-10 options), true/false and match (2-6), open and numeric (none), up to 4
boxes on pages the unit saw, marks only when the uploader said so, an item
that starts on the next page left to the next unit, and the exactness against
the page's PDF text (the synthetic sheet's 11 items all pass 0.55; a misread
copy falls under it). A numeric answer is recomputed from its working
(`calc.ts`: numbers, the inputs' names, + − × ÷ ^, parentheses, ln, log10,
exp, sqrt, abs, min, max, at most 200 tokens; never evaluated as code): when
the working does not give the number (within the tolerance, at least 0.5%),
the answer is kept at confidence 1, so it counts in no score.

**Op `exam_read`** (`ops/exams.ts`):

- `forms: true` on a sheet: its price is the sheet reader's
  (`sheetReaderPriceUsd`: about $0.066 a page to copy, $0.024 an item
  solved; 6 pages with an answers file about $0.5), its worst case
  (`sheetReaderWorstUsd`: every unit at all of its max_tokens, 8 items a page
  solved without answers, 2 with them: 6 pages without answers $3.65, with
  answers $1.40-1.57; under a fresh $6 line at most 9 pages without answers
  and 24 with them, against release A0's 24 and 40) must fit the sheets line
  and the room under the 80% line, as release A0's; then
  `study_sheet_pages_done`. 503 schema without O 2.
- `action: "open_add"` (OD15): `dry: true` gives `{units, pages, skipped,
  priceUsd}` for the button "להעתיק גם N שאלות פתוחות · כ-$…"; otherwise
  with fresh links the worst case (`openAddWorstUsd`) must fit the room (a
  sheet's: the sheets line too), a start is reserved (ref `read`, 3 a day)
  and settled at $0, and `study_sheet_open_add` queues the units.
- `action: "resume"` (D23): the held units' worst case (`heldWorstUsd`)
  must fit the sheets line and the room again; then `study_sheet_resume`
  (`skipSolve: true` for "לסיים בלי תשובות מוצעות"). Nothing is reserved:
  each unit reserves itself.

**Unit sizes.** Read units are 3 pages (they fit the 120 s budget at any
likely speed, "How long a unit takes"). Read units write at most 12,000 tokens
(the fixture writes about 3,000 with thinking). Solve units are 4 items with
`max_tokens` 1,500 + 2,000 an item (9,500 for 4), until Yoad's speed query
says more fit: then `study_private.sheet_solve_items()` (one number in part
11) and `SHEET_SOLVE_PER_UNIT` (`shared/study/sheetPrice.ts`; a unit test
pins the two together) change.

**Not in O6:** the client (O7, below); the A1 e2e (O8, below); similar
questions (O9-O12).

## Release A1 in the app (O7; `VITE_STUDY_SHEETS_FORMS`)

The flag needs release A0's (`VITE_STUDY_SHEETS`, so past exams, courses and
practice) and section O 2 (`requiredSchema`: `O: 2`). Without it nothing
below shows: a sheet is read by the exam reader, and a build without it never
asks an open or numeric item (a sheet read by the sheet reader keeps its
choice items in practice). No new SQL: O 2 is in part 11 (O5).

**The upload** sends `forms: true` for a sheet (op `exam_read`: the sheet
reader, 3-page units) with the sheet reader's usual price on the button
(`sheetReaderPriceUsd`: the synthetic 5-page sheet with its answers file
"כ-$0.40"). A past exam is read as before.

**The review** (`ExamView.tsx` reads `study_sheet_review`, the lazy
`SheetText.tsx` and `SheetEdit.tsx`):

- each item as printed: its label ("שאלה 3א"), the form's tag ("· מספרית",
  "· פתוחה"), a multi-part question's part ("סעיף ב׳ מתוך 3") with the
  shared case on each part, its lines, a pipe table as a table in a
  focusable region labelled "טבלה בשאלה 5" (it scrolls sideways on a phone),
  "[?]" as the chip "מילה לא ברורה", "[…]" as "הטקסט ארוך מדי ונחתך · כדאי
  לבדוק מול העמוד"; the sheet reader's stored exactness flags "לבדוק מול
  הדף" too;
- a numeric item's answer ("התשובה: 3 שעות") and an open item's model answer
  and rubric, each with where it came from ("מקובץ התשובות", "תשובה מוצעת ·
  לא נבדקה", "נבדקה ע״י שוהם"); "פתרון מלא" (the worked solution, its origin,
  a numeric item's tolerance); "לאשר" confirms a suggested number or model
  answer; "לתקן תשובה" (`study_item_solution`): the number, unit and
  tolerance, the model answer and up to 6 rubric points, a worked solution;
  a choice item's worked solution through "⋯ עוד";
- "⋯ עוד": "לתקן את השאלה" (the edit sheet: label, form, case text, question,
  options up to 10 for one answer and 6 for true/false and match, moved,
  removed and added, a match item's rows, up to 4 figure boxes; only what
  changed is sent to `study_exam_item_fix`; once anyone answered or marked
  the item, the form and the number of options are locked: "כבר ענו על
  השאלה: אפשר לתקן רק טקסט."), "לסמן איור" (the same sheet on its figures:
  "לסמן על העמוד" opens the page with the "לסמן" toggle, a drag draws a
  box, with it off the page scrolls and zooms; "כל העמוד כאיור" takes the
  whole page in one tap, the way with a screen reader; "להסיר"), "להוציא את
  השאלה" (asked first: "להוציא את שאלה 10 מהדף?");
- "לתקן טקסט" saves through the fix, keeping the lines and any length;
- under the list "+ להוסיף שאלה שלא הועתקה" (the edit sheet with a page,
  `study_exam_item_add`) and the items taken out ("שאלה אחת הוצאה מהדף"),
  each with who took it out and "להחזיר" (by anyone within 24 hours, then
  only by whoever took it out);
- a ready past exam, or a release A0 sheet, with open questions skipped:
  "להעתיק גם 2 שאלות פתוחות · כ-$0.58" on the mock (the price from the op's dry run;
  fresh links; the upload stays ready, "מעתיקים גם את השאלות הפתוחות… 1/2",
  then "הועתקו גם 2 שאלות פתוחות.");
- a sheet the budget held (D23: reading, error `budget`): "נעצר: נגמר
  התקציב החודשי.", what was copied, "להמשיך" (refused while the lines are
  spent: "התקציב החודשי עוד לא מספיק להמשך…") and "לסיים בלי תשובות מוצעות"
  (the held solve units dropped; the items keep no suggested answer and can
  be keyed by hand).

**Practice "כמו בדף"** (`PracticeSession.tsx`, the lazy `SheetAnswer.tsx`):
an uploaded item shows its label ("שאלה 3א") and a part its line ("סעיף ב׳
מתוך 3"), the case folded ("המקרה (להראות)") once the part before was
answered; a choice item with lines or a table shows them as printed.

- Numeric: one field, "התשובה (שעות)" with the unit as a fixed suffix,
  `inputmode="text"` (iOS's decimal pad has no minus), `enterkeyhint="done"`;
  "," or "." as the point, "-" or "−", "1.2e-3" and "1.2×10^-3"
  (`numericParse`). "לבדוק" in the bottom bar (as every question's) calls
  `study_answer_value`: "✓ נכון · 3 שעות" or "✗ התשובה: 200 מ״ג", the
  answer a `study_answers` row with its value (OD7), and "פתרון מלא" with
  "בטווח של ±1%". "לא יודעים" sends no number.
- Open: "התשובה שלך" (placeholder "לכתוב תשובה (נשאר במכשיר)"), a draft
  per item in `localStorage` (inside try/catch; it survives a reload or a
  lock, is never sent, and is cleared once marked); "להראות פתרון" in the
  bottom bar (`study_open_show`) shows what was written, the model answer,
  the rubric and "פתרון מלא"; "איך הלך?" צדקתי · חלקית · טעיתי (a radio
  group, `study_open_mark`): the member's own mark, never an answer row,
  and the round's score leaves it out (OD8).
- No network during "לבדוק" or "להראות פתרון": "אין חיבור · התשובה נשארת כאן
  · לנסות שוב". In "מצב מבחן" an open or numeric item whose clock runs out is
  a miss of the round, with no row.
- A topic session (`t.<topic>`) and every group-wide list draw only the
  choice forms and never a similar question (`plainOnly`, design D15: the
  client's side of `study_private.q_plain`).

**The lecture page's row** (`SheetsLecture.tsx`, lazy through the slot
`features/sheets.tsx`, with its own boundary): "דפי תרגילים של ההרצאה", the
sheets uploaded with the lecture (each a link to its review; "· מעתיקים…"
while read), "עוד אין דף תרגילים להרצאה הזו." and "+ העלאת דף תרגילים"
(`?v=exams&new=sheet&c=<course>&l=<lecture>`). Nothing while the lecture
has no course on the course pages.

**Help**: "מבחנים ותרגילים" gains two lines (how open and numeric questions
are answered; what "⋯ עוד" fixes, open-add and the pause); the review's
guide gains "⋯ עוד" and "+ להוסיף", and the guide never presses the new
buttons that change things for the group or spend.

**Bundle**: O's static share of the entry chunk is 1,167 B of its 1,500
(the slot module with the lecture row's condition); the entry chunk is
405,524 B of 410,000 with every flag on, 4,476 B free (at least 1,500 B are
kept for the models package). Everything else of A1 is in lazy chunks.

**Fixed on the way** (the A1 e2e found it): on a computer, dragging over the
page's picture started the browser's own image drag, which cancelled the box
being drawn (the picture is now not draggable).

## The A1 e2e (O8)

On the shared mock, the synthetic sheet only. Build set `o` (set `o0`'s
flags with `VITE_STUDY_SHEETS_FORMS`), then (`NODE_PATH=$(npm root -g)`):

```
E2E_FLAGS=o  node e2e/study/sheets-forms.cjs <dist-o>  <out>   # release A1, every step below
E2E_FLAGS=o0 node e2e/study/sheets-forms.cjs <dist-o0> <out>   # without the flag: nothing of it
E2E_FLAGS=ps node e2e/study/sheets-forms.cjs <dist-ps> <out>
E2E_FLAGS=o0 node e2e/study/sheets.cjs       <dist-o0> <out>   # release A0, unchanged
E2E_FLAGS=o  node e2e/study/devices.cjs      <dist-o>  <out>
E2E_FLAGS=o  node e2e/study/wide.cjs         <dist-o>  <out>
E2E_FLAGS=s2 node e2e/study/exams.cjs        <dist-s2> <out>   # past exams, unchanged
```

**`e2e/study/sheets-forms.cjs`** (set `o`), in order:

1. Help: open and numeric answers, "⋯ עוד", the pause.
2. The lecture page's row, empty; "+ העלאת דף תרגילים" opens the upload as
   a sheet with the lecture and its course.
3. The upload (the cover left out, the answers file) sends `forms: true`
   with the sheet reader's price; the review has all 11 printed items (the
   8-option one too, nothing skipped), labels as printed with the forms'
   tags; item 5's table is a table with its header in a focusable labelled
   region; 3ב says "סעיף ב׳ מתוך 3", carries the case, its answer "3 שעות
   · מקובץ התשובות" and its worked solution; item 8's model answer and its 3
   rubric points; item 9's 8 options.
4. "⋯ עוד": the edit sheet's five forms; the question's lines kept and an
   option added (only what changed is sent; logged); "כל העמוד כאיור" in one
   tap; "לתקן תשובה" sets item 4's tolerance (origin member, "נבדקה ע״י
   שוהם"); "+ להוסיף שאלה שלא הועתקה" adds open item 10; "להוציא את
   השאלה" asks, takes it out, and "להחזיר" brings it back; at 1440 a box is
   drawn on the page with "לסמן" and saved. The lecture page's row then
   lists the sheet.
5. "לתרגל כמו בדף": 3ב with its part line and folded case, "3,0" → "✓ נכון ·
   3 שעות" and an answer row with value 3; item 4 "−200" → "✗ התשובה: 200
   מ״ג" (value -200); 3ג's draft survives a reload and is never sent,
   "להראות פתרון" shows the rubric, "צדקתי" is an open mark and no answer
   row; item 5's table in practice; the choice items answered "לא יודעים".
6. Open-add on a past exam read by the exam reader (`db.examsMock.seedRead`):
   the dry price "להעתיק גם 2 שאלות פתוחות · כ-$…", the exam ready all along
   while its open and numeric items are copied, then "הועתקו גם 2 שאלות
   פתוחות." and no button.
7. The budget pause (`db.sheetsMock.seed({forms, keySource: "none", pause})`):
   "נעצר: נגמר התקציב החודשי.", "להמשיך" refused while the line is spent,
   "לסיים בלי תשובות מוצעות" (resume with `skipSolve`) and the review.
8. A topic session with a choice item and two copied open and numeric items
   asks the choice item only ("1/1").
9. No sideways scroll at 320, 390, 820 and 1440 px, light and dark (the
   review, practice's numeric and open items, the paused card), and the a11y
   check on every screen (the primary action in the bottom bar, 44 px hit
   areas, contrast). `problems: []`, `a11y: []`.

Without the flag (`o0`, `ps`): the lecture page has no row, practising a
sheet read by the sheet reader asks its choice items only, and no upload
sends `forms`.

**The mock** (`mocks/exams.cjs`, `mocks/sheets.cjs`) plays section O 2 as
the SQL does: op `exam_read`'s `forms` (3-page units saving the fixture's
`truth` by label, the answers file by label, solve units of 4), `open_add`
(dry and real; `extra` units that keep the upload ready) and `resume`; the
lever `pauseSolve` holds a sheet's solve unit for the budget; the member's
RPCs of O 2 (above). `db.sheetsMock.seed({ forms, pause })` and
`db.examsMock.seedRead()` give ready screens without an upload.

What the e2e does not reach, and where it is tested instead: the quiz, the
meeting, the boss and Today never drawing an open or numeric item are the
SQL's (`study_private.q_plain`, O5's tests in `supabase/tests/study.sql`);
the server's refusals for a fix (`answered`, `label taken`) are the SQL
tests' and the mock's; the op's prices and gates are `server/study/sheets.test.ts`.

## Stopping and rolling back (release A0)

| Switch off (`update study_private.features set enabled = false, changed_at = now() where name = '…'`) | Stops at once |
|---|---|
| `sheets` | new sheets (`study_sheet_create` is `off`); the op `exam_read`'s sheet starts (403 `off`) |
| `exams` | everything of past exams and sheets |

Rolling back, in order: the switch `sheets` off; hide the sheets
(`update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null`,
reversible by clearing it); then the flag off in Vercel and a redeploy. The
columns stay (they are harmless to old code).

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
| B (O9, O10) | The SQL (O 3: twins, runs and their jobs, the sheet's set in section L, R's `similar_ready`; E and F in place) and the server (the similar job, op `similar`, `/api/study/work {similar}`, the $5 line) | `VITE_STUDY_SIMILAR` (the client's, O11) | O 3 | Built (part 12; parts 1, 7 and 10 changed in place) |
| B (O11, O12) | The client: "עוד שאלות כמוה" after a wrong answer, "שאלות דומות לכל הדף" at the end of a sheet and in the review's "⋯", the twins in the sheet's set, the twin's chip, the words of `similar_ready`; its e2e (`e2e/study/similar.cjs`, flag set `os`) | `VITE_STUDY_SIMILAR` | O 3 (and L 1) | Built |
| Fixes (27 Nov) | The three reviews' fixes: a sheet's hold on the $6 line, the second check before solving, the retry, a numeric twin in a set's round, a similar job claimed again, the screens' findings ("The reviews' fixes" below) | the same three | O 1, O 2, O 3 (parts 11 and 12) | Built |

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
the README say 11 parts; since O 3, 12: "SQL section O 3" below). Its tests
are section O of `supabase/tests/study.sql`.

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
spend. (Since the reviews' fixes the line also counts what sheets still
reading may spend: each holds its worst case, "The reviews' fixes" below.)

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
  and 24 with them, against release A0's 24 and 40; since the reviews' fixes
  the start holds less, `sheetHoldUsd`: 19 and 36 pages) must fit the sheets line
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

## SQL section O 3 (release B; O9)

After O 2 in section O, in **part 12**: with O 3, part 11 would be 177 KB,
over the SQL editor's 170 KB, so `tools/sql-parts.mjs` cuts section O at its
own line `-- ════ SECTION O CONTINUES · O 3 …` (`STARTS` gains `"O 3"`; part
11 is O 1 and O 2 as before, 118 KB; part 12 is O 3, 61 KB; the tests, the
parts' headers and the README say 12 parts). A check at O 3's start stops
part 12 with "section O 3 needs part 11 run first" when section O is not at
2. Registry `('O', 3)`. Its tests are block O3 of `supabase/tests/study.sql`
and `supabase/tests/similar-concurrency.sh`.

**In place in other sections** (so release B runs **parts 1 to 12**):

| Section (part) | Edit |
|---|---|
| F (part 1) and L (part 10) | `study_private.kind_on`: `when p_kind = 'similar' then study_private.feature_on('similar')`, in both texts (a unit test keeps them the same). With no row for the switch (before O 3) it is true, so harmless |
| E (part 7) | The source check is replaced only while it lacks `'member'`; it was dropped and added again on every run, which would fail once twin rows exist. O 3 widens it by `'twin'` and a later run of part 7 keeps it |

**A similar question ("a twin")** is a `study_questions` row with source
`twin`: `from_exam` the sheet (on delete cascade), `twin_of` the root's part
(on delete set null: a twin whose root was removed stays with its sheet),
`twin_check` (`recalc`, `blind`, `slides`), no `exam_id`, no `lecture_id`, no
`exam_no`; its sheet's lecture as `ref_lecture`, the root's topic, aspect and
difficulty, the requester as `created_by`. A twin of a question with parts
has parts of its own (a new `series`, `step` 1-12), each the twin of its
root's part. Its key is origin `twin` at confidence 3 with its worked
solution (origin `twin`). Answers to twins go to `study_answers` like any
practice answer (OD7). Since a twin has no `exam_id`, S's and O's readers of
an upload (`s=e.`, the review, `exam_advance`, the simulation) never see it,
and `q_plain` keeps it out of the group's pickers (O 2).

| Check | O 3 |
|---|---|
| `study_questions_source_check` | + `twin` (replaced only while it lacks it) |
| Q's inline "an exam item, or a lecture's" and "only an exam item names a lecture to read" | found by their definitions, replaced by `study_questions_lecture_x` and `study_questions_ref_x`: source `exam` or `twin` |
| `study_questions_twin_x` | a twin has its sheet and a check, no exam, lecture or number; only a twin has `from_exam` or a check |
| `study_question_keys_origin_x`, `study_question_keys_sheet_x` | + `twin` for the key's and the solution's origin |

**Tables.** `public.study_similar_runs` (members of the group read it; no
writes): the sheet, scope `item` or `sheet`, the roots in printed order
(1-24), twins a root (1-2), status (`running`, `done`, `failed`, `stopped`),
made, dropped, `skipped_figs`, error, the member's reservation
(`reserve_id`, `reserved_usd`), `charged_usd`, the sheet's set (`set_id`),
the requester. Private, no grants: `study_private.similar_jobs` (a run's
jobs, 1-8 roots each, with a 330-second lease, 4 attempts and
`study_finish_similar_job`'s retry times, as exam units) and
`study_private.similar_queue` (a running run's kicks and the pages' fresh
links, D24, kept here so the members' run row never carries signed links;
48 hours at most). The switch **`similar`**, inserted off.

**Which items get similar questions** (`study_private.similar_ok`): a live
item of a **sheet** (past exams are not offered: their twins would have no
sheet set; a later decision), every part of it a choice form (`one`, `tf`,
`match`, `order`; never `tap`, whose pins belong to its picture) or
`numeric`, keyed (a number for a numeric part), and not keyed only by a
model's guess under confidence 3 (it counts in no score, so nothing is built
on it). Never an open item. The root of anything is the first part of its
question; a twin's root is its source's. At most **6 twins a root**
(`similar_count`: a twin with parts counts once).

**The RPCs** (each `exam not found` for a stranger, a deleted sheet or not
a sheet; `off` while `exams`, `sheets` or `similar` is off):

- `study_similar_plan(p_exam, p_question, p_scope)` (member, read only):
  item: the root, its label, form, parts and numeric parts, the twins it has
  (free to practise), the room left, a run making it now (`joined`), its
  figures' pages; sheet: up to 24 roots without a twin in printed order
  (`items`, and each root's shape in `roots` for the price), how many more,
  whether a run of the whole sheet ran today, a run making it now, the
  pages. `question not found`, `not eligible`.
- `study_similar_begin(p_exam, p_items, p_scope, p_per, p_reserve, p_worst,
  p_cap, p_urls, p_until, p_key)` (the op: the member's token and the server
  key): the reservation must be the caller's, of kind `similar`, open (`bad
  reserve`); the links must be the sheet's pages (`bad urls`). Under **one
  lock a sheet** (`similar:<sheet>`) it decides: an item: a run making this
  root now → `{joined}`; 6 already → `max`; else up to 2 twins (fewer when
  fewer fit). The whole sheet: a run of it making now → `{joined}`; one today
  that did not fail empty → `today`; the roots of `p_items` still without a
  twin (≤ 24) or `nothing to make`. Then under the group's budget lock (the
  one `study_reserve` takes): this month's `similar` spend (every other run's
  reservation included) plus this worst case within `p_cap`
  (`STUDY_SIMILAR_MONTHLY_USD`) or `similar_cap`. The run, its jobs
  (`study_private.similar_job_roots()` = **4** roots a job, the sheet
  solver's measured unit; an item's run is one job), its links, and the
  sheet's practice set: section L's set of kind `sheet` for this sheet, made
  by the first run through `qset_for_similar` ("שאלות דומות · {sheet}"), and
  the kick. `{run_id, set_id, jobs, items, per, server}`.
- `study_claim_similar(p_run, p_key)` (the worker with the key alone; the
  phone's fallback with the member's token): null when a switch is off, the
  sheet was deleted, the run is over or fully charged, or the group runs its
  three already (`group_live` now counts similar jobs with a live lease, so
  summaries, exams and similar questions share the three, two while a
  lecture waits). Returns the job, the run's money (reserved, charged, left),
  the sheet, its lecture's slides (for the slides' check), and each root with
  its parts, key, solution, figures, the figures' pages with the run's links
  while they are good for 10 more minutes, and its twins' stems.
- `study_similar_charge(p_job, p_lease, p_model, p_usage, p_cost,
  p_next_worst, p_key)` (worker): one model call, a **settled** `similar` row
  (ref `unit`) in the **requester's** name (their 40% share and the similar
  line count it); the reservation drops by as much, so the two never pass
  what was reserved; false when the next call's worst case no longer fits.
- `study_similar_save(p_job, p_lease, p_twins, p_dropped, p_skipped,
  p_model, p_key)` (worker): under the sheet's lock, each twin of a root of
  this job that keeps its root's form, option and prompt counts, parts and a
  fitting key, and whose root is still under 6; the rest are dropped. Then
  `qset_add_items` (the set's size grows with it). `{saved, dropped}`.
- `study_finish_similar_job(p_job, p_lease, p_status, p_error, p_key)`
  (worker): as `study_finish_exam_job`; then the run moves on
  (`similar_advance`): when nothing of it will run, its status (done;
  `stopped` by a switch, the reservation, a deleted sheet or a day gone by;
  failed when nothing was made and a job failed), its reservation settled at
  **$0** (every real cost is in its charge rows), its links gone, its set made
  ready through `qset_similar_done` (the set's one `set_shared` to the group,
  L's), or soft-deleted when this run made the set and nothing came. A
  whole-sheet run that made something tells its requester: R's
  **`similar_ready`** (`mine`, pushed, held 90 s; registered again here,
  guarded), route `{v: sets, k: <set>}`, args `{k: made, kind: sheet,
  course}`. An item's run sends no notice (the member is in the session).
- `study_similar_of(p_question)` (member): the twins of an item's root (from
  the item, a part or a twin), no keys, hidden when the sheet was deleted or
  the twin retired or hidden; the room left and a run making some now.
- `study_private.similar_dispatch()`: its own cron job
  **`study-similar-dispatch`** (every minute; S's `study-exam-dispatch` is
  untouched). Kicks `/api/study/work {similar: <run>}` for jobs the caps
  allow (2 minutes between the sweeper's kicks, none after 15 unclaimed);
  with a switch off, a deleted sheet or a run older than a day it stops what
  holds no live lease, so the reservation is let go.

The words of the refusals a member can meet are in
`src/study/lib/similarCopy.ts` (lazy; `similarFail`), for the client's
screens (O11).

**Tests.** `supabase/tests/study.sql` block O3 (26 checks: the shape and the
widened checks, the plan, the start and its refusals, joining, members-only
reads, the claim, the charge, the save, twins out of the upload's reads and
the pickers, a twin answered, the finish at $0 and the set, the whole sheet
once a day with `similar_ready`, six a root, the switch, a lost job, a
deleted sheet, E's block run again with twins present, the sheet removed
with its twins); an upgrade run with twins, a run and their keys in the
database before parts 1 to 12 run twice (the checks stay widened; an ai
question without a lecture and a twin without its sheet are still refused);
`similar-concurrency.sh`: four taps on one item at once (10 rounds: one run,
three joined) and an item's tap beside the whole sheet's (10 rounds, no
deadlock).

## Similar questions on the server (O10)

`server/study/similarGen.ts`, `server/study/ops/similar.ts`; `prompts/sheets.ts`
(`SIMILAR_SYSTEM`, `BLIND_SYSTEM`), `questions.ts` (their schemas),
`budget.ts`, `study.ts`, `solver.ts` and `api/study/{ai,work}.ts` changed. The
model is the current default (`SIMILAR_MODEL = MODEL`, OD17); no provider is
refused (OD5 as Yoad changed it); the models package (Y) routes the key
`similar` later.

**The money (D20, OD3, OD20).** `POLICY.similar`: the 80% line, 40% a
member, **10 taps a day** (ref `ask`). The op reserves a run's **whole worst
case** under the member (`similarWorstUsd`, shared with the phone: per job,
the writing call and the check at all of their max_tokens, every root as
long as a root gets, the figures' pages and the lecture's slides when the
sheet has one; 2 twins of an item about $0.19, 14 roots about $1.2, the
24-root cap about $2.0, or $2.7 with a figure on every root and a
60,000-character deck),
and `study_similar_begin` checks it against the similar line,
**`STUDY_SIMILAR_MONTHLY_USD`, $5 by default** (`similarMonthlyCap`). The
worker reserves nothing: each call is charged against the run, and before
each call its worst case must fit what the run has left. The usual price on
the button (`similarPriceUsd`): about $0.07 for 2 twins of an item, about
$0.47 for a whole sheet of 14 roots, $0.80 for 24 (the design's $0.08,
$0.52 and $0.89).

**A job** (`runSimilarJob`):

1. One call writes the twins of the job's roots (`SIMILAR_SYSTEM`, cached;
   the course, twins a root, each root with its key, its worked solution, its
   existing twins' stems, and its figure's page as a picture). A root whose
   figure has no fresh link is left out (counted in `skipped_figs`).
   max_tokens 1,500 + 2,000 a twin part, at most 14,000.
2. Pure checks (`toTwins`): the root's form, option and prompt counts and
   parts kept, distinct options, a key that fits its form (a one-answer
   index, true/false 0/1 a statement, a match's distinct options, an order's
   permutation), a numeric part's number **recomputed** from its working
   (`calc.ts`, within its tolerance, at least 0.5%), and not too close to the
   root (trigram similarity 0.8) or to another twin of it (0.7). At most the
   run's twins a root. A twin of numeric parts only is checked (`recalc`).
3. One check for the twins with a choice part, answered again **without the
   key**: the slides' solver (`solveQuestions`, kind `similar`) when the sheet
   has a lecture with slides and no twin reuses a figure (`slides`), else
   `BLIND_SYSTEM` with the figures' pages (`blind`: every choice part with its
   key at confidence 2 or more). A twin is kept only when every part passes;
   a twin the check never reached is dropped, never saved unchecked.
4. `study_similar_save`, then `study_finish_similar_job`. When the charge
   says the check would not fit, the numeric twins are saved and the rest
   dropped (`reserve_used`).

**Op `similar`** (`/api/study/ai`): `plan` (the plan, the price and the worst
case; nothing reserved); `start` (the default): a run making them now →
`{joined}`; an item with twins already → `{twins}` ($0, practise those
first) unless `make: true`; `max`, `today` and `nothing to make` as 409
before anything is reserved; then the reservation and the start (any
refusal there settles the reservation at $0), 202 `{runId, setId, jobs,
items, per, priceUsd, worstUsd, server}`; `unit` (the phone's fallback with
the member's token when `server` is false). The section need is
`VARIANT_SCHEMA.similar` (O 3, L 1; the router reads it by the op's name).
**`/api/study/work {similar: <run>}`** claims with the key alone, answers
202 and runs the run's jobs one after another until 200 s (a job starts
only with at least 2 minutes left).

**Tests** (`npm run test:study`): `similarGen.test.ts` (the prompts' lengths
and the job size pinned to the shared numbers and the SQL; the policy and
the line; the price and the worst case; `toTwins` for every form, the
recompute, the closeness guards, parts; the blind check's request and
verdicts; the writing call's figures; a job end to end against mocks of
Supabase and the API, the spent-run and slides paths; the op's reservation,
`{twins}`, `{joined}`, a refusal settled at $0, 503 before O 3),
`solver.test.ts` (kind `similar`), `work.test.ts` (`{similar}`).

**Known gap, accepted:** a charge that fails twice (the database
unreachable) ends the job `unsettled`; that call's cost stays only in the
run's reservation, which is settled at $0 when the run ends, so the ledger
misses it (as a failed settle leaves an estimate elsewhere, budget.ts).

**Not in O9-O10:** the client (O11: the flag `VITE_STUDY_SIMILAR` with
`requiredSchema` O 3 and L 1, the bottom sheet after a wrong answer, the
end-of-sheet offer, the twin's chip and peek, the words of `similar_ready`
in `notifyCopy.ts`, which keeps it reserved until then) and its e2e (O12,
flag set `os` on L's `ps`). L's set loader does not yet hide the items of a
soft-deleted sheet (requested from L in design §15; `study_similar_of`
does).

## Release B in the app (O11; `VITE_STUDY_SIMILAR`)

`src/study/components/SimilarSheet.tsx` (lazy), `src/study/lib/similar.ts`
(lazy), the words in `src/study/lib/similarCopy.ts`, `styles/similar.css`;
`PracticeSession.tsx`, `ExamView.tsx`, `practiceSession.ts`,
`questionColumns.ts`, `sheetForms.ts`, `helpCopy.ts`, `shared/study/flags.ts`
and `shared/study/notifyCopy.ts` changed.

**The flag** `VITE_STUDY_SIMILAR` (`flags.similar`) needs release A1
(`VITE_STUDY_SHEETS_FORMS`) and practice sets' shelf (`VITE_STUDY_MAKE`,
`VITE_STUDY_SETS`), and asks for **section O 3 with L 1**
(`requiredSchema`); it changes nothing else (`route.test.ts`). No new SQL:
release B is O 3 (part 12, with the in-place edits in parts 1, 7 and 10).

**After a wrong answer** (design §5.10) to an item of a **sheet** (its kind
from the review, `sheetInfo`) or to a twin, in a round that is not "מצב
מבחן" (and, in a set's round, only the sheet's own set: an answer to a twin
that is not in the set would be "not in set"), a row under the question asks
the op's **plan** (nothing reserved; an open item, one without a sure key, a
past exam's item or the switch off show nothing):

- the twins the item's root has and the round does not: "{n} שאלות דומות ·
  לתרגל", free, asked **right after the question on screen**
  (`practiceSession.insertNext`);
- "עוד שאלות כמוה" (while the root has room under its 6): a bottom sheet,
  "שאלות כמו שאלה {label}", "אותו נושא ואותה רמה, מקרה חדש.", and "ליצור 2
  כמוה · כ-$…" (the op's usual price; one when only one fits). The start
  sends `make: true` and the fresh links of the root's figure pages (D24);
  the op reserves, starts, and the row says "יוצרים 2 שאלות ובודקים אותן… ·
  אפשר להמשיך לתרגל" (not announced). The run's row (`study_similar_runs`)
  is read every 3 seconds while it runs and the screen is seen; its end is
  the **one polite line** ("נוצרה שאלה אחת · אחת לא עברה בדיקה", "הפעם אף
  שאלה לא עברה בדיקה … · עלה כ-$…", skipped figures), and its twins are
  asked right after the question ("לתרגל עכשיו"). A run of the same root
  already making them is **joined** ("כבר מכינים שאלות כמו זו"), nothing
  reserved. The run's id is kept per root in `sessionStorage`, so a lock or
  an app switch comes back to its result. When the server cannot write, the
  phone drives the run's job (action `unit`) while the screen is open.
- A refusal is one line in `similarFail`'s words (the similar line, 10 taps
  a day, 6 a root, the switch).

**The whole sheet** (design §5.11, OD11, OD12): at the end of a sheet's
round (`s=e.`) and in the review's new **"⋯"** in the head (a bottom sheet,
"עוד פעולות לדף"; the head's "⋯" O7 left for this), never at the top of the
review: "שאלות דומות לכל הדף · כ-$…", "שאלה דומה אחת לכל שאלה ({n}). זה
לוקח כמה דקות; אפשר לסגור." (or the first 24 without one), "הן יופיעו
ב״סטים של הקבוצה״, לכל הקבוצה."; once started, its progress and then
"נוצרו {n} שאלות דומות · לפתור" to the sheet's set (`?v=sets&k=`, L's set
page with its author line). Once a day: "היום כבר נוצרו שאלות דומות לדף
הזה · לתרגל אותן", to the set. With the switch off the round's end shows
nothing; the "⋯" says "שאלות דומות עוד לא פתוחות בקבוצה.".

**Twins in practice:** a twin keeps its source's printed order, shown and
after the answer (D10: `orderFor` and `keepPrinted` take source `twin`); a
twin reusing a figure draws it from its sheet's page (`from_exam`, read with
the flag only); its chip "דומה לשאלה {label} ב{title} · נבדקה" opens a
read-only peek at the source question ("השאלה המקורית", "סגירה"). The
twins live in the sheet's set on "סטים של הקבוצה" (L's shelf and set page
draw a set of kind `sheet` as any set); a group-wide list never draws a twin
(`plainOnly`, O7).

**The notice:** R's `similar_ready` has its words: "השאלות הדומות מוכנות",
the course, the count and "אפשר לפתור מ״סטים של הקבוצה״; the lock screen
shows the course only (never the sheet's title or a name).

**Bundle:** the entry chunk is 405,754 B of 410,000 with every flag on
(`SIMILAR` included; 4,246 B free, at least 1,500 kept for the models
package); O's own share is unchanged at 1,167 B of its 1,500: everything of
release B loads lazily (the flag's row is the shell's).

**Known gaps, accepted:**
- ~~A numeric twin answered in its set's round is not stamped on the set's
  attempt~~: fixed by the reviews (`study_qset_answer_value`).
- The design's "נשאר החודש לשאלות דומות: $…" (under $2 left) is not shown:
  members have no read of the similar line; a tap over it is refused with
  "התקציב לשאלות דומות נגמר החודש".
- L's set loader does not hide the items of a soft-deleted sheet (O10's
  note); `study_similar_of`, the chip and the offer do.

**Fixed on the way:** a sheet's item with a figure in a round opened
straight from a link drew its page crop without the crop's rules (they came
only with the review's style sheet): 1,525 px wide on a phone. The session
loads `exams.css` itself now.

## The B e2e (O12)

`e2e/study/similar.cjs` on the shared mock with the synthetic sheet only;
`mocks/similar.cjs` plays study_similar_plan, study_similar_of, the members'
read of `study_similar_runs` and the op `similar` (plan, start, unit) with
O 3's rules (roots and their 6, existing twins first, joined, once a day,
the line, the switch), and the worker's job (twins with `from_exam`, the
check's drops, the sheet's set in L made ready with its one `set_shared`,
the requester's `similar_ready`). Flag set **`os`** in `e2e/study/mock.cjs`
(`o` with `VITE_STUDY_SIMILAR`; L's `ps` is under `o`), in `SQL_SETS` and
the list.

Covered (42 checks on `os`): help's row; a wrong answer's offer, its sheet
and price, the start's `make: true`, the run in the requester's name, the
running line (not live) and the result line (polite), one of two dropped,
the twin asked next with its printed order, chip and peek; joining another
member's run; existing twins first for another member ($0, no start); the
refusals (the similar line, 10 a day, 6 a root, the switch off); the whole
sheet at a round's end (one each for the roots without a twin), its set
ready on the shelf with its title and author, `similar_ready` to the set
and the group's `set_shared`; solving the set (the chip, more after a wrong
answer); the review's "⋯" once a day. 320, 390, 820 and 1440 px, light and
dark, no sideways scroll; the a11y check on every screen. On `o` nothing of
it shows (5 checks). `problems: []`, `a11y: []` on both.

Run with: `NODE_PATH=$(npm root -g) E2E_FLAGS=os node e2e/study/similar.cjs <dist-os> <out>`
(a build with the flag sets' variables, as the other scripts). Also run for
this package: `exams.cjs` (s2), `sheets.cjs` (o0) and `sets-b.cjs` (ps)
pass; `sheets-forms.cjs` (o) stops at its desktop box drawing ("לשמור" of
the edit sheet not found after the drag) **at the commit before O11 too**
(`1d12f57`, the same build and script), a timing-dependent failure O10's
first run also met; not changed here.

## The reviews' fixes (27 Nov 2026)

Three reviews (correctness; security, privacy and cost; UX) read `dev` from
`4b9b832` to `3793e68`. What changed, by finding; the decisions are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Uploaded sheets, the
reviews' fixes"). Only parts 11 and 12 changed (section O): the release steps
are the same ("parts 1 to 12 in order").

### The hold: the $6 line counts what sheets still reading may spend

Before, `study_sheet_room` summed `exam_jobs.cost_usd`, which a unit writes
when it finishes: every sheet started before the first one's units finished
saw the line nearly empty, so three 15-page sheets could each pass a line of
$6 with about $4 each at worst. Now:

- **A sheet holds its worst case** (`study_private.sheet_holds`, O 1). The op
  `exam_read` takes it through `study_sheet_hold` (the worker's key and the
  member's token) after the bounds and before the start, **under the group's
  budget lock** (`study_budget:<group>`, the lock `study_reserve` and
  `study_similar_begin` take), so two starts at the same instant never both
  pass (`supabase/tests/sheet-hold-concurrency.sh`: three $4 sheets at once,
  one holds, two get `sheets_cap`, 10 rounds of 10). A start that fails after
  the hold drops it; one that never starts stops counting after 30 minutes.
- **What counts on the line** (`study_private.sheets_used`): this month's
  cost of every sheet's units, plus what is left of each hold that still
  counts (its worst case less what the sheet spent since; only while the
  sheet has a unit that will run, or is uploading). A sheet held by the
  budget (D23), finished, failed or deleted counts only what it cost.
- **The start's hold** (`sheetHoldUsd`, shared/study/sheetPrice.ts): the read
  and key units at their worst case (every unit at all of `max_tokens`, every
  page as full as a page gets) and the **usual** item count solved at its
  worst (3 items a page without answers, 0.75 with them: the price's count).
  The full worst case assumed 8 items a page and refused any sheet without
  answers over 9 pages (the review's S4).
- **The second check, before solving** (O 2's `exam_advance`): when reading
  is done and the solve units are queued, their worst case with the **real**
  item count (`ceil(items / 4)` units × one unit's worst case, the hold's
  `solve_sheet` / `solve_exam`, `solveUnitWorstUsd`) is checked against the
  line again, under the same lock. It fits: it is the sheet's hold now. It
  does not: the solve units wait as the budget would hold them (D23): the
  sheet says "נעצר: נגמר התקציב החודשי.", "לסיים בלי תשובות מוצעות" keeps the
  copy without suggested answers, "להמשיך" checks the line once more.
- **A sheet never spends past its hold by more than one unit**: O 2's claim
  takes no unit of a sheet that spent its hold (a unit paid twice, a retry
  of a truncated unit, a page read again); its units wait (D23) and
  "להמשיך" takes a new hold first (`heldWorstUsd`).
- **"לנסות שוב"** (`study_exam_retry`, redefined in O 2): a sheet's units the
  budget holds are not restarted (`paused`: the phone offers "להמשיך"), the
  switch `sheets` is checked, and what a retry spends stays within the hold.
- **A page's PDF lines** sent to the reader are cut at 4,000 characters
  (`capPageLines`, the worst case's page; the exactness check still has
  them all), for both readers of a sheet (a past exam's pages as before).

What fits under $6 now, on the current default model (the hold; the full
worst case for comparison; the usual price on the button):

| Sheet (sheet reader) | Hold | Full worst case | Usual |
|---|---|---|---|
| 5 pages, no answers | $1.58 | $3.13 | $0.58 |
| 10 pages, no answers | $3.20 | $6.30 (was refused) | $1.18 |
| 18 pages, no answers | $5.42 | $11.02 | $2.11 |
| 20 pages, no answers | $6.10 (refused on a fresh month) | $12.34 | $2.35 |
| 40 pages, answers marked | $6.64 (refused) | $9.74 | $2.77 |

So a fresh month takes a sheet of up to **19 pages without answers** or **36
with them marked**; one solve unit's worst case is $0.25 (the exam reader's
20 items: $0.39). A sheet of many items that passed the start may wait before
its solving (the second check); the copy is never lost.

### The other findings

- **A numeric twin in a set's round** (C1): `study_qset_answer_value` (O 3,
  guarded on L) checks the attempt (L's `qset_attempt_open`), answers as
  `study_answer_value` does and stamps the row (L's `qset_stamp`), so the
  set's score and its group numbers count it. `PracticeSession` passes the
  round's attempt to `SheetAnswer` and starts a new one on "attempt finished"
  as for a choice. e2e: `similar.cjs` answers the set's numeric twin.
- **A similar job claimed again** (C5): `similar_jobs.done_roots` holds the
  roots its save went in for; a claim after a lost finish sends only the
  others, and a job whose roots are all done is done. A writing call that
  stopped early, or too little time for the check (45 s), keeps the numeric
  twins and retries the job (C6 a).
- **Once a day** (C6 b, S6): a run of the whole sheet uses up the day while
  it makes, or once it made something or paid for a call
  (`study_private.similar_today`).
- **A ready sheet** whose only held units are open-add's stays ready (C4).
- **Without the flags** (C7, the rollback): a course session leaves sheets
  out (`groupExams` reads the kind), and a set's or the mistakes' round
  leaves out open, numeric and twin rows a build cannot answer.
- **Hiding and the style** (S5): `study_exam_hide` refuses a sheet (it stays
  out of the profile); `study_course_style_items` takes past exams only.
- **"locked"** (S7) replaces the review's `marked`: one flag, answered or
  self-marked, so the group never learns who opened an open solution.
- **The screens** (the UX review): the "N בלי תשובה" line counts by form; the
  edit sheet's options on their own line on a phone; J / K move between
  items (the arrows only inside the list); one verb "לתקן טקסט" (the edit
  sheet with release A1; "לתקן את השאלה" is gone); the decimal pad with "−"
  and "×10ⁿ"; "→ לדף" back from a sheet's practice; "שאלה 3ב" at a round's
  end; the paused card while the line is spent ("להמשיך" disabled, "אפשר
  להמשיך מ-1 בחודש", a held unit "נעצר" with no "לנסות שוב"); a camera's file
  name is no sheet's name; page 1 drawn in a PDF's tile; "עמודים" for pages;
  the alertdialogs take the focus, as does a field the button found wrong;
  44 px controls on the new screens; a Latin title joined with a maqaf; the
  member's share in its own words; the same file not added twice; two
  sheets of one name told apart by their day; the kind and filter radios
  move with the arrows (roving tabindex).
- **Not changed** (S8): a twin whose parts are all numbers is checked by
  recomputing its own formula on its own inputs (`recalc`), not solved blind
  again: the arithmetic is what goes wrong in such a twin, and a blind solve
  would cost a call each. It is saved like the others.

## Stopping and rolling back (releases A0 to B)

| Switch off (`update study_private.features set enabled = false, changed_at = now() where name = '…'`) | Stops at once |
|---|---|
| `sheets` | new sheets (`study_sheet_create` is `off`); the op `exam_read`'s sheet starts (403 `off`) |
| `exams` | everything of past exams and sheets |
| `similar` (O 3) | new runs (`study_similar_begin` and the op: `off`), every reservation of kind `similar` (`kind_on`), and the claims of jobs; the sweeper then stops every waiting run (`stopped`, its reservation let go). A model call already running ends (≤ 200 s) and its job stops |

A build without the flags reads no sheet item: the course's sessions leave
sheets out, and sets' and mistakes' rounds leave out what the build cannot
answer (open, numeric, similar questions).

Rolling back, in order: the switch `sheets` off; hide the sheets
(`update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null`,
reversible by clearing it); then the flag off in Vercel and a redeploy. The
columns stay (they are harmless to old code).

Rolling back release B: the switch `similar` off (the line above), then the
client's flag `VITE_STUDY_SIMILAR` off in Vercel and a redeploy.
Twins already made stay with their sheet and in its practice set (hiding the
sheet hides its twins too, `study_similar_of`); the columns, the checks and
the tables stay (the widened checks cannot be narrowed once twin rows exist).

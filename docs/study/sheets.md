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
| A0 (O1) | The kind and one lecture of an upload, the switch `sheets`, "a new sheet", keying true/false and match items by hand, simulations of past exams only | none yet | O 1 | SQL built (part 10, after L); the app does not use it yet |
| A0 (O2-O4) | The upload (two kinds, desktop drop and paste, camera checks), the course page by kind, the wide review, hand keying in the review, the exactness flags, printed order after answering, the landing card | `VITE_STUDY_SHEETS` | O 1 | Not built yet |
| A1 (O5-O8) | The sheet reader: open, numeric and multi-part questions, tables, up to 10 options, answers files, worked solutions, edits | `VITE_STUDY_SHEETS_FORMS` | O 2 | Not built yet |
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
 where name in ('courses', 'exams', 'sheets') order by name;     -- courses true; exams ?; sheets: no row until part 10
select public.study_schema() ->> 'S' as s, public.study_schema() ->> 'O' as o;   -- 2, and null until part 10
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
L, O), in **part 10** with L: part 10 is 91 KB with O 1 (of 170 KB). If a
later version of O would take part 10 past 170 KB, O starts part 11
(`tools/sql-parts.mjs`'s `STARTS` gains `"O"`, and the tests and the README
say 11 parts). Its tests are section O of `supabase/tests/study.sql`.

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

## Stopping and rolling back (release A0)

| Switch off (`update study_private.features set enabled = false, changed_at = now() where name = '…'`) | Stops at once |
|---|---|
| `sheets` | new sheets (`study_sheet_create` is `off`); the op `exam_read`'s sheet starts (O2) |
| `exams` | everything of past exams and sheets |

Rolling back, in order: the switch `sheets` off; hide the sheets
(`update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null`,
reversible by clearing it); then the flag off in Vercel and a redeploy. The
columns stay (they are harmless to old code).

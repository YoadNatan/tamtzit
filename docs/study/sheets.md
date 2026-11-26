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
| A0 (O1) | The kind and one lecture of an upload, the switch `sheets`, "a new sheet", keying true/false and match items by hand, simulations of past exams only, the sheets line's figures (`study_sheet_room`) | `VITE_STUDY_SHEETS` | O 1 | Built (part 10, after L) |
| A0 (O2, O3) | The upload (two kinds, desktop drop and paste, camera checks, the cover page), a sheet's bounds on the server (40 pages, the $6 line, the headroom, the $3 confirmation), the course page by kind, the wide review with its page and the keyboard, hand keying in the review, the exactness flags, printed order after answering, the landing card | `VITE_STUDY_SHEETS` | O 1 | Built |
| A0 (O4) | The A0 e2e script (`e2e/study/sheets.cjs`, flag set `o`) at 320/390/820/1440, a ready sheet in the mock (`mocks/sheets.cjs`), `devices.cjs` and `wide.cjs` with the new screens, the fixes they found, the copy list, Yoad's release steps | — | — | Built |
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
`VITE_STUDY_MAKE`, `VITE_STUDY_SETS` and `VITE_STUDY_SHEETS` for set `o`; the
same without `VITE_STUDY_SHEETS` for `ps`), then, one at a time
(`NODE_PATH=$(npm root -g)`):

```
E2E_FLAGS=o  node e2e/study/sheets.cjs  <dist-o>  <out>   # release A0, every step below
E2E_FLAGS=ps node e2e/study/sheets.cjs  <dist-ps> <out>   # without the flag: nothing of it shows
E2E_FLAGS=o  node e2e/study/devices.cjs <dist-o>  <out>   # + the screens sheet-upload and sheet-review
E2E_FLAGS=o  node e2e/study/wide.cjs    <dist-o>  <out>   # + a sheet's review and upload, phone / 760+ / keys
E2E_FLAGS=s2 node e2e/study/exams.cjs   <dist-s2> <out>   # past exams, unchanged
```

**`e2e/study/sheets.cjs`** (set `o`), in order:

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
**`devices.cjs`** (set `o`) adds the screens `sheet-upload` (the PDF chosen)
and `sheet-review` (an item open) on its eight devices, with its usual checks
(sideways scroll, text under 14 px, contrast, hit areas, the Tab walk under
the bars) and that the two columns start at 760. **`wide.cjs`** (set `o`)
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

## Stopping and rolling back (release A0)

| Switch off (`update study_private.features set enabled = false, changed_at = now() where name = '…'`) | Stops at once |
|---|---|
| `sheets` | new sheets (`study_sheet_create` is `off`); the op `exam_read`'s sheet starts (403 `off`) |
| `exams` | everything of past exams and sheets |

Rolling back, in order: the switch `sheets` off; hide the sheets
(`update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null`,
reversible by clearing it); then the flag off in Vercel and a redeploy. The
columns stay (they are harmless to old code).

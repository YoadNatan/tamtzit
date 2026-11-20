# קורסים ומבחנים קודמים בתמצית: ההצעה הסופית

## Decisions (approved, 19 Nov 2026)

Yoad approved all five open decisions of Part A with the recommended defaults. Where Part A or Part B still words them as open, this block wins.

1. **Past exams (D20): yes.** Past exams may be stored for the group and sent to Claude to copy their questions. They stay inside the group, are never shared outside it, and are deleted with the course. The upload screen has **no** explanatory sentence about it. Phases 2–4 are no longer blocked on D20 (B11, B12 risk 1).
   The guidance pass (20 Nov 2026, `guide.md`) keeps this: the upload's new lines (each answer option's hint, the line above the button, its "?" mini-guide) speak of the price and the timing only, never of where the exam goes; `exams.cjs` and `guide.test.ts` check the words.
2. **Missing keys:** the app solves them and marks "תשובה מוצעת · לא נבדקה". Only a member of the group confirms a key (`key_origin='member'`); agreement between solves never does. A solved key with low confidence (`key_conf < 3`) is left out of every score (B7).
3. **Budget:** stays $33 a month, exam month included. Exams are read as soon as they are uploaded; explanations are written only when someone opens them.
4. **Simulation length:** follows the latest uploaded exam ("100 שאלות · 3 שעות"), changeable on the course page. Short (20) is shown first, then half (50), then full.
5. **The word:** "סימולציה" (in `COPY.md`; never "מבחן לתרגול" or "מבחן לדוגמה").

**Phase 0 changes:** the by-hand check of a real exam (B11, phase 0) is replaced by synthetic Hebrew exam fixtures with mocked model responses: there is no API key in the build container, so no paid call is made, and no real lecture or exam text goes into git. The prompts are tested on those fixtures; the first real exam is read in production by the group. The spec was written against dev 3049d2b and re-checked against dd7a09a before the build.

**Built so far (phase 1, part A: SQL S 1 and the server; dev, not pushed).** Decided in code, as B0's open points asked:
- The switch `courses` starts **on** (phase 1 spends nothing new; `VITE_STUDY_COURSES` shows it). The trigger keeps `study_courses` in step even while it is off; only the RPCs answer `off`.
- The backfill is `study_private.course_backfill()`, run once by the file and re-runnable (0 rows on a second run). A course is named as first written; rename and merge rewrite the text of lectures (deleted ones too), exams and every member's `study_plans.courses[]`. `study_group_plans` holds no course text, so nothing there changes.
- Errors of the course RPCs: `course not found`, `group not found`, `off`, `bad name`, `exists`, `same course`, `bad date`, `bad minutes`, `bad questions` (not `bad count`, an internal code elsewhere).
- A round over several lectures: `study_request_plan(request, plan, key)` after `study_request_create` (unchanged); after the review, the op calls `study_request_create_in_plan`, both in one transaction (below). One group, at most 5 lectures (`round full`, not `too many lectures`, which is the plan screen's internal code), at least 4 questions each (`too few questions`). The op checks both before it makes a request.
- Course ask: `{op:"ask", scope:"course", courseId}`; context.ts scores every ready paragraph of the course (not only the top parts' markdown: M in "נבחרו N מתוך M" must be every paragraph); no route call; turns signed for `course:<id>`; cites `[הרצאה n · ש׳ m]`, n the lecture's place in the course (by date, undated last).
- The batch card (`shared/study/batch.ts`): summaries wait when they pass the **cap**, not the 80% line, because the writer's kinds (`outline`, `part`) have share 1 and would run until the cap; the function takes a share if that changes.
- The needs of an op's variant live in `VARIANT_SCHEMA` (study.ts): `ask_course` {K 2, S 1}, `questions_plan` {Q 2, S 1}. OP_SCHEMA stays the spec's ops only.

**Built so far (phase 1, part B: the client; dev, not pushed).** Behind `VITE_STUDY_COURSES` (requiredSchema S 1); without it nothing changes, and `allowed()` sends each new route to the nearest one that is on (`?v=course` → the library, the batch → one lecture's upload, `?v=ask&c=` → the library's question):
- Routes: `?v=course&c=<id>(&seg=exams|lectures|made)`, `?v=upload&many=1(&c=<id>)`, `?v=ask&c=<id>`. The course page belongs to the library's tab; the batch and the course question are immersive. Back to a course says "→ לקורס".
- The library's course headings link to their pages (`study_courses_of`, matched by lower(btrim)); a course written two ways is one link. A batch that stopped half way gets a line there with "להמשיך".
- The course page (mockup course.html, phase 1's part): the head ("25 הרצאות", and the exams only with `VITE_STUDY_EXAMS`), the exam card ("המבחן ב-12.2 · עוד 23 ימים", "100 שאלות · 3 שעות"), "לתרגל מה שכבר יש · בחינם (184)" (`s=c.<name>`) as the primary action while there is no simulation, "לשאול על כל הקורס", and the lectures in the course's order. "מבחנים קודמים" is a segment only with `VITE_STUDY_EXAMS`; "נוצר בקבוצה" waits for phase 5 (an empty tab promises nothing). One sheet (⋯ or "לשנות") holds the exam's date and length, "לשנות שם" and "לאחד קורסים".
- `s=c.<course>` now matches lectures by lower(trim) as section S does, so the page's "(184)" and the session count the same lectures.
- The course question (`CourseAsk.tsx`, inside K's ask chunk): the server's first line becomes "נבחרו 12 מתוך 340 פסקאות · מ-4 הרצאות"; the answer's citations are listed under it as "מקורות", each a link to the chosen paragraph that cites the slide (citations the paragraphs lack are not linked). The conversation is kept on the phone, signed turns sent back as for a lecture. Sharing to a paragraph and "לשאול את הקבוצה" stay a lecture's.
- The batch (`UploadMany.tsx`, mockups batch.html and batch-progress.html): up to 30 files, each read on the phone first (`lib/readDeck.ts`, shared with one lecture's upload), a row each with "הרצאה" and its slides; the price card from `batchCost()` with the month's spend (`study_spent`) and cap (health's `budgetUsd`); one file at a time through the same steps as one lecture (pictures, `createLecture`, `afterUpload`), with a wake lock. The type chip is plain text until phase 2 adds "מבחן קודם". A lecture's title is its file's name.
- The resume list (`lib/batch.ts`, `study.batch.<group>`): written before the first file; each file's new lecture id is written just before its insert (`createLecture` takes an id), so a tab closed while an insert was on its way finds that lecture on its return and does not upload it twice. Files picked again match by name and size.
- Not built in part B: the round over several lectures (P1.7's sheet; the server's `planId` is ready).

**Phase 1 after its review (dev, not pushed).** What the two reviews changed:
- One course key everywhere: `study_private.course_key(text)` (immutable; the generated `name_key` and every match in S) and `shared/study/courseKey.ts`, the same rule: direction and zero-width marks removed (U+200B–U+200F, U+202A–U+202E, U+2060, U+2066–U+2069), every run of white space (JavaScript's `\s`, NBSP and tabs included) one space, trimmed, lower case. A table made by the earlier S 1 is re-keyed in place (duplicates by the new key keep the first made). Maqaf and hyphen stay two spellings (merge them).
- `s=c.<course>` matches by the key only with `VITE_STUDY_COURSES`; without it, the exact text as before. With it, "תרגול" groups its headings by the same key.
- The course page's "(184)" counts what a session may ask (study_session_counts' rule: also keyed and not stale). A build without `VITE_STUDY_QTYPES` hides the new question types, so its session may ask fewer.
- A round's request: `study_request_create_in_plan(lecture, request, batches, plan, key)` makes it and links it in one transaction under the round's lock, so a refused link (`round full`, `bad plan`, `too few questions`) leaves no request or batches. `study_request_plan` stays for linking an existing request.
- Course changes take the group's lock first (`study_private.course_lock`: the trigger, upsert, rename, merge): a rename racing an upsert waits, opposite merges run one after the other. A lecture or exam moved off a course with no settings and nothing left removes that course's row. A name that is only direction marks is `bad name`.
- The course question pages every read (lectures, ready parts, points: PostgREST answers 1000 rows at most); a question no paragraph matches is `409 no match` before anything is reserved; each earlier turn may carry its lectures' `{n, id}`, and the server renumbers its `[הרצאה n · …]` to the lectures' places now.
- The batch: summaries fit in what is left **less 3 × a part's worst-case reservation** (PART_TOKENS of output; 3 units of a group at once), plus $0.20 a lecture when `points_ahead` is on. The ones that do not fit are uploaded but not handed to the writer: their ids wait on the phone (`lib/later.ts`, `study.later.<group>`, by the ledger's UTC month) and the library or the course page queues them from the 1st; the uploader's phone does not start them by opening them. Files are listed by name with numbers in order (the course numbers lectures by upload order when they have no date), 5 rows then "ועוד N קבצים · להראות", "להוסיף עוד" in the list's head, the reasons above the button, and closing the tab mid-upload asks first.
- `PART_MAX_BYTES` is 170,000 bytes (the smaller reading of 170 KB).

**Built so far (phase 2, part A: SQL S 2 and the server; dev, not pushed).** Decided in code:
- **Pages are rows** (`study_exam_pages`: n, path, w, h, lines, is_key), not `study_exams.pages`: section Q adds its 60-page check to that column again on every run of the file, so an exam of more than 60 pages there would stop the file. New exams leave `pages` as `[]`; the cap is 120 (`study_exam_pages_done`). The phone uploads `<group>/exams/<exam>/p<n>.jpg`; the storage insert policy takes an `exams/` path only while the switch is on, the exam is `uploading` and the caller made it.
- **Kept, not added:** `study_exams.key_source` is B1's key mode (`separate` = the sheet; `unknown` reads as marked). `status` gains `uploading` and `linking` (the check is replaced by name). Members can no longer update `status`, `key_source` or `error` directly (nothing used it).
- **`key_origin` and `key_conf` live on `study_question_keys`** (hidden with the key), so a solved key does not show before an answer. Older exam keys are backfilled: `member` when `key_by` is set, else `exam`. `study_questions` gains `parse_conf`, `page`, `covered`, `linked_at`, `repeat_of`, `twin_of`; `figure` also takes `pg:<page>:<x>,<y>,<w>,<h>` (thousandths); an exam's items are unique by `(exam_id, exam_no)`.
- **Units** (`study_private.exam_jobs`): `read` (up to 4 pages, the next page as context, `{pages, next, reread}`), `key` (the sheet's pages) and **`solve`** (up to 20 items left without a key; a unit of its own until phase 3's link units solve with the slides; not in B1's list). The claim takes `key`, then `read` by first page, then `solve`. `study_claim_exam(p_exam, p_key)` returns everything the unit needs (pages with their signed links and lines, the next page, the numbers saved, or its items); `group_live` now counts exam leases, so summaries and exams share the 3 a group; while a lecture of the group waits to be written, exams take at most 2 (summaries keep priority). The pages' links (48 h, signed by the uploader; the worker has no Storage access) sit in `study_private.exam_queue`; an expired link fails the unit as `pages_expired` and "לנסות שוב" (`study_exam_retry`, any member, 3 a day per exam) brings fresh ones. A model's own failure (timeout, refusal, unreadable, truncated, empty) gets one retry; a passing API error is retried with backoff; at most 4 attempts.
- **Saving:** `study_exam_save_items` and `study_exam_save_keys` take the unit's lease (`lease lost` otherwise). An item is upserted by number; one a member fixed or anyone answered keeps its text; a member's or the sheet's key stays. The sheet's answers wait in `study_private.exam_sheet_keys` until their items are read (the key unit may end first) and win over the exam's marks. When no read or key unit will run, the items without a key are queued to be solved (each once); when nothing will run, the exam is `ready` (`failed` with no item). `skipped_open` sums the read units' counts (a page read again does not add).
- **Keys by hand:** `study_set_exam_key` (redefined, same signature) logs the old and new key, origin and confidence in `study_exam_key_log` and sets `member`; `study_exam_key_undo` puts back the last change not undone (key, origin, confidence, who). Set items (tf, match) are not keyed by hand in phase 2 (`set question`). `study_exam_item_edit` fixes the question, case text, an option or a match prompt, logged in `study_exam_item_log`.
- **Simulation** (kind `exam` only; rides `VITE_STUDY_EXAMS`): `study_mock_create(course, 'exam', exam, n, minutes, unseen_only)` (n 5–150 or all; the caller's unseen items first; minutes given, else the exam's scaled, else the course's, else 1.8 a question), `study_mock_start` (an open attempt comes back), `study_mock_get` (deadline and the server's now; past the deadline it submits first), `study_mock_progress`, `study_mock_answer` → boolean (never a key; false once the time is up, 10 s grace), `study_mock_finish`. **Picks stay on the attempt until it is submitted** (an answer can change, as on paper); then each pick of a counted item becomes a `study_answers` row with mode `exam` and `attempt_id`. Counted: a key, and not a solved key under confidence 3; a blank counts wrong and writes no row. The score lists each item's key, choice, origin, lecture and topic.
- **Server:** `server/study/exams.ts` runs one unit (reserve kind `exam` ref `unit` without the daily check; settle; save; finish). The read prompt has no course or lecture list (cache-stable), pictures first with lines as a hint. `work.ts {exam}` answers 202 and runs in `waitUntil`, stopping at 200 s. Op `exam_read` (`{examId, pages, urls, until?}`) reserves the exam's usual price (`examPriceUsd`) as kind `exam` ref `read` (3 a day per member, no member's share, the 80% line) and settles it at $0 at once, then calls `study_exam_pages_done`; a refused hand-over still used one of the day's 3. `{action:"unit", examId}` runs one unit from the phone when the server cannot write (no pg_net). `exam_explain` stays 501 (phase 3). Needs: `VARIANT_SCHEMA.exams` {Q 2, S 2}; `VITE_STUDY_EXAMS` needs S 2. `courseStyle` reads `study_course_style_items` with S 2 (the course by its key, no deleted or hidden exam, only keys from the exam, its sheet or a member).
- **Not built in part A:** the screens (part B), a soft-delete RPC for `deleted_at` (the column is respected everywhere), and phase 3's links, topics and explanations.

**Built so far (phase 2, part B: the client; dev, not pushed).** Behind `VITE_STUDY_EXAMS` (requiredSchema S 2), which now also needs `VITE_STUDY_COURSES` and `VITE_STUDY_PRACTICE` (past exams live in their course and are practised in sessions); without it nothing changes, and `allowed()` sends `?v=exams`, `?v=mock` and `s=x.`/`s=w.` to the nearest screen that is on. The old "בקרוב" exams screen is gone: `?v=exams` alone lists the courses that have exams.
- **Routes:** `?v=exams&new=1&c=<course>` (the upload, immersive), `?v=exams&e=<exam>(&c=)` (the reading, then the review; the library's tab), `?v=mock&c=<course>(&e=<exam>)` (the simulation's setup, immersive), `?v=practice&s=e.<exam>` (replay), `s=x.<attempt>` (the simulation running and its result), `s=w.<attempt>` (the simulation's mistakes asked again; not in B5, the way "רק הטעויות" reaches a practice session). Back: "→ למבחן", "→ לסימולציה".
- **The upload** (`ExamUpload.tsx`, mockup exam-upload.html): "קובץ PDF" or "לצלם דפים" (a strip of thumbnails with → ← ⟳ ✕, at most 60), the year, the מועד (א׳ ב׳ ג׳), the key mode ("מסומנות במבחן" · "בקובץ נפרד" with its own PDF or photos · "אין תשובות"), the minutes ("לא חובה. לפי זה נקבע השעון בסימולציה."). The usual price is on the button before anything is sent (`shared/study/examPrice.ts`, the server's own sum: `examPriceUsd` in exams.ts calls it with its prompts' lengths and exams.test.ts checks the phone's copy of them). No sentence about where the exam goes (decision 1). On a phone narrower than 380 px the button says "להעלות ולהעתיק · כ-$1.40", so the price stays on its one line. Then the pages are drawn (`lib/examPages.ts`: a PDF's pages at 1,500 px one at a time, each canvas released; a page under 80 characters, or whose Hebrew came out reversed, is a scan and its lines are dropped; photos through an `<img>` (HEIC on iPhone) at 1,500 px, turned), uploaded 3 at a time with the screen held on, signed for 48 hours and handed over (op `exam_read`). An upload that stopped keeps its exam row: "לנסות שוב" sends the pages to the same exam.
- **The reading** (`ExamView.tsx`, mockup exam-reading.html): "מעתיקים עמודים 9–12 מתוך 28…" (the range isolated left to right), a bar, a row per 4 pages, the key sheet and the suggested answers ("✓ הועתק" · "עכשיו" · "מחכה" · "לא נקראו · לנסות שוב"), and "אפשר לסגור את הטלפון. ההעתקה ממשיכה בלעדיו." The screen asks study_exam_status every 4 s while it is shown. When the op answered `server:false` (no pg_net), this screen drives the units itself (`{action:"unit"}`) while it is open, with the screen held on, and says so instead.
- **The review** (mockup exam-review.html): "נמצאו · עם תשובה · לבדיקה" (`reviewCounts`: to check is a suggested key, no key, or a badly read item; with an answer is a key from the exam, its sheet or a member), "2 שאלות פתוחות דולגו.", "לתרגל את המבחן", "סימולציה מהמבחן", the filters (הכל · לבדיקה · תשובה מוצעת · בלי תשובה), and each item opened in place: its page (or its `pg:` box) beside the text (`PageCrop`: the stored page cut by CSS, nothing stored twice), the options with the key, "לאשר" a suggested key (study_set_exam_key with the same answer: origin member), "לסמן תשובה אחרת", "סומנה ע״י נועה: ג׳ · לבטל" (study_exam_key_undo), its changes under it in neutral words ("נועה: ג׳ במקום א׳"), "לא נקראה טוב · לתקן טקסט" (question, case, options; study_exam_item_edit), and "לקרוא שוב את עמוד 7" for a badly read item. True/false and match items show their key but are not keyed by hand (phase 2's SQL); their suggested key can be confirmed. "לא לכלול בחישוב הנושאים" at the end ("…הוא לא ייכנס לחישוב הנושאים של הקורס, ולא ישמש כדוגמה לסגנון של שאלות חדשות").
- **Practice:** `s=e.<exam>` replays the exam in its order and `orderFor` keeps the stored option order for every item with `source='exam'` ("א+ב נכונות" stays where it was printed). `s=c.<course>` adds the course's ready exams' items, and the course page's "(184)" counts them. An item with a suggested key carries "תשובה מוצעת · לא נבדקה"; one under confidence 3 is left out of the round's score ("לא נספרה"). A build without `VITE_STUDY_QTYPES` leaves an exam's true/false and match items out of practice (they would read as one-answer). Not built: B5's filter "רק ממבחנים".
- **The course page:** with a ready exam of 5 items or more, "סימולציה" is the primary action and "לתרגל מבחן קודם" (the newest ready exam) the second, and "לתרגל מה שכבר יש · בחינם (N)" becomes a link under them; the exams' rows say "100 שאלות · 3 שעות" or "מעתיקים את השאלות…".
- **The simulation's setup** (`MockSetup.tsx`, mockup sim-setup.html): phase 2's one source, a past exam ("בדיוק כמו שהיה"), the newest ready exam chosen; lengths from that exam, short first (`lengthsFor`: קצר 20 · חצי 50 · מלא, a length the exam cannot fill left out, at most 150; minutes at the exam's pace, else the course's, else 1.8 a question; whole hours in hours, else minutes, as the mockup: "36 דקות", "90 דקות", "3 שעות"); "קודם שאלות שעוד לא ראיתי" on (not for the whole exam); "מעורב" and "חדש בסגנון" (phase 4) are not shown. A simulation still open on this phone (`study-mock:<user>`, forgotten with the person's other entries on a shared device) is offered first ("יש סימולציה שעוד לא הוגשה · להמשיך").
- **The simulation running** (`MockRun.tsx`, mockups sim-running.html and sim-grid.html): one clock ("נשארו 1:42:10") counted from the attempt's deadline against the server's own now (`remainingMs`), asked again whenever the page is shown, so a locked phone or a reload comes back to the same deadline, question, picks and flags; the options in the exam's order, no feedback, a pick kept on the server and changeable until the end (a tap on the picked option clears it); "לסמן לחזרה"; "מפת השאלות" (ענית · לחזרה · בלי תשובה, 46 px cells) with "להגיש עכשיו? נשארו 6 שאלות בלי תשובה."; at zero it submits by itself ("הזמן נגמר, והסימולציה הוגשה."), and the server submits an attempt opened after its deadline.
- **The result** (mockup sim-result.html): "71 מתוך 97 נכונות", "3 שאלות עם תשובה מוצעת · 3 לא נספרו", "הוגשה כשהזמן נגמר · זמן: שעתיים ו-41 דקות מתוך 3 שעות", by topic only when the items have topics (phase 3 gives them), the mistakes ("בחרת א׳, הנכונה ג׳"; a blank: "לא ענית. הנכונה ג׳"), the items not counted, "סימולציה חדשה" and "רק הטעויות" (`s=w.<attempt>`). Not built: "הכי חשוב לחזור על", the group's median and "לפסקה" (phases 3–4).
- **Checks:** `src/study/lib/exams.test.ts` (the words, the counts, the crop, the lengths, the clock, the replay's order); `e2e/study/exams.cjs` on the flag set `s2` with the synthetic exam printed by `fixtures/make-exam.cjs` into a 12-page text PDF, its key sheet and 12 photos, the mock's worker in `mocks/exams.cjs`, and Playwright's fake clock for the simulation; without the flag it checks that nothing of it shows.

**Phase 2 after its review (three reviews: data and security, exam fidelity, the phone; dev, not pushed).** Changed in section S 2 (still version 2: it was never on production) and around it:
- **The queue:** the sweeper and the claim share one cap (`study_private.exam_cap`: 3, or 2 while a lecture waits), so the sweeper never kicks for a unit the claim refuses; a refused claim from the worker resets `kicks_since_claim` (the worker answered). "לנסות שוב" with nothing failed but units still waiting re-signs and re-kicks them. A key sheet of several versions (`versions`, below) is not retried.
- **Saves take turns:** `study_exam_save_items` and `study_exam_save_keys` take an advisory lock per exam, so two units saving one number at once both go through (`supabase/tests/exam-concurrency.sh`). A number saved already from another page is the same question over two pages (adjacent pages: the longer copy stays, whichever unit saves last) or a **repeat** (an exam whose parts restart at 1, a misread number): not saved, counted per unit (`exam_jobs.repeats`), and the review says "3 שאלות לא נשמרו: המספר שלהן כבר הופיע בעמוד אחר.". A page read again replaces its items as before.
- **Marks:** the read request carries the uploader's key mode (in the user turn: the system stays the same bytes); marks count only for "מסומנות במבחן" (the server and the SQL both drop them otherwise); `marked_by` is `key_page`, `printed`, `handwritten` or `none` and is saved: a handwritten mark (a student's own copy) is a suggested answer at confidence 2, never the exam's key; a mark never replaces the sheet's, a suggested or a member's key.
- **The read prompt:** Hebrew right to left and two columns (right first); a shared case or picture copied into every question it covers; the page before the unit's first comes as context too (`study_claim_exam` returns `prev`; a figure box may sit on it), so the questions of a case printed on the previous unit's page are not lost; numbered statements with lettered choices stay form "one"; a repeated number is copied when it is clearly another question; the figure box holds the picture only, never the options or a mark (a crop must not show the answer in a simulation). The page read again ("לקרוא שוב את עמוד 7") is no longer told to skip its own numbers (`seen` leaves them out), and the review hides that button for an item someone fixed or answered (its text is kept anyway).
- **The key sheet:** `versions` (a column per version: nothing is keyed from it; the unit fails as `versions`, the items are solved and can be keyed by hand: "בדף התשובות יש כמה נוסחים…"); `state` "cancelled" ("בוטלה": the item is retired and counts nowhere; "שאלה אחת בוטלה לפי דף התשובות, ולא נכללת.") and "several" (more than one answer accepted: the first, as a suggested answer at confidence 1, counted nowhere until a member confirms).
- **Suggested answers:** a solve of an item with a picture or a reading under 3 is at most confidence 2 (it was solved from its text alone). A BEFORE INSERT trigger on `study_answers` (`study_answers_skip_unsure`) writes no row for an item whose key is solved under confidence 3, whatever answers it (practice, a set item, a quiz), so "הטעויות שלי", progress and repeats never count it (decision 2); once a member confirms or marks the key, answers count again. A true/false or match item's suggested answer can be confirmed ("לאשר", `study_exam_key_confirm`, logged; "לבטל" brings the suggestion back); such items without a key say "בשאלת נכון או לא נכון ובשאלת התאמה עוד אי אפשר לסמן תשובה ביד.".
- **The key log:** an undo is refused (`changed`) when the key is not what the change left (the sheet or a reading wrote it since).
- **Access:** an attempt is reachable only while its owner is in its group (`attempt_for`). Exam pages: the add policy matches `<group>/exams/<exam>/p<n>.jpg` whole (`study_exam_page_writable`); the uploader may send a page again while it uploads (an update policy: Storage's upsert); "study files delete" is redefined in S: an exam's pages are deleted only by its uploader while it uploads, or once the exam is deleted (slides and wall photos as before).
- **The clock:** `study_mock_progress` has the same 10 s grace as a pick. The exam's minutes were for everything it printed: `study_private.exam_printed` (items, open questions skipped, repeats) paces the simulation, and the course page gives it to the phone (`printed`).
- **Stopped uploads:** an exam still `uploading` a day later is left out of the course's list and counts.
- **The price:** a page is 1,061 × 1,500 (1,500 px is the long side), input at the plain rate (the systems are below the shortest prompt that can be cached, so caching saves nothing here; the system stays cache-stable all the same), and a read unit counts its context page before; a solve unit's typical output includes its thinking (5,000), and its `max_tokens` is 16,000. A 28-page exam now shows about $1.22.
- **The phone:** "לצלם דפים" opens the phone's own choice (camera or photos; no `capture`), "+ להוסיף דפים", the strip's arrows → and ← (earlier is to the right); the year is needed; the key's photos are replaced by a new choice, shown as small pages, with "להסיר"; the upload's progress sits at the top while pages go. The review: the uploader in the head ("הועלה ע״י נועה"), the open item stays in the list until it is closed (even when "לאשר" moved it out of the filter), focus moves into the opened item and back to its row, on a phone under 480 px the page goes above the text, full width, and a tap opens the whole page; a white page is a little dimmer in dark mode. "עמודים 1–4 בתור…" while nothing reads yet. The simulation: "קודם שאלות שעוד לא ראיתי" (the setup takes those first, then fills; not offered for the whole exam); the result numbers its rows as the running screen did ("שאלה 5", with "שאלה 37 במבחן" beside), the exam's name on its own line, "זמן: 12 דקות מתוך 36 דקות"; the bottom bar keeps its words on one line at 320 px.
- **Not changed, with the reason:** options printed 1–5 or A–E still show as א–ה (a label style per item would touch every practice screen; with numbered statements inside the question, the combination form now keeps them apart); the result's back link follows the app's own back rule ("→ לסימולציה" when the setup was the screen before).
- **Before the `exams` switch is turned on:** the first paid run on a real exam is checked item by item by a member (the tests use one synthetic, one-column exam with mocked replies: no handwriting, no shared case, no versions); and in production `select exam_id, exam_no from study_questions where exam_id is not null and exam_no is not null group by 1, 2 having count(*) > 1` returns no row before part 8 runs (its unique index stops on a duplicate).

Synthesis of three designs (NOTEBOOK, EXAM, EVOLVE) and three judgments. Base: **EXAM** for what the student sees and how close it gets to the real exam. Engineering skeleton: **EVOLVE** (no re-keying, the lecture stays the unit, the smallest schema change). Grafted from **NOTEBOOK**: the links table, solving inside the link step, the key log, the capped context with an honest "נבחרו N מתוך M" line, the 5-lecture round cap, and the batch-upload resume manifest. Fixes come from all three judges.

Checked against dev HEAD 3049d2b. Commit 67de062 removed PrivacyNoteSheet, so the broken-build "phase 0" in all three designs is gone. The working tree now has other uncommitted edits (Help, Join, flags.ts, bidi.ts and more), so the build must start from a clean dev. No repo file was changed for this proposal.

---

## חלק א׳: לבעלים

### מה משתנה למשתמש

- **לכל קורס יש עמוד.** בספרייה, שם הקורס נהיה קישור. ההרצאות נשארות בספרייה כמו היום.
- **מבחנים קודמים נכנסים לאפליקציה.** מעלים PDF או מצלמים דפים. האפליקציה מעתיקה את השאלות, ואפשר לתרגל אותן בחינם, כמה פעמים שרוצים.
- **מכל שאלה לסיכום ובחזרה.** אחרי כל תשובה מופיע "איפה זה בסיכום". הפסקה נפתחת מעל השאלה, וסוגרים אותה כדי לחזור לאותה שאלה. מתחת לפסקה בסיכום כתוב "נשאל ב-3 מבחנים".
- **סימולציה.** מבחן לתרגול באורך של המבחן האמיתי, עם שעון אחד לכל המבחן. בסוף יש ציון לפי נושאים, ורשימה של מה לחזור עליו.
- **מה נשאל במבחנים.** טבלה של נושאים מול שנים, כולל שאלות שחוזרות משנה לשנה.
- **שאלות חדשות בסגנון המבחן.** הן נכתבות לפי הנושאים, הניסוח והאורך של המבחנים הקודמים, ורק לנושאים שחסרות בהם שאלות.
- **בהמשך: חומרים אחרים.** סיכומים משנים קודמות, קבצי Word ותמונות, ויצירה של "סיכום נושא" או "טבלת השוואה" מכמה הרצאות.

### הזרימות העיקריות

**העלאת מבחן קודם**
- "העלאת מבחן קודם" ← בוחרים קובץ PDF, או "לצלם דפים".
- ממלאים שנה ומועד, ובוחרים איפה התשובות: "מסומנות במבחן", "בקובץ נפרד" או "אין תשובות".
- המחיר מופיע לפני ההעלאה ("כ-$1.40"). את הקריאה עושה השרת, אז אפשר לסגור את הטלפון.
- בסוף: "נמצאו 98 שאלות · 7 לבדיקה". מתקנים מה שצריך.

**שאלה בלי תשובה במבחן**
- האפליקציה מציעה תשובה ומסמנת אותה "תשובה מוצעת · לא נבדקה".
- כל אחד בקבוצה יכול לאשר אותה או לסמן תשובה אחרת. השם שלו נשמר ליד התשובה, ואפשר לבטל.

**סימולציה**
- בוחרים מה לתרגל: "מבחן קודם", "מעורב מהמבחנים" או "חדש בסגנון המבחנים".
- בוחרים אורך: קצר (20), חצי (50) או מלא (כמו המבחן האחרון).
- "רק שאלות שעוד לא ראיתי" מסומן מראש.
- אפשר לנעול את הטלפון באמצע. כשחוזרים, השעון ממשיך מאותו מקום.
- בסוף: ציון, נושאים חלשים, "רק הטעויות".

**שאלה ← סיכום ← שאלה**
- "איפה זה בסיכום" פותח את הפסקה מעל השאלה. "סגירה" מחזירה לשאלה, והשעון של הסימולציה לא נעצר.

**העלאה של הרבה קבצים**
- בוחרים כמה קבצים יחד, וכל קובץ מקבל שורה עם הסוג שלו (הרצאה או מבחן קודם). אפשר לשנות את הסוג.
- המחיר הכולל מופיע מראש. סיכומים שלא נכנסים בתקציב החודש מחכים לחודש הבא.

### מה השלב הראשון נותן בפני עצמו

- עמוד לכל קורס, עם תאריך המבחן.
- העלאה של הרבה הרצאות בבת אחת, עם מחיר מראש.
- "לתרגל מה שכבר יש בקורס · בחינם".
- "לשאול" על כל הקורס, עם הפניה לפסקה.

השלב הזה לא תלוי בהחלטה 1. אם החלטה 1 מתקבלת מהר, השלב השני (מבחנים קודמים: העלאה, תיקון ותרגול של מבחן אמיתי עם שעון) יוצא מיד אחריו.

### עלות מול $33 לחודש

- **פעם אחת לכל בלוק של 5 מבחנים:** כ-$12–13 (קריאה, חיבור לסיכומים, נושאים). עוד כ-$3 בהמשך, על הסברים שנפתחים.
- **שוטף:** תרגול של מבחנים קודמים וסימולציות מהבנק עולה $0.
- **התקציב צפוף רק בחודש המבחן**, ולכן ממליצים להעלות את המבחנים בתחילת הבלוק.

### החלטות פתוחות (עם ברירת מחדל מומלצת)

1. **מותר לשמור מבחנים קודמים בקבוצה ולשלוח אותם ל-Claude כדי להעתיק את השאלות?**
   מומלץ: כן. המבחנים נשמרים לקבוצה בלבד, לא מוציאים אותם החוצה, והם נמחקים עם הקורס. בלי משפט הסבר במסך ההעלאה. עד שזה נקבע, יוצא רק השלב הראשון.
2. **שאלות בלי תשובה.**
   מומלץ: האפליקציה פותרת ומסמנת "תשובה מוצעת · לא נבדקה". רק אדם מהקבוצה מאשר. תשובה מוצעת שהאפליקציה לא בטוחה בה לא נספרת בציון.
3. **תקציב בחודש המבחן.**
   מומלץ: להשאיר $33. קוראים מבחנים מיד כשמעלים אותם, והסברים נכתבים רק כשמישהו פותח אותם. אחרי שנבדוק מבחן אמיתי אחד, אפשר לשקול קריאה זולה יותר של מבחנים. החלופה: $40 בחודש המבחן.
4. **מה זה "המבחן" בסימולציה (מספר שאלות, זמן).**
   מומלץ: לפי המבחן האחרון שהועלה ("100 שאלות · 3 שעות"), עם אפשרות לשנות בעמוד הקורס. הקצר (20) מופיע ראשון.
5. **המילה לסימולציה.**
   מומלץ: "סימולציה", כדי שלא יתבלבלו עם "מבחן קבוצתי" ו"מצב מבחן". המילה תיכנס ל-COPY.md.

---

## Part B: build spec (English)

### B0. Decisions this synthesis makes (and why)

| Question | Choice | Source / reason |
|---|---|---|
| Course key | `study_courses` row (uuid, for URLs and settings) matched to the **existing course text** by `lower(btrim(course))`. No `course_id` on lectures or exams. | EVOLVE + judge 2: courseStyle, `s=c`, QuizSetup and `study_plans.courses[]` keep working. A uuid in URLs fixes judge 1's complaint about text URLs. |
| Lecture | Unchanged. Not re-keyed, no `role` column. | Judge 2: `role` would leak summaries into 181 SQL and ~20 TS lecture consumers and trigger the paid points-ahead read. |
| Other materials (old summaries, DOCX, photos) | A separate retrieval-only `study_docs` table (phase 5). Not a lecture. | Avoids NOTEBOOK's `role` breakage; still meets judge 1's DOCX ask. |
| Exam work queue | A new `study_private.exam_jobs` with its own claim RPC `study_claim_exam`. `study_claim` is **not** edited. The worker tries the writer first. | Judges 1 and 3 want the phone free to close. Judge 2 wants the writer's claim path left untouched. |
| Reading | Picture-first, text lines as a hint whenever a usable text layer exists, next-page overlap, **no lecture list or course map in the read prompt**. | Judge 3: copying stays faithful and the prefix stays cache-stable. |
| Linking | Per-lecture `link` units over that lecture's **numbered summary blocks** (the writer's block numbering, cached), routed by a $0 trigram pre-pass. Placement uses `placePara`. Missing keys are solved in the same call. | EVOLVE's per-lecture link, NOTEBOOK's solve-in-link, and a fix for "a wrong lecture guess becomes 'not covered'". |
| Link storage | The primary link goes on the existing `ref_lecture, part_idx, anchor, quote, part_gen, slides` columns. Extra links (a second lecture, context) go in `study_exam_links`. | Existing staleness and re-placement work as is; a question can still span two lectures. |
| Topics | `study_course_topics`, built by one call from part headings **plus exam stems**. A question's course topic is **derived** from its (lecture, part) in SQL. Not a new per-question tag; the existing `topic` text is left alone. | EXAM/judge 3 fidelity, without judge 2's "second topic system on questions". |
| Similarity (routing, repeats) | Server-side `server/study/similar.ts` (character trigrams, exists). **No pg_trgm** (not installed). | Judge 2. |
| Mock | Named **סימולציה**. `study_mocks` (shared definition) + `study_mock_attempts` (owner-only clock). Answers use the **existing mode 'exam'** plus `attempt_id`. Session key `x.<attempt>`. | Judges 1-3. The free prefix comes from EVOLVE; `t.`, `q.`, `m.` are taken. |
| Keys | Never "verified" by models. Exam / key sheet / member keys only. Solved keys show "תשובה מוצעת · לא נבדקה"; low-confidence ones are left out of scores. | All three judges. |
| Privacy line on upload | None (67de062). If D20 demands one, a few words at most. | Judges 1 and 3. |
| Topic practice key | `k.<course topic id>`. The existing `t.<text>` stays. | Judge 2 (collision). |

### B1. Data model: new SQL section **S** ("sources")

Used letters are F A W Q Z C K P M N V U J H B G E T X, so S is free. S is appended at the end of `supabase/study-schema.sql`, and `tools/sql-parts.mjs` gets `STARTS = [..., "H", "S"]`, which makes S part 8. Section Q (~7 KB of room) and part 7 are not edited: every change to earlier objects is an `alter … if not exists` or a `create or replace` inside S. Estimated size: 45–65 KB across S 1–S 5. Every version is registered in `study_schema()` ('S 1' … 'S 5') and checked by health's `schemaOk`.

Add a size assertion to `server/study/sqlParts.test.ts`: every part ≤170 KB. Nothing enforces this today, and part 2 is already 163 KB.

**S 1 (courses)**
- `study_courses`:
  - Columns: `id uuid pk`, `group_id`, `name text ≤120`, `name_key text generated always as (lower(btrim(name))) stored`, `exam_date date null`, `exam_minutes int null`, `exam_n int null`, `created_by`, `created_at`, `deleted_at`.
  - Unique `(group_id, name_key)`.
  - RLS: members select. Insert, rename, merge and dates go through RPCs.
- Backfill: one row per distinct `lower(btrim(course))` across `study_lectures` and `study_exams` (`on conflict do nothing`).
- Trigger on `study_lectures` / `study_exams` insert or update of `course`: insert the course row if it is missing. The lecture's text stays the truth.
- `study_question_requests`: add `plan_id uuid null`, to group the per-lecture requests of one cross-lecture round. `lecture_id` **stays not null**.

**S 2 (exams)**
- `study_exams`:
  - Add `moed text ≤20`, `minutes int`, `n_questions int`, `key_mode text check in ('marked','sheet','none')`, `key_pages int[]`, `status text` ('uploading','reading','linking','ready','failed'), `skipped_open int default 0`, `hide_from_profile bool default false`, `deleted_at`.
  - Drop and re-add the pages check: ≤120 pages (it is 60 today).
  - Page JSON: `{n, path, w, h, lines[], key bool, read bool}`.
- `study_questions` (exam items, `source='exam'`):
  - Add `key_origin text check in ('exam','sheet','solved','member')`, `key_conf smallint` (1–3), `covered bool`, `linked_at timestamptz`, `repeat_of uuid null references study_questions on delete set null`, `twin_of uuid null references study_questions on delete set null`, `parse_conf smallint`, `page smallint`.
  - Widen the `figure` check to also accept `'pg:<n>:<x>,<y>,<w>,<h>'` (normalised 0–1000). The client renders it as a CSS crop of the stored page.
  - Exam true/false and matching items are stored with `form` 'tf' / 'match' (question-types.md). `kind` stays mcq/case. Open questions are skipped and counted in `study_exams.skipped_open`.
- `study_exam_key_log (id, question_id, old smallint, new smallint, origin_old, origin_new, by, at)`. Members read. Written only by `study_set_exam_key`. Closes review m11.
- `study_exam_item_log (id, question_id, field, old text, new text, by, at)`: stem and option fixes.
- `study_mocks`:
  - Columns: `id`, `group_id`, `course_id`, `kind check in ('exam','mixed','new')`, `exam_id null`, `question_ids uuid[]` (≤150, ordered), `minutes int`, `spec jsonb` (length, the draw, the blueprint used), `created_by`, `created_at`.
  - Members select. Insert only through `study_mock_create`.
- `study_mock_attempts`:
  - Columns: `id`, `mock_id`, `member_id`, `started_at`, `deadline`, `finished_at`, `position int`, `flagged int[]`, `score jsonb`.
  - Owner-only RLS.
- `study_answers`: add `attempt_id uuid null references study_mock_attempts on delete set null`. Mode stays 'exam'; the check at schema:1840 is unchanged.
- `study_private.exam_jobs`:
  - Columns: `id`, `group_id`, `course_id`, `exam_id null`, `kind check in ('read','key','link','topics','explain_all','output')`, `range jsonb` (pages, lecture_id, item ids), `status`, `lease_until`, `attempts`, `error`, `created_at`.
  - `study_claim_exam()` is a definer RPC: one lease of 330 s, ≤4 attempts, at most 3 running per group **counting `study_private.jobs` leases too**, so summaries and exams share the existing 3-per-group limit.
- Storage: an insert policy for `<group>/exams/<exam>/…` requires `study_feature_on('exams')`. Pages are kept while the exam exists. Low-confidence items and "לא נקראה טוב" need the crop. About 5 MB per exam.

**S 3 (links and topics)**
- `study_exam_links`:
  - Columns: `question_id`, `lecture_id`, `part_idx`, `anchor`, `quote`, `part_gen`, `slides int[]`, `role check in ('answer','context')`, `by check in ('model','member')`, `member_id null`, `stale_at`, `at`.
  - The first 'answer' row is mirrored onto `study_questions.ref_lecture/part_idx/anchor/quote/part_gen/slides` by the save RPC.
  - New index on `study_questions (ref_lecture, part_idx, anchor) where source = 'exam'`.
- `study_course_topics (id, course_id, name ≤80, ord, version, merged_into null)`.
- `study_topic_parts (topic_id, lecture_id, part_idx)`.
- `study_topic_items (topic_id, question_id)`: only for exam items with no covered link.
- `study_topic_log`: renames and merges.
- View `study_question_course_topic (question_id, topic_id)`, security_invoker: through `coalesce(lecture_id, ref_lecture), part_idx → study_topic_parts`, else `study_topic_items`.
- `study_exam_profile (course_id pk, computed jsonb, at)`: refreshed by `study_exam_profile_refresh(course)` after reads and links.

**S 4 (like the exam)**
- `study_style_examples (id, course_id, text ≤3000, by, at)`: ≤20 per course. Replaces EVOLVE's fake exam row.
- `study_exam_profile.computed` gains the wording flags, for example the share of "כל התשובות נכונות" style options and of negative stems, and the calibration numbers (B5.6).

**S 5 (other materials and outputs)**
- `study_docs`:
  - Columns: `id`, `group_id`, `course_id`, `title ≤120`, `kind check in ('pdf','docx','images')`, `pages jsonb [{n, path null, text}]` (≤150 pages), `chars int`, `created_by`, `created_at`, `deleted_at`.
  - Storage at `<group>/docs/<doc>/p<n>.jpg`. Check that `study_is_member_path` (schema:177) covers `docs/`, or extend it.
  - Retrieval only. No summary, no points, no paragraph features.
- `study_outputs`:
  - Columns: `id`, `group_id`, `course_id`, `kind check in ('topic_sheet','table')`, `title`, `selection jsonb`, `source_set jsonb` (lecture/part/anchor/part_gen, doc/page, item ids), `source_sig text`, `body text` (markdown, or table JSON), `version`, `stale_at`, `created_by`, `created_at`, `deleted_at`, `usage_id`.
  - Server-key insert. Members select. Creator soft delete, or anyone after 30 days.

### B2. RPCs

Member RPCs, all checked with `study_is_member`:
- **Courses:** `study_course_upsert(name, exam_date, minutes, n)`, `study_course_rename(id, name)`, `study_course_merge(from, into)`.
  - Rename and merge update `study_lectures.course`, `study_exams.course`, `study_plans.courses[]` and `study_group_plans` in one transaction.
  - `study_course_overview(course)` returns counts, the exam list with states, which cards have data, and the next exam date.
- **Exams:**
  - `study_exam_create(course, meta)` returns `{exam_id, prefix}`.
  - `study_exam_pages_done(exam, pages)` queues `read` units, and a `key` unit for sheets.
  - `study_exam_review(exam)` returns the items with states and link summaries.
  - `study_exam_item_edit(q, field, text)` writes the log.
  - `study_set_exam_key`: redefined in S. It writes the log, sets `key_origin='member'`, and allows undo.
- **Links:** `study_link_set(q, lecture, part, anchor)` (by member) and `study_link_remove(q, link)`. Both re-mirror the primary link.
- **Topics:** `study_topic_rename`, `study_topic_merge`, `study_course_heat(course)` (the topic × exam table, folded to ≤6 exam columns), `study_topic_practice(topic, n)`, `study_my_topics(course)` (weak topics).
- **Simulations:** `study_mock_create(course, kind, exam, n, minutes, unseen_only)` returns `{mock, attempt, missing:[{topic, n}]}`. Then `study_mock_start(mock)`, `study_mock_progress(attempt, position, flagged)`, `study_mock_finish(attempt)`, and `study_mock_median(mock)` (≥3 finished members, else null).
  - Answers go through the existing answer path with mode 'exam' and `attempt_id`.
  - Keys are not returned before `finished_at`.
- **Redefined in S:**
  - `study_paragraph_chips` and `study_paragraph_practice` also match exam items by `ref_lecture` and `study_exam_links`, and return the exam count.
  - `question_spots` (schema:10979) drops the `lecture_id`-only filter for exam items.
  - The correction stale trigger (schema:11564) also marks exam items and `study_exam_links`, and marks `study_outputs` whose source_set contains the paragraph.
  - `study_practice_overview` shows the exam rows it already emits.

Server-key RPCs:
- `study_exam_save_items(exam, items)`: the upsert by `exam_no` that the worker uses. A new function, because `study_save_question` raises without `auth.uid()` (schema:3866).
- `study_exam_save_links(items)`, `study_set_topics(course, topics, parts, items)`, `study_set_explanations` (exists), `study_output_save`.

### B3. RLS summary
- Everything is group-scoped through `study_is_member(group_id)` for select.
- Model output is written only with the server key.
- `study_mock_attempts` and `study_answers` are owner-only.
- Exam keys are readable after answering and on the review screen (design-questions §3.9). Generated keys stay hidden as today.
- The `exams` server switch gates every exam write and the storage insert.
- Accepted minor risk: a member can look up a real item's key on the review screen before a simulation (judge 3).

### B4. Migration
- S 1: backfill `study_courses` from distinct course texts. Nothing else moves. No FK is renamed. `requests.lecture_id` is untouched.
- S 2: production has no exam rows (the switch is off), so the altered checks are risk-free.
- S 3: topics are built per course as a group unit the first time a course has ≥1 linked exam. Existing questions and cards get a course topic through the view, with no rewrite.
- All DDL is additive and idempotent. Redefinitions depend on file order, so a local Postgres test runs parts 1–8 in order and asserts the old behaviour still holds (lecture questions in chips, the stale trigger on lecture questions).

### B5. Every existing lecture-keyed feature and its fate

**Unchanged:**
- Content and writing: `study_lectures`, `study_sections`, the writer and `study_private.jobs`.
- Reading: `study_reads`, `read_parts`, `read_places`, `study_comments`.
- Recordings and transcripts (off).
- `study_usage`: the `kind`/`ref` it already has carries course and exam ids in `ref`.
- Questions and points: `study_question_batches`, `study_question_drafts`, `study_points`, `point_parts`, points-ahead.
- Cards: `study_card_batches`, `study_cards`, adoptions, `my_cards`.
- Plans and meetings: `study_plans`, `plan_lectures`, marathons, `study_meetings`, `meeting_taps`.
- Disputes, `slide_flags`, `study_updates`.
- Pulse tables (they keep the text topic), traps and trap_drafts, the wall (aid drafts, aids, pins, winners), `study_boss_battles`.
- Eve (`?v=eve&l=`), GeoBackfill, blank tables `s=b.…`, soft delete and purge.
- Every `&l=` route, and the `l.`, `m.`, `t.`, `q.`, `r.`, `p.` session keys.

**Changed:**
- `study_edits` / `edit_proposals`: the correction trigger also marks exam items, `study_exam_links` and outputs.
- `study_questions`: exam items finally get rows, links, `key_origin`, `repeat_of`, and the `pg:` figure. Generated questions may carry `twin_of`.
- `study_question_requests`: `plan_id`. A cross-lecture round becomes one request per lecture.
- `study_answers`: `attempt_id`.
- `study_exams`: new columns. The page cap goes to 120.
- Paragraph chips and practice: "נשאל ב-N מבחנים", with exam items first.
- `PracticeSession`:
  - `s=e.<exam>` already parses and sorts (practiceSession.ts:141, 276) and now has items. `orderFor` (practiceSession.ts:346) keeps the stored option order for `source='exam'` and for twins.
  - `s=c` includes exam items, with the filter "רק ממבחנים".
  - New keys: `x.<attempt>` and `k.<topic>`.
  - The whole-exam clock replaces the per-question chip in `x.` sessions (PracticeSession.tsx:361, 750).
- `courseStyle` (practice.ts:196): still keyed by course text. It reads the profile, skips `hide_from_profile` exams, and adds `study_style_examples`.
- Ask: a new scope 'course' (B6.7). One-lecture ask is unchanged.
- Upload: `multiple`, a type chip per row, the exam form, the resume manifest.
- Library: the course header becomes a link and shows the exam count. Nothing else, so the entry chunk stays small.
- Today:
  - An exam card, only when `exam_date` is ≤60 days away **and** ≥1 exam is ready.
  - A weak-topic source line, only when ≥10 course answers exist.
- `practice.tsx`: the `<Soon>` ExamsScreen becomes the exam list and E4.
- `study_group_plans` (phase 6): order days by exam weight. `leave_from` points at real exams.

**Later, unchanged now:** `study_quizzes` (draw from exam items), boss and pulse topics from course topics, a course eve "ערב המבחן".

### B6. Generation pipelines and prompts

All prices use budget.ts: input $4/M, 5-minute cache write $5/M, cache hit $0.20/M, output $20/M. 2.5 Hebrew chars per token (unmeasured, read as ±40%). Image tokens ≈ w×h/750.

**6.1 Phone side (no new dependency)**
- `pdf.ts` renders each page at **1500 px** long side, JPEG 0.8 (~2.1k image tokens). It releases each canvas before the next page, and keeps the text lines.
- A page with <80 chars of text counts as a scan. A text page runs through `lib/bidi`, then a cheap check for reversed Hebrew words; if that fails, it counts as a scan (lines are dropped).
- Photos: `images.ts` shrinks them to 1500 px (HEIC through the browser). Thumbnails can be reordered, rotated and deleted. Copy: "צילום ישר, באור טוב, עמוד אחד בכל תמונה".
- Separate key file: its pages are appended and marked `key:true`.
- Pages are uploaded with 3 parallel workers and a wake lock, then `study_exam_pages_done`.
- No on-phone OCR (rejected by all three designs).

**6.2 `read` unit (worker, one per 4 pages)**
- Input:
  - The cached `EXAM_READ_SYSTEM` (prompts/questions.ts:431), edited.
  - The user turn: pages a..b as pictures, plus their lines when the page has a text layer that passed the check, plus page b+1 as **context only** ("copy only questions that start on pages a–b; finish a question that continues onto the next page").
  - The item numbers already seen.
- `examReadRequest` drops the `lectures` list, so the prefix is identical across exams.
- Output per item: `{no, kind:'mcq'|'case', form:'one'|'tf'|'match', vignette, question, options[], answer|-1, marked_by:'circle'|'bold'|'key_page'|'none', figure:{page,x,y,w,h}|null, parse_conf:1-3}` and `skipped_open:int`.
- Effort low. A timeout gets one retry. Stop at 200 s.
- Saved through `study_exam_save_items`: upsert by `exam_no`, `key_origin` = 'exam' when marked, `page`, `parse_conf`.
- `key` unit: the key pages only, output `{no → answer}`, merged by number with `key_origin='sheet'`. ≈ $0.03.
- When every read unit is done: SQL marks repeats (B6.4) and queues `link` units.

**6.3 `link` unit (worker, one lecture per unit, ≤20 items)**
- Routing (server, $0):
  - For each item, rank the course's lectures by `similar.ts` trigram score of stem+options against each lecture's part headings and point subjects. English drug and receptor names carry most of the signal.
  - Candidate lectures are the top 2. An item whose second score is <0.6 of its first goes only to the top one.
- Grouping: link units wait until **every** read unit queued in the course is done, then group the items waiting in the whole course by lecture. Uploading five exams together costs one cache write per lecture, not five.
- Prompt:
  - System: `LINK_SYSTEM` (short), plus that lecture's numbered summary blocks for every ready part, built by the **same block builder** the question writer uses (`lectureBlock`, practice.ts:310), with `cache_control`.
  - User turn: the items, with keys when known.
- Output per item: `{no, covered, part, para, slides[], role, answer (only when the key is missing), key_conf 1-3, conflict bool, takeaway ≤150 chars, also:[{part, para}]}`.
  - Effort low. Medium when ≥3 items lack a key.
- Placement reuses `placePara` (questions.ts:311, 765-783). A para outside the part's blocks is placed by similarity.
- An item that is `covered:false` in its first candidate lecture is retried in the second candidate's unit. Only after that does it get `covered=false` ("לא מכוסה").
- A lecture with no ready summary links at slide level (`b.<lecture>.<slide>`). The `relink` step upgrades it when the lecture becomes ready: a lecture-keyed step in `study_private.jobs`, like `pointsAheadStep`, that only enqueues an `exam_jobs` link unit.
- After a rewrite or correction (a `part_gen` bump), links are re-placed by `quote` in SQL or server code at $0. Misses go back to "needs linking".
- Keys: a solved key gets `key_origin='solved'` with `key_conf`.
  - A member confirmation sets 'member'.
  - Agreement between solves **never** promotes a key.
  - A conflict between an exam key and a confident solve sets the existing conflict flag ("ייתכן שהשקפים חולקים על התשובה של המבחן").

**6.4 Repeats ($0)**
- Server-side `similar.ts` over the course's exam items: stem similarity ≥0.6 **and** the same keyed option text → `repeat_of` = the oldest item.
- Shown as "חוזרת ב-2021 א ש׳ 40". Double weight in the profile.

**6.5 `topics` unit (worker, group work)**
- Input: every part heading of the course (`{id, lecture n, heading}`) plus every exam stem truncated to 120 chars (`{item id, year, text}`). About 25–30k tokens.
- Output: 15–40 topics `{name, parts:[ids], items:[ids of uncovered items]}`.
- ≈ $0.3–0.7 per build. Incremental ≈ $0.1: new headings and stems plus the current topic names, returning assignments only.
- Runs automatically after a course's first linked exam. Re-runs are offered as "לעדכן נושאים" after ≥3 new lectures or ≥1 new exam. Opening a screen never meets a paid prompt.
- Members can rename and merge topics, with a log.

**6.6 Profile (SQL, $0)**
- `study_exam_profile_refresh(course)` computes, over keyed items of exams not hidden, with the last 2 years ×2:
  - topic shares, with a 5% floor for topics never asked;
  - case vs direct share; option-count distribution; negative-stem share; median stem words;
  - form shares (one / tf / match);
  - minutes per question;
  - per-topic years asked ("4 מתוך 5 שנים");
  - wording flags (share of items with "כל התשובות נכונות" / "א+ב" style options);
  - calibration: group accuracy on real items vs generated items per topic.
- Under 3 exams the heat table shows counts only, with the note "עוד מעט מבחנים, התמונה חלקית".

**6.7 Exam-style questions**
- Plan (SQL, $0):
  - Topic weights from the profile, optionally ×(2 − my accuracy).
  - Slots allocated by largest remainder.
  - Taken from the bank first: unseen, not stale, same topic.
- Write:
  - Each remaining slot goes to the (lecture, part) with the most answer-links for its topic.
  - A round touches ≤5 lectures, with ≥4 questions per lecture touched.
  - One existing `questions` request per lecture, sharing `plan_id`, so caps, RLS, the solver and the per-lecture cache stay unchanged.
- Prompt additions:
  - `courseStyle` (cached system, unchanged mechanics).
  - **partStyle**: ≤3 linked exam items of the same part in the **uncached** user turn.
  - **Exam wording mode**: when the profile's wording flags pass 10%, the request relaxes `BANNED_OPTION`, `NEGATIVE` and the "ends with ?" lead-in rule (questions.ts:120, 284-288, 760-763) for that request only. Bold negatives stay required.
- Twins ("עוד 3 כמו זו", offered **only on exam items**, not under every answer):
  - The exam item is the only example and its takeaway is the focus.
  - The rule changes from "never test a fact from them" to "test the same point with a new case; do not copy the stem".
  - `twin_of` is set.
- Calibration: when generated accuracy on a topic exceeds real-item accuracy by >15 points (≥30 answers each), requests on that topic ask for the harder level.
- Cross-lecture "integration" questions are not in v1, because a request needs a lecture.

**6.8 Explanations**
- The existing `exam_explain` prompt runs on the first open of an item's "למה?" (op on `/api/study/ai`, ≤120 s).
- Input: the linked lecture's numbered blocks (cached, the same prefix as link and questions) plus the linked paragraphs.
- Output: whys per option and a takeaway. Saved for the group with `study_set_explanations`.
- "להסביר את כל המבחן" is an `explain_all` worker unit with its estimate shown.

**6.9 Course ask and outputs: context builder `selectContext(course, selection, query, budgetTokens)`**
1. Load the course's part headings and point subjects (SQL, small). Score each part with `similar.ts` against the query or topic. Add a bonus when exam answer-links point at the part.
2. Fetch only the top parts' markdown. Split it into numbered blocks with `shared/study/blocks.ts`, score the blocks, and fill the budget greedily with whole paragraphs, each with its address (lecture, part, anchor, slides). For phase 5, `study_docs` pages are scored and added the same way, addressed by (doc, page).
3. Return the cut, which the UI shows as "נבחרו 12 מתוך 340 פסקאות".
- No persistent paragraph index (it would drift from corrections) and no embeddings.
- Course ask: ≤12 paragraphs from ≤4 lectures, ≈8k tokens in. Citations `[הרצאה 7 · ש׳ 14]`, `[מבחן 2023 · שאלה 41]`.
- Outputs (topic sheet, comparison table):
  - ≤40k tokens in, one `output` worker unit with progress.
  - The body carries `[[l:<lecture>:<part>:<anchor>]]` / `[[d:<doc>:<page>]]` tags.
  - `source_set` and `source_sig` are stored. The same sig opens the existing output at $0.
  - A changed source sets `stale_at` ("יש שינוי בחומר · לעדכן · כ-$0.30"). Refresh is a paid tap only, and makes a new version.

### B7. Exam parsing and linking: edge cases
- Questions split across pages: handled by the overlap page. Upsert by `exam_no` makes re-runs idempotent.
- A failed unit: "עמודים 13–16 לא נקראו · לנסות שוב". One page can be re-read with "לקרוא שוב את עמוד 7" (one unit).
- A scanned student copy may carry wrong marks. The link solve catches the conflict.
- Image questions use the `pg:` crop of the stored page.
- Hidden exams (`hide_from_profile`) still practise. They are only left out of weights.
- Simulation scoring:
  - Items with `key_origin='solved'` and `key_conf<3`, or no key at all, show "לא נספרה" and are left out of the score.
  - Solved high-confidence items count, with the note "3 שאלות עם תשובה מוצעת".
- Group quiz and hard-topic counts ignore all unconfirmed solved keys.

### B8. Flags, switches, policy
- **Build flags** (`shared/study/flags.ts`, requiredSchema):
  - `VITE_STUDY_COURSES` → S 1
  - `VITE_STUDY_EXAMS` (exists) → S 2
  - `VITE_STUDY_LINKS` → S 3
  - `VITE_STUDY_SIM` → S 4
  - `VITE_STUDY_MAKE` → S 5
  - Each gets OP_SCHEMA rows, failText codes, helpCopy entries and an e2e flag set.
- **Server switches** (`study_private.features`): `courses`, `exams` (exists; off until D20), `links`, `sim`, `make`.
- **POLICY** (budget.ts):
  - `exam`: `{share 0.8, memberShare null, daily 3, dailyRef 'read'}`. Counts exams started per member per day, not calls. Group work, like `bank`.
  - `exam_link` and `topics`: `{share 0.8, memberShare null, daily null}`. Worker only.
  - `explain`: `{0.8, 0.4, daily 40}`.
  - `make`: `{0.8, 0.4, daily 10}`.
  - `ask` unchanged.
- The upload cost card reads the ledger. Summaries past the month's 80% line are queued as "יחכו לחודש הבא". When <$10 is left: "כדאי להעלות מבחנים בתחילת החודש".

### B9. Limits
- **Vercel:** no new function (5 of 12 used). Units run on `/api/study/work` (330 s lease, stop at 200–270 s). Interactive ops run on `/api/study/ai` (≤120 s).
  - Sizing: a read unit writes ≈6k tokens (60–120 s). A link unit takes ≈45–90 s.
  - If pg_cron, pg_net or the Vault is missing, the phone drives the units (the existing fallback, with a wake lock).
- **Queue:** a 30-page exam is 8 read units plus ~15–20 link units, ≈10–20 minutes when summaries are idle. Summaries keep priority.
- **Phone:** one file at a time. Exams ≤120 pages, lectures ≤250 slides, docs ≤150 pages ("לשמור רק עמודים 1–150?"), ≤60 photos per exam, ≤30 files per batch, the 80 MB cap stays.
  - A batch resume manifest in localStorage (wrapped in try/catch) gives "הועלו 24. נשארו 7 קבצים · לבחור אותם שוב".
  - DOCX (phase 5): `word/document.xml` through the JSZip already in the upload chunk, lazy, ≈6–10 KB.
- **Bundle:** the course page, batch upload, exam screens, heat table, topic page, simulation runner, reading sheet and make sheet are lazy chunks. The entry gains only the course link, the Today card, the chip count and route parsing (≈2–4 kB). `tools/study-bundle.mjs` must pass with every flag on.
- **Storage:** ≈5 MB per exam at 1500 px, so ≈25–30 MB per block of the shared 1 GB. Show the course size on its page, and warn at 70%.

### B10. Cost (25 lectures, 5 exams × 100 questions, ~30 pages each)

| Item | Unit | Block total |
|---|---|---|
| Read | ≈$0.19 per 4-page unit (input ≈15k ≈ $0.06, output ≈6k ≈ $0.13) → ≈$1.2–1.6 per exam | ≈$7 |
| Key sheet | ≈$0.03 per exam | ≈$0.1 |
| Link + solve + takeaway | per lecture: blocks ≈12–15k tokens written ≈$0.07, plus ≈$0.008 per item of output | ≈$5 when the exams are linked together (≈$1.8 for one exam alone) |
| Topics | ≈$0.3–0.7 per build | ≈$0.7 |
| Explanations on open | ≈$0.02–0.03 per item; ≈150 opened | ≈$3–4 over time |
| Exam-style questions | ≈$0.025–0.03 each (cache write spread over ≥4 per lecture) | per use |
| Twins | ≈$0.03 each | per use |
| Course ask | ≈$0.04–0.10 | per use |
| Topic sheet / table | ≤$0.30 (repeat with the same sig: $0) | per use |
| Simulations, heat table, profile, repeats, weak topics, routing, context selection | $0 (SQL or code) | $0 |

- One-off exam processing ≈ $12–13, plus ≈ $3–4 of explanations.
- Existing lecture work is ≈ $22 of summaries and ≈ $5 of points per block.
- An exam month with ≈ $10 of use plus leftover summaries passes the $26.40 optional line if the exams are also processed that month. Read the exams in the first month of the block.
- Later savings: Batches for `link` and `explain_all` save ≈ $4 per block (no job exists yet: phase 6). A cheaper copying tier for `read` saves ≈ $5 per block (1/8 of the price per budget.ts:27), only after measuring quality on one real scan.

### B11. Phases with acceptance checks

**Phase 0 (no code)**
- The owner decides D20 (decision 1).
- A by-hand check of one real exam: photograph 4 pages and run the read prompt locally on a synthetic copy only.
- Start from a clean dev.

**Phase 1, "קורסים" (S 1, COURSES; not blocked by D20)**
- Scope:
  - `study_courses` and its backfill.
  - The library header link.
  - The course page with the lectures segment and the exam date.
  - Batch upload of lectures (.pptx/.pdf, multiple) with the cost card and resume manifest.
  - "לתרגל מה שכבר יש · בחינם (184)" (`s=c`).
  - Course ask (scope 'course').
  - `plan_id` cross-lecture rounds (≤5 lectures, ≥4 per lecture).
- Acceptance:
  - Local Postgres: parts 1–8 apply in order twice (idempotent). Each part ≤170 KB.
  - Backfill makes one row per distinct `lower(btrim(course))`, and `s=c.<text>`, courseStyle and QuizSetup still work.
  - A 12-file batch uploads at 390 px. Killing the tab mid-batch shows the remaining files.
  - Course ask cites lectures and shows "נבחרו N מתוך M".
  - Entry chunk <400 kB with every flag on.

**Phase 2, "מבחנים קודמים" (S 2, EXAMS + `exams` switch; needs D20)**
- Scope:
  - Exam upload: PDF or photos, and the three key modes.
  - `exam_jobs` and `study_claim_exam`. Read and key units.
  - E4 review with fixes, key confirmation, the key log and undo.
  - `s=e` replay with stored option order.
  - Simulation kind 'exam' with the whole-exam clock, the grid, flags, resume and auto-submit.
  - Exam items in `s=c`. The profile feeds courseStyle.
  - tf/match forms. The skipped-open count.
- Acceptance (synthetic Hebrew exam fixtures written for the tests; no real exam in git):
  - A 12-page text PDF and a 12-photo scan both yield all items. Split questions are whole.
  - The separate-sheet key merges by number. `skipped_open` is counted.
  - Closing the phone mid-read still finishes.
  - An option "א+ב נכונות" keeps its order on replay.
  - Locking the phone for 5 minutes in a simulation resumes on the same deadline, and the deadline auto-submits.
  - The key log shows a member change and its undo.
  - `study_answers` rows carry mode 'exam' and `attempt_id`.

**Phase 3, "איפה זה בסיכום" (S 3, LINKS)**
- Scope:
  - Routing plus link units, solve with flags, `study_exam_links`.
  - The redefined chips, spots and stale trigger.
  - The reading sheet over the session.
  - "נשאל ב-N מבחנים", repeats, topics (automatic), the heat table, topic pages, `k.<topic>`.
  - Explanations on open, the relink step, re-placement by quote.
- Acceptance:
  - ≥85% of the fixture's items link to the intended paragraph.
  - Wrong-guess items reach the second candidate.
  - A correction on a linked paragraph marks the item stale and re-places it by quote.
  - Solved keys show "תשובה מוצעת · לא נבדקה" and never another label until a member acts.
  - The heat table has no horizontal scroll at 390 px with 8 exams.
  - Phase gate: count the "לא קשור" taps on the first real exam. Above 15%, fix routing before phase 4.

**Phase 4, "כמו במבחן" (S 4, SIM)**
- Scope:
  - Simulation kinds 'mixed' and 'new' with gap fill and its estimate.
  - Lengths קצר 20 / חצי 50 / מלא.
  - "רק שאלות שעוד לא ראיתי" on by default.
  - Weak topics on the course page and in Today (shown only with data).
  - Exam-style generation by plan, partStyle, the wording mode, twins on exam items, saved style examples, calibration.
  - The median at ≥3 members.
- Acceptance:
  - A 20-question 'mixed' simulation from bank and items costs $0 in the ledger.
  - 'new' shows "חסרות 8 שאלות · להשלים כ-$0.25 / להתחיל בלי" before any paid call.
  - Generated questions match the profile's option count, and a wording-mode request passes "כל התשובות נכונות".
  - The Today card is absent without an exam date and a ready exam.

**Phase 5, "מכל החומרים" (S 5, MAKE)**
- Scope:
  - `study_docs` (PDF, DOCX, photos) in the batch upload as "חומר אחר".
  - The "ליצור" sheet: "לתרגל מה שכבר יש · בחינם" first, then שאלות כמו במבחן · כרטיסיות · סיכום נושא · טבלת השוואה.
  - `study_outputs` with sig reuse, stale and refresh.
- Acceptance:
  - A DOCX summary is searchable in course ask and cited as "[סיכום 2023 · עמ׳ 4]".
  - No `study_lectures` row and no points read are created for it.
  - A repeated output with the same sig costs $0.
  - A correction on a cited paragraph shows "יש שינוי בחומר".

**Phase 6, savings and links**
- A Batches job (`batch_submit` / `batch_collect` units polled by the minute cron) for link and explain_all.
- A cheaper copying tier if measured good enough.
- The group plan ordered by exam weight, the quiz drawing exam items, a course eve.

### B12. Risks
1. **D20 (BGU rules, copyright)** blocks phases 2–4. Phase 1 ships without it.
2. **Copy quality on Hebrew scans** (handwriting, two columns, ECG, histology). Mitigations: picture-first reading, 1500 px pages, the overlap page, `parse_conf`, the crop beside the text, re-reading one page, and member fixes with a log. Expect 2–5% of items to need a hand fix.
3. **Wrong keys.** Mitigations: no model-only "verified", low-confidence keys left out of scores, conflict flags, the log and undo.
4. **Linking errors.** Mitigations: two candidate lectures, `placePara`, member fixes, and the phase-3 gate on the "לא קשור" rate. Hebrew has no stemmer, so English terms carry the routing.
5. **Budget.** A whole block uploaded in one month uses the optional room on summaries. Mitigations: the cost card that defers, "read exams early", explanations on open, Batches later.
6. **Few exams look precise.** Mitigation: counts only and a note under 3 exams.
7. **Redefining earlier functions in S depends on file order.** Mitigation: an in-order local Postgres test with assertions on old behaviour.
8. **A second claim path.** `study_claim_exam` must respect the 3-per-group limit across both queues. Test it with summaries and exams queued together.
9. **Course-name variants** ("פרמקו" / "פרמקולוגיה"). Mitigation: `name_key` plus "לאחד קורסים".
10. **Identity is per device.** "סומנה ע״י נועה" names a device's member. That is acceptable for six people.
11. **Terms.** Add to COPY.md: קורס, מבחן קודם, סימולציה, תשובה מוצעת · לא נבדקה, מה נשאל במבחנים, איפה זה בסיכום, חוזרת. Never "מאומתת", "מבחן לתרגול" or "מבחן לדוגמה".

---

## Screens for the mockup step (390 px, RTL)

1. **Course page** (`?v=course&c=<id>`)
   - Purpose: the home of one course; shows what to do now.
   - Key elements:
     - The header with the exam date.
     - The primary button "סימולציה" and the secondary "לתרגל מבחן קודם".
     - The card "מה נשאל במבחנים" (top 5 topics, one dot per exam).
     - The card "כדאי לך לתרגל" (3 topics, each with "לקרוא" and "לתרגל").
     - Segments "מבחנים קודמים | הרצאות | נוצר בקבוצה".
   - Copy: "פרמקולוגיה · 25 הרצאות · 5 מבחנים קודמים", "המבחן ב-12.2 · עוד 23 ימים", "כולינרגיים · נשאל ב-5 מתוך 5 שנים", "לתרגל מה שכבר יש · בחינם (184)".

2. **Batch upload** (`?v=upload&c=<id>&many=1`)
   - Purpose: many files at once, with the cost up front.
   - Key elements:
     - File rows with a type chip (הרצאה ▾ / מבחן קודם ▾ / חומר אחר ▾).
     - An exam row's mini form.
     - The cost card and the progress line.
   - Copy: "נבחרו 14 קבצים", "סיכומים ל-8 הרצאות: כ-$7 · קריאת 2 מבחנים: כ-$3 · נשארו החודש $24", "3 סיכומים יחכו לחודש הבא", "קוראים קובץ 4 מתוך 14 · כדאי להשאיר את המסך פתוח", "העלאה (14 קבצים)".

3. **Upload one past exam and reading progress** (`?v=exams&new=1&c=`)
   - Purpose: PDF or photos, and where the key is.
   - Key elements:
     - "קובץ PDF" / "לצלם דפים".
     - A thumbnail strip with ↑ ↓, rotate and delete.
     - Year and moed. The key choice. Optional minutes.
     - The button with its price. Then server progress.
   - Copy: "התשובות: מסומנות במבחן · בקובץ נפרד · אין תשובות", "כמה זמן היה המבחן? (דקות)", "להעלות ולהעתיק את השאלות · כ-$1.40", "מעתיקים עמודים 9–12 מתוך 28… אפשר לסגור את הטלפון", "נמצאו 98 שאלות · 91 עם תשובה · 7 לבדיקה".

4. **One exam, review** (`?v=exams&e=<id>`)
   - Purpose: check and fix the copy and keys, then practise.
   - Key elements:
     - The primary "לתרגל את המבחן".
     - Filter chips "הכל · לבדיקה · תשובה מוצעת · לא מכוסה".
     - Item rows with state chips. An opened item shows the page crop beside the text.
   - Copy: "שאלה 41 · תשובה מוצעת · לא נבדקה", "לאשר" / "לסמן תשובה אחרת", "סומנה ע״י נועה · לבטל", "לא נקראה טוב · לתקן טקסט", "בסיכום: הרצאה 7 · כולינרגיים", "חוזרת ב-2021 א ש׳ 40", "לא לכלול בחישוב הנושאים".

5. **Simulation setup** (`?v=mock&c=<id>`)
   - Purpose: choose a simulation in two taps.
   - Key elements:
     - Three source cards.
     - The length chips, short first.
     - The unseen toggle, the blueprint line, and the gap line with its price.
   - Copy: "סימולציה", "מבחן קודם · מעורב מהמבחנים · חדש בסגנון המבחנים", "קצר · 20 שאלות · 36 דקות", "חצי · 50 שאלות · 90 דקות", "מלא · 100 שאלות · 3 שעות", "רק שאלות שעוד לא ראיתי", "לפי המבחנים: 22% נוירו · 15% לב · 60% מקרה", "חסרות 8 שאלות · להשלים כ-$0.25 / להתחיל בלי".

6. **Simulation running** (`?v=practice&s=x.<attempt>`)
   - Purpose: an exam-like screen.
   - Key elements:
     - One countdown for the whole exam, and the position.
     - "לסמן לחזרה".
     - The numbered grid sheet (answered, flagged, empty).
     - No feedback. "להגיש".
   - Copy: "נשארו 1:42:10", "שאלה 37 מתוך 100", "לסמן לחזרה", "מפת השאלות", "להגיש עכשיו? נשארו 6 שאלות בלי תשובה".

7. **Simulation result**
   - Purpose: score, weak topics, next step.
   - Key elements:
     - The score.
     - Topic rows (right/total with exam weight).
     - "הכי חשוב לחזור על" (3 topics, each with לקרוא and לתרגל).
     - The wrong-answer list. The group median (≥3).
   - Copy: "71 מתוך 97", "3 שאלות עם תשובה מוצעת · 3 לא נספרו", "כולינרגיים · 4 מתוך 9 · היה ב-4 מבחנים", "רק הטעויות", "החציון בקבוצה: 68".

8. **Answer feedback with the reading sheet** (inside any session)
   - Purpose: from a question to the paragraph and back, without leaving the session.
   - Key elements:
     - The explanation.
     - "איפה זה בסיכום" rows.
     - The bottom sheet with the highlighted paragraph, one paragraph before and after, and the slide tag.
     - "לפתוח את כל ההרצאה". Closing returns to the same question.
   - Copy: "איפה זה בסיכום", "הרצאה 7 · כולינרגיים · ׳אטרופין חוסם…׳ · ש׳ 14", "מבחן 2023 מועד א · שאלה 12", "נשאל גם ב: 2022 א ש׳ 14", "סגירה".

9. **מה נשאל במבחנים** (`?v=heat&c=<id>`)
   - Purpose: the topic × exam table.
   - Key elements:
     - A 130 px topic column, ≤6 exam columns of 32 px, then "סה״כ" and "אצלך".
     - Counts shaded by count (counts only under 3 exams).
     - A filter, and a "not covered" row.
   - Copy: "מה נשאל במבחנים", "21 22 23 24 25 · סה״כ · אצלך", "רק מה שלא יושב לי", "נשאל, ואין הרצאה שמכסה (6)", "עוד מעט מבחנים, התמונה חלקית".

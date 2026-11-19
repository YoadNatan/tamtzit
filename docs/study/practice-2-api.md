# תרגול 2.0: the server's API for the screens

What the practice screens call (DECISIONS.md and the four approved screens in
`proposal/practice-2/mockups.html`: מה ליצור, דוגמה ומיקוד, הבנק נבנה, סבב
חדש), with Q's end (the bet, "מתי כן", "לפסקה", two-flag hiding, the blind
solver). The screens that call it are built (`practice.md`: מה ליצור and
דוגמה ומיקוד in `PracticeCreate.tsx`, הבנק נבנה in `PracticeBank.tsx`, סבב
חדש in `PracticeRound.tsx`, the question in `PracticeQuestion.tsx`, the fix
sheet in `FixSheet.tsx`; their calls in `src/study/lib/practice2.ts`). The
screens read the shared vocabulary and numbers from
`shared/study/practice2.ts`.

- The SQL: section Q at **version 2** (`supabase/study-schema.sql`, Q's end
  and then practice 2.0, both inside Q's markers). It loads on a database at
  release 1 (F, Q, C, K at 1) and changes nothing release 1's app reads.
- The op: `POST /api/study/ai` with `op: "questions"` needs Q 2
  (`OP_SCHEMA`); with Q at 1 every action answers **503 `schema`**.
- Every call carries the member's token (`Authorization: Bearer …`), as today
  (`postStudy` in `src/study/lib/api.ts`). Errors are codes; the screens turn
  them into Hebrew with `failText(code, "practice")`.

## Contents

1. [The flow, screen by screen](#1-the-flow-screen-by-screen)
2. [Op "questions": its actions](#2-op-questions-its-actions)
3. [The RPCs](#3-the-rpcs)
4. [Tables the app reads](#4-tables-the-app-reads)
5. [The question screen: Q's end](#5-the-question-screen-qs-end)
6. [What it costs](#6-what-it-costs)
7. [Error codes](#7-error-codes)
8. [Decisions where the documents were silent](#8-decisions-where-the-documents-were-silent)
9. [Files and tests](#9-files-and-tests)
10. [The points read ahead (package B)](#10-the-points-read-ahead-package-b)

## 1. The flow, screen by screen

### מה ליצור (setup)

1. Call **action `plan`** (free) with the options on screen (none at first:
   the defaults). It answers the header ("38 שקפים · 46 נקודות שצריך לדעת"),
   each part with its points, the three levels' counts ("ממוקד 12 · מלא 24
   · מקיף 40"), the plan of the chosen options and every estimate.
2. Once server writing finishes a summary, the server reads its points by
   itself (package B, [§10](#10-the-points-read-ahead-package-b)): the
   screen usually opens on a read in progress (step 3) or with the numbers.
   If `points.current` is false (never read, or a part's text changed since),
   show `estimate.readUsd` ("קריאת הנקודות שצריך לדעת: כ-$0.14, פעם אחת לכל
   הקבוצה") and call **action `points`**. It reads only the stale parts, for
   the whole group; when every part is current it answers at once and spends
   nothing. Then call `plan` again (or read `study_points_state`).
3. While points are read (on any phone, or on the server after this phone
   left): follow the database, never only the stream. Watch
   `study_point_parts` on Realtime, call `plan` again on each change and
   every few seconds while `points.busy`, and when the page is shown again.
   The read in progress is the parts whose `updated_at` is at or after the
   latest `writing` row's (a claim marks all its parts in one statement);
   each is reading (`writing`, `busy`), ready, or failed with its `error`.
   A part still `writing` whose lease ran out (`busy` false) was dropped by
   the server: offer to read again (`src/study/lib/pointsRead.ts`). The
   server calls the claimed parts in order, six at a time: show the first
   six `writing` parts as reading and the rest as waiting. A read whose
   claimed parts carry `ahead_at` equal to the claim's own `updated_at` is
   the server's read ahead (§10): say so ("נקראות מעצמן"), not "במכשיר
   אחר" (`readProgress(…).ahead`). On the phone that
   asked, the database ends the read too: once its claim has shown (a live
   `writing` part, or rows read after the stream opened) and no part is
   `writing`, close the stream (a phone that slept can hold a dead one).
   The stream opening (a 200) means the parts were claimed: a connection
   lost before that is "no connection" unless the rows show the claim; one
   lost after it is not an error (the server reads on). A refusal (`busy`)
   never opens.
4. The counts per part come from `plan.parts` (or from `study_points` and
   `levelCounts()` on the phone, which is the same function).

### דוגמה ומיקוד

1. A pasted example or a photo: **action `style`**. It answers `description`
   ("ככה השאלות ייכתבו: …"), the example as text, and a `sig`. Keep all three
   and send them back unchanged in `options.style`.
2. The focus line is `options.focus` (at most 200 characters).
3. The cost line ("24 שאלות · כמו במבחן · כ-$0.60") is `plan.estimate`.

### הבנק נבנה

1. **Action `create`** with the options: it answers the request and its
   batches (no model call).
2. Write the batches as release 1 writes a round (`src/study/lib/rounds.ts`):
   the first alone until its `start` line, then two at a time, each with
   `{ op: "questions", lectureId, batchId }`. A batch streams its drafts as
   they are written, then the blind solver's verdict on each; one the
   solver got wrong is rewritten once by the server, and rejected if still
   wrong.
3. Everyone in the group sees the bank being built through Realtime on
   `study_question_drafts` (and `study_question_batches`). The coverage bars
   and "17/24" are `study_request_progress(p_request)` or, live,
   `coverage()` in `shared/study/practice2.ts` over the request's points and
   its drafts.
4. Each draft: **✓ להשאיר** `study_draft_keep(p_draft)`; **↻ לנסח מחדש**
   action `reword`; **✕** `study_draft_remove(p_draft)`. **להוסיף הכול**:
   `study_draft_keep_all(p_request)` (keeps what the solver passed or could
   not check, and skips what is still being checked or failed). A draft can
   be kept only when `keepable(draft)`.
5. Only a kept draft is a question of the bank. Until then it is in no
   practice, count, quiz or list of release 1.

### סבב חדש

1. `study_session_counts(p_lectures)` gives the member's own counts per part,
   style, state (`new`, `wrong`, `right`) and own flag.
2. `sourceCounts(rows, { parts, styles })` gives the chips ("לא נענו · 9",
   "טעיתי · 4", "סימנתי · 2", "הכול · 24"); `sessionCount(rows, { sources,
   parts, styles })` gives "13 · הכול". "טעיתי" is the rule of "הטעויות
   שלי" (wrong until answered right on a later study day).
3. The session itself is release 1's (its picker and `study_answer_question`),
   with Q's end's additions (§5).

## 2. Op "questions": its actions

`POST /api/study/ai` with `{ op: "questions", action, lectureId, … }`.
`lectureId` is the lecture's uuid; without one the answer is 400
`lectureId required`. An unknown action is 400 `bad action`.

| Action | What | Model | Answer |
|---|---|---|---|
| none or `"write"` | write one batch: `{ batchId }` | yes | a stream |
| `"points"` | read the lecture's points to know | yes, only for stale parts | a stream |
| `"plan"` | the setup screen's numbers: `{ options? }` | no | JSON |
| `"create"` | a request and its batches: `{ options }` | no | JSON |
| `"style"` | an example read back: `{ text?, image? }` | yes, small | JSON |
| `"reword"` | one draft written again: `{ draftId, note? }` | yes | a stream |

A stream is `text/plain`: one invisible first character (U+200B, which the
client drops, as today), then one JSON object a line; a failure after the
start ends the stream with `"\n\u0000ERROR <code>"`. Before the stream starts,
a refusal is an HTTP status with `{ "error": "<code>" }`.

The shapes are types in `shared/study/practice2.ts`, and the server is
type-checked against them: `PlanAnswer`, `CreateAnswer`, `StyleAnswer`, a
`PointsLine` of action `points`, a `WriteLine` of writing a batch or of
`reword` (its draft is a `DraftOnLine`), with `Options`, `Point`,
`PointsPart`, `Draft` and `SessionCount`.

### Options (`plan`, `create`)

```ts
type Options = {
  level?: "focused" | "full" | "deep" | "custom"; // ממוקד · מלא · מקיף · משלי; default "full" (decision 1)
  count?: number;          // משלי only: 1-40
  parts?: number[];        // the summary parts chosen (part_idx); default: every part with points
  styles?: Style[];        // at least one; default the four the setup screen shows checked
  difficulty?: "easy" | "exam" | "hard"; // קל · כמו במבחן · קשה; default "exam"
  focus?: string;          // "על מה להתמקד", at most 200 characters
  style?: { description: string; example: string; sig: string }; // exactly what action "style" answered
};
type Style = "case" | "mechanism" | "drug_choice" | "adverse_contra" | "compare" | "not_true" | "blank_table";
// מקרה קליני · מנגנון · תרופה לבחירה · תופעות והתוויות נגד · השוואה · ׳מה לא נכון׳ · טבלה ריקה
```

`readOptions()` (shared) checks them and fills the defaults. Refusals (400):
`bad level`, `count out of range`, `bad parts`, `bad styles`,
`bad difficulty`, `focus too long`, `bad style`, `bad request`.

How many questions (`questionsPerPart`, per chosen part, then at most 40 in
all, shared by the largest remainder):

| Level | Per part of n points (r red flags) | What the batches cover |
|---|---|---|
| ממוקד | max(round(n/4), r), at most n | the most important: red flags, then weight, one point a question |
| מלא | round(n/2) | every point once (about two a question) |
| מקיף | n | every point (about one a question) |
| משלי | the member's number by points, at most 2 a point | the most important two a question |

"round" is half up. The example (אמבות 6, לישמניה 9, מלריה 22, תולעים 9)
gives 12, 24 and 40, as the approved screen shows.

### `plan` → JSON (free)

```json
{
  "lecture": { "slides": 38 },
  "parts": [{ "part_idx": 0, "title": "אמבות", "slide_from": 1, "slide_to": 8, "summary": "ready",
              "points": 6, "red_flags": 1, "status": "ready", "current": true, "busy": false, "error": null }],
  "points": { "total": 46, "current": true, "stale": [], "busy": false },
  "levels": { "focused": 12, "full": 24, "deep": 40 },
  "plan": { "level": "full", "total": 24,
            "parts": [{ "part_idx": 0, "points": 6, "red_flags": 1, "questions": 3, "covers": 6 }], "batches": 6 },
  "estimate": { "readUsd": 0, "questionsUsd": 0.6, "solverUsd": 0.12, "totalUsd": 0.6, "perQuestionUsd": 0.025,
                "levels": { "focused": 0.3, "full": 0.6, "deep": 1 }, "rewordUsd": 0.03, "styleUsd": 0.01 },
  "spent": { "groupUsd": 3.21, "mineUsd": 0.42, "capUsd": 33, "share": 0.8, "memberShare": 0.4 }
}
```

- `parts` is `study_points_state` (one row per part of the summary).
  `summary` is the part's own status: a part still being written has no
  points yet. `current` is false when the part's text is not the text its
  points were read from. `status` and `error` are the last read's.
- `points.stale`: the written parts whose points are not current;
  `estimate.readUsd` is reading them (0 when none). `estimate.solverUsd` is
  the blind solver's part of `questionsUsd`, shown apart (it is already in
  it); `totalUsd` is reading the points and the questions.
- `levels` and `plan` count only current points of the chosen parts as they
  are now (a stale part counts its old points).
- `spent`: the group's spend this month, the member's own optional spend,
  the cap, and where optional spending stops (80% of the cap; 40% for one
  member). `null` when a figure could not be read.

### `points` → a stream

Claims the summary's written parts whose points are not current (one reader
at a time), reads each part in its own call (a part over 12,000 characters
of paragraphs in at most four), up to six calls at once, and saves each part
as soon as its call ends, its line written at once (in the order the parts
end). A normal lecture takes about a minute. The reading runs on the server
(`waitUntil`) and does not depend on the stream: a phone that sleeps or
leaves the screen does not stop it, and finds it in `study_point_parts`.
A refused reservation or a model error stops new calls: the calls in flight
finish and save, the parts never asked fail (given back as a try), each with
its `fail` line, and the stream then ends with `\u0000ERROR <code>`.

```
{"t":"start"}                         the model started (not sent when nothing is stale)
{"t":"part","part":0,"points":6}      part 0 saved with 6 points
{"t":"fail","part":1,"why":"truncated"}   part 1 not saved; read again on the next call
{"t":"done","parts":1,"points":6,"costUsd":0.13,"unsettled":0}
```

Nothing stale: only `{"t":"done","parts":0,"points":0,"costUsd":0,"unsettled":0}`,
nothing spent. Before the stream: 409 `busy` (another phone is reading),
409 `no summary`, 409 `summary not ready` (no part is written yet), 409
`gave up` (a part failed three paid reads on the same text and nothing else
is stale; it is tried again when its text changes; a refused reservation, or
a part the deadline never reached, is not a try), 402 `budget`, `reserve`,
`member_share`, 429 `daily_limit` (20 reads a member a day). A `fail` line's
`why`: `timeout`, `truncated`, `refusal`, or a database code.

A point read again keeps the id of the earlier point it restates (the same
kind and a similar text), so questions that covered it still cover it after
a correction.

### `create` → JSON (free)

```json
{
  "request": { "id": "…", "round": 3, "level": "full", "count": 24, "parts": [0, 1, 2, 3],
               "styles": ["case", "mechanism", "drug_choice", "adverse_contra"], "difficulty": "exam" },
  "batches": [{ "id": "…", "part_idx": 0, "seq": 0, "wanted": 3 }, { "id": "…", "part_idx": 2, "seq": 1, "wanted": 4 }],
  "plan": [{ "part_idx": 0, "points": 6, "red_flags": 1, "questions": 3, "covers": 6 }],
  "estimate": { "questionsUsd": 0.6 }
}
```

Refusals: the options' 400s; 400 `bad style` (the `sig` is not the
server's for this lecture and these words); 409 `summary not ready` (a chosen
part is still being written); 409 `points stale` (call `points` first); 400
`no points` (the chosen parts have none); 409 `enough questions` (the lecture
has 150 active questions, or 400 drafts were ever written for it); 400 `bad
parts`.

**A round over several lectures** (courses, `docs/study/sources.md` B6.7):
the phone makes one id for the round and sends `create` once per lecture
with `{ options, planId }`. Each lecture's request and batches are made
exactly as above (the same caps), then `study_request_plan` puts the request
in the round, and the answer adds `"round": { "planId": "…", "lectures": 3 }`.
A round stays in one group, takes at most 5 lectures and at least 4
questions of each. It needs section S at 1 (503 `schema`). Refusals, before
any request is made: 400 `bad plan` (not an id, or the request is in another
round), 400 `too few questions`, 409 `round full`.

Each batch writes at most 5 questions; a part with more has several batches
(`seq`). Each batch carries the points it must cover and the style of each of
its questions (the request's styles in turn; a blank table only on a part
whose slides have a table).

### `write` → a stream: `{ op: "questions", lectureId, batchId }`

The same call as release 1. A batch of a release-1 round still saves into the
bank (now after the blind solver); a batch of a request writes drafts:

```
{"t":"start"}
{"t":"draft","d":{…draft…}}                       saved as a draft, being checked
{"t":"skip","why":"two options say the same"}     a question that failed the checks (never saved)
{"t":"check","id":"…","state":"ok"}               the solver's verdict: ok · failed · unchecked
{"t":"draft","d":{…draft…},"replaces":"…"}        the server's rewrite of one the solver got wrong
{"t":"drop","id":"…"}                              still wrong after the rewrite: rejected
{"t":"done","made":4,"rejected":1,"solverRejected":1,"costUsd":0.13,"unsettled":0}
```

A draft line's `d` (never the key, the explanations, "מתי כן", the takeaway
or the solver's answer):

```ts
{ id, request_id, batch_id, part_idx, style, points: string[] /* study_points ids */, kind: "mcq" | "case",
  difficulty: 1 | 2 | 3, vignette, question, options: string[] /* the stored order */, slides: number[],
  topic, aspect, anchor: number | null /* "לפסקה" */, teaser, figure, option_tags: string[],
  check_state: "checking", rewrites: number, replaces: string | null }
```

A release-1 batch's `{"t":"q","q":{…}}` line gains `anchor`, `teaser`,
`figure`, `option_tags` and `style`. Refusals before the stream are release
1's (409 `busy`, `gave up`; 404 `batch not found`; 402 budget…).

`unchecked`: the solver could not run (no time left, its reservation refused,
or an error); such a draft can be kept, and the screen should say it was not
checked. A blank table's vignette is the table, one row a line written
`| … | … |`, with the blank cell as `___`.

### `style` → JSON: `{ text?, image? }`

`text`: at most 3,000 characters. `image`: `{ mediaType: "image/jpeg" |
"image/png" | "image/webp" | "image/gif", data: "<base64>" }`, at most
2,800,000 base64 characters (send the photo at most 1,400 px a side, as the
app's pictures are). One or both.

```json
{ "description": "מקרה של 2-3 שורות עם גיל, מין ונסיעה, חמש אפשרויות, ושאלה על הצעד הבא. בעברית, עם המונחים באנגלית.",
  "example": "אישה בת 28 חוזרת מטיול בהודו עם חום כל 48 שעות…\nא. …", "optionCount": 5, "case": true,
  "sig": "64 hex characters", "costUsd": 0.008, "unsettled": 0 }
```

400 `bad example`; 422 `no example` (nothing that reads as an exam
question); 422 `refusal`; 504 `timeout`; 402/429 as every paid call (10 a
member a day).

### `reword` → a stream: `{ draftId, note? }`

"↻ לנסח מחדש" on a pending draft (`note`: at most 200 characters, the
member's words). The server writes the question again with its key, points
and style, saves it as the draft's new version (the old one becomes
`replaced`), and has the solver check it; a version the solver gets wrong is
written again once and rejected if still wrong.

```
{"t":"start"} · {"t":"draft","d":{…},"replaces":"<old id>"} · {"t":"check","id","state"} · {"t":"drop","id"} · {"t":"skip","why"}
{"t":"done","made":1,"rejected":0,"solverRejected":0,"costUsd":0.03,"unsettled":0}
```

Refusals: 400 `lectureId and draftId required`, `note too long`; 404 `draft
not found`; 409 `not pending`, `busy` (being reworded on another phone),
`reword limit` (four versions); 402/429 (40 a member a day). A rewrite that
fails its checks writes nothing (`made: 0`) and frees the draft at once.

**Question types** ([question-types.md](question-types.md)): the options'
`styles` may also be image, label, steps, tf, match and order (13 keys).
"plan" also answers `facts` (per part: tables, captioned pictures, labelled
pictures, points by kind) and `defaults` (the types checked first for the
chosen parts), and weighs `estimate.questionsUsd` by the planned types.
"create" with a new type answers 409 `schema` until section X is loaded.
"reword" of a staged case answers 409 `not for steps`. A draft line and a
`q` line carry `form`, `layout`, `series` and `step`. A set draft is checked
with `study_draft_check_set`; a label draft is saved `ok` (keyed by the
picture's geometry) and never goes to the blind solver.

## 3. The RPCs

Members call these with their token (`sb.rpc(name, args)`); the server-only
ones refuse without the server key (`forbidden`), so the app never calls them.

| RPC | Who | Arguments | Returns |
|---|---|---|---|
| `study_points_state` | member | `p_lecture` | one row per summary part: `part_idx, title, slide_from, slide_to, summary, points, red_flags, status, current, busy, error` |
| `study_request_progress` | member | `p_request` | one row per part of the request: `part_idx, title, points, covered, wanted, made, kept, pending, checking, failed, open` |
| `study_draft_keep` | member | `p_draft` | the new question's id |
| `study_draft_keep_all` | member | `p_request` | rows `draft_id, question_id` of what it kept |
| `study_draft_remove` | member | `p_draft` | nothing |
| `study_session_counts` | member | `p_lectures uuid[]` | rows `lecture_id, part_idx, style, state, flagged, n` (the caller's own) |
| `study_answer_question` | member | `p_question, p_choice, p_mode, p_ms, p_confidence` | `answer, explanations, takeaway, correct, whens` (§5) |
| `study_question_whens` | member | `p_ids uuid[]` | `question_id, whens` of questions the caller answered |
| `study_question_for_fix` | member | `p_question` | `answer, explanations, takeaway, whens, hidden, flags` of a hidden question |
| `study_question_fix` | member | `p_question, p_verdict ('keep'\|'retire'), p_slides int[], p_note` | nothing |
| `study_question_still_true` | member | `p_question` | nothing |
| `study_my_rewordings` | member | `p_group, p_now?` | `question_id, wrong_at, ask_kind, ask_question, ask_card` |
| `study_my_confusions` | member | `p_group, p_now?` | `right_tag, chosen_tag, times, last_at` |
| `study_points_claim`, `study_points_save`, `study_points_fail`, `study_request_create`, `study_draft_save`, `study_draft_check`, `study_draft_reword`, `study_draft_release`, `study_draft_replace`, `study_draft_reject`, `study_save_question`, `study_question_claim`, `study_question_finish` | the op (server key) | | |

Rules the database keeps, whoever calls:

- Keep: the draft must be `pending`, checked `ok` or `unchecked` (else `not
  checked`), not being reworded (`busy`), and the lecture under 150 active
  questions (`enough questions`). Keep all keeps those in part order, up to
  that limit, and `enough questions` only when it could keep none.
- Remove: a `pending` draft (`not pending`), not being reworded (`busy`).
- Any member of the group may keep, keep all, remove and reword any pending
  draft of the group (decision 2: anyone creates; the bank is shared).
- A stranger gets `draft not found` / `request not found` / `lecture not
  found`, and reads nothing.
- `study_session_counts` counts only questions a session may ask: active,
  keyed, not hidden by two flags, not marked by a correction.

## 4. Tables the app reads

All readable by any member of the group (RLS), written only by the
functions, and in the Realtime publication.

**`study_points`**: `id, lecture_id, part_idx, n` (order in the part)`, kind`
(`drug, mechanism, indication, adverse, contra, number`)`, subject, text,
anchor` (the paragraph, SummaryView's `data-blk`)`, quote` (its first words,
to re-anchor)`, slides int[], red_flag, weight` (3 core · 2 standard · 1
detail)`, created_at, updated_at`.

**`study_point_parts`**: `lecture_id, part_idx, src_md5, status` (`pending,
writing, ready, failed`)`, attempts, lease_until, error, model, cost_usd,
updated_at` (the read of each part; watch it while `points.busy`), and
section B's `ahead_at` (the claim's time when the server read the part ahead,
§10).

**`study_question_requests`**: `id, group_id, lecture_id, round, level,
count, parts, styles, difficulty, style_note, style_example, focus, points
uuid[], created_by, created_at`.

**`study_question_drafts`**: the draft line's fields and `status`
(`pending, kept, removed, replaced, rejected`)`, check_state` (`checking,
ok, failed, unchecked`)`, rewrites, replaces, lease_until` (a reword in
progress)`, question_id` (once kept)`, model, created_by` (who asked for
the request)`, decided_by, decided_at, created_at, updated_at`. The key is
in `study_question_draft_keys`, which no member reads.

**`study_question_batches`** gains `request_id, seq, points uuid[], styles
text[]`; **`study_questions`** gains (Q's end) `anchor, quote, part_gen,
teaser, stale_at, stale_edit, checked_by, checked_at, figure, option_tags,
hidden_at, fixed_by, fixed_at, fix_slides, fix_note` and (practice 2.0)
`style, points uuid[], request_id`. A question of release 1 has `style`
null (`study_session_counts` reads it as `case` for a case, else `other`).

## 5. The question screen: Q's end

- **The bet** ("ניחוש · נראה לי · על בטוח"): `p_confidence` 1, 2 or 3 on
  `study_answer_question(p_question, p_choice, p_mode, p_ms,
  p_confidence)`; any other value is `bad bet`. It is stored with the answer
  and shown to nobody else. A member never answers in mode `quiz` (`bad
  mode`).
- **The autopsy and "מתי כן"**: the answer returns `whens` beside
  `explanations`, one per option in the stored order (`""` for the key and
  for an option the lecture gives no case for). For questions answered
  before: `study_question_whens(p_ids)`.
- **"לפסקה"**: `anchor` (the part's paragraph, `data-blk`), `quote` and
  `part_gen` on the question; open it with `LectureCtx.openParagraph`. When
  the part was written again, re-anchor with `reanchor(blocks, anchor,
  quote)` (`shared/study/blocks.ts`); `anchor` is null when the writer could
  not place the question.
- **Two flags hide**: two different members' flags of reasons `wrong_key`,
  `not_in_slides`, `two_answers` or `unclear` set `hidden_at`; the question
  leaves every practice, count and quiz, and `study_answer_question` answers
  `hidden`. Any member then opens the fix sheet (`study_question_for_fix`,
  `not flagged` otherwise, `in quiz` while a live quiz holds it) and keeps it
  with 1-6 of the lecture's slides or retires it (`study_question_fix`;
  `bad source` without a slide). "להסתיר ממני" stays the device's own.
- **The blind solver** runs on every question written, release 1's rounds
  included; the screens need nothing for it beyond the draft's
  `check_state`.
- The diagram (`figure`, `fig:<slide>-<k>`) and the options' tags
  (`option_tags`) are on the question; confusions are
  `study_my_confusions`, another wording `study_my_rewordings`.

## 6. What it costs

Every model call reserves its worst case first (`study_reserve`, with the
server key) and settles its real cost after it, failed and stopped ones too.
The month's cap (`STUDY_MONTHLY_USD`) holds for all of them; every kind here
is optional: it stops at 80% of the cap (the rest stays for summaries) and
at 40% of the cap for one member.

| Kind (POLICY) | Call | Daily limit a member | Reserved (worst, a typical lecture) | Expected |
|---|---|---|---|---|
| `points` | one call per stale part (the read's first, ref `read`, is the one the daily limit counts) | 20 reads | ≈ $0.17 a part of 4,000 characters (max_tokens 8,000) | ≈ $0.24 a lecture of five parts, once for the group |
| `practice` | one batch of up to 5 questions; the automatic rewrite | none | ≈ $0.41 a batch of 5 | with the solver, $0.025 a question |
| `solver` | the blind solver after each writer's call | none | ≈ $0.10 for 5 questions | ≈ $0.005 a question (in the $0.025) |
| `reword` | a member's "↻ לנסח מחדש" (and its one automatic rewrite) | 40 | ≈ $0.22 | ≈ $0.03 |
| `style` | an example read back | 10 | ≈ $0.05 ($0.06 with a photo) | ≈ $0.01 |

The worst cases were computed with the code's own estimates
(`callEstimate`, `solverEstimate`, `pointsEstimate`, `estimateUsd`) for a
38-slide lecture of about 25,000 characters and a 17,000-character summary.
A reservation is held only while its call runs; a request's batches run two
at a time, so it holds about $1 at once at most.

**Per lecture, at full price** (what `plan.estimate` shows; DECISIONS.md's
table):

| Level | The example (46 points) | Questions, with the blind solver | Reading the points (once, if not read yet) |
|---|---|---|---|
| ממוקד | 12 | ≈ $0.30 | + ≈ $0.14 |
| מלא | 24 | ≈ $0.60 | + ≈ $0.14 |
| מקיף | 40 | ≈ $1.00 | + ≈ $0.14 |
| משלי | the member's number | $0.025 a question | + ≈ $0.14 |

The $0.025 a question is the approved figure (`EXPECTED_USD.question`);
calibrate it, and `pointsUsd()`, against the ledger after the first
lectures:

```sql
select kind, count(*), round(avg(cost_usd), 4) as avg_usd, round(sum(cost_usd), 2) as total_usd
  from public.study_usage
 where kind in ('points', 'practice', 'solver', 'reword', 'style') and settled_at is not null
 group by kind order by kind;
```

Section B's batch mode is not built: Yoad's decision 2 of 17 Nov 2026
replaced it with the points read ahead at full price (§10), and nothing
writes questions or cards ahead.

## 7. Error codes

Every code below has Hebrew in `failText(code, "practice")` or is internal
(`INTERNAL_CODES`: the app never meets it). New in practice 2.0:

| Code | Where | Hebrew (practice) |
|---|---|---|
| `no summary` | points | עוד אין סיכום להרצאה הזו. הנקודות שצריך לדעת נקראות מהסיכום, אז קודם יוצרים אותו. |
| `summary not ready` | points, create | הסיכום עוד נכתב. הנקודות שצריך לדעת ייקראו כשהוא יסתיים. |
| `points stale` | create | הסיכום תוקן מאז שהנקודות נקראו. קוראים אותן שוב, ואז יוצרים. |
| `no points` | create | בחלקים שנבחרו אין נקודות שצריך לדעת. אפשר לבחור חלקים אחרים. |
| `count out of range` | plan, create | בוחרים בין 1 ל-40 שאלות. |
| `bad parts` | plan, create | החלקים שנבחרו לא נמצאו בסיכום. כדאי לרענן. |
| `bad styles` | plan, create | בוחרים לפחות סגנון אחד. |
| `focus too long` | plan, create | שורת המיקוד ארוכה מדי (עד 200 תווים). |
| `note too long` | reword | עד 200 תווים. |
| `bad example` | style | אפשר להדביק טקסט של עד 3,000 תווים, או לצרף תמונה אחת (JPG, PNG, WebP). |
| `no example` | style | לא נמצאה שאלה בדוגמה. אפשר להדביק אותה כטקסט, או לצלם שוב. |
| `truncated` | points (a part's `why`) | הקריאה נקטעה באמצע. אפשר לנסות שוב. |
| `draft not found` | keep, remove, reword | השאלה הזו לא נמצאה. כדאי לרענן. |
| `not pending` | keep, remove, reword | השאלה כבר לא ממתינה: היא נוספה לבנק, הורדה או נוסחה מחדש. כדאי לרענן. |
| `not checked` | keep | אפשר להוסיף לבנק שאלה רק אחרי הפותר העיוור. שאלה שהוא טעה בה אפשר לנסח מחדש או להוריד. |
| `reword limit` | reword | השאלה הזו כבר נוסחה מחדש ארבע פעמים. אפשר להשאיר אותה או להוריד. |
| `request not found` | keep all, progress | הבקשה הזו לא נמצאה. כדאי לרענן. |
| `enough questions` | create, keep (also release 1's round) | להרצאה הזו יש כבר את מספר השאלות המרבי. |
| `round full` | create (a round) | בסבב אחד אפשר לבחור עד 5 הרצאות. |
| `too few questions` | create (a round) | בסבב על כמה הרצאות בוחרים לפחות 4 שאלות מכל הרצאה. |
| `bad plan` | create (a round) | הסבב הזה לא נמצא. כדאי להתחיל אותו שוב. |

`busy`, `gave up`, `refusal`, `timeout`, `budget`, `reserve`,
`member_share`, `daily_limit`, `hidden`, `not flagged`, `bad source`, `in
quiz`, `bad bet` keep their existing words. Internal: `part not writing`,
`bad points`, `bad style`, `rewrite limit`, `not failed`, `bad batch`, `no
request`, `bad action`, `bad level`, `bad difficulty`, `lectureId required`,
`lectureId and draftId required`, `draft of another lecture`.

## 8. Decisions where the documents were silent

- **Drafts in their own table.** A question waiting for review is never in
  `study_questions`, so no picker, count, quiz or release-1 list can show it,
  and a phone that still runs release 1 never sees one. Keeping moves it into
  the bank with its key.
- **The review hides the key.** Drafts show what the bank shows before an
  answer (the stem, options, part, style, points, slides, the solver's
  verdict); the key stays hidden until the member answers it in practice, as
  for every question. The blind solver checks the key instead.
- **Counts.** "round" is half up per part (it reproduces the screens' 12, 24
  and 40). A request has at most 40 questions (מקיף on the example's 46
  points is 40); משלי at most two a point. Red flags raise ממוקד's count of
  a part to its number of red flags.
- **Points per question.** A question tests one main point and may test one
  or two more (`points`, main first). מלא hands each batch about two points
  a question; coverage counts every point a draft names that is pending or
  kept and not failed by the solver.
- **Bounded rewriting.** A question the solver gets wrong is written again
  once (one rewrite call per batch run); still wrong, it is rejected (a
  draft) or dropped (release 1). A draft the batch's rewrite call never
  covered (it was already used, or there was no time) stays `failed` for a
  member to reword or remove. A draft's history allows an automatic rewrite
  only while it has fewer than two rewrites (`study_draft_replace`'s
  `p_auto`; the op checks the same before it pays for one) and four versions
  in all with a member's rewords. A draft a member removes while the solver
  reads it is never rewritten. A reword holds the draft for 330 seconds.
- **When the solver cannot run** (no time, its reservation refused, an
  error), the questions are `unchecked`: kept as before the solver (release
  1) or keepable by a member, never silently rejected.
- **Effort.** A request's batches are written at high effort, קל at medium
  (and medium after a timeout, as release 1); the solver and the style read
  at low; the points at medium.
- **Style example.** Read back once (`style`), signed by the server, sent
  back with `create`; the batches receive the description and the example as
  text, never the photo again.
- **Limits.** A lecture holds at most 150 active questions (release 1's
  rounds keep their 80) and 400 drafts ever. Daily limits a member: points 20,
  rewords 40, style reads 10.
- **The points step's invalidation** is the part's text itself (md5 of its
  Markdown): a rewrite or a correction makes it stale, nothing else does. A
  part whose model call failed three times on the same text waits for a new
  text (`study_points_fail(p_refused)` gives back a try that never reached the
  model).
- **Health.** `/api/study/health`'s `schemaOk` asks for `REQUIRED_SCHEMA`
  (Q 1) and what the app built with the deployment's flags needs
  (`healthSchema`): on `study/rel2` `ENDS.Q` is true, so with
  `VITE_STUDY_QUESTIONS` (and practice) on it needs Q 2. Op "questions"
  checks Q 2 itself either way. After running the SQL, check
  `select public.study_schema()` shows `"Q": 2`.
- **Release 1's phones during the move** still work: their calls keep their
  meaning (`study_question_round(p_lecture)`, the answer with four
  arguments, the finish with seven). A request's batches show to them as a
  round being written, whose questions appear only once kept.

## 9. Files and tests

| What | Where |
|---|---|
| The op's actions and dispatch | `server/study/practice2.ts`, `server/study/ops/practice.ts` |
| Writing a batch (both modes), the request, the part's text | `server/study/practice.ts` |
| The format and its checks (Q's end, style, points) | `server/study/questions.ts`, `server/study/prompts/questions.ts` |
| The blind solver | `server/study/solver.ts`, `server/study/prompts/solver.ts` |
| Points to know | `server/study/points.ts`, `server/study/prompts/points.ts` |
| Shared vocabulary, plan, options, estimates, coverage, counts | `shared/study/practice2.ts` |
| POLICY rows `points`, `style`, `reword` | `server/study/budget.ts` |
| The SQL and its checks | `supabase/study-schema.sql` and `supabase/tests/study.sql`, section Q |
| Hebrew for the codes | `src/study/lib/failText.ts` |
| The points read ahead (§10) | `server/study/bank.ts`, `api/study/work.ts` (`{ points }`), section B of the SQL, `src/study/lib/pointsRead.ts` (`ahead`) |

```bash
npm run test:study -- practice2 questions solver points   # the server and the shared module
npm run test:study                                         # everything
npm run test:contract                                      # every RPC and column named here exists
npm run build
```

The SQL checks: load `stubs.sql`, `board-schema.sql` and `study-schema.sql`
(twice) on a throwaway local Postgres, then `supabase/tests/study.sql` (the
commands are at the top of that file): the P2-1 to P2-4 lines of section Q
say ok or FAIL by themselves.

## 10. The points read ahead (package B)

Yoad's decision 2 (17 Nov 2026) redefines package B: **no question or card
is written automatically** (the addendum's bank, §12.6.B, with its Message
Batches, deadline and fall-back, is not built, and the upload no longer asks
"להכין גם שאלות וכרטיסיות?"). Instead, once server writing finishes a
lecture's summary, the server reads the lecture's points to know at once, so
מה ליצור opens with its numbers.

**When.** Section B's trigger `study_points_ahead_after_ready` fires when
`study_finish` sets the lecture `ready` (every part written, also after a
part is written anew). If server writing is set up (pg_net and Vault's two
secrets) and the switch `points_ahead` is on, it kicks the worker: `POST
/api/study/work {"points": <lecture>}` with the server key, sent after the
commit as the writer's kicks are. A correction alone never kicks it (its part
is read on a member's tap, as before).

**What.** `server/study/bank.ts`, `pointsAheadStep`:

1. `study_points_ahead_claim(p_lecture, p_key)` (the key alone; a member's
   token is `forbidden`) claims, under the lecture's points lock, **only the
   parts never tried on their text** (`src_md5` and `try_md5` both differ
   from the part's md5), and only when every part is written and no read
   holds a live lease. It marks them `writing` with `ahead_at` = the claim's
   time and answers their text and earlier points (the worker reads no
   table). Null: nothing to do (200 `{claimed:false}`). So a text is never
   read ahead twice, and a part that failed waits for a member.
2. The first call is reserved with kind `points`, ref `ahead`. The worker's
   rows name no member, so no member's share or daily limit counts them; the
   optional features' line (80% of `STUDY_MONTHLY_USD`) and the cap do. A
   refusal (`reserve`, `budget`, `off`) gives the claim back quietly
   (`study_points_ahead_release`: the parts look as before, their try given
   back, no reason shown) and answers 200 `{claimed:false, skipped}`. The
   setup screen still offers "לקרוא את הנקודות", which a member's tap reads.
3. `readPoints` (points.ts, the same as action `points`): each part in its
   own call, six at once, each reserved before and settled after, each part
   saved as its call ends, in `waitUntil` after a 202 `{claimed:true,
   parts}`. It stops 25 s before the function's deadline and 270 s after it
   started.

**Recoverable.** A part whose call fails (`timeout`, `truncated`,
`refusal`, a model error) is failed with its reason through
`study_points_fail`; one whose function died keeps its lease until it runs
out (six minutes). מה ליצור shows both, as for any read: "לא נקרא" with the
reason and "לנסות שוב", or "הקריאה נעצרה באמצע". The member's tap
(`study_points_claim`) reads exactly those parts.

**The setup screen.** While the read ahead runs, מה ליצור shows the
existing progress card (each part ממתין · נקרא… · ✓ N נקודות · לא נקרא,
"N מתוך M חלקים", live) with "קוראים את הנקודות שצריך לדעת…" and "הסיכום
נכתב, אז הנקודות נקראות מעצמן, פעם אחת לכל הקבוצה. אפשר לצאת מהמסך: הוא
יתעדכן כשהקריאה תסתיים." A tap meanwhile meets `busy`, as with another
phone's read.

**Switch.** On by default; Yoad turns it off with

```sql
update study_private.features set enabled = false, changed_at = now() where name = 'points_ahead';
```

Off: no kick, and the worker claims nothing; members read the points on a
tap, as before. No `VITE_STUDY_*` flag: the only screen change is the setup
screen's wording, which reads `ahead_at` when the column exists (a database
without section B answers 42703, and the rows are read without it).

**Who may call what.** The worker reaches `study_points_ahead_claim`,
`study_points_ahead_release`, and section Q's `study_points_save` and
`study_points_fail` as anon with the key; each refuses without it. Section
Q's two accept the key alone (`study_private.may_bank`), as Q's other worker
paths do; with a member's token they still check the member.

**Cost.** The same as a member's read (§6): ≈ $0.24 for a lecture of five
parts, once for the group, again only for a part written anew. Check it in
the ledger:

```sql
select date_trunc('day', created_at) as day, count(*) as calls, round(sum(cost_usd), 2) as usd
  from public.study_usage where kind = 'points' and user_id is null group by 1 order by 1 desc;
```

**Tests.** `server/study/bank.test.ts` (the read, the quiet skip, a failed
part, an older database, the writer's kick), `work.test.ts`'s local loop on
the real SQL (a three-part lecture written to the end, then its points read
ahead once, every call settled), `src/study/lib/pointsRead.test.ts` (the
read ahead told apart from a member's), and `supabase/tests/study.sql`'s
BA1-BA7 (the kick, the claim of untried texts only, the worker's save and
fail, the release, the switch, a deleted lecture, no server writing).

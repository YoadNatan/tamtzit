# Progress (A2) and "הטעויות שלי" in another wording (Q-2)

Branch `study/w5-a`, on `study/wave4`. Release 8 of the addendum
(`spec/addendum/addendum.md` §12.3.A and §12.3.Q's Q-2), built as Yoad's
decisions of 17 Nov 2026 change it (`DECISIONS-2026-11-17.md`).

## What a member sees

With `VITE_STUDY_PROGRESS` on:

- **"שלי"** has three rows from one call (`study_my_progress_counts`):
  - "ההתקדמות שלי", with "{n} תשובות ב-28 הימים האחרונים" and what is on
    the danger list today;
  - "הטעויות שלי", with how many are open and how many come back today in
    another wording;
  - "חוזרות היום בניסוח אחר", when something is due again today.
- **"ההתקדמות שלי"** (`?v=progress`, `proposal/mockups/progress-pulse.html`
  s1), marked "רק לך":
  - "מוכנות לפי נושא · טווח, לא ציון": a bar per part of a lecture, the
    range "{lo}–{hi}%" once the part has 20 first answers a day in 28
    days. Below that the row says "{heading}: עוד מעט תשובות" with
    "{n}/20", and a line under the bars names the nearest part and how
    many answers it still needs.
  - "רשימת הסכנה": every answer given "על בטוח" that was wrong, with "ענית
    ׳…׳. נכון: …", the slide, and when it comes back ("היום", "מחר", "עוד
    N ימים"). It leaves after two right "על בטוח" answers on two later
    days. "חוזרות בניסוח אחר, עד פעמיים נכון ׳על בטוח׳."
  - "לתרגל את מה שחוזר היום ({n})": the session `?v=practice&s=r.<group>`.
  - "לפי היבט:": חם · פושר · יושב טוב, from 4 questions in an aspect, and
    the aspect nearest to a bucket with how many more questions.
  - The calibration ring: "ב-{part}, כשסימנת ׳על בטוח׳, צדקת ב-X%
    מהפעמים." from 20 such answers; until then the ring counts toward 20
    and says how many more.
  - No streak and no flame (those are Today's).
  - An empty page says what each place needs and offers "לתרגל".
- **"הטעויות שלי"** (`?v=practice&s=m`): a mistake from an earlier day is
  asked first, in another wording: another question on the same paragraph
  when there is one (`study_my_rewordings`), with the chip "בניסוח אחר".
  Then today's mistakes, as themselves.
- **What is due again today** (`?v=practice&s=r.<group>`, "חוזרות היום"):
  the danger list's due rows first (each asked as `ask_id`, its
  paragraph's other question), then the open mistakes of earlier days in
  another wording; each question once.
- **A miss** in any session says "חוזרת מחר בניסוח אחר" beside "טעות ·
  ׳נראה לי׳" when its paragraph has another question, else "חוזרת מחר"
  (`practice.html` s2).
- Help's "ההתקדמות שלי" row and the privacy note's "בהתקדמות:" line say all
  of this, including that progress belongs to the phone the member joined
  from.

## Decisions 1 and 3

- **Decision 1 (no accounts).** Nothing waits for section A or an account.
  `requiredSchema` asks section A only for the withdrawn
  `VITE_STUDY_ACCOUNT`; progress and "הטעויות שלי" need P 2 (and Q 2).
  The mistakes notice says "״הטעויות שלי״ עוד לא פתוחות." instead of
  waiting for the account. §12.7.6's gating rule is lifted: `route.test.ts`
  now checks that F's words promise "מחר" only where something brings the
  item back ("הטעויות שלי", Today or the anchor), and that help does
  promise it once "הטעויות שלי" is on.
- **Decision 3 (meters, minimal blocking).** It names phase 3, but its
  rule fits progress: every number short of answers keeps its place and
  says how many more, counted from the member's own rows. The thresholds
  are constants in `shared/study/meters.ts`, re-exported by `shared/study/progress.ts` (`READINESS_MIN` 20,
  `CALIBRATION_MIN` 20, `ASPECT_MIN` 4, `DANGER_SECOND_DAYS` 3,
  `DANGER_RIGHTS` 2); `progress.test.ts` reads section P's end and fails
  if the SQL uses other numbers. To give the aspect meter its count,
  `study_my_aspects` lists an aspect below 4 questions with bucket null
  (the addendum's version left it out).

## Read helpers for Today (T-1) and the integrator

`src/study/lib/progress.ts` (lazy: import it from a screen or inside an
effect, as `features/progress.tsx` does):

| Helper | Returns | Source |
|---|---|---|
| `myProgressCounts(group)` | `{ answers, parts, parts_ranged, sure, sure_right, danger, danger_due, mistakes, rewordings_due, again_due }` | `study_my_progress_counts` |
| `myOpenMistakesCount(group)` | open mistakes ("הטעויות שלי"'s count) | the same call |
| `myDangerDue(group)` | the danger list's rows due today, the first first: Today's "על בטוח" row is `[0]` (review F-9) | `study_my_danger_list` |
| `myRewordings(group)` | open mistakes of earlier days with `ask_kind` (`question`, `card`, `same`) and what to ask | `study_my_rewordings` |
| `myReadiness`, `myDangerList`, `myAspects`, `myCalibration` | the progress screen's rows | section P's end |
| `AGAIN_KEY(group)` | `r.<group>`: the session of everything due again today | |
| `todayText()` | today's study day, `YYYY-MM-DD` | `shared/study/day.ts` |

`again_due` counts each question once (a danger row due today is often an
open mistake from yesterday too). The pure words and thresholds are in
`shared/study/progress.ts` (`progressLine`, `mistakesLine`, `dueChip`,
`dueToday`, `readinessMeter`, `aspectMeter`, `calibrationPick`). In
`pickQueue` (`lib/practiceSession.ts`), `again` is §12.3.Q's tier 1: pass
`Again[]` (`{ question_id, ask, wrong_at }`) for sessions `m` and `r.`.
Section T's `study_my_danger` (in the addendum) reads
`study_my_danger_list`, which this branch adds.

## Built and deferred (§12.3.A, §12.3.Q's Q-2)

| Item | State |
|---|---|
| Section P as the spec printed it (reading progress, private numbers, the plan's tables, marathons) | built (SQL and checks ME); the plan's tables stay unused (review F-7) |
| P's end: PR2 readiness, PR3 the danger list, PR4 aspects, PR5 calibration, PL2/PL5 a moved block | built (SQL, checks PS1-PS6) |
| PR7 `study_my_progress_counts` | new here, for "שלי" and Today |
| `Progress.tsx` (progress-pulse.html s1) | built |
| "שלי"'s rows (`MeRows`) | built |
| Q-2: "הטעויות שלי" in another wording, `r.<group>`, the "חוזרת מחר בניסוח אחר" note | built |
| PS-2 `progress.test.ts`, PS-3 `progress.cjs` | built (`shared/study/progress.test.ts`, `e2e/study/progress.cjs`) |
| A card as the other wording (`ask_kind = card`) | the session asks the question itself; showing the card is Today's (T, with C's `CardFace`) |
| "להמשיך מהמקום שבו עצרת" (`useLectureA`, `study_note_reading` from the reader) | deferred: not in the approved progress screen; the SQL is there for whoever wires the reader |
| The marathon screens and the live line "הבלוק הבא" (`VITE_STUDY_MARATHONS`) | deferred: not this task's flag; section P has their tables and functions, and G builds on them |
| The exam-eve view (`?v=eve`, `VITE_STUDY_EVE`, PR6) | deferred: phase 3; `EveScreen` stays a placeholder |
| A-1 … A-9's account checks, the merge (ME52-ME64) | gone with the account (decision 1) |

## Yoad's steps

1. **SQL.** Run the whole `supabase/study-schema.sql` in the SQL Editor (it
   is one re-runnable file). On `study/wave4`'s state (or `study/wave3`'s),
   with data, it adds section P and leaves every other section as it was.
   Then `select public.study_schema();` should show `"P": 2` beside wave
   4's: `{"B": 1, "C": 2, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "P": 2,
   "Q": 2, "V": 1, "W": 2, "Z": 2}`. New: 7 tables (read parts and places,
   the plan's three, marathons and who is in; marathons are published to
   Realtime), and the functions of P and its end.
2. **The flag.** In Vercel, Production: `VITE_STUDY_PROGRESS=1`, then
   Redeploy. It needs P 2 (and Q 2 for "הטעויות שלי", which needs
   `VITE_STUDY_PRACTICE`). `/api/study/health` asks for P 2 with the flag,
   so run step 1 first. No new secret, no new switch, no model call.
3. **Check on a phone.** "שלי" → "ההתקדמות שלי"; answer a question wrong
   "על בטוח": the danger list shows it with "מחר".

To roll back: unset `VITE_STUDY_PROGRESS` and redeploy. The SQL can stay.

## Tests

- `npm run test:study`: `shared/study/progress.test.ts` (the thresholds
  against the SQL, the meters, the chips, calibration's scope, the rows'
  lines), `practiceSession.test.ts` (Q-2's tier 1 for `m` and `r.`),
  `route.test.ts` (decision 1).
- `supabase/tests/study.sql`, section P: ME1-ME67 without the account,
  PS1-PS6, P-reg.
- `e2e/study/progress.cjs` with the set `a5` (wave 4's flags and
  `VITE_STUDY_PROGRESS`):

```
VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 VITE_STUDY_ANCHOR=1 \
VITE_STUDY_CORRECTIONS=1 VITE_STUDY_ASK=1 VITE_STUDY_VAR=1 VITE_STUDY_WALL=1 VITE_STUDY_MEETING=1 \
VITE_STUDY_GUESS=1 VITE_STUDY_PROGRESS=1 npx vite build --outDir /tmp/study-e2e-a5
E2E_FLAGS=a5 NODE_PATH=$(npm root -g) node e2e/study/progress.cjs /tmp/study-e2e-a5 /tmp/a5-out
```

## The checks on this branch (17 Nov 2026)

| Check | Result |
|---|---|
| `npm run test:study` | 638 tests, 638 pass |
| `npm run test:contract` | 163 RPC calls and 99 table chains in 176 files match the schema (232 study functions, 61 study tables) |
| `npm run build` | passes; the study entry 327.96 kB (limit 400 kB); in the e2e builds 327.99 kB (off), 328.06 kB (production's), 328.23 kB (wave 4's), 328.26 kB (a5) |
| `npm run test:bundle` | 339,815 bytes with every flag on; no package screen in the entry chunk; A's share 3,093 B |
| The whole SQL twice on a throwaway Postgres 16, then `supabase/tests/study.sql` | 0 errors; 0 FAIL (721 lines "ok"); the registry above |
| The upgrade from `study/wave4`'s file with data (its checks 0 FAIL, then a lecture, a part, a question with a key, a "על בטוח" miss and a card), then this file twice | 0 errors; all 40 rows of the 54 tables kept with the same content hash; 7 new tables, empty |
| The same from `study/wave3`'s file | 0 errors; all 40 rows of the 36 tables kept; 25 new tables, empty |
| Health's `schemaOk` | the flags off and production's: true on wave 3's, wave 4's and this SQL (needs unchanged); with `VITE_STUDY_PROGRESS`: true on this SQL only (P 2), hence the SQL first |
| e2e, every script in `e2e/study/`, in four builds: off, `rel1`, `w4`, `a5` | 60 runs, every one exits 0: no page error, no unmocked or refused call, a11y clean in light and dark at 390×844 and 360×640. `progress.cjs`: 5 checks without the flag (nothing of A2 or Q-2, no call), 38 with `a5` |

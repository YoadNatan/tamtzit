# דופק הקבוצה (package U: U-1 and U-2)

What package U adds to תמצית in wave 5 (spec §12.5.U, milestones U-1 and
U-2; the approved mockup `proposal/mockups/progress-pulse.html` screen 2
"דופק הקבוצה"), with Yoad's decisions 1 and 3 of 17 Nov 2026, how it is
built, and Yoad's steps to turn it on. Branch `study/w5-u`, on top of
`study/wave4`. U-3 (traps and the museum) is not here: it comes next, on top
of this branch.

## What the group gets

- **The pulse of a lecture** (`?v=pulse&l=`): "דופק הקבוצה · {title}",
  "מתעדכן בלילה · בלי שמות, רק איפה ש-3 לפחות תרגלו", then חם · פושר · יושב
  טוב (only the sections that have rows). A row is "{topic} · {aspect}" with
  its slide tag (opens the slide) and, on the left, the member's own chip
  ("אצלך", with "רק לך" on the first section). "רק אצלך חם, אז זה נכנס לתור
  האישי" under a row that is hot only for the member; "החור שנסגר השבוע" on
  one row at most. A tap practises the topic (`?v=practice&s=t.<topic>`).
  Then "מחר בפגישה:" (tomorrow's meeting on the lecture) or "בפגישה הבאה:":
  the hot point and the question the group quiz would ask first. Footer
  "אפשר לצאת מהספירה ב׳שלי׳."
- **Every lecture** (`?v=pulse`): one row a lecture, "נקודות חמות: …" or
  "הכול יושב טוב".
- **The card on "יחד"**: up to three lectures with hot topics, "עודכן
  הלילה".
- **"לא לכלול אותי בדופק"** under "שלי" → הגדרות. Out means not counted
  and not reading (review SEC-8): the screen says so, and the card goes.
- **"הפסקה הזאת קשה לנו"** in a paragraph's chip row (package N's row;
  "קשה לנו · כדאי להאט" on the reader's own screen while reading aloud).
- **The hooks wave 4 left for U**:
  - J's wall: "דרושות" and the request card "דרושה אסוציאציה. כמה מכם
    שוכחים את זה: …" with its slide and "משלי" · "תנו לי 3 מצחיקות" on the
    paragraph; also at the top of the paragraph sheet's "אסוציאציה" tab. A
    paragraph whose wall has a winner is left out.
  - M's agenda: "נקודה חמה: {topic} · {aspect}" with its slide.
  - Z's quiz picks from the signal (3 confident errors · 2 missed · 1
    split), and so does practice: a course's or topic's never-answered
    questions and the right ones put the group's hard questions first (a
    lecture's reading order and one's own mistakes keep their order).

## Decision 1: no accounts

The addendum counted "three saved accounts that joined a week before"
(review SEC-8). Without accounts a member is the phone they joined from, so
`study_private.pulse_counted` counts members who joined at least 7 days
before and did not opt out, whatever their identity. One person on two
phones is two members; the privacy note says it plainly ("מי שהצטרפו משני
טלפונים נספרים פעמיים"), and P-14 no longer mentions an account. The week
stays, so nobody reaches 3 by joining again today. The sentence of §12.7.5
that decision 1 rewords is in `DECISIONS-2026-11-17.md`'s table, and
`helpCopy.test.ts` checks the new wording word for word.

## Decision 3: a meter instead of a dead end

The floor stays: no word reaches the group from fewer than 3 different
members. Below it, the screens show how far it is, from the night's real
counts (`study_pulse_meter`):

- a lecture with no row yet: "עוד אדם אחד וזה נפתח" (3 minus the most
  members in any of its topics), with a bar, and the member's own rows;
- a lecture with rows and topics still waiting: "5 מתוך 6 נושאים פתוחים ·
  עוד אדם אחד לנושא הבא";
- a group with fewer than 3 counted members: "הדופק נפתח מ-3 מתרגלים: עוד
  אדם אחד וזה נפתח.";
- a member not counted yet: "הדופק מוצג למי שנספרים בו: שבוע בקבוצה,
  והספירה בלילה. הדופק ייפתח לך בעוד 5 ימים." (from their own joining date);
- "אצלך" (the member's own buckets) shows at any count.

The meter says, in effect, that one or two members practised a topic,
never who; the privacy note says that too. The thresholds are in one place:
section U's functions (`study_private.pulse_floor()` 3, `pulse_join_days()`
7, `pulse_window_days()` 28, `pulse_week_days()` 7, `pulse_forget_days()`
60), mirrored by `PULSE` in `shared/study/meters.ts` (every meter's
thresholds, one module since wave 5's integration; `pulse.ts` re-exports it); `shared/study/pulse.test.ts`
reads the SQL file and fails if they differ.

## How it is built

- **SQL, section U at version 1** (between V and J). The night
  (`study_private.pulse_night`, pg_cron `study-pulse-night` at 02:17 UTC, or
  the first read of the study day) counts only signals before the study
  day's start (04:00 Israel time). The numbers stay in `study_private`;
  members read words (`study_pulse_topics`, `_questions`, `_cards`,
  `_spots`) only when the last night counted them. Functions:
  `study_pulse_ready`, `study_pulse_meter`, `study_pulse`, `study_my_pulse`
  (now also returns the topic as written), `study_pulse_brief`,
  `study_pulse_needed`, `study_pulse_reader`. It replaces section Z's
  `study_quiz__signal` (0 while the switch is off) and section M's new stub
  `study_private.meeting__hot_spot` (section M's agenda now calls it; M stays
  at version 1). Traps and the museum wait behind
  `study_private.pulse_night__traps(group, cutoff)`, a stub returning `{}`
  that U-3 replaces further down section U, and `pulse_q.trap_option`,
  `sure_option` already counted for it.
- **The switch `pulse`** (`study_private.features`), off: nothing is
  counted and every output is hidden, whatever the flags. It also governs
  M-2's reader warning (as section M already reads it).
- **The app**: `src/study/lib/pulse.ts` (the calls), `shared/study/pulse.ts`
  (the rules and the words), `components/Pulse.tsx` (the screen, lazy),
  `components/PulseParts.tsx` (the card and the setting, lazy),
  `features/pulse.tsx` (the slot: frames, the paragraph chip,
  `useNeededCards` for J, `TopicLabel`), `styles/pulse.css`. U's share of the
  study entry: 4.3 kB (budget 8 kB).
- **The flag `VITE_STUDY_PULSE`** needs `VITE_STUDY_PROGRESS`
  (`shared/study/flags.ts`, unchanged). Wave 5's integration (`study/wave5`)
  joins A2's section P: with both flags on, `requiredSchema` asks U 1 and
  P 2 (decision 1: no section A), both in the merged SQL. Today's row 8,
  "רק אצלך חם", reads this package's `study_pulse` and `study_my_pulse`
  through Today's slot (`lib/todaySlots.ts`).
- **e2e**: `e2e/study/pulse.cjs` with `e2e/study/mocks/pulse.cjs`, and the
  flag set `u` in `mock.cjs` (wave 4's set with PROGRESS and PULSE; on
  `study/w5-u` sections A and P stood in for A2's, and since the
  integration it runs against the merged SQL itself).

## Yoad's steps

1. **SQL** (Supabase → SQL Editor): run the whole `supabase/study-schema.sql`
   of this branch once. It is safe on release 4's database with its data
   (and on release 3's). Afterwards `select public.study_schema();` shows
   `"U": 1` beside release 4's sections, and
   `select enabled from study_private.features where name = 'pulse';` is
   `false`.
2. **When the group is ready for the pulse** (after A2's progress is in):
   set `VITE_STUDY_PROGRESS=1` and `VITE_STUDY_PULSE=1` in Vercel
   (Production) and redeploy; then turn the switch on:
   `update study_private.features set enabled = true, changed_at = now() where name = 'pulse';`
   The first reader of the next study day (or pg_cron at 02:17 UTC) counts.
3. **To stop it at once**: the same `update` with `false`. Nothing is
   counted and nothing is shown from that moment; the flag can stay.

## The checks (this branch, final code)

| Check | Result |
|---|---|
| `npm run test:study` | 637 tests, 637 pass (new: `shared/study/pulse.test.ts`, `src/study/lib/pulse.test.ts`; `route.test.ts`'s registry with U 1; `helpCopy.test.ts` reads decision 1's rewording) |
| `npm run test:contract` | 163 RPC calls and 104 table chains in 176 files match the schema (218 study functions, 59 study tables); 15 written columns granted |
| `npm run build` | passes; the study entry 327.68 kB (limit 400 kB) |
| `npm run test:bundle` | 339,556 bytes with every flag on; U's share 4,294 B; no package screen in the entry |
| The whole SQL twice on throwaway Postgres 16, then `supabase/tests/study.sql` | 0 load errors; 0 FAIL, 0 ERROR (727 "ok" lines; section U's 60: U0-U6, D1-D1c, MT1-MT4d, U4-U4f, U5-U5j, U-reg); registry `{"B": 1, "C": 2, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "Q": 2, "U": 1, "V": 1, "W": 2, "Z": 2}` |
| Upgrade from `study/wave4`'s SQL with data (its checks 0 FAIL, then a lecture, a part, a question, an answer, a card and a review), then this file twice | 0 errors each run; 54 tables and 41 rows kept, the content's hash unchanged; 5 new tables, empty; `pulse` off; the cron job `study-pulse-night` scheduled; a forced night on the upgraded data counts the group and shows nothing (below 3) |
| The same from `study/wave3`'s SQL | 0 errors; 36 tables and 41 rows kept, same hash; wave 4's and U's 23 tables new and empty |
| Health's `schemaOk` (server `REQUIRED_SCHEMA` and each set's flags) | true for no flags, production's (`rel1`) and wave 4's, on wave 4's SQL and on this one; with PROGRESS and PULSE, false until A2's sections A 1 and P 2 are in (and U 1, which this SQL has) |

The e2e flows on the mocked Supabase, four builds: `off`, `rel1`
(production's), `w4` (wave 4's) and `u` (wave 4's with PROGRESS and PULSE;
`E2E_SCHEMA=u`). As in release 4, the release scripts run as `rel2` and
`ahead` as `k` in the `w4` and `u` builds. Every script exited 0 with no
page error, no unmocked or refused call and no accessibility problem
(`a11y.cjs`, light and dark, 390×844 and 360×640).

| Script | off | rel1 | w4 | u |
|---|---|---|---|---|
| `pulse.cjs` (U) | 4 ok (nothing of U) | 4 ok | 5 ok | 44 ok |
| `ahead.cjs` | 3 ok | 11 ok | 11 ok | 11 ok |
| `anchor.cjs` | 3 ok | 3 ok | 18 ok | 18 ok |
| `cards.cjs` | 2 ok | 26 ok | 26 ok | 26 ok |
| `collab.cjs` | pass | pass | pass | pass |
| `meeting.cjs` | 4 ok | 4 ok | 53 ok | 53 ok |
| `practice.cjs` | 3 ok | 57 ok | 57 ok | 57 ok |
| `quiz.cjs` | 2 ok | 2 ok | 47 ok | 47 ok |
| `shell.cjs` | 31 ok | 30 ok | 31 ok | 31 ok |
| `summary.cjs`, `together.cjs`, `upload.cjs` | pass | pass | pass | pass |
| `var.cjs` | 4 ok | 4 ok | 37 ok | 37 ok |
| `wall.cjs` | 5 ok | 5 ok | 36 ok | 36 ok |
| `writing.cjs` | 42 ok | 42 ok | 42 ok | 42 ok |

Known gaps: the paragraph sheet's "דרושה אסוציאציה" line is checked only by
type and build, not by an e2e step; a real pg_cron night and two real
phones are production's to show; the reader's "קשה לנו · כדאי להאט" is
built but not driven by an e2e step (meeting.cjs reads aloud without the
pulse's mock data).

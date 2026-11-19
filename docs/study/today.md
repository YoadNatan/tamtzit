# Today ("היום", T-1) and C's review in it

Branch `study/w5-t`, on `study/wave4`. Release 8 of the addendum
(`spec/addendum/addendum.md` §12.4.T's T-1 and §12.3.C's review items),
built as Yoad's decisions of 17 Nov 2026 change them
(`DECISIONS-2026-11-17.md`). T-2 ("הקבוצה צריכה אותך", the exam-eve view)
is not built here.

## What a member sees

With `VITE_STUDY_TODAY` on, `/` opens Today and the tabs are היום ·
ספרייה · יחד · שלי (`proposal/mockups/today.html` s1):

- **"היום · יום ג׳"**, then the day's meeting (M's band: "הקבוצה היום ·
  09:00", the slides, the title, who reads, "ניחוש לפני" with M-2).
- **"פגישה שפספסת · {lecture}"** with "השלמה · {n} דק׳" when she missed a
  meeting of the last 7 days (with `VITE_STUDY_GUESS`); it opens M's
  catch-up (today.html s2), whose back reads "→ להיום".
- **"התור שלי"** with "רק לך" and the chips **10 · 20 דק׳ · 45** (per
  device, `study-today-minutes`). The rows of her cut, grouped, each with
  its chip and an example with its slide:

  | Row | Words | Chip | Flag |
  |---|---|---|---|
  | 1 | "עדכון בסיכום" (V) | "תוקן אחרי שלמדת" | `VAR` |
  | 2 | "{n} מהמבחן הקבוצתי" (a live-quiz miss, the next study day) | "טעית אתמול" | `QUIZ` |
  | 3 | "1 מרשימת הסכנה, בניסוח חדש" (A2's list, its first due row) | "על בטוח" | `PROGRESS` |
  | 3b | "{n} טעויות בניסוח אחר" (Q-2; a slot the integrator wires) | "בניסוח אחר" | `PROGRESS` (mistakes) |
  | 4 | "פסקה שסימנת ׳לא ברור׳" (M) | "מהפגישה" | `MEETING` |
  | 5 | "{n} כרטיסים" (C's queue: due, then new with trap and private cards first, 20 new a day) | "הגיע הזמן" / "מלכודת של הקבוצה" | `CARDS_REVIEW` |
  | 6 | "{n} מהמבחן הקבוצתי" (the third day) | "טעית לפני 3 ימים" | `QUIZ` |
  | 7 | the boss's loot (H, phase 3) | "מהקרב" | `BOSS` |
  | 8 | "תרגול קצר · {topic}" (U's "רק אצלך חם"; a slot) | "חלש אצלך, ולא אצל הקבוצה" | `PULSE` |
  | 9 | the private lane (G, phase 3; a slot) | "מהמסלול שלך" | `GROUP_PLAN` |

  The cut is greedy in that order, oldest first inside a row: a row that
  does not fit is skipped and a shorter one after it may still go in; at
  least one item always goes; what is left rolls over silently. Each item's
  estimate: an update 30 s, a question 75 s (a case 120 s), a paragraph
  90 s, a card 30 s, a topic 3 min (`shared/study/today.ts`, one table).
- **"להתחיל · {n} דק׳"** and the flame **"להבה 4/7"**: a tap shows "4
  מתוך 7 הימים האחרונים. 4 ימים מדליקים אותה, ויום אחד בלי לא מכבה אותה.
  גלוי רק לך." A day counts when she answered a question, reviewed a card,
  tapped "לא ברור", was at a meeting, guessed before one, caught up, or
  (with A2) finished reading a part.
- **"בקבוצה"**: the newest open question of another member, "שאלה פתוחה ·
  {name}, {when}" and "לענות" (to its paragraph).
- **"תרגול חופשי"** (with questions). An empty queue: "אין כלום בתור
  כרגע." and "תרגול חופשי".
- **The session** (`?v=today&run=1`, immersive, "→ להיום", "התור שלי",
  "{done}/{total}", the step's reason, "רק לך"): the day's order is kept
  in sessionStorage (`study-today:<user>:<day>`), so Back from the reader
  returns to the same step. Each kind through its owner's component: V's
  "עדכון" card ("הבנתי"); a quiz return and the danger row as practice's
  question with the bet, mode "mistakes" (the danger row in its other
  wording; "במבחן הקבוצתי הבנת בדיון. עכשיו לבד." when vote 2 was right);
  the "לא ברור" paragraph with "לפסקה" and "הבנתי"
  (`study_unclear_done`); the cut's cards as C's review session, then back
  to the next step; the slots' rows open their route ("לתרגל"). The end:
  "התור של היום הושלם. מה שנשאר עובר למחר."

### C's review (`VITE_STUDY_CARDS_REVIEW`, cards.html s1-s2)

C's end (`study/w3-c`) built the review screens: the queue with decision
8, private cards with their origin chip, "הבא בתור · מטעות שלך", "מאיפה
זה?", the review home asked once (`ReviewHomeSheet`, `ReviewHomeSetting`).
This branch adds what Today needs of it:

- once Today is the home, the review's back reads **"→ להיום"** and its end
  offers "להיום" (cards.html s1);
- with the wall's hint shown after two lapses, the line under the top reads
  **"שכחת את הכרטיס הזה פעמיים, אז מגיע רמז"** (cards.html s2);
- the review runs inside Today's session for the cut's number of cards,
  under its own kept session, then hands back;
- Today's card count is the session's own queue (`lib/cardsScope.ts`, read
  by both); with Anki as her review home Today shows no cards (C6).

## Decisions 1 and 3

- **Decision 1 (no accounts).** Today waits only for its own flag:
  `flags.today` is `VITE_STUDY_TODAY` alone (it needed `PROGRESS`), and
  each row waits for its own flag, so a build with Today and the review on
  production's flags shows the cards, and nothing else is promised. In-app
  review needs nothing but `VITE_STUDY_CARDS` (`cardsReview: cards &&
  VITE_STUDY_CARDS_REVIEW`, section C at 2, as before). Everything here is
  the member's own: the device's anonymous identity; owner-only stays
  owner-only (no other member's row ever reaches study_today's answer,
  checked in SQL T5f and in `today.cjs`).
- **Decision 3** does not touch T-1: Today is not a phase-3 extra. Its one
  "meter" is the flame, which counts her own days and is never blocked;
  nothing on Today waits for 3 members. T-2 ("הקבוצה צריכה אותך") is
  phase 3's and is left to its package.

## The rows other packages add (wired in wave 5's integration)

`src/study/features/today.tsx`'s `TODAY_SLOTS` holds three loaders (each is
called only with its flag on). `again` and `pulse` are wired on
`study/wave5`: they load `src/study/lib/todaySlots.ts` lazily, and their
rules are `shared/study/todaySlots.ts` (`todaySlots.test.ts`). In the
session, a run of `again` items is one practice session of that many
questions, and a row's step is saved before it opens its route, so Back
returns to the next step. `today.cjs` checks both rows with the flag set
`w5`. As T-1 left them for the integrator:

- **`again`** (Q-2, `flags.mistakes`): from A2's `myProgressCounts(group)`
  (`src/study/lib/progress.ts`), `again_due` minus the danger row Today
  already holds, one item per question: `{ key: "again:<n>", kind:
  "again", seconds: 0, at: "", ref: { route: { v: "practice", s:
  "r.<group>", n: "<count>" } } }`.
- **`pulse`** (U-2, `flags.pulse`): U's `getMyPulse` and `getPulse`
  (`src/study/lib/pulse.ts`) merged with `mergePulse`
  (`shared/study/pulse.ts`), each topic hot for her and not hot for the
  group: `{ key: "practice:<topic_key>.<aspect>", kind: "practice",
  seconds: 0, at: "", example: pulseLabel(topic, aspect), ref: { route: {
  v: "practice", s: "t.<topic_key>", n: "5" } } }`.
- **`lane`** (G, phase 3).

The danger row (A2) needs no wiring: section T reads section P's
`study_my_danger_list` by name, and the row shows with `flags.progress`.
`NeedsMeCard` and `NeedsMeSetting` are T-2's seeds. When A2's branch is
merged, `route.test.ts`'s registry line gains P beside T, and help's
"היום" row already names the danger row with progress.

## The SQL: section T at version 1

The last section of the file, between its markers. Functions only, no
table, nothing published:

| Function | What |
|---|---|
| `study_today(p_group)` | everything the queue needs in one call: `quiz_returns` and `danger` (with each question's stem, kind and slides, never its key), `unclear`, `updates`, `missed`, `loot`, `needs_me`, `open_question`, `flame`, `day`; "group not found" for a stranger |
| `study_my_quiz_returns(p_group, p_now)` | Q9: wrong first votes of the last 30 days, step 1 from the next study day, step 2 from the third, "הבנתי בדיון" when vote 2 was right |
| `study_my_danger(p_group, p_now)` | the danger list's first due row (section P's, read by name: none without P) |
| `study_my_flame(p_group, p_now)` | T5: active days among the last 7, lit from 4 (section P's reading log by name) |

Section P's danger list and reading log, section H's loot and T-2's
`study_needs_me` are looked up at run time, so the section loads on M, N, V
and the spec's sections alone (stage "T without U J H B G E") and on A2's
section P (checked: this file with `study/w5-a`'s section P spliced in, the
whole test file 0 FAIL, T3 against P's own list).

**Yoad runs** (after release 4's SQL, `RELEASE-4.md`): the whole
`supabase/study-schema.sql` once in the SQL Editor. It is re-runnable; on
release 4's database it only adds section T. Then
`select public.study_schema();` answers `{"B": 1, "C": 2, "F": 1, "J": 1,
"K": 2, "M": 1, "N": 1, "Q": 2, "T": 1, "V": 1, "W": 2, "Z": 2}`.

## The flags

| Flag | Shows | Needs |
|---|---|---|
| `VITE_STUDY_TODAY` | Today as the home, its tabs, the session | section T at 1 |
| `VITE_STUDY_CARDS_REVIEW` (with `VITE_STUDY_CARDS`) | in-app review, its sessions and settings, Today's cards row | section C at 2 |

Turn on `VITE_STUDY_TODAY` only after the SQL above (health's `schemaOk`
asks T 1 with it); `VITE_STUDY_CARDS_REVIEW` needs nothing more than the
cards' release. Production's flags (`QUESTIONS`, `PRACTICE`, `CARDS`) are
unchanged and need nothing new.

## Tests

```bash
npm run test:study -- today route helpCopy   # shared/study/today.test.ts (T-2), the routes, help
npm run test:contract                        # study_today and the reads against the SQL
```

- SQL (T-1, `supabase/tests/study.sql`, section T's checks on fixtures of
  their own): T1-T1d the flame (4/7 lit, another's 1/7, a missed day never
  resets it, a part read), T2-T2e quiz returns (step 1, answered today,
  step 2, a hidden question, hers alone), T3-T3c the danger row is the
  list's first due row (a stand-in for the list where P is not loaded),
  T5-T5f every source, the key never shown, "בקבוצה" never her own, T6-T6e
  strangers and anon refused, nothing published, T-reg, T7 the fixtures
  gone.
- e2e (T-3, `e2e/study/today.cjs` with `e2e/study/mocks/today.cjs`), flag
  set `t` (wave 4's set with `TODAY` and `CARDS_REVIEW`):

  ```bash
  VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
    VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 VITE_STUDY_ANCHOR=1 \
    VITE_STUDY_CORRECTIONS=1 VITE_STUDY_ASK=1 VITE_STUDY_VAR=1 VITE_STUDY_WALL=1 VITE_STUDY_MEETING=1 \
    VITE_STUDY_GUESS=1 VITE_STUDY_TODAY=1 VITE_STUDY_CARDS_REVIEW=1 npx vite build --outDir /tmp/study-t
  E2E_FLAGS=t NODE_PATH=$(npm root -g) node e2e/study/today.cjs /tmp/study-t /tmp/today-t
  ```

  Without `TODAY` (`off`, `rel1`, `w4`) it checks that nothing of T shows
  and study_today is never called.

## The checks of this branch (17 Nov 2026)

| Check | Result |
|---|---|
| `npm run test:study` | 639 tests, 639 pass |
| `npm run test:contract` | 159 RPC calls and 99 table chains in 178 files match the schema (215 study functions, 54 study tables) |
| `npm run build` | passes; the study entry 325.00 kB (limit 400 kB); 325.04 / 325.10 / 325.28 / 325.32 kB in the e2e builds off, rel1, w4, t |
| `npm run test:bundle` | the entry 336,588 bytes with every flag on; T's share 403 B; no package screen in it |
| The whole SQL twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql` exits 0, 0 FAIL, 0 ERROR (701 "ok"); the registry above |
| The same with `study/w5-a`'s section P spliced in | 0 errors, 0 FAIL (747 "ok"); T3 compares with P's own danger list |
| Upgrade: `study/wave4`'s file with its checks' data and a live-like lecture (a written part, a question with its key, a quiz miss, a card on a paragraph, an open question, yesterday's meeting with a "לא ברור" tap), then this file twice | 0 errors; all 43 rows of the 54 tables unchanged (same hash); `study_today` on that data: 1 quiz return, 1 "לא ברור", the flame 1/7 |
| Upgrade from `study/wave3`'s file the same way | 0 errors; 36 → 54 tables, all 41 rows unchanged |
| Health's `schemaOk` (`healthSchema`) | production's flags: true on wave 3's, wave 4's and this SQL; wave 4's: true on wave 4's and this; with `TODAY` (and `CARDS_REVIEW`): true on this SQL only (it asks T 1) |

Every e2e script in `e2e/study/` on four builds, each against this
branch's SQL registry: `off`, `rel1` (production's flags), `w4` (wave 4's)
and `t` (wave 4's with `TODAY` and `CARDS_REVIEW`); as in release 4, the
release scripts ran as `rel2` on the wave builds (`cards` as `review` on
`t`) and `ahead` as `k`. Every script exited 0, with no page error, no
unmocked or refused call, and every screenshot clean in `a11y.cjs` (light
and dark, 390×844 and 360×640). `today.cjs` also ran on every flag
(`all`): 48 checks, the danger row in its place.

| Script | off | rel1 | w4 | t |
|---|---|---|---|---|
| ahead | 3 ok | 11 ok | 11 ok | 11 ok |
| anchor | 3 ok | 3 ok | 18 ok | 18 ok |
| cards | 2 ok | 26 ok | 26 ok | 37 ok (review) |
| collab | pass | pass | pass | pass |
| meeting | 4 ok | 4 ok | 53 ok | 53 ok |
| practice | 3 ok | 57 ok | 57 ok | 57 ok |
| quiz | 2 ok | 2 ok | 47 ok | 47 ok |
| shell | 31 ok | 30 ok | 31 ok | 31 ok |
| summary, together, upload | pass | pass | pass | pass |
| var | 4 ok | 4 ok | 37 ok | 38 ok |
| wall | 5 ok | 5 ok | 36 ok | 36 ok |
| writing | 42 ok | 42 ok | 42 ok | 42 ok |
| today | 4 ok | 4 ok | 4 ok | 47 ok |

With Today on, `/` is Today, so `cards`, `practice` and `quiz` open
the library at `?v=library`, `upload` and `summary` reach it by its tab,
`shell` waits for Today's own screen, and `var` finds "עדכון" as the first
row of Today's queue. K's approval list sits tighter so "לאשר" stays on
screen at 390×844 with Today's third line ("׳עדכון׳ ב׳היום׳").

Known gaps:

- The live banner is hidden on Today (§12.2.1); Today shows Z's quiz line
  under the band, and M's band shows a meeting's reading. A member reading
  aloud outside a meeting shows on "יחד", not on Today.
- The queue's rows follow the table of §12.4.T (review F-9): cards come
  after "לא ברור", where today.html s1 drew them first.
- The rows of Q-2 and U-2 come through `TODAY_SLOTS` (wired on
  `study/wave5`, above).

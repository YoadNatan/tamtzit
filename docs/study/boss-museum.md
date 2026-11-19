# מוזיאון המלכודות וקרב הבוס (packages U-3 and H-1)

What wave 5's last two fun packages add to תמצית (spec §12.5.U's U-3 and
§12.5.H's H-1; the approved mockups `proposal/mockups/museum.html` and
`proposal/mockups/boss.html`), with Yoad's decisions 1 and 3 of 17 Nov 2026,
how they are built, and Yoad's steps. Branch `study/w5-h`, on top of
`study/wave5` (U-2's pulse is their base).

## What the group gets

### The trap museum (U-3, `VITE_STUDY_MUSEUM`)

- **A trap**: a wrong option that at least 3 counted members chose (their
  first answer of a study day, in the night's 28-day window). Found by the
  night, it opens the next study day; then its card joins every member's deck
  through C's queue, first among the new cards ("מלכודת של הקבוצה").
- **An exhibit** ("מוצג"): a trap at least 3 counted members chose "על
  בטוח". Numbered per lecture, it opens in the museum the next study day, so
  nobody can tell who from when it appeared.
- **The museum** (`?v=museum`, one lecture with `l`), museum.html s1:
  "מוזיאון המלכודות · {course}" with the number of exhibits; "רק טעויות ׳על
  בטוח׳ של לפחות 3 מכם · **בלי שמות**"; the newest exhibit still hanging as
  a card (its number, "חדש" · "עוד נופלים" · "עדיין תלוי", the claim in
  quotes, the plaque's line "אמנים: כמה מכם. חומרים: ביטחון עצמי, שקף 27.",
  "האמת:" and "מה בלבל:" with their slides); "עוד במוזיאון · פנסיה: כולם
  צודקים ביומיים שונים" with the rest, "בפנסיה" last; the footer "מוצג נפתח
  רק למחרת, כדי שאי אפשר יהיה לנחש מי."
- **Retirement** ("בפנסיה"): at least 3 members, and every member active in
  the last 14 days, answered it right on two different study days since it
  opened (the latest right). Its card leaves the decks; the exhibit stays,
  retired. "עוד נופלים": a third or more of those who tried it since are
  wrong now. A question retired, hidden, marked by a correction or flagged
  as wrong withdraws its trap and its card.
- **The vaccine** in C's review (museum.html s2): the one chip "חיסון ·
  ממוזיאון המלכודות" with "מוצג מס׳ n", and "למה זה כאן?" on its back.
- **The card on "יחד"**: the newest exhibit and the meter.
- **The meeting's opening** (MU4): a meeting of today opens with one
  exhibit of its lecture, "פותחים במוצג מהמוזיאון · 30 שניות", marked shown
  once, then "ממשיכים בהקראה".

### The boss battle (H-1, `VITE_STUDY_BOSS`)

- **A new battle** (`?v=boss`, `?v=boss&new=1`), boss.html: the lectures to
  fight on (every lecture, or one), the heads a battle would have now (2-4:
  the pulse's hot topics, then the museum's exhibits), the meter, the
  seconds a question, "קרב צריך לפחות 3 משתתפים", and "לפתוח את הקרב": Z's
  lobby of a quiz in mode "boss" (`?v=quiz&q=`). A lost battle's "סבב
  נקמה" opens there from the next study day, with the heads still standing.
- **The battle** on Z's engine: up to 3 questions a head, in head order. A
  round counts from 3 answers. The head on screen loses up to its share (in
  full from 80% right, "עברנו"); the team loses up to 150/planned × the wrong
  share, at least 20 HP when half the answers fall for the head's trap. A
  head still standing after its questions relapses (twice at most): it
  regains half a share and its key question comes back; answered 80% right,
  it falls at once. All heads down: won; the team at 0, or nothing left to
  ask: lost. **The HUD** (boss.html s1) above the clock: "ראש 3/4", both HP
  bars, a chip a head (fallen ✓, the one on screen marked), the relapse
  line, the trap's callout, what the last reveal did, and "תשובה נכונה
  מורידה לבוס חיים. טעות עולה לקבוצה, אף פעם לא לאדם אחד."
- **The end** (boss.html s2): "הבוס הובס!" with the team's HP and its ring,
  who played (participation, never a score), "רגעי הקרב · של הקבוצה, בלי
  שמות" (a trap's −20, a relapse, a head that fell), and "השלל שלך: 4
  טעויות, 3 ימים · רק לך" with "לתוכנית שלי". Lost: no defeat screen, the
  heads still standing and tomorrow's revenge round.
- **The loot in Today** (row 7, "מהקרב"): each saved mistake comes back on
  its day as "שאלה אחת מהקרב", answered alone; answered, it leaves the loot.
- **The card on "יחד"**: the heads, the meter, the revenge round.

## Decision 1: no accounts

Both packages read the pulse's count as section U already counts it: a
member of a week who did not opt out, whatever their identity. The museum,
the trap badges and the boss's heads are shown only to a member the last
night counted (review SEC-8, reciprocity); a member not counted yet sees
when they open ("המוזיאון ייפתח לך בעוד 5 ימים", "הראשים ייפתחו לך …"),
from their own joining date; an opted-out member, how to come back. Nothing
mentions an account. In a battle every player sees the heads on the HUD,
as the battle is the group's. The loot is owner-only between members.

## Decision 3: usable early, with a meter

Both open as soon as there is anything to show, and say beside it what more
is needed, from real counts:

- **The museum**: "2 מוצגים · עוד 4 הימורי ׳על בטוח׳ שגויים למוצג הבא". The
  night records, from its own window, the most counted members who bet one
  wrong option of one question "על בטוח" short of an exhibit; the meter
  says 3 minus that (never which question, never who). An exhibit found
  tonight says "מוצג חדש נפתח מחר" instead. An empty museum is an empty state
  with the meter and "לתרגל"; a group with fewer than 3 counted members says
  "המוזיאון נפתח מ-3 מתרגלים: עוד אדם אחד וזה נפתח."
- **The boss**: "3 מתוך 8 נושאים חמים · עוד כ-20 תשובות לנושא הבא": the hot
  topics (and exhibits) the chosen lectures have, out of the topics their
  askable questions have; and, for the topic closest to the floor (the one
  with the most members below 3), the members it still needs times the
  group's own answers per member and topic in the night's window, rounded
  up ("כ-"): roughly how many more answers before the night can weigh the
  next topic. With every topic weighed, only the first half shows. Below 2
  heads the screen stays open: "הקרב נפתח משני נושאים חמים: עוד נושא אחד."
  with "לתרגל", and "לפתוח את הקרב" waits.
- **The floor stays.** Nothing anonymous reaches the group from fewer than
  3 members: a trap, an exhibit and a boss head each need 3, a battle needs
  3 players, and a round with fewer than 3 answers counts for nothing.
  Below the floor the meters say how far it is, never who.
- **The thresholds are in one place.** Section U's functions
  (`pulse_floor()` 3, `museum_retire_days()` 2, `museum_active_days()` 14,
  `museum_new_days()` 3) and section H's (`boss_min_heads()` 2,
  `boss_max_heads()` 4, `boss_head_questions()` 3, `boss_players()` 3,
  `boss_trap_hp()` 20, `boss_relapses()` 2, `boss_hit_pct()` 80,
  `boss_loot_days()` 3) are mirrored by `MUSEUM` and `BOSS` in
  `shared/study/meters.ts` (every meter's thresholds, one module since wave
  5's integration; `museum.ts` and `boss.ts` re-export them).
  `museum.test.ts`, `boss.test.ts` and `meters.test.ts` read them from the
  SQL and fail if they differ, and check that the night's hook and the
  battle's hook use the functions, never literals.

## How it is built

- **SQL**, section U at version 2 (U-3's block at the end of section U):
  `study_traps` (no read policy: read only through the definer functions),
  the night's hook `study_private.pulse_night__traps` replaced (same name,
  arguments and result), `trap_make` (C's `study_private.trap_card`, key
  `q:<question>:<option>`, so the live quiz's trap of the same option is the
  same card), `trap_unmake`, `trap_add`, `study_museum`, `study_museum_meter`,
  `study_trap_cards`, `study_museum_pick`, `study_museum_shown`, and for the
  plaque op `study_trap_plaque_begin` and `study_trap_plaque`.
  The night's `counted` now also has `traps_open`, `exhibits` and
  `exhibit_need`.
- **SQL**, section H at version 1: it refuses to load without Z's boss hooks
  or U's traps; `study_boss_battles` (members read), `study_loot`
  (owner-only), `study_boss_open`, `study_boss_create`, the three Z hooks
  (`study_quiz__pick_boss`, `__after_reveal`, `__boss_state`), `study_boss_loot`,
  `study_boss_loot_save`, `study_my_loot` (Today's row 7; with the question,
  topic, slides and kind) and `study_loot_done`. No Claude: a battle costs $0.
- **The app**: `components/Museum.tsx` and `components/Boss.tsx` (the
  screens, lazy), `components/MuseumParts.tsx` and `components/BossParts.tsx`
  (the cards, the badge, the meeting's exhibit, the HUD, the end; their own
  chunks), `lib/museum.ts`, `lib/boss.ts`, `shared/study/museum.ts`,
  `shared/study/boss.ts`, `styles/museum.css`, `styles/boss.css`; the
  frames in `features/pulse.tsx` and `features/boss.tsx`. Small edits in
  other packages' files: Z's `Quiz.tsx` (the HUD above the clock and in the
  lobby; the battle's own end; "קרב הבוס" as the lobby's title) and
  `QuizParts.tsx` (the mode's line), C's `CardReview.tsx` (the trap card's
  one chip and "למה זה כאן?"), M's `MeetingScreen.tsx` (the opening exhibit),
  T's `lib/today.ts` and `TodaySession.tsx` (the loot's row). U's and H's
  share of the study entry: about 5.9 kB and 1.3 kB.
- **Flags**: `VITE_STUDY_MUSEUM` (needs `PULSE`, so `PROGRESS`, and `CARDS`)
  and `VITE_STUDY_BOSS` (needs `PULSE` and `QUIZ`). `requiredSchema` asks U at
  2 with either, and H at 1 with the boss (`shared/study/flags.ts`); the op
  `plaque` needs U 2 (`server/study/study.ts`). Production's flags and wave
  4's need neither, so health's `schemaOk` holds for them before and after
  this SQL.
- **Help and the privacy note** (`lib/helpCopy.ts`): each package's help row
  names its meter with the approved example; the privacy note's counting
  paragraph says what the meters show and that they never say who.

## Deferred

- **The plaque by Claude** (op `plaque`, `PLAQUE_SYSTEM`, about $0.01 an
  exhibit): not built. The museum shows the exhibit's own text instead (the
  trap option in quotes and "אמנים: כמה מכם. חומרים: ביטחון עצמי, שקף n."),
  so nothing is sent to Anthropic for the museum. The SQL for its
  hold and write is in (`study_trap_plaque_begin`, checked: server key only,
  `busy`, `checked`); the op's server seed still answers 501 "not built".
  Its prompt needs Yoad's live check before its flag, as every new prompt.
- **The marathon medal** of boss.html s2 ("מדליית מרתון") belongs to G's
  marathons; the end says "על השתתפות, לא על ציון." without it.
- **Narrated attacks** in the HUD (boss.html's "Artemisinin תוקפת: ׳אני
  לבד מספיקה!׳") would need Claude per question; the HUD names the head
  and its trap instead.

## After the wave-5 review (section H at 2)

- Members no longer read `study_boss_battles` table-wide (review
  H-BATTLE-ROW-READ). A column grant leaves out `heads` (the pulse's hot
  topics, each head's questions and open trap), `rounds` (the planned
  questions in order, which section Z hides) and `log`. The app never read
  the table: the HUD comes through `study_quiz_state`. Checks HB6c-HB6h.
- The boss's meter bar fills what its line says (`bossBar()`: the hot topics
  out of the topics weighed, or the counted members out of the floor), and
  the heads' chip reads "ראש אחד" and shows nothing at 0 (`headsChip()`).
  The museum's bar below the floor takes `MUSEUM.FLOOR`, and its "0" chip is
  gone.

## Yoad's steps

1. **SQL** (Supabase → SQL Editor): run the whole `supabase/study-schema.sql`
   of this branch once. It is safe on release 4's database with its data
   (`study/wave4`), on release 3's (`study/wave3`) and on wave 5's.
   Afterwards `select public.study_schema();` shows `"U": 2` and `"H": 1`.
2. **The switch `pulse`** must be on (it is the pulse's, package U-2): the
   night counts the traps and exhibits with everything else, and the boss's
   heads are its hot topics.
3. **The flags**, any time (decision 3), after `VITE_STUDY_PROGRESS` and
   `VITE_STUDY_PULSE`: `VITE_STUDY_MUSEUM=1` and/or `VITE_STUDY_BOSS=1` in
   Vercel (Production), and redeploy. Each opens at once with its meter.
4. **To stop**: the switch `pulse` off hides the museum, the badges and the
   heads at once; the flags can stay.

## The checks (this branch, final code)

| Check | Result |
|---|---|
| `npm run test:study` | 663 tests, 663 pass (new: `shared/study/museum.test.ts`, `shared/study/boss.test.ts`; `route.test.ts`'s registry with U 2 and H 1 and the schema the museum and the boss need; `ai.test.ts` records the plaque op's U 2) |
| `npm run test:contract` | 181 RPC calls and 104 table chains in 192 files match the schema (256 study functions, 69 study tables) |
| `npm run build` | passes; the study entry 333.89 kB (limit 400 kB) |
| `npm run test:bundle` | 346,051 bytes with every flag on; U's share 5,932 B, H's 1,305 B; no package screen in the entry |
| The whole SQL twice on throwaway Postgres 16, then `supabase/tests/study.sql` | 0 load errors; 0 FAIL, 0 ERROR (874 "ok" lines; new: MU0-MU5 in section U, HB0-HB7 and H-reg in section H); registry `{"B": 1, "C": 2, "F": 1, "H": 1, "J": 1, "K": 2, "M": 1, "N": 1, "P": 2, "Q": 2, "T": 1, "U": 2, "V": 1, "W": 2, "Z": 2}` |
| Upgrade from `study/wave4`'s SQL with data (its checks 0 FAIL), then this file twice | 0 errors each run; 54 tables and 47 rows kept, the content's hash unchanged; 15 new tables, empty; `pulse` off; the member's reads (progress, Today, the pulse's, the museum's and the boss's meters, the loot) answer |
| The same from `study/wave3`'s and from `study/wave5`'s SQL | 0 errors; 36 and 66 tables kept with their rows, same hash |

The e2e flows on the mocked Supabase, four builds: `off`, `rel1`
(production's), `w4` (wave 4's) and `h5` (wave 5's `w5` with
VITE_STUDY_MUSEUM and VITE_STUDY_BOSS). Every script exited 0 with no page
error, no unmocked or refused call and no accessibility problem (`a11y.cjs`,
light and dark, 390×844 and 360×640), with one exception: `meeting.cjs` on
`h5` failed one step ("before planning") in the parallel run, as it did on
`study/wave5`, and passed twice when run alone (53 checks).

| Script | off | rel1 | w4 | h5 |
|---|---|---|---|---|
| `museum.cjs` (new) | 3 | 3 | 3 | 25 |
| `boss.cjs` (new) | 3 | 3 | 3 | 37 |
| the other 17 scripts | pass | pass | pass | pass (meeting: see above) |

Screenshots: `wave5-shots/h/` in the session's scratchpad (each new screen
light and dark at 390×844, and side-by-sides with museum.html and boss.html).

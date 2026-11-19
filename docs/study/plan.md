# The group's marathon plan (G), marathons, "הקבוצה צריכה אותך" (T-2) and the exam-eve view

Branch `study/w5-g`, on `study/wave5`. The addendum's phase 3 items
§12.6.G (package G) and §12.4.T's T-2, with the exam-eve view (§12.3.A's
PR6, which decision 3 lists with T-2), built as Yoad's decisions of 17 Nov
2026 change them (`DECISIONS-2026-11-17.md`): no account (decision 1), and
the extras open early, with a meter instead of a lock (decision 3).

## What a member sees

### The plan (`?v=plan`, `VITE_STUDY_MARATHONS` + `VITE_STUDY_GROUP_PLAN`; plan.html)

- **No plan yet:** "עוד אין תוכנית. מזינים את מבחן הבלוק פעם אחת, והתוכנית
  נבנית לבד." and "לבנות תוכנית". Never a dead end.
- **The setup** (s2, "תוכנית עד המבחן"): the exam's name and date, its
  lectures (all checked: "כל ההרצאות של הבלוק מסומנות. מכאן התוכנית נבנית
  לבד."), "מ-3 שבועות לפני · סבב משותף על כל הסיכומים · כ-3 שעות ביום"
  (2, 3 or 4 hours), "בחופש הלמידה · שחזורים, ומה שלא ישב טוב · כ-10 שעות
  ביום" (8, 10 or 12), "כל הרצאה חוזרת 3 פעמים" (2-4) with the growing
  gaps, and "כולם יכולים לערוך, ועל כל שינוי יש שם." Any member saves it;
  every change carries a name.
- **A day** (s1): "מרתון · {title}" with "יום 6/14"; the phase and "המבחן
  ב-7.12"; the marathon meter ("ק״מ 21 ✓ כל הסיכומים נקראו" once every
  lecture was read by half the members · "ק״מ 42: המבחן"); decision 3's line
  **"התוכנית מדייקת ככל שמתרגלים: N מתוך M הרצאות עם נתונים"** and how far
  the nearest lecture is ("עוד כ-12 תשובות ועוד אדם אחד להרצאה הבאה");
  **"המסלול הקבוצתי"** with "שינוי אחרון: {name}" and the day's blocks (the
  time, the lecture, its slides, "הקראה ומבחן קבוצתי, 5 שאלות", "בעוד 20
  דק׳" within 90 minutes, "הוזז מאתמול"); **"המסלול שלך" · "רק לך"**; the
  days before and after; "לערוך את התוכנית".
- **A day that slipped** (s2's card, in the warning colours, never red):
  "אתמול לא הספקנו את {lecture}" with its slides, "הבלוק זז להיום. כדי לסיים
  בזמן, בוחרים מחיר:" and the two prices "עוד שעה ביום עד שישי" · "לוותר
  על יום חזרה אחד". The choice is saved with the name. Nothing is called
  late and nothing counts what is late.
- **The private lane** (PL3; also `?v=plan&lane=mine` from "שלי"'s "המסלול
  שלך במרתון"): due cards and open mistakes, a relearning round that is due
  ("{lecture} · סבב 2" · "2 שאלות מפתח עד סוף הסבב"), a lecture the group
  read without her ("השלמה · {lecture}"), and topics hot only for her
  (with the pulse). Empty: "אין כרגע כלום במסלול שלך. כשמתרגלים, הוא
  מתמלא." Today's row 9 ("מהמסלול שלך") takes the rounds and catch-ups.
- **"יחד":** "מרתון · {title}", "הבלוק הבא: {block} · {time}" and
  "לתוכנית", or "לבנות תוכנית".

### Marathons (`?v=marathon`, `VITE_STUDY_MARATHONS`)

The list of the marathons that are not over, soonest first (a plan's days
are marathons too), "מרתון חדש"; one marathon's run-of-show (the same rows
as a plan's day, "עכשיו" on the step on screen), "אני בפנים · אולי · לא
הפעם", who is in by name, and "להתחיל" / "הבלוק הבא" / "סיום" (any member;
two taps at once move it once); new and edit (a name, a day, an hour, 2-6
hours, the lectures; the run-of-show is built from them). Without the
group's plan, "יחד" shows the next marathon's card.

### "הקבוצה צריכה אותך" (T-2, `VITE_STUDY_TODAY` + `VITE_STUDY_NEEDS_ME`)

Off by default; "שלי" → הגדרות turns it on ("שאלה פתוחה בנושא שבו ענית נכון
יכולה להגיע אליך, ורק אליך. כבוי עד שמפעילים."). On Today, after "בקבוצה":

- an open question of another member (2 hours to 14 days old) in a topic
  she mastered (3 answers or more, 4 of 5 right), with why, hers alone:
  "הגיעה אליך כי ענית נכון על 4 מתוך 5 שאלות על Loop diuretics. גלוי רק
  לך." and "לענות";
- a correction that waits for a second approval: "תיקון מחכה לאישור שני ·
  {name}" and "לבדוק";
- **decision 3:** when nothing waits for her, her own meter instead of an
  empty block: "עוד אין שאלה בשבילך" (or "2 נושאים שבהם אפשר לעזור · אין
  עכשיו שאלה פתוחה בהם"), the rule, and "עוד כ-2 תשובות נכונות על {topic}
  לנושא הבא."

Nobody learns who opted in, who was chosen or why.

### The exam-eve view (`?v=eve&l=`, `VITE_STUDY_PROGRESS` + `VITE_STUDY_EVE`)

"הלילה שלפני · {lecture}": **"השקף המסכם"** (the lecture's own summary
slide as it is: the last slide titled "סיכום", "Summary", "Take-home", "Key
points" …; none: "לא נמצא בהרצאה שקף שמסכם אותה…" and "להרצאה"),
**"האסוציאציות שלך"** (with the wall: pinned in a meeting, then the
paragraphs' winners, then her own), **"הטעויות ׳על בטוח׳ שלך"** (her danger
list's rows on the lecture; none: what fills it), "להדפסה" and "לסיכום
המלא". No generator, no AI. From two days before the plan's exam, Today and
the plan show "הלילה שלפני" with each lecture.

## Decision 3's meters, and where their numbers live

| Meter | Words | From | Thresholds |
|---|---|---|---|
| The plan | "התוכנית מדייקת ככל שמתרגלים: N מתוך M הרצאות עם נתונים" · "עוד כ-{a} תשובות ועוד {p} להרצאה הבאה" | `study_group_plan_meter(plan)`: per lecture, first answers per member, question and day in 28 days, by current members, and how many more answers and people; a bucket (hot · warm · ok) only from 20 answers by 3 members | `PLAN` in `shared/study/meters.ts` (re-exported by `lane.ts`) = section G's `study_private.plan_lecture_answers()` 20, `plan_floor()` 3, `plan_window_days()` 28, `plan_hot_below()` 60, `plan_ok_from()` 80 |
| "הקבוצה צריכה אותך" | "עוד אין שאלה בשבילך" · "עוד כ-2 תשובות נכונות על {topic} לנושא הבא." | `study_needs_me_meter(group)`: her own topics mastered and her nearest topic | `NEEDS_ME` in `shared/study/meters.ts` (re-exported by `today.ts`) = section T's `study_private.needs_me_min_answers()` 3, `needs_me_master_pct()` 80, `needs_me_window_days()` 14, `needs_me_wait_hours()` 2 |
| The exam eve | each empty part says what fills it | her own reads | `EVE_EMPTY` in `shared/study/eve.ts`; `LANE.EVE_DAYS` 2 |

`shared/study/lane.test.ts` reads `supabase/study-schema.sql` and fails if
the numbers differ, if the meter uses a literal, or if the lane's defaults
(21 and 14 days, 180 and 600 minutes, 3 rounds) are not
`study_group_plan_save`'s. The privacy floor: a lecture's group numbers move
the plan (more minutes for a hot lecture) only from 3 members; below that
the meter says only how many more answers and people, never who.

## The SQL (what Yoad runs)

`supabase/study-schema.sql`, the whole file, once in the SQL Editor (it is
re-runnable, safe on wave 4's and wave 3's state with data). This branch adds:

- **Section G at version 1** (between its markers): `study_group_plans`
  (members read; published for live edits), `study_marathons.plan_id` and
  `plan_day`, `study_group_plan_save`, `study_group_plan_day`,
  `study_group_plan_slip`, `study_private.key_questions`,
  `study_my_relearning` (the caller's own), `study_group_plan_meter`
  (decision 3), `study_exam_marks` (W's notes, with recordings on), and the
  thresholds' functions.
- **Section T's end, T at version 2** (inside T's markers, after T 1):
  `study_member_prefs` (owner-only, unpublished), `study_set_needs_me`,
  `study_needs_me` (with the topic and her own count for why),
  `study_needs_me_meter`, and the thresholds' functions. `study_today`
  already calls `study_needs_me` when it exists.

Checks: `supabase/tests/study.sql` GS1-GS8 (section G) and T4-T4l (T-2),
with T5d and T6e/T-reg updated for T 2.

**After the wave-5 review (section G at 2, T at 3):**

- `study_group_plan_meter(p_plan)` takes no time from the caller. Its window
  ends at the start of today's study day (section U's `pulse_cutoff`, 04:00
  Israel time), as the pulse does (review G-METER-PNOW). G 1's
  `(uuid, timestamptz)` form let a member step `p_now` one second at a time
  and recover another member's answer times. Checks GS6b2 and GS6b3.
- `study_today` leaves out of "בקבוצה" the question that "הקבוצה צריכה
  אותך" brings (review UI-3). Check T4b2.

## Flags

| Flag | Needs among the flags | Needs in the SQL |
|---|---|---|
| `VITE_STUDY_MARATHONS` | none | P 2 |
| `VITE_STUDY_GROUP_PLAN` | `MARATHONS` | G 2 (and P 2) |
| `VITE_STUDY_NEEDS_ME` | `TODAY` | T 3 |
| `VITE_STUDY_EVE` | `PROGRESS` (and `WALL` for the associations, `GROUP_PLAN` for the ways in from Today and the plan) | P 2 |

`requiredSchema` (`shared/study/flags.ts`) asks for them; health's
`schemaOk` holds for production's flags (none of these).

## Files

`shared/study/lane.ts` (+ test), `shared/study/eve.ts`, `shared/study/today.ts`
(T-2's words and `NEEDS_ME`), `src/study/lib/groupPlan.ts`, `laneMine.ts`,
`planBrief.ts`, `marathons.ts`, `src/study/features/plan.tsx` (PlanCard,
MyLaneRows, EveCard), `features/progress.tsx` (MarathonScreen,
MarathonsCard), `features/today.tsx` (NeedsMeCard, NeedsMeSetting, the lane
slot), `components/PlanScreen.tsx`, `PlanSetup.tsx` (with SlipCard),
`LaneDay.tsx`, `Marathon.tsx`, `NeedsMe.tsx`, `EveScreen.tsx`,
`styles/plan.css`; `e2e/study/plan.cjs` with `mocks/plan.cjs` and the flag set
`g` in `mock.cjs`.

## Not built, and why

- **REC4 in the plan's rows** ("זה למבחן" paragraphs moving up): the SQL
  (`study_exam_marks`) is built and checked (GS5); the client does not yet
  reorder blocks by it, because the recordings' notes are off for the group
  (`recordings` switch) and no lecture has them.
- **PL6's "more time on a hot topic" inside a day** is per lecture (its
  minutes follow the bucket), not per topic.
- **The live banner's marathon line** (`MarathonBannerLine`) stays empty: the
  marathon screen and the plan's chip "עכשיו" show the step on screen.
- **Shared days are saved 7 days ahead when a member opens the plan** (no
  cron): a day nobody looked at in the week before is computed on the
  phone and saved when someone does.

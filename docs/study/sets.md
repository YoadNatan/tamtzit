# Practice sets (VITE_STUDY_MAKE, VITE_STUDY_SETS, SQL section L)

Built on `dev` from 26 Nov 2026, in the design's slices. The design is
"practice sets, revision 2"; Yoad's answers and every open decision (OD1-OD22)
are in [`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Practice sets").
The server's API is [`practice-2-api.md`](practice-2-api.md); the practice
screens that already exist are [`practice.md`](practice.md).

One action and one thing: **"סט חדש"** creates a **סט** (a titled, fixed,
ordered list of bank questions, with an author and a date), and every set is
on the group's shelf, **"סטים של הקבוצה"**, from the moment it is created
(OD3). The questions still go to the group's single bank (decision 2): a set is
a view over bank questions.

## Status

| Slice | What | Flag | SQL | State |
|---|---|---|---|---|
| A | The generator: one create screen ("סט חדש") with the price on the button, the generating screen ("סט בהכנה"), the entry points, the fixes of the practice screens | `VITE_STUDY_MAKE` | none | Built (WP0-WP8): docs, bundle owner, shared planning and price, the server's `plan`, the flag and routes, the create and generating screens, the entry points and the fixes of the practice screens, and slice A's e2e (§14 steps 1-4, 12-13) |
| B | Sets and sharing: the shelf, the set page, set sessions `s=k.<set>`, group numbers, Today's row | `VITE_STUDY_SETS` | L 1 | SQL section L 1 (WP9, part 10) and the server's `create` with a set (WP10) built; the client (WP11-WP15) not yet |
| C | The notices `set_shared` and `set_solved` (WP17), with section R | (R's) | L 1, R | not built yet |

Not in this build: auto-keep turned on (WP16: it ships off, OD15), sheet sets
(WP18, with the exams design), server-driven writing and the `set_ready` push
(WP19, OD19), course sets (WP20, OD8), retiring the old generator (WP21, one
release after `MAKE`, OD22).

## Flags and switches

| Flag | Needs | Shows |
|---|---|---|
| `VITE_STUDY_MAKE` | `practice` | Slice A |
| `VITE_STUDY_SETS` | `make` | Slice B; `requiredSchema` gains `L: 1` |

Server switches (rows in `study_private.features`, from section L 1):
`questions_paid` (on; off stops every question-writing kind, OD14), `qsets`
(on; set features), `qsets_auto_keep` (off, OD15).

Server settings (Vercel): `STUDY_SETS_MONTHLY_USD`, the monthly line for sets
(default 12, OD12), the spend of kinds practice, solver, reword and style.
The daily limit is 5 new sets a member (`SETS_DAILY` in
`server/study/budget.ts`, the design's `POLICY.qsets.daily`, kept out of
`POLICY` so nothing can reserve a call as "qsets"; OD13).

## The bundle (WP1)

The study entry chunk's limit is 410,000 B (notifications' OD2). This
design's static share of it is capped at **2,000 B**: bundle owner `QS` in
`tools/study-bundle.mjs`, which owns `src/study/features/qsets.tsx` (the slot:
`lazy()` stubs and flag conditions only, no Hebrew), the screens `MakeScreen`,
`MakeParts`, `MakeProgress`, `SetPage`, `SetsShelf`, `SetStats` and
`SetCard`, the libraries `make`, `setsCopy` and `sets`, and `styles/sets.css`.
`QS` keeps only its slot module in the entry chunk (`SLOT_ONLY`), and the
check fails when its share passes 2,000 B. The tool also turns on
`VITE_STUDY_MAKE` and `VITE_STUDY_SETS` with every other flag.

Measured on 26 Nov 2026 with WP9-WP10 (section L and the server; no
client screen): the entry chunk is **402,380 B** with every flag on (7,620 B
left; +718 B: `failText`'s words for the set codes a member can meet, which
are F's and load with every screen), QS's share still **742 B**, and
401,615 B with every flag off.

Measured on 26 Nov 2026 with WP7 (the entry points and the fixes): the
entry chunk is **401,662 B** with every flag on (8,338 B left; +482 B: the
slot's lecture row wrapper, the library's "+ סט" chip in Q's slot and the
condition in the lecture page), QS's share **742 B** of its 2,000, and
400,897 B with every flag off. The Today card, the hub card, the fixes and
the row's words are in lazy chunks (TodayScreen, PracticeHome, the practice
screens, `MakeEntry`).

Measured on 26 Nov 2026 with WP4-WP6 (the flag, the routes, the slot and
the two screens): the entry chunk is **401,180 B** with every flag on (8,820
B left under the limit; +782 B), QS's share **291 B** of its 2,000 (the two
`lazy()` stubs), and 400,415 B with every flag off. Everything else of the
screens loads with them (MakeScreen, MakeParts, MakeProgress, make.ts,
setsCopy.ts, sets.css).

Measured on 26 Nov 2026, before any of the package's code (`npm run
test:bundle`, every flag on):

| | Bytes |
|---|---|
| The study entry chunk, every flag on | 400,398 |
| Left under the 410,000 B limit | 9,602 |
| The same with every flag off (`--flags off`) | 399,653 |
| `QS`'s share | 0 (no module yet; cap 2,000) |
| R's share (notifications, for comparison) | 747 (cap 1,200) |

The design's estimate of the package's entry code is about 1,900 B (the slot
about 900, and in F's modules `route.ts` about 600, `flags.ts` about 150,
`guideScreens.ts` about 100, the chip and card conditions about 150). Only the
slot counts toward `QS`'s cap; the rest is F's and counts toward the limit.
WP1's move of 6 kB of entry code to lazy chunks is not needed now (OD2): the
room left is enough for this wave's designs together (about 1.9 kB here, 1.5
notifications, 1 exams, 1 models).

## What a set costs (WP2)

**The price per question is not calibrated yet.** Until it is, every plan
uses **$0.04 a question** (OD11): `QUESTION_USD` in
`shared/study/practice2.ts`, read through `expectedQuestionUsd(model?)`. The
old constant, $0.025, was never checked against the ledger and is likely
about 45% low: a practice batch's token profile on `claude-opus-5-5` (8,000
cached tokens read, 4,000 in and 7,000 out) costs about $0.16 for 5 questions,
plus about $0.027 a solver call, so about $0.035-0.037 a question before
automatic rewrites. `expectedQuestionUsd(model)` scales the base by a
model's price for that same profile against `claude-opus-5-5` (once section Y
routes practice to another model).

| What | Cost at $0.04 a question |
|---|---|
| A 10-question set | ≈ $0.40 |
| + a stale lecture read (package B usually reads ahead) | + ≈ $0.10-0.24, once for the group |
| + an example read | + ≈ $0.01 |
| A 20-question set with a stale read | ≈ $1.00 (above $1: a confirmation, OD17) |

**Calibration (the owner, once, read-only).** In the Supabase SQL editor, on
production, after about a month of practice writing. It reads the ledger and
the drafts and changes nothing (checked on a local copy of the schema; it was
not run on production):

```sql
-- What a written question cost in the last 30 days: the writing calls
-- (practice), the blind solver (solver) and the members' rewrites (reword),
-- per question that reached a decision or is still waiting (a draft that a
-- rewrite replaced is not counted again: its rewrite is).
with spend as (
  select kind, count(*) as calls, sum(cost_usd) as usd
    from public.study_usage
   where kind in ('practice', 'solver', 'reword')
     and settled_at is not null
     and created_at >= now() - interval '30 days'
   group by kind
), made as (
  select count(*) filter (where status in ('kept', 'removed', 'rejected', 'pending')) as questions,
         count(*) filter (where status = 'kept') as kept,
         count(*) filter (where status in ('removed', 'rejected')) as dropped
    from public.study_question_drafts
   where created_at >= now() - interval '30 days'
)
select (select jsonb_object_agg(kind, jsonb_build_object('calls', calls, 'usd', round(usd, 2))) from spend) as by_kind,
       m.questions, m.kept, m.dropped,
       round((select sum(usd) from spend) / nullif(m.questions, 0), 4) as usd_per_question
  from made m;
```

`usd_per_question` is the base rate. It replaces `QUESTION_USD` (a
one-line change with its test) and is recorded here. Until then the base stays $0.04, which errs high. The old generator's
screens show the same $0.04 (its levels: ממוקד 12 ≈ $0.48, מלא 24 ≈ $0.96,
מקיף 40 ≈ $1.60). If design-models
moves the solver to Haiku (its O9), the rate falls to about $0.032.

## Planning (WP2, `shared/study/practice2.ts`)

- **Fresh first, always** (D5): the points no active bank question tests
  come first, after red flags (red flag → not covered → weight → the
  paragraphs' order). `planRequest({ …, covered })` takes the covered point
  ids (`plan` sends them, §"The server's plan").
- **Parts weighted by their uncovered points** (at least 1, so a covered part
  can still get a question when the size needs it): the custom level's share,
  and a level's share when it passes `REQUEST_MAX`. With no `covered`, every
  count is what it was.
- **`covers`** (`plan.parts[].covers`): the new points each part's questions
  are planned to cover; the custom level covers up to `CUSTOM_PER_POINT` (2)
  a question, so coverage comes from the plan, never one point a question.
- **`coverageAfter(points, covered, plan)`**: the preview's percentage of the
  lecture's points covered in the bank after the set ("אחרי הסט: {p}%
  מההרצאה מכוסים בבנק"), and whether the bank already covers everything
  ("הבנק כבר מכסה את כל ההרצאה"). It reads 100 only when every point is
  covered.
- **`styleCounts(plan)`**: how many items of each type a plan writes (the
  preview's tiles; the server's `plan.styles`).
- **A re-read part starts again at 0**: reading a part again gives its points
  new ids (the rows that were not kept are deleted, and
  `study_questions.points` has no foreign key), so its old questions no
  longer count as covering it. The create screen's help text says so (with
  the screens, WP4-WP5).

## The server's plan (WP3)

Action `plan` of op `questions` (`server/study/practice2.ts`) now:

- **plans fresh first, always** (D5): it reads the lecture's active bank
  questions (`bankCoverage`: not retired; a question hidden by two flags
  covers nothing) and plans with their points as `covered`, so
  `plan.parts[].covers` counts only new points. `create` plans the same way,
  so its batches are what `plan` showed;
- answers **`plan.styles`** (how many items of each type);
- with **`inputs: true`**, answers the planning inputs the create screen
  computes its preview from (D13: `plan` is called on open and when the
  lecture changes, never on a size or type change): the points (no text),
  `covered`, `active` (the 150 cap's count), `free`, the headroom to the 80%
  line and the member's 40% share, the per-question, read and style prices.
  Without `inputs` the answer is what it was (plus `styles` and the fresh
  `covers`), so the old screens pay for no extra reads.

`making`, `recent`, `headroom.line` and `dailyLeft` come from section L 1
(WP10 reads them in `planInputs` behind `schemaHas({ L: 1 })`):
`study_lecture_making`, `study_qsets_shelf` (the last 7 days, not hidden)
and `study_qset_room` (the sets line's spend this month and the sets the
member began today, since a member cannot read the ledger), with
`setsMonthlyCap()` (`STUDY_SETS_MONTHLY_USD`, default 12) and `SETS_DAILY`
(5) from `server/study/budget.ts`. Without L, or when a read fails, they are
`null`. The fields are in `practice-2-api.md` (`plan` → `inputs`).

## The flag, the routes and the words (WP4)

- **`flags.make`** = `practice && VITE_STUDY_MAKE` (`shared/study/flags.ts`).
  It needs no SQL section: the screens call practice 2.0's actions
  (`requiredSchema` is unchanged). Without it every route below is practice
  2.0's, so "flags off" is the app as it was (OD22 keeps the old screens one
  release).
- **Routes** (`src/study/lib/route.ts`): `?v=practice&x=new` may come
  without `l` (the screen opens on the last lecture the member marked read,
  else the newest written one, and writes it into the address), and with
  `from=m` (the member's open mistakes' parts prefilled). Both need
  `flags.make`; without it `allowed()` sends them to the hub or the
  lecture's old setup, with the usual line. A new step, **`x=review&r=`**,
  keeps the request's drafts one by one (practice 2.0's "הבנק נבנה" screen,
  with keep, reword and remove) reachable while `x=bank&r=` is "סט בהכנה".
  No tab changes (OD1).
- **`src/study/lib/make.ts`**: the sizes (5 · 10 · 20, 10 by default; "מספר
  אחר" 1-40), the device's memory of the last size and types
  (`study-make:<user>`; never the parts or the focus), the default lecture,
  the lecture sheet's grouping, the types a lecture offers, **the preview**
  (`previewOf`: the shared planner at the custom level, fresh first, so the
  phone shows the plan the server will make; the price is the planned
  questions weighted by type at `inputs.perQuestionUsd`, plus a stale read
  and an example's read), **what blocks the button** (`blockOf`: a summary
  still written, 150 questions, the 80% line, the 40% share, the sets line,
  the day's sets, a set too big for what is left with its $1.00 margin, no
  type, no material), the quiet lines (under $3 of headroom; 2 or fewer sets
  left today), the $1 confirmation (OD17), the keyboard rule and the
  generating screen's tiles. `make.test.ts` checks the preview against the
  server's `planRequest` for the same inputs.
- **`src/study/lib/setsCopy.ts`**: every string of the design's §6.1 except
  the notices (section R's `notifyCopy.ts`), imported only by the lazy
  screens. `setsCopy.test.ts` pins them and rejects second-person and
  gendered forms, model names and "נקודות".
- **`src/study/features/qsets.tsx`**: the slot, two `lazy()` stubs and no
  words (291 B of QS's 2,000). Package Q's slot (`features/practice.tsx`)
  routes `x=new` and `x=bank&r=` to them while the flag is on.

## The create screen, "סט חדש" (WP5)

`src/study/components/MakeScreen.tsx` and `MakeParts.tsx`
(`?v=practice&x=new[&l=…][&from=m]`). One screen, two decisions:

1. **The lecture**: one row with its hue, title and course, and "להחליף ‹",
   which opens **"איזו הרצאה"** (`LectureSheet`: a search, the group's
   lectures by course as radios, each with its bank's size or "אין שאלות
   עדיין"; the kit's sheet, a 560 px dialog from 768 px).
2. **How many**: `5 · 10 · 20` (an `a-seg`; ←/→ on a computer).

Under them, **the preview** (`PreviewCard`), computed on the phone from one
free `plan` with `inputs: true`, asked on open and when the lecture changes,
never on a size or a type (D13): "10 שאלות · {lecture}", a small tile per
question coloured by type with the legend ("6 אמריקאית · 2 מקרה · 1
תמונה"), "כל שאלה נבדקת לפני שהיא נכנסת לבנק", the coverage bar "אחרי הסט:
p% מההרצאה מכוסים בבנק" (or "הבנק כבר מכסה את כל ההרצאה"), "כולל קריאת
ההרצאה" when the points must be read first, and the bank line. **The price
is on the button**: "ליצור 10 שאלות · כ-$0.40". "בבנק יש N שאלות שעוד לא
נענו · לפתור בחינם ‹" (from 5) opens "סבב חדש". Everything else is closed
under **"עוד אפשרויות"** (its state remembered on the device): the level
(קלה · כמו במבחן · קשה), the types as one chip group ("ברירת מחדל" or
"מהפעם הקודמת" with "לחזור לברירת המחדל"; types the chosen parts cannot have
are hidden), the parts (names only), an example (paste or photograph, "לצלם
רק את השאלה, בלי שם או מספר זהות"; read later, as a phase), the focus (200
characters) and "מספר אחר (1–40)".

Whatever blocks the button says so in a callout with the way still open
(`blockOf`); a refusal of `create` maps to the same words (`blockOfCode`).
Offline the preview says "אין חיבור כרגע. התצוגה תתעדכן כשהחיבור יחזור."
and the button waits; a first load that fails shows "המסך לא נטען…" with
"לנסות שוב". A set above $1 asks first ("סט גדול · כ-$1.10 מתקציב
הקבוצה"). At L (≥ 1024 px) the screen has two columns inside
`--measure-wide`: the choices at the start, the preview sticky at the end
with the button inside it, and no bottom bar. The keyboard: ←/→ change the
size (← is bigger, right to left), Enter creates from the page's body or the
button, and nothing happens while a field has focus.

In slice A the preview's group line is "השאלות נכנסות לבנק של הקבוצה" (there
are no sets yet); slice B replaces it with "הסט ישותף עם הקבוצה".

## The generating screen, "סט בהכנה" (WP6)

`src/study/components/MakeProgress.tsx`.

- **Phase 0** (`MakeJob`): when the lecture's points must be read first, or
  an example was given, "ליצור" opens this screen before any request
  exists. It reads the points with the existing stream, once for the group
  ("קוראים את ההרצאה · כ-2 דקות, פעם אחת לכל הקבוצה"; another phone's read is
  waited for), then the example with action `style` ("קוראים את הדוגמה…";
  a failed or refused read says "הדוגמה לא נקראה · השאלות נכתבות בסגנון
  הרגיל" and the set is written in the usual style, D4), then creates the
  request and replaces itself with the second part. A refusal there (a
  budget line, a part that could not be read) is said in words, with
  "לנסות שוב".
- **The set being written** (`?v=practice&l=…&x=bank&r=<request>`): a ring
  and one line ("6 מוכנות · עוד 4 בדרך"), the callout "היצירה רצה מהמכשיר
  הזה…" while this phone writes (until server-driven writing, OD19), and
  **"להתחיל לפתור (k)"** as soon as one question is ready: one tap keeps the
  checked questions (the existing keep-all, D3; auto-keep ships off) and
  starts a round of the lecture's new questions in the request's parts.
  "פרטים" (open from 1024 px) has a tile per question (בדרך · מוכנה · לא
  יצאה, each with its word for screen readers), the ready ones (type, a
  one-line stem, "שקף N") and "לעבור על השאלות אחת-אחת ‹" (`x=review`).
- **States**: a batch that failed: "N שאלות לא יצאו" with "לנסות שוב"; a
  budget line reached in the middle: "הסט נעצר כי התקציב נגמר · k שאלות
  מוכנות" and the line's own words, never "לנסות שוב"; nobody writing any
  more (a closed phone): "היצירה נעצרה באמצע" with "להמשיך ליצור" (and "העלות
  נרשמת על מי שממשיך" for another member, OD16); offline: "אין חיבור. מה
  שכבר נטען נשאר כאן." with the tiles kept, and the set goes on when the
  connection is back (the phone that was writing it writes on by itself:
  a part the connection cut is written again). The screen follows Realtime and reads again every
  10 s. Its live region says the first ready question, each quarter and
  the end.

## The entry points and the fixes (WP7)

Every entry point says **"סט חדש"** (design §5.1), each only with `flags.make`
(without it every screen below is as it was):

| Place | What |
|---|---|
| Today (`TodayScreen`) | The card **"תרגול"** replaces the ghost "תרגול חופשי". With an empty queue the free primary in the bar is **"תרגול מהבנק"** (the hub's lectures: the glossary's name for practising from the bank) and the card holds "סט חדש" (secondary); with a queue the card is two quiet links, "סט חדש ‹" and "תרגול מהבנק ‹", so the queue keeps the screen's one primary. "סט חדש" opens the create screen without a lecture, which prefills the last one read: Today → a set is 2 taps (סט חדש → ליצור). The day's end in the session says "תרגול מהבנק" too |
| The library (`usePracticeChip`, Q's slot) | **"+ סט"** (named "סט חדש" for screen readers) beside "N שאלות" on every lecture whose summary is ready, also with no questions; it opens `?v=practice&l=…&x=new` |
| The lecture page (`LectureView`) | Under the summary, "אחרי הקריאה: תרגול על ההרצאה" becomes one row (a group named "אחרי הקריאה"): **"סט חדש"** and the lecture's practice, **"לפתור"** once the lecture has a bank ("תרגול על ההרצאה" before). The row is `components/MakeEntry.tsx`, a lazy part of the slot with its own boundary (`MakeLectureRow`): the entry chunk holds only the condition |
| The hub (`PracticeHome`) | The **"סט חדש"** card first ("שאלות חדשות על הרצאה, נבדקות לפני הבנק"), then the lectures under **"תרגול מהבנק"** with "סט חדש" where a lecture has no questions (was "יצירה"), and the group quiz last |
| A lecture's practice (`LecturePractice`) | "שאלות חדשות" → **"סט חדש"**; the card of an open request says "סט בהכנה" (or "הסט מוכן" once only decisions wait) with "לפתוח את הסט" |

Design §5.1's other rows wait for slice B: Today's "לפתור סט חדש" and
"סטים חדשים בקבוצה", the resume row, the hub's and the lecture page's sets,
and the mistakes end's paid secondary.

The fixes of the practice screens (§5.11), each with `flags.make`:

- **"סבב חדש"** (`PracticeRound`): the sources in one person, "שלא עניתי ·
  שטעיתי · שסימנתי לבדיקה · הכול" (a flag is "סימנתי לבדיקה", never a
  bookmark); the size "הכול (n)", shown only when the bank's count differs
  from 5 and 10 (it read "10 · הכול" beside "10").
- **The question at 390 px** (`PracticeSession`, `PracticeQuestion`): the
  session measures the bottom bar (and the tab bar under it) into
  `--pq-foot-h` on a layout effect, so the bet card's
  `scroll-margin-bottom` (the bar plus 16 px) is right in the frame where a
  pick scrolls it into view (`reveal()`); while an option is picked and no
  bet, the bar says **"קודם לבחור כמה בטוחים"** above "לבדוק" (its
  `aria-describedby`). "מבוסס על ש׳ 12" → "מבוסס על שקף 12".
- **"שאלה משלי"** (`ExtrasCard`): no "רק לך" chip (the question goes to
  everyone's bank); the heading's line reads "נכנסת לבנק של הקבוצה בלי שם".
- **The review's verdict** (`PracticeBank`, `x=review`): "בבדיקה, Claude
  ענה אחרת מהמפתח" → "הבדיקה ענתה אחרת מהמפתח" (no model's name in member
  copy); its slide tag "ש׳ 12" → "שקף 12".
- **"ש׳" in lists**: "שקף 12" in the review, the blank tables' rows and the
  question's line; the generating screen's list already said "שקף N".
- **A lecture without a table** shows no "טבלה ריקה" card (it was a dashed
  "אין טבלה למילוי" on every visit), and the group's other tables are not
  read for it.

Help gains the row **"סט חדש"** (`helpCopy.ts`, with the flag): where it is,
the two choices, what the preview shows before paying, the check before the
bank, starting while the rest is written, and that a re-read part's
coverage starts again at 0.

## The e2e (WP5-WP8)

`e2e/study/sets.cjs` with the flag set **`pm`** (`notify` with
`VITE_STUDY_MAKE`; `ps` adds `VITE_STUDY_SETS` for slice B; both in
`e2e/study/mock.cjs`'s `flagSetOf` and `SQL_SETS`) covers the design's §14
steps 1-4 and 12: the lecture page to "ליצור" in two interactions with the
price on the button, the read as a phase, the three tile states, a failed
batch and "לנסות שוב", "להתחיל לפתור" keeping and starting, a budget stop, a
failed example read, offline on both screens, and at 1280 px the keyboard,
the sticky preview and the 560 px sheet; each screen in light and dark
through `a11y.cjs`. WP7-WP8 added (step 1 now starts on the lecture page's
row): the library's "+ סט" on both lectures (a second, synthetic lecture with
no table and no questions), the hub's order, Today's card and "תרגול מהבנק"
with an empty queue and its way to the create screen with a lecture
prefilled, the lecture page's row, no "טבלה ריקה" card without a table, the
question at 390 px (the note above "לבדוק", the bet card above the bar),
"סבב חדש"'s words, "שאלה משלי", the review's verdict and "שקף N"; and step
13: the four tabs at 1280 px, and no horizontal scroll at 320×568 on the
create screen (with "עוד אפשרויות" open), the hub, Today and "סבב חדש". The
mock loads Today's plugin (`mocks/today.cjs`) beside practice's; slice A
needs no plugin of its own (`mocks/sets.cjs` comes with slice B's RPCs). The mock's action `plan` answers `inputs` (steered by
`db.practice.inputs`), and `db.practice.styleFail` refuses an example's read.
The build for it: every s2 flag with `VITE_STUDY_INSTALL`, `VITE_STUDY_NOTIFY`,
`VITE_STUDY_MAKE` and `VITE_STUDY_SETS`.

## SQL section L 1 (WP9)

`supabase/study-schema.sql`, after section R; **part 10** of
`supabase/parts` (62 KB; with I and R, part 9 would have been 177 KB, over
the SQL editor's 170 KB, so `tools/sql-parts.mjs` now cuts 10 parts and L
starts the last one; Y and O will follow L there). Registry `L: 1`.

**Tables.** `study_qsets` (kind `lecture`, and the seams `course` and
`sheet`; title, lecture, `want`, `options` with only level, difficulty,
types and parts, never a focus or points; state `reading`, `making` or
`ready`; `notified_at`; author; a soft delete), `study_qset_requests`,
`study_qset_items` (`pos` 1-200, `auto_kept_at`), `study_qset_attempts` (a
score per solve), `study_qset_marks` (seen, hidden for oneself),
`study_qset_prefs` (OD7's names choice, L's own) and one column on Q's
`study_answers`: `set_attempt`. Members read their group's live sets and
their items; attempts, marks and prefs are each member's own; nobody
writes a table directly. Realtime carries `study_qsets` and
`study_qset_items` only.

**The op's RPCs** (the server key and the member's token):
`study_qset_begin` (the switches `qsets` and `questions_paid` → `off`; the
member's sets today, Israel time, deleted ones included → `daily_limit`;
the group's practice, solver, reword and style spend this month →
`sets_line`; under the lecture's round lock, an open set on the lecture
answered as `{open: {set_id, author_name, made, want, state, mine}}`
unless forced; "open" is a set read in the last 10 minutes, written in the
last 30, or begun in the last 2 and not yet attached), `study_qset_attach`
(Q's `study_request_create` under the same lock, the author only, once),
`study_qset_abandon` (a set with no request and no questions goes),
`study_qset_style` (the example's signature while the set reads) and
`study_qset_autokeep` (nothing while `qsets_auto_keep` is off; else the
round lock before each draft row, as keep, only drafts the solver passed,
a staged case only when every step passed, never past 150).

**The member's RPCs:** `study_qsets_shelf`, `study_qset_open`,
`study_qset_progress` (state, made, size, failed, unchecked, paused),
`study_lecture_making`, `study_qset_room`, `study_qset_rename` (the author),
`study_qset_delete` (the author or the group's creator, soft),
`study_qset_hide`, `study_qset_seen`, `study_qset_attempt_start` (the
open attempt of the last 12 hours, or a new one), `study_qset_answer` and
`study_qset_answer_seq` (Q's and X's answer, then the attempt stamped on
the row that call added), `study_qset_attempt_finish` (the first answer per
question; an attempt with no answer is dropped), `study_qset_stats` and
`study_qset_names_pref`.

**Group numbers** (`study_qset_stats`, OD5): `solvers` and the caller's
`mine` always; `avg` (the share right over every finisher's first attempt)
and `per_q` (bands 1-3 over the others only, a band only where 3 others
answered) only when at least `pulse_floor()` (3) other members finished;
`names` only of those who chose it, never with a score; no best score.

**The trigger** `study_qset_items_from_bank` (after insert on
`study_questions` with a request): a kept question of a set's request
joins the set at the next place, whichever path kept it. It locks only the
set row, after the keep's round lock and draft row, and its body never
fails the keep (a warning, and the set misses that question; rollback in
the snippets below).

**Paused** (computed): a set being written whose newest pending or writing
batch has not moved for 6 minutes, or a set reading its lecture for 6
minutes. **Ready**: a set whose request has no batch pending or writing
(refreshed by progress, the set page and the shelf); the first time it is
ready with a question, `set_shared` goes out once through R's hook
`study_private.notice_set_shared` when there is one (WP17 adds it), and
`notified_at` is stamped either way, so a hook installed later never
announces old sets. A non-author's first finished attempt adds
`set_solved` for the author, once R registers that kind (WP17).

**Switches and `kind_on`:** `qsets` (on), `qsets_auto_keep` (off),
`questions_paid` (on): `kind_on` maps practice, solver, reword, style,
points and bank to it, with the same text in section F (a unit test
compares them). **Nightly** `study-qsets-clean` (03:29): sets left reading
for a day, unfinished attempts after a year, marks of deleted sets, sets
deleted 30 days ago that nobody solved.

**Seams:** `study_private.qset_of_request` (R's `questions_ready` skips a
set's request, WP17), `qset_for_similar`, `qset_add_items` and
`qset_similar_done` (the exams design's sheet sets, O 2). Nothing of the
exams or models designs is built.

**Tests:** `supabase/tests/study.sql` block L (70 checks, `LS1`-`LS15`),
fresh, in parts and over the schema of `baed964`;
`supabase/tests/qsets-concurrency.sh` (keep all against auto-keep on one
request, 50 rounds, no deadlock and no double keep; two begins on one
lecture at once, 10 rounds, one set); `server/study/sqlParts.test.ts` (10
parts, each at most 170 KB, F's and L's `kind_on` the same);
`e2e/study/schema-dump.json` regenerated by `npm run test:contract`.

## The server's "create" with a set (WP10)

`server/study/practice2.ts`, action `create` of op `questions`, documented
in [`practice-2-api.md`](practice-2-api.md) ("A practice set"):

- **Without `set`**, exactly the old path: no RPC of section L (D12; a test
  checks it with L installed).
- **With `set`** (503 `schema` before L 1): each line a set may not cross,
  402 in the create screen's order (`reserve`, `member_share`, `sets_line`,
  `daily_limit`, `too_big` under the expected cost plus $1.00), then
  `study_qset_begin` with `p_daily` 5 (`SETS_DAILY`) and `p_line`
  `setsMonthlyCap()`; 409 `already making` with the open set unless
  `force`; 402 `off`.
- **A phase:** stale points (instead of 409 `points stale`) or `set.phase:
  "style"` answer `{ set: { id, state: "reading" }, phase }`; the phone reads
  them, then calls again with `set.id`, which plans and attaches. Action
  `style` with `setId` keeps the signature on the set; a second call with
  another style is 400 `bad style`.
- **The request:** `study_qset_attach`; a refusal there abandons the set and
  keeps Q's code. The answer adds `set: { id, state: "making" }`.
- **The title:** the member's, or "{lecture} · {n} שאלות" cut to 80
  characters.
- `POLICY` is unchanged: the daily limit stays `SETS_DAILY` outside it (WP3:
  `POLICY` holds ledger kinds, and nothing reserves a call as "qsets").

## The owner's snippets (from section L 1)

To be run in the Supabase SQL editor once part 10 (section L) is installed
(each was run on a local copy of the schema; none on production):

```sql
-- Stop all question spending now (no redeploy):
update study_private.features set enabled = false, changed_at = now() where name = 'questions_paid';
-- Turn set features off (the shelf empties; questions stay):
update study_private.features set enabled = false, changed_at = now() where name = 'qsets';
-- Auto-keep on (only after the WP16 measurement):
update study_private.features set enabled = true, changed_at = now() where name = 'qsets_auto_keep';
-- What the month spent by kind (read before changing the sets line):
select kind, round(sum(cost_usd), 2) from public.study_usage
 where created_at >= date_trunc('month', now()) group by 1 order by 2 desc;
-- Retire auto-kept questions of one set, or since a date:
update public.study_questions q set retired_at = now()
 where q.retired_at is null and q.id in (select i.question_id from public.study_qset_items i
       where i.auto_kept_at is not null and (i.set_id = '<set>' or i.auto_kept_at >= '<date>'));
-- Full rollback of L's trigger (sets stop filling; nothing else changes):
alter table public.study_questions disable trigger study_qset_items_from_bank;
```

**Weekly check** (read-only): sets made and their writing cost per week. The
writing calls (`practice`) and a batch's blind solver use the batch id as
their ledger `ref`; a member's rewrite (`reword`) and its solver use the
draft id, so both joins are needed:

```sql
with refs as (
  select r.set_id, qb.id::text as ref
    from public.study_qset_requests r
    join public.study_question_batches qb on qb.request_id = r.request_id
  union all
  select r.set_id, d.id::text
    from public.study_qset_requests r
    join public.study_question_drafts d on d.request_id = r.request_id
)
select date_trunc('week', s.created_at) as wk, count(distinct s.id) as sets,
       round(sum(u.cost_usd) filter (where u.kind = 'practice'), 2) as writing_usd,
       round(sum(u.cost_usd) filter (where u.kind in ('solver', 'reword')), 2) as checks_usd
  from public.study_qsets s
  left join refs on refs.set_id = s.id
  left join public.study_usage u on u.ref = refs.ref
 group by 1 order by 1;
```

## Rollback

1. `questions_paid` off when spending is the problem (seconds, no redeploy).
2. `qsets` off when sets misbehave (the shelf empties; `create` without a set
   is untouched).
3. Unset `VITE_STUDY_SETS` and/or `VITE_STUDY_MAKE` and redeploy: the old
   generator is still there (OD22).
4. Disable the items trigger (the snippet above) only if it fails writes,
   which its wrapper should prevent. `study_answers.set_attempt` and L's
   tables can stay: they are unused without the flag.

## Privacy

A set and its questions are visible to the whole group with the author's
name (one informational line in help's privacy text, not a gate). Answers and
scores stay private: the group sees "פותרים: k", and an average and
per-question bands only from 3 other members who finished (OD5).

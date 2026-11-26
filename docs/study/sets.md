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
| A | The generator: one create screen ("סט חדש") with the price on the button, the generating screen ("סט בהכנה"), the entry points, the fixes of the practice screens | `VITE_STUDY_MAKE` | none | WP0-WP2 built (docs, bundle owner, shared planning and price); WP3 and the screens follow |
| B | Sets and sharing: the shelf, the set page, set sessions `s=k.<set>`, group numbers, Today's row | `VITE_STUDY_SETS` | L 1 | not built yet |
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
The daily limit is 5 new sets a member (`POLICY.qsets.daily`, OD13).

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

To come with WP3: the planning inputs of action `plan`.

## The owner's snippets (from section L 1)

To be run in the Supabase SQL editor once Release B is installed:

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

## Privacy

A set and its questions are visible to the whole group with the author's
name (one informational line in help's privacy text, not a gate). Answers and
scores stay private: the group sees "פותרים: k", and an average and
per-question bands only from 3 other members who finished (OD5).

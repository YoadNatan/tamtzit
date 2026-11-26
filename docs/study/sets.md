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
| A | The generator: one create screen ("סט חדש") with the price on the button, the generating screen ("סט בהכנה"), the entry points, the fixes of the practice screens | `VITE_STUDY_MAKE` | none | WP0 (docs) built; WP1-WP3 and the screens follow |
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

To come with WP1: the bundle owner `QS` (a 2,000 B cap, OD2) and the
measured numbers.

## What a set costs (WP2)

To come with WP2: the planning rate ($0.04 a question until calibrated,
OD11) and the owner's read-only calibration query.

## Planning (WP2)

To come with WP2: fresh first, parts weighted by uncovered points, `covers`.

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

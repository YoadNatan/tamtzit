# Models: routes and "השוואת מודלים" (VITE_STUDY_MODELS, SQL section Y)

The design is "design-models, revision 2"; Yoad's answers and every decision
are in [`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md), "Models and the
comparison". The feature's one name is **השוואת מודלים**; the owner is **מי
שפתחו את הקבוצה** ([`COPY.md`](COPY.md)).

What it does: every paid AI call can run on a model chosen per kind of work
(a **route key**), set only by the group's owner; with nothing set the app
works exactly as today (Claude Opus 5.5 everywhere). The owner can send the
same frozen request to 2-4 models side by side under a hard cap, and members
rate the short answers blind (labels א-ד), then see names, time and cost.

This file grows with the package. Built so far: the registry (WP1), the
bundle room (WP2) and the SQL (WP3). The server (routing, the op `lab`, the
adapters) and the screens come next.

## The registry (`shared/study/models.ts`, `prices.ts`, `estimate.ts`)

- `MODELS`: every current Claude API model (16), with dated prices (from
  `prices.ts`, one place), context, output cap, effort, vision, JSON mode,
  server-side fallback, characters a token, tier, `expensive` and
  `verifiedOrgsOnly`. Other providers' rows (`<provider>:<model>` ids) come
  with their adapters; a price counts as verified only from the vendor's own
  page (`verified: false`: × 1.5 in comparisons, never routed in production).
- `ROUTE_KEYS` and `ROUTE_RULES`: the 25 route keys and what each sends
  (pictures, members' wording, exam or sheet pages; `anthropicOnly` for the
  outline and the ask route, which are not made through `run()`).
  `scopeAllows(scope, key)`: scope `all` takes every key; `text` only keys
  with none of those.
- `prices.ts` is the phone's small share (the price cards); `estimate.ts`
  holds `estimateUsd`, `imageTokens` and `charsPerToken` (budget.ts
  re-exports them).

| Route key | What | Sends |
|---|---|---|
| part, outline, notes | a summary's parts, its outline, a recording's notes | pictures (part); outline: Claude only |
| practice, set_write | a lecture's practice batch; the practice-set generator (op `questions`) | pictures |
| solver, reword, style | the question check, rewording, a style read | pictures |
| points, cards | points to know, cards | text |
| ask, ask_route | "לשאול" and its lecture choice | members' wording; ask_route: Claude only |
| mnemonic, wall_check, fix_check, var, trap_check | memory aids, the wall's check, a correction's check, VAR, members' traps | members' wording (var: pictures too) |
| exam_read, exam_key, exam_solve | a past exam's reading, key and solving | exam pages |
| sheet_read, sheet_key, sheet_solve | an uploaded sheet's reading, answers file and solving (kind `exam`, refs of those names) | sheet pages, pictures |
| similar | similar questions (section O 3) | sheet items, pictures |
| judge | the comparison's AI score | text |

## The bundle (WP2)

`tools/study-bundle.mjs` owns package **Y**: the slot `features/models.tsx`,
the components `ModelsScreen`, `ModelsNewScreen`, `ModelsRunScreen`,
`ModelsParts`, `ModelsRows`, `lib/models` and `lib/modelsCopy`, and
`shared/study/models` and `estimate`. Its entry share is capped at
**1,500 B**, and only its slot module may be in the entry chunk (the limit is
410,000 B; about 406,087 B were used with every flag on before Y).

## SQL section Y 1

After section O 3 at the end of `supabase/study-schema.sql`, so it is in
**part 12** (124,476 B of 170,000). It is optional for every other path: no
other section reads its tables, and `REQUIRED_SCHEMA` does not list it (only
the op `lab` and the flag will). Re-runnable; it records `('Y', 1)` last.

### Switches and settings

| Name | Where | Default | Effect |
|---|---|---|---|
| `lab` | `study_private.features` | **off** (inserted) | Off: no plan, no claim (a planned run stops too), no rating |
| `routes` | `study_private.features` | on (no row) | Off: every key back to the default model (the server's `modelFor`) |
| `lab_settings` | `study_private.lab_settings`, per group, SQL editor only | no row: the defaults | `lab_usd` **3.30** (the month's line, used up to 15% of the cap), `run_cap` 1.50, `daily_runs` 3 (Israel day), `member_kinds` {practice, set_write, ask, points, cards}, `todo_days` 7, `keep_days` 60 |
| `lab_admins` | `study_private.lab_admins` | empty | Owners besides the group's creator |

The money: a run's worst case at most `run_cap`; this month's comparison
spend (ledger kind `lab`) plus the run's estimate at most the line; the
group's spend plus the estimate under 80% of the cap (the summaries keep
their 20%). Each claim checks the line and reserves through `study_reserve`
with kind `lab` and **no user** (the worker's anon client), so comparisons
are in nobody's own share. The sub-lines of sets, sheets and similar
questions count other kinds and are unchanged.

### Tables (all closed to members: RLS on, no grants; every read goes through the functions)

`study_model_routes` and `study_model_route_log` (every change, null = back to
the default), `study_model_providers` and `study_model_provider_log` (the
owner's consent, scope `all` by default), `study_lab_runs`, `study_lab_outputs`
(one a slot, labels shuffled), `study_lab_ratings`, `study_lab_seen` (rated or
skipped), `study_lab_judgements`.

### Functions

"Owner + key": the server, with the owner's token and the server key.
"Worker": the server's anon client with the key (`auth.uid()` null).

| Function | Caller | Does |
|---|---|---|
| `study_lab_owner(group)` | member | Which buttons show |
| `study_models(group, key?)` | member, or worker | `{routes, providers, switches: {lab, routes}, lab: {line_usd, run_cap, daily_runs, member_kinds, todo_days, spent_usd, runs_today}}` |
| `study_model_at(group, route, at, key)` | worker | The model a key had at a moment (null: the default); for summaries begun within 48 hours |
| `study_model_set(group, route, model\|null, note, key)` | owner + key | Sets or clears a route (the server checked the model) and logs it |
| `study_model_provider_set(group, provider, allowed, scope = 'all')` | owner | "לאשר שליחה" or its undo for openai, google or openrouter; recorded |
| `study_lab_plan(group, lecture, route, title, source, request, hash, differs, models, judge, estimate, cap, key)` | owner + key | Raises in order `off`, `not the creator`, `bad slots`, `run_cap`, `daily_runs`, `lab_budget`, `reserve`; returns `{run, labels}`, never a model map |
| `study_lab_slot(run, label, key)` | owner + key | The server's read of a slot: its model, status, the frozen request |
| `study_lab_judge_input(run, key)` | owner + key | Each finished answer by label |
| `study_lab_claim(run, label, part, estimate, cap, key)` | worker only | Atomic: `answer` (waiting, run running), `retry` (timeout or error, once), `solve` (a finished answer's paid check), `judge` (label `j`, run done). `off`, `closed`, `not waiting`, `lab_budget`, then `study_reserve`'s. Ref `run:<run>:<slot>:<part>` or `run:<run>:j:judge`. Returns the reservation |
| `study_lab_status(run, key)` | worker | For the 10 s cancel poll |
| `study_lab_output_save(output, status, reason, text, usage, cost, latency, first, served_by, checks, check_status, key)` | worker | Writes a claimed answer once (false otherwise); the last one closes the run |
| `study_lab_check_save(output, checks, status, key)` | worker | A paid check's result, merged |
| `study_lab_judged(output, judge, scores\|null, cost, key)` | worker | An AI score (null: the judge failed) |
| `study_lab_rate(output, overall, accuracy?, hebrew?, structure?, error, note)` | member | `off`, `forbidden`, `not rated here`, `seen`, `not done`, `bad rating`; the detail is kept for the owner only |
| `study_lab_reveal(run, best?, skip?)` | member | Rated (every finished answer, best a label or `=`) or skipped (the caller's ratings go); the names show to this caller only |
| `study_lab_run(run)` | member | While running: labels and a combined count only. Done: statuses, text, checks. Model, provider, cost, time, the AI score and the group's ratings only after the caller's reveal (the owner too); tokens to the owner only |
| `study_lab_source(run)` | member | The source and the request's `material` (until it is blanked) |
| `study_lab_list(group, limit)` | member | The owner: every run; a member: done runs of rated kinds with 2+ answers. `mine`: todo, rated, skipped, old |
| `study_lab_todo(group)` | member | "השוואות לדירוג · {n} מחכות" |
| `study_lab_board(group, route)` | member | Per model over the runs the caller revealed: score (capped at 2.5 when over a third flagged an error), flags, best picks, AI mean, refusals, checks, match and false rejects, $ per call, p50 time, "same or better" against today's model; `usage30` by ledger kind for the owner |
| `study_lab_cancel(run)` | owner | Waiting answers end `cancelled` |
| `study_private.lab_sweep()` | pg_cron `7,22,37,52 * * * *` | Waiting 15 min: `not started`; running 10 min: `timeout`; a check or AI score running 10 min: `error`; closes runs; blanks requests after `keep_days` |

**Conventions for the server.** The frozen request's `material` key is what
the phone may show ("החומר"). An answer's `checks` use `pass` (boolean),
`items`, `match` and `false_rejects` (numbers) for the results table; other
keys are kept as they are.

**Codes.** Failtext's (`off`, `forbidden`, `budget`, `reserve`, `not the
creator`) and Y's own, worded in `src/study/lib/modelsCopy.ts`
(`MODELS_FAIL`, lazy): `bad slots`, `run_cap`, `daily_runs`, `lab_budget`,
`closed`, `not waiting`, `not rated here`, `seen`, `not done`, `not rated`,
`bad rating`, `bad route`, `bad model`, `bad provider`. `bad status` is the
server's own.

### The notice (section R)

When a run of a rated kind closes with at least 2 answers, every member but
the owner who ran it gets one notice of kind **`lab_new`** (R's reserved row:
cat `inapp`, never pushed; coalesced; route `{v: "models", r: <run>}`, obj
`lab:<run>`; it ends after `todo_days`). Without section R nothing is sent.
Y registers the kind only when R's row is missing and never changes it, so:

```sql
-- push it too (members' "שלי" category then decides):
update study_private.notice_kinds set cat = 'mine', push = true where kind = 'lab_new';
```

### One-line changes (SQL editor)

```sql
update study_private.features set enabled = true, changed_at = now() where name = 'lab';        -- comparisons on
update study_private.features set enabled = false, changed_at = now() where name = 'lab';       -- off
insert into study_private.features (name, enabled) values ('routes', false)
  on conflict (name) do update set enabled = false, changed_at = now();                         -- every key to the default
insert into study_private.lab_settings (group_id, lab_usd) values ('<group>', 2.00)
  on conflict (group_id) do update set lab_usd = excluded.lab_usd;                              -- the month's line
insert into study_private.lab_admins (user_id) values ('<user id>');                            -- another owner
delete from public.study_model_routes where group_id = '<group>' and route = '<key>';           -- one key to the default
update public.study_model_providers set allowed = false where provider = '<provider>';          -- a provider off
```

### Tests

- `supabase/tests/study.sql`, section Y: the owner's gate, routes and their
  log, providers and scope, the plan's refusals in order, shuffled labels,
  blindness for the owner and a member, claims with no user, the line and
  its 15% ceiling, rating and reveal, skip, the kinds members do not rate,
  the lists and the count, the results table, retry, the AI score, paid
  checks, cancel, the sweep, the notice, the grants, the revoke.
- `supabase/tests/lab-concurrency.sh`: two claims of one answer at once (one
  reservation, one ledger row), of the AI score, of a retry; four claims with
  room for three under the line.
- `shared/study/models.test.ts`: the registry, and that section Y's route
  keys are exactly `ROUTE_KEYS`; `src/study/lib/modelsCopy.test.ts`: every
  code Y raises has words.

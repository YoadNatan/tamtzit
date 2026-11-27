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
bundle room (WP2), the SQL (WP3), the routing seam (WP4) and the op `lab`
for the kinds with an answer key (WP5). The adapters, the screens, the
blind rating's paid check and AI score (WP8) come next.

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
**part 12** (130,433 B of 170,000). It is optional for every other path: no
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
| `study_lecture_made(lecture, key)` | worker, or member | When a lecture was made: the as-of rule of its outline and parts |
| `study_model_routed(key)` | worker | Every model some key is routed to, in any group (health's `stalePrices`) |
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
| `study_lab_bank(group, lecture?, n, key)` | owner + key | The question check's material: up to n (2-20, default 10) active keyed questions of the lecture (or the group's newest with 5 or more), picked at random, **with their keys** (no member's read gives them; they stay in the frozen request, which only the server reads) |
| `study_lab_skip(run, label, reason, key)` | worker | A slot whose claim was refused (the line, the cap) ends `error` with the reason; the run closes with its last answer |
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

## Routing in production (WP4, `server/study/routes.ts`)

Every paid call asks `modelFor(sb, group, key, {lectureId?, pictures?})` for
its route key's model, reserves its estimate on that model and passes it to
`run({…, model, reserveFallback})`. **With nothing set every request is
today's, byte for byte**: `run()` without a model (or with the default) sends
exactly the request it sent before, and the outline's `messages.parse` and the
ask route's `messages.create` (D5: not moved into `run()`) only take their
model's id and fields (`claudeFields`).

`modelFor`:

1. `study_models` once per instance and group every 60 s. **Any error** (Y not
   loaded, PGRST202, a refusal, the network) is the default, with one log line
   per instance: Y is optional for every path (D22).
2. The switch `routes` off: the default for every key (D23).
3. `outline` and `part`, for a lecture made less than 48 hours ago: the model
   the key had when the lecture was made (`study_lecture_made`, then
   `study_model_at`), so one summary is never written by two models (D7).
4. The default, with one log line, when the model is not in the registry, its
   price is unverified, it serves only organizations Anthropic verified, its
   provider has no key or no adapter in this build, the group did not approve
   the provider or its scope does not take the key, it cannot read the
   pictures the call sends, or the key takes Claude models only (outline,
   ask_route). `routeRefusal` gives the reason (the op `lab`'s route action
   words it, `MODELS_FAIL`).

| Call site | Key |
|---|---|
| `writer.ts` | `outline` (Claude only), `part`, `notes` |
| `practice.ts` (op `questions`, a batch) | `practice` (a release-1 round) or `set_write` (a practice set's batch); its solver checks `solver` |
| `practice2.ts` | `points` (with `bank.ts`'s read ahead), `style`, `reword` and its solver checks `solver` |
| `cards.ts`, `ask.ts` | `cards`; `ask`, `ask_route` (Claude only) |
| `mnemonic.ts`, `ops/wall.ts` | `mnemonic` (the aids and the wall's drafts), `wall_check` |
| `ops/fixcheck.ts`, `ops/var.ts`, `ops/extras.ts` | `fix_check`, `var`, `trap_check` |
| `exams.ts` (a unit) | `exam_read`, `exam_key`, `exam_solve`; a sheet's unit its ref (`sheet_read`, `sheet_key`, `sheet_solve`) |
| `ops/exams.ts` (a sheet's holds) | the dearest of the reader's three keys' models, so a hold covers what its units reserve |
| `ops/similar.ts`, `similarGen.ts` | `similar` (the run's worst case, its writing and its checks) |

`routeKeyFor(kind, ref)` maps a ledger row back to its key (a past exam's read
and key units share the ref `unit`, counted as `exam_read`; kind `lab` has
none of its own).

**`run()`** (`claude.ts`, a documented signature change): `model` (left out:
the default), `fallbacks` (false: no server-side fallback, for comparisons),
`appFallback` and `reserveFallback` (D8), `reservedUsd` (the adapters' floor);
`RunResult.chars`. A Claude model is called with its id, its effort control
(none on Haiku 4.5), at least its output floor (Haiku 5.5: 2,000, which
`estimateUsd` reserves too) and at most its output cap, and server-side
fallback only where it has it. Any other provider goes through its adapter in
`server/study/llm/index.ts` (none in this build; `modelFor` never resolves a
key to a provider without one).

**D8, the app's fallback.** A model without server-side fallback (Haiku 5.5,
every non-Anthropic model) that refuses or fails **before its first text** is
run once more on the default, under its own reservation (`fallbackReserve`:
the same group, lecture, kind and ref, no daily count; a refusal there is the
op's 402). After text has streamed, the op's refusal path applies as today.
The writer's rerun is charged by the unit's finish (the first call settles on
its own); similar questions' rerun is charged to its run. Comparisons never
use it.

**Health** (`/api/study/health`): `providers` (`anthropic`, `openai`,
`google`, `openrouter`: whether each key is set, booleans only) and
`stalePrices` (the routed models whose price was checked 45 days ago or
more; `[]` without Y).

**Not routed yet:** the phone's price cards (`shared/study/batch.ts`,
`examPrice.ts`, `practice2.ts`'s `perQuestionUsd`) and the sets line's
expected cost still price the default; they move with the screens.

**Tests:** `server/study/routes.test.ts` (the default when unset or on any
error, the 60 s cache, the switch, the as-of rule, scope and pictures,
Claude-only keys, `routeKeyFor`, `fallbackReserve`, `stalePrices`);
`claude.test.ts` (today's request as a snapshot, a routed Claude model's
fields, D8 before and after text); `ask.test.ts` (the ask route);
`writer.test.ts` and `collab.test.ts` (`partRequest`, `fixCheckOpts`);
`section.test.ts` still pins the outline's and the parts' bytes against
bc01207's; `health.test.ts`.

## The op `lab` (WP5, `server/study/ops/lab.ts`, `server/study/lab.ts`)

`POST /api/study/ai {op: "lab", action, …}`, the owner only (the group's
creator or a lab admin; section Y checks again in every function). It needs
section Y 1 (`VARIANT_SCHEMA.lab`: 503 `schema` without it); every other op
works without Y.

| Action | Body | Answer |
|---|---|---|
| `run` | `group, route, models: [2-4 ids], source?` | NDJSON (below) |
| `resume` | `run` | NDJSON: the slots still waiting, claimed and run |
| `retry` | `run, label` | NDJSON: one slot that timed out or failed, once |
| `route` | `group, route, model \| null, note?, confirmExpensive?` | `{route, model}` |
| `cancel` | `run` | `{cancelled: true}` |
| `check`, `judge` | | 501 `not built` (WP8: practice's paid check, the AI score) |

**The kinds compared (slice 2, those with an answer key):**

| Route | Material (read with the owner's token) | Frozen by | Checked against |
|---|---|---|---|
| `solver` | `study_lab_bank`: 10 random keyed questions of a lecture's bank (`source: {lecture?, n?}`) | `solverCall` over the questions and each image question again without its picture (as `solveQuestions`) | the bank's keys: `match` (verdicts kept, production's rule `judgeItems`), `false_rejects` (good questions it got wrong), `blind`, `ambiguous`, `missing` |
| `fix_check` | the newest decided correction with a slide as its source (`source: {proposal?}`) | `fixCheckOpts(fixCheckRequest(…))` | the group's decision: applied, the check should say ok; withdrawn, it should not (`match`, `false_rejects` for an applied one called wrong) |
| `exam_read` | the newest ready past exam (`source: {exam?, pages?}`), its first read unit (4 pages, the page before and after as context, the numbers saved before it) | `unitCall` over a read claim | the reviewed items on those pages: `numbered`, `options`, `copied` (text at least 90% alike), `figures`, `extra`; `match` = options and text both right |
| `sheet_read` | the same for a ready sheet (3 pages, labels) | `sheetCall` | its saved items by label |

Each frozen request is **production's request exactly** (`DIFFERS` is empty
for these kinds); the tests compare it with the body production sends. A
comparison never sends the server-side fallback and has no app fallback
(D15). Pictures are kept as storage paths (`study-path:<path>`) and signed
per call with the owner's token: 30 minutes for Claude, 120 s for another
provider (D18). The request holds `material` (what the phone may show,
`study_lab_source`; never a key) and `key` (the checks' reference; the
server reads it back through `study_lab_slot`).

**`run`:** owner gate (`study_lab_owner`), the switch `lab` (`study_models`,
read fresh), the material, each model (`labRefusal`: in the registry and not
Mythos; another provider needs its key and an adapter in this build, the
group's "לאשר שליחה" and a scope that takes the kind; pictures need vision;
an unverified price is allowed, × 1.5; an expensive model is allowed), the
worst case (the sum of each model's, which must be under the run's cap
before anything is planned), then `study_lab_plan`. Before the stream, each
label's model is read (`study_lab_slot`) and claimed on the worker's path
(`study_lab_claim`, its estimate reserved with no user). A first claim that
is refused is the request's status (402 `lab_budget`, `reserve`, `budget`;
403 `off`; 409 `closed`), every slot ending with that reason
(`study_lab_skip`); a later one ends only its own slot. The claimed slots run
in one detached invocation (`detachedStream` + `waitUntil`; the phone may
lock or leave), in parallel, each stopping 270 s after the function started
or 25 s before its deadline; the run's status is read every 10 s and
`cancelled` stops the calls. Each answer is settled through its reservation
(the worker), checked (`checksFor`, $0) and saved (`study_lab_output_save`),
and the last one closes the run (and sends R's `lab_new` for a rated kind).

**Blindness (D12):** the NDJSON is `{t:"run", run, total}`,
`{t:"progress", ready, total}` (a count, never a label), `{t:"done"}`. No
model, label status, text, cost or time ever travels in it; the phone reads
the run through `study_lab_run`, which shows models and costs only after the
caller's own reveal.

**`route`:** `routeRefusal` (the production rule: a verified price, a ready
and approved provider within its scope, vision, Claude only for outline and
ask_route, `expensive` unless `confirmExpensive`), then `study_model_set`
(owner + key); `model: null` is back to the default. The instance's route
cache is cleared at once.

**Status codes:** 403 `not the creator`, `off`, `forbidden`; 402 `run_cap`,
`lab_budget`, `reserve`, `budget`; 429 `daily_runs`; 409 `closed`,
`not waiting`, `expensive`; 400 `bad slots`, `bad route`, `bad model`,
`no material`, the route refusals; 503 `pictures` (a page that could not be
signed), `schema`. Words: `src/study/lib/modelsCopy.ts`.

**The numbers** (`server/study/limits.ts`): `LAB_RUN_CAP_USD` 1.50 (section
Y's `run_cap` decides), `LAB_UNVERIFIED_FACTOR` 1.5, `LAB_ANSWER_MS` 270 s,
`LAB_SAVE_MS` 25 s, `LAB_POLL_MS` 10 s, `LAB_SOLVER_ITEMS` 10 (at most 20),
`LAB_SIGN_SECONDS` 1,800 and `LAB_SIGN_SECONDS_OTHER` 120. POLICY `lab`:
share 0.8, no member share, no daily count.

**Offline:** `node tools/evals/lab.mjs --print <dir>` writes each kind's
frozen request and key from `STUDY_EVAL_FIXTURES` (or the synthetic
`e2e/study/fixtures/lab/lab.json` and `exam/exam12.json`); `--check <dir>`
runs `checksFor` on answers saved there as `<kind>.<name>.out.txt`. It
refuses a folder inside the repository.

**Tests:** `server/study/lab.test.ts` (each frozen request against
production's body, pictures as paths, estimates and × 1.5, `checksFor` per
kind, `labRefusal`, the statuses, the eval's refusal of a folder in the
repository); `server/study/labop.test.ts` (the op through `/api/study/ai`:
the response carries no model id or label status, the owner's token reads
and the worker claims and saves, the refusals before the plan, a first and
a later refused claim, retry once, resume, route, cancel);
`server/study/ai.test.ts` (Y 1 for op lab only); `supabase/tests/study.sql`
Y19-Y20 (`study_lab_bank`, `study_lab_skip`).

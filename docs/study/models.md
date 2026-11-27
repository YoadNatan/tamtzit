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
bundle room (WP2), the SQL (WP3), the routing seam (WP4), the op `lab`
for the kinds with an answer key (WP5), the owner's screens with their
e2e (WP6, WP7; flag `VITE_STUDY_MODELS`, Yoad's steps in
[`RELEASE-Y1.md`](RELEASE-Y1.md)), and the kinds rated by people with the
blind rating, the paid check, the AI score, the share and R's notice (WP8,
WP11: "The kinds rated by people", below), and OpenAI's and Google's
adapters with the providers' consent (WP9: "Other providers", below; the
owner's steps in [`RELEASE-Y2.md`](RELEASE-Y2.md)), and OpenRouter's
adapter for the DeepSeek, Qwen, Kimi and GLM models (WP10: "OpenRouter",
below; its steps in `RELEASE-Y2.md` too).

## The registry (`shared/study/models.ts`, `prices.ts`, `estimate.ts`)

- `MODELS`: every current Claude API model (16), with dated prices (from
  `prices.ts`, one place), context, output cap, effort, vision, JSON mode,
  server-side fallback, characters a token, tier, `expensive` and
  `verifiedOrgsOnly`. `OTHER_MODELS`: OpenAI's and Google's (WP9,
  `<provider>:<model>` ids), all `verified: false` for now;
  `OPENROUTER_MODELS`: DeepSeek, Qwen, Kimi and GLM through OpenRouter
  (WP10, `openrouter:<slug>` ids, `fee` 1.055, `reportsCost`), all
  `verified: false` for now; `ALL_MODELS` is the three lists, and
  `modelInfo` reads it. A price counts as verified only from
  the vendor's own page (`verified: false`: × 1.5 in comparisons, never
  routed in production).
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
| `study_lab_claim(run, label, part, estimate, cap, key)` | worker only | Atomic: `answer` (waiting, run running), `retry` (timeout or error, once), `solve` (a finished answer's paid check), `judge` (label `j`, run done). `off`, `closed`, `not waiting`, `run_cap` (retry, solve and judge: the run's ledger rows so far and this claim past the run's cap), `lab_budget`, then `study_reserve`'s. Ref `run:<run>:<slot>:<part>` or `run:<run>:j:judge`. Returns the reservation |
| `study_lab_claim_slots(run, slots, cap, strict, key)` | worker only | A run's answers claimed in one transaction (`slots` `[{label, estimate}]`), so the reservations commit together (D12). `strict` (the run's first claim): the month's line and the 80% line for every slot together; refused, nothing reserved and the empty run dropped (no daily run used): `{claimed: {}, error, dropped}`. Otherwise each slot alone: a refused one ends `error` with its reason, one claimed already is `not waiting`. Returns `{claimed: {label: reservation}, refused, error}` |
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
cat `inapp`, never pushed; coalesced; route `{v: "models"}`, the list of
runs to rate, obj `labs`, so one notice for several runs opens them all and
is seen there; it ends after `todo_days`). Without section R nothing is sent.
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
| `price` | `group, route, models?, source?` | `{route, title, source, pictures, models: {id: {usd} \| {refused}}, runCap}`: the material as `run` would read it and each model's worst case on it (× 1.5 unverified); nothing planned, reserved or called (the new comparison's screen) |
| `cancel` | `run` | `{cancelled: true}` |
| `check` | `run` | NDJSON `{t:"check", pending}`, `{t:"done"}`: a done run's paid checks still pending ("לבדוק עכשיו"), each claimed again (WP8) |
| `judge` | `run` | NDJSON, the same: the run's AI score, once, if the run asked for it (409 `not waiting` otherwise) |

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
provider (D18), whose adapter then fetches the picture itself and sends its
bytes (WP9: no provider gets a link to the group's storage). The request holds `material` (what the phone may show,
`study_lab_source`; never a key) and `key` (the checks' reference; the
server reads it back through `study_lab_slot`).

**`run`:** owner gate (`study_lab_owner`), the switch `lab` (`study_models`,
read fresh), the material, each model (`labRefusal`: in the registry and not
Mythos; another provider needs its key and an adapter in this build, the
group's "לאשר שליחה" and a scope that takes the kind; pictures need vision;
an unverified price is allowed, × 1.5; an expensive model is allowed), the
worst case (the sum of each model's, which must be under the run's cap
before anything is planned), then `study_lab_plan`. Before the stream, each
label's model is read (`study_lab_slot`) and every slot is claimed in one
call on the worker's path (`study_lab_claim_slots`, each estimate reserved
with no user, all committed together). When the month's line or the 80%
line cannot take the whole run, that is the request's status (402
`lab_budget`, `reserve`; 403 `off`) and the empty run is dropped; a slot
refused on its own ends with its reason. `resume` and `retry` check each
model's provider again (its key, "לאשר שליחה", its scope, pictures: D17)
before anything is claimed; a retry reserves the run's dearest model's
worst case and is refused past the run's cap (402 `run_cap`). The claimed slots run
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

## The owner's screens (WP6, WP7; `VITE_STUDY_MODELS`)

The flag `VITE_STUDY_MODELS` (`flags.models`, alone: it needs no other
flag) shows the screens and asks for section Y 1 (`requiredSchema`, so
health's `schemaOk` with the flag). What may run is still the server's: the
switch `lab`, the owner's gate, the line and the caps.

**The route** `?v=models` (`src/study/lib/route.ts`): `x` = `new` | `board`
| `routes`, `r` = a run, `k` = a route key (with `new` or `board`). Without
the flag it goes home with no notice (a stale notice's link). A notice's
`{v: "models"}` (the list to rate) sees `labs` in `shared/study/notifyRoute.ts`
(a run's own `lab:<run>` stays for a notice made before 27 Nov 2026). Tab: "שלי" (a run and a new comparison have a back arrow, "→
להשוואות").

**The entry chunk:** only `src/study/features/models.tsx` (one lazy
`ModelsRoute`), the `case "models"` in `StudyApp.tsx`, the route and the
flag: **267 B** of package Y's 1,500 (the entry chunk 406,989 B of 410,000
with every flag on). Everything else is lazy: `components/ModelsScreen.tsx`
(the router, the owner's tabs, a member's list), `ModelsNewScreen.tsx`,
`ModelsRunScreen.tsx`, `ModelsParts.tsx` (shared parts and the "שלי" rows,
which Me loads lazily), `lib/models.ts` (reads and the op), `lib/modelsPure.ts`
(the pure rules), `lib/modelsCopy.ts` (every word), `styles/models.css`.

| Screen | What it shows |
|---|---|
| "שלי" | The owner: "השוואת מודלים · איזה מודל כותב כל דבר, ובכמה". Anyone while runs wait: "השוואות לדירוג · {n} מחכות" (no badge, no dot) |
| השוואות (`?v=models`, the owner) | The month's line with its bar ("השוואות החודש: $x מתוך $3.30 · עוד n היום"); the runs (title, models, date, "נבדק מול המפתח", the count while it runs, the cost once seen); empty: C5 and "השוואה ראשונה מומלצת" (the question check on 10 bank questions, Opus against Haiku, its price from the op, else a decided correction); "השוואה חדשה" in the foot. The switch off: C18 and no primary |
| השוואה חדשה (`x=new&k=`) | 1 the kind (chips: the question check, a correction's check, a past exam's read, a sheet's read; one with no material says why, C55); 2 the material, read by the op's `price` ("שאלות אחרות" picks the bank's questions again); 3 2-4 models: the newest four first (Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5), the rest folded, each "≈$x" (its worst case on this material), tags היום / מחיר לא נבדק / יקר; today's model and the kind's candidate ticked (OD11: Haiku for the answer-key checks, Sonnet for reading), the choice kept on the device. The button "להריץ (עד $x)"; disabled with its reason: over the run's cap (C14), the month's line used (C15) or short (what is left), the day's runs used (C16), the switch off (C18), offline (C57) |
| A run (`r=`) | While it runs: "k מתוך n תשובות מוכנות", its progressbar, "אפשר לצאת מהמסך…", "לעצור את ההשוואה" (confirm C47); never a label, model, time or cost. Re-opened after a minute with answers still waiting and no stream in the tab: `resume`, once. Done: each answer under its label with its status (C20) and checks (C29), the answer folded (JSON indented); "לנסות שוב" once for a timeout or error; "החומר" (the frozen material: questions with options, the correction before and after, the pages). The owner of a kind members do not rate: "הצגת השמות והעלות" (`study_lab_reveal`), then the names, time, cost and tokens, each model's month at this rate, **quality against price side by side** with "זול פי k" against Opus, and "לתוצאות של ״…״" |
| תוצאות (`x=board&k=`) | The kind's chips; a card per model over the runs the owner revealed: **quality** (the match with the key, with n) **beside the month's price** (`projection`, below), the price a call, refusals, false rejects (the question check), runs, time; "בסיס קטן" and "עוד מעט השוואות… מוקדם להחליט" under 20 checked items; the recommendation (C34b, below) and "להשתמש בו ל״…״"; from 768 px two columns |
| מי כותב מה (`x=routes`) | Every kind members know (סיכומים, שאלות תרגול, שאלות בסט חדש, נקודות שצריך לדעת, כרטיסיות, לשאול, הבדיקה של השאלות, קריאת מבחן, קריאת דף תרגילים, שאלות דומות, אסוציאציות), then "בדיקות ופעולות פנימיות" folded: its model, "ברירת מחדל" or "שונה ב-…", "≈$x בחודש". A row opens the route sheet: the models the key may take (verified price, vision for picture kinds, Claude only for outline and ask_route, an approved provider within its scope) each with its month; C36 for the one picked, C36b next month's price, C38 for the summaries, C38b and a second confirmation for an expensive model, "חזרה לברירת המחדל". The switch `routes` off: C59. "ספקים": "כרגע רק Claude" until health says a key is set; each provider's key (a missing one opens the key sheet, C42b), "לאשר שליחה" (C42, scope `all`) and when its prices were checked |
| A member (`?v=models`) | The runs waiting for the member's rating, then "דורגו"; empty: C51. No tabs, no "השוואה חדשה", no "מי כותב מה" (OD7). A run opens the blind rating (below); `x=board&k=` is a kind's results, read only (no route, no month) |

**The monthly projection** (`lib/modelsPure.ts`'s `projection`, design
§6.6): `today30` (the key's ledger kinds over 30 days, `study_lab_board`'s
`usage30`, the owner's only) × (the model's mean cost a call ÷ today's
model's, over the revealed runs) + its refusal rate × calls × the cost a
call (the D8 rerun on Opus) + for the question check its false-reject rate
× calls × $0.20 (practice's rewrite). With no comparison of both: today30 ×
the ratio of a typical call's price (20k characters in, 3k tokens out),
marked "הערכה גסה". Keys that share a ledger kind (practice and set_write;
the exam's and the sheet's keys; ask and ask_route) see the whole kind and
are marked "הערכה גסה" too.

**The recommendation** (`recommend`, §6.5): a model at least 20% cheaper a
month that holds: for the answer-key kinds 20 checked items for both, its
match rate at most 2 points under today's and no more false rejects a
question (C34b, "בסיס קטן" under 50 items); for the rated kinds (WP8) 5
shared runs, "same or better" in 80% and no more flagged errors (C34,
"בסיס קטן" under 10).

**Words:** `src/study/lib/modelsCopy.ts` (`ROUTE_NAMES`: one Hebrew name a
route key; `MC`: every line; `MODELS_FAIL`: the refusals), listed in
[`COPY.md`](COPY.md). A model's name in a Hebrew line is isolated
(U+2068…U+2069) or in `<bdi dir="ltr">`.

**Tests:** `src/study/lib/models.test.ts` (one name a key, impersonal words,
dollars, what a comparison offers and preselects, `routable`, the month by
ledger kind, the projection, both recommendation rules, stale prices);
`route.test.ts` and `shared/study/notifyRoute.test.ts` (the route, the
flag, the notice's link); `server/study/labop.test.ts` (`price`);
`e2e/study/models.cjs` with `e2e/study/mocks/lab.cjs` on the flag set `y`
(`os` with `VITE_STUDY_MODELS`): the owner's empty home and first card, the
price over the cap, no material and offline, a run blind while running and
after, left and finished without the phone, resume once, retry once,
cancel with its confirm, the results and the recommendation, the route
sheet and back to the default, an expensive model's second confirmation,
the switch `routes` off, a member's list, the refusals C15, C16, C18, and
320 to 1440 px light and dark with the a11y check; on the set `os` it sees
nothing and calls nothing.

## The kinds rated by people (WP8, WP11)

**The kinds** (`server/study/labRated.ts`; the op reads their material in
`server/study/ops/labRated.ts`, with the owner's token, as production reads
it): the group's newest lecture with a written part (or `source.lecture`),
its first written part (or `source.part`).

| Route | Frozen by | Differs from production (`differs`) | Members rate? | $0 checks (C29) |
|---|---|---|---|---|
| `practice` | `questionsCall` (a release-1 round: the part, the lecture's questions as "already asked", the course's style, the part's corrections), 3 questions | `count` | yes | `checkQuestion` on each (`ok`/`items`); then the paid check |
| `set_write` | the same with a set's batch: styles case, mechanism, compare at the exam's difficulty, no points | `count` | yes | the same |
| `points` | `pieceCall` of the part's first piece | none | yes | `checkPoint`, red flags |
| `cards` | `cardsCall`, 6 cards (the lecture's cards as known, the part's figures, corrections and paragraphs) | `count` | yes | `checkCard` |
| `ask` | `askSystem(lecture, [], null, summary, null)` + the owner's typed question (at most 500 characters; `source.question`), `cacheTail` as production | `no threads` (OD9: no threads, no corrections; no recording's notes either) | yes | slide tags, none unknown |
| `part` | `partRequest` with no corrections, its figures as paths (signed per call), max_tokens 16,000 (D15) | `max_tokens` | no: the owner alone | tags in the part's range, unknown tags, numbers with units kept from the slides, words |

`lab_settings.member_kinds` decides `member_rate` when a run is planned
(default practice, set_write, ask, points, cards). The owner rates every
kind's run too (OD3: blind, and the owner's ratings count).

**The paid steps after the answers** (one detached invocation; the answers
stop at 200 s so the steps have time, the steps at 270 s or 25 s before the
deadline; each step claimed on the worker's path, `study_lab_claim`, so a
second tab or a later "check" pays nothing twice):

- **The solver's check** (practice, set_write): an answer with a checked
  one-answer question is saved with `check_status: pending`; the solver (the
  route `solver`'s model, Opus by default) answers its questions without
  their keys, and `solved`, `solver_agrees`, `solver_differs` are merged into
  its checks ("הבדיקה ענתה אחרת ב-{n}"). One that cannot start by 60 s before
  the stop stays pending, for "לבדוק עכשיו" (`check`).
- **The AI score** (OD12): off by default, under "עוד אפשרויות" on the new
  comparison, only for these kinds (never for an answer-key kind). The run
  records the judge's model (the route `judge`'s, Opus by default); after
  the answers one call reads the slides' text only (no pictures, also for a
  summary) and every finished answer under its label, in a random order
  (kept with each score as `order`), and scores each 1-5 (overall, accuracy,
  Hebrew, structure) with its factual errors (`LAB_JUDGE_SYSTEM`,
  `server/study/prompts/lab.ts`). Saved per answer (`study_lab_judged`); a
  reply that cannot be read marks it failed. Shown only after the caller's
  reveal, as "ציון AI: {z}/5", never mixed into the group's score (D13).
- **The worst case before a run** holds both: the op's `price` returns
  `steps: {check, judge: [by the number of answers]}` and the button's "עד
  $x" adds them; the run's estimate (and so its $1.50 cap) includes them.

**The blind rating** (`ModelsRunScreen.tsx`, design §5.5). A done run of
these kinds, with 2 answers or more, opens the rating for anyone who may
rate it (`can_rate`) and has not revealed: one answer at a time (from 768 px
side by side), its checks and its text as the app shows it; one score 1-5,
"יש כאן טעות עובדתית" with an optional note, and for the owner the folded
"דירוג מפורט" (accuracy, Hebrew, structure). Each tap is saved at once
(`study_lab_rate`) and kept in a draft on the device (`localStorage`, wrapped
in try/catch; it survives a reload); taps made offline wait (C56) and are
sent when the connection returns. The last step: "איזו תשובה הכי טובה?" (a
label or "אין הבדל") and "שמירה והצגת השמות", disabled with "חסר דירוג
לתשובה {ב}" until every answer has a score and a pick; or "לדלג על ההשוואה
הזאת" (confirm C28: the caller's scores go, `study_lab_reveal` with skip).
Nothing on the page names a model, a time or a cost before the caller's own
reveal, the owner's included (D12); after it, each answer says "הדירוג שלי
{x} · הקבוצה {y} ({n} דירגו) · ציון AI: {z}/5", its time and cost, and the
side-by-side bars put the group's score against the price.

**The owner's steps** on a done run of a kind members rate: "לשלוח לקבוצה
לדירוג" opens a sheet with C49's message and the run's link (WhatsApp's own
send page, the phone's share sheet, or a copy); "לבדוק עכשיו" when a paid
check is pending.

**Members.** "שלי"'s row "השוואות לדירוג · {n} מחכות" (runs of the rated
kinds, done with 2 answers or more, younger than `todo_days`, neither rated
nor skipped) opens the oldest waiting run directly. After the reveal,
"לתוצאות של ״{kind}״" opens the kind's results read only (quality, checks,
cost a call; no month, no route).

**R's notice (WP11).** When a run of a kind members rate closes with 2
answers or more, section Y sends `lab_new` (built with section Y 1; see
"The notice" above): the inbox on, the push off by default (one SQL line
turns it on), never a model's name. The owner's WhatsApp share is the other
way.

**Help.** The row "השוואת מודלים" (`MODELS_HELP`: who runs, who rates
blind, the $3.30 line) and, with the flag, one line in help's footer on the
companies the group's material is sent to (OD21, informational, not a
gate): Anthropic, the providers some kind is routed to, and those approved
for comparisons (`providersLine`, from `study_models`).

**Not built here:** similar questions (section O 3) as a comparison kind:
its material (a sheet's items with their keys and pages) is read only by
the worker's claim, so it needs a read of its own in section Y; it stays
routable (`similar`) like every key.

**Tests:** `server/study/labRated.test.ts` (each frozen request against
production's builder, the checks by kind, the paid check never sends a key,
the judge's request names no model and keeps the order, its scores within
1-5, the estimates); `server/study/labop.test.ts` (a practice run with the
AI score: the answers, then a solver's check of each and the judge, all
claimed on the worker's path, the response counts only; `check` runs only
what is pending; `price`'s steps; "לשאול" needs its question);
`src/study/lib/models.test.ts` (the kinds and their candidate, the steps in
the total, an answer as shown, the draft, the words, help's line);
`e2e/study/models-rate.cjs` (design §12.3 scenarios 4-6 on the flag set `y`).

## Other providers: OpenAI and Google (WP9)

**The adapters** (`server/study/llm/`; plain `fetch`, no SDK, D6), behind
`run()`'s seam (`llm/index.ts`'s `adapterFor`):

| File | Does |
|---|---|
| `openai.ts` | `POST https://api.openai.com/v1/responses`, `stream: true`, `store: false`: the system blocks as `instructions`, the messages as `input` (`input_text`, `input_image` as a base64 data URL, an assistant's turn `output_text`), effort as `reasoning.effort`, max_tokens as `max_output_tokens`, a schema as `text.format` json_schema (strict when every property is required and no keyword strict mode refuses appears; best effort otherwise). Events: `response.output_text.delta`, `response.refusal.*`, `response.completed`, `response.incomplete` (`max_output_tokens`: cut; `content_filter`: refused), `response.failed`, `error` |
| `gemini.ts` | `POST …/v1beta/models/<id>:streamGenerateContent?alt=sse`, the key in `x-goog-api-key` (never in the URL): `systemInstruction`, `contents` (an assistant's turn `model`, pictures `inlineData`), `thinkingConfig.thinkingLevel`, `maxOutputTokens`, `responseMimeType` + `responseJsonSchema`. Thought parts are skipped; `finishReason` STOP, MAX_TOKENS, and SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT / SPII / IMAGE_SAFETY (refused); `promptFeedback.blockReason` is a refusal |
| `stream.ts` | What both share: the deadline and the phone's signal (as Claude's calls), text to `onText` with the ledger id as the serving model, one more try on 429/5xx before the stream when 20 s or more are left, one settle in `finally`, never a throw (stop `error` with its cause, so D8 can rerun on Opus before any text) |
| `request.ts` | The request as turns: the system blocks as one text (`cache_control` dropped: both cache a repeated prefix themselves), every picture as base64 (a link is fetched by the server, **only from the study's own Supabase host over https**, at most 8 MB a picture and 18 MB a request), max_tokens within the model's floor (4,000: thinking shares it) and cap |
| `usage.ts` | Usage in Anthropic's shape (cached input taken out of the input, thinking in the output, `provider` and `raw` kept), and what a call settles at |
| `sse.ts`, `keys.ts` | The SSE reader; the keys (`OPENAI_API_KEY`, `GEMINI_API_KEY` from `process.env` only, scrubbed from any error's words) |

**Settling (D4, D16).** Final usage: the registry's cost × the provider's
`fee`, or its reported cost when that is more. The stream opened but the
final usage never came (an abort, a timeout, a cut stream): **no less than
the call's reservation** (`reservedUsd`, else the request's own worst
case). Refused before the stream (an HTTP error, no connection): $0.
`settle()` now writes the call's own figure (`Spend.costUsd`) instead of
pricing the usage again.

**The models** (`OTHER_MODELS`, checked 2026-11-27, all `verified: false`:
the build could not load the vendors' pages, so the ids and prices come from
searches limited to openai.com and ai.google.dev): GPT-6.2 Astra ($8/$40,
`expensive`), GPT-6.2 Sol ($2/$10), GPT-6.1 Terra ($1/$5), GPT-6 Luna
($0.10/$0.50), OpenAI's long-context card above 272k; Gemini 4 Argon ($4/$20
only, D16), Gemini 3.8 Flash ($0.75/$3.75, from 2027-01-01 $1.50/$7.50). No
server-side fallback (D8 applies in production), vision, effort low /
medium / high, 2.0 characters a token until the ledger calibrates it.

**Consent (D17, OD19 as the owner changed it).** "לאשר שליחה" asks what is
sent: **"כל החומר"** (scope `all`, the default) or **"רק טקסט"** (scope
`text`: points, cards, a recording's notes, the AI score). Recorded per
provider (`study_model_provider_set`, its log); "רק טקסט" shows as a chip;
"לבטל את האישור" undoes it. A new comparison offers an approved provider's
models beside the newest Claude ones, only for kinds its scope takes (the
op's `price` refuses the rest); "מי כותב מה" never offers an unverified
price. The block says "המחירים עוד לא נבדקו מול הדף של הספק" until a
provider's rows are verified.

**The key sheet (C42b)** gives the provider's spend limit first (OpenAI and
OpenRouter: $5 prepaid, auto-recharge off; Google: a billing-enabled project
and a daily request quota), then the Vercel variable, Production only, and
when its prices are unchecked.

**Words that named Claude as the writer** are neutral now (the bank's review,
a thread's attached answer, a paragraph's history, three help lines; COPY.md,
"Copy that named Claude as the writer"). Help's footer line names Anthropic
and every approved provider (OD21).

**Tests:** `server/study/llm/llm.test.ts` (synthetic SSE only: split reads,
deltas, usage, the finish reasons, a refusal part, an abort and a timeout
settling at the reservation, an HTTP refusal at $0 with the key scrubbed, the
429 retry, D8 through an adapter, pictures inline and refused from another
host, strict schemas, `generateItems` through an adapter, readiness);
`e2e/study/models-providers.cjs` (scenario 9 on set `y`: no key, keys,
consent with each scope, the key sheet, a blind run with Gemini, no
unverified price in the route sheet, help's line, the undo, 320 to 1440 px
with the a11y check).

## OpenRouter: DeepSeek, Qwen, Kimi and GLM (WP10)

The Chinese open models go **only through OpenRouter** (OD22): one key
(`OPENROUTER_API_KEY`), one processor, never the makers' direct endpoints
(the registry lists none, and `providerReady` has no key for them).

| File | What it does |
|---|---|
| `server/study/llm/compat.ts` | `POST https://openrouter.ai/api/v1/chat/completions`, `stream: true`, **`stream_options: {include_usage: true}`** and `usage: {include: true}` (without them a Chat Completions stream reports no usage, D4). The system blocks as one system message (with the JSON schema's text appended when a format is asked, since a host may ignore `response_format`); the messages as user and assistant turns, pictures as `image_url` data URLs (base64, never a link; a model without vision fails before anything is sent, $0); `reasoning: {effort, exclude: true}` (thinking is billed, never streamed); `max_tokens` within the floor and cap; `response_format` json_schema, strict when the schema allows it. **Every request carries `provider: {data_collection: "deny", zdr: true, ignore: CHINA_HOSTS}`**; a model with `china: true` goes without `ignore`. Read: `delta.content`, `delta.refusal`, `finish_reason` (stop, length → cut, content_filter → refused, error → failed), the last chunk's `usage` and `usage.cost`, an `error` object; `[DONE]` and `: OPENROUTER PROCESSING` comments are skipped |
| `usage.ts` | `normalizeChat`: `prompt_tokens` less `cached_tokens` and `cache_write_tokens` (each its own count), `completion_tokens` with the reasoning inside it |
| `stream.ts` | `Feed.reported(usd)`: the provider's own cost, in its credits |

**Hosts (OD22).** `CHINA_HOSTS` lists OpenRouter's slugs for providers based
in China (deepseek, alibaba, moonshotai, z-ai, siliconflow, baidu, minimax,
stepfun, tencent, xiaomi, bytedance, baichuan); every request leaves them
out, so an open model runs on a host elsewhere. Where no host outside China
with zero data retention serves a model, OpenRouter refuses before anything
is generated: the call costs $0 and fails (in a comparison "משהו השתבש"; in
production D8 reruns it on Opus). A model only its maker serves is marked
`china: true` with its `host` (today Qwen4 Max, Alibaba Cloud): it goes
without the exclusion, still with zero data retention, and a new comparison
says **"הבקשות למודל הזה מעובדות בסין (Alibaba Cloud)."** under it (C43).
**The slugs and Qwen4 Max's host are unverified** (written from memory;
openrouter.ai could not be loaded from the build or the review sessions):
until the owner checks them against OpenRouter's providers list, **the
account's "Ignored providers" setting is the primary block** and the
request's `ignore` list a second layer (`RELEASE-Y2.md`, step 2).

**Money (D16).** `fee: 1.055` (OpenRouter's 5.5% on the credits its prices
are paid in) is reserved by `estimateUsd` and charged on settling: a call
settles at **max(registry cost, `usage.cost`) × 1.055**; a stream cut before
its usage chunk settles at no less than its reservation (D4); a refusal
before the stream at $0.

**The models** (`OPENROUTER_MODELS`, checked 2026-11-27, all `verified:
false`: openrouter.ai is outside the build session's network, so the slugs
and prices come from searches limited to openrouter.ai, whose snapshots
disagree; the highest figure seen is kept, so a reservation errs high),
per million tokens, input / cached input / output, before the fee:

| Model | Slug | Prices | Vision |
|---|---|---|---|
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | 0.66 / 0.14 / 2.70 | no |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | 0.05 / 0.01 / 1.28 | no |
| Qwen3.8 2.4T A95B | `qwen/qwen3.8-2.4t-a95b-20260812` | 2.00 / 0.25 / 6.00 | no |
| Qwen4 Max (`china`, Alibaba Cloud) | `qwen/qwen4-max-20261115` | 1.50 / 0.075 / 4.50 (listed 5% off) | no |
| Kimi K3 | `moonshotai/kimi-k3` | 2.28 / 0.228 / 24.00 | yes |
| GLM 5.3 | `z-ai/glm-5.3` | 2.10 / 0.42 / 6.60 | no |

Each row's `source` is the model's page (`https://openrouter.ai/<slug>`).
Output cap 32,000 and context 128,000 where the pages disagree; at least
4,000 output tokens a call (thinking shares the cap); no server-side
fallback; 2.0 characters a token until the ledger calibrates it.

**Tests:** `server/study/llm/compat.test.ts` (synthetic SSE only: the
request's provider preferences on every model, the China-only model without
`ignore`, include_usage, pictures as data URLs, a model without vision
refused before sending, the schema strict and in the system text; text
through comments, reasoning and `[DONE]`; settling at max(registry,
reported) × 1.055 both ways; the finish reasons, a refusal, an error inside
the stream; an abort and a finish without usage at the reservation; a 404
for no ZDR host and a 401 at $0 with the key scrubbed; the fee in
reservations; readiness and the comparison's and the route's gates);
`e2e/study/models-providers.cjs` step 8 (the key sheet, consent, the models
offered with "מחיר לא נבדק", C43's line, a blind run with DeepSeek, the
route sheet still Claude only, help's line).

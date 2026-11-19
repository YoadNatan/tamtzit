# Writing a summary on the server after upload (decision #10): research

Design only: nothing in the repo or in production was touched. Evidence is in section 2. Supabase docs could not be fetched from this sandbox (section 3).

## 1. Recommendation

Supabase decides what to write and when. A Vercel Node.js function writes one unit per call: the outline, or one part.

```
upload ─► rpc study_queue(lecture, figure URLs) ─► pg_net POST /api/study/work ─┐
pg_cron, every minute ─► study_private.dispatch() ─► pg_net POST ───────────────┤
                                                                               ▼
 /api/study/work  (Node.js, Fluid compute, maxDuration 300)
  check STUDY_WORKER_KEY → rpc study_claim (outline | part i + lease | nothing) → 202
  → in waitUntil: stream Claude, save the text every ~15 s → rpc study_finish (lease-checked)
  → cost into the ledger → dispatch the next part
```

- **One unit per call.** Hobby's 300 s cap is the time budget for each part, as today.
- **Supabase owns state and timers:** leases, retry delays, and a sweeper every minute. Nothing depends on an open phone or on a member's token.
- **One credential, `STUDY_WORKER_KEY`.**
  - It is stored in Vercel and in Supabase Vault.
  - It opens only a few `SECURITY DEFINER` functions: claim, progress and finish a part, read a lecture's slides to write it, and read the month's spend.
  - No service-role key and no bot user.
  - At upload the uploader signs the picture URLs for 48 h (it already may) and hands them to `study_queue`, so the worker never needs Storage.
- **Plans assumed:** Vercel Hobby and Supabase Free (2.1). Nothing here needs Pro.

### 1.1 Config

- **`vercel.json`:** merge into the existing file:
  ```json
  { "fluid": true, "functions": { "api/study/work.ts": { "maxDuration": 300 } } }
  ```
- **`package.json`:** add `"@vercel/functions": "3.10.5"` (released 2026-10-29; `getDeadline` exists since 3.8.0).
- **Vercel environment variable:** `STUDY_WORKER_KEY` for Production, 32+ random letters and digits.
- The existing functions stay on the edge runtime; their code changes as described in 1.4.

### 1.2 SQL sketch (in `study-schema.sql`, re-runnable)

```sql
alter table study_sections add column if not exists attempts int not null default 0,
  add column if not exists lease_id uuid, add column if not exists lease_until timestamptz,
  add column if not exists retry_at timestamptz;
alter table study_lectures add column if not exists queued_at timestamptz;
create table if not exists study_usage (id bigserial primary key, group_id uuid not null references study_groups on delete cascade,
  lecture_id uuid references study_lectures on delete set null, kind text not null,
  cost_usd numeric(10,4) not null, usage jsonb, created_at timestamptz not null default now());   -- spend ledger, append-only
create schema if not exists study_private;                                                  -- not exposed by the API
create table if not exists study_private.jobs (lecture_id uuid primary key references study_lectures on delete cascade,
  figure_urls jsonb not null, last_kick_at timestamptz);

create or replace function study_private.allow(l uuid, k text) returns void language plpgsql security definer ... as $$
begin  -- the worker key, or membership of the lecture's group
  if k is not null and k = (select decrypted_secret from vault.decrypted_secrets where name = 'study_worker_key') then return; end if;
  if public.study_is_member(public.study_lecture_group(l)) then return; end if;
  raise exception 'forbidden';
end $$;

create or replace function public.study_claim(p_lecture uuid, p_idx int default null, p_key text default null)
returns table (kind text, idx int, lease uuid, effort text) ... security definer as $$
  -- allow(); lock the lecture row (FOR UPDATE): one claimer at a time
  -- 'new', or 'outlining' untouched 3 min → 'outlining', return 'outline'
  -- cap: 1 part until one is ready (fills the prompt cache), then 2; 3 per group
  -- claimable: pending | writing with an expired lease (old rows: updated_at + 6 min)
  --   | failed with retry_at <= now() and attempts < 4      (p_idx given: only that part)
  -- lowest claimable idx → writing, new lease_id, lease_until = now() + 330 s, attempts + 1;
  --   effort 'medium' if its last error was 'timeout', else 'high'
$$;

create or replace function public.study_finish(p_lecture uuid, p_idx int, p_lease uuid, p_markdown text, p_status text,
  p_error text, p_model text, p_usage jsonb, p_cost numeric, p_key text default null) returns boolean ... as $$
  -- allow(); always insert into study_usage (a writer that lost its lease still spent money)
  -- update the part (text, status, error, usage; lease cleared; retry_at = now() + least(30 min, 2^attempts min)
  --   for transient errors, else null) WHERE lease_id = p_lease;   no row → return false
  -- lecture 'ready' when every part is; perform study_private.dispatch(p_lecture)
$$;
-- Same pattern:
--   study_progress(lecture, idx, lease, markdown, key)      saves the text so far, lease-checked
--   study_outline_done(lecture, parts, cost, usage, key)    inserts parts only if none exist; never deletes
--   study_writing_input(lecture, key)                       slides, parts, figure URLs
--   study_spent(group, key)                                 sum of cost_usd this month
--   study_queue(lecture, figure_urls)                       members only; resets failed parts, dispatches,
--                                                           returns false if Vault or pg_net is missing

create or replace function study_private.dispatch(p_lecture uuid default null) returns void ... as $$
  -- each queued lecture with claimable work: n = cap − live writers, at most one kick per lecture every
  -- 2 min unless called from finish or queue; n × net.http_post(
  --   url := <vault study_site_url> || '/api/study/work', body := jsonb_build_object('lectureId', id),
  --   headers := jsonb_build_object('content-type','application/json','authorization','Bearer ' || <vault key>),
  --   timeout_milliseconds := 10000)
$$;
-- If pg_cron exists and the job is missing:
-- select cron.schedule('study-dispatch', '* * * * *', $$select study_private.dispatch()$$);
```

- **Grants:** claim, progress, finish, outline_done, writing_input and spent go to `anon` and `authenticated`; `study_queue` goes to `authenticated` only.
- **Ledger seed:** fill `study_usage` once from `study_sections.usage`.

### 1.3 Worker sketch (`api/study/work.ts`, Node.js runtime)

```ts
import { waitUntil, getDeadline } from "@vercel/functions";
export default {
  async fetch(req: Request): Promise<Response> {
    const key = process.env.STUDY_WORKER_KEY;
    if (req.method === "GET") // health: proves Fluid compute and 300 s are live
      return Response.json({ worker: !!key, secondsLeft: Math.round(((getDeadline()?.getTime() ?? NaN) - Date.now()) / 1000) });
    if (!key || req.headers.get("authorization") !== `Bearer ${key}`) return new Response(null, { status: 401 });
    const { lectureId } = (await req.json()) as { lectureId: string };
    const db = anonClient(); // publishable key; every RPC gets p_key
    const { data: job, error } = await db.rpc("study_claim", { p_lecture: lectureId, p_key: key }).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!job) return Response.json({ claimed: false }); // duplicate kicks are harmless
    const stopAt = (getDeadline()?.getTime() ?? Date.now() + 300_000) - 25_000; // 25 s left to save
    waitUntil(run(db, key, lectureId, job, stopAt).catch((e) => console.error("study work", e)));
    return Response.json({ claimed: true, job }, { status: 202 });
  },
};
```

`run` reuses today's outline and section code, moved to `api/_lib` so both paths share it:

- It takes the same input and sends the same Claude request.
- It aborts at `stopAt`.
- It calls `study_progress` every ~15 s.
- It ends with `study_finish`, with the cost from `usageCostUsd`.

The member path (`outline.ts`, `section.ts`, with the member's token) calls the same RPCs without `p_key`.

### 1.4 Safe when the client path runs at the same time

- **One claim for everyone.**
  - Both paths go through `study_claim`.
  - When the claim is refused, `section.ts` answers 409 `busy`, and `generate.ts` must treat `busy` as "someone else is writing it".
  - This also fixes two races that exist today: `outline.ts` deletes and re-inserts the parts, and `section.ts` sets `writing` without checking.
- **Saves need the lease.** A writer that lost its lease cannot overwrite a newer part.
- **Queue and dispatch are idempotent.** An extra kick finds nothing to claim and stops.
- **Client changes:**
  - Call `study_queue` after saving the lecture.
  - `LectureView` skips `generate()` when `queued_at` is set and shows the text as Realtime delivers it.
  - It falls back to `generate()` when `study_queue` returns false, or when parts stay pending for 3+ minutes with no live lease.
  - Phones still running the old code stay safe, because the server endpoints claim.

### 1.5 Failures, timeouts, retries

| Case | Handling |
|---|---|
| Worker killed (300 s, a deploy, a crash) | The lease expires after 330 s; the next cron tick re-kicks |
| Close to the deadline | Abort at deadline − 25 s and save `failed: timeout`; the retry runs at medium effort |
| 429, 5xx, 529, network error, empty answer | `retry_at` = now + 2^attempts minutes (at most 30) |
| Refusal, other 4xx, bad key, budget | No automatic retry; "המשך כתיבה" requeues and resets the attempts |
| 4 attempts | The part stays failed |
| Outline cannot run (no slides, too many slides, budget) | The lecture is marked `failed`, so it never loops |
| pg_net request lost | pg_net does not retry; the minute sweeper does |

- **Budget.** Before every Claude call, the worker checks the month's spend from the ledger, which counts every attempt.
- **A bug today.** A retried part overwrites its earlier `usage`, so the monthly total undercounts. Every new Claude feature (quiz, chat, flashcards) should write to the same ledger.

### 1.6 What Yoad configures

1. In Supabase, open Database → Extensions and turn on `pg_net` and `pg_cron`. I could not check this menu path.
2. In the SQL editor, run once:
   ```sql
   select vault.create_secret('<key>', 'study_worker_key');
   select vault.create_secret('https://delo-logo-review.vercel.app', 'study_site_url');
   ```
3. Run `study-schema.sql` again. It prints a notice for anything missing, and the client path keeps working.
4. In Vercel, add `STUDY_WORKER_KEY` with the same key, then redeploy.
5. Check:
   - `GET /api/study/work` answers `worker: true, secondsLeft ≈ 300`.
   - `select jobname from cron.job` lists `study-dispatch`.
   - Upload one lecture to the existing group (never create a group), close the app, and come back later to see it written.

### 1.7 Limits

- **Time per part:** 300 s on Hobby. Pro allows `maxDuration` 800.
- **Retry latency:** at least one minute, the cron interval.
- **Concurrency:** 2 parts per lecture and 3 per group, because of the Anthropic per-minute limits on a new key.
- **Hobby memory quota:** 360 GB-h a month. One part takes about 0.17 GB-h (2 GB for 300 s), so 360 parts a month use about 60 GB-h.
  - Going over the quota pauses the feature for 30 days.
  - So the loop guards matter: attempt caps, concurrency caps, and kicks only for queued lectures that have work.
- **Paused database:** a paused Free project runs no cron. The keepalive workflow prevents the pause.
- **Preview deployments:** kicks always go to the production URL stored in Vault.

### 1.8 Tests (existing harness)

- **SQL:**
  - `stubs.sql` gains `vault.decrypted_secrets` (a table), `net.http_post` (records each call in `net.calls`), and `cron.schedule` with `cron.job`.
  - Checks:
    - A wrong key or a non-member is refused.
    - Queueing makes exactly one call, carrying the right URL and header.
    - The outline is claimed once.
    - Part 0 is written alone, then 2 at a time.
    - A save with the wrong lease is refused.
    - An expired lease can be reclaimed.
    - Retry delays and the attempt cap hold, and a refusal is not retried.
    - Dispatch stays within its caps when repeated.
    - The ledger counts an attempt that lost its lease.
    - The file runs twice.
- **Worker:**
  - Bundle it with esbuild, as was done for the edge functions in the scratchpad, and run it in Node.
  - Before running, set `globalThis[Symbol.for("@vercel/request-context")] = { get: () => ({ waitUntil: p => pending.push(p), deadline: Date.now() + 8000 }) }`. The @vercel/functions 3.11.3 source reads exactly this; outside Vercel it reads `{}`.
  - Mock the PostgREST `/rpc` calls, and serve a local Anthropic SSE stream through the SDK's `baseURL`.
  - Cases: 401, nothing to claim, a part saved, a timeout (short deadline), a 429 retry, a lost lease, the budget.
- **Playwright:**
  - Uploading calls `study_queue`.
  - A queued lecture gets no writing from the client.
  - Text saved so far appears.
  - "המשך כתיבה" requeues.
  - The fallback works.
- **Build:** `npm run build`. The GitHub smoke test can probe `GET /api/study/work`.
- Nothing calls production.

## 2. Evidence

### 2.1 Plans, from the repo

- **Vercel: probably Hobby (not provable).**
  - `vercel.json` has no `functions`, `crons`, `regions` or `fluid` keys.
  - Every study function runs on edge, guarded at 270 s because "Vercel ends an edge stream at 300 s" (README, `section.ts`).
  - The domain is the default `*.vercel.app`.
- **Supabase: Free.**
  - `keepalive.yml` exists because "Supabase's free tier pauses a project after ~1 week of no activity".
  - The README says "1 GB on the free tier".
- **Fluid compute:** on by default only for projects created after 2025-04-23, and this project's age is unknown. Hence `"fluid": true`.

### 2.2 Vercel (fetched)

- **Max duration with Fluid (Node.js):** Hobby 300 s, both default and maximum; Pro 800 s, and 1800 s in beta. Edge must answer within 25 s, then may stream for 300 s.
  - https://vercel.com/docs/functions/limitations
  - https://vercel.com/docs/functions/configuring-functions/duration
- **`vercel.json`:** `functions.maxDuration`; `fluid`; memory cannot be set there with Fluid. https://vercel.com/docs/project-configuration/vercel-json
- **Fluid compute:** the default since 2025-04-23; Node.js and Edge; background work through `waitUntil`. https://vercel.com/docs/fluid-compute
- **`waitUntil` and `getDeadline`:** https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
  - "Promises passed to waitUntil() will have the same timeout as the function itself. If the function times out, the promises will be cancelled."
  - `getDeadline()` is "based on the function's configured maxDuration. This includes … waitUntil tasks."
- **Edge runtime:** "We recommend migrating from edge to Node.js". Hobby edge code is limited to 1 MB gzipped. https://vercel.com/docs/functions/runtimes/edge
- **Node.js runtime:** handlers use `export default { fetch }`. Request cancellation "must be enabled on a per-route basis", so (my inference) a pg_net timeout does not stop the worker. https://vercel.com/docs/functions/runtimes/node-js
- **Cron:** Hobby allows once a day, ±59 min; Vercel "will not retry"; a run may be missed or repeated.
  - https://vercel.com/docs/cron-jobs/usage-and-pricing
  - https://vercel.com/docs/cron-jobs/manage-cron-jobs
- **Schedules (beta):** Hobby allows at most every 15 min, with 15 min of jitter and 5,000 runs per period. https://vercel.com/docs/schedules/limits
- **Queues:** beta; consumers are set with `experimentalTriggers`. https://vercel.com/docs/queues
- **Workflows:** generally available, with a Vite guide; each step is capped at the function's max duration; Hobby includes 50,000 events.
  - https://vercel.com/docs/workflows
  - https://vercel.com/docs/workflows/pricing
  - https://vercel.com/kb/guide/background-workers-on-vercel
- **Hobby quotas:** 4 CPU-hours and 360 GB-h; going over means a wait of up to 30 days. https://vercel.com/docs/plans/hobby
- **Loop detection:** `INFINITE_LOOP_DETECTED` covers apps "making an infinite number of requests to itself"; no threshold is given. https://vercel.com/docs/errors/INFINITE_LOOP_DETECTED

### 2.3 Supabase (from search excerpts: supabase.com would not resolve here, so verify)

- **Edge Functions:** wall clock 150 s on Free, 400 s on paid plans; 2 s of CPU; `waitUntil` does not extend the wall clock.
  - https://supabase.com/docs/guides/functions/limits
  - https://supabase.com/docs/guides/functions/background-tasks
- **pg_cron:** "no more than 8 Jobs run concurrently … no more than 10 minutes"; sub-minute schedules from version 1.5. https://supabase.com/docs/guides/cron
- **pg_net:** asynchronous; responses are kept 6 h; the default timeout is 1000 or 2000 ms depending on the version, so set it explicitly. https://supabase.com/docs/guides/database/extensions/pg_net
- **pg_cron + pg_net + Vault** is the documented scheduling pattern. pg_net keeps the decrypted key in `net.http_request_queue` until the request is sent. https://supabase.com/docs/guides/functions/schedule-functions
- **Tokens:** access tokens last 1 h by default; refresh tokens are single-use, and reuse revokes the session. https://supabase.com/docs/guides/auth/sessions
- **Local:** supabase-js refreshes only within 3 × 30 s of expiry (`node_modules/@supabase/auth-js/dist/main/lib/constants.js`), so a token handed over may have about 90 s left.

### 2.4 Options compared

| Option | Verdict |
|---|---|
| A. Pass the member's token along a chain | No new secret, but the token lives 1 h, no sweeper is possible, and sharing a refresh token ends the phone's session. Fallback only |
| **B. Worker key + RPCs + pg_cron/pg_net** | **Recommended:** narrowest rights, one secret, retries in the database |
| C. Bot member with a password | Trips `/board`'s sign-up trigger (`board_teachers`); needs the Email provider; must be hidden from member lists; sees comments; still needs a second key for kicks |
| D. Service-role or secret key | Bypasses RLS for every app in this shared project. Rejected |
| E. Supabase Edge Function worker | Its 150 s limit is shorter than the 270 s a part may need |
| F. Vercel Workflows, Queues, Schedules | Workflows: a second store of state, a Vite build integration, steps still 300 s, still needs a database credential. Queues: beta. Schedules: the backup sweeper if pg_cron is refused |
| G. Vercel calling itself | Needs its own URL, risks the loop detector, and has no retry timer |
| H. Message Batches | Half the price and no 300 s cap, but "most batches complete within 1 hour; maximum 24 hours", with no streaming and no `fallbacks` (skill `typescript/claude-api/batches.md`). Possible later for overnight runs |

## 3. Risks and open questions

1. **Supabase facts are unverified.** supabase.com (and workflow-sdk.dev) must be allowed in this session's network settings to fetch them. Still to confirm:
   - pg_cron and pg_net on the Free plan, and the Extensions menu path;
   - the argument order of `vault.create_secret`;
   - whether `cron.schedule` with an existing job name replaces the job.
2. **Where the key appears:** Vault; `net.http_request_queue` while a request waits; possibly statement logs, since it is passed as an RPC argument. To rotate it, change the Vault value and the Vercel variable, then redeploy.
3. **Prompt cache:** the 5-minute cache life starts when a request starts, so retries driven by cron can miss it. A 1-hour TTL costs 2× to write, and `usageCostUsd` would then have to price `ephemeral_1h_input_tokens` at $8/M.
4. **Realtime load:** every 15 s save makes `LectureView` re-fetch all parts. Use the row in the event instead, or save less often.
5. **Picture URLs:** valid 48 h, stored in `study_private`, and sent to Anthropic. Requeueing signs fresh ones.
6. **If the plan is Pro:** set `maxDuration` to 800; nothing else changes.
7. **If pg_cron or pg_net is refused:** use option A (one chain on the uploader's freshly refreshed token, stopping when less than 6 minutes remain), plus today's client path.

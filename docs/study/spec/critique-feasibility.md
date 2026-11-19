# Critique: feasibility and correctness against this codebase and platform

**Reviewed:** `spec/spec.md` (10,841 lines), all sections. Its SQL I read in `spec/integrated/sql/*.sql`, which §3.3 says it is generated from, byte for byte. Where the spec hands detail to a design or a research note, I read the relevant part of it: design-platform §1.D, §3.4, §4.1-§4.2 and §6; design-questions §7; design-collab §4.1; design-me §1.3 and §1.7; research-background §1.5-§1.7; research-claude §1 and §6; research-anki §1 and E8-E9; research-transcription §1.

I read the repo at `54a90f8`, branch `claude/vigilant-johnson-lgk7xy`, unchanged: `api/study/{health,outline,section}.ts`, `api/_lib/{study,prompts,env.d}.ts`, `src/study/StudyApp.tsx`, `src/study/lib/{api,generate,pdf}.ts`, `src/study/components/{LectureView,Together}.tsx`, `supabase/study-schema.sql`, `supabase/tests/{stubs,study}.sql`, `package.json`, `vercel.json`, the three `tsconfig` files, `vite.config.ts`, the README's study section and `dist/`. In `node_modules` I read `@anthropic-ai/sdk` 1.3.0, `@supabase/auth-js` and `vite` 5.4.21.

"spec L…" means a line of `spec/spec.md`.

**What I ran, all local.** The lab is in `/tmp/claude-0/-home-user-delo-logo-review/8f5cd170-09e0-5772-8552-13878708a92b/scratchpad/spec/_feas-lab/`, on throwaway Postgres 16.15 databases. Nothing in the repo or in production was touched.

| Script | What it checks | Result |
|---|---|---|
| `run-all.sh` | The spec's load-twice run, then every check | 0 load errors; 830 lines; 0 FAIL/ERROR. §0 and §3.6 confirmed |
| `../integrated/stages.sh` (the spec's own) | The eight package stages | All eight: 0 load errors, 0 FAIL/ERROR |
| `stages-extra.sh` | Stages the spec does not run | `identity.sql` at F+A and at F+A+W: 0 FAIL. F+A+Q+Z+C+K+P without W: 0 FAIL. F+Q+P: P's checks stop at `relation "public.study_cards" does not exist`, as expected, since A2 waits for C |
| `lease-loop.sh` | A worker that dies after every claim | FE-1 |
| `SQLFILE=device-retry.sql ./lease-loop.sh` | A phone retrying a failed part with the server off | FE-4 |
| `uniq.sh` | Unique keys on user columns, against `merge_users` | All 11 handled |
| `pub.sh` | Published tables and their keys | FE-13 |
| `vol.sh` | Whether any `stable` or `immutable` function writes (PostgREST runs those read-only) | None does |
| `rpcs.sh` | Functions callable through the API | 84 `study_*` functions, 76 of them new |
| `tsc/` | Ported shared modules (`fsrs.ts`, `day.ts`, `plan.ts`, `agenda.ts`, `estimates.ts`) under the client's ES2020 tsconfig | `tsc` exit 0 |

**Fetched today, 2026-11-15:**
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- https://vercel.com/docs/functions/runtimes
- https://vercel.com/docs/functions/configuring-functions/advanced-configuration
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/project-configuration/vercel-json
- npm registry metadata for `@huggingface/transformers@4.3.2`, `onnxruntime-node@1.30.0`, `@sparticuz/chromium@153.0.0`, `playwright-core@1.63.0`, `@vercel/functions@3.10.5` and `sql.js@1.15.2`

**Not verified, said plainly**
- **Unreachable hosts.** `supabase.com` and `unpkg.com` do not resolve in this session; they would have to be allowed in the session's network settings. Supabase's token lifetime comes from design-me's quote of the Sessions doc plus the local `auth-js` source. The behaviour of `onnxruntime-node`'s postinstall comes from research-transcription plus npm metadata.
- **No live service.** No Vercel deployment, Supabase project or Anthropic call was used.
- **Estimates.** Line counts are estimates (±30%). The method is in "Package sizes" below.

**Count: 2 blockers, 10 major, 13 minor.**

| ID | Severity | Where | Finding |
|---|---|---|---|
| FE-1 | **blocker** | §2.3, §3.3 W (`plan`, `waiting`, `study_claim`) | A worker that dies after its claim is re-claimed forever. Each retry is a paid call that is never charged |
| FE-2 | **blocker** | §9.1 steps 2-3, §7 "Done when", §5.4 | Merging deploys before the SQL runs, so following §9.1 takes the library and every lecture down |
| FE-3 | major | §4.4 vs §2.6 | The recording-notes call uses the parse helper that §2.6 forbids. A fallback or a cut makes it throw |
| FE-4 | major | §3.3 W (`plan`, `study_queue`), §2.3 | With the server off, a part that failed 4 times can never be written again from a phone. Today it can |
| FE-5 | major | §4.2 `charge()`, §4.3.4, §4.6-§4.9 | The member's token can expire before the final save and charge. The ledger silently drops the spend |
| FE-6 | major | §2.8, §5.4 `groupLive`, §5.6 LectureView | Supabase allows 5 presence calls per client per 30 s. The reader already exceeds it; the spec adds a second presence channel |
| FE-7 | major | §8, §4.10, §5.4 | No test connects the TypeScript to the SQL. 76 new RPCs are reached only through hand-written mocks; the server loop first runs in production |
| FE-8 | major | §5.3, §5.5-§5.6 F, §7.F | F is a ~7,000-line serial gate that also builds K's, W's and A2's UI inside F's files |
| FE-9 | major | §5.3, §7 gate | The reader's entry chunk is 325 kB, and every package's screens are static imports, so the 500 kB gate will fail late |
| FE-10 | major | §7 F-6, K-2, §8.3, §8.4, §10.2 | Test fixtures live in the session scratchpad, not in the repo |
| FE-11 | major | §5.6 `package.json`, §7 rule 3 | F installs transformers.js for everyone: onnxruntime-node (301 MB, postinstall) and sharp, with no `ONNXRUNTIME_NODE_INSTALL=skip` |
| FE-12 | major | §2.10 release 2, §4.3.4, §7.W | W replaces the core writing path at merge, with no switch back |
| FE-13 | minor | §2.8, §3.3 W | Two of W's published tables break §2.8's own key rule, and their deletions never reach a filtered listener |
| FE-14 | minor | §4.2 `UNKNOWN` | The "dearest" fallback price undercounts a Fable fallback |
| FE-15 | minor | §4.5 | PDF: a character limit that can exceed 4.5 MB, two Chromiums in one 2 GB instance, an untested binary pairing, an unpinned Node version |
| FE-16 | minor | §5.4 vs K's `shareAnswer` | Answers of up to 4,000 characters are cut at 2,000 by F's `addComment` |
| FE-17 | minor | §5.3 rule vs §7.Z | Z imports Q's non-slot files, which the slot rule forbids |
| FE-18 | minor | §7 F-1, §7 gate "flags off" | Unflagged F changes the flows, so "the same steps output as before" cannot hold |
| FE-19 | minor | §4.11, §6.3 | The error-code lists already diverge from the SQL's `raise exception` texts |
| FE-20 | minor | §2.4, §2.6 | Cost estimates rest on an unmeasured chars-per-token figure, and the server path's cache misses are not counted |
| FE-21 | minor | §3.5 I17 | The merge guard checks the text of `merge_users`, not unique-key collisions |
| FE-22 | minor | §3.1, §3.3 F and A | A stale "keep it LAST", a dead first definition, and no rule for changing an RPC's signature |
| FE-23 | minor | §3.3 F `study_charge` | Any member can charge up to $99.99 a row to any kind |
| FE-24 | minor | §4.3.1, §4.3.2 outline | A thrown outline call is never charged |
| FE-25 | minor | §3.6, §8.3 | The stage labels mislead, P's dependence on C is unstated, and the all-flags e2e run has no owner |

---

## Blockers

### FE-1 · A dead worker's unit is re-claimed forever, and its spend is never charged

**Where:** §2.3; §3.3 section W: `study_private.plan` (spec L1080 parts, L1104 notes), `study_private.waiting` (spec L1112-1121), `study_claim` (spec L1233), `dispatch` (spec L1160); §4.3.3.

**What is wrong.**
- **The re-claim has no limit.** Suppose a server writer stops after `study_claim` and before `study_finish`. Causes include the function being killed, out-of-memory, a platform restart, or an RPC error thrown out of `writeUnit` (§4.3.2 promises only "never throws for model errors"). The unit then stays `writing` with an expired lease. `plan()` treats an expired `writing` part or notes row as claimable with no attempts check; the `attempts < 4` cap applies only to `failed` units. `waiting()` keeps the job queued.
- **The sweeper never gives up.** Every server claim resets `kicks_since_claim` to 0, so the 15-kick stop never trips.
- **Nothing charges the spend.** Each cycle is a new paid model call: a 330 s lease, then the next minute's sweep, so about 10 an hour for each stuck unit. Only `study_finish` charges, so none of these calls reaches the ledger.
- **The research asked for this guard.** research-background §1.7 says "the loop guards matter: attempt caps…", because the Hobby memory quota is per deployment. This deployment also serves `/board`, `/jerusalem`, `/prague` and the logo board.

**Evidence.**
- **Reproduction.** `_feas-lab/lease-loop.sh` loads the full schema with a worker key in the Vault stand-in, then runs claim, lease expiry and sweep 12 times. Result: 12 claims of part 0 in a row, `attempts` = 12, the job still queued, 13 kicks recorded by the pg_net stand-in, and 0 ledger rows.
- **Code.** `30-writing.sql` L171-173 and L195-197 (the claimable conditions), L204-213 (`waiting`), L252 and L325 (the kick counter and its reset).
- **Vercel Hobby** (https://vercel.com/docs/plans/hobby): "Provisioned Memory 360 GB-hrs", and "if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again".

**Fix.**
1. In `plan()`, re-claim an expired `writing` unit only while `attempts < 4`; do the same for notes.
2. In `study_claim` and `dispatch`, mark an expired-lease unit with `attempts >= 4` as `failed`, with `error = 'lost'` and `retry_at = null`. `waiting()` then drops it, and "המשך כתיבה" can restart it.
3. Let `study_progress` carry the running `usage` and keep it on the row. When `study_claim` takes over an expired lease, it inserts that usage into `study_usage` with `usage.estimated = true`.
   - This changes `study_progress`'s signature, so drop the old overload (FE-22).
4. Add checks:
   - "4 claims without a finish end `failed lost`, and the sweeper stops".
   - "the takeover charges the dead attempt".

### FE-2 · Merging deploys before the SQL runs, so following §9.1 takes the app down

**Where:** §9.1 step 2, "After F merges: SQL Editor → run … Then deploy" (spec L10538); step 3, "After each later package merges: run … again, redeploy" (spec L10539); §7.F "Done when"; §5.4's `api.ts` row (spec L8665); §4.3.1.

**What is wrong.**
- **A merge is a deploy.** The project deploys from `main` (the brief), so merging is deploying. From the merge until Yoad runs the SQL, the live app runs F's code against the old schema.
- **Reading breaks.** `getSections` selects `rev, gen, lease_until, attempts, retry_at, writer`, and `LECTURE_COLUMNS` adds `queued_at` (§5.4). Postgres refuses a select of a missing column (error 42703), so the library and every lecture fail to load. LectureView then shows "ההרצאה לא נטענה".
- **Writing breaks.** `outline.ts` and `section.ts` call `study_spent` and `study_charge` (§4.3.1), which do not exist yet, so no summary can be written.
- **W repeats both.** Its device path calls `study_claim`, `study_writing_input` and `study_part_corrections`.
- The group uses the app every day.

**Evidence.**
- `api.ts` L191-198 and L87-88 use explicit select lists.
- **The other order is safe.** Every section only adds things:
  - `run-all.sh` runs the repo's own `study.sql` with every section loaded: 0 FAIL.
  - Today's clients send replies as `comment` (`Together.tsx` L178), so section K's new `study_comments_reply_kind` constraint does not break them.

**Fix.**
- **Run the SQL first.** In §9.1 and in every package's "Done when": run the package's section from the PR branch in the SQL editor before merging, then merge (which deploys), then set the flags.
- **Add a guard.** Each section bumps a `study_schema_version()`, `/api/study/health` reports it, and F's client and functions refuse loudly when it is older than they need. The smoke workflow then catches a merge that came first.

---

## Major

### FE-3 · The recording-notes call uses the parse helper that §2.6 forbids

**Where:** §4.4 (spec L7548-7557) vs §2.6 (spec L297).

**What is wrong.**
- **The contradiction.** §2.6 says the plain schema is always passed, "never the helper with its parse function: SDK 1.3.0 parses every text block at `message_stop` and throws…". §4.4 does exactly that: it calls `beta.messages.stream` with `fallbacks: "default"` and `format: betaZodOutputFormat(Notes)`, then reads `final.parsed_output`.
- **The failure.** A mid-stream fallback (two text blocks) or a `max_tokens` cut makes `finalMessage()` reject with "Failed to parse structured output". §4.4 expects `refusal` or `truncated` instead.
- **The ledger loses the call.** The notes call does not go through `run()`, which tracks usage from `message_delta`, so the final usage is lost with it.
- **It is likely here.** Opus 5.5's classifiers include `bio` (`shared/models.md`), and these are parasitology lectures, so a fallback is plausible.

**Evidence.**
- `node_modules/@anthropic-ai/sdk/lib/beta-parser.js`: `parseBetaMessage` parses every text block, and `parseBetaOutputFormat` throws `AnthropicError("Failed to parse structured output…")`.
- `lib/BetaMessageStream.js` L492-498 runs that parse at `message_stop`.
- research-claude §1: "This was tested."

**Fix.**
- Send notes through F's `run()` with `cleanSchema(zodOutputFormat(Notes).schema)`.
- At the end, `Notes.safeParse(JSON.parse(<last text block>))`. No parse means `truncated`; `stop === "refusal"` means `refusal`.
- Add the fallback-replay case to `notes.test.ts`.

### FE-4 · With the server off, a part that failed 4 times can never be written again from a phone

**Where:** §3.3 W `plan()` (spec L1081), `study_queue` (spec L1194 returns before the reset at L1202); §2.3 "Without pg_net … the phones write as today".

**What is wrong.**
- **When this applies.** Server writing is off until §9 step 4, and again whenever pg_net or Vault is missing.
- **The cap.** The phone claims through `study_claim`, which adds 1 to `attempts` and refuses a `failed` part once `attempts >= 4`.
- **The reset never runs.** "המשך כתיבה" should reset the attempts through `study_queue(p_retry_failed)`. But `study_queue` returns `false` at `server_on()` before it reaches the reset.
- **What the member sees.** After four refusals or timeouts, `section.ts` answers 409 `busy`, `generate.ts` skips the part, and the button stays but does nothing.
- **Today this works.** The button retries without limit (`generate.ts` L193-195; LectureView `needsWork` L471-476).

**Evidence.** `_feas-lab/device-retry.sql` (run it with `SQLFILE=device-retry.sql ./lease-loop.sh`):
- taps 1-4 claim the part and fail it;
- taps 5-6 claim nothing ("409 busy (attempts 4)");
- `study_queue(..., true)` returns `false`, and attempts stay at 4;
- the next claim still gets nothing.

**Fix.**
- Do the `p_retry_failed` reset before the `server_on()` return, or give members a separate `study_retry_failed(p_lecture)`, and have `useWriting` call it on every tap.
- Or cap only server claims; a phone's claim follows a person's tap.
- Add a check for it.

### FE-5 · The member's token can expire before the final save and charge

**Where:** §4.2 (`memberClient`, and `charge()` "Never throws: a failed write is logged", spec L7324); §4.3.4 (the phone path's `study_finish`); §4.6-§4.9 (the saves and `*_finish` of every op).

**What is wrong.**
- **The token.** Each call runs up to 270 s, then saves and charges with the access token the phone sent at the start. supabase-js hands out a session that only has to last 90 s more (`EXPIRY_MARGIN_MS` = 3 × 30 s). A call that starts within the last ~4.5 minutes of a token's life (one hour, per the Sessions doc that design-me quotes) therefore ends with an expired token.
- **What fails.** The final RPCs are refused: `study_finish`, `study_save_question`, `study_question_finish`, `study_card_*`, `study_charge`.
- **The ledger misses it.** `charge()` swallows the error, so the spend disappears silently.
- **The phone path pays twice.** The part stays `writing` until its lease runs out, and then it is written again.
- **How often.** About (270 − 90) / 3600 ≈ 5% of long calls. Writing a lecture from a phone takes about 20 minutes, so roughly one lecture in three crosses a token boundary.
- **Today.** `section.ts` already has a quiet version of this: its `finally` update ignores the error.

**Evidence.**
- `node_modules/@supabase/auth-js/dist/module/lib/constants.js` L3-L10, and `GoTrueClient.js` L2456: `getSession` refreshes only within that margin.
- `api.ts` L472-476: `authHeader` uses `getSession`.
- `api/_lib/study.ts` L60-73: the token is captured once.
- `section.ts` L167-178.
- design-me.md L1712: the Sessions doc's 1-hour default.
- Not checked against supabase.com, which is unreachable.

**Fix.**
- **Client.** `authHeader()` calls `await sb.auth.refreshSession()` first when `expires_at − now < 360 s`.
- **Server.** `memberClient` reads `exp`, which `getUser` has already verified, and refuses with 401 `session expiring` when under 300 s remain. The phone refreshes and retries.
- **Make the misses visible.** Count failed charges in the stream's `done` line, so a gap shows up in tests and in logs.

### FE-6 · The reader already exceeds Supabase's presence limit, and the spec adds a second channel

**Where:** §2.8 (`study-group-<group>`, a new private presence channel); §5.4 `groupLive`; §5.6 LectureView ("`startReading(on)` also calls `groupLive.setReading()`").

**What is wrong.**
- **The limit.** Supabase Realtime allows "Presence calls per client, per 30 seconds: 5" on every plan, and warns that calling `track()` rapidly floods the channel.
- **Today.** The reading room calls `track()` for every paragraph the reader passes (LectureView L233-L251, with only a 250 ms debounce; `api.ts` L393-396).
- **The spec adds load.** The group channel is a second presence channel on the same socket, and the reader tracks it too. Nothing budgets or throttles either channel.
- **Where it hurts.** Followers lag or freeze exactly in group reading, which Shoham calls "the most essential part".
- **No test can catch it.** The e2e mock does not enforce the limit.

**Evidence.**
- `spec/_quiz-docs/limits.mdx` L26 (a copy of Supabase's Realtime limits page).
- `spec/_quiz-docs/presence.mdx` L26.

**Fix.**
- **Throttle.** At most one `track()` every 7 s for the reader's place, with a trailing update. Count the group channel's start and stop calls in the same budget.
- **Or use Broadcast** for the place, which has its own message limits. Keep presence for who is here and who is reading.
- **Teach the mock.** `e2e/study/mock.cjs` should refuse the 6th presence call per socket in 30 s.
- **Share the workaround.** `groupLive` should reuse `readingRoom`'s join and leave bookkeeping through one helper. That is the realtime-js 2.108 workaround (README, "A workaround for realtime-js"), which §5.4 does not restate.

### FE-7 · No test connects the TypeScript to the SQL

**Where:** §8.1-§8.3; §4.10; §5.4.

**What is wrong.**
- **The surface.** The ops and client wrappers call 76 new RPCs by name with named parameters, and PostgREST matches parameter names exactly. They also read and insert explicit column lists.
- **The tests never meet the SQL.**
  - The Node tests use a hand-written PostgREST mock.
  - Each package's e2e uses its own JS mock; Z's is "a ~250-line port of the SQL state machine".
  - The SQL checks call the functions positionally from psql.
- **The result.** A renamed parameter or column passes every layer here and fails only in production.
- **The server loop is never run before production.** That is queue → pg_net → `work.ts` → claim → finish → dispatch. Its first end-to-end run is on production, with the real group (§8.6: the Vault URL is production's).

**Evidence.** `rpcs.sh` (76 new RPCs); spec L10433-L10470; I searched the spec and the designs for a contract test and found none.

**Fix.**
- **A contract test in `npm run test:study`.**
  - Load the schema into a throwaway database (§3.6).
  - Extract every `rpc("name", { … })` key set and every `.from("t").select/insert` column list from `server/`, `shared/` and `src/study/`.
  - Check them against `pg_proc.proargnames` and `information_schema.columns`.
- **Make the mocks strict.** Each package's mock plugin refuses parameters that are not in the same introspection dump.
- **Test the server loop before production.** Point `study_site_url` at a Preview deployment with a bypass token for one run. Otherwise, add a local harness that replays `net.calls` into `work.ts`.

### FE-8 · F is a ~7,000-line serial gate that also builds other packages' UI

**Where:** §5.3; §5.5 (F); §5.6, the rows for SummaryView, Library and LectureView (spec L8795-8799); §7.F steps 5-7.

**What is wrong.**
- **Nothing starts until F merges.** By my estimate below, F is the largest package.
- **F builds other packages' UI in F's files.**
  - In SummaryView: K's paragraph actions, edit chip, flash and compact rendering, and W's "מההקלטה" boxes. These are the props `actions`, `onAction`, `edited`, `flash`, `editable`, `onTag`, `badSlides`, `compact`, `recNotes`, `onRecTime` and `eager`.
  - K's ask bar, in Library.
  - A2's `mk`, `read` and `follow` deep links, in LectureView.
  - All of their CSS, in `study.css`.
- **Every later change is a PR to F.** Anything K, W or A needs in that rendering goes through F's files. "No two packages edit one file" holds on paper only.
- §7.F step 6 even says to build every new SummaryView prop "rendered from test data".

**Fix.**
- **Split F.**
  - **F0:** the server move, budget and ledger, the interim ledger edits, section F's SQL and stubs. It is about 1,500 lines, it fixes today's undercount, and it can ship in days.
  - **F1:** the shell, routes and slots.
- **Use generic hooks.** Replace the feature-specific SummaryView props with slot callbacks that K and W own, for example `blockExtras(part, anchor)` and `blockState(part, anchor)`.

### FE-9 · Every package's screens are static imports, so the 500 kB gate will fail late

**Where:** §5.3 (the slot modules); §7's gate "no new warning about chunk size for the reader's entry".

**What is wrong.**
- **Today.** The study entry chunk is already 325 kB (`dist/assets/study-CksXhmZY.js`, 325,344 bytes). Vite warns at 500 kB.
- **The spec.** The slot modules import every package's screens statically. Only `anki.ts` and the transcription worker load lazily.
- **The result.**
  - About 20,000 lines of new client code land in the entry chunk.
  - The gate fails in a late package.
  - Fixing it then means changing F's slot signatures.

**Evidence.**
- `node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js` L65419: `chunkSizeWarningLimit: 500`.
- A search for "lazy" in spec.md finds only `anki.ts`.

**Fix.**
- **Lazy from F's first commit.** In the slot contract, screens load through `React.lazy(() => import(...))` behind `Suspense`.
- **Static only where small.** Chips, banner lines and hooks stay static.
- **Measure it.** Add an entry-chunk size check, for example ≤ 400 kB, to F-10.

### FE-10 · Test fixtures live in the session scratchpad, not in the repo

**Where:** §7 F-6 and K-2 (spec L10283, L10368); §8.3 (spec L10455); §8.4 step 1; §7 C-3 (`spec/cards-proto/test/oracle.mjs`); §10.2.

**What is wrong.**
- **Fixtures outside the repo.** The acceptance tests read `spec/integrated/fixtures/antiparasitics/…` and the deck at `/root/.claude/uploads/…`. Both are outside the repo, in a scratchpad that cleanup can clear.
- **No repo path.** §10.2 assigns no repo path for fixtures, so neither the builders nor CI can re-run these tests, today or later.
- **Real course content.** The fixtures are the group's own lecture (`slides.json` and the summary parts). Check the repo's visibility before committing them.

**Fix.**
- **Give fixtures a home.** Add `e2e/study/fixtures/` (or `server/study/__fixtures__/`) to F's ownership. Put in it the seven parts, `slides.json`, `outline-r4.json`, the FSRS oracle table and a small `.pptx` that may be redistributed.
- **Or synthesize them.** Generate fixtures with the same structure (Hebrew and English mixed, tables, boxes, figures) and no course content.

### FE-11 · F installs transformers.js, with onnxruntime-node and sharp, for everyone

**Where:** §5.6, the `package.json` row (spec L8809); §7 rule 3; D15 and D16.

**What is wrong.**
- **What gets added.** F's one `package.json` change adds `@huggingface/transformers` 4.3.2. Its dependencies include:
  - `onnxruntime-node` 1.30.0: 301 MB unpacked, with `postinstall: node ./script/install`;
  - `sharp` ^0.35.4, which ships native binaries.
- **Who pays.** From F's merge on, every Vercel build and every package's `npm ci` downloads and installs them, for a feature that:
  - runs only in the browser;
  - stays off until BGU's recording policy has been checked (D16).
- **A missing setting.** research-transcription says the postinstall download must be turned off with `ONNXRUNTIME_NODE_INSTALL=skip`. The spec never sets it: not in §5.6, not in `.env.example`, not in §9.1.

**Evidence.**
- `npm view @huggingface/transformers@4.3.2 dependencies` lists sharp, onnxruntime-web, onnxruntime-node, @huggingface/jinja and @huggingface/tokenizers.
- `npm view onnxruntime-node@1.30.0` gives `postinstall`, and `dist.unpackedSize` = 301,068,136.
- research-transcription.md L153.

**Fix.**
- **Best: no npm dependency.** `transcribe.worker.ts` loads transformers.js from jsDelivr, at a pinned version with SRI. jsDelivr is already named in the privacy note.
- **Otherwise:** add the package only in W-2's PR, as an explicit exception to rule 3, together with `ONNXRUNTIME_NODE_INSTALL=skip` in Vercel's environment and in `.npmrc`. Measure the Vercel build time before and after.

### FE-12 · W replaces the core writing path at merge, with no switch back

**Where:** §2.10 release 2 ("none (server on when §9 step 4 is done)"); §4.3.4; §7.W ("Flags: none for server writing").

**What is wrong.**
- **What changes at merge.** W replaces how every member writes summaries, the app's core:
  - `outline.ts` and `section.ts` go through `study_claim`;
  - `generate.ts` gains `busy` handling;
  - `useWriting` is new.
- **No way back.** Only a git revert undoes it. Only the server path waits for Yoad's setup.
- **The defects are on this path.** FE-1, FE-2 and FE-4 all sit on it.

**Fix.**
- **A server switch.** `outline.ts` and `section.ts` read an environment switch, for example `STUDY_DEVICE_CLAIMS=0`, that means "write directly, as today".
- **A client flag.** The new `useWriting` goes behind a flag.
- Turn both on after a week of clean ledger and writing.
- **Or split W.** Ship W's phone-path change in its own PR, after W's SQL has been live.

---

## Minor

**FE-13 · Two of W's published tables break §2.8's key rule** (§2.8; §3.3 W, spec L923-L971).
- **The rule.** §2.8: "a published table has its own random uuid primary key".
- **Where it breaks.** `study_recordings` (key `lecture_id`) and `study_recording_notes` (key `lecture_id, part_idx`); the output of `pub.sh` lists both.
- **The consequences.**
  - A delete event goes to every subscriber, because RLS is not applied to deletes.
  - A delete can never match a `lecture_id` filter under the default replica identity (`postgres-changes.mdx` L3442, L3625).
  - So W's `watchRecording` never sees a recording disappear.
- **Fix.** Give both a `uuid` primary key, keep `unique(lecture_id[, part_idx])`, and listen to deletes without a filter, as `watchLecture` does (`api.ts` L233-236).

**FE-14 · The "dearest" fallback price undercounts a Fable fallback** (§4.2, spec L7304).
- **The gap.** `UNKNOWN = {in: 5, out: 25}` is not the dearest rate. Fable 5.2 costs $8/$40, and Fable 5.1 and Fable 5 cost $10/$50 (`_claude-docs/about-claude_pricing.md` L17-21).
- **Why it matters.** Default routing is "not published" (refusals page L494), so a Fable fallback cannot be ruled out.
- **Fix.** Set `UNKNOWN` to $10 in, $12.50 5-minute write, $20 1-hour write, $1 hit, $50 out.

**FE-15 · Four PDF issues** (§4.5; W-4; §5.6).
- **(a) The size limit is in characters.**
  - `html` is limited to 3,000,000 characters. In UTF-8 a Hebrew character takes 2 bytes, so that can pass the 4.5 MB request limit. Vercel then answers 413 before the handler runs (limitations page).
  - Fix: limit bytes (≤ 4 MB).
- **(b) Two browsers in one instance.**
  - Fluid compute can run two invocations in one 2 GB instance, so two members exporting at once start two Chromiums. design-platform L1667 cites @sparticuz's "1600 MB (or more) is recommended".
  - Fix: one browser per instance, and one render at a time.
- **(c) The binary pairing is untested.**
  - W-4 tests with Playwright's own Chromium, so `@sparticuz/chromium` 153 with `playwright-core` 1.63 is first tried on Preview.
  - Fix: make the Preview test include two exports at once.
- **(d) The Node version is not pinned.**
  - `@sparticuz/chromium` 153.0.0 declares `engines.node: ^22.17.0 || >=24.0.0` (npm), and the spec does not pin the project's Node version.
  - Fix: add `"engines": { "node": "22.x" }`, or check Vercel's setting.

**FE-16 · Answers of up to 4,000 characters are cut at 2,000** (§5.4 vs design-collab L1214-1215).
- **The gap.** K's `shareAnswer` posts answers of up to 4,000 characters (section K's check allows that), but `addComment` cuts every body at 2,000 (`api.ts` L325).
- **Why K cannot fix it.** §5.4's list of `api.ts` changes does not include this, and K may not edit `api.ts`.
- **Fix.** Add "4,000 for kind `answer`" to F's row, plus an e2e assertion.

**FE-17 · Z imports Q's non-slot files** (§5.3 rule; §7.Z; §2.12 #20).
- **The conflict.** §5.3 says a package never imports another package's non-slot file, but Z imports Q's `QuestionCard.tsx` and the types in `lib/practice.ts`.
- **Fix.** Either allow declared cross-package imports, in the rule and in §7 rule 2's path check, or move the card's props type into `features/types.ts`.

**FE-18 · "The same steps output as before" cannot hold** (F-1; §7 "with every flag off (the app must behave as today)").
- **Why.** F changes today's flows without a flag:
  - the privacy sheet before the first upload;
  - "יציאה" moved to "שלי";
  - the tab bar, and the offsets it adds.
- **Fix.** The moved scripts must seed `study-privacy-v1` and update their selectors. Say so in F-1.

**FE-19 · The error-code lists already diverge from the SQL** (§4.11, §6.3).
- **The gap.** The sections' SQL has 78 distinct `raise exception` texts (`_feas-lab/sql-codes.txt`). Several codes a member can reach have no row in §6.3 and fall back to the area's generic line:
  - `retired`, `question not found` (practice);
  - `bad undo` (corrections);
  - `card not found`, `nothing to revert`, `too old` (cards);
  - `plan not found`, `marathon not found`, `no agenda` (plan and marathons);
  - `bad figures` (writing).
- **Fix.** A unit test: the SQL's raise texts must fall within `failText`, `QUIZ_ERROR_TEXT`, `authErrorText` or an explicit list of internal codes.

**FE-20 · Cost estimates rest on unmeasured figures, and the server path's cache misses are not counted** (§2.4, §2.6).
- **Unmeasured inputs.** The per-feature costs assume 2.5 characters per token for Hebrew ("Not measured: no tokenizer here", research-claude §6) and a 50% thinking share.
  - Production already stores real `usage` and `markdown` for every written part, so one read-only query by Yoad can calibrate this before release 4.
- **Cache misses on the server path.** §2.4's "$0 extra" assumes the second wave reads part 0's cache.
  - `plan()` keeps the cap at 1 until part 0 is ready, which can take 270 s. A pg_net kick and a cold start follow, so the 5-minute entry can lapse.
  - Today's `generate.ts` also waits for the whole first part, so this is no regression. The estimate should still include it.
- **Effort changes after a timeout.** §2.6 fixes effort per op, but four ops change it after a timeout, and a top-level change invalidates the messages cache. A per-message effort change keeps the cache (beta `mid-conversation-output-config-2026-07-01`; `shared/prompt-caching.md` L235).

**FE-21 · The merge guard checks text, not collisions** (§3.5 I17).
- **The gap.** I17 checks the text of `merge_users`. A new table whose user column is part of a unique key passes I17, then fails at merge time when both users have rows.
- **Today it holds.** All 11 such keys are handled (`uniq.sh`).
- **Fix.** Add a dynamic check that seeds both users in every table that has a user column, then merges them.

**FE-22 · Three SQL upkeep issues** (§3.1, §3.3).
- **A stale comment.** Section A's header says "Keep it LAST in study-schema.sql" (spec L763), but §3.1 places section A second.
- **A dead definition.** Section F redefines `study_can_use_topic`, while the original stays at `study-schema.sql` L137-151 and is replaced on every run.
  - Fix: edit the original in place. F owns the file.
- **No rule for signature changes.** `create or replace` cannot change a function's arguments. The first RPC that gains a parameter keeps its old overload (FE-1's fix does this), and PostgREST calls can then become ambiguous.
  - Fix: require `drop function if exists <old signature>` with every signature change.

**FE-23 · Any member can charge up to $99.99 a row** (§3.3 F, spec L527 and L587-605).
- **The gap.** `study_charge` is open to every member for any kind and any cost below $100 a row. One member, or anyone with the join link from WhatsApp, can use up the month and stop every summary.
- **The risk is small.** Members can already spend through the ops.
- **Fix.** Members may charge only the kinds the ops use, with `p_cost <= 5`.

**FE-24 · A thrown outline call is never charged** (§4.3.1, §4.3.2).
- **The gap.** Today's `outline.ts` swallows a thrown `messages.parse` (`max_tokens`, a network error). F's interim edit and W's writer both charge "after `messages.parse`", so a thrown call leaves no usage to charge.
- **The size.** Small, because the outline runs at low effort, but every call is meant to count.
- **Fix.** Track usage as `run()` does, or charge an estimate.

**FE-25 · Three gaps in test staging** (§3.6, §8.3).
- **A misleading label.** `stages.sh`'s row "F + A1 identity" runs only section F's checks, not `identity.sql`. I ran `identity.sql` at F+A and at F+A+W: 0 FAIL.
- **An unstated dependency.** P's checks need C's tables: F+Q+P fails on `study_cards`. This matches A2 waiting for C, but §3.6's table of merge orders should say so.
- **No owner.** No package owns §8.3's final run with every flag on.

---

## Package sizes (lines of code, estimated)

**How these were estimated.**
- **Exact:** the SQL and its checks, from `spec/integrated/sql` and `tests`.
- **Ported code:** the prototypes' line counts, plus 10-30% for integration.
- **Screens:** sized against this app's own components:
  - `LectureView.tsx` 726, `Together.tsx` 351, `SummaryView.tsx` 344, `Upload.tsx` 196, `Library.tsx` 195;
  - `study.css` 946.
- **Margin:** ±30%.
- **Not counted:** generated font data and copied fixtures.
- **For scale:** today's whole study app (server, client, CSS, SQL and SQL tests) is about 5,500 lines.

| Package | SQL + checks (exact) | Server TS | Shared TS | Client TS/TSX | CSS | Tests (unit + e2e + evals) | **Total** | Of which ported or moved |
|---|---|---|---|---|---|---|---|---|
| **F** | 364 | ~640 | ~330 | ~2,700 | ~350 | ~2,600 | **~7,000** | ~1,200 moved from the repo; `claude.ts` 192 |
| **W** | 772 | ~1,450 | ~70 | ~2,100 | ~280 | ~1,750 | **~6,400** | `transcript.ts` 107 |
| **Q** | 949 | ~1,300 | ~40 | ~2,800 | ~450 | ~1,270 | **~6,800** | `questions.ts` 321, prompts 150 |
| **Z** | 1,411 | — | — | ~1,850 | ~420 | ~980 | **~4,700** | `quizLogic` 246, `useQuiz` 130, `quizApi` 74 |
| **C** | 1,100 | ~565 | ~390 | ~2,530 | ~450 | ~1,440 | **~6,500** | `fsrs` 311, `cards` 214, `ankiMap` 144 |
| **K** | 611 | ~915 | ~420 | ~2,170 | ~450 | ~1,420 | **~6,000** | `blocks` 325, `ask` 247, `mnemonic` 194 |
| **A1** | 374 | — | — | ~820 | ~150 | ~570 | **~1,900** | `account` 185 |
| **A2** | 1,132 | — | ~530 | ~2,370 | ~300 | ~850 | **~5,200** | `plan` 353, `agenda` 96, `day` 67 |
| **All** | **6,713** | ~4,900 | ~1,800 | ~17,300 | ~2,850 | ~10,900 | **~44,500** | ~2,800 lines of prototype TS |

**What this means.**
- **The scale.** The build is about 8 times today's app, and every package's PR must also re-run every earlier package's e2e.
- **The critical path.** F (≈ 7,000, FE-8) and then W, the riskiest (server worker, PDF, in-browser speech recognition).
- **What can ship early.** A1 is small. F0 (FE-8) and K's corrections need no Claude call.

---

## Checked and holds

- **The SQL.**
  - Run twice, it loads with 0 errors, and every check passes (830 lines).
  - Each of the spec's eight stages passes alone.
  - No `stable` function writes, so PostgREST's read-only RPCs are safe.
  - `merge_users` handles every unique key that contains a user column.
- **The repo references.**
  - `lectureBlock` is byte-identical to `section.ts` L93.
  - `study-schema.sql`: one group at L201-206, the policy loop at L253-262, the grant at L306, and the board patch last (L421-448).
  - `signOut()` defaults to `global` (auth-js `GoTrueClient.js` L3316).
  - `StudyApp.tsx`: `View` at L15-22, the join redirect at L106.
- **The SDK and `@vercel/functions`.**
  - SDK 1.3.0 reads `ANTHROPIC_BASE_URL` (`client.js` L102).
  - SDK 1.3.0's types have everything §2.6 and §4 use:
    - the `fallbacks` parameter;
    - top-level `cache_control`;
    - `output_config.effort` and `output_config.format`;
    - `BetaFallbackBlock.to.model`;
    - `usage.iterations` with a model on each entry;
    - `APIConnectionError` as a subclass of `APIError`;
    - the `betaZodOutputFormat` export.
  - `@vercel/functions` 3.10.5 exports `waitUntil` and `getDeadline`, and reads `Symbol.for("@vercel/request-context")`.
- **The Vercel facts in §2.1 match today's pages.**
  - Hobby: 300 s default and maximum; 2 GB; a 250 MB bundle; 4.5 MB bodies, with streamed responses exempt.
  - 12 functions per deployment on Hobby without a framework.
  - Files that start with `_` or `.`, and `.d.ts` files, are not functions; shared code belongs outside `api/`.
  - `waitUntil` shares the function's timeout, and `getDeadline()` returns `undefined` outside Vercel.
  - `fluid` is a documented `vercel.json` property.
- **The Anthropic facts.**
  - The prices in §2.4 match the copy of Anthropic's pricing page.
  - The 512-token cache minimum, and "readable only after the first response begins streaming", match the skill's `shared/prompt-caching.md` L135 and L254.
  - Forced `tool_choice` returns a 400 on Opus 5.5 (`shared/models.md`).
- **The client and the function count.**
  - The ported shared modules compile under the client's ES2020 tsconfig.
  - After every package, `api/study/` holds 6 functions, and all tests sit outside `api/`.

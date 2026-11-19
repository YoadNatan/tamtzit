# Feasibility and integration review of the three addenda (meeting, fun, server)

*Adversarial review, lens: can these designs be built into the running plan this week, by agents in parallel after F1, without collisions. Read-only on the repo, the spec, the proposal and the three addenda. SQL ran only on throwaway local Postgres 16.15 databases (`feas*_<pid>`, all dropped). No production, no real Supabase project, no group, no Claude call. Work files: `critique/feas/` (run.sh, run2.sh, run3.sh, run4.sh and `out/`).*

## Verdict

The three designs are each internally sound, and together they load: on the SQL that is really being built (F0's `study-schema.sql` from branch `study/f0`, and sections Q, C and K as committed on `study/q-server`, `study/c-server` and `study/k-server`), all three addenda load twice with 0 errors, and their check suites pass (the fun addendum's 138, the server addendum's 166, `identity.sql` with I17 ok at 80 user columns). The function budget, the realtime budget and the registry hold.

They do not fit the plan as it now stands, and the week cannot hold all of it:

1. **The premise is gone.** All three say "F1 is next and absorbs our delta now" and "our extension blocks go into Q's, Z's, C's and K's first PRs". F1 is 10 commits in and was built on the spec's contract alone. Q, C and K have already committed their sections and server code against the original spec. K is writing the `mnemonic` op right now, which the fun addendum moves to J. Every delta is now rework on in-flight branches.
2. **The amount of work.** The addenda add 7,918 lines of SQL (155% of the spec's 5,096) and 3,042 lines of checks. They add 16 milestones, which makes about 30 pull requests. No TypeScript is written yet. After F1 the critical path is 7 merges in a row, and each needs Yoad to run the SQL on production first (§7 "Done when"). Release 7 waits for an email provider that has not been chosen, and the museum and the boss need nights and weeks of data. "Everything end to end this week" is not achievable as designed. Phase 1 is achievable if it is cut and ordered as in §5.
3. **Concrete integration defects** found by loading the SQL stage by stage, each with a small fix:
   - Section C now needs section Q.
   - Section N needs section M.
   - Hidden questions still reach the quiz, the opening, guesses, catch-up and Today.
   - One file has two owners.
   - Several rules contradict each other between the designs.

---

## 1. What was run (reproducible: `critique/feas/run.sh`, `run2.sh`, `run3.sh`, `run4.sh`)

| Run | Result |
|---|---|
| Everything on the **real F0**: `study/f0`'s `study-schema.sql` (section F as merged-to-be, not the spec's copy), A with all three addenda's merge lines, W, Q + 45 + 46, Z + 55 (fun's hooked build), C + 65 + 66, K + 75 + 76, P + 86, M N V T, U J H, B G E; loaded twice | **0 load errors**; registry A=1 B=1 C=2 E=1 F=1 G=1 H=1 J=1 K=2 M=1 N=1 P=2 Q=2 T=1 U=1 V=1 W=1 Z=2 |
| Every shared-database check on it: F0's real `tests/study.sql` (base + F), the spec's W..P checks as the addenda edit them, the meeting's 95-98 | 1,244 lines, **1 FAIL**: F27 "anon may also call study_bank_finish, …_input, …_report, …_save, …_take" (finding F-16) |
| `identity.sql`, own DB | 0 FAIL; I16 = 80 user columns; I17 ok |
| Fun checks, own DB / server checks, own DB | 138 ok / 0 FAIL |
| **Each package's PR alone on the real F0, in build order** (load twice) | 21 stages: 17 load with 0 errors; 4 fail: **C with its two ends (36 errors)**, **N without M (6, with or without K)**, **J-1 on C alone (36, through C)**. Narrowed in `run2.sh`: C + 65 alone 0, C + 66 alone 36 ("relation public.study_questions does not exist"); N on Q, Z, C, M 0; B without W 4 ("study_private.server_on() does not exist"); H on a Z without the fun hooks refused by its guard |
| **In-flight branches + their section's ends** (`run3.sh`) | `k-server`'s committed K checks stop at K4 with `ERROR: needs approval` once K's end is loaded; `c-server`'s check prints "C-reg. the registry: 2 (expect 1)"; `q-server` 0 FAIL |
| Static scan of the combined schema (`run4.sh`) | 13 functions read bank questions without `hidden_at`: 11 pick or serve them, and 2 only count (`study_my_pulse`, `study_private.pulse_answers`). Only the server's own three read it (finding F-6) |
| F1's build logs (`scratchpad/f1/build-all.log`, `dist-all`) | entry chunk 261,340 bytes with every flag on; Vite: five slot modules "dynamically imported … but also statically imported … dynamic import will not move module into another chunk" |

---

## 2. Findings (most severe first)

### F-1 · blocker · F1 has none of the three F deltas, and is about to ship the contradicted copy

- **Where:** meeting §2.7, fun §5.1-§5.3 + §6.4, server §2.5. Branch `study/f1`. F0's `server/study/budget.ts` and `api/study/ai.ts`.
- **Problem:** Every new package (M, N, V, T, U, J, H, B, G, E) needs routes, flags, slot modules, `LectureCtx` fields, markers, `failText` areas, `POLICY` rows and op seeds in F's files. The ownership rule forbids those packages from editing F's files. The addenda assume F1 is "next". In fact F1 is nearly done on the spec's contract alone. Each addendum also specifies its own delta, and nobody has reconciled the three.
- **Evidence:**
  - `study/f1` has 10 commits since F0, the latest at 13:38. The meeting addendum was written at 12:26, the fun one at 12:35 and the server one at 13:23. The tip still has none of the routes or modules below.
  - `src/study/lib/route.ts` L10-24 has the spec's 14 views only: no today, meeting, catchup, log, dispute, pulse, museum, wall, boss, eve or trap.
  - `src/study/features/` has the spec's 7 modules only.
  - `types.ts`: `SheetTab = "comments" | "edit" | "mnemonic"`, and `LectureCtx` has no `following`, `reading` or `place`.
  - `flags.ts` has `mnemonics` and none of the 15 new flags.
  - `Help.tsx` L91 and L145 ship "״תחרותי״: נקודות על תשובה נכונה ומהירה" (decision 2's opposite), and `route.ts` L288 ships "מבחן חי". F1 is release 1b, "help and privacy", so it is user-visible.
  - F0's `POLICY` (`budget.ts` L139-150) has no `var`, `wall_check`, `plaque`, `bank`, `solver`, `fix_check`, `trap_check` or `whoami`. `reserve()` throws 500 "no budget policy for <kind>" for each of them.
  - The server calls `estimateUsd(…, { batch: true })`, but F0's signature is `estimateUsd(model, inputChars, maxTokens, extraInputTokens = 0)`. `costUsd` does not read `service_tier`.
  - F0's `ai.ts` imports `mnemonicOp` from `ops/collab.js` (K). The fun addendum routes it from `ops/wall.ts` (J).
  - The three deltas do not agree on the `LectureExt` order. The meeting's is "W, K, A, M, N, V", and J's `useLectureJ` has no place in it. The follower's screen gets M's `followBar` and J's floating "לנעוץ רגע" with no single owner of the layout.
- **Fix:**
  - Hold F1's production merge, or follow it the same day, with **one "F1Δ" PR (owner F)**. It carries the three deltas merged and reconciled:
    - routes, `tabOf`/`allowed`, and the tabs under `today`;
    - 15 flags and one `requiredSchema`;
    - the types, and 10 seeded slot modules (screens lazy, see F-8);
    - seeds for `ops/var.ts`, `ops/wall.ts`, `ops/pulse.ts`, `ops/extras.ts` and `server/study/bank.ts`, and the `mnemonic` route moved to J;
    - the `POLICY` rows plus batch pricing with F0's signatures;
    - the `failText` areas (the `Area` type is closed today: `failText.ts` L12);
    - markers M N V T U J H B G E;
    - the Help and privacy rows that replace the contradicted ones;
    - one `LectureExt` order: W, K, A, M, N, V, J.
  - Nothing of the addenda can start until F1Δ merges, so it is the first item of the week.

### F-2 · blocker · "All stages end to end this week" is not feasible as designed

- **Where:** meeting §9, fun §6, server §7.2 and §10; spec §7 "Done when".
- **Problem:**
  - The plan grows from 13 remaining PRs to about 30: F1Δ plus M-1, M-2, N, V, T-1, T-2, U-1, U-2, U-3, J-1, J-2, H-1, B-1, B-2, G and E.
  - Each PR with SQL must have its SQL run on production by Yoad, from its branch, before it merges. That is about 20 production runs in five days.
  - The critical path after F1 is 7 merges in a row: F1Δ → Q-1 → Z (with C) → A2 (needs Q, Z, C and K) → U-1 (fun ties it to A2) → U-2 → H-1. T-1 → T-2 makes a second chain of the same length.
  - Some of it cannot be finished this week whatever the speed:
    - Release 7 needs an SMTP provider and a domain Yoad controls, not yet chosen (server §12 Q3: "Until then release 7, and with it everything of release 8, waits"). So Today, in-app review, progress, the pulse and the pre-guess cannot be released.
    - The museum needs "a few weeks of bets" (fun §2.6).
    - The boss needs hot topics from nightly counts of at least 3 members.
    - No prompt (VAR, the solver, the wall's drafts and check, the plaque, `trap_check`, `whoami`) can be run against the model here.
  - The approved phases themselves were 16-22 Nov for phase 1, then 23 Nov-6 Dec and 7-13 Dec.
- **Evidence:**
  - Line counts: spec SQL 5,096 lines; meeting 3,416; fun 2,105; server 2,397; addenda checks 3,042.
  - Fun's own order: "Q-1, A2 → U-1 → U-2 → U-3" and "Z (+ hooks), U-2 → H-1".
  - The SQL of U-1 does not need A2: my stage "U-1 on Q-1, C" had 0 errors.
- **Fix:** Say it to Yoad plainly and plan to it (§5 below):
  - **Phase 1 to production this week** (release 4 and 5 with their addenda).
  - **Phase 2 and 3 merged dark behind flags**, verified only on mocks.
  - Release 7 and 8 open when the email service exists.
  - The museum and the boss open after data accumulates.
  - **SQL first, in waves:** the file is re-runnable and flags only show or hide, so Yoad runs it about 5 times, not about 20 (§5).
  - Drop U-1's dependency on A2.

### F-3 · major · Q, C and K are already built on the original spec; the addenda's "first PR" blocks are rework, and K is building what J takes

- **Where:**
  - meeting §9: "The extension blocks are part of their packages' first pull requests (none of Q, Z, C, K has shipped)";
  - server §2.1: "both blocks are the package's first pull request";
  - fun §6.4 K → J: "before K builds its aids".
- **Evidence:**
  - **Q:** `study/q-server` has `aef4767` (section Q, identical to the spec's), `08817f3` (op questions) and `bacefef` (practice sessions), last at 12:58. Its `Question` Zod has no `para`, `teaser`, `when`, `tag` or `figure`. `pickQueue` has none of the new tiers or keys.
  - **C:** `study/c-server`'s `CardItem` has no `para`, and its check prints "C-reg. the registry: 2 (expect 1)" with C's end loaded.
  - **K:** `study/k-server` committed section K at 13:06. Its own checks stop at K4 with `ERROR: needs approval` once the meeting's K end is loaded, because the 17 direct `study_edit_block` calls must go through propose and approve (`out/inflight-k-server-checks.txt`).
  - **K's mnemonic work:** K's uncommitted `server/study/prompts/collab.ts` (13:13) already holds `MNEMONIC_SYSTEM` and `mnemonicRequest`.
- **Fix:**
  - Today, send each in-flight agent one merged amendment:
    - **Q:** 45 + 46, the Zod and check fields, `questionsCall`, the solver, and the merged `pickQueue` (F-12).
    - **C:** 65 + 66 (with F-4's guard), `cardsCall`, C7, and the merged `cardsQueue` (F-11).
    - **K:** 75 + 76; port its checks to `mtest.edit_block`; stop the `mnemonic` op, prompt and test (they go to J); and split K into K-1 (SQL plus the `ParagraphSheet` frame with tabs, needed for N in release 4) and K-2 (proposals, approval, VAR hooks). The spec has no K milestones: "K-2" in the addenda is the spec's `edits.test.ts` acceptance row.
  - Budget the rework time explicitly.

### F-4 · major · The server's C end makes section C depend on section Q (C-1 fails; C can no longer merge beside Q)

- **Where:** `server/sql/66-cards-end.sql` L57 (`question_id uuid references public.study_questions (id)`), its mistake trigger on `study_answers`, and C's acceptance test C-1 (spec §7.C, "SQL stage F+C: 0 errors").
- **Evidence:**
  - `run2.sh`: C + 65 alone 0 errors; C + 66 alone 36 errors, the first `relation "public.study_questions" does not exist`; C + both ends on Q-1: 0.
  - J-1 on C alone fails the same way.
  - The server's stages always loaded C after Q, so the problem never showed. The spec, the meeting graph and the server's own graph (§10) run C in parallel with Q-1, and `study/c-server` was built on F0 alone.
- **Fix:**
  - Either create `study_my_cards`, `study_my_card_reviews` and the mistake trigger behind `to_regclass('public.study_questions')`, with the foreign key added from whichever of Q's and C's ends loads second (both re-runnable);
  - or move C5's private cards to a section after both Q and C, for example E.
  - Otherwise state "C after Q-1" in §7 and §10 and change C-1's stage to F+Q+C, at the cost of one more serial step.

### F-5 · major · Release 4 (phase 1, due this week) now needs nine PRs instead of two

- **Where:** server §2.5 item 2 (`REQUIRED_SCHEMA: … B 1 (questions or cards)`), server §7.2 release 4, meeting §2.5 (`ANCHOR` in release 4), meeting §9.N.
- **Problem:** Under the spec, release 4 required Q:1 and Z:1. Under the addenda:
  - `questions` requires B:1. B's SQL needs W's (`study_private.server_on`) and C's with both ends, and those need Q's.
  - `ANCHOR` (N) needs M's SQL (F-10), C's end, and K's `ParagraphSheet` code with tabs, because N's "תרגול" tab renders inside K's sheet (meeting §2.7 table: K → N). K's client is phase 2 in the server's release table.
  - M-1 needs Z.
  - So release 4 waits for F1Δ, W1, Q-1, C, Z, K's sheet, M-1, N and B-1.
- **Fix:**
  - Do not put B in `requiredSchema` for `questions`. B's lines already degrade: the switch is off until Yoad sets it, and `BankLine` can hide when `study_bank_state` is missing.
  - Let `ANCHOR` follow release 4 when N or K's sheet is late.
  - Write the phase-1 cut into §7.2 with these dependencies.

### F-6 · major · "Two flags hide a question from everyone" stops only practice

- **Where:**
  - the server's 46-questions-end (`hidden_at`, and `study_answer_question` raising `hidden` in every mode but `quiz`, L306);
  - the meeting's Z end, M, N and T;
  - the fun addendum's H and U.
- **Evidence:**
  - `run4.sh` on the combined schema finds these 11 functions that pick or serve questions without `hidden_at`:
    - `study_quiz__pick`, `study_quiz__pick_preset`, `study_quiz__pick_boss`, `study_quiz__after_reveal`;
    - `study_meeting_guess_pick`, `study_meeting_catchup`;
    - `study_my_danger`, `study_my_quiz_returns`, `study_paragraph_practice`;
    - `study_pulse_brief`, `study_private.boss_heads`.
  - Only the server's own three read it: `study_my_danger_list`, `study_my_rewordings`, `key_questions`.
  - Server §10.R lists the change to Z's pick and N's tab as work for Z and N, but no SQL makes it.
  - Consequence: a question two members flagged as "שגויה" still opens the group quiz, "3 לקפה", the guesses and the boss. In catch-up (meeting §4.3.9, mode `lecture`) and in Today's session (meeting §7.2, mode `mistakes`), answering it raises `hidden`.
- **Fix:** Add `and q.hidden_at is null` to every picker listed. Q's end loads before all of them, so a plain column works. Add one check per picker to the server's QS tests, and add `hidden` to T's and M's failure handling.

### F-7 · major · `src/study/lib/plan.ts` has two owners, and A2's private plan is removed without saying what goes

- **Where:** spec §5.4 L9829 and §10.2 L12115 (owner A), server §5 L544 ("Files (G owns): … `src/study/lib/plan.ts`"), and server choice 13 and §2.5.
- **Problem:** §7 rule 1 says `assemble.py` "fails if any path has two owners", and rule 2's path check rejects one of the two PRs. Choice 13 drops A2's private plan, N1-N4, but does not list what that removes:
  - A's `shared/study/plan.ts` and its test;
  - `components/Plan.tsx`;
  - `lib/plan.ts`;
  - `tools/evals/plans.mjs`;
  - acceptance tests A-5 (the P checks) and A-7 (the plans rubric);
  - F1's `PlanScreen` in `features/progress.tsx` (`StudyApp.tsx` L44).

  Meanwhile:
  - the private lane still reads "A2's `study_plans` when she has one" (§5 L540), a table nobody can fill;
  - `?v=plan` under release 8 falls back to "A2's private plan until G ships", which is not built.
- **Fix:** Rename G's module (for example `lib/groupPlan.ts`). List A2's removals and the F1 changes in F1Δ and in A2's work package. Before G ships, route `?v=plan` to marathons.

### F-8 · major · The bundle budget will break: F1's lazy screens are not split, and ten more modules come on the static path

- **Where:** spec §5.3 and §7 (entry chunk under 400 kB; F-11), and the addenda's slot tables.
- **Evidence:**
  - F1's build: entry `study-*.js` 261,340 bytes with every flag on. That leaves 139 kB for every package's static part.
  - The Vite warnings in `scratchpad/f1/build-all.log` show that the shell's `React.lazy(import("./features/x"))` does not split, because Group, Library, LectureView and Shell import the same modules statically. Every screen a package exports from its slot module lands in the entry chunk.
  - The addenda add 10 modules on the static path:
    - Group renders 7 new cards;
    - LectureView calls 4 new hooks;
    - K's `ParagraphSheet` pulls in N's `PracticeTab`, then U's and J's paragraph hooks and E's `AddTrap`;
    - C's review pulls in U's `CardBadge` and J's `CardHint`.
  - None of the addenda says its screens must be imported lazily inside its own module.
- **Fix:**
  - F1Δ seeds each module with `export const XScreen = lazy(() => import("../components/XScreen"))`.
  - A CI check fails when a `components/*Screen.tsx` file lands in the entry chunk.
  - Each package gets a static budget, for example 8 kB.

### F-9 · major · Today's queue is specified three ways

- **Where:** meeting §7.1-§7.2 (owner T), fun §6.4 (rows for T), server §9.3 and §10.R.
- **Problem:**
  - The fun and server addenda add sources T does not have:
    - the loot, "מהקרב" (`study_my_loot`);
    - the "רק אצלך חם" topics;
    - G's "מהמסלול שלך";
    - the danger row through A2's list.

    T's `QueueItem.kind` is `"update" | "quiz" | "danger" | "unclear" | "card" | "vaccine"`, and its priority and estimate table has none of them.
  - **Vaccines:** T lists museum vaccines as their own row (45 s, meeting L525), while the fun addendum says "trap cards arrive through C's queue" (fun L670). They would show twice.
  - **Two danger rules for one approved row:**
    - T's `study_my_danger` takes the latest confident error and serves a sibling question seen least.
    - The server's `study_my_danger_list` keeps an item until it is answered right "על בטוח" twice, due at +1 and +3 days.

    The server's own open question 13 says they differ.
  - **File order:** T's section loads before U, J, H, B, G and E, so any SQL source from them needs a `to_regclass` guard.
- **Fix:** Write one merged T source table (kind, owner, priority, estimate, flag). Vaccines come only through C's queue. T's danger row is the first due row of `study_my_danger_list`. Guard or move T's section.

### F-10 · minor · N's SQL needs M, but N's work package says it does not

- **Where:** meeting §9.N ("Depends on: Q-1, C (their ends), K's ParagraphSheet"), the §9 graph, and `91-anchor.sql` (header "After section M"; L54 reads `public.study_meeting_taps` in a `language sql` function).
- **Evidence:** stage "N on Q-1, C (no M)": 6 errors (`relation "public.study_meeting_taps" does not exist`); on Q-1, Z, C, M: 0. `REQUIRED_SCHEMA` gives `anchor` N:1 but not M:1.
- **Fix:** Make N depend on M-1, add M:1 to `anchor`'s schema needs, or read the taps through `to_regclass` in plpgsql.

### F-11 · minor · C's `cardsQueue.ts` gets two contradicting rules

- **Problem:**
  - The server says "the 20-a-day limit counts all of them", including trap and private cards (§3.2 L280, CS-3).
  - The fun addendum says trap cards are "outside adoption and the 20-a-day count" (L133, L665).
  - The same card also gets two chips: the meeting's "מלכודת" on `CardFace`, and the fun addendum's `CardBadge` "מלכודת של הקבוצה" or "חיסון · …".
- **Fix:** One rule in C's work package (recommend: trap cards first among new, inside the limit), and one chip, the fun addendum's `CardBadge`.

### F-12 · minor · Q's `pickQueue` gets two tiers for the same place, and the built order has no such place

- **Where:** fun §6.4 (a group tier "after one's own due mistakes"), server §3.1 (a confusion tier "after the due mistakes"; the exam-mark tier "first among new"; hidden questions out), meeting §3.1 (the `p.<…>` key; stale questions out).
- **Evidence:** `study/q-server`'s `pickQueue` orders never answered → wrong now → right, with flagged questions last in each tier. There is no leading "due mistakes" tier for either addendum to follow.
- **Fix:** One merged tier list for Q.

### F-13 · minor · The associations in catch-up and on the chip row read a source the fun addendum retires

- **Evidence:**
  - The meeting's `study_meeting_catchup` (`90-meeting.sql` L876) and N's chips (`91-anchor.sql` L34) count `study_comments` of kind `mnemonic`.
  - The fun addendum says "nothing posts K's comment kind mnemonic".
  - So the approved catch-up row "אסוציאציה שננעצה" (today.html s2) would always be hidden.
  - The fun addendum's interface table gives catch-up no source, for example J's `study_aids` of kind `moment` posted during the meeting's hours.
- **Fix:** Catch-up and the chips read `study_aids`, guarded by `to_regclass`: moments for catch-up, the winner for the chip.

### F-14 · minor · Decision 1's answer does not reach the meeting's live counts

- **Evidence:**
  - Decision 1: "אותה תשובה קובעת גם את ספירת הניחושים במסך ההקראה".
  - The fun addendum makes the switch `pulse` "decision 1's answer in one place" and lets members opt out (`study_pulse_optout`).
  - `study_meeting_reader_view` (`90-meeting.sql` L389-423) and the guess majority read neither the switch nor the opt-out (grep: no reference in the meeting's SQL).
- **Fix:** Behind `to_regclass`, the reader view and the majority word leave out opted-out members, and hide `guess_warn` while `pulse` is off.

### F-15 · minor · Decision 7's cap is per meeting, not per day

- **Evidence:**
  - Decision 7: "לכל היותר שניים ביום".
  - The meeting's index allows "one non-cancelled coffee and one end per meeting", and choice 3 makes "a group that reads two lectures [get] two rows", so a day can have four rituals.
- **Fix:** Key the partial unique index or the check in `study_meeting_quiz` by (group, day).

### F-16 · minor · The checks the addenda edit are the spec's copies, not F0's real files

- **Evidence:**
  - On the real F0, F27 FAILs, because `study/f0`'s `supabase/tests/study.sql` does not have the server's edit that allow-lists B's five functions.
  - P0 prints 4 cron jobs "(expect 3 …)", and ME63 prints 80 "(expect 71 …)". The server's edits did not count the fun addendum's job and columns.
- **Fix:** Put the F27, F21, P0, ME63 and I16 edits of all three addenda into F1Δ (F's real file) and into W's and A's sections, with the combined numbers.

### F-17 · minor · Z's first PR must also carry the fun addendum's four hooks, and Z's acceptance tests do not ask for them

- **Evidence:**
  - Z = the spec's Z (52 kB) plus the meeting's end (54 kB) plus the fun hooks.
  - Without the hooks, H's guard refuses to load ("section H needs section Z with the boss hook points", `run2.sh`). H is then never recorded, and the `BOSS` schema gate never passes.
  - The meeting's ZA-1 to ZA-5 do not include the hooks. The server's `hidden_at` change to the pick (F-6) also falls to Z.
- **Fix:** One merged Z work package, with ZA tests for the hook calls and `hidden_at`. Z is on the critical path, so give it its own agent as soon as Q-1 merges.

### F-18 · minor · "A question that split the group goes to the opening" is not wired

- **Evidence:**
  - Approved, practice p2g: "שאלה שחצתה את הקבוצה עולה לפתיחה ולמבחן הקבוצתי".
  - The fun addendum's §3.4 says the meeting's "3 לקפה" reads `study_pulse_questions`.
  - The meeting's opening picker (`study_quiz__pick_preset`, choice 11) uses the group's own quiz results only. The coffee path skips the pool where the fun addendum's signal hook sits (`55-quiz-end.sql` L134-146 in the fun addendum's build).
- **Fix:** M's picker reads U's signal, guarded by `to_regclass`, after its own rules.

### F-19 · minor · The month's cost rollup is inconsistent and can exceed $33 without recordings

- **Evidence:**
  - The server's month table (§8.3) totals "≈ $33 without recordings". It leaves out the meeting's paragraph numbers and teasers (≈ $0.70-1.40 a month, meeting §2.6), and counts "$3-5" for every optional tap.
  - The fun addendum's own estimate for the wall's paid drafts alone is "$5-10 at most" (fun §4.6).
  - At those figures the month is ≈ $38-43. The 80% line ($26.40) would then stop the bank, practice and cards late in the month (decision 4).
- **Fix:** One combined month table. Consider a monthly sub-cap or a lower daily limit for paid drafts.

---

## 3. What holds (checked, no finding)

- **Function budget.**
  - `api/study/` holds 4 files today (`ai.ts health.ts outline.ts section.ts`), and 7 after the spec (8 with W5).
  - The addenda add no file. Their new calls are 6 ops of `ai.ts` (`var`, `wall_check`, `plaque`, `fix_check`, `trap_check`, `whoami`), the `mnemonic` op re-routed to J, and one branch of `work.ts` (B).
  - The `study-bank` cron (every 2 minutes) kicks only when a step is due.
- **Realtime.**
  - New published tables: `study_meetings`, `study_edit_proposals`, `study_disputes`, `study_slide_flags`, `study_aids` and `study_group_plans`. Each has its own uuid key and a member read policy.
  - A phone on the busiest screen listens to about 14 channels; Supabase allows 100 per connection.
  - No presence is added. The reader's place is an RPC at most every 5 s, and the published `study_meetings` row changes only when a guess is released or a part is read (`study_meeting_place`, `90-meeting.sql` L326-331).
  - Message rates for six people are far under Free's 100 per second.
- **SQL order and registry.** In the declared order (F A W Q Z C K P M N V T U J H B G E) everything loads twice on the real F0. Every stage except F-4's and F-10's loads alone, including Q-1, K-2, Z, M-1, V, U-1, B-1 (after W), A2, T, H-1, G, E and everything plus W2. The registry values are consistent. I17 (every user column merged) is ok with all 80 columns.
- **Mockups and decisions.** Decisions 2, 3, 5, 6, 8, 10, 11 and 12 are implemented the same way wherever two addenda touch them. Spot checks of today.html, progress-pulse.html and the meeting's screens find the approved strings used as they stand.

---

## 4. Contradictions to settle before the agents start

| Topic | Meeting | Fun | Server | One answer |
|---|---|---|---|---|
| The "על בטוח" row and the danger list | T `study_my_danger` | — | A2 `study_my_danger_list` | A2's list, read by T (F-9) |
| Museum vaccines in Today | T row of kind `vaccine` | through C's queue | through C's queue | C's queue only (F-9) |
| 20 new cards a day | — | trap cards outside the limit | everything inside the limit | one rule (F-11) |
| The tier after the due mistakes | the `p.` key, stale out | group tier | confusion tier | one list (F-12) |
| Association source | K's `mnemonic` comments | J's `study_aids` | — | J (F-13) |
| Decision 1's switch and opt-out | live counts ignore them | `pulse` switch, opt-out | — | both reach the reader view (F-14) |
| `?v=plan` | — | — | G's plan; A2's private plan not built | marathons until G (F-7) |
| `LectureExt` order | W, K, A, M, N, V | J "among the hooks" | — | W, K, A, M, N, V, J (F-1) |

---

## 5. A plan that fits the week

1. **Today:**
   - F1 merges together with **F1Δ** (F-1, F-8, F-16).
   - Amendments go to the Q, C and K agents (F-3); K stops `mnemonic`.
   - Yoad decides the cut: phase 1 to production; phase 2 and 3 dark; 7 and 8 wait for email.
2. **Wave 1, in parallel:**
   - Q-1 (with 45, 46 and the solver);
   - C (with F-4's guard, so it runs beside Q);
   - K-1 (SQL with both ends, and the sheet's tab frame);
   - W1;
   - A1 (all merge lines).
3. **Wave 2:**
   - Z (meeting end, fun hooks, `hidden_at`);
   - B-1;
   - V (after K's SQL);
   - the SQL of U-1 (without A2);
   - J-1.
4. **Wave 3:**
   - M-1, then N;
   - A2 with P's end.

   Release 4 and 5 flags go on here.
5. **Wave 4 (dark):** T-1, M-2, U-2, G, E, B-2, J-2, K-2.
6. **Wave 5 (dark):** U-3, H-1, T-2.

**SQL in waves.** Each wave's sections merge as one re-runnable file, and Yoad runs it once before the wave's code merges. That is 5 production runs instead of about 20, and it follows §7's rule that the SQL comes before the deploy. Flags stay off until each wave's e2e has passed under its release's set.

---

## 6. Evidence files (`spec/addendum/critique/feas/`)

- `run.sh`: everything on the real F0, every shared check, `identity.sql`, the fun and server checks, and 21 per-PR stages. Outputs are `out/run.txt`, `out/all-*.txt` and `out/stage-*.txt`.
- `run2.sh`: the narrowed stages (C + 65 or 66 alone, N with M, B without W, H on an unhooked Z). Output is `out/run2.txt`.
- `run3.sh`: the in-flight branches with their section's ends. Outputs are `out/run3.txt` and `out/inflight-*.txt`.
- `run4.sh`: the `hidden_at` scan of the combined schema. Output is `out/hidden-at-scan.txt`.
- `branches/`: `git show` copies of `study/f0`'s schema, stubs and checks, and of the in-flight sections.
- `spec-owners.tsv`: spec §10.2 as path → owner, used for F-7.

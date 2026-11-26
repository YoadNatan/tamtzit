# Yoad's decisions of 26 November 2026

Yoad answered the wave's open questions on 26 November 2026 (two rounds).
Where an answer differs from a design's recommended default, the answer
wins. Every other open decision (OD) takes the design's recommended default.
Each package of the wave records its own decisions here as it is built.

## The answers

- **Budget:** keep **$33 a month**, with sub-caps: practice sets $12, uploaded
  sheets $6, similar questions $5, the model comparison $3.30. Summaries stay
  protected.
- **Build order:** notifications, then practice sets, then uploaded sheets,
  then models. The models design's slice 0 (the price registry and the price
  fixes) may go first, because it changes no screen and spends nothing.
- **Notifications on by default:** group activity ("בשבילך": replies,
  questions to you; shared practice sets later), live now ("עכשיו בקבוצה": a
  live quiz, a meeting starting), your upload is ready (summaries, past
  exams). A daily reminder exists, **off** by default (19:30).
- **Practice sets:** always shared with the group (hide for yourself; the
  author or the group's opener deletes; scores private; the group average
  only with 3 or more others).
- **Models:** every Claude model, plus OpenAI, Google Gemini and Chinese
  models (DeepSeek, Qwen, Kimi, GLM). Yoad adds the provider keys in Vercel.
  Yoad runs comparisons; members may rate the results blind.
- **Other providers may see everything** (lectures with pictures, past exams,
  sheets). Chinese models go through OpenRouter, with zero data retention
  where it is offered. Members get one informational line in the help
  screen's privacy text (not a gate).

## Notifications (design-notify, section R, revision 2)

| OD | Decision |
|---|---|
| OD1 | Yes: a push-only `public/sw.js` (no fetch handler, no cache) with its kill path. `install.md`'s "no service worker" line is updated with it |
| OD2 | The study entry chunk's limit in `tools/study-bundle.mjs` rises to 410,000 B for this wave; R's static share stays at most 1,200 B; everything new loads lazily |
| OD3 | WebCrypto for the push encryption; no new dependency |
| OD4 | SQL order: notifications ship first, so section R follows section I in `study-schema.sql` and goes into part 9 (part 10 starts with R only if part 9 would pass 170 KB). Later sections follow R: L (practice), Y (models), O (sheets) |
| OD5 | A production pilot with the notify switch off |
| OD6 | Three slices in code, all built now, each releasable on its own |
| Kinds not built yet | `set_shared`, `similar_ready` and `lab` are reserved in the notice-kind table, not wired |
| Every other OD | The design's recommended default |

## Models (design-models, revision 2)

Slice 0 (WP1) is built: see below. The rest waits for its turn in the build
order.

| OD | Decision |
|---|---|
| OD1 | Small slices: slice 0 prices, slice 1 the routing seam with nothing routed, slice 2 comparisons for the kinds with an answer key, slice 3 blind rating and the other kinds; then the other providers |
| OD2 | The owner is the group's creator, plus `study_private.lab_admins` |
| OD3 | Yoad is blind too, and his ratings count |
| OD4 | The comparison spends at most **$3.30 a month** (10% of $33, Yoad's sub-cap) until 2027-01-31, then 3%; $1.50 a run, 3 runs a day |
| OD5 | Comparison calls use the group's budget (worker path, no member's share) |
| OD6 | Members rate only short answers: one score 1-5, an error tick, a best pick |
| OD7 | Members do not see the console |
| OD8 | Yoad sends a run to the group's WhatsApp from the app |
| OD9 | "לשאול" comparisons leave out threads and corrections |
| OD10 | Kinds that cannot be compared may move to another Claude model only |
| OD11 | Answer-key kinds move first (Haiku 5.5 for the question check and fix_check; Sonnet 5.5 for points and exam reading), each after its comparison |
| OD12 | The AI score is off by default, from slice 3 only |
| OD13 | Frozen inputs are kept 60 days |
| OD14 | Claude Fable 5.2 in comparisons; a production route to it needs a second confirmation |
| OD15 | Covered by notifications' OD2 (the limit of 410,000 B); Y's own static code stays at most 700 B |
| OD16 | Check `/api/study/health` for `budgetUsd: 33`; **the code's default is now 33** (slice 0) |
| OD17 | Section Y after R and before O |
| OD18 | $5 prepaid credit per provider, auto-recharge off (Gemini: a low daily request quota); keys on Production only |
| OD19, OD20 | **Changed by Yoad's answer:** approved providers may get every kind, pictures and past exams included (scope `all`), instead of text-only kinds until checked |
| OD21 | One informational line in the help screen's privacy text; no gate |
| OD22 | Chinese models through OpenRouter only, zero data retention where offered, hosts outside China |
| OD23 | Yoad checks provider invoices against the ledger monthly; a gap above $2 turns routing off until explained |
| OD24 | Yes, per kind, by Yoad |

### Slice 0, built on 26 November 2026

- `shared/study/prices.ts`: every Claude price row in one place, small
  enough for the phone (the price cards read the default model's row).
  `shared/study/models.ts`: the registry of routable models (Fable 5.2,
  Opus 5.5, Sonnet 5.5, Haiku 5.5) with what each can do.
  `shared/study/estimate.ts`: `estimateUsd`, `imageTokens` and the
  characters a token per model, moved from `server/study/budget.ts`, which
  re-exports them.
- The price fixes, each checked against Anthropic's model and pricing notes:
  - Haiku 5.5 was always priced at its card for prompts over 100k tokens (5 ×
    too much). It now has both cards: $0.10 / $0.50 up to 100k prompt tokens
    (input, cache writes and cache hits together), $0.50 / $2.50 above.
  - Sonnet 5 ($2 / $10, hits $0.20) and Haiku 4.5 ($1 / $5) fell to the
    dearest rates; they now have their own rows. Fable 5 and Mythos 5 are
    listed too (at the same numbers as before).
  - Haiku 5.5's estimate counts 1.9 characters a token (its tokenizer
    counts about 30% more tokens).
  - An id that is not a listed model or its dated form (for example
    `claude-opus-5-5-fast`) is priced at the dearest rates, never at a
    cheaper family's.
- Opus 5.5, the model every call uses, is priced and estimated exactly as
  before (a test compares 2,000 call shapes bit for bit).
- `STUDY_MONTHLY_USD` defaults to **33** when it is not set (was 40).
- Nothing routes yet: no request, screen or SQL changed.

### Notifications, section R 1 and the shared modules, built on 26 November 2026

Slice 1's database and the modules the server and the app share. No screen
reads them yet (the inbox client comes next), and nothing is pushed.

- **Where:** section R follows section I in `supabase/study-schema.sql`;
  part 9 now holds sections I and R (80 KB of 170). Re-running part 9 is
  safe. The switch `notify` is inserted **off** (only users in
  `study_private.notify_pilot` get pushes), `notify_hooks` on.
- **Kinds registered:** `quiz_open` (live, held 15 s), `reply` and
  `answer` (for you), `summary_ready` and `summary_failed` (for you, held
  90 s), `code_used` and `test` (security). **Reserved, not wired:**
  `set_shared` (for you, push), `similar_ready` (for you, push, held 90 s),
  `lab_new` (inbox only). Each package's later section updates its own rows.
- **Choices the design left open, taken here:**
  - A reply goes to the thread's opener and to everyone who replied
    before; the opener of a question gets "יש תשובה לשאלה שלך", the others
    "תשובה חדשה בשרשור שלך". One inbox row a thread, counting until seen.
  - The quiz's lock-screen line is its first lecture's title; the inbox
    row adds the quiz's title and the host's name.
  - A notice queues a push only when the person has a device.
  - The kick to `/api/study/work` also comes for a push due within 20
    seconds, and the claim says how long to wait (`wait_ms`): a quiz held
    15 s reaches phones in about 20 s instead of at the next minute. The
    worker (slice 2) waits that long; the design had 5 s.
  - The sign-in scan's first run notes where the log ends: sign-ins from
    before section R are never announced.
  - A test push counts toward no daily cap; 3 an hour a person, 30 in all.
  - Leaving a group deletes that group's notices even with `notify_hooks`
    off (deleting is always safe).
  - Section R's error codes (`bad endpoint`, `bad prefs`, `too many`,
    `bad results`) are internal in `failText.ts`: the notification screens
    word their own failures.
  - An English title alone (a course called "Invented Kinetics") is
    isolated whole on the lock screen, so the title stays first.
- **Checks:** `supabase/tests/study.sql` block R (fresh, loaded twice, and
  as an upgrade from the previous schema) and
  `supabase/tests/notify-concurrency.sh` (a hook gives up on a lock after
  200 ms; the reply is saved). Unit tests for `notifyCopy`, `notifyRoute`,
  `notifyQuiet`, `bidiText` and `b64url`; `VITE_STUDY_NOTIFY` asks for R 1.

### Notifications, the bell and the inbox (slice 1's client), built on 26 November 2026

With `VITE_STUDY_NOTIFY` the tab screens' top bar has a bell (at its end,
before the guide's "?"), and `?v=notify` is the inbox. Nothing asks for the
browser's permission and nothing is pushed yet (slice 2).

- **What loads when:** the study entry chunk holds only the slot,
  `src/study/features/notify.tsx` (972 B of R's 1,200; the entry chunk is
  400,522 B of the new 410,000). The bell, the core
  (`components/NotifyParts.tsx`), the inbox (`components/InboxScreen.tsx`),
  `lib/notices.ts` (every member RPC of section R and the bell's store),
  `lib/notifyText.ts` (the screens' words) and `styles/notify.css` load
  lazily. `npm run test:bundle` builds with `NOTIFY` on, fails when R's share
  passes 1,200 B or when any R module but the slot is in the entry chunk.
- **The bell:** the count of unseen notices (`study_notices_unseen`),
  read again 300 ms after Realtime reports a change to the member's own
  rows, on coming back to the page and on coming back online. 1-9, then 9+;
  its name for a screen reader says how many are new.
- **Seen:** opening the inbox sees everything; opening a screen whose
  object has unseen notices sees those (`lec:<id>`, `quiz:<id>`…), also when
  one comes while the screen is open; a push's link (`?nt=<id>`) sees its
  notice and leaves the address, keeping the rest of it.
- **Choices the design left open, taken here:**
  - Until pushes come, `?v=notify&x=set` (the settings) opens the inbox and
    its address becomes `?v=notify`; the inbox has no settings gear yet.
  - Without the flag, `?v=notify` is the home (Today, or the library before
    Today) with no notice, as `?v=install` is without its flag.
  - A notice that comes while the inbox is open joins the top of the list
    with its dot, and only it is marked seen (by its id); opening the inbox
    marks everything seen, as the design says.
  - A group quiz that ended reads "מבחן קבוצתי נפתח" (without "עכשיו") with
    "הסתיים · לתוצאות", linked to the quiz.
  - A row's time: "עכשיו", "לפני {m} ד׳", the clock today, "d.m" before;
    the list is split into "היום" and "קודם" by the row's last change (Israel
    time).
  - `?v=notify` has no tab (a back arrow, "→ להתראות" from the screens it
    opens); COPY.md lists the inbox's words.
- **Checks:** `e2e/study/notify.cjs` (the design's cases 5-7 and 14-16,
  with the a11y check and 320 px inside it), its mock
  `e2e/study/mocks/notify.cjs`, the mock's flag set `notify` ("i" with
  `VITE_STUDY_NOTIFY`) and its Realtime filter on `user_id`; unit tests for
  the route and the words.

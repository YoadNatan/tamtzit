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
| Every other OD | The design's recommended default (listed below) |

The design's other open decisions, each at its recommended default:

| OD | Taken |
|---|---|
| OD7 | The switch `notify` is inserted off; `notify_hooks` on |
| OD8 | Quiet hours 23:00-07:30 Israel time, on by default, one switch; only the security notice goes inside them (silently) |
| OD9 | The daily reminder at 19:30, adjustable 06:00-22:00 in half hours; no unseen count in it |
| OD10 | "לא לשלוח בשבת" is a setting, off by default: Friday 16:00 to Saturday 20:30 |
| OD11 | Lock screens show lecture and course titles; never a quiz's title, never a name |
| OD12 | The security notice is always on, at most 3 a day, made by the minute scan, never to the device that signed in |
| OD13 | 6 "בשבילך" and reminder pushes a day, 12 in all, security apart (3); a quiz push a group per 10 minutes, a host per 30; 60 a minute in all |
| OD14 | "להודיע לקבוצה" on the quiz setup, on by default; the quiz push waits 15 s |
| OD15 | "הפגישה מתחילה בעוד 15 דקות" on, one push a meeting a member ("the reading started" is skipped after it). If meetings turn out to be daily, it moves under the daily reminder's switch (a later change) |
| OD16 | Two category switches plus the reminder; the devices listed only with 2 or more |
| OD17 | No app-icon badge in v1 |
| OD18 | No digest card on Today |
| OD19 | A member's phone and computer both get every push |
| OD20 | Offline caching only as its own package after two quiet weeks of pushes (not built) |
| OD21 | No "your questions or cards are ready" notice |
| OD22 | Yoad makes the VAPID keys with `tools/vapid-keys.mjs`, keeps the private key in a password manager, Production only, Sensitive |
| OD23 | The VAPID subject is `https://<the app's address>` |
| OD24 | "תיקון מחכה לאישור" is inbox only |

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

### Notifications, pushes for the pilot (slice 2), built on 26 November 2026

The server sends pushes and a member can turn them on, on this device, from
"שלי" → "הגדרות התראות" (`?v=notify&x=set`). Nothing is sent until the owner
sets the VAPID keys on Production and adds the pilot (below); the switch
`notify` stays off.

- **Server:** `server/study/push.ts` encrypts with WebCrypto only (RFC 8291,
  checked byte for byte against its Appendix A; the VAPID JWT of RFC 8292)
  and posts only to the push services' hosts (the same list as section R's
  `push_host_ok`, compared by a test), never following a redirect.
  `server/study/notify.ts` is `POST /api/study/work {notify:true}` (the same
  server key): it claims, answers 202 and sends in `waitUntil`.
  `/api/study/health` adds `notify`, `vapid`, `notifyOn`, `notifyStuck`.
  `tools/vapid-keys.mjs` prints a key pair and writes nothing.
- **Service worker:** `public/sw.js`, push only (no fetch handler, no cache),
  served by `vercel.json` with `Cache-Control: no-cache`; its header holds
  the two-line kill version. `install.md` says so.
- **Client:** `lib/notify.ts` (the device's state, turning on from a tap,
  the re-sync on each open, the kill path), `components/NotifyScreen.tsx`,
  the row in "שלי", the inbox's gear, and the hooks in signing out
  (`study_push_unsubscribe` first) and "ניתוק המכשירים האחרים"
  (`study_push_keep_only`). R's share of the entry chunk is 947 B of 1,200
  (the slot now loads one lazy part that picks the inbox or the settings).
- **Choices the design left open, taken here:**
  - Health gives `vapid` (the public key) whenever the three keys are set
    and are a pair, without asking the database; `notify` also needs
    section R, the server key and a wired database. So a slow or failed
    database never reads as "the keys were removed": only removed (or
    broken) keys remove the devices' worker.
  - The worker waits what the claim says (`wait_ms`, at most 20 s) and
    claims at most 3 more times; a batch holds whole notices (about 8
    devices, a notice with more alone), so one `study_notify_done` settles
    each notice.
  - Without sending: a device whose stored keys cannot be used is reported
    as 400 (section R removes it after three), a payload too large as 413,
    an endpoint off the push services' list as -1.
  - A notice's tag and the push service's `Topic` are the same: 22
    characters of sha256(dedupe). Urgency: high for live and security,
    normal for "בשבילך", low for the reminder. A route too long for a push
    links to the home (still with `nt`).
  - The worker is registered when the settings show "להפעיל" (so the tap
    goes straight to the browser's question), on turning on, and by the
    re-sync. The re-sync runs once the page is idle, on each open and when
    another member signs in on the device; it subscribes whenever the
    browser's permission is granted and health gives a key.
  - The settings read the member's preferences through
    `study_notify_prefs_set({})` (which saves the defaults row), so no table
    read is added.
  - New words: "אפשר לשלוח עד 3 התראות ניסיון בשעה. אפשר לנסות שוב מאוחר
    יותר." (the test's limit), the device names ("אייפון", "מחשב · כרום"),
    and the iOS and Chrome paths from `installCopy.ts` `OS` (new keys,
    unchecked on a device, as the install flow's are).
  - A push tapped while the app is open, for a notice of another group:
    the screen opens, but the group is not switched (not built).
- **Checks:** unit tests for `push.ts`, `notify.ts`, `public/sw.js` (in
  `node:vm`), `lib/notify.ts` and the new words; `work.test.ts` and
  `health.test.ts` cases; `e2e/study/notify-push.cjs` (the design's cases
  1-4, 8-9, 12-13, with a fake PushManager; case 9 delivers a real push to
  `public/sw.js` over CDP, in Playwright's full Chromium, headless, since
  the headless shell has no notifications).
- **Not in this slice (slice 3):** the asks (the first-launch card, the
  upload ask, the inbox's off-bar), the quiz setup's checkbox, guide step
  S10, the help rows, SQL R 2, `RELEASE-R1.md`.

**Owner steps for the pilot (Production only; never Preview):**
1. On your computer: `node tools/vapid-keys.mjs https://<the app's address>`.
   It prints three lines and writes nothing. Keep the private key in your
   password manager; never paste it in a chat, an issue or git.
2. Vercel → Production: `STUDY_VAPID_PUBLIC`, `STUDY_VAPID_PRIVATE` (mark it
   Sensitive), `STUDY_VAPID_SUBJECT`; redeploy. `/api/study/health` should
   show `"notify": true`, a `vapid` value and `"notifyStuck": false`.
3. Supabase → SQL Editor, the pilot (your group's join code):
   `insert into study_private.notify_pilot (user_id) select created_by from public.study_groups where join_code = '<code>' on conflict do nothing;`
4. From the home-screen icon: שלי → הגדרות התראות → "להפעיל התראות במכשיר
   הזה" → "שליחת התראת ניסיון"; then the design's device checklist (§13.4).

### Notifications, R 2 and the asks (slice 3), and the docs, built on 26 November 2026

The rest of the design: SQL section R at version 2, the asks, the quiz
setup's checkbox, the guide's step, help, and the release notes. Yoad's steps
for all three release points are in [`RELEASE-R1.md`](RELEASE-R1.md); what a
member sees, the events and the device checklist in [`notify.md`](notify.md).

- **SQL R 2** (part 9 regenerated: sections I and R, 106 KB of 170): 15
  kinds registered (25 with R 1's and the three reserved), eight new hooks and
  four new steps in the minute job; section R reports version 2. The app still
  asks for R 1, so the client works with either.
- **The asks**: Today's card on the first launch from the icon, the upload
  ask, the inbox's line; the quiz setup's "להודיע לקבוצה"; the guide's step
  S10 "לקבל התראות" with its walk to שלי's row; help's row "התראות" and the
  how-to "להפעיל התראות". R's share of the study entry chunk is now 552 B of
  1,200 (the slot became one helper that makes each lazy part).
- **Choices the design left open, taken here:**
  - A group challenge (mode `boss`) is "אתגר קבוצתי נפתח עכשיו" from the quiz
    hook itself (no trigger on the battles' table); its lock-screen line is
    the lectures' one course, or the first lecture's title.
  - "הפגישה מתחילה בעוד 15 דקות" goes to every member not already in the
    meeting (its scheduler too), 12 to 15 minutes ahead, once a meeting.
    "ההקראה התחילה" goes once a meeting to members not in it (never the
    reader); a meeting cancelled, or a reading stopped, holds the waiting push
    and ends the live rows.
  - "מפגש הלמידה מתחיל בעוד 30 דקות" goes 27 to 30 minutes ahead to those who
    answered in or maybe; it links to the study day.
  - "שאלה פתוחה שאפשר לעזור בה" runs once a day between 17:00 and 21:00
    (Israel time) for the members who turned "הקבוצה צריכה אותך" on, at most
    one a day across groups: the minute job asks `study_needs_me` (section G)
    as each such member, inside its own transaction, and puts the caller's
    claims back after. It links to the question's paragraph.
  - The daily reminder reads the member's latest group: cards due before the
    end of today, today's meeting still to come, the nearest course exam
    within 14 days; with none of these it sends nothing. It goes within half
    an hour of the member's hour, once a day.
  - "קריאת המבחן לא הצליחה" carries the exam's error code (`no questions`)
    like a summary's stop; `args.kind` waits for uploaded sheets (section O).
  - "תיקון מחכה לאישור" and "עדכון" coalesce per lecture; "נקבעה פגישה" comes
    for a future meeting when it is set or its time moves (not to the member
    who did it); "סיכום חדש בספרייה" only the first time a summary is ready.
  - A credit asked by the member it names, a dispute opened by the
    correction's own proposer, and a decision by the one decided for, notify
    nobody.
  - Today's card shows only when the page runs from the home-screen icon, the
    device can be asked, and the guide's card does not hold the home (it holds
    it while it is live and still takes steps). In the home-screen app S10 is
    the guide's first step on every launch until done (the design said "for
    that launch"); in a browser it is last and gives way when five steps come
    before it.
  - An ask counts as shown when it appears; "לא עכשיו" rests every ask for 14
    days; the browser's question closed without an answer keeps the ask. The
    upload ask sits on the uploader's lecture while its outline is planned
    (single uploads go straight there) and on the batch upload's done card.
    The inbox's line opens the settings (the browser's question comes from
    the settings' own button).
  - "להודיע לקבוצה" is on the quiz setup only (not on the challenge's setup
    nor the meeting's quiz presets, which push as usual); unchecked, the app
    calls `study_quiz_quiet` right after the quiz is made.
- **Checks:** `supabase/tests/study.sql` R30-R42 (each hook, the reminders,
  once-a-day rules, the claim's meeting rules), fresh, from parts, and as an
  upgrade from the previous schema; `notify-concurrency.sh`; unit tests for
  S10, `cardTakesSteps`, the asks' memory and the routes R 2 writes;
  `e2e/study/notify-asks.cjs` (the design's cases 10 and 11, with help) on the
  flag sets `notify` and `i`.
- **Not built:** the design's "S10 first only for the launch from the icon"
  (it stays first in the app until done); real pushes on devices (the owner's
  checklist in `notify.md`); the Hebrew iOS and Chrome menu words stay
  unchecked until the owner's screenshots.

**Owner steps** for all of notifications: [`RELEASE-R1.md`](RELEASE-R1.md)
(release point 1: part 9 and `VITE_STUDY_NOTIFY`; 2: the VAPID keys and the
pilot; 3: the switch on and the WhatsApp line).

### Notifications, the reviews' fixes, built on 26 November 2026

Three reviews of the notifications build (correctness, security and privacy,
UX) found one bug that mattered and a list of smaller ones. Every finding was
checked against the code; all were real, and all are fixed here except the
Realtime DELETE note, which is documented and accepted. Section R stays at
version 2 (it was never released); part 9 is regenerated (115 KB of 170).

- **A new VAPID key now reaches every device** (correctness "should",
  security "must"). The device decided whether to subscribe again from its
  memory of the key, which `wiring()` had already overwritten with the new
  one, so a device kept its old subscription and the leaked-key runbook did
  not work. Now `subOnKey()` asks the subscription itself
  (`options.applicationServerKey`), falling back to `subKeyId`, written only
  after section R saved the device; `enable()` and `resync()` both use it.
  As a second guard the claim sends each device's `key_id` and the worker
  reports a device saved with another key's id as 410 without posting, so
  section R deletes it. Unit tests (rotation in `resync` and `enable`) and an
  e2e step (a new key from health: one unsubscribe, one new save with the new
  id, once). `RELEASE-R1.md`'s leak steps no longer ask members to do
  anything.
- **The asks ask from the tap itself** (UX "must"). Today's card and the
  upload offer awaited a dynamic import before `requestPermission`, which
  Safari on iOS may refuse outside the gesture. `NotifyParts.tsx` now imports
  `lib/notify` statically (it is a lazy chunk itself) and `enable()` is the
  tap's first call, before any await; the settings button too. A device check
  was added to `notify.md`.
- **"נכנסו עם הקוד האישי" cannot be silenced by the one it warns about**
  (security "should"). Opening the inbox no longer drops a security notice's
  push (neither in `study_notices_seen` nor in the claim). Devices the member
  removes (this one, another, "ניתוק המכשירים האחרים", or the 10-device cap)
  within 10 minutes of a sign-in with the code are kept aside for 15 minutes
  in `study_private.push_removed`, and the notice goes to them too (never to
  the device that signed in). SQL tests R18e-R18k.
- **No endpoint takeover** (security "should"): an endpoint another member
  saved moves to the caller only with the same keys (the same browser
  subscription); other keys are refused `bad endpoint`. R5 now checks both.
- **Meetings and study days are throttled like quizzes** (security
  "should"): one meeting or study day a group per 10 minutes, and a creator
  per 30 (`study_private.notify_live_by`); the rest stay in the inbox as
  capped. SQL tests R33b-R33c.
- **Shared browsers** (security nit): `resync()` keeps only the subscription
  of the member who turned pushes on there (`uid` in the device's memory).
  Another member signing in is never subscribed without a tap of their own,
  and the earlier member's subscription is dropped on that browser (its push
  service then answers 410). The e2e step "another member on this device" now
  checks this.
- **Smaller SQL fixes**: `study_notices_seen` with ids marks them in any of
  the caller's groups (a push about group B tapped in group A); the three
  removals need only a signed-in caller (a member of no group can still stop
  their devices); a soft-deleted lecture's notices leave the inbox and the
  bell, and their waiting pushes become `none`; a cancelled meeting's rows
  carry `args.off`; two partial indexes for the minute job
  (`study_notices_live`, `notify_outbox_lease`); the inbox returns
  `lecture_id`.
- **The words** (UX "should"s and nits; all pinned):
  - Night hours read "(מ-23:00 עד 07:30)" on the switch and in help; a range
    with a dash showed reversed in a right-to-left line.
  - "תשובות בשרשורים שלך" instead of "תשובות אליך" (full spelling reads
    masculine), and no comma before the last ו.
  - "באייפד" on an iPad.
  - The blocked card's path by device and browser: the iPhone or iPad
    Settings path; the Android home-screen app's icon path (unchecked on a
    device); Chrome's; and a generic line for every other browser.
  - Ended live rows in their own past tense ("הפגישה התקיימה" / "בוטלה",
    "ההקראה הסתיימה", "מפגש הלמידה התקיים"), a meeting's or reading's still
    linked to its lecture.
  - "לפני דקה" / "לפני {m} דק׳".
  - "נכנסו עם הקוד האישי היום, בשעה 13:26".
  - The security line says "למכשירים שבהם ההתראות פועלות".
  - Help's how-to adds "כשההתראות זמינות בקבוצה".
- **The lock screen** (security nits; OD11's spirit, owner's call recorded
  here): a kind this build does not know shows only "משהו חדש בתמצית" (its
  args' title stays in the inbox); a study day's free-text title is not on
  the lock screen, only its time.
- **The screens** (UX): the settings keep their rows' own height
  (`align-content: start`; the iPad's stretched button); "לשנות שעות" looks
  like a link row and moves the focus to the first time; each device's
  remove button is named for its device; another app's browser gets the
  install screen's "פתיחה ב…" and "העתקת הקישור"; switches say
  `role="switch"`, a little stronger when disabled in dark mode; the test
  button says why it rests; an ask card that goes moves the focus to the next
  heading; sign-out shows "יוצאים…" while the device is removed; the bell
  has the guide's chip; summaries and past exams get a page icon.
- **One ask a launch**: Today's notifications card waits while the guide's
  one-time tour offer is unanswered (it showed both for most current
  members).
- **Robustness**: every notify part outside the routed screen has its own
  ErrorBoundary that shows nothing (the bell's chunk failing no longer blanks
  a tab screen); the settings read with a `select` under the select-own
  policy instead of an empty write; `/api/study/health` checks the VAPID pair
  once per instance and keys.
- **Budget** (correctness nit): a reservation picks the rate card as if the
  prompt were a fifth longer (`RESERVE_MARGIN` 1.2), so a prompt estimated
  just under Haiku 5.5's 100k line is reserved at the dearer card.
- **Documented, not changed**: Supabase Realtime sends DELETE events of
  `study_notices` (ids only) without row security; the app subscribes to
  inserts and updates only (`notify.md`). `study_site_url` must be the exact
  address members open (`RELEASE-R1.md`).

## Practice sets (design-practice, revision 2)

Yoad's answers decide OD3, OD5, OD11, OD12 and OD13 (and confirm OD1, OD8,
OD14, OD15, OD19 and OD22 for this build); every other open decision takes
the design's recommended default. The build is on `dev` in the design's
slices: A (the generator, flag `VITE_STUDY_MAKE`, no SQL), B (sets and
sharing, SQL section L 1, flag `VITE_STUDY_SETS`) and, of slice C, the
notices (WP17), because notifications are built. What is built, the
numbers and the owner's snippets are in [`sets.md`](sets.md).

| OD | Decision |
|---|---|
| OD1 | **No new tab.** Decision 6 stands (היום · ספרייה · יחד · שלי); sets are reached from Today, the lecture page, the library card's chip and the hub `?v=practice` |
| OD2 | Covered by notifications' OD2 (the entry chunk's limit of 410,000 B). This design's static share of the entry chunk is capped at **2,000 B** (bundle owner `QS`, only its slot module in the entry; `tools/study-bundle.mjs` fails over it); everything else loads lazily. WP1's "move 6 kB to lazy chunks" is **not** done now: the numbers are measured and recorded in `sets.md` |
| OD3 | **Every set is shared when it is created** (Yoad): no private set, no switch, no unshare. Any member can hide a set for themselves; the author or the group's creator can delete it (a soft delete: the questions stay in the bank) |
| OD4 | The free redo ("לחזור על הטעויות", `s=m`) is primary. The paid secondary, "שאלות חדשות על הטעויות", makes an ordinary shared lecture set whose request stores only the lecture's parts that hold the mistakes, never the member's points or a focus text; its copy says the set is shared |
| OD5 | **"פותרים: k" always, and the member's own score** (Yoad). The group average only when at least **3 other** members finished (`study_private.pulse_floor()`); per-question results only from 3 others, as 3 bands computed without the viewer; **no best score**. Each member counts with their first finished attempt, scored on the first answer per question |
| OD6 | The author's name on set cards, the set page, the inbox and Today's row ("מאת {name}"); **never on the lock screen** (notifications' OD11) |
| OD7 | Names of members who solved a set: opt-in, names without scores, asked once at the end of the member's first finished set, then only in שלי |
| OD8 | **No sets from the bank and no course sets in v1** (Yoad); "סבב חדש" stays the free path from the bank, course sets are WP20 (not built) |
| OD9 | One concept: an uploaded sheet's "similar" run will become a set of kind `sheet` (L's columns `exam_id`, `similar_run` and the `study_private.qset_*` hooks are the seam). Nothing of the exams design is built here |
| OD10 | At most **one push a day per member** for new sets, coalesced ("3 סטים חדשים בקבוצה"), its body without the lecture's name |
| OD11 | **The price is shown, at a conservative $0.04 a question, until the ledger calibration** (Yoad). The owner's read-only calibration query is in `sets.md`; production was not queried. After calibration the base rate is the observed mean, scaled by the practice route's model price (`expectedQuestionUsd(model)`) |
| OD12 | **A monthly line of $12 for sets** (Yoad's sub-cap; `STUDY_SETS_MONTHLY_USD`, default 12): the spend of kinds practice, solver, reword and style, checked when a set starts, so a started set finishes. Summaries stay protected |
| OD13 | **5 new paid sets a day per member** (Israel time); the create screen shows what is left when 2 or fewer remain |
| OD14 | **A server switch `questions_paid`** (on by default): `kind_on` maps practice, solver, reword, style, points and bank to it, so question spending stops without a redeploy |
| OD15 | **Auto-keep ships off** (`qsets_auto_keep` off); on only after 2 weeks of measurement (5% or fewer flagged or retired) and only with an approved solver model (`AUTO_KEEP_MODELS`) |
| OD16 | Another member may tap "להמשיך ליצור" on a paused set; the cost counts against the person who continues, and the button says so |
| OD17 | A confirmation when a set's cost is above $1 |
| OD18 | Set generation uses the practice, solver, style and reword routes. Yoad's answer for models applies: approved providers may get every kind; members get one informational line in the help screen's privacy text |
| OD19 | **Server-driven writing later** (Yoad): no `set_ready` push now; the generating screen keeps its "the creation runs from this device" callout |
| OD20 | A soft block for a second set on a lecture while one is being made ("יש סט בהכנה…" with "ליצור סט נוסף בכל זאת") |
| OD21 | The word is **סט** ("סט שאלות"); "סבב" stays for the flexible round from the bank |
| OD22 | **The old three-screen generator stays one release** after `VITE_STUDY_MAKE` is on (Yoad), behind the flag |

Also decided for this build:

- **Notices (WP17, slice C) are built now**, because section R exists:
  `set_shared` (coalesced per group and Israel day, at most one push a day
  per member, the body without the lecture's name, the author's name never
  on the lock screen) and `set_solved` (inbox only, to the author), wired
  into R's kind registry, its hooks and `notifyCopy.ts`, plus R's
  `questions_ready` skip for a request that belongs to a set. Their defaults
  follow R: group activity ("בשבילך") is on.
- **SQL placement:** section L 1 follows section R in
  `supabase/study-schema.sql` (the order is I, R, L; Y and O come later). It
  goes into `supabase/parts/9.sql` while part 9 stays at most 170 KB;
  otherwise L starts part 10 (`tools/sql-parts.mjs`'s `STARTS` and its tests
  change with it). `kind_on`'s new text is also written into section F
  (design §7.5). L's version is bumped once; R's changes only if R's SQL
  changes.
- **Privacy line** (help and privacy copy; informational, not a gate): a set
  and its questions are visible to the whole group with the author's name.

### Practice sets, slice A's groundwork (WP0-WP3), built on 26 November 2026

- **Docs** (WP0): [`sets.md`](sets.md) (what is built, the numbers, the
  calibration query, the planning rules, the owner's snippets); COPY.md's
  glossary rows for sets; `practice.md` no longer describes a "תרגול" tab
  where production has none.
- **Bundle** (WP1): `tools/study-bundle.mjs` knows the package `QS` (its
  slot `features/qsets.tsx`, its screens, `make`, `setsCopy`, `sets` and
  `styles/sets.css`) and the flags `MAKE` and `SETS`; `QS` keeps only its
  slot module in the entry chunk and fails the check above 2,000 B. Measured
  before any of its code: 400,398 B with every flag on (9,602 B left), so no
  entry code was moved.
- **Planning** (WP2, `shared/study/practice2.ts`): fresh first (after red
  flags, the points no active bank question tests come first), parts
  weighted by their uncovered points (at least 1), `covers` counting only
  new points, `coverageAfter()` and `styleCounts()` for the preview, and
  `expectedQuestionUsd(model?)`: **$0.04 a question** (was $0.025), scaled by
  another model's price for a writing batch against `claude-opus-5-5`.
  Every estimate moves to $0.04, the old screens' too (OD11: the
  conservative price is shown until the calibration).
- **Server `plan`** (WP3, `server/study/practice2.ts`): fresh first for
  `plan` and `create` alike (a question hidden by two flags covers nothing),
  `plan.styles`, and with `inputs: true` the planning inputs (the points,
  `covered`, the active count, `free`, the headroom to the 80% line and the
  40% share, the prices). Open and recent sets, the sets line's headroom and
  the day's sets left stay `null` until section L 1 provides them (a member
  cannot read the ledger, so L needs a member RPC for those two figures);
  `setsMonthlyCap()` (default $12), `SETS_LINE_KINDS` and `SETS_DAILY` (5)
  are in `server/study/budget.ts`, outside `POLICY`.
- **Not done here:** the calibration itself (Yoad runs the read-only query
  in `sets.md`; production was not queried).

### Practice sets, slice A's entry points and fixes (WP7-WP8), built on 26 November 2026

- **One name on every way in** ([`sets.md`](sets.md), "The entry points and
  the fixes"): Today's card "תרגול", the library's chip "+ סט" (also on a
  lecture with no questions), the lecture page's row after reading ("סט
  חדש" · "לפתור"), the hub's "סט חדש" card; each only with
  `VITE_STUDY_MAKE`.
- **Today's free primary is "תרגול מהבנק"**, not the design's "סבב חדש":
  from Today there is no lecture to start a round on, so the button opens
  the hub's lectures, and COPY.md's glossary already names practising from
  the bank "תרגול מהבנק". With a queue the card keeps that link beside "סט
  חדש ‹", so the hub stays one tap from Today.
- **The fixes of §5.11** are behind the same flag (flags off is the app as
  it was, and `practice.cjs` keeps checking the old words).

### Practice sets, slice B's SQL and server (WP9-WP10), built on 26 November 2026

- **Section L 1 is part 10** of `supabase/parts`: with sections I and R,
  part 9 would have been 177 KB (over 170 KB), so `tools/sql-parts.mjs`
  cuts 10 parts and L starts the last (62 KB); Y and O will follow L there.
  Part 9's SQL is unchanged (only its header says "of 10"), so R stays at 2
  and its client need is unchanged. The README says "10 parts".
- **`kind_on`**: L's text, also in section F (a unit test compares them).
- **The day's sets count deleted ones** (the design said non-deleted): a
  set deleted after it was written was still paid for, so deleting cannot
  reopen the day's 5. A set abandoned before its request (Q refused, or the
  author left the reading phase) is removed and does not count.
- **"Open" (D6) includes a set begun in the last 2 minutes that has no
  request yet**: `begin` and `attach` are two calls, and without it two
  members could both pass in between (the concurrency test shows one set).
- **A member RPC `study_qset_room`** gives the create screen the sets line's
  spend this month and the member's sets begun today (a member cannot read
  the ledger); the server reads the same before `begin` so a member at a
  line hears that line, in the create screen's order, before `too_big`.
- **The answer wrappers stamp exactly the row their call added** (the
  caller's rows for that question before the call are left alone), not "the
  newest by time": two answers in one transaction share a time.
- **An attempt finished with no answer is dropped**: it never counts as
  solving the set. The group's average is the share right over every
  finisher's first attempt; a per-question band needs 3 other members who
  answered that question (not only finished the set).
- **Notices:** `set_shared` is called through R's hook
  `notice_set_shared` only when it exists (WP17 adds it), and `notified_at`
  is stamped either way so a hook installed later never announces old
  sets; `set_solved` is added only once R's kind registry has the kind
  (WP17). `notifyRoute.test.ts` checks section R's own routes until then.
- **Auto-keep** keeps only drafts the solver passed (`ok`, never
  `unchecked`), as the design says; it ships off.
- **`POLICY.qsets`** stays `SETS_DAILY` (5) outside `POLICY`, as WP3 chose:
  `POLICY` holds ledger kinds, and nothing should reserve a call as "qsets".
- **The set path of `create`** answers every budget line as 402 (the
  create screen's words), 409 `already making` with the open set, and a
  phase instead of 409 `points stale` when the set reads first. Course sets
  (a set with `planId`) are refused (WP20).



### Practice sets, slice B's entry points, e2e and docs, and slice C's notices (WP14, WP15, WP17), built on 26 November 2026

- **The notices live in section L 1, not in R:** `set_shared` (R's reserved
  row, `mine`, pushed) is written by `study_private.notice_set_shared` and
  `set_solved` is registered by L (`inapp`, 30 days), both through R's
  `notice_add`. R's SQL is unchanged, so R stays at 2 and the client's
  `requiredSchema` for notifications too; L is still at 1 (bumped once).
- **R's `questions_ready` skip is moot:** R sends nothing for questions
  being written (notifications' OD21), so there is nothing to skip;
  `qset_of_request` stays as the seam.
- **One push a day (OD10)** is enforced in the hook: once a `set_shared`
  push went out to a member that Israel day, a new or coalesced row stays
  in the inbox (its outbox row `sent` again, or `capped`). A coalesced row
  (2 sets or more that day) links to the shelf and keeps no lecture title.
  `obj` `qsets` (the shelf) sees `set_shared`; a set's page (`qset:<id>`)
  sees `set_solved`.
- **Today's primary "לפתור סט חדש"** (design §5.1) starts the newest ready
  set someone else made that the member has not solved; "תרגול מהבנק"
  stays the primary when there is none (WP7's choice for "סבב חדש") and
  becomes a link in the card when there is.
- **The mistakes' end** (`s=m` with `VITE_STUDY_SETS`): the primary reads
  "לחזור על הטעויות" (it was "סבב נוסף") and "רק הטעויות מהסבב" is not
  offered there (the same round, and two buttons did not fit at 360 px).
  The paid secondary's price is the default size at the planning rate
  ($0.40), without a stale read. Not on the Progress screen (not in WP14's
  list; its own primary is the free "לתרגל את מה שחוזר היום").
- **The lecture page's D6 line** names any set being made on the lecture,
  the member's own too (a way back to it).
- **A set's link, signed out:** after the personal code's sign-in the app
  lands on the set (`StudyApp.tsx`, +147 B of entry code), as the design's
  §5.6 asks; before, it went to Today.
- **Release** ([`RELEASE-L1.md`](RELEASE-L1.md)): part 10 only (part 9, R 2,
  is a prerequisite and unchanged); `VITE_STUDY_MAKE=1`, then
  `VITE_STUDY_SETS=1`, Production only. Part 1 carries `kind_on`'s new text
  only so a later re-run keeps it; it need not be run now.
### Practice sets, the reviews' fixes, built on 26 November 2026

Three reviews (correctness, security and privacy, UX) of `baed964..0de429e`;
every "must" and "should" is fixed, the nits that were cheap too. The
details are in [`sets.md`](sets.md) ("The reviews' fixes"). Decisions taken
in the fix, for Yoad to confirm or change:

- **OD5, its exact form.** A precise running average let a member work out
  another member's score from two calls (before and after a finish), and
  the floor of 3 counted members who joined minutes ago, members out of
  Pulse and former members. Now the group's numbers count only the other
  members whom Pulse counts (`study_private.pulse_counted`: 7 days in the
  group, not opted out of Pulse, still a member) and are computed over a
  **fixed bucket: the first 3 (6, 9, …) of them to finish**, without the
  viewer, the average **rounded to 0.1**. A 4th or 5th finisher changes
  nothing until the 6th. The set page says it in one line ("הממוצע
  והתוצאות: 3 הפותרים הראשונים, בעיגול"). "פותרים: k" still counts every
  finisher. The hub's "התשובות והציונים שלך גלויים רק לך" stays true. What
  remains possible: with 3 others in the bucket, a member who knows two of
  their scores (by asking them) can narrow the third to about 10% of the
  set; recorded, not prevented.
- **A set's score is its first answers as given:** the attempt records each
  question's first answer when it is given (`firsts`), so deleting one's own
  answer row (`study_answers`' "delete own") and answering again changes
  neither the score nor the group's bands. Finishing needs a set the member
  still sees.
- **OD12 also covers "create" without a set** once section L 1 is installed
  (the older generator, OD22, and rounds over several lectures): one read of
  L's room, 402 `sets_line` past the line. This changes D12 ("without a set
  nothing of L is called") by that one read. The line is compared with
  recorded spend, so sets begun within seconds of each other can each pass
  before a batch is charged; accepted for a group of six.
- **OD15 stays as decided on the server** (`qsets_auto_keep` off), and the
  author's own device now keeps the set's checked questions when its writing
  ends, the same keep "להתחיל לפתור" does (only drafts the blind solver
  passed; the unchecked ones still wait for "לאשר או להסיר"). Without it a
  set whose author left the finished screen was shown as "0 שאלות" and was
  never announced. If Yoad prefers a tap, the alternative is to drop that
  effect: the shelf then shows such a set as "מוכן לפתרון" and the first
  member's "להתחיל לפתור" keeps it, and the group hears about it only then.
- **The read phase is the phone's choice:** points gone stale between "plan"
  and "ליצור" are 409 "points stale" as without a set (the screen reads them
  and creates); the server's begin-as-reading path stays as a seam
  (`set.phase: "read"`, sent by no screen in v1), and its continuation needs
  a set still reading from the last 10 minutes, at most its size.
- **Sets that never got their request** are paused after 2 minutes (their
  author or the group's creator can delete them from the set page) and
  removed by the nightly clean-up after an hour.
- **The bundle (OD2):** the design's whole growth of the entry chunk is
  2,829 B (400,398 → 403,227); QS's own share, which the cap measures, is
  1,631 B of 2,000. The set screens' error words moved to the lazy
  `setsCopy.ts`. Whether the 2,000 B cap should also count the design's
  lines in F's modules (`route.ts`, `flags.ts`, the conditions) is Yoad's
  call; as built it measures QS's slot only.
- **Not changed:** a replaced route keeps its notice (review UX-1) also for
  `x=new` without a lecture and `x=review` with MAKE off; "רק לך" stays the
  app's wording outside the set screens; the lecture sheet has no coverage
  percentage (it would need a plan call per lecture).

## Uploaded sheets (design-exams, revision 2)

Yoad's answers decide OD3, OD5 (changed), OD20 and OD21, and Yoad's
instructions for the build change OD17, OD18 and OD19; every other open
decision takes the design's recommended default. Where the exams design and
the practice sets design (§13.2) disagree, §13.2 and the built section L
win. The build is on `dev` in the design's slices: A0 (sheets with the exam
reader as it is, SQL O 1, flag `VITE_STUDY_SHEETS`), A1 (the sheet reader,
open and numeric forms, O 2, `VITE_STUDY_SHEETS_FORMS`) and B (similar
questions, O 3, `VITE_STUDY_SIMILAR`). What is built, the numbers and the
owner's queries are in [`sheets.md`](sheets.md); the steps in
[`RELEASE-O.md`](RELEASE-O.md).

| OD | Decision |
|---|---|
| OD1 | **Yoad's check, read only**: is the switch `exams` on in production? The query is in `sheets.md` and `RELEASE-O.md`; this build never queried production. Release A0 turns `exams` and `sheets` on together, or Yoad keeps both off and O ships dark |
| OD2 | **Yoad's check, read only**: `STUDY_MONTHLY_USD` set to 33 in Vercel (the code's default is 40), and the spend by kind for October and November (queries in `sheets.md` and `RELEASE-O.md`) before release A1 |
| OD3 | **Yoad:** sheets (reading, answers files, solving) at most **$6 a month** (`STUDY_SHEETS_MONTHLY_USD`, default 6); similar questions at most **$5 a month** (`STUDY_SIMILAR_MONTHLY_USD`, default 5). Both lines are checked before anything is spent; summaries stay protected; the total stays $33 |
| OD4 | Two kinds: "מבחן קודם" and "דף תרגילים"; a question bank is a sheet with no lecture |
| OD5 | **Changed by Yoad:** other providers (OpenAI, Gemini, Chinese models) may see everything, past exams, sheets and similar generation included. Every route stays on the current default model for now (the models package, Y, is not built); no refusal of non-Anthropic models is built for these kinds; the route keys `sheet_read` and `similar` are left for Y. One informational line in the help screen's privacy text (not a gate): uploaded material may be processed by the AI providers the app uses |
| OD6 | Only course-staff material and the group's own; the upload's help says so (the app cannot check it) |
| OD7 | Numeric answers and answers to similar questions go to `study_answers` (they count like any practice answer); open answers stay personal, in a private table |
| OD8 | Open answers are self-marked and personal: never in group, topic or simulation figures |
| OD9 | **Simulations only of past exams**, and only their choice items (built in O 1: `study_mock_create`) |
| OD10 | **Yes:** one practice set per sheet, kind `sheet` (L's `qset_for_similar`, `qset_add_items`, `qset_similar_done`), shared like every set (L's OD3), solved through `s=k.`. Per practice sets §13.2: no `study_similar_share`, no set page of O's own (`?v=sets&k=` instead), no `set_shared` notice of O's own (L's), and the copy "מאת {name}" and "לפתור" |
| OD11 | Any member may start a whole-sheet run: at most **24 items** (one similar question each), **1 run per sheet per day**, within the member's 40% share and the similar line |
| OD12 | The whole-sheet offer at the end of practising a sheet and in the sheet's "⋯" menu, never at the top of the review |
| OD13 | **Sheet reading is group work** (no member share, like past exams), with a **40-page cap**, a **second confirmation above $3**, the sheets line (OD3) and a **headroom check** (a start is refused when the 80% line minus this month's spend is below the sheet's worst case) |
| OD14 | **Yes:** a link opened without a session shows a landing card, reusing L's signed-out line and the install steps (`?v=install`) |
| OD15 | Yes: a priced row "להעתיק גם N שאלות פתוחות" on exams and A0 sheets with skipped open questions |
| OD16 | **DOCX later:** the upload says "קובץ Word? צריך קודם לשמור אותו כ-PDF." |
| OD17 | **The current default model** for reading, solving and similar (not pinned to a provider, OD5); Y routes them later |
| OD18 | **Changed by Yoad's build instructions:** section O follows section L in `study-schema.sql` (the order is … I, R, L, O). O is in part 10 after L while part 10 stays at most 170 KB; otherwise O starts part 11 (`STARTS` gains `"O"`, and the tests, the parts' headers, the README and the docs say 11 parts). In-place edits in Q, Z, H, M, T, E and F as the design lists are allowed in the later versions; their release notes then say exactly which parts to run |
| OD19 | **Changed by Yoad's build instructions:** the entry chunk's limit is 410,000 B (notifications' OD2; about 403,227 B used before O). O's share of it is capped at **1,500 B** (bundle owner `O`, free in `tools/study-bundle.mjs`); everything else loads lazily; at least 1,500 B stay free for the models package after O |
| OD20 | $5 a month for similar questions (part of OD3) |
| OD21 | $6 a month for sheets (part of OD3) |

Also decided for this build:

- **`study_set_solution` is renamed `study_item_solution`** (practice sets
  §13.2: `study_set_*` reads as a set function).
- **O's version goes to 3 across the slices** (O 1 for A0, O 2 for A1, O 3 for
  B), and each flag asks for its own: `sheets` O 1, `sheetForms` O 2,
  `similar` O 3 with L 1.
- **e2e flag sets `o` and `os`** in `e2e/study/mock.cjs`; `os` builds on L's
  `ps`. `exams.cjs` keeps passing.
- **Fixtures are synthetic only** (`e2e/study/fixtures/sheet/`,
  `make-sheet.cjs`); `e2e/study/fixtures/real/` is ignored by git.

### Uploaded sheets, O0 and O1 (the fixture, the measurement, SQL O 1), built on 26 November 2026

- **The fixture** (O0): a synthetic 6-page exercise sheet with a cover page
  and a 2-page answers file, made into a PDF and photos at test time;
  `server/study/sheetFixture.test.ts` keeps it consistent and checks that
  release A0's exam-reader replies save as the design says (6 saved, the
  8-option item rejected, 4 open or numeric items counted).
- **The time measurement** (O0) is on the fixture only and costs $0
  (`tools/sheet-timing.mjs`); the design's paid measurement is replaced by a
  read-only query of production's ledger that Yoad runs. Its finding: read
  units of 3 pages fit the 120 s budget at any likely speed, but a solve unit
  of 8 items fits only above about 115 tokens a second, because thinking
  dominates; the solver (O6) takes `min(8, what fits)` at the measured slow
  speed. Details in `sheets.md`.
- **SQL O 1** is in part 10 after L (part 10 is 91 KB). Beyond the design's
  list of S's functions O redefines, O 1 also redefines
  **`study_exam_key_undo`**, so an undo of a true/false or match item keyed by
  hand brings its statements back (the key log gains `old_seq` and
  `new_seq`). `study_sheet_create`'s answers default to `none` when not said.
- **R's `exam_ready` and `exam_failed` notices carry `args.kind`** once
  `study_exams.kind` exists (R's hook already read it); R's test R38 now
  checks it. The notice's words for a sheet come with the client slice.

### Uploaded sheets, O2 and O3 (release A0 in the app), built on 26 November 2026

- **One upload screen for both kinds** (`SheetUpload`) replaces past exams'
  own while `VITE_STUDY_SHEETS` is on; without the flag the past exams'
  upload is unchanged. A file's name becomes a sheet's title
  (`tirgul_3.pdf` → "tirgul 3"); an emptied name is "דף תרגילים {day.month}".
- **The camera's checks** warn and never block: blurred under a Laplacian
  variance of 80, dark under a mean light of 70, on a 640 px copy (the
  synthetic photos: sharp 1,040-2,210, blurred 12). Measured on the phone,
  $0.
- **A sheet's worst case** (the op's check against the sheets line and the
  headroom) counts every unit at all of its max_tokens, 4,000 characters of
  PDF text a page, and solving 8 items a page when there are no answers (2
  a page with marks or an answers file, for the items they missed). So a
  40-page sheet without answers (worst $9.75) cannot start under the $6
  line, as the design's §11.2 expected; marked, it can ($5.12). An answers
  file is at most 10 pages. With the 40-page cap no A0 sheet's usual price
  passes $3, so the second confirmation is built and tested on the server
  but not reached in A0.
- **The sheets line's figures** come from `study_sheet_room` (added to O 1;
  part 10 is re-run at release point 2): this month's `exam_jobs.cost_usd`
  of the group's sheets and the month's spend.
- **The providers line (OD5)** is in help's "מבחנים ותרגילים" row, not on
  the upload screen, which keeps decision 1 (nothing there says where the
  pages go). The upload's "מה אפשר להעלות?" says the material line (OD6).
- **The landing card (OD14)** is for an upload's link (`?v=exams&e=`); a
  set's link keeps practice sets' own line (L), so the two never stack.
- **The wide review** outlines a figure's box only: release A0's reader
  draws boxes for figures, not for every item, so the page's items are also
  chips under the page. Boxes are drawn by hand from A1.
- **The exact text component** (`SheetText`: kept lines, tables) waits for
  the sheet reader (A1): the exam reader's copies have no line breaks.
- **Printed order** after the answer is kept for every uploaded item (past
  exams' too) while the flag is on.
- **Entry chunk:** O's slot is 686 B of its 1,500 B; the chunk is 404,315 B
  of 410,000 with every flag on (5,685 B left, at least 1,500 of them for
  the models package).

### Uploaded sheets, O4 (the A0 e2e, its fixes, the release steps), built on 26 November 2026

- **The A0 e2e runs on the shared mock with the synthetic sheet only**
  (`e2e/study/sheets.cjs`, flag set `o`; `ps` and `s2` check that nothing of
  it shows). The design's list for A0 is covered: the phone upload from a
  lecture's link, the desktop drop and paste, the reading, the wide review
  at 820 and 1440 with the box, ArrowDown and E and no confirmation on
  Enter, a true/false item keyed by hand, the printed order after answering,
  simulations without sheets, and the landing card; plus help's two lines,
  the exactness flag on a misread copy, the cover left out (its ID line
  never sent), a question bank, and the refusals in a sheet's words.
- **The phone flow uses the answers file**, as the fixture has it (its
  answers are a file of their own, not marks on the page), so the review
  shows 4 keyed items and the true/false and match ones to key by hand, the
  gap O 1's hand keying closes.
- **Not driven through the screen, tested elsewhere:** more than 40 pages
  and the $3 confirmation (with the 40-page cap no A0 sheet's usual price
  reaches $3) are the op's unit tests; the headroom and `study_sheet_room`
  are the SQL tests' and the op's. The design's "each at 390, 820 and
  1440, light and dark" is met as: every screen at 320, 390, 820 and
  1440 in light and dark for sideways scroll and screenshots, the a11y check
  on each, and `devices.cjs` on its eight devices.
- **A ready sheet for screen-only scripts** (`mocks/sheets.cjs`,
  `db.sheetsMock.seed`) runs the exams mock's own worker on the fixture, so
  `devices.cjs` and `wide.cjs` show the same review the upload makes, with
  clean page pictures (`make-sheet.cjs` `pageShots`).
- **Fixed, as the scripts found them** (no change of behaviour beyond
  these): the upload's "מה אפשר להעלות?" to a 44 px hit area; a PDF tile's
  name to 14 px; the wide review's page column and the upload's details
  column stick under the top bar (they went under it on a computer); a
  figure's box keeps the paper's ink in dark; a true/false or match item
  keyed by hand says who keyed it ("סומנה ע״י {name}", no letter).
- **Yoad's release steps** for A0 are one section of `RELEASE-O.md`
  ("Release A0, start to finish"): the read-only checks first, then part 9
  (only while I, R or L are missing, as on production at `eed179e`) and
  part 10, the $6 and $33 lines, the switches `exams` and `sheets`, the flag
  on Production only, checks that spend nothing, and one real sheet with a
  read-only query of what it cost.

### Uploaded sheets, O5 and O6 (release A1's SQL and server), built on 26 November 2026

- **Section O starts part 11.** O 2 is 96 KB; with it part 10 would be 188 KB
  (over the SQL Editor's 170 KB), so `tools/sql-parts.mjs`'s `STARTS` gains
  `"O"` (Yoad's rule for this build): part 10 is L alone (71 KB), part 11 is O
  (118 KB). The tests, the parts' headers, the README and the docs say 11 parts.
- **The SQL now runs as parts 2 to 11, also for release A0.** O 2 edits the
  pickers of sections Q, Z, M, H and T in place (parts 2, 3, 5, 7), so a run
  of part 11 alone could leave a picker able to draw an open or numeric item.
  A check at O 2's start stops part 11 with "section O 2 needs parts 2 to 9
  run first" when the edits are missing (tested). The sections' own versions
  are not raised for these edits: nothing the client asks for depends on them,
  and O's version (2) says they are in. Tested: a fresh database (the whole
  file and the parts, each twice), an upgrade from `4b9b832`, the live path
  (`eed179e`'s schema, then parts 2 to 11 twice), and rows only O 2 allows
  surviving parts 2 to 11 run twice.
- **The reader of a unit queued without one is the exam reader's**, unless its
  sheet was queued for the sheet reader (then a page read again stays the
  sheet reader's). The design's D4 said "sheet for any sheet"; that would have
  switched a release A0 sheet's pending units to the sheet reader halfway.
- **The sheet reader runs only for a client that draws its forms**: op
  `exam_read` reads a sheet with it when the body says `forms: true` (the A1
  client) and section O 2 is in (503 otherwise). An A0 client's sheet is read
  by the exam reader exactly as before, so a server deployed before the client
  never puts open or numeric items in front of an A0 screen.
- **A sheet's items are numbered page·100 + their place on the page**; the
  same label on a page more than one away is another item (its key gets
  `@<page>`: an exercise whose numbers restart). A past exam's open-add item
  keeps its printed integer; a question's parts are folded into one open item
  there, so an exam's numbering stays one row a number.
- **Solve units of the sheet reader are 4 items** (`study_private.sheet_solve_items()`,
  `SHEET_SOLVE_PER_UNIT`) with `max_tokens` 1,500 + 2,000 an item, and read
  units of 3 pages with `max_tokens` 12,000 (the design's 16,000 is not
  needed: the fixture writes about 3,000 with thinking). O0's measurement put a
  unit of 8 at over 120 s below 115 tokens a second; Yoad's speed query
  (`sheets.md`) decides when the 4 goes up (one number in part 11, one in
  `sheetPrice.ts`, pinned together by a unit test).
- **The worst case with these sizes** admits, under a fresh $6 line, a sheet
  of up to 9 pages without answers and 24 with them (release A0's exam
  reader: 24 and 40). Longer sheets are refused with "התקציב לדפי תרגילים
  נגמר החודש" until the line is raised; typical prices are far lower (6 pages
  with an answers file about $0.47, without answers $0.69).
- **A solved answer's confidence is capped at 2 only for an unsure reading**
  (parse_conf under 3): the sheet solver sees the figures' pages, unlike S's
  solver, which also capped every item with a figure.
- **Numeric answers:** tolerance 1% unless the file or the solver says
  otherwise (at most 50%; the solver's at most 5%); an answer of 0 only by 0.
  The solver's number is kept at confidence 1 (counting in no score) when its
  working does not recompute to it within the tolerance, at least 0.5%
  (`calc.ts`, never evaluated as code).
- **The budget pause (D23)** is a sheet unit failed for `budget` or `reserve`
  with no retry time (`study_private.exam_job_paused`): the sheet stays
  `reading` with error `budget`. "להמשיך" and "לסיים בלי תשובות מוצעות" go
  through the op (`study_sheet_resume`, the worker's key with the member's
  token), which checks the held units' worst case against the sheets line and
  the headroom first. Known gap: S's "לנסות שוב" (`study_exam_retry`) also puts
  failed units back without that check; each unit still reserves within the
  80% line.
- **Open-add (OD15)** is `study_sheet_open_add` through the op (dry for the
  price): once an upload, on the pages of the read units that skipped open
  questions; `skipped_open` is net of what it copied (`range.copied`), so the
  count of printed questions does not change.
- **Names:** `study_item_solution` (practice sets §13.2), `study_sheet_open_add`
  and `study_sheet_resume` (the design's `open_add` and `resume` actions),
  `study_private.exam_job_paused` (S has `exam_job_held(job, lease)` already).
- **OD5 as changed:** no refusal of other providers is built; the sheet reader
  uses `SHEET_MODEL = MODEL` (the current default, OD17), and the route keys
  `sheet_read` (refs `sheet_read`, `sheet_key`, `sheet_solve` under kind
  `exam`) and `similar` are left for the models package.
- **Words:** five error codes a member can meet in A1 have Hebrew in
  `failText.ts` ("כבר ענו על השאלה: אפשר לתקן רק טקסט.", "יש כבר שאלה עם
  המספור הזה.", "משהו בשאלה לא תקין…", "אין מה להמשיך: ההעתקה כבר ממשיכה.",
  "אין שאלות פתוחות להעתיק."); the rest are internal. They are 528 B of the
  entry chunk (counted under F): O's real share is 686 + 528 = 1,214 B of its
  1,500; the chunk is 404,843 B of 410,000.
- **Left for the client slices:** the flag `sheetForms` (`VITE_STUDY_SHEETS_FORMS`,
  requiredSchema O 2) and the e2e flag set `os` (O7/O11; `o` gains the forms
  flag then), as the mock's comment says.

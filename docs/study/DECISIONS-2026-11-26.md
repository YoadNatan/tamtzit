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

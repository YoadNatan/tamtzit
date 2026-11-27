# Notifications (VITE_STUDY_NOTIFY, SQL section R)

Built on `dev` on 26 Nov 2026, in three slices, each releasable on its own
([`RELEASE-R1.md`](RELEASE-R1.md) has the owner's steps for each). The design
is "notifications, revision 2"; Yoad's answers and every decision taken are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md).

A member hears about the few things worth a tap, on the phone or the
computer, even when תמצית is closed. Every notice is first a row in the
member's inbox (the bell); a push to the member's devices is only a way of
delivering it. Members without pushes (an iPhone in a Safari tab, an old iOS,
Instagram's browser, a "no" to the browser's question) lose only the
lock-screen alert.

## What a member sees

- **The bell** at the end of every tab screen's top bar (היום, ספרייה, יחד,
  שלי), before the guide's "?". Its count is the unseen notices (1-9, then
  9+); a screen reader hears "התראות, {n} חדשות".
- **The inbox** (`?v=notify`, "התראות"): the notices of the last 30 days,
  newest first, under "היום" and "קודם", 50 at a time ("עוד"). Opening it sees
  everything; the dots stay for the visit. A tap goes where the notice points.
  A group quiz that ended reads "מבחן קבוצתי נפתח" with "הסתיים · לתוצאות". A
  gear opens the settings when pushes are offered to the member.
- **Seen without the inbox:** opening a screen sees its own notices (a
  lecture, a quiz, a past exam, a meeting, a dispute, a lecture's wall), also
  when one comes while the screen is open; a push's link (`?nt=<id>`) sees
  its notice.
- **"שלי" → "הגדרות התראות"** (`?v=notify&x=set`), only when pushes are offered
  to this member (health says pushes work, and the switch `notify` is on or
  the member is in the pilot). On top, this device: on, with "שליחת התראת
  ניסיון"; "להפעיל התראות במכשיר הזה" (the browser's question comes only from
  that tap); or why not here, with the way out. Below: what is sent (two
  categories and the daily reminder), when not (the night, Shabbat), and the
  devices when there are two or more.
- **The asks** (slice 3), each once on a device, only where this device can
  turn pushes on, never on load:
  - Today, the first launch from the home-screen icon: "תמצית פתוחה מהאייקון ✓"
    with "להפעיל התראות" and "לא עכשיו". When the guide's card holds the home,
    its first step is "לקבל התראות" instead (one card, not two).
  - The uploader's lecture while it is written, and the batch upload's done
    card: "להודיע כשהסיכום מוכן?".
  - The inbox: "ההתראות לא פועלות במכשיר הזה. [להפעיל]" once ever.
  - "לא עכשיו" hides every ask for 14 days.
- **The quiz setup**: "להודיע לקבוצה" (on by default). Unchecked, the quiz
  opens without a push to the group (the inbox still has it). The push waits
  15 seconds, so ending the quiz in that time drops it too.
- **The guide**: step "לקבל התראות" (last in the first steps; first when the
  app is opened from the icon), the walk to שלי's row; help's row "התראות" and
  the how-to "להפעיל התראות".

The lock screen shows lecture and course titles, never a quiz's title, never
a name, never the text of a comment, question or summary, never a study day's
own title (it is written freely: the lock screen shows only its time), and
for a kind this build does not know, only "משהו חדש בתמצית". The inbox,
inside the app, adds the quiz's title and who opened it. A live notice that
is over says so in its own words ("הפגישה התקיימה", "הפגישה בוטלה", "ההקראה
הסתיימה", "מפגש הלמידה התקיים"; a quiz: "הסתיים · לתוצאות"), and a meeting's
or a reading's row still opens its lecture. A deleted lecture's rows leave
the inbox at once (they go with it when it is purged), and their waiting
pushes are not sent.

## What is sent (the events)

`cat`: **live** = "עכשיו בקבוצה", **mine** = "בשבילך", **digest** = the daily
reminder, **security** = always, **inapp** = inbox only. Both categories are
on by default (Yoad, 26 Nov 2026); the reminder is off (19:30 when turned on).

| Kind | Cat | When | To | Push |
|---|---|---|---|---|
| `quiz_open` | live | a group quiz opens (lobby) | everyone but the host | after 15 s, unless the host unchecked "להודיע לקבוצה" or it ended |
| `boss_open` | live | a group challenge opens | everyone but the host | as a quiz |
| `meeting_soon` | live | 15 minutes before a meeting (the minute job) | members not already in it | once a meeting; one meeting or study day a group per 10 minutes, and a creator per 30 |
| `reading` | live | someone starts reading aloud | members not in the meeting, not the reader | not after `meeting_soon` was pushed; once a meeting |
| `session_soon` | live | 30 minutes before a study day | those who said in or maybe | as a meeting; the lock screen shows only the time |
| `reply` / `answer` | mine | a reply in a thread | its opener ("יש תשובה לשאלה שלך" for a question) and earlier repliers | yes; one row a thread, counting |
| `credit_ask` | mine | a credit asked on a memory aid | the member asked | yes |
| `dispute` | mine | a dispute about a correction | its proposer | yes |
| `dispute_done` | mine | a dispute decided | both sides and the proposer, not the decider | yes |
| `needs_me` | mine | once a day between 17:00 and 21:00 | members who turned "הקבוצה צריכה אותך" on, when there is a question they could help with | yes, at most one a day |
| `summary_ready` / `summary_failed` | mine | a summary is ready or stopped | its uploader | after 90 s (not when the uploader watched it finish); a budget stop once a lecture a month |
| `exam_ready` / `exam_failed` | mine | a past exam is read, or not | its uploader | after 90 s |
| `digest` | digest | at the member's hour | those who turned it on | only with something to say: cards due, today's meeting, an exam within 14 days |
| `code_used` | security | someone signed in with the personal code (the minute scan) | that member | always, at most 3 a day, never to the device that signed in; opening the inbox does not stop it, and devices removed within 10 minutes of the sign-in still get it (kept aside 15 minutes) |
| `test` | security | "שליחת התראת ניסיון" | that member | after 5 s; never in the inbox |
| `update`, `edit_wait`, `lecture_new`, `meeting_set` | inapp | "עדכון", a correction waiting, a new summary, a meeting set or moved | its member, or the rest of the group | never |
| `set_shared` | mine | a practice set is ready, once ([`sets.md`](sets.md), section L) | the group but its author | one row a member a day, coalesced ("{n} סטים חדשים בקבוצה"); at most one push a member a day; the lock screen without the lecture or the author's name |
| `set_solved` | inapp | someone other than the author finished a set for the first time | the set's author | never |
| `similar_ready` | mine | similar questions for a whole sheet are ready ([`sheets.md`](sheets.md), section O 3) | the requester | held 90 s |
| `lab_new` | inapp | a comparison of a kind members rate waits for ratings ([`models.md`](models.md), section Y) | the group but the owner who ran it | never (one SQL line turns it on: `models.md`) |

**Never sent:** questions and cards being written (they are written from the
phone, which is almost always watching), corrections waiting, the daily
reminder unless turned on.

**Limits** (Israel day): 6 pushes "בשבילך" and the reminder, 12 in all, 3
security notices; one quiz push a group per 10 minutes and a host per 30; 60
a minute in all; one meeting or study day a group per 10 minutes and a
creator per 30. Over a limit the notice stays in the inbox. **Quiet hours**
23:00-07:30 by default (one switch, the hours can change): "בשבילך" waits for
the morning, live notices stay in the inbox, the security notice goes
silently. **Shabbat** (off by default): Friday 16:00 to Saturday 20:30.

## Platforms

| Device | Pushes |
|---|---|
| iPhone or iPad, iOS 16.4 and later, **opened from the home-screen icon** | yes (iOS 18.4 and later show them even without the worker's code) |
| iPhone in Safari, Chrome or another app's browser | no: the settings say to add תמצית to the home screen first |
| iOS before 16.4 | no: the settings give the way to update |
| Android Chrome, Samsung Internet (a tab or installed) | yes |
| Instagram's or Facebook's browser | no: the settings give "פתיחה בספארי/בכרום" |
| Computers: Chrome, Edge, Firefox, Safari 18.5 on macOS 15.5 | yes, while the browser runs |

The phones' own menu words (iOS Settings → Notifications, Chrome's site
settings) are in `src/study/lib/installCopy.ts` `OS`, unchecked until the
owner's screenshots on real devices.

## How it works

- **SQL section R** (`supabase/study-schema.sql`, part 9; R 2): the inbox
  (`public.study_notices`), devices (`public.study_push_subs`), settings
  (`public.study_notify_prefs`), the push side (`study_private.notify_outbox`,
  never published), the kind registry (`study_private.notice_kinds`), the one
  way to add a notice (`study_private.notice_add`, which never raises and
  gives up on a lock after 200 ms), the hooks, the minute job `study-notify`
  (the sign-in scan, the meeting and study-day reminders, the open question,
  the daily reminder, then the kick) and the nightly clean-up. The database
  stores no Hebrew.
- **The words** of every notice: `shared/study/notifyCopy.ts` (the sender and
  the inbox use the same table); the screens' words: `src/study/lib/notifyText.ts`.
- **Sending**: `POST /api/study/work {notify:true}` (the same server key as the
  writer), kicked by pg_cron and pg_net; `server/study/notify.ts` claims, sends
  in batches and reports. `server/study/push.ts` encrypts with WebCrypto only
  (RFC 8291, RFC 8292) and posts only to the push services' hosts.
- **The service worker** `public/sw.js`: push only, no fetch handler, no
  cache, served with `Cache-Control: no-cache`; registered only for a member
  who turns pushes on or opens the settings. Its header holds the two-line
  kill version.
- **The client**: the slot `src/study/features/notify.tsx` (the only R module
  in the study entry chunk, 552 B of R's 1,200), everything else lazy:
  `components/NotifyParts.tsx` (the core, the bell, the row in שלי, the asks,
  the quiz box), `components/InboxScreen.tsx`, `components/NotifyScreen.tsx`,
  `lib/notices.ts` (every member RPC of R), `lib/notify.ts` (the device's
  state, turning on, the re-sync on each open, the kill path, the asks'
  memory), `styles/notify.css`.
- **A device's subscription** follows its member and its key. It is made
  only from a tap of the member signed in (another member signing in on the
  same browser is never subscribed by the re-sync, and the earlier member's
  subscription is dropped there). The re-sync compares the key the
  subscription was made with (the browser's own `applicationServerKey`, else
  the key the device last saved with) to health's key, so a new VAPID pair
  makes every device subscribe again on its next open; meanwhile the worker
  skips devices saved with another key's id and reports them gone (410).
  Section R moves an endpoint saved by another member only with the same keys.
- **Realtime** carries `study_notices` for the bell (inserts and updates,
  filtered to the member). Supabase sends DELETE events of a published table
  (the primary key only) without row security, so anyone subscribed sees the
  ids and timing of deleted notices; the app does not subscribe to deletes,
  and nothing else leaks. Accepted for now (a broadcast topic per member would
  close it).

## Flags and switches

| Name | Where | Default | Effect |
|---|---|---|---|
| `VITE_STUDY_NOTIFY` | Vercel env, **Production only** | unset | the bell, the inbox and (when pushes are offered) the settings, the asks, the guide's step, the help row, the quiz box; needs section R 1 |
| `notify` | `study_private.features` | **off** (inserted) | pushes for everyone; off: only the users in `study_private.notify_pilot` |
| `notify_hooks` | `study_private.features` | on | creating notices at all |
| `study_private.notify_pilot` | table | empty | who gets pushes while `notify` is off |
| `STUDY_VAPID_PUBLIC`, `STUDY_VAPID_PRIVATE`, `STUDY_VAPID_SUBJECT` | Vercel env, **Production only** | unset | without them health says `"notify": false`: no settings, no worker; the inbox works |

Never put `VITE_STUDY_NOTIFY` or a VAPID key on Preview: Preview shares the
production database and is never the server's writer.

## Checks

- Unit: `shared/study/notifyCopy.test.ts`, `notifyRoute.test.ts`,
  `notifyQuiet.test.ts`, `bidiText.test.ts`, `b64url.test.ts`, `sw.test.ts`;
  `server/study/push.test.ts` (RFC 8291 Appendix A), `notify.test.ts`,
  `work.test.ts`, `health.test.ts`; `src/study/lib/notify.test.ts`,
  `notifyText.test.ts`, `guide.test.ts` (S10), `helpCopy.test.ts`,
  `route.test.ts`.
- SQL: `supabase/tests/study.sql` block R (R1-R25 for R 1, R30-R42 for R 2:
  each hook, the minute job's reminders, loaded twice, as an upgrade);
  `supabase/tests/notify-concurrency.sh` (a hook gives up on a lock).
- e2e (flag set `notify`): `e2e/study/notify.cjs` (the bell and the inbox),
  `notify-push.cjs` (the device's states, turning on, the settings, the real
  worker in Chromium, the account paths, the kill path), `notify-asks.cjs`
  (the asks, the guide's step, the quiz box, help); each with the flag-off
  build (set `i`).
- `npm run test:bundle` fails when R's static share passes 1,200 B or an R
  module but the slot is in the entry chunk.

## Real devices (Production, pilot users only, before the switch goes on)

| Device | Check |
|---|---|
| iPhone, iOS 26, from the home-screen icon | the first launch shows Today's card; turn on from it and from the settings; the sheet appears only after the tap; a quiz opened from a second pilot phone arrives within about 20 s, right to left, with the lecture's title, no quiz title, no names; a tap opens the lobby and the bell clears; "Don't Allow" → the blocked card's path matches Hebrew iOS Settings (screenshot; fix `OS.iosNotifications`/`OS.iosAllow`); removing the icon → the next send is 410 and the device is gone |
| iPhone, iOS 18.4-18.6 | the same; on a locally served build with the kill `sw.js`, a notification still shows (Declarative Web Push) |
| iPhone, iOS 16.4-17.x | the same through `sw.js` |
| iPhone in Safari, Chrome on iOS, Instagram | the install-first card; the in-app card and "פתיחה בספארי" |
| Android Chrome (tab, then installed), Samsung Internet | turn on in the tab; a push with the app closed; Chrome's settings path matches `OS.chrome*` |
| Desktop Chrome, Edge (Windows), Firefox, Safari 18.5 on macOS 15.5 | turn on; a click focuses an open tab and routes in it; the computer's line in the test toast |
| Two devices, one personal code | both receive; signing out on one stops only that one; signing in on a new device sends "נכנסו עם הקוד האישי" to the other, not to the new one, even after "ניתוק המכשירים האחרים" from the new one |
| iPhone, from the home-screen icon: Today's card | tapping "להפעיל התראות" on the card shows iOS's own permission sheet (the tap's first call is the question) |
| Android, the home-screen app, blocked | the blocked card's path (לחיצה ארוכה על האייקון ← פרטי האפליקציה ← התראות) matches the phone (screenshot) |
| One browser, two members | the second member signing in is not subscribed; the first member's pushes stop on that browser; the second turns them on with a tap |
| Quiet hours, Shabbat, limits | quiet hours over now: a "בשבילך" notice waits; a quiz stays in the inbox |
| A deploy while in use | the stale-chunk reload still works; `sw.js` updates (no-cache) |

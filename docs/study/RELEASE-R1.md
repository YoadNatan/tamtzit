# תמצית, notifications (section R at 2): Yoad's steps

The bell, the inbox and pushes: [`notify.md`](notify.md). Built on `dev` in
three slices; each release point below is a stopping place that works on
its own and rolls back on its own. Yoad's choices for it (on by default:
"עכשיו בקבוצה" and "בשבילך"; the daily reminder off at 19:30; a pilot with
the switch off first) are in [`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md).

> **From this `dev` (27 Nov 2026), the SQL step is parts 1 to 12 in order.**
> Uploaded sheets ([`RELEASE-O.md`](RELEASE-O.md)) edit earlier sections in
> place, so wherever this page says "run part 9", run `supabase/parts/1.sql`
> to `12.sql` in order instead, each to the end. That one run installs
> sections R, L and O together. Nothing new shows or spends until its own
> Vercel flag below; the switches start as the checks below list them. It was
> tested on a copy of production's schema
> (`eed179e`). The read-only checks below are unchanged.

## Rules for all of it

- **Production only.** Never put `VITE_STUDY_NOTIFY` or a `STUDY_VAPID_*`
  variable on Preview: Preview shares the production database and is never
  the server's writer.
- **The private key is never pasted** in a chat, an issue, a commit or a
  message to Claude. It lives in a password manager and in Vercel (marked
  Sensitive), nowhere else.
- Every step can be undone with the switches in "Stopping it" below.
- Section R needs the server writing set up (section W: pg_cron, pg_net and
  the Vault secrets `study_worker_key` and `study_site_url`), as it already is
  for the summaries. Without it the inbox works and nothing is pushed.
- **`study_site_url` must be the exact address members open** (the custom
  domain, not a `*.vercel.app` address): a push's link is built on the address
  the minute job posts to. On another origin the service worker opens its own
  home page instead (and drops the notice's mark), and Safari's Declarative
  Web Push opens the other address.

## What is in it

- **SQL section R at version 2** (part 9 of the SQL Editor's parts, after
  section I): the inbox, the devices, the settings, the kind registry, the
  hooks (a quiz or challenge opened, replies, a summary or past exam ready or
  stopped, the reading started, a credit asked, disputes, "עדכון", a
  correction waiting, a meeting set, a new summary), the minute job
  `study-notify` (the personal code's sign-in scan, the meeting in 15
  minutes, the study day in 30, the open question at 17:00, the daily
  reminder, the kick) and `study-notify-clean` at 03:41. The switch `notify`
  is inserted **off**, `notify_hooks` on. Safe to run again.
- **The app** (`VITE_STUDY_NOTIFY`): the bell and the inbox for everyone;
  when pushes are offered to the member, "שלי" → "הגדרות התראות", the asks,
  the guide's step "לקבל התראות", the quiz setup's "להודיע לקבוצה".
- **Pushes**: `/api/study/work {notify:true}` (no new function, the same
  server key), `public/sw.js` (push only, no cache), the VAPID keys.

## Release point 1: the bell and the inbox (no pushes, no keys)

1. **Supabase → SQL Editor: run `supabase/parts/9.sql`** (it holds sections I
   and R; safe to re-run), to the end. Then check, read only:
   ```sql
   select public.study_schema() -> 'R' as r;                                     -- 2
   select jobname, schedule from cron.job where jobname like 'study-notify%';     -- 2 rows: * * * * * and 41 3 * * *
   select name, enabled from study_private.features where name like 'notify%';    -- notify false, notify_hooks true
   select count(*) from study_private.notice_kinds;                               -- 25
   ```
   If a NOTICE says pg_cron or the server writing is off, the inbox still
   works; tell Claude before going on to release point 2.
2. **Vercel → Settings → Environment Variables → Production only:**
   `VITE_STUDY_NOTIFY` = `1`. Redeploy Production (Deployments → the latest →
   Redeploy).
3. **Check:** open the app. The bell is at the end of the top bar on היום,
   ספרייה, יחד and שלי; it opens "התראות" ("אין התראות חדשות…" at first).
   `https://<the app's address>/api/study/health` shows `"schemaOk": true` and
   `"notify": false` (no keys yet). When someone replies in a thread or a
   summary finishes, the bell counts it.

**Rolling back release point 1:** unset `VITE_STUDY_NOTIFY` and redeploy (the
bell goes; the tables stay and keep filling quietly). To stop the tables
filling too: `notify_hooks` off ("Stopping it").

## Release point 2: pushes for the pilot

4. **The keys, on your computer** (in the repository's folder):
   ```sh
   node tools/vapid-keys.mjs https://<the app's address>
   ```
   It prints three lines (`STUDY_VAPID_PUBLIC=…`, `STUDY_VAPID_PRIVATE=…`,
   `STUDY_VAPID_SUBJECT=…`) and writes nothing. Copy the private key into
   your password manager now.
5. **Vercel → Production only**, the three variables exactly as printed;
   mark `STUDY_VAPID_PRIVATE` as **Sensitive**. Redeploy Production. Check
   `/api/study/health`: `"notify": true`, a `"vapid"` value (the public key),
   `"notifyOn": false`, `"notifyStuck": false`.
6. **Supabase → SQL Editor, the pilot** (no names needed; your group's join
   code):
   ```sql
   insert into study_private.notify_pilot (user_id)
   select created_by from public.study_groups where join_code = '<your group code>'
   on conflict do nothing;
   ```
   For the "a quiz from another phone" check, add one trusted member too
   (ask them in WhatsApp first): their user id is in the members list
   (`select user_id, name from public.study_members where group_id = (select id from public.study_groups where join_code = '<code>');`),
   then `insert into study_private.notify_pilot (user_id) values ('<their id>') on conflict do nothing;`.
7. **On your phone, from the home-screen icon:** שלי → הגדרות התראות →
   "להפעיל התראות במכשיר הזה" → allow → "שליחת התראת ניסיון", lock the
   phone: "התראת ניסיון" arrives within about 10 seconds. Then the device
   checklist in [`notify.md`](notify.md) ("Real devices"), above all: a quiz
   opened from the second pilot phone arrives within about 20 seconds,
   right to left, with the lecture's title and no quiz title or names; and
   the Hebrew iOS Settings path on the "blocked" card (send Claude a
   screenshot if it differs).

**Rolling back release point 2:** delete the pilot's rows
(`delete from study_private.notify_pilot;`): nothing is pushed. Removing the
three Vercel variables and redeploying also removes the worker from every
device on its next open (the kill path).

## Release point 3: everyone

8. **Run part 9 again** only if `supabase/parts/9.sql` changed since release
   point 1 (Claude says so in the release's note); it is safe either way.
   `select public.study_schema() -> 'R';` → `2`.
9. **Turn sending on:**
   ```sql
   update study_private.features set enabled = true, changed_at = now() where name = 'notify';
   ```
   `/api/study/health` then shows `"notifyOn": true`.
10. **WhatsApp to the group:**
    > חדש בתמצית: התראות כשנפתח מבחן קבוצתי, כשעונים לכם וכשמה שהעליתם מוכן. באייפון קודם פותחים את תמצית מהאייקון במסך הבית. אחר כך: שלי ← הגדרות התראות ← להפעיל.

Members who open the app from the icon see Today's card once; the others
find it in "שלי", in the inbox's line and in help.

## Watching it (ready to paste; no names, no ids)

```sql
-- Sends in the last 7 days, by the push service's answer (mostly 201; a few 410 = removed icons)
select status, count(*) from study_private.push_log where at > now() - interval '7 days' group by 1 order by 2 desc;
-- What happened to each push in the last 7 days
select o.state, count(*) from study_private.notify_outbox o join public.study_notices n on n.id = o.notice_id
 where n.created_at > now() - interval '7 days' group by 1 order by 2 desc;
-- Devices and members with pushes on
select count(*) as devices, count(distinct user_id) as members from public.study_push_subs;
-- Is the sender stuck? (also "notifyStuck" in /api/study/health)
select kicks_since_claim, stuck_at from study_private.notify_kick;
```

A healthy week: mostly `201`, a few `410`, `stuck_at` empty.

## Stopping it

```sql
-- Stop sending (the inbox keeps working):
update study_private.features set enabled = false, changed_at = now() where name = 'notify';
-- Stop creating notices (every hook returns at its first line):
update study_private.features set enabled = false, changed_at = now() where name = 'notify_hooks';
-- Section R off entirely (the tables stay; run part 9 again to restore):
do $$ declare t record; begin
  for t in select tgname, tgrelid::regclass as rel from pg_trigger where tgname like 'study\_r\_%' and not tgisinternal loop
    execute format('drop trigger if exists %I on %s', t.tgname, t.rel);
  end loop;
  perform cron.unschedule(jobname) from cron.job where jobname in ('study-notify', 'study-notify-clean');
end $$;
```

Then unset `VITE_STUDY_NOTIFY` and redeploy.

**A broken `sw.js`** (pushes misbehave on devices): replace `public/sw.js`
with exactly these two lines, commit and deploy; `vercel.json` serves it with
`no-cache`, so each device removes the worker on its next visit:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
```

## If the VAPID private key leaks

1. Stop sending (`notify` off, above).
2. Make a new pair (`node tools/vapid-keys.mjs https://<the app's address>`),
   replace the three Production variables, redeploy.
3. Turn sending on again.
4. Nothing to ask of the members. Each device subscribes again by itself
   the next time the app opens there (within a day: the app asks health for
   the key at most daily). It compares the key its own subscription was made
   with to the new one, drops the old subscription and saves a new one. Until
   then the worker skips the devices saved with the old key's id and reports
   them gone, so section R deletes them, and the inbox has everything
   meanwhile. A device that never opens the app again stops getting pushes.

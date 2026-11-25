# The personal code

> "Like any app, keep their username and stay connected." Yoad, Nov 2026.

Since 25 Nov 2026 every member can have a **personal code**: 16 characters
(`K7QM-3XRP-W9TD-H4NA`) and a link that carries it
(`https://<app>/#k=K7QM3XRPW9TDH4NA`). The member keeps it, for example by
sending it to themselves on WhatsApp. Typing it or tapping the link on any
phone or browser brings back **the same member**: the same name, progress,
answers, cards and comments. There is no email and no password, and nothing
moves between users: the code signs the device in as the member's own
anonymous Supabase user.

It amends decision 1 of 17 Nov 2026 ([`DECISIONS-2026-11-17.md`](DECISIONS-2026-11-17.md)).
Owner steps: [`RELEASE-I1.md`](RELEASE-I1.md).

## What a member sees

- **Right after joining or opening a group:** "הקוד האישי שלך", with
  "שליחה לעצמי בוואטסאפ", "העתקה", "שיתוף" (where the browser has a share
  sheet) and "שמרתי, ממשיכים".
- **On the join screen:** "כבר בקבוצה? כניסה עם הקוד האישי" above the form
  (above the fold at 320×568), "name taken" worded for a returning member
  ("…זה השם שלך? נכנסים עם הקוד האישי. אחרת…") with "כניסה עם הקוד האישי"
  under it, and in the home-screen app a callout at the top instead of the
  link. The field takes the code in any case, with spaces or dashes, the
  whole link, or the whole WhatsApp message, and shows it as
  XXXX-XXXX-XXXX-XXXX once it reads as one. Six characters get a hint that
  this looks like the group's code. The tab is "יש לי קוד קבוצה"; a personal
  code pasted into the group's code field opens the code's panel with it.
- **The saved link (`#k=`):** on a device with no member, it signs in at once
  ("נכנסים עם הקוד האישי…", then "חזרה לקבוצה בתור …"). Where another member
  is signed in, it asks first; when that member has no code, the question
  says so ("לכניסה בשם … אין קוד אישי, ואי אפשר יהיה לחזור אליה.") and offers
  "יצירת קוד קודם". The code this device already holds (its own link, tapped
  to test it) only says "הכניסה כבר פעילה במכשיר הזה.". The fragment leaves
  the address bar as the app loads.
- **Every sign-in with the code ends with a fresh page** (`location.replace`):
  nothing of the member signed in before (the cards' outbox and its timer,
  channels) keeps running with the new member's session. The toast waits in
  sessionStorage across the reload. The device keeps the code it came in
  with, so "שלי" can show it again there.
- **"שלי" → "הקוד האישי":** create one; "הצגה" (only for a code made or
  entered on this device and not replaced since); "קוד חדש" (the old one
  stops working, devices already signed in stay signed in); "ניתוק המכשירים
  האחרים" (makes a new code first, then signs out every other device, so the
  old code cannot slip in between); "כניסה אחרונה עם הקוד: …" once it was used.
- **On the home (היום) and above the library:** a prompt for a member without
  a code ("אחר כך" hides it for 3 days), or the opener's notice.
- **The group's opener:** "קוד אישי חדש" beside each member, a confirm, then
  a sheet with the code to send privately ("הקוד מוצג רק עכשיו"). The
  member then sees "מי שפתחו את הקבוצה (…) יצרו לך קוד אישי חדש ב-…" until
  "הבנתי", with "הקוד הקודם כבר לא עובד." only when there was one, "הקוד
  החדש כבר שימש לכניסה ב-…" once it was used, and where to cut off other
  devices. The chip "יש קוד" shows who has one. Making the first code after
  joining never replaces a code the member already has.
- **"יציאה מהמכשיר הזה"** asks first, and says that coming back needs the
  code.

Help has a row "הקוד האישי", the guide a how-to "להיכנס מטלפון אחר", and the
tour's "שלי" line names the code. Everything here shows only when
`/api/study/health` says `"codes": true`.

## How it works

```
phone                      /api/study/code (Vercel)              Postgres (section I)        Supabase Auth
  │  POST {code}  ───────────▶ │
  │                            │ study_code_redeem(code, ip, key) ─▶ the code's user gets a random
  │                            │                                     address and a one-time password
  │                            │ ◀──────────────── {email, password} (3 minutes at most)
  │                            │ signInWithPassword ─────────────────────────────────────────▶ │
  │                            │ ◀───────────────────────────────────────────── a new session │
  │                            │ study_code_finish() as that session ▶ address and password removed,
  │                            │                                     still anonymous
  │ ◀── {access_token, refresh_token, expires_at, user_id}
  │ setSession(...)
```

- **SQL section I** (part 9; `supabase/study-schema.sql`): tables
  `study_private.member_codes` (one per user: the code's sha256 only, who made
  it, when it was seen and used), `code_tries` (for the limits; the address
  only as a sha256), `code_pending` (a user with one-time values right now, and
  what to put back), `code_log` (new, issued, redeemed, dropped). Functions
  `study_code_new`, `study_code_status`, `study_code_seen`, `study_code_issue`
  (the group's creator only), `study_code_finish` (members) and
  `study_code_redeem` (the anon role with the server key only). A pg_cron job
  `study-code-restore` runs every 5 minutes. `study_member_saved` now also
  counts a code (the chip).
- **`/api/study/code`** (`server/study/code.ts`): reads the address from
  `x-real-ip` (Vercel sets and overwrites it), calls the redeem with the
  existing server key (`STUDY_WORKER_KEY`), signs in with the one-time values
  itself, calls finish as the new session, and returns only the session. One
  more round when another device redeemed the same code at the same moment.
  A log line is the status and the error's code, never the body, the code or
  a token.
- **`/api/study/health`** says `"codes": true` when section I is loaded, the
  server key matches Vault's, the switch `codes` is not off, and Auth's email
  sign-in is on (its public settings).
- **The app**: `lib/personalCode.ts` (parsing, the link, this device's copy of
  the code, `codesOn()`), `lib/api.ts` (`redeemPersonalCode` and the RPCs),
  `features/account.tsx` (the identity slot) and `components/AccountCode.tsx`
  (the screens, loaded lazily).

No service-role key is needed and no Auth setting changes. Nothing in
Vercel changes either.

## Security model

- **The code**: 80 bits (16 characters from 32; a random byte mod 32 has no
  bias), stored only as `sha256('tamtzit-code-v1:' || code)`. It is never
  logged; the link carries it in the fragment, which browsers do not send to
  servers.
- **Guessing**: 10 wrong tries per address per 15 minutes and 1,000 in all
  per hour, on top of Auth's own limit: at most 24,000 tries a day against
  2^80 codes (about 1e-16 a year for one of 6 codes). The overall cap is only
  a backstop (a leaked server key could forge addresses); lower, a few
  addresses could lock every member out. `/api/study/code` takes only
  `application/json` (415 otherwise), so another site cannot spend the limit
  from its visitors' browsers with a preflight-free cross-site post. The
  address is stored as a sha256 keyed with the server key, kept a day.
- **The one-time sign-in**: a random undeliverable address
  (`c-<18 hex>@code.tamtzit.invalid`) and a 192-bit random password, bcrypt at
  cost 10, on one user, for about a second (3 minutes at most), never sent to
  a browser. Finish, every redeem, every status read and the 5-minute sweep
  put the user back, clear any email change asked for in between, and delete
  its one-time tokens.
- **No hijacking**: a code maps to exactly one user, and the browser never
  names a target user. `code_target_ok` allows only an anonymous, non-SSO
  study member with no address of its own (or only our synthetic one), so a
  user of another app in the shared project is never touched. Row Level
  Security is unchanged.
- **The opener can act as any member** (Yoad's choice: a lost code must be
  replaceable, and the opener sees the code they make). Mitigations: the
  member's notice names the opener, says when the new code was already used
  ("הקוד החדש כבר שימש לכניסה ב-…"), "שלי" shows the last use of every code,
  `issued_by` and `code_log` keep the record, and the member can answer with
  "ניתוק המכשירים האחרים". `study_code_issue` refuses a member who is also in
  a group the caller did not open (one group today; a guard for later).
- **A stolen code**: the opener makes a new code (or the member does), and the
  member uses "ניתוק המכשירים האחרים". A device signed out that way keeps an
  access token for up to an hour (the same gap `study_remove_member`
  accepts); `/api/study/*` refuses it at once, and so do the code functions:
  `study_code_new`, `study_code_issue` and `study_code_seen` need a session
  Auth still has (`auth.sessions`, the token's `session_id`), so that token
  cannot make a new code and undo the rotation.
- **The link and the message are a password.** The `#k=` link leaves the
  address bar at once, but a browser's own history database may still hold
  the visited URL; the code sits in plain text in the member's WhatsApp
  message and, after it was made or entered here, in this device's
  `localStorage` (`study-code:<user>`, beside the session's refresh token,
  removed when the member leaves the device).
- **"שליחה לעצמי בוואטסאפ" uses `https://wa.me/?text=…`** (accepted risk,
  review security 4): the code is in that URL's query string, so it can reach
  WhatsApp's own request logs when the page loads instead of handing off to
  the app (on iPhone and Android with WhatsApp installed, the link opens the
  app). Yoad asked for exactly this button; "שיתוף" (the system share sheet,
  where the browser has one) sends the same text without that URL.
- **A link to someone else's code** signs a device with no member in as that
  member without asking (the toast "חזרה לקבוצה בתור …" names them). Where a
  member is signed in, it asks first and warns when that member has no code.
- **Unsupported write**: section I writes `auth.users` directly (four columns
  of one study member for seconds). It checks at install that it may (and
  stops before creating anything if not), fails closed (nobody gets in), and
  has a switch.

## Failure modes (iPhone and in-app browsers)

- **The home-screen app has its own storage, and links never open in it.**
  On its first launch the code must be pasted there: the join screen's
  callout says so.
- **Safari deletes a site's storage after 7 days without a visit**, and a
  private tab loses it on close. The saved link or the code brings the member
  back. Each redeem is a new session of the same user, so several devices at
  once are fine.
- **WhatsApp's and Instagram's in-app browsers have their own storage.** The
  `#k=` link signs each one in on its own. Their clipboard or share sheet may
  be missing: copying falls back to selecting a field and `execCommand`, then
  to "אפשר לסמן את הקוד ולהעתיק."; "הדבקה" shows only where the clipboard can
  be read, and a failed paste suggests a long press; "שיתוף" only where there
  is a share sheet; WhatsApp is a plain link.
- **"Open in Safari" from an in-app browser loses the fragment** once the app
  has removed it, so the link has to be tapped again there.

## The switch

Off stops new codes and every redeem at once; sessions already signed in stay
as they are, and `/api/study/health` says `"codes": false`, so the screens
hide the code:

```sql
insert into study_private.features (name, enabled) values ('codes', false)
on conflict (name) do update set enabled = excluded.enabled, changed_at = now();
```

On again: the same with `true` (or delete the row: no row means on).

## Rescue SQL (Supabase → SQL Editor)

- **The opener lost their own code** (nobody can issue one for the opener):
  ```sql
  select study_private.code_set(user_id, user_id) from public.study_members where name = '<name>';
  ```
  It returns the new code to give them.
- **Who has a code, and what happened**:
  ```sql
  select m.name, c.created_at, c.issued_by, c.used_at, c.uses
    from public.study_members m left join study_private.member_codes c on c.user_id = m.user_id;
  select * from study_private.code_log order by at desc limit 50;
  ```
- **A user left with one-time values** (should never last more than 5
  minutes): `select study_private.code_restore();`

**Never delete anonymous users in Supabase's dashboard** (Authentication →
Users): they are the members. Deleting one deletes that member's code and
everything of theirs that cascades.

## For the ~6 members already in the group

No data moves. After part 9 and the deploy, each member's device shows the
prompt on the home (היום) and above the library; "יצירת הקוד" opens the sheet. The opener's member
list shows who has "יש קוד".

A member already split in two (say "דנה" with no device and "דנה 2"): the
opener uses "קוד אישי חדש" on "דנה" and sends it privately; Dana taps the
link, confirms the switch, and is the original "דנה" again with all of its
data; the opener then removes "דנה 2". What was done as "דנה 2" is not merged.

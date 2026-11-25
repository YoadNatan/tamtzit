# תמצית, the personal code (section I at 1): Yoad's steps

A member's personal code brings back the same member on any phone or
browser: [`personal-code.md`](personal-code.md). No Vercel variable changes,
no Auth setting changes, and no service-role key.

## What is in it

- **SQL section I at version 1** (part 9 of the SQL Editor's parts): the
  codes (hashed), the limits, the one-time sign-in and the sweep, the opener's
  new code, the switch `codes` (no row: on), and `study_member_saved`
  counting a code. It checks before creating anything that it may write the
  auth columns it needs; otherwise it stops with a line saying which.
- **`/api/study/code`**, the sixth of Hobby's 12 functions, and `"codes"` in
  `/api/study/health`.
- **The app**: the code after joining, the entry on the join screen and the
  `#k=` link, the card on "שלי", the opener's "קוד אישי חדש", the prompt for
  existing members, help, the guide. All hidden until health says
  `"codes": true`.

## Steps, in order

0. **Before anything (1 minute, read only).** In the Supabase SQL Editor:
   ```sql
   select r.rolbypassrls,
          has_column_privilege('auth.users','encrypted_password','UPDATE') pw,
          has_column_privilege('auth.users','email_change','UPDATE') ec,
          to_regprocedure('extensions.crypt(text,text)') is not null pgcrypto
     from pg_roles r where r.rolname = current_user;
   select tgname, pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal;
   ```
   And in Authentication → Sign In / Providers, check that **Email** is on
   (it is by default; email confirmation does not matter).
   - **Expected:** four `true`, and no UPDATE trigger from another app on
     `auth.users` (the board app's sign-up trigger is an INSERT trigger).
   - **If anything is false: stop** and tell Claude; the fallback design
     needs a service-role key instead.
1. **Before the merge:** run `supabase/parts/9.sql` once (parts 1 to 8 are
   unchanged; running them again is harmless as long as the run goes on
   through `9.sql`). Then `select study_schema()->'I';` returns `1`.
2. **Merge and deploy** `dev` as usual. No Vercel variable changes.
3. **Check** `https://<app>/api/study/health`: `"codes": true`.
4. **Smoke test**, on your own phone:
   - "שלי" → "יצירת קוד אישי" → "שליחה לעצמי בוואטסאפ".
   - Open the link from WhatsApp in a private tab: it lands as your name, with
     your progress.
   - Then try "ניתוק המכשירים האחרים": the private tab is signed out within
     the hour (at once for anything that calls the server).

## Rolling back

Turn codes off. Existing sessions are not touched, and the screens hide the
code once health says `"codes": false`:

```sql
insert into study_private.features (name, enabled) values ('codes', false)
on conflict (name) do update set enabled = excluded.enabled, changed_at = now();
```

The SQL can stay: nothing else reads it. Rescue queries (an opener who lost
their own code, who has a code, the log): [`personal-code.md`](personal-code.md).

## Not verified before this release

- **The hosted permissions**: step 0 settles them.
- **A live Auth run**: the password sign-in, the restore, a refresh and
  "others" sign-out were checked against Auth's source and auth-js 2.108.2,
  and the SQL against a local Postgres; step 4 is the first live run.

# Email sign-in for תמצית: research

Researched 2026-11-14. This is the prerequisite for the private self-study features (scores, mistakes, flashcards, plan): they need an identity that survives a new phone, a laptop or cleared storage. The repo was not changed. Proposed SQL and its tests are in `spec/research-auth-merge.sql`, `spec/research-auth-merge-test.sql` and `spec/research-auth-cleanup-test.sql`.

## 1. Recommendation

1. **Send a 6-digit code by email, never a link.** `/study/` runs as a standalone Home Screen web app (`study/index.html` L17 sets `apple-mobile-web-app-capable`). Apple says such apps have "separate cookies and storage from the browser", so a link opened from Mail would sign in Safari, not the app. Mail scanners can also use up one-time links before the person taps them. A typed code works everywhere: iPhone, Android and laptop.
2. **"Save the account" on the device that already joined.** Call `updateUser({ email })`, then `verifyOtp({ type: "email_change" })`. The user id stays the same, so no rows move. `is_anonymous` becomes false.
3. **"Sign in with email" everywhere else.** Call `signInWithOtp({ email, shouldCreateUser: false })`, then `verifyOtp({ type: "email" })`. If that device or browser already had an anonymous member (the duplicate "שוהם"), a **merge ticket** folds it into the account: the device takes the ticket before switching and the account redeems it right after.
4. **Sign out with `signOut({ scope: "local" })`.** Today `signOut()` uses the default scope, `global`, so with permanent accounts "יציאה" on one phone would sign the person out on every device.
5. **Requirements before shipping:** custom SMTP (the built-in sender cannot email the group), **Confirm Email ON**, and two Hebrew templates. No Claude calls, so there is no budget impact.

## 2. Client flow

**Entry points**
- In the library header, "יציאה" becomes **"חשבון"**, which opens a sheet.
- The Join screen gets a link: "כבר שמרת חשבון? כניסה עם מייל".
- Before the first private feature, a "שמירת החשבון" card appears that can be dismissed with "אחר כך". It is a nudge, not a gate: saving later loses nothing.
- Anonymous members get a library banner when another member has the same name.

**Screens (gender-neutral copy)**

| Screen | Copy |
|---|---|
| Sheet, anonymous | **החשבון שלך**. "הכניסה שמורה כרגע רק במכשיר הזה. שמירה עם מייל מאפשרת להיכנס גם מטלפון, ממחשב או מדפדפן אחר, ושומרת על הציונים וההתקדמות אם המכשיר מתאפס. אין סיסמה: בכל כניסה מגיע קוד למייל." Buttons: **שמירת החשבון עם מייל** · "כבר שמרתי חשבון במקום אחר" · "יציאה מהמכשיר" |
| Sheet, saved | "החשבון שמור עם {email}. במכשיר אחר נכנסים עם אותה כתובת." Buttons: **יציאה מהמכשיר הזה** · "יציאה מכל המכשירים" (scope `global`, for a lost phone) |
| Save: email | **שמירת החשבון**. Label "כתובת מייל" (`type=email`, `dir=ltr`). Help: "נשלח לשם קוד בן 6 ספרות. המייל משמש רק לכניסה ולא מוצג לקבוצה." Button **שליחת קוד** |
| Same-name hint | "יש בקבוצה עוד חשבון בשם {name}. אם הוא שלך ממכשיר אחר, עדיף להיכנס אליו." Buttons **כניסה לחשבון הקיים** · "לא אני" |
| Sign-in: email | **כניסה עם מייל**. "לחשבון שכבר נשמר במכשיר אחר." When this device has an anonymous membership, also: "מה שנעשה כאן יעבור לחשבון." Button **שליחת קוד** |
| Code (both flows) | **הקוד בדרך**. "שלחנו קוד ל-{email}. הקוד תקף לשעה." Field: `inputmode=numeric`, `autocomplete=one-time-code`, `dir=ltr`, 6 to 10 digits, submits by itself at 6. Button **אישור**. Links "שליחה מחדש" ("אפשר לשלוח שוב בעוד 0:45") · "תיקון המייל". "לא הגיע? כדאי לבדוק בתיקיית הספאם." |
| Done | Save: "החשבון נשמר. במכשיר אחר: ״כניסה עם מייל״ באותה כתובת." Sign-in: "הכניסה הצליחה." When merged, adds: "ההערות והסימונים מהמכשיר הזה עברו לחשבון." |
| Sign out, anonymous | **לצאת בלי לשמור?** "הכניסה במכשיר הזה לא שמורה. אחרי יציאה אי אפשר לחזור לחשבון הזה, וצריך להצטרף מחדש עם קוד הקבוצה." Buttons **שמירה עם מייל** · "יציאה בכל זאת" |

**Errors (by `error.code`)**

| Code | Copy |
|---|---|
| `otp_expired` (403) | "הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש." |
| `over_email_send_rate_limit` (429) | "אפשר לבקש קוד חדש בעוד דקה." |
| `over_request_rate_limit` (429) | "יותר מדי ניסיונות. כדאי לחכות כמה דקות." |
| `otp_disabled` (422, sign-in) | "לא נמצא חשבון שמור עם המייל הזה. קודם שומרים את החשבון במכשיר שבו כבר הצטרפת: חשבון ← שמירת החשבון עם מייל." |
| `email_exists` (422, save) | Switch to sign-in with merge: "המייל הזה כבר שמור בחשבון. נשלח קוד כדי להיכנס אליו, ומה שנעשה כאן יעבור אליו." |
| `email_address_invalid`, `validation_failed` | "כתובת המייל לא תקינה." |
| `email_address_not_authorized` | "שליחת המיילים עוד לא הוגדרה בשרת (SMTP ב-Supabase)." |

**API calls (new functions in `src/study/lib/api.ts`)**

```ts
// Save (same user id; nothing moves)
await sb.auth.updateUser({ email });                                   // "Change email address" mail
await sb.auth.verifyOtp({ email, token: code, type: "email_change" }); // new session, is_anonymous = false
await sb.auth.resend({ type: "email_change", email });                 // "שליחה מחדש"

// Sign in elsewhere (another device, or Safari tab vs Home Screen app)
await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }); // "Magic link or OTP" mail
const anon = (await sb.auth.getSession()).data.session?.user.is_anonymous;
const ticket = anon ? (await sb.rpc("study_merge_offer")).data as string : null; // before verify
localStorage.setItem("study-signin", JSON.stringify({ email, ticket, at: Date.now() }));
await sb.auth.verifyOtp({ email, token: code, type: "email" });       // replaces the anonymous session
if (ticket) await sb.rpc("study_merge_claim", { p_ticket: ticket });
localStorage.removeItem("study-signin"); location.reload();

// Sign out
await sb.auth.signOut({ scope: "local" });
```

Rules:
- Keep the pending step in localStorage, so the code screen comes back if iOS reloads the app while the person is in Mail.
- At start-up, a saved session plus a stored ticket means the claim did not finish: redeem it again. "ticket not found" means it already ran, so drop the ticket.
- Reload after a sign-in that changes the user id. supabase-js only swaps the Realtime token, while presence keys, `userId` props and the loaded groups still belong to the old id.
- A save needs no reload, because the id is unchanged.

## 3. SQL

`study_merge_offer()` runs only for an anonymous caller (`auth.jwt()->>'is_anonymous'`). It returns a 64-character secret and stores its SHA-256 for 30 minutes. `study_merge_claim(p_ticket)` runs only for a saved caller. It uses the ticket once, then in one transaction:
- deletes the anonymous member row where the account is already a member, and moves it otherwise;
- moves read marks, deleting duplicates per lecture;
- moves `study_comments.author_id`, `study_lectures.created_by` and `study_groups.created_by`.

The ticket table has RLS on and no grants, so only these definer functions touch it.

A rule for later features: every `study_` table with a user column references `auth.users`, and adds its line to `study_merge_claim`. Check M14 fails when one is missing. Each feature decides how to merge its own rows, for example keeping the newest card state.

**Never run the docs' clean-up** (`delete from auth.users where is_anonymous ... 30 days`) here. Every member is anonymous today, and `study_groups.created_by` cascades on delete, so it would delete the group and everything in it, and `/board`'s anonymous teacher too. A safe, optional variant deletes only anonymous `app='study'` users older than 30 days that own no `study_` rows. It is tested in `research-auth-cleanup-test.sql`.

## 4. Setup steps for Yoad

0. Check which project `/study/` uses: Vercel `VITE_STUDY_SUPABASE_URL` if set, otherwise the shared one. Make every change below there.
1. **Custom SMTP** (Authentication → SMTP). This is mandatory. The built-in sender delivers only to the Supabase organization's team addresses, at 2 emails per hour. Pick a provider Supabase lists (Resend, AWS SES, Postmark, SendGrid, ZeptoMail, Brevo) and verify a sending domain (SPF, DKIM, DMARC). Use the sender name "תמצית" and a `no-reply@` address.
2. **Rate limits:** after SMTP, emails start at 30 per hour, which is enough for six people.
3. **Sign In / Providers → Email:**
   - **Confirm Email ON.** If it is off, an anonymous `updateUser({ email })` attaches the address unchecked, so a typo locks the account.
   - Secure email change: leave on (it does not affect anonymous users).
   - Email OTP Expiration: 3600.
   - OTP length, if offered: 6.
   - Anonymous sign-ins stay on.
   - Manual linking is not needed.
4. **Email Templates** (code only, no `{{ .ConfirmationURL }}`):
   - *Magic link or OTP:* subject `קוד כניסה: {{ .Token }}`
   - *Change email address:* subject `קוד לשמירת החשבון: {{ .Token }}`
   - Body for both:
     ```html
     <div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
     <p>הקוד שלך לתמצית:</p>
     <p dir="ltr" style="font-size:30px;font-weight:bold;letter-spacing:4px;text-align:right">{{ .Token }}</p>
     <p>מקלידים אותו באפליקציה. הקוד תקף לשעה ולשימוש אחד.</p>
     <p>לא ביקשת קוד? אפשר להתעלם מהמייל.</p></div>
     ```
5. **URL Configuration:** set Site URL to `https://delo-logo-review.vercel.app/study/` (not the default `localhost:3000`). Codes pass no `redirectTo`, so the Redirect URLs list needs nothing; `…/study/**` is optional.
6. **Sessions:** leave "single session per user", the time-box and the inactivity timeout off. Otherwise a laptop sign-in could end the phone's session.
7. **SQL Editor:** re-run `study-schema.sql` with the merge section added.
8. **Privacy note (decision 13):** add the email provider. Addresses live only in Supabase Auth and are never shown to the group.
9. **Smoke test** with his own email, in the existing group. Never create a group. Save on the iPhone Home Screen app, sign in on a laptop, and check that there is one member. Sign out on the laptop and check that the phone stays signed in.

## 5. Testing

- **SQL (done here, on a throwaway local Postgres 16).** Loaded stubs, `board-schema.sql`, `study-schema.sql` twice, then the merge SQL twice, then the test. All 14 checks M1–M14 printed ok:
  - a 64-character ticket that the API cannot read;
  - an anonymous caller cannot redeem; a saved account cannot offer itself;
  - a wrong, used or 31-minute-old ticket is refused;
  - after the merge: one "שוהם", read marks deduplicated, the comment and the lecture moved, Noa untouched;
  - every user foreign key is covered.

  `supabase/tests/study.sql` still passes with the merge SQL loaded. The stubs need `auth.jwt()`, which the test file copies from Supabase's migration. The test databases were dropped.
- **E2E (Playwright, iPhone viewport, light and dark).** Extend the mock with `PUT /auth/v1/user`, `POST /auth/v1/{verify,otp,resend,logout}` and `/rest/v1/rpc/study_merge_{offer,claim}`. Errors use the body `{ "error_code", "msg" }`, which is what auth-js reads. Scenarios:
  1. Save: a wrong code shows the error, the right code shows the saved sheet.
  2. `email_exists` switches to sign-in.
  3. Device B, in this order: offer with the anonymous token → `/otp` with `create_user:false` → `/verify` with `type:email` → claim with the new token → reload → one "שוהם".
  4. A fresh device gets `otp_disabled` and its copy.
  5. Sign out calls `/logout?scope=local`; for an anonymous user the dialog comes first.
  6. A reload mid-flow restores the code screen.
  7. The code field's attributes and RTL.
- **Real device (Yoad, after SMTP):** step 9, plus Gmail and the university mail (check spam).

## 6. Evidence

supabase.com was blocked here, so each Supabase page was read from its source in github.com/supabase/supabase (`apps/docs/content/…`; numbers from `packages/shared-data/config.ts`). Links point to the rendered pages.

- [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous):
  - an anonymous user "can't access their account if they sign out, clear browsing data, or use another device";
  - anonymous users use the `authenticated` role, with an `is_anonymous` JWT claim;
  - convert with `updateUser({ email })` and "the 6-digit OTP";
  - conflicts with an existing account are resolved manually;
  - "Automatic cleanup … is currently not available", with the delete SQL;
  - the page says to enable manual linking; the server source below shows email linking does not need it.
- [Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless):
  - magic link and OTP "share an implementation", and `{{ .Token }}` in the Magic Link template sends a code;
  - `shouldCreateUser: false`, and `verifyOtp` with type `email`;
  - one request every 60 s, valid for 1 hour, and more than 86,400 s is discouraged.
- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates):
  - `{{ .Token }}` is "a 6-digit One-Time-Password";
  - `{{ .Email }}` is "Empty when trying to link an email address to an anonymous user";
  - "Email prefetching" can use up `{{ .ConfirmationURL }}`, so use the OTP.
- [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp):
  - without it, Auth "will refuse to deliver messages to addresses that are not part of the project's team";
  - 2 messages per hour, and 30 per hour once custom SMTP is set up;
  - the provider list, and the SPF/DKIM/DMARC advice.
- [Rate limits](https://supabase.com/docs/guides/auth/rate-limits): `/otp` and `/user` share 30 requests per 5 minutes per IP, `/verify` has 30 per 5 minutes, and OTP sends have a 60 s window per user.
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): change the Site URL from `http://localhost:3000`.
- [Sessions](https://supabase.com/docs/guides/auth/sessions): sessions are unlimited across devices by default, and single-session is opt-in.
- [General configuration](https://supabase.com/docs/guides/auth/general-configuration): Confirm Email, manual linking.
- Supabase Auth server, read from [github.com/supabase/auth](https://github.com/supabase/auth) `master` on 2026-11-14:
  - `internal/api/user.go` L134–139: an address already in use → `email_exists`. L252–273: anonymous with Confirm Email off → the email is attached without verification.
  - `internal/api/mail.go` L524–545 and `internal/mailer/templatemailer/templatemailer.go` L257–279: with no current email, one message goes to the new address, and its `{{ .Token }}` is that address's code. A 60 s per-user limit applies.
  - `internal/api/verify.go`:
    - L553–558: double confirmation happens only when there is a current email;
    - L621–623: `IsAnonymous = false`;
    - L279–286: a new session is issued.
  - `internal/models/user.go` L650–651: the email is marked confirmed.
  - `internal/api/otp.go` L82–83 and L211–235: `create_user:false` with an unknown address → `otp_disabled`.
  - `internal/api/api.go` L291–296: manual linking guards only `/user/identities`.
  - `internal/api/apierrors/errorcode.go`: the error codes used above.
  - `migrations/20220531120530_add_auth_jwt_function.up.sql`: the definition of `auth.jwt()`.
- Installed `@supabase/auth-js` 2.108.2:
  - `GoTrueClient.d.ts` (signOut docs): "the default `scope` is `'global'` … signs the user out of every device"; `GoTrueClient.js` L3326.
  - `verifyOtp` saves the new session and emits `SIGNED_IN` (L1961–1990).
  - `signInWithOtp` defaults `create_user` to true (L1772–1795).
  - `lib/fetch.js` L41–52: `error_code` is read from the response body.
- Installed `@supabase/supabase-js` 2.108.2: `dist/index.mjs` L846–855, where `SIGNED_IN` only calls `realtime.setAuth`.
- Apple, [What's new in web apps (WWDC23)](https://developer.apple.com/videos/play/wwdc2023/10120/):
  - on iOS, "Home Screen web apps have a standalone, app-like experience on iOS, with separate cookies and storage from the browser";
  - on Mac, "local storage is not copied when a web app is created", and a login in the default browser does not log in the web app.
- Apple, [Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html): "Set the apple-mobile-web-app-capable meta tag to yes to turn on standalone mode."
- MDN, [Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), read from github.com/mdn/content: with cross-site tracking prevention on, Safari deletes script-created data after seven days of browser use with no interaction. The anonymous session lives in localStorage (`api.ts` L20–25).
- MDN, [`autocomplete`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete): `one-time-code` covers codes received by "SMS, email, or authenticator application".
- Repo:
  - `study-schema.sql` L36–42: membership is the (group_id, user_id) key.
  - L31, L38, L64, L99 and L118: every user column cascades from `auth.users`.
  - L421–447: `/board`'s trigger (insert only, `board-schema.sql` L175–178) enrols every new auth user without `app='study'`. Hence `shouldCreateUser: false`.
  - "יציאה" calls `signOut()`, which signs out on every device: `StudyApp.tsx` L137–141 and `api.ts` L115–117.

## 7. Risks and open questions

- **A sending domain (open).** Does Yoad own a domain he can add DNS records to? `vercel.app` cannot be used. Without one, delivery to Gmail and university mail is doubtful.
- **Which Supabase project (open):** see step 0.
- **One phone can hold two identities.** The Safari tab and the Home Screen app have separate storage, which is why the copy says "מדפדפן אחר" and why the merge flow handles it.
- **Not verified on iOS:**
  - whether iOS offers email codes for AutoFill inside a Home Screen app;
  - whether the app reloads while Mail is open;
  - whether Home Screen apps are exempt from the 7-day eviction (webkit.org and bugs.webkit.org were unreachable).

  Check all three on a real iPhone.
- **Wrong email:** nothing is bound until the code is verified, and entering the address again replaces the pending one, but only while Confirm Email is ON.
- **Guessing codes:** 6 digits, valid for 1 hour, limited to 30 verifies per 5 minutes per IP. That is acceptable for six people. Shorten the expiry to 900 s if Yoad prefers.
- **A merge cannot be undone.** It only folds an anonymous identity into a saved one, and the person proves both sides.
- **Two saved accounts for one person** (two different emails) cannot be merged. The same-name hint steers people toward signing in instead.
- **Alternatives rejected:**
  - magic links (they land in Safari, and scanners use them up);
  - Google OAuth (needs manual linking and a Google console setup, and Apple says OAuth in web apps works "through heuristics");
  - SMS (paid);
  - passwords (friction).

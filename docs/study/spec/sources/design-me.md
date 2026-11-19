# תמצית: identity, private progress, the study plan and marathons (design)

**Scope.** Item 11 (email sign-in, so one person is one member across phone and laptop, before any private result ships) and item 7 (a private "ההתקדמות שלי" page, a study plan towards an exam date that adapts every day, and group study marathons, "מרתוני למידה", with a run-of-show that uses follow-the-reader and the live quiz). Scores, mistakes, weak points, reading progress and plans are visible only to their owner (Shoham: "יראו רק למשתמש הנוכחי"). Marathons and who is coming are visible to the group, because group learning is "the most essential part".

**Design only.** Nothing in the repo or in production was changed. No request went to `delo-logo-review.vercel.app` or to the real Supabase project, and no group or row was created anywhere real. Everything marked "tested" ran on local tools in this sandbox, and re-runs with `spec/me-proto/run-all.sh` (offline; every database is a throwaway one that is dropped).

**Built on** (read first; this design uses their names):

- `spec/research-auth.md` and its SQL: a 6-digit code by email, "save" (`updateUser` + `verifyOtp email_change`) and "sign in" (`signInWithOtp` + `verifyOtp email`), the merge ticket, `signOut({ scope: "local" })`, the Supabase settings. **One correction** is below.
- `spec/design-platform.md`: the app shell (four tabs; "שלי" and "יחד" skeletons with slots for this design), routes as query strings, the group channel `study-group-<id>`, the privacy note, the ledger.
- `spec/design-questions.md` §2.4: the private-results contract (`study_answers`, `study_my_mistakes`, …), the 17 aspect keys, the practice session routes.
- `spec/design-quiz.md`: quiz answers are copied into the owner's `study_answers` (mode `'quiz'`), `study_quiz_create` / `study_quiz_open` / `study_quiz_recent`, the `?v=quiz` routes.
- `spec/design-cards.md` §2.4: `study_my_card_counts`, `study_my_card_days`, `study_my_card_topics`, the study day that starts at 04:00 Israel time.

**Proven here** (all under `spec/me-proto/`)

| What | Result | Where |
|---|---|---|
| Block A (identity) on the repo's schema **alone**, loaded twice | **24 check lines, all as expected**: tickets, the merge, a "ghost" folded by hand, every user column covered, the safe clean-up preview. The repo's own `supabase/tests/study.sql` still gives **0 FAIL** | `sql/me-identity.sql`, `sql/me-identity-test.sql`, `run-identity.sh` |
| Block B (progress, plan, marathons) on top of the repo + platform + questions + quiz + cards SQL, everything loaded twice | **83 check lines, all as expected**, including exact weak-point scores, the 04:00 day boundary, RLS between members, the marathon state machine, and a merge across **every feature's 36 user columns** | `sql/me.sql`, `sql/me-test.sql`, `run-sql.sh` |
| The sibling designs still pass with these blocks loaded | repo `study.sql`, `questions-test.sql`, `quiz-test.sql`, `cards-test.sql`: **0 FAIL/ERROR lines each** | `run-sql.sh` |
| The plan, the marathon agenda, the study day, the copy | **64 checks pass** (tsc strict, Node 22), on the real antiparasitics summary's part sizes | `src/plan.ts`, `src/agenda.ts`, `src/day.ts`, `src/estimates.ts`, `test/run.ts` |
| The sign-in flow against the installed `@supabase/supabase-js` 2.108.2 and a local mock of Supabase Auth and PostgREST | **15 checks pass**: request order, which token each call carries, every documented error to its Hebrew copy, a lost claim redeemed at start-up, sign-out scopes | `src/account.ts`, `test/auth-contract.mjs` |

**A correction to research-auth.** Its "שליחה מחדש" for the save flow calls `auth.resend({ type: "email_change", email })`. Supabase Auth's `/resend` finds the user by its **current** email (`internal/api/resend.go`: `models.FindUserByEmailAndAudience(db, params.Email, aud)`, which is `LOWER(email) = ?` in `internal/models/user.go` L761-762). An anonymous member has no current email yet (the new one waits in `email_change`), so the call answers 200 and sends nothing. This design re-sends with `updateUser({ email })` again, which calls `sendEmailChange` every time (`internal/api/user.go`, the `params.Email != user.GetEmail()` branch). Read from github.com/supabase/auth `master` on 2026-11-15 (copy in `spec/_me-docs/auth-resend.go`).

**Not verified, said plainly**

- **Phones.** Nothing here ran on an iPhone or Android device: whether iOS offers the emailed code for AutoFill inside a Home Screen app, whether the app reloads while Mail is open (the design survives both), and how the date and time pickers look in Hebrew.
- **Supabase's hosted Auth and Realtime** were not called (no requests to the real project). Auth behaviour comes from its server source and docs (read by research-auth from GitHub; supabase.com is blocked here) and from the contract test's mock; Realtime behaviour from the Postgres Changes doc that design-platform fetched.
- **The SMTP provider** (price, deliverability to Gmail and the university's mail) was not checked; it is open question 1.
- **Reading and practice speeds** behind the plan's minutes are assumptions, except the summary's size (measured: 43,091 characters for 38 slides). The app replaces the reading speed with each member's own once three parts were timed.
- **The UI is not built**, so the Playwright run of §6.4 is a plan. The parts that could go wrong at the protocol level (the auth calls, the RPC shapes, the SQL) were tested.
- **The iCalendar file** for "add to calendar" was left out: rfc-editor.org and ietf.org are blocked here, so the format could not be checked (§5).

---

## Decisions at a glance

1. **Sign-in is a 6-digit code by email, never a link** (research-auth §1): a Home Screen app has its own storage, and mail scanners use up links. Decision 11 says "email-link"; the code is the same email sign-in and works inside the app.
2. **Two ways in, one person.** "שמירת החשבון" on the device that joined keeps its user id, so nothing moves. "כניסה עם מייל" anywhere else; a device that already joined anonymously folds into the account with a one-time merge ticket.
3. **One merge function for every feature.** `study_private.merge_users(src, dst)` (block A) carries every designed feature's lines behind "if its table exists", so it installs first and never needs a reorder. A test fails when any `study_` table has a user column it does not move (36 today). Yoad uses the same function from the SQL editor for "ghosts" (an anonymous member whose phone is gone).
4. **Nudge, don't gate.** Private features work for anonymous members (saving later keeps the same id, so nothing is lost); a "שמירת החשבון" card appears on every private screen until the account is saved, stronger after 50 answers. Shipping order still follows decision 11: identity first.
5. **Private by construction.** Reading progress, plans and plan ticks are rows only their owner can read (RLS), written only through functions, never published to Realtime. Every number on "ההתקדמות שלי" comes from `security invoker` SQL functions that take no user id: a member can only ever ask about themself.
6. **Weak points have one exact formula** (§2.4), from practice **and** live-quiz answers: the first answer to a question per study day, weighted by age (half after 21 days), smoothed toward 70% with two pseudo-answers, "חולשה" under 60% with at least two questions, "כדאי לרענן" under 75%. Tested to three decimals.
7. **The plan is a pure function** (`shared/study/plan.ts`), so phone and laptop show the same plan. It is computed from progress **as of 04:00 today** (or the last "לסדר מחדש את היום"), so today's list never reshuffles while the member works; live numbers tick tasks off. Each new day it is rebuilt from what was really done.
8. **The plan's shape:** reading, then practice a day later, mistakes first, at an even pace that ends the first pass about 15% early; the last 20% of study days (1-5) are review days for weak topics and a pass over every lecture. A lecture read in a marathon the member joined is not planned for solo reading. Overload is reported, never squeezed in.
9. **Marathons are group rows with a run-of-show.** Date, time, length, place, lectures, who is in (in / maybe / out), and an agenda of steps (read aloud with follow-the-reader, group quiz, break, open questions, free practice). Any member moves the current step; two taps at once move it once. A marathon nobody ended is over 3 hours after its planned end.
10. **No Claude, no Vercel function.** Nothing in this design calls Claude, so the monthly budget is untouched; everything runs as database functions called with the member's own token, as `study_join` is today. A plan task for a lecture without questions links to the questions design's generation sheet, which shows the cost.
11. **The study day starts at 04:00 Israel time** everywhere (as the cards design), so a 01:00 study session counts for the evening before.

---

## 1. User stories and UI flow

### 1.1 Stories

- I saved my account on my phone; on my laptop I type my email and a code, and I am the same "שוהם", with my comments, read marks, answers, cards and plan.
- I had joined on the laptop too, as a second "שוהם". After signing in there, the group sees one of me, and what I did on the laptop is mine.
- I lose my phone. On the new one I sign in with my email and nothing is lost. From the laptop I sign out of every device.
- On "ההתקדמות שלי" I see, and only I see: which lectures I read, my accuracy per course, lecture and topic, my mistakes to review, the cards due today, my weak points, and the last two weeks.
- I set my exam's date and what it covers, and get a plan for every day until then: what to read, what to practise, what to review. If I miss a day the plan catches up by itself; if I work ahead it gets lighter.
- Someone in the group sets a marathon for Thursday 18:00 on three lectures. Everyone answers whether they are in. On Thursday the marathon page says what we do now: read Antimalarials aloud (one reads, the others follow), a ten-question group quiz, a break, then the next lecture.
- When the marathon ends I see what the group covered and, only for me, how I did and which mistakes to review.

### 1.2 Where it lives

Routes are query strings on `/study/` (design-platform §1.E), so `vercel.json` needs nothing.

| Screen | URL | Tab bar | Notes |
|---|---|---|---|
| Account sheet (save, sign in, code) | a sheet over any screen | unchanged | Opened from "שלי", from Join, from the nudges and banners |
| My progress | `?v=progress` | שלי | M2. `&t=<topic key>` opens a topic's sheet |
| My plan | `?v=plan` | שלי | N2; `&edit=1` = setup (N1, tab bar hidden) |
| A marathon | `?v=marathon&m=<id>` | יחד | R3-R5 (one page: before, live, after) |
| New marathon / edit | `?v=marathon&new=1` · `&m=<id>&edit=1` | hidden | R2 |
| A lecture opened from a marathon step | `?l=<id>&at=<part>.0&mk=<marathon>&read=1` or `&follow=1` | hidden | LectureView starts reading aloud / following, and shows "→ למרתון" |
| Practice by topic, by one lecture's mistakes | `?v=practice&s=t.<topic key>` · `s=m.<lecture>` | hidden | Two session keys added to the questions design's list |

The platform's route table had marathons at `?v=plan&m=<id>`. They move to their own route under "יחד", because a marathon belongs to the group; `parseRoute` maps an old `?v=plan&m=` link to `?v=marathon&m=`.

**Entry points**

- **"שלי"** (platform skeleton): the account card first; then rows "ההתקדמות שלי", "טעויות לחזרה", "תוכנית למידה", each marked "גלוי רק לך".
- **"יחד"**: the card "מרתוני למידה" (the platform's slot 4).
- **The live banner** (platform shell): a marathon line (R6).
- **Join**: "כבר שמרת חשבון? כניסה עם מייל".
- **The library**: the one-time announcement and the same-name banner (anonymous members only).
- **Private screens** (progress, plan, practice hub, cards review): the account nudge while anonymous.

**Release order** (decision 11), three build flags, all off until switched on in Vercel:

1. `VITE_STUDY_ACCOUNT`: block A + the account sheet, Join link, "שלי" card. Ships **first**. Then the group moves to saved accounts (§1.8).
2. `VITE_STUDY_MARATHONS`: marathons. Shared data only, so it may ship any time after block B.
3. `VITE_STUDY_PROGRESS`: reading progress, "ההתקדמות שלי", the plan. With or after practice (`VITE_STUDY_PRACTICE`), which is where the numbers come from.

**If the platform shell has not landed yet:** the library header's "יציאה" becomes **"חשבון"** and opens the account card in a sheet (research-auth's original place); progress and plan are reached from a "שלי" button in the library header; marathons from a card above the courses. Nothing else changes.

### 1.3 Identity screens

Copy is gender-neutral: infinitives, nouns, plurals, and past-tense second person (written the same for everyone: "שמרת", "הצטרפת"). Email addresses and codes are wrapped in `<bdi dir="ltr">`. Every screen works in the real dark mode (tokens in `study.css`) and at 360 px wide.

**A1. The account card** (top of "שלי")

- Anonymous:
  - Title **"החשבון שלך"**.
  - **"הכניסה שמורה כרגע רק במכשיר הזה. שמירה עם מייל מאפשרת להיכנס גם מהמחשב או מטלפון אחר, ושומרת את ההתקדמות אם המכשיר מתאפס. אין סיסמה: בכל כניסה מגיע קוד למייל."**
  - Primary **"שמירת החשבון עם מייל"** (→ A2 save) · link **"כבר שמרתי חשבון במקום אחר"** (→ A2 sign-in) · ghost **"יציאה מהמכשיר"** (→ A5).
- Saved:
  - **"החשבון שמור עם shoham@gmail.com. במכשיר אחר נכנסים עם אותה כתובת."**
  - **"יציאה מהמכשיר הזה"** · link **"יציאה מכל המכשירים"** (for a lost phone; asks first: **"לצאת מהחשבון בכל המכשירים? בכל מכשיר צריך יהיה להיכנס שוב עם קוד מהמייל."** + **"יציאה מכל המכשירים"** · **"ביטול"**).

**A2. The account sheet, the address** (the existing `.sheet`, opened with the `{ studySheet: true }` history pattern so Back closes it)

- Save: title **"שמירת החשבון"**. Label **"כתובת מייל"** (`type="email"`, `dir="ltr"`, `autocomplete="email"`, `inputmode="email"`). Help: **"נשלח לשם קוד בן 6 ספרות. המייל משמש רק לכניסה ולא מוצג לקבוצה."** Button **"שליחת קוד"**.
- Sign in: title **"כניסה עם מייל"**. **"לחשבון שכבר נשמר במכשיר אחר."** On a device that joined anonymously, also: **"מה שנעשה במכשיר הזה (תגובות, סימונים, תשובות ותוכנית) יעבור לחשבון."**
- A save to an address that is already an account (`email_exists`) turns into a sign-in, with: **"המייל הזה כבר שמור בחשבון. שלחנו קוד כדי להיכנס אליו, ומה שנעשה כאן יעבור אליו."**

**A3. The code**

- Title **"הקוד בדרך"**. **"שלחנו קוד ל-shoham@gmail.com. הקוד תקף לשעה."**
- One field: `inputmode="numeric"` (MDN: "Numeric input keyboard, but only requires the digits 0–9"), `autocomplete="one-time-code"`, `dir="ltr"`, up to 10 characters; spaces and dashes are dropped; at 6 digits it submits by itself. `aria-label="הקוד מהמייל"`.
- Button **"אישור"** (busy: **"בודקים…"**).
- Links **"שליחה מחדש"** (for 60 s: **"אפשר לשלוח שוב בעוד 0:45"**) · **"תיקון המייל"** (back to A2).
- Muted: **"לא הגיע? כדאי לבדוק בתיקיית הספאם."**
- The step is kept in `localStorage` `study-signin` (`{ mode, email, at, ticket? }`), so if iOS reloads the app while the person is in Mail, the sheet opens again at the code (for up to an hour).

**A4. Done**

- Save: **"החשבון נשמר. במכשיר אחר: ״כניסה עם מייל״ באותה כתובת."** · **"סגירה"**. No reload: the user id did not change.
- Sign in: **"הכניסה הצליחה."**; after a merge also **"התגובות, הסימונים וההתקדמות מהמכשיר הזה עברו לחשבון."** The page reloads after 1.2 s (realtime-js and the loaded groups still belong to the old id; research-auth §2).

**A5. Signing out while anonymous**

- Title **"לצאת בלי לשמור?"** **"הכניסה במכשיר הזה לא שמורה. אחרי יציאה אי אפשר לחזור לחשבון הזה, וההתקדמות שלו תאבד. כדי לחזור לקבוצה צריך להצטרף מחדש עם קוד הקבוצה."**
- Primary **"שמירה עם מייל"** · danger **"יציאה בכל זאת"**.

**A6. The nudge** (top of progress, plan, practice hub and cards review, anonymous only)

- **"ההתקדמות שמורה כרגע רק במכשיר הזה."** After 50 recorded answers: **"יש כאן כבר 120 תשובות, שמורות רק במכשיר הזה."**
- **"שמירת החשבון"** · link **"אחר כך"** (hidden for 7 days on this device: `localStorage` `study-nudge-account`).

**A7. Same name** (library, anonymous only, when another member has the same name after trimming)

- **"יש בקבוצה עוד חשבון בשם שוהם. אם הוא שלך ממכשיר אחר, עדיף להיכנס אליו."**
- **"כניסה לחשבון הקיים"** (→ A2 sign-in) · **"לא אני"** (hidden for good for that other member: `study-not-me:<user id>`).

**A8. The announcement** (library, anonymous only, once per device: `study-announce-account-v1`)

- **"חדש: אפשר לשמור את החשבון עם מייל, להיכנס גם מהמחשב, ולשמור על ההתקדמות בטלפון חדש."** · **"לשמירה"** · **"סגירה"**.

**A9. Join** gains one link under the form: **"כבר שמרת חשבון? כניסה עם מייל"** (→ A2 sign-in, no merge: the device has no member). After the code, the account's group opens; no join code is needed.

**Errors** (by `error.code`; `src/study/lib/account.ts` `authErrorText`, tested)

| Code | Copy |
|---|---|
| `otp_expired` | "הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש." |
| (fewer than 6 digits) | "הקוד הוא 6 ספרות." |
| `over_email_send_rate_limit` | "אפשר לבקש קוד חדש בעוד דקה." |
| `over_request_rate_limit` | "יותר מדי ניסיונות. כדאי לחכות כמה דקות." |
| `otp_disabled` (sign-in to an address nobody saved) | "לא נמצא חשבון שמור עם המייל הזה. קודם שומרים את החשבון במכשיר שבו כבר הצטרפת: שלי ← שמירת החשבון עם מייל." |
| `email_address_invalid`, `validation_failed` | "כתובת המייל לא תקינה." |
| `email_address_not_authorized` | "שליחת המיילים עוד לא הוגדרה בשרת (SMTP ב-Supabase)." |
| `session_not_found` during a save | "הכניסה במכשיר הזה פגה. צריך להצטרף מחדש עם קוד הקבוצה." |
| anything else | "משהו השתבש. כדאי לבדוק את החיבור ולנסות שוב." |

### 1.4 "ההתקדמות שלי"

**M1. Rows in "שלי"** (under the account card), each with a small lock and **"גלוי רק לך"**:

- **"ההתקדמות שלי"**, meta **"השבוע: 86 שאלות · 12 חלקים · רצף של 5 ימים"** → `?v=progress`.
- **"טעויות לחזרה"**, meta **"12 שאלות"** → `?v=practice&s=m` (the questions design's P8).
- **"תוכנית למידה"**, meta **"מבחן פתוגן מאכסן בעוד 24 ימים · היום 2 מתוך 5"**, or **"אין עדיין תוכנית. בוחרים תאריך מבחן ומקבלים תוכנית יומית."** → `?v=plan`.

**M2. The page** (`?v=progress`)

- Back **"→ שלי"**; title **"ההתקדמות שלי"**; muted line with a lock: **"גלוי רק לך. הקבוצה רואה רק את סימוני ״קראתי״."**
- The account nudge (A6) while anonymous.
- With an active plan, a strip: **"מבחן פתוגן מאכסן בעוד 24 ימים · היום: 2 מתוך 5 משימות"** · **"לתוכנית"**.
- **"השבוע"**: three tiles, each a big number and a label under it (text, never colour alone):
  - **"86"** **"שאלות"**, under it **"74% נכונות"**;
  - **"240"** **"כרטיסיות"** (only while in-app review is on);
  - **"12"** **"חלקים נקראו"**.
- **"14 הימים האחרונים"**: one small column a day (height by minutes studied: practice + reading + cards), the day's letter under it, today outlined. Each column is a `<li>` with `aria-label="ג׳ 11.11: 24 שאלות, 2 חלקים, 40 כרטיסיות"`; an empty day is a dot. Under it **"רצף: 5 ימים"** (consecutive study days with any activity; today counts once it has some). Colours: `var(--accent)` for activity, `var(--line)` for none, both tokens already in both themes.
- **"לחזור עכשיו"**:
  - **"טעויות לחזרה · 12"** · **"לחזור על הטעויות"** (→ `?v=practice&s=m`). None: **"אין טעויות פתוחות."**
  - **"כרטיסיות להיום · 42"** · **"לחזרה"** (→ `?v=cards&s=today`), only while in-app review is on.
- **"נקודות חולשה"**: up to five, weakest first (status "weak" before "watch"). A row:
  - the topic in English (`<bdi>`) and a chip **"חולשה"** (warn colour) or **"כדאי לרענן"** (muted);
  - **"2 מתוך 3 שאלות נכונות כרגע · בעיקר: התוויות נגד"** (items − wrong_now of items; the worst aspect's Hebrew name, §2.4);
  - when flashcards are on and `study_my_card_topics` shows `again_30d >= 2` for the topic: **"גם בכרטיסיות: נשכחו 3 פעמים החודש"**;
  - actions **"תרגול על הנושא"** (→ `?v=practice&s=t.primaquine&n=10`) · **"לקריאה בסיכום (ש׳ 21)"** (→ `?l=<lecture>&slide=21`, the most-missed slide).
  - None yet: **"עוד אין מספיק תשובות כדי לזהות נקודות חולשה. נושא נבדק אחרי לפחות שתי שאלות שונות עליו."**
  - Link **"כל הנושאים"** (→ M3) and `<details>` **"איך זה מחושב?"**: **"כל תשובה שלך, בתרגול ובמבחן הקבוצתי, נספרת לנושא של השאלה: התרופה, האורגניזם, המחלה או התהליך. כשעונים על אותה שאלה כמה פעמים באותו יום, נספרת רק הפעם הראשונה. תשובות ישנות שוקלות פחות: תשובה מלפני שלושה שבועות שוקלת חצי. נושא מסומן ״חולשה״ כשיש בו לפחות שתי שאלות שונות והציון המשוקלל נמוך מ-60%, ו״כדאי לרענן״ כשהוא נמוך מ-75%. בנושא עם מעט תשובות הציון מתחיל קרוב ל-70%, כדי שטעות אחת לא תסמן אותו."**
- **"לפי קורס"**: a card per course, in the library's order:
  - header **"פתוגן מאכסן"**; **"נקראו 7 מתוך 12 הרצאות · תורגלו 140 מתוך 210 שאלות · נכונות כרגע 78%"**; a thin bar for the share read (`role="meter"`, `aria-valuenow`);
  - expanded (tap), a row per lecture: the title; **"✓ נקראה"** or **"נקראו 3 מתוך 8 חלקים"** or **"עוד לא נקראה"**; **"תרגול: 12 מתוך 15 · 75% נכונות · 3 טעויות"** or **"אין עדיין שאלות"**; **"כרטיסיות: 20 לחזרה"**; buttons **"לסיכום"** (resumes at the saved place) · **"לתרגול"**.
  - Small print once: **"נכונות כרגע: לפי התשובה האחרונה לכל שאלה. בפעם הראשונה: לפי התשובה הראשונה."** The lecture row's details show **"בפעם הראשונה: 60%"**.
- Loading: **"טוען…"**; a failed load: **"ההתקדמות לא נטענה. כדאי לבדוק את החיבור ולנסות שוב."** with **"לנסות שוב"**. Each block loads on its own, so a missing feature (flashcards off) only hides its block.

**M3. "כל הנושאים"** (a sheet; `?v=progress&t=<key>` opens it at one topic)

- A field **"חיפוש נושא"** (`dir="auto"`); rows sorted weakest first: the topic, its chip (none for "ok"), **"5 מתוך 7"**, the lectures it comes from, and **"מעט נתונים"** under two questions. A row opens the same two actions as M2.

**Aspect names** (the questions design's 17 keys, named like the summary's field lead-ins): `mechanism` מנגנון פעולה · `uses` שימושים · `pk` פרמקוקינטיקה · `adverse` תופעות לוואי · `contra` התוויות נגד וזהירות · `interactions` אינטראקציות · `resistance` עמידות · `dosing` מתן ומינון · `classification` סיווג ומורפולוגיה · `epidemiology` אפידמיולוגיה והעברה · `lifecycle` מחזור החיים · `pathogenesis` פתוגנזה · `clinical` תמונה קלינית · `diagnosis` אבחנה · `treatment` טיפול · `prevention` מניעה · `other` כללי.

### 1.5 The study plan

**N1. Setup** (`?v=plan&edit=1`, or the empty page's button; tab bar hidden)

- Back **"→ חזרה"**; title **"תוכנית למבחן"** (editing: **"עריכת התוכנית"**).
- **"שם המבחן"**, placeholder **"למשל: מבחן סוף בלוק פתוגן מאכסן"**.
- **"תאריך המבחן"**: `<input type="date">`, `min` = tomorrow, `max` = a year on. (MDN: the value "is always formatted `yyyy-mm-dd`" whatever the phone shows.)
- **"מה נכנס למבחן"**: a checkbox per course, **"פתוגן מאכסן · 12 הרצאות"**, with **"כל ההרצאות של הקורס, גם אלה שיעלו בהמשך"**. Expanding a course lists its lectures; unticking one leaves it out. **"להוסיף הרצאה מקורס אחר"** opens the other courses' lectures.
- **"כמה זמן ביום"**: chips **"שעה · שעתיים · 3 שעות · 4 שעות · 5 שעות"** and **"אחר"** (minutes, 15-720).
- **"ימים בלי למידה"**: chips **א׳ ב׳ ג׳ ד׳ ה׳ ו׳ ש׳**, toggled (`aria-pressed`).
- A switch **"חזרה מסכמת בימים האחרונים"**, under it **"הימים האחרונים לפני המבחן נשמרים לחזרה על כל החומר ועל נקודות החולשה."** (on by default).
- A live preview (the planner runs on the phone as the fields change):
  - fits: **"יוצאים 15 ימי למידה, מהם 3 לחזרה · כ-6 שעות עבודה · הכול נכנס, עם כמה ימים פנויים לפני החזרה."**
  - does not: **"לא הכול נכנס: חסרות כ-6 שעות. אפשר להוסיף זמן ביום או להוציא הרצאות."**
- Primary **"יצירת התוכנית"** (editing: **"שמירת השינויים"**); muted **"התוכנית גלויה רק לך."**
- Errors: `bad date` → **"תאריך המבחן צריך להיות אחרי היום."**; `bad title` → **"מה שם המבחן?"**; `lecture not found` → **"אחת ההרצאות כבר לא קיימת. כדאי לרענן."**; others → **"התוכנית לא נשמרה. אפשר לנסות שוב."**

**N2. The plan** (`?v=plan`)

- Back **"→ שלי"**; title = the exam's name; **"המבחן ביום א׳ 6.12 · בעוד 21 ימים · 15 ימי למידה"**.
- A status line:
  - **"בקצב הזה הקריאה והתרגול מסתיימים עד ד׳ 25.11, ונשארים 3 ימים לחזרה."**
  - or a warn box **"לא הכול נכנס עד המבחן: חסרות כ-6 שעות."** · **"להוסיף זמן ביום"** (→ N1) · **"מה לא נכנס"** (opens the list).
- **"היום · א׳ 15.11"**, one row per task. A row is a checkbox (tick by hand; `role="checkbox"`), the label, a muted line (minutes and progress), and one button:

| Task | Label | Muted line | Button → |
|---|---|---|---|
| read | **"קריאה · Antimalarials · חלקים 1-5"** | **"כ-35 דק׳ · 2 מתוך 5 חלקים"** | **"לקריאה"** → `?l=<id>&at=<from>.0` |
| practice | **"תרגול · Anthelmintics · 15 שאלות"** | **"כ-24 דק׳ · 6 מתוך 15"** | **"לתרגול"** → `?v=practice&s=l.<id>&n=10`, `20` or `all`: the smallest of the questions design's sizes that covers the count |
| generate | **"שאלות תרגול · Leishmaniasis"** | **"עוד אין שאלות להרצאה. יוצרים אותן פעם אחת לכל הקבוצה, מהתקציב הקבוצתי."** | **"ליצירה"** → `?v=practice&l=<id>` (the generation sheet shows the cost) |
| mistakes | **"טעויות לחזרה · Antimalarials · 4"** | **"כ-6 דק׳ · תוקנו 1 מתוך 4"** | **"לחזרה"** → `?v=practice&s=m.<id>` |
| cards | **"כרטיסיות · 42 לחזרה"** | **"כ-6 דק׳"** | **"לחזרה"** → `?v=cards&s=today` |
| marathon | **"מרתון · מרתון לפני המבחן · 18:00-22:00"** | **"עם הקבוצה · Antimalarials, Anthelmintics"** | **"למרתון"** → `?v=marathon&m=<id>` |
| weak | **"נקודת חולשה · Primaquine"** | **"כ-10 דק׳ · תרגול על הנושא וקריאה בשקפים"** | **"לתרגול"** → `?v=practice&s=t.<key>&n=10` |
| review | **"חזרה מסכמת · Antimalarials"** | **"כ-10 דק׳ · לעבור על הסיכום ועל תיבות ״שימו לב״"** | **"לסיכום"** → `?l=<id>` |

  - Part numbers are shown from 1 (the data counts from 0).
  - A ticked read task also marks its parts read (`study_mark_parts`), so tomorrow's plan does not bring them back; unticking undoes both. A tick on any other task only records the tick for today (`study_plan_checks`).
  - Footer: **"הושלמו 2 מתוך 5 · נשארו כ-50 דק׳"**. All done: **"המשימות של היום הושלמו."** and **"אפשר להתקדם:"** with the next study day's first two tasks.
  - A day off: **"היום יום חופש לפי התוכנית."** · **"בכל זאת ללמוד היום"** (shows the next study day's tasks as "אפשר להתקדם").
  - A buffer day with nothing new: **"אין משימות חדשות להיום. זמן טוב לטעויות או לכרטיסיות."**
- **"הימים הבאים"**: a row a day, collapsed: **"ב׳ 16.11 · כ-35 דק׳ · קריאה: Antimalarials · תרגול: Anthelmintics"**; days off **"ו׳ 20.11 · יום חופש"**; chips **"חזרה"** and **"מרתון"**. A tap shows the day's tasks (read-only).
- **"מה לא נכנס"** (only with a shortfall): the unscheduled tasks, as labels.
- Actions: **"עריכת התוכנית"** · **"לסדר מחדש את היום"** (asks **"לבנות מחדש את הרשימה של היום לפי מה שכבר נעשה?"**) · **"סיום התוכנית"** (asks **"לסיים את התוכנית? היא תעבור לארכיון."**).
- `<details>` **"איך התוכנית נבנית?"**: **"התוכנית מחלקת את מה שנשאר עד המבחן לימי הלמידה בקצב קבוע, ומסיימת את הקריאה והתרגול כמה ימים לפני הסוף. הימים האחרונים נשמרים לחזרה על נקודות החולשה ועל כל הרצאה. תרגול על הרצאה מגיע יום אחרי הקריאה שלה, וטעויות פתוחות באות ראשונות. כל בוקר, מ-04:00, התוכנית נבנית מחדש לפי מה שכבר נעשה: מה שלא הספקת עובר קדימה, ומה שנעשה מראש יורד. הרצאה שקוראים במרתון עם הקבוצה לא מופיעה לקריאה לבד. זמן הקריאה מותאם לקצב הקריאה שלך אחרי כמה חלקים."**

**N3. No plan**: **"אין עדיין תוכנית למידה."** **"בוחרים תאריך מבחן ומה נכנס אליו, ומקבלים תוכנית יומית: קריאה, תרגול וחזרה, שמתעדכנת לפי מה שכבר נעשה."** · **"יצירת תוכנית"**. Below, the archive: **"תוכניות קודמות: מבחן פתוגן מאכסן · 6.12"**.

**N4. After the exam** (the plan is still active and its date passed): **"המבחן היה ב-6.12."** · **"תוכנית למבחן הבא"** (archives this one and opens N1).

### 1.6 Marathons

**R1. "מרתוני למידה"** (a card in "יחד")

- The next marathon (or the live one):
  - **"מרתון לפני המבחן"**; **"ה׳ 19.11 · 18:00-22:00 · ספרייה, קומה 2"**; **"Antimalarials · Anthelmintics"**;
  - **"בפנים: שוהם, נועה, יעל · אולי: דנה · לא הפעם: עדי"** (names from the member list);
  - three buttons **"אני בפנים"** · **"אולי"** · **"לא הפעם"** (`aria-pressed` on the caller's answer);
  - **"לפרטים"**.
  - Live: a chip **"עכשיו"**, **"שלב 3 מתוך 9: קריאה בקול · Antimalarials"**, primary **"להצטרף"**.
- Further upcoming marathons as one-line rows.
- **"מרתון חדש"**.
- **"מרתונים קודמים"** (the last three): **"Antimalarials · 13.11 · 3 הרצאות · הקבוצה ענתה נכון על 72%"** (group quizzes held during it, from `study_quiz_recent`).
- None: **"עוד אין מרתונים. קובעים ערב למידה ארוך עם הקבוצה: תאריך, שעה, אילו הרצאות ומי בפנים."** · **"מרתון חדש"**.

**R2. New or edit** (`?v=marathon&new=1` · `&m=<id>&edit=1`)

- Title **"מרתון למידה חדש"** / **"עריכת המרתון"**.
- **"שם"**, placeholder **"למשל: מרתון לפני המבחן"**.
- **"תאריך"** (`type="date"`) · **"שעת התחלה"** (`type="time"`, `step="900"`; MDN: the value "is always a 24-hour `HH:mm`") · **"כמה זמן"**: chips **"2 שעות · 3 · 4 · 5 · 6"**.
- **"איפה (לא חובה)"**, placeholder **"ספרייה, זום, אצל נועה"**.
- **"אילו הרצאות"**: by course, a checkbox each, meta **"קריאה בקול כ-82 דק׳ · 15 שאלות"** or **"אין עדיין שאלות"**.
- **"מבחן קבוצתי אחרי כל הרצאה"** (switch) with **"כמה שאלות: 5 · 10 · 15"** and **"קבוצתי · תחרותי"**.
- **"הפסקה כל 60 · 90 · 120 דק׳"** and **"אורך הפסקה 10 · 15 · 20 דק׳"**.
- **"סדר היום"**: built from the choices (§4.4) and editable. A row per step with its start time: **"18:05 · קריאה בקול · Antimalarials · חלקים 1-4 · 32 דק׳"**. Per row: **"−5"** / **"+5"** minutes, **"למעלה"** / **"למטה"**, **"✕"**; under the list **"להוסיף: הפסקה · תרגול חופשי · שאלות פתוחות"**. Changing a choice above rebuilds the list only after **"לבנות מחדש את סדר היום?"**, so edits are not lost silently.
- The fit line: **"סדר היום: 4:20 שעות, 20 דק׳ יותר מהזמן שנקבע."** or **"נשארות 25 דק׳ לתרגול חופשי."**
- **"הערה לקבוצה (לא חובה)"** (500 characters).
- Primary **"קביעת המרתון"** / **"שמירת השינויים"**. Then a sheet **"המרתון נקבע. לשתף בקבוצת הוואטסאפ?"** · **"שיתוף"** · **"לא עכשיו"**. The text: **"מרתון למידה: מרתון לפני המבחן · ה׳ 19.11 ב-18:00 · Antimalarials, Anthelmintics · מצטרפים כאן: https://…/study/?v=marathon&m=…"** (`navigator.share({ text })`, else the clipboard, as the library's invite does; MDN: share needs a user gesture, which the button is).
- Errors: `conflict` → **"מישהו אחר שינה את המרתון בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב."**; `bad time` → **"מועד המרתון כבר עבר."**; `bad agenda` → **"משהו בסדר היום לא תקין. כדאי לבנות אותו מחדש."**; `marathon over` → **"המרתון כבר הסתיים."**

**R3. Before it starts** (`?v=marathon&m=<id>`)

- Back **"→ יחד"**; the title; **"ה׳ 19.11 · 18:00-22:00 · ספרייה, קומה 2"**; the note; muted **"נקבע ע״י שוהם · עודכן ע״י נועה"**.
- **"מי בפנים"**: the three groups of names, and the caller's three buttons.
- **"סדר היום"** with times.
- **"שיתוף"** · **"עריכה"** · in a menu **"ביטול המרתון"** (asks **"לבטל את המרתון לכל הקבוצה?"**; then a toast **"המרתון בוטל."** with **"ביטול"**, which brings it back).
- From an hour before the start: primary **"להתחיל את המרתון"** (also in the menu earlier: **"להתחיל עכשיו"**).

**R4. Live** (the same URL once a step is on)

- A sticky top: **"מרתון עכשיו · שלב 3 מתוך 9"**, a thin progress bar, and **"מאחרים ב-12 דק׳ לעומת התוכנית"** · **"לפי התוכנית"** · **"מקדימים ב-5 דק׳"** (§4.4, `lateBy`).
- The current step, as a large card:
  - **read**: **"קריאה בקול · Antimalarials · חלקים 1-4"**, **"כ-32 דק׳ · התחיל ב-18:12"**. When someone is reading aloud in that lecture (the platform's group channel): **"הקראה: נועה"**. Buttons **"להקריא לקבוצה"** (→ `?l=<id>&at=<from>.0&mk=<m>&read=1`) · **"לעקוב אחרי ההקראה"** (→ `…&follow=1`).
  - **quiz**: **"מבחן קבוצתי · Antimalarials · 10 שאלות"**. A quiz open in the group (`study_quiz_open`): **"המבחן פתוח · בפנים: שוהם, נועה +3"** · **"להצטרף"**. Otherwise **"לפתוח את המבחן"**: `study_quiz_create(group, mode, [lecture], n, 60)` → `?v=quiz&q=<id>&mk=<m>`; `quiz open` (someone was faster) → join that one. A lecture without questions: **"אין עדיין שאלות להרצאה."** · **"ליצירת שאלות"** (→ the questions design's P2, which shows the cost).
  - **break**: **"הפסקה עד 19:40"** and **"נשארו 8 דק׳"**.
  - **questions**: **"שאלות פתוחות בהרצאות של המרתון"**, the list (platform's `groupQuestions`, filtered to the marathon's lectures); a tap opens the paragraph (`?l=<id>&at=<part>.<anchor>&mk=<m>`). None: **"אין שאלות פתוחות."**
  - **free**: **"תרגול חופשי"** and a chip per lecture **"תרגול: Antimalarials"**, plus **"כרטיסיות"**.
  - **intro**: **"פתיחה: עוברים יחד על סדר היום."** **wrap**: R5's summary.
- Primary **"לשלב הבא"** (last step: **"סיום המרתון"**) · **"לשלב הקודם"**.
- The agenda, with **"עכשיו"** on the current step and ✓ on finished ones. A tap on another step asks **"לעבור לשלב הזה?"**.
- Someone else moved the step a moment earlier (`study_marathon_step` returned another step): toast **"השלב כבר התקדם בטלפון של נועה."** (the quiz design's "בטלפון של" pattern; the name comes from `updated_by`).

**R5. After** (state ended, or 3 hours past the planned end)

- **"המרתון הסתיים · ה׳ 19.11"**.
- **"עברנו על 3 הרצאות · 2 מבחנים קבוצתיים · הקבוצה ענתה נכון על 72%"**.
- A card **"גלוי רק לך"**: **"שלך במבחנים של המרתון: 18 מתוך 25 נכונות · 4 טעויות חדשות"** · **"לחזור על הטעויות"**. The first numbers are the caller's `my_correct` / `my_answered` from `study_quiz_recent` for the quizzes that ended between `started_at` and `ended_at` on the marathon's lectures; "טעויות חדשות" is the rise in `wrong_now` of the marathon's lectures between `study_my_lectures(group, started_at)` and `study_my_lectures(group, ended_at)`. **"לסמן כנקרא:"** each marathon lecture the caller has not marked, with **"סימון שקראתי"** (the existing group read mark).
- **"מרתון חדש"**.

**R6. The banner** (the platform's `LiveBanner`; priority: a live quiz, then reading aloud, then a marathon)

- Live: **"מרתון עכשיו: מרתון לפני המבחן · קריאה בקול · Antimalarials"** · **"להצטרף"**.
- Later today (within 12 hours): **"מרתון היום ב-18:00 · בפנים: שוהם, נועה +2"** · **"לפרטים"**.
- Not on the marathon's own page.

### 1.7 Who sees what

| What | The member | Other members | Kept in |
|---|---|---|---|
| The email of a saved account | yes ("שלי") | **no** | Supabase Auth only |
| Answers, scores, mistakes, weak points, activity days | yes | **no** | `study_answers` (questions design), read through `security invoker` functions |
| Parts read, the place to continue, reading time | yes | **no** | `study_read_parts`, `study_read_places` |
| Plans and ticked tasks | yes | **no** | `study_plans`, `study_plan_lectures`, `study_plan_checks` |
| "סימון שקראתי" for a whole lecture | yes | yes (as today) | `study_reads` |
| Marathons, their agenda and current step | yes | yes | `study_marathons` (Realtime) |
| Who is in, maybe, out of a marathon | yes | yes | `study_marathon_people` (Realtime) |
| My results during a marathon | yes | **no** | computed from my own answers |

### 1.8 Moving today's group to saved accounts (the migration)

Every member is anonymous today, some on two devices (a phone's Safari tab and its Home Screen app have separate storage; research-auth §7). Nothing has to move in the database for a member who saves on the device they use: the user id stays.

1. **Yoad, before the release:** research-auth §4 steps 0-6 (the project, custom SMTP, Confirm Email ON, the two templates, the site URL, sessions), then block A in the SQL editor. Then the **members report** (read-only):
   ```sql
   select m.name, m.user_id, u.is_anonymous, u.email is not null as saved, u.created_at, u.last_sign_in_at,
          (select count(*) from public.study_comments c where c.author_id = m.user_id) as comments,
          (select count(*) from public.study_reads r where r.user_id = m.user_id) as reads,
          (select count(*) from public.study_lectures l where l.created_by = m.user_id) as lectures
     from public.study_members m join auth.users u on u.id = m.user_id
    order by m.name, u.created_at;
   ```
   (`auth.users` has `email`, `is_anonymous`, `created_at`, `last_sign_in_at`: `internal/models/user.go` L30, L62, L70, L74.)
2. **Release `VITE_STUDY_ACCOUNT`.** Each anonymous member sees the announcement (A8) and, on a duplicate name, A7.
3. **A WhatsApp message to the group** (Hebrew, ready to paste): **"עדכון בתמצית: אפשר לשמור את החשבון עם מייל. בטלפון שבו נכנסים בדרך כלל: שלי ← שמירת החשבון עם מייל, ואז הקוד מהמייל. במחשב או בטלפון נוסף: שלי ← כבר שמרתי חשבון במקום אחר (או ״כניסה עם מייל״ במסך הכניסה). ככה כל מה שעשיתם בשני המכשירים נשמר יחד."**
4. **Each member:** save on the main device (A2, save). On every other device or browser where they had joined: "כבר שמרתי חשבון במקום אחר" (the merge folds that device's member in). On a device where they never joined: Join → "כניסה עם מייל".
5. **Ghosts** (a duplicate name whose device is gone, so nobody can offer its ticket): after asking the member, Yoad folds it in the SQL editor: `select study_private.merge_users('<ghost id>', '<account id>');` (tested: I13-I15). A ghost that owns nothing can stay, or go with research-auth's safe clean-up (preview tested: I18).
6. **Yoad checks** the members report again: every name once, `is_anonymous = false`. Only then switch on `VITE_STUDY_PROGRESS` (decision 11).

Never run Supabase's sample clean-up (`delete from auth.users where is_anonymous ...`) here: `study_groups.created_by` cascades, so deleting the creator's anonymous user would delete the group (research-auth §3).

---

## 2. Data model

### 2.1 Tables

| Table | Who reads | Who writes | Realtime |
|---|---|---|---|
| `study_private.merge_tickets`: one-time tickets, stored hashed, 30 minutes | **nobody** (schema not exposed, no grants) | `study_merge_offer`, `study_merge_claim` | no |
| `study_read_parts`: a part a member finished, when, how long it took | **the owner** | `study_note_reading`, `study_mark_parts`; the owner may delete | **no** |
| `study_read_places`: where a member stopped in a lecture | **the owner** | `study_note_reading` | **no** |
| `study_plans`: exam name and date, courses, minutes a day, days off, final review, active or archived | **the owner** | `study_plan_save`, `_replan`, `_end`; the owner may delete | **no** |
| `study_plan_lectures`: lectures added (`included`) or left out by hand | **the owner** | `study_plan_save` | **no** |
| `study_plan_checks`: a task ticked by hand on a day | **the owner** | the owner (insert with column grants, delete) | **no** |
| `study_marathons`: the marathon, its agenda, the current step, `version` | the group | `study_marathon_save`, `_step`, `_cancel` | **yes** |
| `study_marathon_people`: in / maybe / out, one per member | the group | `study_marathon_answer` | **yes** |

Design rules:

- **Private rows are never published.** Realtime sends a deleted row's primary key to every subscriber, because "RLS policies are not applied to `DELETE` statements" (Supabase Postgres Changes doc). The private tables keep `(user_id, lecture_id)` keys and stay out of the publication (check ME51). The two shared tables have their own random `id` as the key.
- **Writes go through functions** (`security definer`, with the caller and membership checked inside), except ticking a plan task, which is a plain insert on the caller's own plan. Members have no `insert`/`update` grant on any other table here (checks ME19, ME27, ME40).
- **Numbers come from `security invoker` functions** with no user parameter: Row Level Security on `study_answers`, `study_read_parts` and `study_reads` keeps every row to the caller. A member can only ask about themself (ME7, ME8, ME13).
- **The study day is Israel time from 04:00**, written as `((t at time zone 'Asia/Jerusalem') - interval '4 hours')::date` inside the functions, so block B needs nothing from the flashcards block (the same rule as its `study_day()`; tested at 03:30 and 04:00 in ME14 and D1-D7).
- **A part re-written under a new outline loses its "read" marks** (a trigger on `study_sections` deletes; ME67): part 3 of a new outline is different text.
- **Caps in the database:** 20 courses and 200 hand-picked lectures per plan, 15-720 minutes a day, an exam date up to a year ahead; a marathon of 30-720 minutes, up to 20 lectures, 40 steps of 1-240 minutes, quizzes of 3-30 questions, a start at most 180 days ahead.

### 2.2 Block A: identity (ships first; append to `supabase/study-schema.sql`)

Tested exactly as printed (`spec/me-proto/sql/me-identity.sql`): loaded twice on the repo's schema alone (24 checks, §6.1), and again with every other design's SQL (83 checks).

```sql
-- ═══════════════════════════════════════════════════════════════════════
--  PROPOSAL (design-me.md §2, block A): identity for תמצית (decision 11).
--  Ships FIRST, before any private feature: appended to
--  supabase/study-schema.sql as soon as email sign-in is built. Re-runnable.
--
--  A device's anonymous member is folded into a saved (email) account with
--  a one-time merge ticket (research-auth). study_private.merge_users() is
--  the ONE place that moves rows between users. It already carries the lines
--  of every feature designed so far, each behind "if its table exists", so
--  it installs at any stage of the rollout; a feature built later adds its
--  lines there, and supabase/tests fails until it does.
-- ═══════════════════════════════════════════════════════════════════════

create schema if not exists study_private;
revoke all on schema study_private from public;

-- ═══════════════════════════════════════════════════════════════════════
--  1. Identity: merge tickets (research-auth, moved out of the API's reach)
-- ═══════════════════════════════════════════════════════════════════════
-- A ticket proves that the caller held the anonymous session minutes ago.
-- Stored hashed, 30 minutes, once. Not in an exposed schema, no grants.
create table if not exists study_private.merge_tickets (
  token_hash text        primary key,
  from_user  uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- An anonymous caller asks for a ticket right before signing in to a saved
-- account on this device. Returns the secret (64 hex characters).
create or replace function public.study_merge_offer()
returns text language plpgsql volatile security definer set search_path = public as $$
declare secret text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'not anonymous';
  end if;
  delete from study_private.merge_tickets
   where from_user = auth.uid() or created_at < now() - interval '30 minutes';
  -- 244 random bits from the server's strong generator; no extension needed.
  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into study_private.merge_tickets (token_hash, from_user)
  values (encode(sha256(convert_to(secret, 'UTF8')), 'hex'), auth.uid());
  return secret;
end;
$$;

-- The saved account redeems the ticket right after signing in: 1 = the
-- device's rows moved to the caller, 0 = the ticket was the caller's own.
-- A used, wrong or expired ticket raises 'ticket not found'.
create or replace function public.study_merge_claim(p_ticket text)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  dst uuid := auth.uid();
  src uuid;
begin
  if dst is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'sign in first';
  end if;
  delete from study_private.merge_tickets t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_ticket, ''), 'UTF8')), 'hex')
     and t.created_at > now() - interval '30 minutes'
  returning t.from_user into src;
  if src is null then raise exception 'ticket not found'; end if;
  if src = dst then return 0; end if;
  perform study_private.merge_users(src, dst);
  return 1;
end;
$$;

revoke all on function public.study_merge_offer() from public, anon;
revoke all on function public.study_merge_claim(text) from public, anon;
grant execute on function public.study_merge_offer() to authenticated;
grant execute on function public.study_merge_claim(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  The one place that moves a person's rows: study_private.merge_users()
--  ─────────────────────────────────────────────────────────────────────
--  Called by study_merge_claim() (a device folds into the saved account),
--  and by Yoad from the SQL editor for a "ghost" (an anonymous member whose
--  device is gone): select study_private.merge_users('<ghost>', '<account>');
--  Every user column of every study_ table moves to dst; where both users
--  have a row that must stay single, the rule is written next to it. Each
--  feature's lines run only if its tables exist, so the function installs
--  at any stage of the rollout. Keep it LAST in study-schema.sql.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function study_private.merge_users(src uuid, dst uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if src is null or dst is null or src = dst then return; end if;
  -- Two devices folding into one account at the same moment run one by one.
  perform pg_advisory_xact_lock(hashtext('study_merge:' || dst::text));

  -- ── study-schema.sql ──
  -- Memberships: where both belong, the account's row (and its name) stays.
  delete from public.study_members m
   where m.user_id = src
     and exists (select 1 from public.study_members d where d.group_id = m.group_id and d.user_id = dst);
  update public.study_members set user_id = dst where user_id = src;
  -- Read marks: one per lecture, the earlier one stays.
  update public.study_reads d set read_at = least(d.read_at, s.read_at)
    from public.study_reads s
   where s.user_id = src and d.user_id = dst and d.lecture_id = s.lecture_id;
  delete from public.study_reads r
   where r.user_id = src
     and exists (select 1 from public.study_reads d where d.lecture_id = r.lecture_id and d.user_id = dst);
  update public.study_reads set user_id = dst where user_id = src;
  update public.study_comments set author_id = dst where author_id = src;
  update public.study_lectures set created_by = dst where created_by = src;
  update public.study_groups set created_by = dst where created_by = src;

  -- ── design-platform ──
  if to_regclass('public.study_usage') is not null then
    update public.study_usage set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_recordings') is not null then
    update public.study_recordings set created_by = dst where created_by = src;
  end if;
  if to_regclass('study_private.jobs') is not null then
    update study_private.jobs set queued_by = dst where queued_by = src;
  end if;

  -- ── design-questions §2.3 ──
  if to_regclass('public.study_answers') is not null then
    update public.study_answers set user_id = dst where user_id = src;
    delete from public.study_question_flags f
     where f.user_id = src
       and exists (select 1 from public.study_question_flags d where d.question_id = f.question_id and d.user_id = dst);
    update public.study_question_flags set user_id = dst where user_id = src;
    update public.study_questions set created_by = dst where created_by = src;
    update public.study_questions set retired_by = dst where retired_by = src;
    update public.study_question_batches set created_by = dst where created_by = src;
    update public.study_question_keys set key_by = dst where key_by = src;
    update public.study_exams set created_by = dst where created_by = src;
  end if;

  -- ── design-quiz §2.4: in a quiz both devices played, the account's seat stays ──
  if to_regclass('public.study_quizzes') is not null then
    delete from public.study_quiz_answers a
     using public.study_quiz_rounds r
     where a.round_id = r.id and a.user_id = src
       and exists (select 1 from public.study_quiz_players d where d.quiz_id = r.quiz_id and d.user_id = dst);
    delete from public.study_quiz_players p
     where p.user_id = src
       and exists (select 1 from public.study_quiz_players d where d.quiz_id = p.quiz_id and d.user_id = dst);
    update public.study_quiz_answers set user_id = dst where user_id = src;
    update public.study_quiz_players set user_id = dst where user_id = src;
    update public.study_quizzes set host_id = dst where host_id = src;
    update public.study_quizzes set created_by = dst where created_by = src;
    update public.study_quiz_rounds set voided_by = dst where voided_by = src;
  end if;

  -- ── design-cards §2.3: the more recently reviewed memory of a card stays ──
  if to_regclass('public.study_card_states') is not null then
    delete from public.study_card_states s
     where s.user_id = src
       and exists (select 1 from public.study_card_states d
                    where d.card_id = s.card_id and d.user_id = dst
                      and coalesce(d.last_review, '-infinity') >= coalesce(s.last_review, '-infinity'));
    delete from public.study_card_states d
     where d.user_id = dst
       and exists (select 1 from public.study_card_states s where s.card_id = d.card_id and s.user_id = src);
    update public.study_card_states set user_id = dst where user_id = src;
    update public.study_card_reviews set user_id = dst where user_id = src;
    delete from public.study_card_settings s
     where s.user_id = src and exists (select 1 from public.study_card_settings d where d.user_id = dst);
    update public.study_card_settings set user_id = dst where user_id = src;
    update public.study_cards set created_by = dst where created_by = src;
    update public.study_cards set updated_by = dst where updated_by = src;
    update public.study_cards set deleted_by = dst where deleted_by = src;
    update public.study_card_edits set edited_by = dst where edited_by = src;
    update public.study_card_batches set created_by = dst where created_by = src;
  end if;

  -- ── design-me, block B (reading progress, plans, marathons) ──
  if to_regclass('public.study_read_parts') is not null then
    -- Parts read: both devices' parts count; the earlier finish and both times stay.
    update public.study_read_parts d
       set done_at = least(d.done_at, s.done_at), seconds = least(d.seconds + s.seconds, 86400)
      from public.study_read_parts s
     where s.user_id = src and d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx;
    delete from public.study_read_parts s
     where s.user_id = src
       and exists (select 1 from public.study_read_parts d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx);
    update public.study_read_parts set user_id = dst where user_id = src;
    -- Places: the newer one stays.
    delete from public.study_read_places s
     where s.user_id = src
       and exists (select 1 from public.study_read_places d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.updated_at >= s.updated_at);
    delete from public.study_read_places d
     where d.user_id = dst
       and exists (select 1 from public.study_read_places s where s.user_id = src and s.lecture_id = d.lecture_id);
    update public.study_read_places set user_id = dst where user_id = src;
    -- Plans: the account's active plan stays active; the device's goes to the archive.
    update public.study_plans s set status = 'archived', updated_at = now()
     where s.user_id = src and s.status = 'active'
       and exists (select 1 from public.study_plans d where d.user_id = dst and d.group_id = s.group_id and d.status = 'active');
    update public.study_plans set user_id = dst where user_id = src;
    update public.study_plan_lectures set user_id = dst where user_id = src;
    update public.study_plan_checks set user_id = dst where user_id = src;
    -- Marathons: one answer per person, the newer one stays.
    delete from public.study_marathon_people s
     where s.user_id = src
       and exists (select 1 from public.study_marathon_people d
                    where d.marathon_id = s.marathon_id and d.user_id = dst and d.updated_at >= s.updated_at);
    delete from public.study_marathon_people d
     where d.user_id = dst
       and exists (select 1 from public.study_marathon_people s where s.marathon_id = d.marathon_id and s.user_id = src);
    update public.study_marathon_people set user_id = dst where user_id = src;
    update public.study_marathons set created_by = dst where created_by = src;
    update public.study_marathons set updated_by = dst where updated_by = src;
  end if;

  -- A table added later with a user column adds its lines above; the
  -- supabase/tests check "every user column is merged" fails until it does.
end;
$$;
revoke all on function study_private.merge_users(uuid, uuid) from public;
```

### 2.3 Block B: reading progress, private numbers, the plan, marathons (append after the practice-questions block)

Tested exactly as printed (`spec/me-proto/sql/me.sql`), loaded twice on top of the repo, platform, questions, quiz and flashcards SQL.

```sql
-- ═══════════════════════════════════════════════════════════════════════
--  PROPOSAL (design-me.md §2, block B): private progress, the study plan and
--  marathons for תמצית (item 7). Appended to supabase/study-schema.sql AFTER
--  the practice-questions block (it reads study_questions and study_answers);
--  the quiz and flashcards blocks may come before or after it. Re-runnable.
--
--  Who sees what: reading progress, the numbers and the plan are visible
--  only to their owner and never published; marathons and who is in are
--  visible to every member of the group and published to Realtime. Nothing
--  here calls Claude.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  2. Reading progress (private)
-- ═══════════════════════════════════════════════════════════════════════
-- A summary part counts as read once its end reached the reading line and
-- the member spent long enough on it (LectureView's tracker), or by hand
-- (a plan task ticked). seconds = time spent on the part, for the member's
-- own reading speed. Never published: (user, lecture) keys stay private.
create table if not exists public.study_read_parts (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  done_at    timestamptz not null default now(),
  seconds    int         not null default 0 check (seconds between 0 and 86400),
  primary key (user_id, lecture_id, part_idx)
);
create index if not exists study_read_parts_lecture on public.study_read_parts (lecture_id);

-- Where the member stopped in a lecture: "continue where you stopped" on
-- any device.
create table if not exists public.study_read_places (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (user_id, lecture_id)
);
create index if not exists study_read_places_lecture on public.study_read_places (lecture_id);

-- A part that is deleted (the lecture was split into parts again) takes the
-- members' "read" marks for its number with it: the new part with that
-- number is different text. Definer, so it clears every member's rows.
create or replace function public.study_read_parts_forget()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.study_read_parts r where r.lecture_id = old.lecture_id and r.part_idx = old.idx;
  return old;
end;
$$;
revoke all on function public.study_read_parts_forget() from public, anon, authenticated;
drop trigger if exists study_read_parts_forget on public.study_sections;
create trigger study_read_parts_forget after delete on public.study_sections
  for each row execute function public.study_read_parts_forget();

-- Saves the caller's place in a lecture; with p_done, also marks that part
-- read (once; the first time counts). Errors: 'not signed in',
-- 'lecture not found', 'bad part'.
create or replace function public.study_note_reading(p_lecture uuid, p_part int, p_anchor int,
  p_done boolean default false, p_seconds int default 0)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then
    raise exception 'bad part';
  end if;
  insert into public.study_read_places (user_id, lecture_id, part_idx, anchor, updated_at)
  values (me, p_lecture, p_part, greatest(0, least(coalesce(p_anchor, 0), 99999)), now())
  on conflict (user_id, lecture_id)
  do update set part_idx = excluded.part_idx, anchor = excluded.anchor, updated_at = excluded.updated_at;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    values (me, p_lecture, p_part, now(), greatest(0, least(coalesce(p_seconds, 0), 86400)))
    on conflict (user_id, lecture_id, part_idx) do nothing;
  end if;
end;
$$;

-- Marks parts read or unread by hand (a plan task ticked or unticked).
-- Unknown part numbers are ignored. Returns how many rows changed.
create or replace function public.study_mark_parts(p_lecture uuid, p_parts int[], p_done boolean)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if cardinality(coalesce(p_parts, '{}')) > 200 then raise exception 'bad part'; end if;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    select me, p_lecture, s.idx, now(), 0
      from public.study_sections s
     where s.lecture_id = p_lecture and s.idx = any (p_parts)
    on conflict (user_id, lecture_id, part_idx) do nothing;
  else
    delete from public.study_read_parts r
     where r.user_id = me and r.lecture_id = p_lecture and r.part_idx = any (p_parts);
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Private numbers (security invoker: RLS keeps them to the caller)
-- ═══════════════════════════════════════════════════════════════════════
-- Per lecture of the group, as of p_asof: the caller's read mark and parts,
-- the active keyed questions (practice and past-exam items linked to it) and
-- the caller's answers to them. p_asof = the start of today freezes the
-- plan's "today"; now() gives the live numbers.
--   correct_now / wrong_now: questions whose LATEST answer is right / wrong
--   first_try: questions whose FIRST answer was right
--   parts: [{i, t, from, to, chars, ready}] for time estimates
create or replace function public.study_my_lectures(p_group uuid, p_asof timestamptz default now())
returns table (lecture_id uuid, course text, title text, lecture_date date, created_at timestamptz, status text,
               slides int, parts jsonb, read_at timestamptz, parts_done int[], part_seconds jsonb,
               questions int, cases int, answered int, correct_now int, first_try int, wrong_now int,
               answers int, last_answer_at timestamptz)
language sql stable set search_path = public as $$
  with lec as (
    select l.id, l.course, l.title, l.lecture_date, l.created_at, l.status, jsonb_array_length(l.slides) as slides
    from public.study_lectures l
    where l.group_id = p_group and l.created_at <= p_asof
  ),
  q as (
    select q.id, coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.kind
    from public.study_questions q
    where q.group_id = p_group and q.retired_at is null and q.has_key and q.created_at <= p_asof
      and coalesce(q.lecture_id, q.ref_lecture) is not null
  ),
  a as (
    select a.question_id, a.correct, a.answered_at,
           row_number() over (partition by a.question_id order by a.answered_at desc, a.id) as rn_last,
           row_number() over (partition by a.question_id order by a.answered_at asc, a.id) as rn_first
    from public.study_answers a
    join q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_asof
  ),
  qs as (
    select q.lecture_id,
           count(*)::int as questions,
           (count(*) filter (where q.kind = 'case'))::int as cases,
           (count(*) filter (where la.question_id is not null))::int as answered,
           (count(*) filter (where la.correct))::int as correct_now,
           (count(*) filter (where fa.correct))::int as first_try,
           (count(*) filter (where la.correct = false))::int as wrong_now
    from q
    left join a la on la.question_id = q.id and la.rn_last = 1
    left join a fa on fa.question_id = q.id and fa.rn_first = 1
    group by q.lecture_id
  ),
  an as (
    select q.lecture_id, count(*)::int as answers, max(a.answered_at) as last_at
    from a join q on q.id = a.question_id
    group by q.lecture_id
  ),
  pt as (
    select s.lecture_id,
           jsonb_agg(jsonb_build_object('i', s.idx, 't', s.title, 'from', s.slide_from, 'to', s.slide_to,
                                        'chars', char_length(s.markdown), 'ready', s.status = 'ready') order by s.idx) as parts
    from public.study_sections s
    where s.lecture_id in (select id from lec)
    group by s.lecture_id
  ),
  rp as (
    select r.lecture_id, array_agg(r.part_idx order by r.part_idx) as done,
           jsonb_object_agg(r.part_idx::text, r.seconds) as secs
    from public.study_read_parts r
    where r.user_id = auth.uid() and r.done_at <= p_asof and r.lecture_id in (select id from lec)
    group by r.lecture_id
  ),
  rd as (
    select r.lecture_id, r.read_at
    from public.study_reads r
    where r.user_id = auth.uid() and r.read_at <= p_asof and r.lecture_id in (select id from lec)
  )
  select l.id, btrim(l.course), l.title, l.lecture_date, l.created_at, l.status, l.slides,
         coalesce(pt.parts, '[]'::jsonb), rd.read_at, coalesce(rp.done, '{}'), coalesce(rp.secs, '{}'::jsonb),
         coalesce(qs.questions, 0), coalesce(qs.cases, 0), coalesce(qs.answered, 0), coalesce(qs.correct_now, 0),
         coalesce(qs.first_try, 0), coalesce(qs.wrong_now, 0), coalesce(an.answers, 0), an.last_at
  from lec l
  left join pt on pt.lecture_id = l.id
  left join rp on rp.lecture_id = l.id
  left join rd on rd.lecture_id = l.id
  left join qs on qs.lecture_id = l.id
  left join an on an.lecture_id = l.id
  order by l.created_at, l.id;
$$;

-- Weak points (item 7), from the caller's practice AND live-quiz answers
-- (the quiz copies each answer into study_answers, mode 'quiz').
--   1. Evidence: the FIRST answer to a question in each study day (Israel
--      time, the day starts 04:00), on active keyed questions with a topic.
--      "לא יודעים" is a wrong answer. Re-answers later the same day (right
--      after reading the explanation) do not count.
--   2. Weight: 0.5 ^ (age in days / 21): an answer three weeks old counts half.
--   3. Score: (Σ w·correct + 2 × 0.7) / (Σ w + 2): two pseudo-answers at 70%
--      keep a topic with little evidence near "unknown, probably fine".
--   4. Topic key: lower(btrim(topic)), across lectures. Per aspect the same.
--   5. status: 'weak'  when items >= 2, Σw >= 1.5, score < 0.6 and
--                      (a question is wrong right now or score < 0.5);
--              'watch' when items >= 2 and score < 0.75; else 'ok'.
create or replace function public.study_my_weak_points(p_group uuid, p_now timestamptz default now())
returns table (topic_key text, topic text, score numeric, weight numeric, items int, wrong_now int,
               status text, worst_aspect text, aspects jsonb, lecture_ids uuid[], slides jsonb, last_at timestamptz)
language sql stable set search_path = public as $$
  with al as (   -- every answer of the caller to an active keyed question with a topic
    select lower(btrim(q.topic)) as topic_key, btrim(q.topic) as topic, q.aspect,
           coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.id as question_id, q.slides,
           a.id as answer_id, a.correct, a.answered_at,
           row_number() over (
             partition by a.question_id, ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
             order by a.answered_at, a.id) as rn
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_now
      and q.group_id = p_group and q.retired_at is null and q.has_key and btrim(q.topic) <> ''
  ),
  w as (         -- the evidence: the first answer per question per study day, weighted by age
    select al.*,
           power(0.5::numeric, (greatest(0, extract(epoch from (p_now - al.answered_at))) / 86400.0 / 21.0)::numeric) as wt,
           (case when al.correct then 1 else 0 end)::numeric as y
    from al
    where al.rn = 1
  ),
  latest as (    -- each question's latest answer (any), for "wrong right now"
    select distinct on (al.question_id) al.question_id, al.correct
    from al
    order by al.question_id, al.answered_at desc, al.answer_id desc
  ),
  asp as (
    select w.topic_key, w.aspect, round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight, count(distinct w.question_id)::int as items
    from w
    group by w.topic_key, w.aspect
  ),
  miss as (   -- slides of questions answered wrong, most missed first
    select m.topic_key, jsonb_agg(jsonb_build_object('l', m.lecture_id, 'n', m.n, 'c', m.c)
                                  order by m.c desc, m.n) filter (where m.rk <= 3) as slides
    from (
      select w.topic_key, w.lecture_id, s.n, count(*) as c,
             row_number() over (partition by w.topic_key order by count(*) desc, s.n) as rk
      from w cross join lateral unnest(w.slides) as s(n)
      where not w.correct and w.lecture_id is not null
      group by w.topic_key, w.lecture_id, s.n
    ) m
    group by m.topic_key
  ),
  t as (
    select w.topic_key, min(w.topic) as topic,
           round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight,
           count(distinct w.question_id)::int as items,
           (count(distinct w.question_id) filter (where lt.correct = false))::int as wrong_now,
           array_agg(distinct w.lecture_id) filter (where w.lecture_id is not null) as lecture_ids,
           max(w.answered_at) as last_at
    from w join latest lt on lt.question_id = w.question_id
    group by w.topic_key
  )
  select t.topic_key, t.topic, t.score, t.weight, t.items, t.wrong_now,
         case when t.items >= 2 and t.weight >= 1.5 and t.score < 0.6 and (t.wrong_now > 0 or t.score < 0.5) then 'weak'
              when t.items >= 2 and t.score < 0.75 then 'watch'
              else 'ok' end,
         (select a.aspect from asp a where a.topic_key = t.topic_key order by a.score, a.weight desc, a.aspect limit 1),
         (select jsonb_agg(jsonb_build_object('aspect', a.aspect, 'score', a.score, 'items', a.items)
                           order by a.score, a.aspect)
            from asp a where a.topic_key = t.topic_key),
         coalesce(t.lecture_ids, '{}'), coalesce(m.slides, '[]'::jsonb), t.last_at
  from t
  left join miss m on m.topic_key = t.topic_key
  order by t.score, t.weight desc, t.topic_key;
$$;

-- Activity per study day (Israel time, from 04:00): answers (practice and
-- quiz), right ones, practice time (each answer capped at 5 minutes), parts
-- read and reading time. Flashcard reviews come from study_my_card_days.
create or replace function public.study_my_days(p_group uuid, p_days int default 28, p_now timestamptz default now())
returns table (day date, answers int, correct int, practice_seconds int, parts_read int, read_seconds int)
language sql stable set search_path = public as $$
  with lim as (
    select p_now - make_interval(days => greatest(1, least(coalesce(p_days, 28), 366))) as since
  ),
  d as (
    select ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date as day,
           1 as answer, case when a.correct then 1 else 0 end as ok, least(coalesce(a.ms, 0), 300000) as ms,
           0 as part, 0 as rs
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and q.group_id = p_group
      and a.answered_at <= p_now and a.answered_at > (select since from lim)
    union all
    select ((r.done_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date, 0, 0, 0, 1, r.seconds
    from public.study_read_parts r
    join public.study_lectures l on l.id = r.lecture_id
    where r.user_id = auth.uid() and l.group_id = p_group
      and r.done_at <= p_now and r.done_at > (select since from lim)
  )
  select d.day, sum(d.answer)::int, sum(d.ok)::int, (sum(d.ms) / 1000)::int, sum(d.part)::int, sum(d.rs)::int
  from d
  group by d.day
  order by d.day;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  4. The study plan (private)
-- ═══════════════════════════════════════════════════════════════════════
-- One active plan per member per group. Scope = every lecture of the listed
-- courses (also ones uploaded later) + lectures added by hand − lectures
-- left out by hand (study_plan_lectures).
create table if not exists public.study_plans (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  group_id      uuid        not null references public.study_groups (id) on delete cascade,
  title         text        not null check (char_length(btrim(title)) between 1 and 120),
  exam_date     date        not null,
  courses       text[]      not null default '{}' check (cardinality(courses) <= 20),
  daily_minutes int         not null default 120 check (daily_minutes between 15 and 720),
  days_off      smallint[]  not null default '{}' check (days_off <@ '{0,1,2,3,4,5,6}'::smallint[]),
  final_review  boolean     not null default true,
  status        text        not null default 'active' check (status in ('active', 'archived')),
  replanned_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists study_plans_one_active on public.study_plans (user_id, group_id) where status = 'active';

create table if not exists public.study_plan_lectures (
  plan_id    uuid    not null references public.study_plans (id) on delete cascade,
  lecture_id uuid    not null references public.study_lectures (id) on delete cascade,
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  included   boolean not null,            -- true: added by hand; false: left out by hand
  primary key (plan_id, lecture_id)
);
create index if not exists study_plan_lectures_lecture on public.study_plan_lectures (lecture_id);

-- A task the member ticked by hand on a day (key as shared/study/plan.ts makes it).
create table if not exists public.study_plan_checks (
  plan_id    uuid        not null references public.study_plans (id) on delete cascade,
  day        date        not null,
  task_key   text        not null check (char_length(task_key) between 3 and 200),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  checked_at timestamptz not null default now(),
  primary key (plan_id, day, task_key)
);

-- Creates the caller's plan (p_plan null: the previous active plan goes to
-- the archive) or changes it (its lecture choices are replaced, and today is
-- planned again). Returns the plan id. Errors: 'not signed in',
-- 'group not found', 'bad title', 'bad date', 'bad minutes', 'bad days',
-- 'bad courses', 'lecture not found', 'too many lectures', 'plan not found'.
create or replace function public.study_plan_save(p_plan uuid, p_group uuid, p_title text, p_exam_date date,
  p_courses text[], p_add uuid[], p_drop uuid[], p_daily_minutes int, p_days_off int[], p_final_review boolean default true)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  pid   uuid;
  today date := ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date;
  crs   text[];
  offs  smallint[];
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_exam_date is null or p_exam_date <= today or p_exam_date > today + 366 then raise exception 'bad date'; end if;
  if p_daily_minutes is null or p_daily_minutes not between 15 and 720 then raise exception 'bad minutes'; end if;
  if cardinality(coalesce(p_days_off, '{}')) > 6
     or exists (select 1 from unnest(coalesce(p_days_off, '{}')) d where d is null or d not between 0 and 6) then
    raise exception 'bad days';
  end if;
  if cardinality(coalesce(p_courses, '{}')) > 20
     or exists (select 1 from unnest(coalesce(p_courses, '{}')) c where char_length(btrim(coalesce(c, ''))) not between 1 and 120) then
    raise exception 'bad courses';
  end if;
  if cardinality(coalesce(p_add, '{}')) + cardinality(coalesce(p_drop, '{}')) > 200 then raise exception 'too many lectures'; end if;
  if exists (select 1 from unnest(coalesce(p_add, '{}') || coalesce(p_drop, '{}')) as l(id)
              where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  select coalesce(array_agg(distinct btrim(c) order by btrim(c)), '{}') into crs from unnest(coalesce(p_courses, '{}')) c;
  select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into offs from unnest(coalesce(p_days_off, '{}')) d;
  perform pg_advisory_xact_lock(hashtext('study_plan:' || me::text));
  if p_plan is null then
    update public.study_plans set status = 'archived', updated_at = now()
     where user_id = me and group_id = p_group and status = 'active';
    insert into public.study_plans (user_id, group_id, title, exam_date, courses, daily_minutes, days_off, final_review)
    values (me, p_group, btrim(p_title), p_exam_date, crs, p_daily_minutes, offs, coalesce(p_final_review, true))
    returning id into pid;
  else
    update public.study_plans
       set title = btrim(p_title), exam_date = p_exam_date, courses = crs, daily_minutes = p_daily_minutes,
           days_off = offs, final_review = coalesce(p_final_review, true), replanned_at = now(), updated_at = now()
     where id = p_plan and user_id = me and group_id = p_group and status = 'active'
    returning id into pid;
    if pid is null then raise exception 'plan not found'; end if;
    delete from public.study_plan_lectures where plan_id = pid;
  end if;
  insert into public.study_plan_lectures (plan_id, lecture_id, user_id, included)
  select pid, l.id, me, true from (select distinct unnest(coalesce(p_add, '{}')) as id) l
  union all
  select pid, l.id, me, false from (select distinct unnest(coalesce(p_drop, '{}')) as id) l
   where not (l.id = any (coalesce(p_add, '{}')));
  return pid;
end;
$$;

-- "לסדר מחדש את היום": today is planned again from now. 'plan not found'.
create or replace function public.study_plan_replan(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set replanned_at = now(), updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- "סיום התוכנית": the plan goes to the archive. 'plan not found'.
create or replace function public.study_plan_end(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set status = 'archived', updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Marathons (shared inside the group)
-- ═══════════════════════════════════════════════════════════════════════
-- agenda: the run-of-show, an array of steps (shared/study/agenda.ts):
--   { k: 'intro'|'read'|'quiz'|'break'|'questions'|'free'|'wrap',
--     l?: lecture id (read, quiz: required; one of lecture_ids),
--     from?, to?: summary part numbers (read), min: planned minutes 1-240,
--     n?: quiz questions 3-30, mode?: 'coop'|'race', title?: ≤ 80 chars }
-- step: the step on screen (-1 before the start). Any member may move it;
-- study_marathon_step() takes "from" so two taps at once move it once.
-- version: bumped by every change, for "someone else edited it".
create table if not exists public.study_marathons (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  title       text        not null check (char_length(btrim(title)) between 1 and 120),
  starts_at   timestamptz not null,
  minutes     int         not null check (minutes between 30 and 720),
  place       text        not null default '' check (char_length(place) <= 120),
  note        text        not null default '' check (char_length(note) <= 500),
  lecture_ids uuid[]      not null default '{}' check (cardinality(lecture_ids) <= 20),
  agenda      jsonb       not null default '[]'::jsonb
                          check (jsonb_typeof(agenda) = 'array' and jsonb_array_length(agenda) <= 40),
  state       text        not null default 'planned' check (state in ('planned', 'live', 'ended', 'cancelled')),
  step        int         not null default -1 check (step between -1 and 39),
  step_at     timestamptz,
  started_at  timestamptz,
  ended_at    timestamptz,
  version     int         not null default 1 check (version >= 1),
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists study_marathons_group on public.study_marathons (group_id, starts_at);

-- Who is in. Its own id: the table is published, and a key must say nothing.
create table if not exists public.study_marathon_people (
  id          uuid        primary key default gen_random_uuid(),
  marathon_id uuid        not null references public.study_marathons (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  answer      text        not null check (answer in ('in', 'maybe', 'out')),
  updated_at  timestamptz not null default now(),
  unique (marathon_id, user_id)
);
create index if not exists study_marathon_people_user on public.study_marathon_people (user_id);

create or replace function public.study_marathon_group(m uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_marathons where id = m;
$$;

-- A marathon is over when it ended, was cancelled, or is 3 hours past its
-- planned end (nobody pressed "סיום"): no cron needed.
create or replace function public.study_marathon__over(m public.study_marathons)
returns boolean language sql stable set search_path = public as $$
  select m.state in ('ended', 'cancelled') or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours';
$$;

-- The run-of-show is checked here, so a phone cannot store junk for others.
create or replace function public.study_marathon__agenda_ok(p_agenda jsonb, p_lectures uuid[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  s jsonb;
  num constant text := '^[0-9]{1,4}$';
begin
  if p_agenda is null or jsonb_typeof(p_agenda) <> 'array' or jsonb_array_length(p_agenda) > 40 then return false; end if;
  for s in select x from jsonb_array_elements(p_agenda) as x loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(s) k where k not in ('k', 'l', 'from', 'to', 'min', 'n', 'mode', 'title')) then
      return false;
    end if;
    if coalesce(s ->> 'k', '') not in ('intro', 'read', 'quiz', 'break', 'questions', 'free', 'wrap') then return false; end if;
    if jsonb_typeof(s -> 'min') is distinct from 'number' or (s ->> 'min') !~ num or (s ->> 'min')::int not between 1 and 240 then
      return false;
    end if;
    if s ? 'l' then
      if jsonb_typeof(s -> 'l') <> 'string' or (s ->> 'l') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not ((s ->> 'l')::uuid = any (coalesce(p_lectures, '{}'))) then
        return false;
      end if;
    elsif s ->> 'k' in ('read', 'quiz') then
      return false;
    end if;
    if s ? 'from' and (jsonb_typeof(s -> 'from') <> 'number' or (s ->> 'from') !~ num or (s ->> 'from')::int > 199) then return false; end if;
    if s ? 'to' and (jsonb_typeof(s -> 'to') <> 'number' or (s ->> 'to') !~ num or (s ->> 'to')::int > 199
                     or (s ? 'from' and (s ->> 'to')::int < (s ->> 'from')::int)) then
      return false;
    end if;
    if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n') !~ num or (s ->> 'n')::int not between 3 and 30) then return false; end if;
    if s ? 'mode' and coalesce(s ->> 'mode', '') not in ('coop', 'race') then return false; end if;
    if s ? 'title' and (jsonb_typeof(s -> 'title') <> 'string' or char_length(s ->> 'title') > 80) then return false; end if;
  end loop;
  return true;
end;
$$;

-- Creates (p_id null; the creator is "in") or changes a marathon. Returns its
-- id and new version. Errors: 'not signed in', 'group not found',
-- 'bad title', 'bad minutes', 'bad time', 'lecture not found', 'bad agenda',
-- 'marathon not found', 'marathon over', 'conflict' (someone else saved first).
create or replace function public.study_marathon_save(p_id uuid, p_version int, p_group uuid, p_title text,
  p_starts_at timestamptz, p_minutes int, p_place text, p_note text, p_lectures uuid[], p_agenda jsonb)
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me  uuid := auth.uid();
  m   public.study_marathons;
  lec uuid[];
  ag  jsonb := coalesce(p_agenda, '[]'::jsonb);
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_minutes is null or p_minutes not between 30 and 720 then raise exception 'bad minutes'; end if;
  if p_starts_at is null or p_starts_at > now() + interval '180 days' then raise exception 'bad time'; end if;
  -- The lectures, once each, in the order given, all of this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o from unnest(coalesce(p_lectures, '{}')) with ordinality as u(l, o)
           where u.l is not null group by u.l) x;
  lec := coalesce(lec, '{}');
  if cardinality(lec) > 20
     or exists (select 1 from unnest(lec) as t(id) where public.study_lecture_group(t.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  if not public.study_marathon__agenda_ok(ag, lec) then raise exception 'bad agenda'; end if;
  if p_id is null then
    if p_starts_at < now() - interval '1 hour' then raise exception 'bad time'; end if;
    insert into public.study_marathons (group_id, title, starts_at, minutes, place, note, lecture_ids, agenda, created_by, updated_by)
    values (p_group, btrim(p_title), p_starts_at, p_minutes, left(btrim(coalesce(p_place, '')), 120),
            left(btrim(coalesce(p_note, '')), 500), lec, ag, me, me)
    returning * into m;
    insert into public.study_marathon_people (marathon_id, user_id, answer) values (m.id, me, 'in');
  else
    select * into m from public.study_marathons x where x.id = p_id for update;
    if not found or m.group_id <> p_group then raise exception 'marathon not found'; end if;
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    if m.version <> coalesce(p_version, -1) then raise exception 'conflict'; end if;
    update public.study_marathons x
       set title = btrim(p_title), starts_at = p_starts_at, minutes = p_minutes,
           place = left(btrim(coalesce(p_place, '')), 120), note = left(btrim(coalesce(p_note, '')), 500),
           lecture_ids = lec, agenda = ag,
           step = least(x.step, jsonb_array_length(ag) - 1),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id
    returning * into m;
  end if;
  return query select m.id, m.version;
end;
$$;

-- The caller's answer: 'in', 'maybe' or 'out'. Errors: 'marathon not found',
-- 'marathon over', 'bad answer'.
create or replace function public.study_marathon_answer(p_id uuid, p_answer text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  if coalesce(p_answer, '') not in ('in', 'maybe', 'out') then raise exception 'bad answer'; end if;
  insert into public.study_marathon_people (marathon_id, user_id, answer, updated_at)
  values (p_id, me, p_answer, now())
  on conflict (marathon_id, user_id) do update set answer = excluded.answer, updated_at = excluded.updated_at;
end;
$$;

-- Moves the run-of-show from step p_from to step p_to (start: -1 → 0; next;
-- back; jump). p_to = the number of steps ends the marathon. If the step is
-- no longer p_from (another phone moved it first), nothing changes and the
-- current step is returned. Errors: 'marathon not found', 'marathon over',
-- 'no agenda', 'bad step'.
create or replace function public.study_marathon_step(p_id uuid, p_from int, p_to int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons; n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  n := jsonb_array_length(m.agenda);
  if n = 0 then raise exception 'no agenda'; end if;
  if m.step <> coalesce(p_from, -2) then return m.step; end if;
  if p_to is null or p_to < 0 or p_to > n then raise exception 'bad step'; end if;
  if p_to = n then
    update public.study_marathons x
       set state = 'ended', ended_at = now(), started_at = coalesce(x.started_at, now()),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
    return n;
  end if;
  update public.study_marathons x
     set step = p_to, step_at = now(), state = 'live', started_at = coalesce(x.started_at, now()),
         version = x.version + 1, updated_by = me, updated_at = now()
   where x.id = p_id;
  return p_to;
end;
$$;

-- Cancels (p_cancel true) a marathon that is not over, or brings a cancelled
-- one back (false) while its time has not passed. Errors: 'marathon not
-- found', 'marathon over'.
create or replace function public.study_marathon_cancel(p_id uuid, p_cancel boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if coalesce(p_cancel, true) then
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    update public.study_marathons x set state = 'cancelled', version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  else
    if m.state <> 'cancelled' or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours' then
      raise exception 'marathon over';
    end if;
    update public.study_marathons x
       set state = case when x.started_at is null then 'planned' else 'live' end,
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_read_parts      enable row level security;
alter table public.study_read_places     enable row level security;
alter table public.study_plans           enable row level security;
alter table public.study_plan_lectures   enable row level security;
alter table public.study_plan_checks     enable row level security;
alter table public.study_marathons       enable row level security;
alter table public.study_marathon_people enable row level security;

-- (In study-schema.sql the file's loop has already dropped these; the drops
-- keep this block re-runnable on its own.)
drop policy if exists "study read parts own"        on public.study_read_parts;
drop policy if exists "study read parts remove"     on public.study_read_parts;
drop policy if exists "study read places own"       on public.study_read_places;
drop policy if exists "study plans own"             on public.study_plans;
drop policy if exists "study plans remove"          on public.study_plans;
drop policy if exists "study plan lectures own"     on public.study_plan_lectures;
drop policy if exists "study plan checks own"       on public.study_plan_checks;
drop policy if exists "study plan checks add"       on public.study_plan_checks;
drop policy if exists "study plan checks remove"    on public.study_plan_checks;
drop policy if exists "study marathons read"        on public.study_marathons;
drop policy if exists "study marathon people read"  on public.study_marathon_people;

-- Private rows: the owner reads (and may delete) their own; writes go
-- through the functions above (no insert/update grants).
create policy "study read parts own" on public.study_read_parts
  for select using (user_id = auth.uid());
create policy "study read parts remove" on public.study_read_parts
  for delete using (user_id = auth.uid());
create policy "study read places own" on public.study_read_places
  for select using (user_id = auth.uid());
create policy "study plans own" on public.study_plans
  for select using (user_id = auth.uid());
create policy "study plans remove" on public.study_plans
  for delete using (user_id = auth.uid());
create policy "study plan lectures own" on public.study_plan_lectures
  for select using (user_id = auth.uid());
-- Checks: ticked and unticked straight from the phone, on the caller's own plan.
create policy "study plan checks own" on public.study_plan_checks
  for select using (user_id = auth.uid());
create policy "study plan checks add" on public.study_plan_checks
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.study_plans p where p.id = plan_id and p.user_id = auth.uid())
  );
create policy "study plan checks remove" on public.study_plan_checks
  for delete using (user_id = auth.uid());

-- Marathons: the whole group reads them and who is in; writes go through
-- the functions above.
create policy "study marathons read" on public.study_marathons
  for select using (public.study_is_member(group_id));
create policy "study marathon people read" on public.study_marathon_people
  for select using (public.study_is_member(public.study_marathon_group(marathon_id)));

revoke all on public.study_read_parts, public.study_read_places, public.study_plans, public.study_plan_lectures,
  public.study_plan_checks, public.study_marathons, public.study_marathon_people
  from anon, authenticated;
grant select, delete on public.study_read_parts to authenticated;
grant select on public.study_read_places to authenticated;
grant select, delete on public.study_plans to authenticated;
grant select on public.study_plan_lectures to authenticated;
grant select, delete on public.study_plan_checks to authenticated;
grant insert (plan_id, day, task_key) on public.study_plan_checks to authenticated;
grant select on public.study_marathons to authenticated;
grant select on public.study_marathon_people to authenticated;

revoke all on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid), public.study_marathon__over(public.study_marathons),
  public.study_marathon__agenda_ok(jsonb, uuid[]),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  from public, anon;
grant execute on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  to authenticated;

-- ── Realtime: marathons and who is in arrive live on every member's phone.
--  Never the private tables (read parts, places, plans, checks).
do $$
declare t text;
begin
  foreach t in array array['study_marathons', 'study_marathon_people'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
```

### 2.4 Weak points, precisely

For the caller, in one group, at a moment `now` (`study_my_weak_points(p_group, p_now)`):

1. **Evidence.** Every answer in `study_answers` (practice in every mode, past exams, and the live quiz, which copies each player's answer there with mode `'quiz'` at the reveal) to a question that is not retired, has a key, and has a topic. "לא יודעים" (`choice` null) is a wrong answer. Of the answers to one question in one study day (Israel time, from 04:00), **only the first counts**: the second try right after reading the explanation is not evidence.
2. **Weight.** w = 0.5^(age in days / 21): today 1, three weeks ago 0.5, six weeks ago 0.25.
3. **Score.** For a topic (key `lower(btrim(topic))`, across lectures): S = Σ w·correct, N = Σ w, **score = (S + 1.4) / (N + 2)**: two pseudo-answers at 70%, so little evidence reads as "probably fine", not as 0% or 100%.
4. **Status.**
   - **"חולשה"** (`weak`): at least 2 different questions, N ≥ 1.5, score < 0.6, and either a question in the topic is wrong right now (its latest answer, any time of day) or the score is under 0.5.
   - **"כדאי לרענן"** (`watch`): at least 2 different questions and score < 0.75.
   - otherwise `ok` ("מעט נתונים" under two questions).
5. **Detail.** The same score per aspect (the worst one is "בעיקר: …"), the lectures the topic's questions come from, and the three slides most often missed (for "לקריאה בסיכום").
6. **Order.** Score ascending, then more evidence first.

**Worked example (checks ME9-ME12), at 2026-11-15 12:00 in Israel:**

| Topic | Counted answers | S | N | Score | Status |
|---|---|---|---|---|---|
| Primaquine (3 questions; "primaquine " merges by key) | wrong 1 day ago (a right answer 5 minutes later the same day does not count), wrong 2 days ago, right 2 days ago | 0.936 | 2.840 | **0.483** | weak (one question still wrong) |
| Chloroquine (2 questions) | right 30 days ago, right 1 day ago, "לא יודעים" 60 days ago | 1.339 | 1.477 | **0.788** | ok |
| Albendazole (1 question) | right 1 day ago; right again at 03:30 the next night, the same study day, so not counted | 0.968 | 0.968 | **0.798** | ok (one question) |

A month later, with no new answers, Primaquine's three answers weigh 1.06 in all: score 0.572, **"כדאי לרענן"** (ME12). Old mistakes fade toward "unknown", not toward "fine". A retired question and a question without a topic count nowhere (ME11).

The questions design's suggested rule (latest answer correct in under 60% of answered questions) is kept for the per-lecture "נכונות כרגע"; the formula above replaces it for weak points because it uses every answer's time, ignores same-day retries, and treats one wrong answer as too little evidence. Flashcards are shown beside a topic (`again_30d`), not mixed into its score: the requirement is "from practice and quiz results", and a card is a different kind of evidence (one fact, rated by the member).

### 2.5 Every later feature: its user columns join `merge_users`

A new `study_` table with a column that references `auth.users` (corrections, chat, mnemonics, past exams' new tables …) adds its lines to `study_private.merge_users()` in block A, behind `if to_regclass('public.<table>') is not null then … end if;`, with its rule for rows that must stay single (the newer one, the earlier one, the account's). Check I17/ME64 fails until it does: it looks for `update <schema>.<table> set <column> = dst` for every such column in `public` `study_*` tables and in `study_private`.

The sibling designs' merge lines are already inside it, verbatim; their tests that read `study_merge_claim`'s source (P4, M-, J- checks) read `merge_users`'s instead in the build PR. Three platform columns were missing from every merge so far (design-questions' P4b): `study_usage.user_id`, `study_recordings.created_by`, `study_private.jobs.queued_by`; they are in.

### 2.6 Supabase settings (Yoad; research-auth §4, with the correction)

In the project `/study/` uses (Vercel `VITE_STUDY_SUPABASE_URL` if set, else the shared one):

1. **Custom SMTP** (Authentication → SMTP), a verified sending domain, sender "תמצית" `no-reply@…`. Without it, Auth "will refuse to deliver messages to addresses that are not part of the project's team" (open question 1).
2. **Confirm Email ON** (an anonymous `updateUser({ email })` with it off attaches the address unchecked: `internal/api/user.go`, the `user.IsAnonymous && config.Mailer.Autoconfirm` branch). Email OTP expiration 3600; anonymous sign-ins stay on.
3. **Templates** with `{{ .Token }}` only: "Magic link or OTP" (subject `קוד כניסה: {{ .Token }}`) and "Change email address" (subject `קוד לשמירת החשבון: {{ .Token }}`), research-auth §4.4's body.
4. **Site URL** `https://delo-logo-review.vercel.app/study/`; no redirect URLs are needed (codes, not links).
5. **Sessions:** leave single-session, time-box and inactivity timeout off ("Sessions" doc: single session "the session from the most recent sign in will remain active, while the rest are terminated").
6. **SQL Editor:** run `study-schema.sql` with block A; check the members report (§1.8).

---

## 3. API

### 3.1 No new endpoint under `api/study/`, and no call to Claude

Everything here is either Supabase Auth (called by `supabase-js` in the browser) or a Postgres function the browser calls with the member's own token, as it calls `study_join` today. So:

- **No Vercel function** is added (the platform keeps its Hobby function budget, design-platform §3.1), and no environment variable on Vercel.
- **No prompt, no JSON schema, no `study_charge`.** Nothing in identity, progress, the plan or marathons calls Claude. A Claude "coach" (a written weekly summary or advice from the scores) was considered and left out: it would send private scores to a third party (decision 13), cost per member per week, and a deterministic plan can be tested to the minute while a model's advice cannot. The monthly budget (decision 14) is untouched.
- **The one budget-touching path is a link.** A plan task or a marathon step for a lecture with no questions opens the questions design's generation sheet (P2/P3), which shows **"עלות משוערת: כ-$0.30 מהתקציב החודשי של הקבוצה"** and charges the shared ledger as `practice` when someone taps "ליצור". The plan never generates by itself.

### 3.2 The functions (the API of this design)

All take the caller from `auth.uid()`; every one refuses `anon` (I19, ME65).

| Function | Kind | Arguments → result | Errors (`raise exception` text) |
|---|---|---|---|
| `study_merge_offer()` | definer | → `text` (64 hex characters) | `not signed in`, `not anonymous` |
| `study_merge_claim(p_ticket text)` | definer | → `int` 1 (moved), 0 (own ticket) | `not signed in`, `sign in first`, `ticket not found` |
| `study_private.merge_users(src, dst)` | definer, **no grant** | → void (SQL editor only) | none |
| `study_note_reading(p_lecture, p_part, p_anchor, p_done default false, p_seconds default 0)` | definer | → void; saves the place, and with `p_done` the part (first time only) | `not signed in`, `lecture not found`, `bad part` |
| `study_mark_parts(p_lecture, p_parts int[], p_done boolean)` | definer | → `int` rows changed (unknown parts ignored) | `not signed in`, `lecture not found`, `bad part` (over 200) |
| `study_my_lectures(p_group, p_asof default now())` | invoker | → per lecture: `lecture_id, course, title, lecture_date, created_at, status, slides, parts jsonb [{i,t,from,to,chars,ready}], read_at, parts_done int[], part_seconds jsonb {"0":600}, questions, cases, answered, correct_now, first_try, wrong_now, answers, last_answer_at` | none (a stranger gets 0 rows) |
| `study_my_weak_points(p_group, p_now default now())` | invoker | → per topic: `topic_key, topic, score, weight, items, wrong_now, status ('weak'\|'watch'\|'ok'), worst_aspect, aspects jsonb [{aspect,score,items}], lecture_ids uuid[], slides jsonb [{l,n,c}], last_at` | none |
| `study_my_days(p_group, p_days default 28, p_now default now())` | invoker | → per study day: `day, answers, correct, practice_seconds, parts_read, read_seconds` | none |
| `study_plan_save(p_plan, p_group, p_title, p_exam_date, p_courses text[], p_add uuid[], p_drop uuid[], p_daily_minutes, p_days_off int[], p_final_review default true)` | definer | → `uuid`; `p_plan` null = new (the previous active plan is archived) | `not signed in`, `group not found`, `bad title`, `bad date`, `bad minutes`, `bad days`, `bad courses`, `too many lectures`, `lecture not found`, `plan not found` |
| `study_plan_replan(p_plan)` / `study_plan_end(p_plan)` | definer | → void | `not signed in`, `plan not found` |
| `study_marathon_save(p_id, p_version, p_group, p_title, p_starts_at, p_minutes, p_place, p_note, p_lectures uuid[], p_agenda jsonb)` | definer | → `(id, version)`; `p_id` null = new (the creator is "in") | `not signed in`, `group not found`, `bad title`, `bad minutes`, `bad time`, `lecture not found`, `bad agenda`, `marathon not found`, `marathon over`, `conflict` |
| `study_marathon_answer(p_id, p_answer)` | definer | → void; `'in'`, `'maybe'`, `'out'` | `marathon not found`, `marathon over`, `bad answer` |
| `study_marathon_step(p_id, p_from, p_to)` | definer | → `int` the step now on (unchanged if it was no longer `p_from`; = number of steps → ended) | `marathon not found`, `marathon over`, `no agenda`, `bad step` |
| `study_marathon_cancel(p_id, p_cancel)` | definer | → void; `false` brings a cancelled one back while its time has not passed | `marathon not found`, `marathon over` |

Plain table access (PostgREST, RLS): `select` own `study_plans`, `study_plan_lectures`, `study_plan_checks`, `study_read_places`; `insert (plan_id, day, task_key)` and `delete` on `study_plan_checks`; `select` the group's `study_marathons` and `study_marathon_people`.

From the sibling designs (unchanged, called by the progress page and the plan): `study_my_mistakes`, `study_practice_overview` (questions); `study_quiz_open`, `study_quiz_create`, `study_quiz_recent` (quiz); `study_my_card_counts`, `study_my_card_days`, `study_my_card_topics` (flashcards); `groupQuestions`, `groupLive` (platform, client side).

### 3.3 Supabase Auth calls (`supabase-js` 2.108.2, as installed)

| Step | Call | Request (seen by the contract test) |
|---|---|---|
| Save: send | `auth.updateUser({ email })` | `PUT /auth/v1/user` with the anonymous member's token |
| Save: resend | `auth.updateUser({ email })` again (the correction at the top of this design) | the same |
| Save: code | `auth.verifyOtp({ email, token, type: "email_change" })` | `POST /auth/v1/verify` → a new session, same user, `is_anonymous: false` |
| Sign in: send / resend | `auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` | `POST /auth/v1/otp` with `create_user: false` (no user is ever created, so `/board`'s sign-up trigger never fires: research-auth §6) |
| Sign in: ticket | `rpc("study_merge_offer")` | with the **anonymous** token, right before the code is checked |
| Sign in: code | `auth.verifyOtp({ email, token, type: "email" })` | `POST /auth/v1/verify` → the account's session |
| Sign in: merge | `rpc("study_merge_claim", { p_ticket })` | with the **account's** token |
| Sign out | `auth.signOut({ scope: "local" })` / `({ scope: "global" })` | `POST /auth/v1/logout?scope=local` / `global` (auth-js's own docs: "the default `scope` is `'global'`") |

### 3.4 Errors, end to end

- **Auth errors** arrive as `AuthApiError` with `code` from the body's `error_code`, or from `code` when the response carries `x-supabase-api-version` (auth-js `lib/fetch.js` `handleError`; the contract test sends both shapes). `authErrorText` maps them (§1.3 table).
- **Function errors** arrive as PostgREST errors whose `message` is the exception text. The client maps them by exact text: `conflict` → reload the marathon and say so; `marathon over` → reload (it ended); `bad step` → reload; `plan not found` → reload the plan page; `lecture not found` → reload the lists; `ticket not found` during a claim → treat as done (it already ran).
- **Network failures**: the account sheet keeps the step and the ticket in `localStorage`; start-up redeems a stored ticket (A12-A13). The progress page and the plan show their own **"לנסות שוב"**. A reading-place save that fails is dropped silently (the next one carries the newer place); a "part done" save that fails is retried once on `visibilitychange` (MDN: hidden "is the last event that's reliably observable by the page").

---

## 4. Client

### 4.1 New files

| File | Exports | Notes |
|---|---|---|
| `shared/study/day.ts` | `TZ`, `studyDay(ms)`, `dayOfDate(iso)`, `dateOfDay(day)`, `weekday(day)`, `dayStart(day)`, `shortDate(day)`, `WEEKDAY_HE` | Appendix B. The cards design's `fsrs.ts` imports `studyDay` from here (same rule, tested on both clock changes) |
| `shared/study/estimates.ts` | the constants (§4.3), `partChars`, `readMinutes`, `aloudMinutes`, `expectedQuestions`, `practiceMinutes`, `cardMinutes`, `readingSpeed` | Appendix B |
| `shared/study/plan.ts` | `buildPlan(input): Plan`, `taskStatus(task, live): TaskStatus`, types `PlanInput`, `LectureState`, `MarathonIn`, `WeakIn`, `Task`, `PlanDay`, `Plan`, `Live` | Appendix B; pure, no I/O |
| `shared/study/agenda.ts` | `buildAgenda(options)`, `stepOffsets(steps)`, `lateBy(steps, step, stepAt, startsAt)`, `AgendaStep` | Appendix B |
| `src/study/lib/account.ts` | `sendCode`, `resendCode`, `verifyCode`, `finishPending`, `readPending`, `signOutHere`, `signOutEverywhere`, `authErrorText`, `PENDING_KEY`, `RESEND_MS` | Appendix B; takes the client and a storage, so it is tested with a mock |
| `src/study/lib/progress.ts` | `myLectures(groupId, asof?)`, `myWeakPoints(groupId, now?)`, `myDays(groupId, days?)`, `noteReading(lectureId, part, anchor, done?, seconds?)`, `markParts(lectureId, parts, done)`, `readPlace(lectureId)`, `courseRollup(rows): CourseRow[]`, `streak(days, cardDays, today): number`, `ASPECT_HE: Record<Aspect, string>` | Thin RPC wrappers + the roll-ups (§4.6) |
| `src/study/lib/plan.ts` | `activePlan(groupId)`, `planArchive(groupId)`, `savePlan(input)`, `replan(id)`, `endPlan(id)`, `planChecks(id, day)`, `setCheck(id, day, key, on)`, `planPicks(planId)`, `scopeOf(plan, picks, lectures)`, `loadPlan(groupId, userId, plan, now): Promise<{ input: PlanInput; live: Live; plan: Plan }>` | `loadPlan` makes the two `study_my_lectures` calls (§4.3) |
| `src/study/lib/marathon.ts` | `listMarathons(groupId)`, `getMarathon(id)`, `marathonPeople(ids)`, `saveMarathon(m)`, `answerMarathon(id, a)`, `stepMarathon(id, from, to)`, `cancelMarathon(id, on)`, `watchMarathons(groupId, onChange)`, `isOver(m, now)`, `israelInstant(date, time)`, `shareText(m, titles)` | Realtime channel `study-marathons-<groupId>`: `*` on `study_marathons` filtered `group_id=eq.<id>`, and `*` on `study_marathon_people` (RLS limits its events to the group) |
| `src/study/lib/useReadingTracker.ts` | `useReadingTracker(lectureId, sections, opts: { enabled: boolean })` | §4.5 |
| `src/study/components/Account.tsx` | `AccountCard({ session, onOpen })`, `AccountSheet({ mode, onClose, onDone })`, `AccountNudge({ answers })`, `SameNameBanner({ me, members })`, `AccountAnnounce()` | §1.3 |
| `src/study/components/Progress.tsx` | `Progress({ group, session, onGo })`, `TopicsSheet({ topics, onPick, onClose })` | §1.4 |
| `src/study/components/Plan.tsx` | `PlanPage({ group, session, onGo })`, `PlanSetup({ group, plan?, onSaved, onCancel })` | §1.5 |
| `src/study/components/Marathon.tsx` | `MarathonsCard({ group, userId, onGo })`, `MarathonForm({ group, marathon?, onSaved, onCancel })`, `MarathonPage({ group, userId, id, onGo })`, `AgendaEditor({ steps, start, minutes, lectures, onChange })` | §1.6 |
| `supabase/tests/me-identity-test.sql`, additions to `supabase/tests/study.sql` | §6.1 | |

### 4.2 Existing files touched

- **`supabase/study-schema.sql`**: block A appended when identity ships; block B after the practice-questions block.
- **`supabase/tests/stubs.sql`**: append `spec/me-proto/sql/me-stubs.sql` (`auth.jwt()` exactly as Supabase's migration defines it, and `auth.users.is_anonymous`, `created_at`).
- **`supabase/tests/study.sql`**: append `me-test.sql` (§6.1); `me-identity-test.sql` becomes its own file, run on the repo schema alone.
- **`src/study/lib/api.ts`**
  - `signOut()` → removed in favour of `account.ts`'s `signOutHere()` (today's call uses the default **global** scope: `api.ts` L115-117).
  - `ensureSignedIn()` unchanged (anonymous members are still how people join).
  - `Member` gains nothing; the same-name check uses `members()`.
- **`src/study/StudyApp.tsx`**
  - Holds `accountSheet: { mode: AuthMode } | null`, opened by Join, "שלי", the nudges and the banners; renders `<AccountSheet>` over any screen.
  - On start, after `getSession()`: `finishPending(sb, localStorage)` (a stored ticket after a closed app); `"merged"` → `location.reload()`. A pending code step younger than an hour opens the sheet at the code (research-auth §2 rules).
  - `onDone({ userChanged, merged })` → `location.reload()` when either is true; else refresh the session.
  - Routes (with design-platform's `route.ts`): `progress` (`t?`), `plan` (`edit?`), `marathon` (`m?`, `isNew?`, `edit?`); the lecture route gains `mk?`, `read?`, `follow?`. `tabOf`: progress and plan → "me"; marathon → "group", or `null` with `isNew`/`edit`. `?v=plan&m=<id>` → `{ v: "marathon", m }`.
- **`src/study/components/Join.tsx`**: the link **"כבר שמרת חשבון? כניסה עם מייל"** → `onAccount("signin")` (a new prop).
- **`src/study/components/Library.tsx`**: `<AccountAnnounce>` and `<SameNameBanner>` above the courses (anonymous only). Without the platform shell: "יציאה" → **"חשבון"** (the account card in a sheet).
- **`src/study/components/LectureView.tsx`**
  - `useReadingTracker(lectureId, sections, { enabled: flag && sections.some(ready) })`.
  - **Resume:** without `at`, `slide`, `read` or `follow` in the URL, `readPlace(lectureId)`; a place past the first two paragraphs shows a chip under the title **"להמשיך מהמקום שבו עצרת · חלק 4"** (a tap scrolls there; it never scrolls by itself, so reading together is not disturbed).
  - **From a marathon:** `mk` adds **"→ למרתון"** to the header (→ `?v=marathon&m=<mk>`); `read=1` calls `startReading(true)` once the first part renders; `follow=1` follows the first member present with `reading: true`, waiting up to two minutes (**"ממתינים להקראה…"**, the existing waiting state).
  - **"סימון שקראתי"** is unchanged (the group mark); the plan counts a marked lecture as fully read.
- **`src/study/components/SummaryView.tsx`**: none (the tracker reads the existing `data-part` / `data-blk` attributes).
- **`src/study/study.css`**: `.account-card`, `.code-input` (large, `letter-spacing: 0.3em`, `dir=ltr`), `.nudge`, `.stat-tiles`, `.days-strip` (14 columns, `var(--accent)` / `var(--line)`), `.meter`, `.weak-row`, `.chip.weak` (warn tokens), `.chip.watch` (muted), `.task-row` (checkbox 44 px target), `.day-row`, `.agenda-row`, `.now-card`, `.rsvp` (three-segment control, `aria-pressed`). All from the existing tokens, so dark mode follows.
- **design-platform's files**
  - `Me.tsx`: `<AccountCard>` first; rows to progress, mistakes, plan with their summaries (§1.4 M1); its own "יציאה מהמכשיר הזה" is the account card's.
  - `Group.tsx`: `<MarathonsCard>` as card 4.
  - `Shell.tsx` `LiveBanner`: the marathon line (R6), from `watchMarathons`.
  - `Help.tsx`: the privacy note gains **"כתובת המייל נשמרת רק ב-Supabase לצורך כניסה, ולא מוצגת לקבוצה. הקודים נשלחים דרך {ספק המייל}."** (design-platform §1.D already reserved it) and **"ההתקדמות, הציונים, הטעויות ותוכנית הלמידה גלויים רק לך. מרתונים ומי נרשם אליהם גלויים לכל הקבוצה."**; the help screen gains a row **"מרתוני למידה"**: **"ב״יחד״: קובעים ערב למידה עם הקבוצה, בוחרים הרצאות, ומסמנים מי בפנים. בזמן המרתון רואים מה עושים עכשיו: קריאה בקול, מבחן קבוצתי או הפסקה."** (the platform's row "ההתקדמות שלי ותוכנית" stays as written).
- **design-questions' practice session**: two session keys, `t.<topic key>` (active keyed questions whose `lower(btrim(topic))` is the key, weakest-first by the same selection as `c.`) and `m.<lecture id>` (the caller's mistakes in one lecture: `study_my_mistakes(p_group, p_lecture)`, which already takes the lecture).
- **design-quiz's room**: with `mk` in the URL, the end screens (E1, E2) add **"חזרה למרתון"**, and setup keeps `mk` when it opens the room.
- **README.md** (study section): "Identity is per device" becomes the saved account; the setup steps of §2.6; the members report; marathons; the plan.

### 4.3 The plan, specified (`shared/study/plan.ts`, Appendix B)

**Inputs** (assembled by `loadPlan`)

- `today`: the study day of now (`studyDay(Date.now())`).
- `t0` = the later of `dayStart(today)` and the plan's `replanned_at` (and its `created_at` on its first day). **Progress as of `t0`**: `study_my_lectures(group, t0)` for the lectures in scope, `study_my_weak_points(group, t0)` for its topics. Lectures uploaded and questions written after `t0` join tomorrow (or after "לסדר מחדש את היום").
- **Scope**: every lecture whose trimmed `course` is in `plan.courses`, plus `study_plan_lectures.included`, minus `included = false`; ordered as the course was taught: course (the library's order), `lecture_date`, then `created_at`.
- **Marathons**: not cancelled, not over, between today and the exam, where the caller's answer is `in`; `day = studyDay(starts_at)`.
- `readSpeed = readingSpeed(parts the caller finished with seconds ≥ 30)`: characters a minute, 900 until three parts were timed, then their own, clamped 400-2,000.
- Flashcards (when in-app review is on): `cardsToday = cardMinutes(learning_due + review_due)` from `study_my_card_counts`; `cardsDaily` = the average of the last 7 study days' reviews from `study_my_card_days`, in minutes. Both capped at 30% of the day.

**Constants** (`shared/study/estimates.ts`)

| Constant | Value | Basis |
|---|---|---|
| Characters per slide, for parts not written yet | 1,130 | **Measured**: the antiparasitics summary, 43,091 characters for 38 slides |
| Silent reading | 900 characters a minute | Assumed (about 140 words a minute at the measured 6.5 characters a word); replaced by the member's own |
| Reading aloud with talk | 560 characters a minute | Assumed (110 words a minute, plus a quarter for discussion); the 38-slide summary comes to 82 minutes |
| A question / a clinical case / a mistake | 1.25 / 2 / 1.5 minutes | Assumed (answer and read five explanations) |
| A flashcard | 8 seconds | Assumed |
| A group-quiz question | 1.5 minutes | The quiz design's default 60 s plus 30 s for the reveal |

**Days.** Every study day from today to the day before the exam. Weekdays in `days_off` are off (if all are, the last day is kept). With `final_review` and at least 4 study days, the last `clamp(round(0.2 × study days), 1, 5)` study days are **review days**. A day's solo minutes = `daily_minutes − cards − marathon minutes` (not below 0).

**Work** (each item is a task with minutes; keys are stable, so a tick and a progress count find their task):

1. `mistakes:<lecture>` for each lecture with `wrong_now > 0`: 1.5 minutes each. These go **first**.
2. For each lecture in order:
   - `read:<lecture>:<a>-<b>`: its unread parts (not in `parts_done`, and none if the lecture is marked read), in runs of consecutive parts of at most `clamp(0.6 × daily_minutes, 20, 90)` minutes. A part takes `max(3, ⌈chars ÷ readSpeed⌉)` minutes (1,130 characters a slide for a part not written yet). No outline yet: one `read:<lecture>:all` from its slides. **A lecture in one of the member's marathons is not planned for reading**: the marathon reads it.
   - `practice:<lecture>`: its unanswered questions, `⌈mcq × 1.25 + cases × 2⌉` minutes (cases in the lecture's proportion). No questions yet: `generate:<lecture>` for `clamp(round(slides ÷ 2.5), 6, 25)` questions (the questions design's round size), 40% cases.
3. On review days only: `weak:<topic key>` for up to six topics (weak before watch), 10 minutes each; then `review:<lecture>` for every lecture, `clamp(round(0.15 × its reading minutes), 10, 30)`.

**Pace.** The first-pass minutes ÷ (reading days − a buffer of 15% of them, when there are at least 5) = the minutes a reading day aims for (at least 20). Review days aim for the review's minutes ÷ review days, or the whole day while first-pass work is left over.

**Filling the days, in order** (first fit, deterministic):

- On each day that is not off: the marathon task(s), then the cards task, then work items in queue order. A reading day caps at 85% of its solo minutes (room for the new mistakes the practice will make).
- A task is **ready** unless it is the practice (or generation) of a lecture whose reading is not all placed on earlier days, or not after its marathon: **practice comes at least a day after the reading**.
- Tasks are started while the day is under its pace; a task may end up to a quarter past it. A task that does not fit is cut where it can be: reading at a part boundary, questions and mistakes by count (at least 4). A task too large for an empty day is placed whole (never starve).
- Review days take the leftover first-pass work before their own.
- Whatever is left is **unscheduled**; its minutes are the shortfall (reading, practice, mistakes) and the review short (review tasks).

**Today, frozen and ticked.** Today's list is `buildPlan(as of t0).days[0]`; `taskStatus(task, live)` ticks it from **live** numbers (`study_my_lectures(group, now)`, today's card counts, ended marathons, today's `study_plan_checks`):

| Task | Done when | Progress shown |
|---|---|---|
| read | every part in the range is in `parts_done` now, or the lecture is marked read | parts done of the range |
| practice / generate | answered now − answered at `t0` ≥ count, or every question answered | answered since `t0`, of count |
| mistakes | `wrong_now` is 0, or it fell by count since `t0` | fixed, of count |
| cards | nothing due | — |
| marathon | the marathon ended | — |
| weak, review | ticked by hand | — |
| any | ticked by hand (`study_plan_checks` for today) | — |

**Tested** (§6.2): on four lectures of the real summary's part sizes, 120 minutes a day, Fridays and Saturdays off, 21 days: 15 study days of which 3 are review days; reading days carry 18-39 minutes; the first pass ends on reading day 9 of 12; every part is read once; every question is practised, always after its reading; the review is spread over two review days; nothing is unscheduled. With 12 lectures and 30 minutes a day for a week, the plan reports 760 minutes short instead of overfilling. A Thursday marathon on two lectures takes their reading and moves their practice after it.

### 4.4 The marathon agenda (`shared/study/agenda.ts`, Appendix B)

From the form's choices: the minutes, the lectures (in the order chosen), "a group quiz after each lecture" (n questions, mode), a break every 60/90/120 minutes, of 10/15/20 minutes.

1. **פתיחה**, 5 minutes.
2. For each lecture: **read** steps over its parts, aloud at 560 characters a minute, in runs of at most 45 minutes (a lecture with no outline: one step from its slides); then, when chosen and the lecture has at least 3 questions, a **quiz** of `min(n, questions)` questions, `⌈n × 1.5⌉ + 2` minutes.
3. Before a step that would take the work since the last break past the break interval (once 30 minutes have passed), a **break**.
4. If at least 20 minutes remain before the planned end (after 10 for open questions and 5 for the wrap): **free practice** (at most 120 minutes).
5. **שאלות פתוחות**, 10 minutes; **סיכום**, 5 minutes.

The fit line compares the total to the minutes. Each step's planned start is the marathon's start plus the minutes before it (`stepOffsets`); "מאחרים ב-X דק׳" is `step_at` minus that planned start (`lateBy`).

Example (tested): 240 minutes on the 38-slide lecture and a 12-slide lecture without an outline or questions: intro, read ×3 (82 minutes in all), break, quiz (10 questions), read, break, free practice, open questions, wrap.

### 4.5 The reading tracker (`useReadingTracker`)

- Every 2 seconds while the page is visible (`document.visibilityState === "visible"`) and the summary is on screen, it takes the paragraph at the reading line with LectureView's existing `placeOnScreen()` and adds 2 seconds to that part's time on screen. Following the reader counts: the follower's screen moves with the reader.
- A part is **done** when its last paragraph (`[data-part=p] [data-blk]` with the highest number) has reached the reading line **and** its time on screen is at least `max(20 s, 40% of chars ÷ 15)` (40% of its reading time at 900 characters a minute). Jumping to the end with the table of contents does not count. Then `noteReading(lecture, part, anchor, true, seconds)`, once per part per visit.
- The **place** is saved when it changed and 15 seconds passed since the last save, and on `visibilitychange` to hidden.
- It stores nothing in `localStorage` and nothing while the flag is off.

### 4.6 Key sketches

```ts
// src/study/lib/plan.ts — one plan, the same on every device
export async function loadPlan(groupId: string, userId: string, plan: PlanRow, now = Date.now()) {
  const today = studyDay(now);
  const t0 = new Date(Math.max(dayStart(today), Date.parse(plan.replanned_at ?? plan.created_at))).toISOString();
  const [lectures, picks, startRows, liveRows, weak, marathons, cards] = await Promise.all([
    listLectures(groupId), planPicks(plan.id), myLectures(groupId, t0), myLectures(groupId),
    myWeakPoints(groupId, t0), listMarathons(groupId),
    flags.cardsReview ? Promise.all([myCardCounts(groupId), myCardDays(groupId, 7)]) : null,
  ]);
  const mine = new Map((await marathonPeople(marathons.map((m) => m.id)))
    .filter((p) => p.user_id === userId).map((p) => [p.marathon_id, p.answer]));
  const scope = scopeOf(plan, picks, lectures);                    // ids, in teaching order
  const byId = new Map(startRows.map((r) => [r.lecture_id, r]));
  const input: PlanInput = {
    today,
    settings: { examDate: plan.exam_date, dailyMinutes: plan.daily_minutes, daysOff: plan.days_off, finalReview: plan.final_review },
    lectures: scope.filter((id) => byId.has(id)).map((id) => toState(byId.get(id)!)),
    marathons: marathons.filter((m) => !isOver(m, now) && mine.get(m.id) === "in")
      .map((m) => ({ id: m.id, day: studyDay(Date.parse(m.starts_at)), minutes: m.minutes, lectureIds: m.lecture_ids })),
    weak: weak.filter((w) => w.status !== "ok" && w.lecture_ids.some((l) => scope.includes(l)))
      .map((w) => ({ key: w.topic_key, topic: w.topic, status: w.status as "weak" | "watch" })),
    readSpeed: readingSpeed(timedParts(liveRows)),
    cardsToday: cards ? cardMinutes(dueNow(cards[0])) : 0,
    cardsDaily: cards ? averageMinutes(cards[1]) : 0,
  };
  const live: Live = { start: new Map(input.lectures.map((l) => [l.id, l])), now: toLive(liveRows), cardsDue: cards ? dueNow(cards[0]) : 0,
                       endedMarathons: new Set(marathons.filter((m) => isOver(m, now)).map((m) => m.id)),
                       checks: new Set(await planChecks(plan.id, dateOfDay(today))) };
  return { input, live, plan: buildPlan(input) };
}
```

```tsx
// src/study/components/Marathon.tsx — the live step, idempotent on two taps
const next = async () => {
  const at = await stepMarathon(m.id, m.step, m.step + 1);       // returns the step really on
  if (at !== m.step + 1) {
    const fresh = await getMarathon(m.id);                         // who moved it, from the row
    say(`השלב כבר התקדם בטלפון של ${nameOf(fresh?.updated_by ?? "")}.`);
  }
  // the Realtime UPDATE (full row) brings the new step, version and step_at to every phone
};
```

```ts
// src/study/StudyApp.tsx — start-up
useEffect(() => {
  void getSession().then(async (s) => {
    setSession(s);
    if (s && (await finishPending(sb!, localStorage)) === "merged") location.reload();
    const p = readPending(localStorage);
    if (p && !p.ticket) setAccountSheet({ mode: p.mode, resume: true });   // back from Mail
  });
  return onAuthChange(setSession);
}, []);
```

### 4.7 State, refreshes and roll-ups

**Component state**

- **`AccountSheet`**: `mode` (`"save" | "signin"`), `step` (`"email" | "code" | "done"`), `email`, `code`, `busy`, `error` (Hebrew, from `authErrorText`), `resendAt` (the countdown), `result` (`{ userChanged, merged }`). The pending step lives in `localStorage` `study-signin`, not in React state, so a reload resumes it.
- **`Progress`**: `lectures`, `weak`, `days`, `cardCounts`, `cardDays`, `cardTopics` (each `null` while loading, kept apart so one failure hides one block), `topicsOpen`, `expandedCourse`. No Realtime: the private tables are not published. It refetches on `visibilitychange` to visible (another device may have practised meanwhile).
- **`PlanPage`**: `plan` (`undefined` loading, `null` none), `loaded` (`{ input, live, plan }` from `loadPlan`), `expandedDay`, `confirm` (replan / end), `busyKey` (a tick being saved). A tick updates `live.checks` at once and rolls back on error. Refetches the live numbers (not `t0`'s) on `visibilitychange` to visible.
- **`PlanSetup`**: `draft` (title, date, courses, picks, minutes, days off, final review), `preview` = `buildPlan(draftInput)` recomputed 200 ms after the last change, `error`.
- **`MarathonPage`**: `m`, `people`, `openQuiz` (`study_quiz_open`), `reader` (the platform's `groupLive`: who reads which lecture aloud), `now` (a 30-second tick for the countdowns and "מאחרים ב-"), `confirm`. `watchMarathons` delivers full rows; a row whose `version` is higher replaces `m`.
- **`MarathonForm`**: the fields, `agenda` (`AgendaStep[]`), `agendaEdited` (ask before rebuilding), `version` (sent with the save), `error`.

**Roll-ups** (`src/study/lib/progress.ts`, from `study_my_lectures` rows)

- A lecture is **read** when `read_at` is set or every part is in `parts_done`; otherwise "נקראו n מתוך N חלקים".
- Lecture practice: **answered / questions**; **נכונות כרגע** = `correct_now / answered`; **בפעם הראשונה** = `first_try / answered`; **טעויות** = `wrong_now`.
- A course: lectures read / lectures; Σ answered / Σ questions; **נכונות כרגע** = Σ `correct_now` / Σ `answered` (a share of questions, not an average of lectures).
- **השבוע** (the last 7 study days of `study_my_days` and `study_my_card_days`): Σ answers and Σ correct / Σ answers; Σ card reviews; Σ parts read.
- **רצף**: consecutive study days with answers + parts read + card reviews > 0, ending today if today has any, else yesterday.
- A weak row's **"x מתוך y שאלות נכונות כרגע"** = `items − wrong_now` of `items` (§2.4).

---

## 5. Edge cases and failure modes

### Identity

- **The code never arrives** (spam, the university's filter, SMTP not set up): "לא הגיע? כדאי לבדוק בתיקיית הספאם."; `email_address_not_authorized` names the missing SMTP. Yoad's smoke test (§6.6) includes Gmail and the university's mail.
- **A typo in the address**: nothing is bound until the code is verified; "תיקון המייל" sends again to the right address (with Confirm Email ON; research-auth §7).
- **The code is wrong or old**: `otp_expired`, the copy offers a new code. Codes live an hour; the sheet drops a pending step older than that.
- **"שליחה מחדש" too soon**: the button counts down 60 s, matching Supabase's one-a-minute OTP window; a 429 still maps to "אפשר לבקש קוד חדש בעוד דקה."
- **The resend that would have sent nothing** (research-auth's `resend({type:"email_change"})` for an anonymous member): replaced by `updateUser` again (top of this design; contract check A14).
- **iOS reloads the app while the person is in Mail**: the pending step in `localStorage` reopens the sheet at the code (A2 check).
- **The merge's answer is lost** (network, app closed right after the code): the ticket stays in `localStorage`; start-up redeems it; `ticket not found` means it already ran (A12-A13, I10).
- **A ticket older than 30 minutes**: cannot happen in the flow, which takes it right before the code is checked; refused by the server if it did (I12).
- **Two devices folding in at the same moment**: `merge_users` takes a per-account advisory lock, so the second runs after the first and finds its rows already single.
- **The same person with two saved accounts** (two addresses): cannot be merged from the app (each side is a saved account). Yoad can fold one into the other with `merge_users` in the SQL editor; the other address stays as an empty login.
- **A ghost** (anonymous member whose device is gone): Yoad folds it by hand (§1.8 step 5); until then the group sees a duplicate name, and the same-name banner tells the other device to sign in rather than join again.
- **Safari tab and Home Screen app on one phone** are two identities (separate storage); "כבר שמרתי חשבון במקום אחר" in either folds it.
- **Signing out while anonymous** loses that member for good: the dialog says so first and offers to save (A5).
- **Sign-out everywhere** revokes every device's refresh token, but an access token already issued "will still be valid until it expires" (auth-js's `signOut` docs), so a lost phone keeps its session up to the token's lifetime (the "Sessions" doc's default of 1 hour) and then is signed out.
- **Deleting a user in the dashboard** cascades: `study_groups.created_by` would take the group with it. The members report and `merge_users` are the tools; never delete the group creator's user (research-auth §3).
- **`/board`'s sign-up trigger**: sign-in never creates a user (`shouldCreateUser: false`), and saving updates an existing one, so `board_handle_new_user` (insert only) never runs for study members.
- **Private results before saving**: they belong to the anonymous user id, which a save keeps; only a member who loses the device before saving loses them. The nudge (A6) is there for that.

### Progress

- **Two names for one topic** ("Primaquine" vs "primaquine phosphate"): merged only by case and spaces; the questions design's prompt asks for the drug, organism, disease or process name as the lecture writes it, which keeps them together. Different names stay different topics (shown, not hidden).
- **Retired questions and items without a key** never count, not even old answers to them (ME11).
- **Past-exam items without a lecture** count in their topic's weak point but in no lecture's numbers.
- **A voided quiz round** is not copied into anyone's answers (quiz design), so it does not count.
- **"לא יודעים"** is a wrong answer, so honest gaps show up as weak points.
- **Many answers**: the functions run over the caller's own rows only (index `study_answers_mine`); a semester is a few thousand rows.
- **A phone's clock is wrong**: every number is computed with the database's clock; only "which study day is today" uses the phone's, which moves today's list at most by one day near 04:00.
- **Abroad**: everything stays on Israel time, on purpose (the group's days).
- **Reading tracked wrongly**: fast scrolling does not count (40% of the part's reading time on screen); reading the PDF or on paper is ticked by hand in the plan, which also marks the parts.
- **A lecture is deleted**: its progress rows go with it (cascade); a plan and a marathon simply stop showing it; a marathon step for it shows **"ההרצאה נמחקה"** and can be removed in the editor.
- **A summary is split into parts again**: the old parts' "read" marks are cleared by the trigger (ME67); the reading place may point at a different paragraph, which only affects the "continue" chip.

### The plan

- **The exam date passes**: N4. **The exam is tomorrow**: one study day, no review days.
- **Nothing in scope** (no lecture yet in the chosen courses): **"עוד אין הרצאות בתוכנית. כשיעלו הרצאות בקורס, הן ייכנסו לתוכנית לבד."**
- **Not enough time**: the shortfall banner and "מה לא נכנס"; days are never filled past 85% (reading days) or the daily minutes, except one task too large for any day, which is placed whole on an empty day (P14).
- **Missed days**: the work was not done, so the next day's plan contains it again; the pace rises; if it no longer fits, the shortfall appears.
- **Work done early**: tomorrow's plan no longer contains it; "אפשר להתקדם" shows tomorrow's first tasks once today is done.
- **Mid-day changes** (a new lecture, new questions, an edited plan): today's list stays as built at 04:00 until "לסדר מחדש את היום" or a saved edit (which sets `replanned_at`); tomorrow includes them.
- **Phone and laptop on the same day**: the same `t0` (04:00 or the stored `replanned_at`) and the same pure function give the same list (P10).
- **A ticked read task** marks its parts read; unticking unmarks them. A ticked practice task counts as done today only; unanswered questions come back tomorrow.
- **No in-app flashcards** (the member uses Anki): no cards task (the app cannot see Anki's progress).
- **Several exams**: one active plan per member per group; a new plan archives the current one. Two plans side by side are left for later.
- **A marathon the member is "in" is cancelled**: tomorrow's plan schedules its lectures for solo reading again (or today's, after "לסדר מחדש את היום").

### Marathons

- **Two members edit at once**: the second save gets `conflict` and reloads (ME39).
- **Two taps on "לשלב הבא"**: one step forward; the second phone is told (ME42).
- **Nobody presses "סיום"**: the marathon counts as over 3 hours after its planned end (no cron needed), and answers and steps are refused.
- **The reader's phone locks**: follow-the-reader already waits two minutes, then ends following; another member can take over reading.
- **A quiz is already open in the group** (one per group, quiz design): the step shows "להצטרף" to that quiz.
- **A lecture without questions** in a quiz step: the step says so and links to generating them (with the cost shown there).
- **Cancelled by mistake**: the toast's "ביטול" brings it back (`study_marathon_cancel(id, false)`, ME48).
- **A marathon past midnight**: the plan puts it on the study day it starts.
- **Date and time entered in Israel time**: `israelInstant(date, time)` converts with the zone's offset on that date (the `dayStart` method, tested on both clock changes), not the phone's zone.
- **A member who said "לא הפעם"** can still join live; the answer is only for planning.
- **Calendar files** (.ics) are left out: RFC 5545 could not be read here (rfc-editor.org and ietf.org are blocked), and how a Home Screen app hands a `text/calendar` file to the iPhone's Calendar was not tested. WhatsApp sharing covers the group's habit; a calendar file can follow once both are checked.

---

## 6. Tests

### 6.1 SQL (done here; add to `supabase/tests/`)

How it was run (the repo's method; throwaway databases only):

```bash
spec/me-proto/run-identity.sh   # stubs + me-stubs, board, study-schema x2, me-identity x2, then me-identity-test.sql;
                                # then the repo's study.sql with block A loaded (FAIL count)
spec/me-proto/run-sql.sh        # stubs + platform stubs + me-stubs, board; study-schema, platform, questions,
                                # questions-hold, quiz, cards, me-identity, me (all x2); then study.sql + me-test.sql;
                                # then study.sql and each sibling's test with everything loaded (FAIL/ERROR count)
```

**Block A alone** (`me-identity-test.sql`, 24 lines, all as expected; output in `spec/me-proto/out/identity.txt`):

- I1-I2b: a 64-character ticket; the ticket table and `merge_users` are out of the API's reach (`permission denied for schema study_private`).
- I3-I5: an anonymous caller cannot redeem; a saved account cannot offer itself; a wrong ticket is refused.
- I6-I9: after the claim, one membership (the account's), read marks deduplicated per lecture, the laptop's lecture now the account's.
- I10-I12: a ticket works once; the account's own ticket returns 0; a 31-minute-old ticket is refused.
- I13-I15: the members report; Yoad folds a ghost by hand; its comment is now the account's.
- I16-I17: the 5 user columns of the repo's tables are all in `merge_users`.
- I18: the safe clean-up would delete exactly the two merged-away, empty, old anonymous users.
- I19: `anon` cannot call it. Then the repo's `study.sql` with block A loaded: **0 FAIL**.

**Block B and the merge across every feature** (`me-test.sql`, appended to `study.sql`, 83 lines, all as expected; output in `out/sql.txt`):

- ME1-ME8: per-lecture numbers exact (questions, cases, answered, right now, first try, wrong now, answers), `p_asof` hides later answers and parts, a member sees only their own, a stranger gets nothing.
- ME9-ME13: weak points to three decimals (§2.4 table), the 04:00 boundary, a retired question and an empty topic excluded, decay after a month, one wrong answer is not a pattern.
- ME14: activity days in Israel study days (an answer at 03:30 counts for the day before).
- ME15-ME21: reading through the functions; an unknown part refused; marking by hand; no direct writes; members cannot see each other's parts or places; a stranger refused.
- ME22-ME33: plans: create, archive on a new one, edit keeps the id and replaces the picks, five invalid inputs refused with their exact errors, ticks only on one's own plan, no direct writes, replan and end, a stranger refused.
- ME34-ME51: marathons: create (the creator is in), eight malformed agendas refused, a start in the past refused, answers upserted, versions and `conflict`, no direct updates, two "start" taps move once, next/back/jump, `bad step`, the end, answers refused after it, cancel and bring back, a stranger sees nothing, only the two shared tables are published.
- ME52-ME64: one person on two devices with rows in **every** feature (answers, parts, place, plan, marathon answer, a flashcard both studied, a quiz both played): the merge leaves one "שוהם", the laptop's fix of a mistake counts, the earlier finish and both reading times kept, the newer place and marathon answer kept, the laptop's plan archived, the more recent card memory kept, one quiz seat, **0 rows left** on the laptop's id, and **all 36 user columns** of every study table in `merge_users`.
- ME65-ME67: `anon` refused; a part deleted by a new outline takes its "read" marks.
- With everything loaded: the repo's `study.sql`, `questions-test.sql`, `quiz-test.sql`, `cards-test.sql`: **0 FAIL/ERROR lines each**.

### 6.2 TypeScript (done here: `tsc` strict with the repo's options, Node 22)

`spec/me-proto/test/run.ts`, **64 checks pass** (`out/ts.txt`). In the build these move to a `node` test script next to the cards design's.

- D1-D12: the study day at 12:00, 03:30, 04:00, summer time, `dayStart` in winter, summer, on 27 Mar 2026 (the clocks go forward) and on 25 Oct 2026 (they go back), weekdays, Hebrew short dates, the questions round size, reading speed.
- P1-P26 (on the real summary's nine part sizes): days, days off, review days, the 85% cap, the even pace (first pass ends on reading day 9 of 12), each part read once, practice after reading, every question planned, the review spread, no shortfall, determinism, mistakes first, resuming at part 4, overload reported (760 minutes short) and lecture order kept, a marathon taking two lectures' reading and moving their practice after it, a 4-hour marathon leaving no solo work, weak topics on review days in order, generation suggested, unwritten parts estimated, no-outline lectures, the cards slot and its 30% cap, no plan on or after the exam day, a plan when every day is off.
- S1-S7: ticking off: parts of a range, a tick by hand, answers since `t0`, mistakes fixed, cards due, a review waiting for a tick.
- A1-A10: the agenda: intro first, open questions and wrap last, reading steps ≤ 45 minutes, quizzes only where there are questions, a break at least every 90 minutes of work, the 38-slide summary at 82 minutes aloud, over-long reported, spare time as free practice that fills the marathon exactly (its break included), offsets, "late by 12", every step passes the SQL's shape check.
- C1-C4: a code step older than an hour dropped, a stored ticket kept, every error has distinct Hebrew copy, no gendered forms.

### 6.3 The sign-in flow against the installed `supabase-js` (done here)

`spec/me-proto/test/auth-contract.mjs`: the compiled `account.ts` with `@supabase/supabase-js` 2.108.2 against a local mock of `/auth/v1/*` and `/rest/v1/rpc/*`. **15 checks pass** (`out/auth-contract.txt`):

- A1-A5 save: `PUT /auth/v1/user` with the anonymous token and the lowercased address; the pending step stored; a wrong code → `otp_expired` → its copy; the right code (spaces dropped) → `verify type=email_change`, the same user, `is_anonymous: false`; nothing pending after.
- A6 `email_exists` → `POST /auth/v1/otp` with `create_user=false`, mode switched to sign-in.
- A7-A10 sign-in with merge: `/otp` with `create_user=false`; then exactly **offer (anonymous token) → verify (type email) → claim (account token)**; merged, user changed, the account's session stored, nothing pending.
- A11 an address nobody saved → `otp_disabled` in the newer error shape (`x-supabase-api-version` + `code`) → its copy.
- A12-A13 a claim answered 503 keeps the ticket; start-up redeems it.
- A14 resend: `PUT /auth/v1/user` again for a save, `/otp` for a sign-in.
- A15 `logout?scope=local` here, `scope=global` everywhere.

### 6.4 Playwright e2e (the plan for the build; mocked Supabase)

Against a test build (`VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key VITE_STUDY_ACCOUNT=1 VITE_STUDY_PROGRESS=1 VITE_STUDY_MARATHONS=1 npx vite build --outDir <dir>`), extending `scratchpad/scripts/study-together-e2e.js`'s REST and Phoenix 2.0.0 Realtime mocks. iPhone viewport 390×844, light and dark (`colorScheme`), RTL screenshots of each screen.

Mock additions: `PUT /auth/v1/user`, `POST /auth/v1/{verify,otp,logout}` (answers as in §6.3's mock; errors as `{ error_code, msg }`), `POST /auth/v1/signup` (anonymous), and RPCs `study_merge_offer`, `study_merge_claim`, `study_my_lectures`, `study_my_weak_points`, `study_my_days`, `study_my_mistakes`, `study_my_card_counts`, `study_my_card_days`, `study_note_reading`, `study_mark_parts`, `study_plan_save`, `study_plan_replan`, `study_plan_end`, `study_marathon_save`, `study_marathon_answer`, `study_marathon_step`, `study_marathon_cancel`, `study_quiz_open`, `study_quiz_create`, `study_quiz_recent`; tables `study_plans`, `study_plan_lectures`, `study_plan_checks`, `study_read_places`, `study_marathons`, `study_marathon_people` (GET, and POST/DELETE for checks). The marathon RPCs update the mock's row and `notify("study_marathons", "UPDATE")` with the full row as `record`.

1. **Save.** "שלי" → "שמירת החשבון עם מייל" → `shoham@example.com` → "שליחת קוד" → the code screen; the field has `inputmode=numeric`, `autocomplete=one-time-code`, `dir=ltr`. Type `111111` → "הקוד שגוי או שפג תוקפו…"; type `123456` → it submits at 6 digits → "החשבון נשמר…"; the card now shows the address. No reload happened (a `window.__loaded` marker survives).
2. **Reload mid-flow.** Send a code, reload the page → the sheet is back at the code with the address.
3. **`email_exists`.** Save with `taken@example.com` → the sign-in copy "המייל הזה כבר שמור בחשבון…".
4. **Device B with a merge.** A second context with an anonymous session: "כבר שמרתי חשבון במקום אחר" → code → the mock sees `study_merge_offer` (anonymous token), `/verify`, `study_merge_claim` (account token) in that order → "התגובות, הסימונים וההתקדמות…" → a reload → the library greets the account's name; the member list has one "שוהם".
5. **A fresh device.** Join → "כבר שמרת חשבון? כניסה עם מייל" → `nobody@example.com` → the `otp_disabled` copy; with `shoham@example.com` → the library, with no join code.
6. **Sign out.** Anonymous: "יציאה מהמכשיר" → "לצאת בלי לשמור?" first; saved: `/logout?scope=local` is called; "יציאה מכל המכשירים" asks, then `scope=global`.
7. **Progress.** With mocked rows: tiles "86 / 74% נכונות", the 14-day strip (14 `li` with `aria-label`s), "טעויות לחזרה · 12" linking to `?v=practice&s=m`, two weak rows with chips "חולשה" / "כדאי לרענן" and their two links, a course card that expands to lecture rows. The anonymous nudge shows, "אחר כך" hides it after reload. No request ever carries another member's id.
8. **Plan.** "יצירת תוכנית" → fill the form → the preview line → "יצירת התוכנית" → `study_plan_save` with the exact arguments; the plan page lists today's tasks from `buildPlan`; tick a review task → `POST study_plan_checks`; tick a read task → also `study_mark_parts(..., true)`; "לסדר מחדש את היום" asks, then `study_plan_replan`.
9. **Marathon, two phones.** Shoham creates one (form → agenda preview with times → "קביעת המרתון" → the share sheet); Noa's "יחד" shows it within a second (Realtime INSERT); Noa taps "אני בפנים" → Shoham's card shows "בפנים: שוהם, נועה". Shoham taps "להתחיל את המרתון" → both phones show step 1; both tap "לשלב הבא" together → one moves, the other shows "השלב כבר התקדם בטלפון של שוהם.". The read step's "לעקוב אחרי ההקראה" opens `?l=…&follow=1&mk=…` and follows Shoham's reading (the existing presence mock); "→ למרתון" returns. The quiz step's "לפתוח את המבחן" calls `study_quiz_create` and opens `?v=quiz&q=…&mk=…`.
10. **Accessibility.** Every screen: one `h1`, buttons ≥ 44 px, `aria-pressed` on RSVP and day chips, the code field labelled, status text not by colour alone, `prefers-reduced-motion` respected (no smooth scroll on "להמשיך").

### 6.5 Generated content: none from Claude; a rubric for plans and agendas

Nothing in this design is written by a model, so there is no prompt to judge. What the app "writes" is the plan and the agenda; besides the automatic checks (§6.2), a person (or a judging agent) reads three sample outputs from `buildPlan` (the base case, the overload case, the marathon case, and an agenda: `node dist/test/run.js --print`; the printout is `spec/me-proto/out/plan-samples.txt`) against this rubric, each item pass/fail:

1. A student could follow today's list in the stated minutes (the sum matches the day's capacity within 25%).
2. Nothing is planned on a day off, on the exam day or after it.
3. Every lecture in scope is read before it is practised, and practised at least a day later.
4. Open mistakes appear before new material.
5. The last days are review days with weak topics first, when there are at least four study days.
6. An overloaded plan says how much is missing and what, rather than overfilling days.
7. A marathon the member joined replaces solo reading of its lectures.
8. Labels are Hebrew, gender-neutral, with English names in `<bdi>`, parts numbered from 1.
9. An agenda alternates reading and activity, has a break at least every 90 minutes of work, and ends with open questions and a wrap.
10. The agenda's total is within the marathon's minutes, or the overrun is stated.

### 6.6 Live checks (Yoad, after release; read-only or his own account)

- research-auth §4 step 9: save on the iPhone Home Screen app with his own address, sign in on a laptop, check one member; sign out on the laptop and check the phone stays signed in. Also Gmail and the university's mail (spam folder).
- The members report (§1.8) after the group moved.
- In the SQL editor, read-only: `select count(*), count(distinct user_id) from study_read_parts;` (the tracker writes), `select status, count(*) from study_plans group by 1;`, `select state, count(*) from study_marathons group by 1;`.
- On a phone: whether iOS offers the emailed code above the keyboard (`one-time-code`), and how `type="date"` / `type="time"` look in Hebrew.

---

## 7. Cost per use (USD)

| Use | Claude (the group's monthly budget) | Other services |
|---|---|---|
| Saving an account, signing in on a device | **$0** | one email each (plus resends) through the SMTP provider |
| Opening "ההתקדמות שלי" | **$0** | 4-6 database calls (`study_my_lectures`, `study_my_weak_points`, `study_my_days`, and the cards' two when on) |
| Opening the plan | **$0** | 6-8 database calls; the plan itself is computed on the phone |
| Reading a lecture | **$0** | one small `study_note_reading` call per 15 s of reading at most, and one per part finished |
| A marathon | **$0** of Claude for the marathon itself; its quizzes use stored questions (quiz design: "$0 of Claude per quiz") | Realtime messages, below |
| A plan task or marathon step "ליצירת שאלות" | whatever the questions design charges (about $0.28 for a 15-question round, its §7), only when a member taps "ליצור" there | — |

**The arithmetic, where there is any**

- **Claude:** no call anywhere in this design, so `STUDY_MONTHLY_USD` (decision 14) is unaffected. Every Claude call stays in the features that already charge the ledger.
- **Emails at the move to saved accounts** (§1.8): 6 members × (1 save + about 2 other devices or browsers) ≈ **18 emails**, then about one a month per member (a new phone, a cleared browser). Supabase allows 30 emails an hour once custom SMTP is set (research-auth §4.2), so even all six on one evening fit. The provider's price was not checked (open question 1); the volume is in the range providers call free tiers, but that is not verified here.
- **Realtime for one marathon:** about 30 row changes (creation, about 10 answers, about 12 steps, a few edits), each delivered to about 6 subscribed phones: **≈ 180 messages**, plus the same for each member watching the banner. The quiz design cites Supabase's free plan at 2 million messages a month; a marathon a week is under 0.1% of it.
- **Database size:** reading parts ≈ 6 members × 60 lectures × 8 parts ≈ 2,900 rows of ~50 bytes, under 1 MB with indexes; places, plans, checks and marathons are a few hundred rows. Nothing here stores text beyond names and a 500-character note.
- **Vercel:** no function and no new request path (the platform's 12-function Hobby budget is untouched).

---

## 8. Open questions only Yoad can answer

1. **The sending domain and provider for the codes.** Without custom SMTP, Supabase sends only to the project team's addresses (research-auth §4.1), so nothing in identity can ship. Which domain can he add SPF/DKIM records to (`vercel.app` cannot be used), and which provider (Resend, Postmark, SES, Brevo, …)? This blocks release 1.
2. **Nudge or require?** This design lets anonymous members use practice, cards and the plan, with a "שמירת החשבון" card on every private screen (nothing is lost by saving later, unless the phone is lost first). The alternative is to require a saved account before the first private answer, which costs every member an email address up front. Which?
3. **Who may edit or cancel a marathon:** any member (this design's default: the group of six manages itself, every change shows "עודכן ע״י …", and a cancel can be undone), or only the member who set it? And should the names under **"לא הפעם"** be shown to the group (default: yes, so the organiser knows who is missing), or only counted?

---

## Appendix A: Evidence

### Read in the repo (`/home/user/delo-logo-review`, branch `claude/vigilant-johnson-lgk7xy`, unchanged)

- `supabase/study-schema.sql`: the tables, helpers, the policy-dropping loop (L253-262), the explicit grants (L289-321), the Realtime publication (L379-389), `study_can_use_topic` (L137-151), every user column cascading from `auth.users` (L32, L38, L64, L99, L118), `/board`'s trigger patch (L421-447).
- `supabase/tests/stubs.sql` and `supabase/tests/study.sql`: the stand-ins (no `auth.jwt()`, no `is_anonymous`), the users and `:gid` that `me-test.sql` reuses.
- `src/study/lib/api.ts`: `storageKey: "study-auth"` (L22), `signInAnonymously` with `app: "study"` (L104-113), `signOut()` with the default scope (L115-117), `myGroups`, `members`, `setRead`, `watchGroup` / `watchLecture` (no filter on tables without a group column), `readingRoom`.
- `src/study/StudyApp.tsx` (routes, `onAuthChange`, sign-out path), `components/Join.tsx`, `Library.tsx` ("יציאה", the invite share), `LectureView.tsx` (`placeOnScreen`, the reading room, follow and its two-minute wait, sheets with `{ studySheet: true }`, "סימון שקראתי"), `Together.tsx` (copy patterns, `useSheet`), `study.css` (tokens, dark mode), `generate.ts`, `Upload.tsx`.
- `api/_lib/study.ts` (`memberClient`, `assertBudget`), `api/study/*.ts`, `api/_lib/prompts.ts` (the summary's field lead-ins, used for the aspect names), `README.md` (the study section, "Identity is per device"), `study/index.html` (`apple-mobile-web-app-capable`), `package.json` (supabase-js `^2.45.4`, installed 2.108.2).

### Research and designs this one builds on

- `spec/research-auth.md`, `research-auth-merge.sql`, `research-auth-merge-test.sql`, `research-auth-cleanup-test.sql` (and the copies it read: `scratchpad/authdocs/*.mdx`, `scratchpad/authsrc/*.go`).
- `spec/research-claude.md` (no Claude call here; its ledger is the platform's).
- `spec/design-platform.md` (§1.D, §1.E, §2, §4) and `design-platform.sql`, `design-platform-stubs.sql`.
- `spec/design-questions.md` (§1.2, §2.2, §2.3, §2.4) and `questions-proto/sql/questions.sql`, `questions-test.sql`.
- `spec/design-quiz.md` (§1.2-§1.4, §2.2-§2.5) and `quiz-proto/sql/quiz.sql`, `questions-hold.sql`, `quiz-test.sql`.
- `spec/design-cards.md` (§2.1-§2.4) and `cards-proto/sql/cards.sql`, `cards-test.sql`, `cards-proto/src/fsrs.ts` (`studyDay`).

### Documentation and sources (each read for a claim above)

- **Supabase Auth server**, github.com/supabase/auth `master`:
  - `internal/api/resend.go` (fetched for this design on 2026-11-15, copy `spec/_me-docs/auth-resend.go`): `Resend` finds the user with `models.FindUserByEmailAndAudience(db, params.Email, aud)` and, for `email_change`, returns 200 without sending when `user.EmailChange == ""` — the basis of the correction.
  - `internal/models/user.go` (research-auth's copy): `FindUserByEmailAndAudience` is `LOWER(email) = ?` (L761-762); the columns `email` (L30), `email_change` (L51), `last_sign_in_at` (L62), `created_at` (L70), `is_anonymous` (L74).
  - `internal/api/user.go` (research-auth's copy): `email_exists` for a duplicate address (L134-139); the anonymous `Autoconfirm` branch and `sendEmailChange` on every `updateUser` with a new address (L252-273).
- **Supabase docs** (read from github.com/supabase/supabase sources by research-auth; supabase.com is blocked here):
  - https://supabase.com/docs/guides/auth/auth-anonymous: anonymous users use the `authenticated` role with an `is_anonymous` JWT claim; converting with `updateUser({ email })` and "the 6-digit OTP"; "Automatic cleanup of anonymous users is currently not available".
  - https://supabase.com/docs/guides/auth/auth-email-passwordless: `shouldCreateUser: false`; `verifyOtp` with type `email`.
  - https://supabase.com/docs/guides/auth/rate-limits: `/otp` and `/user` share the sign-in bucket; `/verify` has its own; one OTP per user per window.
  - https://supabase.com/docs/guides/auth/sessions: single session "the session from the most recent sign in will remain active, while the rest are terminated"; settings are "enforced whenever a session is refreshed next".
- **Supabase Realtime**, https://supabase.com/docs/guides/realtime/postgres-changes (read from design-platform's copy, `spec/_platform-docs/postgres-changes.mdx`): "RLS policies are not applied to `DELETE` statements" (L3442); "Postgres Changes authorizes every event against each subscriber" (L3629); filters are evaluated on the server (L1186).
- **Installed `@supabase/auth-js` 2.108.2** (`node_modules/@supabase/auth-js/dist/module/`):
  - `GoTrueClient.d.ts` L1965-1997: "the default `scope` is `'global'`", `{ scope: 'local' }`.
  - `lib/types.d.ts` L693-695: `EmailOtpType` includes `email_change` and `email`; `ResendParams` only `signup` and `email_change` (hence `signInWithOtp` again for a sign-in resend).
  - `lib/error-codes.d.ts`: the codes mapped in §1.3 (`otp_expired`, `otp_disabled`, `email_exists`, `over_email_send_rate_limit`, `over_request_rate_limit`, `email_address_invalid`, `email_address_not_authorized`, `validation_failed`).
  - `lib/fetch.js` `handleError`: `code` from the body when `x-supabase-api-version` ≥ 2024-01-01, else `error_code`.
  - `GoTrueClient.js` L1961-1990 (`verifyOtp` saves the session and emits `SIGNED_IN`), L2775-2800 (`updateUser` → `PUT /user` with the session's token).
- **MDN** (fetched for this design from github.com/mdn/content on 2026-11-15, copies in `spec/_me-docs/`):
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date: the value "is always formatted `yyyy-mm-dd`"; `min`/`max`.
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time: the value "is always a 24-hour `HH:mm`"; `step` in seconds.
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode: `numeric` — "Numeric input keyboard, but only requires the digits 0–9".
  - https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event: "Transitioning to `hidden` is the last event that's reliably observable by the page".
  - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share: needs "transient activation (It must be triggered off a UI event like a button click …)".
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat: the `timeZone` option used by `studyDay`.
  - research-auth's MDN copies: `autocomplete="one-time-code"` covers codes received by "SMS, email, or authenticator application".
- **Apple** (research-auth's copies): Home Screen web apps have "separate cookies and storage from the browser" (WWDC23 "What's new in web apps").
- **Not reachable here:** rfc-editor.org and ietf.org (RFC 5545, so no calendar file), supabase.com and vercel.com (their pages came from GitHub sources or the repo).

### Experiments here (`spec/me-proto/`, local only)

- `sql/me-identity.sql`, `sql/me.sql`, `sql/me-stubs.sql`, `sql/me-identity-test.sql`, `sql/me-test.sql`; `run-identity.sh`, `run-sql.sh` (Postgres 16.15).
- `src/day.ts`, `src/estimates.ts`, `src/plan.ts`, `src/agenda.ts`, `src/account.ts`; `test/run.ts` (TypeScript 5.9 via the repo's `node_modules`, Node 22.23); `test/auth-contract.mjs` (`@supabase/supabase-js` 2.108.2).
- `run-all.sh` re-runs everything; outputs in `out/` (`identity.txt`, `sql.txt`, `ts.txt`, `auth-contract.txt`, `plan-samples.txt`).
- The measured summary size: `scratchpad/qtest3/summary-r3-hybrid.md` (43,091 characters, 6,599 words, 38 slides; per part 3,091-8,327 characters).

---

## Appendix B: the tested code of record (`spec/me-proto/src/`)
These are the prototypes the checks of §6.2-§6.3 ran against. In the build, `day.ts`, `estimates.ts`, `plan.ts` and `agenda.ts` go to `shared/study/` unchanged (imports end in `.js`, as Node's ES modules and the repo's `api/` code require), and `account.ts` to `src/study/lib/`.

### `shared/study/day.ts`

```ts
/* ── The study day: Israel time, starting 04:00 ──
 * Proposed as shared/study/day.ts. The same rule as SQL's
 * ((t at time zone 'Asia/Jerusalem') - interval '4 hours')::date (design-me)
 * and study_day() (design-cards), whose fsrs.ts studyDay() can import this.
 * Days are counted since 1970-01-01, so day arithmetic is plain integers. */

export const TZ = "Asia/Jerusalem";
const DAY_MS = 86_400_000;

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wall(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
}

/** The study day an instant falls in: Israel's calendar date, minus one before 04:00. */
export function studyDay(ms: number): number {
  const w = wall(ms);
  const day = Date.UTC(w.y, w.m - 1, w.d) / DAY_MS;
  return w.h < 4 ? day - 1 : day;
}

/** "2026-11-15" → its day number. */
export function dayOfDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Day number → "2026-11-15". */
export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The instant a study day starts: 04:00 Israel time on that date. */
export function dayStart(day: number): number {
  // Start from 04:00 UTC and correct by the zone's offset at that moment
  // (twice, for the days the clocks change).
  let t = day * DAY_MS + 4 * 3_600_000;
  for (let i = 0; i < 2; i++) {
    const w = wall(t);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
    t += day * DAY_MS + 4 * 3_600_000 - shown;
  }
  return t;
}

/** "ה׳ 20.11" */
export const WEEKDAY_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export function shortDate(day: number): string {
  const [, m, d] = dateOfDay(day).split("-").map(Number);
  return `${WEEKDAY_HE[weekday(day)]} ${d}.${m}`;
}
```

### `shared/study/estimates.ts`

```ts
/* ── How long things take (proposed as shared/study/estimates.ts) ──
 * One place for the numbers the plan and the marathon agenda use. The
 * measured ones say so; the others are assumptions the app replaces with
 * the member's own data where it has it (reading speed). */

export type PartInfo = { i: number; t: string; from: number; to: number; chars: number; ready: boolean };

/** Measured: the antiparasitics summary (qtest3/summary-r3-hybrid.md) is
 *  43,091 characters for 38 slides, about 1,130 per slide. Used for parts
 *  that are not written yet. */
export const CHARS_PER_SLIDE = 1130;
/** Assumed: careful silent study reading at about 140 words a minute, at the
 *  measured 6.5 characters a word (research-claude §6). Replaced per member
 *  by readingSpeed() once three parts were timed. */
export const READ_CHARS_PER_MIN = 900;
/** Assumed: reading aloud at about 110 words a minute, plus a quarter for
 *  talking it over (700 ÷ 1.25). */
export const ALOUD_CHARS_PER_MIN = 560;
/** Assumed: answering and reading five explanations. */
export const MIN_PER_MCQ = 1.25;
export const MIN_PER_CASE = 2;
export const MIN_PER_MISTAKE = 1.5;
/** Assumed: one flashcard review. */
export const SEC_PER_CARD = 8;
/** A group-quiz question: the quiz design's default 60 s plus 30 s for the reveal. */
export const QUIZ_MIN_PER_QUESTION = 1.5;

export function partChars(p: PartInfo): number {
  return p.ready && p.chars > 0 ? p.chars : (p.to - p.from + 1) * CHARS_PER_SLIDE;
}

export function readMinutes(chars: number, perMin = READ_CHARS_PER_MIN): number {
  return Math.max(3, Math.ceil(chars / perMin));
}

export function aloudMinutes(chars: number): number {
  return Math.max(2, Math.ceil(chars / ALOUD_CHARS_PER_MIN));
}

/** The questions design's round size: one per 2.5 slides, 6 to 25. */
export function expectedQuestions(slides: number): number {
  return Math.min(25, Math.max(6, Math.round(slides / 2.5)));
}

export function practiceMinutes(mcq: number, cases: number): number {
  return Math.ceil(mcq * MIN_PER_MCQ + cases * MIN_PER_CASE);
}

export function cardMinutes(cards: number): number {
  return Math.ceil((cards * SEC_PER_CARD) / 60);
}

/** The member's own reading speed in characters a minute, from parts read
 *  with the tracker (at least 30 s each). Needs three such parts; clamped to
 *  400-2,000 so one distracted evening cannot wreck the plan. */
export function readingSpeed(samples: Array<{ chars: number; seconds: number }>): number {
  const ok = samples.filter((s) => s.seconds >= 30 && s.chars > 0);
  if (ok.length < 3) return READ_CHARS_PER_MIN;
  const chars = ok.reduce((a, s) => a + s.chars, 0);
  const minutes = ok.reduce((a, s) => a + s.seconds, 0) / 60;
  return Math.round(Math.min(2000, Math.max(400, chars / minutes)));
}
```

### `shared/study/plan.ts`

```ts
/* ── The study plan (proposed as shared/study/plan.ts) ──
 *
 * A pure function: the same input gives the same plan on the phone and on
 * the laptop. The page calls it with the member's progress AS OF THE START OF
 * THE STUDY DAY (04:00 Israel time, or the moment of "לסדר מחדש את היום"),
 * so today's list does not reshuffle while the member works through it;
 * taskStatus() then ticks each task off from the LIVE numbers. Tomorrow the
 * plan is computed again from what was really done: missed work moves
 * forward, work done early disappears, new mistakes and weak topics come in.
 *
 * Phases. The last 20% of the study days (1-5 days, only when there are at
 * least 4) are review days: weak topics and a pass over every lecture. The
 * days before them take reading, practice and mistakes, filled to 85% of the
 * day so new mistakes have room.
 */

import { dateOfDay, dayOfDate, weekday } from "./day.js";
import {
  CHARS_PER_SLIDE,
  expectedQuestions,
  partChars,
  practiceMinutes,
  readMinutes,
  type PartInfo,
  MIN_PER_MISTAKE,
} from "./estimates.js";

export type PlanSettings = { examDate: string; dailyMinutes: number; daysOff: number[]; finalReview: boolean };

/** One lecture in the exam's scope, as of the plan's moment (study_my_lectures). */
export type LectureState = {
  id: string;
  title: string;
  slides: number;
  parts: PartInfo[];
  readAt: string | null;
  partsDone: number[];
  questions: number;
  cases: number;
  answered: number;
  wrongNow: number;
};

/** A marathon the member said "אני בפנים" to, on or after today and before the exam. */
export type MarathonIn = { id: string; day: number; minutes: number; lectureIds: string[] };

/** A weak or watch topic in scope (study_my_weak_points), weakest first. */
export type WeakIn = { key: string; topic: string; status: "weak" | "watch" };

export type PlanInput = {
  today: number;
  settings: PlanSettings;
  /** In the order the course was taught: course, lecture date, upload time. */
  lectures: LectureState[];
  marathons: MarathonIn[];
  weak: WeakIn[];
  /** Characters a minute: readingSpeed() of the member's timed parts. */
  readSpeed: number;
  /** In-app flashcards: today's due cards in minutes, and a day's average. 0 when off. */
  cardsToday: number;
  cardsDaily: number;
};

export type TaskKind = "marathon" | "cards" | "mistakes" | "read" | "practice" | "generate" | "weak" | "review";
export type Task = {
  key: string;
  kind: TaskKind;
  minutes: number;
  lectureId?: string;
  /** Summary parts, inclusive (read). */
  parts?: [number, number];
  /** Questions to answer, mistakes to fix, or questions to generate. */
  count?: number;
  topic?: string;
  marathonId?: string;
};
export type PlanDay = { day: number; date: string; weekday: number; off: boolean; review: boolean; load: number; tasks: Task[] };
export type Plan = {
  over: boolean;
  examDay: number;
  days: PlanDay[];
  /** Reading, practice and mistakes that do not fit before the exam. */
  unscheduled: Task[];
  shortfall: number;
  /** Review tasks that do not fit (the plan still works without them). */
  reviewShort: number;
  studyDays: number;
  reviewDays: number;
  /** Minutes a reading day aims for in the first pass. */
  pace: number;
};

export const FILL = 0.85;
/** The first pass aims to end this share of the reading days early (a buffer). */
export const BUFFER = 0.15;
export const MIN_SLOT = 10;
export const MAX_WEAK = 6;
export const WEAK_MIN = 10;

type Item = Task & { phase: 1 | 2; perItem?: number; partList?: Array<{ i: number; min: number }> };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function buildPlan(inp: PlanInput): Plan {
  const s = inp.settings;
  const examDay = dayOfDate(s.examDate);
  const empty: Plan = { over: true, examDay, days: [], unscheduled: [], shortfall: 0, reviewShort: 0, studyDays: 0, reviewDays: 0, pace: 0 };
  if (inp.today >= examDay) return empty;

  // ── the days ──
  const off = new Set(s.daysOff);
  const days: PlanDay[] = [];
  for (let d = inp.today; d < examDay; d++) {
    days.push({ day: d, date: dateOfDay(d), weekday: weekday(d), off: off.has(weekday(d)), review: false, load: 0, tasks: [] });
  }
  if (!days.some((d) => !d.off)) days[days.length - 1].off = false; // never a plan without a single day
  const avail = days.filter((d) => !d.off);
  const reviewN = s.finalReview && avail.length >= 4 ? clamp(Math.round(avail.length * 0.2), 1, 5) : 0;
  for (const d of avail.slice(avail.length - reviewN)) d.review = true;

  const marathonOn = new Map<number, MarathonIn[]>();
  for (const m of inp.marathons) if (m.day >= inp.today && m.day < examDay) marathonOn.set(m.day, [...(marathonOn.get(m.day) ?? []), m]);
  const cardsCap = Math.round(s.dailyMinutes * 0.3);
  const cardsOn = (d: PlanDay) => (d.off ? 0 : Math.min(d.day === inp.today ? inp.cardsToday : inp.cardsDaily, cardsCap));
  const marathonMin = (d: PlanDay) => (marathonOn.get(d.day) ?? []).reduce((a, m) => a + m.minutes, 0);
  const solo = (d: PlanDay) => (d.off ? 0 : Math.max(0, s.dailyMinutes - cardsOn(d) - marathonMin(d)));

  // A lecture the member reads with the group in a marathon is read there.
  const pinned = new Map<string, number>();
  for (const m of [...inp.marathons].sort((a, b) => a.day - b.day)) {
    if (m.day < inp.today || m.day >= examDay) continue;
    for (const l of m.lectureIds) if (!pinned.has(l)) pinned.set(l, m.day);
  }

  // ── the work ──
  const chunkMax = clamp(Math.round(s.dailyMinutes * 0.6), 20, 90);
  const phase1: Item[] = [];
  const phase2: Item[] = [];
  for (const l of inp.lectures.filter((x) => x.wrongNow > 0)) {
    phase1.push({ key: `mistakes:${l.id}`, kind: "mistakes", phase: 1, lectureId: l.id, count: l.wrongNow,
                  minutes: Math.ceil(l.wrongNow * MIN_PER_MISTAKE), perItem: MIN_PER_MISTAKE });
  }
  for (const l of inp.lectures) {
    if (!pinned.has(l.id) && !l.readAt) {
      if (!l.parts.length) {
        phase1.push({ key: `read:${l.id}:all`, kind: "read", phase: 1, lectureId: l.id,
                      minutes: readMinutes(l.slides * CHARS_PER_SLIDE, inp.readSpeed) });
      } else {
        const done = new Set(l.partsDone);
        let run: Array<{ i: number; min: number }> = [];
        const flush = () => {
          if (!run.length) return;
          const key = `read:${l.id}:${run[0].i}-${run[run.length - 1].i}`;
          phase1.push({ key, kind: "read", phase: 1, lectureId: l.id, parts: [run[0].i, run[run.length - 1].i],
                        minutes: run.reduce((a, p) => a + p.min, 0), partList: run });
          run = [];
        };
        for (const p of [...l.parts].sort((a, b) => a.i - b.i)) {
          if (done.has(p.i)) { flush(); continue; }
          const min = readMinutes(partChars(p), inp.readSpeed);
          const prev = run[run.length - 1];
          if (prev && (prev.i !== p.i - 1 || run.reduce((a, x) => a + x.min, 0) + min > chunkMax)) flush();
          run.push({ i: p.i, min });
        }
        flush();
      }
    }
    if (l.questions > 0) {
      const left = l.questions - l.answered;
      if (left > 0) {
        const cases = Math.round((left * l.cases) / l.questions);
        const minutes = practiceMinutes(left - cases, cases);
        phase1.push({ key: `practice:${l.id}`, kind: "practice", phase: 1, lectureId: l.id, count: left, minutes, perItem: minutes / left });
      }
    } else {
      const n = expectedQuestions(l.slides);
      const cases = Math.round(n * 0.4);
      const minutes = practiceMinutes(n - cases, cases);
      phase1.push({ key: `generate:${l.id}`, kind: "generate", phase: 1, lectureId: l.id, count: n, minutes, perItem: minutes / n });
    }
  }
  if (reviewN > 0) {
    const weak = [...inp.weak.filter((w) => w.status === "weak"), ...inp.weak.filter((w) => w.status === "watch")].slice(0, MAX_WEAK);
    for (const w of weak) phase2.push({ key: `weak:${w.key}`, kind: "weak", phase: 2, topic: w.topic, minutes: WEAK_MIN });
    for (const l of inp.lectures) {
      const full = l.parts.length ? l.parts.reduce((a, p) => a + partChars(p), 0) : l.slides * CHARS_PER_SLIDE;
      phase2.push({ key: `review:${l.id}`, kind: "review", phase: 2, lectureId: l.id,
                    minutes: clamp(Math.round(0.15 * readMinutes(full, inp.readSpeed)), 10, 30) });
    }
  }

  // ── an even pace: the first pass spread over the reading days, ending a
  //    few days early, so no day is crammed while later ones stay empty ──
  const phase1Days = days.filter((d) => !d.off && !d.review && Math.floor(solo(d) * FILL) >= MIN_SLOT);
  const firstPass = phase1.reduce((a, t) => a + t.minutes, 0);
  const buffer = phase1Days.length >= 5 ? Math.round(phase1Days.length * BUFFER) : 0;
  const pace = Math.max(2 * MIN_SLOT, Math.ceil(firstPass / Math.max(1, phase1Days.length - buffer)));
  // The review spread over the review days too.
  const reviewPace = Math.max(2 * MIN_SLOT, Math.ceil(phase2.reduce((a, t) => a + t.minutes, 0) / Math.max(1, reviewN)));

  // ── filling the days, in order ──
  const readDay = new Map<string, number>(); // lecture → the last day it has reading
  const ready = (t: Item, day: number) => {
    if (t.kind !== "practice" && t.kind !== "generate") return true;
    const l = t.lectureId as string;
    if (phase1.some((x) => x.kind === "read" && x.lectureId === l)) return false; // reading not placed yet
    if ((readDay.get(l) ?? -Infinity) >= day) return false;       // practice the day after reading
    const pin = pinned.get(l);
    return pin === undefined || pin < day;                        // and after the marathon that reads it
  };
  const place = (d: PlanDay, t: Item) => {
    const { phase: _p, perItem: _q, partList: _r, ...task } = t;
    d.tasks.push(task);
    if (t.kind === "read" && t.lectureId) {
      readDay.set(t.lectureId, Math.max(readDay.get(t.lectureId) ?? -Infinity, d.day));
    }
  };

  for (const d of days) {
    for (const m of marathonOn.get(d.day) ?? []) d.tasks.push({ key: `marathon:${m.id}`, kind: "marathon", minutes: m.minutes, marathonId: m.id });
    const c = cardsOn(d);
    if (c > 0) d.tasks.push({ key: "cards", kind: "cards", minutes: c });
    if (d.off) continue;
    // Start tasks until the day's pace is reached; the last one may run a
    // quarter over it. A review day takes the whole day while first-pass
    // work is left over, else the review's own pace.
    const hard = d.review ? solo(d) : Math.floor(solo(d) * FILL);
    const p = d.review ? (phase1.length ? hard : reviewPace) : pace;
    const goal = Math.min(hard, p);
    const cap = Math.min(hard, Math.ceil(p * 1.25));
    if (hard < MIN_SLOT) continue; // a marathon took the day
    let used = 0;
    const queue = d.review ? [phase1, phase2] : [phase1];
    for (const q of queue) {
      for (let k = 0; k < q.length && (used === 0 || (used < goal && cap - used >= MIN_SLOT)); k++) {
        const t = q[k];
        if (!ready(t, d.day)) continue;
        const room = cap - used;
        if (t.minutes <= room || (used === 0 && !splittable(t, room))) {
          place(d, t);
          used += t.minutes;
          q.splice(k--, 1);
          continue;
        }
        const piece = split(t, room);
        if (piece) {
          place(d, piece);
          used += piece.minutes;
        }
      }
    }
  }
  for (const d of days) d.load = d.tasks.reduce((a, t) => a + t.minutes, 0);

  const unscheduled = phase1.map(({ phase: _p, perItem: _q, partList: _r, ...t }) => t);
  return {
    over: false,
    examDay,
    days,
    unscheduled,
    shortfall: unscheduled.reduce((a, t) => a + t.minutes, 0),
    reviewShort: phase2.reduce((a, t) => a + t.minutes, 0),
    studyDays: avail.length,
    reviewDays: reviewN,
    pace,
  };
}

function splittable(t: Item, room: number): boolean {
  if (t.kind === "read") return Boolean(t.partList && t.partList.length > 1 && t.partList[0].min <= room);
  if (t.perItem && t.count) return Math.floor(room / t.perItem) >= 4 && Math.floor(room / t.perItem) < t.count;
  return false;
}

/** Cuts the part of t that fits in room; t keeps the rest. */
function split(t: Item, room: number): Item | null {
  if (!splittable(t, room)) return null;
  if (t.kind === "read" && t.partList) {
    const take: Array<{ i: number; min: number }> = [];
    let sum = 0;
    for (const p of t.partList) {
      if (sum + p.min > room) break;
      take.push(p);
      sum += p.min;
    }
    const rest = t.partList.slice(take.length);
    const piece: Item = { ...t, key: `read:${t.lectureId}:${take[0].i}-${take[take.length - 1].i}`, parts: [take[0].i, take[take.length - 1].i],
                          minutes: sum, partList: take };
    t.partList = rest;
    t.parts = [rest[0].i, rest[rest.length - 1].i];
    t.key = `read:${t.lectureId}:${rest[0].i}-${rest[rest.length - 1].i}`;
    t.minutes = rest.reduce((a, p) => a + p.min, 0);
    return piece;
  }
  const per = t.perItem as number;
  const n = Math.floor(room / per);
  const piece: Item = { ...t, count: n, minutes: Math.ceil(n * per) };
  t.count = (t.count as number) - n;
  t.minutes = Math.ceil((t.count as number) * per);
  return piece;
}

/* ── ticking today's tasks off from the live numbers ── */

export type LiveLecture = { readAt: string | null; partsDone: number[]; questions: number; answered: number; wrongNow: number };
export type Live = {
  start: Map<string, LectureState>;
  now: Map<string, LiveLecture>;
  cardsDue: number;
  endedMarathons: Set<string>;
  /** Keys ticked by hand today (study_plan_checks). */
  checks: Set<string>;
};
export type TaskStatus = { done: boolean; by: "auto" | "hand" | null; progress?: [number, number] };

export function taskStatus(t: Task, live: Live): TaskStatus {
  if (live.checks.has(t.key)) return { done: true, by: "hand" };
  const now = t.lectureId ? live.now.get(t.lectureId) : undefined;
  const start = t.lectureId ? live.start.get(t.lectureId) : undefined;
  switch (t.kind) {
    case "read": {
      if (!now) return { done: false, by: null };
      if (now.readAt) return { done: true, by: "auto" };
      if (!t.parts) return { done: false, by: null };
      const [a, b] = t.parts;
      const have = new Set(now.partsDone);
      let n = 0;
      for (let i = a; i <= b; i++) if (have.has(i)) n++;
      return { done: n === b - a + 1, by: n === b - a + 1 ? "auto" : null, progress: [n, b - a + 1] };
    }
    case "practice":
    case "generate": {
      if (!now || !start || now.questions === 0) return { done: false, by: null };
      const count = t.count ?? 0;
      const delta = Math.max(0, now.answered - start.answered);
      const done = delta >= count || now.answered >= now.questions;
      return { done, by: done ? "auto" : null, progress: [Math.min(delta, count), count] };
    }
    case "mistakes": {
      if (!now || !start) return { done: false, by: null };
      const count = t.count ?? 0;
      const fixed = Math.max(0, start.wrongNow - now.wrongNow);
      const done = now.wrongNow === 0 || fixed >= count;
      return { done, by: done ? "auto" : null, progress: [Math.min(fixed, count), count] };
    }
    case "cards":
      return { done: live.cardsDue === 0, by: live.cardsDue === 0 ? "auto" : null };
    case "marathon":
      return { done: live.endedMarathons.has(t.marathonId ?? ""), by: live.endedMarathons.has(t.marathonId ?? "") ? "auto" : null };
    default:
      return { done: false, by: null }; // weak, review: ticked by hand
  }
}
```

### `shared/study/agenda.ts`

```ts
/* ── A marathon's run-of-show (proposed as shared/study/agenda.ts) ──
 * Built when the marathon is created, editable by anyone in the group, and
 * stored as study_marathons.agenda (the SQL checks its shape). Each step uses
 * a feature that exists: reading aloud with "follow the reader", the live
 * group quiz on stored questions, the lecture's open questions. */

import { aloudMinutes, CHARS_PER_SLIDE, partChars, QUIZ_MIN_PER_QUESTION, type PartInfo } from "./estimates.js";

export type StepKind = "intro" | "read" | "quiz" | "break" | "questions" | "free" | "wrap";
export type AgendaStep = { k: StepKind; l?: string; from?: number; to?: number; min: number; n?: number; mode?: "coop" | "race"; title?: string };

export type AgendaLecture = { id: string; slides: number; parts: PartInfo[]; questions: number };
export type AgendaOptions = {
  minutes: number;
  lectures: AgendaLecture[];
  quizEach: boolean;
  quizN: number;
  mode: "coop" | "race";
  breakEvery: number;
  breakMin: number;
};

export const INTRO_MIN = 5;
export const QUESTIONS_MIN = 10;
export const WRAP_MIN = 5;
export const READ_STEP_MAX = 45;
export const FREE_MIN = 20;

export function buildAgenda(o: AgendaOptions): { steps: AgendaStep[]; total: number; over: number } {
  const steps: AgendaStep[] = [{ k: "intro", min: INTRO_MIN }];
  let since = 0;
  const add = (s: AgendaStep) => {
    if (since >= 30 && since + s.min > o.breakEvery) {
      steps.push({ k: "break", min: o.breakMin });
      since = 0;
    }
    steps.push(s);
    since += s.min;
  };
  for (const l of o.lectures) {
    if (!l.parts.length) {
      add({ k: "read", l: l.id, min: aloudMinutes(l.slides * CHARS_PER_SLIDE) });
    } else {
      let run: Array<{ i: number; min: number }> = [];
      const flush = () => {
        if (!run.length) return;
        add({ k: "read", l: l.id, from: run[0].i, to: run[run.length - 1].i, min: run.reduce((a, p) => a + p.min, 0) });
        run = [];
      };
      for (const p of [...l.parts].sort((a, b) => a.i - b.i)) {
        const min = aloudMinutes(partChars(p));
        if (run.length && run.reduce((a, x) => a + x.min, 0) + min > READ_STEP_MAX) flush();
        run.push({ i: p.i, min });
      }
      flush();
    }
    if (o.quizEach && l.questions >= 3) {
      const n = Math.min(o.quizN, l.questions);
      add({ k: "quiz", l: l.id, n, mode: o.mode, min: Math.ceil(n * QUIZ_MIN_PER_QUESTION) + 2 });
    }
  }
  const sum = () => steps.reduce((a, s) => a + s.min, 0);
  // Spare time becomes free practice; a break it would need comes out of it.
  let free = o.minutes - sum() - QUESTIONS_MIN - WRAP_MIN;
  if (free >= FREE_MIN && since >= 30 && since + free > o.breakEvery) {
    steps.push({ k: "break", min: o.breakMin });
    since = 0;
    free -= o.breakMin;
  }
  if (free >= FREE_MIN) {
    steps.push({ k: "free", min: Math.min(free, 120) });
    since += Math.min(free, 120);
  }
  steps.push({ k: "questions", min: QUESTIONS_MIN }, { k: "wrap", min: WRAP_MIN });
  const total = sum();
  return { steps, total, over: Math.max(0, total - o.minutes) };
}

/** Planned start of each step, in minutes from the marathon's start. */
export function stepOffsets(steps: AgendaStep[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of steps) {
    out.push(t);
    t += s.min;
  }
  return out;
}

/** "מאחרים ב-12 דק׳": how late the current step started against the plan
 *  (negative = ahead). null before the start. */
export function lateBy(steps: AgendaStep[], step: number, stepAt: string | null, startsAt: string): number | null {
  if (step < 0 || !stepAt) return null;
  const planned = Date.parse(startsAt) + stepOffsets(steps)[step] * 60_000;
  return Math.round((Date.parse(stepAt) - planned) / 60_000);
}
```

### `src/study/lib/account.ts`

```ts
/* ── Email sign-in (proposed as src/study/lib/account.ts) ──
 * research-auth's flow, as functions the AccountSheet calls. A 6-digit code
 * by email, never a link (a Home Screen app has its own storage, and mail
 * scanners use up links). Two ways in:
 *   save:   this device's anonymous member gets an email; same user id, so
 *           nothing moves (updateUser + verifyOtp type email_change).
 *   signin: an account saved elsewhere; if this device has an anonymous
 *           member, a merge ticket folds it in (study_merge_offer before,
 *           study_merge_claim after verifyOtp type email).
 * The pending step lives in localStorage, so the code screen comes back if
 * iOS reloads the app while the person is in Mail. */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthMode = "save" | "signin";
export type Pending = { mode: AuthMode; email: string; at: number; ticket?: string };
export const PENDING_KEY = "study-signin";
/** Codes live an hour (Email OTP Expiration 3600, research-auth §4). */
export const PENDING_MS = 60 * 60 * 1000;
/** One code a minute per user (Supabase's OTP window). */
export const RESEND_MS = 60 * 1000;

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export function readPending(kv: KV, now = Date.now()): Pending | null {
  try {
    const p = JSON.parse(kv.getItem(PENDING_KEY) ?? "null") as Pending | null;
    if (!p || (p.mode !== "save" && p.mode !== "signin") || typeof p.email !== "string") return null;
    // A ticket outlives the code screen: it is redeemed at start-up (finishPending).
    if (now - p.at > PENDING_MS && !p.ticket) return null;
    return p;
  } catch {
    return null;
  }
}
function writePending(kv: KV, p: Pending | null) {
  try {
    if (p) kv.setItem(PENDING_KEY, JSON.stringify(p));
    else kv.removeItem(PENDING_KEY);
  } catch {
    /* private mode: the flow still works, it just cannot survive a reload */
  }
}

export class AuthFlowError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
function codeOf(e: unknown): string {
  const c = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  if (typeof c === "string" && c) return c;
  return e instanceof Error ? e.message : "unknown";
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Step 1: send the code. A save to an address that is already an account's
 *  turns into a sign-in to that account (with the merge). */
export async function sendCode(sb: SupabaseClient, kv: KV, mode: AuthMode, email: string, now = Date.now()): Promise<AuthMode> {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new AuthFlowError("email_address_invalid");
  if (mode === "save") {
    const { error } = await sb.auth.updateUser({ email: e });
    if (!error) {
      writePending(kv, { mode, email: e, at: now });
      return "save";
    }
    if (error.code !== "email_exists") throw new AuthFlowError(codeOf(error));
  }
  const { error } = await sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false } });
  if (error) throw new AuthFlowError(codeOf(error));
  writePending(kv, { mode: "signin", email: e, at: now });
  return "signin";
}

/** "שליחה מחדש". Save: updateUser({ email }) again, NOT resend(): the
 *  server's /resend looks the user up by its current email
 *  (internal/api/resend.go → FindUserByEmailAndAudience, LOWER(email) = ?),
 *  which an anonymous member does not have yet, so it would answer 200 and
 *  send nothing. updateUser sends a fresh email-change code each time
 *  (internal/api/user.go → sendEmailChange). Sign-in: signInWithOtp again
 *  (resend() knows only signup and email_change). Both keep Supabase's
 *  one-a-minute window, which the screen's countdown mirrors. */
export async function resendCode(sb: SupabaseClient, kv: KV, p: Pending, now = Date.now()): Promise<void> {
  const { error } =
    p.mode === "save"
      ? await sb.auth.updateUser({ email: p.email })
      : await sb.auth.signInWithOtp({ email: p.email, options: { shouldCreateUser: false } });
  if (error) throw new AuthFlowError(codeOf(error));
  writePending(kv, { ...p, at: now });
}

export type Verified = { userChanged: boolean; merged: boolean };

/** Step 2: the code. Sign-in on a device with an anonymous member takes a
 *  merge ticket first (it is the only proof of that member once the session
 *  is replaced), and redeems it with the new session. */
export async function verifyCode(sb: SupabaseClient, kv: KV, p: Pending, code: string): Promise<Verified> {
  const token = code.replace(/\D/g, "");
  if (token.length < 6) throw new AuthFlowError("otp_short");
  if (p.mode === "save") {
    const { error } = await sb.auth.verifyOtp({ email: p.email, token, type: "email_change" });
    if (error) throw new AuthFlowError(codeOf(error));
    writePending(kv, null);
    return { userChanged: false, merged: false };
  }
  const before = (await sb.auth.getSession()).data.session;
  let ticket: string | undefined;
  if (before?.user.is_anonymous) {
    const { data, error } = await sb.rpc("study_merge_offer");
    if (error) throw new AuthFlowError(codeOf(error));
    ticket = data as string;
    writePending(kv, { ...p, ticket });
  }
  const { data, error } = await sb.auth.verifyOtp({ email: p.email, token, type: "email" });
  if (error) throw new AuthFlowError(codeOf(error));
  const userChanged = Boolean(before && data.user && before.user.id !== data.user.id);
  const merged = ticket ? await claim(sb, kv, ticket) : false;
  if (!ticket) writePending(kv, null);
  return { userChanged, merged };
}

async function claim(sb: SupabaseClient, kv: KV, ticket: string): Promise<boolean> {
  const { data, error } = await sb.rpc("study_merge_claim", { p_ticket: ticket });
  if (!error) {
    writePending(kv, null);
    return data === 1;
  }
  // Used already (a retry after a lost answer) or expired: nothing left to do.
  if (/ticket not found/.test(error.message)) {
    writePending(kv, null);
    return false;
  }
  return false; // network: the ticket stays, and start-up tries again
}

/** At start-up: a saved session with a stored ticket means the claim did not
 *  finish (the app was closed or the network dropped). */
export async function finishPending(sb: SupabaseClient, kv: KV): Promise<"merged" | "none" | "kept"> {
  const p = readPending(kv);
  if (!p?.ticket) return "none";
  const s = (await sb.auth.getSession()).data.session;
  if (!s || s.user.is_anonymous) return "kept"; // still on the device's own member: the code was never typed
  const merged = await claim(sb, kv, p.ticket);
  return merged ? "merged" : readPending(kv) ? "kept" : "none";
}

/** "יציאה מהמכשיר הזה": the default scope is global (every device); this one only. */
export async function signOutHere(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) throw new AuthFlowError(codeOf(error));
}

/** "יציאה מכל המכשירים": for a lost phone. */
export async function signOutEverywhere(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.auth.signOut({ scope: "global" });
  if (error) throw new AuthFlowError(codeOf(error));
}

/** Hebrew copy for every error the flow can meet (research-auth §2, by error.code). */
export function authErrorText(code: string, mode: AuthMode): string {
  switch (code) {
    case "otp_expired":
      return "הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.";
    case "otp_short":
      return "הקוד הוא 6 ספרות.";
    case "over_email_send_rate_limit":
      return "אפשר לבקש קוד חדש בעוד דקה.";
    case "over_request_rate_limit":
      return "יותר מדי ניסיונות. כדאי לחכות כמה דקות.";
    case "otp_disabled":
      return "לא נמצא חשבון שמור עם המייל הזה. קודם שומרים את החשבון במכשיר שבו כבר הצטרפת: שלי ← שמירת החשבון עם מייל.";
    case "email_address_invalid":
    case "validation_failed":
      return "כתובת המייל לא תקינה.";
    case "email_address_not_authorized":
      return "שליחת המיילים עוד לא הוגדרה בשרת (SMTP ב-Supabase).";
    case "session_not_found":
    case "not signed in":
      return mode === "save" ? "הכניסה במכשיר הזה פגה. צריך להצטרף מחדש עם קוד הקבוצה." : "משהו השתבש בכניסה. אפשר לנסות שוב.";
    default:
      return "משהו השתבש. כדאי לבדוק את החיבור ולנסות שוב.";
  }
}
```

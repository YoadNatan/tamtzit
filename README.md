# תמצית

**עברית** · [English](#english)

## מה זה

תמצית היא אפליקציית לימוד לקבוצת למידה קטנה (שישה סטודנטים לרפואה, שנה ג׳).
מישהו מעלה מצגת של הרצאה (PowerPoint או PDF), ותוך כמה דקות לכל הקבוצה יש
סיכום מלא בעברית, עם המונחים באנגלית, הטבלאות והתמונות מהשקפים. סביב הסיכום:
קריאה משותפת ("להקריא לקבוצה"), שאלות ותגובות על פסקה, תרגול, כרטיסיות,
חידון קבוצתי, מפגש יומי, תיקונים ועוד. רוב היכולות מאחורי דגלי שחרור.

- דף אחד בשורש הכתובת (`/`), React + Vite (`index.html`, `src/study/`).
- צד שרת: פונקציות Vercel ב-`api/study/*` (הקוד המשותף ב-`server/study/`,
  ובין הדפדפן לשרת ב-`shared/study/`).
- מסד נתונים: Supabase (`supabase/study-schema.sql`), כניסה אנונימית, RLS.
- הסיכומים נכתבים על ידי Claude (Anthropic API), רק מהשרת.

## פיתוח מקומי

```bash
npm ci
cp .env.example .env.local   # למלא ערכים, לפחות VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173/
```

`npm run dev` מריץ רק את הדף. הפונקציות (`/api/study/*`) רצות ב-Vercel
(או `vercel dev`, עם המשתנים של צד השרת).

## העלאה לאוויר

פרויקט Vercel מהמאגר הזה: Framework Vite, הבנייה מ-`vercel.json`
(`npm run build`, תיקייה `dist`), Node 22, Fluid compute פועל. ב-Import לבחור
את ה-scope הנכון (החשבון האישי או הצוות של תמצית, לא Delo-engineering) ואת
השם `tamtzit`, ולוודא ב-Settings → Domains שהכתובת היא `tamtzit.vercel.app`
או שם הגיוני אחר לפני ששולחים קישור: קישורי ההזמנה נבנים מהכתובת. המעבר
מהכתובת הישנה, צעד אחר צעד: [`docs/MOVE.md`](docs/MOVE.md).

## משתני סביבה (שמות בלבד)

- ציבוריים: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (ולא חובה:
  `VITE_STUDY_SUPABASE_URL`, `VITE_STUDY_SUPABASE_ANON_KEY`).
- סודות, בשרת בלבד: `ANTHROPIC_API_KEY`, `STUDY_WORKER_KEY` (אותו ערך כמו
  סוד ה-Vault `study_worker_key`). לחבילות שעוד לא נבנו: `SEND_EMAIL_HOOK_SECRET`,
  `STUDY_TRANSCRIBE_KEY`.
- הגדרה: `STUDY_MONTHLY_USD` (התקציב החודשי בדולרים; המאושר 33),
  `STUDY_SETS_MONTHLY_USD` (התקרה החודשית של סטי התרגול; המאושרת 12).
- דגלי שחרור `VITE_STUDY_*`: הרשימה ב-[`.env.example`](.env.example).
  רק ב-Production, ואחרי שינוי Redeploy.

## קובץ ה-SQL ואיך מריצים אותו (11 חלקים)

כל מסד הנתונים של האפליקציה הוא קובץ אחד:
[`supabase/study-schema.sql`](supabase/study-schema.sql). אפשר להריץ אותו שוב
בבטחה. הוא גדול מדי (כ-1.5 MB) להדבקה אחת ב-SQL Editor של Supabase, ולכן הוא
מחולק לשנים-עשר קבצים ב-[`supabase/parts/`](supabase/parts/):

1. Supabase → **SQL Editor** → New query.
2. לפתוח את `supabase/parts/1.sql` ב-GitHub → **Copy raw file** → להדביק → **Run**.
3. לחכות לסיום בלי שגיאה (הודעות NOTICE כמו "already exists, skipping" תקינות).
4. אותו דבר עם `2.sql`, `3.sql` וכן הלאה, **לפי הסדר**, עד `12.sql`.
5. לבדוק: `select public.study_schema();` ו-`/api/study/health` עם `"schemaOk":true`.

החלקים הם הקובץ עצמו, חתוך רק בין הסעיפים שלו, כך ששנים-עשר חלקים לפי הסדר עושים
בדיוק מה שהקובץ כולו עושה. שגיאה בחלק מסוים: לתקן ולהריץ שוב מאותו חלק.
**כל הרצה ממשיכה עד `12.sql`**, גם כשמריצים שוב רק חלק מוקדם: חלק 8 (סעיף S)
מצמצם שתי הרשאות שהחלקים הקודמים פותחים (העלאה לתיקיית `exams/` ושינוי ישיר
של מצב מבחן), והן נשארות פתוחות עד שחלק 8 רץ שוב; חלק 9 (סעיף I, הקוד האישי)
מגדיר מחדש את `study_member_saved` (הסימון "יש קוד"), שחלק 1 מחזיר לגרסה הישנה;
חלק 10 (סעיף L, סטים של תרגול) מגדיר את `kind_on` באותו נוסח שבחלק 1; חלק 11
(סעיף O, מבחנים ודפי תרגילים שמעלים) מגדיר מחדש שמונה פונקציות של חלק 8, וגרסה 2 שלו
דורשת שחלקים 2 עד 9 ירוצו לפניו (שינויים במקום בסעיפים Q, Z, M, H, T); בלעדיהם הוא
נעצר עם הודעה. חלק 12 הוא המשך סעיף O (גרסה 3, שאלות דומות; עם חלק 11 היה עובר את
170 KB), והוא נעצר עם הודעה אם חלק 11 לא רץ לפניו; גרסה 3 משנה במקום גם את סעיף E
(חלק 7) ואת `kind_on` בחלקים 1 ו-10.
אחרי כל שינוי בקובץ: `npm run sql:parts` (בדיקת היחידה נכשלת אם החלקים לא
מעודכנים). מריצים את ה-SQL **לפני** שהקוד החדש עולה.

הקובץ משנה דבר אחד מחוץ ל-`study_`: טריגר ההרשמה של אפליקציית הלוח (באותו
פרויקט Supabase), כדי שחברי תמצית לא ייכנסו לרשימת הצוות שלה. עותק של סכמת
הלוח לבדיקות נמצא ב-`supabase/tests/board-schema.sql`; לא להריץ אותו בפרויקט האמיתי.

## בדיקות

`npm run test:study` (בדיקות יחידה), `npm run test:contract` (ה-SQL מול הקוד,
צריך Postgres מקומי), `npm run build`, `npm run test:bundle` (גודל החבילה),
ובדיקות e2e ב-`e2e/study/` (פירוט באנגלית למטה).

---

<a id="english"></a>
# English

**תמצית** ("summary") is for a study group of six (3rd-year medicine).
Someone uploads a lecture's slides (PowerPoint `.pptx` or PDF), and a few
minutes later the whole group has a full Hebrew summary. The target level is
a classmate's summary the group trusts:

- full prose, following the lecture's order;
- English terms kept verbatim;
- every number, table and contraindication from the slides;
- the slides' figures next to the text;
- short explanations of hard terms;
- outside knowledge only in marked boxes.

Around the summary: reading together, paragraph questions and comments,
practice, flashcards, the live group quiz, the daily meeting, corrections and
more, most of them behind release flags. The plan, the packages and their
order are in [`docs/study/`](docs/study/README.md); the move out of the
`delo-logo-review` repository is in [`docs/MOVE.md`](docs/MOVE.md).

## Layout

| Path | What |
|---|---|
| `index.html` | the one page, served at `/` |
| `src/study/` | the app (React) |
| `shared/study/` | code used by both the page and the server |
| `api/study/*.ts` | the Vercel functions: `health`, `outline`, `section`, `work`, `ai`, `code` (the personal code, `docs/study/personal-code.md`) |
| `server/study/` | the functions' shared code (outside `api/`, so Vercel does not count it as a function) |
| `supabase/study-schema.sql` | the whole database; `supabase/parts/` the same in 12 parts |
| `supabase/tests/` | SQL behaviour and concurrency tests, the stubs, a test copy of the board app's schema |
| `e2e/study/` | Playwright flows against a mocked Supabase |
| `tools/` | the unit-test runner, the contract and bundle checks, the SQL splitter, evals |
| `docs/study/` | specs, decisions, release notes |

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in at least VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                  # the page at http://localhost:5173/
npm run build                # tsc for the page and the functions, then vite build into dist/
npm run preview              # the built page at http://localhost:4173/
```

`npm run dev` serves the page only; `/api/study/*` runs on Vercel (or under
`vercel dev` with the server variables set). Every screen is a query string
on `/` (`src/study/lib/route.ts`); `APP_PATH` there is the one place the
app's path is written, and shared links use the page's own origin.

## Deploy

A Vercel project from this repository: framework Vite, build command and
output from `vercel.json` (`npm run build`, `dist`), Node 22 from
`package.json`. On Import, pick the right scope (the personal account or
תמצית's own team, not Delo-engineering) and the project name `tamtzit`, and
check in Settings → Domains that the address is `tamtzit.vercel.app` or
another logical name before any link is shared: invite and share links use
the address the app is open at (`docs/MOVE.md` steps 0 and 1). `vercel.json` sends `/api/*` to the functions and every other
path to `index.html`, sets `frame-ancestors 'none'` on every page, and
redirects old `/study` and `/study/…` links to `/` (the query is kept).
`"fluid": true` is required: the writing functions declare
`maxDuration: 300`, which needs Fluid compute. The functions run on the
Node.js runtime (the Anthropic SDK imports `@opentelemetry/api`, which the
edge bundler refuses). Vercel Hobby allows 12 functions; 6 are used.

After a push to `main`, `.github/workflows/smoke.yml` checks the live site
(the repository variable `SITE_URL`, else `https://tamtzit.vercel.app`):
the page's build stamp, an old `/study/` link, `/api/study/health` and
`GET /api/study/work`.

## Environment variables (names only)

| Name | Where | |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build and server | public; read by the functions too |
| `VITE_STUDY_SUPABASE_URL`, `VITE_STUDY_SUPABASE_ANON_KEY` | build and server | optional: the app in its own Supabase project |
| `ANTHROPIC_API_KEY` | server | **secret** |
| `STUDY_WORKER_KEY` | server | **secret**, 32+ characters, the same value as the Vault secret `study_worker_key` |
| `STUDY_MONTHLY_USD` | server | the monthly budget in dollars (approved 33; 33 when unset) |
| `STUDY_SETS_MONTHLY_USD` | server | practice sets' monthly line in dollars (approved 12; 12 when unset; [`docs/study/sets.md`](docs/study/sets.md)) |
| `SEND_EMAIL_HOOK_SECRET`, `STUDY_TRANSCRIBE_KEY` | server | **secret**; for packages not built yet |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | server, **Production only** | **secret**, marked Sensitive; other providers' models for routes and "השוואת מודלים" ([`docs/study/models.md`](docs/study/models.md); set them per [`docs/study/RELEASE-Y2.md`](docs/study/RELEASE-Y2.md): a prepaid limit first, a billing-enabled Google project); unset, every key stays on Claude. `/api/study/health`'s `providers` says which are set (booleans only) |
| `STUDY_VAPID_PUBLIC`, `STUDY_VAPID_SUBJECT` | server, **Production only** | notifications' push key (public) and its subject, `https://<the app's address>`; made with `node tools/vapid-keys.mjs` ([`docs/study/RELEASE-R1.md`](docs/study/RELEASE-R1.md)) |
| `STUDY_VAPID_PRIVATE` | server, **Production only** | **secret**, marked Sensitive; never on Preview, never in a chat or git |
| `VITE_STUDY_*` | build (and health on the server) | release flags, `1` or unset; the list is in [`.env.example`](.env.example) |

The question types (`VITE_STUDY_QTYPES`, [`docs/study/question-types.md`](docs/study/question-types.md))
are on in production once sections Q 3 and X 1 are loaded (part 2 and part 7),
the old address is frozen and the group has reopened the app (that document's
"Release: old clients and the old address").
Release flags are compiled in at build time: set them in Production only
(Preview uses the same database), then redeploy. A package's flag goes on
only after its SQL has run and its code is merged
(`docs/study/spec/spec-final.md` §2.10, §9.1). Tools and tests also read
`E2E_FLAGS`, `NODE_PATH`, `STUDY_CONTRACT_PG`, `STUDY_CONTRACT_KEEP` and
`STUDY_EVAL_FIXTURES`.

## The SQL file, in 12 parts

[`supabase/study-schema.sql`](supabase/study-schema.sql) is the whole
database: tables, Row Level Security, functions, the Storage bucket `study`,
the realtime policies, the pg_cron jobs. It is safe to run again. At about
1.5 MB it is too big for one paste into Supabase's SQL Editor, so
[`supabase/parts/1.sql` … `12.sql`](supabase/parts/) hold the same file cut
between its sections, and once inside section O (`tools/sql-parts.mjs`):

1. Supabase → **SQL Editor** → New query.
2. Open `supabase/parts/1.sql` on GitHub → **Copy raw file** → paste → **Run**.
3. Wait until it finishes without an error (NOTICEs such as "… already
   exists, skipping" are harmless).
4. The same with `2.sql`, `3.sql` and on, **in order**, through `12.sql`.
5. Check: `select public.study_schema();` lists every section, and
   `/api/study/health` says `"schemaOk":true`.

Running the twelve in order does exactly what running the whole file does
(checked on a local Postgres, fresh and over an existing schema, with the
full behaviour test). If one part fails, fix the cause and run again from
that part. **Every run goes on through `12.sql`**, also when only an earlier
part is run again: part 8 (section S) narrows two permissions the earlier
parts open (an upload into an `exams/` folder, and a member updating an
exam's status directly), and they stay open until part 8 runs again; part 9
(section I, the personal code) redefines `study_member_saved` (the "יש קוד"
chip), which part 1 puts back to its older form; it also holds section R
(notifications: the inbox, pushes and their minute job, with the switch
`notify` inserted off, [`docs/study/notify.md`](docs/study/notify.md)). Part 10
is section L (practice sets, [`docs/study/sets.md`](docs/study/sets.md)), which
would have taken part 9 past 170 KB. Part 11 is section O (uploaded exams and
exercise sheets, [`docs/study/sheets.md`](docs/study/sheets.md), the switch
`sheets` inserted off), which redefines eight of part 8's functions (the course
page, the library's count, simulations, the key's undo, and the exam queue's
claim, advance, printed count and "no key"); its version 2 took part 10 past
170 KB. O 2 needs parts 2 to 9 run before it (it edits the pickers of sections
Q, Z, M, H and T in place, so the quiz, the boss, the meeting and Today never
draw an open or numeric item); run alone, it stops with a message saying so.
Part 12 is section O going on at its version 3 (similar questions; with part
11 it would pass 170 KB, so the file is cut at O's own "SECTION O CONTINUES ·
O 3" line); it stops with a message when part 11 has not run, and O 3 also
edits section E (part 7) and `kind_on` (parts 1 and 10) in place. Part 12 also
holds section Y after O 3 (models: routes, providers and "השוואת מודלים", the
switch `lab` inserted off, [`docs/study/models.md`](docs/study/models.md);
its release steps, with the flag `VITE_STUDY_MODELS`, are
[`docs/study/RELEASE-Y1.md`](docs/study/RELEASE-Y1.md)); nothing else needs it. After editing the schema, run `npm run sql:parts`; a unit test
fails while the parts are stale, or while one is over 170 KB (the SQL Editor's
limit). Run the SQL **before** the code that needs
it deploys: until then `/api/study/health` says `"schemaOk":false`.

The file changes one thing outside `study_`: the board app's sign-up
trigger, `board_handle_new_user()`, which lives in the same Supabase project,
so study members (anonymous users with `app = "study"`) are not added to the
board's staff. Keep it identical to the board app's own `board-schema.sql`.
`supabase/tests/board-schema.sql` is a copy for the tests only.

**First-time setup on a new Supabase project** (the current group's project
is already set up):

1. Authentication: anonymous sign-ins on.
2. Run the SQL in 12 parts as above. If it prints "realtime.messages not
   found", the project has no Realtime Authorization and follow-the-reader
   cannot connect.
3. The server key: a random value of 32+ letters and digits, set on Vercel as
   `STUDY_WORKER_KEY` and in the SQL Editor:
   `select vault.create_secret('<the same value>', 'study_worker_key');`
4. Server writing: Database → Extensions: **pg_net**; Integrations → Cron:
   **pg_cron**; then
   `select vault.create_secret('https://<the site>', 'study_site_url');`
   and run the SQL again. Until all three are there, a NOTICE names what is
   missing and the phones write the summaries instead.
5. Anthropic Console: a monthly limit at least $10 above `STUDY_MONTHLY_USD`.
6. `/api/study/health`: `"anthropicKey":true`, `"workerOk":true`,
   `"schemaOk":true`. Then open `/` and create the group (only one group can
   be created); "הזמנה לקבוצה" shares the join link.

## How the server writing is reached

The database calls the site back: `study_private.dispatch()` (on a new
lecture, and every minute from pg_cron's `study-dispatch`) and
`study_private.points_ahead_kick()` post to
`rtrim(<Vault study_site_url>, '/') || '/api/study/work'` with the server key.
The address is not in the code: it is that one Vault secret. Pointing the
database at another deployment is one SQL line (see
[`docs/MOVE.md`](docs/MOVE.md#4-כתיבה-בשרת-להפנות-את-מסד-הנתונים-לכתובת-החדשה));
deleting the secret turns server writing off, and the phones write.

## How it works

- **Reading the deck (in the browser).** `src/study/lib/pptx.ts` reads the
  slide XML: text, tables, speaker notes, and text in equation boxes.
  Drawings embedded as OLE objects show only a WMF/EMF preview, so their
  labels are read from the metafile (`metafile.ts`). Pictures are shrunk to
  JPEG (`images.ts`); PDF pages are rendered with pdf.js (`pdf.ts`), loaded
  only when a PDF is chosen. Only text and the small pictures are uploaded.
  The original file never leaves the phone.
- **Writing the summary (server).** `api/study/outline.ts` splits the
  lecture into parts along its topics, `api/study/section.ts` writes one
  part, and `api/study/work.ts` is the server writer: the phone hands the
  lecture to the database (`study_queue`), pg_net calls this function, and
  the summary is written part by part with nobody's phone open. Every
  writer first claims its part from the same queue (`study_claim`), so no
  part is written twice. The prompts are in `server/study/prompts/`; the
  writer is described in [`docs/study/writing.md`](docs/study/writing.md).
  The Anthropic key lives only on Vercel.
- **Who sees what.** Members sign in anonymously. The functions read and
  write as the signed-in member, so Row Level Security decides everything;
  there is no service-role key. A group's lectures, summaries and pictures
  (a private Storage bucket) are visible only to its members.
- **One group.** Only the first group can be created; everyone else joins it
  with its code (`study_create_group` holds the limit).
- **Spending.** One ledger, `study_usage`, a row per call to Claude. Before a
  call the function reserves the most the answer can cost (`study_reserve`),
  refused once the month's spend would pass `STUDY_MONTHLY_USD`; after it,
  the real cost replaces the reservation (`study_settle`). Both need the
  server key, so a member's token alone cannot spend.
- **Studying together.** "להקריא לקבוצה" shares the reader's paragraph and
  "לעקוב" keeps a follower's screen on it, over a private Realtime channel
  per lecture that only members can join. A tapped paragraph opens a thread
  (`study_comments`); "סימון שקראתי" marks it read (`study_reads`).
- **The shell.** Tabs, right to left, ספרייה · תרגול · יחד · שלי, or with
  Today on, היום · ספרייה · יחד · שלי (`src/study/components/Shell.tsx`).
  A link to a screen whose flag is off lands on the nearest screen that is
  on. Each feature package fills its own module in `src/study/features/`.
- **Text direction.** Each block is right-to-left and each English run is
  isolated with `<bdi>`; ranges use a plain hyphen (`7-31`).

## Updating

1. Run the new SQL (in 12 parts) *before* the new code deploys.
2. Merge; after the deploy, check `/api/study/health` (`"schemaOk":true`).
3. Ask the group to close the app and open it again: a copy opened before the
   deploy keeps the old code until then.

## Tests

All local: no real Supabase project, no live site, no API key.

- `npm run test:study`: the unit tests (`tools/study-tests.mjs` bundles every
  `*.test.ts` under `server/`, `shared/` and `src/study/` and runs them with
  `node --test`). The local loop at the end of `server/study/work.test.ts`
  needs a local Postgres (`service postgresql start`, as root); without it
  that one test is skipped and says so.
- `npm run test:contract`: loads the real SQL into a throwaway local
  Postgres (`su postgres`), checks every RPC argument and column the
  TypeScript names, and writes `e2e/study/schema-dump.json` for the e2e mock.
- The SQL behaviour test, on a throwaway database:
  `createdb studytest`, then `psql -d studytest -f` each of
  `supabase/tests/stubs.sql`, `supabase/tests/board-schema.sql`,
  `supabase/study-schema.sql`, `supabase/tests/study.sql`; no line may say
  `FAIL`. `bash supabase/tests/writing-concurrency.sh`,
  `bash supabase/tests/quiz-concurrency.sh` and
  `bash supabase/tests/exam-concurrency.sh` race psql sessions.
- `npm run build` must stay free of chunk-size warnings with the entry chunk
  (`dist/assets/main-*.js`) under 400 kB; React and the Supabase client have
  chunks of their own. `npm run test:bundle` builds in memory with every
  flag on and fails at 400 kB, when a package's screen is in the entry
  chunk, or when the app uses one of the quiz's replaced names.
- The e2e flows (Playwright from a global install, against a mocked Supabase
  in the same process; never a real host):

  ```bash
  VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
    npx vite build --outDir /tmp/study-e2e
  NODE_PATH=$(npm root -g) node e2e/study/shell.cjs /tmp/study-e2e /tmp/study-e2e-out off
  NODE_PATH=$(npm root -g) node e2e/study/writing.cjs /tmp/study-e2e /tmp/study-e2e-out off
  ```

  Each script serves the build at `/`, prints its steps as JSON and fails on
  a page error, an unmocked or refused call, or an accessibility problem
  (`e2e/study/a11y.cjs`: contrast, 44 px targets, light and dark, 390 and
  360 px). Build again with a flag set's `VITE_STUDY_*` flags and run with
  `E2E_FLAGS=<set>`: `off`, `rel1`, `w4`, `w5`, `w5x`, `guide`, `guide1`,
  `prod`, `s1` (production's set with `VITE_STUDY_COURSES`:
  `e2e/study/courses.cjs`), `s2` (`s1` with `VITE_STUDY_EXAMS`:
  `e2e/study/exams.cjs`, past exams and the simulation) and the others
  `e2e/study/mock.cjs` lists. The fixtures in `e2e/study/fixtures/` are made
  for the tests (a synthetic lecture, and a synthetic 12-page exam that
  `fixtures/make-exam.cjs` prints into a PDF and photographs at test time);
  the group's own lectures and exams never go into git.

## Limits

- **A part has 270 seconds.** A function may run 300 s. A part still being
  written at 270 s is saved as failed ("timeout"), and "המשך כתיבה" writes it
  again at medium effort.
- **Identity is per device and per address.** The phone and the tablet are
  two members, names are unique in a group, and a new address means joining
  again (see [`docs/MOVE.md`](docs/MOVE.md)).
- **The room is what each phone says.** Within one study group that is
  harmless.
- **Presence is rationed.** Supabase allows each client 5 presence calls in
  30 seconds, so a follower's screen can lag the reader by a few seconds.
- **Deleting hides.** "מחיקה" hides a lecture from the group for 30 days
  ("נמחקו לאחרונה", "שחזור") before it and its pictures are removed.
- **Storage is shared** with the other apps on the same Supabase project:
  1 GB on the free tier. A PowerPoint lecture takes about 1 MB of pictures,
  a 100-page PDF about 10 MB.

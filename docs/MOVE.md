# העברת תמצית לכתובת משלה · Moving תמצית to its own address

**עברית** · [English below](#english)

תמצית יצאה מהמאגר `delo-logo-review` למאגר `tamtzit`, בהיסטוריה חדשה ונקייה (בלי חומר מהרצאות אמיתיות שהיה בהיסטוריה הישנה).
מה שנשאר אותו דבר: **אותו מסד Supabase** (אותה קבוצה, אותם סיכומים, אין
צורך להריץ SQL מחדש), אותם נתיבי שרת (`/api/study/*`). מה שהשתנה: האפליקציה
יושבת בשורש הכתובת (`/`) ולא ב-`/study/`. הכתובת הישנה ממשיכה לעבוד בינתיים.

## 0. להעלות את הקוד למאגר `tamtzit`

הקוד כבר הועלה לענף `main` של המאגר `tamtzit`. אין מה לעשות בסעיף הזה.

ה-push מריץ ב-Actions את בדיקת ה-smoke (`Deploy smoke test`). הריצה הראשונה
**תיכשל** (X אדום), כי עוד אין פרויקט Vercel שמגיש את האפליקציה. זה צפוי ולא
אומר שמשהו שבור. אחרי סעיף 1 (כולל `SITE_URL`): Actions → **Deploy smoke
test** → **Run workflow**, והפעם היא צריכה לעבור.

## 1. פרויקט Vercel חדש

1. Vercel → **Add New → Project**. במסך ה-Import, למעלה, לבחור את **ה-scope**
   (החשבון או הצוות שהפרויקט יהיה שייך לו): החשבון האישי, או הצוות שנועד
   לתמצית, **לא Delo-engineering**. Vercel פותח על הצוות שנבחר אחרון, אז
   לבדוק את זה לפני הכול. אחר כך לבחור את המאגר `tamtzit` → **Import**.
2. **Project Name**: `tamtzit`. השם קובע את הכתובת (`https://tamtzit.vercel.app`).
3. Framework: **Vite**. פקודת הבנייה ותיקיית הפלט כבר כתובות ב-`vercel.json`
   (`npm run build`, `dist`). Node 22 מגיע מ-`package.json`.
4. לפני ה-Deploy הראשון: להעתיק את משתני הסביבה (סעיף 2), ואז **Deploy**.
5. **לבדוק את הכתובת** ב-Settings → Domains. אם Vercel נתן כתובת אחרת (למשל
   עם סיומת של צוות או אותיות אקראיות, כי `tamtzit.vercel.app` תפוס), להוסיף
   שם `*.vercel.app` הגיוני ופנוי (למשל `tamtzit-study.vercel.app`) ב-**Add
   Domain**, ולהשתמש רק בו: לפתוח ממנו את האפליקציה ולשתף ממנו. את זה עושים
   **לפני ששולחים קישור כלשהו**: כל קישור הזמנה ושיתוף נבנה מהכתובת שבה
   האפליקציה פתוחה. אותה כתובת בדיוק נכנסת ל-`SITE_URL` (צעד 7), לבדיקות של
   סעיף 3 ולשורת ה-Vault בסעיף 4.
6. Settings → Functions: לוודא ש-**Fluid compute** פועל (`vercel.json` מבקש
   אותו; בלעדיו כותב השרת נעצר לפני 300 שניות).
7. GitHub → המאגר → Settings → Secrets and variables → Actions → Variables:
   `SITE_URL` = הכתובת החדשה (בדיקת ה-smoke אחרי כל push משתמשת בה). אחר כך
   להריץ את הבדיקה שוב (סעיף 0).

## 2. משתני סביבה להעתיק מהפרויקט הישן

Vercel → הפרויקט הישן → Settings → Environment Variables. להעתיק **שמות
וערכים כמו שהם** לפרויקט החדש (Production; Preview רק אם בודקים שם). מסומן **סוד**:
להעתיק ישירות בין המסכים, לא דרך צ'אט, מייל או קובץ במאגר.

| שם | |
|---|---|
| `ANTHROPIC_API_KEY` | **סוד** |
| `STUDY_WORKER_KEY` | **סוד**; חייב להיות **אותו ערך** כמו בפרויקט הישן ו-Vault `study_worker_key` |
| `VITE_SUPABASE_URL` | ציבורי |
| `VITE_SUPABASE_ANON_KEY` | ציבורי |
| `STUDY_MONTHLY_USD` | לא סוד (המאושר: 33) |
| `VITE_STUDY_SUPABASE_URL`, `VITE_STUDY_SUPABASE_ANON_KEY` | רק אם קיימים בישן |
| `SEND_EMAIL_HOOK_SECRET`, `STUDY_TRANSCRIBE_KEY` | **סוד**; רק אם קיימים בישן (אין קוד שקורא אותם עדיין) |

**דגלי השחרור**: להעתיק בדיוק את הקבוצה שמוגדרת ב-Production בפרויקט הישן,
כל אחד עם הערך `1`. דגל חסר או מיותר משנה מסכים, ו-`schemaOk` של health
תלוי בהם. הרשימה המלאה:

`VITE_STUDY_QUESTIONS` `VITE_STUDY_PRACTICE` `VITE_STUDY_CARDS`
`VITE_STUDY_CARDS_REVIEW` `VITE_STUDY_QUIZ` `VITE_STUDY_QUIZ_ROUNDS`
`VITE_STUDY_MEETING` `VITE_STUDY_ANCHOR` `VITE_STUDY_CORRECTIONS`
`VITE_STUDY_VAR` `VITE_STUDY_ASK` `VITE_STUDY_WALL` `VITE_STUDY_GUESS`
`VITE_STUDY_PROGRESS` `VITE_STUDY_TODAY` `VITE_STUDY_PULSE`
`VITE_STUDY_MARATHONS` `VITE_STUDY_GROUP_PLAN` `VITE_STUDY_NEEDS_ME`
`VITE_STUDY_EVE` `VITE_STUDY_MUSEUM` `VITE_STUDY_BOSS` `VITE_STUDY_TRAPS`
`VITE_STUDY_BLANK_TABLE` `VITE_STUDY_GUIDE` `VITE_STUDY_ACCOUNT`
`VITE_STUDY_PDF` `VITE_STUDY_RECORDINGS` `VITE_STUDY_EXAMS`
(ו-`VITE_STUDY_FAKE_ASR` לעולם לא ב-Production).

אחרי שינוי משתנים: Redeploy.

## 3. בדיקה

- `https://<הכתובת החדשה>/api/study/health` צריך להחזיר JSON עם
  `"anthropicKey":true`, `"workerOk":true`, `"schemaOk":true`.
- `GET https://<הכתובת החדשה>/api/study/work` צריך להחזיר
  `{"worker":true,"secondsLeft":…}` עם מספר קרוב ל-295.
- הדף עצמו: `https://<הכתובת החדשה>/` נפתח עם הכותרת "תמצית". קישור ישן בסגנון
  `/study/?l=…` מועבר ל-`/?l=…`.

## 4. כתיבה בשרת: להפנות את מסד הנתונים לכתובת החדשה

מסד הנתונים קורא לשרת בעצמו (pg_net ו-pg_cron). הכתובת **לא בקוד** אלא בסוד
Vault בשם `study_site_url`, וה-SQL מוסיף לה `/api/study/work`. כל עוד לא משנים
אותו, הכתיבה בשרת ממשיכה לרוץ דרך הפרויקט הישן, וזה בסדר.

רק אחרי שבדיקת סעיף 3 עברה (`workerOk:true`, `secondsLeft` קרוב ל-295),
ב-Supabase → SQL Editor:

```sql
select vault.update_secret(id, 'https://tamtzit.vercel.app') from vault.secrets where name = 'study_site_url';
```

(עם הכתובת מסעיף 1, צעד 5, אם היא אחרת; בלי `/` בסוף.) לבדוק:

```sql
select name from vault.secrets where name like 'study_%';
select jobname, schedule from cron.job where jobname like 'study-%';
select id, status_code, error_msg, created from net._http_response order by id desc limit 10;
```

`401` אומר ש-`STUDY_WORKER_KEY` בפרויקט החדש שונה מה-Vault. חזרה לאחור: אותה
שורה עם `https://delo-logo-review.vercel.app`.

## 5. מה קורה לחברי הקבוצה בכתובת חדשה

- הזהות של כל חבר שמורה **בטלפון, לכל כתובת בנפרד**. בכתובת החדשה כל אחד
  מתחיל כמכשיר חדש: נכנס עם **קוד הקבוצה** (בכתובת הישנה: "הזמנה לקבוצה").
  אין ליצור קבוצה חדשה.
- השם תפוס: הרשומה הישנה עדיין מחזיקה בשם, ולכן מצטרפים בשם קצת אחר
  (למשל "שוהם ש.").
- כל מה שמשותף לקבוצה (הרצאות, סיכומים, שאלות, תגובות) מופיע מיד.
- ההיסטוריה האישית (כרטיסיות, תרגול, התקדמות, הגדרות) נשארת על הזהות הישנה,
  בכתובת הישנה, עד שייבנה קישור העברה. גם הרשאות יוצר/ת הקבוצה נשארות שם.
- אפליקציה שהוספה למסך הבית מהכתובת הישנה צריך להוסיף מחדש מהכתובת החדשה.
- **רשימת החברים מוכפלת.** כל הצטרפות בכתובת החדשה היא רשומה חדשה, והישנה
  נשארת. אחרי שכולם הצטרפו הקבוצה תראה בערך 12 חברים ("12 בקבוצה" בספרייה,
  וגם ברשימות החברים), ושש מהרשומות הן הישנות, עם השמות האמיתיים. צריך
  להחליט:
  1. יוצר/ת הקבוצה, **מהכתובת הישנה** (שם נשארו ההרשאות), מסיר/ה כל רשומה
     ישנה אחרי שאותו חבר הצטרף מחדש. ההסרה מוחקת רק את החברות בקבוצה:
     תגובות ותיקונים נשארים, אבל ההיסטוריה האישית של הזהות הישנה (כרטיסיות,
     תרגול, התקדמות) כבר לא תוצג לאף אחד. את הרשומה הישנה של היוצר/ת עצמו/ה
     אי אפשר להסיר.
  2. להשאיר את שתי הרשומות עד שייבנה קישור העברה.
  3. או: להמשיך להשתמש בכתובת הישנה ככתובת הראשית עד שקישור העברה קיים,
     ולעבור רק אז.

## 6. בזמן ששתי הכתובות חיות

- שני הפרויקטים צריכים את אותו `STUDY_WORKER_KEY` ואת `ANTHROPIC_API_KEY`;
  התקציב החודשי משותף (טבלת `study_usage`).
- `supabase/study-schema.sql` הוא קובץ אחד לשתי הכתובות: הרצה של גרסה חדשה
  מהמאגר הזה משנה גם את מה שהכתובת הישנה רואה, ושם health עלול לומר
  `schemaOk:false`. לפני שינוי SQL ראשון כאן: להקפיא את הכתובת הישנה או
  להפנות אותה לחדשה.
- **מה שמחזיק את מסד הנתונים ער נשאר במאגר הישן.** Supabase בחינם משהה פרויקט
  אחרי בערך שבוע בלי תנועה. היום מעיר אותו כל יום `.github/workflows/keepalive.yml`
  במאגר `delo-logo-review`, והוא לא הועתק לכאן. לפני שמארכבים את המאגר הישן או
  מכבים בו את Actions, להעביר את ה-keepalive לכאן (או להוסיף כאן אחד שקורא
  ל-`/api/study/health`). אחרת, בשבוע שקט כמו חופשה, תמצית תפסיק לעבוד.
- **עבודה שלא מוזגה נשארה במאגר הישן.** הענפים `study/w1`, `study/w`,
  `study/a1`, `study/q`, `study/c` ו-`study/k` שמורים רק ב-
  `docs/study/wip/branches.bundle` של `delo-logo-review` (ההסבר ב-
  `docs/study/wip/README.md` שם). הם לא הועתקו לכאן, כי הם בנויים על
  ההיסטוריה של המאגר הישן. לשחזר אותם בעותק של `delo-logo-review`:
  `git fetch docs/study/wip/branches.bundle 'refs/heads/*:refs/heads/*'`.
  לפני שמוחקים את המאגר הישן: לשמור עותק של הקובץ הזה.

---

<a id="english"></a>
## English

תמצית moved from the `delo-logo-review` repository to `tamtzit`, with a fresh,
clean history (no real lecture material from the old history). Unchanged: the **same Supabase database** (same group and data, no
SQL to run again) and the server paths (`/api/study/*`). Changed: the app is
served at the root (`/`) instead of `/study/`. The old address keeps working
for now.

**0. The code is already on `tamtzit`'s `main` branch.** Nothing to do here.

The push runs the `Deploy smoke test` workflow. Its first run **fails** (a
red X) because no Vercel project serves the app yet; that is expected, not a
broken deploy. After step 1 (including `SITE_URL`), run it again: Actions →
Deploy smoke test → Run workflow.

**1. New Vercel project.** Vercel → Add New → Project. On the Import screen,
pick the **scope** (the account or team that will own the project) first:
the personal account, or the team meant for תמצית, **not Delo-engineering**;
Vercel opens on the last team used. Then GitHub repo `tamtzit` → Import, and
set **Project Name** to `tamtzit` (the name sets the address,
`https://tamtzit.vercel.app`). Framework Vite; build command and output
(`npm run build`, `dist`) come from `vercel.json`, Node 22 from
`package.json`. Copy the variables (step 2) before the first deploy. Then
**check the address** in Settings → Domains: if Vercel assigned another one
(a team suffix or random letters because `tamtzit.vercel.app` is taken), add
a logical free `*.vercel.app` name (for example `tamtzit-study.vercel.app`)
with Add Domain and use only that one, to open the app and to share from,
**before any link is shared**: every invite and share link is built from the
address the app is open at. Use that exact address for `SITE_URL`, the
checks in step 3 and the Vault line in step 4. Check that Fluid compute is on
(Settings → Functions). In GitHub → Settings → Secrets and variables →
Actions → Variables, set `SITE_URL` to the new address for the smoke
workflow, then re-run it (step 0).

**2. Variables to copy from the old project** (names and values as they
are; **secret** = copy screen to screen only):
`ANTHROPIC_API_KEY` (**secret**), `STUDY_WORKER_KEY` (**secret**) (must stay the same value as
the old project and Vault's `study_worker_key`), `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (public), `STUDY_MONTHLY_USD` (approved 33), and only
if the old project has them: `VITE_STUDY_SUPABASE_URL`,
`VITE_STUDY_SUPABASE_ANON_KEY`, `SEND_EMAIL_HOOK_SECRET` (**secret**),
`STUDY_TRANSCRIBE_KEY` (**secret**). Release flags: copy the old project's Production
set exactly, each `1` (list in step 2 above; never `VITE_STUDY_FAKE_ASR`).
Redeploy after changes.

**3. Check.** `/api/study/health` → `"anthropicKey":true`,
`"workerOk":true`, `"schemaOk":true`. `GET /api/study/work` →
`{"worker":true,"secondsLeft":…}` near 295. `/` shows "תמצית"; an old
`/study/?l=…` link redirects to `/?l=…`.

**4. Server writing.** The database calls the site itself (pg_net, pg_cron).
The address is not in code: it is the Vault secret `study_site_url`, to
which the SQL appends `/api/study/work` (`study_private.dispatch` and
`study_private.points_ahead_kick` in `supabase/study-schema.sql`). Until it
changes, the old project keeps doing the server writing. After step 3
passes, run in the SQL Editor:

```sql
select vault.update_secret(id, 'https://tamtzit.vercel.app') from vault.secrets where name = 'study_site_url';
```

(the address from step 1 if it is another one; no trailing slash), then
the three checks in step 4 above. A `401` in `net._http_response` means the
new project's `STUDY_WORKER_KEY` differs from Vault. Roll back with the same
line and `https://delo-logo-review.vercel.app`.

**5. Members on a new address.** A member's identity lives on the phone,
per address. On the new address everyone starts as a new device and joins
again with the **group code** (old address: "הזמנה לקבוצה"); never create a
new group. Their old name is still held by their old entry, so they join
with a slightly different name. Everything shared (lectures, summaries,
questions, comments) is there at once; personal history (cards, practice,
progress, settings) and the group creator's controls stay with the old
identity on the old address until a move link is built. Home-screen icons
must be added again from the new address. **The member list doubles**: each
join on the new address is a new entry and the old one stays, so once
everyone has re-joined the group shows about 12 members ("12 בקבוצה" in the
library and in the member lists), six of them the old entries with the real
names. Choose one: (1) the group's creator, **from the old address** (where
the creator's controls are), removes each old entry once that member has
re-joined; removal deletes only the membership, so comments and corrections
stay but the old identity's personal history (cards, practice, progress) is
no longer shown, and the creator's own old entry cannot be removed; (2) keep
both entries until a move link is built; or (3) keep the old address as the
main one until a move link exists, and move then.

**6. While both addresses run.** Both projects need the same
`STUDY_WORKER_KEY` and `ANTHROPIC_API_KEY`, and they share the monthly
budget (`study_usage`). `supabase/study-schema.sql` serves both: running a
new version from this repo changes what the old address sees too, and its
health may turn `schemaOk:false`. Freeze or redirect the old address before
the first SQL change made here. **The database's keep-alive stays in the old
repository**: Supabase's free tier pauses a project after about a week with
no traffic, and today `.github/workflows/keepalive.yml` in `delo-logo-review`
pings it daily; it was not copied here. Before that repository is archived
or its Actions are turned off, move the keep-alive here (or add one here that
calls `/api/study/health`), or a quiet week such as a holiday break stops
תמצית. **Unmerged work stays in the old repository**: the branches
`study/w1`, `study/w`, `study/a1`, `study/q`, `study/c` and `study/k` are only
in `delo-logo-review`'s `docs/study/wip/branches.bundle` (explained in
`docs/study/wip/README.md` there). They were not copied, since they are built
on the old repository's history. Restore them in a `delo-logo-review`
checkout with `git fetch docs/study/wip/branches.bundle
'refs/heads/*:refs/heads/*'`, and keep a copy of that file before the old
repository is deleted.

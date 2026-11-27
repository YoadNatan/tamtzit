# תמצית, "השוואת מודלים" (section Y 1): Yoad's steps

Routes per kind of work and the side-by-side comparison of models:
[`models.md`](models.md). Yoad's choices for it (every current Claude model,
other providers later with scope `all` once approved, the comparison line a
fixed $3.30 a month, $1.50 a run, 3 runs a day, members rate blind, the
notice `lab_new` in the inbox) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md), "Models and the
comparison". Built on `dev`; each release point below works on its own and
rolls back on its own.

**What this release holds (slices 1 to 3 of the design):** the routing seam
(with nothing set, every call is today's, on Claude Opus 5.5), section Y 1,
the op `lab` for the kinds with an answer key (the question check, a
correction's check, a past exam's or a sheet's read) and for the kinds rated
by people (practice questions, a set's questions, points, cards, "לשאול", a
summary part), the owner's screens ("השוואות", "תוצאות" and "מי כותב מה"
under "שלי"), the members' blind rating, the solver's paid check of practice
answers, the AI score (off by default), the share to the group's WhatsApp
and R's notice `lab_new`. OpenAI, Gemini and OpenRouter are in the same
code, off until a key and the owner's approval: [`RELEASE-Y2.md`](RELEASE-Y2.md).

## Rules for all of it

- **Production only.** Never put `VITE_STUDY_MODELS` or a provider's key
  (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) on Preview:
  Preview shares the production database.
- **Order:** the code is merged to `main` and deployed first (the flag is
  off, so nothing changes; with no route set every call is today's), then the
  SQL, then the flag, then the switch `lab`. Never the flag before the SQL:
  the app would report the schema as missing (`"schemaOk": false`).
- **The SQL from this `dev` is parts 1 to 12, in order**, each to the end.
  Section Y 1 is at the end of part 12, after section O 3; parts 1 to 11 hold
  the earlier sections, some of them edited in place by uploaded sheets
  ([`RELEASE-O.md`](RELEASE-O.md)). Running parts 1 to 12 installs I, R, L,
  O and Y together; nothing new shows or spends before its own flag and
  switch. Y adds no part: the file is still in 12 parts (part 12 is
  136,508 B of the 170,000 a part may hold). Tested on a copy of
  production's schema (`eed179e`) with parts 1 to 12 and `study.sql`, and
  as an upgrade from `1bcad51`.
- **Money:** section Y spends nothing by itself. A comparison spends the
  group's budget on the worker's path (in nobody's own share, never in
  "נוצל על ידך החודש"): at most **$1.50 a run** (its worst case, checked
  before anything is reserved), **3 runs a day** (Israel's day) and
  **$3.30 a month** (the comparison line, `lab_settings.lab_usd`, never
  above 15% of the cap). The sub-lines of practice sets ($12), sheets ($6)
  and similar questions ($5) and the summaries' protected 20% are unchanged.
  A typical first run (the question check on 10 bank questions, Opus
  against Haiku) costs about $0.03; a past exam's read about $0.30.

## Release point 1: the SQL and the routing seam (nothing visible)

1. **Merge to `main` and let Vercel deploy.** Nothing changes for anyone:
   no route is set, so every call is made as before.
2. **Supabase → SQL Editor: run `supabase/parts/1.sql` to `12.sql` in
   order**, each to the end (safe to run again). Then check, read only:
   ```sql
   select public.study_schema() ->> 'Y' as y;                                        -- 1
   select name, enabled from study_private.features where name in ('lab', 'routes'); -- lab false (routes: no row, which is on)
   select jobname, schedule from cron.job where jobname = 'study-lab-sweep';         -- 7,22,37,52 * * * *
   ```
3. **Open `/api/study/health`:** `"schema"` has `"Y": 1`, `"budgetUsd": 33`,
   `"providers": {"anthropic": true, "openai": false, …}` (booleans only) and
   `"stalePrices": []`.
4. **The owner (OD2).** Comparisons and routes belong to the group's creator.
   Check, read only, that it is Yoad's account and that it has a personal
   code (an anonymous session that ends would lose the role):
   ```sql
   select g.name, g.created_by from public.study_groups g;
   ```
   If someone else should run comparisons too, add them once:
   ```sql
   insert into study_private.lab_admins (user_id) values ('<user id>');
   ```

## Release point 2: the screens, then comparisons

1. **Vercel → Settings → Environment Variables:** `VITE_STUDY_MODELS = 1`,
   **Production only**, then **Redeploy**. "שלי" now shows the owner the row
   "השוואת מודלים · איזה מודל כותב כל דבר, ובכמה". The tabs open; "מי כותב
   מה" lists every kind on Claude Opus 5.5 ("ברירת מחדל") with its month.
   Health asks for Y 1 with this flag (`"schemaOk": true`).
2. **Turn comparisons on** (SQL Editor):
   ```sql
   update study_private.features set enabled = true, changed_at = now() where name = 'lab';
   ```
3. **The first comparison.** "שלי" → "השוואת מודלים": the card "השוואה
   ראשונה מומלצת" (the question check on 10 bank questions, Opus against
   Haiku, "עד $0.03") → "להתחיל" → "להריץ (עד $…)". The screen shows only
   "k מתוך n תשובות מוכנות" while it runs (the owner is blind too); the
   phone may lock or leave. When it is done: each answer under its label
   with its checks ("10/10 תואמות למפתח"), then "הצגת השמות והעלות": the
   names, the time, the cost, quality against price side by side, and each
   model's month at this rate.
4. **The results:** "תוצאות" shows a card per model (quality as the match
   with the key, the price a call and a month, refusals, false rejects).
   The recommendation ("Claude Haiku 5.5 זול פי …, ותאם למפתח ב-…%") shows
   only after **20 checked questions for both models** with the match within
   2 points and no more false rejects; under 50 it says "בסיס קטן". Its button
   "להשתמש בו ל״…״" opens the route sheet; "החלפה" sets that kind's model,
   and "חזרה לברירת המחדל" undoes it from the same sheet.
5. **The notice.** A run of a kind members rate (with the blind rating's
   package) sends `lab_new` to the inbox only (no push). To push it as well:
   ```sql
   update study_private.notice_kinds set cat = 'mine', push = true where kind = 'lab_new';
   ```

## Release point 3: the blind rating (no SQL beyond parts 1 to 12)

Nothing new to run: the rating's functions are section Y 1's. With the flag
and the switch `lab` on:

1. **A rated comparison.** "שלי" → "השוואת מודלים" → "השוואה חדשה" → under
   "הקבוצה מדרגת", "שאלות תרגול" (Opus against Sonnet are ticked; "להריץ (עד
   $…)" includes the solver's check of each answer, about $0.004 an answer).
   "לשאול" asks for a question first (at most 500 characters). The AI score
   is under "עוד אפשרויות", off; ticked, its worst case joins the button's.
   A typical practice run costs about $0.25-0.40; a summary part about $0.35
   (each under the $1.50 cap, checked before anything is reserved).
2. **Rate it, blind.** When it is done the owner rates too (blind, counted,
   OD3): one score 1-5 an answer, "יש כאן טעות עובדתית" when there is one,
   then the best answer and "שמירה והצגת השמות". Only then the names, times
   and costs show.
3. **Send it to the group:** "לשלוח לקבוצה לדירוג" → "לשלוח בוואטסאפ" (the
   message: "יש השוואה חדשה לדירוג בתמצית (בערך 2 דקות): {link}"). Members
   also see "השוואות לדירוג · {n} מחכות" on "שלי" and the notice in the bell
   (inbox only; to push it too, the line under release point 2).
4. **Members** open the row (it goes straight to the oldest waiting run),
   rate or skip; their scores count from their own reveal. A summary part's
   run is the owner's to rate alone.
5. **"לבדוק עכשיו"** shows on a run whose solver's check could not run in
   time; it runs the checks left (claimed once, never paid twice).

The help screen gains the row "השוואת מודלים" and, in its footer, one line on
the companies the group's material is sent to (Anthropic until a provider is
approved; then the WhatsApp message of "Other providers" below).

## Stopping it, one line each (SQL Editor)

```sql
update study_private.features set enabled = false, changed_at = now() where name = 'lab';           -- comparisons off (planned runs stop too)
insert into study_private.features (name, enabled) values ('routes', false)
  on conflict (name) do update set enabled = false, changed_at = now();                             -- every kind back to Opus at once
delete from public.study_model_routes where group_id = '<group>' and route = '<key>';               -- one kind back to Opus
update public.study_model_providers set allowed = false where provider = '<provider>';              -- a provider off
insert into study_private.lab_settings (group_id, lab_usd) values ('<group>', 2.00)
  on conflict (group_id) do update set lab_usd = excluded.lab_usd;                                  -- the month's comparison line
```

Removing `VITE_STUDY_MODELS` (and Redeploy) hides the screens; routes already
set keep working until the switch `routes` is off or the rows are deleted.

## Other providers (later packages of this wave)

**OpenAI and Google are built:** their steps (prices checked first, the
limit at each provider, the keys, consent) are in
[`RELEASE-Y2.md`](RELEASE-Y2.md), and so are OpenRouter's (the DeepSeek,
Qwen, Kimi and GLM models).

The app lists OpenAI, Google and OpenRouter in "מי כותב מה" → "ספקים" ("כרגע
רק Claude" until a key is set). Before a key goes in, per provider (OD18):
$5 of prepaid credit with auto-recharge off (Google: a low requests-per-day
quota), the key on **Production only**, then Redeploy; for OpenRouter the
account setting that blocks providers that train on data. Then "לאשר שליחה"
in the app records the group's consent (scope `all`). Its prices count as
checked only from the vendor's own page; an unchecked price is never routed.

**The message to the group (OD21)**, once a provider is approved (in the
group's WhatsApp, with the provider's name):

> עדכון בתמצית: מי שפתחו את הקבוצה יכולים עכשיו להשוות בין מודלים שכותבים
> את החומר (סיכומים, שאלות, בדיקות), ולבחור לכל סוג עבודה את המודל שמתאים
> לו. מעכשיו החומר שלנו (הרצאות עם תמונות, מבחנים ודפים שהועלו, ונוסח
> שכתבנו בקבוצה) עשוי להישלח גם ל-{ספק}, בלי שמות של חברי הקבוצה. אפשר לראות
> לאן החומר הולך ב״עזרה״, בשורה האחרונה.

## Each month (OD23)

Compare each provider's invoice with the ledger:
```sql
select split_part(model, ':', 1) as provider, round(sum(cost_usd), 2) as usd
  from public.study_usage where created_at >= date_trunc('month', now()) group by 1;
```
A gap above $2 for a month: turn `routes` off (above) until it is explained.
Anthropic's rows have no prefix (their ids are bare).

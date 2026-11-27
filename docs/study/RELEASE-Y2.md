# תמצית, "השוואת מודלים" with OpenAI and Google (phase 2): the owner's steps

What this adds to [`RELEASE-Y1.md`](RELEASE-Y1.md): the app can now call
**OpenAI** (the Responses API) and **Google Gemini** (streamGenerateContent),
with plain `fetch` and no new package, in comparisons and, once a price is
checked, in a kind's route. The design is "design-models, revision 2", WP9;
the decisions (all providers may see everything once approved, scope `text`
kept as an option, one informational privacy line) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md), "Models and the
comparison"; how it works is in [`models.md`](models.md), "Other providers".

Nothing here changes anything for the group until a key is set **and** the
owner taps "לאשר שליחה" for that provider.

## Rules for all of it

- **No SQL beyond release Y1.** The SQL from this `dev` is still **parts 1
  to 12, in order** (section Y 1 is at the end of part 12; see
  `RELEASE-Y1.md`). If they already ran, there is nothing to run.
- **Production only.** `OPENAI_API_KEY` and `GEMINI_API_KEY` go on
  **Production only**, never Preview (Preview shares the production
  database), marked **Sensitive**. The app never shows, asks for or stores a
  key; `/api/study/health` says only `true` or `false`.
- **A hard limit at the provider first (OD18),** before its key goes in.
  The app's ledger is the first control; the provider's limit is the one
  that holds if anything goes wrong.
- **Prices.** Every OpenAI and Google price in the registry is
  `verified: false`: the build could not load the vendors' pricing pages
  (their hosts are outside the build's network), so the figures come from
  searches limited to the vendors' own sites, dated 2026-11-27. An
  unverified model may be **compared** (its worst case counted × 1.5) but
  is **never routed** for the group's real work. To route one, check its
  price first (step 1 below).
- **Money.** Comparisons stay inside the $3.30 line, $1.50 a run and 3 runs
  a day (release Y1). A call that a provider cut before reporting its usage
  is counted at its full reservation, never at $0.

## 1. Check the prices (once per provider, and when "המחיר נבדק לפני יותר מ-45 יום" shows)

Open the vendor's own page and compare it with `shared/study/models.ts`
(`OTHER_MODELS`), per million tokens:

| Model (the app's id) | Input | Cached input | Output | Page |
|---|---|---|---|---|
| GPT-6.2 Astra (`openai:gpt-6.2-astra`) | 8 | 0.40 | 40 | https://developers.openai.com/api/docs/pricing |
| GPT-6.2 Sol (`openai:gpt-6.2-sol`) | 2 | 0.10 | 10 | same |
| GPT-6.1 Terra (`openai:gpt-6.1-terra`) | 1 | 0.05 | 5 | same |
| GPT-6 Luna (`openai:gpt-6-luna`) | 0.10 | 0.01 | 0.50 | same |
| OpenAI, above 272k input tokens | input and cache × 2, output × 1.5 | | | same |
| Gemini 4 Argon (`google:gemini-4-argon`) | 4 | 0.40 | 20 | https://ai.google.dev/gemini-api/docs/pricing |
| Gemini 3.8 Flash (`google:gemini-3.8-flash`) | 0.75, from 2027-01-01 1.50 | 0.075, then 0.15 | 3.75, then 7.50 | same |

Where a figure differs, or matches, a developer edits that model's row:
the price, `checked: "<today>"` and `verified: true` (and a dated row for a
price that changes later). Only then does "מי כותב מה" offer the model for a
kind. The model ids are the vendors' own; one that a vendor no longer lists
is removed the same way.

## 2. OpenAI

1. **platform.openai.com → Settings → Billing:** add **$5** of prepaid
   credit and leave **auto recharge off**. (A project budget alone only
   warns.)
2. Create a **project API key** for this app only.
3. **Vercel → Settings → Environment Variables:** `OPENAI_API_KEY` =
   the key, **Production only**, Sensitive. Then **Redeploy**.
4. Open `/api/study/health`: `"providers": {…, "openai": true, …}`.
5. In the app: "שלי" → "השוואת מודלים" → "מי כותב מה" → "ספקים" → OpenAI
   "מוגדר" → **"לאשר שליחה"**. "מה יישלח": **"כל החומר"** (the default:
   lectures with pictures, past exams and uploaded sheets, members' wording;
   never members' names) or **"רק טקסט"** (points, cards, a recording's
   notes and the AI score only). The choice is recorded per provider.

The app sends every OpenAI request with `store: false` (OpenAI keeps no copy
of the response for later retrieval) and pictures as their bytes, never a
link to the group's storage.

## 3. Google Gemini

1. **Google AI Studio → Get API key** from a **Google Cloud project with
   billing on**. Use of the API without billing is the free tier, whose
   inputs Google may use: never put such a key here.
2. **Google Cloud console → APIs & Services → Generative Language API →
   Quotas:** set a low **requests per day** (for example 200). A Google
   budget only sends an alert; the quota is the limit that holds.
3. **Vercel:** `GEMINI_API_KEY`, **Production only**, Sensitive, then
   **Redeploy**.
4. `/api/study/health`: `"google": true`.
5. In the app, Google's "לאשר שליחה", as for OpenAI.

The key is sent in a header (`x-goog-api-key`), never in a URL.

## 4. The first comparison per provider (WP9's done-when)

With the switch `lab` on (release Y1): "השוואה חדשה" → **"נקודות שצריך
לדעת"** → Claude Opus 5.5 with GPT-6.2 Sol, or with Gemini 3.8 Flash (both
appear once approved, tagged "מחיר לא נבדק") → "להריץ (עד $…)". The run is
blind as always: no model's name, time or cost before the reveal. A points
run costs about $0.10-0.20. A provider that refuses or fails shows "המודל
סירב" or "משהו השתבש" on its answer; nothing falls back to Claude inside a
comparison.

## 5. Tell the group (OD21)

Help's footer now names where the material goes ("החומר של הקבוצה נשלח
לכתיבה ל-Anthropic (Claude), ובהשוואת מודלים גם ל-OpenAI…"). Once a provider
is approved, send this to the group's WhatsApp (with the provider's name):

> עדכון בתמצית: מי שפתחו את הקבוצה יכולים עכשיו להשוות בין מודלים שכותבים
> את החומר (סיכומים, שאלות, בדיקות), ולבחור לכל סוג עבודה את המודל שמתאים
> לו. מעכשיו החומר שלנו (הרצאות עם תמונות, מבחנים ודפים שהועלו, ונוסח
> שכתבנו בקבוצה) עשוי להישלח גם ל-{ספק}, בלי שמות של חברי הקבוצה. אפשר לראות
> לאן החומר הולך ב״עזרה״, בשורה האחרונה.

(For a provider approved with "רק טקסט": "…עשוי להישלח גם ל-{ספק} טקסט
מההרצאות בלבד, בלי תמונות, בלי מבחנים ובלי נוסח שכתבנו בקבוצה…")

## Stopping it

- In the app: "לבטל את האישור" on the provider (at once, for comparisons and
  routes).
- SQL Editor, one line:
  ```sql
  update public.study_model_providers set allowed = false where provider = '<openai|google>';
  ```
- Removing the key in Vercel takes effect only after a **Redeploy**.

## Each month (OD23)

Compare each provider's invoice with the ledger (the query in
`RELEASE-Y1.md`, "Each month": ledger ids are `openai:…` and `google:…`). A
gap above $2 for a month: turn `routes` off until it is explained.

## Not in this release

OpenRouter and the Chinese models (DeepSeek, Qwen, Kimi, GLM; zero data
retention, hosts outside China) come with the OpenRouter package (WP10):
"ספקים" lists OpenRouter, but a key alone does not make it usable until
that package's adapter is merged.

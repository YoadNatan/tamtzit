# תמצית, "השוואת מודלים" with OpenAI, Google and OpenRouter (phases 2 and 3): the owner's steps

What this adds to [`RELEASE-Y1.md`](RELEASE-Y1.md): the app can now call
**OpenAI** (the Responses API), **Google Gemini** (streamGenerateContent) and,
through **OpenRouter** (Chat Completions), the Chinese open models
**DeepSeek, Qwen, Kimi and GLM**, with plain `fetch` and no new package, in
comparisons and, once a price is checked, in a kind's route. The design is
"design-models, revision 2", WP9 and WP10; the decisions (all providers may
see everything once approved, scope `text` kept as an option, one
informational privacy line, the Chinese models only through OpenRouter with
zero data retention) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md), "Models and the
comparison"; how it works is in [`models.md`](models.md), "Other providers"
and "OpenRouter".

Nothing here changes anything for the group until a key is set **and** the
owner taps "לאשר שליחה" for that provider.

## Rules for all of it

- **No SQL beyond release Y1.** The SQL from this `dev` is still **parts 1
  to 12, in order** (section Y 1 is at the end of part 12; see
  `RELEASE-Y1.md`). If they already ran, there is nothing to run.
- **Production only.** `OPENAI_API_KEY`, `GEMINI_API_KEY` and
  `OPENROUTER_API_KEY` go on **Production only**, never Preview (Preview
  shares the production database), marked **Sensitive**. The app never shows, asks for or stores a
  key; `/api/study/health` says only `true` or `false`.
- **A hard limit at the provider first (OD18),** before its key goes in.
  The app's ledger is the first control; the provider's limit is the one
  that holds if anything goes wrong.
- **Prices.** Every OpenAI, Google and OpenRouter price in the registry is
  `verified: false`: the build could not load the vendors' pricing pages
  (their hosts are outside the build's network), so the figures come from
  searches limited to the vendors' own sites, dated 2026-11-27. An
  unverified model may be **compared** (its worst case counted × 1.5) but
  is **never routed** for the group's real work. To route one, check its
  price first (step 1 below; OpenRouter's models in step 6).
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

## 6. OpenRouter: DeepSeek, Qwen, Kimi and GLM (WP10)

The Chinese models go **only through OpenRouter** (OD22), never to their
makers' own endpoints. Every request the app sends asks OpenRouter for
**zero data retention** and **no data collection** (`provider:
{data_collection: "deny", zdr: true}`) and **leaves out the providers based
in China**, so an open model (DeepSeek, Qwen3.8, Kimi K3, GLM) runs on a host
elsewhere. One model only its maker serves, **Qwen4 Max (Alibaba Cloud)**,
goes without that exclusion (still zero retention), and a new comparison
says under it **"המעבד של Alibaba Cloud נמצא בסין."**; leave it unticked if
that is not wanted. Where no host meets these terms, OpenRouter refuses
before anything is written: the slot shows "משהו השתבש" and costs $0.

1. **openrouter.ai → Settings → Credits:** add **$5** of credit and leave
   **auto top-up off**. OpenRouter adds **5.5%** to each purchase; the app
   counts it (a call costs the larger of the registry's price and
   OpenRouter's own figure, × 1.055).
2. **openrouter.ai → Settings → Privacy** (the second layer to each
   request's own terms): turn off providers that may **train on** or
   **retain** prompts, and turn on **zero data retention only**. Under
   **Preferences → Ignored providers**, add the providers based in China:
   DeepSeek, Alibaba, Moonshot AI, Z.AI, SiliconFlow, Baidu, MiniMax,
   StepFun, Tencent, Xiaomi, ByteDance, Baichuan (the same list the app
   sends, `CHINA_HOSTS` in `server/study/llm/compat.ts`). This blocks Qwen4
   Max too, which is fine: it then fails at $0.
3. Create an **API key** for this app only (Settings → Keys; a key's own
   credit limit, e.g. $5, is a third layer).
4. **Vercel:** `OPENROUTER_API_KEY`, **Production only**, Sensitive, then
   **Redeploy**. `/api/study/health`: `"openrouter": true`.
5. In the app: "ספקים" → OpenRouter "מוגדר" → **"לאשר שליחה"** ("כל החומר"
   by default, or "רק טקסט"), as for OpenAI.
6. **Prices:** every OpenRouter row is `verified: false` (openrouter.ai
   could not be loaded from the build; the figures come from searches of
   openrouter.ai, whose snapshots disagreed, so the highest seen is kept).
   Before a route, open each model's page and compare (per million tokens,
   input / cached input / output, before the 5.5%):

   | Model (the app's id) | Prices in the registry | Page |
   |---|---|---|
   | DeepSeek V4 Pro (`openrouter:deepseek/deepseek-v4-pro`) | 0.66 / 0.14 / 2.70 | https://openrouter.ai/deepseek/deepseek-v4-pro |
   | DeepSeek V4 Flash (`openrouter:deepseek/deepseek-v4-flash`) | 0.05 / 0.01 / 1.28 | https://openrouter.ai/deepseek/deepseek-v4-flash |
   | Qwen3.8 2.4T A95B (`openrouter:qwen/qwen3.8-2.4t-a95b-20260812`) | 2.00 / 0.25 / 6.00 | https://openrouter.ai/qwen/qwen3.8-2.4t-a95b-20260812 |
   | Qwen4 Max (`openrouter:qwen/qwen4-max-20261115`), Alibaba Cloud only | 1.50 / 0.075 / 4.50 | https://openrouter.ai/qwen/qwen4-max-20261115 |
   | Kimi K3 (`openrouter:moonshotai/kimi-k3`), reads pictures | 2.28 / 0.228 / 24.00 | https://openrouter.ai/moonshotai/kimi-k3 |
   | GLM 5.3 (`openrouter:z-ai/glm-5.3`) | 2.10 / 0.42 / 6.60 | https://openrouter.ai/z-ai/glm-5.3 |

   Read the price **of the hosts outside China with zero data retention**
   (the page's provider table), not the cheapest host. Where it differs, a
   developer edits the row with `checked` and `verified: true`, as in step
   1. Only Kimi K3 is marked as reading pictures; a model whose page says it
   reads images gets `vision: true` the same way.
7. **The first comparison:** "השוואה חדשה" → "נקודות שצריך לדעת" → Claude
   Opus 5.5 with DeepSeek V4 Pro (about $0.02-0.05 worst case for points).
   The run is blind as always.
8. **Tell the group** with section 5's message, naming "OpenRouter (DeepSeek,
   Qwen, Kimi, GLM)" as the provider. Help's line names OpenRouter once it
   is approved.

## Stopping it

- In the app: "לבטל את האישור" on the provider (at once, for comparisons and
  routes).
- SQL Editor, one line:
  ```sql
  update public.study_model_providers set allowed = false where provider = '<openai|google|openrouter>';
  ```
- Removing the key in Vercel takes effect only after a **Redeploy**.

## Each month (OD23)

Compare each provider's invoice with the ledger (the query in
`RELEASE-Y1.md`, "Each month": ledger ids are `openai:…`, `google:…` and
`openrouter:…`; OpenRouter's activity page lists each call with its cost,
and the ledger's figure includes the 5.5% fee). A
gap above $2 for a month: turn `routes` off until it is explained.

## Not in this release

WP12 (the outline and the ask route through `run()`, so they can move off
Claude) and WP13 (overnight comparisons through batch APIs) stay later
(OD1).

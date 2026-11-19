# תרגול 2.0: what Yoad approved (15 Nov 2026)

Published proposal: https://claude.ai/artifact/9orTxfJBEKno8MNEDFzbvr (source: `practice-2.html`, mockups: `mockups.html`). Approved as is ("מאשר").

## Why (Yoad's feedback on release 1)
- The app doesn't look like the approved design. Release 1 shipped the spec's earlier screens.
- Creating questions is one button with no choices. The count followed slides (about one question per 2.5 slides, at least 6), not what there is to know.
- No way to choose which questions, of which style, at which level, or to give an example.

## What gets built
1. **One look for the whole app**: the approved proposal's kit (`docs/study/proposal/kit.css`, its mockups in `docs/study/proposal/mockups/`) becomes the app's design system: fonts (Frank Ruhl Libre for display, IBM Plex Sans Hebrew for text), cards, chips, buttons, headers, the tab bar. Practice and cards move to it, including the approved practice screens: the confidence bet before checking ("ניחוש · נראה לי · על בטוח"), the autopsy order (the chosen option first, then the key, then the rest), "מתי כן" on every option and "לפסקה". Every new screen is built in it.
2. **Question creation, four screens** (`mockups.html`):
   - **מה ליצור**: count by level, which parts (with the number of points to know in each), styles (מקרה קליני, מנגנון, תרופה לבחירה, תופעות והתוויות נגד, השוואה, ׳מה לא נכון׳, טבלה ריקה; several at once), level (קל · כמו במבחן · קשה).
   - **דוגמה ומיקוד**: paste a question from a past exam or photograph it; the app shows how it read the style ("ככה השאלות ייכתבו: …"); an optional focus line; the cost before creating.
   - **הבנק נבנה**: questions arrive part by part with coverage bars per part; every question is checked by a blind solver (answers without the key); one the solver gets wrong is rewritten automatically; each can be kept, reworded or removed before it enters the bank; "להוסיף הכול" adds the rest at once.
   - **סבב חדש** (as in AMBOSS): from where (לא נענו, טעיתי, סימנתי, הכול), which parts, which style, how many (5, 10, all), and practice (an explanation after each question) or exam mode (timed, explanations at the end).
3. **Count from the material, not from slides**: first the summary's points to know are extracted (drug, mechanism, indication, adverse effect, contraindication, a number worth remembering), once per lecture for the whole group. Then:

| Level | What goes in | Example (46 points) | Cost per lecture, full price |
|---|---|---|---|
| ממוקד | the most important points only: red flags, contraindications, drugs of choice (about one question per 4 points) | 12 | about $0.30 |
| מלא | every point at least once (about one question per 2 points) | 24 | about $0.60 |
| מקיף | every point from several angles (about one per point) | 40 | about $1.00 |
| משלי | a number the member chooses | … | by the number |

Batch mode halves the cost. Red flags are always in.

## Decisions (the recommendations, approved)
1. Default count: **מלא**.
2. **Anyone in the group** creates questions; the bank is shared.
3. Review before questions enter the bank: **yes**, with "להוסיף הכול" for those who don't want to go one by one.

## Order
1. The look for the whole app. 2. The new question creation. 3. The live group quiz (already being built) in the new look.

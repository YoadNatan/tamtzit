# כרטיס צהוב, VAR, יומן התיקונים והפצה (package V)

What package V adds to תמצית (spec §12.4.V; the approved mockup
`proposal/mockups/corrections.html` s1's "לא מסכימים: כרטיס צהוב", s2 "כרטיס
צהוב ו-VAR" and s3 "עדכון אחרי שכבר למדת"), how it is built, and Yoad's
steps to turn it on. Branch `study/w4-v`, on top of `study/wave3`.

## What the group gets

- **"לא מסכימים: כרטיס צהוב".** On a correction that waits for approval
  (corrections.html s1's bottom bar) or on any paragraph's "תיקון" tab: one
  line with 1-4 slides. A correction under a yellow card waits for it: it
  cannot be approved until the card is decided or closed.
- **The yellow card** (`?v=dispute&d=`): "כרטיס צהוב · {part}", each side's
  line with its name and slides; "מחכים לצד השני" until another member
  writes the other side ("לכתוב את הצד השני"). The others back a side, "עם
  מי הצדק? גיבוי בלי שמות" ("לגבות את {שם}", hers marked "הגיבוי שלך"):
  while backing is open only the total shows ("3 גיבו · הגיבוי יוצג אחרי
  ה-VAR, מ-3"); once VAR is asked backing closes and the bars show, only
  from three backers other than the reader (review SEC-10). Never a
  backer's name. The opener can close an open card ("ביטול הכרטיס הצהוב").
- **VAR** (≈ $0.08, with the group's month: "השימוש של הקבוצה החודש: $x
  מתוך $33"): one Claude call that separates what the slides say ("כתוב
  בשקף", each quote checked against its slide) from interpretation
  ("פרשנות"), with a certainty ("ודאות: כתוב בשקף · פרשנות · לא
  חד-משמעי"), "כדאי לשמוע בהקלטה" when the lecturer's words would settle
  it, and sometimes a trap card. The model never sees the members' names.
  One VAR at a time: a second phone reads "נבדק עכשיו במכשיר אחר. התוצאה
  תופיע כאן." and pays nothing (review SEC-15); the verdict reaches every
  phone live.
- **The decision.** "לקבל": the "פסיקת VAR" box is pinned under the
  paragraph in the summary, and the trap card joins everyone's deck
  ("לתור של כולם", through section C's trap card maker). "בהרצאה נאמר
  אחרת", with an optional line: no box, no card. Either way a correction
  that waited is open for approval again.
- **"יומן התיקונים"** (`?v=log&l=`, a chip in the lecture's action row): the
  lecture's corrections (who corrected, who approved, the source; "ביטול"
  only on a paragraph's latest correction, never on an undo), the verdicts
  (both sides, the outcome, the certainty) and "כרטיס צהוב לשקף": slips in
  the deck itself (slide 28 repeats Quinine; slide 29 says "pyridine"),
  removed or put back in one tap. "כל שינוי ביומן: עם מקור, היסטוריה וביטול
  בלחיצה."
- **The spread.** Every approved correction marks the questions and cards
  on its paragraph: they leave practice and the quiz until "עדיין נכון" or
  a fix (sections Q's and C's ends already read the marks). A card's
  "עדיין נכון" is in the deck; a question's is in the paragraph's "תרגול"
  tab (package N, `VITE_STUDY_ANCHOR`; added at wave 4's review, SEC4-1:
  before it, nothing in the app could bring a marked question back). The
  questions' marks obey the server switch `spread_questions` (on): where
  the "תרגול" tab is off, turn it off and corrections leave questions as
  they are. Whoever had
  already answered one of those questions or reviewed one of those cards
  (not the correction's author or approver) gets one private "עדכון
  בסיכום": "היה" and "עכשיו", "תיקון: … · אישור: … · מקור: שקף 33", why it
  reached her ("הגיע אליך כי ביום ראשון חזרת על כרטיס שנשען על השורה
  הישנה.", "רק לך"), "הבנתי" and "לפסקה". An undo takes the marks back,
  and the updates nobody saw.
- **Where "עדכון" shows.** Today (package T) hosts V's `UpdateCard` in its
  queue. Until T ships, "יחד" shows the member's own updates above
  "כרטיסים צהובים" (`DisputesCard`: the group's open cards, live), so a
  correction that reached her is never lost.

## How it is built

| Part | Where |
|---|---|
| SQL: section V, **V version 1** (the addendum's §12.4.V with three hardenings: a verdict missing a key is refused, a verdict's slides must be whole numbers of the lecture, a claim is not rewritten while op var reads it) | `supabase/study-schema.sql`, inside V's markers; checks V1-V10, SR10a-SR10d, SR15a-SR15b in `supabase/tests/study.sql` |
| Server: op `var` (the hold before the reservation, the slides and pictures, one structured call through the ledger, `checkVerdict`, the save with the key) | `server/study/ops/var.ts`, `server/study/var.ts`, `server/study/prompts/var.ts`, `limits.ts`; test `server/study/var.test.ts` |
| The slot (small in the entry chunk: 2.6 kB) | `src/study/features/var.tsx` |
| Data and pure rules (`backingView`, `changeLines`, `reasonLine`, `CERTAINTY`) | `src/study/lib/var.ts` (lazy); test `lib/var.test.ts` |
| Screens | `components/DisputeScreen.tsx`, `VerdictCard.tsx`, `LogScreen.tsx`, `UpdateCard.tsx`, `DisputesCard.tsx`, `VarBox.tsx`; placement in `styles/var.css`; K's `EditPanel.tsx` opens a card on a paragraph with no proposal too |
| e2e | `e2e/study/var.cjs` with `e2e/study/mocks/var.cjs`; the mock's flag set `v` |

What it costs: `POLICY.var` (F1Δ): optional spend (80% of the month), at most
40% of the month for one member, 3 VAR a day per member. A typical call ≈
$0.06-0.08; the reservation's worst ≈ $0.13 (with four pictures).

## Yoad's steps

1. **The SQL.** Run the whole `supabase/study-schema.sql` once in the
   Supabase SQL editor (it is safe to run again). Section V goes to version
   1: `{"C": 2, "F": 1, "K": 2, "N": 1, "Q": 2, "V": 1, "W": 2, "Z": 2}`.
   It adds four tables (`study_disputes` and `study_slide_flags`, published
   for Realtime; `study_dispute_backs` and `study_updates`, private),
   their functions, and one trigger on `study_edits`. From then on every
   approved correction marks its paragraph's questions and cards and sends
   "עדכון" rows, whatever the flags; nothing shows them until
   `VITE_STUDY_VAR`, and the marks only take a question or card out of
   practice until "עדיין נכון", as section Q's and C's ends already do.
   `/api/study/health` keeps `schemaOk: true` with production's flags.
2. **Merge** this branch after `study/wave3` (it is built on it).
3. **The flag, when you choose** (phase 2, with corrections): in Vercel set
   `VITE_STUDY_VAR=1` (it needs `VITE_STUDY_CORRECTIONS=1`), then redeploy.
   Check `/api/study/health`: `schemaOk: true` (it asks for V 1).
4. **The prompt** (§12.7.7): read op var's first live call before telling
   the group; V1-V5 on six disputes is the eval the spec names.
5. To turn it off: set it to `0` and redeploy; nothing in the database has
   to change. The spread is not VAR's: it keeps marking questions and cards
   after approved corrections, whatever this flag says. That is safe only
   while members can bring them back: cards in the deck, questions in the
   paragraph's "תרגול" tab (`VITE_STUDY_ANCHOR`). If that tab is ever off
   while corrections are on, turn the questions' part off too:
   `update study_private.features set enabled = false, changed_at = now() where name = 'spread_questions';`

## The checks on this branch

See the branch's report: `npm run test:study`, `npm run test:contract`,
`npm run build`, `npm run test:bundle`, the SQL twice with its checks, the
upgrade from `study/wave3`'s SQL with data, and every e2e script with the
flags off, with production's (`rel1`), with wave 3's and with V's (`v`):

```bash
VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
  VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 \
  VITE_STUDY_ANCHOR=1 VITE_STUDY_CORRECTIONS=1 VITE_STUDY_ASK=1 VITE_STUDY_VAR=1 \
  npx vite build --outDir /tmp/study-e2e-v
E2E_FLAGS=v E2E_ANCHOR=1 NODE_PATH=$(npm root -g) node e2e/study/var.cjs /tmp/study-e2e-v /tmp/v-out
```

## What waits

- **Today's queue** (package T) hosts `UpdateCard`; until then "יחד" does.
- **The quality eval** of `VAR_SYSTEM` (§12.7.7: V1-V5 on six disputes,
  `tools/evals/var.mjs`) needs the real model: it runs before the flag,
  never here.
- **"כרטיס צהוב לשקף" from the slide itself**: the log is its one entry
  point (the slide sheet belongs to F's `SlideSheet`).

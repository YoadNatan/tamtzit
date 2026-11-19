# תיקונים ו"לשאול" (package K: K-1 and K-2)

What package K adds to תמצית (spec §12.3.K, decision 5; the approved mockups
`proposal/mockups/corrections.html` s1 and `ask.html`, and the paragraph's
sheet of `anchor.html` s2), how it is built, and Yoad's steps to turn it on.
Branch `study/w3-k`.

## What the group gets

- **A paragraph's sheet, "מה יושב על הפסקה"**: the paragraph's slide tags, its
  first words and tabs: "תגובות" (the thread), "תיקון" (with
  `VITE_STUDY_CORRECTIONS`), "אסוציאציה" (J, with `VITE_STUDY_WALL`) and
  "תרגול" (N, with `VITE_STUDY_ANCHOR`). Without any of them it stays today's
  thread sheet.
- **A correction is a proposal with a source.** "תיקון" on a paragraph opens
  "הצעת תיקון": the text (a table cell by cell), a preview with the change
  marked, a warning when a slide tag was deleted, "מה תוקן (לא חובה)" and
  "מקור (חובה)": "שקף ✓" (the slide's words quoted under it), "מההקלטה" (a
  minute) or "חיצוני" (where from). "להציע לקבוצה" stays off until a source
  is chosen.
- **Another member approves it.** Everyone sees "תיקון ממתין לאישור" on the
  paragraph, live. The "תיקון" tab shows the proposal as the mockup draws
  it: the paragraph with the change, "הצעת תיקון · {שם}" with "ממתין לאישור",
  the source, "חסר עוד אישור אחד מהקבוצה", "אחרי האישור, אצל כולם" and
  "לאשר". The one who proposed gets "לבטל את ההצעה" instead, never "לאשר".
  "לבדוק מול השקף · כ-$0.01" (op `fix_check`) compares the correction with
  the cited slide.
- **"אישור בקול"** appears on the reader's bar only with the day's meeting
  (`VITE_STUDY_MEETING`, section M): the database applies it only while the
  reading is live with two others following, and never for one's own
  proposal (review SEC-3). Without section M it is never offered.
- **History and undo.** Each applied correction shows "תיקון: {שם} · אישור:
  {שם} · מקור: …" (or "אישור: בקול בפגישה"); "ביטול" is offered on the
  paragraph's latest correction only, puts its text back at once, and is
  never offered on an undo (review SEC-1). An older version comes back as a
  new proposal ("החזרה לנוסח הזה", its old source filled in).
- **"תיקונים אחרונים" on "יחד"** (waiting proposals first) and **"תיקון חדש"**
  on the library's card, live.
- **"לשאול"** (with `VITE_STUDY_ASK`): a screen (`?v=ask`, from the lecture's
  chip, a paragraph or the library's bar) and a sheet over the reader (the
  reading and following go on under it). The answer comes from the slides,
  the group's summary, the recording's notes when there are some and the
  questions the group already answered (sent without names); what the slides
  do not say reads "לא מופיע בשקפים". Under an answer: "לפסקה", "לשתף עם
  הקבוצה", and **"עדיין לא ברור? לשאול את הקבוצה"**: the question goes onto
  the paragraph with Claude's answer attached, folded in the thread under
  "מצורף: הניסיון של Claude לענות". Who marked a question answered shows
  under it. The conversation stays on the phone (14 days).

## How it is built

| Part | Where |
|---|---|
| SQL: section K's end (proposals, sources, approval, aloud, undo, the share path, `resolved_by`, `fix_check`'s result), **K version 2** | `supabase/study-schema.sql`, inside K's markers; checks KA1-KA12, SR1a-SR1f, SR3a-SR3b, SR9a-SR9b, KS1-KS3c in `supabase/tests/study.sql` |
| Server: op `ask` (the summary block, the answered threads without names, the recording's line, the share path with the answer's signature), op `fix_check` | `server/study/ask.ts`, `server/study/ops/fixcheck.ts`, `prompts/collab.ts`; tests `ask.test.ts`, `collab.test.ts` |
| The slot (hooks only, small in the entry chunk) | `src/study/features/collab.tsx` |
| Data and pure rules (`undoable`, `sourceLine`, `parseMinute`, `answerSpots`, `editGist`) | `src/study/lib/collab.ts`, `lib/correctionsStore.ts` (lazy); test `lib/collab.test.ts` |
| Screens | `components/ParagraphSheet.tsx`, `EditPanel.tsx`, `AskView.tsx`, `RecentEdits.tsx`; the thread's `ThreadPanel` in `Together.tsx`; placement in `styles/collab.css` |
| e2e | `e2e/study/collab.cjs` with `e2e/study/mocks/collab.cjs`; the mock's flag set `k` |

## Where K meets the packages built beside it

- **W2** (`study/w3-w2`): corrections need W2's hardening (spec §3.7, review
  M1), so a build with `VITE_STUDY_CORRECTIONS` asks for section **W at 2**
  (`shared/study/flags.ts`). W2's SQL and merge come first; with W2 merged,
  every build needs W 2 anyway. Section K's end writes a part only through
  its own security-definer functions, which W2 leaves in place.
- **N** (`study/w3-n`) built a minimal `ParagraphSheet.tsx` for its "תרגול"
  tab and its own `ThreadPanel`; this branch has the full sheet with K's
  tab and the thread's extras. As merged in wave 3 (`study/wave3`) there is
  one frame: this branch's `ParagraphSheet.tsx` with N's `usePracticeCount`
  count on the "תרגול" tab, the head's slide tag read from the part's text
  (`blockSources`, not the page), its placement in `styles/collab.css`, and
  one `ThreadPanel` (this branch's, which has K's props).
- **M**: "אישור בקול" needs `study_private.meeting_reads_live` (section M);
  until then the database answers `not live`, and the app offers it only
  with the meeting's flag.
- **C's end** (`study/w3-c`): the card from an answered question ("לסמן
  שנענתה" → a private card, ask.html s2) calls `study_my_card_add`; it is
  built and shows once `ENDS.C` is on.
- **V**: "לא מסכימים: כרטיס צהוב" opens V's yellow card
  (`study_dispute_open`) with `VITE_STUDY_VAR`; V's log uses `undoable()`
  from `lib/collab.ts` for its "ביטול".
- **J**: "אסוציאציה" and "להעביר לקיר האסוציאציות" render J's
  `ParagraphWall` and `ToWall`.

## Yoad's steps

1. **The SQL.** Run the whole `supabase/study-schema.sql` once in the
   Supabase SQL editor (it is safe to run again). Section K goes to version
   2; nothing the live app does changes: the live app never corrects a part
   (`study_edit_block` now accepts only an undo), and "לסמן שנענתה" keeps
   working (it also records who marked it). `/api/study/health` keeps
   `schemaOk: true` with production's flags.
2. **W2 first.** Corrections wait for W2 (its own steps in its release
   notes): run its SQL and merge it before turning corrections on.
3. **Merge** this branch after W2 (and N's, if it is merged first, as said
   above).
4. **The flags, when you choose** (phase 2): in Vercel set
   `VITE_STUDY_CORRECTIONS=1` and `VITE_STUDY_ASK=1`, then redeploy. Check
   `/api/study/health`: `schemaOk: true` (it asks for K 2 and W 2).
5. To turn either off: set it to `0` and redeploy; nothing in the database
   has to change.

## The checks on this branch

- `npm run test:study` (543 tests, 0 failing), `npm run test:contract`,
  `npm run build`, `npm run test:bundle` (the entry chunk 320 kB with every
  flag on, under 400 kB; K's static share 20 kB: the thread and the slot's
  hooks).
- The SQL: the whole file twice on a fresh Postgres 16 with
  `supabase/tests/study.sql`, 0 FAIL, registry `C:1 F:1 K:2 Q:2 W:1 Z:2`;
  and from `origin/main`'s file with data, then this file twice: 0 errors,
  every row kept.
- e2e, each script in `e2e/study/` with the flags off, with release 1's
  (and release 2's where a script has the quiz), with K's set `k`, and
  `collab.cjs` with every flag:

  ```bash
  VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
    VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 \
    VITE_STUDY_CORRECTIONS=1 VITE_STUDY_ASK=1 npx vite build --outDir /tmp/study-e2e-k
  E2E_FLAGS=k NODE_PATH=$(npm root -g) node e2e/study/collab.cjs /tmp/study-e2e-k /tmp/k-out
  # a release's script on the same build: the SQL's own registry has W 2 and K 2
  NODE_PATH=$(npm root -g) node e2e/study/cards.cjs /tmp/study-e2e-k /tmp/k-cards rel2
  ```

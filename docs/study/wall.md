# קיר האסוציאציות (package J)

What package J adds to תמצית (spec §12.5.J, J-1 and J-2; the approved
mockups `proposal/mockups/wall.html` s1 "הקיר של ההרצאה", s2 "תנו לי 3:
טיוטות לשפר", s3 "לנעוץ רגע מהפגישה", and `cards.html` s2's hint), how it is
built, and Yoad's steps to turn it on. Branch `study/w4-j`, on top of
`study/wave3`.

## What the group gets

- **The lecture's wall** (`?v=wall&l=`, the chip "אסוציאציות" in the
  reader's action row): "אסוציאציות · {title}" and the count; "הכי טובות"
  (votes, then "נתקע לי", then the older) · "חדשות" · "שלי" (one's own and
  one's pins). Each entry: the body with its slide tags, "על מה זה: …", the
  author's avatar and name or "בלי שם", the kind's chip (שרבוט · מם · רמיקס ·
  "רמיקס לטיוטה של Claude" · מהפגישה · "טיוטה של Claude"), "קרדיט: …", the
  photo or the slide's picture, and the votes "מצחיק {n}" · "נתקע לי {n}"
  (toggles; none on one's own). The menu: "שלי" / "להוריד מ׳שלי׳", "רמיקס",
  "לא מדויק", "לא מתאים", and for one's own "עריכה" · "מחיקה". Live for
  every open wall. A drug's wall across lectures is `?v=wall&d=`.
- **Anonymity** (decision 10): an entry posted "בלי שם" has no author on the
  shared row; the author is kept only in an owner-only table, to edit and
  delete. Who voted is never shown, only the totals.
- **The winner**: the most votes (2 at least), then more "נתקע לי", then the
  older, among entries checked against the paragraph and not marked. The
  vote that makes an unchecked entry the would-be winner starts one check
  (op `wall_check`, ≈ $0.01) in the background; then "בגב הכרטיס של כולם".
  A failed check marks it "לא מדויק לפי הבדיקה: …" until its author fixes it.
  "מנצחת השבוע" is the week's most voted (from Sunday 04:00).
- **Marks**: "לא מדויק" (with the marker's name) keeps an entry off the cards;
  "לא מתאים" (the house rule, "צולים את התרופה, אף פעם לא אנשים או
  מטופלים.") hides it from everyone but its author, who reads why. The
  marker or the author lifts a mark; the check's mark goes only with a fix.
- **"תנו לי 3 מצחיקות"** (the wall's one action, "על איזו פסקה?", or the
  paragraph's sheet): three drafts for one paragraph, one per technique
  (משחק מילים · חרוז · סצנה הזויה), with its deciding fact. Saved for the
  whole group by the paragraph's text: the next member who opens that
  paragraph sees them at once, with no call and no cost; a corrected
  paragraph may get new ones. Paid requests: 5 a person a day ("נשארו היום
  {n}"); a saved paragraph's drafts are free and do not count. Each draft:
  "רמיקס" (the composer, prefilled) and "לפרסם כמו שהיא" (the exact draft).
  Nothing reaches the wall without a person.
- **The composer** (`?v=wall&x=post`): "משלי" · "רמיקס" · "צילום של שרבוט"
  (the photo shrunk on the phone to 1280 px and 600 kB, uploaded to the
  group's `wall/` folder) · "לפרסם כמו שהיא" · "עריכה"; "על מה זה? (חובה,
  שיהיה מובן גם בלי הפגישה)"; "על איזו תרופה?" chips; "בשם שלי" · "בלי שם";
  the house rule.
- **"לנעוץ רגע"**: in the follower's sticky bar while following and in the
  reader's bar while reading aloud, a sheet over the reader on the paragraph
  being read, with "גם בשקף: … · לצרף" (the slide's picture) and a credit to
  a member ("רק באישור של {name}").
- **Credit only after a yes**: the request reaches the credited member alone,
  on "יחד" ("בקשת קרדיט", "לאשר" · "לא, תודה"); the name shows after "לאשר".
- **On "יחד"**: "אסוציאציית השבוע" with "ביום חמישי מקריאים אותה בפגישה." and
  "לקיר", and the credit requests.
- **The paragraph**: the sheet's "אסוציאציה" tab (K-1's frame) with the
  paragraph's entries, "תנו לי 3 מצחיקות" · "משלי" · "צילום של שרבוט" and
  "לקיר של ההרצאה"; N's chip row shows the leading entry's first words.
  Under a member's answer in the thread (K6): "להעביר לקיר האסוציאציות",
  the composer prefilled, with a credit request to the answer's author.
- **J-2 on the cards**: the review shows the wall's hint after two own lapses
  ("רמז מהקיר", or "רמז שנעצת · שלי"), the back's line "בגב: ׳…׳ · {name}",
  and the Anki export puts "אסוציאציה: … ({name})" in Extra (the note's time
  moves with it, so a re-export updates Anki). The hint and the back line
  show where the review shows (`VITE_STUDY_CARDS_REVIEW`).
- **"דרושה אסוציאציה"** needs package U's pulse (not built): the tab "דרושות"
  hides without the flag `pulse`, and the request card waits on one hook,
  `useNeeded` in `components/Wall.tsx`.

## How it is built

| Part | Where |
|---|---|
| SQL: section J, **J version 1** (the addendum's §12.5.J, with two hardenings: only an entry that could win is checked, J15; a draft's number must be one its row has, J16) | `supabase/study-schema.sql`, inside J's markers (after U); checks J1-J17, SR14a-SR14d and J-N in `supabase/tests/study.sql` |
| Server: op `mnemonic` (the saved path first: $0, no reservation; else the hold `study_aid_drafts_begin` before one reservation, so two phones at once pay once and the second answers 409 "busy" (review SEC4-3); the drafts streamed and checked, saved with the server key) and op `wall_check` (the hold before the reservation; a failed call gives the entry back) | `server/study/ops/wall.ts`, `server/study/wall.ts`, `server/study/prompts/wall.ts` (the addendum's prompts byte for byte), `limits.ts`; test `server/study/wall.test.ts` |
| The slot (6.1 kB of the entry chunk; budget 8) | `src/study/features/wall.tsx` (adds `CardBackLine` beside the seeded exports) |
| Data and pure rules | `src/study/lib/wall.ts`, `src/study/lib/photo.ts` (lazy); test `lib/wall.test.ts` |
| Screens | `components/Wall.tsx` (the wall), `WallDrafts.tsx`, `WallComposer.tsx` (and the moment's sheet), `WallEntry.tsx`, `WallParts.tsx` ("יחד"'s card, the sheet's tab, the hint, the back line); placement in `styles/wall.css`; icons star, smile, image added to `Icon.tsx` from the kit |
| Small edits in other packages' files | C: `CardReview.tsx` renders `CardHint` and `CardBackLine`; `CardSheets.tsx` and `lib/anki.ts` (`withAssociations`) put the association in Anki's Extra. F: `failText.ts` ("mnemonic:empty", "wall:too big"), `helpCopy.ts` (the drafts' daily 5 in the help row). |
| e2e | `e2e/study/wall.cjs` with `e2e/study/mocks/wall.cjs`; the mock's flag set `j`; `E2E_REVIEW=1` with a build that has `VITE_STUDY_CARDS_REVIEW` adds the hint and the back line |

What it costs: `POLICY.mnemonic` (80% of the month, 40% for one member, 5 paid
requests a day; ≈ $0.02 a request, the reservation's worst ≈ $0.09) and
`POLICY.wall_check` (20 a day, ≈ $0.01). Votes, pins, marks, photos and the
saved drafts cost nothing.

## Yoad's steps

1. **The SQL.** Run the whole `supabase/study-schema.sql` once in the
   Supabase SQL editor (it is safe to run again, and on study/wave3's
   database with its data). Section J goes to version 1:
   `{"C": 2, "F": 1, "J": 1, "K": 2, "N": 1, "Q": 2, "W": 2, "Z": 2}`. It adds
   seven tables (`study_aids`, published for Realtime and with no author
   column; `study_aid_drafts`, `study_aid_winners`, the group's; and the
   owner-only `study_aid_authors`, `study_aid_votes`, `study_aid_pins`,
   `study_aid_credits`) and their functions. Nothing shows until the flag.
   `/api/study/health` keeps `schemaOk: true` with production's flags.
2. **Merge** this branch after `study/wave3` (it is built on it).
3. **The flag, when you choose** (phase 2): in Vercel set
   `VITE_STUDY_WALL=1`, then redeploy. Check `/api/study/health`:
   `schemaOk: true` (it asks for J 1).
4. **The prompts** (§12.7.7): read the first "תנו לי 3" and the first check
   before telling the group; J-7's eval (`tools/evals/wall.mjs`) needs the
   real model and runs before the flag, never in these checks.
5. To turn it off: set it to `0` and redeploy; nothing in the database has
   to change.

## What waits

- **"דרושה אסוציאציה"** and the tab "דרושות": package U (the pulse).
- **The quality eval** of `WALL_DRAFTS_SYSTEM` and `WALL_CHECK_SYSTEM`
  (J-7): with the real model, before the flag.
- **The meeting's moment for catch-up** (M) reads the wall's entries when M
  is merged; nothing of J needs changing for it.

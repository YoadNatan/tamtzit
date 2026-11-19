# Flashcards (package C)

What the flashcards are, who sees what, and how to test them. The design is
`spec/sources/design-cards.md`; the build spec's parts are §4.7 (the op), §3.3
section C (the SQL), §5.3-§5.5 (the client), §6.4 C (the copy) and §7.C (the
acceptance tests).

## What it does

- **One shared deck per lecture**, written once for the group from the slides
  (`op: "cards"` of `/api/study/ai`, `server/study/cards.ts`), on a tap of
  "יצירת כרטיסיות". A round is one part per summary part, about one card per
  250 characters of slide text and at most 8 a part; "עוד כרטיסיות" writes a
  smaller second round; a lecture stops at 150 active cards. The sheet's
  estimate (`estimateRound` in `src/study/lib/cardsGenerate.ts`) is the same
  arithmetic as `study_card_round`, so nothing is planned until "ליצור". A
  round that stopped before all its parts started (a 402, a closed tab)
  offers one "לנסות שוב" under the bar once nothing writes it anywhere, and
  goes on with every part still to write (review finding STUCK-ROUND).
- **The group fixes the deck**: any member edits (with the version they
  opened: a second save meets "הכרטיסייה נערכה בינתיים במכשיר אחר…" and keeps
  the draft), deletes (softly, with "ביטול"), restores, reverts or adds a card;
  every change has a history row with its author.
- **Export to Anki** (`src/study/lib/anki.ts`): a `.apkg` built on the phone
  with `sql.js` (loaded only on "ייצוא", never before), or Anki's text file.
  A card keeps its GUID through every edit, the note's `mod` is the card's
  `updated_at`, so a re-export updates fixed cards in place and keeps the
  student's progress in Anki; a card deleted in the group goes once more,
  tagged `tamtzit::נמחק`, to a device whose last export carried it. A share
  sheet closed without sharing is no export: the sheet stays open, nothing
  says the file is ready, and the last export is not moved (review finding
  ANKI-CANCEL).
- **"עיון בכרטיסיות"**: the deck one card at a time (front, tap, back,
  next). It writes nothing, so it ships with the deck.
- **Review in the app** (`VITE_STUDY_CARDS_REVIEW`): FSRS-6 with its default
  weights (`shared/study/fsrs.ts`, equal to ts-fsrs 5.4.2), learning steps of 1
  and 10 minutes, a 10-minute relearning step, 20 new cards a day and 90%
  retention by default (each member's own, in "הגדרות"). The phone schedules;
  the database checks what it stores.

## C's end (addendum §12.3.C; section C at version 2)

Built on `study/w3-c` (Yoad's steps: [`RELEASE-C2.md`](RELEASE-C2.md)), in
the approved screens of `proposal/mockups/cards.html`:

- **The deck page** (s3, `LectureCards.tsx`): the ring of the member's own
  deck, a row per part (`study_my_deck`: the summary's parts, or for a
  lecture written before its outline the parts its rounds were written in)
  with "להוסיף" or "{x} בחפיסה ✓" (`study_card_adopt`), "להוסיף את כל
  החלקים", "להוציא מהחפיסה שלי" (with "ביטול"), the group's latest fix
  ("תוקן לכולם", "לבטל" reverts it), the deck's name in Anki, the export in
  the bottom bar. A part's name opens its cards, which keep every action of
  the deck (edit, history, hide, delete).
- **Decision 8** (`cardsQueue.ts`'s `inMyDeck`, `deckCards`; SQL's
  `study_private.card_in_my_deck`): a card never studied is new only in a
  part the member added, as a trap card, or as a card she wrote herself (not
  one Claude wrote on her tap); trap and private cards come first among the
  new, inside the day's limit (review F-11).
- **The export** (`AnkiExportSheet`, `anki.ts`): from a lecture's deck,
  "החפיסה שלך" (her deck) first and "כל החפיסה" second; with review on, her
  private cards of the lecture travel as `…::הטעויות שלי`.
- **"מאיפה זה?"** (`CardSource.tsx`): the card's paragraph (its `anchor` and
  `quote`, found again with `reanchor` after a rewrite), the next one muted,
  "לפסקה" to the reader at it. The op "cards" sends the part paragraph by
  paragraph and the model gives `para` (placed by similarity when its number
  is not one of the part's, as the questions' `placePara`).
- **C7**: `CARDS_SYSTEM` asks for the drug in the visible front; `checkCard`
  rejects ("cue") a card whose English topic is not in its front outside
  the cloze.
- **Trap cards** (`source 'trap'`, one per `trap_key`): made by
  `study_private.trap_card` from a quiz round three players lost on the
  same option (section Z's hook), closed until the next study day
  (`opens_at`: the read policy, the deck page and the counts leave a closed
  one out). The chip "מלכודת של הקבוצה".
- **Marks**: a card a correction approved on its paragraph marks
  (`stale_at`, section V) shows "בבדיקה אחרי תיקון בפסקה" and stays out of
  review until "עדיין נכון" (`study_card_still_true`) or an edit.
- **Private cards** (`study_my_cards`, owner-only, never published, their
  memory on the row): the database writes one on a member's first wrong
  answer to a question in practice or a quiz (the autopsy in Extra:
  "ענית X: …"); `study_my_card_add` takes K4's answer and P10's table cell
  (their screens are K's and E's). With review on they join the sessions
  ("מטעות שלך · מהתרגול"/"מהמבחן הקבוצתי", "הבא בתור · מטעות שלך") and
  go through the outbox with `study_my_card_review`.
- **The review home** (C6, `study_card_settings.home`): asked once
  (`ReviewHomeSheet`), changed in the cards' settings or under "שלי"
  (`ReviewHomeSetting`); with Anki nothing waits for review in the app.
- **The worker path**: `study_card_round`, `_claim`, `study_save_card` and
  `_finish` take the server key alone (section B's batch writer); a part the
  Batch API holds (`hold_until`) is busy for a tap.

Not built here: J's hint after two lapses (the chip "נשכח פעמיים" is; the
wall's association waits for J-2), the paragraph sheet's "+ כרטיס" (N's
sheet; `study_add_card` takes `part`, `para` and `quote`), K4's and P10's
buttons (K's and E's screens), and U's `CardBadge` (C draws the one chip
itself until U).

## The flags (spec §5.7)

| Flag | Shows |
|---|---|
| `VITE_STUDY_CARDS` (release 1, `RELEASE-1.md`; release 5 in the spec) | the deck (K2) with its writing, list, fixes, history and deleted cards; the cards of the day (K1) as decks and export only; "עיון בכרטיסיות"; export; the lecture's "כרטיסיות" chip; the library chip as "54 כרטיסיות" |
| + `VITE_STUDY_CARDS_REVIEW` (release 8) | review sessions (`?v=cards&s=today`, `l.<lecture>`, `c.<course>`), the day's numbers, settings, "להסתיר ממני", "להתחיל מחדש", the library chip as "12 לחזרה" |

With review off no state, review or settings row is ever written, and a link
to a session lands on the deck with "החזרה על כרטיסיות באפליקציה תיפתח
בקרוב…".

## Who sees what

The deck, its rounds and its history are the group's. A member's memory of
each card, their review log and their settings are theirs alone: readable
only by them (RLS), never published to Realtime (the client never subscribes
to those tables), written only by the functions. Nothing of a review goes to
Claude. The Anki file is built on the phone and goes through no server.

## On the device (spec §5.9)

| Key | Holds |
|---|---|
| `study-cards-outbox:<user>` (localStorage) | answers not yet in the database, sent in order: after each answer, when the phone is online again, when the page is visible, every 30 s |
| `study-session:<user>:cards.<scope>` (sessionStorage) | a review session in progress, so Back from the reader returns to the same card (under F's `study-session:` prefix, so another user's is forgotten on a shared device) |
| `study-cards-extra:<user>` (localStorage) | today's "עוד 10 חדשות להיום" |
| `study-anki-exported:<lecture>` (localStorage) | the last export of a lecture (deleted cards go only where an export carried them) |
| `study-cards-swipe-hint` (localStorage) | the one-time hints on the first answer |

Every access is in `try`/`catch`: without storage, answers wait in memory and
a failed one says "התשובה לא נשמרה. כדאי לבדוק את החיבור."

## Tests

```bash
npm run test:study -- fsrs cardsQueue anki cardsGenerate cards   # the unit tests (part of npm run test:study)
npm run test:contract                                            # every RPC argument and column against the SQL
```

- `shared/study/fsrs.test.ts` (C-3): the recorded ts-fsrs 5.4.2 table
  (`e2e/study/fixtures/fsrs-oracle.json`, 2,520 answers) equal to the last
  decimal; ts-fsrs's fuzz ranges (recorded); the design's worked example in
  Israel time; labels; preview against answering.
- `src/study/lib/cardsQueue.test.ts`, `anki.test.ts`, `server/study/cards.test.ts`
  (C-2): the design's checks, plus the structural checks of a built `.apkg`
  read back with sql.js and JSZip (C-4 where Anki is not installed).
- `src/study/lib/cardsGenerate.test.ts`: the estimate against
  `study_card_round`'s numbers on the fixture lecture.
- The SQL (C-1): the spec's §3.6 commands; section C's checks are C1-C30b and
  CR1-CR2b; C's end's are CA1-CA4b, CS1-CS10, CW1-CW4, CR1-CR1b (SR6e-SR6g
  on this file's fixture), FR4, and ZS6e-ZS6g in section Z (the quiz's trap
  card, SR6e-SR6g).
- The e2e (C-5), on the shared mock with `e2e/study/mocks/cards.cjs`:

  ```bash
  VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
    VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_QUIZ=1 VITE_STUDY_CARDS=1 \
    npx vite build --outDir /tmp/study-e2e-cards-r5
  NODE_PATH=$(npm root -g) node e2e/study/cards.cjs /tmp/study-e2e-cards-r5 /tmp/cards-r5 r5
  # release 1 (QUESTIONS, PRACTICE, CARDS, against this branch's SQL registry): … rel1
  # the same build with VITE_STUDY_CARDS_REVIEW=1: … cards.cjs <dist> <out> review
  # every flag on: … all; every flag off: … off
  ```

  Under `r5` and `rel1` the script ends with a share sheet closed without
  sharing (ANKI-CANCEL) and a six-part round a 402 stopped, written to the
  end by the one "לנסות שוב" after a reload (STUCK-ROUND).

  `E2E_ANKI_PYTHON=<python with anki 26.9.4>` adds Anki's own import of the
  exported package (C-4: 5 notes, the picture, Check Database).
- The quality eval (C-6) needs writer agents and a judge (spec §8.4):
  `node tools/evals/cards.mjs --print <dir>` writes the exact requests,
  `--check <dir>` runs the op's checks on the cards they return. It reads the
  group's lecture from `STUDY_EVAL_FIXTURES`, never from git.

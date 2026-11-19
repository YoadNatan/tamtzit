# The approved proposal against the build spec: an element map

*For the designers of the addendum. Read-only mapping: nothing in the repo, the live site or the real Supabase project was touched, and no Claude call was made.*

**What was compared**

| Side | Files |
|---|---|
| The approved proposal | `docs/study/proposal/tamtzit-proposal.html` (the page Yoad approved: 14 features, 34 screens, 12 decisions, privacy rules, phases, costs), `concept.json` (the page's data), `concept.md` (long form), and the 34 approved screens in `mockups/<feature>.html` |
| The build spec | `docs/study/spec/spec-final.md` (§0-§11), its design sources `spec/sources/design-*.md`, and its SQL as printed in §3.3 |
| The repo today | `supabase/study-schema.sql`, `src/study/components/*` (what already exists: comments and questions on paragraphs, follow-the-reader, who-read-what) |

**Where the screens and the text disagree inside the proposal, the approved page and its mockups win** (for example the "לא ברור" threshold: 3 taps on the page and in the mockup, 2 in `concept.json` and `concept.md`). `work/<feature>.txt` beside this file holds a text outline of every approved screen, extracted from the mockup HTML, for checking any row below.

**Legend**

- **Status:** `covered` (the spec builds it as approved) · `partial` (some of it, or a near version) · `missing` (nothing in the spec) · `conflict` (the spec builds something that contradicts the approved behaviour).
- **Group:** `meeting` (the meeting's rituals and the closing quiz, VAR and corrections, the paragraph anchor, the "היום" home) · `fun` (wall, museum, boss, the anonymous pulse and its counts) · `server` (batch generation, release gating, budget and the other decision deltas) · `other`.
- **Proposal refs:** `<feature>.html s1` = the first screen of that mockup; `tag` = tagline; `g2p` / `p2g` = the two "connects" lines (group → personal / personal → group); `later` = "מה נכנס מתי"; `why`; `cost` = the AI-cost line; `priv` = the page's privacy section; `nav` = "באפליקציה: איך זה מסודר בטלפון"; `loop N` / `day` = the page's loop and day; `dec N` = decision N; `cut` = "מה לא נכנס, ולמה" (what survives each cut idea is approved too); `cm §` = `concept.md`.
- **Spec refs:** `§` = `spec-final.md`; `D1`-`D25` = the spec's own decisions (§9.2), not the proposal's; design docs by name and section.

---

## 1. The count, and what matters before F1 merges

| | covered | partial | missing | conflict | total |
|---|---|---|---|---|---|
| Features (14) | 10 | 26 | 55 | 4 | 95 |
| Decisions (12) | 2 | 4 | 2 | 4 | 12 |
| Cross-cutting (X1-X5) | 0 | 2 | 2 | 1 | 5 |
| **Total** | **12** | **32** | **59** | **9** | **112** |

| Group | rows | covered | partial | missing | conflict |
|---|---|---|---|---|---|
| meeting | 35 | 3 | 12 | 17 | 3 |
| fun | 26 | 0 | 3 | 22 | 1 |
| server | 9 | 2 | 3 | 2 | 2 |
| other | 42 | 7 | 14 | 18 | 3 |

**The ten deltas that change the build plan, most urgent first** (F0 is being built and F1 is next; each of these touches F's files or a section's tables, so the cheapest moment to absorb them is now):

1. **Tabs and the home screen (decision 6, conflict).** F1 builds ספרייה · תרגול · יחד · שלי with `/study/` opening the library (§2.7, §5.1, test F-2). Approved: היום · ספרייה · יחד · שלי, `/study/` opens Today, the library moves to `?v=library`, practice opens from Today and every lecture.
2. **F1's contract has no place for the approved features (X1).** `Route` (§5.2) has no `today`, `catchup`, `pulse`, `wall`, `museum`, `boss`; the seven slot modules (§5.3) have no owner for Today, the meeting's reader hooks or the fun layer; `SheetTab` has no "תרגול"; `flags.ts` (§5.7), the SQL markers (§3.1), the schema registry (§2.11) and `failText` (§6.3, test F-13) have no entries for them. F owns all of these files, so later packages would need PRs into them.
3. **No confidence bet anywhere (P2, Q3).** `study_answers` and `study_quiz_answers` (sections Q, Z) have no confidence column. The approved concept stores the bet from day one; the danger list, calibration, the museum, Today's "על בטוח" row and decision 2's scoring all read it.
4. **Questions and cards do not sit on a paragraph (A1).** `study_questions` and `study_cards` carry `part_idx` and slide numbers only, and every "לפסקה" link goes by slide (§5.2 `slide`, P7, K4). The anchor chips, the sheet's "תרגול" tab, the pre-guess glow, correction propagation, the "different wording" retry and the wall winner on the card all need the paragraph.
5. **Race scoring (decision 2, conflict).** Section Z scores "500 for a right answer plus up to 500 more for speed" and constrains `points between 0 and 1000`, so the approved bet scoring (wrong 0/−2/−6) cannot even be stored.
6. **When questions and cards are written (decision 3, conflict).** The spec leaves out automatic generation (§1.2, D4) and Message Batches ("later"). Approved: automatic after each summary through the Batch API, with a full-price fallback before the meeting, and an upload-time prompt until server writing is on.
7. **Corrections (decision 5, conflict; VAR missing).** The spec applies a correction to everyone at once with an optional note (D6, §6.4 K A3-A5) and ships it as release 3. Approved: a mandatory source, a second approval or approval aloud, a yellow card with anonymous backing, VAR, and an "עדכון" card for whoever studied the old line.
8. **No anonymous aggregate layer (PU2).** Nothing counts private signals across members. The pulse, the agenda's hot spot, quiz picks, "דרושה אסוציאציה", the museum, the boss and the plan's catch-up blocks all read it.
9. **The day's meeting is not data (T1).** Only live presence exists (reading aloud, the open quiz). "3 לקפה" (yesterday's parts), the pre-guess (today's first part), catch-up (a missed meeting), Today's band and decision 3's deadline all need "today's meeting: time, lecture, parts, reader".
10. **The budget table (X2).** `POLICY` (§2.4, F0's `server/study/budget.ts`) has no rows for VAR, the wall's saved drafts and winner check, the blind solver, member traps, museum plaques, boss questions or half-price batches. The ledger's `kind` is a free pattern, so only `budget.ts` and the ops change.

---

## 2. The approved phases against the spec's releases

| Approved (proposal "שלבים") | Spec release (§2.10) | Gap |
|---|---|---|
| **Phase 1, 16-22 Nov.** First: the budget meter with the cap | 1a ledger (F0) | covered |
| anchor | none (F1's `at` route and K's sheet only) | A1-A5 |
| practice (with the bet), "my mistakes" kept privately by phone | 4 (`QUESTIONS`, `PRACTICE`); the list waits for 8 | P2 bet missing; matches decision 12 otherwise |
| live quiz with argue and revote | 4 (`QUIZ`) | Q3, Q5, decision 2 |
| cards: deck, edit, Anki | 5 (`CARDS`) | decision 8 adoption |
| meeting: "לא ברור", "3 לקפה" on yesterday, agenda | none | M1-M7 |
| **Phase 2, 23 Nov-6 Dec.** corrections and VAR | 3, before practice, after W2; immediate edits | decision 5, R1-R5 |
| account with an email code (decision 12) | 7 (`ACCOUNT`), then 8 after the members report | aligned; X5, D12 notes |
| Today with in-app review | review in 8 (`CARDS_REVIEW`); Today none | T1-T5, decision 6 |
| wall | 6 (`MNEMONICS`: the generator only) | W1-W8 |
| ask | 6 (`ASK`) | K2-K5 |
| progress and pulse | progress in 8; pulse none | PR2-PR5, PU1-PU3 |
| recordings (transcript import, notes on a tap) | 11 (`RECORDINGS` + switch) | covered |
| automatic generation (decision 3) | none | decision 3 |
| **Phase 3, 7-13 Dec.** plan with two lanes | private plan 8, marathons 9 | PL1-PL6 |
| boss, museum | none | B1-B3, MU1-MU4 |
| extras: blank table, member traps, "מי אני?", browser transcription, "הקבוצה צריכה אותך" | browser transcription in 11 (W4); the rest none | P10, P11, Q11, decision 11 |
| **Blocked:** past exams | 12 (`EXAMS` + switch, D20) | P12 badge |

---

## 3. Feature by feature

### 3.1 `today` · היום: הבית האישי שמתחיל מהקבוצה (phase 2; screens: s1 "בבוקר, לפני הפגישה", s2 "פגישה שפספסת: השלמה של 12 דקות")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| T1 | The group band on top of Today: "הקבוצה היום · 09:00", the lecture and slide range ("מלריה: מחזור החיים, מנגנונים ושילובים [ש׳ 19-33]"), the reader ("הקראה: שוהם"), "ניחוש לפני · 2 שאלות" (phase 2); during the meeting the live line ("הקראה עכשיו: שוהם [לעקוב]", "מבחן קבוצתי פתוח [להצטרף]"). Needs today's meeting as data: time, lecture, part range, reader. (today.html s1; cm §3.1; day 07:50) | §5.1 `LiveBanner` (reading aloud, open quiz, marathon: live only); §2.8 `study-group-<group>` presence; marathons store `starts_at`, lectures, agenda (section P; design-me §1.6) | partial | meeting | Nothing stores a scheduled daily meeting. The same record feeds "3 לקפה" (yesterday's parts), the pre-guess (today's first part), catch-up (who missed it) and decision 3's "before the meeting" deadline. Marathons are the nearest model but are one-off evenings with RSVP. |
| T2 | "התור שלי · רק לך": one mixed queue cut to 10 · 20 · 45 minutes; each row says why it is there ("הגיע הזמן", "טעית אתמול", "על בטוח", "מהפגישה"): due cards, yesterday's quiz misses, one confident error in a new wording, the "לא ברור" paragraph now answered in its thread, "עדכון" cards, museum vaccines; one "להתחיל · 20 דק׳" session across kinds; the rest rolls over silently; closing line "סיימת להיום…". (today.html s1; tag; g2p; cm §3.1, §2.3) | none: separate surfaces exist (cards today K1/K4, release 8; "הטעויות שלי" P8, release 8; the private plan's tasks N2) | missing | meeting | Mixes Q's `pickQueue` and C's `cardsQueue`, which §5.3 keeps in separate packages (a Today owner needs declared imports or new RPCs). Inputs that do not exist yet: the bet (P2), taps (M4), propagation (R2), vaccines (MU3), private mistake cards (C5). A private screen: release 8 per decision 12. |
| T3 | Catch-up for a missed meeting ("השלמה · Leishmaniasis: טיפול · 12 דק׳ · רק לך"), detected from following data or a tap; built only from that day's meeting: "התעכבנו על" (with "עצרנו להסביר"), "שאלה שנפתרה", "אסוציאציה שננעצה", "בדיקה קצרה: 5 שאלות שהקבוצה התקשתה בהן. לבד, בלי שעון."; finishing joins "קראו: …" with no time and no "באיחור". Route `?v=catchup&l=`. (today.html s2; g2p; cut "טקס סגירה"; nav) | none (who-read-what exists: `study_reads`, §2.9; the library shows names only) | missing | meeting | Following is presence-only today, so attendance is not recorded; the meeting's stops (M5), resolved questions and pins (W8) must be stored as they happen; the five questions come from anonymous counts (PU2). |
| T4 | Today's "בקבוצה" row: an open question ("שאלה פתוחה · איתי, אתמול" with "לענות"). (today.html s1) | §5.1 "יחד" item 3 (`groupQuestions`); existing comment kind `question` with `resolved` | partial | meeting | Exists on "יחד", not on Today. |
| T5 | A private weekly flame, "להבה 4/7": four of seven days keep it lit, it never resets on one missed day and nobody else sees it; the only streak-like element the concept keeps. (today.html s1; cut "עונות, מטבעות…"; cm §3.1) | §6.4 A M1 "השבוע: 86 שאלות · 12 חלקים · רצף של 5 ימים", M2 "רצף: 5 ימים" (design-me §1.4) | conflict | meeting | The spec shows a consecutive-days streak on the progress page, which resets on a missed day. The activity data needed for 4-of-7 exists (`study_my_days`, section P). |

### 3.2 `practice` · תרגול: שאלות עם נתיחה לכל מסיח (phase 1; s1 "שאלה, לפני תשובה", s2 "הנתיחה", s3 "טבלה ריקה מהזיכרון", phase 3)

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| P1 | The bank: about 15 single-best-answer questions per lecture (about 40% short cases), 5 options, only from the slides, distractors from the same lecture, written once for all six; the key stays on the server until one answers. (tag; g2p; cm §3.2; loop 1) | §1.1 row 1, §4.6, §3.2 Q (`study_question_keys`, no grants), §2.9, D5; design-questions §1.3 P2-P3, §3.3 | covered | other | *When* it is written differs (decision 3). "איזה משפט שגוי" (the cut "מצאו את הטפיל" survivor) fits as a negative lead-in, which §4.6 already handles. |
| P2 | A confidence bet before checking ("הימור ביטחון, לפני הבדיקה": ניחוש · נראה לי · על בטוח), one tap, private, stored from day one; "טעות ׳על בטוח׳ נכנסת לרשימת הסכנה. התשובה וההימור נשמרים רק אצלך." (practice.html s1; tag; why; cm §3.2) | none: `study_answers` (section Q) has no confidence column | missing | other | A shared prerequisite: the quiz bet and decision 2 (Q3), the danger list and calibration (PR3, PR5), the museum (MU1), Today's "על בטוח" row (T2). A column plus an argument of `study_answer_question` in section Q, and the same in section Z. |
| P3 | The autopsy: one's own option first ("טעות · ׳נראה לי׳ · חוזרת מחר בניסוח אחר · רק לך"), then every option with why it is wrong here, "מתי כן" and its slide tags; actions "לפסקה: מקרה 2" · flag · "לשאלה הבאה". (practice.html s2; tag) | §6.4 Q P5 (every option keeps its place with its explanation); §4.6 EXPLANATIONS ("For a wrong option, say what it is…"); design-questions §1.3 P5 | partial | other | No own-option-first order, no explicit "מתי כן" line, no bet result; "לפסקה" goes by slide (A3). |
| P4 | A miss comes back tomorrow in a different wording (another question or card from the same paragraph, $0), until it is answered right. (practice.html s2; cost; cm §3.2) | §6.4 Q P8 and §5.5 `practiceSession` (a right answer clears a mistake only on a later study day); release 8 | partial | other | The same question returns, not a re-wording (that needs paragraph anchors, A1); the list opens only in release 8. |
| P5 | Flags (שגויה · לא ברורה · לא מהחומר); two flags take a question out of everyone's practice until it is fixed with a slide citation. (g2p; cm §3.2) | §6.4 Q P6; §5.5 `FlagSheet` (review UX-16); D6 | partial | other | One member may retire a question for everyone (a box, unchecked by default) and anyone may put it back; no automatic hide at two flags and no "fixed with a citation" step. |
| P6 | Modes: by lecture, by course (mixed), my mistakes, exam simulation with feedback at the end. (cm §3.2) | §5.2 (`s` = `l.` · `c.` · `m` · `m.<lecture>` · `t.`), §5.5 "מצב מבחן", §6.4 Q P1/P2/P8 | covered | other | "My mistakes" waits for release 8. |
| P7 | A blind-solver check: a second call answers each question without the key, to catch a wrong key (≈ $0.10 a lecture). (cost; cm §3.2) | the prompt's self-check ("BEFORE YOU FINISH", §4.6) and `checkQuestion` only | missing | server | One more call per batch: a `POLICY` row (X2) and a step in Q's op or the batch job (decision 3). |
| P8 | Group → personal: the questions most of the group missed rise to the top of one's queue; the option that caught the most members becomes a trap card for everyone. (g2p) | none | missing | fun | Per-question and per-option counts from PU2 (≥ 3 members). The trap card is a group card for all, like MU3. |
| P9 | Personal → group: anonymous counts (≥ 3 answered) send a question that split the group to the opening and the group quiz, and mark paragraphs with many mistakes for the next reading. (p2g) | none | missing | fun | Producer PU2; consumers M1, M2, Q10. |
| P10 | Phase 3, "טבלה ריקה": the slide's table (slides 4, 13, 23) emptied and filled with chips row by row (כן · — · חלשה · מוגבלת · שלבים מוקדמים), "לבדוק את השורה", $0 because the key is the slide's table; a wrong cell becomes a card ("טעות בשורה 4 נכנסה לכרטיסיות"). (practice.html s3; later; cut "מסיכות…") | none | missing | other | The deck's tables exist in the slides' JSON; the card for a wrong cell needs private cards (C5). |
| P11 | Phase 3, "להוסיף מלכודת משלי": a member's trap on any paragraph, checked by Claude against the slides and not rewritten, joins everyone's bank with the author's name, unmasked after it is answered in a live quiz ("נכתבה ע״י רוני · נבדקה מול השקפים"). (p2g; later; live-quiz.html s3) | none (`study_questions.source` is `ai` or `exam`) | missing | other | A `member` source, a check op and a `POLICY` row; the quiz round "המלכודות שלנו" (Q11). |
| P12 | Past exams once the Drive folder returns: exam practice, a "נשאל ב-<שנה>" badge on paragraphs, questions in the course's style. (later; phases "מחכה") | §1.1 row 8, §2.10 release 12, D20, §6.4 Q E1-E4 and P4's chip "ממבחן 2024 מועד א, שאלה 12"; design-questions §3.8-§3.9 | partial | other | Exam practice and style are specified; the paragraph badge is not (it needs A1). |
| P13 | Bank questions may show the slide's diagram (what survives the cut "מסיכות על תמונות, סימון אזורים בתרשים…"). (cut) | none: `study_questions` has no figure; tags open `SlideSheet` with the slide's picture only after answering (§2.7) | missing | other | Cards already carry `figure` (section C). |

### 3.3 `cards` · כרטיסיות: חפיסה משותפת, זיכרון פרטי (phase 1, review in 2; s1 "חזרה של הבוקר", s2 "כרטיס ששכחת פעמיים", s3 "החפיסה של ההרצאה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| C1 | One deck per lecture written once for the group (54 here: question-and-answer and one-fact cloze), a slide tag on every card; any member fixes a card for everyone with history and undo ("תוקן לכולם · מאיה · אתמול · לבטל"). (cards.html s3; tag; cm §3.3) | §1.1 row 4, §4.7, §6.4 C K2/K6/K7, D6, D11; design-cards decisions 1-3, §1.3 | covered | other | |
| C2 | Review in the app at one's own pace (FSRS; שוב · קשה · טוב · קל with the interval under each; "רק לך"; "נשארו עוד 11, כ-6 דקות. מחר: 9 כרטיסים."), after the account is saved. (cards.html s1; later; cm §3.3) | §2.10 release 8, §5.7 `cardsReview`, §6.4 C K1/K4/K5; design-cards §4.3 | covered | other | "מאיפה זה?" with the paragraph's text is A3. |
| C3 | Export to Anki (.apkg, deck "תמצית::פתוגן-מאכסן::Anti parasite"); a re-export updates fixed cards and keeps Anki progress. (cards.html s3; p2g) | §6.4 C K8; design-cards decision 4, §4.4; research-anki | covered | other | "Extra = the winning association" is W5. |
| C4 | After two lapses the hint is the group's chosen association ("שכחת את הכרטיס הזה פעמיים, אז מגיע רמז" · "רמז מהקיר · דניאל"). (cards.html s2; g2p; cm §3.3) | none | missing | fun | Needs the wall's winner (W4, W5) and the card's paragraph (A1). |
| C5 | Private cards from one's own mistakes in the group quiz and in practice, with the autopsy on the back ("הבא בתור · מטעות שלך · מהמבחן הקבוצתי"). (cards.html s2; g2p; cm §3.3) | none: `study_cards.source` is `ai` or `member`, and every card is the group's | missing | other | A private item type (owner-only, never published, in `merge_users`), or question-shaped review items in Today's queue. Also needed by K4 (the asker's card) and P10. |
| C6 | One review home per person, Anki or the app, so a schedule never splits (a setting in "שלי"). (cm §3.3; nav "שלי") | none | missing | other | Decides whether due cards appear in Today. |
| C7 | The card checks name the drug in the cue (the judges' Chloroquine example). (cm §3.3 build notes) | §4.7 `checkCard` has no such rule | missing | other | A build note: one rule in C's prompt and check. |

(Adding the deck "part by part, at most 20 new a day", cards.html s3, is decision 8 below.)

### 3.4 `live-quiz` · מבחן קבוצתי חי: עונים לבד, משכנעים, עונים שוב (phase 1; s1 "הלובי", s2 "שאלה: עונים לבד", s3 "החשיפה: לפני הוויכוח ואחריו")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| Q1 | A quiz on what was read (a part range: "Anti parasite · מלריה [ש׳ 19-33] · 5 שאלות"), opened from a lecture or from the agenda; the others join from the banner or a WhatsApp link ("קישור לוואטסאפ"); the lobby lists who is in ("מחכים לרוני") and the rules. (live-quiz.html s1; cm §3.4) | §1.1 row 2; §6.4 Z S/L/B; section Z `study_quiz_create(group, mode, lectures, count 3-30, seconds, kinds)`; design-quiz §1.3 S, L | partial | meeting | Scope is whole lectures or a course; no part range (the "סוף הקריאה" preset) and no entry from the agenda. |
| Q2 | Two modes: "כולנו נגד המבחן" (the default: no personal points, the group chases its record "השיא: 90%", 80% = "עברנו", each bet result private) and "מירוץ" (points and a table for its players, only inside the game). (live-quiz.html s1; tag; priv; dec 2) | §6.4 Z S/L/R1/R2/E1/E2; §6.1 #11 renames the feature "מבחן חי" with modes "קבוצתי" · "תחרותי" (review UX-10); design-quiz §1.3 | partial | meeting | No record and no 80% line; the names conflict with the approved ones ("מבחן קבוצתי", "כולנו נגד המבחן", "מירוץ"). |
| Q3 | A bet on every answer, its scale on screen ("צודקים: +1 · +2 · +3. טועים: 0 · −2 · −6."), the result private ("׳על בטוח׳: −6. השאלה חוזרת אליך מחר."). (live-quiz.html s2, s3; tag; loop 5) | none: `study_quiz_answers` has no confidence and `points` is checked 0-1000 | missing | meeting | The same column as P2; race scoring is decision 2. |
| Q4 | Answer alone; answers lock until the reveal ("ענו 4 מתוך 6 · התשובה נעולה עד החשיפה"); counts per option only after the question closes, only with ≥ 3 answers, never names. (live-quiz.html s2; priv; cm §3.4) | §2.9; §6.4 Z Q/R1; §5.5 Z ("2 ענו" below three); §6.2 quiz line; design-quiz §1.4 | covered | meeting | |
| Q5 | Mazur's rule after the first vote: ≥ 70% right → explain and move on; 30-70% → "חצויה: 90 שניות לשכנע", then a second vote; < 30% → every screen jumps to the source paragraph. The reveal shows "סבב 1 · עונים לבד" and "סבב 2 · אחרי הוויכוח" with "83%, היה 33%". (live-quiz.html s3; tag; loop 5; cm §3.4) | §6.4 Z R1 has only "זה הזמן לדבר על השאלה…"; section Z keeps one answer per round (primary key `round_id, user_id`) | missing | meeting | Needs a round number per question, an argue state with its 90-second clock in `study_quizzes`, and the jump by paragraph (A1). |
| Q6 | After the reveal, an explanation for every option, the wrong ones too, and the takeaway. (live-quiz.html s3; tag) | §6.4 Z R1 (explanations under every option, "מה לזכור"); design-quiz §1.3 R1 | covered | meeting | The race folds them under "להסברים". |
| Q7 | "המלכודת של הסבב": the most chosen wrong option is named at the reveal and becomes a trap card. (live-quiz.html s3; day 11:30; cm §3.4) | none | missing | meeting | Computable at the reveal from the round's counts (≥ 3). |
| Q8 | The end: the team's result and "השאלה ששברה את הקבוצה"; each phone privately gets its own mistakes. (lobby rule "בסוף: ציון הקבוצה והשאלה ששברה את הקבוצה"; cm §3.4) | §6.4 Z E1 ("הקבוצה ענתה נכון על 72%", "הכי קשות לקבוצה", "שלך: 8 מתוך 10", "הטעויות נשמרו ב״הטעויות שלי״") | covered | meeting | The mistakes line waits for release 8 (§5.7). |
| Q9 | Group → personal: every wrong *first* vote, even one fixed in the discussion ("הבנתי בדיון"), enters the private queue with the winning argument and returns after 1 day and after 3. (g2p; loop 6) | section Z copies each answer into `study_answers` (mode `quiz`) at the reveal (D7); the mistakes list (release 8) | partial | meeting | No first vote vs second vote (no revote), no winning argument kept, no 1-day and 3-day returns. |
| Q10 | Personal → group: the quiz's questions are picked from anonymous counts: missed by ≥ 3 this week, splits, confident errors. (p2g) | section Z `study_quiz__pick`: spread over parts, flagged last, fewest seen by these players, then random | conflict | fun | A different rule for the same choice; needs PU2. |
| Q11 | Phase 3 rounds: "מי אני?" (the drug in the first person, four clues from hard to easy, each from a slide) and "המלכודות שלנו" (members' traps, the author named after the reveal). (later; cut "חידת ערב"; cm §3.4) | none | missing | other | Builds on P11. The boss as a mode is B1. |
| Q12 | Confusion pairs kept as data: each option tagged with its drug, and the pairs one confuses pick questions for practice and the quiz (what survives the cut "הנמסיס האישי"). (cut; cm §4) | none: one `topic` per question, options untagged | missing | other | |

### 3.5 `meeting` · הפגישה היומית: 3 לקפה, ׳לא ברור׳ ותשובות שנדלקות (phase 1, glow and hot spots in 2; s1 "3 לקפה: פתיחת הפגישה", s2 "בהקראה, בטלפון של מי שעוקב", s3 "במסך ההקראה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| M1 | "3 לקפה · בפרקים הקודמים": 5 minutes, "אפשר לדלג", progress "2/3"; three questions from the bank (two on yesterday's parts, one older), answered alone without opening the summary, written as dramatic one-liners ("Metronidazole נתפסה עם בירה"), with the bet chips; the reveal names nobody and says only "רובכם צדקו" ("רוב הקבוצה צדקה"), no numbers; a quiz preset, not a separate system; a meeting may open with one museum exhibit instead (30 s). (meeting.html s1; tag; loop 3; day 09:00; priv; cm §3.5) | none | missing | meeting | Needs yesterday's meeting (T1), banks for yesterday's parts (decision 3), a 3-question preset of Z with chosen questions (count 3 is allowed), a reveal that shows only a majority word, and either a short "teaser" stem per question or the stems as they are (a rewrite would be a new Claude cost). |
| M2 | The three-line agenda ("סדר היום"): 1 today's reading and reader ("היום: מלריה [ש׳ 19-33] · הקראה: שוהם"); 2 one hot spot (phase 2, from the pulse: "נקודה חמה: Miltefosine בהיריון [ש׳ 16]"); 3 one question open more than 24 h ("שאלה פתוחה: מה עושה LMT-Ros3? [ש׳ 15]"); private guesses and taps, counted, help build it. (meeting.html s1; loop 3; p2g; later; cm §3.5) | none: the spec's "סדר היום" is a marathon's run-of-show (§6.4 A R2-R4; design-me §1.6, §4.4) | missing | meeting | Line 3 can read `groupQuestions` (open comment questions, §5.1); line 2 needs PU2; line 1 needs T1. |
| M3 | The pre-guess (phase 2): two "ניחוש על היום" questions on today's first part, answered in the opening or from Today, kept in a pretest mode that never counts as a mistake; the key is held until the reader reaches the paragraph, then it lights up on every phone with a ding ("דינג! התשובה לניחוש 1", "ניחשת Hypnozoite, כמו רוב הקבוצה · רק לך"); results only as "רוב הקבוצה", no numbers. (meeting.html s1, s2; today.html s1; priv; later; cm §3.5) | none: `study_answers.mode` has no pretest value; `held_until` holds a key by time for an open quiz round (§3.2 Q; design-quiz §2.3) | missing | meeting | Needs the question's paragraph (A1), a hold released by the reader's place instead of a clock, and today's bank before the meeting (decision 3). |
| M4 | "לא ברור לי": a "?" on the current paragraph for every follower, anonymous; toast "סומן, בלי שם. הפסקה תחזור אליך מחר." (meeting.html s2; tag; loop 4; cm §3.5) | none | missing | meeting | It cannot ride on presence: presence carries `user_id` to every subscriber and is limited to one `track()` every 7 s (§2.8). An RPC into an owner-only table, never published, in `merge_users`. |
| M5 | Only on the reader's screen: "3 ׳לא ברור׳ · בלי שמות [ש׳ 20]", shown from 3 taps, with "לעצור ולהסביר" · "להמשיך" · "לשאלה פתוחה למחר"; "5 עוקבים" with their avatars. (meeting.html s3; priv "מוצג רק במסך של מי שמקריא, ורק מ-3 לחיצות"; day 09:10) | followers: the existing reading room (`study-read-<lecture>` presence, "כאן: 6"); the count: none | missing | meeting | The approved page and mockup say 3 taps; `concept.json` and `concept.md` say 2. Reading aloud lives only in presence, so the server cannot yet tell who the reader is to return the count to them alone. "לעצור ולהסביר" should record the stop (for T3); "לשאלה פתוחה למחר" can create a comment of kind `question`. |
| M6 | Phase 2, on the reader's screen: "בפסקה הבאה: ניחוש 2 · כדאי להאט · רוב הקבוצה ניחשה לא נכון". (meeting.html s3) | none | missing | meeting | From pretest answers, counted (≥ 3), a majority word only (decision 1 governs it). |
| M7 | A tapped paragraph comes back to the tapper alone the next day, with the explanation given in the meeting (Today's row "פסקה שסימנת ׳לא ברור׳ · מהפגישה"). (g2p; loop 6; today.html s1) | none | missing | meeting | Feeds T2. |

### 3.6 `corrections` · תיקון שמתפשט, ו-VAR למחלוקות (phase 2; s1 "הצעת תיקון עם מקור", s2 "כרטיס צהוב ו-VAR", s3 "עדכון אחרי שכבר למדת")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| R1 | "הצעת תיקון" on a paragraph or a table cell with a mandatory source: "שקף ✓" (the slide's text quoted under it), "מההקלטה" with the minute, or "חיצוני" with a note. (corrections.html s1; tag; p2g; cm §3.6) | §6.4 K A2-A5 (one-block edits with "מה תוקן (לא חובה)"); §3.2 K `study_edit_block`; design-collab decisions 1-2, §1.3 | partial | meeting | The edit itself is covered (one block for one block, anchors stay); the source is an optional note with no type and no minute. Approval is decision 5. |
| R2 | The spread: questions on the paragraph leave practice until someone taps "עדיין נכון" or rewrites them; cards are updated; one "עדכון" card in Today for whoever already reviewed those cards or answered those questions ("היה … · עכשיו … · תיקון: מאיה · אישור: שוהם · מקור: שקף 33", "הגיע אליך כי ביום ראשון חזרת על כרטיס שנשען על השורה הישנה.", "הבנתי" · "לפסקה"). (corrections.html s1, s3; g2p; why; cm §3.6) | corrections reach a rewrite (§2.3, §4.3.4), "לשאול" (§4.8) and new question and card rounds (tests Q-2, C-2) | missing | meeting | Existing questions and cards are left as they were; needs A1 and T2. |
| R3 | A yellow card: each side's claim in one line with a slide tag ("נועה: … [ש׳ 20]", "איתי: … [ש׳ 23]"); the others back a side anonymously ("עם מי הצדק? גיבוי בלי שמות"). (corrections.html s2; tag; priv) | none | missing | meeting | Backing is anonymous by the privacy rules: owner-only rows, counts only. |
| R4 | VAR: Claude gets both claims, the summary part and the cited slides (text and pictures); the verdict separates "כתוב בשקף" from "פרשנות", may say "לא חד-משמעי", shows "ודאות: פרשנות" and "כדאי לשמוע בהקלטה"; "לקבל" or "בהרצאה נאמר אחרת"; after "לקבל" a "פסיקת VAR" box is pinned in the summary and a trap card goes to everyone's queue ("לתור של כולם"). ≈ $0.08 a dispute. (corrections.html s2; tag; cost; day 09:10 "VAR בערב") | none | missing | meeting | A new op in `api/study/ai.ts` (no new function), a `POLICY` row (X2), the box through `blockExtras` (§5.3), a group trap card. |
| R5 | The lecture's log ("מה עוד השתנה ב-Anti parasite · יומן התיקונים"): corrections, VAR verdicts and "כרטיס צהוב לשקף" entries for the deck's own slips (slide 28 repeats Quinine; slide 29 says "pyridine"), each with source, history and one-tap undo. (corrections.html s3; cm §3.6) | §6.4 K A2 (a paragraph's history); §5.1 `RecentEditsCard` on "יחד" (7 days); §5.6 the library's "2 תיקונים חדשים" | partial | meeting | No per-lecture log, no slide errata, no verdicts. |

### 3.7 `recordings` · ההקלטה בתוך הסיכום (phase 2; s1 "הוספת הקלטה", s2 "הערה מההקלטה בתוך הסיכום")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| REC1 | Adding a recording: the Zoom transcript (VTT, SRT, TXT, or pasted), audio transcribed in a computer's browser (phase 3), the uploader's consent line, the cost estimate with the month's spend ("$15.80 מתוך $33"), notes written only on a tap; hidden until BGU's policy is checked. (recordings.html s1; tag; later; dec 9) | §1.1 row 5, §4.4, §6.4 F/W 1.C, §2.10 release 11, D15, D16, §9.1 steps 3 and 8; design-platform §1.C, §3.6 | covered | other | The spec adds W5 (phone audio through a paid provider), beyond the approved scope. The copy example in §6.4 1.C says "מתוך $40". |
| REC2 | A "מההקלטה" box under each paragraph with only what was said and is not on the slides, tagged with the minute, and "להאזין" from that minute. (recordings.html s2; tag) | §4.4 (`para`, `at`), §5.3 `blockExtras` (W), §6.4 1.C ("41:10 בהקלטה", "העתקת הזמן", "פתיחת ההקלטה") | partial | other | No player in the app: "listen from the minute" becomes "open the recording" plus "copy the time", and only for links to allowed hosts (§9.1 step 4.6). |
| REC3 | A slide corrected aloud becomes a proposed correction with "מההקלטה" and the minute as its source. (recordings.html s2; p2g) | none | missing | other | Needs R1's source types. |
| REC4 | A "זה למבחן" remark moves that paragraph up in everyone's plan and queue. (g2p; cm §3.7) | none | missing | other | A marker on note items, read by the plan and Today. |
| REC5 | "לשאול" answers "מה המרצה אמר על…" from the notes; without a recording it says so ("אין לי עדיין מידע על מה שנאמר בהרצאה עצמה…"). (recordings.html s2; ask.html s1) | §4.8 (notes join the context when a recording is ready); §6.4 K B2 | partial | other | The "no recording yet" line is not in the spec's copy or prompt. |

### 3.8 `plan` · מרתון עד המבחן: מסלול קבוצתי ומסלול פרטי (phase 3; s1 "יום מרתון", s2 "בונים את המרתון, וכשיום נופל")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| PL1 | Set up once from the block exam (date, its lectures), copying the group's routine: from about 3 weeks out about 3 h a day, a shared pass over every summary; in study leave (about 2 weeks) about 10 h a day, past exams and what did not sit well. (plan.html s2; tag; why; cm §3.8) | §6.4 A N1-N4: a *private* plan (exam date, lectures, hours a day, days off, final review); design-me §1.5, §4.3 | partial | other | The spec's plan is personal; the approved plan is the group's, with two phases. |
| PL2 | The group lane, shared and editable by everyone with a name on each change ("שינוי אחרון: נועה"): days of about 50-minute blocks and breaks, the opening and a 5-question quiz per block, checkpoints ("ק״מ 21 ✓ כל הסיכומים נקראו", "ק״מ 42: המבחן"), "הוזז מאתמול". (plan.html s1; cm §3.8) | §6.4 A R1-R6: one-evening marathons with a run-of-show, edited by any member with names (D21); design-me §1.6, §4.4 | partial | other | Marathons are single events; there is no multi-day lane and no checkpoints. |
| PL3 | The private lane ("המסלול שלך · רק לך"): due cards, open mistakes, catch-up for a missed block, topics weak for oneself and not for the group ("חלש אצלך, ולא אצל הקבוצה"); it feeds Today. (plan.html s1; g2p; today later) | §6.4 A N2 tasks (read, practice, generate, mistakes, cards, marathon, weak, review) | partial | other | No comparison with the group (PU2), no catch-up block, no Today. |
| PL4 | Successive relearning: every lecture comes back 3-4 times at growing gaps capped by the exam, a round ends only when every key question is answered right, and the group's reading counts as the first. (plan.html s2; why; cm §3.8) | none (N2: read, practise the next day, final review days) | missing | other | |
| PL5 | When a day slips the plan moves and shows the price ("עוד שעה ביום עד שישי" · "לוותר על יום חזרה אחד"), with no red and no "מאחרים". (plan.html s2; p2g; cm §3.8) | §6.4 A R4 "מאחרים ב-12 דק׳ לעומת התוכנית" (design-me §1.6 R4, §4.4 `lateBy`); N2 rebuilds each morning silently; N1/N2's shortfall line "לא הכול נכנס: חסרות כ-6 שעות…" | conflict | other | The marathon's live line says "מאחרים"; the shortfall line is close to the approved price-of-a-slip pattern. |
| PL6 | Personal → group: who finished what, and the pulse, reshape the group plan (a catch-up block, more time on a hot topic). (p2g) | none | missing | other | Needs PU2. |

### 3.9 `anchor` · עוגן הפסקה: כל דבר יושב על פסקה (phase 1; s1 "פסקה, ומה שיושב עליה", s2 "הדף של הפסקה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| A1 | One address for everything, lecture · part · paragraph · slides: every question, card, association, correction, note and mistake sits on a paragraph; generators return the paragraph number, numbered on the server exactly as `SummaryView` numbers it; route `?l=<id>&at=<part>.<anchor>`; re-anchoring by quote after a rewrite. (tag; loop 1; cm §3.9) | §5.2 `at`; §5.5 `shared/study/blocks.ts` (`numberBlocks`, `reanchor`); `study_edits.anchor` (K); notes' `para` (§4.4); the existing `study_comments.anchor` | partial | meeting | `study_questions` and `study_cards` carry `part_idx` and slides only; §4.6 and §4.7 return no paragraph. |
| A2 | A quiet chip row under each paragraph: "2 שאלות · 2 כרטיסים · הפרימדונה · 1 תגובה", and one chip only oneself sees: "טעית כאן פעמיים. השאלה חוזרת מחר. · רק לך"; while following the reader the chips shrink to a dot. (anchor.html s1; tag; cm §3.9) | the existing comment dot (`note-dot`); K's "תיקון" / "2 תיקונים" chip through `blockState` (§5.3, §6.4 K 1.2) | partial | meeting | Question and card counts, the leading association, the private chip and the shrink while following are missing; `blockExtras` (§5.3) is the hook. |
| A3 | Everything leads back: a wrong answer's "לפסקה" opens the summary at the paragraph, highlighted, with "מהשאלה שטעית בה, ישר לפסקה"; every card's "מאיפה זה?" shows the paragraph; every לשאול answer cites paragraphs. (anchor.html s1; practice.html s2; cards.html s1; ask.html s1; cm §3.9) | §5.2 `slide`/`at` deep links (marked for 2 s); §2.7 `SlideSheet` "לפסקה בסיכום"; §6.4 Q P7 "לקריאה בסיכום (ש׳ 20)", C K4 "ש׳ 12 · לקריאה בסיכום" | partial | meeting | Every link goes by slide number, which the proposal warns against (slides repeat across paragraphs). |
| A4 | The paragraph sheet with four tabs, תגובות · תיקון · אסוציאציה · תרגול; "תרגול" lists its questions and cards with one's own state ("טעית פעמיים", "עוד לא ענית", "בחפיסה", "עוד לא בחפיסה"), the card's association ("בגב: ׳הפרימדונה׳ של שוהם"), and "לתרגל את הפסקה · 2 שאלות". (anchor.html s2; cm §3.9, §7) | §2.7, §2.12 #11, §5.3 `ParagraphSheet` with `SheetTab` = comments · edit · mnemonic | partial | meeting | The "תרגול" tab is missing; `SheetTab` is F1's type. |
| A5 | Personal → group: nothing personal is copied, only what one publishes under one's name and anonymous counts ("הפסקה הזאת קשה לנו"). (p2g; cm §3.9) | §2.9 (published by name); none for the counts | partial | fun | Counts: PU2. |

### 3.10 `progress-pulse` · ההתקדמות שלי, ודופק הקבוצה (phase 2; s1 "ההתקדמות שלי", s2 "דופק הקבוצה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| PR1 | A private page "ההתקדמות שלי" in "שלי", marked "רק לך". (progress-pulse.html s1; nav) | §6.4 A M1-M3, §2.10 release 8, §3.2 P; design-me §1.4 | covered | other | The contents differ: PR2-PR5. |
| PR2 | Readiness per topic as a range ("מוכנות לפי נושא · טווח, לא ציון": 70-85%, 60-75%, 40-55%), shown after about 20 answers per bucket. (progress-pulse.html s1; cm §3.10) | §6.4 A M2: "74% נכונות", "נכונות כרגע 78%", "תרגול: 12 מתוך 15 · 75% נכונות" | conflict | other | Point percentages where the approved screen says "a range, not a score". |
| PR3 | The danger list ("ענית ׳על בטוח׳ וטעית"): confident errors first, each with what was answered and the right answer with slides; each returns the next day in another wording and again 3 days later, "עד פעמיים נכון ׳על בטוח׳". (progress-pulse.html s1; tag; why) | none | missing | other | Needs P2 and P4's re-wording. |
| PR4 | Weak points by aspect as buckets ("מנגנון: חם · אוכלוסיות מיוחדות: פושר · תופעות לוואי: יושב טוב"). (progress-pulse.html s1) | §6.4 A M2-M3: weak topics with the worst aspect ("בעיקר: התוויות נגד"), "חולשה" / "כדאי לרענן"; §3.2 P `study_my_weak_points`; design-me §2.4 | partial | other | The data exists; the per-aspect buckets do not. |
| PR5 | A calibration line after about 20 answers ("במלריה, כשסימנת ׳על בטוח׳, צדקת ב-71% מהפעמים"). (progress-pulse.html s1; cm §3.10) | none | missing | other | Needs P2. |
| PR6 | A late "exam-eve" export view: slide 37 as it is, one's pinned associations and one's own confident errors, with no new generator (what survives the cut "דף ׳הלילה שלפני׳"). (cut) | §4.5 (the summary's PDF) only | missing | other | |
| PU1 | The group's pulse ("דופק הקבוצה · Anti parasite", in "יחד", `?v=pulse`): topics in three buckets, חם · פושר · יושב טוב, no numbers and no names, only topics ≥ 3 members practised, updated nightly ("מתעדכן בלילה · בלי שמות, רק איפה ש-3 לפחות תרגלו"); a chip on each row only oneself sees ("אצלך: חם"), "רק אצלך חם, אז זה נכנס לתור האישי"; "החור שנסגר השבוע"; "מחר בפגישה: הנקודה החמה…, ובמבחן הקבוצתי…". (progress-pulse.html s2; tag; g2p; p2g; priv; dec 1) | none | missing | fun | The privacy note must say how the counts work (X3). |
| PU2 | The nightly anonymous counts: one SQL function a night counts answers, quiz answers, card lapses, "?" taps, pre-guesses and confident errors per topic, aspect, question, option, card and paragraph; publishes only where ≥ 3 different members contributed; skips members who opted out; feeds the agenda's hot spot, quiz picks, the practice queue, trap cards, "דרושה אסוציאציה", museum exhibits, boss heads and the plan. (loop 9; day "בלילה"; priv; cm §2.2, §3.10) | none (§2.9: private rows are owner-only, and nothing aggregates them) | missing | fun | Runs on pg_cron (W1's setup, §9.1 step 4) or, without it, on the first read of the day; its outputs are group tables with their own uuid keys and member-only RLS, never published (§2.8). |
| PU3 | Opting out: "לא לכלול אותי בדופק" in "שלי". (progress-pulse.html s2; priv; nav; dec 1) | none (§5.1 "שלי" settings: text size, recording notes) | missing | fun | An owner-only setting that PU2 reads. |

### 3.11 `ask` · לשאול את ההרצאה, ואז את הקבוצה (phase 2; s1 "שאלה בלילה", s2 "התשובה מהקבוצה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| K1 | Asking from a paragraph, a lecture or the library's bar; answers only from the lecture (slides, summary, notes) with slide numbers; "לא מופיע בשקפים" when so; anything else in a labelled "הרחבה (לא מהשקפים)"; a "לפסקה" chip; a daily cap per member. (ask.html s1; tag; cm §3.11) | §1.1 row 6, §4.8, §6.4 K B1-B7, §2.4 (20 answers a day), D13; design-collab decision 5, §3.3 | partial | other | The model gets the slides, the corrections and the notes, not the summary's text (§2.12 #28, §6.1 #10), while the approved answer reads "תשובה מההרצאה · רק שקפים וסיכום". |
| K2 | "עדיין לא ברור? לשאול את הקבוצה": the question goes onto that paragraph's thread with Claude's attempt attached ("מצורף: הניסיון של Claude לענות"). (ask.html s1, s2; tag; p2g; loop 7) | §6.4 K B5: "לשתף עם הקבוצה" attaches the *answer* as a comment of kind `answer`; the existing thread has kind `question` | partial | other | No one-tap post of the question with the attempt. |
| K3 | A question open more than 24 h joins the meeting's agenda ("אם תישאר פתוחה 24 שעות, היא תעלה בפגישה."). (ask.html s1; p2g) | none | missing | meeting | Agenda line 3 (M2). |
| K4 | The answer: whoever answers is named; the asker marks it answered ("שאלה שנענתה · סימון: מאיה"); the answer lands in the asker's queue as a card ("נוסף כרטיס לתור שלך · רק לך"). (ask.html s2; tag; g2p; day "בלילה") | the existing comments (author, `resolved`) | partial | other | The asker's card is missing (needs C5). |
| K5 | Answered threads become questions that later answers cite. (g2p; cm §3.11) | none (§4.8 sends no comments) | missing | other | |
| K6 | "להעביר לקיר האסוציאציות" from a group answer. (ask.html s2) | none | missing | fun | The wall (W1). |

### 3.12 `wall` · קיר האסוציאציות: הכפתור, הקיר והמנצחת על הכרטיס (phase 2; s1 "הקיר של ההרצאה", s2 "תנו לי 3: טיוטות לשפר", s3 "לנעוץ רגע מהפגישה")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| W1 | A wall per lecture (`?v=wall&l=`, a card on "יחד", "אסוציאציות" in each lecture's actions): tabs הכי טובות · חדשות · דרושות · שלי and a count; every entry with its fact and slide, its author or none, chips "שרבוט" · "רמיקס", and its votes; walls also gathered by drug name across lectures. (wall.html s1; tag; nav; cm §3.12) | none (§6.4 K C1: a paragraph's "אסוציאציה" tab lists the aids members shared, as comments) | missing | fun | |
| W2 | "תנו לי 3 מצחיקות": three drafts in different techniques (a pun, a rhyme, a bizarre scene), each encoding the paragraph's deciding fact, each "טיוטה – תשפרו", saved once on the paragraph for the whole group ("נכתבו פעם אחת, ונשמרות על הפסקה לכל הקבוצה"); nothing is posted without a person; per draft "רמיקס" · "לפרסם כמו שהיא". (wall.html s2; tag; cost; cm §3.12) | §4.9 op `mnemonic` (1-3 checked aids of five kinds), §6.4 K C1-C4, §2.4 (10 a day); design-collab decision 7 ("They are not stored") | partial | fun | The generator exists, but drafts are per request and not kept, so each member pays again, and "לשתף עם הקבוצה" posts one as a named comment. |
| W3 | Members post their own line ("לכתוב משלי" / "משלי"), a remix of any entry, a photo of a paper sketch ("צילום של שרבוט"), or a meme; named or anonymous. (wall.html s1, s2; tag; objects; cut "מה ציירתי?", "שידור חוזר"; dec 10) | none | missing | fun | Photos need Storage paths and a size bound; anonymity is decision 10. |
| W4 | Two votes, "מצחיק" and "נתקע לי"; ranking by votes; the week's winner ("מנצחת השבוע"; "אסוציאציית השבוע" read aloud on Thursday). (wall.html s1; objects; cut "דירוג ׳נדבק׳"; cm §3.12) | none | missing | fun | Who voted stays private; only totals are shown. |
| W5 | The winner rides on everyone's card ("בגב הכרטיס של כולם"): a "לא מדויק" flag keeps an entry off the cards until fixed; the winner is checked once against the paragraph (≈ $0.01); it goes into the card's Extra in the app and in Anki and is the hint after a lapse. (wall.html s1, s2; cards g2p; cm §3.3, §3.12) | none (Anki's Extra holds the card's own explanation, §6.4 C K8) | missing | fun | Needs the card's paragraph (A1); the check is a Claude call (X2). |
| W6 | A personal pin, "שלי": anyone may pin another entry for themselves, seen only by them. (objects; g2p; the "שלי" tab) | none | missing | fun | Owner-only rows, in `merge_users`. |
| W7 | "דרושה אסוציאציה" on facts ≥ 3 members keep forgetting ("כמה מכם שוכחים את זה"), with "להציע" / "משלי". (wall.html s1; cards p2g; loop 9) | none | missing | fun | From PU2 (card lapses). |
| W8 | "לנעוץ רגע" during the reading: a funny moment pinned to the paragraph being read now, with a mandatory "על מה זה?" line (the fact and its slide, "שיהיה מובן גם בלי הפגישה"); a person's name only with their OK ("לתת קרדיט לאיתי? · רק באישור שלו"); the lecturer's own visual hooks as starting points ("גם בשקף: שיני זהב לטעם המתכתי · לצרף"). (wall.html s3; p2g; dec 10; cm §3.12) | none | missing | fun | Reads the reader's place (presence); credit needs that member's approval step. |

### 3.13 `museum` · מוזיאון המלכודות (phase 3; s1 "המוזיאון", s2 "החיסון בתור שלך")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| MU1 | An exhibit opens when ≥ 3 members made the same error "על בטוח" (in practice or a quiz) and it is clearly false against the slides; it opens a day later ("מוצג נפתח רק למחרת, כדי שאי אפשר יהיה לנחש מי"); it is checked against the slides like a question. (museum.html s1; tag; p2g; loop 9; cm §3.13) | none | missing | fun | Needs P2 and PU2. |
| MU2 | The museum (`?v=museum`, on "יחד"): each exhibit with a funny plaque ("חומרים: ביטחון עצמי, שקף 27"), "אמנים: כמה מכם" (never a number or a name), the truth with its slides, "מה בלבל", and a state (חדש · עדיין תלוי · עוד נופלים · בפנסיה); an optional witty plaque from Claude (≈ $0.01). (museum.html s1; tag; cost) | none | missing | fun | |
| MU3 | The vaccine: every exhibit enters everyone's queue as a trap card ("חיסון · ממוזיאון המלכודות · מוצג מס׳ 3"), also for those who did not fall; it retires when the whole group answers its retest right on two separate days. (museum.html s2; g2p; cm §3.13) | none | missing | fun | A group card delivered to all; retirement reads everyone's results as a count. |
| MU4 | A meeting may open with one exhibit, 30 seconds ("מחר ב-09:00, בפתיחת הפגישה · 30 שניות"). (museum.html s2; p2g) | none | missing | fun | Part of the opening ritual (M1, decision 7). |

### 3.14 `boss` · קרב הבוס בסוף המרתון (phase 3; s1 "הקרב", s2 "ניצחון, והשלל")

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| B1 | A live co-op battle, a quiz preset, built from the pulse's hot spots and the museum: one head per topic ≥ 3 members struggle with ("ראש 3/4"); the group's and the boss's HP bars; the group's right answers take the boss's HP; a wrong answer costs the team, never one person; "ענו 5 מתוך 6 · עונים לבד"; a timer. (boss.html s1; tag; p2g; dec 1) | none | missing | fun | On Z's engine (co-op) with PU2. |
| B2 | The mechanics are the pharmacology: the boss attacks with a claim to rebut ("Artemisinin תוקפת: ׳אני לבד מספיקה!…׳"); the dormant Hypnozoite comes back (relapse) until the Primaquine question is answered; Primaquine without G6PD costs 20 HP. (boss.html s1, s2; why; cm §3.14) | none | missing | fun | Scripted rules per head; optional exam-style questions (≈ $0.50 an exam) are an X2 row. |
| B3 | The end: victory, or "סבב נקמה" the next day instead of a loss screen; "רגעי הקרב של הקבוצה, בלי שמות"; a marathon medal for taking part, not for a score; the private loot, a 3-day plan of one's own battle mistakes ("השלל שלך: 4 טעויות, 3 ימים", "לתוכנית שלי"). (boss.html s2; g2p; cut "עונות, מטבעות…") | none | missing | fun | The loot feeds the private plan and Today. |

---

## 4. The twelve decisions

| ID | Decision (approved default) | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| D1 | **The anonymous pulse:** yes, in three buckets (חם · פושר · יושב טוב), no numbers or names, only topics ≥ 3 practised, nightly, a personal opt-out; the same answer governs the guess counts on the reader's screen, the museum, "דרושה אסוציאציה", the agenda's hot spots and the boss's topics. (dec 1; priv) | none | missing | fun | PU1-PU3, M6, MU1-MU4, W7, M2, B1. |
| D2 | **Race points** for a right answer and the bet (right +1/+2/+3, wrong 0/−2/−6); speed only breaks ties; the table only for the race's players and only inside the game; the default mode "כולנו נגד המבחן". (dec 2; priv) | section Z `study_quiz__reveal`: "500 for a right answer plus up to 500 more for speed"; `study_quiz_answers.points` checked 0-1000; §6.4 Z C "נכון ומהר = יותר נקודות", R2 "+870"; §6.2 help row "מבחן חי"; design-quiz decision 7; spec D8 | conflict | server | Negative points need the check widened, the bet needs P2/Q3, and the tie-break can use the stored `ms`. The "יחד" card shows one's own place after a race (`study_quiz_recent.my_rank`, §6.4 Z Y): a private line, not a table, so it does not break "no leaderboard outside a game". |
| D3 | **Questions and cards written automatically after each summary**, in the cheaper Batch mode (≈ $0.30 a lecture), ready before the meeting (upload by the evening before; a batch is back mostly within an hour and at most within a day); if not back by the meeting, written normally at full price (≈ $0.59); until server writing is on, one question at upload: "להכין גם שאלות וכרטיסיות?". (dec 3; loop 1; the page's cost section; cm §2.3) | §1.2 leaves out automatic generation (spec D4) and Message Batches ("later"); §2.10; the upload hooks `afterUpload` / `uploadNote` (§5.3, W) | conflict | server | A batch request cannot stream or set `fallbacks` (§1.2; Anthropic's Batches docs: no `stream`, `speed`, `fallbacks`), so the item-by-item stream and the refusal fallback do not apply; results arrive within 24 h, in any order. A natural home is W's queue (§1.2 already names unit kinds `questions` and `cards` for W, "later"): submitted when a summary's last part finishes, polled by pg_cron, items checked with `checkQuestion`/`checkCard` and saved with the server key, refused or expired items rewritten by the normal ops. Needs the meeting's time (T1) for the full-price fallback and half-price `POLICY` rows (X2). |
| D4 | **The monthly cap:** ₪20 a person ≈ $33 (the server setting 33, not 40); recording notes only on a tap; ₪25 (≈ $41) with up to 8 recordings a month; ≈ ₪30 (≈ $50) or rationed notes for nearly every lecture. (dec 4; the cost section) | spec D1, §2.4, §9.1 step 1 (`STUDY_MONTHLY_USD=33`), §5.1 the spend line, `.env.example` (§5.6) | covered | server | The code's fallback stays 40 when the variable is missing, and two copy examples say $40 (§6.4 1.C "נוצלו $12.40 מתוך $40", 1.E "$12.40 מתוך $40"). The approved budget assumes Batch prices (D3); under the spec's on-tap full price, the 80% stop for optional features (spec D14) comes earlier in the month. |
| D5 | **Who approves a correction:** one more member, or approval aloud in the meeting; always with a source, history and one-tap undo. (dec 5; corrections.html s1 "ממתין לאישור", "לאשר"; loop 4) | spec D6 (any member corrects for everyone at once); §6.4 K A3-A5 ("שמירה לכל הקבוצה", "התיקון נשמר לכל הקבוצה"); §6.2 help row "תיקון בסיכום: …הטקסט משתנה לכל הקבוצה"; design-collab decision 1 | conflict | meeting | Needs a pending state (a proposal everyone sees, applied on approval), the reader's "approved aloud" path, and the mandatory source (R1). Release 3 would otherwise ship the immediate edit. |
| D6 | **Home is "היום":** four tabs היום · ספרייה · יחד · שלי; practice opens from Today and from every lecture; `/study/` opens Today and the library moves to `?v=library`. (dec 6; nav; cm §7) | §2.7, §5.1 (ספרייה · תרגול · יחד · שלי, `/study/` = the library), §5.2 `tabOf`/`allowed`, test F-2; design-platform §1.E | conflict | meeting | F1 builds the tab bar next. Until Today's flag is on, `/study/` needs a defined fallback. |
| D7 | **At most two rituals a day:** "3 לקפה" (5 minutes, skippable) and the closing group quiz (5 questions, about 10 minutes); a one-question stop only at a chapter's end, and only if decided during the reading. (dec 7; meeting why; cm §2.3) | the live quiz exists as a general quiz (§1.1 row 2); nothing for the opening or the stop; `study_quiz_create` takes 3-30 questions | partial | meeting | The closing quiz's preset on what was read is Q1; a one-question stop is impossible while the count must be ≥ 3. Marathons add a quiz after each lecture by design; that is not the daily meeting. |
| D8 | **Cards per lecture:** the full deck (54 here), added to one's own deck part by part ("להוסיף"; "20 בחפיסה שלך: 20 כרטיסים מ-3 חלקים"), at most 20 new a day. (dec 8; cards.html s3; day "חלק אחרי חלק") | spec D11 (about 54 a lecture, 20 new a day, 90% retention); §6.4 C K1/K5/K9; design-cards decision 1 | partial | server | No adoption by part: every lecture's cards become everyone's new cards, 20 a day across all lectures. Needs an owner-only adoption row per lecture and part that K1's new-card queue respects. |
| D9 | **Recordings:** hidden until BGU's policy is checked; start with Zoom transcript import and the uploader's consent line. (dec 9) | spec D15, D16; §2.10 release 11; §9.1 steps 3 and 8; §6.4 1.C consent line | covered | server | The spec builds more behind the same flag and server switch (computer and phone transcription). |
| D10 | **Associations without a name, and humour:** posting without a name is allowed (the author kept only for deletion); the house rule: roast the drug, never people or patients; a person's name in a pin only with their OK. (dec 10; priv; wall.html s3) | §4.9 `MNEMONIC_SYSTEM` (Claude's aids: "Clean humor only … nothing about … real people, nothing that mocks patients"); §5.6 `Together.tsx` and §6.1 #15 (shared aids labelled "שותפה ע״י {שם}") | partial | fun | Only Claude's drafts follow a humour rule; members' posts see no rule, cannot be anonymous (comments are named), and pins need no consent. |
| D11 | **"הקבוצה צריכה אותך"** (phase 3): an open question routed to whoever has mastered its topic only by consent, off by default; only the chosen member sees why; at most two rows in Today (an open question in a mastered topic, a correction awaiting a second approval). (dec 11; today later; cm §3.1) | none (K's "routing" picks a lecture, not a person: §4.8) | missing | meeting | Reads private mastery, so it must run in a definer function that tells nobody else. |
| D12 | **Accounts with an email code** in phase 2, before the private screens (my mistakes, progress, card review in the app); until then each member is the phone they joined from, and saving from that phone keeps everything; the codes need an email service and a domain Yoad controls (not the Vercel address); the price is not checked. (dec 12; phase 1 text; cards later) | §2.5; §2.10 releases 7-8; §5.7 (`mistakes = practice && progress`); spec D3, D18, D19; §9.1 step 5; design-me §1.3, §1.8 | partial | server | The gate matches for mistakes, review and progress, and release 8 also waits for the members report. Not covered: Today, the danger list, vaccines and the pulse opt-out are private screens too; phase-1 screens promise a return the next day ("חוזרת מחר בניסוח אחר", "השאלה חוזרת אליך מחר", the anchor's "טעית כאן פעמיים") before any private list exists, so their phase-1 wording must be decided; every new private table (taps, bets, pretest answers, pins, votes, opt-out, adoption) must be owner-only, unpublished, written by definer functions and added to `study_private.merge_users` (checks I17, A-9). Inside the spec, the code is 8 digits and valid 900 s (§2.5, §9.1 step 5) while the copy says "קוד בן 6 ספרות", "הקוד הוא 6 ספרות" and "הקוד תקף לשעה" (§6.4 A2, A3, A9). |

---

## 5. Cross-cutting rows

| ID | Approved element | Spec | Status | Group | Note |
|---|---|---|---|---|---|
| X1 | Room in F1's contract for the approved features: routes `?v=today` (alias of `/study/`), `?v=catchup&l=`, `?v=pulse`, `?v=wall&l=`, `?v=museum`, `?v=plan`; slot modules for Today, the meeting's reader hooks (the "?" button, the reader's card, the glow, chips) and the fun layer's cards on "יחד"; the sheet's "תרגול" tab; their flags, SQL sections, schema versions and error codes. (nav; cm §7) | §3.1 markers F·A·W·Q·Z·C·K·P; §2.11 registry and `REQUIRED_SCHEMA`; §5.2 `Route`; §5.3 slots and `SheetTab`; §5.7 flags; §6.3 and test F-13; §7 ownership rules | missing | other | Every one of these files is F's. New SQL sections must come after P, since their SQL functions read Q, Z, C, K and P tables (§3.1 "Why this order"). |
| X2 | Budget rows for the approved Claude features the spec lacks: VAR (≈ $0.08 a dispute), the wall's drafts saved once per paragraph (group spend) and the winner's check (≈ $0.01), a member's trap check, the museum's plaque (≈ $0.01, optional), the boss's exam-style questions (≈ $0.50, optional), the blind solver (≈ $0.10 a lecture), an optional check of a correction (≈ $0.01-0.02), and half-price batches reserved by the worker. (the page's cost section; each feature's cost line) | §2.4 `POLICY` (outline, part, notes, practice, exam, cards, ask, mnemonic, transcribe, pdf); §2.1 (7 of 12 functions used) | missing | server | `study_usage.kind` is a free pattern (`^[a-z][a-z_]{1,23}$`), so no SQL change; only `server/study/budget.ts` (F0, in progress) and the ops change. Everything fits in `ai.ts` and `work.ts`. |
| X3 | The privacy note and help: the counting rules (≥ 3 members, nightly, opt-out), "לא ברור" counts only on the reader's screen and from 3 taps, guesses only as "רוב הקבוצה", anonymous associations and anonymous VAR backing, "אין טבלת מובילים מחוץ למשחק". (priv) | §6.2 note and help rows; two rows now contradict the approved behaviour: "תיקון בסיכום: …הטקסט משתנה לכל הקבוצה" and "מבחן חי: …״תחרותי״: נקודות על תשובה נכונה ומהירה…" | conflict | other | F renders §6.2; the new lines need flags like the existing ones. |
| X4 | The tabs' contents: "יחד" = the reading now and the open quiz, open questions, the pulse, the wall, the museum, the marathon's plan; "שלי" = progress and the danger list, my mistakes, my marathon lane, settings (Anki, new cards a day, leaving the pulse), the group's budget, help and privacy; each lecture: תרגול · כרטיסיות · מבחן קבוצתי · לשאול · הקלטה · אסוציאציות. (nav) | §5.1 `Group.tsx` (עכשיו, `QuizCard`, שאלות פתוחות, `RecentEditsCard`, `MarathonsCard`), `Me.tsx` (account, progress/mistakes/plan rows, text size, recording notes, spend, members, help, sign-out); §5.6 `LectureView`'s action row (תרגול, כרטיסיות, מבחן חי, לשאול, + W's הקלטה) | partial | other | Missing: pulse, wall and museum on "יחד"; the danger list, the marathon lane and the Anki / new-cards / pulse settings on "שלי"; "אסוציאציות" among a lecture's actions. |
| X5 | Releases follow the approved phases: phase 1 (budget meter first; anchor, practice, quiz, cards, meeting), phase 2 (corrections with VAR, Today with review, wall, ask, progress and pulse, recordings, accounts), phase 3 (plan, boss, museum, extras), past exams blocked. (phases) | §2.10 releases 1-12; §5.7 the flag sets per release | partial | server | Corrections are release 3 in the spec (after W2, before practice) and would ship decision 5's opposite; the meeting, Today, the pulse, the wall, the museum and the boss have no release or flag; the table in §2 above maps every row. |

(X1-X5 are the cross-cutting row of §1's count.)

---

## 6. The gaps, by group

### meeting (35 rows; 3 covered)

- **The day's meeting as data:** T1.
- **Today's composition:** T2 (the mixed private queue), T3 (catch-up), T4 (open question row), T5 (the flame vs the spec's streak), D6 (Today as home), D11 ("הקבוצה צריכה אותך").
- **The rituals:** M1 ("3 לקפה"), M2 (the three-line agenda), M3 (the pre-guess and its glow), M4-M5 ("לא ברור" and the reader's count from 3), M6 (the reader's guess warning), M7 (the paragraph comes back tomorrow), K3 (open > 24 h → agenda), D7 (two rituals, the one-question stop).
- **The closing quiz:** Q1 (on what was read), Q2 (co-op record, names), Q3 (the bet), Q5 (Mazur's rule, revote), Q7 (the round's trap), Q9 (first vote → queue with the argument, 1 and 3 days); covered: Q4, Q6, Q8.
- **Corrections and VAR:** D5 (approval), R1 (mandatory source), R2 (spread and "עדכון"), R3 (yellow card, anonymous backing), R4 (VAR), R5 (the lecture's log).
- **The anchor:** A1 (paragraph on questions and cards), A2 (chips), A3 (links by paragraph), A4 (the "תרגול" tab).

### fun (26 rows; none covered)

- **The pulse and its counts:** D1, PU1 (the screen), PU2 (the nightly counts), PU3 (opt-out), A5, P8, P9, Q10 (picks from counts).
- **The wall:** D10 (anonymity, humour, pin consent), W1-W8, C4 (hint after two lapses), K6 (answer → wall).
- **The museum:** MU1-MU4.
- **The boss:** B1-B3.

### server (9 rows; 2 covered)

- **Batch generation:** D3; P7 (the blind solver).
- **Release gating:** D12 (accounts; private screens; merge lines; phase-1 promises; the 6-vs-8-digit copy), X5 (phases vs releases).
- **Budget and decision deltas:** D2 (race scoring), D8 (adoption by part), X2 (budget rows); covered: D4 (the cap, with copy nits), D9 (recordings).

### other (42 rows; 7 covered)

- **The F1 contract and copy:** X1, X3, X4.
- **Practice:** P2 (the bet, a shared prerequisite), P3, P4, P5, P10, P11, P12, P13; covered: P1, P6.
- **Cards:** C5 (private mistake cards), C6, C7; covered: C1, C2, C3.
- **Quiz extras:** Q11, Q12.
- **Recordings:** REC2, REC3, REC4, REC5; covered: REC1.
- **Plan:** PL1-PL6.
- **Progress:** PR2 (range vs score), PR3 (danger list), PR4, PR5, PR6; covered: PR1.
- **Ask:** K1, K2, K4, K5.

---

## 7. Inconsistencies found while mapping

**Inside the proposal**

1. The "לא ברור" threshold: 3 taps on the approved page ("ורק מ-3 לחיצות") and in the mockup; 2 in `concept.json` (meeting s3 note) and `concept.md` §2.3, §3.5. This map follows the approved page: 3.
2. The closing quiz: 5 questions (decision 7, the day, the lobby mockup "5 שאלות") vs 10 (`concept.md` §3.4 preset "סוף הקריאה"; `concept.json` lobby "10 שאלות"). The approved mockup says 5.
3. `concept.md` §6 lists 11 decisions, and its §5 ships email sign-in first in phase 1; `concept.json` and the page have 12, with accounts in phase 2 (decision 12). The page and decision 12 win.
4. Phase-1 screens promise a return "tomorrow" (practice s2, quiz s3, anchor s1) while the queue and the mistakes list open in phase 2 (decision 12). See D12.

**Inside the spec**

1. The email code: 8 digits, valid 900 s (§2.5, §9.1 step 5) vs the copy "קוד בן 6 ספרות", "הקוד הוא 6 ספרות", "הקוד תקף לשעה" (§6.4 A2, A3, A9).
2. Copy examples with "מתוך $40" (§6.4 1.C, 1.E) while the cap is 33 (§5.1, §6.2 use $33).

**Between the two (naming)**

- The live quiz: approved "מבחן קבוצתי" with modes "כולנו נגד המבחן" · "מירוץ"; the spec renamed it "מבחן חי" with "קבוצתי" · "תחרותי" (§6.1 #11). The lecture's action chip follows (§5.6: "מבחן חי"; approved nav: "מבחן קבוצתי").

---

## 8. What every addendum design inherits from the build plan

- **Files have one owner** (§7 rules 1-2, §10.2): F's files (`route.ts`, `flags.ts`, `failText.ts`, `features/types.ts`, `Shell`, `Group`, `Me`, `LectureView`, `SummaryView`, `api.ts`, `study.css`, `budget.ts`, `package.json`) change only through F, so anything the approved features need there belongs in F1 now or in a small PR to F first.
- **SQL goes between markers** in `supabase/study-schema.sql` and `supabase/tests/study.sql` (§3.1), each section re-runnable, ending with its schema version (§2.11); a section whose `language sql` functions read another section's tables comes after it, so new sections go after P.
- **Flags only show or hide screens** (`flags.ts`, §5.7); the server decides what it accepts (the key, the budget, the switches `recordings` and `exams`, §2.10). The e2e of every package runs under its release's flag set (§7).
- **Every Claude call reserves before and settles after** under one `POLICY` table (§2.4): optional kinds stop at 80% of the cap, one member's optional spend at 40% (spec D14, D23), with daily limits; every write of Claude's output needs the server key (§2.3).
- **At most 12 files in `api/study/`** (§2.1); the spec uses 7 (8 with W5). New Claude work goes into ops of `ai.ts` or unit kinds of `work.ts`.
- **Privacy is enforced by the database** (§2.8, §2.9): private rows owner-only, written by definer functions, never published to Realtime; published tables keep their own uuid key and a member-only read policy; presence calls at most one `track()` every 7 s per channel.
- **Identity** (§2.5): every new user column joins `study_private.merge_users` (checks I17, A-9); private lists and scores wait for release 8.
- **Every raised error text is listed** in `failText`, `QUIZ_ERROR_TEXT`, `authErrorText` or `INTERNAL_CODES` (test F-13).
- **Builds:** the study entry chunk under 400 kB with screens lazy (§5.3, §7); tap targets ≥ 44 px, one sticky action bar on immersive screens, contrast checked in light and dark (§5.8).
- **The SQL runs before the merge** on production, by Yoad, then `schemaOk` is checked, then the flags (§7 "Done when", §9.1 step 2).
- **Copy is gender-neutral** (§6.0): infinitives, plural, nouns; about another member, a name with a noun or "ע״י".

---

## 9. Method and evidence

- The 34 approved screens were read from the mockup HTML (outlines in `work/*.txt`, made by `work/outline.py` and `work/compact.py`), the feature texts from `concept.json`, and the privacy, phases, cost and decisions sections from the rendered page (`work/proposal.txt`).
- The spec was searched for every approved element by its English and Hebrew names (for example "3 לקפה", "לא ברור", "VAR", "כרטיס צהוב", "pulse", "דופק", "museum", "boss", "confidence", "הימור", "revote", "Batch", "adopt", "anchor"), then read section by section where a hit or a near feature existed: §1-§2, §3.1-§3.2 and the SQL of sections Q, Z, C, K, P, §4.4, §4.6-§4.9, §5.1-§5.7, §6.1-§6.2, §6.4 (every package's screen copy), §7, §9.
- The design sources were read where the spec defers to them: design-quiz §1, design-questions §1, design-cards decisions and §1.1-§1.2, design-collab decisions and §1.1-§1.2, design-me §1.4-§1.7.
- The repo's `supabase/study-schema.sql` and `src/study/components/SummaryView.tsx`, `Library.tsx` and `LectureView.tsx` were read for what exists today (comment threads with `question` and `resolved`, the comment dot, follow-the-reader, `study_reads`).
- Batch facts (no `stream` or `fallbacks` in a batch request, 50% price, most within an hour, at most 24 h) are from the spec's §1.2 and Anthropic's Batches documentation as bundled with the Claude API reference.
- No SQL was loaded and nothing was run against any database: every claim about a table, a check or a function quotes the SQL printed in §3.3.

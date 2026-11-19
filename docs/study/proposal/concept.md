# Tamtzit 2.0: the product concept

*For the builder, and the source of the visual proposal that Yoad and Shoham will review before anything is built.*

- **Design only.** Nothing in the repo or in production was touched.
- **Inputs:**
  - the ranked and judged ideas (30 ideas, three judges);
  - Shoham's own answers (`round1/answers/*.json`, `round2/answers-2026-11-14.md`);
  - the existing designs in `spec/`: platform, questions, quiz and cards, plus the collab and progress prototypes;
  - the real lecture "Anti parasite & Anthelmintic drugs" (`qtest3/deck.txt`, 38 slides) and its Hebrew summary (`qtest3/summary-r3-hybrid.md`).
- **Facts in examples.** Every medical fact in an example comes from the deck, with its slide number.
- **Screen content.** The Hebrew content of every screen is in `concept.json`, next to this file.
- **The six people** in the examples are the same as in the mockups: שוהם, נועה, מאיה, איתי, דניאל, רוני.
- **The calendar.** Today is 15 Nov 2026. The block exam (פתוגן-מאכסן) is in early January. By the group's own routine, the marathon starts about three weeks before it, around 14 Dec.

---

## 1. Vision

**In one sentence:** what the six of you read, argue and laugh about together each morning lands in each person's private review, and what any one of you finds alone (a doubt, a fix, an association that sticks) goes back to improve everyone's material. Nobody ever sees anyone else's scores.

**Three rules hold the whole concept together:**

1. **Content is made once, for the group. Memory is kept per person.**
   - Claude writes a lecture's summary, questions and cards once, for all six. That keeps AI cost flat.
   - Answers, schedules and mistakes belong to one person.
2. **Everything sits on a paragraph.** Every question, card, association, correction, recording note and mistake points to one paragraph of the summary, and one tap leads back to it.
3. **Performance is private. The group sees only anonymous totals.**
   - This is Shoham's rule: "ציונים וטעויות ישארו חסויים ויראו רק למשתמש הנוכחי".
   - The database enforces it, not just the screens.

**What the concept answers:**

- **Yoad's brief:** "everything must connect, personal with group and back"; "creative and funny features, associations people upload"; "propose before you develop".
- **Shoham's brief:**
  - "עוד כל דבר שיכול לשפר למידה קבוצתית זה החלק הכי מהותי";
  - "היום מישהו מקריא והשאר עוקבים אצלהם, אנחנו רוצים שזה יהיה מוטמע שיטתית וחכם";
  - and, asked which features should come first, "הכל".

---

## 2. The loop

### 2.1 The core objects and where each lives

| Object | Lives | Made by | Who sees what | Anchored to |
|---|---|---|---|---|
| **Lecture** (הרצאה) | group | One upload. Claude writes the summary. | Everyone in the group. Who-read-what stays shared, as today. | course |
| **Paragraph** (פסקה) | group | The summary writer, and members' corrections. | Everyone. A correction shows its author, history and source, with one-tap undo. | lecture · part · paragraph id · slides |
| **Question** (שאלה) | **both**: the question is the group's, the answers are personal | Claude, once per lecture (the bank). Later, members' traps and past exams. | **Everyone sees:** the stem and options. **Hidden:** the key stays on the server until you answer. **Only you see:** your answers, bets and results. **The group sees:** per-option counts, only when at least 3 answered, never names. | paragraph + slides |
| **Card** (כרטיס) | **both**: the deck is the group's, the memory is personal | **The deck:** Claude, once per lecture; members edit it. **Your own cards:** your cloze cards and your mistakes. | **Everyone sees:** the deck, which anyone can edit and undo. **Only you see:** your schedule, reviews and lapses. **The group sees:** only "at least 3 of you keep forgetting this". | paragraph + slides |
| **Mnemonic** (אסוציאציה) | group, plus a personal pin | **Members**, named or anonymous. **Claude** writes drafts only when someone taps for them. | **Everyone:** the wall and the vote totals. **The winning association:** goes on the back of everyone's card. **Your pin (שלי):** only you see it. | paragraph, and the drug's name |
| **Mistake** (טעות) | **personal only** | **Your:** wrong answers, confident errors (על בטוח), card lapses and "לא ברור" taps. | **Only you.** It reaches the group only as an anonymous count, from at least 3 members, computed nightly. Those counts feed the pulse, the museum and the quiz picks. | paragraph + question or card |

**Secondary objects:**

- **Correction:** group, named, with history.
- **Question thread:** group. Exists today.
- **Recording note:** group.
- **Plan:** a group lane plus a private lane.

### 2.2 Privacy rules

1. **Content is shared; performance is private.**
   - **Group content:** questions, cards, associations, corrections, notes and threads.
   - **Private:** answers, confidence bets, card schedules, lapses, mistakes, "לא ברור" taps, readiness and calibration.
2. **The database enforces it.**
   - Private rows are readable only by their owner (row-level security).
   - They are written only through definer functions.
   - They are never published to Realtime.
   - The questions, cards and quiz designs already specify this. The new features (pulse, museum, Today) must keep it.
3. **The group sees aggregates only:**
   - counts, never names;
   - only where **at least 3 different members** contributed;
   - computed **once a night**, so a change can't be traced to whoever just practised.
   - **The pulse** shows buckets ("חם · פושר · יושב טוב"), not numbers.
   - **The museum** says "כמה מכם", never a count.
4. **Inside a live game:**
   - Per-option counts appear after the question closes, and only with at least 3 answers.
   - Race standings exist only for that race's players, and only inside the game.
   - **There is no leaderboard outside a game.**
5. **What a person publishes carries their name:** a comment, correction, association, trap or answer. The exceptions:
   - associations may be posted anonymously;
   - backing a side in a dispute (VAR) is anonymous.
6. **Kept as today:**
   - who-read-what ("קראו: …"), which Shoham chose ("לראות מה כל אחת כבר למדה");
   - reading presence while "להקריא לקבוצה" is on.
7. **Opt-outs and consent:**
   - "לא לכלול אותי בדופק" in שלי.
   - "הקבוצה צריכה אותך" routing is opt-in.
   - A lore pin that names a person needs that person's OK.
   - The uploader confirms consent for a recording.

### 2.3 One day

**Before the meeting (personal, ~07:30-08:50)**

1. Today opens with the group band: "הקבוצה היום · 09:00 · מלריה: מחזור החיים, מנגנונים ושילובים (ש׳ 19-33) · הקראה: שוהם".
2. Below it is **התור שלי**, cut to the time chosen (10 · 20 · 45 min). It holds:
   - due cards;
   - your misses from yesterday's quiz;
   - one confident error in a new wording;
   - the "לא ברור" paragraph from yesterday, now with an answer in its thread.
3. (Phase 2) Two "ניחוש לפני" questions on today's part. They are answered privately and never count as mistakes.

**During the meeting (group, ~09:00-10:45)**

1. **Opening, "3 לקפה" (5 min, skippable).**
   - Three retrieval questions: two on yesterday's parts and one older item.
   - Each member answers alone. The reveal has no names.
   - Then a three-line agenda: today's parts, one hot spot, one open question older than 24 h.
2. **Reading together.** It exists today: one member reads aloud and the others follow on their phones.
   - **"לא ברור לי":** any listener taps it, anonymously. From 2 taps, the reader's screen shows "3 לא ברור".
   - **Pre-guesses:** when the reading reaches a pre-guess answer, it lights up on every phone (Phase 2).
   - **Corrections:** a proposed correction can be approved aloud.
   - **Lore:** "נעץ רגע" pins a funny moment to the paragraph being read.
3. **Closing: the live group quiz (~10 min) on what was read.** Each member answers alone with a confidence bet. If the group splits, 90 seconds to argue, then a revote and the autopsy.
4. **At most two rituals a day: opening and closing.** A one-question "pulse stop" happens only at a chapter end, and only if the reader chooses it.

**After the meeting (personal)**

- **Quiz misses.** Every wrong first vote goes into your queue with the winning argument. That includes votes fixed in the discussion ("הבנתי בדיון"). It returns after 1 day and after 3.
- **"לא ברור" paragraphs** come back to you alone tomorrow.
- **Cards.** Adopt the part's cards into your deck, part by part, at most 20 new cards a day.
- **Evening, alone:** practice with autopsies, cards, and "לשאול את ההרצאה". What stays unclear goes to the group as a question on the paragraph.

**Overnight (system)**

- **Private signals become anonymous aggregates** (at least 3 members), and these feed:
  - the pulse;
  - tomorrow's agenda (the top 3 hot spots);
  - the quiz picks;
  - "דרושה אסוציאציה" requests on the wall;
  - new museum exhibits.
- **If automatic generation is on** (decision 3), the bank and deck for tomorrow's lecture are written through the Batch API, at half price.

### 2.4 Up to the exam

| When | What happens |
|---|---|
| Now to ~13 Dec (lecture weeks) | **The daily loop.** The group's bank, deck, wall and corrections grow. Each person's card schedule builds up. Confident errors are retested. The museum fills. |
| ~14 Dec (≈3 weeks before) | **Marathon, phase 1**, about 3 h a day alongside new material, as the group does today. **Group lane:** a shared pass over all summaries. **Private lane:** due cards plus your own weak topics. |
| ~21 Dec (≈2 weeks before) | **Study leave**, about 10 h a day. **Past exams** ("שחזורים"), once Shoham can reach her Drive; until then the bank in exam mode. **Weak points:** from the pulse. **Boss battles:** per subject. |
| Last days | **The boss battle finale.** Mixed retrieval over everything. A later "exam-eve" view: slide 37, the pinned associations and your own confident errors. |
| After the exam | **Review what was used.** Decide on leagues and figure occlusion, and anything else deferred. |

The exam date, and so these dates, are approximate ("תחילת חודש ינואר").

### 2.5 The bridges at a glance

**Group → personal**

1. **Quiz misses.** Every wrong first vote in the live quiz becomes a private, spaced review item.
2. **The bank and deck**, made once for the group, become each person's practice and cards.
3. **The winning association** from the wall goes on the back of everyone's card. It shows as the hint after a lapse.
4. **Corrections.** An approved correction sends an "עדכון" card to anyone who already studied the old line.
5. **Museum exhibits** enter everyone's queue as trap cards (a vaccine), including for those who didn't fall.
6. **Group answers.** A member's answer to your open question becomes a card for you.
7. **The group lane** of the marathon decides what lands in each person's Today.
8. **Catch-up.** A missed meeting arrives as a 12-minute private catch-up pack.

**Personal → group**

1. **Private answers, counted anonymously,** choose:
   - the quiz and opening questions;
   - the agenda's hot spots;
   - the paragraphs to slow down on.
2. **Pre-guesses and "לא ברור" taps** tell the reader where the group is about to get lost.
3. **Card lapses** shared by at least 3 members raise "דרושה אסוציאציה" on the wall.
4. **A doubt while studying alone** becomes a sourced correction for everyone.
5. **Confident errors** shared by at least 3 members become museum exhibits.
6. **A private question** becomes a public, reusable thread.
7. **A member's trap** joins the bank. **A member's association** joins the wall and the cards.
8. **Progress feeds the plan.** Finished parts (who-read-what) and the pulse reshape the marathon plan.

---

## 3. The features (14)

| # | id | Name | Layer | Phase | Effort | AI cost | Covers |
|---|---|---|---|---|---|---|---|
| 1 | `today` | היום (Today) | Personal | 2 | M | $0 | new |
| 2 | `practice` | Practice with an autopsy for every option | Personal | 1 | M | ≈ $0.38 a lecture, once | MCQ + cases, "הסבר לכל תשובה, גם לשגויות" |
| 3 | `cards` | Shared deck, private memory | Personal | 1 (review in 2) | L | ≈ $0.21 a lecture, once | "חזרות קבועות בסגנון אנקי", "גם וגם" |
| 4 | `live-quiz` | Live group quiz: vote alone, argue, revote | Group | 1 | L | $0 | "מבחן קבוצתי / תחרותי בזמן אמת" |
| 5 | `meeting` | The daily meeting: 3 לקפה, "לא ברור", answers that light up | Group | 1 (glow in 2) | M | $0 | "מוטמע שיטתית וחכם" |
| 6 | `corrections` | Corrections that spread, and VAR | Group | 2 | M | ≈ $0.08 a dispute | "סיכומים שכולן עורכות" |
| 7 | `recordings` | Recording notes inside the summary | Group | 2 | L | ≈ $0.87 a lecture, on a tap | "העלאת הקלטות ותמלול" |
| 8 | `plan` | Marathon plan: a group lane and a private lane | Group | 3 | M (slim) | $0 | "תכנון מרתוני למידה" |
| 9 | `anchor` | The paragraph anchor | Bridge | 1 | M | $0 | new (backbone) |
| 10 | `progress-pulse` | My progress, and the group's pulse | Bridge | 2 | M | $0 | "מעקב התקדמות ונקודות חולשה" |
| 11 | `ask` | Ask the lecture, then the group | Bridge | 2 | M | ≈ $0.03 an answer | "צ׳אט עם החומר (״מה המרצה אמר על…״)" |
| 12 | `wall` | The association wall | Fun | 2 | M | ≈ $0.024 a tap | "כפתור שנותן אסוציאציות מצחיקות וזכירות" |
| 13 | `museum` | The trap museum | Fun | 3 | S | $0 | new |
| 14 | `boss` | The boss battle | Fun | 3 | M | $0 | new |

**Where the other judged ideas went:**

- **Folded into features:**
  - confidence bets → practice and quiz;
  - blank tables → practice, Phase 3;
  - member-written traps → practice and quiz, Phase 3;
  - "מי אני?" riddles → a quiz round, Phase 3;
  - the pre-guess and the opening → meeting;
  - the pulse stop → a one-question quiz preset;
  - lore pins and photographed sketches → wall;
  - the roast → an occasional theme night on the wall;
  - the catch-up pack → Today.
- **Kept as data only:** confusion pairs, which feed the quiz picks.
- **Waiting:** past exams, until the Drive folder is reachable.
- **Cut:** everything else, in §4.

### Personal

#### 1. `today`: היום, the personal home that starts with the group

**What it is**

- **The landing tab.** On top is a band showing what the group does today:
  - the meeting, the lecture part and the reader;
  - during the meeting: "הקראה עכשיו: שוהם [לעקוב]" or "מבחן קבוצתי פתוח [להצטרף]".
- **התור שלי** ("רק לך"): one mixed queue cut to the time chosen (10 · 20 · 45 min). It holds:
  - due cards;
  - open mistakes, confident errors first;
  - yesterday's quiz misses;
  - "לא ברור" paragraphs that now have an answer;
  - "עדכון" cards from corrections;
  - museum vaccines.
- **Every row says why it is there:** "טעית אתמול", "מהפגישה", "על בטוח", "הגיע הזמן". The rest rolls over silently, so there is no guilt.
- **Catch-up** for a missed meeting ("פספסת"), detected from following data or a tap. It is a private 12-minute pack built only from what the group produced that day:
  - what the group slowed down on;
  - what was resolved;
  - what was pinned;
  - five check questions.
  - **Finishing** marks the lecture read in who-read-what, with no timestamp and no "late" label.
- **A private weekly flame:** 4 of 7 days keeps it lit. It never resets on one missed day, and it is never shown to anyone else.
- **Closing line:** "סיימת להיום. ה-hypnozoites ישנים בכבד, מותר גם לך."
- **Phase 3, opt-in:** "הקבוצה צריכה אותך". At most 2 rows:
  - an open question in a topic you have mastered;
  - a correction waiting for a second approval.

**Why it matters**

- Daily spaced retrieval happens only when one screen says what to do now.
- Practice testing and distributed practice are the two "high utility" techniques (Dunlosky et al. 2013), and a mixed queue adds interleaving (Rohrer & Taylor 2007).
- This is where Shoham's "הייתי רוצה לעשות חזרות קבועות בסגנון אנקי" becomes a habit.

**How it connects**

- **Group → personal:** the queue is built from the group's day: today's lecture, your quiz misses, the meeting's questions and the catch-up.
- **Personal → group:** finishing alone marks who-read-what. Phase 3 (opt-in) routes open questions to whoever has mastered the topic.

**AI cost and effort:** $0. Effort M.

**Phase 2.** It lands together with in-app card review, since that is what fills the queue. It changes the platform's tab bar (§7, decision 6).

**Screens:** the morning; the catch-up pack.

#### 2. `practice`: practice questions with an autopsy for every option

**What it is**

- **The bank.** About 15 single-best-answer questions per lecture for this 38-slide deck:
  - about 40% short clinical cases;
  - 5 options;
  - only from the slides;
  - generated **once per lecture for all six** (design-questions).
- **Distractors** come from the same lecture's drugs, stages and organisms.
- **Code checks:**
  - slide numbers exist and contain the key term;
  - numbers sit on the cited slide's line;
  - options are alike in length and form. This is the MedEd judge's addition: the key must not be the only two-step or longest option.
- **A blind-solver pass:** a second call must reach the same key.
- **The key stays on the server** until you answer.
- **Before answering:** one confidence tap, ניחוש · נראה לי · על בטוח.
  - It is **stored from day one**. It feeds the danger list and the museum.
  - Negative marking is off by default in private practice.
- **After answering:** the autopsy of **your** option first, then all five, each with "מתי דווקא כן" and its slide tags, then a "לפסקה" jump. A miss enters your queue, to return tomorrow in a different wording.
- **Modes:** by lecture, by course (mixed), "הטעויות שלי", and exam simulation (feedback at the end).
- **Typing before the options open:** opt-in only. On a phone it doubles the time per question.
- **Flags:** שגויה / לא ברורה / לא מהחומר. Two flags hide an item for everyone until it is fixed with a slide citation. Items that lean on a "הרחבה (לא מהשקפים)" box carry "מחוץ לשקפים" and stay out of exam mode.
- **Phase 3 additions:**
  1. **"טבלה ריקה"** on the deck's own tables (slides 4, 13, 23), $0:
     - chip input on phones, row by row;
     - every wrong cell becomes a card.
  2. **"להוסיף מלכודת משלי"** on any paragraph:
     - Claude checks it against the slides and does not rewrite it;
     - it joins the bank;
     - its author is unmasked after it is answered in a live quiz.
  3. **Past-exam mode and a "נשאל ב-<שנה>" badge,** when the Drive folder is reachable.

**Why it matters**

- **Testing effect:** 61% against 40% for restudy after a week (Roediger & Karpicke 2006).
- **Lures:** they can be learned as true (Roediger & Marsh 2005) unless corrected with feedback (Butler & Roediger 2008).
- **Confident errors:** corrected high-confidence errors are hypercorrected (Butterfield & Metcalfe 2001).
- **The exam:** the format matches Shoham's exam (MCQ and clinical cases).

**How it connects**

- **Group → personal:**
  - one checked bank for six, cleaned by the group's flags;
  - the questions most of the group missed rise in your queue;
  - the most popular wrong option becomes a trap card.
- **Personal → group:** anonymous counts, from at least 3 answers, decide:
  - which questions open tomorrow's meeting and enter the quiz;
  - which paragraphs are marked to slow down on;
  - and, through members' traps, what joins the bank.

**AI cost**

| Item | Cost |
|---|---|
| A 15-question round | ≈ $0.28 (range $0.19-0.65) |
| Blind-solver pass | ≈ $0.10 |
| Through the Batch API | about half |
| Answering, blank tables | $0 |

**Effort and phase:** M. Phase 1.

**Screens:** a question before answering; the autopsy; the blank table (Phase 3).

**Build notes:**

- `spec/design-questions.md` holds the SQL (80 checks passing), the prompts and the schema.
- **Add:**
  - a `confidence` column on `study_answers`;
  - the option-form check.
- **Sign-in:** email sign-in must ship first (decision 11 of that design), because answers are private.

#### 3. `cards`: shared deck, private memory (Anki export and review in the app)

**What it is**

- **One deck per lecture,** generated once for the group: 54 cards for this deck (design-cards). Two forms:
  - question and answer;
  - one-fact cloze, with **the drug named in the cue**. This fixes the judges' Chloroquine example, whose cue never named the drug and hid two facts.
- **Every card** has a slide tag and a "מאיפה זה?" link to its paragraph.
- **The group fixes the deck:** edit, delete or restore, with history and undo.
- **Each person adopts the deck part by part** ("להוסיף לחפיסה שלי"), with at most 20 new cards a day, so a block does not bury anyone.
- **Your own cards:** your quiz and practice mistakes become private cards, with their autopsy.
- **In-app review:**
  - FSRS-6, already proven equal to ts-fsrs;
  - שוב / קשה / טוב / קל, with the interval under each button.
- **After two lapses,** the card shows the group's top association as its hint.
- **Anki export (.apkg):**
  - deck `תמצית::פתוגן-מאכסן::Anti parasite`;
  - Hebrew text, slide images, slide tags and the top association in Extra;
  - a re-export updates fixed cards in place and keeps Anki progress.
- **One review home per person:** each member picks either Anki or the app, so a schedule never splits.

**Why it matters**

- **Spacing works:** distributed practice is "high utility" (Dunlosky et al. 2013; Cepeda et al. 2006), and spaced flashcards beat crammed ones (Kornell 2009).
- **FSRS is efficient:** it needs fewer reviews for the same retention (Ye et al. 2022).
- **Cards must lead back to the material:** Shoham found flashcards "טובות לשינון אבל לא ללמידה כללית של החומר", so every card leads back to its paragraph.

**How it connects**

- **Group → personal:**
  - a checked deck nobody typed;
  - the group's best association on the back;
  - your quiz misses as cards.
- **Personal → group:**
  - lapses shared by at least 3 members raise "דרושה אסוציאציה";
  - an edit fixes the card for everyone, and their next Anki export.

**AI cost:** ≈ $0.21 per 54-card deck (range $0.15-0.38), once per lecture for the group, about half through the Batch API. Review, editing and export: $0.

**Effort and phase:** L. Phase 1 for the deck, editing and Anki export, which need no sign-in. **Phase 2** for in-app review and due counts, after email sign-in.

**Screens:** the morning review; a card lapsed twice, with the wall's hint, plus a mistake card; the lecture's deck, with adoption by part and export.

**Build notes:** `spec/design-cards.md` (SQL, FSRS, exporter). Add:

- adoption by part;
- the drug-named-cue rule in `checkCard`;
- the "Extra = top association" field.

### Group

#### 4. `live-quiz`: live group quiz (vote alone, argue, revote)

**What it is**

- **Opening a game:**
  - any member opens a room from a lecture or from the agenda;
  - the others join from the live banner or a WhatsApp link;
  - the game plays the stored bank, and keys stay on the server until each question closes.
- **Two modes:**
  - **"כולנו נגד המבחן"** (co-op, the default). There are no individual points. The group chases its own record, with 80% = "עברנו". Each player still sees their own bet result privately.
  - **"מירוץ"** (opt-in, Shoham's "תחרותי"). Points and a table after each question, visible **only to that race's players and only inside the game**. Scoring is decision 2: the default counts correctness plus the bet, with speed only as a tie-break.
- **Each question:**
  - **Timer:** a generous 60-90 s.
  - **Answering:** everyone answers alone, with a confidence bet: ניחוש / נראה לי / על בטוח, scored +1/+2/+3 when right and 0/−2/−6 when wrong.
  - **Locking:** answers lock.
  - **The reveal:**
    - an anonymous bar chart, shown only with at least 3 answers;
    - then Mazur's rule decides what happens next (table below).
    - Then the key, a one-line autopsy per option, and the round's "מלכודת" (the most popular wrong option).
  - **The reveal's next step, by Mazur's rule:**

    | Share correct | Next step |
    |---|---|
    | ≥ 70% | Explain and move on. |
    | 30-70% | 90 seconds of "שכנעו את הצד השני" at the table, then a revote. |
    | < 30% | Every screen jumps to the source paragraph. |

- **The end of a game:**
  - the team result and "השאלה ששברה את הקבוצה";
  - each phone privately gets "הטעויות שלי".
- **Presets:**
  - "סוף הקריאה": 10 questions on what was read;
  - "3 לקפה" (in the meeting feature);
  - "עצירת דופק": 1 question at a chapter end;
  - "קרב הבוס" (fun).
- **Phase 3 rounds:**
  - **"מי אני?":** the drug speaks in the first person, with 4 clues from hard to easy, each from a slide.
  - **"המלכודות שלנו":** traps written by members, with the author unmasked after the reveal.
- **Held back until the group has played a few weeks:** leagues, nicknames and power-ups.

**Why it matters**

- **Discussion:** peer discussion improves understanding even when nobody knew the answer at first (Smith et al. 2009; Crouch & Mazur 2001).
- **Answering alone first:** it follows team-based learning (Koles et al. 2010) and avoids conformity (Stowell & Nelson 2007).
- **Feedback:** feedback after the reveal keeps the lures from being learned (Butler & Roediger 2008).
- **No speed points by default:** public rankings demotivate the bottom of the table (Hanus & Fox 2015), and time pressure rewards recognition (Wang & Tahir 2020).

**How it connects**

- **Group → personal:** every wrong first vote, even if fixed in the discussion, enters your private queue with the winning argument and returns after 1 day and after 3 days.
- **Personal → group:** private practice picks the questions, counted only: items at least 3 members missed this week, splits and confident errors. Members' traps join.

**AI cost and effort:** $0 per game. Effort L.

**Phase 1.** It is the group feature Shoham asked for twice.

**Screens:** the lobby (mode, players, rules); a question with the bet; the reveal (round 1 → argue → round 2, autopsy, private bet result, group score).

**Build notes:**

- **Use `spec/design-quiz.md`:** coop and race, the SQL tested on six phones at once, and the Realtime contract.
- **Add:**
  - a `round_no` per question, for the revote;
  - a `confidence` field per answer;
  - Mazur's rule in the reveal step.
- **Race scoring** is decision 2.
- **Copy every first vote** into the owner's private `study_answers`.

#### 5. `meeting`: the daily meeting (3 לקפה, "לא ברור", answers that light up)

**What it is**

- **The opening, "3 לקפה · בפרקים הקודמים" (5 min, skippable):**
  - three questions from the bank: two on yesterday's parts and one older item;
  - each member answers alone, without the summary open;
  - written as dramatic one-liners ("Metronidazole נתפסה עם בירה…");
  - the reveal shows only the distribution: below two, "מעטים" instead of a number;
  - then the agenda, three lines: today's parts, one hot spot, one question open for more than 24 h.
- **The opening is a quiz preset.** It is not a separate system.
- **"לא ברור לי":**
  - a small "?" on the current paragraph for every follower, anonymous;
  - from 2 taps, the reader's screen shows "3 לא ברור · בלי שמות", with three actions: "לעצור ולהסביר", "להמשיך" and "לשאלה פתוחה למחר";
  - a tapped paragraph comes back to the tapper alone the next day.
- **Phase 2, answers that light up:**
  - two pre-guess questions on today's first part are answered in the opening or in Today;
  - they are stored in a pretest mode that never counts as a mistake;
  - the key stays held until the follow-the-reader position reaches the paragraph, then it lights up on every phone with a ding;
  - the reader's screen shows where most members guessed wrong ("4 מתוך 5 ניחשו לא נכון · כדאי להאט").
- **Phase 2:** the agenda gains hot spots from the pulse.
- **At most two rituals a day:** the opening and the closing quiz.

**Why it matters**

- **Retrieval:** the opening is one-day spaced retrieval (Cepeda et al. 2006).
- **Pretesting:** guessing first helps learning even when the guess is wrong (Richland, Kornell & Kao 2009; Pan & Carpenter 2023), and curiosity improves memory for the answer (Gruber et al. 2014).
- **Anonymous taps:** they surface confusion nobody says aloud (Caldwell 2007).
- **Shoham asked for exactly this:** the read-aloud is how the group studies, and she asked that it be "מוטמע שיטתית וחכם".

**How it connects**

- **Group → personal:**
  - the group reading answers your private guesses at the exact paragraph;
  - your "לא ברור" paragraphs come back to you alone, with the explanation given in the meeting.
- **Personal → group:**
  - private guesses and taps, counted anonymously, show the reader where the group is about to get lost;
  - they build the three-line agenda.

**AI cost:** $0 at run time. The pre-guess needs today's bank before the meeting (decision 3).

**Effort and phase:** M.

- **Phase 1:** the "לא ברור" tap (one field on the reading presence), the opening on yesterday, and the agenda without hot spots.
- **Phase 2:** the glow, which needs a held-key server mode, and the hot spots.

**Screens:** the opening; a listener's view ("?" tapped, the glow); the reader's view (3 לא ברור, where the guesses went wrong).

#### 6. `corrections`: corrections that spread, and VAR for disputes

**What it is**

- **"הצעת תיקון" on any paragraph or table cell.**
  - **A source is required:** a slide (ש׳ n), "מההקלטה" with the minute, or "מקור חיצוני" with a note.
  - **Approval:** a second member approves, or the reader approves aloud in the meeting.
  - **After approval:** the paragraph shows "תוקן ע״י מאיה · אושר", the diff is one tap away, and undo is one tap.
  - **One block for one block:** a correction replaces one block with one block of the same kind (collab-proto), so every anchor stays put.
- **Spread:**
  - questions anchored to the paragraph leave practice until someone taps "עדיין נכון" or regenerates them;
  - cards are updated;
  - anyone who already reviewed those cards or answered those questions gets one **"עדכון" card** in Today, with the old line, the new line and the source.
- **"כרטיס צהוב" (a dispute):**
  - each side writes its claim in one line, with a slide tag;
  - the others back a side anonymously;
  - "VAR" sends both claims, the summary part and the cited slides (text and images) to Claude.
- **The VAR verdict:**
  - **separates "כתוב בשקף" from "פרשנות"** (the MedEd judge's requirement);
  - may say "לא חד-משמעי";
  - the group accepts it or overrides it ("המרצה אמר אחרת").
- **After a verdict:**
  - it is pinned as a small "פסיקת VAR" box;
  - a real dispute adds a trap card to every queue.
- **A "כרטיס צהוב לשקפים" log** keeps the deck's own slips. Two real ones here:
  - slide 28 is titled mefloquine but repeats Quinine's box;
  - slide 29 says "pyridine synthesis", while DHOD serves pyrimidine synthesis on the same slide and on slide 31.

**The real example**

- **A correction.** The summary's malaria comparison table lists Doxycycline's key toxicity as "—", but slide 33 says tetracyclines are contraindicated in pregnancy and in children under 8. The proposed fix is sourced to slide 33.
- **A real dispute.**
  - **Slide 20:** "No single drug clears both liver and blood stages."
  - **Slide 23:** Atovaquone-proguanil is "Yes" for the primary liver stage and for the asexual blood stage.
  - **The VAR verdict:** both are on the slides. The reconciliation (the hypnozoite is part of the liver stage) is **interpretation**, labelled as such.

**Why it matters**

- **Trust:** it is Shoham's red line ("אני צריכה להיות יחסית בטוחה בסיכום").
- **Silent fixes don't work:** a learned error keeps influencing recall after a silent fix, and explicit, repeated corrections reduce it (Lewandowsky et al. 2012). That is why the update goes to the people who studied the old version.
- **Resolved conflict teaches:** conflict settled with evidence drives conceptual change (Smith et al. 2009).

**How it connects**

- **Group → personal:** one person's fix reaches all six, including the cards already reviewed.
- **Personal → group:** a doubt while studying alone ("זה לא נשמע לי נכון") becomes a sourced, checked correction for everyone.

**AI cost:** $0 for corrections by people. VAR ≈ $0.08 a dispute (20 a month ≈ $1.60). An optional check of a fix against its cited slide ≈ $0.01-0.02.

**Effort and phase:** M. Phase 2. It comes first in Phase 2, because the bank and deck lean on the summary.

**Screens:** proposing a sourced fix; the yellow card and VAR verdict; the "עדכון" card in Today and the lecture's correction log.

**Build notes:**

- **Use `spec/collab-proto/sql/collab.sql`:** rev and gen per part, and one-block edits.
- **Spreading to questions and cards** needs the anchors from feature 9.

#### 7. `recordings`: recording notes inside the summary

**What it is**

- **Two ways in:**
  - **The easiest:** import the Zoom transcript file (.vtt, .srt, .txt, or pasted text).
  - **Otherwise:** transcription in a computer's browser (ivrit.ai Whisper on WebGPU). The audio never leaves the device.
- **Before anything is written:**
  - the uploader confirms that the group may use the recording;
  - the cost estimate is shown ("כ-$0.90").
- **The notes:**
  - Claude writes **only what the lecturer added**: emphasis, examples, "זה למבחן", slide corrections, answers to students;
  - **one "מההקלטה" box per paragraph**, tagged "[הקלטה 41:12]", which jumps to the player.
- **A spoken slide correction** becomes a proposed correction with "מההקלטה" and the minute as its source.
- **"לשאול"** answers "מה המרצה אמר על…" from these notes. Without a recording, it says so.

**Why it matters**

- **The best exam signal:** what the lecturer stresses aloud is the best one the group has, and a slides-only summary can't see it.
- **Shoham's complaint:** summaries that don't carry the material "כמו שהם מועברים בשיעור ויותר".
- **Trust:** a separate, minute-tagged layer keeps every line checkable.

**How it connects**

- **Group → personal:** one upload gives all six the spoken layer. A "זה למבחן" remark raises that paragraph in each plan and queue.
- **Personal → group:** something heard in the recording that the notes missed becomes a correction, sourced to the minute.

**AI cost:**

- **Transcription:** $0 in the browser. An approved provider would cost ≈ $0.08-0.20 a lecture.
- **Notes:** ≈ $0.87 for a 2-hour lecture, up to ≈ $1.24 for a large deck. This is **the costliest extra**, so notes are written only on a tap.

**Effort and phase:** L.

- **Phase 2:** transcript import and notes on a tap.
- **Phase 3:** in-browser transcription on computers, after measuring one real 2-hour lecture full of English terms.
- **Hidden** until BGU's policy is checked (decision 9).

**Screens:** adding a recording (source, consent, estimate); the note box under the slide-37 paragraph.

**The note text in the mockup is a labelled placeholder.** Nothing the lecturer said may be invented.

**Build notes:** `spec/design-platform.md` §1.C, §3.6 (prompt, schema and validation).

#### 8. `plan`: the marathon plan to the exam (group lane and private lane)

**What it is**

- **Set up once:**
  - the exam (בלוק פתוגן-מאכסן, early January) and its lectures;
  - the plan copies the group's own routine (Shoham, adl1).
- **The group's routine:**
  - **from ~3 weeks out:** about 3 h a day alongside new material, a shared pass over all the summaries;
  - **from ~2 weeks out:** study leave at about 10 h a day, past exams ("שחזורים") and the points that didn't sit well.
- **Relearning:** each lecture gets 3-4 relearning sessions at growing gaps, capped by the exam date, and the group reading counts as session 1.
- **The group lane** (shared, editable by everyone, with a name on every change):
  - days, 50-minute blocks and breaks;
  - the opening and a 5-question quiz per block;
  - checkpoints ("ק״מ 21: כל הסיכומים נקראו").
- **The private lane** (only you): it fills the time alone with:
  - due cards and open mistakes;
  - catch-up for a missed block;
  - lectures where you are weak and the group isn't.
- **When a day slips,** the plan reflows and shows the trade-off ("עוד שעה ביום, או לוותר על יום חזרה"). There is never a red "behind schedule".

**Why it matters**

- **Successive relearning:** retrieval to criterion with spaced relearning gives large gains on real course exams (Rawson & Dunlosky 2011).
- **Gaps:** they should scale to the time left (Cepeda et al. 2008).
- **Concrete plans:** "when and what" plans raise follow-through (Gollwitzer & Sheeran 2006).
- **It replaces handwork:** it builds the "לוז מפורט" the group makes by hand today.

**How it connects**

- **Group → personal:** the shared blocks decide what lands in each Today. The private lane targets your own weak items.
- **Personal → group:** who finished what (as who-read-what today) and the pulse reshape the group plan: catch-up blocks and more time on hot topics.

**AI cost:** $0. Deterministic scheduling on top of the bank and the cards.

**Effort and phase:** M for the slim version. **Phase 3, live before ~14 Dec.**

- **Later:** readiness ranges, and shifting time toward overconfident topics.

**Screens:** a marathon day (group lane and private lane); setup and reflow.

**Build notes:** `spec/me-proto/src/day.ts`, `estimates.ts` (dates and time inputs researched in `spec/_me-docs/`).

### Bridges

#### 9. `anchor`: the paragraph anchor

**What it is**

- **One address for everything:** lecture · part · paragraph id · slide numbers.
- **Each paragraph carries a quiet chip row:**
  - **for the group:** "2 שאלות · 2 כרטיסיות · אסוציאציה: הפרימדונה · שרשור";
  - **one chip only you see:** "טעית כאן פעמיים".
- **While following the reader,** the chips collapse to a dot.
- **Tapping opens the paragraph sheet** with tabs תגובות · תיקון · אסוציאציה · תרגול, so you can practise that paragraph's questions right there.
- **Every object links back:**
  - a wrong answer has "לפסקה", which opens the summary at the paragraph highlighted for 2 s;
  - every card has "מאיפה זה?";
  - every "לשאול" answer cites paragraphs.

**Why it matters**

- **Explanation feedback:** jumping from a wrong answer to the paragraph that explains it beats seeing only the right letter (Butler, Godbole & Marsh 2013).
- **It ends the hopping Shoham described:**
  - "מצגת הלימוד של השיעור שהייתה ארוכה ולא ממוקדת";
  - a summary missing material;
  - flashcards good only for memorising;
  - "האינטרנט והצאט".
- **It is the mechanism behind Yoad's "everything must connect".**

**How it connects**

- **Group → personal:** opening a paragraph shows everything the group built on it, and its questions and cards flow into your practice and deck.
- **Personal → group:** nothing personal is copied. Only what you publish (under your name) and your anonymous counts ("הפסקה הזאת קשה לנו") go back.

**AI cost and effort:** $0. Effort M.

**Phase 1.** Every other feature needs it.

**Screens:** a paragraph with its chips (arriving from a missed question); the paragraph sheet.

**Build notes:**

- **Paragraph ids:** have each generator return the paragraph number. The platform numbers paragraphs on the server exactly as `SummaryView` does: 191 blocks, 0 differences. Don't guess the paragraph from slide tags, which repeat.
- **Re-anchoring:** `study_comments` keeps the quote (up to 200 characters) to re-anchor after a regeneration, with the slide as the fallback.
- **Route:** `?l=<id>&at=<part>.<anchor>`.

#### 10. `progress-pulse`: my progress, and the group's pulse

**What it is**

- **My progress** (in שלי, marked "גלוי רק לך"):
  - **readiness per lecture**, shown as a range (it needs about 20 answers per bucket);
  - **weak topics** by drug or organism, and by aspect (mechanism, adverse effects, special populations);
  - **open mistakes;**
  - **the danger list:** confident errors first. Each returns the next day in a different wording and again 3 days later, until it is answered right with confidence twice.
  - **A calibration line,** after about 20 answers: "במלריה, כשסימנת ׳על בטוח׳ צדקת ב-71%".
- **The group's pulse** (in יחד), as defined in §2.2 rule 3:
  - a nightly SQL function counts answers, quiz answers, lapses and "?" taps per topic and aspect;
  - topics show as "חם · פושר · יושב טוב", with no numbers and no names;
  - next to each row, you alone see "אצלך: חם / יושב טוב".
- **Where the pulse goes:** the top 3 hot spots become tomorrow's agenda and the quiz picks. A weekly "החור שנסגר" line celebrates a topic that cooled.
- **Opt-out:** "לא לכלול אותי בדופק" in שלי.
- **Before it is built,** Shoham decides whether the pulse exists at all (decision 1).

**Why it matters**

- **Overconfidence:** overconfident students stop studying too early (Dunlosky & Rawson 2012).
- **The best review:** corrected confident errors are the highest-yield review (Butterfield & Metcalfe 2001), and they need a delayed retest (Butler, Fazio & Marsh 2011).
- **The agenda:** letting the answers set the agenda spends meeting time on real misconceptions (Just-in-Time Teaching, Novak et al. 1999).

**How it connects**

- **Group → personal:** your weak list reads against the group's: "גם הקבוצה חלשה כאן, זה יעלה בפגישה" versus "רק אצלך: לתור האישי".
- **Personal → group:** everyone's private practice, counted anonymously, decides:
  - where the meeting slows down;
  - which cards need an association;
  - which questions the quiz uses.

**AI cost:** $0 (SQL, nightly).

**Effort and phase:** M. Phase 2. The private page can ship before the pulse, if Shoham hasn't decided yet.

**Screens:** my progress (readiness ranges, danger list, aspects); the group's pulse (buckets with your private chip).

#### 11. `ask`: ask the lecture, then the group

**What it is**

- **Long-press a paragraph, or "לשאול" on a lecture.** Answers come only from:
  - the lecture's slides;
  - the summary;
  - the recording notes, once they exist.
- **Every answer:**
  - cites slides and paragraphs;
  - says "לא מופיע בשקפים" when that is the case;
  - labels anything else "הרחבה".
- **"עדיין לא ברור: לשאול את הקבוצה"** posts the question on that paragraph's thread (the existing comments), with the AI's attempt attached.
- **A question open for more than 24 h** joins the meeting agenda.
- **The answer:**
  - whoever answers is named;
  - the asker marks it answered;
  - the answer lands in the asker's Today as a card.
- **Later, if wanted:**
  - a "למה?" ladder, where Claude asks you first, up to 3 levels;
  - routing to members by private mastery, opt-in only.

**Why it matters**

- **Grounded answers** prevent invented "the lecturer said" claims.
- **It replaces a detour:** Shoham fills gaps "מהאינטרנט והצאט", and she uses ChatGPT and NotebookLM.
- **Explaining helps both sides:** the explainer learns from explaining (Fiorella & Mayer 2013), and the asker gets a card, so retrieval follows the explanation.

**How it connects**

- **Group → personal:** a peer's explanation at the moment of need, kept on the paragraph. Resolved threads become a FAQ that later answers cite.
- **Personal → group:** a private confusion becomes a public, reusable thread, and the agenda picks up the ones that stay open.

**AI cost:** ≈ $0.03 an answer with the lecture cached (≈ $0.09 cold). Six people × 15 questions a month ≈ $3, with a per-member daily cap.

**Effort and phase:** M. Phase 2.

**Screens:** a night-time question (answer from slide 30, a labelled הרחבה, "לשאול את הקבוצה"); the group's answer, and the card it adds.

**Build notes:**

- **The function:** op `ask` in `api/study/ai.ts` (platform §3.1).
- **Comment kinds:** collab.sql's comment kinds `answer` and `mnemonic`.
- **The cap:** a daily cap per member.

### Fun layer

#### 12. `wall`: the association wall (button, wall, winner on the card)

**What it is**

- **Where:** on every paragraph or card, "אסוציאציה" opens its wall. Walls are also gathered by drug name across lectures.
- **"תנו לי 3 מצחיקות"** (Shoham's button):
  - **Drafts:** Claude writes three drafts, each with a different technique (pun, rhyme, bizarre scene), each encoding the paragraph's discriminating fact, each labelled "טיוטה – תשפרו".
  - **Nothing is posted automatically.**
  - **Saved once:** the drafts are saved on the paragraph for the whole group.
- **What members post:** their own line, a **remix** of any entry, a **photo of a paper sketch**, or a meme. They post named or anonymous.
- **Two votes:** "מצחיק" and "נתקע לי". **Ranking is by votes** (the measured "נדבק" ranking was cut).
- **Getting onto the cards:**
  - **A flag:** "לא מדויק" keeps an entry off the cards until it is fixed.
  - **A check:** the winner is checked once against the paragraph.
  - **On the cards:** it goes into the card's Extra (in the app and in Anki) and shows **as the hint after a lapse**.
  - **Your own pin:** each person can pin a different entry as "שלי".
- **Requests:** "דרושה אסוציאציה" appears on facts at least 3 members keep forgetting.
- **"נעץ רגע":** during the reading, a funny moment is pinned to the paragraph being read.
  - A one-line "על מה זה" with the fact and its slide is required, so it means something to whoever wasn't there.
  - Names appear only with the named person's OK.
- **The lecturer's own visual hooks are starting points,** like the gold teeth (metallic taste) on slide 7.
- **"אסוציאציית השבוע"** is read aloud on Thursday.
- **An occasional theme night, "ערב צלייה":**
  - every roast line is a fact with a slide tag;
  - roast the drug, never people or patients.

**Why it matters**

- **Mnemonics fix arbitrary links:** drug to toxicity, which understanding alone doesn't fix (Atkinson & Raugh 1975).
- **Humour and bizarreness help** when they stand out (Schmidt 1994; McDaniel & Einstein 1986).
- **Making it yourself helps:** generating (Slamecka & Graf 1978) and drawing (Wammes et al. 2016) both aid memory.
- **Mnemonics fade without review,** so the winner rides on a spaced card.
- **It answers both briefs:** Shoham's "כפתור שנותן אסוציאציות מצחיקות וזכירות למנגנונים מסובכים" and Yoad's "associations that people upload".

**How it connects**

- **Group → personal:** six people's creativity in one place. The association the group chose appears on your card exactly after you forget.
- **Personal → group:**
  - your joke, sketch or pinned moment becomes the group's;
  - lapses, counted anonymously, show where an association is needed.

**AI cost:** ≈ $0.024 a "תנו לי 3" tap (range $0.013-0.049), saved on the paragraph, so each paragraph is paid for once. The check before the cards ≈ $0.01. A typical month: $1-3. Votes, photos and pins: $0.

**Effort and phase:** M. Phase 2.

**Screens:**

1. the lecture's wall (the week's winner, a remix, a sketch, a request);
2. "תנו לי 3" drafts for Miltefosine;
3. "נעץ רגע" during the reading (Metronidazole, slide 7).

#### 13. `museum`: the trap museum

**What it is**

- **When an error becomes an exhibit:**
  - at least 3 members made the same error "על בטוח", in practice or in a quiz;
  - and the error is clearly false against the slides. The MedEd judge rejected "Mebendazole reaches tissue worms", given slide 35's "Fatty meal ↑absorption (tissue)".
  - The exhibit opens **a day later**.
- **Each exhibit has:**
  - a funny plaque ("חומרים: ביטחון עצמי, שקף 27");
  - the truth with its slide tag;
  - "מה בלבל";
  - "כמה מכם", never a count or a name.
- **Every exhibit enters everyone's queue as a trap card** ("חיסון"), including for those who didn't fall.
- **Retirement:** an exhibit retires when the whole group answers its retest right on 2 separate days.
- **A meeting may open with one exhibit,** in 30 seconds.

**Why it matters**

- **Confident errors stick:** corrected, they are remembered better than corrected guesses (hypercorrection, Butterfield & Metcalfe 2001).
- **Collective, anonymous errors** make mistakes normal instead of shameful.
- **A vaccine:** the card reaches those who haven't fallen yet.

**How it connects**

- **Group → personal:** every exhibit becomes everyone's trap card.
- **Personal → group:** private confident errors are its only raw material, and they never show a name.

**AI cost:** $0 (counting and templates). An optional witty plaque from Claude ≈ $0.01 each.

**Effort and phase:** S. **Phase 3.** It needs a few weeks of confidence data, and the at-least-3 threshold makes "barely anonymous" safe.

**Screens:** the museum (exhibits 3-5 and one retired); the vaccine card in Today.

#### 14. `boss`: the boss battle at the end of the marathon

**What it is**

- **A live co-op battle,** a quiz preset, built from:
  - the pulse's hot spots;
  - the museum.
- **One phase per weak topic.**
  - **The group's right answers** lower the boss's HP.
  - **Wrong answers** cost team HP, never one person's.
- **The mechanics are the pharmacology:**
  - "Artemisinin היהירה" attacks with "לבד מספיקה, חזקה פי 10-100". The right counter is never monotherapy, with a long-acting partner, because its t½ is 1-2 h (slide 30).
  - The dormant Hypnozoite regenerates (relapse) until the Primaquine question is answered (slides 19-20).
  - Primaquine without G6PD costs 20 HP (slide 37).
- **Winning or losing:**
  - a lost battle unlocks "סבב נקמה" the next day, instead of a loss screen;
  - the loot is each member's **private 3-day plan** of exactly what they missed;
  - the group medal is for attendance, never for a score.

**Why it matters**

- **Mixed retrieval** over the group's weak topics right before the exam: interleaving plus testing (Rohrer & Taylor 2007).
- **Shared stakes** without exposing anyone.

**How it connects**

- **Group → personal:** the loot is a private spaced plan.
- **Personal → group:** the boss is built from everyone's anonymous weak spots.

**AI cost:** $0 on the bank. Optional exam-style questions ≈ $0.50 an exam, once.

**Effort and phase:** M. **Phase 3**, as a live-quiz preset.

**Screens:** the battle (HP bars, phases, the boss's attack as a question); victory and the private loot.

---

## 4. What is deliberately cut, and why

| Idea | Why it is cut | What survives |
|---|---|---|
| **מאצ׳! Drug dating swipes** | A swipe can't say "only after G6PD" or "for another stage". Its own Primaquine card is a match "only after G6PD". It duplicates the bank's vignettes. | The cases stay single-best-answer items. |
| **Find the Parasite: errors planted in the read-aloud** | It reads false sentences into the text the group must trust, and readers absorb false statements even when warned (Marsh & Fazio 2006). | "Which statement is false" as a bank item type. |
| **Retell it: the drugs' group chat, sports commentator, gossip** | It is rereading in costume, not retrieval, and every rewrite is one more text to verify. | Members may write such chats themselves on the wall. |
| **Weekly seasons, coins, help points, power-ups** | A group that meets daily doesn't need a currency to help each other, and tallying among six friends invites comparison. | The private 4-of-7 flame in Today. |
| **Prediction market** | One more step before every game. What it measures, the confidence tap already measures. | The confidence tap. |
| **Parasitedex: collection, Guess Who, Top Trumps** | An L-sized side project that duplicates card mastery. | The slide-tagged drug × feature table may return later as a reference view. |
| **Teach-a-part rotation and roles** | Daily prep is homework and admin, and Shoham didn't pick splitting lectures. The group already explains to each other naturally. | — |
| **Figure occlusion, hotspots, drag-the-drug** | A mask editor and drag-and-drop on phones are L-sized. | For now, bank questions show the slide's figure, and the blank table drills drug-to-stage. |
| **Live phone Pictionary and an AI art critic** | Six people at one table can draw on paper. | "Photo of my sketch" on the wall. |
| **Nightly riddle push** | One more notification, and web push on iPhone needs a home-screen install. | "מי אני?" becomes a quiz round. |
| **Closing ritual and AI WhatsApp day card** | Tired people skip it, and the quiz already closes the meeting. | The catch-up pack moved into Today. |
| **Measured "נדבק" ranking** | Six people can't produce enough reviews to measure it for months. | The wall ranks by votes. |
| **League with rotating teams, nicknames and power-ups** | Wait until the group has played for a few weeks. In a group of six it adds build work and identifiability. | — |
| **Typed free-recall stops during the reading** | Typing on phones is slow, and it adds 15-20 minutes to a lecture. | Stops are one question at a chapter end. |
| **Personal nemesis character** | It overlaps same-lecture distractors and compare cards. | Confusion pairs (each option tagged with its drug) feed the quiz picks. |
| **Exam-eve sheet as a new AI pipeline** | One-liners drop qualifiers ("weak", "early stages"). | A late export view: slide 37 as is, the pinned associations and your own confident errors. No new generator. |
| **Podcast and per-sentence citations** (yellow in Shoham's triage) | Out of this round. | Slide tags already cover most of what citations would give. |

---

## 5. Phased plan

### Phase 1: the loop's minimum (16-22 Nov, ~1 week)

**Goal:** by Sunday the 23rd, the group can do all of this:

1. read together and tap "לא ברור";
2. close with a live quiz that argues and revotes;
3. find every member's misses waiting privately;
4. practise alone with autopsies;
5. export the deck to Anki;
6. open the next meeting with three questions on yesterday.

**Ships:**

1. **Infrastructure:**
   - email sign-in and the account merge (research-auth), required before private answers are recorded;
   - the spend ledger and the monthly cap (platform §3.5);
   - `api/study/ai.ts` with ops `questions` and `cards`;
   - stable paragraph ids and the `at=` route.
2. **`anchor`:** chips (group counts plus "טעית כאן"), "לפסקה" and "מאיפה זה?".
3. **`practice`:**
   - the bank, generated on a tap (or by the uploader at upload);
   - autopsies and the confidence tap stored;
   - flags and "הטעויות שלי".
4. **`live-quiz`:**
   - co-op with the revote and Mazur's rule;
   - race as designed, with decision 2's scoring;
   - the "סוף הקריאה" preset.
5. **`cards`:** the deck, editing, adoption by part and Anki export.
6. **`meeting`:**
   - the "לא ברור" tap and the reader's count;
   - "3 לקפה" on yesterday;
   - the three-line agenda without hot spots.

**Why this first:**

- It is the smallest slice where both directions of the loop work: group quiz → private queue, and private answers → the next quiz and the opening.
- It is what Shoham asked for most: "מבחן קבוצתי בזמן אמת" (twice), MCQs with explanations, and Anki.
- The designs and their SQL are already tested (`spec/design-questions.md`, `design-quiz.md`, `design-cards.md`).

### Phase 2: trust, memory and the group's intelligence (23 Nov-6 Dec)

1. **`corrections`** first: sourced edits, a second approval, history and undo, VAR, then propagation to questions and cards.
2. **`today`** as the home: the tab bar changes (decision 6), plus **in-app card review** (FSRS) and the catch-up pack.
3. **`wall`:** the button, the wall, the votes, "נעץ רגע", and the winner on the card.
4. **`ask`:** grounded answers, "לשאול את הקבוצה", and the card back to the asker.
5. **`progress-pulse`:** the private page first, then the pulse once Shoham has decided (decision 1).
6. **`recordings`:** transcript import and notes on a tap, if the policy check allows (decision 9).
7. **`meeting` increment:** pre-guesses that light up, and hot spots in the agenda.
8. **Automatic generation:** if decision 3 is yes and server writing is on, bank and deck are generated automatically through the Batch API.

### Phase 3: ready for the marathon (7-13 Dec, live before ~14 Dec)

1. **`plan`** (slim): the group lane, the private lane feeding Today, and reflow.
2. **`boss`:** the preset over hot spots and the museum.
3. **`museum`:** exhibits and vaccine cards. Three weeks of confidence data exist by then.
4. **Extras that follow usage:**
   - "טבלה ריקה";
   - "להוסיף מלכודת משלי" with unmasking in the quiz;
   - the "מי אני?" round;
   - in-browser transcription on computers;
   - "הקבוצה צריכה אותך" (opt-in).

**Blocked:** past exams ("שחזורים", the "נשאל ב-<שנה>" badge, the exam-style profile) wait for Shoham's Drive folder. The questions design already covers reading and explaining an uploaded exam (≈ $0.85 per 40-question exam). When the folder returns, this goes straight into the marathon's phase 2.

### Dependencies

```
sign-in ──► private answers (practice, quiz copies, review, progress, museum)
anchor ───► practice "לפסקה", corrections propagation, chips, ask citations, wall per paragraph
bank ─────► quiz, opening, pre-guess, museum retests, boss
cards ────► Today queue, wall winner on the back, corrections "עדכון" cards
pulse ────► agenda hot spots, quiz picks, "דרושה אסוציאציה", boss phases
server writing (+ Batch) ──► automatic bank/deck before the meeting (pre-guess)
```

### The monthly AI budget

**Example month:** 20 lectures and 8 recordings.

**The cap:** Shoham's ₪20 × 6 ≈ **$33**.

| Item | Full price | With the Batch API |
|---|---|---|
| Summaries, 20 × ≈ $1 (existing) | $20 | $20 (they stream live) |
| Question banks, 20 × ($0.28 + $0.10 blind solver) | $7.60 | ≈ $3.80 |
| Card decks, 20 × $0.21 | $4.20 | ≈ $2.10 |
| Wall drafts and checks | $1-3 | $1-3 |
| Ask, 6 people × 15 questions × $0.03 | ≈ $3 | ≈ $3 |
| VAR, ≈ 20 disputes | ≈ $1.60 | ≈ $1.60 |
| Recording notes, 8 × $0.87 (on a tap) | ≈ $7 | ≈ $7 |
| Quiz, Today, progress, pulse, plan, museum, boss | $0 | $0 |
| **Total** | **≈ $46** | **≈ $40, or ≈ $33 without recordings** |

**So:**

- generate banks and decks through the Batch API (decision 3);
- write recording notes only on a tap after the estimate;
- every feature checks the same cap;
- if the group records most lectures, decide between ₪25 a person (≈ $41) and rationing notes (decision 4).

**These are estimates from the designs.** The first ledger rows replace them.

---

## 6. Decisions only Yoad or Shoham can make

| # | Decision | Who | Recommended default |
|---|---|---|---|
| 1 | Show the group an anonymous pulse of weak points? Options: (A) no; (B) yes, as below; (C) opt-in only. | Shoham | **(B):** buckets with no numbers and no names; only topics at least 3 members practised; updated nightly; a per-person opt-out. The same answer governs the pre-guess bars, the museum and "דרושה אסוציאציה". |
| 2 | Race mode: what earns points? | Shoham | **Correct answer plus the bet** (+1/+2/+3, wrong 0/−2/−6). Speed only breaks ties. The table is shown only to the race's players and only inside the game. Co-op stays the default. |
| 3 | Questions and cards: automatic with every summary, or on a tap? | Yoad | **Automatic, through the Batch API** (≈ $0.30 a lecture), so they are ready before the meeting for the pre-guess and Today. Until server writing is on, a single prompt at upload: "להכין גם שאלות וכרטיסיות". |
| 4 | The monthly cap | Yoad + Shoham | **₪20 a person** (`STUDY_MONTHLY_USD=33`, not the code's default of 40). Recording notes only on a tap. If they record most lectures, ₪25 a person (≈ $41). |
| 5 | Who approves a correction? | Shoham | **One more member, or approval aloud in the meeting.** Always with a source, history and one-tap undo. |
| 6 | Home screen: Today instead of the "תרגול" tab? | Yoad | **Yes.** Four tabs: היום · ספרייה · יחד · שלי. Practice opens from Today and from every lecture. |
| 7 | Meeting rituals | Shoham | **At most two a day:** "3 לקפה" (5 min, skippable) and the closing quiz. A pulse stop only at a chapter end, chosen by the reader. |
| 8 | How many AI cards per lecture? | Shoham | **The full deck** (54 here), adopted part by part, at most 20 new cards a day. |
| 9 | Recordings: the university's policy and consent | Yoad | **Hidden until BGU's policy is checked.** Start with Zoom transcript import, with the uploader's consent line. |
| 10 | Anonymous associations and humour rules | Shoham | **Anonymous allowed** (the author is stored only for deletion). House rule: roast the drug, never people or patients. A person is named in a lore pin only with their OK. |
| 11 | "הקבוצה צריכה אותך": route open questions by private mastery? | Shoham | **Opt-in, off by default.** Only the member picked sees why they were picked. |

---

## 7. Navigation on the phone

**Four bottom tabs, right to left:**

| Tab | Icon | What it holds |
|---|---|---|
| **היום** | home | **The group band** (today's meeting, reader, live state). **"התור שלי"** cut to 10 · 20 · 45 min. **Catch-up.** **"הקבוצה צריכה אותך"** (opt-in). **"תרגול חופשי"** (by lecture, by course, my mistakes). |
| **ספרייה** | book | **Lectures by course** and upload. **The ask bar** ("לשאול או לחפש בהרצאות…"). **Each lecture's action row:** תרגול · כרטיסיות · מבחן קבוצתי · לשאול · הקלטה · אסוציאציות. |
| **יחד** | users | **Now:** who is reading aloud [לעקוב], the open quiz [להצטרף]. **The group's material:** open questions, the group's pulse, the association wall, the trap museum. **The marathon:** the plan's group lane. |
| **שלי** | user | **Everything private, marked "גלוי רק לך":** my progress and the danger list, my mistakes, my lane of the marathon. **Settings:** Anki export and review home, new cards a day, "לא לכלול אותי בדופק", text size, recording notes on or off. **Also:** the group's budget this month, help and privacy, sign-out. |

**Other rules:**

- **The live banner** (platform §1.E) stays: one line on every screen except the one it points to.
  - "הקראה עכשיו: שוהם · מלריה [לעקוב]";
  - "מבחן קבוצתי פתוח · 3 בפנים [להצטרף]".
- **Immersive screens hide the tab bar** and show a back arrow:
  - the reader;
  - upload;
  - a practice session;
  - a card review session;
  - a live quiz or boss battle;
  - catch-up.
- **The paragraph sheet** has four tabs, תגובות · תיקון · אסוציאציה · תרגול, and long-press offers "לשאול".
- **Routes:** query strings on `/study/`, as today. `/study/` now opens Today, and the library moves to `?v=library`.
  - Existing links keep working: `?l=`, `?join=`, `?v=quiz&q=`.
  - New routes: `?v=today` (alias of `/study/`), `?v=pulse`, `?v=wall&l=`, `?v=museum`, `?v=plan`, `?v=catchup&l=`.

---

## Appendix A: `concept.json`

**Top-level keys:**

| Key | What it holds |
|---|---|
| `vision_he` | The vision sentence. |
| `loop[]` | `step_he`, `where` (personal, group or both), `detail_he`. |
| `day[]` | `where`, `where_he`, `when_he`, `items_he[]`. The proposal builder renders it as "יום אחד עם תמצית". |
| `objects[]` | The core objects and their privacy rule. |
| `features[]` | One entry per feature (fields below). |
| `cut[]` | The cut ideas. |
| `decisions[]` | The open decisions and their defaults. |
| `nav[]` | The tabs. |
| `phases[]` | The phases and their dates. |

**Fields of each `features[]` entry:**

| Field | What it holds |
|---|---|
| `id`, `name_he`, `tagline_he` | Identity. |
| `group` | personal, group, bridge or fun. |
| `covers_he` | Shoham's words, or "חדש". |
| `why_he` | Why it matters. |
| `connects_he` | `group_to_personal` and `personal_to_group`. |
| `phase`, `effort` | When, and how big. |
| `ai_cost_he` | The AI cost. |
| `later_he` | Optional: what comes in a later phase. |
| `screens[]` | 1-3 screens (format below). |

**Each screen:**

- `title_he` and `caption_he` (the mockup's figcaption);
- `elements[]`, in reading order;
- `later` (optional), the phase in which that screen ships, when it is later than the feature's.

**Element vocabulary.** Every element has `t`. An element may also carry `later` (a phase number). These map to the kit's classes.

| `t` | Fields | Kit |
|---|---|---|
| `status` | `text` (the time) | `.ph-status` |
| `head` | `text`, optional `back`, `chip` | `.ph-head` |
| `sub` | `text` | `.ph-sub` |
| `banner` | `text`, `action` | the live banner |
| `section` | `text`, optional `chip` | a section label |
| `text` | `text`, optional `state: highlight` | `.a-para` |
| `card` | `title`, `text`, optional `chip`, `foot`, `actions[]`, `kind` (`glow`, `amber`, `request`, `private`, `placeholder`) | `.a-card` |
| `row` | `text`, optional `meta`, `chip`, `action` | a list row |
| `quote` | `who`, `text` | a person's own words, with an avatar |
| `chips` | `items[]`, optional `selected`, `label` | `.a-chip` group |
| `option` | `key` (א-ה), `text`, `state` (`neutral`, `chosen`, `correct`, `wrong`), optional `note` | `.a-opt` |
| `bars` | `title`, `items[[label, n]]`, optional `correct` | a result bar chart |
| `table` | `cols[]`, `rows[[]]` | `.a-table` or rows |
| `meter` | `label`, `value` | `.a-bar` |
| `avatars` | `names[]`, `text` | `.a-avatar` row (same six names and colors) |
| `timer` | `text` | a countdown chip |
| `button` | `text`, `kind` (`primary`, `secondary`, `ghost`) | `.a-btn` |
| `buttons` | `items[]` | a row of `.a-btn` |
| `input` | `placeholder` or `label` + `value` | a field |
| `toast` | `text` | a transient line |
| `private` | `text` | a block marked "רק לך" |
| `note` | `text` | `.a-small .a-muted` |
| `tabs` | `active` | `.ph-tabs`: היום · ספרייה · יחד · שלי |

**Text conventions:**

- Slide tags appear inside text as `[ש׳ 33]`, to be drawn as `<span class="a-tag">ש׳ 33</span>`.
- Hebrew quotation marks inside strings are ׳ and ״, never ASCII `"`.

## Appendix B: sources used

**The lecture**

- `qtest3/deck.txt`: all 38 slides, read in full.
- `qtest3/summary-r3-hybrid.md`: its "הרחבה (לא מהשקפים)" boxes are used only where labelled as such.
- `qtest3/outline-r4.json`: the 8 parts.

**Shoham's answers**

- `round1/answers/*.json`, `round2/answers-2026-11-14.md`. The quoted requests are her own words or the options she picked.

**Existing designs**

- `spec/design-platform.md` (§1.E navigation, §3.5 budget, §7 costs);
- `spec/design-questions.md`, `spec/design-quiz.md`, `spec/design-cards.md`;
- `spec/collab-proto/sql/collab.sql` (corrections, mnemonic and answer comment kinds);
- `spec/me-proto/src/day.ts` and `estimates.ts`, the dates and time inputs researched in `spec/_me-docs/`.

**The repo's labels**

- `src/study/components/*.tsx`: "להקריא לקבוצה", "לעקוב", "סימון שקראתי", "שאלות פתוחות", "לסמן שנענתה", "הזמנה לקבוצה".

**The proposal builder**

- `proposal/build.py`, which reads this JSON;
- `proposal/mockups-workflow.js`, which draws the screens;
- `proposal/parts/ref-mockups.html`, the style reference.

**The ranked ideas and the judges' notes** are given in the task. Research citations are only those named in them.

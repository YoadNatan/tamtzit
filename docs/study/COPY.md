# תמצית's copy: plain words (the glossary)

Yoad asked (Nov 2026) for "normal copywriting": the app had started to name
its own mechanics with medical and game metaphors (a pulse, a vaccine, a trap
museum, a boss with heads and HP, VAR and a yellow card, an autopsy). This
page is the rule, the one word each concept has now, and what the old word
was, so that new copy stays plain.

## The rule

- **Say what it is.** A screen, a button or a toast names the thing the way a
  3rd-year student would say it to a friend: "מה קשה לקבוצה", not "דופק
  הקבוצה"; "טעויות נפוצות", not "מוזיאון המלכודות".
- **No metaphors for app mechanics**, medical or otherwise: no pulse, vaccine,
  autopsy, museum, exhibit, retirement, boss, heads, HP, loot, revenge, VAR,
  yellow card, ruling, marathon, danger list. **Medical content stays
  medical**: lectures, questions, cards, summaries and the AI prompts' medical
  instructions are not copy and are untouched.
- **One term per concept**, everywhere: screens, sheets, toasts, empty and
  error states, help, the guide, server-made titles and the
  route's Back words. The table below is the list.
- **Short and friendly.** Plural, gender-neutral forms where the app already
  uses them ("מי שיוצאים מהספירה", "לא הצלחתם?").
- Ids, routes (`?v=pulse`, `?v=museum`, `?v=boss`), flags
  (`VITE_STUDY_PULSE`, `VITE_STUDY_VAR`, …), class names, SQL names and code
  identifiers keep their old English names: they are not copy.

## The glossary

| Concept | Was | Now |
|---|---|---|
| The group's hard topics (package U, `?v=pulse`) | דופק הקבוצה, הדופק | מה קשה לקבוצה |
| Its three levels | חם · פושר · יושב טוב | קשה · בינוני · יושב טוב |
| A hard topic | נקודה חמה, נקודות חמות, נושא חם | נושא קשה, קשה לקבוצה: … |
| Leaving the count (שלי → הגדרות) | לא לכלול אותי בדופק | לא לכלול אותי בספירה |
| A wrong answer at least 3 chose (C's trap card) | מלכודת של הקבוצה | טעות נפוצה בקבוצה |
| The list of confident common mistakes (`?v=museum`) | מוזיאון המלכודות | טעויות נפוצות |
| One item in it | מוצג, מוצג מס׳ n | טעות נפוצה, טעות מס׳ n |
| Its states | חדש · עוד נופלים · עדיין תלוי · בפנסיה | חדש · עוד טועים בה · עדיין פתוחה · נסגרה |
| The line under the claim | אמנים: כמה מכם. חומרים: ביטחון עצמי, שקף n. | כמה מכם בחרו בזה ׳על בטוח׳ · שקף n. |
| Its card in the review | חיסון · ממוזיאון המלכודות | טעות נפוצה · לחזרה |
| Leaving the decks | יוצא לפנסיה | יוצא מהחזרות |
| The explanation Claude would write | שלט | הסבר |
| The quiz round's most-chosen wrong answer | המלכודת של הסבב | הטעות הנפוצה בסבב |
| The group challenge on hard topics (`?v=boss`) | קרב הבוס | אתגר קבוצתי |
| Its parts | ראש, ראשים, ראש 3/4 | נושא, נושאים, נושא 3/4 |
| Its bars and hits | HP, −20 HP לבוס, הבוס לא נפגע | ״נקודות של הקבוצה״ (70 נקודות) and ״נשאר לסגור״ (33%); after a reveal: התקדמנו ב-20% · הפעם לא התקדמנו · הקבוצה איבדה 10 נקודות |
| A topic asked again | חוזר לחיים (relapse) | חוזר |
| A topic closed | נפל, כל הראשים נפלו | נסגר, כל הנושאים נסגרו |
| Winning | הבוס הובס! | עברתם את האתגר! |
| The round after a lost one | סבב נקמה | סבב חוזר |
| Its mistakes, back in the queue | השלל שלך, מהקרב | לחזרה שלך, מהאתגר |
| Its name (SQL) | קרב הבוס · ההידרה של {קורס} | אתגר קבוצתי · {קורס} |
| A disagreement on a paragraph (`?v=dispute`) | כרטיס צהוב | מחלוקת |
| Opening one (the button beside ״לאשר״) | לא מסכימים: כרטיס צהוב | לא מסכימים |
| Claude's check of both claims | VAR | בדיקה מול השקפים (the button: ״לבדוק מול השקפים״) |
| Its outcome | פסיקה, פסיקת VAR | הכרעה, הכרעה מול השקפים |
| Pinned in the summary | הפסיקה ננעצת בסיכום | ההכרעה מוצמדת לסיכום |
| The card it may add | כרטיס מלכודת | כרטיס על הטעות |
| A slip in the slides themselves (the log) | כרטיס צהוב לשקף | טעות בשקף |
| After answering, why the choice was right or wrong | הנתיחה | ההסבר / למה מה שבחרת נכון או לא |
| A member's own question for the bank (`?v=trap`) | מלכודת משלי, מה המלכודת? | שאלה משלי, מה מבלבל בה? |
| Its chip in practice | מלכודת של חבר בקבוצה | שאלה של מישהו מהקבוצה |
| A study session (`?v=marathon`; a plan day can be 10 hours from 09:00, so not "an evening") | מרתון, מרתוני למידה, ערב למידה | מפגש למידה, מפגשי למידה |
| The plan's way to the exam | ק״מ 21 ✓, ק״מ 42: המבחן | אמצע הדרך ✓ כל הסיכומים נקראו · בסוף: המבחן (the bar: N% מהדרך למבחן) |
| A day that was not finished | יום נופל, בוחרים מחיר, המחיר הוא… | לא הספקנו את…, כדי לסיים בזמן, בוחרים אחד: · כשלא מספיקים יום, התוכנית זזה ומציעה איך להשלים |
| The group's plan to the exam (`?v=plan`) | תוכנית המרתון, מרתון · {שם} | תוכנית עד המבחן, תוכנית · {שם} |
| The member's own lane in it | המסלול שלך במרתון | המסלול שלך בתוכנית |
| Confident mistakes that come back reworded | רשימת הסכנה | טעויות ׳על בטוח׳ |
| The meeting's 3-question opening | 3 לקפה, טקסים, מבחנים קצרים | שאלות פתיחה (and the day's cap: לכל היותר שני מבחנים ביום: שאלות הפתיחה, ומבחן קבוצתי בסוף) |
| How sure an answer is (the three levels) | הימור, להמר, הימור ביטחון, ניקוד ההימור | כמה בטוחים? (ניחוש · נראה לי · על בטוח); לסמן כמה בטוחים; מה שסימנת; הניקוד שלך |
| Confident wrong answers still missing for the next common mistake | הימורי ׳על בטוח׳ שגויים | תשובות שגויות ׳על בטוח׳ |
| The progress screen's confidence block | כיול | כשסימנת ׳על בטוח׳ |
| The quiz end's hardest question | השאלה ששברה את הקבוצה | השאלה הכי קשה לקבוצה |
| Who closed a disagreement | החליט: X | הכרעה: X (like אישור: X) |
| The question bank's check (the blind solver) | פותר עיוור, הפותר העיוור, הפותר טעה | כל שאלה נפתרת שוב בלי המפתח; the chip ״הבדיקה ענתה אחרת״ |
| A topic that improved this week | החור שנסגר השבוע | השתפר השבוע |
| A flashcard (one word, feminine everywhere) | כרטיס, כרטיסים, עד 20 חדשים ביום | כרטיסייה, כרטיסיות, עד 20 כרטיסיות חדשות ביום |
| The guess's answer while following | דינג! התשובה לניחוש 1 | התשובה לניחוש 1 |
| Catching up on a missed meeting | בפרק הקודם של תמצית… | מה היה בפגישה |
| The question count chosen by number | משלי | מספר אחר (״משלי״ stays the wall's button for writing one's own) |
| The app tour | סיור באפליקציה | סיור קצר באפליקציה (one name: the offer, שלי, help and the running tour) |

### New words: courses (`sources.md`, phase 1)

Plain words for what phase 1 adds; screens and the server's own lines use
these and no other.

| Concept | Words |
|---|---|
| A course (the lectures' shared course text, now with its own page) | קורס; its page: עמוד הקורס |
| Asking about every lecture of a course | לשאול על כל הקורס |
| The cut the answer read (never "context", never "retrieval") | נבחרו 12 מתוך 340 פסקאות |
| A citation in that answer | [הרצאה 7 · ש׳ 14] (the lecture's number in the course, then the slide) |
| Several files picked at once | העלאה של כמה קבצים |
| A summary that does not fit the month's budget | יחכה לחודש הבא (several: 3 סיכומים יחכו לחודש הבא) |
| One round of questions over several lectures | סבב על כמה הרצאות (עד 5 הרצאות, לפחות 4 שאלות מכל הרצאה) |
| Two courses that are one | לאחד קורסים (never "למזג") |
| Back to a course's page | → לקורס |
| A course's link in the library and its page's head | the course's name; under it: 25 הרצאות · 5 מבחנים קודמים |
| The exam's date and what is left | המבחן ב-12.2 · עוד 23 ימים (the day itself: המבחן היום; past: המבחן היה ב-12.2) |
| The exam's length | 100 שאלות · 3 שעות |
| Practising a course's questions | לתרגל מה שכבר יש · בחינם (184) |
| The batch upload's price card | המחיר מראש · סיכומים ל-8 הרצאות: כ-$7 · נשארו החודש $24 |
| The batch's progress | קוראים קובץ 4 מתוך 14 · כדאי להשאיר את המסך פתוח |
| Coming back to a batch that stopped | הועלו 3. נשארו 11 קבצים · לבחור אותם שוב |
| A file of a batch, uploaded | ✓ הועלה (and while it waits: מחכה; while it goes: עולה…) |

### Kept, on purpose

- **״על בטוח״, ״נראה לי״, ״ניחוש״** (how sure an answer is): plain Hebrew, and Yoad's own
  word for it.
- **״כולנו נגד המבחן״ and ״מירוץ״** (the quiz's modes): Yoad's decision 2
  named them, `npm run test:bundle` holds them, and both are what a student
  would say.
- **״קיר האסוציאציות״, ״סצנה הזויה״** (the wall and its third mnemonic
  technique): a mnemonic technique, not a metaphor for an app mechanic; the
  SQL checks the technique's name in stored rows.
- **״עברנו״, ״ניצחון״, ״שיא״**: the quiz's own plain words.

## Server-made text

The SQL writes some text into rows. New rows use the new words; the file
updates old rows where only a title changes, and is still re-runnable:

| Where (section) | Was | Now | Old rows |
|---|---|---|---|
| Z 4, `study_quiz_create`, preset `coffee` | '3 לקפה' | 'שאלות פתיחה' | titles updated |
| U 4, `study_private.trap_make` (a card's back) | 'המלכודת: ' | 'טעות נפוצה: ' | U 5: the machine-made prefix of old common-mistake cards (origin 'trap', back starting 'המלכודת: ') is rewritten in place, idempotently; the rest of the card is kept |
| H 4, `study_boss_create` (the battle's name, the quiz's title) | 'ההידרה של …', 'קרב הבוס · …' | '…', 'אתגר קבוצתי · …' | names and titles updated |

## The spec's sentences, as said now

The unit tests hold help, failText and Back's words to the
spec's own sentences (and to `DECISIONS-2026-11-17.md` where a decision
reworded one). Where this copy pass rewords such a sentence, the tests read
the new wording from this table (`helpCopy.test.ts`, `failText.test.ts`,
`route.test.ts`):

| Where | The spec said (or a decision) | Now |
|---|---|---|
| §12.7.5 (quiz), the round's trap | "כרטיס מלכודת נוצר רק כשלפחות 3 בחרו באותה תשובה, ונפתח למחרת." | "כרטיסיית ׳טעות נפוצה׳ נוצרת רק כשלפחות 3 בחרו באותה תשובה, ונפתחת למחרת." |
| §12.7.5 (quiz), the race | "כשעונים פחות משלושה רואים רק כמה ענו, ומבחן של פחות משלושה לא מציג ציון לקבוצה. ב״מירוץ״ הנקודות כוללות את ההימור, וגלויות רק לשחקני המירוץ, בתוך המשחק." | "כשעונים פחות משלושה רואים רק כמה ענו, ומבחן של פחות משלושה לא מציג ציון לקבוצה. ב״מירוץ״ הנקודות כוללות את מה שסימנת, וגלויות רק לשחקני המירוץ, בתוך המשחק." |
| §12.7.5 (var) | "והספירה מוצגת אחרי שמבקשים VAR, מ-3 מגבים." | "והספירה מוצגת אחרי שמבקשים בדיקה מול השקפים, מ-3 מגבים." |
| §12.7.5 (pulse), decision 1's wording | "נספרים רק מי שהצטרפו לקבוצה לפני שבוע לפחות. אין חשבונות: כל טלפון שהצטרף הוא חבר בקבוצה, ולכן מי שהצטרפו משני טלפונים נספרים פעמיים. מי שיוצאים מהספירה לא רואים את הדופק, את המוזיאון ואת ראשי הבוס, עד הספירה הבאה שסופרת אותם." | "נספרים רק מי שהצטרפו לקבוצה לפני שבוע לפחות. אין חשבונות: כל טלפון שהצטרף הוא חבר בקבוצה, ולכן מי שהצטרפו משני טלפונים נספרים פעמיים. מי שיוצאים מהספירה לא רואים את ״מה קשה לקבוצה״, את הטעויות הנפוצות ואת הנושאים של האתגר, עד הספירה הבאה שסופרת אותם." |
| §12.7.4, `busy` (museum) | "השלט נכתב עכשיו במכשיר אחר." | "ההסבר נכתב עכשיו במכשיר אחר." |
| §12.7.4, `checked` (museum) | "למוצג הזה כבר יש שלט." | "לטעות הזו כבר יש הסבר." |
| §12.7.4, `not open` (dispute) | "הגיבוי נסגר כשביקשו VAR, או שהכרטיס הצהוב כבר נסגר. כדאי לרענן." | "הגיבוי נסגר כשביקשו בדיקה מול השקפים, או שהמחלוקת כבר נסגרה. כדאי לרענן." |
| §12.7.4, `no heads` (boss) | "הקרב נבנה מהדופק, והדופק מוצג למי שנספרים בו." | "האתגר נבנה מ״מה קשה לקבוצה״, שמוצג רק למי שנספרים בו." |
| §5.1, Back's words to a study evening | "→ למרתון" | "→ למפגש הלמידה" |

The other docs (`pulse.md`, `boss-museum.md`, `var.md`, `extras.md`,
`plan.md`, the spec and the mockups) describe how each package was built and
keep the words they were written with; on screen, this page's words win.

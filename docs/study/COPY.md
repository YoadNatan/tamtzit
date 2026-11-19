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
  error states, help, the privacy note, the guide, server-made titles and the
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
| Its bars and hits | HP, −20 HP לבוס, הבוס לא נפגע | נקודות, −20 לאתגר, האתגר לא ירד |
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
| A study evening (`?v=marathon`) | מרתון, מרתוני למידה | ערב למידה, ערבי למידה |
| The group's plan to the exam (`?v=plan`) | תוכנית המרתון, מרתון · {שם} | תוכנית עד המבחן, תוכנית · {שם} |
| The member's own lane in it | המסלול שלך במרתון | המסלול שלך בתוכנית |
| Confident mistakes that come back reworded | רשימת הסכנה | טעויות ׳על בטוח׳ |
| The meeting's 3-question opening | 3 לקפה, טקסים | שאלות פתיחה, מבחנים קצרים |

### Kept, on purpose

- **״על בטוח״, ״נראה לי״, ״ניחוש״** (the bet): plain Hebrew, and Yoad's own
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
| U 4, `study_private.trap_make` (a card's back) | 'המלכודת: ' | 'טעות נפוצה: ' | cards kept as they are (a card is the group's content and has its own history) |
| H 4, `study_boss_create` (the battle's name, the quiz's title) | 'ההידרה של …', 'קרב הבוס · …' | '…', 'אתגר קבוצתי · …' | names and titles updated |

## The spec's sentences, as said now

The unit tests hold help, the privacy note, failText and Back's words to the
spec's own sentences (and to `DECISIONS-2026-11-17.md` where a decision
reworded one). Where this copy pass rewords such a sentence, the tests read
the new wording from this table (`helpCopy.test.ts`, `failText.test.ts`,
`route.test.ts`):

| Where | The spec said (or a decision) | Now |
|---|---|---|
| §12.7.5 (quiz), the round's trap | "כרטיס מלכודת נוצר רק כשלפחות 3 בחרו באותה תשובה, ונפתח למחרת." | "כרטיס ׳טעות נפוצה׳ נוצר רק כשלפחות 3 בחרו באותה תשובה, ונפתח למחרת." |
| §12.7.5 (var) | "והספירה מוצגת אחרי שמבקשים VAR, מ-3 מגבים." | "והספירה מוצגת אחרי שמבקשים בדיקה מול השקפים, מ-3 מגבים." |
| §12.7.5 (pulse), decision 1's wording | "נספרים רק מי שהצטרפו לקבוצה לפני שבוע לפחות. אין חשבונות: כל טלפון שהצטרף הוא חבר בקבוצה, ולכן מי שהצטרפו משני טלפונים נספרים פעמיים. מי שיוצאים מהספירה לא רואים את הדופק, את המוזיאון ואת ראשי הבוס, עד הספירה הבאה שסופרת אותם." | "נספרים רק מי שהצטרפו לקבוצה לפני שבוע לפחות. אין חשבונות: כל טלפון שהצטרף הוא חבר בקבוצה, ולכן מי שהצטרפו משני טלפונים נספרים פעמיים. מי שיוצאים מהספירה לא רואים את ״מה קשה לקבוצה״, את הטעויות הנפוצות ואת הנושאים של האתגר, עד הספירה הבאה שסופרת אותם." |
| §12.7.4, `busy` (museum) | "השלט נכתב עכשיו במכשיר אחר." | "ההסבר נכתב עכשיו במכשיר אחר." |
| §12.7.4, `checked` (museum) | "למוצג הזה כבר יש שלט." | "לטעות הזו כבר יש הסבר." |
| §12.7.4, `not open` (dispute) | "הגיבוי נסגר כשביקשו VAR, או שהכרטיס הצהוב כבר נסגר. כדאי לרענן." | "הגיבוי נסגר כשביקשו בדיקה מול השקפים, או שהמחלוקת כבר נסגרה. כדאי לרענן." |
| §12.7.4, `no heads` (boss) | "הקרב נבנה מהדופק, והדופק מוצג למי שנספרים בו." | "האתגר נבנה מ״מה קשה לקבוצה״, שמוצג רק למי שנספרים בו." |
| §5.1, Back's words to a study evening | "→ למרתון" | "→ לערב הלמידה" |

The other docs (`pulse.md`, `boss-museum.md`, `var.md`, `extras.md`,
`plan.md`, the spec and the mockups) describe how each package was built and
keep the words they were written with; on screen, this page's words win.

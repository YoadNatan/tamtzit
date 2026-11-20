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
| A summary that does not fit the month's budget | on the card: 3 סיכומים יחכו לחודש הבא; on its row: הסיכום יחכה לחודש הבא (never a bare "יחכה", which reads as the file waiting) |
| One round of questions over several lectures | סבב על כמה הרצאות (עד 5 הרצאות, לפחות 4 שאלות מכל הרצאה) |
| Two courses that are one | לאחד קורסים (never "למזג") |
| Back to a course's page | → לקורס |
| A course's link in the library and its page's head | the course's name; under it: 25 הרצאות · 5 מבחנים קודמים (no past exam yet: 25 הרצאות alone; the segment says it) |
| The exam's date and what is left | המבחן ב-12.2 · עוד 23 ימים (the day itself: המבחן היום; past: המבחן היה ב-12.2) |
| The exam's length | 100 שאלות · 3 שעות |
| Practising a course's questions | לתרגל מה שכבר יש · 184 שאלות · בחינם (one: שאלה אחת); none yet: עוד אין שאלות בהרצאות של הקורס. בתרגול של כל הרצאה, ״שאלות חדשות״ כותב אותן לכל הקבוצה, מהתקציב החודשי. |
| No ready past exam yet, under the course's actions | ״סימולציה״ ו״לתרגל מבחן קודם״ נפתחים אחרי שמבחן קודם מועתק, ב״מבחנים קודמים״ למטה. |
| What each file of a batch becomes (above the files) | כל קובץ נהיה הרצאה בקורס, בשם של הקובץ ובלי מרצה ותאריך, לפי סדר השמות. את השם אי אפשר לשנות אחר כך, אז כדאי לתת לקבצים שמות ברורים לפני שבוחרים. כל הקבוצה רואה אותן בספרייה. |
| Summaries that wait for next month (the price card) | 12 סיכומים יחכו לחודש הבא. ההרצאות עצמן עולות עכשיו, והסיכומים יתחילו מה-1 בחודש, כשפותחים את הספרייה בטלפון הזה. (one: סיכום אחד יחכה…, והסיכום יתחיל…; the list of waiting summaries is kept on the phone that uploaded, and the library or the course page hands them over; the done card: הם יתחילו כשפותחים את הספרייה בטלפון הזה בחודש הבא.) |
| The batch's done card, when the phone writes the summaries | כל הרצאה מסוכמת בפעם הראשונה שפותחים אותה, בכל טלפון בקבוצה. עד אז כתוב לידה ״ממתינה לכתיבה״. |
| A lecture's status chip, waiting | ממתינה לכתיבה; queued for the server: ממתינה לשרת (a lecture: feminine) |
| A lecture row in the course page | הרצאה 2 · its date · its lecturer; no "הרצאה N" when the title has its own number ("הרצאה 3 - משתנים") |
| The course's sheet | first: מה שמשנים כאן משתנה לכל הקבוצה.; under "השם": השם משתנה בכל ההרצאות של הקורס. |
| The batch upload's price card | המחיר מראש · סיכומים ל-8 הרצאות: כ-$7 · נשארו החודש $24 |
| The batch's progress | קוראים קובץ 4 מתוך 14 · כדאי להשאיר את המסך פתוח |
| Coming back to a batch that stopped | הועלו 3. נשארו 11 קבצים, then: ההעלאה נעצרה באמצע. בוחרים שוב את אותם קבצים, ומה שכבר עלה מדלגים עליו. נשארו: … (forgetting it: לא להמשיך) |
| More files than the list shows | ועוד 7 קבצים · להראות; adding files once some are picked: להוסיף עוד |
| A picked file that cannot be uploaded, in the count | נבחרו 12 קבצים · אחד לא נתמך |
| A batch with no course yet | צריך לכתוב לאיזה קורס הקבצים שייכים. (under the field) |
| A course question before any summary | the button is off: אפשר לשאול כשיהיה סיכום ראשון. |
| A course question no paragraph matches | לא מצאנו בסיכומים של הקורס פסקה על זה. אפשר לנסח אחרת, למשל עם שם התרופה או המושג. |
| Merging, on the button | לאחד עם ״מיקרו״ (both names in ״…״ in the sentence above it) |
| A number field's hint | למשל 100 (never a bare number, which reads as a saved value) |
| A file of a batch, uploaded | ✓ הועלה (and while it waits: מחכה; while it goes: עולה…, its line: שומרים שקפים 12 מתוך 20, then השקפים נשמרו) |
| A file's line in the batch | 20 שקפים (and · PDF for a PDF; never "הרצאה" or "PowerPoint" while every file is a lecture) |

### New words: past exams (`sources.md`, phase 2)

The server's part is built (phase 2, part A); the screens use these words.
`failText.ts` has the codes' words in the area "exam".

| Concept | Words |
|---|---|
| An exam of an earlier year, uploaded by the group | מבחן קודם; several: מבחנים קודמים |
| An exam practised against one clock | סימולציה (never "מבחן לתרגול" or "מבחן לדוגמה") |
| A key the app solved and no member checked | תשובה מוצעת · לא נבדקה (never "מאומתת") |
| An item left out of a score (no key, or a suggested key it is not sure of) | לא נספרה |
| An item that needs a look (badly read, or no key) | לבדיקה |
| A key a member marked | סומנה ע״י נועה: ג׳ · לבטל |
| Copying an exam's questions | להעתיק את השאלות; while it runs: מעתיקים עמודים 9–12 מתוך 28…; before any unit reads: עמודים 1–4 בתור…; the key sheet: קוראים את דף התשובות… |
| The upload's button | להעלות ולהעתיק את השאלות · כ-$1.40 (the usual price; no sentence about where the exam goes, decision 1) |
| Above the upload's button (the price and the timing only) | before a file is picked: המחיר יופיע על הכפתור אחרי שבוחרים קובץ, ונספר בתקציב החודשי של הקבוצה.; after: המחיר נספר בתקציב החודשי של הקבוצה.; then: אפשר להתחיל עד 3 מבחנים ביום, לכל מי שבקבוצה בנפרד. ההעתקה לוקחת לרוב 10–20 דקות, ואפשר לסגור את הטלפון אחרי שכל הדפים עלו. (no server writer: …10–20 דקות.) |
| Where the answers are, each with its hint | מסומנות במבחן: התשובה מוקפת או מסומנת על הדף.; בקובץ נפרד: דף תשובות בקובץ או בתמונות משלו.; אין תשובות: האפליקציה תציע תשובות, ויהיה כתוב לידן ״תשובה מוצעת · לא נבדקה״. לכן זה עולה קצת יותר. |
| An item's answer, under its actions (the review) | a suggested one: האפליקציה הציעה את התשובה המסומנת ״מוצעת״. ״לאשר״ או ״לסמן תשובה אחרת״ משנים אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל.; else: סימון תשובה משנה אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל. On the key option, seen: מוצעת (a suggested key) or מסומנת (a keyed one). The answer picker closes with סגירה (never ביטול beside the undo's לבטל). A confirmed key: אושרה ע״י נועה: א׳ · לבטל (a marked one: סומנה ע״י…). |
| Under "לתרגל את המבחן" when items have no answer | 6 שאלות בלי תשובה לא נכנסות לתרגול עד שמסמנים להן תשובה. (one: שאלה אחת בלי תשובה לא נכנסת…) |
| Picking another answer | בוחרים את התשובה הנכונה. היא תשתנה לכל הקבוצה: |
| Reading pages again (its cost) | קריאה חוזרת נספרת בתקציב החודשי של הקבוצה, עד 3 פעמים ביום לכל מבחן. אם רק מילה שגויה, ״לתקן טקסט״ בחינם. (under a unit that failed: the first sentence) |
| The reading, "כשזה נגמר" | לרוב 10–20 דקות. בסוף יופיע כאן כמה שאלות נמצאו, והמבחן יופיע לכל הקבוצה בעמוד הקורס, לבדיקה ולתרגול. |
| The simulation's setup, under the lengths | שעון אחד לכל הסימולציה. הוא מתחיל ב״להתחיל״, ממשיך גם כשיוצאים או נועלים את הטלפון, וכשהזמן נגמר היא מוגשת לבד. התשובות נבדקות רק בסוף. בחינם, והציון רק לך. |
| Leaving a running simulation | the toast on "→ יציאה": השעון ממשיך. חוזרים מ״סימולציה״ בעמוד הקורס.; in the question map: יוצאים באמצע? השעון ממשיך. חוזרים מ״סימולציה״ בעמוד הקורס. |
| Pages that were not read | עמודים 13–16 לא נקראו · לנסות שוב; one page: לקרוא שוב את עמוד 7 |
| What was found | נמצאו 98 שאלות · 91 עם תשובה · 7 לבדיקה; open questions: 2 שאלות פתוחות דולגו. |
| A number another page already had (not saved) | 3 שאלות לא נשמרו: המספר שלהן כבר הופיע בעמוד אחר. (one: שאלה אחת לא נשמרה: …) |
| A question the key sheet cancelled | 2 שאלות בוטלו לפי דף התשובות, ולא נכללות. (one: שאלה אחת בוטלה …, ולא נכללת.) |
| A key sheet with a column per version | בדף התשובות יש כמה נוסחים של המבחן, ולא ברור איזה מהם שלו. אפשר לסמן את התשובות ביד. |
| Who uploaded an exam | הועלה ע״י נועה |
| The upload's pages as pictures | לצלם דפים (the camera or the phone's photos); the button: + להוסיף דפים, then + להוסיף עוד; the strip's arrows: → earlier, ← later |
| The key sheet apart | דף התשובות: לבחור את דף התשובות; chosen again: קובץ אחר / תמונות אחרות; להסיר |
| The year of an exam (needed) | צריך לכתוב את השנה של המבחן, למשל 2025. (no greyed year in the field: it reads as filled) |
| A page beside an item, opened whole | לפתוח את העמוד כולו (the picture's name for a screen reader) |
| A badly read item | לא נקראה טוב · לתקן טקסט |
| Leaving an exam out of the course's picture | לא לכלול בחישוב הנושאים; under it: המבחן נשאר לתרגול. לכל הקבוצה: הוא לא ייכנס לחישוב הנושאים של הקורס, ולא ישמש כדוגמה לסגנון של שאלות חדשות. |
| The limit of a day | אפשר להתחיל עד 3 מבחנים ביום. מתחדש בחצות. |
| Back to one past exam | → למבחן |
| Back to the simulation's setup | → לסימולציה |
| Practising one past exam | לתרגל את המבחן (its own order, its options as printed); from the course page: לתרגל מבחן קודם |
| The simulation's lengths, short first | קצר · 20 שאלות · 36 דקות; חצי · 50 שאלות; מלא (the whole exam) |
| Under the lengths, when the whole simulation's minutes are not the exam's | 26 דקות למלא: הקצב של המבחן, בלי 2 השאלות שלא נכנסו לסימולציה. (one: בלי השאלה שלא נכנסה…) |
| Questions not seen yet first | קודם שאלות שעוד לא ראיתי (on by default; never "רק": the setup fills with seen ones when the unseen run out; not offered for the whole exam) |
| The simulation's clock | נשארו 1:42:10 (one clock for the whole simulation; it goes on while the phone is locked) |
| Where the student is | שאלה 37 מתוך 100; the result numbers its rows the same way, the exam's own number beside: שאלה 37 במבחן |
| Coming back to a question | לסמן לחזרה; once marked: מסומנת לחזרה |
| Every question at a glance | מפת השאלות: ענית · לחזרה · בלי תשובה |
| Submitting | להגיש; before it: להגיש עכשיו? נשארו 6 שאלות בלי תשובה. |
| Submitted by the clock | הזמן נגמר, והסימולציה הוגשה. |
| The result | 71 מתוך 97 נכונות (with items not counted: נכונות, מהשאלות שנספרו); 3 לא נספרו: אין להן תשובה בטוחה · 3 מה-97 נבדקו מול תשובה מוצעת (one: שאלה אחת לא נספרה: אין לה תשובה בטוחה; אחת מה-97 נבדקה…), and under it: תשובה מוצעת: האפליקציה פתרה, ועוד לא אישרו אותה בקבוצה.; over the items not counted: לשאלות האלה אין תשובה בטוחה, אז הן לא בציון. תשובה שמאשרים בעמוד המבחן תיספר בסימולציה הבאה.; the time in words: זמן: 12 דקות מתוך 36 דקות, זמן: שעתיים ו-41 דקות מתוך 3 שעות, זמן: פחות מדקה מתוך 30 דקות (never "0:01" beside "דקות") |
| A mistake in the result | בחרת א׳, הנכונה ג׳; a blank: לא ענית. הנכונה ג׳; a suggested key: בחרת ב׳, המוצעת א׳ · לא ענית. המוצעת א׳, and on its option: · התשובה המוצעת (never ✓ הנכונה) |
| Practising a simulation's mistakes | רק הטעויות; the session's title: הטעויות מהסימולציה |
| A simulation left open | יש סימולציה שעוד לא הוגשה · להמשיך |
| Confirming a suggested key | לאשר; another: לסמן תשובה אחרת; none yet: לסמן תשובה; done: התשובה ג׳ אושרה. (a true/false or match item: התשובה המוצעת אושרה.) |
| A true/false or match item without a key | בשאלת נכון או לא נכון ובשאלת התאמה עוד אי אפשר לסמן תשובה ביד. |
| An undo the key moved past | התשובה השתנתה מאז, אז אי אפשר לבטל. אפשר לסמן את התשובה הנכונה. |
| A change of a key in the log | נועה: ג׳ במקום א׳ · נועה: אישור של ב׳ · נועה: אישור התשובה המוצעת · נועה: ביטול (חזרה לתשובה המוצעת) (no gendered verbs; no name kept: מהקבוצה) |
| The reading while the server works | אפשר לסגור את הטלפון. ההעתקה ממשיכה בלעדיו. |
| The reading when the phone copies (no server writer) | הטלפון מעתיק את הדפים. כדאי להשאיר את המסך פתוח. |

### New words: answering the question types (`question-types.md`)

| Concept | Words |
|---|---|
| נכון / לא נכון, until every row is marked | מסמנים כל משפט: נכון או לא נכון. ״לבדוק״ נפתח כשכולם מסומנים. (in a simulation, which checks at the end: the first sentence) |
| סידור | נוגעים בשלבים לפי הסדר, מהראשון לאחרון. ↑ ↓ מזיזים, ✕ מחזיר. (it stays while ordering; "השלבים" goes once every step is placed) |
| התאמה | נוגעים במקום ואז בתשובה, או בתשובה ואז במקום.; then: עכשיו נוגעים במקום. / עכשיו נוגעים בתשובה. (never "לגעת…") |
| A staged case's story so far | המקרה עד כאן; folded: המקרה עד כאן (להראות), with a chevron |

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

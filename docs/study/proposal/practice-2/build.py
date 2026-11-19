"""Practice 2.0: a proposal page after Yoad's feedback on release 1.
Usage: python3 -I build.py <proposal dir> <q2 dir> <out.html>"""
import html
import re
import sys

base, q2, out_path = sys.argv[1:4]
kit = open(base + "/kit.css", encoding="utf8").read()
sprite = open(base + "/parts/sprite.html", encoding="utf8").read()
build_src = open(base + "/build.py", encoding="utf8").read()
extra_css = re.search(r'extra_css = """(.*?)"""', build_src, re.S).group(1)
mocks = open(q2 + "/mockups.html", encoding="utf8").read()
approved = open(base + "/mockups/practice.html", encoding="utf8").read()
approved_q = approved.split("</figure>")[0] + "</figure>"

_W = r"[A-Za-z0-9\-+/'’½_=]*(?:\([A-Za-z0-9+\-]+\))?"
LATIN = re.compile(r"([A-Za-z]" + _W + r"(?:(?:\.?[ ]|[ ]?→[ ]?|[ ]&[ ]|,[ ](?=[A-Z][a-z]+(?:,[ ][A-Z][a-z]+)*[ ]&[ ]))(?=[A-Za-z0-9])[A-Za-z0-9]" + _W + r")*)")
MONEY = re.compile(r"(\$\d+(?:[.,]\d+)*(?:[–-]\d+(?:[.,]\d+)*)?|(?<![\w/])[+−]?\d+(?:\.\d+)?(?:/[+−]?\d+(?:\.\d+)?)+|(?<![\w/])[+−]\d+(?:\.\d+)?|(?<![\w/.])\d+(?:\.\d+)?–\d+(?:\.\d+)?%?)")


def t(s):
    s = str(s or "")
    s = re.sub(r'([?!.])(׳)', '\\1\u2060\\2', s)
    out, last = [], 0
    for m in LATIN.finditer(s):
        out.append(html.escape(s[last:m.start()], quote=False))
        out.append('<bdi dir="ltr">' + html.escape(m.group(1), quote=False) + "</bdi>")
        last = m.end()
    out.append(html.escape(s[last:], quote=False))
    return MONEY.sub(r'<bdi dir="ltr" class="nw">\1</bdi>', "".join(out))


WRONG = [
    ("אין בחירה", "יש כפתור אחד, ׳ליצור׳. אי אפשר לבחור כמה שאלות, על אילו חלקים, באיזה סגנון או באיזו רמה, ואי אפשר לתת דוגמה."),
    ("הכמות לפי שקפים", "הכלל היום הוא בערך שאלה לכל 2.5 שקפים, ולפחות 6. לכן הרצאה קצרה מקבלת 6, גם כשיש בה הרבה מה לדעת."),
    ("המראה לא מה שאושר", "המסכים שעלו נבנו לפי המפרט הטכני שנכתב לפני ההצעה. חסרים בהם הימור הביטחון, סדר ההסברים, ׳מתי כן׳ ו׳לפסקה׳, והם לא נראים כמו המסכים שאישרת."),
]

REFS = [
    ("NotebookLM", "https://9to5google.com/2025/09/08/notebooklm-flashcards-quizzes/",
     "ביצירת מבחן: כמה שאלות (פחות · רגיל · יותר), רמה (קל · בינוני · קשה), שדה ׳על מה להתמקד׳, ובחירה מאילו מקורות.",
     "שלוש רמות כמות, רמה, ושדה מיקוד."),
    ("AMBOSS", "https://support.amboss.com/hc/en-us/articles/360032477132",
     "בונים סבב תרגול עם מסננים: נושא, רמה, ומצב השאלה (עוד לא נענו, טעויות, מסומנות), מספר שאלות, ומצב לימוד או מבחן.",
     "המסך ׳סבב חדש׳: מאיפה, על מה, כמה, ותרגול או מבחן."),
    ("Quizgecko", "https://www.scriptbyai.com/best-free-ai-quiz-generators/",
     "סוגי שאלות, רמות קושי או רמה שנקבעת לפי מורכבות החומר, מסיחים שנשמעים נכונים, ושאלות בסגנון של מבחן.",
     "סגנונות לבחירה, ׳כמו במבחן׳, ודוגמה לסגנון."),
]

COUNT = [
    ("ממוקד", "רק הנקודות החשובות ביותר: דגלים אדומים, התוויות נגד, תרופות לבחירה", "בערך שאלה ל-4 נקודות", "12", "כ-$0.30"),
    ("מלא", "כל נקודה שצריך לדעת מופיעה לפחות פעם", "בערך שאלה ל-2 נקודות", "24", "כ-$0.60"),
    ("מקיף", "כל נקודה מכמה כיוונים: מקרה, מנגנון, השוואה", "בערך שאלה לנקודה", "40", "כ-$1.00"),
    ("משלי", "מספר שבוחרים", "", "…", "לפי המספר"),
]

ORDER = [
    ("מראה אחד לכל האפליקציה", "העיצוב של המסכים שאישרת הופך לעיצוב של האפליקציה עצמה: גופנים, כרטיסים, צ׳יפים, כותרות ולשוניות. התרגול והכרטיסיות שכבר עלו עוברים אליו, כולל הימור הביטחון, סדר ההסברים, ׳מתי כן׳ ו׳לפסקה׳."),
    ("יצירת שאלות חדשה", "ארבעת המסכים כאן: מה ליצור, דוגמה ומיקוד, הבנק נבנה עם בדיקה של כל שאלה, וסבב חדש. הכמות נקבעת לפי הנקודות שצריך לדעת, לא לפי מספר השקפים."),
    ("המבחן הקבוצתי וכתיבה בשרת", "שניהם כבר בבנייה. המבחן ייצא ישר במראה החדש."),
]

DECISIONS = [
    ("ברירת המחדל לכמות", "׳מלא׳: כל נקודה לפחות פעם. ב-20 הרצאות בחודש זה כ-$12 במחיר מלא (היום כ-$7.60), וחצי מזה במצב החסכוני."),
    ("מי יוצר שאלות", "כל אחד בקבוצה, והבנק משותף. מי שיוצר רואה את הבנק נבנה ומאשר; לכל השאר הוא פשוט מופיע."),
    ("לעבור על השאלות לפני שהן נכנסות?", "כן, עם כפתור ׳להוסיף הכול׳ למי שלא רוצה לעבור אחת אחת. שאלה שהפותר העיוור טעה בה נכתבת מחדש אוטומטית."),
]

CSS = """
.wrong { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.card h3 { margin: 0; font-family: var(--font-display); font-size: 1.08rem; }
.card p { margin: 0; line-height: 1.6; }
.card .take { font-size: 0.92rem; border-inline-start: 3px solid var(--accent); padding-inline-start: 10px; }
.pair { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; justify-content: flex-start; }
.shot { margin: 0; display: grid; gap: 8px; width: min(282px, 100%); }
.shot img { width: 100%; height: auto; border-radius: 30px; border: 9px solid var(--bezel); max-width: 100%; box-shadow: var(--shadow); }
.shot figcaption { font-size: 0.88rem; color: var(--muted); line-height: 1.5; }
.tag-now { display: inline-block; font-size: 0.78rem; font-weight: 800; padding: 1px 9px; border-radius: 999px; background: var(--warn-bg); border: 1px solid var(--warn-line); }
.tag-ok { display: inline-block; font-size: 0.78rem; font-weight: 800; padding: 1px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.steps3 { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 860px; counter-reset: s; }
.steps3 li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; counter-increment: s; }
.steps3 li::before { content: counter(s); width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--accent); color: var(--accent-ink); }
.steps3 h3 { margin: 0 0 3px; font-family: var(--font-display); font-size: 1.04rem; }
.steps3 p { margin: 0; }
.feat-phones.wrapgrid { display: flex; flex-wrap: wrap; gap: 22px; }
"""


def wrong():
    return "\n".join(f'<li class="card"><h3>{t(h)}</h3><p>{t(b)}</p></li>' for h, b in WRONG)


def refs():
    return "\n".join(f'<article class="card"><h3><a href="{u}" target="_blank" rel="noopener"><bdi dir="ltr">{html.escape(n)}</bdi></a></h3><p>{t(what)}</p><p class="take"><b>מה לוקחים:</b> {t(take)}</p></article>' for n, u, what, take in REFS)


def count_rows():
    return "\n".join(f'<tr><td><b>{t(a)}</b></td><td>{t(b)}{(" (" + t(c) + ")") if c else ""}</td><td class="num">{t(d)}</td><td class="num">{t(e)}</td></tr>' for a, b, c, d, e in COUNT)


def order():
    return "\n".join(f"<li><div><h3>{t(h)}</h3><p>{t(b)}</p></div></li>" for h, b in ORDER)


def decisions():
    return "\n".join(f'<li class="decision"><div class="dec-head"><span class="dec-n">{i}</span><b>{t(q)}</b><span class="badge">יועד</span></div><p class="def">ההמלצה: {t(d)}</p></li>' for i, (q, d) in enumerate(DECISIONS, 1))


page = f"""<title>תרגול 2.0</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap">
<style>
{kit}
{extra_css}
{CSS}
</style>
{sprite}
<div class="page" dir="rtl" lang="he">
  <nav class="topnav" aria-label="ניווט בעמוד">
    <a href="#wrong">מה לא עבד</a><a href="#refs">איך אחרים עושים</a><a href="#screens">המסכים</a><a href="#count">הכמות</a><a href="#look">המראה</a><a href="#order">הסדר</a><a href="#decisions">החלטות</a>
  </nav>

  <header class="hero" id="top">
    <span class="kicker">הצעה לפני בנייה · אחרי המשוב על שחרור 1</span>
    <h1>תרגול 2.0</h1>
    <p class="lead">יצירת שאלות שאפשר לשלוט בה, כמות שנקבעת לפי החומר, ומראה שתואם את המסכים שאישרת. שום דבר מזה לא נבנה עדיין: מחכה לאישור שלך.</p>
  </header>

  <section class="block" id="wrong">
    <header><span class="eyebrow">המשוב שלך</span><h2>מה לא עבד בשחרור 1</h2></header>
    <ul class="wrong">
{wrong()}
    </ul>
    <div class="pair">
      <figure class="shot"><img src="img/now-sheet.jpg" width="390" height="844" alt="מסך יצירת השאלות היום"><figcaption><span class="tag-now">היום</span> יצירת שאלות: כפתור אחד, בלי שום בחירה.</figcaption></figure>
      <figure class="shot"><img src="img/now-question.jpg" width="390" height="844" alt="מסך שאלה היום"><figcaption><span class="tag-now">היום</span> שאלה: בלי הימור, בלי סדר ההסברים שאושר.</figcaption></figure>
    </div>
  </section>

  <section class="block" id="refs">
    <header><span class="eyebrow">השראה</span><h2>איך אפליקציות אחרות עושות את זה טוב</h2></header>
    <div class="wrong">
{refs()}
    </div>
  </section>

  <section class="block" id="screens">
    <header><span class="eyebrow">המסכים המוצעים</span><h2>ארבעה מסכים: מה ליצור, דוגמה ומיקוד, הבנק נבנה, סבב חדש</h2>
    <p>{t("המספרים במסכים הם דוגמה על ההרצאה על תרופות נגד טפילים.")}</p></header>
    <div class="feat-phones wrapgrid">
{mocks}
    </div>
  </section>

  <section class="block" id="count">
    <header><span class="eyebrow">כמה שאלות</span><h2>הכמות לפי מה שצריך לדעת, לא לפי מספר השקפים</h2>
    <p>{t("קודם מחלצים מהסיכום את הנקודות שצריך לדעת: תרופה, מנגנון, התוויה, תופעת לוואי, התוויית נגד, ומספר שכדאי לזכור. הכמות נגזרת מהן. בהרצאה לדוגמה יש 46 נקודות.")}</p></header>
    <div class="table-wrap"><table class="budget">
      <thead><tr><th>רמה</th><th>מה נכנס</th><th>בדוגמה</th><th>עלות</th></tr></thead>
      <tbody>
{count_rows()}
      </tbody>
    </table></div>
    <p class="muted">{t("העלויות במחיר מלא. במצב החסכוני (Batch API) בערך חצי. כל שאלה כוללת בדיקה של פותר עיוור, שעונה בלי לראות את המפתח כדי לתפוס מפתח שגוי.")}</p>
  </section>

  <section class="block" id="look">
    <header><span class="eyebrow">המראה</span><h2>מה עלה, מול מה שאישרת</h2>
    <p>קודם המסך שעלה, ואחריו המסך שאושר בהצעה. התרגול והכרטיסיות יעברו למראה המאושר, וכל מסך חדש ייבנה בו.</p></header>
    <div class="pair">
      <figure class="shot"><img src="img/now-question.jpg" width="390" height="844" alt="השאלה שעלתה"><figcaption><span class="tag-now">עלה</span> שאלה בשחרור 1.</figcaption></figure>
      <div class="feat-phones">{approved_q}</div>
    </div>
  </section>

  <section class="block" id="order">
    <header><span class="eyebrow">מה ייבנה</span><h2>בסדר הזה</h2></header>
    <ol class="steps3">
{order()}
    </ol>
  </section>

  <section class="block" id="decisions">
    <header><span class="eyebrow">רק אתה יכול להחליט</span><h2>שלוש החלטות קטנות</h2>
    <p>אם ההמלצות מתאימות, מספיק לכתוב ׳מאשר׳ בצ׳אט. אם לא, לכתוב מה לשנות.</p></header>
    <ul class="decisions">
{decisions()}
    </ul>
  </section>
</div>
"""
open(out_path, "w", encoding="utf8").write(page)
print("wrote", out_path, len(page.encode("utf8")))

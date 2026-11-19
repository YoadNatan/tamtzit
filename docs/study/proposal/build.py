"""Assemble the proposal page from concept.json + mockup fragments.

Usage: python3 -I build.py <proposal dir> <concept.json> <out.html>
Mockups: <proposal dir>/mockups/<feature id>.html (one or more <figure class="mock">).
"""
import html
import json
import os
import re
import sys

base, concept_path, out_path = sys.argv[1:4]
C = json.load(open(concept_path, encoding="utf8"))
kit = open(os.path.join(base, "kit.css"), encoding="utf8").read()
sprite = open(os.path.join(base, "parts", "sprite.html"), encoding="utf8").read()
script = open(os.path.join(base, "parts", "script.html"), encoding="utf8").read()

_W = r"[A-Za-z0-9\-+/'’½_=]*(?:\([A-Za-z0-9+\-]+\))?"
LATIN = re.compile(r"([A-Za-z]" + _W + r"(?:(?:\.?[ ]|[ ]?→[ ]?|[ ]&[ ]|,[ ](?=[A-Z][a-z]+(?:,[ ][A-Z][a-z]+)*[ ]&[ ]))(?=[A-Za-z0-9])[A-Za-z0-9]" + _W + r")*)")


# dollar amounts and ranges ($1–3), signed scores (+3, −6) and slashed sequences (+1/+2/+3, 4/15)
MONEY = re.compile(r"(\$\d+(?:[.,]\d+)*(?:[–-]\d+(?:[.,]\d+)*)?|(?<![\w/])[+−]?\d+(?:\.\d+)?(?:/[+−]?\d+(?:\.\d+)?)+|(?<![\w/])[+−]\d+(?:\.\d+)?|(?<![\w/.])\d+(?:\.\d+)?–\d+(?:\.\d+)?%?)")


def t(s):
    """Isolate English runs (so they never flip Hebrew punctuation), escaping each piece."""
    s = str(s or "")
    s = re.sub(r'([?!.])(׳)', '\\1\u2060\\2', s)
    out, last = [], 0
    for m in LATIN.finditer(s):
        out.append(html.escape(s[last:m.start()], quote=False))
        out.append('<bdi dir="ltr">' + html.escape(m.group(1), quote=False) + "</bdi>")
        last = m.end()
    out.append(html.escape(s[last:], quote=False))
    return MONEY.sub(r'<bdi dir="ltr" class="nw">\1</bdi>', "".join(out))


GROUPS = [
    ("personal", "me", "לימוד אישי", "מה שכל אחד עושה לבד, בקצב שלו. הציונים והטעויות נראים רק לך."),
    ("group", "group", "לימוד קבוצתי", "מה שקורה כשהקבוצה יחד: בפגישה היומית ובין הפגישות."),
    ("bridge", "me", "הגשרים", "איך מה שהקבוצה מייצרת מזין את הלימוד האישי, ומה שכל אחד מגלה חוזר לקבוצה."),
    ("fun", "fun", "שכבת הכיף", "דברים מצחיקים ויצירתיים שעוזרים לזכור, ושאנשים מעלים בעצמם."),
]
PHASE = {1: "שלב 1", 2: "שלב 2", 3: "שלב 3"}
EFFORT = {"S": "קטן", "M": "בינוני", "L": "גדול"}

feats = C.get("features", [])


def mockups(fid):
    p = os.path.join(base, "mockups", f"{fid}.html")
    if os.path.exists(p):
        return open(p, encoding="utf8").read()
    return '<p class="muted">המסכים לפיצ׳ר הזה בהכנה.</p>'


def vote(fid, name):
    n = html.escape(name)
    return f"""<div class="vote" data-feature="{fid}">
  <span class="vote-q">מה עושים עם זה?</span>
  <div class="vote-opts" role="group" aria-label="הצבעה: {n}">
    <button type="button" data-v="build" aria-pressed="false">לבנות</button>
    <button type="button" data-v="talk" aria-pressed="false">לדבר על זה</button>
    <button type="button" data-v="skip" aria-pressed="false">לא עכשיו</button>
  </div>
  <p class="vote-msg"></p>
  <textarea id="note-{fid}" rows="1" placeholder="הערה (לא חובה)" aria-label="הערה: {n}"></textarea>
  <div class="vote-tally" aria-live="polite"></div>
</div>"""


def feature(f):
    fid = f["id"]
    g = f.get("group", "personal")
    lane = {"personal": "me", "group": "group", "bridge": "me", "fun": "fun"}.get(g, "me")
    badges = [f'<span class="badge {lane}">{t(dict((k, v) for k, _, v, _ in GROUPS).get(g, g))}</span>']
    badges.append(f'<span class="badge">{PHASE.get(f.get("phase"), "")}</span>')
    if f.get("effort"):
        badges.append(f'<span class="badge">מאמץ {EFFORT.get(f["effort"], f["effort"])}</span>')
    if f.get("depends_he"):
        badges.append(f'<span class="badge">{t(f["depends_he"])}</span>')
    covers = f.get("covers_he") or ""
    if covers and covers.strip() not in ("חדש", "new"):
        asked = f'<p class="asked">ביקשה שוהם: <q>{t(covers)}</q></p>'
    else:
        badges.append('<span class="badge new">רעיון חדש</span>')
        asked = ""
    con = f.get("connects_he") or {}
    facts = [("למה זה חשוב", t(f.get("why_he", "")), "")]
    if con.get("group_to_personal"):
        facts.append(("מהקבוצה לאישי", t(con["group_to_personal"]), "to-me"))
    if con.get("personal_to_group"):
        facts.append(("מהאישי לקבוצה", t(con["personal_to_group"]), "to-group"))
    if f.get("ai_cost_he"):
        facts.append(("עלות AI", t(f["ai_cost_he"]), ""))
    if f.get("later_he"):
        facts.append(("מה נכנס מתי", t(f["later_he"]), ""))
    facts_html = "".join(f'<li><span class="{c}">{k}</span><span>{v}</span></li>' for k, v, c in facts)
    phones = mockups(fid)
    stack = " stack" if phones.count("<figure") >= 3 else ""
    return f"""<article class="feat{stack}" id="f-{fid}">
  <div class="feat-text">
    <div class="badges">{''.join(badges)}</div>
    <h4>{t(f.get('name_he', fid))}</h4>
    <p class="tagline">{t(f.get('tagline_he', ''))}</p>
    <ul class="facts">{facts_html}</ul>
    {asked}
  </div>
  <div class="feat-phones">{phones}</div>
  {vote(fid, f.get('name_he', fid))}
</article>"""


def loop_section():
    steps = C.get("loop", [])
    rows = []
    prev = None
    for i, s in enumerate(steps, 1):
        where = s.get("where", "both")
        if prev and where != prev and "both" not in (where, prev):
            label = "מהקבוצה לאישי" if where == "personal" else "מהאישי לקבוצה"
            cls = "down" if where == "personal" else "up"
            rows.append(f'<div class="loop-bridge"><span class="bridge {cls}">{label}</span></div>')
        col = {"group": "g", "personal": "p", "both": "b"}.get(where, "b")
        rows.append(
            f'<div class="loop-step {col}"><span class="n">{i}</span><div><b>{t(s.get("step_he", ""))}</b>'
            f'<p>{t(s.get("detail_he", ""))}</p></div></div>'
        )
        prev = where
    return f"""<div class="swim">
  <div class="swim-head"><span class="lane-tag group">קבוצה</span><span class="lane-tag me">אישי</span></div>
  {''.join(rows)}
</div>"""


groups_html = []
for key, lane, title, blurb in GROUPS:
    items = [f for f in feats if f.get("group") == key]
    if not items:
        continue
    items.sort(key=lambda f: (f.get("phase", 9), f.get("name_he", "")))
    groups_html.append(
        f'<div class="group-head" id="g-{key}"><span class="eyebrow {lane}">{len(items)} פיצ׳רים</span><h3>{title}</h3><p class="muted">{blurb}</p></div>'
        + "".join(feature(f) for f in items)
    )

NAME = {f["id"]: f.get("name_he", f["id"]) for f in feats}
phases_html = []
for ph in C.get("phases", []):
    blocked = bool(ph.get("blocked"))
    title = "מחכה" if blocked else PHASE.get(ph.get("phase"), "")
    lis = "".join(f'<li><a href="#f-{fid}">{t(NAME.get(fid, fid))}</a></li>' for fid in ph.get("features", []))
    phases_html.append(
        f'<div class="phase{" blocked" if blocked else ""}"><h3>{title}</h3><span class="when">{t(ph.get("when_he"))}</span>'
        f'<p>{t(ph.get("goal_he"))}</p>' + (f"<ul>{lis}</ul>" if lis else "") + "</div>"
    )
WHERE = {"group": ("group", "של הקבוצה"), "personal": ("me", "רק שלך"), "both": ("both", "גם וגם")}
objects_html = "".join(
    f'<li class="obj {WHERE.get(o.get("where"), ("both", ""))[0]}"><b>{t(o.get("name_he"))}</b>'
    f'<span class="where">{WHERE.get(o.get("where"), ("", ""))[1]}</span><span>{t(o.get("rule_he"))}</span></li>'
    for o in C.get("objects", [])
)
BUDGET = [
    ("סיכומים, 20 הרצאות (קיים היום)", "$20", "$20"),
    ("בנקי שאלות, 20 × ($0.28 + בדיקה $0.10)", "$7.60", "כ-$3.80"),
    ("חפיסות כרטיסיות, 20 × $0.21", "$4.20", "כ-$2.10"),
    ("טיוטות אסוציאציה ובדיקות", "$1–3", "$1–3"),
    ("׳לשאול׳: 6 אנשים × 15 שאלות", "כ-$3", "כ-$3"),
    ("VAR, כ-20 מחלוקות", "כ-$1.60", "כ-$1.60"),
    ("הערות מהקלטה, 8 × $0.87 (רק בלחיצה)", "כ-$7", "כ-$7"),
    ("מבחן קבוצתי, הפגישה, עוגן הפסקה, היום, התקדמות, דופק, תוכנית, מוזיאון, בוס (בלי תוספות רשות)", "$0", "$0"),
]
BUDGET_NOTE = "לכן: שאלות וכרטיסיות נכתבות במצב חסכוני (Batch API: חצי מחיר, והתוצאה מגיעה באיחור, לרוב תוך שעה ולכל היותר תוך יממה), אבל רק כשהכתיבה בשרת פועלת; עד אז מחיר מלא, כ-$39 בחודש גם בלי הקלטות. הערות מהקלטה רק בלחיצה אחרי הערכת עלות, וכל פיצ׳ר בודק את אותה תקרה. כשמגיעים לתקרה, כתיבה חדשה נעצרת עד תחילת החודש הבא, גם של סיכומים."
BUDGET_REC = "הקלטות: בלי הקלטות כבר מגיעים לכ-$33, וכל הקלטה מוסיפה כ-$0.87 במצב החסכוני. לכן ₪25 לאדם (כ-$41) מכסה כ-8 הקלטות בחודש, והקלטה של כמעט כל הרצאה (כ-$50) דורשת כ-₪30 לאדם או קיצוב הערות (החלטה 4)."
budget_rows = "".join(f'<tr><td>{t(a)}</td><td class="num">{t(b_)}</td><td class="num">{t(c)}</td></tr>' for a, b_, c in BUDGET)

cut_html = "".join(
    f'<li class="cut"><b>{t(c.get("name_he"))}</b><span class="muted">{t(c.get("reason_he"))}</span></li>' for c in C.get("cut", [])
)
dec_html = "".join(
    f'<li class="decision"><div class="dec-head"><span class="dec-n">{i}</span><b>{t(d.get("q_he"))}</b>'
    f'<span class="badge">{t(d.get("who_he", ""))}</span></div>'
    f'<span class="def">ההמלצה: <b>{t(d.get("default_he"))}</b></span></li>'
    for i, d in enumerate(C.get("decisions", []), 1)
)
nav_html = "".join(
    f'<div class="navtab"><svg width="20" height="20"><use href="#i-{html.escape(n.get("icon", "home"))}"/></svg><b>{t(n.get("tab_he"))}</b><span class="muted">{t(n.get("contains_he"))}</span></div>'
    for n in C.get("nav", [])
)
day = C.get("day", [])
day_html = "".join(
    f'<div class="moment"><span class="where {"group" if d.get("where") == "group" else "me"}">{t(d.get("where_he", ""))}</span><span class="when">{t(d.get("when_he"))}</span><ul>'
    + "".join(f"<li>{t(x)}</li>" for x in d.get("items_he", []))
    + "</ul></div>"
    for d in day
)

day_section = (
    '<section class="block" id="day"><header><span class="eyebrow">בפועל</span><h2>יום אחד עם תמצית</h2></header>'
    f'<div class="day">{day_html}</div></section>'
    if day_html
    else ""
)

extra_css = """
.swim { display: grid; gap: 8px; max-width: 860px; }
.swim-head { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; position: sticky; top: calc(env(safe-area-inset-top, 0px) + 52px); z-index: 2; background: var(--paper); padding-block: 4px; }
.lane-tag { font-family: var(--font-display); font-weight: 900; font-size: 1.1rem; padding: 6px 12px; border-radius: 10px; text-align: center; }
.lane-tag.group { color: var(--group); background: var(--group-soft); }
.lane-tag.me { color: var(--me); background: var(--me-soft); }
.loop-step { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: start; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); width: calc(50% - 5px); }
.loop-step p { color: var(--muted); font-size: 0.93rem; }
.loop-step .n { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: var(--accent-ink); background: var(--faint); }
.loop-step.g { justify-self: start; border-top: 3px solid var(--group); }
.loop-step.g .n { background: var(--group); }
.loop-step.p { justify-self: end; border-top: 3px solid var(--me); }
.loop-step.p .n { background: var(--me); }
.loop-step.b { width: 100%; border-top: 3px solid var(--fun); background: linear-gradient(90deg, var(--me-soft), var(--surface) 40%, var(--surface) 60%, var(--group-soft)); }
.loop-step.b .n { background: var(--fun); }
.loop-bridge { display: grid; justify-items: center; }
@media (max-width: 560px) { .loop-step { width: 88%; } }
.navtabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.navtab { display: grid; gap: 4px; align-content: start; padding: 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); color: var(--accent); }
.navtab b { color: var(--ink); }
.navtab .muted { font-size: 0.88rem; }
.day { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.feat.stack { grid-template-columns: minmax(0, 1fr); }
.feat.stack .feat-text { max-width: 760px; }
.feat.stack .feat-phones { justify-content: flex-start; }
@media (max-width: 900px) { .day { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .day { grid-template-columns: minmax(0, 1fr); } }
.phases { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.phase p { font-size: 0.93rem; }
.phase.blocked { border-style: dashed; background: transparent; }
.objs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }
.obj { display: grid; gap: 4px; align-content: start; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); font-size: 0.93rem; }
.obj b { font-family: var(--font-display); font-size: 1.15rem; font-weight: 900; }
.obj .where { font-size: 0.8rem; font-weight: 700; justify-self: start; padding: 1px 10px; border-radius: 999px; }
.obj.group { border-top: 3px solid var(--group); } .obj.group .where { color: var(--group); background: var(--group-soft); }
.obj.me { border-top: 3px solid var(--me); } .obj.me .where { color: var(--me); background: var(--me-soft); }
.obj.both { border-top: 3px solid var(--fun); } .obj.both .where { color: var(--fun); background: var(--fun-soft); }
.rules { margin: 0; padding-inline-start: 20px; display: grid; gap: 6px; max-width: 760px; }
.dec-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.dec-n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 0.85rem; background: var(--line); color: var(--ink); }
.decision .def { padding-inline-start: 36px; }
.budget td.num { white-space: nowrap; }
.budget tfoot td { font-weight: 800; background: var(--paper); }
.budget tfoot td:last-child { white-space: normal; }
.nw { white-space: nowrap; }
#votes th:not(:first-child), #votes td.num { width: 1%; white-space: nowrap; text-align: center; padding-inline: 6px; }
#votes .table-wrap { max-width: 760px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; }
.stat { padding: 6px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-weight: 700; font-size: 0.92rem; }
"""

page = f"""<title>תמצית 2.0</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap">
<style>
{kit}
{extra_css}
</style>
{sprite}
<div class="page" dir="rtl" lang="he">
  <nav class="topnav" aria-label="ניווט בעמוד">
    <a href="#vision">החזון</a><a href="#loop">הלולאה</a><a href="#private">פרטיות</a><a href="#day">יום עם תמצית</a>
    <a href="#g-personal">אישי</a><a href="#g-group">קבוצתי</a><a href="#g-bridge">גשרים</a><a href="#g-fun">כיף</a>
    <a href="#phases">שלבים</a><a href="#budget">עלות</a><a href="#decisions">החלטות</a><a href="#votes">הצבעות</a>
  </nav>

  <header class="hero" id="vision">
    <span class="kicker">הצעה לפני בנייה · לאישור של יועד ושוהם</span>
    <h1>תמצית 2.0</h1>
    <p class="lead">{t(C.get('vision_he', ''))}</p>
    <div class="stats"><span class="stat">{len(feats)} פיצ׳רים</span><span class="stat">{sum(len(f.get("screens", [])) for f in feats)} מסכים לדוגמה</span><span class="stat">3 שלבים עד המרתון</span><span class="stat">{len(C.get("decisions", []))} החלטות פתוחות</span></div>
    <div class="howto">
      <span class="legend"><span class="dot group"></span>קבוצתי</span>
      <span class="legend"><span class="dot me"></span>אישי</span>
      <span class="legend"><span class="dot fun"></span>כיף</span>
      <span>בכל פיצ׳ר: מסכים לדוגמה מתוך ההרצאה על תרופות נגד טפילים, והצבעה: לבנות, לדבר על זה, או לא עכשיו.</span>
    </div>
    <p class="vote-status" id="vote-status" aria-live="polite"></p>
  </header>

  <section class="block" id="loop">
    <header><span class="eyebrow">איך הכול מתחבר</span><h2>הלולאה: מהקבוצה אליך, וממך לקבוצה</h2>
    <p>כל דבר שנוצר באפליקציה עובר בין הלימוד הקבוצתי לאישי. הציונים והטעויות של כל אחד נשארים פרטיים.</p></header>
    {loop_section()}
  </section>

  <section class="block" id="private">
    <header><span class="eyebrow">פרטיות</span><h2>מה משותף ומה פרטי</h2>
    <p>התוכן נוצר פעם אחת לכל הקבוצה. הזיכרון, הציונים והטעויות של כל אחד נשמרים רק אצלו, ומסד הנתונים עצמו אוכף את זה, לא רק המסכים.</p></header>
    <ul class="objs">{objects_html}</ul>
    <ol class="rules">
      <li>מה שעושים לבד (תשובות, טעויות, שכחות) מגיע לקבוצה רק כספירה בלי שמות, רק כשלפחות 3 אנשים תרמו, ומחושב פעם בלילה כדי שאי אפשר יהיה לנחש מי תרגל עכשיו.</li>
      <li>בהקראה, בזמן אמת: ׳לא ברור׳ נספר בלי שמות, מוצג רק במסך של מי שמקריא, ורק מ-3 לחיצות. תוצאת הניחוש על היום נחשפת רק כ׳רוב הקבוצה׳, בלי מספרים.</li>
      <li>במבחן הקבוצתי: ספירה לכל תשובה רק אחרי שהשאלה נסגרת. טבלת ניקוד קיימת רק במצב מירוץ, רק לשחקנים שלו ורק בתוך המשחק. אין טבלת מובילים מחוץ למשחק.</li>
      <li>מה שמפרסמים, מפרסמים בשם: תגובה, תיקון, אסוציאציה. אפשר לפרסם אסוציאציה בלי שם, ולגבות צד במחלוקת בלי שם.</li>
      <li>אפשר לצאת מהדופק של הקבוצה בהגדרות.</li>
    </ol>
  </section>

  {day_section}

  <section class="block" id="features">
    <header><span class="eyebrow">{len(feats)} פיצ׳רים</span><h2>מה בונים</h2>
    <p>כל פיצ׳ר עם המסכים שלו, למה הוא חשוב, ואיך הוא מתחבר לשאר.</p></header>
    {''.join(groups_html)}
  </section>

  <section class="block" id="nav">
    <header><span class="eyebrow">באפליקציה</span><h2>איך זה מסודר בטלפון</h2></header>
    <div class="navtabs">{nav_html}</div>
  </section>

  <section class="block" id="phases">
    <header><span class="eyebrow">סדר העבודה</span><h2>שלבים</h2>
    <p>התאריכים מכוונים למבחן הבלוק בתחילת ינואר ולמרתון שמתחיל בערך ב-14 בדצמבר. יועד ושוהם קובעים מה נכנס לכל שלב, לפי ההצבעות; ׳לדבר על זה׳ נסגר בשיחה לפני שהשלב מתחיל. על הפיצ׳רים של שלב 1 כדאי להצביע עד 16 בנובמבר, כשהוא מתחיל.</p></header>
    <div class="phases">{''.join(phases_html)}</div>
  </section>

  <section class="block" id="cut">
    <header><span class="eyebrow">בכוונה</span><h2>מה לא נכנס, ולמה</h2></header>
    <ul class="cutlist">{cut_html}</ul>
  </section>

  <section class="block" id="budget">
    <header><span class="eyebrow">עלות</span><h2>כמה זה עולה בחודש</h2>
    <p>חודש לדוגמה: 20 הרצאות ו-8 הקלטות. התקרה שהציעה שוהם: ₪20 לאדם, כלומר כ-$33 לכל הקבוצה. אלה הערכות מתוך התכנון. אחרי השבוע הראשון יהיו מספרים אמיתיים.</p></header>
    <div class="table-wrap"><table class="budget">
      <thead><tr><th>מה</th><th>מחיר מלא</th><th>במצב חסכוני</th></tr></thead>
      <tbody>{budget_rows}</tbody>
      <tfoot><tr><td>סך הכול, עם 8 הקלטות</td><td class="num">כ-$46</td><td class="num">כ-$40</td></tr><tr><td>סך הכול, בלי הקלטות</td><td class="num">כ-$39</td><td class="num">כ-$33</td></tr></tfoot>
    </table></div>
    <p class="muted">{t(BUDGET_NOTE)}</p>
    <p class="muted">{t(BUDGET_REC)}</p>
  </section>

  <section class="block" id="decisions">
    <header><span class="eyebrow">רק אתם יכולים להחליט</span><h2>החלטות פתוחות</h2>
    <p>החלטות 2, 3, 4, 7 ו-8 צריכות תשובה עד תחילת שלב 1 ב-16 בנובמבר; 1, 5, 6, 9, 10 ו-12 עד תחילת שלב 2 ב-23 בנובמבר; ו-11 עד תחילת שלב 3 ב-7 בדצמבר. בלי תשובה אחרת עד אז, ההמלצה היא מה שנבנה. תשובה אחרת: בהערה של הפיצ׳ר הקשור.</p></header>
    <ul class="decisions">{dec_html}</ul>
  </section>

  <section class="block" id="votes">
    <header><span class="eyebrow">מתעדכן בזמן אמת</span><h2>מה כולם בחרו</h2>
    <p>כל אחד רואה את הבחירות וההערות של כולם. כל אחד יכול לשנות רק את שלו.</p></header>
    <div class="table-wrap"><table>
      <thead><tr><th>פיצ׳ר</th><th>לבנות</th><th>לדבר</th><th>לא עכשיו</th></tr></thead>
      <tbody id="vote-summary-body"><tr><td colspan="4" class="muted">ההצבעות יופיעו כאן.</td></tr></tbody>
    </table></div>
  </section>
</div>
{script}
"""
open(out_path, "w", encoding="utf8").write(page)
print("wrote", out_path, len(page), "bytes;", len(feats), "features")

"""Draft phone mockups straight from concept.json, with the kit's classes.

Usage: python3 -I render.py <concept.json> <out dir> [feature id ...]
Writes <out dir>/<feature id>.html: one <figure class="mock"> per screen.
These are drafts: the content is the concept's, the layout mechanical.
"""
import html
import json
import os
import re
import sys

concept_path, out_dir, *only = sys.argv[1:]
C = json.load(open(concept_path, encoding="utf8"))
os.makedirs(out_dir, exist_ok=True)

_W = r"[A-Za-z0-9\-+/'’½]*(?:\([A-Za-z0-9+\-]+\))?"
# An English run: words joined by a space (an abbreviation's dot may precede it) or an arrow.
# Parentheses only when balanced inside a word, as in Sb(III); sentence dots stay outside.
LATIN = re.compile(r"([A-Za-z]" + _W + r"(?:(?:\.?[ ]|[ ]?→[ ]?)(?=[A-Za-z0-9])[A-Za-z0-9]" + _W + r")*)")
SLIDE = re.compile(r"\[(ש׳ [^\]]+)\]")
PEOPLE = {"שוהם": 1, "נועה": 2, "מאיה": 3, "איתי": 4, "דניאל": 5, "רוני": 6}
TABS = [("היום", "home"), ("ספרייה", "book"), ("יחד", "users"), ("שלי", "user")]


def latin(s):
    out, last = [], 0
    for m in LATIN.finditer(s):
        out.append(html.escape(s[last:m.start()], quote=False))
        out.append('<bdi dir="ltr">' + html.escape(m.group(1), quote=False) + "</bdi>")
        last = m.end()
    out.append(html.escape(s[last:], quote=False))
    return "".join(out)


def t(s):
    """Escape, isolate English runs, and draw [ש׳ n] as slide tags."""
    s = str(s or "")
    out, last = [], 0
    for m in SLIDE.finditer(s):
        out.append(latin(s[last:m.start()]).rstrip())
        out.append(' <span class="a-tag">' + html.escape(m.group(1), quote=False) + "</span>")
        last = m.end()
    out.append(latin(s[last:]))
    return "".join(out)


def chip_class(text, lane):
    s = str(text)
    if "רק לך" in s or "גלוי רק" in s:
        return "a-chip"
    if any(k in s for k in ("טעית", "על בטוח", "שגוי", "לא נכון")):
        return "a-chip bad"
    if any(k in s for k in ("נכון", "נענתה", "אושר", "עברנו")):
        return "a-chip ok"
    if any(k in s for k in ("מהפגישה", "מהקבוצה", "קבוצה")):
        return "a-chip group"
    if any(k in s for k in ("שלב", "טיוטה", "דרוש")):
        return "a-chip warn"
    return {"group": "a-chip group", "fun": "a-chip fun"}.get(lane, "a-chip busy")


def chip(text, lane):
    return f'<span class="{chip_class(text, lane)}">{t(text)}</span>' if text else ""


def avatar(who):
    name = str(who).split("·")[0].strip()
    n = PEOPLE.get(name)
    if n:
        return f'<span class="a-avatar c{n}">{html.escape(name[0])}</span>'
    if name.lower() == "claude":
        return '<span class="a-avatar" style="background: var(--fun)">C</span>'
    return '<span class="a-avatar" style="background: var(--faint)">?</span>'


def pct(value):
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(value))]
    if "/" in str(value) and len(nums) >= 2 and nums[1]:
        return 0, min(100, 100 * nums[0] / nums[1])
    if len(nums) >= 2:
        return min(nums[0], nums[1]), max(nums[0], nums[1])
    return 0, (nums[0] if nums else 50)


CARD_KIND = {
    "group": ("a-card", "border-color: var(--group); background: var(--group-soft)"),
    "fun": ("a-card", "border-inline-start: 3px solid var(--fun)"),
    "glow": ("a-card", "background: var(--accent-soft); box-shadow: 0 0 0 2px var(--accent), 0 0 18px -2px var(--accent)"),
    "amber": ("a-card flat", "background: var(--warn-bg); border-color: var(--warn-line)"),
    "verdict": ("a-card", "background: var(--extra-bg); border-color: var(--extra-line)"),
    "placeholder": ("a-card flat", "border-style: dashed"),
    "muted": ("a-card flat", "opacity: 0.75"),
    "request": ("a-card flat", "border: 1px dashed var(--fun)"),
    "private": ("a-card flat", ""),
}


def el(e, lane):
    k = e["t"]
    if k == "section":
        return f'<div class="a-sec"><b>{t(e.get("text"))}</b>{chip(e.get("chip"), lane)}</div>'
    if k == "text":
        cls = "a-para marked" if e.get("state") == "highlight" else "a-para"
        return f'<p class="{cls}">{t(e.get("text"))}</p>'
    if k == "banner":
        return (f'<div class="a-callout a-row between" style="background: var(--group-soft); border-color: var(--group)">'
                f'<span>{t(e.get("text"))}</span><span class="a-btn primary">{t(e.get("action"))}</span></div>')
    if k == "card":
        cls, style = CARD_KIND.get(e.get("kind"), ("a-card", ""))
        st = f' style="{style}"' if style else ""
        c = chip(e.get("chip"), lane) or ('<span class="a-chip">רק לך</span>' if e.get("kind") == "private" else "")
        parts = []
        if e.get("title") or c:
            parts.append(f'<div class="a-row between"><b>{t(e.get("title"))}</b>{c}</div>')
        if e.get("text"):
            parts.append(f'<p class="a-para">{t(e.get("text"))}</p>')
        if e.get("foot"):
            parts.append(f'<span class="a-small a-muted">{t(e.get("foot"))}</span>')
        if e.get("actions"):
            parts.append('<div class="a-wrap">' + "".join(f'<span class="a-btn">{t(a)}</span>' for a in e["actions"]) + "</div>")
        return f'<div class="{cls}"{st}>' + "".join(parts) + "</div>"
    if k == "row":
        side = chip(e.get("chip"), lane) if e.get("chip") else (f'<span class="a-btn">{t(e.get("action"))}</span>' if e.get("action") else "")
        meta = f'<span class="m">{t(e.get("meta"))}</span>' if e.get("meta") else ""
        return f'<div class="a-li"><div><b>{t(e.get("text"))}</b>{meta}</div>{side}</div>'
    if k == "quote":
        who = e.get("who", "")
        return (f'<div class="a-card flat"><div class="a-row">{avatar(who)}<b>{t(who)}</b></div>'
                f'<p class="a-para">{t(e.get("text"))}</p></div>')
    if k == "chips":
        sel = e.get("selected")
        label = f'<span class="a-small a-muted">{t(e["label"])}</span>' if e.get("label") else ""
        items = "".join(
            f'<span class="{"a-chip busy" if x == sel else "a-chip"}">{t(x)}</span>' for x in e.get("items", []))
        return f'<div class="a-wrap" style="align-items: center">{label}{items}</div>'
    if k == "option":
        cls = {"chosen": "a-opt picked", "correct": "a-opt correct", "wrong": "a-opt wrong picked"}.get(e.get("state"), "a-opt")
        note = f'<span class="x">{t(e.get("note"))}</span>' if e.get("note") else ""
        return f'<div class="{cls}"><span class="l">{t(e.get("key"))}</span><span>{t(e.get("text"))}</span>{note}</div>'
    if k == "bars":
        items = e.get("items", [])
        top = max([n for _, n in items] or [1]) or 1
        rows = "".join(
            f'<div class="r{" ok" if lab == e.get("correct") else ""}"><span>{t(lab)}</span>'
            f'<div class="a-bar"><i style="width: {round(100 * n / top)}%"></i></div><b>{n}</b></div>'
            for lab, n in items)
        return f'<div class="a-card flat a-bars"><b class="a-small">{t(e.get("title"))}</b>{rows}</div>'
    if k == "table":
        head = "".join(f"<th>{t(c)}</th>" for c in e.get("cols", []))
        body = "".join("<tr>" + "".join(f"<td>{t(c)}</td>" for c in r) + "</tr>" for r in e.get("rows", []))
        return f'<div class="a-card flat" style="padding: 4px 6px"><table class="a-table"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
    if k == "meter":
        a, b = pct(e.get("value"))
        bar = f'<i style="margin-inline-start: {a:g}%; width: {b - a:g}%"></i>' if a else f'<i style="width: {b:g}%"></i>'
        return (f'<div class="a-meter"><div class="a-row between"><span class="a-small">{t(e.get("label"))}</span>'
                f'<b class="a-small">{t(e.get("value"))}</b></div><div class="a-bar">{bar}</div></div>')
    if k == "avatars":
        av = "".join(avatar(n) for n in e.get("names", []))
        return f'<div class="a-row">{av}<span class="a-small a-muted">{t(e.get("text"))}</span></div>'
    if k == "timer":
        return (f'<div class="a-row between"><span class="a-chip group"><svg width="10" height="10"><use href="#i-clock"/></svg> '
                f'{t(e.get("text"))}</span></div><div class="a-timer"><i style="width: 52%"></i></div>')
    if k == "button":
        kind = {"primary": " primary", "ghost": " ghost"}.get(e.get("kind"), "")
        return f'<div class="a-row"><span class="a-btn{kind} wide">{t(e.get("text"))}</span></div>'
    if k == "buttons":
        return '<div class="a-wrap">' + "".join(f'<span class="a-btn">{t(x)}</span>' for x in e.get("items", [])) + "</div>"
    if k == "input":
        if e.get("label"):
            return (f'<div class="a-stack" style="gap: 3px"><span class="a-small a-muted">{t(e["label"])}</span>'
                    f'<div class="a-input" style="color: var(--ink)">{t(e.get("value"))}</div></div>')
        return f'<div class="a-input">{t(e.get("placeholder"))}</div>'
    if k == "toast":
        return f'<div class="a-toast">{t(e.get("text"))}</div>'
    if k == "private":
        return (f'<div class="a-card flat"><div class="a-row between"><span class="a-small">{t(e.get("text"))}</span>'
                f'<span class="a-chip">רק לך</span></div></div>')
    if k == "note":
        return f'<p class="a-small a-muted">{t(e.get("text"))}</p>'
    return f"<!-- unknown element {html.escape(k)} -->"


def later(e, inner):
    n = e.get("later")
    return f'<div class="a-later" data-later="שלב {n}">{inner}</div>' if n else inner


def foot_button(e):
    if e["t"] == "button":
        kind = {"primary": " primary", "ghost": " ghost"}.get(e.get("kind"), "")
        return f'<span class="a-btn{kind} wide">{t(e.get("text"))}</span>'
    items = e.get("items", [])
    return "".join(
        f'<span class="a-btn{" primary wide" if i == len(items) - 1 and len(items) <= 3 else ""}">{t(x)}</span>'
        for i, x in enumerate(items))


def screen(s, lane):
    els = list(s.get("elements", []))
    status = next((e for e in els if e["t"] == "status"), {"text": "09:41"})
    head = next((e for e in els if e["t"] == "head"), None)
    sub = next((e for e in els if e["t"] == "sub"), None)
    tabs = next((e for e in els if e["t"] == "tabs"), None)
    body = [e for e in els if e["t"] not in ("status", "head", "sub", "tabs")]
    foot = []
    while body and body[-1]["t"] in ("button", "buttons") and not body[-1].get("later") and len(foot) < 2:
        foot.insert(0, body.pop())
    out = [f'<div class="ph-status"><span>{t(status.get("text"))}</span><span>100%</span></div>']
    if head:
        back = f'<span class="back">→ {t(head["back"])}</span>' if head.get("back") else ""
        out.append(f'<div class="ph-head">{back}<span class="t">{t(head.get("text"))}</span>{chip(head.get("chip"), lane)}</div>')
    if sub:
        out.append(f'<div class="ph-sub">{t(sub.get("text"))}</div>')
    parts, i = [], 0
    while i < len(body):
        e = body[i]
        if e["t"] in ("row", "option"):
            j = i
            while j < len(body) and body[j]["t"] == e["t"]:
                j += 1
            wrap = "a-list" if e["t"] == "row" else "a-opts"
            inner = "".join(later(x, el(x, lane)) for x in body[i:j])
            parts.append(f'<div class="{wrap}">{inner}</div>')
            i = j
            continue
        parts.append(later(e, el(e, lane)))
        i += 1
    out.append('<div class="ph-body">' + "".join(parts) + "</div>")
    if foot:
        out.append('<div class="ph-foot">' + "".join(foot_button(e) for e in foot) + "</div>")
    if tabs:
        cells = "".join(
            f'<span class="ph-tab{" on" if name == tabs.get("active") else ""}"><svg><use href="#i-{icon}"/></svg>{name}</span>'
            for name, icon in TABS)
        out.append(f'<div class="ph-tabs">{cells}</div>')
    when = f' · <b>בשלב {s["later"]}</b>' if s.get("later") else ""
    cap = f'<figcaption><b>{t(s.get("title_he"))}</b>{when}. {t(s.get("caption_he"))}</figcaption>'
    return '<figure class="mock">\n  <div class="phone">\n    ' + "\n    ".join(out) + "\n  </div>\n  " + cap + "\n</figure>\n"


LANE = {"personal": "me", "group": "group", "bridge": "me", "fun": "fun"}
n = 0
for f in C["features"]:
    if only and f["id"] not in only:
        continue
    lane = LANE.get(f.get("group"), "me")
    body = "".join(screen(s, lane) for s in f["screens"])
    open(os.path.join(out_dir, f"{f['id']}.html"), "w", encoding="utf8").write(body)
    n += len(f["screens"])
print("drafted", n, "screens")

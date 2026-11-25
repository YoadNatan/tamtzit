# תמצית's design system

The look Yoad approved in the product proposal (`docs/study/proposal/`), made
the app's own. Every screen is written in it: its tokens for every colour and
size, its components for every piece. A screen's stylesheet only places the
components; it never restyles them.

| What | Where |
|---|---|
| Tokens: colour (light and dark), type, radii, spacing, shadows, the frame | `src/study/styles/tokens.css` |
| Components: the frame (`ph-*`) and the pieces (`a-*`) | `src/study/styles/kit.css` |
| React pieces of the frame: `Head`, `BackLink`, `Sheet`, `SheetClose`, `StickyActions`, `TabBar`, `Loading`, `Soon` | `src/study/components/Shell.tsx` |
| The shell and F's screens' placement (library, upload, the reader and its summary, reading together, "יחד", "שלי", help, Join) | `src/study/study.css` |
| Flashcards' and practice's placement | `src/study/styles/cards.css`, `src/study/styles/practice.css` |
| The kit's icons (users, user, bolt, chat, award, check, send, clock, pen, book, mic, cards) as `<Icon name="users" />` | `src/study/components/Icon.tsx` |
| The group quiz's and W1's placement (the quiz's own question view is `QuizQuestion.tsx`, in the approved quiz's markup) | `src/study/styles/quiz.css`, `src/study/styles/writing.css` |

`main.tsx` loads `font.css` (the one typeface), `tokens.css`, then `kit.css`, before any screen's CSS.

What the release round of the playful look changed, and why, is in
`docs/study/LOOK-2.md`; this page is the reference.

## Where it comes from

The proposal's kit (`docs/study/proposal/kit.css`) draws the app on a 300 px
phone with 13 px text, with the app's own colours. This design system is the
same kit at full size: **the same class names**, so an approved mockup's
markup is the app's markup, and every size is the kit's × 16/13 (a 13.5 px
kit title is 17 px here, a 9 px card radius 12 px).

- `ph-*` is the frame of a screen: its top bar, the line under it, its
  bottom bar, the tab bar. In the app the screen itself is `<main>`.
- `a-*` is a piece inside it: a card, a chip, a button, an answer.
- Anything else is a screen's own hook (`.lecture-card`, `.room-bar`,
  `.q-opt`): it names a thing for the code and the tests, and places it.

Two of the kit's classes are not used in the app: `ph-status` (the phone's
status bar) and `a-later` (the proposal's "later phase" mark).

## Tokens

### The playful look

Tactile and game-like. A fresh indigo-violet primary and four friendly lane
colours (me, group, fun, ok) on a soft lavender-white page; chunky
"pressable" controls that stand on a solid bottom edge and sink onto it when
tapped, and only those (a card that just holds things rests flat on a soft
shadow, so the edge always means "tap me"); big rounded cards; one rounded
variable face (Rubik). The four lane tiles in a row (the join screen's
mark, empty states, help's head) are the app's signature. The delight goes
into the chrome, Today, practice, the quiz, the cards, the boss and
progress: a big title on each tab's home, confetti on a right answer and on
a finished queue, candy bars, thick rings, icon tiles on the queue, lane
tiles on the grades, a confidence bet whose bars show the scale. Each
screen wears its lane: "יחד", the meeting and the quiz the group's orange
(their section tiles; the quiz's timer and notes), the wall and the boss the
fun pink. **A lane tints only decoration** (section tiles, card edges and
strips, timers, confetti): every primary button and every chosen tile or
chip is the accent's, on every screen. Each lecture has a hue of its own
(one of the four lane colours, the same on every screen) as a short strip
inside the start side of its library card and of the meeting band.
The reader's long text stays calm: a touch under regular weight (380, 360
in dark), 1.75 leading, no colour in the prose; its tools are a quiet tray
of pills above it.

### Colour

Every colour is a token; a screen never writes a hex value (pictures keep a
white backing, avatars white letters). Light and dark switch with the
system's setting (`prefers-color-scheme`), and printing stays light. Dark is
designed, not inverted: a deep indigo night, surfaces that step up in
lightness, lanes that glow, a lighter step under each pressable thing so
its edge still reads on the dark page, and a primary that stays a deep,
strong violet as a fill (`--accent-fill`) while its text colour goes light.

Each lane has two colours: a **text** colour (`--accent`, `--group`,
`--fun`, `--ok`, `--bad`: 4.5:1 on the page, the surface and its own soft
tint, in both themes) and a bright **pop** colour (`--me-pop`,
`--group-pop`, `--fun-pop`, `--ok-pop`, `--bad-pop`, `--sun-pop`) for fills,
rings, bars, edges, tiles and confetti only: never text, and text or an
icon on a pop is `--pop-ink` (dark in both themes).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f6f4fd` | `#121022` | the page, the bars |
| `--surface` / `--surface-2` | `#ffffff` / `#f1eefc` | `#201c38` / `#2a2548` | cards, lists, sheets, fields / a well, the back pill, a letter tile |
| `--ink` | `#1c1838` | `#f1effc` | text |
| `--muted` | `#57537a` | `#b0abd0` | secondary text, ghost buttons, the tabs (6.6:1 on paper) |
| `--faint` | `#9a96b8` | `#7d77a3` | rules and placeholders only, never text that must be read |
| `--line` | `#e4e0f5` | `#3d3766` | borders, rules, the plain chip and tag |
| `--edge` | `#d3cdee` | `#2a2452` | the bottom edge a pressable thing stands on (a button, an answer, a grade, a card that is a link, a checkbox) |
| `--btn-line` | = edge | = line | a secondary button's outline |
| `--field-line` | `#8a84b0` | `#7a73a8` | a field's and a checkbox's boundary (3:1 or more on the surface) |
| `--accent` / `--accent-ink` / `--accent-soft` / `--accent-edge` | `#5235e8` / `#fff` / `#ebe6ff` / `#3720b8` | `#a99bff` / `#140b45` / `#2e2760` / `#3a22b0` | the primary as TEXT (links, the current tab's word, a marked paragraph); ink on the light accent; the primary's edge |
| `--accent-fill` / `--accent-fill-ink` | = accent / `#fff` | `#6c4cff` / `#fff` (5.1:1) | the primary as a FILL: a primary button, the current tab's tile, a chosen segment or bet, a checked box |
| `--pop-ink` | `#1c1838` | `#1c1838` | text and icons on a pop fill ("יחד"'s primary, a queue row's tile) |
| `--accent-2` | `#8a5cff` | `#d3a6ff` | the primary's light end (hover) |
| `--me-soft` / `--me-pop` | = accent-soft / `#7c5cff` | = accent-soft / `#8f7bff` | what is only yours (its text colour is `--accent`) |
| `--group` / `--group-soft` / `--group-pop` | `#c2410c` / `#ffedd9` / `#ff8a3d` | `#ffa45e` / `#3b1d10` / `#ff8a3d` | what the group does together (the meeting band, the quiz's timer) |
| `--fun` / `--fun-soft` / `--fun-pop` | `#be185d` / `#ffe4ef` / `#ff5fa2` | `#ff8cc0` / `#3d1530` / `#ff5fa2` | the fun layer: mnemonics, the wall, the boss |
| `--ok`, `--ok-soft`, `--ok-pop` | `#15803d`, `#dcf5e6`, `#2fd17a` | `#62e09c`, `#15372a`, `#2fd17a` | right, "got it" (always with a word or a mark too) |
| `--bad`, `--bad-pop` | `#c41e23`, `#ff6b6b` | `#ff8a85`, `#ff6b6b` | wrong (always with a word or a mark too) |
| `--sun-pop` | `#ffb020` | `#ffbf47` | the streak's flame, confetti |
| `--extra-bg` / `--extra-line` | `#e8f1ff` / `#4f86dc` | `#172440` / `#4f7fd0` | "הרחבה" (knowledge from outside the slides); the line is a strip, 3:1 on its tint and on the surface |
| `--warn-bg` / `--warn-line` | `#fff4d1` / `#b88200` | `#33270a` / `#c99a1c` | "שימו לב", an open question, a confirm, the flame's tile (3:1 likewise) |
| `--lecturer-bg` / `--lecturer-line` | `#ffeaf2` / `#d6528a` | `#33182a` / `#b8517f` | the lecturer's words, the recording (3:1 likewise) |
| `--me-line`, `--group-line`, `--fun-line`, `--ok-line` | the lane's pop softened toward `--line` | same | the border of a card that belongs to a lane (Today's group cards, a plan's day, the museum, the pulse, the boss, the wall's winner, a correction): the lane at a glance, never a heavy dark frame |
| `--fun-strip`, `--group-strip` | `#e5418a`, `#d95f1f` | = fun-pop, group-pop | the strip down the start of a note in a lane (the wall's hint on a card, the quiz's "בלי שמות"): 3:1 on its tint and on the surface |
| `--ok-ink`, `--bad-ink` | white, white | dark inks | text on a filled ok or bad |
| `--ok-bg`, `--bad-bg` | tints of ok and bad on surface | | a right or wrong answer's card, the grades |
| `--chip-ink`, `--ok-text`, `--group-text` | muted, ok and group, darkened a little | muted, ok, group | text on a chip's tint, 4.5:1 or more |
| `--badge-bg` / `--badge-ink` | `#ffb020` / ink | `#ffbf47` / `#140b45` | the count on "שאלות" in the reader |
| `--avatar-1` … `--avatar-6`, `--avatar-ring-1` … `-6` | six colours for members' initials (white letters, 5:1 or more) and a lighter ring for each | same, darker rings | `.a-avatar.c1` … `.c6` |
| `--track` | `#e9e5f8` | `#322c58` | a bar's and a ring's empty part |
| `--glass` | paper at 90% | paper at 90% | the sticky bars over scrolling text, only where `backdrop-filter` works (solid `--paper` otherwise) |
| `--scrim` | ink at 40% | near-black at 62% | behind a sheet |
| `--confetti`, `--confetti-lg` (kit.css) | dots (and, large, little square tiles) in the pop colours | same | the celebration's background layers: beside a right answer's chip, a band over a finished round, review, quiz or boss |
| `--read-ink` / `--read-weight` | ink / 380 | `#e2def3` / 360 | the summary's prose: light text on a dark page blooms, so it is a little softer and lighter there |

**The current tab** is the primary's tile with its word in `--accent`,
except "יחד", whose tile is the group's orange (`--group-pop` with
`--pop-ink`) and whose word is `--group-text` (5.9:1 on the tab bar in
light, 8.4:1 in dark). This is on purpose: the tab bar says where you are,
and the group's tab wears the group's lane, as "יחד"'s section tiles do.
Every other tab is violet, and "יחד"'s primary button is violet too.

### Type

One face: **Rubik**, a variable font (weight 300–900) with softly rounded
corners, self-hosted from `@fontsource-variable/rubik` (OFL-1.1) in
`src/study/styles/font.css`: the Hebrew and Latin subsets only (about 45 kB
of woff2 assets, never in the JS), `font-display: swap`. Right behind it
is the platform's own UI face (`system-ui`, then `Arial Hebrew`), for the
first paint and for every glyph the two subsets lack (⁺ ⁻ ₂ ₃ ← → ≤ ≥ α β):
one predictable fallback, never whichever stray font is installed. No font
comes from another host. Display (`--font-display`) is the same face, heavier
(`--display-weight` 800).

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-h1` | 26 px | 800 | a screen's own big title (`.a-h1`): a lecture, the end of a round |
| `--text-h2` | 19 px | 700 | a block's or a sheet's title (`.a-h2`; a sheet's 800) |
| `--text-sec` | 18 px | 800 | a section's name (`.a-sec`), after a small tilted tile |
| `--text-title` | 17 px | 800 | the top bar's title (`.ph-head .t`); on a tab's home (היום, ספרייה, יחד, שלי) it is the big title, 26 px, with room around it and no rule under it until the page scrolls |
| `--text-body` | 16 px | 400 | body text |
| `--text-para` | 15.5 px | 400 | a paragraph in a card (`.a-para`), a list row's title |
| `--text-btn` | 15 px | 700 | buttons, links, the back pill (a wide button 17 px 800) |
| `--text-small` | 14 px | 400 | meta lines (`.a-small`, `.ph-sub`, `.a-li .m`); the smallest text that is read (P3) |
| `--text-chip` | 14 px | 700 | chips, letter tiles |
| `--text-tag` | 13 px at least, 14 from 768 | 700 | a slide tag (it grows with the reading size), a grade's interval, a length's count, a badge |
| `--text-tab` | 13 px, 14 from 768 | 600 (800 current) | the tab bar's words |
| `--reading-size` | 15, 17, 19 or 21 px | 400 | the summary and a card's text: the member's choice under "שלי" |

**Big numbers** (the band's "הקבוצה היום · 20:41", the quiz's clock and
"שאלה 1 מתוך 7", practice's "1/5") are the display face at 800 with
`font-variant-numeric: tabular-nums`, so a ticking number never jiggles. No
second face.

Line heights: `--leading` 1.5 (the interface), `--leading-read` 1.75 (the
summary), `--leading-tight` 1.25 (headings). The summary's headings are 800,
700 and 600, its bold 600: calmer than the chrome.

### Radii, spacing, depth

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 7 px | a slide tag |
| `--r-sm` | 10 px | a marked paragraph, a picture |
| `--r-md` | 14 px | buttons, answers, fields, callouts |
| `--r-lg` | 20 px | cards, lists, a wide button, the tab bar's top corners |
| `--r-xl` | 28 px | the flash card, a sheet's top corners |
| `--r-pill` | 999 px | chips, the back pill, the toast |
| `--sp-N` | N × 2 px (`--sp-1` … `--sp-16`) | every gap and padding; `--sp-5` (10 px) is the rhythm between a screen's blocks |
| `--b` | 2 px | the chunky border of a card, a button, a field |
| `--press` / `--press-down` | 4 px / 1 px | how tall a control stands on its edge, and how far it stays up while pressed |
| `--shadow-card` | a soft rest | a card or a list that only holds things |
| `--shadow-soft` | a soft glow (violet in dark) | a hero card: Today's queue, a round's score |
| `--hi` | none / a 1 px top highlight in dark | the top of every pressable thing, so it reads raised on the dark page |
| `--shadow-sheet` | upward | a sheet |
| `--shadow-pop` | a short drop | a menu, the toast, the guide's bubble |
| `--ease-bounce`, `--t-press` | a springy curve, 90 ms | the press, a pop |

### The frame

| Token | Value |
|---|---|
| `--gutter` (`--gutter-left`, `--gutter-right`) | 16 px, or the safe area where it is larger |
| `--measure` | 760 px: the widest a screen gets (tablets) |
| `--measure-read` | 36em: the reader's line (about 70 letters at any text size) |
| `--measure-wide` | 1040 px: the reader with its contents column, the library's grid (1280 and up) |
| `--sheet-w` | 560 px: a sheet as a dialog (768 wide, 560 tall and up) |
| `--rail-w` | 0, or 88 px from 1024: the side rail |
| `--hit` | 44 px: every control's smallest hit area |
| `--head-h`, `--tabbar-h` | 56 px, 60 px (the tab bar adds the safe area) |
| `--z-bar` 5, `--z-stack` 8, `--z-tabs` 15, `--z-layer` 18, `--z-sheet` 20, `--z-toast` 30 | the sticky bars, the live banner, the tab bar, a full-screen layer, a sheet, the toast |

## Components

Each with an example from the app. Copy the approved mockup's markup, then
put the app's words and handlers in it.

### The frame

**The screen.** `<main>` is a column of blocks, 10 px apart, between the
gutters, at most 760 px wide, at least the screen's height (so a bottom bar
sits at the bottom). Its first child is its top bar.

**`ph-head`: the top bar.** The back arrow, the title (the screen's `h1`),
then a chip or tools at the end. Sticky under the live banner, glass over the
scrolling text. A long title wraps to a second line, never an ellipsis (in a
right-to-left line it would cut an English lecture name from its start);
`StickyActions` draws no bar when it has nothing in it. The title takes up
to three lines (16 px under 375 px wide) before anything is cut. Use the
`Head` component:

```tsx
<Head back={<BackLink go={ctx.go} fallback={{ v: "lecture", l }} />} title="הרצאה חדשה" />
<Head title={group.name}>
  <RouteLink to={{ v: "help" }} go={ctx.go} className="a-btn ghost icon" label="עזרה">?</RouteLink>
</Head>
```

`BackLink` renders `.back` (muted, 44 px) and its words name where it goes
("→ לספרייה"). A title that needs its own markup goes in as a child:
`<Head back={…}><h1 className="t">כרטיסיות · <bdi>{title}</bdi></h1></Head>`.

**`ph-sub`: the line under it.** Muted context and chips, flush under the
head:

```tsx
<p className="ph-sub"><span>שלום {group.me}</span><span aria-hidden="true">·</span><span>12 בקבוצה</span></p>
```

**`ph-top`: a head and its sub-line that stay together** (the reader's room).
The reader's tools (`.head-tools`: תוכן, א-, א+, שיתוף) are one tray of
pills, 44 px tall together, the open one ("תוכן" while the contents show)
raised in it; the room's buttons ("להקריא לקבוצה", "שאלות") are pills of
the same kind:

```tsx
<header className="ph-top" ref={headRef}>
  <div className="ph-head">{back}<div className="head-tools">…</div></div>
  <div className="ph-sub room-bar">…</div>
</header>
```

**`ph-foot`: the bottom bar** of an immersive screen (upload, a session,
browsing cards): its one primary action, sticky at the bottom, in the bottom
quarter of the screen (the e2e checks it). Use `StickyActions`:

```tsx
<StickyActions>
  <button className="a-btn primary wide" onClick={start}>יצירת סיכום</button>
</StickyActions>
```

**`ph-tabs` / `ph-tab`: the tab bar** (`TabBar`): four tabs right to left,
an icon tile over a word, the current one's tile filled (the accent, or the
group's orange on "יחד") with `aria-current="page"`. Only on the tab
screens; immersive screens have none.

**Wide screens** (`ux-p2.md`). Breakpoints by the window's width, never by
device: S under 600 (the phone layout, unchanged), M 600–1023, L 1024 and
up, XL 1280 and up; 768 is "a tablet" for reading.
- M: the tab bar stays at the bottom with its tabs together in the middle
  (at most 120 px each).
- L: the tab bar is a rail, 88 px, down the start side (the right), the
  same tiles top to bottom; `--tabbar-h` is 0 there, so whatever keeps room
  for the bar at the bottom lets it go, and the screen moves over by
  `--rail-w` (the toast and the guide's bubble too).
- From 768 `ph-foot` follows the content (16 px under it) instead of the
  screen's bottom; it still sticks when the content is longer.
- The reader: lines of `--measure-read`; from 768 the text starts at 19 px
  until a member chooses a size; from 1024 the contents are a sticky column
  at the start of the text and "תוכן" leaves the top bar.
- XL: the library is `--measure-wide`, its lectures in two columns.

**Today's start bar** (`main.today > .t-start`): "להתחיל" and the streak's
tile ("להבה 4/7", 46 px, inline with the button) stay over the tab bar
while the queue scrolls under them, about 70 px tall with a short fade; a
row brought into view clears them (`scroll-padding-bottom`). On a short
screen (`max-height: 700px`, a 360×640 phone) the bar does not stick: it
sits after the queue, 48 px, so the queue keeps its rows.

### Text

```tsx
<h1 className="a-h1">{lecture.title}</h1>           {/* 26 px display 800 */}
<h2 className="a-h2">עוד אין כאן הרצאות</h2>          {/* 19 px display 700 */}
<p className="a-para">…</p>                          {/* a paragraph in a card */}
<p className="a-para marked">…</p>                   {/* the paragraph being read */}
<p className="a-small a-muted">ד״ר כהן · 15.11.2026</p>
<p className="a-error" role="alert">השמירה נכשלה באמצע…</p>
```

An error on its own line (`p.a-error`) is a soft `--bad-bg` panel with a
small "!" tile at its start and bold words in `--bad` (5:1 on the tint in
both themes); `.a-error` inside a sentence is just the colour. The "!" is
drawn (an SVG background), not generated text, so a screen reader does not
read it at the start of every `role="alert"`. Today's "התור לא נטען" is one
container: the bad tint with the tile, the words and "לנסות שוב" under
them.

"טוען…" (`.loading`, the `Loading` component) sits under three lane dots
that take turns to light up (still under reduced motion).

### Layout

```tsx
<div className="a-row between"><b>מאיפה זה?</b><button className="a-btn small">לפסקה</button></div>
<div className="a-wrap">{chips}</div>               {/* wraps, 6 px apart */}
<ul className="a-stack">{rows}</ul>                 {/* a column, 8 px apart; a ul loses its bullets */}
<div className="a-grid2">…</div>
<div className="a-divider" />
```

### Buttons and links

`.a-btn` is secondary; `.primary` is the screen's one action; `.ghost` a
quiet one; `.danger` deletes; `.wide` fills its row (52 px; from 600 px
wide, one alone in a screen stops at 480 px, at the start; in the bottom
bar, a row or a sheet it keeps filling); `.small` sits
in a list row or a line of text (32 px); `.icon` is a square ✕, ?, ⋯. Every
size is 44 × 44 to the finger: a smaller one grows an invisible `::after`.

```tsx
<button className="a-btn primary wide">יצירת סיכום</button>
<button className="a-btn">ייצוא ל-Anki</button>
<button className="a-btn ghost small">מחיקת ההרצאה</button>
<button className="a-btn danger">מחיקה</button>
<RouteLink to={…} go={ctx.go} className="a-btn small">תרגול</RouteLink>
<button className="a-link" onClick={reply}>תשובה</button>   {/* a text action */}
<button className="a-link danger">מחיקה</button>
```

`.a-link` is a text action standing on its own ("לפגישה של היום", "לא
יודעים", "כל העזרה"): bold, in the accent, with a thick (2.5 px), offset
underline in my lane's bright colour (the group's on "יחד" and the band), so
it reads as a link without colour alone. A row of tabs is not a row of links:
the wall's tabs are text tabs (`.wall-tab`, no separators; the chosen one
bold in the ink on a 3 px bar in `--fun-strip`).

The tapped paragraph (`.blk-selected`) is a soft `--surface-2` well with
a quiet `--field-line` frame and 10 px of room inside it (the padding is
pushed into the gutter by a negative margin of the same size, so the lines
keep their breaks). Its actions (`.blk-actions`: תגובה או שאלה, תיקון,
אסוציאציה, לשאול) are one line of small pill buttons under it, sharing the
width, at 360 px too. The lecture's action row scrolls sideways and fades
over its last 24 px only, less than its 32 px end padding, so the last chip
scrolls fully clear of the fade.

### Chips and tags

A chip is a short state or count: plain, `.ok`, `.busy` (accent), `.warn`,
`.bad`, `.group`, `.fun`. A chip that is a link or a button keeps the look
and gets the 44 px hit area.

```tsx
<span className="a-chip ok">מוכן</span>
<span className="a-chip warn">שאלה פתוחה</span>
<RouteLink to={{ v: "cards", l }} go={ctx.go} className="a-chip busy">54 כרטיסיות</RouteLink>
```

A slide tag ("ש׳ 12") follows its sentence. `richText` and the summary draw
them (`lib/rich.tsx`); a tag that opens the slide is a button
(`.a-tag.src-link`, the hook that `slideTag()` reads), a quiet one a label
(`.a-tag.src-tag`); `.bad` strikes a slide the lecture does not have.

```tsx
<button type="button" className="a-tag src-link" data-slides="12">ש׳ <bdi dir="ltr">12</bdi></button>
```

### Cards, lists, sections, callouts

```tsx
<li className="a-card lc">…</li>                       {/* raised: one thing */}
<div className="a-card flat">…</div>                  {/* inside a sheet or another card */}
<section className="a-card dashed empty">…</section>  {/* an empty place, a drop zone */}
<li className="a-card lc" data-hue={hueOf(l.id)}>…</li>  {/* a lecture's hue: a strip inside its start side */}

<div className="a-sec"><h2>נמחקו לאחרונה</h2><span className="a-small a-muted">רק לך</span></div>

<ul className="a-list">
  <li className="a-li">
    <div><b>הרצאה שנמחקה</b><span className="m">נמחקה ע״י נועה · לפני 2 ימים</span></div>
    <button className="a-btn small">שחזור</button>
  </li>
</ul>
```

A list's rows may sit in `<li>`s or be its children; a link or a button may
be the row (`<RouteLink className="a-li question-link">`). The rule between
rows is the list's.

```tsx
<aside className="a-callout">הרחבה: …</aside>            {/* blue: from outside the slides */}
<aside className="a-callout warn">שימו לב: …</aside>
<aside className="a-callout rec">דגש מהמרצה: …</aside>
<aside className="a-callout quiet">…</aside>               {/* a plain quote */}
<div className="a-callout warn confirm"><span>למחוק את ההרצאה…?</span><div className="a-row">…</div></div>
```

### Progress

```tsx
<div className="a-bar"><i style={{ width: "39%" }} /></div>      {/* .group for the group's colour */}
<div className="a-ring" style={{ "--p": "37%" } as CSSProperties}><span>20</span></div>
<div className="a-bars"><div className="r ok"><span>{barLabel("אמבות")}</span><span className="a-bar"><i style={{ width: "100%" }} /></span><b>6/6</b></div></div>  {/* labels wrap in one column (≤ 45%), never cut */}
<div className="a-timer"><i style={{ width: "60%" }} /></div>
```

### Forms

```tsx
<label className="a-field">
  <span>שם ההרצאה</span>
  <input className="a-input" value={title} onChange={…} dir="auto" />
</label>
<div className="a-seg" role="radiogroup" aria-label="סוג">
  <button className="a-btn small" role="radio" aria-checked={kind === "comment"}>תגובה</button>
  <button className="a-btn small" role="radio" aria-checked={kind === "question"}>שאלה לקבוצה</button>
</div>
<label className="a-choice"><input type="radio" name="format" checked={…} onChange={…} /><span>חבילת Anki (מומלץ)</span></label>
```

`.a-seg` fills the chosen one with the primary (`aria-selected`,
`aria-checked` or `aria-pressed`). A `.a-choice` row is the radio's or the
checkbox's target, 44 px tall.

**The confidence bet** (`.pq-bets` in practice, `.quiz-bets` in the quiz,
`.m-bets` in a meeting's quiz) is three equal tiles on the same neutral
surface and border, so no bet looks chosen or recommended before the member
picks. Only the one, two or three little bars before each word show the
scale (decoration: the word says it). The
chosen one fills with `--accent-fill`, its bars white. Not yet available
(the quiz's bets before an answer is picked) they are flat and muted, the
bars still showing the scale. CSS only: the buttons, roles and words are the
same.

**Radios** are round 24 px tiles on their edge; the chosen one is ringed in
`--accent-fill` with a dot. **A setting that is on or off** (a
`.setting-check` row on "שלי": "לא לכלול אותי בדופק", "הקבוצה צריכה
אותך", "טיפים על דברים חדשים") draws the same checkbox as a switch: off is
an outlined track with a small knob at its start, on is a filled
`--accent-fill` track with a bigger white knob at its end (position and
size change, not only colour), with the kit's focus ring; its row is the
44 px target. The input, its role and its label are unchanged.

```tsx
<label className="a-li setting-row setting-check">
  <span className="a-stack"><span>הקבוצה צריכה אותך</span><span className="a-small a-muted">…</span></span>
  <input type="checkbox" checked={on} onChange={…} />
</label>
```

### Questions and cards

```tsx
<p className="a-q">מטייל חזר מתאילנד עם חום…</p>
<ol className="a-opts">
  <li className="a-opt picked"><span className="l">ג</span><span>לתת Mefloquine פעם בשבוע</span></li>
  <li className="a-opt correct"><span className="l">ב</span><span>לבדוק G6PD ולתת Primaquine</span><span className="x">…</span></li>
  <li className="a-opt wrong">…</li>
</ol>

<div className="a-flash card-panel">                     {/* a card's face (CardFace inside) */}
  <p className="front">…</p>
</div>
<div className="a-grade card-buttons" role="group" aria-label="כמה זכרת?">   {/* in the bottom bar */}
  <button className="card-btn again"><span>שוב</span><span className="ivl">10 דק׳</span></button>…
</div>
```

In the kit a grade's interval is a `<small>`; any second line works. A grade
that is a choice (מה ליצור's levels) is a `role="radio"` button; the chosen
one (`aria-checked="true"`) is outlined in the accent.

The card under review (`main.review .card-panel`) is between 220 and 300 px
tall (30% of the screen), its words in the middle: a card in the hand, never
a half-empty one.

A choice of several (parts, styles, "מאיפה") is a row of chip buttons with
`aria-pressed`, the chosen ones `.a-chip.busy` with a "✓ "; a chip that is
one of a few (`role="radio"`, the boss's lectures and seconds) wears a 2 px
ring of its own colour when chosen; a disabled chip is dimmed like a
disabled button:

```tsx
<button type="button" className="a-chip busy" aria-pressed>✓ מלריה · 22</button>
```

### People

```tsx
<span className="a-avatar c3">מ</span>
<span className="a-up on">▲ 12</span>
<div className="a-lead me"><span className="r">2</span><span className="a-avatar c1">ש</span><span>שוהם</span><span className="s">420</span></div>
<div className="a-bubble me">מה המרצה אמר על G6PD?</div>
```

### Over the screen

A sheet: `Sheet` gives the scrim, the panel, its head (a title and ✕), its
own history entry (Back, Escape, ✕ and the scrim close it), and focus kept
inside it.

```tsx
<Sheet label="ייצוא ל-Anki" className="card-sheet" onClose={close} head={<h2>ייצוא ל-Anki</h2>}>
  {(sheet) => (
    <>
      …
      <div className="a-row sheet-actions">
        <button className="a-btn primary" onClick={() => void run(sheet.close)}>ייצוא</button>
        <button className="a-btn ghost" onClick={sheet.close}>ביטול</button>
      </div>
    </>
  )}
</Sheet>
```

Its parts are `.a-scrim`, `.a-sheet` and `.a-sheet-head` (with `SheetClose`)
for a sheet that keeps its own history (the reader's thread). A sheet is at
most 85% of the screen tall (so its foot, "לנעוץ" in the wall's moment,
shows at 390 × 844 without scrolling), with a small grip at its top (none
with a mouse). On a screen 768 wide and 560 tall it is a dialog in the
middle, `--sheet-w` wide, four rounded corners, no grip; a sheet of a
picture (`.slide-sheet`, `.qf-sheet`, `.geo-sheet`, `.fix-sheet`) takes
`--measure`.

The toast (`.a-toast`) is the shell's: `ctx.say("הקישור הועתק.")`, with an
optional action (`{ label: "ביטול", run }`).

`.a-table` is a small table in a card or a sheet.

## Rules

- **Right to left.** Every page is `dir="rtl"`. Use logical properties
  (`margin-inline-start`, `inset-inline-end`, `border-inline-start`), never
  left and right, except where the safe area is physical (`--gutter-left`,
  `--gutter-right`). The tab bar, rows and grids follow the direction.
- **English inside Hebrew** goes in `<bdi dir="ltr">`, so it never flips the
  Hebrew punctuation around it: `isolateLatin()` and `richText()`
  (`lib/rich.tsx`) do it for any string; a heading or a line that starts in
  English keeps `dir="rtl"` (never `dir="auto"` for prose).
- **Phone first.** Designed at 390 × 844 and checked at 360 × 640: no
  horizontal scroll at either, nothing under the bars. Wider screens stop at
  760 px.
- **Light and dark.** Colours only through tokens; check every screen in
  both (the e2e screenshots are taken in both).
- **44 × 44.** Every button, link, chip-link, tag-button, tab and checkbox
  row is at least 44 × 44 px to the finger (the kit's `::after`); a link
  inside a sentence is exempt, as WCAG 2.5.8 exempts inline targets.
- **Contrast.** Text on its background is at least 4.5:1 (3:1 at 24 px, or
  18.66 px bold) in both themes: chips use `--chip-ink`, `--ok-text` and
  `--group-text`; `--faint` is never text. Right and wrong are never colour
  alone: a ✓/✗ or a word goes with them.
- **One primary action** per screen: `.a-btn.primary`. On an immersive
  screen it sits in the bottom bar (`ph-foot`), in the bottom quarter.
- **Focus** is always visible (a 3 px accent outline, on a field too, where
  the border also turns accent; the outline stays under forced colours); what focus brings into view stays clear of
  the sticky bars (`scroll-padding`).
- **Pressable means tappable.** A button, an answer, a grade, a checkbox and
  a card that is itself a link or a button (`a.a-card`, `button.a-card`)
  stand on a bottom edge (`--press`) and sink onto it while pressed. Nothing
  else does: a card, a list, a callout and a note in a card rest flat
  (`--shadow-card`), and a card that belongs to a lane shows it as a strip
  inside it (a lecture's hue on its card and the meeting band, a wall
  note's top bar: a short rounded bar inset from the corners, so the card
  keeps one even border) or on its start edge (the danger list). A ghost button and a disabled one have no edge; a
  disabled button is flat `--surface-2` with `--muted` words (never a faded
  colour); an option of a segmented row that is not available recedes
  further: no fill, a dashed `--field-line` border, muted figures. A state chip is a plain fill; only a chip you can tap has a ring.
  Only transform and shadow transition, never a colour, so a theme switch
  never shows text on a half-changed fill.
- **Checkboxes, radios and switches** are the kit's: a 26 px tile on its
  edge, filled with `--accent-fill` and a white tick when checked; a round
  radio with a dot; a setting's checkbox drawn as a switch. The row is the
  44 px target; with forced colours the system draws its own.
- **A lecture's hue** (`data-hue`, `lib/hue.ts`: one of the four lane pops
  from the lecture's id, the same everywhere) is a short rounded strip
  inside the start side of its card in the library and of the meeting band
  (`.a-card[data-hue]::before`). Decoration: the
  title says which lecture it is.
- **Text on solid colour.** Text sits on a solid `background-color`, never
  on a gradient (bars and rings may be gradients: they carry no text), so
  the contrast check reads it true.
- **Celebration.** A right answer's verdict chip pops and a little
  `--confetti` flies out beside it, into the empty room past the chip's end
  (12 px clear of its focus ring, 72 px wide, short of "רק לך"; with a note
  in the row there is no burst, only the pop); a round's end shows its
  score as a big tile, with a band of confetti along its top only for a good
  round (4 of 5 or better: `.pq-end[data-good]`; a weak round is never
  cheered); a finished queue (Today's session, a card review, the quiz's
  end, the boss's result) has a band of confetti above its words (the card
  makes room for it). CSS only, decoration only (`::before`, behind the
  content, never under words, `pointer-events: none`), and a pop never
  pushes past the screen (a popping headline is as wide as its words).
  Under `prefers-reduced-motion` no confetti is drawn at all and nothing
  moves: no fly-in, no pop, no press transition.
- **Motion** is decorative and stops for `prefers-reduced-motion`.
- **The reader stays calm.** No lane colour, confetti or heavy weight in the
  summary's prose; the excitement is in the chrome around it.
- **One font package.** Rubik, self-hosted (`font.css`); no other font and
  no font host at runtime. Icons are inline SVG in the kit's set
  (stroke 2, round caps): home, book, target, users, user, … (the tab
  bar's in `Shell.tsx`, the others in `Icon.tsx`; decorative, beside words).

The e2e flows check most of these at every screenshot (`e2e/study/a11y.cjs`:
contrast, 44 px targets, the primary action, a sheet's controls, horizontal
overflow; light and dark, 390 and 360 px). The look rig (`LOOK-2.md`) also
measures every visible text's contrast on its 36 states in both themes.

## From the old classes

For a branch written before the design system: each old class and what
replaced it.

| Old | Now |
|---|---|
| `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.wide`, `.btn.small` | `.a-btn` with the same modifiers; a square ✕ is `.a-btn.ghost.icon` |
| `.chip` (`.ok`, `.busy`, `.warn`, `.bad`), `.chip-link` | `.a-chip` (same modifiers); a chip that links is `a.a-chip.busy` |
| `.card` | `.a-card` |
| `.sheet-backdrop`, `.sheet`, `.sheet-head` | `.a-scrim`, `.a-sheet`, `.a-sheet-head` (or the `Sheet` component) |
| `.page-head`, `.page-head.sticky` | `.ph-head` (the `Head` component), `.ph-top` |
| `.sticky-actions`, `.fab-bar` | `.ph-foot` (`StickyActions`) |
| `.tabbar`, `.tab` | `.ph-tabs`, `.ph-tab` |
| `.toast` | `.a-toast` |
| `.back-link` | `.ph-head .back` (`BackLink`) |
| `.muted`, `.small` (text), `.error` | `.a-muted`, `.a-small`, `.a-error` |
| `.link-btn` | `.a-link` |
| `.seg`, `.seg-kind` | `.a-seg` with `.a-btn` options |
| `.choice`, `.radio-row`, `.check-row` | `.a-choice` |
| `.field`, a bare `input` or `textarea` | `.a-field`, `.a-input` |
| `.plain-list`, `.row-between`, `.row-wrap` | `ul.a-stack`, `.a-row.between`, `.a-row` |
| `.empty`, `.empty-deck` | `.a-card.dashed` |
| `.callout`, `.callout-extra`, `.callout-warn`, `.callout-lecturer` | `.a-callout.quiet`, `.a-callout`, `.a-callout.warn`, `.a-callout.rec` |
| `.src-tag`, `.src-link`, `.tag-bad` | `.a-tag.src-tag`, `.a-tag.src-link`, `.a-tag.bad` |
| `.bar`, `.gen-bar`, `.review-bar` | `.a-bar` |
| `.eyebrow`, `.lead`, `.pad`, `.center` | gone: a `ph-sub` line, `.a-para.a-muted`, `.loading` |

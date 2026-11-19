# The playful look (look 2)

Branch `study/look-c`, on top of `study/guide` (e7502f4). The study app's
reskin, from the request "אני רוצה עיצוב יותר יפה וחדשני מודרני לאפליקציה
היא קצת משעממת". Three directions were built and shot on the same states
(A: Aurora, B: Editorial, C: Playful). C won; this round carried it to
every screen, grafted the runners-up's best ideas into it, fixed the
critique's list and checked it all.

Nothing to set up: no flag, no SQL, no new setting. It is the app's look
once this branch is merged and deployed.

The reference for every token and component is `design-system.md`. This
page says what changed and why.

## What it looks like

- **Page and colour.** A soft lavender-white page (`#f6f4fd`), white cards,
  one indigo-violet primary (`#5235e8`) and four lane colours: mine
  (violet), the group's (orange), the fun layer's (pink) and "got it"
  (green). Dark is a designed indigo night (`#121022`), not an inverted
  day: surfaces step up in lightness, the lanes glow, the primary stays a
  strong violet fill with white words.
- **Type.** One rounded variable face, Rubik, Hebrew and Latin, self-hosted.
  Titles and numbers at 800; the reader's prose at 380 (360 in dark), 1.75
  leading.
- **Tactile controls.** Everything you can tap stands on a solid bottom
  edge and sinks onto it when pressed; a card that only holds things rests
  flat on a soft shadow. Big radii (14 px controls, 20 px cards, 28 px
  sheets and the flash card).
- **Where the fun is.** Today (icon tiles per queue row in the lane's
  colour, a streak tile, a big start button that stays in reach), practice
  (a bet whose little bars show the scale, a strong green right answer with
  a small CSS confetti burst, a score tile at the end that throws confetti
  only for a good round), cards (lane-coloured grades), the live
  quiz (an orange candy timer, tabular clock), the boss, the wall,
  progress (fat bars, rings). The tab bar has icon tiles; "יחד" turns
  orange. A lane tints only decoration: every primary button and every
  chosen tile is violet, on every screen.
- **The reader stays calm.** No colour in the prose; Na⁺, NaHCO₃ and
  Na⁺/K⁺/2Cl⁻ render cleanly (Rubik, then the system face for the
  sub/superscripts). A tapped paragraph gets a soft panel with room inside
  it and one line of action pills. The tools above it are a quiet tray of pills.

## What this round changed

### Grafts from the runners-up

| From | What | Where |
|---|---|---|
| A | The confidence bet's **scale in bars**: each tile carries one to three little bars; the chosen one fills with the primary. (The first version also tinted the tiles from light to deep; the review round took that out, see below.) CSS only: same buttons, roles, words and e2e selectors. | `kit.css` (`.pq-bets`, `.quiz-bets`, `.m-bets`) |
| A | "שלי"'s on/off settings as **switches**: the same `<input type="checkbox">` with `appearance: none`, drawn as a track and a knob; its row stays the 44 px target, the focus ring stays. | `kit.css` (`.setting-check input`) |
| A | The reader's top tools as **one tray of pills** (תוכן, א-, א+, שיתוף), and the room's "להקריא לקבוצה" / "שאלות" as pills of the same kind. | `study.css` |
| B | **Tabular display numerals** for the few big numbers: the band's hour, the quiz's clock and "שאלה 1 מתוך 7", practice's "1/5". Rubik 800, no second face. | `meeting.css`, `quiz.css`, `practice.css` |
| B | **A lecture's hue**: `lib/hue.ts` maps a lecture id to one of the four lane pops, the same on every screen and device, as a short rounded strip inside the start side of its library card and of the meeting band (`data-hue`; decoration only). | `lib/hue.ts` (+ test), `Library.tsx`, `MeetingBand.tsx`, `kit.css` |
| B | **Underlined text links**: a thick (2.5 px), offset underline in the lane's bright colour on every standalone `.a-link` ("לפגישה של היום", "לא יודעים", "כל העזרה"), so a link never relies on colour alone. | `kit.css` |

### The critique's must-fixes

| Finding | Fix |
|---|---|
| Reader: at 390 px "לשאול" dropped to a line of its own | `.blk-actions` is one non-wrapping line of pills sharing the width (smaller gap and padding, 40 px pills with the kit's 44 px hit area). One line at 360 and 390. |
| Today at 360×640: start bar + tab bar about 140 px, a fade over the tags | The streak tile is 46 px and inline with the 50 px button; the bar is about 70 px with a 6 px fade; `scroll-padding-bottom` keeps a row brought into view clear of it. |
| "שלי": bare oversized checkboxes | Switches (above), with a designed on and off state in both themes. |
| Reader top toolbar: bare text buttons | The tray of pills (above). |
| Practice: confetti over "רק לך" and the bar | The burst sits beside the verdict's chip only, in the empty room before "רק לך" (no burst when a note shares the row), `pointer-events: none`, and it is not drawn at all under reduced motion. Every other celebration (the score, Today's done, the cards' end, the quiz's end, the boss's win) is a band of confetti above its words. |
| Flash card: a large empty band | `main.review .card-panel` is 220–300 px (30% of the screen) with its words centred. |
| The orange "יחד" tab | Kept, on purpose, and documented in `design-system.md`: the group's tab wears the group's lane. Its word is `--group-text`: 5.9:1 on the tab bar in light, 8.4:1 in dark. |
| Contrast of tinted notes | Text: every visible text on the 36 rig states measured at 4.5:1 or more (3:1 large) in both themes (`--contrast`, 0 failures). Strips: the light theme's strips were 1.7–2.8:1, now 3:1 or more on their tint and on the surface (`--extra-line`, `--warn-line`, `--lecturer-line` deepened; new `--fun-strip`, `--group-strip` for the wall's hint and the quiz's "בלי שמות"). The letter tiles on unselected answers are `--chip-ink` on `--surface-2` (passes). |

### Every screen

Every feature stylesheet was gone through (anchor, boss, cards, collab,
extras, guide, meeting, museum, plan, practice, progress, pulse, quiz,
today, var, wall, writing, study.css), and every e2e screenshot was looked
at in light and dark. Beyond the fixes above:

- **Lane cards** (Today's group cards, a plan's day and the eve, the
  museum, the pulse's brief, the boss's result and loot, the wall's winner
  and first draft, a correction, a "דינג" in the meeting) use the new
  `--me-line`, `--group-line`, `--fun-line` and `--ok-line`: the lane's
  bright colour softened, instead of a heavy dark frame.
- **The group's screens** (the meeting, the live quiz and its setup) wear
  the group's orange section tiles, as "יחד" does; their buttons and
  chosen tiles stay violet.
- **Radios** are the kit's round tiles; a chosen chip radio (the boss's
  lectures and seconds) is violet and wears a ring; the boss's second
  chips are pills, not circles.
- **The wall's tabs** are text tabs, the chosen one bold on a pink bar.
- **Errors**: an error line is a soft red panel with a drawn "!" tile;
  Today's load error is one red-tinted box with the tile, the sentence and
  "לנסות שוב".
- **Loading** ("טוען…") sits under three lane dots that take turns to
  light up.
- **Upload**: the drop zone has my lane's tile with an upload arrow and a
  faint violet wash.
- **Sheets** are up to 85% of the screen tall (so the wall's "לנעוץ" shows at
  390×844 without scrolling) with an 18 px top over the grip.
- **Top bar titles** take up to three lines (16 px under 375 px wide), so
  "אסוציאציות · משתנים (Diuretics)" is never cut at 360.
- **Print**: the reader's ink and weight are `@media screen` only, so device
  printing keeps the print layout's own ink (writing.cjs B5).
- **The quiz's right-answer headline** is as wide as its words, so its pop
  never makes the page 2 px wider than the screen.

No text, aria, role or e2e selector changed. The only markup changes are
the `data-hue` attribute on the library's cards and the meeting band, and
(review round) `data-good` on practice's end of a round.

## Tokens added or changed in this round

| Token | Light | Dark |
|---|---|---|
| `--me-line`, `--group-line`, `--fun-line`, `--ok-line` | the pop 60–72% toward `--line` | same |
| `--fun-strip` / `--group-strip` | `#e5418a` / `#d95f1f` | `--fun-pop` / `--group-pop` |
| `--extra-line` | `#7aa7f0` → `#4f86dc` | unchanged |
| `--warn-line` | `#f0b400` → `#b88200` | unchanged |
| `--lecturer-line` | `#f08bb5` → `#d6528a` | unchanged |

Removed, because nothing read them any more: `--me` (its two readers now
use `--me-line`), `--shadow` (every pressable thing writes its own edge),
`--warn-ink` and the first round's unused `--lane-strip`; in the review
round, `--bet-1`, `--bet-2` and `--bet-3` (the bet's tiles are neutral now).
Every token left in `tokens.css` is read somewhere.

## The font

- **Rubik**, variable (weight 300–900), from `@fontsource-variable/rubik`
  5.3.0 (a dev dependency: the build copies its files, nothing of it is in
  the JS).
- Licence: **SIL Open Font License 1.1** (Copyright 2015 The Rubik Project
  Authors). Free to use, embed and self-host; the licence travels with the
  package (`node_modules/@fontsource-variable/rubik/LICENSE`).
- Only two subsets, `font-display: swap`: `rubik-hebrew-wght-normal.woff2`
  (9,348 bytes) and `rubik-latin-wght-normal.woff2` (35,348 bytes), 44,696
  bytes in all, fetched from the app's own `/assets/`. The system face
  (`system-ui`, then `Arial Hebrew`) draws the first paint and every glyph
  the subsets lack (⁺ ⁻ ₂ ₃ ← → ≤ ≥ α β).
- No font comes from another host at runtime: `study/index.html` has no
  Google Fonts link (the baseline's Frank Ruhl Libre and IBM Plex Sans
  Hebrew links are gone) and the built page names no external URL. The
  e2e mock answers only its own origin and fails any unmocked call.
- Printing: the print layout, `shared/study/print-css.ts`, names IBM Plex
  Sans Hebrew and Frank Ruhl Libre first, for the server's PDF, where the
  server supplies them. The baseline page loaded both from Google Fonts,
  so a phone's own printing ("הדפסה מהמכשיר") used them too; this page no
  longer loads them, so each print stack now names "Rubik Variable" next
  (the body, the page footer and the title page), and device printing
  uses the face the app has already loaded rather than a generic one.

## Review round (18 Nov 2026)

Two reviews of the finished look (a design pass, C-1 to C-11, and an
accessibility pass, C1 to C4). Each finding was checked on the shots and
in the code before it was fixed; all fifteen held, none was rejected.

| Finding | Checked | Fixed how |
|---|---|---|
| C-1 (major): the end of a round threw confetti whatever the score ("1 מתוך 5" too) | Yes: the confetti rule read only `prefers-reduced-motion` | `PracticeSession` marks a good round, 4 of 5 or better (`data-good` on `.pq-end`); only `.pq-end[data-good]` draws `--confetti-lg` and makes room for it. A weak round is the plain tile. Shot both: rig 22 (0 of 5, plain) and a variant with 5 of 5 (confetti). |
| C-2 (major): "על בטוח" was the deepest tile with a violet edge before any choice, reading as recommended | Yes | The three bet tiles are the same neutral surface and border; only their one, two or three bars show the scale, and the chosen one fills violet. `--bet-1…3` are gone. Practice, the quiz and the meeting share the rule (`kit.css`). |
| C-3: three "chosen" colours and an orange primary on "יחד" while the flows it opens are violet | Yes | One rule: a lane tints only decoration (section tiles, strips, timers, confetti); every primary and every chosen tile or chip is the accent. "יחד"'s primary is violet; a chosen radio chip is the accent's soft fill with its ring, so the boss's "כל ההרצאות" and "45" match each other and the other chip radios. |
| C-4: the tapped paragraph's frame sat 4 px from the words and the pills | Yes | `.blk-selected` (paragraphs, list items, headings) has 8/10 px of padding inside the well, pushed into the gutter by an equal negative margin (lines keep their breaks); the frame is at offset 0, `--field-line` as before. |
| C-5: at 360×640 the sticky start bar left 1.5 rows of the queue | Yes | Under `max-height: 700px` the bar does not stick: it follows the queue, 48 px, with no fade; the band is a little tighter under 375 px. Three rows show at 360×640 (the baseline, with no bar, showed six). |
| C-6: the hue and the wall's pink as thick borders that taper into the radius | Yes | Drawn as their own shapes inside the card: a 5 px rounded strip inset from the corners on the start side (`.a-card[data-hue]::before`, the library and the meeting band), a 5 px rounded bar inside a wall note's top. Each card keeps one even border. |
| C-7: the wall's filter mixed a pill with "·" separators | Yes | Text tabs: the separators are hidden (they were `aria-hidden` decoration), the chosen tab is bold ink on a 3 px `--fun-strip` bar. 44 px targets. |
| C-8: Today's error was a red frame around a red box | Yes | One container: the card is the bad tint with the "!" tile, the sentence and "לנסות שוב" under the words. |
| C-9: the quiz setup's unavailable counts looked soft-selected | Yes | A disabled tile in a segmented row recedes: no fill, a dashed `--field-line` border, muted figures at 500. |
| C-10: a confetti dot landed on the verdict's focus ring | Yes | The burst is the chip's own `::after`, starting 12 px past the chip's end (the ring is 5 px) and 72 px wide, short of "רק לך" at 360. |
| C-11: an empty `@media` block in `boss.css` | Yes | Deleted. |
| C1 (major): text fields had `outline: none`, so forced colours showed no focus | Yes: forced colours gave `outline: none`, `box-shadow: none` | The rule is gone: a field takes the kit's 3 px accent outline like every control, plus its accent border; the soft halo is dropped. Probe: `outline: solid` on the join field and help's search, in both themes and under forced colours. |
| C2: the reader's action row faded over 15% of its width, more than its 32 px end padding, dimming the last chip | Yes | The fade is a fixed 24 px. Probe, scrolled to the end: the last chip starts 32 px from the edge, 8 px clear of the fade, its ring too, at 390 and 360. |
| C3: device printing lost its faces when the Google Fonts link went | Yes | Each print stack names "Rubik Variable" after the server's face (body, footer, title page); the sentence above was corrected. |
| C4: the error tile's "!" was generated text, read out at the start of every `role=alert` | Yes | `content: ""`; the "!" is an inline SVG background in `--pop-ink`. No generated text is left in the look's CSS. |

## The look rig

`look/shoot.cjs` (in the session's scratchpad, not in the repo) shoots a
fixed list of states in light and dark on the worktree's own e2e mock.
States 1–20 keep their ids. This round added 21–36 so the shoot covers the
rest of the app: a right answer's burst, a round's end, join without an
invite, upload, help, the cards' home, the quiz's setup, the meeting, the
boss, the museum, the plan, the pulse, a paragraph's sheet, a toast, an
error state (a read failed on purpose) and a switch turned on. It also
gained `--contrast`, which measures every visible text's contrast in each
scheme. State 08 now always picks a wrong option (the options' order is
not fixed). The final shoot is `look/final/` (36 states, 70 images).

## Checks (final code of this branch, after the review round)

| Check | Result |
|---|---|
| `npm run test:study` | 727 tests, 727 pass, 0 fail (the guide round's 726 and `hue.test.ts`). |
| `npm run test:contract` | 196 RPC calls and 116 table chains in 221 files match the schema. `schema-dump.json` is unchanged: no RPC, table or column added. |
| `npm run build` | passes. The study entry is 345.64 kB (357,741 bytes, the same as before the review round: `data-good` sits in practice's lazy chunk; the guide round's entry was 357,609, the difference is the hue helper). The study CSS is 81,778 bytes (82,185 before the review round). Fonts: 9,348 + 35,348 bytes of woff2, assets, not JS. |
| `npm run test:bundle` | every flag on: 358,396 bytes (limit 400,000). The font, the tokens and the kit add 0 bytes of JS. |
| e2e, 22 scripts × `off`, `rel1`, `w4`, `w5`, `w5x`, `guide`, plus `guide.cjs` on `guide1` (133 runs, three at a time) | run again on the review round's code: all 133 exit 0 on the first try, with no page error, no unmocked or refused call and no a11y problem; every script's "ok" count is the same as the round before (the table below). |
| `guide.cjs` on `guide1` | 7 ok. |
| the look rig, 36 states × light and dark (70 images, `look/final/`, shot again after the review round) | 0 failed, 0 page errors, 0 refused writes, no horizontal overflow, and `--contrast` found no text under 4.5:1 (3:1 large) in either theme. A variant of state 22 with every answer right (5 of 5) shows the round's confetti; the rig's own 22 (a weak round) shows the plain tile. |
| focus and fade probes | the join field and help's search: a solid outline when focused, in both themes and under forced colours. The reader's action row scrolled to its end: the last chip starts 32 px from the edge, past the 24 px fade, at 390 and 360. |

The matrix (exit, "ok" checks):

| script | off | rel1 | w4 | w5 | w5x | guide |
|---|---|---|---|---|---|---|
| `ahead.cjs` | pass, 3 | pass, 11 | pass, 11 | pass, 11 | pass, 11 | pass, 11 |
| `anchor.cjs` | pass, 3 | pass, 3 | pass, 18 | pass, 18 | pass, 18 | pass, 18 |
| `boss.cjs` | pass, 3 | pass, 3 | pass, 3 | pass, 3 | pass, 40 | pass, 40 |
| `cards.cjs` | pass, 2 | pass, 26 | pass, 26 | pass, 37 | pass, 37 | pass, 37 |
| `collab.cjs` | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 |
| `extras.cjs` | pass, 5 | pass, 5 | pass, 5 | pass, 5 | pass, 42 | pass, 42 |
| `guide.cjs` | pass, 9 | pass, 9 | pass, 9 | pass, 8 | pass, 8 | pass, 72 |
| `meeting.cjs` | pass, 4 | pass, 4 | pass, 53 | pass, 53 | pass, 53 | pass, 53 |
| `museum.cjs` | pass, 3 | pass, 3 | pass, 3 | pass, 3 | pass, 26 | pass, 26 |
| `plan.cjs` | pass, 5 | pass, 5 | pass, 5 | pass, 6 | pass, 69 | pass, 69 |
| `practice.cjs` | pass, 3 | pass, 57 | pass, 57 | pass, 57 | pass, 57 | pass, 57 |
| `progress.cjs` | pass, 5 | pass, 5 | pass, 5 | pass, 38 | pass, 38 | pass, 38 |
| `pulse.cjs` | pass, 4 | pass, 4 | pass, 5 | pass, 44 | pass, 44 | pass, 44 |
| `quiz.cjs` | pass, 2 | pass, 2 | pass, 47 | pass, 47 | pass, 47 | pass, 47 |
| `shell.cjs` | pass, 31 | pass, 30 | pass, 31 | pass, 31 | pass, 31 | pass, 31 |
| `summary.cjs` | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 |
| `today.cjs` | pass, 4 | pass, 4 | pass, 4 | pass, 54 | pass, 54 | pass, 54 |
| `together.cjs` | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 |
| `upload.cjs` | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 | pass, 0 |
| `var.cjs` | pass, 4 | pass, 4 | pass, 37 | pass, 38 | pass, 38 | pass, 38 |
| `wall.cjs` | pass, 5 | pass, 5 | pass, 36 | pass, 36 | pass, 36 | pass, 36 |
| `writing.cjs` | pass, 42 | pass, 42 | pass, 42 | pass, 42 | pass, 42 | pass, 42 |


## לסיכום (ליועד)

**איך זה נראה עכשיו:** האפליקציה קיבלה מראה חדש, משחקי ומודרני. הרקע לבנדר
בהיר, הכרטיסים לבנים ומעוגלים, הצבע הראשי סגול, ולכל "מסלול" צבע משלו:
שלי סגול, הקבוצה כתום, הכיף ורוד, ו"הבנתי" ירוק. צבע המסלול הוא קישוט בלבד
(סימני כותרות, פסים, טיימרים); כל כפתור ראשי וכל בחירה הם תמיד בסגול. הכפתורים
"נלחצים" כמו כפתורים אמיתיים. הגופן החדש הוא Rubik, עגול וקריא, בעברית
ובאנגלית. ב"היום" לכל שורה בתור יש אייקון צבעוני, ויש אריח רצף (להבה) וכפתור
התחלה גדול. בתרגול שלושת אריחי ההימור שווים, ורק פסים קטנים (אחד, שניים,
שלושה) מראים את הסולם, כדי שאף הימור לא ייראה כמו המלצה. תשובה נכונה מקבלת
ירוק חזק וקונפטי קטן, ובסוף סבב יש קונפטי רק כשהסבב היה טוב (4 מתוך 5 ומעלה).
לכל הרצאה יש צבע קבוע משלה, פס קטן בכרטיס שלה בספרייה ובפגישה. ההגדרות
ב"שלי" הן מתגים. הקורא נשאר רגוע ונקי לקריאה ארוכה, פסקה שנבחרה מקבלת מסגרת
מרווחת, והכלים שמעליו הם שורת כפתורים מסודרת. יש מצב כהה מעוצב (לא הפוך),
וכשמבקשים בטלפון "להפחית תנועה" אין אנימציות ואין קונפטי.

**מה תוקן בסבב הביקורת:** 15 הערות, כולן נבדקו ותוקנו: קונפטי רק לסבב טוב,
הימור בלי "המלצה", צבע אחיד לבחירות ולכפתורים, מסגרת מרווחת לפסקה שנבחרה,
יותר מקום לתור ב"היום" בטלפון קטן, פסי צבע נקיים בכרטיסים, לשוניות פשוטות
בקיר, הודעת שגיאה בקופסה אחת, אפשרויות לא זמינות שנראות כבויות, טבעת
המיקוד חזרה לשדות הטקסט (גם במצב ניגודיות גבוהה), השורה הנגללת בקורא כבר
לא מעמעמת את הכפתור האחרון, הדפסה מהמכשיר בגופן של האפליקציה, וקורא המסך
לא מקריא "!" לפני כל הודעת שגיאה.

**מה צריך להגדיר:** כלום. אין דגל, אין SQL, אין הגדרה חדשה. אחרי המיזוג
והפריסה זה פשוט המראה של האפליקציה.

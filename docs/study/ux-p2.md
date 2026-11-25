# Cross-device layout, P2: tablets and desktops

Branch `dev`, 25 Nov 2026. The cross-device audit found one layout for every
size: a 760 px phone column in the middle of an iPad or a 1920 px screen,
the tab bar stretched across it, 86-letter lines in the reader, bottom
sheets under a full-screen scrim and the primary action 300–500 px under
the options. This page is what was built for it: P2 of the audit's plan
(WP9 to WP12, and the part of WP13 the owner chose: the keys' hint). P1 is
[`ux-p1.md`](ux-p1.md).

No new flag and no SQL. Phones (under 600 px wide) look as before: see
"Phones" below for how that was checked.

## The owner's decisions applied

- A side rail from 1024 px; phones unchanged.
- The reading size starts at 19 px from 768 px when the member never chose one.
- The reader's line is `--measure-read`, 36em.
- A wide button alone in a screen stops at 480 px on a tablet or a desktop.
- No library split view.
- The keys on a desktop: 1–6 pick an option, Enter checks, Escape closes a
  sheet (all already there), with one small line shown only with a mouse.
- A practice question's picture on a desktop is capped, not set beside the
  options.
- Today: the tour card under the queue (P1), the 760 column kept.

## Breakpoints (`styles/tokens.css`)

By the window's width, never by device: an iPad in Split View or Stage
Manager and a desktop window can be any width.

| Name | Width | What changes |
|---|---|---|
| S | under 600 | nothing: the phone layout |
| M | 600–1023 | the tabs together in the middle of the bottom bar; wide buttons at most 480; prose at 70ch |
| (tablet) | 768 and up | the reading size starts at 19 px; the bottom bar follows the content; sheets become dialogs (and 560 tall) |
| L | 1024 and up | the side rail; the reader's contents beside the text; a practice picture at most half the screen tall |
| XL | 1280 and up | the library's lectures in two columns |

New tokens: `--measure-read` (36em), `--measure-wide` (1040 px), `--sheet-w`
(560 px), `--rail-w` (0, 88 px at L).

## WP9. The tab bar, the rail, the bottom bar

- **M** (`kit.css`): the bar stays at the bottom, its four tabs at most
  120 px each, together in the middle (they were 200 px apart on an iPad).
- **L**: the bar is a rail, 88 px, down the start side (the right), from the
  top of the screen to its bottom, with the same tiles, words, lanes and
  `aria-current` top to bottom, and a line at its inner edge. `--tabbar-h`
  is 0 there, so every rule that keeps room for the bar at the bottom lets it
  go at once: a screen's padding, the bottom bar's place, the toast, the
  scroll padding and Today's "להתחיל". `body.has-tabs .shell` moves over by
  `--rail-w`; the toast and the guide's bubble move with it. The rail's
  tiles keep their focus ring; it comes first in the tab order, as the bar
  did. The guide measures what is taken at the bottom from the bars' tops,
  so a rail (top 0) takes nothing.
- **The bottom bar** (`.ph-foot`) from 768: `margin-top: 16px` instead of
  `auto`, so "לבדוק" sits right under the question instead of at the
  bottom of a tall screen; it still sticks to the bottom when the content
  is longer.
- **Hover**: the tab tile's and the back pill's tints only under
  `(hover: hover)`: on a touch screen they stuck after a tap.

## WP10. The reader

- **Lines**: `.summary p, li` stop at `--measure-read` (36em) instead of
  68ch, which never limited Hebrew (it was 728 px, 86 letters). About 610 px
  at 17 px, 684 px at 19 px.
- **Size**: from 768 the reading size starts at 19 px (`tokens.css`) while a
  member has not chosen one. A chosen size is written on the root's own style
  and wins; `StudyApp` now sets only a chosen size, so a window that changes
  width follows the default. `readSize()` (`Shell.tsx`) says the same
  (`storedSize() ?? defaultSize()`) for "שלי" and the reader's א- א+. The
  sizes stay 15/17/19/21. The size also drives practice, the quiz and the
  cards, which read better bigger on a tablet too.
- **Contents** from 1024 (`LectureView.tsx`, `lib/useMedia.ts`): always
  shown, a sticky column 240 px wide at the start of the text, under the
  top bar, scrolling on its own when longer than the screen; "תוכן" leaves
  the top bar ("א-", "א+" and "שיתוף" stay). `main.lecture` is a grid of
  the column and the text, `--measure-wide`; its rows have no gap (a column
  spanning them would add each gap under the text), the blocks keep the
  screen's 10 px by a margin. A click on a heading scrolls it under the top
  bar, as before. On a phone the contents still open inside the sticky top
  bar (P1, WP6): a panel that is in view wherever the reader has scrolled.
- **Prose elsewhere** (`study.css`): from 600, `.a-para`, `.a-small`,
  `.pq-vignette` and a callout's `p` stop at 70ch, weakly (`:where`), so a
  screen's own measure (the reader's 36em) wins.

## WP11. Sheets as dialogs (`kit.css`)

- On a screen 768 wide and 560 tall and up: in the middle of the screen,
  `--sheet-w` (560) wide, at most `min(85dvh, 760px)` tall, a border, four
  rounded corners, the pop shadow, and no grip. Its behaviour is the
  sheet's own (`useSheet`): Escape, the scrim, Back and the focus kept
  inside. No component changed.
- A sheet of a picture takes `--measure` (760): `.slide-sheet`, `.qf-sheet`,
  `.geo-sheet`, `.fix-sheet`.
- With a mouse (`pointer: fine`) a bottom sheet has no grip either: nothing
  is dragged.
- The exam's grid sheet keeps its own `82dvh`.

## WP12. Using the width

- **Wide buttons** (`kit.css`): from 600, a `main .a-btn` alone in a
  screen (a `.wide` one, or one its card or stack stretches) stops at
  480 px at the start of its row; in the bottom bar, an `.a-row` or a sheet
  it keeps filling. The course page's 674 px buttons are 480, and so are
  "לקבוע את הפגישה הבאה", "יצירת קוד אישי" and "מבחן קבוצתי חדש".
- **The library** at 1280: `--measure-wide`, the lectures in
  `repeat(auto-fill, minmax(340px, 1fr))`; the head, the ask bar and the
  courses' headings stay one column.
- **An exam's review** from 600 (`exams.css`): the page's crop beside the
  question is 42% of the card and at least 220 px (it was 104 px).
- **A practice question's picture** from 1024 (`qtypes.css`,
  `QuestionFigure.tsx`): at most `min(50vh, 520px)` tall, centred, its
  width from its ratio (`--qf-ar` on the figure), so the options under it
  stay in view. The pins' spacing is measured on the same figure, so a
  dense drawing still widens and scrolls sideways. "להגדיל" shows it big.

## WP13, the keys' hint

`PracticeSession` already took 1–6 and Enter (and the sheets Escape). Under
the options of a practice session, `PracticeQuestion` (prop `keys`) now
shows "במקלדת: 1–4 לבחירה · Enter לבדיקה" (the number is the options'
count, at most 6), `.pq-keys`, shown only under `(hover: hover) and
(pointer: fine)`. Not for a set answer (true/false, match, order) or a
picture's numbers, whose keys differ. Today's session, the catch-up and the
sandbox do not take the keys, so they show no line.

## Phones

Every screen shot at 320 (iPhone SE), 393 (iPhone 15) and 430 (iPhone 15
Pro Max), light and dark, before (`6cd5a7f`) and after, with the same mock,
compared pixel by pixel (`scratchpad/install-devices/p2/shots.cjs` and
`diff.py`): 14 screens (join, Today, the library, the reader, its contents,
a slide's sheet, the course, practice before and after a pick, a picture
question, practice's home, יחד, שלי, help).
- The viewport shots are identical, except the order of a practice
  question's options and statements, which is random per session and
  differs between two runs of the same build too.
- Full-page shots differ only in the sheet's grip and the keys line:
  Chromium drops its touch emulation while it takes a full-page capture,
  so `(pointer: fine)` matches during it. A phone never matches it.
- A phone held sideways (wider than 600 or 768) gets the M and tablet rules:
  the tabs in the middle, wide buttons at 480, the 19 px default and the
  bottom bar under the content. It is under 560 tall, so its sheets stay
  bottom sheets.

## Tests

- e2e `e2e/study/wide.cjs` (`E2E_FLAGS=s2`): phones as before (the bar
  along the bottom, 17 px, "תוכן", a bottom sheet with its grip, the bottom
  bar at the bottom, no keys line); M on iPad gen 7 and iPad Pro 11 upright
  (the tabs in the middle, 19 px and a chosen 17, lines at most 684, a
  slide's sheet and a words sheet as dialogs, "לבדוק" under the question,
  the course's buttons at most 480); L on iPad Pro 11 sideways, 1280 and
  1920 (the rail, one or two library columns, the contents column and a
  click in it, Escape, the keys line with a mouse only, 2 and Enter, the
  picture's cap). a11y.cjs's checks in light and dark on the wide screens.
- shell.cjs's tab-order check compares x, and runs at phone widths only.

## To check on a real iPad (WebKit is not installed here)

- The rail in Safari and the home-screen app, sideways, with Stage Manager
  windows of different widths; the safe area at the rail's side (it pads
  top and bottom only).
- The sticky contents column and its own scroll.
- `color-mix()` (iPadOS 16.2, the accepted minimum) and `:where()`.

## Not in P2

- The type scale (secondary text 14 px, tab labels 13–14 px), hover states
  on every card and row, the Hebrew letter keys, "/" and "[ ]", the roving
  tab stops in the reader, the exam simulation's keys and the exam upload's
  drag and drop: P3 or a later package.
- The dimmed figure stage in dark mode (P3, WP16).

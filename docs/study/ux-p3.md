# Cross-device polish, P3, and the devices suite

Branch `dev`, 25 Nov 2026. P3 of the cross-device audit's plan (WP14 to
WP16), and `e2e/study/devices.cjs`, the suite the plan asked every package
to run. P1 is [`ux-p1.md`](ux-p1.md), P2 [`ux-p2.md`](ux-p2.md).

No new flag and no SQL. `VITE_STUDY_INSTALL` (the install package) is still
the only flag to add to production's list.

## The owner's decisions applied here

- Secondary text 14 px; the tab bar's labels 13 px on phones, 14 from 768.
- The figure stage in dark mode a step under pure white, not white.
- Practice photo questions on a desktop: the figure capped (P2), and now
  never wider than the photo's own pixels.
- iOS 16.2 is the minimum (`color-mix()`); nothing here adds a newer need.

## WP14, the type scale (`styles/tokens.css`)

| Token | Was | Now |
|---|---|---|
| `--text-small` | 13.5 px | 14 px |
| `--text-chip` | 13 px | 14 px |
| `--text-tag` | 12 px | 13 px, 14 from 768 |
| `--text-tab` | 12 px | 13 px, 14 from 768 |

Elements that had their own size under these: `.a-table` (now
`--text-small`, its head the same size, bold and muted), `.a-grade small`,
`.s-len small`, a badge, a card's interval (`--text-tag`), the exam
review's options (the body size), the simulation's grid (`--text-small`),
a field's and a choice's `<small>` note (`--text-small`; the browser's own
`smaller` was 13.3 px), the summary's table head (the table's size), the
upload's small print, and join's two tiles under 360 px (13 px, was 12.5;
the join card's sides are 12 px there, so the labels keep 6 px to the
tiles' edges, as `shell.cjs` asks).

What stays under 13 px, on purpose: a figure's own pins and drawn labels
(they are part of the picture and scale with it).

## WP15, small phones

- **Join** (`Join.tsx`, `study.css`):
  - under 640 px tall, a compact hero, so the name, the code and
    "הצטרפות" show on an iPhone SE without scrolling;
  - `enterKeyHint` ("next" on the name until the code is there, "go" on the
    code and the group's name);
  - the field an error is about gets `aria-invalid`, the error's id
    (`aria-describedby`) and the focus;
  - the code's placeholder is lighter than a typed code;
  - the server-not-ready errors no longer name Supabase settings or SQL
    files: one line for the member, the cause in the console.
- **First steps at 320 px** (`guide.css`): the list loses its inner frame
  and "להראות" goes under the step's words.
- **The live banner**: who is in takes two lines before it is cut.
- **A tab's home**: its taller top bar (about 70 px) is in the scroll
  padding, so what is brought into view is not 14 px under it (a CSS rule,
  no observer: nothing added to the entry chunk).
- **Sections** (`.a-sec`) wrap: a name and its note take two lines on a
  small phone (the quiz lobby's "ממתינים להתחלה").
- "(≈ ₪45)" never breaks inside its brackets; "ב-Anki" is one run (no gap
  from the button's flex gap).
- Already there from P1/P2, checked, not changed: `.pq-label` keeps two
  lines; the reader's tools are compact under 375 px.

## WP16, small extras

- **Exams**
  - Pages that were not read are said at the top of the review's summary,
    with "לנסות שוב" (the same re-read as the row's); the row's state is a
    warning chip.
  - A simulation's result: wrong picks under "הטעויות", questions with no
    pick under "לא נענו"; a row that opens has a chevron that turns when
    it is open, and a hover tint with a mouse.
  - The review's filter chips show their edge (`--field-line`) when not
    picked.
  - Upload: "שנה" and "מועד" labels on one line.
- **Practice**: in dark mode the figure stage is `--figure-stage` (#e6e6e6, the picture's white at 90%, so no box shows) and its picture at
  90% brightness; a photo question is never wider than the photo.
- **Navigation**: the plan (every state) and "ההתקדמות שלי" have a way
  back (to יחד, or to שלי for one's own lane); a live quiz's end has one way
  out, "חזרה ליחד", as its top bar.
- **Reader**: a picture in the summary is a button that opens its slide's
  sheet; in dark mode it is at 92% brightness. While a paragraph is picked,
  or a sheet opened from it is up, the page does not re-anchor
  (`overflow-anchor: none`): the browser's scroll anchoring held a
  paragraph below still and so lifted the tapped one by its actions' height
  (64 px), and dropped it again when they went. `shell.cjs`'s "a sheet
  closed by Back keeps the reader's place" caught it once the 14 px text
  moved the paragraphs.
- **Library**: a stuck lecture's card has "המשך כתיבה" beside its chips.

## `e2e/study/devices.cjs`

```
NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/devices.cjs <dist> <out dir>
DEVICES=iphone-se,desktop-1280 SCREENS=join,reader DARK=all   # to split a run
```

- **Devices**: iPhone SE, iPhone 15, iPhone 15 Pro Max, Pixel 7, iPad Pro 11
  upright and sideways, a computer at 1280×800 and 1920×1080 (a mouse).
- **Screens**: join (a visitor's), Today, the library, the reader, the
  contents after scrolling (opened from the top bar on a phone, the side
  column from 1024), a slide's sheet, a course, a practice session after a
  pick and a bet, יחד, שלי, the install steps, the personal code's card.
- **Schemes**: light everywhere; dark on iPhone 15, Pixel 7, the iPad
  sideways and the 1280 computer (`DARK=all` for every device). The full
  run takes about three minutes (170 s here), 144 screenshots.
- **It fails on**:
  - a sideways scroll: `innerWidth` other than the device's width (Chromium
    zooms out to fit a wider page) or `scrollWidth` over `innerWidth`;
  - a11y.cjs's problems (a control's contrast, a title cut, a sheet's
    tap-through), and a hit area under 44×44 on a touch screen;
  - read text under 14 px: anything under 13, and 13 only for the labels the
    scale sets there (tabs, slide tags, a grade's interval, a length's
    count, badges, join's tiles under 360);
  - any text under 4.5:1 (3:1 large) on a plain background, text a bar, a
    panel or a backdrop covers skipped, a disabled control exempt;
  - a primary action off screen: join's "הצטרפות", practice's "לבדוק"
    after a bet, a sheet not wholly on screen;
  - a console error, a page error or any mock problem;
  - a focused control under the tab bar, the rail, a bottom bar or a top
    bar in a Tab walk (iPads, computers, and iPhone 15);
  - the frame: the rail 88 wide from 1024, the reader's lines at most 684 px
    from 768, a sheet in the middle from 768 (and 560 tall), a course's wide
    buttons at most 480 from 600, "לבדוק" near the options on an iPad.
- **Before P3** the same suite failed every screen on every device: tab
  labels at 12 px, meta lines and chips at 13–13.5, slide tags at 12.2, and
  join's "הצטרפות" at 550–602 on the SE's 568 px screen.
- Transitions are off while it measures (a colour half way between the
  schemes read as a contrast failure).

## Not checked here

WebKit is not installed: iPhone and iPad Safari (the real keyboard, insets,
`dvh`, `-webkit-line-clamp` on the banner) need a device.

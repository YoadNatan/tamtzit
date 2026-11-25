# Cross-device fixes, P1: what was broken on a device

Branch `dev`, 25 Nov 2026. The cross-device audit (taken at `3817e8b`, every
screen on iPhone SE, iPhone 15, iPhone 15 Pro Max, Pixel 7, iPad and two
computers, light and dark) found problems that break the app on at least one
device. This page is what was built for them: work packages WP1 and WP3 to
WP8 of the audit's plan. WP2 (the home screen, no service worker) is
[`install.md`](install.md). The tablet and desktop layout (side rail,
reading width, sheets as dialogs, hover, keys, type scale) is P2 and P3, not
here.

No new flag and no SQL: every change is a fix to what is already on.

## WP1. No connection, and screens that fail to load

- **Startup with the API down** (`StudyApp.tsx`). A member with a session
  whose groups cannot be read (or whose session needs a refresh that cannot
  reach the server, `getSessionState()` in `lib/api.ts`) gets the
  connection's gate (`ConnectionGate` in `Shell.tsx`): "אין חיבור כרגע…",
  "הקבוצה תיפתח מעצמה כשהחיבור יחזור.", "לנסות שוב". The window's `online`
  event retries by itself. Join is shown only when the groups came back
  empty. A re-read that fails while a group is already on screen (a token
  refresh) leaves the screen as it is.
- **A screen that fails** (`components/ErrorBoundary.tsx`). Around the routed
  screen and around the guide's layer (which shows nothing when it fails). A
  lazy chunk that cannot be fetched shows "המסך לא נטען…" with "לנסות שוב"
  instead of an empty page, and a screen that throws while online shows
  "משהו השתבש במסך הזה…"; the tab bar stays and another tab clears it. A
  chunk gone after a deploy still reloads the page once
  (`lib/staleChunk.ts`), but never offline, where a reload would only bring
  the browser's error page: there, "לנסות שוב" says "עדיין אין חיבור…", and
  the connection's return reloads, only for a visible screen whose code was
  missing (never for the guide's hidden layer, nor for a screen that threw,
  so a phone changing networks does not reload under the member's typing). `retryImport()` tries a
  lazy screen's import once more after 0.8 s (StudyApp's own screens).
  `vite:preloadError` is no longer prevented: prevented, Vite handed React an
  empty module ("reading 'default'").
- **The library** shows its error with `role="alert"` and "לנסות שוב", and no
  "טוען…" beside it. **"יחד"** hides "לקבוע את הפגישה הבאה" until the
  meetings are known.
- **Offline**, one line at the top of the shell: "אין חיבור. מה שכבר נטען
  נשאר כאן." (it takes the notch; the live banner under it does not).

## WP3. Bidi

- `isolateLatin` (`lib/rich.tsx`) wraps a string with no Hebrew at all (a
  table cell "1 h", a bold "Proximal tubule:", a heading) in `<bdi
  dir="ltr">` too, with its spaces and closing punctuation outside, so a
  right-to-left cell no longer shows "h 1", "½t" or "3%≈".
- A number range's hyphen is non-breaking (U+2011) inside every isolated run.
- `trimRun` (`lib/bidi.ts`) leaves a spaced operator after the English to the
  sentence: "NKCC2 = שני" isolates "NKCC2" only. "Na+" and "K⁺" keep their sign.
- The table of contents and the course heading are `dir="rtl"`, names in
  `<bdi>`. A title that is a file's name breaks after "_" and "-"
  (`softBreaks`, library card and the upload list).

## WP4. What a tap asks for next, on a small phone

- After a pick, "כמה בטוחים?" scrolls into view, the least it needs and clear
  of the bars (`lib/reveal.ts`): practice (`PracticeQuestion`), the live quiz
  (`Quiz`) and the meeting's opening questions (`QuizInline`).
- Under 700 px tall the boss's HUD is one strip: no rule line, no lecture
  line, the topics in one sideways row, slimmer bars. On an SE all four
  answers show while the clock runs.
- Today: "להתחיל" stays sticky, compact, from 600 to 700 px tall (an iPhone
  in Safari); under 600 it is in the flow as before. The tour's one-time
  offer is under the queue (owner's decision); the first steps stay above it.
- The simulation's grid sheet: `82dvh`, with "להגיש" sticky at its bottom.
- A lecture whose writing stopped says so by its title ("2 חלקים לא נכתבו.")
  with "המשך כתיבה"; the footer keeps its own button.

## WP5. The keyboard and the sticky bars

- On a touch screen, while a field outside the bottom bar has focus, the bar
  joins the flow (a field inside it, the ask composer, keeps it sticky).
- Under 480 px tall the top and bottom bars scroll with the page, and the tab
  bar hides while a field has focus.
- Focus never lands under the bars: the scroll padding counts the tab bar and
  the bottom bar together (a specificity bug let the tab bar's rule win).
- While its field is typed in, a sheet's comment composer is sticky at the
  sheet's bottom (only then: otherwise it would sit over the thread's own
  buttons). On iOS, whose
  keyboard covers the page instead of resizing it, `--kb` (Shell's
  `visualViewport` watch) lifts the sheets above it.

## WP6. Controls that broke

- The ask screen's suggestion chips wrap (one widened a 320 px page to 400).
- An exam photo's four tools: two by two, 44 px each, inside the 142 px card.
  With a mouse the photo strip wraps (its sideways scroll had no scrollbar).
- The reader's contents open inside its sticky top bar, so they show
  wherever the reader has scrolled.
- Under 374 px, while following, the room wraps instead of cutting "מעקב:
  …" (the reader's own room keeps its one line: the meeting's sticky top).
- A failed exam with nothing found shows its failure and "להעלות מבחן מחדש":
  a new upload only, nothing read again for money (owner's decision). An
  empty review draws no empty list.

## WP7. The notch, once

`.ph-head` (and a tab home's taller head, and the toast when it moves to the
top) pads only for the part of the top safe area that the live banner does
not already cover: `max(0px, env(safe-area-inset-top) - var(--study-banner-h))`.

## WP8. Signing out

Already done by the personal code (`Me.tsx`, `SignOutConfirm`): it says what
coming back needs, offers to make a code first, and focus starts on
"ביטול". Verified, unchanged; `shell.cjs` and `summary.cjs` drive it.

## Tests

- Unit: `lib/bidi.test.ts` (spaced operators), `lib/rich.test.ts` (Hebrew-free
  runs, ranges, "NKCC2 =", react-markdown's strings, `softBreaks`),
  `lib/staleChunk.test.ts` (`retryImport`).
- e2e: `e2e/study/resilience.cjs` (WP1: API 503 and aborted at startup, the
  `online` retry, an aborted chunk on a tab switch, offline, the library's
  error, the meeting's button; iPhone 15 and 1280 px) and
  `e2e/study/small-phones.cjs` (WP4 to WP7 on iPhone SE, iPhone 15, Pixel 7
  and 1280 px, with CDP safe-area insets for the notch). Both run with
  `E2E_FLAGS=s2`.

## To check on a real iPhone (WebKit is not installed here)

- The keyboard: a sheet's composer above it (`--kb`), the trap form's bottom
  bar out of the way, nothing jumping when the keyboard closes.
- The notch in the home-screen app with the live banner showing.
- `dvh` on the grid sheet; `:has()` (iOS 15.4+) and `color-mix()` (16.2+,
  the accepted minimum).

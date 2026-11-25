# תמצית on the home screen (VITE_STUDY_INSTALL)

Built on `dev` on 25 Nov 2026, after the personal code
([`personal-code.md`](personal-code.md)). The plan it follows was approved
with the owner's decisions of 25 Nov 2026: no service worker (a stale-chunk
reload instead), the title bar and the manifest in the page's paper colour,
and no server record of who installed.

## What a member sees

- **"שלי"**: a row high on the screen, "להוסיף את תמצית למסך הבית", to the
  steps for this device (`?v=install`). In the home-screen app itself it is
  one line, "תמצית פתוחה מהאייקון ✓". A computer without the browser's own
  install prompt has no row. After "הוספתי" the row has "נוסף ✓".
- **The guide's first step "להוסיף למסך הבית"** (S9, with `VITE_STUDY_GUIDE`):
  second for a joiner, third for a creator (after the invite), so a cut to
  five never drops it. Its "להראות" rings "שלי", then the row. On an iPhone
  its line says the personal code is needed and waits in the steps. It is
  ticked by "הוספתי", by the browser's prompt accepted, by its
  `appinstalled` event, or by a launch from the icon. It is never added in
  the home-screen app; a step kept from the browser (Android shares the
  storage) stays and is ticked by the launch.
- **The home's card** (Today, or the library before Today): "תמצית במסך
  הבית" with "איך מוסיפים" (or the browser's own "התקנה" on Android and
  computers) and "לא עכשיו". Once per browser, never in the app, never on a
  computer without the prompt, and never while the guide's card holds the
  home (a member who just joined, a live first-steps card, or the tour's
  offer not answered). "לא עכשיו" is for good on that browser; the row in
  "שלי" stays.
- **The join screen**: in another app's built-in browser (Instagram,
  Facebook, an Android WebView, an iOS WKWebView as WhatsApp's coming one
  would be) a callout above the form, "פתיחה בספארי" (Android: "פתיחה
  בכרום") and "העתקת הקישור", both keeping `?join=`. In an iPhone's Safari one
  quiet line under the form. The home-screen app's first launch already opens
  on "כניסה עם הקוד האישי" with "הדבקה" (the personal code's own work).
- **Help** has the row "תמצית במסך הבית"; "איך עושים…?" has "להוסיף את תמצית
  למסך הבית" with "להוסיף למסך הבית", which opens the steps.

## The steps, per device (`?v=install`)

| Where the page runs | What the screen shows |
|---|---|
| iPhone or iPad, Safari | 1. the personal code, copied ("העתקת הקוד"; made here if there is none; "קוד חדש" after a confirm when this device does not hold it); 2. Share → Add to Home Screen, with pictures of "⋯" (Safari 26 first) and the share icon, and the line for when the row is missing; 3. Add (on iOS 26, or a version not known, "אם בחלון יש מתג, משאירים אותו דלוק."), then the icon's "כניסה עם הקוד האישי" and paste; "הוספתי", whose line then takes the focus. An arrow points at Safari's bar (bottom on an iPhone; top on an iPad, under the screen's head), bobs three times and rests. |
| Chrome, Edge or Firefox on an iPhone | the same, worded for their share icon, with "or open in Safari"; no arrow (their share icons sit in different places) and no second line about the row. |
| Another app's browser | the code first (members), then "פותחים בספארי" (Android: בכרום) with the way out and the link to copy; the fallback names the app's menu as the phone draws it (⋯ on iOS, ⋮ on Android). The join screen names Instagram or Facebook when the browser says so. |
| Android Chrome or Edge | the browser's "התקנה" when it offered one (accepted: "הותקנה ✓"; put off: a soft line, then the menu), else the menu's words, "אין את זה בתפריט? בוחרים קודם ״פתיחה ב-Chrome״." (a link from Gmail or Telegram opens in a Custom Tab, which looks like Chrome but has no install rows) and "הוספתי"; one line for the icon's join screen, saying where the code is. No code: the app shares Chrome's storage. |
| Samsung Internet, other Android browsers | their menu's words and "הוספתי". |
| A computer | "התקנה" when the browser offers it (or `navigator.install`), else "במחשב אפשר פשוט להמשיך בדפדפן." |
| The home-screen app | "תמצית כבר פתוחה מהאייקון ✓" |

Detection (`src/study/lib/install.ts`): standalone first; in-app markers
(`FBAN|FBAV|FB_IAB|FB4A`, `Instagram`, Android `; wv)`, iOS without
`Safari/`); iOS by `iPhone|iPod|iPad` or a touch "MacIntel"; Safari's
`Version/NN`, never the OS token (frozen at 18_6 from iOS 26). The memory is
`study-install` in this browser's localStorage (`dismissed`, `done`, `via`);
nothing is sent anywhere.

## The words a phone shows: NOT checked on a device

Every label of the phones' own menus is in one block,
`OS` in [`src/study/lib/installCopy.ts`](../../src/study/lib/installCopy.ts),
and every line, help's row and the how-to are built from it. Correct them
there from Hebrew screenshots:

| Key | Now | What it names |
|---|---|---|
| `safari` | ספארי | Apple's browser |
| `iosShare` | שיתוף | Safari's share sheet (Share) |
| `iosMore` | ⋯ | iOS 26: the button beside the address in the compact bar |
| `iosAddToHome` | הוספה למסך הבית | the share sheet's row (Add to Home Screen) |
| `iosAdd` | הוספה | the add sheet's button (Add) |
| `openInBrowser` | פתיחה בדפדפן | another app's menu item (Open in browser) |
| `chrome` | כרום | Google's browser |
| `androidMenu` | ⋮ | Chrome's menu button |
| `androidInstall` | התקנת אפליקציה | Chrome's menu row (Install app) |
| `androidAddToHome` | הוספה למסך הבית | Chrome's menu row (Add to Home screen) |
| `samsungMenu` | ☰ | Samsung Internet's menu button |
| `samsungAddPageTo` | הוספת דף אל | its row (Add page to) |
| `samsungHome` | מסך הבית | its next row (Home screen) |
| `androidOpenInChrome` | פתיחה ב-Chrome | a Custom Tab's menu row (Open in Chrome) |

The add sheet's switch (iOS 26's "Open as Web App") is not named: on iOS 26,
and where the version is not known (Chrome, Edge, Firefox), the line says
"אם בחלון יש מתג, משאירים אותו דלוק."; on iOS 16-18, which has no switch,
nothing.

On the home, the install card waits while the personal code's prompt is up
(`main:has(.pc-prompt)`): one card at a time, and the iPhone's steps start
from that code anyway. "לא עכשיו" moves the focus on to what follows the
card (Today's "התור שלי"); "קוד חדש" moves it to the confirm's "ביטול", and
"ביטול" back to "קוד חדש".

## The manifest and the page

- `public/manifest.webmanifest`: `id: "/"` (what `start_url` made it before,
  so nothing installed becomes a new app), `theme_color` and
  `background_color` the paper `#f6f4fd`, `categories: ["education"]`,
  shortcuts (היום, ספרייה, תרגול), a separate maskable icon with the safe
  zone's padding (`icon-maskable-512.png`, the logo at 80% on its own
  purple), and screenshots for Chrome's richer install sheet: narrow
  390×844 (a summary, the library) and wide 1280×800 (the library, a
  summary), made by `e2e/study/manifest-shots.cjs` from the mock (fictional
  data only). iOS ignores the screenshots.
- `index.html`: `apple-mobile-web-app-status-bar-style` `default` (dark text
  on the paper, never over the page); the theme colours stay the paper's,
  light `#f6f4fd` and dark `#121022`.
- **A chunk from before a deploy** (`src/study/lib/staleChunk.ts`): a lazy
  screen whose chunk is gone reloads the page once (at most once a minute per
  tab; never without sessionStorage, never offline). `vercel.json` no longer
  rewrites `/assets/*` to `index.html`, so a missing chunk is a real 404. The
  screen's error boundary shows "המסך לא נטען…" for the moment before the
  reload, or when the reload is spent ([`ux-p1.md`](ux-p1.md), WP1).
- **No service worker.** Add one only if a real Android shows no
  `beforeinstallprompt` (then: a pass-through fetch handler, no caching,
  `Cache-Control: no-cache`).

## Before release: on real devices

- iPhone on iOS 26, Hebrew: the labels above; which side "⋯" is on in the
  compact bar under RTL (the arrow stays centred until then); that the switch
  is on by default; paste in the icon's "כניסה עם הקוד האישי".
- WhatsApp on iOS: links still open in Safari. Instagram on iOS: whether
  "פתיחה בספארי" (`x-safari-https://…`) opens Safari.
- Android Chrome: that `beforeinstallprompt` comes with no service worker
  (after a tap and 30 s on the page). Samsung Internet: its menu's words.

## Flag and checks

- `VITE_STUDY_INSTALL=1` (needs no SQL section; `requiredSchema` is
  unchanged). Off: `?v=install` is the library with no notice, and nothing
  of it shows.
- Unit: `src/study/lib/install.test.ts`, `staleChunk.test.ts`, the S9 tests
  in `guide.test.ts`, help's row in `helpCopy.test.ts`.
- e2e: `e2e/study/install.cjs` (iPhone Safari 26 and 18, an iPad, a WKWebView
  and Instagram, Android with and without a stubbed prompt, the home-screen
  app by display-mode emulation, a computer); the manifest in
  `invite-member.cjs`. The mock's flag set `i` is `s2` with the flag.

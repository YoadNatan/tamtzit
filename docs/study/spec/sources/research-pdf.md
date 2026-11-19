# PDF of a summary with page numbers, for WhatsApp (decision #12): research

Design only: nothing in the repo or in production was touched. Experiments ran on local Chromium only; scripts and outputs are in `spec/_pdf-lab/`. Some official pages could not be fetched from this sandbox (section 3, item 1).

## 1. Recommendation

**Write one print layout in plain CSS. A new Node.js Vercel function renders it to PDF with headless Chromium, and the phone hands the PDF to WhatsApp through the Web Share API. Keep `window.print()` on the same layout as the fallback that needs no server. Don't use Paged.js or an in-browser PDF library.**

- **Page numbers need CSS `@page` margin boxes.** Chrome and Chrome for Android have them since 131; Safari, iOS and Firefox don't (§2.1). iOS printing also ignores `@page size` and adds its own footer, which undermines Paged.js as well (§2.3).
- **Server Chromium 153 is the engine version tested here.** Numbers, bidi, tables, boxes and pictures came out right (§2.2). It prints the app's own DOM and CSS, `<bdi>` isolation included, so the PDF reads like the reader.
- **One share sheet on both phones.** A PDF `File` is shareable on iOS Safari 14+ and Chrome Android 76+ (§2.5). No print dialog, no Files app.
- **Costs.** No Claude call, so `STUDY_MONTHLY_USD` is untouched. No new third party.

### Versions (pin exactly)

| Role | Package | Version | License | Note |
|---|---|---|---|---|
| Layout | none (CSS) | | | `src/study/print.css` |
| Server driver | playwright-core | 1.63.0 (2026-09-04) | Apache-2.0 | the version used in the tests here; drives Chromium 153 |
| Server browser | @sparticuz/chromium | 153.0.0 (2026-09-11) | MIT | 70.1 MB unpacked; "Breaking changes may occur at the 'patch' level" |
| Server fonts | @fontsource/ibm-plex-sans-hebrew, @fontsource/frank-ruhl-libre | 5.3.0 | OFL-1.1 | embedded as `data:` URLs |
| Alternative driver | puppeteer-core | 25.11.0 | Apache-2.0 | targets Chrome 153.0.8010.36 |
| Plan C only | @react-pdf/renderer | 4.9.0 | MIT | §2.4 |
| Rejected | pagedjs 0.4.3 / 0.5.0-beta.2, jspdf 4.2.1, pdf-lib 1.17.1 | | MIT | §2.3–2.4 |

### Code sketch

**1. `src/study/print.css`** (the `@page` and `.summary` rules as tested; the `.print-doc` switch is new). Also change study.css's `@media (prefers-color-scheme: dark)` to `@media screen and (prefers-color-scheme: dark)`: tested, dark mode stays on screen and print gets the light ink.

```css
@page {
  size: A4;
  margin: 16mm 15mm 18mm;
  @bottom-center {
    content: "עמוד " counter(page) " מתוך " counter(pages);
    direction: rtl; font-family: "IBM Plex Sans Hebrew", sans-serif; font-size: 9pt; color: #5d6573;
  }
}
@page :first { @top-center { content: ""; } } /* also keeps Chrome's date/title header off page 1 */
.print-doc { display: none; }
@media print {
  body > :not(.print-doc) { display: none !important; }
  .print-doc { display: block; }
  .summary { font-size: 11pt; line-height: 1.6; }
  .summary p, .summary li { max-width: none; orphans: 2; widows: 2; }
  .summary h2, .summary h3 { break-after: avoid; }
  .callout, .slide-figure, .summary tr { break-inside: avoid; }
  .table-wrap { overflow: visible; }
  .slide-figure img { max-height: 95mm; }
  .callout, .summary th, .src-tag { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
```

A per-lecture `<style>` adds the running title, `@page { @top-center { content: "<title> · תמצית"; … } }` (escape `"` and `\`).

**2. Client.** When every part is ready, `LectureView` portals a `.print-doc` into `<body>`: title, meta line, one `SummaryView` per part without comment props, and a new `eager` prop for `<img loading="eager">`.

```ts
// src/study/lib/pdf-export.ts
export async function printable(doc: HTMLElement) {
  await document.fonts.ready;
  await Promise.all([...doc.querySelectorAll("img")].map((i) => i.decode().catch(() => undefined)));
}
export function printableHtml(doc: HTMLElement, title: string): string {
  let css = "";
  for (const sheet of document.styleSheets) {
    try { for (const r of sheet.cssRules) css += r.cssText + "\n"; } // keeps the @page margin rules (tested)
    catch { /* Google Fonts sheet is cross-origin: the server embeds the fonts */ }
  }
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>${css}</style></head><body>${doc.outerHTML}</body></html>`;
}
// in api.ts, beside the other /api calls (authHeader() exists there)
export async function renderPdf(lectureId: string, html: string): Promise<File> {
  const r = await fetch("/api/study/pdf", { method: "POST", headers: await authHeader(), body: JSON.stringify({ lectureId, html }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "pdf");
  const name = decodeURIComponent(r.headers.get("x-file-name") ?? "summary.pdf");
  return new File([await r.blob()], name, { type: "application/pdf" });
}
```

Two taps: **"PDF"** shows "מכינים PDF…" and builds the file; **"שליחה"** then calls the `deliver()` pattern from `src/shoham/lib/voucherArt.ts` (`canShare({files})` → `share`, `AbortError` ends quietly, else `<a download>`). `share()` needs a fresh tap (§2.5). **"הדפסה"** runs `printable()` then `window.print()`.

**3. Server, `api/study/pdf.ts`**, on the Node.js runtime (no `runtime: "edge"`), with `"functions": {"api/study/pdf.ts": {"maxDuration": 60}}` in `vercel.json`.

```ts
import chromium from "@sparticuz/chromium";          // 153.0.0
import { chromium as pw } from "playwright-core";      // 1.63.0
import { HttpError, json, loadLecture, memberClient } from "../_lib/study";
import { FONT_FACES } from "../_lib/pdf-fonts";        // @font-face, base64 woff2 + a fallback font

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const { lectureId, html } = (await req.json()) as { lectureId?: string; html?: string };
      if (!lectureId || typeof html !== "string" || html.length > 3_000_000) throw new HttpError(400, "bad request");
      const { sb } = await memberClient(req);
      const lecture = await loadLecture(sb, lectureId); // RLS: only the lecture's group passes
      const base = process.env.VITE_STUDY_SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
      const allowed = `${new URL(base).origin}/storage/v1/object/sign/study/${lecture.group_id}/`; // confirm against figureUrls()
      const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath() });
      try {
        const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
        await page.route("**/*", (r) => (r.request().url().startsWith(allowed) ? r.continue() : r.abort()));
        await page.setContent(html.replace("</head>", `<style>${FONT_FACES}</style></head>`), { waitUntil: "networkidle" });
        const pdf = await page.pdf({ preferCSSPageSize: true });
        return new Response(new Blob([pdf]).stream(), { // streamed: the 4.5 MB response cap doesn't apply
          headers: { "content-type": "application/pdf", "cache-control": "no-store",
                     "x-file-name": encodeURIComponent(`${lecture.title}.pdf`) },
        });
      } finally { await browser.close(); }
    } catch (e) {
      return json(e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message : "pdf" });
    }
  },
};
```

### User flow

**Android (Chrome, tab or installed app):** open a lecture → **PDF** ("מכינים PDF…") → **שליחה** → share sheet → WhatsApp → chat → Send. The PDF arrives as a document named after the lecture. Fallback **הדפסה**: printer selector → **Save as PDF** → folder; then WhatsApp → 📎 → Document. Our page numbers print there too (Chrome 131+). Firefox for Android can't share files, so it downloads.

**iPhone (Safari tab or home-screen app):** the same two taps open the iOS share sheet (WhatsApp, or "Save to Files"). Fallback **הדפסה**: Print Options → Share; no page numbers of ours, only Safari's own footer. Chrome on iPhone is WebKit too (Apple's rule, not re-checked here).

**Desktop:** the PDF downloads (Chrome 128+ may show a share sheet).

### How to test (same harness as today)

- **Build:** `npm run build` type-checks `api/study/pdf.ts` (`tsconfig.api.json` covers `api/`).
- **E2E (Playwright, mock build, lecture with three ready parts):**
  - **Layout:** `.print-doc` holds every part, images `eager`; under `emulateMedia({media:"print", colorScheme:"dark"})` paragraphs are `rgb(29, 33, 40)` and `.page-head` is hidden.
  - **PDF:** `page.pdf({preferCSSPageSize:true})` → `pdftotext`: "עמוד i מתוך N" on every page, a known Hebrew sentence in logical order; `pdffonts` lists IBMPlexSansHebrew (serve the fontsource woff2 on the Google Fonts route).
  - **Sharing:** stub `navigator.canShare`/`share` (headless Linux Chromium has neither, checked) and `/api/study/pdf`; expect one `application/pdf` `File` on the second tap, and a `download` event without `canShare`.
- **Function, locally:** esbuild-bundle it, call `fetch()` in Node with `executablePath` = Playwright's Chromium 153 and the mock Supabase from `study-e2e.js`. Expect 200, `%PDF`, "מתוך" on every page, fonts embedded; an injected outside `<img>` is aborted, an injected `<script>` doesn't run, a non-member is refused.
- **Preview deployment (Yoad):** cold start, bundle size, memory; export an existing lecture only, never create a group.
- **Devices:** iPhone and Android, tab and installed app: send to WhatsApp, open, check numbers and pictures.
- **SQL:** no change.

## 2. Evidence

### 2.1 Which browsers support `@page` margin boxes
- **MDN compat data:** `@bottom-center` and all the other margin boxes are in Chrome 131. Chrome Android, Edge, Samsung Internet and WebView mirror Chrome. Safari, Safari iOS and Firefox: `false`. https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/at-rules/page.json
- **Firefox** has the feature behind a pref that is off: `layout.css.margin-rules.enabled … value: false`. https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/StaticPrefList.yaml
- **WebKit** has no margin-box feature or preference at all:
  - https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/features.json
  - https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
- **caniuse `css-paged-media`, iOS 18.2+ (partial support):** "Printing ignores the `size` descriptor and lays the page out in the printable area that the iOS print dialog provides. `margin` cannot remove that area's margins or the footer Safari adds." https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/css-paged-media.json
- **MDN `@page`:** the 16 margin at-rules; `content`, `direction` and fonts apply inside them. https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/reference/at-rules/@page/index.md
- **Chrome's own header/footer** (date, title; URL, `pageNumber/totalPages`): https://raw.githubusercontent.com/chromium/chromium/main/components/printing/resources/print_header_footer_template_page.html

### 2.2 Measured here (Playwright 1.63.0, Chromium 153.0.8010.12)

Test page: the DOM `SummaryView` renders (5 parts, a table, both box kinds, 2 lazy figures, `<bdi>` runs, slide tags) with the app's study.css and the print.css above.

- **Output:** 8 A4 pages, "עמוד N מתוך 8" on each, running title from page 2. `pdftotext` gives the Hebrew in logical order; IBM Plex and Frank Ruhl are embedded; "Sodium stibogluconate (Pentostam®)" is intact.
- **Backgrounds:** callout and table-header colours printed with `printBackground: false`, thanks to `print-color-adjust: exact` (unprefixed in Chrome 136 and Safari 15.4, `-webkit-` long before; neither prints `<body>` backgrounds). https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/print-color-adjust.json
- **Lazy pictures** not yet loaded still printed.
- **Dark mode leaks into print:** with a dark scheme, `prefers-color-scheme: dark` still matches in print, and paragraphs were `rgb(231, 233, 238)` (near-white) until the fix.
- **Chrome's "Headers and footers":** without margin boxes it adds date, title, URL and "1/10"; our margin boxes replace them, and the empty `:first` `@top-center` clears page 1.
- **Server simulation:** the serialized layout (DOM plus same-origin CSS) is 55 KB for 8 pages, and `CSSPageRule.cssText` keeps the nested margin rules. With JavaScript off and an allowlist: 8 pages, 165 KB, numbers intact, an outside image blocked. Fonts fetched over http from the `about:blank` page didn't apply; as `data:` URLs they did.
- **Missing glyphs:** no IBM Plex Sans Hebrew file has `β`, `⁺` or `⁻` (fontTools check of fontsource 5.3.0), and @sparticuz/chromium ships only Open Sans, so bundle a fallback font.

### 2.3 Paged.js
- **Releases:** `latest` 0.4.3 (2023-07-06), beta 0.5.0-beta.2 (2024-10-04), GitHub `main` still at the beta; MIT. `paged.polyfill.min.js`: 503 KB / 97 KB gzipped (0.4.3), 516 KB / 101 KB (beta). The README tests in Chrome only. https://registry.npmjs.org/pagedjs, https://raw.githubusercontent.com/pagedjs/pagedjs/main/README.md
- **RTL:** the source has "TODO: Recto and Verso should reverse for rtl languages" (`src/chunker/chunker.js`). With `<html dir="rtl">` both versions put the whole summary on one page; with `<html dir="ltr">` and `dir="rtl"` blocks they made 8 correct pages.
- **Lazy images:** Paged.js never finished in 20 s; with eager images, about 1 s.
- **iOS** ignores `size` (§2.1), so its fixed A4 boxes can't map 1:1 onto sheets. No WebKit build here to test.

### 2.4 Building the PDF in the browser
- **jsPDF 4.2.1** (BidiEngine options such as `isInputRtl` documented on `text()`) **and pdf-lib 1.17.1** (last release 2021): one mixed line came out with the English reversed ("abeomatnE", "elozadinorteM") and unwrapped. Wrapping, tables and pages would be hand-written.
- **@react-pdf/renderer 4.9.0** (textkit 7.0.1 uses bidi-js) wraps, paginates and has `render={({pageNumber,totalPages})}`. "(Pentostam®)" was right, but "750 mg" printed as "mg 750" (the reader shows "750 mg" via `<bdi>`), and U+2066/U+2069 isolates print as junk glyphs. It needs a second renderer for tables, boxes and figures, and weighs 1.24 MB / 457 KB gzipped with React (esbuild 0.25.10).

### 2.5 Getting the file into WhatsApp
- **MDN `share()`:** `.pdf - application/pdf` is a shareable file type. The call needs transient activation, otherwise it fails with `NotAllowedError`. https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/navigator/share/index.md
- **MDN `canShare()`:** returns false when "Files are specified but the implementation does not support file sharing". https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/navigator/canshare/index.md
- **Compat data for sharing files:**
  - Supported: Chrome Android 76, Safari/iOS 14, Samsung Internet 11; desktop Chrome 128 (89 on Windows and ChromeOS).
  - Not supported: Firefox and Android WebView.
  - https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json
- **caniuse:** Safari 12.1–13 refused a share that started after a fetch. https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/web-share.json

### 2.6 The server
- **Vercel limits (Fluid compute):** Hobby 2 GB memory, 300 s maximum, 250 MB uncompressed bundle ("Puppeteer with its bundled Chromium" is named as a heavy dependency); bodies capped at 4.5 MB, but "The response body limit doesn't apply to streamed responses." https://vercel.com/docs/functions/limitations
- **Node.js handler:** `export default { fetch(request: Request) }`. https://vercel.com/docs/functions/runtimes/node-js
- **Edge:** 1 MB gzipped code on Hobby, no filesystem, no native Node APIs, so no Chromium. https://vercel.com/docs/functions/runtimes/edge
- **Vercel's Puppeteer guide** uses puppeteer-core with @sparticuz/chromium-min; the full package fits too (70.1 + 13.5 MB). https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel
- **@sparticuz/chromium README:** Playwright usage `launch({ args: chromium.args, executablePath: await chromium.executablePath() })`; "at least 512 MB of RAM … 1600 MB (or more) is recommended"; only Open Sans ships. https://registry.npmjs.org/@sparticuz/chromium
- **Puppeteer:** `preferCSSPageSize`, `printBackground` (default false), `waitForFonts` (default true); 25.11.0 targets Chrome 153.0.8010.36. https://raw.githubusercontent.com/puppeteer/puppeteer/main/docs/api/puppeteer.pdfoptions.md, https://raw.githubusercontent.com/puppeteer/puppeteer/puppeteer-core-v25.11.0/packages/puppeteer-core/src/revisions.ts

## 3. Risks and open questions
1. **Not fetched.** The proxy blocked developer.chrome.com and caniuse.com (caniuse's GitHub data files were used instead), and support.apple.com didn't resolve; allow them in the session's network settings to check the phone steps against official help. The phone flows come from search results only: Google Chrome Help (https://support.google.com/chrome/answer/1069693: Share → Print → printer selector → Save as PDF) and third-party iPhone guides (e.g. https://iphonelife.com/content/how-save-websites-pdfs: Share → Print → Share again).
2. **iPhone fallback, unchecked:** does `window.print()` work in a home-screen app (an Apple forum thread, https://developer.apple.com/forums/thread/22911, seen in search only, says not on iOS 9), and does Safari's footer carry page numbers? Check on Shoham's phone; the recommended path needs neither.
3. **Cold start** isn't measured. Show progress; if slow, cache the last PDF per lecture in Storage.
4. **Streaming exemption:** confirm in Preview that a ~5 MB PDF passes. If not, upload to `{group}/{lecture}/summary-<ts>.pdf` (insert-only: `storage.objects` has no update policy; `deleteLecture()` clears that folder) and return a signed URL.
5. **Picture links expire** after 6 h (`figureUrls`): refresh before export.
6. **Server fonts:** embed IBM Plex Sans Hebrew 400/700, Frank Ruhl Libre 700 and a fallback with Greek and superscripts, or "Ca²⁺" can print boxes.
7. **Two taps** on iPhone (sharing needs a fresh tap). Check that WhatsApp keeps the Hebrew file name.
8. **Upgrades:** @sparticuz/chromium isn't semver; upgrade it with playwright-core in one commit.
9. **Privacy (#13):** the export sends the summary's HTML to Vercel, and a PDF sent on WhatsApp leaves the app.
10. **Plan C**, if the Vercel spike fails: @react-pdf/renderer 4.9.0 in a lazy chunk, accepting §2.4's bidi differences.

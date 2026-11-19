# Research: exporting flashcards to Anki (תמצית)

Scope: feature 4, step 1 ("גם וגם": Anki export first). Design only. Nothing in the repo was changed. The prototype and every check script are in `spec/anki-proto/`; `spec/anki-proto/run-all.sh` re-runs all of them.

## 1. Recommendation

**Write our own small exporter, `src/study/lib/anki.ts`, about 250 lines.** It runs in the browser and is lazy-loaded the way `pdf.ts` loads pdf.js.

- **New dependency:** `sql.js@1.15.2`, pinned exactly. It is MIT-licensed, embeds SQLite 3.54.0, and was published 2026-10-26.
- **Reused:** the `jszip@3.10.1` the repo already ships for `pptx.ts`.
- **Types:** a short local `src/study/lib/sqljs.d.ts`. Do not add `@types/sql.js`, because it pulls `@types/node` into the browser types.
- **Prototype:** `spec/anki-proto/src/anki.ts` passes `tsc` with the repo's compiler options. It is the code to port.

**Package format.** The exporter writes the legacy deck package: a zip containing
- `collection.anki2`, a SQLite collection with schema 11;
- `media`, a JSON map of the media files;
- `0`, `1`, …, the media files themselves.

Anki 26.9.4 is the current stable release (PyPI, 2026-11-04). It imports this package correctly, which was checked here with the official `anki` package (§4). Do not write the newer `collection.anki21b` format (zstd plus protobuf). It is not needed.

**Rules that make a re-export update cards instead of duplicating them.** All of these were checked against Anki 26.9.4.

| Item | Rule | What Anki does on re-import |
|---|---|---|
| Note GUID | `base91(SHA-256("tamtzit\|<group id>\|<card id>")[0..8])`, the same alphabet as Anki's `guid64` | Matches the note by GUID: updated, never duplicated |
| Note `mod` | The card's `updated_at`, in seconds. **Not** the export time. | Default "Update notes: If newer". A card changed in the app is updated in place and keeps its scheduling. An unchanged card is skipped, so the student's own edits in Anki survive. An older export never overwrites a newer one. |
| Note type | One fixed id forever. `mod` is a constant that is raised only when templates or CSS change. | A raised `mod` replaces CSS and templates. If the student edited our CSS in Anki, notes still update and her CSS is kept. |
| Fields | Fixed forever: `Front, Back, Extra, Image, Source` (Extra holds an explanation or a mnemonic) | Changing the field list makes notes "conflicting" and adds a copy of the note type, "תמצית (עברית)+". With "Merge note types" ticked, the type is merged instead, but in the test the note was still not updated. So the field list is decided now. |
| Deck | `תמצית::<course>::<lecture title>`. Replace any `::` inside a title. | Decks are matched by **name**. An updated card stays wherever the student moved it. |
| Note and card ids | Any unique integers (`Date.now()` plus a counter) | Two packages with the same ids both imported in full. Matching uses the GUID only. |
| Deletions | Not possible by import: import never deletes | Optional: soft-delete cards and export them once with the tag `tamtzit::נמחק`, so the student can find and delete them in Anki |

**Right-to-left text.**
- Both templates wrap the fields in `<div class="tz" dir="rtl" lang="he">`. The CSS sets `.tz{direction:rtl;text-align:right}` and `.tz bdi{unicode-bidi:isolate}`.
- Fields get `rtl:true`. This is Anki's per-field option "Reverse text direction (RTL)" in the Fields dialog, meant for editing; its effect on the editor was not checked here. The Image field stays left-to-right.
- Card HTML must isolate every *whole* Latin run in `<bdi>`. Use the same `LATIN_RUN`/`trimRun` logic as `SummaryView.tsx`, moved into a shared helper. A word split across a `<bdi>` boundary renders wrongly: `<bdi>Stib</bdi>ogluconate` was seen rendering as "ogluconateStib". Emphasis goes inside one isolate: `<bdi><b>Stib</b>ogluconate</bdi>`.
- The card CSS sets no colours. Anki desktop's night mode then applies its own: `body.nightMode{background-color:var(--canvas);color:var(--fg)}`. Screenshots of both modes are in `anki-proto/out/render/`.

**Pictures.**
- Include only the slide figures that the exported cards reference.
- Fetch them through the existing `figureUrls()`, the same signed URLs the reader uses.
- Name each one `tz-<lecture uuid>-s<slide>-<k>.jpg`: plain ASCII and unique, because Anki's media folder is flat.
- In the Image field, write `<img src="name.jpg">`.

**Getting the file onto the phone.** Offer the export per lecture and for all lectures: one package, with one deck per lecture.
1. Build a `File` named `tamtzit-<date>.apkg`.
2. If `navigator.canShare({files:[file]})` is true, call `navigator.share`. This opens the share sheet, which matters for the home-screen app on iPhone.
3. Otherwise download it with `<a download>`.
4. Show a one-time help sheet: "פותחים את הקובץ ב-Anki ← ייבוא". It says Anki's defaults are right, quoting Anki's own Hebrew label "עדכן רשומות: אם חדש יותר". Also say that AnkiWeb (the website) cannot import decks.

**Text fallback, secondary.** A UTF-8 file with these headers:
```
#separator:tab
#html:true
#tags column:3
#guid column:4
#deck:<name>
```
- Columns are Front, Back (with Extra and Source folded in), Tags, GUID. Every field is quoted, with inner `"` doubled.
- The GUID column carries the same GUID as the `.apkg`, so a reworded question still updates in place.
- Leave out `#notetype:`. In a Hebrew-language Anki the stock type is "בסיסי" and there is no "Basic"; a missing name silently falls back to the current note type.
- Use one route per person. A text import followed by an `.apkg` import of the same GUIDs gives "conflicting" notes, which are not updated.

**Cost.** The export makes no Claude call and no server call, and needs no Vercel function. It does not touch `STUDY_MONTHLY_USD`. Generating the cards is a separate feature, which must count toward that budget.

**What the flashcards feature must store.**
- A stable `id` (uuid) per card.
- `lecture_id`.
- Short HTML-safe text for front, back and extra.
- An optional figure `(slide, k)`.
- `slide_from` and `slide_to`.
- `updated_at`, raised by a trigger whenever the content columns change.
- Optionally `deleted_at`.

**Plan B: `anki-apkg-export@5.0.0`.** It is MIT-licensed, rewritten in October 2026, published from GitHub Actions with provenance, and its README says it is tested against Anki 26.09.3. It is not the first choice, for four reasons:
- Every note gets `mod = Date.now()` at export (read in its `dist/index.js`). So any re-export made after a student edited a card in Anki overwrites her edit, even when the card did not change in the app.
- Field `rtl` is hard-coded to false.
- Its Vite recipe (§3, E9) failed in Chromium on a fresh install.
- Its code is larger: 224 kB (82 kB gzip) against 146 kB (49 kB gzip) for ours. Both figures include JSZip and the sql.js glue code, and leave out the wasm.

If it is used anyway, pin `sql.js@1.14.2` exactly next to it, and pass explicit `deckId` and `modelId`.

**Rejected or not evaluated.**
- `genanki-js@2.0.0`: rejected. It is AGPL-3.0-or-later, last released 2022-05-03, relies on globals, and lists gulp as a runtime dependency.
- Python `genanki@0.13.1` (MIT): reference only. Our schema and JSON mirror it.
- `apkg-browser-builder@1.0.2` and `ankipack@0.3.1`: too new to rely on (first published 2026). Not evaluated.

## 2. Schema and JSON

The tables are the same as genanki's `apkg_schema.py` and anki-apkg-export's `schema.ts`.

```sql
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn); CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due); CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
```

**Rows.**
- `col`: one row, `(1, crt=now s, mod=now ms, scm=now ms, ver=11, 0, 0, 0, conf, models, decks, dconf, '{}')`.
- `notes`: `flds` holds the fields joined by `\x1f`. `sfld` is the Front field without HTML. `csum` is `int(sha1(sfld)[:8],16)`, as in anki's `field_checksum`. `tags` is `" a b "`, and `usn` is -1.
- `cards`: `ord 0, type 0, queue 0, due = position 1..n`, and every other number 0.

**JSON** (the full values are in `anki-proto/src/anki.ts`):
```json
conf:   {"activeDecks":[1],"curDeck":1,"newSpread":0,"collapseTime":1200,"timeLim":0,"estTimes":true,
         "dueCounts":true,"curModel":null,"nextPos":<n+1>,"sortType":"noteFld","sortBackwards":false,"addToCur":true}
models: {"<NOTETYPE_ID>":{"id":<NOTETYPE_ID>,"name":"תמצית (עברית)","type":0,"mod":<NOTETYPE_MOD>,"usn":-1,"sortf":0,
         "did":null,"tmpls":[{"name":"כרטיס","ord":0,"qfmt":"…","afmt":"{{FrontSide}}<hr id=\"answer\">…","bqfmt":"",
         "bafmt":"","did":null,"bfont":"","bsize":0}],
         "flds":[{"name":"Front","ord":0,"sticky":false,"rtl":true,"font":"Arial","size":20,"media":[]}, …Back, Extra, Image (rtl false), Source],
         "css":"…","latexPre":"…","latexPost":"\\end{document}","latexsvg":false,"req":[[0,"any",[0]]],"tags":[],"vers":[]}}
decks:  {"1":{…"Default"…},"<did>":{"id":<did>,"name":"תמצית::…","mod":<s>,"usn":-1,"desc":"","dyn":0,"conf":1,
         "collapsed":false,"browserCollapsed":false,"extendNew":0,"extendRev":0,"newToday":[0,0],"revToday":[0,0],
         "lrnToday":[0,0],"timeToday":[0,0]}}
dconf:  {"1":{"id":1,"name":"Default","mod":0,"usn":0,"maxTaken":60,"autoplay":true,"timer":0,"replayq":true,"dyn":false,
         "new":{"bury":false,"delays":[1,10],"initialFactor":2500,"ints":[1,4,0],"order":1,"perDay":20},
         "rev":{"bury":false,"ease4":1.3,"ivlFct":1,"maxIvl":36500,"perDay":200,"hardFactor":1.2},
         "lapse":{"delays":[10],"leechAction":1,"leechFails":8,"minInt":1,"mult":0}}}
```

## 3. Evidence

The host docs.ankiweb.net (the Anki manual) does not resolve from this sandbox, and the GitHub tool only reaches this repo. So I checked Anki's behaviour against its own code, from PyPI, and used web-search excerpts only where noted. To read the manual directly, allow docs.ankiweb.net in the environment's network settings.

**E1. Anki 26.9.4** (`pip install anki==26.9.4`; https://pypi.org/project/anki/26.9.4/)
- **Package versions** (`anki/import_export_pb2.pyi`): "VERSION_LEGACY_1 — When `meta` missing, and collection.anki2 file present"; "VERSION_LATEST — Implies MediaEntry media map, and zstd compression".
- **Import options:** update conditions `IF_NEWER` (the default, 0), `ALWAYS`, `NEVER`, plus `merge_notetypes`.
- **Anki's own help text:** "By default, this is only done if the matching imported note was more recently modified." It also says that changes to template text and styling can always be imported, but schema changes need "Merge note types".
- **GUIDs and checksums** (`anki/utils.py`): `guid64` is base91 of a 64-bit number; `field_checksum` is the first 8 hex digits of SHA-1.
- **Anki's own legacy export** writes `meta` (LEGACY_2), `collection.anki21`, and a dummy `collection.anki2` holding "Please update to the latest Anki version…".

**E2. aqt 26.9.4** (https://pypi.org/project/aqt/26.9.4/)
- `aqt/theme.py`: the card body classes are `card card{n} … nightMode night_mode`.
- `_aqt/data/web/css/reviewer.css`: `body.nightMode{background-color:var(--canvas);color:var(--fg)}`.

**E3. AnkiDroid** runs desktop Anki's Rust code, which includes the importer. Its backend on Maven Central is `io.github.david-allison:anki-android-backend`, latest `0.1.75-anki26.09.3` (updated 2026-10-28). The POM describes it as the "JNI bridge between AnkiDroid and Anki Desktop's Rust code" (https://repo1.maven.org/maven2/io/github/david-allison/anki-android-backend/maven-metadata.xml). For AnkiMobile (closed source), I found nothing to verify.

**E4. genanki 0.13.1** (MIT; https://pypi.org/project/genanki/0.13.1/)
- `apkg_schema.py`, `apkg_col.py`, and `util.guid_for`, which is SHA-256 to base91.
- The README: "If you import a new note that has the same GUID as an existing note, the new note will overwrite the old one".

**E5. anki-apkg-export 5.0.0** (https://registry.npmjs.org/anki-apkg-export; tarball `dist/index.js`, `docs/api.md`)
- `addNote` sets `const mod = Math.floor(Date.now() / 1e3)`.
- `createModel` sets `rtl: false`.
- It ships `dist/sql-wasm.wasm`, byte-identical to sql.js 1.14.2's, but depends on `sql.js ^1.14.2`, so a fresh install resolves 1.16.0.
- Provenance: https://registry.npmjs.org/-/npm/v1/attestations/anki-apkg-export@5.0.0

**E6. genanki-js 2.0.0** (https://registry.npmjs.org/genanki-js): `package.json` gives AGPL-3.0-or-later and publication on 2022-05-03; `License.md` names mkanki (AGPL).

**E7. sql.js** (https://registry.npmjs.org/sql.js)
- Releases: 1.14.2 (Aug), 1.15.0/1/2 (Oct 14, 19, 26) and 1.16.0 (Nov 10, 2026).
- The exports map sends the `browser` condition to `sql-wasm-browser.js`. Within one version, `sql-wasm.wasm` and `sql-wasm-browser.wasm` are byte-identical.
- The README covers `locateFile`. The glue code falls back to "ArrayBuffer instantiation" when the `.wasm` MIME type is wrong, which was seen here.

**E8. Browser test in this sandbox** (Vite 5.4.21 and Playwright Chromium)
- An exporter built like `pdf.ts` (`await import("sql.js")` plus `await import("sql.js/dist/sql-wasm-browser.wasm?url")`) produced 120 cards and a canvas JPEG, 15.6 kB, in about 1.1 s.
- Anki imported all 120 notes, the JPEG, and Check Database passed.
- Chunks: wasm 685 kB (335 kB gzip), glue 41 kB (15 kB gzip), and the export chunk 105 kB, of which JSZip (`jszip.min.js`, 97.6 kB) is most. The repo already ships JSZip in the study chunk, because `Upload.tsx` imports `pptx.ts` statically.

**E9. anki-apkg-export in the browser.** Its README recipe (`anki-apkg-export/sql-wasm.wasm?url`) failed: with sql.js 1.16.0 glue and the 1.14.2 wasm, Chromium threw "ce is not a function" and the export never settled. With `sql.js@1.14.2` pinned, it worked.

**E10. Web Share and downloads**
- MDN browser-compat-data 8.1.9: `navigator.share` and `canShare` with `files` work in Chrome Android 76+ and Safari iOS 14+.
- web.dev (search excerpt) says Chromium shares only certain audio, image, PDF, video and text types: https://web.dev/articles/web-share. So `.apkg` will probably fall back to download on Android.
- WebKit bug 209407, "Download attribute does not work when page is installed on home screen" (2020, current status unknown): https://auto-bugs.webkit.org/show_bug.cgi?id=209407

**E11. Text import** (search excerpts)
- The manual says headers need Anki 2.1.54+: https://docs.ankiweb.net/importing/text-files.html
- GUIDs starting with `#` must be quoted: https://forums.ankiweb.net/t/import-ignores-anki-guids-starting-with/38917
- A report that headers were ignored in 26.09.02: https://forums.ankiweb.net/t/file-headers-no-longer-working-for-anki-import/71075. **In 26.9.4 they were honoured** (§4).

**E12. AnkiWeb and AnkiMobile** (search excerpts)
- The manual says AnkiWeb cannot import `.apkg` files: https://docs.ankiweb.net/manual/importing/packaged-decks
- Forum posts say that tapping a downloaded `.apkg` in Files or Safari opens AnkiMobile's import screen: https://forums.ankiweb.net/t/importing-from-apple-downloads-to-ankimobile/35424

**E13. Repo files read:** `package.json`, `tsconfig.json`, `src/vite-env.d.ts`, `src/study/lib/{pdf,pptx,images,api}.ts` (the lazy-import pattern, the figure paths `<group>/<lecture>/s<n>-<k>.jpg`, `figureUrls`), `SummaryView.tsx` (`<bdi>`, `LATIN_RUN`), `supabase/study-schema.sql` and `README.md`.

## 4. How to test (here, the same way as the rest of the app)

`spec/anki-proto/run-all.sh` does everything below; all checks currently pass.

**Package checks** (`check_apkg.py`, `check_notetype_mod.py`, `check_schema_change.py`, `check_nt_edit.py`)
- Node 22 runs the TypeScript writer directly. The script `make-apkg.ts` writes v1, v2, v3, v1-older and v4-schema packages.
- A Python venv with `anki==26.9.4` (pip-installable here) imports them into a fresh collection and checks counts, fields, `rtl` flags, CSS, Hebrew nested decks, the copied media file, and rendered HTML (`dir="rtl"`, `<bdi>`, `<img>`). It also checks "if newer" both ways, kept scheduling, the student's surviving edit, a no-op second import, the note-type CSS update, the field-change conflict and id collisions.

**Text checks** (`check_text.py`)
- `get_csv_metadata` and `import_csv` honour separator, html, tags column, GUID column and deck.
- Re-import updates by GUID.
- A Hebrew-language collection has no "Basic" note type.

**Browser and build checks**
- The Vite build, then Playwright clicks export and saves the download; `check_browser.py` re-imports it.
- `tsc` runs with the repo's options.
- `render-card.cjs` screenshots Anki's rendered HTML, in day and night mode.

**For the real implementation:**
- Point the same scripts at `src/study/lib/anki.ts`.
- Add an export step to the existing `study-e2e.js` mocked-Supabase run: tap export, save the download, run the `anki` import check. Also assert that the `.wasm` is not requested before the tap.
- Add a guard test that fails if `FIELDS` changes while `NOTETYPE_ID` stays the same.
- Add a SQL test, in the existing harness, that a content update raises `updated_at` and a non-content update does not.
- Run `npm run build` and confirm that the wasm is emitted and the study entry chunk did not grow.

## 5. Risks and open questions

1. **Not verified on real phones.** I could not check:
   - AnkiMobile's and AnkiDroid's import flow;
   - whether iOS's share sheet lists AnkiMobile for a `.apkg`;
   - downloads from the home-screen app (WebKit bug 209407).

   Shoham's iPhone and an Android phone must be tested before launch, both in the browser and as a home-screen app. Ask which Anki app each member uses. AnkiMobile is a paid app; its price was not checked.
2. **AnkiMobile's import code version is unknown.** The installed AnkiDroid app may lag behind the backend version listed on Maven Central.
3. **sql.js changes often**: four releases in four weeks. Pin the exact version, and always take the glue code and the wasm from the same package (E9). Upgrade only with `run-all.sh`.
4. **The wasm is 685 kB** (335 kB gzip), loaded on the first export. Whether Vercel compresses it and serves `application/wasm` is unverified; a wrong MIME type still works, with a console warning.
5. **The field list is permanent.** Agree on `Front, Back, Extra, Image, Source` before the first real export. Changing it later forces "Merge note types" or creates duplicate note types.
6. **Deleted and renamed cards.** Import never deletes, and a rename moves nothing. Decide whether to use soft-delete with the tag `tamtzit::נמחק`.
7. **Students who edit in Anki.** Their edits survive only until the same card changes in the app, under the default "If newer". If a student adds fields to our note type, later updates stop ("conflicting").
8. **The text fallback** needs Anki 2.1.54 or later and the import screen. It is not a substitute for the `.apkg`.
9. **The manual was not read directly** (see §3). Quotes from it in E10–E12 are search excerpts.

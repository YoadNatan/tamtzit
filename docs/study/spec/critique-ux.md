# Critique: UX on a phone, Hebrew RTL, and medical-education value

**Reviewed:** `spec/spec.md` (10,841 lines). Where the spec hands screen behaviour to a design, I read that design's screens: design-questions §1, §4-§6; design-quiz §1, §4.4, §5; design-cards §1, §6.3; design-collab §1; design-me §1; design-platform §1 and §4.2. I also read the repo's study app at `54a90f8`: `study/index.html`, `StudyApp.tsx`, `LectureView.tsx`, `Library.tsx`, `Join.tsx`, `Together.tsx` and `study.css`. Line numbers below are from those files. "spec L…" means `spec/spec.md`.

**Not verified, said plainly**

- **NBME guidance.** `www.nbme.org` and `aarad.org` do not resolve from this session; they would have to be allowed in the session's network settings. I did not read NBME's guide. A web search found only secondary sources (for example a NEOMED faculty handout that lists NOT/EXCEPT/LEAST LIKELY lead-ins as ones to avoid). No finding below depends on NBME's exact wording.
- **Devices.** No phone was used. Browser behaviour is cited from local copies of MDN that this workflow fetched earlier (`spec/_quiz-docs/`).
- **Contrast.** The ratios below were computed here from `study.css`'s tokens with the WCAG relative-luminance formula. The WCAG AA thresholds (4.5:1 for text, 3:1 for large text) are quoted from the standard; `w3.org` was not fetched.

**Count: 1 blocker, 8 major, 18 minor.**

| ID | Severity | Where | Finding |
|---|---|---|---|
| UX-1 | **blocker** | §1.1 row 1, §2.10, §5.2, §5.7, §7, §8.3 | Item 1 is NEXT, but you can't practise alone until release 8. The release-4 screens lead to dead ends that no test covers |
| UX-2 | **major** | §3.3 Q, §4.6, design-questions P7-P8 | A mistake leaves the list on its first right answer, and the options never move, so the list empties through recognition |
| UX-3 | **major** | §5.8, design-questions P4-P5, design-cards K4, design-quiz Q/R1 | Primary actions aren't anchored in the thumb zone. After an answer the screen is about two screens tall |
| UX-4 | **major** | design-quiz R1/R2, design-questions P5, design-cards K4, §2.12 #21 | Checking a slide leaves the session. In a live quiz it costs the next question |
| UX-5 | **major** | design-quiz §1.1/S, design-me R4, §1.2, D4 | The meeting's quiz needs questions that nobody has generated |
| UX-6 | **major** | §5.5 `rounds.ts`, §4.3.2, design-questions §4.3/§5 | Question and card rounds die when the phone locks or the member leaves P2/K2 |
| UX-7 | **major** | design-collab A2-A3, §6.4 K | The correction editor is raw markdown in an RTL textarea, with no preview and four taps before typing |
| UX-8 | **major** | §5.8, `study.css`, design-cards K4 | State-coloured buttons in dark mode and the newly tappable slide tags fail contrast and size |
| UX-9 | **major** | §1.1 row 5, D15, design-platform 1.C | The agreed audio path works in practice only on a computer, but the group is phone-first |
| UX-10 | minor | §6.0 rule 2, §6.4 | One thing, two names: the mistakes list, "מבחן קבוצתי", "תוכנית ומרתונים" |
| UX-11 | minor | §5.1 Back, §5.6 LectureView | The reader's back label "→ לספרייה" is wrong whenever back leads elsewhere |
| UX-12 | minor | §2.7, §5.2 | "לשאול" from a paragraph drops following during read-aloud |
| UX-13 | minor | §5.6 Library, §5.2 `first` | In the library bar, Enter (the keyboard's search key) sends a paid question |
| UX-14 | minor | §5.6 Library | The new chips are nested inside the lecture card's `<button>` |
| UX-15 | minor | §5.1 "שלי", design-cards K4 | The text-size setting applies only inside the reader |
| UX-16 | minor | design-questions P6 | "Retire for everyone" is checked by default, and there is no "hide for me" for questions |
| UX-17 | minor | §6.3 | After accounts ship, the expired-session copy tells saved members to re-join, which creates a duplicate member |
| UX-18 | minor | §6.1-§6.4, `Join.tsx` | Existing strings missed by the gender sweep, artifacts in the deck, e2e steps that assert replaced copy |
| UX-19 | minor | §5.1 LiveBanner, design-me R6, §8.3 | The banner's priority is defined two different ways, and its stacking and placement are unspecified |
| UX-20 | minor | §2.7, design-platform §4.2 | The library stacks an upload bar on top of the tab bar, about 160 px at the bottom |
| UX-21 | minor | §2.10, design-cards K8, §8.6 | Before release 8, iPhone members need paid AnkiMobile to study cards |
| UX-22 | minor | design-questions P4-P5/E4, §4.6 | There is no exam mode, and an uncovered past-exam item repeats one sentence five times |
| UX-23 | minor | §4.6-§4.8, design-collab §5 | Corrections never reach questions or cards, and recording notes never reach "לשאול" |
| UX-24 | minor | design-quiz R2/E2, D7, D8, §6.2 | The race shows who is last every round, and rushed race answers mark weak points |
| UX-25 | minor | §2.4 | The 80% reserve shields summaries from only two features |
| UX-26 | minor | design-collab §1.2/A5, §5.1 "יחד" | Corrections are invisible unless someone opens that paragraph |
| UX-27 | minor | §8.3-§8.6 | No test checks the experience with the people who will use it |

---

## Blocker

### UX-1 · blocker · Item 1 is NEXT, but you can't practise alone until release 8, and the release-4 screens lead to dead ends that no test covers

**Where:** §1.1 row 1 (spec L142); §2.10 rows 4 and 8 (L361, L365); §2.5 last bullet (L290); §5.2 "Flags (allowed)" (L600); §5.7 (L8824); §7 "Every package's pull request passes" (L10254); §8.3 (L10461); §9.1 step 5 (L10551-L10558); D3 (L10578).

**What is wrong**

1. **Practising alone comes last.** Item 1, practice questions with an explanation for every option, is marked **NEXT**. Yet practice sessions (`VITE_STUDY_PRACTICE`) are release 8. That release waits for three things: email sign-in (release 7), custom SMTP on a domain Yoad controls, and a week of moving the group to saved accounts. Release 4 ships the question bank and the live quiz. That bank can be used only inside a live quiz with the whole group. Nobody can answer a question alone and read why each option is right or wrong, which is the heart of item 1.
2. **The gate doesn't protect anything.** D3 already records every member's quiz answers privately on their anonymous identity before sign-in (L361, L10578). design-me's own rule is "Nudge, don't gate. Private features work for anonymous members (saving later keeps the same id, so nothing is lost)" (design-me L43; spec §2.5 L290). Decision 11 says "private progress or mistakes", which are screens; it does not forbid answering a question.
3. **Releases 4-7 ship a tab with dead ends.** The "תרגול" tab appears whenever `flags.questions` is on (§5.1 L8560). Its screens are specified only with sessions on: P2's "להתחיל" and "רק הטעויות בהרצאה", P1's "הטעויות שלי", and the quiz end screen's "לחזור על השאלות" (design-quiz L172, which has no destination at all). With practice off, `allowed()` turns every session URL into the library (L600). A tap on these buttons silently lands on the library.
4. **That configuration is never tested.** Each package's e2e runs once with every one of its flags on and once with all flags off (L10254). Practice builds always set `VITE_STUDY_QUESTIONS=1` together with `VITE_STUDY_PRACTICE=1` (L10461). The flag set the group actually uses for weeks is never run. Release 5 has the same gap: cards on, in-app review off (design-cards §6.3 builds with both flags, L2175).

**Fix**

- **Ship practice sessions with release 4.** That means P4 (the question), P5 (feedback with every explanation) and P7 (end of round), under `VITE_STUDY_PRACTICE`. Answers are recorded on the member's current identity, exactly as quiz answers already are. The screens decision 11 names stay behind release 8: "הטעויות שלי" (the P1 card, P8, `s=m`), progress and the plan. Once A1 ships, P2 shows A6's nudge.
- **Or keep the literal gate, at a price.** If Yoad wants it, A1 moves into release 4 and custom SMTP becomes a prerequisite of NEXT. Either way, §2.10 and D3 must say which was chosen.
- **Add a flag-state table to §5.7.** For each flag set that ships (releases 3-12), list what P1, P2, K1, K2, the quiz end screens and the lecture's chips show. No control may link to a route that `allowed()` rejects. When a route is rejected anyway, `allowed()` shows one line instead of jumping silently: "התרגול האישי ייפתח בקרוב. בינתיים אפשר לפתוח מבחן קבוצתי על ההרצאה."
- **Test:**
  - `route.test.ts` renders each screen's links under each shipping flag set and asserts that none targets a rejected route.
  - Each package's e2e also runs with its own release's flag set: release 4 is QUESTIONS+QUIZ; release 5 adds CARDS without CARDS_REVIEW. It asserts that no step lands on the library unless the step asked for it.

---

## Major

### UX-2 · major · A mistake leaves the list on its first right answer, and the options never move, so the list empties through recognition

**Where:** §3.3 section Q, `study_my_mistakes` (spec L1958-L1970); §4.6 "Option order and duplicates" (L8022); design-questions P7 (L153), P8 (L156), e2e step 9 (L1748).

**What is wrong**

- **One right answer clears a mistake.** `study_my_mistakes` keeps only the latest answer per question, so a question leaves "הטעויות שלי" the moment that answer is right.
- **The retry tests memory of the letter.** P7 offers "רק הטעויות מהסבב" right after the round, with every explanation just read. Options are stored once in display order: they are shuffled at generation and then fixed (design-questions L190, L282-L283). The retry is therefore answered by remembering "it was ב". The live quiz's discussion ("התשובה הנכונה: ב") reinforces the same letter.
- **Nothing tests recall after a delay.** The list empties within minutes. Weak points are counted per study day ("the first answer to a question per study day", design-me L45), but the mistakes list is not.
- **The test locks this in.** e2e step 9: "answering one right removes it from 'הטעויות שלי'".

**Fix**

- **Option order.** In practice sessions only (in the live quiz every phone must show the same order), show non-numeric options in a fresh permutation each time a question is presented.
  - Keep the permutation in the session state, so a reload shows the same order.
  - Map the choice back to the stored index before `study_answer_question`, and permute the explanations with it.
  - Keep all-numeric options ascending.
  - Add to `QUESTIONS_SYSTEM`: "In a 'why', never refer to another option by its letter or position; name it." Add a `checkQuestion` warning for `/תשובה [א-ה]\b/`.
- **Clearing.** A mistake clears only after a right answer on a *later study day* than its last wrong answer. Use the same 04:00 rule as `study_day()` in section C.
  - A same-day right answer shows under the headline: "תשובה נכונה. השאלה תחזור מחר, כדי לבדוק שזה נשאר."
  - P8's "יצאה מרשימת הטעויות" appears only on that later day.
- **Test:**
  - SQL checks: wrong, then right on the same study day → still in `study_my_mistakes`; right on the next study day → cleared.
  - `practiceSession.test.ts`: over 500 seeds the choice, the key and the explanations stay aligned, and numeric options are never permuted.
  - Update e2e step 9 to match.

### UX-3 · major · Primary actions aren't anchored in the thumb zone, and after an answer the screen is about two screens tall

**Where:** §5.8 (the shared rules, L8840); design-questions P4-P5 (L115-L132) and the `QuestionCard` `footer` prop (L1467); design-cards K4 (L121-L131); design-quiz Q and R1 (L136-L157); design-me R4 (L306).

**What is wrong**

- **Only the top bar is pinned.** P4 has a "Sticky top bar", and the quiz has `.quiz-top` sticky (design-quiz L1382). I found no "sticky" bottom or thumb-reach rule anywhere in the designs.
- **The repeated action sits after the content.** Each session repeats one action many times: "לשאלה הבאה" (practice, and the quiz host), "הצגת התשובה" and the four ratings (cards), "לשלב הבא" (marathon). Each of these sits after the content, wherever that ends.
- **P5 is long.** After an answer, P5 shows the vignette, five options each with a 1-2 sentence explanation, "מה לזכור" and the flags. The measured stand-in item is 1,190 characters of JSON (design-questions §7 L1816). The schema allows up to 5 × (220 + 450) characters of options and explanations (spec L8020). At 17 px on a 360-390 px wide phone that is roughly 1,300-1,600 px (my estimate), about two screens. Every question then costs a scroll plus a reach, one-handed, at night.
- **§5.8 has no rule** that the primary action must be reachable without scrolling.

**Fix**

- **Add to §5.8:** "Every immersive screen has one sticky bottom action bar (`position: sticky; bottom: 0`, padded by `env(safe-area-inset-bottom)`) holding that screen's primary action. Toasts sit above it." The actions per screen:
  - P4/P5: "לשאלה הבאה" or "לסיכום הסבב".
  - The quiz host: "לחשוף עכשיו", then "לשאלה הבאה".
  - Cards: "הצגת התשובה", then the four ratings.
  - Marathon: "לשלב הבא".
- **After an answer,** scroll the headline to the top (it already takes focus). Keep the chosen option's and the right option's explanations open. If the first rounds show that students skip the other three, fold them behind one tap ("ההסבר לשאר התשובות"); the requirement is met either way.
- **Test:** at every step, each package's e2e asserts the primary action's box is fully inside the bottom quarter of the viewport without scrolling, at 390×844 and 360×640, in light and dark.

### UX-4 · major · Checking a slide leaves the session, and in a live quiz it costs the next question

**Where:** design-quiz R1 (L151) and R2 (L162); design-questions P5 (L129); design-cards K4 (L128); spec §2.12 #21 (L401); §5.6 LectureView row (L8798).

**What is wrong**

- **A slide tag opens the whole reader.** Tapping a tag in an explanation opens `?l=<id>&slide=n` and relies on Back to return.
- **In the quiz room the player misses the next question.** The host moves on; the next question opens after a 3-second countdown and runs its own timer (design-quiz §1.5 L214-L215). Meanwhile the player is in the reader, and the only way back is the banner's "חזרה למבחן".
- **In practice and cards it is a full page load** (parts, figures, the presence channel) just to read one line.
- **K has already designed the right thing.** `SlideSheet` shows the slide's text and figure over the current screen, with "לפסקה בסיכום" (design-collab B4 L214-L217).

**Fix**

- Move `SlideSheet` into F's shared components.
- Make every slide tag in Q, Z, C and K open it over the current screen; "לפסקה בסיכום" stays inside the sheet.
- In the quiz room, while a round is open or the host can advance, the sheet hides "לפסקה בסיכום" and closes itself when the next countdown starts.
- **Test:**
  - Quiz e2e: during a reveal, tap "ש׳ 23" → the sheet opens and the URL is unchanged. The host advances → the sheet closes and that phone shows the countdown.
  - Practice e2e step 5 asserts the sheet instead of navigation.

### UX-5 · major · The meeting's quiz needs questions that nobody has generated

**Where:** design-quiz §1.1 story 1 (L57), S "על מה" (L104), §5.3 (L1508); design-me R4 quiz step (L301); spec §1.2 (L163) and D4 (L10578).

**What is wrong**

- **The headline story assumes questions exist.** It reads: "After the group reads a lecture together, Shoham opens a group quiz on it". But the lecture read today is new, and under D4 questions are written only when someone taps.
- **The setup then sends the group away to wait.**
  - Setup shows "אין עדיין שאלות" with a link out to P2.
  - P2 opens the cost sheet, then runs a round of eight model calls at effort high: the first alone, then two at a time.
  - No design gives a duration. The cards design says a whole deck takes "a few" minutes (design-cards L55).
  - Six people wait, then return to setup and start again.
- **A marathon's quiz step hits the same dead end** (design-me R4).

**Fix**

- **Generate from the setup.** A lecture without questions shows "ליצור שאלות ולפתוח את המבחן", with P3's estimate line.
  - Tapping it starts the round from the host's phone and opens the lobby at once.
  - The lobby shows "נכתבות שאלות: 4 מתוך 10".
  - "להתחיל" enables when the chosen count, or at least 5, is ready.
- **Marathons.** Marathon creation (R2) offers, once, "ליצור שאלות להרצאות של המרתון" with the summed estimate.
- **Optional:** a group setting for automatic rounds after each summary, shown with its monthly estimate. D4's "on a tap" stays the default.
- **Test:** quiz e2e with a lecture that has no questions:
  - The lobby opens while the mock streams `t:"q"` lines.
  - "להתחיל" stays disabled until 5 are ready.
  - Each model call leaves exactly one charge.

### UX-6 · major · Question and card rounds die when the phone locks or the member leaves P2/K2

**Where:** §5.5 F `rounds.ts` (spec L8702); §4.3.2 (`UnitKind` is outline, part and notes only: L7446); design-questions P3 (L113), §4.3 (L1489-L1525), §5 "The phone sleeps mid-round" (L1553); design-cards K3 (L119).

**What is wrong**

- **Rounds still run on the phone.** Decision 10 moved summaries to the server so the phone can close. Questions and cards are still driven by the phone that tapped "ליצור" (`generateRound()` / `generateDeck()` "from this phone").
- **A locked screen pauses them.** It hides the page, and browsers throttle background work: "Timers such as `setTimeout()` are throttled in background/inactive tabs" (MDN, Page Visibility API, https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API; local copy `spec/_quiz-docs/mdn-page-visibility.md` L33-L41).
- **No Wake Lock covers generation, and one wouldn't help everyone.** On iOS Safari 16.4-18.3 MDN marks Wake Lock "Does not work in standalone Home Screen Web Apps"; support begins in 18.4 (MDN browser-compat-data `api.WakeLock`; local copy `spec/_quiz-docs/bcd-WakeLock.json`).
- **Stalled parts wait six minutes.** Unstarted parts sit until someone taps "לנסות שוב" after 6 minutes.
- **P2 encourages leaving.** It offers "להתחיל לתרגל" mid-round, which navigates away. The spec does not say whether the round's loop survives P2 unmounting.
- **Result:** "15 שאלות" turns into 6, and parts read "החלק הזה לא נכתב."

**Fix**

- **Preferred:** give W's queue two more unit kinds, `questions` and `cards` (one unit per batch).
  - `study_private.dispatch()` dispatches them, and `work.ts` runs them with the worker key.
  - Rounds then finish with the phone closed, like summaries.
  - The client only shows progress, which `watchPractice` and `watchCards` already do.
- **Minimum:**
  - Run rounds from an app-level store, not from P2/K2.
  - Hold a Wake Lock while a round runs.
  - Resume unstarted parts on `visibilitychange` → visible, instead of after 6 minutes.
  - Show on P2/K2: "כדאי להשאיר את המסך פתוח עד שהשאלות נכתבות."
- **Test:**
  - Practice e2e: after the first `t:"q"` line, tap "להתחיל לתרגל"; every batch still gets its request.
  - Emulate `visibilityState` hidden for 30 s, then visible: pending batches resume with no tap.
  - With the server path, add `work.test.ts` cases for both kinds.

### UX-7 · major · The correction editor is raw markdown in an RTL textarea, with no preview and four taps before typing

**Where:** design-collab A2 (L122-L132) and A3 (L134-L152); spec §6.4 "Copy · K" A2-A3 (L9691-L9724).

**What is wrong**

- **Raw markdown.** The editor is a plain `dir="rtl"` textarea holding the block's markdown:
  - `**bold**`, and binomial names in `*…*`;
  - English terms with hyphenated Hebrew prefixes (ה-PFOR);
  - `[ש' 12]` tags.

  The only guidance is a hint: "הטקסט בין ** ** מודגש. את תגית השקף, למשל [ש' 12], כדאי להשאיר בסוף."
- **Hard to read right-to-left.** In an RTL field, asterisks and brackets next to English runs are reordered visually, so it is hard to see what is bold or where a tag ends.
- **A deleted slide tag goes unnoticed.** The server checks only the structure, so it accepts the edit.
- **No preview.** The card editor has a live preview (design-cards K6 L151); this editor does not.
- **Four taps before typing,** even when there is no history: paragraph → "תיקון" → the history view → "תיקון הפסקה" → the field. A2's empty state shows a message and a button instead of the editor.

**Fix**

- Open the editor directly when the block has no corrections. When it has some, show the history collapsed above the editor.
- Render a live preview under the field with `SummaryView compact` (bold, italics, tags as chips).
- Compare the slide tags before and after, and warn: "תגית השקף ש׳ 12 נמחקה." with "להחזיר", which restores the tag at the end.
- Give the textarea `unicode-bidi: plaintext`.
- **Test:** collab e2e on a block that has both `**…**` and `[ש' 12]`:
  - The field has focus after two taps.
  - Typing updates the preview.
  - Deleting the tag shows the warning, and "להחזיר" restores it.
  - Take screenshots in light and dark.

### UX-8 · major · State-coloured buttons in dark mode and the newly tappable slide tags fail contrast and size

**Where:** §5.8; design-cards K4 colours (L129). Slide tags become links in design-questions P5 (L129), design-quiz R1 (L151) and design-collab B3-B4. The colours live in `study.css`.

**What is wrong**

- **Filled state buttons use white text that fails in dark mode.**
  - The codebase fills buttons with state colours and white text: `.btn.danger { background: var(--bad); color: #fff }` (`study.css` L157-L161).
  - In dark mode `--bad` is #ff8a80 and `--ok` is #5cc28f (`study.css` L51-L52). White on them is 2.28:1 and 2.19:1. In light mode, white on `--warn-line` (#e0b252) is 1.97:1. AA asks for 4.5:1.
  - The card ratings are specified only as "שוב `--bad`, קשה `--warn-line`, טוב `--ok` (the primary), קל `--accent`", with no text token.
  - New danger buttons are coming too: "מחיקה לכל הקבוצה", "יציאה בכל זאת", "ביטול המבחן".
- **Slide tags become the main way to check a fact, but they are styled as decoration.** They are central in P5, the quiz reveal, cards and "לשאול", yet `.src-tag` is:
  - 0.72em, about 12 px;
  - `--faint` on `--line`: 2.3:1 in light and 3.02:1 in dark (`study.css` L558-L569);
  - without an enlarged hit area, against §5.8's own "tap targets ≥ 44 px".

  The recording time chip `.rec-time` gets a 44 px `::after` (design-platform L1854); the slide tags don't.
- **No test checks contrast or target size.** §8.3 (L10455) asserts only page errors, unmocked calls and overflow.

**Fix**

- Add the tokens `--ok-ink`, `--bad-ink` and `--warn-ink` per theme (in dark, `#0b1418`, as `--accent-ink` already is).
- Add a rule to §5.8: a filled state colour always pairs with its ink token, or uses the tinted style that `.chip.ok` already has (16% fill, text in the colour; `study.css` L334-L345). Fix `.btn.danger` in dark mode.
- Add a `.src-link` style for tappable tags: at least 4.5:1 in both themes and a 44 px `::after` hit area, as `.note-add` has.
- **Test:** a shared e2e helper runs at every screenshot. It walks the visible buttons, chips and links and asserts, in light and dark:
  - computed contrast ≥ 4.5:1, or ≥ 3:1 for large text;
  - a hit area ≥ 44×44 px.

### UX-9 · major · The agreed audio path works in practice only on a computer, but the group is phone-first

**Where:** §1.1 row 5 (spec L146); D15 (L10589); design-platform §1.C (L172-L193); research-transcription L17-L18 and L191.

**What is wrong**

- **The only audio path runs on the device.** The agreed decision 5 is "start with audio-file upload and transcription". The spec's only audio path is transcription in the browser:
  - a 1.61 GB model download;
  - "מומלץ במחשב עם Chrome או Edge", and "ניסיוני" on phones;
  - "יש להשאיר את המסך פתוח" for the whole run.
- **The research itself warns against phones.** Research-transcription says phone memory limits and Safari evicting the model are unverified, "a locked screen stops the work", and "Computers stay the default".
- **The group's audio is on their phones.** The files often arrive through WhatsApp. A 2-hour lecture then means an evening on a laptop, or a 1.6 GB download on mobile data.
- **The phone-friendly path is cheap.** D15 itself lists a server provider at about $0.08-0.20 a lecture, well inside the budget.

**Fix**

- Change D15's recommended default:
  - On a phone, the audio goes to Supabase Storage, and a server transcription op (`api/study/transcribe.ts`, a 7th function, still under the limit of 12) charges the same ledger as kind `transcribe`.
  - In-browser transcription stays as the $0 option on computers.
  - RecordingSheet picks the path by device and shows the cost before starting.
- Until then, show the 1.6 GB size and "עדיף ב-Wi-Fi ובמחשב" **before** the download starts, not during it.
- **Test:**
  - Unit tests for the op with a mocked provider.
  - Recording e2e at phone size chooses the server path and shows the cost line.
  - A device check on Shoham's iPhone with a WhatsApp audio file (§8.6), before the flag is turned on.

---

## Minor

### UX-10 · minor · One thing, two names

- **The mistakes list has two names.**
  - "הטעויות שלי": P1 and the quiz end screen (spec L9141, L9415).
  - "טעויות לחזרה": the rows in "שלי", progress and the plan (L9122, L9944, L9965, L10050).

  §6.0 rule 2 (L8865) says to use the same words for the same things.
- **"מבחן קבוצתי" is both the feature and one of its modes.**
  - As the whole feature: the lecture chip (L8798), the "יחד" card, the setup title "מבחן קבוצתי חדש" (L9304) and the help row (L8921).
  - As one mode: "קבוצתי" · "תחרותי" (L9307-L9309).

  Someone looking for the race won't look under "מבחן קבוצתי".
- **Stale and inconsistent strings.**
  - "תוכנית ומרתונים" in "שלי" (L9123) is stale: marathons live in "יחד" (design-me L84-L85).
  - The quiz says "שאלה 3 / 10" (L9359) but "שאלה 1 מתוך 10" (L9353).
- **Fix:**
  - Call the list "הטעויות שלי" everywhere; in a plan row, "לחזור על הטעויות · Antimalarials · 4".
  - Name the entry points "מבחן חי" (setup title "מבחן חי חדש"), with the modes "קבוצתי" · "תחרותי"; banners keep the mode's name.
  - Drop "תוכנית ומרתונים".
  - Use "שאלה 3 מתוך 10" everywhere.
  - Add these pairs to the copy judge's rule-2 list.

### UX-11 · minor · The reader's back label is wrong whenever back leads elsewhere

- **Where the label is.** LectureView's back button says "→ לספרייה" (`LectureView.tsx` L518-L519, L533-L534).
- **Where back actually goes.** The spec routes members into the reader from:
  - a practice question, where "Back returns to the session" (design-questions L129);
  - a quiz reveal, a card and AskView;
  - plan tasks, progress and marathons.

  Back runs `history.back()` (§5.1 L8562), so the label names the wrong place.
- **A second arrow for marathons.** The marathon case adds "→ למרתון" (§5.6 L8798) to a header that already holds five controls plus the room bar (L532-L570).
- **Fix:**
  - Take the label from the previous in-app entry (`history.state.from` → "→ לתרגול", "→ למבחן", "→ לכרטיסיות", "→ לשאלה", "→ לתוכנית", "→ למרתון"); the default is "→ לספרייה".
  - Remove the separate "→ למרתון".
  - Test in `shell.cjs`.

### UX-12 · minor · "לשאול" from a paragraph drops following during read-aloud

- **What happens.** "לשאול" on a paragraph navigates to `?v=ask&l=…&at=…` (§2.7 L322). Following is LectureView state (`LectureView.tsx` L108), so it is lost when the reader unmounts. Back returns to `?l=<id>` without it; `follow=1` exists only for marathon links (design-me L77). The member has to find "לעקוב" again in the middle of the reading.
- **Fix:** either open AskView as a sheet over the reader (as ParagraphSheet is), or replace the reader's URL with `follow=<reader id>` before leaving.
- **Test:** together e2e: follow, ask, Back, still following.

### UX-13 · minor · In the library bar, Enter (the keyboard's search key) sends a paid question

- **What happens.** One field does two jobs (§5.6 L8795): typing filters titles for free, and Enter opens `?v=ask&first=…`, which asks Claude right away (§5.2 L8596).
- **Why it matters.** On a phone, people press the keyboard's search key after typing a search. That spends money and one of the day's 20 questions.
- **Fix:**
  - Set `enterkeyhint="search"` and make Enter open the first hit.
  - Asking becomes an explicit last row: "לשאול: ״…״ · נשארו היום 18".
- **Test:** e2e types and presses Enter; no request goes to `/api/study/ai`.

### UX-14 · minor · The new chips are nested inside the lecture card's `<button>`

- **What happens.** The library card is a single `<button class="lecture-card">` (`Library.tsx` L156-L177). F adds the practice and cards chips inside it (§5.6 L8795), and design-questions calls "15 שאלות" an entry point (L73).
- **Why it matters.** A tappable chip inside a button is invalid HTML. A small chip inside a large tappable card can't meet §5.8's 44 px rule.
- **Fix:** decide one way:
  - the chips are plain text (the card opens the lecture); or
  - the card becomes a container with one main link and separate chip links, each with a 44 px hit area.
- **Test:** e2e asserts no interactive element inside `.lecture-card`.

### UX-15 · minor · The text-size setting applies only inside the reader

- **What happens.** `--reading-size` is set on `main.lecture` only (`LectureView.tsx` L531; `study.css` L27, L523).
- **Why it matters.** The spec places the size setting in "שלי › הגדרות" as if it were app-wide (§5.1 L8564). Card faces are fixed at 22 px and 17 px (design-cards L126-L128), and the designs say nothing about size for questions, the quiz or AskView. A member who enlarges text at night still gets small text in practice, cards and the quiz.
- **Fix:** set `--reading-size` on the shell's root, and size QuestionCard, CardFace, the quiz and AskView in `em` of it.
- **Test:** e2e at the largest size: no overflow at 360 px on P4, K4 and Q.

### UX-16 · minor · "Retire for everyone" is checked by default, and there is no "hide for me" for questions

- **What happens.** The flag sheet ticks "להוציא את השאלה מהתרגול לכל הקבוצה" by default for `wrong_key`, `two_answers` and `not_in_slides` (design-questions L145).
- **Why it matters.** The member who just got the question wrong is the likeliest to flag it, often at night. Cards offer "להסתיר ממני" (design-cards L108); questions don't.
- **Fix:**
  - Leave the box unchecked by default.
  - Add "להסתיר ממני" for questions: a private row, left out of that member's queue.
- **Test:** a SQL check, and an e2e step.

### UX-17 · minor · After accounts ship, the expired-session copy tells saved members to re-join

- **What happens.** `not signed in` and `session expired` map to "…צריך להצטרף מחדש עם קוד הקבוצה." for every member (§6.3 L8948).
- **Why it matters.** Once A1 ships, a saved member who follows this creates a new anonymous member, a duplicate, instead of signing in.
- **Fix:** with `flags.account` on, show "הכניסה במכשיר הזה פגה. נכנסים שוב עם המייל: ״כניסה עם מייל״." and open Join on the email sign-in.
- **Test:** add a step to `me.cjs`.

### UX-18 · minor · Existing strings missed by the gender sweep, artifacts in the deck, e2e steps that assert replaced copy

- **Rule 1 violations in F's own files.** These strings use a masculine verb about a person and were not swept:
  - `Join.tsx` L31: "אפשר לבקש אותו ממי שפתח את הקבוצה".
  - `Join.tsx` L46: "…ממי שפתח אותה".
  - The help row (§6.2 L8915): "״לעקוב״ מזיז את המסך יחד עם מי שמקריא".
- **Artifacts in the "final" deck:**
  - "(superseded by Z, …)" (L9106);
  - the broken line `תגובות" · "תיקון" · "אסוציאציה` (L9114).
- **E2E steps that assert replaced copy.** design-cards §6.3 step 5 expects "מישהו אחר ערך…" (L2191), which §6.1 #2 replaced. §8.3's integration changes don't update it.
- **Fix:**
  - Run `copydeck.py` and the judge over the existing strings in F's files: "אפשר לבקש אותו מהקבוצה", "כדי להצטרף צריך את קוד ההזמנה של הקבוצה", "״לעקוב״ מזיז את המסך יחד עם ההקראה".
  - Delete the two artifacts.
  - Generate the e2e's expected strings from the deck.

### UX-19 · minor · The banner's priority is defined two different ways, and its stacking and placement are unspecified

- **Two priority orders.**
  - §5.1 (L8561): "one line … in this order: reading aloud; QuizBannerLine; MarathonBannerLine".
  - design-me R6 (L317): "priority: a live quiz, then reading aloud, then a marathon".
- **Several lines at once.** §8.3 (L10468) expects "both banner lines". On immersive screens with sticky headers (the reader, card review, practice), two lines push the content down.
- **Placement is unspecified** relative to `.page-head.sticky` (top: 0).
- **Fix:** one line only, highest priority first (quiz > reading > marathon), with "+1" when more are active; render it inside the sticky stack.
- **Test:** `shell.cjs` with all three active.

### UX-20 · minor · The library stacks an upload bar on top of the tab bar

- **What happens.** With the tab bar (56 px plus the safe area), the library keeps its full-width "העלאת הרצאה" bar above it (`Library.tsx` L184-L190; design-platform L1850-L1852). That is about 56 + 72 + 34 ≈ 160 px fixed at the bottom of an iPhone, a quarter of a small screen, and toasts start at 140 px.
- **Fix:** move "העלאת הרצאה" into the library's header (or a compact button above the courses), leaving one fixed bar.
- **Test:** e2e asserts the fixed chrome at the bottom of the library is ≤ 56 px plus the safe area.

### UX-21 · minor · Before release 8, iPhone members need paid AnkiMobile to study cards

- **What happens.** Until in-app review ships (release 8), the only way to study cards is to export to Anki.
- **Why it matters on iPhone:**
  - It needs AnkiMobile, a paid app (research-anki L224; design-cards Q6 L2305). K8's help doesn't say so (design-cards L169-L173).
  - Downloads from Home Screen apps have an open WebKit bug (bug 209407, research-anki L179), but §8.6's Anki check (L10522) doesn't name the Home Screen app.
- **Fix:**
  - Ship a no-save flip mode with `VITE_STUDY_CARDS`: "עיון בכרטיסיות" (front, tap, back, next). It writes no state rows.
  - Add to K8: "באייפון פותחים את הקובץ באפליקציה AnkiMobile (בתשלום), או ב-Anki במחשב."
  - Add exporting from the Home Screen app to §8.6.

### UX-22 · minor · There is no exam mode, and an uncovered past-exam item repeats one sentence five times

- **Practice is always tutor mode.** Feedback follows every question (P4-P5), and a past exam is practised the same way, just in exam order (E4 L176). Exam readiness also needs timed blocks with feedback at the end.
- **Uncovered items repeat a sentence.** An uncovered item gets the fixed sentence "השקפים של ההרצאה לא עוסקים בזה." as every option's "why" (§4.6 L7895-L7897), so the screen shows the same line five times.
- **Fix:**
  - Add "מצב מבחן" on P2 and E4: time per question by `study_quiz__seconds`'s rule, no feedback until the end, then a review list with every explanation. It uses the same `study_answer_question` with mode `exam`; the client simply holds the feedback back.
  - Show the fixed sentence once for an uncovered item.
- **Test:** a `practiceSession` unit test, and an e2e step.

### UX-23 · minor · Corrections never reach questions or cards, and recording notes never reach "לשאול"

- **What happens.**
  - "Practice questions and cards are written from the slides, so corrections do not reach them" (design-collab L1371).
  - "לשאול" answers requirement 6, "מה המרצה אמר על…". It reads the deck and the corrections, but not the lecture's "מההקלטה" notes (§4.8 L8293).
- **Fix:** add a block after the cached deck, rebuilt for each request (so it stays uncached):
  - for questions and cards, the current corrections (§4.8's `correctionsBlock`), with "don't test a fact a correction disputes";
  - for "לשאול", when a recording exists, the recording notes with their times.
- **Test:** add a rubric case on a corrected fact.

### UX-24 · minor · The race shows who is last every round, and rushed race answers mark weak points

- **The whole table, every question.** R2 shows "the table, all players" after every question and the whole table again at the end (design-quiz L163, L176; D8 L10582). Among six friends, the person in last place is exposed every round. The group's owner asked that scores be visible only to their owner.
- **Rushed answers count as weaknesses.** The speed bonus rushes race answers, yet they count in private weak points like any other answer (D7 L10581; design-quiz open question 1, L1847).
- **The privacy line overstates.** "רואים כמה בחרו בכל תשובה, בלי שמות" (§6.2) is absolute. With two or three players, counts reveal choices (design-quiz L208).
- **Fix:**
  - Add a race option, on by default: "בטבלה: שלושת המקומות הראשונים והמקום שלך".
  - Race answers still go to "הטעויות שלי", but count at half weight (or not at all) in weak points.
  - Add "(בקבוצה קטנה אפשר לנחש מהמספרים)" to the privacy line.
- **Test:** quiz e2e: Noa's page shows the top three and her own place only.

### UX-25 · minor · The 80% reserve shields summaries from only two features

- **What happens.** The `reserve` stop at 0.8 × the cap applies only to "לשאול" and memory aids (§2.4 L257-L258). Practice rounds, decks, exams and recording notes spend up to 100% (L251-L256).
- **Why it matters.** A busy week can block the next lecture's summary, which is decision 10's promise. The error tells members to raise the cap in Vercel (§6.3 L8954), which only Yoad can do.
- **Fix:**
  - Apply `share: 0.8` to every optional generation (practice, cards, exam, notes), keeping the last 20% for summaries.
  - Say so in the cost lines and in the help row (L8931).
  - Optionally show an approximate "≈ ₪" amount beside the "$": the group thinks in ₪20 a person.
- **Test:** `budget.test.ts`.

### UX-26 · minor · Corrections are invisible unless someone opens that paragraph

- **What happens.** A correction changes the summary for everyone at once (D6). Others see it only as a chip on that paragraph, and as a 2-second flash if they happen to be looking (design-collab L103, L164). "יחד" has no list of corrections (§5.1 L8563).
- **Why it matters.** A wrong correction made at night spreads silently to five people studying from it.
- **Fix:**
  - Add a "תיקונים אחרונים" card in "יחד": the last 7 days, each with the paragraph's quote, a name and "לראות".
  - Add a library chip: "2 תיקונים חדשים".
- **Test:** collab e2e: Noa corrects a paragraph, and Shoham's "יחד" lists it live.

### UX-27 · minor · No test checks the experience with the people who will use it

- **Automated checks only.** UX acceptance is screenshots, overflow at 360 px and an LLM copy judge (§8.3 L10455; §8.4 L10492).
- **Device checks are technical** (§8.6 L10513-L10523):
  - nothing is done one-handed;
  - no Home Screen pass covers practice, the quiz or cards;
  - card swipes were never run on devices (design-cards L30).

  Swipes start anywhere on the card, so they may compete with the system's edge-swipe back gestures. That is unverified here.
- **Fix:**
  - **A task check each release.** Spend 10 minutes with Shoham on her own iPhone Home Screen app, in the existing group: practise 5 questions, join a quiz from the banner, review 10 cards, correct one paragraph. Note taps and stumbles.
  - **A native-speaker read** of that release's §6 strings by Yoad.
  - **Swipe guard and device checks.** Ignore card drags that start within 24 px of either edge, and add swipe and Home Screen checks to §8.6.

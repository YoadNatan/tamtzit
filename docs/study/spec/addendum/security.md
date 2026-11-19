# Security and privacy critique of the three addenda (meeting, fun, server)

*Adversarial review, lens: privacy and security. The SQL of the three designs was loaded together on top of the full spec schema and attacked as an anonymous visitor, as a signed-in stranger with a group of her own, and as a member of the group trying to learn who got what wrong. Every finding below was reproduced on a throwaway local Postgres 16.15 database; the SQL that ran and its output are quoted and kept under `critique/sec/`. Nothing touched the repo, the live site or the real Supabase project; no group was created anywhere real; no Claude call was made; every database was dropped.*

**Re-run:** `critique/sec/run.sh` (load, sweeps, fixtures, 14 probes; prints one line per probe and drops its databases). Outputs: `critique/sec/out/*.txt`. Probes: `critique/sec/probes/*.sql`.

**The schema attacked** is the composition of `server/run.sh` step 7: the repo's `study-schema.sql`, every spec section (as the meeting and server addenda edit them, built again into `critique/sec/build/` by their own `edits/apply.py`), the meeting addendum's ends and sections M N V T, the fun addendum's patched A and Z (its `build/with-meeting/`, read-only) and sections U J H, and the server addendum's ends and sections B G E. Loaded twice: 0 errors; registry `A=1 B=1 C=2 E=1 F=1 G=1 H=1 J=1 K=2 M=1 N=1 P=2 Q=2 T=1 U=1 V=1 W=1 Z=2`.

**Fixtures** (`probes/00-fixtures.sql`): group G "קבוצה" with six members (שוהם, נועה, מאיה, איתי, דניאל, רוני; ids `11111111-…-1…6`), one lecture L1 with three written parts, eight keyed questions on paragraphs (key = option 0), two cards, the worker key in the Vault stand-in, and a stranger (`99999999-…`) who signed in anonymously and created a group of her own, as anyone with the URL can.

---

## Summary

| # | Severity | Package (addendum) | Finding |
|---|---|---|---|
| SEC-1 | **blocker** | K's end (meeting) | The one-tap undo applies any text, with no source and no approval, once a paragraph has had one correction |
| SEC-2 | **blocker** | Q's end (server) | One flag by the caller herself opens the fix sheet, which returns the key, also while a live quiz holds it |
| SEC-3 | major | K's end + M (meeting) | "Approval aloud" needs only a self-made meeting: one member changes the summary alone, recorded as agreed aloud |
| SEC-4 | major | M (meeting) | Any member becomes "the reader" with one call: reads the reader-only counts, locks the reader out, releases every pre-guess |
| SEC-5 | major | M, Z's end (meeting) | "3 לקפה" orders by the players' private right answers: with two players it shows the other player's mistakes (20 of 20) |
| SEC-6 | major | Z's end (meeting; from the spec) | Reveal counts below 3 answers, a solo quiz's score under the host's name, and an immediate trap card, all through the API |
| SEC-7 | major | E + Q's end (server) | A member's trap is unmasked by any member answering it in practice with `p_mode 'quiz'` |
| SEC-8 | major | U (fun) | "From 3 people" counts member ids: an opt-out between two nights, or a second device, reveals what one or two others did |
| SEC-9 | major | K's end (server) | Any member labels her own text as "Claude's attempt" (`ask_attempt`) with no Claude call |
| SEC-10 | minor | V (meeting) | Backing counts "from 3": one's own back and un-back reveals how the other two backed; past 3, each back is attributable |
| SEC-11 | minor | M (meeting) | One's own "לא ברור" tap lifts a paragraph over 3; the tap's quote is free text that reaches the reader and everyone's catch-up |
| SEC-12 | minor | M (meeting) | The catch-up's "קראו" mark is a published `study_reads` row with its time ("בלי שעה" is not true) |
| SEC-13 | minor | Q's end (server) | One member, with one flag of a kind that "never counts", retires a question for everyone |
| SEC-14 | minor | J (fun) + repo storage | Any member deletes any wall photo (any group file); a post may reuse another member's upload; the bucket has no size or type limit |
| SEC-15 | minor | V, U (meeting, fun) | VAR (and the plaque) have no single-flight hold: two taps pay twice, refused only at the save |

**What held** (also reproduced, `out/01-03`, `out/20-stranger.txt`, `out/21-anon.txt`):

- **Anonymous visitor.** `anon` may execute only the allow-list (the spec's plus section B's five worker functions), and each of those five answers `forbidden` without the exact key (no key, a wrong last character, an empty key). Every new table answers `permission denied` to `anon`. `study_private` has no usage grant for `anon` or `authenticated`.
- **Definer functions.** No `security definer` function in `public` or `study_private` lacks `set search_path`; none sets a path other than `public`.
- **Cross-group stranger.** All 126 addendum functions a member may call were called by the stranger with the ids of G's live objects (a meeting with a tap, an ended quiz, an anonymous wall entry, a yellow card, a slide flag, a plan, a question with Maya's answer): 106 refused; the 20 that returned gave only the stranger's own (empty) rows, `null`, or, for `study_meeting_group` and `study_dispute_group`, G's group id for a known uuid (the spec's `study_lecture_group` does the same, even to `anon`; the ids are random).
- **Server-only paths.** Every function that writes Claude's output (`study_save_question`/`_card` worker path, `study_dispute_verdict`, `study_aid_drafts_save`, `study_aid_check_begin`/`_done`, `study_trap_plaque`, `study_trap_checked`, `study_edit_proposal_checked`, the bank's five) refuses without the key, and the member-and-key ones also check the caller's membership.
- **Tables.** Every new table has RLS on; private ones (taps, presence, guesses, catch-ups, backs, updates, votes, pins, authors, credits, loot, drafts, private cards, adoptions, opt-outs) are owner-only and unpublished; `study_meeting_live` and `study_traps` have no grant at all. Every newly published table (`study_meetings`, `study_edit_proposals`, `study_disputes`, `study_slide_flags`, `study_aids`, `study_group_plans`) has its own uuid key (a DELETE event carries nothing else) and a member-only read policy.
- **The wall's anonymity inside the database.** `study_aids` has no author column; `credit_id` is set only after the credited member's yes; credit requests show "בלי שם" for an anonymous entry; no function tells a member who wrote someone else's entry.
- **The pulse's night.** Counts stop at the study day's start whenever they run; trap cards are made only when the trap opens the next study day; the museum's states are nightly; the switch `pulse` hides every row while off.

The addenda's own checks pass because they test the refusal of a non-actor (M3d "the counts are on the reader's screen only", QS4c "only a hidden or flagged question", KA9 a genuine undo, ES5 an owner-inserted `'quiz'` answer), not role takeover, forged inputs or differencing. Each finding below names the check to add.

---

## SEC-1 · blocker · the undo path applies any text without approval

**Where.** `meeting/sql/75-collab-end.sql`: `study_edit_block` (L143-156) calls `study_private.edit_apply(…, p_undo_of, …)`; the undo check (L112-117) only asks that `p_undo_of` names *an* edit of that lecture, part, generation and paragraph. `p_before`/`p_after` come from the caller.

**Problem.** Decision 5 (a correction needs a source and a second approval; undo is one tap) is the reason K-2 replaces the spec's immediate edit. But the undo is not tied to the undone edit's text: after any correction has been applied to a paragraph, any member can write anything there, at once, labelled `undo`, with no source and no approver, as often as she likes (every later edit of that paragraph serves as `p_undo_of`). The spread (V) then treats it as an undo and clears the marks of the correction it "undid", so the paragraph's questions return to practice and quizzes beside a text that now says the opposite.

**Reproduced** (`probes/22-undo-any-text.sql`):
```sql
-- Noa proposes "…בודקים רמת G6PD", Shoham approves → edit e1. Then Daniel, alone:
select public.study_edit_block(L1, 0, 3, 'לפני Primaquine בודקים רמת G6PD. [ש'' 7]',
       'Primaquine בטוחה גם בלי בדיקה. [ש'' 7]', <rev>, 0, 1, '', e1);
```
```
after the approved correction, q3 (on this paragraph) is marked: true
NOTICE:  a plain edit without approval: refused (needs approval)
undo with any text: {"gen": 0, "rev": 2, "merged": false, "edit_id": "d85589dd-…"}
after the forged undo, q3 is marked: false (the spread took it for an undo and cleared the mark)
second "undo": {"gen": 0, "rev": 3, …}
Maya reads part 0, paragraph 3: Primaquine ניתנת לכולם, גם בהיריון. [ש' 7]
history: נועה paragraph source slide approver שוהם -> "…רמת G6PD…" | דניאל paragraph source undo approver - -> "Primaquine בטוחה גם בלי בדיקה." | דניאל paragraph source undo approver - -> "Primaquine ניתנת לכולם, גם בהיריון."
```

**Fix (K-2, before it merges).** Replace the text-taking undo with `study_undo_edit(p_edit uuid)`: it reads the edit row, requires that it is the paragraph's latest applied edit, not itself undone, same `gen`, and that the paragraph's current block equals that edit's `after_text`; it then applies `after_text → before_text` itself. Keep `study_edit_block`'s signature only if F's client needs it, raising `needs approval` whenever `p_after` differs from the undone edit's `before_text` (or `p_before` from its `after_text`). Check KA-undo-forge: an "undo" with any other text → `bad undo`; an undo of a non-latest edit → `bad undo`.

---

## SEC-2 · blocker · the fix sheet is a key oracle, also during a live quiz

**Where.** `server/sql/46-questions-end.sql` L400-418, `study_question_for_fix`: returns `k.answer`, every explanation and "מתי כן" when the question is hidden **or has any flag** (any reason, any member, the caller included); it does not look at `study_question_keys.held_until`. Members may insert flags (`grant insert (question_id, reason, note)`) and delete their own.

**Problem.** Spec §2.9: "Answer keys and explanations before an answer or a reveal: nobody through the API". `study_answer_question` honours the live quiz's hold (`in quiz`); the fix sheet does not. A player flags the open round's question with reason `other` (which "never counts" toward hiding), reads the key, answers it "על בטוח" (+3 in a race), and deletes the flag. The same works in practice for any question.

**Reproduced** (`probes/14-key-oracle-unmask.sql`, part A):
```
Noa sees the round: שאלה 6?, state question, key in the state: none
NOTICE:  practice answer during the round: refused (in quiz)
NOTICE:  fix sheet before any flag: refused (not flagged)
after her own "other" flag, study_question_for_fix returns: answer 0, hidden false
she answers with that index and "על בטוח": {"ms": 1009, "bet": 3, "idx": 0, "vote": 1, "choice": 0, …}
her flag is gone again: flags left 0
the key is still held by the quiz until 14:04:35 (now 13:54:02)
```

**Fix (Q-1's server lines).** `study_question_for_fix` and `study_question_fix`: require `hidden_at is not null` (two different members' counting flags, the design's own rule), and refuse while `held_until > now()` (`in quiz`). Optionally, open it only to members who already answered the question, so a key is never the first thing a member sees of it (residual risk: two colluding identities can still hide a question and read its key). Check QS4d: a member's own `other` flag → `not flagged`; a held key → `in quiz`.

---

## SEC-3 · major · approval aloud by a self-made meeting

**Where.** `meeting/sql/75-collab-end.sql` L237-244 (`study_approve_edit`, `p_aloud`): accepts when *any* meeting row on the lecture has `reader_id = caller and reading` (not today's, not live, no one else present), including the caller's own proposal (choice 5). `meeting/sql/90-meeting.sql` L241-290 (`study_meeting_reading`): any member, at any hour, becomes the reader, and the call creates today's meeting when none exists.

**Problem.** One member proposes, makes herself "the reader" of a meeting nobody attended, approves her own proposal "aloud", and stops reading. The summary changes for everyone; the history and the log read "אישור: בקול בפגישה". Decision 5's second person is gone, with no prior edit needed (unlike SEC-1).

**Reproduced** (`probes/18-aloud-self-approval.sql`):
```
meetings today before: 0
NOTICE:  own approval, not aloud: refused (own proposal)
Daniel becomes "the reader": true
approve aloud: {"gen": 0, "rev": 1, "merged": false, "edit_id": "70af6fcc-…", "proposal_id": "39406dff-…"}
Shoham reads part 0: … לפני Primaquine לא צריך לבדוק כלום. [ש' 7]
the history row: proposed by דניאל, approved by דניאל, aloud true
the "meeting" it was approved in: started 15:54, reader דניאל, created by דניאל
```

**Fix (K-2 and M-1).** Aloud only when the meeting is today's, `reading`, its place reported within the last minute (`study_meeting_live.place_at`), and at least two *other* members have presence rows in it within the last 10 minutes; and never the reader's own proposal (drop choice 5's exception: the table's agreement is shown by another member's tap, which costs one second at the table). Check KA-aloud-alone: a reader with no followers → `not live`; her own proposal → `own proposal`.

---

## SEC-4 · major · anyone becomes "the reader"

**Where.** `meeting/sql/90-meeting.sql`: `study_meeting_reading` L241-290 sets `reader_id = caller` unconditionally; `study_meeting_reader_view` L389-425 and `study_meeting_place` L296-334 trust `reader_id`. `place` moves `max_part/max_anchor` to whatever is sent and releases every guess whose paragraph is behind it.

**Problem.** Design §2.3, the approved exception to the nightly rule: the live "לא ברור" counts and the guess warning are shown "only on the reader's screen"; "no follower can watch others tap". Any follower takes over with one call, reads the counts, and hands back; the real reader's card closes ("ההקראה עברה לטלפון אחר."). One `place` call to the lecture's end releases both pre-guesses' keys to every phone before the reading reaches them (M3).

**Reproduced** (`probes/10-reader-takeover.sql`, steps 1, 2, 4, 5, 7):
```
NOTICE:  refused: not the reader                                  -- Noa, a follower
reading -> true                                                    -- one call
Noa, now "the reader": {"taps": [{"n": 3, "part": 0, "quote": "…", "anchor": 2}], "guess_warn": null}
meeting row: reader נועה, reading false
NOTICE:  Shoham (the real reader) is now refused: not the reader
Maya before: released 0, key shown: no
Noa takes over and reports the place "end of the lecture": released -> 2
Maya after: key shown: 0, her result: false (released by one call, with nothing read)
```

**Fix (M-1, M-2).** `study_meeting_reading(on)`: while the meeting is `reading` and its place was reported in the last 60 s by another member, refuse with a new code `reading` (Hebrew: "ההקראה פעילה בטלפון אחר. אפשר לעקוב אחריה."); a deliberate hand-over is the current reader's "off" (or 60 s of silence). `reader_view`: only today's meeting and only with a place in the last 30 s. `place`: clamp to `[part_from, part_to]`, advance `max_*` by at most one part per call, release a guess only when the place is at its paragraph. Checks M3e (take-over refused while live), M3f (`place` beyond the plan is clamped, no guess released).

---

## SEC-5 · major · the opening's picker shows a co-player's private mistakes

**Where.** `meeting/sql/90-meeting.sql` L462-520, `study_quiz__pick_preset`: `known` = how many of *this quiz's players* answered each candidate right (their private `study_answers`), live, no threshold; the picker takes the lowest `known` per part, then overall. The same shape, with "answered at all", is section Z's `study_quiz__pick` (`seen`, `meeting/sql/55-quiz-end.sql` L157, kept from the spec).

**Problem.** The meeting design's own §2.3 puts "quiz picks from private answers" with the nightly counts from 3. With the host and one other player, the questions "3 לקפה" asks first are exactly the other player's wrong practice answers, under her name in the lobby. A co-op quiz of two asks exactly the questions the other never answered.

**Reproduced** (`probes/11-opening-picker.sql`): Maya answered q1-q8 in practice; Noa, the host, none.
```
== A. … wrong only on q3 and q6
round 1 on Noa's screen: שאלה 3?
the opening's three, in order: שאלה 3? · שאלה 6? · שאלה 5?        (the third is drawn at random among the rest)
== B. … wrong only on q1 and q5
the opening's three, in order: שאלה 1? · שאלה 5? · שאלה 4?
NOTICE:  first two = Maya's two mistakes in 20 of 20 openings (chance alone: 1 in 28 for 2 of 8)
== D. … Maya never answered q2, q5, q8; the quiz asks: שאלה 2? · שאלה 5? · שאלה 8?
```

**Fix (M-1; Z).** The opening orders by the group's nightly signal (`study_pulse_questions`: `missed`, `split`; U's hook already exists as `study_quiz__signal`), else teaser first, then random; no per-player correctness. In `study_quiz__pick`, use `seen` only when the quiz has at least 3 players, else random. Check M-pick: two players, the opening is independent of the second player's answers (the 20-run test above, expecting about chance).

---

## SEC-6 · major · small-quiz counts, a solo score under a name, an immediate trap card

**Where.** `meeting/sql/55-quiz-end.sql`: `study_quiz_state` returns `counts`, `answered`, `right`, `dont_know` at every final reveal (L783) to **any member** (not only players), and per round in the players' end summary (L831), whatever the number of answers; `study_quiz_recent` (L888-910) returns each ended quiz's `right_pct` to every member, whatever `players_n`; `study_quiz__score` makes the round's trap card at the reveal (L279-281) from 2 wrong answers of 3. Carried over from the spec's section Z (its §2.9 says "counts only when three or more answered"; only the client hides them), now rewritten by Z's end; H's boss rounds that "count for nothing" (< 3) still return their counts.

**Problem.** In a co-op quiz of two, each player (and any member watching) sees the other's choice and whether it was right; a member who plays alone publishes her score, and the published quiz row names her as host; the trap card reaches every deck within a second of the reveal while the players list is one call away, against the museum's "מוצג נפתח רק למחרת, כדי שאי אפשר יהיה לנחש מי".

**Reproduced** (`probes/13-quiz-small-counts.sql`):
```
Noa's study_quiz_state at the reveal: answered 2, right 1, counts [1, 0, 0, 1, 0], players נועה, מאיה
Daniel (not playing) calls the same: answered 2, counts [1, 0, 0, 1, 0], players נועה, מאיה
Itai: study_quiz_recent -> מלריה · players 1 · right 33%
Itai: the quiz row (published) names its host: מאיה, created_by מאיה
Daniel, at the reveal (seconds later), reads study_cards: [trap] שאלה 1? / למה לא ב? (made 0 s ago)
Daniel: study_quiz_state players = נועה, מאיה, איתי; counts [0, 2, 1, 0, 0]
```

**Fix (Z's end).** In the database, not the screen: `counts`, `right`, `dont_know` (round and summary) only when the vote had at least 3 answers, else only `answered`; the round's details only to players; `study_quiz_recent.right_pct` only when `players_n >= 3` (one's own `my_correct` stays); the round's trap goes through U's `trap_add(…, open_now => false)` (or, without U, a card created at the next study day's start), and only from 3 players choosing it. Checks ZA-small (two players: no counts), ZA-solo (`right_pct` null), ZA-trap-delay.

---

## SEC-7 · major · a member's trap is unmasked from practice

**Where.** `server/sql/96-extras.sql` L157-172, trigger `study_answers_unmask`: any `study_answers` row with `mode = 'quiz'` sets the question's `author_id` and `unmasked_at`. `server/sql/46-questions-end.sql` L311 (as the spec's Q, L406): `study_answer_question` accepts `p_mode 'quiz'` from any member.

**Problem.** P11: the author "shows once a live quiz revealed her trap". Any member answers the trap in practice with `p_mode 'quiz'` and the published row names the author for everyone.

**Reproduced** (`probes/14-key-oracle-unmask.sql`, part C):
```
Itai sees the member question: source member, author (hidden), created_by null
Itai answers it from practice with p_mode 'quiz' (no quiz exists): correct false
Maya now reads the published row: author רוני, unmasked_at set true
```

**Fix (E; Q-1).** Unmask inside Z's reveal (`study_quiz__score`, where the first votes are copied), not by a trigger on a column members can set; and `study_answer_question` refuses `p_mode 'quiz'` (the live quiz never calls it; Z copies first votes itself), which also stops members writing their own "quiz" returns for T. Check ES5b: a member's `p_mode 'quiz'` → `bad mode`, author still hidden.

---

## SEC-8 · major · the pulse's "3 people" are member ids, and the opt-out is a differencing switch

**Where.** `fun/sql/U-pulse.sql`: `study_private.pulse_counted` (L170-176) counts `study_members.user_id`s; thresholds on distinct ids (`people >= 3` L418, `sure_people >= 3` L532, `having count(distinct …) >= 3`); the opt-out drops a member's past signals from the next night, while she keeps reading the pulse.

**Problem.** (A) A member who contributed to a row opts out between two nights: if the row vanishes, exactly two others stood behind it, and for `sure` both answered it wrong "על בטוח". (B) The spec lets one person hold two member ids ("שוהם מחשב", spec §2.5, before sign-in; nothing stops keeping one after): her two devices plus one other member make "3", so a `sure` signal, a museum exhibit and a trap card in every deck reveal one other member's confident error. The fun design's §2.2 says an aggregate of three "can sometimes be narrowed down"; these two make it exact.

**Reproduced** (`probes/17-pulse-threshold.sql`):
```
== A. Noa, Maya and Itai answered q1 wrong "על בטוח" (option 2). Night 1:
Noa reads study_pulse_questions: שאלה 1? -> sure
night 2, after Noa's opt-out: nothing  => exactly two others answered q1, and both were wrong "על בטוח"
== B. Noa's second device joins as its own member ("נועה מחשב")
Noa reads q7's signal: sure
the museum the next study day: exhibit 2: שאלה 7? · the trap ׳ב׳ · truth א | …
trap cards in every deck: שאלה 1? | שאלה 7?
behind it (owner's view): נועה 1 על בטוח, מאיה 1 על בטוח, נועה מחשב 1 על בטוח
```

**Fix (U-1/U-2; it ships in release 8, after accounts).** Count only saved accounts (`auth.users.is_anonymous = false`, one per email) and only members who joined at least 7 days before the cut-off; raise the bar for the museum and `sure` to 4 accounts in a group of six. Make reading reciprocal: an opted-out member does not see the pulse, the spots, the museum or "דרושות" (RLS: no opt-out row for `auth.uid()`), so she cannot compare the nights with and without her own data; the setting's line says so ("מי שיוצאים מהספירה לא רואים את הדופק."). Checks U-recip (an opted-out member reads no pulse row), U-anon (a row needs 3 saved accounts).

---

## SEC-9 · major · "Claude's attempt" is the member's own text

**Where.** `server/sql/76-collab-end.sql` L37-61, `study_ask_to_group(…, p_attempt)`: inserts `p_attempt` from the phone as a reply with `ask_attempt = true`.

**Problem.** Choice 16 says "nobody can label their own words as Claude's"; the column has no member grant, but the function that sets it is the member's and takes the text from her. Spec F3: Claude's output is written only with the server key. Any member posts anything under "מצורף: הניסיון של Claude לענות", with no "לשאול" call behind it; K5 later feeds answered threads into ask's context.

**Reproduced** (`probes/16-attempt-forgery.sql`):
```
Itai reads the thread: [נועה] צריך לבדוק משהו לפני Primaquine? | [מצורף: הניסיון של Claude לענות] לא צריך לבדוק כלום לפני Primaquine, אפשר לתת לכל אחד. [ש' 7]
the ledger has no "ask" call behind it: 0 rows
```

**Fix (K-2's server lines).** The `ask` op saves its own answer with the key (`study_ask_answers`: id, user, lecture, text, created; owner-only), and `study_ask_to_group(…, p_answer uuid)` copies that row's text, only the caller's own and of the last day. Check KS1b: free text → refused; another member's answer id → `not yours`.

---

## SEC-10 · minor · backing "from 3" is differencing-friendly

**Where.** `meeting/sql/92-var.sql` L209-265: `study_dispute_back` (back, switch, take back, any time), `study_dispute_state` returns `{a, b}` when `na + nb >= 3` counting the caller; `study_disputes.backs_n` and `version` are published and change on every back.

**Reproduced** (`probes/15-var-backing.sql`):
```
Roni, before backing: backs hidden, backers 2
Roni backs a: backs {"a": 2, "b": 1}  => the other two: a 1, b 1
Roni takes it back: backs hidden
Roni sees the published study_disputes row change: backs_n 4, version 7 -> 8
and the counts move from {"a": 2, "b": 1} to {"a": 2, "b": 2}: whoever just backed chose b
```

**Fix (V).** Count the threshold without the caller's own back (`na + nb - mine >= 3`), show the split only when backing closes (VAR asked, or the card decided), and stop publishing `backs_n` (the total comes with the state).

---

## SEC-11 · minor · one's own tap crosses the threshold; the quote is free text

**Where.** `meeting/sql/90-meeting.sql` L357-383 (`study_meeting_unclear` stores `p_quote` from the phone), L404-412 (`count(distinct user_id) >= 3` includes whoever reads the view; `max(x.quote)` picks the lexicographically largest).

**Problem.** The reader (or a takeover, SEC-4) adds her own tap to see whether two others tapped. Any tapper's text becomes the callout's quote ("ש…" beats "ה…") and, once the reader stops there, `study_meeting_events.quote` in every member's catch-up ("התעכבנו על"), anonymously.

**Reproduced** (`probes/10-reader-takeover.sql`, steps 3 and 6):
```
with her own tap: {"taps": [{"n": 3, …, "quote": "שוהם מקריאה כמו רובוט, תעצרי כבר", …}]}
after taking it back: {"taps": [], "guess_warn": null}
Roni's catch-up "התעכבנו על": [{"part": 0, "quote": "שוהם מקריאה כמו רובוט, תעצרי כבר", "anchor": 2}]
```

**Fix (M-1).** The reader cannot tap (`study_meeting_unclear` refuses `reader_id = caller`), and the threshold excludes the caller; the quote is taken from the paragraph itself (the block at `part/anchor` of the part's markdown, first 80 characters), never from the phone, in taps and in `study_meeting_stop`.

---

## SEC-12 · minor · the catch-up's read mark carries a time

**Where.** `meeting/sql/90-meeting.sql` L928: `study_meeting_catchup_done` inserts into `study_reads` with the default `read_at = now()`; `study_reads` is published and every member reads `read_at` (the app's own `groupReadMarks` selects it); the catch-up's `readers` are ordered by it (L901).

**Problem.** "Attendance is private" and "בסוף ההשלמה מצטרפים לרשימה, בלי שעה ובלי ׳באיחור׳": the mark arrives, live and with its time, hours after the meeting.

**Reproduced** (`probes/12-catchup-readmark.sql`):
```
Noa selects study_reads (as LectureView does): רוני read_at 15:54 (meeting started 10:54)
study_reads is in the Realtime publication: true
```

**Fix (M-2).** Write the catch-up's mark at the next study day's start (the nightly job, or the first read of the day) with `read_at` = the meeting's `starts_at`, and order the catch-up's readers by name.

---

## SEC-13 · minor · one member retires a question for everyone

**Where.** `server/sql/46-questions-end.sql` L367-394, `study_question_fix`: `'retire'` needs only that the question has any flag (L377), the caller's own included, of any reason.

**Reproduced** (`probes/14-key-oracle-unmask.sql`, part B):
```
q5 after Daniel alone: retired true by דניאל, hidden false     -- after one 'duplicate' flag of his own
```

**Fix (Q-1's server lines).** `retire` (and `keep`) only for a hidden question (two members' counting flags), as choice 9 says. Check QS-retire-one.

---

## SEC-14 · minor · wall photos: anyone deletes, anyone reuses, no limits

**Where.** `fun/sql/J-wall.sql` L219-224 (`study_aid_post` accepts any existing object under `<group>/wall/`); the repo's storage policies (`supabase/study-schema.sql` L364-372: any member may read, add and **delete** any object of the group's folder); the bucket is created with no `file_size_limit` or `allowed_mime_types` (L360-362), and the design's 600 kB is the phone's resize only.

**Reproduced** (`probes/19-wall-photos.sql`, on the local stand-in of `storage.objects` with the repo's policies):
```
Noa's post with Maya's photo: true
Itai deleted: aaaaaaaa-…/wall/0f0f0f0f-0000-4000-8000-000000000001.jpg
NOTICE:  study_aid_delete by Itai (the database side is author-only): aid not found
wall: meme photo … exists false | sketch photo … exists false
Itai deleted: aaaaaaaa-…/22222222-…/fig-5-1.jpg
the bucket as the repo creates it: {"id":"study","name":"study","public":false}
```

**Fix (J-1; F for the bucket and policies).** A policy for `<group>/wall/` that lets only the uploader delete (Supabase records the uploader in `storage.objects.owner_id`; the stand-in has no such column, so this was not run here), and `study_aid_post` requires `owner_id = auth.uid()::text` for the photo it attaches. Set the bucket's `file_size_limit` (5 MB) and `allowed_mime_types` (`image/jpeg`, `image/webp`, `image/png`, and what the slides need) in §9.1's setup step.

---

## SEC-15 · minor · VAR and the plaque pay twice

**Where.** `meeting/sql/92-var.sql` L270-285: `study_dispute_verdict` refuses a second verdict (`not ready`) only at the save; nothing holds the dispute while a call runs. The plaque (`fun` §4.4) has the same shape. J's `wall_check` does it right (`check_state 'checking'` for 2 minutes).

**Reproduced** (`probes/23-var-single-flight.sql`, the op's steps for two phones):
```
Itai reads: state open, side b true / Itai reserves: id true
Noa reads: state open, side b true / Noa reserves: id true
NOTICE:  second verdict refused: not ready (its call was already reserved and made)
ledger rows of kind var for this dispute: 2, reserved $0.26000
```

**Fix (V; U-3).** `study_dispute_judge_begin(dispute, key)` sets `judging_until = now() + 3 min` atomically before the op reserves (409 `busy`, area dispute, in the words of the wall's line: "נבדק עכשיו במכשיר אחר…"); the same for a trap's plaque.

---

## Notes that the SQL cannot show (design text only, not counted above)

- **K5 sends members' names to Anthropic.** The server design's ask context adds answered threads as `Q: … / A ({name}): …` on every "לשאול" call; VAR deliberately strips names. Recommend the same here (`A: …`), or a privacy line saying it.
- **Race points disclose the bet.** Decision 2 scores by the bet and shows `last_points` per player to the race's players: +3 / −6 is "על בטוח" right / wrong, by name. Approved; the privacy note should say the points show the bet.
- **Bank reservations hold the budget for up to a day** (≈ $2.15 a lecture, server §4.7): a burst of uploads can block every optional feature for everyone until the batches end.
- **Live totals** (wall votes, a quiz's `answered_n`, a dispute's `backs_n`) arrive per event; with presence, timing narrows who. The fun design says so for the wall's authors; the others do not.

## Where each fix goes (the build order)

| Package (milestone) | Fixes |
|---|---|
| Q-1 (server lines of Q's end) | SEC-2, SEC-13, the `'quiz'` mode refusal of SEC-7 |
| Z (Z's end) | SEC-6, the `seen` part of SEC-5 |
| K-2 (K's ends) | SEC-1, SEC-3 (approval side), SEC-9 |
| M-1 / M-2 | SEC-3 (meeting side), SEC-4, SEC-5, SEC-11 / SEC-12 |
| V | SEC-10, SEC-15 |
| U-1, U-2, U-3 | SEC-8, the plaque of SEC-15 |
| J-1 (and F's bucket step) | SEC-14 |
| E | SEC-7 (unmask at the reveal) |

New error copy (gender-neutral, F's `failText.ts`): `reading` (meeting) "ההקראה פעילה בטלפון אחר. אפשר לעקוב אחריה."; `busy` (dispute) "נבדק עכשיו במכשיר אחר…"; the pulse setting's added line "מי שיוצאים מהספירה לא רואים את הדופק.". Everything else reuses existing codes (`not live`, `own proposal`, `bad undo`, `in quiz`, `not flagged`, `bad mode`).

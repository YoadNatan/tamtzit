# The day's meeting (package M)

The group's day together: planning the next meeting, its band on "יחד",
reading aloud with "לא ברור לי" and the reader's card, the opening "3 לקפה",
the agenda, the closing quiz, the one-question stop at a part's end, and in
M-2 the pre-guess and catch-up. The build spec is the addendum's §12.4.M
(`spec/addendum/addendum.md`, the meeting design's §4); the approved screens
are `proposal/mockups/meeting.html` (s1 the opening, s2 the follower, s3 the
reader) and `today.html` (s1 the band, s2 catch-up). Two flags:
`VITE_STUDY_MEETING` (M-1, needs the group quiz) and `VITE_STUDY_GUESS`
(M-2), both against section M of the SQL at version 1.

**Yoad's decisions of 17 Nov 2026 change two things here.** Decision 1 (no
email accounts: a member is the device they joined from): M-2 no longer
waits for the account or for Today. `VITE_STUDY_GUESS` needs only the
meeting, `?v=catchup` is M-2's, and catch-up is entered from the meeting's
card on "יחד" ("פגישה שפספסת"), with Today's entry still T's when Today is
built. The tap's toast promises "הפסקה תחזור אליך מחר." whenever something
brings it back (the paragraph's chip with `VITE_STUDY_ANCHOR`, or Today);
with neither it says "הסימון נשמר רק אצלך.".

## What a member sees

- **"יחד" → "הפגישה"**: "אין פגישה מתוכננת." or the band (today.html s1):
  "הקבוצה היום · 09:00" with the slide range, the lecture and its parts,
  with M-2 "ניחוש לפני · 2 שאלות"; live, "הקראה עכשיו: שוהם"
  and "לעקוב"; "3 לקפה פתוח" or the closing quiz while open; over, "הפגישה
  של היום הסתיימה."; then "פגישה שפספסת" (M-2) and "לקבוע את הפגישה הבאה".
- **Planning** (`?v=meeting&new=1`, `&edit=1`): "מתי" (date and time,
  tomorrow at the last meeting's time by default), "מה קוראים" (a lecture
  and its parts, from one to another, the slide range under them),
  "כותרת (לא חובה)". No reader is planned ahead (the owner's request,
  section M 2): whoever taps "להקריא לקבוצה" reads. Any member saves or
  changes it; a newer version wins ("conflict"); "לבטל את הפגישה" before it
  starts.
- **The meeting** (`?v=meeting&m=`, meeting.html s1): before the reading,
  "3 לקפה · בפרקים הקודמים" ("5 דק׳ · עונים לבד, בלי לפתוח את הסיכום · אפשר
  לדלג"), opened by any member who then hosts it, or "לדלג לסדר היום". The
  three questions are stacked: answered ones fold to one line with the
  slide and "רובכם צדקו" · "הקבוצה חלוקה" · "רובכם טעו" (a word from 3
  answers, never a number), the current one with its options and the bet,
  the head's chip "2/3". With M-2, "ניחוש על היום · 1 מתוך 2" with "יידלק
  בהקראה" ("לנחש", then "ניחשת …" and "לשנות"). "סדר היום": "היום: … ש׳ 1-5"
  (with "הקראה: שוהם" once someone read aloud), the pulse's hot spot when section U exists, and "שאלה
  פתוחה: …" (one sent "לשאלה פתוחה למחר" at an earlier meeting first, else
  one open more than a day). The bottom bar: "לפתוח 3 לקפה", then
  "להתחיל להקריא" or "לעקוב אחרי ההקראה", and once someone read aloud,
  "מבחן קבוצתי על מה שנקרא · 5 שאלות" (the closing, Z's preset `end` on the
  parts read). At most two rituals a study day (decision 7).
- **The follower** (meeting.html s2): "לא ברור לי" first in the follower's
  bar (44 px), marking the paragraph being read, without a name or any text;
  the toast's "ביטול" takes it back. With M-2, when the reading reaches a
  guess's paragraph: "דינג! התשובה לניחוש 1", the explanation with its
  slide, and her own line ("ניחשת …, כמו רוב הקבוצה") with "רק לך".
- **The reader** (meeting.html s3), above the reader's bar: "ההקראה שלך
  משותפת" with "{n} עוקבים"; from 3 other members' taps on a paragraph, "3
  ׳לא ברור׳ · בלי שמות" with its slide and first words, and "לעצור ולהסביר"
  · "להמשיך" · "לשאלה פתוחה למחר" (a question on the paragraph, prefilled
  "לא ברור בהקראה: "); at a part's last paragraph "עצירה: שאלה אחת על החלק"
  (Z's preset `stop`); with M-2 and the switch `pulse`, "בפסקה הבאה: ניחוש 2
  · כדאי להאט · רוב הקבוצה ניחשה לא נכון". K-2's "הצעת תיקון · {שם}" with
  "אישור בקול" for another member's pending proposal on the paragraph being
  read, only while two others follow (decision 5).
- **Catch-up** (`?v=catchup&m=`, M-2, today.html s2): "השלמה · …",
  "בפרק הקודם של תמצית… · {n} דק׳ · רק לך"; "התעכבנו על" (each stop),
  "שאלה שנפתרה" (answered in the meeting's hours), "אסוציאציה שננעצה" (the
  wall's moment, when section J exists), "בדיקה קצרה: 5 שאלות שהקבוצה
  התקשתה בהן. לבד, בלי שעון.", "להתחיל השלמה"; the end: "ההשלמה הושלמה.
  מחר ההרצאה תסומן כנקראה, בשעת הפגישה.". Nothing kept: "בפגישה הזו לא נשמר
  דבר מעבר לקריאה. אפשר לקרוא את החלקים: ש׳ …".

## Who sees what

Meetings and what the reader did at a paragraph are the group's. A tap,
a guess, attendance and a finished catch-up are their owner's alone; the
reader's place is nobody's through the API. Only the meeting's current
reader is told where 3 or more others tapped, and how many follow, while the
reading is live; a released guess's outcome is a majority word from 3
guessers; "קראו" after a catch-up is written on the next study day at the
meeting's time. Help has the row "הפגישה היומית" and the privacy note the
line "בפגישה:" (the pre-guess and catch-up sentences with GUESS).

## How it works

- **SQL (section M)**: the addendum's text with two changes: the reader's
  card also returns `followers` (the count "אישור בקול" uses), and the guess
  warning waits for the switch `pulse` to exist and be on. It reads F, Q, Z
  and K's tables; section U's opt-out and section J's moments only when they
  exist. Its checks (M1-M14, SR4, SR5a, SR11, SR12) are in
  `supabase/tests/study.sql` on section Z's fixtures. M 2 (the owner's
  request) drops the planned reader: `study_meeting_save` still takes
  `p_reader` (an open copy of the old app sends it) and ignores it, the band
  no longer returns `planned_reader`, and the agenda names only the member
  reading aloud now or last (`reader_id`). The column `planned_reader` stays,
  unused, because an old copy still selects it.
- **Client**: `features/meeting.tsx` (the slot: lazy screens, the reading's
  session start and stop, the follower count shared with K), `lib/meeting.ts`
  (the calls, the place reporter, the words), `components/MeetingScreen.tsx`,
  `MeetingSheet.tsx`, `MeetingBand.tsx`, `ReaderCard.tsx`, `FollowBar.tsx`,
  `GuessCards.tsx`, `Catchup.tsx`, `QuizInline.tsx` (Z's `QuizInline`, now
  built on Z's engine), `styles/meeting.css`. The reader's phone reports its
  place at most once in 5 s with a trailing call, and every 20 s while still;
  a follower says "here" when following starts and every 3 minutes. The
  reader's card is split (wave 4's review, M-READER-CARD-COVERS and
  M-SHARED-LABEL-TWICE): one line in the reader's sticky bar ("N עוקבים",
  a pointer "3 ׳לא ברור׳ · ש׳ 2" that scrolls to the callout, the part's
  stop), and the callout with its three answers and the guess warning in
  the reading flow, right after the paragraph they are about
  (`ReaderBlock`, through the lecture's `part` slot), as `meeting.html` s3;
  "ההקראה שלך משותפת" stays once, in the room bar. A started meeting keeps
  its lecture, parts and day (SEC4-2): `study_meeting_save` answers
  "meeting started", and the sheet locks those fields.
- **Small edits in other packages' files**: Z's `features/quiz.tsx`
  (`QuizInline`), K's `features/collab.tsx` ("אישור בקול" only from two
  followers), F's `shared/study/flags.ts`, `lib/route.ts` (decision 1),
  `lib/helpCopy.ts` (the M-2 sentences); the e2e mock's `study_meetings`
  table, Z's and K's plugins (a meeting's presets, "3 לקפה"'s majority word,
  an aloud approval from the meeting's live reading).

## Built, and left

| Addendum item | State |
|---|---|
| M-1 planning, the band and the card on "יחד", reading and the place | built |
| M-1 "לא ברור" (never the reader's), the reader's card from 3, its three answers | built |
| M-1 the opening "3 לקפה" (5 minutes, skippable), the agenda, the closing, the part's stop | built (decision 7: at most two rituals a day) |
| M-1 the agenda's hot spot | U's: the line shows when `study_meeting_agenda` returns one (null until section U) |
| M-2 the pre-guess, its release with two followers, the reader's warning (switch `pulse`) | built (decision 1: no account) |
| M-2 catch-up, "קראו" the next study day | built; entered from "יחד" (Today's entry is T's) |
| M7 a tapped paragraph comes back | N's chip shows it; Today's row is T's (`study_my_unclear` is built) |
| K-2 "אישור בקול" | K's card, shown only with two others following; the database checks the same |
| Today's band (`MeetingBand` in Today) | the export is built; T renders it |

## Yoad's steps

1. Run the whole `supabase/study-schema.sql` once (SQL editor), from this
   branch (or the wave's merge): it adds section M (version 1) and changes
   nothing else; it is safe on production's data and on wave 3's. The
   registry then reads `M: 1`.
2. For M-1: `VITE_STUDY_MEETING=1` (with `VITE_STUDY_QUIZ`, which the meeting
   needs). For M-2: `VITE_STUDY_GUESS=1` as well. Redeploy.
3. The guess warning ("רוב הקבוצה ניחשה לא נכון") stays off until section U
   adds the switch `pulse` and it is turned on (decision 1 of the twelve).

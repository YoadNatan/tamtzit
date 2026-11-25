# Yoad's decisions of 17 November 2026

Three decisions, taken while waves 4 and 5 were being built. Where they
differ from the addendum (`spec/addendum/addendum.md`, §12), they win. This
page records each one, what it changes in the addendum, what waves 4
(`study/wave4`) and 5 (`study/wave5`) built for it, and what it means for
the six members.

## Decision 1: no email accounts

> "It's an app for friends." A member is the device they joined from.

There is no account with an email code. A member is the anonymous Supabase
identity their phone got when they joined with the group's code, as it has
been since release 1. Every screen the addendum kept for "after the account"
opens without one. The privacy rules between members stay exactly as they
are: a row that only its owner may read stays owner-only.

> **Amended 25 Nov 2026: the personal code** ([`personal-code.md`](personal-code.md),
> SQL section I, [`RELEASE-I1.md`](RELEASE-I1.md)). Yoad: "like any app, keep
> their username and stay connected". Each member can keep a private code
> (and a link carrying it); entering it on any phone or browser signs that
> device in as **the same anonymous user**, so the same name, progress,
> answers and cards come back. Still no email and no password for members,
> and `is_anonymous` stays true: the code reaches Auth's password sign-in
> only through a one-time random address and password that the server uses
> and removes within seconds. A lost code: the group's opener makes a new
> one, and the member sees who did, and when that code was used. This means
> **the opener can act as any member** (they see the code they make): an
> accepted trade for a group of six, mitigated by the notice, the last-use
> line and "ניתוק המכשירים האחרים". A member is now the anonymous user,
> on as many devices as they enter the code on, not only the first device.

### What it changes in the addendum

| Where | The addendum said | Now |
|---|---|---|
| §12.0.2, decision 12 | An account saved with an email code, in phase 2, before the private screens | Withdrawn. No account, no email code |
| §12.7.6, release 7 (`VITE_STUDY_ACCOUNT`, A1) | Accounts with an email code | Not part of the plan. The flag stays unset |
| §12.11 #1 | An email service and a domain Yoad controls, price unchecked | Closed: no email service, no domain, no cost |
| §12.7.6, the gating rule | "Lists and scores wait for the saved account; what is about the item on the screen does not" | Lifted. A screen waits only for its own package and flag |
| §12.7.6, release 8 | Today, in-app review, "הטעויות שלי", progress, the pulse, the pre-guess and catch-up wait for release 7 | They wait only for their own packages. The pre-guess and catch-up (M-2) are built in wave 4 |
| §12.7.6, promise chips | Before release 8 every chip reads its stored form ("נשמרה רק אצלך") and never promises "מחר" | A chip may promise "מחר" when something really brings the item back |
| §12.5.U, review SEC-8 (package U) | "3 people" are three saved accounts that joined a week before | Three members who joined a week before and did not opt out. One person on two phones is two members |
| §12.7.5, the pulse's bullet | "נספרים רק חשבונות שמורים שהצטרפו לפני שבוע לפחות. מי שיוצאים מהספירה לא רואים את הדופק, את המוזיאון ואת ראשי הבוס, עד הספירה הבאה שסופרת אותם." | "נספרים רק מי שהצטרפו לקבוצה לפני שבוע לפחות. אין חשבונות: כל טלפון שהצטרף הוא חבר בקבוצה, ולכן מי שהצטרפו משני טלפונים נספרים פעמיים. מי שיוצאים מהספירה לא רואים את הדופק, את המוזיאון ואת ראשי הבוס, עד הספירה הבאה שסופרת אותם." |
| §12.5.U, P-14 | "הדופק מוצג למי שנספרים בו: חשבון שמור ושבוע בקבוצה. הספירה הבאה בלילה." | "הדופק מוצג למי שנספרים בו: שבוע בקבוצה, והספירה בלילה. הדופק ייפתח לך {מחר · בעוד יומיים · בעוד n ימים}." (the days from the member's own joining date) |
| §12.0.3, "waits for the email service" | Today, review, mistakes, progress, the pulse, the pre-guess | That row is gone. These open when their packages are built and Yoad sets their flags |

### What wave 4 built for it

- **M-2 opens without the account** (package M). In
  `shared/study/flags.ts`, `guess` is `meeting && VITE_STUDY_GUESS`. It no
  longer needs Today, progress or an account.
- **Catch-up has an entry without Today.** `?v=catchup` needs `f.guess`
  instead of `f.today` (`lib/route.ts`, `route.test.ts`). It is entered from
  the meeting's card on "יחד" ("פגישה שפספסת").
- **The "לא ברור" toast may promise tomorrow.** It reads "הפסקה תחזור אליך
  מחר." when something brings the paragraph back (the anchor's chip with
  `VITE_STUDY_ANCHOR`, or Today). With neither, it keeps the "stored only"
  wording, because nothing would bring it back.
- **V and J needed no change.** Disputes, VAR, the log and the wall never
  waited for the account (§12.0.3 put them in phase 2, "no account needed").
- `route.test.ts` still checks that F's own words (help, privacy, tabs,
  chips, notices) promise no return tomorrow before release 8. They still
  don't, so the test stays as it was. It no longer stands for a rule.
  *Changed in wave 5 (A2):* the check now follows decision 1: F's words
  may promise "מחר" only where something brings the item back ("הטעויות
  שלי" with another wording, Today, or the anchor's chip), and help must
  promise it once "הטעויות שלי" is on.

### Left for the packages not built yet

These are not wave 4's to change. Each package must settle them when it is
built:

- **"הטעויות שלי"** (`mistakes: practice && progress`): its comment says it
  waits for the saved account. It now waits only for progress (package A2).
  *Settled by A2 (study/w5-a):* the comment and the notice no longer name
  an account ("״הטעויות שלי״ עוד לא פתוחות.").
- **`requiredSchema`** asks for section A at 1 with progress or marathons.
  A2 decides whether it still needs section A without accounts. *Settled
  by A2:* section A only for the withdrawn `VITE_STUDY_ACCOUNT`; progress,
  marathons and "הטעויות שלי" need section P at 2 (and Q at 2). Section A
  stays an empty pair of markers in the SQL.
- **The pulse (package U, review SEC-8).** The addendum counts "three saved
  accounts that joined a week before", so that one person on two devices is
  not counted twice. Without accounts, U counts members who joined a week
  before. One person on two phones is then two members. U's builder must
  state this plainly in help and the privacy note, or ask Yoad. *Settled by
  package U (study/w5-u):* `study_private.pulse_counted` counts members of
  a week who did not opt out, whatever their identity; the privacy note says
  "מי שהצטרפו משני טלפונים נספרים פעמיים" (the table above), and P-14 no
  longer mentions an account.

### What it means for releases 7 and 8 (wave 5)

Release 7 (`ACCOUNT`, A1, accounts with an email code) is gone from the
plan. Nothing of release 8 or phase 3 waits for it, and no step of any
release asks for an email service, a domain or `VITE_STUDY_ACCOUNT`, which
stays unset and unused. Release 8 is now just its own packages, each behind
its own flag, in whatever order Yoad turns them on once the SQL has run:

| Flag | Package (wave 5) | Needs in the SQL | Needs first among the flags |
|---|---|---|---|
| `VITE_STUDY_PROGRESS` | A2: "ההתקדמות שלי"; with `PRACTICE`, Q-2's "הטעויות שלי" in another wording | P 2 (and Q 2) | none |
| `VITE_STUDY_CARDS_REVIEW` | C's in-app review | C 2 | `CARDS` |
| `VITE_STUDY_TODAY` | T-1: "היום" as the home | T 1 | none (each row waits for its own flag) |
| `VITE_STUDY_GUESS` | M-2: the pre-guess and catch-up (wave 4) | M 1 | `MEETING` (and so `QUIZ`) |
| `VITE_STUDY_PULSE` + the switch `pulse` | U-2: the pulse | U 1 (and P 2) | `PROGRESS` |

- **§12.7.6's gating rule is removed.** "Lists and scores wait for the
  saved account" no longer exists: lists and scores (progress, the danger
  list, "הטעויות שלי", Today's queue, the pulse) open as soon as their flag
  is on. Promise chips may say "מחר" wherever something really brings the
  item back; `route.test.ts` checks exactly that (above).
- **Owner-only stays owner-only between members.** Progress, the danger
  list, mistakes, Today's queue, the flame and "אצלך" are the device's
  member's own rows, read through definer functions that answer only
  `auth.uid()`'s rows. What the group sees of anyone is only what it saw
  before, and the pulse's anonymous words (decision 3's floor of 3).
- **Today wires the other packages' rows** (wave 5's integration):
  Q-2's "טעויות בניסוח אחר" from A2's counts and U-2's "רק אצלך חם" from
  the pulse reach "התור שלי" through Today's slots, each only with its own
  flag. Without `PROGRESS` or `PULSE` those rows are simply absent, and
  Today still opens.
- **The members' report** that §12.7.6 asked for before release 8 is still
  Yoad's call, but it is no longer tied to an account release.

### What it means for members

- **A member is the browser on the phone they joined from.** There is
  nothing to sign in to and nothing to remember.
- **Clearing the browser's data, changing phones, using another browser, or
  a private tab starts fresh.** The member joins again with the group's
  code, as a new member. Whatever belonged to the old identity alone stays
  with it and cannot be moved: their deck part by part, private cards and
  their reviews, answers, bets and mistakes, "לא ברור" taps, wall pins and
  votes, and "עדכון" notes. What the group shares stays, under the old name:
  comments, corrections, questions, cards, and wall entries posted with a
  name.
- **The old name is taken until the old member is removed.** Joining again
  with the same name answers "השם הזה כבר בשימוש בקבוצה". The group's
  creator removes the old member on "שלי", and the name is free again.
- **"יציאה מהמכשיר הזה" on "שלי" is the same as starting fresh.** It ends
  the member on that phone. Tell the group not to tap it unless they mean
  it.
- **On an iPhone, Safari and the Home Screen app are two different
  browsers.** Apple keeps their storage apart. A member who joins in Safari
  and then opens the Home Screen icon is a new member there. Add the app to
  the Home Screen first, and join from the icon.
- **Safari can erase a website's data.** If the site isn't opened for seven
  days of Safari use, WebKit's tracking prevention may delete what the site
  stored. That would include the member's identity. A Home Screen app is not
  subject to this rule. One more reason to use the Home Screen icon.
- **If the group's creator starts fresh,** nobody has the creator's buttons
  any more ("להחליף קוד", removing a member). Yoad can give them to the
  creator's new member in the SQL Editor. Find the new id with
  `select user_id, name, joined_at from public.study_members order by joined_at;`
  and then run
  `update public.study_groups set created_by = '<that user_id>';`. Never
  create a second group: only one group can exist.
- **Privacy is unchanged.** What is owner-only stays owner-only. Names
  appear where they appeared before, and never on backing, votes or "לא
  ברור".

## Decision 2: package B, redefined

> No automatic question or card writing. After every summary is written,
> the server reads the lecture's points to know, so "מה ליצור" opens with
> its numbers at once.

### What it changes in the addendum

| Where | The addendum said | Now |
|---|---|---|
| §12.0.2, decision 3 | Questions and cards are written automatically after each summary, in batch mode (about $0.30 a lecture), with a fall-back at full price | Withdrawn. Questions and cards are written only when a member taps, as in practice 2.0 |
| §12.6.B (B-1, B-2) | A bank job per lecture: Message Batches at half price, a blind-solver batch, a deadline 90 minutes before the meeting, the switch `bank`, `study_bank_state`, and the upload's "להכין גם שאלות וכרטיסיות?" | None of it is built. Section B holds the points read ahead instead |
| §12.0.3, §12.7.6 release 4 | "the bank written ahead (switch `bank`, once W1 is live)" | The points read ahead, switch `points_ahead`, on by default |
| `ENDS.B` (`shared/study/flags.ts`) | False until B's end | True: help and the privacy note describe the read ahead. No build needs section B |

### What wave 4 built for it (package B, section B at version 1)

- **When.** When the server's writer finishes a lecture's summary (the
  lecture becomes `ready`), the database kicks the worker (pg_net, `POST
  /api/study/work {"points": <lecture>}`). The worker reads the lecture's
  points to know exactly as the action "points" does (`server/study/points.ts`:
  part by part, six calls at once).
- **Only parts never tried on their text.** A text is never read ahead
  twice. A part that failed waits for a member's "לנסות שוב". Nothing runs
  while another read holds the part.
- **Through the ledger.** Kind `points`. The worker's rows name no member,
  so no member's share or daily limit counts them. The group's cap counts
  them, and so does the optional features' line (80% of
  `STUDY_MONTHLY_USD`). At that line the read is skipped quietly, and "מה
  ליצור" still offers "לקרוא את הנקודות" for a tap.
- **The switch, no flag.** The server switch `points_ahead`
  (`study_private.features`) is on by default. No `VITE_STUDY_*` flag is
  needed, because the only screen change is the setup screen's wording. It
  reads the new column when it is there. Yoad turns it off with

  ```sql
  update study_private.features set enabled = false, changed_at = now() where name = 'points_ahead';
  ```

- **Cost.** The same as a member's read: about $0.24 for a lecture of five
  parts, once for the group, and again only for a part written anew.

### What it means for members

- "מה ליצור" opens with its numbers: shortly after the summary is written,
  the points to know are already read. While the read runs, the screen
  shows its progress with "הנקודות נקראות מעצמן".
- The upload no longer asks "להכין גם שאלות וכרטיסיות?". Questions and
  cards are made only when someone taps, as before.
- Near the month's limit, the read ahead stops quietly. The screen then
  offers "לקרוא את הנקודות", as before decision 2.

## Decision 3: the end-of-semester extras are usable early, with a meter, minimal blocking

> The addendum's phase 3 is no longer held for the end of the semester.
> Each extra opens as soon as there is anything to show, with limited
> value, and shows a meter of what is needed for more instead of a hard
> lock.

The extras of phase 3 are the boss (H), the museum (U-3), the group and
marathon plan (G), and the extras of E (the blank table P10 and one's own
trap P11), with T-2's "הקבוצה צריכה אותך" and the exam-eve view. Their
flags (`VITE_STUDY_BOSS`, `VITE_STUDY_MUSEUM`, `VITE_STUDY_MARATHONS` with
`VITE_STUDY_GROUP_PLAN`, `VITE_STUDY_TRAPS`, `VITE_STUDY_BLANK_TABLE`,
`VITE_STUDY_NEEDS_ME`, `VITE_STUDY_EVE`) may go on at any time, once each
package is built and its SQL has run.

### The rules

- **Open with whatever there is.** A screen opens as soon as there is
  anything to show, even if it is little, and says beside it what more is
  needed. The approved examples:
  - the boss: "3 מתוך 8 נושאים חמים · עוד כ-20 תשובות לנושא הבא";
  - the museum: "2 מוצגים · עוד 4 הימורי ׳על בטוח׳ שגויים למוצג הבא";
  - the plan: "התוכנית מדייקת ככל שמתרגלים: 12 מתוך 30 הרצאות עם נתונים".
- **Block only where literally nothing can be shown.** Then the screen is
  an empty state with the meter, never a dead end: it says what would open
  it and, where there is one, offers the way there.
- **The privacy floor stays.** Anything shown to the group anonymously
  (the pulse, hot spots, museum exhibits, boss topics) counts only once at
  least 3 different members contributed. Below that the meter says how far
  it is, e.g. "עוד אדם אחד וזה נפתח", and never who. A member always sees
  their own data, at any count.
- **Meters are real.** Every number on a meter is computed from real counts
  (in SQL, or on the phone from reads the screen already makes), never
  invented. Each threshold is a named constant in one place, mirrored by the
  SQL where the SQL uses it, with a unit test that fails if the two differ.

### What it changes in the addendum

| Where | The addendum said | Now |
|---|---|---|
| §12.0.3, "Merged dark, waits for data" | The museum and the boss wait for phase 3 (7-13 Dec), when the counts exist | They open when built and flagged, with a meter until the counts grow |
| §12.7.6, release 9 | The group plan, the boss, the museum, the extras, "הקבוצה צריכה אותך" and the exam-eve view: phase 3 | No date: each flag may go on any time after its package and SQL |
| §12.5.H, §12.5.U (U-3), §12.6.G, §12.6.E, §12.4.T (T-2), §12.3.A (PR6) | Hard locks until enough data ("from 3 people", "after weeks of bets") | The same thresholds, shown as meters on a screen that is already open; the floor of 3 members for anything the group sees stays |

### What wave 5 built for it

In wave 5's first round (A2, U, T-1) the extras were not built yet, and
those packages applied the rule where it fits them:

- **The pulse (U-2).** Below the floor the pulse shows its meter from the
  night's real counts (`study_pulse_meter`): "עוד אדם אחד וזה נפתח" for a
  lecture with no row yet, "5 מתוך 6 נושאים פתוחים · עוד אדם אחד לנושא
  הבא", a group with fewer than 3 counted members, and a member not counted
  yet ("הדופק ייפתח לך בעוד 5 ימים", from their own joining date). "אצלך"
  shows at any count. The thresholds: section U's `pulse_floor()` 3,
  `pulse_join_days()` 7, `pulse_window_days()` 28, `pulse_week_days()` 7,
  `pulse_forget_days()` 60, mirrored by `shared/study/pulse.ts`'s `PULSE`;
  `shared/study/pulse.test.ts` reads the SQL and fails if they differ.
- **Progress (A2).** Every number short of answers keeps its place and says
  how many more, from the member's own rows. The thresholds are in
  `shared/study/progress.ts` (`READINESS_MIN` 20, `CALIBRATION_MIN` 20,
  `ASPECT_MIN` 4, `DANGER_SECOND_DAYS` 3, `DANGER_RIGHTS` 2);
  `shared/study/progress.test.ts` reads section P's end and fails if the SQL
  uses other numbers.
- **Today (T-1)** is not an extra: its one meter is the flame ("להבה 4/7",
  `FLAME_WINDOW` 7 and `FLAME_LIT` 4 in `shared/study/today.ts`), the
  member's own and never blocked. T-2 is left to its package.
- **Hooks left for the extras:** U's `study_private.pulse_night__traps`
  (U-3's traps and exhibits; `pulse_q` already counts the trap option and
  the confident one), Today's `TODAY_SLOTS.lane` (G) and `study_today`'s
  `loot` (H) and `needs_me` (T-2), the plan's and marathons' tables in
  section P (G). Each package adds its own meter by these rules, its
  thresholds in its shared module with a test against the SQL.

### The extras, built (wave 5's second round)

The extras were then built on `study/wave5` and merged in the order H
(with U-3), G (with T-2 and the exam eve), E (`RELEASE-5.md`). Each opens
with what there is and its meter:

| Extra | Its meter (real counts) | Below the floor of 3 |
|---|---|---|
| The museum (U-3) | "2 מוצגים · עוד 4 הימורי ׳על בטוח׳ שגויים למוצג הבא" (`study_museum_meter`, from the night's counts) | "המוזיאון נפתח מ-3 מתרגלים: עוד אדם אחד וזה נפתח." · a trap and an exhibit need 3 different members |
| The boss (H-1) | "3 מתוך 8 נושאים חמים · עוד כ-20 תשובות לנושא הבא" (`study_boss_open`) | "הבוס נבנה מ-3 מתרגלים: …" · a battle needs 3 players, a round 3 answers |
| The plan (G) | "התוכנית מדייקת ככל שמתרגלים: 12 מתוך 30 הרצאות עם נתונים" · "עוד כ-5 תשובות ועוד אדם אחד להרצאה הבאה" (`study_group_plan_meter`) | a lecture's bucket moves the plan only from 3 members |
| "הקבוצה צריכה אותך" (T-2) | "עוד כ-2 תשובות נכונות על {topic} לנושא הבא." (`study_needs_me_meter`, her own) | her own: no floor |
| The exam eve | each empty part says what fills it (her own reads) | her own: no floor |
| Own trap (P11), blank table (P10) | the author's own drafts; the group's tables by shape (`study_slide_tables`) | content, never a count of members: no floor to count |

**One place for every threshold.** Since the integration, every meter's
numbers live in `shared/study/meters.ts`: one `FLOOR` of 3 that the pulse,
the museum, the boss's players and the plan's buckets all take, and
`PULSE`, `MUSEUM`, `BOSS`, `PLAN`, `NEEDS_ME`, `TRAPS`, `BLANK` and A2's
minimums (each package's module re-exports its own).
`shared/study/meters.test.ts` fails if any SQL threshold function of
sections U, H, G and T differs from its constant, if the SQL gains one the
module does not name, if a group-level meter in the SQL uses a literal
floor, if another module defines a meter's constant again, or if the meters
Yoad approved stop coming out word for word from real counts.

### What it means for members

- The extras appear when Yoad turns them on, possibly early in the
  semester, with little in them at first. Each says plainly what it is
  waiting for ("עוד 4 הימורי ׳על בטוח׳ שגויים למוצג הבא"), so practising
  is what fills it.
- Nothing anonymous about the group ever shows from fewer than 3 members.
  A meter below that floor says only how many more members are needed,
  never who has or has not practised.

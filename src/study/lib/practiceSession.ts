/* ── A practice session: what it asks, in what order, and how each showing
 *    looks (package Q; spec §5.5, design-questions §4.3) ──
 *
 * Pure, with the device's storage in try/catch: which questions a session
 * asks and in what order (pickQueue, for every session key of the practice
 * route: l. c. m m. t. e. q. p. r. w. k.); the fresh order each showing gives the
 * options, mapped back to the stored index for study_answer_question and
 * applied to the explanations it returns (review UX-2: the options never
 * stay in one place, except all-numeric ones, which stay ascending); "מצב
 * מבחן" (every feedback held to the end, each question timed by
 * study_quiz__seconds's rule; review UX-22); and the session kept in
 * sessionStorage, orders included, so a reload resumes at the same question
 * showing the same order. The live quiz never uses this: every phone shows
 * the stored order there.
 *
 * Types are structural: PublicQuestion (src/study/lib/practice.ts) has every
 * field SessionQuestion names. Question types (docs/study/question-types.md):
 * a set question (tf, match, order) and a pin number to tap keep the stored
 * order; a staged case's steps stay together and in order. */

import { isSetForm, scoreSet, type SetForm, toShownSet, toStoredSet } from "../../../shared/study/forms";

/** What study_answer_question records as the session's mode. */
export type Mode = "lecture" | "course" | "mistakes" | "exam";

/** The fields of a question that choosing and showing it need. */
export type SessionQuestion = {
  id: string;
  lecture_id: string | null;
  ref_lecture: string | null;
  exam_no: number | null;
  part_idx: number | null;
  created_at: string;
  topic: string;
  vignette: string;
  question: string;
  options: string[];
  /** Practice 2.0: the style (null for release 1's questions, read as a case or "other"). */
  kind?: "mcq" | "case";
  /** A past exam's item keeps its options in the exam's order (sources.md B5: "א+ב נכונות" must still point at א and ב). */
  source?: string;
  style?: string | null;
  /** Question types: the form, a picture, a staged case's series and step. */
  form?: string;
  figure?: string;
  layout?: { kind: string } | null;
  series?: string | null;
  step?: number | null;
  /** Any flag of any member puts the question last in its tier. */
  study_question_flags?: ReadonlyArray<{ user_id?: string }>;
};
/** The caller's latest answer per question (study_my_latest). */
export type Latest = ReadonlyMap<string, { correct: boolean; at: string; times: number }>;
/** The caller's open mistakes (study_my_mistakes: wrong until answered right on a later study day). */
export type Mistake = { question_id: string; wrong_at: string };
/** Q-2: a question due again and the one to ask instead (another wording:
 *  study_my_rewordings' question on the same paragraph, or the danger list's
 *  ask_id; the question itself when there is no other). */
export type Again = { question_id: string; ask: string; wrong_at: string };
/** What study_answer_question returns, in the stored order. */
export type Feedback = {
  answer: number;
  explanations: string[];
  takeaway: string;
  correct?: boolean;
  whens?: string[];
  /** A set question: its key, the right count of the answer, its choices. */
  seq?: number[];
  right?: number;
  total?: number;
  choices?: number[] | null;
};
/** The bet before "לבדוק" (p_confidence): ניחוש 1 · נראה לי 2 · על בטוח 3. */
export type Bet = 1 | 2 | 3;
export const BETS: ReadonlyArray<{ bet: Bet; label: string }> = [
  { bet: 1, label: "ניחוש" },
  { bet: 2, label: "נראה לי" },
  { bet: 3, label: "על בטוח" },
];
export const betLabel = (b: Bet | null | undefined): string => BETS.find((x) => x.bet === b)?.label ?? "";

/* ── סבב חדש's choice (practice 2.0): from where, which parts, which style ── */

/** "מאיפה": לא נענו · טעיתי · סימנתי · הכול (shared/study/practice2.ts's Source). */
export type Source = "new" | "wrong" | "flagged" | "all";
export type SessionPick = { sources: Source[]; parts?: number[]; styles?: string[] };

/** A question's style as סבב חדש counts it: its own, else a case or "other" (study_session_counts' rule). */
export const styleOf = (q: Pick<SessionQuestion, "kind" | "style">): string => q.style ?? (q.kind === "case" ? "case" : "other");

/** Whether a question is in the pick: within the chosen parts and styles
 *  (none chosen: all), and in one of the chosen sources: never answered,
 *  an open mistake ("טעיתי" is "הטעויות שלי"'s rule), flagged by the caller. */
export function inPick(
  q: SessionQuestion,
  pick: SessionPick,
  o: { latest: Latest; mistakes?: ReadonlySet<string>; me?: string },
): boolean {
  if (pick.parts?.length && !pick.parts.includes(q.part_idx ?? -1)) return false;
  if (pick.styles?.length && !pick.styles.includes(styleOf(q))) return false;
  if (!pick.sources.length || pick.sources.includes("all")) return true;
  const wrong = o.mistakes?.has(q.id) ?? false;
  if (pick.sources.includes("new") && !o.latest.has(q.id) && !wrong) return true;
  if (pick.sources.includes("wrong") && wrong) return true;
  return pick.sources.includes("flagged") && Boolean(o.me) && (q.study_question_flags ?? []).some((f) => f.user_id === o.me);
}

/* ── Session keys (?v=practice&s=…) ── */

export type Scope =
  | { kind: "lecture"; lecture: string } // l.<lecture>
  | { kind: "course"; course: string } // c.<course>
  | { kind: "mistakes"; lecture: string | null } // m · m.<lecture>
  | { kind: "topic"; topic: string } // t.<topic key>
  | { kind: "exam"; exam: string } // e.<exam>
  | { kind: "quiz"; quiz: string } // q.<quiz>: an ended live quiz's questions
  | { kind: "paragraph"; lecture: string; part: number; anchor: number } // p.<lecture>.<part>.<anchor>: one paragraph's (N)
  | { kind: "again"; group: string } // r.<group>: what is due again today, each in another wording (Q-2)
  | { kind: "mockWrong"; attempt: string } // w.<attempt>: a simulation's mistakes, asked again (sources.md, phase 2)
  | { kind: "set"; set: string }; // k.<set>: a practice set's questions, in the set's order (docs/study/sets.md)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A topic's key, as progress links to it: lower(btrim(topic)). */
export const topicKey = (topic: string): string => topic.trim().toLowerCase();

/** The scope a session key names, or null for a key no screen writes. */
export function parseScope(s: string | undefined): Scope | null {
  if (!s) return null;
  if (s === "m") return { kind: "mistakes", lecture: null };
  const dot = s.indexOf(".");
  if (dot < 1) return null;
  const tag = s.slice(0, dot);
  const arg = s.slice(dot + 1);
  if (!arg || arg.length > 200) return null;
  switch (tag) {
    case "l":
      return UUID.test(arg) ? { kind: "lecture", lecture: arg } : null;
    case "c":
      return { kind: "course", course: arg };
    case "m":
      return UUID.test(arg) ? { kind: "mistakes", lecture: arg } : null;
    case "t":
      return { kind: "topic", topic: topicKey(arg) };
    case "e":
      return UUID.test(arg) ? { kind: "exam", exam: arg } : null;
    case "q":
      return UUID.test(arg) ? { kind: "quiz", quiz: arg } : null;
    case "r":
      return UUID.test(arg) ? { kind: "again", group: arg } : null;
    case "w":
      return UUID.test(arg) ? { kind: "mockWrong", attempt: arg } : null;
    case "k":
      return UUID.test(arg) ? { kind: "set", set: arg } : null;
    case "p": {
      const m = /^([^.]+)\.(\d{1,5})\.(\d{1,5})$/.exec(arg);
      return m && UUID.test(m[1]) ? { kind: "paragraph", lecture: m[1], part: Number(m[2]), anchor: Number(m[3]) } : null;
    }
    default:
      return null;
  }
}

/** The mode an answer is recorded with: a past exam, or any session in
 *  "מצב מבחן", is "exam"; otherwise the scope's. */
export function modeOf(scope: Scope, timed = false): Mode {
  if (timed || scope.kind === "exam" || scope.kind === "mockWrong") return "exam";
  // A practice set is a lecture's (a sheet set, the exams design's, will be "course").
  if (scope.kind === "lecture" || scope.kind === "paragraph" || scope.kind === "set") return "lecture";
  if (scope.kind === "mistakes" || scope.kind === "again") return "mistakes";
  return "course";
}

/* ── What a session asks, and in what order ── */

const flagged = (q: SessionQuestion) => (q.study_question_flags?.length ?? 0) > 0;
const lectureOf = (q: SessionQuestion) => q.lecture_id ?? q.ref_lecture ?? "";
const byId = (a: SessionQuestion, b: SessionQuestion) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Never-answered questions of several lectures: shuffled within each
 *  lecture, the lectures taken in a random order, one question of each in
 *  turn, so a course session does not ask one lecture after another. */
function interleave(items: SessionQuestion[], random: () => number): SessionQuestion[] {
  const groups = new Map<string, SessionQuestion[]>();
  for (const q of [...items].sort(byId)) groups.set(lectureOf(q), [...(groups.get(lectureOf(q)) ?? []), q]);
  const queues = shuffle(
    [...groups.keys()].sort().map((k) => shuffle(groups.get(k)!, random)),
    random,
  );
  const out: SessionQuestion[] = [];
  while (queues.some((x) => x.length)) for (const x of queues) if (x.length) out.push(x.shift()!);
  return out;
}

/** Flagged questions go last; otherwise the order is kept. */
const flaggedLast = (items: SessionQuestion[]) => [...items.filter((q) => !flagged(q)), ...items.filter(flagged)];

/** The ids a session asks, in order (design-questions §4.3, with the review's
 *  keys and hidden questions):
 *  - questions this person hid ("להסתיר ממני") never come;
 *  - m, m.<lecture>: the open mistakes, oldest first; with Q-2 (`again`), the
 *    ones due again (from an earlier study day) first, each asked in
 *    another wording, then today's as themselves (§12.3.Q's tier 1);
 *  - r.<group>: only what is due again, each in another wording, in the
 *    order given (the danger list's due rows, then the rewordings);
 *  - e.<exam>: in the exam's order;
 *  - l.<lecture>, p.<lecture>.<part>.<anchor> (one paragraph's, as read), and
 *    c. t. q. ("course"): three tiers, flagged questions last
 *    in each: never answered (a lecture in part order, as read; a course
 *    shuffled with its lectures interleaved), then wrong now (an open mistake
 *    or a wrong latest answer; oldest first), then right (least recently
 *    answered first);
 *  - with the group's signal (section U, Q10: `signals`, 3 confident errors ·
 *    2 missed · 1 split), a course's or topic's never-answered tier and every
 *    scope's right tier put the questions the group finds hard first (a
 *    lecture's never-answered tier keeps the reading order; one's own
 *    mistakes keep theirs);
 *  - then the first `size`. */
export function pickQueue(o: {
  key: string;
  questions: SessionQuestion[];
  latest: Latest;
  mistakes?: ReadonlyArray<Mistake>;
  hidden?: ReadonlySet<string>;
  size: number | "all";
  random: () => number;
  /** סבב חדש's choice; the caller's id for "סימנתי". */
  pick?: SessionPick;
  me?: string;
  /** Q-2: what is due again and what to ask instead (sessions m and r.). */
  again?: ReadonlyArray<Again>;
  /** The group's signal per question (section U's study_pulse_questions), or none. */
  signals?: ReadonlyMap<string, number>;
}): string[] {
  const scope = parseScope(o.key);
  if (!scope) return [];
  const take = (ids: string[]) => (o.size === "all" ? ids : ids.slice(0, Math.max(0, o.size)));
  let qs = o.questions.filter((q) => !o.hidden?.has(q.id));
  if (o.pick) {
    const pick = o.pick;
    const wrong = new Set((o.mistakes ?? []).map((m) => m.question_id));
    qs = qs.filter((q) => inPick(q, pick, { latest: o.latest, mistakes: wrong, me: o.me }));
  }
  if (scope.kind === "lecture") qs = qs.filter((q) => q.lecture_id === scope.lecture);
  // A paragraph's questions are the ones section N places on it (the caller loads exactly those).
  if (scope.kind === "paragraph") qs = qs.filter((q) => q.lecture_id === scope.lecture && q.part_idx === scope.part);
  if (scope.kind === "topic") qs = qs.filter((q) => topicKey(q.topic) === scope.topic);
  if (scope.kind === "mistakes" && scope.lecture) qs = qs.filter((q) => lectureOf(q) === scope.lecture);
  const open = new Map((o.mistakes ?? []).map((m) => [m.question_id, m.wrong_at]));

  if (scope.kind === "mistakes" || scope.kind === "again") {
    // Every question there is (a substitute may sit in another lecture's part only by its own lecture).
    const present = new Map(o.questions.filter((q) => !o.hidden?.has(q.id)).map((q) => [q.id, q]));
    const inScope = new Set(qs.map((q) => q.id));
    const byTime = <T extends { 0: string; 1: string }>(a: T, b: T) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1);
    const out: string[] = [];
    const seen = new Set<string>();
    const put = (id: string) => {
      if (seen.has(id) || !present.has(id)) return false;
      seen.add(id);
      out.push(id);
      return true;
    };
    // Tier 1: due again, in another wording (the substitute, else the question itself).
    const again = (o.again ?? []).filter((a) => scope.kind === "again" || inScope.has(a.question_id));
    const ordered = scope.kind === "again" ? again : [...again].sort((a, b) => byTime([a.question_id, a.wrong_at], [b.question_id, b.wrong_at]));
    for (const a of ordered) {
      if (a.ask !== a.question_id && put(a.ask)) seen.add(a.question_id); // asked in its other wording, not again as itself
      else put(a.question_id);
    }
    if (scope.kind === "again") return take(out);
    // Then the rest of the open mistakes as themselves, oldest first.
    for (const [id] of [...open].filter(([id]) => inScope.has(id)).sort(byTime)) put(id);
    return take(out);
  }
  // A simulation's mistakes: in the simulation's order (the caller loads them so).
  if (scope.kind === "mockWrong") return take(qs.map((q) => q.id));
  // A practice set: every question of it, in the set's order (the caller loads them so), whatever the size.
  if (scope.kind === "set") return qs.map((q) => q.id);
  if (scope.kind === "exam") {
    return take(
      [...qs]
        .sort((a, b) => (a.exam_no ?? Infinity) - (b.exam_no ?? Infinity) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || byId(a, b))
        .map((q) => q.id),
    );
  }

  const fresh = qs.filter((q) => !o.latest.has(q.id));
  const lastAt = (q: SessionQuestion) => o.latest.get(q.id)?.at ?? "";
  const wrongNow = (q: SessionQuestion) => open.has(q.id) || o.latest.get(q.id)?.correct === false;
  const byAnswered = (a: SessionQuestion, b: SessionQuestion) => (lastAt(a) < lastAt(b) ? -1 : lastAt(a) > lastAt(b) ? 1 : byId(a, b));
  const wrong = qs.filter((q) => o.latest.has(q.id) && wrongNow(q)).sort(byAnswered);
  const sig = (q: SessionQuestion) => o.signals?.get(q.id) ?? 0;
  // A stable sort: the group's signal first, the tier's own order after it.
  const bySignal = (xs: SessionQuestion[]) => (o.signals?.size ? xs.map((q, i) => ({ q, i })).sort((a, b) => sig(b.q) - sig(a.q) || a.i - b.i).map((x) => x.q) : xs);
  const right = bySignal(qs.filter((q) => o.latest.has(q.id) && !wrongNow(q)).sort(byAnswered));
  const firstTier =
    scope.kind === "lecture" || scope.kind === "paragraph"
      ? [...fresh].sort(
          (a, b) => (a.part_idx ?? Infinity) - (b.part_idx ?? Infinity) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || byId(a, b),
        )
      : bySignal(interleave(fresh, o.random));
  return take(keepSeries([...flaggedLast(firstTier), ...flaggedLast(wrong), ...flaggedLast(right)], scope.kind === "lecture" || scope.kind === "paragraph").map((q) => q.id));
}

/** A staged case's steps together, in step order, where its first step comes
 *  (question types). In a lecture's session a later step never starts the
 *  case: one whose step 1 is not in the queue is left out. Other scopes
 *  (mistakes, a course) may ask a step alone: each row stands alone. */
export function keepSeries<T extends Pick<SessionQuestion, "id" | "series" | "step">>(items: T[], startAtOne: boolean): T[] {
  if (!items.some((q) => q.series)) return items;
  const bySeries = new Map<string, T[]>();
  for (const q of items) if (q.series) bySeries.set(q.series, [...(bySeries.get(q.series) ?? []), q]);
  for (const list of bySeries.values()) list.sort((a, b) => (a.step ?? 1) - (b.step ?? 1));
  const out: T[] = [];
  const done = new Set<string>();
  for (const q of items) {
    if (!q.series) {
      out.push(q);
      continue;
    }
    if (done.has(q.series)) continue;
    done.add(q.series);
    const list = bySeries.get(q.series)!;
    if (startAtOne && (list[0].step ?? 1) > 1) continue;
    out.push(...list);
  }
  return out;
}

/* ── Each showing's option order (review UX-2) ── */

/** An option that is a number with at most a short unit ("48 שעות"): the
 *  server's rule (server/study/questions.ts, numericValue), which stores such
 *  options ascending. */
export function isNumericOption(s: string): boolean {
  const m = /^[^\dא-ת]{0,3}(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return false;
  return s.slice(m[0].length).replace(/[\s\d.,%/×x\-–~≈<>≤≥()]/g, "").length <= 14;
}

export function cryptoRandom(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
}

/** The order a question is shown in: a set question and a pin number to tap
 *  keep the stored order (the server shuffled them once); every other a fresh one. */
export function orderFor(q: Pick<SessionQuestion, "options" | "form"> & Partial<Pick<SessionQuestion, "source">>, random: () => number = cryptoRandom): number[] {
  // A past exam's item is shown as the exam printed it: its options may name
  // each other ("א+ב נכונות", "כל התשובות נכונות"), so a new order would make
  // them wrong (sources.md B5, practiceSession's orderFor for source 'exam').
  if (q.source === "exam") return q.options.map((_, i) => i);
  // A tap item's options are its pin numbers, in pin order. Every other form is shuffled for each
  // showing, set questions too (tf's statements, match's answers, order's steps), so a question
  // that comes back is not answered by remembering where things were (review QT-11).
  if (q.form === "tap") return q.options.map((_, i) => i);
  return showOrder(q.options, random);
}

/** A fresh order for one showing: order[shown place] = stored index. All-numeric
 *  options keep their stored, ascending order. */
export function showOrder(options: readonly string[], random: () => number = cryptoRandom): number[] {
  const order = options.map((_, i) => i);
  if (options.length < 2 || options.every(isNumericOption)) return order;
  return shuffle(order, random);
}

/** The options as shown. */
export const shownOptions = (options: readonly string[], order: readonly number[]): string[] => order.map((i) => options[i]);

/** The choice to send to study_answer_question: the stored index of the
 *  option shown at `shown` ("לא יודעים", null, stays null). */
export function toStored(order: readonly number[], shown: number | null): number | null {
  if (shown === null) return null;
  const i = order[shown];
  if (i === undefined) throw new Error("bad choice");
  return i;
}

/** The feedback as shown: the key's shown place and every explanation under
 *  its own option. */
export function toShown(order: readonly number[], fb: Feedback, form?: string): Feedback {
  if (fb.seq && isSetForm(form)) {
    return {
      ...fb,
      seq: toShownSet(form, order, fb.seq),
      ...(fb.choices ? { choices: toShownSet(form, order, fb.choices) } : {}),
      explanations: form === "tf" ? order.map((i) => fb.explanations[i] ?? "") : order.map((i) => fb.explanations[i] ?? ""),
      ...(fb.whens ? { whens: order.map((i) => fb.whens?.[i] ?? "") } : {}),
    };
  }
  return {
    ...fb,
    answer: order.indexOf(fb.answer),
    explanations: order.map((i) => fb.explanations[i] ?? ""),
    ...(fb.whens ? { whens: order.map((i) => fb.whens?.[i] ?? "") } : {}),
  };
}

/** The autopsy's order (the approved screen): the option chosen first when it
 *  was wrong, then the key, then the rest as shown. Shown places in, shown
 *  places out. */
export function autopsyOrder(count: number, chosen: number | null | undefined, answer: number): number[] {
  const first = [...(chosen !== null && chosen !== undefined && chosen !== answer && chosen >= 0 && chosen < count ? [chosen] : []), ...(answer >= 0 && answer < count ? [answer] : [])];
  return [...first, ...Array.from({ length: count }, (_, i) => i).filter((i) => !first.includes(i))];
}

/** An uploaded item (a past exam's or a sheet's) keeps its printed order
 *  after the answer (uploaded sheets, design D10, with VITE_STUDY_SHEETS): "א+ב
 *  נכונות" and the letters the member saw on paper stay where they were, and
 *  the verdict marks the chosen and the right option in place. */
export const keepPrinted = (q: { source?: string | null }, on: boolean): boolean => on && q.source === "exam";
/** The options in their printed order. */
export const printedOrder = (count: number): number[] => Array.from({ length: Math.max(0, count) }, (_, i) => i);

/* ── "מצב מבחן" ── */

/** The clock of one question in "מצב מבחן": study_quiz__seconds's rule, about
 *  15 characters a second plus 10 to choose, at least the setting, at most
 *  240. The characters are the case, the lead-in and the options, as the
 *  quiz counts them. */
export function examSeconds(q: Pick<SessionQuestion, "vignette" | "question" | "options"> & Partial<Pick<SessionQuestion, "form" | "figure" | "layout">>, setting: number): number {
  const chars = q.vignette.length + q.question.length + q.options.reduce((n, t) => n + t.length, 0);
  // Question types: 4 s more for each element of a set, 12 s more to look at a picture.
  const more = (isSetForm(q.form) ? 4 * q.options.length : 0) + ((q.figure ?? "") !== "" || q.layout ? 12 : 0);
  return Math.min(240, Math.max(setting, Math.ceil(chars / 15) + 10 + more));
}
/** The setting "מצב מבחן" times by until the screen offers a choice: the spec
 *  gives the rule (study_quiz__seconds) but no practice setting. */
export const EXAM_SETTING_SECONDS = 60;

/* ── The session ── */

/** choice: the stored option (a one-answer question), the stored choices (a set question), or null ("לא יודעים"). */
export type Result = { id: string; choice: number | number[] | null; correct: boolean; bet?: Bet | null };
export type SessionState = {
  /** 2 since the question types (a result's choice may be a list); 1 still loads. */
  v: 1 | 2;
  key: string;
  mode: Mode;
  /** "מצב מבחן": feedback held to the end, a clock per question. */
  timed: boolean;
  ids: string[];
  /** Per question, its showing's order (order[shown] = stored index). */
  orders: number[][];
  /** Per question, its clock in "מצב מבחן" (seconds), else 0. */
  seconds: number[];
  /** The question on screen; ids.length when the round is over. */
  i: number;
  /** Epoch ms the question on screen was shown (the answer's `ms`). */
  shownAt: number;
  results: Result[];
  /** study_answer_question's answers, by question id, in the stored order. */
  feedback: Record<string, Feedback>;
  /** סבב חדש's choice, kept for "סבב נוסף" (none: the scope's questions). */
  pick?: SessionPick;
  /** A practice set's attempt (study_qset_attempts): every answer is stamped with it. */
  attempt?: string;
};

/** A new session over `queue` (pickQueue's ids, with their questions). */
export function startSession(o: {
  key: string;
  timed: boolean;
  queue: Array<Pick<SessionQuestion, "id" | "vignette" | "question" | "options"> & Partial<Pick<SessionQuestion, "form" | "figure" | "layout" | "source">>>;
  now: number;
  setting?: number;
  random?: () => number;
  pick?: SessionPick;
  attempt?: string;
}): SessionState {
  const scope = parseScope(o.key);
  if (!scope) throw new Error("bad session");
  return {
    ...(o.pick ? { pick: o.pick } : {}),
    ...(o.attempt ? { attempt: o.attempt } : {}),
    v: 2,
    key: o.key,
    mode: modeOf(scope, o.timed),
    timed: o.timed,
    ids: o.queue.map((q) => q.id),
    orders: o.queue.map((q) => orderFor(q, o.random)),
    seconds: o.queue.map((q) => (o.timed ? examSeconds(q, o.setting ?? EXAM_SETTING_SECONDS) : 0)),
    i: 0,
    shownAt: o.now,
    results: [],
    feedback: {},
  };
}

/** A set being made (slice B, "להוסיף לסט"): questions that became ready
 *  while solving join the end of the round, each with its own showing's
 *  order and clock; ones already in it are not asked twice. A round that was
 *  over goes on with them. */
export function appendQueue(
  s: SessionState,
  queue: Array<Pick<SessionQuestion, "id" | "vignette" | "question" | "options"> & Partial<Pick<SessionQuestion, "form" | "figure" | "layout" | "source">>>,
  o: { now: number; setting?: number; random?: () => number },
): SessionState {
  const have = new Set(s.ids);
  const add = queue.filter((q) => !have.has(q.id) && (have.add(q.id), true));
  if (!add.length) return s;
  const wasOver = isOver(s);
  return {
    ...s,
    ids: [...s.ids, ...add.map((q) => q.id)],
    orders: [...s.orders, ...add.map((q) => orderFor(q, o.random))],
    seconds: [...s.seconds, ...add.map((q) => (s.timed ? examSeconds(q, o.setting ?? EXAM_SETTING_SECONDS) : 0))],
    ...(wasOver ? { shownAt: o.now } : {}),
  };
}

export const currentId = (s: SessionState): string | null => s.ids[s.i] ?? null;
export const isOver = (s: SessionState): boolean => s.i >= s.ids.length;
/** The question on screen was answered (its feedback is in). */
export const answered = (s: SessionState): boolean => !isOver(s) && s.results.some((r) => r.id === s.ids[s.i]);

/** The arguments of study_answer_question for the option shown at `shown`
 *  (null: "לא יודעים"), with the time since the question was shown, capped at
 *  an hour, and the bet made before "לבדוק" (null: none, as "לא יודעים"). */
export function answerArgs(s: SessionState, shown: number | null, now: number, bet: Bet | null = null) {
  const id = currentId(s);
  if (!id || answered(s)) throw new Error("no question");
  return {
    p_question: id,
    p_choice: toStored(s.orders[s.i], shown),
    p_mode: s.mode,
    p_ms: Math.min(3_600_000, Math.max(0, Math.round(now - s.shownAt))),
    p_confidence: shown === null ? null : bet,
  };
}

/** The arguments of study_answer_set for a set question: the choices as shown
 *  (null: "לא יודעים") put back in the stored order. */
export function setArgs(s: SessionState, form: SetForm, shown: number[] | null, now: number, bet: Bet | null = null) {
  const id = currentId(s);
  if (!id || answered(s)) throw new Error("no question");
  return {
    p_question: id,
    p_choices: shown === null ? null : toStoredSet(form, s.orders[s.i], shown),
    p_mode: s.mode,
    p_ms: Math.min(3_600_000, Math.max(0, Math.round(now - s.shownAt))),
    p_confidence: shown === null ? null : bet,
  };
}

/** A set answer's verdict on this device (the server's is what counts): right of total, all or nothing. */
export const setVerdict = (form: SetForm, seq: readonly number[], choices: readonly number[] | null) => scoreSet(form, seq, choices);

/** The answer came back: recorded with its feedback (and the bet). In "מצב
 *  מבחן" the session moves on at once; otherwise the feedback shows until next(). */
export function recordAnswer(s: SessionState, choice: number | number[] | null, fb: Feedback, now: number, bet: Bet | null = null): SessionState {
  const id = currentId(s);
  if (!id || answered(s)) return s;
  const results = [...s.results, { id, choice, correct: fb.correct ?? (typeof choice === "number" && choice === fb.answer), bet }];
  const out = { ...s, results, feedback: { ...s.feedback, [id]: fb } };
  return s.timed ? { ...out, i: s.i + 1, shownAt: now } : out;
}

/** The clock ran out in "מצב מבחן" and the screen recorded "לא יודעים":
 *  the same as recordAnswer with choice null. */
export const timeUp = (s: SessionState, fb: Feedback, now: number): SessionState => recordAnswer(s, null, fb, now);

/** On to the next question (after the feedback, outside "מצב מבחן"). */
export function next(s: SessionState, now: number): SessionState {
  return isOver(s) ? s : { ...s, i: s.i + 1, shownAt: now };
}

/** The feedback to show for a question, in its showing's order: right after
 *  the answer; in "מצב מבחן" only once the round is over, then every one. */
export function visibleFeedback(s: SessionState, id: string, form?: string): Feedback | null {
  const fb = s.feedback[id];
  if (!fb) return null;
  if (s.timed && !isOver(s)) return null;
  return toShown(s.orders[s.ids.indexOf(id)], fb, form);
}

/** The score of the round so far. */
export const score = (s: SessionState) => ({ right: s.results.filter((r) => r.correct).length, of: s.results.length });

/* ── On the device (spec §5.9): every access in try/catch ── */

/** sessionStorage's key of a session: the person, the session key, the size. */
export const sessionKey = (user: string, r: { s?: string; n?: string }): string => `study-session:${user}:${r.s ?? ""}|${r.n ?? "10"}`;

const isState = (x: unknown): x is SessionState => {
  const s = x as SessionState;
  return (
    !!s &&
    (s.v === 1 || s.v === 2) &&
    Array.isArray(s.ids) &&
    Array.isArray(s.orders) &&
    s.orders.length === s.ids.length &&
    Array.isArray(s.seconds) &&
    Array.isArray(s.results) &&
    typeof s.i === "number" &&
    typeof s.feedback === "object"
  );
};

export function loadSession(key: string): SessionState | null {
  try {
    const raw = sessionStorage.getItem(key);
    const s = raw ? (JSON.parse(raw) as unknown) : null;
    return isState(s) ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(key: string, s: SessionState): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(s));
  } catch {
    // without storage the session still works; a reload starts it again
  }
}

export function dropSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // nothing kept
  }
}

/** The questions this person hid from their own practice on this device ("להסתיר ממני"). */
const hiddenKey = (user: string) => `study-question-hidden:${user}`;

export function loadHidden(user: string): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(hiddenKey(user)) ?? "[]") as unknown;
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function setHidden(user: string, id: string, hide: boolean): Set<string> {
  const ids = loadHidden(user);
  if (hide) ids.add(id);
  else ids.delete(id);
  try {
    localStorage.setItem(hiddenKey(user), JSON.stringify([...ids]));
  } catch {
    // this device cannot keep it; the question is hidden for this visit only
  }
  return ids;
}

/* ── P2's "להתחיל": the next session on its key starts fresh ──
 * A session's route (?v=practice&s=…&n=…) cannot say "מצב מבחן", and a
 * reload of it resumes the saved session. So "להתחיל" leaves a one-time
 * request beside the person's sessions (study-session:<user>:start, forgotten
 * with them on sign-out, §5.9); the session screen takes it on mount: a
 * fresh session, timed or not. Without one (a reload, a link, Back), the
 * saved session resumes. */
const startKey = (user: string) => `study-session:${user}:start`;

export function requestStart(user: string, r: { s?: string; n?: string }, timed: boolean, pick?: SessionPick): void {
  try {
    sessionStorage.setItem(startKey(user), JSON.stringify({ s: r.s ?? "", n: r.n ?? "10", timed, ...(pick ? { pick } : {}) }));
  } catch {
    // without storage every session starts fresh and untimed
  }
}

const isPick = (x: unknown): x is SessionPick => {
  const p = x as SessionPick;
  return (
    !!p &&
    Array.isArray(p.sources) &&
    p.sources.every((v) => ["new", "wrong", "flagged", "all"].includes(v)) &&
    (p.parts === undefined || (Array.isArray(p.parts) && p.parts.every((n) => Number.isInteger(n)))) &&
    (p.styles === undefined || (Array.isArray(p.styles) && p.styles.every((v) => typeof v === "string")))
  );
};

/** The start request for this route, if any. It stays until dropStart(),
 *  which the screen calls once the new session is saved (React's development
 *  mode runs a screen's effects twice); a request for another route is stale
 *  and goes at once. */
export function peekStart(user: string, r: { s?: string; n?: string }): { timed: boolean; pick?: SessionPick } | null {
  try {
    const raw = sessionStorage.getItem(startKey(user));
    if (!raw) return null;
    const x = JSON.parse(raw) as { s?: unknown; n?: unknown; timed?: unknown; pick?: unknown };
    if (x.s === (r.s ?? "") && x.n === (r.n ?? "10")) return { timed: x.timed === true, ...(isPick(x.pick) ? { pick: x.pick } : {}) };
    sessionStorage.removeItem(startKey(user));
    return null;
  } catch {
    return null;
  }
}

export function dropStart(user: string): void {
  try {
    sessionStorage.removeItem(startKey(user));
  } catch {
    // nothing kept
  }
}

/** The start request for this route, once. */
export function takeStart(user: string, r: { s?: string; n?: string }): { timed: boolean; pick?: SessionPick } | null {
  const start = peekStart(user, r);
  dropStart(user);
  return start;
}

/* ── After a right answer to a mistake (review UX-2) ── */

/** What P5 says when a question that was a mistake is answered right:
 *  "tomorrow" when its last wrong answer was on this study day (it stays in
 *  "הטעויות שלי" until a right answer on a later day: "תשובה נכונה. השאלה
 *  תחזור מחר, כדי לבדוק שזה נשאר."); "cleared" when it was on an earlier day
 *  (P8's "יצאה מרשימת הטעויות"); null when it was no mistake. `day` is the
 *  study day of an instant (shared/study/day.ts, 04:00 Israel time). */
export function mistakeNote(o: { wrongAt: string | null; wrongHere: boolean; now: number; day: (ms: number) => number }): "tomorrow" | "cleared" | null {
  if (o.wrongHere) return "tomorrow";
  if (!o.wrongAt) return null;
  const at = Date.parse(o.wrongAt);
  if (!Number.isFinite(at)) return null;
  return o.day(at) === o.day(o.now) ? "tomorrow" : "cleared";
}

/** How many of a scope's questions were never answered (P7: "נשארו 5 שאלות
 *  שעוד לא תורגלו."): never in the latest answers, not answered in this
 *  session, not hidden by this person. */
export function unpracticed(o: { key: string; questions: SessionQuestion[]; latest: Latest; answered: Iterable<string>; hidden?: ReadonlySet<string> }): number {
  const scope = parseScope(o.key);
  if (!scope) return 0;
  const done = new Set(o.answered);
  let qs = o.questions.filter((q) => !o.hidden?.has(q.id) && !o.latest.has(q.id) && !done.has(q.id));
  if (scope.kind === "lecture") qs = qs.filter((q) => q.lecture_id === scope.lecture);
  // A paragraph's questions are the ones section N places on it (the caller loads exactly those).
  if (scope.kind === "paragraph") qs = qs.filter((q) => q.lecture_id === scope.lecture && q.part_idx === scope.part);
  if (scope.kind === "topic") qs = qs.filter((q) => topicKey(q.topic) === scope.topic);
  if (scope.kind === "mistakes" || scope.kind === "again" || scope.kind === "exam" || scope.kind === "quiz" || scope.kind === "mockWrong" || scope.kind === "set") return 0;
  return qs.length;
}

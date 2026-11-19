import { useEffect, useMemo, useRef, useState } from "react";
import { CLOZE, clozeFull, clozeQuestion } from "../../../shared/study/cloze";
import { studyDay } from "../../../shared/study/day";
import { cardsWord } from "../lib/clip";
import { figureUrls, getLecture, groupSpent, health, type Lecture, type LectureRow, type Section } from "../lib/api";
import {
  addCard,
  editCard,
  listCardEdits,
  listCards,
  listCardsByIds,
  revertCardEdit,
  saveCardSettings,
  type Card,
  type CardEdit,
  type CardSettings,
  type NewCard,
  type ReviewHome,
} from "../lib/cards";
import {
  type MyCard,
} from "../lib/cardsDeck";
import { estimateRound, estimateUsd } from "../lib/cardsGenerate";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isolateLatin } from "../lib/rich";
import type { Say } from "../features/types";
import { clozeWhole } from "./CardFace";
import { Sheet } from "./Shell";

/* ── The deck's sheets (design-cards §1.3 K3, K6-K9; spec §6.4 C) ──
 * Over the deck (K2), the cards of the day (K1) or a review (K4), each with
 * its own history entry (Back, ✕, Escape and the backdrop close it). */

const errText = (e: unknown) => failText(e instanceof Error ? e.message : String(e ?? ""), "cards");
const usd = (n: number) => `$${n.toFixed(2)}`;
const cap$ = (n: number) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** "לפני שעה", "אתמול", "12.11" (K7). */
export function whenText(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "עכשיו";
  if (min < 60) return min === 1 ? "לפני דקה" : `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (studyDay(t) === studyDay(now) || h < 6) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  if (studyDay(t) === studyDay(now) - 1) return "אתמול";
  return dateText(iso);
}
/** "12.11" in Israel. */
export function dateText(iso: string): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", month: "numeric", day: "numeric" }).formatToParts(new Date(iso));
  const get = (k: string) => d.find((p) => p.type === k)?.value ?? "";
  return `${get("day")}.${get("month")}`;
}

/* ─────────────── K3: writing the deck ─────────────── */

export function CardsGenerateSheet({
  lecture,
  sections,
  round,
  onClose,
  onStart,
}: {
  lecture: Pick<Lecture, "id" | "group_id" | "slides">;
  sections: Section[];
  /** 1 for the first round, more for "עוד כרטיסיות". */
  round: number;
  onClose: () => void;
  /** "ליצור": runs after the sheet has closed. */
  onStart: () => void;
}) {
  const plan = useMemo(() => estimateRound(lecture.slides, sections, round), [lecture.slides, sections, round]);
  const [money, setMoney] = useState<{ spent: number; cap: number } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([groupSpent(lecture.group_id).catch(() => null), health()])
      .then(([spent, h]) => alive && spent !== null && setMoney({ spent, cap: Number(h?.budgetUsd ?? 0) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lecture.group_id]);
  const atCap = money !== null && money.cap > 0 && money.spent >= money.cap;
  const title = round === 1 ? "יצירת כרטיסיות" : "עוד כרטיסיות";
  return (
    <Sheet label={title} className="card-sheet" onClose={onClose} head={<h2>{title}</h2>}>
      {(sheet) => (
        <>
          <p>
            {round === 1
              ? `כ-${plan.wanted} כרטיסיות מהשקפים בלבד: שאלה עם תשובה קצרה או משפט להשלמה, עובדה אחת בכל כרטיסייה, עם מספר השקף. הכרטיסיות נשמרות לכל הקבוצה.`
              : `כ-${plan.wanted} כרטיסיות נוספות, על עובדות שעוד אין עליהן כרטיסייה.`}
          </p>
          {atCap ? (
            <p className="a-error" role="alert">
              הקבוצה הגיעה לתקרת התקציב של החודש.
            </p>
          ) : (
            <p className="a-small a-muted">
              עלות משוערת: כ-{usd(estimateUsd(plan.wanted))} מהתקציב החודשי של הקבוצה.
              {money && money.cap > 0 ? ` נוצלו החודש ${usd(money.spent)} מתוך ${cap$(money.cap)}.` : ""}
            </p>
          )}
          <div className="a-row sheet-actions">
            <button className="a-btn primary" disabled={atCap || plan.wanted < 1} onClick={() => sheet.closeThen(onStart)}>
              ליצור
            </button>
            <button className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ─────────────── K6: a card, edited or added ─────────────── */

type Draft = { kind: "qa" | "cloze"; front: string; back: string; extra: string; figure: string; slides: string };
const draftOf = (c?: Pick<Card, "kind" | "front" | "back" | "extra" | "figure" | "slides">): Draft => ({
  kind: c?.kind ?? "qa",
  front: c?.front ?? "",
  back: c?.back ?? "",
  extra: c?.extra ?? "",
  figure: c?.figure ?? "",
  slides: (c?.slides ?? []).join(", "),
});
const slidesOf = (s: string): number[] =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);

/** The code study_card_problem would give, checked here first (the database checks again). */
function problem(d: Draft, lectureSlides: Set<number>): string | null {
  const front = d.front.trim();
  const slides = slidesOf(d.slides);
  if (front.length < 3 || front.length > 400) return "front length";
  if (d.back.length > 300 || d.extra.length > 500) return "too long";
  if (d.kind === "cloze" && !CLOZE.test(front)) return "bad cloze";
  if (d.kind === "qa" && (front.includes("{{") || front.includes("}}") || !d.back.trim())) return "bad answer";
  if (slides.some((n) => !Number.isInteger(n) || !lectureSlides.has(n))) return "unknown slide";
  return null;
}

/** Wraps the selection in {{ }}, after taking out any braces already there. */
export function markCloze(text: string, start: number, end: number): { text: string; caret: number } {
  const plain = text.replace(/\{\{|\}\}/g, "");
  // Positions move left by the braces removed before them.
  const shift = (i: number) => i - (text.slice(0, i).match(/\{\{|\}\}/g)?.length ?? 0) * 2;
  let a = Math.max(0, shift(start));
  let b = Math.max(a, shift(end));
  if (a === b) {
    // No selection: the word under the caret.
    while (a > 0 && /[^\s.,;:!?]/.test(plain[a - 1])) a--;
    while (b < plain.length && /[^\s.,;:!?]/.test(plain[b])) b++;
  }
  if (a === b) return { text: plain, caret: a };
  const out = `${plain.slice(0, a)}{{${plain.slice(a, b)}}}${plain.slice(b)}`;
  return { text: out, caret: b + 4 };
}

export function CardEditSheet({
  lecture,
  card,
  say,
  onClose,
  onSaved,
}: {
  lecture: Pick<Lecture, "id" | "slides">;
  /** The card to fix, or none for "הוספת כרטיסייה". */
  card?: Card;
  say: Say;
  onClose: () => void;
  /** After a save (the deck reloads by itself through Realtime as well). */
  onSaved?: (cardId: string) => void;
}) {
  const [base, setBase] = useState<Card | undefined>(card);
  const [draft, setDraft] = useState<Draft>(() => draftOf(card));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [newer, setNewer] = useState<Card | null>(null);
  const [thumb, setThumb] = useState<string | undefined>();
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const slides = useMemo(() => new Set(lecture.slides.map((s) => s.n)), [lecture.slides]);
  const edit = Boolean(card);
  const title = edit ? "עריכת כרטיסייה" : "כרטיסייה חדשה";
  const unchanged = edit && base ? JSON.stringify(draftOf(base)) === JSON.stringify(draft) : !draft.front.trim();

  // The card's picture, small, with "הסרת התמונה".
  useEffect(() => {
    const m = /^fig:(\d+)-(\d+)$/.exec(draft.figure);
    const path = m ? lecture.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path : undefined;
    if (!path) return setThumb(undefined);
    let alive = true;
    figureUrls([path])
      .then((u) => alive && setThumb(u[path]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [draft.figure, lecture.slides]);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError("");
  };

  const mark = () => {
    const el = frontRef.current;
    if (!el) return;
    const r = markCloze(draft.front, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    set({ front: r.text });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  };

  const save = async (close: () => void) => {
    const code = problem(draft, slides);
    if (code) return setError(failText(code, "cards"));
    const fields: NewCard = {
      kind: draft.kind,
      front: draft.front.trim(),
      back: draft.kind === "cloze" ? "" : draft.back.trim(),
      extra: draft.extra.trim(),
      figure: draft.figure,
      slides: slidesOf(draft.slides),
      topic: base?.topic ?? "",
      aspect: base?.aspect ?? "other",
    };
    setBusy(true);
    try {
      if (base) {
        const version = await editCard(base.id, base.version, {
          kind: fields.kind,
          front: fields.front,
          back: fields.back,
          extra: fields.extra,
          figure: fields.figure,
          slides: fields.slides,
        });
        const id = base.id;
        close();
        onSaved?.(id);
        say("התיקון נשמר לכל הקבוצה.", {
          label: "ביטול",
          run: () =>
            void listCardEdits(id)
              .then((h) => {
                const mine = h.find((e) => e.action === "edit" && e.version === version);
                if (!mine) throw new Error("nothing to revert");
                return revertCardEdit(mine.id);
              })
              .catch((e) => say(errText(e))),
        });
      } else {
        const id = await addCard(lecture.id, fields);
        close();
        onSaved?.(id);
      }
    } catch (e) {
      const c = e instanceof Error ? e.message : "";
      setError(errText(e));
      if (c === "card deleted") setGone(true);
      if (c === "conflict" && base) {
        // Someone saved first: show their version, keep this draft in the fields, edit on top of theirs.
        const [latest] = await listCardsByIds([base.id]).catch(() => [] as Card[]);
        if (latest) {
          setBase(latest);
          setNewer(latest);
          if (latest.deleted_at) setGone(true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label={title} className="card-sheet" onClose={onClose} head={<h2>{title}</h2>}>
      {(sheet) => (
        <>
          {edit ? (
            <>
              <p className="note-line">התיקון יופיע לכל הקבוצה, וגם בייצוא הבא ל-Anki. אפשר לבטל אותו מההיסטוריה.</p>
              <p className="note-line a-small a-muted">שינוי של העובדה עצמה: עדיף למחוק ולהוסיף כרטיסייה חדשה.</p>
            </>
          ) : (
            <p className="note-line a-muted">כרטיסייה שנוספת ידנית מסומנת בשם מי שהוסיף אותה.</p>
          )}
          {newer ? (
            <div className="a-callout warn newer" role="status">
              <b>{newer.kind === "cloze" ? clozeWhole(newer.front, "nw") : isolateLatin(newer.front, "nf")}</b>
              {newer.kind === "qa" ? <p>{isolateLatin(newer.back, "nb")}</p> : null}
            </div>
          ) : null}
          <div className="a-seg card-kind" role="radiogroup" aria-label="סוג הכרטיסייה">
            <button type="button" className="a-btn small" role="radio" aria-checked={draft.kind === "qa"} onClick={() => set({ kind: "qa", front: draft.front.replace(/\{\{|\}\}/g, "") })}>
              שאלה ותשובה
            </button>
            <button type="button" className="a-btn small" role="radio" aria-checked={draft.kind === "cloze"} onClick={() => set({ kind: "cloze" })}>
              השלמה
            </button>
          </div>
          {draft.kind === "qa" ? (
            <>
              <label className="a-field">
                שאלה
                <textarea className="a-input" ref={frontRef} dir="auto" value={draft.front} maxLength={400} onChange={(e) => set({ front: e.target.value })} />
              </label>
              <label className="a-field">
                <span>
                  תשובה <small>עד כ-15 מילים</small>
                </span>
                <input className="a-input" dir="auto" value={draft.back} maxLength={300} onChange={(e) => set({ back: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label className="a-field">
                משפט
                <textarea className="a-input" ref={frontRef} dir="auto" value={draft.front} maxLength={400} onChange={(e) => set({ front: e.target.value })} />
              </label>
              <div className="a-row">
                <button type="button" className="a-btn small" onMouseDown={(e) => e.preventDefault()} onClick={mark}>
                  סימון החלק להשלמה
                </button>
              </div>
              <p className="a-callout quiet preview" dir="rtl">
                תצוגה: {isolateLatin(clozeQuestion(draft.front), "pv")}
              </p>
            </>
          )}
          <label className="a-field">
            הסבר (לא חובה)
            <input className="a-input" dir="auto" value={draft.extra} maxLength={500} onChange={(e) => set({ extra: e.target.value })} />
          </label>
          <label className="a-field">
            שקפים
            <input className="a-input" inputMode="numeric" dir="ltr" value={draft.slides} placeholder="12, 14" onChange={(e) => set({ slides: e.target.value })} />
          </label>
          {draft.figure ? (
            <div className="a-row thumb">
              {thumb ? <img src={thumb} alt="" /> : null}
              <button type="button" className="a-btn small" onClick={() => set({ figure: "" })}>
                הסרת התמונה
              </button>
            </div>
          ) : null}
          {error ? (
            <p className="a-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="a-row sheet-actions">
            <button className="a-btn primary" disabled={busy || gone || unchanged} onClick={() => void save(sheet.close)}>
              שמירה
            </button>
            <button className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ─────────────── K7: a card's history ─────────────── */

const ACTION: Record<CardEdit["action"], string> = { edit: "תיקון", delete: "מחיקה", restore: "שחזור", revert: "החזרת גרסה" };

function versionText(v: CardEdit["before"], key: string) {
  if (!v || !v.front) return null;
  return (
    <>
      {v.kind === "cloze" ? clozeWhole(v.front, `${key}c`) : isolateLatin(v.front, `${key}f`)}
      {v.kind !== "cloze" && v.back ? <> · {isolateLatin(v.back, `${key}b`)}</> : null}
    </>
  );
}

export function CardHistorySheet({ card, nameOf, say, onClose }: { card: Card; nameOf: (id: string) => string; say: Say; onClose: () => void }) {
  const [edits, setEdits] = useState<CardEdit[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    listCardEdits(card.id)
      .then(setEdits)
      .catch((e) => setError(errText(e)));
  useEffect(() => {
    void load();
    // Once per card.
  }, [card.id]);
  const revert = async (e: CardEdit) => {
    try {
      await revertCardEdit(e.id);
      await load();
    } catch (err) {
      say(errText(err));
    }
  };
  const who = (id: string | null) => (id && nameOf(id)) || "ללא שם";
  return (
    <Sheet label="היסטוריית הכרטיסייה" className="card-sheet" onClose={onClose} head={<h2>היסטוריית הכרטיסייה</h2>}>
      {error ? <p className="a-error">{error}</p> : null}
      {edits === null && !error ? <p className="a-muted">טוען…</p> : null}
      <ul className="a-list history-list">
        {(edits ?? []).map((e) => (
          <li key={e.id} className="a-li">
            <div>
              <b>
                {ACTION[e.action]} · {who(e.edited_by)} · {whenText(e.edited_at)}
              </b>
              {e.action === "edit" || e.action === "revert" ? (
                <>
                  <p className="before">
                    <span className="a-muted">לפני: </span>
                    {versionText(e.before, `b${e.id}`)}
                  </p>
                  <p>
                    <span className="a-muted">אחרי: </span>
                    {versionText(e.after, `a${e.id}`)}
                  </p>
                  <div className="a-row">
                    <button className="a-btn small" onClick={() => void revert(e)}>
                      החזרה לגרסה הקודמת
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </li>
        ))}
        <li className="a-li">
          <span className="a-muted">
            {card.source === "member" ? `נוספה ע״י ${who(card.created_by)} ב-${dateText(card.created_at)}` : `נכתבה מהשקפים ב-${dateText(card.created_at)}`}
          </span>
        </li>
      </ul>
    </Sheet>
  );
}

/* ─────────────── K8: export to Anki ─────────────── */

const SEEN_KEY_PREFIX = "study-anki-exported:";
function exportedBefore(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(SEEN_KEY_PREFIX)) return true;
  } catch {
    /* private mode */
  }
  return false;
}

type Scope = "mine" | "lecture" | "course" | "all";
type Loaded = { lectures: Array<{ row: LectureRow; lecture: Lecture | null; cards: Card[]; mine?: MyCard[] }>; count: number; bytes: number };

export function AnkiExportSheet({
  groupId,
  lectures,
  lectureId,
  counts,
  preloaded,
  mine,
  say,
  onClose,
}: {
  groupId: string;
  /** The group's lectures (library order). */
  lectures: LectureRow[];
  /** Opened from a lecture's deck: "ההרצאה הזו" is offered and chosen. */
  lectureId?: string;
  /** Active cards per lecture. */
  counts: Record<string, number>;
  /** The deck's own lecture and cards, already loaded. */
  preloaded?: { lecture: Lecture; cards: Card[] };
  /** C's end: from a lecture's deck, the member's own deck of it (the parts
   *  she added, the trap cards, her own cards) and her private cards of it,
   *  offered first as "החפיסה שלך". */
  mine?: { inDeck: (c: Card) => boolean; count: number; cards: MyCard[] };
  say: Say;
  onClose: () => void;
}) {
  const here = lectures.find((l) => l.id === lectureId);
  const course = here?.course.trim() ?? "";
  const ownCount = mine ? mine.count + mine.cards.length : 0;
  const [scope, setScope] = useState<Scope>(here ? (ownCount > 0 ? "mine" : "lecture") : "all");
  const [pictures, setPictures] = useState(true);
  const [format, setFormat] = useState<"apkg" | "text">("apkg");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useMemo(() => !exportedBefore(), []);

  const inScope = useMemo(
    () =>
      lectures
        .filter((l) => (scope === "lecture" || scope === "mine" ? l.id === lectureId : scope === "course" ? l.course.trim() === course : true))
        .filter((l) => (counts[l.id] ?? 0) > 0 || (scope === "mine" && ownCount > 0)),
    [lectures, scope, lectureId, course, counts, ownCount],
  );
  const total = (ls: LectureRow[]) => ls.reduce((n, l) => n + (counts[l.id] ?? 0), 0);

  // The scope's cards and pictures, read once the scope is chosen (deleted cards included: exportable() decides).
  useEffect(() => {
    let alive = true;
    setLoaded(null);
    Promise.all(
      inScope.map(async (row) => {
        if (preloaded && preloaded.lecture.id === row.id) return { row, lecture: preloaded.lecture, cards: preloaded.cards };
        const [lecture, cards] = await Promise.all([getLecture(row.id).catch(() => null), listCards(row.id)]);
        return { row, lecture, cards };
      }),
    )
      .then((all) => {
        if (!alive) return;
        // "החפיסה שלך": only her deck's cards, and her private cards in their own deck.
        const ls: Loaded["lectures"] = scope === "mine" && mine ? all.map((l) => ({ ...l, cards: l.cards.filter(mine.inDeck), mine: mine.cards })) : all;
        let bytes = 0;
        const seen = new Set<string>();
        for (const l of ls)
          for (const c of l.cards) {
            const m = /^fig:(\d+)-(\d+)$/.exec(c.figure);
            if (!m || c.deleted_at || seen.has(`${l.row.id}:${c.figure}`)) continue;
            seen.add(`${l.row.id}:${c.figure}`);
            const f = l.lecture?.slides.find((s) => s.n === Number(m[1]))?.figures?.find((x) => x.k === Number(m[2]));
            if (f) bytes += Math.max(20_000, f.w * f.h * 0.12);
          }
        setLoaded({ lectures: ls, count: ls.reduce((n, l) => n + l.cards.filter((c) => !c.deleted_at).length + (l.mine?.length ?? 0), 0), bytes });
      })
      .catch((e) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, [inScope, preloaded, scope, mine]);

  const run = async (close: () => void) => {
    if (!loaded) return;
    setBusy(true);
    setError("");
    try {
      const paths: string[] = [];
      const lectures = loaded.lectures.map(({ row, lecture, cards, mine: own }) => {
        const figures = (fig: string) => {
          const m = /^fig:(\d+)-(\d+)$/.exec(fig);
          return (m && lecture?.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path) || null;
        };
        if (pictures) for (const c of cards) if (c.figure && !c.deleted_at) paths.push(figures(c.figure) ?? "");
        const privateRows = (own ?? []).map((m) => ({ id: m.id, lecture_id: m.lecture_id, kind: "qa" as const, front: m.front, back: m.back, extra: m.extra, figure: "", slides: m.slides, topic: "", aspect: "other", created_at: m.created_at, updated_at: m.created_at, deleted_at: m.deleted_at }));
        return { id: row.id, title: row.title, course: row.course, figures, cards, ...(own ? { mine: privateRows } : {}) };
      });
      const urls = pictures ? await figureUrls([...new Set(paths.filter(Boolean))]).catch(() => ({}) as Record<string, string>) : {};
      const { exportAnki, withAssociations } = await import("../lib/anki");
      // J-2: the wall's association on each card goes into its Extra (W-24).
      if (flags.wall) {
        const { getForCards } = await import("../lib/wall");
        for (const l of lectures) {
          const aids = await getForCards(l.id).catch(() => []);
          if (aids.length) l.cards = withAssociations(l.cards, aids);
        }
      }
      const r = await exportAnki({
        groupId,
        lectures,
        pictures,
        format,
        fetchPicture: async (path) => {
          const u = urls[path];
          if (!u) return null;
          const res = await fetch(u);
          return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        },
      });
      // The share sheet closed without sharing: the sheet stays, and nothing says the file is ready.
      if (r.via === "cancelled") return;
      close();
      say("הקובץ מוכן. פותחים אותו באפליקציית Anki.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const mb = loaded ? Math.max(0.1, Math.round(loaded.bytes / 100_000) / 10) : 0;
  return (
    <Sheet label="ייצוא ל-Anki" className="card-sheet" onClose={onClose} head={<h2>ייצוא ל-Anki</h2>}>
      {(sheet) => (
        <>
          <fieldset className="choice-list">
            <legend>מה לייצא</legend>
            {here && mine && ownCount > 0 ? (
              <label className="a-choice">
                <input type="radio" name="scope" checked={scope === "mine"} onChange={() => setScope("mine")} />
                <span>
                  {`החפיסה שלך (${cardsWord(ownCount)}${mine.cards.length ? `, מהם ${mine.cards.length} מהטעויות שלך` : ""})`}
                </span>
              </label>
            ) : null}
            {here ? (
              <label className="a-choice">
                <input type="radio" name="scope" checked={scope === "lecture"} onChange={() => setScope("lecture")} />
                <span>{mine ? `כל החפיסה (${cardsWord(counts[here.id] ?? 0)})` : `ההרצאה הזו (${cardsWord(counts[here.id] ?? 0)})`}</span>
              </label>
            ) : null}
            {here && course ? (
              <label className="a-choice">
                <input type="radio" name="scope" checked={scope === "course"} onChange={() => setScope("course")} />
                <span>
                  כל ההרצאות בקורס <bdi>{course}</bdi> ({total(lectures.filter((l) => l.course.trim() === course))})
                </span>
              </label>
            ) : null}
            <label className="a-choice">
              <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
              <span>כל ההרצאות ({total(lectures)})</span>
            </label>
          </fieldset>
          <label className="a-choice">
            <input type="checkbox" checked={pictures} onChange={(e) => setPictures(e.target.checked)} />
            <span>
              לכלול תמונות מהשקפים {loaded && loaded.bytes > 0 ? <small>כ-{mb}MB</small> : null}
            </span>
          </label>
          <fieldset className="choice-list">
            <legend>אפשרויות</legend>
            <label className="a-choice">
              <input type="radio" name="format" checked={format === "apkg"} onChange={() => setFormat("apkg")} />
              <span>חבילת Anki (מומלץ)</span>
            </label>
            <label className="a-choice">
              <input type="radio" name="format" checked={format === "text"} onChange={() => setFormat("text")} />
              <span>קובץ טקסט</span>
            </label>
          </fieldset>
          <details className="howto" open={first}>
            <summary>איך מייבאים?</summary>
            <ul>
              <li>פותחים את הקובץ באפליקציית Anki: AnkiMobile או AnkiDroid בטלפון, Anki במחשב.</li>
              <li>באייפון פותחים את הקובץ באפליקציה AnkiMobile (בתשלום), או ב-Anki במחשב.</li>
              <li>ההגדרות של Anki כבר נכונות: ״עדכן רשומות: אם חדש יותר״. ייצוא חוזר מעדכן כרטיסיות שתוקנו בקבוצה ושומר את ההתקדמות שכבר יש ב-Anki.</li>
              <li>כרטיסיות שנמחקו בקבוצה מגיעות עם התגית tamtzit::נמחק, ואפשר למחוק אותן ב-Anki.</li>
              <li>AnkiWeb (האתר) לא מייבא חבילות: מייבאים באפליקציה.</li>
            </ul>
          </details>
          {error ? (
            <p className="a-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="a-row sheet-actions">
            <button className="a-btn primary" disabled={busy || !loaded || loaded.count === 0} onClick={() => void run(sheet.close)}>
              {busy ? "מכינים את החבילה…" : "ייצוא"}
            </button>
            <button className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ─────────────── K9: settings ─────────────── */

export function CardSettingsSheet({ settings, onChange, say, onClose }: { settings: CardSettings; onChange: (s: CardSettings) => void; say: Say; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const change = (next: CardSettings) => {
    setS(next);
    onChange(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveCardSettings(next).catch((e) => say(errText(e))), 400);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const RET: Array<[number, string]> = [
    [0.85, "85% · פחות חזרות"],
    [0.9, "90% · מומלץ"],
    [0.95, "95% · לפני מבחן, הרבה יותר חזרות"],
  ];
  return (
    <Sheet label="הגדרות כרטיסיות" className="card-sheet" onClose={onClose} head={<h2>הגדרות כרטיסיות</h2>}>
      <p className="a-muted">ההגדרות שלך בלבד, בכל המכשירים.</p>
      <div className="a-field">
        <span>חדשות ביום</span>
        <div className="stepper">
          <button className="a-btn" aria-label="פחות חדשות ביום" disabled={s.new_per_day <= 0} onClick={() => change({ ...s, new_per_day: Math.max(0, s.new_per_day - 5) })}>
            −
          </button>
          <output aria-live="polite">{s.new_per_day}</output>
          <button className="a-btn" aria-label="יותר חדשות ביום" disabled={s.new_per_day >= 100} onClick={() => change({ ...s, new_per_day: Math.min(100, s.new_per_day + 5) })}>
            +
          </button>
        </div>
        <small>כמה כרטיסיות חדשות מוצגות בכל יום, בכל ההרצאות יחד.</small>
      </div>
      <fieldset className="choice-list">
        <legend>רמת זכירה</legend>
        {RET.map(([v, label]) => (
          <label key={v} className="a-choice">
            <input type="radio" name="retention" checked={Math.abs(s.retention - v) < 0.001} onChange={() => change({ ...s, retention: v })} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <p className="a-small a-muted">הסיכוי לזכור כרטיסייה כשהיא חוזרת. רמה גבוהה יותר מקצרת את המרווחים.</p>
      <fieldset className="choice-list">
        <legend>איפה חוזרים</legend>
        {HOMES.map(([v, label]) => (
          <label key={v} className="a-choice">
            <input type="radio" name="home" checked={s.home === v} onChange={() => change({ ...s, home: v })} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </Sheet>
  );
}

/* ─────────────── C6: one review home (C's end) ─────────────── */

const HOMES: Array<[ReviewHome, string]> = [
  ["app", "באפליקציה: לוח החזרות שלך כאן, בקצב שלך"],
  ["anki", "ב-Anki: מייצאים וחוזרים שם; כאן לא יופיעו כרטיסים לחזרה"],
];
const HOME_ASKED = "study-cards-home-asked";

/** Whether to ask once where the member reviews: review is on, her settings
 *  are loaded (`ready`) and say nothing yet, and this device has not asked.
 *  Closing the sheet without choosing counts as asked; the choice can be
 *  changed any time in "הגדרות". */
export function useHomeAsk(settings: CardSettings, ready: boolean): { open: boolean; close: () => void } {
  const [asked, setAsked] = useState(() => {
    try {
      return localStorage.getItem(HOME_ASKED) === "1";
    } catch {
      return false;
    }
  });
  const close = () => {
    setAsked(true);
    try {
      localStorage.setItem(HOME_ASKED, "1");
    } catch {
      /* private mode: asked again next time */
    }
  };
  return { open: ready && !asked && !settings.home, close };
}

export function ReviewHomeSheet({ settings, onSaved, onClose, say }: { settings: CardSettings; onSaved: (s: CardSettings) => void; onClose: () => void; say: Say }) {
  const [home, setHome] = useState<ReviewHome>(settings.home ?? "app");
  const [busy, setBusy] = useState(false);
  const save = async (close: () => void) => {
    setBusy(true);
    try {
      const next = { ...settings, home };
      await saveCardSettings(next);
      onSaved(next);
      close();
    } catch (e) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet label="איפה חוזרים על הכרטיסים?" className="card-sheet home-sheet" onClose={onClose} head={<h2>איפה חוזרים על הכרטיסים?</h2>}>
      {(sheet) => (
        <>
          <p className="a-para a-muted">בית אחד לחזרות, כדי שלא יהיו שני לוחות שמושכים לשני כיוונים. אפשר לשנות בכל רגע ב״הגדרות״.</p>
          <fieldset className="choice-list">
            <legend className="sr-only">איפה חוזרים</legend>
            {HOMES.map(([v, label]) => (
              <label key={v} className="a-choice">
                <input type="radio" name="home-once" checked={home === v} onChange={() => setHome(v)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="a-row sheet-actions">
            <button className="a-btn primary" disabled={busy} onClick={() => void save(sheet.close)}>
              שמירה
            </button>
            <button className="a-btn ghost" onClick={sheet.close}>
              אחר כך
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** The whole sentence of a cloze as text (for an aria-label). */
export const clozeText = (front: string) => clozeFull(front);

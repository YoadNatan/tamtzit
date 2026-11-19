import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { studyDay } from "../../../shared/study/day";
import { cardsWord } from "../lib/clip";
import { figureUrls, getLecture, getSections, listLectures, type Lecture, type LectureRow, type Section } from "../lib/api";
import { deckName } from "../lib/anki";
import {
  DEFAULT_SETTINGS,
  deleteCard,
  hideCard,
  listCardBatches,
  listCards,
  listGroupCardsLite,
  loadCardSettings,
  myStates,
  resetLecture,
  revertCardEdit,
  watchCards,
  type Card,
  type CardBatch,
  type CardEdit,
} from "../lib/cards";
import {
  adoptParts,
  cardStillTrue,
  latestCardEdit,
  listMyCards,
  myCardState,
  myDeck,
  type DeckPart,
  type MyCard,
} from "../lib/cardsDeck";
import { claimable, generateDeck, onCardWritten, retryParts, roundKey, useInFlight, useWritingHere } from "../lib/cardsGenerate";
import { waitingReviews, withWaiting } from "../lib/cardsOutbox";
import { buildQueue, deckCards, inMyDeck, partKey, type QState } from "../lib/cardsQueue";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isolateLatin } from "../lib/rich";
import { KEEP_SCREEN_ON, useRound } from "../lib/rounds";
import type { Ctx } from "../features/types";
import CardFace, { byLine, frontText } from "./CardFace";
import { AnkiExportSheet, CardEditSheet, CardHistorySheet, CardsGenerateSheet, whenText } from "./CardSheets";
import CardSource from "./CardSource";
import { Icon } from "./Icon";
import { Avatar, BackLink, Head, RouteLink } from "./Shell";

const SlideSheet = lazy(() => import("./SlideSheet"));
const CardBrowse = lazy(() => import("./CardBrowse"));

/* ── K2: a lecture's deck (?v=cards&l=<id>; design-cards §1.3) ──
 * Writing the deck (K3) and its progress, part by part, live on every phone;
 * the cards grouped under their part, each opening to its answer and to
 * "עריכה", "היסטוריה", "להסתיר ממני" and "מחיקה לכל הקבוצה"; the deleted
 * ones under "נמחקו"; export, "עיון בכרטיסיות", and, with review on, the
 * member's own numbers and "לחזור על ההרצאה".
 *
 * C's end, as the approved deck page has it (cards.html s3): "{n} כרטיסים ·
 * {k} חלקים · נוצרו פעם אחת לכל הקבוצה"; the ring of the member's own deck
 * ("בחפיסה שלך: 20 כרטיסים", decision 8); a row per part with "להוסיף" or
 * "{x} בחפיסה ✓" (a tap on its name opens its cards), "להוסיף את כל
 * החלקים" and "להוציא מהחפיסה שלי"; the group's latest fix ("תוקן לכולם",
 * with "לבטל"); the deck's name in Anki; and the export in the bottom bar,
 * of her deck first ("החפיסה שלך"), the whole deck second. A card a
 * correction marked says so, with "עדיין נכון"; an open card shows "מאיפה
 * זה?" with its paragraph. */

/** "כרטיס אחד", "7 כרטיסים". */

/** Parts shown before "ועוד N חלקים" (the approved page shows five). */
const PARTS_SHOWN = 5;

type Sheet =
  | { kind: "generate"; round: number }
  | { kind: "edit"; card: Card }
  | { kind: "add" }
  | { kind: "history"; card: Card }
  | { kind: "export" }
  | { kind: "browse" }
  | null;

const MAX_ACTIVE = 150;
const errText = (e: unknown) => failText(e instanceof Error ? e.message : String(e ?? ""), "cards");

/** The time, read again every `ms` while `ms` is above 0: a part's six
 *  minutes can pass with nothing else that re-renders the deck. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ms) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function LectureCards({ lectureId, ctx }: { lectureId: string; ctx: Ctx }) {
  const review = flags.cardsReview;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [batches, setBatches] = useState<CardBatch[]>([]);
  const [states, setStates] = useState<Map<string, QState>>(new Map());
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [figures, setFigures] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [slide, setSlide] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [groupCounts, setGroupCounts] = useState<Record<string, number> | null>(null);
  const [deck, setDeck] = useState<DeckPart[] | null>(null);
  const [openParts, setOpenParts] = useState<Set<string>>(new Set());
  const [allParts, setAllParts] = useState(false);
  const [mine, setMine] = useState<MyCard[]>([]);
  const [newPerDay, setNewPerDay] = useState(DEFAULT_SETTINGS.new_per_day);
  const [fix, setFix] = useState<CardEdit | null>(null);
  const round = useRound(roundKey(lectureId));
  const here = useWritingHere(lectureId);
  const flying = useInFlight(lectureId);

  const loadDeck = useCallback(async () => {
    const [cs, bs, parts] = await Promise.all([listCards(lectureId), listCardBatches(lectureId), myDeck(lectureId).catch(() => null)]);
    setCards(cs);
    setBatches(bs);
    if (parts) setDeck(parts);
    // The group's latest fix (C's end): an extra, so a failure only hides it.
    void latestCardEdit(cs.filter((c) => !c.deleted_at).map((c) => c.id))
      .then(setFix)
      .catch(() => undefined);
    if (review) {
      const st = await myStates(cs.map((c) => c.id)).catch(() => null);
      if (st) setStates(withWaiting(st, waitingReviews(ctx.userId)));
    }
  }, [lectureId, review, ctx.userId]);

  useEffect(() => {
    let alive = true;
    Promise.all([getLecture(lectureId), getSections(lectureId).catch(() => [] as Section[])])
      .then(([l, s]) => {
        if (!alive) return;
        if (!l || l.deleted_at) return setError(failText("lecture not found", "cards"));
        setLecture(l);
        setSections(s);
      })
      .catch((e) => alive && setError(errText(e)));
    loadDeck().catch((e) => alive && setError(errText(e)));
    listLectures(ctx.group.id)
      .then((ls) => alive && setLectures(ls))
      .catch(() => undefined);
    // Her private cards of the lecture and her day's limit, with in-app review (C's end).
    if (review) {
      listMyCards()
        .then((ms) => alive && setMine(ms.filter((m) => m.lecture_id === lectureId)))
        .catch(() => undefined);
      loadCardSettings()
        .then((s) => alive && setNewPerDay(s.new_per_day))
        .catch(() => undefined);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchCards({ lectureId }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void loadDeck().catch(() => undefined), 300);
    });
    // This phone's own stream: a card shows the moment it is saved.
    const off = onCardWritten(lectureId, (c) =>
      setCards((cur) =>
        cur && !cur.some((x) => x.id === c.id)
          ? [
              ...cur,
              {
                ...c,
                group_id: ctx.group.id,
                lecture_id: lectureId,
                batch_id: null,
                source: "ai",
                created_by: ctx.userId,
                created_at: new Date().toISOString(),
                updated_by: null,
                updated_at: new Date().toISOString(),
                deleted_at: null,
                deleted_by: null,
                anchor: c.para ?? null,
                quote: c.quote ?? "",
              },
            ]
          : cur,
      ),
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
      off();
    };
  }, [lectureId, loadDeck, ctx.group.id, ctx.userId]);

  // The pictures the cards use, signed once.
  const figPaths = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of cards ?? []) {
      const m = /^fig:(\d+)-(\d+)$/.exec(c.figure);
      const path = m ? lecture?.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path : undefined;
      if (path) out[c.figure] = path;
    }
    return out;
  }, [cards, lecture]);
  useEffect(() => {
    const paths = [...new Set(Object.values(figPaths))].filter((p) => !figures[p]);
    if (!paths.length) return;
    let alive = true;
    figureUrls(paths)
      .then((u) => alive && setFigures((f) => ({ ...f, ...u })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [figPaths, figures]);
  const figureUrl = (fig: string) => (figPaths[fig] ? figures[figPaths[fig]] : undefined);

  const active = useMemo(() => (cards ?? []).filter((c) => !c.deleted_at), [cards]);
  const deleted = useMemo(() => (cards ?? []).filter((c) => c.deleted_at), [cards]);
  const latest = batches.reduce((r, b) => Math.max(r, b.round), 0);
  const roundParts = batches.filter((b) => b.round === latest);
  const openRound = roundParts.some((b) => b.status === "pending" || b.status === "writing") || Boolean(round?.running);
  const failedParts = roundParts.filter((b) => b.status === "failed");
  // A round that stopped before all its parts started (a fatal code ended it,
  // or the phone running it closed the tab) keeps them "pending" for good, and
  // they have no control of their own (review finding STUCK-ROUND). When
  // nothing runs on this phone and no part is being written anywhere (a part
  // "writing" for six minutes no longer counts), one "לנסות שוב" under the bar
  // goes on with the round: generateDeck joins the open round and writes every
  // part that may be written, the pending ones included.
  const tick = useNow(openRound ? 30_000 : 0);
  const stalled =
    !round?.running &&
    flying.size === 0 &&
    roundParts.some((b) => b.status === "pending" && claimable(b, tick)) &&
    !roundParts.some((b) => b.status === "writing" && !claimable(b, tick));
  const madeSoFar = roundParts.reduce((n, b) => n + b.made, 0);
  const wantedAll = roundParts.reduce((n, b) => n + b.wanted, 0);
  const heading = (idx: number | null) => {
    if (idx === null) return "בלי חלק";
    const s = sections.find((x) => x.idx === idx);
    if (s?.title) return s.title;
    const b = batches.find((x) => x.part_idx === idx && x.heading);
    if (b) return b.heading;
    const any = batches.find((x) => x.part_idx === idx);
    return any ? `ש׳ ${any.slide_from}-${any.slide_to}` : "בלי חלק";
  };

  const now = Date.now();
  const adopted = useMemo(() => new Set((deck ?? []).filter((p) => p.in_deck).map((p) => partKey(lectureId, p.part_idx))), [deck, lectureId]);
  const inDeck = useCallback((c: Card) => inMyDeck(c, adopted, ctx.userId), [adopted, ctx.userId]);
  const deckOfMine = useMemo(() => active.filter(inDeck), [active, inDeck]);
  const numbers = useMemo(() => {
    if (!review) return null;
    const qcards = deckCards({ cards: active, lectureOrder: new Map([[lectureId, 0]]), adopted, userId: ctx.userId, mine });
    const st = new Map(states);
    for (const m of mine) st.set(m.id, myCardState(m));
    const q = buildQueue({ cards: qcards, states: st, now, newLeft: 1e9 });
    let learning = 0;
    for (const c of active) {
      const s = states.get(c.id);
      if (s && !s.suspended && (s.state === 1 || s.state === 3)) learning += 1;
    }
    return { due: q.counts.learning + q.counts.review, fresh: q.counts.fresh, learning };
    // now changes every render; the numbers follow the cards and states.
  }, [review, active, states, lectureId, adopted, ctx.userId, mine]);

  const start = () => {
    void generateDeck(lectureId)
      .then((r) => {
        if (r.error) ctx.say(failText(r.error, "cards"));
      })
      .catch((e) => ctx.say(errText(e)));
  };
  const retry = (b: CardBatch) => {
    void retryParts(lectureId, [b.id])
      .then((r) => r.error && ctx.say(failText(r.error, "cards")))
      .catch((e) => ctx.say(errText(e)));
  };
  const remove = async (c: Card) => {
    try {
      await deleteCard(c.id, true);
      setCards((cur) => cur?.map((x) => (x.id === c.id ? { ...x, deleted_at: new Date().toISOString(), deleted_by: ctx.userId } : x)) ?? cur);
      setOpen(null);
      ctx.say("הכרטיסייה נמחקה לכל הקבוצה.", { label: "ביטול", run: () => void restore(c) });
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const restore = async (c: Card) => {
    try {
      await deleteCard(c.id, false);
      setCards((cur) => cur?.map((x) => (x.id === c.id ? { ...x, deleted_at: null, deleted_by: null } : x)) ?? cur);
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const hide = async (c: Card, h: boolean) => {
    try {
      await hideCard(c.id, h);
      setStates((cur) => {
        const next = new Map(cur);
        const s = next.get(c.id);
        next.set(c.id, s ? { ...s, suspended: h } : { state: 0, step: 0, stability: 0, difficulty: 0, due: 0, lastReview: null, reps: 0, lapses: 0, suspended: h });
        return next;
      });
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const reset = async () => {
    setConfirmReset(false);
    try {
      await resetLecture(lectureId);
      await loadDeck();
    } catch (e) {
      ctx.say(errText(e));
    }
  };

  const stateChip = (c: Card) => {
    if (!review) return null;
    const s = states.get(c.id);
    if (s?.suspended) return <span className="a-chip">מוסתרת אצלך</span>;
    if (!s || s.state === 0) return <span className="a-chip busy">חדשה</span>;
    if (s.state === 1 || s.state === 3) return <span className="a-chip warn">בלמידה</span>;
    const days = studyDay(s.due) - studyDay(now);
    return <span className="a-chip ok">{days <= 0 ? "לחזרה היום" : days === 1 ? "בעוד יום" : `בעוד ${days} ימים`}</span>;
  };

  // The deck page's parts (C's end): the lecture's parts from study_my_deck, and
  // the cards on no part ("בלי חלק") or on a part it does not name.
  const byPart = useMemo(() => {
    const map = new Map<string, Card[]>();
    const named = new Set((deck ?? []).map((p) => String(p.part_idx)));
    for (const c of active) {
      const k = c.part_idx !== null && named.has(String(c.part_idx)) ? String(c.part_idx) : "none";
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return map;
  }, [active, deck]);
  const loose = byPart.get("none") ?? [];
  const parts = deck ?? [];
  const shownParts = allParts || parts.length <= PARTS_SHOWN + 1 ? parts : parts.slice(0, PARTS_SHOWN);
  const hiddenParts = parts.slice(shownParts.length);
  const inDeckParts = parts.filter((p) => p.in_deck);
  const toggle = (k: string) =>
    setOpenParts((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const adopt = async (list: number[] | null, on: boolean) => {
    try {
      await adoptParts(lectureId, list, on);
      setDeck(await myDeck(lectureId));
      if (!on) ctx.say("החלקים הוצאו מהחפיסה שלך. הכרטיסים שכבר למדת נשארים בלוח שלך.", { label: "ביטול", run: () => void adopt(list ?? inDeckParts.map((p) => p.part_idx), true) });
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const stillTrue = async (c: Card) => {
    try {
      await cardStillTrue(c.id);
      setCards((cur) => cur?.map((x) => (x.id === c.id ? { ...x, stale_at: null, checked_by: ctx.userId, checked_at: new Date().toISOString() } : x)) ?? cur);
      ctx.say("סומן כנכון. הכרטיס חוזר לחזרות.");
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const fixCard = fix ? active.find((c) => c.id === fix.card_id && c.version === fix.version) : undefined;
  const recentFix = fix && fixCard && Date.now() - Date.parse(fix.edited_at) < 7 * 86_400_000 ? fix : null;
  const undoFix = async (edit: CardEdit) => {
    try {
      await revertCardEdit(edit.id);
      await loadDeck();
      ctx.say("התיקון בוטל לכל הקבוצה.");
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const deckPct = active.length ? Math.round((100 * deckOfMine.length) / active.length) : 0;

  /** A part's cards, as the deck lists them (its row open). */
  const cardList = (list: Card[]) => (
    <ul className="card-list part-cards">
      {list.map((c) => {
        const expanded = open === c.id;
        const s = states.get(c.id);
        const by = byLine(c, ctx.nameOf);
        return (
          <li key={c.id} className={`card-row${s?.suspended ? " hidden-mine" : ""}`} data-card={c.id}>
            <button type="button" className="card-row-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>
              <span className="front" dir="rtl">
                {frontText(c, `r${c.id}`)}
              </span>
              <span className="a-wrap card-chips">
                {c.source === "trap" ? <span className="a-chip warn">טעות נפוצה בקבוצה</span> : null}
                {c.stale_at ? <span className="a-chip warn">בבדיקה אחרי תיקון בפסקה</span> : null}
                {c.kind === "cloze" ? <span className="a-chip">השלמה</span> : null}
                {c.slides.length ? (
                  <span className="a-chip">
                    ש׳ <bdi dir="ltr">{c.slides.join(", ")}</bdi>
                  </span>
                ) : null}
                {by ? <span className="a-chip">{by}</span> : null}
                {stateChip(c)}
              </span>
            </button>
            {expanded ? (
              <div className="card-row-body">
                <CardFace card={c} revealed showChip={false} figureUrl={figureUrl} nameOf={ctx.nameOf} onSlide={setSlide} go={ctx.go} />
                {c.stale_at ? (
                  <div className="a-callout warn stale-line">
                    <span>הפסקה של הכרטיס הזה תוקנה. כדאי לבדוק שהוא עדיין נכון; עד אז הוא לא מופיע בחזרות.</span>
                    <div className="a-row">
                      <button className="a-btn small" onClick={() => void stillTrue(c)}>
                        עדיין נכון
                      </button>
                    </div>
                  </div>
                ) : null}
                <CardSource card={c} go={ctx.go} />
                <div className="a-wrap card-row-actions">
                  <button className="a-btn small" onClick={() => setSheet({ kind: "edit", card: c })}>
                    עריכה
                  </button>
                  <button className="a-btn small" onClick={() => setSheet({ kind: "history", card: c })}>
                    היסטוריה
                  </button>
                  {review ? (
                    <button className="a-btn small" onClick={() => void hide(c, !s?.suspended)}>
                      {s?.suspended ? "להציג שוב" : "להסתיר ממני"}
                    </button>
                  ) : null}
                  <button className="a-btn small" onClick={() => void remove(c)}>
                    מחיקה לכל הקבוצה
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  const title = lecture?.title ?? "";
  const counts = useMemo(() => ({ ...(groupCounts ?? {}), [lectureId]: active.length }), [groupCounts, lectureId, active.length]);
  // The export reads this lecture's cards from here; one object while they do not change.
  const preloaded = useMemo(() => (lecture && cards ? { lecture, cards } : undefined), [lecture, cards]);
  // The other lectures' decks, for the export's course and "כל ההרצאות" counts.
  useEffect(() => {
    if (sheet?.kind !== "export" || groupCounts) return;
    let alive = true;
    listGroupCardsLite(ctx.group.id)
      .then((cs) => {
        if (!alive) return;
        const n: Record<string, number> = {};
        for (const c of cs) n[c.lecture_id] = (n[c.lecture_id] ?? 0) + 1;
        setGroupCounts(n);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sheet, groupCounts, ctx.group.id]);

  return (
    <main className="cards deck">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "lecture", l: lectureId }} />}>
        <h1 className="t" dir="auto">
          כרטיסיות · <bdi>{title || " "}</bdi>
        </h1>
      </Head>
      {active.length > 0 ? (
        <p className="ph-sub deck-sub">
          <span>
            {cardsWord(active.length)} · {parts.length > 1 ? `${parts.length} חלקים` : "חלק אחד"} · נוצרו פעם אחת לכל הקבוצה
          </span>
        </p>
      ) : lecture && (lecture.course || lecture.lecturer) ? (
        <p className="ph-sub">{[lecture.course, lecture.lecturer].filter(Boolean).join(" · ")}</p>
      ) : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      {cards === null && !error ? <p className="a-muted loading">טוען…</p> : null}

      {openRound || failedParts.length ? (
        <section className="a-card gen" aria-live="polite">
          {openRound ? (
            <>
              <div className="a-bar" role="progressbar" aria-valuemin={0} aria-valuemax={wantedAll} aria-valuenow={madeSoFar}>
                <i style={{ width: `${wantedAll ? Math.min(100, (100 * madeSoFar) / wantedAll) : 0}%` }} />
              </div>
              <p>
                נכתבות כרטיסיות: {madeSoFar} מתוך {wantedAll}. {active.length > 0 ? "אפשר כבר להתחיל." : ""}
              </p>
              {round?.running ? <p className="a-small a-muted">{KEEP_SCREEN_ON}</p> : null}
              {stalled ? (
                <div className="a-row gen-retry">
                  <button className="a-btn small" onClick={start}>
                    לנסות שוב
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <ul className="a-list gen-parts">
            {roundParts.map((b) => {
              const name = heading(b.part_idx);
              if (b.status === "ready")
                return (
                  <li key={b.id}>
                    <span>
                      <bdi>{isolateLatin(name, `h${b.id}`)}</bdi> · {b.made} <span className="ok-mark">✓</span>
                    </span>
                  </li>
                );
              if (b.status === "failed")
                return (
                  <li key={b.id}>
                    <span>
                      <bdi>{isolateLatin(name, `h${b.id}`)}</bdi>
                    </span>
                    <span className="why">
                      החלק הזה לא נכתב. {failText(b.attempts >= 3 ? "gave up" : (b.error ?? ""), "cards")}
                    </span>
                    {claimable(b) && !flying.has(b.id) ? (
                      <span>
                        <button className="a-btn small" onClick={() => retry(b)}>
                          לנסות שוב
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              if (b.status === "writing")
                return (
                  <li key={b.id}>
                    <span>
                      <bdi>{isolateLatin(name, `h${b.id}`)}</bdi> · {here.has(b.id) ? "נכתב עכשיו…" : "נכתב במכשיר אחר…"}
                    </span>
                    {!here.has(b.id) && claimable(b) ? (
                      <span>
                        <button className="a-btn small" onClick={() => retry(b)}>
                          לנסות שוב
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              return (
                <li key={b.id}>
                  <span className="a-muted">
                    <bdi>{isolateLatin(name, `h${b.id}`)}</bdi>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {cards !== null && active.length === 0 && !openRound ? (
        <section className="a-card dashed empty-deck">
          <h2 className="a-h2">עוד אין כרטיסיות להרצאה הזו.</h2>
          <div className="a-row">
            <button className="a-btn primary" disabled={!lecture} onClick={() => setSheet({ kind: "generate", round: latest + 1 })}>
              יצירת כרטיסיות
            </button>
          </div>
          <p className="a-para a-muted">הכרטיסיות נכתבות פעם אחת מהשקפים ונשמרות לכל הקבוצה. אפשר לתקן או למחוק כל כרטיסייה, והתיקון מופיע לכולם.</p>
          {deleted.length ? null : (
            <div className="a-row deck-links">
              <button className="a-link" disabled={!lecture} onClick={() => setSheet({ kind: "add" })}>
                הוספת כרטיסייה
              </button>
            </div>
          )}
        </section>
      ) : null}

      {active.length > 0 ? (
        <section className="a-stack my-deck" aria-label="החפיסה שלך">
          <div className="a-row deck-ring">
            <div className="a-ring" style={{ "--p": `${deckPct}%`, minWidth: 54 } as CSSProperties} aria-hidden="true">
              <span>{deckOfMine.length}</span>
            </div>
            <div>
              <b>בחפיסה שלך: {cardsWord(deckOfMine.length)}</b>
              <p className="a-small a-muted">
                {inDeckParts.length === 0 ? "עוד לא הוספת חלקים. " : inDeckParts.length === 1 ? "מחלק אחד. " : `מ-${inDeckParts.length} חלקים. `}
                עד {newPerDay} חדשים ביום, כדי שהחפיסה לא תקבור אותך.
              </p>
            </div>
          </div>
          <ul className="a-list deck-parts">
            {shownParts.map((pt) => {
              const k = String(pt.part_idx);
              const isOpen = openParts.has(k);
              const list = byPart.get(k) ?? [];
              return (
                <li key={k} className="deck-part" data-part={pt.part_idx} data-cards={list.length}>
                  <div className="a-li">
                    <button type="button" className="part-toggle" aria-expanded={isOpen} onClick={() => toggle(k)}>
                      <b dir="rtl">{isolateLatin(pt.heading || `ש׳ ${pt.slide_from}-${pt.slide_to}`, `p${k}`)}</b>
                      {pt.in_deck ? null : <span className="m">{cardsWord(pt.cards)}</span>}
                    </button>
                    {pt.in_deck ? (
                      <span className="a-chip ok">{pt.cards} בחפיסה ✓</span>
                    ) : (
                      <button className="a-btn small" disabled={pt.cards === 0} onClick={() => void adopt([pt.part_idx], true)}>
                        להוסיף
                      </button>
                    )}
                  </div>
                  {isOpen && list.length ? cardList(list) : null}
                </li>
              );
            })}
            {hiddenParts.length ? (
              <li className="deck-part more-parts">
                <button type="button" className="a-li part-toggle" onClick={() => setAllParts(true)}>
                  <span className="m">
                    ועוד {hiddenParts.length} חלקים: {isolateLatin(hiddenParts.map((h) => h.heading || `ש׳ ${h.slide_from}-${h.slide_to}`).join(", "), "more")}
                  </span>
                </button>
              </li>
            ) : null}
            {loose.length ? (
              <li className="deck-part" data-part="none" data-cards={loose.length}>
                <div className="a-li">
                  <button type="button" className="part-toggle" aria-expanded={openParts.has("none")} onClick={() => toggle("none")}>
                    <b>בלי חלק</b>
                    <span className="m">{cardsWord(loose.length)} · כרטיס שכתבת נכנס לחפיסה שלך מעצמו</span>
                  </button>
                </div>
                {openParts.has("none") ? cardList(loose) : null}
              </li>
            ) : null}
          </ul>
          <div className="a-row deck-links">
            {parts.some((pt) => !pt.in_deck && pt.cards > 0) ? (
              <button className="a-link" onClick={() => void adopt(null, true)}>
                להוסיף את כל החלקים
              </button>
            ) : null}
            {inDeckParts.length ? (
              <button className="a-link" onClick={() => void adopt(null, false)}>
                להוציא מהחפיסה שלי
              </button>
            ) : null}
          </div>
          {numbers ? (
            <p className="a-small a-muted">
              שלך: {numbers.due} לחזרה היום · {numbers.fresh} חדשות · {numbers.learning} בלמידה
            </p>
          ) : null}
        </section>
      ) : null}

      {recentFix && fixCard ? (
        <section className="a-card flat deck-fix" aria-label="תיקון אחרון">
          <div className="a-row between">
            <span className="a-row">
              <span className="a-chip ok">תוקן לכולם</span>
              {recentFix.edited_by ? <Avatar id={recentFix.edited_by} name={ctx.nameOf(recentFix.edited_by) || "?"} /> : null}
              <span className="a-small">
                {recentFix.edited_by && ctx.nameOf(recentFix.edited_by) ? `${ctx.nameOf(recentFix.edited_by)} · ` : ""}
                {whenText(recentFix.edited_at)}
              </span>
            </span>
            <button className="a-btn ghost small" onClick={() => void undoFix(recentFix)}>
              לבטל
            </button>
          </div>
          <p className="a-para" dir="rtl">
            {frontText(fixCard, `fx${fixCard.id}`)}
            {fixCard.kind === "qa" && fixCard.back ? <> {isolateLatin(fixCard.back, `fb${fixCard.id}`)}</> : null}
          </p>
          <p className="a-small a-muted">
            מתעדכן גם ב-<bdi dir="ltr">Anki</bdi> בייצוא הבא, בלי לאבד התקדמות.
          </p>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section className="a-stack deck-summary" aria-label="החפיסה">
          <div className="a-row deck-links">
            {review ? (
              <RouteLink to={{ v: "cards", s: `l.${lectureId}` }} go={ctx.go} className="a-link">
                לחזור על ההרצאה
              </RouteLink>
            ) : null}
            <button className="a-link" onClick={() => setSheet({ kind: "browse" })}>
              עיון בכרטיסיות
            </button>
            <button className="a-link" disabled={!lecture} onClick={() => setSheet({ kind: "add" })}>
              הוספת כרטיסייה
            </button>
            {active.length >= MAX_ACTIVE ? (
              <span className="a-small a-muted">להרצאה הזו יש כבר 150 כרטיסיות.</span>
            ) : (
              <button className="a-link" disabled={!lecture || openRound} onClick={() => setSheet({ kind: "generate", round: latest + 1 })}>
                עוד כרטיסיות
              </button>
            )}
            {review ? (
              <button className="a-link" onClick={() => setConfirmReset(true)}>
                להתחיל מחדש
              </button>
            ) : null}
          </div>
          {confirmReset ? (
            <div className="a-callout warn confirm" role="alertdialog" aria-label="להתחיל מחדש">
              <p>להתחיל את כל הכרטיסיות של ההרצאה מההתחלה? היסטוריית החזרות נשמרת.</p>
              <div className="a-row">
                <button className="a-btn primary small" onClick={() => void reset()}>
                  להתחיל מחדש
                </button>
                <button className="a-btn ghost small" onClick={() => setConfirmReset(false)}>
                  ביטול
                </button>
              </div>
            </div>
          ) : null}
          <p className="a-small a-muted anki-path">
            ב-<bdi dir="ltr">Anki</bdi>: <bdi>{deckName(lecture?.course ?? "", title)}</bdi>
          </p>
        </section>
      ) : null}

      {deleted.length ? (
        <details className="deleted-cards">
          <summary>{deleted.length === 1 ? "כרטיסייה אחת נמחקה" : `${deleted.length} כרטיסיות נמחקו`}</summary>
          <ul className="a-list card-list">
            {deleted.map((c) => (
              <li key={c.id} className="card-row" data-card={c.id}>
                <div className="a-li">
                  <div>
                    <span className="front" dir="rtl">
                      {frontText(c, `d${c.id}`)}
                    </span>
                    <span className="m">
                      נמחקה{c.deleted_by && ctx.nameOf(c.deleted_by) ? ` ע״י ${ctx.nameOf(c.deleted_by)}` : ""} · {whenText(c.deleted_at!)}
                    </span>
                  </div>
                  <button className="a-btn small" onClick={() => void restore(c)}>
                    שחזור
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* The deck's one action in its bottom bar, as the approved deck page has it: the export. */}
      {active.length > 0 ? (
        <div className="ph-foot deck-actions">
          <button className="a-btn primary wide" onClick={() => setSheet({ kind: "export" })}>
            <Icon name="cards" size={16} />
            <span>
              ייצוא ל-<bdi dir="ltr">Anki</bdi> · <bdi dir="ltr">.apkg</bdi>
            </span>
          </button>
        </div>
      ) : null}

      {sheet?.kind === "generate" && lecture ? (
        <CardsGenerateSheet lecture={lecture} sections={sections} round={sheet.round} onClose={() => setSheet(null)} onStart={start} />
      ) : null}
      {(sheet?.kind === "edit" || sheet?.kind === "add") && lecture ? (
        <CardEditSheet
          key={sheet.kind === "edit" ? sheet.card.id : "new"}
          lecture={lecture}
          card={sheet.kind === "edit" ? sheet.card : undefined}
          say={ctx.say}
          onClose={() => setSheet(null)}
          onSaved={() => void loadDeck().catch(() => undefined)}
        />
      ) : null}
      {sheet?.kind === "history" ? <CardHistorySheet card={sheet.card} nameOf={ctx.nameOf} say={ctx.say} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "export" && lecture ? (
        <AnkiExportSheet
          groupId={ctx.group.id}
          lectures={lectures.length ? lectures : [lecture]}
          lectureId={lectureId}
          counts={counts}
          preloaded={preloaded}
          mine={{ inDeck, count: deckOfMine.length, cards: review ? mine : [] }}
          say={ctx.say}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === "browse" && lecture ? (
        <Suspense fallback={null}>
          <CardBrowse cards={active} lecture={lecture} figureUrl={figureUrl} nameOf={ctx.nameOf} go={ctx.go} onClose={() => setSheet(null)} />
        </Suspense>
      ) : null}
      {slide !== null && lecture ? (
        <Suspense fallback={null}>
          <SlideSheet lecture={lecture} slide={slide} go={ctx.go} onClose={() => setSlide(null)} />
        </Suspense>
      ) : null}
    </main>
  );
}

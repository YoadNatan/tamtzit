import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addComment,
  deleteComment,
  deleteLecture,
  figureUrls,
  getLecture,
  getSections,
  groupLive,
  listComments,
  members,
  isStuck,
  startedOver,
  readingRoom,
  readMarks,
  setRead,
  setResolved,
  watchLecture,
  type Changed,
  type Comment,
  type CommentKind,
  type GroupLive,
  type InRoom,
  type Lecture,
  type Member,
  type ReadingRoom,
  type ReadMark,
  type Section,
} from "../lib/api";
import { flags } from "../lib/flags";
import { guideMark } from "../lib/guideMark";
import { slidesOf } from "../lib/rich";
import { afterReading, lectureChips, shareUrl, type At, type Route } from "../lib/route";
import { useLectureN } from "../features/anchor";
import { ReaderGuideChip } from "../features/guide";
import { ParagraphSheet, useLectureK } from "../features/collab";
import { useLectureM } from "../features/meeting";
import { useLectureA } from "../features/progress";
import { useLectureV } from "../features/var";
import { useLectureJ } from "../features/wall";
import { useLectureW, useWriting } from "../features/writing";
import type { LectureCtx, LectureExt, ParagraphAction, PartExtras, ScreenProps, SheetTab, Spot } from "../features/types";
import { BackLink, Head, openSheets, pushSheet, readSize, RouteLink, saveSize, SIZES } from "./Shell";
import { Icon } from "./Icon";
import SlideSheet from "./SlideSheet";
import SummaryView, { headingId, outline, type BlockNotes } from "./SummaryView";
import { QuestionsSheet, RoomBar, type FollowState } from "./Together";

/** Question types: an older lecture's picture labels, from its own file (loads only when opened). */
const GeoBackfill = lazy(() => import("./GeoBackfill"));
/** Its pictures have no label geometry yet (GeoBackfill's needsGeo, without loading it). */
const needsGeo = (l: Pick<Lecture, "slides">) => {
  const figures = l.slides.flatMap((s) => s.figures ?? []);
  return figures.length > 0 && !figures.some((f) => f.geo);
};

/* ── One lecture ──
 * The summary part by part: finished parts render, the part being written
 * streams in, waiting parts hold their place. Writing it is package W's slot
 * (features/writing.tsx: today's device writing until W's server writer).
 *
 * Studying together (Together.tsx): who has the lecture open, "follow the
 * reader" (the reader's paragraph scrolls the others' screens), comments and
 * questions on any paragraph, and who has read the lecture.
 *
 * The packages reach the reader through hooks (spec §5.3; §12.2.3), merged in
 * the order W, K, A, M, N, V, J: W adds chips, a note, boxes after paragraphs
 * and sheets; K the paragraph sheet's other tabs and "לשאול" over the reader;
 * A2 where reading stopped; M "לא ברור לי" in the follower's bar and the
 * reader's card; N the chip row under each paragraph; V the verdict box and
 * the log; J "לנעוץ רגע". Deep links: at (a paragraph), slide (the first
 * paragraph citing it), mk (back to a marathon), read=1 (start reading
 * aloud), follow=1 (follow the first reader). */

/** Merges the packages' additions to the lecture, in the order given. */
function mergeExt(list: LectureExt[]): LectureExt {
  const all = <K extends keyof LectureExt>(k: K) => list.map((e) => e[k]).filter((x): x is NonNullable<LectureExt[K]> => x != null);
  const chips = all("chips");
  const top = all("top");
  const overlay = all("overlay");
  const parts = all("part");
  const followBar = all("followBar");
  const readerBar = all("readerBar");
  return {
    chips: chips.length ? <>{chips.map((c, i) => <span key={i}>{c}</span>)}</> : undefined,
    top: top.length ? <>{top.map((c, i) => <div key={i}>{c}</div>)}</> : undefined,
    overlay: overlay.length ? <>{overlay.map((c, i) => <div key={i}>{c}</div>)}</> : undefined,
    followBar: followBar.length ? <>{followBar.map((c, i) => <span key={i}>{c}</span>)}</> : undefined,
    // The reader's bar is one wrapping row (M's line, J's "לנעוץ רגע"; K's row takes a line of its own).
    readerBar: readerBar.length ? <>{readerBar.map((c, i) => <Fragment key={i}>{c}</Fragment>)}</> : undefined,
    part: parts.length
      ? (s: Section): PartExtras => {
          const each = parts.map((f) => f(s));
          const extras = each.map((e) => e.blockExtras).filter((f): f is NonNullable<PartExtras["blockExtras"]> => Boolean(f));
          const states = each.map((e) => e.blockState).filter((f): f is NonNullable<PartExtras["blockState"]> => Boolean(f));
          return {
            blockExtras: extras.length
              ? (a: number) => {
                  const nodes = extras.map((f) => f(a)).filter((n): n is Exclude<ReactNode, null | undefined | false> => n != null && n !== false);
                  return nodes.length ? <>{nodes}</> : null;
                }
              : undefined,
            blockState: states.length ? (a: number) => Object.assign({}, ...states.map((f) => f(a))) : undefined,
          };
        }
      : undefined,
    share: list.find((e) => e.share)?.share,
    ask: list.find((e) => e.ask)?.ask,
  };
}

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

/** The paragraph at the reading line (a third of the way down the screen). */
function placeOnScreen(): { part: number; anchor: number } | null {
  const line = window.innerHeight * 0.35;
  let best: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(".lecture-body [data-part] [data-blk]")) {
    if (el.getBoundingClientRect().top <= line) best = el;
    else if (best) break;
  }
  best ??= document.querySelector<HTMLElement>(".lecture-body [data-part] [data-blk]");
  const part = Number(best?.closest<HTMLElement>("[data-part]")?.dataset.part);
  const anchor = Number(best?.dataset.blk);
  return Number.isFinite(part) && Number.isFinite(anchor) ? { part, anchor } : null;
}

/** The paragraph citing a slide: the first block whose tag covers it, else the
 *  start of the ready part whose range does; null when no part has it, and
 *  undefined while its part may still be written. */
function slideTarget(n: number, sections: Section[]): At | null | undefined {
  const tag = [...document.querySelectorAll<HTMLElement>(".lecture-body [data-slides]")].find((el) => slidesOf(el.dataset.slides ?? "").includes(n));
  const blk = tag?.closest<HTMLElement>("[data-blk]");
  const part = blk?.closest<HTMLElement>("[data-part]");
  if (blk && part) return { part: Number(part.dataset.part), anchor: Number(blk.dataset.blk) };
  const s = sections.find((x) => x.status === "ready" && x.slide_from <= n && n <= x.slide_to);
  if (s) return { part: s.idx, anchor: 0 };
  return sections.every((x) => x.status === "ready") ? null : undefined;
}

/** The section at the reading line and how far from the top it sits, to put
 *  back after a refresh changed the heights above it. */
function capturePlace(): { el: Element; top: number } | null {
  const at = placeOnScreen();
  const el = at ? document.querySelector(`[data-part="${at.part}"] [data-blk="${at.anchor}"]`) : null;
  return el ? { el, top: el.getBoundingClientRect().top } : null;
}

export default function LectureView({ route, ctx }: ScreenProps<"lecture">) {
  const lectureId = route.l;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState("");
  const [togetherTick, setTogetherTick] = useState(0);
  const seqMain = useRef(0);
  const keep = useRef<{ el: Element; top: number } | null>(null);
  const following = useRef(false);

  const hold = () => {
    if (!following.current) keep.current = capturePlace();
  };

  // Refreshes can overlap (two quick changes): only the newest one is applied.
  const refresh = useCallback(async () => {
    const mine = ++seqMain.current;
    const [l, s] = await Promise.all([getLecture(lectureId), getSections(lectureId)]);
    if (mine === seqMain.current) {
      hold();
      setLecture(l);
      setSections(s);
    }
    return { l, s };
  }, [lectureId]);

  const patchSection = useCallback((row: Partial<Section> & { idx: number }) => {
    hold();
    setSections((list) => list.map((x) => (x.idx === row.idx ? { ...x, ...row } : x)));
  }, []);

  // The reader's place survives a refresh unless following (design-collab §4.3).
  useLayoutEffect(() => {
    const k = keep.current;
    keep.current = null;
    if (!k || !k.el.isConnected || following.current) return;
    const d = k.el.getBoundingClientRect().top - k.top;
    if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" as ScrollBehavior });
  }, [sections]);

  useEffect(() => {
    let alive = true;
    setLecture(null);
    setSections([]);
    setError("");
    refresh().catch(() => alive && setError("ההרצאה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב."));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timer2: ReturnType<typeof setTimeout> | undefined;
    const stop = watchLecture(
      lectureId,
      (row: Changed, table: string) => {
        // A part's new text arrives whole: patch it in place, no refetch of every part.
        if (table === "study_sections" && row.lecture_id === lectureId && typeof row.idx === "number" && typeof row.markdown === "string") {
          patchSection(row as Partial<Section> & { idx: number });
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => void refresh().catch(() => undefined), 400);
      },
      () => {
        clearTimeout(timer2);
        timer2 = setTimeout(() => setTogetherTick((n) => n + 1), 250);
      },
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(timer2);
      stop();
    };
  }, [lectureId, refresh, patchSection]);

  const back = <BackLink go={ctx.go} fallback={route.mk ? { v: "marathon", m: route.mk } : { v: "library" }} label={route.mk ? "→ לערב הלמידה" : undefined} />;

  if (!lecture) {
    return (
      <main className="lecture">
        <Head back={back} />
        <p className="a-muted loading">{error || "טוען…"}</p>
      </main>
    );
  }
  return (
    <Reader
      key={lecture.id}
      route={route}
      ctx={ctx}
      lecture={lecture}
      sections={sections}
      refresh={async () => void (await refresh())}
      patchSection={patchSection}
      togetherTick={togetherTick}
      back={back}
      followingRef={following}
    />
  );
}

type ReaderProps = {
  route: Extract<Route, { v: "lecture" }>;
  ctx: ScreenProps<"lecture">["ctx"];
  lecture: Lecture;
  sections: Section[];
  refresh: () => Promise<void>;
  patchSection: (row: Partial<Section> & { idx: number }) => void;
  togetherTick: number;
  back: ReactNode;
  followingRef: { current: boolean };
};

function Reader({ route, ctx, lecture, sections, refresh, patchSection, togetherTick, back, followingRef }: ReaderProps) {
  const lectureId = lecture.id;
  const userId = ctx.userId;
  const say = ctx.say;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [size, setSize] = useState(readSize);
  const [tocOpen, setTocOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [geoOpen, setGeoOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [slideOpen, setSlideOpen] = useState<number | null>(null);

  // Studying together
  const [people, setPeople] = useState<Member[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reads, setReads] = useState<ReadMark[]>([]);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [sheet, setSheet] = useState<(Spot & { tab: SheetTab }) | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [room, setRoom] = useState<InRoom[]>([]);
  const [reading, setReading] = useState(false);
  const [following, setFollowing] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [myPlace, setMyPlace] = useState<At | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const roomRef = useRef<ReadingRoom | null>(null);
  const liveRef = useRef<GroupLive | null>(null);
  const headRef = useRef<HTMLElement>(null);
  const headH = useRef(64);
  const sheetOpenRef = useRef(false);
  const sheetEntry = useRef<{ id: string; closing: boolean } | null>(null);
  const seqTogether = useRef(0);
  followingRef.current = Boolean(following);

  /* ── a marked paragraph: scrolled to the middle and marked for 2 s ── */
  const [deepMark, setDeepMark] = useState<At | null>(null);
  const markTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(markTimer.current), []);
  const markAt = useCallback((target: At) => {
    document.querySelector<HTMLElement>(`[data-part="${target.part}"] [data-blk="${target.anchor}"]`)?.scrollIntoView({ block: "center" });
    setDeepMark(target);
    // Only a new mark or leaving the lecture cancels the 2 s (a refresh or a new route does not).
    clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => setDeepMark(null), 2000);
  }, []);

  /** "לפסקה בסיכום" over this lecture: the paragraph citing the slide, here. */
  const toSlide = useCallback(
    (n: number) => {
      const t = slideTarget(n, sections);
      if (t) return markAt(t);
      // Its part is not written yet: its place in the lecture.
      const s = sections.find((x) => x.slide_from <= n && n <= x.slide_to);
      if (s) document.getElementById(`part-${s.idx}`)?.scrollIntoView({ block: "start" });
    },
    [sections, markAt],
  );

  const figureByPath = useCallback((path: string) => urls[path], [urls]);

  const refreshTogether = useCallback(async () => {
    const mine = ++seqTogether.current;
    const [c, r] = await Promise.all([listComments([lectureId]), readMarks([lectureId])]);
    if (mine !== seqTogether.current) return;
    setComments(c);
    setReads(r);
  }, [lectureId]);

  useEffect(() => {
    void refreshTogether().catch(() => undefined);
  }, [refreshTogether, togetherTick]);

  const figureKey = lecture.slides.map((s) => s.figures.map((f) => f.path).join(",")).join(";");
  useEffect(() => {
    let alive = true;
    const paths = lecture.slides.flatMap((s) => s.figures.map((f) => f.path));
    figureUrls(paths).then((u) => alive && setUrls(u)).catch(() => undefined);
    members(lecture.group_id).then((m) => alive && setPeople(m)).catch(() => undefined);
    return () => {
      alive = false;
    };
    // The figures' paths, not the lecture object, decide when to sign again.
  }, [figureKey, lecture.group_id]);

  // The text size is the whole app's (Me's setting): follow changes made there.
  useEffect(() => {
    const on = (e: Event) => setSize((e as CustomEvent<number>).detail);
    window.addEventListener("study-font-size", on);
    return () => window.removeEventListener("study-font-size", on);
  }, []);

  /* ── the reading room ── */
  const myName = people.find((p) => p.user_id === userId)?.name ?? "";
  const nameOf = useCallback((id: string) => people.find((p) => p.user_id === id)?.name ?? "", [people]);

  useEffect(() => {
    if (!myName) return;
    const r = readingRoom(lectureId, { id: userId, name: myName }, setRoom);
    roomRef.current = r;
    return () => {
      r.leave();
      roomRef.current = null;
    };
  }, [lectureId, userId, myName]);

  // The group channel says who is reading aloud (the shell's banner, "יחד").
  useEffect(() => {
    const live = groupLive(ctx.group.id, { id: userId }, () => undefined);
    liveRef.current = live;
    return () => {
      live.setReading(null);
      live.leave();
      liveRef.current = null;
    };
  }, [ctx.group.id, userId]);

  // Presence comes from other phones: keep an entry only if it is a member of
  // the group speaking for itself, with sane numbers. Names come from the
  // member list, never from the entry.
  const present = useMemo(() => {
    const ids = new Set(people.map((p) => p.user_id));
    const okNum = (n: unknown) => n === undefined || (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 100000);
    return room.filter((p) => p.key === p.user_id && ids.has(p.user_id) && typeof p.reading === "boolean" && okNum(p.part) && okNum(p.anchor));
  }, [room, people]);

  // While reading aloud, share the paragraph at the reading line (not while a
  // sheet is open: swipes there are not reading).
  useEffect(() => {
    if (!reading) return;
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      if (sheetOpenRef.current) return;
      const at = placeOnScreen();
      if (!at) return;
      const key = `${at.part}:${at.anchor}`;
      if (key === last) return;
      last = key;
      setMyPlace(at);
      roomRef.current?.setPlace(at.part, at.anchor);
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(report, 250);
    };
    report();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      setMyPlace(null);
    };
  }, [reading]);

  const startReading = (on: boolean) => {
    setReading(on);
    if (on) setFollowing(null);
    roomRef.current?.setReading(on);
    liveRef.current?.setReading(on ? lectureId : null);
  };
  const startFollowing = (id: string | null) => {
    setFollowing(id);
    setPaused(false);
  };

  const followed = following ? present.find((p) => p.user_id === following) : undefined;
  const follow: FollowState = !following ? "off" : !followed ? "waiting" : paused ? "paused" : "on";
  const followedHere = Boolean(followed);
  const followedReading = followed?.reading;

  // Following ends when the reader says the reading is over. A reader who
  // vanishes (phone locked, app switched) gets two minutes to come back.
  useEffect(() => {
    if (!following) return;
    if (followedHere && followedReading === false) {
      setFollowing(null);
      say("ההקראה הסתיימה.");
      return;
    }
    if (!followedHere) {
      const t = setTimeout(() => {
        setFollowing(null);
        say("ההקראה הסתיימה.");
      }, 120_000);
      return () => clearTimeout(t);
    }
  }, [following, followedHere, followedReading, say]);

  // The place shown to everyone: the followed reader's, or the first reader's.
  const shown = followed ?? present.find((p) => p.user_id !== userId && p.reading);
  const readerPart = shown?.reading ? shown.part : undefined;
  const readerAnchor = shown?.reading ? shown.anchor : undefined;

  // Per part, per paragraph: how many comments (with replies) and open questions
  // (the reader's dot; with N on, its chip row shows them instead).
  const notesByPart = useMemo(() => {
    const out: Record<number, Record<number, BlockNotes>> = {};
    const byId = new Map(comments.map((c) => [c.id, c]));
    for (const c of comments) {
      const root = c.parent_id ? byId.get(c.parent_id) : c;
      if (!root) continue;
      const part = (out[root.part_idx] ??= {});
      const n = (part[root.anchor] ??= { total: 0, open: 0 });
      n.total += 1;
      if (!c.parent_id && c.kind === "question" && !c.resolved) n.open += 1;
    }
    return out;
  }, [comments]);

  /* ── the packages' hooks (called unconditionally; each checks its own flag) ──
   * In the order W, K, A, M, N, V, J (§12.2.3). They see whether this phone
   * follows or reads aloud, and the paragraph being read. */
  const readerPlace: At | null = readerPart !== undefined && readerAnchor !== undefined ? { part: readerPart, anchor: readerAnchor } : null;
  const lc: LectureCtx = {
    ctx,
    route,
    lecture,
    sections,
    patchSection,
    refresh,
    figureUrl: figureByPath,
    toSlide,
    following: Boolean(following),
    reading,
    place: reading ? myPlace : readerPlace,
    openParagraph: (spot, tab) => {
      setSelected(null);
      openSheet(() => setSheet({ part: spot.part, anchor: spot.anchor, quote: spot.quote, tab }));
    },
    notes: (part, anchor) => notesByPart[part]?.[anchor],
  };
  const writing = useWriting(lc);
  const extW = useLectureW(lc);
  const extK = useLectureK(lc);
  const extA = useLectureA(lc);
  const extM = useLectureM(lc);
  const extN = useLectureN(lc);
  const extV = useLectureV(lc);
  const extJ = useLectureJ(lc);
  const ext = mergeExt([extW, extK, extA, extM, extN, extV, extJ]);

  // Following: move only when the reader's paragraph changes. A paragraph
  // taller than most of the screen is shown from its top, below the header.
  useEffect(() => {
    if (follow !== "on" || readerPart === undefined || readerAnchor === undefined) return;
    const el = document.querySelector<HTMLElement>(`[data-part="${readerPart}"] [data-blk="${readerAnchor}"]`);
    if (!el) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const r = el.getBoundingClientRect();
    const room = window.innerHeight - headH.current;
    const top = r.height > room * 0.8 ? r.top + window.scrollY - headH.current - 8 : r.top + window.scrollY - headH.current - (room - r.height) / 2;
    window.scrollTo({ top: Math.max(0, top), behavior });
  }, [follow, readerPart, readerAnchor]);

  // The follower's own scrolling pauses following ("חזרה להקראה" resumes).
  useEffect(() => {
    if (follow !== "on") return;
    const pause = () => setPaused(true);
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) pause();
    };
    window.addEventListener("touchmove", pause, { passive: true });
    window.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("touchmove", pause);
      window.removeEventListener("wheel", pause);
      window.removeEventListener("keydown", onKey);
    };
  }, [follow]);

  // The sticky header's height, for scrolling targets below it (the header
  // grows a line when the reading bar appears).
  const loaded = lecture !== null;
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      headH.current = el.offsetHeight;
      root.style.setProperty("--study-head-h", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--study-head-h");
    };
  }, [loaded]);

  /* ── sheets: Back closes them, the page behind stays still ──
   * One history entry for the paragraph's sheet and the questions (the shell's
   * sheet entry: the reader's own state, a sheet listed on it), so Back closes
   * the sheet and a sheet opened over it closes alone. */
  const sheetOpen = Boolean(sheet) || questionsOpen;
  sheetOpenRef.current = sheetOpen;
  const openSheet = (open: () => void) => {
    if (!sheetEntry.current) sheetEntry.current = { id: pushSheet(), closing: false };
    open();
  };
  const closeSheets = useCallback(() => {
    const e = sheetEntry.current;
    if (!e) {
      setSheet(null);
      setQuestionsOpen(false);
    } else if (!e.closing) {
      e.closing = true; // a second tap must not go back past the reader
      history.back(); // the popstate handler closes them
    }
  }, []);
  useEffect(() => {
    const onPop = () => {
      const e = sheetEntry.current;
      if (!e || openSheets().includes(e.id)) return;
      sheetEntry.current = null;
      setSheet(null);
      setQuestionsOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  // A tapped paragraph stops being selected on a tap elsewhere, Escape, or
  // when it scrolls out of view.
  useEffect(() => {
    if (!selected) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".lecture-body [data-blk], .note-add, .note-dot, .sheet")) return;
      setSelected(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    const onScroll = () => {
      const r = document.querySelector(`[data-part="${selected.part}"] [data-blk="${selected.anchor}"]`)?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setSelected(null);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [selected]);

  /* ── comments ── */

  const openQuestions = useMemo(() => comments.filter((c) => !c.parent_id && c.kind === "question" && !c.resolved), [comments]);

  const threadComments = useMemo(() => {
    if (!sheet) return [];
    const roots = new Set(comments.filter((c) => !c.parent_id && c.part_idx === sheet.part && c.anchor === sheet.anchor).map((c) => c.id));
    return comments.filter((c) => (c.parent_id ? roots.has(c.parent_id) : roots.has(c.id)));
  }, [comments, sheet]);

  const send = async (kind: CommentKind, body: string, parentId: string | null) => {
    if (!sheet) return;
    const c = await addComment({ lecture_id: lectureId, part_idx: sheet.part, anchor: sheet.anchor, quote: sheet.quote, kind, body, parent_id: parentId });
    setComments((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
  };
  const resolve = async (c: Comment, resolved: boolean) => {
    await setResolved(c.id, resolved);
    setComments((list) => list.map((x) => (x.id === c.id ? { ...x, resolved } : x)));
  };
  const remove = async (c: Comment) => {
    await deleteComment(c.id);
    setComments((list) => list.filter((x) => x.id !== c.id && x.parent_id !== c.id));
  };

  const jumpTo = (q: Comment) => {
    setQuestionsOpen(false);
    document.querySelector<HTMLElement>(`[data-part="${q.part_idx}"] [data-blk="${q.anchor}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSheet({ part: q.part_idx, anchor: q.anchor, quote: q.quote, tab: "comments" });
  };
  const draftKey = sheet ? `${sheet.part}:${sheet.anchor}` : "";

  /** A paragraph's action: the sheet on its tab, or "לשאול" (K's sheet over the reader, else the ask screen). */
  const onAction = (action: ParagraphAction, part: number, anchor: number, quote: string) => {
    setSelected(null);
    if (action === "ask") {
      if (ext.ask) ext.ask({ part, anchor, quote });
      else ctx.go({ v: "ask", l: lectureId, at: { part, anchor } });
      return;
    }
    const tab: SheetTab = action === "edit" ? "edit" : action === "mnemonic" ? "mnemonic" : "comments";
    openSheet(() => setSheet({ part, anchor, quote, tab }));
  };
  const actions: ParagraphAction[] = [
    "comment",
    ...(flags.corrections ? (["edit"] as const) : []),
    ...(flags.wall ? (["mnemonic"] as const) : []),
    ...(flags.ask ? (["ask"] as const) : []),
  ];

  /* ── read marks ── */
  const iRead = reads.some((r) => r.user_id === userId);
  const readers = reads.map((r) => nameOf(r.user_id)).filter(Boolean);
  const toggleRead = async () => {
    try {
      await setRead(lectureId, !iRead);
      await refreshTogether();
    } catch {
      say("הסימון לא נשמר.");
    }
  };

  const figureUrl = useCallback(
    (slide: number, k: number) => {
      const f = lecture?.slides.find((s) => s.n === slide)?.figures.find((x) => x.k === k);
      return f ? urls[f.path] : undefined;
    },
    [lecture, urls],
  );


  const toc = useMemo(
    () =>
      sections.flatMap((s) =>
        s.status === "ready"
          ? outline(s.markdown)
              .filter((h) => h.level <= 3)
              .map((h) => ({ ...h, id: headingId(`s${s.idx}-`, h.index) }))
          : [{ level: 2, text: s.title, index: 0, id: `part-${s.idx}` }],
      ),
    [sections],
  );

  const linkShare = async () => {
    const link = shareUrl(`?l=${lectureId}`);
    const text = `${lecture?.title ?? "סיכום"}: ${link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        say("הקישור הועתק.");
      }
    } catch {
      /* the share sheet was closed */
    }
  };

  const share = ext.share ?? (() => void linkShare());
  const setFont = (d: number) => {
    const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + d));
    setSize(SIZES[i]);
    saveSize(SIZES[i]);
  };

  const readyCount = sections.filter((s) => s.status === "ready").length;
  const meta = [lecture.lecturer, formatDate(lecture.lecture_date), lecture.course].filter(Boolean).join(" · ");

  /* ── deep links: at, slide (marked 2 s), read=1, follow=1 ──
   * at and slide are handled once per navigation (each route is a new object),
   * so a later move to another paragraph of this lecture marks that one too. */
  const deepFor = useRef<Route | null>(null);
  useEffect(() => {
    if (deepFor.current === route || readyCount === 0 || (route.at === undefined && route.slide === undefined)) return;
    let target: At | null = null;
    if (route.at) {
      if (!document.querySelector(`[data-part="${route.at.part}"] [data-blk="${route.at.anchor}"]`)) {
        if (sections.length && sections.every((s) => s.status === "ready")) deepFor.current = route; // no such paragraph
        return;
      }
      target = route.at;
    } else if (route.slide !== undefined) {
      const t = slideTarget(route.slide, sections);
      if (t === undefined) return; // its part may still be written
      target = t;
    }
    deepFor.current = route;
    if (target) markAt(target);
  }, [readyCount, sections, route, markAt]);

  const readDone = useRef(false);
  useEffect(() => {
    if (!route.read || readDone.current || readyCount === 0 || !myName) return;
    readDone.current = true;
    // The room joins asynchronously: start once it exists.
    const t = setTimeout(() => startReading(true), 300);
    return () => clearTimeout(t);
    // startReading only uses refs and setters, so it is left out of the deps.
  }, [route.read, readyCount, myName]);

  const [followWanted, setFollowWanted] = useState(Boolean(route.follow));
  useEffect(() => {
    if (!followWanted) return;
    const r = present.find((p) => p.user_id !== userId && p.reading);
    if (r) {
      setFollowWanted(false);
      startFollowing(r.user_id);
      return;
    }
    // Today's waiting state, for up to two minutes.
    const t = setTimeout(() => {
      setFollowWanted(false);
      say("ההקראה הסתיימה.");
    }, 120_000);
    return () => clearTimeout(t);
  }, [followWanted, present, userId, say]);

  const chips = lectureChips(lectureId, flags);
  const after = afterReading(lectureId, flags);
  const markOf = (idx: number) => (readerPart === idx ? readerAnchor : deepMark?.part === idx ? deepMark.anchor : null);

  return (
    <main className="lecture">
      <header className="ph-top reader-top" ref={headRef}>
        <div className="ph-head">
          {back}
          <div className="head-tools">
            <button className="a-btn ghost" onClick={() => setTocOpen((o) => !o)} aria-expanded={tocOpen}>
              תוכן
            </button>
            <button className="a-btn ghost" onClick={() => setFont(-1)} aria-label="טקסט קטן יותר">
              א-
            </button>
            <button className="a-btn ghost" onClick={() => setFont(1)} aria-label="טקסט גדול יותר">
              א+
            </button>
            <button className="a-btn ghost" onClick={share}>
              שיתוף
            </button>
          </div>
        </div>
        {reading && ext.readerBar ? (
          <div className="ph-sub reader-extra" role="group" aria-label="בזמן ההקראה">
            {ext.readerBar}
          </div>
        ) : null}
        {myName && readyCount > 0 ? (
          <RoomBar
            people={present}
            me={userId}
            nameOf={nameOf}
            reading={reading}
            hideHere={reading && flags.meeting && Boolean(ext.readerBar)}
            following={following}
            follow={follow}
            onRead={startReading}
            onFollow={(id) => {
              setFollowWanted(false);
              startFollowing(id);
            }}
            onResume={() => setPaused(false)}
            extra={
              openQuestions.length ? (
                <button className="a-btn ghost small q-btn" onClick={() => openSheet(() => setQuestionsOpen(true))}>
                  שאלות <span className="q-count">{openQuestions.length}</span>
                </button>
              ) : null
            }
          />
        ) : null}
      </header>

      {tocOpen ? (
        <nav className="a-card flat toc" aria-label="תוכן העניינים">
          <ol>
            {toc.map((h) => (
              <li key={h.id} className={`lvl${h.level}`}>
                <a
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setTocOpen(false);
                  }}
                  dir="auto"
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <article className="lecture-body">
        <header className="lecture-title">
          <h1 className="a-h1" dir="auto">
            {lecture.title}
          </h1>
          {meta ? (
            <p className="a-small a-muted" dir="auto">
              {meta}
            </p>
          ) : null}
          {sections.length ? (
            <p className="a-small a-muted">
              {readyCount === sections.length
                ? `${sections.length} חלקים · ${lecture.slides.length} שקפים`
                : `נכתבו ${readyCount} מתוך ${sections.length} חלקים`}
            </p>
          ) : null}
          {sections.length && readyCount < sections.length && !ext.top ? (
            <div className="a-bar writing-bar" aria-hidden="true">
              <i style={{ width: `${Math.round((100 * readyCount) / sections.length)}%` }} />
            </div>
          ) : null}
          {ext.top}
          {chips.length || ext.chips || flags.guide ? (
            <nav className="lecture-actions" aria-label="פעולות על ההרצאה">
              {flags.guide ? <ReaderGuideChip /> : null}
              {chips.map((c) => (
                <RouteLink key={c.key} to={c.route} go={ctx.go} className="a-btn small">
                  {c.label}
                </RouteLink>
              ))}
              {ext.chips}
            </nav>
          ) : null}
        </header>

        {sections.length === 0 ? (
          <div className="a-card dashed part-wait">
            {writing.running || lecture.status === "outlining" ? (
              <p className="writing-note">
                <span className="dot" /> מתכננים את מבנה הסיכום לפי נושאי ההרצאה…{lecture.queued_at ? " (בשרת)" : ""}
              </p>
            ) : (
              <p className="a-muted">הסיכום עוד לא התחיל.</p>
            )}
          </div>
        ) : (
          sections.map((s) => {
            const streaming = writing.streaming(s);
            if (s.status === "ready") {
              const extras = ext.part?.(s) ?? {};
              return (
                <section key={s.idx} className="part" data-part={s.idx}>
                  <SummaryView
                    markdown={s.markdown}
                    figureUrl={figureUrl}
                    idPrefix={`s${s.idx}-`}
                    notes={flags.anchor ? undefined : notesByPart[s.idx]}
                    selected={selected?.part === s.idx ? selected.anchor : null}
                    marked={markOf(s.idx)}
                    onBlock={(anchor, quote) => {
                      guideMark("para"); // the guide's first step "לגעת בפסקה" (nothing without VITE_STUDY_GUIDE)
                      setSelected((cur) => (cur?.part === s.idx && cur.anchor === anchor ? null : { part: s.idx, anchor, quote }));
                    }}
                    onNotes={(anchor, quote) => onAction("comment", s.idx, anchor, quote)}
                    actions={actions}
                    onAction={(action, anchor, quote) => onAction(action, s.idx, anchor, quote)}
                    onTag={(slides) => setSlideOpen(slides[0])}
                    blockExtras={extras.blockExtras}
                    blockState={extras.blockState}
                  />
                </section>
              );
            }
            if (streaming !== undefined)
              return (
                <section key={s.idx} className="part writing" aria-busy="true">
                  <SummaryView markdown={streaming || `## ${s.title}`} figureUrl={figureUrl} idPrefix={`w${s.idx}-`} />
                  <p className="writing-note">
                    <span className="a-chip busy">
                      <span className="dot" /> נכתב עכשיו…
                    </span>
                  </p>
                </section>
              );
            return (
              <section key={s.idx} className="a-card dashed part placeholder" id={`part-${s.idx}`}>
                <div className="a-row between">
                  <h2 className="a-h2" dir="auto">
                    {s.title}
                  </h2>
                  {(s.status === "failed" && !startedOver(s)) || lecture.deleted_at ? (
                    <span className="a-chip warn">נעצר</span>
                  ) : s.status === "writing" && !isStuck(s) ? (
                    <span className="a-chip busy">נכתב</span>
                  ) : (
                    <span className="a-chip">בתור</span>
                  )}
                </div>
                <p className="a-small a-muted">
                  שקפים {s.slide_from}-{s.slide_to} · {writing.partLine(s)}
                </p>
              </section>
            );
          })
        )}
      </article>

      {writing.error ? (
        <p className="a-error" role="alert">
          {writing.error}
        </p>
      ) : null}

      {following && ext.followBar ? (
        <div className="ph-foot follow-bar" role="group" aria-label="בזמן המעקב">
          {ext.followBar}
        </div>
      ) : null}

      <footer className="lecture-foot">
        {writing.needsWork ? (
          <button className="a-btn primary wide" onClick={writing.continueWriting}>
            <Icon name="pen" size={16} />
            {writing.buttonText}
          </button>
        ) : null}
        {lecture.deleted_at ? (
          // Deleted (here or on another phone, W2): nothing on it can be marked, practised or deleted again;
          // the library lists it under "נמחקו לאחרונה" with its "שחזור".
          <div className="a-row">
            <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn">
              לספרייה · נמחקו לאחרונה
            </RouteLink>
          </div>
        ) : (
          <>
            {readyCount > 0 ? (
              <div className="a-row read-mark">
                <button className={`a-btn${iRead ? "" : " primary"}`} onClick={() => void toggleRead()} aria-pressed={iRead}>
                  {iRead ? "✓ קראתי" : "סימון שקראתי"}
                </button>
                <span className="a-small a-muted">{readers.length ? `קראו: ${readers.join(", ")}` : "עוד אין סימוני קריאה"}</span>
              </div>
            ) : null}
            {after && readyCount > 0 ? (
              <RouteLink to={after} go={ctx.go} className="a-btn after-reading">
                אחרי הקריאה: תרגול על ההרצאה
              </RouteLink>
            ) : null}
            {deleteError ? (
              <p className="a-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            {confirmDelete ? (
              <div className="a-callout warn confirm">
                <span>למחוק את ההרצאה לכל הקבוצה? הסיכום, השאלות, הכרטיסיות וההתקדמות של כל חברי הקבוצה בהרצאה יוסתרו. אפשר לשחזר עד 30 יום ב״נמחקו לאחרונה״.</span>
                <div className="a-row">
                  <button
                    className="a-btn danger"
                    onClick={() =>
                      void deleteLecture(lecture)
                        .then(() => ctx.go({ v: "library" }, { replace: true }))
                        .catch(() => setDeleteError("המחיקה לא הצליחה."))
                    }
                  >
                    מחיקה
                  </button>
                  <button className="a-btn ghost" onClick={() => setConfirmDelete(false)}>
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <div className="a-row">
                {flags.qtypes && needsGeo(lecture) ? (
                  <button className="a-btn ghost small geo-open" onClick={() => setGeoOpen(true)}>
                    לסמן תוויות בשרטוטים
                  </button>
                ) : null}
                <button className="a-btn ghost small" onClick={() => setConfirmDelete(true)}>
                  מחיקת ההרצאה
                </button>
              </div>
            )}
          </>
        )}
      </footer>

      {sheet ? (
        <ParagraphSheet
          lc={lc}
          spot={{ part: sheet.part, anchor: sheet.anchor, quote: sheet.quote }}
          tab={sheet.tab}
          onTab={(tab) => setSheet((cur) => (cur ? { ...cur, tab } : cur))}
          thread={{
            quote: sheet.quote,
            comments: threadComments,
            me: userId,
            nameOf,
            draft: drafts[draftKey] ?? "",
            onDraft: (text) => setDrafts((d) => ({ ...d, [draftKey]: text })),
            onSend: send,
            onResolve: resolve,
            onDelete: remove,
          }}
          onClose={closeSheets}
        />
      ) : null}
      {questionsOpen ? (
        <QuestionsSheet questions={openQuestions} nameOf={nameOf} onPick={jumpTo} onClose={closeSheets} />
      ) : null}
      {slideOpen !== null ? (
        <SlideSheet lecture={lecture} slide={slideOpen} onClose={() => setSlideOpen(null)} onParagraph={toSlide} figureUrl={figureByPath} />
      ) : null}
      {geoOpen ? (
        <Suspense fallback={null}>
          <GeoBackfill lecture={lecture} onClose={() => setGeoOpen(false)} />
        </Suspense>
      ) : null}
      {ext.overlay}
    </main>
  );
}

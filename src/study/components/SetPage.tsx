import { useCallback, useEffect, useState } from "react";
import type { ScreenProps } from "../features/types";
import { groupCreator } from "../lib/api";
import { hueOf } from "../lib/hue";
import { listQuestionsByIds, type PublicQuestion } from "../lib/practice";
import { requestStart } from "../lib/practiceSession";
import { deleteSet, hideSet, markSeen, openSet, renamed, renameSet, setLink, setRequests, setStats, setWhen, shareSet, watchSets, type OpenSet, type Stats } from "../lib/sets";
import { questionsWord, setBy, setFail, SETS, setReview, setUnchecked } from "../lib/setsCopy";
import "../styles/sets.css";
import MakeProgress from "./MakeProgress";
import { HowChoice } from "./PracticeRound";
import SetStats from "./SetStats";
import { Avatar, BackLink, Head, Loading, OFFLINE_LINE, RouteLink, Sheet, StickyActions, useOnline } from "./Shell";

/* ── A set (practice sets, design §5.5-5.7; VITE_STUDY_SETS) ──
 * ?v=sets&k=<set>: one link for every member (decision 1: members only).
 * While the set is being made, its generating screen ("סט בהכנה",
 * MakeProgress for the set's request); once it is ready, its page: the
 * title, "מאת {name}" and when, its size, the group's numbers (SetStats,
 * OD5), "לעבור על השאלות", the drafts the check could not run on ("לאשר
 * או להסיר"), and at the bottom "לפתור" (רגיל or מצב מבחן, remembered on
 * the device) and "לשלוח קישור" (the share sheet's generic text, no title
 * and no lecture). The menu (⋯): "לשנות שם" for the author, "להסתיר
 * אצלי"/"להחזיר" for anyone, "למחוק את הסט" for the author or the group's
 * creator (soft: the questions stay in the bank; OD3). Opening the page
 * clears "חדש". Offline, what is loaded stays. */

const howKey = (user: string) => `study-set-how:${user}`;
function loadHow(user: string): boolean {
  try {
    return localStorage.getItem(howKey(user)) === "exam";
  } catch {
    return false;
  }
}
function saveHow(user: string, timed: boolean): void {
  try {
    localStorage.setItem(howKey(user), timed ? "exam" : "plain");
  } catch {
    // remembered for this visit only
  }
}

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

export default function SetPage({ route, ctx }: ScreenProps<"sets">) {
  const setId = route.k ?? "";
  const [data, setData] = useState<OpenSet | null>(null);
  const [stats, setStatsState] = useState<Stats | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [creator, setCreator] = useState<string | null>(null);
  const [menu, setMenu] = useState<null | "menu" | "rename" | "delete" | "link">(null);
  const [title, setTitle] = useState("");
  const [timed, setTimed] = useState(() => loadHow(ctx.userId));
  const [stems, setStems] = useState<PublicQuestion[] | null>(null);
  const online = useOnline();

  const load = useCallback(async () => {
    try {
      const d = await openSet(setId);
      setData(d);
      setPhase("ready");
      if (d.set.state !== "ready" || d.set.made > d.set.size) setRequest((await setRequests(setId).catch(() => []))[0] ?? null);
      setStatsState(await setStats(setId).catch(() => null));
      if (d.set.is_new) void markSeen([setId]).catch(() => undefined);
    } catch (e) {
      const code = codeOf(e);
      setPhase((p) => (code === "set not found" || code === "forbidden" ? "none" : p === "ready" ? p : "error"));
    }
  }, [setId]);

  useEffect(() => {
    void load();
    groupCreator(ctx.group.id)
      .then(setCreator)
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchSets({ setId }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 500);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [setId, load, ctx.group.id]);

  const back = <BackLink go={ctx.go} fallback={{ v: "sets" }} />;
  const act = (run: () => Promise<unknown>, after: () => void) => {
    run()
      .then(after)
      .catch((e) => ctx.say(setFail(codeOf(e))));
  };
  if (phase === "loading") return <Loading />;
  if (phase === "none" || phase === "error" || !data) {
    return (
      <main className="qs-page">
        <Head back={back} title={SETS.shelf.title} />
        <p className={phase === "error" ? "a-error" : "a-muted"} role={phase === "error" ? "alert" : undefined}>
          {phase === "error" ? SETS.make.loadFail : SETS.set.notFound}
        </p>
        {phase === "error" ? (
          <button type="button" className="a-btn" onClick={() => void load()}>
            {SETS.make.retry}
          </button>
        ) : (
          <RouteLink to={{ v: "sets" }} go={ctx.go} className="a-btn">
            {SETS.shelf.title}
          </RouteLink>
        )}
      </main>
    );
  }

  const s = data.set;
  const by = s.author_name ? setBy(s.author_name, setWhen(s.created_at)) : setWhen(s.created_at);
  const mayDelete = s.is_mine || (creator !== null && creator === ctx.userId);
  // Being made, or checked questions still waiting to be kept (auto-keep ships
  // off, OD15; the author's device keeps them when writing ends): the
  // generating screen, for the set. Its page takes over once the set is ready
  // and nothing but the drafts the check could not run on waits.
  if ((s.state !== "ready" || s.made - data.unchecked.length > s.size) && s.lecture_id) {
    if (request || s.state === "ready") {
      if (!request) return <Loading />;
      return (
        <MakeProgress
          key={request}
          route={{ v: "practice", l: s.lecture_id, x: "bank", r: request }}
          ctx={ctx}
          set={{ id: s.id, by, onDone: () => void load() }}
        />
      );
    }
    // Begun but not written yet (its request never came, or the lecture is still
    // read): the text, and once it is stuck, a way out for the author or the
    // group's creator (it is removed; it has no questions).
    return (
      <main className="qs-page">
        <Head back={back} title={SETS.gen.title} />
        <p className="a-small a-muted mk-by">{by}</p>
        <p className="a-muted" role="status">
          {s.paused ? SETS.gen.paused : SETS.gen.reading}
        </p>
        {s.paused && mayDelete ? (
          <div className="a-stack qs-stuck">
            <p className="a-small">{SETS.set.abandonNote}</p>
            <div className="a-row">
              <button type="button" className="a-btn danger" onClick={() => act(() => deleteSet(s.id), () => ctx.go({ v: "sets" }, { replace: true }))}>
                {SETS.set.menu.delete}
              </button>
              <RouteLink to={{ v: "practice", l: s.lecture_id, x: "new" }} go={ctx.go} className="a-btn ghost">
                {SETS.entry}
              </RouteLink>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  const mine = s.is_mine;
  const solve = () => {
    const r = { v: "practice" as const, s: `k.${s.id}` };
    saveHow(ctx.userId, timed);
    requestStart(ctx.userId, r, timed);
    ctx.go(r);
  };
  const share = async () => {
    const got = await shareSet(s.id, s.size);
    if (got === "copied") ctx.say(SETS.set.linkCopied);
    // Neither the share sheet nor the clipboard: the link itself, to copy.
    if (got === "failed") setMenu("link");
  };
  const openStems = () => {
    if (stems || !data.items.length) return;
    listQuestionsByIds(data.items.map((i) => i.question_id))
      .then((qs) => {
        const at = new Map(data.items.map((i) => [i.question_id, i.pos]));
        setStems(qs.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)));
      })
      .catch(() => setStems([]));
  };

  return (
    <main className="qs-page">
      {/* No title in the bar: the back label names the shelf, the card's heading the set. */}
      <Head back={back}>
        <button type="button" className="a-btn ghost icon qs-menu" aria-label={SETS.set.menuLabel} aria-haspopup="dialog" onClick={() => setMenu("menu")}>
          ⋯
        </button>
      </Head>
      {!online ? (
        <p className="a-small a-muted qs-offline" role="status">
          {OFFLINE_LINE}
        </p>
      ) : null}
      <div className="qs-page-grid">
        <section className="a-card qs-head" data-hue={hueOf(s.lecture_id ?? s.id)}>
          <h1 className="a-h1" dir="auto">
            {s.title}
          </h1>
          <p className="a-row qs-by">
            {s.author_id && s.author_name ? <Avatar id={s.author_id} name={s.author_name} /> : null}
            <span className="a-small">{by}</span>
          </p>
          {/* The default title already says the lecture and the size. */}
          {renamed(s) ? <p className="a-small a-muted">{[s.lecture_title, questionsWord(s.size)].filter(Boolean).join(" · ")}</p> : null}
        </section>
        <SetStats stats={stats} size={s.size} />
      </div>
      {data.items.length ? (
        <details className="qs-review" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && openStems()}>
          <summary>{setReview(data.items.length)}</summary>
          {stems ? (
            <ol className="a-list qs-stems">
              {stems.map((q) => (
                <li key={q.id} className="a-small" dir="auto">
                  {`${q.vignette ? `${q.vignette} ` : ""}${q.question}`.replace(/\*\*/g, "").slice(0, 120)}
                </li>
              ))}
            </ol>
          ) : (
            <Loading />
          )}
        </details>
      ) : null}
      {data.unchecked.length && s.lecture_id ? <UncheckedLink setId={s.id} lectureId={s.lecture_id} n={data.unchecked.length} ctx={ctx} /> : null}
      <section className="qs-how" aria-labelledby="qs-how-h">
        <div className="a-sec">
          <h2 id="qs-how-h">{SETS.set.how}</h2>
        </div>
        <HowChoice timed={timed} onChange={setTimed} labelledBy="qs-how-h" />
      </section>
      <StickyActions>
        <button type="button" className="a-btn primary wide qs-go" disabled={s.size < 1} onClick={solve}>
          {s.my_score !== null ? SETS.set.solveAgain : SETS.set.solve}
        </button>
        <button type="button" className="a-btn ghost qs-share" onClick={() => void share()}>
          {SETS.set.link}
        </button>
      </StickyActions>

      {menu === "menu" ? (
        <Sheet label={SETS.set.menuLabel} className="qs-menu-sheet" onClose={() => setMenu(null)} head={<h2 dir="auto">{s.title}</h2>}>
          {(sheet) => (
            <ul className="a-list">
              {mine ? (
                <li>
                  <button
                    type="button"
                    className="a-li"
                    onClick={() =>
                      sheet.closeThen(() => {
                        setTitle(s.title);
                        setMenu("rename");
                      })
                    }
                  >
                    {SETS.set.menu.rename}
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  className="a-li"
                  onClick={() => sheet.closeThen(() => act(() => hideSet(s.id, !s.is_hidden), () => (s.is_hidden ? void load() : ctx.go({ v: "sets" }, { replace: true }))))}
                >
                  {s.is_hidden ? SETS.set.menu.unhide : SETS.set.menu.hide}
                </button>
              </li>
              {mayDelete ? (
                <li>
                  <button type="button" className="a-li qs-delete" onClick={() => sheet.closeThen(() => setMenu("delete"))}>
                    {SETS.set.menu.delete}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </Sheet>
      ) : null}
      {menu === "link" ? (
        <Sheet label={SETS.set.linkSheet} onClose={() => setMenu(null)} head={<h2>{SETS.set.linkSheet}</h2>}>
          {() => (
            <div className="a-stack">
              <p className="a-small a-muted">{SETS.set.linkHint}</p>
              <input className="a-input qs-link" dir="ltr" readOnly value={setLink(s.id)} aria-label={SETS.set.linkSheet} onFocus={(e) => e.currentTarget.select()} autoFocus />
            </div>
          )}
        </Sheet>
      ) : null}
      {menu === "rename" ? (
        <Sheet label={SETS.set.menu.rename} onClose={() => setMenu(null)} head={<h2>{SETS.set.menu.rename}</h2>}>
          {(sheet) => (
            <form
              className="a-stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) sheet.closeThen(() => act(() => renameSet(s.id, title), () => void load()));
              }}
            >
              <input className="a-input" dir="auto" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={SETS.set.menu.rename} />
              <button type="submit" className="a-btn primary" disabled={!title.trim()}>
                {SETS.set.save}
              </button>
            </form>
          )}
        </Sheet>
      ) : null}
      {menu === "delete" ? (
        <Sheet label={SETS.set.menu.delete} onClose={() => setMenu(null)} head={<h2>{SETS.set.menu.delete}</h2>}>
          {(sheet) => (
            <>
              <p>{SETS.set.deleteConfirm}</p>
              <div className="a-row sheet-actions">
                <button type="button" className="a-btn danger" onClick={() => sheet.closeThen(() => act(() => deleteSet(s.id), () => ctx.go({ v: "sets" }, { replace: true })))}>
                  {SETS.set.menu.delete}
                </button>
                <button type="button" className="a-btn ghost" onClick={sheet.close}>
                  {SETS.make.bigNo}
                </button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}
    </main>
  );
}

/** "שאלה אחת לא נבדקה · לאשר או להסיר": the request's drafts one by one (practice 2.0's review). */
function UncheckedLink({ setId, lectureId, n, ctx }: { setId: string; lectureId: string; n: number; ctx: ScreenProps<"sets">["ctx"] }) {
  const [request, setRequest] = useState<string | null>(null);
  useEffect(() => {
    setRequests(setId)
      .then((r) => setRequest(r[0] ?? null))
      .catch(() => undefined);
  }, [setId]);
  if (!request) return null;
  return (
    <RouteLink to={{ v: "practice", l: lectureId, x: "review", r: request }} go={ctx.go} className="a-small a-link qs-unchecked">
      {setUnchecked(n)} ‹
    </RouteLink>
  );
}

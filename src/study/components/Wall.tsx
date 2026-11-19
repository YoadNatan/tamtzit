import "../styles/wall.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { figureUrls, getLecture, getSections, type Lecture, type Section } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isolateLatin, richText } from "../lib/rich";
import { paragraphs, readLocal, setComposerSeed, tabKey, tabRows, watchWall, getWall, writeLocal, type Aid, type WallTab } from "../lib/wall";
import type { ScreenProps } from "../features/types";
import { Icon } from "./Icon";
import { useNeededCards } from "../features/pulse";
import { BackLink, Head, Loading, Sheet, StickyActions } from "./Shell";
import ComposerScreen from "./WallComposer";
import WallDrafts from "./WallDrafts";
import WallEntry from "./WallEntry";

/* ── The association wall (package J; wall.html s1, fun design §5.5, W-1 … W-9) ──
 *
 * ?v=wall&l=<lecture> (a lecture's), ?v=wall&d=<drug> (a drug's across
 * lectures), ?v=wall (the group's). The head "אסוציאציות · {title}" and the
 * count; the tabs "הכי טובות" · "חדשות" · "דרושות" (only with the pulse,
 * package U: its "דרושה אסוציאציה" cards come from `useNeeded` below, each
 * with "משלי" · "תנו לי 3 מצחיקות" on its paragraph) · "שלי"; the entries (WallEntry), live through
 * study-wall-<lecture>; and the one action, "תנו לי 3 מצחיקות", which asks
 * "על איזו פסקה?" and opens the paragraph's drafts. x=drafts and x=post
 * (and x=moment) are the drafts screen and the composer. */

/** "דרושה אסוציאציה": the cards at least 3 members keep forgetting, from U's
 *  pulse (study_pulse_needed: a paragraph with a winner already is left out).
 *  Empty without the flag `pulse` (the tab is hidden then too). */
function useNeeded(groupId: string, lectureId: string | undefined): Array<{ part: number; anchor: number; text: string; slides: number[] }> {
  const rows = useNeededCards(groupId, lectureId);
  return useMemo(
    () => rows.filter((r) => r.part_idx != null && r.anchor != null).map((r) => ({ part: r.part_idx as number, anchor: r.anchor as number, text: r.front, slides: r.slides ?? [] })),
    [rows],
  );
}

export default function WallScreen({ route, ctx }: ScreenProps<"wall">) {
  const [lecture, setLecture] = useState<Lecture | null | undefined>(route.l ? undefined : null);
  const [sections, setSections] = useState<Section[]>([]);
  const [figs, setFigs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!route.l) return;
    let alive = true;
    Promise.all([getLecture(route.l), getSections(route.l)])
      .then(([l, s]) => {
        if (!alive) return;
        setLecture(l);
        setSections(s);
        const paths = (l?.slides ?? []).flatMap((x) => (x.figures ?? []).map((f) => f.path));
        if (paths.length) figureUrls(paths).then((u) => alive && setFigs(u)).catch(() => undefined);
      })
      .catch(() => alive && setLecture(null));
    return () => {
      alive = false;
    };
  }, [route.l]);
  const figureUrl = useCallback((p: string) => figs[p], [figs]);

  if (route.l && lecture === undefined) return <Loading />;
  if (route.l && !lecture)
    return (
      <main className="wall-screen">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="אסוציאציות" />
        <p className="a-card dashed">ההרצאה לא נמצאה.</p>
      </main>
    );
  if (lecture && route.x === "drafts") return <WallDrafts route={route} ctx={ctx} lecture={lecture} sections={sections} />;
  if (lecture && (route.x === "post" || route.x === "moment")) return <ComposerScreen route={route} ctx={ctx} lecture={lecture} sections={sections} figureUrl={figureUrl} />;
  return <WallList route={route} ctx={ctx} lecture={lecture ?? null} sections={sections} figureUrl={figureUrl} />;
}

const TABS: Array<{ id: WallTab; label: string; on: boolean }> = [
  { id: "top", label: "הכי טובות", on: true },
  { id: "new", label: "חדשות", on: true },
  { id: "needed", label: "דרושות", on: flags.pulse },
  { id: "mine", label: "שלי", on: true },
];

function WallList({ route, ctx, lecture, sections, figureUrl }: ScreenProps<"wall"> & { lecture: Lecture | null; sections: Section[]; figureUrl: (p: string) => string | undefined }) {
  const [rows, setRows] = useState<Aid[] | null>(null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const stored = readLocal(tabKey(ctx.userId)) as WallTab;
  const tab: WallTab = route.t ?? (TABS.some((t) => t.on && t.id === stored) ? stored : "top");
  const needed = useNeeded(ctx.group.id, route.l ? lecture?.id : undefined);

  const load = useCallback(() => {
    getWall(ctx.group.id, { lecture: route.l, drug: route.d })
      .then((r) => {
        setRows(r);
        setError("");
      })
      .catch((e) => setError(failText(e instanceof Error ? e.message : "", "wall")));
  }, [ctx.group.id, route.l, route.d]);
  useEffect(() => {
    load();
    if (!route.l) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchWall(route.l, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [load, route.l]);

  const shown = useMemo(() => tabRows(rows ?? [], tab), [rows, tab]);
  const choose = (t: WallTab) => {
    writeLocal(tabKey(ctx.userId), t);
    ctx.go({ ...route, t }, { replace: true });
  };
  // A moment's picture: its slide's figure by "fig:n-k".
  const figureOf = (fig: string) => {
    const m = /^fig:(\d+)-(\d+)$/.exec(fig);
    const path = m && lecture?.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path;
    return path ? figureUrl(path) : undefined;
  };
  const title = lecture?.title ?? route.d ?? "";
  const empty =
    tab === "needed" ? "אין כרגע כרטיס שלפחות 3 מכם שוכחים." : tab === "mine" ? "כאן יופיעו האסוציאציות שנעצת לעצמך ומה שהעלית." : "עוד אין אסוציאציות בהרצאה הזו. מתחילים מפסקה: נוגעים בה ואז ״אסוציאציה״, או ״תנו לי 3 מצחיקות״.";
  const paras = useMemo(() => (picking ? paragraphs(sections) : []), [picking, sections]);

  return (
    <main className="wall-screen wall-list">
      <Head back={lecture ? <BackLink go={ctx.go} fallback={{ v: "lecture", l: lecture.id }} /> : undefined}>
        <h1 className="t">
          {title ? (
            <>
              אסוציאציות · {isolateLatin(title, "wt")}
            </>
          ) : (
            "קיר האסוציאציות"
          )}
        </h1>
        {rows ? <span className="a-chip fun wall-count">{rows.length}</span> : null}
      </Head>
      <nav className="ph-sub wall-tabs" aria-label="סינון הקיר">
        {TABS.filter((t) => t.on).map((t, i) => (
          <span key={t.id} className="a-row">
            {i ? <span aria-hidden="true">·</span> : null}
            <button type="button" className={`a-link wall-tab${t.id === tab ? " on" : ""}`} aria-pressed={t.id === tab} onClick={() => choose(t.id)}>
              {t.label}
            </button>
          </span>
        ))}
      </nav>
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null && !error ? <p className="a-muted loading">טוען…</p> : null}
      {rows !== null && !shown.length && !(tab === "needed" && needed.length) ? <p className="a-card dashed empty">{empty}</p> : null}
      <div className="a-stack wall-entries">
        {shown.map((a) => (
          <WallEntry key={a.id} ctx={ctx} aid={a} figureUrl={figureOf} onChange={load} showLecture={!route.l} />
        ))}
      </div>
      {(tab === "needed" || tab === "top") && needed.length
        ? needed.slice(0, tab === "top" ? 1 : needed.length).map((n) => (
            <aside key={`${n.part}.${n.anchor}`} className="a-callout warn wall-needed">
              <div className="a-stack">
                <span>
                  <b>דרושה אסוציאציה.</b> כמה מכם שוכחים את זה: {richText(n.text, `n${n.part}.${n.anchor}`)}
                  {n.slides[0] ? (
                    <>
                      {" "}
                      <span className="a-tag">ש׳ {n.slides[0]}</span>
                    </>
                  ) : null}
                </span>
                {lecture ? (
                  <span className="a-row wall-needed-acts">
                    <button type="button" className="a-btn small" onClick={() => {
                        setComposerSeed({ lectureId: lecture.id, part: n.part, anchor: n.anchor, mode: "line" });
                        ctx.go({ v: "wall", l: lecture.id, at: { part: n.part, anchor: n.anchor }, x: "post" });
                      }}>
                      משלי
                    </button>
                    <button type="button" className="a-btn small primary" onClick={() => ctx.go({ v: "wall", l: lecture.id, at: { part: n.part, anchor: n.anchor }, x: "drafts" })}>
                      תנו לי 3 מצחיקות
                    </button>
                  </span>
                ) : null}
              </div>
            </aside>
          ))
        : null}
      {lecture ? (
        <StickyActions>
          <button className="a-btn primary wide" onClick={() => setPicking(true)}>
            <Icon name="smile" size={14} /> תנו לי 3 מצחיקות
          </button>
        </StickyActions>
      ) : null}
      {picking && lecture ? (
        <Sheet label="על איזו פסקה?" className="wall-sheet" onClose={() => setPicking(false)} head={<h2>על איזו פסקה?</h2>}>
          {(sheet) => (
            <ul className="a-list wall-pick">
              {paras.map((p) => (
                <li key={`${p.part}.${p.anchor}`}>
                  <button className="a-li" onClick={() => sheet.closeThen(() => ctx.go({ v: "wall", l: lecture.id, at: { part: p.part, anchor: p.anchor }, x: "drafts" }))}>
                    <div>
                      <b dir="rtl">{isolateLatin(p.quote, `q${p.part}.${p.anchor}`)}</b>
                      <span className="m">
                        {isolateLatin(p.title, `t${p.part}`)}
                        {p.slides.length ? ` · ש׳ ${p.slides.slice(0, 3).join(",")}` : ""}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
              {!paras.length ? <li className="a-small a-muted">עוד אין פסקאות מוכנות בהרצאה.</li> : null}
            </ul>
          )}
        </Sheet>
      ) : null}
    </main>
  );
}

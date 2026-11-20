import { useEffect, useMemo, useState } from "react";
import {
  groupOpenQuestions,
  groupReadMarks,
  listLectures,
  members,
  partTitles,
  purgeDue,
  recentlyDeleted,
  restoreLecture,
  watchGroup,
  type LectureRow,
  type Member,
  type ReadMark,
} from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { hueOf } from "../lib/hue";
import { AccountBanners } from "../features/account";
import { useCardsChip } from "../features/cards";
import { BatchResumeLine, CourseHeading, useCourseLinks } from "../features/courses";
import { GuideHome } from "../features/guide";
import { useAsksLeft, useEditsChip } from "../features/collab";
import { usePracticeChip } from "../features/practice";
import type { Ctx } from "../features/types";
import { Head, RouteLink, shareInvite } from "./Shell";
import { timeAgo } from "./Together";

/* ── The group's shelf ──
 * Every lecture anyone in the group uploaded, newest first, grouped by course.
 * Updates live when a friend uploads or a summary finishes. Each card is one
 * link to the lecture, with the packages' chips beside it as links of their
 * own (review UX-14). Deleted lectures wait 30 days under "נמחקו לאחרונה". */

const STATUS: Record<LectureRow["status"], { label: string; cls: string }> = {
  new: { label: "ממתינה לכתיבה", cls: "a-chip" },
  outlining: { label: "מתכנן את הסיכום", cls: "a-chip busy" },
  writing: { label: "נכתב עכשיו", cls: "a-chip busy" },
  ready: { label: "מוכן", cls: "a-chip ok" },
  failed: { label: "נתקע", cls: "a-chip bad" },
};

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

export default function Library({ ctx }: { ctx: Ctx }) {
  const { group } = ctx;
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [deleted, setDeleted] = useState<LectureRow[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [reads, setReads] = useState<ReadMark[]>([]);
  const [questions, setQuestions] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState<Array<{ lecture_id: string; idx: number; title: string }>>([]);
  const asksLeft = useAsksLeft(ctx);
  const practiceChip = usePracticeChip(ctx);
  const cardsChip = useCardsChip(ctx);
  const editsChip = useEditsChip(ctx);
  // The course pages (sources.md): each course heading links to its page. A new course gets its row
  // from the upload, so the list is read again when the courses on the shelf change.
  const courseStamp = [...new Set((lectures ?? []).map((l) => l.course.trim().toLowerCase()))].sort().join("|");
  const courseOf = useCourseLinks(ctx, courseStamp);

  useEffect(() => {
    let alive = true;
    // Refreshes can overlap (two quick changes); only the newest one is applied.
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      const current = () => alive && mine === seq;
      return listLectures(group.id)
        .then(async (l) => {
          if (!current()) return;
          setLectures(l);
          setError("");
          // Who read what, open questions, deleted lectures: extras, so a failure only hides them.
          const [r, q, d] = await Promise.all([
            groupReadMarks(group.id).catch(() => null),
            groupOpenQuestions(group.id).catch(() => null),
            recentlyDeleted(group.id).catch(() => null),
          ]);
          if (!current()) return;
          if (r) setReads(r);
          if (q) setQuestions(q);
          if (d) setDeleted(d);
        })
        .catch(() => current() && setError("הספרייה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב."));
    };
    void load();
    members(group.id).then((m) => alive && setPeople(m)).catch(() => undefined);
    void purgeDue(group.id).catch(() => undefined); // lectures hidden over 30 days, once a day
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchGroup(group.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [group.id]);

  // The search bar's part headings (with לשאול on).
  const ids = (lectures ?? []).map((l) => l.id).join(",");
  useEffect(() => {
    if (!flags.ask || !ids) return;
    let alive = true;
    partTitles(ids.split(",")).then((p) => alive && setParts(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ids, group.id]);

  const byCourse = useMemo(() => {
    const map = new Map<string, LectureRow[]>();
    for (const l of lectures ?? []) {
      const key = l.course.trim() || "בלי קורס";
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    return [...map.entries()];
  }, [lectures]);

  // Local search: titles and part headings (nothing is sent anywhere).
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ key: string; lecture: LectureRow; part?: { idx: number; title: string } }> = [];
    for (const l of lectures ?? []) if (l.title.toLowerCase().includes(q)) out.push({ key: l.id, lecture: l });
    for (const p of parts) {
      const l = (lectures ?? []).find((x) => x.id === p.lecture_id);
      if (l && p.title.toLowerCase().includes(q)) out.push({ key: `${p.lecture_id}.${p.idx}`, lecture: l, part: p });
    }
    return out.slice(0, 8);
  }, [query, lectures, parts]);

  const nameOf = (id: string) => people.find((p) => p.user_id === id)?.name ?? "";

  const upload = () => ctx.go({ v: "upload" });

  const restore = async (l: LectureRow) => {
    try {
      await restoreLecture(l.id);
      setDeleted((d) => d.filter((x) => x.id !== l.id));
      setLectures((cur) => (cur ? [{ ...l, deleted_at: null, deleted_by: null }, ...cur.filter((x) => x.id !== l.id)] : cur));
    } catch (e) {
      ctx.say(failText(e instanceof Error ? e.message : "", "group"));
    }
  };

  return (
    <main className="library">
      <Head title={group.name}>
        {/* With the guide, Head's own "?" is the library's mini-guide; its last step opens help. */}
        {flags.guide ? null : (
          <RouteLink to={{ v: "help" }} go={ctx.go} className="a-btn ghost icon help-btn" label="עזרה">
            ?
          </RouteLink>
        )}
      </Head>
      {/* Always this line, so the page does not move when the members arrive (Back restores the scroll). */}
      <p className="ph-sub lib-hello">
        <span>שלום {group.me}</span>
        {people.length ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{`${people.length} בקבוצה`}</span>
          </>
        ) : null}
      </p>
      <div className="a-row lib-actions">
        <button className="a-btn primary wide" onClick={upload}>
          העלאת הרצאה
        </button>
        <button className="a-btn" onClick={() => void shareInvite(group.id, group.name, ctx.say)}>
          הזמנה לקבוצה
        </button>
      </div>
      {/* The guide's first steps, when the library is the home (before Today). */}
      {flags.guide && !flags.today ? <GuideHome ctx={ctx} home="library" /> : null}

      {flags.ask ? (
        <div className="ask-bar" role="search">
          <input
            type="search"
            enterKeyHint="search"
            // Empty, it is a Hebrew field (an empty dir=auto field is left to right); typed text sets its own direction.
            dir={query ? "auto" : "rtl"}
            value={query}
            maxLength={500}
            className="a-input"
            placeholder="לשאול או לחפש בהרצאות…"
            aria-label="לשאול או לחפש בהרצאות"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // The keyboard's search key never pays: Enter opens the first hit (review UX-13).
              if (e.key !== "Enter" || !hits.length) return;
              e.preventDefault();
              const h = hits[0];
              ctx.go(h.part ? { v: "lecture", l: h.lecture.id, at: { part: h.part.idx, anchor: 0 } } : { v: "lecture", l: h.lecture.id });
            }}
          />
          {query.trim() ? (
            <ul className="a-list ask-hits">
              {hits.map((h) => (
                <li key={h.key}>
                  <RouteLink
                    to={h.part ? { v: "lecture", l: h.lecture.id, at: { part: h.part.idx, anchor: 0 } } : { v: "lecture", l: h.lecture.id }}
                    go={ctx.go}
                    className="a-li ask-hit"
                  >
                    <span>
                      <bdi>{h.part ? h.part.title : h.lecture.title}</bdi>
                      {h.part ? <span className="a-muted a-small"> · <bdi>{h.lecture.title}</bdi></span> : null}
                    </span>
                  </RouteLink>
                </li>
              ))}
              <li>
                <RouteLink to={{ v: "ask", first: query.trim() }} go={ctx.go} className="a-li ask-hit ask-row">
                  לשאול: ״<bdi>{query.trim()}</bdi>״{asksLeft !== null ? ` · נשארו היום ${asksLeft}` : ""}
                </RouteLink>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}

      <AccountBanners ctx={ctx} />
      <BatchResumeLine ctx={ctx} />

      {error ? <p className="a-error">{error}</p> : null}

      {lectures === null ? (
        <p className="a-muted loading">טוען…</p>
      ) : lectures.length === 0 ? (
        <section className="a-card dashed empty">
          <h2 className="a-h2">עוד אין כאן הרצאות</h2>
          <p className="a-para a-muted">
            מעלים מצגת של הרצאה (PowerPoint או PDF), ובתוך כמה דקות יש סיכום מלא שכל הקבוצה רואה. הסיכום נשמר כאן, אז
            כל הרצאה מסוכמת פעם אחת בשביל כל הקבוצה.
          </p>
          <div className="a-row">
            <button className="a-btn primary" onClick={upload}>
              העלאת הרצאה ראשונה
            </button>
          </div>
        </section>
      ) : (
        byCourse.map(([course, list]) => (
          <section key={course} className="a-stack course">
            <div className="a-sec">
              <CourseHeading ctx={ctx} course={course} id={courseOf(course)} />
            </div>
            <ul className="a-stack lecture-list">
              {list.map((l) => {
                const status = l.status === "new" && l.queued_at ? { label: "ממתינה לשרת", cls: "a-chip" } : STATUS[l.status];
                const who = reads.filter((r) => r.lecture_id === l.id).map((r) => nameOf(r.user_id)).filter(Boolean);
                const open = questions[l.id] ?? 0;
                const p = practiceChip(l.id);
                const c = cardsChip(l.id);
                const k = editsChip(l.id);
                return (
                  <li key={l.id} className="a-card lc" data-anchor={`lecture-${l.id}`} data-hue={hueOf(l.id)}>
                    {/* The whole card opens the lecture; the chips under it are links of their own. */}
                    <RouteLink to={{ v: "lecture", l: l.id }} go={ctx.go} className="lecture-card">
                      <span className="lc-title" dir="auto">
                        {l.title}
                      </span>
                      <span className="lc-meta a-small a-muted">
                        {[l.lecturer, formatDate(l.lecture_date), nameOf(l.created_by) && `הועלה ע״י ${nameOf(l.created_by)}`].filter(Boolean).join(" · ")}
                      </span>
                      <span className="lc-state">
                        <span className={status.cls}>{status.label}</span>
                        {who.length || open ? (
                          <span className="lc-together">
                            {who.length ? <span>קראו: {who.join(", ")}</span> : null}
                            {open ? <span className="a-chip warn">{open === 1 ? "שאלה פתוחה" : `${open} שאלות פתוחות`}</span> : null}
                          </span>
                        ) : null}
                      </span>
                    </RouteLink>
                    {p || c || k ? (
                      <div className="a-wrap lc-chips">
                        {p}
                        {c}
                        {k}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {deleted.length ? (
        <section className="a-stack deleted" aria-labelledby="deleted-h">
          <div className="a-sec">
            <h2 id="deleted-h">נמחקו לאחרונה</h2>
          </div>
          <ul className="a-list">
            {deleted.map((l) => (
              <li key={l.id} className="a-li">
                <div>
                  <b>
                    <bdi>{l.title}</bdi>
                  </b>
                  <span className="m">
                    נמחקה{l.deleted_by && nameOf(l.deleted_by) ? ` ע״י ${nameOf(l.deleted_by)}` : ""}
                    {l.deleted_at ? ` · ${timeAgo(l.deleted_at)}` : ""}
                  </span>
                </div>
                <button className="a-btn small" onClick={() => void restore(l)}>
                  שחזור
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </main>
  );
}

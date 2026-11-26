import { useEffect, useState } from "react";
import { courseKey } from "../../../shared/study/courseKey";
import type { Ctx } from "../features/types";
import { sb } from "../lib/api";
import { coursesOf } from "../lib/courses";
import { RouteLink } from "./Shell";
import "../styles/sheetForms.css";

/* ── The lecture page's row: "דפי תרגילים של ההרצאה" (uploaded sheets,
 *    release A1; design-exams §9, D26) ──
 * Under the lecture's summary, the exercise sheets uploaded with this
 * lecture (study_exams of kind 'sheet', lecture_id this one; members read
 * their group's), each a link to its review and practice, and "+ העלאת דף
 * תרגילים" (the upload as a sheet, with this lecture and its course). It
 * loads lazily through the slot (features/sheets.tsx) with its own boundary,
 * so the lecture page's entry code holds only a condition, and a chunk that
 * cannot load costs the row, never the lecture. Nothing while the lecture has
 * no course on the course pages. */

type SheetRow = { id: string; title: string; status: string };

export default function SheetsLecture({ ctx, lectureId, course }: { ctx: Ctx; lectureId: string; course: string }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!sb) return;
    sb.from("study_exams")
      .select("id, title, status, kind, lecture_id, deleted_at")
      .eq("group_id", ctx.group.id)
      .eq("lecture_id", lectureId)
      .then(({ data }) => {
        if (!alive) return;
        const list = ((data ?? []) as Array<SheetRow & { kind: string; deleted_at: string | null }>).filter((e) => e.kind === "sheet" && !e.deleted_at);
        setRows(list);
      }, () => alive && setRows([]));
    coursesOf(ctx.group.id)
      .then((cs) => alive && setCourseId(cs.find((c) => c.name_key === courseKey(course))?.id ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, lectureId, course]);
  if (!rows || !courseId) return null;
  return (
    <section className="sl" aria-labelledby={`sl-${lectureId}`}>
      <h2 id={`sl-${lectureId}`}>דפי תרגילים של ההרצאה</h2>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <RouteLink to={{ v: "exams", e: r.id, c: courseId }} go={ctx.go} className="a-link">
                <bdi>{r.title}</bdi>
                {r.status === "ready" ? "" : r.status === "reading" ? " · מעתיקים…" : ""} ‹
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="a-small a-muted">עוד אין דף תרגילים להרצאה הזו.</p>
      )}
      <RouteLink to={{ v: "exams", isNew: "sheet", c: courseId, l: lectureId }} go={ctx.go} className="a-btn small sl-up">
        + העלאת דף תרגילים
      </RouteLink>
    </section>
  );
}

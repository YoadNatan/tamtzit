import { lazy, useCallback, useEffect, useState, type ReactNode } from "react";
import { courseKey } from "../../../shared/study/courseKey";
import { getLecture } from "../lib/api";
import { flags } from "../lib/flags";
import { releaseLater } from "../lib/later";
import { queueWriting } from "../lib/writing";
import { RouteLink } from "../components/Shell";
import type { Ctx, ScreenProps } from "./types";

/* ── Courses' slot (sources.md, phase 1; section S 1, VITE_STUDY_COURSES) ──
 * The course page (?v=course&c=<id>) and "העלאה של כמה קבצים"
 * (?v=upload&many=1) load lazily, each in its own chunk; "לשאול על כל
 * הקורס" is part of K's ask screen (?v=ask&c=<id>). What stays here is
 * small: the library's course links and its line for a batch that stopped
 * half way. The data modules (lib/courses.ts, lib/batch.ts) are imported
 * when the flag is on, never by the entry chunk. */

const CourseView = lazy(() => import("../components/CourseScreen"));
const UploadMany = lazy(() => import("../components/UploadMany"));

export function CourseScreen(p: ScreenProps<"course">) {
  return <CourseView key={p.route.c} {...p} />;
}

/** "העלאה של כמה קבצים" (Upload.tsx renders it for ?v=upload&many=1). */
export function UploadManyScreen(p: { ctx: Ctx; courses: string[]; courseId: string | null }) {
  return <UploadMany {...p} />;
}

/** The library's course headings as links to their pages: the course's id
 *  by its key (shared/study/courseKey.ts, as the SQL matches it), or none while the
 *  flag is off or the list has not come. `stamp` reloads it (the library's
 *  lectures changed: a new course gets its row from the upload). */
export function useCourseLinks(ctx: Ctx, stamp: string): (course: string) => string | null {
  const [ids, setIds] = useState<Record<string, string>>({});
  const groupId = ctx.group.id;
  useEffect(() => {
    if (!flags.courses) return;
    let alive = true;
    import("../lib/courses")
      .then(({ coursesOf }) => coursesOf(groupId))
      .then((rows) => alive && setIds(Object.fromEntries(rows.map((r) => [r.name_key, r.id]))))
      .catch(() => undefined); // an extra: a failure leaves the headings as text
    return () => {
      alive = false;
    };
  }, [groupId, stamp]);
  return useCallback((course: string) => (flags.courses ? (ids[courseKey(course)] ?? null) : null), [ids]);
}

/** A course's heading in the library: a link to its page when it has one. */
export function CourseHeading({ ctx, course, id }: { ctx: Ctx; course: string; id: string | null }): ReactNode {
  // Right to left, the name in its own <bdi>: dir="auto" skips a <bdi>, so an
  // English course name turned the heading (and its chevron) left to right.
  if (!id)
    return (
      <h2 dir="rtl">
        <bdi>{course}</bdi>
      </h2>
    );
  return (
    <h2 dir="rtl">
      <RouteLink to={{ v: "course", c: id }} go={ctx.go} className="lib-course">
        <bdi>{course}</bdi>
        <span className="lib-course-go" aria-hidden="true">
          ‹
        </span>
      </RouteLink>
    </h2>
  );
}

/** From the 1st of the month, the summaries a batch left for this month go
 *  to the writer (lib/later.ts): a lecture that is gone, written or already
 *  queued needs nothing; one the uploader's phone tried and the budget
 *  stopped starts over. The library and the course page call it. */
export function releaseWaiting(groupId: string): void {
  if (!flags.courses) return;
  void releaseLater(groupId, async (id) => {
    const l = await getLecture(id);
    if (!l || l.deleted_at || l.queued_at || (l.status !== "new" && l.status !== "failed")) return true;
    await queueWriting(l, { retryFailed: l.status === "failed" });
    return true;
  }).catch(() => undefined);
}

/** The library's line for a batch upload that stopped half way (the tab was
 *  closed): "הועלו 3. נשארו 11 קבצים" with a way back to it. Not while the
 *  batch still runs in this tab (the screen was left with Back). */
export function BatchResumeLine({ ctx }: { ctx: Ctx }) {
  const [line, setLine] = useState<{ text: string; courseId: string | null } | null>(null);
  const groupId = ctx.group.id;
  useEffect(() => {
    if (!flags.courses) return;
    let alive = true;
    releaseWaiting(groupId);
    import("../lib/batch")
      .then(({ batchRunning, readBatch, remaining, resumeLine }) => {
        const b = readBatch(groupId);
        if (alive && b && remaining(b).length && !batchRunning()) setLine({ text: resumeLine(b), courseId: b.courseId });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId]);
  if (!line) return null;
  return (
    <p className="a-callout quiet lib-batch">
      <span>העלאה של כמה קבצים נעצרה באמצע. {line.text}.</span>{" "}
      <RouteLink to={line.courseId ? { v: "upload", many: true, c: line.courseId } : { v: "upload", many: true }} go={ctx.go} className="a-link">
        להמשיך
      </RouteLink>
    </p>
  );
}

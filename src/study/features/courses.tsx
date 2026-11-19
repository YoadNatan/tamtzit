import { lazy, useCallback, useEffect, useState, type ReactNode } from "react";
import { flags } from "../lib/flags";
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

export function CourseScreen(p: ScreenProps<"course">) {
  return <CourseView key={p.route.c} {...p} />;
}

/** The library's course headings as links to their pages: the course's id
 *  by its text (lower(btrim()), as the SQL matches it), or none while the
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
  return useCallback((course: string) => (flags.courses ? (ids[course.trim().toLowerCase()] ?? null) : null), [ids]);
}

/** A course's heading in the library: a link to its page when it has one. */
export function CourseHeading({ ctx, course, id }: { ctx: Ctx; course: string; id: string | null }): ReactNode {
  if (!id) return <h2 dir="auto">{course}</h2>;
  return (
    <h2 dir="auto">
      <RouteLink to={{ v: "course", c: id }} go={ctx.go} className="lib-course">
        <bdi>{course}</bdi>
        <span className="lib-course-go" aria-hidden="true">
          ‹
        </span>
      </RouteLink>
    </h2>
  );
}

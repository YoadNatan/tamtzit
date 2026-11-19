"""Section T (package T): the meeting design's Today, with the review's
fixes (§12.10): one danger rule for the approved "על בטוח" row (the first
due row of section P's study_my_danger_list, F-9), the boss loot as a
source when section H is there (F-9), hidden questions out (F-6), and the
section loaded last, after U J H B G E, so every source it reads exists or
is guarded (F-9)."""
from lib import once, replace_fn

DANGER = r"""create or replace function public.study_my_danger(p_group uuid, p_now timestamptz default now())
returns table (question_id uuid, ask_id uuid, lecture_id uuid, wrong_at timestamptz, other_wording boolean)
language sql stable security definer set search_path = public as $$
  select d.question_id, d.ask_id, d.lecture_id, d.wrong_at, d.ask_id is distinct from d.question_id
    from public.study_my_danger_list(p_group, p_now) d
   where d.due_day <= study_private.day_of(p_now)
   order by d.due_day, d.wrong_at
   limit 1
$$;"""

TODAY = r"""create or replace function public.study_today(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare loot jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  if to_regprocedure('public.study_my_loot(uuid)') is not null then          -- section H (review F-9)
    execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.study_my_loot($1) x' into loot using p_group;
  end if;
  return jsonb_build_object(
    'quiz_returns', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.study_my_quiz_returns(p_group) x),
    'danger',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.study_my_danger(p_group) x),
    'unclear',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.study_my_unclear(p_group) x),
    'updates',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.study_my_updates(p_group) x),
    'loot',         loot,
    'missed',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.study_my_missed(p_group) x),
    'needs_me',     public.study_needs_me(p_group),
    'flame',        public.study_my_flame(p_group));
end;
$$;"""


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, """--  SECTION T · TODAY ("היום")   (package T; meeting addendum §7)
--  Last: it reads Q, Z, C, K, P, M and V. Re-runnable. Everything here is
--  the caller's own, computed for her alone; nothing is published.""", """--  SECTION T · TODAY ("היום")   (package T; spec §12.4.T)
--  The last section of the file (review F-9): it reads Q, Z, C, K, P, M and
--  V, and section H's loot when it is there. Re-runnable. Everything here is
--  the caller's own, computed for her alone; nothing is published. The
--  queue's other sources are the phone's: due cards and trap cards through
--  section C's queue (vaccines are trap cards, never a row of their own),
--  "רק אצלך חם" from section U's two reads, the private lane from section
--  G's lane (spec §12.4.T's table).""", "T: the header")
    t = once(t, """      join public.study_questions q on q.id = a.question_id and q.group_id = p_group
                                   and q.retired_at is null and q.stale_at is null and q.has_key
     where a.user_id = auth.uid() and a.mode = 'quiz' and not a.correct""", """      join public.study_questions q on q.id = a.question_id and q.group_id = p_group
                                   and q.retired_at is null and q.stale_at is null and q.hidden_at is null and q.has_key
     where a.user_id = auth.uid() and a.mode = 'quiz' and not a.correct""", "F-6: quiz returns without hidden questions")
    t = once(t, """-- One confident error ("על בטוח", wrong, still wrong) to try again in
-- another wording: the question on the same paragraph the caller has seen
-- least lately, else the same question.""", """-- Today's "על בטוח" row: the first due row of the danger list (section P's
-- study_my_danger_list: back the next day in another wording and 3 days
-- later, until right "על בטוח" twice). One rule for the one approved row
-- (review F-9).""", "F-9: the danger row's comment")
    t = replace_fn(t, "public.study_my_danger", DANGER, "F-9: the danger row is the danger list's first due row")
    t = once(t, """      join public.study_questions q on q.lecture_id = cd.lecture_id and q.topic = t.topic and q.retired_at is null""",
             """      join public.study_questions q on q.lecture_id = cd.lecture_id and q.topic = t.topic and q.retired_at is null and q.hidden_at is null""",
             "F-6: mastery without hidden questions")
    t = replace_fn(t, "public.study_today", TODAY, "F-9: the loot is a source")
    return t

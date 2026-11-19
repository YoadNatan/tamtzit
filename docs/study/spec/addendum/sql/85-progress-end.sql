-- ════════════════════════════════════════════════════════════════════════
--  SECTION P, its end · READINESS AS A RANGE, THE DANGER LIST, WEAK POINTS
--  BY ASPECT, CALIBRATION, AND A MOVED BLOCK IN A MARATHON   (package A,
--  milestone A2; server addendum §3.4)
--  Appended at the end of section P, inside its markers. P becomes 2.
--
--  Everything here is the caller's own and computed for her alone (definer
--  functions that read only rows with user_id = auth.uid()); nothing is
--  published, nothing is shown to anyone else. Release 8 (decision 12).
--
--  PR2 readiness per part of a lecture as a range ("טווח, לא ציון"), from
--      about 20 answers per part on: a 68% Wilson interval, its ends rounded
--      to the nearest 5%.
--  PR3 the danger list: wrong answers given "על בטוח" (practice, or a live
--      quiz's first vote). Each returns the next study day in another
--      wording, then 3 days after the first right "על בטוח", and leaves the
--      list after two right "על בטוח" answers on two different later days
--      (the same question or another on its paragraph).
--  PR4 weak points by aspect, as three buckets (חם · פושר · יושב טוב).
--  PR5 calibration: of the answers marked "על בטוח", how many were right;
--      shown from about 20 such answers.
--  PL2/PL5 a marathon's run-of-show step may carry "moved": a block moved
--      from a day that slipped ("הוזז מאתמול").
-- ════════════════════════════════════════════════════════════════════════
alter table public.study_answers add column if not exists confidence smallint check (confidence between 1 and 3);

-- PR2. The evidence is the first answer per question per study day, last 28 days.
create or replace function public.study_my_readiness(p_group uuid, p_now timestamptz default now())
returns table (lecture_id uuid, part_idx int, heading text, answers int, right_n int, lo int, hi int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  with ev as (
    select q.lecture_id, q.part_idx, a.correct,
           row_number() over (partition by a.question_id, public.study_day(a.answered_at) order by a.answered_at, a.id) as rn
      from public.study_answers a
      join public.study_questions q on q.id = a.question_id
     where a.user_id = auth.uid() and q.group_id = p_group and q.lecture_id is not null and q.part_idx is not null
       and q.retired_at is null and a.answered_at <= p_now and a.answered_at > p_now - interval '28 days'
  ), b as (
    select ev.lecture_id, ev.part_idx, count(*)::int as n, (count(*) filter (where ev.correct))::int as r
      from ev where ev.rn = 1 group by ev.lecture_id, ev.part_idx
  ), w as (
    select b.*, b.r::numeric / b.n as p from b
  )
  select w.lecture_id, w.part_idx, coalesce(s.title, ''), w.n, w.r,
         case when w.n >= 20 then greatest(0, round(20 * ((w.p + 1.0 / (2 * w.n)) - sqrt(w.p * (1 - w.p) / w.n + 1.0 / (4 * w.n * w.n)))
                                                    / (1 + 1.0 / w.n)) * 5)::int end,
         case when w.n >= 20 then least(100, round(20 * ((w.p + 1.0 / (2 * w.n)) + sqrt(w.p * (1 - w.p) / w.n + 1.0 / (4 * w.n * w.n)))
                                                    / (1 + 1.0 / w.n)) * 5)::int end
    from w left join public.study_sections s on s.lecture_id = w.lecture_id and s.idx = w.part_idx
   order by w.lecture_id, w.part_idx;
end;
$$;

-- PR3. The danger list (and the "על בטוח" row of Today: its first due item).
create or replace function public.study_my_danger_list(p_group uuid, p_now timestamptz default now())
returns table (question_id uuid, lecture_id uuid, wrong_at timestamptz, chosen text, right_text text, slides int[],
               rights int, due_day date, ask_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  with mine as (
    select a.question_id, a.correct, a.confidence, a.choice, a.answered_at, public.study_day(a.answered_at) as d,
           q.lecture_id, q.part_idx, (to_jsonb(q) ->> 'anchor')::int as anchor
      from public.study_answers a join public.study_questions q on q.id = a.question_id
     where a.user_id = auth.uid() and q.group_id = p_group and q.retired_at is null
       and a.answered_at <= p_now and a.answered_at > p_now - interval '60 days'
  ), start as (     -- the latest wrong "על בטוח" per question
    select distinct on (m.question_id) m.*
      from mine m where not m.correct and m.confidence = 3
     order by m.question_id, m.answered_at desc
  ), fixed as (     -- right "על בטוח" answers on later days, to it or to its paragraph
    select s.question_id, r.d
      from start s join mine r
        on r.correct and r.confidence = 3 and r.d > s.d
       and (r.question_id = s.question_id
            or (s.anchor is not null and r.lecture_id = s.lecture_id and r.part_idx = s.part_idx and r.anchor = s.anchor))
  ), f as (
    select x.question_id, count(distinct x.d)::int as rights, min(x.d) as first_d from fixed x group by x.question_id
  )
  select s.question_id, s.lecture_id, s.answered_at,
         case when s.choice is null then '' else q.options[s.choice + 1] end,
         q.options[k.answer + 1], q.slides,
         coalesce(f.rights, 0),
         (date '1970-01-01' + case when coalesce(f.rights, 0) = 0 then s.d + 1 else f.first_d + 3 end),
         coalesce((select q2.id from public.study_questions q2
                    where s.anchor is not null and q2.lecture_id = s.lecture_id and q2.part_idx = s.part_idx
                      and (to_jsonb(q2) ->> 'anchor')::int = s.anchor and q2.id <> s.question_id and q2.retired_at is null
                      and q2.has_key and (to_jsonb(q2) ->> 'hidden_at') is null and (to_jsonb(q2) ->> 'stale_at') is null
                    order by (select max(a.answered_at) from public.study_answers a where a.user_id = auth.uid() and a.question_id = q2.id) nulls first,
                             q2.created_at
                    limit 1), s.question_id)
    from start s
    join public.study_questions q on q.id = s.question_id
    join public.study_question_keys k on k.question_id = s.question_id
    left join f on f.question_id = s.question_id
   where coalesce(f.rights, 0) < 2
   order by 8, s.answered_at;
end;
$$;

-- PR4. Weak points by aspect: the caller's latest answer per question (all
-- lectures, or one), from 4 questions in an aspect.
create or replace function public.study_my_aspects(p_group uuid, p_lecture uuid default null)
returns table (aspect text, questions int, wrong_now int, bucket text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  with latest as (
    select distinct on (a.question_id) a.question_id, a.correct, q.aspect
      from public.study_answers a join public.study_questions q on q.id = a.question_id
     where a.user_id = auth.uid() and q.group_id = p_group and q.retired_at is null and q.has_key
       and (p_lecture is null or coalesce(q.lecture_id, q.ref_lecture) = p_lecture)
     order by a.question_id, a.answered_at desc
  )
  select l.aspect, count(*)::int, (count(*) filter (where not l.correct))::int,
         case when count(*) filter (where not l.correct) * 2 >= count(*) then 'hot'
              when count(*) filter (where not l.correct) * 4 >= count(*) then 'warm'
              else 'cool' end
    from latest l
   group by l.aspect
  having count(*) >= 4
   order by 3 desc, 2 desc, 1;
end;
$$;

-- PR5. Calibration: answers marked "על בטוח" (the first per question per
-- study day, last 60 days), per part, per lecture and overall (scope).
create or replace function public.study_my_calibration(p_group uuid, p_now timestamptz default now())
returns table (scope text, lecture_id uuid, part_idx int, sure int, sure_right int, pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  with ev as (
    select q.lecture_id, q.part_idx, a.correct,
           row_number() over (partition by a.question_id, public.study_day(a.answered_at) order by a.answered_at, a.id) as rn
      from public.study_answers a join public.study_questions q on q.id = a.question_id
     where a.user_id = auth.uid() and q.group_id = p_group and a.confidence = 3
       and a.answered_at <= p_now and a.answered_at > p_now - interval '60 days'
  ), e as (select * from ev where ev.rn = 1)
  select x.scope, x.lecture_id, x.part_idx, x.n, x.r, case when x.n >= 20 then round(100.0 * x.r / x.n)::int end
    from (
      select 'part'::text as scope, e.lecture_id, e.part_idx, count(*)::int as n, (count(*) filter (where e.correct))::int as r
        from e where e.lecture_id is not null and e.part_idx is not null group by e.lecture_id, e.part_idx
      union all
      select 'lecture', e.lecture_id, null::int, count(*)::int, (count(*) filter (where e.correct))::int
        from e where e.lecture_id is not null group by e.lecture_id
      union all
      select 'all', null::uuid, null::int, count(*)::int, (count(*) filter (where e.correct))::int from e having count(*) > 0
    ) x
   order by case x.scope when 'part' then 0 when 'lecture' then 1 else 2 end, x.n desc;
end;
$$;

-- PL2/PL5: a run-of-show step may say it was moved from a day that slipped.
create or replace function public.study_marathon__agenda_ok(p_agenda jsonb, p_lectures uuid[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  s jsonb;
  num constant text := '^[0-9]{1,4}$';
begin
  if p_agenda is null or jsonb_typeof(p_agenda) <> 'array' or jsonb_array_length(p_agenda) > 40 then return false; end if;
  for s in select x from jsonb_array_elements(p_agenda) as x loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(s) k where k not in ('k', 'l', 'from', 'to', 'min', 'n', 'mode', 'title', 'moved')) then
      return false;
    end if;
    if coalesce(s ->> 'k', '') not in ('intro', 'read', 'quiz', 'break', 'questions', 'free', 'wrap') then return false; end if;
    if jsonb_typeof(s -> 'min') is distinct from 'number' or (s ->> 'min') !~ num or (s ->> 'min')::int not between 1 and 240 then
      return false;
    end if;
    if s ? 'l' then
      if jsonb_typeof(s -> 'l') <> 'string' or (s ->> 'l') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not ((s ->> 'l')::uuid = any (coalesce(p_lectures, '{}'))) then
        return false;
      end if;
    elsif s ->> 'k' in ('read', 'quiz') then
      return false;
    end if;
    if s ? 'from' and (jsonb_typeof(s -> 'from') <> 'number' or (s ->> 'from') !~ num or (s ->> 'from')::int > 199) then return false; end if;
    if s ? 'to' and (jsonb_typeof(s -> 'to') <> 'number' or (s ->> 'to') !~ num or (s ->> 'to')::int > 199
                     or (s ? 'from' and (s ->> 'to')::int < (s ->> 'from')::int)) then
      return false;
    end if;
    if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n') !~ num or (s ->> 'n')::int not between 3 and 30) then return false; end if;
    if s ? 'mode' and coalesce(s ->> 'mode', '') not in ('coop', 'race') then return false; end if;
    if s ? 'title' and (jsonb_typeof(s -> 'title') <> 'string' or char_length(s ->> 'title') > 80) then return false; end if;
    if s ? 'moved' and jsonb_typeof(s -> 'moved') <> 'boolean' then return false; end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.study_my_readiness(uuid, timestamptz), public.study_my_danger_list(uuid, timestamptz),
  public.study_my_aspects(uuid, uuid), public.study_my_calibration(uuid, timestamptz) from public, anon;
grant execute on function public.study_my_readiness(uuid, timestamptz), public.study_my_danger_list(uuid, timestamptz),
  public.study_my_aspects(uuid, uuid), public.study_my_calibration(uuid, timestamptz) to authenticated;

insert into study_private.schema_sections (section, version) values ('P', 2)
on conflict (section) do update set version = excluded.version, loaded_at = now();

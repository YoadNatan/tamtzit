-- ════════════════════════════════════════════════════════════════════════
--  SECTION P · READING PROGRESS, PRIVATE NUMBERS, THE PLAN, MARATHONS   (owned by package A)
--  design-me.md §2.3 (block B). After section Q: its SQL functions read study_questions and study_answers.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  private progress, the study plan and
--  marathons for תמצית (item 7). Appended to supabase/study-schema.sql AFTER
--  the practice-questions block (it reads study_questions and study_answers);
--  the quiz and flashcards blocks may come before or after it. Re-runnable.
--
--  Who sees what: reading progress, the numbers and the plan are visible
--  only to their owner and never published; marathons and who is in are
--  visible to every member of the group and published to Realtime. Nothing
--  here calls Claude.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  2. Reading progress (private)
-- ═══════════════════════════════════════════════════════════════════════
-- A summary part counts as read once its end reached the reading line and
-- the member spent long enough on it (LectureView's tracker), or by hand
-- (a plan task ticked). seconds = time spent on the part, for the member's
-- own reading speed. Never published: (user, lecture) keys stay private.
create table if not exists public.study_read_parts (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  done_at    timestamptz not null default now(),
  seconds    int         not null default 0 check (seconds between 0 and 86400),
  primary key (user_id, lecture_id, part_idx)
);
create index if not exists study_read_parts_lecture on public.study_read_parts (lecture_id);

-- Where the member stopped in a lecture: "continue where you stopped" on
-- any device.
create table if not exists public.study_read_places (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (user_id, lecture_id)
);
create index if not exists study_read_places_lecture on public.study_read_places (lecture_id);

-- A part that is deleted (the lecture was split into parts again) takes the
-- members' "read" marks for its number with it: the new part with that
-- number is different text. Definer, so it clears every member's rows.
create or replace function public.study_read_parts_forget()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.study_read_parts r where r.lecture_id = old.lecture_id and r.part_idx = old.idx;
  return old;
end;
$$;
revoke all on function public.study_read_parts_forget() from public, anon, authenticated;
drop trigger if exists study_read_parts_forget on public.study_sections;
create trigger study_read_parts_forget after delete on public.study_sections
  for each row execute function public.study_read_parts_forget();

-- Saves the caller's place in a lecture; with p_done, also marks that part
-- read (once; the first time counts). Errors: 'not signed in',
-- 'lecture not found', 'bad part'.
create or replace function public.study_note_reading(p_lecture uuid, p_part int, p_anchor int,
  p_done boolean default false, p_seconds int default 0)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then
    raise exception 'bad part';
  end if;
  insert into public.study_read_places (user_id, lecture_id, part_idx, anchor, updated_at)
  values (me, p_lecture, p_part, greatest(0, least(coalesce(p_anchor, 0), 99999)), now())
  on conflict (user_id, lecture_id)
  do update set part_idx = excluded.part_idx, anchor = excluded.anchor, updated_at = excluded.updated_at;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    values (me, p_lecture, p_part, now(), greatest(0, least(coalesce(p_seconds, 0), 86400)))
    on conflict (user_id, lecture_id, part_idx) do nothing;
  end if;
end;
$$;

-- Marks parts read or unread by hand (a plan task ticked or unticked).
-- Unknown part numbers are ignored. Returns how many rows changed.
create or replace function public.study_mark_parts(p_lecture uuid, p_parts int[], p_done boolean)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if cardinality(coalesce(p_parts, '{}')) > 200 then raise exception 'bad part'; end if;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    select me, p_lecture, s.idx, now(), 0
      from public.study_sections s
     where s.lecture_id = p_lecture and s.idx = any (p_parts)
    on conflict (user_id, lecture_id, part_idx) do nothing;
  else
    delete from public.study_read_parts r
     where r.user_id = me and r.lecture_id = p_lecture and r.part_idx = any (p_parts);
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Private numbers (security invoker: RLS keeps them to the caller)
-- ═══════════════════════════════════════════════════════════════════════
-- Per lecture of the group, as of p_asof: the caller's read mark and parts,
-- the active keyed questions (practice and past-exam items linked to it) and
-- the caller's answers to them. p_asof = the start of today freezes the
-- plan's "today"; now() gives the live numbers.
--   correct_now / wrong_now: questions whose LATEST answer is right / wrong
--   first_try: questions whose FIRST answer was right
--   parts: [{i, t, from, to, chars, ready}] for time estimates
create or replace function public.study_my_lectures(p_group uuid, p_asof timestamptz default now())
returns table (lecture_id uuid, course text, title text, lecture_date date, created_at timestamptz, status text,
               slides int, parts jsonb, read_at timestamptz, parts_done int[], part_seconds jsonb,
               questions int, cases int, answered int, correct_now int, first_try int, wrong_now int,
               answers int, last_answer_at timestamptz)
language sql stable set search_path = public as $$
  with lec as (
    select l.id, l.course, l.title, l.lecture_date, l.created_at, l.status, jsonb_array_length(l.slides) as slides
    from public.study_lectures l
    where l.group_id = p_group and l.created_at <= p_asof and l.deleted_at is null
  ),
  q as (
    select q.id, coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.kind
    from public.study_questions q
    where q.group_id = p_group and q.retired_at is null and q.has_key and q.created_at <= p_asof
      and coalesce(q.lecture_id, q.ref_lecture) is not null
  ),
  a as (
    select a.question_id, a.correct, a.answered_at,
           row_number() over (partition by a.question_id order by a.answered_at desc, a.id) as rn_last,
           row_number() over (partition by a.question_id order by a.answered_at asc, a.id) as rn_first
    from public.study_answers a
    join q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_asof
  ),
  qs as (
    select q.lecture_id,
           count(*)::int as questions,
           (count(*) filter (where q.kind = 'case'))::int as cases,
           (count(*) filter (where la.question_id is not null))::int as answered,
           (count(*) filter (where la.correct))::int as correct_now,
           (count(*) filter (where fa.correct))::int as first_try,
           (count(*) filter (where la.correct = false))::int as wrong_now
    from q
    left join a la on la.question_id = q.id and la.rn_last = 1
    left join a fa on fa.question_id = q.id and fa.rn_first = 1
    group by q.lecture_id
  ),
  an as (
    select q.lecture_id, count(*)::int as answers, max(a.answered_at) as last_at
    from a join q on q.id = a.question_id
    group by q.lecture_id
  ),
  pt as (
    select s.lecture_id,
           jsonb_agg(jsonb_build_object('i', s.idx, 't', s.title, 'from', s.slide_from, 'to', s.slide_to,
                                        'chars', char_length(s.markdown), 'ready', s.status = 'ready') order by s.idx) as parts
    from public.study_sections s
    where s.lecture_id in (select id from lec)
    group by s.lecture_id
  ),
  rp as (
    select r.lecture_id, array_agg(r.part_idx order by r.part_idx) as done,
           jsonb_object_agg(r.part_idx::text, r.seconds) as secs
    from public.study_read_parts r
    where r.user_id = auth.uid() and r.done_at <= p_asof and r.lecture_id in (select id from lec)
    group by r.lecture_id
  ),
  rd as (
    select r.lecture_id, r.read_at
    from public.study_reads r
    where r.user_id = auth.uid() and r.read_at <= p_asof and r.lecture_id in (select id from lec)
  )
  select l.id, btrim(l.course), l.title, l.lecture_date, l.created_at, l.status, l.slides,
         coalesce(pt.parts, '[]'::jsonb), rd.read_at, coalesce(rp.done, '{}'), coalesce(rp.secs, '{}'::jsonb),
         coalesce(qs.questions, 0), coalesce(qs.cases, 0), coalesce(qs.answered, 0), coalesce(qs.correct_now, 0),
         coalesce(qs.first_try, 0), coalesce(qs.wrong_now, 0), coalesce(an.answers, 0), an.last_at
  from lec l
  left join pt on pt.lecture_id = l.id
  left join rp on rp.lecture_id = l.id
  left join rd on rd.lecture_id = l.id
  left join qs on qs.lecture_id = l.id
  left join an on an.lecture_id = l.id
  order by l.created_at, l.id;
$$;

-- Weak points (item 7), from the caller's practice AND live-quiz answers
-- (the quiz copies each answer into study_answers, mode 'quiz').
--   1. Evidence: the FIRST answer to a question in each study day (Israel
--      time, the day starts 04:00), on active keyed questions with a topic.
--      "לא יודעים" is a wrong answer. Re-answers later the same day (right
--      after reading the explanation) do not count.
--   2. Weight: 0.5 ^ (age in days / 21): an answer three weeks old counts half.
--   3. Score: (Σ w·correct + 2 × 0.7) / (Σ w + 2): two pseudo-answers at 70%
--      keep a topic with little evidence near "unknown, probably fine".
--   4. Topic key: lower(btrim(topic)), across lectures. Per aspect the same.
--   5. status: 'weak'  when items >= 2, Σw >= 1.5, score < 0.6 and
--                      (a question is wrong right now or score < 0.5);
--              'watch' when items >= 2 and score < 0.75; else 'ok'.
create or replace function public.study_my_weak_points(p_group uuid, p_now timestamptz default now())
returns table (topic_key text, topic text, score numeric, weight numeric, items int, wrong_now int,
               status text, worst_aspect text, aspects jsonb, lecture_ids uuid[], slides jsonb, last_at timestamptz)
language sql stable set search_path = public as $$
  with al as (   -- every answer of the caller to an active keyed question with a topic
    select lower(btrim(q.topic)) as topic_key, btrim(q.topic) as topic, q.aspect,
           coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.id as question_id, q.slides,
           a.id as answer_id, a.correct, a.answered_at,
           row_number() over (
             partition by a.question_id, ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
             order by a.answered_at, a.id) as rn
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_now
      and q.group_id = p_group and q.retired_at is null and q.has_key and btrim(q.topic) <> ''
  ),
  w as (         -- the evidence: the first answer per question per study day, weighted by age
    select al.*,
           power(0.5::numeric, (greatest(0, extract(epoch from (p_now - al.answered_at))) / 86400.0 / 21.0)::numeric) as wt,
           (case when al.correct then 1 else 0 end)::numeric as y
    from al
    where al.rn = 1
  ),
  latest as (    -- each question's latest answer (any), for "wrong right now"
    select distinct on (al.question_id) al.question_id, al.correct
    from al
    order by al.question_id, al.answered_at desc, al.answer_id desc
  ),
  asp as (
    select w.topic_key, w.aspect, round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight, count(distinct w.question_id)::int as items
    from w
    group by w.topic_key, w.aspect
  ),
  miss as (   -- slides of questions answered wrong, most missed first
    select m.topic_key, jsonb_agg(jsonb_build_object('l', m.lecture_id, 'n', m.n, 'c', m.c)
                                  order by m.c desc, m.n) filter (where m.rk <= 3) as slides
    from (
      select w.topic_key, w.lecture_id, s.n, count(*) as c,
             row_number() over (partition by w.topic_key order by count(*) desc, s.n) as rk
      from w cross join lateral unnest(w.slides) as s(n)
      where not w.correct and w.lecture_id is not null
      group by w.topic_key, w.lecture_id, s.n
    ) m
    group by m.topic_key
  ),
  t as (
    select w.topic_key, min(w.topic) as topic,
           round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight,
           count(distinct w.question_id)::int as items,
           (count(distinct w.question_id) filter (where lt.correct = false))::int as wrong_now,
           array_agg(distinct w.lecture_id) filter (where w.lecture_id is not null) as lecture_ids,
           max(w.answered_at) as last_at
    from w join latest lt on lt.question_id = w.question_id
    group by w.topic_key
  )
  select t.topic_key, t.topic, t.score, t.weight, t.items, t.wrong_now,
         case when t.items >= 2 and t.weight >= 1.5 and t.score < 0.6 and (t.wrong_now > 0 or t.score < 0.5) then 'weak'
              when t.items >= 2 and t.score < 0.75 then 'watch'
              else 'ok' end,
         (select a.aspect from asp a where a.topic_key = t.topic_key order by a.score, a.weight desc, a.aspect limit 1),
         (select jsonb_agg(jsonb_build_object('aspect', a.aspect, 'score', a.score, 'items', a.items)
                           order by a.score, a.aspect)
            from asp a where a.topic_key = t.topic_key),
         coalesce(t.lecture_ids, '{}'), coalesce(m.slides, '[]'::jsonb), t.last_at
  from t
  left join miss m on m.topic_key = t.topic_key
  order by t.score, t.weight desc, t.topic_key;
$$;

-- Activity per study day (Israel time, from 04:00): answers (practice and
-- quiz), right ones, practice time (each answer capped at 5 minutes), parts
-- read and reading time. Flashcard reviews come from study_my_card_days.
create or replace function public.study_my_days(p_group uuid, p_days int default 28, p_now timestamptz default now())
returns table (day date, answers int, correct int, practice_seconds int, parts_read int, read_seconds int)
language sql stable set search_path = public as $$
  with lim as (
    select p_now - make_interval(days => greatest(1, least(coalesce(p_days, 28), 366))) as since
  ),
  d as (
    select ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date as day,
           1 as answer, case when a.correct then 1 else 0 end as ok, least(coalesce(a.ms, 0), 300000) as ms,
           0 as part, 0 as rs
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and q.group_id = p_group
      and a.answered_at <= p_now and a.answered_at > (select since from lim)
    union all
    select ((r.done_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date, 0, 0, 0, 1, r.seconds
    from public.study_read_parts r
    join public.study_lectures l on l.id = r.lecture_id
    where r.user_id = auth.uid() and l.group_id = p_group
      and r.done_at <= p_now and r.done_at > (select since from lim)
  )
  select d.day, sum(d.answer)::int, sum(d.ok)::int, (sum(d.ms) / 1000)::int, sum(d.part)::int, sum(d.rs)::int
  from d
  group by d.day
  order by d.day;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  4. The study plan (private)
-- ═══════════════════════════════════════════════════════════════════════
-- One active plan per member per group. Scope = every lecture of the listed
-- courses (also ones uploaded later) + lectures added by hand − lectures
-- left out by hand (study_plan_lectures).
create table if not exists public.study_plans (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  group_id      uuid        not null references public.study_groups (id) on delete cascade,
  title         text        not null check (char_length(btrim(title)) between 1 and 120),
  exam_date     date        not null,
  courses       text[]      not null default '{}' check (cardinality(courses) <= 20),
  daily_minutes int         not null default 120 check (daily_minutes between 15 and 720),
  days_off      smallint[]  not null default '{}' check (days_off <@ '{0,1,2,3,4,5,6}'::smallint[]),
  final_review  boolean     not null default true,
  status        text        not null default 'active' check (status in ('active', 'archived')),
  replanned_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists study_plans_one_active on public.study_plans (user_id, group_id) where status = 'active';

create table if not exists public.study_plan_lectures (
  plan_id    uuid    not null references public.study_plans (id) on delete cascade,
  lecture_id uuid    not null references public.study_lectures (id) on delete cascade,
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  included   boolean not null,            -- true: added by hand; false: left out by hand
  primary key (plan_id, lecture_id)
);
create index if not exists study_plan_lectures_lecture on public.study_plan_lectures (lecture_id);

-- A task the member ticked by hand on a day (key as shared/study/plan.ts makes it).
create table if not exists public.study_plan_checks (
  plan_id    uuid        not null references public.study_plans (id) on delete cascade,
  day        date        not null,
  task_key   text        not null check (char_length(task_key) between 3 and 200),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  checked_at timestamptz not null default now(),
  primary key (plan_id, day, task_key)
);

-- Creates the caller's plan (p_plan null: the previous active plan goes to
-- the archive) or changes it (its lecture choices are replaced, and today is
-- planned again). Returns the plan id. Errors: 'not signed in',
-- 'group not found', 'bad title', 'bad date', 'bad minutes', 'bad days',
-- 'bad courses', 'lecture not found', 'too many lectures', 'plan not found'.
create or replace function public.study_plan_save(p_plan uuid, p_group uuid, p_title text, p_exam_date date,
  p_courses text[], p_add uuid[], p_drop uuid[], p_daily_minutes int, p_days_off int[], p_final_review boolean default true)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  pid   uuid;
  today date := ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date;
  crs   text[];
  offs  smallint[];
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_exam_date is null or p_exam_date <= today or p_exam_date > today + 366 then raise exception 'bad date'; end if;
  if p_daily_minutes is null or p_daily_minutes not between 15 and 720 then raise exception 'bad minutes'; end if;
  if cardinality(coalesce(p_days_off, '{}')) > 6
     or exists (select 1 from unnest(coalesce(p_days_off, '{}')) d where d is null or d not between 0 and 6) then
    raise exception 'bad days';
  end if;
  if cardinality(coalesce(p_courses, '{}')) > 20
     or exists (select 1 from unnest(coalesce(p_courses, '{}')) c where char_length(btrim(coalesce(c, ''))) not between 1 and 120) then
    raise exception 'bad courses';
  end if;
  if cardinality(coalesce(p_add, '{}')) + cardinality(coalesce(p_drop, '{}')) > 200 then raise exception 'too many lectures'; end if;
  if exists (select 1 from unnest(coalesce(p_add, '{}') || coalesce(p_drop, '{}')) as l(id)
              where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  select coalesce(array_agg(distinct btrim(c) order by btrim(c)), '{}') into crs from unnest(coalesce(p_courses, '{}')) c;
  select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into offs from unnest(coalesce(p_days_off, '{}')) d;
  perform pg_advisory_xact_lock(hashtext('study_plan:' || me::text));
  if p_plan is null then
    update public.study_plans set status = 'archived', updated_at = now()
     where user_id = me and group_id = p_group and status = 'active';
    insert into public.study_plans (user_id, group_id, title, exam_date, courses, daily_minutes, days_off, final_review)
    values (me, p_group, btrim(p_title), p_exam_date, crs, p_daily_minutes, offs, coalesce(p_final_review, true))
    returning id into pid;
  else
    update public.study_plans
       set title = btrim(p_title), exam_date = p_exam_date, courses = crs, daily_minutes = p_daily_minutes,
           days_off = offs, final_review = coalesce(p_final_review, true), replanned_at = now(), updated_at = now()
     where id = p_plan and user_id = me and group_id = p_group and status = 'active'
    returning id into pid;
    if pid is null then raise exception 'plan not found'; end if;
    delete from public.study_plan_lectures where plan_id = pid;
  end if;
  insert into public.study_plan_lectures (plan_id, lecture_id, user_id, included)
  select pid, l.id, me, true from (select distinct unnest(coalesce(p_add, '{}')) as id) l
  union all
  select pid, l.id, me, false from (select distinct unnest(coalesce(p_drop, '{}')) as id) l
   where not (l.id = any (coalesce(p_add, '{}')));
  return pid;
end;
$$;

-- "לסדר מחדש את היום": today is planned again from now. 'plan not found'.
create or replace function public.study_plan_replan(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set replanned_at = now(), updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- "סיום התוכנית": the plan goes to the archive. 'plan not found'.
create or replace function public.study_plan_end(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set status = 'archived', updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Marathons (shared inside the group)
-- ═══════════════════════════════════════════════════════════════════════
-- agenda: the run-of-show, an array of steps (shared/study/agenda.ts):
--   { k: 'intro'|'read'|'quiz'|'break'|'questions'|'free'|'wrap',
--     l?: lecture id (read, quiz: required; one of lecture_ids),
--     from?, to?: summary part numbers (read), min: planned minutes 1-240,
--     n?: quiz questions 3-30, mode?: 'coop'|'race', title?: ≤ 80 chars }
-- step: the step on screen (-1 before the start). Any member may move it;
-- study_marathon_step() takes "from" so two taps at once move it once.
-- version: bumped by every change, for "someone else edited it".
create table if not exists public.study_marathons (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  title       text        not null check (char_length(btrim(title)) between 1 and 120),
  starts_at   timestamptz not null,
  minutes     int         not null check (minutes between 30 and 720),
  place       text        not null default '' check (char_length(place) <= 120),
  note        text        not null default '' check (char_length(note) <= 500),
  lecture_ids uuid[]      not null default '{}' check (cardinality(lecture_ids) <= 20),
  agenda      jsonb       not null default '[]'::jsonb
                          check (jsonb_typeof(agenda) = 'array' and jsonb_array_length(agenda) <= 40),
  state       text        not null default 'planned' check (state in ('planned', 'live', 'ended', 'cancelled')),
  step        int         not null default -1 check (step between -1 and 39),
  step_at     timestamptz,
  started_at  timestamptz,
  ended_at    timestamptz,
  version     int         not null default 1 check (version >= 1),
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists study_marathons_group on public.study_marathons (group_id, starts_at);

-- Who is in. Its own id: the table is published, and a key must say nothing.
create table if not exists public.study_marathon_people (
  id          uuid        primary key default gen_random_uuid(),
  marathon_id uuid        not null references public.study_marathons (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  answer      text        not null check (answer in ('in', 'maybe', 'out')),
  updated_at  timestamptz not null default now(),
  unique (marathon_id, user_id)
);
create index if not exists study_marathon_people_user on public.study_marathon_people (user_id);

create or replace function public.study_marathon_group(m uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_marathons where id = m;
$$;

-- A marathon is over when it ended, was cancelled, or is 3 hours past its
-- planned end (nobody pressed "סיום"): no cron needed.
create or replace function public.study_marathon__over(m public.study_marathons)
returns boolean language sql stable set search_path = public as $$
  select m.state in ('ended', 'cancelled') or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours';
$$;

-- The run-of-show is checked here, so a phone cannot store junk for others.
create or replace function public.study_marathon__agenda_ok(p_agenda jsonb, p_lectures uuid[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  s jsonb;
  num constant text := '^[0-9]{1,4}$';
begin
  if p_agenda is null or jsonb_typeof(p_agenda) <> 'array' or jsonb_array_length(p_agenda) > 40 then return false; end if;
  for s in select x from jsonb_array_elements(p_agenda) as x loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(s) k where k not in ('k', 'l', 'from', 'to', 'min', 'n', 'mode', 'title')) then
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
  end loop;
  return true;
end;
$$;

-- Creates (p_id null; the creator is "in") or changes a marathon. Returns its
-- id and new version. Errors: 'not signed in', 'group not found',
-- 'bad title', 'bad minutes', 'bad time', 'lecture not found', 'bad agenda',
-- 'marathon not found', 'marathon over', 'conflict' (someone else saved first).
create or replace function public.study_marathon_save(p_id uuid, p_version int, p_group uuid, p_title text,
  p_starts_at timestamptz, p_minutes int, p_place text, p_note text, p_lectures uuid[], p_agenda jsonb)
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me  uuid := auth.uid();
  m   public.study_marathons;
  lec uuid[];
  ag  jsonb := coalesce(p_agenda, '[]'::jsonb);
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_minutes is null or p_minutes not between 30 and 720 then raise exception 'bad minutes'; end if;
  if p_starts_at is null or p_starts_at > now() + interval '180 days' then raise exception 'bad time'; end if;
  -- The lectures, once each, in the order given, all of this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o from unnest(coalesce(p_lectures, '{}')) with ordinality as u(l, o)
           where u.l is not null group by u.l) x;
  lec := coalesce(lec, '{}');
  if cardinality(lec) > 20
     or exists (select 1 from unnest(lec) as t(id) where public.study_lecture_group(t.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  if not public.study_marathon__agenda_ok(ag, lec) then raise exception 'bad agenda'; end if;
  if p_id is null then
    if p_starts_at < now() - interval '1 hour' then raise exception 'bad time'; end if;
    insert into public.study_marathons (group_id, title, starts_at, minutes, place, note, lecture_ids, agenda, created_by, updated_by)
    values (p_group, btrim(p_title), p_starts_at, p_minutes, left(btrim(coalesce(p_place, '')), 120),
            left(btrim(coalesce(p_note, '')), 500), lec, ag, me, me)
    returning * into m;
    insert into public.study_marathon_people (marathon_id, user_id, answer) values (m.id, me, 'in');
  else
    select * into m from public.study_marathons x where x.id = p_id for update;
    if not found or m.group_id <> p_group then raise exception 'marathon not found'; end if;
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    if m.version <> coalesce(p_version, -1) then raise exception 'conflict'; end if;
    update public.study_marathons x
       set title = btrim(p_title), starts_at = p_starts_at, minutes = p_minutes,
           place = left(btrim(coalesce(p_place, '')), 120), note = left(btrim(coalesce(p_note, '')), 500),
           lecture_ids = lec, agenda = ag,
           step = least(x.step, jsonb_array_length(ag) - 1),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id
    returning * into m;
  end if;
  return query select m.id, m.version;
end;
$$;

-- The caller's answer: 'in', 'maybe' or 'out'. Errors: 'marathon not found',
-- 'marathon over', 'bad answer'.
create or replace function public.study_marathon_answer(p_id uuid, p_answer text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  if coalesce(p_answer, '') not in ('in', 'maybe', 'out') then raise exception 'bad answer'; end if;
  insert into public.study_marathon_people (marathon_id, user_id, answer, updated_at)
  values (p_id, me, p_answer, now())
  on conflict (marathon_id, user_id) do update set answer = excluded.answer, updated_at = excluded.updated_at;
end;
$$;

-- Moves the run-of-show from step p_from to step p_to (start: -1 → 0; next;
-- back; jump). p_to = the number of steps ends the marathon. If the step is
-- no longer p_from (another phone moved it first), nothing changes and the
-- current step is returned. Errors: 'marathon not found', 'marathon over',
-- 'no agenda', 'bad step'.
create or replace function public.study_marathon_step(p_id uuid, p_from int, p_to int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons; n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  n := jsonb_array_length(m.agenda);
  if n = 0 then raise exception 'no agenda'; end if;
  if m.step <> coalesce(p_from, -2) then return m.step; end if;
  if p_to is null or p_to < 0 or p_to > n then raise exception 'bad step'; end if;
  if p_to = n then
    update public.study_marathons x
       set state = 'ended', ended_at = now(), started_at = coalesce(x.started_at, now()),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
    return n;
  end if;
  update public.study_marathons x
     set step = p_to, step_at = now(), state = 'live', started_at = coalesce(x.started_at, now()),
         version = x.version + 1, updated_by = me, updated_at = now()
   where x.id = p_id;
  return p_to;
end;
$$;

-- Cancels (p_cancel true) a marathon that is not over, or brings a cancelled
-- one back (false) while its time has not passed. Errors: 'marathon not
-- found', 'marathon over'.
create or replace function public.study_marathon_cancel(p_id uuid, p_cancel boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if coalesce(p_cancel, true) then
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    update public.study_marathons x set state = 'cancelled', version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  else
    if m.state <> 'cancelled' or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours' then
      raise exception 'marathon over';
    end if;
    update public.study_marathons x
       set state = case when x.started_at is null then 'planned' else 'live' end,
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_read_parts      enable row level security;
alter table public.study_read_places     enable row level security;
alter table public.study_plans           enable row level security;
alter table public.study_plan_lectures   enable row level security;
alter table public.study_plan_checks     enable row level security;
alter table public.study_marathons       enable row level security;
alter table public.study_marathon_people enable row level security;

-- (In study-schema.sql the file's loop has already dropped these; the drops
-- keep this block re-runnable on its own.)
drop policy if exists "study read parts own"        on public.study_read_parts;
drop policy if exists "study read parts remove"     on public.study_read_parts;
drop policy if exists "study read places own"       on public.study_read_places;
drop policy if exists "study plans own"             on public.study_plans;
drop policy if exists "study plans remove"          on public.study_plans;
drop policy if exists "study plan lectures own"     on public.study_plan_lectures;
drop policy if exists "study plan checks own"       on public.study_plan_checks;
drop policy if exists "study plan checks add"       on public.study_plan_checks;
drop policy if exists "study plan checks remove"    on public.study_plan_checks;
drop policy if exists "study marathons read"        on public.study_marathons;
drop policy if exists "study marathon people read"  on public.study_marathon_people;

-- Private rows: the owner reads (and may delete) their own; writes go
-- through the functions above (no insert/update grants).
create policy "study read parts own" on public.study_read_parts
  for select using (user_id = auth.uid());
create policy "study read parts remove" on public.study_read_parts
  for delete using (user_id = auth.uid());
create policy "study read places own" on public.study_read_places
  for select using (user_id = auth.uid());
create policy "study plans own" on public.study_plans
  for select using (user_id = auth.uid());
create policy "study plans remove" on public.study_plans
  for delete using (user_id = auth.uid());
create policy "study plan lectures own" on public.study_plan_lectures
  for select using (user_id = auth.uid());
-- Checks: ticked and unticked straight from the phone, on the caller's own plan.
create policy "study plan checks own" on public.study_plan_checks
  for select using (user_id = auth.uid());
create policy "study plan checks add" on public.study_plan_checks
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.study_plans p where p.id = plan_id and p.user_id = auth.uid())
  );
create policy "study plan checks remove" on public.study_plan_checks
  for delete using (user_id = auth.uid());

-- Marathons: the whole group reads them and who is in; writes go through
-- the functions above.
create policy "study marathons read" on public.study_marathons
  for select using (public.study_is_member(group_id));
create policy "study marathon people read" on public.study_marathon_people
  for select using (public.study_is_member(public.study_marathon_group(marathon_id)));

revoke all on public.study_read_parts, public.study_read_places, public.study_plans, public.study_plan_lectures,
  public.study_plan_checks, public.study_marathons, public.study_marathon_people
  from anon, authenticated;
grant select, delete on public.study_read_parts to authenticated;
grant select on public.study_read_places to authenticated;
grant select, delete on public.study_plans to authenticated;
grant select on public.study_plan_lectures to authenticated;
grant select, delete on public.study_plan_checks to authenticated;
grant insert (plan_id, day, task_key) on public.study_plan_checks to authenticated;
grant select on public.study_marathons to authenticated;
grant select on public.study_marathon_people to authenticated;

revoke all on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid), public.study_marathon__over(public.study_marathons),
  public.study_marathon__agenda_ok(jsonb, uuid[]),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  from public, anon;
grant execute on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  to authenticated;

-- ── Realtime: marathons and who is in arrive live on every member's phone.
--  Never the private tables (read parts, places, plans, checks).
do $$
declare t text;
begin
  foreach t in array array['study_marathons', 'study_marathon_people'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

insert into study_private.schema_sections (section, version) values ('P', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


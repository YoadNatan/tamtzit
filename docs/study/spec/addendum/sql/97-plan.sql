-- ════════════════════════════════════════════════════════════════════════
--  SECTION G · THE GROUP'S MARATHON PLAN: TWO LANES   (package G; server
--  addendum §5; approved phase 3)
--  PL1 set up once from the block exam: the date, its lectures, a shared
--      pass over every summary from about 3 weeks out (about 3 hours a day),
--      then study leave (about 10 hours a day): past exams, weak points.
--  PL2 the group lane: one marathon (section P's run-of-show, any member
--      edits, with names) per study day of the plan; checkpoints are the
--      plan's own milestones, computed.
--  PL3 the private lane is computed on the phone ($0) from the caller's own
--      rows; PL4's relearning state is study_my_relearning() below.
--  PL5 a day that slipped: the lane moves its blocks to the next day and the
--      group picks the price (more time a day until a date, or one review
--      day less); the choice is recorded with its name. Nothing is "late".
--  PL6 who read what and the pulse reshape the lane: computed on the phone
--      from what members already see (study_reads, the pulse's buckets).
--  REC4 "זה למבחן" paragraphs from the recording's notes (W) move up in the
--      plan and in Today: study_exam_marks().
--  Needs: F, Q, C, P (marathons; its end for "moved"). Reads W's notes,
--  Q's anchors and the meeting addendum's tables when they exist.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.study_group_plans (
  id             uuid        primary key default gen_random_uuid(),
  group_id       uuid        not null references public.study_groups (id) on delete cascade,
  title          text        not null check (char_length(btrim(title)) between 1 and 120),
  exam_date      date        not null,
  lecture_ids    uuid[]      not null default '{}' check (cardinality(lecture_ids) <= 40),
  shared_from    date        not null,              -- the shared pass over every summary
  leave_from     date        not null,              -- study leave: past exams and what did not sit well
  shared_minutes int         not null default 180 check (shared_minutes between 30 and 600),
  leave_minutes  int         not null default 600 check (leave_minutes between 60 and 840),
  rounds         smallint    not null default 3 check (rounds between 2 and 4),
  day_start      time        not null default '09:00',
  slips          jsonb       not null default '[]'::jsonb check (jsonb_typeof(slips) = 'array' and jsonb_array_length(slips) <= 60),
  state          text        not null default 'active' check (state in ('active', 'archived')),
  version        int         not null default 1 check (version >= 1),
  created_by     uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_by     uuid        references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (shared_from <= leave_from and leave_from <= exam_date)
);
create unique index if not exists study_group_plans_active on public.study_group_plans (group_id) where state = 'active';

alter table public.study_marathons
  add column if not exists plan_id  uuid references public.study_group_plans (id) on delete set null,
  add column if not exists plan_day date;
create unique index if not exists study_marathons_plan_day on public.study_marathons (plan_id, plan_day)
  where plan_id is not null and state <> 'cancelled';

alter table public.study_group_plans enable row level security;
drop policy if exists "study group plans read" on public.study_group_plans;
create policy "study group plans read" on public.study_group_plans for select using (public.study_is_member(group_id));
revoke all on public.study_group_plans from anon, authenticated;
grant select on public.study_group_plans to authenticated;
do $$
begin
  execute 'alter publication supabase_realtime add table public.study_group_plans';
exception when duplicate_object then
  null;
end $$;

-- PL1: the plan (any member creates or changes it; a new one archives the
-- previous). Errors: 'not signed in', 'group not found', 'bad title',
-- 'bad date', 'bad minutes', 'bad rounds', 'lecture not found', 'plan not found', 'conflict'.
create or replace function public.study_group_plan_save(p_id uuid, p_version int, p_group uuid, p_title text, p_exam_date date,
  p_lectures uuid[], p_shared_from date default null, p_leave_from date default null, p_shared_minutes int default 180,
  p_leave_minutes int default 600, p_rounds int default 3, p_day_start time default '09:00')
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me  uuid := auth.uid();
  pl  public.study_group_plans;
  lec uuid[];
  v_sf date := coalesce(p_shared_from, p_exam_date - 21);
  v_lf date := coalesce(p_leave_from, p_exam_date - 14);
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_exam_date is null or p_exam_date < current_date or p_exam_date > current_date + 180
     or v_sf > v_lf or v_lf > p_exam_date or v_sf < current_date - 60 then
    raise exception 'bad date';
  end if;
  if coalesce(p_shared_minutes, 0) not between 30 and 600 or coalesce(p_leave_minutes, 0) not between 60 and 840 then
    raise exception 'bad minutes';
  end if;
  if coalesce(p_rounds, 0) not between 2 and 4 then raise exception 'bad rounds'; end if;
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o from unnest(coalesce(p_lectures, '{}')) with ordinality as u(l, o)
           where u.l is not null group by u.l) x;
  lec := coalesce(lec, '{}');
  if cardinality(lec) = 0 or cardinality(lec) > 40
     or exists (select 1 from unnest(lec) as t(l) where public.study_lecture_group(t.l) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  if p_id is null then
    update public.study_group_plans x set state = 'archived', updated_by = me, updated_at = now()
     where x.group_id = p_group and x.state = 'active';
    insert into public.study_group_plans (group_id, title, exam_date, lecture_ids, shared_from, leave_from, shared_minutes,
                                          leave_minutes, rounds, day_start, created_by, updated_by)
    values (p_group, btrim(p_title), p_exam_date, lec, v_sf, v_lf, p_shared_minutes, p_leave_minutes, p_rounds,
            coalesce(p_day_start, '09:00'), me, me)
    returning * into pl;
  else
    select * into pl from public.study_group_plans x where x.id = p_id and x.group_id = p_group for update;
    if not found or pl.state <> 'active' then raise exception 'plan not found'; end if;
    if pl.version <> coalesce(p_version, -1) then raise exception 'conflict'; end if;
    update public.study_group_plans x
       set title = btrim(p_title), exam_date = p_exam_date, lecture_ids = lec, shared_from = v_sf, leave_from = v_lf,
           shared_minutes = p_shared_minutes, leave_minutes = p_leave_minutes, rounds = p_rounds,
           day_start = coalesce(p_day_start, x.day_start), version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id
    returning * into pl;
  end if;
  return query select pl.id, pl.version;
end;
$$;

-- PL2: one day of the group lane, as a marathon of the plan (created, or
-- changed when the day's marathon is still at p_version). The lane's
-- generator on the phone calls it for the days it (re)builds; a day a member
-- edited meanwhile answers 'conflict' and stays as she left it.
create or replace function public.study_group_plan_day(p_plan uuid, p_day date, p_version int, p_title text,
  p_starts_at timestamptz, p_minutes int, p_lectures uuid[], p_agenda jsonb)
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  pl public.study_group_plans;
  m  public.study_marathons;
  r  record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into pl from public.study_group_plans x where x.id = p_plan;
  if not found or not public.study_is_member(pl.group_id) or pl.state <> 'active' then raise exception 'plan not found'; end if;
  if p_day is null or p_day < pl.shared_from or p_day > pl.exam_date then raise exception 'bad date'; end if;
  select * into m from public.study_marathons x where x.plan_id = p_plan and x.plan_day = p_day and x.state <> 'cancelled';
  select s.id, s.version into r
    from public.study_marathon_save(case when m.id is null then null else m.id end, coalesce(p_version, m.version), pl.group_id,
                                    p_title, p_starts_at, p_minutes, '', '', p_lectures, p_agenda) s;
  update public.study_marathons x set plan_id = p_plan, plan_day = p_day where x.id = r.id;
  return query select r.id, r.version;
end;
$$;

-- PL5: the price chosen for a day that slipped, with its name: 'longer'
-- ("עוד שעה ביום עד שישי": p_until) or 'drop_review' ("לוותר על יום חזרה
-- אחד"). The phone's lane applies it when it rebuilds the next days.
create or replace function public.study_group_plan_slip(p_plan uuid, p_day date, p_choice text, p_until date default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare pl public.study_group_plans;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into pl from public.study_group_plans x where x.id = p_plan for update;
  if not found or not public.study_is_member(pl.group_id) or pl.state <> 'active' then raise exception 'plan not found'; end if;
  if coalesce(p_choice, '') not in ('longer', 'drop_review') then raise exception 'bad choice'; end if;
  if p_day is null or p_day < pl.shared_from or p_day > pl.exam_date
     or (p_choice = 'longer' and (p_until is null or p_until <= p_day or p_until > pl.exam_date)) then
    raise exception 'bad date';
  end if;
  update public.study_group_plans x
     set slips = (case when jsonb_array_length(x.slips) >= 60 then x.slips - 0 else x.slips end)
                 || jsonb_build_array(jsonb_build_object('day', p_day, 'choice', p_choice, 'until', p_until,
                                                         'by', auth.uid(), 'at', now())),
         version = x.version + 1, updated_by = auth.uid(), updated_at = now()
   where x.id = p_plan;
  return pl.version + 1;
end;
$$;

-- PL4: a lecture's key questions: one per paragraph of the bank (the oldest
-- active, keyed, unmarked question on it), in reading order, at most 12;
-- without paragraphs, the oldest of each part.
create or replace function study_private.key_questions(p_lecture uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select x.id from (
    select distinct on (q.part_idx, coalesce((to_jsonb(q) ->> 'anchor')::int, -1)) q.id, q.part_idx,
           coalesce((to_jsonb(q) ->> 'anchor')::int, -1) as a
      from public.study_questions q
     where q.lecture_id = p_lecture and q.retired_at is null and q.has_key
       and (to_jsonb(q) ->> 'stale_at') is null and (to_jsonb(q) ->> 'hidden_at') is null
     order by q.part_idx, coalesce((to_jsonb(q) ->> 'anchor')::int, -1), q.created_at, q.id
  ) x
  order by x.part_idx, x.a
  limit 12
$$;
revoke all on function study_private.key_questions(uuid) from public;

-- PL4: the caller's own rounds of each lecture of the plan. Round 1 is the
-- reading (the caller's "קראתי" mark, or the group's reading she was at);
-- every next round ends on the study day by which each key question has a
-- right answer after the previous round. Gaps grow (1, 3, 7, 14 days),
-- capped so the last round lands before the exam. Only her own rows.
create or replace function public.study_my_relearning(p_plan uuid, p_now timestamptz default now())
returns table (lecture_id uuid, rounds int, key_total int, key_left int, last_day date, next_day date)
language plpgsql stable security definer set search_path = public as $$
declare
  pl     public.study_group_plans;
  l      uuid;
  v_prev int;
  v_r    int;
  v_end  int;
  v_tot  int;
  v_left int;
  v_gap  int;
  today  int := public.study_day(p_now);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into pl from public.study_group_plans x where x.id = p_plan;
  if not found or not public.study_is_member(pl.group_id) then raise exception 'plan not found'; end if;
  foreach l in array pl.lecture_ids loop
    select public.study_day(r.read_at) into v_prev from public.study_reads r where r.lecture_id = l and r.user_id = auth.uid();
    v_r := case when v_prev is null then 0 else 1 end;
    select count(*)::int into v_tot from study_private.key_questions(l);
    loop
      exit when v_prev is null or v_tot = 0 or v_r >= pl.rounds;
      select max(d), count(d) into v_end, v_left from (
        select (select min(public.study_day(a.answered_at)) from public.study_answers a
                 where a.user_id = auth.uid() and a.question_id = k and a.correct
                   and public.study_day(a.answered_at) > v_prev and a.answered_at <= p_now) as d
          from study_private.key_questions(l) as k) z;
      exit when v_left < v_tot;                                          -- some key question still waits
      v_r := v_r + 1;
      v_prev := v_end;
    end loop;
    select count(*)::int into v_left from study_private.key_questions(l) k
     where v_prev is null or not exists (select 1 from public.study_answers a
                       where a.user_id = auth.uid() and a.question_id = k and a.correct
                         and public.study_day(a.answered_at) > v_prev and a.answered_at <= p_now);
    v_gap := case v_r when 0 then 0 when 1 then 1 when 2 then 3 when 3 then 7 else 14 end;
    if v_prev is not null and v_r < pl.rounds and pl.rounds > v_r then
      v_gap := least(v_gap, greatest(1, ((pl.exam_date - date '1970-01-01') - 1 - v_prev) / (pl.rounds - v_r)));
    end if;
    return query select l, v_r, v_tot, case when v_r >= pl.rounds then 0 else v_left end,
                        case when v_prev is null then null else date '1970-01-01' + v_prev end,
                        case when v_prev is null or v_r >= pl.rounds then null
                             else greatest(date '1970-01-01' + today, date '1970-01-01' + v_prev + v_gap) end;
  end loop;
end;
$$;

-- REC4: the paragraphs the lecturer marked for the exam ("זה למבחן"), from
-- the recording's notes (section W: an item with kind 'exam'). Members only;
-- the plan, Today and practice put them first.
create or replace function public.study_exam_marks(p_lecture uuid)
returns table (part_idx int, anchor int, at_s int, text text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'lecture not found';
  end if;
  if to_regclass('public.study_recording_notes') is null or not study_private.feature_on('recordings') then return; end if;
  return query execute
    'select n.part_idx, (i ->> ''anchor'')::int, (i ->> ''at_s'')::int, left(i ->> ''text'', 300)
       from public.study_recording_notes n, jsonb_array_elements(n.items) i
      where n.lecture_id = $1 and n.status = ''ready'' and i ->> ''kind'' = ''exam''
        and (i ->> ''anchor'') ~ ''^-?[0-9]{1,5}$''
      order by n.part_idx, (i ->> ''anchor'')::int'
    using p_lecture;
end;
$$;

revoke all on function public.study_group_plan_save(uuid, int, uuid, text, date, uuid[], date, date, int, int, int, time),
  public.study_group_plan_day(uuid, date, int, text, timestamptz, int, uuid[], jsonb),
  public.study_group_plan_slip(uuid, date, text, date), public.study_my_relearning(uuid, timestamptz),
  public.study_exam_marks(uuid) from public, anon;
grant execute on function public.study_group_plan_save(uuid, int, uuid, text, date, uuid[], date, date, int, int, int, time),
  public.study_group_plan_day(uuid, date, int, text, timestamptz, int, uuid[], jsonb),
  public.study_group_plan_slip(uuid, date, text, date), public.study_my_relearning(uuid, timestamptz),
  public.study_exam_marks(uuid) to authenticated;

insert into study_private.schema_sections (section, version) values ('G', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

-- ════════════════════════════════════════════════════════════════════════
--  SECTION T · TODAY ("היום")   (package T; spec §12.4.T)
--  The last section of the file (review F-9): it reads Q, Z, C, K, P, M and
--  V, and section H's loot when it is there. Re-runnable. Everything here is
--  the caller's own, computed for her alone; nothing is published. The
--  queue's other sources are the phone's: due cards and trap cards through
--  section C's queue (vaccines are trap cards, never a row of their own),
--  "רק אצלך חם" from section U's two reads, the private lane from section
--  G's lane (spec §12.4.T's table).
--
--  T2  the private queue's sources the database must answer (cards come
--      from section C's own queue on the phone): the returns of live-quiz
--      misses after 1 and 3 days (Q9, "הבנתי בדיון" when vote 2 was right),
--      one confident error to try again in another wording (a question on
--      the same paragraph), the "לא ברור" paragraphs (section M), the
--      "עדכון" rows (section V), a missed meeting (section M).
--  T5  the private flame: active study days among the last 7, lit from 4;
--      it never resets on one missed day, and nobody else sees it.
--  D11 phase 3, "הקבוצה צריכה אותך": opt-in, off by default. An open
--      question goes to one opted-in member who has mastered its topic,
--      and only she sees why; plus one correction awaiting a second approval.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.study_member_prefs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  needs_me   boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
alter table public.study_member_prefs enable row level security;
drop policy if exists "study member prefs own" on public.study_member_prefs;
create policy "study member prefs own" on public.study_member_prefs for select using (user_id = auth.uid());
revoke all on public.study_member_prefs from anon, authenticated;
grant select on public.study_member_prefs to authenticated;

-- "הקבוצה צריכה אותך" on or off (שלי → הגדרות).
create or replace function public.study_set_needs_me(p_group uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  insert into public.study_member_prefs (user_id, group_id, needs_me) values (auth.uid(), p_group, coalesce(p_on, false))
  on conflict (user_id, group_id) do update set needs_me = excluded.needs_me, updated_at = now();
end;
$$;

-- Q9: the caller's wrong first votes in live quizzes (30 days) that are due
-- again: step 1 from the next study day until answered on or after it;
-- step 2 from the third day until answered on or after it.
create or replace function public.study_my_quiz_returns(p_group uuid, p_now timestamptz default now())
returns table (question_id uuid, lecture_id uuid, wrong_at timestamptz, step int, choice int, bet int, fixed_in_discussion boolean)
language sql stable security definer set search_path = public as $$
  with w as (
    select distinct on (a.question_id) a.question_id, q.lecture_id, a.answered_at, study_private.day_of(a.answered_at) as d,
           a.choice::int as choice, a.confidence::int as bet
      from public.study_answers a
      join public.study_questions q on q.id = a.question_id and q.group_id = p_group
                                   and q.retired_at is null and q.stale_at is null and q.hidden_at is null and q.has_key
     where a.user_id = auth.uid() and a.mode = 'quiz' and not a.correct
       and a.answered_at > p_now - interval '30 days' and a.answered_at <= p_now
     order by a.question_id, a.answered_at desc
  ),
  s as (
    select w.*,
           exists (select 1 from public.study_answers b where b.user_id = auth.uid() and b.question_id = w.question_id
                     and b.answered_at <= p_now and study_private.day_of(b.answered_at) >= w.d + 1) as s1,
           exists (select 1 from public.study_answers b where b.user_id = auth.uid() and b.question_id = w.question_id
                     and b.answered_at <= p_now and study_private.day_of(b.answered_at) >= w.d + 3) as s2,
           study_private.day_of(p_now) as today
      from w
  )
  select s.question_id, s.lecture_id, s.answered_at,
         case when not s.s1 then 1 else 2 end,
         s.choice, s.bet,
         exists (select 1 from public.study_quiz_answers a1
                   join public.study_quiz_answers a2 on a2.round_id = a1.round_id and a2.user_id = a1.user_id and a2.vote = 2 and a2.correct
                  where a1.user_id = auth.uid() and a1.vote = 1 and a1.answered_at = s.answered_at)
    from s
   where public.study_is_member(p_group)
     and ((not s.s1 and s.today >= s.d + 1) or (s.s1 and not s.s2 and s.today >= s.d + 3))
   order by s.answered_at;
$$;

-- Today's "על בטוח" row: the first due row of the danger list (section P's
-- study_my_danger_list: back the next day in another wording and 3 days
-- later, until right "על בטוח" twice). One rule for the one approved row
-- (review F-9).
create or replace function public.study_my_danger(p_group uuid, p_now timestamptz default now())
returns table (question_id uuid, ask_id uuid, lecture_id uuid, wrong_at timestamptz, other_wording boolean)
language sql stable security definer set search_path = public as $$
  select d.question_id, d.ask_id, d.lecture_id, d.wrong_at, d.ask_id is distinct from d.question_id
    from public.study_my_danger_list(p_group, p_now) d
   where d.due_day <= study_private.day_of(p_now)
   order by d.due_day, d.wrong_at
   limit 1
$$;

-- T5: the private flame.
create or replace function public.study_my_flame(p_group uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
  with today as (select study_private.day_of(p_now) as d),
  act as (
    select study_private.day_of(a.answered_at) as d from public.study_answers a join public.study_questions q on q.id = a.question_id
     where a.user_id = auth.uid() and q.group_id = p_group and a.answered_at > p_now - interval '8 days' and a.answered_at <= p_now
    union select study_private.day_of(r.done_at) from public.study_read_parts r join public.study_lectures l on l.id = r.lecture_id
     where r.user_id = auth.uid() and l.group_id = p_group and r.done_at > p_now - interval '8 days' and r.done_at <= p_now
    union select study_private.day_of(v.reviewed_at) from public.study_card_reviews v join public.study_cards c on c.id = v.card_id
     where v.user_id = auth.uid() and c.group_id = p_group and v.reviewed_at > p_now - interval '8 days' and v.reviewed_at <= p_now
    union select study_private.day_of(t.created_at) from public.study_meeting_taps t join public.study_meetings m on m.id = t.meeting_id
     where t.user_id = auth.uid() and m.group_id = p_group and t.created_at > p_now - interval '8 days' and t.created_at <= p_now
    union select study_private.day_of(x.first_at) from public.study_meeting_presence x join public.study_meetings m on m.id = x.meeting_id
     where x.user_id = auth.uid() and m.group_id = p_group and x.first_at > p_now - interval '8 days' and x.first_at <= p_now
    union select study_private.day_of(g.answered_at) from public.study_meeting_guess_answers g join public.study_meetings m on m.id = g.meeting_id
     where g.user_id = auth.uid() and m.group_id = p_group and g.answered_at > p_now - interval '8 days' and g.answered_at <= p_now
    union select study_private.day_of(c.done_at) from public.study_meeting_catchups c join public.study_meetings m on m.id = c.meeting_id
     where c.user_id = auth.uid() and m.group_id = p_group and c.done_at > p_now - interval '8 days' and c.done_at <= p_now
  )
  select jsonb_build_object('days', count(distinct act.d), 'lit', count(distinct act.d) >= 4,
                            'list', coalesce(jsonb_agg(distinct act.d), '[]'::jsonb))
    from act, today
   where act.d between today.d - 6 and today.d and public.study_is_member(p_group);
$$;

-- D11: at most two rows, only for a member who opted in.
create or replace function public.study_needs_me(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q   jsonb;
  a   jsonb;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  if not coalesce((select p.needs_me from public.study_member_prefs p where p.user_id = auth.uid() and p.group_id = p_group), false) then
    return '[]'::jsonb;
  end if;
  with cand as (
    select c.id, c.lecture_id, c.part_idx, c.anchor, c.quote, c.body, c.author_id, c.created_at, l.title
      from public.study_comments c
      join public.study_lectures l on l.id = c.lecture_id and l.group_id = p_group and l.deleted_at is null
     where c.kind = 'question' and c.parent_id is null and not c.resolved
       and c.created_at between now() - interval '14 days' and now() - interval '2 hours'
  ),
  topics as (
    select cd.id as cid, q.topic
      from cand cd
      join public.study_questions q on q.lecture_id = cd.lecture_id and q.part_idx = cd.part_idx and q.topic <> ''
                                   and (q.anchor = cd.anchor
                                        or not exists (select 1 from public.study_questions q3
                                                        where q3.lecture_id = cd.lecture_id and q3.part_idx = cd.part_idx and q3.anchor = cd.anchor))
     group by cd.id, q.topic
  ),
  latest as (
    select distinct on (x.user_id, x.question_id) x.user_id, x.question_id, x.correct
      from public.study_answers x join public.study_questions q on q.id = x.question_id and q.group_id = p_group
     order by x.user_id, x.question_id, x.answered_at desc
  ),
  mastery as (
    select t.cid, l.user_id, count(*) as n, count(*) filter (where l.correct) as ok
      from topics t
      join cand cd on cd.id = t.cid
      join public.study_questions q on q.lecture_id = cd.lecture_id and q.topic = t.topic and q.retired_at is null and q.hidden_at is null
      join latest l on l.question_id = q.id
     group by t.cid, l.user_id
  ),
  eligible as (
    select m.cid, m.user_id, m.ok
      from mastery m
      join public.study_member_prefs p on p.user_id = m.user_id and p.group_id = p_group and p.needs_me
      join cand cd on cd.id = m.cid
     where m.n >= 3 and m.ok * 5 >= m.n * 4 and m.user_id is distinct from cd.author_id
  ),
  chosen as (
    select distinct on (e.cid) e.cid, e.user_id from eligible e order by e.cid, e.ok desc, md5(e.cid::text || e.user_id::text)
  )
  select jsonb_build_object('kind', 'question', 'comment_id', cd.id, 'lecture_id', cd.lecture_id, 'lecture_title', cd.title,
                            'part', cd.part_idx, 'anchor', cd.anchor, 'quote', cd.quote, 'body', cd.body)
    into q
    from chosen ch join cand cd on cd.id = ch.cid
   where ch.user_id = auth.uid()
   order by cd.created_at
   limit 1;
  select jsonb_build_object('kind', 'approval', 'proposal_id', p.id, 'lecture_id', p.lecture_id, 'lecture_title', l.title,
                            'part', p.part_idx, 'anchor', p.anchor, 'note', p.note,
                            'by', (select m.name from public.study_members m where m.group_id = p_group and m.user_id = p.proposed_by))
    into a
    from public.study_edit_proposals p
    join public.study_lectures l on l.id = p.lecture_id and l.group_id = p_group and l.deleted_at is null
   where p.state = 'pending' and p.proposed_by is distinct from auth.uid()
   order by p.created_at
   limit 1;
  return (case when q is null then '[]'::jsonb else jsonb_build_array(q) end) || (case when a is null then '[]'::jsonb else jsonb_build_array(a) end);
end;
$$;

-- Everything Today's queue needs from the database, in one call.
create or replace function public.study_today(p_group uuid)
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
$$;

revoke all on function public.study_set_needs_me(uuid, boolean), public.study_my_quiz_returns(uuid, timestamptz),
  public.study_my_danger(uuid, timestamptz), public.study_my_flame(uuid, timestamptz), public.study_needs_me(uuid),
  public.study_today(uuid)
  from public, anon;
grant execute on function public.study_set_needs_me(uuid, boolean), public.study_my_quiz_returns(uuid, timestamptz),
  public.study_my_danger(uuid, timestamptz), public.study_my_flame(uuid, timestamptz), public.study_needs_me(uuid),
  public.study_today(uuid)
  to authenticated;

insert into study_private.schema_sections (section, version) values ('T', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

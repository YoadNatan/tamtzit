-- ════════════════════════════════════════════════════════════════════════
--  SECTION U · THE ANONYMOUS COUNTS, THE PULSE, TRAPS AND THE MUSEUM   (package U)
--  addendum "fun" (PU1-PU3, P8, P9, Q10, A5, MU1-MU4, decision 1).
--  After section P. It reads what the meeting addendum adds (the bet,
--  study_answers.confidence; the paragraph, study_questions.anchor and
--  study_cards.anchor; a correction's mark, stale_at; the "לא ברור" taps,
--  study_meeting_taps; the group trap card maker of section C's end) only
--  where they exist, through to_jsonb(row) and to_regclass, so it loads and
--  runs at any stage: without them there are no museum exhibits, no
--  paragraph spots and no taps, and the rest works. Re-runnable.
--
--  Who sees what
--  ─────────────
--  Private rows stay private. Answers, bets, card reviews and "לא ברור"
--  taps are read only by the definer functions below, once a night (pg_cron,
--  or the first read of the study day without it), and only for members who
--  did not opt out. The numbers stay in study_private (no grants). Members
--  see words derived from them, and only where at least 3 different members
--  contributed:
--    study_pulse_topics     חם · פושר · יושב טוב, per lecture, topic and aspect
--    study_pulse_questions  'sure' · 'missed' · 'split', per question
--    study_pulse_cards      cards at least 3 members keep forgetting
--    study_pulse_spots      paragraphs at least 3 members found hard
--    study_traps            trap cards and museum exhibits (a wrong option at
--                           least 3 members chose; 'על בטוח' for the museum),
--                           each opened only the study day after it was found
--  Every count covers signals up to the start of the current study day
--  (04:00, Israel time), never later, whenever it runs: practice done today
--  changes nothing anyone sees until tomorrow. Nothing here is published to
--  Realtime. The server switch 'pulse' (study_private.features, off until
--  Yoad turns it on) stops all counting at once, whatever the app's flags.
-- ════════════════════════════════════════════════════════════════════════

create schema if not exists study_private;
revoke all on schema study_private from public;

insert into study_private.features (name) values ('pulse') on conflict (name) do nothing;

-- ── U1. "לא לכלול אותי בדופק": owner-only. A row = out. ──
create table if not exists public.study_pulse_optout (
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ── U2. What the night counted, and when (Yoad reads it; no grants) ──
create table if not exists study_private.pulse_runs (
  group_id uuid        primary key references public.study_groups (id) on delete cascade,
  cutoff   timestamptz not null,               -- signals before this instant were counted
  ran_at   timestamptz not null default now(),
  counted  jsonb       not null default '{}'::jsonb
);
-- review SEC-8: who the night counted (they, and only they, read what it wrote)
alter table study_private.pulse_runs add column if not exists members uuid[] not null default '{}';

-- The numbers behind the words (no grants: only the definer functions read them).
create table if not exists study_private.pulse_q (
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  question_id uuid        primary key references public.study_questions (id) on delete cascade,
  lecture_id  uuid,
  cutoff      timestamptz not null,
  people      int         not null,            -- members with an answer in the window
  missed      int         not null,            -- whose latest answer is wrong ("לא יודעים" too)
  week_missed int         not null,            -- with a wrong answer in the last 7 days
  sure_wrong  int         not null,            -- with a wrong answer bet "על בטוח"
  trap_option smallint,                        -- the wrong option the most members chose
  trap_people int         not null default 0,
  sure_option smallint,                        -- the wrong option the most members chose "על בטוח"
  sure_people int         not null default 0
);
create index if not exists study_pulse_q_group on study_private.pulse_q (group_id);

create table if not exists study_private.pulse_cells (
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  topic_key  text        not null,
  aspect     text        not null,
  cutoff     timestamptz not null,
  people     int         not null,             -- members with evidence in the cell
  struggling int         not null,             -- of them, half or more of their latest evidence wrong
  hot_on     date,                             -- the last study day the cell was hot (kept when it drops out)
  primary key (lecture_id, topic_key, aspect)
);

-- ── U3. What members see (member-only read, never published) ──
create table if not exists public.study_pulse_topics (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        not null references public.study_lectures (id) on delete cascade,
  topic_key   text        not null check (char_length(topic_key) between 1 and 120),
  topic       text        not null check (char_length(topic) <= 120),
  aspect      text        not null,
  bucket      text        not null check (bucket in ('hot', 'warm', 'cool')),
  slides      int[]       not null default '{}',   -- the slides behind the misses, most first (at most 2)
  closed_week boolean     not null default false,  -- "החור שנסגר השבוע": hot in the last 7 days, cool now
  cutoff      timestamptz not null,
  unique (lecture_id, topic_key, aspect)
);
create index if not exists study_pulse_topics_group on public.study_pulse_topics (group_id);

create table if not exists public.study_pulse_questions (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        references public.study_lectures (id) on delete cascade,
  question_id uuid        not null unique references public.study_questions (id) on delete cascade,
  signal      text        not null check (signal in ('sure', 'missed', 'split')),
  cutoff      timestamptz not null
);
create index if not exists study_pulse_questions_group on public.study_pulse_questions (group_id, lecture_id);

create table if not exists public.study_pulse_cards (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  card_id    uuid        not null unique references public.study_cards (id) on delete cascade,
  cutoff     timestamptz not null
);
create index if not exists study_pulse_cards_group on public.study_pulse_cards (group_id, lecture_id);

create table if not exists public.study_pulse_spots (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx >= 0),
  anchor     int         not null check (anchor >= 0),
  cutoff     timestamptz not null,
  unique (lecture_id, part_idx, anchor)
);

-- ── U4. Traps: a wrong option at least 3 members chose becomes a card in
--  everyone's deck ("מלכודת"); chosen "על בטוח" by at least 3, it is also a
--  museum exhibit ("מוצג", with a vaccine card). Read only through the
--  functions below, so nothing shows before it opens.
create table if not exists public.study_traps (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        references public.study_lectures (id) on delete cascade,
  question_id uuid        not null references public.study_questions (id) on delete cascade,
  option      smallint    not null check (option >= 0),
  source      text        not null default 'pulse' check (source in ('pulse', 'quiz', 'var')),
  exhibit_no  int         check (exhibit_no >= 1),          -- museum exhibits only, numbered per lecture
  exhibit_at  timestamptz,                                  -- when the exhibit opens
  card_id     uuid        references public.study_cards (id) on delete set null,
  state       text        not null default 'pending' check (state in ('pending', 'open', 'retired', 'withdrawn')),
  falling     boolean     not null default false,           -- "עוד נופלים"
  found_at    timestamptz not null,                         -- the cut-off of the night that found it
  opens_at    timestamptz not null,                         -- the next study day
  opened_at   timestamptz,
  retired_at  timestamptz,
  shown_at    timestamptz,                                  -- a meeting opened with it (MU4)
  plaque      jsonb,                                        -- {claim, line}: the optional plaque by Claude
  plaque_until timestamptz,                                 -- op 'plaque' holds the exhibit (review SEC-15)
  unique (question_id, option)
);
alter table public.study_traps add column if not exists plaque_until timestamptz;
create index if not exists study_traps_group on public.study_traps (group_id, lecture_id);

-- ═══════════════════════════════════════════════════════════════════════
--  Helpers
-- ═══════════════════════════════════════════════════════════════════════

-- The start of the study day of p_at (04:00, Israel time), and of the next.
create or replace function study_private.pulse_cutoff(p_at timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((((p_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date + time '04:00') at time zone 'Asia/Jerusalem')
$$;
create or replace function study_private.pulse_next_cutoff(p_cut timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((((p_cut at time zone 'Asia/Jerusalem') - interval '4 hours')::date + 1 + time '04:00') at time zone 'Asia/Jerusalem')
$$;

-- The members whose signals count: in the group for 7 days at least, with a
-- saved account (one person, one account: an unsaved second device is not a
-- second person), not opted out (review SEC-8).
create or replace function study_private.pulse_counted(p_group uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select m.user_id from public.study_members m
    join auth.users u on u.id = m.user_id and not coalesce(u.is_anonymous, false)
   where m.group_id = p_group
     and m.joined_at <= now() - interval '7 days'
     and not exists (select 1 from public.study_pulse_optout o where o.group_id = p_group and o.user_id = m.user_id)
$$;
-- The caller reads the group's counts only when the last night counted her
-- and she is not out now (review SEC-8: reading is reciprocal).
create or replace function public.study_pulse_reader(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from study_private.pulse_runs r where r.group_id = p_group and auth.uid() = any (r.members))
     and not exists (select 1 from public.study_pulse_optout o where o.group_id = p_group and o.user_id = auth.uid())
$$;
revoke all on function public.study_pulse_reader(uuid) from public, anon;
grant execute on function public.study_pulse_reader(uuid) to authenticated;

-- The "לא ברור" taps (M4) of p_group's members in [p_from, p_to), from the
-- meeting addendum's study_meeting_taps; none while that table is not there.
create or replace function study_private.pulse_unclear(p_group uuid, p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, lecture_id uuid, part_idx int, anchor int)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.study_meeting_taps') is null then return; end if;
  return query execute
    'select t.user_id, t.lecture_id, t.part_idx, t.anchor
       from public.study_meeting_taps t join public.study_lectures l on l.id = t.lecture_id
      where l.group_id = $1 and t.created_at >= $2 and t.created_at < $3'
    using p_group, p_from, p_to;
end;
$$;

-- Every counted member's FIRST answer to a question in each study day, in
-- [p_from, p_to): the evidence (practice and the live quiz's first votes;
-- pre-guesses never reach study_answers). Questions retired, without a key,
-- flagged as wrong, or marked by a correction (stale_at) are left out. The
-- only place that reads the bet (P2) and the question's paragraph (A1), each
-- through to_jsonb so a missing column reads as null.
create or replace function study_private.pulse_answers(p_group uuid, p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, question_id uuid, lecture_id uuid, topic_key text, topic text, aspect text,
               part_idx int, anchor int, slides int[], day date, choice smallint, correct boolean, sure boolean,
               answered_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with ans as (
    select a.user_id, a.question_id, a.choice, a.correct, coalesce((to_jsonb(a) ->> 'confidence')::int = 3, false) as sure, a.answered_at,
           ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date as day,
           row_number() over (partition by a.user_id, a.question_id,
                                           ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
                              order by a.answered_at, a.id) as rn
      from public.study_answers a
     where a.answered_at >= p_from and a.answered_at < p_to
       and a.user_id in (select c.user_id from study_private.pulse_counted(p_group) c)
  )
  select x.user_id, q.id, coalesce(q.lecture_id, q.ref_lecture), lower(btrim(q.topic)), btrim(q.topic), q.aspect,
         q.part_idx, (to_jsonb(q) ->> 'anchor')::int, q.slides, x.day, x.choice, x.correct, x.sure, x.answered_at
    from ans x
    join public.study_questions q on q.id = x.question_id
   where x.rn = 1 and q.group_id = p_group and q.retired_at is null and q.hidden_at is null and q.has_key
     and (to_jsonb(q) ->> 'stale_at') is null
     and not exists (select 1 from public.study_question_flags f
                      where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides'));
end;
$$;

-- Every counted member's card reviews in [p_from, p_to). again: "שוב";
-- lapse: "שוב" on a card that was learned (state 2), FSRS's lapse.
create or replace function study_private.pulse_reviews(p_group uuid, p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, card_id uuid, lecture_id uuid, topic_key text, topic text, aspect text,
               part_idx int, anchor int, slides int[], again boolean, lapse boolean, reviewed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  select r.user_id, c.id, c.lecture_id, lower(btrim(c.topic)), btrim(c.topic), c.aspect, c.part_idx,
         (to_jsonb(c) ->> 'anchor')::int, c.slides, r.rating = 1, r.rating = 1 and r.state_before = 2, r.reviewed_at
    from public.study_card_reviews r
    join public.study_cards c on c.id = r.card_id
   where c.group_id = p_group and c.deleted_at is null and (to_jsonb(c) ->> 'stale_at') is null
     and r.reviewed_at >= p_from and r.reviewed_at < p_to
     and r.user_id in (select x.user_id from study_private.pulse_counted(p_group) x);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The trap card: the question, the right answer, and the trap with why it
--  is wrong here. Built from the question's own checked text (no Claude),
--  shared as a group card, through section C's end's trap card maker when
--  it is there (source 'trap', key 'q:<question>:<option>': the live quiz's
--  trap of the same option is the same card). Returns the card, or null
--  when the text does not fit a card (the exhibit still shows).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function study_private.trap_make(p_trap uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  t   public.study_traps;
  q   public.study_questions;
  k   public.study_question_keys;
  f   text;
  b   text;
  e   text;
  sl  int[];
  why text;
  cid uuid;
begin
  select * into t from public.study_traps x where x.id = p_trap;
  if not found then return null; end if;
  if t.card_id is not null and exists (select 1 from public.study_cards c where c.id = t.card_id and c.deleted_at is null) then
    return t.card_id;
  end if;
  select * into q from public.study_questions x where x.id = t.question_id;
  select * into k from public.study_question_keys x where x.question_id = t.question_id;
  if q.lecture_id is null or k.answer is null or t.option = k.answer or t.option >= cardinality(q.options) then
    return null;
  end if;
  f := case
         when btrim(q.vignette) = '' then btrim(q.question)
         when char_length(btrim(q.vignette)) + 1 + char_length(btrim(q.question)) <= 400 then btrim(q.vignette) || ' ' || btrim(q.question)
         else regexp_replace(left(btrim(q.vignette), greatest(0, 396 - char_length(btrim(q.question)))), '\s+\S*$', '') || '… ' || btrim(q.question)
       end;
  if char_length(f) > 400 then f := left(btrim(q.question), 399) || '…'; end if;
  b := left(btrim(q.options[k.answer + 1]), 300);
  e := left('המלכודת: ' || btrim(q.options[t.option + 1])
            || coalesce(' · ' || nullif(btrim(k.explanations[t.option + 1]), ''), ''), 500);
  sl := coalesce(q.slides[1:12], '{}');
  if to_regprocedure('study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)') is not null then
    cid := study_private.trap_card(q.lecture_id, q.part_idx, (to_jsonb(q) ->> 'anchor')::int, coalesce(to_jsonb(q) ->> 'quote', ''),
                                   f, b, e, sl, 'q:' || q.id::text || ':' || t.option::text);
  else
    why := public.study_card_problem('qa', f, b, e, '', sl, q.lecture_id);
    if why is not null then return null; end if;
    insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, slides, topic, aspect, created_by)
    values (q.group_id, q.lecture_id, 'ai', q.part_idx, 'qa', f, b, e, sl, q.topic, q.aspect, null)
    returning id into cid;
    if (to_jsonb(q) ->> 'anchor') is not null then   -- the paragraph (A1), when questions carry one
      execute 'update public.study_cards set anchor = $1 where id = $2' using (to_jsonb(q) ->> 'anchor')::int, cid;
    end if;
  end if;
  if cid is null then return null; end if;
  update public.study_cards c set topic = q.topic, aspect = q.aspect where c.id = cid and c.topic = '';
  update public.study_traps x set card_id = cid where x.id = p_trap;
  return cid;
end;
$$;

-- A trap's card leaves every deck (retired or withdrawn), with a history row.
create or replace function study_private.trap_unmake(p_trap uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.study_cards;
begin
  select x.* into c from public.study_cards x join public.study_traps t on t.card_id = x.id
   where t.id = p_trap and x.deleted_at is null;
  if not found then return; end if;
  update public.study_cards x set deleted_at = now(), deleted_by = null where x.id = c.id;
  insert into public.study_card_edits (card_id, action, version, before, after, edited_by)
  values (c.id, 'delete', c.version, jsonb_build_object('kind', c.kind, 'front', c.front, 'back', c.back), '{}'::jsonb, null);
end;
$$;

-- Adds a trap (or finds it). Section U's night calls it with p_open_now
-- false (it opens the next study day); the meeting addendum's quiz reveal
-- (Q7, counts already shown to the players) and VAR (R4) may call it with
-- true. Internal: no grants.
create or replace function study_private.trap_add(p_question uuid, p_option int, p_source text,
  p_found timestamptz, p_open_now boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  q   public.study_questions;
  tid uuid;
begin
  select * into q from public.study_questions x where x.id = p_question;
  if not found or q.lecture_id is null then return null; end if;
  insert into public.study_traps (group_id, lecture_id, question_id, option, source, found_at, opens_at)
  values (q.group_id, q.lecture_id, p_question, p_option, p_source, p_found,
          case when p_open_now then p_found else study_private.pulse_next_cutoff(study_private.pulse_cutoff(p_found)) end)
  on conflict (question_id, option) do nothing
  returning id into tid;
  if tid is null then
    select x.id into tid from public.study_traps x where x.question_id = p_question and x.option = p_option;
  end if;
  if p_open_now then
    update public.study_traps x set state = 'open', opened_at = coalesce(x.opened_at, now())
     where x.id = tid and x.state = 'pending';
    perform study_private.trap_make(tid);
  end if;
  return tid;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The night: one function counts everything for one group (or every
--  group whose last count is older than the current study day).
--    p_now    the moment to count for (the checks pass a fixed one)
--    p_force  count again even if this study day was counted
--  Returns how many groups were counted.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function study_private.pulse_night(p_group uuid default null, p_now timestamptz default now(),
  p_force boolean default false)
returns int language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  g      uuid;
  c      timestamptz := study_private.pulse_cutoff(p_now);
  w      timestamptz := study_private.pulse_cutoff(p_now) - interval '28 days';
  wk     timestamptz := study_private.pulse_cutoff(p_now) - interval '7 days';
  act    timestamptz := study_private.pulse_cutoff(p_now) - interval '14 days';
  n      int := 0;
  r      record;
  v_cnt  jsonb;
begin
  if not study_private.feature_on('pulse') then return 0; end if;
  for g in
    select x.id from public.study_groups x
     where (p_group is null or x.id = p_group)
       and (p_force or not exists (select 1 from study_private.pulse_runs pr where pr.group_id = x.id and pr.cutoff >= c))
  loop
    -- One count at a time per group (cron and a first reader may meet).
    perform pg_advisory_xact_lock(hashtext('study_pulse:' || g::text));
    if not p_force and exists (select 1 from study_private.pulse_runs pr where pr.group_id = g and pr.cutoff >= c) then
      continue;
    end if;

    -- ── 1. Questions: who answered, who is wrong now, the options that caught people ──
    delete from study_private.pulse_q x where x.group_id = g;
    insert into study_private.pulse_q (group_id, question_id, lecture_id, cutoff, people, missed, week_missed, sure_wrong,
                                       trap_option, trap_people, sure_option, sure_people)
    with ev as (
      select * from study_private.pulse_answers(g, w, c)
    ), latest as (
      select distinct on (e.user_id, e.question_id) e.user_id, e.question_id, e.correct
        from ev e order by e.user_id, e.question_id, e.answered_at desc
    ), per_q as (
      select e.question_id, min(e.lecture_id::text)::uuid as lecture_id,
             count(distinct e.user_id)::int as people,
             (count(distinct e.user_id) filter (where not e.correct and e.answered_at >= wk))::int as week_missed,
             (count(distinct e.user_id) filter (where not e.correct and e.sure))::int as sure_wrong
        from ev e group by e.question_id
    ), lat as (
      select l.question_id, (count(*) filter (where not l.correct))::int as missed from latest l group by l.question_id
    ), opt as (
      select e.question_id, e.choice, count(distinct e.user_id)::int as people,
             (count(distinct e.user_id) filter (where e.sure))::int as sure_people
        from ev e where not e.correct and e.choice is not null group by e.question_id, e.choice
    ), top_opt as (
      select distinct on (o.question_id) o.question_id, o.choice, o.people
        from opt o order by o.question_id, o.people desc, o.choice
    ), top_sure as (
      select distinct on (o.question_id) o.question_id, o.choice, o.sure_people
        from opt o where o.sure_people > 0 order by o.question_id, o.sure_people desc, o.choice
    )
    select g, p.question_id, p.lecture_id, c, p.people, coalesce(l.missed, 0), p.week_missed, p.sure_wrong,
           t.choice, coalesce(t.people, 0), s.choice, coalesce(s.sure_people, 0)
      from per_q p
      left join lat l on l.question_id = p.question_id
      left join top_opt t on t.question_id = p.question_id
      left join top_sure s on s.question_id = p.question_id
     where p.people >= 3;

    delete from public.study_pulse_questions x where x.group_id = g;
    insert into public.study_pulse_questions (group_id, lecture_id, question_id, signal, cutoff)
    select g, x.lecture_id, x.question_id, s.signal, c
      from study_private.pulse_q x
      cross join lateral (select case
               when x.sure_wrong >= 3 then 'sure'
               when x.week_missed >= 3 or x.missed * 2 > x.people then 'missed'
               when (x.people - x.missed)::numeric / x.people between 0.3 and 0.7 then 'split'
             end as signal) s
     where x.group_id = g and x.people >= 3 and s.signal is not null;

    -- ── 2. Topics × aspects of each lecture: how many of those who practised struggle ──
    delete from public.study_pulse_topics x where x.group_id = g;
    with qa as (
      select e.* from study_private.pulse_answers(g, w, c) e where e.topic_key <> '' and e.lecture_id is not null
    ), q_latest as (
      select distinct on (e.user_id, e.question_id) e.user_id, e.lecture_id, e.topic_key, e.topic, e.aspect,
             not e.correct as wrong, e.slides
        from qa e order by e.user_id, e.question_id, e.answered_at desc
    ), cr as (
      select v.* from study_private.pulse_reviews(g, w, c) v where v.topic_key <> ''
    ), c_latest as (
      select distinct on (v.user_id, v.card_id) v.user_id, v.lecture_id, v.topic_key, v.topic, v.aspect, v.again as wrong, v.slides
        from cr v order by v.user_id, v.card_id, v.reviewed_at desc
    ), items as (
      select * from q_latest union all select * from c_latest
    ), per_user as (
      select i.lecture_id, i.topic_key, i.aspect, i.user_id, count(*) as n, count(*) filter (where i.wrong) as bad
        from items i group by i.lecture_id, i.topic_key, i.aspect, i.user_id
    ), cell as (
      select u.lecture_id, u.topic_key, u.aspect, count(*)::int as people,
             (count(*) filter (where u.bad * 2 >= u.n))::int as struggling
        from per_user u group by u.lecture_id, u.topic_key, u.aspect
    ), named as (
      select i.lecture_id, i.topic_key, i.aspect, min(i.topic) as topic from items i group by 1, 2, 3
    ), sl as (
      select z.lecture_id, z.topic_key, z.aspect, array_agg(z.n order by z.k desc, z.n) filter (where z.rk <= 2) as slides
        from (select i.lecture_id, i.topic_key, i.aspect, s.n, count(distinct i.user_id) as k,
                     row_number() over (partition by i.lecture_id, i.topic_key, i.aspect order by count(distinct i.user_id) desc, s.n) as rk
                from items i cross join lateral unnest(i.slides) as s(n)
               where i.wrong
               group by i.lecture_id, i.topic_key, i.aspect, s.n) z
       group by z.lecture_id, z.topic_key, z.aspect
    ), up as (
      insert into study_private.pulse_cells (group_id, lecture_id, topic_key, aspect, cutoff, people, struggling, hot_on)
      select g, x.lecture_id, x.topic_key, x.aspect, c, x.people, x.struggling,
             case when x.struggling >= 3 and x.struggling * 2 >= x.people
                  then ((c at time zone 'Asia/Jerusalem') - interval '4 hours')::date end
        from cell x
      on conflict (lecture_id, topic_key, aspect) do update
         set cutoff = excluded.cutoff, people = excluded.people, struggling = excluded.struggling,
             hot_on = coalesce(excluded.hot_on, study_private.pulse_cells.hot_on)
      returning lecture_id, topic_key, aspect, people, struggling, hot_on
    )
    insert into public.study_pulse_topics (group_id, lecture_id, topic_key, topic, aspect, bucket, slides, closed_week, cutoff)
    select g, u.lecture_id, u.topic_key, left(coalesce(nm.topic, u.topic_key), 120), u.aspect, b.bucket,
           coalesce(s.slides, '{}'),
           b.bucket = 'cool' and u.hot_on is not null
             and u.hot_on >= ((c at time zone 'Asia/Jerusalem') - interval '4 hours')::date - 7,
           c
      from up u
      left join named nm on nm.lecture_id = u.lecture_id and nm.topic_key = u.topic_key and nm.aspect = u.aspect
      left join sl s on s.lecture_id = u.lecture_id and s.topic_key = u.topic_key and s.aspect = u.aspect
      cross join lateral (select case
               when u.struggling >= 3 and u.struggling * 2 >= u.people then 'hot'
               when u.struggling * 4 >= u.people and u.struggling >= 1 then 'warm'
               else 'cool' end as bucket) b
     where u.people >= 3;
    -- Cells nobody has touched for 60 days are forgotten.
    delete from study_private.pulse_cells x where x.group_id = g and x.cutoff < c - interval '60 days';

    -- ── 3. Cards at least 3 members forgot after learning them ("דרושה אסוציאציה") ──
    delete from public.study_pulse_cards x where x.group_id = g;
    insert into public.study_pulse_cards (group_id, lecture_id, card_id, cutoff)
    select g, min(v.lecture_id::text)::uuid, v.card_id, c
      from study_private.pulse_reviews(g, w, c) v
     where v.lapse
     group by v.card_id
    having count(distinct v.user_id) >= 3;

    -- ── 4. Paragraphs at least 3 members found hard (a wrong answer now, a lapse, a "?") ──
    delete from public.study_pulse_spots x where x.group_id = g;
    insert into public.study_pulse_spots (group_id, lecture_id, part_idx, anchor, cutoff)
    select g, h.lecture_id, h.part_idx, h.anchor, c
      from (
        select l.user_id, l.lecture_id, l.part_idx, l.anchor
          from (select distinct on (e.user_id, e.question_id) e.user_id, e.lecture_id, e.part_idx, e.anchor, e.correct
                  from study_private.pulse_answers(g, w, c) e
                 order by e.user_id, e.question_id, e.answered_at desc) l
         where not l.correct
        union
        select v.user_id, v.lecture_id, v.part_idx, v.anchor from study_private.pulse_reviews(g, w, c) v where v.lapse
        union
        select u.user_id, u.lecture_id, u.part_idx, u.anchor
          from study_private.pulse_unclear(g, w, c) u
         where u.user_id in (select x.user_id from study_private.pulse_counted(g) x)
      ) h
      join public.study_lectures lec on lec.id = h.lecture_id and lec.group_id = g
     where h.part_idx is not null and h.anchor is not null
     group by h.lecture_id, h.part_idx, h.anchor
    having count(distinct h.user_id) >= 3;

    -- ── 5. Traps: found tonight, opened the next study day ──
    for r in
      select x.question_id, x.trap_option as opt from study_private.pulse_q x
       where x.group_id = g and x.trap_people >= 3 and x.trap_option is not null
    loop
      perform study_private.trap_add(r.question_id, r.opt, 'pulse', c, false);
    end loop;
    -- "על בטוח" by at least 3: also a museum exhibit, numbered per lecture, opening the next study day.
    for r in
      select x.question_id, x.sure_option as opt from study_private.pulse_q x
       where x.group_id = g and x.sure_people >= 3 and x.sure_option is not null
    loop
      perform study_private.trap_add(r.question_id, r.opt, 'pulse', c, false);
      update public.study_traps t
         set exhibit_no = (select coalesce(max(t2.exhibit_no), 0) + 1 from public.study_traps t2 where t2.lecture_id = t.lecture_id),
             exhibit_at = study_private.pulse_next_cutoff(c)
       where t.question_id = r.question_id and t.option = r.opt and t.exhibit_no is null;
    end loop;
    -- A trap whose question was retired or flagged as wrong is withdrawn, and its card leaves every deck.
    for r in
      select t.id from public.study_traps t
        join public.study_questions q on q.id = t.question_id
       where t.group_id = g and t.state in ('pending', 'open')
         and (q.retired_at is not null
              or exists (select 1 from public.study_question_flags f
                          where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides')))
    loop
      update public.study_traps t set state = 'withdrawn' where t.id = r.id;
      perform study_private.trap_unmake(r.id);
    end loop;
    -- Open what is due: its card joins every deck.
    for r in
      select t.id from public.study_traps t where t.group_id = g and t.state = 'pending' and t.opens_at <= c
    loop
      update public.study_traps t set state = 'open', opened_at = c where t.id = r.id;
      perform study_private.trap_make(r.id);
    end loop;

    -- ── 6. Open traps: still falling? retired? ──
    -- A retest is a counted member's first answer of a study day to the trap's
    -- question, or a review of its card, after it opened. Retired when at
    -- least 3 members answered it right on two different study days, and
    -- every member active in the last 14 days did, with their latest retest
    -- right. Falling when at least 3 retested and a third or more of them got
    -- it wrong last time.
    for r in
      with t as (
        select x.id, x.question_id, x.option, x.card_id, x.opened_at from public.study_traps x
         where x.group_id = g and x.state = 'open' and x.opened_at is not null
      ), rt as (
        select t.id as trap_id, e.user_id, e.day, e.correct, e.answered_at as at
          from t join study_private.pulse_answers(g, w, c) e on e.question_id = t.question_id and e.answered_at >= t.opened_at
        union all
        select t.id, v.user_id, ((v.reviewed_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date, not v.again, v.reviewed_at
          from t join study_private.pulse_reviews(g, w, c) v on v.card_id = t.card_id and v.reviewed_at >= t.opened_at
      ), per_user as (
        select x.trap_id, x.user_id,
               count(distinct x.day) filter (where x.correct) as right_days,
               (array_agg(x.correct order by x.at desc))[1] as last_right
          from rt x group by x.trap_id, x.user_id
      ), active as (
        select distinct y.user_id from (
          select e.user_id from study_private.pulse_answers(g, act, c) e
          union select v.user_id from study_private.pulse_reviews(g, act, c) v) y
      )
      select t.id,
             (select count(*) from per_user p where p.trap_id = t.id) as tested,
             (select count(*) from per_user p where p.trap_id = t.id and not p.last_right) as wrong_now,
             (select count(*) from per_user p where p.trap_id = t.id and p.right_days >= 2 and p.last_right) as done,
             (select count(*) from active a
               where not exists (select 1 from per_user p where p.trap_id = t.id and p.user_id = a.user_id
                                   and p.right_days >= 2 and p.last_right)) as missing
        from t
    loop
      if r.done >= 3 and r.missing = 0 then
        update public.study_traps t set state = 'retired', retired_at = c, falling = false where t.id = r.id;
        perform study_private.trap_unmake(r.id);
      else
        update public.study_traps t set falling = (r.tested >= 3 and r.wrong_now * 3 >= r.tested) where t.id = r.id;
      end if;
    end loop;

    select jsonb_build_object(
             'questions', (select count(*) from public.study_pulse_questions x where x.group_id = g),
             'topics', (select count(*) from public.study_pulse_topics x where x.group_id = g),
             'cards', (select count(*) from public.study_pulse_cards x where x.group_id = g),
             'spots', (select count(*) from public.study_pulse_spots x where x.group_id = g),
             'traps_open', (select count(*) from public.study_traps x where x.group_id = g and x.state = 'open'))
      into v_cnt;
    insert into study_private.pulse_runs (group_id, cutoff, ran_at, counted, members)
    values (g, c, now(), v_cnt, array(select x.user_id from study_private.pulse_counted(g) x))
    on conflict (group_id) do update set cutoff = excluded.cutoff, ran_at = excluded.ran_at, counted = excluded.counted,
                                         members = excluded.members;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  What the phones call
-- ═══════════════════════════════════════════════════════════════════════

-- The study day's counts are ready: runs the night's count first when
-- pg_cron has not (the first read of the study day). Returns the cut-off
-- they cover, or null while the switch 'pulse' is off or the caller is not
-- among the members the night counted (review SEC-8). Every pulse,
-- museum, trap-card and boss read starts here.
create or replace function public.study_pulse_ready(p_group uuid)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(p_group), false) then raise exception 'forbidden'; end if;
  if not study_private.feature_on('pulse') then return null; end if;
  perform study_private.pulse_night(p_group);
  if not public.study_pulse_reader(p_group) then return null; end if;    -- review SEC-8: reciprocal
  return (select r.cutoff from study_private.pulse_runs r where r.group_id = p_group);
end;
$$;

-- PU1: the group's pulse, every lecture or one. Words only.
create or replace function public.study_pulse(p_group uuid, p_lecture uuid default null)
returns table (lecture_id uuid, topic_key text, topic text, aspect text, bucket text, slides int[],
               closed_week boolean, cutoff timestamptz)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.study_pulse_ready(p_group) is null then return; end if;   -- the switch 'pulse' is off
  return query
  select t.lecture_id, t.topic_key, t.topic, t.aspect, t.bucket, t.slides, t.closed_week, t.cutoff
    from public.study_pulse_topics t
    join public.study_lectures l on l.id = t.lecture_id and l.deleted_at is null
   where t.group_id = p_group and (p_lecture is null or t.lecture_id = p_lecture)
   order by t.lecture_id, case t.bucket when 'hot' then 0 when 'warm' then 1 else 2 end, t.topic_key, t.aspect;
end;
$$;

-- PU1: "אצלך", the caller's own bucket per topic × aspect, from the caller's
-- own answers and reviews of the last 28 days, live (security invoker: RLS
-- keeps every row the caller's). Never counted for anyone else.
create or replace function public.study_my_pulse(p_group uuid, p_lecture uuid default null)
returns table (lecture_id uuid, topic_key text, aspect text, items int, wrong int, mine text)
language sql stable set search_path = public as $$
  with q_first as (
    select a.question_id, a.correct, a.answered_at,
           row_number() over (partition by a.question_id, ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
                              order by a.answered_at, a.id) as rn
      from public.study_answers a
     where a.user_id = auth.uid() and a.answered_at >= now() - interval '28 days'
  ), q_latest as (
    select distinct on (f.question_id) f.question_id, f.correct
      from q_first f where f.rn = 1 order by f.question_id, f.answered_at desc
  ), qi as (
    select coalesce(q.lecture_id, q.ref_lecture) as lecture_id, lower(btrim(q.topic)) as topic_key, q.aspect, not l.correct as wrong
      from q_latest l join public.study_questions q on q.id = l.question_id
     where q.group_id = p_group and q.retired_at is null and q.hidden_at is null and btrim(q.topic) <> ''
       and not exists (select 1 from public.study_question_flags f
                        where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides'))
  ), ci as (
    select c.lecture_id, lower(btrim(c.topic)) as topic_key, c.aspect, r.rating = 1 as wrong
      from (select distinct on (x.card_id) x.card_id, x.rating
              from public.study_card_reviews x
             where x.user_id = auth.uid() and x.reviewed_at >= now() - interval '28 days'
             order by x.card_id, x.reviewed_at desc) r
      join public.study_cards c on c.id = r.card_id
     where c.group_id = p_group and c.deleted_at is null and btrim(c.topic) <> ''
  ), it as (select * from qi union all select * from ci)
  select i.lecture_id, i.topic_key, i.aspect, count(*)::int, (count(*) filter (where i.wrong))::int,
         case when count(*) filter (where i.wrong) * 2 >= count(*) then 'hot'
              when count(*) filter (where i.wrong) * 4 >= count(*) and count(*) filter (where i.wrong) >= 1 then 'warm'
              else 'cool' end
    from it i
   where i.lecture_id is not null and (p_lecture is null or i.lecture_id = p_lecture)
   group by i.lecture_id, i.topic_key, i.aspect;
$$;

-- "מחר בפגישה": the lecture's hottest topic and the question its next quiz
-- would ask first (the strongest signal; the stem only, never the key).
create or replace function public.study_pulse_brief(p_lecture uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g uuid := public.study_lecture_group(p_lecture);
  v_hot jsonb;
  v_q   jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false) then raise exception 'lecture not found'; end if;
  if public.study_pulse_ready(g) is null then return jsonb_build_object('hot', null, 'question', null); end if;
  select jsonb_build_object('topic', t.topic, 'aspect', t.aspect, 'slides', to_jsonb(t.slides)) into v_hot
    from public.study_pulse_topics t
    left join study_private.pulse_cells c on c.lecture_id = t.lecture_id and c.topic_key = t.topic_key and c.aspect = t.aspect
   where t.lecture_id = p_lecture and t.bucket = 'hot'
   order by c.struggling::numeric / greatest(c.people, 1) desc nulls last, t.topic_key, t.aspect limit 1;
  select jsonb_build_object('question_id', q.id, 'question', q.question, 'kind', q.kind, 'slides', to_jsonb(q.slides)) into v_q
    from public.study_pulse_questions s join public.study_questions q on q.id = s.question_id
   where s.lecture_id = p_lecture and q.retired_at is null and q.hidden_at is null
   order by case s.signal when 'sure' then 0 when 'missed' then 1 else 2 end, q.created_at, q.id limit 1;
  return jsonb_build_object('hot', v_hot, 'question', v_q);
end;
$$;

-- MU2: the museum of a lecture (or of the group). Exhibits open a study day
-- after they were found. An exhibit shows its question's key and the
-- explanations of the right and the trap option: a deliberate reveal to the
-- whole group, as a quiz's reveal is ("החיסון"). Never a count or a name.
create or replace function public.study_museum(p_group uuid, p_lecture uuid default null)
returns table (trap_id uuid, lecture_id uuid, lecture_title text, exhibit_no int, state text, question_id uuid,
               stem text, claim text, truth text, takeaway text, confused text, slides int[], plaque jsonb,
               opened_at timestamptz, card_id uuid)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.study_pulse_ready(p_group) is null then return; end if;
  return query
  select t.id, t.lecture_id, l.title, t.exhibit_no,
         case when t.state = 'retired' then 'retired'
              when t.falling then 'falling'
              when t.exhibit_at > now() - interval '3 days' then 'new'
              else 'hanging' end,
         q.id, q.question, q.options[t.option + 1], q.options[k.answer + 1], k.takeaway,
         coalesce(k.explanations[t.option + 1], ''), q.slides, t.plaque, t.exhibit_at, t.card_id
    from public.study_traps t
    join public.study_questions q on q.id = t.question_id
    join public.study_question_keys k on k.question_id = t.question_id
    join public.study_lectures l on l.id = t.lecture_id and l.deleted_at is null
   where t.group_id = p_group and (p_lecture is null or t.lecture_id = p_lecture)
     and t.exhibit_no is not null and t.exhibit_at <= now() and t.state in ('open', 'retired')
     and k.answer is not null
   order by t.lecture_id, (t.state = 'retired'), t.exhibit_no desc;
end;
$$;

-- The open trap cards, for the decks and their badge ("חיסון · ממוזיאון
-- המלכודות · מוצג מס׳ 3", "מלכודת של הקבוצה"): every member gets them as new
-- cards, whatever the member adopted.
create or replace function public.study_trap_cards(p_group uuid)
returns table (card_id uuid, trap_id uuid, lecture_id uuid, exhibit_no int, kind text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.study_pulse_ready(p_group) is null then return; end if;
  return query
  select t.card_id, t.id, t.lecture_id,
         case when t.exhibit_at <= now() then t.exhibit_no end,
         case when t.exhibit_no is not null and t.exhibit_at <= now() then 'museum' else 'trap' end
    from public.study_traps t
    join public.study_cards c on c.id = t.card_id and c.deleted_at is null
   where t.group_id = p_group and t.state = 'open';
end;
$$;

-- MU4: the exhibit a meeting may open with (30 seconds): the newest open
-- exhibit of the lecture not yet shown, else the one still catching people.
create or replace function public.study_museum_pick(p_lecture uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare g uuid := public.study_lecture_group(p_lecture);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false) then raise exception 'lecture not found'; end if;
  if public.study_pulse_ready(g) is null then return null; end if;
  return (select t.id from public.study_traps t
           where t.lecture_id = p_lecture and t.state = 'open' and t.exhibit_no is not null and t.exhibit_at <= now()
           order by (t.shown_at is null) desc, t.falling desc, t.exhibit_at desc limit 1);
end;
$$;

-- MU4: the meeting opened with it (any member; once is enough).
create or replace function public.study_museum_shown(p_trap uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_traps t set shown_at = coalesce(t.shown_at, now())
   where t.id = p_trap and coalesce(public.study_is_member(t.group_id), false)
     and t.state = 'open' and t.exhibit_at <= now();
  if not found then raise exception 'exhibit not found'; end if;
end;
$$;

-- op 'plaque' first takes the exhibit for 2 minutes, before it reserves the
-- budget: a second phone gets 'busy' and pays nothing (review SEC-15).
-- Errors: 'forbidden', 'exhibit not found', 'checked' (it has a plaque), 'busy'.
create or replace function public.study_trap_plaque_begin(p_trap uuid, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare t public.study_traps;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into t from public.study_traps x where x.id = p_trap for update;
  if not found or not coalesce(public.study_is_member(t.group_id), false)
     or t.exhibit_no is null or t.exhibit_at > now() or t.state <> 'open' then
    raise exception 'exhibit not found';
  end if;
  if t.plaque is not null then raise exception 'checked'; end if;
  if t.plaque_until > now() then raise exception 'busy'; end if;
  update public.study_traps x set plaque_until = now() + interval '2 minutes' where x.id = p_trap;
end;
$$;

-- MU2's optional plaque (op "plaque", Claude, ≈ $0.01): written once, with the server key.
create or replace function public.study_trap_plaque(p_trap uuid, p_claim text, p_line text, p_key text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if char_length(btrim(coalesce(p_claim, ''))) not between 3 and 120 or char_length(btrim(coalesce(p_line, ''))) not between 3 and 160 then
    raise exception 'bad plaque';
  end if;
  update public.study_traps t
     set plaque = jsonb_build_object('claim', btrim(p_claim), 'line', btrim(p_line))
   where t.id = p_trap and coalesce(public.study_is_member(t.group_id), false)
     and t.exhibit_no is not null and t.exhibit_at <= now() and t.plaque is null;
  return found;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_pulse_optout    enable row level security;
alter table public.study_pulse_topics    enable row level security;
alter table public.study_pulse_questions enable row level security;
alter table public.study_pulse_cards     enable row level security;
alter table public.study_pulse_spots     enable row level security;
alter table public.study_traps           enable row level security;

drop policy if exists "study pulse optout own"    on public.study_pulse_optout;
drop policy if exists "study pulse optout add"    on public.study_pulse_optout;
drop policy if exists "study pulse optout remove" on public.study_pulse_optout;
drop policy if exists "study pulse topics read"    on public.study_pulse_topics;
drop policy if exists "study pulse questions read" on public.study_pulse_questions;
drop policy if exists "study pulse cards read"     on public.study_pulse_cards;
drop policy if exists "study pulse spots read"     on public.study_pulse_spots;

create policy "study pulse optout own" on public.study_pulse_optout
  for select using (user_id = auth.uid());
create policy "study pulse optout add" on public.study_pulse_optout
  for insert with check (user_id = auth.uid() and public.study_is_member(group_id));
create policy "study pulse optout remove" on public.study_pulse_optout
  for delete using (user_id = auth.uid());
create policy "study pulse topics read" on public.study_pulse_topics
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse') and public.study_pulse_reader(group_id));
create policy "study pulse questions read" on public.study_pulse_questions
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse') and public.study_pulse_reader(group_id));
create policy "study pulse cards read" on public.study_pulse_cards
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse') and public.study_pulse_reader(group_id));
create policy "study pulse spots read" on public.study_pulse_spots
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse') and public.study_pulse_reader(group_id));
-- study_traps: no policy on purpose (read through study_museum / study_trap_cards, so nothing shows before it opens).

revoke all on public.study_pulse_optout, public.study_pulse_topics, public.study_pulse_questions, public.study_pulse_cards,
  public.study_pulse_spots, public.study_traps from anon, authenticated;
grant select, delete on public.study_pulse_optout to authenticated;
grant insert (group_id) on public.study_pulse_optout to authenticated;
grant select on public.study_pulse_topics, public.study_pulse_questions, public.study_pulse_cards, public.study_pulse_spots to authenticated;

revoke all on function study_private.pulse_cutoff(timestamptz), study_private.pulse_next_cutoff(timestamptz),
  study_private.pulse_counted(uuid), study_private.pulse_unclear(uuid, timestamptz, timestamptz),
  study_private.pulse_answers(uuid, timestamptz, timestamptz), study_private.pulse_reviews(uuid, timestamptz, timestamptz),
  study_private.trap_make(uuid), study_private.trap_unmake(uuid), study_private.trap_add(uuid, int, text, timestamptz, boolean),
  study_private.pulse_night(uuid, timestamptz, boolean) from public;
revoke all on function public.study_pulse_ready(uuid), public.study_pulse(uuid, uuid), public.study_my_pulse(uuid, uuid),
  public.study_pulse_brief(uuid), public.study_museum(uuid, uuid), public.study_trap_cards(uuid),
  public.study_museum_pick(uuid), public.study_museum_shown(uuid), public.study_trap_plaque(uuid, text, text, text),
  public.study_trap_plaque_begin(uuid, text)
  from public, anon;
grant execute on function public.study_pulse_ready(uuid), public.study_pulse(uuid, uuid), public.study_my_pulse(uuid, uuid),
  public.study_pulse_brief(uuid), public.study_museum(uuid, uuid), public.study_trap_cards(uuid),
  public.study_museum_pick(uuid), public.study_museum_shown(uuid), public.study_trap_plaque(uuid, text, text, text),
  public.study_trap_plaque_begin(uuid, text)
  to authenticated;

-- ── The quiz picks from the counts (Q10): replaces section Z's stub, same
--  name, argument and result. 3 confident errors, 2 missed, 1 split, 0 none.
create or replace function public.study_quiz__signal(p_question uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select case s.signal when 'sure' then 3 when 'missed' then 2 when 'split' then 1 else 0 end
                     from public.study_pulse_questions s where s.question_id = p_question), 0)
$$;
revoke all on function public.study_quiz__signal(uuid) from public, anon, authenticated;

-- ── The night, on pg_cron: 02:17 UTC is 04:17 in an Israeli winter and
--  05:17 in summer, after the study day starts either way. Without pg_cron
--  the first read of the study day counts (study_pulse_ready).
do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is off: the pulse counts on the first read of each study day instead.';
  else
    perform cron.schedule('study-pulse-night', '17 2 * * *', 'select study_private.pulse_night()');
  end if;
end $$;

insert into study_private.schema_sections (section, version) values ('U', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

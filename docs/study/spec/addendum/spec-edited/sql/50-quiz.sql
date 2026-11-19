-- ════════════════════════════════════════════════════════════════════════
--  SECTION Z · THE LIVE GROUP QUIZ   (owned by package Z)
--  design-quiz.md §2.2. After section Q (it reads and writes its tables).
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  the live group quiz, "מבחן קבוצתי"
--  (mode 'coop') and "מבחן תחרותי" (mode 'race'). To be appended to
--  supabase/study-schema.sql AFTER the practice-questions block
--  (design-questions.md): it reads study_questions, study_question_keys and
--  study_question_flags, and writes study_answers. Re-runnable.
--
--  The database is the referee
--  ───────────────────────────
--  The clock, the answer key and the scores stay in Postgres until their
--  time. A phone sends one thing, "option 2 for question 4", through
--  study_quiz_answer(); the server stamps the time itself and keeps the
--  first answer only. The key is read only inside the reveal, which scores
--  everyone at once, closes the round for good and copies each answer into
--  its owner's private study_answers (mode 'quiz'), so a quiz answer counts
--  in that member's own mistakes and weak points, as practice does. While a
--  round is open its key is "held" (study_question_keys.held_until), so the
--  practice functions refuse to hand it out (questions-hold.sql).
--
--  Who sees what
--  ─────────────
--  study_quizzes (the whole group): that a quiz is open or was held, its
--    lectures, settings, state, host, how many play and how many answered.
--    Nothing secret, so the library banner reads it and Realtime sends it.
--  study_quiz_rounds / _players / _answers: no grants at all.
--    study_quiz_state() hands each caller what they may see: the question
--    while it is open, never its key; after the reveal the key, every
--    option's explanation and the anonymous count per option; the others'
--    scores only in a race and only to its players; in a group quiz each
--    player's result only to that player.
--
--  Realtime: only study_quizzes is published. Everything a phone must react
--  to (a join, a question opening, the answer count, the reveal, a new host,
--  the end) changes that one row; Postgres Changes, checked against its RLS
--  for every subscriber, tells the phones, and they read study_quiz_state().
--  version changes on every step; an answer only moves answered_n.
--
--  Times: a question opens 3 s after the host's tap (every phone has it by
--  then and counts down to the same server instant); answers are taken until
--  1.5 s after its deadline (a tap sent in time is not lost in transit); a
--  round still open 3 s after that is revealed by whichever phone asks next;
--  a player not seen for 30 s is "away" (not waited for; a host who is away
--  can be replaced); a quiz untouched for 20 minutes is over.
-- ═══════════════════════════════════════════════════════════════════════

-- ── A quiz: one row per game. idx = the round on screen (-1 in the lobby);
--  opens_at/closes_at repeat that round's times so a phone can start counting
--  down from the Realtime event alone.
create table if not exists public.study_quizzes (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  mode        text        not null check (mode in ('coop', 'race')),
  title       text        not null check (char_length(title) between 1 and 200),
  lecture_ids uuid[]      not null check (cardinality(lecture_ids) between 1 and 40),
  kinds       text        not null default 'all' check (kinds in ('all', 'mcq', 'case')),
  n_wanted    int         not null check (n_wanted between 3 and 30),
  seconds     int         not null check (seconds between 15 and 120),
  state       text        not null default 'lobby'
                          check (state in ('lobby', 'question', 'reveal', 'ended', 'cancelled')),
  idx         int         not null default -1 check (idx between -1 and 29),
  n_total     int         not null default 0 check (n_total between 0 and 30),
  opens_at    timestamptz,
  closes_at   timestamptz,
  answered_n  int         not null default 0 check (answered_n >= 0),
  players_n   int         not null default 0 check (players_n >= 0),
  version     int         not null default 0,
  host_id     uuid        references auth.users (id) on delete set null,
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists study_quizzes_group on public.study_quizzes (group_id, created_at desc);
-- One live quiz per group: the banner shows "the" open quiz.
create unique index if not exists study_quizzes_one_open on public.study_quizzes (group_id)
  where state in ('lobby', 'question', 'reveal');

-- ── Its questions, chosen when it starts. seconds: the host's setting, or
--  more for a long question (study_quiz__seconds). answer: the key as it was
--  at the reveal (history stays right if an exam item is re-keyed later).
--  A question deleted with its lecture leaves the round without one: a round
--  not yet open is skipped, an open one is voided at its reveal.
create table if not exists public.study_quiz_rounds (
  id          uuid        primary key default gen_random_uuid(),
  quiz_id     uuid        not null references public.study_quizzes (id) on delete cascade,
  idx         int         not null check (idx between 0 and 29),
  question_id uuid        references public.study_questions (id) on delete set null,
  seconds     int         not null check (seconds between 15 and 240),
  opens_at    timestamptz,
  closes_at   timestamptz,
  revealed_at timestamptz,
  answer      smallint,
  voided_at   timestamptz,
  voided_by   uuid        references auth.users (id) on delete set null,
  unique (quiz_id, idx)
);
create index if not exists study_quiz_rounds_question on public.study_quiz_rounds (question_id);

-- ── Who plays. seen_at: the last sign of life (every answer, host action
--  and the phone's ping every 15 s while the screen is on). joined_idx: the
--  round on screen when they joined (-1: from the lobby).
create table if not exists public.study_quiz_players (
  quiz_id    uuid        not null references public.study_quizzes (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  joined_idx int         not null default -1,
  seen_at    timestamptz not null default now(),
  left_at    timestamptz,
  score      int         not null default 0 check (score >= 0),
  correct_n  int         not null default 0 check (correct_n >= 0),
  answered_n int         not null default 0 check (answered_n >= 0),
  primary key (quiz_id, user_id)
);
create index if not exists study_quiz_players_user on public.study_quiz_players (user_id);

-- ── One answer per player per round, the first one. choice null = "לא
--  יודעים" (group quiz only). ms: from the round's opening to the server's
--  receipt, capped at the round's time. correct and points are set by the
--  reveal, never before.
create table if not exists public.study_quiz_answers (
  round_id    uuid        not null references public.study_quiz_rounds (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  choice      smallint    check (choice >= 0),
  ms          int         not null check (ms between 0 and 240000),
  answered_at timestamptz not null,
  correct     boolean,
  points      int         not null default 0 check (points between 0 and 1000),
  primary key (round_id, user_id)
);
create index if not exists study_quiz_answers_user on public.study_quiz_answers (user_id);

-- ═══════════════════════════════════════════════════════════════════════
--  Internal helpers (no grants: only the functions below call them, as
--  their owner). The public functions take the quiz row lock first
--  (select ... for update), so answers, reveals and moves of one quiz run
--  one at a time and each sees the others' result.
-- ═══════════════════════════════════════════════════════════════════════

-- Seconds for one question: the host's setting, or more for a long one
-- (reading about 15 characters a second, plus 10 seconds to choose).
create or replace function public.study_quiz__seconds(p_setting int, p_chars int)
returns int language sql immutable set search_path = public as $$
  select least(240, greatest(p_setting, ceil(coalesce(p_chars, 0) / 15.0)::int + 10));
$$;

-- The caller is playing (joined and not left).
create or replace function public.study_quiz__playing(p_quiz uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null);
$$;

-- The host is still playing and was seen in the last 30 seconds.
create or replace function public.study_quiz__host_here(p_quiz uuid)
returns boolean language sql volatile security definer set search_path = public as $$
  select exists (select 1 from public.study_quizzes z
                   join public.study_quiz_players p on p.quiz_id = z.id and p.user_id = z.host_id
                  where z.id = p_quiz and p.left_at is null
                    and p.seen_at > clock_timestamp() - interval '30 seconds');
$$;

create or replace function public.study_quiz__seen(p_quiz uuid)
returns void language sql volatile security definer set search_path = public as $$
  update public.study_quiz_players p set seen_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null;
$$;

-- Everyone still playing and not away (seen in the last 30 s) has answered
-- round p_idx. A player whose phone locked is not waited for; the deadline
-- still closes the round.
create or replace function public.study_quiz__all_answered(p_quiz uuid, p_idx int)
returns boolean language sql volatile security definer set search_path = public as $$
  select not exists (
    select 1 from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
       and p.seen_at > clock_timestamp() - interval '30 seconds'
       and not exists (select 1 from public.study_quiz_answers a
                         join public.study_quiz_rounds r on r.id = a.round_id
                        where r.quiz_id = p_quiz and r.idx = p_idx and a.user_id = p.user_id));
$$;

-- Chooses the questions when the quiz starts (the players are known then):
-- keyed and not retired, from the chosen lectures and kinds; spread over the
-- summary's parts; questions flagged as wrong last; then those the fewest of
-- these players have answered before (counted from their private answers,
-- used only for the order, never returned); then at random. A group quiz
-- follows the lectures' order; a race is shuffled.
create or replace function public.study_quiz__pick(p_quiz uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  z public.study_quizzes;
  n int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  delete from public.study_quiz_rounds r where r.quiz_id = p_quiz;
  with pool as (
    select q.id,
           char_length(q.vignette) + char_length(q.question)
             + coalesce((select sum(char_length(o)) from unnest(q.options) as o), 0) as chars,
           array_position(z.lecture_ids, coalesce(q.lecture_id, q.ref_lecture)) as lec_pos,
           coalesce(q.part_idx, -1) as part_idx,
           exists (select 1 from public.study_question_flags f
                    where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides')) as flagged,
           (select count(distinct a.user_id)
              from public.study_answers a
              join public.study_quiz_players p on p.user_id = a.user_id and p.quiz_id = p_quiz and p.left_at is null
             where a.question_id = q.id) as seen,
           random() as rnd
      from public.study_questions q
     where q.group_id = z.group_id
       and coalesce(q.lecture_id, q.ref_lecture) = any (z.lecture_ids)
       and q.retired_at is null
       and q.has_key
       and (z.kinds = 'all' or q.kind = z.kinds)
  ),
  ranked as (
    select p.*, row_number() over (partition by p.lec_pos, p.part_idx order by p.flagged, p.seen, p.rnd) as rk
      from pool p
  ),
  chosen as (
    select c.* from ranked c order by c.flagged, c.rk, c.seen, c.rnd limit z.n_wanted
  )
  insert into public.study_quiz_rounds (quiz_id, idx, question_id, seconds)
  select p_quiz,
         (row_number() over (order by case when z.mode = 'coop' then c.lec_pos end,
                                      case when z.mode = 'coop' then c.part_idx end,
                                      c.rnd))::int - 1,
         c.id,
         public.study_quiz__seconds(z.seconds, c.chars::int)
    from chosen c;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Ends the quiz: an open round is revealed first (its answers count), then
-- the quiz is 'ended' ('cancelled' if it never left the lobby).
create or replace function public.study_quiz__finish(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.state = 'question' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
  update public.study_quizzes x
     set state = case when z.state = 'lobby' then 'cancelled' else 'ended' end, ended_at = now(),
         opens_at = null, closes_at = null, version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Opens the first round at or after p_idx that still has its question,
-- 3 seconds from now, or ends the quiz when none is left. The round's key
-- is held until its reveal (ten minutes past the deadline at most).
create or replace function public.study_quiz__open(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  r  public.study_quiz_rounds;
  t0 timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select * into r from public.study_quiz_rounds x
   where x.quiz_id = p_quiz and x.idx >= p_idx and x.question_id is not null
   order by x.idx limit 1;
  if not found then
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  update public.study_quiz_rounds x
     set opens_at = t0, closes_at = t0 + make_interval(secs => x.seconds)
   where x.id = r.id;
  update public.study_question_keys k
     set held_until = t0 + make_interval(secs => r.seconds) + interval '10 minutes'
   where k.question_id = r.question_id;
  update public.study_quizzes z
     set state = 'question', idx = r.idx, opens_at = t0, closes_at = t0 + make_interval(secs => r.seconds),
         answered_n = 0, version = z.version + 1, updated_at = now()
   where z.id = p_quiz;
end;
$$;

-- Scores round p_idx if it is the one open, and closes it: the key is read
-- here and nowhere before. Points (race): a right answer is worth 500, plus
-- up to 500 more for speed; a wrong one, "לא יודעים" or none, 0. A round
-- whose question was deleted meanwhile is voided.
create or replace function public.study_quiz__reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  z   public.study_quizzes;
  r   public.study_quiz_rounds;
  k   smallint;
  t   timestamptz := clock_timestamp();
  lim int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state <> 'question' or z.idx <> p_idx then return; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if r.question_id is not null then
    select x.answer into k from public.study_question_keys x where x.question_id = r.question_id;
    update public.study_question_keys x set held_until = null where x.question_id = r.question_id;
  end if;
  if k is null then
    -- No question or no key any more: nothing is scored or recorded.
    update public.study_quiz_rounds x set revealed_at = t, voided_at = t, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  else
    lim := r.seconds * 1000;
    update public.study_quiz_answers a
       set correct = (a.choice is not null and a.choice = k),
           points = case when z.mode = 'race' and a.choice is not null and a.choice = k
                         then 500 + floor(500.0 * (lim - least(a.ms, lim)) / lim)::int
                         else 0 end
     where a.round_id = r.id;
    update public.study_quiz_players p
       set score = p.score + a.points,
           correct_n = p.correct_n + case when a.correct then 1 else 0 end,
           answered_n = p.answered_n + 1
      from public.study_quiz_answers a
     where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
    -- Each answer also lands in its owner's private practice record.
    insert into public.study_answers (user_id, question_id, choice, correct, mode, ms, answered_at)
    select a.user_id, r.question_id, a.choice, a.correct, 'quiz', a.ms, a.answered_at
      from public.study_quiz_answers a
     where a.round_id = r.id;
    update public.study_quiz_rounds x set revealed_at = t, answer = k, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  end if;
  update public.study_quizzes x
     set state = 'reveal', closes_at = least(x.closes_at, t),
         answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
         version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- A round whose time ran out (plus the grace and 3 s) and that nobody
-- revealed (every phone asleep) is revealed by whoever asks next.
create or replace function public.study_quiz__due(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if found and z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  What the phones call
-- ═══════════════════════════════════════════════════════════════════════

-- Opens a quiz in the lobby, with the caller as host and first player.
-- Errors: 'group not found', 'bad mode', 'bad kinds', 'bad count',
-- 'bad seconds', 'lecture not found', 'quiz open' (join that one instead).
create or replace function public.study_quiz_create(p_group uuid, p_mode text, p_lectures uuid[],
  p_count int, p_seconds int, p_kinds text default 'all')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  lec    uuid[];
  t      text;
  course text;
  stale  uuid;
  qid    uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if coalesce(p_mode, '') not in ('coop', 'race') then raise exception 'bad mode'; end if;
  if coalesce(p_kinds, '') not in ('all', 'mcq', 'case') then raise exception 'bad kinds'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'bad count'; end if;
  if p_seconds is null or p_seconds not between 15 and 120 then raise exception 'bad seconds'; end if;
  -- The lectures, once each, in the order given, every one of them in this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o
            from unnest(p_lectures) with ordinality as u(l, o)
           where u.l is not null
           group by u.l) x;
  if lec is null or cardinality(lec) > 40
     or exists (select 1 from unnest(lec) as l(id) where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  -- Two members tapping at once get one quiz and one 'quiz open', not an error from the index.
  perform pg_advisory_xact_lock(hashtext('study_quiz_create:' || p_group::text));
  -- A quiz nobody has touched for 20 minutes is over (its open round still counts).
  for stale in
    select x.id from public.study_quizzes x
     where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')
       and x.updated_at < now() - interval '20 minutes'
       and not exists (select 1 from public.study_quiz_players p
                        where p.quiz_id = x.id and p.seen_at > now() - interval '20 minutes')
  loop
    perform 1 from public.study_quizzes x where x.id = stale for update;
    perform public.study_quiz__finish(stale);
  end loop;
  if exists (select 1 from public.study_quizzes x
              where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')) then
    raise exception 'quiz open';
  end if;
  -- Title: the lecture's; or "<course> · n הרצאות" when they share a course; or the titles.
  select case when count(distinct btrim(l.course)) = 1 then min(btrim(l.course)) end into course
    from public.study_lectures l where l.id = any (lec);
  if cardinality(lec) = 1 then
    select l.title into t from public.study_lectures l where l.id = lec[1];
  elsif coalesce(course, '') <> '' then
    t := course || ' · ' || cardinality(lec) || ' הרצאות';
  else
    select string_agg(l.title, ' · ' order by u.o) into t
      from unnest(lec) with ordinality as u(id, o)
      join public.study_lectures l on l.id = u.id;
  end if;
  insert into public.study_quizzes (group_id, mode, title, lecture_ids, kinds, n_wanted, seconds,
                                    host_id, created_by, players_n, version)
  values (p_group, p_mode, left(coalesce(nullif(btrim(t), ''), 'מבחן'), 200), lec, p_kinds, p_count, p_seconds,
          me, me, 1, 1)
  returning id into qid;
  insert into public.study_quiz_players (quiz_id, user_id) values (qid, me);
  return qid;
end;
$$;

-- Joins (or re-joins) a quiz that is not over: from the lobby or mid-game
-- (a late joiner starts with the round on screen). A quiz left without a
-- host gets the newcomer as host. Errors: 'quiz not found', 'quiz over'.
create or replace function public.study_quiz_join(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if public.study_quiz__playing(p_quiz) then
    perform public.study_quiz__seen(p_quiz);
    return;
  end if;
  insert into public.study_quiz_players (quiz_id, user_id, joined_idx) values (p_quiz, me, z.idx)
  on conflict (quiz_id, user_id) do update set left_at = null, seen_at = clock_timestamp();
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(x.host_id, me), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Leaves. A leaving host hands over to the player seen most recently; the
-- last one out ends the quiz; if everyone left has answered, the round is
-- revealed at once.
create or replace function public.study_quiz_leave(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  z    public.study_quizzes;
  n    int;
  heir uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  update public.study_quiz_players p set left_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = me and p.left_at is null;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  if n = 0 then
    update public.study_quizzes x set players_n = 0 where x.id = p_quiz;
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  if z.host_id = me then
    select p.user_id into heir from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
     order by p.seen_at desc, p.joined_at
     limit 1;
  end if;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(heir, x.host_id), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
  if z.state = 'question' and public.study_quiz__all_answered(p_quiz, z.idx) then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- Host only. From the lobby (p_from = -1) it chooses the questions and opens
-- the first; after a reveal it opens the next, or ends the quiz after the
-- last. p_from is the round on the host's screen: a second tap, or a tap
-- after someone else moved on, does nothing.
-- Errors: 'not host', 'not revealed', 'no questions', 'quiz over'.
create or replace function public.study_quiz_next(p_quiz uuid, p_from int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.idx <> p_from then return; end if;
  if z.state = 'question' then raise exception 'not revealed'; end if;
  if z.state = 'lobby' then
    n := public.study_quiz__pick(p_quiz);
    if n = 0 then raise exception 'no questions'; end if;
    update public.study_quizzes x set n_total = n, started_at = now() where x.id = p_quiz;
    perform public.study_quiz__open(p_quiz, 0);
  else
    perform public.study_quiz__open(p_quiz, z.idx + 1);
  end if;
end;
$$;

-- The one thing a player sends. Returns the answer kept (a retry after a
-- lost response gets the first one back), never whether it is right. The
-- time is the transaction's start (now()): when the request reached the
-- database, so waiting for the quiz row behind another answer costs nothing.
-- Errors: 'not playing', 'not open' (before the countdown ends), 'closed'
-- (revealed, moved on, or more than 1.5 s after the deadline), 'bad choice'.
create or replace function public.study_quiz_answer(p_quiz uuid, p_idx int, p_choice int)
returns table (idx int, choice int, ms int, answered_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me   uuid := auth.uid();
  t    timestamptz := now();
  z    public.study_quizzes;
  r    public.study_quiz_rounds;
  nopt int;
  took int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if found and exists (select 1 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me) then
    return query select p_idx, a.choice::int, a.ms, a.answered_at
                   from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me;
    return;
  end if;
  if z.state <> 'question' or z.idx <> p_idx then raise exception 'closed'; end if;
  if t < r.opens_at then raise exception 'not open'; end if;
  if t > r.closes_at + interval '1.5 seconds' then raise exception 'closed'; end if;
  select cardinality(q.options) into nopt from public.study_questions q where q.id = r.question_id;
  if nopt is null then raise exception 'closed'; end if;
  if p_choice is null then
    if z.mode <> 'coop' then raise exception 'bad choice'; end if;
  elsif p_choice < 0 or p_choice >= nopt then
    raise exception 'bad choice';
  end if;
  took := least(r.seconds * 1000, greatest(0, floor(extract(epoch from (t - r.opens_at)) * 1000)::int));
  insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at)
  values (r.id, me, p_choice, took, t);
  update public.study_quiz_players p set seen_at = clock_timestamp() where p.quiz_id = p_quiz and p.user_id = me;
  if public.study_quiz__all_answered(p_quiz, p_idx) then
    perform public.study_quiz__reveal(p_quiz, p_idx);
  else
    update public.study_quizzes x
       set answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
           updated_at = now()
     where x.id = p_quiz;
  end if;
  return query select p_idx, p_choice, took, t;
end;
$$;

-- Closes the open round and shows the answer. Any player once the time and
-- the grace are over (so a host whose phone locked never stalls the round);
-- in a group quiz the host also earlier ("לחשוף עכשיו"; a race waits for
-- the clock or for everyone's answer). Revealing a round already revealed
-- does nothing. Errors: 'not playing', 'not open', 'too early'.
create or replace function public.study_quiz_reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state <> 'question' or z.idx <> p_idx then return; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if clock_timestamp() < z.opens_at then raise exception 'not open'; end if;
  if clock_timestamp() < z.closes_at + interval '1.5 seconds'
     and not (z.mode = 'coop' and z.host_id = me) then
    raise exception 'too early';
  end if;
  perform public.study_quiz__seen(p_quiz);
  perform public.study_quiz__reveal(p_quiz, p_idx);
end;
$$;

-- Host only: ends the quiz (an open round is revealed first, so its answers
-- count). In the lobby this cancels it.
create or replace function public.study_quiz_end(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__finish(p_quiz);
end;
$$;

-- A player takes over a host who left or has not been seen for 30 seconds
-- (phone locked, battery, closed tab). Error 'host here' otherwise.
create or replace function public.study_quiz_take_host(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if z.host_id = me then return; end if;
  if public.study_quiz__host_here(p_quiz) then raise exception 'host here'; end if;
  update public.study_quizzes x set host_id = me, version = x.version + 1, updated_at = now() where x.id = p_quiz;
  perform public.study_quiz__seen(p_quiz);
end;
$$;

-- Host only, after a reveal: the question was wrong ("ביטול השאלה"). Its
-- points come off everyone's score and its answers leave the private
-- practice records (they were copied with the same time stamp). The round
-- says who voided it.
create or replace function public.study_quiz_void(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  r  public.study_quiz_rounds;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if not found or r.revealed_at is null then raise exception 'not revealed'; end if;
  if r.voided_at is not null then return; end if;
  -- In a race the host also plays: a round is voided only while it is the
  -- current one, never after the scores have moved on (review m3).
  if z.mode = 'race' and z.idx is distinct from p_idx then raise exception 'too late'; end if;
  update public.study_quiz_players p
     set score = greatest(0, p.score - a.points),
         correct_n = greatest(0, p.correct_n - case when a.correct then 1 else 0 end),
         answered_n = greatest(0, p.answered_n - 1)
    from public.study_quiz_answers a
   where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
  delete from public.study_answers s
   using public.study_quiz_answers a
   where a.round_id = r.id and s.user_id = a.user_id and s.question_id = r.question_id
     and s.mode = 'quiz' and s.answered_at = a.answered_at;
  update public.study_quiz_answers a set points = 0 where a.round_id = r.id;
  update public.study_quiz_rounds x set voided_at = clock_timestamp(), voided_by = me where x.id = r.id;
  update public.study_quizzes x set version = x.version + 1, updated_at = now() where x.id = p_quiz;
end;
$$;

-- Every 15 s while the quiz screen is visible, and when it comes back:
-- a sign of life, the server's clock (the phone keeps its offset), and the
-- version (an event missed while the socket was down shows up here).
create or replace function public.study_quiz_ping(p_quiz uuid)
returns table (server_now timestamptz, version int, state text, idx int, answered_n int, host_here boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare z public.study_quizzes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
  end if;
  return query select clock_timestamp(), x.version, x.state, x.idx, x.answered_n, public.study_quiz__host_here(p_quiz)
                 from public.study_quizzes x where x.id = p_quiz;
end;
$$;

-- Everything one screen shows, filtered for the caller (see the header).
-- Members who do not play may watch (lobby, question, reveal) but see no
-- scores and no end summary.
create or replace function public.study_quiz_state(p_quiz uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  z      public.study_quizzes;
  r      public.study_quiz_rounds;
  q      public.study_questions;
  k      public.study_question_keys;
  player boolean;
  v_me   jsonb;
  v_rnd  jsonb;
  v_ppl  jsonb;
  v_sum  jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
    select * into z from public.study_quizzes x where x.id = p_quiz;
  end if;
  player := exists (select 1 from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me);

  select jsonb_build_object('playing', p.left_at is null, 'score', p.score, 'correct_n', p.correct_n,
                            'answered_n', p.answered_n, 'joined_idx', p.joined_idx)
    into v_me
    from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me;

  if z.state in ('question', 'reveal') then
    select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = z.idx;
    select * into q from public.study_questions x where x.id = r.question_id;
    v_rnd := jsonb_build_object(
      'idx', r.idx, 'seconds', r.seconds, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
      'voided', r.voided_at is not null, 'voided_by', r.voided_by,
      'q', case when q.id is null then null else jsonb_build_object(
             'id', q.id, 'kind', q.kind, 'vignette', q.vignette, 'question', q.question,
             'options', to_jsonb(q.options), 'slides', to_jsonb(q.slides), 'topic', q.topic, 'aspect', q.aspect,
             'lecture_id', coalesce(q.lecture_id, q.ref_lecture),
             'lecture_title', (select l.title from public.study_lectures l where l.id = coalesce(q.lecture_id, q.ref_lecture)))
           end,
      'mine', (select jsonb_build_object('choice', a.choice, 'ms', a.ms)
                 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    if z.state = 'reveal' then
      select * into k from public.study_question_keys x where x.question_id = r.question_id;
      v_rnd := v_rnd || jsonb_build_object(
        'answer', r.answer,
        'explanations', to_jsonb(coalesce(k.explanations, '{}'::text[])),
        'takeaway', coalesce(k.takeaway, ''),
        'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                              from generate_series(0, coalesce(cardinality(q.options), 0) - 1) as o(i)
                              left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                          where a.round_id = r.id and a.choice is not null group by a.choice) c
                                     on c.choice = o.i), '[]'::jsonb),
        'dont_know', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.choice is null),
        'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
        'right', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.correct),
        'points', (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me),
        'correct', (select a.correct from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    end if;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'user_id', p.user_id,
             'name', coalesce(m.name, ''),
             'host', p.user_id is not distinct from z.host_id,
             'here', p.left_at is null and p.seen_at > clock_timestamp() - interval '30 seconds',
             'left', p.left_at is not null,
             'joined_idx', p.joined_idx)
           || case when z.mode = 'race' and player
                   then jsonb_build_object('score', p.score, 'correct_n', p.correct_n,
                          'last_points', case when z.state = 'reveal' then
                              (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = p.user_id)
                            end)
                   else '{}'::jsonb end
           order by p.joined_at), '[]'::jsonb)
    into v_ppl
    from public.study_quiz_players p
    left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
   where p.quiz_id = p_quiz;

  if z.state = 'ended' and player then
    select coalesce(jsonb_agg(jsonb_build_object(
             'idx', r2.idx, 'voided', r2.voided_at is not null,
             'q', case when q2.id is null then null else jsonb_build_object(
                    'id', q2.id, 'kind', q2.kind, 'vignette', q2.vignette, 'question', q2.question,
                    'options', to_jsonb(q2.options), 'slides', to_jsonb(q2.slides), 'topic', q2.topic,
                    'aspect', q2.aspect, 'lecture_id', coalesce(q2.lecture_id, q2.ref_lecture)) end,
             'answer', r2.answer, 'explanations', to_jsonb(coalesce(k2.explanations, '{}'::text[])),
             'takeaway', coalesce(k2.takeaway, ''),
             'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id),
             'right', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.correct),
             'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                                   from generate_series(0, coalesce(cardinality(q2.options), 0) - 1) as o(i)
                                   left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                               where a.round_id = r2.id and a.choice is not null group by a.choice) c
                                          on c.choice = o.i), '[]'::jsonb),
             'mine', (select jsonb_build_object('choice', a.choice, 'correct', a.correct, 'points', a.points)
                        from public.study_quiz_answers a where a.round_id = r2.id and a.user_id = me))
             order by r2.idx), '[]'::jsonb)
      into v_sum
      from public.study_quiz_rounds r2
      left join public.study_questions q2 on q2.id = r2.question_id
      left join public.study_question_keys k2 on k2.question_id = r2.question_id
     where r2.quiz_id = p_quiz and r2.revealed_at is not null;
  end if;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'quiz', jsonb_build_object(
      'id', z.id, 'group_id', z.group_id, 'mode', z.mode, 'title', z.title, 'lecture_ids', to_jsonb(z.lecture_ids),
      'kinds', z.kinds, 'n_wanted', z.n_wanted, 'seconds', z.seconds, 'state', z.state, 'idx', z.idx,
      'n_total', z.n_total, 'opens_at', z.opens_at, 'closes_at', z.closes_at, 'answered_n', z.answered_n,
      'players_n', z.players_n, 'version', z.version, 'host_id', z.host_id,
      'created_at', z.created_at, 'started_at', z.started_at, 'ended_at', z.ended_at),
    'me', v_me,
    'host_here', public.study_quiz__host_here(p_quiz),
    'players', v_ppl,
    'round', v_rnd,
    'summary', v_sum);
end;
$$;

-- The library banner: the group's live quiz, unless nobody has touched it
-- for 20 minutes. playing: the caller is in it; names: who is in it, in the
-- order they joined (the banner says "בפנים: שוהם, נועה +3").
create or replace function public.study_quiz_open(p_group uuid)
returns table (id uuid, mode text, title text, state text, idx int, n_total int, players_n int,
               host_id uuid, playing boolean, names text[])
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.state, z.idx, z.n_total, z.players_n, z.host_id,
         exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = z.id and p.user_id = auth.uid() and p.left_at is null),
         array(select coalesce(m.name, '') from public.study_quiz_players p
                 left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
                where p.quiz_id = z.id and p.left_at is null order by p.joined_at)
    from public.study_quizzes z
   where z.group_id = p_group
     and public.study_is_member(p_group)
     and z.state in ('lobby', 'question', 'reveal')
     and (z.updated_at > now() - interval '20 minutes'
          or exists (select 1 from public.study_quiz_players p
                      where p.quiz_id = z.id and p.seen_at > now() - interval '20 minutes'))
   order by z.created_at desc
   limit 1;
$$;

-- The setup screen: how many questions each lecture has ready (keyed, not
-- retired). Security invoker: RLS on study_questions keeps it to members.
create or replace function public.study_quiz_pool(p_group uuid)
returns table (lecture_id uuid, mcq int, cases int)
language sql stable set search_path = public as $$
  select coalesce(q.lecture_id, q.ref_lecture),
         (count(*) filter (where q.kind = 'mcq'))::int,
         (count(*) filter (where q.kind = 'case'))::int
    from public.study_questions q
   where q.group_id = p_group and q.retired_at is null and q.has_key
     and coalesce(q.lecture_id, q.ref_lecture) is not null
   group by 1;
$$;

-- The "יחד" tab: the group's last quizzes. The group's share of right
-- answers is shared; my_* are the caller's own, my_rank only in a race the
-- caller played (its table was shown to its players anyway).
create or replace function public.study_quiz_recent(p_group uuid, p_limit int default 5)
returns table (id uuid, mode text, title text, ended_at timestamptz, players_n int, rounds int,
               right_pct int, played boolean, my_correct int, my_answered int, my_rank int)
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.ended_at,
         (select count(*) from public.study_quiz_players p where p.quiz_id = z.id)::int,
         (select count(*) from public.study_quiz_rounds r
           where r.quiz_id = z.id and r.revealed_at is not null and r.voided_at is null)::int,
         (select round(100.0 * count(*) filter (where a.correct) / nullif(count(*), 0))::int
            from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id
           where r.quiz_id = z.id and r.voided_at is null),
         me.user_id is not null, me.correct_n, me.answered_n,
         case when z.mode = 'race' and me.user_id is not null then
           (select count(*) + 1 from public.study_quiz_players o where o.quiz_id = z.id and o.score > me.score)::int
         end
    from public.study_quizzes z
    left join public.study_quiz_players me on me.quiz_id = z.id and me.user_id = auth.uid()
   where z.group_id = p_group and public.study_is_member(p_group) and z.state = 'ended'
   order by z.ended_at desc
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_quizzes      enable row level security;
alter table public.study_quiz_rounds  enable row level security;
alter table public.study_quiz_players enable row level security;
alter table public.study_quiz_answers enable row level security;

-- (In study-schema.sql the file's loop has already dropped this; the drop
-- keeps this block re-runnable on its own.)
drop policy if exists "study quizzes read" on public.study_quizzes;
create policy "study quizzes read" on public.study_quizzes
  for select using (public.study_is_member(group_id));
-- study_quiz_rounds, study_quiz_players, study_quiz_answers: no policy on purpose.

revoke all on public.study_quizzes, public.study_quiz_rounds, public.study_quiz_players, public.study_quiz_answers
  from anon, authenticated;
grant select on public.study_quizzes to authenticated;

revoke all on function public.study_quiz__seconds(int, int), public.study_quiz__playing(uuid),
  public.study_quiz__host_here(uuid), public.study_quiz__seen(uuid), public.study_quiz__all_answered(uuid, int),
  public.study_quiz__pick(uuid), public.study_quiz__finish(uuid), public.study_quiz__open(uuid, int),
  public.study_quiz__reveal(uuid, int), public.study_quiz__due(uuid)
  from public, anon, authenticated;
revoke all on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  from public, anon;
grant execute on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  to authenticated;

-- ── Realtime: the quiz row only (never rounds, players or answers).
do $$
begin
  begin
    alter publication supabase_realtime add table public.study_quizzes;
  exception when duplicate_object then
    null;
  end;
end $$;

insert into study_private.schema_sections (section, version) values ('Z', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


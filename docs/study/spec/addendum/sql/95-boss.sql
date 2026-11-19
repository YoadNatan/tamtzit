-- ════════════════════════════════════════════════════════════════════════
--  SECTION H · THE BOSS BATTLE   (package H)
--  addendum "fun" (B1-B3). After sections Z (the quiz engine, with the
--  boss hooks of this addendum's Z patch) and U (the pulse's hot topics and
--  the museum's traps). A battle is a live quiz in mode 'boss': Z keeps the
--  clock, the key and the answers; this section chooses the rounds, turns
--  each reveal into hit points, and adds the relapse rounds. Re-runnable.
--
--  Who sees what
--  ─────────────
--  The battle (heads, hit points, the moments) is the group's and holds
--  aggregates only: a round counts only when at least 3 answered, a wrong
--  answer costs the team, never a person, and no moment names anyone. Each
--  player's own mistakes ("השלל") are theirs alone (study_loot, owner-only).
-- ════════════════════════════════════════════════════════════════════════

-- Section Z must carry this addendum's hook points (its pick, its scored
-- reveal and its state call the boss hooks). Without them a battle could be
-- opened but never played, so this section refuses to load (in the SQL
-- editor an error stops the whole run), and it records H: 1 only when they
-- are there: H: 1 in the registry (REQUIRED_SCHEMA) also means "Z has the hooks".
create or replace function study_private.boss_hooks_ok()
returns boolean language sql stable set search_path = public as $$
  select coalesce((select bool_or(position('study_quiz__pick_boss(' in p.prosrc) > 0)
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'study_quiz__pick'), false)
     and coalesce((select bool_or(position('study_quiz__after_reveal(' in p.prosrc) > 0)
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('study_quiz__reveal', 'study_quiz__score')), false)
     and coalesce((select bool_or(position('study_quiz__boss_state(' in p.prosrc) > 0)
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'study_quiz_state'), false)
$$;
revoke all on function study_private.boss_hooks_ok() from public;
do $$
begin
  if not study_private.boss_hooks_ok() then
    raise exception 'section H needs section Z with the boss hook points (addendum fun, patches/apply.py)';
  end if;
end $$;

create table if not exists public.study_boss_battles (
  id          uuid        primary key default gen_random_uuid(),
  quiz_id     uuid        not null unique references public.study_quizzes (id) on delete cascade,
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 160),
  lecture_ids uuid[]      not null check (cardinality(lecture_ids) between 1 and 40),
  -- [{k: topic key, name, max, hp, qs: [question ids], key_q, trap_q, trap_opt, relapses, down}]
  heads       jsonb       not null check (jsonb_typeof(heads) = 'array' and jsonb_array_length(heads) between 1 and 4),
  -- one entry per round, by idx: {h: head, q: question, relapse, done, dmg, loss, few}
  rounds      jsonb       not null default '[]'::jsonb,
  planned     int         not null check (planned between 3 and 30),
  team_hp     int         not null default 100 check (team_hp between 0 and 100),
  log         jsonb       not null default '[]'::jsonb,       -- the moments, without names
  outcome     text        check (outcome in ('won', 'lost')),
  revenge_of  uuid        references public.study_boss_battles (id) on delete set null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists study_boss_battles_group on public.study_boss_battles (group_id, created_at desc);

-- "השלל": the caller's own battle mistakes, spread over 3 study days
-- ("לתוכנית שלי"). Owner-only; Today's queue and the plan read it.
create table if not exists public.study_loot (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  quiz_id     uuid        not null references public.study_quizzes (id) on delete cascade,
  question_id uuid        not null references public.study_questions (id) on delete cascade,
  due_on      date        not null,
  done_at     timestamptz,
  primary key (user_id, quiz_id, question_id)
);

-- ═══════════════════════════════════════════════════════════════════════
--  Choosing the heads: the hot topics of the chosen lectures (at least 3
--  members struggle with each: the pulse's "חם"), then the museum's open
--  exhibits, at most 4, at least 2. Each head gets up to 3 questions on its
--  topic, the strongest group signal first; its first is the "key"
--  question the head relapses on; its trap (an open trap card's option) costs
--  the team 20 HP when most of the group falls for it.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function study_private.boss_heads(p_group uuid, p_lectures uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_heads jsonb := '[]'::jsonb;
  r       record;
  qs      uuid[];
  tq      uuid;
  topt    int;
begin
  for r in
    with hot as (
      select t.topic_key, max(t.topic) as name, max(c.struggling::numeric / greatest(c.people, 1)) as share, 0 as src
        from public.study_pulse_topics t
        join study_private.pulse_cells c on c.lecture_id = t.lecture_id and c.topic_key = t.topic_key and c.aspect = t.aspect
       where t.group_id = p_group and t.lecture_id = any (p_lectures) and t.bucket = 'hot'
       group by t.topic_key
    ), museum as (
      select lower(btrim(q.topic)) as topic_key, max(btrim(q.topic)) as name, 0::numeric as share, 1 as src
        from public.study_traps x join public.study_questions q on q.id = x.question_id
       where x.group_id = p_group and x.lecture_id = any (p_lectures) and x.state = 'open'
         and x.exhibit_no is not null and x.exhibit_at <= now() and btrim(q.topic) <> ''
       group by lower(btrim(q.topic))
    )
    select * from (
      select h.* from hot h
      union all
      select m.* from museum m where not exists (select 1 from hot h where h.topic_key = m.topic_key)
    ) z order by z.src, z.share desc, z.topic_key
  loop
    exit when jsonb_array_length(v_heads) >= 4;
    select array_agg(x.id order by x.ord) into qs
      from (select q.id, row_number() over (order by public.study_quiz__signal(q.id) desc,
                                                    exists (select 1 from public.study_traps t where t.question_id = q.id and t.state = 'open') desc,
                                                    random()) as ord
              from public.study_questions q
             where q.group_id = p_group and coalesce(q.lecture_id, q.ref_lecture) = any (p_lectures)
               and lower(btrim(q.topic)) = r.topic_key and q.retired_at is null and q.hidden_at is null and q.has_key
               and not exists (select 1 from public.study_question_flags f
                                where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides'))) x
     where x.ord <= 3;
    continue when qs is null;
    tq := null; topt := null;
    select t.question_id, t.option into tq, topt from public.study_traps t
     where t.question_id = any (qs) and t.state = 'open' order by t.exhibit_no nulls last, t.found_at limit 1;
    v_heads := v_heads || jsonb_build_array(jsonb_build_object(
      'k', r.topic_key, 'name', left(r.name, 60), 'qs', to_jsonb(qs), 'key_q', qs[1],
      'trap_q', tq, 'trap_opt', topt, 'relapses', 0, 'down', false));
  end loop;
  return v_heads;
end;
$$;

-- Opens a battle (B1) as a live quiz in mode 'boss' (the lobby; the host
-- starts it as any quiz). p_revenge: "סבב נקמה", the heads that were still
-- standing at the end of a lost battle, from the next study day on.
-- Errors: 'not signed in', 'group not found', 'off' (the switch 'pulse'),
-- 'lecture not found', 'no heads', 'revenge not yet', 'quiz open' and
-- Z's errors of study_quiz_create.
create or replace function public.study_boss_create(p_group uuid, p_lectures uuid[], p_seconds int default 45,
  p_revenge uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  lec     uuid[];
  v_heads jsonb;
  old     public.study_boss_battles;
  k       int;
  base    int;
  planned int;
  v_name  text;
  course  text;
  qid     uuid;
  rounds  jsonb := '[]'::jsonb;
  h       int;
  q       jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  if not study_private.feature_on('pulse') then raise exception 'off'; end if;
  if p_revenge is not null then
    select * into old from public.study_boss_battles b where b.id = p_revenge and b.group_id = p_group;
    if not found or old.outcome is distinct from 'lost' then raise exception 'no heads'; end if;
    if study_private.pulse_cutoff(now()) <= old.ended_at then raise exception 'revenge not yet'; end if;
    lec := old.lecture_ids;
    select coalesce(jsonb_agg(x.e - 'hp' - 'max' || jsonb_build_object('relapses', 0, 'down', false) order by x.o), '[]'::jsonb)
      into v_heads
      from jsonb_array_elements(old.heads) with ordinality as x(e, o)
     where not (x.e ->> 'down')::boolean;
  else
    select array_agg(x.l order by x.o) into lec
      from (select u.l, min(u.o) as o from unnest(p_lectures) with ordinality as u(l, o) where u.l is not null group by u.l) x;
    if lec is null or cardinality(lec) > 40
       or exists (select 1 from unnest(lec) as l(id) where public.study_lecture_group(l.id) is distinct from p_group) then
      raise exception 'lecture not found';
    end if;
    -- review SEC-8: the heads are the pulse's hot topics; a member the
    -- night did not count (opted out, a new or unsaved account) reads none
    if public.study_pulse_ready(p_group) is null then raise exception 'no heads'; end if;
    v_heads := study_private.boss_heads(p_group, lec);
  end if;
  k := jsonb_array_length(v_heads);
  if k < 2 and p_revenge is null then raise exception 'no heads'; end if;
  if k < 1 then raise exception 'no heads'; end if;
  -- Hit points: 100 shared out, the first head takes the remainder.
  base := 100 / k;
  select coalesce(jsonb_agg(x.e || jsonb_build_object('max', m.mx, 'hp', m.mx) order by x.o), '[]'::jsonb) into v_heads
    from jsonb_array_elements(v_heads) with ordinality as x(e, o)
    cross join lateral (select case when x.o = 1 then 100 - base * (k - 1) else base end as mx) m;
  for h in 0 .. k - 1 loop
    for q in select * from jsonb_array_elements(v_heads -> h -> 'qs') loop
      rounds := rounds || jsonb_build_array(jsonb_build_object('h', h, 'q', q #>> '{}', 'relapse', false, 'done', false));
    end loop;
  end loop;
  planned := jsonb_array_length(rounds);
  if planned < 3 then raise exception 'no heads'; end if;
  -- The boss's name: the lectures' course, or the lecture.
  select case when count(distinct btrim(l.course)) = 1 and min(btrim(l.course)) <> '' then min(btrim(l.course)) end into course
    from public.study_lectures l where l.id = any (lec);
  if cardinality(lec) = 1 or course is null then
    select l.title into v_name from public.study_lectures l where l.id = lec[1];
  else
    v_name := course;
  end if;
  v_name := left('ההידרה של ' || coalesce(v_name, 'הקורס'), 160);
  qid := public.study_quiz_create(p_group, 'boss', lec, planned, coalesce(p_seconds, 45), 'all');
  update public.study_quizzes z set title = left('קרב הבוס · ' || v_name, 200) where z.id = qid;
  insert into public.study_boss_battles (quiz_id, group_id, name, lecture_ids, heads, rounds, planned, revenge_of)
  values (qid, p_group, v_name, lec, v_heads, rounds, planned, p_revenge);
  return qid;
end;
$$;

-- Z's hook: the battle's rounds, in head order (replaces Z's stub). At least
-- 3 players: below three, every hit would tell who missed.
create or replace function public.study_quiz__pick_boss(p_quiz uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  z public.study_quizzes;
  b public.study_boss_battles;
  n int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  select * into b from public.study_boss_battles x where x.quiz_id = p_quiz;
  if not found then return 0; end if;
  if (select count(*) from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null) < 3 then
    raise exception 'need 3';
  end if;
  insert into public.study_quiz_rounds (quiz_id, idx, question_id, seconds)
  select p_quiz, (r.o - 1)::int, q.id,
         public.study_quiz__seconds(z.seconds, char_length(q.vignette) + char_length(q.question)
                                    + coalesce((select sum(char_length(o)) from unnest(q.options) as o), 0)::int)
    from jsonb_array_elements(b.rounds) with ordinality as r(e, o)
    join public.study_questions q on q.id = (r.e ->> 'q')::uuid
   where q.retired_at is null and q.hidden_at is null and q.has_key and r.o <= 30;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Z's hook after each scored reveal (replaces Z's stub). Mechanics (B2):
--   * a round counts only when at least 3 answered;
--   * the head on screen loses up to its share (its HP / its questions),
--     in full at 80% right or more ("עברנו");
--   * the team loses up to 150 / planned rounds × the share of wrong
--     answers; when half or more of the answers chose the head's trap,
--     at least 20 ("Primaquine בלי G6PD");
--   * a head still standing after its questions relapses (twice at most):
--     it regains half a share and its key question comes back; answered
--     80% right, the head falls at once;
--   * all heads down: won; team at 0, or nothing left to ask: lost.
create or replace function public.study_quiz__after_reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  z        public.study_quizzes;
  b        public.study_boss_battles;
  e        jsonb;
  h        int;
  hd       jsonb;
  nq       int;
  per_q    int;
  answered int;
  rgt      int;
  trapn    int;
  dmg      int;
  loss     int;
  hp       int;
  v_log    jsonb;
  v_rounds jsonb;
  v_heads  jsonb;
  team     int;
  later    boolean;
  ni       int;
  left_q   int;
  sec      int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.mode <> 'boss' then return; end if;
  select * into b from public.study_boss_battles x where x.quiz_id = p_quiz for update;
  if not found or b.outcome is not null then return; end if;
  e := b.rounds -> p_idx;
  if e is null or coalesce((e ->> 'done')::boolean, false) then return; end if;
  h := (e ->> 'h')::int;
  hd := b.heads -> h;
  v_log := b.log; v_rounds := b.rounds; v_heads := b.heads; team := b.team_hp;
  select count(*), count(*) filter (where a.correct),
         count(*) filter (where (hd ->> 'trap_q') is not null and r.question_id = (hd ->> 'trap_q')::uuid
                                and a.choice = (hd ->> 'trap_opt')::int)
    into answered, rgt, trapn
    from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id
   where r.quiz_id = p_quiz and r.idx = p_idx;
  if answered < 3 then
    v_rounds := jsonb_set(v_rounds, array[p_idx::text], e || '{"done": true, "few": true}'::jsonb);
  else
    nq := greatest(1, jsonb_array_length(hd -> 'qs'));
    per_q := ceil((hd ->> 'max')::numeric / nq)::int;
    dmg := round(per_q * least(1.0, (rgt::numeric / answered) / 0.8))::int;
    if (e ->> 'relapse')::boolean and rgt::numeric / answered >= 0.8 then dmg := (hd ->> 'hp')::int; end if;
    hp := greatest(0, (hd ->> 'hp')::int - dmg);
    loss := round(ceil(150.0 / b.planned) * (answered - rgt)::numeric / answered)::int;
    if trapn > 0 and trapn * 2 >= answered then
      loss := greatest(loss, 20);
      v_log := v_log || jsonb_build_array(jsonb_build_object('t', 'trap', 'head', hd ->> 'name', 'q', hd ->> 'trap_q',
                                                             'opt', (hd ->> 'trap_opt')::int, 'hp', -20));
    end if;
    team := greatest(0, team - loss);
    hd := hd || jsonb_build_object('hp', hp);
    v_rounds := jsonb_set(v_rounds, array[p_idx::text], e || jsonb_build_object('done', true, 'dmg', dmg, 'loss', loss));
    if hp = 0 and not (hd ->> 'down')::boolean then
      hd := hd || '{"down": true}'::jsonb;
      v_log := v_log || jsonb_build_array(jsonb_build_object('t', 'down', 'head', hd ->> 'name',
                                                             'relapses', (hd ->> 'relapses')::int));
      -- A fallen head's questions not yet asked are skipped.
      update public.study_quiz_rounds r set question_id = null
       where r.quiz_id = p_quiz and r.idx > p_idx and r.opens_at is null
         and r.idx in (select (x.o - 1)::int from jsonb_array_elements(v_rounds) with ordinality as x(e2, o)
                        where (x.e2 ->> 'h')::int = h);
    else
      -- Its last round so far, and still standing: relapse.
      select exists (select 1 from jsonb_array_elements(v_rounds) with ordinality as x(r, o)
                      where (x.r ->> 'h')::int = h and x.o - 1 > p_idx) into later;
      if hp > 0 and team > 0 and not later and (hd ->> 'relapses')::int < 2 and jsonb_array_length(v_rounds) < 30 then
        hd := hd || jsonb_build_object('relapses', (hd ->> 'relapses')::int + 1,
                                       'hp', least((hd ->> 'max')::int, hp + ceil(per_q / 2.0)::int));
        ni := jsonb_array_length(v_rounds);
        v_rounds := v_rounds || jsonb_build_array(jsonb_build_object('h', h, 'q', hd ->> 'key_q', 'relapse', true, 'done', false));
        select public.study_quiz__seconds(z.seconds, char_length(x.vignette) + char_length(x.question)
                 + coalesce((select sum(char_length(o)) from unnest(x.options) as o), 0)::int)
          into sec
          from public.study_questions x where x.id = (hd ->> 'key_q')::uuid and x.retired_at is null and x.hidden_at is null;
        if sec is not null then
          insert into public.study_quiz_rounds (quiz_id, idx, question_id, seconds)
          values (p_quiz, ni, (hd ->> 'key_q')::uuid, sec);
          update public.study_quizzes x set n_total = x.n_total + 1 where x.id = p_quiz;
        end if;
        v_log := v_log || jsonb_build_array(jsonb_build_object('t', 'relapse', 'head', hd ->> 'name'));
      end if;
    end if;
    v_heads := jsonb_set(v_heads, array[h::text], hd);
  end if;
  -- Decided?
  if not exists (select 1 from jsonb_array_elements(v_heads) x where not (x ->> 'down')::boolean) then
    update public.study_boss_battles x
       set heads = v_heads, rounds = v_rounds, team_hp = team, outcome = 'won', ended_at = now(),
           log = v_log || jsonb_build_array(jsonb_build_object('t', 'last', 'head', hd ->> 'name'))
     where x.id = b.id;
    update public.study_quiz_rounds r set question_id = null where r.quiz_id = p_quiz and r.idx > p_idx and r.opens_at is null;
    return;
  end if;
  select count(*) into left_q from public.study_quiz_rounds r
   where r.quiz_id = p_quiz and r.idx > p_idx and r.opens_at is null and r.question_id is not null;
  if team = 0 or left_q = 0 then
    update public.study_boss_battles x
       set heads = v_heads, rounds = v_rounds, team_hp = team, outcome = 'lost', ended_at = now(),
           log = v_log || case when team = 0 then '[{"t": "fall"}]'::jsonb else '[]'::jsonb end
     where x.id = b.id;
    update public.study_quiz_rounds r set question_id = null where r.quiz_id = p_quiz and r.idx > p_idx and r.opens_at is null;
    return;
  end if;
  update public.study_boss_battles x set heads = v_heads, rounds = v_rounds, team_hp = team, log = v_log where x.id = b.id;
end;
$$;

-- Z's hook: the battle as every phone shows it (replaces Z's stub). The
-- current head is the one whose round is on screen.
create or replace function public.study_quiz__boss_state(p_quiz uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  z public.study_quizzes;
  b public.study_boss_battles;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  select * into b from public.study_boss_battles x where x.quiz_id = p_quiz;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'team_hp', b.team_hp,
    'boss_hp', (select coalesce(sum((x ->> 'hp')::int), 0) from jsonb_array_elements(b.heads) x),
    'heads', (select jsonb_agg(jsonb_build_object('name', x.e ->> 'name', 'hp', (x.e ->> 'hp')::int, 'max', (x.e ->> 'max')::int,
                                                  'down', (x.e ->> 'down')::boolean, 'relapses', (x.e ->> 'relapses')::int,
                                                  'key_q', x.e ->> 'key_q')
                               order by x.o)
                from jsonb_array_elements(b.heads) with ordinality as x(e, o)),
    'head', case when z.idx >= 0 then (b.rounds -> z.idx ->> 'h')::int end,
    'relapse', case when z.idx >= 0 then coalesce((b.rounds -> z.idx ->> 'relapse')::boolean, false) end,
    'trap', case when z.idx >= 0 and (b.rounds -> z.idx ->> 'q') = (b.heads -> ((b.rounds -> z.idx ->> 'h')::int) ->> 'trap_q')
                 then true else false end,
    'last_round', case when z.state = 'reveal' and z.idx >= 0 then b.rounds -> z.idx end,
    'moments', b.log, 'outcome', b.outcome, 'revenge_of', b.revenge_of,
    'revenge_on', case when b.outcome = 'lost' then (((b.ended_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date + 1) end);
end;
$$;

-- B3: the caller's own loot, previewed: every question the caller got wrong
-- in this battle (or did not know), its topic grouped onto one of the next
-- 3 study days, topic after topic.
create or replace function public.study_boss_loot(p_quiz uuid)
returns table (question_id uuid, topic text, slides int[], due_on date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  b public.study_boss_battles;
  today date := ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.study_boss_battles x where x.quiz_id = p_quiz;
  if not found or not coalesce(public.study_is_member(b.group_id), false) then raise exception 'quiz not found'; end if;
  return query
  with mine as (
    select r.question_id, min(r.idx) as first_idx
      from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id
     where r.quiz_id = p_quiz and a.user_id = auth.uid() and a.correct is false and r.voided_at is null
       and r.question_id is not null
     group by r.question_id
  ), topics as (
    select lower(btrim(q.topic)) as k, min(m.first_idx) as first_idx
      from mine m join public.study_questions q on q.id = m.question_id group by lower(btrim(q.topic))
  ), days as (
    select t.k, ((row_number() over (order by t.first_idx) - 1) % 3)::int + 1 as d from topics t
  )
  select m.question_id, btrim(q.topic), q.slides, today + d.d
    from mine m join public.study_questions q on q.id = m.question_id
    join days d on d.k = lower(btrim(q.topic))
   order by d.d, m.first_idx;
end;
$$;

-- "לתוכנית שלי": the loot becomes the caller's private review list.
create or replace function public.study_boss_loot_save(p_quiz uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.study_loot (user_id, quiz_id, question_id, due_on)
  select auth.uid(), p_quiz, l.question_id, l.due_on from public.study_boss_loot(p_quiz) l
  on conflict (user_id, quiz_id, question_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- What of the caller's loot is due (Today's queue and the plan read this).
create or replace function public.study_my_loot(p_group uuid)
returns table (question_id uuid, quiz_id uuid, due_on date)
language sql stable set search_path = public as $$
  select l.question_id, l.quiz_id, l.due_on
    from public.study_loot l join public.study_questions q on q.id = l.question_id
   where l.user_id = auth.uid() and q.group_id = p_group and l.done_at is null
     and l.due_on <= ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date
   order by l.due_on, l.question_id
$$;

-- A loot item answered in the queue.
create or replace function public.study_loot_done(p_question uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_loot l set done_at = now() where l.user_id = auth.uid() and l.question_id = p_question and l.done_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The "יחד" card: which heads a battle would have now, and a revenge round
-- when the group's last battle was lost on an earlier study day.
create or replace function public.study_boss_open(p_group uuid, p_lectures uuid[] default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  lec  uuid[];
  last public.study_boss_battles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  if not study_private.feature_on('pulse') then return jsonb_build_object('heads', '[]'::jsonb); end if;
  -- review SEC-8: only a member the pulse counted sees the heads (hot topics)
  if public.study_pulse_ready(p_group) is null then return jsonb_build_object('heads', '[]'::jsonb); end if;
  lec := coalesce(p_lectures, (select array_agg(l.id) from public.study_lectures l where l.group_id = p_group and l.deleted_at is null));
  select * into last from public.study_boss_battles b where b.group_id = p_group and b.outcome is not null
   order by b.ended_at desc limit 1;
  return jsonb_build_object(
    'heads', coalesce((select jsonb_agg(x ->> 'name') from jsonb_array_elements(study_private.boss_heads(p_group, coalesce(lec, '{}'))) x), '[]'::jsonb),
    'revenge', case when last.outcome = 'lost' then jsonb_build_object(
                 'battle', last.id, 'name', last.name,
                 'heads', (select jsonb_agg(x ->> 'name') from jsonb_array_elements(last.heads) x where not (x ->> 'down')::boolean),
                 'open', study_private.pulse_cutoff(now()) > last.ended_at) end);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_boss_battles enable row level security;
alter table public.study_loot         enable row level security;
drop policy if exists "study boss battles read" on public.study_boss_battles;
drop policy if exists "study loot own"          on public.study_loot;
create policy "study boss battles read" on public.study_boss_battles
  for select using (public.study_is_member(group_id));
create policy "study loot own" on public.study_loot
  for select using (user_id = auth.uid());
revoke all on public.study_boss_battles, public.study_loot from anon, authenticated;
grant select on public.study_boss_battles, public.study_loot to authenticated;

revoke all on function study_private.boss_heads(uuid, uuid[]) from public;
revoke all on function public.study_quiz__pick_boss(uuid), public.study_quiz__after_reveal(uuid, int),
  public.study_quiz__boss_state(uuid) from public, anon, authenticated;
revoke all on function public.study_boss_create(uuid, uuid[], int, uuid), public.study_boss_loot(uuid),
  public.study_boss_loot_save(uuid), public.study_my_loot(uuid), public.study_loot_done(uuid), public.study_boss_open(uuid, uuid[])
  from public, anon;
grant execute on function public.study_boss_create(uuid, uuid[], int, uuid), public.study_boss_loot(uuid),
  public.study_boss_loot_save(uuid), public.study_my_loot(uuid), public.study_loot_done(uuid), public.study_boss_open(uuid, uuid[])
  to authenticated;

insert into study_private.schema_sections (section, version)
select 'H', 1 where study_private.boss_hooks_ok()
on conflict (section) do update set version = excluded.version, loaded_at = now();

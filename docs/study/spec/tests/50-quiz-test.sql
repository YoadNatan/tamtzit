-- ════════════════════════════════════════════════════════════════════════
--  SECTION Z checks · the live group quiz   (package Z)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for quiz.sql (and questions-hold.sql), in the
-- style of supabase/tests/study.sql. Runs in the SAME psql session right
-- after supabase/tests/study.sql (it reuses that file's users, :gid and
-- :code). Throwaway local Postgres only. Time is simulated by moving a
-- round's times into the past (as the table owner), never by sleeping.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
reset role;

-- ── Fixtures (as the owner): two more members, a lecture with six keyed
--  questions (one flagged as wrong), a second lecture with two.
insert into auth.users (id, raw_user_meta_data) values
 ('ffffffff-0000-4000-8000-000000000006', '{"app":"study","full_name":"יעל"}'),
 ('abababab-0000-4000-8000-000000000007', '{"app":"study","full_name":"דנה"}');
insert into public.study_members (group_id, user_id, name) values
 (:'gid', 'ffffffff-0000-4000-8000-000000000006', 'יעל'),
 (:'gid', 'abababab-0000-4000-8000-000000000007', 'דנה');
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by) values
 ('eeeeeeee-0000-4000-8000-000000000009', :'gid', 'פתוגן מאכסן', 'Antimalarials', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 12) n), 'bbbbbbbb-0000-4000-8000-000000000002'),
 ('eeeeeeee-0000-4000-8000-00000000000a', :'gid', 'פתוגן מאכסן', 'Anthelmintics', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 6) n), 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, vignette, question, options, slides, topic, aspect)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, :'gid', 'eeeeeeee-0000-4000-8000-000000000009', 'ai', (i - 1) / 3,
       case when i in (2, 5) then 'case' else 'mcq' end,
       case when i in (2, 5) then repeat('אישה בת 30 חזרה מאפריקה עם חום. ', 40) else '' end,
       'שאלה מספר ' || i || '?', array['א' || i, 'ב' || i, 'ג' || i, 'ד' || i, 'ה' || i], array[i], 'Primaquine', 'contra'
  from generate_series(1, 6) i;
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, (i % 5)::smallint,
       array['הסבר 1 [ש'' 1]', 'הסבר 2', 'הסבר 3', 'הסבר 4', 'הסבר 5'], 'מה לזכור ' || i
  from generate_series(1, 6) i;
insert into public.study_question_flags (question_id, user_id, reason)
values ('99999999-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000003', 'wrong_key');
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, question, options, slides)
select ('88888888-0000-4000-8000-00000000000' || i)::uuid, :'gid', 'eeeeeeee-0000-4000-8000-00000000000a', 'ai', 0, 'mcq',
       'שאלה על תולעים ' || i || '?', array['a', 'b', 'c', 'd'], array[1]
  from generate_series(1, 2) i;
insert into public.study_question_keys (question_id, answer, explanations)
select ('88888888-0000-4000-8000-00000000000' || i)::uuid, 1, array['1', '2', '3', '4'] from generate_series(1, 2) i;

-- Moves the open round (and the quiz row's copy of its times) p_secs into the past.
create or replace function pg_temp.shift(p_quiz uuid, p_secs numeric) returns void language sql as $$
  update public.study_quiz_rounds set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                      closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where quiz_id = p_quiz and opens_at is not null and revealed_at is null;
  update public.study_quizzes set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                  closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where id = p_quiz;
$$;
-- The key of the round on screen (the test's oracle; no member can call this).
create or replace function pg_temp.key_now(p_quiz uuid) returns int language sql as $$
  select k.answer::int from public.study_quizzes z
    join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
    join public.study_question_keys k on k.question_id = r.question_id
   where z.id = p_quiz $$;
create or replace function pg_temp.q_now(p_quiz uuid) returns uuid language sql as $$
  select r.question_id from public.study_quizzes z join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
   where z.id = p_quiz $$;
-- Moves the open round so that its deadline was p_extra seconds ago.
create or replace function pg_temp.expire(p_quiz uuid, p_extra numeric) returns void language sql as $$
  select pg_temp.shift(p_quiz, (select extract(epoch from (z.closes_at - clock_timestamp()))::numeric + p_extra
                                  from public.study_quizzes z where z.id = p_quiz));
$$;
select set_config('t.gid', :'gid', false) is not null as g \gset
set role authenticated;

-- ═════════ 1. Creating ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.qz', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30)::text, false) is not null as qz \gset
select 'QZ1. ' || title || ' · ' || mode || ' · ' || state || ' · players ' || players_n || ' · host is Shoham: ' || (host_id = auth.uid())
       || ' (expect Antimalarials · coop · lobby · players 1 · true)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1b. FAIL: a second open quiz in one group';
exception when others then raise notice 'QZ1b. %: one open quiz per group (%)', case when sqlerrm = 'quiz open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'party', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1c. FAIL: unknown mode';
exception when others then raise notice 'QZ1c. %: modes are coop and race (%)', case when sqlerrm = 'bad mode' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 2, 30);
  raise notice 'QZ1c. FAIL: two questions';
exception when others then raise notice 'QZ1c. %: 3 to 30 questions (%)', case when sqlerrm = 'bad count' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 5);
  raise notice 'QZ1c. FAIL: five seconds';
exception when others then raise notice 'QZ1c. %: 15 to 120 seconds (%)', case when sqlerrm = 'bad seconds' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-0000000000ff']::uuid[], 5, 30);
  raise notice 'QZ1c. FAIL: a lecture that is not the group''s';
exception when others then raise notice 'QZ1c. %: lectures of the group only (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1d. FAIL: a stranger opened a quiz';
exception when others then raise notice 'QZ1d. %: a stranger cannot open a quiz (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QZ1e. stranger sees ' || count(*) || ' quizzes (expect 0)' from public.study_quizzes;
do $$ begin perform public.study_quiz_state(current_setting('t.qz')::uuid); raise notice 'QZ1e. FAIL: stranger read the state';
exception when others then raise notice 'QZ1e. %: stranger cannot read the state (%)', case when sqlerrm = 'quiz not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_join(current_setting('t.qz')::uuid); raise notice 'QZ1e. FAIL: stranger joined';
exception when others then raise notice 'QZ1e. %: stranger cannot join (%)', case when sqlerrm = 'quiz not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ 2. Joining, and what members cannot touch ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select 'QZ2. Noa joined (twice): players ' || players_n || ', version ' || version || ' (expect 2, 2)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
do $$ begin perform public.study_quiz_next(current_setting('t.qz')::uuid, -1); raise notice 'QZ2b. FAIL: Noa started Shoham''s quiz';
exception when others then raise notice 'QZ2b. %: only the host starts (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_rounds; raise notice 'QZ2c. FAIL: rounds are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: rounds are not readable (%)', sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_answers; raise notice 'QZ2c. FAIL: answers are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: answers are not readable (%)', sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_players; raise notice 'QZ2c. FAIL: players are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: players are not readable directly (%)', sqlerrm; end $$;
do $$ begin update public.study_quizzes set host_id = auth.uid(); raise notice 'QZ2d. FAIL: Noa made herself host';
exception when insufficient_privilege then raise notice 'QZ2d. ok: the quiz row changes only through the functions (%)', sqlerrm; end $$;
do $$ begin insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at) values (gen_random_uuid(), auth.uid(), 0, 0, now());
  raise notice 'QZ2d. FAIL: an answer was written directly';
exception when insufficient_privilege then raise notice 'QZ2d. ok: answers go through study_quiz_answer (%)', sqlerrm; end $$;

-- ═════════ 3. Starting: questions chosen, first round held ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.qz')::uuid, -1) is null as n \gset
select 'QZ3. started: ' || state || ', round ' || idx || ' of ' || n_total || ', opens in ' ||
       round(extract(epoch from (opens_at - clock_timestamp())))::int || ' s, version ' || version
       || ' (expect question, round 0 of 5, opens in 3 s, version 3)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
reset role;
select 'QZ3b. the flagged question was left out: ' || (not exists (select 1 from public.study_quiz_rounds
         where quiz_id = current_setting('t.qz')::uuid and question_id = '99999999-0000-4000-8000-000000000006'))
       || '; long cases get more time: ' || string_agg(distinct r.seconds::text, ',' order by r.seconds::text)
       || ' (expect true; 30,97)'
  from public.study_quiz_rounds r where r.quiz_id = current_setting('t.qz')::uuid;
select 'QZ3c. a group quiz keeps the lecture''s order: parts ' || string_agg(q.part_idx::text, ',' order by r.idx) || ' (expect 0,0,0,1,1)'
  from public.study_quiz_rounds r join public.study_questions q on q.id = r.question_id where r.quiz_id = current_setting('t.qz')::uuid;
select set_config('t.q0', pg_temp.q_now(current_setting('t.qz')::uuid)::text, false) is not null as q0 \gset
select set_config('t.k0', pg_temp.key_now(current_setting('t.qz')::uuid)::text, false) is not null as k0 \gset
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
values ('cccccccc-0000-4000-8000-000000000003', current_setting('t.q0')::uuid, 0, false, 'lecture', now() - interval '7 days');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ3d. Noa''s screen: round ' || (s -> 'round' ->> 'idx') || ', ' || jsonb_array_length(s -> 'round' -> 'q' -> 'options') || ' options; key sent: '
       || ((s -> 'round') ? 'answer') || ', explanations sent: ' || ((s -> 'round') ? 'explanations') || ' (expect 0, 5; false, false)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) as s) x;
do $$ begin perform public.study_answer_question(current_setting('t.q0')::uuid, 0); raise notice 'QZ3e. FAIL: practice gave the key of an open quiz round';
exception when others then raise notice 'QZ3e. %: practice refuses a question in an open round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QZ3f. feedback for it while open: ' || count(*) || ' rows (expect 0, although Noa answered it last week)'
  from public.study_question_feedback(array[current_setting('t.q0')::uuid]);

-- ═════════ 4. Answering ═════════
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 1); raise notice 'QZ4. FAIL: answered during the countdown';
exception when others then raise notice 'QZ4. %: no answer before the round opens (%)', case when sqlerrm = 'not open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select pg_temp.shift(current_setting('t.qz')::uuid, 5) is null as s \gset
set role authenticated;
-- Noa answers wrong on purpose: the key plus one.
select 'QZ4b. Noa answered option ' || choice || '; time taken 1.9-2.6 s: ' || (ms between 1900 and 2600)
       || '; the reply says nothing about right or wrong: ' || (answered_at is not null) || ' (expect key+1; true; true)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, (current_setting('t.k0')::int + 1) % 5);
select 'QZ4c. a second tap keeps the first: option ' || choice || ' (expect the same option)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ4d. the row now: answered ' || answered_n || ', version ' || version || ' (expect 1, 3: an answer is not a new step)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
select 'QZ4e. Noa''s screen keeps her choice: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' -> 'mine' ->> 'choice')
       || ' (expect key+1)';
do $$ begin perform public.study_quiz_reveal(current_setting('t.qz')::uuid, 0); raise notice 'QZ4f. FAIL: a player revealed before the time';
exception when others then raise notice 'QZ4f. %: a player cannot reveal early (%)', case when sqlerrm = 'too early' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 0); raise notice 'QZ4g. FAIL: a member who did not join answered';
exception when others then raise notice 'QZ4g. %: only players answer (%)', case when sqlerrm = 'not playing' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 9); raise notice 'QZ4h. FAIL: option 9 of 5';
exception when others then raise notice 'QZ4h. %: the choice must be an option (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ 5. The reveal ═════════
-- Shoham (host) answers right; both players have answered, so the round is revealed at once.
select 'QZ5. Shoham answered ' || choice || ' (expect the key)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ5b. after the last answer: ' || state || ', answered ' || answered_n || ', version ' || version || ' (expect reveal, 2, 4)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ5c. Noa sees: key ' || (r ->> 'answer') || ', ' || jsonb_array_length(r -> 'explanations') || ' explanations, counts ' || (r -> 'counts')::text
       || ', right ' || (r ->> 'right') || ' of ' || (r ->> 'answered') || ', hers right: ' || (r ->> 'correct') || ', points ' || (r ->> 'points')
       || ' (expect the key, 5, one vote on the key and one next to it, 1 of 2, false, 0)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' as r) x;
select 'QZ5d. hold released: feedback now gives ' || count(*) || ' row (expect 1)'
  from public.study_question_feedback(array[current_setting('t.q0')::uuid]);
select 'QZ5e. Noa''s private record has her quiz answer: ' || count(*) || ' (expect 1, mode quiz, wrong)'
  from public.study_answers where question_id = current_setting('t.q0')::uuid and mode = 'quiz' and not correct;
select 'QZ5f. ...and none of Shoham''s: ' || count(*) || ' visible to Noa (expect 0)'
  from public.study_answers where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'QZ5g. a re-sent answer after the reveal changes nothing: ' || choice || ' (expect key+1, her first)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ5h. a group quiz shows no one''s score: ' || coalesce(string_agg(p ->> 'score', ','), 'none') || ' (expect none)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'players') p;

-- ═════════ 6. A late joiner, and the next round ═════════
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select 'QZ6. Yael joined during round ' || (s -> 'me' ->> 'joined_idx') || '; players ' || (s -> 'quiz' ->> 'players_n') || ' (expect 0; 3)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) as s) x;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.qz')::uuid, 0) is null as n \gset
select public.study_quiz_next(current_setting('t.qz')::uuid, 0) is null as n \gset
select 'QZ6b. a second tap on "next" did nothing: round ' || idx || ', state ' || state || ' (expect 1, question)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
reset role;
select set_config('t.k1', pg_temp.key_now(current_setting('t.qz')::uuid)::text, false) is not null as k1 \gset
select set_config('t.q1', pg_temp.q_now(current_setting('t.qz')::uuid)::text, false) is not null as q1 \gset
select pg_temp.shift(current_setting('t.qz')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ6c. Yael answers round 1: ' || choice || ' (expect the key)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 1, current_setting('t.k1')::int);
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ6d. Noa answers "לא יודעים": ' || coalesce(choice::text, 'null') || ' (expect null)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 1, null);
select 'QZ6e. Shoham has not answered: ' || state || ', answered ' || answered_n || ' (expect question, 2)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;

-- ═════════ 7. The host's phone locks ═════════
reset role;
update public.study_quiz_players set seen_at = clock_timestamp() - interval '60 seconds'
 where quiz_id = current_setting('t.qz')::uuid and user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.expire(current_setting('t.qz')::uuid, 2) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ7. host here: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) ->> 'host_here') || ' (expect false)';
select public.study_quiz_reveal(current_setting('t.qz')::uuid, 1) is null as r \gset
select 'QZ7b. after the deadline Noa revealed it: ' || state || ' (expect reveal)' from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 1, 0); raise notice 'QZ7b2. FAIL: an answer after the reveal';
exception when others then raise notice 'QZ7b2. %: no answers after the reveal (%)', case when sqlerrm = 'closed' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_next(current_setting('t.qz')::uuid, 1); raise notice 'QZ7c. FAIL: Noa moved on without being host';
exception when others then raise notice 'QZ7c. %: only the host moves on (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_quiz_take_host(current_setting('t.qz')::uuid) is null as t \gset
select 'QZ7d. Noa took over: host is Noa ' || (host_id = auth.uid()) || ' (expect true)' from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_take_host(current_setting('t.qz')::uuid); raise notice 'QZ7e. FAIL: Shoham took it back while Noa is here';
exception when others then raise notice 'QZ7e. %: no take-over while the host is here (%)', case when sqlerrm = 'host here' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- Noa voids round 1 (the question was wrong): its answers leave everyone's private record.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_void(current_setting('t.qz')::uuid, 1) is null as v \gset
select 'QZ7f. voided: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' ->> 'voided')
       || '; Noa''s quiz answers to it left in her record: ' || (select count(*) from public.study_answers where question_id = current_setting('t.q1')::uuid)
       || ' (expect true; 0)';
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ7g. ...and Yael''s: ' || count(*) || ' (expect 0)' from public.study_answers where question_id = current_setting('t.q1')::uuid;

-- ═════════ 8. Every phone asleep at the deadline ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.qz')::uuid, 1) is null as n \gset
reset role;
select pg_temp.expire(current_setting('t.qz')::uuid, 6) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ8. nobody revealed round 2; Yael''s next look reveals it: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'quiz' ->> 'state')
       || ' (expect reveal)';
select 'QZ8b. her ping also answers with the clock and the version: ' || (server_now is not null) || ', ' || state || ', ' || version
       || ' (expect true, reveal, the same version as the row)'
  from public.study_quiz_ping(current_setting('t.qz')::uuid);

-- ═════════ 9. The end ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_end(current_setting('t.qz')::uuid) is null as e \gset
select 'QZ9. ended: ' || state || ', rounds revealed ' || (select count(*) from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'summary'))
       || ' (expect ended, 3)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
select 'QZ9b. Noa''s summary: hers ' || string_agg(coalesce(s -> 'mine' ->> 'correct', '-'), ',' order by (s ->> 'idx')::int)
       || ', voided ' || string_agg(s ->> 'voided', ',' order by (s ->> 'idx')::int) || ' (expect false,false,-; false,true,false)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'summary') s;
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';
select 'QZ9c. Dana (a member who did not play) gets no summary: ' || coalesce(public.study_quiz_state(current_setting('t.qz')::uuid) ->> 'summary', 'null') || ' (expect null)';
select 'QZ9d. the banner after the end: ' || count(*) || ' open quiz (expect 0)' from public.study_quiz_open(:'gid');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ9e. recent: ' || mode || ', ' || rounds || ' rounds, group right ' || right_pct || '%, mine ' || my_correct || '/' || my_answered
       || ', rank ' || coalesce(my_rank::text, '-') || ' (expect coop, 2 rounds, 50%, 0/1, -)'
  from public.study_quiz_recent(:'gid');
reset role;
select 'QZ9f. no key is held any more: ' || count(*) || ' (expect 0)' from public.study_question_keys where held_until > now();
set role authenticated;

-- ═════════ 10. A race ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.rc', public.study_quiz_create(:'gid', 'race', array['eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 20, 'mcq')::text, false) is not null as rc \gset
select 'QZ10. title of a two-lecture race: ' || title || ' (expect פתוגן מאכסן · 2 הרצאות)' from public.study_quizzes where id = current_setting('t.rc')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_join(current_setting('t.rc')::uuid) is null as j \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_join(current_setting('t.rc')::uuid) is null as j \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.rc')::uuid, -1) is null as n \gset
reset role;
select 'QZ10b. only multiple-choice questions: ' || bool_and(q.kind = 'mcq') || ' (expect true)'
  from public.study_quiz_rounds r join public.study_questions q on q.id = r.question_id where r.quiz_id = current_setting('t.rc')::uuid;
select set_config('t.rk0', pg_temp.key_now(current_setting('t.rc')::uuid)::text, false) is not null as k \gset
select pg_temp.shift(current_setting('t.rc')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.ms_sh', (select ms::text from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, current_setting('t.rk0')::int)), false) is not null as a \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
do $$ begin perform public.study_quiz_answer(current_setting('t.rc')::uuid, 0, null); raise notice 'QZ10c. FAIL: "לא יודעים" in a race';
exception when others then raise notice 'QZ10c. %: a race has no "לא יודעים" (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_reveal(current_setting('t.rc')::uuid, 0); raise notice 'QZ10d. FAIL: the race host revealed early';
exception when others then raise notice 'QZ10d. %: in a race even the host waits for the clock (%)', case when sqlerrm = 'too early' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select pg_temp.shift(current_setting('t.rc')::uuid, 8) is null as s \gset
set role authenticated;
select set_config('t.ms_noa', (select ms::text from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, current_setting('t.rk0')::int)), false) is not null as a \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, (current_setting('t.rk0')::int + 1) % 4) \gset
select 'QZ10e. all three answered: ' || state || ' (expect reveal)' from public.study_quizzes where id = current_setting('t.rc')::uuid;
select 'QZ10f. the table: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'score') || ' (+' || coalesce(p ->> 'last_points', '0') || ')', ', ' order by (p ->> 'score')::int desc)
       || '; Shoham''s is 500 + 500 × (time left / 20 s): ' ||
       bool_or((p ->> 'name') = 'שוהם' and (p ->> 'score')::int = 500 + floor(500.0 * (20000 - current_setting('t.ms_sh')::int) / 20000)::int)
       || ' (expect שוהם ≈950, נועה כהן ≈750, יעל 0; true)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p;
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';
select 'QZ10g. Dana, watching, sees no scores: ' || coalesce(string_agg(p ->> 'score', ','), 'none') || ' (expect none)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p;
-- Next round: a right answer must not move the table before the reveal.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.rc')::uuid, 0) is null as n \gset
do $$ begin perform public.study_quiz_void(current_setting('t.rc')::uuid, 0); raise notice 'QZR1. FAIL: the race host voided a round after the next one opened';
exception when others then raise notice 'QZR1. %: in a race a round is voided only while it is current (%)', case when sqlerrm = 'too late' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select set_config('t.rk1', pg_temp.key_now(current_setting('t.rc')::uuid)::text, false) is not null as k \gset
select pg_temp.shift(current_setting('t.rc')::uuid, 4) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 1, current_setting('t.rk1')::int) \gset
select 'QZ10h. Yael answered right, her score before the reveal: ' || (p ->> 'score') || ' (expect 0)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p where p ->> 'name' = 'יעל';

-- ═════════ 11. Leaving ═════════
-- The host (Noa) leaves mid-round: the most recently seen player becomes host;
-- Shoham answers; everyone still playing has answered, so the round is revealed.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
reset role;
select 'QZ11. host after Noa left: ' || m.name || ', players ' || z.players_n || ' (expect יעל, 2)'
  from public.study_quizzes z join public.study_members m on m.user_id = z.host_id and m.group_id = z.group_id
 where z.id = current_setting('t.rc')::uuid;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 1, (current_setting('t.rk1')::int + 2) % 4) \gset
select 'QZ11b. revealed once the two who stayed answered: ' || state || '; Yael''s score now ' ||
       (select (p ->> 'score') from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p where p ->> 'name' = 'יעל')
       || ' (expect reveal; more than 500)'
  from public.study_quizzes where id = current_setting('t.rc')::uuid;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
select 'QZ11c. the last one out ends it: ' || state || ' (expect ended)' from public.study_quizzes where id = current_setting('t.rc')::uuid;

-- ═════════ 12. Forgotten quizzes ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.old', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 30)::text, false) is not null as o \gset
reset role;
update public.study_quizzes set updated_at = now() - interval '25 minutes' where id = current_setting('t.old')::uuid;
update public.study_quiz_players set seen_at = now() - interval '25 minutes' where quiz_id = current_setting('t.old')::uuid;
set role authenticated;
select 'QZ12. the banner hides a lobby untouched for 25 minutes: ' || count(*) || ' (expect 0)' from public.study_quiz_open(:'gid');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.new', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 30)::text, false) is not null as n \gset
select 'QZ12b. a new quiz closes it: old ' || (select state from public.study_quizzes where id = current_setting('t.old')::uuid)
       || ', new ' || state || '; banner ' || (select count(*) || ' quiz, in it: ' || string_agg(array_to_string(names, ', '), '') from public.study_quiz_open(:'gid'))
       || ' (expect cancelled, lobby; 1 quiz, in it: נועה כהן)'
  from public.study_quizzes where id = current_setting('t.new')::uuid;

-- ═════════ 13. A lecture deleted mid-quiz ═════════
select public.study_quiz_next(current_setting('t.new')::uuid, -1) is null as n \gset
reset role;
select pg_temp.shift(current_setting('t.new')::uuid, 5) is null as s \gset
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-00000000000a';   -- purged (a member's delete only hides it for 30 days)
set role authenticated;
select 'QZ13. the open round lost its question: ' || coalesce(public.study_quiz_state(current_setting('t.new')::uuid) -> 'round' ->> 'q', 'null') || ' (expect null)';
select public.study_quiz_reveal(current_setting('t.new')::uuid, 0) is null as r \gset
select 'QZ13b. its reveal voids it: ' || (public.study_quiz_state(current_setting('t.new')::uuid) -> 'round' ->> 'voided') || ' (expect true)';
select public.study_quiz_next(current_setting('t.new')::uuid, 0) is null as n \gset
select 'QZ13c. no rounds with a question left, so it ends: ' || state || ' (expect ended)' from public.study_quizzes where id = current_setting('t.new')::uuid;

-- ═════════ 14. The hold on past-exam keys (questions-hold.sql) ═════════
reset role;
insert into public.study_exams (id, group_id, course, title) values ('77777777-0000-4000-8000-000000000001', :'gid', 'פתוגן מאכסן', 'מבחן 2024 מועד א');
insert into public.study_questions (id, group_id, exam_id, exam_no, source, kind, question, options, ref_lecture)
values ('77777777-0000-4000-8000-000000000002', :'gid', '77777777-0000-4000-8000-000000000001', 3, 'exam', 'mcq', 'שאלה ממבחן?', array['a', 'b', 'c', 'd'], 'eeeeeeee-0000-4000-8000-000000000009');
insert into public.study_question_keys (question_id, answer, explanations, held_until)
values ('77777777-0000-4000-8000-000000000002', 2, array['1', '2', '3', '4'], now() + interval '5 minutes');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ14. a held exam item is not handed out for explaining: ' || count(*) || ' (expect 0)'
  from public.study_exam_items_for_explain(array['77777777-0000-4000-8000-000000000002']::uuid[]);
do $$ begin perform public.study_set_exam_key('77777777-0000-4000-8000-000000000002', 0); raise notice 'QZ14b. FAIL: re-keyed during its round';
exception when others then raise notice 'QZ14b. %: no re-keying during its round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_set_explanations('77777777-0000-4000-8000-000000000002', array['1','2','3','4'], '', array[1], null, current_setting('t.key')); raise notice 'QZ14c. FAIL';
exception when others then raise notice 'QZ14c. %: no new explanations during its round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_question_keys set held_until = now() - interval '1 second' where question_id = '77777777-0000-4000-8000-000000000002';
set role authenticated;
select 'QZ14d. an expired hold lets go by itself: ' || count(*) || ' (expect 1)'
  from public.study_exam_items_for_explain(array['77777777-0000-4000-8000-000000000002']::uuid[]);

-- ═════════ 15. Realtime, anon ═════════
reset role;
select 'QZ15. published quiz tables: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_quizzes)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'study\_quiz%';
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform count(*) from public.study_quizzes; raise notice 'QZ15b. FAIL: anon read quizzes';
exception when insufficient_privilege then raise notice 'QZ15b. ok: anon cannot read quizzes (%)', sqlerrm; end $$;
do $$ begin perform public.study_quiz_state(gen_random_uuid()); raise notice 'QZ15c. FAIL: anon called the state';
exception when insufficient_privilege then raise notice 'QZ15c. ok: anon cannot call the functions (%)', sqlerrm; end $$;
reset role;
-- Clean-up for the sections after this one (they count the group's answers):
-- the quizzes and the two fixture lectures go, with their questions and answers.
reset role;
delete from public.study_quizzes where group_id = :'gid';
delete from public.study_lectures where id in ('eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-00000000000a');

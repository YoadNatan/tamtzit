-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · SECTION H: the boss battle (on section Z's engine)
--  The pulse of 20-pulse-test.sql: hot Miltefosine (4 of 4 struggle),
--  Primaquine and Quinine (4 of 5); open traps on q1 (option 2) and q5
--  (option 0, the museum's exhibit).
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
-- Moves the open round (and the quiz row's copy of its times) p_secs into the past (as Z's checks do).
create or replace function pg_temp.shift(p_quiz uuid, p_secs numeric) returns void language sql as $$
  update public.study_quiz_rounds set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                      closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where quiz_id = p_quiz and opens_at is not null and revealed_at is null;
  update public.study_quizzes set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                  closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where id = p_quiz;
$$;
-- A member's call, as that member (the claim the stub's auth.uid() reads).
create or replace function pg_temp.next(p_quiz uuid, p_user text, p_from int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-0000000000' || p_user, true);
  perform public.study_quiz_next(p_quiz, p_from);
  perform pg_temp.shift(p_quiz, 4);   -- the 3-second countdown is over
end $$;
-- "a1:2,a2:x": each player's choice for the round on screen (x = לא יודעים).
create or replace function pg_temp.play(p_quiz uuid, p_idx int, p_moves text) returns void language plpgsql as $$
declare m text;
begin
  foreach m in array string_to_array(p_moves, ',') loop
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-0000000000' || split_part(m, ':', 1), true);
    perform public.study_quiz_answer(p_quiz, p_idx, nullif(split_part(m, ':', 2), 'x')::int);
  end loop;
end $$;
create or replace function pg_temp.hud(p_quiz uuid) returns text language sql as $$
  select 'team ' || (b ->> 'team_hp') || ' · boss ' || (b ->> 'boss_hp') || ' · heads '
         || (select string_agg((h ->> 'name') || '=' || (h ->> 'hp') || case when (h ->> 'down')::boolean then '✓' else '' end
                               || case when (h ->> 'relapses')::int > 0 then '(r' || (h ->> 'relapses') || ')' else '' end, ' ')
               from jsonb_array_elements(b -> 'heads') h)
    from public.study_quiz__boss_state(p_quiz) b $$;

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
-- ═════════ 1. Opening a battle ═════════
reset role;
update study_private.features set enabled = false where name = 'pulse';
set role authenticated;
do $$ begin perform public.study_boss_create(current_setting('t.gid')::uuid, array['f0000000-0000-4000-8000-000000000001']::uuid[]);
  raise notice 'H1. FAIL: a battle while the pulse is off';
exception when others then raise notice 'H1. %: the boss is built from the counts (%)', case when sqlerrm = 'off' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update study_private.features set enabled = true where name = 'pulse';
set role authenticated;
do $$ begin perform public.study_boss_create(current_setting('t.gid')::uuid, array['f0000000-0000-4000-8000-000000000002']::uuid[]);
  raise notice 'H1a. FAIL: a battle with no hot topic';
exception when others then raise notice 'H1a. %: at least two heads (%)', case when sqlerrm = 'no heads' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('H1b', (select (b -> 'heads')::text || ' · revenge ' || coalesce(b ->> 'revenge', 'none') from public.study_boss_open(:'gid') b),
       '["Miltefosine", "Primaquine", "Quinine"] · revenge none');
-- review SEC-8: the heads are hot topics; Noa's laptop (never saved) is not counted, so it reads none
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000b2';
select funtest.expect('H1e', (select (b -> 'heads')::text from public.study_boss_open(:'gid') b), '[]');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.bq', public.study_boss_create(:'gid', array['f0000000-0000-4000-8000-000000000001']::uuid[], 45)::text, false) is not null as bq \gset
select funtest.expect('H1c', (select mode || ' · ' || title || ' · ' || n_wanted || ' rounds planned' from public.study_quizzes where id = current_setting('t.bq')::uuid),
       'boss · קרב הבוס · ההידרה של Anti parasite · 4 rounds planned');
select funtest.expect('H1d', (select string_agg((h ->> 'name') || ' ' || (h ->> 'max') || ' HP, ' || jsonb_array_length(h -> 'qs') || 'q'
                                                || coalesce(', trap q' || right(h ->> 'trap_q', 1) || '/' || (h ->> 'trap_opt'), ''), ' · ' order by o)
                                from public.study_boss_battles b, jsonb_array_elements(b.heads) with ordinality as x(h, o)
                               where b.quiz_id = current_setting('t.bq')::uuid),
       'Miltefosine 34 HP, 1q · Primaquine 33 HP, 2q, trap q1/2 · Quinine 33 HP, 1q, trap q5/0');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_quiz_join(current_setting('t.bq')::uuid) is null as j \gset
do $$ begin perform public.study_quiz_next(current_setting('t.bq')::uuid, -1); raise notice 'H2. FAIL: Noa started Shoham''s battle';
exception when others then raise notice 'H2. %: (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
do $$ begin perform public.study_quiz_next(current_setting('t.bq')::uuid, -1); raise notice 'H2a. FAIL: a battle of two';
exception when others then raise notice 'H2a. %: below three players every hit would tell who missed (%)', case when sqlerrm = 'need 3' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select public.study_quiz_join(current_setting('t.bq')::uuid) is null as j \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select public.study_quiz_join(current_setting('t.bq')::uuid) is null as j \gset
reset role;

-- ═════════ 2. The battle: hits, the team's losses, relapses, the trap ═════════
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', -1);
select funtest.expect('H3', (select string_agg(right(question_id::text, 1), ',' order by idx) from public.study_quiz_rounds where quiz_id = current_setting('t.bq')::uuid),
       '3,1,2,5');
select pg_temp.play(current_setting('t.bq')::uuid, 0, 'a1:2,a2:2,a3:2,a4:0');
select funtest.expect('H3a', pg_temp.hud(current_setting('t.bq')::uuid), 'team 90 · boss 85 · heads Miltefosine=19(r1) Primaquine=33 Quinine=33');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 0);
select pg_temp.play(current_setting('t.bq')::uuid, 1, 'a1:1,a2:1,a3:1,a4:1');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 1);
select pg_temp.play(current_setting('t.bq')::uuid, 2, 'a1:0,a2:1,a3:1,a4:0');
select funtest.expect('H3b', pg_temp.hud(current_setting('t.bq')::uuid), 'team 71 · boss 66 · heads Miltefosine=19(r1) Primaquine=14(r1) Quinine=33');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 2);
select pg_temp.play(current_setting('t.bq')::uuid, 3, 'a1:0,a2:0,a3:3,a4:3');
select funtest.expect('H3c', pg_temp.hud(current_setting('t.bq')::uuid), 'team 51 · boss 62 · heads Miltefosine=19(r1) Primaquine=14(r1) Quinine=29(r1)');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select funtest.expect('H3d', (select (s -> 'boss' ->> 'team_hp') || ' · ' || (s -> 'boss' ->> 'boss_hp') || ' · head ' || (s -> 'boss' ->> 'head')
                                     || ' · trap ' || (s -> 'boss' ->> 'trap') || ' · counts ' || (s -> 'round' -> 'counts')::text
                                from public.study_quiz_state(current_setting('t.bq')::uuid) s),
       '51 · 62 · head 2 · trap true · counts [2, 0, 0, 2, 0]');
reset role;
select funtest.expect('H3e', (select z.n_total || ' rounds now; relapse rounds ' || string_agg(right(r.question_id::text, 1), ',' order by r.idx) filter (where r.idx >= 4)
                                from public.study_quiz_rounds r join public.study_quizzes z on z.id = r.quiz_id
                               where r.quiz_id = current_setting('t.bq')::uuid group by z.n_total),
       '7 rounds now; relapse rounds 3,1,5');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 3);
select pg_temp.play(current_setting('t.bq')::uuid, 4, 'a1:2,a2:2,a3:2,a4:2');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 4);
select pg_temp.play(current_setting('t.bq')::uuid, 5, 'a1:1,a2:1,a3:1,a4:1');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 5);
select pg_temp.play(current_setting('t.bq')::uuid, 6, 'a1:3,a2:3,a3:3,a4:1');
select funtest.expect('H4', pg_temp.hud(current_setting('t.bq')::uuid) || ' · ' || (select outcome from public.study_boss_battles where quiz_id = current_setting('t.bq')::uuid),
       'team 41 · boss 0 · heads Miltefosine=0✓(r1) Primaquine=0✓(r1) Quinine=0✓(r1) · won');
select funtest.expect('H4a', (select string_agg((m ->> 't') || coalesce(':' || (m ->> 'head'), '') || coalesce(' ' || (m ->> 'hp'), ''), ', ' order by o)
                                from public.study_boss_battles b, jsonb_array_elements(b.log) with ordinality as x(m, o)
                               where b.quiz_id = current_setting('t.bq')::uuid),
       'relapse:Miltefosine, relapse:Primaquine, trap:Quinine -20, relapse:Quinine, down:Miltefosine, down:Primaquine, down:Quinine, last:Quinine');
select pg_temp.next(current_setting('t.bq')::uuid, 'a1', 6);
select funtest.expect('H4b', (select state from public.study_quizzes where id = current_setting('t.bq')::uuid), 'ended');
-- Each answer also landed in its owner's private practice (mode 'quiz'), as any quiz answer does.
select funtest.expect('H4c', (select count(*)::text from public.study_answers where mode = 'quiz' and answered_at > now() - interval '1 hour'), '28');

-- ═════════ 3. The loot: private, three study days ═════════
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select funtest.expect('H5', (select string_agg('q' || right(question_id::text, 1) || ' ' || topic || ' +' || (due_on - ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date), ', ' order by due_on)
                               from public.study_boss_loot(current_setting('t.bq')::uuid)),
       'q2 Primaquine +1, q5 Quinine +2');
select funtest.expect('H5a', public.study_boss_loot_save(current_setting('t.bq')::uuid)::text || ' saved, ' || (select count(*) from public.study_my_loot(:'gid')) || ' due today',
       '2 saved, 0 due today');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select funtest.expect('H5b', 'Maya sees ' || (select count(*) from public.study_loot) || ' loot rows', 'Maya sees 0 loot rows');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a9';
select funtest.expect('H5c', 'outsider sees ' || (select count(*) from public.study_boss_battles) || ' battles', 'outsider sees 0 battles');

-- ═════════ 4. A lost battle: a round of two counts for nothing, the team falls, "סבב נקמה" the next study day ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.bq2', public.study_boss_create(:'gid', array['f0000000-0000-4000-8000-000000000001']::uuid[], 45)::text, false) is not null as bq2 \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_quiz_join(current_setting('t.bq2')::uuid) is null as j \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select public.study_quiz_join(current_setting('t.bq2')::uuid) is null as j \gset
reset role;
select pg_temp.next(current_setting('t.bq2')::uuid, 'a1', -1);
select pg_temp.play(current_setting('t.bq2')::uuid, 0, 'a1:0,a2:0');
select pg_temp.shift(current_setting('t.bq2')::uuid, 60);
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select public.study_quiz_reveal(current_setting('t.bq2')::uuid, 0) is null as rv \gset
reset role;
select funtest.expect('H6', pg_temp.hud(current_setting('t.bq2')::uuid) || ' · few ' || (select b.rounds -> 0 ->> 'few' from public.study_boss_battles b where b.quiz_id = current_setting('t.bq2')::uuid),
       'team 100 · boss 100 · heads Miltefosine=34 Primaquine=33 Quinine=33 · few true');
select pg_temp.next(current_setting('t.bq2')::uuid, 'a1', 0);
select pg_temp.play(current_setting('t.bq2')::uuid, 1, 'a1:2,a2:2,a3:2');
select pg_temp.next(current_setting('t.bq2')::uuid, 'a1', 1);
select pg_temp.play(current_setting('t.bq2')::uuid, 2, 'a1:1,a2:1,a3:1');
select pg_temp.next(current_setting('t.bq2')::uuid, 'a1', 2);
select pg_temp.play(current_setting('t.bq2')::uuid, 3, 'a1:1,a2:1,a3:1');
select funtest.expect('H6a', (select outcome || ' · team ' || team_hp || ' · ' || (select string_agg(m ->> 't', ',' order by o) from jsonb_array_elements(log) with ordinality as x(m, o))
                                from public.study_boss_battles where quiz_id = current_setting('t.bq2')::uuid),
       'lost · team 0 · trap,relapse,fall');
select funtest.expect('H6b', (select count(*)::text from public.study_quiz_rounds where quiz_id = current_setting('t.bq2')::uuid and question_id is not null and opens_at is null),
       '0');
select pg_temp.next(current_setting('t.bq2')::uuid, 'a1', 3);
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.lost', (select id::text from public.study_boss_battles where quiz_id = current_setting('t.bq2')::uuid), false) is not null as l \gset
select funtest.expect('H7', (select (b -> 'revenge' ->> 'open') || ' · ' || (b -> 'revenge' -> 'heads')::text from public.study_boss_open(:'gid') b),
       'false · ["Miltefosine", "Primaquine", "Quinine"]');
do $$ begin perform public.study_boss_create(current_setting('t.gid')::uuid, null, 45, current_setting('t.lost')::uuid);
  raise notice 'H7a. FAIL: a revenge round the same study day';
exception when others then raise notice 'H7a. %: the next study day (%)', case when sqlerrm = 'revenge not yet' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_boss_battles set ended_at = ended_at - interval '1 day' where id = current_setting('t.lost')::uuid;   -- a day passes
set role authenticated;
select set_config('t.bq3', public.study_boss_create(:'gid', null, 45, current_setting('t.lost')::uuid)::text, false) is not null as bq3 \gset
reset role;
select funtest.expect('H7b', (select (revenge_of = current_setting('t.lost')::uuid)::text || ' · ' || pg_temp.hud(quiz_id) from public.study_boss_battles where quiz_id = current_setting('t.bq3')::uuid),
       'true · team 100 · boss 100 · heads Miltefosine=34 Primaquine=33 Quinine=33');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select public.study_quiz_end(current_setting('t.bq3')::uuid) is null as e \gset
reset role;

-- ════════════════════════════════════════════════════════════════════════
--  SECTION P checks · progress, plan, marathons, the merge across every feature   (package A)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for block B (me.sql) and for the merge across
-- every feature (design-me.md §6.1). Appended to supabase/tests/study.sql: it
-- runs in the same psql session, after the existing checks, and reuses
-- their users (Shoham bbbb…, Noa cccc…, a stranger dddd…) and :gid.
-- Times are fixed (T = 2026-11-15 10:00 UTC = 12:00 in Israel) so the
-- weights are exact. Every ME line reads "ok" or the expected value.
\set ON_ERROR_STOP 1
\pset tuples_only on
\set A '''eeeeeeee-0000-4000-8000-0000000000a1'''
\set B '''eeeeeeee-0000-4000-8000-0000000000a2'''
\set C '''eeeeeeee-0000-4000-8000-0000000000a3'''
\set T '''2026-11-15 10:00:00+00'''
reset role;
-- Three lectures: two in one course, one in another.
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by, created_at) values
 (:A, :'gid', 'פתוגן מאכסן', 'Antimalarials', 'pptx', '[{"n":1},{"n":2},{"n":3},{"n":4},{"n":5},{"n":6},{"n":7},{"n":8},{"n":9},{"n":10},{"n":11},{"n":12}]', 'bbbbbbbb-0000-4000-8000-000000000002', '2026-09-01'),
 (:B, :'gid', 'פתוגן מאכסן', 'Anthelmintics', 'pptx', '[{"n":1},{"n":2},{"n":3},{"n":4}]', 'bbbbbbbb-0000-4000-8000-000000000002', '2026-09-02'),
 (:C, :'gid', 'המטולוגיה', 'Anemia', 'pdf', '[{"n":1},{"n":2}]', 'cccccccc-0000-4000-8000-000000000003', '2026-09-03');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, markdown, status) values
 (:A, 0, 'מלריה: מחזור החיים', 1, 4, repeat('א', 3000), 'ready'),
 (:A, 1, 'Primaquine', 5, 8, repeat('ב', 4500), 'ready'),
 (:A, 2, 'Artemisinins', 9, 12, '', 'pending'),
 (:B, 0, 'Benzimidazoles', 1, 4, repeat('ג', 2000), 'ready'),
 (:C, 0, 'אנמיה', 1, 2, repeat('ד', 1500), 'ready');
-- Practice questions (the questions block's tables), made directly with fixed dates.
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, question, options, slides, topic, aspect, created_at, retired_at) values
 ('f0000000-0000-4000-8000-000000000001', :'gid', :A, 'ai', 1, 'mcq',  'מה אסור עם Primaquine?',  '{a,b,c,d,e}', '{20,21}', 'Primaquine',  'contra',    '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000002', :'gid', :A, 'ai', 1, 'mcq',  'למי אסור Primaquine?',    '{a,b,c,d,e}', '{21}',    'primaquine ', 'contra',    '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000003', :'gid', :A, 'ai', 1, 'case', 'מקרה: איזו תרופה תינתן?', '{a,b,c,d,e}', '{22}',    'Primaquine',  'uses',      '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000004', :'gid', :A, 'ai', 0, 'mcq',  'איך Chloroquine פועלת?',  '{a,b,c,d,e}', '{5}',     'Chloroquine', 'mechanism', '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000005', :'gid', :A, 'ai', 0, 'mcq',  'מה מעכבת Chloroquine?',   '{a,b,c,d,e}', '{6}',     'Chloroquine', 'mechanism', '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000006', :'gid', :A, 'ai', 0, 'mcq',  'שאלה בלי נושא בכלל?',     '{a,b,c,d,e}', '{7}',     '',            'other',     '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000007', :'gid', :B, 'ai', 0, 'mcq',  'איך Albendazole פועלת?',  '{a,b,c,d,e}', '{3}',     'Albendazole', 'mechanism', '2026-09-01', null),
 ('f0000000-0000-4000-8000-000000000008', :'gid', :A, 'ai', 1, 'mcq',  'שאלה שהוצאה מהתרגול?',    '{a,b,c,d,e}', '{20}',    'Primaquine',  'contra',    '2026-09-01', '2026-11-01');
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select id, 0, '{1,2,3,4,5}', 'לזכור' from public.study_questions where id::text like 'f0000000%';
-- Shoham's answers (practice and one from a group quiz), and one of Noa's.
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at) values
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 1, false, 'lecture',  '2026-11-14 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 0, true,  'mistakes', '2026-11-14 10:05:00+00'),  -- right after the explanation: same day, not evidence
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 2, false, 'lecture',  '2026-11-13 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003', 0, true,  'quiz',     '2026-11-13 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004', 0, true,  'lecture',  '2026-10-16 10:00:00+00'),  -- 30 days before T
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004', 0, true,  'course',   '2026-11-14 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000005', null, false, 'lecture', '2026-09-16 10:00:00+00'), -- 60 days, "לא יודעים"
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000006', 3, false, 'lecture',  '2026-11-14 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000008', 3, false, 'lecture',  '2026-11-14 10:00:00+00'),  -- retired: never counts
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000007', 0, true,  'lecture',  '2026-11-14 10:00:00+00'),
 ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000007', 0, true,  'lecture',  '2026-11-15 01:30:00+00'),  -- 03:30 in Israel: still the 14th's study day
 ('cccccccc-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 2, false, 'lecture',  '2026-11-14 10:00:00+00');
insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds) values
 ('bbbbbbbb-0000-4000-8000-000000000002', :A, 0, '2026-11-13 18:00:00+00', 600),
 ('bbbbbbbb-0000-4000-8000-000000000002', :A, 1, '2026-11-14 18:00:00+00', 900);

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
-- ── progress per lecture ──
select 'ME1. Shoham, Antimalarials at T: questions ' || questions || ', cases ' || cases || ', answered ' || answered
       || ', right now ' || correct_now || ', first try ' || first_try || ', wrong now ' || wrong_now || ', answers ' || answers
       || ' (expect 6, 1, 6, 3, 2, 3, 8)'
  from public.study_my_lectures(:'gid', :T) where lecture_id = :A;
select 'ME2. Anthelmintics: answered ' || answered || ', right now ' || correct_now || ', answers ' || answers || ' (expect 1, 1, 2)'
  from public.study_my_lectures(:'gid', :T) where lecture_id = :B;
select 'ME3. as of 2026-11-13 22:00 UTC: answered ' || answered || ', answers ' || answers || ' (expect 4, 4: later answers are not counted yet)'
  from public.study_my_lectures(:'gid', '2026-11-13 22:00:00+00') where lecture_id = :A;
select 'ME4. parts ' || jsonb_array_length(parts) || ', done ' || parts_done::text || ', seconds ' || part_seconds::text
       || ', part 1 chars ' || (parts -> 1 ->> 'chars') || ', part 2 ready ' || (parts -> 2 ->> 'ready')
       || ' (expect 3, {0,1}, {"0": 600, "1": 900}, 4500, false)'
  from public.study_my_lectures(:'gid', :T) where lecture_id = :A;
select 'ME5. parts done as of 2026-11-14 00:00 UTC: ' || parts_done::text || ' (expect {0})'
  from public.study_my_lectures(:'gid', '2026-11-14 00:00:00+00') where lecture_id = :A;
select 'ME6. lectures listed at T: ' || count(*) filter (where lecture_id in (:A, :B, :C)) || ' of these three (expect 3)' from public.study_my_lectures(:'gid', :T);
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ME7. Noa sees her own numbers only: answered ' || answered || ', wrong now ' || wrong_now || ', parts done ' || parts_done::text || ' (expect 1, 1, {})'
  from public.study_my_lectures(:'gid', :T) where lecture_id = :A;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'ME8. the stranger gets ' || count(*) || ' rows (expect 0)' from public.study_my_lectures(:'gid', :T);

-- ── weak points ──
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'ME9. ' || string_agg(topic_key || ' ' || score || ' ' || status, ' · ' order by score) || ' (expect primaquine 0.483 weak · chloroquine 0.788 ok · albendazole 0.798 ok)'
  from public.study_my_weak_points(:'gid', :T);
select 'ME10. primaquine: items ' || items || ', weight ' || weight || ', wrong now ' || wrong_now || ', worst ' || worst_aspect
       || ', aspects ' || (select string_agg((x ->> 'aspect') || '=' || (x ->> 'score'), ',') from jsonb_array_elements(aspects) x)
       || ', slides ' || (select string_agg((x ->> 'n') || '×' || (x ->> 'c'), ',') from jsonb_array_elements(slides) x)
       || ' (expect 3, 2.84, 1, contra, contra=0.359,uses=0.796, 21×2,20×1)'
  from public.study_my_weak_points(:'gid', :T) where topic_key = 'primaquine';
select 'ME11. the retired question and the one without a topic count nowhere: ' || count(*) || ' topics (expect 3)'
  from public.study_my_weak_points(:'gid', :T);
select 'ME12. a month later the same answers are older: primaquine ' || score || ' ' || status || ' (expect 0.572 watch: old wrong answers fade toward "unknown")'
  from public.study_my_weak_points(:'gid', '2026-12-15 10:00:00+00') where topic_key = 'primaquine';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ME13. Noa, one wrong answer: ' || string_agg(topic_key || ' ' || items || ' ' || status, ', ') || ' (expect primaquine 1 ok: one question is not a pattern)'
  from public.study_my_weak_points(:'gid', :T);

-- ── activity days (Israel time, the day starts at 04:00) ──
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'ME14. ' || string_agg(day || ': ' || answers || '/' || correct || ' answers, ' || parts_read || ' parts, ' || read_seconds || ' s', ' · ' order by day)
       || ' (expect 2026-11-13: 2/1 answers, 1 parts, 600 s · 2026-11-14: 7/4 answers, 1 parts, 900 s)'
  from public.study_my_days(:'gid', 7, :T);

-- ── reading progress through the functions ──
select public.study_note_reading(:A, 2, 5, true, 120);
select 'ME15. after reading part 2: ' || parts_done::text || ' (expect {0,1,2})' from public.study_my_lectures(:'gid') where lecture_id = :A;
select public.study_note_reading(:A, 1, 7, false, 0);
select 'ME16. place: part ' || part_idx || ', anchor ' || anchor || ' (expect 1, 7: the newest place)' from public.study_read_places where lecture_id = :A;
do $$ begin perform public.study_note_reading('eeeeeeee-0000-4000-8000-0000000000a1', 9, 0, true); raise notice 'ME17. FAIL: a part that does not exist';
exception when others then raise notice 'ME17. %: an unknown part is refused (%)', case when sqlerrm = 'bad part' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'ME18a. marked by hand: ' || public.study_mark_parts(:B, '{0,7}', true) || ' row (expect 1: part 7 does not exist)';
select 'ME18b. unmarked: ' || public.study_mark_parts(:B, '{0}', false) || ' row (expect 1)';
do $$ begin insert into public.study_read_parts (lecture_id, part_idx) values ('eeeeeeee-0000-4000-8000-0000000000a2', 0); raise notice 'ME19. FAIL: a direct write';
exception when insufficient_privilege then raise notice 'ME19. ok: parts are written only through the functions (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ME20. Noa sees ' || (select count(*) from public.study_read_parts) || ' parts and ' || (select count(*) from public.study_read_places) || ' places (expect 0, 0: Shoham''s are hers)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_note_reading('eeeeeeee-0000-4000-8000-0000000000a1', 0, 0, true); raise notice 'ME21. FAIL: the stranger saved a place';
exception when others then raise notice 'ME21. %: a stranger is refused (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ── the plan ──
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.today', (((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date)::text, false) is not null as today \gset
select set_config('t.p1', public.study_plan_save(null, :'gid', 'מבחן פתוגן מאכסן', current_setting('t.today')::date + 20,
  '{פתוגן מאכסן}', array[:C]::uuid[], array[:B]::uuid[], 120, '{5,6}', true)::text, false) is not null as p1 \gset
select 'ME22. plan: ' || title || ', ' || exam_date - current_setting('t.today')::date || ' days, courses ' || courses::text || ', off ' || days_off::text || ', ' || status
       || ' · lectures ' || (select string_agg(right(lecture_id::text, 2) || '=' || included, ',' order by lecture_id) from public.study_plan_lectures where plan_id = p.id)
       || ' (expect 20 days, {פתוגן מאכסן}, {5,6}, active · a2=false,a3=true)'
  from public.study_plans p where id = current_setting('t.p1')::uuid;
select set_config('t.p2', public.study_plan_save(null, :'gid', 'מבחן שני', current_setting('t.today')::date + 30,
  '{}', array[:A]::uuid[], '{}', 90, '{}', false)::text, false) is not null as p2 \gset
select 'ME23. a new plan archives the old one: ' || string_agg(title || '=' || status, ', ' order by created_at) || ' (expect מבחן פתוגן מאכסן=archived, מבחן שני=active)' from public.study_plans;
select set_config('t.p2b', public.study_plan_save(current_setting('t.p2')::uuid, :'gid', 'מבחן שני', current_setting('t.today')::date + 31,
  '{המטולוגיה}', '{}', '{}', 150, '{6}', true)::text, false) is not null as p2b \gset
select 'ME24. editing keeps the id: ' || (id::text = current_setting('t.p2b')) || ', replanned ' || (replanned_at is not null)
  || ', courses ' || courses::text || ', lectures now ' || (select count(*) from public.study_plan_lectures where plan_id = p.id) || ' (expect true, true, {המטולוגיה}, 0)'
  from public.study_plans p where id = current_setting('t.p2')::uuid;
do $$
declare cases text[][] := array[
  array['today', 'bad date'], array['days', 'bad days'], array['lecture', 'lecture not found'], array['title', 'bad title'], array['minutes', 'bad minutes']];
  i int; d date := current_setting('t.today')::date;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_plan_save(null, (select id from public.study_groups limit 1),
        case when cases[i][1] = 'title' then ' ' else 'x' end,
        case when cases[i][1] = 'today' then d else d + 10 end, '{}',
        case when cases[i][1] = 'lecture' then array['99999999-0000-4000-8000-000000000009'::uuid] else '{}'::uuid[] end, '{}',
        case when cases[i][1] = 'minutes' then 5 else 60 end,
        case when cases[i][1] = 'days' then '{7}'::int[] else '{}'::int[] end, true);
      raise notice 'ME25.% FAIL: % accepted', i, cases[i][1];
    exception when others then
      raise notice 'ME25.% %: % refused (%)', i, case when sqlerrm = cases[i][2] then 'ok' else 'FAIL' end, cases[i][1], sqlerrm;
    end;
  end loop;
end $$;
insert into public.study_plan_checks (plan_id, day, task_key) values (current_setting('t.p2')::uuid, current_setting('t.today')::date, 'read:eeeeeeee-0000-4000-8000-0000000000a1:0-1');
select 'ME26. a ticked task: ' || count(*) || ' (expect 1)' from public.study_plan_checks;
do $$ begin insert into public.study_plans (group_id, title, exam_date) values ((select id from public.study_groups limit 1), 'x', current_date + 9); raise notice 'ME27. FAIL: a direct plan insert';
exception when insufficient_privilege then raise notice 'ME27. ok: plans are saved only through study_plan_save (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ME28. Noa sees ' || (select count(*) from public.study_plans) || ' plans, ' || (select count(*) from public.study_plan_lectures) || ' plan lectures, ' || (select count(*) from public.study_plan_checks) || ' checks (expect 0, 0, 0)';
do $$ begin insert into public.study_plan_checks (plan_id, day, task_key) values (current_setting('t.p2')::uuid, current_date, 'cards'); raise notice 'ME29. FAIL: Noa ticked Shoham''s plan';
exception when others then raise notice 'ME29. ok: a check goes only on one''s own plan (%)', sqlerrm; end $$;
do $$ begin perform public.study_plan_replan(current_setting('t.p2')::uuid); raise notice 'ME30. FAIL: Noa replanned Shoham''s plan';
exception when others then raise notice 'ME30. %: (%)', case when sqlerrm = 'plan not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
delete from public.study_plan_checks where task_key like 'read:%';
select 'ME31. unticked: ' || count(*) || ' checks left (expect 0)' from public.study_plan_checks;
select public.study_plan_end(current_setting('t.p2')::uuid);
select 'ME32. ended: ' || status || ' (expect archived)' from public.study_plans where id = current_setting('t.p2')::uuid;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_plan_save(null, (select g.id from public.study_groups g limit 1), 'x', current_date + 9, '{}', '{}', '{}', 60, '{}', true); raise notice 'ME33. FAIL: a stranger saved a plan';
exception when others then raise notice 'ME33. ok: a stranger cannot make a plan in the group (%)', sqlerrm; end $$;

-- ── marathons ──
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.agenda', jsonb_build_array(
  jsonb_build_object('k', 'intro', 'min', 5),
  jsonb_build_object('k', 'read', 'l', :A, 'from', 0, 'to', 1, 'min', 40),
  jsonb_build_object('k', 'quiz', 'l', :A, 'n', 5, 'mode', 'coop', 'min', 10),
  jsonb_build_object('k', 'break', 'min', 10),
  jsonb_build_object('k', 'wrap', 'min', 5))::text, false) is not null as agenda \gset
select set_config('t.m1', (select id::text from public.study_marathon_save(null, null, :'gid', 'מרתון לפני המבחן', now() + interval '2 days', 240,
  'ספרייה, קומה 2', '', array[:A, :B, :A]::uuid[], current_setting('t.agenda')::jsonb)), false) is not null as m1 \gset
select 'ME34. Noa opened a marathon: version ' || version || ', lectures ' || cardinality(lecture_ids) || ', state ' || state || ', step ' || step
       || ', Noa is ' || (select answer from public.study_marathon_people where marathon_id = m.id) || ' (expect 1, 2, planned, -1, in)'
  from public.study_marathons m where id = current_setting('t.m1')::uuid;
do $$
declare
  a text := 'eeeeeeee-0000-4000-8000-0000000000a1';
  c text := 'eeeeeeee-0000-4000-8000-0000000000a3';
  cases text[][] := array[
    array['[{"k":"read","l":"' || c || '","min":30}]', 'a lecture that is not in the marathon'],
    array['[{"k":"intro","min":0}]', 'zero minutes'],
    array['[{"k":"intro","min":5,"color":"red"}]', 'an unknown field'],
    array['[{"k":"dance","min":5}]', 'an unknown step'],
    array['[{"k":"read","min":30}]', 'reading without a lecture'],
    array['[{"k":"quiz","l":"' || a || '","n":2,"min":5}]', 'a quiz of two'],
    array['[{"k":"read","l":"' || a || '","from":3,"to":1,"min":5}]', 'parts backwards'],
    array[(select jsonb_agg(jsonb_build_object('k', 'break', 'min', 5))::text from generate_series(1, 41)), 'forty-one steps']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_marathon_save(null, null, (select id from public.study_groups limit 1), 'x', now() + interval '1 day', 120, '', '',
        array[a::uuid, 'eeeeeeee-0000-4000-8000-0000000000a2'::uuid], cases[i][1]::jsonb);
      raise notice 'ME35.% FAIL: % accepted', i, cases[i][2];
    exception when others then
      raise notice 'ME35.% %: % refused (%)', i, case when sqlerrm = 'bad agenda' then 'ok' else 'FAIL' end, cases[i][2], sqlerrm;
    end;
  end loop;
end $$;
do $$ begin perform public.study_marathon_save(null, null, (select id from public.study_groups limit 1), 'x', now() - interval '2 hours', 120, '', '', '{}', '[]'); raise notice 'ME36. FAIL: a marathon in the past';
exception when others then raise notice 'ME36. %: a start in the past is refused (%)', case when sqlerrm = 'bad time' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_marathon_answer(current_setting('t.m1')::uuid, 'maybe');
select public.study_marathon_answer(current_setting('t.m1')::uuid, 'in');
select 'ME37. Shoham sees the marathon and who is in: ' || (select count(*) from public.study_marathons) || ' marathon, '
       || (select string_agg(answer, ',' order by answer) from public.study_marathon_people) || ' (expect 1, in,in: one answer each)';
select 'ME38. Shoham edits: version ' || version || ' (expect 2)'
  from public.study_marathon_save(current_setting('t.m1')::uuid, 1, :'gid', 'מרתון לפני המבחן', now() + interval '2 days', 270,
       'ספרייה, קומה 2', 'מביאים קפה', array[:A, :B]::uuid[], current_setting('t.agenda')::jsonb);
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_marathon_save(current_setting('t.m1')::uuid, 1, (select id from public.study_groups limit 1), 'שם אחר', now() + interval '2 days', 240, '', '', '{}', '[]'); raise notice 'ME39. FAIL: a stale edit overwrote Shoham''s';
exception when others then raise notice 'ME39. %: an edit made on an old version is refused (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin update public.study_marathons set title = 'x'; raise notice 'ME40. FAIL: a direct update';
exception when insufficient_privilege then raise notice 'ME40. ok: marathons change only through the functions (%)', sqlerrm; end $$;
-- The run-of-show: two phones tap "start" at once; then next, back, and the end.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'ME41. Shoham starts: step ' || public.study_marathon_step(current_setting('t.m1')::uuid, -1, 0) || ' (expect 0)';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ME42. Noa''s "start" a moment later: step ' || public.study_marathon_step(current_setting('t.m1')::uuid, -1, 0)
       || ', version ' || (select version from public.study_marathons where id = current_setting('t.m1')::uuid)
       || ', state ' || (select state from public.study_marathons where id = current_setting('t.m1')::uuid) || ' (expect 0, 3, live: moved once)';
select 'ME43a. next: ' || public.study_marathon_step(current_setting('t.m1')::uuid, 0, 1) || ' (expect 1)';
select 'ME43b. back: ' || public.study_marathon_step(current_setting('t.m1')::uuid, 1, 0) || ' (expect 0)';
select 'ME43c. jump: ' || public.study_marathon_step(current_setting('t.m1')::uuid, 0, 3) || ' (expect 3)';
do $$ begin perform public.study_marathon_step(current_setting('t.m1')::uuid, 3, 9); raise notice 'ME44. FAIL: a step past the end';
exception when others then raise notice 'ME44. %: (%)', case when sqlerrm = 'bad step' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'ME45a. the last step ends it: ' || public.study_marathon_step(current_setting('t.m1')::uuid, 3, 5) || ' (expect 5)';
select 'ME45b. ' || state || ', ended at set ' || (ended_at is not null) || ', step left at ' || step || ' (expect ended, true, 3)'
  from public.study_marathons where id = current_setting('t.m1')::uuid;
do $$ begin perform public.study_marathon_answer(current_setting('t.m1')::uuid, 'out'); raise notice 'ME46. FAIL: an answer after the end';
exception when others then raise notice 'ME46. %: (%)', case when sqlerrm = 'marathon over' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.m2', (select id::text from public.study_marathon_save(null, null, :'gid', 'מרתון המטולוגיה', now() + interval '9 days', 180,
  '', '', array[:C]::uuid[], jsonb_build_array(jsonb_build_object('k', 'read', 'l', :C, 'min', 30)))), false) is not null as m2 \gset
select public.study_marathon_cancel(current_setting('t.m2')::uuid, true);
do $$ begin perform public.study_marathon_answer(current_setting('t.m2')::uuid, 'in'); raise notice 'ME47. FAIL: an answer to a cancelled marathon';
exception when others then raise notice 'ME47. %: (%)', case when sqlerrm = 'marathon over' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_marathon_cancel(current_setting('t.m2')::uuid, false);
select 'ME48. cancelled and brought back: ' || state || ', version ' || version || ' (expect planned, 3)' from public.study_marathons where id = current_setting('t.m2')::uuid;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'ME49. the stranger sees ' || (select count(*) from public.study_marathons) || ' marathons and ' || (select count(*) from public.study_marathon_people) || ' answers (expect 0, 0)';
do $$ begin perform public.study_marathon_step(current_setting('t.m2')::uuid, -1, 0); raise notice 'ME50. FAIL: a stranger moved the run-of-show';
exception when others then raise notice 'ME50. %: (%)', case when sqlerrm = 'marathon not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'ME51. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_marathon_people, study_marathons; no private table)'
  from pg_publication_tables where pubname = 'supabase_realtime'
   and tablename in ('study_marathons', 'study_marathon_people', 'study_read_parts', 'study_read_places', 'study_plans', 'study_plan_lectures', 'study_plan_checks', 'study_answers');

-- ── one person across two devices: the merge, with every feature's rows ──
-- Shoham's laptop joined anonymously (names are unique in a group, so as "שוהם (מחשב)") and studied there.
insert into auth.users (id, raw_user_meta_data, is_anonymous) values ('ffffffff-0000-4000-8000-0000000000aa', '{"app":"study","full_name":"שוהם"}', true);
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-0000000000aa';
set request.jwt.claims = '{"sub":"ffffffff-0000-4000-8000-0000000000aa","is_anonymous":true}';
select 'ME52. the laptop joined ' || name from public.study_join(:'code', 'שוהם (מחשב)');
select public.study_note_reading(:A, 0, 3, true, 300);
select public.study_marathon_answer(current_setting('t.m2')::uuid, 'out');
select set_config('t.pl', public.study_plan_save(null, :'gid', 'מבחן מהלפטופ', current_setting('t.today')::date + 15, '{}', '{}', '{}', 60, '{}', true)::text, false) is not null as pl \gset
reset role;
update public.study_read_parts set done_at = '2026-11-12 18:00:00+00' where user_id = 'ffffffff-0000-4000-8000-0000000000aa';
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
values ('ffffffff-0000-4000-8000-0000000000aa', 'f0000000-0000-4000-8000-000000000005', 0, true, 'lecture', now());
-- A flashcard both devices studied, and a quiz both played (the merge rules of design-cards and design-quiz).
insert into public.study_cards (id, group_id, lecture_id, kind, front, back, topic, aspect)
values ('c0000000-0000-4000-8000-000000000001', :'gid', :A, 'qa', 'איך Primaquine פוגעת ב-hypnozoites?', 'במנגנון חמצוני', 'Primaquine', 'mechanism');
insert into public.study_card_states (user_id, card_id, state, stability, difficulty, due, last_review, reps) values
 ('bbbbbbbb-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 2, 5, 5, now() + interval '3 days', now() - interval '4 days', 3),
 ('ffffffff-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000001', 2, 9, 4, now() + interval '8 days', now() - interval '1 day', 4);
insert into public.study_quizzes (id, group_id, mode, title, lecture_ids, n_wanted, seconds, state)
values ('a0000000-0000-4000-8000-000000000001', :'gid', 'coop', 'Antimalarials', array[:A]::uuid[], 5, 60, 'ended');
insert into public.study_quiz_players (quiz_id, user_id) values
 ('a0000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'),
 ('a0000000-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-0000000000aa');
-- Shoham has an active plan too (the laptop's will go to the archive), and her
-- answer to the second marathon is older than the laptop's.
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","is_anonymous":false}';
select set_config('t.p3', public.study_plan_save(null, :'gid', 'מבחן פתוגן מאכסן', current_setting('t.today')::date + 20, '{פתוגן מאכסן}', '{}', '{}', 120, '{}', true)::text, false) is not null as p3 \gset
reset role;
update public.study_marathon_people set updated_at = now() - interval '1 hour' where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
update public.study_marathon_people set answer = 'in' where user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and marathon_id = current_setting('t.m2')::uuid;
set role authenticated;
-- The laptop takes a ticket and signs in to Shoham's saved account; the account redeems it.
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-0000000000aa';
set request.jwt.claims = '{"sub":"ffffffff-0000-4000-8000-0000000000aa","is_anonymous":true}';
select public.study_merge_offer() as ticket \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","is_anonymous":false}';
select 'ME53. claim returns ' || public.study_merge_claim(:'ticket', 'שוהם (מחשב)') || ' (expect 1)';
select 'ME54. members named שוהם: ' || count(*) || ' (expect 1)' from public.study_members where name = 'שוהם';
select 'ME55. Antimalarials now: wrong now ' || wrong_now || ', parts ' || parts_done::text || ' (expect 2: the laptop fixed q5; {0,1,2})'
  from public.study_my_lectures(:'gid') where lecture_id = :A;
select 'ME56. part 0: done ' || (done_at = '2026-11-12 18:00:00+00') || ', seconds ' || seconds || ' (expect true: the earlier finish, 900: both devices'' time)'
  from public.study_read_parts where lecture_id = :A and part_idx = 0;
select 'ME57. place: part ' || part_idx || ', anchor ' || anchor || ' (expect 0, 3: the laptop''s, the newer)' from public.study_read_places where lecture_id = :A;
select 'ME58. plans: ' || string_agg(title || '=' || status, ', ' order by title, status) || ' (expect מבחן מהלפטופ=archived, מבחן פתוגן מאכסן=active, מבחן פתוגן מאכסן=archived, מבחן שני=archived)'
  from (select * from public.study_plans order by title, status) x;
select 'ME59. the second marathon: ' || string_agg(answer, ',') || ' (expect out: the laptop''s answer was newer)'
  from public.study_marathon_people where marathon_id = current_setting('t.m2')::uuid;
reset role;
select 'ME60. the card''s memory: stability ' || stability || ', reps ' || reps || ' (expect 9, 4: the more recent review stays)'
  from public.study_card_states where card_id = 'c0000000-0000-4000-8000-000000000001';
select 'ME61. the quiz: ' || count(*) || ' seat (expect 1: the account''s)' from public.study_quiz_players where quiz_id = 'a0000000-0000-4000-8000-000000000001';
select 'ME62. rows left on the laptop''s id: ' || (
   (select count(*) from public.study_members where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_answers where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_read_parts where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_read_places where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_plans where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_marathon_people where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_card_states where user_id = 'ffffffff-0000-4000-8000-0000000000aa')
 + (select count(*) from public.study_quiz_players where user_id = 'ffffffff-0000-4000-8000-0000000000aa')) || ' (expect 0)';
-- Every user column of every study table, all features loaded, is merged.
select 'ME63. user columns checked: ' || count(*) || ' (expect 39 with every section: repo 5, F 2, W 3, Q 7, Z 5, C 8, K 1, P 8; ME64 is the guard)'
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
 where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
   and ((n.nspname = 'public' and c.relname like 'study\_%') or n.nspname = 'study_private')
   and not (n.nspname = 'study_private' and c.relname = 'merge_tickets');
select 'ME64. ' || coalesce('FAIL: not merged: ' || string_agg(t || '.' || col, ', '), 'ok: every user column of every study table is merged')
from (
  select format('%I.%I', n.nspname, c.relname) as t, a.attname as col
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
  where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
    and ((n.nspname = 'public' and c.relname like 'study\_%') or n.nspname = 'study_private')
    and not (n.nspname = 'study_private' and c.relname = 'merge_tickets')
    and position(format('update %I.%I set %I = dst', n.nspname, c.relname, a.attname)
                 in (select p.prosrc from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                      where pn.nspname = 'study_private' and p.proname = 'merge_users')) = 0
) missing;

-- A lecture split into parts again: the old "read" marks go with the old parts.
select 'ME67a. before: ' || count(*) || ' read marks on Antimalarials part 2 (expect 1)' from public.study_read_parts where lecture_id = :A and part_idx = 2;
delete from public.study_sections where lecture_id = :A and idx = 2;
select 'ME67b. after the part is deleted: ' || count(*) || ' (expect 0), parts 0-1 kept: ' || (select count(*) from public.study_read_parts where lecture_id = :A and part_idx < 2) || ' (expect 2)'
  from public.study_read_parts where lecture_id = :A and part_idx = 2;

-- Not signed in at all
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_my_lectures('00000000-0000-4000-8000-000000000000'); raise notice 'ME65. FAIL: anon read progress';
exception when insufficient_privilege then raise notice 'ME65. ok: anon cannot call the progress functions (%)', sqlerrm; end $$;
do $$ declare n int; begin select count(*) into n from public.study_marathons; raise notice 'ME66. anon sees % marathons (expect 0)', n;
exception when insufficient_privilege then raise notice 'ME66. ok: anon cannot read marathons (%)', sqlerrm; end $$;
reset role;

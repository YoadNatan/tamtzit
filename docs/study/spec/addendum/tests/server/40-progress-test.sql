-- ════════════════════════════════════════════════════════════════════════
--  Section P's end · PS: readiness as a range, the danger list, weak points
--  by aspect, calibration, a moved block.
-- ════════════════════════════════════════════════════════════════════════
reset role;
-- Rony: part 0's five questions on four earlier days, all "על בטוח", 15 of 20 right.
insert into public.study_answers (user_id, question_id, choice, correct, mode, confidence, answered_at)
select 'a1000000-0000-4000-8000-000000000006', ('a4000000-0000-4000-8000-00000000000' || i)::uuid, 0,
       not (i = 5 or (i = 4 and d = 1)), 'lecture', 3, now() - make_interval(days => d)
  from generate_series(1, 4) d, generate_series(1, 5) i;
-- Itai: the danger list. 06 wrong "על בטוח" two days ago; 04 wrong five days ago,
-- right "על בטוח" four days ago; 01 wrong six days ago, its paragraph's 02 right
-- "על בטוח" five days ago and 01 itself three days ago; 03 wrong but only "נראה לי".
insert into public.study_answers (user_id, question_id, choice, correct, mode, confidence, answered_at) values
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000006', 0, false, 'lecture', 3, now() - interval '2 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 0, false, 'quiz', 3, now() - interval '5 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 3, true, 'lecture', 3, now() - interval '4 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 0, false, 'lecture', 3, now() - interval '6 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000002', 0, true, 'lecture', 3, now() - interval '5 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 1, true, 'lecture', 3, now() - interval '3 days'),
 ('a1000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000003', 0, false, 'lecture', 2, now() - interval '2 days');
-- Daniel: latest answers on the four "mechanism" questions, two wrong.
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at) values
 ('a1000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000001', 0, false, 'lecture', now() - interval '1 day'),
 ('a1000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000002', 1, false, 'lecture', now() - interval '1 day'),
 ('a1000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000003', 2, true, 'lecture', now() - interval '1 day'),
 ('a1000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000005', 0, true, 'lecture', now() - interval '1 day'),
 ('a1000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000004', 3, true, 'lecture', now() - interval '1 day');

set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';   -- רוני
select 'PS1. readiness: part ' || part_idx || ' «' || heading || '» ' || answers || ' answers, ' || lo || '-' || hi || '% (expect part 0 «מחזור החיים» 20 answers, 65-85%)'
  from public.study_my_readiness(:'g') where part_idx = 0;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';   -- איתי
select 'PS1b. with fewer than 20 answers: ' || coalesce(lo::text, 'no range') || ' (expect no range)'
  from public.study_my_readiness(:'g') where part_idx = 0;
select 'PS2. danger list: ' || string_agg(right(question_id::text, 2) || ' rights ' || rights || ' due ' ||
         (due_day - ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date) || 'd', ', ' order by due_day, wrong_at)
       || ' (expect 04 rights 1 due -1d, 06 rights 0 due -1d; 01 left after two right "על בטוח" days; 03 was only "נראה לי")'
  from public.study_my_danger_list(:'g');
select 'PS2b. what it shows for 06: «' || chosen || '» → «' || right_text || '», asked as ' || right(ask_id::text, 2)
       || ' (expect «Sporozoite» → «Hypnozoite», asked as 06: no other question on its paragraph)'
  from public.study_my_danger_list(:'g') where question_id = 'a4000000-0000-4000-8000-000000000006';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'PS2c. Maya''s danger list holds ' || count(*) || ' of Itai''s (expect 0; hers: the quiz miss of 06)'
  from public.study_my_danger_list(:'g') where question_id <> 'a4000000-0000-4000-8000-000000000006';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';   -- דניאל
select 'PS3. aspects: ' || string_agg(aspect || ':' || questions || ':' || wrong_now || ':' || bucket, ' ' order by aspect)
       || ' (expect mechanism:4:2:hot; contra has one question, too few)'
  from public.study_my_aspects(:'g');
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';
select 'PS4. calibration: ' || string_agg(scope || ' ' || sure || ' ' || coalesce(pct::text, '-'), ', ' order by scope)
       || ' (expect all 20 75, lecture 20 75, part 20 75)'
  from public.study_my_calibration(:'g');
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000009';
do $$ begin perform public.study_my_danger_list(current_setting('t.g')::uuid); raise notice 'PS5. FAIL: a stranger read a danger list';
exception when others then raise notice 'PS5. %: members only, and only their own (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'PS6. a moved block: ' || public.study_marathon__agenda_ok(jsonb_build_array(jsonb_build_object('k', 'read', 'l', :'l1', 'min', 50, 'moved', true)), array[:'l1'::uuid])
       || ', moved "yes": ' || public.study_marathon__agenda_ok(jsonb_build_array(jsonb_build_object('k', 'read', 'l', :'l1', 'min', 50, 'moved', 'yes')), array[:'l1'::uuid])
       || ' (expect true, false)';
select 'PS-reg. P = ' || (public.study_schema() ->> 'P') || ' (expect 2)';

-- ════════════════════════════════════════════════════════════════════════
--  Sections G and E · GS: the group plan, its days, a slip's price, the
--  private relearning rounds, the exam marks. ES: a member's own trap.
--  DS: decision 2's race points (the meeting addendum's Z end), checked
--  against the approved scale.
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';   -- שוהם
select id as gp, version as gv from public.study_group_plan_save(null, null, :'g', 'מבחן בלוק פתוגן-מאכסן', current_date + 30,
  array[:'l1'::uuid, :'l3'::uuid]) \gset
select 'GS1. the plan: ' || title || ', shared from ' || (shared_from - current_date) || ', leave from ' || (leave_from - current_date)
       || ', ' || shared_minutes || '/' || leave_minutes || ' min a day, ' || rounds || ' rounds (expect shared 9, leave 16, 180/600, 3)'
  from public.study_group_plans where id = :'gp';
do $$ begin perform public.study_group_plan_save(null, null, current_setting('t.g')::uuid, 'עבר', current_date - 1, array[current_setting('t.l1')::uuid]);
  raise notice 'GS1b. FAIL: an exam in the past';
exception when others then raise notice 'GS1b. %: (%)', case when sqlerrm = 'bad date' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';   -- נועה changes it
select 'GS1c. Noa changed it: version ' || version || ' (expect 2)'
  from public.study_group_plan_save(:'gp', :'gv', :'g', 'מבחן בלוק פתוגן-מאכסן', current_date + 30, array[:'l1'::uuid, :'l3'::uuid],
                                    null, null, 180, 600, 3, '09:00');
select 'GS1d. last change by Noa: ' || (updated_by = auth.uid()) || ' (expect true: "שינוי אחרון: נועה")' from public.study_group_plans where id = :'gp';
do $$ begin perform public.study_group_plan_save((select id from public.study_group_plans where state = 'active'), 1, current_setting('t.g')::uuid,
  'ישן', current_date + 30, array[current_setting('t.l1')::uuid]); raise notice 'GS1e. FAIL: a stale version saved';
exception when others then raise notice 'GS1e. %: (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- GS2: a day of the group lane, with a block moved from the day before.
select id as gd, version as gdv from public.study_group_plan_day(:'gp', current_date + 9, null, 'יום 1 · סבב משותף',
  (current_date + 9) + time '09:00', 180, array[:'l1'::uuid],
  jsonb_build_array(jsonb_build_object('k', 'intro', 'min', 5, 'title', 'פתיחה: 3 לקפה'),
                    jsonb_build_object('k', 'read', 'l', :'l1', 'from', 0, 'to', 0, 'min', 50),
                    jsonb_build_object('k', 'quiz', 'l', :'l1', 'n', 5, 'min', 10),
                    jsonb_build_object('k', 'break', 'min', 10),
                    jsonb_build_object('k', 'read', 'l', :'l1', 'from', 1, 'to', 2, 'min', 60, 'moved', true))) \gset
select 'GS2. the day is a marathon of the plan: day ' || (plan_day - current_date) || ', ' || jsonb_array_length(agenda) || ' steps, moved ones '
       || (select count(*) from jsonb_array_elements(agenda) s where s ->> 'moved' = 'true') || ' (expect 9, 5, 1)'
  from public.study_marathons where id = :'gd';
select 'GS2b. the same day again: version ' || version || ', the same marathon ' || (id = :'gd') || ' (expect 2, true)'
  from public.study_group_plan_day(:'gp', current_date + 9, :'gdv', 'יום 1 · סבב משותף', (current_date + 9) + time '09:00', 240,
                                   array[:'l1'::uuid], '[]'::jsonb);
do $$ begin perform public.study_group_plan_day((select id from public.study_group_plans where state = 'active'), current_date + 9, 1,
  'ישן', (current_date + 9) + time '09:00', 180, array[current_setting('t.l1')::uuid], '[]'::jsonb); raise notice 'GS2c. FAIL: a day someone edited was overwritten';
exception when others then raise notice 'GS2c. %: (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_group_plan_day((select id from public.study_group_plans where state = 'active'), current_date + 40, null,
  'אחרי', (current_date + 40) + time '09:00', 180, array[current_setting('t.l1')::uuid], '[]'::jsonb); raise notice 'GS2d. FAIL: a day after the exam';
exception when others then raise notice 'GS2d. %: (%)', case when sqlerrm = 'bad date' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- GS3: the price of a day that slipped, with a name.
select public.study_group_plan_slip(:'gp', current_date + 10, 'longer', current_date + 14) as sv \gset
select 'GS3. slipped: version ' || :'sv' || ', by Noa ' || ((slips -> -1 ->> 'by') = auth.uid()::text) || ', the price ' || (slips -> -1 ->> 'choice')
       || ' until +' || ((slips -> -1 ->> 'until')::date - current_date) || ' (expect 3, true, longer until +14)'
  from public.study_group_plans where id = :'gp';
do $$ begin perform public.study_group_plan_slip((select id from public.study_group_plans where state = 'active'), current_date + 10, 'later', null);
  raise notice 'GS3b. FAIL';
exception when others then raise notice 'GS3b. %: the price is one of two (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- GS4: the private relearning rounds. Noa read L3 four days ago; its two key
-- questions she answered right three and two days ago: round 2 is done.
reset role;
insert into public.study_reads (lecture_id, user_id, read_at) values (:'l3', 'a1000000-0000-4000-8000-000000000002', now() - interval '4 days');
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
select 'a1000000-0000-4000-8000-000000000002', q.id, 0, true, 'lecture', now() - make_interval(days => 3 - (row_number() over (order by q.part_idx))::int + 1)
  from public.study_questions q where q.lecture_id = :'l3';
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'GS4. relearning: ' || string_agg(case when lecture_id = :'l1' then 'L1' else 'L3' end || ' rounds ' || rounds || ' keys ' || key_total || ' left ' || key_left
         || ' next ' || coalesce((next_day - ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date)::text, '-'), '; ' order by rounds)
       || ' (expect L1 rounds 0 keys 6 left 6 next -; L3 rounds 2 keys 2 left 2 next 1)'
  from public.study_my_relearning(:'gp');
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'GS4b. Maya''s own rounds: ' || string_agg(rounds::text, ',') || ' (expect 0,0)' from public.study_my_relearning(:'gp');
-- GS5: "זה למבחן" from the recording's notes.
reset role;
insert into public.study_recordings (lecture_id, source, status, consented, created_by) values (:'l1', 'file', 'ready', true, 'a1000000-0000-4000-8000-000000000001');
insert into public.study_recording_notes (lecture_id, part_idx, status, items) values
 (:'l1', 0, 'ready', '[{"anchor":3,"quote":"לפני Primaquine","at_s":2470,"text":"זה יופיע במבחן: G6PD לפני Primaquine","kind":"exam"},
                       {"anchor":1,"quote":"אף תרופה","at_s":2100,"text":"הוסבר שוב","kind":"said"}]');
set role authenticated;
select 'GS5. exam marks with recordings off: ' || count(*) || ' (expect 0)' from public.study_exam_marks(:'l1');
reset role;
update study_private.features set enabled = true where name = 'recordings';
set role authenticated;
select 'GS5b. with recordings on: ' || string_agg(part_idx || '.' || anchor || ' @' || at_s, ' ') || ' (expect 0.3 @2470)' from public.study_exam_marks(:'l1');
reset role;
update study_private.features set enabled = false where name = 'recordings';
select 'GS-reg. G = ' || (public.study_schema() ->> 'G') || ' (expect 1)';

-- ── E: a member's own trap ──
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';   -- רוני
do $$ begin perform public.study_trap_submit(null, current_setting('t.l1')::uuid, 0, 3, '', '', 'מה בודקים לפני Primaquine', array['G6PD','ECG','CBC','LFT'], 0, '', array[7]);
  raise notice 'ES1. FAIL: a lead-in without a question mark';
exception when others then raise notice 'ES1. %: (%)', case when sqlerrm = 'bad question' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_trap_submit(null, current_setting('t.l1')::uuid, 0, 3, '', '', 'מה בודקים לפני Primaquine?', array['G6PD','ECG','G6PD','LFT'], 0, '', array[7]);
  raise notice 'ES1b. FAIL: the same option twice';
exception when others then raise notice 'ES1b. %: (%)', case when sqlerrm = 'bad options' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_trap_submit(null, current_setting('t.l1')::uuid, 0, 3, '', '', 'מה בודקים לפני Primaquine?', array['G6PD','ECG','CBC','LFT'], 0, '', array[99]);
  raise notice 'ES1c. FAIL: a slide not in the lecture';
exception when others then raise notice 'ES1c. %: (%)', case when sqlerrm = 'bad source' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_trap_submit(null, :'l1', 0, 3, 'לפני Primaquine', 'מטייל חזר עם P. vivax.', 'מה חייבים לבדוק לפני Primaquine?',
  array['G6PD', 'ECG', 'ספירת דם', 'תפקודי כבד', 'בדיקת היריון'], 0, 'רוב האנשים בוחרים ECG', array[7]) as dr \gset
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'ES2. Maya sees ' || count(*) || ' of Rony''s drafts (expect 0)' from public.study_trap_drafts;
do $$ begin perform public.study_trap_checked((select id from public.study_trap_drafts limit 1), true, '', '{}', '{}', '', '', '', current_setting('t.key'));
  raise notice 'ES2b. FAIL: Maya checked Rony''s draft';
exception when others then raise notice 'ES2b. %: only the author''s call (%)', case when sqlerrm = 'draft not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';
do $$ begin perform public.study_trap_checked(current_setting('t.dr', true)::uuid, true, '', '{}', '{}', '', '', '', null); raise notice 'ES3. FAIL: no key';
exception when others then raise notice 'ES3. %: the op holds the key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select set_config('t.tq', '', false) is not null as x \gset
select public.study_trap_checked(:'dr', true, '', array['נכון: G6PD [ש'' 7]', 'ECG לא נדרש כאן [ש'' 7]', 'לא נדרש [ש'' 7]', 'לא נדרש [ש'' 7]', 'לא נדרש [ש'' 7]'],
  array['', 'מתי כן: Pentostam', '', '', 'מתי כן: Miltefosine'], 'לפני Primaquine בודקים G6PD [ש'' 7]', 'Primaquine', 'contra', :'key') as tq \gset
select set_config('t.tq', :'tq', false) is not null as x \gset
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'ES4. in everyone''s bank: source ' || source || ', author ' || coalesce(author_id::text, 'hidden') || ', created_by ' || coalesce(created_by::text, 'none')
       || ', anchor ' || anchor || ' (expect member, hidden, none, 3)' from public.study_questions where id = :'tq';
select 'ES4b. answered in practice: author ' || coalesce((select author_id::text from public.study_questions where id = :'tq'), 'hidden')
       || ', right ' || correct || ' (expect hidden, true)'
  from public.study_answer_question(:'tq', 0, 'lecture', null, 3);
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
do $$ begin perform public.study_answer_question(current_setting('t.tq')::uuid, 1, 'quiz', null, 2);
  raise notice 'ES5a. FAIL: a member wrote a "quiz" answer from practice';
exception when others then raise notice 'ES5a. %: only a live quiz writes quiz answers (%)', case when sqlerrm = 'bad mode' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'ES5b. after the refused "quiz" answer: author ' || coalesce(author_id::text, 'hidden') || ' (expect hidden: review SEC-7)'
  from public.study_questions where id = :'tq';
reset role;
-- what section Z's reveal does:
select public.study_quiz__revealed(null, :'tq') is null as r \gset
set role authenticated;
select 'ES5. after a live quiz: author is Rony ' || (author_id = 'a1000000-0000-4000-8000-000000000006') || ', unmasked ' || (unmasked_at is not null)
       || ' (expect true, true: "נכתבה ע״י רוני · נבדקה מול השקפים")' from public.study_questions where id = :'tq';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';
select public.study_trap_submit(null, :'l1', 1, 1, '', '', 'איפה Chloroquine מצטברת?', array['בוואקואולה', 'בגרעין', 'בכבד', 'בכליה'], 1, '', array[15]) as dr2 \gset
select coalesce(public.study_trap_checked(:'dr2', false, 'לפי ש׳ 15 היא מצטברת בוואקואולה, לא בגרעין', '{}', '{}', '', '', '', :'key')::text, 'not saved') as es6 \gset
select 'ES6. not right by the slides: ' || :'es6' || ', the draft: ' || state || ' · ' || problem
       || ' (expect not saved, rejected · לפי ש׳ 15 היא מצטברת בוואקואולה, לא בגרעין)' from public.study_trap_drafts where id = :'dr2';
select 'ES-reg. E = ' || (public.study_schema() ->> 'E') || ' (expect 1)';

-- ── D2: race points by the bet, the approved scale (section Z's end) ──
reset role;
select 'DS1. right +' || public.study_quiz__points(1::smallint, 1::smallint, 1::smallint) || '/+' || public.study_quiz__points(1::smallint, 1::smallint, 2::smallint)
       || '/+' || public.study_quiz__points(1::smallint, 1::smallint, 3::smallint) || ', wrong ' || public.study_quiz__points(0::smallint, 1::smallint, 1::smallint)
       || '/' || public.study_quiz__points(0::smallint, 1::smallint, 2::smallint) || '/' || public.study_quiz__points(0::smallint, 1::smallint, 3::smallint)
       || ', "לא יודעים" ' || public.study_quiz__points(null, 1::smallint, 3::smallint) || ', no bet sent ' || public.study_quiz__points(1::smallint, 1::smallint, null)
       || ' (expect right +1/+2/+3, wrong 0/-2/-6, "לא יודעים" 0, no bet sent 1)';

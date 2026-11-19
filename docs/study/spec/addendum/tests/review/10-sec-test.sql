-- ════════════════════════════════════════════════════════════════════════
--  SR · the security review's findings (critique/security.md), each attack
--  of critique/sec/probes run again on the final SQL: every one refused.
--  Users: 1 שוהם · 2 נועה · 3 מאיה · 4 איתי · 5 דניאל · 6 רוני · 12 נועה מחשב
--  (never saved) · 9 a stranger. Lecture L1: three parts, q1-q8 keyed 0.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
\set u1 '11111111-0000-4000-8000-000000000001'
\set u2 '11111111-0000-4000-8000-000000000002'
\set u3 '11111111-0000-4000-8000-000000000003'
\set u4 '11111111-0000-4000-8000-000000000004'
\set u5 '11111111-0000-4000-8000-000000000005'
\set u6 '11111111-0000-4000-8000-000000000006'
\set u12 '11111111-0000-4000-8000-000000000012'
\set u9 '99999999-0000-4000-8000-000000000009'
create or replace function rv.rev(p_part int) returns int language sql security definer as $$
  select rev from public.study_sections where lecture_id = '22222222-0000-4000-8000-000000000001' and idx = p_part $$;
create or replace function rv.block(p_part int, p_n int) returns text language sql security definer as $$
  select split_part((select markdown from public.study_sections where lecture_id = '22222222-0000-4000-8000-000000000001' and idx = p_part),
                    E'\n\n', p_n + 1) $$;
grant execute on function rv.rev(int), rv.block(int, int) to authenticated;

-- ═════════ SR1 · SEC-1: an undo is only of the latest correction, back to its own text ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.p1', public.study_propose_edit(:'l1', 0, 3, 'לפני Primaquine בודקים G6PD. [ש'' 7]',
  'לפני Primaquine בודקים רמת G6PD. [ש'' 7]', rv.rev(0), 0, 1, '', 'slide', array[7], null, '')::text, false) is not null as p \gset
select rv.as_user(:'u1') is not null as a \gset
select set_config('t.e1', public.study_approve_edit(current_setting('t.p1')::uuid) ->> 'edit_id', false) is not null as e \gset
select rv.as_user(:'u5') is not null as a \gset
select rv.raises('SR1a', format($q$select public.study_edit_block(%L, 0, 3, %L, %L, %s, 0, 1, '', %L)$q$, :'l1',
  'לפני Primaquine בודקים רמת G6PD. [ש'' 7]', 'Primaquine בטוחה גם בלי בדיקה. [ש'' 7]', rv.rev(0), current_setting('t.e1')), 'bad undo');
select rv.expect('SR1b', rv.block(0, 3), 'לפני Primaquine בודקים רמת G6PD. [ש'' 7]');
select rv.raises('SR1c', format($q$select public.study_edit_block(%L, 0, 3, %L, %L, %s, 0, 1, '')$q$, :'l1',
  'לפני Primaquine בודקים רמת G6PD. [ש'' 7]', 'Primaquine בטוחה גם בלי בדיקה. [ש'' 7]', rv.rev(0)), 'needs approval');
select set_config('t.e2', public.study_undo_edit(current_setting('t.e1')::uuid) ->> 'edit_id', false) is not null as u \gset
select rv.expect('SR1d', rv.block(0, 3) || ' · source ' || (select source_kind from public.study_edits where id = current_setting('t.e2')::uuid),
                 'לפני Primaquine בודקים G6PD. [ש'' 7] · source undo');
select rv.raises('SR1e', format('select public.study_undo_edit(%L)', current_setting('t.e2')), 'bad undo');      -- an undo is not undone
select rv.raises('SR1f', format('select public.study_undo_edit(%L)', current_setting('t.e1')), 'bad undo');      -- no longer the latest
reset role;

-- ═════════ SR2 · SEC-2, SEC-13: the fix sheet only for a hidden question, never in a quiz ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
insert into public.study_question_flags (question_id, reason, note) values ('33333333-0000-4000-8000-000000000006', 'other', '');
select rv.raises('SR2a', $q$select * from public.study_question_for_fix('33333333-0000-4000-8000-000000000006')$q$, 'not flagged');
delete from public.study_question_flags where question_id = '33333333-0000-4000-8000-000000000006' and user_id = auth.uid();
insert into public.study_question_flags (question_id, reason, note) values ('33333333-0000-4000-8000-000000000006', 'wrong_key', '');
select rv.raises('SR2b', $q$select * from public.study_question_for_fix('33333333-0000-4000-8000-000000000006')$q$, 'not flagged');
select rv.as_user(:'u3') is not null as a \gset
insert into public.study_question_flags (question_id, reason, note) values ('33333333-0000-4000-8000-000000000006', 'unclear', '');
select rv.expect('SR2c', (select 'hidden ' || hidden || ', key ' || answer from public.study_question_for_fix('33333333-0000-4000-8000-000000000006')),
                 'hidden true, key 0');
reset role;
update public.study_question_keys set held_until = now() + interval '10 minutes' where question_id = '33333333-0000-4000-8000-000000000006';
set role authenticated;
select rv.raises('SR2d', $q$select * from public.study_question_for_fix('33333333-0000-4000-8000-000000000006')$q$, 'in quiz');
select rv.raises('SR2e', $q$select public.study_question_fix('33333333-0000-4000-8000-000000000006', 'retire', null, '')$q$, 'in quiz');
reset role;
update public.study_question_keys set held_until = null where question_id = '33333333-0000-4000-8000-000000000006';
set role authenticated;
select rv.as_user(:'u5') is not null as a \gset
insert into public.study_question_flags (question_id, reason, note) values ('33333333-0000-4000-8000-000000000005', 'duplicate', '');
select rv.raises('SR2f', $q$select public.study_question_fix('33333333-0000-4000-8000-000000000005', 'retire', null, '')$q$, 'not flagged');
select rv.expect('SR2g', (select 'retired ' || (retired_at is not null) from public.study_questions where id = '33333333-0000-4000-8000-000000000005'),
                 'retired false');
-- q6 stays hidden for SR-F6 below.
reset role;

-- ═════════ SR3 · SEC-3: approval aloud only in a live meeting with two followers, never one's own ═════════
set role authenticated;
select rv.as_user(:'u5') is not null as a \gset
select set_config('t.p3', public.study_propose_edit(:'l1', 1, 2, 'Mefloquine ניתנת פעם בשבוע. [ש'' 20]',
  'Mefloquine ניתנת פעם בשבוע, למניעה. [ש'' 20]', rv.rev(1), 0, 1, '', 'slide', array[20], null, '')::text, false) is not null as p \gset
select set_config('t.m', public.study_meeting_reading(:'l1', true, 1, 2)::text, false) is not null as m \gset
select rv.raises('SR3a', format('select public.study_approve_edit(%L, true)', current_setting('t.p3')), 'own proposal');
select rv.as_user(:'u1') is not null as a \gset
select set_config('t.p4', public.study_propose_edit(:'l1', 2, 1, 'Artemisinins לעולם לא לבד. [ש'' 30]',
  'Artemisinins לעולם לא לבד, תמיד עם שותף. [ש'' 30]', rv.rev(2), 0, 1, '', 'slide', array[30], null, '')::text, false) is not null as p \gset
select rv.as_user(:'u5') is not null as a \gset
select rv.raises('SR3b', format('select public.study_approve_edit(%L, true)', current_setting('t.p4')), 'not live');   -- nobody follows
select rv.as_user(:'u3') is not null as a \gset
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
select rv.as_user(:'u4') is not null as a \gset
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
select rv.as_user(:'u5') is not null as a \gset
select set_config('t.e4', public.study_approve_edit(current_setting('t.p4')::uuid, true) ->> 'edit_id', false) is not null as e \gset
select rv.expect('SR3c', (select 'applied ' || (current_setting('t.e4') <> '') || ', history aloud ' || aloud || ', author שוהם ' || (author_id = :'u1')
                            from public.study_edits where id = current_setting('t.e4')::uuid), 'applied true, history aloud true, author שוהם true');
select rv.expect('SR3d', (select 'state ' || state || ', aloud ' || aloud || ', approved by Daniel ' || (approved_by = :'u5')
                            from public.study_edit_proposals where id = current_setting('t.p4')::uuid), 'state applied, aloud true, approved by Daniel true');
reset role;
update public.study_meeting_live set place_at = now() - interval '2 minutes' where meeting_id = current_setting('t.m')::uuid;
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.p5', public.study_propose_edit(:'l1', 1, 1, 'Chloroquine מצטברת בוואקואולה. [ש'' 15]',
  'Chloroquine מצטברת בוואקואולה של הטפיל. [ש'' 15]', rv.rev(1), 0, 1, '', 'slide', array[15], null, '')::text, false) is not null as p \gset
select rv.as_user(:'u5') is not null as a \gset
select rv.raises('SR3e', format('select public.study_approve_edit(%L, true)', current_setting('t.p5')), 'not live');   -- the place went silent
select public.study_withdraw_edit(current_setting('t.p3')::uuid) is null as w \gset
select public.study_meeting_reading(:'l1', false) is not null as off \gset
select rv.as_user(:'u2') is not null as a \gset
select public.study_withdraw_edit(current_setting('t.p5')::uuid) is null as w \gset
reset role;

-- ═════════ SR4 · SEC-4: nobody takes over a live reading; the place moves a part at a time; guesses need followers ═════════
set role authenticated;
select rv.as_user(:'u1') is not null as a \gset
select public.study_meeting_reading(:'l1', true, 0, 0) is not null as r \gset
reset role;
update public.study_meetings set guess_ids = array['33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002']::uuid[],
       guess_released = 0 where id = current_setting('t.m')::uuid;
delete from public.study_meeting_presence where meeting_id = current_setting('t.m')::uuid;
update public.study_meeting_live set max_part = 0, max_anchor = 0 where meeting_id = current_setting('t.m')::uuid;
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select rv.raises('SR4a', format('select public.study_meeting_reading(%L, true)', :'l1'), 'reading');
select rv.raises('SR4b', format('select public.study_meeting_reader_view(%L)', current_setting('t.m')), 'not the reader');
select rv.expect('SR4c', (select reader_id::text from public.study_meetings where id = current_setting('t.m')::uuid), :'u1');
select rv.as_user(:'u1') is not null as a \gset
select rv.expect('SR4d', public.study_meeting_place(current_setting('t.m')::uuid, 0, 2)::text, '0');   -- at guess 2's paragraph, nobody follows
-- a jump to the end
select public.study_meeting_place(current_setting('t.m')::uuid, 2, 3) is not null as p \gset
reset role;
select rv.expect('SR4e', (select max_part || '.' || max_anchor from public.study_meeting_live where meeting_id = current_setting('t.m')::uuid), '1.0');
set role authenticated;
select rv.as_user(:'u3') is not null as a \gset
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
select rv.as_user(:'u4') is not null as a \gset
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
select rv.as_user(:'u1') is not null as a \gset
select rv.expect('SR4f', public.study_meeting_place(current_setting('t.m')::uuid, 1, 0)::text, '2');      -- with two followers both release
reset role;
update public.study_meeting_live set place_at = now() - interval '2 minutes' where meeting_id = current_setting('t.m')::uuid;
set role authenticated;
select rv.raises('SR4g', format('select public.study_meeting_reader_view(%L)', current_setting('t.m')), 'not live');
select rv.as_user(:'u2') is not null as a \gset
select public.study_meeting_reading(:'l1', true) is not null as r \gset
select rv.expect('SR4h', (select 'reader Noa ' || (reader_id = :'u2')::text from public.study_meetings where id = current_setting('t.m')::uuid),
                 'reader Noa true');                                                                    -- a minute of silence hands over
reset role;

-- ═════════ SR11 · SEC-11: the reader does not tap; no text from the phone ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select rv.raises('SR11a', format($q$select public.study_meeting_unclear(%L, 0, 2, 'x')$q$, current_setting('t.m')), 'is reader');
select rv.as_user(:'u3') is not null as a \gset
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'שוהם מקריאה כמו רובוט, תעצרי כבר') as t \gset
select rv.expect('SR11b', (select quote from public.study_meeting_taps where meeting_id = current_setting('t.m')::uuid and part_idx = 0 and anchor = 2), '');
select rv.as_user(:'u2') is not null as a \gset
select public.study_meeting_place(current_setting('t.m')::uuid, 0, 2) is not null as p \gset
select public.study_meeting_stop(current_setting('t.m')::uuid, 'explain', 0, 2, 'טקסט חופשי מהטלפון') is null as s \gset
select rv.expect('SR11c', (select quote from public.study_meeting_events where meeting_id = current_setting('t.m')::uuid and kind = 'explain'), '');
select public.study_meeting_reading(:'l1', false) is not null as off \gset
reset role;

-- ═════════ SR5 · SEC-5: the opening and the pick never read two players' private answers ═════════
-- Maya answered q1-q8 in practice, wrong only on q3 and q6; yesterday's meeting read L1's parts 0-2.
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
select :'u3', q.id, case when q.id in ('33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000006') then 1 else 0 end,
       q.id not in ('33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000006'), 'lecture', now() - interval '2 days'
  from public.study_questions q where q.lecture_id = :'l1' and q.id <> '33333333-0000-4000-8000-000000000006';
insert into public.study_meetings (id, group_id, day, starts_at, lecture_id, part_from, part_to, started_at, read_part, created_by)
values ('55555555-0000-4000-8000-000000000001', :'gid', study_private.day_of(now()) - 1, now() - interval '1 day', :'l1', 0, 2,
        now() - interval '1 day', 2, :'u1');
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.m2', id::text, false) is not null as m
  from public.study_meeting_save(null, null, :'gid', now(), '22222222-0000-4000-8000-000000000002', 0, 0, '', null) \gset
select set_config('t.cq', public.study_meeting_quiz(current_setting('t.m2')::uuid, 'coffee')::text, false) is not null as c \gset
select rv.as_user(:'u3') is not null as a \gset
select public.study_quiz_join(current_setting('t.cq')::uuid) is null as j \gset
reset role;
do $$
declare i int; hits int := 0; ids uuid[];
begin
  for i in 1 .. 20 loop
    ids := public.study_quiz__pick_preset(current_setting('t.cq')::uuid);
    if ids[1:2] @> array['33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000006']::uuid[] then hits := hits + 1; end if;
  end loop;
  perform rv.expect('SR5a', case when hits < 10 then 'about chance' else hits || ' of 20' end, 'about chance');
  raise notice 'SR5a·  the opening''s first two were Maya''s two mistakes in % of 20 runs (the designs'' picker: 20 of 20; chance about 1 in 27)', hits;
end $$;
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select public.study_quiz_end(current_setting('t.cq')::uuid) is null as e \gset
reset role;
-- Maya never answered q6 (hidden anyway) or, from here, q2, q5, q8: a free quiz of Noa and Maya.
delete from public.study_answers where user_id = :'u3' and question_id in ('33333333-0000-4000-8000-000000000002',
  '33333333-0000-4000-8000-000000000005', '33333333-0000-4000-8000-000000000008');
update public.study_quizzes set created_at = created_at - interval '1 day' where group_id = :'gid';
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.fq', public.study_quiz_create(:'gid', 'coop', array[:'l1']::uuid[], 3, 30)::text, false) is not null as c \gset
select rv.as_user(:'u3') is not null as a \gset
select public.study_quiz_join(current_setting('t.fq')::uuid) is null as j \gset
reset role;
do $$
declare i int; hits int := 0; got uuid[];
begin
  for i in 1 .. 20 loop
    perform public.study_quiz__pick(current_setting('t.fq')::uuid);
    select array_agg(question_id order by question_id) into got from public.study_quiz_rounds where quiz_id = current_setting('t.fq')::uuid;
    if got = array['33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000005',
                   '33333333-0000-4000-8000-000000000008']::uuid[] then hits := hits + 1; end if;
  end loop;
  perform rv.expect('SR5b', case when hits < 10 then 'about chance' else hits || ' of 20' end, 'about chance');
  raise notice 'SR5b·  a quiz of two asked exactly what Maya never answered in % of 20 runs (the designs'' pick: 20 of 20; chance 1 in 18)', hits;
end $$;
delete from public.study_quizzes where id = current_setting('t.fq')::uuid;

-- ═════════ SR6 · SEC-6: small votes show no counts; a solo score is not published; the trap card waits ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.q2', public.study_quiz_create(:'gid', 'coop', array[:'l1']::uuid[], 3, 30)::text, false) is not null as c \gset
select rv.as_user(:'u3') is not null as a \gset
select public.study_quiz_join(current_setting('t.q2')::uuid) is null as j \gset
select rv.as_user(:'u2') is not null as a \gset
select public.study_quiz_next(current_setting('t.q2')::uuid, -1) is null as n \gset
select rv.shift(current_setting('t.q2')::uuid, 5) is null as s \gset
select (public.study_quiz_answer(current_setting('t.q2')::uuid, 0, 0, 2)).bet is not null as a \gset
select rv.as_user(:'u3') is not null as a \gset
select (public.study_quiz_answer(current_setting('t.q2')::uuid, 0, 1, 2)).bet is not null as a \gset
select rv.as_user(:'u2') is not null as a \gset
select rv.expect('SR6a', (select (s -> 'quiz' ->> 'state') || ', answered ' || (s -> 'round' ->> 'answered') || ', counts ' || coalesce(s -> 'round' ->> 'counts', 'none')
                                  || ', right ' || coalesce(s -> 'round' ->> 'right', 'none')
                            from (select public.study_quiz_state(current_setting('t.q2')::uuid) as s) x),
                 'reveal, answered 2, counts none, right none');
select rv.as_user(:'u5') is not null as a \gset
select rv.expect('SR6b', (select coalesce(s -> 'round' ->> 'counts', 'none') || ', ' || coalesce(s -> 'round' ->> 'right', 'none') || ', '
                                 || coalesce(s -> 'round' ->> 'correct', 'none') || ', answered ' || (s -> 'round' ->> 'answered')
                            from (select public.study_quiz_state(current_setting('t.q2')::uuid) as s) x),
                 'none, none, none, answered 2');
select rv.as_user(:'u2') is not null as a \gset
select public.study_quiz_end(current_setting('t.q2')::uuid) is null as e \gset
select rv.as_user(:'u4') is not null as a \gset
select rv.expect('SR6c', (select 'players ' || players_n || ', share ' || coalesce(right_pct::text, 'none')
                            from public.study_quiz_recent(:'gid') where id = current_setting('t.q2')::uuid), 'players 2, share none');
-- Four players, three choose the same wrong option: the trap card is made, and opens the next study day.
select set_config('t.q4', public.study_quiz_create(:'gid', 'coop', array[:'l1']::uuid[], 3, 30)::text, false) is not null as c \gset
select rv.as_user(:'u3') is not null as a \gset
select public.study_quiz_join(current_setting('t.q4')::uuid) is null as j \gset
select rv.as_user(:'u5') is not null as a \gset
select public.study_quiz_join(current_setting('t.q4')::uuid) is null as j \gset
select rv.as_user(:'u6') is not null as a \gset
select public.study_quiz_join(current_setting('t.q4')::uuid) is null as j \gset
select rv.as_user(:'u4') is not null as a \gset
select public.study_quiz_next(current_setting('t.q4')::uuid, -1) is null as n \gset
select rv.shift(current_setting('t.q4')::uuid, 5) is null as s \gset
select set_config('t.tq', rv.q_now(current_setting('t.q4')::uuid)::text, false) is not null as q \gset
select (public.study_quiz_answer(current_setting('t.q4')::uuid, 0, 2, 3)).bet is not null as a \gset
select rv.as_user(:'u3') is not null as a \gset
select (public.study_quiz_answer(current_setting('t.q4')::uuid, 0, 2, 3)).bet is not null as a \gset
select rv.as_user(:'u5') is not null as a \gset
select (public.study_quiz_answer(current_setting('t.q4')::uuid, 0, 2, 2)).bet is not null as a \gset
select rv.as_user(:'u6') is not null as a \gset
select (public.study_quiz_answer(current_setting('t.q4')::uuid, 0, 0, 1)).bet is not null as a \gset
select rv.as_user(:'u4') is not null as a \gset
select rv.expect('SR6d', (select 'trap ' || (s -> 'round' ->> 'trap') || ', counts ' || (s -> 'round' ->> 'counts')
                            from (select public.study_quiz_state(current_setting('t.q4')::uuid) as s) x), 'trap 2, counts [1, 0, 3, 0, 0]');
select rv.as_user(:'u1') is not null as a \gset
select rv.expect('SR6e', (select count(*)::text from public.study_cards where trap_key = 'q:' || current_setting('t.tq') || ':2'), '0');
reset role;
select rv.expect('SR6f', (select 'made ' || count(*) || ', opens at the next study day''s start '
                                 || bool_and(opens_at = ((((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date + 1) + time '04:00')
                                                         at time zone 'Asia/Jerusalem')
                            from public.study_cards where trap_key = 'q:' || current_setting('t.tq') || ':2'), 'made 1, opens at the next study day''s start true');
update public.study_cards set opens_at = now() - interval '1 minute' where trap_key = 'q:' || current_setting('t.tq') || ':2';
set role authenticated;
select rv.as_user(:'u1') is not null as a \gset
select rv.expect('SR6g', (select count(*)::text from public.study_cards where trap_key = 'q:' || current_setting('t.tq') || ':2'), '1');
select rv.as_user(:'u4') is not null as a \gset
select public.study_quiz_end(current_setting('t.q4')::uuid) is null as e \gset
-- A quiz of one: Itai alone; his score is not the group's to read.
reset role;
update public.study_quizzes set created_at = created_at - interval '1 day' where group_id = :'gid';
set role authenticated;
select set_config('t.q1', public.study_quiz_create(:'gid', 'coop', array[:'l1']::uuid[], 3, 30)::text, false) is not null as c \gset
select public.study_quiz_next(current_setting('t.q1')::uuid, -1) is null as n \gset
select rv.shift(current_setting('t.q1')::uuid, 5) is null as s \gset
select (public.study_quiz_answer(current_setting('t.q1')::uuid, 0, 1, 1)).bet is not null as a \gset
select public.study_quiz_end(current_setting('t.q1')::uuid) is null as e \gset
select rv.as_user(:'u1') is not null as a \gset
select rv.expect('SR6h', (select 'players ' || players_n || ', share ' || coalesce(right_pct::text, 'none')
                            from public.study_quiz_recent(:'gid') where id = current_setting('t.q1')::uuid), 'players 1, share none');
reset role;

-- ═════════ SR7 · SEC-7: a member never writes a "quiz" answer ═════════
set role authenticated;
select rv.as_user(:'u4') is not null as a \gset
select rv.raises('SR7', $q$select * from public.study_answer_question('33333333-0000-4000-8000-000000000001', 1, 'quiz')$q$, 'bad mode');
reset role;

-- ═════════ SR8 · SEC-8: the pulse counts saved accounts of 7 days, and only they read it ═════════
update study_private.features set enabled = true where name = 'pulse';
-- a member with a saved account who joined two days ago: not counted for a week
insert into auth.users (id, raw_user_meta_data, is_anonymous) values ('11111111-0000-4000-8000-000000000007', '{"full_name":"חדשה"}', false);
insert into public.study_members (group_id, user_id, name, joined_at)
values (:'gid', '11111111-0000-4000-8000-000000000007', 'חדשה', now() - interval '2 days');
select rv.expect('SR8a', (select string_agg(m.name, ', ' order by m.name) from study_private.pulse_counted(:'gid') c
                            join public.study_members m on m.group_id = :'gid' and m.user_id = c.user_id),
                 'איתי, דניאל, מאיה, נועה, רוני, שוהם');                                         -- not "נועה מחשב" (never saved)
select study_private.pulse_night(:'gid', now(), true) is not null as n \gset
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select rv.expect('SR8b', public.study_pulse_reader(:'gid')::text, 'true');
insert into public.study_pulse_optout (group_id) values (:'gid');
select rv.expect('SR8c', public.study_pulse_reader(:'gid')::text || ', ready ' || coalesce(public.study_pulse_ready(:'gid')::text, 'none')
                         || ', question rows ' || (select count(*) from public.study_pulse_questions), 'false, ready none, question rows 0');
reset role;
-- a night runs while she is out; she comes back the same day
select study_private.pulse_night(:'gid', now(), true) is not null as n \gset
set role authenticated;
delete from public.study_pulse_optout where user_id = auth.uid();
-- back in: the night that did not count her stays closed to her
select rv.expect('SR8d', public.study_pulse_reader(:'gid')::text, 'false');
reset role;
select study_private.pulse_night(:'gid', now(), true) is not null as n \gset
set role authenticated;
select rv.expect('SR8e', public.study_pulse_reader(:'gid')::text, 'true');
select rv.as_user(:'u12') is not null as a \gset
select rv.expect('SR8f', public.study_pulse_reader(:'gid')::text, 'false');            -- an unsaved device reads nothing either
reset role;                                     -- the boss's heads (hot topics) follow the same rule: fun check H1e
update study_private.features set enabled = false where name = 'pulse';

-- ═════════ SR9 · SEC-9: Claude's attempt only through the op (the server key) ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select rv.raises('SR9a', format($q$select public.study_ask_to_group(%L, 0, 3, '', 'צריך לבדוק משהו לפני Primaquine?',
  'לא צריך לבדוק כלום לפני Primaquine. [ש'' 7]')$q$, :'l1'), 'forbidden');
select set_config('t.ask', public.study_ask_to_group(:'l1', 0, 3, '', 'צריך לבדוק משהו לפני Primaquine?',
  'כן: רמת G6PD. [ש'' 7]', :'key')::text, false) is not null as k \gset
select rv.expect('SR9b', (select string_agg(kind || case when ask_attempt then '+attempt' else '' end, ' ' order by parent_id nulls first)
                            from public.study_comments where id = current_setting('t.ask')::uuid or parent_id = current_setting('t.ask')::uuid),
                 'question comment+attempt');
reset role;

-- ═════════ SR10 · SEC-10, SR15 · SEC-15: backing closes before its split shows; one VAR at a time ═════════
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select set_config('t.d', public.study_dispute_open(:'l1', 2, 2, 'Quinine', 'Quinine עם Doxycycline גם בהיריון', array[33])::text, false)
       is not null as d \gset
select rv.as_user(:'u3') is not null as a \gset
select public.study_dispute_claim(current_setting('t.d')::uuid, 'בהיריון Clindamycin במקום Doxycycline', array[33]) is null as c \gset
select rv.as_user(:'u4') is not null as a \gset
select public.study_dispute_back(current_setting('t.d')::uuid, 'a') is null as b \gset
select rv.as_user(:'u5') is not null as a \gset
select public.study_dispute_back(current_setting('t.d')::uuid, 'b') is null as b \gset
select rv.as_user(:'u1') is not null as a \gset
select public.study_dispute_back(current_setting('t.d')::uuid, 'b') is null as b \gset
select set_config('t.v0', (select version::text from public.study_disputes where id = current_setting('t.d')::uuid), false) is not null as v \gset
select rv.as_user(:'u6') is not null as a \gset
select public.study_dispute_back(current_setting('t.d')::uuid, 'a') is null as b \gset
select rv.expect('SR10a', coalesce(public.study_dispute_state(current_setting('t.d')::uuid) ->> 'backs', 'none')
                          || ', backers ' || (public.study_dispute_state(current_setting('t.d')::uuid) ->> 'backers'), 'none, backers 4');
select rv.expect('SR10b', (select (version::text = current_setting('t.v0'))::text from public.study_disputes where id = current_setting('t.d')::uuid)
                          || ', backs_n published ' || exists (select 1 from information_schema.columns
                                                                where table_name = 'study_disputes' and column_name = 'backs_n'), 'true, backs_n published false');
select rv.raises('SR15a', format('select public.study_dispute_judge_begin(%L)', current_setting('t.d')), 'forbidden');
select public.study_dispute_judge_begin(current_setting('t.d')::uuid, :'key') is null as j \gset
select rv.raises('SR15b', format('select public.study_dispute_judge_begin(%L, %L)', current_setting('t.d'), :'key'), 'busy');
select rv.expect('SR10c', (public.study_dispute_state(current_setting('t.d')::uuid) -> 'backs')::text, '{"a": 2, "b": 2}');
select rv.raises('SR10d', format($q$select public.study_dispute_back(%L, 'b')$q$, current_setting('t.d')), 'not open');
reset role;
-- the plaque's hold (an open exhibit, set up as the night would)
insert into public.study_traps (id, group_id, lecture_id, question_id, option, source, exhibit_no, exhibit_at, state, found_at, opens_at, opened_at)
values ('66666666-0000-4000-8000-000000000001', :'gid', :'l1', '33333333-0000-4000-8000-000000000001', 1, 'pulse', 1, now() - interval '1 day',
        'open', now() - interval '2 days', now() - interval '1 day', now() - interval '1 day');
set role authenticated;
select rv.as_user(:'u3') is not null as a \gset
select public.study_trap_plaque_begin('66666666-0000-4000-8000-000000000001', :'key') is null as p \gset
select rv.raises('SR15c', format('select public.study_trap_plaque_begin(%L, %L)', '66666666-0000-4000-8000-000000000001', :'key'), 'busy');
select public.study_trap_plaque('66666666-0000-4000-8000-000000000001', 'Quinine משמשת למניעה', 'חומרים: ביטחון עצמי', :'key') as s \gset
select rv.raises('SR15d', format('select public.study_trap_plaque_begin(%L, %L)', '66666666-0000-4000-8000-000000000001', :'key'), 'checked');
reset role;

-- ═════════ SR12 · SEC-12: the catch-up's "קראו" is written the next study day, with the meeting's time ═════════
set role authenticated;
select rv.as_user(:'u6') is not null as a \gset
select public.study_meeting_catchup_done('55555555-0000-4000-8000-000000000001') is null as d \gset
select rv.as_user(:'u2') is not null as a \gset
select rv.expect('SR12a', (select count(*)::text from public.study_reads where lecture_id = :'l1' and user_id = :'u6'), '0');
reset role;
update public.study_meeting_catchups set done_at = done_at - interval '1 day' where user_id = :'u6';
set role authenticated;
select public.study_meeting_band(:'gid') is not null as b \gset
select rv.expect('SR12b', (select count(*) || ', at the meeting''s start ' || bool_and(r.read_at = m.started_at)
                             from public.study_reads r join public.study_meetings m on m.id = '55555555-0000-4000-8000-000000000001'
                            where r.lecture_id = :'l1' and r.user_id = :'u6'), '1, at the meeting''s start true');
reset role;

-- ═════════ SR14 · SEC-14: wall photos: one's own upload, deleted only by its uploader; the bucket's limits ═════════
insert into storage.objects (bucket_id, name, owner_id) values
 ('study', :'gid' || '/wall/0f0f0f0f-0000-4000-8000-000000000001.jpg', :'u3'),
 ('study', :'gid' || '/22222222-0000-4000-8000-000000000001/fig-5-1.jpg', :'u1');
set role authenticated;
select rv.as_user(:'u2') is not null as a \gset
select rv.raises('SR14a', format($q$select public.study_aid_post(%L, 0, 2, '', 'sketch', 'Hypnozoite ישן כמו סטודנט', 'Hypnozoite רדום בכבד [ש'' 5]',
  array[5], '', true, null, null, null, %L)$q$, :'l1', :'gid' || '/wall/0f0f0f0f-0000-4000-8000-000000000001.jpg'), 'bad photo');
select rv.as_user(:'u4') is not null as a \gset
with d as (delete from storage.objects where name like '%/wall/0f0f0f0f-%' returning 1) select rv.expect('SR14b', (select count(*)::text from d), '0');
select rv.as_user(:'u3') is not null as a \gset
select set_config('t.aid', public.study_aid_post(:'l1', 0, 2, '', 'sketch', 'Hypnozoite ישן כמו סטודנט', 'Hypnozoite רדום בכבד [ש'' 5]',
  array[5], '', true, null, null, null, :'gid' || '/wall/0f0f0f0f-0000-4000-8000-000000000001.jpg')::text, false) is not null as a \gset
with d as (delete from storage.objects where name like '%/wall/0f0f0f0f-%' returning 1) select rv.expect('SR14c', (select count(*)::text from d), '1');
reset role;
select rv.expect('SR14d', (select file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'study'),
                 '26214400 image/jpeg,image/png,image/webp,application/pdf');
\echo '== SR done'

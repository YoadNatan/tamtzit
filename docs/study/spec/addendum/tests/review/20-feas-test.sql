-- ════════════════════════════════════════════════════════════════════════
--  FR · the feasibility review's findings that the SQL can show
--  (critique/feasibility.md): F-4 (section C before Q), F-6 (two flags hide
--  a question everywhere), F-15 (one opening and one closing a day), F-8
--  (the new tables' realtime and privacy rules), the registry.
--  After 10-sec-test.sql (q6 is hidden there by two members' flags).
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
reset role;

-- F-4: the private card's foreign key to a question exists once section Q does.
select rv.expect('FR4', (select count(*)::text from pg_constraint where conname = 'study_my_cards_question_id_fkey'), '1');

-- F-6: every function that picks or serves bank questions reads hidden_at
-- (the feasibility review's run4.sh scan, now a check; the counting ones too).
select rv.expect('FR6a', coalesce((select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
                                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname in ('public', 'study_private')
                                      and p.prosrc ~ 'study_questions' and p.prosrc ~ '(has_key|retired_at is null)'
                                      and p.proname ~ '(pick|guess|catchup|today|danger|returns|quiz__|boss|paragraph_practice|rewording|relearning|key_questions|museum|pulse)'
                                      and p.prosrc !~ 'hidden_at'), 'none'),
                 'none');
select rv.expect('FR6b', (select 'q6 hidden ' || (hidden_at is not null) from public.study_questions where id = '33333333-0000-4000-8000-000000000006'),
                 'q6 hidden true');
update public.study_quizzes set state = 'ended', ended_at = now() where group_id = :'gid' and state in ('lobby', 'question', 'reveal');
set role authenticated;
select rv.as_user('11111111-0000-4000-8000-000000000004') is not null as a \gset
select set_config('t.hq', public.study_quiz_create(:'gid', 'coop', array[:'l1']::uuid[], 8, 30)::text, false) is not null as c \gset
reset role;
select public.study_quiz__pick(current_setting('t.hq')::uuid) is not null as p \gset
select rv.expect('FR6c', (select 'rounds ' || count(*) || ', q6 among them ' || bool_or(question_id = '33333333-0000-4000-8000-000000000006')
                            from public.study_quiz_rounds where quiz_id = current_setting('t.hq')::uuid), 'rounds 6, q6 among them false');   -- q7 is marked by SR3's correction
delete from public.study_quizzes where id = current_setting('t.hq')::uuid;
-- a meeting whose first part is part 1 (q4, q5, q6): the pre-guesses never take q6
insert into public.study_meetings (id, group_id, day, starts_at, lecture_id, part_from, part_to, created_by)
values ('55555555-0000-4000-8000-000000000003', :'gid', study_private.day_of(now()) + 1, now() + interval '1 day', :'l1', 1, 2,
        '11111111-0000-4000-8000-000000000001');
set role authenticated;
select rv.expect('FR6d', (select (not ('33333333-0000-4000-8000-000000000006'::uuid = any (public.study_meeting_guess_pick('55555555-0000-4000-8000-000000000003'))))::text),
                 'true');
select rv.expect('FR6e', (select (q ->> 'hidden') from jsonb_array_elements(public.study_paragraph_practice(:'l1', 1, 3) -> 'questions') q
                            where q ->> 'id' = '33333333-0000-4000-8000-000000000006'), 'true');
select rv.expect('FR6f', coalesce((select questions::text from public.study_paragraph_chips(:'l1') where part_idx = 1 and anchor = 3), '0'), '0');
select rv.raises('FR6g', $q$select * from public.study_answer_question('33333333-0000-4000-8000-000000000006', 0, 'lecture')$q$, 'hidden');
reset role;

-- F-15: decision 7's cap is one opening and one closing a study day for the group, whatever the meeting.
update public.study_quizzes set created_at = created_at - interval '1 day' where group_id = :'gid';
set role authenticated;
select rv.as_user('11111111-0000-4000-8000-000000000001') is not null as a \gset
select set_config('t.e1', public.study_meeting_quiz(current_setting('t.m')::uuid, 'end')::text, false) is not null as e \gset
-- started, so it is a closing that happened (a lobby ended unstarted is cancelled and frees its place)
select public.study_quiz_next(current_setting('t.e1')::uuid, -1) is null as n \gset
select public.study_quiz_end(current_setting('t.e1')::uuid) is null as x \gset
-- today's second meeting (on L2, SR5's): its closing quiz is the day's second
select rv.raises('FR15', format($q$select public.study_meeting_quiz(%L, 'end')$q$, current_setting('t.m2')), 'already');
reset role;

-- The new tables: RLS on everywhere, published ones keyed by their own uuid, private ones never published.
select rv.expect('FR-rls', coalesce((select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'study%' and not c.relrowsecurity), 'none'),
                 'none');
select rv.expect('FR-pub', (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
                             where pubname = 'supabase_realtime' and tablename in ('study_meetings', 'study_edit_proposals', 'study_disputes',
                               'study_slide_flags', 'study_aids', 'study_group_plans', 'study_meeting_taps', 'study_dispute_backs',
                               'study_aid_authors', 'study_aid_votes', 'study_pulse_optout', 'study_my_cards', 'study_loot', 'study_traps')),
                 'study_aids, study_disputes, study_edit_proposals, study_group_plans, study_meetings, study_slide_flags');
select rv.expect('FR-reg', (select string_agg(section || '=' || version, ' ' order by section) from study_private.schema_sections),
                 'A=1 B=1 C=2 E=1 F=1 G=1 H=1 J=1 K=2 M=1 N=1 P=2 Q=2 T=1 U=1 V=1 W=1 Z=2');
\echo '== FR done'

-- ════════════════════════════════════════════════════════════════════════
--  The meeting addendum's lines in study_private.merge_users (section A,
--  edits/apply.py): a device's member folds into the account with rows in
--  every new table, both of them holding a row where only one may stay
--  (A-9's collisions), and nothing is left behind. Same session, last.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
insert into auth.users (id, raw_user_meta_data) values
 ('3c000000-0000-4000-8000-00000000000a', '{"app":"study","full_name":"שוהם טלפון"}'),
 ('3c000000-0000-4000-8000-00000000000b', '{"app":"study","full_name":"שוהם חשבון"}');
insert into public.study_members (group_id, user_id, name) values
 (:'gid', '3c000000-0000-4000-8000-00000000000a', 'שוהם (טלפון)'), (:'gid', '3c000000-0000-4000-8000-00000000000b', 'שוהם (חשבון)');
select id as mid from public.study_meetings where cancelled_at is null and day = study_private.day_of(now()) limit 1 \gset
select id as did from public.study_disputes order by created_at limit 1 \gset
select id as eid from public.study_edits order by created_at limit 1 \gset
-- Both users hold a row in each table where one must stay.
insert into public.study_meeting_taps (meeting_id, user_id, lecture_id, part_idx, anchor)
select :'mid', u, '3c100000-0000-4000-8000-000000000001', 0, 1 from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.study_meeting_taps (meeting_id, user_id, lecture_id, part_idx, anchor)
values (:'mid', '3c000000-0000-4000-8000-00000000000a', '3c100000-0000-4000-8000-000000000001', 1, 1);
insert into public.study_meeting_presence (meeting_id, user_id, first_at, last_at) values
 (:'mid', '3c000000-0000-4000-8000-00000000000a', now() - interval '2 hours', now() - interval '1 hour'),
 (:'mid', '3c000000-0000-4000-8000-00000000000b', now() - interval '1 hour', now());
insert into public.study_meeting_guess_answers (meeting_id, question_id, user_id, choice)
select :'mid', '3c2a0000-0000-4000-8000-000000000004', u, 1 from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.study_meeting_catchups (meeting_id, user_id)
select '3c6a0000-0000-4000-8000-000000000001', u from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.study_dispute_backs (dispute_id, user_id, side)
select :'did', u, 'a' from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.study_updates (user_id, edit_id, lecture_id, part_idx, anchor, reason, reason_at)
select u, :'eid', '3c100000-0000-4000-8000-000000000001', 1, 1, 'question', now() from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.study_member_prefs (user_id, group_id, needs_me)
select u, :'gid', u = '3c000000-0000-4000-8000-00000000000a' from unnest(array['3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b']::uuid[]) u;
-- And the columns that only point at a person.
update public.study_meetings set planned_reader = '3c000000-0000-4000-8000-00000000000a' where id = :'mid';
insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, created_by)
values (:'mid', 'continue', 2, 2, '3c000000-0000-4000-8000-00000000000a');
insert into public.study_slide_flags (lecture_id, slides, note, created_by) values ('3c100000-0000-4000-8000-000000000001', array[29], 'pyridine במקום pyrimidine', '3c000000-0000-4000-8000-00000000000a');
update public.study_questions set checked_by = '3c000000-0000-4000-8000-00000000000a' where id = '3c2a0000-0000-4000-8000-000000000008';
update public.study_cards set checked_by = '3c000000-0000-4000-8000-00000000000a' where id = '3c3a0000-0000-4000-8000-000000000001';
update public.study_edit_proposals set proposed_by = '3c000000-0000-4000-8000-00000000000a'
 where id = (select id from public.study_edit_proposals where state = 'pending' order by created_at limit 1);

select study_private.merge_users('3c000000-0000-4000-8000-00000000000a', '3c000000-0000-4000-8000-00000000000b') is null as merged \gset
select 'MG1. merged with a row on both sides in every new table: no collision' as r;
select 'MG2. left behind under the device''s id: ' ||
       (select count(*) from public.study_meeting_taps where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_meeting_presence where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_meeting_guess_answers where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_meeting_catchups where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_dispute_backs where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_updates where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_member_prefs where user_id = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_meetings where planned_reader = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_meeting_events where created_by = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_slide_flags where created_by = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_questions where checked_by = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_cards where checked_by = '3c000000-0000-4000-8000-00000000000a')
     + (select count(*) from public.study_edit_proposals where proposed_by = '3c000000-0000-4000-8000-00000000000a')
       || ' (expect 0)';
select 'MG3. the account kept one of each: taps ' || (select count(*) from public.study_meeting_taps where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ' (the shared paragraph once, and the device''s other one), presence from '
       || (select (now() - first_at) > interval '90 minutes' from public.study_meeting_presence where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ' (the earlier start), guesses ' || (select count(*) from public.study_meeting_guess_answers where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ', catch-ups ' || (select count(*) from public.study_meeting_catchups where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ', backing ' || (select count(*) from public.study_dispute_backs where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ', updates ' || (select count(*) from public.study_updates where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ', prefs ' || (select count(*) from public.study_member_prefs where user_id = '3c000000-0000-4000-8000-00000000000b')
       || ' (expect 2, true, 1, 1, 1, 1, 1)';
select 'MG4. ' || coalesce('FAIL: not merged: ' || string_agg(t || '.' || col, ', '), 'ok: every user column of the addendum''s tables is merged')
from (
  select format('%I.%I', n.nspname, c.relname) as t, a.attname as col
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
  where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
    and n.nspname = 'public'
    and c.relname in ('study_meetings', 'study_meeting_taps', 'study_meeting_events', 'study_meeting_presence', 'study_meeting_guess_answers',
                      'study_meeting_catchups', 'study_disputes', 'study_dispute_backs', 'study_slide_flags', 'study_updates', 'study_member_prefs',
                      'study_edit_proposals', 'study_edits', 'study_questions', 'study_cards')
    and position(format('update %I.%I set %I = dst', n.nspname, c.relname, a.attname)
                 in (select p.prosrc from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                      where pn.nspname = 'study_private' and p.proname = 'merge_users')) = 0
) missing;
select 'MG5. what anon may call is still only the allow-list: ' || coalesce('FAIL: ' || string_agg(p.proname, ', ' order by p.proname), 'ok')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'study\_%' and has_function_privilege('anon', p.oid, 'execute')
   and p.proname not in ('study_claim', 'study_progress', 'study_finish', 'study_outline_done', 'study_writing_input',
                         'study_reserve', 'study_settle', 'study_spent', 'study_feature_on', 'study_features', 'study_schema', 'study_email_allowed',
                         'study_is_member', 'study_lecture_group', 'study_is_member_path',
                         'study_bank_take', 'study_bank_input', 'study_bank_report', 'study_bank_save', 'study_bank_finish');
select 'MG6. the registry with the addendum: ' || public.study_schema()::text
       || ' (expect A 1, B 1, C 2, E 1, F 1, G 1, H 1, J 1, K 2, M 1, N 1, P 2, Q 2, T 1, U 1, V 1, W 1, Z 2)';

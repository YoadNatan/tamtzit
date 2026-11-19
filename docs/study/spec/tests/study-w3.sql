-- Behaviour test for study-schema.sql (and its patch to /board's trigger).
-- On a throwaway local Postgres (never on the real project):
--   createdb studytest
--   psql -d studytest -f supabase/tests/stubs.sql
--   psql -d studytest -f supabase/board-schema.sql
--   psql -d studytest -f supabase/study-schema.sql
--   psql -d studytest -f supabase/tests/study.sql
-- Every numbered line should read "ok" or the expected value; "FAIL" means a
-- rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
insert into auth.users (id, email, raw_user_meta_data) values
 ('aaaaaaaa-0000-4000-8000-000000000001', 'teacher@x', '{"full_name":"מורה"}'),
 ('bbbbbbbb-0000-4000-8000-000000000002', null, '{"app":"study","full_name":"שוהם"}'),
 ('cccccccc-0000-4000-8000-000000000003', null, '{"app":"study","full_name":"נועה"}'),
 ('dddddddd-0000-4000-8000-000000000004', null, '{"app":"study","full_name":"זר"}');
select '1. board_teachers rows = ' || count(*) || ' (expect 1: only the non-study user)' from public.board_teachers;

set role authenticated;
-- Shoham opens a group
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select id as gid, join_code as code from public.study_create_group('קבוצת שנה ג', 'שוהם') \gset
select '2. group created, code length ' || length(:'code');
insert into public.study_lectures (id, group_id, title, source_kind, slides)
values ('eeeeeeee-0000-4000-8000-000000000005', :'gid', 'Anti parasite', 'pptx', '[]'::jsonb);
select '3. Shoham added a lecture';

-- Noa: wrong code, then the right one
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_join('XXXXXX', 'נועה'); raise notice '4. FAIL: wrong code accepted';
exception when others then if sqlerrm = 'wrong code' then raise notice '4. ok: wrong code rejected'; else raise notice '4. FAIL: rejected for another reason: %', sqlerrm; end if; end $$;
select '5. Noa joined: ' || name from public.study_join(:'code', 'נועה');
do $$ begin perform public.study_create_group('קבוצה שנייה', 'נועה'); raise notice '5b. FAIL: a second group was opened';
exception when others then if sqlerrm = 'groups closed' then raise notice '5b. ok: a second group is refused'; else raise notice '5b. FAIL: refused for another reason: %', sqlerrm; end if; end $$;
select '6. Noa sees ' || count(*) || ' lecture(s) (expect 1)' from public.study_lectures;
do $$ begin update public.study_members set group_id = gen_random_uuid() where user_id = auth.uid(); raise notice '7. FAIL: member moved own row to another group';
exception when others then raise notice '7. ok: moving to another group refused (%)', sqlerrm; end $$;
update public.study_members set name = 'נועה כהן' where user_id = auth.uid();
select '8. Noa renamed herself: ' || name from public.study_members where user_id = auth.uid();
do $$ begin update public.study_lectures set created_by = auth.uid(); raise notice '9. FAIL: author rewritten';
exception when others then raise notice '9. ok: author cannot be rewritten (%)', sqlerrm; end $$;
do $$ begin update public.study_lectures set status = 'ready' where id = 'eeeeeeee-0000-4000-8000-000000000005'; raise notice '10. FAIL: a member changed the writing state';
exception when insufficient_privilege then raise notice '10. ok: the writing state changes only through the RPCs (W2)'; end $$;
reset role;
update public.study_lectures set status = 'ready' where id = 'eeeeeeee-0000-4000-8000-000000000005';
set role authenticated;
do $$ begin update public.study_groups set join_code = 'HACKED'; raise notice '11. FAIL: join code changed';
exception when others then raise notice '11. ok: join code is read-only (%)', sqlerrm; end $$;
do $$ begin insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 'x', 1, 8); raise notice '12. FAIL: a member wrote a section';
exception when insufficient_privilege then raise notice '12. ok: parts are written only through the RPCs (W2)'; end $$;
reset role;
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 'חלק א', 1, 8);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('study', :'gid' || '/eeeeeeee-0000-4000-8000-000000000005/s1-1.jpg');
select '13. Noa uploaded a picture';
delete from public.study_members where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select '14. Noa tried to remove Shoham; Shoham still a member: ' || count(*) from public.study_members where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- A stranger with an account but no code
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select '15. stranger sees ' || count(*) || ' lectures, ' || (select count(*) from public.study_sections) || ' sections, ' || (select count(*) from public.study_members) || ' members, ' || (select count(*) from storage.objects) || ' files (expect all 0)' from public.study_lectures;
select '16. stranger asks for the code: ' || coalesce(public.study_group_code(:'gid'), 'NULL (expect NULL)');
do $$ begin insert into public.study_lectures (group_id, title, source_kind, slides) values ((select id from public.study_groups limit 1), 'x', 'pdf', '[]'); raise notice '17. stranger insert: no group visible, nothing inserted';
exception when others then raise notice '17. ok: stranger cannot add a lecture (%)', sqlerrm; end $$;
do $$ begin insert into public.study_lectures (group_id, title, source_kind, slides) values ('ffffffff-0000-4000-8000-000000000000', 'x', 'pdf', '[]'); raise notice '18. FAIL: stranger added a lecture';
exception when others then raise notice '18. ok: stranger cannot add a lecture to a group by id (%)', sqlerrm; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('study', 'not-a-uuid/x.jpg'); raise notice '19. FAIL: malformed path accepted';
exception when others then raise notice '19. ok: malformed path refused without a crash (%)', sqlerrm; end $$;
do $$ begin insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('eeeeeeee-0000-4000-8000-000000000005', 1, 'x', 1, 2); raise notice '20. FAIL: stranger wrote a section';
exception when others then raise notice '20. ok: stranger cannot write a section (%)', sqlerrm; end $$;
update public.study_lectures set title = 'pwned';

-- Studying together: who read what, and comments on paragraphs
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
insert into public.study_reads (lecture_id) values ('eeeeeeee-0000-4000-8000-000000000005');
insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body) values
 ('eeeeeeee-0000-4000-8000-000000000005', 0, 3, 'Metronidazole היא', 'question', 'למה התרופה לא פועלת בתאים אירוביים?');
-- The question's id comes from the database; later checks read it from a setting.
select set_config('t.qid', (select id::text from public.study_comments where body like 'למה התרופה%'), false) is not null as have_qid \gset
insert into public.study_lectures (id, group_id, title, source_kind, slides)
 values ('eeeeeeee-0000-4000-8000-000000000006', :'gid', 'הרצאה שנייה', 'pdf', '[]');
select 'G1. Shoham marked the lecture read and asked a question';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'G2. Noa sees ' || count(*) || ' read mark(s) and ' || (select count(*) from public.study_comments) || ' comment(s) (expect 1 and 1)' from public.study_reads;
insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id) values
 ('eeeeeeee-0000-4000-8000-000000000005', 0, 3, 'comment', 'כי החמצן מחמצן את הרדיקל בחזרה', current_setting('t.qid')::uuid);
select 'G3. Noa replied in the thread';
update public.study_comments set resolved = true where id = current_setting('t.qid')::uuid;
select 'G4. Noa marked the question answered: ' || resolved from public.study_comments where id = current_setting('t.qid')::uuid;
do $$ begin update public.study_comments set body = 'נערך' where id = current_setting('t.qid')::uuid; raise notice 'G5. FAIL: Noa rewrote Shoham''s question';
exception when others then raise notice 'G5. ok: nobody rewrites a comment (%)', sqlerrm; end $$;
delete from public.study_comments where id = current_setting('t.qid')::uuid;
select 'G6. Noa tried to delete Shoham''s question; still there: ' || count(*) || ' (expect 1)' from public.study_comments where id = current_setting('t.qid')::uuid;
do $$ begin insert into public.study_reads (lecture_id, user_id) values ('eeeeeeee-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000002'); raise notice 'G7. FAIL: Noa marked a lecture read for Shoham';
exception when insufficient_privilege then raise notice 'G7. ok: a read mark is only for yourself (%)', sqlerrm;
  when others then raise notice 'G7. FAIL: refused for another reason: %', sqlerrm; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, body, created_at) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 1, 'x', '2000-01-01'); raise notice 'G7b. FAIL: a comment was backdated';
exception when insufficient_privilege then raise notice 'G7b. ok: ids, authors and dates are not the client''s to set (%)', sqlerrm;
  when others then raise notice 'G7b. FAIL: refused for another reason: %', sqlerrm; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, body, author_id) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 1, 'x', 'bbbbbbbb-0000-4000-8000-000000000002'); raise notice 'G8. FAIL: Noa posted as Shoham';
exception when others then raise notice 'G8. ok: you cannot post as someone else (%)', sqlerrm; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, body, parent_id) values ('eeeeeeee-0000-4000-8000-000000000006', 0, 0, 'x', current_setting('t.qid')::uuid); raise notice 'G9. FAIL: a reply crossed into another lecture';
exception when others then raise notice 'G9. ok: a reply stays in its parent''s lecture (%)', sqlerrm; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, body) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 1, '   '); raise notice 'G10. FAIL: an empty comment was saved';
exception when others then raise notice 'G10. ok: an empty comment is refused (%)', sqlerrm; end $$;
-- The private reading channel: members of the lecture's group only
reset role;
insert into realtime.messages (topic, extension, payload) values ('study-read-eeeeeeee-0000-4000-8000-000000000005', 'presence', '{}');
set role authenticated;
set realtime.topic = 'study-read-eeeeeeee-0000-4000-8000-000000000005';
select 'R1. Noa hears ' || count(*) || ' presence message(s) on the reading channel (expect 1)' from realtime.messages;
insert into realtime.messages (topic, extension, payload) values ('study-read-eeeeeeee-0000-4000-8000-000000000005', 'presence', '{}');
select 'R2. Noa can send presence on it';
set realtime.topic = 'study-read-not-a-uuid';
select 'R3. a malformed channel name gives ' || count(*) || ' (expect 0, and no error)' from realtime.messages;
set realtime.topic = 'study-read-eeeeeeee-0000-4000-8000-000000000005';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'R4. stranger hears ' || count(*) || ' on the reading channel (expect 0)' from realtime.messages;
do $$ begin insert into realtime.messages (topic, extension, payload) values ('study-read-eeeeeeee-0000-4000-8000-000000000005', 'presence', '{}'); raise notice 'R5. FAIL: stranger sent presence on the reading channel';
exception when insufficient_privilege then raise notice 'R5. ok: stranger cannot send on it (%)', sqlerrm; end $$;
reset realtime.topic;
select 'G11. stranger sees ' || count(*) || ' read marks and ' || (select count(*) from public.study_comments) || ' comments (expect 0 and 0)' from public.study_reads;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, body) values ('eeeeeeee-0000-4000-8000-000000000005', 0, 0, 'x'); raise notice 'G12. FAIL: stranger commented';
exception when others then raise notice 'G12. ok: stranger cannot comment (%)', sqlerrm; end $$;
do $$ begin insert into public.study_reads (lecture_id) values ('eeeeeeee-0000-4000-8000-000000000005'); raise notice 'G13. FAIL: stranger marked a lecture read';
exception when others then raise notice 'G13. ok: stranger cannot mark a lecture read (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
delete from public.study_comments where id = current_setting('t.qid')::uuid;
select 'G14. Shoham deleted her question; thread left: ' || count(*) || ' (expect 0: replies go with it)' from public.study_comments;

-- Not signed in at all
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ declare n int; begin select count(*) into n from public.study_lectures; raise notice '22. anon sees % lectures (expect 0)', n;
exception when insufficient_privilege then raise notice '22. ok: anon has no access at all (%)', sqlerrm; end $$;
do $$ declare n int; begin select count(*) into n from public.study_comments; raise notice 'G15. anon sees % comments (expect 0)', n;
exception when insufficient_privilege then raise notice 'G15. ok: anon cannot read comments (%)', sqlerrm; end $$;
do $$ declare n int; begin select count(*) into n from public.study_reads; raise notice 'G16. anon sees % read marks (expect 0)', n;
exception when insufficient_privilege then raise notice 'G16. ok: anon cannot read read marks (%)', sqlerrm; end $$;
reset role;
select '23. title after all that: ' || title from public.study_lectures;

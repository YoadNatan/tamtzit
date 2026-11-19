-- ════════════════════════════════════════════════════════════════════════
--  MS: saving the account keeps everything (decision 12). A second device
--  of Noa's, used before she saved her account, folds into the account:
--  its adoptions, private cards and their reviews, its trap draft, its
--  plan edits and its "answered" marks move; collisions keep one row.
-- ════════════════════════════════════════════════════════════════════════
reset role;
insert into auth.users (id, raw_user_meta_data, is_anonymous) values ('a1000000-0000-4000-8000-000000000007', '{"app":"study","full_name":"נועה טלפון"}', true);
insert into public.study_members (group_id, user_id, name) values (:'g', 'a1000000-0000-4000-8000-000000000007', 'נועה טלפון');
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';   -- the account: part 0 in her deck
select public.study_card_adopt(:'l1', array[0], true) is not null as ms0;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000007';   -- the device: parts 0 and 2, a miss, a review, a trap
select public.study_card_adopt(:'l1', array[0, 2], true) is not null as ms0b;
select (public.study_answer_question('a4000000-0000-4000-8000-000000000001', 0, 'lecture', null, 3)).correct as ms0c;
select id as dc from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000001' \gset
select public.study_my_card_review('a6000000-0000-4000-8000-000000000071', :'dc', 3, now(), 2000, 0,
  jsonb_build_object('state', 1, 'step', 0, 'stability', 2.3, 'difficulty', 5.1, 'due', now() + interval '10 minutes', 'lapses', 0)) as ms0d;
select public.study_trap_submit(null, :'l1', 2, 1, '', '', 'עם מה Artemisinins?', array['שותף ארוך טווח', 'לבד', 'אלכוהול', 'חלב'], 0, '', array[30]) is not null as ms0e;
update public.study_comments set resolved = true where body like 'הבנתי שצריך שותף%';
reset role;
select study_private.merge_users('a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000002');
select 'MS1. her deck: ' || (select array_agg(part_idx order by part_idx) from public.study_card_adoptions
                             where user_id = 'a1000000-0000-4000-8000-000000000002' and lecture_id = :'l1')::text || ' (expect {0,2})';
select 'MS2. her card for 01: ' || count(*) || ', the device''s (reviewed once) stayed: ' || bool_and(id = :'dc') || ', reviews ' ||
       (select count(*) from public.study_my_card_reviews where user_id = 'a1000000-0000-4000-8000-000000000002') || ' (expect 1, true, 1)'
  from public.study_my_cards where user_id = 'a1000000-0000-4000-8000-000000000002' and question_id = 'a4000000-0000-4000-8000-000000000001';
select 'MS3. left on the device: ' ||
       (select count(*) from public.study_card_adoptions where user_id = 'a1000000-0000-4000-8000-000000000007') +
       (select count(*) from public.study_my_cards where user_id = 'a1000000-0000-4000-8000-000000000007') +
       (select count(*) from public.study_my_card_reviews where user_id = 'a1000000-0000-4000-8000-000000000007') +
       (select count(*) from public.study_trap_drafts where user_id = 'a1000000-0000-4000-8000-000000000007') +
       (select count(*) from public.study_comments where resolved_by = 'a1000000-0000-4000-8000-000000000007') || ' row(s) (expect 0)';
select 'MS4. ' || coalesce('FAIL: not merged: ' || string_agg(t || '.' || col, ', '), 'ok: every user column of this addendum''s tables is merged')
from (
  select format('%I.%I', n.nspname, c.relname) as t, a.attname as col
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
   where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
     and (c.relname in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews', 'study_group_plans', 'study_trap_drafts', 'bank_jobs')
          or (c.relname = 'study_questions' and a.attname in ('fixed_by', 'author_id'))
          or (c.relname = 'study_comments' and a.attname = 'resolved_by'))
     and position(format('update %I.%I set %I = dst', n.nspname, c.relname, a.attname)
                  in (select p.prosrc from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                       where pn.nspname = 'study_private' and p.proname = 'merge_users')) = 0
) missing;
select 'MS5. this addendum''s user columns: ' || count(*) || ' (expect 10)'
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
 where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
   and (c.relname in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews', 'study_group_plans', 'study_trap_drafts', 'bank_jobs')
        or (c.relname = 'study_questions' and a.attname in ('fixed_by', 'author_id'))
        or (c.relname = 'study_comments' and a.attname = 'resolved_by'));
select 'MS6. registry: ' || (select string_agg(section || '=' || version, ' ' order by section) from study_private.schema_sections)
       || ' (expect B=1 C=2 E=1 G=1 K=2 P=2 Q=2 among them)';

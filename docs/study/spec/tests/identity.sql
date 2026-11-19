-- ════════════════════════════════════════════════════════════════════════
--  SECTION A checks · identity: tickets, the merge, ghosts (its own database: it creates a group)   (package A)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for block A (me-identity.sql), on the repo's
-- schema ALONE: identity ships before any private feature. Load order:
--   stubs.sql (+ auth.jwt() and two auth.users columns, as proposed for
--   supabase/tests/stubs.sql), board-schema.sql, study-schema.sql x2,
--   me-identity.sql x2, then this file. Every I line reads "ok" or the
--   expected value; "FAIL" means a rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
 ('11111111-0000-4000-8000-000000000001', null, '{"app":"study","full_name":"שוהם"}', true),  -- phone (Home Screen app)
 ('22222222-0000-4000-8000-000000000002', null, '{"app":"study","full_name":"שוהם"}', true),  -- laptop
 ('33333333-0000-4000-8000-000000000003', null, '{"app":"study","full_name":"נועה"}', true),
 ('55555555-0000-4000-8000-000000000005', null, '{"app":"study","full_name":"שוהם"}', true);  -- an old phone, gone (a ghost)

set role authenticated;
set request.jwt.claim.sub = '11111111-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","is_anonymous":true}';
select id as gid, join_code as code from public.study_create_group('קבוצה', 'שוהם') \gset
select set_config('t.code', :'code', false) is not null as have_code \gset
insert into public.study_lectures (id, group_id, title, source_kind, slides)
values ('eeeeeeee-0000-4000-8000-000000000001', :'gid', 'L1', 'pptx', '[]');
insert into public.study_reads (lecture_id) values ('eeeeeeee-0000-4000-8000-000000000001');
set request.jwt.claim.sub = '22222222-0000-4000-8000-000000000002';
set request.jwt.claims = '{"sub":"22222222-0000-4000-8000-000000000002","is_anonymous":true}';
do $$ begin perform public.study_join(current_setting('t.code'), 'שוהם'); raise notice 'I0a. FAIL: a second "שוהם" joined';
exception when others then raise notice 'I0a. %: a name already in the group is refused; the laptop picks another (%)', case when sqlerrm = 'name taken' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'I0. laptop joined ' || name from public.study_join(:'code', 'שוהם (מחשב)');
insert into public.study_lectures (id, group_id, title, source_kind, slides)
values ('eeeeeeee-0000-4000-8000-000000000002', :'gid', 'L2', 'pdf', '[]');
insert into public.study_reads (lecture_id) values ('eeeeeeee-0000-4000-8000-000000000001'), ('eeeeeeee-0000-4000-8000-000000000002');
insert into public.study_comments (lecture_id, part_idx, anchor, kind, body)
values ('eeeeeeee-0000-4000-8000-000000000001', 0, 0, 'question', 'מהלפטופ');
set request.jwt.claim.sub = '33333333-0000-4000-8000-000000000003';
set request.jwt.claims = '{"sub":"33333333-0000-4000-8000-000000000003","is_anonymous":true}';
select 'I0b. Noa joined ' || name from public.study_join(:'code', 'נועה');
insert into public.study_comments (lecture_id, part_idx, anchor, body) values ('eeeeeeee-0000-4000-8000-000000000001', 0, 1, 'של נועה');
set request.jwt.claim.sub = '55555555-0000-4000-8000-000000000005';
set request.jwt.claims = '{"sub":"55555555-0000-4000-8000-000000000005","is_anonymous":true}';
select 'I0c. the old phone joined ' || name from public.study_join(:'code', 'שוהם (טלפון ישן)');
insert into public.study_comments (lecture_id, part_idx, anchor, body) values ('eeeeeeee-0000-4000-8000-000000000001', 0, 2, 'מהטלפון הישן');
select 'I0d. members before: ' || count(*) || ' (expect 4: שוהם, her laptop and old phone under their own names, נועה)' from public.study_members;

-- The laptop asks for a ticket before signing in.
set request.jwt.claim.sub = '22222222-0000-4000-8000-000000000002';
set request.jwt.claims = '{"sub":"22222222-0000-4000-8000-000000000002","is_anonymous":true}';
select public.study_merge_offer() as ticket \gset
select 'I1. ticket length ' || length(:'ticket') || ' (expect 64)';
do $$ begin perform count(*) from study_private.merge_tickets; raise notice 'I2. FAIL: tickets readable';
exception when insufficient_privilege then raise notice 'I2. ok: tickets are out of the API''s reach (%)', sqlerrm; end $$;
do $$ begin perform study_private.merge_users('22222222-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000003'); raise notice 'I2b. FAIL: a member called merge_users';
exception when insufficient_privilege then raise notice 'I2b. ok: only the definer functions and the SQL editor can merge (%)', sqlerrm; end $$;

-- Noa, still anonymous, cannot redeem it.
set request.jwt.claim.sub = '33333333-0000-4000-8000-000000000003';
set request.jwt.claims = '{"sub":"33333333-0000-4000-8000-000000000003","is_anonymous":true}';
select set_config('t.ticket', :'ticket', false) is not null as kept \gset
do $$ begin perform public.study_merge_claim(current_setting('t.ticket')); raise notice 'I3. FAIL';
exception when others then raise notice 'I3. %: an anonymous caller cannot redeem (%)', case when sqlerrm = 'sign in first' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- The phone saved its account (Supabase Auth sets the email and is_anonymous
-- false on verifyOtp email_change); the laptop then signs in to it.
reset role;
update auth.users set email = 'shoham@example.com', is_anonymous = false where id = '11111111-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '11111111-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","is_anonymous":false}';
do $$ begin perform public.study_merge_offer(); raise notice 'I4. FAIL: a saved account offered itself';
exception when others then raise notice 'I4. %: a saved account cannot be merged away (%)', case when sqlerrm = 'not anonymous' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_merge_claim('wrong'); raise notice 'I5. FAIL';
exception when others then raise notice 'I5. %: a wrong ticket is refused (%)', case when sqlerrm = 'ticket not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_merge_claim(current_setting('t.ticket')); raise notice 'I5b. FAIL: merged without confirming the device''s member';
exception when others then raise notice 'I5b. %: without the device member''s name nothing moves (%)', case when sqlerrm = 'confirm name' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_merge_claim(current_setting('t.ticket'), 'נועה'); raise notice 'I5c. FAIL: merged under another member''s name';
exception when others then raise notice 'I5c. %: a name that is not the device''s is refused (%)', case when sqlerrm = 'confirm name' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'I6. confirmed "זה החשבון שלי": claim returns ' || public.study_merge_claim(:'ticket', ' שוהם (מחשב) ') || ' (expect 1; the ticket survived the refusals)';
select 'I7. members: ' || string_agg(name || '=' || left(user_id::text, 8), ', ' order by name, user_id) || ' (expect נועה=33333333, שוהם=11111111, שוהם (טלפון ישן)=55555555)' from public.study_members;
select 'I8. read marks: ' || string_agg(left(user_id::text, 8) || ':' || right(lecture_id::text, 1), ', ' order by lecture_id) || ' (expect 11111111:1, 11111111:2)' from public.study_reads;
select 'I9. L2 uploaded by ' || left(created_by::text, 8) || ' (expect 11111111)' from public.study_lectures where title = 'L2';
do $$ begin perform public.study_merge_claim(current_setting('t.ticket')); raise notice 'I10. FAIL: a ticket was used twice';
exception when others then raise notice 'I10. %: a ticket works once (%)', case when sqlerrm = 'ticket not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- A ticket of the account itself (offered while it was still anonymous) changes nothing.
reset role;
insert into study_private.merge_tickets (token_hash, from_user)
values (encode(sha256(convert_to('own-ticket', 'UTF8')), 'hex'), '11111111-0000-4000-8000-000000000001');
set role authenticated;
select 'I11. own ticket returns ' || public.study_merge_claim('own-ticket') || ' (expect 0)';

-- An expired ticket.
set request.jwt.claim.sub = '33333333-0000-4000-8000-000000000003';
set request.jwt.claims = '{"sub":"33333333-0000-4000-8000-000000000003","is_anonymous":true}';
select set_config('t.old', public.study_merge_offer(), false) is not null as kept \gset
reset role;
update study_private.merge_tickets set created_at = now() - interval '31 minutes';
set role authenticated;
set request.jwt.claim.sub = '11111111-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","is_anonymous":false}';
do $$ begin perform public.study_merge_claim(current_setting('t.old')); raise notice 'I12. FAIL: an expired ticket was accepted';
exception when others then raise notice 'I12. %: a ticket expires after 30 minutes (%)', case when sqlerrm = 'ticket not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- A ghost (the old phone is gone): Yoad folds it into the account from the SQL editor.
reset role;
select 'I13. preview: ' || string_agg(m.name || ' ' || left(m.user_id::text, 8) || ' anonymous=' || u.is_anonymous, '; ' order by m.name, m.user_id)
  from public.study_members m join auth.users u on u.id = m.user_id where m.group_id = :'gid';
select study_private.merge_users('55555555-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000001');
select 'I14. after the fold: ' || string_agg(name, ', ' order by name) || ' (expect נועה, שוהם)' from public.study_members;
reset role;
select 'I15a. the merge is logged: ' || string_agg(left(src::text, 8) || '→' || left(dst::text, 8) || ' ' || src_names, '; ') || ' (expect 22222222→11111111 שוהם (מחשב))' from study_private.merge_log;
select 'I15. comment authors: ' || string_agg(body || '=' || left(author_id::text, 8), ', ' order by body) || ' (expect מהטלפון הישן=11111111, מהלפטופ=11111111, של נועה=33333333)' from public.study_comments;

-- Every user column of every study table is in merge_users (here: the repo's).
select 'I16. user columns checked: ' || count(*) || ' (grows with each section: 7 with F and A, 39 with every section; I17 is the guard)'
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
 where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
   and ((n.nspname = 'public' and c.relname like 'study\_%') or n.nspname = 'study_private')
   and not (n.nspname = 'study_private' and c.relname = 'merge_tickets');
select 'I17. ' || coalesce('FAIL: not merged: ' || string_agg(t || '.' || col, ', '), 'ok: every user column of every study table is merged')
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
-- The safe clean-up preview (research-auth §3): anonymous study users older
-- than 30 days that own nothing. The two merged-away devices qualify once old.
update auth.users set created_at = now() - interval '40 days' where id in ('22222222-0000-4000-8000-000000000002', '55555555-0000-4000-8000-000000000005');
select 'I18. clean-up would delete: ' || coalesce(string_agg(left(u.id::text, 8), ', ' order by u.id), 'nobody') || ' (expect 22222222, 55555555)'
  from auth.users u
 where u.is_anonymous and u.raw_user_meta_data ->> 'app' = 'study' and u.created_at < now() - interval '30 days'
   and not exists (select 1 from public.study_members m where m.user_id = u.id)
   and not exists (select 1 from public.study_groups g where g.created_by = u.id)
   and not exists (select 1 from public.study_lectures l where l.created_by = u.id)
   and not exists (select 1 from public.study_reads r where r.user_id = u.id)
   and not exists (select 1 from public.study_comments c where c.author_id = u.id);
-- Review M5: the Send Email hook's question (the hook holds the server key)
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
update auth.users set email_confirmed_at = now() where id = '11111111-0000-4000-8000-000000000001';
insert into auth.users (id, email, is_anonymous) values ('99999999-0000-4000-8000-000000000009', 'victim@example.com', false);
set role anon;
do $$ begin perform public.study_email_allowed('11111111-0000-4000-8000-000000000001', 'magiclink'); raise notice 'I20. FAIL: the hook question answered without the key';
exception when others then raise notice 'I20. %: only the hook (with the key) asks (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'I20b. a sign-in code for Shoham''s saved account: ' || public.study_email_allowed('11111111-0000-4000-8000-000000000001', 'magiclink', 'k-0123456789abcdef0123456789abcdef') || ' (expect ok)';
select 'I20c. a "signup" mail: ' || public.study_email_allowed('11111111-0000-4000-8000-000000000001', 'signup', 'k-0123456789abcdef0123456789abcdef') || ' (expect refused)';
select 'I20d. a code for someone outside every group: ' || public.study_email_allowed('99999999-0000-4000-8000-000000000009', 'email_change', 'k-0123456789abcdef0123456789abcdef') || ' (expect refused)';
select 'I20e. a sign-in code for an unconfirmed member: ' || public.study_email_allowed('33333333-0000-4000-8000-000000000003', 'magiclink', 'k-0123456789abcdef0123456789abcdef') || ' (expect refused)';
select public.study_email_allowed('33333333-0000-4000-8000-000000000003', 'email_change', 'k-0123456789abcdef0123456789abcdef') from generate_series(1, 6);
select 'I20f. a 7th code in a day: ' || public.study_email_allowed('33333333-0000-4000-8000-000000000003', 'email_change', 'k-0123456789abcdef0123456789abcdef') || ' (expect limit)';
reset role;
set role anon;
do $$ begin perform public.study_merge_offer(); raise notice 'I19. FAIL: anon offered';
exception when insufficient_privilege then raise notice 'I19. ok: signed-out visitors cannot call it (%)', sqlerrm; end $$;
reset role;

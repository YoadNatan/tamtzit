-- ════════════════════════════════════════════════════════════════════════
--  W2 checks (package W, with the hardening loaded). Run after study.sql
--  (W2 turns its checks 10 and 12 into refusals: tests/study-w3.sql) and the F
--  and W checks.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin update public.study_sections set markdown = 'x'; raise notice 'H1. FAIL: a member wrote a part directly';
exception when insufficient_privilege then raise notice 'H1. ok: parts change only through study_progress/study_finish'; end $$;
do $$ begin insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('eeeeeeee-0000-4000-8000-000000000005', 7, 'x', 1, 2); raise notice 'H1b. FAIL: a member added a part';
exception when insufficient_privilege then raise notice 'H1b. ok: parts are added only by study_outline_done'; end $$;
do $$ begin delete from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000005'; raise notice 'H1c. FAIL: a member deleted a part';
exception when insufficient_privilege then raise notice 'H1c. ok: no member deletes a part (a correction''s history stays)'; end $$;
do $$ begin update public.study_lectures set status = 'ready', outline = '[]'; raise notice 'H1d. FAIL: a member changed the writing state';
exception when insufficient_privilege then raise notice 'H1d. ok: a lecture''s writing state changes only through the RPCs'; end $$;
update public.study_lectures set title = 'Anti parasite' where id = 'eeeeeeee-0000-4000-8000-000000000005';
select 'H1e. a member still renames a lecture: ' || title from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-000000000005';
reset role;
select 'H2. the registry: W ' || (public.study_schema() ->> 'W') || ' (expect 2)';

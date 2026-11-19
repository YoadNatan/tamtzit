-- ════════════════════════════════════════════════════════════════════════
--  SECTION F checks (package F). Runs in the same psql session right after the
--  existing checks of supabase/tests/study.sql: Shoham (bbbb…), Noa (cccc…),
--  the stranger (dddd…), the group :gid and lecture eeee…0005 exist.
--  Every F line reads "ok" or the expected value.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
select set_config('t.gid', :'gid', false) is not null as have_gid \gset
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset

-- F1: the columns the client reads exist and start empty
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'F1. Noa reads the new part columns on ' || count(*) || ' part(s): lease ' || bool_and(lease_until is null) || ', attempts ' || sum(attempts)
       || ', retry ' || bool_and(retry_at is null) || ', writer ' || bool_and(writer is null) || ', rev ' || sum(rev) || ', gen ' || sum(gen)
       || ' (expect 1 part(s): true, 0, true, true, 0, 0)'
  from public.study_sections;
select 'F1b. and the lectures'' queued_at: ' || bool_and(queued_at is null) || ' (expect true)' from public.study_lectures;

-- F2-F10: the ledger
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_spent(:'gid') as f_before \gset
select 'F2. spent this month before any charge: $' || :'f_before' || ' (expect 0)';
do $$ begin perform count(*) from public.study_usage; raise notice 'F3. FAIL: a member reads the ledger rows';
exception when insufficient_privilege then raise notice 'F3. ok: ledger rows are not readable (who practised how much stays private)'; end $$;
do $$ begin insert into public.study_usage (group_id, kind, cost_usd) values ((select id from public.study_groups limit 1), 'part', 0); raise notice 'F4. FAIL: a member wrote the ledger directly';
exception when insufficient_privilege then raise notice 'F4. ok: no direct writes to the ledger'; end $$;
-- B1 (S1): a member's token alone cannot spend: no key, or a wrong key, is refused
do $$ begin perform public.study_reserve((select id from public.study_groups limit 1), null, 'part', null, 99.99, 1000); raise notice 'F4b. FAIL: a member reserved without the server key';
exception when others then raise notice 'F4b. %: a member alone cannot write the ledger (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_reserve((select id from public.study_groups limit 1), null, 'part', null, 99.99, 1000, 1, null, null, null, 'k-wrong-0123456789abcdef0123456789abcdef'); raise notice 'F4c. FAIL: a wrong key reserved';
exception when others then raise notice 'F4c. %: a wrong key is refused (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_settle(1, 'x', '{}', 0); raise notice 'F4d. FAIL: a member settled without the server key';
exception when others then raise notice 'F4d. %: settling needs the server key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- The server, acting for Shoham (her token and the key): reserve, then settle
select public.study_reserve(:'gid', 'eeeeeeee-0000-4000-8000-000000000005', 'practice', 'set-1', 0.05, 33, 0.8, 0.4, null, null, :'key') as r1 \gset
select 'F5. a reservation of $0.05 counts at once: +' || (public.study_spent(:'gid') - :f_before) || ' (expect 0.05000)';
select public.study_settle(:r1, 'claude-opus-5-5', '{"output_tokens":1000}', 0.03, :'key') as f_s1 \gset
select public.study_settle(:r1, 'x', '{}', 9, :'key') as f_s2 \gset
select 'F5b. settled at $0.03: ' || :'f_s1' || ', spend +' || (public.study_spent(:'gid') - :f_before)
       || ', settled again: ' || :'f_s2' || ' (expect t, 0.03000, f)';
do $$ begin perform public.study_reserve((select id from public.study_groups limit 1), gen_random_uuid(), 'practice', null, 0.01, 33, 1, null, null, null, current_setting('t.key')); raise notice 'F6. FAIL: charged to a lecture outside the group';
exception when others then raise notice 'F6. %: a lecture outside the group is refused (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_reserve((select id from public.study_groups limit 1), null, 'Bad Kind!', null, 0.01, 33, 1, null, null, null, current_setting('t.key')); raise notice 'F6b. FAIL: a malformed kind was charged';
exception when check_violation then raise notice 'F6b. ok: kinds are lower-case words'; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_spent(current_setting('t.gid')::uuid); raise notice 'F7. FAIL: the stranger read the spend';
exception when others then raise notice 'F7. %: the stranger gets nothing (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'ask', null, 0.01, 33, 1, null, null, null, current_setting('t.key')); raise notice 'F7b. FAIL: the stranger charged the group';
exception when others then raise notice 'F7b. %: the stranger cannot spend the group''s budget, even through the server (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
insert into public.study_usage (group_id, kind, cost_usd, created_at) values (:'gid', 'part', 5, date_trunc('month', now()) - interval '1 day');
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'F8. last month''s row is not counted: ' || ((public.study_spent(:'gid') - :f_before) < 5) || ' (expect true)';
reset role;
select 'F9. the charge names its member: ' || bool_and(user_id = 'bbbbbbbb-0000-4000-8000-000000000002') || ', settled: ' || bool_and(settled_at is not null) || ' (expect true, true)' from public.study_usage where ref = 'set-1';
-- A purged lecture keeps its spend (lecture_id → null).
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
values ('f0000000-0000-4000-8000-0000000000f0', :'gid', 'נמחקת', 'pdf', '[]', 'bbbbbbbb-0000-4000-8000-000000000002');
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_reserve(:'gid', 'f0000000-0000-4000-8000-0000000000f0', 'cards', 'f-del', 0.02, 33, 0.8, null, null, null, :'key') as r2 \gset
select public.study_settle(:r2, 'claude-opus-5-5', '{}', 0.02, :'key') as f_settled \gset
reset role;
delete from public.study_lectures where id = 'f0000000-0000-4000-8000-0000000000f0';   -- what study_purge_lecture does after 30 days
select 'F10. a purged lecture keeps its spend: ' || count(*) || ' row(s), lecture now null: ' || bool_and(lecture_id is null) || ' (expect 1, true)'
  from public.study_usage where ref = 'f-del';
-- The one-time seed: a part's stored usage becomes one ledger row, once (the statement of section F2, run twice).
update public.study_sections set usage = '{"input_tokens":3000,"output_tokens":5000,"cache_read_input_tokens":15000}', model = 'claude-opus-5-5'
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000005' and idx = 0;
insert into public.study_usage (group_id, lecture_id, kind, ref, model, usage, cost_usd, created_at, settled_at)
select l.group_id, s.lecture_id, 'part', s.idx::text, s.model, s.usage,
       round((coalesce((s.usage ->> 'input_tokens')::numeric, 0) * 4
            + coalesce((s.usage ->> 'output_tokens')::numeric, 0) * 20
            + coalesce((s.usage ->> 'cache_creation_input_tokens')::numeric, 0) * 5
            + coalesce((s.usage ->> 'cache_read_input_tokens')::numeric, 0) * 0.2) / 1000000, 5),
       s.updated_at, s.updated_at
  from public.study_sections s join public.study_lectures l on l.id = s.lecture_id
 where s.usage is not null
   and not exists (select 1 from public.study_usage u where u.lecture_id = s.lecture_id and u.kind = 'part' and u.ref = s.idx::text);
insert into public.study_usage (group_id, lecture_id, kind, ref, model, usage, cost_usd, created_at, settled_at)
select l.group_id, s.lecture_id, 'part', s.idx::text, s.model, s.usage,
       round((coalesce((s.usage ->> 'input_tokens')::numeric, 0) * 4
            + coalesce((s.usage ->> 'output_tokens')::numeric, 0) * 20
            + coalesce((s.usage ->> 'cache_creation_input_tokens')::numeric, 0) * 5
            + coalesce((s.usage ->> 'cache_read_input_tokens')::numeric, 0) * 0.2) / 1000000, 5),
       s.updated_at, s.updated_at
  from public.study_sections s join public.study_lectures l on l.id = s.lecture_id
 where s.usage is not null
   and not exists (select 1 from public.study_usage u where u.lecture_id = s.lecture_id and u.kind = 'part' and u.ref = s.idx::text);
select 'F10b. the seed after two runs: ' || count(*) || ' row of $' || max(cost_usd) || ' (expect 1 row of $0.11500)'
  from public.study_usage where lecture_id = 'eeeeeeee-0000-4000-8000-000000000005' and kind = 'part';

-- F11-F13: the group channel, the hook, anon
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'F11. Noa may join study-group-<her group>: ' || public.study_can_use_topic('study-group-' || :'gid')
       || '; a malformed name: ' || public.study_can_use_topic('study-group-xyz')
       || '; her reading room still: ' || public.study_can_use_topic('study-read-eeeeeeee-0000-4000-8000-000000000005') || ' (expect true; false; true)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'F12. the stranger may join it: ' || public.study_can_use_topic('study-group-' || :'gid') || ' (expect false)';
do $$ begin perform public.study_corrections_of(gen_random_uuid(), 0); raise notice 'F13. FAIL: members call the corrections hook';
exception when insufficient_privilege then raise notice 'F13. ok: the corrections hook is internal (%)', sqlerrm; end $$;
do $$ begin perform public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000005', 0); raise notice 'F16. FAIL: the stranger read a part''s corrections';
exception when others then raise notice 'F16. %: the stranger is refused the writer''s corrections (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'F15. Noa reads a part''s corrections for the device writer: ' || public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000005', 0)::text || ' (expect [])';
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_spent(current_setting('t.gid')::uuid); raise notice 'F14. FAIL: anon read the spend';
exception when others then raise notice 'F14. %: anon without the worker key gets nothing (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;

-- F17-F22: the limits are checked under the lock, before the call (review M6)
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_spent(:'gid') as f_now \gset
select set_config('t.cap', (:f_now + 0.10)::text, false) is not null as have_cap \gset
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'part', '0', 0.11, current_setting('t.cap')::numeric, 1, null, null, null, current_setting('t.key')); raise notice 'F17. FAIL: a call over the cap was reserved';
exception when others then raise notice 'F17. %: the cap stops a call before it starts (%)', case when sqlerrm = 'budget' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'practice', 'x', 0.09, current_setting('t.cap')::numeric, 0.8, null, null, null, current_setting('t.key')); raise notice 'F18. FAIL: an optional call went past the 80%% line';
exception when others then raise notice 'F18. %: optional features stop at 80%% of the cap, summaries keep the rest (%)', case when sqlerrm = 'reserve' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'F18b. a summary part still fits: ' || (public.study_reserve(:'gid', null, 'part', '0', 0.09, current_setting('t.cap')::numeric, 1, null, null, null, :'key') > 0) || ' (expect true)';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_reserve(:'gid', null, 'cards', 'n1', 1.20, 33, 0.8, 0.04, null, null, :'key') as r3 \gset
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'practice', 'n2', 0.20, 33, 0.8, 0.04, null, null, current_setting('t.key')); raise notice 'F19. FAIL: one member spent past her share';
exception when others then raise notice 'F19. %: one member''s optional spend stops at her share of the month (%)', case when sqlerrm = 'member_share' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'F19b. Noa sees her own share: $' || public.study_my_spent(:'gid') || ' (expect 1.20000)';
select public.study_reserve(:'gid', null, 'ask', 'answer', 0.01, 33, 0.8, null, 2, 'answer', :'key') as a1 \gset
select public.study_reserve(:'gid', null, 'ask', 'route', 0.01, 33, 0.8, null, 2, 'answer', :'key') as a2 \gset
select public.study_reserve(:'gid', null, 'ask', 'answer', 0.01, 33, 0.8, null, 2, 'answer', :'key') as a3 \gset
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'ask', 'answer', 0.01, 33, 0.8, null, 2, 'answer', current_setting('t.key')); raise notice 'F20. FAIL: a third answer on a limit of 2';
exception when others then raise notice 'F20. %: the daily limit counts answers, not routes, and holds under the lock (%)', case when sqlerrm = 'daily_limit' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- M10: the server-side switches
select 'F21. switches: ' || public.study_features()::text || ' (expect recordings and exams false)';
do $$ begin perform public.study_reserve(current_setting('t.gid')::uuid, null, 'exam', 'e1', 0.10, 33, 0.8, null, null, null, current_setting('t.key')); raise notice 'F21b. FAIL: an exam call while exams are switched off';
exception when others then raise notice 'F21b. %: a switched-off flow reaches no model, whatever the app''s flags (%)', case when sqlerrm = 'off' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update study_private.features set enabled = true where name = 'exams';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'F21c. with exams on: ' || (public.study_reserve(:'gid', null, 'exam', 'e1', 0.10, 33, 0.8, null, null, null, :'key') > 0) || ' (expect true)';
reset role;
update study_private.features set enabled = false where name = 'exams';
select 'F22. an unsettled reservation keeps its estimate: ' || count(*) filter (where settled_at is null and cost_usd > 0) || ' open, '
       || bool_and((usage ->> 'estimated')::boolean) filter (where settled_at is null) || ' (expect 6, true)'
  from public.study_usage where group_id = :'gid' and created_at >= date_trunc('month', now());
delete from public.study_usage where group_id = :'gid' and settled_at is null and created_at >= date_trunc('month', now());   -- leave later sections' arithmetic alone
select 'F22b. the registry: ' || (public.study_schema() ->> 'F') || ' (expect 1)';

-- F23-F26: soft delete (M2) and the group's members (M4)
reset role;
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
values ('f0000000-0000-4000-8000-0000000000f1', :'gid', 'נמחקת בטעות', 'pdf', '[]', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('f0000000-0000-4000-8000-0000000000f1', 0, 'א', 1, 1);
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin delete from public.study_lectures where id = 'f0000000-0000-4000-8000-0000000000f1'; raise notice 'F23. FAIL: a member deleted a lecture row';
exception when insufficient_privilege then raise notice 'F23. ok: no member deletes a lecture row (study_delete_lecture hides it)'; end $$;
select public.study_delete_lecture('f0000000-0000-4000-8000-0000000000f1') is not null as f_hid \gset
select 'F23b. Noa deletes it: hidden ' || :'f_hid'
       || ', by Noa ' || (select deleted_by = 'cccccccc-0000-4000-8000-000000000003' from public.study_lectures where id = 'f0000000-0000-4000-8000-0000000000f1')
       || ', purge now: ' || public.study_purge_lecture('f0000000-0000-4000-8000-0000000000f1') || ' (expect t, true, false)';
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'F23c. Shoham restores it: ' || coalesce(public.study_delete_lecture('f0000000-0000-4000-8000-0000000000f1', false)::text, 'restored')
       || ', its part still there: ' || (select count(*) from public.study_sections where lecture_id = 'f0000000-0000-4000-8000-0000000000f1') || ' (expect restored, 1)';
select public.study_delete_lecture('f0000000-0000-4000-8000-0000000000f1') as f_del \gset
reset role;
update public.study_lectures set deleted_at = now() - interval '31 days' where id = 'f0000000-0000-4000-8000-0000000000f1';
set role authenticated;
do $$ begin perform public.study_delete_lecture('f0000000-0000-4000-8000-0000000000f1', false); raise notice 'F23d. FAIL: restored after 30 days';
exception when others then raise notice 'F23d. %: after 30 days it cannot come back (%)', case when sqlerrm = 'too old' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_purge_lecture('f0000000-0000-4000-8000-0000000000f1') as f_purged \gset
select 'F23e. purge after 30 days: ' || :'f_purged' || ', parts left: ' || (select count(*) from public.study_sections where lecture_id = 'f0000000-0000-4000-8000-0000000000f1') || ' (expect t, 0)';
reset role;
insert into auth.users (id, raw_user_meta_data, is_anonymous) values ('f2222222-0000-4000-8000-000000000022', '{"app":"study","full_name":"ריטה"}', true);
select join_code as old_code from public.study_groups limit 1 \gset
select set_config('t.old_code', :'old_code', false) is not null as have_code \gset
set role authenticated;
set request.jwt.claim.sub = 'f2222222-0000-4000-8000-000000000022';
do $$ begin perform public.study_join(current_setting('t.old_code'), ' שוהם '); raise notice 'F24. FAIL: a second "שוהם" joined';
exception when others then raise notice 'F24. %: a name already in the group is refused (%)', case when sqlerrm = 'name taken' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'F24b. Rita joins with her own name: ' || (select count(*) from public.study_join(:'old_code', 'ריטה')) || ' group (expect 1)';
do $$ begin update public.study_members set name = 'שוהם' where user_id = auth.uid(); raise notice 'F24c. FAIL: renamed to another member''s name';
exception when others then raise notice 'F24c. %: renaming to a taken name is refused (%)', case when sqlerrm = 'name taken' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_rotate_code(current_setting('t.gid')::uuid); raise notice 'F25. FAIL: a member who did not create the group replaced the code';
exception when others then raise notice 'F25. %: only the group''s creator replaces the code (%)', case when sqlerrm = 'not the creator' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'F25b. Shoham replaces the code: new ' || (public.study_rotate_code(:'gid') <> :'old_code') || ' (expect true)';
select 'F26. Rita is saved: ' || coalesce((select saved::text from public.study_member_saved(:'gid') where user_id = 'f2222222-0000-4000-8000-000000000022'), 'missing') || ' (expect false: anonymous)';
select public.study_remove_member(:'gid', 'f2222222-0000-4000-8000-000000000022');
select 'F26b. Shoham removed Rita: members named ריטה ' || (select count(*) from public.study_members where name = 'ריטה') || ' (expect 0)';
set request.jwt.claim.sub = 'f2222222-0000-4000-8000-000000000022';
do $$ begin perform public.study_join(current_setting('t.old_code'), 'ריטה'); raise notice 'F26c. FAIL: the old code still works';
exception when others then raise notice 'F26c. %: the old code no longer opens the group (%)', case when sqlerrm = 'wrong code' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_groups set join_code = :'old_code';   -- later sections' checks join with study.sql's code

-- F27 (review m5): what a signed-out visitor (anon) may call. The stubs grant
-- EXECUTE to anon by default, as an existing project does, so a function that
-- forgot "revoke … from anon" appears here. Every one listed is safe for anon:
-- the server key's RPCs refuse without the key, the rest answer nothing secret.
select 'F27. ' || coalesce('FAIL: anon may also call ' || string_agg(p.proname, ', ' order by p.proname), 'ok: anon may call only the allow-list')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'study\_%' and has_function_privilege('anon', p.oid, 'execute')
   and p.proname not in ('study_claim', 'study_progress', 'study_finish', 'study_outline_done', 'study_writing_input',
                         'study_reserve', 'study_settle', 'study_spent', 'study_feature_on', 'study_features', 'study_schema', 'study_email_allowed',
                         'study_is_member', 'study_lecture_group', 'study_is_member_path');

-- ════════════════════════════════════════════════════════════════════════
--  SECTION W checks · writing on the server, recordings   (package W)
-- ════════════════════════════════════════════════════════════════════════
-- design-platform: checks to append to supabase/tests/study.sql.
-- Runs after study.sql (its group, Shoham, Noa and the stranger exist).
-- Each line should read "ok" or the expected value.
\set ON_ERROR_STOP 1
\pset tuples_only on
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
select id as gid from public.study_groups limit 1 \gset
\set L1 'f1000000-0000-4000-8000-000000000001'
\set L2 'f2000000-0000-4000-8000-000000000002'

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_spent((select id from public.study_groups limit 1)) as w_before \gset
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('study_worker_key', 'k-0123456789abcdef0123456789abcdef'),
  ('study_site_url', 'https://delo-logo-review.vercel.app')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
delete from net.calls;
select 'P0. cron jobs: ' || string_agg(jobname || ' [' || schedule || ']', ', ' order by jobname) || ' (expect 2, once each after two runs)' from cron.job;
select 'P0b. ledger seeded from study_sections.usage: ' || count(*) || ' row(s) (expect 0: no usage yet)' from public.study_usage where lecture_id in (:'L1', :'L2');

-- ── Server writing ──
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select id as gid from public.study_groups limit 1 \gset
insert into public.study_lectures (id, group_id, title, source_kind, slides) values
  (:'L1', :'gid', 'מלריה', 'pptx', '[{"n":1,"title":"a","lines":["x"],"tables":[],"notes":"","figures":[{"k":1,"path":"g/l/s1-1.jpg","w":800,"h":600}]}]');
select 'P1. Shoham queues the lecture; server writing on: ' || public.study_queue(:'L1', '{"g/l/s1-1.jpg":"https://x.supabase.co/storage/v1/object/sign/study/g/l/s1-1.jpg?token=t"}', now() + interval '48 hours');
reset role;
select 'P2. kicks: ' || count(*) || ' (expect 1), url ' || max(url) || ', bearer key: ' || bool_and(headers ->> 'Authorization' = 'Bearer k-0123456789abcdef0123456789abcdef')
       || ', body: ' || max(body::text) from net.calls;
select 'P2b. lecture queued_at set: ' || (queued_at is not null) from public.study_lectures where id = :'L1';

-- The worker: anon with its key
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_claim('f1000000-0000-4000-8000-000000000001', null, null, 'k-wrong-0123456789abcdef0123456789abcdef'); raise notice 'P3. FAIL: a wrong key claimed';
exception when others then if sqlerrm = 'forbidden' then raise notice 'P3. ok: a wrong key is refused'; else raise notice 'P3. FAIL: %', sqlerrm; end if; end $$;
do $$ begin perform public.study_claim('f1000000-0000-4000-8000-000000000001'); raise notice 'P3b. FAIL: anon without a key claimed';
exception when others then if sqlerrm = 'forbidden' then raise notice 'P3b. ok: anon without the key is refused'; else raise notice 'P3b. FAIL: %', sqlerrm; end if; end $$;
select kind as k_outline, lease as lease_o, effort as e_outline from public.study_claim(:'L1', null, null, :'key') \gset
select 'P4. worker claims: ' || :'k_outline' || ' at effort ' || :'e_outline';
select 'P5. a second claim while the outline is leased: ' || count(*) || ' (expect 0)' from public.study_claim(:'L1', null, null, :'key');
select 'P6. outline done: ' || public.study_outline_done(:'L1', :'lease_o',
  '[{"heading":"מחזור החיים","from":1,"to":1},{"heading":"טיפול","from":2,"to":2},{"heading":"מניעה","from":3,"to":3}]',
  null, 'claude-opus-5-5', '{"input_tokens":12000,"output_tokens":800}', 0.064, :'key');
select 'P7. again with the same lease: ' || public.study_outline_done(:'L1', :'lease_o', '[{"heading":"x","from":1,"to":3}]', null, null, null, 0, :'key') || ' (expect false)';
reset role;
select 'P8. parts: ' || string_agg(idx || ':' || title || ':' || status, ', ' order by idx) || '; lecture ' || (select status from public.study_lectures where id = :'L1') from public.study_sections where lecture_id = :'L1';
select 'P9. kicks so far: ' || count(*) || ' (expect 2: outline, then part 0 alone)' from net.calls;

set role anon;
select kind as k0, idx as i0, lease as lease0, effort as e0 from public.study_claim(:'L1', null, null, :'key') \gset
select 'P10. worker claims ' || :'k0' || ' ' || :'i0' || ' at effort ' || :'e0';
select 'P11. part 0 is written alone (it fills the prompt cache): ' || count(*) || ' more (expect 0)' from public.study_claim(:'L1', null, null, :'key');
select 'P12. progress with a wrong lease: ' || public.study_progress(:'L1', 0, gen_random_uuid(), 'x', :'key') || ' (expect false)';
select 'P13. progress with the lease: ' || public.study_progress(:'L1', 0, :'lease0', '## מחזור החיים' || chr(10) || chr(10) || 'טקסט חלקי', :'key');
reset role;
select 'P14. the group sees the text so far: ' || (markdown like '%טקסט חלקי%') || ', status ' || status from public.study_sections where lecture_id = :'L1' and idx = 0;
set role anon;
select 'P15. finish part 0: ' || public.study_finish(:'L1', 'part', 0, :'lease0', 'ready', null, '## מחזור החיים' || chr(10) || chr(10) || 'טקסט מלא. [ש'' 1]', null,
  'claude-opus-5-5', '{"input_tokens":3000,"output_tokens":6000,"cache_creation_input_tokens":15000}', 0.207, :'key');
reset role;
select 'P16. kicks after part 0: ' || count(*) || ' (expect 4: two parts now)' from net.calls;
set role anon;
select idx as i1, lease as lease1 from public.study_claim(:'L1', null, null, :'key') \gset
select idx as i2, lease as lease2 from public.study_claim(:'L1', null, null, :'key') \gset
select 'P17. two writers now: parts ' || :'i1' || ' and ' || :'i2' || '; a third claim gets ' || (select count(*) from public.study_claim(:'L1', null, null, :'key')) || ' (expect 0)';

-- A member's phone (the device path) asks for a part a writer holds: busy
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'P18. Noa''s phone (section.ts: her token and the key) asks for part 1 while the server writes it: ' || count(*) || ' (expect 0: section.ts answers 409 busy)' from public.study_claim(:'L1', 'part', 1, :'key');
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_claim('f1000000-0000-4000-8000-000000000001', 'part', 1); raise notice 'P19. FAIL: the stranger claimed';
exception when others then if sqlerrm = 'forbidden' then raise notice 'P19. ok: a stranger is refused'; else raise notice 'P19. FAIL: %', sqlerrm; end if; end $$;

-- Retries
set role anon;
reset request.jwt.claim.sub;
select 'P20. part 1 fails (rate limited): ' || public.study_finish(:'L1', 'part', 1, :'lease1', 'failed', 'rate_limited', '', null,
  'claude-opus-5-5', '{"input_tokens":3000}', 0.012, :'key');
reset role;
select 'P21. retry in ' || round(extract(epoch from (retry_at - now())) / 60) || ' min (expect 2), attempts ' || attempts from public.study_sections where lecture_id = :'L1' and idx = 1;
set role anon;
select 'P22. the worker cannot take it before then: ' || count(*) || ' (expect 0)' from public.study_claim(:'L1', null, null, :'key');
reset role;
update public.study_sections set retry_at = now() - interval '1 second' where lecture_id = :'L1' and idx = 1;
set role anon;
select idx as i1b, lease as lease1b from public.study_claim(:'L1', null, null, :'key') \gset
select 'P23. after the delay the worker takes part ' || :'i1b';
-- the lease on part 2 expires (the function was killed); another writer takes it
reset role;
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = :'L1' and idx = 2;
set role anon;
select idx as i2b, lease as lease2b from public.study_claim(:'L1', null, null, :'key') \gset
select 'P24. an expired lease is taken again: part ' || :'i2b' || ', new lease: ' || (:'lease2b' <> :'lease2');
select 'P25. the old writer finishes late: ' || public.study_finish(:'L1', 'part', 2, :'lease2', 'ready', null, 'old text', null,
  'claude-opus-5-5', '{"output_tokens":5000}', 0.1, :'key') || ' (expect false)';
reset role;
select 'P26. its text was not saved: ' || (markdown = '') || '; its cost was: ' || exists (select 1 from public.study_usage where lecture_id = :'L1' and ref = '2' and cost_usd = 0.1) from public.study_sections where lecture_id = :'L1' and idx = 2;
-- a refusal is not retried by the server; "המשך כתיבה" starts it over
set role anon;
select 'P27. part 2 refused: ' || public.study_finish(:'L1', 'part', 2, :'lease2b', 'failed', 'refusal', '', null, 'claude-opus-5-5', '{}', 0.02, :'key');
reset role;
select 'P28. refusal: retry_at ' || coalesce(retry_at::text, 'null') || ' (expect null)' from public.study_sections where lecture_id = :'L1' and idx = 2;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'P29. Noa taps "המשך כתיבה": ' || public.study_queue(:'L1', '{}', null, true);
reset role;
select 'P30. part 2 starts over: attempts ' || attempts || ', due ' || (retry_at <= now()) from public.study_sections where lecture_id = :'L1' and idx = 2;
-- the attempt cap
update public.study_sections set attempts = 4, status = 'failed', error = 'rate_limited', retry_at = now() - interval '1 minute', lease_id = null where lecture_id = :'L1' and idx = 1;
update public.study_sections set status = 'ready', lease_id = null where lecture_id = :'L1' and idx = 2;
set role anon;
select 'P31. after 4 attempts part 1 is never taken by the server: ' || count(*) || ' (expect 0)' from public.study_claim(:'L1', null, null, :'key');
reset role;
-- the sweeper: caps and the 2-minute pause
update public.study_sections set attempts = 0, retry_at = now() - interval '1 minute' where lecture_id = :'L1' and idx = 1;
update study_private.jobs set last_kick_at = now() where lecture_id = :'L1';
delete from net.calls;
select 'P32. sweeper within 2 minutes of a kick: ' || study_private.dispatch() || ' kick(s) (expect 0)';
update study_private.jobs set last_kick_at = now() - interval '3 minutes' where lecture_id = :'L1';
select 'P33. sweeper after the pause: ' || study_private.dispatch() || ' kick(s) (expect 1: one part due)';
select 'P34. and right after: ' || study_private.dispatch() || ' (expect 0)';
update study_private.jobs set last_kick_at = now() - interval '3 minutes', kicks_since_claim = 15 where lecture_id = :'L1';
select 'P35. 15 kicks nobody claimed: ' || study_private.dispatch() || ' (expect 0 until someone queues again)';

-- ── The ledger ──
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'L1. spent by these checks: $' || (public.study_spent(:'gid') - :w_before) || ' (expect 0.40300 = outline 0.064 + parts 0.207 + 0.012 + 0.1 (the late writer) + 0.02)';
reset role;
insert into public.study_usage (group_id, kind, cost_usd, created_at) values (:'gid', 'part', 5, date_trunc('month', now()) - interval '1 day');
select 'L6. last month''s row is not counted: ' || (public.study_spent(:'gid', :'key') < 5);

-- ── Writing input ──
set role anon;
select 'I1. the worker reads the lecture: ' || (public.study_writing_input(:'L1', false, :'key') -> 'lecture' ->> 'title') || ', figures ' || jsonb_typeof(public.study_writing_input(:'L1', false, :'key') -> 'figures');
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_writing_input('f1000000-0000-4000-8000-000000000001'); raise notice 'I2. FAIL: the stranger read the input';
exception when others then if sqlerrm = 'forbidden' then raise notice 'I2. ok: the stranger is refused'; else raise notice 'I2. FAIL: %', sqlerrm; end if; end $$;
do $$ begin perform count(*) from study_private.jobs; raise notice 'I3. FAIL: a member reads the job queue';
exception when insufficient_privilege then raise notice 'I3. ok: the job queue is out of reach (%)', sqlerrm; end $$;

-- ── Recordings (the server switch on: review M10) ──
reset role;
update study_private.features set enabled = true, changed_at = now() where name = 'recordings';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin insert into public.study_recordings (lecture_id, source, engine, consented) values ('f1000000-0000-4000-8000-000000000001', 'file', 'vtt', false); raise notice 'R1. FAIL: saved without consent';
exception when check_violation then raise notice 'R1. ok: the uploader must confirm the group may use it'; end $$;
insert into public.study_recordings (lecture_id, source, engine, source_name, duration_s, has_times, chars, consented)
values (:'L1', 'file', 'vtt', 'zoom.vtt', 6700, true, 120000, true);
insert into public.study_transcript_blocks (lecture_id, idx, start_s, end_s, lines, segments) values
  (:'L1', 0, 0, 300, '[00:01] שלום לכולם' || chr(10) || '[00:31] היום נדבר על Plasmodium', '[{"s":1,"e":5,"t":"שלום לכולם"}]'),
  (:'L1', 1, 300, 600, '[05:00] זה יופיע במבחן', '[]');
select 'R2. Noa added a transcript: ' || count(*) || ' block(s), created_by Noa: ' || bool_and(r.created_by = 'cccccccc-0000-4000-8000-000000000003')
  from public.study_transcript_blocks b join public.study_recordings r using (lecture_id) where b.lecture_id = :'L1';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'R3. stranger sees ' || (select count(*) from public.study_recordings) || ' recordings, ' || (select count(*) from public.study_transcript_blocks) || ' blocks (expect 0, 0)';
do $$ begin insert into public.study_transcript_blocks (lecture_id, idx, lines) values ('f1000000-0000-4000-8000-000000000001', 9, 'x'); raise notice 'R4. FAIL: the stranger added a block';
exception when others then raise notice 'R4. ok: the stranger cannot add a block (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
update public.study_recordings set status = 'ready', done_s = 6700, updated_at = now() where lecture_id = :'L1';
select 'R5. ready; notes wait for the parts: ' || count(*) || ' (expect 0)' from public.study_claim(:'L1', 'notes', null, :'key');
reset role;
update public.study_sections set status = 'ready', attempts = 1, lease_id = null where lecture_id = :'L1';
update public.study_lectures set status = 'ready' where id = :'L1';
set role anon;
select kind as kn, idx as n0, lease as leasen0, effort as en from public.study_claim(:'L1', null, null, :'key') \gset
select 'R6. every part written: the worker takes ' || :'kn' || ' of part ' || :'n0' || ' at effort ' || :'en';
select 'R7. notes of part 0 alone first: ' || count(*) || ' more (expect 0)' from public.study_claim(:'L1', null, null, :'key');
select 'R8. notes saved: ' || public.study_finish(:'L1', 'notes', 0, :'leasen0', 'ready', null, null,
  '[{"anchor":1,"quote":"טקסט מלא","at_s":300,"text":"בהרצאה נאמר שזה יופיע במבחן."}]', 'claude-opus-5-5', '{"output_tokens":900}', 0.31, :'key');
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'R9. Shoham reads the note: ' || (items -> 0 ->> 'text') from public.study_recording_notes where lecture_id = :'L1' and part_idx = 0;
do $$ begin update public.study_recording_notes set items = '[]' where part_idx = 0; raise notice 'R10. FAIL: a member rewrote notes';
exception when insufficient_privilege then raise notice 'R10. ok: notes change only through study_finish'; end $$;
delete from public.study_recordings where lecture_id = :'L1';
select 'R10b. Shoham cannot delete Noa''s recording: ' || count(*) || ' left (expect 1)' from public.study_recordings where lecture_id = :'L1';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
delete from public.study_recordings where lecture_id = :'L1';
reset role;
select 'R11. Noa deletes her recording, which takes its blocks and notes: ' || (select count(*) from public.study_transcript_blocks where lecture_id = :'L1') || ', ' || (select count(*) from public.study_recording_notes where lecture_id = :'L1') || ' (expect 0, 0)';

-- ── The job ends when nothing is left to write ──
reset role;
select 'P36. the sweeper runs: ' || study_private.dispatch() || ' kick(s) (expect 0)';
select 'P36b. a lecture with nothing left to write leaves the queue: ' || (not exists (select 1 from study_private.jobs where lecture_id = :'L1'));

-- ── Off switch, and deleting a lecture ──
reset role;
alter function net.http_post(text, jsonb, jsonb, jsonb, int) rename to http_post_off;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
insert into public.study_lectures (id, group_id, title, source_kind, slides) values (:'L2', :'gid', 'בלי שרת', 'pdf', '[]');
select 'O1. without pg_net study_queue answers: ' || public.study_queue(:'L2', '{}') || ' (expect false: the phone writes)';
reset role;
alter function net.http_post_off(text, jsonb, jsonb, jsonb, int) rename to http_post;
select 'O2. no job was made: ' || count(*) || ' (expect 0)' from study_private.jobs where lecture_id = :'L2';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'O3. the device path works without the server: ' || kind from public.study_claim(:'L2', null, null, :'key');
select 'O3b. Shoham deletes the lecture (hidden): ' || (public.study_delete_lecture(:'L1') is not null);
reset role;
select 'O4. lecture hidden; its spend stays: ' || count(*) || ' row(s), job gone: ' || (not exists (select 1 from study_private.jobs where lecture_id = :'L1'))
  || ', the worker is offered: ' || (select count(*) from study_private.plan(:'L1', true)) || ' (expect 5 row(s), true, 0)'
  from public.study_usage where lecture_id = :'L1' and kind in ('outline', 'part');
delete from public.study_lectures where id = :'L1';   -- the purge, 30 days later

-- ════ Review checks: B1, FE-1, FE-4, M6, M7, M9, M10, M2, FE-13 ════
reset role;
\set L3 'f3000000-0000-4000-8000-000000000003'
insert into public.study_lectures (id, group_id, title, source_kind, slides, status) values
  (:'L3', :'gid', 'סקירה', 'pptx', '[{"n":1,"title":"a","lines":["x"],"tables":[],"notes":"","figures":[{"k":1,"path":"g/l3/s1-1.jpg","w":800,"h":600}]}]', 'writing');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
  (:'L3', 0, 'א', 1, 1, 'ready', '## א'), (:'L3', 1, 'ב', 1, 1, 'pending', '');
insert into study_private.jobs (lecture_id) values (:'L3');
-- B1: a member's token alone writes nothing
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_claim('f3000000-0000-4000-8000-000000000003', 'part', 1); raise notice 'B1a. FAIL: a member claimed a part with her token alone';
exception when others then raise notice 'B1a. %: a member''s token alone cannot claim (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set role anon;
reset request.jwt.claim.sub;
select idx as w3, lease as lease3 from public.study_claim(:'L3', null, null, :'key') \gset
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.seen', lease_id::text, false) is not null as seen from public.study_sections where lecture_id = :'L3' and idx = 1 \gset
do $$ begin perform public.study_finish('f3000000-0000-4000-8000-000000000003', 'part', 1, current_setting('t.seen')::uuid, 'ready', null, 'טקסט מזויף', null, 'claude-opus-5-5', '{}', 0); raise notice 'B1b. FAIL: a member finished a part with a lease she read';
exception when others then raise notice 'B1b. %: a lease read from the table opens nothing without the key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_progress('f3000000-0000-4000-8000-000000000003', 1, current_setting('t.seen')::uuid, 'x'); raise notice 'B1c. FAIL: a member wrote progress';
exception when others then raise notice 'B1c. %: progress needs the key too (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_outline_done('f3000000-0000-4000-8000-000000000003', gen_random_uuid(), '[]', null, null, null, 99); raise notice 'B1d. FAIL: a member charged through the outline';
exception when others then raise notice 'B1d. %: the outline''s cost cannot be written by a member (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- FE-1: a writer that dies after every claim
reset role;
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = :'L3' and idx = 1;
set role anon;
select count(*) as c2 from public.study_claim(:'L3', null, null, :'key') \gset
reset role;
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = :'L3' and idx = 1;
set role anon;
select count(*) as c3 from public.study_claim(:'L3', null, null, :'key') \gset
reset role;
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = :'L3' and idx = 1;
set role anon;
select count(*) as c4 from public.study_claim(:'L3', null, null, :'key') \gset
reset role;
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = :'L3' and idx = 1;
set role anon;
select 'FE1. claims 2-4 took it (' || :c2 || :c3 || :c4 || '); after the 4th dies a 5th claim gets ' || count(*) || ' (expect 111; 0)' from public.study_claim(:'L3', null, null, :'key');
reset role;
select 'FE1b. the unit gave up: ' || status || ' ' || error || ', attempts ' || attempts || ', retry_at ' || coalesce(retry_at::text, 'null') || ' (expect failed lost, 4, null)'
  from public.study_sections where lecture_id = :'L3' and idx = 1;
select study_private.dispatch(:'L3') as fe1_kicks \gset
select 'FE1c. the sweeper stops: kicks ' || :'fe1_kicks' || ', job left: ' || exists (select 1 from study_private.jobs where lecture_id = :'L3') || ' (expect 0, false)';
-- FE-4: server off, a person's tap restarts it and the phone writes it; M6: 3 taps a day
alter function net.http_post(text, jsonb, jsonb, jsonb, int) rename to http_post_off;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'FE4. server off, "המשך כתיבה" answers ' || public.study_queue(:'L3', '{}', null, true) || ' (expect false: the phone writes)';
reset role;
select 'FE4b. and the part starts over: attempts ' || attempts || ', due ' || (retry_at <= now()) || ' (expect 0, true)' from public.study_sections where lecture_id = :'L3' and idx = 1;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'FE4c. Shoham''s phone writes it: part ' || idx || ' (expect 1)' from public.study_claim(:'L3', 'part', 1, :'key');
select public.study_queue(:'L3', '{}', null, true) as q2 \gset
select public.study_queue(:'L3', '{}', null, true) as q3 \gset
do $$ begin perform public.study_queue('f3000000-0000-4000-8000-000000000003', '{}', null, true); raise notice 'M6a. FAIL: a fourth restart in a day';
exception when others then raise notice 'M6a. %: three restarts a day per lecture (%)', case when sqlerrm = 'retry limit' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
alter function net.http_post_off(text, jsonb, jsonb, jsonb, int) rename to http_post;
-- M7 (S3): picture links are this lecture's own, signed by Storage
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_queue('f3000000-0000-4000-8000-000000000003', '{"g/l3/s1-1.jpg":"https://attacker.example/prompt.png"}'); raise notice 'M7a. FAIL: an outside picture was queued';
exception when others then raise notice 'M7a. %: an outside URL is refused (%)', case when sqlerrm = 'bad figures' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_queue('f3000000-0000-4000-8000-000000000003', '{"g/other/x.jpg":"https://x.supabase.co/storage/v1/object/sign/study/g/other/x.jpg?token=t"}'); raise notice 'M7b. FAIL: another lecture''s picture was queued';
exception when others then raise notice 'M7b. %: a path that is not this lecture''s figure is refused (%)', case when sqlerrm = 'bad figures' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_queue('f3000000-0000-4000-8000-000000000003', '{"g/l3/s1-1.jpg":"https://x.supabase.co/storage/v1/object/sign/study/g/other/x.jpg?token=t"}'); raise notice 'M7c. FAIL: a link signed for another path was queued';
exception when others then raise notice 'M7c. %: the link must be signed for the same path (%)', case when sqlerrm = 'bad figures' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'M7d. its own picture, signed for it: ' || public.study_queue(:'L3', '{"g/l3/s1-1.jpg":"https://x.supabase.co/storage/v1/object/sign/study/g/l3/s1-1.jpg?token=t.u-v"}') || ' (expect true)';
-- M10, M9, M2, FE-13: recordings
reset role;
update study_private.features set enabled = false where name = 'recordings';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin insert into public.study_recordings (lecture_id, source, engine, consented) values ('f3000000-0000-4000-8000-000000000003', 'file', 'vtt', true); raise notice 'M10a. FAIL: a recording came in while the switch is off';
exception when insufficient_privilege then raise notice 'M10a. ok: with the server switch off no recording comes in'; end $$;
reset role;
update study_private.features set enabled = true where name = 'recordings';
set role authenticated;
insert into public.study_recordings (lecture_id, source, engine, consented, link_url) values (:'L3', 'file', 'vtt', true, 'https://moodle.bgu.ac.il/rec/1');
select 'M9a. a link to the university: set by Noa ' || (link_set_by = 'cccccccc-0000-4000-8000-000000000003') || ', own key ' || (id is not null and id <> lecture_id) || ' (expect true, true)'
  from public.study_recordings where lecture_id = :'L3';
do $$ begin update public.study_recordings set link_url = 'https://bgu.ac.il.evil.example/login' where lecture_id = 'f3000000-0000-4000-8000-000000000003'; raise notice 'M9b. FAIL: a look-alike host was saved';
exception when others then raise notice 'M9b. %: a host outside the list is refused (%)', case when sqlerrm = 'link host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin update public.study_recordings set link_url = 'https://evil.example/bgu.ac.il/' where lecture_id = 'f3000000-0000-4000-8000-000000000003'; raise notice 'M9c. FAIL: a path that names the university was saved';
exception when others then raise notice 'M9c. %: only the host counts (%)', case when sqlerrm = 'link host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
delete from public.study_recordings where lecture_id = :'L3';
select 'M2a. Shoham cannot delete Noa''s recording: ' || count(*) || ' left (expect 1)' from public.study_recordings where lecture_id = :'L3';
reset role;
update public.study_recordings set status = 'ready' where lecture_id = :'L3';
update public.study_sections set status = 'ready', lease_id = null, markdown = '## ב' where lecture_id = :'L3';
update public.study_lectures set status = 'ready' where id = :'L3';
update study_private.features set enabled = false where name = 'recordings';
set role anon;
select 'M10b. switched off, the worker is offered notes: ' || count(*) || ' (expect 0)' from public.study_claim(:'L3', null, null, :'key');
reset role;
update study_private.features set enabled = true where name = 'recordings';
set role anon;
select kind as kn3, idx as n3, lease as leasen3 from public.study_claim(:'L3', null, null, :'key') \gset
select 'M10c. switched on: the worker takes ' || :'kn3' || ' of part ' || :'n3';
-- M6: the call's reservation is settled by study_finish
select public.study_reserve(:'gid', :'L3', 'notes', :'n3', 0.5, 33, 0.8, null, null, null, :'key') as rn \gset
select 'M6b. notes finished: ' || public.study_finish(:'L3', 'notes', :n3, :'leasen3', 'ready', null, null, '[]', 'claude-opus-5-5', '{"output_tokens":10}', 0.07, :'key', :rn) || ' (expect true)';
reset role;
select 'M6c. the reservation now holds the real cost: $' || cost_usd || ', settled ' || (settled_at is not null) || ', rows for it ' || (select count(*) from public.study_usage where lecture_id = :'L3' and kind = 'notes') || ' (expect 0.07000, true, 1)'
  from public.study_usage where id = :rn;
select 'W-reg. the registry: ' || (public.study_schema() ->> 'W') || ' (expect 1)';
delete from public.study_lectures where id = :'L3';


-- ════════════════════════════════════════════════════════════════════════
--  SECTION Q checks · practice questions and past exams   (package Q)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for questions.sql, in the style of supabase/tests/study.sql.
-- Runs in the SAME psql session right after supabase/tests/study.sql (it reuses
-- that file's users, group and :gid). Throwaway local Postgres only.
-- Load order: stubs.sql, board-schema.sql, study-schema.sql (x2), ledger.sql,
-- questions.sql (x2), then study.sql + this file in one psql run.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
-- The server key (the ops pass it with the member's token) and the exams switch (review B1, M10).
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
update study_private.features set enabled = true where name = 'exams';
set role authenticated;

-- Shoham adds a 12-slide lecture with a three-part outline.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
insert into public.study_lectures (id, group_id, course, title, source_kind, slides)
select 'eeeeeeee-0000-4000-8000-000000000007', :'gid', 'פתוגן מאכסן', 'Antimalarials', 'pptx',
       (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', '[]'::jsonb, 'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb))
          from generate_series(1, 12) n);
reset role;   -- fixture parts are written by the owner (after W2 no member writes a part)
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values
 ('eeeeeeee-0000-4000-8000-000000000007', 0, 'מלריה: מחזור החיים', 1, 4),
 ('eeeeeeee-0000-4000-8000-000000000007', 1, 'מלריה: תרופות לפי שלב', 5, 8),
 ('eeeeeeee-0000-4000-8000-000000000007', 2, 'Primaquine ו-G6PD', 9, 12);
set role authenticated;

-- Q1-Q2: planning a round
select 'Q1. round ' || round || ', ' || batches || ' parts, fresh ' || fresh || ' (expect 1, 3, true)'
  from public.study_question_round('eeeeeeee-0000-4000-8000-000000000007');
select 'Q1b. wanted per part: ' || string_agg(part_idx || ':' || slide_from || '-' || slide_to || '=' || wanted, ' ' order by part_idx) || ' (expect 0:1-4=2 1:5-8=2 2:9-12=2)'
  from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
-- Q1c: the real antiparasitics outline (38 slides, 8 parts) gets 15 questions.
insert into public.study_lectures (id, group_id, title, source_kind, slides)
select 'eeeeeeee-0000-4000-8000-000000000008', :'gid', 'Anti parasite (outline check)', 'pptx',
       (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 38) n);
reset role;
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to)
select 'eeeeeeee-0000-4000-8000-000000000008', i - 1, 'part ' || i, f, t
from (values (1, 1, 4), (2, 5, 7), (3, 8, 12), (4, 13, 18), (5, 19, 23), (6, 24, 28), (7, 29, 33), (8, 34, 38)) v(i, f, t);
set role authenticated;
select round as r8 from public.study_question_round('eeeeeeee-0000-4000-8000-000000000008') \gset
select 'Q1c. 38 slides in 8 parts: ' || string_agg(wanted::text, '-' order by part_idx) || ' = ' || sum(wanted) || ' (expect 2-1-2-2-2-2-2-2 = 15)'
  from public.study_question_batches
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000008' and round = :r8;
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-000000000008';   -- a fixture: the owner purges it
set role authenticated;
select set_config('t.b0', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and part_idx = 0), false) is not null as b0 \gset
select set_config('t.b2', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and part_idx = 2), false) is not null as b2 \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q2. Noa taps too: round ' || round || ', fresh ' || fresh || ' (expect 1, false: same round)'
  from public.study_question_round('eeeeeeee-0000-4000-8000-000000000007');

-- Q3: claiming a part
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q3. Shoham claims part ' || part_idx || ': wants ' || wanted || ' at ' || effort || ' (expect 0, 2, high)'
  from public.study_question_claim(current_setting('t.b0')::uuid, current_setting('t.key'));
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_question_claim(current_setting('t.b0')::uuid, current_setting('t.key')); raise notice 'Q3b. FAIL: a part was claimed twice';
exception when others then raise notice 'Q3b. %: a part being written is busy (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Q4: saving questions (the database's own checks)
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.q1', public.study_save_question(current_setting('t.b0')::uuid, null, '{
  "kind": "case", "difficulty": 3, "topic": "Primaquine", "aspect": "contra", "model": "claude-opus-5-5",
  "vignette": "גבר בן 24 חזר מתאילנד ...", "question": "איזו בדיקה יש לבצע לפני מתן Primaquine?",
  "options": ["רמת G6PD", "ECG", "בדיקת היריון", "תפקודי כבד", "בדיקת שמיעה"],
  "answer": 0, "explanations": ["נכון ... [ש'' 3]", "לא ... [ש'' 2]", "לא ...", "לא ...", "לא ..."],
  "takeaway": "לפני Primaquine בודקים G6PD. [ש'' 3]", "slides": [3, 2]
}'::jsonb, current_setting('t.key'))::text, false) is not null as q1 \gset
select 'Q4. saved: ' || kind || ', ' || cardinality(options) || ' options, key hidden in its own table: ' ||
       (select count(*) from public.study_question_batches where id = current_setting('t.b0')::uuid and made = 1) || ' part made 1'
  from public.study_questions where id = current_setting('t.q1')::uuid;
do $$ begin perform public.study_save_question(current_setting('t.b0')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":5,"explanations":["1","2","3","4","5"],"slides":[1]}', current_setting('t.key'));
  raise notice 'Q4b. FAIL: answer out of range saved';
exception when others then raise notice 'Q4b. %: the answer must be one of the options (%)', case when sqlerrm = 'bad answer' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.b0')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4"],"slides":[1]}', current_setting('t.key'));
  raise notice 'Q4c. FAIL: four explanations for five options saved';
exception when others then raise notice 'Q4c. %: one explanation per option (%)', case when sqlerrm like 'explanations%' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.b0')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[99]}', current_setting('t.key'));
  raise notice 'Q4d. FAIL: a slide the lecture does not have';
exception when others then raise notice 'Q4d. %: slide numbers must exist (%)', case when sqlerrm = 'unknown slide' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.b0')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[10]}', current_setting('t.key'));
  raise notice 'Q4e. FAIL: a question about another part';
exception when others then raise notice 'Q4e. %: at least one slide in the part (%)', case when sqlerrm = 'outside the part' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.b2')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[10]}', current_setting('t.key'));
  raise notice 'Q4f. FAIL: saved into a part nobody claimed';
exception when others then raise notice 'Q4f. %: only a claimed part takes questions (%)', case when sqlerrm = 'batch not writing' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.b0')::uuid, null,
  '{"kind":"mcq","question":"שאלה?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[1],"aspect":"vibes"}', current_setting('t.key'));
  raise notice 'Q4g. FAIL: an aspect outside the list';
exception when others then raise notice 'Q4g. ok: aspects come from the fixed list (%)', sqlerrm; end $$;

-- Q5: what Noa can and cannot touch
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q5. Noa sees ' || count(*) || ' question(s) with ' || max(cardinality(options)) || ' options (expect 1, 5)' from public.study_questions;
do $$ begin perform count(*) from public.study_question_keys; raise notice 'Q5b. FAIL: the key table is readable';
exception when insufficient_privilege then raise notice 'Q5b. ok: nobody reads the keys (%)', sqlerrm; end $$;
do $$ begin insert into public.study_questions (group_id, lecture_id, kind, question, options) values
  ((select group_id from public.study_questions limit 1), 'eeeeeeee-0000-4000-8000-000000000007', 'mcq', 'שאלה?', '{a,b}');
  raise notice 'Q5c. FAIL: a question was inserted around the checks';
exception when insufficient_privilege then raise notice 'Q5c. ok: questions are saved only through study_save_question (%)', sqlerrm; end $$;
do $$ begin update public.study_questions set question = 'נערך?'; raise notice 'Q5d. FAIL: a question was rewritten';
exception when insufficient_privilege then raise notice 'Q5d. ok: questions are not edited in place (%)', sqlerrm; end $$;
do $$ begin update public.study_question_batches set status = 'ready'; raise notice 'Q5e. FAIL: a part''s state was changed directly';
exception when insufficient_privilege then raise notice 'Q5e. ok: parts change state only through the functions (%)', sqlerrm; end $$;

-- Q6: a stranger
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'Q6. stranger sees ' || count(*) || ' questions, ' || (select count(*) from public.study_question_batches) || ' parts (expect 0, 0)' from public.study_questions;
do $$ begin perform public.study_answer_question(current_setting('t.q1')::uuid, 0); raise notice 'Q6b. FAIL: stranger answered';
exception when others then raise notice 'Q6b. %: stranger cannot answer (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_question_round('eeeeeeee-0000-4000-8000-000000000007'); raise notice 'Q6c. FAIL: stranger planned a round';
exception when others then raise notice 'Q6c. %: stranger cannot spend the group''s budget (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_retire_question(current_setting('t.q1')::uuid, true); raise notice 'Q6d. FAIL: stranger retired a question';
exception when others then raise notice 'Q6d. %: stranger cannot retire (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Q7: Noa answers
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q7. right answer: correct ' || correct || ', key ' || answer || ', ' || cardinality(explanations) || ' explanations (expect true, 0, 5)'
  from public.study_answer_question(current_setting('t.q1')::uuid, 0, 'lecture', 5400);
select 'Q7b. wrong answer: correct ' || correct || ' (expect false)' from public.study_answer_question(current_setting('t.q1')::uuid, 3, 'lecture', 8000);
select 'Q7c. "לא יודעים": correct ' || correct || ' (expect false)' from public.study_answer_question(current_setting('t.q1')::uuid, null, 'mistakes', null);
do $$ begin perform public.study_answer_question(current_setting('t.q1')::uuid, 7); raise notice 'Q7d. FAIL: option 8 of 5 accepted';
exception when others then raise notice 'Q7d. %: the choice must be an option (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Q8: answers are private
select 'Q8. Noa sees ' || count(*) || ' answers of her own (expect 3)' from public.study_answers;
do $$ begin insert into public.study_answers (question_id, correct) values (current_setting('t.q1')::uuid, true); raise notice 'Q8b. FAIL: an answer was written around the key';
exception when insufficient_privilege then raise notice 'Q8b. ok: answers are recorded only by study_answer_question (%)', sqlerrm; end $$;
do $$ begin update public.study_answers set correct = true; raise notice 'Q8c. FAIL: a score was changed';
exception when insufficient_privilege then raise notice 'Q8c. ok: answers cannot be changed (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q8d. Shoham sees ' || count(*) || ' of Noa''s answers (expect 0)' from public.study_answers;
delete from public.study_answers;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q8e. after Shoham''s delete, Noa still has ' || count(*) || ' (expect 3)' from public.study_answers;

-- Q9: review only what you answered
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q9. Shoham (no answer yet) gets ' || count(*) || ' feedback rows (expect 0)' from public.study_question_feedback(array[current_setting('t.q1')::uuid]);
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q9b. Noa gets ' || count(*) || ' (expect 1)' from public.study_question_feedback(array[current_setting('t.q1')::uuid]);

-- Q10-Q11: mistakes and topic stats (latest answer counts)
select 'Q10. Noa''s mistakes: ' || count(*) || ' (expect 1: her last answer was "לא יודעים")' from public.study_my_mistakes(:'gid');
select 'Q10b. correct again' from public.study_answer_question(current_setting('t.q1')::uuid, 0, 'mistakes', 3000) where correct;
select 'Q10c. mistakes now ' || count(*) || ' (expect 1: a right answer on the same study day does not clear it, review UX-2)' from public.study_my_mistakes(:'gid');
select 'Q11. Noa: ' || topic || '/' || aspect || ' answered ' || answered || ', right now ' || correct_now || ' (expect Primaquine/contra 1, 1)'
  from public.study_my_topic_stats(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
select 'Q11b. Noa answered ' || sum(answered) || ' today (expect 4)' from public.study_my_daily(:'gid', 7);
select 'Q11d. Noa''s latest: correct ' || correct || ' after ' || times || ' answers (expect true, 4)' from public.study_my_latest(:'gid');
select 'Q11e. Noa''s hub row: ' || questions || ' question(s), answered ' || answered || ', wrong now ' || wrong_now || ' (expect 1, 1, 1: the same rule as "הטעויות שלי")'
  from public.study_practice_overview(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q11c. Shoham: answered ' || coalesce(sum(answered), 0) || ' (expect 0: stats are per person)' from public.study_my_topic_stats(:'gid');
select 'Q11f. Shoham''s hub row: ' || questions || ' question(s), answered ' || answered || ' (expect 1, 0: the count is shared, the answers are not)'
  from public.study_practice_overview(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';

-- Q12: flags
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
insert into public.study_question_flags (question_id, reason, note) values (current_setting('t.q1')::uuid, 'two_answers', 'גם ECG נראה נכון לפי שקף 2');
do $$ begin insert into public.study_question_flags (question_id, reason) values (current_setting('t.q1')::uuid, 'unclear'); raise notice 'Q12. FAIL: two flags from one member';
exception when unique_violation then raise notice 'Q12. ok: one flag per member per question (%)', sqlerrm; end $$;
do $$ begin insert into public.study_question_flags (question_id, reason, user_id) values (current_setting('t.q1')::uuid, 'other', 'bbbbbbbb-0000-4000-8000-000000000002'); raise notice 'Q12b. FAIL: flagged as Shoham';
exception when insufficient_privilege then raise notice 'Q12b. ok: a flag is always your own (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q12c. Shoham sees the flag: ' || reason || ' (expect two_answers)' from public.study_question_flags;
delete from public.study_question_flags;
select 'Q12d. after Shoham''s delete: ' || count(*) || ' flag(s) left (expect 1: only Noa removes hers)' from public.study_question_flags;

-- Q13: retire and undo
select public.study_retire_question(current_setting('t.q1')::uuid, true, 'שתי תשובות נכונות') is null as retired \gset
select 'Q13. retired by Shoham: ' || (retired_by = 'bbbbbbbb-0000-4000-8000-000000000002') || ' (expect true)' from public.study_questions where id = current_setting('t.q1')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_answer_question(current_setting('t.q1')::uuid, 0); raise notice 'Q13b. FAIL: answered a retired question';
exception when others then raise notice 'Q13b. %: a retired question is out of practice (%)', case when sqlerrm = 'retired' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'Q13c. Noa''s stats skip it: ' || count(*) || ' rows (expect 0)' from public.study_my_topic_stats(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
select public.study_retire_question(current_setting('t.q1')::uuid, false) is null as undone \gset
select 'Q13d. undo: retired ' || (retired_at is not null) || ', by ' || coalesce(retired_by::text, 'nobody') || ' (expect false, nobody)' from public.study_questions where id = current_setting('t.q1')::uuid;

-- Q14-Q15: finishing parts, and the next round
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_question_finish(current_setting('t.b0')::uuid, 'ready', 1, 'claude-opus-5-5', 0.061, null, current_setting('t.key')) is null as fin \gset
do $$ begin perform public.study_question_finish(current_setting('t.b0')::uuid, 'ready', 0, null, 0, null, current_setting('t.key')); raise notice 'Q14. FAIL: finished twice';
exception when others then raise notice 'Q14. %: a part finishes once (%)', case when sqlerrm = 'batch not writing' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'Q14b. part 0: ' || status || ', made ' || made || ', rejected ' || rejected || ', $' || cost_usd || ' (expect ready, 1, 1, 0.0610)' from public.study_question_batches where id = current_setting('t.b0')::uuid;
select 'Q15. while parts 1-2 wait, a new tap gives round ' || round || ', fresh ' || fresh || ' (expect 1, false)' from public.study_question_round('eeeeeeee-0000-4000-8000-000000000007');
-- Part 2 times out on a phone that slept; Noa picks it up later.
select 'Q15b. claimed part ' || part_idx from public.study_question_claim(current_setting('t.b2')::uuid, current_setting('t.key'));
select public.study_question_finish(current_setting('t.b2')::uuid, 'failed', 0, null, 0.02, 'timeout', current_setting('t.key')) is null as f2 \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'Q15c. retry after a timeout runs at ' || effort || ' (expect medium)' from public.study_question_claim(current_setting('t.b2')::uuid, current_setting('t.key'));
reset role;
update public.study_question_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.b2')::uuid;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'Q15d. a part silent for 7 minutes can be taken over: part ' || part_idx || ' (expect 2)' from public.study_question_claim(current_setting('t.b2')::uuid, current_setting('t.key'));
select public.study_question_finish(current_setting('t.b2')::uuid, 'ready', 0, null, 0, null, current_setting('t.key')) is null as f2b \gset
select public.study_question_finish(b.id, 'ready', 0, null, 0, null, current_setting('t.key')) is null as f1 from public.study_question_batches b
 cross join lateral public.study_question_claim(b.id, current_setting('t.key')) c
 where b.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and b.part_idx = 1 \gset
select 'Q15e. all parts done, next tap: round ' || round || ', fresh ' || fresh || ' (expect 2, true)' from public.study_question_round('eeeeeeee-0000-4000-8000-000000000007');

-- Q16: a ceiling per lecture (80 active questions), so a loop cannot burn the budget,
-- and a part takes no more questions than it asked for
select set_config('t.b3', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and round = 2 and part_idx = 0), false) is not null as b3 \gset
select 'Q16. claimed round 2 part ' || part_idx || ', wants ' || wanted from public.study_question_claim(current_setting('t.b3')::uuid, current_setting('t.key'));
select 'Q16a. saved ' || count(*) from (select public.study_save_question(current_setting('t.b3')::uuid, null,
  jsonb_build_object('kind','mcq','question','שאלה ' || i || '?','options',jsonb_build_array('a','b','c','d','e'),
                     'answer', i % 5, 'explanations', jsonb_build_array('1','2','3','4','5'), 'slides', jsonb_build_array(1)), current_setting('t.key'))
  from generate_series(1, 2) i) x;
do $$ begin perform public.study_save_question(current_setting('t.b3')::uuid, null,
  '{"kind":"mcq","question":"שלישית?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[1]}', current_setting('t.key'));
  raise notice 'Q16b. FAIL: a part took more questions than it wanted';
exception when others then raise notice 'Q16b. %: a part takes what it asked for (%)', case when sqlerrm = 'part full' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- Fill the lecture to 79 active questions directly (as the database owner), then try two more.
reset role;
insert into public.study_questions (group_id, lecture_id, kind, question, options, slides)
select g.id, 'eeeeeeee-0000-4000-8000-000000000007', 'mcq', 'מילוי ' || i || '?', '{a,b,c,d,e}', '{1}'
from public.study_groups g, generate_series(1, 76) i;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.b4', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and round = 2 and part_idx = 1), false) is not null as b4 \gset
select 'Q16c. active now ' || (select count(*) from public.study_questions where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and retired_at is null)
       || ', claimed part ' || part_idx || ' (expect 79, 1)' from public.study_question_claim(current_setting('t.b4')::uuid, current_setting('t.key'));
select 'Q16d. the 80th is saved: ' || (public.study_save_question(current_setting('t.b4')::uuid, null,
  '{"kind":"mcq","question":"השמונים?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[5]}', current_setting('t.key')) is not null);
do $$ begin perform public.study_save_question(current_setting('t.b4')::uuid, null,
  '{"kind":"mcq","question":"ה-81?","options":["a","b","c","d","e"],"answer":1,"explanations":["1","2","3","4","5"],"slides":[5]}', current_setting('t.key'));
  raise notice 'Q16e. FAIL: an 81st active question was saved';
exception when others then raise notice 'Q16e. %: at most 80 active questions a lecture (%)', case when sqlerrm = 'enough questions' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'Q16f. finished ' || count(public.study_question_finish(b.id, 'ready', 0, null, 0, null, current_setting('t.key'))) || ' writing part(s)'
  from public.study_question_batches b where b.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and b.status = 'writing';
select 'Q16g. finished ' || count(public.study_question_finish(b.id, 'ready', 0, null, 0, null, current_setting('t.key'))) || ' pending part(s)'
  from public.study_question_batches b cross join lateral public.study_question_claim(b.id, current_setting('t.key')) c
 where b.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and b.status = 'pending';
do $$ begin perform public.study_question_round('eeeeeeee-0000-4000-8000-000000000007'); raise notice 'Q16h. FAIL: a third round was planned on a full lecture';
exception when others then raise notice 'Q16h. %: no new round on a full lecture (%)', case when sqlerrm = 'enough questions' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Q17: a past exam: an item without a key, keyed by the group, then explained
insert into public.study_exams (id, group_id, course, title, year, source_name, key_source)
values ('aaaaaaaa-1111-4000-8000-000000000001', :'gid', 'פתוגן מאכסן', 'מבחן 2024 מועד א', 2024, 'exam-2024a.pdf', 'none');
select set_config('t.x1', public.study_save_question(null, 'aaaaaaaa-1111-4000-8000-000000000001',
  '{"kind":"mcq","exam_no":12,"question":"מהו מנגנון הפעולה של Atovaquone?","options":["מעכבת cyt bc1","מעכבת DHFR","נקשרת ל-ergosterol","מעכבת את ה-30S"],"topic":"Atovaquone","aspect":"mechanism"}', current_setting('t.key'))::text, false) is not null as x1 \gset
select 'Q17. exam item saved without a key: has_key ' || has_key || ', ' || cardinality(options) || ' options (expect false, 4)' from public.study_questions where id = current_setting('t.x1')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_answer_question(current_setting('t.x1')::uuid, 0); raise notice 'Q17b. FAIL: answered an item with no key';
exception when others then raise notice 'Q17b. %: an item without a key is not practised (%)', case when sqlerrm = 'no key' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_set_exam_key(current_setting('t.x1')::uuid, 0) is null as keyed \gset
select 'Q17c. Noa keyed it: has_key ' || has_key || ' (expect true)' from public.study_questions where id = current_setting('t.x1')::uuid;
do $$ begin perform public.study_set_explanations(current_setting('t.x1')::uuid, array['1','2'], 'x', array[5], null, current_setting('t.key')); raise notice 'Q17d. FAIL: two explanations for four options';
exception when others then raise notice 'Q17d. %: one explanation per option (%)', case when sqlerrm like 'explanations%' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_set_explanations(current_setting('t.x1')::uuid, array['נכון [ש'' 6]','לא','לא','לא'], 'Atovaquone מעכבת cyt bc1. [ש'' 6]', array[6], 'eeeeeeee-0000-4000-8000-000000000007', current_setting('t.key')) is null as expl \gset
select 'Q17e. answered: correct ' || correct || ', ' || cardinality(explanations) || ' explanations (expect true, 4)' from public.study_answer_question(current_setting('t.x1')::uuid, 0, 'exam', 9000);
select 'Q17h. for explaining: ' || count(*) || ' item(s), key ' || max(answer) || ' (expect 1, 0: the exam item only, never a generated question''s key)'
  from public.study_exam_items_for_explain(array[current_setting('t.x1')::uuid, current_setting('t.q1')::uuid]);
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'Q17f. stranger sees ' || count(*) || ' exams, ' || (select count(*) from public.study_exam_items_for_explain(array[current_setting('t.x1')::uuid])) || ' items to explain (expect 0, 0)' from public.study_exams;
do $$ begin perform public.study_set_exam_key(current_setting('t.x1')::uuid, 1); raise notice 'Q17g. FAIL: stranger changed a key';
exception when others then raise notice 'Q17g. %: stranger cannot key (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Q18: the shared ledger (design-platform.md §3.5) takes the questions' spend as kind 'practice'
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_reserve(:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'practice', current_setting('t.b0'), 0.30, 33, 0.8, 0.4, null, null, :'key') as q_res \gset
select public.study_settle(:q_res, 'claude-opus-5-5', '{"output_tokens": 2300}'::jsonb, 0.061, :'key') as charged \gset
select 'Q18. spent this month: $' || public.study_spent(:'gid') || ' (expect at least 0.061)';

-- Q19: Realtime carries questions, parts, flags and exams; never keys or answers
reset role;
select 'Q19. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_exams, study_question_batches, study_question_flags, study_questions)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename in
  ('study_exams', 'study_question_batches', 'study_question_flags', 'study_questions', 'study_question_keys', 'study_answers');

-- Q20: not signed in
set role anon;
reset request.jwt.claim.sub;
do $$ declare n int; begin select count(*) into n from public.study_questions; raise notice 'Q20. anon sees % questions (expect 0)', n;
exception when insufficient_privilege then raise notice 'Q20. ok: anon cannot read questions (%)', sqlerrm; end $$;
do $$ begin perform public.study_answer_question(current_setting('t.q1')::uuid, 0); raise notice 'Q20b. FAIL: anon answered';
exception when insufficient_privilege then raise notice 'Q20b. ok: anon cannot call the functions (%)', sqlerrm; end $$;

-- Q21: deleting the lecture takes its questions, keys, answers, flags and parts; the spend stays
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_delete_lecture('eeeeeeee-0000-4000-8000-000000000007') is not null as q_hidden \gset
reset role;
select 'Q21a. hidden, not gone: ' || count(*) || ' question(s) still there for 30 days (expect 1 or more)' from public.study_questions where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' having count(*) > 0;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-000000000007';   -- the purge, 30 days later
select 'Q21. left for the lecture: ' || (select count(*) from public.study_questions where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007')
  || ' questions, ' || (select count(*) from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007')
  || ' parts, ' || (select count(*) from public.study_question_keys k where not exists (select 1 from public.study_questions q where q.id = k.question_id))
  || ' orphan keys, ' || (select count(*) from public.study_answers a where a.question_id = current_setting('t.q1')::uuid)
  || ' answers; ledger rows kept: ' || (select count(*) from public.study_usage where kind = 'practice' and lecture_id is null) || ' (expect 0, 0, 0, 0; 1)';
select 'Q21b. the exam item it explained survives, unlinked: ' || count(*) || ' (expect 1)' from public.study_questions where id = current_setting('t.x1')::uuid and ref_lecture is null;

-- ════ Review checks: B1 (S2), M6, UX-2, M10, M2 ════
reset role;
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by)
select 'eeeeeeee-0000-4000-8000-0000000000a7', :'gid', 'פתוגן מאכסן', 'Review', 'pptx',
       (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', '[]'::jsonb, 'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb))
          from generate_series(1, 6) n), 'bbbbbbbb-0000-4000-8000-000000000002';
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to) values ('eeeeeeee-0000-4000-8000-0000000000a7', 0, 'א', 1, 6);
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select round as ra from public.study_question_round('eeeeeeee-0000-4000-8000-0000000000a7') \gset
select set_config('t.ba', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000a7' and round = 1), false) is not null as have_ba \gset
do $$ begin perform public.study_question_claim(current_setting('t.ba')::uuid); raise notice 'QR1. FAIL: a member claimed a batch with her token alone';
exception when others then raise notice 'QR1. %: a member''s token alone cannot claim a batch (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_question(current_setting('t.ba')::uuid, null, '{"kind":"mcq","question":"מה נכון?","options":["א","ב"],"answer":0,"explanations":["x","y"],"slides":[1]}'); raise notice 'QR1b. FAIL: a member saved a question with a key she chose';
exception when others then raise notice 'QR1b. %: only the server saves a question and its key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- M6: three paid tries of a batch
select count(*) as t1 from public.study_question_claim(current_setting('t.ba')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_question_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.ba')::uuid;
set role authenticated;
select count(*) as t2 from public.study_question_claim(current_setting('t.ba')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_question_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.ba')::uuid;
set role authenticated;
select count(*) as t3 from public.study_question_claim(current_setting('t.ba')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_question_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.ba')::uuid;
set role authenticated;
do $$ begin perform public.study_question_claim(current_setting('t.ba')::uuid, current_setting('t.key')); raise notice 'QR2. FAIL: a fourth paid try of one batch';
exception when others then raise notice 'QR2. %: a batch gets three paid tries (%)', case when sqlerrm = 'gave up' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QR2b. tries ' || :t1 || :t2 || :t3 || '; the dead batch no longer holds its round: a new round ' || round || ', fresh ' || fresh || ' (expect 111; 2, true)'
  from public.study_question_round('eeeeeeee-0000-4000-8000-0000000000a7');
-- UX-2: a mistake clears only on a later study day
select set_config('t.bb', (select id::text from public.study_question_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000a7' and round = 2), false) is not null as have_bb \gset
select part_idx as pb from public.study_question_claim(current_setting('t.bb')::uuid, current_setting('t.key')) \gset
select set_config('t.qm', public.study_save_question(current_setting('t.bb')::uuid, null,
  '{"kind":"mcq","question":"מהי התרופה?","options":["Chloroquine","Primaquine","Atovaquone","Quinine","Artesunate"],"answer":0,"explanations":["נכון [ש'' 1]","לא","לא","לא","לא"],"takeaway":"x","slides":[1],"topic":"t","aspect":"uses","model":"claude-opus-5-5"}',
  current_setting('t.key'))::text, false) is not null as have_qm \gset
select correct as w1 from public.study_answer_question(current_setting('t.qm')::uuid, 1) \gset
select correct as r1 from public.study_answer_question(current_setting('t.qm')::uuid, 0) \gset
select 'UX2a. wrong, then right minutes later: still a mistake ' || count(*) || ' (expect 1)'
  from public.study_my_mistakes(:'gid', 'eeeeeeee-0000-4000-8000-0000000000a7');
reset role;
update public.study_answers set answered_at = answered_at - interval '2 days' where question_id = current_setting('t.qm')::uuid;
set role authenticated;
select correct as r2 from public.study_answer_question(current_setting('t.qm')::uuid, 0) \gset
select 'UX2b. right again on a later day: mistakes ' || count(*) || ' (expect 0)'
  from public.study_my_mistakes(:'gid', 'eeeeeeee-0000-4000-8000-0000000000a7');
select 'UX2c. the practice hub counts the same: wrong_now ' || wrong_now || ' (expect 0)'
  from public.study_practice_overview(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000a7';
select correct as w2 from public.study_answer_question(current_setting('t.qm')::uuid, 2) \gset
select 'UX2d. wrong again: back on the list ' || count(*) || ' (expect 1)'
  from public.study_my_mistakes(:'gid', 'eeeeeeee-0000-4000-8000-0000000000a7');
-- M10: the exams switch
reset role;
update study_private.features set enabled = false where name = 'exams';
set role authenticated;
do $$ begin insert into public.study_exams (id, group_id, title) values ('aaaaaaaa-1111-4000-8000-0000000000e2', (select id from public.study_groups limit 1), 'x'); raise notice 'QR3. FAIL: an exam came in while the switch is off';
exception when insufficient_privilege then raise notice 'QR3. ok: with exams switched off no exam comes in'; end $$;
reset role;
update study_private.features set enabled = true where name = 'exams';
set role authenticated;
-- M2: only its uploader deletes an exam, on its first day
insert into public.study_exams (id, group_id, title) values ('aaaaaaaa-1111-4000-8000-0000000000e3', :'gid', 'מבחן שהועלה בטעות');
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
delete from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
select 'QR4. Shoham cannot delete Noa''s exam: ' || count(*) || ' left (expect 1)' from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
reset role;
update public.study_exams set created_at = now() - interval '2 days' where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
delete from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
select 'QR4b. Noa cannot delete it after its first day: ' || count(*) || ' left (expect 1)' from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
reset role;
update public.study_exams set created_at = now() where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
set role authenticated;
delete from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
select 'QR4c. on its first day Noa deletes it: ' || count(*) || ' left (expect 0)' from public.study_exams where id = 'aaaaaaaa-1111-4000-8000-0000000000e3';
do $$ begin insert into public.study_exams (group_id, title, pages) values ((select id from public.study_groups limit 1), 'ארוך', (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 61) n)); raise notice 'QR5. FAIL: an exam of 61 pages';
exception when check_violation then raise notice 'QR5. ok: at most 60 pages an exam'; end $$;
select 'Q-reg. the registry: ' || (public.study_schema() ->> 'Q') || ' (expect 1)';
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000a7';
update study_private.features set enabled = false where name = 'exams';

-- Clean-up for the sections after this one (they count the group's answers):
-- the past exam goes, and its items, keys and answers with it.
reset role;
delete from public.study_exams where group_id = :'gid';

-- ════════════════════════════════════════════════════════════════════════
--  SECTION Z checks · the live group quiz   (package Z)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for quiz.sql (and questions-hold.sql), in the
-- style of supabase/tests/study.sql. Runs in the SAME psql session right
-- after supabase/tests/study.sql (it reuses that file's users, :gid and
-- :code). Throwaway local Postgres only. Time is simulated by moving a
-- round's times into the past (as the table owner), never by sleeping.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
reset role;

-- ── Fixtures (as the owner): two more members, a lecture with six keyed
--  questions (one flagged as wrong), a second lecture with two.
insert into auth.users (id, raw_user_meta_data) values
 ('ffffffff-0000-4000-8000-000000000006', '{"app":"study","full_name":"יעל"}'),
 ('abababab-0000-4000-8000-000000000007', '{"app":"study","full_name":"דנה"}');
insert into public.study_members (group_id, user_id, name) values
 (:'gid', 'ffffffff-0000-4000-8000-000000000006', 'יעל'),
 (:'gid', 'abababab-0000-4000-8000-000000000007', 'דנה');
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by) values
 ('eeeeeeee-0000-4000-8000-000000000009', :'gid', 'פתוגן מאכסן', 'Antimalarials', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 12) n), 'bbbbbbbb-0000-4000-8000-000000000002'),
 ('eeeeeeee-0000-4000-8000-00000000000a', :'gid', 'פתוגן מאכסן', 'Anthelmintics', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 6) n), 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, vignette, question, options, slides, topic, aspect)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, :'gid', 'eeeeeeee-0000-4000-8000-000000000009', 'ai', (i - 1) / 3,
       case when i in (2, 5) then 'case' else 'mcq' end,
       case when i in (2, 5) then repeat('אישה בת 30 חזרה מאפריקה עם חום. ', 40) else '' end,
       'שאלה מספר ' || i || '?', array['א' || i, 'ב' || i, 'ג' || i, 'ד' || i, 'ה' || i], array[i], 'Primaquine', 'contra'
  from generate_series(1, 6) i;
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, (i % 5)::smallint,
       array['הסבר 1 [ש'' 1]', 'הסבר 2', 'הסבר 3', 'הסבר 4', 'הסבר 5'], 'מה לזכור ' || i
  from generate_series(1, 6) i;
insert into public.study_question_flags (question_id, user_id, reason)
values ('99999999-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000003', 'wrong_key');
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, question, options, slides)
select ('88888888-0000-4000-8000-00000000000' || i)::uuid, :'gid', 'eeeeeeee-0000-4000-8000-00000000000a', 'ai', 0, 'mcq',
       'שאלה על תולעים ' || i || '?', array['a', 'b', 'c', 'd'], array[1]
  from generate_series(1, 2) i;
insert into public.study_question_keys (question_id, answer, explanations)
select ('88888888-0000-4000-8000-00000000000' || i)::uuid, 1, array['1', '2', '3', '4'] from generate_series(1, 2) i;

-- Moves the open round (and the quiz row's copy of its times) p_secs into the past.
create or replace function pg_temp.shift(p_quiz uuid, p_secs numeric) returns void language sql as $$
  update public.study_quiz_rounds set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                      closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where quiz_id = p_quiz and opens_at is not null and revealed_at is null;
  update public.study_quizzes set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                  closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where id = p_quiz;
$$;
-- The key of the round on screen (the test's oracle; no member can call this).
create or replace function pg_temp.key_now(p_quiz uuid) returns int language sql as $$
  select k.answer::int from public.study_quizzes z
    join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
    join public.study_question_keys k on k.question_id = r.question_id
   where z.id = p_quiz $$;
create or replace function pg_temp.q_now(p_quiz uuid) returns uuid language sql as $$
  select r.question_id from public.study_quizzes z join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
   where z.id = p_quiz $$;
-- Moves the open round so that its deadline was p_extra seconds ago.
create or replace function pg_temp.expire(p_quiz uuid, p_extra numeric) returns void language sql as $$
  select pg_temp.shift(p_quiz, (select extract(epoch from (z.closes_at - clock_timestamp()))::numeric + p_extra
                                  from public.study_quizzes z where z.id = p_quiz));
$$;
select set_config('t.gid', :'gid', false) is not null as g \gset
set role authenticated;

-- ═════════ 1. Creating ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.qz', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30)::text, false) is not null as qz \gset
select 'QZ1. ' || title || ' · ' || mode || ' · ' || state || ' · players ' || players_n || ' · host is Shoham: ' || (host_id = auth.uid())
       || ' (expect Antimalarials · coop · lobby · players 1 · true)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1b. FAIL: a second open quiz in one group';
exception when others then raise notice 'QZ1b. %: one open quiz per group (%)', case when sqlerrm = 'quiz open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'party', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1c. FAIL: unknown mode';
exception when others then raise notice 'QZ1c. %: modes are coop and race (%)', case when sqlerrm = 'bad mode' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 2, 30);
  raise notice 'QZ1c. FAIL: two questions';
exception when others then raise notice 'QZ1c. %: 3 to 30 questions (%)', case when sqlerrm = 'bad count' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 5);
  raise notice 'QZ1c. FAIL: five seconds';
exception when others then raise notice 'QZ1c. %: 15 to 120 seconds (%)', case when sqlerrm = 'bad seconds' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-0000000000ff']::uuid[], 5, 30);
  raise notice 'QZ1c. FAIL: a lecture that is not the group''s';
exception when others then raise notice 'QZ1c. %: lectures of the group only (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_quiz_create(current_setting('t.gid')::uuid, 'race', array['eeeeeeee-0000-4000-8000-000000000009']::uuid[], 5, 30);
  raise notice 'QZ1d. FAIL: a stranger opened a quiz';
exception when others then raise notice 'QZ1d. %: a stranger cannot open a quiz (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QZ1e. stranger sees ' || count(*) || ' quizzes (expect 0)' from public.study_quizzes;
do $$ begin perform public.study_quiz_state(current_setting('t.qz')::uuid); raise notice 'QZ1e. FAIL: stranger read the state';
exception when others then raise notice 'QZ1e. %: stranger cannot read the state (%)', case when sqlerrm = 'quiz not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_quiz_join(current_setting('t.qz')::uuid); raise notice 'QZ1e. FAIL: stranger joined';
exception when others then raise notice 'QZ1e. %: stranger cannot join (%)', case when sqlerrm = 'quiz not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ 2. Joining, and what members cannot touch ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select 'QZ2. Noa joined (twice): players ' || players_n || ', version ' || version || ' (expect 2, 2)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
do $$ begin perform public.study_quiz_next(current_setting('t.qz')::uuid, -1); raise notice 'QZ2b. FAIL: Noa started Shoham''s quiz';
exception when others then raise notice 'QZ2b. %: only the host starts (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_rounds; raise notice 'QZ2c. FAIL: rounds are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: rounds are not readable (%)', sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_answers; raise notice 'QZ2c. FAIL: answers are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: answers are not readable (%)', sqlerrm; end $$;
do $$ begin perform count(*) from public.study_quiz_players; raise notice 'QZ2c. FAIL: players are readable';
exception when insufficient_privilege then raise notice 'QZ2c. ok: players are not readable directly (%)', sqlerrm; end $$;
do $$ begin update public.study_quizzes set host_id = auth.uid(); raise notice 'QZ2d. FAIL: Noa made herself host';
exception when insufficient_privilege then raise notice 'QZ2d. ok: the quiz row changes only through the functions (%)', sqlerrm; end $$;
do $$ begin insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at) values (gen_random_uuid(), auth.uid(), 0, 0, now());
  raise notice 'QZ2d. FAIL: an answer was written directly';
exception when insufficient_privilege then raise notice 'QZ2d. ok: answers go through study_quiz_answer (%)', sqlerrm; end $$;

-- ═════════ 3. Starting: questions chosen, first round held ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.qz')::uuid, -1) is null as n \gset
select 'QZ3. started: ' || state || ', round ' || idx || ' of ' || n_total || ', opens in ' ||
       round(extract(epoch from (opens_at - clock_timestamp())))::int || ' s, version ' || version
       || ' (expect question, round 0 of 5, opens in 3 s, version 3)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
reset role;
select 'QZ3b. the flagged question was left out: ' || (not exists (select 1 from public.study_quiz_rounds
         where quiz_id = current_setting('t.qz')::uuid and question_id = '99999999-0000-4000-8000-000000000006'))
       || '; long cases get more time: ' || string_agg(distinct r.seconds::text, ',' order by r.seconds::text)
       || ' (expect true; 30,97)'
  from public.study_quiz_rounds r where r.quiz_id = current_setting('t.qz')::uuid;
select 'QZ3c. a group quiz keeps the lecture''s order: parts ' || string_agg(q.part_idx::text, ',' order by r.idx) || ' (expect 0,0,0,1,1)'
  from public.study_quiz_rounds r join public.study_questions q on q.id = r.question_id where r.quiz_id = current_setting('t.qz')::uuid;
select set_config('t.q0', pg_temp.q_now(current_setting('t.qz')::uuid)::text, false) is not null as q0 \gset
select set_config('t.k0', pg_temp.key_now(current_setting('t.qz')::uuid)::text, false) is not null as k0 \gset
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
values ('cccccccc-0000-4000-8000-000000000003', current_setting('t.q0')::uuid, 0, false, 'lecture', now() - interval '7 days');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ3d. Noa''s screen: round ' || (s -> 'round' ->> 'idx') || ', ' || jsonb_array_length(s -> 'round' -> 'q' -> 'options') || ' options; key sent: '
       || ((s -> 'round') ? 'answer') || ', explanations sent: ' || ((s -> 'round') ? 'explanations') || ' (expect 0, 5; false, false)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) as s) x;
do $$ begin perform public.study_answer_question(current_setting('t.q0')::uuid, 0); raise notice 'QZ3e. FAIL: practice gave the key of an open quiz round';
exception when others then raise notice 'QZ3e. %: practice refuses a question in an open round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QZ3f. feedback for it while open: ' || count(*) || ' rows (expect 0, although Noa answered it last week)'
  from public.study_question_feedback(array[current_setting('t.q0')::uuid]);

-- ═════════ 4. Answering ═════════
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 1); raise notice 'QZ4. FAIL: answered during the countdown';
exception when others then raise notice 'QZ4. %: no answer before the round opens (%)', case when sqlerrm = 'not open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select pg_temp.shift(current_setting('t.qz')::uuid, 5) is null as s \gset
set role authenticated;
-- Noa answers wrong on purpose: the key plus one.
select 'QZ4b. Noa answered option ' || choice || '; time taken 1.9-2.6 s: ' || (ms between 1900 and 2600)
       || '; the reply says nothing about right or wrong: ' || (answered_at is not null) || ' (expect key+1; true; true)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, (current_setting('t.k0')::int + 1) % 5);
select 'QZ4c. a second tap keeps the first: option ' || choice || ' (expect the same option)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ4d. the row now: answered ' || answered_n || ', version ' || version || ' (expect 1, 3: an answer is not a new step)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
select 'QZ4e. Noa''s screen keeps her choice: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' -> 'mine' ->> 'choice')
       || ' (expect key+1)';
do $$ begin perform public.study_quiz_reveal(current_setting('t.qz')::uuid, 0); raise notice 'QZ4f. FAIL: a player revealed before the time';
exception when others then raise notice 'QZ4f. %: a player cannot reveal early (%)', case when sqlerrm = 'too early' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 0); raise notice 'QZ4g. FAIL: a member who did not join answered';
exception when others then raise notice 'QZ4g. %: only players answer (%)', case when sqlerrm = 'not playing' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 0, 9); raise notice 'QZ4h. FAIL: option 9 of 5';
exception when others then raise notice 'QZ4h. %: the choice must be an option (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ 5. The reveal ═════════
-- Shoham (host) answers right; both players have answered, so the round is revealed at once.
select 'QZ5. Shoham answered ' || choice || ' (expect the key)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ5b. after the last answer: ' || state || ', answered ' || answered_n || ', version ' || version || ' (expect reveal, 2, 4)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ5c. Noa sees: key ' || (r ->> 'answer') || ', ' || jsonb_array_length(r -> 'explanations') || ' explanations, counts ' || (r -> 'counts')::text
       || ', right ' || (r ->> 'right') || ' of ' || (r ->> 'answered') || ', hers right: ' || (r ->> 'correct') || ', points ' || (r ->> 'points')
       || ' (expect the key, 5, one vote on the key and one next to it, 1 of 2, false, 0)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' as r) x;
select 'QZ5d. hold released: feedback now gives ' || count(*) || ' row (expect 1)'
  from public.study_question_feedback(array[current_setting('t.q0')::uuid]);
select 'QZ5e. Noa''s private record has her quiz answer: ' || count(*) || ' (expect 1, mode quiz, wrong)'
  from public.study_answers where question_id = current_setting('t.q0')::uuid and mode = 'quiz' and not correct;
select 'QZ5f. ...and none of Shoham''s: ' || count(*) || ' visible to Noa (expect 0)'
  from public.study_answers where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'QZ5g. a re-sent answer after the reveal changes nothing: ' || choice || ' (expect key+1, her first)'
  from public.study_quiz_answer(current_setting('t.qz')::uuid, 0, current_setting('t.k0')::int);
select 'QZ5h. a group quiz shows no one''s score: ' || coalesce(string_agg(p ->> 'score', ','), 'none') || ' (expect none)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'players') p;

-- ═════════ 6. A late joiner, and the next round ═════════
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_join(current_setting('t.qz')::uuid) is null as j \gset
select 'QZ6. Yael joined during round ' || (s -> 'me' ->> 'joined_idx') || '; players ' || (s -> 'quiz' ->> 'players_n') || ' (expect 0; 3)'
  from (select public.study_quiz_state(current_setting('t.qz')::uuid) as s) x;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.qz')::uuid, 0) is null as n \gset
select public.study_quiz_next(current_setting('t.qz')::uuid, 0) is null as n \gset
select 'QZ6b. a second tap on "next" did nothing: round ' || idx || ', state ' || state || ' (expect 1, question)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
reset role;
select set_config('t.k1', pg_temp.key_now(current_setting('t.qz')::uuid)::text, false) is not null as k1 \gset
select set_config('t.q1', pg_temp.q_now(current_setting('t.qz')::uuid)::text, false) is not null as q1 \gset
select pg_temp.shift(current_setting('t.qz')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ6c. Yael answers round 1: ' || choice || ' (expect the key)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 1, current_setting('t.k1')::int);
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ6d. Noa answers "לא יודעים": ' || coalesce(choice::text, 'null') || ' (expect null)' from public.study_quiz_answer(current_setting('t.qz')::uuid, 1, null);
select 'QZ6e. Shoham has not answered: ' || state || ', answered ' || answered_n || ' (expect question, 2)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;

-- ═════════ 7. The host's phone locks ═════════
reset role;
update public.study_quiz_players set seen_at = clock_timestamp() - interval '60 seconds'
 where quiz_id = current_setting('t.qz')::uuid and user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.expire(current_setting('t.qz')::uuid, 2) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ7. host here: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) ->> 'host_here') || ' (expect false)';
select public.study_quiz_reveal(current_setting('t.qz')::uuid, 1) is null as r \gset
select 'QZ7b. after the deadline Noa revealed it: ' || state || ' (expect reveal)' from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_answer(current_setting('t.qz')::uuid, 1, 0); raise notice 'QZ7b2. FAIL: an answer after the reveal';
exception when others then raise notice 'QZ7b2. %: no answers after the reveal (%)', case when sqlerrm = 'closed' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_next(current_setting('t.qz')::uuid, 1); raise notice 'QZ7c. FAIL: Noa moved on without being host';
exception when others then raise notice 'QZ7c. %: only the host moves on (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_quiz_take_host(current_setting('t.qz')::uuid) is null as t \gset
select 'QZ7d. Noa took over: host is Noa ' || (host_id = auth.uid()) || ' (expect true)' from public.study_quizzes where id = current_setting('t.qz')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_quiz_take_host(current_setting('t.qz')::uuid); raise notice 'QZ7e. FAIL: Shoham took it back while Noa is here';
exception when others then raise notice 'QZ7e. %: no take-over while the host is here (%)', case when sqlerrm = 'host here' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- Noa voids round 1 (the question was wrong): its answers leave everyone's private record.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_void(current_setting('t.qz')::uuid, 1) is null as v \gset
select 'QZ7f. voided: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'round' ->> 'voided')
       || '; Noa''s quiz answers to it left in her record: ' || (select count(*) from public.study_answers where question_id = current_setting('t.q1')::uuid)
       || ' (expect true; 0)';
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ7g. ...and Yael''s: ' || count(*) || ' (expect 0)' from public.study_answers where question_id = current_setting('t.q1')::uuid;

-- ═════════ 8. Every phone asleep at the deadline ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.qz')::uuid, 1) is null as n \gset
reset role;
select pg_temp.expire(current_setting('t.qz')::uuid, 6) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select 'QZ8. nobody revealed round 2; Yael''s next look reveals it: ' || (public.study_quiz_state(current_setting('t.qz')::uuid) -> 'quiz' ->> 'state')
       || ' (expect reveal)';
select 'QZ8b. her ping also answers with the clock and the version: ' || (server_now is not null) || ', ' || state || ', ' || version
       || ' (expect true, reveal, the same version as the row)'
  from public.study_quiz_ping(current_setting('t.qz')::uuid);

-- ═════════ 9. The end ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_end(current_setting('t.qz')::uuid) is null as e \gset
select 'QZ9. ended: ' || state || ', rounds revealed ' || (select count(*) from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'summary'))
       || ' (expect ended, 3)'
  from public.study_quizzes where id = current_setting('t.qz')::uuid;
select 'QZ9b. Noa''s summary: hers ' || string_agg(coalesce(s -> 'mine' ->> 'correct', '-'), ',' order by (s ->> 'idx')::int)
       || ', voided ' || string_agg(s ->> 'voided', ',' order by (s ->> 'idx')::int) || ' (expect false,false,-; false,true,false)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.qz')::uuid) -> 'summary') s;
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';
select 'QZ9c. Dana (a member who did not play) gets no summary: ' || coalesce(public.study_quiz_state(current_setting('t.qz')::uuid) ->> 'summary', 'null') || ' (expect null)';
select 'QZ9d. the banner after the end: ' || count(*) || ' open quiz (expect 0)' from public.study_quiz_open(:'gid');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ9e. recent: ' || mode || ', ' || rounds || ' rounds, group right ' || right_pct || '%, mine ' || my_correct || '/' || my_answered
       || ', rank ' || coalesce(my_rank::text, '-') || ' (expect coop, 2 rounds, 50%, 0/1, -)'
  from public.study_quiz_recent(:'gid');
reset role;
select 'QZ9f. no key is held any more: ' || count(*) || ' (expect 0)' from public.study_question_keys where held_until > now();
set role authenticated;

-- ═════════ 10. A race ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.rc', public.study_quiz_create(:'gid', 'race', array['eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 20, 'mcq')::text, false) is not null as rc \gset
select 'QZ10. title of a two-lecture race: ' || title || ' (expect פתוגן מאכסן · 2 הרצאות)' from public.study_quizzes where id = current_setting('t.rc')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_join(current_setting('t.rc')::uuid) is null as j \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_join(current_setting('t.rc')::uuid) is null as j \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.rc')::uuid, -1) is null as n \gset
reset role;
select 'QZ10b. only multiple-choice questions: ' || bool_and(q.kind = 'mcq') || ' (expect true)'
  from public.study_quiz_rounds r join public.study_questions q on q.id = r.question_id where r.quiz_id = current_setting('t.rc')::uuid;
select set_config('t.rk0', pg_temp.key_now(current_setting('t.rc')::uuid)::text, false) is not null as k \gset
select pg_temp.shift(current_setting('t.rc')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.ms_sh', (select ms::text from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, current_setting('t.rk0')::int)), false) is not null as a \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
do $$ begin perform public.study_quiz_answer(current_setting('t.rc')::uuid, 0, null); raise notice 'QZ10c. FAIL: "לא יודעים" in a race';
exception when others then raise notice 'QZ10c. %: a race has no "לא יודעים" (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_reveal(current_setting('t.rc')::uuid, 0); raise notice 'QZ10d. FAIL: the race host revealed early';
exception when others then raise notice 'QZ10d. %: in a race even the host waits for the clock (%)', case when sqlerrm = 'too early' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select pg_temp.shift(current_setting('t.rc')::uuid, 8) is null as s \gset
set role authenticated;
select set_config('t.ms_noa', (select ms::text from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, current_setting('t.rk0')::int)), false) is not null as a \gset
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 0, (current_setting('t.rk0')::int + 1) % 4) \gset
select 'QZ10e. all three answered: ' || state || ' (expect reveal)' from public.study_quizzes where id = current_setting('t.rc')::uuid;
select 'QZ10f. the table: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'score') || ' (+' || coalesce(p ->> 'last_points', '0') || ')', ', ' order by (p ->> 'score')::int desc)
       || '; Shoham''s is 500 + 500 × (time left / 20 s): ' ||
       bool_or((p ->> 'name') = 'שוהם' and (p ->> 'score')::int = 500 + floor(500.0 * (20000 - current_setting('t.ms_sh')::int) / 20000)::int)
       || ' (expect שוהם ≈950, נועה כהן ≈750, יעל 0; true)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p;
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';
select 'QZ10g. Dana, watching, sees no scores: ' || coalesce(string_agg(p ->> 'score', ','), 'none') || ' (expect none)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p;
-- Next round: a right answer must not move the table before the reveal.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_next(current_setting('t.rc')::uuid, 0) is null as n \gset
do $$ begin perform public.study_quiz_void(current_setting('t.rc')::uuid, 0); raise notice 'QZR1. FAIL: the race host voided a round after the next one opened';
exception when others then raise notice 'QZR1. %: in a race a round is voided only while it is current (%)', case when sqlerrm = 'too late' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select set_config('t.rk1', pg_temp.key_now(current_setting('t.rc')::uuid)::text, false) is not null as k \gset
select pg_temp.shift(current_setting('t.rc')::uuid, 4) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 1, current_setting('t.rk1')::int) \gset
select 'QZ10h. Yael answered right, her score before the reveal: ' || (p ->> 'score') || ' (expect 0)'
  from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p where p ->> 'name' = 'יעל';

-- ═════════ 11. Leaving ═════════
-- The host (Noa) leaves mid-round: the most recently seen player becomes host;
-- Shoham answers; everyone still playing has answered, so the round is revealed.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
reset role;
select 'QZ11. host after Noa left: ' || m.name || ', players ' || z.players_n || ' (expect יעל, 2)'
  from public.study_quizzes z join public.study_members m on m.user_id = z.host_id and m.group_id = z.group_id
 where z.id = current_setting('t.rc')::uuid;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select choice is not null as a from public.study_quiz_answer(current_setting('t.rc')::uuid, 1, (current_setting('t.rk1')::int + 2) % 4) \gset
select 'QZ11b. revealed once the two who stayed answered: ' || state || '; Yael''s score now ' ||
       (select (p ->> 'score') from jsonb_array_elements(public.study_quiz_state(current_setting('t.rc')::uuid) -> 'players') p where p ->> 'name' = 'יעל')
       || ' (expect reveal; more than 500)'
  from public.study_quizzes where id = current_setting('t.rc')::uuid;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_leave(current_setting('t.rc')::uuid) is null as l \gset
select 'QZ11c. the last one out ends it: ' || state || ' (expect ended)' from public.study_quizzes where id = current_setting('t.rc')::uuid;

-- ═════════ 12. Forgotten quizzes ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.old', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 30)::text, false) is not null as o \gset
reset role;
update public.study_quizzes set updated_at = now() - interval '25 minutes' where id = current_setting('t.old')::uuid;
update public.study_quiz_players set seen_at = now() - interval '25 minutes' where quiz_id = current_setting('t.old')::uuid;
set role authenticated;
select 'QZ12. the banner hides a lobby untouched for 25 minutes: ' || count(*) || ' (expect 0)' from public.study_quiz_open(:'gid');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.new', public.study_quiz_create(:'gid', 'coop', array['eeeeeeee-0000-4000-8000-00000000000a']::uuid[], 3, 30)::text, false) is not null as n \gset
select 'QZ12b. a new quiz closes it: old ' || (select state from public.study_quizzes where id = current_setting('t.old')::uuid)
       || ', new ' || state || '; banner ' || (select count(*) || ' quiz, in it: ' || string_agg(array_to_string(names, ', '), '') from public.study_quiz_open(:'gid'))
       || ' (expect cancelled, lobby; 1 quiz, in it: נועה כהן)'
  from public.study_quizzes where id = current_setting('t.new')::uuid;

-- ═════════ 13. A lecture deleted mid-quiz ═════════
select public.study_quiz_next(current_setting('t.new')::uuid, -1) is null as n \gset
reset role;
select pg_temp.shift(current_setting('t.new')::uuid, 5) is null as s \gset
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-00000000000a';   -- purged (a member's delete only hides it for 30 days)
set role authenticated;
select 'QZ13. the open round lost its question: ' || coalesce(public.study_quiz_state(current_setting('t.new')::uuid) -> 'round' ->> 'q', 'null') || ' (expect null)';
select public.study_quiz_reveal(current_setting('t.new')::uuid, 0) is null as r \gset
select 'QZ13b. its reveal voids it: ' || (public.study_quiz_state(current_setting('t.new')::uuid) -> 'round' ->> 'voided') || ' (expect true)';
select public.study_quiz_next(current_setting('t.new')::uuid, 0) is null as n \gset
select 'QZ13c. no rounds with a question left, so it ends: ' || state || ' (expect ended)' from public.study_quizzes where id = current_setting('t.new')::uuid;

-- ═════════ 14. The hold on past-exam keys (questions-hold.sql) ═════════
reset role;
insert into public.study_exams (id, group_id, course, title) values ('77777777-0000-4000-8000-000000000001', :'gid', 'פתוגן מאכסן', 'מבחן 2024 מועד א');
insert into public.study_questions (id, group_id, exam_id, exam_no, source, kind, question, options, ref_lecture)
values ('77777777-0000-4000-8000-000000000002', :'gid', '77777777-0000-4000-8000-000000000001', 3, 'exam', 'mcq', 'שאלה ממבחן?', array['a', 'b', 'c', 'd'], 'eeeeeeee-0000-4000-8000-000000000009');
insert into public.study_question_keys (question_id, answer, explanations, held_until)
values ('77777777-0000-4000-8000-000000000002', 2, array['1', '2', '3', '4'], now() + interval '5 minutes');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'QZ14. a held exam item is not handed out for explaining: ' || count(*) || ' (expect 0)'
  from public.study_exam_items_for_explain(array['77777777-0000-4000-8000-000000000002']::uuid[]);
do $$ begin perform public.study_set_exam_key('77777777-0000-4000-8000-000000000002', 0); raise notice 'QZ14b. FAIL: re-keyed during its round';
exception when others then raise notice 'QZ14b. %: no re-keying during its round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_set_explanations('77777777-0000-4000-8000-000000000002', array['1','2','3','4'], '', array[1], null, current_setting('t.key')); raise notice 'QZ14c. FAIL';
exception when others then raise notice 'QZ14c. %: no new explanations during its round (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_question_keys set held_until = now() - interval '1 second' where question_id = '77777777-0000-4000-8000-000000000002';
set role authenticated;
select 'QZ14d. an expired hold lets go by itself: ' || count(*) || ' (expect 1)'
  from public.study_exam_items_for_explain(array['77777777-0000-4000-8000-000000000002']::uuid[]);

-- ═════════ 15. Realtime, anon ═════════
reset role;
select 'QZ15. published quiz tables: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_quizzes)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'study\_quiz%';
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform count(*) from public.study_quizzes; raise notice 'QZ15b. FAIL: anon read quizzes';
exception when insufficient_privilege then raise notice 'QZ15b. ok: anon cannot read quizzes (%)', sqlerrm; end $$;
do $$ begin perform public.study_quiz_state(gen_random_uuid()); raise notice 'QZ15c. FAIL: anon called the state';
exception when insufficient_privilege then raise notice 'QZ15c. ok: anon cannot call the functions (%)', sqlerrm; end $$;
reset role;
-- Clean-up for the sections after this one (they count the group's answers):
-- the quizzes and the two fixture lectures go, with their questions and answers.
reset role;
delete from public.study_quizzes where group_id = :'gid';
delete from public.study_lectures where id in ('eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-00000000000a');

-- ════════════════════════════════════════════════════════════════════════
--  SECTION C checks · flashcards   (package C)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for the flashcards SQL (design-cards.md §6.1).
-- Appended to supabase/tests/study.sql: it runs in the same psql session,
-- after the existing checks, and reuses their users (Shoham bbbb…, Noa cccc…,
-- a stranger dddd…) and :gid. Every C line should read "ok" or the expected
-- value; "FAIL" means a rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
-- A lecture of 12 slides with text, a picture on slide 3, and no outline yet.
insert into public.study_lectures (id, group_id, title, course, source_kind, slides)
select 'eeeeeeee-0000-4000-8000-0000000000c1', :'gid', 'Antiparasitics', 'פתוגן מאכסן', 'pptx',
       jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Metronidazole PFOR ', 30)),
                                    'tables', '[]'::jsonb, 'notes', '',
                                    'figures', case when n = 3 then '[{"k":1,"path":"x/y/s3-1.jpg","w":800,"h":600}]'::jsonb else '[]'::jsonb end)
                 order by n)
from generate_series(1, 12) n;
select 'C1. Shoham plans: round ' || round || ', ' || batches || ' parts, ' || wanted || ' cards, fresh ' || fresh || ' (expect 1, 2, 16, true)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C2. Noa taps too: round ' || round || ', fresh ' || fresh || ' (expect 1, false: the same round)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1');
select set_config('t.b0', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and part_idx = 0), false) is not null as b0 \gset
select set_config('t.b1', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and part_idx = 1), false) is not null as b1 \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C3. Shoham claims part 0: slides ' || slide_from || '-' || slide_to || ', ' || wanted || ' wanted, effort ' || effort || ' (expect 1-6, 8, medium)'
  from public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key'));
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key')); raise notice 'C3b. FAIL: two phones write one part';
exception when others then raise notice 'C3b. %: Noa cannot take the same part (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.ca', public.study_save_card(current_setting('t.b0')::uuid,
  '{"kind":"qa","front":"איך Metronidazole הופכת לפעילה בתא אנאירובי?","back":"PFOR מחזר אותה לתוצרים רעילים.","extra":"","figure":"","slides":[2],"topic":"Metronidazole","aspect":"mechanism","model":"claude-opus-5-5"}', current_setting('t.key'))::text, false) is not null as ca \gset
select set_config('t.cb', public.study_save_card(current_setting('t.b0')::uuid,
  '{"kind":"cloze","front":"בזמן טיפול ב-Metronidazole ועד {{48 שעות}} אחריו אין לשתות אלכוהול.","back":"","extra":"","figure":"fig:3-1","slides":[3],"topic":"Metronidazole","aspect":"interactions"}', current_setting('t.key'))::text, false) is not null as cb \gset
select 'C4. two cards saved: ' || count(*) || ' cards, part made ' || (select made from public.study_card_batches where id = current_setting('t.b0')::uuid) || ' (expect 2, 2)'
  from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
do $$
declare cases text[][] := array[
  array['{"kind":"qa","front":"שאלה על שקף שאינו קיים?","back":"x","slides":[40]}', 'unknown slide'],
  array['{"kind":"qa","front":"שאלה מחוץ לחלק?","back":"x","slides":[9]}', 'outside the part'],
  array['{"kind":"cloze","front":"שתי {{השלמות}} באותו {{משפט}}.","back":"","slides":[2]}', 'bad cloze'],
  array['{"kind":"cloze","front":"השלמה {{עם}} תשובה נפרדת.","back":"עם","slides":[2]}', 'bad cloze'],
  array['{"kind":"qa","front":"שאלה בלי תשובה?","back":"   ","slides":[2]}', 'bad answer'],
  array['{"kind":"qa","front":"תמונה שלא קיימת?","back":"x","figure":"fig:4-1","slides":[4]}', 'unknown figure'],
  array['{"kind":"qa","front":"בלי שקפים?","back":"x","slides":[]}', 'no slides']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_save_card(current_setting('t.b0')::uuid, cases[i][1]::jsonb, current_setting('t.key'));
      raise notice 'C5.% FAIL: accepted (%)', i, cases[i][2];
    exception when others then
      raise notice 'C5.% %: refused, % (expect %)', i, case when sqlerrm = cases[i][2] then 'ok' else 'FAIL' end, sqlerrm, cases[i][2];
    end;
  end loop;
end $$;
do $$ begin perform public.study_save_card(current_setting('t.b0')::uuid, '{"kind":"qa","front":"היבט לא מוכר?","back":"x","slides":[2],"aspect":"toxicity"}', current_setting('t.key'));
  raise notice 'C5.8 FAIL: an unknown aspect was saved';
exception when check_violation then raise notice 'C5.8 ok: an unknown aspect is refused by the table (%)', sqlerrm; end $$;
do $$ declare i int; begin
  for i in 1 .. 6 loop
    perform public.study_save_card(current_setting('t.b0')::uuid, jsonb_build_object('kind', 'qa', 'front', 'שאלה מספר ' || i || '?', 'back', 'תשובה ' || i, 'slides', jsonb_build_array(i)), current_setting('t.key'));
  end loop;
end $$;
do $$ begin
  perform public.study_save_card(current_setting('t.b0')::uuid, '{"kind":"qa","front":"תשיעית?","back":"x","slides":[1]}', current_setting('t.key'));
  raise notice 'C6. FAIL: a part took more than it asked for';
exception when others then raise notice 'C6. %: the 9th card of an 8-card part is refused (%)', case when sqlerrm = 'part full' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_card_finish(current_setting('t.b0')::uuid, 'ready', 1, 'claude-opus-5-5', 0.031, null, current_setting('t.key'));
select 'C7. part 0 finished: ' || status || ', made ' || made || ', rejected ' || rejected || ', cost ' || cost_usd || ' (expect ready, 8, 1, 0.0310)'
  from public.study_card_batches where id = current_setting('t.b0')::uuid;
do $$ begin perform public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key')); raise notice 'C7b. FAIL: a finished part was claimed';
exception when others then raise notice 'C7b. %: a finished part cannot be claimed again (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- The group reads and fixes the deck
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C8. Noa sees ' || count(*) || ' cards and ' || (select count(*) from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' parts (expect 8, 2)'
  from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
do $$ begin update public.study_cards set front = 'x' where id = current_setting('t.ca')::uuid; raise notice 'C9. FAIL: a card was changed directly';
exception when insufficient_privilege then raise notice 'C9. ok: no direct update (%)', sqlerrm; end $$;
do $$ begin insert into public.study_cards (group_id, lecture_id, kind, front, back) values ((select id from public.study_groups limit 1), 'eeeeeeee-0000-4000-8000-0000000000c1', 'qa', 'xxx', 'y'); raise notice 'C9b. FAIL: a card was inserted directly';
exception when insufficient_privilege then raise notice 'C9b. ok: no direct insert (%)', sqlerrm; end $$;
do $$ begin delete from public.study_cards where id = current_setting('t.ca')::uuid; raise notice 'C9c. FAIL: a card was deleted directly';
exception when insufficient_privilege then raise notice 'C9c. ok: no direct delete (%)', sqlerrm; end $$;
select set_config('t.u0', (select updated_at::text from public.study_cards where id = current_setting('t.ca')::uuid), false) is not null as u0 \gset
select 'C10. Noa fixes the card: version ' || public.study_edit_card(current_setting('t.ca')::uuid, 1,
  '{"back":"PFOR מעביר אלקטרונים ל-ferredoxin, שמחזר את קבוצת ה-NO₂ שלה לתוצרים רעילים."}') || ' (expect 2)';
select 'C10b. edited by Noa: ' || (updated_by = 'cccccccc-0000-4000-8000-000000000003') || ', updated_at raised: ' || (updated_at > current_setting('t.u0')::timestamptz)
  || ', history: ' || (select string_agg(action || ' v' || version || ' by ' || left(edited_by::text, 4) || ' before "' || left(before ->> 'back', 10) || '"', '; ') from public.study_card_edits where card_id = current_setting('t.ca')::uuid)
  || ' (expect true, true, edit v2 by cccc before "PFOR מחזר ")'
  from public.study_cards where id = current_setting('t.ca')::uuid;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 1, '{"back":"גרסה ישנה"}'); raise notice 'C11. FAIL: an edit of an old version went through';
exception when others then raise notice 'C11. %: editing a version someone already changed is a conflict (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 2, '{}'); raise notice 'C11b. FAIL: an empty edit made a version';
exception when others then raise notice 'C11b. %: saving without a change does nothing (%)', case when sqlerrm = 'no change' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 2, '{"kind":"cloze","front":"אין כאן השלמה."}'); raise notice 'C11c. FAIL: a cloze without braces was saved';
exception when others then raise notice 'C11c. %: an edit keeps the card rules (%)', case when sqlerrm = 'bad cloze' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_revert_card((select id from public.study_card_edits where card_id = current_setting('t.ca')::uuid and action = 'edit')) as v12 \gset
select 'C12. Shoham undoes the fix: version ' || :'v12' || ', back "' || back || '", history ' || (select string_agg(action, ',' order by edited_at) from public.study_card_edits where card_id = current_setting('t.ca')::uuid)
  || ' (expect 3, "PFOR מחזר אותה לתוצרים רעילים.", edit,revert)' from public.study_cards where id = current_setting('t.ca')::uuid;
select set_config('t.u1', (select updated_at::text from public.study_cards where id = current_setting('t.cb')::uuid), false) is not null as u1 \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_delete_card(current_setting('t.cb')::uuid, true);
select public.study_delete_card(current_setting('t.cb')::uuid, true);
select 'C13. Noa deletes the cloze (twice): deleted ' || (deleted_at is not null) || ' by Noa ' || (deleted_by = 'cccccccc-0000-4000-8000-000000000003')
  || ', updated_at raised ' || (updated_at > current_setting('t.u1')::timestamptz) || ', version ' || version || ' (expect true, true, true, 1)'
  from public.study_cards where id = current_setting('t.cb')::uuid;
do $$ begin perform public.study_edit_card(current_setting('t.cb')::uuid, 1, '{"front":"בזמן טיפול ועד {{48 שעות}} אחריו."}'); raise notice 'C13b. FAIL: a deleted card was edited';
exception when others then raise notice 'C13b. %: a deleted card is not edited (%)', case when sqlerrm = 'card deleted' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_delete_card(current_setting('t.cb')::uuid, false);
select 'C13c. Shoham restores it: deleted ' || (deleted_at is not null) || '; history ' || (select string_agg(action, ',' order by edited_at) from public.study_card_edits where card_id = current_setting('t.cb')::uuid)
  || ' (expect false; delete,restore)' from public.study_cards where id = current_setting('t.cb')::uuid;

-- A stranger
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'C14. stranger sees ' || count(*) || ' cards, ' || (select count(*) from public.study_card_edits) || ' history rows, ' || (select count(*) from public.study_card_batches) || ' parts (expect 0, 0, 0)' from public.study_cards;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 3, '{"back":"x"}'); raise notice 'C14b. FAIL: stranger edited';
exception when others then raise notice 'C14b. %: stranger cannot edit (%)', case when sqlerrm = 'card not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_delete_card(current_setting('t.ca')::uuid, true); raise notice 'C14c. FAIL: stranger deleted';
exception when others then raise notice 'C14c. %: stranger cannot delete (%)', case when sqlerrm = 'card not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C14d. FAIL: stranger planned a round';
exception when others then raise notice 'C14d. %: stranger cannot generate (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Reviewing: private, idempotent, checked, undoable
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C15. Shoham answers טוב on a new card: ' || public.study_card_review('aaaa0001-0000-4000-8000-000000000001', current_setting('t.ca')::uuid, 3, now(), 4200, 0,
  jsonb_build_object('state', 1, 'step', 1, 'stability', 2.3065, 'difficulty', 2.11810397, 'due', now() + interval '10 minutes', 'lapses', 0)) || ' (expect ok)';
select 'C15b. the same answer sent again: ' || public.study_card_review('aaaa0001-0000-4000-8000-000000000001', current_setting('t.ca')::uuid, 3, now(), 4200, 0,
  jsonb_build_object('state', 1, 'step', 1, 'stability', 2.3065, 'difficulty', 2.11810397, 'due', now() + interval '10 minutes', 'lapses', 0))
  || '; reviews ' || (select count(*) from public.study_card_reviews) || ', reps ' || (select reps from public.study_card_states where card_id = current_setting('t.ca')::uuid) || ' (expect dup; 1, 1)';
do $$
declare cases text[][] := array[
  array['0', '3', '{"state":1,"step":1,"stability":2.3,"difficulty":2.1,"lapses":0}', 'stale'],
  array['1', '5', '{"state":2,"step":0,"stability":3,"difficulty":2,"lapses":0}', 'bad rating'],
  array['1', '3', '{"state":2,"step":0,"stability":0,"difficulty":2,"lapses":0}', 'bad state'],
  array['1', '3', '{"state":2,"step":0,"stability":3,"difficulty":11,"lapses":0}', 'bad state'],
  array['1', '3', '{"state":2,"step":0,"stability":3,"difficulty":2,"lapses":1}', 'bad state'],
  array['1', '3', '{"state":0,"step":0,"stability":3,"difficulty":2,"lapses":0}', 'bad state']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, cases[i][2]::int, now(), 1000, cases[i][1]::int,
                                       cases[i][3]::jsonb || jsonb_build_object('due', now() + interval '2 days'));
      raise notice 'C16.% FAIL: accepted (%)', i, cases[i][4];
    exception when others then
      raise notice 'C16.% %: refused, % (expect %)', i, case when sqlerrm = cases[i][4] then 'ok' else 'FAIL' end, sqlerrm, cases[i][4];
    end;
  end loop;
  begin
    perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 3, now() + interval '1 day', 1000, 1,
      jsonb_build_object('state', 2, 'step', 0, 'stability', 3, 'difficulty', 2, 'lapses', 0, 'due', now() + interval '3 days'));
    raise notice 'C16.7 FAIL: an answer from tomorrow was accepted';
  exception when others then raise notice 'C16.7 %: refused, % (expect bad time)', case when sqlerrm = 'bad time' then 'ok' else 'FAIL' end, sqlerrm;
  end;
  begin
    perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 3, now(), 1000, 1,
      jsonb_build_object('state', 2, 'step', 0, 'stability', 3, 'difficulty', 2, 'lapses', 0, 'due', now() - interval '1 day'));
    raise notice 'C16.8 FAIL: a due time before the answer was accepted';
  exception when others then raise notice 'C16.8 %: refused, % (expect bad state)', case when sqlerrm = 'bad state' then 'ok' else 'FAIL' end, sqlerrm;
  end;
end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C17. Noa sees ' || count(*) || ' states and ' || (select count(*) from public.study_card_reviews) || ' reviews (expect 0, 0: Shoham''s are hers)' from public.study_card_states;
do $$ begin insert into public.study_card_states (user_id, card_id, state) values ('bbbbbbbb-0000-4000-8000-000000000002', current_setting('t.ca')::uuid, 0); raise notice 'C17b. FAIL: a state was written directly';
exception when insufficient_privilege then raise notice 'C17b. ok: states are written only by the functions (%)', sqlerrm; end $$;
do $$ begin perform public.study_card_undo('aaaa0001-0000-4000-8000-000000000001'); raise notice 'C17c. FAIL: Noa undid Shoham''s answer';
exception when others then raise notice 'C17c. %: nobody undoes someone else''s answer (%)', case when sqlerrm = 'review not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_card_review('aaaa0002-0000-4000-8000-000000000002', current_setting('t.ca')::uuid, 3, now(), 3000, 1,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 2.3065, 'difficulty', 2.11121424, 'due', now() + interval '2 days', 'lapses', 0));
do $$ begin perform public.study_card_undo('aaaa0001-0000-4000-8000-000000000001'); raise notice 'C18. FAIL: an older answer was undone first';
exception when others then raise notice 'C18. %: only the latest answer can be undone (%)', case when sqlerrm = 'not the latest' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_card_undo('aaaa0002-0000-4000-8000-000000000002');
select 'C18b. undo the latest: state ' || state || ', step ' || step || ', reps ' || reps || ' (expect 1, 1, 1)' from public.study_card_states where card_id = current_setting('t.ca')::uuid;
select public.study_card_undo('aaaa0001-0000-4000-8000-000000000001');
select 'C18c. undo the first: ' || count(*) || ' state rows, ' || (select count(*) from public.study_card_reviews) || ' reviews (expect 0, 0: the card is new again)'
  from public.study_card_states where card_id = current_setting('t.ca')::uuid;

-- Hiding, counts, the study day
select public.study_card_hide(current_setting('t.cb')::uuid, true);
-- One card in review due earlier today, one learning card due in 5 minutes.
select public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 4, now() - interval '9 days', 2000, 0,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 8.2956, 'difficulty', 1, 'due', now() - interval '1 day', 'lapses', 0));
select public.study_card_review(gen_random_uuid(), (select id from public.study_cards where front = 'שאלה מספר 1?'), 1, now(), 2000, 0,
  jsonb_build_object('state', 1, 'step', 0, 'stability', 0.212, 'difficulty', 6.4133, 'due', now() + interval '5 minutes', 'lapses', 0));
select 'C19. Shoham''s counts: cards ' || cards || ', new ' || new_cards || ', learning ' || learning_due || ', review ' || review_due
  || ', studied ' || studied || ', hidden ' || hidden || ' (expect 8, 5, 1, 1, 2, 1)'
  from public.study_my_card_counts(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C19b. Noa''s counts: new ' || new_cards || ', review ' || review_due || ', hidden ' || hidden || ' (expect 8, 0, 0: hiding and answers are Shoham''s own)'
  from public.study_my_card_counts(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C20. today''s numbers: ' || reviews || ' answers, ' || first_seen || ' first seen, ' || again || ' שוב (expect 1, 1, 1: the 9-days-ago answer is another day)'
  from public.study_my_card_days(:'gid') where day = date '1970-01-01' + public.study_day(now());
select 'C21. weak points: ' || topic || '/' || aspect || ' studied ' || studied || ' of ' || cards || ', recall now ' || recall || ' (expect Metronidazole/mechanism 1 of 1, 0.894: 9 days after an S = 8.3 answer)'
  from public.study_my_card_topics(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and topic = 'Metronidazole' and aspect = 'mechanism';
select 'C22. study days: ' || public.study_day('2026-01-10 01:59:00+00') || ', ' || public.study_day('2026-01-10 02:00:00+00') || ', '
  || public.study_day('2026-07-10 00:59:00+00') || ', ' || public.study_day('2026-07-10 01:00:00+00') || ' (expect 20462, 20463, 20643, 20644: 04:00 in Israel, winter and summer)';
select 'C22b. day ends: ' || to_char(public.study_day_end('2026-11-16 12:00+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') || ', '
  || to_char(public.study_day_end('2026-11-17 03:30+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') || ', '
  || to_char(public.study_day_end('2026-03-27 01:30+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI')
  || ' (expect 2026-11-17 04:00, 2026-11-17 04:00, 2026-03-27 04:00)';
select 'C23. recall at S days: ' || round(public.study_card_recall(10, 10)::numeric, 4) || ', at 0: ' || public.study_card_recall(10, 0) || ' (expect 0.9000, 1)';
-- Settings: one's own, on every device
insert into public.study_card_settings (new_per_day, retention) values (30, 0.92)
  on conflict (user_id) do update set new_per_day = excluded.new_per_day, retention = excluded.retention, updated_at = now();
select 'C24. Shoham''s settings: ' || new_per_day || ' new a day, retention ' || retention || ' (expect 30, 0.92)' from public.study_card_settings;
do $$ begin update public.study_card_settings set new_per_day = 300; raise notice 'C24b. FAIL: 300 new cards a day';
exception when check_violation then raise notice 'C24b. ok: limits hold (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C24c. Noa sees ' || count(*) || ' settings rows (expect 0)' from public.study_card_settings;
do $$ begin insert into public.study_card_settings (user_id, new_per_day) values ('bbbbbbbb-0000-4000-8000-000000000002', 1); raise notice 'C24d. FAIL: Noa wrote Shoham''s settings';
exception when insufficient_privilege then raise notice 'C24d. ok: nobody writes someone else''s settings (%)', sqlerrm; end $$;
-- A member's own card
select public.study_add_card('eeeeeeee-0000-4000-8000-0000000000c1',
    '{"kind":"qa","front":"איזו תופעת לוואי של Metronidazole מחייבת הפסקת טיפול?","back":"פרכוסים.","slides":[7],"topic":"Metronidazole","aspect":"adverse"}') as c25 \gset
select 'C25. Noa adds a card: source ' || source || ', part ' || coalesce(part_idx::text, 'none') || ', by Noa ' || (created_by = 'cccccccc-0000-4000-8000-000000000003')
  || ', cards now ' || (select count(*) from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' (expect member, none, true, 9)'
  from public.study_cards where id = :'c25';
do $$ begin perform public.study_add_card('eeeeeeee-0000-4000-8000-0000000000c1', '{"kind":"cloze","front":"אין כאן סוגריים.","slides":[7]}'); raise notice 'C25b. FAIL';
exception when others then raise notice 'C25b. %: a member''s card keeps the rules (%)', case when sqlerrm = 'bad cloze' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_card_review('aaaa0003-0000-4000-8000-000000000003', current_setting('t.ca')::uuid, 3, now(), 1500, 1,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 20.5, 'difficulty', 1, 'due', now() + interval '20 days', 'lapses', 0));
select 'C21b. answering the card again: undo copies left ' || count(*) filter (where prev is not null) || ' of ' || count(*)
  || ' (expect 1 of 2: the 9-day-old copy is gone, today''s stays)' from public.study_card_reviews where card_id = current_setting('t.ca')::uuid;
do $$ begin perform public.study_card_undo((select id from public.study_card_reviews where card_id = current_setting('t.ca')::uuid and prev is null)); raise notice 'C21c. FAIL: an old answer was undone';
exception when others then raise notice 'C21c. %: an old answer cannot be undone (%)', case when sqlerrm in ('not the latest', 'too old') then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'C26. reset: ' || public.study_card_reset('eeeeeeee-0000-4000-8000-0000000000c1') || ' states removed, reviews kept ' || (select count(*) from public.study_card_reviews) || ' (expect 3, 3)';

-- Caps, publication, deletion, anon
-- Part 1 never got written: it fails, so round 1 is closed and the cap is what decides.
select 'C27a. part 1: ' || slide_from || '-' || slide_to from public.study_card_claim(current_setting('t.b1')::uuid, current_setting('t.key'));
select public.study_card_finish(current_setting('t.b1')::uuid, 'failed', 0, null, 0, 'timeout', current_setting('t.key'));
reset role;
insert into public.study_cards (group_id, lecture_id, kind, front, back, slides)
select :'gid', 'eeeeeeee-0000-4000-8000-0000000000c1', 'qa', 'מילוי ' || i || '?', 'x', '{1}' from generate_series(1, 141) i;
set role authenticated;
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C27. FAIL: a round was planned on a full lecture';
exception when others then raise notice 'C27. %: at 150 active cards a lecture takes no more (%)', case when sqlerrm = 'enough cards' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'C28. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_card_batches, study_card_edits, study_cards)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'study\_card%';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_delete_lecture('eeeeeeee-0000-4000-8000-0000000000c1') is not null as c_hidden \gset
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C28b. FAIL: a round on a deleted lecture';
exception when others then raise notice 'C28b. %: a deleted lecture takes no new round (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000c1';   -- the purge, 30 days later
select 'C29. after purging the lecture: ' || (select count(*) from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' cards, '
  || (select count(*) from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' parts, '
  || (select count(*) from public.study_card_states) || ' states, ' || (select count(*) from public.study_card_reviews) || ' reviews, '
  || (select count(*) from public.study_card_edits) || ' history rows (expect all 0)';

-- ════ Review checks: B1, M6 ════
reset role;
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
select 'eeeeeeee-0000-4000-8000-0000000000c2', :'gid', 'Review cards', 'pptx',
       jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Primaquine G6PD ', 30)),
                                    'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb) order by n), 'bbbbbbbb-0000-4000-8000-000000000002'
from generate_series(1, 6) n;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select round as rc from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c2') \gset
select set_config('t.bc', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c2' order by part_idx limit 1), false) is not null as have_bc \gset
do $$ begin perform public.study_card_claim(current_setting('t.bc')::uuid); raise notice 'CR1. FAIL: a member claimed a card batch with her token alone';
exception when others then raise notice 'CR1. %: a member''s token alone cannot claim (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_card(current_setting('t.bc')::uuid, '{"kind":"qa","front":"מה זה?","back":"x","slides":[1]}'); raise notice 'CR1b. FAIL: a member saved a card marked as Claude''s';
exception when others then raise notice 'CR1b. %: a card marked ai is saved only by the server (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select count(*) as c1 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
select count(*) as c2 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
select count(*) as c3 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
do $$ begin perform public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')); raise notice 'CR2. FAIL: a fourth paid try of one batch';
exception when others then raise notice 'CR2. %: a batch gets three paid tries (%)', case when sqlerrm = 'gave up' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'CR2b. tries ' || :c1 || :c2 || :c3 || '; the round is no longer held open: next round ' || round || ', fresh ' || fresh || ' (expect 111; 2, true)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c2');
select 'C-reg. the registry: ' || (public.study_schema() ->> 'C') || ' (expect 1)';
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000c2';
set role anon;
reset request.jwt.claim.sub;
do $$ declare n int; begin select count(*) into n from public.study_cards; raise notice 'C30. FAIL: anon read % cards', n;
exception when insufficient_privilege then raise notice 'C30. ok: anon cannot read cards (%)', sqlerrm; end $$;
do $$ begin perform public.study_my_card_counts('22222222-2222-4222-8222-222222222222'); raise notice 'C30b. FAIL: anon called a function';
exception when insufficient_privilege then raise notice 'C30b. ok: anon cannot call the functions (%)', sqlerrm; end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════
--  SECTION K checks · corrections, shared answers, memory aids   (package K)
-- ════════════════════════════════════════════════════════════════════════
-- Behaviour test for sql/collab.sql, on a throwaway local Postgres (never the
-- real project). Runs after supabase/tests/study.sql in the same database
-- (its users and group). Every line reads "ok ..." or a value; "FAIL" means
-- a rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
select set_config('t.gid', :'gid', false) is not null as have_gid \gset
-- A lecture with two parts written by the summary writer (as the owner, like section.ts would).
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
values ('eeeeeeee-0000-4000-8000-000000000007', :'gid', 'Corrections test', 'pptx', '[]'::jsonb, 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
('eeeeeeee-0000-4000-8000-000000000007', 0, 'Metronidazole: מנגנון ושימושים', 4, 7, 'pending', ''),
('eeeeeeee-0000-4000-8000-000000000007', 1, 'Tidy', 3, 3, 'pending', '');
select 'K1. new parts start at rev ' || min(rev) || ', gen ' || min(gen) || ' (expect 0, 0)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
-- The writer claims and finishes part 0 (status writing, then ready with text).
update public.study_sections set status = 'writing', markdown = '' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
update public.study_sections set status = 'ready', markdown = $md$## Metronidazole: מנגנון ושימושים

### מנגנון פעולה

**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]

- Headache
- Headache
- Metallic taste

> **שימו לב:** בשקף 7 כתוב 48 שעות. [ש' 7]

**טבלה: Amebicides** [ש' 4]

| קבוצה | תרופות |
|---|---|
| Luminal | Paromomycin |
| Mixed | Metronidazole |

![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)$md$
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
update public.study_sections set status = 'ready', markdown = E'## Tidy\n\nהטווח הוא 7 – 31 ימים.‏ [ש'' 3]'
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1;
select 'K2. after one writing: rev ' || rev || ', gen ' || gen || ' (expect 1, 1: the first text is rev 1)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;

set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';   -- Noa, a member
do $$ begin update public.study_sections set rev = 99, gen = 99 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1;
  raise notice 'K3. % (expect rev 1, gen 1: a client cannot set the counters)', (select 'rev ' || rev || ', gen ' || gen from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1);
exception when insufficient_privilege then raise notice 'K3. ok: after W2 a member cannot write a part at all';
end $$;

-- C4. Noa corrects the paragraph (anchor 2), with a note.
select 'K4. ' || case when (r ->> 'rev')::int = 2 and (r ->> 'merged')::boolean = false then 'ok: saved, rev 2' else 'FAIL ' || r::text end
  from (select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
    $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
    $a$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR או hydrogenase. [ש' 5]$a$,
    1, 1, 1, 'בשקף 5 מופיע גם hydrogenase') as r) x;
select 'K5. ' || case when markdown like '%PFOR או hydrogenase. [ש'' 5]%' and markdown like '## Metronidazole%' and markdown like '%(fig:7-1)'
                       and (length(markdown) - length(replace(markdown, E'\n\n', ''))) / 2 = 7 then 'ok: only that paragraph changed, the 7 gaps between blocks kept' else 'FAIL ' || markdown end
  from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
select 'K6. history: ' || count(*) || ' row, author Noa: ' || bool_and(author_id = 'cccccccc-0000-4000-8000-000000000003') || ', kind ' || min(kind) || ', anchor ' || min(anchor) || ', gen ' || min(gen) || ', note kept: ' || bool_and(note <> '')
  from public.study_edits where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';

-- C7. Shoham, editor opened at rev 2, corrects ANOTHER paragraph (the box): merged.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'K7. ' || case when (r ->> 'merged')::boolean and (r ->> 'rev')::int = 3 then 'ok: other paragraph changed meanwhile, merged' else 'FAIL ' || r::text end
  from (select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 6,
    $b$> **שימו לב:** בשקף 7 כתוב 48 שעות. [ש' 7]$b$, $a$> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש' 7]$a$, 1, 1) as r) x;
-- C8. Shoham, also from rev 2, corrects the paragraph Noa already changed: conflict.
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
    $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
    $a$**מנגנון פעולה:** Metronidazole היא prodrug. [ש' 5]$a$, 1, 1);
  raise notice 'K8. FAIL: a stale correction overwrote a newer one';
exception when others then
  if sqlerrm = 'edit conflict' then raise notice 'K8. ok: same paragraph changed meanwhile -> edit conflict'; else raise notice 'K8. FAIL: %', sqlerrm; end if;
end $$;

-- C9. Duplicate items: with the current rev, occurrence 2 is the second "- Headache".
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 4, '- Headache', '- Nausea', 3, 1, 2) as r \gset
select 'K9. ' || case when not (:'r'::jsonb ->> 'merged')::boolean and markdown like E'%- Headache\n- Nausea\n- Metallic taste%' then 'ok: the second of two identical items changed' else 'FAIL ' || markdown end
  from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
-- C10. Same text twice and a stale rev: no guessing.
reset role;
update public.study_sections set markdown = replace(markdown, '- Nausea', '- Headache') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 3, '- Headache', '- Dizziness', 4, 1, 1);  -- rev is 5 now
  raise notice 'K10. FAIL: an ambiguous block was edited on a stale rev';
exception when others then
  if sqlerrm = 'edit conflict' then raise notice 'K10. ok: ambiguous text on a stale rev -> edit conflict'; else raise notice 'K10. FAIL: %', sqlerrm; end if;
end $$;

-- C11. Edits that would move anchors (or touch what is not text) are refused.
do $$
declare
  cur int := (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0);
  c record;
  n_ok int := 0;
begin
  for c in select * from (values
    ('blank line',      0, '### מנגנון פעולה', E'### מנגנון\n\nפעולה'),
    ('heading level',   1, '### מנגנון פעולה', '#### מנגנון פעולה'),
    ('heading -> text', 1, '### מנגנון פעולה', 'מנגנון פעולה'),
    ('para -> list',    2, 'x', '- x'),
    ('item marker',     3, '- Headache', '* Headache'),
    ('item -> para',    3, '- Headache', 'Headache'),
    ('box label',       6, E'> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש'' 7]', E'> **הרחבה (לא מהשקפים):** בשקף 7 כתוב 48 שעות. [ש'' 7]'),
    ('box -> para',     6, E'> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש'' 7]', 'בשקף 7 כתוב 48 שעות.'),
    ('table add row',   8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |\n| X | Y |'),
    ('table columns',   8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות | עוד |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |'),
    ('table delimiter', 8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|:---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |'),
    ('table backslash', 8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin\\\\|\n| Mixed | Metronidazole |'),
    ('figure ref',      9, '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני זהב](fig:7-2)'),
    ('figure bracket',  9, '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני [זהב](fig:7-1)'),
    ('rule',            2, 'x', '---'),
    ('html',            2, 'x', '<div>x</div>'),
    ('link definition', 2, 'x', '[ש]: http://x'),
    ('code fence',      2, 'x', '```'),
    ('indented code',   2, 'x', '    x'),
    ('two lines',       2, 'x', E'x\ny')
  ) as t(label, anchor, before, after) loop
    begin
      perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, c.anchor, c.before, c.after, cur, 1, 1);
      raise notice 'K11. FAIL: % was accepted', c.label;
    exception when others then
      if sqlerrm = 'bad block' then n_ok := n_ok + 1;
      else raise notice 'K11. FAIL: % refused for another reason: %', c.label, sqlerrm; end if;
    end;
  end loop;
  raise notice 'K11. ok: % of 20 structure-changing edits refused as bad block', n_ok;
end $$;
-- C12. A table cell and a figure caption can be corrected (rows, columns, ids kept).
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 8,
  E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |',
  E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin, Diloxanide furoate |\n| Mixed | Metronidazole |',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as a \gset
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 9,
  '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני זהב: הטעם המתכתי בפה (שקף 7)](fig:7-1)',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as b \gset
select 'K12. ' || case when (:'b'::jsonb ->> 'rev')::int = (:'a'::jsonb ->> 'rev')::int + 1 and not (:'b'::jsonb ->> 'merged')::boolean
                       then 'ok: table cell and figure caption corrected' else 'FAIL ' || :'a' || ' ' || :'b' end;
-- C13. No change, an empty after, and a note over 300 characters.
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון פעולה', 0, 1);
  raise notice 'K13. FAIL: an unchanged block was saved';
exception when others then if sqlerrm = 'no change' then raise notice 'K13. ok: no change refused'; else raise notice 'K13. FAIL: %', sqlerrm; end if; end $$;
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון', 0, 1, 1, repeat('x', 301));
  raise notice 'K13b. FAIL: a long note was saved';
exception when others then if sqlerrm = 'too long' then raise notice 'K13b. ok: note over 300 characters refused'; else raise notice 'K13b. FAIL: %', sqlerrm; end if; end $$;

-- C14. The part's own heading is its title too.
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 0, '## Metronidazole: מנגנון ושימושים', '## Metronidazole: מנגנון, שימושים ועמידות',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as r \gset
select 'K14. ' || case when title = 'Metronidazole: מנגנון, שימושים ועמידות' then 'ok: title follows the ## heading' else 'FAIL title ' || title end
  from public.study_sections s where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 0;

-- C15. Tidy: the stored part had an en dash and a direction mark; the phone sends what it renders.
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 1, 1, E'הטווח הוא 7-31 ימים. [ש'' 3]', E'הטווח הוא 7 \u2013 31 ימים, לפי שקף 3. [ש'' 3]', 1, 1) as r \gset
select 'K15. ' || case when s.markdown = E'## Tidy\n\nהטווח הוא 7-31 ימים, לפי שקף 3. [ש'' 3]' then 'ok: found in the tidy text; stored tidy' else 'FAIL ' || s.markdown end
  from public.study_sections s where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 1;

-- C16. Undo: Noa's correction is put back by Shoham (an undo is a correction with undo_of).
select set_config('t.noa_edit', (select id::text from public.study_edits where anchor = 2 and lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' order by rev limit 1), false) is not null as have_edit \gset
select public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
  $a$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR או hydrogenase. [ש' 5]$a$,
  $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1, 1, '',
  current_setting('t.noa_edit')::uuid) as r \gset
select 'K16. ' || case when s.markdown like '%על ידי PFOR. [ש'' 5]%' and e.undo_of::text = current_setting('t.noa_edit') then 'ok: undone, linked to the edit it undoes' else 'FAIL' end
  from public.study_sections s, public.study_edits e
 where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 0 and e.id = (:'r'::jsonb ->> 'edit_id')::uuid;
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון', 0, 1, 1, '', current_setting('t.noa_edit')::uuid);
  raise notice 'K16b. FAIL: an undo pointed at another paragraph';
exception when others then if sqlerrm = 'bad undo' then raise notice 'K16b. ok: an undo must point at an edit of the same paragraph'; else raise notice 'K16b. FAIL: %', sqlerrm; end if; end $$;

-- C17. Nobody writes the history directly; a stranger can neither read it nor correct.
do $$ begin insert into public.study_edits (lecture_id, part_idx, anchor, gen, rev, kind, before_text, after_text) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 1, 1, 'paragraph', 'a', 'b');
  raise notice 'K17. FAIL: a member wrote history directly';
exception when insufficient_privilege then raise notice 'K17. ok: no direct insert (%)', sqlerrm; end $$;
do $$ begin update public.study_edits set after_text = 'x'; raise notice 'K17b. FAIL: history rewritten';
exception when insufficient_privilege then raise notice 'K17b. ok: no update'; end $$;
do $$ begin delete from public.study_edits; raise notice 'K17c. FAIL: history deleted';
exception when insufficient_privilege then raise notice 'K17c. ok: no delete'; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'K18. stranger sees ' || count(*) || ' history rows (expect 0)' from public.study_edits;
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 1);
  raise notice 'K18b. FAIL: a stranger corrected a part';
exception when others then if sqlerrm = 'forbidden' then raise notice 'K18b. ok: stranger refused'; else raise notice 'K18b. FAIL: %', sqlerrm; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 1);
  raise notice 'K18c. FAIL: anon called the function';
exception when insufficient_privilege then raise notice 'K18c. ok: anon cannot call it (%)', sqlerrm; end $$;
reset role;

-- C19. A part being written cannot be corrected; a rewrite starts a new generation,
--      and the writer gets the old generation's net corrections.
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'K19. corrections now (no earlier generation): ' || public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000007', 0)::text || ' (expect [])';
reset role;
update public.study_sections set status = 'writing', markdown = '' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 2);
  raise notice 'K19b. FAIL: a part being written was corrected';
exception when others then if sqlerrm = 'part busy' then raise notice 'K19b. ok: part busy while written'; else raise notice 'K19b. FAIL: %', sqlerrm; end if; end $$;
select 'K19c. gen after the rewrite started: ' || gen || ' (expect 2)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
select 'K19d. corrections for the writer: ' || jsonb_array_length(c) || ' (expect 5: the undone paragraph drops out)'
       || case when c::text like '%48 שעות אחרי המנה האחרונה%' and c::text like '%Diloxanide furoate%' and c::text like '%שימושים ועמידות%' and c::text not like '%hydrogenase%' then ', ok' else ', FAIL ' || c::text end
  from public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000007', 0) c;
select 'K19e. history kept: ' || count(*) || ' rows (expect 8)' from public.study_edits where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
reset role;
update public.study_sections set status = 'ready', markdown = '## Metronidazole' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 0, '## Metronidazole', '## Metronidazole: x', (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1);
  raise notice 'K19f. FAIL: an editor opened on the old generation saved';
exception when others then if sqlerrm = 'part rewritten' then raise notice 'K19f. ok: an editor from the old generation gets part rewritten'; else raise notice 'K19f. FAIL: %', sqlerrm; end if; end $$;

-- C20. Comments: shared memory aids and answers are top-level; answers may be longer.
insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body) values
 ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'Metronidazole', 'mnemonic', E'MeTRo: Metallic taste · Trichomonas\nM = Metallic taste'),
 ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'Metronidazole', 'answer', repeat('א', 3500));
select 'K20. a mnemonic and a 3500-character answer saved: ' || count(*) from public.study_comments where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'mnemonic', repeat('א', 2001));
  raise notice 'K20b. FAIL: a 2001-character mnemonic was saved';
exception when check_violation then raise notice 'K20b. ok: mnemonics keep the 2000 limit'; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id)
  values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'answer', 'x', (select id from public.study_comments where kind = 'mnemonic' limit 1));
  raise notice 'K20c. FAIL: an answer was saved as a reply';
exception when check_violation then raise notice 'K20c. ok: replies are plain comments'; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'note', 'x');
  raise notice 'K20d. FAIL: an unknown kind was saved';
exception when check_violation then raise notice 'K20d. ok: unknown kinds refused'; end $$;

-- C21. My uses today: only my own rows of that kind, today in Israel.
reset role;
insert into public.study_usage (group_id, lecture_id, user_id, kind, ref, model, cost_usd, created_at) values
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'route', 'claude-opus-5-5', 0.01, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02,
  (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') - interval '1 minute'),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000002', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'mnemonic', null, 'claude-opus-5-5', 0.03, now());
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'K21. Noa asked today: ' || public.study_my_uses_today(:'gid', 'ask', 'answer') || ' (expect 2), mnemonics: ' || public.study_my_uses_today(:'gid', 'mnemonic') || ' (expect 1)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_my_uses_today((select current_setting('t.gid'))::uuid, 'ask');
  raise notice 'K21b. FAIL: a stranger got a count';
exception when others then if sqlerrm = 'forbidden' then raise notice 'K21b. ok: stranger refused'; else raise notice 'K21b. ok: refused (%)', sqlerrm; end if; end $$;
reset role;

-- ════ Review checks: M9 (no new links in a correction) ════
select 'KR1. a correction that adds a URL: ' || coalesce(public.study_block_edit_problem('Primaquine גורמת להמוליזה. [ש'' 3]', 'Primaquine גורמת להמוליזה, ראו https://evil.example/login [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1b. a Markdown link: ' || coalesce(public.study_block_edit_problem('ההקלטה של ההרצאה. [ש'' 3]', 'ההקלטה [המלאה](https://x.example) של ההרצאה. [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1c. "www." without a scheme: ' || coalesce(public.study_block_edit_problem('טקסט. [ש'' 3]', 'טקסט, ב-www.evil.example. [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1d. an ordinary fix with its slide tag: ' || coalesce(public.study_block_edit_problem('טקסט. [ש'' 3]', 'טקסט מתוקן. [ש'' 3]'), 'accepted') || ' (expect accepted)';
select 'KR1e. a link the block already had may stay: ' || coalesce(public.study_block_edit_problem('ראו https://moodle.bgu.ac.il/x. [ש'' 3]', 'ראו גם https://moodle.bgu.ac.il/x. [ש'' 3]'), 'accepted') || ' (expect accepted)';
-- ════ Package K's checks: edits the spec's block rules let by (edits.test.ts found them) ════
select 'KH1. a paragraph moved under the list before it: ' || coalesce(public.study_block_edit_problem('**תופעות לוואי נדירות:**', '  **תופעות לוואי נדירות:**'), 'accepted')
       || ', made code: ' || coalesce(public.study_block_edit_problem('**תופעות לוואי נדירות:**', E' \t**תופעות לוואי נדירות:**'), 'accepted')
       || ', an item that keeps its indentation: ' || coalesce(public.study_block_edit_problem('  - Nausea', '  - Vomiting'), 'accepted')
       || ' (expect bad block, bad block, accepted)';
select 'KH2. an item that is a rule: ' || coalesce(public.study_block_edit_problem('- Nausea', '- ---'), 'accepted')
       || ', a fence in an item: ' || coalesce(public.study_block_edit_problem('- Nausea', '- ```x'), 'accepted')
       || ', HTML in an item: ' || coalesce(public.study_block_edit_problem('1. Nausea', '1. <!-- x'), 'accepted')
       || ', a fence in a quote in an item: ' || coalesce(public.study_block_edit_problem('- Nausea', '- > ~~~ Nausea'), 'accepted')
       || ', "<40%" in an item: ' || coalesce(public.study_block_edit_problem('- 30% מהחולים', '- <40% מהחולים'), 'accepted')
       || ' (expect bad block, bad block, bad block, bad block, accepted)';
select 'K-reg. the registry: ' || (public.study_schema() ->> 'K') || ' (expect 1)';

-- C22. Realtime publishes the history; the trigger function is not callable.
select 'K22. study_edits in supabase_realtime: ' || exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_edits');
select 'K22b. authenticated may execute study_sections_versions: ' || has_function_privilege('authenticated', 'public.study_sections_versions()', 'execute') || ' (expect false)';

-- C23. Deleting the lecture removes its parts and their history.
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-000000000007';
select 'K23. history rows left: ' || count(*) || ' (expect 0)' from public.study_edits;

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


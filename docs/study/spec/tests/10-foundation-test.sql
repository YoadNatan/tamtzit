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

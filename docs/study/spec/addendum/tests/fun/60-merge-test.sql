-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · the merge (section A's merge_users with this
--  addendum's lines): Noa's laptop (never saved) folds into her account
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select set_config('t.dan', (select id::text from public.study_aids a join public.study_aid_authors w on w.aid_id = a.id
                             where w.user_id = '10000000-0000-4000-8000-0000000000a5' and a.part_idx = 1 and a.anchor = 4 limit 1), false) is not null as d \gset
select set_config('t.noas', (select id::text from public.study_aids a join public.study_aid_authors w on w.aid_id = a.id
                              where w.user_id = '10000000-0000-4000-8000-0000000000a2' and a.kind = 'draft' limit 1), false) is not null as n \gset
set role authenticated;
-- The account: a "נתקע לי" on Daniel's entry and a pin of it.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_aid_vote(current_setting('t.dan')::uuid, 'stuck', true) is not null as v \gset
select public.study_aid_pin(current_setting('t.dan')::uuid, true) is null as p \gset
-- The laptop: the same vote, a vote on the account's own entry, its own entry, another pin there, out of the pulse.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000b2';
select public.study_aid_vote(current_setting('t.dan')::uuid, 'stuck', true) is not null as v \gset
select public.study_aid_vote(current_setting('t.noas')::uuid, 'funny', true) is not null as v \gset
select set_config('t.lap', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'line', 'Miltefosine מהלפטופ: חמישה חודשים בלי הפתעות.',
  'אמצעי מניעה ועוד 5 חודשים [ש׳ 16]', array[16], 'Miltefosine', true)::text, false) is not null as lap \gset
select public.study_aid_pin(current_setting('t.a1')::uuid, true) is null as p \gset
insert into public.study_pulse_optout (group_id) values (:'gid');
-- Maya credits the laptop's member in a pin.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select set_config('t.cr', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 0, 3, '', 'moment', 'Metronidazole עם בירה: הסמקה והקאות.',
  'בלי אלכוהול ועד 48 שעות [ש׳ 7]', array[7], 'Metronidazole', true, null, null, null, null, null, '10000000-0000-4000-8000-0000000000b2')::text, false) is not null as cr \gset
reset role;
insert into public.study_loot (user_id, quiz_id, question_id, due_on)
values ('10000000-0000-4000-8000-0000000000b2', current_setting('t.bq')::uuid, 'f1000000-0000-4000-8000-000000000003', current_date + 1);
select funtest.expect('M0', (select stuck_n || ' stuck on Daniel''s, ' || (select funny_n from public.study_aids where id = current_setting('t.noas')::uuid) || ' funny on Noa''s'
                               from public.study_aids where id = current_setting('t.dan')::uuid), '2 stuck on Daniel''s, 1 funny on Noa''s');

select study_private.merge_users('10000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000a2') is null as merged \gset
select funtest.expect('M1', (select stuck_n || ' stuck on Daniel''s, ' || (select funny_n from public.study_aids where id = current_setting('t.noas')::uuid) || ' funny on Noa''s'
                               from public.study_aids where id = current_setting('t.dan')::uuid), '1 stuck on Daniel''s, 0 funny on Noa''s');
select funtest.expect('M2', (select (a.named_by = w.user_id)::text || ' · ' || right(w.user_id::text, 2) from public.study_aids a join public.study_aid_authors w on w.aid_id = a.id
                               where a.id = current_setting('t.lap')::uuid), 'true · a2');
select funtest.expect('M3', (select string_agg(case when aid_id = current_setting('t.dan')::uuid then 'Daniel''s' else 'other' end, ',') from public.study_aid_pins
                               where user_id = '10000000-0000-4000-8000-0000000000a2' and part_idx = 1 and anchor = 4), 'Daniel''s');
select funtest.expect('M4', 'out ' || exists (select 1 from public.study_pulse_optout where user_id = '10000000-0000-4000-8000-0000000000a2')
       || ' · loot ' || (select count(*) from public.study_loot where user_id = '10000000-0000-4000-8000-0000000000a2')
       || ' · credit asked of ' || (select right(user_id::text, 2) from public.study_aid_credits where aid_id = current_setting('t.cr')::uuid),
       'out true · loot 3 · credit asked of a2');
select funtest.expect('M5', 'rows left on the laptop''s id: ' || (
   (select count(*) from public.study_aid_votes where user_id = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_aid_authors where user_id = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_aid_pins where user_id = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_aid_credits where user_id = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_aids where named_by = '10000000-0000-4000-8000-0000000000b2' or credit_id = '10000000-0000-4000-8000-0000000000b2'
                                             or flagged_by = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_pulse_optout where user_id = '10000000-0000-4000-8000-0000000000b2')
 + (select count(*) from public.study_loot where user_id = '10000000-0000-4000-8000-0000000000b2')), 'rows left on the laptop''s id: 0');
-- Every user column of this addendum's tables is merged (the addendum's own guard; ME64 and I17 cover all).
select funtest.expect('M6', coalesce('not merged: ' || string_agg(t || '.' || col, ', '), 'every user column of U, J, H is merged'),
       'every user column of U, J, H is merged')
from (
  select format('%I.%I', n.nspname, c.relname) as t, a.attname as col
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
   where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and n.nspname = 'public'
     and (c.relname like 'study\_pulse%' or c.relname like 'study\_aid%' or c.relname in ('study_traps', 'study_boss_battles', 'study_loot'))
     and position(format('update %I.%I set %I = dst', n.nspname, c.relname, a.attname)
                  in (select p.prosrc from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                       where pn.nspname = 'study_private' and p.proname = 'merge_users')) = 0) missing;
select funtest.expect('M7', (select count(*)::text from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
                              where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and n.nspname = 'public'
                                and (c.relname like 'study\_pulse%' or c.relname like 'study\_aid%' or c.relname in ('study_traps', 'study_boss_battles', 'study_loot'))),
       '9');

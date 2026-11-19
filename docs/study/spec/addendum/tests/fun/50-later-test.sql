-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · SECTION U, later nights: a trap still catching
--  people, a vaccine retiring, a trap withdrawn with its question
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select set_config('t.trap5', (select id::text from public.study_traps where question_id = 'f1000000-0000-4000-8000-000000000005'), false) is not null as t5 \gset
-- The day it opened (right after the cut-off, before the battles of 40-boss-test.sql): Shoham right, Noa and Maya fall again.
select pg_temp.ans('a1', 5, 3, 3, :'c0'::timestamptz + interval '1 minute'), pg_temp.ans('a2', 5, 0, 3, :'c0'::timestamptz + interval '1 minute'),
       pg_temp.ans('a3', 5, 0, 3, :'c0'::timestamptz + interval '1 minute') \g /dev/null
select funtest.expect('U7', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '1 day 1 hour', true)::text, '1');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select funtest.expect('U7a', (select state from public.study_museum(:'gid') where trap_id = current_setting('t.trap5')::uuid), 'falling');
reset role;
-- The next two study days everyone active gets it right (Itai already did in the battle); Roni is out and is not waited for.
select pg_temp.ans('a1', 5, 3, 3, pg_temp.at(1)), pg_temp.ans('a2', 5, 3, 3, pg_temp.at(1)), pg_temp.ans('a3', 5, 3, 3, pg_temp.at(1)),
       pg_temp.ans('a4', 5, 3, 3, pg_temp.at(1)), pg_temp.ans('a5', 5, 3, 3, pg_temp.at(1)) \g /dev/null
select funtest.expect('U7b', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '2 days 1 hour', true)::text, '1');
-- (read in a statement of its own: a statement sees the table as it was when it started)
select funtest.expect('U7b2', (select state || ', ' || falling from public.study_traps where id = current_setting('t.trap5')::uuid), 'open, false');
select pg_temp.ans('a2', 5, 3, 3, pg_temp.at(2)), pg_temp.ans('a3', 5, 3, 3, pg_temp.at(2)), pg_temp.ans('a4', 5, 3, 3, pg_temp.at(2)),
       pg_temp.ans('a5', 5, 3, 3, pg_temp.at(2)) \g /dev/null
select funtest.expect('U7c', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '3 days 1 hour', true)::text, '1');
select funtest.expect('U7d', (select t.state || ' · card deleted ' || (c.deleted_at is not null) || ' · history ' || e.action || ' by ' || coalesce(e.edited_by::text, 'nobody')
                                from public.study_traps t join public.study_cards c on c.id = t.card_id
                                join public.study_card_edits e on e.card_id = c.id
                               where t.id = current_setting('t.trap5')::uuid),
       'retired · card deleted true · history delete by nobody');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select funtest.expect('U7e', (select state from public.study_museum(:'gid') where trap_id = current_setting('t.trap5')::uuid)
       || ' · vaccine cards left ' || (select count(*) from public.study_trap_cards(:'gid') where kind = 'museum'), 'retired · vaccine cards left 0');
-- A question flagged as wrong takes its trap out of every deck at the next count.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
insert into public.study_question_flags (question_id, reason) values ('f1000000-0000-4000-8000-000000000001', 'wrong_key');
reset role;
select funtest.expect('U8', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '3 days 2 hours', true)::text, '1');
select funtest.expect('U8a', (select t.state || ' · card deleted ' || (c.deleted_at is not null)
                                from public.study_traps t join public.study_cards c on c.id = t.card_id
                               where t.question_id = 'f1000000-0000-4000-8000-000000000001'),
       'withdrawn · card deleted true');

-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · SECTION U: the nightly counts, the pulse, traps, the museum
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;

-- ═════════ 0. The switch, the schedule, the interface ═════════
select funtest.expect('U0', (select string_agg(table_name || '.' || column_name, ', ' order by table_name)
                               from information_schema.columns
                              where table_schema = 'public' and ((table_name = 'study_answers' and column_name = 'confidence')
                                 or (table_name in ('study_questions', 'study_cards') and column_name = 'anchor'))),
       'study_answers.confidence, study_cards.anchor, study_questions.anchor');
select funtest.expect('U0a', study_private.pulse_night(:'gid')::text || ' groups counted, switch ' || study_private.feature_on('pulse'),
       '0 groups counted, switch false');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select funtest.expect('U0b', coalesce(public.study_pulse_ready(:'gid')::text, 'null') || ' · rows ' || (select count(*) from public.study_pulse(:'gid')),
       'null · rows 0');
reset role;
select funtest.expect('U0c', (select schedule from cron.job where jobname = 'study-pulse-night'), '17 2 * * *');
update study_private.features set enabled = true, changed_at = now() where name = 'pulse';

-- ═════════ 1. Three nights: 6 days ago, yesterday, today ═════════
select funtest.expect('U1', study_private.pulse_night(:'gid', :'c0'::timestamptz - interval '6 days' + interval '1 hour')::text, '1');
select funtest.expect('U1a', (select bucket || ' ' || topic from public.study_pulse_topics where topic_key = 'luminal'), 'hot Luminal');
select funtest.expect('U1b', study_private.pulse_night(:'gid', :'c0'::timestamptz - interval '1 day' + interval '1 hour')::text, '1');
select funtest.expect('U1c', (select string_agg(right(question_id::text, 1) || '/' || option || '=' || state, ', ' order by question_id) from public.study_traps),
       '1/2=pending, 5/0=pending, 6/1=open');
-- Found last night, numbered, and still closed: an exhibit opens only the next study day.
select funtest.expect('U1d', (select 'exhibit #' || exhibit_no || ' ' || state || ', opens at the next study day: ' || (exhibit_at = :'c0'::timestamptz and opens_at = :'c0'::timestamptz)
                                from public.study_traps where question_id = 'f1000000-0000-4000-8000-000000000005'),
       'exhibit #1 pending, opens at the next study day: true');
select funtest.expect('U1e', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '1 hour')::text, '1');
select funtest.expect('U1f', study_private.pulse_night(:'gid', :'c0'::timestamptz + interval '3 hours')::text, '0');
select funtest.expect('U1g', (select counted::text from study_private.pulse_runs where group_id = :'gid'),
       '{"cards": 1, "spots": 4, "topics": 5, "questions": 4, "traps_open": 3}');

-- ═════════ 2. What a member sees: words, never numbers or names ═════════
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select funtest.expect('U2', (select string_agg(bucket || ':' || topic || '/' || aspect || case when closed_week then '(closed)' else '' end, ', ')
                               from public.study_pulse(:'gid', 'f0000000-0000-4000-8000-000000000001')),
       'hot:Miltefosine/contra, hot:Primaquine/contra, hot:Quinine/uses, warm:Metronidazole/interactions, cool:Luminal/classification(closed)');
select funtest.expect('U2a', (select string_agg(topic || ' ' || slides::text, ', ' order by topic) from public.study_pulse(:'gid') where bucket = 'hot'),
       'Miltefosine {16}, Primaquine {37,38}, Quinine {27,33}');
select funtest.expect('U2b', (select string_agg(right(question_id::text, 1) || '=' || signal, ', ' order by question_id) from public.study_pulse_questions),
       '1=missed, 2=missed, 3=split, 5=sure');
select funtest.expect('U2c', (select string_agg(part_idx || '.' || anchor, ', ' order by part_idx, anchor) from public.study_pulse_spots),
       '0.5, 1.4, 2.1, 3.2');
select funtest.expect('U2d', (select string_agg(right(card_id::text, 1), ', ') from public.study_pulse_cards), '1');
select funtest.expect('U2e', (select string_agg(column_name, ',' order by column_name) from information_schema.columns
                                where table_schema = 'public' and table_name = 'study_pulse_topics'),
       'aspect,bucket,closed_week,cutoff,group_id,id,lecture_id,slides,topic,topic_key');
-- Not counted: Roni (out), today's answers (after the cut-off), a question flagged as wrong.
select funtest.expect('U2f', 'q7 ' || exists (select 1 from public.study_pulse_questions where question_id = 'f1000000-0000-4000-8000-000000000007')
       || ', ¶0.6 ' || exists (select 1 from public.study_pulse_spots where part_idx = 0 and anchor = 6)
       || ', q4 ' || exists (select 1 from public.study_pulse_questions where question_id = 'f1000000-0000-4000-8000-000000000004')
       || ', q8 ' || exists (select 1 from public.study_pulse_questions where question_id = 'f1000000-0000-4000-8000-000000000008'),
       'q7 false, ¶0.6 false, q4 false, q8 false');

-- "אצלך": Noa's own buckets, live (her wrong answer this morning counts for her alone).
select funtest.expect('U3', (select string_agg(topic_key || '/' || aspect || '=' || mine || ' (' || wrong || '/' || items || ')', ', ' order by topic_key)
                               from public.study_my_pulse(:'gid', 'f0000000-0000-4000-8000-000000000001')),
       'chloroquine/pk=hot (1/1), luminal/classification=cool (0/1), metronidazole/interactions=hot (2/2), miltefosine/contra=hot (2/2), primaquine/contra=hot (2/2), quinine/uses=hot (1/1)');
select funtest.expect('U3a', (select string_agg(p.topic, ', ') from public.study_pulse(:'gid') p
                                join public.study_my_pulse(:'gid') m on m.lecture_id = p.lecture_id and m.topic_key = p.topic_key and m.aspect = p.aspect
                               where p.bucket <> 'hot' and m.mine = 'hot'),
       'Metronidazole');
select funtest.expect('U3b', (select jsonb_build_object('hot', b -> 'hot' ->> 'topic', 'q', b -> 'question' ->> 'question')::text
                                from public.study_pulse_brief('f0000000-0000-4000-8000-000000000001') b),
       '{"q": "למה משמשת Quinine?", "hot": "Miltefosine"}');

-- ═════════ 3. The museum and the trap cards ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select funtest.expect('U4', (select exhibit_no || ' ' || state || ' · ׳' || claim || '׳ · האמת: ' || truth || ' · מה בלבל: ' || confused
                               from public.study_museum(:'gid')),
       '1 new · ׳מניעת מלריה׳ · האמת: טיפול, בשילוב עם Doxycycline או Clindamycin · מה בלבל: לבדה לא למניעה: Doxycycline לבדה כן משמשת למניעה [ש'' 33]');
select funtest.expect('U4a', (select string_agg(kind || coalesce(' #' || exhibit_no, ''), ', ' order by kind, exhibit_no) from public.study_trap_cards(:'gid')),
       'museum #1, trap, trap');
reset role;
select funtest.expect('U4b', (select c.front || ' | ' || c.back || ' | ' || c.extra || ' | ¶' || c.part_idx || '.' || c.anchor
                                     || ' | made by the app ' || (c.source in ('ai', 'trap') and c.created_by is null)
                                from public.study_cards c join public.study_traps t on t.card_id = c.id
                               where t.question_id = 'f1000000-0000-4000-8000-000000000005'),
       'למה משמשת Quinine? | טיפול, בשילוב עם Doxycycline או Clindamycin | המלכודת: מניעת מלריה · לבדה לא למניעה: Doxycycline לבדה כן משמשת למניעה [ש'' 33] | ¶2.1 | made by the app true');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select funtest.expect('U4c', public.study_museum_pick('f0000000-0000-4000-8000-000000000001')::text,
       (select trap_id::text from public.study_museum(:'gid') limit 1));
select public.study_museum_shown(public.study_museum_pick('f0000000-0000-4000-8000-000000000001')) is null as shown \gset
select set_config('t.trap5', (select trap_id::text from public.study_museum(:'gid') limit 1), false) is not null as t5 \gset
do $$ begin perform public.study_trap_plaque(current_setting('t.trap5')::uuid, 'Quinine משמשת למניעת מלריה', 'ביטחון עצמי, שקף 27', null);
  raise notice 'U4d. FAIL: a plaque without the server key';
exception when others then raise notice 'U4d. %: only the op writes a plaque (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('U4e', public.study_trap_plaque(current_setting('t.trap5')::uuid, 'Quinine משמשת למניעת מלריה', 'ביטחון עצמי, שקף 27', current_setting('t.key'))::text
       || ' then ' || public.study_trap_plaque(current_setting('t.trap5')::uuid, 'עוד אחד', 'עוד שורה', current_setting('t.key'))::text,
       'true then false');
do $$ begin perform public.study_trap_plaque(current_setting('t.trap5')::uuid, 'x', 'y', current_setting('t.key'));
  raise notice 'U4f. FAIL: a two-letter plaque';
exception when others then raise notice 'U4f. %: plaque lengths (%)', case when sqlerrm = 'bad plaque' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ 4. Privacy: nothing private, nothing early, members only ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin perform count(*) from study_private.pulse_q; raise notice 'U5. FAIL: the numbers are readable';
exception when insufficient_privilege then raise notice 'U5. ok: the numbers stay in study_private (%)', sqlerrm; end $$;
do $$ begin perform count(*) from public.study_traps; raise notice 'U5a. FAIL: traps readable before they open';
exception when insufficient_privilege then raise notice 'U5a. ok: traps only through the functions (%)', sqlerrm; end $$;
do $$ begin perform study_private.pulse_night(current_setting('t.gid')::uuid, now(), true); raise notice 'U5b. FAIL: a member forced a count';
exception when insufficient_privilege then raise notice 'U5b. ok: only the night and the first read count (%)', sqlerrm; end $$;
select funtest.expect('U5c', 'Noa sees ' || (select count(*) from public.study_pulse_optout) || ' opt-out rows', 'Noa sees 0 opt-out rows');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a6';
select funtest.expect('U5d', 'Roni sees ' || (select count(*) from public.study_pulse_optout) || ' (his own)', 'Roni sees 1 (his own)');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin insert into public.study_pulse_optout (group_id, user_id) values (current_setting('t.gid')::uuid, '10000000-0000-4000-8000-0000000000a3');
  raise notice 'U5e. FAIL: Noa opted Maya out';
exception when insufficient_privilege then raise notice 'U5e. ok: only one''s own opt-out (%)', sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a9';
do $$ begin perform public.study_pulse(current_setting('t.gid')::uuid); raise notice 'U5f. FAIL: an outsider read the pulse';
exception when others then raise notice 'U5f. %: members only (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('U5g', 'outsider sees ' || (select count(*) from public.study_pulse_topics) || ' topics, ' || (select count(*) from public.study_pulse_questions) || ' signals',
       'outsider sees 0 topics, 0 signals');
reset role;
set role anon;
do $$ begin perform public.study_pulse(current_setting('t.gid')::uuid); raise notice 'U5h. FAIL: anon read the pulse';
exception when insufficient_privilege then raise notice 'U5h. ok: anon cannot call it (%)', sqlerrm; end $$;
reset role;
select funtest.expect('U5i', (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
                                where pubname = 'supabase_realtime' and (tablename like 'study_pulse%' or tablename = 'study_traps')),
       null);

-- ═════════ 5. The live quiz picks from the counts (Q10) ═════════
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.pq', public.study_quiz_create(:'gid', 'coop', array['f0000000-0000-4000-8000-000000000001']::uuid[], 3, 30)::text, false) is not null as pq \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_quiz_join(current_setting('t.pq')::uuid) is null as j \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select public.study_quiz_next(current_setting('t.pq')::uuid, -1) is null as n \gset
reset role;
select funtest.expect('U6', (select string_agg(distinct s.signal, ',' order by s.signal) || ' · ' || count(*) || ' rounds · q3 in: '
                                    || bool_or(r.question_id = 'f1000000-0000-4000-8000-000000000003') || ' · q5 in: ' || bool_or(r.question_id = 'f1000000-0000-4000-8000-000000000005')
                               from public.study_quiz_rounds r left join public.study_pulse_questions s on s.question_id = r.question_id
                              where r.quiz_id = current_setting('t.pq')::uuid),
       'missed,split,sure · 3 rounds · q3 in: true · q5 in: true');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select public.study_quiz_end(current_setting('t.pq')::uuid) is null as e \gset
reset role;

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
select 'P0. cron jobs: ' || string_agg(jobname || ' [' || schedule || ']', ', ' order by jobname) || ' (expect 4 with study-bank of section B and study-pulse-night of section U, once each after two runs)' from cron.job;
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


-- ════════════════════════════════════════════════════════════════════════
--  Section B · BS: the bank written ahead. The switch, the upload's
--  question, the automatic job, planning and holding the parts, the worker's
--  steps (submit, poll, stage for the blind solver, save, finish), the
--  deadline and the fall-back to normal writing, cancelling, privacy.
--  The worker is anon with the key and no member token, as on Vercel.
-- ════════════════════════════════════════════════════════════════════════
reset role;
-- Three more lectures with written parts and text on their slides.
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, status, created_by)
select ('a3000000-0000-4000-8000-00000000000' || x)::uuid, 'a2000000-0000-4000-8000-000000000001', 'פתוגן מאכסן', 'הרצאה ' || x, 'pptx',
       (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Metronidazole ואלכוהול ', 6)),
                                            'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb) order by n) from generate_series(1, 20) n),
       'writing', 'a1000000-0000-4000-8000-000000000001'
  from generate_series(3, 5) x;
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown)
select ('a3000000-0000-4000-8000-00000000000' || x)::uuid, p, 'חלק ' || p, 1 + 10 * p, 10 + 10 * p, 'ready', '## חלק ' || p || E'\n\nפסקה. [ש'' ' || (1 + 10 * p) || ']'
  from generate_series(3, 5) x, generate_series(0, 1) p;
\set l3 'a3000000-0000-4000-8000-000000000003'
\set l4 'a3000000-0000-4000-8000-000000000004'
\set l5 'a3000000-0000-4000-8000-000000000005'
select set_config('t.l3', :'l3', false) is not null as x \gset
create or replace function stest.kicks(p_job uuid) returns int language sql as $$
  select count(*)::int from net.calls c where c.body ->> 'bank' = p_job::text $$;

-- BS1-BS2: the switch is off. The upload asks; a ready summary starts nothing.
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'BS1. mode with the switch off: ' || public.study_bank_mode(:'g') || ' (expect server: ask at upload, the server writes on "כן")';
reset role;
update public.study_lectures set status = 'ready' where id = :'l3';
select 'BS1b. a ready summary with the switch off: ' || count(*) || ' job(s) (expect 0)' from study_private.bank_jobs where lecture_id = :'l3';
update public.study_lectures set status = 'writing' where id = :'l3';
-- "כן, להכין" at upload: a job that waits for the summary, at full price.
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'BS2. asked at upload: ' || public.study_bank_request(:'l2') || ' (expect waiting)';
select 'BS2b. asked again: ' || public.study_bank_request(:'l2') || ' (expect waiting: one job per lecture)';
select 'BS2c. as a member sees it: ' || (public.study_bank_state(:'l2') ->> 'state') || ', mode ' || (public.study_bank_state(:'l2') ->> 'mode')
       || ', no batch id: ' || (not (public.study_bank_state(:'l2') ? 'msg_batch'))::text || ' (expect waiting, now, true)';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000009';
do $$ begin perform public.study_bank_state(current_setting('t.l2')::uuid); raise notice 'BS2d. FAIL: a stranger read a job';
exception when others then raise notice 'BS2d. %: members only (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select id as j2 from study_private.bank_jobs where lecture_id = :'l2' \gset
update public.study_lectures set status = 'ready' where id = :'l2';
select 'BS3. the summary is ready: ' || state || ', kicked ' || stest.kicks(:'j2') || ' (expect new, 1)' from study_private.bank_jobs where id = :'j2';

-- BS4: the worker. Without the key, or with a member's token, nothing.
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_bank_take(gen_random_uuid(), 'not-the-key'); raise notice 'BS4. FAIL';
exception when others then raise notice 'BS4. %: the worker needs the key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_bank_take(gen_random_uuid(), current_setting('t.key')); raise notice 'BS4b. FAIL: a member called the worker''s function';
exception when others then raise notice 'BS4b. ok: members cannot call it, even with the key (%)', sqlerrm; end $$;
set role anon;
reset request.jwt.claim.sub;
-- Mode now (asked at upload): planned, written normally at once, part by part.
select (public.study_bank_take(:'j2', :'key')) as t \gset
select 'BS5. first step: ' || (:'t'::jsonb ->> 'step') || ', row ' || (:'t'::jsonb -> 'row' ->> 'kind') || ' part ' || (:'t'::jsonb -> 'row' ->> 'part_idx')
       || ', rows ' || jsonb_array_length(:'t'::jsonb -> 'rows') || ' (expect write, q part 0, 4: two question parts, two card parts)';
reset role;
select 'BS5b. the parts: ' || string_agg(via || ':' || status || ':' || coalesce(hold_until::text, 'no hold'), ' ' order by part_idx)
       || ' (expect server:writing:no hold ×2)' from public.study_question_batches where lecture_id = :'l2';
select 'BS5c. card parts: ' || string_agg(via || ':' || status || ':' || wanted, ' ' order by part_idx) || ' (expect server:writing:5 ×2)'
  from public.study_card_batches where lecture_id = :'l2';
set role anon;
reset request.jwt.claim.sub;
select 'BS5d. while the lease is held: ' || coalesce(public.study_bank_take(:'j2', :'key')::text, 'nothing') || ' (expect nothing)';
reset role;
select id as q2a from public.study_question_batches where lecture_id = :'l2' and part_idx = 0 \gset
set role anon;
reset request.jwt.claim.sub;
select public.study_bank_save(:'j2', (:'t'::jsonb ->> 'lease')::uuid, 'q', :'q2a', '{"kind":"mcq","question":"מה Miltefosine מחייבת?",
  "options":["אמצעי מניעה","ECG","G6PD","תפקודי כבד","כלום"],"answer":0,"explanations":["כן [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]"],
  "whens":["","מתי כן: Pentostam","מתי כן: Primaquine","",""],"takeaway":"Miltefosine טרטוגנית [ש'' 2]","slides":[2],"topic":"Miltefosine","aspect":"contra","para":1}'::jsonb, :'key') is not null as bs6;
select public.study_bank_finish(:'j2', (:'t'::jsonb ->> 'lease')::uuid, 'q', :'q2a', 'ready', 0, 1, 'claude-opus-5-5', 0.03, null, :'key');
select 'BS6. step done: ' || public.study_bank_report(:'j2', (:'t'::jsonb ->> 'lease')::uuid, 'step_done', '{}'::jsonb, :'key') || ' (expect fallback)';
reset role;
select 'BS6b. the part: ' || status || ', made ' || made || ', solver rejected ' || solver_rejected || ' (expect ready, 1, 1)'
  from public.study_question_batches where id = :'q2a';
set role anon;
reset request.jwt.claim.sub;
select 'BS6c. next step: ' || (public.study_bank_take(:'j2', :'key') -> 'row' ->> 'part_idx') || ' (expect 1: the next question part)';
reset role;
-- The rest fails here (no model in a test): taps can write it.
update study_private.bank_jobs set lease_until = now() - interval '1 second' where id = :'j2';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j2', :'key')) as t2 \gset
select 'BS7. given up: ' || public.study_bank_report(:'j2', (:'t2'::jsonb ->> 'lease')::uuid, 'failed', '{"error":"api_500"}'::jsonb, :'key') || ' (expect failed)';
select 'BS7b. after failing: ' || coalesce(public.study_bank_take(:'j2', :'key')::text, 'nothing') || ' (expect nothing)';

-- BS8-BS12: the switch on. A ready summary starts a batch job by itself; a
-- meeting on the lecture in five hours sets the deadline 90 minutes before.
reset role;
update study_private.features set enabled = true where name = 'bank';
insert into public.study_meetings (group_id, day, starts_at, lecture_id, part_from, part_to)
values (:'g', (now() + interval '5 hours')::date, now() + interval '5 hours', :'l3', 0, 1);
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'BS8. mode with the switch on: ' || public.study_bank_mode(:'g') || ' (expect batch)';
reset role;
update public.study_lectures set status = 'ready' where id = :'l3';
select id as j3 from study_private.bank_jobs where lecture_id = :'l3' \gset
select 'BS8b. automatic: ' || mode || ', ' || state || ', kicked ' || stest.kicks(:'j3') || ' (expect batch, new, 1)' from study_private.bank_jobs where id = :'j3';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j3', :'key')) as t3 \gset
select 'BS9. first step: ' || (:'t3'::jsonb ->> 'step') || ', deadline ' ||
       round(extract(epoch from ((:'t3'::jsonb ->> 'deadline')::timestamptz - now())) / 60) || ' min away (expect submit, 210)';
reset role;
select 'BS9b. held: ' || string_agg(via || ':' || status || ':' || round(extract(epoch from (hold_until - now())) / 60), ' ' order by part_idx)
       || ' (expect batch:writing:220 ×2)' from public.study_question_batches where lecture_id = :'l3';
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
select 'BS9c. a tap meanwhile gets the open round: fresh ' || fresh || ' (expect false)' from public.study_question_round(:'l3');
do $$ begin perform public.study_question_claim((select id from public.study_question_batches where lecture_id = current_setting('t.l3', true)::uuid and part_idx = 0),
  current_setting('t.key')); raise notice 'BS9d. FAIL: a tap took a held part';
exception when others then raise notice 'BS9d. %: the part is busy while the batch holds it (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'BS9e. what members see: ' || (public.study_bank_state(:'l3') ->> 'state') || ' (expect starting)';
set role anon;
reset request.jwt.claim.sub;
select 'BS10. the worker''s input: ' || jsonb_array_length(i -> 'parts') || ' parts, ' || jsonb_array_length(i -> 'rows') || ' rows, slides '
       || jsonb_array_length(i -> 'lecture' -> 'slides') || ' (expect 2, 4, 20)'
  from (select public.study_bank_input(:'j3', :'key') as i) x;
-- The worker reserves at batch prices (no member) and submits the write batch.
select public.study_reserve(:'g', :'l3', 'bank', :'j3', 0.62, 33, 0.8, null, null, null, :'key') as res \gset
select 'BS10b. submitted: ' || public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'submitted',
  jsonb_build_object('stage', 'write', 'msg_batch', 'msgbatch_01TestWrite', 'reservation', :'res'), :'key') || ' (expect writing)';
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
select 'BS10c. members see: ' || (public.study_bank_state(:'l3') ->> 'state') || ', ready by ' ||
       round(extract(epoch from ((public.study_bank_state(:'l3') ->> 'ready_by')::timestamptz - now())) / 60) || ' min (expect batch, 210)';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j3', :'key')) as t3 \gset
select 'BS11. next: ' || (:'t3'::jsonb ->> 'step') || ' (expect poll)';
select 'BS11b. still in progress: ' || public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'polled', '{}'::jsonb, :'key') || ' (expect writing)';
-- Ended: the cards are saved; the questions are staged for the blind solver; part 1's request expired.
select (public.study_bank_take(:'j3', :'key')) as t3 \gset
reset role;
select id as c3a from public.study_card_batches where lecture_id = :'l3' and part_idx = 0 \gset
select id as c3b from public.study_card_batches where lecture_id = :'l3' and part_idx = 1 \gset
select id as q3a from public.study_question_batches where lecture_id = :'l3' and part_idx = 0 \gset
select id as q3b from public.study_question_batches where lecture_id = :'l3' and part_idx = 1 \gset
set role anon;
reset request.jwt.claim.sub;
select public.study_bank_save(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'c', b, '{"kind":"qa","front":"Metronidazole: מה אסור לשתות?","back":"אלכוהול",
  "slides":[2],"topic":"Metronidazole","aspect":"interactions","para":1}'::jsonb, :'key') is not null as bs12
  from unnest(array[:'c3a'::uuid]) b;
select public.study_bank_save(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'c', :'c3b', '{"kind":"cloze","front":"Metronidazole עם {{אלכוהול}} גורמת לתגובה דמוית Disulfiram.",
  "back":"","slides":[12],"topic":"Metronidazole","aspect":"interactions"}'::jsonb, :'key') is not null as bs12b;
select public.study_bank_finish(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'c', b, 'ready', 0, 0, 'claude-opus-5-5', 0.02, null, :'key')
  from unnest(array[:'c3a'::uuid, :'c3b'::uuid]) b;
select public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'stage', jsonb_build_object('batch', :'q3a', 'items', jsonb_build_array(
  '{"kind":"mcq","question":"עם מה אסור Metronidazole?","options":["אלכוהול","חלב","מים","קפה","מיץ"],"answer":0,
    "explanations":["כן [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]","לא [ש'' 2]"],"slides":[2],"topic":"Metronidazole","aspect":"interactions"}'::jsonb,
  '{"kind":"mcq","question":"מה עוד?","options":["א","ב","ג","ד","ה"],"answer":3,
    "explanations":["1","2","3","4","5"],"slides":[3],"topic":"X","aspect":"other"}'::jsonb)), :'key') as bs12c;
reset role;
select 'BS12. staged for the solver: ' || count(*) || ', cards ready: ' ||
       (select count(*) from public.study_card_batches where lecture_id = :'l3' and status = 'ready') || ' (expect 2, 2)'
  from study_private.bank_items where job_id = :'j3';
set role anon;
reset request.jwt.claim.sub;
select 'BS12b. the solver''s batch: ' || public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'submitted',
  jsonb_build_object('stage', 'solve', 'msg_batch', 'msgbatch_01TestSolve'), :'key') || ' (expect solving)';
-- The solver agreed with the first key, not with the second: one saved, one rejected.
select (public.study_bank_take(:'j3', :'key')) as t3 \gset
reset role;
select item as passed from study_private.bank_items where job_id = :'j3' and n = 0 \gset
set role anon;
reset request.jwt.claim.sub;
select public.study_bank_save(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'q', :'q3a', :'passed'::jsonb, :'key') is not null as bs13;
select public.study_bank_finish(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'q', :'q3a', 'ready', 0, 1, 'claude-opus-5-5', 0.01, null, :'key');
select 'BS13. stage ended: ' || public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'ended', '{}'::jsonb, :'key')
       || ' (expect fallback: part 1''s questions never came back)';
select public.study_settle(:'res'::bigint, 'claude-opus-5-5', '{"service_tier":"batch"}'::jsonb, 0.14, :'key') as settled;
reset role;
select 'BS13b. part 0: ' || status || ', made ' || made || ', solver rejected ' || solver_rejected || '; staged left ' ||
       (select count(*) from study_private.bank_items where job_id = :'j3') || '; holds left ' ||
       (select count(*) from public.study_question_batches where lecture_id = :'l3' and hold_until is not null) || ' (expect ready, 1, 1; 0; 0)'
  from public.study_question_batches where id = :'q3a';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j3', :'key')) as t3 \gset
select 'BS14. fall-back: ' || (:'t3'::jsonb ->> 'step') || ' part ' || (:'t3'::jsonb -> 'row' ->> 'part_idx') || ' (expect write part 1)';
select public.study_bank_save(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'q', :'q3b', '{"kind":"mcq","question":"מה גורמת Disulfiram?","options":["הקאות","שינה","רעב","צמא","גרד"],
  "answer":0,"explanations":["כן [ש'' 12]","לא [ש'' 12]","לא [ש'' 12]","לא [ש'' 12]","לא [ש'' 12]"],"slides":[12],"topic":"Metronidazole","aspect":"adverse"}'::jsonb, :'key') is not null as bs14;
select public.study_bank_finish(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'q', :'q3b', 'ready', 0, 0, 'claude-opus-5-5', 0.05, null, :'key');
select 'BS14b. ' || public.study_bank_report(:'j3', (:'t3'::jsonb ->> 'lease')::uuid, 'step_done', '{}'::jsonb, :'key') || ', next: '
       || coalesce(public.study_bank_take(:'j3', :'key')::text, 'nothing') || ' (expect fallback, nothing)';
reset role;
select 'BS14c. the job: ' || state || ' (expect done)' from study_private.bank_jobs where id = :'j3';
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';
select 'BS14d. Daniel sees the bank: ' || (select count(*) from public.study_questions where lecture_id = :'l3') || ' questions, '
       || (select count(*) from public.study_cards where lecture_id = :'l3') || ' cards, state ' || (public.study_bank_state(:'l3') ->> 'state')
       || ' (expect 2, 2, done)';

-- BS15: a meeting in 40 minutes: no time for a batch; written normally now.
reset role;
insert into public.study_meetings (group_id, day, starts_at, lecture_id, part_from, part_to)
values (:'g', (now() + interval '40 minutes')::date, now() + interval '40 minutes', :'l4', 0, 1);
update public.study_lectures set status = 'ready' where id = :'l4';
select id as j4 from study_private.bank_jobs where lecture_id = :'l4' \gset
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j4', :'key') ->> 'step') as s4 \gset
reset role;
select 'BS15. too close to the meeting: ' || :'s4' || ', mode ' || mode || ' (expect write, now)' from study_private.bank_jobs where id = :'j4';

-- BS16: the deadline passes while the batch runs: cancel, then write the rest.
reset role;
update public.study_lectures set status = 'ready' where id = :'l5';
select id as j5 from study_private.bank_jobs where lecture_id = :'l5' \gset
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j5', :'key')) as t5 \gset
select public.study_bank_report(:'j5', (:'t5'::jsonb ->> 'lease')::uuid, 'submitted', '{"stage":"write","msg_batch":"msgbatch_01TestLate"}'::jsonb, :'key') as bs16;
reset role;
update study_private.bank_jobs set deadline = now() - interval '1 minute' where id = :'j5';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j5', :'key')) as t5 \gset
select 'BS16. at the deadline: ' || (:'t5'::jsonb ->> 'step') || ' (expect cancel)';
select public.study_bank_report(:'j5', (:'t5'::jsonb ->> 'lease')::uuid, 'cancelling', '{}'::jsonb, :'key') as bs16b;
select 'BS16b. then: ' || (public.study_bank_take(:'j5', :'key') ->> 'step') || ' (expect poll: until the batch ends)';
reset role;
update study_private.bank_jobs set cancel_at = now() - interval '20 minutes', lease_until = now() - interval '1 second' where id = :'j5';
set role anon;
reset request.jwt.claim.sub;
select (public.study_bank_take(:'j5', :'key') ->> 'step') as s5 \gset
reset role;
select 'BS16c. cancelling took too long: ' || :'s5' || ', holds left ' || count(*) || ' (expect write, 0)'
  from public.study_question_batches where lecture_id = :'l5' and hold_until is not null;

-- BS17: the sweeper. A stalled job (15 kicks nobody took) gives up; a
-- deleted lecture's job is cancelled; kicks wait two minutes.
reset role;
update study_private.bank_jobs set lease_until = null, kicks_since_claim = 15 where id = :'j5';
select study_private.bank_dispatch() >= 0 as swept;
select 'BS17. stalled: ' || state || ', ' || error || ' (expect failed, stalled)' from study_private.bank_jobs where id = :'j5';
update public.study_lectures set deleted_at = now() where id = :'l4';
update study_private.bank_jobs set lease_until = null where id = :'j4';
select study_private.bank_dispatch() >= 0 as swept;
select 'BS17b. deleted lecture: ' || state || ' (expect cancelled)' from study_private.bank_jobs where id = :'j4';
select 'BS17c. the sweeper''s job: ' || count(*) || ' (expect 1: study-bank every 2 minutes)' from cron.job where jobname = 'study-bank' and schedule = '*/2 * * * *';

-- BS18: privacy. Members cannot read the private tables; anon may call only
-- the worker's five functions of this section, and they need the key.
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
do $$ begin perform 1 from study_private.bank_jobs; raise notice 'BS18. FAIL: a member read the jobs';
exception when others then raise notice 'BS18. ok: the jobs are not readable (%)', sqlerrm; end $$;
reset role;
select 'BS18b. anon may call: ' || string_agg(p.proname, ', ' order by p.proname) || ' (expect study_bank_finish, study_bank_input, study_bank_report, study_bank_save, study_bank_take)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'study\_bank%' and has_function_privilege('anon', p.oid, 'execute');
select 'BS-reg. B = ' || (public.study_schema() ->> 'B') || ' (expect 1)';

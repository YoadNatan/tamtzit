-- ════════════════════════════════════════════════════════════════════════
--  Section Q's end (server lines) · QS: the bet, "מתי כן", two flags hide,
--  another wording, confusions, the diagram, the worker path.
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';   -- נועה

-- QS1-QS2: the bet is stored with the answer, only hers; "מתי כן" comes back with the key.
select 'QS1. ' || correct || ', whens: ' || array_length(whens, 1) || ', first: ' || whens[1] || ' (expect false, 5, מתי כן: בשאלה על הכבד)'
  from public.study_answer_question('a4000000-0000-4000-8000-000000000001', 2, 'lecture', 9000, 3);
select 'QS1b. stored bet: ' || confidence || ' (expect 3)' from public.study_answers
 where question_id = 'a4000000-0000-4000-8000-000000000001' and user_id = auth.uid();
do $$ begin perform public.study_answer_question('a4000000-0000-4000-8000-000000000002', 0, 'lecture', null, 4); raise notice 'QS1c. FAIL: a bet of 4';
exception when others then raise notice 'QS1c. %: a bet outside 1-3 is refused (%)', case when sqlerrm = 'bad bet' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'QS1d. without a bet: ' || correct || ', bet ' || coalesce((select confidence::text from public.study_answers where question_id = 'a4000000-0000-4000-8000-000000000003' and user_id = auth.uid()), 'none') || ' (expect true, none)'
  from public.study_answer_question('a4000000-0000-4000-8000-000000000003', 2, 'lecture', null, null);
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';   -- מאיה
select 'QS2. Maya sees ' || count(*) || ' of Noa''s answers (expect 0)' from public.study_answers where user_id = 'a1000000-0000-4000-8000-000000000002';
select 'QS2b. whens for an unanswered question: ' || count(*) || ' row(s) (expect 0)'
  from public.study_question_whens(array['a4000000-0000-4000-8000-000000000001'::uuid]);
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'QS2c. whens for her answered one: ' || whens[3] || ' (expect מתי כן: falciparum)'
  from public.study_question_whens(array['a4000000-0000-4000-8000-000000000001'::uuid]);

-- QS3-QS6: flags. One flag hides nothing; "duplicate" never counts; two
-- members' flags hide the question for everyone until it is fixed.
insert into public.study_question_flags (question_id, reason, note) values ('a4000000-0000-4000-8000-000000000005', 'wrong_key', 'המפתח שגוי');
select 'QS3. one flag: hidden ' || (hidden_at is not null) || ' (expect false)' from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
insert into public.study_question_flags (question_id, reason) values ('a4000000-0000-4000-8000-000000000005', 'duplicate');
select 'QS3b. a flag of kind duplicate: hidden ' || (hidden_at is not null) || ' (expect false)' from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
delete from public.study_question_flags where user_id = auth.uid() and question_id = 'a4000000-0000-4000-8000-000000000005';
insert into public.study_question_flags (question_id, reason) values ('a4000000-0000-4000-8000-000000000005', 'not_in_slides');
select 'QS4. two members'' flags: hidden ' || (hidden_at is not null) || ' (expect true)' from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';   -- איתי
select 'QS4a. the fix sheet: key ' || answer || ', hidden ' || hidden || ', flags ' || jsonb_array_length(flags) || ' (expect 0, true, 2)'
  from public.study_question_for_fix('a4000000-0000-4000-8000-000000000005');
do $$ begin perform public.study_question_for_fix('a4000000-0000-4000-8000-000000000006'); raise notice 'QS4c. FAIL: the key of a question nobody flagged';
exception when others then raise notice 'QS4c. %: only a hidden or flagged question (%)', case when sqlerrm = 'not flagged' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_answer_question('a4000000-0000-4000-8000-000000000005', 0, 'lecture', null, 2); raise notice 'QS4b. FAIL: a hidden question was answered';
exception when others then raise notice 'QS4b. %: a hidden question is out of practice (%)', case when sqlerrm = 'hidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_question_fix('a4000000-0000-4000-8000-000000000005', 'keep', '{}', 'בדקתי'); raise notice 'QS5. FAIL: kept without a slide';
exception when others then raise notice 'QS5. %: keeping needs a slide citation (%)', case when sqlerrm = 'bad source' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_question_fix('a4000000-0000-4000-8000-000000000005', 'keep', array[99], ''); raise notice 'QS5b. FAIL: a slide not in the lecture';
exception when others then raise notice 'QS5b. %: the slide must be the lecture''s (%)', case when sqlerrm = 'bad source' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_question_fix('a4000000-0000-4000-8000-000000000005', 'keep', array[3], 'המפתח נכון לפי ש׳ 3');
select 'QS5c. fixed: hidden ' || (hidden_at is not null) || ', by Itai ' || (fixed_by = auth.uid()) || ', slides ' || fix_slides::text || ' (expect false, true, {3})'
  from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
reset role;
update public.study_question_flags set created_at = now() - interval '1 hour' where question_id = 'a4000000-0000-4000-8000-000000000005';
update public.study_questions set fixed_at = now() - interval '30 minutes' where id = 'a4000000-0000-4000-8000-000000000005';
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';   -- דניאל
insert into public.study_question_flags (question_id, reason) values ('a4000000-0000-4000-8000-000000000005', 'unclear');
select 'QS6. one new flag after the fix: hidden ' || (hidden_at is not null) || ' (expect false: the old flags stopped counting)'
  from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000006';   -- רוני
insert into public.study_question_flags (question_id, reason) values ('a4000000-0000-4000-8000-000000000005', 'two_answers');
select 'QS6b. a second new flag: hidden ' || (hidden_at is not null) || ' (expect true)' from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
delete from public.study_question_flags where user_id = auth.uid() and question_id = 'a4000000-0000-4000-8000-000000000005';
select 'QS6c. a flag taken back: hidden ' || (hidden_at is not null) || ' (expect false)' from public.study_questions where id = 'a4000000-0000-4000-8000-000000000005';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000009';   -- the stranger
do $$ begin perform public.study_question_fix('a4000000-0000-4000-8000-000000000005', 'retire', '{}', ''); raise notice 'QS6d. FAIL: a stranger fixed a question';
exception when others then raise notice 'QS6d. %: strangers cannot fix (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- QS7-QS9: another wording. Noa's miss on Q01 (yesterday) is asked again as
-- Q02, which sits on the same paragraph; a right answer to Q02 on a later
-- day clears Q01 from her mistakes. Q06's paragraph has a card only; Q03's
-- paragraph nothing else.
reset role;
update public.study_answers set answered_at = now() - interval '2 days'
 where user_id = 'a1000000-0000-4000-8000-000000000002' and question_id in ('a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003');
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at) values
 ('a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000006', 0, false, 'lecture', now() - interval '2 days'),
 ('a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000004', 0, false, 'lecture', now() - interval '2 days');
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select 'QS7. rewordings: ' || string_agg(right(question_id::text, 2) || '→' || ask_kind || ':' || coalesce(right(ask_question::text, 2), right(ask_card::text, 2)), ' ' order by right(question_id::text, 2))
       || ' (expect 01→question:02 04→card:02 06→card:03: a sibling question first, else a card on the paragraph)'
  from public.study_my_rewordings(:'g');
select 'QS8. open mistakes: ' || string_agg(right(question_id::text, 2), ' ' order by question_id) || ' (expect 01 04 06)' from public.study_open_mistakes(:'g');
select correct as qs8_answer from public.study_answer_question('a4000000-0000-4000-8000-000000000002', 0, 'mistakes', null, 2);
select 'QS8b. after a right answer to its sibling today: ' || string_agg(right(question_id::text, 2), ' ' order by question_id) || ' (expect 04 06)'
  from public.study_open_mistakes(:'g');

-- QS10: the pairs she confuses (option tags). Q07's key is Schizont; she chose Merozoite twice.
reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at) values
 ('a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000007', 4, false, 'lecture', now() - interval '3 days'),
 ('a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000007', 4, false, 'quiz', now() - interval '1 day');
set role authenticated;
select 'QS10. confusions: ' || right_tag || ' ↔ ' || chosen_tag || ' ×' || times || ' (expect Schizont ↔ Merozoite ×2)' from public.study_my_confusions(:'g');
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'QS10b. Maya''s confusions: ' || count(*) || ' (expect 0: only her own answers)' from public.study_my_confusions(:'g');

-- QS11-QS14: the worker path. A part is planned and saved by the worker (the
-- key, no member); a diagram that exists is kept, an unknown one dropped;
-- whens and tags are stored; a held part is busy for a member's tap.
reset role;
set role anon;
reset request.jwt.claim.sub;
select 'QS11. anon may call study_save_question: ' || has_function_privilege('anon', 'public.study_save_question(uuid, uuid, jsonb, text)', 'execute')
       || ', study_question_round: ' || has_function_privilege('anon', 'public.study_question_round(uuid, text)', 'execute')
       || ' (expect false, false: the worker reaches them only through section B)';
reset role;
create schema if not exists stest;
-- As the worker would (inside section B's definer functions): no member token, the key.
create or replace function stest.worker_round(p_lecture uuid, p_key text) returns int language plpgsql security definer as $$
declare r int; b record;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  select x.round into r from public.study_question_round(p_lecture, p_key) x;
  for b in select id from public.study_question_batches where lecture_id = p_lecture and round = r loop
    perform public.study_question_claim(b.id, p_key);
  end loop;
  return r;
end $$;
select stest.worker_round(:'l1', :'key') as wr \gset
select 'QS11b. the worker planned round ' || :'wr' || ' with ' || count(*) || ' parts writing (expect 1, 3)'
  from public.study_question_batches where lecture_id = :'l1' and status = 'writing';
do $$ begin perform stest.worker_round(current_setting('t.l1')::uuid, 'not-the-key-0123456789abcdef0123'); raise notice 'QS11c. FAIL: planned without the key';
exception when others then raise notice 'QS11c. %: no key, no plan (%)', case when sqlerrm in ('not signed in', 'forbidden') then 'ok' else 'FAIL' end, sqlerrm; end $$;
select id as qb from public.study_question_batches where lecture_id = :'l1' and part_idx = 0 \gset
create or replace function stest.worker_save(p_batch uuid, p_q jsonb, p_key text) returns uuid language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  return public.study_save_question(p_batch, null, p_q, p_key);
end $$;
select stest.worker_save(:'qb', '{"kind":"case","difficulty":2,"vignette":"מטייל חזר מתאילנד.","question":"מה לפני השחרור?",
  "options":["Artesunate","G6PD ו-Primaquine","Mefloquine","Doxycycline","לשחרר"],"answer":1,
  "explanations":["א [ש'' 3]","ב [ש'' 5]","ג [ש'' 7]","ד [ש'' 7]","ה [ש'' 3]"],
  "whens":["מתי כן: מלריה קשה","","מתי כן: שלב הדם","מתי כן: מניעה","מתי לא: אף פעם"],
  "option_tags":["Artesunate","Primaquine","Mefloquine","Doxycycline",""],
  "takeaway":"לפני Primaquine: G6PD [ש'' 7]","slides":[5,7],"topic":"Primaquine","aspect":"contra","para":2,"quote":"ה-Hypnozoite ישן",
  "teaser":"vivax אחרי תאילנד","figure":"fig:5-1","model":"claude-opus-5-5"}'::jsonb, :'key') as q8 \gset
select 'QS12. saved by the worker: figure ' || q.figure || ', tags ' || cardinality(q.option_tags) || ', anchor ' || q.anchor
       || ', whens ' || cardinality(k.whens) || ', created_by ' || coalesce(q.created_by::text, 'none') || ' (expect fig:5-1, 5, 2, 5, none)'
  from public.study_questions q join public.study_question_keys k on k.question_id = q.id where q.id = :'q8';
select stest.worker_save(:'qb', '{"kind":"mcq","question":"מה עוד?","options":["א","ב","ג","ד","ה"],"answer":0,
  "explanations":["1","2","3","4","5"],"slides":[3],"topic":"X","aspect":"other","figure":"fig:9-9"}'::jsonb, :'key') as q9 \gset
select 'QS12b. an unknown picture is dropped, the question kept: ' || coalesce(nullif(figure, ''), '(none)') || ' (expect (none))'
  from public.study_questions where id = :'q9';
do $$ begin perform stest.worker_save(current_setting('t.qb', true)::uuid, '{}'::jsonb, current_setting('t.key')); raise notice 'QS12c. skipped';
exception when others then raise notice 'QS12c. ok: a malformed item is refused (%)', sqlerrm; end $$;
do $$ begin perform stest.worker_save((select id from public.study_question_batches where lecture_id = current_setting('t.l1')::uuid and part_idx = 1),
  '{"kind":"mcq","question":"מה?","options":["א","ב","ג","ד","ה"],"answer":0,"explanations":["1","2","3","4","5"],"whens":["x"],"slides":[15]}'::jsonb,
  current_setting('t.key')); raise notice 'QS12d. FAIL: whens of the wrong length';
exception when others then raise notice 'QS12d. %: whens must match the options (%)', case when sqlerrm = 'whens do not match options' then 'ok' else 'FAIL' end, sqlerrm; end $$;
update public.study_question_batches set hold_until = now() + interval '3 hours', status = 'pending' where lecture_id = :'l1' and part_idx = 2;
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_question_claim((select id from public.study_question_batches where lecture_id = current_setting('t.l1')::uuid and part_idx = 2),
  current_setting('t.key')); raise notice 'QS13. FAIL: a member took a part the Batch API holds';
exception when others then raise notice 'QS13. %: a held part is busy for a tap (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_question_batches set hold_until = now() - interval '1 minute' where lecture_id = :'l1' and part_idx = 2;
set role authenticated;
select 'QS13b. after the hold, a tap claims it: ' || (wanted > 0) || ' (expect true)'
  from public.study_question_claim((select id from public.study_question_batches where lecture_id = :'l1' and part_idx = 2), :'key');
reset role;
create or replace function stest.worker_finish(p_batch uuid, p_key text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.study_question_finish(p_batch, 'ready', 1, 'claude-opus-5-5', 0.02, null, p_key, 2);
end $$;
select stest.worker_finish(:'qb', :'key');
select 'QS14. finished by the worker: ' || status || ', rejected ' || rejected || ', solver ' || solver_rejected || ', hold ' || coalesce(hold_until::text, 'none')
       || ' (expect ready, 1, 2, none)' from public.study_question_batches where id = :'qb';
select 'QS-reg. Q = ' || (public.study_schema() ->> 'Q') || ' (expect 2)';

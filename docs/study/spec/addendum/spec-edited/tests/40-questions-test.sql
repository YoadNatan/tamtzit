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
select 'Q-reg. the registry: ' || (public.study_schema() ->> 'Q') || ' (expect 2: with section Q''s end)';
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000a7';
update study_private.features set enabled = false where name = 'exams';

-- Clean-up for the sections after this one (they count the group's answers):
-- the past exam goes, and its items, keys and answers with it.
reset role;
delete from public.study_exams where group_id = :'gid';

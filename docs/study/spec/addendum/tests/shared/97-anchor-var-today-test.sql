-- ════════════════════════════════════════════════════════════════════════
--  SECTIONS N, V, T checks · the anchor, disputes and the spread, Today
--  (meeting addendum §5-§7). Same session, after 96-meeting-test.sql.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
select set_config('t.gid', :'gid', false) is not null as g \gset
\set key 'k-0123456789abcdef0123456789abcdef'

-- ═════════ N · the chip row and the paragraph's "תרגול" tab ═════════
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'N1. Noa''s chips: ' || string_agg(c.part_idx || '.' || c.anchor || ' q' || c.questions || ' c' || c.cards || ' t' || c.comments
                                          || case when c.my_wrong > 0 then ' טעית×' || c.my_wrong else '' end
                                          || case when c.my_unclear then ' לא-ברור' else '' end, ' | ' order by c.part_idx, c.anchor)
       || ' (expect 0.1 q1 c0 (two chose the trap: no card, review SEC-6) טעית×1 | 0.2 q2, her wrong one, her "לא ברור" | 0.3 q1 t1 (the open question) | …)'
  from public.study_paragraph_chips('3c100000-0000-4000-8000-000000000001') c where c.part_idx = 0;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'N1b. Shoham''s chips on the same paragraphs are his own: wrong at 0.1 ' || coalesce(max(c.my_wrong) filter (where c.anchor = 1), 0)
       || ', "לא ברור" at 0.2 ' || coalesce(bool_or(c.my_unclear) filter (where c.anchor = 2), false) || ' (expect 0, false)'
  from public.study_paragraph_chips('3c100000-0000-4000-8000-000000000001') c where c.part_idx = 0;
reset role;
insert into public.study_card_states (user_id, card_id, state, step, stability, difficulty, due, last_review, reps)
values ('cccccccc-0000-4000-8000-000000000003', '3c3a0000-0000-4000-8000-000000000001', 2, 0, 3.2, 5, now() + interval '2 days', now() - interval '1 day', 1);
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'N2. the "תרגול" tab of 0.2: ' || jsonb_array_length(t -> 'questions') || ' questions (wrong once: '
       || (select count(*) from jsonb_array_elements(t -> 'questions') q where (q ->> 'wrong')::int = 1) || ', right last time: '
       || (select count(*) from jsonb_array_elements(t -> 'questions') q where (q ->> 'last_correct')::boolean) || '), '
       || jsonb_array_length(t -> 'cards') || ' cards (in her deck: '
       || (select count(*) from jsonb_array_elements(t -> 'cards') c where (c ->> 'in_deck')::boolean) || ')'
       || ' (expect 2 questions (1, 1), 1 card: the deck''s; two chose the round''s trap, no trap card, review SEC-6 (1))'
  from (select public.study_paragraph_practice('3c100000-0000-4000-8000-000000000001', 0, 2) as t) x;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_paragraph_practice('3c100000-0000-4000-8000-000000000001', 0, 2);
  raise notice 'N3. FAIL: a stranger read a paragraph''s tab';
exception when others then raise notice 'N3. %: (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'N3b. a stranger''s chips: ' || count(*) || ' rows (expect 0)' from public.study_paragraph_chips('3c100000-0000-4000-8000-000000000001');
reset role;
select 'N-reg. the registry: ' || (public.study_schema() ->> 'N') || ' (expect 1)';

-- ═════════ V · the yellow card, backing without names, VAR ═════════
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.d1', public.study_dispute_open('3c100000-0000-4000-8000-000000000001', 2, 2, 'Quinine עם Doxycycline',
  'Quinine עם Doxycycline, גם בהיריון', array[33])::text, false) is not null as d \gset
do $$
declare c record; n int := 0;
begin
  for c in select * from (values
      ('a second card on the paragraph', 2, 2, 'טענה ארוכה מספיק', array[33], 'dispute open'),
      ('a claim of three letters', 2, 1, 'לא!', array[30], 'bad claim'),
      ('a slide not in the lecture', 2, 1, 'טענה ארוכה מספיק', array[99], 'bad source'),
      ('no slide', 2, 1, 'טענה ארוכה מספיק', '{}'::int[], 'bad source'),
      ('a part that is not there', 9, 1, 'טענה ארוכה מספיק', array[30], 'part not found')
    ) as t(label, part, anchor, claim, slides, want) loop
    begin
      perform public.study_dispute_open('3c100000-0000-4000-8000-000000000001', c.part, c.anchor, '', c.claim, c.slides);
      raise notice 'V1. FAIL: % was opened', c.label;
    exception when others then if sqlerrm = c.want then n := n + 1; else raise notice 'V1. FAIL: % → %', c.label, sqlerrm; end if; end;
  end loop;
  raise notice 'V1. ok: % of 5 bad yellow cards refused with their reason', n;
end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_dispute_open('3c100000-0000-4000-8000-000000000001', 2, 1, '', 'טענה של זר', array[30]);
  raise notice 'V1b. FAIL: a stranger opened a yellow card';
exception when others then raise notice 'V1b. %: (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_dispute_claim(current_setting('t.d1')::uuid, 'Doxycycline אסורה בהיריון: רק Clindamycin', array[33]) is null as c \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_dispute_claim(current_setting('t.d1')::uuid, 'עוד צד שלישי', array[33]);
  raise notice 'V2. FAIL: a third side';
exception when others then raise notice 'V2. %: two sides (%)', case when sqlerrm = 'sides taken' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_dispute_back(current_setting('t.d1')::uuid, 'a') is null as b \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select public.study_dispute_back(current_setting('t.d1')::uuid, 'b') is null as b \gset
select 'V2b. two backers: counts ' || coalesce(s ->> 'backs', 'hidden') || ', backers ' || (s ->> 'backers') || ' (expect hidden, 2: from 3)'
  from (select public.study_dispute_state(current_setting('t.d1')::uuid) as s) x;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
select public.study_dispute_back(current_setting('t.d1')::uuid, 'b') is null as b \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_dispute_back(current_setting('t.d1')::uuid, 'a');
  raise notice 'V2c. FAIL: a side backed itself';
exception when others then raise notice 'V2c. %: (%)', case when sqlerrm = 'a side cannot back' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'V2d. Noa sees: ' || (s -> 'a' ->> 'name') || ' vs ' || (s -> 'b' ->> 'name') || ', backing ' || (s -> 'backs')::text
       || ', names of backers anywhere: ' || (s::text like '%איתי%' or s::text like '%דניאל%' or s::text like '%רוני%')
       || '; backing rows she can read: ' || (select count(*) from public.study_dispute_backs)
       || ' (expect נועה כהן vs מאיה, none: the split shows once backing closes, review SEC-10; false; 0)'
  from (select public.study_dispute_state(current_setting('t.d1')::uuid) as s) x;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select 'V2e. Itai sees his own side: ' || (public.study_dispute_state(current_setting('t.d1')::uuid) ->> 'mine') || ' (expect a)';
-- VAR (op 'var' takes the dispute, then saves with the server key)
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_dispute_judge_begin(current_setting('t.d1')::uuid);
  raise notice 'V2f. FAIL: the hold without the server key';
exception when others then raise notice 'V2f. %: only op var takes the dispute (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_dispute_judge_begin(current_setting('t.d1')::uuid, :'key') is null as j \gset
do $$ begin perform public.study_dispute_judge_begin(current_setting('t.d1')::uuid, 'k-0123456789abcdef0123456789abcdef');
  raise notice 'V2g. FAIL: a second phone''s VAR while the first runs';
exception when others then raise notice 'V2g. %: one VAR call at a time (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'V2h. VAR asked, backing closed: Noa sees ' || coalesce((public.study_dispute_state(current_setting('t.d1')::uuid) -> 'backs')::text, 'none')
       || ' (expect {"a": 1, "b": 2}: three backers, review SEC-10)';
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_dispute_back(current_setting('t.d1')::uuid, 'b');
  raise notice 'V2i. FAIL: backing after VAR was asked';
exception when others then raise notice 'V2i. %: backing closes when VAR is asked (%)', case when sqlerrm = 'not open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_dispute_verdict(current_setting('t.d1')::uuid,
    '{"certainty":"slide","summary":"כתוב בשקף 33","on_slides":[],"interpretation":[],"listen":false,"trap":null}'::jsonb, 'claude-opus-5-5');
  raise notice 'V3. FAIL: a verdict without the server key';
exception when others then raise notice 'V3. %: only op var saves a verdict (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$
declare v jsonb; n int := 0;
begin
  foreach v in array array[
      '{"certainty":"maybe","summary":"כתוב בשקף 33","on_slides":[],"interpretation":[],"listen":false}'::jsonb,
      '{"certainty":"slide","summary":"","on_slides":[],"interpretation":[],"listen":false}'::jsonb,
      '{"certainty":"slide","summary":"כתוב בשקף 99","on_slides":[{"text":"x x x","slides":[99]}],"interpretation":[],"listen":false}'::jsonb,
      '{"certainty":"slide","summary":"כתוב בשקף 33","on_slides":[],"interpretation":[],"listen":"no"}'::jsonb,
      '{"certainty":"slide","summary":"כתוב בשקף 33","on_slides":[],"interpretation":[],"listen":false,"trap":{"front":"קצר","back":"x","slides":[33]}}'::jsonb] loop
    begin
      perform public.study_dispute_verdict(current_setting('t.d1')::uuid, v, 'claude-opus-5-5', 'k-0123456789abcdef0123456789abcdef');
      raise notice 'V3b. FAIL: a bad verdict was saved: %', v;
    exception when others then if sqlerrm = 'bad verdict' then n := n + 1; else raise notice 'V3b. FAIL: %', sqlerrm; end if; end;
  end loop;
  raise notice 'V3b. ok: % of 5 malformed verdicts refused', n;
end $$;
select public.study_dispute_verdict(current_setting('t.d1')::uuid, jsonb_build_object(
  'certainty', 'interpretation',
  'summary', 'שתי הטענות כתובות בשקף 33; Doxycycline אסורה בהיריון, Clindamycin היא החלופה.',
  'on_slides', jsonb_build_array(jsonb_build_object('text', 'tetracyclines are contraindicated (pregnant women, children <8y old)', 'slides', jsonb_build_array(33))),
  'interpretation', jsonb_build_array(jsonb_build_object('text', 'השילוב עם Quinine בהיריון הוא עם Clindamycin', 'slides', jsonb_build_array(33))),
  'listen', true,
  'trap', jsonb_build_object('front', 'מטופלת בהיריון מקבלת Quinine: למה לא Doxycycline?', 'back', 'tetracycline: אסורה בהיריון ובילדים מתחת לגיל 8 [ש'' 33]',
                             'slides', jsonb_build_array(33))),
  'claude-opus-5-5', :'key') is null as v \gset
select 'V3c. judged: ' || state || ', certainty ' || (verdict ->> 'certainty') || ', listen ' || (verdict ->> 'listen') || ' (expect judged, interpretation, true)'
  from public.study_disputes where id = current_setting('t.d1')::uuid;
do $$ begin perform public.study_dispute_verdict(current_setting('t.d1')::uuid,
    '{"certainty":"slide","summary":"שוב","on_slides":[],"interpretation":[],"listen":false}'::jsonb, 'claude-opus-5-5', 'k-0123456789abcdef0123456789abcdef');
  raise notice 'V3d. FAIL: a second verdict';
exception when others then raise notice 'V3d. %: one VAR a dispute (%)', case when sqlerrm = 'not ready' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
select set_config('t.dc', coalesce(public.study_dispute_decide(current_setting('t.d1')::uuid, 'accept')::text, ''), false) is not null as d \gset
select 'V4. "לקבל": ' || d.state || ', decided by ' || (public.study_dispute_state(d.id) ->> 'decided_by') || '; the trap card for everyone: source '
       || c.source || ', on ' || c.part_idx || '.' || c.anchor || ', key ' || (c.trap_key = 'd:' || d.id::text)
       || ' (expect accepted, רוני; trap, 2.2, true)'
  from public.study_disputes d join public.study_cards c on c.id = current_setting('t.dc')::uuid where d.id = current_setting('t.d1')::uuid;
do $$ begin perform public.study_dispute_decide(current_setting('t.d1')::uuid, 'override');
  raise notice 'V4b. FAIL: decided twice';
exception when others then raise notice 'V4b. %: (%)', case when sqlerrm = 'not judged' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- A yellow card on a pending correction: the correction waits for the dispute.
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select set_config('t.pv', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 2, 1,
  'Artemisinins לעולם לא לבד. [ש'' 30]', 'Artemisinins לעולם לא לבד, תמיד עם שותף ארוך טווח. [ש'' 30]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 2), 0, 1, '', 'slide', array[30], null, '')::text, false) is not null as p \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select set_config('t.d2', public.study_dispute_open('3c100000-0000-4000-8000-000000000001', 2, 1, 'Artemisinins',
  'השותף לא חייב להיות ארוך טווח לפי השקף', array[30], current_setting('t.pv')::uuid)::text, false) is not null as d \gset
do $$ begin perform public.study_approve_edit(current_setting('t.pv')::uuid);
  raise notice 'V5. FAIL: a disputed correction was approved';
exception when others then raise notice 'V5. %: a yellow card holds the correction (%)', case when sqlerrm = 'not pending' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_dispute_claim(current_setting('t.d2')::uuid, 'בשקף 30: combine with long-acting partner', array[30]) is null as c \gset
select public.study_dispute_judge_begin(current_setting('t.d2')::uuid, :'key') is null as j \gset
select public.study_dispute_verdict(current_setting('t.d2')::uuid,
  '{"certainty":"slide","summary":"כתוב בשקף 30: שותף ארוך טווח.","on_slides":[{"text":"combine with long-acting partner","slides":[30]}],"interpretation":[],"listen":false,"trap":null}'::jsonb,
  'claude-opus-5-5', :'key') is null as v \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select public.study_dispute_decide(current_setting('t.d2')::uuid, 'override', 'בהרצאה נאמר שכל שותף מתאים') is null as d \gset
select 'V5b. "בהרצאה נאמר אחרת": ' || d.state || ', note kept ' || (d.decision_note <> '') || ', no card ' || (d.trap_card is null)
       || '; the correction is open again: ' || p.state || ' (expect overridden, true, true; pending)'
  from public.study_disputes d, public.study_edit_proposals p where d.id = current_setting('t.d2')::uuid and p.id = current_setting('t.pv')::uuid;
select set_config('t.ev', public.study_approve_edit(current_setting('t.pv')::uuid) ->> 'edit_id', false) is not null as a \gset
-- The deck's own slips.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.f1', public.study_slide_flag('3c100000-0000-4000-8000-000000000001', array[28],
  'הכותרת היא mefloquine, אבל רובו העתק של שקף 27 על Quinine')::text, false) is not null as f \gset
do $$ begin perform public.study_slide_flag('3c100000-0000-4000-8000-000000000001', array[28], 'קצר');
  raise notice 'V6. FAIL: a flag without a real note';
exception when others then raise notice 'V6. %: (%)', case when sqlerrm = 'bad note' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
select public.study_slide_flag_remove(current_setting('t.f1')::uuid) is null as r \gset
select 'V7. the lecture''s log: ' || string_agg(k || ' ' || n, ', ' order by k) || '; the slide flag: removed by '
       || (select e ->> 'removed_by' from jsonb_array_elements(public.study_lecture_log('3c100000-0000-4000-8000-000000000001')) e where e ->> 'kind' = 'slide')
       || '; the last correction''s approver: '
       || (select e ->> 'approver' from jsonb_array_elements(public.study_lecture_log('3c100000-0000-4000-8000-000000000001')) e
            where e ->> 'kind' = 'edit' and e ->> 'id' = current_setting('t.ev'))
       || ' (expect edit 5: three corrections and two undos, the reader''s own aloud refused, review SEC-3; slide 1, verdict 2; רוני; דניאל)'
  from (select e ->> 'kind' as k, count(*) as n from jsonb_array_elements(public.study_lecture_log('3c100000-0000-4000-8000-000000000001')) e group by 1) x;
-- The spread: Noa had answered a question on the Chloroquine paragraph, Maya had reviewed its card.
reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
values ('cccccccc-0000-4000-8000-000000000003', '3c2a0000-0000-4000-8000-000000000005', 0, true, 'lecture', now() - interval '2 days');
insert into public.study_card_reviews (id, user_id, card_id, rating, reviewed_at, elapsed_days, state_before, state_after, stability, difficulty, due)
values (gen_random_uuid(), '3c000000-0000-4000-8000-000000000001', '3c3a0000-0000-4000-8000-000000000002', 3, now() - interval '1 day', 0, 0, 2, 2.5, 5, now() + interval '2 days');
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select set_config('t.ps', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 1,
  'Chloroquine מצטברת בוואקואולה. [ש'' 15]', 'Chloroquine מצטברת בוואקואולה החומצית של הטפיל. [ש'' 15]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1), 0, 1, '', 'slide', array[15], null, '')::text, false) is not null as p \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select set_config('t.es', public.study_approve_edit(current_setting('t.ps')::uuid) ->> 'edit_id', false) is not null as a \gset
reset role;
select 'V8. after the correction: the question on the paragraph out of practice ' ||
       (select stale_edit::text = current_setting('t.es') from public.study_questions where id = '3c2a0000-0000-4000-8000-000000000005')
       || ', the card too ' || (select stale_edit::text = current_setting('t.es') from public.study_cards where id = '3c3a0000-0000-4000-8000-000000000002')
       || '; "עדכון" for ' || (select string_agg(m.name || ' (' || u.reason || ')', ', ' order by m.name) from public.study_updates u
                                 join public.study_members m on m.user_id = u.user_id where u.edit_id = current_setting('t.es')::uuid)
       || ' (expect true, true; מאיה (card), נועה כהן (question): not the author or the approver)';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'V8b. Noa''s "עדכון": ' || before_text || ' → ' || after_text || ' · תיקון: ' || author || ' · אישור: ' || approver
       || ' · מקור: ' || source_kind || ' ' || array_to_string(source_slides, ',') || ' · why: ' || reason
       || ' (expect the old and new line · איתי · דניאל · slide 15 · question)'
  from public.study_my_updates(:'gid') where edit_id = current_setting('t.es')::uuid;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.vq', public.study_quiz_create(:'gid', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 3, 60, 'all', 'free', null, 1, 1)::text, false) is not null as q \gset
select public.study_quiz_next(current_setting('t.vq')::uuid, -1) is null as n \gset
reset role;
select 'V8c. a new quiz on that part leaves the marked question out: ' ||
       (not exists (select 1 from public.study_quiz_rounds where quiz_id = current_setting('t.vq')::uuid and question_id = '3c2a0000-0000-4000-8000-000000000005'))
       || ', rounds ' || (select count(*) from public.study_quiz_rounds where quiz_id = current_setting('t.vq')::uuid) || ' (expect true, 1)';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_end(current_setting('t.vq')::uuid) is null as e \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_update_seen((select id from public.study_my_updates(:'gid') where edit_id = current_setting('t.es')::uuid)) is null as s \gset
select 'V8d. "הבנתי": ' || count(*) || ' left (expect 0)' from public.study_my_updates(:'gid') where edit_id = current_setting('t.es')::uuid;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select public.study_edit_block('3c100000-0000-4000-8000-000000000001', 1, 1,
  'Chloroquine מצטברת בוואקואולה החומצית של הטפיל. [ש'' 15]', 'Chloroquine מצטברת בוואקואולה. [ש'' 15]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1), 0, 1, '',
  current_setting('t.es')::uuid) is not null as u \gset
reset role;
select 'V8e. undone: marks cleared ' || (select stale_at is null from public.study_questions where id = '3c2a0000-0000-4000-8000-000000000005')
       || '/' || (select stale_at is null from public.study_cards where id = '3c3a0000-0000-4000-8000-000000000002')
       || ', Maya''s unseen update gone ' || (not exists (select 1 from public.study_updates where edit_id = current_setting('t.es')::uuid and user_id = '3c000000-0000-4000-8000-000000000001'))
       || ', Noa''s seen one kept ' || (exists (select 1 from public.study_updates where edit_id = current_setting('t.es')::uuid and user_id = 'cccccccc-0000-4000-8000-000000000003'))
       || ' (expect true/true, true, true)';
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
do $$ begin perform public.study_dispute_close(current_setting('t.d2')::uuid);
  raise notice 'V9. FAIL: a member closed someone else''s yellow card';
exception when others then raise notice 'V9. %: (%)', case when sqlerrm = 'dispute not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'V9b. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_disputes, study_slide_flags: never backing or updates)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('study_disputes', 'study_dispute_backs', 'study_slide_flags', 'study_updates');
select 'V-reg. the registry: ' || (public.study_schema() ->> 'V') || ' (expect 1)';

-- ═════════ T · Today ═════════
-- The flame: Roni's activity on four of the last seven days; Daniel's on one.
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
select '3c000000-0000-4000-8000-000000000004', '3c2a0000-0000-4000-8000-000000000007', 0, true, 'lecture', now() - make_interval(days => d)
  from unnest(array[0, 1, 2, 4]) d;
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
select 'T1. Roni''s flame: ' || (f ->> 'days') || '/7, lit ' || (f ->> 'lit') || ' (expect 4/7, true)' from (select public.study_my_flame(:'gid') as f) x;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select 'T1b. Daniel''s: ' || (f ->> 'days') || '/7, lit ' || (f ->> 'lit') || ' (expect 1/7, false: it never says anyone else''s)' from (select public.study_my_flame(:'gid') as f) x;
-- Quiz returns: Noa's wrong first vote moves to yesterday.
reset role;
update public.study_answers set answered_at = answered_at - interval '1 day'
 where user_id = 'cccccccc-0000-4000-8000-000000000003' and question_id = '3c2a0000-0000-4000-8000-000000000001' and mode = 'quiz';
update public.study_quiz_answers a set answered_at = a.answered_at - interval '1 day'
  from public.study_quiz_rounds r
 where a.round_id = r.id and r.question_id = '3c2a0000-0000-4000-8000-000000000001' and a.user_id = 'cccccccc-0000-4000-8000-000000000003';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'T2. due again tomorrow-of-the-quiz: step ' || step || ', bet ' || bet || ', "הבנתי בדיון" ' || fixed_in_discussion || ' (expect 1, 3, true)'
  from public.study_my_quiz_returns(:'gid') where question_id = '3c2a0000-0000-4000-8000-000000000001';
reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
values ('cccccccc-0000-4000-8000-000000000003', '3c2a0000-0000-4000-8000-000000000001', 0, true, 'mistakes', now());
set role authenticated;
select 'T2b. answered today: due ' || count(*) || ' (expect 0 until the third day)' from public.study_my_quiz_returns(:'gid') where question_id = '3c2a0000-0000-4000-8000-000000000001';
reset role;
update public.study_answers set answered_at = answered_at - interval '2 days'
 where user_id = 'cccccccc-0000-4000-8000-000000000003' and question_id = '3c2a0000-0000-4000-8000-000000000001';
update public.study_quiz_answers a set answered_at = a.answered_at - interval '2 days'
  from public.study_quiz_rounds r
 where a.round_id = r.id and r.question_id = '3c2a0000-0000-4000-8000-000000000001' and a.user_id = 'cccccccc-0000-4000-8000-000000000003';
set role authenticated;
select 'T2c. three days on: step ' || step || ' (expect 2)' from public.study_my_quiz_returns(:'gid') where question_id = '3c2a0000-0000-4000-8000-000000000001';
-- One confident error in another wording: Noa's "על בטוח" miss on 0.2 moves to yesterday.
reset role;
select set_config('t.qb', (select r.question_id::text from public.study_quiz_rounds r join public.study_quizzes z on z.id = r.quiz_id
                            where z.title = 'מלריה (פגישה)' and z.preset = 'end' and r.idx = 2 and z.part_from = 0 order by z.created_at limit 1), false) is not null as q \gset
update public.study_answers set answered_at = answered_at - interval '1 day'
 where user_id = 'cccccccc-0000-4000-8000-000000000003' and question_id = current_setting('t.qb')::uuid;
set role authenticated;
select 'T3. the danger row is the danger list''s first due row: ' || (d.question_id = l.question_id and d.ask_id = l.ask_id)
       || '; the newer miss is on the list too: ' || exists (select 1 from public.study_my_danger_list(:'gid') x where x.question_id::text = current_setting('t.qb'))
       || '; asked in another wording when its paragraph has one: ' || (d.other_wording = (d.ask_id <> d.question_id))
       || ' (expect true; true; true: one rule for the "על בטוח" row, review F-9)'
  from public.study_my_danger(:'gid') d,
       lateral (select x.* from public.study_my_danger_list(:'gid') x where x.due_day <= public.study_day(now()) + date '1970-01-01'
                 order by x.due_day, x.wrong_at limit 1) l;
-- "הקבוצה צריכה אותך" (phase 3): off by default; Itai opts in and has mastered Primaquine.
reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, answered_at)
select '3c000000-0000-4000-8000-000000000002', q, 0, true, 'lecture', now()
  from unnest(array['3c2a0000-0000-4000-8000-000000000002', '3c2a0000-0000-4000-8000-000000000003', '3c2a0000-0000-4000-8000-000000000004']::uuid[]) q;
insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body, author_id, created_at)
values ('3c100000-0000-4000-8000-000000000001', 0, 2, 'ה-Hypnozoite ישן', 'question', 'למה ה-hypnozoite לא מגיב לשום תרופה אחרת?',
        'cccccccc-0000-4000-8000-000000000003', now() - interval '3 hours');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.pn', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 2,
  'Mefloquine ניתנת פעם בשבוע. [ש'' 20]', 'Mefloquine ניתנת פעם בשבוע (t½ ארוך). [ש'' 20]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1), 0, 1, '', 'slide', array[20], null, '')::text, false) is not null as p \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select 'T4. before opting in: ' || public.study_needs_me(:'gid')::text || ' (expect [])';
select public.study_set_needs_me(:'gid', true) is null as o \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select public.study_set_needs_me(:'gid', true) is null as o \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select 'T4b. Itai (opted in, mastered it): ' || string_agg(e ->> 'kind', ', ' order by e ->> 'kind')
       || '; the question is Noa''s on 0.2: ' || bool_or(e ->> 'body' like 'למה ה-hypnozoite%') || '; the approval is Noa''s: ' || bool_or(e ->> 'by' = 'נועה כהן')
       || ' (expect approval, question; true; true)'
  from jsonb_array_elements(public.study_needs_me(:'gid')) e;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select 'T4c. Daniel (opted in, not mastered): ' || coalesce(string_agg(e ->> 'kind', ', '), 'none') || ' (expect approval: only the chosen member sees the question)'
  from jsonb_array_elements(public.study_needs_me(:'gid')) e;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'T5. Noa''s Today has every source: ' ||
       (public.study_today(:'gid') ?& array['quiz_returns', 'danger', 'unclear', 'updates', 'missed', 'needs_me', 'flame']) || ' (expect true)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_today(current_setting('t.gid')::uuid); raise notice 'T6. FAIL: a stranger read a Today';
exception when others then raise notice 'T6. %: (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'T6b. prefs are private and unpublished: ' || (not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_member_prefs'))
       || '; the registry: ' || (public.study_schema() ->> 'T') || ' (expect true; 1)';

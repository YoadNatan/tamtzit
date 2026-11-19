-- ════════════════════════════════════════════════════════════════════════
--  Section C's end (server lines) · CS: the deck part by part (D8), private
--  cards from mistakes and answers (C5), one review home (C6).
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';   -- מאיה

-- CS1-CS4: D8. Nothing added yet: only the trap card is new for her.
select 'CS1. new before adding: ' || new_cards || ' of ' || cards || ' (expect 1 of 4: the trap card only)'
  from public.study_my_card_counts(:'g') where lecture_id = :'l1';
select 'CS1b. deck page: ' || string_agg(part_idx || ':' || cards || ':' || in_deck, ' ' order by part_idx) || ' (expect 0:2:false 1:1:false 2:1:false)'
  from public.study_my_deck(:'l1');
select 'CS2. added part 0: ' || public.study_card_adopt(:'l1', array[0], true)::text || ' (expect {0})';
select 'CS2b. new now: ' || new_cards || ' (expect 3: part 0''s two and the trap card)' from public.study_my_card_counts(:'g') where lecture_id = :'l1';
select 'CS2c. every part: ' || public.study_card_adopt(:'l1', null, true)::text || ', then part 1 out: ' || public.study_card_adopt(:'l1', array[1], false)::text
       || ' (expect {0,1,2}, then {0,2})';
do $$ begin perform public.study_card_adopt(current_setting('t.l1')::uuid, array[7], true); raise notice 'CS2d. FAIL: a part that does not exist';
exception when others then raise notice 'CS2d. %: only the lecture''s parts (%)', case when sqlerrm = 'bad parts' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';   -- איתי
select 'CS3. Itai''s deck is his own: new ' || new_cards || ', in_deck parts ' || (select count(*) from public.study_my_deck(:'l1') where in_deck)
       || ', rows he sees ' || (select count(*) from public.study_card_adoptions) || ' (expect 1, 0, 0)'
  from public.study_my_card_counts(:'g') where lecture_id = :'l1';
-- A card he adds himself is new for him without adding its part.
select public.study_add_card(:'l1', '{"kind":"qa","front":"מה הופך Sb(V)?","back":"Sb(III)","slides":[15]}'::jsonb) is not null as cs3b;
select 'CS3b. his own card counts as new: ' || new_cards || ' (expect 2)' from public.study_my_card_counts(:'g') where lecture_id = :'l1';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000009';
do $$ begin perform public.study_card_adopt(current_setting('t.l1')::uuid, null, true); raise notice 'CS4. FAIL: a stranger added a deck';
exception when others then raise notice 'CS4. %: strangers cannot (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- CS5-CS8: C5. Noa's wrong answers became private cards with the autopsy.
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';   -- נועה
select 'CS5. her mistake cards: ' || string_agg(right(question_id::text, 2) || ':' || origin, ' ' order by question_id) || ' (expect 01:practice 04:practice 06:practice 07:practice)'
  from public.study_my_cards where question_id is not null;
select 'CS5b. the card of 01: front «' || front || '», back «' || back || '», extra «' || extra || '» (expect שאלה 1?, Hypnozoite: למה ב [ש'' 5], ענית Schizont: למה ג [ש'' 7])'
  from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000001';
select 'CS5c. right answers make none: ' || count(*) || ' (expect 0 for 02 and 03)'
  from public.study_my_cards where question_id in ('a4000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000003');
select 'CS5d. a second miss of 07 made no second card: ' || count(*) || ' (expect 1)'
  from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000007';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select 'CS6. Maya sees ' || count(*) || ' of Noa''s private cards (expect 0)' from public.study_my_cards where user_id = 'a1000000-0000-4000-8000-000000000002';
-- A live quiz's first vote (section Z copies it into study_answers with mode 'quiz').
reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, confidence)
values ('a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000006', 3, false, 'quiz', 3);
set role authenticated;
select 'CS6b. her card from the quiz: ' || origin || ', extra «' || extra || '» (expect quiz, ענית Gametocyte: למה ד [ש'' 7])'
  from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000006';
select id as mc from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000006' \gset

-- CS7: reviewing a private card (FSRS from the phone, checked here), undo.
select 'CS7. review: ' || public.study_my_card_review('a6000000-0000-4000-8000-000000000001', :'mc', 3, now(), 4000, 0,
  jsonb_build_object('state', 1, 'step', 0, 'stability', 2.3, 'difficulty', 5.1, 'due', now() + interval '10 minutes', 'lapses', 0))
  || ', again: ' || public.study_my_card_review('a6000000-0000-4000-8000-000000000001', :'mc', 3, now(), 4000, 0,
  jsonb_build_object('state', 1, 'step', 0, 'stability', 2.3, 'difficulty', 5.1, 'due', now() + interval '10 minutes', 'lapses', 0))
  || ' (expect ok, dup)';
do $$ begin perform public.study_my_card_review('a6000000-0000-4000-8000-000000000002', (select id from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000006'),
  3, now(), 1000, 0, jsonb_build_object('state', 2, 'step', 0, 'stability', 5, 'difficulty', 5, 'due', now() + interval '1 day', 'lapses', 0));
  raise notice 'CS7b. FAIL: a stale review (reps 0 after one answer)';
exception when others then raise notice 'CS7b. %: another device''s answer in between (%)', case when sqlerrm = 'stale' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_my_card_review('a6000000-0000-4000-8000-000000000003', (select id from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000006'),
  1, now(), 1000, 1, jsonb_build_object('state', 3, 'step', 0, 'stability', 1, 'difficulty', 6, 'due', now() + interval '5 minutes', 'lapses', 1));
  raise notice 'CS7c. FAIL: a lapse counted on a learning card';
exception when others then raise notice 'CS7c. %: a lapse is שוב on a card in review only (%)', case when sqlerrm = 'bad state' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_my_card_undo('a6000000-0000-4000-8000-000000000001');
select 'CS7d. undone: state ' || state || ', reps ' || reps || ' (expect 0, 0)' from public.study_my_cards where id = :'mc';
select public.study_my_card_set(:'mc', 'delete');
select 'CS7e. deleted: ' || (deleted_at is not null) || ' (expect true)' from public.study_my_cards where id = :'mc';
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_my_card_set((select id from public.study_my_cards where question_id = 'a4000000-0000-4000-8000-000000000006'
  and user_id = 'a1000000-0000-4000-8000-000000000003'), 'restore'); raise notice 'CS7f. FAIL: Noa restored Maya''s card';
exception when others then raise notice 'CS7f. %: only the owner (%)', case when sqlerrm = 'card not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- CS8: K4. The answer to her own question becomes her card; not someone else's question.
select public.study_ask_to_group(:'l1', 0, 2, 'ה-Hypnozoite ישן', 'למה דווקא Primaquine?', 'Primaquine מגיעה ל-hypnozoites [ש'' 5]', :'key') as kq \gset
select 'CS8. card from her answered question: ' || (public.study_my_card_add(:'l1', 'answer', 0, 2, 'Primaquine: למה דווקא היא?',
  'רק היא מגיעה ל-hypnozoites', array[5], :'kq') is not null) || ' (expect true)';
do $$ begin perform public.study_my_card_add(current_setting('t.l1')::uuid, 'answer', 0, 2, 'שוב?', 'כן', '{}',
  (select id from public.study_comments where body = 'למה דווקא Primaquine?')); raise notice 'CS8b. FAIL: a second card for one thread';
exception when others then raise notice 'CS8b. %: one card per thread (%)', case when sqlerrm = 'already' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';
do $$ begin perform public.study_my_card_add(current_setting('t.l1')::uuid, 'answer', 0, 2, 'של נועה?', 'לא', '{}',
  (select id from public.study_comments where body = 'למה דווקא Primaquine?')); raise notice 'CS8c. FAIL: a card from someone else''s question';
exception when others then raise notice 'CS8c. %: only from one''s own question (%)', case when sqlerrm = 'not yours' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'CS8d. a wrong cell of a blank table: ' || (public.study_my_card_add(:'l1', 'table', 0, null, 'Atovaquone-proguanil על hypnozoite?',
  'לא: רק כבד ראשוני ודם [ש'' 23]', array[23]) is not null) || ' (expect true)';

-- CS9: C6, one review home, written by the owner through RLS.
insert into public.study_card_settings (home) values ('anki');
select 'CS9. home: ' || home || ' (expect anki)' from public.study_card_settings where user_id = auth.uid();
do $$ begin insert into public.study_card_settings (home) values ('both'); raise notice 'CS9b. FAIL: a third home';
exception when others then raise notice 'CS9b. ok: a home is the app or Anki (%)', sqlerrm; end $$;

-- CS10: privacy. The new private tables: RLS on, never published, no anon grant.
reset role;
select 'CS10. private tables published: ' || count(*) || ' (expect 0)' from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews');
select 'CS10b. RLS on: ' || count(*) filter (where relrowsecurity) || ' of ' || count(*) || ', anon may read: '
       || count(*) filter (where has_table_privilege('anon', oid, 'select')) || ' (expect 3 of 3, 0)'
  from pg_class where relname in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews') and relnamespace = 'public'::regnamespace;
select 'CS-reg. C = ' || (public.study_schema() ->> 'C') || ' (expect 2)';

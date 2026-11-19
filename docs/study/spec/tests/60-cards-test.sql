-- ════════════════════════════════════════════════════════════════════════
--  SECTION C checks · flashcards   (package C)
-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL: behaviour test for the flashcards SQL (design-cards.md §6.1).
-- Appended to supabase/tests/study.sql: it runs in the same psql session,
-- after the existing checks, and reuses their users (Shoham bbbb…, Noa cccc…,
-- a stranger dddd…) and :gid. Every C line should read "ok" or the expected
-- value; "FAIL" means a rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
-- A lecture of 12 slides with text, a picture on slide 3, and no outline yet.
insert into public.study_lectures (id, group_id, title, course, source_kind, slides)
select 'eeeeeeee-0000-4000-8000-0000000000c1', :'gid', 'Antiparasitics', 'פתוגן מאכסן', 'pptx',
       jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Metronidazole PFOR ', 30)),
                                    'tables', '[]'::jsonb, 'notes', '',
                                    'figures', case when n = 3 then '[{"k":1,"path":"x/y/s3-1.jpg","w":800,"h":600}]'::jsonb else '[]'::jsonb end)
                 order by n)
from generate_series(1, 12) n;
select 'C1. Shoham plans: round ' || round || ', ' || batches || ' parts, ' || wanted || ' cards, fresh ' || fresh || ' (expect 1, 2, 16, true)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C2. Noa taps too: round ' || round || ', fresh ' || fresh || ' (expect 1, false: the same round)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1');
select set_config('t.b0', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and part_idx = 0), false) is not null as b0 \gset
select set_config('t.b1', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and part_idx = 1), false) is not null as b1 \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C3. Shoham claims part 0: slides ' || slide_from || '-' || slide_to || ', ' || wanted || ' wanted, effort ' || effort || ' (expect 1-6, 8, medium)'
  from public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key'));
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key')); raise notice 'C3b. FAIL: two phones write one part';
exception when others then raise notice 'C3b. %: Noa cannot take the same part (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.ca', public.study_save_card(current_setting('t.b0')::uuid,
  '{"kind":"qa","front":"איך Metronidazole הופכת לפעילה בתא אנאירובי?","back":"PFOR מחזר אותה לתוצרים רעילים.","extra":"","figure":"","slides":[2],"topic":"Metronidazole","aspect":"mechanism","model":"claude-opus-5-5"}', current_setting('t.key'))::text, false) is not null as ca \gset
select set_config('t.cb', public.study_save_card(current_setting('t.b0')::uuid,
  '{"kind":"cloze","front":"בזמן טיפול ב-Metronidazole ועד {{48 שעות}} אחריו אין לשתות אלכוהול.","back":"","extra":"","figure":"fig:3-1","slides":[3],"topic":"Metronidazole","aspect":"interactions"}', current_setting('t.key'))::text, false) is not null as cb \gset
select 'C4. two cards saved: ' || count(*) || ' cards, part made ' || (select made from public.study_card_batches where id = current_setting('t.b0')::uuid) || ' (expect 2, 2)'
  from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
do $$
declare cases text[][] := array[
  array['{"kind":"qa","front":"שאלה על שקף שאינו קיים?","back":"x","slides":[40]}', 'unknown slide'],
  array['{"kind":"qa","front":"שאלה מחוץ לחלק?","back":"x","slides":[9]}', 'outside the part'],
  array['{"kind":"cloze","front":"שתי {{השלמות}} באותו {{משפט}}.","back":"","slides":[2]}', 'bad cloze'],
  array['{"kind":"cloze","front":"השלמה {{עם}} תשובה נפרדת.","back":"עם","slides":[2]}', 'bad cloze'],
  array['{"kind":"qa","front":"שאלה בלי תשובה?","back":"   ","slides":[2]}', 'bad answer'],
  array['{"kind":"qa","front":"תמונה שלא קיימת?","back":"x","figure":"fig:4-1","slides":[4]}', 'unknown figure'],
  array['{"kind":"qa","front":"בלי שקפים?","back":"x","slides":[]}', 'no slides']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_save_card(current_setting('t.b0')::uuid, cases[i][1]::jsonb, current_setting('t.key'));
      raise notice 'C5.% FAIL: accepted (%)', i, cases[i][2];
    exception when others then
      raise notice 'C5.% %: refused, % (expect %)', i, case when sqlerrm = cases[i][2] then 'ok' else 'FAIL' end, sqlerrm, cases[i][2];
    end;
  end loop;
end $$;
do $$ begin perform public.study_save_card(current_setting('t.b0')::uuid, '{"kind":"qa","front":"היבט לא מוכר?","back":"x","slides":[2],"aspect":"toxicity"}', current_setting('t.key'));
  raise notice 'C5.8 FAIL: an unknown aspect was saved';
exception when check_violation then raise notice 'C5.8 ok: an unknown aspect is refused by the table (%)', sqlerrm; end $$;
do $$ declare i int; begin
  for i in 1 .. 6 loop
    perform public.study_save_card(current_setting('t.b0')::uuid, jsonb_build_object('kind', 'qa', 'front', 'שאלה מספר ' || i || '?', 'back', 'תשובה ' || i, 'slides', jsonb_build_array(i)), current_setting('t.key'));
  end loop;
end $$;
do $$ begin
  perform public.study_save_card(current_setting('t.b0')::uuid, '{"kind":"qa","front":"תשיעית?","back":"x","slides":[1]}', current_setting('t.key'));
  raise notice 'C6. FAIL: a part took more than it asked for';
exception when others then raise notice 'C6. %: the 9th card of an 8-card part is refused (%)', case when sqlerrm = 'part full' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_card_finish(current_setting('t.b0')::uuid, 'ready', 1, 'claude-opus-5-5', 0.031, null, current_setting('t.key'));
select 'C7. part 0 finished: ' || status || ', made ' || made || ', rejected ' || rejected || ', cost ' || cost_usd || ' (expect ready, 8, 1, 0.0310)'
  from public.study_card_batches where id = current_setting('t.b0')::uuid;
do $$ begin perform public.study_card_claim(current_setting('t.b0')::uuid, current_setting('t.key')); raise notice 'C7b. FAIL: a finished part was claimed';
exception when others then raise notice 'C7b. %: a finished part cannot be claimed again (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- The group reads and fixes the deck
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C8. Noa sees ' || count(*) || ' cards and ' || (select count(*) from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' parts (expect 8, 2)'
  from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
do $$ begin update public.study_cards set front = 'x' where id = current_setting('t.ca')::uuid; raise notice 'C9. FAIL: a card was changed directly';
exception when insufficient_privilege then raise notice 'C9. ok: no direct update (%)', sqlerrm; end $$;
do $$ begin insert into public.study_cards (group_id, lecture_id, kind, front, back) values ((select id from public.study_groups limit 1), 'eeeeeeee-0000-4000-8000-0000000000c1', 'qa', 'xxx', 'y'); raise notice 'C9b. FAIL: a card was inserted directly';
exception when insufficient_privilege then raise notice 'C9b. ok: no direct insert (%)', sqlerrm; end $$;
do $$ begin delete from public.study_cards where id = current_setting('t.ca')::uuid; raise notice 'C9c. FAIL: a card was deleted directly';
exception when insufficient_privilege then raise notice 'C9c. ok: no direct delete (%)', sqlerrm; end $$;
select set_config('t.u0', (select updated_at::text from public.study_cards where id = current_setting('t.ca')::uuid), false) is not null as u0 \gset
select 'C10. Noa fixes the card: version ' || public.study_edit_card(current_setting('t.ca')::uuid, 1,
  '{"back":"PFOR מעביר אלקטרונים ל-ferredoxin, שמחזר את קבוצת ה-NO₂ שלה לתוצרים רעילים."}') || ' (expect 2)';
select 'C10b. edited by Noa: ' || (updated_by = 'cccccccc-0000-4000-8000-000000000003') || ', updated_at raised: ' || (updated_at > current_setting('t.u0')::timestamptz)
  || ', history: ' || (select string_agg(action || ' v' || version || ' by ' || left(edited_by::text, 4) || ' before "' || left(before ->> 'back', 10) || '"', '; ') from public.study_card_edits where card_id = current_setting('t.ca')::uuid)
  || ' (expect true, true, edit v2 by cccc before "PFOR מחזר ")'
  from public.study_cards where id = current_setting('t.ca')::uuid;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 1, '{"back":"גרסה ישנה"}'); raise notice 'C11. FAIL: an edit of an old version went through';
exception when others then raise notice 'C11. %: editing a version someone already changed is a conflict (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 2, '{}'); raise notice 'C11b. FAIL: an empty edit made a version';
exception when others then raise notice 'C11b. %: saving without a change does nothing (%)', case when sqlerrm = 'no change' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 2, '{"kind":"cloze","front":"אין כאן השלמה."}'); raise notice 'C11c. FAIL: a cloze without braces was saved';
exception when others then raise notice 'C11c. %: an edit keeps the card rules (%)', case when sqlerrm = 'bad cloze' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_revert_card((select id from public.study_card_edits where card_id = current_setting('t.ca')::uuid and action = 'edit')) as v12 \gset
select 'C12. Shoham undoes the fix: version ' || :'v12' || ', back "' || back || '", history ' || (select string_agg(action, ',' order by edited_at) from public.study_card_edits where card_id = current_setting('t.ca')::uuid)
  || ' (expect 3, "PFOR מחזר אותה לתוצרים רעילים.", edit,revert)' from public.study_cards where id = current_setting('t.ca')::uuid;
select set_config('t.u1', (select updated_at::text from public.study_cards where id = current_setting('t.cb')::uuid), false) is not null as u1 \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_delete_card(current_setting('t.cb')::uuid, true);
select public.study_delete_card(current_setting('t.cb')::uuid, true);
select 'C13. Noa deletes the cloze (twice): deleted ' || (deleted_at is not null) || ' by Noa ' || (deleted_by = 'cccccccc-0000-4000-8000-000000000003')
  || ', updated_at raised ' || (updated_at > current_setting('t.u1')::timestamptz) || ', version ' || version || ' (expect true, true, true, 1)'
  from public.study_cards where id = current_setting('t.cb')::uuid;
do $$ begin perform public.study_edit_card(current_setting('t.cb')::uuid, 1, '{"front":"בזמן טיפול ועד {{48 שעות}} אחריו."}'); raise notice 'C13b. FAIL: a deleted card was edited';
exception when others then raise notice 'C13b. %: a deleted card is not edited (%)', case when sqlerrm = 'card deleted' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_delete_card(current_setting('t.cb')::uuid, false);
select 'C13c. Shoham restores it: deleted ' || (deleted_at is not null) || '; history ' || (select string_agg(action, ',' order by edited_at) from public.study_card_edits where card_id = current_setting('t.cb')::uuid)
  || ' (expect false; delete,restore)' from public.study_cards where id = current_setting('t.cb')::uuid;

-- A stranger
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'C14. stranger sees ' || count(*) || ' cards, ' || (select count(*) from public.study_card_edits) || ' history rows, ' || (select count(*) from public.study_card_batches) || ' parts (expect 0, 0, 0)' from public.study_cards;
do $$ begin perform public.study_edit_card(current_setting('t.ca')::uuid, 3, '{"back":"x"}'); raise notice 'C14b. FAIL: stranger edited';
exception when others then raise notice 'C14b. %: stranger cannot edit (%)', case when sqlerrm = 'card not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_delete_card(current_setting('t.ca')::uuid, true); raise notice 'C14c. FAIL: stranger deleted';
exception when others then raise notice 'C14c. %: stranger cannot delete (%)', case when sqlerrm = 'card not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C14d. FAIL: stranger planned a round';
exception when others then raise notice 'C14d. %: stranger cannot generate (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- Reviewing: private, idempotent, checked, undoable
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C15. Shoham answers טוב on a new card: ' || public.study_card_review('aaaa0001-0000-4000-8000-000000000001', current_setting('t.ca')::uuid, 3, now(), 4200, 0,
  jsonb_build_object('state', 1, 'step', 1, 'stability', 2.3065, 'difficulty', 2.11810397, 'due', now() + interval '10 minutes', 'lapses', 0)) || ' (expect ok)';
select 'C15b. the same answer sent again: ' || public.study_card_review('aaaa0001-0000-4000-8000-000000000001', current_setting('t.ca')::uuid, 3, now(), 4200, 0,
  jsonb_build_object('state', 1, 'step', 1, 'stability', 2.3065, 'difficulty', 2.11810397, 'due', now() + interval '10 minutes', 'lapses', 0))
  || '; reviews ' || (select count(*) from public.study_card_reviews) || ', reps ' || (select reps from public.study_card_states where card_id = current_setting('t.ca')::uuid) || ' (expect dup; 1, 1)';
do $$
declare cases text[][] := array[
  array['0', '3', '{"state":1,"step":1,"stability":2.3,"difficulty":2.1,"lapses":0}', 'stale'],
  array['1', '5', '{"state":2,"step":0,"stability":3,"difficulty":2,"lapses":0}', 'bad rating'],
  array['1', '3', '{"state":2,"step":0,"stability":0,"difficulty":2,"lapses":0}', 'bad state'],
  array['1', '3', '{"state":2,"step":0,"stability":3,"difficulty":11,"lapses":0}', 'bad state'],
  array['1', '3', '{"state":2,"step":0,"stability":3,"difficulty":2,"lapses":1}', 'bad state'],
  array['1', '3', '{"state":0,"step":0,"stability":3,"difficulty":2,"lapses":0}', 'bad state']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, cases[i][2]::int, now(), 1000, cases[i][1]::int,
                                       cases[i][3]::jsonb || jsonb_build_object('due', now() + interval '2 days'));
      raise notice 'C16.% FAIL: accepted (%)', i, cases[i][4];
    exception when others then
      raise notice 'C16.% %: refused, % (expect %)', i, case when sqlerrm = cases[i][4] then 'ok' else 'FAIL' end, sqlerrm, cases[i][4];
    end;
  end loop;
  begin
    perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 3, now() + interval '1 day', 1000, 1,
      jsonb_build_object('state', 2, 'step', 0, 'stability', 3, 'difficulty', 2, 'lapses', 0, 'due', now() + interval '3 days'));
    raise notice 'C16.7 FAIL: an answer from tomorrow was accepted';
  exception when others then raise notice 'C16.7 %: refused, % (expect bad time)', case when sqlerrm = 'bad time' then 'ok' else 'FAIL' end, sqlerrm;
  end;
  begin
    perform public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 3, now(), 1000, 1,
      jsonb_build_object('state', 2, 'step', 0, 'stability', 3, 'difficulty', 2, 'lapses', 0, 'due', now() - interval '1 day'));
    raise notice 'C16.8 FAIL: a due time before the answer was accepted';
  exception when others then raise notice 'C16.8 %: refused, % (expect bad state)', case when sqlerrm = 'bad state' then 'ok' else 'FAIL' end, sqlerrm;
  end;
end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C17. Noa sees ' || count(*) || ' states and ' || (select count(*) from public.study_card_reviews) || ' reviews (expect 0, 0: Shoham''s are hers)' from public.study_card_states;
do $$ begin insert into public.study_card_states (user_id, card_id, state) values ('bbbbbbbb-0000-4000-8000-000000000002', current_setting('t.ca')::uuid, 0); raise notice 'C17b. FAIL: a state was written directly';
exception when insufficient_privilege then raise notice 'C17b. ok: states are written only by the functions (%)', sqlerrm; end $$;
do $$ begin perform public.study_card_undo('aaaa0001-0000-4000-8000-000000000001'); raise notice 'C17c. FAIL: Noa undid Shoham''s answer';
exception when others then raise notice 'C17c. %: nobody undoes someone else''s answer (%)', case when sqlerrm = 'review not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_card_review('aaaa0002-0000-4000-8000-000000000002', current_setting('t.ca')::uuid, 3, now(), 3000, 1,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 2.3065, 'difficulty', 2.11121424, 'due', now() + interval '2 days', 'lapses', 0));
do $$ begin perform public.study_card_undo('aaaa0001-0000-4000-8000-000000000001'); raise notice 'C18. FAIL: an older answer was undone first';
exception when others then raise notice 'C18. %: only the latest answer can be undone (%)', case when sqlerrm = 'not the latest' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_card_undo('aaaa0002-0000-4000-8000-000000000002');
select 'C18b. undo the latest: state ' || state || ', step ' || step || ', reps ' || reps || ' (expect 1, 1, 1)' from public.study_card_states where card_id = current_setting('t.ca')::uuid;
select public.study_card_undo('aaaa0001-0000-4000-8000-000000000001');
select 'C18c. undo the first: ' || count(*) || ' state rows, ' || (select count(*) from public.study_card_reviews) || ' reviews (expect 0, 0: the card is new again)'
  from public.study_card_states where card_id = current_setting('t.ca')::uuid;

-- Hiding, counts, the study day
select public.study_card_hide(current_setting('t.cb')::uuid, true);
-- One card in review due earlier today, one learning card due in 5 minutes.
select public.study_card_review(gen_random_uuid(), current_setting('t.ca')::uuid, 4, now() - interval '9 days', 2000, 0,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 8.2956, 'difficulty', 1, 'due', now() - interval '1 day', 'lapses', 0));
select public.study_card_review(gen_random_uuid(), (select id from public.study_cards where front = 'שאלה מספר 1?'), 1, now(), 2000, 0,
  jsonb_build_object('state', 1, 'step', 0, 'stability', 0.212, 'difficulty', 6.4133, 'due', now() + interval '5 minutes', 'lapses', 0));
select 'C19. Shoham''s counts: cards ' || cards || ', new ' || new_cards || ', learning ' || learning_due || ', review ' || review_due
  || ', studied ' || studied || ', hidden ' || hidden || ' (expect 8, 5, 1, 1, 2, 1)'
  from public.study_my_card_counts(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C19b. Noa''s counts: new ' || new_cards || ', review ' || review_due || ', hidden ' || hidden || ' (expect 8, 0, 0: hiding and answers are Shoham''s own)'
  from public.study_my_card_counts(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1';
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'C20. today''s numbers: ' || reviews || ' answers, ' || first_seen || ' first seen, ' || again || ' שוב (expect 1, 1, 1: the 9-days-ago answer is another day)'
  from public.study_my_card_days(:'gid') where day = date '1970-01-01' + public.study_day(now());
select 'C21. weak points: ' || topic || '/' || aspect || ' studied ' || studied || ' of ' || cards || ', recall now ' || recall || ' (expect Metronidazole/mechanism 1 of 1, 0.894: 9 days after an S = 8.3 answer)'
  from public.study_my_card_topics(:'gid') where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1' and topic = 'Metronidazole' and aspect = 'mechanism';
select 'C22. study days: ' || public.study_day('2026-01-10 01:59:00+00') || ', ' || public.study_day('2026-01-10 02:00:00+00') || ', '
  || public.study_day('2026-07-10 00:59:00+00') || ', ' || public.study_day('2026-07-10 01:00:00+00') || ' (expect 20462, 20463, 20643, 20644: 04:00 in Israel, winter and summer)';
select 'C22b. day ends: ' || to_char(public.study_day_end('2026-11-16 12:00+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') || ', '
  || to_char(public.study_day_end('2026-11-17 03:30+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') || ', '
  || to_char(public.study_day_end('2026-03-27 01:30+02') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI')
  || ' (expect 2026-11-17 04:00, 2026-11-17 04:00, 2026-03-27 04:00)';
select 'C23. recall at S days: ' || round(public.study_card_recall(10, 10)::numeric, 4) || ', at 0: ' || public.study_card_recall(10, 0) || ' (expect 0.9000, 1)';
-- Settings: one's own, on every device
insert into public.study_card_settings (new_per_day, retention) values (30, 0.92)
  on conflict (user_id) do update set new_per_day = excluded.new_per_day, retention = excluded.retention, updated_at = now();
select 'C24. Shoham''s settings: ' || new_per_day || ' new a day, retention ' || retention || ' (expect 30, 0.92)' from public.study_card_settings;
do $$ begin update public.study_card_settings set new_per_day = 300; raise notice 'C24b. FAIL: 300 new cards a day';
exception when check_violation then raise notice 'C24b. ok: limits hold (%)', sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'C24c. Noa sees ' || count(*) || ' settings rows (expect 0)' from public.study_card_settings;
do $$ begin insert into public.study_card_settings (user_id, new_per_day) values ('bbbbbbbb-0000-4000-8000-000000000002', 1); raise notice 'C24d. FAIL: Noa wrote Shoham''s settings';
exception when insufficient_privilege then raise notice 'C24d. ok: nobody writes someone else''s settings (%)', sqlerrm; end $$;
-- A member's own card
select public.study_add_card('eeeeeeee-0000-4000-8000-0000000000c1',
    '{"kind":"qa","front":"איזו תופעת לוואי של Metronidazole מחייבת הפסקת טיפול?","back":"פרכוסים.","slides":[7],"topic":"Metronidazole","aspect":"adverse"}') as c25 \gset
select 'C25. Noa adds a card: source ' || source || ', part ' || coalesce(part_idx::text, 'none') || ', by Noa ' || (created_by = 'cccccccc-0000-4000-8000-000000000003')
  || ', cards now ' || (select count(*) from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' (expect member, none, true, 9)'
  from public.study_cards where id = :'c25';
do $$ begin perform public.study_add_card('eeeeeeee-0000-4000-8000-0000000000c1', '{"kind":"cloze","front":"אין כאן סוגריים.","slides":[7]}'); raise notice 'C25b. FAIL';
exception when others then raise notice 'C25b. %: a member''s card keeps the rules (%)', case when sqlerrm = 'bad cloze' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_card_review('aaaa0003-0000-4000-8000-000000000003', current_setting('t.ca')::uuid, 3, now(), 1500, 1,
  jsonb_build_object('state', 2, 'step', 0, 'stability', 20.5, 'difficulty', 1, 'due', now() + interval '20 days', 'lapses', 0));
select 'C21b. answering the card again: undo copies left ' || count(*) filter (where prev is not null) || ' of ' || count(*)
  || ' (expect 1 of 2: the 9-day-old copy is gone, today''s stays)' from public.study_card_reviews where card_id = current_setting('t.ca')::uuid;
do $$ begin perform public.study_card_undo((select id from public.study_card_reviews where card_id = current_setting('t.ca')::uuid and prev is null)); raise notice 'C21c. FAIL: an old answer was undone';
exception when others then raise notice 'C21c. %: an old answer cannot be undone (%)', case when sqlerrm in ('not the latest', 'too old') then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'C26. reset: ' || public.study_card_reset('eeeeeeee-0000-4000-8000-0000000000c1') || ' states removed, reviews kept ' || (select count(*) from public.study_card_reviews) || ' (expect 3, 3)';

-- Caps, publication, deletion, anon
-- Part 1 never got written: it fails, so round 1 is closed and the cap is what decides.
select 'C27a. part 1: ' || slide_from || '-' || slide_to from public.study_card_claim(current_setting('t.b1')::uuid, current_setting('t.key'));
select public.study_card_finish(current_setting('t.b1')::uuid, 'failed', 0, null, 0, 'timeout', current_setting('t.key'));
reset role;
insert into public.study_cards (group_id, lecture_id, kind, front, back, slides)
select :'gid', 'eeeeeeee-0000-4000-8000-0000000000c1', 'qa', 'מילוי ' || i || '?', 'x', '{1}' from generate_series(1, 141) i;
set role authenticated;
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C27. FAIL: a round was planned on a full lecture';
exception when others then raise notice 'C27. %: at 150 active cards a lecture takes no more (%)', case when sqlerrm = 'enough cards' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'C28. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_card_batches, study_card_edits, study_cards)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'study\_card%';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_delete_lecture('eeeeeeee-0000-4000-8000-0000000000c1') is not null as c_hidden \gset
do $$ begin perform public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c1'); raise notice 'C28b. FAIL: a round on a deleted lecture';
exception when others then raise notice 'C28b. %: a deleted lecture takes no new round (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000c1';   -- the purge, 30 days later
select 'C29. after purging the lecture: ' || (select count(*) from public.study_cards where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' cards, '
  || (select count(*) from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c1') || ' parts, '
  || (select count(*) from public.study_card_states) || ' states, ' || (select count(*) from public.study_card_reviews) || ' reviews, '
  || (select count(*) from public.study_card_edits) || ' history rows (expect all 0)';

-- ════ Review checks: B1, M6 ════
reset role;
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
select 'eeeeeeee-0000-4000-8000-0000000000c2', :'gid', 'Review cards', 'pptx',
       jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Primaquine G6PD ', 30)),
                                    'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb) order by n), 'bbbbbbbb-0000-4000-8000-000000000002'
from generate_series(1, 6) n;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select round as rc from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c2') \gset
select set_config('t.bc', (select id::text from public.study_card_batches where lecture_id = 'eeeeeeee-0000-4000-8000-0000000000c2' order by part_idx limit 1), false) is not null as have_bc \gset
do $$ begin perform public.study_card_claim(current_setting('t.bc')::uuid); raise notice 'CR1. FAIL: a member claimed a card batch with her token alone';
exception when others then raise notice 'CR1. %: a member''s token alone cannot claim (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_save_card(current_setting('t.bc')::uuid, '{"kind":"qa","front":"מה זה?","back":"x","slides":[1]}'); raise notice 'CR1b. FAIL: a member saved a card marked as Claude''s';
exception when others then raise notice 'CR1b. %: a card marked ai is saved only by the server (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select count(*) as c1 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
select count(*) as c2 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
select count(*) as c3 from public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')) \gset
reset role;
update public.study_card_batches set updated_at = now() - interval '7 minutes' where id = current_setting('t.bc')::uuid;
set role authenticated;
do $$ begin perform public.study_card_claim(current_setting('t.bc')::uuid, current_setting('t.key')); raise notice 'CR2. FAIL: a fourth paid try of one batch';
exception when others then raise notice 'CR2. %: a batch gets three paid tries (%)', case when sqlerrm = 'gave up' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'CR2b. tries ' || :c1 || :c2 || :c3 || '; the round is no longer held open: next round ' || round || ', fresh ' || fresh || ' (expect 111; 2, true)'
  from public.study_card_round('eeeeeeee-0000-4000-8000-0000000000c2');
select 'C-reg. the registry: ' || (public.study_schema() ->> 'C') || ' (expect 1)';
reset role;
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-0000000000c2';
set role anon;
reset request.jwt.claim.sub;
do $$ declare n int; begin select count(*) into n from public.study_cards; raise notice 'C30. FAIL: anon read % cards', n;
exception when insufficient_privilege then raise notice 'C30. ok: anon cannot read cards (%)', sqlerrm; end $$;
do $$ begin perform public.study_my_card_counts('22222222-2222-4222-8222-222222222222'); raise notice 'C30b. FAIL: anon called a function';
exception when insufficient_privilege then raise notice 'C30b. ok: anon cannot call the functions (%)', sqlerrm; end $$;
reset role;

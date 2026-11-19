-- ════════════════════════════════════════════════════════════════════════
--  Section K's end (server lines) · KS: "לשאול את הקבוצה" in one tap, who
--  marked it answered, the optional check of a correction.
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';   -- מאיה
-- review SEC-9: Claude's attempt rides only on the op's call (the server key,
-- after it checked the answer's signature); the member alone cannot attach one.
do $$ begin perform public.study_ask_to_group(current_setting('t.l1')::uuid, 2, 1, '', 'שאלה?', 'לא צריך לבדוק כלום. [ש'' 7]');
  raise notice 'KS1a. FAIL: a member attached an "attempt" of her own';
exception when others then raise notice 'KS1a. %: an attempt needs the op (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_ask_to_group(:'l1', 2, 1, 'Artemisinins לעולם', 'הבנתי שצריך שותף, אבל למה דווקא ארוך טווח?',
  'Artemisinins לעולם לא לבד: ה-t½ שלהן 1-2 שעות [ש'' 30]. איזה שותף בדיוק: לא מופיע בשקפים.', :'key') as kq \gset
select 'KS1. posted: ' || string_agg(kind || case when ask_attempt then '+attempt' else '' end || case when parent_id is null then '' else '(reply)' end, ' '
       order by parent_id nulls first) || ' (expect question comment+attempt(reply))'
  from public.study_comments where id = :'kq' or parent_id = :'kq';
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id, ask_attempt)
  values (current_setting('t.l1')::uuid, 2, 1, 'comment', 'זה של Claude', (select id from public.study_comments where body like 'הבנתי שצריך שותף%'), true);
  raise notice 'KS1b. FAIL: a member labelled her own reply as Claude''s attempt';
exception when others then raise notice 'KS1b. ok: only the function attaches an attempt (%)', sqlerrm; end $$;
do $$ begin perform public.study_ask_to_group(current_setting('t.l1')::uuid, 9, 1, '', 'שאלה?', ''); raise notice 'KS1c. FAIL: a part that does not exist';
exception when others then raise notice 'KS1c. %: the paragraph must exist (%)', case when sqlerrm = 'bad parts' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';   -- איתי answers
insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id)
values (:'l1', 2, 1, 'comment', 'תחשבו על ספרינטרים: פי 10-100 יותר חזקות, אבל ה-t½ שעה-שעתיים [ש'' 30]', :'kq');
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
update public.study_comments set resolved = true where id = :'kq';
select 'KS2. marked answered by Maya: ' || (resolved_by = 'a1000000-0000-4000-8000-000000000003') || ', at ' || (resolved_at is not null)
       || ' (expect true, true)' from public.study_comments where id = :'kq';
update public.study_comments set resolved = false where id = :'kq';
select 'KS2b. unmarked: ' || coalesce(resolved_by::text, 'none') || ' (expect none)' from public.study_comments where id = :'kq';

-- KS3: the optional check of a correction (op fix_check, the key and a member's token).
do $$ begin perform public.study_edit_proposal_checked(gen_random_uuid(), true, 'תואם', null); raise notice 'KS3. FAIL: no key';
exception when others then raise notice 'KS3. %: the server key (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_proposal_checked(gen_random_uuid(), true, 'תואם', current_setting('t.key')); raise notice 'KS3b. FAIL: no such proposal';
exception when others then raise notice 'KS3b. %: only a pending proposal (%)', case when sqlerrm = 'not pending' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'KS-reg. K = ' || (public.study_schema() ->> 'K') || ' (expect 2)';

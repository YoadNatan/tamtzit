-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · SECTION J: the association wall
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
-- A photo of a paper sketch, already uploaded by the phone to the group's folder.
select gen_random_uuid() as photo_id \gset
select set_config('t.photo', :'gid' || '/wall/' || :'photo_id' || '.jpg', false) is not null as p \gset
insert into storage.objects (bucket_id, name, owner_id) values ('study', current_setting('t.photo'), '10000000-0000-4000-8000-0000000000a1');   -- Shoham's upload (review SEC-14)
set role authenticated;

-- ═════════ 1. Posting: by name or without one, always with "על מה זה?" ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.a1', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, 'Miltefosine טרטוגנית', 'line',
  'Miltefosine = מילואים: 28 יום בפנים, ואמצעי מניעה עוד 5 חודשים אחרי השחרור.', 'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]',
  array[16], 'Miltefosine', true)::text, false) is not null as a1 \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select set_config('t.a2', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, 'Miltefosine טרטוגנית', 'line',
  'Miltefosine היא אורחת שלא הולכת: המסיבה נגמרה ביום 28, והיא עוד על הספה.', 'ה-t½ שלה 7-31 ימים, ולכן 5 חודשים אחרי [ש׳ 16]',
  array[16], 'Miltefosine', false)::text, false) is not null as a2 \gset
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'line', 'בלי עובדה זה סתם בדיחה', '', array[16]);
  raise notice 'J1. FAIL: an entry without "על מה זה?"';
exception when others then raise notice 'J1. %: the fact line is required (%)', case when sqlerrm = 'bad fact' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'line', 'שורה טובה', 'עובדה טובה', array[99]);
  raise notice 'J1a. FAIL: a slide the lecture does not have';
exception when others then raise notice 'J1a. %: (%)', case when sqlerrm = 'unknown slide' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'sketch', 'שרבוט בלי תמונה', 'עובדה טובה', array[16]);
  raise notice 'J1b. FAIL: a sketch without its photo';
exception when others then raise notice 'J1b. %: (%)', case when sqlerrm = 'bad photo' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'sketch', 'שרבוט', 'עובדה טובה', array[16], '', true,
  null, null, null, current_setting('t.gid') || '/wall/00000000-0000-4000-8000-000000000000.jpg');
  raise notice 'J1c. FAIL: a photo that was never uploaded';
exception when others then raise notice 'J1c. %: (%)', case when sqlerrm = 'bad photo' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a9';
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'line', 'שורה של זר', 'עובדה של זר', array[16]);
  raise notice 'J1d. FAIL: an outsider posted';
exception when others then raise notice 'J1d. %: members only (%)', case when sqlerrm = 'lecture not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('J1e', 'outsider sees ' || (select count(*) from public.study_aids) || ' entries', 'outsider sees 0 entries');

-- Anonymous: no author on the shared row; only Daniel knows it is his.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select funtest.expect('J2', (select coalesce(named_by::text, 'none') from public.study_aids where id = current_setting('t.a2')::uuid), 'none');
select funtest.expect('J2a', (select string_agg(coalesce(author, 'בלי שם') || ' mine=' || mine, ', ' order by created_at)
                                from public.study_aid_wall(:'gid', 'f0000000-0000-4000-8000-000000000001')),
       'שוהם mine=false, בלי שם mine=false');
select funtest.expect('J2b', 'Noa sees ' || (select count(*) from public.study_aid_authors) || ' author rows', 'Noa sees 0 author rows');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select funtest.expect('J2c', (select mine::text from public.study_aid_wall(:'gid') where id = current_setting('t.a2')::uuid), 'true');

-- ═════════ 2. Votes: totals for all, who voted for nobody, never one's own ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
do $$ begin perform public.study_aid_vote(current_setting('t.a1')::uuid, 'funny', true); raise notice 'J3. FAIL: a vote on one''s own entry';
exception when others then raise notice 'J3. %: (%)', case when sqlerrm = 'own aid' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_aid_vote(current_setting('t.a1')::uuid, 'funny', true) is not null as v \gset
select public.study_aid_vote(current_setting('t.a1')::uuid, 'funny', true) is not null as v \gset
select public.study_aid_vote(current_setting('t.a1')::uuid, 'stuck', true) is not null as v \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select funtest.expect('J3a', public.study_aid_vote(current_setting('t.a1')::uuid, 'stuck', true)::text,
       jsonb_build_object('check', current_setting('t.a1'), 'funny', 1, 'stuck', 2)::text);
select funtest.expect('J3b', 'Maya sees ' || (select count(*) from public.study_aid_votes) || ' votes (her own)', 'Maya sees 1 votes (her own)');
select funtest.expect('J3c', (select funny_n || '/' || stuck_n || ' on cards ' || on_cards from public.study_aid_wall(:'gid') where id = current_setting('t.a1')::uuid),
       '1/2 on cards false');

-- ═════════ 3. The check against the paragraph (op wall_check), then the winner on the cards ═════════
do $$ begin perform public.study_aid_check_begin(current_setting('t.a1')::uuid, null); raise notice 'J4. FAIL: a check without the server key';
exception when others then raise notice 'J4. %: (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('J4a', (select b ->> 'fact' from public.study_aid_check_begin(current_setting('t.a1')::uuid, current_setting('t.key')) b),
       'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]');
do $$ begin perform public.study_aid_check_begin(current_setting('t.a1')::uuid, current_setting('t.key')); raise notice 'J4b. FAIL: two phones checked at once';
exception when others then raise notice 'J4b. %: (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('J4c', coalesce(public.study_aid_check_done(current_setting('t.a1')::uuid, true, '', current_setting('t.key'))::text, 'none'), 'none');
select funtest.expect('J4d', (select aid_id::text from public.study_aid_winners where lecture_id = 'f0000000-0000-4000-8000-000000000001' and part_idx = 1 and anchor = 4),
       current_setting('t.a1'));
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select funtest.expect('J4e', (select author || ' · pinned ' || pinned || ' · ' || body from public.study_aid_hint('f2000000-0000-4000-8000-000000000001')),
       'שוהם · pinned false · Miltefosine = מילואים: 28 יום בפנים, ואמצעי מניעה עוד 5 חודשים אחרי השחרור.');

-- "שלי": Itai pins Daniel's entry for himself; his hint and his Anki Extra follow it, Noa's do not.
select public.study_aid_pin(current_setting('t.a2')::uuid, true) is null as pin \gset
select funtest.expect('J5', (select coalesce(author, 'בלי שם') || ' · pinned ' || pinned from public.study_aid_hint('f2000000-0000-4000-8000-000000000001')),
       'בלי שם · pinned true');
select funtest.expect('J5a', (select string_agg(right(card_id::text, 1) || '=' || case when aid_id = current_setting('t.a2')::uuid then 'a2' else 'a1' end || ' pinned ' || pinned, ', ')
                                from public.study_aid_for_cards('f0000000-0000-4000-8000-000000000001')),
       '1=a2 pinned true');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select funtest.expect('J5b', (select string_agg(right(card_id::text, 1) || '=' || case when aid_id = current_setting('t.a2')::uuid then 'a2' else 'a1' end || ' pinned ' || pinned, ', ')
                                from public.study_aid_for_cards('f0000000-0000-4000-8000-000000000001')),
       '1=a1 pinned false');
select funtest.expect('J5c', 'Noa sees ' || (select count(*) from public.study_aid_pins) || ' pins', 'Noa sees 0 pins');

-- ═════════ 4. "לא מדויק" keeps it off the cards until the author fixes it ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select public.study_aid_flag(current_setting('t.a1')::uuid, 'inaccurate') is null as f \gset
select funtest.expect('J6', (select count(*)::text from public.study_aid_winners), '0');
select funtest.expect('J6a', (select flag || ' · ' || flagged_by from public.study_aid_wall(:'gid') where id = current_setting('t.a1')::uuid), 'inaccurate · מאיה');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
do $$ begin perform public.study_aid_flag(current_setting('t.a1')::uuid, null); raise notice 'J6b. FAIL: Itai cleared Maya''s mark';
exception when others then raise notice 'J6b. %: only the marker or the author (%)', case when sqlerrm = 'not yours' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin perform public.study_aid_edit(current_setting('t.a1')::uuid, 'שורה של נועה', 'עובדה', array[16]); raise notice 'J6c. FAIL: Noa edited Shoham''s entry';
exception when others then raise notice 'J6c. %: only the author (%)', case when sqlerrm = 'aid not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select funtest.expect('J6d', public.study_aid_edit(current_setting('t.a1')::uuid,
  'Miltefosine = מילואים: 28 יום בפנים, ואמצעי מניעה עוד 5 חודשים אחרי השחרור (Black Box).', 'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]', array[16])::text,
  current_setting('t.a1'));
select funtest.expect('J6e', (select coalesce(flag, 'no mark') || ' · check ' || x.check_state from public.study_aids x where x.id = current_setting('t.a1')::uuid),
       'no mark · check no');
-- A check that fails marks it, without a member's name, until the next fix.
select (public.study_aid_check_begin(current_setting('t.a1')::uuid, current_setting('t.key')) is not null) as cb \gset
select public.study_aid_check_done(current_setting('t.a1')::uuid, false, 'Black Box לא מופיע בפסקה', current_setting('t.key')) is null as cd \gset
select funtest.expect('J6f', (select flag || ' · ' || coalesce(flagged_by, 'הבדיקה') || ' · ' || check_note from public.study_aid_wall(:'gid') where id = current_setting('t.a1')::uuid),
       'inaccurate · הבדיקה · Black Box לא מופיע בפסקה');
do $$ begin perform public.study_aid_flag(current_setting('t.a1')::uuid, null); raise notice 'J6g. FAIL: a check''s mark cleared without a fix';
exception when others then raise notice 'J6g. %: (%)', case when sqlerrm = 'not yours' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_aid_edit(current_setting('t.a1')::uuid, 'Miltefosine = מילואים: 28 יום בפנים, ואמצעי מניעה עוד 5 חודשים אחרי השחרור.',
  'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]', array[16]) is not null as ed \gset
select (public.study_aid_check_begin(current_setting('t.a1')::uuid, current_setting('t.key')) is not null) as cb \gset
select public.study_aid_check_done(current_setting('t.a1')::uuid, true, '', current_setting('t.key')) is null as cd \gset
select funtest.expect('J6h', (select aid_id::text from public.study_aid_winners), current_setting('t.a1'));

-- "לא מתאים" (the house rule) hides it from everyone but its author.
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select public.study_aid_flag(current_setting('t.a2')::uuid, 'not_ok') is null as f \gset
select funtest.expect('J7', (select count(*)::text from public.study_aid_wall(:'gid') where id = current_setting('t.a2')::uuid), '0');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select funtest.expect('J7a', (select flag from public.study_aid_wall(:'gid') where id = current_setting('t.a2')::uuid), 'not_ok');
select public.study_aid_flag(current_setting('t.a2')::uuid, null) is null as f \gset

-- ═════════ 5. "לנעוץ רגע": the paragraph being read, the lecturer's picture, credit only with a yes ═════════
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select set_config('t.m1', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 0, 3, 'Metronidazole', 'moment',
  'Metronidazole היא האקסית: אסור לשתות לידה כל עוד היא בבית, ועוד 48 שעות אחרי שעזבה.', 'בלי אלכוהול בטיפול ו-48 שעות אחריו [ש׳ 7]',
  array[7], 'Metronidazole', true, null, null, null, null, 'fig:7-1', '10000000-0000-4000-8000-0000000000a4')::text, false) is not null as m1 \gset
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 0, 3, '', 'moment', 'רגע', 'עובדה', array[7], '', true,
  null, null, null, null, 'fig:9-1');
  raise notice 'J8. FAIL: a picture the slide does not have';
exception when others then raise notice 'J8. %: (%)', case when sqlerrm = 'bad figure' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select funtest.expect('J8a', (select coalesce(credit, 'no credit yet') || ' · ' || figure from public.study_aid_wall(:'gid') where id = current_setting('t.m1')::uuid),
       'no credit yet · fig:7-1');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin perform public.study_aid_credit_answer(current_setting('t.m1')::uuid, true); raise notice 'J8b. FAIL: Noa said yes for Itai';
exception when others then raise notice 'J8b. %: (%)', case when sqlerrm = 'credit not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select funtest.expect('J8c', (select asked_by || ' · ' || body from public.study_aid_credit_requests(:'gid')),
       'מאיה · Metronidazole היא האקסית: אסור לשתות לידה כל עוד היא בבית, ועוד 48 שעות אחרי שעזבה.');
select public.study_aid_credit_answer(current_setting('t.m1')::uuid, true) is null as ok \gset
select funtest.expect('J8d', (select credit from public.study_aid_wall(:'gid') where id = current_setting('t.m1')::uuid), 'איתי');

-- ═════════ 6. "תנו לי 3": saved once per paragraph text, posted only by a person ═════════
\set drafts '[{"technique":"משחק מילים","hook":"Miltefosine = מילואים: 28 יום בפנים, ואמצעי מניעה עוד 5 חודשים אחרי השחרור.","decode":"מילואים · 28 יום · 5 חודשים"},{"technique":"חרוז","hook":"Miltefosine בהיריון? אין דיון! וחמישה חודשים אחרי הסיום.","decode":"היריון · 5 חודשים"},{"technique":"סצנה הזויה","hook":"Miltefosine היא אורחת שלא הולכת: המסיבה נגמרה ביום 28, והיא עוד על הספה.","decode":"t½ ארוך · 28 יום"}]'
select set_config('t.drafts', :'drafts', false) is not null as d \gset
select set_config('t.hash', encode(sha256(convert_to('Miltefosine טרטוגנית (Black Box)', 'UTF8')), 'hex'), false) is not null as h \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin perform public.study_aid_drafts_save('f0000000-0000-4000-8000-000000000001', 1, 4, current_setting('t.hash'), 'אמצעי מניעה [ש׳ 16]', array[16],
  current_setting('t.drafts')::jsonb, 'claude-opus-5-5', null);
  raise notice 'J9. FAIL: drafts saved without the server key';
exception when others then raise notice 'J9. %: only the op saves drafts (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_aid_drafts_save('f0000000-0000-4000-8000-000000000001', 1, 4, current_setting('t.hash'), 'אמצעי מניעה [ש׳ 16]', array[16],
  jsonb_build_array(current_setting('t.drafts')::jsonb -> 0, current_setting('t.drafts')::jsonb -> 0), 'claude-opus-5-5', current_setting('t.key'));
  raise notice 'J9a. FAIL: two drafts of one technique saved';
exception when others then raise notice 'J9a. %: one draft per technique (%)', case when sqlerrm = 'bad drafts' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select set_config('t.d1', public.study_aid_drafts_save('f0000000-0000-4000-8000-000000000001', 1, 4, current_setting('t.hash'), 'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]',
  array[16], current_setting('t.drafts')::jsonb, 'claude-opus-5-5', current_setting('t.key'))::text, false) is not null as d1 \gset
select funtest.expect('J9b', public.study_aid_drafts_save('f0000000-0000-4000-8000-000000000001', 1, 4, current_setting('t.hash'), 'עובדה אחרת',
  array[16], current_setting('t.drafts')::jsonb, 'claude-opus-5-5', current_setting('t.key'))::text || ' · drafts rows ' || (select count(*) from public.study_aid_drafts),
  current_setting('t.d1') || ' · drafts rows 1');
do $$ begin perform public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'draft', 'טיוטה ששונתה בשקט', 'אמצעי מניעה [ש׳ 16]',
  array[16], 'Miltefosine', true, null, current_setting('t.d1')::uuid, 2);
  raise notice 'J9c. FAIL: a changed draft posted as Claude''s';
exception when others then raise notice 'J9c. %: "לפרסם כמו שהיא" posts the exact draft (%)', case when sqlerrm = 'bad draft' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select set_config('t.p2', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'draft',
  'Miltefosine בהיריון? אין דיון! וחמישה חודשים אחרי הסיום.', 'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]', array[16], 'Miltefosine', true,
  null, current_setting('t.d1')::uuid, 2)::text, false) is not null as p2 \gset
select funtest.expect('J9d', (select kind || ' #' || draft_no from public.study_aids where id = current_setting('t.p2')::uuid), 'draft #2');
select set_config('t.p1', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'remix',
  'Miltefosine = מילואים ארוכים: 28 יום בבסיס, ועוד 5 חודשים בלי ילדים.', 'אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש׳ 16]', array[16], 'Miltefosine', true,
  null, current_setting('t.d1')::uuid, 1)::text, false) is not null as p1 \gset
select funtest.expect('J9e', (select kind || ' of draft #' || draft_no from public.study_aids where id = current_setting('t.p1')::uuid), 'remix of draft #1');

-- ═════════ 7. The week's winner, the drug's wall across lectures, deleting ═════════
select funtest.expect('J10', public.study_aid_week(:'gid')::text, current_setting('t.a1'));
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select public.study_aid_post('f0000000-0000-4000-8000-000000000002', 0, 0, '', 'line', 'Miltefosine גם כאן, בהרצאה אחרת.', 'עובדה מההרצאה השנייה',
  array[3], 'miltefosine ', true) is not null as other \gset
select funtest.expect('J11', (select count(distinct lecture_id) || ' lectures, ' || count(*) || ' entries' from public.study_aid_wall(:'gid', null, 'Miltefosine')),
       '2 lectures, 5 entries');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select set_config('t.s1', public.study_aid_post('f0000000-0000-4000-8000-000000000001', 1, 4, '', 'sketch', 'Phlebotomus אוכל פלאפל בעולם הישן',
  'Old World: Phlebotomus [ש׳ 16]', array[16], 'Phlebotomus', true, null, null, null, current_setting('t.photo'))::text, false) is not null as s1 \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
do $$ begin perform public.study_aid_delete(current_setting('t.s1')::uuid); raise notice 'J12. FAIL: Noa deleted Shoham''s sketch';
exception when others then raise notice 'J12. %: (%)', case when sqlerrm = 'aid not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select funtest.expect('J12a', public.study_aid_delete(current_setting('t.s1')::uuid), current_setting('t.photo'));

-- ═════════ 8. What is published, and who may call what ═════════
reset role;
select funtest.expect('J13', (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
                                where pubname = 'supabase_realtime' and tablename like 'study_aid%'), 'study_aids');
select funtest.expect('J13a', (select string_agg(column_name, ',' order by column_name) from information_schema.columns
                                 where table_schema = 'public' and table_name = 'study_aids' and column_name in ('author_id', 'user_id', 'created_by')),
       null);
set role anon;
do $$ begin perform public.study_aid_wall(current_setting('t.gid')::uuid); raise notice 'J13b. FAIL: anon read the wall';
exception when insufficient_privilege then raise notice 'J13b. ok: anon cannot (%)', sqlerrm; end $$;
reset role;
-- "דרושה אסוציאציה": the card at least 3 members keep forgetting, on its paragraph, with no winner yet there.
select funtest.expect('J14', (select string_agg(c.part_idx || '.' || c.anchor || ' winner ' || (w.aid_id is not null), ', ')
                                from public.study_pulse_cards p join public.study_cards c on c.id = p.card_id
                                left join public.study_aid_winners w on w.lecture_id = c.lecture_id and w.part_idx = c.part_idx and w.anchor = c.anchor),
       '1.4 winner true');

-- ════════════════════════════════════════════════════════════════════════
--  SECTION M checks · the daily meeting (meeting addendum §4)
--  Same session, after 95-extensions-test.sql (its members, lectures,
--  questions and mtest helpers). Its own fixtures: yesterday's meeting on
--  L2 and an older one on L3, with what the group made in them.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
select set_config('t.gid', :'gid', false) is not null as g \gset
-- Yesterday: L2, part 0 read; Noa was there, Dana was not. Three days ago: L3.
insert into public.study_meetings (id, group_id, day, starts_at, lecture_id, part_from, part_to, started_at, read_part, reader_id, created_by)
values ('3c6a0000-0000-4000-8000-000000000001', :'gid', study_private.day_of(now()) - 1, now() - interval '1 day',
        '3c100000-0000-4000-8000-000000000002', 0, 0, now() - interval '1 day', 0, 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002'),
       ('3c6a0000-0000-4000-8000-000000000002', :'gid', study_private.day_of(now()) - 3, now() - interval '3 days',
        '3c100000-0000-4000-8000-000000000003', 0, 0, now() - interval '3 days', 0, 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_meeting_presence (meeting_id, user_id, first_at, last_at)
values ('3c6a0000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', now() - interval '1 day', now() - interval '23 hours');
insert into public.study_meeting_taps (meeting_id, user_id, lecture_id, part_idx, anchor, quote, created_at)
values ('3c6a0000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', '3c100000-0000-4000-8000-000000000002', 0, 1,
        'Miltefosine טרטוגנית', now() - interval '1 day' + interval '10 minutes');
insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, quote, created_by, created_at)
values ('3c6a0000-0000-4000-8000-000000000001', 'explain', 0, 1, 'Miltefosine טרטוגנית', 'bbbbbbbb-0000-4000-8000-000000000002', now() - interval '1 day' + interval '12 minutes');
-- Yesterday's threads: Itai's question on paragraph 1, answered by Daniel in the meeting; Maya's on
-- paragraph 2, still open and sent "לשאלה פתוחה למחר"; Daniel's memory aid shared in the meeting.
insert into public.study_comments (id, lecture_id, part_idx, anchor, quote, kind, body, resolved, author_id, created_at) values
 ('3c7a0000-0000-4000-8000-000000000001', '3c100000-0000-4000-8000-000000000002', 0, 1, 'Miltefosine', 'question', 'עד מתי אמצעי מניעה?', true,
  '3c000000-0000-4000-8000-000000000002', now() - interval '1 day' + interval '5 minutes'),
 ('3c7a0000-0000-4000-8000-000000000003', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'question', 'למה ECG?', false,
  '3c000000-0000-4000-8000-000000000001', now() - interval '1 day' + interval '20 minutes'),
 ('3c7a0000-0000-4000-8000-000000000004', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'comment', 'Pentostam: 5 כוכבים, עובדת ב-3', false,
  '3c000000-0000-4000-8000-000000000003', now() - interval '1 day' + interval '1 hour');
-- review F-13: the association pinned in the meeting is the wall's moment (section J), posted by name
insert into public.study_aids (id, group_id, lecture_id, part_idx, anchor, quote, kind, body, fact, slides, named_by, created_at)
values ('3c7b0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'moment',
        'Pentostam: 5 כוכבים, עובדת ב-3', 'Pentostam: חמש-ערכי, ECG לפני [ש'' 3]', '{3}', '3c000000-0000-4000-8000-000000000003',
        now() - interval '1 day' + interval '1 hour');
insert into public.study_aid_authors (aid_id, user_id) values ('3c7b0000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000003');
insert into public.study_comments (id, lecture_id, part_idx, anchor, kind, body, parent_id, author_id, created_at) values
 ('3c7a0000-0000-4000-8000-000000000002', '3c100000-0000-4000-8000-000000000002', 0, 1, 'comment', 'בטיפול ועוד 5 חודשים.',
  '3c7a0000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000003', now() - interval '1 day' + interval '30 minutes');
insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, quote, comment_id, created_by, created_at)
values ('3c6a0000-0000-4000-8000-000000000001', 'question', 0, 2, 'Pentostam', '3c7a0000-0000-4000-8000-000000000003',
        'bbbbbbbb-0000-4000-8000-000000000002', now() - interval '1 day' + interval '21 minutes');

-- ═════════ Planning today's meeting ═════════
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.m', id::text, false) is not null as m
  from public.study_meeting_save(null, null, :'gid', now(), '3c100000-0000-4000-8000-000000000001', 0, 1, '', 'bbbbbbbb-0000-4000-8000-000000000002') \gset
do $$
declare c record; n int := 0;
begin
  for c in select * from (values
      ('the same lecture twice a day', '3c100000-0000-4000-8000-000000000001'::uuid, 0, 1, now(), null::uuid, 'meeting exists'),
      ('parts that are not there', '3c100000-0000-4000-8000-000000000001'::uuid, 0, 5, now(), null::uuid, 'bad parts'),
      ('parts backwards', '3c100000-0000-4000-8000-000000000001'::uuid, 1, 0, now(), null::uuid, 'bad parts'),
      ('a lecture of no group', gen_random_uuid(), 0, 0, now(), null::uuid, 'lecture not found'),
      ('a reader who is not a member', '3c100000-0000-4000-8000-000000000003'::uuid, 0, 0, now(), 'dddddddd-0000-4000-8000-000000000004'::uuid, 'member not found'),
      ('a month ahead', '3c100000-0000-4000-8000-000000000003'::uuid, 0, 0, now() + interval '30 days', null::uuid, 'bad time')
    ) as t(label, lec, pf, pt, at, reader, want) loop
    begin
      perform public.study_meeting_save(null, null, current_setting('t.gid')::uuid, c.at, c.lec, c.pf, c.pt, '', c.reader);
      raise notice 'M1. FAIL: % was saved', c.label;
    exception when others then if sqlerrm = c.want then n := n + 1; else raise notice 'M1. FAIL: % → %', c.label, sqlerrm; end if; end;
  end loop;
  raise notice 'M1. ok: % of 6 bad meetings refused with their reason', n;
end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_meeting_save(null, null, current_setting('t.gid')::uuid, now(), '3c100000-0000-4000-8000-000000000003', 0, 0);
  raise notice 'M1b. FAIL: a stranger planned a meeting';
exception when others then raise notice 'M1b. %: members only (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'M1c. a stranger sees ' || count(*) || ' meetings (expect 0)' from public.study_meetings;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_meeting_save(current_setting('t.m')::uuid, 7, current_setting('t.gid')::uuid, now(),
    '3c100000-0000-4000-8000-000000000001', 0, 1, 'מלריה', null);
  raise notice 'M1d. FAIL: an old version saved';
exception when others then raise notice 'M1d. %: someone changed it meanwhile (%)', case when sqlerrm = 'conflict' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'M1e. today''s band: ' || (b ->> 'lecture_title') || ' · ' || (b ->> 'title') || ' · slides ' || (b ->> 'slide_from') || '-' || (b ->> 'slide_to')
       || ', reader is Shoham: ' || ((b ->> 'planned_reader') = 'bbbbbbbb-0000-4000-8000-000000000002') || ', today ' || (b ->> 'today') || ', over ' || (b ->> 'over')
       || ' (expect מלריה (פגישה) · מחזור החיים · מנגנונים · slides 1-24, true, true, false)'
  from jsonb_array_elements(public.study_meeting_band(:'gid')) b;

-- ═════════ Phase 2: the pre-guess, before the reading ═════════
select set_config('t.g', array_to_string(public.study_meeting_guess_pick(current_setting('t.m')::uuid), ','), false) is not null as g \gset
select 'M2. two guesses on the first part, distinct paragraphs, in reading order: ' ||
       (select string_agg(q.anchor::text, ',' order by q.anchor) from public.study_questions q where q.id = any (string_to_array(current_setting('t.g'), ',')::uuid[]))
       || '; a second pick keeps them: ' || (array_to_string(public.study_meeting_guess_pick(current_setting('t.m')::uuid), ',') = current_setting('t.g'))
       || ' (expect 1,2: the first paragraphs in reading order, no count of who answered, review SEC-5; true)';
select set_config('t.g1', split_part(current_setting('t.g'), ',', 1), false) is not null as g \gset
reset role;
select set_config('t.gk', (select answer::text from public.study_question_keys where question_id = current_setting('t.g1')::uuid), false) is not null as k \gset
set role authenticated;
select public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, (current_setting('t.gk')::int + 1) % 5) is null as a \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, (current_setting('t.gk')::int + 1) % 5) is null as a \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, (current_setting('t.gk')::int + 1) % 5) is null as a \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, current_setting('t.gk')::int) is null as a \gset
do $$ begin perform public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, 9);
  raise notice 'M2b. FAIL: option 9 of 5';
exception when others then raise notice 'M2b. %: a guess is one of the options (%)', case when sqlerrm = 'bad choice' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_meeting_guess(current_setting('t.m')::uuid, '3c2a0000-0000-4000-8000-000000000005', 0);
  raise notice 'M2c. FAIL: guessed a question that is not a guess';
exception when others then raise notice 'M2c. %: only the two guesses (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'M2d. Noa before the reading: released ' || (e ->> 'released') || ', key sent ' || (e ? 'answer') || ', her guess kept ' || ((e ->> 'mine')::int = (current_setting('t.gk')::int + 1) % 5)
       || ' (expect false, false, true)'
  from jsonb_array_elements(public.study_meeting_guess_state(current_setting('t.m')::uuid)) e where (e ->> 'n')::int = 1;
reset role;
select 'M2e. a guess never counts as an answer: Daniel''s rows for it in study_answers ' ||
       (select count(*) from public.study_answers where user_id = '3c000000-0000-4000-8000-000000000003' and question_id = current_setting('t.g1')::uuid)
       || ' (expect 0)';

-- ═════════ Reading aloud: the reader, the place, the glow ═════════
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.rm', public.study_meeting_reading('3c100000-0000-4000-8000-000000000001', true, 0, 0)::text, false) is not null as r \gset
select 'M3. Shoham reads aloud: the same meeting ' || (current_setting('t.rm') = current_setting('t.m')) || ', reading ' || reading
       || ', started ' || (started_at is not null) || ', reader Shoham ' || (reader_id = auth.uid()) || ' (expect true, true, true, true)'
  from public.study_meetings where id = current_setting('t.m')::uuid;
reset role;
update study_private.features set enabled = true where name = 'pulse';   -- decision 1's switch governs the warning (review F-14)
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M3b. the reader is warned before the first guess''s paragraph: guess ' || (v -> 'guess_warn' ->> 'guess') || ' at part '
       || (v -> 'guess_warn' ->> 'part') || ' paragraph ' || (v -> 'guess_warn' ->> 'anchor') || ' (expect 1 at part 0 paragraph 1: 3 of 4 guessed wrong)'
  from (select public.study_meeting_reader_view(current_setting('t.m')::uuid) as v) x;
reset role;
update study_private.features set enabled = false where name = 'pulse';
set role authenticated;
-- Noa and Itai follow the reading (review SEC-3, SEC-4: a reading counts as live with two followers)
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
do $$ begin perform public.study_meeting_place(current_setting('t.m')::uuid, 0, 5);
  raise notice 'M3c. FAIL: a follower moved the reader''s place';
exception when others then raise notice 'M3c. %: only the reader reports the place (%)', case when sqlerrm = 'not the reader' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_meeting_reader_view(current_setting('t.m')::uuid);
  raise notice 'M3d. FAIL: a follower read the reader''s screen';
exception when others then raise notice 'M3d. %: the counts are on the reader''s screen only (%)', case when sqlerrm = 'not the reader' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M4. the reading reaches paragraph 1: guesses released ' || public.study_meeting_place(current_setting('t.m')::uuid, 0, 1)
       || ' (expect 1: the second waits for paragraph 3)';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'M4b. "דינג!" on Noa''s phone: key ' || ((e ->> 'answer')::int = current_setting('t.gk')::int) || ', right ' || (e ->> 'correct')
       || ', like most of the group ' || (e -> 'majority' ->> 'with_most') || ', most right ' || (e -> 'majority' ->> 'most_right')
       || ', a count anywhere: ' || (e::text ~ '"(counts?|right|answered|guessers)"') || ' (expect true, false, true, false, false)'
  from jsonb_array_elements(public.study_meeting_guess_state(current_setting('t.m')::uuid)) e where (e ->> 'n')::int = 1;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
select 'M4c. Daniel''s: right ' || (e ->> 'correct') || ', with most ' || (e -> 'majority' ->> 'with_most') || ' (expect true, false)'
  from jsonb_array_elements(public.study_meeting_guess_state(current_setting('t.m')::uuid)) e where (e ->> 'n')::int = 1;
do $$ begin perform public.study_meeting_guess(current_setting('t.m')::uuid, current_setting('t.g1')::uuid, 0);
  raise notice 'M4d. FAIL: a guess after its paragraph was read';
exception when others then raise notice 'M4d. %: too late once it lit up (%)', case when sqlerrm = 'released' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ "לא ברור לי", and the reader's count from 3 ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'ה-Hypnozoite ישן') as t \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'ה-Hypnozoite ישן') as t \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M5. two taps: the reader sees ' || jsonb_array_length(public.study_meeting_reader_view(current_setting('t.m')::uuid) -> 'taps') || ' callouts (expect 0: from 3)';
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'ה-Hypnozoite ישן') as t \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'ה-Hypnozoite ישן') as t \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M5b. three members (Noa twice): ' || (public.study_meeting_reader_view(current_setting('t.m')::uuid) -> 'taps')::text
       || ' (expect one callout: part 0, paragraph 2, n 3, no names and no text, review SEC-11)';
select 'M5c. Shoham sees ' || count(*) || ' tap rows of others (expect 0)' from public.study_meeting_taps;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'M5d. Noa sees her own tap today only: ' || count(*) || ' (expect 1)' from public.study_meeting_taps where meeting_id = current_setting('t.m')::uuid;
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, '', false) as t \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M5e. Noa took hers back: callouts ' || jsonb_array_length(public.study_meeting_reader_view(current_setting('t.m')::uuid) -> 'taps') || ' (expect 0)';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2, 'ה-Hypnozoite ישן') as t \gset
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 2);
  raise notice 'M5f. FAIL: a stranger tapped';
exception when others then raise notice 'M5f. %: members only (%)', case when sqlerrm = 'meeting not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_meeting_unclear(current_setting('t.m')::uuid, 7, 2);
  raise notice 'M5g. FAIL: a tap on a part that is not there';
exception when others then raise notice 'M5g. %: (%)', case when sqlerrm = 'bad parts' then 'ok' else 'FAIL' end, sqlerrm; end $$;
-- The reader's three answers.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_meeting_stop(current_setting('t.m')::uuid, 'explain', 0, 2, 'ה-Hypnozoite ישן') is null as s \gset
select 'M6. "לעצור ולהסביר": callouts left ' || jsonb_array_length(public.study_meeting_reader_view(current_setting('t.m')::uuid) -> 'taps') || ' (expect 0)';
do $$ begin perform public.study_meeting_stop(current_setting('t.m')::uuid, 'pause', 0, 2);
  raise notice 'M6b. FAIL: an unknown answer';
exception when others then raise notice 'M6b. %: (%)', case when sqlerrm = 'bad kind' then 'ok' else 'FAIL' end, sqlerrm; end $$;
insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body)
values ('3c100000-0000-4000-8000-000000000001', 0, 3, 'לפני Primaquine', 'question', 'לא ברור בהקראה: למה G6PD?');
select public.study_meeting_stop(current_setting('t.m')::uuid, 'question', 0, 3, 'לפני Primaquine',
  (select id from public.study_comments where body = 'לא ברור בהקראה: למה G6PD?')) is null as s \gset
do $$ begin perform public.study_meeting_stop(current_setting('t.m')::uuid, 'question', 1, 1, '', gen_random_uuid());
  raise notice 'M6c. FAIL: an open question that is not on the paragraph';
exception when others then raise notice 'M6c. %: (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'M6d. the group sees what the reader did: ' || string_agg(kind || ' ' || part_idx || '.' || anchor, ', ' order by kind) || ' (expect explain 0.2, question 0.3)'
  from public.study_meeting_events where meeting_id = current_setting('t.m')::uuid;
do $$ begin perform public.study_meeting_stop(current_setting('t.m')::uuid, 'continue', 0, 2);
  raise notice 'M6e. FAIL: a follower answered for the reader';
exception when others then raise notice 'M6e. %: (%)', case when sqlerrm = 'not the reader' then 'ok' else 'FAIL' end, sqlerrm; end $$;

-- ═════════ A correction approved aloud (section K's end, with the meeting) ═════════
select set_config('t.pa', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 2,
  'Mefloquine ניתנת פעם בשבוע. [ש'' 20]', 'Mefloquine ניתנת פעם בשבוע, למניעה ולטיפול. [ש'' 20]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1), 0, 1, '', 'slide', array[20], null, '')::text, false) is not null as p \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
do $$ begin perform public.study_approve_edit(current_setting('t.pa')::uuid, true);
  raise notice 'M7. FAIL: a follower approved aloud';
exception when others then raise notice 'M7. %: aloud is the reader''s (%)', case when sqlerrm = 'not live' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.ea', public.study_approve_edit(current_setting('t.pa')::uuid, true) ->> 'edit_id', false) is not null as a \gset
select 'M7b. approved aloud by the reader: aloud ' || aloud || ', approver Shoham ' || (approved_by = 'bbbbbbbb-0000-4000-8000-000000000002')
       || ', author Noa ' || (author_id = 'cccccccc-0000-4000-8000-000000000003') || ' (expect true, true, true)'
  from public.study_edits where id = current_setting('t.ea')::uuid;
select set_config('t.pb', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 2, 1,
  'Artemisinins לעולם לא לבד. [ש'' 30]', 'Artemisinins לעולם לא לבד: t½ של 1-2 שעות. [ש'' 30]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 2), 0, 1, '', 'slide', array[30], null, '')::text, false) is not null as p \gset
do $$ begin perform public.study_approve_edit(current_setting('t.pb')::uuid, true);
  raise notice 'M7c. FAIL: the reader approved her own proposal aloud';
exception when others then raise notice 'M7c. %: the reader''s own proposal needs another member, aloud too (%)',
  case when sqlerrm = 'own proposal' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_withdraw_edit(current_setting('t.pb')::uuid) is null as w \gset
-- Put both back (one tap each), so later checks see the parts as written.
select public.study_edit_block('3c100000-0000-4000-8000-000000000001', 1, 2, 'Mefloquine ניתנת פעם בשבוע, למניעה ולטיפול. [ש'' 20]',
  'Mefloquine ניתנת פעם בשבוע. [ש'' 20]', (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1),
  0, 1, '', current_setting('t.ea')::uuid) is not null as u \gset

-- ═════════ The opening ("3 לקפה") and the closing quiz ═════════
-- Decision 7's cap is one opening and one closing a study day for the group
-- (review F-15): the earlier checks' quizzes of these presets move to yesterday.
reset role;
update public.study_quizzes set created_at = created_at - interval '1 day'
 where group_id = :'gid' and preset in ('coffee', 'end');
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.cq', public.study_meeting_quiz(current_setting('t.m')::uuid, 'coffee')::text, false) is not null as c \gset
select 'M8. the opening: ' || preset || ', ' || title || ', ' || mode || ', ' || n_wanted || ' questions, ' || seconds || ' s'
       || ' (expect coffee, 3 לקפה, coop, 3 questions, 45 s)' from public.study_quizzes where id = current_setting('t.cq')::uuid;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_join(current_setting('t.cq')::uuid) is null as j \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_quiz_join(current_setting('t.cq')::uuid) is null as j \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.cq')::uuid, -1) is null as n \gset
reset role;
select 'M8b. two on yesterday''s parts, one older, none from today''s parts: ' ||
       string_agg(case when q.lecture_id = '3c100000-0000-4000-8000-000000000002' and q.part_idx = 0 then 'yesterday'
                       when q.lecture_id = '3c100000-0000-4000-8000-000000000001' and q.part_idx <= 1 then 'TODAY'
                       else 'older' end, ',' order by r.idx)
       || '; a teaser first among yesterday''s: ' || bool_or(q.teaser <> '' and q.lecture_id = '3c100000-0000-4000-8000-000000000002')
       || ' (expect yesterday,yesterday,older; true)'
  from public.study_quiz_rounds r join public.study_questions q on q.id = r.question_id where r.quiz_id = current_setting('t.cq')::uuid;
select set_config('t.ck', mtest.key_now(current_setting('t.cq')::uuid)::text, false) is not null as k \gset
select mtest.shift(current_setting('t.cq')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.cq')::uuid, 0, current_setting('t.ck')::int, 2) \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select bet is not null as a from public.study_quiz_answer(current_setting('t.cq')::uuid, 0, current_setting('t.ck')::int, 2) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select bet is not null as a from public.study_quiz_answer(current_setting('t.cq')::uuid, 0, (current_setting('t.ck')::int + 1) % 5, 3) \gset
select 'M8c. the opening''s reveal (2 of 3 right): stage ' || (s -> 'quiz' ->> 'stage') || ', "' || (s -> 'round' ->> 'majority') || '"'
       || ', counts sent ' || ((s -> 'round') ? 'counts') || ', numbers sent ' || ((s -> 'round') ? 'right') || ', key ' || ((s -> 'round') ? 'answer')
       || ' (expect final, "most_right" (רובכם צדקו), false, false, true)'
  from (select public.study_quiz_state(current_setting('t.cq')::uuid) as s) x;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform public.study_meeting_quiz(current_setting('t.m')::uuid, 'end');
  raise notice 'M8d. FAIL: a second quiz while the opening is open';
exception when others then raise notice 'M8d. %: one live quiz at a time (%)', case when sqlerrm = 'quiz open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_quiz_end(current_setting('t.cq')::uuid) is null as e \gset
do $$ begin perform public.study_meeting_quiz(current_setting('t.m')::uuid, 'coffee');
  raise notice 'M8e. FAIL: a second opening in one meeting';
exception when others then raise notice 'M8e. %: one opening a meeting, decision 7 (%)', case when sqlerrm = 'already' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_meeting_place(current_setting('t.m')::uuid, 1, 1) is not null as p \gset
select set_config('t.eq', public.study_meeting_quiz(current_setting('t.m')::uuid, 'end')::text, false) is not null as c \gset
select 'M9. the closing quiz on what was read: ' || preset || ', parts ' || part_from || '-' || part_to || ', ' || n_wanted || ' questions, ' || mode
       || ' (expect end, 0-1, 5 questions, coop)' from public.study_quizzes where id = current_setting('t.eq')::uuid;
select public.study_quiz_end(current_setting('t.eq')::uuid) is null as e \gset
select set_config('t.sq', public.study_meeting_quiz(current_setting('t.m')::uuid, 'stop', 'coop', null, 0)::text, false) is not null as c \gset
select 'M9b. a stop at a chapter''s end: ' || preset || ', parts ' || part_from || '-' || part_to || ', ' || n_wanted || ' question'
       || ' (expect stop, 0-0, 1 question)' from public.study_quizzes where id = current_setting('t.sq')::uuid;
select public.study_quiz_end(current_setting('t.sq')::uuid) is null as e \gset

-- ═════════ The agenda ═════════
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
select 'M10. the agenda: ' || (a -> 'reading' ->> 'lecture_title') || ' · slides ' || (a -> 'reading' ->> 'slide_from') || '-' || (a -> 'reading' ->> 'slide_to')
       || ' · הקראה: ' || (a -> 'reading' ->> 'reader') || '; hot spot ' || coalesce(a ->> 'hot_spot', 'none')
       || '; open question "' || (a -> 'open_question' ->> 'body') || '", sent from a meeting ' || (a -> 'open_question' ->> 'from_meeting')
       || ' (expect מלריה (פגישה) · slides 1-24 · הקראה: שוהם; none (the pulse''s); "למה ECG?", true)'
  from (select public.study_meeting_agenda(current_setting('t.m')::uuid) as a) x;

-- ═════════ What comes back later (M7) and catching up (T3) ═════════
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'M11. Noa''s "לא ברור" from yesterday: ' || count(*) || ' row, explained in the meeting ' || bool_and(explained) || ', thread ' || max(thread)
       || '; today''s tap waits for tomorrow' || ' (expect 1 row, true, answered)'
  from public.study_my_unclear(:'gid');
select public.study_unclear_done((select tap_id from public.study_my_unclear(:'gid') limit 1)) is null as d \gset
select 'M11b. seen again: ' || count(*) || ' left (expect 0)' from public.study_my_unclear(:'gid');
select 'M12. Noa was at yesterday''s meeting: missed ' || count(*) || ' (expect 0)' from public.study_my_missed(:'gid') where meeting_id = '3c6a0000-0000-4000-8000-000000000001';
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';
select 'M12b. Dana missed it: ' || count(*) || ' (expect 1)' from public.study_my_missed(:'gid') where meeting_id = '3c6a0000-0000-4000-8000-000000000001';
select 'M12c. the catch-up: stops ' || jsonb_array_length(c -> 'stops') || ', answered ' || jsonb_array_length(c -> 'resolved')
       || ' (by ' || (c -> 'resolved' -> 0 ->> 'answer_by') || '), memory aids ' || jsonb_array_length(c -> 'pins')
       || ', questions ' || jsonb_array_length(c -> 'questions') || ' (the stopped paragraph''s first: '
       || ((c -> 'questions' ->> 0) = '3c2b0000-0000-4000-8000-000000000001') || '), ' || (c ->> 'minutes') || ' min, read by ' || jsonb_array_length(c -> 'readers')
       || ' (expect stops 1, answered 1 (by דניאל), memory aids 1, questions 3 (true), 10 min, read by 0)'
  from (select public.study_meeting_catchup('3c6a0000-0000-4000-8000-000000000001') as c) x;
do $$ begin perform public.study_meeting_catchup(current_setting('t.m')::uuid);
  raise notice 'M12d. FAIL: a catch-up of a meeting still on';
exception when others then raise notice 'M12d. %: (%)', case when sqlerrm = 'not over' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_meeting_catchup_done('3c6a0000-0000-4000-8000-000000000001') is null as d \gset
select 'M12e. finished: in "קראו" at once ' || (select count(*) from public.study_reads where lecture_id = '3c100000-0000-4000-8000-000000000002' and user_id = auth.uid())
       || ', still offered ' || (select count(*) from public.study_my_missed(:'gid') where meeting_id = '3c6a0000-0000-4000-8000-000000000001')
       || ' (expect 0: the mark is written the next study day, review SEC-12; 0)';
reset role;
update public.study_meeting_catchups set done_at = done_at - interval '1 day'
 where meeting_id = '3c6a0000-0000-4000-8000-000000000001' and user_id = 'abababab-0000-4000-8000-000000000007';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_band(:'gid') is not null as b \gset
select 'M12f. the next study day: Dana in "קראו" ' || count(*) || ', at the meeting''s time ' || bool_and(r.read_at = m.started_at)
       || ' (expect 1, true: review SEC-12)'
  from public.study_reads r join public.study_meetings m on m.id = '3c6a0000-0000-4000-8000-000000000001'
 where r.lecture_id = '3c100000-0000-4000-8000-000000000002' and r.user_id = 'abababab-0000-4000-8000-000000000007';
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';

-- ═════════ Stopping, attendance, cancelling, privacy ═════════
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_meeting_reading('3c100000-0000-4000-8000-000000000001', false) is not null as r \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000004';
do $$ begin perform public.study_meeting_unclear(current_setting('t.m')::uuid, 0, 3);
  raise notice 'M13. FAIL: a tap with nobody reading';
exception when others then raise notice 'M13. %: (%)', case when sqlerrm = 'not live' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M13b. Shoham sees ' || count(*) || ' presence rows of others (expect 0: attendance is private)'
  from public.study_meeting_presence where user_id <> auth.uid();
select set_config('t.m2', id::text, false) is not null as m
  from public.study_meeting_save(null, null, :'gid', now() + interval '1 day', '3c100000-0000-4000-8000-000000000003', 0, 0, 'אמבות', null) \gset
select public.study_meeting_cancel(current_setting('t.m2')::uuid) is null as c \gset
do $$ begin perform public.study_meeting_cancel(current_setting('t.m')::uuid);
  raise notice 'M13c. FAIL: a meeting that started was cancelled';
exception when others then raise notice 'M13c. %: (%)', case when sqlerrm = 'meeting started' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform count(*) from public.study_meeting_live;
  raise notice 'M13d. FAIL: the reader''s place is readable';
exception when insufficient_privilege then raise notice 'M13d. ok: the reader''s place is not readable (%)', sqlerrm; end $$;
reset role;
select 'M14. published: ' || string_agg(tablename, ', ' order by tablename) || ' (expect study_meetings only)'
  from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'study\_meeting%';
select 'M14b. the cancelled meeting is out of the band: ' ||
       (select count(*) from public.study_meetings where id = current_setting('t.m2')::uuid and cancelled_at is not null) || ' cancelled (expect 1)';
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_meeting_band(gen_random_uuid()); raise notice 'M14c. FAIL: anon read a band';
exception when insufficient_privilege then raise notice 'M14c. ok: anon cannot call the meeting''s functions (%)', sqlerrm; end $$;
reset role;
select 'M-reg. the registry: ' || (public.study_schema() ->> 'M') || ' (expect 1)';

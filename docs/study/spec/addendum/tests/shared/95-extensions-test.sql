-- ════════════════════════════════════════════════════════════════════════
--  SECTION Q's end checks · and sections C's, K's and Z's ends (the meeting
--  addendum, design.md §3). Runs in the same psql session after the repo's
--  study.sql and every section's checks (their users and group). Its own
--  fixtures: four more members and three lectures with written parts,
--  placed questions and cards. Time is simulated by moving times into the
--  past as the owner, never by sleeping. Throwaway local Postgres only.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset
select set_config('t.gid', :'gid', false) is not null as g \gset
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as k \gset
update public.study_quizzes set state = 'ended', ended_at = now() where state in ('lobby', 'question', 'reveal');

-- ── Fixtures ──
-- Members: שוהם (b…2), נועה כהן (c…3), יעל (f…6), דנה (ab…7) from the
-- earlier checks, and מאיה, איתי, דניאל, רוני. A stranger: d…4.
insert into auth.users (id, raw_user_meta_data) values
 ('3c000000-0000-4000-8000-000000000001', '{"app":"study","full_name":"מאיה"}'),
 ('3c000000-0000-4000-8000-000000000002', '{"app":"study","full_name":"איתי"}'),
 ('3c000000-0000-4000-8000-000000000003', '{"app":"study","full_name":"דניאל"}'),
 ('3c000000-0000-4000-8000-000000000004', '{"app":"study","full_name":"רוני"}');
insert into public.study_members (group_id, user_id, name) values
 (:'gid', '3c000000-0000-4000-8000-000000000001', 'מאיה'),
 (:'gid', '3c000000-0000-4000-8000-000000000002', 'איתי'),
 (:'gid', '3c000000-0000-4000-8000-000000000003', 'דניאל'),
 (:'gid', '3c000000-0000-4000-8000-000000000004', 'רוני');
-- L1 today's lecture (40 slides, three parts), L2 yesterday's, L3 an older one.
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by) values
 ('3c100000-0000-4000-8000-000000000001', :'gid', 'פתוגן מאכסן', 'מלריה (פגישה)', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 40) n), 'bbbbbbbb-0000-4000-8000-000000000002'),
 ('3c100000-0000-4000-8000-000000000002', :'gid', 'פתוגן מאכסן', 'לישמניה (פגישה)', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 20) n), 'bbbbbbbb-0000-4000-8000-000000000002'),
 ('3c100000-0000-4000-8000-000000000003', :'gid', 'פתוגן מאכסן', 'אמבות (פגישה)', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 10) n), 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
 ('3c100000-0000-4000-8000-000000000001', 0, 'מחזור החיים', 1, 12, 'ready',
  E'## מחזור החיים\n\nאף תרופה לא הורגת את ה-Sporozoite. [ש'' 3]\n\nה-Hypnozoite ישן בכבד. [ש'' 5]\n\nלפני Primaquine בודקים G6PD. [ש'' 7]'),
 ('3c100000-0000-4000-8000-000000000001', 1, 'מנגנונים', 13, 24, 'ready',
  E'## מנגנונים\n\nChloroquine מצטברת בוואקואולה. [ש'' 15]\n\nMefloquine ניתנת פעם בשבוע. [ש'' 20]'),
 ('3c100000-0000-4000-8000-000000000001', 2, 'שילובים', 25, 40, 'ready',
  E'## שילובים\n\nArtemisinins לעולם לא לבד. [ש'' 30]\n\nQuinine עם Doxycycline, לא בהיריון. [ש'' 33]'),
 ('3c100000-0000-4000-8000-000000000002', 0, 'טיפול', 1, 10, 'ready', E'## טיפול\n\nMiltefosine טרטוגנית. [ש'' 6]\n\nPentostam דורשת ECG. [ש'' 8]'),
 ('3c100000-0000-4000-8000-000000000002', 1, 'מנגנון', 11, 20, 'ready', E'## מנגנון\n\nSb(V) הופך ל-Sb(III). [ש'' 15]'),
 ('3c100000-0000-4000-8000-000000000003', 0, 'אמבות', 1, 10, 'ready', E'## אמבות\n\nMetronidazole ובירה. [ש'' 7]');
-- Questions placed on paragraphs (key = the option index given).
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, anchor, quote, part_gen, kind, question, options, slides, topic, aspect, teaser)
values
 ('3c2a0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 0, 1, 'אף תרופה לא הורגת', 0, 'mcq', 'איזה שלב אף תרופה לא הורגת?', array['Sporozoite','Hypnozoite','Schizont','Gametocyte','Merozoite'], array[3], 'Sporozoite', 'lifecycle', 'ה-Sporozoite נכנס בלי כרטיס'),
 ('3c2a0000-0000-4000-8000-000000000002', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 0, 2, 'ה-Hypnozoite ישן', 0, 'mcq', 'מה גורם להישנות ב-vivax?', array['א','ב','ג','ד','ה'], array[5], 'Primaquine', 'lifecycle', ''),
 ('3c2a0000-0000-4000-8000-000000000003', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 0, 2, 'ה-Hypnozoite ישן', 0, 'mcq', 'מה מסלק hypnozoites?', array['א','ב','ג','ד','ה'], array[5], 'Primaquine', 'uses', ''),
 ('3c2a0000-0000-4000-8000-000000000004', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 0, 3, 'לפני Primaquine', 0, 'mcq', 'מה בודקים לפני Primaquine?', array['א','ב','ג','ד','ה'], array[7], 'Primaquine', 'contra', ''),
 ('3c2a0000-0000-4000-8000-000000000005', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 1, 1, 'Chloroquine מצטברת', 0, 'mcq', 'איפה מצטברת Chloroquine?', array['א','ב','ג','ד','ה'], array[15], 'Chloroquine', 'mechanism', ''),
 ('3c2a0000-0000-4000-8000-000000000006', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 1, 2, 'Mefloquine ניתנת', 0, 'mcq', 'כל כמה זמן Mefloquine?', array['א','ב','ג','ד','ה'], array[20], 'Mefloquine', 'dosing', ''),
 ('3c2a0000-0000-4000-8000-000000000007', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 2, 1, 'Artemisinins לעולם', 0, 'mcq', 'למה Artemisinins לא לבד?', array['א','ב','ג','ד','ה'], array[30], 'Artemisinin', 'uses', ''),
 ('3c2a0000-0000-4000-8000-000000000008', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 2, 2, 'Quinine עם Doxycycline', 0, 'mcq', 'מה מצרפים ל-Quinine בהיריון?', array['א','ב','ג','ד','ה'], array[33], 'Quinine', 'contra', ''),
 ('3c2b0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000002', 'ai', 0, 1, 'Miltefosine טרטוגנית', 0, 'mcq', 'מה Miltefosine מחייבת?', array['א','ב','ג','ד','ה'], array[6], 'Miltefosine', 'contra', 'Miltefosine סיימה קורס, אבל עוד לא עזבה'),
 ('3c2b0000-0000-4000-8000-000000000002', :'gid', '3c100000-0000-4000-8000-000000000002', 'ai', 0, 2, 'Pentostam דורשת', 0, 'mcq', 'למה Pentostam דורשת ECG?', array['א','ב','ג','ד','ה'], array[8], 'Pentostam', 'adverse', ''),
 ('3c2b0000-0000-4000-8000-000000000003', :'gid', '3c100000-0000-4000-8000-000000000002', 'ai', 0, 2, 'Pentostam דורשת', 0, 'mcq', 'מה מנטרים ב-Pentostam?', array['א','ב','ג','ד','ה'], array[8], 'Pentostam', 'adverse', ''),
 ('3c2b0000-0000-4000-8000-000000000004', :'gid', '3c100000-0000-4000-8000-000000000002', 'ai', 1, 1, 'Sb(V) הופך', 0, 'mcq', 'איך Pentostam מופעלת?', array['א','ב','ג','ד','ה'], array[15], 'Pentostam', 'mechanism', ''),
 ('3c2c0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000003', 'ai', 0, 1, 'Metronidazole ובירה', 0, 'mcq', 'מה קורה עם Metronidazole ובירה?', array['א','ב','ג','ד','ה'], array[7], 'Metronidazole', 'interactions', 'Metronidazole נתפסה עם בירה');
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select q.id, (case right(q.id::text, 1) when '1' then 0 when '2' then 1 when '3' then 2 when '4' then 3 when '5' then 0 when '6' then 1 when '7' then 2 else 3 end)::smallint,
       array['הסבר א [ש'' 3]', 'הסבר ב: לא כאן [ש'' 5]', 'הסבר ג [ש'' 7]', 'הסבר ד', 'הסבר ה'], 'מה לזכור'
  from public.study_questions q where q.id::text like '3c2%';
insert into public.study_cards (id, group_id, lecture_id, source, part_idx, anchor, quote, part_gen, kind, front, back, slides) values
 ('3c3a0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 0, 2, 'ה-Hypnozoite ישן', 0, 'qa', 'למה צריך גם Primaquine ב-vivax?', 'בגלל hypnozoites', array[5]),
 ('3c3a0000-0000-4000-8000-000000000002', :'gid', '3c100000-0000-4000-8000-000000000001', 'ai', 1, 1, 'Chloroquine מצטברת', 0, 'qa', 'איפה Chloroquine פועלת?', 'בוואקואולה', array[15]);

-- Test helpers (the owner calls them; no member can).
create schema if not exists mtest;
create or replace function mtest.shift(p_quiz uuid, p_secs numeric) returns void language sql as $$
  update public.study_quiz_rounds set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                      closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where quiz_id = p_quiz and opens_at is not null and revealed_at is null;
  update public.study_quizzes set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                  closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where id = p_quiz;
$$;
create or replace function mtest.key_now(p_quiz uuid) returns int language sql as $$
  select k.answer::int from public.study_quizzes z
    join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
    join public.study_question_keys k on k.question_id = r.question_id where z.id = p_quiz $$;
create or replace function mtest.q_now(p_quiz uuid) returns uuid language sql as $$
  select r.question_id from public.study_quizzes z join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx
   where z.id = p_quiz $$;
revoke all on schema mtest from public;
grant usage on schema mtest to authenticated, anon;

-- ═════════ Section Q's end: the paragraph, the teaser, the bet, "עדיין נכון" ═════════
insert into public.study_question_batches (id, lecture_id, round, part_idx, heading, slide_from, slide_to, wanted, status)
values ('3c4a0000-0000-4000-8000-000000000001', '3c100000-0000-4000-8000-000000000001', 1, 0, 'מחזור החיים', 1, 12, 5, 'writing');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.qa1', public.study_save_question('3c4a0000-0000-4000-8000-000000000001', null,
  jsonb_build_object('kind', 'mcq', 'question', 'שאלה חדשה על hypnozoites?', 'options', jsonb_build_array('a','b','c','d','e'),
                     'answer', 1, 'explanations', jsonb_build_array('1','2','3','4','5'), 'slides', jsonb_build_array(5),
                     'para', 2, 'quote', 'ה-Hypnozoite ישן בכבד', 'teaser', repeat('ט', 130)), :'key')::text, false) is not null as q \gset
select 'QA1. saved on its paragraph: anchor ' || anchor || ', quote "' || quote || '", part gen ' || part_gen || ', teaser cut to ' || char_length(teaser)
       || ' (expect 2, "ה-Hypnozoite ישן בכבד", 0, 120)'
  from public.study_questions where id = current_setting('t.qa1')::uuid;
select set_config('t.qa2', public.study_save_question('3c4a0000-0000-4000-8000-000000000001', null,
  jsonb_build_object('kind', 'mcq', 'question', 'שאלה בלי פסקה?', 'options', jsonb_build_array('a','b','c','d','e'),
                     'answer', 0, 'explanations', jsonb_build_array('1','2','3','4','5'), 'slides', jsonb_build_array(5),
                     'para', '2'), :'key')::text, false) is not null as q \gset
select 'QA2. a paragraph number sent as text is not placed: anchor ' || coalesce(anchor::text, 'null') || ', quote "' || quote || '", teaser "' || teaser || '"'
       || ' (expect null, "", "")'
  from public.study_questions where id = current_setting('t.qa2')::uuid;
do $$ begin perform public.study_save_question('3c4a0000-0000-4000-8000-000000000001', null,
  '{"kind":"mcq","question":"בלי מפתח השרת?","options":["a","b"],"answer":0,"explanations":["1","2"],"slides":[5],"para":1}'::jsonb);
  raise notice 'QA2b. FAIL: saved without the server key';
exception when others then raise notice 'QA2b. %: still only the server saves (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_question_still_true('3c2a0000-0000-4000-8000-000000000001');
  raise notice 'QA3. FAIL: a stranger checked a question';
exception when others then raise notice 'QA3. %: a stranger cannot (%)', case when sqlerrm = 'question not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
update public.study_questions set stale_at = now(), stale_edit = gen_random_uuid() where id = '3c2a0000-0000-4000-8000-000000000006';
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_question_still_true('3c2a0000-0000-4000-8000-000000000006') is null as s \gset
select 'QA3b. "עדיין נכון": stale ' || (stale_at is not null) || ', checked by Maya ' || (checked_by = '3c000000-0000-4000-8000-000000000001')
       || ' (expect false, true)'
  from public.study_questions where id = '3c2a0000-0000-4000-8000-000000000006';
reset role;
do $$ begin insert into public.study_answers (user_id, question_id, choice, correct, confidence)
  values ('cccccccc-0000-4000-8000-000000000003', '3c2a0000-0000-4000-8000-000000000001', 0, true, 4);
  raise notice 'QA4. FAIL: a bet of 4';
exception when check_violation then raise notice 'QA4. ok: the bet is 1-3 (ניחוש · נראה לי · על בטוח)'; end $$;
select 'QA-reg. the registry: ' || (public.study_schema() ->> 'Q') || ' (expect 2)';
delete from public.study_questions where id in (current_setting('t.qa1')::uuid, current_setting('t.qa2')::uuid);

-- ═════════ Section C's end: placed cards, trap cards, "עדיין נכון" ═════════
insert into public.study_card_batches (id, lecture_id, round, part_idx, heading, slide_from, slide_to, wanted, status)
values ('3c4b0000-0000-4000-8000-000000000001', '3c100000-0000-4000-8000-000000000001', 1, 1, 'מנגנונים', 13, 24, 4, 'writing');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select set_config('t.ca1', public.study_save_card('3c4b0000-0000-4000-8000-000000000001',
  '{"kind":"qa","front":"כל כמה זמן Mefloquine?","back":"פעם בשבוע","slides":[20],"para":2,"quote":"Mefloquine ניתנת"}', :'key')::text, false) is not null as c \gset
select 'CA1. a generated card on its paragraph: part ' || part_idx || ', anchor ' || anchor || ', quote "' || quote || '"'
       || ' (expect 1, 2, "Mefloquine ניתנת")'
  from public.study_cards where id = current_setting('t.ca1')::uuid;
select set_config('t.ca2', public.study_add_card('3c100000-0000-4000-8000-000000000001',
  '{"kind":"qa","front":"מה בודקים לפני Primaquine?","back":"G6PD","slides":[7],"part":0,"para":3,"quote":"לפני Primaquine"}')::text, false) is not null as c \gset
select set_config('t.ca3', public.study_add_card('3c100000-0000-4000-8000-000000000001',
  '{"kind":"qa","front":"איפה מצטברת Chloroquine?","back":"בוואקואולה","slides":[15]}')::text, false) is not null as c \gset
select 'CA2. a member''s card from the paragraph sheet: part ' || a.part_idx || ', anchor ' || a.anchor || '; from the deck: part '
       || b.part_idx || ', anchor ' || coalesce(b.anchor::text, 'null') || ' (expect 0, 3; 1, null)'
  from public.study_cards a, public.study_cards b where a.id = current_setting('t.ca2')::uuid and b.id = current_setting('t.ca3')::uuid;
reset role;
select 'CA3. members cannot make a trap card themselves: ' ||
       has_function_privilege('authenticated', 'study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)', 'execute')
       || ' (expect false)';
select set_config('t.tc', study_private.trap_card('3c100000-0000-4000-8000-000000000001', 2, 2, 'Quinine עם',
  E'מה מצרפים ל-Quinine?\nלמה לא Doxycycline?', 'tetracycline: לא בהיריון [ש'' 33]', 'התשובה הנכונה: Clindamycin', array[33], 'test:trap')::text, false) is not null as t \gset
select 'CA3b. a trap card: source ' || source || ', anchor ' || anchor || '; the same key again gives the same card: '
       || (study_private.trap_card('3c100000-0000-4000-8000-000000000001', 2, 2, '', 'אחר?', 'אחר', '', array[33], 'test:trap') = id)
       || ' (expect trap, 2, true)'
  from public.study_cards where id = current_setting('t.tc')::uuid;
select 'CA3c. a trap that fails the card checks makes no card: ' ||
       coalesce(study_private.trap_card('3c100000-0000-4000-8000-000000000001', 2, 2, '', 'אחר?', 'תשובה', '', array[99], 'test:bad')::text, 'null')
       || ' (expect null: slide 99 is not in the lecture)';
update public.study_cards set front = 'נערך ע״י הקבוצה: מה מצרפים ל-Quinine?' where id = current_setting('t.tc')::uuid;
select study_private.trap_card_drop(current_setting('t.tc')::uuid) is null as d \gset
select 'CA3d. an edited trap card stays when its round is voided: ' || count(*) || ' (expect 1)' from public.study_cards where id = current_setting('t.tc')::uuid;
update public.study_cards set stale_at = now(), stale_edit = gen_random_uuid() where id in (current_setting('t.ca1')::uuid, current_setting('t.ca3')::uuid);
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_edit_card(current_setting('t.ca1')::uuid, 1, '{"back":"פעם בשבוע (Mefloquine)"}') is not null as e \gset
select public.study_card_still_true(current_setting('t.ca3')::uuid) is null as s \gset
select 'CA4. an edit clears the mark: ' || (select stale_at is null from public.study_cards where id = current_setting('t.ca1')::uuid)
       || '; "עדיין נכון" by Itai: ' || (select stale_at is null and checked_by = '3c000000-0000-4000-8000-000000000002' from public.study_cards where id = current_setting('t.ca3')::uuid)
       || ' (expect true; true)';
reset role;
select 'CA-reg. the registry: ' || (public.study_schema() ->> 'C') || ' (expect 2)';
delete from public.study_cards where id in (current_setting('t.ca1')::uuid, current_setting('t.ca2')::uuid, current_setting('t.ca3')::uuid, current_setting('t.tc')::uuid);

-- ═════════ Section K's end: a source, a second approval, undo in one tap ═════════
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$
declare c record; n int := 0;
begin
  for c in select * from (values ('no kind', null::text, null::int[], null::int, ''),
                                 ('slide not in the lecture', 'slide', array[99], null::int, ''),
                                 ('no slide', 'slide', '{}'::int[], null::int, ''),
                                 ('recording without the minute', 'recording', null::int[], null::int, ''),
                                 ('outside source without a note', 'external', null::int[], null::int, 'x')) as t(label, k, sl, at, note) loop
    begin
      perform public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 1,
        'Chloroquine מצטברת בוואקואולה. [ש'' 15]', 'Chloroquine מצטברת בוואקואולה של הטפיל. [ש'' 15]', 0, 0, 1, '',
        c.k, c.sl, c.at, c.note);
      raise notice 'KA1. FAIL: % was accepted', c.label;
    exception when others then if sqlerrm = 'bad source' then n := n + 1; else raise notice 'KA1. FAIL: % → %', c.label, sqlerrm; end if; end;
  end loop;
  raise notice 'KA1. ok: % of 5 proposals without a usable source refused as bad source', n;
end $$;
select set_config('t.p1', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 1,
  'Chloroquine מצטברת בוואקואולה. [ש'' 15]', 'Chloroquine מצטברת בוואקואולה של הטפיל. [ש'' 15]', 0, 0, 1,
  'ממלאת מה שכתוב בשקף 15', 'slide', array[15], null, '')::text, false) is not null as p \gset
select 'KA2. proposed: ' || p.state || ', source ' || p.source_kind || ' ' || array_to_string(p.source_slides, ',') || '; the summary unchanged: '
       || (s.markdown like '%Chloroquine מצטברת בוואקואולה. [ש'' 15]%') || ' (expect pending, slide 15; true)'
  from public.study_edit_proposals p, public.study_sections s
 where p.id = current_setting('t.p1')::uuid and s.lecture_id = '3c100000-0000-4000-8000-000000000001' and s.idx = 1;
do $$ begin perform public.study_approve_edit(current_setting('t.p1')::uuid);
  raise notice 'KA3. FAIL: Noa approved her own correction';
exception when others then raise notice 'KA3. %: a second member approves (%)', case when sqlerrm = 'own proposal' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_edit_block('3c100000-0000-4000-8000-000000000001', 1, 2, 'Mefloquine ניתנת פעם בשבוע. [ש'' 20]',
    'Mefloquine ניתנת פעם בשבוע בלבד. [ש'' 20]', 0, 0);
  raise notice 'KA4. FAIL: a direct correction went in without approval';
exception when others then raise notice 'KA4. %: direct corrections need approval (%)', case when sqlerrm = 'needs approval' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
do $$ begin perform public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 1, 1, 'Chloroquine מצטברת בוואקואולה. [ש'' 15]',
    'Chloroquine מצטברת. [ש'' 15]', 0, 0, 1, '', 'slide', array[15], null, '');
  raise notice 'KA5. FAIL: two open proposals on one paragraph';
exception when others then raise notice 'KA5. %: one open proposal a paragraph (%)', case when sqlerrm = 'pending exists' then 'ok' else 'FAIL' end, sqlerrm; end $$;
do $$ begin perform public.study_approve_edit(current_setting('t.p1')::uuid, true);
  raise notice 'KA6. FAIL: approval aloud without being the reader';
exception when others then raise notice 'KA6. %: only the meeting''s reader approves aloud (%)', case when sqlerrm = 'not live' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.e1', (public.study_approve_edit(current_setting('t.p1')::uuid) ->> 'edit_id'), false) is not null as a \gset
select 'KA7. approved by Shoham: proposal ' || p.state || '; history author Noa ' || (e.author_id = 'cccccccc-0000-4000-8000-000000000003')
       || ', approved by Shoham ' || (e.approved_by = 'bbbbbbbb-0000-4000-8000-000000000002') || ', aloud ' || e.aloud || ', source ' || e.source_kind
       || ' ' || array_to_string(e.source_slides, ',') || ', linked ' || (p.edit_id = e.id and e.proposal_id = p.id)
       || '; the summary now: ' || (s.markdown like '%בוואקואולה של הטפיל. [ש'' 15]%')
       || ' (expect applied; true, true, false, slide 15, true; true)'
  from public.study_edit_proposals p, public.study_edits e, public.study_sections s
 where p.id = current_setting('t.p1')::uuid and e.id = current_setting('t.e1')::uuid
   and s.lecture_id = '3c100000-0000-4000-8000-000000000001' and s.idx = 1;
-- A paragraph that changed after the proposal: the approval reports a conflict instead of guessing.
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select set_config('t.p2', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 2, 2,
  'Quinine עם Doxycycline, לא בהיריון. [ש'' 33]', 'Quinine עם Doxycycline או Clindamycin. [ש'' 33]', 0, 0, 1, '',
  'recording', null, 2470, '')::text, false) is not null as p \gset
reset role;
update public.study_sections set markdown = replace(markdown, 'Quinine עם Doxycycline, לא בהיריון.', 'Quinine עם Doxycycline (לא בהיריון).')
 where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 2;
set role authenticated;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select set_config('t.c2', public.study_approve_edit(current_setting('t.p2')::uuid) ->> 'conflict', false) is not null as c \gset
select 'KA8. the paragraph changed meanwhile: ' || current_setting('t.c2') || ', proposal ' || state || ' (expect true, conflict)'
  from public.study_edit_proposals where id = current_setting('t.p2')::uuid;
reset role;
update public.study_sections set markdown = replace(markdown, 'Quinine עם Doxycycline (לא בהיריון).', 'Quinine עם Doxycycline, לא בהיריון.')
 where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 2;
set role authenticated;
-- One tap undoes it, at once.
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select set_config('t.u1', (public.study_edit_block('3c100000-0000-4000-8000-000000000001', 1, 1,
  'Chloroquine מצטברת בוואקואולה של הטפיל. [ש'' 15]', 'Chloroquine מצטברת בוואקואולה. [ש'' 15]',
  (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 1), 0, 1, '',
  current_setting('t.e1')::uuid) ->> 'edit_id'), false) is not null as u \gset
select 'KA9. undone in one tap by Itai: ' || (s.markdown like '%Chloroquine מצטברת בוואקואולה. [ש'' 15]%') || ', source ' || e.source_kind
       || ', undo of the correction ' || (e.undo_of::text = current_setting('t.e1')) || ' (expect true, undo, true)'
  from public.study_sections s, public.study_edits e
 where s.lecture_id = '3c100000-0000-4000-8000-000000000001' and s.idx = 1 and e.id = current_setting('t.u1')::uuid;
select set_config('t.p3', public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 2, 1,
  'Artemisinins לעולם לא לבד. [ש'' 30]', 'Artemisinins לעולם לא לבד, תמיד עם שותף. [ש'' 30]', 0, 0, 1, '',
  'external', null, null, 'ההנחיות של WHO')::text, false) is not null as p \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000003';
do $$ begin perform public.study_withdraw_edit(current_setting('t.p3')::uuid);
  raise notice 'KA10. FAIL: Daniel withdrew Itai''s proposal';
exception when others then raise notice 'KA10. %: only the proposer withdraws (%)', case when sqlerrm = 'not pending' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_withdraw_edit(current_setting('t.p3')::uuid) is null as w \gset
select 'KA10b. withdrawn by Itai: ' || state || ' (expect withdrawn)' from public.study_edit_proposals where id = current_setting('t.p3')::uuid;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'KA11. a stranger sees ' || count(*) || ' proposals (expect 0)' from public.study_edit_proposals;
do $$ begin perform public.study_propose_edit('3c100000-0000-4000-8000-000000000001', 2, 1, 'Artemisinins לעולם לא לבד. [ש'' 30]',
  'x [ש'' 30]', 0, 0, 1, '', 'slide', array[30], null, '');
  raise notice 'KA11b. FAIL: a stranger proposed';
exception when others then raise notice 'KA11b. %: a stranger cannot propose (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.study_propose_edit(gen_random_uuid(), 0, 0, 'a', 'b', 0, 0, 1, '', 'slide', array[1], null, '');
  raise notice 'KA11c. FAIL: anon called it';
exception when insufficient_privilege then raise notice 'KA11c. ok: anon cannot propose (%)', sqlerrm; end $$;
reset role;
select 'KA12. proposals are published (the pending mark and "לאשר" live): '
       || exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_edit_proposals')
       || '; the registry: ' || (public.study_schema() ->> 'K') || ' (expect true; 2)';

-- ═════════ Section Z's end: part range, the bet, Mazur's rule, the trap, the record ═════════
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$
declare c record; n int := 0;
begin
  for c in select * from (values
      ('bad preset', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 5, 'party', null::uuid, null::int, null::int, 'bad preset'),
      ('opening without a meeting', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 3, 'coffee', null::uuid, null::int, null::int, 'meeting not found'),
      ('opening as a race', 'race', array['3c100000-0000-4000-8000-000000000001']::uuid[], 3, 'coffee', null::uuid, null::int, null::int, 'bad mode'),
      ('stop of three', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 3, 'stop', null::uuid, 1, 1, 'bad count'),
      ('parts of two lectures', 'coop', array['3c100000-0000-4000-8000-000000000001', '3c100000-0000-4000-8000-000000000002']::uuid[], 5, 'free', null::uuid, 0, 1, 'bad parts'),
      ('a part that is not there', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 5, 'end', null::uuid, 0, 9, 'bad parts'),
      ('half a range', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 5, 'end', null::uuid, 0, null::int, 'bad parts'),
      ('a meeting that is not there', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 5, 'end', gen_random_uuid(), null::int, null::int, 'meeting not found')
    ) as t(label, mode, lecs, cnt, preset, meeting, pf, pt, want) loop
    begin
      perform public.study_quiz_create(current_setting('t.gid')::uuid, c.mode, c.lecs, c.cnt, 60, 'all', c.preset, c.meeting, c.pf, c.pt);
      raise notice 'ZA0. FAIL: % was accepted', c.label;
    exception when others then if sqlerrm = c.want then n := n + 1; else raise notice 'ZA0. FAIL: % → %', c.label, sqlerrm; end if; end;
  end loop;
  raise notice 'ZA0. ok: % of 8 bad quizzes refused with their reason', n;
end $$;
-- "סוף הקריאה" on part 0 of L1: three questions, one of them marked stale by a correction.
select set_config('t.zq', public.study_quiz_create(:'gid', 'coop', array['3c100000-0000-4000-8000-000000000001']::uuid[], 3, 60, 'all', 'end', null, 0, 0)::text, false) is not null as z \gset
reset role;
update public.study_questions set stale_at = now() where id = '3c2a0000-0000-4000-8000-000000000004';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_join(current_setting('t.zq')::uuid) is null as j \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_quiz_join(current_setting('t.zq')::uuid) is null as j \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select public.study_quiz_join(current_setting('t.zq')::uuid) is null as j \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zq')::uuid, -1) is null as n \gset
reset role;
select 'ZA1. on part 0 only, never the stale question, in reading order: '
       || string_agg(right(r.question_id::text, 1), ',' order by r.idx) || '; preset ' || max(z.preset) || ', parts ' || max(z.part_from) || '-' || max(z.part_to)
       || ' (expect 1 first, then 2 and 3; end, 0-0)'
  from public.study_quiz_rounds r join public.study_quizzes z on z.id = r.quiz_id where r.quiz_id = current_setting('t.zq')::uuid;
select set_config('t.zk0', mtest.key_now(current_setting('t.zq')::uuid)::text, false) is not null as k \gset
select mtest.shift(current_setting('t.zq')::uuid, 5) is null as s \gset
set role authenticated;
-- Round 0: Shoham right on "על בטוח", Itai right on "ניחוש", Noa and Maya on the same wrong option.
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_answer(current_setting('t.zq')::uuid, 0, 1, 5);
  raise notice 'ZA2. FAIL: a bet of 5';
exception when others then raise notice 'ZA2. %: a bet is 1-3 (%)', case when sqlerrm = 'bad bet' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'ZA2b. Noa''s answer keeps her bet: vote ' || vote || ', bet ' || bet || ' (expect 1, 3)'
  from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, (current_setting('t.zk0')::int + 1) % 5, 3);
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, (current_setting('t.zk0')::int + 1) % 5, 2) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int, 1) \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int, 3) \gset
select 'ZA3. 2 of 4 right (50%): state ' || (s -> 'quiz' ->> 'state') || ', stage ' || (s -> 'quiz' ->> 'stage')
       || ', argue for ' || round(extract(epoch from ((s -> 'quiz' ->> 'argue_until')::timestamptz - now())))::int || ' s'
       || ', key sent: ' || ((s -> 'round') ? 'answer') || ', vote 1''s counts ' || (s -> 'round' -> 'counts1')::text
       || ' (expect reveal, argue, 90 s, false, two on the key and two on the trap)'
  from (select public.study_quiz_state(current_setting('t.zq')::uuid) as s) x;
reset role;
select 'ZA3b. nothing is scored or copied while they argue: private copies ' ||
       (select count(*) from public.study_answers where question_id = '3c2a0000-0000-4000-8000-000000000001' and mode = 'quiz')
       || ', key still held ' || (select held_until > now() + interval '90 seconds' from public.study_question_keys where question_id = '3c2a0000-0000-4000-8000-000000000001')
       || ' (expect 0, true)';
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-4000-8000-000000000006';
do $$ begin perform public.study_answer_question('3c2a0000-0000-4000-8000-000000000001', 0);
  raise notice 'ZA3c. FAIL: practice gave the key while the group argues';
exception when others then raise notice 'ZA3c. %: practice waits for the vote (%)', case when sqlerrm = 'in quiz' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_quiz_next(current_setting('t.zq')::uuid, 0);
  raise notice 'ZA4. FAIL: Noa opened the second vote';
exception when others then raise notice 'ZA4. %: the host opens vote 2 (%)', case when sqlerrm = 'not host' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zq')::uuid, 0) is null as n \gset
select 'ZA4b. "לסבב 2": state ' || state || ', vote ' || vote || ', closes in ' || round(extract(epoch from (closes_at - now())))::int || ' s'
       || ' (expect question, 2, 33 s)' from public.study_quizzes where id = current_setting('t.zq')::uuid;
reset role;
select mtest.shift(current_setting('t.zq')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ZA4c. Noa''s second vote is kept apart: vote ' || vote || ', bet ' || coalesce(bet::text, 'none') || ' (expect 2, none)'
  from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int, 3, 2);
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select vote is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select vote is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int) \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select vote is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 0, current_setting('t.zk0')::int) \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ZA5. after the revote: ' || (r ->> 'next_step') || ', right ' || (r ->> 'right') || ' of ' || (r ->> 'answered') || ', before '
       || (r ->> 'right1') || ' of ' || (r ->> 'answered1') || ', the trap is option ' || (r ->> 'trap')
       || '; Noa (private): ' || (r ->> 'points') || ' for her first vote, right then ' || (r ->> 'correct') || ', right after the discussion ' || (r ->> 'correct2')
       || ' (expect explain, 4 of 4, 2 of 4, key+1; -6, false, true)'
  from (select public.study_quiz_state(current_setting('t.zq')::uuid) -> 'round' as r) x;
reset role;
select 'ZA5b. the trap option is key+1: ' || (trap = (current_setting('t.zk0')::int + 1) % 5) || ' (expect true)'
  from public.study_quiz_rounds where quiz_id = current_setting('t.zq')::uuid and idx = 0;
select 'ZA6. first votes only reach the private record, with the bet: ' || count(*) || ' rows, Noa''s: choice '
       || max(choice) filter (where user_id = 'cccccccc-0000-4000-8000-000000000003') || ', bet '
       || max(confidence) filter (where user_id = 'cccccccc-0000-4000-8000-000000000003') || ', right '
       || bool_or(correct) filter (where user_id = 'cccccccc-0000-4000-8000-000000000003')
       || ' (expect 4 rows; key+1, 3, false)'
  from public.study_answers where question_id = '3c2a0000-0000-4000-8000-000000000001' and mode = 'quiz';
select 'ZA6b. points: ' || string_agg(m.name || ' ' || a.points, ', ' order by m.name) || ' (expect each bet: right +3/+1, wrong −6/−2)'
  from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id and r.quiz_id = current_setting('t.zq')::uuid and r.idx = 0
  join public.study_members m on m.user_id = a.user_id where a.vote = 1;
select 'ZA7. two players chose the round''s trap: cards made ' || count(*)
       || ' (expect 0: a trap card needs 3 players'' choice and opens the next study day, review SEC-6; check SR6c covers 3)'
  from public.study_cards where trap_key = 'q:3c2a0000-0000-4000-8000-000000000001:' || ((current_setting('t.zk0')::int + 1) % 5);
-- Round 1: 3 of 4 right (75%) → explained at once.
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zq')::uuid, 0) is null as n \gset
reset role;
select set_config('t.zk1', mtest.key_now(current_setting('t.zq')::uuid)::text, false) is not null as k \gset
select mtest.shift(current_setting('t.zq')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 1, current_setting('t.zk1')::int, 2) \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 1, current_setting('t.zk1')::int, 2) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 1, current_setting('t.zk1')::int, 1) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 1, (current_setting('t.zk1')::int + 2) % 5, 1) \gset
select 'ZA8. 3 of 4 right (75%): ' || (s -> 'quiz' ->> 'stage') || ', ' || (s -> 'round' ->> 'next_step') || ', key sent '
       || ((s -> 'round') ? 'answer') || ', trap ' || coalesce(s -> 'round' ->> 'trap', 'none') || ' (expect final, explain, true, none: one wrong vote)'
  from (select public.study_quiz_state(current_setting('t.zq')::uuid) as s) x;
-- Round 2: 1 of 4 right (25%) → every phone opens the paragraph.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zq')::uuid, 1) is null as n \gset
reset role;
select set_config('t.zk2', mtest.key_now(current_setting('t.zq')::uuid)::text, false) is not null as k \gset
select set_config('t.zq2', mtest.q_now(current_setting('t.zq')::uuid)::text, false) is not null as k \gset
select mtest.shift(current_setting('t.zq')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 2, current_setting('t.zk2')::int, 3) \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 2, (current_setting('t.zk2')::int + 3) % 5, 3) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 2, (current_setting('t.zk2')::int + 3) % 5, 2) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zq')::uuid, 2, (current_setting('t.zk2')::int + 3) % 5, 1) \gset
select 'ZA9. 1 of 4 right (25%): ' || (r ->> 'next_step') || ', jump to part ' || (r -> 'jump' ->> 'part') || ' paragraph ' || (r -> 'jump' ->> 'anchor')
       || ', trap is the option three chose: ' || ((r ->> 'trap')::int = (current_setting('t.zk2')::int + 3) % 5)
       || ' (expect source, 0, 2, true)'
  from (select public.study_quiz_state(current_setting('t.zq')::uuid) -> 'round' as r) x;
-- The end: the team's result counts final votes; three rounds set no record.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zq')::uuid, 2) is null as n \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ZA10. the end: ' || (s -> 'quiz' ->> 'state') || ', team ' || (s -> 'team' ->> 'right_pct') || '%, passed ' || (s -> 'team' ->> 'passed')
       || ', new record ' || (s -> 'team' ->> 'new_record') || '; round 0 before and after: ' || (s -> 'summary' -> 0 ->> 'right1') || ' → ' || (s -> 'summary' -> 0 ->> 'right')
       || '; Noa''s private total ' || (s -> 'me' ->> 'score') || ', her first votes right ' || (s -> 'me' ->> 'correct_n') || ' of ' || (s -> 'me' ->> 'answered_n')
       || ' (expect ended, 67%, false, false; 2 → 4; -10, 1 of 3)'
  from (select public.study_quiz_state(current_setting('t.zq')::uuid) as s) x;
select 'ZA10b. "יחד": ' || r.mode || ', ' || r.rounds || ' rounds, the group right ' || r.right_pct || '% (final votes), Noa ' || r.my_correct || '/' || r.my_answered
       || ' (expect coop, 3 rounds, 67%, 1/3)'
  from public.study_quiz_recent(:'gid') r where r.id = current_setting('t.zq')::uuid;
-- A race scores the bet (decision 2): right +2 twice, wrong −6; speed breaks the tie.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select set_config('t.zr', public.study_quiz_create(:'gid', 'race', array['3c100000-0000-4000-8000-000000000002']::uuid[], 3, 30)::text, false) is not null as z \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_quiz_join(current_setting('t.zr')::uuid) is null as j \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_quiz_join(current_setting('t.zr')::uuid) is null as j \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_next(current_setting('t.zr')::uuid, -1) is null as n \gset
reset role;
select set_config('t.zrk', mtest.key_now(current_setting('t.zr')::uuid)::text, false) is not null as k \gset
select mtest.shift(current_setting('t.zr')::uuid, 5) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zr')::uuid, 0, current_setting('t.zrk')::int, 2) \gset
reset role;
select mtest.shift(current_setting('t.zr')::uuid, 4) is null as s \gset
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zr')::uuid, 0, current_setting('t.zrk')::int, 2) \gset
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select bet is not null as a from public.study_quiz_answer(current_setting('t.zr')::uuid, 0, (current_setting('t.zrk')::int + 1) % 5, 3) \gset
select 'ZA11. a race: ' || (s -> 'round' ->> 'next_step') || '; the table ' ||
       (select string_agg((p ->> 'name') || ' ' || (p ->> 'score'), ', ' order by (p ->> 'score')::int desc, (p ->> 'ms')::int)
          from jsonb_array_elements(s -> 'players') p)
       || ' (expect explain: no revote in a race; שוהם 2, נועה כהן 2, מאיה -6)'
  from (select public.study_quiz_state(current_setting('t.zr')::uuid) as s) x;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select public.study_quiz_end(current_setting('t.zr')::uuid) is null as e \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ZA11b. Noa''s place after the race: ' || my_rank || ' (expect 2: tied with Shoham, who was faster)' from public.study_quiz_recent(:'gid') where id = current_setting('t.zr')::uuid;
-- The record: the best co-op score of at least 5 rounds and 3 players.
reset role;
insert into public.study_quizzes (id, group_id, mode, title, lecture_ids, n_wanted, seconds, state, idx, n_total, preset, created_at, ended_at)
values ('3c5a0000-0000-4000-8000-000000000001', :'gid', 'coop', 'שיא', array['3c100000-0000-4000-8000-000000000001']::uuid[], 5, 60, 'ended', 4, 5, 'end',
        now() - interval '2 days', now() - interval '2 days');
insert into public.study_quiz_players (quiz_id, user_id)
select '3c5a0000-0000-4000-8000-000000000001', u from unnest(array['bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003',
                                                                   '3c000000-0000-4000-8000-000000000001']::uuid[]) u;
insert into public.study_quiz_rounds (id, quiz_id, idx, question_id, seconds, revealed_at, answer)
select ('3c5b0000-0000-4000-8000-00000000000' || i)::uuid, '3c5a0000-0000-4000-8000-000000000001', i, ('3c2a0000-0000-4000-8000-00000000000' || (i + 1))::uuid,
       60, now() - interval '2 days', 0
  from generate_series(0, 4) i;
insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at, correct, vote)
select ('3c5b0000-0000-4000-8000-00000000000' || i)::uuid, u, 0, 1000, now() - interval '2 days', not (i = 0 and u = '3c000000-0000-4000-8000-000000000001'), 1
  from generate_series(0, 4) i, unnest(array['bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003',
                                              '3c000000-0000-4000-8000-000000000001']::uuid[]) u;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'ZA12. the group''s record (the lobby''s "השיא"): ' || public.study_quiz_record(:'gid') || '% (expect 93: 14 of 15; the 3-round quiz does not count)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_quiz_record(current_setting('t.gid')::uuid); raise notice 'ZA12b. FAIL: a stranger read the record';
exception when others then raise notice 'ZA12b. %: members only (%)', case when sqlerrm = 'group not found' then 'ok' else 'FAIL' end, sqlerrm; end $$;
reset role;
select 'ZA13. the hold is gone after the end: ' || count(*) || ' keys held (expect 0); the registry: ' || (public.study_schema() ->> 'Z') || ' (expect 2)'
  from public.study_question_keys where held_until > now();
update public.study_questions set stale_at = null where id = '3c2a0000-0000-4000-8000-000000000004';

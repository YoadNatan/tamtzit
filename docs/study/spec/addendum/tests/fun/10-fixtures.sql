-- ════════════════════════════════════════════════════════════════════════
--  addendum "fun" checks · fixtures (a database of their own: they create the
--  group). Load order: stubs.sql, stubs-additions.sql, board-schema.sql,
--  study-schema.sql, every spec section (with the A and Z patches),
--  00-standins.sql, sections U, J, H, all twice; then 10-fixtures.sql,
--  20-pulse-test.sql, 30-wall-test.sql, 40-boss-test.sql, 50-later-test.sql,
--  60-merge-test.sql in one psql session. Each line reads "<label>. ok: …
--  (expect …)" or "<label>. FAIL: …"; time is simulated by counting for a
--  fixed instant (pulse_night's p_now) and by moving quiz rounds into the
--  past as the table owner, never by sleeping.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null
reset role;
create schema if not exists funtest;
create or replace function funtest.expect(p_label text, p_got text, p_want text) returns text language sql as $$
  select p_label || '. ' || case when p_got is not distinct from p_want then 'ok' else 'FAIL' end
         || ': ' || coalesce(p_got, 'null') || ' (expect ' || coalesce(p_want, 'null') || ')'
$$;
grant usage on schema funtest to anon, authenticated;
grant execute on function funtest.expect(text, text, text) to anon, authenticated;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as have_key \gset

-- The six, an outsider, and a laptop of Noa's that never saved an account.
insert into auth.users (id, raw_user_meta_data) values
 ('10000000-0000-4000-8000-0000000000a1', '{"app":"study","full_name":"שוהם"}'),
 ('10000000-0000-4000-8000-0000000000a2', '{"app":"study","full_name":"נועה"}'),
 ('10000000-0000-4000-8000-0000000000a3', '{"app":"study","full_name":"מאיה"}'),
 ('10000000-0000-4000-8000-0000000000a4', '{"app":"study","full_name":"איתי"}'),
 ('10000000-0000-4000-8000-0000000000a5', '{"app":"study","full_name":"דניאל"}'),
 ('10000000-0000-4000-8000-0000000000a6', '{"app":"study","full_name":"רוני"}'),
 ('10000000-0000-4000-8000-0000000000a9', '{"app":"study","full_name":"זר"}'),
 ('10000000-0000-4000-8000-0000000000b2', '{"app":"study","full_name":"נועה"}');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
select id as gid, join_code as code from public.study_create_group('הקבוצה', 'שוהם') \gset
select set_config('t.gid', :'gid', false) is not null as g \gset
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a2';
select 1 from public.study_join(:'code', 'נועה');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a3';
select 1 from public.study_join(:'code', 'מאיה');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a4';
select 1 from public.study_join(:'code', 'איתי');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a5';
select 1 from public.study_join(:'code', 'דניאל');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a6';
select 1 from public.study_join(:'code', 'רוני');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000b2';
select 1 from public.study_join(:'code', 'נועה (מחשב)');
reset role;
-- review SEC-8: the six saved their accounts and joined weeks ago; Noa's
-- laptop never saved one (an anonymous user is not a second person).
update public.study_members set joined_at = now() - interval '60 days' where group_id = :'gid';
update auth.users set is_anonymous = true where id = '10000000-0000-4000-8000-0000000000b2';

-- Two lectures (38 and 6 slides; slide 7 has the lecturer's picture), four ready parts.
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, created_by) values
 ('f0000000-0000-4000-8000-000000000001', :'gid', 'פתוגן מאכסן', 'Anti parasite', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', '[]'::jsonb, 'tables', '[]'::jsonb, 'notes', '',
                                       'figures', case when n = 7 then '[{"k": 1, "path": "x/7-1.jpg", "w": 10, "h": 10}]'::jsonb else '[]'::jsonb end))
     from generate_series(1, 38) n), '10000000-0000-4000-8000-0000000000a1'),
 ('f0000000-0000-4000-8000-000000000002', :'gid', 'פתוגן מאכסן', 'Anthelmintics', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n)) from generate_series(1, 6) n), '10000000-0000-4000-8000-0000000000a1');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, markdown, status) values
 ('f0000000-0000-4000-8000-000000000001', 0, 'Amebiasis ו-Metronidazole', 1, 12, '## Amebiasis', 'ready'),
 ('f0000000-0000-4000-8000-000000000001', 1, 'Leishmaniasis', 13, 18, '## Leishmaniasis', 'ready'),
 ('f0000000-0000-4000-8000-000000000001', 2, 'מלריה: תרופות', 19, 33, '## מלריה', 'ready'),
 ('f0000000-0000-4000-8000-000000000001', 3, 'Primaquine ו-G6PD', 34, 38, '## Primaquine', 'ready'),
 ('f0000000-0000-4000-8000-000000000002', 0, 'Cestodes', 1, 6, '## Cestodes', 'ready');

-- The bank: question, part, paragraph (A1), topic, aspect, slides, key.
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, anchor, kind, question, options, slides, topic, aspect)
values
 ('f1000000-0000-4000-8000-000000000001', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 3, 2, 'mcq', 'מה בודקים לפני מתן Primaquine?',
  array['תפקודי כליה', 'G6PD', 'ספירת דם', 'ECG', 'אין צורך'], array[37], 'Primaquine', 'contra'),
 ('f1000000-0000-4000-8000-000000000002', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 3, 2, 'mcq', 'Primaquine בהיריון?',
  array['אסורה', 'מותרת', 'רק בשליש השלישי', 'רק עם Chloroquine', 'רק בילדים'], array[37, 38], 'Primaquine', 'contra'),
 ('f1000000-0000-4000-8000-000000000003', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 1, 4, 'mcq', 'כמה זמן אמצעי מניעה אחרי Miltefosine?',
  array['שבוע', 'חודש', '5 חודשים', 'שנה', 'לא צריך'], array[16], 'Miltefosine', 'contra'),
 ('f1000000-0000-4000-8000-000000000004', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 0, 3, 'mcq', 'Metronidazole ואלכוהול: מה קורה?',
  array['תגובה דמוית Disulfiram', 'שום דבר', 'היפוגליקמיה', 'QT ארוך', 'פריחה'], array[7], 'Metronidazole', 'interactions'),
 ('f1000000-0000-4000-8000-000000000005', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 2, 1, 'mcq', 'למה משמשת Quinine?',
  array['מניעת מלריה', 'מלריה קלה בלבד', 'טוקסופלזמה', 'טיפול, בשילוב עם Doxycycline או Clindamycin', 'רק בילדים'], array[27, 33], 'Quinine', 'uses'),
 ('f1000000-0000-4000-8000-000000000006', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 0, 1, 'mcq', 'Paromomycin: luminal או tissue?',
  array['luminal', 'tissue', 'שניהם', 'אף אחד', 'תלוי במינון'], array[4], 'Luminal', 'classification'),
 ('f1000000-0000-4000-8000-000000000007', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 2, 0, 'mcq', 'מה ה-t½ הסופי של Chloroquine?',
  array['1-2 חודשים', '18 שעות', 'שבוע', 'יום', 'שנה'], array[26], 'Chloroquine', 'pk'),
 ('f1000000-0000-4000-8000-000000000008', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 2, 0, 'mcq', 'Chloroquine: Vd?',
  array['קטן', '100-1000 L/kg', '1 L/kg', 'לא ידוע', 'תלוי'], array[26], 'Chloroquine', 'pk');
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select q.id, k.a, array['הסבר א [ש'' ' || q.slides[1] || ']', 'הסבר ב', 'הסבר ג', 'הסבר ד', 'הסבר ה'], 'מה לזכור ' || right(q.id::text, 1)
  from public.study_questions q
  join (values ('f1000000-0000-4000-8000-000000000001'::uuid, 1::smallint), ('f1000000-0000-4000-8000-000000000002', 0),
               ('f1000000-0000-4000-8000-000000000003', 2), ('f1000000-0000-4000-8000-000000000004', 0),
               ('f1000000-0000-4000-8000-000000000005', 3), ('f1000000-0000-4000-8000-000000000006', 0),
               ('f1000000-0000-4000-8000-000000000007', 0), ('f1000000-0000-4000-8000-000000000008', 1)) k(id, a) on k.id = q.id;
update public.study_question_keys set explanations[1] = 'לבדה לא למניעה: Doxycycline לבדה כן משמשת למניעה [ש'' 33]'
 where question_id = 'f1000000-0000-4000-8000-000000000005';
insert into public.study_question_flags (question_id, user_id, reason)
values ('f1000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-0000000000a2', 'wrong_key');

-- Cards on paragraphs (A1).
insert into public.study_cards (id, group_id, lecture_id, source, part_idx, anchor, kind, front, back, slides, topic, aspect, created_by) values
 ('f2000000-0000-4000-8000-000000000001', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 1, 4, 'qa',
  'Miltefosine: כמה זמן אמצעי מניעה אחרי הטיפול?', '5 חודשים', array[16], 'Miltefosine', 'contra', null),
 ('f2000000-0000-4000-8000-000000000002', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 2, 1, 'qa',
  'Quinine: לטיפול או למניעה?', 'לטיפול, בשילוב', array[27], 'Quinine', 'uses', null),
 ('f2000000-0000-4000-8000-000000000003', :'gid', 'f0000000-0000-4000-8000-000000000001', 'ai', 0, 3, 'qa',
  'Metronidazole: כמה זמן בלי אלכוהול?', '48 שעות', array[7], 'Metronidazole', 'interactions', null);

-- The meeting the "לא ברור" taps were made in (section M's row when the
-- meeting addendum is loaded; with its stand-in table any id will do).
select set_config('t.meeting', gen_random_uuid()::text, false) is not null as m \gset
do $$ begin
  if to_regclass('public.study_meetings') is not null then
    execute 'insert into public.study_meetings (id, group_id, day, starts_at, lecture_id, part_from, part_to)
             values ($1, $2, current_date - 3, now() - interval ''3 days'', ''f0000000-0000-4000-8000-000000000001'', 0, 1)'
      using current_setting('t.meeting')::uuid, current_setting('t.gid')::uuid;
  end if;
end $$;

-- The study day's start, and the fixtures' times around it:
--   old  = 9 days before, week = 3 days before, y = 2 days before, today = after it.
select study_private.pulse_cutoff(now()) as c0 \gset
select set_config('t.c0', :'c0', false) is not null as c \gset
create or replace function pg_temp.at(p_days numeric) returns timestamptz language sql as $$
  select current_setting('t.c0')::timestamptz + make_interval(secs => (p_days * 86400)::double precision) + interval '2 hours' $$;
create or replace function pg_temp.ans(p_user text, p_q int, p_choice int, p_conf int, p_at timestamptz, p_mode text default 'lecture')
returns void language sql as $$
  insert into public.study_answers (user_id, question_id, choice, correct, mode, ms, answered_at, confidence)
  select ('10000000-0000-4000-8000-0000000000' || p_user)::uuid, ('f1000000-0000-4000-8000-00000000000' || p_q)::uuid,
         p_choice, p_choice = k.answer, p_mode, 9000, p_at, p_conf
    from public.study_question_keys k where k.question_id = ('f1000000-0000-4000-8000-00000000000' || p_q)::uuid $$;
create or replace function pg_temp.rev(p_user text, p_card int, p_rating int, p_before int, p_at timestamptz)
returns void language sql as $$
  insert into public.study_card_reviews (id, user_id, card_id, rating, reviewed_at, elapsed_days, state_before, state_after,
                                         stability, difficulty, due)
  values (gen_random_uuid(), ('10000000-0000-4000-8000-0000000000' || p_user)::uuid,
          ('f2000000-0000-4000-8000-00000000000' || p_card)::uuid, p_rating, p_at, 3, p_before,
          case when p_rating = 1 then 3 else 2 end, 4.2, 5.1, p_at + interval '1 day') $$;
create or replace function pg_temp.tap(p_user text, p_part int, p_anchor int, p_at timestamptz) returns void language sql as $$
  insert into public.study_meeting_taps (meeting_id, user_id, lecture_id, part_idx, anchor, created_at)
  values (current_setting('t.meeting')::uuid, ('10000000-0000-4000-8000-0000000000' || p_user)::uuid,
          'f0000000-0000-4000-8000-000000000001', p_part, p_anchor, p_at) $$;

-- a1 שוהם · a2 נועה · a3 מאיה · a4 איתי · a5 דניאל · a6 רוני (out of the pulse)
-- q1 Primaquine: four of five counted wrong this week (option 2), Roni too.
select pg_temp.ans('a1', 1, 2, 2, pg_temp.at(-3)), pg_temp.ans('a2', 1, 2, 3, pg_temp.at(-3)), pg_temp.ans('a3', 1, 2, 1, pg_temp.at(-3)),
       pg_temp.ans('a4', 1, 2, 2, pg_temp.at(-3)), pg_temp.ans('a5', 1, 1, 3, pg_temp.at(-3)), pg_temp.ans('a6', 1, 2, 3, pg_temp.at(-3));
-- q2 Primaquine: three of four wrong this week.
select pg_temp.ans('a1', 2, 1, 2, pg_temp.at(-3)), pg_temp.ans('a2', 2, 1, 2, pg_temp.at(-3)), pg_temp.ans('a3', 2, 3, 2, pg_temp.at(-3)),
       pg_temp.ans('a5', 2, 0, 2, pg_temp.at(-3));
-- q5 Quinine: four of five wrong "על בטוח" on option 0 ("מניעת מלריה"), Roni too.
select pg_temp.ans('a1', 5, 0, 3, pg_temp.at(-2)), pg_temp.ans('a2', 5, 0, 3, pg_temp.at(-2)), pg_temp.ans('a3', 5, 0, 3, pg_temp.at(-2)),
       pg_temp.ans('a4', 5, 0, 3, pg_temp.at(-2)), pg_temp.ans('a5', 5, 3, 2, pg_temp.at(-2)), pg_temp.ans('a6', 5, 0, 3, pg_temp.at(-2));
-- q3 Miltefosine: split, 9 days ago.
select pg_temp.ans('a1', 3, 2, 2, pg_temp.at(-9)), pg_temp.ans('a2', 3, 0, 2, pg_temp.at(-9)), pg_temp.ans('a3', 3, 2, 2, pg_temp.at(-9)),
       pg_temp.ans('a4', 3, 4, 2, pg_temp.at(-9));
-- q4 Metronidazole: right this week; three wrong today (after the cut-off).
select pg_temp.ans('a1', 4, 0, 2, pg_temp.at(-3)), pg_temp.ans('a2', 4, 0, 2, pg_temp.at(-3)), pg_temp.ans('a3', 4, 0, 2, pg_temp.at(-3)),
       pg_temp.ans('a4', 4, 0, 2, pg_temp.at(-3));
select pg_temp.ans('a2', 4, 2, 3, pg_temp.at(0) - interval '90 minutes'), pg_temp.ans('a3', 4, 2, 3, pg_temp.at(0) - interval '90 minutes'),
       pg_temp.ans('a4', 4, 2, 3, pg_temp.at(0) - interval '90 minutes');
-- q6 Luminal: three wrong 9 days ago, right 3 days ago (a hole that closed this week).
select pg_temp.ans('a1', 6, 1, 2, pg_temp.at(-9)), pg_temp.ans('a2', 6, 1, 2, pg_temp.at(-9)), pg_temp.ans('a3', 6, 1, 2, pg_temp.at(-9));
select pg_temp.ans('a1', 6, 0, 2, pg_temp.at(-3)), pg_temp.ans('a2', 6, 0, 2, pg_temp.at(-3)), pg_temp.ans('a3', 6, 0, 2, pg_temp.at(-3));
-- q7 Chloroquine: two counted members and Roni wrong. q8: flagged as wrong; four wrong.
select pg_temp.ans('a2', 7, 1, 2, pg_temp.at(-3)), pg_temp.ans('a3', 7, 1, 2, pg_temp.at(-3)), pg_temp.ans('a6', 7, 1, 2, pg_temp.at(-3));
select pg_temp.ans('a1', 8, 0, 2, pg_temp.at(-3)), pg_temp.ans('a2', 8, 0, 2, pg_temp.at(-3)), pg_temp.ans('a3', 8, 0, 2, pg_temp.at(-3)),
       pg_temp.ans('a4', 8, 0, 2, pg_temp.at(-3));
-- Cards: Miltefosine forgotten after learning by three; Metronidazole by two.
select pg_temp.rev('a1', 1, 1, 2, pg_temp.at(-3)), pg_temp.rev('a2', 1, 1, 2, pg_temp.at(-3)), pg_temp.rev('a3', 1, 1, 2, pg_temp.at(-3)),
       pg_temp.rev('a4', 1, 3, 2, pg_temp.at(-3));
select pg_temp.rev('a2', 3, 1, 2, pg_temp.at(-3)), pg_temp.rev('a5', 3, 1, 2, pg_temp.at(-3));
-- "לא ברור": three on part 0 ¶5; two and Roni on part 0 ¶6.
select pg_temp.tap('a1', 0, 5, pg_temp.at(-3)), pg_temp.tap('a2', 0, 5, pg_temp.at(-3)), pg_temp.tap('a3', 0, 5, pg_temp.at(-3));
select pg_temp.tap('a1', 0, 6, pg_temp.at(-3)), pg_temp.tap('a2', 0, 6, pg_temp.at(-3)), pg_temp.tap('a6', 0, 6, pg_temp.at(-3));
-- Roni opts out (his own row, through RLS).
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a6';
insert into public.study_pulse_optout (group_id) values (:'gid');
reset role;
\o

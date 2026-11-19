-- ════════════════════════════════════════════════════════════════════════
--  The server addendum's checks · fixtures of their own (a database of
--  their own, as the spec's identity.sql: they create a group). Six members
--  and a stranger, two lectures with written parts, placed questions with
--  keys, cards, and the server switched on (pg_net's stand-in records every
--  kick in net.calls). Time is simulated by moving rows into the past as the
--  owner, never by sleeping. Throwaway local Postgres only.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values
 ('study_worker_key', 'k-0123456789abcdef0123456789abcdef'),
 ('study_site_url', 'https://study.example.test')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
select set_config('t.key', 'k-0123456789abcdef0123456789abcdef', false) is not null as k \gset

-- שוהם (S), נועה (N), מאיה (M), איתי (I), דניאל (D), רוני (R), and a stranger (X).
insert into auth.users (id, raw_user_meta_data, is_anonymous) values
 ('a1000000-0000-4000-8000-000000000001', '{"app":"study","full_name":"שוהם"}', true),
 ('a1000000-0000-4000-8000-000000000002', '{"app":"study","full_name":"נועה"}', true),
 ('a1000000-0000-4000-8000-000000000003', '{"app":"study","full_name":"מאיה"}', true),
 ('a1000000-0000-4000-8000-000000000004', '{"app":"study","full_name":"איתי"}', true),
 ('a1000000-0000-4000-8000-000000000005', '{"app":"study","full_name":"דניאל"}', true),
 ('a1000000-0000-4000-8000-000000000006', '{"app":"study","full_name":"רוני"}', true),
 ('a1000000-0000-4000-8000-000000000009', '{"app":"study","full_name":"זר"}', true);
insert into public.study_groups (id, name, join_code, created_by) values
 ('a2000000-0000-4000-8000-000000000001', 'קבוצת שנה ג', 'SRVTST', 'a1000000-0000-4000-8000-000000000001');
insert into public.study_members (group_id, user_id, name)
select 'a2000000-0000-4000-8000-000000000001', u.id, u.raw_user_meta_data ->> 'full_name'
  from auth.users u where u.id::text like 'a1000000-%' and u.id <> 'a1000000-0000-4000-8000-000000000009';

-- L1: 40 slides in three written parts; slide 5 has a picture (fig:5-1).
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, status, created_by) values
 ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'פתוגן מאכסן', 'Anti parasite', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('מלריה ותרופות ', 20)),
                                       'tables', '[]'::jsonb, 'notes', '',
                                       'figures', case when n = 5 then '[{"k":1,"path":"g/l1/5-1.png","w":800,"h":600}]'::jsonb else '[]'::jsonb end)
            order by n) from generate_series(1, 40) n),
  'ready', 'a1000000-0000-4000-8000-000000000001');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
 ('a3000000-0000-4000-8000-000000000001', 0, 'מחזור החיים', 1, 12, 'ready', E'## מחזור החיים\n\nאף תרופה לא הורגת את ה-Sporozoite. [ש'' 3]\n\nה-Hypnozoite ישן בכבד. [ש'' 5]\n\nלפני Primaquine בודקים G6PD. [ש'' 7]'),
 ('a3000000-0000-4000-8000-000000000001', 1, 'מנגנונים', 13, 24, 'ready', E'## מנגנונים\n\nChloroquine מצטברת בוואקואולה. [ש'' 15]\n\nMefloquine ניתנת פעם בשבוע. [ש'' 20]'),
 ('a3000000-0000-4000-8000-000000000001', 2, 'שילובים', 25, 40, 'ready', E'## שילובים\n\nArtemisinins לעולם לא לבד. [ש'' 30]\n\nQuinine עם Doxycycline, לא בהיריון. [ש'' 33]');

-- Questions placed on paragraphs: Q01-Q05 on part 0 (Q01, Q02 share
-- paragraph 2), Q06 part 1, Q07 part 2 with option tags. Key = the index
-- in the last digit's table below.
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, anchor, quote, kind, question, options, slides, topic, aspect)
select ('a4000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'a2000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000001', 'ai',
       case when i <= 5 then 0 when i = 6 then 1 else 2 end,
       case i when 1 then 2 when 2 then 2 when 3 then 1 when 4 then 3 when 5 then 1 when 6 then 1 else 1 end,
       'פסקה', 'mcq', 'שאלה ' || i || '?',
       array['Sporozoite', 'Hypnozoite', 'Schizont', 'Gametocyte', 'Merozoite'],
       array[case when i <= 5 then 3 when i = 6 then 15 else 30 end],
       case when i <= 5 then 'Primaquine' when i = 6 then 'Chloroquine' else 'Artemisinin' end,
       case i when 1 then 'mechanism' when 2 then 'mechanism' when 3 then 'mechanism' when 4 then 'contra' when 5 then 'mechanism'
              when 6 then 'uses' else 'uses' end
  from generate_series(1, 7) i;
update public.study_questions set option_tags = array['Sporozoite', 'Hypnozoite', 'Schizont', 'Gametocyte', 'Merozoite']
 where id = 'a4000000-0000-4000-8000-000000000007';
insert into public.study_question_keys (question_id, answer, explanations, takeaway, whens)
select q.id, case right(q.id::text, 1) when '1' then 1 when '2' then 0 when '3' then 2 when '4' then 3 when '5' then 0 when '6' then 1 else 2 end,
       array['למה א [ש'' 3]', 'למה ב [ש'' 5]', 'למה ג [ש'' 7]', 'למה ד [ש'' 7]', 'למה ה [ש'' 3]'], 'מה לזכור [ש'' 3]',
       array['מתי כן: בשאלה על הכבד', '', 'מתי כן: falciparum', 'מתי כן: מניעה', 'מתי כן: שלב הדם']
  from public.study_questions q where q.id::text like 'a4000000-%';

-- Cards of L1: two on part 0 (one on paragraph 2), one on part 1, a trap card.
insert into public.study_cards (id, group_id, lecture_id, source, part_idx, anchor, kind, front, back, slides) values
 ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'ai', 0, 2, 'qa', 'למה Primaquine ב-vivax?', 'בגלל hypnozoites', array[5]),
 ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'ai', 0, 3, 'qa', 'מה בודקים לפני Primaquine?', 'G6PD', array[7]),
 ('a5000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'ai', 1, 1, 'qa', 'איפה Chloroquine מצטברת?', 'בוואקואולה', array[15]),
 ('a5000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'trap', 2, 1, 'qa', 'Artemisinins לבד?', 'לעולם לא', array[30]);

-- L2: the lecture whose summary is being written (the bank's checks): 20
-- slides with text, two parts, writing.
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, status, created_by) values
 ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'פתוגן מאכסן', 'Leishmaniasis', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array(repeat('Miltefosine טרטוגנית ', 6)),
                                       'tables', '[]'::jsonb, 'notes', '', 'figures', '[]'::jsonb) order by n) from generate_series(1, 20) n),
  'writing', 'a1000000-0000-4000-8000-000000000002');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
 ('a3000000-0000-4000-8000-000000000002', 0, 'המחלה', 1, 10, 'ready', E'## המחלה\n\nפסקה. [ש'' 2]'),
 ('a3000000-0000-4000-8000-000000000002', 1, 'טיפול', 11, 20, 'ready', E'## טיפול\n\nMiltefosine טרטוגנית. [ש'' 16]');

select set_config('t.g', 'a2000000-0000-4000-8000-000000000001', false) is not null as g \gset
select set_config('t.l1', 'a3000000-0000-4000-8000-000000000001', false) is not null as l \gset
select set_config('t.l2', 'a3000000-0000-4000-8000-000000000002', false) is not null as l \gset
\set g 'a2000000-0000-4000-8000-000000000001'
\set l1 'a3000000-0000-4000-8000-000000000001'
\set l2 'a3000000-0000-4000-8000-000000000002'
\set S 'a1000000-0000-4000-8000-000000000001'
\set N 'a1000000-0000-4000-8000-000000000002'
\set M 'a1000000-0000-4000-8000-000000000003'
\set I 'a1000000-0000-4000-8000-000000000004'
\set D 'a1000000-0000-4000-8000-000000000005'
\set R 'a1000000-0000-4000-8000-000000000006'
\set X 'a1000000-0000-4000-8000-000000000009'
select 'S0. fixtures: ' || (select count(*) from public.study_members where group_id = :'g') || ' members, '
       || (select count(*) from public.study_questions where lecture_id = :'l1') || ' questions, '
       || (select count(*) from public.study_cards where lecture_id = :'l1') || ' cards (expect 6 members, 7 questions, 4 cards)';

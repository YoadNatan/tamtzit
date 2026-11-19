-- ════════════════════════════════════════════════════════════════════════
--  spec §12 · the review's checks (SR: the security review's findings, FR:
--  the feasibility review's), each finding's attack from critique/sec/probes
--  run again and expected to be refused. A database of its own (it creates
--  groups). Fixtures from the security review's probes/00-fixtures.sql, with
--  saved accounts that joined weeks ago (section U counts people, not ids),
--  a second device of Noa's that never saved an account, a stranger.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', 'k-0123456789abcdef0123456789abcdef')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_site_url', 'http://localhost')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
\set key 'k-0123456789abcdef0123456789abcdef'
\set gid 'aaaaaaaa-0000-4000-8000-00000000000a'
\set l1 '22222222-0000-4000-8000-000000000001'
insert into auth.users (id, raw_user_meta_data, is_anonymous) values
 ('11111111-0000-4000-8000-000000000001', '{"app":"study","full_name":"שוהם"}', false),
 ('11111111-0000-4000-8000-000000000002', '{"app":"study","full_name":"נועה"}', false),
 ('11111111-0000-4000-8000-000000000003', '{"app":"study","full_name":"מאיה"}', false),
 ('11111111-0000-4000-8000-000000000004', '{"app":"study","full_name":"איתי"}', false),
 ('11111111-0000-4000-8000-000000000005', '{"app":"study","full_name":"דניאל"}', false),
 ('11111111-0000-4000-8000-000000000006', '{"app":"study","full_name":"רוני"}', false),
 ('11111111-0000-4000-8000-000000000012', '{"app":"study","full_name":"נועה מחשב"}', true),
 ('99999999-0000-4000-8000-000000000009', '{"app":"study","full_name":"זרה"}', true);
insert into public.study_groups (id, name, join_code, created_by) values
 ('aaaaaaaa-0000-4000-8000-00000000000a', 'קבוצה', 'ABCDEF', '11111111-0000-4000-8000-000000000001'),
 ('bbbbbbbb-0000-4000-8000-00000000000b', 'של הזרה', 'ZZZZZZ', '99999999-0000-4000-8000-000000000009');
insert into public.study_members (group_id, user_id, name, joined_at) values
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000001', 'שוהם', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000002', 'נועה', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000003', 'מאיה', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000004', 'איתי', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000005', 'דניאל', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000006', 'רוני', now() - interval '60 days'),
 ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000012', 'נועה מחשב', now() - interval '60 days'),
 ('bbbbbbbb-0000-4000-8000-00000000000b', '99999999-0000-4000-8000-000000000009', 'זרה', now() - interval '60 days');
insert into public.study_lectures (id, group_id, course, title, source_kind, slides, status, created_by) values
 ('22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'פתוגן מאכסן', 'מלריה', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array('טקסט ' || n))) from generate_series(1, 40) n),
  'ready', '11111111-0000-4000-8000-000000000001'),
 ('22222222-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-00000000000a', 'פתוגן מאכסן', 'לישמניה', 'pptx',
  (select jsonb_agg(jsonb_build_object('n', n, 'title', 'שקף ' || n, 'lines', jsonb_build_array('טקסט ' || n))) from generate_series(1, 20) n),
  'ready', '11111111-0000-4000-8000-000000000001');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
 ('22222222-0000-4000-8000-000000000001', 0, 'מחזור החיים', 1, 12, 'ready',
  E'## מחזור החיים\n\nאף תרופה לא הורגת את ה-Sporozoite. [ש'' 3]\n\nה-Hypnozoite ישן בכבד. [ש'' 5]\n\nלפני Primaquine בודקים G6PD. [ש'' 7]'),
 ('22222222-0000-4000-8000-000000000001', 1, 'מנגנונים', 13, 24, 'ready',
  E'## מנגנונים\n\nChloroquine מצטברת בוואקואולה. [ש'' 15]\n\nMefloquine ניתנת פעם בשבוע. [ש'' 20]'),
 ('22222222-0000-4000-8000-000000000001', 2, 'שילובים', 25, 40, 'ready',
  E'## שילובים\n\nArtemisinins לעולם לא לבד. [ש'' 30]\n\nQuinine עם Doxycycline, לא בהיריון. [ש'' 33]'),
 ('22222222-0000-4000-8000-000000000002', 0, 'טיפול', 1, 20, 'ready',
  E'## טיפול\n\nMiltefosine טרטוגנית. [ש'' 16]');
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, anchor, quote, part_gen, kind, question, options, slides, topic, aspect, teaser)
select ('33333333-0000-4000-8000-00000000000' || n)::uuid, 'aaaaaaaa-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000001', 'ai',
       (n - 1) / 3, 1 + (n - 1) % 3, 'פסקה ' || n, 0, 'mcq', 'שאלה ' || n || '?', array['א','ב','ג','ד','ה'], array[3 * n],
       case when n <= 4 then 'Primaquine' else 'Chloroquine' end, case when n % 2 = 0 then 'contra' else 'uses' end, ''
  from generate_series(1, 8) n;
insert into public.study_question_keys (question_id, answer, explanations, takeaway)
select q.id, 0, array['נכון [ש'' 3]', 'לא [ש'' 5]', 'לא [ש'' 7]', 'לא', 'לא'], 'מה לזכור'
  from public.study_questions q where q.lecture_id = '22222222-0000-4000-8000-000000000001';
insert into public.study_cards (id, group_id, lecture_id, source, part_idx, anchor, quote, part_gen, kind, front, back, slides) values
 ('44444444-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000001', 'ai', 0, 2, 'ה-Hypnozoite ישן', 0, 'qa', 'למה צריך גם Primaquine ב-vivax?', 'בגלל hypnozoites', array[5]),
 ('44444444-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000001', 'ai', 1, 1, 'Chloroquine מצטברת', 0, 'qa', 'איפה Chloroquine פועלת?', 'בוואקואולה', array[15]);

-- ── helpers (the owner's; members call them only through rv.raises) ──
create schema if not exists rv;
create or replace function rv.expect(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then raise notice '%. ok: %', p_label, coalesce(nullif(p_got, ''), '(empty)');
  else raise notice '%. FAIL: % (expect %)', p_label, coalesce(p_got, 'null'), p_want; end if;
end $$;
-- Runs p_sql as the caller and expects it to raise exactly p_want.
create or replace function rv.raises(p_label text, p_sql text, p_want text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice '%. FAIL: it ran (expect "%")', p_label, p_want;
exception when others then
  if sqlerrm = p_want then raise notice '%. ok: refused (%)', p_label, sqlerrm;
  else raise notice '%. FAIL: % (expect "%")', p_label, sqlerrm, p_want; end if;
end $$;
create or replace function rv.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false) $$;
-- Moves the open round of a quiz p_secs into the past (the clock runs).
create or replace function rv.shift(p_quiz uuid, p_secs numeric) returns void language sql security definer as $$
  update public.study_quiz_rounds set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                      closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where quiz_id = p_quiz and opens_at is not null and revealed_at is null;
  update public.study_quizzes set opens_at = opens_at - make_interval(secs => p_secs::double precision),
                                  closes_at = closes_at - make_interval(secs => p_secs::double precision)
   where id = p_quiz;
$$;
create or replace function rv.q_now(p_quiz uuid) returns uuid language sql security definer as $$
  select r.question_id from public.study_quizzes z join public.study_quiz_rounds r on r.quiz_id = z.id and r.idx = z.idx where z.id = p_quiz $$;
grant usage on schema rv to authenticated, anon;
grant execute on all functions in schema rv to authenticated, anon;
\echo '== review fixtures loaded'

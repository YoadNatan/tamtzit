#!/usr/bin/env bash
# Z-2 (spec §7.Z) and ZA-5 (§12.3.Z): six phones at once on one quiz, as six
# psql sessions on a throwaway local Postgres (never the real project).
#   K1  six players answer the same round of a race in the same instant: all
#       six kept, one reveal, six private copies;
#   K2  after the deadline six phones ask for the reveal in the same instant:
#       one reveal, one version step;
#   K3  a group quiz split 3 to 3 argues, then six players send vote 2 in the
#       same instant: one final reveal, six first votes copied to the private
#       record with their bets, none of vote 2.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/quiz-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=quiz_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }

# Setup (as the owner): a group of six, a lecture with three keyed questions
# (the key is option 1 of four), a race all six play, round 0 open for 5 s.
QZ=$(q <<'SQL' | grep -oE '[0-9a-f-]{36}' | tail -1
\set ON_ERROR_STOP 1
insert into auth.users (id, raw_user_meta_data)
select ('a0000000-0000-4000-8000-00000000000' || i)::uuid, jsonb_build_object('app', 'study', 'full_name', 'p' || i)
  from generate_series(1, 6) i;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select id as gid, join_code as code from public.study_create_group('שש', 'p1') \gset
insert into public.study_lectures (id, group_id, title, source_kind, slides)
values ('eeeeeeee-0000-4000-8000-000000000001', :'gid', 'L', 'pptx', '[{"n":1}]');
select set_config('c.code', :'code', false) is not null as c \gset
do $$ declare i int; begin
  for i in 2..6 loop
    perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000' || i, false);
    perform public.study_join(current_setting('c.code'), 'p' || i);
  end loop;
end $$;
reset role;
insert into public.study_questions (id, group_id, lecture_id, source, part_idx, kind, question, options, slides)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, :'gid', 'eeeeeeee-0000-4000-8000-000000000001', 'ai', 0, 'mcq',
       'שאלה ' || i || '?', array['a', 'b', 'c', 'd'], array[1] from generate_series(1, 3) i;
insert into public.study_question_keys (question_id, answer, explanations)
select ('99999999-0000-4000-8000-00000000000' || i)::uuid, 1, array['1', '2', '3', '4'] from generate_series(1, 3) i;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select public.study_quiz_create(:'gid', 'race', array['eeeeeeee-0000-4000-8000-000000000001']::uuid[], 3, 20) as qz \gset
do $$ declare i int; begin
  for i in 2..6 loop
    perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000' || i, false);
    perform public.study_quiz_join((select id from public.study_quizzes where state = 'lobby'));
  end loop;
end $$;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select public.study_quiz_next(:'qz', -1) is null as n \gset
reset role;
update public.study_quiz_rounds set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where quiz_id = :'qz' and idx = 0;
update public.study_quizzes set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where id = :'qz';
select :'qz';
SQL
)
echo "race $QZ"
one() { # $1 = player number, $2 = SQL
  su postgres -c "psql -X -q -tA -d $DB" <<SQL
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000$1';
$2
SQL
}

# K1: odd players answer the key (option 1), even players option 0; nobody sends a bet (ניחוש).
for i in 1 2 3 4 5 6; do (one $i "select 'answer p$i: option ' || choice || ', ' || ms || ' ms, vote ' || vote || ', bet ' || coalesce(bet::text, 'none') from public.study_quiz_answer('$QZ', 0, $(( i % 2 )));") & done; wait
q <<SQL
select 'K1. answers ' || (select count(*) from study_quiz_answers) || ', state ' || state || ', version ' || version
       || ', private copies ' || (select count(*) from study_answers where mode = 'quiz') || ' (expect 6, reveal, 8, 6)' from study_quizzes where id = '$QZ';
select 'K1b. scores by player: ' || string_agg(score::text, ',' order by user_id) || ' (expect 1,0,1,0,1,0: a right answer with no bet counts as ניחוש, +1; decision 2)'
  from study_quiz_players where quiz_id = '$QZ';
SQL

# K2: the next round's deadline passes with nobody revealing it; six phones ask at once.
one 1 "select public.study_quiz_next('$QZ', 0);" >/dev/null
q <<SQL >/dev/null
update study_quiz_rounds set opens_at = opens_at - interval '60 seconds', closes_at = closes_at - interval '60 seconds' where quiz_id = '$QZ' and idx = 1;
update study_quizzes set opens_at = opens_at - interval '60 seconds', closes_at = closes_at - interval '60 seconds' where id = '$QZ';
SQL
for i in 1 2 3 4 5 6; do (one $i "select public.study_quiz_reveal('$QZ', 1); select public.study_quiz_state('$QZ') is not null;" >/dev/null) & done; wait
q <<SQL
select 'K2. after six reveals at once: state ' || state || ', version ' || version || ', rounds revealed ' ||
       (select count(*) from study_quiz_rounds where quiz_id = '$QZ' and revealed_at is not null)
       || ' (expect reveal, 10, 2: one reveal, one version step after the next)' from study_quizzes where id = '$QZ';
SQL
one 1 "select public.study_quiz_end('$QZ');" >/dev/null

# K3: a group quiz of six. Vote 1: p1-p3 right with a bet, p4-p6 wrong (3 of 6, 50%): the group argues.
CQ=$(one 1 "select public.study_quiz_create((select id from public.study_groups limit 1), 'coop', array['eeeeeeee-0000-4000-8000-000000000001']::uuid[], 3, 30);" | grep -oE '[0-9a-f-]{36}' | tail -1)
for i in 2 3 4 5 6; do one $i "select public.study_quiz_join('$CQ');" >/dev/null; done
one 1 "select public.study_quiz_next('$CQ', -1);" >/dev/null
q <<SQL >/dev/null
update study_quiz_rounds set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where quiz_id = '$CQ' and idx = 0;
update study_quizzes set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where id = '$CQ';
SQL
for i in 1 2 3 4 5 6; do one $i "select public.study_quiz_answer('$CQ', 0, $(( i <= 3 ? 1 : 0 )), $(( i <= 3 ? 3 : 2 )));" >/dev/null; done
q <<SQL
select 'K3a. vote 1, 3 of 6 right: state ' || state || ', stage ' || stage || ', private copies so far ' ||
       (select count(*) from study_answers a join study_quiz_rounds r on r.question_id = a.question_id and r.quiz_id = '$CQ' and r.idx = 0 where a.mode = 'quiz'
          and a.answered_at >= (select created_at from study_quizzes where id = '$CQ'))
       || ' (expect reveal, argue, 0)' from study_quizzes where id = '$CQ';
SQL
one 1 "select public.study_quiz_next('$CQ', 0);" >/dev/null
q <<SQL >/dev/null
update study_quiz_rounds set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where quiz_id = '$CQ' and idx = 0;
update study_quizzes set opens_at = opens_at - interval '5 seconds', closes_at = closes_at - interval '5 seconds' where id = '$CQ';
SQL
V=$(q <<SQL
select version from study_quizzes where id = '$CQ';
SQL
)
# Vote 2: all six on the key, in the same instant (no bet in vote 2).
for i in 1 2 3 4 5 6; do (one $i "select 'vote 2 p$i: option ' || choice || ', vote ' || vote || ', bet ' || coalesce(bet::text, 'none') from public.study_quiz_answer('$CQ', 0, 1, null, 2);") & done; wait
q <<SQL
select 'K3. after six vote-2 answers at once: state ' || z.state || ', stage ' || z.stage || ', next step ' || r.next_step
       || ', version moved ' || (z.version - $V) || ', vote-2 answers ' || (select count(*) from study_quiz_answers a where a.round_id = r.id and a.vote = 2)
       || ' (expect reveal, final, explain, 1: one reveal, 6)'
  from study_quizzes z join study_quiz_rounds r on r.quiz_id = z.id and r.idx = 0 where z.id = '$CQ';
select 'K3b. the private record: ' || count(*) || ' copies, with bets ' || string_agg(coalesce(a.confidence::text, '-'), ',' order by a.user_id)
       || ', right ' || count(*) filter (where a.correct) || ' (expect 6 copies, all first votes: 3,3,3,2,2,2 and 3 right; none of vote 2)'
  from study_answers a join study_quiz_rounds r on r.question_id = a.question_id and r.quiz_id = '$CQ' and r.idx = 0
 where a.mode = 'quiz' and a.answered_at >= (select created_at from study_quizzes where id = '$CQ');
select 'K3c. the bets'' points: ' || string_agg(a.points::text, ',' order by a.user_id) || ' (expect 3,3,3,-2,-2,-2)'
  from study_quiz_answers a join study_quiz_rounds r on r.id = a.round_id and r.quiz_id = '$CQ' and r.idx = 0 where a.vote = 1;
SQL
echo "dropping $DB"

#!/usr/bin/env bash
# S 2 (docs/study/sources.md B6.2): the read units of one exam run side by
# side (the sweeper kicks up to three), as psql sessions at once on a
# throwaway local Postgres (never the real project).
#   EX1  two units save the same question number in the same instant (a
#        question split over their pages, or a misread number): both saves
#        go through, one row for the number, the whole copy kept;
#   EX2  six units save six different numbers at once: six rows.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/exam-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=exam_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }
KEY=k-0123456789abcdef0123456789abcdef
G=eeeeeeee-0000-4000-8000-0000000000e1
E=eeeeeeee-0000-4000-8000-0000000000e2
U=a0000000-0000-4000-8000-000000000001

# Setup (as the owner): a group, an exam being read, eight read units each
# holding a lease (their ids and leases are fixed: unit k, lease k).
q <<SQL >/dev/null
insert into auth.users (id, raw_user_meta_data) values ('$U', '{"app":"study","full_name":"p1"}');
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
insert into public.study_groups (id, name, join_code, created_by) values ('$G', 'קבוצה', 'EXAMC1', '$U');
insert into public.study_members (group_id, user_id, name) values ('$G', '$U', 'p1') on conflict do nothing;
update study_private.features set enabled = true where name = 'exams';
insert into public.study_exams (id, group_id, course, title, key_source, status, created_by)
values ('$E', '$G', 'קורס', 'מועד א׳ 2025', 'marked', 'reading', '$U');
insert into study_private.exam_jobs (id, group_id, exam_id, kind, range, status, lease_id, lease_until, attempts)
select ('cccccccc-0000-4000-8000-00000000000' || k)::uuid, '$G', '$E', 'read',
       jsonb_build_object('pages', jsonb_build_array(k * 4 - 3, k * 4 - 2, k * 4 - 1, k * 4), 'next', k * 4 + 1),
       'running', ('dddddddd-0000-4000-8000-00000000000' || k)::uuid, now() + interval '5 minutes', 1
  from generate_series(1, 8) k;
SQL
worker() { # $1 = SQL (the server writer: no token, the key)
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1
set role anon; reset request.jwt.claim.sub;
$1
SQL
}
item() { # $1 = number, $2 = page, $3 = question
  echo "{\"no\":$1,\"form\":\"one\",\"question\":\"$3\",\"options\":[\"אפשרות א\",\"אפשרות ב\"],\"answer\":-1,\"seq\":[],\"figure\":\"\",\"parse_conf\":3,\"page\":$2}"
}

# EX1: units 1 (pages 1-4) and 2 (pages 5-8) both save number 5 at once. Each
# save's transaction stays open half a second after the call, so both start
# before either commits. Unit 1 has the whole question (it starts on page 4).
A=$(item 5 4 "שאלה חמש, כולה, מעמוד 4 לעמוד 5 (synthetic)")
B=$(item 5 5 "המשך שאלה 5 (synthetic)")
OUT=$( (worker "begin; select (r ->> 'saved') || '+' || (r ->> 'updated') from public.study_exam_save_items('cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', '[$A]', 0, '$KEY') r; select pg_sleep(0.5) is null as slept \\gset
commit;") &
       (worker "begin; select (r ->> 'saved') || '+' || (r ->> 'updated') from public.study_exam_save_items('cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002', '[$B]', 0, '$KEY') r; select pg_sleep(0.5) is null as slept \\gset
commit;") & wait )
q <<SQL
select 'EX1. two saves of number 5 at once answered: ' || '$(echo "$OUT" | sort | tr '\n' ';')' || ' rows ' || count(*)
       || ', kept: ' || min(split_part(question, ' ', 2)) || ' (expect 0+1;1+0; with no error; rows 1, kept: חמש,)'
  from public.study_questions where exam_id = '$E' and exam_no = 5;
SQL

# EX2: six units at once, each with a number of its own.
OUT=$( for k in 3 4 5 6 7 8; do (worker "select (r ->> 'saved') from public.study_exam_save_items('cccccccc-0000-4000-8000-00000000000$k', 'dddddddd-0000-4000-8000-00000000000$k', '[$(item $((k * 10)) $((k * 4 - 3)) "שאלה $k של EX2 (synthetic)")]', 0, '$KEY') r;") & done; wait )
q <<SQL
select 'EX2. six saves at once answered: ' || '$(echo "$OUT" | sort | uniq -c | tr -s ' ' | tr '\n' ';')' || ' rows ' || count(*)
       || ' (expect 6 1; rows 6)'
  from public.study_questions where exam_id = '$E' and exam_no >= 30;
SQL
echo "dropping $DB"

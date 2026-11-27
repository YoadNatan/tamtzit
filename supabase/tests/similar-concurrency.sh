#!/usr/bin/env bash
# Section O 3 (similar questions, docs/study/sheets.md): taps at once, as
# psql sessions on a throwaway local Postgres (never the real project).
#   SC1  four members' "ליצור 2 כמוה" on the same item in the same instant
#        (study_similar_begin, scope item, each with a reservation of its
#        own), 10 rounds: one run, and the three others join it (one lock a
#        sheet decides; nobody pays twice).
#   SC2  an item's tap and the whole sheet's tap on one sheet in the same
#        instant, 10 rounds: both answer, no deadlock (both take the
#        sheet's lock first, then the group's budget lock), and at most one
#        run of the whole sheet.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/similar-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=similar_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }

KEY=k-0123456789abcdef0123456789abcdef
G=5c000000-0000-4000-8000-0000000000a1
U1=5c000000-0000-4000-8000-000000000001
U2=5c000000-0000-4000-8000-000000000002
U3=5c000000-0000-4000-8000-000000000003
U4=5c000000-0000-4000-8000-000000000004

# Setup (as the owner): four members, the switches on, the server key.
q <<SQL >/dev/null
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
insert into auth.users (id, raw_user_meta_data) values
  ('$U1', '{"app":"study","full_name":"p1"}'), ('$U2', '{"app":"study","full_name":"p2"}'),
  ('$U3', '{"app":"study","full_name":"p3"}'), ('$U4', '{"app":"study","full_name":"p4"}');
insert into public.study_groups (id, name, join_code, created_by) values ('$G', 'דומות במקביל', 'SIMCO1', '$U1');
insert into public.study_members (group_id, user_id, name) values ('$G', '$U1', 'p1'), ('$G', '$U2', 'p2'), ('$G', '$U3', 'p3'), ('$G', '$U4', 'p4')
on conflict do nothing;
update study_private.features set enabled = true where name in ('exams', 'sheets', 'similar');
SQL

# A fresh ready sheet of two keyed one-answer items for round \$1; prints its id and its first item's.
sheet() {
  q <<SQL | grep -oE '[0-9a-f-]{36}' | tr '\n' ' '
with e as (insert into public.study_exams (group_id, course, title, status, kind, key_source, created_by)
           values ('$G', 'קורס', 'דף $1 (synthetic)', 'ready', 'sheet', 'separate', '$U1') returning id),
     q as (insert into public.study_questions (group_id, exam_id, exam_no, no_label, no_key, source, kind, question, options, form, has_key, created_by)
           select '$G', e.id, 100 + n, n::text, n::text, 'exam', 'mcq', 'שאלה ' || n || ' (synthetic)', array['א', 'ב', 'ג'], 'one', true, '$U1'
             from e, generate_series(1, 2) n returning id, exam_no),
     k as (insert into public.study_question_keys (question_id, answer, key_origin) select id, 0, 'sheet' from q returning question_id)
select (select id from e), (select id from q order by exam_no limit 1);
SQL
}
# A member's reservation of kind similar (ref ask), as the op makes it.
reserve() { # $1 = member
  q <<SQL | tail -1
set role authenticated; set request.jwt.claim.sub = '$1';
select public.study_reserve('$G', null, 'similar', 'ask', 0.30, 33, 0.8, 0.4, 100, 'ask', '$KEY');
SQL
}
begin_as() { # $1 = member, $2 = sheet, $3 = scope, $4 = item or null, $5 = reservation
  local items="null"
  [ "$4" = null ] || items="array['$4']::uuid[]"
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1 | tr '\n' ' '
set role authenticated; set request.jwt.claim.sub = '$1';
select coalesce(r ->> 'joined', '') || '|' || coalesce(r ->> 'run_id', '')
  from public.study_similar_begin('$2', $items, '$3', 2, $5, 0.30, 1000, null, null, '$KEY') r;
SQL
}

# SC1
ok1=0
for round in $(seq 1 10); do
  read -r E Q <<<"$(sheet "sc1-$round")"
  R1=$(reserve $U1); R2=$(reserve $U2); R3=$(reserve $U3); R4=$(reserve $U4)
  OUT=$( (begin_as $U1 "$E" item "$Q" "$R1"; echo) & (begin_as $U2 "$E" item "$Q" "$R2"; echo) & (begin_as $U3 "$E" item "$Q" "$R3"; echo) & (begin_as $U4 "$E" item "$Q" "$R4"; echo) & wait )
  RUNS=$(echo "select count(*) from public.study_similar_runs where exam_id = '$E';" | q)
  # Counted by pattern, not by line: two sessions' answers can land on one line of the joined output.
  MADE=$(echo "$OUT" | grep -oE '\|[0-9a-f-]{36}' | wc -l)
  JOINED=$(echo "$OUT" | grep -oE '[0-9a-f-]{36}\|' | wc -l)
  ERR=$(echo "$OUT" | grep -ci 'error\|deadlock' || true)
  if [ "$RUNS" = 1 ] && [ "$MADE" = 1 ] && [ "$JOINED" = 3 ] && [ "$ERR" = 0 ]; then ok1=$((ok1 + 1)); else echo "SC1 round $round: runs $RUNS made $MADE joined $JOINED errors $ERR: $OUT"; fi
done
echo "SC1. $( [ $ok1 = 10 ] && echo ok || echo FAIL ): four taps on one item at once, 10 rounds: $ok1 of 10 with one run and three joined, no error (expect 10)"

# SC2
ok2=0
for round in $(seq 1 10); do
  read -r E Q <<<"$(sheet "sc2-$round")"
  R1=$(reserve $U1); R2=$(reserve $U2)
  OUT=$( (begin_as $U1 "$E" item "$Q" "$R1"; echo) & (begin_as $U2 "$E" sheet null "$R2"; echo) & wait )
  SHEETS=$(echo "select count(*) from public.study_similar_runs where exam_id = '$E' and scope = 'sheet';" | q)
  ANSWERED=$(echo "$OUT" | grep -c '|' || true)
  ERR=$(echo "$OUT" | grep -ci 'deadlock\|ERROR' || true)
  if [ "$ANSWERED" = 2 ] && [ "$ERR" = 0 ] && [ "$SHEETS" -le 1 ]; then ok2=$((ok2 + 1)); else echo "SC2 round $round: answered $ANSWERED errors $ERR sheet runs $SHEETS: $OUT"; fi
done
echo "SC2. $( [ $ok2 = 10 ] && echo ok || echo FAIL ): an item's tap and the whole sheet's at once, 10 rounds: $ok2 of 10 answered both, no deadlock (expect 10)"
echo "dropping $DB"

#!/usr/bin/env bash
# Section L (practice sets, design-practice §7.3 and §14): two phones at once.
# psql sessions on a throwaway local Postgres (never the real project):
#   S1  "להוסיף הכול" (study_draft_keep_all, a member) and auto-keep
#       (study_qset_autokeep, the op with the server key, the switch on) on
#       the same request in the same instant, 50 rounds of fresh drafts: no
#       deadlock (both take the lecture's round lock before a draft row, as
#       keep does) and no draft kept twice: one bank question and one set
#       item per draft.
#   S2  two members' "ליצור" (study_qset_begin, no force) on one lecture in
#       the same instant, 10 rounds: one set, and the other is answered with
#       that open set (D6).
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/qsets-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=qsets_conc_$$
TMP=$(mktemp -d)
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
chmod 777 "$TMP"
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }

KEY=k-0123456789abcdef0123456789abcdef
A=3a000000-0000-4000-8000-000000000001
B=3a000000-0000-4000-8000-000000000002
G=3a000000-0000-4000-8000-0000000000a1
L=3a000000-0000-4000-8000-0000000000b1

# Setup (as the owner): two members, a lecture with one part, the server
# key, auto-keep on, and Aviv's set with its request (one batch of 3).
RQ=$(q <<SQL | grep -oE '[0-9a-f-]{36}' | tail -1
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY');
insert into auth.users (id, raw_user_meta_data) values
  ('$A', '{"app":"study","full_name":"a"}'), ('$B', '{"app":"study","full_name":"b"}');
insert into public.study_groups (id, name, join_code, created_by) values ('$G', 'סטים במקביל', 'QSCON1', '$A');
insert into public.study_members (group_id, user_id, name) values ('$G', '$A', 'אביב'), ('$G', '$B', 'ברק');
insert into public.study_lectures (id, group_id, title, source_kind, slides, status, created_by)
select ('3a000000-0000-4000-8000-0000000000' || lpad(to_hex(176 + n), 2, '0'))::uuid, '$G', 'הרצאה בדויה ' || n, 'pptx', '[]', 'ready', '$A'
  from generate_series(1, 11) n;
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown)
select l.id, 0, 'חלק א', 1, 8, 'ready', '## חלק א' from public.study_lectures l where l.group_id = '$G';
update study_private.features set enabled = true where name = 'qsets_auto_keep';
set role authenticated;
set request.jwt.claim.sub = '$A';
select public.study_qset_begin('$L', '{"want":3}', null, false, null, null, '$KEY') ->> 'set_id' as s \gset
select request_id from public.study_qset_attach(:'s', '{"level":"custom","count":3,"parts":[0],"styles":["case"],"difficulty":"exam"}',
  '[{"part_idx":0,"seq":0,"wanted":3,"points":[],"styles":["case","case","case"]}]', '$KEY') limit 1;
SQL
)
[ -n "$RQ" ] || { echo "S0. FAIL: no set request"; exit 1; }

# S1: each round adds two drafts the solver passed, then keep all and auto-keep race.
fails=0
for r in $(seq 1 50); do
  IDS=$(q <<SQL | grep -oE '[0-9a-f-]{36}' | paste -sd, -
with d as (
  insert into public.study_question_drafts (group_id, lecture_id, request_id, part_idx, style, kind, question, options, check_state, created_by)
  select '$G', '$L', '$RQ', 0, 'case', 'mcq', 'שאלה בדויה ' || $r || '-' || n, array['א', 'ב', 'ג'], 'ok', '$A' from generate_series(1, 2) n
  returning id)
, k as (insert into public.study_question_draft_keys (draft_id, answer, explanations) select id, 0, array['x', 'y', 'z'] from d returning draft_id)
select draft_id from k;
SQL
)
  echo "set role authenticated; set request.jwt.claim.sub = '$B'; select count(*) from public.study_draft_keep_all('$RQ');" > "$TMP/a.sql"
  echo "set role authenticated; set request.jwt.claim.sub = '$A'; select count(*) from public.study_qset_autokeep('{$IDS}'::uuid[], '$KEY');" > "$TMP/b.sql"
  chmod 644 "$TMP/a.sql" "$TMP/b.sql"
  su postgres -c "psql -X -q -tA -d $DB -f $TMP/a.sql" > "$TMP/a.out" 2>&1 &
  P1=$!
  su postgres -c "psql -X -q -tA -d $DB -f $TMP/b.sql" > "$TMP/b.out" 2>&1 &
  P2=$!
  wait $P1 $P2 || true
  if grep -qiE 'deadlock|error' "$TMP/a.out" "$TMP/b.out"; then
    fails=$((fails + 1)); echo "round $r:"; cat "$TMP/a.out" "$TMP/b.out"
  fi
done
CHECK=$(q <<SQL
select count(*) filter (where d.status = 'kept') || ' ' || count(distinct d.question_id) || ' '
       || (select count(*) from public.study_questions x where x.request_id = '$RQ') || ' '
       || (select count(*) from public.study_qset_items i join public.study_qset_requests r on r.set_id = i.set_id where r.request_id = '$RQ')
  from public.study_question_drafts d where d.request_id = '$RQ';
SQL
)
AUTO=$(echo "select count(*) from public.study_qset_items where auto_kept_at is not null;" | q)
if [ "$fails" = 0 ] && [ "$CHECK" = "100 100 100 100" ]; then
  echo "S1. ok: 50 rounds of keep all against auto-keep: no deadlock, 100 drafts kept once each (100 questions, 100 set items; $AUTO by auto-keep)"
else
  echo "S1. FAIL: $fails rounds with an error; kept/questions/bank/items = $CHECK"
fi

# S2: two begins on one lecture in the same instant (lectures 2 to 11, one a round).
bad=0
for n in $(seq 2 11); do
  LN="3a000000-0000-4000-8000-0000000000$(printf '%02x' $((176 + n)))"
  echo "set role authenticated; set request.jwt.claim.sub = '$A'; select public.study_qset_begin('$LN', '{\"want\":3}', null, false, null, null, '$KEY');" > "$TMP/a.sql"
  echo "set role authenticated; set request.jwt.claim.sub = '$B'; select public.study_qset_begin('$LN', '{\"want\":3}', null, false, null, null, '$KEY');" > "$TMP/b.sql"
  su postgres -c "psql -X -q -tA -d $DB -f $TMP/a.sql" > "$TMP/a.out" 2>&1 &
  P1=$!
  su postgres -c "psql -X -q -tA -d $DB -f $TMP/b.sql" > "$TMP/b.out" 2>&1 &
  P2=$!
  wait $P1 $P2 || true
  SETS=$(echo "select count(*) from public.study_qsets where lecture_id = '$LN';" | q)
  OPEN=$(cat "$TMP/a.out" "$TMP/b.out" | grep -c '"open"' || true)
  MADE=$(cat "$TMP/a.out" "$TMP/b.out" | grep -c '^{"state": "making", "set_id"' || true)
  if [ "$SETS" != 1 ] || [ "$OPEN" != 1 ] || [ "$MADE" != 1 ]; then
    bad=$((bad + 1)); echo "lecture $n: sets=$SETS open=$OPEN made=$MADE"; cat "$TMP/a.out" "$TMP/b.out"
  fi
done
if [ "$bad" = 0 ]; then echo "S2. ok: 10 rounds of two begins at once on one lecture: one set each time, the other answered with it (D6)"
else echo "S2. FAIL: $bad rounds"; fi

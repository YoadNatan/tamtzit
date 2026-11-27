#!/usr/bin/env bash
# Section Y ("השוואת מודלים", docs/study/models.md): claims at once, as psql
# sessions on a throwaway local Postgres (never the real project).
#   LC1  two claims of the same answer (study_lab_claim, part answer) in the
#        same instant, 10 rounds: exactly one reservation, the other refused
#        "not waiting", one ledger row (a double tap or a second tab pays
#        once).
#   LC2  two claims of a run's AI score (part judge) at once, 10 rounds: one.
#   LC3  two retries of one timed-out answer at once, 10 rounds: one, and
#        the answer's tries at 1.
#   LC4  four answers of one run claimed at once (each its own slot), with
#        the month's comparison line room for three: three reservations and
#        one "lab_budget", 10 rounds (the line holds under the group's lock).
#   LC5  a run's slots claimed together (study_lab_claim_slots) from two
#        sessions at once, as two tabs resuming, 10 rounds: each slot claimed
#        once, the other session's answer naming them "not waiting", one
#        ledger row a slot.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/lab-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=lab_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }

KEY=k-0123456789abcdef0123456789abcdef
G=5d000000-0000-4000-8000-0000000000a1
U1=5d000000-0000-4000-8000-000000000001
U2=5d000000-0000-4000-8000-000000000002

# Setup (as the owner): the creator and a member, the switch lab on, the server key.
q <<SQL >/dev/null
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
insert into auth.users (id, raw_user_meta_data) values ('$U1', '{"app":"study","full_name":"p1"}'), ('$U2', '{"app":"study","full_name":"p2"}');
insert into public.study_groups (id, name, join_code, created_by) values ('$G', 'השוואות במקביל', 'LABCO1', '$U1');
insert into public.study_members (group_id, user_id, name) values ('$G', '$U1', 'p1'), ('$G', '$U2', 'p2') on conflict do nothing;
update study_private.features set enabled = true where name = 'lab';
SQL

# A new run of \$1 models (the owner, through the server), moved to an earlier
# day so the day's limit is not part of these checks; prints its id.
plan() {
  q <<SQL | grep -oE '[0-9a-f-]{36}' | head -1
set request.jwt.claim.sub = '$U1';
select public.study_lab_plan('$G', null, 'practice', 'השוואה במקביל (synthetic)', '{}', '{"material":{}}', 'hash-concurrent', '',
  (select jsonb_agg(jsonb_build_object('model', 'model-' || n, 'provider', 'anthropic')) from generate_series(1, $1) n),
  'judge-model', 0.10, 33, '$KEY') ->> 'run' as run \gset
update public.study_lab_runs set created_at = now() - interval '2 days' where id = :'run' returning id;
SQL
}
# The worker's claim (anon: no user), as one psql session; prints the id or the error.
claim() { # $1 = run, $2 = label, $3 = part, $4 = estimate
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1 | tr '\n' ' '
set request.jwt.claim.sub = '';
select 'id:' || public.study_lab_claim('$1', '$2', '$3', $4, 33, '$KEY');
SQL
}
ids() { grep -oE 'id:[0-9]+' <<<"$1" | wc -l; }
nw() { grep -oE 'not waiting' <<<"$1" | wc -l; }

# LC1
ok1=0
for round in $(seq 1 10); do
  R=$(plan 2)
  OUT=$( (claim "$R" א answer 0.05; echo) & (claim "$R" א answer 0.05; echo) & wait )
  ROWS=$(echo "select count(*) from public.study_usage where group_id = '$G' and ref like 'run:$R:%';" | q)
  ST=$(echo "select status from public.study_lab_outputs where run_id = '$R' and label = 'א';" | q)
  if [ "$(ids "$OUT")" = 1 ] && [ "$(nw "$OUT")" = 1 ] && [ "$ROWS" = 1 ] && [ "$ST" = running ]; then ok1=$((ok1 + 1)); else echo "LC1 round $round: $OUT rows $ROWS status $ST"; fi
done
echo "LC1. $( [ $ok1 = 10 ] && echo ok || echo FAIL ): two claims of one answer at once, 10 rounds: $ok1 of 10 with one reservation, one not waiting, one ledger row (expect 10)"

# LC2
ok2=0
for round in $(seq 1 10); do
  R=$(plan 2)
  echo "update public.study_lab_runs set status = 'done' where id = '$R';" | q >/dev/null
  OUT=$( (claim "$R" j judge 0.10; echo) & (claim "$R" j judge 0.10; echo) & wait )
  ROWS=$(echo "select count(*) from public.study_usage where group_id = '$G' and ref = 'run:$R:j:judge';" | q)
  if [ "$(ids "$OUT")" = 1 ] && [ "$(nw "$OUT")" = 1 ] && [ "$ROWS" = 1 ]; then ok2=$((ok2 + 1)); else echo "LC2 round $round: $OUT rows $ROWS"; fi
done
echo "LC2. $( [ $ok2 = 10 ] && echo ok || echo FAIL ): two claims of a run's AI score at once, 10 rounds: $ok2 of 10 with one (expect 10)"

# LC3
ok3=0
for round in $(seq 1 10); do
  R=$(plan 2)
  echo "update public.study_lab_outputs set status = 'timeout' where run_id = '$R' and label = 'ב';" | q >/dev/null
  OUT=$( (claim "$R" ב retry 0.05; echo) & (claim "$R" ב retry 0.05; echo) & wait )
  TRIES=$(echo "select tries from public.study_lab_outputs where run_id = '$R' and label = 'ב';" | q)
  if [ "$(ids "$OUT")" = 1 ] && [ "$(nw "$OUT")" = 1 ] && [ "$TRIES" = 1 ]; then ok3=$((ok3 + 1)); else echo "LC3 round $round: $OUT tries $TRIES"; fi
done
echo "LC3. $( [ $ok3 = 10 ] && echo ok || echo FAIL ): two retries of one answer at once, 10 rounds: $ok3 of 10 with one, tries 1 (expect 10)"

# LC4: the month's comparison spend set so the line ($3.30) has room for three claims of $0.30.
ok4=0
for round in $(seq 1 10); do
  echo "delete from public.study_usage where group_id = '$G'; insert into public.study_usage (group_id, kind, ref, cost_usd, settled_at) values ('$G', 'lab', 'seed', 2.40, now());" | q >/dev/null
  R=$(plan 4)
  OUT=$( (claim "$R" א answer 0.30; echo) & (claim "$R" ב answer 0.30; echo) & (claim "$R" ג answer 0.30; echo) & (claim "$R" ד answer 0.30; echo) & wait )
  BUDGET=$(grep -oE 'lab_budget' <<<"$OUT" | wc -l)
  WAITING=$(echo "select count(*) from public.study_lab_outputs where run_id = '$R' and status = 'waiting';" | q)
  if [ "$(ids "$OUT")" = 3 ] && [ "$BUDGET" = 1 ] && [ "$WAITING" = 1 ]; then ok4=$((ok4 + 1)); else echo "LC4 round $round: $OUT waiting $WAITING"; fi
done
echo "LC4. $( [ $ok4 = 10 ] && echo ok || echo FAIL ): four answers claimed at once with room for three under the line, 10 rounds: $ok4 of 10 with three reservations, one lab_budget, its slot still waiting (expect 10)"
# LC5
slots() { # $1 = run
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1 | tr '\n' ' '
set request.jwt.claim.sub = '';
select public.study_lab_claim_slots('$1', '[{"label":"א","estimate":0.05},{"label":"ב","estimate":0.05},{"label":"ג","estimate":0.05}]', 33, false, '$KEY');
SQL
}
ok5=0
echo "delete from public.study_usage where group_id = '$G';" | q >/dev/null
for round in $(seq 1 10); do
  R=$(plan 3)
  OUT=$( (slots "$R"; echo) & (slots "$R"; echo) & wait )
  ROWS=$(echo "select count(*) from public.study_usage where group_id = '$G' and ref like 'run:$R:%:answer';" | q)
  RUN=$(echo "select count(*) from public.study_lab_outputs where run_id = '$R' and status = 'running';" | q)
  NW=$(grep -oE 'not waiting' <<<"$OUT" | wc -l)
  if [ "$ROWS" = 3 ] && [ "$RUN" = 3 ] && [ "$NW" = 3 ]; then ok5=$((ok5 + 1)); else echo "LC5 round $round: $OUT rows $ROWS running $RUN"; fi
done
echo "LC5. $( [ $ok5 = 10 ] && echo ok || echo FAIL ): a run's slots claimed together from two sessions at once, 10 rounds: $ok5 of 10 with each slot once, the other told not waiting (expect 10)"
echo "dropping $DB"

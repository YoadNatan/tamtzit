#!/usr/bin/env bash
# Section O 1's hold on the sheets line (docs/study/sheets.md "The hold"):
# sheets started at once, as psql sessions on a throwaway local Postgres
# (never the real project).
#   SH1  three members start a sheet each in the same instant, each with a
#        worst case of $4 against the $6 line (study_sheet_hold, the op's
#        call), 10 rounds: exactly one holds, the two others are refused
#        'sheets_cap' (the group's budget lock decides; before the fix every
#        one passed, since the line counted finished units only).
#   SH2  three at $2.50 at once, 10 rounds: exactly two hold ($5), the third
#        is refused; no deadlock, no other error.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/sheet-hold-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=sheet_hold_conc_$$
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
U3=5d000000-0000-4000-8000-000000000003

q <<SQL >/dev/null
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
insert into auth.users (id, raw_user_meta_data) values
  ('$U1', '{"app":"study","full_name":"p1"}'), ('$U2', '{"app":"study","full_name":"p2"}'), ('$U3', '{"app":"study","full_name":"p3"}');
insert into public.study_groups (id, name, join_code, created_by) values ('$G', 'קו במקביל', 'HOLDC1', '$U1');
insert into public.study_members (group_id, user_id, name) values ('$G', '$U1', 'p1'), ('$G', '$U2', 'p2'), ('$G', '$U3', 'p3')
on conflict do nothing;
update study_private.features set enabled = true where name in ('exams', 'sheets');
SQL

# A member's new sheet, uploading (as study_sheet_create leaves it); prints its id.
sheet() { # $1 = member, $2 = name
  q <<SQL | grep -oE '[0-9a-f-]{36}'
insert into public.study_exams (group_id, course, title, status, kind, key_source, created_by, hide_from_profile)
values ('$G', 'קורס', '$2 (synthetic)', 'uploading', 'sheet', 'none', '$1', true) returning id;
SQL
}
hold_as() { # $1 = member, $2 = sheet, $3 = worst
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1 | tr '\n' ' '
set role authenticated; set request.jwt.claim.sub = '$1';
select 'held ' || (public.study_sheet_hold('$2', $3, 6, '{"exam":0.5,"sheet":0.25}', '$KEY') ->> 'held');
SQL
}
run_rounds() { # $1 = label, $2 = worst, $3 = how many should hold
  local ok=0
  for round in $(seq 1 10); do
    echo "delete from study_private.sheet_holds where group_id = '$G';" | q >/dev/null
    S1=$(sheet $U1 "$1-$round-a"); S2=$(sheet $U2 "$1-$round-b"); S3=$(sheet $U3 "$1-$round-c")
    OUT=$( (hold_as $U1 "$S1" "$2"; echo) & (hold_as $U2 "$S2" "$2"; echo) & (hold_as $U3 "$S3" "$2"; echo) & wait )
    HELD=$(echo "$OUT" | grep -o 'held [0-9]' | wc -l)
    CAP=$(echo "$OUT" | grep -o 'ERROR:  sheets_cap' | wc -l)
    OTHER=$(( $(echo "$OUT" | grep -oi 'error:\|deadlock' | wc -l) - CAP ))
    ROWS=$(echo "select count(*) from study_private.sheet_holds where group_id = '$G';" | q)
    if [ "$HELD" = "$3" ] && [ "$CAP" = $((3 - $3)) ] && [ "$OTHER" = 0 ] && [ "$ROWS" = "$3" ]; then ok=$((ok + 1)); else echo >&2 "$1 round $round: held $HELD capped $CAP other $OTHER rows $ROWS: $OUT"; fi
  done
  echo "$ok"
}
ok1=$(run_rounds SH1 4 1 | tail -1)
echo "SH1. $( [ "$ok1" = 10 ] && echo ok || echo FAIL ): three sheets of \$4 at once on the \$6 line, 10 rounds: $ok1 of 10 with one hold and two sheets_cap (expect 10)"
ok2=$(run_rounds SH2 2.5 2 | tail -1)
echo "SH2. $( [ "$ok2" = 10 ] && echo ok || echo FAIL ): three sheets of \$2.50 at once, 10 rounds: $ok2 of 10 with two holds and one sheets_cap, no deadlock (expect 10)"
echo "dropping $DB"

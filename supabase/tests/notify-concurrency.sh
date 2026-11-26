#!/usr/bin/env bash
# Section R (notifications): a hook never holds up the write that fired it.
# Two psql sessions on a throwaway local Postgres (never the real project):
#   N1  session A adds a member's notice and keeps its transaction open (the
#       row is not committed, so its dedupe key is taken); session B saves a
#       reply whose hook must add the same member's notice with the same key.
#       notice_add gives up on that lock after 200 ms: the reply is saved in
#       well under 2 s, without the notice.
#   N2  once A commits, the next reply coalesces into A's row (count 2).
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/notify-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=notify_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }

ROOTC=$(q <<'SQL' | grep -oE '[0-9a-f-]{36}' | tail -1
insert into auth.users (id, raw_user_meta_data) values
  ('2a000000-0000-4000-8000-000000000001', '{"app":"study","full_name":"a"}'),
  ('2a000000-0000-4000-8000-000000000002', '{"app":"study","full_name":"b"}');
insert into public.study_groups (id, name, join_code, created_by)
values ('2a000000-0000-4000-8000-0000000000a1', 'נעילה', 'NLOCK1', '2a000000-0000-4000-8000-000000000001');
insert into public.study_members (group_id, user_id, name) values
  ('2a000000-0000-4000-8000-0000000000a1', '2a000000-0000-4000-8000-000000000001', 'a'),
  ('2a000000-0000-4000-8000-0000000000a1', '2a000000-0000-4000-8000-000000000002', 'b');
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
values ('2a000000-0000-4000-8000-0000000000b1', '2a000000-0000-4000-8000-0000000000a1', 'הרצאה בדויה', 'pptx', '[]',
        '2a000000-0000-4000-8000-000000000001');
insert into public.study_comments (id, lecture_id, part_idx, anchor, kind, body, author_id)
values ('2a000000-0000-4000-8000-0000000000c1', '2a000000-0000-4000-8000-0000000000b1', 0, 0, 'question', 'שאלה?',
        '2a000000-0000-4000-8000-000000000001')
returning id;
SQL
)

# A: the same key, uncommitted, for 4 s.
q <<SQL >/dev/null 2>&1 &
begin;
select study_private.notice_add('2a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-0000000000a1', 'answer', '{}', '{}', null, 'reply:$ROOTC');
select pg_sleep(4);
commit;
SQL
A=$!
sleep 1

T0=$(date +%s%N)
q <<SQL >/dev/null 2>&1
set role authenticated;
set request.jwt.claim.sub = '2a000000-0000-4000-8000-000000000002';
insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id)
values ('2a000000-0000-4000-8000-0000000000b1', 0, 0, 'comment', 'בזמן נעילה', '$ROOTC');
SQL
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
SAVED=$(echo "select count(*) from public.study_comments where body = 'בזמן נעילה';" | q)
if [ "$SAVED" = 1 ] && [ "$MS" -lt 2000 ]; then echo "N1. ok: the reply was saved in ${MS} ms while the notice's key was locked"
else echo "N1. FAIL: saved=$SAVED after ${MS} ms"; fi
wait $A

q <<SQL >/dev/null 2>&1
set role authenticated;
set request.jwt.claim.sub = '2a000000-0000-4000-8000-000000000002';
insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id)
values ('2a000000-0000-4000-8000-0000000000b1', 0, 0, 'comment', 'אחרי', '$ROOTC');
SQL
N=$(echo "select string_agg(count::text, ',') from public.study_notices where user_id = '2a000000-0000-4000-8000-000000000001';" | q)
if [ "$N" = 2 ]; then echo "N2. ok: after the lock, the next reply coalesces into the committed row (count 2)"
else echo "N2. FAIL: counts $N"; fi

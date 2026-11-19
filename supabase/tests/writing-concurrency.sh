#!/usr/bin/env bash
# W2 (spec §3.7, docs/study/writing.md): writing under double dispatch, as
# psql sessions at once on a throwaway local Postgres (never the real project).
#   WK1  six writers claim one lecture in the same instant (pg_cron's sweep
#        and the queue's kick both reach /api/study/work, a phone's device
#        path asks too): one unit, one lease, the others get nothing (busy);
#   WK2  six phones tap "המשך כתיבה" on the same failed part in the same
#        instant: the part starts over once, and one more of the day's three
#        restarts is spent;
#   WK3  a writer that died (its lease ran out) and six claims at once: one
#        takes the part over, with one more attempt;
#   WK4  the lecture is deleted while six claims race: nobody gets a unit.
# It loads supabase/tests/stubs.sql, tests/board-schema.sql and study-schema.sql
# from this checkout into a new database and drops it at the end.
#   bash supabase/tests/writing-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=writing_conc_$$
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || service postgresql start >/dev/null
su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
trap 'su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1' EXIT
cat "$ROOT/supabase/tests/stubs.sql" "$ROOT/supabase/tests/board-schema.sql" "$ROOT/supabase/study-schema.sql" \
  | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" >/dev/null 2>&1
q() { su postgres -c "psql -X -q -tA -v ON_ERROR_STOP=1 -d $DB" ; }
KEY=k-0123456789abcdef0123456789abcdef
L=eeeeeeee-0000-4000-8000-0000000000c1

# Setup (as the owner): a group of six, the worker's key in Vault, a lecture
# with its outline written: part 0 ready, part 1 failed (a refusal), part 2
# waiting. The server is not set up (no site address), so nothing is kicked.
q <<SQL >/dev/null
\set ON_ERROR_STOP 1
insert into auth.users (id, raw_user_meta_data)
select ('a0000000-0000-4000-8000-00000000000' || i)::uuid, jsonb_build_object('app', 'study', 'full_name', 'p' || i)
  from generate_series(1, 6) i;
insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '$KEY')
on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select id as gid, join_code as code from public.study_create_group('שש', 'p1') \gset
select set_config('c.code', :'code', false) is not null as c \gset
do \$\$ declare i int; begin
  for i in 2..6 loop
    perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000' || i, false);
    perform public.study_join(current_setting('c.code'), 'p' || i);
  end loop;
end \$\$;
reset role;
-- Restarted once earlier today (the study day starts at 04:00 in Israel).
insert into public.study_lectures (id, group_id, title, source_kind, slides, status, retries, retry_day) values
  ('$L', :'gid', 'L', 'pptx', '[{"n":1,"title":"a","lines":["x"],"tables":[],"notes":"","figures":[]}]', 'writing',
   1, ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date);
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, error, attempts, markdown) values
  ('$L', 0, 'א', 1, 1, 'ready', null, 1, '## א'),
  ('$L', 1, 'ב', 1, 1, 'failed', 'refusal', 1, ''),
  ('$L', 2, 'ג', 1, 1, 'pending', null, 0, '');
SQL
member() { # $1 = player number, $2 = SQL (a phone, with the member's token)
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000$1';
$2
SQL
}
worker() { # $1 = SQL (the server writer: no token, the key)
  su postgres -c "psql -X -q -tA -d $DB" <<SQL 2>&1
set role anon; reset request.jwt.claim.sub;
$1
SQL
}
claims() { q <<SQL
select count(*) from public.study_sections where lecture_id = '$L' and status = 'writing' and lease_until > now();
SQL
}

# WK1: six claims at once. Part 2 is the only unit due (part 1 waits for a tap).
OUT=$( for i in 1 2 3 4 5 6; do (worker "select coalesce(string_agg(kind || ':' || idx, ','), 'none') from public.study_claim('$L', null, null, '$KEY');") & done; wait )
echo "WK1. six claims at once got: $(echo "$OUT" | sort | uniq -c | tr -s ' ' | tr '\n' ';') leases live $(claims) (expect 1 part:2 and 5 none; 1)"

# WK2: six phones tap "המשך כתיבה" on part 1 at once. Each tap's transaction
# stays open half a second after the call (as the queue's kick to the worker
# keeps it open in production), so every tap starts before the first commits.
OUT=$( for i in 1 2 3 4 5 6; do (member $i "begin; select public.study_queue('$L', '{}'::jsonb, null, true); select pg_sleep(0.5) is null as slept \\gset
commit;") & done; wait )
q <<SQL
select 'WK2. six taps at once: answers ' || '$(echo "$OUT" | sort | uniq -c | tr -s ' ' | tr '\n' ';')' || ' restarts today ' || retries
       || ', part 1 ' || s.status || ' attempts ' || s.attempts || ' due ' || (s.retry_at <= now())
       || ' (expect 6 f: the server is not set up; restarts 2, one more than before; part 1 failed attempts 0 due true)'
  from public.study_lectures l join public.study_sections s on s.lecture_id = l.id and s.idx = 1 where l.id = '$L';
SQL

# WK3: the writer of part 2 dies (its lease ran out); six writers race for the
# units: part 1 (started over by WK2) and part 2 (taken over).
q <<SQL >/dev/null
update public.study_sections set lease_until = now() - interval '1 second' where lecture_id = '$L' and idx = 2;
SQL
OUT=$( for i in 1 2 3 4 5 6; do (worker "select coalesce(string_agg(kind || ':' || idx, ','), 'none') from public.study_claim('$L', null, null, '$KEY');") & done; wait )
q <<SQL
select 'WK3. six claims after a writer died got: ' || '$(echo "$OUT" | sort | uniq -c | tr -s ' ' | tr '\n' ';')'
       || ' parts writing ' || count(*) filter (where status = 'writing') || ', attempts ' || string_agg(idx || '=' || attempts, ',' order by idx)
       || ' (expect part:1 and part:2 once each, 4 none; 2 writing; 0=1,1=1,2=2)'
  from public.study_sections where lecture_id = '$L';
SQL

# WK4: deleted while six claims race.
q <<SQL >/dev/null
update public.study_sections set status = 'pending', lease_id = null, lease_until = null, writer = null where lecture_id = '$L' and idx in (1, 2);
SQL
member 1 "select public.study_delete_lecture('$L', true);" >/dev/null
OUT=$( for i in 1 2 3 4 5 6; do (worker "select coalesce(string_agg(kind || ':' || idx, ','), 'none') from public.study_claim('$L', null, null, '$KEY');") & done; wait )
echo "WK4. six claims on the deleted lecture got: $(echo "$OUT" | sort | uniq -c | tr -s ' ' | tr '\n' ';') leases live $(claims) (expect 6 none; 0)"
echo "dropping $DB"

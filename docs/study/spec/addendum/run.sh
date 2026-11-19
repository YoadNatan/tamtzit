#!/usr/bin/env bash
# The final addendum's SQL run (spec §12.8), on throwaway local Postgres 16
# databases only (never the real project; no group anywhere real; no Claude
# call; every database is dropped at the end). Reads the repo worktree, the
# spec and the three designs read-only; writes only build/, sql/, tests/ and
# out/ beside this file.
#
#   0. edits/build.py: the addendum's SQL and checks from the designs and the
#      review's edits (each asserted to match once), and the spec's files
#      with the small edits other packages' files need (§12.9)
#   1. load: the repo's stubs and study-schema.sql, every spec section and
#      every new block and section, twice: 0 errors; a third run's notices
#   2. the spec's checks (as §12.9 edits them) + the shared checks, one session
#   3. identity.sql in its own database (it creates a group)
#   4. the repo's own study.sql alone with everything loaded
#   5. the fun design's checks, the server design's checks and the review's
#      checks, each in a database of its own (they create groups)
#   6. the spec's own checks UNEDITED and as §12.9 edits them, each in a fresh
#      database with everything loaded, compared by check label: every label
#      that differs is one an approved decision or a review fix changes
#   7. stages: each package's SQL with only what it depends on, twice, and
#      its checks where they run alone
#   8. the same on F0's real study-schema.sql (branch study/f0), when the
#      feasibility review's copy is there: the load twice, F0's real
#      tests/study.sql with F's edits and the other checks, the review's checks
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="$(cd "$HERE/../../.." && pwd)"
BASE="${STUDY_BASE:-$SCRATCH/wt/base}"
OUT="$HERE/out"; mkdir -p "$OUT"
service postgresql status >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1
psqlq() { su postgres -c "psql -X -q -v ON_ERROR_STOP=$2 -d $1 -f -"; }
mk() { su postgres -c "dropdb --if-exists $1; createdb $1" >/dev/null 2>&1; }
rm_db() { su postgres -c "dropdb --if-exists $1" >/dev/null 2>&1; }
count() { grep -cE "$1" "$2"; }
fails() { grep -E 'FAIL|ERROR|error:' "$1" | sed -E 's/^psql:<stdin>:[0-9]+: (NOTICE:  )?//' | cut -c1-240 | head -${2:-12} | sed 's/^/      /'; }

echo "== 0. build"
python3 -I "$HERE/edits/build.py" || exit 1

S=$HERE/build/spec/sql; ST=$HERE/build/spec/tests; A=$HERE/sql; T=$HERE/tests
STUBS=("$BASE/supabase/tests/stubs.sql" "$S/stubs-additions.sql" "$A/stubs-addendum.sql" "$BASE/supabase/tests/board-schema.sql")
SECTIONS=("$S/10-foundation.sql" "$A/15-foundation-end.sql" "$S/20-identity.sql" "$S/30-writing.sql" "$A/35-writing-end.sql"
          "$S/40-questions.sql" "$A/45-questions-end.sql" "$S/50-quiz.sql" "$A/55-quiz-end.sql"
          "$S/60-cards.sql" "$A/65-cards-end.sql" "$S/70-collab.sql" "$A/75-collab-end.sql"
          "$S/80-progress.sql" "$A/85-progress-end.sql"
          "$A/90-meeting.sql" "$A/91-anchor.sql" "$A/92-var.sql" "$A/93-pulse.sql" "$A/94-wall.sql" "$A/95-boss.sql"
          "$A/96-bank.sql" "$A/97-plan.sql" "$A/98-extras.sql" "$A/99-today.sql")
SCHEMA=("$BASE/supabase/study-schema.sql" "${SECTIONS[@]}")
SPECCHECKS=("$BASE/supabase/tests/study.sql" "$ST/10-foundation-test.sql" "$ST/30-writing-test.sql" "$ST/40-questions-test.sql"
            "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql" "$ST/80-progress-test.sql")
SHARED=("$T/shared/95-extensions-test.sql" "$T/shared/96-meeting-test.sql" "$T/shared/97-anchor-var-today-test.sql"
        "$T/shared/98-merge-test.sql")
FUNT=("$T/fun/10-fixtures.sql" "$T/fun/20-pulse-test.sql" "$T/fun/30-wall-test.sql" "$T/fun/40-boss-test.sql"
      "$T/fun/50-later-test.sql" "$T/fun/60-merge-test.sql")
SRVT=("$T/server/00-fixtures.sql" "$T/server/10-questions-test.sql" "$T/server/20-cards-test.sql" "$T/server/30-collab-test.sql"
      "$T/server/40-progress-test.sql" "$T/server/50-bank-test.sql" "$T/server/60-plan-extras-test.sql" "$T/server/70-merge-test.sql")
REVT=("$T/review/00-fixtures.sql")
for f in "$T"/review/[1-9]*.sql; do [ -f "$f" ] && REVT+=("$f"); done

echo "== 1. load: stubs, board, study-schema + every spec section + the addendum, twice"
DB=fin_load_$$; mk $DB
cat "${STUBS[@]}" "${SCHEMA[@]}" "${SCHEMA[@]}" | psqlq $DB 0 > "$OUT/load.txt" 2>&1
echo "   load errors (both runs): $(count 'ERROR' "$OUT/load.txt")"; fails "$OUT/load.txt" 8
echo "   notices of a third run (expect only 'already exists', 'does not exist, skipping' and the two Vault notices):"
cat "${SCHEMA[@]}" | psqlq $DB 0 2>&1 | grep -vE "^\s*$" | sed -E 's/^psql:<stdin>:[0-9]+: //' | sed -E 's/"[^"]*"/"…"/g; s/\(.*\)//' \
  | sort | uniq -c | sort -rn | sed 's/^/      /' | head -10
echo "   registry: $(su postgres -c "psql -X -d $DB -tAc \"select string_agg(section || '=' || version, ' ' order by section) from study_private.schema_sections\"")"
echo "   user columns: $(su postgres -c "psql -X -d $DB -tAc \"select count(*) from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where t.table_type = 'BASE TABLE' and (c.table_schema = 'public' and c.table_name like 'study%' or c.table_schema = 'study_private') and not (c.table_schema = 'study_private' and c.table_name = 'merge_tickets') and c.data_type = 'uuid' and exists (select 1 from information_schema.key_column_usage k join information_schema.constraint_column_usage u using (constraint_name) where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = c.column_name and u.table_schema = 'auth' and u.table_name = 'users')\"") (uuid columns referencing auth.users, the merge's own tickets aside, as ME63 counts)"
echo "   functions: $(su postgres -c "psql -X -d $DB -tAc \"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','study_private') and p.proname like 'study%' or n.nspname = 'study_private'\"") in public.study_* and study_private"

echo "== 2. the spec's checks (as §12.9 edits them) + the shared checks, one session"
cat "${SPECCHECKS[@]}" "${SHARED[@]}" | psqlq $DB 1 > "$OUT/checks.txt" 2>&1; rc=$?
echo "   exit: $rc   lines: $(wc -l < "$OUT/checks.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/checks.txt")"; fails "$OUT/checks.txt"
echo "   the shared checks' own lines (QA ZA CA KA M N V T MG): $(grep -cE '(^| )(QA|ZA|CA|KA|M|N|V|T|MG)[0-9]+[a-z0-9]*\. |(^| )(M|N|V|T|QA|ZA|CA|KA)-reg\. ' "$OUT/checks.txt")"
grep -E " (F21|F27|P0|ME63|ME64|Q-reg|Z-reg|C-reg|K-reg|W-reg|MG5|MG6)\. " "$OUT/checks.txt" | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  //' | cut -c1-230 | sed 's/^/      /'
rm_db $DB

echo "== 3. identity.sql (as edited), own database, everything loaded"
DB=fin_ident_$$; mk $DB
cat "${STUBS[@]}" "${SCHEMA[@]}" | psqlq $DB 0 >/dev/null 2>&1
cat "$ST/identity.sql" | psqlq $DB 1 > "$OUT/identity.txt" 2>&1; rc=$?
echo "   exit: $rc   lines: $(wc -l < "$OUT/identity.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/identity.txt")"; fails "$OUT/identity.txt"
grep -E " I1[67]\. " "$OUT/identity.txt" | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  //' | cut -c1-200 | sed 's/^/      /'
rm_db $DB

echo "== 4. the repo's own study.sql alone, everything loaded"
DB=fin_repo_$$; mk $DB
cat "${STUBS[@]}" "${SCHEMA[@]}" | psqlq $DB 0 >/dev/null 2>&1
cat "$BASE/supabase/tests/study.sql" | psqlq $DB 1 > "$OUT/repo.txt" 2>&1; rc=$?
echo "   exit: $rc   lines: $(wc -l < "$OUT/repo.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/repo.txt")"
rm_db $DB

own() {   # name, outfile, files...
  local name=$1 out=$2; shift 2
  local DB=fin_own_$$; mk $DB
  cat "${STUBS[@]}" "${SCHEMA[@]}" | psqlq $DB 0 >/dev/null 2>&1
  cat "$@" | psqlq $DB 1 2>&1 | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  / /' | grep -vE "^\s*$" > "$out"
  local rc=${PIPESTATUS[1]}
  echo "   $name: exit $rc   check lines: $(grep -cE '^ ?[A-Z]{1,3}[0-9-]+[a-z0-9]*\. ' "$out")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$out")"
  fails "$out"
  rm_db $DB
}
echo "== 5. checks in databases of their own"
own "fun (U J H, merge M)     " "$OUT/fun-checks.txt" "${FUNT[@]}"
own "server (QS..MS)          " "$OUT/server-checks.txt" "${SRVT[@]}"
own "review (SR, the findings)" "$OUT/review-checks.txt" "${REVT[@]}"
for p in QS CS KS PS BS GS ES DS MS; do printf "      %s %s" "$p" "$(grep -cE "^ ?$p[0-9-]" "$OUT/server-checks.txt")"; done; echo
for p in U J H M; do printf "      %s %s" "$p" "$(grep -cE "^ ?$p[0-9]+[a-z0-9]*\. " "$OUT/fun-checks.txt")"; done; echo

echo "== 6. the spec's own checks, UNEDITED and as §12.9 edits them, each in a fresh database with everything loaded (errors do not stop either run)"
SPECRAW=("$BASE/supabase/tests/study.sql")
for f in 10-foundation-test 30-writing-test 40-questions-test 50-quiz-test 60-cards-test 70-collab-test 80-progress-test; do
  SPECRAW+=("$BASE/docs/study/spec/tests/$f.sql"); done
for v in unedited edited; do
  DB=fin_spec_${v}_$$; mk $DB
  cat "${STUBS[@]}" "${SCHEMA[@]}" | psqlq $DB 0 >/dev/null 2>&1
  if [ $v = unedited ]; then files=("${SPECRAW[@]}"); else files=("${SPECCHECKS[@]}"); fi
  cat "${files[@]}" | sed 's/^\\set ON_ERROR_STOP 1$//' | psqlq $DB 0 > "$OUT/spec-$v.txt" 2>&1
  echo "   $v: lines $(wc -l < "$OUT/spec-$v.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/spec-$v.txt")"
  rm_db $DB
done
grep -E 'FAIL|ERROR' "$OUT/spec-unedited.txt" | sed -E 's/^psql:<stdin>:[0-9]+: (NOTICE:  )?//' | sed -E 's/^(K11\. FAIL: ).* refused for another reason: (.*)$/\1<one of 20 structure edits> refused for another reason: \2/' \
  | sort | uniq -c | sort -rn | cut -c1-160 | sed 's/^/      /' | head -14
python3 -I "$HERE/edits/compare.py" "$OUT/spec-edited.txt" "$OUT/spec-unedited.txt" > "$OUT/spec-unedited-diff.txt"
echo "   unedited against edited, by check label: $(head -1 "$OUT/spec-unedited-diff.txt") (every one an approved change, spec §12.8.3)"
python3 -I "$HERE/edits/compare.py" "$OUT/spec-edited.txt" "$OUT/spec-unedited.txt" --labels-only | sed 1d | sed 's/^/      /'

[ -x "$HERE/stages.sh" ] && { echo "== 7. stages"; "$HERE/stages.sh"; }

# 8. On F0's real file (study/f0's study-schema.sql, section F inside its markers, as the
#    feasibility review copied it read-only with git show), with F0's real stubs: the
#    load, F0's real tests/study.sql (F's edits of §12.9, review F-16) with the spec's
#    W..P checks and the shared checks, and the review's checks in a database of their own.
FB="$SCRATCH/spec/addendum/critique/feas/branches"
if [ -f "$FB/f0.study-schema.sql" ] && [ -f "$FB/f0.stubs.sql" ]; then
  echo "== 8. the same sections on F0's real study-schema.sql (branch study/f0)"
  REAL=("$FB/f0.study-schema.sql" "$A/15-foundation-end.sql" "${SECTIONS[@]:2}")   # F0's file has section F; its end follows
  F0STUBS=("$FB/f0.stubs.sql" "$S/stubs-additions.sql" "$A/stubs-addendum.sql" "$FB/board-schema.sql")
  DB=fin_f0_$$; mk $DB
  cat "${F0STUBS[@]}" "${REAL[@]}" "${REAL[@]}" | psqlq $DB 0 > "$OUT/f0-load.txt" 2>&1
  echo "   load errors (twice): $(count 'ERROR' "$OUT/f0-load.txt")"; fails "$OUT/f0-load.txt" 5
  echo "   registry: $(su postgres -c "psql -X -d $DB -tAc \"select string_agg(section || '=' || version, ' ' order by section) from study_private.schema_sections\"")"
  if [ -f "$HERE/build/f0/study.sql" ]; then
    cat "$HERE/build/f0/study.sql" "$ST/30-writing-test.sql" "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" \
        "$ST/70-collab-test.sql" "$ST/80-progress-test.sql" "${SHARED[@]}" | psqlq $DB 1 > "$OUT/f0-checks.txt" 2>&1; rc=$?
    echo "   F0's real tests/study.sql + the spec's W..P checks + the shared checks: exit $rc   lines: $(wc -l < "$OUT/f0-checks.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/f0-checks.txt")"
    fails "$OUT/f0-checks.txt" 5
    grep -E " (F21|F27|F28[a-f]?|P0|ME63)\. " "$OUT/f0-checks.txt" | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  //' | cut -c1-150 | sed 's/^/      /'
  fi
  rm_db $DB
  DB=fin_f0r_$$; mk $DB
  cat "${F0STUBS[@]}" "${REAL[@]}" | psqlq $DB 0 >/dev/null 2>&1
  cat "${REVT[@]}" | psqlq $DB 1 2>&1 | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  / /' | grep -vE "^\s*$" > "$OUT/f0-review-checks.txt"
  echo "   the review's checks on F0's file: check lines $(grep -cE '^ ?[A-Z]{1,3}[0-9-]+[a-z0-9]*\. ' "$OUT/f0-review-checks.txt")   FAIL/ERROR lines: $(count 'FAIL|ERROR|error:' "$OUT/f0-review-checks.txt")"
  fails "$OUT/f0-review-checks.txt" 5
  rm_db $DB
fi
echo "outputs: $OUT/*.txt"

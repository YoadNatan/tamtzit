#!/usr/bin/env bash
# Iteration helper: one suite in a database of its own. usage: own.sh fun|server|review
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SCRATCH="$(cd "$HERE/../../.." && pwd)"; BASE=$SCRATCH/wt/base
S=$HERE/build/spec/sql; A=$HERE/sql; T=$HERE/tests
STUBS=("$BASE/supabase/tests/stubs.sql" "$S/stubs-additions.sql" "$A/stubs-addendum.sql" "$BASE/supabase/tests/board-schema.sql")
SCHEMA=("$BASE/supabase/study-schema.sql" "$S/10-foundation.sql" "$A/15-foundation-end.sql" "$S/20-identity.sql" "$S/30-writing.sql" "$A/35-writing-end.sql"
  "$S/40-questions.sql" "$A/45-questions-end.sql" "$S/50-quiz.sql" "$A/55-quiz-end.sql" "$S/60-cards.sql" "$A/65-cards-end.sql"
  "$S/70-collab.sql" "$A/75-collab-end.sql" "$S/80-progress.sql" "$A/85-progress-end.sql" "$A/90-meeting.sql" "$A/91-anchor.sql"
  "$A/92-var.sql" "$A/93-pulse.sql" "$A/94-wall.sql" "$A/95-boss.sql" "$A/96-bank.sql" "$A/97-plan.sql" "$A/98-extras.sql" "$A/99-today.sql")
case $1 in
  fun) F=("$T/fun/10-fixtures.sql" "$T/fun/20-pulse-test.sql" "$T/fun/30-wall-test.sql" "$T/fun/40-boss-test.sql" "$T/fun/50-later-test.sql" "$T/fun/60-merge-test.sql");;
  server) F=("$T/server/00-fixtures.sql" "$T/server/10-questions-test.sql" "$T/server/20-cards-test.sql" "$T/server/30-collab-test.sql" "$T/server/40-progress-test.sql" "$T/server/50-bank-test.sql" "$T/server/60-plan-extras-test.sql" "$T/server/70-merge-test.sql");;
  review) F=("$T/review/00-fixtures.sql"); for f in "$T"/review/[1-9]*.sql; do F+=("$f"); done;;
esac
DB=fin_o_$$; su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
cat "${STUBS[@]}" "${SCHEMA[@]}" | su postgres -c "psql -X -q -d $DB -f -" >/dev/null 2>&1
cat "${F[@]}" | su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" 2>&1 | sed -E 's/^psql:<stdin>:[0-9]+: NOTICE:  / /' | grep -vE "^\s*$" > $HERE/out/q-$1.txt
echo "$1: lines $(wc -l < $HERE/out/q-$1.txt) FAIL/ERROR $(grep -cE 'FAIL|ERROR' $HERE/out/q-$1.txt)"
grep -E 'FAIL|ERROR' $HERE/out/q-$1.txt | cut -c1-260 | head -${2:-30}
su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1

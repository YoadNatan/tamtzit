#!/usr/bin/env bash
# Iteration helper: build, load twice, run the shared checks; prints errors only.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SCRATCH="$(cd "$HERE/../../.." && pwd)"; BASE=$SCRATCH/wt/base
python3 -I "$HERE/edits/build.py" >/dev/null || exit 1
S=$HERE/build/spec/sql; ST=$HERE/build/spec/tests; A=$HERE/sql; T=$HERE/tests
STUBS=("$BASE/supabase/tests/stubs.sql" "$S/stubs-additions.sql" "$A/stubs-addendum.sql" "$BASE/supabase/tests/board-schema.sql")
SCHEMA=("$BASE/supabase/study-schema.sql" "$S/10-foundation.sql" "$A/15-foundation-end.sql" "$S/20-identity.sql" "$S/30-writing.sql" "$A/35-writing-end.sql"
  "$S/40-questions.sql" "$A/45-questions-end.sql" "$S/50-quiz.sql" "$A/55-quiz-end.sql" "$S/60-cards.sql" "$A/65-cards-end.sql"
  "$S/70-collab.sql" "$A/75-collab-end.sql" "$S/80-progress.sql" "$A/85-progress-end.sql" "$A/90-meeting.sql" "$A/91-anchor.sql"
  "$A/92-var.sql" "$A/93-pulse.sql" "$A/94-wall.sql" "$A/95-boss.sql" "$A/96-bank.sql" "$A/97-plan.sql" "$A/98-extras.sql" "$A/99-today.sql")
DB=fin_q_$$; su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
cat "${STUBS[@]}" "${SCHEMA[@]}" "${SCHEMA[@]}" | su postgres -c "psql -X -q -d $DB -f -" > /tmp/claude-0/-home-user-delo-logo-review/8f5cd170-09e0-5772-8552-13878708a92b/scratchpad/spec/addendum/final/out/q-load.txt 2>&1
echo "load errors: $(grep -c ERROR $HERE/out/q-load.txt)"; grep ERROR $HERE/out/q-load.txt | head -5
if [ "${1:-}" != "load" ]; then
  cat $BASE/supabase/tests/study.sql $ST/10-foundation-test.sql $ST/30-writing-test.sql $ST/40-questions-test.sql $ST/50-quiz-test.sql \
      $ST/60-cards-test.sql $ST/70-collab-test.sql $ST/80-progress-test.sql $T/shared/*.sql | su postgres -c "psql -X -q -v ON_ERROR_STOP=0 -d $DB -f -" > $HERE/out/q-checks.txt 2>&1
  echo "shared: lines $(wc -l < $HERE/out/q-checks.txt) FAIL/ERROR $(grep -cE 'FAIL|ERROR' $HERE/out/q-checks.txt)"
  grep -E 'FAIL|ERROR' $HERE/out/q-checks.txt | sed -E 's/^psql:<stdin>:[0-9]+: (NOTICE:  )?//' | cut -c1-260 | head -${2:-40}
fi
su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1

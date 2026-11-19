#!/usr/bin/env bash
# Each package's SQL with only the sections it depends on, loaded twice (the
# order packages may merge in, spec §12.1), and its checks where they run at
# that stage. Local throwaway Postgres 16 only; databases dropped. Called by
# run.sh after build.py; reads build/ and sql/ beside this file.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="$(cd "$HERE/../../.." && pwd)"
BASE="${STUDY_BASE:-$SCRATCH/wt/base}"
S=$HERE/build/spec/sql; ST=$HERE/build/spec/tests; A=$HERE/sql; T=$HERE/tests
psqlq() { su postgres -c "psql -X -q -v ON_ERROR_STOP=$2 -d $1 -f -"; }
STUBS=("$BASE/supabase/tests/stubs.sql" "$S/stubs-additions.sql" "$A/stubs-addendum.sql" "$BASE/supabase/tests/board-schema.sql")
F=("$S/10-foundation.sql" "$A/15-foundation-end.sql"); AA=("$S/20-identity.sql"); W=("$S/30-writing.sql" "$A/35-writing-end.sql")
Q=("$S/40-questions.sql" "$A/45-questions-end.sql"); Z=("$S/50-quiz.sql" "$A/55-quiz-end.sql")
C=("$S/60-cards.sql" "$A/65-cards-end.sql"); K=("$S/70-collab.sql" "$A/75-collab-end.sql"); P=("$S/80-progress.sql" "$A/85-progress-end.sql")
M=("$A/90-meeting.sql"); N=("$A/91-anchor.sql"); V=("$A/92-var.sql"); U=("$A/93-pulse.sql"); J=("$A/94-wall.sql"); H=("$A/95-boss.sql")
B=("$A/96-bank.sql"); G=("$A/97-plan.sql"); E=("$A/98-extras.sql"); TT=("$A/99-today.sql")
stage() {   # name, then "--" separated: sections... -- checks... (checks optional)
  local name=$1; shift
  local secs=() chk=() part=s
  for x in "$@"; do if [ "$x" = "--" ]; then part=c; elif [ $part = s ]; then secs+=("$x"); else chk+=("$x"); fi; done
  local DB=fin_stage_$$; su postgres -c "dropdb --if-exists $DB; createdb $DB" >/dev/null 2>&1
  local schema=("$BASE/supabase/study-schema.sql" "${secs[@]}")
  local err; err=$(cat "${STUBS[@]}" "${schema[@]}" "${schema[@]}" | psqlq $DB 0 2>&1 | grep -cE "ERROR")
  local line; line=$(printf "   %-66s load errors %s" "$name" "$err")
  if [ ${#chk[@]} -gt 0 ]; then
    local out; out=$(cat "${chk[@]}" | psqlq $DB 1 2>&1); local rc=$?
    line="$line · checks exit $rc · FAIL/ERROR $(grep -cE 'FAIL|ERROR' <<<"$out") · lines $(grep -c '' <<<"$out")"
    grep -E 'FAIL|ERROR' <<<"$out" | sed -E 's/^psql:<stdin>:[0-9]+: (NOTICE:  )?//' | head -3 | sed 's/^/        /' >> "$HERE/out/stages-fails.txt"
  fi
  echo "$line"
  su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1
}
: > "$HERE/out/stages-fails.txt"
SPECF=("$BASE/supabase/tests/study.sql" "$ST/10-foundation-test.sql")
stage "Q-1: F + Q (+ Q's end)"                     "${F[@]}" "${Q[@]}" -- "${SPECF[@]}" "$ST/40-questions-test.sql"
stage "Z: F + Q + Z (+ ends)"                      "${F[@]}" "${Q[@]}" "${Z[@]}" -- "${SPECF[@]}" "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql"
stage "C before Q (F-4): F + C (+ C's end)"        "${F[@]}" "${C[@]}" -- "${SPECF[@]}" "$ST/60-cards-test.sql"
stage "C after Q: F + Q + C (+ ends)"              "${F[@]}" "${Q[@]}" "${C[@]}" -- "${SPECF[@]}" "$ST/40-questions-test.sql" "$ST/60-cards-test.sql"
stage "K-1/K-2 without M: F + K (+ K's end)"       "${F[@]}" "${K[@]}" -- "${SPECF[@]}" "$ST/70-collab-test.sql"
stage "F + W + K (+ K's end)"                      "${F[@]}" "${W[@]}" "${K[@]}" -- "${SPECF[@]}" "$ST/30-writing-test.sql" "$ST/70-collab-test.sql"
stage "the ends only (no new section): spec + Q Z C K P ends" "${F[@]}" "${AA[@]}" "${W[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}" -- \
      "${SPECF[@]}" "$ST/30-writing-test.sql" "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql" \
      "$ST/80-progress-test.sql" "$T/shared/95-extensions-test.sql"
stage "A2: F + A + Q + Z + C + K + P (+ ends; no W)"  "${F[@]}" "${AA[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}"
stage "M-1: F + Q + Z (+ ends)"                    "${F[@]}" "${Q[@]}" "${Z[@]}" "${M[@]}"
stage "N without M (F-10): F + Q + C (+ ends)"     "${F[@]}" "${Q[@]}" "${C[@]}" "${N[@]}"
stage "V: F + Q + C + K (+ ends; no Z, M, N)"      "${F[@]}" "${Q[@]}" "${C[@]}" "${K[@]}" "${V[@]}"
stage "U-1 without Z or A2 (F-2): F + Q + C (+ ends)" "${F[@]}" "${Q[@]}" "${C[@]}" "${U[@]}"
stage "J-1: F + C (+ C's end)"                     "${F[@]}" "${C[@]}" "${J[@]}"
stage "H-1: F + Q + Z + C (+ ends) + U"            "${F[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${U[@]}" "${H[@]}"
stage "B-1: F + A + W + Q + C (+ ends)"            "${F[@]}" "${AA[@]}" "${W[@]}" "${Q[@]}" "${C[@]}" "${B[@]}"
stage "G: F + A + Q + Z + C + K + P (+ ends; no M)" "${F[@]}" "${AA[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}" "${G[@]}"
stage "E: F + Q + Z + C (+ ends; no K, N)"         "${F[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${E[@]}"
stage "T without U J H B G E: F A Q Z C K P M N V" "${F[@]}" "${AA[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}" "${M[@]}" "${N[@]}" "${V[@]}" "${TT[@]}"
# The five SQL waves of spec §12.1.3, each the whole file as that wave's last
# branch has it (every earlier wave's sections filled, later markers empty).
# Sections in their file order (spec §12.0.4 row §3.1).
W1=("${F[@]}" "${AA[@]}" "${W[@]}" "${Q[@]}" "${C[@]}" "${K[@]}")
W2=("${F[@]}" "${AA[@]}" "${W[@]}" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${M[@]}" "${N[@]}" "${V[@]}" "${U[@]}" "${J[@]}" "${B[@]}")
W3=("${F[@]}" "${AA[@]}" "${W[@]}" "$S/35-writing-hardening.sql" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}"
    "${M[@]}" "${N[@]}" "${V[@]}" "${U[@]}" "${J[@]}" "${B[@]}")
W4=("${W3[@]}" "${TT[@]}")
stage "wave 1: F1Δ + A W Q C K (+ ends)"            "${W1[@]}" -- "${SPECF[@]}" "$ST/30-writing-test.sql" "$ST/40-questions-test.sql" \
      "$ST/60-cards-test.sql" "$ST/70-collab-test.sql"
stage "wave 2: + Z M N V U J B"                     "${W2[@]}" -- "${SPECF[@]}" "$ST/30-writing-test.sql" "$ST/40-questions-test.sql" \
      "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql"
stage "wave 3: + W2's hardening, P (+ P's end)"     "${W3[@]}" -- "$ST/study-w3.sql" "$ST/10-foundation-test.sql" "$ST/30-writing-test.sql" \
      "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql" "$ST/80-progress-test.sql" \
      "$ST/35-hardening-test.sql" "${T}/shared/95-extensions-test.sql"
stage "wave 4: + T"                                 "${W4[@]}" -- "$ST/study-w3.sql" "$ST/10-foundation-test.sql" "$ST/30-writing-test.sql" \
      "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql" "$ST/80-progress-test.sql" \
      "$ST/35-hardening-test.sql" "${T}/shared/95-extensions-test.sql" "${T}/shared/96-meeting-test.sql" "${T}/shared/97-anchor-var-today-test.sql"
HARD=("${F[@]}" "${AA[@]}" "${W[@]}" "$S/35-writing-hardening.sql" "${Q[@]}" "${Z[@]}" "${C[@]}" "${K[@]}" "${P[@]}" "${M[@]}" "${N[@]}" "${V[@]}"
      "${U[@]}" "${J[@]}" "${H[@]}" "${B[@]}" "${G[@]}" "${E[@]}" "${TT[@]}")
stage "wave 5 = everything + W2's hardening (W2's version of the repo's checks)" "${HARD[@]}" -- "$ST/study-w3.sql" "$ST/10-foundation-test.sql" \
      "$ST/30-writing-test.sql" "$ST/40-questions-test.sql" "$ST/50-quiz-test.sql" "$ST/60-cards-test.sql" "$ST/70-collab-test.sql" \
      "$ST/80-progress-test.sql" "$ST/35-hardening-test.sql" "${T}/shared/95-extensions-test.sql" "${T}/shared/96-meeting-test.sql" \
      "${T}/shared/97-anchor-var-today-test.sql" "${T}/shared/98-merge-test.sql"
if [ -s "$HERE/out/stages-fails.txt" ]; then echo "   failing lines:"; cat "$HERE/out/stages-fails.txt"; fi

"""The small edits the addendum makes to other packages' files of the spec
(spec §12.9), applied to copies under build/spec/ (never to the spec or the
repo). Each must match exactly once.

  section A   study_private.merge_users gains every new user column (I17, ME64)
  K's checks  an applied edit is a proposal plus another member's approval
              (decision 5), through mtest.edit_block; K-reg expects 2
  Z's checks  race points follow decision 2 (QZ10f, QZ11b)
  registries  Q-reg, C-reg expect 2
  F's checks  F27's anon allow-list gains section B's five worker functions;
              F21 names the switches bank and pulse
  W's checks  P0 counts the cron jobs of sections B and U
  counts      ME63 and I16 name the new total of user columns
"""
import pathlib
from lib import once, read, write

ANCHOR = "  -- A table added later with a user column adds its lines above; the\n"


def build(spec: pathlib.Path, out: pathlib.Path, merge: str) -> None:
    here = pathlib.Path(__file__).resolve().parent
    a = read(spec / "sql/20-identity.sql")
    a = once(a, ANCHOR, merge + ANCHOR, "A: merge_users gains the addendum's lines")
    write(out / "sql/20-identity.sql", a)
    for f in ["10-foundation", "30-writing", "35-writing-hardening", "40-questions", "50-quiz", "60-cards",
              "70-collab", "80-progress", "stubs-additions"]:
        write(out / f"sql/{f}.sql", read(spec / f"sql/{f}.sql"))

    k = read(spec / "tests/70-collab-test.sql")
    anon_call = ("set role anon;\ndo $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, "
                 "'### מנגנון פעולה', '### x', 0, 1);")
    k = once(k, anon_call, anon_call.replace("public.study_edit_block(", "public.study_edit_block_ANON("), "K checks: the anon call stays direct")
    n = k.count("public.study_edit_block(")
    assert n == 17, f"K checks: expected 17 edit calls, found {n}"
    k = k.replace("public.study_edit_block(", "mtest.edit_block(").replace("public.study_edit_block_ANON(", "public.study_edit_block(")
    k = once(k, "select id as gid from public.study_groups limit 1 \\gset\n",
             "select id as gid from public.study_groups limit 1 \\gset\n" + read(here / "k_helper.sql"), "K checks: the helper")
    k = once(k, "select 'K-reg. the registry: ' || (public.study_schema() ->> 'K') || ' (expect 1)';",
             "select 'K-reg. the registry: ' || (public.study_schema() ->> 'K') || ' (expect 2: with section K''s end)';", "K-reg")
    write(out / "tests/70-collab-test.sql", k)

    z = read(spec / "tests/50-quiz-test.sql")
    z = once(z, """select 'QZ10f. the table: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'score') || ' (+' || coalesce(p ->> 'last_points', '0') || ')', ', ' order by (p ->> 'score')::int desc)
       || '; Shoham''s is 500 + 500 × (time left / 20 s): ' ||
       bool_or((p ->> 'name') = 'שוהם' and (p ->> 'score')::int = 500 + floor(500.0 * (20000 - current_setting('t.ms_sh')::int) / 20000)::int)
       || ' (expect שוהם ≈950, נועה כהן ≈750, יעל 0; true)'""",
"""select 'QZ10f. the table: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'score') || ' (+' || coalesce(p ->> 'last_points', '0') || ')', ', ' order by (p ->> 'score')::int desc, (p ->> 'ms')::int)
       || '; Shoham''s is her bet on a right answer (none sent: ניחוש, +1) and her time is the tie-break: ' ||
       bool_or((p ->> 'name') = 'שוהם' and (p ->> 'score')::int = 1 and (p ->> 'ms')::int = current_setting('t.ms_sh')::int)
       || ' (expect שוהם 1 (+1), נועה כהן 1 (+1), יעל 0 (+0); true: decision 2, section Z''s end)'""", "QZ10f")
    z = once(z, """select 'QZ5c. Noa sees: key ' || (r ->> 'answer') || ', ' || jsonb_array_length(r -> 'explanations') || ' explanations, counts ' || (r -> 'counts')::text
       || ', right ' || (r ->> 'right') || ' of ' || (r ->> 'answered') || ', hers right: ' || (r ->> 'correct') || ', points ' || (r ->> 'points')
       || ' (expect the key, 5, one vote on the key and one next to it, 1 of 2, false, 0)'""",
             """select 'QZ5c. Noa sees: key ' || (r ->> 'answer') || ', ' || jsonb_array_length(r -> 'explanations') || ' explanations, counts ' || coalesce((r -> 'counts')::text, 'none')
       || ', right ' || coalesce(r ->> 'right', 'none') || ' of ' || (r ->> 'answered') || ', hers right: ' || (r ->> 'correct') || ', points ' || (r ->> 'points')
       || ' (expect the key, 5, counts none, right none of 2: two answers show only how many answered, spec §12 review SEC-6; false, 0)'""", "QZ5c: two answers show no counts (review SEC-6)")
    z = once(z, "|| ' (expect reveal; more than 500)'", "|| ' (expect reveal; 1: wrong 0, then right +1, decision 2)'", "QZ11b")
    write(out / "tests/50-quiz-test.sql", z)

    q = read(spec / "tests/40-questions-test.sql")
    q = once(q, "select 'Q-reg. the registry: ' || (public.study_schema() ->> 'Q') || ' (expect 1)';",
             "select 'Q-reg. the registry: ' || (public.study_schema() ->> 'Q') || ' (expect 2: with section Q''s end)';", "Q-reg")
    write(out / "tests/40-questions-test.sql", q)
    c = read(spec / "tests/60-cards-test.sql")
    c = once(c, "select 'C-reg. the registry: ' || (public.study_schema() ->> 'C') || ' (expect 1)';",
             "select 'C-reg. the registry: ' || (public.study_schema() ->> 'C') || ' (expect 2: with section C''s end)';", "C-reg")
    write(out / "tests/60-cards-test.sql", c)

    write(out / "tests/10-foundation-test.sql", f_edits(read(spec / "tests/10-foundation-test.sql"), "spec"))
    w = read(spec / "tests/30-writing-test.sql")
    w = once(w, "(expect 2, once each after two runs)",
             "(expect 4 with study-bank of section B and study-pulse-night of section U, once each after two runs)", "P0")
    write(out / "tests/30-writing-test.sql", w)
    p = read(spec / "tests/80-progress-test.sql")
    p = once(p, "(expect 39 with every section: repo 5, F 2, W 3, Q 7, Z 5, C 8, K 1, P 8; ME64 is the guard)",
             "(expect " + COUNTS + "; ME64 is the guard)", "ME63")
    write(out / "tests/80-progress-test.sql", p)
    i = read(spec / "tests/identity.sql")
    i = once(i, "(grows with each section: 7 with F and A, 39 with every section; I17 is the guard)",
             "(grows with each section: 7 with F and A, 39 with every spec section, " + COUNTS_SHORT + "; I17 is the guard)", "I16")
    write(out / "tests/identity.sql", i)
    for f in ["35-hardening-test", "study-w3"]:
        write(out / f"tests/{f}.sql", read(spec / f"tests/{f}.sql"))


def f_edits(f: str, where: str) -> str:
    """F's checks: F27's allow-list gains section B's five worker functions
    (they check the server key themselves), F21 names the switches bank and
    pulse. Applied to the spec's copy and to F0's real tests/study.sql
    (review F-16: the edits belong in F's real file, F1Δ carries them)."""
    f = once(f, "'study_is_member', 'study_lecture_group', 'study_is_member_path');",
             "'study_is_member', 'study_lecture_group', 'study_is_member_path',\n"
             "                         'study_bank_take', 'study_bank_input', 'study_bank_report', 'study_bank_save', 'study_bank_finish');",
             f"F27 ({where}): the worker's five functions of section B")
    f = once(f, "(expect recordings and exams false)", "(expect bank, exams, pulse and recordings false)", f"F21 ({where})")
    return f


def build_f0(src: pathlib.Path, out: pathlib.Path) -> None:
    """F0's real supabase/tests/study.sql (branch study/f0, as the feasibility
    review copied it read-only) with F's edits, for run.sh step 8."""
    write(out / "study.sql", f_edits(read(src), "F0's real file"))


COUNTS = ("80 with every section and the addendum: the spec 39 (repo 5, F 2, W 3, Q 7, Z 5, C 8, K 1, P 8), the addendum 41 "
          "(the ends of Q 2, C 4, K 4; M 9, V 7, U 1, J 7, H 1, B 1, G 2, E 2, T 1)")
COUNTS_SHORT = "80 with the addendum"

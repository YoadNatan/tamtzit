#!/usr/bin/env python3
"""Builds the final addendum's SQL and checks (spec §12) from the three
designs (meeting, fun, server) and the review's edits, each asserted to
match exactly once (lib.once), as spec/final/edits/*.py did for the spec.

  build/spec/sql, build/spec/tests  the spec's sections and checks with the
                                    small edits other packages' files need
                                    (§12.9): merge lines, check texts
  sql/                              the addendum's SQL: section ends and new
                                    sections, in load order
  tests/                            the addendum's checks

Reads the worktree, the spec and the three designs read-only.
usage: build.py
"""
import importlib
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import lib  # noqa: E402
from lib import once, read, write, SPEC, MEET, FUN, SRV, FINAL  # noqa: E402

SQL = FINAL / "sql"
TESTS = FINAL / "tests"
BSPEC = FINAL / "build/spec"

# ── the order the new SQL loads in (after the spec's sections; the ends go at
#    the end of their section, the new sections after P) ──
ORDER = ["45-questions-end", "55-quiz-end", "65-cards-end", "75-collab-end", "85-progress-end",
         "90-meeting", "91-anchor", "92-var", "93-pulse", "94-wall", "95-boss",
         "96-bank", "97-plan", "98-extras", "99-today"]

SOURCES = {
    "45-questions-end": [MEET / "sql/45-questions-end.sql", SRV / "sql/46-questions-end.sql"],
    "55-quiz-end": [FUN / "build/with-meeting/55-quiz-end.sql"],
    "65-cards-end": [MEET / "sql/65-cards-end.sql", SRV / "sql/66-cards-end.sql"],
    "75-collab-end": [MEET / "sql/75-collab-end.sql", SRV / "sql/76-collab-end.sql"],
    "85-progress-end": [SRV / "sql/86-progress-end.sql"],
    "90-meeting": [MEET / "sql/90-meeting.sql"],
    "91-anchor": [MEET / "sql/91-anchor.sql"],
    "92-var": [MEET / "sql/92-var.sql"],
    "93-pulse": [FUN / "sql/U-pulse.sql"],
    "94-wall": [FUN / "sql/J-wall.sql"],
    "95-boss": [FUN / "sql/H-boss.sql"],
    "96-bank": [SRV / "sql/94-bank.sql"],
    "97-plan": [SRV / "sql/95-plan.sql"],
    "98-extras": [SRV / "sql/96-extras.sql"],
    "99-today": [MEET / "sql/93-today.sql"],
}


def build_sql() -> None:
    for name in ORDER:
        texts = [read(p) for p in SOURCES[name]]
        mod = importlib.import_module("sql_" + name.split("-", 1)[1].replace("-", "_"))
        lib.CURRENT[0] = f"sql/{name}.sql"
        out = mod.build(texts)
        write(SQL / f"{name}.sql", out)


def build_spec() -> None:
    mod = importlib.import_module("spec_edits")
    lib.CURRENT[0] = "the spec's files (§12.9)"
    mod.build(SPEC, BSPEC, read(SQL / "20-identity-merge.sql"))
    f0 = lib.ADD / "critique/feas/branches/f0.study-tests.sql"
    if f0.exists():
        lib.CURRENT[0] = "F0's real tests/study.sql"
        mod.build_f0(f0, FINAL / "build/f0")


def build_tests() -> None:
    mod = importlib.import_module("tests_build")
    lib.CURRENT[0] = "the designs' checks (tests/)"
    mod.build()


if __name__ == "__main__":
    build_sql()
    build_spec()
    build_tests()
    (FINAL / "out").mkdir(exist_ok=True)
    (FINAL / "out/edits.txt").write_text("\n".join(lib.LOG) + "\n")
    print(f"build: {len(lib.LOG)} edits applied, each matched exactly once (out/edits.txt)")

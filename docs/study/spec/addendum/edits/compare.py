#!/usr/bin/env python3
"""Compares a check run with the designs' baseline run, line by line by check
label, so a changed "(expect …)" line is never missed: the FAIL/ok lines are
counted by the run itself, and the informational lines (a value next to its
"(expect …)") are listed here when their text changed. Every change must be
one the review intended (spec §12.8.3 lists them).

usage: compare.py <baseline.txt> <current.txt> [--labels-only]
"""
import re
import sys

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TS = re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:\d{2})?)?")
HHMM = re.compile(r"\b\d{2}:\d{2}(:\d{2})?\b")
LABEL = re.compile(r"^\s*([A-Z]{1,3}[0-9]*[a-z0-9-]*(?:-reg)?)\.\s")


def norm(line: str) -> str:
    line = re.sub(r"^psql:<stdin>:\d+: ", "", line)
    line = re.sub(r"^(NOTICE|WARNING):\s+", "", line)
    line = UUID.sub("<uuid>", line)
    line = TS.sub("<ts>", line)
    line = HHMM.sub("<hh:mm>", line)
    line = re.sub(r"\b\d{3,}\s?ms\b", "<n> ms", line)
    return line.strip()


def labelled(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in open(path, encoding="utf-8", errors="replace"):
        n = norm(raw)
        m = LABEL.match(n)
        if m:
            key = m.group(1)
            k, i = key, 2
            while k in out:
                k = f"{key}#{i}"
                i += 1
            out[k] = n
    return out


def main() -> None:
    base, cur = labelled(sys.argv[1]), labelled(sys.argv[2])
    changed = [k for k in base if k in cur and base[k] != cur[k]]
    gone = [k for k in base if k not in cur]
    new = [k for k in cur if k not in base]
    print(f"labels: baseline {len(base)}, now {len(cur)}; changed {len(changed)}, gone {len(gone)}, new {len(new)}")
    if "--labels-only" in sys.argv:
        print("changed:", " ".join(changed))
        print("gone:", " ".join(gone))
        print("new:", " ".join(new))
        return
    for k in changed:
        print(f"~ {k}\n    was: {base[k][:300]}\n    now: {cur[k][:300]}")
    for k in gone:
        print(f"- {k}: {base[k][:200]}")
    for k in new:
        print(f"+ {k}: {cur[k][:300]}")


if __name__ == "__main__":
    main()

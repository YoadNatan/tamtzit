"""Helpers for the final addendum's edits (spec §12). Every replacement must
match exactly once, as spec/final/edits/*.py require, so a source that moved
stops the build instead of being edited in the wrong place."""
import pathlib
import re
import sys

SCRATCH = pathlib.Path(__file__).resolve().parents[4]
BASE = SCRATCH / "wt/base"
SPEC = BASE / "docs/study/spec"
ADD = SCRATCH / "spec/addendum"
MEET, FUN, SRV = ADD / "meeting", ADD / "fun", ADD / "server"
FINAL = ADD / "final"

LOG: list[str] = []
CURRENT = [""]   # the file being built, for out/edits.txt


def once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        sys.exit(f"edit {label}: expected 1 match, found {n}")
    LOG.append(f"{CURRENT[0]}: {label}")
    return text.replace(old, new)


def times(text: str, old: str, new: str, k: int, label: str) -> str:
    n = text.count(old)
    if n != k:
        sys.exit(f"edit {label}: expected {k} matches, found {n}")
    LOG.append(f"{CURRENT[0]}: {label} (×{k})")
    return text.replace(old, new)


def fn_span(text: str, name: str, nth: int = 1) -> tuple[int, int]:
    """The span of the nth 'create or replace function <name>(' statement,
    from its first comment line above (contiguous '--' lines) to the end of
    its dollar-quoted body and the ';' after it."""
    pat = re.compile(r"create or replace function " + re.escape(name) + r"\(")
    ms = list(pat.finditer(text))
    if len(ms) < nth:
        sys.exit(f"fn_span {name}: found {len(ms)}, wanted #{nth}")
    m = ms[nth - 1]
    start = m.start()
    # the dollar tag of the body
    tag_m = re.compile(r"as (\$[a-z_]*\$)").search(text, m.end())
    if not tag_m:
        sys.exit(f"fn_span {name}: no body")
    tag = tag_m.group(1)
    body_end = text.find(tag, tag_m.end())
    if body_end < 0:
        sys.exit(f"fn_span {name}: body not closed")
    end = text.find(";", body_end + len(tag)) + 1
    # include the line break after it
    if text[end:end + 1] == "\n":
        end += 1
    return start, end


def replace_fn(text: str, name: str, new: str, label: str, nth: int = 1) -> str:
    s, e = fn_span(text, name, nth)
    LOG.append(f"{CURRENT[0]}: {label}")
    return text[:s] + new.rstrip("\n") + "\n" + text[e:]


def drop_fn(text: str, name: str, label: str, nth: int = 1, with_comment: bool = True) -> str:
    s, e = fn_span(text, name, nth)
    if with_comment:
        # take the comment lines right above the statement with it
        lines_before = text[:s].split("\n")
        # lines_before[-1] is '' (s is at a line start)
        k = len(lines_before) - 1
        while k > 0 and lines_before[k - 1].startswith("--"):
            k -= 1
        s = len("\n".join(lines_before[:k])) + (1 if k > 0 else 0)
    LOG.append(f"{CURRENT[0]}: {label}")
    return text[:s] + text[e:]


def read(p: pathlib.Path) -> str:
    return p.read_text()


def write(p: pathlib.Path, t: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(t)

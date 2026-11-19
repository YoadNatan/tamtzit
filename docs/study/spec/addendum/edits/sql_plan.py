"""Spec §12: the final text of this section (see §12.10 for the review's edits)."""
from lib import once


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    return t

"""Section N (package N): the meeting design's section with the review's
fixes (§12.10): it loads without section M (its taps are read through a
guarded helper, F-10); the association chip counts the wall's entries
(section J), not K's retired mnemonic comments (F-13); a question two
members hid is out of the chips and shows as "בבדיקה" in the tab (F-6)."""
from lib import once

SPOTS = r"""-- The caller's own "לא ברור" paragraphs of the last 14 days not yet seen
-- again (section M's taps), and the wall's visible entries per paragraph
-- (section J): read only when those sections exist, so section N loads
-- and runs without them (review F-10, F-13).
create or replace function study_private.my_unclear_spots(p_lecture uuid)
returns table (part_idx int, anchor int) language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.study_meeting_taps') is null then return; end if;
  return query execute
    'select t.part_idx, t.anchor from public.study_meeting_taps t
      where t.user_id = auth.uid() and t.lecture_id = $1 and t.done_at is null and t.created_at > now() - interval ''14 days''
      group by 1, 2' using p_lecture;
end;
$$;
create or replace function study_private.aid_spots(p_lecture uuid)
returns table (part_idx int, anchor int, n int) language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.study_aids') is null then return; end if;
  return query execute
    'select a.part_idx, a.anchor, count(*)::int from public.study_aids a
      where a.lecture_id = $1 and a.kind <> ''draft'' and a.flag is distinct from ''not_ok''
      group by 1, 2' using p_lecture;
end;
$$;
revoke all on function study_private.my_unclear_spots(uuid), study_private.aid_spots(uuid) from public;

drop function if exists public.study_paragraph_chips(uuid);   -- its result changed: 'aids' (the wall's) replaces 'mnemonics'
"""


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, """--  SECTION N · THE PARAGRAPH ANCHOR   (package N; meeting addendum §5)
--  After section M (the private "לא ברור" chip reads its taps). Re-runnable.
--
--  A2  the chip row under each paragraph: how many questions, cards,
--      comments and shared memory aids sit on it (the group's), and two""", """--  SECTION N · THE PARAGRAPH ANCHOR   (package N; spec §12.4.N)
--  After sections Q's and C's ends. Section M's taps and section J's wall
--  are read when they exist (review F-10, F-13). Re-runnable.
--
--  A2  the chip row under each paragraph: how many questions, cards,
--      comments and wall entries sit on it (the group's), and two""", "N: the header")
    t = once(t, """create or replace function public.study_paragraph_chips(p_lecture uuid)
returns table (part_idx int, anchor int, questions int, cards int, comments int, mnemonics int, my_wrong int, my_unclear boolean)""",
             SPOTS + """create or replace function public.study_paragraph_chips(p_lecture uuid)
returns table (part_idx int, anchor int, questions int, cards int, comments int, aids int, my_wrong int, my_unclear boolean)""",
             "F-10, F-13: the chips' helpers")
    t = once(t, """     where x.lecture_id = p_lecture and x.anchor is not null and x.retired_at is null and x.has_key
     group by 1, 2
  ),""", """     where x.lecture_id = p_lecture and x.anchor is not null and x.retired_at is null and x.has_key
       and x.hidden_at is null                                                     -- review F-6
     group by 1, 2
  ),""", "F-6: hidden questions are not counted on the chip")
    t = once(t, """     where x.lecture_id = p_lecture and x.anchor is not null and x.deleted_at is null
     group by 1, 2
  ),""", """     where x.lecture_id = p_lecture and x.anchor is not null and x.deleted_at is null
       and (x.opens_at is null or x.opens_at <= now())                             -- review SEC-6
     group by 1, 2
  ),""", "SEC-6: a trap card not yet open is not counted")
    t = once(t, """    select x.part_idx, x.anchor,
           (count(*) filter (where x.kind in ('comment', 'question', 'answer')))::int as comments,
           (count(*) filter (where x.kind = 'mnemonic'))::int as mnemonics
      from public.study_comments x
     where x.lecture_id = p_lecture and x.parent_id is null
     group by 1, 2
  ),""", """    select x.part_idx, x.anchor,
           (count(*) filter (where x.kind in ('comment', 'question', 'answer')))::int as comments
      from public.study_comments x
     where x.lecture_id = p_lecture and x.parent_id is null
     group by 1, 2
  ),
  ai as (select s.part_idx, s.anchor, s.n from study_private.aid_spots(p_lecture) s),""", "F-13: the wall's entries")
    t = once(t, """  mu as (
    select t.part_idx, t.anchor from public.study_meeting_taps t
     where t.user_id = auth.uid() and t.lecture_id = p_lecture and t.done_at is null and t.created_at > now() - interval '14 days'
     group by 1, 2
  ),""", """  mu as (select s.part_idx, s.anchor from study_private.my_unclear_spots(p_lecture) s),""", "F-10: the taps through the helper")
    t = once(t, """    select part_idx, anchor from q union select part_idx, anchor from c union select part_idx, anchor from cm
    union select part_idx, anchor from mw union select part_idx, anchor from mu""", """    select part_idx, anchor from q union select part_idx, anchor from c union select part_idx, anchor from cm
    union select part_idx, anchor from ai union select part_idx, anchor from mw union select part_idx, anchor from mu""", "F-13: union")
    t = once(t, """  select k.part_idx, k.anchor, coalesce(q.n, 0), coalesce(c.n, 0), coalesce(cm.comments, 0), coalesce(cm.mnemonics, 0),""",
             """  select k.part_idx, k.anchor, coalesce(q.n, 0), coalesce(c.n, 0), coalesce(cm.comments, 0), coalesce(ai.n, 0),""", "F-13: select")
    t = once(t, """    left join cm on cm.part_idx = k.part_idx and cm.anchor = k.anchor
""", """    left join cm on cm.part_idx = k.part_idx and cm.anchor = k.anchor
    left join ai on ai.part_idx = k.part_idx and ai.anchor = k.anchor
""", "F-13: join")
    t = once(t, """           'id', q.id, 'kind', q.kind, 'question', q.question, 'teaser', q.teaser, 'stale', q.stale_at is not null,""",
             """           'id', q.id, 'kind', q.kind, 'question', q.question, 'teaser', q.teaser, 'stale', q.stale_at is not null,
           'hidden', q.hidden_at is not null,                                           -- review F-6: "בבדיקה", never practised""", "F-6: the tab marks hidden questions")
    t = once(t, """   where c.lecture_id = p_lecture and c.part_idx = p_part and c.anchor = p_anchor and c.deleted_at is null;""",
             """   where c.lecture_id = p_lecture and c.part_idx = p_part and c.anchor = p_anchor and c.deleted_at is null
     and (c.opens_at is null or c.opens_at <= now());                              -- review SEC-6""", "SEC-6: the tab lists open cards")
    return t

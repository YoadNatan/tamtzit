"""Section Q's end (package Q, milestone Q-1): the meeting design's lines
(anchors, teasers, the bet column, marks after a correction) and the server
design's (the bet in practice, "מתי כן", another wording, two flags hide, the
diagram, option tags, the worker path), merged into one block, with the
review's fixes (§12.10)."""
from lib import once, drop_fn

HEAD = """-- ════════════════════════════════════════════════════════════════════════
--  SECTION Q, its end · ANCHORS, TEASERS, THE BET, "מתי כן", ANOTHER WORDING,
--  TWO FLAGS HIDE, THE DIAGRAM, OPTION TAGS, THE WORKER PATH, MARKS AFTER A
--  CORRECTION   (package Q, milestone Q-1; spec §12.3.Q)
--  Appended at the END of section Q, inside its markers. Q becomes version 2.
--
--  A1  every question sits on one paragraph of its part (data-blk), with the
--      paragraph's first words for re-anchoring after a rewrite.
--  M1  a teaser (one line, written with the bank) for the meeting's opening.
--  P2 / Q3  the bet (study_answers.confidence: 1 ניחוש · 2 נראה לי · 3 על
--      בטוח), written by practice (study_answer_question) and by the live
--      quiz's reveal (section Z's end), never by a member's 'quiz' answer.
--  P3  "מתי כן" per option, kept with the key, returned only after an answer.
--  P4  a miss returns in another wording (study_my_rewordings).
--  P5  two members' counting flags hide a question from everyone, everywhere
--      (hidden_at), until a member fixes it with a slide citation; only a
--      hidden question opens the fix sheet, and never while a live quiz holds
--      its key (review SEC-2, SEC-13).
--  P7  the blind solver's rejections, counted per batch.
--  P13 the slide's diagram (figure). Q12 the options' drugs (option_tags).
--  R2  a correction approved on the paragraph marks the question stale
--      (section V's trigger) until "עדיין נכון" or new questions.
--  D3  the worker path: section B's worker plans, claims, saves and
--      finishes batches with the key alone; a part the Batch API holds
--      (hold_until) is busy for a tap.
-- ════════════════════════════════════════════════════════════════════════
"""


def strip_head(t: str) -> str:
    """Drop a design file's leading comment block (up to the first line that
    is not a comment)."""
    lines = t.split("\n")
    k = 0
    while k < len(lines) and (lines[k].startswith("--") or lines[k].strip() == ""):
        k += 1
    return "\n".join(lines[k:])


REG = ("insert into study_private.schema_sections (section, version) values ('Q', 2)\n"
       "on conflict (section) do update set version = excluded.version, loaded_at = now();\n")


def build(texts: list[str]) -> str:
    meet, srv = texts
    meet = strip_head(meet)
    meet = drop_fn(meet, "public.study_save_question", "Q: one study_save_question (the server design's superset)")
    meet = once(meet, REG, "", "Q: one registry line")
    srv = strip_head(srv)
    srv = once(srv, """alter table public.study_questions
  add column if not exists anchor     int  check (anchor between 0 and 9999),
  add column if not exists quote      text not null default '' check (char_length(quote) <= 200),
  add column if not exists part_gen   int  check (part_gen >= 0),
  add column if not exists teaser     text not null default '' check (char_length(teaser) <= 120),
  add column if not exists stale_at   timestamptz;
alter table public.study_answers
  add column if not exists confidence smallint check (confidence between 1 and 3);

""", "", "Q: the server lines' repeated columns go (merged)")
    out = HEAD + meet.rstrip() + "\n\n" + srv
    out = fix(out)
    return out


def fix(t: str) -> str:
    # SEC-7: a member never writes a 'quiz' answer (section Z's reveal copies
    # first votes itself), so nobody can forge a quiz answer, unmask a
    # member's trap (section E) or write her own "quiz returns" (section T);
    # a hidden question is refused in every mode that remains.
    t = once(t, """  if q.hidden_at is not null and coalesce(p_mode, '') <> 'quiz' then raise exception 'hidden'; end if;""",
             """  if coalesce(p_mode, '') not in ('lecture', 'course', 'mistakes', 'exam') then raise exception 'bad mode'; end if;   -- review SEC-7
  if q.hidden_at is not null then raise exception 'hidden'; end if;""", "SEC-7: study_answer_question refuses mode 'quiz'")
    t = once(t, """  if coalesce(p_mode, '') not in ('lecture', 'course', 'mistakes', 'quiz', 'exam') then raise exception 'bad mode'; end if;
  if p_confidence""", """  if p_confidence""", "SEC-7: one mode check")
    # SEC-2 / SEC-13: the fix sheet and the fix only for a HIDDEN question
    # (two different members' counting flags), never while a live quiz
    # holds its key.
    t = once(t, """  if coalesce(p_verdict, '') not in ('keep', 'retire') then raise exception 'bad verdict'; end if;
  if q.hidden_at is null and not exists (select 1 from public.study_question_flags f where f.question_id = p_question) then
    raise exception 'not flagged';
  end if;""", """  if coalesce(p_verdict, '') not in ('keep', 'retire') then raise exception 'bad verdict'; end if;
  if q.hidden_at is null then raise exception 'not flagged'; end if;                      -- review SEC-13: two members' flags
  if exists (select 1 from public.study_question_keys k where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';                                                            -- review SEC-2
  end if;""", "SEC-13: retire or keep only a hidden question")
    t = once(t, """-- A member fixes a hidden (or flagged) question: 'keep' with the slides that
-- show the key is right (a citation is required), or 'retire' it for good.""",
"""-- A member fixes a hidden question (two different members' counting flags;
-- one member's flag never retires a question for everyone, review SEC-13):
-- 'keep' with the slides that show the key is right (a citation is
-- required), or 'retire' it for good. Never while a live quiz holds the key.""", "SEC-13: comment")
    t = once(t, """  if q.hidden_at is null and not exists (select 1 from public.study_question_flags f where f.question_id = p_question) then
    raise exception 'not flagged';
  end if;
  return query""", """  if q.hidden_at is null then raise exception 'not flagged'; end if;                      -- review SEC-2: two members' flags
  if exists (select 1 from public.study_question_keys k where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';                                                            -- review SEC-2: the quiz's hold
  end if;
  return query""", "SEC-2: the fix sheet only for a hidden question, never in a quiz")
    t = once(t, """-- The fix sheet ("לבדוק מול השקף"): the key, explanations and flags of a
-- question that is hidden or flagged, for any member of its group. The one
-- place a key is shown before an answer: the question is out of practice
-- while it waits, and checking it needs the key.""",
"""-- The fix sheet ("לבדוק מול השקף"): the key, explanations and flags of a
-- HIDDEN question (two different members' counting flags), for any member of
-- its group. The one place a key is shown before an answer: a hidden question
-- is out of practice, quizzes, the meeting and Today while it waits
-- (review F-6), and checking it needs the key. One's own flag of any reason
-- opens nothing, and a key a live quiz holds stays held (review SEC-2).""", "SEC-2: comment")
    return t

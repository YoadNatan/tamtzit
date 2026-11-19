"""Section K's end (package K, milestone K-2): the meeting design's
correction with a source and a second approval, and the server design's
"לשאול את הקבוצה", who marked a question answered and the optional check of
a correction, with the review's fixes (§12.10): an undo only of the latest
correction and only to its own text (SEC-1), approval aloud only in a live
meeting with followers and never one's own (SEC-3), Claude's attempt only
with the server key (SEC-9)."""
from lib import once, times
from sql_questions_end import strip_head

HEAD = """-- ════════════════════════════════════════════════════════════════════════
--  SECTION K, its end · A CORRECTION NEEDS A SOURCE AND A SECOND APPROVAL;
--  "לשאול את הקבוצה"; WHO MARKED A QUESTION ANSWERED; THE OPTIONAL CHECK OF
--  A CORRECTION   (package K, milestone K-2; spec §12.3.K). Appended at the
--  END of section K, inside its markers. K becomes version 2.
-- ════════════════════════════════════════════════════════════════════════
"""

REG = ("insert into study_private.schema_sections (section, version) values ('K', 2)\n"
       "on conflict (section) do update set version = excluded.version, loaded_at = now();\n")


def build(texts: list[str]) -> str:
    meet, srv = texts
    meet = once(meet, REG, "", "K: one registry line")
    return fix(meet.rstrip() + "\n\n" + srv)


def fix(t: str) -> str:
    t = once(t, """--  aloud (section M: the reader of a live meeting on this lecture). Applied,
--  it is a study_edits row as before, now with its proposal, source and
--  approver. An undo stays one tap and immediate (study_edit_block with
--  p_undo_of); every other direct call of study_edit_block is refused.""",
"""--  aloud (section M: the reader of today's live meeting on this lecture,
--  with two other members following; never the reader's own proposal,
--  review SEC-3). Applied, it is a study_edits row as before, now with its
--  proposal, source and approver. An undo stays one tap and immediate, but
--  only of the paragraph's latest correction and only back to its own text
--  (study_undo_edit, or study_edit_block with p_undo_of and the two texts
--  swapped; review SEC-1); every other direct call of study_edit_block is
--  refused.""", "SEC-1, SEC-3: the header")
    # SEC-1: an undo is bound to the edit it undoes: the paragraph's latest
    # correction (not itself an undo), and exactly its after -> before.
    t = once(t, """  if p_undo_of is not null and not exists (
       select 1 from public.study_edits e
        where e.id = p_undo_of and e.lecture_id = p_lecture and e.part_idx = p_part
          and e.gen = s.gen and e.anchor = p_anchor) then
    raise exception 'bad undo';
  end if;""", """  if p_undo_of is not null then
    -- review SEC-1: only the paragraph's latest correction, not an undo
    -- itself, and only back to its own text (no other text rides on an undo)
    select * into u from public.study_edits e
     where e.id = p_undo_of and e.lecture_id = p_lecture and e.part_idx = p_part
       and e.gen = s.gen and e.anchor = p_anchor;
    if not found or coalesce(u.source_kind, '') = 'undo'
       or exists (select 1 from public.study_edits e2
                   where e2.lecture_id = p_lecture and e2.part_idx = p_part and e2.anchor = p_anchor
                     and e2.gen = s.gen and e2.rev > u.rev)
       or public.study_tidy(coalesce(p_before, '')) <> public.study_tidy(u.after_text)
       or v_after <> public.study_tidy(u.before_text) then
      raise exception 'bad undo';
    end if;
  end if;""", "SEC-1: the undo is bound to its edit")
    t = once(t, """  v_rev    int;
  v_id     uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  if p_anchor is null""", """  v_rev    int;
  v_id     uuid;
  u        public.study_edits;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  if p_anchor is null""", "SEC-1: edit_apply declares the undone edit")
    t = once(t, """-- One tap undoes a correction, at once (section K's signature). Without
-- p_undo_of a change must be proposed: 'needs approval'.""", """-- One tap undoes a correction, at once (section K's signature). Without
-- p_undo_of a change must be proposed: 'needs approval'. With it, the texts
-- must be the undone correction's own, swapped (review SEC-1: 'bad undo').""", "SEC-1: comment")
    t = once(t, """-- "הצעת תיקון". Checked now""", """-- The app's one-tap undo (review SEC-1): the server reads the correction
-- and puts its text back; the phone sends nothing but the edit's id.
create or replace function public.study_undo_edit(p_edit uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.study_edits;
  s public.study_sections;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into e from public.study_edits x where x.id = p_edit;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(e.lecture_id)), false) then
    raise exception 'bad undo';
  end if;
  select * into s from public.study_sections x where x.lecture_id = e.lecture_id and x.idx = e.part_idx;
  if not found then raise exception 'part not found'; end if;
  return study_private.edit_apply(e.lecture_id, e.part_idx, e.anchor, e.after_text, e.before_text, s.rev, s.gen, 1, '',
                                  e.id, auth.uid(), null, false, null, 'undo', '{}', null, '');
end;
$$;
revoke all on function public.study_undo_edit(uuid) from public, anon;
grant execute on function public.study_undo_edit(uuid) to authenticated;

-- "הצעת תיקון". Checked now""", "SEC-1: study_undo_edit")
    # SEC-3: approval aloud only by the reader of today's live meeting, with
    # the place reported in the last minute and two other members following
    # (section M's study_private.meeting_reads_live), and never one's own.
    t = once(t, """  if p.state <> 'pending' then raise exception 'not pending'; end if;
  if coalesce(p_aloud, false) then
    ok := false;
    if to_regclass('public.study_meetings') is not null then
      execute 'select exists (select 1 from public.study_meetings m
                 where m.lecture_id = $1 and m.reader_id = $2 and m.reading and m.cancelled_at is null)'
        into ok using p.lecture_id, auth.uid();
    end if;
    if not ok then raise exception 'not the reader'; end if;
  elsif p.proposed_by = auth.uid() then
    raise exception 'own proposal';
  end if;""", """  if p.state <> 'pending' then raise exception 'not pending'; end if;
  if p.proposed_by = auth.uid() then raise exception 'own proposal'; end if;              -- review SEC-3: aloud too
  if coalesce(p_aloud, false) then
    ok := false;
    if to_regprocedure('study_private.meeting_reads_live(uuid,uuid)') is not null then    -- section M
      execute 'select study_private.meeting_reads_live($1, $2)' into ok using p.lecture_id, auth.uid();
    end if;
    if not coalesce(ok, false) then raise exception 'not live'; end if;                    -- review SEC-3
  end if;""", "SEC-3: aloud only in a live meeting, never one's own")
    # SEC-9: Claude's attempt rides on a question only through the op, which
    # checks the answer's signature (the ask op's own HMAC of the turn) and
    # calls with the server key; a member's own text is never labelled Claude's.
    t = once(t, """create or replace function public.study_ask_to_group(p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_question text, p_attempt text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g   uuid := public.study_lecture_group(p_lecture);
  qid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;""", """drop function if exists public.study_ask_to_group(uuid, int, int, text, text, text);
create or replace function public.study_ask_to_group(p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_question text, p_attempt text, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g   uuid := public.study_lecture_group(p_lecture);
  qid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- review SEC-9: an attempt is Claude's only when the op (server key, the
  -- answer's signature checked) sends it; a member alone posts the question
  if char_length(btrim(coalesce(p_attempt, ''))) > 0 and not study_private.is_worker(p_key) then
    raise exception 'forbidden';
  end if;""", "SEC-9: the attempt needs the server key")
    t = once(t, """-- K2: the asker posts her question on the paragraph with Claude's attempt
-- (the answer she got from "לשאול", at most 2,000 characters). Returns the
-- question's id. A member cannot set ask_attempt herself (no column grant).""", """-- K2: the asker posts her question on the paragraph with Claude's attempt
-- (the answer she got from "לשאול", at most 2,000 characters). Returns the
-- question's id. A member cannot set ask_attempt herself (no column grant),
-- and the attempt comes only through op "ask" (its share path checks the
-- answer's signature, the done line's HMAC, and calls with the server key;
-- review SEC-9); without it a member posts her question alone.""", "SEC-9: K2's comment")
    t = times(t, "public.study_ask_to_group(uuid, int, int, text, text, text),", "public.study_ask_to_group(uuid, int, int, text, text, text, text),", 2,
              "SEC-9: grants on the new signature")
    return t

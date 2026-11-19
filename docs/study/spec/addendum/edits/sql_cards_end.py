"""Section C's end (package C): the meeting design's lines (anchors, trap
cards, marks after a correction) and the server design's (the deck part by
part, private cards, one review home, the worker path), merged, with the
review's fixes (§12.10): the private cards and their trigger load without
section Q (F-4)."""
from lib import once, drop_fn
from sql_questions_end import strip_head

HEAD = """-- ════════════════════════════════════════════════════════════════════════
--  SECTION C, its end · ANCHORS, TRAP CARDS, MARKS AFTER A CORRECTION, THE
--  DECK PART BY PART, PRIVATE CARDS, ONE REVIEW HOME, THE WORKER PATH
--  (package C; spec §12.3.C). Appended at the END of section C, inside its
--  markers. C becomes version 2.
--
--  A1  every generated card sits on one paragraph (data-blk) of its part.
--  Q7 / R4 / P8 / MU3  a trap card is a group card the app makes, never
--      Claude (source 'trap', one per trap_key), from a quiz round, an
--      accepted VAR verdict or the pulse; it reaches every deck as a new
--      card, first among the new ones and inside the 20-a-day limit.
--  R2  a correction approved on the paragraph marks the card stale (section
--      V) until "עדיין נכון" or an edit of its text.
--  D8  decision 8: the full deck, added to one's own deck part by part, at
--      most 20 new cards a day; new only in an added part, a trap card or
--      one's own card.
--  C5  private cards from one's own mistakes (the autopsy on the back), the
--      answer to one's question (K4) and a blank table's wrong cell (P10):
--      owner-only, never published, merged. The table and its trigger on
--      section Q's answers are created once section Q exists, so section C
--      also loads before Q (review F-4).
--  C6  one review home per person (Anki or the app).  D3  the worker path.
-- ════════════════════════════════════════════════════════════════════════
"""

REG = ("insert into study_private.schema_sections (section, version) values ('C', 2)\n"
       "on conflict (section) do update set version = excluded.version, loaded_at = now();\n")


def build(texts: list[str]) -> str:
    meet, srv = texts
    meet = strip_head(meet)
    meet = drop_fn(meet, "public.study_save_card", "C: one study_save_card (the server design's superset)")
    meet = once(meet, REG, "", "C: one registry line")
    srv = strip_head(srv)
    srv = once(srv, """alter table public.study_cards
  add column if not exists anchor   int  check (anchor between 0 and 9999),
  add column if not exists quote    text not null default '' check (char_length(quote) <= 200),
  add column if not exists part_gen int  check (part_gen >= 0),
  add column if not exists stale_at timestamptz;

""", "", "C: the server lines' repeated columns go (merged)")
    return fix(HEAD + meet.rstrip() + "\n\n" + srv)


def fix(t: str) -> str:
    # SEC-6: a quiz round's trap card opens at the next study day's start:
    # until then no member reads it (RLS, and every definer list below), and
    # Realtime, which applies RLS to each event, delivers nothing at the reveal.
    t = once(t, """  add column if not exists checked_at timestamptz;
alter table public.study_cards drop constraint if exists study_cards_source_check;""", """  add column if not exists checked_at timestamptz,
  add column if not exists opens_at   timestamptz;               -- a trap card hidden until then (review SEC-6)
alter table public.study_cards drop constraint if exists study_cards_source_check;""", "SEC-6: study_cards.opens_at")
    t = once(t, """create or replace function study_private.trap_card(p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_front text, p_back text, p_extra text, p_slides int[], p_key text)
returns uuid""", """drop function if exists study_private.trap_card(uuid, int, int, text, text, text, text, int[], text);
create or replace function study_private.trap_card(p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_front text, p_back text, p_extra text, p_slides int[], p_key text, p_opens_at timestamptz default null)
returns uuid""", "SEC-6: trap_card takes when it opens")
    t = once(t, """  insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, slides, anchor, quote, part_gen, trap_key, created_by)
  values (g, p_lecture, 'trap', p_part, 'qa', btrim(p_front), btrim(p_back), coalesce(p_extra, ''), coalesce(p_slides, '{}'),
          p_anchor, coalesce(left(p_quote, 200), ''),
          case when p_anchor is null then null else (select s.gen from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) end,
          left(p_key, 120), null)""", """  insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, slides, anchor, quote, part_gen,
                                  trap_key, created_by, opens_at)
  values (g, p_lecture, 'trap', p_part, 'qa', btrim(p_front), btrim(p_back), coalesce(p_extra, ''), coalesce(p_slides, '{}'),
          p_anchor, coalesce(left(p_quote, 200), ''),
          case when p_anchor is null then null else (select s.gen from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) end,
          left(p_key, 120), null, case when p_opens_at > now() then p_opens_at end)""", "SEC-6: the trap card's opening time")
    t = once(t, """revoke all on function study_private.trap_card(uuid, int, int, text, text, text, text, int[], text),""",
             """revoke all on function study_private.trap_card(uuid, int, int, text, text, text, text, int[], text, timestamptz),""",
             "SEC-6: revoke the new signature")
    t = once(t, """revoke all on function study_private.trap_card(uuid, int, int, text, text, text, text, int[], text, timestamptz),
  study_private.trap_card_drop(uuid) from public;""", """revoke all on function study_private.trap_card(uuid, int, int, text, text, text, text, int[], text, timestamptz),
  study_private.trap_card_drop(uuid) from public;
-- Members read a group card once it is open (review SEC-6). Replaces section
-- C's policy of the same name.
drop policy if exists "study cards read" on public.study_cards;
create policy "study cards read" on public.study_cards
  for select using (public.study_is_member(group_id) and (opens_at is null or opens_at <= now()));""", "SEC-6: the read policy")
    t = once(t, """         (select count(*)::int from public.study_cards c where c.lecture_id = p_lecture and c.part_idx = s.idx and c.deleted_at is null),""",
             """         (select count(*)::int from public.study_cards c where c.lecture_id = p_lecture and c.part_idx = s.idx and c.deleted_at is null
             and (c.opens_at is null or c.opens_at <= now())),""", "SEC-6: the deck page counts open cards")
    t = once(t, """  where c.group_id = p_group and c.deleted_at is null and coalesce(public.study_is_member(p_group), false)
  group by c.lecture_id;""", """  where c.group_id = p_group and c.deleted_at is null and coalesce(public.study_is_member(p_group), false)
    and (c.opens_at is null or c.opens_at <= p_now)          -- review SEC-6
  group by c.lecture_id;""", "SEC-6: the counts count open cards")
    # F-4: section C loads before section Q is merged (C beside Q-1): the
    # private card's question has its foreign key once section Q exists.
    t = once(t, """  question_id uuid             references public.study_questions (id) on delete set null,""",
             """  question_id uuid,                                  -- study_questions.id: the key is added below once section Q exists (review F-4)""",
             "F-4: no foreign key at create time")
    t = once(t, """create or replace function study_private.mistake_card(p_user uuid, p_question uuid, p_choice int, p_origin text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  q   public.study_questions;
  k   public.study_question_keys;""", """create or replace function study_private.mistake_card(p_user uuid, p_question uuid, p_choice int, p_origin text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  q   record;                      -- section Q's row types are not named, so section C loads before Q (review F-4)
  k   record;""", "F-4: the mistake card's variables need no type of section Q")
    t = once(t, """-- ── D3: the worker path (as section Q's end) ──""", """-- ── D3: the worker path (as section Q's end) ──
-- Who may drive a batch: identical to section Q's end's helper, repeated so
-- section C runs before section Q is merged (review F-4); whichever end loads
-- second replaces it with the same text.
create or replace function study_private.may_bank(p_lecture uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then return false; end if;
  if auth.uid() is null then return true; end if;
  return coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false);
end;
$$;
revoke all on function study_private.may_bank(uuid, text) from public;""", "F-4: may_bank repeated in C's end")
    t = once(t, """-- One card per question per member, and one per answered thread.""", """do $$
begin
  if to_regclass('public.study_questions') is not null
     and not exists (select 1 from pg_constraint where conname = 'study_my_cards_question_id_fkey') then
    alter table public.study_my_cards add constraint study_my_cards_question_id_fkey
      foreign key (question_id) references public.study_questions (id) on delete set null;
  end if;
end $$;
-- One card per question per member, and one per answered thread.""", "F-4: the foreign key once section Q exists")
    return t

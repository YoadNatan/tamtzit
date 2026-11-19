"""Section M (package M): the meeting design's section with the review's
fixes (§12.10): the reader cannot be taken over while reading, sees counts
only while live today, cannot tap, and reports a place that moves one part
at a time and releases a guess only with two followers (SEC-4, SEC-11);
approval aloud needs today's live reading with two followers (SEC-3); the
opening reads the group's nightly signal, never the players' private
answers (SEC-5, F-18); the catch-up's read mark is written the next study
day with the meeting's time (SEC-12); hidden questions are out (F-6); the
wall's moments replace K's retired mnemonic comments (F-13); opted-out
members are left out of the reader's counts and the guess majority, and the
guess warning follows the pulse switch (F-14)."""
from lib import once, replace_fn

HELPERS = r"""
-- ── Review helpers (spec §12.10) ──
-- Members who follow this meeting now, other than p_user: a presence row
-- refreshed within 10 minutes (following refreshes it every 3 minutes).
create or replace function study_private.meeting_followers(p_meeting uuid, p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.study_meeting_presence pr
   where pr.meeting_id = p_meeting and pr.user_id is distinct from p_user and pr.last_at > now() - interval '10 minutes'
$$;
-- p_user reads aloud today's meeting on p_lecture, live: the place reported
-- within the last minute and two other members following (review SEC-3:
-- the one condition under which an approval counts as "בקול בפגישה").
create or replace function study_private.meeting_reads_live(p_lecture uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.study_meetings m
      join public.study_meeting_live lv on lv.meeting_id = m.id
     where m.lecture_id = p_lecture and m.cancelled_at is null and m.reading and m.reader_id = p_user
       and m.day = study_private.day_of(now())
       and lv.place_at > now() - interval '1 minute'
       and study_private.meeting_followers(m.id, p_user) >= 2)
$$;
-- A member who left the pulse's count (section U) is left out of the
-- meeting's counts too (review F-14: decision 1's one answer). Without
-- section U nobody is out.
create or replace function study_private.pulse_out(p_group uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r boolean := false;
begin
  if to_regclass('public.study_pulse_optout') is null then return false; end if;
  execute 'select exists (select 1 from public.study_pulse_optout o where o.group_id = $1 and o.user_id = $2)'
    into r using p_group, p_user;
  return coalesce(r, false);
end;
$$;
-- The catch-ups finished on an earlier study day join "קראו" now, with the
-- meeting's own time (review SEC-12: no mark arrives live hours after the
-- meeting, and no mark carries the time of the catch-up).
create or replace function study_private.catchup_marks(p_group uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update public.study_meeting_catchups c set marked_at = now()
      from public.study_meetings m
     where m.id = c.meeting_id and m.group_id = p_group and c.marked_at is null
       and study_private.day_of(c.done_at) < study_private.day_of(now())
    returning c.user_id, m.lecture_id, coalesce(m.started_at, m.starts_at) as at)
  insert into public.study_reads (lecture_id, user_id, read_at)
  select d.lecture_id, d.user_id, min(d.at) from due d group by d.lecture_id, d.user_id
  on conflict (lecture_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function study_private.meeting_followers(uuid, uuid), study_private.meeting_reads_live(uuid, uuid),
  study_private.pulse_out(uuid, uuid), study_private.catchup_marks(uuid) from public;
"""

READING = r"""create or replace function public.study_meeting_reading(p_lecture uuid, p_on boolean, p_part int default 0, p_anchor int default 0)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  g   uuid := public.study_lecture_group(p_lecture);
  d   date := study_private.day_of(now());
  pt  int  := greatest(0, least(coalesce(p_part, 0), 199));
  an  int  := greatest(0, least(coalesce(p_anchor, 0), 99999));
  mid uuid;
  m   public.study_meetings;
begin
  if me is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('study_meeting:' || g::text));
  select x.id into mid from public.study_meetings x
   where x.group_id = g and x.day = d and x.lecture_id = p_lecture and x.cancelled_at is null;
  if not coalesce(p_on, false) then
    update public.study_meetings x set reading = false, version = x.version + 1, updated_at = now()
     where x.id = mid and x.reader_id = me and x.reading;
    return mid;
  end if;
  -- review SEC-4: nobody takes over a live reading. The reader hands over
  -- by stopping ("off"), or after a minute with no place reported.
  select * into m from public.study_meetings x where x.id = mid;
  if found and m.reading and m.reader_id is distinct from me
     and exists (select 1 from public.study_meeting_live lv where lv.meeting_id = mid and lv.place_at > now() - interval '60 seconds') then
    raise exception 'reading';
  end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = pt) then
    pt := coalesce((select min(s.idx) from public.study_sections s where s.lecture_id = p_lecture), 0);
    an := 0;
  end if;
  if mid is null then
    insert into public.study_meetings (group_id, day, starts_at, lecture_id, part_from, part_to, created_by)
    values (g, d, now(), p_lecture, pt, pt, me)
    returning id into mid;
  end if;
  update public.study_meetings x
     set reader_id = me, reading = true, started_at = coalesce(x.started_at, now()),
         read_part = greatest(coalesce(x.read_part, pt), pt),
         version = x.version + 1, updated_at = now()
   where x.id = mid;
  insert into public.study_meeting_live (meeting_id, part_idx, anchor, max_part, max_anchor, place_at)
  values (mid, pt, an, pt, an, now())
  on conflict (meeting_id) do update
    set part_idx = excluded.part_idx, anchor = excluded.anchor, place_at = excluded.place_at;
  insert into public.study_meeting_presence (meeting_id, user_id) values (mid, me)
  on conflict (meeting_id, user_id) do update set last_at = now();
  return mid;
end;
$$;"""

PLACE = r"""create or replace function public.study_meeting_place(p_meeting uuid, p_part int, p_anchor int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  m    public.study_meetings;
  lv   public.study_meeting_live;
  pt   int := greatest(0, least(coalesce(p_part, 0), 199));
  an   int := greatest(0, least(coalesce(p_anchor, 0), 99999));
  rel  int;
  q    public.study_questions;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting for update;
  if not found or not coalesce(public.study_is_member(m.group_id), false) then raise exception 'meeting not found'; end if;
  if m.reader_id is distinct from auth.uid() or not m.reading then raise exception 'not the reader'; end if;
  -- review SEC-4: a part of the lecture, and the furthest place moves at
  -- most one part a call (a jump to the end does not read the lecture)
  if not exists (select 1 from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = pt) then
    raise exception 'bad parts';
  end if;
  select * into lv from public.study_meeting_live x where x.meeting_id = p_meeting;
  if found and pt > lv.max_part + 1 then
    pt := lv.max_part + 1;
    an := 0;
  end if;
  insert into public.study_meeting_live (meeting_id, part_idx, anchor, max_part, max_anchor, place_at)
  values (p_meeting, pt, an, pt, an, now())
  on conflict (meeting_id) do update
    set part_idx = excluded.part_idx, anchor = excluded.anchor, place_at = excluded.place_at,
        max_part = case when (excluded.part_idx, excluded.anchor) > (study_meeting_live.max_part, study_meeting_live.max_anchor)
                        then excluded.part_idx else study_meeting_live.max_part end,
        max_anchor = case when (excluded.part_idx, excluded.anchor) > (study_meeting_live.max_part, study_meeting_live.max_anchor)
                          then excluded.anchor else study_meeting_live.max_anchor end
  returning * into lv;
  rel := m.guess_released;
  -- review SEC-4: a pre-guess is released by a reading the group follows
  -- (two other members here), never by one phone alone
  if study_private.meeting_followers(p_meeting, auth.uid()) >= 2 then
    while rel < cardinality(m.guess_ids) loop
      select * into q from public.study_questions x where x.id = m.guess_ids[rel + 1];
      exit when not found or q.part_idx is null
             or (coalesce(q.part_idx, 0), coalesce(q.anchor, 0)) > (lv.max_part, lv.max_anchor);
      rel := rel + 1;
    end loop;
  end if;
  if rel <> m.guess_released or lv.max_part > coalesce(m.read_part, -1) then
    update public.study_meetings x
       set guess_released = rel, read_part = greatest(coalesce(x.read_part, lv.max_part), lv.max_part),
           version = x.version + 1, updated_at = now()
     where x.id = p_meeting;
  end if;
  return rel;
end;
$$;"""

UNCLEAR = r"""create or replace function public.study_meeting_unclear(p_meeting uuid, p_part int, p_anchor int, p_quote text default '', p_on boolean default true)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare m public.study_meetings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if not coalesce(p_on, true) then
    delete from public.study_meeting_taps t
     where t.meeting_id = p_meeting and t.user_id = auth.uid() and t.part_idx = p_part and t.anchor = p_anchor and t.done_at is null;
    return false;
  end if;
  if not m.reading then raise exception 'not live'; end if;
  if m.reader_id = auth.uid() then raise exception 'is reader'; end if;            -- review SEC-11: the reader does not tap
  if p_anchor is null or p_anchor < 0 or p_anchor > 99999
     or not exists (select 1 from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = p_part) then
    raise exception 'bad parts';
  end if;
  -- review SEC-11: no text from the phone; each phone shows the paragraph's
  -- own first words from the summary it already has (p_quote is ignored)
  insert into public.study_meeting_taps (meeting_id, user_id, lecture_id, part_idx, anchor, quote)
  values (p_meeting, auth.uid(), m.lecture_id, p_part, p_anchor, '')
  on conflict (meeting_id, user_id, part_idx, anchor) do nothing;
  insert into public.study_meeting_presence (meeting_id, user_id) values (p_meeting, auth.uid())
  on conflict (meeting_id, user_id) do update set last_at = now();
  return true;
end;
$$;"""

READER_VIEW = r"""create or replace function public.study_meeting_reader_view(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m    public.study_meetings;
  v    jsonb;
  w    jsonb;
  q    public.study_questions;
  k    smallint;
  n    int;
  bad  int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) then raise exception 'meeting not found'; end if;
  if m.reader_id is distinct from auth.uid() or not m.reading then raise exception 'not the reader'; end if;
  -- review SEC-4: only today's meeting, only while the reader's place is
  -- reported (the reader's phone sends it at least every 20 s)
  if m.day <> study_private.day_of(now())
     or not exists (select 1 from public.study_meeting_live lv where lv.meeting_id = p_meeting and lv.place_at > now() - interval '60 seconds') then
    raise exception 'not live';
  end if;
  -- review SEC-11, F-14: three taps of OTHER members (the reader's own
  -- never counts), members out of the pulse's count left out; no text
  select coalesce(jsonb_agg(jsonb_build_object('part', t.part_idx, 'anchor', t.anchor, 'n', t.n)
                            order by t.part_idx, t.anchor), '[]'::jsonb) into v
    from (select x.part_idx, x.anchor, count(distinct x.user_id)::int as n
            from public.study_meeting_taps x
           where x.meeting_id = p_meeting and x.user_id <> auth.uid()
             and not study_private.pulse_out(m.group_id, x.user_id)
             and not exists (select 1 from public.study_meeting_events e
                              where e.meeting_id = p_meeting and e.part_idx = x.part_idx and e.anchor = x.anchor)
           group by x.part_idx, x.anchor
          having count(distinct x.user_id) >= 3) t;
  -- review F-14: the guess warning is decision 1's (the switch 'pulse')
  if m.guess_released < cardinality(m.guess_ids) and study_private.feature_on('pulse') then
    select * into q from public.study_questions x where x.id = m.guess_ids[m.guess_released + 1];
    select x.answer into k from public.study_question_keys x where x.question_id = q.id;
    select count(*), count(*) filter (where a.choice is distinct from k) into n, bad
      from public.study_meeting_guess_answers a
     where a.meeting_id = p_meeting and a.question_id = q.id and not study_private.pulse_out(m.group_id, a.user_id);
    if n >= 3 and bad * 2 > n then
      w := jsonb_build_object('guess', m.guess_released + 1, 'part', q.part_idx, 'anchor', q.anchor,
                              'question', q.question, 'slides', to_jsonb(q.slides));
    end if;
  end if;
  return jsonb_build_object('taps', v, 'guess_warn', w);
end;
$$;"""

PICK_PRESET = r"""create or replace function public.study_quiz__pick_preset(p_quiz uuid)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare
  z      public.study_quizzes;
  m      public.study_meetings;
  prev   date;
  readto int;
  pick   uuid[] := '{}';
  more   uuid[];
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.preset <> 'coffee' or z.meeting_id is null then return null; end if;
  select * into m from public.study_meetings x where x.id = z.meeting_id;
  if not found then return null; end if;
  select max(x.day) into prev from public.study_meetings x
   where x.group_id = z.group_id and x.day < m.day and x.cancelled_at is null and x.started_at is not null;
  select coalesce(max(coalesce(y.read_part, -1)), -1) into readto from public.study_meetings y
   where y.group_id = z.group_id and y.lecture_id = m.lecture_id and y.day < m.day and y.cancelled_at is null;
  -- two from the parts read at the previous meeting day: the group's
  -- nightly signal first (section U's hook: confident errors, missed,
  -- split), then a teaser, then at random; never one player's answers
  -- (review SEC-5, F-18)
  with cand as (
    select q.id, q.lecture_id, q.part_idx, coalesce(q.anchor, -1) as anchor, q.teaser <> '' as has_teaser,
           public.study_quiz__signal(q.id) as sig, random() as rnd
      from public.study_questions q
     where q.group_id = z.group_id and q.lecture_id = any (z.lecture_ids)
       and q.retired_at is null and q.stale_at is null and q.hidden_at is null and q.has_key
       and not (q.lecture_id = m.lecture_id and q.part_idx between m.part_from and m.part_to and q.part_idx > readto)
       and exists (select 1 from public.study_meetings y
                    where y.group_id = z.group_id and y.day = prev and y.cancelled_at is null and y.lecture_id = q.lecture_id
                      and q.part_idx between y.part_from and greatest(y.part_from, coalesce(y.read_part, y.part_to)))
  ), r2 as (
    select c.*, row_number() over (partition by c.lecture_id, c.part_idx order by c.sig desc, c.has_teaser desc, c.rnd) as rk
      from cand c
  )
  select coalesce(array_agg(x.id order by x.lecture_id, x.part_idx, x.anchor), '{}') into pick
    from (select r.* from r2 r order by r.rk, r.sig desc, r.has_teaser desc, r.rnd limit 2) x;
  -- the older one (or more, while the recent parts gave fewer than two)
  select coalesce(array_agg(x.id), '{}') into more
    from (select c.id from public.study_questions c
           where c.group_id = z.group_id and c.lecture_id = any (z.lecture_ids)
             and c.retired_at is null and c.stale_at is null and c.hidden_at is null and c.has_key and not (c.id = any (pick))
             and not (c.lecture_id = m.lecture_id and c.part_idx between m.part_from and m.part_to and c.part_idx > readto)
           order by not exists (select 1 from public.study_meetings y
                                 where y.group_id = z.group_id and y.day = prev and y.lecture_id = c.lecture_id
                                   and c.part_idx between y.part_from and greatest(y.part_from, coalesce(y.read_part, y.part_to))) desc,
                    public.study_quiz__signal(c.id) desc, (c.teaser <> '') desc, random()
           limit 3 - cardinality(pick)) x;
  return pick || more;
end;
$$;"""

GUESS_PICK_OLD = """                         (select count(distinct a.user_id) from public.study_answers a where a.question_id = q.id) as seen,
                         q.created_at
                    from public.study_questions q
                   where q.lecture_id = m.lecture_id and q.part_idx = m.part_from and q.anchor is not null
                     and q.has_key and q.retired_at is null and q.stale_at is null
                   order by q.anchor, seen, q.created_at) x
           order by x.seen, x.anchor
           limit 2) y;"""
GUESS_PICK_NEW = """                         q.created_at
                    from public.study_questions q
                   where q.lecture_id = m.lecture_id and q.part_idx = m.part_from and q.anchor is not null
                     and q.has_key and q.retired_at is null and q.stale_at is null and q.hidden_at is null
                   order by q.anchor, q.teaser = '', q.created_at, q.id) x
           order by x.anchor
           limit 2) y;"""


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, """-- ── Helpers ──
create or replace function public.study_meeting_group(p_meeting uuid)""", HELPERS.lstrip("\n").replace(
        "-- ── Review helpers", "-- ── Helpers ──\n-- ── Review helpers") + """create or replace function public.study_meeting_group(p_meeting uuid)""",
             "M: the review's helpers")
    t = once(t, """create table if not exists public.study_meeting_catchups (
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (meeting_id, user_id)
);""", """create table if not exists public.study_meeting_catchups (
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
-- review SEC-12: "קראו" is written on the next study day (catchup_marks)
alter table public.study_meeting_catchups add column if not exists marked_at timestamptz;""", "SEC-12: catch-ups wait to be marked")
    t = once(t, """-- "להקריא לקבוצה" starts or stops on a lecture. On: today's meeting on that
-- lecture (made now when none was planned) gets the caller as its reader,
-- and the caller's place. Off: the caller stops being the one reading.
-- Returns the meeting's id (null when stopping with none).""", """-- "להקריא לקבוצה" starts or stops on a lecture. On: today's meeting on that
-- lecture (made now when none was planned) gets the caller as its reader,
-- and the caller's place, unless another member is reading it live (a place
-- reported in the last minute): 'reading' (review SEC-4). Off: the caller
-- stops being the one reading. Returns the meeting's id (null when stopping
-- with none).""", "SEC-4: reading's comment")
    t = replace_fn(t, "public.study_meeting_reading", READING, "SEC-4: no take-over of a live reading")
    t = once(t, """-- The reader's place (the reader's phone, at most every 5 s, with a
-- trailing call). Moves the meeting's furthest part (published once per
-- part) and releases each pre-guess whose paragraph the reading reached.
-- Returns how many guesses are released. Error: 'not the reader'.""", """-- The reader's place (the reader's phone: on every change at most every 5 s
-- with a trailing call, and at least every 20 s). Moves the meeting's
-- furthest part (published once per part; at most one part a call) and,
-- while two other members follow, releases each pre-guess whose paragraph
-- the reading reached. Returns how many guesses are released. Errors: 'not
-- the reader', 'bad parts' (review SEC-4).""", "SEC-4: place's comment")
    t = replace_fn(t, "public.study_meeting_place", PLACE, "SEC-4: the place moves one part a call; guesses need followers")
    t = once(t, """-- "לא ברור לי" on the paragraph being read (p_on false: take it back).
-- Errors: 'meeting not found', 'not live' (nobody is reading now), 'bad parts'.""", """-- "לא ברור לי" on the paragraph being read (p_on false: take it back).
-- Errors: 'meeting not found', 'not live' (nobody is reading now), 'is
-- reader' (the reader does not tap, review SEC-11), 'bad parts'. The phone's
-- text is not kept (review SEC-11).""", "SEC-11: unclear's comment")
    t = replace_fn(t, "public.study_meeting_unclear", UNCLEAR, "SEC-11: the reader cannot tap; no text from the phone")
    t = once(t, """-- Only on the reader's screen (polled every 6 s while reading aloud):
-- paragraphs with 3 or more "לא ברור" taps not yet handled, with the count
-- and no names; and (phase 2) the next pre-guess paragraph when most of
-- the group guessed it wrong (from 3 guessers). Error: 'not the reader'.""", """-- Only on the reader's screen (polled every 6 s while reading aloud):
-- paragraphs with 3 or more other members' "לא ברור" taps not yet handled,
-- with the count and no names or text; and (phase 2, with the switch
-- 'pulse') the next pre-guess paragraph when most of the group guessed it
-- wrong (from 3 guessers). Only today's meeting while the place is reported.
-- Errors: 'not the reader', 'not live' (review SEC-4, SEC-11, F-14).""", "SEC-4: reader view's comment")
    t = replace_fn(t, "public.study_meeting_reader_view", READER_VIEW, "SEC-4, SEC-11, F-14: the reader's view")
    t = once(t, """  insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, quote, comment_id, created_by)
  values (p_meeting, p_kind, p_part, p_anchor, left(coalesce(p_quote, ''), 200), case when p_kind = 'question' then p_comment end, auth.uid())""",
             """  insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, quote, comment_id, created_by)
  values (p_meeting, p_kind, p_part, p_anchor, '', case when p_kind = 'question' then p_comment end, auth.uid())   -- review SEC-11""",
             "SEC-11: a stop keeps no text from the phone")
    t = once(t, """-- The opening's picker (replaces section Z's stub): two questions from the
-- parts read at the previous meeting day, one older; each keyed, active,
-- not marked by a correction; a teaser first, then those the fewest of
-- these players answered right (their private answers order, never show),
-- then at random. Never today's planned parts unless already read.""", """-- The opening's picker (replaces section Z's stub): two questions from the
-- parts read at the previous meeting day, one older; each keyed, active,
-- not marked by a correction or hidden by two flags; the group's nightly
-- signal first (section U), then a teaser, then at random. Never one
-- player's private answers (review SEC-5: with two players the opening was
-- the other player's mistakes). Never today's planned parts unless already
-- read.""", "SEC-5: the opening's comment")
    t = replace_fn(t, "public.study_quiz__pick_preset", PICK_PRESET, "SEC-5, F-18, F-6: the opening's picker")
    t = once(t, """-- placed on a paragraph of the meeting's first part, keyed, active, not
-- marked; distinct paragraphs; those fewest members have answered first.""", """-- placed on a paragraph of the meeting's first part, keyed, active, not
-- marked or hidden; the first two paragraphs that have one, in reading
-- order, a teaser first, then the oldest (review SEC-5: no count of who
-- answered what).""", "SEC-5: guess pick's comment")
    t = once(t, GUESS_PICK_OLD, GUESS_PICK_NEW, "SEC-5, F-6: the guesses at random, hidden ones out")
    t = once(t, """      select count(*), count(*) filter (where a.choice = k.answer) into n, ok
        from public.study_meeting_guess_answers a where a.meeting_id = p_meeting and a.question_id = q.id;
      select a.choice, count(*) into top, topn from public.study_meeting_guess_answers a
       where a.meeting_id = p_meeting and a.question_id = q.id group by a.choice order by count(*) desc, a.choice limit 1;""",
             """      select count(*), count(*) filter (where a.choice = k.answer) into n, ok
        from public.study_meeting_guess_answers a
       where a.meeting_id = p_meeting and a.question_id = q.id and not study_private.pulse_out(m.group_id, a.user_id);   -- review F-14
      select a.choice, count(*) into top, topn from public.study_meeting_guess_answers a
       where a.meeting_id = p_meeting and a.question_id = q.id and not study_private.pulse_out(m.group_id, a.user_id)
       group by a.choice order by count(*) desc, a.choice limit 1;""", "F-14: the majority leaves out opted-out members")
    # SEC-12: the band (opened by every member on "יחד" and Today) writes the
    # catch-ups of earlier study days into "קראו".
    t = once(t, """create or replace function public.study_meeting_band(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d   date := study_private.day_of(now());
  out jsonb;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;""",
             """create or replace function public.study_meeting_band(p_group uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d   date := study_private.day_of(now());
  out jsonb;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  perform study_private.catchup_marks(p_group);              -- review SEC-12: yesterday's catch-ups join ׳קראו׳""",
             "SEC-12: the band writes earlier catch-ups' marks")
    # F-13: the catch-up's associations are the wall's moments (section J),
    # K's comment kind 'mnemonic' is no longer posted.
    t = once(t, """  select coalesce(jsonb_agg(x.j order by x.at), '[]'::jsonb) into pins
    from (select c.created_at as at, jsonb_build_object('id', c.id, 'body', c.body, 'part', c.part_idx, 'anchor', c.anchor,
                   'by', (select mb.name from public.study_members mb where mb.group_id = m.group_id and mb.user_id = c.author_id)) as j
            from public.study_comments c
           where c.lecture_id = m.lecture_id and c.kind = 'mnemonic' and c.parent_id is null and c.created_at between t0 and t1
           order by c.created_at limit 2) x;""", """  pins := '[]'::jsonb;
  if to_regclass('public.study_aids') is not null then      -- review F-13: the wall's moments (section J)
    execute 'select coalesce(jsonb_agg(x.j order by x.at), ''[]''::jsonb)
               from (select a.created_at as at, jsonb_build_object(''id'', a.id, ''body'', a.body, ''fact'', a.fact,
                              ''part'', a.part_idx, ''anchor'', a.anchor,
                              ''by'', (select mb.name from public.study_members mb where mb.group_id = $2 and mb.user_id = a.named_by)) as j
                       from public.study_aids a
                      where a.lecture_id = $1 and a.kind = ''moment'' and a.flag is distinct from ''not_ok''
                        and a.created_at between $3 and $4
                      order by a.created_at limit 2) x'
      into pins using m.lecture_id, m.group_id, t0, t1;
  end if;""", "F-13: catch-up's moments from the wall")
    t = once(t, """            join public.study_questions q on q.id = r.question_id and q.retired_at is null and q.stale_at is null and q.has_key
           where z.meeting_id = p_meeting""", """            join public.study_questions q on q.id = r.question_id and q.retired_at is null and q.stale_at is null
                                          and q.hidden_at is null and q.has_key
           where z.meeting_id = p_meeting""", "F-6: catch-up's quiz questions without hidden ones")
    t = once(t, """             and q.retired_at is null and q.stale_at is null and q.has_key and not (q.id = any (qs))""",
             """             and q.retired_at is null and q.stale_at is null and q.hidden_at is null and q.has_key and not (q.id = any (qs))""",
             "F-6: catch-up's other questions without hidden ones")
    t = once(t, """  select coalesce(array_agg(mb.name order by r.read_at), '{}') into rd""",
             """  select coalesce(array_agg(mb.name order by mb.name), '{}') into rd               -- review SEC-12: by name, never by time""",
             "SEC-12: readers by name")
    t = once(t, """-- Finishing the catch-up: the lecture is marked read for the caller
-- (who-read-what shows names only: no time, no "באיחור").""", """-- Finishing the catch-up. The lecture is marked read for the caller on the
-- next study day, with the meeting's time (study_private.catchup_marks,
-- review SEC-12): who-read-what shows names only, no time, no "באיחור", and
-- no mark arrives live hours after the meeting.""", "SEC-12: catch-up done's comment")
    t = once(t, """  insert into public.study_meeting_catchups (meeting_id, user_id) values (p_meeting, auth.uid())
  on conflict (meeting_id, user_id) do nothing;
  insert into public.study_reads (lecture_id, user_id) values (m.lecture_id, auth.uid())
  on conflict (lecture_id, user_id) do nothing;""", """  insert into public.study_meeting_catchups (meeting_id, user_id) values (p_meeting, auth.uid())
  on conflict (meeting_id, user_id) do nothing;""", "SEC-12: no read mark at once")
    return t

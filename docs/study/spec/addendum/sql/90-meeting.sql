-- ════════════════════════════════════════════════════════════════════════
--  SECTION M · THE DAILY MEETING   (package M; meeting addendum §4)
--  After section P (its SQL functions read Q, Z, K and P's tables). Re-runnable.
--
--  T1  the day's meeting as data: time, lecture, part range, the planned
--      reader; created ahead ("הפגישה הבאה") or by the first reading aloud of
--      the day. Shared in the group and published (the band, the banner).
--  M4  "לא ברור לי": a follower's anonymous tap on the paragraph being read;
--      private rows, written only by a function, never published.
--  M5  only the meeting's current reader is told where 3 or more members
--      tapped (study_meeting_reader_view), and records what was done there:
--      a stop to explain, moving on, or an open question for tomorrow.
--  M1  "3 לקפה": section Z's preset 'coffee'; this section chooses its three
--      questions (study_quiz__pick_preset): two from the previous meeting's
--      parts as read, one older.
--  M2/K3 the three-line agenda: today's reading and reader; a hot spot (the
--      pulse's, not here); one question open for more than 24 hours, or
--      sent "לשאלה פתוחה למחר" at an earlier meeting.
--  M3/M6 phase 2, the pre-guess: two questions on the first part, answered
--      privately (never a mistake: not in study_answers), their keys shown
--      only once the reading reaches their paragraph; results only as a
--      majority, from 3 guessers; the reader is warned before a paragraph
--      most of the group guessed wrong.
--  M7  a tapped paragraph comes back to the tapper alone on a later day.
--  T3  catch-up for a meeting one missed: built from what the group made
--      (stops, answered questions, shared memory aids, the questions the
--      group found hardest in the meeting's quizzes); finishing marks the
--      lecture read in "קראו", with no time.
--  Attendance is private (each member's own row), used only to offer the
--  catch-up. The live counts here (taps, guesses) are shown only on the
--  reader's screen or as a majority word, from 3 people, never names: the
--  approved exception to the nightly rule (design.md §2.3).
-- ════════════════════════════════════════════════════════════════════════

-- The study day of a moment (Israel time, from 04:00), as section P counts it.
create or replace function study_private.day_of(p_at timestamptz)
returns date language sql immutable set search_path = public as $$
  select ((p_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
$$;
revoke all on function study_private.day_of(timestamptz) from public;

-- ── The meetings (shared, published; own uuid key) ──
create table if not exists public.study_meetings (
  id             uuid        primary key default gen_random_uuid(),
  group_id       uuid        not null references public.study_groups (id) on delete cascade,
  day            date        not null,
  starts_at      timestamptz not null,
  lecture_id     uuid        not null references public.study_lectures (id) on delete cascade,
  part_from      int         not null check (part_from between 0 and 199),
  part_to        int         not null check (part_to between 0 and 199),
  title          text        not null default '' check (char_length(title) <= 120),
  planned_reader uuid        references auth.users (id) on delete set null,
  reader_id      uuid        references auth.users (id) on delete set null,   -- who reads aloud now, or last did
  reading        boolean     not null default false,
  started_at     timestamptz,
  read_part      int         check (read_part between 0 and 199),           -- the furthest part the reading reached
  guess_ids      uuid[]      not null default '{}' check (cardinality(guess_ids) <= 2),
  guess_released smallint    not null default 0 check (guess_released between 0 and 2),
  cancelled_at   timestamptz,
  version        int         not null default 1 check (version >= 1),
  created_by     uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_by     uuid        references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (part_to >= part_from)
);
create unique index if not exists study_meetings_one on public.study_meetings (group_id, day, lecture_id) where cancelled_at is null;
create index if not exists study_meetings_group on public.study_meetings (group_id, day desc);

-- The reader's place, as the reader's phone reports it (no grants; never published).
create table if not exists public.study_meeting_live (
  meeting_id uuid        primary key references public.study_meetings (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  max_part   int         not null check (max_part between 0 and 199),
  max_anchor int         not null check (max_anchor between 0 and 99999),
  place_at   timestamptz not null default now()
);

-- "לא ברור לי" (private: the owner reads her own; written by functions only).
create table if not exists public.study_meeting_taps (
  id         uuid        primary key default gen_random_uuid(),
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  quote      text        not null default '' check (char_length(quote) <= 200),
  created_at timestamptz not null default now(),
  done_at    timestamptz,                                  -- seen again on a later day (M7)
  unique (meeting_id, user_id, part_idx, anchor)
);
create index if not exists study_meeting_taps_meeting on public.study_meeting_taps (meeting_id, part_idx, anchor);
create index if not exists study_meeting_taps_user on public.study_meeting_taps (user_id, created_at desc);

-- What the reader did at a paragraph (shared in the group; not published).
create table if not exists public.study_meeting_events (
  id         uuid        primary key default gen_random_uuid(),
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  kind       text        not null check (kind in ('explain', 'continue', 'question')),
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  quote      text        not null default '' check (char_length(quote) <= 200),
  comment_id uuid        references public.study_comments (id) on delete set null,
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (meeting_id, kind, part_idx, anchor)
);

-- Who was there (private, each member's own row): following the reader,
-- reading aloud, tapping. Only for offering the catch-up.
create table if not exists public.study_meeting_presence (
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- Pre-guesses (private, never in study_answers: a guess is never a mistake).
create table if not exists public.study_meeting_guess_answers (
  meeting_id  uuid        not null references public.study_meetings (id) on delete cascade,
  question_id uuid        not null references public.study_questions (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  choice      smallint    not null check (choice >= 0),
  answered_at timestamptz not null default now(),
  primary key (meeting_id, question_id, user_id)
);

-- A catch-up finished (private).
create table if not exists public.study_meeting_catchups (
  meeting_id uuid        not null references public.study_meetings (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
-- review SEC-12: "קראו" is written on the next study day (catchup_marks)
alter table public.study_meeting_catchups add column if not exists marked_at timestamptz;

-- ── Helpers ──
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
create or replace function public.study_meeting_group(p_meeting uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_meetings where id = p_meeting;
$$;

-- A meeting is over once its study day is past, four hours after it
-- started, or when its closing quiz ended.
create or replace function study_private.meeting_over(m public.study_meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select m.cancelled_at is null and (
         m.day < study_private.day_of(now())
      or (m.started_at is not null and m.started_at < now() - interval '4 hours')
      or exists (select 1 from public.study_quizzes z where z.meeting_id = m.id and z.preset = 'end' and z.state = 'ended'))
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Planning and running the meeting
-- ═══════════════════════════════════════════════════════════════════════

-- "הפגישה הבאה": creates (p_id null) or changes a meeting. Any member, as a
-- marathon. Errors: 'group not found', 'lecture not found', 'bad parts',
-- 'bad time', 'bad title', 'member not found', 'meeting exists' (that
-- lecture already has a meeting that day), 'meeting not found', 'conflict'.
create or replace function public.study_meeting_save(p_id uuid, p_version int, p_group uuid, p_starts_at timestamptz,
  p_lecture uuid, p_part_from int, p_part_to int, p_title text default '', p_reader uuid default null)
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  m  public.study_meetings;
  d  date;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  if p_lecture is null or public.study_lecture_group(p_lecture) is distinct from p_group
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  if p_part_from is null or p_part_to is null or p_part_from < 0 or p_part_to < p_part_from
     or (select count(*) from public.study_sections s where s.lecture_id = p_lecture and s.idx in (p_part_from, p_part_to))
        <> (case when p_part_from = p_part_to then 1 else 2 end) then
    raise exception 'bad parts';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '12 hours' or p_starts_at > now() + interval '14 days' then
    raise exception 'bad time';
  end if;
  if char_length(coalesce(p_title, '')) > 120 then raise exception 'bad title'; end if;
  if p_reader is not null and not exists (select 1 from public.study_members x where x.group_id = p_group and x.user_id = p_reader) then
    raise exception 'member not found';
  end if;
  d := study_private.day_of(p_starts_at);
  perform pg_advisory_xact_lock(hashtext('study_meeting:' || p_group::text));
  if p_id is null then
    if exists (select 1 from public.study_meetings x
                where x.group_id = p_group and x.day = d and x.lecture_id = p_lecture and x.cancelled_at is null) then
      raise exception 'meeting exists';
    end if;
    insert into public.study_meetings (group_id, day, starts_at, lecture_id, part_from, part_to, title, planned_reader, created_by)
    values (p_group, d, p_starts_at, p_lecture, p_part_from, p_part_to, btrim(coalesce(p_title, '')), p_reader, me)
    returning * into m;
  else
    select * into m from public.study_meetings x where x.id = p_id and x.group_id = p_group for update;
    if not found or m.cancelled_at is not null then raise exception 'meeting not found'; end if;
    if m.version <> p_version then raise exception 'conflict'; end if;
    if exists (select 1 from public.study_meetings x
                where x.id <> p_id and x.group_id = p_group and x.day = d and x.lecture_id = p_lecture and x.cancelled_at is null) then
      raise exception 'meeting exists';
    end if;
    update public.study_meetings x
       set day = d, starts_at = p_starts_at, lecture_id = p_lecture, part_from = p_part_from, part_to = p_part_to,
           title = btrim(coalesce(p_title, '')), planned_reader = p_reader,
           guess_ids = case when x.lecture_id = p_lecture and x.part_from = p_part_from then x.guess_ids else '{}' end,
           guess_released = case when x.lecture_id = p_lecture and x.part_from = p_part_from then x.guess_released else 0 end,
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id
    returning * into m;
  end if;
  return query select m.id, m.version;
end;
$$;

-- "לבטל את הפגישה": before it started. Errors: 'meeting not found', 'meeting started'.
create or replace function public.study_meeting_cancel(p_meeting uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m public.study_meetings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting for update;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if m.started_at is not null then raise exception 'meeting started'; end if;
  update public.study_meetings x set cancelled_at = now(), version = x.version + 1, updated_by = auth.uid(), updated_at = now()
   where x.id = p_meeting;
end;
$$;

-- "להקריא לקבוצה" starts or stops on a lecture. On: today's meeting on that
-- lecture (made now when none was planned) gets the caller as its reader,
-- and the caller's place, unless another member is reading it live (a place
-- reported in the last minute): 'reading' (review SEC-4). Off: the caller
-- stops being the one reading. Returns the meeting's id (null when stopping
-- with none).
create or replace function public.study_meeting_reading(p_lecture uuid, p_on boolean, p_part int default 0, p_anchor int default 0)
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
$$;

-- The reader's place (the reader's phone: on every change at most every 5 s
-- with a trailing call, and at least every 20 s). Moves the meeting's
-- furthest part (published once per part; at most one part a call) and,
-- while two other members follow, releases each pre-guess whose paragraph
-- the reading reached. Returns how many guesses are released. Errors: 'not
-- the reader', 'bad parts' (review SEC-4).
create or replace function public.study_meeting_place(p_meeting uuid, p_part int, p_anchor int)
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
$$;

-- A follower is here (called once when following starts during the meeting,
-- and by the meeting's screens). Private; offers no one anything but the
-- caller's own catch-up.
create or replace function public.study_meeting_here(p_meeting uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m public.study_meetings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if m.day = study_private.day_of(now()) then
    insert into public.study_meeting_presence (meeting_id, user_id) values (p_meeting, auth.uid())
    on conflict (meeting_id, user_id) do update set last_at = now();
  end if;
end;
$$;

-- "לא ברור לי" on the paragraph being read (p_on false: take it back).
-- Errors: 'meeting not found', 'not live' (nobody is reading now), 'is
-- reader' (the reader does not tap, review SEC-11), 'bad parts'. The phone's
-- text is not kept (review SEC-11).
create or replace function public.study_meeting_unclear(p_meeting uuid, p_part int, p_anchor int, p_quote text default '', p_on boolean default true)
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
$$;

-- Only on the reader's screen (polled every 6 s while reading aloud):
-- paragraphs with 3 or more other members' "לא ברור" taps not yet handled,
-- with the count and no names or text; and (phase 2, with the switch
-- 'pulse') the next pre-guess paragraph when most of the group guessed it
-- wrong (from 3 guessers). Only today's meeting while the place is reported.
-- Errors: 'not the reader', 'not live' (review SEC-4, SEC-11, F-14).
create or replace function public.study_meeting_reader_view(p_meeting uuid)
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
$$;

-- The reader's answer to a callout: 'explain' ("לעצור ולהסביר"), 'continue'
-- ("להמשיך"), 'question' ("לשאלה פתוחה למחר", with the question comment the
-- phone has just posted on the paragraph). Errors: 'not the reader',
-- 'bad kind', 'question not found'.
create or replace function public.study_meeting_stop(p_meeting uuid, p_kind text, p_part int, p_anchor int,
  p_quote text default '', p_comment uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m public.study_meetings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) then raise exception 'meeting not found'; end if;
  if m.reader_id is distinct from auth.uid() or not m.reading then raise exception 'not the reader'; end if;
  if coalesce(p_kind, '') not in ('explain', 'continue', 'question') then raise exception 'bad kind'; end if;
  if p_kind = 'question' and not exists (
       select 1 from public.study_comments c
        where c.id = p_comment and c.lecture_id = m.lecture_id and c.part_idx = p_part and c.anchor = p_anchor
          and c.kind = 'question' and c.parent_id is null) then
    raise exception 'question not found';
  end if;
  insert into public.study_meeting_events (meeting_id, kind, part_idx, anchor, quote, comment_id, created_by)
  values (p_meeting, p_kind, p_part, p_anchor, '', case when p_kind = 'question' then p_comment end, auth.uid())   -- review SEC-11
  on conflict (meeting_id, kind, part_idx, anchor) do nothing;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The opening and the closing (section Z's presets)
-- ═══════════════════════════════════════════════════════════════════════

-- The opening's picker (replaces section Z's stub): two questions from the
-- parts read at the previous meeting day, one older; each keyed, active,
-- not marked by a correction or hidden by two flags; the group's nightly
-- signal first (section U), then a teaser, then at random. Never one
-- player's private answers (review SEC-5: with two players the opening was
-- the other player's mistakes). Never today's planned parts unless already
-- read.
create or replace function public.study_quiz__pick_preset(p_quiz uuid)
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
$$;
revoke all on function public.study_quiz__pick_preset(uuid) from public, anon, authenticated;

-- Opens the meeting's quiz: 'coffee' (3 לקפה: three questions, 45 s each,
-- co-op), 'end' (סוף הקריאה: on the parts read, 5 by default, either mode),
-- 'stop' (one question on a part just read, co-op). Section Z's errors
-- ('quiz open', 'already', 'no questions' at the start) pass through.
create or replace function public.study_meeting_quiz(p_meeting uuid, p_preset text, p_mode text default 'coop',
  p_count int default null, p_part int default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m    public.study_meetings;
  lecs uuid[];
  upto int;
  qid  uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if coalesce(p_preset, '') = 'coffee' then
    select array_agg(x.lecture_id order by x.last desc) into lecs
      from (select y.lecture_id, max(y.day) as last from public.study_meetings y
              join public.study_lectures l on l.id = y.lecture_id and l.deleted_at is null
             where y.group_id = m.group_id and y.day < m.day and y.cancelled_at is null
             group by y.lecture_id order by max(y.day) desc limit 40) x;
    if lecs is null then
      select array_agg(x.lecture_id) into lecs
        from (select q.lecture_id from public.study_questions q join public.study_lectures l on l.id = q.lecture_id and l.deleted_at is null
               where q.group_id = m.group_id and q.has_key and q.retired_at is null
               group by q.lecture_id order by max(q.created_at) desc limit 40) x;
    end if;
    qid := public.study_quiz_create(m.group_id, 'coop', coalesce(lecs, array[m.lecture_id]), 3, 45, 'all', 'coffee', p_meeting);
  elsif p_preset = 'end' then
    upto := greatest(m.part_from, coalesce(m.read_part, m.part_to));
    qid := public.study_quiz_create(m.group_id, coalesce(p_mode, 'coop'), array[m.lecture_id], coalesce(p_count, 5), 60, 'all', 'end',
                                    p_meeting, m.part_from, upto);
  elsif p_preset = 'stop' then
    qid := public.study_quiz_create(m.group_id, 'coop', array[m.lecture_id], 1, 60, 'all', 'stop', p_meeting,
                                    coalesce(p_part, m.read_part, m.part_from), coalesce(p_part, m.read_part, m.part_from));
  else
    raise exception 'bad preset';
  end if;
  update public.study_meetings x set started_at = coalesce(x.started_at, now()), version = x.version + 1, updated_at = now()
   where x.id = p_meeting and x.started_at is null;
  return qid;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The pre-guess (phase 2)
-- ═══════════════════════════════════════════════════════════════════════

-- Chooses the two questions once (the first call after the bank exists):
-- placed on a paragraph of the meeting's first part, keyed, active, not
-- marked or hidden; the first two paragraphs that have one, in reading
-- order, a teaser first, then the oldest (review SEC-5: no count of who
-- answered what).
create or replace function public.study_meeting_guess_pick(p_meeting uuid)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare
  m   public.study_meetings;
  ids uuid[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting for update;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if cardinality(m.guess_ids) = 2 or m.guess_released > 0 then return m.guess_ids; end if;
  select coalesce(array_agg(y.id order by y.anchor), '{}') into ids
    from (select x.id, x.anchor
            from (select distinct on (q.anchor) q.id, q.anchor,
                         q.created_at
                    from public.study_questions q
                   where q.lecture_id = m.lecture_id and q.part_idx = m.part_from and q.anchor is not null
                     and q.has_key and q.retired_at is null and q.stale_at is null and q.hidden_at is null
                   order by q.anchor, q.teaser = '', q.created_at, q.id) x
           order by x.anchor
           limit 2) y;
  if cardinality(ids) > 0 then
    update public.study_meetings x set guess_ids = ids, version = x.version + 1, updated_at = now() where x.id = p_meeting;
  end if;
  return ids;
end;
$$;

-- A private guess (changeable until its paragraph is reached). Errors:
-- 'question not found', 'released', 'bad choice'.
create or replace function public.study_meeting_guess(p_meeting uuid, p_question uuid, p_choice int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m   public.study_meetings;
  pos int;
  n   int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  pos := array_position(m.guess_ids, p_question);
  if pos is null then raise exception 'question not found'; end if;
  if pos <= m.guess_released then raise exception 'released'; end if;
  select cardinality(q.options) into n from public.study_questions q where q.id = p_question;
  if p_choice is null or p_choice < 0 or p_choice >= n then raise exception 'bad choice'; end if;
  insert into public.study_meeting_guess_answers (meeting_id, question_id, user_id, choice)
  values (p_meeting, p_question, auth.uid(), p_choice)
  on conflict (meeting_id, question_id, user_id) do update set choice = excluded.choice, answered_at = now();
end;
$$;

-- The guesses as the caller may see them: the question, her own guess, and
-- once released the key, the right option's explanation and a majority
-- word from 3 guessers (with_most: her option was chosen by more than half;
-- most_right; spread: no option had more than half). Never a number.
create or replace function public.study_meeting_guess_state(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m   public.study_meetings;
  out jsonb := '[]'::jsonb;
  i   int;
  q   public.study_questions;
  k   public.study_question_keys;
  mc  smallint;
  n   int;
  ok  int;
  top int;
  topn int;
  e   jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) then raise exception 'meeting not found'; end if;
  for i in 1 .. cardinality(m.guess_ids) loop
    select * into q from public.study_questions x where x.id = m.guess_ids[i];
    continue when not found;
    select a.choice into mc from public.study_meeting_guess_answers a
     where a.meeting_id = p_meeting and a.question_id = q.id and a.user_id = auth.uid();
    e := jsonb_build_object('n', i, 'released', i <= m.guess_released, 'mine', mc,
           'q', jsonb_build_object('id', q.id, 'kind', q.kind, 'vignette', q.vignette, 'question', q.question, 'teaser', q.teaser,
                                   'options', to_jsonb(q.options), 'slides', to_jsonb(q.slides), 'part', q.part_idx, 'anchor', q.anchor));
    if i <= m.guess_released then
      select * into k from public.study_question_keys x where x.question_id = q.id;
      select count(*), count(*) filter (where a.choice = k.answer) into n, ok
        from public.study_meeting_guess_answers a
       where a.meeting_id = p_meeting and a.question_id = q.id and not study_private.pulse_out(m.group_id, a.user_id);   -- review F-14
      select a.choice, count(*) into top, topn from public.study_meeting_guess_answers a
       where a.meeting_id = p_meeting and a.question_id = q.id and not study_private.pulse_out(m.group_id, a.user_id)
       group by a.choice order by count(*) desc, a.choice limit 1;
      e := e || jsonb_build_object('answer', k.answer,
             'explanation', coalesce(k.explanations[k.answer + 1], ''), 'takeaway', coalesce(k.takeaway, ''),
             'correct', case when mc is null then null else mc = k.answer end,
             'majority', case when n < 3 then null else jsonb_build_object(
                           'most_right', ok * 2 > n,
                           'spread', topn * 2 <= n,
                           'with_most', mc is not null and topn * 2 > n and mc = top) end);
    end if;
    out := out || e;
  end loop;
  return out;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The agenda, the band, and what comes back later
-- ═══════════════════════════════════════════════════════════════════════

-- The three-line agenda. Line 1: today's reading and reader. Line 2 (the
-- pulse's hot spot) is not this section's. Line 3: one open question,
-- preferring one sent "לשאלה פתוחה למחר" at an earlier meeting, then one
-- older than 24 hours on this or the previous meeting's lecture, then the oldest.
create or replace function public.study_meeting_agenda(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m  public.study_meetings;
  rd jsonb;
  oq jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) then raise exception 'meeting not found'; end if;
  select jsonb_build_object('lecture_id', m.lecture_id, 'lecture_title', l.title,
           'title', coalesce(nullif(m.title, ''), (select string_agg(s.title, ' · ' order by s.idx) from public.study_sections s
                                                   where s.lecture_id = m.lecture_id and s.idx between m.part_from and m.part_to)),
           'part_from', m.part_from, 'part_to', m.part_to,
           'slide_from', (select s.slide_from from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = m.part_from),
           'slide_to', (select s.slide_to from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = m.part_to),
           'reader', (select mb.name from public.study_members mb where mb.group_id = m.group_id and mb.user_id = coalesce(m.reader_id, m.planned_reader)),
           'reading', m.reading)
    into rd from public.study_lectures l where l.id = m.lecture_id;
  select jsonb_build_object('id', c.id, 'body', c.body, 'lecture_id', c.lecture_id, 'lecture_title', l.title,
           'part', c.part_idx, 'anchor', c.anchor, 'quote', c.quote, 'created_at', c.created_at,
           'author', (select mb.name from public.study_members mb where mb.group_id = m.group_id and mb.user_id = c.author_id),
           'from_meeting', exists (select 1 from public.study_meeting_events e join public.study_meetings y on y.id = e.meeting_id
                                    where e.comment_id = c.id and y.day < m.day))
    into oq
    from public.study_comments c
    join public.study_lectures l on l.id = c.lecture_id and l.group_id = m.group_id and l.deleted_at is null
   where c.kind = 'question' and c.parent_id is null and not c.resolved
     and (c.created_at <= m.starts_at - interval '24 hours'
          or exists (select 1 from public.study_meeting_events e join public.study_meetings y on y.id = e.meeting_id
                      where e.comment_id = c.id and y.day < m.day))
   order by exists (select 1 from public.study_meeting_events e join public.study_meetings y on y.id = e.meeting_id
                     where e.comment_id = c.id and y.day < m.day) desc,
            (c.lecture_id = m.lecture_id
             or c.lecture_id in (select y.lecture_id from public.study_meetings y
                                  where y.group_id = m.group_id and y.day < m.day and y.cancelled_at is null
                                  order by y.day desc limit 1)) desc,
            c.created_at
   limit 1;
  return jsonb_build_object('reading', rd, 'hot_spot', null, 'open_question', oq);
end;
$$;

-- Today's band (or the next meeting within 14 days, when today has none):
-- what Today, "יחד" and the banner show, in one call.
create or replace function public.study_meeting_band(p_group uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d   date := study_private.day_of(now());
  out jsonb;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  perform study_private.catchup_marks(p_group);              -- review SEC-12: yesterday's catch-ups join ׳קראו׳
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'day', m.day, 'starts_at', m.starts_at, 'version', m.version, 'today', m.day = d,
           'lecture_id', m.lecture_id, 'lecture_title', l.title,
           'title', coalesce(nullif(m.title, ''), (select string_agg(s.title, ' · ' order by s.idx) from public.study_sections s
                                                   where s.lecture_id = m.lecture_id and s.idx between m.part_from and m.part_to)),
           'part_from', m.part_from, 'part_to', m.part_to,
           'slide_from', (select s.slide_from from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = m.part_from),
           'slide_to', (select s.slide_to from public.study_sections s where s.lecture_id = m.lecture_id and s.idx = m.part_to),
           'planned_reader', m.planned_reader, 'reader_id', m.reader_id, 'reading', m.reading, 'started_at', m.started_at,
           'over', study_private.meeting_over(m),
           'guesses', cardinality(m.guess_ids), 'guess_released', m.guess_released,
           'my_guesses', (select count(*) from public.study_meeting_guess_answers a where a.meeting_id = m.id and a.user_id = auth.uid()),
           'coffee', (select jsonb_build_object('id', z.id, 'state', z.state) from public.study_quizzes z
                       where z.meeting_id = m.id and z.preset = 'coffee' and z.state <> 'cancelled' order by z.created_at desc limit 1),
           'closing', (select jsonb_build_object('id', z.id, 'state', z.state) from public.study_quizzes z
                        where z.meeting_id = m.id and z.preset = 'end' and z.state <> 'cancelled' order by z.created_at desc limit 1))
           order by m.starts_at), '[]'::jsonb)
    into out
    from public.study_meetings m
    join public.study_lectures l on l.id = m.lecture_id and l.deleted_at is null
   where m.group_id = p_group and m.cancelled_at is null
     and (m.day = d or (m.day > d and m.day = (select min(y.day) from public.study_meetings y
                                                where y.group_id = p_group and y.cancelled_at is null and y.day > d
                                                  and y.day <= d + 14)
                        and not exists (select 1 from public.study_meetings y2
                                         where y2.group_id = p_group and y2.cancelled_at is null and y2.day = d)));
  return out;
end;
$$;

-- M7: the caller's own "לא ברור" paragraphs from earlier study days (14
-- days), not yet seen again: whether the reader stopped there, and the
-- paragraph's thread ('answered': its question is resolved or has a reply
-- after the tap; 'open'; 'none').
create or replace function public.study_my_unclear(p_group uuid)
returns table (tap_id uuid, meeting_id uuid, lecture_id uuid, lecture_title text, part_idx int, anchor int, quote text,
               tapped_at timestamptz, explained boolean, thread text, comment_id uuid)
language sql stable security definer set search_path = public as $$
  select t.id, t.meeting_id, t.lecture_id, l.title, t.part_idx, t.anchor, t.quote, t.created_at,
         exists (select 1 from public.study_meeting_events e
                  where e.meeting_id = t.meeting_id and e.kind = 'explain' and e.part_idx = t.part_idx and e.anchor = t.anchor),
         case when c.id is null then 'none'
              when c.resolved or exists (select 1 from public.study_comments r where r.parent_id = c.id and r.created_at > t.created_at)
                then 'answered'
              else 'open' end,
         c.id
    from public.study_meeting_taps t
    join public.study_lectures l on l.id = t.lecture_id and l.deleted_at is null and l.group_id = p_group
    left join lateral (select c2.* from public.study_comments c2
                        where c2.lecture_id = t.lecture_id and c2.part_idx = t.part_idx and c2.anchor = t.anchor
                          and c2.kind = 'question' and c2.parent_id is null
                        order by c2.created_at desc limit 1) c on true
   where t.user_id = auth.uid() and t.done_at is null
     and study_private.day_of(t.created_at) < study_private.day_of(now())
     and t.created_at > now() - interval '14 days'
     and public.study_is_member(p_group)
   order by t.created_at;
$$;

create or replace function public.study_unclear_done(p_tap uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_meeting_taps t set done_at = coalesce(t.done_at, now()) where t.id = p_tap and t.user_id = auth.uid();
  if not found then raise exception 'not found'; end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Catch-up (T3)
-- ═══════════════════════════════════════════════════════════════════════

-- Meetings of the last 7 days that are over and happened, where the caller
-- was not there (no presence, tap, guess or quiz seat) and has not caught up.
create or replace function public.study_my_missed(p_group uuid)
returns table (meeting_id uuid, lecture_id uuid, lecture_title text, title text, day date)
language sql stable security definer set search_path = public as $$
  select m.id, m.lecture_id, l.title,
         coalesce(nullif(m.title, ''), (select string_agg(s.title, ' · ' order by s.idx) from public.study_sections s
                                         where s.lecture_id = m.lecture_id and s.idx between m.part_from and m.part_to)),
         m.day
    from public.study_meetings m
    join public.study_lectures l on l.id = m.lecture_id and l.deleted_at is null
   where m.group_id = p_group and public.study_is_member(p_group)
     and m.cancelled_at is null and m.started_at is not null and study_private.meeting_over(m)
     and m.day > study_private.day_of(now()) - 7
     and not exists (select 1 from public.study_meeting_presence x where x.meeting_id = m.id and x.user_id = auth.uid())
     and not exists (select 1 from public.study_meeting_taps x where x.meeting_id = m.id and x.user_id = auth.uid())
     and not exists (select 1 from public.study_meeting_guess_answers x where x.meeting_id = m.id and x.user_id = auth.uid())
     and not exists (select 1 from public.study_meeting_catchups x where x.meeting_id = m.id and x.user_id = auth.uid())
     and not exists (select 1 from public.study_quizzes z join public.study_quiz_players p on p.quiz_id = z.id
                      where z.meeting_id = m.id and p.user_id = auth.uid())
   order by m.day desc, m.starts_at desc;
$$;

-- The catch-up pack: only what the group made in that meeting. Error:
-- 'meeting not found', 'not over'.
create or replace function public.study_meeting_catchup(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m     public.study_meetings;
  t0    timestamptz;
  t1    timestamptz;
  upto  int;
  stops jsonb;
  res   jsonb;
  pins  jsonb;
  qs    uuid[];
  more  uuid[];
  rd    text[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  if not study_private.meeting_over(m) then raise exception 'not over'; end if;
  t0 := coalesce(m.started_at, m.starts_at);
  t1 := t0 + interval '4 hours';
  upto := greatest(m.part_from, coalesce(m.read_part, m.part_to));
  select coalesce(jsonb_agg(jsonb_build_object('part', e.part_idx, 'anchor', e.anchor, 'quote', e.quote) order by e.part_idx, e.anchor), '[]'::jsonb)
    into stops from public.study_meeting_events e where e.meeting_id = p_meeting and e.kind = 'explain';
  select coalesce(jsonb_agg(x.j order by x.at), '[]'::jsonb) into res
    from (select c.created_at as at, jsonb_build_object('id', c.id, 'question', c.body, 'part', c.part_idx, 'anchor', c.anchor,
                   'answer', r.body, 'answer_by', (select mb.name from public.study_members mb where mb.group_id = m.group_id and mb.user_id = r.author_id)) as j
            from public.study_comments c
            join lateral (select r2.* from public.study_comments r2 where r2.parent_id = c.id and r2.created_at between t0 and t1
                           order by r2.created_at desc limit 1) r on true
           where c.lecture_id = m.lecture_id and c.kind = 'question' and c.parent_id is null and c.resolved
           limit 3) x;
  pins := '[]'::jsonb;
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
  end if;
  -- the questions the group found hardest in this meeting's quizzes (rounds
  -- of 3 answers or more, counts the group already saw), then questions on
  -- the paragraphs where the reading stopped, then the parts read
  select coalesce(array_agg(x.qid), '{}') into qs
    from (select r.question_id as qid
            from public.study_quizzes z
            join public.study_quiz_rounds r on r.quiz_id = z.id and r.revealed_at is not null and r.voided_at is null
            join public.study_questions q on q.id = r.question_id and q.retired_at is null and q.stale_at is null
                                          and q.hidden_at is null and q.has_key
           where z.meeting_id = p_meeting
             and (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.vote = r.vote) >= 3
           group by r.question_id
           order by min((select count(*) filter (where a.correct)::numeric / nullif(count(*), 0)
                           from public.study_quiz_answers a where a.round_id = r.id and a.vote = r.vote))
           limit 5) x;
  select coalesce(array_agg(x.id), '{}') into more
    from (select q.id from public.study_questions q
           where q.lecture_id = m.lecture_id and q.part_idx between m.part_from and upto
             and q.retired_at is null and q.stale_at is null and q.hidden_at is null and q.has_key and not (q.id = any (qs))
           order by exists (select 1 from public.study_meeting_events e
                             where e.meeting_id = p_meeting and e.kind = 'explain' and e.part_idx = q.part_idx and e.anchor = q.anchor) desc,
                    q.part_idx, coalesce(q.anchor, 0), q.created_at
           limit greatest(0, 5 - cardinality(qs))) x;
  qs := qs || more;
  select coalesce(array_agg(mb.name order by mb.name), '{}') into rd               -- review SEC-12: by name, never by time
    from public.study_reads r join public.study_members mb on mb.group_id = m.group_id and mb.user_id = r.user_id
   where r.lecture_id = m.lecture_id;
  return jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'lecture_id', m.lecture_id, 'day', m.day, 'part_from', m.part_from, 'part_to', upto,
                                  'lecture_title', (select l.title from public.study_lectures l where l.id = m.lecture_id),
                                  'title', coalesce(nullif(m.title, ''), (select string_agg(s.title, ' · ' order by s.idx) from public.study_sections s
                                                                         where s.lecture_id = m.lecture_id and s.idx between m.part_from and upto))),
    'stops', stops, 'resolved', res, 'pins', pins, 'questions', to_jsonb(qs), 'readers', to_jsonb(rd),
    'minutes', 2 + jsonb_array_length(stops) + jsonb_array_length(res) + ceil(jsonb_array_length(pins) * 0.5)::int + ceil(cardinality(qs) * 1.5)::int,
    'done', exists (select 1 from public.study_meeting_catchups c where c.meeting_id = p_meeting and c.user_id = auth.uid()));
end;
$$;

-- Finishing the catch-up. The lecture is marked read for the caller on the
-- next study day, with the meeting's time (study_private.catchup_marks,
-- review SEC-12): who-read-what shows names only, no time, no "באיחור", and
-- no mark arrives live hours after the meeting.
create or replace function public.study_meeting_catchup_done(p_meeting uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m public.study_meetings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_meetings x where x.id = p_meeting;
  if not found or not coalesce(public.study_is_member(m.group_id), false) or m.cancelled_at is not null then
    raise exception 'meeting not found';
  end if;
  insert into public.study_meeting_catchups (meeting_id, user_id) values (p_meeting, auth.uid())
  on conflict (meeting_id, user_id) do nothing;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_meetings              enable row level security;
alter table public.study_meeting_live          enable row level security;
alter table public.study_meeting_taps          enable row level security;
alter table public.study_meeting_events        enable row level security;
alter table public.study_meeting_presence      enable row level security;
alter table public.study_meeting_guess_answers enable row level security;
alter table public.study_meeting_catchups      enable row level security;

drop policy if exists "study meetings read"        on public.study_meetings;
drop policy if exists "study meeting events read"  on public.study_meeting_events;
drop policy if exists "study meeting taps own"     on public.study_meeting_taps;
drop policy if exists "study meeting presence own" on public.study_meeting_presence;
drop policy if exists "study meeting guesses own"  on public.study_meeting_guess_answers;
drop policy if exists "study meeting catchups own" on public.study_meeting_catchups;
create policy "study meetings read" on public.study_meetings
  for select using (public.study_is_member(group_id));
create policy "study meeting events read" on public.study_meeting_events
  for select using (public.study_is_member(public.study_meeting_group(meeting_id)));
create policy "study meeting taps own" on public.study_meeting_taps
  for select using (user_id = auth.uid());
create policy "study meeting presence own" on public.study_meeting_presence
  for select using (user_id = auth.uid());
create policy "study meeting guesses own" on public.study_meeting_guess_answers
  for select using (user_id = auth.uid());
create policy "study meeting catchups own" on public.study_meeting_catchups
  for select using (user_id = auth.uid());
-- study_meeting_live: no policy on purpose.

revoke all on public.study_meetings, public.study_meeting_live, public.study_meeting_taps, public.study_meeting_events,
  public.study_meeting_presence, public.study_meeting_guess_answers, public.study_meeting_catchups from anon, authenticated;
grant select on public.study_meetings, public.study_meeting_events, public.study_meeting_taps, public.study_meeting_presence,
  public.study_meeting_guess_answers, public.study_meeting_catchups to authenticated;

revoke all on function study_private.meeting_over(public.study_meetings) from public;
revoke all on function public.study_meeting_group(uuid), public.study_meeting_save(uuid, int, uuid, timestamptz, uuid, int, int, text, uuid),
  public.study_meeting_cancel(uuid), public.study_meeting_reading(uuid, boolean, int, int), public.study_meeting_place(uuid, int, int),
  public.study_meeting_here(uuid), public.study_meeting_unclear(uuid, int, int, text, boolean), public.study_meeting_reader_view(uuid),
  public.study_meeting_stop(uuid, text, int, int, text, uuid), public.study_meeting_quiz(uuid, text, text, int, int),
  public.study_meeting_guess_pick(uuid), public.study_meeting_guess(uuid, uuid, int), public.study_meeting_guess_state(uuid),
  public.study_meeting_agenda(uuid), public.study_meeting_band(uuid), public.study_my_unclear(uuid), public.study_unclear_done(uuid),
  public.study_my_missed(uuid), public.study_meeting_catchup(uuid), public.study_meeting_catchup_done(uuid)
  from public, anon;
grant execute on function public.study_meeting_group(uuid), public.study_meeting_save(uuid, int, uuid, timestamptz, uuid, int, int, text, uuid),
  public.study_meeting_cancel(uuid), public.study_meeting_reading(uuid, boolean, int, int), public.study_meeting_place(uuid, int, int),
  public.study_meeting_here(uuid), public.study_meeting_unclear(uuid, int, int, text, boolean), public.study_meeting_reader_view(uuid),
  public.study_meeting_stop(uuid, text, int, int, text, uuid), public.study_meeting_quiz(uuid, text, text, int, int),
  public.study_meeting_guess_pick(uuid), public.study_meeting_guess(uuid, uuid, int), public.study_meeting_guess_state(uuid),
  public.study_meeting_agenda(uuid), public.study_meeting_band(uuid), public.study_my_unclear(uuid), public.study_unclear_done(uuid),
  public.study_my_missed(uuid), public.study_meeting_catchup(uuid), public.study_meeting_catchup_done(uuid)
  to authenticated;

-- ── Realtime: the meeting row only (the band, the reader, the guesses'
--  release). Never taps, guesses, presence or the reader's place.
do $$
begin
  execute 'alter publication supabase_realtime add table public.study_meetings';
exception when duplicate_object then
  null;
end $$;

insert into study_private.schema_sections (section, version) values ('M', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

-- ════════════════════════════════════════════════════════════════════════
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
alter table public.study_cards
  add column if not exists anchor     int  check (anchor between 0 and 9999),
  add column if not exists quote      text not null default '' check (char_length(quote) <= 200),
  add column if not exists part_gen   int  check (part_gen >= 0),
  add column if not exists trap_key   text check (char_length(trap_key) <= 120),
  add column if not exists stale_at   timestamptz,
  add column if not exists stale_edit uuid,
  add column if not exists checked_by uuid references auth.users (id) on delete set null,
  add column if not exists checked_at timestamptz,
  add column if not exists opens_at   timestamptz;               -- a trap card hidden until then (review SEC-6)
alter table public.study_cards drop constraint if exists study_cards_source_check;
alter table public.study_cards add constraint study_cards_source_check check (source in ('ai', 'member', 'trap'));
create unique index if not exists study_cards_trap on public.study_cards (lecture_id, trap_key) where trap_key is not null;
create index if not exists study_cards_anchor on public.study_cards (lecture_id, part_idx, anchor) where anchor is not null;

-- An edit of a card's text clears a correction's mark.
create or replace function public.study_cards_unstale()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.stale_at is not null and (new.kind, new.front, new.back, new.extra) is distinct from (old.kind, old.front, old.back, old.extra) then
    new.stale_at := null;
    new.stale_edit := null;
  end if;
  return new;
end;
$$;
revoke all on function public.study_cards_unstale() from public, anon, authenticated;
drop trigger if exists study_cards_unstale on public.study_cards;
create trigger study_cards_unstale before update on public.study_cards
  for each row execute function public.study_cards_unstale();


-- A member's own card (section C's function). From a paragraph's sheet the
-- phone also sends part, para and quote; otherwise the part follows the
-- first slide, as before.
create or replace function public.study_add_card(p_lecture uuid, p_card jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g    uuid := public.study_lecture_group(p_lecture);
  sl   int[] := array(select (jsonb_array_elements_text(coalesce(p_card -> 'slides', '[]'::jsonb)))::int);
  part int  := case when jsonb_typeof(p_card -> 'part') = 'number' and (p_card ->> 'part') ~ '^[0-9]{1,3}$' then (p_card ->> 'part')::int end;
  para int  := case when jsonb_typeof(p_card -> 'para') = 'number' and (p_card ->> 'para') ~ '^[0-9]{1,4}$' then (p_card ->> 'para')::int end;
  why  text;
  cid  uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if (select count(*) from public.study_cards c where c.lecture_id = p_lecture and c.deleted_at is null) >= 150 then
    raise exception 'enough cards';
  end if;
  why := public.study_card_problem(p_card ->> 'kind', p_card ->> 'front', coalesce(p_card ->> 'back', ''),
                                   coalesce(p_card ->> 'extra', ''), coalesce(p_card ->> 'figure', ''), sl, p_lecture);
  if why is not null then raise exception '%', why; end if;
  if part is not null and not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = part) then
    part := null;
  end if;
  if part is null then
    para := null;
    part := (select s.idx from public.study_sections s where s.lecture_id = p_lecture and sl[1] between s.slide_from and s.slide_to limit 1);
  end if;
  insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, figure, slides, topic, aspect,
                                  anchor, quote, part_gen)
  values (g, p_lecture, 'member', part,
          p_card ->> 'kind', btrim(p_card ->> 'front'), coalesce(p_card ->> 'back', ''), coalesce(p_card ->> 'extra', ''),
          coalesce(p_card ->> 'figure', ''), sl, left(coalesce(p_card ->> 'topic', ''), 120),
          coalesce(nullif(p_card ->> 'aspect', ''), 'other'),
          para, case when para is null then '' else left(coalesce(p_card ->> 'quote', ''), 200) end,
          case when para is null then null else (select s.gen from public.study_sections s where s.lecture_id = p_lecture and s.idx = part) end)
  returning id into cid;
  return cid;
end;
$$;

-- "עדיין נכון" on a card a correction marked.
create or replace function public.study_card_still_true(p_card uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_cards c
     set stale_at = null, stale_edit = null, checked_by = auth.uid(), checked_at = now()
   where c.id = p_card and public.study_is_member(c.group_id) and c.stale_at is not null;
  if not found and not exists (select 1 from public.study_cards c where c.id = p_card and public.study_is_member(c.group_id)) then
    raise exception 'card not found';
  end if;
end;
$$;
revoke all on function public.study_card_still_true(uuid), public.study_add_card(uuid, jsonb),
  public.study_save_card(uuid, jsonb, text) from public, anon;
grant execute on function public.study_card_still_true(uuid), public.study_add_card(uuid, jsonb),
  public.study_save_card(uuid, jsonb, text) to authenticated;

-- A trap card (internal: called by section Z's reveal and section V's VAR
-- decision, never by a phone). Checked like any card; null when it does not
-- pass, or when the lecture has its 150 cards. The same trap_key returns
-- the card already made.
drop function if exists study_private.trap_card(uuid, int, int, text, text, text, text, int[], text);
create or replace function study_private.trap_card(p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_front text, p_back text, p_extra text, p_slides int[], p_key text, p_opens_at timestamptz default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g   uuid := public.study_lecture_group(p_lecture);
  why text;
  cid uuid;
begin
  if g is null or p_key is null then return null; end if;
  select c.id into cid from public.study_cards c where c.lecture_id = p_lecture and c.trap_key = p_key;
  if found then return cid; end if;
  if (select count(*) from public.study_cards c where c.lecture_id = p_lecture and c.deleted_at is null) >= 150 then return null; end if;
  why := public.study_card_problem('qa', btrim(p_front), btrim(p_back), coalesce(p_extra, ''), '', coalesce(p_slides, '{}'), p_lecture);
  if why is not null then return null; end if;
  insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, slides, anchor, quote, part_gen,
                                  trap_key, created_by, opens_at)
  values (g, p_lecture, 'trap', p_part, 'qa', btrim(p_front), btrim(p_back), coalesce(p_extra, ''), coalesce(p_slides, '{}'),
          p_anchor, coalesce(left(p_quote, 200), ''),
          case when p_anchor is null then null else (select s.gen from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) end,
          left(p_key, 120), null, case when p_opens_at > now() then p_opens_at end)
  on conflict do nothing
  returning id into cid;
  return cid;
end;
$$;

-- A trap card made from a round that was voided goes too, unless a member
-- has already edited it (then it is the group's card).
create or replace function study_private.trap_card_drop(p_card uuid)
returns void language sql volatile security definer set search_path = public as $$
  delete from public.study_cards c where c.id = p_card and c.source = 'trap' and c.version = 1
$$;
revoke all on function study_private.trap_card(uuid, int, int, text, text, text, text, int[], text, timestamptz),
  study_private.trap_card_drop(uuid) from public;
-- Members read a group card once it is open (review SEC-6). Replaces section
-- C's policy of the same name.
drop policy if exists "study cards read" on public.study_cards;
create policy "study cards read" on public.study_cards
  for select using (public.study_is_member(group_id) and (opens_at is null or opens_at <= now()));

alter table public.study_card_batches
  add column if not exists via        text not null default 'tap' check (via in ('tap', 'batch', 'server')),
  add column if not exists hold_until timestamptz;

-- ── C6: one review home ──
alter table public.study_card_settings
  add column if not exists home text check (home in ('app', 'anki'));     -- null: not chosen yet
grant insert (new_per_day, retention, home) on public.study_card_settings to authenticated;
grant update (new_per_day, retention, home, updated_at) on public.study_card_settings to authenticated;

-- ── D8: the parts a member added to her own deck (owner-only) ──
create table if not exists public.study_card_adoptions (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx >= 0),
  added_at   timestamptz not null default now(),
  primary key (user_id, lecture_id, part_idx)
);
create index if not exists study_card_adoptions_lecture on public.study_card_adoptions (lecture_id);

-- ── C5: private cards (owner-only; the memory is on the row: one owner) ──
create table if not exists public.study_my_cards (
  id          uuid             primary key default gen_random_uuid(),
  user_id     uuid             not null default auth.uid() references auth.users (id) on delete cascade,
  group_id    uuid             not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid             not null references public.study_lectures (id) on delete cascade,
  part_idx    int              check (part_idx >= 0),
  anchor      int              check (anchor between 0 and 9999),
  origin      text             not null check (origin in ('quiz', 'practice', 'answer', 'table')),
  question_id uuid,                                  -- study_questions.id: the key is added below once section Q exists (review F-4)
  comment_id  uuid             references public.study_comments (id) on delete set null,
  front       text             not null check (char_length(btrim(front)) between 3 and 400),
  back        text             not null check (char_length(btrim(back)) between 1 and 300),
  extra       text             not null default '' check (char_length(extra) <= 500),
  slides      int[]            not null default '{}' check (cardinality(slides) <= 12),
  state       smallint         not null default 0 check (state between 0 and 3),
  step        smallint         not null default 0 check (step between 0 and 9),
  stability   double precision not null default 0 check (stability = 0 or stability between 0.001 and 36500),
  difficulty  double precision not null default 0 check (difficulty = 0 or difficulty between 1 and 10),
  due         timestamptz,
  last_review timestamptz,
  reps        int              not null default 0 check (reps >= 0),
  lapses      int              not null default 0 check (lapses >= 0),
  suspended   boolean          not null default false,
  created_at  timestamptz      not null default now(),
  deleted_at  timestamptz,
  check ((state = 0) = (stability = 0 and difficulty = 0)),
  check (state = 0 or (due is not null and last_review is not null))
);
do $$
begin
  if to_regclass('public.study_questions') is not null
     and not exists (select 1 from pg_constraint where conname = 'study_my_cards_question_id_fkey') then
    alter table public.study_my_cards add constraint study_my_cards_question_id_fkey
      foreign key (question_id) references public.study_questions (id) on delete set null;
  end if;
end $$;
-- One card per question per member, and one per answered thread.
create unique index if not exists study_my_cards_question on public.study_my_cards (user_id, question_id) where question_id is not null;
create unique index if not exists study_my_cards_comment on public.study_my_cards (user_id, comment_id) where comment_id is not null;
create index if not exists study_my_cards_due on public.study_my_cards (user_id, due) where deleted_at is null and not suspended;

create table if not exists public.study_my_card_reviews (
  id          uuid        primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  card_id     uuid        not null references public.study_my_cards (id) on delete cascade,
  rating      smallint    not null check (rating between 1 and 4),
  reviewed_at timestamptz not null,
  ms          int         check (ms between 0 and 3600000),
  prev        jsonb       not null,                  -- the memory before (undo)
  created_at  timestamptz not null default now()
);
create index if not exists study_my_card_reviews_mine on public.study_my_card_reviews (user_id, reviewed_at desc);

alter table public.study_card_adoptions  enable row level security;
alter table public.study_my_cards        enable row level security;
alter table public.study_my_card_reviews enable row level security;
drop policy if exists "study card adoptions own"  on public.study_card_adoptions;
drop policy if exists "study my cards own"        on public.study_my_cards;
drop policy if exists "study my card reviews own" on public.study_my_card_reviews;
create policy "study card adoptions own" on public.study_card_adoptions for select using (user_id = auth.uid());
create policy "study my cards own" on public.study_my_cards for select using (user_id = auth.uid());
create policy "study my card reviews own" on public.study_my_card_reviews for select using (user_id = auth.uid());
revoke all on public.study_card_adoptions, public.study_my_cards, public.study_my_card_reviews from anon, authenticated;
grant select on public.study_card_adoptions, public.study_my_cards, public.study_my_card_reviews to authenticated;
-- Never published: every write is a definer function below.

-- ── D3: the worker path (as section Q's end) ──
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
revoke all on function study_private.may_bank(uuid, text) from public;
drop function if exists public.study_card_round(uuid);
create or replace function public.study_card_round(p_lecture uuid, p_key text default null)
returns table (round int, batches int, wanted int, fresh boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  g uuid := public.study_lecture_group(p_lecture);
  r int;
  open_n int;
  open_w int;
  made_n int;
begin
  if auth.uid() is null then
    if not study_private.is_worker(p_key) then raise exception 'not signed in'; end if;   -- the worker (section B)
    if g is null then raise exception 'lecture not found'; end if;
  elsif g is null or not public.study_is_member(g) then
    raise exception 'lecture not found';
  end if;
  if exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('study_card_round:' || p_lecture::text));
  update public.study_card_batches b set status = 'failed', error = 'gave up', updated_at = now()
   where b.lecture_id = p_lecture and b.status = 'writing' and b.attempts >= 3 and b.updated_at < now() - interval '6 minutes'
     and (b.hold_until is null or b.hold_until <= now());
  select max(b.round) into r from public.study_card_batches b where b.lecture_id = p_lecture;
  if r is not null then
    select count(*), coalesce(sum(b.wanted), 0) into open_n, open_w from public.study_card_batches b
     where b.lecture_id = p_lecture and b.round = r and b.status in ('pending', 'writing');
    if open_n > 0 then
      return query select r, open_n, open_w::int, false;
      return;
    end if;
  end if;
  if (select count(*) from public.study_cards c where c.lecture_id = p_lecture and c.deleted_at is null) >= 150
     or (select count(*) from public.study_cards c where c.lecture_id = p_lecture and c.source = 'ai') >= 250 then
    raise exception 'enough cards';
  end if;
  r := coalesce(r, 0) + 1;
  if r > 20 then raise exception 'enough cards'; end if;
  with sl as (
    select (s ->> 'n')::int as n,
           coalesce((select sum(char_length(x)) from jsonb_array_elements_text(coalesce(s -> 'lines', '[]'::jsonb)) x), 0)
           + char_length(coalesce(s ->> 'notes', ''))
           + case when jsonb_typeof(s -> 'tables') = 'array' and jsonb_array_length(s -> 'tables') > 0
                  then char_length((s -> 'tables')::text) else 0 end as chars,
           row_number() over (order by (s ->> 'n')::int) as o
    from public.study_lectures l, jsonb_array_elements(l.slides) s
    where l.id = p_lecture
  ),
  parts as (
    select s.idx as part_idx, s.title as heading, s.slide_from, s.slide_to
    from public.study_sections s where s.lecture_id = p_lecture
    union all
    select ((x.o - 1) / 6)::int, '', min(x.n), max(x.n) from sl x
    where not exists (select 1 from public.study_sections s2 where s2.lecture_id = p_lecture)
    group by (x.o - 1) / 6
  ),
  want as (
    select p.*, least(case when r = 1 then 8 else 4 end,
                      round((select coalesce(sum(x.chars), 0) from sl x where x.n between p.slide_from and p.slide_to)
                            / case when r = 1 then 250.0 else 500.0 end))::int as w
    from parts p
  ),
  total as (select coalesce(sum(w), 0) as t from want)
  insert into public.study_card_batches (lecture_id, round, part_idx, heading, slide_from, slide_to, wanted)
  select p_lecture, r, k.part_idx, left(k.heading, 200), k.slide_from, k.slide_to,
         case when t.t > 60 then greatest(1, floor(k.w * 60.0 / t.t))::int else k.w end
  from want k, total t
  where k.w >= 1;
  get diagnostics made_n = row_count;
  if made_n = 0 then raise exception 'no slides'; end if;
  return query select r, made_n, (select sum(b.wanted)::int from public.study_card_batches b where b.lecture_id = p_lecture and b.round = r), true;
end;
$$;

create or replace function public.study_card_claim(p_batch uuid, p_key text default null)
returns table (lecture_id uuid, round int, part_idx int, heading text, slide_from int, slide_to int, wanted int, effort text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare b public.study_card_batches;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  select * into b from public.study_card_batches x where x.id = p_batch;
  if not found or not study_private.may_bank(b.lecture_id, p_key)
     or exists (select 1 from public.study_lectures l where l.id = b.lecture_id and l.deleted_at is not null) then
    raise exception 'batch not found';
  end if;
  if auth.uid() is not null and b.hold_until > now() then raise exception 'busy'; end if;
  update public.study_card_batches x
     set status = 'writing', attempts = x.attempts + 1, updated_at = now()
   where x.id = p_batch and x.attempts < 3
     and (x.status in ('pending', 'failed') or (x.status = 'writing' and x.updated_at < now() - interval '6 minutes'));
  if not found then
    if b.attempts >= 3 and b.status <> 'ready' then raise exception 'gave up'; end if;
    raise exception 'busy';
  end if;
  return query select b.lecture_id, b.round, b.part_idx, b.heading, b.slide_from, b.slide_to, b.wanted - b.made,
                      case when b.error = 'timeout' then 'low' else 'medium' end;
end;
$$;

-- The meeting block's version (the paragraph) plus the worker path.
create or replace function public.study_save_card(p_batch uuid, p_card jsonb, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  b    public.study_card_batches;
  g    uuid;
  sl   int[] := array(select (jsonb_array_elements_text(coalesce(p_card -> 'slides', '[]'::jsonb)))::int);
  para int   := case when jsonb_typeof(p_card -> 'para') = 'number' and (p_card ->> 'para') ~ '^[0-9]{1,4}$' then (p_card ->> 'para')::int end;
  why  text;
  cid  uuid;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- source 'ai' is the server's word (review B1)
  select * into b from public.study_card_batches x where x.id = p_batch;
  if not found then raise exception 'batch not found'; end if;
  g := public.study_lecture_group(b.lecture_id);
  if not study_private.may_bank(b.lecture_id, p_key) then raise exception 'batch not found'; end if;
  if b.status <> 'writing' then raise exception 'batch not writing'; end if;
  if b.made >= b.wanted then raise exception 'part full'; end if;
  if (select count(*) from public.study_cards c where c.lecture_id = b.lecture_id and c.deleted_at is null) >= 150 then
    raise exception 'enough cards';
  end if;
  why := public.study_card_problem(p_card ->> 'kind', p_card ->> 'front', coalesce(p_card ->> 'back', ''),
                                   coalesce(p_card ->> 'extra', ''), coalesce(p_card ->> 'figure', ''), sl, b.lecture_id);
  if why is not null then raise exception '%', why; end if;
  if cardinality(sl) = 0 then raise exception 'no slides'; end if;
  if not exists (select 1 from unnest(sl) s where s between b.slide_from and b.slide_to) then
    raise exception 'outside the part';
  end if;
  insert into public.study_cards (group_id, lecture_id, batch_id, source, part_idx, kind, front, back, extra, figure,
                                  slides, topic, aspect, model, anchor, quote, part_gen, created_by)
  values (g, b.lecture_id, p_batch, 'ai', b.part_idx, p_card ->> 'kind', btrim(p_card ->> 'front'),
          coalesce(p_card ->> 'back', ''), coalesce(p_card ->> 'extra', ''), coalesce(p_card ->> 'figure', ''), sl,
          left(coalesce(p_card ->> 'topic', ''), 120), coalesce(nullif(p_card ->> 'aspect', ''), 'other'),
          left(p_card ->> 'model', 80),
          para, case when para is null then '' else left(coalesce(p_card ->> 'quote', ''), 200) end,
          case when para is null then null
               else (select s.gen from public.study_sections s where s.lecture_id = b.lecture_id and s.idx = b.part_idx) end,
          auth.uid())
  returning id into cid;
  update public.study_card_batches x set made = x.made + 1, updated_at = now() where x.id = p_batch;
  return cid;
end;
$$;

create or replace function public.study_card_finish(p_batch uuid, p_status text, p_rejected int,
  p_model text, p_cost numeric, p_error text, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if p_status not in ('ready', 'failed') then raise exception 'bad status'; end if;
  update public.study_card_batches x
     set status = p_status,
         rejected = x.rejected + greatest(0, coalesce(p_rejected, 0)),
         model = coalesce(left(p_model, 80), x.model),
         cost_usd = x.cost_usd + greatest(0, coalesce(p_cost, 0)),
         error = left(p_error, 200),
         hold_until = null,
         updated_at = now()
   where x.id = p_batch
     and x.status = 'writing'
     and study_private.may_bank(x.lecture_id, p_key);
  if not found then raise exception 'batch not writing'; end if;
end;
$$;

-- ── D8: adding parts to one's own deck ("להוסיף"), or taking them out ──
-- p_parts null: every part of the lecture. Returns the parts now in the deck.
create or replace function public.study_card_adopt(p_lecture uuid, p_parts int[], p_on boolean default true)
returns int[] language plpgsql volatile security definer set search_path = public as $$
declare g uuid := public.study_lecture_group(p_lecture);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  if p_parts is not null and exists (select 1 from unnest(p_parts) x
                                      where not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = x)) then
    raise exception 'bad parts';
  end if;
  if coalesce(p_on, true) then
    insert into public.study_card_adoptions (user_id, lecture_id, part_idx)
    select auth.uid(), p_lecture, s.idx from public.study_sections s
     where s.lecture_id = p_lecture and (p_parts is null or s.idx = any (p_parts))
    on conflict do nothing;
  else
    delete from public.study_card_adoptions a
     where a.user_id = auth.uid() and a.lecture_id = p_lecture and (p_parts is null or a.part_idx = any (p_parts));
  end if;
  return coalesce((select array_agg(a.part_idx order by a.part_idx) from public.study_card_adoptions a
                    where a.user_id = auth.uid() and a.lecture_id = p_lecture), '{}');
end;
$$;

-- Is this group card new material for the caller: in a part she added, a
-- trap card (the group's vaccine), or a card she wrote herself.
create or replace function study_private.card_in_my_deck(p_card public.study_cards)
returns boolean language sql stable security definer set search_path = public as $$
  select p_card.source = 'trap' or p_card.created_by = auth.uid()
      or exists (select 1 from public.study_card_adoptions a
                  where a.user_id = auth.uid() and a.lecture_id = p_card.lecture_id and a.part_idx = p_card.part_idx)
$$;
revoke all on function study_private.card_in_my_deck(public.study_cards) from public;

-- The lecture's deck page (cards.html s3): per part, its cards, whether it is
-- in the caller's deck, and how many of them she has studied.
create or replace function public.study_my_deck(p_lecture uuid)
returns table (part_idx int, heading text, slide_from int, slide_to int, cards int, in_deck boolean, studied int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'lecture not found';
  end if;
  return query
  select s.idx, s.title, s.slide_from, s.slide_to,
         (select count(*)::int from public.study_cards c where c.lecture_id = p_lecture and c.part_idx = s.idx and c.deleted_at is null
             and (c.opens_at is null or c.opens_at <= now())),
         exists (select 1 from public.study_card_adoptions a where a.user_id = auth.uid() and a.lecture_id = p_lecture and a.part_idx = s.idx),
         (select count(*)::int from public.study_cards c join public.study_card_states st on st.card_id = c.id and st.user_id = auth.uid()
           where c.lecture_id = p_lecture and c.part_idx = s.idx and c.deleted_at is null and st.state > 0)
    from public.study_sections s
   where s.lecture_id = p_lecture
   order by s.idx;
end;
$$;

-- Section C's counts, now with the deck part by part: a card never studied
-- counts as new only when it is in the caller's deck (D8).
create or replace function public.study_my_card_counts(p_group uuid, p_now timestamptz default now())
returns table (lecture_id uuid, cards int, new_cards int, learning_due int, review_due int, studied int, hidden int, next_due timestamptz)
language sql stable security definer set search_path = public as $$
  select c.lecture_id,
         count(*)::int,
         (count(*) filter (where (s.card_id is null or (s.state = 0 and not s.suspended)) and study_private.card_in_my_deck(c)))::int,
         (count(*) filter (where s.state in (1, 3) and not s.suspended and s.due <= p_now + interval '20 minutes'))::int,
         (count(*) filter (where s.state = 2 and not s.suspended and s.due < public.study_day_end(p_now)))::int,
         (count(*) filter (where s.state > 0))::int,
         (count(*) filter (where s.suspended))::int,
         min(s.due) filter (where s.state > 0 and not s.suspended)
  from public.study_cards c
  left join public.study_card_states s on s.card_id = c.id and s.user_id = auth.uid()
  where c.group_id = p_group and c.deleted_at is null and coalesce(public.study_is_member(p_group), false)
    and (c.opens_at is null or c.opens_at <= p_now)          -- review SEC-6
  group by c.lecture_id;
$$;

-- ── C5: the card a mistake becomes (the database writes it, $0) ──
-- Front: the teaser, else the case and the lead-in (at most 400 characters,
-- cut at a word). Back: the right option and why (at most 300). Extra: the
-- autopsy of the option the member chose ("ענית X: …").
create or replace function study_private.mistake_card(p_user uuid, p_question uuid, p_choice int, p_origin text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  q   record;                      -- section Q's row types are not named, so section C loads before Q (review F-4)
  k   record;
  f   text;
  b   text;
  x   text := '';
  cid uuid;
begin
  select * into q from public.study_questions z where z.id = p_question;
  if not found or q.lecture_id is null or q.source = 'exam' then return null; end if;
  select * into k from public.study_question_keys z where z.question_id = p_question;
  if not found or k.answer is null then return null; end if;
  f := coalesce(nullif(btrim(to_jsonb(q) ->> 'teaser'), ''),
                btrim(case when q.vignette <> '' then q.vignette || E'\n' else '' end || q.question));
  if char_length(f) > 400 then f := btrim(regexp_replace(left(f, 399), '\s+\S*$', '')) || '…'; end if;
  b := q.options[k.answer + 1] || coalesce(': ' || nullif(k.explanations[k.answer + 1], ''), '');
  if char_length(b) > 300 then b := btrim(regexp_replace(left(b, 299), '\s+\S*$', '')) || '…'; end if;
  if p_choice is not null and p_choice <> k.answer and p_choice < cardinality(q.options) then
    x := 'ענית ' || q.options[p_choice + 1] || coalesce(': ' || nullif(k.explanations[p_choice + 1], ''), '');
  elsif p_choice is null then
    x := coalesce(nullif(k.takeaway, ''), '');
  end if;
  if char_length(x) > 500 then x := btrim(regexp_replace(left(x, 499), '\s+\S*$', '')) || '…'; end if;
  insert into public.study_my_cards (user_id, group_id, lecture_id, part_idx, anchor, origin, question_id, front, back, extra, slides)
  values (p_user, q.group_id, q.lecture_id, q.part_idx, (to_jsonb(q) ->> 'anchor')::int, p_origin, p_question, f, b, x,
          q.slides[1:12])
  on conflict do nothing
  returning id into cid;
  return cid;
end;
$$;
revoke all on function study_private.mistake_card(uuid, uuid, int, text) from public;

-- Every wrong answer in practice or in a live quiz (its first vote) makes
-- the card once; a later wrong answer to the same question makes none.
create or replace function public.study_answers_mistake_card()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.correct and new.mode in ('lecture', 'course', 'mistakes', 'quiz', 'exam') then
    perform study_private.mistake_card(new.user_id, new.question_id, new.choice,
                                       case when new.mode = 'quiz' then 'quiz' else 'practice' end);
  end if;
  return null;
end;
$$;
revoke all on function public.study_answers_mistake_card() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.study_answers') is not null then
    drop trigger if exists study_answers_mistake_card on public.study_answers;
    create trigger study_answers_mistake_card after insert on public.study_answers
      for each row execute function public.study_answers_mistake_card();
  end if;
end $$;

-- A private card from a paragraph: the answer to one's own question (K4,
-- origin 'answer', p_comment = the question) or a wrong cell of a blank
-- table (P10, origin 'table'). The front and back are the member's to edit
-- before saving; the slides must be the lecture's.
create or replace function public.study_my_card_add(p_lecture uuid, p_origin text, p_part int, p_anchor int,
  p_front text, p_back text, p_slides int[] default '{}', p_comment uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g    uuid := public.study_lecture_group(p_lecture);
  have int[];
  c    public.study_comments;
  cid  uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if coalesce(p_origin, '') not in ('answer', 'table') then raise exception 'bad origin'; end if;
  if char_length(btrim(coalesce(p_front, ''))) not between 3 and 400 then raise exception 'front length'; end if;
  if char_length(btrim(coalesce(p_back, ''))) not between 1 and 300 then raise exception 'too long'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = p_lecture;
  if cardinality(coalesce(p_slides, '{}')) > 12 or not (coalesce(p_slides, '{}') <@ have) then raise exception 'unknown slide'; end if;
  if p_origin = 'answer' then
    select * into c from public.study_comments x where x.id = p_comment;
    if not found or c.lecture_id <> p_lecture or c.kind <> 'question' or c.parent_id is not null then
      raise exception 'comment not found';
    end if;
    if c.author_id <> auth.uid() then raise exception 'not yours'; end if;
  end if;
  insert into public.study_my_cards (user_id, group_id, lecture_id, part_idx, anchor, origin, comment_id, front, back, slides)
  values (auth.uid(), g, p_lecture, p_part, p_anchor, p_origin, case when p_origin = 'answer' then p_comment end,
          btrim(p_front), btrim(p_back), coalesce(p_slides, '{}'))
  on conflict do nothing
  returning id into cid;
  if cid is null then raise exception 'already'; end if;
  return cid;
end;
$$;

-- Reviewing a private card: the same rules as section C's study_card_review
-- (the phone computes FSRS-6; the database checks it is sane), idempotent
-- by the review's id. Returns 'ok' or 'dup'.
create or replace function public.study_my_card_review(p_review uuid, p_card uuid, p_rating int, p_reviewed_at timestamptz,
  p_ms int, p_prev_reps int, p_next jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  c        public.study_my_cards;
  v_state  int; v_step int; v_s double precision; v_d double precision; v_due timestamptz; v_lapses int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_review is null then raise exception 'bad review'; end if;
  if exists (select 1 from public.study_my_card_reviews r where r.id = p_review) then
    if exists (select 1 from public.study_my_card_reviews r where r.id = p_review and r.user_id = auth.uid()) then return 'dup'; end if;
    raise exception 'bad review';
  end if;
  select * into c from public.study_my_cards x where x.id = p_card and x.user_id = auth.uid() for update;
  if not found or c.deleted_at is not null then raise exception 'card not found'; end if;
  if p_rating is null or p_rating not between 1 and 4 then raise exception 'bad rating'; end if;
  if p_reviewed_at is null or p_reviewed_at > now() + interval '5 minutes' or p_reviewed_at < now() - interval '30 days' then
    raise exception 'bad time';
  end if;
  if c.reps <> coalesce(p_prev_reps, -1) or (c.last_review is not null and p_reviewed_at < c.last_review) then raise exception 'stale'; end if;
  begin
    v_state := (p_next ->> 'state')::int; v_step := coalesce((p_next ->> 'step')::int, 0);
    v_s := (p_next ->> 'stability')::double precision; v_d := (p_next ->> 'difficulty')::double precision;
    v_due := (p_next ->> 'due')::timestamptz; v_lapses := (p_next ->> 'lapses')::int;
  exception when others then
    raise exception 'bad state';
  end;
  if v_state is null or v_state not between 1 and 3 or v_step not between 0 and 9
     or v_s is null or v_s not between 0.001 and 36500 or v_d is null or v_d not between 1 and 10
     or v_due is null or v_due < p_reviewed_at or v_due > p_reviewed_at + interval '36501 days'
     or v_lapses is null or v_lapses <> c.lapses + (p_rating = 1 and c.state = 2)::int then
    raise exception 'bad state';
  end if;
  insert into public.study_my_card_reviews (id, user_id, card_id, rating, reviewed_at, ms, prev)
  values (p_review, auth.uid(), p_card, p_rating, p_reviewed_at, case when p_ms between 0 and 3600000 then p_ms end,
          jsonb_build_object('state', c.state, 'step', c.step, 'stability', c.stability, 'difficulty', c.difficulty,
                             'due', c.due, 'last_review', c.last_review, 'reps', c.reps, 'lapses', c.lapses));
  update public.study_my_cards x
     set state = v_state, step = v_step, stability = v_s, difficulty = v_d, due = v_due, last_review = p_reviewed_at,
         reps = c.reps + 1, lapses = v_lapses
   where x.id = p_card;
  return 'ok';
end;
$$;

-- Takes back the latest answer to a private card.
create or replace function public.study_my_card_undo(p_review uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.study_my_card_reviews;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from public.study_my_card_reviews x where x.id = p_review and x.user_id = auth.uid();
  if not found then raise exception 'review not found'; end if;
  if exists (select 1 from public.study_my_card_reviews x where x.card_id = r.card_id and x.id <> r.id
              and (x.reviewed_at, x.created_at) > (r.reviewed_at, r.created_at)) then
    raise exception 'not the latest';
  end if;
  update public.study_my_cards c
     set state = (r.prev ->> 'state')::smallint, step = (r.prev ->> 'step')::smallint,
         stability = (r.prev ->> 'stability')::double precision, difficulty = (r.prev ->> 'difficulty')::double precision,
         due = (r.prev ->> 'due')::timestamptz, last_review = (r.prev ->> 'last_review')::timestamptz,
         reps = (r.prev ->> 'reps')::int, lapses = (r.prev ->> 'lapses')::int
   where c.id = r.card_id;
  delete from public.study_my_card_reviews x where x.id = r.id;
end;
$$;

-- Hide a private card from one's reviews, or delete it ("למחוק"): a deleted
-- card is gone from the phone; its question does not make a new one.
create or replace function public.study_my_card_set(p_card uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(p_action, '') not in ('hide', 'show', 'delete', 'restore') then raise exception 'bad action'; end if;
  update public.study_my_cards c
     set suspended = case p_action when 'hide' then true when 'show' then false else c.suspended end,
         deleted_at = case p_action when 'delete' then now() when 'restore' then null else c.deleted_at end
   where c.id = p_card and c.user_id = auth.uid();
  if not found then raise exception 'card not found'; end if;
end;
$$;

revoke all on function public.study_card_round(uuid, text), public.study_card_claim(uuid, text), public.study_save_card(uuid, jsonb, text),
  public.study_card_finish(uuid, text, int, text, numeric, text, text),
  public.study_card_adopt(uuid, int[], boolean), public.study_my_deck(uuid), public.study_my_card_counts(uuid, timestamptz),
  public.study_my_card_add(uuid, text, int, int, text, text, int[], uuid),
  public.study_my_card_review(uuid, uuid, int, timestamptz, int, int, jsonb), public.study_my_card_undo(uuid),
  public.study_my_card_set(uuid, text)
  from public, anon;
grant execute on function public.study_card_round(uuid, text), public.study_card_claim(uuid, text), public.study_save_card(uuid, jsonb, text),
  public.study_card_finish(uuid, text, int, text, numeric, text, text),
  public.study_card_adopt(uuid, int[], boolean), public.study_my_deck(uuid), public.study_my_card_counts(uuid, timestamptz),
  public.study_my_card_add(uuid, text, int, int, text, text, int[], uuid),
  public.study_my_card_review(uuid, uuid, int, timestamptz, int, int, jsonb), public.study_my_card_undo(uuid),
  public.study_my_card_set(uuid, text)
  to authenticated;

insert into study_private.schema_sections (section, version) values ('C', 2)
on conflict (section) do update set version = excluded.version, loaded_at = now();

-- ════════════════════════════════════════════════════════════════════════
--  SECTION C · FLASHCARDS   (owned by package C)
--  design-cards.md §2.2. Needs nothing from sections Q or Z.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  flashcards (כרטיסיות) for תמצית,
--  design-cards.md. To be appended to supabase/study-schema.sql after the
--  practice-questions section (its own section needs nothing from it).
--  Re-runnable, like the rest of the file.
--
--  Who sees what
--  ─────────────
--  Shared inside the group: one deck per lecture, made once for everyone;
--  the generation rounds; and every card's history (who edited, deleted or
--  restored it, and what it said before), so any member can fix a bad card
--  and any member can undo a fix.
--  Private to each member: their memory of each card (study_card_states),
--  their review log (study_card_reviews) and their settings
--  (study_card_settings). Due counts, daily numbers and weak points are
--  functions over the caller's own rows (Shoham: "יראו רק למשתמש הנוכחי").
--
--  Writes go through security-definer functions: generating, adding,
--  editing, deleting, restoring and reverting a card (each leaves a history
--  row), and recording a review (state and log together, idempotent by the
--  review's own id, so a phone that resends after a dropped connection is
--  not counted twice). The scheduler (FSRS-6) runs on the phone
--  (shared/study/fsrs.ts); the database checks that what it stores is sane,
--  not the arithmetic: a member can only mislead their own schedule.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Generation rounds: one row per lecture part per round, claimed by one
--  /api/study/ai call at a time (op "cards"), visible to the group.
create table if not exists public.study_card_batches (
  id         uuid          primary key default gen_random_uuid(),
  lecture_id uuid          not null references public.study_lectures (id) on delete cascade,
  round      int           not null check (round between 1 and 20),
  part_idx   int           not null check (part_idx >= 0),
  heading    text          not null default '' check (char_length(heading) <= 200),
  slide_from int           not null,
  slide_to   int           not null,
  wanted     int           not null check (wanted between 1 and 8),
  status     text          not null default 'pending' check (status in ('pending', 'writing', 'ready', 'failed')),
  made       int           not null default 0 check (made >= 0),
  rejected   int           not null default 0 check (rejected >= 0),
  model      text          check (char_length(model) <= 80),
  cost_usd   numeric(10,4) not null default 0 check (cost_usd >= 0),
  error      text          check (char_length(error) <= 200),
  created_by uuid          default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now(),
  unique (lecture_id, round, part_idx),
  check (slide_to >= slide_from)
);
-- Paid tries of a batch: at most 3 (review M6).
alter table public.study_card_batches add column if not exists attempts int not null default 0;

-- ── The cards (shared). A question card: front = the question, back = its
--  short answer. A cloze card: front = one sentence with exactly one {{…}},
--  back = ''. figure = a slide picture shown with the answer ("fig:12-1").
--  updated_at moves only when the content or the deletion changes: an Anki
--  export uses it as the note's mod ("update if newer", research-anki).
create table if not exists public.study_cards (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  batch_id   uuid        references public.study_card_batches (id) on delete set null,
  source     text        not null default 'ai' check (source in ('ai', 'member')),
  part_idx   int         check (part_idx >= 0),
  kind       text        not null check (kind in ('qa', 'cloze')),
  front      text        not null check (char_length(btrim(front)) between 3 and 400),
  back       text        not null default '' check (char_length(back) <= 300),
  extra      text        not null default '' check (char_length(extra) <= 500),
  figure     text        not null default '' check (figure = '' or figure ~ '^fig:[0-9]{1,4}-[0-9]{1,3}$'),
  slides     int[]       not null default '{}' check (cardinality(slides) <= 12),
  topic      text        not null default '' check (char_length(topic) <= 120),
  aspect     text        not null default 'other' check (aspect in (
               'mechanism', 'uses', 'pk', 'adverse', 'contra', 'interactions', 'resistance', 'dosing',
               'classification', 'epidemiology', 'lifecycle', 'pathogenesis', 'clinical', 'diagnosis',
               'treatment', 'prevention', 'other')),
  model      text        check (char_length(model) <= 80),
  version    int         not null default 1 check (version >= 1),
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid        references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid        references auth.users (id) on delete set null,
  constraint study_cards_form check (
    (kind = 'qa' and position('{{' in front) = 0 and position('}}' in front) = 0 and char_length(btrim(back)) >= 1)
    or (kind = 'cloze' and back = '' and front ~ '^[^{}]*\{\{[^{}]{1,80}\}\}[^{}]*$'))
);
create index if not exists study_cards_lecture on public.study_cards (lecture_id, part_idx, created_at);
create index if not exists study_cards_group on public.study_cards (group_id) where deleted_at is null;

-- ── A card's history: every edit, deletion, restore and revert, with the
--  content before and after, so the group sees who changed what and anyone
--  can put a version back. Written only by the functions below.
create table if not exists public.study_card_edits (
  id        uuid        primary key default gen_random_uuid(),
  card_id   uuid        not null references public.study_cards (id) on delete cascade,
  action    text        not null check (action in ('edit', 'delete', 'restore', 'revert')),
  version   int         not null check (version >= 1),        -- the card's version after this action
  before    jsonb       not null default '{}'::jsonb,         -- kind, front, back, extra, figure, slides
  after     jsonb       not null default '{}'::jsonb,
  edited_by uuid        default auth.uid() references auth.users (id) on delete set null,
  edited_at timestamptz not null default now()
);
create index if not exists study_card_edits_card on public.study_card_edits (card_id, edited_at desc);

-- ── One member's memory of one card (private). No row = a new card.
--  state: 0 new, 1 learning, 2 review, 3 relearning (FSRS / ts-fsrs numbers);
--  step: the (re)learning step; stability in days, difficulty 1-10.
create table if not exists public.study_card_states (
  user_id     uuid             not null default auth.uid() references auth.users (id) on delete cascade,
  card_id     uuid             not null references public.study_cards (id) on delete cascade,
  state       smallint         not null default 0 check (state between 0 and 3),
  step        smallint         not null default 0 check (step between 0 and 9),
  stability   double precision not null default 0 check (stability = 0 or stability between 0.001 and 36500),
  difficulty  double precision not null default 0 check (difficulty = 0 or difficulty between 1 and 10),
  due         timestamptz,
  last_review timestamptz,
  reps        int              not null default 0 check (reps >= 0),
  lapses      int              not null default 0 check (lapses >= 0),
  suspended   boolean          not null default false,          -- "להסתיר ממני": this member only
  updated_at  timestamptz      not null default now(),
  primary key (user_id, card_id),
  check ((state = 0) = (stability = 0 and difficulty = 0)),
  check (state = 0 or (due is not null and last_review is not null))
);
create index if not exists study_card_states_due on public.study_card_states (user_id, due) where not suspended;
create index if not exists study_card_states_card on public.study_card_states (card_id);

-- ── The review log (private): what was answered, when, and the state before
--  (for undo). Its id is made on the phone, so a resend is not counted twice.
create table if not exists public.study_card_reviews (
  id           uuid             primary key,
  user_id      uuid             not null default auth.uid() references auth.users (id) on delete cascade,
  card_id      uuid             not null references public.study_cards (id) on delete cascade,
  rating       smallint         not null check (rating between 1 and 4),      -- שוב, קשה, טוב, קל
  reviewed_at  timestamptz      not null,
  ms           int              check (ms between 0 and 3600000),
  elapsed_days int              not null check (elapsed_days >= 0),
  state_before smallint         not null check (state_before between 0 and 3),
  state_after  smallint         not null check (state_after between 1 and 3),
  stability    double precision not null check (stability between 0.001 and 36500),
  difficulty   double precision not null check (difficulty between 1 and 10),
  due          timestamptz      not null,
  prev         jsonb,                            -- the state before, for undo ('{}': the card was new);
                                                 -- null once a later answer, a day on, made it old
  created_at   timestamptz      not null default now()
);
create index if not exists study_card_reviews_mine on public.study_card_reviews (user_id, reviewed_at desc);
create index if not exists study_card_reviews_card on public.study_card_reviews (user_id, card_id, reviewed_at desc);
create index if not exists study_card_reviews_card_fk on public.study_card_reviews (card_id);

-- ── Each member's own settings, the same on every device (private).
create table if not exists public.study_card_settings (
  user_id     uuid         primary key default auth.uid() references auth.users (id) on delete cascade,
  new_per_day int          not null default 20 check (new_per_day between 0 and 200),
  retention   numeric(3,2) not null default 0.90 check (retention between 0.80 and 0.97),
  updated_at  timestamptz  not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
--  Helpers
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.study_card_group(c uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_cards where id = c;
$$;

-- The study day: Israel time, starting at 04:00 (Anki's default "Next day
-- starts at"), as days since 1970-01-01. shared/study/fsrs.ts studyDay() is
-- the same rule; the tests compare them.
create or replace function public.study_day(p_at timestamptz)
returns int language sql stable set search_path = public as $$
  select (((p_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date - date '1970-01-01')::int
$$;

-- When the study day of p_at ends: the next 04:00 in Israel.
create or replace function public.study_day_end(p_at timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select ((date '1970-01-01' + public.study_day(p_at) + 1) + time '04:00') at time zone 'Asia/Jerusalem'
$$;

-- FSRS-6's forgetting curve with its default decay (w20 = 0.1542): the chance
-- of recall p_days after the last review. R(S, S) = 0.9.
create or replace function public.study_card_recall(p_stability double precision, p_days int)
returns double precision language sql immutable set search_path = public as $$
  select case when p_stability is null or p_stability <= 0 then null
              else power(1 + (power(0.9, -1 / 0.1542) - 1) * greatest(p_days, 0) / p_stability, -0.1542) end
$$;

-- Why a card's content is not acceptable, or null: the table's own checks as
-- readable reasons, plus "the slides and the picture exist in this lecture".
create or replace function public.study_card_problem(p_kind text, p_front text, p_back text, p_extra text,
  p_figure text, p_slides int[], p_lecture uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  have int[];
  fn int;
  fk int;
begin
  if coalesce(p_kind, '') not in ('qa', 'cloze') then return 'bad kind'; end if;
  if char_length(btrim(coalesce(p_front, ''))) not between 3 and 400 then return 'front length'; end if;
  if char_length(coalesce(p_back, '')) > 300 or char_length(coalesce(p_extra, '')) > 500 then return 'too long'; end if;
  if p_kind = 'cloze' and (coalesce(p_back, '') <> '' or p_front !~ '^[^{}]*\{\{[^{}]{1,80}\}\}[^{}]*$') then return 'bad cloze'; end if;
  if p_kind = 'qa' and (position('{{' in p_front) > 0 or position('}}' in p_front) > 0 or char_length(btrim(coalesce(p_back, ''))) = 0) then
    return 'bad answer';
  end if;
  if cardinality(coalesce(p_slides, '{}')) > 12 then return 'too many slides'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = p_lecture;
  if not (coalesce(p_slides, '{}') <@ have) then return 'unknown slide'; end if;
  if coalesce(p_figure, '') <> '' then
    if p_figure !~ '^fig:[0-9]{1,4}-[0-9]{1,3}$' then return 'bad figure'; end if;
    fn := split_part(substr(p_figure, 5), '-', 1)::int;
    fk := split_part(substr(p_figure, 5), '-', 2)::int;
    if not exists (select 1 from public.study_lectures l, jsonb_array_elements(l.slides) s,
                          jsonb_array_elements(coalesce(s -> 'figures', '[]'::jsonb)) f
                    where l.id = p_lecture and (s ->> 'n')::int = fn and (f ->> 'k')::int = fk) then
      return 'unknown figure';
    end if;
  end if;
  return null;
end;
$$;

-- version and updated_at follow the content, whoever writes the row.
create or replace function public.study_card_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.kind, new.front, new.back, new.extra, new.figure, new.slides)
     is distinct from (old.kind, old.front, old.back, old.extra, old.figure, old.slides) then
    new.version := old.version + 1;
    new.updated_at := now();
  elsif new.deleted_at is distinct from old.deleted_at then
    new.version := old.version;
    new.updated_at := now();
  else
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
drop trigger if exists study_card_touch on public.study_cards;
create trigger study_card_touch before update on public.study_cards
  for each row execute function public.study_card_touch();

-- ═══════════════════════════════════════════════════════════════════════
--  Generation: plan a round, claim a part, save each card, finish
-- ═══════════════════════════════════════════════════════════════════════

-- Plans the next round for a lecture. Round 1: about one card per 250
-- characters of slide text (lines, tables, speaker notes), at most 8 a part;
-- later rounds ("עוד כרטיסיות") half that, at most 4 a part. A round of more
-- than 60 is scaled down. Parts are the summary's; before an outline exists,
-- six-slide chunks. An open round (parts pending or being written) is
-- returned instead (fresh = false), so two members tapping at once drive the
-- same round.
create or replace function public.study_card_round(p_lecture uuid)
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
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('study_card_round:' || p_lecture::text));
  -- A batch whose 3 tries all died stops holding its round open.
  update public.study_card_batches b set status = 'failed', error = 'gave up', updated_at = now()
   where b.lecture_id = p_lecture and b.status = 'writing' and b.attempts >= 3 and b.updated_at < now() - interval '6 minutes';
  select max(b.round) into r from public.study_card_batches b where b.lecture_id = p_lecture;
  if r is not null then
    select count(*), coalesce(sum(b.wanted), 0) into open_n, open_w from public.study_card_batches b
     where b.lecture_id = p_lecture and b.round = r and b.status in ('pending', 'writing');
    if open_n > 0 then
      return query select r, open_n, open_w::int, false;
      return;
    end if;
  end if;
  -- 150 live cards, and 250 ever generated: deleting cards does not free paid rounds (review M6).
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

-- Takes one part to write. Free when pending, failed (a tap on "לנסות
-- שוב"), or "writing" with no sign of life for six minutes (a phone that
-- slept). Raises 'busy' otherwise. Effort medium; low after a timeout.
create or replace function public.study_card_claim(p_batch uuid, p_key text default null)
returns table (lecture_id uuid, round int, part_idx int, heading text, slide_from int, slide_to int, wanted int, effort text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare b public.study_card_batches;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- only the op (review B1)
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.study_card_batches x where x.id = p_batch;
  if not found or not public.study_is_member(public.study_lecture_group(b.lecture_id))
     or exists (select 1 from public.study_lectures l where l.id = b.lecture_id and l.deleted_at is not null) then
    raise exception 'batch not found';
  end if;
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

-- Saves one generated card. p_card: { kind, front, back, extra, figure,
-- slides[], topic, aspect, model }. The API has already checked the card
-- (one fact, cloze form, lengths, duplicates); these are the checks the
-- database must not trust anyone on.
create or replace function public.study_save_card(p_batch uuid, p_card jsonb, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  b   public.study_card_batches;
  g   uuid;
  sl  int[] := array(select (jsonb_array_elements_text(coalesce(p_card -> 'slides', '[]'::jsonb)))::int);
  why text;
  cid uuid;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- source 'ai' is the server's word (review B1)
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.study_card_batches x where x.id = p_batch;
  if not found then raise exception 'batch not found'; end if;
  g := public.study_lecture_group(b.lecture_id);
  if not public.study_is_member(g) then raise exception 'batch not found'; end if;
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
                                  slides, topic, aspect, model)
  values (g, b.lecture_id, p_batch, 'ai', b.part_idx, p_card ->> 'kind', btrim(p_card ->> 'front'),
          coalesce(p_card ->> 'back', ''), coalesce(p_card ->> 'extra', ''), coalesce(p_card ->> 'figure', ''), sl,
          left(coalesce(p_card ->> 'topic', ''), 120), coalesce(nullif(p_card ->> 'aspect', ''), 'other'),
          left(p_card ->> 'model', 80))
  returning id into cid;
  update public.study_card_batches x set made = x.made + 1, updated_at = now() where x.id = p_batch;
  return cid;
end;
$$;

-- Ends a claimed part: ready (even with fewer cards than wanted) or failed.
create or replace function public.study_card_finish(p_batch uuid, p_status text, p_rejected int,
  p_model text, p_cost numeric, p_error text, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_status not in ('ready', 'failed') then raise exception 'bad status'; end if;
  update public.study_card_batches x
     set status = p_status,
         rejected = x.rejected + greatest(0, coalesce(p_rejected, 0)),
         model = coalesce(left(p_model, 80), x.model),
         cost_usd = x.cost_usd + greatest(0, coalesce(p_cost, 0)),
         error = left(p_error, 200),
         updated_at = now()
   where x.id = p_batch
     and x.status = 'writing'
     and public.study_is_member(public.study_lecture_group(x.lecture_id));
  if not found then raise exception 'batch not writing'; end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The group's deck: add, edit, delete, restore, revert (all with history)
-- ═══════════════════════════════════════════════════════════════════════

-- A member's own card ("הוספת כרטיסייה"). It is marked source = 'member'.
create or replace function public.study_add_card(p_lecture uuid, p_card jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g   uuid := public.study_lecture_group(p_lecture);
  sl  int[] := array(select (jsonb_array_elements_text(coalesce(p_card -> 'slides', '[]'::jsonb)))::int);
  why text;
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if (select count(*) from public.study_cards c where c.lecture_id = p_lecture and c.deleted_at is null) >= 150 then
    raise exception 'enough cards';
  end if;
  why := public.study_card_problem(p_card ->> 'kind', p_card ->> 'front', coalesce(p_card ->> 'back', ''),
                                   coalesce(p_card ->> 'extra', ''), coalesce(p_card ->> 'figure', ''), sl, p_lecture);
  if why is not null then raise exception '%', why; end if;
  insert into public.study_cards (group_id, lecture_id, source, part_idx, kind, front, back, extra, figure, slides, topic, aspect)
  values (g, p_lecture, 'member',
          (select s.idx from public.study_sections s where s.lecture_id = p_lecture and sl[1] between s.slide_from and s.slide_to limit 1),
          p_card ->> 'kind', btrim(p_card ->> 'front'), coalesce(p_card ->> 'back', ''), coalesce(p_card ->> 'extra', ''),
          coalesce(p_card ->> 'figure', ''), sl, left(coalesce(p_card ->> 'topic', ''), 120),
          coalesce(nullif(p_card ->> 'aspect', ''), 'other'))
  returning id into cid;
  return cid;
end;
$$;

-- Fixes a card for the whole group. p_version is the version the member
-- edited: a card someone else changed meanwhile raises 'conflict'. Returns
-- the new version. The history row keeps the text before, for "ביטול".
create or replace function public.study_edit_card(p_card uuid, p_version int, p_new jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  c   public.study_cards;
  k   text;
  f   text;
  b   text;
  e   text;
  fig text;
  sl  int[];
  why text;
  v   int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from public.study_cards x where x.id = p_card for update;
  if not found or not public.study_is_member(c.group_id) then raise exception 'card not found'; end if;
  if c.deleted_at is not null then raise exception 'card deleted'; end if;
  if c.version <> p_version then raise exception 'conflict'; end if;
  k := coalesce(p_new ->> 'kind', c.kind);
  f := btrim(coalesce(p_new ->> 'front', c.front));
  b := case when k = 'cloze' then '' else btrim(coalesce(p_new ->> 'back', c.back)) end;
  e := btrim(coalesce(p_new ->> 'extra', c.extra));
  fig := coalesce(p_new ->> 'figure', c.figure);
  sl := case when p_new ? 'slides' then array(select (jsonb_array_elements_text(p_new -> 'slides'))::int) else c.slides end;
  why := public.study_card_problem(k, f, b, e, fig, sl, c.lecture_id);
  if why is not null then raise exception '%', why; end if;
  if (k, f, b, e, fig, sl) is not distinct from (c.kind, c.front, c.back, c.extra, c.figure, c.slides) then
    raise exception 'no change';
  end if;
  update public.study_cards x
     set kind = k, front = f, back = b, extra = e, figure = fig, slides = sl, updated_by = auth.uid()
   where x.id = p_card
  returning x.version into v;
  insert into public.study_card_edits (card_id, action, version, before, after)
  values (p_card, 'edit', v,
          jsonb_build_object('kind', c.kind, 'front', c.front, 'back', c.back, 'extra', c.extra, 'figure', c.figure, 'slides', to_jsonb(c.slides)),
          jsonb_build_object('kind', k, 'front', f, 'back', b, 'extra', e, 'figure', fig, 'slides', to_jsonb(sl)));
  return v;
end;
$$;

-- Deletes a card for the whole group (p_delete), or restores it. Soft: the
-- row stays, so "ביטול" and the history work, and an Anki export can tell
-- the student. Calling it twice is harmless.
create or replace function public.study_delete_card(p_card uuid, p_delete boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.study_cards;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from public.study_cards x where x.id = p_card for update;
  if not found or not public.study_is_member(c.group_id) then raise exception 'card not found'; end if;
  if p_delete and c.deleted_at is null then
    update public.study_cards x set deleted_at = now(), deleted_by = auth.uid() where x.id = p_card;
    insert into public.study_card_edits (card_id, action, version) values (p_card, 'delete', c.version);
  elsif not p_delete and c.deleted_at is not null then
    update public.study_cards x set deleted_at = null, deleted_by = null where x.id = p_card;
    insert into public.study_card_edits (card_id, action, version) values (p_card, 'restore', c.version);
  end if;
end;
$$;

-- Puts back the text a card had before one edit (the history's "החזרת
-- הגרסה הקודמת", and the toast's "ביטול" right after saving). Returns the
-- new version.
create or replace function public.study_revert_card(p_edit uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  e  public.study_card_edits;
  c  public.study_cards;
  sl int[];
  v  int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into e from public.study_card_edits x where x.id = p_edit;
  if not found then raise exception 'edit not found'; end if;
  select * into c from public.study_cards x where x.id = e.card_id for update;
  if not found or not public.study_is_member(c.group_id) then raise exception 'edit not found'; end if;
  if e.action not in ('edit', 'revert') then raise exception 'nothing to revert'; end if;
  if c.deleted_at is not null then raise exception 'card deleted'; end if;
  sl := array(select (jsonb_array_elements_text(e.before -> 'slides'))::int);
  if (e.before ->> 'kind', e.before ->> 'front', e.before ->> 'back', e.before ->> 'extra', e.before ->> 'figure', sl)
     is not distinct from (c.kind, c.front, c.back, c.extra, c.figure, c.slides) then
    raise exception 'no change';
  end if;
  update public.study_cards x
     set kind = e.before ->> 'kind', front = e.before ->> 'front', back = e.before ->> 'back', extra = e.before ->> 'extra',
         figure = e.before ->> 'figure', slides = sl, updated_by = auth.uid()
   where x.id = c.id
  returning x.version into v;
  insert into public.study_card_edits (card_id, action, version, before, after)
  values (c.id, 'revert', v,
          jsonb_build_object('kind', c.kind, 'front', c.front, 'back', c.back, 'extra', c.extra, 'figure', c.figure, 'slides', to_jsonb(c.slides)),
          e.before);
  return v;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Reviewing (private): record, undo, hide, reset
-- ═══════════════════════════════════════════════════════════════════════

-- Records one answer: the new state the phone computed (FSRS-6,
-- shared/study/fsrs.ts) and a log row, in one transaction.
--   p_review     the review's id, made on the phone: a resend returns 'dup'
--   p_prev_reps  the reps the phone started from: anything else is 'stale'
--                (another device of the same member answered in between)
--   p_next       { state, step, stability, difficulty, due, lapses }
-- Returns 'ok' or 'dup'.
create or replace function public.study_card_review(p_review uuid, p_card uuid, p_rating int, p_reviewed_at timestamptz,
  p_ms int, p_prev_reps int, p_next jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  c         public.study_cards;
  s         public.study_card_states;
  had       boolean;
  v_state   int;
  v_step    int;
  v_s       double precision;
  v_d       double precision;
  v_due     timestamptz;
  v_lapses  int;
  v_lapse   int;
  v_elapsed int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_review is null then raise exception 'bad review'; end if;
  perform pg_advisory_xact_lock(hashtext('study_card_review:' || auth.uid()::text || ':' || coalesce(p_card::text, '')));
  if exists (select 1 from public.study_card_reviews r where r.id = p_review) then
    if exists (select 1 from public.study_card_reviews r where r.id = p_review and r.user_id = auth.uid()) then
      return 'dup';
    end if;
    raise exception 'bad review';
  end if;
  select * into c from public.study_cards x where x.id = p_card;
  if not found or not public.study_is_member(c.group_id) then raise exception 'card not found'; end if;
  if c.deleted_at is not null then raise exception 'card deleted'; end if;
  if p_rating is null or p_rating not between 1 and 4 then raise exception 'bad rating'; end if;
  if p_reviewed_at is null or p_reviewed_at > now() + interval '5 minutes' or p_reviewed_at < now() - interval '30 days' then
    raise exception 'bad time';
  end if;
  select * into s from public.study_card_states x where x.user_id = auth.uid() and x.card_id = p_card for update;
  had := found;
  if coalesce(s.reps, 0) <> coalesce(p_prev_reps, -1) then raise exception 'stale'; end if;
  if had and s.last_review is not null and p_reviewed_at < s.last_review then raise exception 'stale'; end if;
  begin
    v_state := (p_next ->> 'state')::int;
    v_step := coalesce((p_next ->> 'step')::int, 0);
    v_s := (p_next ->> 'stability')::double precision;
    v_d := (p_next ->> 'difficulty')::double precision;
    v_due := (p_next ->> 'due')::timestamptz;
    v_lapses := (p_next ->> 'lapses')::int;
  exception when others then
    raise exception 'bad state';
  end;
  -- A lapse is שוב on a card in review, and nothing else (FSRS's rule).
  v_lapse := (p_rating = 1 and coalesce(s.state, 0) = 2)::int;
  if v_state is null or v_state not between 1 and 3 or v_step not between 0 and 9
     or v_s is null or v_s not between 0.001 and 36500 or v_d is null or v_d not between 1 and 10
     or v_due is null or v_due < p_reviewed_at or v_due > p_reviewed_at + interval '36501 days'
     or v_lapses is null or v_lapses <> coalesce(s.lapses, 0) + v_lapse
  then
    raise exception 'bad state';
  end if;
  v_elapsed := case when had and s.state > 0 and s.last_review is not null
                    then greatest(0, public.study_day(p_reviewed_at) - public.study_day(s.last_review)) else 0 end;
  insert into public.study_card_states as t (user_id, card_id, state, step, stability, difficulty, due, last_review, reps, lapses, suspended, updated_at)
  values (auth.uid(), p_card, v_state, v_step, v_s, v_d, v_due, p_reviewed_at, p_prev_reps + 1, v_lapses, coalesce(s.suspended, false), now())
  on conflict (user_id, card_id) do update
    set state = excluded.state, step = excluded.step, stability = excluded.stability, difficulty = excluded.difficulty,
        due = excluded.due, last_review = excluded.last_review, reps = excluded.reps, lapses = excluded.lapses, updated_at = now();
  insert into public.study_card_reviews (id, user_id, card_id, rating, reviewed_at, ms, elapsed_days, state_before, state_after,
                                         stability, difficulty, due, prev)
  values (p_review, auth.uid(), p_card, p_rating, p_reviewed_at, case when p_ms between 0 and 3600000 then p_ms end, v_elapsed,
          coalesce(s.state, 0), v_state, v_s, v_d, v_due,
          case when had then to_jsonb(s) - 'user_id' - 'card_id' - 'updated_at' else '{}'::jsonb end);
  -- Undo copies are kept for a day (a session's chain of answers); older
  -- ones of this card go, so the log stays small.
  update public.study_card_reviews x set prev = null
   where x.user_id = auth.uid() and x.card_id = p_card and x.prev is not null and x.reviewed_at < p_reviewed_at - interval '1 day';
  return 'ok';
end;
$$;

-- Takes back the caller's latest answer to a card ("ביטול התשובה"): the
-- state goes back to what it was, and the log row goes.
create or replace function public.study_card_undo(p_review uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.study_card_reviews;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from public.study_card_reviews x where x.id = p_review and x.user_id = auth.uid();
  if not found then raise exception 'review not found'; end if;
  perform pg_advisory_xact_lock(hashtext('study_card_review:' || auth.uid()::text || ':' || r.card_id::text));
  if exists (select 1 from public.study_card_reviews x
              where x.user_id = auth.uid() and x.card_id = r.card_id and x.id <> r.id
                and (x.reviewed_at, x.created_at) > (r.reviewed_at, r.created_at)) then
    raise exception 'not the latest';
  end if;
  if r.prev is null then raise exception 'too old'; end if;
  if r.prev = '{}'::jsonb then
    delete from public.study_card_states s where s.user_id = auth.uid() and s.card_id = r.card_id;
  else
    update public.study_card_states s
       set state = (r.prev ->> 'state')::smallint, step = (r.prev ->> 'step')::smallint,
           stability = (r.prev ->> 'stability')::double precision, difficulty = (r.prev ->> 'difficulty')::double precision,
           due = (r.prev ->> 'due')::timestamptz, last_review = (r.prev ->> 'last_review')::timestamptz,
           reps = (r.prev ->> 'reps')::int, lapses = (r.prev ->> 'lapses')::int, updated_at = now()
     where s.user_id = auth.uid() and s.card_id = r.card_id;
  end if;
  delete from public.study_card_reviews x where x.id = r.id;
end;
$$;

-- Hides a card from the caller's reviews only ("להסתיר ממני"), or shows it again.
create or replace function public.study_card_hide(p_card uuid, p_hide boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_card_group(p_card)), false) then raise exception 'card not found'; end if;
  insert into public.study_card_states (user_id, card_id, suspended) values (auth.uid(), p_card, coalesce(p_hide, false))
  on conflict (user_id, card_id) do update set suspended = excluded.suspended, updated_at = now();
end;
$$;

-- Starts a lecture's cards over for the caller ("להתחיל מחדש"): their states
-- go (the log stays, for the progress page). Returns how many were reset.
create or replace function public.study_card_reset(p_lecture uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then raise exception 'lecture not found'; end if;
  delete from public.study_card_states s using public.study_cards c
   where c.id = s.card_id and c.lecture_id = p_lecture and s.user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  The caller's own numbers (security invoker: RLS keeps them to the
--  caller; the explicit user filters are for the indexes). The library's
--  due chips, the "today" screen, and the contract with item 7.
-- ═══════════════════════════════════════════════════════════════════════

-- Per lecture: active cards, new ones not hidden, (re)learning due within the
-- 20-minute learn-ahead, reviews due before today's study day ends, studied,
-- hidden, and the next due time.
create or replace function public.study_my_card_counts(p_group uuid, p_now timestamptz default now())
returns table (lecture_id uuid, cards int, new_cards int, learning_due int, review_due int, studied int, hidden int, next_due timestamptz)
language sql stable set search_path = public as $$
  select c.lecture_id,
         count(*)::int,
         (count(*) filter (where s.card_id is null or (s.state = 0 and not s.suspended)))::int,
         (count(*) filter (where s.state in (1, 3) and not s.suspended and s.due <= p_now + interval '20 minutes'))::int,
         (count(*) filter (where s.state = 2 and not s.suspended and s.due < public.study_day_end(p_now)))::int,
         (count(*) filter (where s.state > 0))::int,
         (count(*) filter (where s.suspended))::int,
         min(s.due) filter (where s.state > 0 and not s.suspended)
  from public.study_cards c
  left join public.study_card_states s on s.card_id = c.id and s.user_id = auth.uid()
  where c.group_id = p_group and c.deleted_at is null
  group by c.lecture_id;
$$;

-- Per study day: answers, cards seen for the first time (today's new-card
-- limit counts these), שוב presses, and seconds spent.
create or replace function public.study_my_card_days(p_group uuid, p_days int default 30)
returns table (day date, reviews int, first_seen int, again int, seconds int)
language sql stable set search_path = public as $$
  select date '1970-01-01' + public.study_day(r.reviewed_at), count(*)::int,
         (count(*) filter (where r.state_before = 0))::int, (count(*) filter (where r.rating = 1))::int,
         (coalesce(sum(r.ms), 0) / 1000)::int
  from public.study_card_reviews r
  join public.study_cards c on c.id = r.card_id
  where r.user_id = auth.uid() and c.group_id = p_group
    and r.reviewed_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)))
  group by 1
  order by 1;
$$;

-- Weak points (item 7): per lecture × topic × aspect, how many cards, how
-- many studied, lapses, שוב in the last 30 days, and the mean chance of
-- recall now (FSRS-6 curve) over the studied ones.
create or replace function public.study_my_card_topics(p_group uuid, p_now timestamptz default now())
returns table (lecture_id uuid, course text, topic text, aspect text, cards int, studied int, lapses int, again_30d int, recall numeric)
language sql stable set search_path = public as $$
  with st as (
    select s.* from public.study_card_states s where s.user_id = auth.uid() and s.state > 0
  ), ag as (
    select r.card_id, count(*) as n from public.study_card_reviews r
    where r.user_id = auth.uid() and r.rating = 1 and r.reviewed_at > p_now - interval '30 days'
    group by r.card_id
  )
  select c.lecture_id, l.course, c.topic, c.aspect, count(*)::int, count(st.card_id)::int,
         coalesce(sum(st.lapses), 0)::int, coalesce(sum(ag.n), 0)::int,
         round(avg(public.study_card_recall(st.stability, public.study_day(p_now) - public.study_day(st.last_review)))::numeric, 3)
  from public.study_cards c
  join public.study_lectures l on l.id = c.lecture_id
  left join st on st.card_id = c.id
  left join ag on ag.card_id = c.id
  where c.group_id = p_group and c.deleted_at is null
  group by c.lecture_id, l.course, c.topic, c.aspect;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_card_batches  enable row level security;
alter table public.study_cards         enable row level security;
alter table public.study_card_edits    enable row level security;
alter table public.study_card_states   enable row level security;
alter table public.study_card_reviews  enable row level security;
alter table public.study_card_settings enable row level security;

-- (In study-schema.sql the file's loop has already dropped these; the drops
-- keep this section re-runnable on its own.)
drop policy if exists "study card batches read"     on public.study_card_batches;
drop policy if exists "study cards read"            on public.study_cards;
drop policy if exists "study card edits read"       on public.study_card_edits;
drop policy if exists "study card states own"       on public.study_card_states;
drop policy if exists "study card reviews own"      on public.study_card_reviews;
drop policy if exists "study card settings own"     on public.study_card_settings;
drop policy if exists "study card settings add"     on public.study_card_settings;
drop policy if exists "study card settings change"  on public.study_card_settings;

create policy "study card batches read" on public.study_card_batches
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study cards read" on public.study_cards
  for select using (public.study_is_member(group_id));
create policy "study card edits read" on public.study_card_edits
  for select using (public.study_is_member(public.study_card_group(card_id)));
create policy "study card states own" on public.study_card_states
  for select using (user_id = auth.uid());
create policy "study card reviews own" on public.study_card_reviews
  for select using (user_id = auth.uid());
create policy "study card settings own" on public.study_card_settings
  for select using (user_id = auth.uid());
create policy "study card settings add" on public.study_card_settings
  for insert with check (user_id = auth.uid());
create policy "study card settings change" on public.study_card_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shared tables: read only; every write is a function. Private tables: the
-- owner reads; states and reviews change only through the functions; the
-- settings row is the owner's to write (user_id always takes its default).
revoke all on public.study_card_batches, public.study_cards, public.study_card_edits, public.study_card_states,
  public.study_card_reviews, public.study_card_settings from anon, authenticated;
grant select on public.study_card_batches, public.study_cards, public.study_card_edits to authenticated;
grant select on public.study_card_states, public.study_card_reviews to authenticated;
grant select on public.study_card_settings to authenticated;
grant insert (new_per_day, retention) on public.study_card_settings to authenticated;
grant update (new_per_day, retention, updated_at) on public.study_card_settings to authenticated;

revoke all on function public.study_card_problem(text, text, text, text, text, int[], uuid),
  public.study_card_touch() from public, anon, authenticated;
revoke all on function public.study_card_group(uuid), public.study_day(timestamptz), public.study_day_end(timestamptz),
  public.study_card_recall(double precision, int),
  public.study_card_round(uuid), public.study_card_claim(uuid, text), public.study_save_card(uuid, jsonb, text),
  public.study_card_finish(uuid, text, int, text, numeric, text, text), public.study_add_card(uuid, jsonb),
  public.study_edit_card(uuid, int, jsonb), public.study_delete_card(uuid, boolean), public.study_revert_card(uuid),
  public.study_card_review(uuid, uuid, int, timestamptz, int, int, jsonb), public.study_card_undo(uuid),
  public.study_card_hide(uuid, boolean), public.study_card_reset(uuid),
  public.study_my_card_counts(uuid, timestamptz), public.study_my_card_days(uuid, int), public.study_my_card_topics(uuid, timestamptz)
  from public, anon;
grant execute on function public.study_card_group(uuid), public.study_day(timestamptz), public.study_day_end(timestamptz),
  public.study_card_recall(double precision, int),
  public.study_card_round(uuid), public.study_card_claim(uuid, text), public.study_save_card(uuid, jsonb, text),
  public.study_card_finish(uuid, text, int, text, numeric, text, text), public.study_add_card(uuid, jsonb),
  public.study_edit_card(uuid, int, jsonb), public.study_delete_card(uuid, boolean), public.study_revert_card(uuid),
  public.study_card_review(uuid, uuid, int, timestamptz, int, int, jsonb), public.study_card_undo(uuid),
  public.study_card_hide(uuid, boolean), public.study_card_reset(uuid),
  public.study_my_card_counts(uuid, timestamptz), public.study_my_card_days(uuid, int), public.study_my_card_topics(uuid, timestamptz)
  to authenticated;

-- ── Realtime: cards appear on every phone as they are written; fixes,
--  deletions and history show live. Never anyone's states, log or settings.
do $$
declare t text;
begin
  foreach t in array array['study_card_batches', 'study_cards', 'study_card_edits'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

insert into study_private.schema_sections (section, version) values ('C', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


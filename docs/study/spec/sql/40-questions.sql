-- ════════════════════════════════════════════════════════════════════════
--  SECTION Q · PRACTICE QUESTIONS AND PAST EXAMS   (owned by package Q)
--  design-questions.md §2.2, with design-quiz.md §2.3 merged in: an open
--  live-quiz round holds its question's key (study_question_keys.held_until),
--  and the five functions that hand out or change a key refuse it meanwhile.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  practice questions (תרגול) and past
--  exams for תמצית. To be appended to supabase/study-schema.sql, after the
--  "Row Level Security" section (whose loop drops every study_ policy, so
--  the policies below are recreated on every run). Re-runnable.
--
--  Who sees what
--  ─────────────
--  Shared inside the group: the questions (stem, vignette, options, slide
--  numbers, topic), who generated them, the generation rounds, flags on bad
--  questions, and uploaded past exams.
--  Private to each member: their answers. Scores, mistakes and weak points
--  are computed from study_answers, which only its owner can read
--  (Shoham: "יראו רק למשתמש הנוכחי").
--  Hidden from every client: the answer key and the explanations
--  (study_question_keys has RLS on and no grants at all). They come back only
--  from study_answer_question (right after an answer, which it records) and
--  study_question_feedback (for questions the caller has already answered).
--  The live group quiz reveals them through its own definer function when a
--  round closes, so nobody can read the quiz ahead.
--
--  Writes go through security-definer functions (generation rounds, saving a
--  question, answering, retiring), so the state machine and the private
--  answer rows cannot be bent from the browser. What only Claude may write
--  (claiming a batch, saving a question with its key, finishing a batch,
--  explanations of exam items) also needs the server key that only the
--  /api/study functions hold; they pass it together with the member's own
--  token (review B1).
-- ═══════════════════════════════════════════════════════════════════════

-- ── Past exams (item 8). pages: one object per page, as read in the browser:
--   { n, path, w, h, lines[] }  (path = "<group>/exams/<exam id>/p<n>.jpg")
create table if not exists public.study_exams (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  course      text        not null default '' check (char_length(course) <= 120),
  title       text        not null check (char_length(title) between 1 and 200),
  year        int         check (year between 1990 and 2100),
  source_name text        not null default '' check (char_length(source_name) <= 300),
  pages       jsonb       not null default '[]'::jsonb,
  -- where the answers are: marked in the exam, in a separate key (uploaded
  -- as extra pages), none, or not said yet
  key_source  text        not null default 'unknown' check (key_source in ('marked', 'separate', 'none', 'unknown')),
  status      text        not null default 'new' check (status in ('new', 'reading', 'ready', 'failed')),
  error       text,
  created_by  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists study_exams_group on public.study_exams (group_id, course);
-- At most 60 pages an exam (review M6: exam_read pays per page); the app says "too many pages" first.
alter table public.study_exams drop constraint if exists study_exams_pages_max;
alter table public.study_exams add constraint study_exams_pages_max check (jsonb_array_length(pages) <= 60);

-- ── Generation rounds: one row per lecture part per round. A round is
--  planned by study_question_round(); each row is claimed by one
--  /api/study/questions call (study_question_claim), so two phones never
--  write the same part twice, and its progress is visible to the group.
create table if not exists public.study_question_batches (
  id         uuid          primary key default gen_random_uuid(),
  lecture_id uuid          not null references public.study_lectures (id) on delete cascade,
  round      int           not null check (round between 1 and 50),
  part_idx   int           not null check (part_idx >= 0),
  heading    text          not null default '' check (char_length(heading) <= 200),
  slide_from int           not null,
  slide_to   int           not null,
  wanted     int           not null check (wanted between 1 and 5),
  status     text          not null default 'pending' check (status in ('pending', 'writing', 'ready', 'failed')),
  made       int           not null default 0 check (made >= 0),
  rejected   int           not null default 0 check (rejected >= 0),
  model      text,
  cost_usd   numeric(10,4) not null default 0 check (cost_usd >= 0),
  error      text,
  created_by uuid          default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now(),
  unique (lecture_id, round, part_idx),
  check (slide_to >= slide_from)
);
-- Paid tries of a batch: at most 3 (review M6), as the summary's units have 4.
alter table public.study_question_batches add column if not exists attempts int not null default 0;

-- ── The questions (public part). options are stored in display order
--  (shuffled on the server); which one is right lives in study_question_keys.
--  aspect: a fixed list, so weak points add up across lectures.
create table if not exists public.study_questions (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        references public.study_lectures (id) on delete cascade,
  batch_id    uuid        references public.study_question_batches (id) on delete set null,
  exam_id     uuid        references public.study_exams (id) on delete cascade,
  exam_no     int         check (exam_no between 1 and 500),
  -- a past-exam item: the lecture whose slides explain it (none: no lecture
  -- covers it yet). Its own column, so deleting that lecture unlinks the
  -- item instead of deleting it.
  ref_lecture uuid        references public.study_lectures (id) on delete set null,
  source      text        not null default 'ai' check (source in ('ai', 'exam')),
  part_idx    int         check (part_idx >= 0),
  kind        text        not null check (kind in ('mcq', 'case')),
  difficulty  smallint    not null default 2 check (difficulty between 1 and 3),
  vignette    text        not null default '' check (char_length(vignette) <= 2500),
  question    text        not null check (char_length(btrim(question)) between 5 and 600),
  options     text[]      not null check (cardinality(options) between 2 and 6),
  slides      int[]       not null default '{}',
  topic       text        not null default '' check (char_length(topic) <= 120),
  aspect      text        not null default 'other' check (aspect in (
                'mechanism', 'uses', 'pk', 'adverse', 'contra', 'interactions', 'resistance', 'dosing',
                'classification', 'epidemiology', 'lifecycle', 'pathogenesis', 'clinical', 'diagnosis',
                'treatment', 'prevention', 'other')),
  has_key     boolean     not null default true,
  model       text,
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  retired_by  uuid        references auth.users (id) on delete set null,
  retire_note text        not null default '' check (char_length(retire_note) <= 300),
  check (source = 'exam' or lecture_id is not null),
  check (source = 'ai' or (exam_id is not null and lecture_id is null)),
  check (source = 'exam' or ref_lecture is null)
);
create index if not exists study_questions_lecture on public.study_questions (lecture_id, created_at);
create index if not exists study_questions_group on public.study_questions (group_id, created_at);
create index if not exists study_questions_exam on public.study_questions (exam_id, exam_no);
create index if not exists study_questions_ref on public.study_questions (ref_lecture) where ref_lecture is not null;

-- ── The key: hidden. No policy and no grant: only the functions below read it.
create table if not exists public.study_question_keys (
  question_id  uuid        primary key references public.study_questions (id) on delete cascade,
  answer       smallint    check (answer >= 0),          -- null: a past-exam item nobody has keyed yet
  explanations text[]      not null default '{}',        -- one per option, in display order (or none yet)
  takeaway     text        not null default '' check (char_length(takeaway) <= 600),
  key_by       uuid        references auth.users (id) on delete set null,  -- a member who keyed an exam item
  key_at       timestamptz,
  held_until   timestamptz                                  -- an open live-quiz round holds the key (design-quiz §2.3)
);
alter table public.study_question_keys add column if not exists held_until timestamptz;  -- databases from before the hold

-- ── Answers: private to their owner. Own id as the primary key (the table is
--  not in the Realtime publication anyway; nothing here should ever be broadcast).
create table if not exists public.study_answers (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid        not null references public.study_questions (id) on delete cascade,
  choice      smallint    check (choice >= 0),           -- null: "לא יודעים"
  correct     boolean     not null,
  mode        text        not null default 'lecture' check (mode in ('lecture', 'course', 'mistakes', 'quiz', 'exam')),
  ms          int         check (ms between 0 and 3600000),
  answered_at timestamptz not null default now()
);
create index if not exists study_answers_mine on public.study_answers (user_id, question_id, answered_at desc);

-- ── Flags: "this question is wrong / not from the slides / unclear", for the group.
create table if not exists public.study_question_flags (
  id          uuid        primary key default gen_random_uuid(),
  question_id uuid        not null references public.study_questions (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  reason      text        not null check (reason in ('wrong_key', 'not_in_slides', 'two_answers', 'unclear', 'duplicate', 'other')),
  note        text        not null default '' check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  unique (question_id, user_id)
);
create index if not exists study_question_flags_q on public.study_question_flags (question_id);

-- ── Helpers ──
create or replace function public.study_question_group(q uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_questions where id = q;
$$;

create or replace function public.study_exam_group(e uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_exams where id = e;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Generation: plan a round, claim a part, save each question, finish
-- ═══════════════════════════════════════════════════════════════════════

-- Plans the next round for a lecture: about one question per 2.5 slides
-- (6 to 25 a round), shared out over the summary's parts by slide count
-- (largest remainder, at most 5 per part). Before the lecture has an
-- outline, parts are six-slide chunks. If the latest round still has parts
-- pending or being written, that round is returned instead (fresh = false),
-- so two members tapping at once drive the same round.
create or replace function public.study_question_round(p_lecture uuid)
returns table (round int, batches int, fresh boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  g uuid := public.study_lecture_group(p_lecture);
  r int;
  open_n int;
  made_n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('study_question_round:' || p_lecture::text));
  -- A batch whose 3 tries all died stops holding its round open.
  update public.study_question_batches b set status = 'failed', error = 'gave up', updated_at = now()
   where b.lecture_id = p_lecture and b.status = 'writing' and b.attempts >= 3 and b.updated_at < now() - interval '6 minutes';
  select max(b.round) into r from public.study_question_batches b where b.lecture_id = p_lecture;
  if r is not null then
    select count(*) into open_n from public.study_question_batches b
     where b.lecture_id = p_lecture and b.round = r and b.status in ('pending', 'writing');
    if open_n > 0 then
      return query select r, open_n, false;
      return;
    end if;
  end if;
  -- 80 active, and 120 ever generated: retiring questions does not free paid rounds (review M6).
  if (select count(*) from public.study_questions q where q.lecture_id = p_lecture and q.retired_at is null) >= 80
     or (select count(*) from public.study_questions q where q.lecture_id = p_lecture and q.source = 'ai') >= 120 then
    raise exception 'enough questions';
  end if;
  r := coalesce(r, 0) + 1;
  with parts as (
    select s.idx as part_idx, s.title as heading, s.slide_from, s.slide_to
    from public.study_sections s
    where s.lecture_id = p_lecture
    union all
    select ((x.o - 1) / 6)::int, '', min(x.n), max(x.n)
    from (select (sl ->> 'n')::int as n, row_number() over (order by (sl ->> 'n')::int) as o
          from public.study_lectures l, jsonb_array_elements(l.slides) sl
          where l.id = p_lecture) x
    where not exists (select 1 from public.study_sections s2 where s2.lecture_id = p_lecture)
    group by (x.o - 1) / 6
  ),
  sized as (select p.*, (p.slide_to - p.slide_from + 1)::numeric as n from parts p),
  tgt as (select least(25, greatest(6, round(sum(n) / 2.5)))::int as t, sum(n) as total from sized),
  base as (
    select s.*, floor(t.t * s.n / t.total)::int as fl, (t.t * s.n / t.total) - floor(t.t * s.n / t.total) as rem
    from sized s, tgt t
  ),
  ranked as (
    select b.*, row_number() over (order by b.rem desc, b.part_idx) as rk,
           (select t from tgt) - (select sum(fl) from base) as extra
    from base b
  )
  insert into public.study_question_batches (lecture_id, round, part_idx, heading, slide_from, slide_to, wanted)
  select p_lecture, r, k.part_idx, left(k.heading, 200), k.slide_from, k.slide_to,
         least(5, k.fl + case when k.rk <= k.extra then 1 else 0 end)
  from ranked k
  where least(5, k.fl + case when k.rk <= k.extra then 1 else 0 end) > 0;
  get diagnostics made_n = row_count;
  if made_n = 0 then raise exception 'no slides'; end if;
  return query select r, made_n, true;
end;
$$;

-- Takes one part to write. A part is free when pending, failed (a tap on
-- "המשך"), or "writing" with no sign of life for six minutes (a phone that
-- slept). Raises 'busy' otherwise. A part whose last try timed out is
-- written at medium effort, which finishes sooner.
create or replace function public.study_question_claim(p_batch uuid, p_key text default null)
returns table (lecture_id uuid, round int, part_idx int, heading text, slide_from int, slide_to int, wanted int, effort text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare b public.study_question_batches;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.study_question_batches x where x.id = p_batch;
  if not found or not public.study_is_member(public.study_lecture_group(b.lecture_id))
     or exists (select 1 from public.study_lectures l where l.id = b.lecture_id and l.deleted_at is not null) then
    raise exception 'batch not found';
  end if;
  update public.study_question_batches x
     set status = 'writing', attempts = x.attempts + 1, updated_at = now()
   where x.id = p_batch and x.attempts < 3
     and (x.status in ('pending', 'failed') or (x.status = 'writing' and x.updated_at < now() - interval '6 minutes'));
  if not found then
    if b.attempts >= 3 and b.status <> 'ready' then raise exception 'gave up'; end if;
    raise exception 'busy';
  end if;
  return query select b.lecture_id, b.round, b.part_idx, b.heading, b.slide_from, b.slide_to, b.wanted - b.made,
                      case when b.error = 'timeout' then 'medium' else 'high' end;
end;
$$;

-- Saves one question with its key. Exactly one of p_batch (generated) and
-- p_exam (a past-exam item) is given. p_q:
--   { kind, difficulty, vignette, question, options[], answer, explanations[],
--     takeaway, slides[], topic, aspect, model, exam_no }
-- The API has already validated the item (one correct option, explanations,
-- style); these checks are the ones the database must not trust anyone on.
create or replace function public.study_save_question(p_batch uuid, p_exam uuid, p_q jsonb, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  b    public.study_question_batches;
  e    public.study_exams;
  g    uuid;
  lec  uuid;
  part int;
  src  text;
  opts text[] := array(select jsonb_array_elements_text(coalesce(p_q -> 'options', '[]'::jsonb)));
  expl text[] := array(select jsonb_array_elements_text(coalesce(p_q -> 'explanations', '[]'::jsonb)));
  sl   int[]  := array(select (jsonb_array_elements_text(coalesce(p_q -> 'slides', '[]'::jsonb)))::int);
  ans  int    := (p_q ->> 'answer')::int;
  have int[];
  qid  uuid;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- only the server saves Claude's items (review B1)
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if (p_batch is null) = (p_exam is null) then raise exception 'batch or exam'; end if;
  if p_exam is not null and not study_private.feature_on('exams') then raise exception 'off'; end if;   -- review M10
  if cardinality(opts) not between 2 and 6 then raise exception 'bad options'; end if;
  if ans is not null and (ans < 0 or ans >= cardinality(opts)) then raise exception 'bad answer'; end if;
  if p_batch is not null then
    select * into b from public.study_question_batches x where x.id = p_batch;
    if not found then raise exception 'batch not found'; end if;
    lec := b.lecture_id;
    g := public.study_lecture_group(lec);
    if not public.study_is_member(g) then raise exception 'batch not found'; end if;
    if b.status <> 'writing' then raise exception 'batch not writing'; end if;
    if b.made >= b.wanted then raise exception 'part full'; end if;
    src := 'ai';
    part := b.part_idx;
    if ans is null then raise exception 'bad answer'; end if;
    if cardinality(expl) <> cardinality(opts) then raise exception 'explanations do not match options'; end if;
    select coalesce(array_agg((sl2 ->> 'n')::int), '{}') into have
      from public.study_lectures l, jsonb_array_elements(l.slides) sl2 where l.id = lec;
    if cardinality(sl) = 0 or not (sl <@ have) then raise exception 'unknown slide'; end if;
    if not exists (select 1 from unnest(sl) s where s between b.slide_from and b.slide_to) then
      raise exception 'outside the part';
    end if;
    if (select count(*) from public.study_questions q where q.lecture_id = lec and q.retired_at is null) >= 80 then
      raise exception 'enough questions';
    end if;
  else
    select * into e from public.study_exams x where x.id = p_exam;
    if not found or not public.study_is_member(e.group_id) then raise exception 'exam not found'; end if;
    g := e.group_id;
    src := 'exam';
    if cardinality(expl) not in (0, cardinality(opts)) then raise exception 'explanations do not match options'; end if;
  end if;
  insert into public.study_questions (group_id, lecture_id, batch_id, exam_id, exam_no, source, part_idx, kind,
                                      difficulty, vignette, question, options, slides, topic, aspect, has_key, model)
  values (g, lec, p_batch, p_exam, (p_q ->> 'exam_no')::int, src, part, p_q ->> 'kind',
          coalesce((p_q ->> 'difficulty')::int, 2), coalesce(p_q ->> 'vignette', ''), p_q ->> 'question', opts, sl,
          left(coalesce(p_q ->> 'topic', ''), 120), coalesce(p_q ->> 'aspect', 'other'), ans is not null, p_q ->> 'model')
  returning id into qid;
  insert into public.study_question_keys (question_id, answer, explanations, takeaway)
  values (qid, ans, expl, left(coalesce(p_q ->> 'takeaway', ''), 600));
  if p_batch is not null then
    update public.study_question_batches x set made = x.made + 1, updated_at = now() where x.id = p_batch;
  end if;
  return qid;
end;
$$;

-- Ends a claimed part: ready (even with fewer questions than wanted) or failed.
create or replace function public.study_question_finish(p_batch uuid, p_status text, p_rejected int,
  p_model text, p_cost numeric, p_error text, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_status not in ('ready', 'failed') then raise exception 'bad status'; end if;
  update public.study_question_batches x
     set status = p_status,
         rejected = x.rejected + greatest(0, coalesce(p_rejected, 0)),
         model = coalesce(p_model, x.model),
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
--  Practising: answer (recorded privately, key revealed), review, retire
-- ═══════════════════════════════════════════════════════════════════════

-- Records the caller's answer and returns the key with every option's
-- explanation. p_choice null = "לא יודעים" (counts as a mistake).
create or replace function public.study_answer_question(p_question uuid, p_choice int, p_mode text default 'lecture', p_ms int default null)
returns table (answer int, explanations text[], takeaway text, correct boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  q  public.study_questions;
  k  public.study_question_keys;
  ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into q from public.study_questions x where x.id = p_question;
  if not found or not public.study_is_member(q.group_id) then raise exception 'question not found'; end if;
  if q.retired_at is not null then raise exception 'retired'; end if;
  select * into k from public.study_question_keys x where x.question_id = p_question;
  if k.held_until > now() then raise exception 'in quiz'; end if;                 -- quiz: added
  if k.answer is null then raise exception 'no key'; end if;
  if p_choice is not null and (p_choice < 0 or p_choice >= cardinality(q.options)) then raise exception 'bad choice'; end if;
  if coalesce(p_mode, '') not in ('lecture', 'course', 'mistakes', 'quiz', 'exam') then raise exception 'bad mode'; end if;
  ok := coalesce(p_choice = k.answer, false);
  insert into public.study_answers (user_id, question_id, choice, correct, mode, ms)
  values (auth.uid(), p_question, p_choice, ok, p_mode, case when p_ms between 0 and 3600000 then p_ms end);
  return query select k.answer::int, k.explanations, k.takeaway, ok;
end;
$$;

-- The key and explanations of questions the caller has already answered
-- (reviewing a finished session, or the mistakes list). Others: no row.
create or replace function public.study_question_feedback(p_ids uuid[])
returns table (question_id uuid, answer int, explanations text[], takeaway text)
language sql stable security definer set search_path = public as $$
  select k.question_id, k.answer::int, k.explanations, k.takeaway
  from public.study_question_keys k
  join public.study_questions q on q.id = k.question_id
  where k.question_id = any (p_ids)
    and public.study_is_member(q.group_id)
    and (k.held_until is null or k.held_until <= now())                          -- quiz: added
    and exists (select 1 from public.study_answers a where a.question_id = k.question_id and a.user_id = auth.uid());
$$;

-- Takes a question out of practice for the whole group, or puts it back
-- (undo). Any member may do either; the row says who and when.
create or replace function public.study_retire_question(p_question uuid, p_retire boolean, p_note text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_questions q
     set retired_at = case when p_retire then now() end,
         retired_by = case when p_retire then auth.uid() end,
         retire_note = case when p_retire then left(coalesce(p_note, ''), 300) else '' end
   where q.id = p_question and public.study_is_member(q.group_id);
  if not found then raise exception 'question not found'; end if;
end;
$$;

-- Past exams: a member marks (or clears) the right answer of an item that
-- came without one. Explanations depend on the key, so they are cleared and
-- written again by /api/study/explain.
create or replace function public.study_set_exam_key(p_question uuid, p_answer int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare q public.study_questions;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into q from public.study_questions x where x.id = p_question;
  if not found or not public.study_is_member(q.group_id) or q.source <> 'exam' then raise exception 'question not found'; end if;
  if p_answer is not null and (p_answer < 0 or p_answer >= cardinality(q.options)) then raise exception 'bad answer'; end if;
  if exists (select 1 from public.study_question_keys k                         -- quiz: added
              where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';
  end if;
  update public.study_question_keys k
     set answer = p_answer, key_by = auth.uid(), key_at = now(), explanations = '{}', takeaway = ''
   where k.question_id = p_question;
  update public.study_questions x set has_key = p_answer is not null where x.id = p_question;
end;
$$;

-- Past exams: explanations written from a lecture's slides (/api/study/explain).
-- p_lecture links the item to the lecture that covers it (or null: none does).
create or replace function public.study_set_explanations(p_question uuid, p_explanations text[], p_takeaway text,
  p_slides int[], p_lecture uuid, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare q public.study_questions;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- written by op exam_explain only
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into q from public.study_questions x where x.id = p_question;
  if not found or not public.study_is_member(q.group_id) or q.source <> 'exam' then raise exception 'question not found'; end if;
  if cardinality(coalesce(p_explanations, '{}')) <> cardinality(q.options) then raise exception 'explanations do not match options'; end if;
  if p_lecture is not null and public.study_lecture_group(p_lecture) is distinct from q.group_id then raise exception 'lecture not found'; end if;
  if exists (select 1 from public.study_question_keys k                         -- quiz: added
              where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';
  end if;
  update public.study_question_keys k
     set explanations = p_explanations, takeaway = left(coalesce(p_takeaway, ''), 600)
   where k.question_id = p_question and k.answer is not null;
  if not found then raise exception 'no key'; end if;
  update public.study_questions x set ref_lecture = p_lecture, slides = coalesce(p_slides, '{}') where x.id = p_question;
end;
$$;

-- Past exams: what /api/study/ai (op exam_explain) needs to explain keyed
-- items. Only past-exam items come out here (their key is in the exam, known
-- to whoever read or keyed it); a generated question's key never does.
create or replace function public.study_exam_items_for_explain(p_ids uuid[])
returns table (id uuid, exam_no int, vignette text, question text, options text[], answer int)
language sql stable security definer set search_path = public as $$
  select q.id, q.exam_no, q.vignette, q.question, q.options, k.answer::int
  from public.study_questions q
  join public.study_question_keys k on k.question_id = q.id
  where q.id = any (p_ids) and q.source = 'exam' and k.answer is not null
    and (k.held_until is null or k.held_until <= now())                          -- quiz: added
    and public.study_is_member(q.group_id);
$$;

-- ── The caller's own results (security invoker: RLS on study_answers keeps
--  them to the owner; the explicit user filter is for the index). These are
--  the contract with progress and weak points (item 7).
-- A question is one of "הטעויות שלי" from a wrong answer ("לא יודעים" too)
-- until it is answered right on a LATER study day than its last wrong answer
-- (a study day starts at 04:00, Israel time, as study_day() and studyDay()).
-- A right answer minutes after reading the explanations does not clear it:
-- that is memory of the screen, not of the fact (review UX-2).
create or replace function public.study_open_mistakes(p_group uuid)
returns table (question_id uuid, wrong_at timestamptz)
language sql stable set search_path = public as $$
  with mine as (
    select a.question_id, a.correct, a.answered_at,
           ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date as day
      from public.study_answers a
     where a.user_id = auth.uid()
  ), wrong as (
    select m.question_id, max(m.answered_at) as wrong_at, max(m.day) as wrong_day
      from mine m where not m.correct group by m.question_id
  )
  select w.question_id, w.wrong_at
    from wrong w
    join public.study_questions q on q.id = w.question_id
   where q.group_id = p_group and q.retired_at is null
     and not exists (select 1 from mine r where r.question_id = w.question_id and r.correct and r.day > w.wrong_day);
$$;

create or replace function public.study_my_mistakes(p_group uuid, p_lecture uuid default null)
returns table (question_id uuid, wrong_at timestamptz)
language sql stable set search_path = public as $$
  select o.question_id, o.wrong_at
  from public.study_open_mistakes(p_group) o
  join public.study_questions q on q.id = o.question_id
  where p_lecture is null or coalesce(q.lecture_id, q.ref_lecture) = p_lecture
  order by o.wrong_at;
$$;

create or replace function public.study_my_topic_stats(p_group uuid)
returns table (lecture_id uuid, course text, topic text, aspect text, questions int, answered int, correct_now int, last_at timestamptz)
language sql stable set search_path = public as $$
  with latest as (
    select distinct on (a.question_id) a.question_id, a.correct, a.answered_at
    from public.study_answers a
    where a.user_id = auth.uid()
    order by a.question_id, a.answered_at desc
  )
  select coalesce(q.lecture_id, q.ref_lecture), coalesce(lec.course, ex.course, ''), q.topic, q.aspect,
         count(*)::int, count(lt.question_id)::int, (count(*) filter (where lt.correct))::int, max(lt.answered_at)
  from public.study_questions q
  left join latest lt on lt.question_id = q.id
  left join public.study_lectures lec on lec.id = coalesce(q.lecture_id, q.ref_lecture)
  left join public.study_exams ex on ex.id = q.exam_id
  where q.group_id = p_group and q.retired_at is null and q.has_key
  group by coalesce(q.lecture_id, q.ref_lecture), coalesce(lec.course, ex.course, ''), q.topic, q.aspect;
$$;

-- The practice hub in one call: per lecture (or past exam), how many active
-- questions the group has, and how many of them the caller has answered and
-- has wrong right now. Shared counts plus the caller's own numbers only.
create or replace function public.study_practice_overview(p_group uuid)
returns table (lecture_id uuid, exam_id uuid, questions int, answered int, wrong_now int, last_at timestamptz)
language sql stable set search_path = public as $$
  with latest as (
    select distinct on (a.question_id) a.question_id, a.correct, a.answered_at
    from public.study_answers a
    where a.user_id = auth.uid()
    order by a.question_id, a.answered_at desc
  )
  select q.lecture_id, q.exam_id, count(*)::int, count(lt.question_id)::int,
         (count(*) filter (where o.question_id is not null))::int, max(lt.answered_at)
  from public.study_questions q
  left join latest lt on lt.question_id = q.id
  left join public.study_open_mistakes(p_group) o on o.question_id = q.id   -- the same rule as "הטעויות שלי"
  where q.group_id = p_group and q.retired_at is null and q.has_key
  group by q.lecture_id, q.exam_id;
$$;

-- The latest answer per question, for choosing what a session asks next
-- (new first, then mistakes, then the longest unseen).
create or replace function public.study_my_latest(p_group uuid)
returns table (question_id uuid, correct boolean, answered_at timestamptz, times int)
language sql stable set search_path = public as $$
  select distinct on (a.question_id) a.question_id, a.correct, a.answered_at,
         (count(*) over (partition by a.question_id))::int
  from public.study_answers a
  join public.study_questions q on q.id = a.question_id
  where a.user_id = auth.uid() and q.group_id = p_group
  order by a.question_id, a.answered_at desc;
$$;

create or replace function public.study_my_daily(p_group uuid, p_days int default 30)
returns table (day date, answered int, correct int)
language sql stable set search_path = public as $$
  select (a.answered_at at time zone 'Asia/Jerusalem')::date, count(*)::int, (count(*) filter (where a.correct))::int
  from public.study_answers a
  join public.study_questions q on q.id = a.question_id
  where a.user_id = auth.uid() and q.group_id = p_group
    and a.answered_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)))
  group by 1
  order by 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_exams            enable row level security;
alter table public.study_question_batches enable row level security;
alter table public.study_questions        enable row level security;
alter table public.study_question_keys    enable row level security;
alter table public.study_answers          enable row level security;
alter table public.study_question_flags   enable row level security;

-- (When this lands in study-schema.sql, the file's loop has already dropped
-- these; the drops keep this file re-runnable on its own.)
drop policy if exists "study exams read"   on public.study_exams;
drop policy if exists "study exams add"    on public.study_exams;
drop policy if exists "study exams update" on public.study_exams;
drop policy if exists "study exams delete" on public.study_exams;
drop policy if exists "study question batches read" on public.study_question_batches;
drop policy if exists "study questions read" on public.study_questions;
drop policy if exists "study answers read own"   on public.study_answers;
drop policy if exists "study answers delete own" on public.study_answers;
drop policy if exists "study question flags read"   on public.study_question_flags;
drop policy if exists "study question flags add"    on public.study_question_flags;
drop policy if exists "study question flags remove" on public.study_question_flags;

create policy "study exams read" on public.study_exams
  for select using (public.study_is_member(group_id));
-- Review M10: exams come in only while the server switch 'exams' is on.
-- Review M2: an exam's items carry every member's private answers; only its
-- uploader may delete it, on the day it was uploaded (a wrong file). Later,
-- Yoad deletes it in the SQL editor if it must go.
create policy "study exams add" on public.study_exams
  for insert with check (public.study_is_member(group_id) and created_by = auth.uid() and public.study_feature_on('exams'));
create policy "study exams update" on public.study_exams
  for update using (public.study_is_member(group_id)) with check (public.study_is_member(group_id));
create policy "study exams delete" on public.study_exams
  for delete using (created_by = auth.uid() and created_at > now() - interval '24 hours' and public.study_is_member(group_id));

create policy "study question batches read" on public.study_question_batches
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study questions read" on public.study_questions
  for select using (public.study_is_member(group_id));
-- study_question_keys: no policy on purpose.
create policy "study answers read own" on public.study_answers
  for select using (user_id = auth.uid());
create policy "study answers delete own" on public.study_answers
  for delete using (user_id = auth.uid());
create policy "study question flags read" on public.study_question_flags
  for select using (public.study_is_member(public.study_question_group(question_id)));
create policy "study question flags add" on public.study_question_flags
  for insert with check (user_id = auth.uid() and public.study_is_member(public.study_question_group(question_id)));
create policy "study question flags remove" on public.study_question_flags
  for delete using (user_id = auth.uid());

revoke all on public.study_exams, public.study_question_batches, public.study_questions, public.study_question_keys,
  public.study_answers, public.study_question_flags from anon, authenticated;
grant select, delete on public.study_exams to authenticated;
grant insert (id, group_id, course, title, year, source_name, pages, key_source) on public.study_exams to authenticated;
grant update (course, title, year, key_source, status, error, updated_at) on public.study_exams to authenticated;
grant select on public.study_question_batches to authenticated;
grant select on public.study_questions to authenticated;
grant select, delete on public.study_answers to authenticated;
grant select, delete on public.study_question_flags to authenticated;
grant insert (question_id, reason, note) on public.study_question_flags to authenticated;

revoke all on function public.study_question_group(uuid), public.study_exam_group(uuid),
  public.study_question_round(uuid), public.study_question_claim(uuid, text), public.study_save_question(uuid, uuid, jsonb, text),
  public.study_question_finish(uuid, text, int, text, numeric, text, text), public.study_answer_question(uuid, int, text, int),
  public.study_question_feedback(uuid[]), public.study_retire_question(uuid, boolean, text),
  public.study_set_exam_key(uuid, int), public.study_set_explanations(uuid, text[], text, int[], uuid, text),
  public.study_exam_items_for_explain(uuid[]), public.study_open_mistakes(uuid),
  public.study_my_mistakes(uuid, uuid), public.study_my_topic_stats(uuid), public.study_my_latest(uuid),
  public.study_my_daily(uuid, int), public.study_practice_overview(uuid)
  from public, anon;
-- The four server-only ones need the server key inside; the grant only lets the op's call reach them.
grant execute on function public.study_question_group(uuid), public.study_exam_group(uuid),
  public.study_question_round(uuid), public.study_question_claim(uuid, text), public.study_save_question(uuid, uuid, jsonb, text),
  public.study_question_finish(uuid, text, int, text, numeric, text, text), public.study_answer_question(uuid, int, text, int),
  public.study_question_feedback(uuid[]), public.study_retire_question(uuid, boolean, text),
  public.study_set_exam_key(uuid, int), public.study_set_explanations(uuid, text[], text, int[], uuid, text),
  public.study_exam_items_for_explain(uuid[]), public.study_open_mistakes(uuid),
  public.study_my_mistakes(uuid, uuid), public.study_my_topic_stats(uuid), public.study_my_latest(uuid),
  public.study_my_daily(uuid, int), public.study_practice_overview(uuid)
  to authenticated;

-- ── Realtime: questions appear on every phone as they are written, the
--  round's progress and flags show live. Never the keys or the answers.
do $$
declare t text;
begin
  foreach t in array array['study_exams', 'study_question_batches', 'study_questions', 'study_question_flags'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

insert into study_private.schema_sections (section, version) values ('Q', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


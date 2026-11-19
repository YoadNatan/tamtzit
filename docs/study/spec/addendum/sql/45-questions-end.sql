-- ════════════════════════════════════════════════════════════════════════
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
alter table public.study_questions
  add column if not exists anchor     int  check (anchor between 0 and 9999),
  add column if not exists quote      text not null default '' check (char_length(quote) <= 200),
  add column if not exists part_gen   int  check (part_gen >= 0),
  add column if not exists teaser     text not null default '' check (char_length(teaser) <= 120),
  add column if not exists stale_at   timestamptz,
  add column if not exists stale_edit uuid,                 -- study_edits.id (section K is later: no foreign key)
  add column if not exists checked_by uuid references auth.users (id) on delete set null,
  add column if not exists checked_at timestamptz;
create index if not exists study_questions_anchor on public.study_questions (lecture_id, part_idx, anchor) where anchor is not null;

alter table public.study_answers
  add column if not exists confidence smallint check (confidence between 1 and 3);


-- "עדיין נכון": a member checked a question that a correction marked, and
-- it goes back into practice and quizzes for everyone. The row says who.
create or replace function public.study_question_still_true(p_question uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_questions q
     set stale_at = null, stale_edit = null, checked_by = auth.uid(), checked_at = now()
   where q.id = p_question and public.study_is_member(q.group_id) and q.stale_at is not null;
  if not found and not exists (select 1 from public.study_questions q where q.id = p_question and public.study_is_member(q.group_id)) then
    raise exception 'question not found';
  end if;
end;
$$;
revoke all on function public.study_question_still_true(uuid) from public, anon;
grant execute on function public.study_question_still_true(uuid) to authenticated;

-- ── New columns ──
alter table public.study_question_batches
  add column if not exists via        text not null default 'tap' check (via in ('tap', 'batch', 'server')),
  add column if not exists hold_until timestamptz,                       -- the Batch API holds the part until then
  add column if not exists solver_rejected int not null default 0 check (solver_rejected >= 0);
alter table public.study_question_keys
  add column if not exists whens text[] not null default '{}';           -- "מתי כן" per option ('' for the key)
alter table public.study_questions
  add column if not exists figure      text   not null default '' check (figure = '' or figure ~ '^fig:[0-9]{1,4}-[0-9]{1,3}$'),
  add column if not exists option_tags text[] not null default '{}',     -- the drug or organism of each option
  add column if not exists hidden_at   timestamptz,                      -- two flags: out of everyone's practice
  add column if not exists fixed_by    uuid references auth.users (id) on delete set null,
  add column if not exists fixed_at    timestamptz,
  add column if not exists fix_slides  int[]  not null default '{}',
  add column if not exists fix_note    text   not null default '' check (char_length(fix_note) <= 300);
create index if not exists study_questions_hidden on public.study_questions (lecture_id) where hidden_at is not null;

-- ── Who may drive a batch: the op (the key and a member of the lecture's
--    group) or the server's worker (the key alone, no member token; it is
--    reached only through section B's functions, which anon may call). ──
create or replace function study_private.may_bank(p_lecture uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then return false; end if;
  if auth.uid() is null then return true; end if;
  return coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false);
end;
$$;
revoke all on function study_private.may_bank(uuid, text) from public;

-- ── D3: plan a round (a member's tap, or the worker with the key) ──
drop function if exists public.study_question_round(uuid);
create or replace function public.study_question_round(p_lecture uuid, p_key text default null)
returns table (round int, batches int, fresh boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  g uuid := public.study_lecture_group(p_lecture);
  r int;
  open_n int;
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
  perform pg_advisory_xact_lock(hashtext('study_question_round:' || p_lecture::text));
  update public.study_question_batches b set status = 'failed', error = 'gave up', updated_at = now()
   where b.lecture_id = p_lecture and b.status = 'writing' and b.attempts >= 3 and b.updated_at < now() - interval '6 minutes'
     and (b.hold_until is null or b.hold_until <= now());
  select max(b.round) into r from public.study_question_batches b where b.lecture_id = p_lecture;
  if r is not null then
    select count(*) into open_n from public.study_question_batches b
     where b.lecture_id = p_lecture and b.round = r and b.status in ('pending', 'writing');
    if open_n > 0 then
      return query select r, open_n, false;
      return;
    end if;
  end if;
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

-- ── D3: claim a part. A part the Batch API holds is busy for a member
--    until its hold ends (then a tap writes it at full price). ──
create or replace function public.study_question_claim(p_batch uuid, p_key text default null)
returns table (lecture_id uuid, round int, part_idx int, heading text, slide_from int, slide_to int, wanted int, effort text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare b public.study_question_batches;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- only the op or the worker (review B1)
  select * into b from public.study_question_batches x where x.id = p_batch;
  if not found or not study_private.may_bank(b.lecture_id, p_key)
     or exists (select 1 from public.study_lectures l where l.id = b.lecture_id and l.deleted_at is not null) then
    raise exception 'batch not found';
  end if;
  if auth.uid() is not null and b.hold_until > now() then raise exception 'busy'; end if;
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

-- ── Saves one question with its key: the meeting block's version (the
--    paragraph, its quote, the part's generation, the teaser) plus the
--    worker path, "מתי כן" (whens), the diagram (figure) and option tags.
--    p_q adds: whens[] and option_tags[] (empty, or one per option), figure.
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
  whn  text[] := array(select left(x, 300) from jsonb_array_elements_text(coalesce(p_q -> 'whens', '[]'::jsonb)) x);
  tags text[] := array(select left(btrim(x), 80) from jsonb_array_elements_text(coalesce(p_q -> 'option_tags', '[]'::jsonb)) x);
  sl   int[]  := array(select (jsonb_array_elements_text(coalesce(p_q -> 'slides', '[]'::jsonb)))::int);
  ans  int    := (p_q ->> 'answer')::int;
  para int    := case when jsonb_typeof(p_q -> 'para') = 'number' and (p_q ->> 'para') ~ '^[0-9]{1,4}$' then (p_q ->> 'para')::int end;
  fig  text   := coalesce(p_q ->> 'figure', '');
  pgen int;
  have int[];
  qid  uuid;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;   -- only the server saves Claude's items (review B1)
  if (p_batch is null) = (p_exam is null) then raise exception 'batch or exam'; end if;
  if p_exam is not null and auth.uid() is null then raise exception 'not signed in'; end if;   -- exams: the op only
  if p_exam is not null and not study_private.feature_on('exams') then raise exception 'off'; end if;   -- review M10
  if cardinality(opts) not between 2 and 6 then raise exception 'bad options'; end if;
  if ans is not null and (ans < 0 or ans >= cardinality(opts)) then raise exception 'bad answer'; end if;
  if cardinality(whn) not in (0, cardinality(opts)) then raise exception 'whens do not match options'; end if;
  if cardinality(tags) not in (0, cardinality(opts)) then raise exception 'tags do not match options'; end if;
  if p_batch is not null then
    select * into b from public.study_question_batches x where x.id = p_batch;
    if not found then raise exception 'batch not found'; end if;
    lec := b.lecture_id;
    g := public.study_lecture_group(lec);
    if not study_private.may_bank(lec, p_key) then raise exception 'batch not found'; end if;
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
    select s.gen into pgen from public.study_sections s where s.lecture_id = lec and s.idx = part;
    -- P13: a diagram that is not one of this lecture's pictures is dropped, not raised (the question stays good).
    if fig <> '' and (fig !~ '^fig:[0-9]{1,4}-[0-9]{1,3}$'
        or not exists (select 1 from public.study_lectures l, jsonb_array_elements(l.slides) s,
                              jsonb_array_elements(coalesce(s -> 'figures', '[]'::jsonb)) f
                        where l.id = lec and (s ->> 'n')::int = split_part(substr(fig, 5), '-', 1)::int
                          and (f ->> 'k')::int = split_part(substr(fig, 5), '-', 2)::int)) then
      fig := '';
    end if;
  else
    select * into e from public.study_exams x where x.id = p_exam;
    if not found or not public.study_is_member(e.group_id) then raise exception 'exam not found'; end if;
    g := e.group_id;
    src := 'exam';
    para := null;
    fig := '';
    if cardinality(expl) not in (0, cardinality(opts)) then raise exception 'explanations do not match options'; end if;
  end if;
  insert into public.study_questions (group_id, lecture_id, batch_id, exam_id, exam_no, source, part_idx, kind,
                                      difficulty, vignette, question, options, slides, topic, aspect, has_key, model,
                                      anchor, quote, part_gen, teaser, figure, option_tags, created_by)
  values (g, lec, p_batch, p_exam, (p_q ->> 'exam_no')::int, src, part, p_q ->> 'kind',
          coalesce((p_q ->> 'difficulty')::int, 2), coalesce(p_q ->> 'vignette', ''), p_q ->> 'question', opts, sl,
          left(coalesce(p_q ->> 'topic', ''), 120), coalesce(p_q ->> 'aspect', 'other'), ans is not null, p_q ->> 'model',
          para, case when para is null then '' else left(coalesce(p_q ->> 'quote', ''), 200) end,
          case when para is null then null else pgen end,
          left(btrim(coalesce(p_q ->> 'teaser', '')), 120), fig, tags, auth.uid())
  returning id into qid;
  insert into public.study_question_keys (question_id, answer, explanations, takeaway, whens)
  values (qid, ans, expl, left(coalesce(p_q ->> 'takeaway', ''), 600), whn);
  if p_batch is not null then
    update public.study_question_batches x set made = x.made + 1, updated_at = now() where x.id = p_batch;
  end if;
  return qid;
end;
$$;

-- ── Ends a claimed part (the op or the worker). P7: p_solver_rejected
--    counts the items the blind solver answered differently from the key.
drop function if exists public.study_question_finish(uuid, text, int, text, numeric, text, text);
create or replace function public.study_question_finish(p_batch uuid, p_status text, p_rejected int,
  p_model text, p_cost numeric, p_error text, p_key text default null, p_solver_rejected int default 0)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if p_status not in ('ready', 'failed') then raise exception 'bad status'; end if;
  update public.study_question_batches x
     set status = p_status,
         rejected = x.rejected + greatest(0, coalesce(p_rejected, 0)),
         solver_rejected = x.solver_rejected + greatest(0, coalesce(p_solver_rejected, 0)),
         model = coalesce(p_model, x.model),
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

-- ── P2 + P3 + P5: answering. The bet is stored with the answer (never
--    shown to anyone else); the reply adds "מתי כן"; a hidden question
--    cannot be answered in practice.
drop function if exists public.study_answer_question(uuid, int, text, int);
create or replace function public.study_answer_question(p_question uuid, p_choice int, p_mode text default 'lecture',
  p_ms int default null, p_confidence int default null)
returns table (answer int, explanations text[], takeaway text, correct boolean, whens text[])
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
  if coalesce(p_mode, '') not in ('lecture', 'course', 'mistakes', 'exam') then raise exception 'bad mode'; end if;   -- review SEC-7
  if q.hidden_at is not null then raise exception 'hidden'; end if;
  select * into k from public.study_question_keys x where x.question_id = p_question;
  if k.held_until > now() then raise exception 'in quiz'; end if;
  if k.answer is null then raise exception 'no key'; end if;
  if p_choice is not null and (p_choice < 0 or p_choice >= cardinality(q.options)) then raise exception 'bad choice'; end if;
  if p_confidence is not null and p_confidence not between 1 and 3 then raise exception 'bad bet'; end if;
  ok := coalesce(p_choice = k.answer, false);
  insert into public.study_answers (user_id, question_id, choice, correct, mode, ms, confidence)
  values (auth.uid(), p_question, p_choice, ok, p_mode, case when p_ms between 0 and 3600000 then p_ms end, p_confidence);
  return query select k.answer::int, k.explanations, k.takeaway, ok, k.whens;
end;
$$;

-- "מתי כן" of questions the caller has already answered (reviewing a
-- session or the mistakes list), beside section Q's study_question_feedback,
-- whose result stays as it is. Others: no row.
create or replace function public.study_question_whens(p_ids uuid[])
returns table (question_id uuid, whens text[])
language sql stable security definer set search_path = public as $$
  select k.question_id, k.whens
  from public.study_question_keys k
  join public.study_questions q on q.id = k.question_id
  where k.question_id = any (p_ids)
    and public.study_is_member(q.group_id)
    and (k.held_until is null or k.held_until <= now())
    and exists (select 1 from public.study_answers a where a.question_id = k.question_id and a.user_id = auth.uid());
$$;

-- ── P5: two flags hide a question for everyone until it is fixed ──
-- Flags that count: wrong_key, not_in_slides, two_answers, unclear, from two
-- different members, given after the question's last fix. "duplicate" and
-- "other" stay notes for the group.
create or replace function study_private.question_flags_now(p_question uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct f.user_id)::int
    from public.study_question_flags f join public.study_questions q on q.id = f.question_id
   where f.question_id = p_question
     and f.reason in ('wrong_key', 'not_in_slides', 'two_answers', 'unclear')
     and f.created_at > coalesce(q.fixed_at, '-infinity'::timestamptz)
$$;
create or replace function public.study_question_flags_hide()
returns trigger language plpgsql security definer set search_path = public as $$
declare q uuid := coalesce(new.question_id, old.question_id);
begin
  if study_private.question_flags_now(q) >= 2 then
    update public.study_questions x set hidden_at = coalesce(x.hidden_at, now()) where x.id = q and x.hidden_at is null;
  else
    update public.study_questions x set hidden_at = null where x.id = q and x.hidden_at is not null;   -- a flag taken back
  end if;
  return null;
end;
$$;
revoke all on function study_private.question_flags_now(uuid), public.study_question_flags_hide() from public, anon, authenticated;
drop trigger if exists study_question_flags_hide on public.study_question_flags;
create trigger study_question_flags_hide after insert or delete on public.study_question_flags
  for each row execute function public.study_question_flags_hide();

-- A member fixes a hidden question (two different members' counting flags;
-- one member's flag never retires a question for everyone, review SEC-13):
-- 'keep' with the slides that show the key is right (a citation is
-- required), or 'retire' it for good. Never while a live quiz holds the key.
-- The flags before the fix stop counting; the row says who, when and why.
create or replace function public.study_question_fix(p_question uuid, p_verdict text, p_slides int[], p_note text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  q    public.study_questions;
  have int[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into q from public.study_questions x where x.id = p_question for update;
  if not found or not public.study_is_member(q.group_id) then raise exception 'question not found'; end if;
  if coalesce(p_verdict, '') not in ('keep', 'retire') then raise exception 'bad verdict'; end if;
  if q.hidden_at is null then raise exception 'not flagged'; end if;                      -- review SEC-13: two members' flags
  if exists (select 1 from public.study_question_keys k where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';                                                            -- review SEC-2
  end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'too long'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = coalesce(q.lecture_id, q.ref_lecture);
  if p_verdict = 'keep' and (cardinality(coalesce(p_slides, '{}')) not between 1 and 6 or not (p_slides <@ have)) then
    raise exception 'bad source';
  end if;
  update public.study_questions x
     set hidden_at = null, fixed_by = auth.uid(), fixed_at = now(),
         fix_slides = coalesce(p_slides, '{}'), fix_note = btrim(coalesce(p_note, '')),
         retired_at = case when p_verdict = 'retire' then now() else x.retired_at end,
         retired_by = case when p_verdict = 'retire' then auth.uid() else x.retired_by end,
         retire_note = case when p_verdict = 'retire' then left(btrim(coalesce(p_note, '')), 300) else x.retire_note end
   where x.id = p_question;
end;
$$;

-- The fix sheet ("לבדוק מול השקף"): the key, explanations and flags of a
-- HIDDEN question (two different members' counting flags), for any member of
-- its group. The one place a key is shown before an answer: a hidden question
-- is out of practice, quizzes, the meeting and Today while it waits
-- (review F-6), and checking it needs the key. One's own flag of any reason
-- opens nothing, and a key a live quiz holds stays held (review SEC-2).
create or replace function public.study_question_for_fix(p_question uuid)
returns table (answer int, explanations text[], takeaway text, whens text[], hidden boolean, flags jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare q public.study_questions;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into q from public.study_questions x where x.id = p_question;
  if not found or not public.study_is_member(q.group_id) then raise exception 'question not found'; end if;
  if q.hidden_at is null then raise exception 'not flagged'; end if;                      -- review SEC-2: two members' flags
  if exists (select 1 from public.study_question_keys k where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';                                                            -- review SEC-2: the quiz's hold
  end if;
  return query
  select k.answer::int, k.explanations, k.takeaway, k.whens, q.hidden_at is not null,
         coalesce((select jsonb_agg(jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at) order by f.created_at)
                     from public.study_question_flags f where f.question_id = p_question), '[]'::jsonb)
    from public.study_question_keys k where k.question_id = p_question;
end;
$$;

-- ── P4: another wording ──
-- A question is one of "הטעויות שלי" until, on a LATER study day than its
-- last wrong answer, the caller answers it right, or answers right another
-- question on the same paragraph (the same fact in another wording).
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
   where q.group_id = p_group and q.retired_at is null and q.hidden_at is null
     and not exists (select 1 from mine r where r.question_id = w.question_id and r.correct and r.day > w.wrong_day)
     and not exists (select 1 from mine r join public.study_questions s on s.id = r.question_id
                      where r.correct and r.day > w.wrong_day and q.anchor is not null and s.id <> q.id
                        and s.lecture_id = q.lecture_id and s.part_idx = q.part_idx and s.anchor = q.anchor);
$$;

-- What to ask instead, for each open mistake from an earlier study day: a
-- question on the same paragraph the caller has not answered right since the
-- miss (the least recently seen), else a card on that paragraph, else the
-- question itself. $0: the bank and the deck already hold the wordings.
create or replace function public.study_my_rewordings(p_group uuid, p_now timestamptz default now())
returns table (question_id uuid, wrong_at timestamptz, ask_kind text, ask_question uuid, ask_card uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  with o as (
    select m.question_id, m.wrong_at, q.lecture_id, q.part_idx, q.anchor
      from public.study_open_mistakes(p_group) m join public.study_questions q on q.id = m.question_id
     where public.study_day(m.wrong_at) < public.study_day(p_now)
  )
  select o.question_id, o.wrong_at,
         case when s.id is not null then 'question' when c.id is not null then 'card' else 'same' end,
         coalesce(s.id, case when c.id is null then o.question_id end), c.id
    from o
    left join lateral (
      select q2.id from public.study_questions q2
       where o.anchor is not null and q2.lecture_id = o.lecture_id and q2.part_idx = o.part_idx and q2.anchor = o.anchor
         and q2.id <> o.question_id and q2.retired_at is null and q2.hidden_at is null and q2.stale_at is null and q2.has_key
         and not exists (select 1 from public.study_answers a where a.user_id = auth.uid() and a.question_id = q2.id
                           and a.correct and a.answered_at > o.wrong_at)
       order by (select max(a.answered_at) from public.study_answers a where a.user_id = auth.uid() and a.question_id = q2.id) nulls first,
                q2.created_at
       limit 1) s on true
    left join lateral (
      select cd.id from public.study_cards cd
       where s.id is null and o.anchor is not null and cd.lecture_id = o.lecture_id and cd.part_idx = o.part_idx
         and (to_jsonb(cd) ->> 'anchor')::int = o.anchor and cd.deleted_at is null
         and (to_jsonb(cd) ->> 'stale_at') is null
       order by cd.created_at limit 1) c on to_regclass('public.study_cards') is not null
   order by o.wrong_at;
end;
$$;

-- ── Q12: the pairs the caller confuses (her own wrong answers whose chosen
--    option and key both carry a tag), newest last 60 days, most often first.
create or replace function public.study_my_confusions(p_group uuid, p_now timestamptz default now())
returns table (right_tag text, chosen_tag text, times int, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return query
  select q.option_tags[k.answer + 1], q.option_tags[a.choice + 1], count(*)::int, max(a.answered_at)
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id and q.group_id = p_group
    join public.study_question_keys k on k.question_id = q.id
   where a.user_id = auth.uid() and not a.correct and a.choice is not null
     and a.answered_at > p_now - interval '60 days' and a.answered_at <= p_now
     and cardinality(q.option_tags) = cardinality(q.options)
     and coalesce(q.option_tags[k.answer + 1], '') <> '' and coalesce(q.option_tags[a.choice + 1], '') <> ''
     and lower(q.option_tags[k.answer + 1]) <> lower(q.option_tags[a.choice + 1])
   group by 1, 2
   order by 3 desc, 4 desc
   limit 20;
end;
$$;

revoke all on function public.study_question_round(uuid, text), public.study_question_claim(uuid, text),
  public.study_save_question(uuid, uuid, jsonb, text),
  public.study_question_finish(uuid, text, int, text, numeric, text, text, int),
  public.study_answer_question(uuid, int, text, int, int), public.study_question_whens(uuid[]),
  public.study_question_fix(uuid, text, int[], text), public.study_question_for_fix(uuid), public.study_open_mistakes(uuid),
  public.study_my_rewordings(uuid, timestamptz), public.study_my_confusions(uuid, timestamptz)
  from public, anon;
-- The server-only ones need the key inside; members reach them through the ops,
-- the worker only through section B's functions (no anon grant here).
grant execute on function public.study_question_round(uuid, text), public.study_question_claim(uuid, text),
  public.study_save_question(uuid, uuid, jsonb, text),
  public.study_question_finish(uuid, text, int, text, numeric, text, text, int),
  public.study_answer_question(uuid, int, text, int, int), public.study_question_whens(uuid[]),
  public.study_question_fix(uuid, text, int[], text), public.study_question_for_fix(uuid), public.study_open_mistakes(uuid),
  public.study_my_rewordings(uuid, timestamptz), public.study_my_confusions(uuid, timestamptz)
  to authenticated;

insert into study_private.schema_sections (section, version) values ('Q', 2)
on conflict (section) do update set version = excluded.version, loaded_at = now();

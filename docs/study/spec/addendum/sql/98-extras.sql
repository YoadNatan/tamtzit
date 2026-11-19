-- ════════════════════════════════════════════════════════════════════════
--  SECTION E · PHASE-3 EXTRAS: A MEMBER'S OWN TRAP   (package E; server
--  addendum §6; approved phase 3)
--  P11 "להוסיף מלכודת משלי": a member writes a trap question on a
--      paragraph; Claude checks it against the slides without rewriting it
--      (op trap_check) and writes only the explanations of its options; it
--      joins everyone's bank. Its author stays hidden until the question has
--      been answered in a live quiz, then shows ("נכתבה ע״י רוני · נבדקה מול
--      השקפים"). The draft is the author's alone until it passes.
--  P10 a wrong cell of "טבלה ריקה" becomes a private card through section
--      C's study_my_card_add(origin 'table'): no SQL here.
--  Q11 the quiz rounds "המלכודות שלנו" and "מי אני?" are design only (§6.3).
--  Needs: F, Q (+ its end), Z (its answers reach study_answers).
-- ════════════════════════════════════════════════════════════════════════

-- Section Q's table: a third source, 'member', with its author shown only
-- once unmasked. (E's lines in another package's table, reviewed by Q.)
alter table public.study_questions
  add column if not exists author_id   uuid references auth.users (id) on delete set null,   -- null until unmasked
  add column if not exists unmasked_at timestamptz;
alter table public.study_questions drop constraint if exists study_questions_source_check;
alter table public.study_questions add constraint study_questions_source_check check (source in ('ai', 'exam', 'member'));
do $$
declare c record;
begin
  -- Section Q's "source = 'ai' or an exam item" becomes "an exam item, or not an exam".
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.study_questions'::regclass and con.contype = 'c'
              and pg_get_constraintdef(con.oid) like '%source = ''ai''::text) OR ((exam_id IS NOT NULL) AND (lecture_id IS NULL))%'
  loop
    execute format('alter table public.study_questions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.study_questions drop constraint if exists study_questions_exam_shape;
alter table public.study_questions add constraint study_questions_exam_shape
  check (source <> 'exam' or (exam_id is not null and lecture_id is null));

-- The author's drafts (owner-only, never published).
create table if not exists public.study_trap_drafts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx    int         not null check (part_idx >= 0),
  anchor      int         check (anchor between 0 and 9999),
  quote       text        not null default '' check (char_length(quote) <= 200),
  vignette    text        not null default '' check (char_length(vignette) <= 1200),
  question    text        not null check (char_length(btrim(question)) between 8 and 400),
  options     text[]      not null check (cardinality(options) between 4 and 5),
  answer      smallint    not null check (answer between 0 and 4),
  note        text        not null default '' check (char_length(note) <= 300),   -- the trap, in the author's words
  slides      int[]       not null check (cardinality(slides) between 1 and 6),
  state       text        not null default 'draft' check (state in ('draft', 'ok', 'rejected')),
  problem     text        not null default '' check (char_length(problem) <= 300),
  question_id uuid        references public.study_questions (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (answer < cardinality(options))
);
create index if not exists study_trap_drafts_question on public.study_trap_drafts (question_id) where question_id is not null;
alter table public.study_trap_drafts enable row level security;
drop policy if exists "study trap drafts own" on public.study_trap_drafts;
create policy "study trap drafts own" on public.study_trap_drafts for select using (user_id = auth.uid());
revoke all on public.study_trap_drafts from anon, authenticated;
grant select on public.study_trap_drafts to authenticated;

-- The author writes (or rewrites, after a rejection) her trap on a paragraph.
-- Returns the draft's id; op trap_check then checks it.
create or replace function public.study_trap_submit(p_draft uuid, p_lecture uuid, p_part int, p_anchor int, p_quote text,
  p_vignette text, p_question text, p_options text[], p_answer int, p_note text, p_slides int[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g    uuid := public.study_lecture_group(p_lecture);
  have int[];
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not public.study_is_member(g) then raise exception 'lecture not found'; end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then raise exception 'bad parts'; end if;
  if char_length(btrim(coalesce(p_question, ''))) not between 8 and 400 or btrim(p_question) !~ '\?$' then raise exception 'bad question'; end if;
  if cardinality(coalesce(p_options, '{}')) not between 4 and 5
     or exists (select 1 from unnest(p_options) o where char_length(btrim(coalesce(o, ''))) not between 1 and 220)
     or (select count(distinct lower(btrim(o))) from unnest(p_options) o) <> cardinality(p_options) then
    raise exception 'bad options';
  end if;
  if p_answer is null or p_answer < 0 or p_answer >= cardinality(p_options) then raise exception 'bad answer'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = p_lecture;
  if cardinality(coalesce(p_slides, '{}')) not between 1 and 6 or not (p_slides <@ have) then raise exception 'bad source'; end if;
  if (select count(*) from public.study_trap_drafts d where d.user_id = auth.uid() and d.created_at > now() - interval '1 day') >= 10
     and p_draft is null then
    raise exception 'daily_limit';
  end if;
  if p_draft is null then
    insert into public.study_trap_drafts (user_id, group_id, lecture_id, part_idx, anchor, quote, vignette, question, options,
                                          answer, note, slides)
    values (auth.uid(), g, p_lecture, p_part, p_anchor, left(coalesce(p_quote, ''), 200), btrim(coalesce(p_vignette, '')),
            btrim(p_question), array(select btrim(o) from unnest(p_options) o), p_answer, btrim(coalesce(p_note, '')), p_slides)
    returning id into v_id;
  else
    update public.study_trap_drafts d
       set part_idx = p_part, anchor = p_anchor, quote = left(coalesce(p_quote, ''), 200), vignette = btrim(coalesce(p_vignette, '')),
           question = btrim(p_question), options = array(select btrim(o) from unnest(p_options) o), answer = p_answer,
           note = btrim(coalesce(p_note, '')), slides = p_slides, state = 'draft', problem = '', updated_at = now()
     where d.id = p_draft and d.user_id = auth.uid() and d.lecture_id = p_lecture and d.state <> 'ok'
    returning d.id into v_id;
    if v_id is null then raise exception 'draft not found'; end if;
  end if;
  return v_id;
end;
$$;

-- op trap_check (the author's token and the server key): Claude's verdict.
-- ok: the trap joins the bank as written, with Claude's explanation and
-- "מתי כן" for each option (the author's text is never changed); its author
-- stays hidden. Not ok: the draft keeps the problem, for the author to fix.
create or replace function public.study_trap_checked(p_draft uuid, p_ok boolean, p_problem text, p_whys text[], p_whens text[],
  p_takeaway text, p_topic text, p_aspect text, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  d   public.study_trap_drafts;
  qid uuid;
begin
  if not study_private.is_worker(p_key) or auth.uid() is null then raise exception 'forbidden'; end if;
  select * into d from public.study_trap_drafts x where x.id = p_draft and x.user_id = auth.uid() for update;
  if not found then raise exception 'draft not found'; end if;
  if d.state = 'ok' then raise exception 'checked'; end if;
  if not coalesce(p_ok, false) then
    update public.study_trap_drafts x set state = 'rejected', problem = left(btrim(coalesce(p_problem, '')), 300), updated_at = now()
     where x.id = p_draft;
    return null;
  end if;
  if cardinality(coalesce(p_whys, '{}')) <> cardinality(d.options) or cardinality(coalesce(p_whens, '{}')) not in (0, cardinality(d.options)) then
    raise exception 'explanations do not match options';
  end if;
  insert into public.study_questions (group_id, lecture_id, source, part_idx, kind, difficulty, vignette, question, options, slides,
                                      topic, aspect, has_key, model, anchor, quote, part_gen, created_by)
  values (d.group_id, d.lecture_id, 'member', d.part_idx, case when d.vignette <> '' then 'case' else 'mcq' end, 2, d.vignette,
          d.question, d.options, d.slides, left(coalesce(p_topic, ''), 120),
          case when p_aspect in ('mechanism', 'uses', 'pk', 'adverse', 'contra', 'interactions', 'resistance', 'dosing', 'classification',
                                 'epidemiology', 'lifecycle', 'pathogenesis', 'clinical', 'diagnosis', 'treatment', 'prevention')
               then p_aspect else 'other' end,
          true, 'member', d.anchor, case when d.anchor is null then '' else d.quote end,
          case when d.anchor is null then null else (select s.gen from public.study_sections s where s.lecture_id = d.lecture_id and s.idx = d.part_idx) end,
          null)
  returning id into qid;
  insert into public.study_question_keys (question_id, answer, explanations, takeaway, whens)
  values (qid, d.answer, array(select left(x, 450) from unnest(p_whys) x), left(coalesce(p_takeaway, ''), 600),
          coalesce(array(select left(x, 300) from unnest(p_whens) x), '{}'));
  update public.study_trap_drafts x set state = 'ok', problem = '', question_id = qid, updated_at = now() where x.id = p_draft;
  return qid;
end;
$$;

-- The author shows once a live quiz revealed her trap: section Z's final
-- reveal calls this hook (its no-op body is section Z's end's). Review SEC-7:
-- not a trigger on study_answers, whose 'quiz' rows a member could write.
drop trigger if exists study_answers_unmask on public.study_answers;
drop function if exists public.study_answers_unmask();
create or replace function public.study_quiz__revealed(p_quiz uuid, p_question uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.study_questions q
     set unmasked_at = now(),
         author_id = (select d.user_id from public.study_trap_drafts d where d.question_id = q.id)
   where q.id = p_question and q.source = 'member' and q.unmasked_at is null;
end;
$$;
revoke all on function public.study_quiz__revealed(uuid, uuid) from public, anon, authenticated;

revoke all on function public.study_trap_submit(uuid, uuid, int, int, text, text, text, text[], int, text, int[]),
  public.study_trap_checked(uuid, boolean, text, text[], text[], text, text, text, text) from public, anon;
grant execute on function public.study_trap_submit(uuid, uuid, int, int, text, text, text, text[], int, text, int[]),
  public.study_trap_checked(uuid, boolean, text, text[], text[], text, text, text, text) to authenticated;

insert into study_private.schema_sections (section, version) values ('E', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

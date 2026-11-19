-- ════════════════════════════════════════════════════════════════════════
--  SECTION K, its end · A CORRECTION NEEDS A SOURCE AND A SECOND APPROVAL
--  (package K; decision 5, R1; meeting addendum §3.4). K becomes version 2.
--
--  "הצעת תיקון": a member proposes one block for one block (section K's
--  rules: anchors never move, no new links) with a mandatory source: a slide
--  of the lecture ("שקף ✓"), the recording at a minute ("מההקלטה"), or an
--  outside source with a note ("חיצוני"). The group sees it pending
--  (published, so "ממתין לאישור" and "לאשר" show live). It is applied when
--  another member approves it, or when the meeting's reader approves it
--  aloud (section M: the reader of today's live meeting on this lecture,
--  with two other members following; never the reader's own proposal,
--  review SEC-3). Applied, it is a study_edits row as before, now with its
--  proposal, source and approver. An undo stays one tap and immediate, but
--  only of the paragraph's latest correction and only back to its own text
--  (study_undo_edit, or study_edit_block with p_undo_of and the two texts
--  swapped; review SEC-1); every other direct call of study_edit_block is
--  refused.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.study_edit_proposals (
  id            uuid        primary key default gen_random_uuid(),
  lecture_id    uuid        not null,
  part_idx      int         not null,
  anchor        int         not null check (anchor between 0 and 9999),
  gen           int         not null check (gen >= 0),
  base_rev      int         not null check (base_rev >= 0),
  occurrence    int         not null default 1 check (occurrence between 1 and 50),
  kind          text        not null check (kind in ('heading', 'paragraph', 'item', 'box', 'table', 'figure')),
  before_text   text        not null check (char_length(before_text) between 1 and 8000),
  after_text    text        not null check (char_length(after_text) between 1 and 8000),
  note          text        not null default '' check (char_length(note) <= 300),
  source_kind   text        not null check (source_kind in ('slide', 'recording', 'external')),
  source_slides int[]       not null default '{}' check (cardinality(source_slides) <= 6),
  source_at     int         check (source_at between 0 and 36000),          -- seconds into the recording
  source_note   text        not null default '' check (char_length(source_note) <= 300),
  state         text        not null default 'pending' check (state in ('pending', 'applied', 'withdrawn', 'conflict', 'disputed')),
  proposed_by   uuid        default auth.uid() references auth.users (id) on delete set null,
  approved_by   uuid        references auth.users (id) on delete set null,
  aloud         boolean     not null default false,
  edit_id       uuid        references public.study_edits (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  updated_at    timestamptz not null default now(),
  foreign key (lecture_id, part_idx) references public.study_sections (lecture_id, idx) on delete cascade
);
create index if not exists study_edit_proposals_lecture on public.study_edit_proposals (lecture_id, state, created_at desc);
-- One open proposal per paragraph.
create unique index if not exists study_edit_proposals_open on public.study_edit_proposals (lecture_id, part_idx, anchor)
  where state in ('pending', 'disputed');

alter table public.study_edits
  add column if not exists proposal_id   uuid references public.study_edit_proposals (id) on delete set null,
  add column if not exists source_kind   text check (source_kind in ('slide', 'recording', 'external', 'undo')),
  add column if not exists source_slides int[] not null default '{}',
  add column if not exists source_at     int check (source_at between 0 and 36000),
  add column if not exists source_note   text not null default '' check (char_length(source_note) <= 300),
  add column if not exists approved_by   uuid references auth.users (id) on delete set null,
  add column if not exists aloud         boolean not null default false;

alter table public.study_edit_proposals enable row level security;
revoke all on public.study_edit_proposals from anon, authenticated;
grant select on public.study_edit_proposals to authenticated;
drop policy if exists "study edit proposals read" on public.study_edit_proposals;
create policy "study edit proposals read" on public.study_edit_proposals
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));

-- Where a block stands now, by section K's rules (null: it cannot be placed).
create or replace function study_private.edit_place(p_md text, p_before text, p_base_rev int, p_rev int, p_occurrence int)
returns int language plpgsql immutable set search_path = public as $$
declare v_pos int[] := public.study_block_positions(p_md, p_before);
begin
  if p_rev = p_base_rev then
    if p_occurrence is null or p_occurrence < 1 or p_occurrence > coalesce(array_length(v_pos, 1), 0) then return null; end if;
    return v_pos[p_occurrence];
  elsif coalesce(array_length(v_pos, 1), 0) = 1 then
    return v_pos[1];
  end if;
  return null;
end;
$$;

-- Section K's study_edit_block body, now internal: applies one block for
-- one block, writes the history row with its author, approver and source.
-- Errors as section K's ('forbidden', 'bad block', 'too long', 'part not
-- found', 'part busy', 'part rewritten', 'no change', 'link', 'bad undo',
-- 'edit conflict').
create or replace function study_private.edit_apply(
  p_lecture uuid, p_part int, p_anchor int, p_before text, p_after text,
  p_base_rev int, p_base_gen int, p_occurrence int, p_note text, p_undo_of uuid,
  p_author uuid, p_approver uuid, p_aloud boolean, p_proposal uuid,
  p_source_kind text, p_source_slides int[], p_source_at int, p_source_note text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s        public.study_sections;
  v_after  text := public.study_tidy(coalesce(p_after, ''));
  v_note   text := btrim(coalesce(p_note, ''));
  v_why    text;
  v_md     text;
  v_at     int;
  v_merged boolean := false;
  v_rev    int;
  v_id     uuid;
  u        public.study_edits;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  if p_anchor is null or p_anchor < 0 or p_anchor > 9999 then raise exception 'bad block'; end if;
  if char_length(v_note) > 300 then raise exception 'too long'; end if;
  select * into s from public.study_sections x where x.lecture_id = p_lecture and x.idx = p_part for update;
  if not found then raise exception 'part not found'; end if;
  if s.status <> 'ready' then raise exception 'part busy'; end if;
  if s.gen is distinct from p_base_gen then raise exception 'part rewritten'; end if;
  v_why := public.study_block_edit_problem(p_before, v_after);
  if v_why is not null then raise exception '%', v_why; end if;
  if p_undo_of is not null then
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
  end if;
  v_md := public.study_tidy(s.markdown);
  v_at := study_private.edit_place(v_md, p_before, p_base_rev, s.rev, p_occurrence);
  if v_at is null then raise exception 'edit conflict'; end if;
  v_merged := s.rev <> p_base_rev;
  update public.study_sections x
     set markdown = overlay(v_md placing v_after from v_at for char_length(p_before)),
         title = case when v_at = 1 and p_before ~ '^## ' then left(btrim(regexp_replace(v_after, '^##[ \t]+', '')), 120) else x.title end,
         updated_at = now()
   where x.lecture_id = p_lecture and x.idx = p_part
  returning x.rev into v_rev;
  insert into public.study_edits (lecture_id, part_idx, anchor, gen, rev, kind, before_text, after_text, note, undo_of,
                                  author_id, approved_by, aloud, proposal_id, source_kind, source_slides, source_at, source_note)
  values (p_lecture, p_part, p_anchor, s.gen, v_rev, public.study_block_kind(p_before), p_before, v_after, v_note, p_undo_of,
          p_author, p_approver, coalesce(p_aloud, false), p_proposal, p_source_kind, coalesce(p_source_slides, '{}'),
          p_source_at, left(coalesce(p_source_note, ''), 300))
  returning id into v_id;
  return jsonb_build_object('edit_id', v_id, 'rev', v_rev, 'gen', s.gen, 'merged', v_merged);
end;
$$;
revoke all on function study_private.edit_place(text, text, int, int, int),
  study_private.edit_apply(uuid, int, int, text, text, int, int, int, text, uuid, uuid, uuid, boolean, uuid, text, int[], int, text)
  from public;

-- One tap undoes a correction, at once (section K's signature). Without
-- p_undo_of a change must be proposed: 'needs approval'. With it, the texts
-- must be the undone correction's own, swapped (review SEC-1: 'bad undo').
create or replace function public.study_edit_block(
  p_lecture uuid, p_part int, p_anchor int, p_before text, p_after text,
  p_base_rev int, p_base_gen int, p_occurrence int default 1, p_note text default '', p_undo_of uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  if p_undo_of is null then raise exception 'needs approval'; end if;
  return study_private.edit_apply(p_lecture, p_part, p_anchor, p_before, p_after, p_base_rev, p_base_gen, p_occurrence, p_note,
                                  p_undo_of, auth.uid(), null, false, null, 'undo', '{}', null, '');
end;
$$;

-- The app's one-tap undo (review SEC-1): the server reads the correction
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

-- "הצעת תיקון". Checked now as it will be applied (so a structural change,
-- a link or a stale editor fails at once), plus the source. Returns the
-- proposal's id. Errors: section K's, and 'bad source', 'pending exists'
-- (this paragraph already has an open proposal: approve or dispute it).
create or replace function public.study_propose_edit(
  p_lecture uuid, p_part int, p_anchor int, p_before text, p_after text, p_base_rev int, p_base_gen int,
  p_occurrence int, p_note text, p_source_kind text, p_source_slides int[], p_source_at int, p_source_note text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  s       public.study_sections;
  v_after text := public.study_tidy(coalesce(p_after, ''));
  v_note  text := btrim(coalesce(p_note, ''));
  v_src   text := btrim(coalesce(p_source_note, ''));
  v_why   text;
  have    int[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  if p_anchor is null or p_anchor < 0 or p_anchor > 9999 then raise exception 'bad block'; end if;
  if char_length(v_note) > 300 or char_length(v_src) > 300 then raise exception 'too long'; end if;
  select * into s from public.study_sections x where x.lecture_id = p_lecture and x.idx = p_part;
  if not found then raise exception 'part not found'; end if;
  if s.status <> 'ready' then raise exception 'part busy'; end if;
  if s.gen is distinct from p_base_gen then raise exception 'part rewritten'; end if;
  v_why := public.study_block_edit_problem(p_before, v_after);
  if v_why is not null then raise exception '%', v_why; end if;
  if study_private.edit_place(public.study_tidy(s.markdown), p_before, p_base_rev, s.rev, coalesce(p_occurrence, 1)) is null then
    raise exception 'edit conflict';
  end if;
  if coalesce(p_source_kind, '') = 'slide' then
    select coalesce(array_agg((sl ->> 'n')::int), '{}') into have
      from public.study_lectures l, jsonb_array_elements(l.slides) sl where l.id = p_lecture;
    if cardinality(coalesce(p_source_slides, '{}')) not between 1 and 6 or not (p_source_slides <@ have) then
      raise exception 'bad source';
    end if;
  elsif coalesce(p_source_kind, '') = 'recording' then
    if p_source_at is null or p_source_at not between 0 and 36000 then raise exception 'bad source'; end if;
  elsif coalesce(p_source_kind, '') = 'external' then
    if char_length(v_src) < 3 then raise exception 'bad source'; end if;
  else
    raise exception 'bad source';
  end if;
  if exists (select 1 from public.study_edit_proposals x
              where x.lecture_id = p_lecture and x.part_idx = p_part and x.anchor = p_anchor and x.state in ('pending', 'disputed')) then
    raise exception 'pending exists';
  end if;
  insert into public.study_edit_proposals (lecture_id, part_idx, anchor, gen, base_rev, occurrence, kind, before_text, after_text,
                                           note, source_kind, source_slides, source_at, source_note, proposed_by)
  values (p_lecture, p_part, p_anchor, s.gen, p_base_rev, coalesce(p_occurrence, 1), public.study_block_kind(p_before),
          p_before, v_after, v_note, p_source_kind,
          case when p_source_kind = 'slide' then p_source_slides else '{}' end,
          case when p_source_kind = 'recording' then p_source_at end, v_src, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- "לאשר": another member applies the proposal; with p_aloud, the reader of
-- a live meeting on this lecture applies it for the group ("אישור בקול
-- בפגישה"), even when the reader proposed it. A paragraph that changed
-- meanwhile does not raise: the proposal becomes 'conflict' and the answer
-- says so ({"conflict": true, "reason": …}). Errors: 'not pending',
-- 'own proposal', 'not the reader', and section K's.
create or replace function public.study_approve_edit(p_proposal uuid, p_aloud boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p   public.study_edit_proposals;
  res jsonb;
  ok  boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from public.study_edit_proposals x where x.id = p_proposal for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(p.lecture_id)), false) then
    raise exception 'forbidden';
  end if;
  if p.state <> 'pending' then raise exception 'not pending'; end if;
  if p.proposed_by = auth.uid() then raise exception 'own proposal'; end if;              -- review SEC-3: aloud too
  if coalesce(p_aloud, false) then
    ok := false;
    if to_regprocedure('study_private.meeting_reads_live(uuid,uuid)') is not null then    -- section M
      execute 'select study_private.meeting_reads_live($1, $2)' into ok using p.lecture_id, auth.uid();
    end if;
    if not coalesce(ok, false) then raise exception 'not live'; end if;                    -- review SEC-3
  end if;
  begin
    res := study_private.edit_apply(p.lecture_id, p.part_idx, p.anchor, p.before_text, p.after_text, p.base_rev, p.gen,
                                    p.occurrence, p.note, null, p.proposed_by, auth.uid(), coalesce(p_aloud, false), p.id,
                                    p.source_kind, p.source_slides, p.source_at, p.source_note);
  exception when others then
    if sqlerrm in ('edit conflict', 'part rewritten', 'part busy', 'part not found') then
      update public.study_edit_proposals x set state = 'conflict', decided_at = now(), updated_at = now() where x.id = p.id;
      return jsonb_build_object('conflict', true, 'reason', sqlerrm, 'proposal_id', p.id);
    end if;
    raise;
  end;
  update public.study_edit_proposals x
     set state = 'applied', approved_by = auth.uid(), aloud = coalesce(p_aloud, false),
         edit_id = (res ->> 'edit_id')::uuid, decided_at = now(), updated_at = now()
   where x.id = p.id;
  return res || jsonb_build_object('proposal_id', p.id);
end;
$$;

-- The proposer takes a pending proposal back.
create or replace function public.study_withdraw_edit(p_proposal uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_edit_proposals x set state = 'withdrawn', decided_at = now(), updated_at = now()
   where x.id = p_proposal and x.proposed_by = auth.uid() and x.state in ('pending', 'conflict');
  if not found then raise exception 'not pending'; end if;
end;
$$;

revoke all on function public.study_edit_block(uuid, int, int, text, text, int, int, int, text, uuid),
  public.study_propose_edit(uuid, int, int, text, text, int, int, int, text, text, int[], int, text),
  public.study_approve_edit(uuid, boolean), public.study_withdraw_edit(uuid)
  from public, anon;
grant execute on function public.study_edit_block(uuid, int, int, text, text, int, int, int, text, uuid),
  public.study_propose_edit(uuid, int, int, text, text, int, int, int, text, text, int[], int, text),
  public.study_approve_edit(uuid, boolean), public.study_withdraw_edit(uuid)
  to authenticated;

do $$
begin
  execute 'alter publication supabase_realtime add table public.study_edit_proposals';
exception when duplicate_object then
  null;
end $$;

-- ════════════════════════════════════════════════════════════════════════
--  SECTION K, its end (2) · "לשאול את הקבוצה" IN ONE TAP, WHO MARKED IT
--  ANSWERED, AND THE OPTIONAL CHECK OF A CORRECTION   (package K; server
--  addendum §3.3)
--  Appended at the end of section K, after the meeting addendum's lines
--  (75-collab-end.sql), inside K's markers. K stays version 2.
--
--  K2  "עדיין לא ברור? לשאול את הקבוצה": the question goes onto the
--      paragraph's thread as the asker's question, with Claude's attempt
--      attached as a reply only this function can mark (ask_attempt).
--  K4  who marked a question answered (resolved_by, resolved_at); the
--      asker's card is section C's study_my_card_add(origin 'answer').
--  X2  "בדיקת תיקון מול השקף" (optional, ≈ $0.01-0.02): op fix_check
--      writes its result on the proposal with the server key.
-- ════════════════════════════════════════════════════════════════════════
alter table public.study_comments
  add column if not exists ask_attempt boolean not null default false,   -- Claude's attempt, attached by the asker
  add column if not exists resolved_by uuid references auth.users (id) on delete set null,
  add column if not exists resolved_at timestamptz;

-- Marking a question answered (any member, as today) records who and when.
create or replace function public.study_comments_resolved_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.resolved is distinct from old.resolved then
    new.resolved_by := case when new.resolved then auth.uid() end;
    new.resolved_at := case when new.resolved then now() end;
  end if;
  return new;
end;
$$;
revoke all on function public.study_comments_resolved_by() from public, anon, authenticated;
drop trigger if exists study_comments_resolved_by on public.study_comments;
create trigger study_comments_resolved_by before update of resolved on public.study_comments
  for each row execute function public.study_comments_resolved_by();

-- K2: the asker posts her question on the paragraph with Claude's attempt
-- (the answer she got from "לשאול", at most 2,000 characters). Returns the
-- question's id. A member cannot set ask_attempt herself (no column grant),
-- and the attempt comes only through op "ask" (its share path checks the
-- answer's signature, the done line's HMAC, and calls with the server key;
-- review SEC-9); without it a member posts her question alone.
drop function if exists public.study_ask_to_group(uuid, int, int, text, text, text);
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
  end if;
  if g is null or not public.study_is_member(g)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  if p_part is null or p_anchor is null or p_part < 0 or p_anchor < 0
     or not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then
    raise exception 'bad parts';
  end if;
  if char_length(btrim(coalesce(p_question, ''))) not between 1 and 2000 then raise exception 'too long'; end if;
  insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body, author_id)
  values (p_lecture, p_part, p_anchor, left(coalesce(p_quote, ''), 200), 'question', btrim(p_question), auth.uid())
  returning id into qid;
  if char_length(btrim(coalesce(p_attempt, ''))) > 0 then
    insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body, parent_id, author_id, ask_attempt)
    values (p_lecture, p_part, p_anchor, left(coalesce(p_quote, ''), 200), 'comment', left(btrim(p_attempt), 2000), qid, auth.uid(), true);
  end if;
  return qid;
end;
$$;

-- X2: the optional check of a proposed correction against the slide it cites
-- (op fix_check, server key). Columns on the meeting addendum's proposals.
do $$
begin
  if to_regclass('public.study_edit_proposals') is not null then
    alter table public.study_edit_proposals
      add column if not exists check_ok   boolean,
      add column if not exists check_note text check (char_length(check_note) <= 200),
      add column if not exists checked_at timestamptz;
  end if;
end $$;
create or replace function public.study_edit_proposal_checked(p_proposal uuid, p_ok boolean, p_note text, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not study_private.is_worker(p_key) or auth.uid() is null then raise exception 'forbidden'; end if;
  if to_regclass('public.study_edit_proposals') is null then raise exception 'not pending'; end if;
  execute 'update public.study_edit_proposals p set check_ok = $2, check_note = left(btrim(coalesce($3, '''')), 200), checked_at = now()
            where p.id = $1 and p.state = ''pending'' and public.study_is_member(public.study_lecture_group(p.lecture_id))'
    using p_proposal, p_ok, p_note;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not pending'; end if;
end;
$$;

revoke all on function public.study_ask_to_group(uuid, int, int, text, text, text, text),
  public.study_edit_proposal_checked(uuid, boolean, text, text) from public, anon;
grant execute on function public.study_ask_to_group(uuid, int, int, text, text, text, text),
  public.study_edit_proposal_checked(uuid, boolean, text, text) to authenticated;

insert into study_private.schema_sections (section, version) values ('K', 2)
on conflict (section) do update set version = excluded.version, loaded_at = now();

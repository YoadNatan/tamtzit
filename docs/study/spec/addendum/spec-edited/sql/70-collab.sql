-- ════════════════════════════════════════════════════════════════════════
--  SECTION K · CORRECTIONS, SHARED ANSWERS AND MEMORY AIDS   (owned by package K)
--  design-collab.md §2.3. Replaces section F's study_corrections_of() hook with the real one.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  COLLAB additions to supabase/study-schema.sql (design-collab.md §2).
--  Appended after the platform block (design-platform.sql), which brings the
--  spend ledger study_usage. Safe to run again: add-if-missing,
--  create-or-replace, drop-then-create.
--
--  1. Corrections: a member fixes the text of one paragraph of a summary.
--     The group sees the new text at once, who changed it, every
--     paragraph's history, and can undo. An edit replaces ONE block with one
--     block of the same kind, so every paragraph anchor (comments, the
--     reader's place, recording notes) keeps pointing where it did.
--  2. Comments gain two kinds: 'mnemonic' (a memory aid shared from a
--     paragraph's "אסוציאציה" tab) and 'answer' (an answer from "לשאול"
--     shared with the group). Both are top-level, never replies.
--  3. A member's own use of "לשאול" and "אסוציאציה" today, for the daily
--     limits. The ledger itself stays unreadable (platform §2).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1a. Versions of a part ──
-- rev: +1 whenever the part's text changes (a correction, or the writer).
-- gen: +1 whenever the part starts being written (again). Corrections made
--      to an earlier generation no longer apply to the text; they stay in
--      the history and are handed to the writer (study_part_corrections).
alter table public.study_sections
  add column if not exists rev int not null default 0,
  add column if not exists gen int not null default 0;

create or replace function public.study_sections_versions()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 0;
    new.gen := 0;
  else
    -- Whatever a client sends, the counters move only here, and only forward.
    new.rev := old.rev + case when new.markdown is distinct from old.markdown then 1 else 0 end;
    new.gen := old.gen + case when new.status = 'writing' and old.status is distinct from 'writing' then 1 else 0 end;
  end if;
  return new;
end;
$$;
drop trigger if exists study_sections_versions on public.study_sections;
create trigger study_sections_versions before insert or update on public.study_sections
  for each row execute function public.study_sections_versions();

-- ── 1b. The block rules (the same rules as shared/study/blocks.ts) ──
-- What every phone renders: an en dash between digits becomes a hyphen and
-- direction marks go (SummaryView's tidy(); JS \s and \d spelled out).
create or replace function public.study_tidy(t text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(t,
             '([0-9])[\t\n\u000b\f\r    -     　﻿]*–[\t\n\u000b\f\r    -     　﻿]*([0-9])',
             '\1-\2', 'g'),
           '[‎‏‪-‮⁦-⁩]', '', 'g')
$$;

-- The kind of a block, from its first characters.
create or replace function public.study_block_kind(t text)
returns text language sql immutable set search_path = public as $$
  select case
    when t is null or t = '' then null
    when t ~ '^ {0,3}#{1,6}([ \t]|$)' then 'heading'
    when t ~ '^ {0,3}>' then 'box'
    when t ~ '^ {0,3}\|' then 'table'
    when t ~ '^ {0,3}([-*+]|[0-9]{1,9}[.)])([ \t]|$)' then 'item'
    when t ~ '^!\[[^\[\]\n`<\\]*\]\(fig:[0-9]+-[0-9]+\)$' then 'figure'
    else 'paragraph'
  end
$$;

-- Cells of a table row with leading and trailing pipes (\| is not a pipe).
create or replace function public.study_pipe_cells(line text)
returns int language sql immutable set search_path = public as $$
  select greatest(0, array_length(string_to_array(replace(btrim(line), '\|', ''), '|'), 1) - 2)
$$;

-- null when replacing p_before by p_after keeps one block of the same kind
-- (so no anchor moves); otherwise why not.
create or replace function public.study_block_edit_problem(p_before text, p_after text)
returns text language plpgsql immutable set search_path = public as $$
declare
  k  text := public.study_block_kind(p_before);
  bl text[];
  al text[];
  l  text;
begin
  if k is null or p_after is null then return 'bad block'; end if;
  if p_after = p_before then return 'no change'; end if;
  if char_length(p_after) > 8000 or char_length(p_before) > 8000 then return 'too long'; end if;
  if position(E'\r' in p_after) > 0 or p_before ~ '(^|\n)[ \t]*(\n|$)' or p_after ~ '(^|\n)[ \t]*(\n|$)' then
    return 'bad block';
  end if;
  if public.study_block_kind(p_after) is distinct from k then return 'bad block'; end if;
  bl := string_to_array(p_before, E'\n');
  al := string_to_array(p_after, E'\n');
  if k in ('heading', 'paragraph', 'item', 'figure') and (array_length(bl, 1) <> 1 or array_length(al, 1) <> 1) then
    return 'bad block';
  end if;
  if k = 'heading' then
    if substring(p_before from '^ {0,3}(#{1,6})') is distinct from substring(p_after from '^ {0,3}(#{1,6})')
       or p_after !~ '^ {0,3}#{1,6}[ \t]+[^ \t#]' then
      return 'bad block';
    end if;
  elsif k = 'item' then
    if substring(p_before from '^ {0,3}([-*+]|[0-9]{1,9}[.)])[ \t]') is distinct from substring(p_after from '^ {0,3}([-*+]|[0-9]{1,9}[.)])[ \t]')
       or p_after !~ '^ {0,3}([-*+]|[0-9]{1,9}[.)])[ \t]+[^ \t]' then
      return 'bad block';
    end if;
  elsif k = 'figure' then
    if substring(p_before from '\((fig:[0-9]+-[0-9]+)\)$') is distinct from substring(p_after from '\((fig:[0-9]+-[0-9]+)\)$') then
      return 'bad block';
    end if;
  elsif k = 'paragraph' then
    if p_after ~ '^( {0,3}(#{1,6}([ \t]|$)|>|[-*+]([ \t]|$)|[0-9]{1,9}[.)]([ \t]|$)|\||```|~~~|<|\[[^]]*\]:|!\[)|( {4}|\t))'
       or p_after ~ '^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$' then
      return 'bad block';
    end if;
  elsif k = 'box' then
    foreach l in array bl || al loop
      if l !~ '^ {0,3}>' then return 'bad block'; end if;
    end loop;
    if substring(p_before from '^ {0,3}> ?(\*\*[^*\n]{1,60}:\*\*)') is distinct from substring(p_after from '^ {0,3}> ?(\*\*[^*\n]{1,60}:\*\*)') then
      return 'bad block';
    end if;
  elsif k = 'table' then
    foreach l in array bl || al loop
      if l !~ '^ {0,3}\|' or l !~ '\|[ \t]*$' then return 'bad block'; end if;
    end loop;
    if array_length(bl, 1) <> array_length(al, 1) or array_length(bl, 1) < 2 or bl[2] <> al[2] then
      return 'bad block';
    end if;
    foreach l in array al loop
      if position('\' in replace(l, '\|', '')) > 0 then return 'bad block'; end if;
    end loop;
    if public.study_pipe_cells(al[1]) <> public.study_pipe_cells(al[2]) then return 'bad block'; end if;
  end if;
  -- No new links in the trusted reader (review M9): a URL, "www." or a
  -- Markdown link that the block did not already have. (Structure comes first:
  -- a link definition line is a 'bad block'.)
  if exists (select 1 from regexp_matches(p_after, '(https?://[^\s)\]]+|www\.[^\s)\]]+|\]\()', 'gi') m
              where position(lower(m[1]) in lower(p_before)) = 0) then
    return 'link';
  end if;
  return null;
end;
$$;

-- 1-based positions where p_blk stands on whole lines of p_md.
create or replace function public.study_block_positions(p_md text, p_blk text)
returns int[] language plpgsql immutable set search_path = public as $$
declare
  out_ int[] := '{}';
  len  int := char_length(p_blk);
  tot  int := char_length(p_md);
  from_ int := 1;
  hit  int;
  pos  int;
begin
  if len = 0 or p_md is null then return out_; end if;
  loop
    hit := strpos(substr(p_md, from_), p_blk);
    exit when hit = 0;
    pos := from_ + hit - 1;
    if (pos = 1 or substr(p_md, pos - 1, 1) = E'\n') and (pos + len - 1 = tot or substr(p_md, pos + len, 1) = E'\n') then
      out_ := out_ || pos;
    end if;
    from_ := pos + 1;
  end loop;
  return out_;
end;
$$;

-- ── 1c. The history ──
-- One row per correction (an undo is a correction too, with undo_of set).
-- Written only by study_edit_block(); members read it; nobody changes it.
create table if not exists public.study_edits (
  id          uuid        primary key default gen_random_uuid(),
  lecture_id  uuid        not null,
  part_idx    int         not null,
  anchor      int         not null check (anchor between 0 and 9999),
  gen         int         not null check (gen >= 0),
  rev         int         not null check (rev >= 1),          -- the part's rev this correction produced
  kind        text        not null check (kind in ('heading', 'paragraph', 'item', 'box', 'table', 'figure')),
  before_text text        not null check (char_length(before_text) between 1 and 8000),
  after_text  text        not null check (char_length(after_text) between 1 and 8000),
  note        text        not null default '' check (char_length(note) <= 300),
  undo_of     uuid        references public.study_edits (id) on delete set null,
  author_id   uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (lecture_id, part_idx) references public.study_sections (lecture_id, idx) on delete cascade
);
create index if not exists study_edits_block on public.study_edits (lecture_id, part_idx, gen, anchor, rev);

alter table public.study_edits enable row level security;
revoke all on public.study_edits from anon, authenticated;
grant select on public.study_edits to authenticated;
drop policy if exists "study edits read" on public.study_edits;
create policy "study edits read" on public.study_edits
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));

-- ── 1d. The one way to correct a part ──
-- p_before: the block's text as the phone parsed it from the part (tidy).
-- p_base_rev / p_base_gen: the part's rev and gen when the editor opened.
-- p_occurrence: which whole-line occurrence of p_before (1 = first), for the
-- rare part where two blocks read the same.
-- Same rev: the block is replaced where the phone saw it. Another rev of the
-- same generation (someone corrected ANOTHER paragraph meanwhile): replaced
-- if p_before still appears exactly once ("merged"). Otherwise 'edit
-- conflict': this paragraph changed meanwhile, the phone shows both.
create or replace function public.study_edit_block(
  p_lecture uuid, p_part int, p_anchor int, p_before text, p_after text,
  p_base_rev int, p_base_gen int, p_occurrence int default 1, p_note text default '', p_undo_of uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s        public.study_sections;
  v_after  text := public.study_tidy(coalesce(p_after, ''));
  v_note   text := btrim(coalesce(p_note, ''));
  v_why    text;
  v_md     text;
  v_pos    int[];
  v_at     int;
  v_merged boolean := false;
  v_rev    int;
  v_id     uuid;
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
  if p_undo_of is not null and not exists (
       select 1 from public.study_edits e
        where e.id = p_undo_of and e.lecture_id = p_lecture and e.part_idx = p_part
          and e.gen = s.gen and e.anchor = p_anchor) then
    raise exception 'bad undo';
  end if;
  v_md := public.study_tidy(s.markdown);
  v_pos := public.study_block_positions(v_md, p_before);
  if s.rev = p_base_rev then
    if p_occurrence is null or p_occurrence < 1 or p_occurrence > coalesce(array_length(v_pos, 1), 0) then
      raise exception 'edit conflict';
    end if;
    v_at := v_pos[p_occurrence];
  elsif coalesce(array_length(v_pos, 1), 0) = 1 then
    v_at := v_pos[1];
    v_merged := true;
  else
    raise exception 'edit conflict';
  end if;
  update public.study_sections x
     set markdown = overlay(v_md placing v_after from v_at for char_length(p_before)),
         -- the part's own heading is also its title (table of contents, placeholders, prompts)
         title = case when v_at = 1 and p_before ~ '^## ' then left(btrim(regexp_replace(v_after, '^##[ \t]+', '')), 120) else x.title end,
         updated_at = now()
   where x.lecture_id = p_lecture and x.idx = p_part
  returning x.rev into v_rev;
  insert into public.study_edits (lecture_id, part_idx, anchor, gen, rev, kind, before_text, after_text, note, undo_of)
  values (p_lecture, p_part, p_anchor, s.gen, v_rev, public.study_block_kind(p_before), p_before, v_after, v_note, p_undo_of)
  returning id into v_id;
  return jsonb_build_object('edit_id', v_id, 'rev', v_rev, 'gen', s.gen, 'merged', v_merged);
end;
$$;

-- ── 1e. Corrections that a rewrite must keep ──
-- What the group corrected in the latest EARLIER generation of a part, net
-- per paragraph (its first text before, its last text after; a paragraph
-- that was put back drops out). Internal; the platform's study_writing_input
-- can embed it for the server writer.
create or replace function public.study_corrections_of(p_lecture uuid, p_part int)
returns jsonb language sql stable security definer set search_path = public as $$
  with cur as (
    select s.gen from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part
  ), g as (
    select max(e.gen) as gen from public.study_edits e, cur
     where e.lecture_id = p_lecture and e.part_idx = p_part and e.gen < cur.gen
  ), net as (
    select e.anchor,
           (array_agg(e.before_text order by e.rev))[1] as before_text,
           (array_agg(e.after_text order by e.rev desc))[1] as after_text,
           coalesce(string_agg(nullif(e.note, ''), ' · ' order by e.rev), '') as note
      from public.study_edits e, g
     where e.lecture_id = p_lecture and e.part_idx = p_part and e.gen = g.gen
     group by e.anchor
  )
  select coalesce(jsonb_agg(jsonb_build_object('before', left(n.before_text, 1500), 'after', left(n.after_text, 1500),
                                               'note', left(n.note, 300)) order by n.anchor), '[]'::jsonb)
    from (select * from net where before_text <> after_text order by anchor limit 20) n
$$;

-- The device writer reads them through study_part_corrections() (section F).

-- ── 2. Comments: shared memory aids and shared answers ──
-- (For new installs, also change the create table above: the kind check and
-- the body check below replace the inline ones.)
alter table public.study_comments drop constraint if exists study_comments_kind_check;
alter table public.study_comments add constraint study_comments_kind_check
  check (kind in ('comment', 'question', 'mnemonic', 'answer'));
alter table public.study_comments drop constraint if exists study_comments_body_check;
alter table public.study_comments add constraint study_comments_body_check
  check (length(btrim(body)) between 1 and case when kind = 'answer' then 4000 else 2000 end);
-- A reply is always a plain comment. "not valid": rows from before are not re-checked.
alter table public.study_comments drop constraint if exists study_comments_reply_kind;
alter table public.study_comments add constraint study_comments_reply_kind
  check (parent_id is null or kind = 'comment') not valid;

-- ── 3. My own use today (Israel time), for the daily limits ──
-- Counts only the caller's rows; the ledger stays unreadable. Needs the
-- platform's study_usage (plpgsql, so this file loads in any order).
create or replace function public.study_my_uses_today(p_group uuid, p_kind text, p_ref text default null)
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then
    raise exception 'forbidden';
  end if;
  return (select count(*)::int from public.study_usage u
           where u.group_id = p_group and u.user_id = auth.uid() and u.kind = p_kind
             and (p_ref is null or u.ref = p_ref)
             and u.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'));
end;
$$;

-- ── Privileges ──
revoke all on function public.study_sections_versions() from public, anon, authenticated;
revoke all on function public.study_tidy(text) from public, anon, authenticated;
revoke all on function public.study_block_kind(text) from public, anon, authenticated;
revoke all on function public.study_pipe_cells(text) from public, anon, authenticated;
revoke all on function public.study_block_edit_problem(text, text) from public, anon, authenticated;
revoke all on function public.study_block_positions(text, text) from public, anon, authenticated;
revoke all on function public.study_corrections_of(uuid, int) from public, anon, authenticated;
revoke all on function public.study_edit_block(uuid, int, int, text, text, int, int, int, text, uuid) from public, anon;
revoke all on function public.study_my_uses_today(uuid, text, text) from public, anon;
grant execute on function public.study_edit_block(uuid, int, int, text, text, int, int, int, text, uuid) to authenticated;
grant execute on function public.study_my_uses_today(uuid, text, text) to authenticated;

-- ── Realtime: a correction reaches every open phone (the part's text via
--    study_sections, already published; the history and marks via this) ──
do $$
begin
  execute 'alter publication supabase_realtime add table public.study_edits';
exception when duplicate_object then
  null;
end $$;

insert into study_private.schema_sections (section, version) values ('K', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


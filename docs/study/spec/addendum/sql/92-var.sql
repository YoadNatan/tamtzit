-- ════════════════════════════════════════════════════════════════════════
--  SECTION V · DISPUTES, VAR, THE LECTURE'S LOG, THE SPREAD   (package V;
--  meeting addendum §6). After sections C, K (and K's end). Re-runnable.
--
--  R3  "כרטיס צהוב": two claims about one paragraph, each one line with
--      its slides; the others back a side anonymously (private rows; the
--      counts by side are shown from 3 backers, never names).
--  R4  "VAR": op 'var' of /api/study/ai (server key) stores Claude's
--      verdict, which separates what the slides say from interpretation;
--      the group accepts it ("לקבל": a "פסיקת VAR" box on the paragraph and
--      a trap card for everyone) or overrides it ("בהרצאה נאמר אחרת").
--  R5  "יומן התיקונים": a lecture's corrections (source, approver, undo),
--      verdicts, and "כרטיס צהוב לשקף" entries for the deck's own slips.
--  R2  the spread: every applied correction marks the questions and cards
--      on its paragraph (they leave practice and review until "עדיין נכון"
--      or a fix), and gives one private "עדכון" row to each member who had
--      already reviewed those cards or answered those questions. An undo
--      takes back its marks and the updates nobody saw.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.study_disputes (
  id            uuid        primary key default gen_random_uuid(),
  lecture_id    uuid        not null,
  part_idx      int         not null,
  anchor        int         not null check (anchor between 0 and 9999),
  quote         text        not null default '' check (char_length(quote) <= 200),
  proposal_id   uuid        references public.study_edit_proposals (id) on delete set null,
  claim_a       text        not null check (char_length(btrim(claim_a)) between 5 and 240),
  slides_a      int[]       not null check (cardinality(slides_a) between 1 and 4),
  author_a      uuid        default auth.uid() references auth.users (id) on delete set null,
  claim_b       text        check (char_length(btrim(claim_b)) between 5 and 240),
  slides_b      int[]       not null default '{}' check (cardinality(slides_b) <= 4),
  author_b      uuid        references auth.users (id) on delete set null,
  state         text        not null default 'open' check (state in ('open', 'judged', 'accepted', 'overridden', 'closed')),
  verdict       jsonb,
  verdict_model text        check (char_length(verdict_model) <= 80),
  judged_at     timestamptz,
  decided_by    uuid        references auth.users (id) on delete set null,
  decided_at    timestamptz,
  decision_note text        not null default '' check (char_length(decision_note) <= 200),
  trap_card     uuid,
  judging_until timestamptz,                                -- op 'var' holds the dispute (review SEC-15)
  var_asked_at  timestamptz,                                -- VAR asked: backing closes (review SEC-10)
  version       int         not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (lecture_id, part_idx) references public.study_sections (lecture_id, idx) on delete cascade
);
alter table public.study_disputes drop column if exists backs_n;              -- review SEC-10: not published
alter table public.study_disputes add column if not exists judging_until timestamptz;
alter table public.study_disputes add column if not exists var_asked_at timestamptz;
create unique index if not exists study_disputes_open on public.study_disputes (lecture_id, part_idx, anchor)
  where state in ('open', 'judged');
create index if not exists study_disputes_lecture on public.study_disputes (lecture_id, created_at desc);

-- Backing a side: private (the owner reads her own; written by a function).
create table if not exists public.study_dispute_backs (
  dispute_id uuid        not null references public.study_disputes (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  side       text        not null check (side in ('a', 'b')),
  created_at timestamptz not null default now(),
  primary key (dispute_id, user_id)
);

-- "כרטיס צהוב לשקף": a slip in the deck itself (shared, published).
create table if not exists public.study_slide_flags (
  id         uuid        primary key default gen_random_uuid(),
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  slides     int[]       not null check (cardinality(slides) between 1 and 4),
  note       text        not null check (char_length(btrim(note)) between 5 and 300),
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid        references auth.users (id) on delete set null
);
create index if not exists study_slide_flags_lecture on public.study_slide_flags (lecture_id, created_at desc);

-- "עדכון": a correction reached someone who had studied the old line (private).
create table if not exists public.study_updates (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  edit_id    uuid        not null references public.study_edits (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null,
  anchor     int         not null,
  reason     text        not null check (reason in ('card', 'question')),
  reason_at  timestamptz not null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz,
  unique (user_id, edit_id)
);
create index if not exists study_updates_mine on public.study_updates (user_id, seen_at, created_at desc);

create or replace function public.study_dispute_group(p_dispute uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select public.study_lecture_group(lecture_id) from public.study_disputes where id = p_dispute;
$$;

-- The slides of a lecture, as numbers.
create or replace function study_private.lecture_slides(p_lecture uuid)
returns int[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg((sl ->> 'n')::int), '{}') from public.study_lectures l, jsonb_array_elements(l.slides) sl where l.id = p_lecture
$$;

-- A verdict as op 'var' stores it (checked again here: the database trusts no one on its shape).
--   { certainty: 'slide' | 'interpretation' | 'unclear', summary (≤ 300),
--     on_slides: [{text (≤ 300), slides [n]}] (≤ 4), interpretation: [{text, slides}] (≤ 3),
--     listen: boolean, trap: {front (≤ 400), back (≤ 300), slides [n]} | null }
create or replace function study_private.verdict_ok(v jsonb, p_slides int[])
returns boolean language plpgsql stable set search_path = public as $$
declare
  e jsonb;
  k text;
begin
  if v is null or jsonb_typeof(v) <> 'object' then return false; end if;
  if coalesce(v ->> 'certainty', '') not in ('slide', 'interpretation', 'unclear') then return false; end if;
  if jsonb_typeof(v -> 'summary') <> 'string' or char_length(v ->> 'summary') not between 5 and 300 then return false; end if;
  if jsonb_typeof(v -> 'listen') <> 'boolean' then return false; end if;
  foreach k in array array['on_slides', 'interpretation'] loop
    if jsonb_typeof(v -> k) <> 'array' or jsonb_array_length(v -> k) > (case when k = 'on_slides' then 4 else 3 end) then return false; end if;
    for e in select x from jsonb_array_elements(v -> k) x loop
      if jsonb_typeof(e -> 'text') <> 'string' or char_length(e ->> 'text') not between 3 and 300 then return false; end if;
      if jsonb_typeof(e -> 'slides') <> 'array' or jsonb_array_length(e -> 'slides') > 6
         or not (array(select (jsonb_array_elements_text(e -> 'slides'))::int) <@ p_slides) then
        return false;
      end if;
    end loop;
  end loop;
  if jsonb_typeof(v -> 'trap') = 'object' then
    if char_length(coalesce(v -> 'trap' ->> 'front', '')) not between 5 and 400
       or char_length(coalesce(v -> 'trap' ->> 'back', '')) not between 1 and 300
       or jsonb_typeof(v -> 'trap' -> 'slides') <> 'array'
       or not (array(select (jsonb_array_elements_text(v -> 'trap' -> 'slides'))::int) <@ p_slides) then
      return false;
    end if;
  elsif v ? 'trap' and jsonb_typeof(v -> 'trap') <> 'null' then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function study_private.lecture_slides(uuid), study_private.verdict_ok(jsonb, int[]) from public;

-- "לא מסכימים: כרטיס צהוב" (from a pending correction, which waits) or from
-- a paragraph. The opener's claim is side a. Errors: 'forbidden',
-- 'bad claim', 'bad source', 'part not found', 'dispute open'.
create or replace function public.study_dispute_open(p_lecture uuid, p_part int, p_anchor int, p_quote text, p_claim text,
  p_slides int[], p_proposal uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then raise exception 'forbidden'; end if;
  if char_length(btrim(coalesce(p_claim, ''))) not between 5 and 240 then raise exception 'bad claim'; end if;
  if cardinality(coalesce(p_slides, '{}')) not between 1 and 4 or not (p_slides <@ study_private.lecture_slides(p_lecture)) then
    raise exception 'bad source';
  end if;
  if p_anchor is null or p_anchor not between 0 and 9999
     or not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then
    raise exception 'part not found';
  end if;
  if exists (select 1 from public.study_disputes d where d.lecture_id = p_lecture and d.part_idx = p_part and d.anchor = p_anchor
                                                     and d.state in ('open', 'judged')) then
    raise exception 'dispute open';
  end if;
  if p_proposal is not null then
    update public.study_edit_proposals x set state = 'disputed', updated_at = now()
     where x.id = p_proposal and x.lecture_id = p_lecture and x.part_idx = p_part and x.anchor = p_anchor and x.state = 'pending';
    if not found then raise exception 'not pending'; end if;
  end if;
  insert into public.study_disputes (lecture_id, part_idx, anchor, quote, proposal_id, claim_a, slides_a, author_a)
  values (p_lecture, p_part, p_anchor, left(coalesce(p_quote, ''), 200), p_proposal, btrim(p_claim), p_slides, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The other side's line (any member but side a's author, once), or an
-- author's own line again before VAR. Errors: 'dispute not found',
-- 'sides taken', 'bad claim', 'bad source', 'not open'.
create or replace function public.study_dispute_claim(p_dispute uuid, p_claim text, p_slides int[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'open' then raise exception 'not open'; end if;
  if char_length(btrim(coalesce(p_claim, ''))) not between 5 and 240 then raise exception 'bad claim'; end if;
  if cardinality(coalesce(p_slides, '{}')) not between 1 and 4 or not (p_slides <@ study_private.lecture_slides(d.lecture_id)) then
    raise exception 'bad source';
  end if;
  if d.author_a = auth.uid() then
    update public.study_disputes x set claim_a = btrim(p_claim), slides_a = p_slides, version = x.version + 1, updated_at = now() where x.id = p_dispute;
  elsif d.author_b is null or d.author_b = auth.uid() then
    delete from public.study_dispute_backs b where b.dispute_id = p_dispute and b.user_id = auth.uid();
    update public.study_disputes x
       set claim_b = btrim(p_claim), slides_b = p_slides, author_b = auth.uid(),
           version = x.version + 1, updated_at = now()
     where x.id = p_dispute;
  else
    raise exception 'sides taken';
  end if;
end;
$$;

-- "עם מי הצדק? גיבוי בלי שמות": back side a or b (null: take it back).
-- The sides' authors do not back. Errors: 'dispute not found', 'a side
-- cannot back', 'not open'.
create or replace function public.study_dispute_back(p_dispute uuid, p_side text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'open' or d.var_asked_at is not null then raise exception 'not open'; end if;   -- review SEC-10
  if auth.uid() in (d.author_a, d.author_b) then raise exception 'a side cannot back'; end if;
  if p_side is null then
    delete from public.study_dispute_backs b where b.dispute_id = p_dispute and b.user_id = auth.uid();
  elsif p_side in ('a', 'b') then
    insert into public.study_dispute_backs (dispute_id, user_id, side) values (p_dispute, auth.uid(), p_side)
    on conflict (dispute_id, user_id) do update set side = excluded.side, created_at = now();
  else
    raise exception 'bad side';
  end if;
  -- review SEC-10: the shared row does not change on a back (no count, no version)
end;
$$;

-- A dispute as the caller may see it: the claims with names (what one
-- publishes carries the name), how many back the sides, her own backing,
-- the verdict. The split by side shows once backing has closed (VAR asked
-- or the card decided), from 3 backers other than the caller (review
-- SEC-10: one's own back and un-back can no longer read the others').
create or replace function public.study_dispute_state(p_dispute uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d  public.study_disputes;
  na int;
  nb int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  select count(*) filter (where b.side = 'a'), count(*) filter (where b.side = 'b') into na, nb
    from public.study_dispute_backs b where b.dispute_id = p_dispute;
  return jsonb_build_object(
    'id', d.id, 'lecture_id', d.lecture_id, 'part', d.part_idx, 'anchor', d.anchor, 'quote', d.quote, 'state', d.state,
    'proposal_id', d.proposal_id,
    'a', jsonb_build_object('claim', d.claim_a, 'slides', to_jsonb(d.slides_a), 'author_id', d.author_a,
                            'name', (select m.name from public.study_members m where m.group_id = public.study_lecture_group(d.lecture_id) and m.user_id = d.author_a)),
    'b', case when d.claim_b is null then null else jsonb_build_object('claim', d.claim_b, 'slides', to_jsonb(d.slides_b), 'author_id', d.author_b,
                            'name', (select m.name from public.study_members m where m.group_id = public.study_lecture_group(d.lecture_id) and m.user_id = d.author_b)) end,
    'backs', case when (d.state <> 'open' or d.var_asked_at is not null)
                       and na + nb - (select count(*) from public.study_dispute_backs b
                                       where b.dispute_id = p_dispute and b.user_id = auth.uid()) >= 3
                  then jsonb_build_object('a', na, 'b', nb) end,
    'backing_open', d.state = 'open' and d.var_asked_at is null,
    'backers', na + nb,
    'mine', (select b.side from public.study_dispute_backs b where b.dispute_id = p_dispute and b.user_id = auth.uid()),
    'verdict', d.verdict, 'judged_at', d.judged_at,
    'decided_by', (select m.name from public.study_members m where m.group_id = public.study_lecture_group(d.lecture_id) and m.user_id = d.decided_by),
    'decision_note', d.decision_note, 'trap_card', d.trap_card);
end;
$$;

-- op 'var' first takes the dispute (server key, with the member's token)
-- for 3 minutes, before it reserves the budget: a second phone gets 'busy'
-- and pays nothing (review SEC-15). Errors: 'forbidden', 'dispute not
-- found', 'not ready', 'busy'.
create or replace function public.study_dispute_judge_begin(p_dispute uuid, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'open' or d.claim_b is null then raise exception 'not ready'; end if;
  if d.judging_until > now() then raise exception 'busy'; end if;
  update public.study_disputes x
     set judging_until = now() + interval '3 minutes', var_asked_at = coalesce(x.var_asked_at, now()),
         version = x.version + 1, updated_at = now()
   where x.id = p_dispute;
end;
$$;

-- op 'var' saves Claude's verdict (server key, with the member's token).
-- Errors: 'forbidden', 'dispute not found', 'not ready' (both sides are
-- needed, and only once), 'bad verdict'.
create or replace function public.study_dispute_verdict(p_dispute uuid, p_verdict jsonb, p_model text, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'open' or d.claim_b is null or d.judging_until is null then raise exception 'not ready'; end if;   -- review SEC-15
  if not study_private.verdict_ok(p_verdict, study_private.lecture_slides(d.lecture_id)) then raise exception 'bad verdict'; end if;
  update public.study_disputes x
     set verdict = p_verdict, verdict_model = left(p_model, 80), judged_at = now(), state = 'judged', judging_until = null,
         version = x.version + 1, updated_at = now()
   where x.id = p_dispute;
end;
$$;

-- "לקבל" (the box is pinned and the verdict's trap card joins everyone's
-- deck) or "בהרצאה נאמר אחרת" (with an optional line). Errors: 'dispute
-- not found', 'not judged', 'bad decision'.
create or replace function public.study_dispute_decide(p_dispute uuid, p_decision text, p_note text default '')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  d   public.study_disputes;
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'judged' then raise exception 'not judged'; end if;
  if coalesce(p_decision, '') not in ('accept', 'override') then raise exception 'bad decision'; end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'too long'; end if;
  if p_decision = 'accept' and jsonb_typeof(d.verdict -> 'trap') = 'object'
     and to_regprocedure('study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)') is not null then
    cid := study_private.trap_card(d.lecture_id, d.part_idx, d.anchor, d.quote,
             d.verdict -> 'trap' ->> 'front', d.verdict -> 'trap' ->> 'back', left(d.verdict ->> 'summary', 500),
             array(select (jsonb_array_elements_text(d.verdict -> 'trap' -> 'slides'))::int), 'd:' || d.id::text);
  end if;
  update public.study_disputes x
     set state = case when p_decision = 'accept' then 'accepted' else 'overridden' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = btrim(coalesce(p_note, '')), trap_card = cid,
         version = x.version + 1, updated_at = now()
   where x.id = p_dispute;
  -- a proposal that waited on the dispute is open again for approval
  update public.study_edit_proposals x set state = 'pending', updated_at = now()
   where x.id = d.proposal_id and x.state = 'disputed';
  return cid;
end;
$$;

-- The opener closes an open dispute ("ביטול הכרטיס הצהוב").
create or replace function public.study_dispute_close(p_dispute uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or d.author_a is distinct from auth.uid() or d.state <> 'open' then raise exception 'dispute not found'; end if;
  update public.study_disputes x set state = 'closed', version = x.version + 1, updated_at = now() where x.id = p_dispute;
  update public.study_edit_proposals x set state = 'pending', updated_at = now() where x.id = d.proposal_id and x.state = 'disputed';
end;
$$;

-- "כרטיס צהוב לשקף": a slip in the deck. Errors: 'forbidden', 'bad source', 'bad note'.
create or replace function public.study_slide_flag(p_lecture uuid, p_slides int[], p_note text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then raise exception 'forbidden'; end if;
  if cardinality(coalesce(p_slides, '{}')) not between 1 and 4 or not (p_slides <@ study_private.lecture_slides(p_lecture)) then
    raise exception 'bad source';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 300 then raise exception 'bad note'; end if;
  insert into public.study_slide_flags (lecture_id, slides, note) values (p_lecture, p_slides, btrim(p_note)) returning id into v_id;
  return v_id;
end;
$$;

-- One-tap undo of a slide flag (any member; the log keeps who), or putting it back.
create or replace function public.study_slide_flag_remove(p_flag uuid, p_remove boolean default true)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_slide_flags f
     set removed_at = case when p_remove then now() end, removed_by = case when p_remove then auth.uid() end
   where f.id = p_flag and coalesce(public.study_is_member(public.study_lecture_group(f.lecture_id)), false);
  if not found then raise exception 'flag not found'; end if;
end;
$$;

-- ── R2: the spread, from every applied correction ──
create or replace function public.study_edits_spread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.undo_of is not null then
    update public.study_questions q set stale_at = null, stale_edit = null where q.stale_edit = new.undo_of;
    update public.study_cards c set stale_at = null, stale_edit = null where c.stale_edit = new.undo_of;
    delete from public.study_updates u where u.edit_id = new.undo_of and u.seen_at is null;
    return null;
  end if;
  update public.study_questions q set stale_at = now(), stale_edit = new.id
   where q.lecture_id = new.lecture_id and q.part_idx = new.part_idx and q.anchor = new.anchor
     and (q.part_gen is null or q.part_gen = new.gen) and q.retired_at is null;
  update public.study_cards c set stale_at = now(), stale_edit = new.id
   where c.lecture_id = new.lecture_id and c.part_idx = new.part_idx and c.anchor = new.anchor
     and (c.part_gen is null or c.part_gen = new.gen) and c.deleted_at is null;
  insert into public.study_updates (user_id, edit_id, lecture_id, part_idx, anchor, reason, reason_at)
  select x.u, new.id, new.lecture_id, new.part_idx, new.anchor, x.reason, x.at
    from (select distinct on (y.u) y.u, y.reason, y.at
            from (select r.user_id as u, 'card' as reason, max(r.reviewed_at) as at
                    from public.study_card_reviews r join public.study_cards c on c.id = r.card_id
                   where c.stale_edit = new.id and r.reviewed_at < now()
                   group by r.user_id
                  union all
                  select a.user_id, 'question', max(a.answered_at)
                    from public.study_answers a join public.study_questions q on q.id = a.question_id
                   where q.stale_edit = new.id and a.answered_at < now()
                   group by a.user_id) y
           order by y.u, y.at desc) x
   where x.u is distinct from new.author_id and x.u is distinct from new.approved_by
  on conflict (user_id, edit_id) do nothing;
  return null;
end;
$$;
revoke all on function public.study_edits_spread() from public, anon, authenticated;
drop trigger if exists study_edits_spread on public.study_edits;
create trigger study_edits_spread after insert on public.study_edits
  for each row execute function public.study_edits_spread();

-- The caller's unseen "עדכון" rows: the old line, the new one, who
-- corrected, who approved, the source and why it reached her.
create or replace function public.study_my_updates(p_group uuid)
returns table (id uuid, edit_id uuid, lecture_id uuid, lecture_title text, part_idx int, anchor int, kind text,
               before_text text, after_text text, author text, approver text, aloud boolean,
               source_kind text, source_slides int[], source_at int, source_note text,
               reason text, reason_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.edit_id, u.lecture_id, l.title, u.part_idx, u.anchor, e.kind, e.before_text, e.after_text,
         (select m.name from public.study_members m where m.group_id = p_group and m.user_id = e.author_id),
         (select m.name from public.study_members m where m.group_id = p_group and m.user_id = e.approved_by),
         e.aloud, e.source_kind, e.source_slides, e.source_at, e.source_note, u.reason, u.reason_at, u.created_at
    from public.study_updates u
    join public.study_edits e on e.id = u.edit_id
    join public.study_lectures l on l.id = u.lecture_id and l.group_id = p_group and l.deleted_at is null
   where u.user_id = auth.uid() and u.seen_at is null and public.study_is_member(p_group)
   order by u.created_at;
$$;

create or replace function public.study_update_seen(p_update uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_updates u set seen_at = coalesce(u.seen_at, now()) where u.id = p_update and u.user_id = auth.uid();
  if not found then raise exception 'not found'; end if;
end;
$$;

-- "יומן התיקונים": a lecture's corrections, verdicts and slide flags, newest
-- first (at most 100). Error: 'lecture not found'.
create or replace function public.study_lecture_log(p_lecture uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g   uuid := public.study_lecture_group(p_lecture);
  out jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false) then raise exception 'lecture not found'; end if;
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into out
    from (select y.at, y.j from (
      select e.created_at as at, jsonb_build_object('kind', 'edit', 'id', e.id, 'at', e.created_at, 'part', e.part_idx, 'anchor', e.anchor,
               'block', e.kind, 'before', e.before_text, 'after', e.after_text, 'note', e.note, 'undo_of', e.undo_of,
               'undone', exists (select 1 from public.study_edits u where u.undo_of = e.id),
               'source_kind', e.source_kind, 'source_slides', to_jsonb(e.source_slides), 'source_at', e.source_at, 'source_note', e.source_note,
               'author', (select m.name from public.study_members m where m.group_id = g and m.user_id = e.author_id),
               'approver', (select m.name from public.study_members m where m.group_id = g and m.user_id = e.approved_by),
               'aloud', e.aloud) as j
        from public.study_edits e where e.lecture_id = p_lecture
      union all
      select d.created_at, jsonb_build_object('kind', 'verdict', 'id', d.id, 'at', coalesce(d.decided_at, d.judged_at, d.created_at),
               'part', d.part_idx, 'anchor', d.anchor, 'state', d.state, 'claim_a', d.claim_a, 'claim_b', d.claim_b,
               'slides', to_jsonb(d.slides_a || d.slides_b),
               'name_a', (select m.name from public.study_members m where m.group_id = g and m.user_id = d.author_a),
               'name_b', (select m.name from public.study_members m where m.group_id = g and m.user_id = d.author_b),
               'certainty', d.verdict ->> 'certainty', 'summary', d.verdict ->> 'summary',
               'decided_by', (select m.name from public.study_members m where m.group_id = g and m.user_id = d.decided_by),
               'decision_note', d.decision_note)
        from public.study_disputes d where d.lecture_id = p_lecture and d.state in ('judged', 'accepted', 'overridden')
      union all
      select f.created_at, jsonb_build_object('kind', 'slide', 'id', f.id, 'at', f.created_at, 'slides', to_jsonb(f.slides), 'note', f.note,
               'by', (select m.name from public.study_members m where m.group_id = g and m.user_id = f.created_by),
               'removed', f.removed_at is not null,
               'removed_by', (select m.name from public.study_members m where m.group_id = g and m.user_id = f.removed_by))
        from public.study_slide_flags f where f.lecture_id = p_lecture) y
      order by y.at desc limit 100) x;
  return out;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_disputes      enable row level security;
alter table public.study_dispute_backs enable row level security;
alter table public.study_slide_flags   enable row level security;
alter table public.study_updates       enable row level security;
drop policy if exists "study disputes read"     on public.study_disputes;
drop policy if exists "study dispute backs own" on public.study_dispute_backs;
drop policy if exists "study slide flags read"  on public.study_slide_flags;
drop policy if exists "study updates own"       on public.study_updates;
create policy "study disputes read" on public.study_disputes
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study dispute backs own" on public.study_dispute_backs
  for select using (user_id = auth.uid());
create policy "study slide flags read" on public.study_slide_flags
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study updates own" on public.study_updates
  for select using (user_id = auth.uid());
revoke all on public.study_disputes, public.study_dispute_backs, public.study_slide_flags, public.study_updates from anon, authenticated;
grant select on public.study_disputes, public.study_dispute_backs, public.study_slide_flags, public.study_updates to authenticated;

revoke all on function public.study_dispute_group(uuid), public.study_dispute_open(uuid, int, int, text, text, int[], uuid),
  public.study_dispute_claim(uuid, text, int[]), public.study_dispute_back(uuid, text), public.study_dispute_state(uuid),
  public.study_dispute_verdict(uuid, jsonb, text, text), public.study_dispute_judge_begin(uuid, text),
  public.study_dispute_decide(uuid, text, text), public.study_dispute_close(uuid),
  public.study_slide_flag(uuid, int[], text), public.study_slide_flag_remove(uuid, boolean),
  public.study_my_updates(uuid), public.study_update_seen(uuid), public.study_lecture_log(uuid)
  from public, anon;
-- study_dispute_verdict needs the server key inside; the grant only lets op 'var' reach it with the member's token.
grant execute on function public.study_dispute_group(uuid), public.study_dispute_open(uuid, int, int, text, text, int[], uuid),
  public.study_dispute_claim(uuid, text, int[]), public.study_dispute_back(uuid, text), public.study_dispute_state(uuid),
  public.study_dispute_verdict(uuid, jsonb, text, text), public.study_dispute_judge_begin(uuid, text),
  public.study_dispute_decide(uuid, text, text), public.study_dispute_close(uuid),
  public.study_slide_flag(uuid, int[], text), public.study_slide_flag_remove(uuid, boolean),
  public.study_my_updates(uuid), public.study_update_seen(uuid), public.study_lecture_log(uuid)
  to authenticated;

do $$
declare t text;
begin
  foreach t in array array['study_disputes', 'study_slide_flags'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

insert into study_private.schema_sections (section, version) values ('V', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

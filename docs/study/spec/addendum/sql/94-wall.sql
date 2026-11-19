-- ════════════════════════════════════════════════════════════════════════
--  SECTION J · THE ASSOCIATION WALL   (package J)
--  addendum "fun" (W1-W8, C4, K6, decision 10). After section U (the
--  wall's "דרושות" read study_pulse_cards). A card's paragraph (A1,
--  study_cards.anchor, the meeting addendum) is read through to_jsonb, so
--  the section loads and runs without it (no card then has a hint).
--  Re-runnable.
--
--  Who sees what
--  ─────────────
--  The wall is the group's: every entry, its fact and slides, its vote
--  totals, its author's name when posted by name, a credit once the credited
--  member said yes, and who marked it "לא מדויק". Private to each member:
--  which entries are theirs (an entry posted without a name keeps its author
--  only here, for editing and deleting: decision 10), their votes, their
--  pins ("שלי") and the credit requests addressed to them. Claude's drafts
--  ("תנו לי 3") are saved once per paragraph for everyone and written only
--  with the server key; nothing reaches the wall without a member posting
--  it. The paragraph's winner (top votes, checked once against the
--  paragraph, not marked "לא מדויק") rides on everyone's cards.
--  Realtime: study_aids only (its own uuid key; no author column).
-- ════════════════════════════════════════════════════════════════════════

-- ── J1. Claude's drafts for a paragraph: three techniques, one deciding fact
--  (the drafts that passed the op's checks: 1 to 3, one per technique).
--  src_hash = sha256 of the paragraph's text as written then, so a corrected
--  paragraph may get new drafts; the same text never pays twice.
create table if not exists public.study_aid_drafts (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx >= 0),
  anchor     int         not null check (anchor between 0 and 9999),
  src_hash   text        not null check (src_hash ~ '^[0-9a-f]{64}$'),
  fact       text        not null check (char_length(btrim(fact)) between 3 and 300),
  slides     int[]       not null default '{}' check (cardinality(slides) <= 6),
  drafts     jsonb       not null check (jsonb_typeof(drafts) = 'array' and jsonb_array_length(drafts) between 1 and 3),
  model      text        check (char_length(model) <= 80),
  created_at timestamptz not null default now(),
  unique (lecture_id, part_idx, anchor, src_hash)
);

-- ── J2. The wall's entries.
--   kind: line (משלי) · remix (of an entry or a draft) · sketch, meme (a
--   photo, with its caption as body) · moment (לנעוץ רגע, during a reading)
--   · draft (a draft posted as it is)
--   fact: "על מה זה?", required: the fact and its slide, so the entry means
--   something to whoever was not there.
--   named_by: the author, only when posted by name. Anonymous: null here,
--   the author only in study_aid_authors (owner-only).
create table if not exists public.study_aids (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  lecture_id  uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx    int         not null check (part_idx >= 0),
  anchor      int         not null check (anchor between 0 and 9999),
  quote       text        not null default '' check (char_length(quote) <= 200),
  drug        text        not null default '' check (char_length(drug) <= 60),
  kind        text        not null check (kind in ('line', 'remix', 'sketch', 'meme', 'moment', 'draft')),
  body        text        not null check (char_length(btrim(body)) between 3 and 500),
  fact        text        not null check (char_length(btrim(fact)) between 3 and 300),
  slides      int[]       not null default '{}' check (cardinality(slides) <= 6),
  photo       text        check (photo is null or photo ~ '^[0-9a-f-]{36}/wall/[0-9a-f-]{36}\.(jpg|webp)$'),
  figure      text        check (figure is null or figure ~ '^fig:[0-9]{1,4}-[0-9]{1,3}$'),
  remix_of    uuid        references public.study_aids (id) on delete set null,
  draft_id    uuid        references public.study_aid_drafts (id) on delete set null,
  draft_no    smallint    check (draft_no between 1 and 3),
  named_by    uuid        references auth.users (id) on delete set null,
  credit_id   uuid        references auth.users (id) on delete set null,   -- shown only after that member said yes
  funny_n     int         not null default 0 check (funny_n >= 0),
  stuck_n     int         not null default 0 check (stuck_n >= 0),
  flag        text        check (flag in ('inaccurate', 'not_ok')),          -- "לא מדויק" · "לא מתאים"
  flagged_by  uuid        references auth.users (id) on delete set null,    -- null with a flag: the check found it
  check_state text        not null default 'no' check (check_state in ('no', 'checking', 'ok', 'bad')),
  checked_at  timestamptz,
  check_note  text        not null default '' check (char_length(check_note) <= 300),
  edited_at   timestamptz,
  created_at  timestamptz not null default now(),
  check ((kind in ('sketch', 'meme')) = (photo is not null)),
  check (draft_no is null or draft_id is not null)
);
create index if not exists study_aids_spot on public.study_aids (lecture_id, part_idx, anchor);
create index if not exists study_aids_group on public.study_aids (group_id, created_at desc);
create index if not exists study_aids_drug on public.study_aids (group_id, drug) where drug <> '';

-- ── J3. Private rows ──
create table if not exists public.study_aid_authors (
  aid_id  uuid primary key references public.study_aids (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade
);
create index if not exists study_aid_authors_user on public.study_aid_authors (user_id);

create table if not exists public.study_aid_votes (
  aid_id     uuid        not null references public.study_aids (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('funny', 'stuck')),            -- "מצחיק" · "נתקע לי"
  created_at timestamptz not null default now(),
  primary key (aid_id, user_id, kind)
);
create index if not exists study_aid_votes_user on public.study_aid_votes (user_id);

-- "שלי": one pinned entry per member per paragraph, seen only by that member;
-- it replaces the group's winner on that member's cards.
create table if not exists public.study_aid_pins (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null,
  anchor     int         not null,
  aid_id     uuid        not null references public.study_aids (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lecture_id, part_idx, anchor)
);

-- A name in a pin only with that member's yes (decision 10). The request is
-- the credited member's row; the entry shows the name only after "לאשר".
create table if not exists public.study_aid_credits (
  aid_id      uuid        primary key references public.study_aids (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  state       text        not null default 'asked' check (state in ('asked', 'ok', 'no')),
  asked_at    timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists study_aid_credits_user on public.study_aid_credits (user_id, state);

-- ── J4. Each paragraph's winner, kept by the functions below (for cards and Anki) ──
create table if not exists public.study_aid_winners (
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null,
  anchor     int         not null,
  aid_id     uuid        not null references public.study_aids (id) on delete cascade,
  since      timestamptz not null default now(),        -- an Anki re-export updates the note from here
  primary key (lecture_id, part_idx, anchor)
);

-- ═══════════════════════════════════════════════════════════════════════
--  Helpers
-- ═══════════════════════════════════════════════════════════════════════
-- An entry's group, for the caller's own groups only (null otherwise).
create or replace function public.study_aid_group(a uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select x.group_id from public.study_aids x where x.id = a and coalesce(public.study_is_member(x.group_id), false);
$$;

-- A member's name in a group ('' for someone who left).
create or replace function study_private.member_name(p_group uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.name from public.study_members m where m.group_id = p_group and m.user_id = p_user), '')
$$;

-- The paragraph's winner again, after a vote, a flag, a check, an edit or a
-- delete: the most votes (2 at least), then more "נתקע לי", then the older,
-- among entries checked against the paragraph and not marked. Returns the
-- entry that should be checked next (it would win and was never checked),
-- or null.
create or replace function study_private.aid_rewin(p_lecture uuid, p_part int, p_anchor int)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  top  uuid;
  best public.study_aids;
begin
  select a.id into top from public.study_aids a
   where a.lecture_id = p_lecture and a.part_idx = p_part and a.anchor = p_anchor
     and a.flag is null and a.check_state = 'ok' and a.funny_n + a.stuck_n >= 2
   order by a.funny_n + a.stuck_n desc, a.stuck_n desc, a.created_at, a.id limit 1;
  if top is null then
    delete from public.study_aid_winners w where w.lecture_id = p_lecture and w.part_idx = p_part and w.anchor = p_anchor;
  else
    insert into public.study_aid_winners (lecture_id, part_idx, anchor, aid_id, since)
    values (p_lecture, p_part, p_anchor, top, now())
    on conflict (lecture_id, part_idx, anchor) do update
       set aid_id = excluded.aid_id, since = excluded.since
     where public.study_aid_winners.aid_id is distinct from excluded.aid_id;
  end if;
  select a.* into best from public.study_aids a
   where a.lecture_id = p_lecture and a.part_idx = p_part and a.anchor = p_anchor
     and a.flag is null and a.check_state <> 'bad' and a.funny_n + a.stuck_n >= 2
   order by a.funny_n + a.stuck_n desc, a.stuck_n desc, a.created_at, a.id limit 1;
  if found and best.check_state = 'no' then return best.id; end if;
  return null;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  What the phones call
-- ═══════════════════════════════════════════════════════════════════════

-- Posts an entry (W3, W8, K6). Errors: 'not signed in', 'lecture not found',
-- 'part not found', 'bad kind', 'bad body', 'bad fact', 'unknown slide',
-- 'bad photo', 'bad figure', 'bad remix', 'bad draft', 'bad credit',
-- 'daily_limit' (30 entries a day, Israel time, as the budget's daily limits).
create or replace function public.study_aid_post(p_lecture uuid, p_part int, p_anchor int, p_quote text, p_kind text,
  p_body text, p_fact text, p_slides int[], p_drug text default '', p_named boolean default true,
  p_remix_of uuid default null, p_draft uuid default null, p_draft_no int default null,
  p_photo text default null, p_figure text default null, p_credit uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  g    uuid := public.study_lecture_group(p_lecture);
  have int[];
  fn   int;
  fk   int;
  aid  uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part)
     or p_anchor is null or p_anchor not between 0 and 9999 then
    raise exception 'part not found';
  end if;
  if coalesce(p_kind, '') not in ('line', 'remix', 'sketch', 'meme', 'moment', 'draft') then raise exception 'bad kind'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 500 then raise exception 'bad body'; end if;
  if char_length(btrim(coalesce(p_fact, ''))) not between 3 and 300 then raise exception 'bad fact'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = p_lecture;
  if cardinality(coalesce(p_slides, '{}')) > 6 or not (coalesce(p_slides, '{}') <@ have) then raise exception 'unknown slide'; end if;
  if (p_kind in ('sketch', 'meme')) <> (p_photo is not null)
     or (p_photo is not null and (p_photo !~ ('^' || g::text || '/wall/[0-9a-f-]{36}\.(jpg|webp)$')
                                  or not exists (select 1 from storage.objects o
                                                  where o.bucket_id = 'study' and o.name = p_photo
                                                    and o.owner_id = auth.uid()::text)          -- review SEC-14: her own upload
                                  or exists (select 1 from public.study_aids x where x.photo = p_photo))) then
    raise exception 'bad photo';
  end if;
  if p_figure is not null then
    if p_figure !~ '^fig:[0-9]{1,4}-[0-9]{1,3}$' then raise exception 'bad figure'; end if;
    fn := split_part(substr(p_figure, 5), '-', 1)::int;
    fk := split_part(substr(p_figure, 5), '-', 2)::int;
    if not exists (select 1 from public.study_lectures l, jsonb_array_elements(l.slides) s,
                          jsonb_array_elements(coalesce(s -> 'figures', '[]'::jsonb)) f
                    where l.id = p_lecture and (s ->> 'n')::int = fn and (f ->> 'k')::int = fk) then
      raise exception 'bad figure';
    end if;
  end if;
  -- A remix names what it remixes (an entry of the group, or a draft); only a remix names an entry.
  if (p_kind = 'remix' and p_remix_of is null and p_draft is null)
     or (p_kind <> 'remix' and p_remix_of is not null)
     or (p_remix_of is not null and public.study_aid_group(p_remix_of) is distinct from g) then
    raise exception 'bad remix';
  end if;
  -- A draft is posted from its own paragraph; "לפרסם כמו שהיא" posts its exact text
  -- (anything else is a remix, posted as the member's own words).
  if (p_kind = 'draft' and p_draft is null)
     or (p_kind not in ('remix', 'draft') and p_draft is not null)
     or (p_draft is not null and (
           p_draft_no is null or p_draft_no not between 1 and 3
           or not exists (select 1 from public.study_aid_drafts d
                           where d.id = p_draft and d.lecture_id = p_lecture and d.part_idx = p_part and d.anchor = p_anchor)))
     or (p_kind = 'draft' and not exists (select 1 from public.study_aid_drafts d
                                           where d.id = p_draft and btrim(d.drafts -> (p_draft_no - 1) ->> 'hook') = btrim(p_body))) then
    raise exception 'bad draft';
  end if;
  if p_credit is not null and (p_credit = me or not exists (select 1 from public.study_members m where m.group_id = g and m.user_id = p_credit)) then
    raise exception 'bad credit';
  end if;
  if (select count(*) from public.study_aid_authors w join public.study_aids a on a.id = w.aid_id
       where w.user_id = me
         and a.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')) >= 30 then
    raise exception 'daily_limit';
  end if;
  insert into public.study_aids (group_id, lecture_id, part_idx, anchor, quote, drug, kind, body, fact, slides,
                                 photo, figure, remix_of, draft_id, draft_no, named_by)
  values (g, p_lecture, p_part, p_anchor, left(coalesce(p_quote, ''), 200), left(lower(btrim(coalesce(p_drug, ''))), 60),
          p_kind, btrim(p_body), btrim(p_fact), coalesce(p_slides, '{}'), p_photo, p_figure, p_remix_of, p_draft,
          p_draft_no, case when coalesce(p_named, true) then me end)
  returning id into aid;
  insert into public.study_aid_authors (aid_id, user_id) values (aid, me);
  if p_credit is not null then
    insert into public.study_aid_credits (aid_id, user_id) values (aid, p_credit);
  end if;
  return aid;
end;
$$;

-- The author fixes an entry: its check and any "לא מדויק"/"לא מתאים" mark
-- start over. Errors: 'aid not found' (or not the caller's), 'bad body',
-- 'bad fact', 'unknown slide'. Returns the entry to check next, if any.
create or replace function public.study_aid_edit(p_aid uuid, p_body text, p_fact text, p_slides int[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  a    public.study_aids;
  have int[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select x.* into a from public.study_aids x join public.study_aid_authors w on w.aid_id = x.id
   where x.id = p_aid and w.user_id = auth.uid() for update of x;
  if not found then raise exception 'aid not found'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 500 then raise exception 'bad body'; end if;
  if char_length(btrim(coalesce(p_fact, ''))) not between 3 and 300 then raise exception 'bad fact'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = a.lecture_id;
  if cardinality(coalesce(p_slides, '{}')) > 6 or not (coalesce(p_slides, '{}') <@ have) then raise exception 'unknown slide'; end if;
  update public.study_aids x
     set body = btrim(p_body), fact = btrim(p_fact), slides = coalesce(p_slides, '{}'), edited_at = now(),
         flag = null, flagged_by = null, check_state = 'no', checked_at = null, check_note = ''
   where x.id = p_aid;
  return study_private.aid_rewin(a.lecture_id, a.part_idx, a.anchor);
end;
$$;

-- The author deletes an entry. Returns its photo's path, which the phone
-- then removes from Storage (only the Storage API removes files).
create or replace function public.study_aid_delete(p_aid uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare a public.study_aids;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select x.* into a from public.study_aids x join public.study_aid_authors w on w.aid_id = x.id
   where x.id = p_aid and w.user_id = auth.uid();
  if not found then raise exception 'aid not found'; end if;
  delete from public.study_aids x where x.id = p_aid;
  perform study_private.aid_rewin(a.lecture_id, a.part_idx, a.anchor);
  return a.photo;
end;
$$;

-- A vote, on or off (W4). Never on one's own entry. Who voted stays private;
-- the totals are the group's. Returns {funny, stuck, check}: check is the
-- entry to check against its paragraph now (op wall_check), if any.
-- Errors: 'aid not found', 'bad vote', 'own aid'.
create or replace function public.study_aid_vote(p_aid uuid, p_kind text, p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  a   public.study_aids;
  chg int;
  nxt uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into a from public.study_aids x where x.id = p_aid for update;
  if not found or not coalesce(public.study_is_member(a.group_id), false) then raise exception 'aid not found'; end if;
  if coalesce(p_kind, '') not in ('funny', 'stuck') then raise exception 'bad vote'; end if;
  if exists (select 1 from public.study_aid_authors w where w.aid_id = p_aid and w.user_id = me) then raise exception 'own aid'; end if;
  if p_on then
    insert into public.study_aid_votes (aid_id, user_id, kind) values (p_aid, me, p_kind) on conflict do nothing;
  else
    delete from public.study_aid_votes v where v.aid_id = p_aid and v.user_id = me and v.kind = p_kind;
  end if;
  get diagnostics chg = row_count;
  if chg > 0 then
    update public.study_aids x
       set funny_n = x.funny_n + case when p_kind = 'funny' then (case when p_on then 1 else -1 end) else 0 end,
           stuck_n = x.stuck_n + case when p_kind = 'stuck' then (case when p_on then 1 else -1 end) else 0 end
     where x.id = p_aid
    returning * into a;
  end if;
  nxt := study_private.aid_rewin(a.lecture_id, a.part_idx, a.anchor);
  return jsonb_build_object('funny', a.funny_n, 'stuck', a.stuck_n, 'check', nxt);
end;
$$;

-- "לא מדויק" keeps an entry off the cards until it is fixed; "לא מתאים"
-- (the house rule: roast the drug, never people or patients) also hides it
-- from the wall. Any member marks, with their name; the marker or the author
-- clears it (an edit clears it too). Errors: 'aid not found', 'bad flag', 'not yours'.
create or replace function public.study_aid_flag(p_aid uuid, p_flag text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a  public.study_aids;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into a from public.study_aids x where x.id = p_aid for update;
  if not found or not coalesce(public.study_is_member(a.group_id), false) then raise exception 'aid not found'; end if;
  if p_flag is not null and p_flag not in ('inaccurate', 'not_ok') then raise exception 'bad flag'; end if;
  if p_flag is null then
    if a.flag is null then return; end if;
    -- A mark the check made (no marker) goes only with a fix (study_aid_edit).
    if a.flagged_by is null
       or (a.flagged_by is distinct from me
           and not exists (select 1 from public.study_aid_authors w where w.aid_id = p_aid and w.user_id = me)) then
      raise exception 'not yours';
    end if;
    update public.study_aids x set flag = null, flagged_by = null where x.id = p_aid;
  else
    update public.study_aids x set flag = p_flag, flagged_by = me where x.id = p_aid;
  end if;
  perform study_private.aid_rewin(a.lecture_id, a.part_idx, a.anchor);
end;
$$;

-- "שלי" (W6): pin an entry for oneself on its paragraph, or take the pin off.
create or replace function public.study_aid_pin(p_aid uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a public.study_aids;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into a from public.study_aids x where x.id = p_aid;
  if not found or not coalesce(public.study_is_member(a.group_id), false) then raise exception 'aid not found'; end if;
  if p_on then
    insert into public.study_aid_pins (user_id, lecture_id, part_idx, anchor, aid_id)
    values (auth.uid(), a.lecture_id, a.part_idx, a.anchor, p_aid)
    on conflict (user_id, lecture_id, part_idx, anchor) do update set aid_id = excluded.aid_id, created_at = now();
  else
    delete from public.study_aid_pins p where p.user_id = auth.uid() and p.aid_id = p_aid;
  end if;
end;
$$;

-- W8: the credit requests waiting for the caller.
create or replace function public.study_aid_credit_requests(p_group uuid)
returns table (aid_id uuid, lecture_id uuid, part_idx int, anchor int, body text, fact text, slides int[], asked_by text, asked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.lecture_id, a.part_idx, a.anchor, a.body, a.fact, a.slides,
         case when a.named_by is not null then study_private.member_name(a.group_id, a.named_by) else '' end, r.asked_at
    from public.study_aid_credits r join public.study_aids a on a.id = r.aid_id
   where r.user_id = auth.uid() and r.state = 'asked' and a.group_id = p_group and public.study_is_member(p_group)
   order by r.asked_at
$$;

-- W8: "לאשר" puts the caller's name on the entry; "לא" leaves it without.
create or replace function public.study_aid_credit_answer(p_aid uuid, p_ok boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_aid_credits r set state = case when p_ok then 'ok' else 'no' end, answered_at = now()
   where r.aid_id = p_aid and r.user_id = auth.uid() and r.state = 'asked';
  if not found then raise exception 'credit not found'; end if;
  if p_ok then
    update public.study_aids a set credit_id = auth.uid() where a.id = p_aid;
  end if;
end;
$$;

-- The week's winner ("מנצחת השבוע"; read aloud on Thursday): the most votes
-- cast since Sunday 04:00 (Israel time), 2 at least, not marked.
create or replace function public.study_aid_week(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with wk as (
    select ((d - extract(dow from d)::int + time '04:00') at time zone 'Asia/Jerusalem') as since
      from (select ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date as d) x
  )
  select v.aid_id
    from public.study_aid_votes v
    join public.study_aids a on a.id = v.aid_id
    cross join wk
   where a.group_id = p_group and public.study_is_member(p_group) and a.flag is null and v.created_at >= wk.since
   group by v.aid_id, a.created_at
  having count(*) >= 2
   order by count(*) desc, count(*) filter (where v.kind = 'stuck') desc, a.created_at, v.aid_id
   limit 1
$$;

-- W1: the wall, for the caller: one lecture, one drug across lectures
-- (p_drug), or the whole group. Hidden ("לא מתאים") entries show only to
-- their author. Names: the author's when posted by name, the credited
-- member's after "לאשר". mine / my_* / pinned are the caller's own.
create or replace function public.study_aid_wall(p_group uuid, p_lecture uuid default null, p_drug text default null)
returns table (id uuid, lecture_id uuid, lecture_title text, part_idx int, anchor int, quote text, drug text, kind text,
               body text, fact text, slides int[], photo text, figure text, author text, credit text,
               funny_n int, stuck_n int, my_funny boolean, my_stuck boolean, mine boolean, pinned boolean,
               on_cards boolean, week boolean, flag text, flagged_by text, check_note text,
               remix_of uuid, draft_id uuid, draft_no smallint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  wk uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(p_group), false) then raise exception 'forbidden'; end if;
  wk := public.study_aid_week(p_group);
  return query
  select a.id, a.lecture_id, l.title, a.part_idx, a.anchor, a.quote, a.drug, a.kind, a.body, a.fact, a.slides, a.photo, a.figure,
         case when a.named_by is not null then study_private.member_name(a.group_id, a.named_by) end,
         case when a.credit_id is not null then study_private.member_name(a.group_id, a.credit_id) end,
         a.funny_n, a.stuck_n,
         exists (select 1 from public.study_aid_votes v where v.aid_id = a.id and v.user_id = me and v.kind = 'funny'),
         exists (select 1 from public.study_aid_votes v where v.aid_id = a.id and v.user_id = me and v.kind = 'stuck'),
         exists (select 1 from public.study_aid_authors w where w.aid_id = a.id and w.user_id = me),
         exists (select 1 from public.study_aid_pins p where p.aid_id = a.id and p.user_id = me),
         exists (select 1 from public.study_aid_winners w where w.aid_id = a.id),
         a.id = wk,
         a.flag,
         case when a.flagged_by is not null then study_private.member_name(a.group_id, a.flagged_by) end,
         a.check_note, a.remix_of, a.draft_id, a.draft_no, a.created_at
    from public.study_aids a
    join public.study_lectures l on l.id = a.lecture_id and l.deleted_at is null
   where a.group_id = p_group
     and (p_lecture is null or a.lecture_id = p_lecture)
     and (p_drug is null or a.drug = lower(btrim(p_drug)))
     and (a.flag is distinct from 'not_ok'
          or exists (select 1 from public.study_aid_authors w where w.aid_id = a.id and w.user_id = me))
   order by a.created_at desc;
end;
$$;

-- C4: the hint for one of the caller's cards (after two lapses): the
-- caller's own pin on the card's paragraph, else the group's winner.
create or replace function public.study_aid_hint(p_card uuid)
returns table (aid_id uuid, body text, fact text, slides int[], photo text, figure text, author text, pinned boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  c   record;
  aid uuid;
  pin boolean := true;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select x.lecture_id, x.part_idx, (to_jsonb(x) ->> 'anchor')::int as anchor, x.group_id into c from public.study_cards x where x.id = p_card;
  if not found or not coalesce(public.study_is_member(c.group_id), false) then raise exception 'card not found'; end if;
  if c.anchor is null or c.part_idx is null then return; end if;
  select p.aid_id into aid from public.study_aid_pins p
   where p.user_id = auth.uid() and p.lecture_id = c.lecture_id and p.part_idx = c.part_idx and p.anchor = c.anchor;
  if aid is null then
    pin := false;
    select w.aid_id into aid from public.study_aid_winners w
     where w.lecture_id = c.lecture_id and w.part_idx = c.part_idx and w.anchor = c.anchor;
  end if;
  if aid is null then return; end if;
  return query
  select a.id, a.body, a.fact, a.slides, a.photo, a.figure,
         case when a.named_by is not null then study_private.member_name(a.group_id, a.named_by) end, pin
    from public.study_aids a where a.id = aid;
end;
$$;

-- W5: the association on each card of a lecture, for the card's back in the
-- app and the Extra field of the Anki export: the caller's pin, else the
-- group's winner. since: when it became this card's (the note's mod time
-- moves with it, so a re-export updates the card in Anki).
create or replace function public.study_aid_for_cards(p_lecture uuid)
returns table (card_id uuid, aid_id uuid, body text, fact text, slides int[], author text, pinned boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare g uuid := public.study_lecture_group(p_lecture);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false) then raise exception 'lecture not found'; end if;
  return query
  select c.id, a.id, a.body, a.fact, a.slides,
         case when a.named_by is not null then study_private.member_name(a.group_id, a.named_by) end,
         p.aid_id is not null, coalesce(p.created_at, w.since)
    from (select x.id, x.lecture_id, x.part_idx, (to_jsonb(x) ->> 'anchor')::int as anc
            from public.study_cards x where x.lecture_id = p_lecture and x.deleted_at is null) c
    left join public.study_aid_pins p on p.user_id = auth.uid() and p.lecture_id = c.lecture_id
                                     and p.part_idx = c.part_idx and p.anchor = c.anc
    left join public.study_aid_winners w on w.lecture_id = c.lecture_id and w.part_idx = c.part_idx and w.anchor = c.anc
    join public.study_aids a on a.id = coalesce(p.aid_id, w.aid_id)
   where c.anc is not null;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Written only by /api/study/ai with the server key
-- ═══════════════════════════════════════════════════════════════════════

-- op "mnemonic" (W2): the drafts of a paragraph that passed the op's
-- checks (1 to 3, one per technique), once per text. Returns the saved
-- row's id (an existing one when two phones raced).
create or replace function public.study_aid_drafts_save(p_lecture uuid, p_part int, p_anchor int, p_hash text,
  p_fact text, p_slides int[], p_drafts jsonb, p_model text, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g    uuid := public.study_lecture_group(p_lecture);
  have int[];
  did  uuid;
  d    jsonb;
  tech text[] := '{}';
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if g is null or not coalesce(public.study_is_member(g), false) then raise exception 'lecture not found'; end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then raise exception 'part not found'; end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad drafts'; end if;
  if jsonb_typeof(p_drafts) is distinct from 'array' or jsonb_array_length(p_drafts) not between 1 and 3 then raise exception 'bad drafts'; end if;
  for d in select * from jsonb_array_elements(p_drafts) loop
    if coalesce(d ->> 'technique', '') not in ('משחק מילים', 'חרוז', 'סצנה הזויה')
       or char_length(btrim(coalesce(d ->> 'hook', ''))) not between 3 and 200
       or char_length(coalesce(d ->> 'decode', '')) > 400 then
      raise exception 'bad drafts';
    end if;
    tech := tech || (d ->> 'technique');
  end loop;
  if (select count(distinct x) from unnest(tech) x) <> cardinality(tech) then raise exception 'bad drafts'; end if;
  if char_length(btrim(coalesce(p_fact, ''))) not between 3 and 300 then raise exception 'bad drafts'; end if;
  select coalesce(array_agg((s ->> 'n')::int), '{}') into have
    from public.study_lectures l, jsonb_array_elements(l.slides) s where l.id = p_lecture;
  if cardinality(coalesce(p_slides, '{}')) > 6 or not (coalesce(p_slides, '{}') <@ have) then raise exception 'unknown slide'; end if;
  insert into public.study_aid_drafts (group_id, lecture_id, part_idx, anchor, src_hash, fact, slides, drafts, model)
  values (g, p_lecture, p_part, p_anchor, p_hash, btrim(p_fact), coalesce(p_slides, '{}'), p_drafts, left(p_model, 80))
  on conflict (lecture_id, part_idx, anchor, src_hash) do nothing
  returning id into did;
  if did is null then
    select x.id into did from public.study_aid_drafts x
     where x.lecture_id = p_lecture and x.part_idx = p_part and x.anchor = p_anchor and x.src_hash = p_hash;
  end if;
  return did;
end;
$$;

-- op "wall_check" (W5), before: takes the entry for checking. Errors:
-- 'aid not found', 'checked' (already checked), 'busy' (another phone is
-- checking it, for 2 minutes).
create or replace function public.study_aid_check_begin(p_aid uuid, p_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.study_aids;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into a from public.study_aids x where x.id = p_aid for update;
  if not found or not coalesce(public.study_is_member(a.group_id), false) then raise exception 'aid not found'; end if;
  if a.check_state in ('ok', 'bad') then raise exception 'checked'; end if;
  if a.check_state = 'checking' and a.checked_at > now() - interval '2 minutes' then raise exception 'busy'; end if;
  update public.study_aids x set check_state = 'checking', checked_at = now() where x.id = p_aid;
  return jsonb_build_object('lecture_id', a.lecture_id, 'part', a.part_idx, 'anchor', a.anchor, 'kind', a.kind,
                            'body', a.body, 'fact', a.fact, 'slides', to_jsonb(a.slides), 'group_id', a.group_id);
end;
$$;

-- op "wall_check", after: ok, or not (with what is wrong: the entry is
-- marked "לא מדויק" by the check until its author fixes it); p_ok null =
-- the check did not finish, try again later. Returns the next entry to
-- check on that paragraph, if any.
create or replace function public.study_aid_check_done(p_aid uuid, p_ok boolean, p_note text, p_key text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare a public.study_aids;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into a from public.study_aids x where x.id = p_aid for update;
  if not found or not coalesce(public.study_is_member(a.group_id), false) then raise exception 'aid not found'; end if;
  if a.check_state <> 'checking' then raise exception 'checked'; end if;
  update public.study_aids x
     set check_state = case when p_ok is null then 'no' when p_ok then 'ok' else 'bad' end,
         checked_at = now(),
         check_note = case when p_ok is false then left(btrim(coalesce(p_note, '')), 300) else '' end,
         flag = case when p_ok is false then 'inaccurate' else x.flag end,
         flagged_by = case when p_ok is false then null else x.flagged_by end
   where x.id = p_aid;
  return study_private.aid_rewin(a.lecture_id, a.part_idx, a.anchor);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_aid_drafts  enable row level security;
alter table public.study_aids        enable row level security;
alter table public.study_aid_authors enable row level security;
alter table public.study_aid_votes   enable row level security;
alter table public.study_aid_pins    enable row level security;
alter table public.study_aid_credits enable row level security;
alter table public.study_aid_winners enable row level security;

drop policy if exists "study aid drafts read"  on public.study_aid_drafts;
drop policy if exists "study aids read"        on public.study_aids;
drop policy if exists "study aid authors own"  on public.study_aid_authors;
drop policy if exists "study aid votes own"    on public.study_aid_votes;
drop policy if exists "study aid pins own"     on public.study_aid_pins;
drop policy if exists "study aid credits own"  on public.study_aid_credits;
drop policy if exists "study aid winners read" on public.study_aid_winners;

create policy "study aid drafts read" on public.study_aid_drafts
  for select using (public.study_is_member(group_id));
-- Hidden ("לא מתאים") entries are left out by study_aid_wall; a direct read
-- (Realtime) still carries them to members, with no author.
create policy "study aids read" on public.study_aids
  for select using (public.study_is_member(group_id));
create policy "study aid authors own" on public.study_aid_authors
  for select using (user_id = auth.uid());
create policy "study aid votes own" on public.study_aid_votes
  for select using (user_id = auth.uid());
create policy "study aid pins own" on public.study_aid_pins
  for select using (user_id = auth.uid());
create policy "study aid credits own" on public.study_aid_credits
  for select using (user_id = auth.uid());
create policy "study aid winners read" on public.study_aid_winners
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));

revoke all on public.study_aid_drafts, public.study_aids, public.study_aid_authors, public.study_aid_votes,
  public.study_aid_pins, public.study_aid_credits, public.study_aid_winners from anon, authenticated;
grant select on public.study_aid_drafts, public.study_aids, public.study_aid_authors, public.study_aid_votes,
  public.study_aid_pins, public.study_aid_credits, public.study_aid_winners to authenticated;

revoke all on function study_private.member_name(uuid, uuid), study_private.aid_rewin(uuid, int, int) from public;
revoke all on function public.study_aid_group(uuid),
  public.study_aid_post(uuid, int, int, text, text, text, text, int[], text, boolean, uuid, uuid, int, text, text, uuid),
  public.study_aid_edit(uuid, text, text, int[]), public.study_aid_delete(uuid), public.study_aid_vote(uuid, text, boolean),
  public.study_aid_flag(uuid, text), public.study_aid_pin(uuid, boolean), public.study_aid_credit_requests(uuid),
  public.study_aid_credit_answer(uuid, boolean), public.study_aid_week(uuid), public.study_aid_wall(uuid, uuid, text),
  public.study_aid_hint(uuid), public.study_aid_for_cards(uuid),
  public.study_aid_drafts_save(uuid, int, int, text, text, int[], jsonb, text, text),
  public.study_aid_check_begin(uuid, text), public.study_aid_check_done(uuid, boolean, text, text)
  from public, anon;
-- The three server-only ones need the server key inside; the grant only lets the op's call reach them.
grant execute on function public.study_aid_group(uuid),
  public.study_aid_post(uuid, int, int, text, text, text, text, int[], text, boolean, uuid, uuid, int, text, text, uuid),
  public.study_aid_edit(uuid, text, text, int[]), public.study_aid_delete(uuid), public.study_aid_vote(uuid, text, boolean),
  public.study_aid_flag(uuid, text), public.study_aid_pin(uuid, boolean), public.study_aid_credit_requests(uuid),
  public.study_aid_credit_answer(uuid, boolean), public.study_aid_week(uuid), public.study_aid_wall(uuid, uuid, text),
  public.study_aid_hint(uuid), public.study_aid_for_cards(uuid),
  public.study_aid_drafts_save(uuid, int, int, text, text, int[], jsonb, text, text),
  public.study_aid_check_begin(uuid, text), public.study_aid_check_done(uuid, boolean, text, text)
  to authenticated;

-- ── Realtime: a new entry, a fix, a vote total and a deletion reach every
--  open wall (study-wall-<lecture>). Never authors, votes, pins or credits.
do $$
begin
  execute 'alter publication supabase_realtime add table public.study_aids';
exception when duplicate_object then
  null;
end $$;

insert into study_private.schema_sections (section, version) values ('J', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

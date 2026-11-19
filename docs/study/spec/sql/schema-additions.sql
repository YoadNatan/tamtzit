-- ════════════════════════════════════════════════════════════════════════
--  SECTION F · FOUNDATION: columns, the spend ledger, the group channel, hooks   (owned by package F)
--  Appended to supabase/study-schema.sql after the board trigger patch.
--  Safe to run again: add-if-missing, create-or-replace, drop-then-create.
--
--  F1. Columns on existing tables that the client reads from the first
--      release (lecture.queued_at; a part's lease, attempts, retry time,
--      writer, rev and gen). Inert until package W (server writing) and
--      package K (corrections) use them.
--  F2. One spend ledger (decision 14): before every Claude call the server
--      reserves the call's worst-case cost (study_reserve, under a per-group
--      lock: the budget, the 80% line, one member's share and the daily
--      limits are checked there), and settles it after the call
--      (study_settle, or study_finish/study_outline_done for summaries). A
--      call that never settles keeps its estimate. The monthly cap is summed
--      by study_spent(). Members read only the total and their own share.
--  F3. The server key (Vault, the same value as STUDY_WORKER_KEY on Vercel):
--      every function that writes Claude's output or spends the budget
--      requires it, so a member's token alone cannot forge a summary, a
--      question or a card, or spend the month (review B1).
--  F3b. Server-side switches (recordings, exams) that the SQL and the
--      functions obey whatever the app's flags say (review M10), and the
--      schema registry the app and /api/study/health read (review FE-2).
--  F3c. Lectures are deleted softly: hidden for 30 days with "שחזור", then
--      purged (review M2). Members cannot delete a lecture row directly.
--  F3d. The group's members: names unique in the group, a new invite code
--      and removing a member, by the group's creator (review M4).
--  F4. The group channel study-group-<group id> for the app shell.
--  F5. Hooks later sections fill: study_corrections_of() answers [] until
--      package K's section replaces it; study_part_corrections() lets the
--      device writer (package W) read them from the first release.
-- ════════════════════════════════════════════════════════════════════════

-- ── F1. Columns the client reads (leases: package W; rev/gen: package K) ──
alter table public.study_lectures
  add column if not exists queued_at   timestamptz,          -- the server owns the writing from here on
  add column if not exists lease_id    uuid,                 -- the outline's writer
  add column if not exists lease_until timestamptz,
  add column if not exists attempts    int not null default 0;

alter table public.study_sections
  add column if not exists lease_id    uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists attempts    int not null default 0,
  add column if not exists retry_at    timestamptz,
  add column if not exists writer      text check (writer in ('server', 'device'));

-- rev: +1 whenever the part's text changes; gen: +1 whenever the part starts
-- being written. Kept by package K's trigger study_sections_versions().
alter table public.study_sections
  add column if not exists rev int not null default 0,
  add column if not exists gen int not null default 0;

-- ── F2. The spend ledger ──
-- Append-only. A deleted lecture keeps its rows (the money was spent).
-- Members cannot read rows (they would show who practised how much);
-- study_spent() gives the group's total, study_charge() adds a row.
create table if not exists public.study_usage (
  id         bigint        generated always as identity primary key,
  group_id   uuid          not null references public.study_groups (id) on delete cascade,
  lecture_id uuid          references public.study_lectures (id) on delete set null,
  user_id    uuid          references auth.users (id) on delete set null,   -- null: the server worker
  kind       text          not null check (kind ~ '^[a-z][a-z_]{1,23}$'),  -- outline, part, notes, practice, cards, ask, mnemonic, exam ...
  ref        text          check (char_length(ref) <= 80),
  model      text          check (char_length(model) <= 80),
  usage      jsonb,
  cost_usd   numeric(10,5) not null check (cost_usd >= 0 and cost_usd < 100),
  created_at timestamptz   not null default now()
);
create index if not exists study_usage_group_month on public.study_usage (group_id, created_at);

-- Once: what the parts already spent (study_sections.usage) becomes ledger
-- rows, priced at claude-opus-5-5 ($4 in, $20 out, $5 cache write, $0.20 hit).
-- settled_at: when the call's real cost was written; null = a reservation
-- (study_reserve) whose call has not settled (yet, or ever: it keeps its estimate).
alter table public.study_usage add column if not exists settled_at timestamptz;

insert into public.study_usage (group_id, lecture_id, kind, ref, model, usage, cost_usd, created_at, settled_at)
select l.group_id, s.lecture_id, 'part', s.idx::text, s.model, s.usage,
       round((coalesce((s.usage ->> 'input_tokens')::numeric, 0) * 4
            + coalesce((s.usage ->> 'output_tokens')::numeric, 0) * 20
            + coalesce((s.usage ->> 'cache_creation_input_tokens')::numeric, 0) * 5
            + coalesce((s.usage ->> 'cache_read_input_tokens')::numeric, 0) * 0.2) / 1000000, 5),
       s.updated_at, s.updated_at
  from public.study_sections s join public.study_lectures l on l.id = s.lecture_id
 where s.usage is not null
   and not exists (select 1 from public.study_usage u where u.lecture_id = s.lecture_id and u.kind = 'part' and u.ref = s.idx::text);

-- ── F3. The worker key (Vault). Not reachable through the API. ──
create schema if not exists study_private;
revoke all on schema study_private from public;

-- A Vault secret by name; null without Vault or without the secret.
create or replace function study_private.secret(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  return v;
end;
$$;

-- The worker's key: at least 32 characters, and only an exact match.
create or replace function study_private.is_worker(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if p_key is null then return false; end if;
  k := study_private.secret('study_worker_key');
  return coalesce(length(k) >= 32 and p_key = k, false);
end;
$$;

revoke all on function study_private.secret(text), study_private.is_worker(text) from public;

-- The group's spend this calendar month (UTC), for every feature's budget check.
create or replace function public.study_spent(p_group uuid, p_key text default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if not (study_private.is_worker(p_key) or (p_key is null and coalesce(public.study_is_member(p_group), false))) then
    raise exception 'forbidden';
  end if;
  return coalesce((select sum(u.cost_usd) from public.study_usage u
                    where u.group_id = p_group
                      and u.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0);
end;
$$;

-- ── F3b. Server-side switches. The VITE_STUDY_* flags only hide screens;
-- these decide what the database and the functions accept. Yoad turns one
-- on in the SQL editor: update study_private.features set enabled = true,
-- changed_at = now() where name = 'recordings';
create table if not exists study_private.features (
  name       text        primary key check (name ~ '^[a-z][a-z_]{1,30}$'),
  enabled    boolean     not null default false,
  changed_at timestamptz not null default now()
);
insert into study_private.features (name) values ('recordings'), ('exams') on conflict (name) do nothing;

-- A name without a row has no switch: on.
create or replace function study_private.feature_on(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.enabled from study_private.features f where f.name = p_name), true)
$$;
-- Which switch a ledger kind obeys.
create or replace function study_private.kind_on(p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_kind when 'notes' then study_private.feature_on('recordings')
                     when 'exam'  then study_private.feature_on('exams')
                     else true end
$$;
-- For members' policies and the app (true/false per switch; nothing secret).
create or replace function public.study_feature_on(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select study_private.feature_on(p_name)
$$;
create or replace function public.study_features()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(f.name, f.enabled), '{}'::jsonb) from study_private.features f
$$;

-- The schema registry: each section records its version as its last
-- statement. The app and /api/study/health compare it with what the
-- deployed code needs (§9.1: the SQL runs before the merge).
create table if not exists study_private.schema_sections (
  section   text        primary key,
  version   int         not null,
  loaded_at timestamptz not null default now()
);
create or replace function public.study_schema()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.section, s.version), '{}'::jsonb) from study_private.schema_sections s
$$;

-- ── The spend, reserved before each call and settled after it ──
-- Only the Vercel functions call these, with the server key; with a
-- member's token as well (the ops and the device path) the row names that
-- member, who must belong to the group.
--   p_estimate      the call's worst-case cost (budget.ts estimateUsd)
--   p_cap           STUDY_MONTHLY_USD
--   p_share         this kind stops at share × cap ('reserve'): 0.8 for every
--                   optional kind, so the last 20% stays for summaries
--   p_member_share  one member's optional spend this month stays under
--                   member_share × cap ('member_share')
--   p_daily         at most this many rows of this kind (and p_daily_ref)
--                   per member per day, Israel time ('daily_limit')
-- Errors: 'forbidden', 'off' (the kind's switch), 'budget', 'reserve',
-- 'member_share', 'daily_limit'.
create or replace function public.study_reserve(p_group uuid, p_lecture uuid, p_kind text, p_ref text,
  p_estimate numeric, p_cap numeric, p_share numeric default 1, p_member_share numeric default null,
  p_daily int default null, p_daily_ref text default null, p_key text default null)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_est   numeric := round(least(greatest(coalesce(p_estimate, 0), 0), 99.99999), 5);
  v_spent numeric;
  v_mine  numeric;
  v_id    bigint;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if me is not null and not coalesce(public.study_is_member(p_group), false) then raise exception 'forbidden'; end if;
  if p_lecture is not null and not exists (select 1 from public.study_lectures l where l.id = p_lecture and l.group_id = p_group) then
    raise exception 'forbidden';
  end if;
  if not study_private.kind_on(p_kind) then raise exception 'off'; end if;
  if coalesce(p_cap, 0) <= 0 then raise exception 'budget'; end if;
  -- One reservation at a time per group: parallel calls cannot all pass.
  perform pg_advisory_xact_lock(hashtext('study_budget:' || p_group::text));
  select coalesce(sum(u.cost_usd), 0) into v_spent
    from public.study_usage u where u.group_id = p_group and u.created_at >= v_month;
  if v_spent + v_est > p_cap then raise exception 'budget'; end if;
  if coalesce(p_share, 1) < 1 and v_spent + v_est > p_cap * p_share then raise exception 'reserve'; end if;
  if me is not null and p_member_share is not null then
    select coalesce(sum(u.cost_usd), 0) into v_mine
      from public.study_usage u
     where u.group_id = p_group and u.user_id = me and u.created_at >= v_month
       and u.kind not in ('outline', 'part', 'notes');
    if v_mine + v_est > p_cap * p_member_share then raise exception 'member_share'; end if;
  end if;
  if me is not null and p_daily is not null
     and (select count(*) from public.study_usage u
           where u.group_id = p_group and u.user_id = me and u.kind = p_kind
             and (p_daily_ref is null or u.ref = p_daily_ref)
             and u.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')) >= p_daily then
    raise exception 'daily_limit';
  end if;
  insert into public.study_usage (group_id, lecture_id, user_id, kind, ref, usage, cost_usd)
  values (p_group, p_lecture, me, p_kind, left(p_ref, 80), '{"estimated": true}'::jsonb, v_est)
  returning id into v_id;
  return v_id;
end;
$$;

-- After the call (also a failed or stopped one): the real cost replaces the
-- estimate, once. False: no such open reservation (already settled).
create or replace function public.study_settle(p_id bigint, p_model text, p_usage jsonb, p_cost numeric, p_key text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  update public.study_usage u
     set model = left(p_model, 80), usage = p_usage,
         cost_usd = round(least(greatest(coalesce(p_cost, 0), 0), 99.99999), 5), settled_at = now()
   where u.id = p_id and u.settled_at is null
     and (auth.uid() is null or u.user_id is not distinct from auth.uid());
  return found;
end;
$$;

-- The caller's own optional spend this month (practice, cards, exams, לשאול,
-- memory aids): "נוצל על ידך החודש" on every estimate. Summaries and notes
-- are the group's and count for nobody's share.
create or replace function public.study_my_spent(p_group uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'forbidden'; end if;
  return coalesce((select sum(u.cost_usd) from public.study_usage u
                    where u.group_id = p_group and u.user_id = auth.uid() and u.kind not in ('outline', 'part', 'notes')
                      and u.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0);
end;
$$;

revoke all on function study_private.feature_on(text), study_private.kind_on(text) from public;
revoke all on function public.study_feature_on(text), public.study_features(), public.study_schema() from public;
revoke all on function public.study_spent(uuid, text) from public;
revoke all on function public.study_reserve(uuid, uuid, text, text, numeric, numeric, numeric, numeric, int, text, text) from public;
revoke all on function public.study_settle(bigint, text, jsonb, numeric, text) from public;
revoke all on function public.study_my_spent(uuid) from public, anon;
grant execute on function public.study_feature_on(text), public.study_features(), public.study_schema() to anon, authenticated;
grant execute on function public.study_spent(uuid, text) to anon, authenticated;
-- Both need the server key inside; the grant only lets the call reach them.
grant execute on function public.study_reserve(uuid, uuid, text, text, numeric, numeric, numeric, numeric, int, text, text) to anon, authenticated;
grant execute on function public.study_settle(bigint, text, jsonb, numeric, text) to anon, authenticated;
grant execute on function public.study_my_spent(uuid) to authenticated;

alter table public.study_usage enable row level security;
revoke all on public.study_usage from anon, authenticated;
-- study_usage: no grants at all (study_spent, study_my_spent; the server's study_reserve/study_settle).

-- ── F3c. Deleting a lecture hides it for 30 days ──
-- One member's tap must not erase the others' private answers, card memory
-- and reading progress on that lecture (they cascade from it). The row stays,
-- marked; the library leaves it out and lists it under "נמחקו לאחרונה" with
-- "שחזור"; the server functions refuse it. After 30 days the app purges it
-- (its files first: only the Storage API removes files).
alter table public.study_lectures
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;
drop policy if exists "study lectures delete" on public.study_lectures;
revoke delete on public.study_lectures from authenticated;

-- p_delete true: hide (once; returns when); false: put back within 30 days.
create or replace function public.study_delete_lecture(p_lecture uuid, p_delete boolean default true)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare l public.study_lectures;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into l from public.study_lectures x where x.id = p_lecture for update;
  if not found or not coalesce(public.study_is_member(l.group_id), false) then raise exception 'lecture not found'; end if;
  if p_delete then
    if l.deleted_at is null then
      update public.study_lectures x set deleted_at = now(), deleted_by = auth.uid() where x.id = p_lecture;
      if to_regclass('study_private.jobs') is not null then
        delete from study_private.jobs j where j.lecture_id = p_lecture;   -- the server stops writing it
      end if;
    end if;
    return coalesce(l.deleted_at, now());
  end if;
  if l.deleted_at is null then return null; end if;
  if l.deleted_at < now() - interval '30 days' then raise exception 'too old'; end if;
  update public.study_lectures x set deleted_at = null, deleted_by = null where x.id = p_lecture;
  return null;
end;
$$;

-- After 30 days: the lecture and everything hanging on it go for good.
create or replace function public.study_purge_lecture(p_lecture uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.study_lectures l
   where l.id = p_lecture and coalesce(public.study_is_member(l.group_id), false)
     and l.deleted_at is not null and l.deleted_at <= now() - interval '30 days';
  return found;
end;
$$;
revoke all on function public.study_delete_lecture(uuid, boolean), public.study_purge_lecture(uuid) from public, anon;
grant execute on function public.study_delete_lecture(uuid, boolean), public.study_purge_lecture(uuid) to authenticated;

-- ── F3d. The group's members ──
-- A name is unique in its group (case and outer spaces ignored), so nobody
-- can join as "שוהם" a second time. Rows from before are not re-checked.
create or replace function public.study_members_name_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.study_members m
              where m.group_id = new.group_id and m.user_id <> new.user_id
                and lower(btrim(m.name)) = lower(btrim(new.name))) then
    raise exception 'name taken';
  end if;
  return new;
end;
$$;
revoke all on function public.study_members_name_check() from public, anon, authenticated;
drop trigger if exists study_members_name_check on public.study_members;
create trigger study_members_name_check before insert or update of name on public.study_members
  for each row execute function public.study_members_name_check();

-- The group's creator replaces the invite code (a forwarded link stops working).
create or replace function public.study_rotate_code(p_group uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.study_groups g where g.id = p_group and g.created_by = auth.uid()) then
    raise exception 'not the creator';
  end if;
  v := public.study_new_code();
  update public.study_groups g set join_code = v where g.id = p_group;
  return v;
end;
$$;

-- The group's creator removes a member (never themself: "יציאה" is for that).
-- Their comments and corrections stay. Realtime keeps reaching them until
-- their access token expires (at most an hour); the API refuses at once.
create or replace function public.study_remove_member(p_group uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.study_groups g where g.id = p_group and g.created_by = auth.uid()) then
    raise exception 'not the creator';
  end if;
  if p_user = auth.uid() then raise exception 'not yourself'; end if;
  delete from public.study_members m where m.group_id = p_group and m.user_id = p_user;
  if not found then raise exception 'member not found'; end if;
end;
$$;

-- Which members saved their account (the "שמור" mark next to a name).
create or replace function public.study_member_saved(p_group uuid)
returns table (user_id uuid, saved boolean) language sql stable security definer set search_path = public as $$
  select m.user_id, not coalesce(u.is_anonymous, true)
    from public.study_members m left join auth.users u on u.id = m.user_id
   where m.group_id = p_group and public.study_is_member(p_group)
$$;
revoke all on function public.study_rotate_code(uuid), public.study_remove_member(uuid, uuid), public.study_member_saved(uuid) from public, anon;
grant execute on function public.study_rotate_code(uuid), public.study_remove_member(uuid, uuid), public.study_member_saved(uuid) to authenticated;

-- ── F4. The group channel (app shell): "study-group-<group id>", members only ──
-- Replaces study_can_use_topic() above: the reading room as before, plus the
-- group's own channel, which carries only what members chose to share (who
-- is reading aloud, an open group quiz).
create or replace function public.study_can_use_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare l uuid;
begin
  if topic like 'study-group-%' then
    begin
      l := substr(topic, length('study-group-') + 1)::uuid;
    exception when others then
      return false;
    end;
    return public.study_is_member(l);
  end if;
  if topic is null or topic not like 'study-read-%' then
    return false;
  end if;
  begin
    l := substr(topic, length('study-read-') + 1)::uuid;
  exception when others then
    return false;
  end;
  return public.study_is_member(public.study_lecture_group(l));
end;
$$;

-- ── F5. Hooks ──
-- The corrections a rewrite of a part must keep (design-collab §2.5). Package
-- K's section replaces this with the real query over study_edits; until then
-- a rewritten part has none. Same name, arguments and result, so
-- create-or-replace swaps the body on every run of this file.
create or replace function public.study_corrections_of(p_lecture uuid, p_part int)
returns jsonb language sql stable security definer set search_path = public as $$
  select '[]'::jsonb
$$;
revoke all on function public.study_corrections_of(uuid, int) from public, anon, authenticated;

-- The device writer (section.ts, member token) reads them right after it has
-- claimed the part (design-collab §2.5). Defined here, not in section K, so
-- package W can call it before package K ships.
create or replace function public.study_part_corrections(p_lecture uuid, p_part int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'forbidden';
  end if;
  return public.study_corrections_of(p_lecture, p_part);
end;
$$;
revoke all on function public.study_part_corrections(uuid, int) from public, anon;
grant execute on function public.study_part_corrections(uuid, int) to authenticated;

-- The repo's own functions were granted to authenticated but never revoked
-- from anon, which an existing project lets call them by default (review m5).
-- Each checks auth.uid(), so this is tidiness: the F27 check lists what anon
-- may call, and only these few stay.
revoke execute on function public.study_create_group(text, text), public.study_join(text, text),
  public.study_group_code(uuid), public.study_comment_lecture(uuid), public.study_can_use_topic(text) from public, anon;
grant execute on function public.study_create_group(text, text), public.study_join(text, text),
  public.study_group_code(uuid), public.study_comment_lecture(uuid), public.study_can_use_topic(text) to authenticated;

-- ── The schema registry: section F is in ──
insert into study_private.schema_sections (section, version) values ('F', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

-- ════════════════════════════════════════════════════════════════════════
--  SECTION A · IDENTITY: saved accounts and the one merge function   (owned by package A)
--  design-me.md §2.2 (block A). Ships FIRST of the private features
--  (decision 11). study_private.merge_users() moves every user column of
--  every study_ table; each feature's lines run only if its tables exist, so
--  it installs at any stage. A new table with a user column adds its line
--  here, and the check "every user column is merged" fails until it does.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  identity for תמצית (decision 11).
--  Ships FIRST, before any private feature: appended to
--  supabase/study-schema.sql as soon as email sign-in is built. Re-runnable.
--
--  A device's anonymous member is folded into a saved (email) account with
--  a one-time merge ticket (research-auth). study_private.merge_users() is
--  the ONE place that moves rows between users. It already carries the lines
--  of every feature designed so far, each behind "if its table exists", so
--  it installs at any stage of the rollout; a feature built later adds its
--  lines there, and supabase/tests fails until it does.
-- ═══════════════════════════════════════════════════════════════════════

create schema if not exists study_private;
revoke all on schema study_private from public;

-- ═══════════════════════════════════════════════════════════════════════
--  1. Identity: merge tickets (research-auth, moved out of the API's reach)
-- ═══════════════════════════════════════════════════════════════════════
-- A ticket proves that the caller held the anonymous session minutes ago.
-- Stored hashed, 30 minutes, once. Not in an exposed schema, no grants.
create table if not exists study_private.merge_tickets (
  token_hash text        primary key,
  from_user  uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Every merge, for Yoad (review M3): who was folded into whom, under which
-- names, and when. No foreign keys: the log outlives the users. It records
-- the merge; it does not make it reversible.
create table if not exists study_private.merge_log (
  id        bigint      generated always as identity primary key,
  src       uuid        not null,
  dst       uuid        not null,
  src_names text        not null default '',
  dst_names text        not null default '',
  at        timestamptz not null default now()
);

-- An anonymous caller asks for a ticket right before signing in to a saved
-- account on this device. Returns the secret (64 hex characters).
create or replace function public.study_merge_offer()
returns text language plpgsql volatile security definer set search_path = public as $$
declare secret text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'not anonymous';
  end if;
  delete from study_private.merge_tickets
   where from_user = auth.uid() or created_at < now() - interval '30 minutes';
  -- 244 random bits from the server's strong generator; no extension needed.
  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into study_private.merge_tickets (token_hash, from_user)
  values (encode(sha256(convert_to(secret, 'UTF8')), 'hex'), auth.uid());
  return secret;
end;
$$;

-- The saved account redeems the ticket right after signing in: 1 = the
-- device's rows moved to the caller, 0 = the ticket was the caller's own.
-- A used, wrong or expired ticket raises 'ticket not found'.
create or replace function public.study_merge_claim(p_ticket text, p_confirm_name text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  dst uuid := auth.uid();
  src uuid;
  v_src_names text;
  v_dst_names text;
begin
  if dst is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'sign in first';
  end if;
  delete from study_private.merge_tickets t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_ticket, ''), 'UTF8')), 'hex')
     and t.created_at > now() - interval '30 minutes'
  returning t.from_user into src;
  if src is null then raise exception 'ticket not found'; end if;
  if src = dst then return 0; end if;
  -- Review M3: on a shared device the anonymous member may be someone else.
  -- The phone shows that member's name and asks "is this you?"; only on "yes"
  -- does it send the name back. A wrong or missing name keeps the ticket
  -- (the raise undoes its use) and moves nothing.
  select coalesce(string_agg(m.name, ', ' order by m.joined_at), '') into v_src_names
    from public.study_members m where m.user_id = src;
  if v_src_names <> '' and not exists (select 1 from public.study_members m
                                         where m.user_id = src
                                           and lower(btrim(m.name)) = lower(btrim(coalesce(p_confirm_name, '')))) then
    raise exception 'confirm name';
  end if;
  select coalesce(string_agg(m.name, ', ' order by m.joined_at), '') into v_dst_names
    from public.study_members m where m.user_id = dst;
  insert into study_private.merge_log (src, dst, src_names, dst_names) values (src, dst, v_src_names, v_dst_names);
  perform study_private.merge_users(src, dst);
  return 1;
end;
$$;

-- ── The Send Email hook asks before any code goes out (review M5) ──
-- api/study/auth-email.ts (Supabase Auth's HTTP "Send Email" hook) calls this
-- with the server key. The app sends only two kinds of mail: a code to save
-- the account (email_change) and a code to sign in (magiclink, which carries
-- the OTP). Everything else, and mail for anyone who is not a member of a
-- study group, is refused, so the project's mail cannot be used to spam or to
-- spend the hourly quota. At most 6 codes a day per user.
create table if not exists study_private.email_sends (
  id      bigint      generated always as identity primary key,
  user_id uuid        not null,
  kind    text        not null,
  at      timestamptz not null default now()
);
create index if not exists study_email_sends_user on study_private.email_sends (user_id, at);

create or replace function public.study_email_allowed(p_user uuid, p_kind text, p_key text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if p_kind is distinct from 'email_change' and p_kind is distinct from 'magiclink' then return 'refused'; end if;
  if not exists (select 1 from public.study_members m where m.user_id = p_user) then return 'refused'; end if;
  -- A sign-in code only for a saved (confirmed) address.
  if p_kind = 'magiclink' and not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    return 'refused';
  end if;
  if (select count(*) from study_private.email_sends e where e.user_id = p_user and e.at > now() - interval '24 hours') >= 6 then
    return 'limit';
  end if;
  insert into study_private.email_sends (user_id, kind) values (p_user, p_kind);
  delete from study_private.email_sends e where e.at < now() - interval '7 days';
  return 'ok';
end;
$$;
revoke all on function public.study_email_allowed(uuid, text, text) from public;
grant execute on function public.study_email_allowed(uuid, text, text) to anon;   -- the hook calls as anon with the key

revoke all on function public.study_merge_offer() from public, anon;
revoke all on function public.study_merge_claim(text, text) from public, anon;
grant execute on function public.study_merge_offer() to authenticated;
grant execute on function public.study_merge_claim(text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  The one place that moves a person's rows: study_private.merge_users()
--  ─────────────────────────────────────────────────────────────────────
--  Called by study_merge_claim() (a device folds into the saved account),
--  and by Yoad from the SQL editor for a "ghost" (an anonymous member whose
--  device is gone): select study_private.merge_users('<ghost>', '<account>');
--  Every user column of every study_ table moves to dst; where both users
--  have a row that must stay single, the rule is written next to it. Each
--  feature's lines run only if its tables exist, so the function installs
--  at any stage of the rollout (plpgsql resolves the tables when it runs,
--  so section A may sit before the sections whose tables it names).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function study_private.merge_users(src uuid, dst uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if src is null or dst is null or src = dst then return; end if;
  -- Two devices folding into one account at the same moment run one by one.
  perform pg_advisory_xact_lock(hashtext('study_merge:' || dst::text));

  -- ── study-schema.sql ──
  -- Memberships: where both belong, the account's row (and its name) stays.
  delete from public.study_members m
   where m.user_id = src
     and exists (select 1 from public.study_members d where d.group_id = m.group_id and d.user_id = dst);
  update public.study_members set user_id = dst where user_id = src;
  -- Read marks: one per lecture, the earlier one stays.
  update public.study_reads d set read_at = least(d.read_at, s.read_at)
    from public.study_reads s
   where s.user_id = src and d.user_id = dst and d.lecture_id = s.lecture_id;
  delete from public.study_reads r
   where r.user_id = src
     and exists (select 1 from public.study_reads d where d.lecture_id = r.lecture_id and d.user_id = dst);
  update public.study_reads set user_id = dst where user_id = src;
  update public.study_comments set author_id = dst where author_id = src;
  update public.study_lectures set created_by = dst where created_by = src;
  update public.study_lectures set deleted_by = dst where deleted_by = src;
  update public.study_groups set created_by = dst where created_by = src;

  -- ── design-platform ──
  if to_regclass('public.study_usage') is not null then
    update public.study_usage set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_recordings') is not null then
    update public.study_recordings set created_by = dst where created_by = src;
    update public.study_recordings set link_set_by = dst where link_set_by = src;
  end if;
  if to_regclass('study_private.jobs') is not null then
    update study_private.jobs set queued_by = dst where queued_by = src;
  end if;

  -- ── design-questions §2.3 ──
  if to_regclass('public.study_answers') is not null then
    update public.study_answers set user_id = dst where user_id = src;
    delete from public.study_question_flags f
     where f.user_id = src
       and exists (select 1 from public.study_question_flags d where d.question_id = f.question_id and d.user_id = dst);
    update public.study_question_flags set user_id = dst where user_id = src;
    update public.study_questions set created_by = dst where created_by = src;
    update public.study_questions set retired_by = dst where retired_by = src;
    update public.study_question_batches set created_by = dst where created_by = src;
    update public.study_question_keys set key_by = dst where key_by = src;
    update public.study_exams set created_by = dst where created_by = src;
  end if;

  -- ── design-quiz §2.4: in a quiz both devices played, the account's seat stays ──
  if to_regclass('public.study_quizzes') is not null then
    delete from public.study_quiz_answers a
     using public.study_quiz_rounds r
     where a.round_id = r.id and a.user_id = src
       and exists (select 1 from public.study_quiz_players d where d.quiz_id = r.quiz_id and d.user_id = dst);
    delete from public.study_quiz_players p
     where p.user_id = src
       and exists (select 1 from public.study_quiz_players d where d.quiz_id = p.quiz_id and d.user_id = dst);
    update public.study_quiz_answers set user_id = dst where user_id = src;
    update public.study_quiz_players set user_id = dst where user_id = src;
    update public.study_quizzes set host_id = dst where host_id = src;
    update public.study_quizzes set created_by = dst where created_by = src;
    update public.study_quiz_rounds set voided_by = dst where voided_by = src;
  end if;

  -- ── design-cards §2.3: the more recently reviewed memory of a card stays ──
  if to_regclass('public.study_card_states') is not null then
    delete from public.study_card_states s
     where s.user_id = src
       and exists (select 1 from public.study_card_states d
                    where d.card_id = s.card_id and d.user_id = dst
                      and coalesce(d.last_review, '-infinity') >= coalesce(s.last_review, '-infinity'));
    delete from public.study_card_states d
     where d.user_id = dst
       and exists (select 1 from public.study_card_states s where s.card_id = d.card_id and s.user_id = src);
    update public.study_card_states set user_id = dst where user_id = src;
    update public.study_card_reviews set user_id = dst where user_id = src;
    delete from public.study_card_settings s
     where s.user_id = src and exists (select 1 from public.study_card_settings d where d.user_id = dst);
    update public.study_card_settings set user_id = dst where user_id = src;
    update public.study_cards set created_by = dst where created_by = src;
    update public.study_cards set updated_by = dst where updated_by = src;
    update public.study_cards set deleted_by = dst where deleted_by = src;
    update public.study_card_edits set edited_by = dst where edited_by = src;
    update public.study_card_batches set created_by = dst where created_by = src;
  end if;

  -- ── design-collab §2.4: a correction keeps its author ──
  if to_regclass('public.study_edits') is not null then
    update public.study_edits set author_id = dst where author_id = src;
  end if;

  -- ── design-me, block B (reading progress, plans, marathons) ──
  if to_regclass('public.study_read_parts') is not null then
    -- Parts read: both devices' parts count; the earlier finish and both times stay.
    update public.study_read_parts d
       set done_at = least(d.done_at, s.done_at), seconds = least(d.seconds + s.seconds, 86400)
      from public.study_read_parts s
     where s.user_id = src and d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx;
    delete from public.study_read_parts s
     where s.user_id = src
       and exists (select 1 from public.study_read_parts d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx);
    update public.study_read_parts set user_id = dst where user_id = src;
    -- Places: the newer one stays.
    delete from public.study_read_places s
     where s.user_id = src
       and exists (select 1 from public.study_read_places d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.updated_at >= s.updated_at);
    delete from public.study_read_places d
     where d.user_id = dst
       and exists (select 1 from public.study_read_places s where s.user_id = src and s.lecture_id = d.lecture_id);
    update public.study_read_places set user_id = dst where user_id = src;
    -- Plans: the account's active plan stays active; the device's goes to the archive.
    update public.study_plans s set status = 'archived', updated_at = now()
     where s.user_id = src and s.status = 'active'
       and exists (select 1 from public.study_plans d where d.user_id = dst and d.group_id = s.group_id and d.status = 'active');
    update public.study_plans set user_id = dst where user_id = src;
    update public.study_plan_lectures set user_id = dst where user_id = src;
    update public.study_plan_checks set user_id = dst where user_id = src;
    -- Marathons: one answer per person, the newer one stays.
    delete from public.study_marathon_people s
     where s.user_id = src
       and exists (select 1 from public.study_marathon_people d
                    where d.marathon_id = s.marathon_id and d.user_id = dst and d.updated_at >= s.updated_at);
    delete from public.study_marathon_people d
     where d.user_id = dst
       and exists (select 1 from public.study_marathon_people s where s.marathon_id = d.marathon_id and s.user_id = src);
    update public.study_marathon_people set user_id = dst where user_id = src;
    update public.study_marathons set created_by = dst where created_by = src;
    update public.study_marathons set updated_by = dst where updated_by = src;
  end if;

  -- A table added later with a user column adds its lines above; the
  -- supabase/tests check "every user column is merged" fails until it does.
end;
$$;
revoke all on function study_private.merge_users(uuid, uuid) from public;

insert into study_private.schema_sections (section, version) values ('A', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

-- ════════════════════════════════════════════════════════════════════════
--  SECTION W · WRITING ON THE SERVER AND RECORDINGS   (owned by package W)
--  design-platform.md §2. Leases and a private job queue that Supabase owns
--  (pg_net kicks, a pg_cron sweeper), and RPCs that both writers (the Vercel
--  worker with its key, a member's phone with its token) go through, so two
--  writers never write one part. Recordings: transcripts in blocks,
--  "מההקלטה" notes per part. Needs section F (ledger, worker key).
--  Without pg_net, pg_cron or the study_site_url secret everything still
--  installs: study_queue() answers false and the phones keep writing, as
--  today, through section.ts, which holds the server key (review B1: no
--  write here is open to a member's token alone).
-- ════════════════════════════════════════════════════════════════════════

-- ── 2. Recordings ──
-- One recording per lecture. The audio never reaches the server: a transcript
-- file is parsed in the browser, and audio is transcribed in the browser.
create table if not exists public.study_recordings (
  id          uuid        primary key default gen_random_uuid(),   -- published: its own key (a DELETE event shows only this)
  lecture_id  uuid        not null unique references public.study_lectures (id) on delete cascade,
  source      text        not null check (source in ('file', 'paste', 'browser')),
  engine      text        not null default '' check (char_length(engine) <= 80),
  source_name text        not null default '' check (char_length(source_name) <= 200),
  link_url    text        check (link_url ~ '^https://' and char_length(link_url) <= 500),
  link_set_by uuid        references auth.users (id) on delete set null,   -- shown beside the link (review M9)
  duration_s  int         check (duration_s between 0 and 21600),
  done_s      int         not null default 0 check (done_s >= 0),
  has_times   boolean     not null default false,
  status      text        not null default 'transcribing' check (status in ('transcribing', 'ready', 'failed')),
  error       text        check (char_length(error) <= 200),
  chars       int         not null default 0 check (chars between 0 and 2000000),
  consented   boolean     not null check (consented),      -- "the group may use this recording"
  created_by  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The transcript, in blocks of about five minutes (or 4,000 characters of
-- untimed text): saved as they are made, so a closed tab resumes, and never
-- one big row. lines = prompt lines "[41:10] ..."; segments = [{s, e, t}].
create table if not exists public.study_transcript_blocks (
  lecture_id uuid         not null references public.study_recordings (lecture_id) on delete cascade,
  idx        int          not null check (idx between 0 and 299),
  start_s    numeric(8,2) check (start_s >= 0),
  end_s      numeric(8,2) check (end_s >= 0),
  lines      text         not null check (length(lines) <= 40000),
  segments   jsonb        not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array'),
  primary key (lecture_id, idx)
);

-- "מההקלטה" notes of one summary part, written by Claude like a part:
-- items = [{ "anchor": 3, "quote": "...", "at_s": 2470, "text": "..." }]
-- (anchor = the paragraph's data-blk in the part; -1 = the end of the part).
create table if not exists public.study_recording_notes (
  id          uuid        primary key default gen_random_uuid(),   -- published: its own key
  lecture_id  uuid        not null references public.study_recordings (lecture_id) on delete cascade,
  part_idx    int         not null check (part_idx >= 0),
  items       jsonb       not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status      text        not null default 'pending' check (status in ('pending', 'writing', 'ready', 'failed')),
  error       text,
  model       text,
  usage       jsonb,
  lease_id    uuid,
  lease_until timestamptz,
  attempts    int         not null default 0,
  retry_at    timestamptz,
  updated_at  timestamptz not null default now(),
  unique (lecture_id, part_idx)
);

-- A person's "המשך כתיבה" restarts failed units at most 3 times a day per
-- lecture (review M6: a failure that repeats is paid on every tap).
alter table public.study_lectures
  add column if not exists retry_day date,
  add column if not exists retries   int not null default 0;

-- The hosts a recording link may point to (review M9): the university's own
-- video and course sites. Yoad adds a host in the SQL editor:
--   insert into study_private.link_hosts values ('<host>');
-- A row also allows its subdomains.
create table if not exists study_private.link_hosts (host text primary key check (host ~ '^[a-z0-9.-]+$'));
insert into study_private.link_hosts (host) values ('bgu.ac.il') on conflict do nothing;

create or replace function public.study_recordings_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare h text;
begin
  if tg_op = 'INSERT' or new.link_url is distinct from old.link_url then
    if new.link_url is not null then
      h := lower(substring(new.link_url from '^https://([^/:?#@]+)(:[0-9]+)?(/|$)'));
      if h is null or not exists (select 1 from study_private.link_hosts x where h = x.host or h like '%.' || x.host) then
        raise exception 'link host';
      end if;
    end if;
    new.link_set_by := case when new.link_url is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;
revoke all on function public.study_recordings_link() from public, anon, authenticated;
drop trigger if exists study_recordings_link on public.study_recordings;
create trigger study_recordings_link before insert or update on public.study_recordings
  for each row execute function public.study_recordings_link();

-- ── The private queue ──
-- Not reachable through the API: no grants, and the schema is not exposed.
-- A lecture the server is writing. figure_urls: storage path → signed URL,
-- signed for 48 h by the member who queued it (the worker has no Storage
-- access of its own); they go to Anthropic with each part, as today.
create table if not exists study_private.jobs (
  lecture_id        uuid        primary key references public.study_lectures (id) on delete cascade,
  figure_urls       jsonb       not null default '{}'::jsonb,
  urls_until        timestamptz,
  queued_by         uuid        references auth.users (id) on delete set null,
  queued_at         timestamptz not null default now(),
  last_kick_at      timestamptz,
  kicks_since_claim int         not null default 0
);

-- Server writing is on when pg_net, the key and the site URL are all there.
create or replace function study_private.server_on()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'net' and p.proname = 'http_post')
     and coalesce(length(study_private.secret('study_worker_key')) >= 32, false)
     and coalesce(study_private.secret('study_site_url') like 'https://%', false);
end;
$$;

-- Who may drive the writing of a lecture: only the Vercel functions, which
-- hold the server key. The worker calls with the key alone; the device path
-- (outline.ts, section.ts) with the key and the member's own token, and that
-- member must belong to the lecture's group. A member's token without the
-- key is refused (review B1: otherwise a member could save any text as
-- Claude's part, or hijack a lease).
create or replace function study_private.may_write(p_lecture uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not study_private.is_worker(p_key) then return false; end if;
  if auth.uid() is not null then
    return coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false);
  end if;
  return true;
end;
$$;

-- Writers holding a live lease in a group (outlines, parts, notes). Rows
-- written by older code have no lease: "writing" counts for 6 minutes after
-- its last save, as isStuck() did; an outline for 3.
create or replace function study_private.group_live(p_group uuid)
returns int language sql stable security definer set search_path = public as $$
  select ((select count(*) from public.study_sections s join public.study_lectures l on l.id = s.lecture_id
            where l.group_id = p_group and s.status = 'writing'
              and coalesce(s.lease_until, s.updated_at + interval '6 minutes') > now())
        + (select count(*) from public.study_recording_notes n join public.study_lectures l on l.id = n.lecture_id
            where l.group_id = p_group and n.status = 'writing' and n.lease_until > now())
        + (select count(*) from public.study_lectures l
            where l.group_id = p_group and l.status = 'outlining'
              and coalesce(l.lease_until, l.updated_at + interval '3 minutes') > now()))::int
$$;

-- Notes rows appear once both the transcript and the parts exist.
create or replace function study_private.ensure_notes(p_lecture uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if exists (select 1 from public.study_recordings r where r.lecture_id = p_lecture and r.status = 'ready') then
    insert into public.study_recording_notes (lecture_id, part_idx)
    select s.lecture_id, s.idx from public.study_sections s where s.lecture_id = p_lecture
    on conflict do nothing;
  end if;
end;
$$;

-- What can be written next, and how many writers the caps allow now.
--   p_server: the worker asks. A failed unit waits for its retry time; a
--   member's device may take it at once (a person tapped "המשך כתיבה").
--   Caps: the first unit of a phase alone (it writes the prompt cache that
--   the others read), then two per lecture; three writers per group.
create or replace function study_private.plan(p_lecture uuid, p_server boolean, p_kind text default null, p_idx int default null)
returns table (kind text, idx int, free int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
  l public.study_lectures;
  g_live int;
  n_all int; n_ready int; n_live int; n_claim int;
  v_cap int; v_free int; v_idx int;
begin
  select * into l from public.study_lectures x where x.id = p_lecture;
  if not found or l.deleted_at is not null then return; end if;
  g_live := study_private.group_live(l.group_id);
  select count(*), count(*) filter (where s.status = 'ready'),
         count(*) filter (where s.status = 'writing' and coalesce(s.lease_until, s.updated_at + interval '6 minutes') > now())
    into n_all, n_ready, n_live
    from public.study_sections s where s.lecture_id = p_lecture;

  -- 1. the outline, once
  if n_all = 0 then
    if (p_kind is null or p_kind = 'outline') and g_live < 3
       and (l.status in ('new', 'writing')
            or (l.status = 'outlining' and coalesce(l.lease_until, l.updated_at + interval '3 minutes') <= now() and l.attempts < 3)) then
      return query select 'outline'::text, null::int, 1;
    end if;
    return;
  end if;

  -- 2. the parts
  if n_ready < n_all then
    if p_kind is not null and p_kind <> 'part' then return; end if;
    v_cap := case when n_ready = 0 then 1 else 2 end;
    v_free := least(v_cap - n_live, 3 - g_live);
    if v_free <= 0 then return; end if;
    select min(s.idx), count(*) filter (where s.status <> 'failed' or s.retry_at <= now())
      into v_idx, n_claim
      from public.study_sections s
     where s.lecture_id = p_lecture and (p_idx is null or s.idx = p_idx)
       and (s.status = 'pending'
            or (s.status = 'writing' and coalesce(s.lease_until, s.updated_at + interval '6 minutes') <= now() and s.attempts < 4)
            or (s.status = 'failed' and s.attempts < 4 and (not p_server or s.retry_at <= now())));
    if v_idx is null then return; end if;
    return query select 'part'::text, v_idx, least(v_free, greatest(n_claim, 1));
    return;
  end if;

  -- 3. the recording's notes, once every part is written
  if (p_kind is not null and p_kind <> 'notes')
     or not study_private.feature_on('recordings')          -- review M10: switched off, no transcript goes anywhere
     or not exists (select 1 from public.study_recordings r where r.lecture_id = p_lecture and r.status = 'ready') then
    return;
  end if;
  select count(*) filter (where n.status = 'ready'),
         count(*) filter (where n.status = 'writing' and n.lease_until > now())
    into n_ready, n_live
    from public.study_recording_notes n where n.lecture_id = p_lecture;
  v_cap := case when n_ready = 0 then 1 else 2 end;
  v_free := least(v_cap - n_live, 3 - g_live);
  if v_free <= 0 then return; end if;
  select min(n.part_idx), count(*) filter (where n.status <> 'failed' or n.retry_at <= now())
    into v_idx, n_claim
    from public.study_recording_notes n
   where n.lecture_id = p_lecture and (p_idx is null or n.part_idx = p_idx)
     and (n.status = 'pending'
          or (n.status = 'writing' and n.lease_until <= now() and n.attempts < 4)
          or (n.status = 'failed' and n.attempts < 4 and (not p_server or n.retry_at <= now())));
  if v_idx is null then return; end if;
  return query select 'notes'::text, v_idx, least(v_free, greatest(n_claim, 1));
end;
$$;

-- Is anything of this lecture being written, waiting, or due for a retry?
create or replace function study_private.waiting(p_lecture uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_lectures l where l.id = p_lecture
                   and (l.status in ('new', 'outlining')
                        or (l.status = 'writing' and not exists (select 1 from public.study_sections s where s.lecture_id = l.id))))
      or exists (select 1 from public.study_sections s where s.lecture_id = p_lecture
                   and (s.status in ('pending', 'writing') or (s.status = 'failed' and s.attempts < 4 and s.retry_at is not null)))
      or exists (select 1 from public.study_recording_notes n where n.lecture_id = p_lecture
                   and (n.status in ('pending', 'writing') or (n.status = 'failed' and n.attempts < 4 and n.retry_at is not null)))
$$;

-- A writer that died after its claim (killed, out of memory, a thrown RPC)
-- leaves its unit "writing" with an expired lease. It is taken again while
-- attempts remain; after the last one it fails as 'lost', the sweeper stops
-- kicking it, and "המשך כתיבה" can start it over (review FE-1). The dead
-- attempt's spend stays in the ledger at its reservation's estimate.
create or replace function study_private.give_up(p_lecture uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.study_sections s
     set status = 'failed', error = 'lost', retry_at = null, lease_id = null, lease_until = null, writer = null, updated_at = now()
   where s.lecture_id = p_lecture and s.status = 'writing' and s.attempts >= 4
     and coalesce(s.lease_until, s.updated_at + interval '6 minutes') <= now();
  update public.study_recording_notes n
     set status = 'failed', error = 'lost', retry_at = null, lease_id = null, lease_until = null, updated_at = now()
   where n.lecture_id = p_lecture and n.status = 'writing' and n.attempts >= 4 and n.lease_until <= now();
  update public.study_lectures l
     set status = 'failed', error = 'lost', lease_id = null, lease_until = null, updated_at = now()
   where l.id = p_lecture and l.status = 'outlining' and l.attempts >= 3
     and coalesce(l.lease_until, l.updated_at + interval '3 minutes') <= now();
end;
$$;

-- When a failed unit may be tried again by the server (null: only by hand).
create or replace function study_private.retry_at(p_status text, p_error text, p_attempts int)
returns timestamptz language sql stable as $$
  select case
    when p_status <> 'failed' then null
    when p_error = 'timeout' then now() + interval '1 minute'
    when p_error in ('rate_limited', 'overloaded', 'network', 'empty', 'api_500', 'api_502', 'api_503', 'api_504', 'api_529')
      then now() + make_interval(mins => least(30, (2 ^ greatest(p_attempts, 1))::int))
    else null
  end
$$;

-- Kick the worker for each queued lecture with work the caps allow now.
-- p_now: called by queue/finish (kick at once); the sweeper waits 2 minutes
-- between kicks of one lecture, and stops after 15 kicks nobody claimed
-- (the worker is down or misconfigured) until someone queues it again.
create or replace function study_private.dispatch(p_lecture uuid default null, p_now boolean default false)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  j record; v_url text; v_key text; v_n int; v_total int := 0;
begin
  if not study_private.server_on() then return 0; end if;
  v_url := rtrim(study_private.secret('study_site_url'), '/') || '/api/study/work';
  v_key := study_private.secret('study_worker_key');
  for j in select jb.lecture_id, jb.last_kick_at, jb.kicks_since_claim
             from study_private.jobs jb
            where p_lecture is null or jb.lecture_id = p_lecture
            order by jb.queued_at
  loop
    perform study_private.give_up(j.lecture_id);
    perform study_private.ensure_notes(j.lecture_id);
    if not study_private.waiting(j.lecture_id) then
      delete from study_private.jobs where lecture_id = j.lecture_id;   -- done: nothing to write
      continue;
    end if;
    v_n := coalesce((select p.free from study_private.plan(j.lecture_id, true) p limit 1), 0);
    if v_n <= 0
       or (not p_now and j.last_kick_at > now() - interval '2 minutes')
       or j.kicks_since_claim >= 15 then
      continue;
    end if;
    for i in 1..v_n loop
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('lectureId', j.lecture_id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        timeout_milliseconds := 10000);
    end loop;
    update study_private.jobs set last_kick_at = now(), kicks_since_claim = kicks_since_claim + v_n
     where lecture_id = j.lecture_id;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

revoke all on all functions in schema study_private from public;

-- ── The RPCs (both writers use them) ──

-- After a lecture is saved, and on "המשך כתיבה": hand the writing to the
-- server. Answers false when server writing is not set up (the phone writes).
create or replace function public.study_queue(p_lecture uuid, p_figures jsonb default '{}'::jsonb,
                                              p_until timestamptz default null, p_retry_failed boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  l     public.study_lectures;
  v_day date := ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date;
  k     text;
  v     text;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  select * into l from public.study_lectures x where x.id = p_lecture;
  if not found or not coalesce(public.study_is_member(l.group_id), false) then raise exception 'forbidden'; end if;
  if l.deleted_at is not null then raise exception 'lecture not found'; end if;
  if p_figures is not null and (jsonb_typeof(p_figures) <> 'object' or length(p_figures::text) > 300000) then
    raise exception 'bad figures';
  end if;
  -- Review M7: a picture link must be one of THIS lecture's figures, signed
  -- by Supabase Storage for that same path. (work.ts also checks the host:
  -- it must be the project's own URL.)
  for k, v in select e.key, e.value from jsonb_each_text(coalesce(p_figures, '{}'::jsonb)) e loop
    if not exists (select 1 from jsonb_array_elements(l.slides) s, jsonb_array_elements(coalesce(s -> 'figures', '[]'::jsonb)) f
                    where f ->> 'path' = k)
       or v !~ '^https://[^/?#@]+/storage/v1/object/sign/study/[^?#]+\?token=[A-Za-z0-9._-]+$'
       or right(split_part(v, '?', 1), char_length('/storage/v1/object/sign/study/' || k)) <> '/storage/v1/object/sign/study/' || k then
      raise exception 'bad figures';
    end if;
  end loop;
  -- A person asked ("המשך כתיבה"): failed units start over, now, whether or
  -- not the server writes (review FE-4: the phone path needs it too), at most
  -- 3 times a study day per lecture (review M6).
  if p_retry_failed then
    if l.retry_day is distinct from v_day then
      update public.study_lectures x set retry_day = v_day, retries = 0 where x.id = p_lecture;
      l.retries := 0;
    end if;
    if l.retries >= 3 then raise exception 'retry limit'; end if;
    update public.study_lectures x set retries = x.retries + 1 where x.id = p_lecture;
    update public.study_lectures set status = 'new', error = null, attempts = 0
     where id = p_lecture
       and not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture)
       and (status = 'failed' or (status = 'outlining' and coalesce(lease_until, updated_at + interval '3 minutes') <= now()));
    update public.study_sections set attempts = 0, retry_at = now() where lecture_id = p_lecture and status = 'failed';
    update public.study_recording_notes set attempts = 0, retry_at = now() where lecture_id = p_lecture and status = 'failed';
  end if;
  if not study_private.server_on() then return false; end if;
  insert into study_private.jobs as j (lecture_id, figure_urls, urls_until, queued_by)
  values (p_lecture, coalesce(p_figures, '{}'::jsonb), p_until, auth.uid())
  on conflict (lecture_id) do update
     set figure_urls = case when excluded.figure_urls = '{}'::jsonb then j.figure_urls else excluded.figure_urls end,
         urls_until = case when excluded.figure_urls = '{}'::jsonb then j.urls_until else excluded.urls_until end,
         queued_by = excluded.queued_by, queued_at = now(), kicks_since_claim = 0;
  update public.study_lectures set queued_at = coalesce(queued_at, now()) where id = p_lecture;
  perform study_private.dispatch(p_lecture, true);
  return true;
end;
$$;

-- Take the next unit (or the one asked for) under a new lease. Nothing back:
-- nothing to do, or another writer holds it (section.ts answers 409 "busy").
create or replace function public.study_claim(p_lecture uuid, p_kind text default null, p_idx int default null, p_key text default null)
returns table (kind text, idx int, lease uuid, effort text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_variable
declare
  v_group uuid; v_kind text; v_idx int; v_prev text;
  v_lease uuid := gen_random_uuid();
  v_server boolean := auth.uid() is null;   -- the worker; with a member's token it is the device path (a person's tap)
begin
  if not study_private.may_write(p_lecture, p_key) then raise exception 'forbidden'; end if;
  select l.group_id into v_group from public.study_lectures l where l.id = p_lecture;
  if v_group is null then return; end if;
  perform 1 from public.study_groups g where g.id = v_group for update;   -- one claim at a time per group
  perform study_private.give_up(p_lecture);
  perform study_private.ensure_notes(p_lecture);
  select p.kind, p.idx into v_kind, v_idx from study_private.plan(p_lecture, v_server, p_kind, p_idx) p limit 1;
  if v_kind is null then return; end if;
  if v_server then update study_private.jobs set kicks_since_claim = 0 where lecture_id = p_lecture; end if;
  if v_kind = 'outline' then
    update public.study_lectures l
       set status = 'outlining', error = null, lease_id = v_lease, lease_until = now() + interval '330 seconds',
           attempts = l.attempts + 1, updated_at = now()
     where l.id = p_lecture;
    return query select 'outline'::text, null::int, v_lease, 'low'::text;
  elsif v_kind = 'part' then
    select s.error into v_prev from public.study_sections s where s.lecture_id = p_lecture and s.idx = v_idx;
    update public.study_sections s
       set status = 'writing', error = null, markdown = '', lease_id = v_lease, lease_until = now() + interval '330 seconds',
           attempts = s.attempts + 1, retry_at = null, writer = case when v_server then 'server' else 'device' end,
           updated_at = now()
     where s.lecture_id = p_lecture and s.idx = v_idx;
    return query select 'part'::text, v_idx, v_lease, case when v_prev = 'timeout' then 'medium' else 'high' end;
  else
    select n.error into v_prev from public.study_recording_notes n where n.lecture_id = p_lecture and n.part_idx = v_idx;
    update public.study_recording_notes n
       set status = 'writing', error = null, lease_id = v_lease, lease_until = now() + interval '330 seconds',
           attempts = n.attempts + 1, retry_at = null, updated_at = now()
     where n.lecture_id = p_lecture and n.part_idx = v_idx;
    return query select 'notes'::text, v_idx, v_lease, case when v_prev = 'timeout' then 'low' else 'medium' end;
  end if;
end;
$$;

-- The text so far, every ~15 s, so the group sees it grow. False: the lease
-- is gone (expired and taken by another writer); stop.
create or replace function public.study_progress(p_lecture uuid, p_idx int, p_lease uuid, p_text text, p_key text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not study_private.may_write(p_lecture, p_key) then raise exception 'forbidden'; end if;
  update public.study_sections
     set markdown = left(coalesce(p_text, ''), 200000), updated_at = now()
   where lecture_id = p_lecture and idx = p_idx and lease_id = p_lease and status = 'writing';
  return found;
end;
$$;

-- A part or a part's notes is done (ready or failed). The cost is recorded
-- even when the lease was lost: that writer still spent the money.
create or replace function public.study_finish(
  p_lecture uuid, p_kind text, p_idx int, p_lease uuid, p_status text, p_error text,
  p_text text default null, p_items jsonb default null,
  p_model text default null, p_usage jsonb default null, p_cost numeric default 0, p_key text default null,
  p_charge bigint default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_group uuid; v_ok boolean := false;
begin
  if not study_private.may_write(p_lecture, p_key) then raise exception 'forbidden'; end if;
  if p_kind not in ('part', 'notes') or p_status not in ('ready', 'failed') then raise exception 'bad finish'; end if;
  select group_id into v_group from public.study_lectures where id = p_lecture;
  if v_group is null then return false; end if;
  -- The cost: the call's reservation (study_reserve) gets its real cost; a
  -- call that was not reserved adds a row. Recorded even when the lease was lost.
  if p_charge is not null then
    update public.study_usage u
       set model = left(p_model, 80), usage = p_usage, settled_at = now(),
           cost_usd = round(least(greatest(coalesce(p_cost, 0), 0), 99.99999), 5)
     where u.id = p_charge and u.group_id = v_group and u.settled_at is null;
  elsif coalesce(p_cost, 0) > 0 then
    insert into public.study_usage (group_id, lecture_id, user_id, kind, ref, model, usage, cost_usd, settled_at)
    values (v_group, p_lecture, auth.uid(), p_kind, p_idx::text, left(p_model, 80), p_usage, round(p_cost, 5), now());
  end if;
  if p_kind = 'part' then
    update public.study_sections s
       set markdown = left(coalesce(p_text, ''), 200000), status = p_status, error = left(p_error, 200),
           model = left(p_model, 80), usage = p_usage,
           retry_at = study_private.retry_at(p_status, p_error, s.attempts),
           lease_id = null, lease_until = null, writer = null, updated_at = now()
     where s.lecture_id = p_lecture and s.idx = p_idx and s.lease_id = p_lease;
    v_ok := found;
    if v_ok and not exists (select 1 from public.study_sections where lecture_id = p_lecture and status <> 'ready') then
      update public.study_lectures set status = 'ready', updated_at = now() where id = p_lecture;
    end if;
  else
    update public.study_recording_notes n
       set items = coalesce(p_items, '[]'::jsonb), status = p_status, error = left(p_error, 200),
           model = left(p_model, 80), usage = p_usage,
           retry_at = study_private.retry_at(p_status, p_error, n.attempts),
           lease_id = null, lease_until = null, updated_at = now()
     where n.lecture_id = p_lecture and n.part_idx = p_idx and n.lease_id = p_lease;
    v_ok := found;
  end if;
  if v_ok then perform study_private.dispatch(p_lecture, true); end if;
  return v_ok;
end;
$$;

-- The outline is done: the parts are inserted once (never deleted, never
-- doubled), or the lecture fails (no slides, too many, budget).
create or replace function public.study_outline_done(
  p_lecture uuid, p_lease uuid, p_parts jsonb, p_error text default null,
  p_model text default null, p_usage jsonb default null, p_cost numeric default 0, p_key text default null,
  p_charge bigint default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_group uuid;
begin
  if not study_private.may_write(p_lecture, p_key) then raise exception 'forbidden'; end if;
  select group_id into v_group from public.study_lectures where id = p_lecture;
  if v_group is null then return false; end if;
  if p_charge is not null then
    update public.study_usage u
       set model = left(p_model, 80), usage = p_usage, settled_at = now(),
           cost_usd = round(least(greatest(coalesce(p_cost, 0), 0), 99.99999), 5)
     where u.id = p_charge and u.group_id = v_group and u.settled_at is null;
  elsif coalesce(p_cost, 0) > 0 then
    insert into public.study_usage (group_id, lecture_id, user_id, kind, ref, model, usage, cost_usd, settled_at)
    values (v_group, p_lecture, auth.uid(), 'outline', null, left(p_model, 80), p_usage, round(p_cost, 5), now());
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    update public.study_lectures
       set status = 'failed', error = left(coalesce(p_error, 'outline'), 200), lease_id = null, lease_until = null, updated_at = now()
     where id = p_lecture and lease_id = p_lease;
    return found;
  end if;
  update public.study_lectures
     set outline = p_parts, status = 'writing', error = null, lease_id = null, lease_until = null, updated_at = now()
   where id = p_lecture and lease_id = p_lease;
  if not found then return false; end if;
  insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to)
  select p_lecture, (e.ord - 1)::int, left(coalesce(e.v ->> 'heading', ''), 120), (e.v ->> 'from')::int, (e.v ->> 'to')::int
    from jsonb_array_elements(p_parts) with ordinality as e(v, ord)
   where not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture)
  on conflict do nothing;
  perform study_private.dispatch(p_lecture, true);
  return true;
end;
$$;

-- Everything a writer needs, for the worker (which cannot read the tables)
-- and the device path alike.
create or replace function public.study_writing_input(p_lecture uuid, p_with_transcript boolean default false, p_key text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not study_private.may_write(p_lecture, p_key) then raise exception 'forbidden'; end if;
  return (
    select jsonb_build_object(
      'lecture', jsonb_build_object('id', l.id, 'group_id', l.group_id, 'course', l.course, 'title', l.title,
                                    'lecturer', l.lecturer, 'lecture_date', l.lecture_date,
                                    'source_kind', l.source_kind, 'slides', l.slides),
      'sections', coalesce((select jsonb_agg(jsonb_build_object('idx', s.idx, 'title', s.title, 'slide_from', s.slide_from,
                                                                 'slide_to', s.slide_to, 'status', s.status, 'error', s.error,
                                                                 'markdown', s.markdown,
                                                                 -- the group's corrections a rewrite must keep (design-collab §2.5)
                                                                 'corrections', public.study_corrections_of(s.lecture_id, s.idx)) order by s.idx)
                              from public.study_sections s where s.lecture_id = l.id), '[]'::jsonb),
      'figures', coalesce((select j.figure_urls from study_private.jobs j where j.lecture_id = l.id), '{}'::jsonb),
      'figures_until', (select j.urls_until from study_private.jobs j where j.lecture_id = l.id),
      'recording', (select jsonb_build_object('has_times', r.has_times, 'duration_s', r.duration_s, 'status', r.status)
                      from public.study_recordings r where r.lecture_id = l.id),
      'transcript', case when p_with_transcript then
                      (select string_agg(b.lines, E'\n' order by b.idx) from public.study_transcript_blocks b where b.lecture_id = l.id)
                    end)
    from public.study_lectures l where l.id = p_lecture);
end;
$$;

revoke all on function public.study_queue(uuid, jsonb, timestamptz, boolean) from public, anon;
revoke all on function public.study_claim(uuid, text, int, text) from public;
revoke all on function public.study_progress(uuid, int, uuid, text, text) from public;
revoke all on function public.study_finish(uuid, text, int, uuid, text, text, text, jsonb, text, jsonb, numeric, text, bigint) from public;
revoke all on function public.study_outline_done(uuid, uuid, jsonb, text, text, jsonb, numeric, text, bigint) from public;
revoke all on function public.study_writing_input(uuid, boolean, text) from public;
grant execute on function public.study_queue(uuid, jsonb, timestamptz, boolean) to authenticated;
-- The worker calls these as anon with its key; the device path (section.ts,
-- outline.ts) with the key and the member's token. Without the key: 'forbidden'.
grant execute on function public.study_claim(uuid, text, int, text) to anon, authenticated;
grant execute on function public.study_progress(uuid, int, uuid, text, text) to anon, authenticated;
grant execute on function public.study_finish(uuid, text, int, uuid, text, text, text, jsonb, text, jsonb, numeric, text, bigint) to anon, authenticated;
grant execute on function public.study_outline_done(uuid, uuid, jsonb, text, text, jsonb, numeric, text, bigint) to anon, authenticated;
grant execute on function public.study_writing_input(uuid, boolean, text) to anon, authenticated;

-- ── Row Level Security for the new tables ──
alter table public.study_recordings        enable row level security;
alter table public.study_transcript_blocks enable row level security;
alter table public.study_recording_notes   enable row level security;

revoke all on public.study_recordings, public.study_transcript_blocks, public.study_recording_notes
  from anon, authenticated;
grant select, delete on public.study_recordings to authenticated;
grant insert (lecture_id, source, engine, source_name, link_url, duration_s, done_s, has_times, status, chars, consented)
  on public.study_recordings to authenticated;
grant update (engine, source_name, link_url, duration_s, done_s, has_times, status, error, chars, updated_at)
  on public.study_recordings to authenticated;
grant select, delete on public.study_transcript_blocks to authenticated;
grant insert (lecture_id, idx, start_s, end_s, lines, segments) on public.study_transcript_blocks to authenticated;
grant update (start_s, end_s, lines, segments) on public.study_transcript_blocks to authenticated;
grant select on public.study_recording_notes to authenticated;       -- written only through study_finish()

drop policy if exists "study recordings read"   on public.study_recordings;
drop policy if exists "study recordings add"    on public.study_recordings;
drop policy if exists "study recordings change" on public.study_recordings;
drop policy if exists "study recordings delete" on public.study_recordings;
drop policy if exists "study transcript read"   on public.study_transcript_blocks;
drop policy if exists "study transcript add"    on public.study_transcript_blocks;
drop policy if exists "study transcript change" on public.study_transcript_blocks;
drop policy if exists "study transcript delete" on public.study_transcript_blocks;
drop policy if exists "study notes read"        on public.study_recording_notes;

create policy "study recordings read" on public.study_recordings
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
-- Review M10: while the server switch 'recordings' is off nothing new comes in.
-- Review M2: hours of transcription are deleted only by whoever added them.
create policy "study recordings add" on public.study_recordings
  for insert with check (created_by = auth.uid() and public.study_is_member(public.study_lecture_group(lecture_id))
                         and public.study_feature_on('recordings'));
create policy "study recordings change" on public.study_recordings
  for update using (public.study_is_member(public.study_lecture_group(lecture_id)))
  with check (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study recordings delete" on public.study_recordings
  for delete using (created_by = auth.uid() and public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study transcript read" on public.study_transcript_blocks
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study transcript add" on public.study_transcript_blocks
  for insert with check (public.study_is_member(public.study_lecture_group(lecture_id)) and public.study_feature_on('recordings'));
create policy "study transcript change" on public.study_transcript_blocks
  for update using (public.study_is_member(public.study_lecture_group(lecture_id)))
  with check (public.study_is_member(public.study_lecture_group(lecture_id)));
create policy "study transcript delete" on public.study_transcript_blocks
  for delete using (exists (select 1 from public.study_recordings r
                             where r.lecture_id = study_transcript_blocks.lecture_id and r.created_by = auth.uid()));
create policy "study notes read" on public.study_recording_notes
  for select using (public.study_is_member(public.study_lecture_group(lecture_id)));

-- ── Realtime: recordings and their notes arrive live (not the blocks: large rows) ──
do $$
declare t text;
begin
  foreach t in array array['study_recordings', 'study_recording_notes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- ── The sweeper, and what is missing ──
do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is off: no sweeper. Integrations → Cron → enable pg_cron, then run this file again.';
  else
    perform cron.schedule('study-dispatch', '* * * * *', 'select study_private.dispatch()');
    perform cron.schedule('study-cron-cleanup', '17 3 * * *',
      $c$delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname in ('study-dispatch', 'study-cron-cleanup')) and end_time < now() - interval '2 days'$c$);
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then
    raise notice 'pg_net is off: lectures keep being written from the phone. Database → Extensions → pg_net.';
  end if;
  if coalesce(length(study_private.secret('study_worker_key')), 0) < 32 then
    raise notice 'Vault secret study_worker_key is missing (32+ characters, the same value as STUDY_WORKER_KEY on Vercel).';
  end if;
  if coalesce(study_private.secret('study_site_url'), '') not like 'https://%' then
    raise notice 'Vault secret study_site_url is missing (https://delo-logo-review.vercel.app).';
  end if;
end $$;

insert into study_private.schema_sections (section, version) values ('W', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

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

-- ════════════════════════════════════════════════════════════════════════
--  SECTION Z · THE LIVE GROUP QUIZ   (owned by package Z)
--  design-quiz.md §2.2. After section Q (it reads and writes its tables).
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  the live group quiz, "מבחן קבוצתי"
--  (mode 'coop') and "מבחן תחרותי" (mode 'race'). To be appended to
--  supabase/study-schema.sql AFTER the practice-questions block
--  (design-questions.md): it reads study_questions, study_question_keys and
--  study_question_flags, and writes study_answers. Re-runnable.
--
--  The database is the referee
--  ───────────────────────────
--  The clock, the answer key and the scores stay in Postgres until their
--  time. A phone sends one thing, "option 2 for question 4", through
--  study_quiz_answer(); the server stamps the time itself and keeps the
--  first answer only. The key is read only inside the reveal, which scores
--  everyone at once, closes the round for good and copies each answer into
--  its owner's private study_answers (mode 'quiz'), so a quiz answer counts
--  in that member's own mistakes and weak points, as practice does. While a
--  round is open its key is "held" (study_question_keys.held_until), so the
--  practice functions refuse to hand it out (questions-hold.sql).
--
--  Who sees what
--  ─────────────
--  study_quizzes (the whole group): that a quiz is open or was held, its
--    lectures, settings, state, host, how many play and how many answered.
--    Nothing secret, so the library banner reads it and Realtime sends it.
--  study_quiz_rounds / _players / _answers: no grants at all.
--    study_quiz_state() hands each caller what they may see: the question
--    while it is open, never its key; after the reveal the key, every
--    option's explanation and the anonymous count per option; the others'
--    scores only in a race and only to its players; in a group quiz each
--    player's result only to that player.
--
--  Realtime: only study_quizzes is published. Everything a phone must react
--  to (a join, a question opening, the answer count, the reveal, a new host,
--  the end) changes that one row; Postgres Changes, checked against its RLS
--  for every subscriber, tells the phones, and they read study_quiz_state().
--  version changes on every step; an answer only moves answered_n.
--
--  Times: a question opens 3 s after the host's tap (every phone has it by
--  then and counts down to the same server instant); answers are taken until
--  1.5 s after its deadline (a tap sent in time is not lost in transit); a
--  round still open 3 s after that is revealed by whichever phone asks next;
--  a player not seen for 30 s is "away" (not waited for; a host who is away
--  can be replaced); a quiz untouched for 20 minutes is over.
-- ═══════════════════════════════════════════════════════════════════════

-- ── A quiz: one row per game. idx = the round on screen (-1 in the lobby);
--  opens_at/closes_at repeat that round's times so a phone can start counting
--  down from the Realtime event alone.
create table if not exists public.study_quizzes (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  mode        text        not null check (mode in ('coop', 'race')),
  title       text        not null check (char_length(title) between 1 and 200),
  lecture_ids uuid[]      not null check (cardinality(lecture_ids) between 1 and 40),
  kinds       text        not null default 'all' check (kinds in ('all', 'mcq', 'case')),
  n_wanted    int         not null check (n_wanted between 3 and 30),
  seconds     int         not null check (seconds between 15 and 120),
  state       text        not null default 'lobby'
                          check (state in ('lobby', 'question', 'reveal', 'ended', 'cancelled')),
  idx         int         not null default -1 check (idx between -1 and 29),
  n_total     int         not null default 0 check (n_total between 0 and 30),
  opens_at    timestamptz,
  closes_at   timestamptz,
  answered_n  int         not null default 0 check (answered_n >= 0),
  players_n   int         not null default 0 check (players_n >= 0),
  version     int         not null default 0,
  host_id     uuid        references auth.users (id) on delete set null,
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists study_quizzes_group on public.study_quizzes (group_id, created_at desc);
-- One live quiz per group: the banner shows "the" open quiz.
create unique index if not exists study_quizzes_one_open on public.study_quizzes (group_id)
  where state in ('lobby', 'question', 'reveal');

-- ── Its questions, chosen when it starts. seconds: the host's setting, or
--  more for a long question (study_quiz__seconds). answer: the key as it was
--  at the reveal (history stays right if an exam item is re-keyed later).
--  A question deleted with its lecture leaves the round without one: a round
--  not yet open is skipped, an open one is voided at its reveal.
create table if not exists public.study_quiz_rounds (
  id          uuid        primary key default gen_random_uuid(),
  quiz_id     uuid        not null references public.study_quizzes (id) on delete cascade,
  idx         int         not null check (idx between 0 and 29),
  question_id uuid        references public.study_questions (id) on delete set null,
  seconds     int         not null check (seconds between 15 and 240),
  opens_at    timestamptz,
  closes_at   timestamptz,
  revealed_at timestamptz,
  answer      smallint,
  voided_at   timestamptz,
  voided_by   uuid        references auth.users (id) on delete set null,
  unique (quiz_id, idx)
);
create index if not exists study_quiz_rounds_question on public.study_quiz_rounds (question_id);

-- ── Who plays. seen_at: the last sign of life (every answer, host action
--  and the phone's ping every 15 s while the screen is on). joined_idx: the
--  round on screen when they joined (-1: from the lobby).
create table if not exists public.study_quiz_players (
  quiz_id    uuid        not null references public.study_quizzes (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  joined_idx int         not null default -1,
  seen_at    timestamptz not null default now(),
  left_at    timestamptz,
  score      int         not null default 0 check (score >= 0),
  correct_n  int         not null default 0 check (correct_n >= 0),
  answered_n int         not null default 0 check (answered_n >= 0),
  primary key (quiz_id, user_id)
);
create index if not exists study_quiz_players_user on public.study_quiz_players (user_id);

-- ── One answer per player per round, the first one. choice null = "לא
--  יודעים" (group quiz only). ms: from the round's opening to the server's
--  receipt, capped at the round's time. correct and points are set by the
--  reveal, never before.
create table if not exists public.study_quiz_answers (
  round_id    uuid        not null references public.study_quiz_rounds (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  choice      smallint    check (choice >= 0),
  ms          int         not null check (ms between 0 and 240000),
  answered_at timestamptz not null,
  correct     boolean,
  points      int         not null default 0 check (points between 0 and 1000),
  primary key (round_id, user_id)
);
create index if not exists study_quiz_answers_user on public.study_quiz_answers (user_id);

-- ═══════════════════════════════════════════════════════════════════════
--  Internal helpers (no grants: only the functions below call them, as
--  their owner). The public functions take the quiz row lock first
--  (select ... for update), so answers, reveals and moves of one quiz run
--  one at a time and each sees the others' result.
-- ═══════════════════════════════════════════════════════════════════════

-- Seconds for one question: the host's setting, or more for a long one
-- (reading about 15 characters a second, plus 10 seconds to choose).
create or replace function public.study_quiz__seconds(p_setting int, p_chars int)
returns int language sql immutable set search_path = public as $$
  select least(240, greatest(p_setting, ceil(coalesce(p_chars, 0) / 15.0)::int + 10));
$$;

-- The caller is playing (joined and not left).
create or replace function public.study_quiz__playing(p_quiz uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null);
$$;

-- The host is still playing and was seen in the last 30 seconds.
create or replace function public.study_quiz__host_here(p_quiz uuid)
returns boolean language sql volatile security definer set search_path = public as $$
  select exists (select 1 from public.study_quizzes z
                   join public.study_quiz_players p on p.quiz_id = z.id and p.user_id = z.host_id
                  where z.id = p_quiz and p.left_at is null
                    and p.seen_at > clock_timestamp() - interval '30 seconds');
$$;

create or replace function public.study_quiz__seen(p_quiz uuid)
returns void language sql volatile security definer set search_path = public as $$
  update public.study_quiz_players p set seen_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null;
$$;

-- Everyone still playing and not away (seen in the last 30 s) has answered
-- round p_idx. A player whose phone locked is not waited for; the deadline
-- still closes the round.
create or replace function public.study_quiz__all_answered(p_quiz uuid, p_idx int)
returns boolean language sql volatile security definer set search_path = public as $$
  select not exists (
    select 1 from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
       and p.seen_at > clock_timestamp() - interval '30 seconds'
       and not exists (select 1 from public.study_quiz_answers a
                         join public.study_quiz_rounds r on r.id = a.round_id
                        where r.quiz_id = p_quiz and r.idx = p_idx and a.user_id = p.user_id));
$$;

-- Chooses the questions when the quiz starts (the players are known then):
-- keyed and not retired, from the chosen lectures and kinds; spread over the
-- summary's parts; questions flagged as wrong last; then those the fewest of
-- these players have answered before (counted from their private answers,
-- used only for the order, never returned); then at random. A group quiz
-- follows the lectures' order; a race is shuffled.
create or replace function public.study_quiz__pick(p_quiz uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  z public.study_quizzes;
  n int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  delete from public.study_quiz_rounds r where r.quiz_id = p_quiz;
  with pool as (
    select q.id,
           char_length(q.vignette) + char_length(q.question)
             + coalesce((select sum(char_length(o)) from unnest(q.options) as o), 0) as chars,
           array_position(z.lecture_ids, coalesce(q.lecture_id, q.ref_lecture)) as lec_pos,
           coalesce(q.part_idx, -1) as part_idx,
           exists (select 1 from public.study_question_flags f
                    where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides')) as flagged,
           (select count(distinct a.user_id)
              from public.study_answers a
              join public.study_quiz_players p on p.user_id = a.user_id and p.quiz_id = p_quiz and p.left_at is null
             where a.question_id = q.id) as seen,
           random() as rnd
      from public.study_questions q
     where q.group_id = z.group_id
       and coalesce(q.lecture_id, q.ref_lecture) = any (z.lecture_ids)
       and q.retired_at is null
       and q.has_key
       and (z.kinds = 'all' or q.kind = z.kinds)
  ),
  ranked as (
    select p.*, row_number() over (partition by p.lec_pos, p.part_idx order by p.flagged, p.seen, p.rnd) as rk
      from pool p
  ),
  chosen as (
    select c.* from ranked c order by c.flagged, c.rk, c.seen, c.rnd limit z.n_wanted
  )
  insert into public.study_quiz_rounds (quiz_id, idx, question_id, seconds)
  select p_quiz,
         (row_number() over (order by case when z.mode = 'coop' then c.lec_pos end,
                                      case when z.mode = 'coop' then c.part_idx end,
                                      c.rnd))::int - 1,
         c.id,
         public.study_quiz__seconds(z.seconds, c.chars::int)
    from chosen c;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Ends the quiz: an open round is revealed first (its answers count), then
-- the quiz is 'ended' ('cancelled' if it never left the lobby).
create or replace function public.study_quiz__finish(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.state = 'question' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
  update public.study_quizzes x
     set state = case when z.state = 'lobby' then 'cancelled' else 'ended' end, ended_at = now(),
         opens_at = null, closes_at = null, version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Opens the first round at or after p_idx that still has its question,
-- 3 seconds from now, or ends the quiz when none is left. The round's key
-- is held until its reveal (ten minutes past the deadline at most).
create or replace function public.study_quiz__open(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  r  public.study_quiz_rounds;
  t0 timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select * into r from public.study_quiz_rounds x
   where x.quiz_id = p_quiz and x.idx >= p_idx and x.question_id is not null
   order by x.idx limit 1;
  if not found then
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  update public.study_quiz_rounds x
     set opens_at = t0, closes_at = t0 + make_interval(secs => x.seconds)
   where x.id = r.id;
  update public.study_question_keys k
     set held_until = t0 + make_interval(secs => r.seconds) + interval '10 minutes'
   where k.question_id = r.question_id;
  update public.study_quizzes z
     set state = 'question', idx = r.idx, opens_at = t0, closes_at = t0 + make_interval(secs => r.seconds),
         answered_n = 0, version = z.version + 1, updated_at = now()
   where z.id = p_quiz;
end;
$$;

-- Scores round p_idx if it is the one open, and closes it: the key is read
-- here and nowhere before. Points (race): a right answer is worth 500, plus
-- up to 500 more for speed; a wrong one, "לא יודעים" or none, 0. A round
-- whose question was deleted meanwhile is voided.
create or replace function public.study_quiz__reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  z   public.study_quizzes;
  r   public.study_quiz_rounds;
  k   smallint;
  t   timestamptz := clock_timestamp();
  lim int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state <> 'question' or z.idx <> p_idx then return; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if r.question_id is not null then
    select x.answer into k from public.study_question_keys x where x.question_id = r.question_id;
    update public.study_question_keys x set held_until = null where x.question_id = r.question_id;
  end if;
  if k is null then
    -- No question or no key any more: nothing is scored or recorded.
    update public.study_quiz_rounds x set revealed_at = t, voided_at = t, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  else
    lim := r.seconds * 1000;
    update public.study_quiz_answers a
       set correct = (a.choice is not null and a.choice = k),
           points = case when z.mode = 'race' and a.choice is not null and a.choice = k
                         then 500 + floor(500.0 * (lim - least(a.ms, lim)) / lim)::int
                         else 0 end
     where a.round_id = r.id;
    update public.study_quiz_players p
       set score = p.score + a.points,
           correct_n = p.correct_n + case when a.correct then 1 else 0 end,
           answered_n = p.answered_n + 1
      from public.study_quiz_answers a
     where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
    -- Each answer also lands in its owner's private practice record.
    insert into public.study_answers (user_id, question_id, choice, correct, mode, ms, answered_at)
    select a.user_id, r.question_id, a.choice, a.correct, 'quiz', a.ms, a.answered_at
      from public.study_quiz_answers a
     where a.round_id = r.id;
    update public.study_quiz_rounds x set revealed_at = t, answer = k, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  end if;
  update public.study_quizzes x
     set state = 'reveal', closes_at = least(x.closes_at, t),
         answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
         version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- A round whose time ran out (plus the grace and 3 s) and that nobody
-- revealed (every phone asleep) is revealed by whoever asks next.
create or replace function public.study_quiz__due(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if found and z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  What the phones call
-- ═══════════════════════════════════════════════════════════════════════

-- Opens a quiz in the lobby, with the caller as host and first player.
-- Errors: 'group not found', 'bad mode', 'bad kinds', 'bad count',
-- 'bad seconds', 'lecture not found', 'quiz open' (join that one instead).
create or replace function public.study_quiz_create(p_group uuid, p_mode text, p_lectures uuid[],
  p_count int, p_seconds int, p_kinds text default 'all')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  lec    uuid[];
  t      text;
  course text;
  stale  uuid;
  qid    uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if coalesce(p_mode, '') not in ('coop', 'race') then raise exception 'bad mode'; end if;
  if coalesce(p_kinds, '') not in ('all', 'mcq', 'case') then raise exception 'bad kinds'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'bad count'; end if;
  if p_seconds is null or p_seconds not between 15 and 120 then raise exception 'bad seconds'; end if;
  -- The lectures, once each, in the order given, every one of them in this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o
            from unnest(p_lectures) with ordinality as u(l, o)
           where u.l is not null
           group by u.l) x;
  if lec is null or cardinality(lec) > 40
     or exists (select 1 from unnest(lec) as l(id) where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  -- Two members tapping at once get one quiz and one 'quiz open', not an error from the index.
  perform pg_advisory_xact_lock(hashtext('study_quiz_create:' || p_group::text));
  -- A quiz nobody has touched for 20 minutes is over (its open round still counts).
  for stale in
    select x.id from public.study_quizzes x
     where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')
       and x.updated_at < now() - interval '20 minutes'
       and not exists (select 1 from public.study_quiz_players p
                        where p.quiz_id = x.id and p.seen_at > now() - interval '20 minutes')
  loop
    perform 1 from public.study_quizzes x where x.id = stale for update;
    perform public.study_quiz__finish(stale);
  end loop;
  if exists (select 1 from public.study_quizzes x
              where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')) then
    raise exception 'quiz open';
  end if;
  -- Title: the lecture's; or "<course> · n הרצאות" when they share a course; or the titles.
  select case when count(distinct btrim(l.course)) = 1 then min(btrim(l.course)) end into course
    from public.study_lectures l where l.id = any (lec);
  if cardinality(lec) = 1 then
    select l.title into t from public.study_lectures l where l.id = lec[1];
  elsif coalesce(course, '') <> '' then
    t := course || ' · ' || cardinality(lec) || ' הרצאות';
  else
    select string_agg(l.title, ' · ' order by u.o) into t
      from unnest(lec) with ordinality as u(id, o)
      join public.study_lectures l on l.id = u.id;
  end if;
  insert into public.study_quizzes (group_id, mode, title, lecture_ids, kinds, n_wanted, seconds,
                                    host_id, created_by, players_n, version)
  values (p_group, p_mode, left(coalesce(nullif(btrim(t), ''), 'מבחן'), 200), lec, p_kinds, p_count, p_seconds,
          me, me, 1, 1)
  returning id into qid;
  insert into public.study_quiz_players (quiz_id, user_id) values (qid, me);
  return qid;
end;
$$;

-- Joins (or re-joins) a quiz that is not over: from the lobby or mid-game
-- (a late joiner starts with the round on screen). A quiz left without a
-- host gets the newcomer as host. Errors: 'quiz not found', 'quiz over'.
create or replace function public.study_quiz_join(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if public.study_quiz__playing(p_quiz) then
    perform public.study_quiz__seen(p_quiz);
    return;
  end if;
  insert into public.study_quiz_players (quiz_id, user_id, joined_idx) values (p_quiz, me, z.idx)
  on conflict (quiz_id, user_id) do update set left_at = null, seen_at = clock_timestamp();
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(x.host_id, me), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Leaves. A leaving host hands over to the player seen most recently; the
-- last one out ends the quiz; if everyone left has answered, the round is
-- revealed at once.
create or replace function public.study_quiz_leave(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  z    public.study_quizzes;
  n    int;
  heir uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  update public.study_quiz_players p set left_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = me and p.left_at is null;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  if n = 0 then
    update public.study_quizzes x set players_n = 0 where x.id = p_quiz;
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  if z.host_id = me then
    select p.user_id into heir from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
     order by p.seen_at desc, p.joined_at
     limit 1;
  end if;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(heir, x.host_id), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
  if z.state = 'question' and public.study_quiz__all_answered(p_quiz, z.idx) then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- Host only. From the lobby (p_from = -1) it chooses the questions and opens
-- the first; after a reveal it opens the next, or ends the quiz after the
-- last. p_from is the round on the host's screen: a second tap, or a tap
-- after someone else moved on, does nothing.
-- Errors: 'not host', 'not revealed', 'no questions', 'quiz over'.
create or replace function public.study_quiz_next(p_quiz uuid, p_from int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.idx <> p_from then return; end if;
  if z.state = 'question' then raise exception 'not revealed'; end if;
  if z.state = 'lobby' then
    n := public.study_quiz__pick(p_quiz);
    if n = 0 then raise exception 'no questions'; end if;
    update public.study_quizzes x set n_total = n, started_at = now() where x.id = p_quiz;
    perform public.study_quiz__open(p_quiz, 0);
  else
    perform public.study_quiz__open(p_quiz, z.idx + 1);
  end if;
end;
$$;

-- The one thing a player sends. Returns the answer kept (a retry after a
-- lost response gets the first one back), never whether it is right. The
-- time is the transaction's start (now()): when the request reached the
-- database, so waiting for the quiz row behind another answer costs nothing.
-- Errors: 'not playing', 'not open' (before the countdown ends), 'closed'
-- (revealed, moved on, or more than 1.5 s after the deadline), 'bad choice'.
create or replace function public.study_quiz_answer(p_quiz uuid, p_idx int, p_choice int)
returns table (idx int, choice int, ms int, answered_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me   uuid := auth.uid();
  t    timestamptz := now();
  z    public.study_quizzes;
  r    public.study_quiz_rounds;
  nopt int;
  took int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if found and exists (select 1 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me) then
    return query select p_idx, a.choice::int, a.ms, a.answered_at
                   from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me;
    return;
  end if;
  if z.state <> 'question' or z.idx <> p_idx then raise exception 'closed'; end if;
  if t < r.opens_at then raise exception 'not open'; end if;
  if t > r.closes_at + interval '1.5 seconds' then raise exception 'closed'; end if;
  select cardinality(q.options) into nopt from public.study_questions q where q.id = r.question_id;
  if nopt is null then raise exception 'closed'; end if;
  if p_choice is null then
    if z.mode <> 'coop' then raise exception 'bad choice'; end if;
  elsif p_choice < 0 or p_choice >= nopt then
    raise exception 'bad choice';
  end if;
  took := least(r.seconds * 1000, greatest(0, floor(extract(epoch from (t - r.opens_at)) * 1000)::int));
  insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at)
  values (r.id, me, p_choice, took, t);
  update public.study_quiz_players p set seen_at = clock_timestamp() where p.quiz_id = p_quiz and p.user_id = me;
  if public.study_quiz__all_answered(p_quiz, p_idx) then
    perform public.study_quiz__reveal(p_quiz, p_idx);
  else
    update public.study_quizzes x
       set answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
           updated_at = now()
     where x.id = p_quiz;
  end if;
  return query select p_idx, p_choice, took, t;
end;
$$;

-- Closes the open round and shows the answer. Any player once the time and
-- the grace are over (so a host whose phone locked never stalls the round);
-- in a group quiz the host also earlier ("לחשוף עכשיו"; a race waits for
-- the clock or for everyone's answer). Revealing a round already revealed
-- does nothing. Errors: 'not playing', 'not open', 'too early'.
create or replace function public.study_quiz_reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state <> 'question' or z.idx <> p_idx then return; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if clock_timestamp() < z.opens_at then raise exception 'not open'; end if;
  if clock_timestamp() < z.closes_at + interval '1.5 seconds'
     and not (z.mode = 'coop' and z.host_id = me) then
    raise exception 'too early';
  end if;
  perform public.study_quiz__seen(p_quiz);
  perform public.study_quiz__reveal(p_quiz, p_idx);
end;
$$;

-- Host only: ends the quiz (an open round is revealed first, so its answers
-- count). In the lobby this cancels it.
create or replace function public.study_quiz_end(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__finish(p_quiz);
end;
$$;

-- A player takes over a host who left or has not been seen for 30 seconds
-- (phone locked, battery, closed tab). Error 'host here' otherwise.
create or replace function public.study_quiz_take_host(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if z.host_id = me then return; end if;
  if public.study_quiz__host_here(p_quiz) then raise exception 'host here'; end if;
  update public.study_quizzes x set host_id = me, version = x.version + 1, updated_at = now() where x.id = p_quiz;
  perform public.study_quiz__seen(p_quiz);
end;
$$;

-- Host only, after a reveal: the question was wrong ("ביטול השאלה"). Its
-- points come off everyone's score and its answers leave the private
-- practice records (they were copied with the same time stamp). The round
-- says who voided it.
create or replace function public.study_quiz_void(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  r  public.study_quiz_rounds;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if not found or r.revealed_at is null then raise exception 'not revealed'; end if;
  if r.voided_at is not null then return; end if;
  -- In a race the host also plays: a round is voided only while it is the
  -- current one, never after the scores have moved on (review m3).
  if z.mode = 'race' and z.idx is distinct from p_idx then raise exception 'too late'; end if;
  update public.study_quiz_players p
     set score = greatest(0, p.score - a.points),
         correct_n = greatest(0, p.correct_n - case when a.correct then 1 else 0 end),
         answered_n = greatest(0, p.answered_n - 1)
    from public.study_quiz_answers a
   where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
  delete from public.study_answers s
   using public.study_quiz_answers a
   where a.round_id = r.id and s.user_id = a.user_id and s.question_id = r.question_id
     and s.mode = 'quiz' and s.answered_at = a.answered_at;
  update public.study_quiz_answers a set points = 0 where a.round_id = r.id;
  update public.study_quiz_rounds x set voided_at = clock_timestamp(), voided_by = me where x.id = r.id;
  update public.study_quizzes x set version = x.version + 1, updated_at = now() where x.id = p_quiz;
end;
$$;

-- Every 15 s while the quiz screen is visible, and when it comes back:
-- a sign of life, the server's clock (the phone keeps its offset), and the
-- version (an event missed while the socket was down shows up here).
create or replace function public.study_quiz_ping(p_quiz uuid)
returns table (server_now timestamptz, version int, state text, idx int, answered_n int, host_here boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare z public.study_quizzes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
  end if;
  return query select clock_timestamp(), x.version, x.state, x.idx, x.answered_n, public.study_quiz__host_here(p_quiz)
                 from public.study_quizzes x where x.id = p_quiz;
end;
$$;

-- Everything one screen shows, filtered for the caller (see the header).
-- Members who do not play may watch (lobby, question, reveal) but see no
-- scores and no end summary.
create or replace function public.study_quiz_state(p_quiz uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  z      public.study_quizzes;
  r      public.study_quiz_rounds;
  q      public.study_questions;
  k      public.study_question_keys;
  player boolean;
  v_me   jsonb;
  v_rnd  jsonb;
  v_ppl  jsonb;
  v_sum  jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
    select * into z from public.study_quizzes x where x.id = p_quiz;
  end if;
  player := exists (select 1 from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me);

  select jsonb_build_object('playing', p.left_at is null, 'score', p.score, 'correct_n', p.correct_n,
                            'answered_n', p.answered_n, 'joined_idx', p.joined_idx)
    into v_me
    from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me;

  if z.state in ('question', 'reveal') then
    select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = z.idx;
    select * into q from public.study_questions x where x.id = r.question_id;
    v_rnd := jsonb_build_object(
      'idx', r.idx, 'seconds', r.seconds, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
      'voided', r.voided_at is not null, 'voided_by', r.voided_by,
      'q', case when q.id is null then null else jsonb_build_object(
             'id', q.id, 'kind', q.kind, 'vignette', q.vignette, 'question', q.question,
             'options', to_jsonb(q.options), 'slides', to_jsonb(q.slides), 'topic', q.topic, 'aspect', q.aspect,
             'lecture_id', coalesce(q.lecture_id, q.ref_lecture),
             'lecture_title', (select l.title from public.study_lectures l where l.id = coalesce(q.lecture_id, q.ref_lecture)))
           end,
      'mine', (select jsonb_build_object('choice', a.choice, 'ms', a.ms)
                 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    if z.state = 'reveal' then
      select * into k from public.study_question_keys x where x.question_id = r.question_id;
      v_rnd := v_rnd || jsonb_build_object(
        'answer', r.answer,
        'explanations', to_jsonb(coalesce(k.explanations, '{}'::text[])),
        'takeaway', coalesce(k.takeaway, ''),
        'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                              from generate_series(0, coalesce(cardinality(q.options), 0) - 1) as o(i)
                              left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                          where a.round_id = r.id and a.choice is not null group by a.choice) c
                                     on c.choice = o.i), '[]'::jsonb),
        'dont_know', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.choice is null),
        'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
        'right', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.correct),
        'points', (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me),
        'correct', (select a.correct from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    end if;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'user_id', p.user_id,
             'name', coalesce(m.name, ''),
             'host', p.user_id is not distinct from z.host_id,
             'here', p.left_at is null and p.seen_at > clock_timestamp() - interval '30 seconds',
             'left', p.left_at is not null,
             'joined_idx', p.joined_idx)
           || case when z.mode = 'race' and player
                   then jsonb_build_object('score', p.score, 'correct_n', p.correct_n,
                          'last_points', case when z.state = 'reveal' then
                              (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = p.user_id)
                            end)
                   else '{}'::jsonb end
           order by p.joined_at), '[]'::jsonb)
    into v_ppl
    from public.study_quiz_players p
    left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
   where p.quiz_id = p_quiz;

  if z.state = 'ended' and player then
    select coalesce(jsonb_agg(jsonb_build_object(
             'idx', r2.idx, 'voided', r2.voided_at is not null,
             'q', case when q2.id is null then null else jsonb_build_object(
                    'id', q2.id, 'kind', q2.kind, 'vignette', q2.vignette, 'question', q2.question,
                    'options', to_jsonb(q2.options), 'slides', to_jsonb(q2.slides), 'topic', q2.topic,
                    'aspect', q2.aspect, 'lecture_id', coalesce(q2.lecture_id, q2.ref_lecture)) end,
             'answer', r2.answer, 'explanations', to_jsonb(coalesce(k2.explanations, '{}'::text[])),
             'takeaway', coalesce(k2.takeaway, ''),
             'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id),
             'right', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.correct),
             'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                                   from generate_series(0, coalesce(cardinality(q2.options), 0) - 1) as o(i)
                                   left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                               where a.round_id = r2.id and a.choice is not null group by a.choice) c
                                          on c.choice = o.i), '[]'::jsonb),
             'mine', (select jsonb_build_object('choice', a.choice, 'correct', a.correct, 'points', a.points)
                        from public.study_quiz_answers a where a.round_id = r2.id and a.user_id = me))
             order by r2.idx), '[]'::jsonb)
      into v_sum
      from public.study_quiz_rounds r2
      left join public.study_questions q2 on q2.id = r2.question_id
      left join public.study_question_keys k2 on k2.question_id = r2.question_id
     where r2.quiz_id = p_quiz and r2.revealed_at is not null;
  end if;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'quiz', jsonb_build_object(
      'id', z.id, 'group_id', z.group_id, 'mode', z.mode, 'title', z.title, 'lecture_ids', to_jsonb(z.lecture_ids),
      'kinds', z.kinds, 'n_wanted', z.n_wanted, 'seconds', z.seconds, 'state', z.state, 'idx', z.idx,
      'n_total', z.n_total, 'opens_at', z.opens_at, 'closes_at', z.closes_at, 'answered_n', z.answered_n,
      'players_n', z.players_n, 'version', z.version, 'host_id', z.host_id,
      'created_at', z.created_at, 'started_at', z.started_at, 'ended_at', z.ended_at),
    'me', v_me,
    'host_here', public.study_quiz__host_here(p_quiz),
    'players', v_ppl,
    'round', v_rnd,
    'summary', v_sum);
end;
$$;

-- The library banner: the group's live quiz, unless nobody has touched it
-- for 20 minutes. playing: the caller is in it; names: who is in it, in the
-- order they joined (the banner says "בפנים: שוהם, נועה +3").
create or replace function public.study_quiz_open(p_group uuid)
returns table (id uuid, mode text, title text, state text, idx int, n_total int, players_n int,
               host_id uuid, playing boolean, names text[])
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.state, z.idx, z.n_total, z.players_n, z.host_id,
         exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = z.id and p.user_id = auth.uid() and p.left_at is null),
         array(select coalesce(m.name, '') from public.study_quiz_players p
                 left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
                where p.quiz_id = z.id and p.left_at is null order by p.joined_at)
    from public.study_quizzes z
   where z.group_id = p_group
     and public.study_is_member(p_group)
     and z.state in ('lobby', 'question', 'reveal')
     and (z.updated_at > now() - interval '20 minutes'
          or exists (select 1 from public.study_quiz_players p
                      where p.quiz_id = z.id and p.seen_at > now() - interval '20 minutes'))
   order by z.created_at desc
   limit 1;
$$;

-- The setup screen: how many questions each lecture has ready (keyed, not
-- retired). Security invoker: RLS on study_questions keeps it to members.
create or replace function public.study_quiz_pool(p_group uuid)
returns table (lecture_id uuid, mcq int, cases int)
language sql stable set search_path = public as $$
  select coalesce(q.lecture_id, q.ref_lecture),
         (count(*) filter (where q.kind = 'mcq'))::int,
         (count(*) filter (where q.kind = 'case'))::int
    from public.study_questions q
   where q.group_id = p_group and q.retired_at is null and q.has_key
     and coalesce(q.lecture_id, q.ref_lecture) is not null
   group by 1;
$$;

-- The "יחד" tab: the group's last quizzes. The group's share of right
-- answers is shared; my_* are the caller's own, my_rank only in a race the
-- caller played (its table was shown to its players anyway).
create or replace function public.study_quiz_recent(p_group uuid, p_limit int default 5)
returns table (id uuid, mode text, title text, ended_at timestamptz, players_n int, rounds int,
               right_pct int, played boolean, my_correct int, my_answered int, my_rank int)
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.ended_at,
         (select count(*) from public.study_quiz_players p where p.quiz_id = z.id)::int,
         (select count(*) from public.study_quiz_rounds r
           where r.quiz_id = z.id and r.revealed_at is not null and r.voided_at is null)::int,
         (select round(100.0 * count(*) filter (where a.correct) / nullif(count(*), 0))::int
            from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id
           where r.quiz_id = z.id and r.voided_at is null),
         me.user_id is not null, me.correct_n, me.answered_n,
         case when z.mode = 'race' and me.user_id is not null then
           (select count(*) + 1 from public.study_quiz_players o where o.quiz_id = z.id and o.score > me.score)::int
         end
    from public.study_quizzes z
    left join public.study_quiz_players me on me.quiz_id = z.id and me.user_id = auth.uid()
   where z.group_id = p_group and public.study_is_member(p_group) and z.state = 'ended'
   order by z.ended_at desc
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_quizzes      enable row level security;
alter table public.study_quiz_rounds  enable row level security;
alter table public.study_quiz_players enable row level security;
alter table public.study_quiz_answers enable row level security;

-- (In study-schema.sql the file's loop has already dropped this; the drop
-- keeps this block re-runnable on its own.)
drop policy if exists "study quizzes read" on public.study_quizzes;
create policy "study quizzes read" on public.study_quizzes
  for select using (public.study_is_member(group_id));
-- study_quiz_rounds, study_quiz_players, study_quiz_answers: no policy on purpose.

revoke all on public.study_quizzes, public.study_quiz_rounds, public.study_quiz_players, public.study_quiz_answers
  from anon, authenticated;
grant select on public.study_quizzes to authenticated;

revoke all on function public.study_quiz__seconds(int, int), public.study_quiz__playing(uuid),
  public.study_quiz__host_here(uuid), public.study_quiz__seen(uuid), public.study_quiz__all_answered(uuid, int),
  public.study_quiz__pick(uuid), public.study_quiz__finish(uuid), public.study_quiz__open(uuid, int),
  public.study_quiz__reveal(uuid, int), public.study_quiz__due(uuid)
  from public, anon, authenticated;
revoke all on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  from public, anon;
grant execute on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  to authenticated;

-- ── Realtime: the quiz row only (never rounds, players or answers).
do $$
begin
  begin
    alter publication supabase_realtime add table public.study_quizzes;
  exception when duplicate_object then
    null;
  end;
end $$;

insert into study_private.schema_sections (section, version) values ('Z', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();

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
  -- The block keeps its indentation: two spaces before a paragraph that follows
  -- a list make it part of the list's last item, and a space and a tab make it
  -- code (package K's edits.test.ts found both; check KH1).
  if substring(p_after from '^[ \t]*') is distinct from substring(p_before from '^[ \t]*') then
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
    -- An item that reads as a rule ("- ---") is a rule, and a fence or an HTML
    -- block opened inside an item (or in a quote or list nested in it) reaches
    -- past its line (check KH2).
    if p_after ~ '^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$'
       or p_after ~ '^ {0,3}([-*+]|[0-9]{1,9}[.)])([ \t]*(>|[-*+][ \t]|[0-9]{1,9}[.)][ \t]))*[ \t]*(```|~~~|<[A-Za-z!?/])' then
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

-- ════════════════════════════════════════════════════════════════════════
--  SECTION P · READING PROGRESS, PRIVATE NUMBERS, THE PLAN, MARATHONS   (owned by package A)
--  design-me.md §2.3 (block B). After section Q: its SQL functions read study_questions and study_answers.
-- ════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  private progress, the study plan and
--  marathons for תמצית (item 7). Appended to supabase/study-schema.sql AFTER
--  the practice-questions block (it reads study_questions and study_answers);
--  the quiz and flashcards blocks may come before or after it. Re-runnable.
--
--  Who sees what: reading progress, the numbers and the plan are visible
--  only to their owner and never published; marathons and who is in are
--  visible to every member of the group and published to Realtime. Nothing
--  here calls Claude.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  2. Reading progress (private)
-- ═══════════════════════════════════════════════════════════════════════
-- A summary part counts as read once its end reached the reading line and
-- the member spent long enough on it (LectureView's tracker), or by hand
-- (a plan task ticked). seconds = time spent on the part, for the member's
-- own reading speed. Never published: (user, lecture) keys stay private.
create table if not exists public.study_read_parts (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  done_at    timestamptz not null default now(),
  seconds    int         not null default 0 check (seconds between 0 and 86400),
  primary key (user_id, lecture_id, part_idx)
);
create index if not exists study_read_parts_lecture on public.study_read_parts (lecture_id);

-- Where the member stopped in a lecture: "continue where you stopped" on
-- any device.
create table if not exists public.study_read_places (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  lecture_id uuid        not null references public.study_lectures (id) on delete cascade,
  part_idx   int         not null check (part_idx between 0 and 199),
  anchor     int         not null check (anchor between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (user_id, lecture_id)
);
create index if not exists study_read_places_lecture on public.study_read_places (lecture_id);

-- A part that is deleted (the lecture was split into parts again) takes the
-- members' "read" marks for its number with it: the new part with that
-- number is different text. Definer, so it clears every member's rows.
create or replace function public.study_read_parts_forget()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.study_read_parts r where r.lecture_id = old.lecture_id and r.part_idx = old.idx;
  return old;
end;
$$;
revoke all on function public.study_read_parts_forget() from public, anon, authenticated;
drop trigger if exists study_read_parts_forget on public.study_sections;
create trigger study_read_parts_forget after delete on public.study_sections
  for each row execute function public.study_read_parts_forget();

-- Saves the caller's place in a lecture; with p_done, also marks that part
-- read (once; the first time counts). Errors: 'not signed in',
-- 'lecture not found', 'bad part'.
create or replace function public.study_note_reading(p_lecture uuid, p_part int, p_anchor int,
  p_done boolean default false, p_seconds int default 0)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if not exists (select 1 from public.study_sections s where s.lecture_id = p_lecture and s.idx = p_part) then
    raise exception 'bad part';
  end if;
  insert into public.study_read_places (user_id, lecture_id, part_idx, anchor, updated_at)
  values (me, p_lecture, p_part, greatest(0, least(coalesce(p_anchor, 0), 99999)), now())
  on conflict (user_id, lecture_id)
  do update set part_idx = excluded.part_idx, anchor = excluded.anchor, updated_at = excluded.updated_at;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    values (me, p_lecture, p_part, now(), greatest(0, least(coalesce(p_seconds, 0), 86400)))
    on conflict (user_id, lecture_id, part_idx) do nothing;
  end if;
end;
$$;

-- Marks parts read or unread by hand (a plan task ticked or unticked).
-- Unknown part numbers are ignored. Returns how many rows changed.
create or replace function public.study_mark_parts(p_lecture uuid, p_parts int[], p_done boolean)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lecture is null or not public.study_is_member(public.study_lecture_group(p_lecture)) then
    raise exception 'lecture not found';
  end if;
  if cardinality(coalesce(p_parts, '{}')) > 200 then raise exception 'bad part'; end if;
  if coalesce(p_done, false) then
    insert into public.study_read_parts (user_id, lecture_id, part_idx, done_at, seconds)
    select me, p_lecture, s.idx, now(), 0
      from public.study_sections s
     where s.lecture_id = p_lecture and s.idx = any (p_parts)
    on conflict (user_id, lecture_id, part_idx) do nothing;
  else
    delete from public.study_read_parts r
     where r.user_id = me and r.lecture_id = p_lecture and r.part_idx = any (p_parts);
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Private numbers (security invoker: RLS keeps them to the caller)
-- ═══════════════════════════════════════════════════════════════════════
-- Per lecture of the group, as of p_asof: the caller's read mark and parts,
-- the active keyed questions (practice and past-exam items linked to it) and
-- the caller's answers to them. p_asof = the start of today freezes the
-- plan's "today"; now() gives the live numbers.
--   correct_now / wrong_now: questions whose LATEST answer is right / wrong
--   first_try: questions whose FIRST answer was right
--   parts: [{i, t, from, to, chars, ready}] for time estimates
create or replace function public.study_my_lectures(p_group uuid, p_asof timestamptz default now())
returns table (lecture_id uuid, course text, title text, lecture_date date, created_at timestamptz, status text,
               slides int, parts jsonb, read_at timestamptz, parts_done int[], part_seconds jsonb,
               questions int, cases int, answered int, correct_now int, first_try int, wrong_now int,
               answers int, last_answer_at timestamptz)
language sql stable set search_path = public as $$
  with lec as (
    select l.id, l.course, l.title, l.lecture_date, l.created_at, l.status, jsonb_array_length(l.slides) as slides
    from public.study_lectures l
    where l.group_id = p_group and l.created_at <= p_asof and l.deleted_at is null
  ),
  q as (
    select q.id, coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.kind
    from public.study_questions q
    where q.group_id = p_group and q.retired_at is null and q.has_key and q.created_at <= p_asof
      and coalesce(q.lecture_id, q.ref_lecture) is not null
  ),
  a as (
    select a.question_id, a.correct, a.answered_at,
           row_number() over (partition by a.question_id order by a.answered_at desc, a.id) as rn_last,
           row_number() over (partition by a.question_id order by a.answered_at asc, a.id) as rn_first
    from public.study_answers a
    join q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_asof
  ),
  qs as (
    select q.lecture_id,
           count(*)::int as questions,
           (count(*) filter (where q.kind = 'case'))::int as cases,
           (count(*) filter (where la.question_id is not null))::int as answered,
           (count(*) filter (where la.correct))::int as correct_now,
           (count(*) filter (where fa.correct))::int as first_try,
           (count(*) filter (where la.correct = false))::int as wrong_now
    from q
    left join a la on la.question_id = q.id and la.rn_last = 1
    left join a fa on fa.question_id = q.id and fa.rn_first = 1
    group by q.lecture_id
  ),
  an as (
    select q.lecture_id, count(*)::int as answers, max(a.answered_at) as last_at
    from a join q on q.id = a.question_id
    group by q.lecture_id
  ),
  pt as (
    select s.lecture_id,
           jsonb_agg(jsonb_build_object('i', s.idx, 't', s.title, 'from', s.slide_from, 'to', s.slide_to,
                                        'chars', char_length(s.markdown), 'ready', s.status = 'ready') order by s.idx) as parts
    from public.study_sections s
    where s.lecture_id in (select id from lec)
    group by s.lecture_id
  ),
  rp as (
    select r.lecture_id, array_agg(r.part_idx order by r.part_idx) as done,
           jsonb_object_agg(r.part_idx::text, r.seconds) as secs
    from public.study_read_parts r
    where r.user_id = auth.uid() and r.done_at <= p_asof and r.lecture_id in (select id from lec)
    group by r.lecture_id
  ),
  rd as (
    select r.lecture_id, r.read_at
    from public.study_reads r
    where r.user_id = auth.uid() and r.read_at <= p_asof and r.lecture_id in (select id from lec)
  )
  select l.id, btrim(l.course), l.title, l.lecture_date, l.created_at, l.status, l.slides,
         coalesce(pt.parts, '[]'::jsonb), rd.read_at, coalesce(rp.done, '{}'), coalesce(rp.secs, '{}'::jsonb),
         coalesce(qs.questions, 0), coalesce(qs.cases, 0), coalesce(qs.answered, 0), coalesce(qs.correct_now, 0),
         coalesce(qs.first_try, 0), coalesce(qs.wrong_now, 0), coalesce(an.answers, 0), an.last_at
  from lec l
  left join pt on pt.lecture_id = l.id
  left join rp on rp.lecture_id = l.id
  left join rd on rd.lecture_id = l.id
  left join qs on qs.lecture_id = l.id
  left join an on an.lecture_id = l.id
  order by l.created_at, l.id;
$$;

-- Weak points (item 7), from the caller's practice AND live-quiz answers
-- (the quiz copies each answer into study_answers, mode 'quiz').
--   1. Evidence: the FIRST answer to a question in each study day (Israel
--      time, the day starts 04:00), on active keyed questions with a topic.
--      "לא יודעים" is a wrong answer. Re-answers later the same day (right
--      after reading the explanation) do not count.
--   2. Weight: 0.5 ^ (age in days / 21): an answer three weeks old counts half.
--   3. Score: (Σ w·correct + 2 × 0.7) / (Σ w + 2): two pseudo-answers at 70%
--      keep a topic with little evidence near "unknown, probably fine".
--   4. Topic key: lower(btrim(topic)), across lectures. Per aspect the same.
--   5. status: 'weak'  when items >= 2, Σw >= 1.5, score < 0.6 and
--                      (a question is wrong right now or score < 0.5);
--              'watch' when items >= 2 and score < 0.75; else 'ok'.
create or replace function public.study_my_weak_points(p_group uuid, p_now timestamptz default now())
returns table (topic_key text, topic text, score numeric, weight numeric, items int, wrong_now int,
               status text, worst_aspect text, aspects jsonb, lecture_ids uuid[], slides jsonb, last_at timestamptz)
language sql stable set search_path = public as $$
  with al as (   -- every answer of the caller to an active keyed question with a topic
    select lower(btrim(q.topic)) as topic_key, btrim(q.topic) as topic, q.aspect,
           coalesce(q.lecture_id, q.ref_lecture) as lecture_id, q.id as question_id, q.slides,
           a.id as answer_id, a.correct, a.answered_at,
           row_number() over (
             partition by a.question_id, ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
             order by a.answered_at, a.id) as rn
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and a.answered_at <= p_now
      and q.group_id = p_group and q.retired_at is null and q.has_key and btrim(q.topic) <> ''
  ),
  w as (         -- the evidence: the first answer per question per study day, weighted by age
    select al.*,
           power(0.5::numeric, (greatest(0, extract(epoch from (p_now - al.answered_at))) / 86400.0 / 21.0)::numeric) as wt,
           (case when al.correct then 1 else 0 end)::numeric as y
    from al
    where al.rn = 1
  ),
  latest as (    -- each question's latest answer (any), for "wrong right now"
    select distinct on (al.question_id) al.question_id, al.correct
    from al
    order by al.question_id, al.answered_at desc, al.answer_id desc
  ),
  asp as (
    select w.topic_key, w.aspect, round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight, count(distinct w.question_id)::int as items
    from w
    group by w.topic_key, w.aspect
  ),
  miss as (   -- slides of questions answered wrong, most missed first
    select m.topic_key, jsonb_agg(jsonb_build_object('l', m.lecture_id, 'n', m.n, 'c', m.c)
                                  order by m.c desc, m.n) filter (where m.rk <= 3) as slides
    from (
      select w.topic_key, w.lecture_id, s.n, count(*) as c,
             row_number() over (partition by w.topic_key order by count(*) desc, s.n) as rk
      from w cross join lateral unnest(w.slides) as s(n)
      where not w.correct and w.lecture_id is not null
      group by w.topic_key, w.lecture_id, s.n
    ) m
    group by m.topic_key
  ),
  t as (
    select w.topic_key, min(w.topic) as topic,
           round((sum(w.wt * w.y) + 1.4) / (sum(w.wt) + 2), 3) as score,
           round(sum(w.wt), 2) as weight,
           count(distinct w.question_id)::int as items,
           (count(distinct w.question_id) filter (where lt.correct = false))::int as wrong_now,
           array_agg(distinct w.lecture_id) filter (where w.lecture_id is not null) as lecture_ids,
           max(w.answered_at) as last_at
    from w join latest lt on lt.question_id = w.question_id
    group by w.topic_key
  )
  select t.topic_key, t.topic, t.score, t.weight, t.items, t.wrong_now,
         case when t.items >= 2 and t.weight >= 1.5 and t.score < 0.6 and (t.wrong_now > 0 or t.score < 0.5) then 'weak'
              when t.items >= 2 and t.score < 0.75 then 'watch'
              else 'ok' end,
         (select a.aspect from asp a where a.topic_key = t.topic_key order by a.score, a.weight desc, a.aspect limit 1),
         (select jsonb_agg(jsonb_build_object('aspect', a.aspect, 'score', a.score, 'items', a.items)
                           order by a.score, a.aspect)
            from asp a where a.topic_key = t.topic_key),
         coalesce(t.lecture_ids, '{}'), coalesce(m.slides, '[]'::jsonb), t.last_at
  from t
  left join miss m on m.topic_key = t.topic_key
  order by t.score, t.weight desc, t.topic_key;
$$;

-- Activity per study day (Israel time, from 04:00): answers (practice and
-- quiz), right ones, practice time (each answer capped at 5 minutes), parts
-- read and reading time. Flashcard reviews come from study_my_card_days.
create or replace function public.study_my_days(p_group uuid, p_days int default 28, p_now timestamptz default now())
returns table (day date, answers int, correct int, practice_seconds int, parts_read int, read_seconds int)
language sql stable set search_path = public as $$
  with lim as (
    select p_now - make_interval(days => greatest(1, least(coalesce(p_days, 28), 366))) as since
  ),
  d as (
    select ((a.answered_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date as day,
           1 as answer, case when a.correct then 1 else 0 end as ok, least(coalesce(a.ms, 0), 300000) as ms,
           0 as part, 0 as rs
    from public.study_answers a
    join public.study_questions q on q.id = a.question_id
    where a.user_id = auth.uid() and q.group_id = p_group
      and a.answered_at <= p_now and a.answered_at > (select since from lim)
    union all
    select ((r.done_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date, 0, 0, 0, 1, r.seconds
    from public.study_read_parts r
    join public.study_lectures l on l.id = r.lecture_id
    where r.user_id = auth.uid() and l.group_id = p_group
      and r.done_at <= p_now and r.done_at > (select since from lim)
  )
  select d.day, sum(d.answer)::int, sum(d.ok)::int, (sum(d.ms) / 1000)::int, sum(d.part)::int, sum(d.rs)::int
  from d
  group by d.day
  order by d.day;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  4. The study plan (private)
-- ═══════════════════════════════════════════════════════════════════════
-- One active plan per member per group. Scope = every lecture of the listed
-- courses (also ones uploaded later) + lectures added by hand − lectures
-- left out by hand (study_plan_lectures).
create table if not exists public.study_plans (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  group_id      uuid        not null references public.study_groups (id) on delete cascade,
  title         text        not null check (char_length(btrim(title)) between 1 and 120),
  exam_date     date        not null,
  courses       text[]      not null default '{}' check (cardinality(courses) <= 20),
  daily_minutes int         not null default 120 check (daily_minutes between 15 and 720),
  days_off      smallint[]  not null default '{}' check (days_off <@ '{0,1,2,3,4,5,6}'::smallint[]),
  final_review  boolean     not null default true,
  status        text        not null default 'active' check (status in ('active', 'archived')),
  replanned_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists study_plans_one_active on public.study_plans (user_id, group_id) where status = 'active';

create table if not exists public.study_plan_lectures (
  plan_id    uuid    not null references public.study_plans (id) on delete cascade,
  lecture_id uuid    not null references public.study_lectures (id) on delete cascade,
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  included   boolean not null,            -- true: added by hand; false: left out by hand
  primary key (plan_id, lecture_id)
);
create index if not exists study_plan_lectures_lecture on public.study_plan_lectures (lecture_id);

-- A task the member ticked by hand on a day (key as shared/study/plan.ts makes it).
create table if not exists public.study_plan_checks (
  plan_id    uuid        not null references public.study_plans (id) on delete cascade,
  day        date        not null,
  task_key   text        not null check (char_length(task_key) between 3 and 200),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  checked_at timestamptz not null default now(),
  primary key (plan_id, day, task_key)
);

-- Creates the caller's plan (p_plan null: the previous active plan goes to
-- the archive) or changes it (its lecture choices are replaced, and today is
-- planned again). Returns the plan id. Errors: 'not signed in',
-- 'group not found', 'bad title', 'bad date', 'bad minutes', 'bad days',
-- 'bad courses', 'lecture not found', 'too many lectures', 'plan not found'.
create or replace function public.study_plan_save(p_plan uuid, p_group uuid, p_title text, p_exam_date date,
  p_courses text[], p_add uuid[], p_drop uuid[], p_daily_minutes int, p_days_off int[], p_final_review boolean default true)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  pid   uuid;
  today date := ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date;
  crs   text[];
  offs  smallint[];
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_exam_date is null or p_exam_date <= today or p_exam_date > today + 366 then raise exception 'bad date'; end if;
  if p_daily_minutes is null or p_daily_minutes not between 15 and 720 then raise exception 'bad minutes'; end if;
  if cardinality(coalesce(p_days_off, '{}')) > 6
     or exists (select 1 from unnest(coalesce(p_days_off, '{}')) d where d is null or d not between 0 and 6) then
    raise exception 'bad days';
  end if;
  if cardinality(coalesce(p_courses, '{}')) > 20
     or exists (select 1 from unnest(coalesce(p_courses, '{}')) c where char_length(btrim(coalesce(c, ''))) not between 1 and 120) then
    raise exception 'bad courses';
  end if;
  if cardinality(coalesce(p_add, '{}')) + cardinality(coalesce(p_drop, '{}')) > 200 then raise exception 'too many lectures'; end if;
  if exists (select 1 from unnest(coalesce(p_add, '{}') || coalesce(p_drop, '{}')) as l(id)
              where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  select coalesce(array_agg(distinct btrim(c) order by btrim(c)), '{}') into crs from unnest(coalesce(p_courses, '{}')) c;
  select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into offs from unnest(coalesce(p_days_off, '{}')) d;
  perform pg_advisory_xact_lock(hashtext('study_plan:' || me::text));
  if p_plan is null then
    update public.study_plans set status = 'archived', updated_at = now()
     where user_id = me and group_id = p_group and status = 'active';
    insert into public.study_plans (user_id, group_id, title, exam_date, courses, daily_minutes, days_off, final_review)
    values (me, p_group, btrim(p_title), p_exam_date, crs, p_daily_minutes, offs, coalesce(p_final_review, true))
    returning id into pid;
  else
    update public.study_plans
       set title = btrim(p_title), exam_date = p_exam_date, courses = crs, daily_minutes = p_daily_minutes,
           days_off = offs, final_review = coalesce(p_final_review, true), replanned_at = now(), updated_at = now()
     where id = p_plan and user_id = me and group_id = p_group and status = 'active'
    returning id into pid;
    if pid is null then raise exception 'plan not found'; end if;
    delete from public.study_plan_lectures where plan_id = pid;
  end if;
  insert into public.study_plan_lectures (plan_id, lecture_id, user_id, included)
  select pid, l.id, me, true from (select distinct unnest(coalesce(p_add, '{}')) as id) l
  union all
  select pid, l.id, me, false from (select distinct unnest(coalesce(p_drop, '{}')) as id) l
   where not (l.id = any (coalesce(p_add, '{}')));
  return pid;
end;
$$;

-- "לסדר מחדש את היום": today is planned again from now. 'plan not found'.
create or replace function public.study_plan_replan(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set replanned_at = now(), updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- "סיום התוכנית": the plan goes to the archive. 'plan not found'.
create or replace function public.study_plan_end(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.study_plans set status = 'archived', updated_at = now()
   where id = p_plan and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'plan not found'; end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Marathons (shared inside the group)
-- ═══════════════════════════════════════════════════════════════════════
-- agenda: the run-of-show, an array of steps (shared/study/agenda.ts):
--   { k: 'intro'|'read'|'quiz'|'break'|'questions'|'free'|'wrap',
--     l?: lecture id (read, quiz: required; one of lecture_ids),
--     from?, to?: summary part numbers (read), min: planned minutes 1-240,
--     n?: quiz questions 3-30, mode?: 'coop'|'race', title?: ≤ 80 chars }
-- step: the step on screen (-1 before the start). Any member may move it;
-- study_marathon_step() takes "from" so two taps at once move it once.
-- version: bumped by every change, for "someone else edited it".
create table if not exists public.study_marathons (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  title       text        not null check (char_length(btrim(title)) between 1 and 120),
  starts_at   timestamptz not null,
  minutes     int         not null check (minutes between 30 and 720),
  place       text        not null default '' check (char_length(place) <= 120),
  note        text        not null default '' check (char_length(note) <= 500),
  lecture_ids uuid[]      not null default '{}' check (cardinality(lecture_ids) <= 20),
  agenda      jsonb       not null default '[]'::jsonb
                          check (jsonb_typeof(agenda) = 'array' and jsonb_array_length(agenda) <= 40),
  state       text        not null default 'planned' check (state in ('planned', 'live', 'ended', 'cancelled')),
  step        int         not null default -1 check (step between -1 and 39),
  step_at     timestamptz,
  started_at  timestamptz,
  ended_at    timestamptz,
  version     int         not null default 1 check (version >= 1),
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists study_marathons_group on public.study_marathons (group_id, starts_at);

-- Who is in. Its own id: the table is published, and a key must say nothing.
create table if not exists public.study_marathon_people (
  id          uuid        primary key default gen_random_uuid(),
  marathon_id uuid        not null references public.study_marathons (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  answer      text        not null check (answer in ('in', 'maybe', 'out')),
  updated_at  timestamptz not null default now(),
  unique (marathon_id, user_id)
);
create index if not exists study_marathon_people_user on public.study_marathon_people (user_id);

create or replace function public.study_marathon_group(m uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.study_marathons where id = m;
$$;

-- A marathon is over when it ended, was cancelled, or is 3 hours past its
-- planned end (nobody pressed "סיום"): no cron needed.
create or replace function public.study_marathon__over(m public.study_marathons)
returns boolean language sql stable set search_path = public as $$
  select m.state in ('ended', 'cancelled') or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours';
$$;

-- The run-of-show is checked here, so a phone cannot store junk for others.
create or replace function public.study_marathon__agenda_ok(p_agenda jsonb, p_lectures uuid[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  s jsonb;
  num constant text := '^[0-9]{1,4}$';
begin
  if p_agenda is null or jsonb_typeof(p_agenda) <> 'array' or jsonb_array_length(p_agenda) > 40 then return false; end if;
  for s in select x from jsonb_array_elements(p_agenda) as x loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(s) k where k not in ('k', 'l', 'from', 'to', 'min', 'n', 'mode', 'title')) then
      return false;
    end if;
    if coalesce(s ->> 'k', '') not in ('intro', 'read', 'quiz', 'break', 'questions', 'free', 'wrap') then return false; end if;
    if jsonb_typeof(s -> 'min') is distinct from 'number' or (s ->> 'min') !~ num or (s ->> 'min')::int not between 1 and 240 then
      return false;
    end if;
    if s ? 'l' then
      if jsonb_typeof(s -> 'l') <> 'string' or (s ->> 'l') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not ((s ->> 'l')::uuid = any (coalesce(p_lectures, '{}'))) then
        return false;
      end if;
    elsif s ->> 'k' in ('read', 'quiz') then
      return false;
    end if;
    if s ? 'from' and (jsonb_typeof(s -> 'from') <> 'number' or (s ->> 'from') !~ num or (s ->> 'from')::int > 199) then return false; end if;
    if s ? 'to' and (jsonb_typeof(s -> 'to') <> 'number' or (s ->> 'to') !~ num or (s ->> 'to')::int > 199
                     or (s ? 'from' and (s ->> 'to')::int < (s ->> 'from')::int)) then
      return false;
    end if;
    if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n') !~ num or (s ->> 'n')::int not between 3 and 30) then return false; end if;
    if s ? 'mode' and coalesce(s ->> 'mode', '') not in ('coop', 'race') then return false; end if;
    if s ? 'title' and (jsonb_typeof(s -> 'title') <> 'string' or char_length(s ->> 'title') > 80) then return false; end if;
  end loop;
  return true;
end;
$$;

-- Creates (p_id null; the creator is "in") or changes a marathon. Returns its
-- id and new version. Errors: 'not signed in', 'group not found',
-- 'bad title', 'bad minutes', 'bad time', 'lecture not found', 'bad agenda',
-- 'marathon not found', 'marathon over', 'conflict' (someone else saved first).
create or replace function public.study_marathon_save(p_id uuid, p_version int, p_group uuid, p_title text,
  p_starts_at timestamptz, p_minutes int, p_place text, p_note text, p_lectures uuid[], p_agenda jsonb)
returns table (id uuid, version int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me  uuid := auth.uid();
  m   public.study_marathons;
  lec uuid[];
  ag  jsonb := coalesce(p_agenda, '[]'::jsonb);
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title'; end if;
  if p_minutes is null or p_minutes not between 30 and 720 then raise exception 'bad minutes'; end if;
  if p_starts_at is null or p_starts_at > now() + interval '180 days' then raise exception 'bad time'; end if;
  -- The lectures, once each, in the order given, all of this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o from unnest(coalesce(p_lectures, '{}')) with ordinality as u(l, o)
           where u.l is not null group by u.l) x;
  lec := coalesce(lec, '{}');
  if cardinality(lec) > 20
     or exists (select 1 from unnest(lec) as t(id) where public.study_lecture_group(t.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  if not public.study_marathon__agenda_ok(ag, lec) then raise exception 'bad agenda'; end if;
  if p_id is null then
    if p_starts_at < now() - interval '1 hour' then raise exception 'bad time'; end if;
    insert into public.study_marathons (group_id, title, starts_at, minutes, place, note, lecture_ids, agenda, created_by, updated_by)
    values (p_group, btrim(p_title), p_starts_at, p_minutes, left(btrim(coalesce(p_place, '')), 120),
            left(btrim(coalesce(p_note, '')), 500), lec, ag, me, me)
    returning * into m;
    insert into public.study_marathon_people (marathon_id, user_id, answer) values (m.id, me, 'in');
  else
    select * into m from public.study_marathons x where x.id = p_id for update;
    if not found or m.group_id <> p_group then raise exception 'marathon not found'; end if;
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    if m.version <> coalesce(p_version, -1) then raise exception 'conflict'; end if;
    update public.study_marathons x
       set title = btrim(p_title), starts_at = p_starts_at, minutes = p_minutes,
           place = left(btrim(coalesce(p_place, '')), 120), note = left(btrim(coalesce(p_note, '')), 500),
           lecture_ids = lec, agenda = ag,
           step = least(x.step, jsonb_array_length(ag) - 1),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id
    returning * into m;
  end if;
  return query select m.id, m.version;
end;
$$;

-- The caller's answer: 'in', 'maybe' or 'out'. Errors: 'marathon not found',
-- 'marathon over', 'bad answer'.
create or replace function public.study_marathon_answer(p_id uuid, p_answer text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  if coalesce(p_answer, '') not in ('in', 'maybe', 'out') then raise exception 'bad answer'; end if;
  insert into public.study_marathon_people (marathon_id, user_id, answer, updated_at)
  values (p_id, me, p_answer, now())
  on conflict (marathon_id, user_id) do update set answer = excluded.answer, updated_at = excluded.updated_at;
end;
$$;

-- Moves the run-of-show from step p_from to step p_to (start: -1 → 0; next;
-- back; jump). p_to = the number of steps ends the marathon. If the step is
-- no longer p_from (another phone moved it first), nothing changes and the
-- current step is returned. Errors: 'marathon not found', 'marathon over',
-- 'no agenda', 'bad step'.
create or replace function public.study_marathon_step(p_id uuid, p_from int, p_to int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons; n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
  n := jsonb_array_length(m.agenda);
  if n = 0 then raise exception 'no agenda'; end if;
  if m.step <> coalesce(p_from, -2) then return m.step; end if;
  if p_to is null or p_to < 0 or p_to > n then raise exception 'bad step'; end if;
  if p_to = n then
    update public.study_marathons x
       set state = 'ended', ended_at = now(), started_at = coalesce(x.started_at, now()),
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
    return n;
  end if;
  update public.study_marathons x
     set step = p_to, step_at = now(), state = 'live', started_at = coalesce(x.started_at, now()),
         version = x.version + 1, updated_by = me, updated_at = now()
   where x.id = p_id;
  return p_to;
end;
$$;

-- Cancels (p_cancel true) a marathon that is not over, or brings a cancelled
-- one back (false) while its time has not passed. Errors: 'marathon not
-- found', 'marathon over'.
create or replace function public.study_marathon_cancel(p_id uuid, p_cancel boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.study_marathons;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.study_marathons x where x.id = p_id for update;
  if not found or not public.study_is_member(m.group_id) then raise exception 'marathon not found'; end if;
  if coalesce(p_cancel, true) then
    if public.study_marathon__over(m) then raise exception 'marathon over'; end if;
    update public.study_marathons x set state = 'cancelled', version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  else
    if m.state <> 'cancelled' or now() > m.starts_at + make_interval(mins => m.minutes) + interval '3 hours' then
      raise exception 'marathon over';
    end if;
    update public.study_marathons x
       set state = case when x.started_at is null then 'planned' else 'live' end,
           version = x.version + 1, updated_by = me, updated_at = now()
     where x.id = p_id;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_read_parts      enable row level security;
alter table public.study_read_places     enable row level security;
alter table public.study_plans           enable row level security;
alter table public.study_plan_lectures   enable row level security;
alter table public.study_plan_checks     enable row level security;
alter table public.study_marathons       enable row level security;
alter table public.study_marathon_people enable row level security;

-- (In study-schema.sql the file's loop has already dropped these; the drops
-- keep this block re-runnable on its own.)
drop policy if exists "study read parts own"        on public.study_read_parts;
drop policy if exists "study read parts remove"     on public.study_read_parts;
drop policy if exists "study read places own"       on public.study_read_places;
drop policy if exists "study plans own"             on public.study_plans;
drop policy if exists "study plans remove"          on public.study_plans;
drop policy if exists "study plan lectures own"     on public.study_plan_lectures;
drop policy if exists "study plan checks own"       on public.study_plan_checks;
drop policy if exists "study plan checks add"       on public.study_plan_checks;
drop policy if exists "study plan checks remove"    on public.study_plan_checks;
drop policy if exists "study marathons read"        on public.study_marathons;
drop policy if exists "study marathon people read"  on public.study_marathon_people;

-- Private rows: the owner reads (and may delete) their own; writes go
-- through the functions above (no insert/update grants).
create policy "study read parts own" on public.study_read_parts
  for select using (user_id = auth.uid());
create policy "study read parts remove" on public.study_read_parts
  for delete using (user_id = auth.uid());
create policy "study read places own" on public.study_read_places
  for select using (user_id = auth.uid());
create policy "study plans own" on public.study_plans
  for select using (user_id = auth.uid());
create policy "study plans remove" on public.study_plans
  for delete using (user_id = auth.uid());
create policy "study plan lectures own" on public.study_plan_lectures
  for select using (user_id = auth.uid());
-- Checks: ticked and unticked straight from the phone, on the caller's own plan.
create policy "study plan checks own" on public.study_plan_checks
  for select using (user_id = auth.uid());
create policy "study plan checks add" on public.study_plan_checks
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.study_plans p where p.id = plan_id and p.user_id = auth.uid())
  );
create policy "study plan checks remove" on public.study_plan_checks
  for delete using (user_id = auth.uid());

-- Marathons: the whole group reads them and who is in; writes go through
-- the functions above.
create policy "study marathons read" on public.study_marathons
  for select using (public.study_is_member(group_id));
create policy "study marathon people read" on public.study_marathon_people
  for select using (public.study_is_member(public.study_marathon_group(marathon_id)));

revoke all on public.study_read_parts, public.study_read_places, public.study_plans, public.study_plan_lectures,
  public.study_plan_checks, public.study_marathons, public.study_marathon_people
  from anon, authenticated;
grant select, delete on public.study_read_parts to authenticated;
grant select on public.study_read_places to authenticated;
grant select, delete on public.study_plans to authenticated;
grant select on public.study_plan_lectures to authenticated;
grant select, delete on public.study_plan_checks to authenticated;
grant insert (plan_id, day, task_key) on public.study_plan_checks to authenticated;
grant select on public.study_marathons to authenticated;
grant select on public.study_marathon_people to authenticated;

revoke all on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid), public.study_marathon__over(public.study_marathons),
  public.study_marathon__agenda_ok(jsonb, uuid[]),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  from public, anon;
grant execute on function public.study_note_reading(uuid, int, int, boolean, int), public.study_mark_parts(uuid, int[], boolean),
  public.study_my_lectures(uuid, timestamptz), public.study_my_weak_points(uuid, timestamptz),
  public.study_my_days(uuid, int, timestamptz),
  public.study_plan_save(uuid, uuid, text, date, text[], uuid[], uuid[], int, int[], boolean),
  public.study_plan_replan(uuid), public.study_plan_end(uuid),
  public.study_marathon_group(uuid),
  public.study_marathon_save(uuid, int, uuid, text, timestamptz, int, text, text, uuid[], jsonb),
  public.study_marathon_answer(uuid, text), public.study_marathon_step(uuid, int, int),
  public.study_marathon_cancel(uuid, boolean)
  to authenticated;

-- ── Realtime: marathons and who is in arrive live on every member's phone.
--  Never the private tables (read parts, places, plans, checks).
do $$
declare t text;
begin
  foreach t in array array['study_marathons', 'study_marathon_people'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

insert into study_private.schema_sections (section, version) values ('P', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();


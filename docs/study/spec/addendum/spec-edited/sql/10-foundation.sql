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


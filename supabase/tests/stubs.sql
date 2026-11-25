-- Stand-ins for what Supabase provides (roles, auth, storage, the realtime
-- publication), so the schema files can be tested on a plain local Postgres.
-- Run: see supabase/tests/study.sql.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant all on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
-- No default grants on new tables in public: Supabase stopped granting them to
-- anon and authenticated (new projects from 30 May 2026, existing ones from
-- 30 Oct 2026), so the schema must grant what it needs and the test must fail
-- if it forgets. Functions keep Postgres's default EXECUTE for PUBLIC only to
-- mirror older projects; the schema grants its own explicitly anyway.
alter default privileges in schema public revoke execute on functions from public;

-- Realtime Authorization, as Supabase provides it: private channels are
-- authorized by RLS on realtime.messages, with realtime.topic() naming the
-- channel. Here the topic comes from a setting the test changes.
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  payload jsonb
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable
as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage, select on sequence realtime.messages_id_seq to authenticated;

-- ── Additions to supabase/tests/stubs.sql (package F) ──
-- Review m5: an existing Supabase project grants EXECUTE on new functions in
-- public to anon and authenticated by default ("securing your API"); stubs.sql's
-- own "revoke … from public" cannot remove that. Mirror it, so a function that
-- forgets "revoke … from anon" shows up in check F27.
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- design-platform: additions to supabase/tests/stubs.sql (local Postgres only).
-- Stand-ins for Supabase Vault, pg_net and pg_cron, so the platform SQL can be
-- tested without a real project. They record what the schema asks of them.

-- Vault: the real one is a view over encrypted rows; the schema only reads
-- name and decrypted_secret.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  id               uuid primary key default gen_random_uuid(),
  name             text unique,
  decrypted_secret text
);

-- pg_net: net.http_post with the documented signature; each call is kept in
-- net.calls instead of being sent. (Real pg_net sends after commit.)
create schema if not exists net;
create table if not exists net.calls (
  id                   bigserial primary key,
  url                  text,
  body                 jsonb,
  headers              jsonb,
  timeout_milliseconds int,
  at                   timestamptz default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int default 2000
) returns bigint language sql as $$
  insert into net.calls (url, body, headers, timeout_milliseconds)
  values (url, body, headers, timeout_milliseconds) returning id
$$;

-- pg_cron: a named job is upserted, as pg_cron's job_metadata.c does
-- ("on conflict on constraint jobname_username_uniq do update").
create schema if not exists cron;
create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text,
  command  text
);
create table if not exists cron.job_run_details (
  runid    bigserial primary key,
  jobid    bigint,
  end_time timestamptz
);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

-- design-me: additions to supabase/tests/stubs.sql (local Postgres only).
-- auth.jwt() exactly as Supabase Auth defines it (migration
-- 20220531120530_add_auth_jwt_function, read by research-auth), so the
-- merge functions can read the is_anonymous claim; the tests set it with
-- "set request.jwt.claims".
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated;
-- Two columns Supabase's auth.users has, for the members report and the
-- safe clean-up (research-auth §3).
alter table auth.users add column if not exists is_anonymous boolean not null default false;
alter table auth.users add column if not exists created_at timestamptz not null default now();
alter table auth.users add column if not exists email_confirmed_at timestamptz;   -- the Send Email hook's check (review M5)

-- ── Additions to supabase/tests/stubs.sql (package F, F1Δ; spec §12.2) ──
-- Two columns Supabase Storage has and the local stand-in lacked: who
-- uploaded an object (owner_id, the uploader's auth.uid() as text, set by
-- the Storage API), and a bucket's limits (review SEC-14).
alter table storage.objects add column if not exists owner_id text;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];

-- ── Additions to supabase/tests/stubs.sql (section I, the personal code) ──
-- The auth.users columns GoTrue's password grant reads and section I writes
-- (supabase/auth internal/models/user.go), as GoTrue creates them, and
-- pgcrypto in schema extensions, where Supabase installs it.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter table auth.users add column if not exists instance_id uuid default '00000000-0000-0000-0000-000000000000';
alter table auth.users add column if not exists aud varchar(255) default 'authenticated';
alter table auth.users add column if not exists encrypted_password varchar(255) default '';
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists is_sso_user boolean not null default false;
alter table auth.users add column if not exists updated_at timestamptz;
alter table auth.users add column if not exists email_change varchar(255) default '';
alter table auth.users add column if not exists email_change_token_new varchar(255) default '';
alter table auth.users add column if not exists email_change_token_current varchar(255) default '';
alter table auth.users add column if not exists email_change_confirm_status smallint default 0;
create unique index if not exists users_email_partial_key on auth.users (email) where is_sso_user = false;
create table if not exists auth.one_time_tokens (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade, token_type text not null, token_hash text not null);
-- Auth's sessions (one row per signed-in device; signOut deletes rows), as
-- section I reads them: a code needs a session Auth still has.
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade, created_at timestamptz default now(),
  updated_at timestamptz, not_after timestamptz);
create index if not exists sessions_user_id_idx on auth.sessions (user_id);

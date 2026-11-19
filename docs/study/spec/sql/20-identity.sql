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


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


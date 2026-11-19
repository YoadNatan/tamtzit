-- ════════════════════════════════════════════════════════════════════════
--  SECTION B · THE BANK, WRITTEN AHEAD   (package B; server addendum §4)
--  Decision 3: questions and cards are written automatically after each
--  summary, through the Message Batches API at half price, ready before the
--  meeting; if a batch is not back by then, the rest is written normally at
--  full price. P7: a blind solver answers every question without its key,
--  and a question it answers differently is not saved.
--
--  Supabase owns the state, as for the summary (section W): a private job
--  per lecture, leases, a pg_cron dispatcher that kicks the Vercel worker
--  (/api/study/work, body {"bank": <job>}) to submit, poll, ingest and fall
--  back. The questions and cards land in section Q's and C's own tables,
--  through their own save functions (the worker path of their ends), so a
--  member sees them exactly as if a tap had written them. Nothing here is
--  published: members read a job only through study_bank_state().
--
--  Server switch 'bank' (study_private.features, off until Yoad turns it on).
--  Without the switch, or without server writing (pg_net, the key, the site
--  URL), the upload asks once: "להכין גם שאלות וכרטיסיות?" (§4.6).
--  Needs: F, W, Q (+ its end), C (+ its end). Reads section M's meetings
--  when they exist (the deadline), by to_regclass.
-- ════════════════════════════════════════════════════════════════════════
insert into study_private.features (name) values ('bank') on conflict (name) do nothing;

create table if not exists study_private.bank_jobs (
  id                uuid        primary key default gen_random_uuid(),
  lecture_id        uuid        not null unique references public.study_lectures (id) on delete cascade,
  group_id          uuid        not null references public.study_groups (id) on delete cascade,
  mode              text        not null check (mode in ('batch', 'now')),        -- now: written normally, full price
  state             text        not null default 'waiting'
                    check (state in ('waiting', 'new', 'submit', 'writing', 'solving', 'fallback', 'done', 'failed', 'cancelled')),
  q_round           int,
  c_round           int,
  stage             text        check (stage in ('write', 'solve')),
  msg_batch         text        check (msg_batch ~ '^msgbatch_[A-Za-z0-9_-]{1,120}$'),
  submitted_at      timestamptz,
  deadline          timestamptz,                                                   -- fall back to normal writing from here
  cancel_at         timestamptz,                                                   -- the Batch API was asked to cancel
  reservation       bigint,                                                        -- the ledger row of the stage in flight
  lease_id          uuid,
  lease_until       timestamptz,
  polls             int         not null default 0,
  last_poll_at      timestamptz,
  last_kick_at      timestamptz,
  kicks_since_claim int         not null default 0,
  requested_by      uuid        references auth.users (id) on delete set null,      -- "כן, להכין" at upload
  error             text        check (char_length(error) <= 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Checked questions waiting for the blind solver (with their keys and
-- explanations: never readable by a member).
create table if not exists study_private.bank_items (
  job_id   uuid  not null references study_private.bank_jobs (id) on delete cascade,
  batch_id uuid  not null references public.study_question_batches (id) on delete cascade,
  n        int   not null check (n between 0 and 9),
  item     jsonb not null check (jsonb_typeof(item) = 'object' and length(item::text) <= 20000),
  primary key (job_id, batch_id, n)
);

-- ── Helpers (no grants) ──
create or replace function study_private.bank_on()
returns boolean language sql stable security definer set search_path = public as $$
  select study_private.server_on() and study_private.feature_on('bank')
$$;

-- When the batch must be back: 90 minutes before the next meeting that reads
-- this lecture (section M), else a day after it started (the Batch API's own
-- limit). The worker falls back from here.
create or replace function study_private.bank_deadline(p_lecture uuid, p_from timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare m timestamptz;
begin
  if to_regclass('public.study_meetings') is not null then
    execute 'select min(x.starts_at) from public.study_meetings x
              where x.lecture_id = $1 and x.cancelled_at is null and x.starts_at > now()'
      into m using p_lecture;
  end if;
  return least(coalesce(p_from, now()) + interval '24 hours', m - interval '90 minutes');
end;
$$;

-- The job's rows: the batches of its two rounds.
create or replace function study_private.bank_rows(p_job study_private.bank_jobs)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by r ->> 'kind', (r ->> 'part_idx')::int), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'q', 'id', b.id, 'part_idx', b.part_idx, 'heading', b.heading, 'slide_from', b.slide_from,
                              'slide_to', b.slide_to, 'wanted', b.wanted, 'made', b.made, 'status', b.status,
                              'staged', (select count(*) from study_private.bank_items i where i.job_id = p_job.id and i.batch_id = b.id)) as r
      from public.study_question_batches b where b.lecture_id = p_job.lecture_id and b.round = p_job.q_round
    union all
    select jsonb_build_object('kind', 'c', 'id', b.id, 'part_idx', b.part_idx, 'heading', b.heading, 'slide_from', b.slide_from,
                              'slide_to', b.slide_to, 'wanted', b.wanted, 'made', b.made, 'status', b.status, 'staged', 0)
      from public.study_card_batches b where b.lecture_id = p_job.lecture_id and b.round = p_job.c_round
  ) x
$$;

-- Lets go of the job's held rows: a member's tap may write them now.
create or replace function study_private.bank_release(p_job uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare j study_private.bank_jobs;
begin
  select * into j from study_private.bank_jobs x where x.id = p_job;
  if not found then return; end if;
  update public.study_question_batches b set hold_until = null
   where b.lecture_id = j.lecture_id and b.round = j.q_round and b.hold_until is not null;
  update public.study_card_batches b set hold_until = null
   where b.lecture_id = j.lecture_id and b.round = j.c_round and b.hold_until is not null;
end;
$$;

-- Kicks the worker for each job with something to do now. p_now: right away
-- (a new job); the sweeper waits 2 minutes between kicks of one job, polls a
-- running batch every 2 minutes for its first 15, then every 5 up to 2 hours,
-- then every 15, and stops after 15 kicks nobody took (the worker is down).
create or replace function study_private.bank_dispatch(p_job uuid default null, p_now boolean default false)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  j study_private.bank_jobs; v_url text; v_key text; v_total int := 0; v_due boolean; v_dl timestamptz;
begin
  if not study_private.server_on() then return 0; end if;
  v_url := rtrim(study_private.secret('study_site_url'), '/') || '/api/study/work';
  v_key := study_private.secret('study_worker_key');
  for j in select * from study_private.bank_jobs x
            where (p_job is null or x.id = p_job) and x.state in ('new', 'submit', 'writing', 'solving', 'fallback')
            order by x.created_at
  loop
    if exists (select 1 from public.study_lectures l where l.id = j.lecture_id and l.deleted_at is not null) then
      update study_private.bank_jobs set state = 'cancelled', error = 'lecture deleted', updated_at = now() where id = j.id;
      perform study_private.bank_release(j.id);
      continue;
    end if;
    if j.kicks_since_claim >= 15 then
      update study_private.bank_jobs set state = 'failed', error = 'stalled', updated_at = now() where id = j.id;
      perform study_private.bank_release(j.id);
      continue;
    end if;
    -- A meeting planned (or moved) after the batch started moves the deadline.
    if j.state in ('writing', 'solving') and j.mode = 'batch' then
      v_dl := study_private.bank_deadline(j.lecture_id, j.submitted_at);
      if v_dl is distinct from j.deadline then
        update study_private.bank_jobs set deadline = v_dl, updated_at = now() where id = j.id;
        update public.study_question_batches b set hold_until = v_dl + interval '10 minutes'
         where b.lecture_id = j.lecture_id and b.round = j.q_round and b.status = 'writing';
        update public.study_card_batches b set hold_until = v_dl + interval '10 minutes'
         where b.lecture_id = j.lecture_id and b.round = j.c_round and b.status = 'writing';
        j.deadline := v_dl;
      end if;
    end if;
    v_due := case
      when j.lease_until > now() then false
      when j.state in ('writing', 'solving') then
        now() >= j.deadline
        or j.last_poll_at is null
        or j.last_poll_at <= now() - case when j.submitted_at > now() - interval '15 minutes' then interval '2 minutes'
                                          when j.submitted_at > now() - interval '2 hours' then interval '5 minutes'
                                          else interval '15 minutes' end
      else true end
      and (p_now or j.last_kick_at is null or j.last_kick_at <= now() - interval '110 seconds');
    if not v_due then continue; end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('bank', j.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 10000);
    update study_private.bank_jobs set last_kick_at = now(), kicks_since_claim = kicks_since_claim + 1 where id = j.id;
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

-- A job for a lecture (once per lecture). Returns its id, or null when there
-- is nothing to write (both kinds already have rounds) or the lecture is gone.
create or replace function study_private.bank_enqueue(p_lecture uuid, p_mode text, p_by uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  l    public.study_lectures;
  v_id uuid;
begin
  select * into l from public.study_lectures x where x.id = p_lecture;
  if not found or l.deleted_at is not null then return null; end if;
  select j.id into v_id from study_private.bank_jobs j where j.lecture_id = p_lecture;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.study_question_batches b where b.lecture_id = p_lecture)
     and exists (select 1 from public.study_card_batches b where b.lecture_id = p_lecture) then
    return null;
  end if;
  insert into study_private.bank_jobs (lecture_id, group_id, mode, state, requested_by)
  values (p_lecture, l.group_id, p_mode, case when l.status = 'ready' then 'new' else 'waiting' end, p_by)
  on conflict (lecture_id) do nothing
  returning bank_jobs.id into v_id;
  if v_id is not null and l.status = 'ready' then perform study_private.bank_dispatch(v_id, true); end if;
  return v_id;
end;
$$;

revoke all on function study_private.bank_on(), study_private.bank_deadline(uuid, timestamptz),
  study_private.bank_rows(study_private.bank_jobs), study_private.bank_release(uuid),
  study_private.bank_dispatch(uuid, boolean), study_private.bank_enqueue(uuid, text, uuid) from public;

-- ── The summary is ready: write the bank (automatically, or as asked) ──
create or replace function public.study_bank_after_ready()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' and new.deleted_at is null then
    if exists (select 1 from study_private.bank_jobs j where j.lecture_id = new.id and j.state = 'waiting') then
      update study_private.bank_jobs set state = 'new', updated_at = now() where lecture_id = new.id and state = 'waiting';
      perform study_private.bank_dispatch((select j.id from study_private.bank_jobs j where j.lecture_id = new.id), true);
    elsif study_private.bank_on() then
      perform study_private.bank_enqueue(new.id, 'batch', null);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.study_bank_after_ready() from public, anon, authenticated;
drop trigger if exists study_bank_after_ready on public.study_lectures;
create trigger study_bank_after_ready after update of status on public.study_lectures
  for each row execute function public.study_bank_after_ready();

-- ── What members call ──
-- How a new lecture's bank gets written: 'batch' (automatically, half price),
-- 'server' (the server can write it at full price if asked at upload), or
-- 'device' (the phone that writes the summary writes them, if asked).
create or replace function public.study_bank_mode(p_group uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.study_is_member(p_group), false) then raise exception 'group not found'; end if;
  return case when study_private.bank_on() then 'batch' when study_private.server_on() then 'server' else 'device' end;
end;
$$;

-- "כן, להכין" at upload while the bank is not automatic but the server writes:
-- the questions and cards are written normally (full price) once the summary
-- is ready. Returns the job's state, or 'nothing' when both already exist.
create or replace function public.study_bank_request(p_lecture uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare g uuid := public.study_lecture_group(p_lecture); v_id uuid;
begin
  if auth.uid() is null or g is null or not coalesce(public.study_is_member(g), false)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  if not study_private.server_on() then raise exception 'server off'; end if;
  v_id := study_private.bank_enqueue(p_lecture, case when study_private.bank_on() then 'batch' else 'now' end, auth.uid());
  return coalesce((select j.state from study_private.bank_jobs j where j.id = v_id), 'nothing');
end;
$$;

-- The lecture's bank, as a member sees it: no batch id, no lease, no error text.
create or replace function public.study_bank_state(p_lecture uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j study_private.bank_jobs;
begin
  if auth.uid() is null or not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false) then
    raise exception 'lecture not found';
  end if;
  select * into j from study_private.bank_jobs x where x.lecture_id = p_lecture;
  if not found then return null; end if;
  return jsonb_build_object(
    'state', case when j.state in ('new', 'submit') then 'starting'
                  when j.state in ('writing', 'solving') then 'batch'
                  when j.state = 'fallback' then 'writing'
                  else j.state end,
    'mode', j.mode,
    'ready_by', case when j.state in ('writing', 'solving') then j.deadline end,
    'requested', j.requested_by is not null);
end;
$$;

revoke all on function public.study_bank_mode(uuid), public.study_bank_request(uuid), public.study_bank_state(uuid) from public, anon;
grant execute on function public.study_bank_mode(uuid), public.study_bank_request(uuid), public.study_bank_state(uuid) to authenticated;

-- ── The worker (the server key, no member token) ──
-- Takes the job's next step under a lease (330 s). null: nothing to do now.
-- Steps: 'submit' (send the write batch), 'poll' (retrieve, ingest when
-- ended), 'cancel' (the deadline passed: cancel, then poll), 'write' (one
-- row the normal way, full price), 'solve_now' (staged questions, solved
-- now at full price, before the rows are written).
create or replace function public.study_bank_take(p_job uuid, p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  j      study_private.bank_jobs;
  v_step text;
  v_row  jsonb;
  b      record;
  r      int;
  v_lease uuid := gen_random_uuid();
begin
  if not study_private.is_worker(p_key) or auth.uid() is not null then raise exception 'forbidden'; end if;
  select * into j from study_private.bank_jobs x where x.id = p_job for update;
  if not found then return null; end if;
  if exists (select 1 from public.study_lectures l where l.id = j.lecture_id and l.deleted_at is not null) then
    update study_private.bank_jobs set state = 'cancelled', error = 'lecture deleted', updated_at = now() where id = j.id;
    perform study_private.bank_release(j.id);
    return null;
  end if;
  if j.state in ('waiting', 'done', 'failed', 'cancelled') or j.lease_until > now() then return null; end if;
  update study_private.bank_jobs set kicks_since_claim = 0 where id = j.id;

  if j.state = 'new' then
    -- Plan: the rounds this lecture has none of yet, every part claimed for
    -- the job (busy for a member's tap while the Batch API holds it).
    j.deadline := study_private.bank_deadline(j.lecture_id, now());
    if j.mode = 'batch' and j.deadline < now() + interval '60 minutes' then j.mode := 'now'; end if;
    if not exists (select 1 from public.study_question_batches x where x.lecture_id = j.lecture_id) then
      begin
        select q.round into r from public.study_question_round(j.lecture_id, p_key) q;
        j.q_round := r;
        for b in select x.id from public.study_question_batches x where x.lecture_id = j.lecture_id and x.round = r and x.status = 'pending' loop
          begin
            perform public.study_question_claim(b.id, p_key);
          exception when others then null;                                -- a member is writing it: leave it to her
          end;
        end loop;
        update public.study_question_batches x
           set via = case j.mode when 'batch' then 'batch' else 'server' end,
               hold_until = case j.mode when 'batch' then j.deadline + interval '10 minutes' end
         where x.lecture_id = j.lecture_id and x.round = r and x.status = 'writing';
      exception when others then
        if sqlerrm not in ('enough questions', 'no slides') then raise; end if;
      end;
    end if;
    if not exists (select 1 from public.study_card_batches x where x.lecture_id = j.lecture_id) then
      begin
        select c.round into r from public.study_card_round(j.lecture_id, p_key) c;
        j.c_round := r;
        for b in select x.id from public.study_card_batches x where x.lecture_id = j.lecture_id and x.round = r and x.status = 'pending' loop
          begin
            perform public.study_card_claim(b.id, p_key);
          exception when others then null;
          end;
        end loop;
        update public.study_card_batches x
           set via = case j.mode when 'batch' then 'batch' else 'server' end,
               hold_until = case j.mode when 'batch' then j.deadline + interval '10 minutes' end
         where x.lecture_id = j.lecture_id and x.round = r and x.status = 'writing';
      exception when others then
        if sqlerrm not in ('enough cards', 'no slides') then raise; end if;
      end;
    end if;
    j.state := case when j.mode = 'batch' then 'submit' else 'fallback' end;
    update study_private.bank_jobs
       set mode = j.mode, state = j.state, q_round = j.q_round, c_round = j.c_round,
           deadline = case when j.mode = 'batch' then j.deadline end, updated_at = now()
     where id = j.id;
    if j.q_round is null and j.c_round is null then
      update study_private.bank_jobs set state = 'done', updated_at = now() where id = j.id;
      return null;
    end if;
  end if;

  if j.state = 'submit' then
    v_step := 'submit';
  elsif j.state in ('writing', 'solving') then
    if now() >= j.deadline and j.cancel_at is null then
      v_step := 'cancel';
    elsif j.cancel_at is not null and j.cancel_at < now() - interval '15 minutes' then
      -- The Batch API has not finished cancelling: write the rest normally.
      update study_private.bank_jobs set state = 'fallback', updated_at = now() where id = j.id;
      perform study_private.bank_release(j.id);
      j.state := 'fallback';
    else
      v_step := 'poll';
    end if;
  end if;
  if j.state = 'fallback' then
    if exists (select 1 from study_private.bank_items i where i.job_id = j.id) then
      v_step := 'solve_now';
    else
      select r2 into v_row from jsonb_array_elements(study_private.bank_rows(j)) r2
       where r2 ->> 'status' = 'writing' order by r2 ->> 'kind' desc, (r2 ->> 'part_idx')::int limit 1;
      if v_row is null then
        update study_private.bank_jobs set state = 'done', lease_id = null, lease_until = null, updated_at = now() where id = j.id;
        return null;
      end if;
      v_step := 'write';
    end if;
  end if;

  update study_private.bank_jobs set lease_id = v_lease, lease_until = now() + interval '330 seconds', updated_at = now()
   where id = j.id;
  return jsonb_build_object('job', j.id, 'step', v_step, 'lease', v_lease, 'lecture_id', j.lecture_id, 'group_id', j.group_id,
                            'mode', j.mode, 'stage', j.stage, 'msg_batch', j.msg_batch, 'deadline', j.deadline,
                            'reservation', j.reservation, 'row', v_row, 'rows', study_private.bank_rows(j));
end;
$$;

-- Everything the worker needs to write the job's requests (it cannot read
-- the tables): the lecture, its parts with their text and corrections, the
-- items already in the bank and deck (duplicates, "already asked"), the
-- course's past-exam items (the style), and the questions staged for the
-- blind solver.
create or replace function public.study_bank_input(p_job uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j study_private.bank_jobs; l public.study_lectures;
begin
  if not study_private.is_worker(p_key) or auth.uid() is not null then raise exception 'forbidden'; end if;
  select * into j from study_private.bank_jobs x where x.id = p_job;
  if not found then raise exception 'job not found'; end if;
  select * into l from public.study_lectures x where x.id = j.lecture_id;
  return jsonb_build_object(
    'lecture', jsonb_build_object('id', l.id, 'group_id', l.group_id, 'course', l.course, 'title', l.title,
                                  'lecturer', l.lecturer, 'slides', l.slides),
    'parts', coalesce((select jsonb_agg(jsonb_build_object('idx', s.idx, 'title', s.title, 'slide_from', s.slide_from,
                                                           'slide_to', s.slide_to, 'markdown', s.markdown, 'gen', s.gen,
                                                           'corrections', public.study_corrections_of(s.lecture_id, s.idx)) order by s.idx)
                         from public.study_sections s where s.lecture_id = l.id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'part_idx', q.part_idx, 'topic', q.topic, 'aspect', q.aspect,
                                                               'vignette', q.vignette, 'question', q.question, 'options', q.options))
                             from public.study_questions q where q.lecture_id = l.id and q.retired_at is null), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'part_idx', c.part_idx, 'topic', c.topic, 'aspect', c.aspect,
                                                           'kind', c.kind, 'front', c.front, 'back', c.back, 'slides', c.slides))
                         from public.study_cards c where c.lecture_id = l.id and c.deleted_at is null), '[]'::jsonb),
    'exam_items', coalesce((select jsonb_agg(x) from (
                     select jsonb_build_object('exam_id', q.exam_id, 'exam_no', q.exam_no, 'created_at', e.created_at,
                                               'vignette', q.vignette, 'question', q.question, 'options', q.options, 'kind', q.kind) as x
                       from public.study_questions q join public.study_exams e on e.id = q.exam_id
                      where q.source = 'exam' and q.group_id = l.group_id and l.course <> '' and e.course = l.course and q.has_key
                      order by e.created_at desc, q.exam_no limit 200) y), '[]'::jsonb),
    'staged', coalesce((select jsonb_agg(jsonb_build_object('batch', i.batch_id, 'n', i.n, 'item', i.item) order by i.batch_id, i.n)
                          from study_private.bank_items i where i.job_id = j.id), '[]'::jsonb),
    'rows', study_private.bank_rows(j));
end;
$$;

-- What the worker reports. Events:
--   submitted {msg_batch, reservation, stage}   a batch is in the Batch API
--   polled    {}                                still in progress
--   cancelling {}                               cancel was asked (the deadline)
--   stage     {batch, items: [...]}             checked questions for the solver
--   ended     {}                                every result of the stage is in
--   step_done {}                                a 'write' or 'solve_now' step is over
--   failed    {error}                           give up: taps write the rest
-- Returns the job's state.
create or replace function public.study_bank_report(p_job uuid, p_lease uuid, p_event text, p_data jsonb, p_key text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  j study_private.bank_jobs;
  v_n int;
begin
  if not study_private.is_worker(p_key) or auth.uid() is not null then raise exception 'forbidden'; end if;
  select * into j from study_private.bank_jobs x where x.id = p_job for update;
  if not found then raise exception 'job not found'; end if;
  if j.lease_id is distinct from p_lease or j.lease_until <= now() then raise exception 'lease lost'; end if;
  p_data := coalesce(p_data, '{}'::jsonb);
  if p_event = 'submitted' then
    if coalesce(p_data ->> 'stage', '') not in ('write', 'solve')
       or coalesce(p_data ->> 'msg_batch', '') !~ '^msgbatch_[A-Za-z0-9_-]{1,120}$' then
      raise exception 'bad event';
    end if;
    update study_private.bank_jobs
       set state = case p_data ->> 'stage' when 'write' then 'writing' else 'solving' end,
           stage = p_data ->> 'stage', msg_batch = p_data ->> 'msg_batch',
           reservation = nullif(p_data ->> 'reservation', '')::bigint,
           submitted_at = coalesce(case when p_data ->> 'stage' = 'write' then now() end, submitted_at, now()),
           deadline = study_private.bank_deadline(lecture_id, coalesce(submitted_at, now())),
           cancel_at = null, polls = 0, last_poll_at = now(), lease_id = null, lease_until = null, updated_at = now()
     where id = j.id;
  elsif p_event = 'polled' then
    update study_private.bank_jobs set polls = polls + 1, last_poll_at = now(), lease_id = null, lease_until = null, updated_at = now()
     where id = j.id;
  elsif p_event = 'cancelling' then
    update study_private.bank_jobs set cancel_at = now(), polls = polls + 1, last_poll_at = now(),
                                        lease_id = null, lease_until = null, updated_at = now()
     where id = j.id;
  elsif p_event = 'stage' then
    if not exists (select 1 from public.study_question_batches b
                    where b.id = (p_data ->> 'batch')::uuid and b.lecture_id = j.lecture_id and b.round = j.q_round and b.status = 'writing') then
      raise exception 'batch not found';
    end if;
    if jsonb_typeof(p_data -> 'items') <> 'array' or jsonb_array_length(p_data -> 'items') > 5 then raise exception 'bad event'; end if;
    delete from study_private.bank_items i where i.job_id = j.id and i.batch_id = (p_data ->> 'batch')::uuid;
    insert into study_private.bank_items (job_id, batch_id, n, item)
    select j.id, (p_data ->> 'batch')::uuid, (e.o - 1)::int, e.v
      from jsonb_array_elements(p_data -> 'items') with ordinality as e(v, o);
  elsif p_event = 'ended' then
    select count(*) into v_n from jsonb_array_elements(study_private.bank_rows(j)) r where r ->> 'status' = 'writing';
    update study_private.bank_jobs
       set state = case when v_n > 0 or exists (select 1 from study_private.bank_items i where i.job_id = j.id) then 'fallback' else 'done' end,
           msg_batch = null, reservation = null, lease_id = null, lease_until = null, updated_at = now()
     where id = j.id;
    perform study_private.bank_release(j.id);
  elsif p_event = 'step_done' then                                         -- a 'write' or 'solve_now' step is over
    update study_private.bank_jobs set lease_id = null, lease_until = null, updated_at = now() where id = j.id;
  elsif p_event = 'failed' then
    update study_private.bank_jobs set state = 'failed', error = left(coalesce(p_data ->> 'error', 'failed'), 200),
                                        lease_id = null, lease_until = null, updated_at = now()
     where id = j.id;
    perform study_private.bank_release(j.id);
    delete from study_private.bank_items i where i.job_id = j.id;
  else
    raise exception 'bad event';
  end if;
  return (select x.state from study_private.bank_jobs x where x.id = j.id);
end;
$$;

-- Saves one item of a job's row through section Q's or C's own function
-- (their worker path): kind 'q' (a question that passed the solver) or 'c'.
create or replace function public.study_bank_save(p_job uuid, p_lease uuid, p_kind text, p_batch uuid, p_item jsonb, p_key text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare j study_private.bank_jobs;
begin
  if not study_private.is_worker(p_key) or auth.uid() is not null then raise exception 'forbidden'; end if;
  select * into j from study_private.bank_jobs x where x.id = p_job;
  if not found then raise exception 'job not found'; end if;
  if j.lease_id is distinct from p_lease or j.lease_until <= now() then raise exception 'lease lost'; end if;
  if p_kind = 'q' and exists (select 1 from public.study_question_batches b where b.id = p_batch and b.lecture_id = j.lecture_id and b.round = j.q_round) then
    return public.study_save_question(p_batch, null, p_item, p_key);
  elsif p_kind = 'c' and exists (select 1 from public.study_card_batches b where b.id = p_batch and b.lecture_id = j.lecture_id and b.round = j.c_round) then
    return public.study_save_card(p_batch, p_item, p_key);
  end if;
  raise exception 'batch not found';
end;
$$;

-- Ends one of the job's rows through section Q's or C's finish; the row's
-- staged questions go (saved or rejected by now).
create or replace function public.study_bank_finish(p_job uuid, p_lease uuid, p_kind text, p_batch uuid, p_status text,
  p_rejected int, p_solver_rejected int, p_model text, p_cost numeric, p_error text, p_key text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare j study_private.bank_jobs;
begin
  if not study_private.is_worker(p_key) or auth.uid() is not null then raise exception 'forbidden'; end if;
  select * into j from study_private.bank_jobs x where x.id = p_job;
  if not found then raise exception 'job not found'; end if;
  if j.lease_id is distinct from p_lease or j.lease_until <= now() then raise exception 'lease lost'; end if;
  if p_kind = 'q' and exists (select 1 from public.study_question_batches b where b.id = p_batch and b.lecture_id = j.lecture_id and b.round = j.q_round) then
    perform public.study_question_finish(p_batch, p_status, p_rejected, p_model, p_cost, p_error, p_key, coalesce(p_solver_rejected, 0));
    delete from study_private.bank_items i where i.job_id = j.id and i.batch_id = p_batch;
  elsif p_kind = 'c' and exists (select 1 from public.study_card_batches b where b.id = p_batch and b.lecture_id = j.lecture_id and b.round = j.c_round) then
    perform public.study_card_finish(p_batch, p_status, p_rejected, p_model, p_cost, p_error, p_key);
  else
    raise exception 'batch not found';
  end if;
end;
$$;

-- The worker calls these as anon, with the key alone (F27's allow-list).
revoke all on function public.study_bank_take(uuid, text), public.study_bank_input(uuid, text),
  public.study_bank_report(uuid, uuid, text, jsonb, text), public.study_bank_save(uuid, uuid, text, uuid, jsonb, text),
  public.study_bank_finish(uuid, uuid, text, uuid, text, int, int, text, numeric, text, text) from public, authenticated;
grant execute on function public.study_bank_take(uuid, text), public.study_bank_input(uuid, text),
  public.study_bank_report(uuid, uuid, text, jsonb, text), public.study_bank_save(uuid, uuid, text, uuid, jsonb, text),
  public.study_bank_finish(uuid, uuid, text, uuid, text, int, int, text, numeric, text, text) to anon;

-- ── The sweeper ──
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('study-bank', '*/2 * * * *', 'select study_private.bank_dispatch()');
  end if;
end $$;

insert into study_private.schema_sections (section, version) values ('B', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();
